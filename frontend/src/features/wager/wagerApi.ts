/**
 * REST API client for The Crown's Wager (prediction market version).
 */

function getBaseUrl(): string {
  return localStorage.getItem('bloodbench_server_url')
    || import.meta.env.VITE_API_URL
    || 'http://localhost:8000';
}

const API_BASE = getBaseUrl();

function getToken(): string | null {
  return localStorage.getItem('wager_token');
}

function setToken(token: string) {
  localStorage.setItem('wager_token', token);
}

function headers(): Record<string, string> {
  const token = getToken();
  return token
    ? { 'Content-Type': 'application/json', 'X-Wager-Token': token }
    : { 'Content-Type': 'application/json' };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Auth ────────────────────────────────────────────────────────────

export async function claimName(displayName: string, passphrase?: string) {
  const res = await fetch(`${API_BASE}/api/wager/auth/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: displayName, passphrase: passphrase || null }),
  });
  const data = await handleResponse<{ user_id: string; token: string; display_name: string; returning?: boolean }>(res);
  setToken(data.token);
  return data;
}

export async function getMe() {
  const res = await fetch(`${API_BASE}/api/wager/auth/me`, { headers: headers() });
  return handleResponse<any>(res);
}

// ── Session ─────────────────────────────────────────────────────────

export async function joinGame(gameId: string) {
  const res = await fetch(`${API_BASE}/api/wager/games/${gameId}/join`, {
    method: 'POST',
    headers: headers(),
  });
  return handleResponse<any>(res);
}

export async function getSession(gameId: string) {
  const res = await fetch(`${API_BASE}/api/wager/games/${gameId}/session`, {
    headers: headers(),
  });
  return handleResponse<any>(res);
}

// ── Markets ─────────────────────────────────────────────────────────

export async function getMarkets(gameId: string) {
  const res = await fetch(`${API_BASE}/api/wager/games/${gameId}/markets`, {
    headers: headers(),
  });
  return handleResponse<any>(res);
}

export async function getQuote(gameId: string, marketId: string, side: string, crowns: number) {
  const params = new URLSearchParams({ market_id: marketId, side, crowns: String(crowns) });
  const res = await fetch(`${API_BASE}/api/wager/games/${gameId}/quote?${params}`, {
    headers: headers(),
  });
  return handleResponse<any>(res);
}

// ── Betting ─────────────────────────────────────────────────────────

export async function placeBet(gameId: string, marketId: string, side: string, crowns: number) {
  const res = await fetch(`${API_BASE}/api/wager/games/${gameId}/bets`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ market_id: marketId, side, crowns }),
  });
  return handleResponse<any>(res);
}

export async function listBets(gameId: string) {
  const res = await fetch(`${API_BASE}/api/wager/games/${gameId}/bets`, {
    headers: headers(),
  });
  return handleResponse<any[]>(res);
}

export async function sellBet(gameId: string, betId: number) {
  const res = await fetch(`${API_BASE}/api/wager/games/${gameId}/bets/${betId}/sell`, {
    method: 'POST',
    headers: headers(),
  });
  return handleResponse<any>(res);
}

export async function settleGame(gameId: string) {
  const res = await fetch(`${API_BASE}/api/wager/games/${gameId}/settle`, {
    method: 'POST',
    headers: headers(),
  });
  return handleResponse<any>(res);
}

// ── Leaderboard ─────────────────────────────────────────────────────

export async function getLeaderboard() {
  const res = await fetch(`${API_BASE}/api/wager/leaderboard`, { headers: headers() });
  return handleResponse<any[]>(res);
}

// ── Helpers ─────────────────────────────────────────────────────────

export function hasToken(): boolean {
  return !!getToken();
}
