"""Pre-game cost estimation for Stripe payment flow.

Estimates total LLM API cost for a game based on player count, models,
and historical per-call token averages. Returns a charge amount with a
buffer multiplier to cover variance.
"""

from __future__ import annotations

from botc.llm.token_tracker import MODEL_PRICING

# Models allowed for Stripe-paid games (cheap, high rate limits)
# Expensive models (Sonnet, Opus, GPT-5.4 Pro, Gemini Pro) are BYOK-only.
PAID_ALLOWED_MODELS: set[str] = {
    "claude-haiku-4-5-20251001",
    "gemini-3-flash-preview",
    "gpt-5.4-mini",
    "o4-mini",
    "gpt-4o",
}

# Historical averages from completed games (5 games, 617 calls)
CALLS_PER_PLAYER_PER_DAY = 5  # Observed: 4.0–5.1 per actual game day

# Input tokens scale with player count (more players = longer game state/messages)
BASE_INPUT_TOKENS = 3500
INPUT_TOKENS_PER_PLAYER = 400  # Observed: ~400 extra tokens per added player

# Output tokens: reasoning models include thinking tokens billed as output.
# Detect reasoning models using the same prefixes as the LLM adapters.
_REASONING_PREFIXES = ("o1", "o3", "o4", "gpt-5")
_REASONING_KEYWORDS = ("deepseek-r1", "qwen3", "kimi-k2")
AVG_OUTPUT_TOKENS_STANDARD = 400   # Observed: 150–400
AVG_OUTPUT_TOKENS_REASONING = 1200  # Observed: 600–1500

# Default pricing for unknown models (moderate assumption)
DEFAULT_PRICING = (2.0, 10.0)

# Minimum charge in USD
MINIMUM_CHARGE_USD = 1.00

# Service fee: $0.50 base + 10% markup covers Stripe (2.9% + $0.30) + server costs
SERVICE_FEE_BASE = 0.50
SERVICE_FEE_MULTIPLIER = 1.10

# No variance buffer — we charge for max possible days (num_players - 2)
DEFAULT_BUFFER = 1.0


def _resolve_pricing(model: str) -> tuple[float, float]:
    """Look up (input_$/MTok, output_$/MTok) for a model."""
    pricing = MODEL_PRICING.get(model)
    if pricing is None:
        for key, val in MODEL_PRICING.items():
            if key in model or model.startswith(key):
                pricing = val
                break
    return pricing or DEFAULT_PRICING


def _is_reasoning_model(model: str) -> bool:
    """Detect reasoning/thinking models using the same patterns as LLM adapters."""
    base = model.lower().rsplit("/", 1)[-1]  # strip OpenRouter prefix
    if any(base.startswith(p) for p in _REASONING_PREFIXES):
        return True
    return any(k in base for k in _REASONING_KEYWORDS)


def _model_cost_per_call(model: str, num_players: int) -> float:
    """Estimate USD cost for a single LLM call with the given model."""
    pricing = _resolve_pricing(model)
    avg_input = BASE_INPUT_TOKENS + INPUT_TOKENS_PER_PLAYER * num_players
    avg_output = AVG_OUTPUT_TOKENS_REASONING if _is_reasoning_model(model) else AVG_OUTPUT_TOKENS_STANDARD
    input_cost = (avg_input / 1_000_000) * pricing[0]
    output_cost = (avg_output / 1_000_000) * pricing[1]
    return input_cost + output_cost


def _estimate_days(num_players: int, max_days: int = 20) -> int:
    """Theoretical max game length in BotC: num_players - 2 days.

    One death per day (execution) + one per night (demon kill).
    Game ends when ~3 players remain. This is the ceiling — most games
    end much sooner, but charging for the max means no shortfall.
    """
    return min(max(2, num_players - 2), max_days)


def estimate_game_cost(
    num_players: int,
    seat_models: list[str],
    max_days: int = 20,
    buffer_multiplier: float = DEFAULT_BUFFER,
) -> dict:
    """Estimate the cost of a game before starting.

    Returns a dict with:
      - estimated_cost: best-guess cost (no buffer)
      - charge_amount: estimated * buffer, floored to MINIMUM_CHARGE_USD
      - breakdown: per-model cost breakdown
      - est_days: estimated game length
      - assumptions: human-readable explanation
    """
    est_days = _estimate_days(num_players, max_days)

    # Per-model breakdown
    model_counts: dict[str, int] = {}
    for m in seat_models:
        model_counts[m] = model_counts.get(m, 0) + 1

    breakdown: dict[str, dict] = {}
    total_per_day = 0.0

    for model, count in model_counts.items():
        cost_per_call = _model_cost_per_call(model, num_players)
        daily_cost = cost_per_call * CALLS_PER_PLAYER_PER_DAY * count
        total_per_day += daily_cost
        breakdown[model] = {
            "count": count,
            "cost_per_call": round(cost_per_call, 6),
            "daily_cost": round(daily_cost, 4),
            "total_est": round(daily_cost * est_days, 4),
        }

    estimated_cost = total_per_day * est_days
    # Apply service fee: $0.50 base + 10% markup
    with_fees = (estimated_cost * buffer_multiplier * SERVICE_FEE_MULTIPLIER) + SERVICE_FEE_BASE
    is_minimum = with_fees < MINIMUM_CHARGE_USD
    charge_amount = max(with_fees, MINIMUM_CHARGE_USD)

    return {
        "estimated_cost": round(estimated_cost, 2),
        "charge_amount": round(charge_amount, 2),
        "is_minimum": is_minimum,
        "minimum_charge": MINIMUM_CHARGE_USD,
        "breakdown": breakdown,
        "est_days": est_days,
        "num_players": num_players,
        "assumptions": (
            f"{num_players} players, ~{est_days} days, "
            f"~{CALLS_PER_PLAYER_PER_DAY} calls/player/day, "
            f"{buffer_multiplier}x buffer"
        ),
    }


def estimate_monitor_cost(
    model: str,
    game_event_count: int,
    buffer_multiplier: float = DEFAULT_BUFFER,
) -> dict:
    """Estimate cost of running a monitor on a completed game.

    Monitors make ~1 call per phase (roughly events / 20) plus a summary call.
    """
    # Rough: 1 LLM call per ~20 events + 1 summary
    est_calls = max(1, game_event_count // 20) + 1
    cost_per_call = _model_cost_per_call(model, 7)  # assume ~7p for monitor context
    estimated_cost = cost_per_call * est_calls
    charge_amount = max(estimated_cost * buffer_multiplier, 0.50)  # Lower minimum for monitors

    return {
        "estimated_cost": round(estimated_cost, 2),
        "charge_amount": round(charge_amount, 2),
        "model": model,
        "est_calls": est_calls,
    }
