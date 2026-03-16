"""Track token usage and estimated costs per agent and game phase."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pricing table (USD per million tokens)
# ---------------------------------------------------------------------------

# (input_cost_per_mtok, output_cost_per_mtok)
MODEL_PRICING: dict[str, tuple[float, float]] = {
    # Anthropic
    "claude-sonnet-4-20250514": (3.0, 15.0),
    "claude-opus-4-20250514": (15.0, 75.0),
    "claude-haiku-4-5-20251001": (0.80, 4.0),
    # OpenAI
    "gpt-4o": (2.50, 10.0),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4.1": (2.0, 8.0),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1-nano": (0.10, 0.40),
    "o3-mini": (1.10, 4.40),
    "o4-mini": (1.10, 4.40),
    "gpt-5.4": (2.50, 10.0),
    "gpt-5.4-pro": (10.0, 40.0),
    # Google
    "gemini-2.5-pro": (1.25, 10.0),
    "gemini-2.5-flash": (0.15, 0.60),
    "gemini-2.0-flash": (0.10, 0.40),
    "gemini-3.1-pro-preview": (1.25, 10.0),
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Return the estimated cost in USD for a single call.

    Falls back to 0.0 if the model isn't in the pricing table.
    """
    pricing = MODEL_PRICING.get(model)
    if pricing is None:
        # Try prefix matching for versioned model strings like
        # "gpt-4o-2024-08-06" -> "gpt-4o"
        for key, val in MODEL_PRICING.items():
            if model.startswith(key):
                pricing = val
                break
    if pricing is None:
        logger.warning("No pricing data for model %r — cost will be 0", model)
        return 0.0

    input_cost, output_cost = pricing
    return (input_tokens * input_cost + output_tokens * output_cost) / 1_000_000


# ---------------------------------------------------------------------------
# Single-call record
# ---------------------------------------------------------------------------

@dataclass
class CallRecord:
    """One LLM API call."""

    agent_id: str
    phase_id: str
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: float
    cost_usd: float


# ---------------------------------------------------------------------------
# Aggregate stats
# ---------------------------------------------------------------------------

@dataclass
class AgentUsage:
    """Accumulated usage for a single agent."""

    agent_id: str
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cost_usd: float = 0.0
    call_count: int = 0
    total_latency_ms: float = 0.0

    @property
    def total_tokens(self) -> int:
        return self.total_input_tokens + self.total_output_tokens

    @property
    def avg_latency_ms(self) -> float:
        return self.total_latency_ms / self.call_count if self.call_count else 0.0


# ---------------------------------------------------------------------------
# Token tracker
# ---------------------------------------------------------------------------

class TokenTracker:
    """Accumulates token usage and costs across an entire game."""

    def __init__(self) -> None:
        self._calls: list[CallRecord] = []
        self._agent_usage: dict[str, AgentUsage] = {}

    # -- Recording ----------------------------------------------------------

    def record(
        self,
        agent_id: str,
        phase_id: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        latency_ms: float,
    ) -> CallRecord:
        """Record a single LLM call and return the :class:`CallRecord`."""
        cost = estimate_cost(model, input_tokens, output_tokens)

        record = CallRecord(
            agent_id=agent_id,
            phase_id=phase_id,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=latency_ms,
            cost_usd=cost,
        )
        self._calls.append(record)

        # Update per-agent aggregate.
        if agent_id not in self._agent_usage:
            self._agent_usage[agent_id] = AgentUsage(agent_id=agent_id)
        usage = self._agent_usage[agent_id]
        usage.total_input_tokens += input_tokens
        usage.total_output_tokens += output_tokens
        usage.total_cost_usd += cost
        usage.call_count += 1
        usage.total_latency_ms += latency_ms

        return record

    # -- Queries ------------------------------------------------------------

    @property
    def calls(self) -> list[CallRecord]:
        """All recorded calls in chronological order."""
        return list(self._calls)

    def agent_usage(self, agent_id: str) -> AgentUsage | None:
        """Return accumulated usage for *agent_id*, or ``None``."""
        return self._agent_usage.get(agent_id)

    def all_agent_usage(self) -> list[AgentUsage]:
        """Return usage for every agent that has at least one call."""
        return list(self._agent_usage.values())

    def calls_for_phase(self, phase_id: str) -> list[CallRecord]:
        """Return all calls that occurred during *phase_id*."""
        return [c for c in self._calls if c.phase_id == phase_id]

    # -- Totals -------------------------------------------------------------

    @property
    def total_input_tokens(self) -> int:
        return sum(c.input_tokens for c in self._calls)

    @property
    def total_output_tokens(self) -> int:
        return sum(c.output_tokens for c in self._calls)

    @property
    def total_tokens(self) -> int:
        return self.total_input_tokens + self.total_output_tokens

    @property
    def total_cost_usd(self) -> float:
        return sum(c.cost_usd for c in self._calls)

    @property
    def total_latency_ms(self) -> float:
        return sum(c.latency_ms for c in self._calls)

    # -- Summary ------------------------------------------------------------

    def summary(self) -> dict:
        """Return a JSON-serializable summary of the full game's token usage."""
        return {
            "total_calls": len(self._calls),
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "total_tokens": self.total_tokens,
            "total_cost_usd": round(self.total_cost_usd, 4),
            "total_latency_ms": round(self.total_latency_ms, 1),
            "agents": {
                aid: {
                    "calls": u.call_count,
                    "input_tokens": u.total_input_tokens,
                    "output_tokens": u.total_output_tokens,
                    "cost_usd": round(u.total_cost_usd, 4),
                    "avg_latency_ms": round(u.avg_latency_ms, 1),
                }
                for aid, u in self._agent_usage.items()
            },
        }
