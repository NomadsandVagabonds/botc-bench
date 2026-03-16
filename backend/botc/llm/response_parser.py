"""Parse XML-tagged agent responses into structured data."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable


# ---------------------------------------------------------------------------
# Action parsing
# ---------------------------------------------------------------------------

@dataclass
class ParsedAction:
    """A single game action extracted from an ``<ACTION>`` tag.

    Examples of raw action strings and how they parse:

    - ``{NOMINATE: 3}``  -> action_type="NOMINATE", target=3
    - ``{VOTE: YES}``    -> action_type="VOTE", value="YES"
    - ``{ASK: Is Player 2 evil?}`` -> action_type="ASK", value="Is Player 2 evil?"
    - ``{JUGGLE: 1=vortox, 4=witch}`` -> action_type="JUGGLE", value="1=vortox, 4=witch"
    - ``{NIGHT_TARGET_ROLE: 2: clockmaker}`` -> action_type="NIGHT_TARGET_ROLE", target=2, value="clockmaker"
    - ``{NIGHT_CHARACTER: oracle}`` -> action_type="NIGHT_CHARACTER", value="oracle"
    - ``{NIGHT_TARGET_THREE: 1, 4, 6}`` -> action_type="NIGHT_TARGET_THREE", value="1, 4, 6"
    - ``{JOIN: group_a}``-> action_type="JOIN", value="group_a"
    - ``{WHISPER: 5: hi}``-> action_type="WHISPER", target=5, value="hi"
    - ``{PASS}``          -> action_type="PASS"
    """

    action_type: str
    target: int | None = None
    value: str | None = None


# ---------------------------------------------------------------------------
# Full parsed response
# ---------------------------------------------------------------------------

@dataclass
class ParsedResponse:
    """The fully parsed output of an agent's LLM response."""

    think: str = ""
    say: str = ""
    actions: list[ParsedAction] = field(default_factory=list)
    memory: str = ""
    raw: str = ""


# ---------------------------------------------------------------------------
# Tag extraction helpers
# ---------------------------------------------------------------------------

_TAG_RE = re.compile(
    r"<(?P<tag>THINK|SAY|ACTION|MEMORY)>\s*(?P<body>.*?)\s*</(?P=tag)>",
    re.DOTALL,
)


def _extract_tag(text: str, tag: str) -> str:
    """Return the content of the *first* occurrence of ``<tag>...</tag>``."""
    pattern = re.compile(
        rf"<{tag}>\s*(?P<body>.*?)\s*</{tag}>",
        re.DOTALL,
    )
    m = pattern.search(text)
    return m.group("body").strip() if m else ""


def _extract_all_tag(text: str, tag: str) -> list[str]:
    """Return the content of *every* ``<tag>...</tag>`` occurrence."""
    pattern = re.compile(
        rf"<{tag}>\s*(?P<body>.*?)\s*</{tag}>",
        re.DOTALL,
    )
    return [m.group("body").strip() for m in pattern.finditer(text)]


# ---------------------------------------------------------------------------
# Action string parser
# ---------------------------------------------------------------------------

# Matches things like {NOMINATE: 3}, {VOTE: YES}, {WHISPER: 5: hello world}, {PASS}
_ACTION_RE = re.compile(
    r"\{\s*(?P<type>[A-Z_]+)"   # {TYPE
    r"(?:\s*:\s*(?P<rest>.*?))?"  # optional  : rest
    r"\s*\}",                     # }
    re.DOTALL,
)


def _parse_action_str(raw: str) -> ParsedAction:
    """Parse a single ``{TYPE: ...}`` string into a :class:`ParsedAction`."""
    m = _ACTION_RE.search(raw)
    if not m:
        # Fallback: treat the whole string as an unknown action.
        return ParsedAction(action_type="UNKNOWN", value=raw.strip())

    action_type = m.group("type")
    rest = (m.group("rest") or "").strip()

    if not rest:
        return ParsedAction(action_type=action_type)

    # WHISPER has a special format: {WHISPER: <seat>: <message>}
    if action_type == "WHISPER":
        parts = rest.split(":", maxsplit=1)
        target_str = parts[0].strip()
        msg = parts[1].strip() if len(parts) > 1 else ""
        try:
            return ParsedAction(action_type=action_type, target=int(target_str), value=msg)
        except ValueError:
            return ParsedAction(action_type=action_type, value=rest)

    # RECALL: the query is the whole rest string
    if action_type == "RECALL":
        return ParsedAction(action_type=action_type, value=rest)

    # NOMINATE and other seat-targeted actions.
    if action_type in ("NOMINATE", "SLAYER_SHOT", "NIGHT_TARGET"):
        try:
            return ParsedAction(action_type=action_type, target=int(rest))
        except ValueError:
            return ParsedAction(action_type=action_type, value=rest)

    # NIGHT_TARGET_ROLE: {NIGHT_TARGET_ROLE: 3: cerenovus} or {NIGHT_TARGET_ROLE: 3, cerenovus}
    if action_type == "NIGHT_TARGET_ROLE":
        split_char = ":" if ":" in rest else ","
        parts = rest.split(split_char, maxsplit=1)
        if len(parts) == 2:
            try:
                return ParsedAction(
                    action_type=action_type,
                    target=int(parts[0].strip()),
                    value=parts[1].strip(),
                )
            except ValueError:
                return ParsedAction(action_type=action_type, value=rest)
        return ParsedAction(action_type=action_type, value=rest)

    # NIGHT_TARGET_TWO: {NIGHT_TARGET_TWO: 3, 7}
    if action_type == "NIGHT_TARGET_TWO":
        return ParsedAction(action_type=action_type, value=rest)

    # NIGHT_TARGET_THREE: {NIGHT_TARGET_THREE: 1, 4, 6}
    if action_type == "NIGHT_TARGET_THREE":
        return ParsedAction(action_type=action_type, value=rest)

    # NIGHT_CHARACTER: {NIGHT_CHARACTER: role_id}
    if action_type == "NIGHT_CHARACTER":
        return ParsedAction(action_type=action_type, value=rest)

    # Everything else: VOTE, JOIN, etc. — just store value.
    return ParsedAction(action_type=action_type, value=rest)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def parse_response(raw: str) -> ParsedResponse:
    """Parse an agent's raw LLM output into a :class:`ParsedResponse`.

    The expected format uses XML tags:

    .. code-block:: text

        <THINK>Private reasoning visible only to this agent</THINK>
        <SAY>What the agent says aloud to the table</SAY>
        <ACTION>{VOTE: YES}</ACTION>
        <MEMORY>Notes for future turns</MEMORY>

    All tags are optional; missing tags produce empty strings / lists.
    Multiple ``<ACTION>`` blocks are allowed and each is parsed independently.
    """
    result = ParsedResponse(raw=raw)

    result.think = _extract_tag(raw, "THINK")
    result.say = _extract_tag(raw, "SAY")
    result.memory = _extract_tag(raw, "MEMORY")

    # Parse every <ACTION> block.
    action_strs = _extract_all_tag(raw, "ACTION")
    for a in action_strs:
        result.actions.append(_parse_action_str(a))

    return result


# ---------------------------------------------------------------------------
# Name-to-seat resolution
# ---------------------------------------------------------------------------


def resolve_names_to_seats(
    parsed: ParsedResponse,
    name_to_seat: dict[str, int],
) -> ParsedResponse:
    """Resolve character names to seat numbers in parsed actions.

    If an action's target is None but its value contains a character name,
    convert it to the seat number. Also handles WHISPER targets,
    NIGHT_TARGET_TWO, NOMINATE, SLAYER_SHOT, etc.

    The name_to_seat dict maps lowercased character names to seat numbers.
    """
    if not name_to_seat:
        return parsed

    def _try_resolve(text: str | None) -> int | None:
        """Try to match text to a seat number via name lookup."""
        if text is None:
            return None
        cleaned = text.strip().lower()
        # Direct match
        if cleaned in name_to_seat:
            return name_to_seat[cleaned]
        # Partial match — if the text starts with or contains a name
        for name, seat in name_to_seat.items():
            if name in cleaned or cleaned.startswith(name.split()[0]):
                return seat
        return None

    for action in parsed.actions:
        # Actions that take a single seat target
        if action.action_type in ("NOMINATE", "SLAYER_SHOT", "NIGHT_TARGET"):
            if action.target is None and action.value:
                resolved = _try_resolve(action.value)
                if resolved is not None:
                    action.target = resolved
                    action.value = None

        # WHISPER: target might be a name
        if action.action_type == "WHISPER":
            if action.target is None and action.value:
                # Try to parse "Name: message" format
                parts = action.value.split(":", maxsplit=1)
                resolved = _try_resolve(parts[0])
                if resolved is not None:
                    action.target = resolved
                    action.value = parts[1].strip() if len(parts) > 1 else ""

        # NIGHT_TARGET_TWO: value might be "Name1, Name2" instead of "3, 7"
        if action.action_type == "NIGHT_TARGET_TWO" and action.value:
            parts = [p.strip() for p in action.value.split(",")]
            if len(parts) == 2:
                r1 = _try_resolve(parts[0])
                r2 = _try_resolve(parts[1])
                if r1 is not None and r2 is not None:
                    action.value = f"{r1}, {r2}"

        # NIGHT_TARGET_ROLE: target might be a name
        if action.action_type == "NIGHT_TARGET_ROLE":
            if action.target is None and action.value:
                parts = action.value.split(":", maxsplit=1)
                if len(parts) < 2:
                    parts = action.value.split(",", maxsplit=1)
                if len(parts) == 2:
                    resolved = _try_resolve(parts[0])
                    if resolved is not None:
                        action.target = resolved
                        action.value = parts[1].strip()

    return parsed
