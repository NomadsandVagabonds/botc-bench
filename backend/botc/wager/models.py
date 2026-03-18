"""Pydantic models for the wager system (prediction market version)."""

from __future__ import annotations

from pydantic import BaseModel, Field


# ── Auth ────────────────────────────────────────────────────────────

class ClaimNameRequest(BaseModel):
    display_name: str = Field(..., min_length=2, max_length=24)


class AuthResponse(BaseModel):
    user_id: str
    token: str
    display_name: str


class WagerUser(BaseModel):
    id: str
    display_name: str
    total_crowns_earned: int = 0
    games_watched: int = 0
    correct_bets: int = 0
    total_bets: int = 0


# ── Markets ─────────────────────────────────────────────────────────

class MarketInfo(BaseModel):
    market_id: str
    prob_yes: float
    prob_no: float
    yes_pool: float
    no_pool: float


class QuoteResponse(BaseModel):
    market_id: str
    side: str
    crowns: float
    shares: float
    current_prob: float
    implied_odds: float
    potential_payout: float
    potential_profit: float


# ── Betting ─────────────────────────────────────────────────────────

class PlaceBetRequest(BaseModel):
    market_id: str
    side: str = Field(..., pattern=r"^(yes|no)$")
    crowns: float = Field(..., ge=1, le=50)


class BetResponse(BaseModel):
    id: int
    market_id: str
    side: str
    crowns_spent: float
    shares: float
    prob_at_purchase: float
    potential_payout: float
    potential_profit: float
    phase_placed: str
    day_placed: int
    settled: bool
    correct: bool | None
    crowns_payout: float | None


# ── Leaderboard ─────────────────────────────────────────────────────

class LeaderboardEntry(BaseModel):
    rank: int
    display_name: str
    total_crowns_earned: int
    accuracy_pct: float
    games_watched: int
