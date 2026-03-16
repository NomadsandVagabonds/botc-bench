"""Voice bank configuration for ElevenLabs TTS.

Maps characters to voices based on alignment, role type, and gender.
Gender is inferred from the medieval name bank.
"""

from __future__ import annotations

# ── Voice pools by tag ──────────────────────────────────────────────

# Voices categorized by: (alignment, gender)
# Demon gets a special super-dramatic voice pool
VOICE_POOLS = {
    "demon_male": [
        "cPoqAvGWCPfCfyPMwe4z",  # demon voice
        "Tj9l48J9AJbry5yCP5eW",  # dracula-ish
    ],
    "demon_female": [
        "sssn4wp3AspuK2kvy3Ym",  # female evil
    ],
    "evil_male": [
        "Tj9l48J9AJbry5yCP5eW",  # dracula-ish
        "1KFdM0QCwQn4rmn5nn9C",  # evil 3
        "ttNi9wVM8M97tsxE7PFZ",  # minion
    ],
    "evil_female": [
        "sssn4wp3AspuK2kvy3Ym",  # female evil
    ],
    "good_male": [
        "HAvvFKatz0uu0Fv55Riy",  # townsfolk 1
        "6VgigPFWF0sNZy1BthVg",  # male 2
        "lKMAeQD7Brvj7QCWByqK",  # tom hardy brit
        "wo6udizrrtpIxWGp2qJk",  # northern accent
        "NXaTw4ifg0LAguvKuIwZ",  # sultry male
        "KTAbPR4QFlhaTpde6md8",  # townsfolk 2
        "NwyAvGnfbFoNNEi4UuTq",  # townsfolk 3
        "0lp4RIz96WD1RUtvEu3Q",  # old male
        "ouL9IsyrSnUkCmfnD02u",  # gnome
    ],
    "good_female": [
        "7NsaqHdLuKNFvEfjpUno",  # female 2
        "nDJIICjR9zfJExIFeSCN",  # female 3
        "si0svtk05vPEuvwAW93c",  # female 4
        "aAsWcN5jdLdiYG7Hq0YL",  # female 5
        "USEQXnsXRJlw2k9LUzG4",  # female 6
    ],
    "narrator": [
        "JoYo65swyP8hH6fVMeTO",
    ],
    "tavernkeeper": [
        "4C3WlGZL5zSIEfpS3GRQ",
    ],
}

# ── Gender inference from medieval names ─────────────────────────────

# Common feminine medieval name endings/patterns
_FEMININE_NAMES = {
    "Astrid", "Aveline", "Beatrix", "Branwen", "Briar", "Cedany",
    "Celestine", "Colette", "Cordelia", "Daphne", "Elowen", "Elspeth",
    "Ember", "Enid", "Esmé", "Esme", "Eudora", "Evangeline",
    "Fiora", "Freya", "Giselle", "Gwendolyn", "Helga", "Hildegard",
    "Ingrid", "Isolde", "Ivy", "Jessamine", "Juno", "Lilith",
    "Linnea", "Lucinda", "Mabel", "Margery", "Marigold", "Mildred",
    "Minerva", "Mirabel", "Nerys", "Odette", "Ophelia",
    "Petra", "Primrose", "Ragnild", "Rosalind", "Rowena", "Sable",
    "Sabine", "Seraphina", "Sigrid", "Solveig", "Sybil",
    "Thalassa", "Thora", "Ursula", "Vivienne", "Winifred", "Ysolde",
}

# If not in feminine set, check common endings
_FEMININE_ENDINGS = ("a", "e", "ine", "wen", "rid", "hild", "ild")


def infer_gender(name: str) -> str:
    """Infer gender from a medieval name. Returns 'male' or 'female'."""
    if name in _FEMININE_NAMES:
        return "female"
    # Check endings as fallback
    lower = name.lower()
    if lower.endswith(("ine", "elle", "ette", "ilda", "wen", "eig")):
        return "female"
    return "male"


def assign_voice(
    character_name: str,
    alignment: str,
    role_type: str,
    used_voices: set[str],
    rng=None,
) -> str:
    """Pick a voice ID for a character based on alignment, role, and gender.

    Avoids reusing voices already assigned in this game.
    """
    import random
    if rng is None:
        rng = random

    gender = infer_gender(character_name)
    is_demon = role_type == "demon"

    # Pick the right pool
    if is_demon:
        pool_key = f"demon_{gender}"
    elif alignment == "evil":
        pool_key = f"evil_{gender}"
    else:
        pool_key = f"good_{gender}"

    pool = VOICE_POOLS.get(pool_key, [])
    # Filter out already-used voices
    available = [v for v in pool if v not in used_voices]

    # Fallback: expand to any same-gender pool
    if not available:
        all_gendered = []
        for key, voices in VOICE_POOLS.items():
            if gender in key and key not in ("narrator", "tavernkeeper"):
                all_gendered.extend(voices)
        available = [v for v in all_gendered if v not in used_voices]

    # Last resort: any voice not used
    if not available:
        all_voices = [v for pool in VOICE_POOLS.values() for v in pool if v not in used_voices]
        available = all_voices or [VOICE_POOLS["narrator"][0]]

    return rng.choice(available)


def get_narrator_voice() -> str:
    """Return the narrator voice ID."""
    return VOICE_POOLS["narrator"][0]
