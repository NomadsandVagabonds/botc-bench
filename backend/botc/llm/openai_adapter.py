"""OpenAI (GPT) adapter for the LLM abstraction layer."""

from __future__ import annotations

import logging
import time

import httpx
import openai

from botc.llm.provider import AgentConfig, LLMProvider, LLMResponse

log = logging.getLogger(__name__)

# OpenRouter thinking models that need inflated max_tokens for reasoning
_OPENROUTER_THINKING_KEYWORDS = ("qwen3", "kimi-k2", "deepseek-r1")


class OpenAIProvider(LLMProvider):
    """Wraps the ``openai`` SDK's async chat completions API."""

    def __init__(self, config: AgentConfig, base_url: str | None = None) -> None:
        super().__init__(config)
        extra_kwargs: dict = {}
        if base_url:
            extra_kwargs["base_url"] = base_url
            # OpenRouter requests can be slow; set a 120s timeout
            if "openrouter" in base_url:
                extra_kwargs["timeout"] = httpx.Timeout(120.0)
        self._client = openai.AsyncOpenAI(
            api_key=config.api_key,
            **extra_kwargs,
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

        # Process messages: strip custom cache markers, keep content blocks.
        # OpenAI/OpenRouter auto-cache long prefixes; structuring shared
        # content first maximises automatic cache hits.
        processed = []
        for msg in messages:
            content = msg["content"]
            if isinstance(content, list):
                blocks = [{"type": b["type"], "text": b["text"]} for b in content]
                processed.append({"role": msg["role"], "content": blocks})
            else:
                processed.append(msg)

        # Prepend system prompt as the first message.
        full_messages = [{"role": "system", "content": system_prompt}] + processed

        # o-series models (o1, o3, o4) and gpt-5 require max_completion_tokens
        # instead of max_tokens, and don't support temperature.
        # Strip provider prefix for OpenRouter models (e.g. "openai/gpt-5-nano" → "gpt-5-nano")
        model_lower = self.config.model.lower()
        model_base = model_lower.rsplit("/", 1)[-1] if "/" in model_lower else model_lower
        is_reasoning_model = any(
            model_base.startswith(p) for p in ("o1", "o3", "o4", "gpt-5")
        )

        # OpenRouter: only inflate max_tokens for thinking models
        is_openrouter = "openrouter" in (self._client.base_url.host or "")
        if is_openrouter and not is_reasoning_model:
            is_thinking_or = any(k in model_lower for k in _OPENROUTER_THINKING_KEYWORDS)
            if is_thinking_or:
                effective_max = max(max_tokens, 10240 + 2048)
            else:
                effective_max = max_tokens  # Llama, Gemma, Mistral — no thinking overhead

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
        elif is_openrouter and not is_reasoning_model:
            # Use the OpenRouter-adjusted effective_max computed above
            response = await self._client.chat.completions.create(
                model=self.config.model,
                messages=full_messages,
                temperature=temperature,
                max_tokens=effective_max,
            )
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

        # Log response time for OpenRouter diagnostics
        if is_openrouter:
            reasoning_tokens = getattr(usage, "reasoning_tokens", 0) if usage else 0
            log.info(
                "OpenRouter %s: %.1fs, %d reasoning tokens",
                self.config.model, latency_ms / 1000, reasoning_tokens,
            )

        return LLMResponse(
            content=choice.message.content or "",
            model=response.model,
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
            latency_ms=latency_ms,
        )
