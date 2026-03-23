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
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Wager-Token': token } : {}),
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

export async function listGames(): Promise<GameListItem[]> {
  // Try backend first, fall back to GitHub for saved game replays
  try {
    return await request<GameListItem[]>('/api/games');
  } catch {
    return listGamesFromGitHub();
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
