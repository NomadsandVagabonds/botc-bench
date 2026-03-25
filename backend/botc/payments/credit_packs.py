"""Credit pack definitions for Stripe purchases."""

from __future__ import annotations

CREDIT_PACKS = [
    {"id": "pack_5", "credits": 5.0, "price_usd": 5.00, "label": "$5 — 5 credits"},
    {"id": "pack_10", "credits": 10.0, "price_usd": 10.00, "label": "$10 — 10 credits"},
    {"id": "pack_20", "credits": 20.0, "price_usd": 20.00, "label": "$20 — 20 credits"},
]


def get_pack(pack_id: str) -> dict | None:
    """Look up a credit pack by ID."""
    return next((p for p in CREDIT_PACKS if p["id"] == pack_id), None)
