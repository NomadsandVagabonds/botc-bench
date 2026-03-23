"""Anthropic (Claude) adapter for the LLM abstraction layer."""

from __future__ import annotations

import time

import anthropic

from botc.llm.provider import AgentConfig, LLMProvider, LLMResponse


class AnthropicProvider(LLMProvider):
    """Wraps the ``anthropic`` SDK's async messages API."""

    def __init__(self, config: AgentConfig) -> None:
        super().__init__(config)
        self._client = anthropic.AsyncAnthropic(api_key=config.api_key)

    # Map our unified effort levels to Anthropic thinking budget tokens.
    # Anthropic extended thinking uses budget_tokens (0 = disabled).
    _EFFORT_TO_BUDGET = {
        "low": 1024,
        "medium": 4096,
        "high": 10240,
    }

    async def complete(
        self,
        system_prompt: str,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 1024,
        reasoning_effort: str | None = None,
    ) -> LLMResponse:
        start = time.perf_counter()

        # Process messages: translate content-block cache markers into
        # Anthropic's cache_control format.  This lets the shared context
        # prefix (game state, recent messages, phase instructions) be
        # cached across parallel agent calls in the same phase.
        processed_messages = []
        for msg in messages:
            content = msg["content"]
            if isinstance(content, list):
                blocks = []
                for block in content:
                    b: dict = {"type": block["type"], "text": block["text"]}
                    if block.get("cache"):
                        b["cache_control"] = {"type": "ephemeral"}
                    blocks.append(b)
                processed_messages.append({"role": msg["role"], "content": blocks})
            else:
                processed_messages.append(msg)

        kwargs: dict = {
            "model": self.config.model,
            "max_tokens": max_tokens,
            "system": [{
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }],
            "messages": processed_messages,
        }

        # Extended thinking models (Sonnet 4+, Opus 4+) support a thinking budget.
        # Non-thinking models just get temperature.
        is_thinking = any(
            k in self.config.model.lower()
            for k in ("sonnet-4", "opus-4")
        )
        if is_thinking and reasoning_effort:
            budget = self._EFFORT_TO_BUDGET.get(reasoning_effort)
            if budget:
                kwargs["thinking"] = {"type": "enabled", "budget_tokens": budget}
                # Thinking models need higher max_tokens to fit thinking + output
                kwargs["max_tokens"] = max(max_tokens, budget + 2048)
        else:
            kwargs["temperature"] = temperature

        response = await self._client.messages.create(**kwargs)

        latency_ms = (time.perf_counter() - start) * 1000

        # Extract text from the response content blocks.
        content = "".join(
            block.text for block in response.content if block.type == "text"
        )

        return LLMResponse(
            content=content,
            model=response.model,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            latency_ms=latency_ms,
        )
