"""Run a BotC game with AI agents — supports mixed models."""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))

# Load .env file if present
env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip())

from botc.engine.types import GameConfig, BreakoutConfig
from botc.llm.provider import AgentConfig
from botc.orchestrator.game_runner import GameRunner


async def main():
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    google_key = os.environ.get("GOOGLE_API_KEY", "")

    if not anthropic_key and not openai_key and not google_key:
        print("ERROR: Set at least one API key: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY")
        sys.exit(1)

    num_players = 7

    # Build agent roster — distribute across available providers
    agent_specs: list[tuple[str, str, str, str]] = []  # (name, provider, model, key)

    # Round-robin across available providers
    providers = []
    if anthropic_key:
        providers.append(("anthropic", "claude-haiku-4-5-20251001", anthropic_key, "Claude"))
    if openai_key:
        providers.append(("openai", "gpt-4o-mini", openai_key, "GPT"))
    if google_key:
        providers.append(("google", "gemini-2.5-flash", google_key, "Gemini"))

    for i in range(num_players):
        provider, model, key, prefix = providers[i % len(providers)]
        agent_specs.append((f"{prefix}-{i}", provider, model, key))

    print(f"\n{'='*60}")
    print(f"  Blood on the Clocktower — AI Benchmark")
    print(f"  {num_players} players, {len(providers)} provider(s)")
    print(f"  Models: {', '.join(set(p[1] for p in providers))}")
    print(f"{'='*60}\n")

    agent_configs = [
        AgentConfig(agent_id=name, provider=prov, model=model, api_key=key, temperature=0.8)
        for name, prov, model, key in agent_specs
    ]

    game_config = GameConfig(
        script="trouble_brewing",
        num_players=num_players,
        breakout=BreakoutConfig(
            num_rounds=1,
            messages_per_agent=2,
            max_groups=3,
            min_group_size=2,
            whispers_per_round=1,
            max_whisper_chars=150,
        ),
        opening_statements=True,
        breakout_min_players=6,
        seed=99,
        max_days=5,
        max_concurrent_llm_calls=3,  # Per-provider limit (providers run in parallel)
    )

    events = []

    def on_event(event_type: str, data: dict):
        events.append({"type": event_type, "data": data})

        if event_type == "game.created":
            print("Game created!")
            for p in data["players"]:
                print(f"  Seat {p['seat']}: {p['agent_id']} ({p.get('model', '?')})")
        elif event_type == "phase.change":
            phase = data.get("phase", "?")
            day = data.get("day", "")
            rnd = data.get("round", "")
            extra = f" (day {day})" if day else ""
            extra += f" (round {rnd})" if rnd else ""
            print(f"\n--- {phase}{extra} ---")
        elif event_type == "message.new":
            seat = data.get("seat", "?")
            content = data.get("content", "")[:120]
            msg_type = data.get("type", "public")
            group = f" [grp]" if msg_type == "group" else ""
            print(f"  [{seat}]{group}: {content}")
        elif event_type == "death":
            print(f"  DEATH: Seat {data.get('seat')} ({data.get('role')}) died!")
        elif event_type == "execution":
            print(f"  EXEC:  Seat {data.get('seat')} ({data.get('role')}) executed!")
        elif event_type == "nomination.start":
            print(f"  NOM:   Seat {data.get('nominator')} -> Seat {data.get('nominee')}")
        elif event_type == "vote.cast":
            v = "YES" if data.get("vote") else "NO"
            print(f"    Vote: Seat {data.get('seat')} = {v}")
        elif event_type == "nomination.result":
            outcome = data.get('outcome', '?')
            on_block = data.get('on_the_block')
            block_info = f" | On block: Seat {on_block}" if on_block is not None else ""
            print(f"    Tally: {len(data.get('votes_for', []))} for / {len(data.get('votes_against', []))} against -> {outcome}{block_info}")
        elif event_type == "breakout.formed":
            for g in data.get("groups", []):
                print(f"  GROUP: {g['id'][:6]} = seats {g['members']}")
        elif event_type == "whisper.notification":
            print(f"  WHISPER: Seat {data.get('from')} -> Seat {data.get('to')}")
        elif event_type == "player.reasoning":
            seat = data.get("seat", "?")
            reasoning = data.get("reasoning", "")[:80]
            print(f"  THINK[{seat}]: {reasoning}")
        elif event_type == "game.over":
            print(f"\n{'='*60}")
            print(f"  GAME OVER: {data.get('winner', '?').upper()} WINS!")
            print(f"  {data.get('reason', '')}")
            print(f"{'='*60}")

    runner = GameRunner(game_config, agent_configs, on_event=on_event)

    start = time.time()
    try:
        result = await runner.run()
    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        if runner.state:
            print(f"\nState: phase={runner.state.phase.value}, day={runner.state.day_number}, alive={len(runner.state.alive_players)}")
        return

    elapsed = time.time() - start

    print(f"\n{'='*60}")
    print(f"  FINAL RESULTS")
    print(f"{'='*60}")
    print(f"  Winner: {result.winner}")
    print(f"  Days: {result.total_days}  |  Duration: {elapsed:.0f}s")
    print(f"\n  Players:")
    for p in result.players:
        status = "ALIVE" if p["survived"] else "DEAD"
        print(f"    Seat {p['seat']}: {p['agent_id']:12s} — {p['role']:18s} ({p['alignment']:4s}) [{status}]")

    if result.token_summary:
        s = result.token_summary
        print(f"\n  Tokens: {s.get('total_tokens', 0):,}  |  Cost: ${s.get('total_cost_usd', 0):.4f}")
        if "agents" in s:
            print(f"\n  Per-agent:")
            for aid, u in s["agents"].items():
                print(f"    {aid:12s}: {u['input_tokens']+u['output_tokens']:>8,} tok  ${u['cost_usd']:.4f}  ({u['calls']} calls, {u['avg_latency_ms']:.0f}ms avg)")

    os.makedirs("games", exist_ok=True)
    log_path = f"games/game_{result.game_id}.json"
    with open(log_path, "w") as f:
        json.dump({
            "result": {
                "game_id": result.game_id,
                "winner": result.winner,
                "win_condition": result.win_condition,
                "total_days": result.total_days,
                "players": result.players,
                "duration_seconds": result.duration_seconds,
                "token_summary": result.token_summary,
            },
            "events": events,
        }, f, indent=2, default=str)
    print(f"\n  Log: {log_path}")


if __name__ == "__main__":
    asyncio.run(main())
