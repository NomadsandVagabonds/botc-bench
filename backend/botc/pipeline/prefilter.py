"""Cheap heuristic pre-filter to skip turns with no factual claims.

Zero LLM cost — pure regex/string matching.  Conservative: only
skips when very confident there are no claims.
"""

from __future__ import annotations

import re

# Patterns that indicate a turn with no claims
_PASS_PATTERNS = frozenset({
    "{pass}",
    "pass",
    "{nominate: pass}",
})

_AGREEMENT_PATTERNS = re.compile(
    r"^("
    r"i agree\.?"
    r"|agreed\.?"
    r"|exactly\.?"
    r"|indeed\.?"
    r"|that'?s? (?:right|true|fair|correct|a good point)\.?"
    r"|well said\.?"
    r"|i(?:'m| am) with you\.?"
    r"|interesting\.?"
    r"|hmm+\.?"
    r"|thank(?:s| you)\.?"
    r"|good point\.?"
    r"|let'?s? (?:discuss|think about|consider|move on)\.?"
    r"|i see\.?"
    r")$",
    re.IGNORECASE,
)

# Keywords that strongly suggest a factual claim
_ROLE_CLAIM_KEYWORDS = re.compile(
    r"(?:"
    r"i(?:'m| am) (?:the |a )?\w+"
    r"|my (?:role|info|information|ability|reading)"
    r"|i (?:learned|saw|received|got|know|found out)"
    r"|i was (?:told|shown|given)"
    r"|last night (?:i|my)"
    r"|one of .+ (?:is|are) (?:the |a )?\w+"
    r"|seat \d+ is"
    r"|(?:washerwoman|librarian|investigator|chef|empath|fortune.?teller|"
    r"undertaker|monk|ravenkeeper|slayer|soldier|mayor|butler|drunk|recluse|"
    r"saint|poisoner|spy|scarlet.?woman|baron|imp)"
    r")",
    re.IGNORECASE,
)

_ACCUSATION_KEYWORDS = re.compile(
    r"(?:"
    r"(?:is|are) (?:the |)(?:demon|imp|evil|minion|poisoner|spy|baron|scarlet)"
    r"|suspicious"
    r"|lying"
    r"|can'?t (?:be |)trust"
    r"|i (?:think|believe|suspect) .+ (?:is|are) (?:evil|the demon|lying)"
    r"|we should (?:nominate|execute|vote)"
    r")",
    re.IGNORECASE,
)


def is_claimless(say_text: str) -> bool:
    """Return True if the turn almost certainly contains no factual claims.

    Conservative: returns True only when very confident.  False negatives
    (letting a claimless turn through) are much cheaper than false positives
    (accidentally skipping a turn with real claims).
    """
    text = say_text.strip()

    # Empty or pass
    if not text or text.lower() in _PASS_PATTERNS:
        return True

    # Very short reactions
    if len(text) < 15:
        return True

    # Pure agreement patterns
    if _AGREEMENT_PATTERNS.match(text):
        return True

    return False


def estimate_claim_density(say_text: str) -> str:
    """Classify a turn's expected claim density.

    Returns
    -------
    "high"
        Contains explicit role claims, info sharing, or direct assertions.
    "medium"
        Contains accusations, suspicions, or strategic discussion that
        may embed implicit claims.
    "low"
        Social/reactive content with no obvious claims.
    """
    text = say_text.strip()

    if not text:
        return "low"

    if _ROLE_CLAIM_KEYWORDS.search(text):
        return "high"

    if _ACCUSATION_KEYWORDS.search(text):
        return "medium"

    return "low"
