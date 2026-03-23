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
        reasoning_effort: str | None = None,
    ) -> LLMResponse:
        start = time.perf_counter()

        # Convert the message list into google-genai Content objects.
        # Content may be a plain string or an array of content blocks
        # (used for prompt caching on other providers) — flatten to text.
        contents: list[types.Content] = []
        for msg in messages:
            role = "model" if msg["role"] == "assistant" else "user"
            content = msg["content"]
            if isinstance(content, list):
                text = "\n\n".join(block["text"] for block in content)
            else:
                text = content
            contents.append(
                types.Content(
                    role=role,
                    parts=[types.Part.from_text(text=text)],
                )
            )

        # Gemini 2.5+ and 3.x models are thinking models — they use a
        # large portion of the token budget for internal reasoning.
        model_lower = self.config.model.lower()
        is_thinking_model = any(
            k in model_lower for k in ("2.5-pro", "2.5-flash", "3.0", "3.1", "3-flash", "3-pro")
        )
        effective_max = max(max_tokens, 32768) if is_thinking_model else max_tokens

        config_kwargs: dict = {
            "system_instruction": system_prompt,
            "max_output_tokens": effective_max,
        }
        if not is_thinking_model:
            config_kwargs["temperature"] = temperature

        # Map reasoning effort to Gemini thinking config
        if is_thinking_model and reasoning_effort:
            # Gemini 3.x uses thinking_level; 2.5 uses thinking_budget
            is_gemini3 = any(k in model_lower for k in ("3.0", "3.1", "3-flash", "3-pro"))
            if is_gemini3:
                level_map = {"low": "LOW", "medium": "MEDIUM", "high": "HIGH"}
                level = level_map.get(reasoning_effort)
                if level:
                    config_kwargs["thinking_config"] = types.ThinkingConfig(
                        thinking_level=level,
                    )
            else:
                # Gemini 2.5: thinking_budget in tokens
                budget_map = {"low": 1024, "medium": 4096, "high": 16384}
                budget = budget_map.get(reasoning_effort)
                if budget:
                    config_kwargs["thinking_config"] = types.ThinkingConfig(
                        thinking_budget=budget,
                    )

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
