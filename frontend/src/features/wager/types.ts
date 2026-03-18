// ── Auth ────────────────────────────────────────────────────────────

export interface WagerUser {
  id: string;
  displayName: string;
  totalCrownsEarned: number;
  gamesWatched: number;
  correctBets: number;
  totalBets: number;
}

// ── Markets ─────────────────────────────────────────────────────────

export interface MarketInfo {
  marketId: string;
  probYes: number;
  probNo: number;
  yesPool: number;
  noPool: number;
}

export interface QuoteResult {
  marketId: string;
  side: 'yes' | 'no';
  crowns: number;
  shares: number;
  currentProb: number;
  impliedOdds: number;
  potentialPayout: number;
  potentialProfit: number;
}

// ── Betting ─────────────────────────────────────────────────────────

export interface Bet {
  id: number;
  marketId: string;
  side: 'yes' | 'no';
  crownsSpent: number;
  shares: number;
  probAtPurchase: number;
  potentialPayout: number;
  potentialProfit: number;
  phasePlaced: string;
  dayPlaced: number;
  settled: boolean;
  correct: boolean | null;
  crownsPayout: number | null;
}

// ── Session ─────────────────────────────────────────────────────────

export interface GameSession {
  gameId: string;
  crownsBudget: number;
  crownsWon: number;
  settled: boolean;
  bets: Bet[];
}

// ── Leaderboard ─────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  totalCrownsEarned: number;
  accuracyPct: number;
  gamesWatched: number;
}
