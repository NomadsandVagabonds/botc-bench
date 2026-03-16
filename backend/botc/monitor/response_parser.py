"""Parse the monitor agent's XML-tagged responses."""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)


def parse_monitor_response(raw: str) -> dict:
    """Parse the monitor's XML response into structured data.

    Extracts:
    - ``analysis``: text inside ``<ANALYSIS>...</ANALYSIS>``
    - ``ratings``: dict of ``{seat_number: float}`` from ``<RATINGS>``
    - ``bets``: list of seat numbers from ``LOCK_IN`` lines in ``<BETS>``

    Tolerant of formatting variations — extra whitespace, mixed case tags,
    missing sections, etc.

    Returns
    -------
    dict
        ``{"analysis": str, "ratings": dict[int, float], "bets": list[int]}``
    """
    analysis = _extract_section(raw, "ANALYSIS")
    ratings = _parse_ratings(_extract_section(raw, "RATINGS"))
    bets = _parse_bets(_extract_section(raw, "BETS"))

    return {
        "analysis": analysis,
        "ratings": ratings,
        "bets": bets,
    }


def _extract_section(text: str, tag: str) -> str:
    """Extract content between ``<TAG>`` and ``</TAG>``, case-insensitive."""
    pattern = re.compile(
        rf"<{tag}>(.*?)</{tag}>",
        re.DOTALL | re.IGNORECASE,
    )
    match = pattern.search(text)
    if match:
        return match.group(1).strip()
    return ""


def _parse_ratings(block: str) -> dict[int, float]:
    """Parse rating lines like ``seat_0: 15`` or ``seat_5: 80.5``.

    Tolerant of:
    - Extra whitespace
    - ``seat_N`` or ``seat N`` or ``Seat N`` or just the number
    - Colons, equals signs, or dashes as separators
    - Trailing comments or text after the number
    """
    ratings: dict[int, float] = {}
    if not block:
        return ratings

    # Match patterns like "seat_0: 15", "seat 0 = 15", "0: 15"
    pattern = re.compile(
        r"(?:seat[_\s]?)(\d+)\s*[:=\-]\s*(\d+(?:\.\d+)?)",
        re.IGNORECASE,
    )
    for match in pattern.finditer(block):
        seat = int(match.group(1))
        rating = float(match.group(2))
        # Clamp to 0-100
        rating = max(0.0, min(100.0, rating))
        ratings[seat] = rating

    if not ratings:
        logger.warning("Failed to parse any ratings from block: %s", block[:200])

    return ratings


def _parse_bets(block: str) -> list[int]:
    """Parse LOCK_IN lines like ``LOCK_IN: seat_N`` or ``LOCK_IN: seat N``.

    Tolerant of:
    - ``LOCK_IN: seat_5``, ``LOCK_IN seat 5``, ``lock_in: 5``
    - Multiple LOCK_IN lines
    """
    bets: list[int] = []
    if not block:
        return bets

    pattern = re.compile(
        r"LOCK_IN\s*:?\s*(?:seat[_\s]?)(\d+)",
        re.IGNORECASE,
    )
    for match in pattern.finditer(block):
        seat = int(match.group(1))
        if seat not in bets:
            bets.append(seat)

    return bets
