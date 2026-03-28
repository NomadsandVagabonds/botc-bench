"""SQLite database for the wager system.

Uses aiosqlite for async access.  DB file: ``backend/games/wager.db``.
Tables are created idempotently on first access.
"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

import hashlib

import aiosqlite

_DB_PATH = Path(__file__).parent.parent.parent / "games" / "wager.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    token TEXT NOT NULL UNIQUE,
    created_at REAL NOT NULL,
    total_crowns_earned INTEGER DEFAULT 0,
    games_watched INTEGER DEFAULT 0,
    correct_bets INTEGER DEFAULT 0,
    total_bets INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    game_id TEXT NOT NULL,
    crowns_budget INTEGER DEFAULT 100,
    crowns_won INTEGER DEFAULT 0,
    joined_at REAL NOT NULL,
    settled BOOLEAN DEFAULT FALSE,
    UNIQUE(user_id, game_id)
);

CREATE TABLE IF NOT EXISTS markets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    yes_pool REAL NOT NULL,
    no_pool REAL NOT NULL,
    created_at REAL NOT NULL,
    UNIQUE(game_id, market_id)
);

CREATE TABLE IF NOT EXISTS bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES game_sessions(id),
    user_id TEXT NOT NULL,
    game_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    side TEXT NOT NULL,              -- 'yes' or 'no'
    crowns_spent REAL NOT NULL,
    shares_acquired REAL NOT NULL,
    prob_at_purchase REAL NOT NULL,  -- implied prob when bet was placed
    phase_placed TEXT NOT NULL,
    day_placed INTEGER NOT NULL,
    settled BOOLEAN DEFAULT FALSE,
    correct BOOLEAN,
    crowns_payout REAL,
    placed_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS market_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    prob_yes REAL NOT NULL,
    event_type TEXT NOT NULL,        -- 'bet', 'phase_change', 'creation'
    actor TEXT,                      -- display name of bettor, or null for system
    timestamp REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS phase_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    day_number INTEGER NOT NULL,
    phase_index INTEGER NOT NULL,
    snapshot_at REAL NOT NULL,
    alive_count INTEGER NOT NULL,
    total_players INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    balance_after REAL NOT NULL,
    tx_type TEXT NOT NULL,
    reference_id TEXT,
    description TEXT,
    created_at REAL NOT NULL
);
"""

_db: aiosqlite.Connection | None = None


async def get_db() -> aiosqlite.Connection:
    """Return (and lazily initialize) the shared DB connection."""
    global _db
    if _db is None:
        _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _db = await aiosqlite.connect(str(_DB_PATH))
        _db.row_factory = aiosqlite.Row
        await _db.executescript(_SCHEMA)
        # Migrations: add columns if missing
        for col in ("passphrase_hash TEXT", "github_id TEXT", "credit_balance REAL DEFAULT 0.0"):
            try:
                await _db.execute(f"ALTER TABLE users ADD COLUMN {col}")
            except Exception:
                pass  # Column already exists
        await _db.commit()
    return _db


async def close_db() -> None:
    global _db
    if _db is not None:
        await _db.close()
        _db = None


# ── Users ───────────────────────────────────────────────────────────

def hash_passphrase(passphrase: str) -> str:
    """Simple SHA-256 hash for game passphrase."""
    return hashlib.sha256(passphrase.strip().lower().encode()).hexdigest()


async def create_user(display_name: str, passphrase: str | None = None) -> dict[str, str]:
    db = await get_db()
    user_id = uuid.uuid4().hex[:12]
    token = uuid.uuid4().hex
    ph = hash_passphrase(passphrase) if passphrase else None
    await db.execute(
        "INSERT INTO users (id, display_name, token, created_at, passphrase_hash) VALUES (?, ?, ?, ?, ?)",
        (user_id, display_name, token, time.time(), ph),
    )
    await db.commit()
    return {"id": user_id, "token": token, "display_name": display_name}


async def set_passphrase(user_id: str, passphrase: str) -> None:
    db = await get_db()
    await db.execute(
        "UPDATE users SET passphrase_hash = ? WHERE id = ?",
        (hash_passphrase(passphrase), user_id),
    )
    await db.commit()


async def get_user_by_github_id(github_id: str) -> dict[str, Any] | None:
    db = await get_db()
    row = await db.execute_fetchall(
        "SELECT * FROM users WHERE github_id = ?", (github_id,)
    )
    return dict(row[0]) if row else None


async def create_user_github(display_name: str, github_id: str) -> dict[str, str]:
    """Create a user authenticated via GitHub OAuth."""
    db = await get_db()
    user_id = uuid.uuid4().hex[:12]
    token = uuid.uuid4().hex
    # If display_name is taken, append a suffix
    base_name = display_name
    suffix = 0
    while True:
        existing = await db.execute_fetchall(
            "SELECT 1 FROM users WHERE display_name = ? COLLATE NOCASE", (display_name,)
        )
        if not existing:
            break
        suffix += 1
        display_name = f"{base_name}_{suffix}"
    await db.execute(
        "INSERT INTO users (id, display_name, token, created_at, github_id) VALUES (?, ?, ?, ?, ?)",
        (user_id, display_name, token, time.time(), github_id),
    )
    await db.commit()
    return {"id": user_id, "token": token, "display_name": display_name}


async def get_user_by_token(token: str) -> dict[str, Any] | None:
    db = await get_db()
    row = await db.execute_fetchall(
        "SELECT * FROM users WHERE token = ?", (token,)
    )
    return dict(row[0]) if row else None


async def get_user_by_name(name: str) -> dict[str, Any] | None:
    db = await get_db()
    row = await db.execute_fetchall(
        "SELECT * FROM users WHERE display_name = ? COLLATE NOCASE", (name,)
    )
    return dict(row[0]) if row else None


async def update_user_stats(
    user_id: str,
    crowns_delta: int = 0,
    correct_delta: int = 0,
    total_delta: int = 0,
    games_delta: int = 0,
) -> None:
    db = await get_db()
    await db.execute(
        """UPDATE users SET
            total_crowns_earned = total_crowns_earned + ?,
            correct_bets = correct_bets + ?,
            total_bets = total_bets + ?,
            games_watched = games_watched + ?
        WHERE id = ?""",
        (crowns_delta, correct_delta, total_delta, games_delta, user_id),
    )
    await db.commit()


# ── Credits ─────────────────────────────────────────────────────────


async def get_credit_balance(user_id: str) -> float:
    """Return user's current credit balance."""
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT credit_balance FROM users WHERE id = ?", (user_id,)
    )
    if not rows:
        return 0.0
    return float(rows[0]["credit_balance"] or 0.0)


async def add_credits(
    user_id: str,
    amount: float,
    tx_type: str,
    reference_id: str | None = None,
    description: str = "",
) -> float:
    """Add credits to user balance. Returns new balance."""
    db = await get_db()
    await db.execute(
        "UPDATE users SET credit_balance = credit_balance + ? WHERE id = ?",
        (amount, user_id),
    )
    rows = await db.execute_fetchall(
        "SELECT credit_balance FROM users WHERE id = ?", (user_id,)
    )
    new_balance = float(rows[0]["credit_balance"]) if rows else 0.0
    await db.execute(
        """INSERT INTO credit_transactions
            (user_id, amount, balance_after, tx_type, reference_id, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (user_id, amount, new_balance, tx_type, reference_id, description, time.time()),
    )
    await db.commit()
    return new_balance


async def deduct_credits(
    user_id: str,
    amount: float,
    tx_type: str,
    reference_id: str | None = None,
    description: str = "",
) -> float:
    """Deduct credits from user balance. Raises ValueError if insufficient."""
    db = await get_db()
    # Atomic: only deducts if balance is sufficient (prevents race conditions)
    cursor = await db.execute(
        "UPDATE users SET credit_balance = credit_balance - ? WHERE id = ? AND credit_balance >= ?",
        (amount, user_id, amount),
    )
    if cursor.rowcount == 0:
        balance = await get_credit_balance(user_id)
        raise ValueError(
            f"Insufficient credits: need ${amount:.2f}, have ${balance:.2f}"
        )
    rows = await db.execute_fetchall(
        "SELECT credit_balance FROM users WHERE id = ?", (user_id,)
    )
    new_balance = float(rows[0]["credit_balance"]) if rows else 0.0
    await db.execute(
        """INSERT INTO credit_transactions
            (user_id, amount, balance_after, tx_type, reference_id, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (user_id, -amount, new_balance, tx_type, reference_id, description, time.time()),
    )
    await db.commit()
    return new_balance


async def get_credit_history(user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """Return recent credit transactions for a user."""
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
        (user_id, limit),
    )
    return [dict(r) for r in rows]


# ── Game Sessions ───────────────────────────────────────────────────

async def create_session(user_id: str, game_id: str) -> dict[str, Any]:
    db = await get_db()
    existing = await db.execute_fetchall(
        "SELECT * FROM game_sessions WHERE user_id = ? AND game_id = ?",
        (user_id, game_id),
    )
    if existing:
        return dict(existing[0])
    await db.execute(
        "INSERT INTO game_sessions (user_id, game_id, joined_at) VALUES (?, ?, ?)",
        (user_id, game_id, time.time()),
    )
    await db.commit()
    await update_user_stats(user_id, games_delta=1)
    row = await db.execute_fetchall(
        "SELECT * FROM game_sessions WHERE user_id = ? AND game_id = ?",
        (user_id, game_id),
    )
    return dict(row[0])


async def get_session(user_id: str, game_id: str) -> dict[str, Any] | None:
    db = await get_db()
    row = await db.execute_fetchall(
        "SELECT * FROM game_sessions WHERE user_id = ? AND game_id = ?",
        (user_id, game_id),
    )
    return dict(row[0]) if row else None


async def update_session_budget(session_id: int, delta: float) -> None:
    db = await get_db()
    await db.execute(
        "UPDATE game_sessions SET crowns_budget = crowns_budget + ? WHERE id = ?",
        (delta, session_id),
    )
    await db.commit()


async def settle_session(session_id: int, crowns_won: float) -> None:
    db = await get_db()
    await db.execute(
        "UPDATE game_sessions SET settled = TRUE, crowns_won = ? WHERE id = ?",
        (crowns_won, session_id),
    )
    await db.commit()


# ── Markets ─────────────────────────────────────────────────────────

async def create_market(game_id: str, market_id: str, yes_pool: float, no_pool: float) -> None:
    db = await get_db()
    await db.execute(
        "INSERT OR IGNORE INTO markets (game_id, market_id, yes_pool, no_pool, created_at) VALUES (?, ?, ?, ?, ?)",
        (game_id, market_id, yes_pool, no_pool, time.time()),
    )
    await db.commit()


async def get_market(game_id: str, market_id: str) -> dict[str, Any] | None:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM markets WHERE game_id = ? AND market_id = ?",
        (game_id, market_id),
    )
    return dict(rows[0]) if rows else None


async def get_game_markets(game_id: str) -> list[dict[str, Any]]:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM markets WHERE game_id = ? ORDER BY market_id",
        (game_id,),
    )
    return [dict(r) for r in rows]


async def update_market_pools(game_id: str, market_id: str, yes_pool: float, no_pool: float) -> None:
    db = await get_db()
    await db.execute(
        "UPDATE markets SET yes_pool = ?, no_pool = ? WHERE game_id = ? AND market_id = ?",
        (yes_pool, no_pool, game_id, market_id),
    )
    await db.commit()


# ── Bets ────────────────────────────────────────────────────────────

async def create_bet(
    session_id: int,
    user_id: str,
    game_id: str,
    market_id: str,
    side: str,
    crowns_spent: float,
    shares_acquired: float,
    prob_at_purchase: float,
    phase_placed: str,
    day_placed: int,
) -> dict[str, Any]:
    db = await get_db()
    await db.execute(
        """INSERT INTO bets
            (session_id, user_id, game_id, market_id, side, crowns_spent,
             shares_acquired, prob_at_purchase, phase_placed, day_placed, placed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (session_id, user_id, game_id, market_id, side, crowns_spent,
         shares_acquired, prob_at_purchase, phase_placed, day_placed, time.time()),
    )
    await db.commit()
    await update_session_budget(session_id, -crowns_spent)
    row = await db.execute_fetchall(
        "SELECT * FROM bets WHERE session_id = ? ORDER BY id DESC LIMIT 1",
        (session_id,),
    )
    return dict(row[0])


async def get_bets(user_id: str, game_id: str) -> list[dict[str, Any]]:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM bets WHERE user_id = ? AND game_id = ? ORDER BY placed_at",
        (user_id, game_id),
    )
    return [dict(r) for r in rows]


async def get_bet(bet_id: int) -> dict[str, Any] | None:
    db = await get_db()
    rows = await db.execute_fetchall("SELECT * FROM bets WHERE id = ?", (bet_id,))
    return dict(rows[0]) if rows else None


async def cancel_bet(bet_id: int) -> float:
    """Cancel a bet. Returns the refund amount (90% of spent)."""
    db = await get_db()
    rows = await db.execute_fetchall("SELECT * FROM bets WHERE id = ?", (bet_id,))
    if not rows:
        return 0.0
    bet = dict(rows[0])
    if bet["settled"]:
        return 0.0
    refund = bet["crowns_spent"] * 0.9
    await db.execute("DELETE FROM bets WHERE id = ?", (bet_id,))
    await update_session_budget(bet["session_id"], refund)
    await db.commit()
    return refund


async def get_unsettled_bets(game_id: str) -> list[dict[str, Any]]:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM bets WHERE game_id = ? AND settled = FALSE",
        (game_id,),
    )
    return [dict(r) for r in rows]


async def settle_bet(bet_id: int, correct: bool, payout: float) -> None:
    db = await get_db()
    await db.execute(
        "UPDATE bets SET settled = TRUE, correct = ?, crowns_payout = ? WHERE id = ?",
        (correct, payout, bet_id),
    )
    await db.commit()


async def get_unsettled_sessions(game_id: str) -> list[dict[str, Any]]:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM game_sessions WHERE game_id = ? AND settled = FALSE",
        (game_id,),
    )
    return [dict(r) for r in rows]


# ── Phase Snapshots ─────────────────────────────────────────────────

async def record_phase(
    game_id: str, phase: str, day_number: int, phase_index: int,
    alive_count: int, total_players: int,
) -> None:
    db = await get_db()
    await db.execute(
        """INSERT INTO phase_snapshots
            (game_id, phase, day_number, phase_index, snapshot_at, alive_count, total_players)
        VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (game_id, phase, day_number, phase_index, time.time(), alive_count, total_players),
    )
    await db.commit()


async def get_phase_count(game_id: str) -> int:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM phase_snapshots WHERE game_id = ?",
        (game_id,),
    )
    return rows[0]["cnt"] if rows else 0


# ── Leaderboard ─────────────────────────────────────────────────────

# ── Market History ───────────────────────────────────────────────────

async def record_market_history(
    game_id: str, market_id: str, prob_yes: float,
    event_type: str, actor: str | None = None,
) -> None:
    db = await get_db()
    await db.execute(
        "INSERT INTO market_history (game_id, market_id, prob_yes, event_type, actor, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        (game_id, market_id, prob_yes, event_type, actor, time.time()),
    )
    await db.commit()


async def get_market_history(game_id: str, market_id: str) -> list[dict[str, Any]]:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM market_history WHERE game_id = ? AND market_id = ? ORDER BY timestamp",
        (game_id, market_id),
    )
    return [dict(r) for r in rows]


# ── Leaderboard ─────────────────────────────────────────────────────

async def get_leaderboard(limit: int = 50) -> list[dict[str, Any]]:
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT id, display_name, total_crowns_earned, correct_bets, total_bets, games_watched
        FROM users
        WHERE total_bets > 0
        ORDER BY total_crowns_earned DESC
        LIMIT ?""",
        (limit,),
    )
    return [dict(r) for r in rows]
