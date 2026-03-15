# BotC Bench — Blood on the Clocktower AI Agent Benchmark

## What This Is

A benchmark platform for evaluating LLM agents' ability to deceive and detect deception in social deduction. Up to 15 AI agents (Anthropic Claude, OpenAI GPT, Google Gemini) play Blood on the Clocktower against each other. Features structured breakout group conversations, public whispers, a RECALL memory system, and a pixel-art web UI for live observation.

## Architecture

```
botc-bench/
  backend/           Python 3.13, FastAPI, asyncio
  frontend/          React 19, Vite, TypeScript, Zustand
  assets/            Map image, clocktower foreground PNG
  .env               API keys (gitignored)
  .env.example       Template for collaborators
```

## Backend

### Package structure (`backend/botc/`)

| Package | Purpose |
|---------|---------|
| `engine/` | Pure deterministic game logic. No I/O. Seeded RNG. All 20 Trouble Brewing roles. |
| `llm/` | Provider abstraction (Anthropic, OpenAI, Google). XML response parser. Token tracker. |
| `comms/` | Information visibility engine, breakout groups, whisper system, RECALL memory. |
| `orchestrator/` | Async game loop, agent wrapper, per-provider rate limiting, death narration. |
| `api/` | FastAPI REST + WebSocket for live observation. Quick-start endpoint. |
| `metrics/` | JSONL event log for replay and analysis. |
| `scripts/data/` | `trouble_brewing.json` — role definitions as data. |

### Key files

- `engine/types.py` — All enums, dataclasses (GamePhase, Player, Message, GameState, etc.)
- `engine/abilities.py` — One function per role ability, handles drunk/poison info modification
- `engine/night.py` — Night resolution in official night order
- `engine/day.py` — Nominations, voting (with dedup), execution
- `engine/win_conditions.py` — Good/evil win checks including Saint, Mayor, final-2
- `engine/phase_machine.py` — State machine with valid transitions (all phases can → GAME_OVER)
- `llm/prompt_builder.py` — System prompt with role-specific strategy tips (suggestive, not prescriptive)
- `llm/response_parser.py` — Parses `<THINK>`, `<SAY>`, `<ACTION>`, `<MEMORY>` XML tags
- `comms/context_manager.py` — RECALL system: token-budgeted recent messages + agent self-notes
- `comms/visibility.py` — Enforces information asymmetry (group join timestamps, whisper privacy)
- `orchestrator/game_runner.py` — Main game loop with sequential nominations, Slayer support, death narration
- `orchestrator/agent.py` — Stateless per-turn prompting (no conversation accumulation)

### RECALL Memory System

Agents do NOT receive full conversation history. Instead:
1. **Self-notes** (`<MEMORY>` tag) — agent's own running summary, primary continuity mechanism
2. **Recent messages** — token-budgeted (~2K tokens, ~20-40 messages)
3. **`{RECALL: query}`** — on-demand keyword search of past visible conversations
4. Dramatically reduces per-turn token cost (from 200K+ to ~4K)

### Running the backend

```bash
cd backend
pip install -e ".[dev]"
# DO NOT use --reload during games (kills in-flight game tasks)
uvicorn botc.main:app --port 8000
pytest tests/ -v  # 40 tests
```

### Quick-start a game

```bash
# Set keys in .env, then:
curl -X POST "http://localhost:8000/api/games/quick?num_players=12&seed=42"
# Returns {"game_id": "abc123", "status": "running"}
```

### API endpoints

```
POST /api/games              Full game config with per-agent API keys
POST /api/games/quick        Quick-start using .env keys (num_players, seed params)
GET  /api/games              List all games
GET  /api/games/{id}         Game state (running) or result (completed)
WS   /ws/game/{id}           Live event stream for frontend
```

### Python path

`/Library/Frameworks/Python.framework/Versions/3.13/bin/python3`

## Frontend

React 19 + TypeScript + Vite + Zustand + framer-motion. Pixel art aesthetic.

### Key components

| Component | Purpose |
|-----------|---------|
| `TownMap.tsx` | Pixel art map with DX Terminal sprites, waypoint pathfinding around clocktower, speech bubbles, night overlay, death narration, game over screen |
| `pathfinding.ts` | Waypoint graph, BFS pathfinding, clocktower occlusion zones, phase-specific destinations |
| `ConversationPanel.tsx` | Tabbed message view — Public + breakout groups with member names |
| `VotingOverlay.tsx` | Parchment-style voting tracker at bottom of map |
| `PlayerDetailDrawer.tsx` | Click sprite → role, alignment, ability, private reasoning feed |
| `GameHeader.tsx` | Phase pill, day counter, alive count, token cost, observer toggle |
| `GameView.tsx` | Layout compositor, WebSocket connection via useParams |
| `GameLobby.tsx` | Configure and start games |

### Visual features

- **DX Terminal sprites** — 20 CC pixel art characters from dxrg CDN (`/sprites/sprite_XXXX.gif`)
- **Clocktower occlusion** — `clocktower.png` foreground layer, sprites walk behind upper tower
- **Waypoint pathfinding** — agents walk around the clocktower, never through it
- **Phase-based movement** — idle wandering, breakout group clustering, nomination circle, night scatter
- **Night overlay** — dark blue gradient with gold italic "Night falls on the village..."
- **Speech bubbles** — auto-appear for 5 seconds when agents speak
- **Death narration** — parchment card with absurd Monty Python-style LLM-generated death descriptions
- **Game over screen** — dark overlay with "GOOD TRIUMPHS" / "EVIL PREVAILS"
- **Observer mode** — red glow on evil sprites, role text in red, poison/drunk/shield emoji markers
- **Provider colors** — Anthropic=#D97706, OpenAI=#10B981, Google=#3B82F6

### Running the frontend

```bash
cd frontend
npm install
npm run dev  # http://localhost:5173
# Navigate to /game/{gameId} to watch a live game
```

## Game Flow

```
SETUP → FIRST_NIGHT → DAY_DISCUSSION → DAY_BREAKOUT ⟷ DAY_REGROUP
  → NOMINATIONS (on-the-block: nominate → vote → compare → next)
  → EXECUTION (after all nominations, execute whoever is on the block)
  → NIGHT → (repeat)
  → GAME_OVER (from any phase when win condition met)
```

### Nomination flow (on-the-block)
1. Go around the circle, each alive player may nominate or pass
2. If nomination → accusation speech → defense speech → all eligible vote
3. Count YES votes against threshold (>= 50% alive) and current block holder:
   - Above threshold + higher than current → new player goes ON THE BLOCK (replaces)
   - Above threshold + tied with current → both freed, nobody on block
   - Below threshold or lower → nomination fails
4. Continue to next player — players can vote YES on multiple nominations
5. Each player can nominate once per day; each player can be nominated once per day
6. After all players have had a chance: execute whoever is on the block
7. If nobody is on the block → no execution today
8. Win conditions checked after execution (or lack thereof)

### Night order (Trouble Brewing)
- First night: Poisoner → Washerwoman → Librarian → Investigator → Chef → Empath → Fortune Teller → Butler → Spy
- Other nights: Poisoner → Monk → Imp kill → Ravenkeeper → Empath → Fortune Teller → Undertaker → Butler → Spy

### BotC rules (important for benchmark)
- Dead players' roles are NEVER revealed (unlike Mafia/Werewolf)
- Dead players get exactly 1 ghost vote for the rest of the game
- Whisper content is private (sender + receiver only), but everyone sees who whispered to whom
- The Drunk thinks they're a Townsfolk but gets wrong information
- Poisoned players get wrong information without knowing it

## Rate Limiting

- Per-provider semaphores — different providers fire in parallel (independent rate limits)
- Same-provider calls gated by configurable semaphore (default 3 concurrent)
- Exponential backoff retry with rate-limit-aware delays (15s base for 429s)

## Git / Collaboration

```bash
# .env is gitignored — API keys never touch GitHub
# Collaborators copy .env.example → .env and add their own keys
# DO NOT commit .env
```

## Known Issues / TODO

### High priority
- [ ] Random medieval name bank (100+) — agents see character names, not model names
- [ ] `reveal_models` flag in GameConfig for A/B benchmark comparison
- [ ] Load message history on late WebSocket connect
- [ ] Accordion conversation timeline (collapsible phase sections)
- [ ] Clarify BotC death rules in system prompt (roles NOT revealed on death)
- [ ] Clearer game state format in prompts (separate alive/dead lists)

### Medium priority
- [ ] Whisper overhear mechanic (adjacent agents have % chance to hear content)
- [ ] Death details in player drawer (cause, day, phase)
- [ ] Music player with mute toggle (user providing audio files)
- [ ] Private reasoning not accumulating correctly in player drawer
- [ ] Verify poison/drunk mechanics with targeted seed
- [ ] Night action log showing abilities resolving (observer mode)

### Low priority / polish
- [ ] Sprite clipping on building edges (tighten walkable areas)
- [ ] Replay system (load saved game events, scrub through)
- [ ] Metrics dashboard (per-model win rates, deception scores, ELO)
- [ ] Batch runner for automated benchmark runs
- [ ] Human player support via WebSocket

## Completed Fixes (this session)
- [x] Sequential nominations (was batch, caused stuck games)
- [x] Slayer shot wired up (was silently ignored)
- [x] Vote deduplication (was allowing 16 votes from 12 players)
- [x] Phase machine allows GAME_OVER from any phase (was crashing on voting→game_over)
- [x] Breakout conversation tabs with member names
- [x] Group message filtering (groupId matching)
- [x] Nomination dedup in frontend store
- [x] Clear nominations/groups on new day
- [x] Clickable group labels on map → switch conversation tab
- [x] Sprite z-index vs UI panels (drawer at z-200)
- [x] Death narration fade-out (8s timer via ref, not useEffect cleanup)
- [x] Absurd death narrations (Monty Python prompt, varied causes)
- [x] Evil glow hugs sprite silhouette (drop-shadow filter, not box)
- [x] Evil role text in red (observer mode)
- [x] Day counter updating in header
- [x] Poisoned/Drunk/Protected emoji markers above sprites
- [x] Game over overlay screen
- [x] Role-specific strategy tips (suggestive, evil coordination)
- [x] RECALL memory system (token-budgeted context, agent self-notes)
- [x] Per-provider rate limiting (parallel across providers)
- [x] Butler ability signature fix (was crashing first night)
- [x] Message dedup in frontend store
- [x] DX Terminal sprites replacing emoji placeholders
- [x] Clocktower foreground occlusion layer
- [x] Waypoint pathfinding around clocktower
- [x] Idle wandering during discussion phases
- [x] Correct BotC nomination flow with on-the-block tracking (was: immediate execution after first passing vote)
- [x] Accusation & defense speeches before voting
- [x] Multiple nominations per day with vote comparison (higher replaces, tie frees both)
