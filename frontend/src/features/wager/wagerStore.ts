/**
 * Zustand store for The Crown's Wager (prediction market version).
 */

import { create } from 'zustand';
import type { Bet, MarketInfo, LeaderboardEntry, WagerUser, QuoteResult } from './types.ts';
import * as api from './wagerApi.ts';

export interface WagerStore {
  // Auth
  user: WagerUser | null;
  authenticated: boolean;
  authLoading: boolean;

  // Game session
  gameId: string | null;
  crownsBudget: number;
  crownsWon: number;
  sessionSettled: boolean;

  // Bets
  bets: Bet[];

  // Markets
  markets: MarketInfo[];
  quote: QuoteResult | null;

  // Leaderboard
  leaderboard: LeaderboardEntry[];

  // UI state
  showAuthModal: boolean;
  selectedMarket: string | null;
  selectedSide: 'yes' | 'no';
  betAmount: number;
  error: string | null;

  // Actions
  claimName: (name: string) => Promise<void>;
  loadUser: () => Promise<void>;
  joinGame: (gameId: string) => Promise<void>;
  loadSession: (gameId: string) => Promise<void>;
  refreshMarkets: (gameId: string) => Promise<void>;
  fetchQuote: (gameId: string) => Promise<void>;
  placeBet: (gameId: string) => Promise<void>;
  cancelBet: (gameId: string, betId: number) => Promise<void>;
  loadLeaderboard: () => Promise<void>;
  setSelectedMarket: (marketId: string | null) => void;
  setSelectedSide: (side: 'yes' | 'no') => void;
  setBetAmount: (amount: number) => void;
  setShowAuthModal: (show: boolean) => void;
  clearError: () => void;
}

function normalizeBet(raw: any): Bet {
  return {
    id: raw.id,
    marketId: raw.market_id ?? raw.marketId,
    side: raw.side,
    crownsSpent: raw.crowns_spent ?? raw.crownsSpent ?? 0,
    shares: raw.shares ?? 0,
    probAtPurchase: raw.prob_at_purchase ?? raw.probAtPurchase ?? 0.5,
    potentialPayout: raw.potential_payout ?? raw.potentialPayout ?? 0,
    potentialProfit: raw.potential_profit ?? raw.potentialProfit ?? 0,
    phasePlaced: raw.phase_placed ?? raw.phasePlaced ?? '',
    dayPlaced: raw.day_placed ?? raw.dayPlaced ?? 0,
    settled: raw.settled ?? false,
    correct: raw.correct ?? null,
    crownsPayout: raw.crowns_payout ?? raw.crownsPayout ?? null,
  };
}

function normalizeMarket(raw: any): MarketInfo {
  return {
    marketId: raw.market_id ?? raw.marketId,
    probYes: raw.prob_yes ?? raw.probYes ?? 0.5,
    probNo: raw.prob_no ?? raw.probNo ?? 0.5,
    yesPool: raw.yes_pool ?? raw.yesPool ?? 100,
    noPool: raw.no_pool ?? raw.noPool ?? 100,
  };
}

export const useWagerStore = create<WagerStore>()((set, get) => ({
  user: null,
  authenticated: false,
  authLoading: true,
  gameId: null,
  crownsBudget: 100,
  crownsWon: 0,
  sessionSettled: false,
  bets: [],
  markets: [],
  quote: null,
  leaderboard: [],
  showAuthModal: false,
  selectedMarket: null,
  selectedSide: 'yes',
  betAmount: 10,
  error: null,

  claimName: async (name: string) => {
    try {
      const data = await api.claimName(name);
      set({
        user: {
          id: data.user_id,
          displayName: data.display_name,
          totalCrownsEarned: 0, gamesWatched: 0, correctBets: 0, totalBets: 0,
        },
        authenticated: true,
        showAuthModal: false,
        authLoading: false,
        error: null,
      });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  loadUser: async () => {
    if (!api.hasToken()) {
      set({ showAuthModal: true, authLoading: false });
      return;
    }
    try {
      const data = await api.getMe();
      set({
        user: {
          id: data.id,
          displayName: data.display_name,
          totalCrownsEarned: data.total_crowns_earned,
          gamesWatched: data.games_watched,
          correctBets: data.correct_bets,
          totalBets: data.total_bets,
        },
        authenticated: true,
        authLoading: false,
        error: null,
      });
    } catch {
      set({ showAuthModal: true, authenticated: false, authLoading: false });
    }
  },

  joinGame: async (gameId: string) => {
    try {
      const data = await api.joinGame(gameId);
      set({
        gameId,
        crownsBudget: data.crowns_budget ?? 100,
        crownsWon: data.crowns_won ?? 0,
        sessionSettled: data.settled ?? false,
        bets: (data.bets ?? []).map(normalizeBet),
        error: null,
      });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  loadSession: async (gameId: string) => {
    try {
      const data = await api.getSession(gameId);
      set({
        gameId,
        crownsBudget: data.crowns_budget ?? 100,
        crownsWon: data.crowns_won ?? 0,
        sessionSettled: data.settled ?? false,
        bets: (data.bets ?? []).map(normalizeBet),
      });
    } catch {
      // No session yet
    }
  },

  refreshMarkets: async (gameId: string) => {
    try {
      const data = await api.getMarkets(gameId);
      set({ markets: (data.markets ?? []).map(normalizeMarket) });
    } catch {
      // Markets not available yet
    }
  },

  fetchQuote: async (gameId: string) => {
    const { selectedMarket, selectedSide, betAmount } = get();
    if (!selectedMarket || betAmount <= 0) {
      set({ quote: null });
      return;
    }
    try {
      const raw = await api.getQuote(gameId, selectedMarket, selectedSide, betAmount);
      set({
        quote: {
          marketId: raw.market_id,
          side: raw.side,
          crowns: raw.crowns,
          shares: raw.shares,
          currentProb: raw.current_prob,
          impliedOdds: raw.implied_odds,
          potentialPayout: raw.potential_payout,
          potentialProfit: raw.potential_profit,
        },
      });
    } catch {
      set({ quote: null });
    }
  },

  placeBet: async (gameId: string) => {
    const { selectedMarket, selectedSide, betAmount } = get();
    if (!selectedMarket) return;
    try {
      const data = await api.placeBet(gameId, selectedMarket, selectedSide, betAmount);
      const newBet = normalizeBet(data);
      // Update markets with new probabilities
      if (data.market) {
        const updated = get().markets.map(m =>
          m.marketId === data.market.market_id
            ? { ...m, probYes: data.market.prob_yes, probNo: data.market.prob_no }
            : m
        );
        set({ markets: updated });
      }
      set(s => ({
        bets: [...s.bets, newBet],
        crownsBudget: s.crownsBudget - betAmount,
        quote: null,
        error: null,
      }));
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  cancelBet: async (gameId, betId) => {
    try {
      const data = await api.cancelBet(gameId, betId);
      set(s => ({
        bets: s.bets.filter(b => b.id !== betId),
        crownsBudget: s.crownsBudget + (data.refund ?? 0),
        error: null,
      }));
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  loadLeaderboard: async () => {
    try {
      const raw = await api.getLeaderboard();
      set({
        leaderboard: raw.map((e: any) => ({
          rank: e.rank,
          displayName: e.display_name ?? e.displayName,
          totalCrownsEarned: e.total_crowns_earned ?? e.totalCrownsEarned ?? 0,
          accuracyPct: e.accuracy_pct ?? e.accuracyPct ?? 0,
          gamesWatched: e.games_watched ?? e.gamesWatched ?? 0,
        })),
      });
    } catch { /* empty */ }
  },

  setSelectedMarket: (marketId) => set({ selectedMarket: marketId, quote: null }),
  setSelectedSide: (side) => set({ selectedSide: side, quote: null }),
  setBetAmount: (amount) => set({ betAmount: amount, quote: null }),
  setShowAuthModal: (show) => set({ showAuthModal: show }),
  clearError: () => set({ error: null }),
}));
