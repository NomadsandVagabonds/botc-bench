"""Google (Gemini) adapter for the LLM abstraction layer."""

from __future__ import annotations

import logging
import time

from google import genai
from google.genai import types

from botc.llm.provider import AgentConfig, LLMProvider, LLMResponse

logger = logging.getLogger(__name__)


class GoogleProvider(LLMProvider):
    """Wraps the ``google-genai`` SDK's async generate_content API."""

    def __init__(self, config: AgentConfig) -> None:
        super().__init__(config)
        self._client = genai.Client(api_key=config.api_key)

    async def complete(
        self,
        system_prompt: str,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> LLMResponse:
        start = time.perf_counter()

        # Convert the message list into google-genai Content objects.
        contents: list[types.Content] = []
        for msg in messages:
            role = "model" if msg["role"] == "assistant" else "user"
            contents.append(
                types.Content(
                    role=role,
                    parts=[types.Part.from_text(text=msg["content"])],
                )
            )

        # Gemini 2.5 models (Pro and Flash) are thinking models — they use a
        # large portion of the token budget for internal reasoning before
        # producing visible output. We need a much higher ceiling (8K+) to
        # ensure actual content comes through.
        is_thinking_model = "2.5-pro" in self.config.model or "2.5-flash" in self.config.model or "3.1-pro" in self.config.model
        effective_max = max(max_tokens, 8192) if is_thinking_model else max_tokens

        config_kwargs: dict = {
            "system_instruction": system_prompt,
            "max_output_tokens": effective_max,
        }
        if not is_thinking_model:
            config_kwargs["temperature"] = temperature

        response = await self._client.aio.models.generate_content(
            model=self.config.model,
            contents=contents,
            config=types.GenerateContentConfig(**config_kwargs),
        )

        latency_ms = (time.perf_counter() - start) * 1000

        # Extract text — thinking models may have None text if token budget
        # was consumed by reasoning. Fall back to checking parts directly.
        content = response.text or ""
        if not content and response.candidates:
            candidate = response.candidates[0]
            if candidate.content and candidate.content.parts:
                for part in candidate.content.parts:
                    if hasattr(part, 'text') and part.text and not getattr(part, 'thought', False):
                        content += part.text
            if not content:
                finish = getattr(candidate, 'finish_reason', 'unknown')
                logger.warning(
                    "Gemini %s returned empty content (finish_reason=%s, max_tokens=%d)",
                    self.config.model, finish, effective_max,
                )

        # Token counts from usage metadata.
        usage = response.usage_metadata
        input_tokens = usage.prompt_token_count if usage else 0
        output_tokens = usage.candidates_token_count if usage else 0

        return LLMResponse(
            content=content,
            model=self.config.model,
            input_tokens=input_tokens or 0,
            output_tokens=output_tokens or 0,
            latency_ms=latency_ms,
        )
