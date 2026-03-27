import type { GameConfig, GameState } from '../types/game.ts';
import type { MonitorResult } from '../types/monitor.ts';

function getBaseUrl(): string {
  // Priority: localStorage override > env var > localhost default
  return localStorage.getItem('bloodbench_server_url')
    || import.meta.env.VITE_API_URL
    || 'http://localhost:8000';
}

const BASE_URL = getBaseUrl();

// ── Types for backend responses ─────────────────────────────────────

/** Matches the backend GameResponse model from routes.py */
export interface GameListItem {
  game_id: string;
  status: string;        // "running" | "completed" | "failed"
  winner: string | null;
  total_days: number | null;
  created_at: string | null;   // "YYYY-MM-DD"
  has_audio: boolean;
  has_monitors: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = localStorage.getItem('wager_token');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000); // 3s timeout
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Wager-Token': token } : {}),
      ...options.headers,
    },
    ...options,
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `API ${options.method ?? 'GET'} ${path} failed (${res.status}): ${body}`,
    );
  }

  return res.json() as Promise<T>;
}

// ── Configured game types ───────────────────────────────────────────

export interface SeatModelConfig {
  provider: string;  // "anthropic" | "openai" | "google"
  model: string;     // actual model ID
}

export interface ConfiguredGameRequest {
  script: string;
  num_players: number;
  seat_models: SeatModelConfig[];
  seat_roles?: string[];  // optional pre-assigned role IDs per seat ('' = random for that seat)
  seat_characters?: (number | null)[];  // sprite IDs per seat, null = auto-assign
  seed?: number;
  max_days?: number;
  reveal_models?: string; // "true" | "false" | "scramble"
  share_stats?: boolean;
  speech_style?: string | null;
  provider_keys?: Record<string, string>;  // BYOK: client-provided API keys
}

// ── Model stats types ────────────────────────────────────────────────

export interface AlignmentStats {
  played: number;
  wins: number;
  win_rate: number;
}

export interface ModelStats {
  games_played: number;
  as_good: AlignmentStats;
  as_evil: AlignmentStats;
  as_demon: AlignmentStats;
}

export interface ModelStatsResponse {
  models: Record<string, ModelStats>;
  rankings: {
    good: string[];
    evil: string[];
    demon: string[];
    overall: string[];
  };
  total_games: number;
}

export interface GameStatusResponse {
  game_id: string;
  status: string; // "running" | "completed" | "failed" | "stopped"
  state?: GameState;
  error?: string | null;
  winner?: string | null;
  win_condition?: string | null;
  total_days?: number | null;
}

// ── API functions ───────────────────────────────────────────────────

export async function createGame(config: GameConfig): Promise<GameState> {
  return request<GameState>('/api/games', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

/** Quick-start a game using server-side .env API keys. */
export async function quickGame(
  numPlayers: number,
  seed?: number,
): Promise<GameListItem> {
  const params = new URLSearchParams({ num_players: String(numPlayers) });
  if (seed !== undefined) params.set('seed', String(seed));
  return request<GameListItem>(`/api/games/quick?${params.toString()}`, {
    method: 'POST',
  });
}

/** Start a game with per-seat model choices, using server-side API keys. */
export async function createConfiguredGame(
  config: ConfiguredGameRequest,
): Promise<GameListItem> {
  return request<GameListItem>('/api/games/configured', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

/** True when a backend server should be reachable (explicit config, env var, or localhost dev). */
const hasConfiguredServer = !!(
  localStorage.getItem('bloodbench_server_url')
  || import.meta.env.VITE_API_URL
  || window.location.hostname === 'localhost'
  || window.location.hostname === '127.0.0.1'
);

export async function listGames(): Promise<GameListItem[]> {
  // If no server configured, go straight to GitHub — don't waste 3s on localhost timeout
  if (!hasConfiguredServer) {
    console.log('[listGames] No server configured, loading from GitHub');
    try {
      const games = await listGamesFromGitHub();
      console.log(`[listGames] GitHub returned ${games.length} games`);
      return games;
    } catch (ghErr) {
      console.warn('[listGames] GitHub failed:', ghErr);
      return [];
    }
  }

  // Server configured — try backend, merge with GitHub for saved replays
  try {
    const backendGames = await request<GameListItem[]>('/api/games');
    // If backend returns games, also merge GitHub games that aren't on the server
    // (Railway wipes disk on redeploy, but games are saved to GitHub)
    try {
      const ghGames = await listGamesFromGitHub();
      const backendIds = new Set(backendGames.map(g => g.game_id));
      const merged = [
        ...backendGames,
        ...ghGames.filter(g => !backendIds.has(g.game_id)),
      ];
      console.log(`[listGames] ${backendGames.length} from server + ${merged.length - backendGames.length} from GitHub`);
      // Sort by date, most recent first (games without dates go to the end)
      merged.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
      return merged;
    } catch {
      // GitHub failed, just use backend (still sort)
      backendGames.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
      return backendGames;
    }
  } catch (err) {
    console.log('[listGames] Backend unavailable, falling back to GitHub:', (err as Error)?.message);
    try {
      const games = await listGamesFromGitHub();
      console.log(`[listGames] GitHub returned ${games.length} games`);
      return games;
    } catch (ghErr) {
      console.warn('[listGames] GitHub fallback also failed:', ghErr);
      return [];
    }
  }
}

/** Fetch game list from GitHub repo (public, no auth needed). */
const GITHUB_GAMES_API = 'https://api.github.com/repos/NomadsandVagabonds/botc-bench/contents/backend/games';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/NomadsandVagabonds/botc-bench/main/backend/games';

async function listGamesFromGitHub(): Promise<GameListItem[]> {
  const res = await fetch(GITHUB_GAMES_API);
  if (!res.ok) return [];
  const files: Array<{ name: string }> = await res.json();
  // Parse game IDs from filenames like "game_abc123.json"
  return files
    .filter(f => f.name.startsWith('game_') && f.name.endsWith('.json'))
    .map(f => {
      const gameId = f.name.replace('game_', '').replace('.json', '');
      return {
        game_id: gameId,
        status: 'completed',
        winner: null,        // unknown until loaded
        total_days: null,
        created_at: null,
        has_audio: false,
        has_monitors: false,
      };
    });
}

/** Load a full game JSON from GitHub for replay. */
export async function loadGameFromGitHub(gameId: string): Promise<any> {
  const url = `${GITHUB_RAW_BASE}/game_${gameId}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Game ${gameId} not found on GitHub`);
  return res.json();
}

export async function getGame(id: string): Promise<GameState> {
  return request<GameState>(`/api/games/${id}`);
}

export async function getGameStatus(id: string): Promise<GameStatusResponse> {
  return request<GameStatusResponse>(`/api/games/${id}`);
}

/** Stop a running game immediately. */
export async function stopGame(id: string): Promise<{ status: string; message: string }> {
  return request(`/api/games/${id}/stop`, { method: 'POST' });
}

/** Fetch per-model historical stats and rankings. */
export async function getModelStats(): Promise<ModelStatsResponse> {
  return request<ModelStatsResponse>('/api/stats/models');
}

// ── Audio / TTS ─────────────────────────────────────────────────────

export interface AudioClip {
  index: number;
  file: string | null;
  speaker: string;
  seat: number | null;
  type: string;
  text: string;
  event_index: number;
  duration_s: number;
  error?: string;
}

export interface AudioManifest {
  game_id: string;
  clips: AudioClip[];
}

/** Fetch the TTS audio manifest for a game. */
export async function getAudioManifest(gameId: string): Promise<AudioManifest> {
  return request<AudioManifest>(`/api/games/${gameId}/audio/manifest`);
}

/** Get the URL for an individual audio clip. */
export function getAudioClipUrl(gameId: string, filename: string): string {
  return `${BASE_URL}/api/games/${gameId}/audio/${filename}`;
}

/** Trigger TTS generation for a game (idempotent). */
export async function generateGameAudio(gameId: string): Promise<{ clips_generated: number }> {
  return request(`/api/games/${gameId}/audio/generate`, { method: 'POST' });
}

// ── Monitor ──────────────────────────────────────────────────────────

export interface StartMonitorRequest {
  provider: string;
  model: string;
  temperature?: number;
  include_groups?: boolean;
}

/** Start a monitor analysis on a completed game. */
export async function startMonitor(
  gameId: string,
  config: StartMonitorRequest,
): Promise<{ status: string; game_id: string }> {
  return request(`/api/games/${gameId}/monitors`, {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

/** List all monitor results for a game. */
export async function listMonitors(gameId: string): Promise<MonitorResult[]> {
  return request<MonitorResult[]>(`/api/games/${gameId}/monitors`);
}

/** Get a specific monitor result. */
export async function getMonitorResult(
  gameId: string,
  monitorId: string,
): Promise<MonitorResult> {
  return request<MonitorResult>(`/api/games/${gameId}/monitors/${monitorId}`);
}

// ── Cost Estimation ──────────────────────────────────────────────────

export interface CostEstimate {
  estimated_cost: number;
  charge_amount: number;
  is_minimum: boolean;
  minimum_charge: number;
  breakdown: Record<string, { count: number; cost_per_call: number; daily_cost: number; total_est: number }>;
  est_days: number;
  num_players: number;
  assumptions: string;
}

/** Get cost estimate for a game configuration. */
export async function estimateCost(config: {
  num_players: number;
  seat_models: SeatModelConfig[];
  max_days?: number;
}): Promise<CostEstimate> {
  return request<CostEstimate>('/api/estimate-cost', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

// ── Credits ─────────────────────────────────────────────────────────

export interface CreditBalance {
  balance: number;
  display_name: string;
}

export interface CreditPack {
  id: string;
  credits: number;
  price_usd: number;
  label: string;
}

export interface CreditTransaction {
  id: number;
  amount: number;
  balance_after: number;
  tx_type: string;
  reference_id: string | null;
  description: string;
  created_at: number;
}

export interface StripeConfig {
  publishable_key: string;
  payments_enabled: boolean;
  paid_allowed_models: string[];
  credit_packs: CreditPack[];
}

/** Get the authenticated user's credit balance. */
export async function getCreditBalance(): Promise<CreditBalance> {
  return request<CreditBalance>('/api/credits/balance');
}

/** Get available credit packs. */
export async function getCreditPacks(): Promise<{ packs: CreditPack[] }> {
  return request<{ packs: CreditPack[] }>('/api/credits/packs');
}

/** Purchase a credit pack via Stripe Checkout. */
export async function purchaseCredits(packId: string): Promise<{ url: string; session_id: string }> {
  return request('/api/credits/purchase', {
    method: 'POST',
    body: JSON.stringify({ pack_id: packId }),
  });
}

/** Purchase exact credits for a specific game (no pack, no overpaying). */
export async function purchaseExactCredits(amount: number): Promise<{ url: string; session_id: string }> {
  return request('/api/credits/purchase-exact', {
    method: 'POST',
    body: JSON.stringify({ amount }),
  });
}

/** Get credit transaction history. */
export async function getCreditHistory(): Promise<{ transactions: CreditTransaction[] }> {
  return request<{ transactions: CreditTransaction[] }>('/api/credits/history');
}

/** Get Stripe config (publishable key, enabled status, credit packs). */
export async function getStripeConfig(): Promise<StripeConfig> {
  return request<StripeConfig>('/api/stripe-config');
}
