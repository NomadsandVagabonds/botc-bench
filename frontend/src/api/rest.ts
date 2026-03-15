import type { GameConfig, GameState } from '../types/game.ts';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

// ── Types for backend responses ─────────────────────────────────────

/** Matches the backend GameResponse model from routes.py */
export interface GameListItem {
  game_id: string;
  status: string;        // "running" | "completed" | "failed"
  winner: string | null;
  total_days: number | null;
}

// ── Helpers ─────────────────────────────────────────────────────────

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

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
  seat_roles?: string[];  // optional pre-assigned role IDs per seat
  seed?: number;
  max_days?: number;
  reveal_models?: boolean;
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

export async function listGames(): Promise<GameListItem[]> {
  return request<GameListItem[]>('/api/games');
}

export async function getGame(id: string): Promise<GameState> {
  return request<GameState>(`/api/games/${id}`);
}

/** Stop a running game immediately. */
export async function stopGame(id: string): Promise<{ status: string; message: string }> {
  return request(`/api/games/${id}/stop`, { method: 'POST' });
}
