"""Stripe Checkout integration for BloodBench game purchases.

Uses Stripe's hosted Checkout — we never touch card data.
Users pay upfront with a buffer; games run on server API keys.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import stripe
from stripe import SignatureVerificationError

logger = logging.getLogger(__name__)


def _get_stripe_key() -> str:
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not key:
        raise RuntimeError("STRIPE_SECRET_KEY not set in environment")
    return key


def _get_base_url() -> str:
    return os.environ.get("BLOODBENCH_BASE_URL", "https://bloodbench.com")


async def create_checkout_session(
    game_config: dict[str, Any],
    charge_amount: float,
    estimated_cost: float,
    item_type: str = "game",
) -> dict:
    """Create a Stripe Checkout Session.

    Returns {url, session_id} — redirect user to url to complete payment.
    """
    stripe.api_key = _get_stripe_key()
    base_url = _get_base_url()

    num_players = game_config.get("num_players", "?")

    if item_type == "game":
        product_name = f"BloodBench Game ({num_players}p)"
        product_desc = "AI agents playing Blood on the Clocktower"
        success_path = "/payment/success?session_id={CHECKOUT_SESSION_ID}"
        cancel_path = "/"
    else:
        product_name = "BloodBench Monitor Run"
        product_desc = "AI monitor analysis of a completed game"
        success_path = "/payment/success?session_id={CHECKOUT_SESSION_ID}&type=monitor"
        cancel_path = "/"

    # Stripe amounts are in cents
    amount_cents = int(round(charge_amount * 100))
    if amount_cents < 50:
        amount_cents = 50  # Stripe minimum

    session = stripe.checkout.Session.create(
        payment_method_types=["card"],
        line_items=[{
            "price_data": {
                "currency": "usd",
                "unit_amount": amount_cents,
                "product_data": {
                    "name": product_name,
                    "description": product_desc,
                },
            },
            "quantity": 1,
        }],
        mode="payment",
        success_url=f"{base_url}{success_path}",
        cancel_url=f"{base_url}{cancel_path}",
        metadata={
            "game_config": json.dumps(game_config),
            "type": item_type,
            "estimated_cost": str(estimated_cost),
            "charge_amount": str(charge_amount),
        },
    )

    logger.info(
        "Stripe checkout session %s created — $%.2f for %s",
        session.id, charge_amount, item_type,
    )

    return {
        "url": session.url,
        "session_id": session.id,
    }


def verify_webhook_signature(payload: bytes, sig_header: str) -> dict:
    """Verify and parse a Stripe webhook event.

    Returns the parsed event dict. Raises ValueError on invalid signature.
    """
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    if not webhook_secret:
        raise RuntimeError("STRIPE_WEBHOOK_SECRET not set")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
    except SignatureVerificationError as e:
        raise ValueError(f"Invalid Stripe signature: {e}")

    return event


async def issue_refund(
    payment_intent_id: str,
    amount: float | None = None,
    reason: str = "requested_by_customer",
) -> dict:
    """Issue a full or partial refund.

    If amount is None, refunds the full charge.
    Returns the Stripe Refund object as a dict.
    """
    stripe.api_key = _get_stripe_key()

    refund_params: dict[str, Any] = {
        "payment_intent": payment_intent_id,
        "reason": reason,
    }
    if amount is not None:
        refund_params["amount"] = int(round(amount * 100))

    refund = stripe.Refund.create(**refund_params)
    logger.info(
        "Refund %s issued for pi %s — $%.2f",
        refund.id, payment_intent_id, (refund.amount / 100),
    )
    return dict(refund)


def get_session(session_id: str) -> dict:
    """Retrieve a Checkout Session by ID."""
    stripe.api_key = _get_stripe_key()
    session = stripe.checkout.Session.retrieve(session_id)
    return dict(session)
