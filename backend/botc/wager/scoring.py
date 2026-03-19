"""Prediction market mechanics using CPMM with mint-and-sell.

Each question is a binary market. Users buy YES or NO shares.
Shares pay 1 Crown each if correct, 0 if wrong.

Uses Manifold-style mint-and-sell:
1. User pays N Crowns → mints N YES + N NO shares
2. Sells the unwanted side back to the CPMM pool
3. Keeps the wanted side (minted + received from pool)

This guarantees you always get >= N shares for N Crowns,
and contrarian bets pay significantly more than consensus bets.
"""

from __future__ import annotations

from dataclasses import dataclass

# Initial liquidity per market (funded by "The Crown").
# Higher = more stable prices. 100 means ~20C of betting moves price ~15%.
DEFAULT_LIQUIDITY = 100


@dataclass
class Market:
    """Binary prediction market with CPMM (constant product)."""
    market_id: str
    yes_pool: float
    no_pool: float

    @property
    def k(self) -> float:
        return self.yes_pool * self.no_pool

    @property
    def prob_yes(self) -> float:
        """Implied probability of YES outcome."""
        total = self.yes_pool + self.no_pool
        return self.no_pool / total if total > 0 else 0.5

    @property
    def prob_no(self) -> float:
        return 1.0 - self.prob_yes

    def buy_yes(self, amount: float) -> float:
        """Buy YES shares for `amount` Crowns via mint-and-sell.

        1. Mint `amount` YES + `amount` NO (costs `amount` Crowns)
        2. Sell `amount` NO to pool via CPMM swap
        3. Return total YES shares (minted + received from swap)
        """
        if amount <= 0:
            return 0.0
        # Swap: sell `amount` NO to pool → receive YES from pool
        # CPMM: yes_out = yes_pool * amount / (no_pool + amount)
        yes_from_pool = self.yes_pool * amount / (self.no_pool + amount)
        # Update pools
        self.yes_pool -= yes_from_pool
        self.no_pool += amount
        # Total: minted YES + swapped YES
        return amount + yes_from_pool

    def buy_no(self, amount: float) -> float:
        """Buy NO shares for `amount` Crowns via mint-and-sell."""
        if amount <= 0:
            return 0.0
        no_from_pool = self.no_pool * amount / (self.yes_pool + amount)
        self.no_pool -= no_from_pool
        self.yes_pool += amount
        return amount + no_from_pool

    def quote_yes(self, amount: float) -> float:
        """Preview YES shares for `amount` Crowns (no state change)."""
        if amount <= 0:
            return 0.0
        return amount + self.yes_pool * amount / (self.no_pool + amount)

    def quote_no(self, amount: float) -> float:
        """Preview NO shares for `amount` Crowns (no state change)."""
        if amount <= 0:
            return 0.0
        return amount + self.no_pool * amount / (self.yes_pool + amount)

    def sell_yes(self, shares: float) -> float:
        """Sell YES shares back to pool. Returns Crowns received.

        Reverse of buy: sell YES shares to pool, receive Crowns.
        Pool absorbs YES shares, gives back NO shares which are
        redeemed as Crowns (burn matched YES+NO → Crowns).
        """
        if shares <= 0 or shares >= self.yes_pool + shares:
            return 0.0
        # Swap: add YES shares to pool, get NO shares out
        no_out = self.no_pool * shares / (self.yes_pool + shares)
        self.yes_pool += shares
        self.no_pool -= no_out
        # Burn matched pairs: min(shares_returned, no_out) pairs → Crowns
        # The user had YES shares, got NO shares from pool.
        # Redeem min(shares, no_out) matched pairs as Crowns.
        crowns_out = min(shares, no_out)
        return crowns_out

    def sell_no(self, shares: float) -> float:
        """Sell NO shares back to pool. Returns Crowns received."""
        if shares <= 0 or shares >= self.no_pool + shares:
            return 0.0
        yes_out = self.yes_pool * shares / (self.no_pool + shares)
        self.no_pool += shares
        self.yes_pool -= yes_out
        crowns_out = min(shares, yes_out)
        return crowns_out

    def quote_sell_yes(self, shares: float) -> float:
        """Preview selling YES shares (no state change)."""
        if shares <= 0:
            return 0.0
        no_out = self.no_pool * shares / (self.yes_pool + shares)
        return min(shares, no_out)

    def quote_sell_no(self, shares: float) -> float:
        """Preview selling NO shares (no state change)."""
        if shares <= 0:
            return 0.0
        yes_out = self.yes_pool * shares / (self.no_pool + shares)
        return min(shares, yes_out)

    def payout_per_share(self) -> float:
        return 1.0

    def to_dict(self) -> dict:
        return {
            "market_id": self.market_id,
            "yes_pool": round(self.yes_pool, 2),
            "no_pool": round(self.no_pool, 2),
            "prob_yes": round(self.prob_yes, 4),
            "prob_no": round(self.prob_no, 4),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Market":
        return cls(
            market_id=d["market_id"],
            yes_pool=d["yes_pool"],
            no_pool=d["no_pool"],
        )


# ── Market Factory ──────────────────────────────────────────────────

def create_alignment_market(seat: int, total_players: int) -> Market:
    """Create 'Seat X is evil' market with prior from BotC role distribution.

    In a 10-player TB game: 3 evil / 7 good → starts at P(evil) = 30%.
    """
    num_evil = _estimate_evil(total_players)
    p_evil = num_evil / max(total_players, 1)
    L = DEFAULT_LIQUIDITY
    # prob_yes = no_pool / (yes_pool + no_pool)
    # Set yes_pool = L, solve for no_pool:
    # p = no / (L + no) → no = L * p / (1 - p)
    yes_pool = L
    no_pool = L * p_evil / (1 - p_evil) if p_evil < 1 else L
    return Market(
        market_id=f"alignment_seat_{seat}",
        yes_pool=yes_pool,
        no_pool=no_pool,
    )


def create_winner_market() -> Market:
    """Create 'Will evil win?' market starting at ~45%."""
    L = DEFAULT_LIQUIDITY
    p_evil_wins = 0.45
    yes_pool = L
    no_pool = L * p_evil_wins / (1 - p_evil_wins)
    return Market(
        market_id="winner_evil",
        yes_pool=yes_pool,
        no_pool=no_pool,
    )


def create_game_markets(total_players: int) -> dict[str, Market]:
    """Create all markets for a game."""
    markets: dict[str, Market] = {}
    for seat in range(total_players):
        m = create_alignment_market(seat, total_players)
        markets[m.market_id] = m
    m = create_winner_market()
    markets[m.market_id] = m
    return markets


def _estimate_evil(total_players: int) -> int:
    if total_players <= 6:
        return 2
    elif total_players <= 9:
        return 3
    elif total_players <= 12:
        return 3
    else:
        return 4
