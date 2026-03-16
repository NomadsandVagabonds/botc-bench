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

    async def complete(
        self,
        system_prompt: str,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> LLMResponse:
        start = time.perf_counter()

        response = await self._client.messages.create(
            model=self.config.model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt,
            messages=messages,
        )

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
