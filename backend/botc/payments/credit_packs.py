"""Credit pack definitions for Stripe purchases."""

from __future__ import annotations

CREDIT_PACKS = [
    {"id": "pack_5", "credits": 5.0, "price_usd": 5.00, "label": "$5 — 5 credits"},
    {"id": "pack_12", "credits": 12.0, "price_usd": 10.00, "label": "$10 — 12 credits"},
    {"id": "pack_28", "credits": 28.0, "price_usd": 20.00, "label": "$20 — 28 credits"},
]


def get_pack(pack_id: str) -> dict | None:
    """Look up a credit pack by ID."""
    return next((p for p in CREDIT_PACKS if p["id"] == pack_id), None)
