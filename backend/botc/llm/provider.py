"""Abstract LLM provider interface, response types, and factory."""

from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class LLMResponse:
    """Normalized response from any LLM provider."""

    content: str
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: float


@dataclass
class AgentConfig:
    """Configuration for a single LLM-backed agent."""

    agent_id: str
    provider: str  # "anthropic" | "openai" | "google"
    model: str  # e.g. "claude-sonnet-4-20250514", "gpt-4o", "gemini-2.0-flash"
    api_key: str
    temperature: float = 0.7


# ---------------------------------------------------------------------------
# Abstract base class
# ---------------------------------------------------------------------------


class LLMProvider(ABC):
    """Interface that every LLM adapter must implement."""

    def __init__(self, config: AgentConfig) -> None:
        self.config = config

    @abstractmethod
    async def complete(
        self,
        system_prompt: str,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 1024,
        reasoning_effort: str | None = None,
    ) -> LLMResponse:
        """Send a chat completion request and return a normalized response.

        Parameters
        ----------
        system_prompt:
            System-level instruction prepended to the conversation.
        messages:
            List of ``{"role": "user"|"assistant", "content": "..."}`` dicts.
        temperature:
            Sampling temperature (0.0 - 1.0).
        max_tokens:
            Maximum tokens in the completion.
        reasoning_effort:
            Thinking depth for reasoning models: "low", "medium", "high".
            None uses provider default. Ignored by non-thinking models.
        """

    async def complete_with_retry(
        self,
        system_prompt: str,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 1024,
        reasoning_effort: str | None = None,
        max_retries: int = 8,
    ) -> LLMResponse:
        """Wrapper around :meth:`complete` with exponential-backoff retries.

        Retries up to *max_retries* times on transient errors.  The back-off
        schedule is 1 s, 2 s, 4 s (doubling each attempt).
        """
        last_exc: Exception | None = None
        for attempt in range(max_retries):
            try:
                return await self.complete(
                    system_prompt=system_prompt,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    reasoning_effort=reasoning_effort,
                )
            except Exception as exc:
                last_exc = exc
                if attempt < max_retries - 1:
                    is_rate_limit = "429" in str(exc) or "rate_limit" in str(exc).lower()
                    base = 5 if is_rate_limit else 1
                    delay = min(base * (2 ** attempt), 30)  # cap at 30s
                    logger.warning(
                        "LLM call failed (attempt %d/%d): %s — retrying in %ds",
                        attempt + 1,
                        max_retries,
                        exc,
                        delay,
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.error(
                        "LLM call failed after %d attempts: %s", max_retries, exc
                    )
        raise RuntimeError(
            f"LLM call failed after {max_retries} retries"
        ) from last_exc


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


class ProviderFactory:
    """Instantiate the correct LLM adapter from an :class:`AgentConfig`."""

    @staticmethod
    def create(config: AgentConfig) -> LLMProvider:
        """Return an :class:`LLMProvider` for *config.provider*.

        Imports are deferred so that unused SDKs don't need to be installed.
        """
        match config.provider:
            case "anthropic":
                from botc.llm.anthropic_adapter import AnthropicProvider

                return AnthropicProvider(config)
            case "openai":
                from botc.llm.openai_adapter import OpenAIProvider

                return OpenAIProvider(config)
            case "openrouter":
                from botc.llm.openai_adapter import OpenAIProvider

                return OpenAIProvider(config, base_url="https://openrouter.ai/api/v1")
            case "google":
                from botc.llm.google_adapter import GoogleProvider

                return GoogleProvider(config)
            case _:
                raise ValueError(
                    f"Unknown provider {config.provider!r}. "
                    "Must be 'anthropic', 'openai', 'openrouter', or 'google'."
                )
