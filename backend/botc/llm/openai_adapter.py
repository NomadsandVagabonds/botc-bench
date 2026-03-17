"""OpenAI (GPT) adapter for the LLM abstraction layer."""

from __future__ import annotations

import time

import openai

from botc.llm.provider import AgentConfig, LLMProvider, LLMResponse


class OpenAIProvider(LLMProvider):
    """Wraps the ``openai`` SDK's async chat completions API."""

    def __init__(self, config: AgentConfig, base_url: str | None = None) -> None:
        super().__init__(config)
        self._client = openai.AsyncOpenAI(
            api_key=config.api_key,
            **({"base_url": base_url} if base_url else {}),
        )

    async def complete(
        self,
        system_prompt: str,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 1024,
        reasoning_effort: str | None = None,
    ) -> LLMResponse:
        start = time.perf_counter()

        # Prepend system prompt as the first message.
        full_messages = [{"role": "system", "content": system_prompt}] + messages

        # o-series models (o1, o3, o4) and gpt-5 require max_completion_tokens
        # instead of max_tokens, and don't support temperature.
        # Strip provider prefix for OpenRouter models (e.g. "openai/gpt-5-nano" → "gpt-5-nano")
        model_lower = self.config.model.lower()
        model_base = model_lower.rsplit("/", 1)[-1] if "/" in model_lower else model_lower
        is_reasoning_model = any(
            model_base.startswith(p) for p in ("o1", "o3", "o4", "gpt-5")
        )

        if is_reasoning_model:
            effective_max = max(max_tokens, 8192)
            kwargs: dict = {
                "model": self.config.model,
                "messages": full_messages,
                "max_completion_tokens": effective_max,
            }
            # OpenAI reasoning_effort: "low", "medium", "high" (default: "medium")
            if reasoning_effort:
                kwargs["reasoning_effort"] = reasoning_effort
            response = await self._client.chat.completions.create(**kwargs)
        else:
            response = await self._client.chat.completions.create(
                model=self.config.model,
                messages=full_messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )

        latency_ms = (time.perf_counter() - start) * 1000

        choice = response.choices[0]
        usage = response.usage

        return LLMResponse(
            content=choice.message.content or "",
            model=response.model,
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
            latency_ms=latency_ms,
        )
