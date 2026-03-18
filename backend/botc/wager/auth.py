"""Lightweight auth: display name claim + UUID token.

Token is passed via ``X-Wager-Token`` header.  No OAuth, no passwords.
"""

from __future__ import annotations

from typing import Any

from fastapi import Header, HTTPException

from . import db


async def require_user(x_wager_token: str = Header(...)) -> dict[str, Any]:
    """FastAPI dependency — resolve the token to a user dict or 401."""
    user = await db.get_user_by_token(x_wager_token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or missing wager token")
    return user
