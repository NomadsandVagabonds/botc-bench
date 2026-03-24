import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '../stores/gameStore.ts';
import type { ServerEvent } from '../types/events.ts';

// WS URL: explicit env var > derive from API URL > localhost default
const WS_BASE = import.meta.env.VITE_WS_URL
  || (import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/^http/, 'ws') : null)
  || 'ws://localhost:8000';

const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_RECONNECT_DELAY = 1_000;

/**
 * Normalize raw backend WebSocket messages into ServerEvent shapes.
 * Backend sends: {"type": "event.name", "data": {...}}
 * Store expects typed events with specific field names.
 */
function normalizeEvent(raw: { type: string; data: any }): ServerEvent | null {
  const { type, data } = raw;
  if (!type) return null;

  switch (type) {
    case 'game.state': {
      // Transform snake_case backend snapshot to camelCase frontend GameState
      const state = {
        gameId: data?.game_id ?? '',
        phase: data?.phase ?? 'setup',
        dayNumber: data?.day_number ?? 0,
        players: (data?.players ?? []).map((p: any) => ({
          seat: p.seat,
          agentId: p.agent_id,
          characterName: p.character_name ?? '',
          modelName: p.model_name ?? '',
          role: p.role ?? '',
          roleId: p.role_id ?? '',
          roleType: p.role_type ?? '',
          alignment: p.alignment ?? 'good',
          isAlive: p.is_alive ?? true,
          isPoisoned: p.is_poisoned ?? false,
          isDrunk: p.is_drunk ?? false,
          isProtected: p.is_protected ?? false,
          ghostVoteUsed: p.ghost_vote_used ?? false,
          perceivedRole: p.perceived_role,
          butlerMaster: p.butler_master,
        })),
        messages: [],
        breakoutGroups: (data?.breakout_groups ?? []).map((g: any) => ({
          id: g.id,
          roundNumber: g.round_number,
          members: g.members,
        })),
        nominations: (data?.nominations ?? []).map((n: any) => ({
          nominatorSeat: n.nominator,
          nomineeSeat: n.nominee,
          votesFor: n.votes_for ?? [],
          votesAgainst: n.votes_against ?? [],
          passed: n.passed ?? false,
          outcome: n.outcome ?? null,
        })),
        onTheBlock: data?.on_the_block != null ? {
          seat: data.on_the_block,
          voteCount: data.on_the_block_votes ?? 0,
        } : null,
        whispers: [],
        executedToday: data?.executed_today,
        nightKills: data?.night_kills ?? [],
        winner: data?.winner,
        winCondition: data?.win_condition,
        demonBluffs: data?.demon_bluffs ?? [],
        rngSeed: data?.rng_seed,
      };
      return { type: 'game.state', state } as any;
    }
    case 'phase.change':
      // Don't default dayNumber to 0 — use undefined so the store preserves
      // the previous day when backend omits it (e.g. nominations resume)
      return { type: 'phase.change', phase: data?.phase, dayNumber: data?.day, playerStatuses: data?.player_statuses } as any;
    case 'message.new': {
      // Map backend message types to frontend MessageType values
      let msgType = data?.type ?? 'public';
      if (msgType === 'group') msgType = 'breakout';
      if (msgType === 'public_speech') msgType = 'public';
      return {
        type: 'message.new',
        message: {
          id: crypto.randomUUID(),
          type: msgType,
          phaseId: '',
          senderSeat: data?.seat ?? null,
          content: data?.content ?? '',
          groupId: data?.group_id ?? null,
          timestamp: Date.now(),
          // Pass through phase/day from backend when available (e.g. private_info)
          ...(data?.phase != null ? { phase: data.phase } : {}),
          ...(data?.day != null ? { dayNumber: data.day } : {}),
          // Internal reasoning stripped from public speech (observer-only)
          ...(data?.internal ? { internal: data.internal } : {}),
        },
      } as any;
    }
    case 'nomination.start':
      return { type: 'nomination.start', nominatorSeat: data?.nominator, nomineeSeat: data?.nominee } as any;
    case 'vote.cast':
      return { type: 'vote.cast', voterSeat: data?.seat, nomineeSeat: data?.nominee, vote: data?.vote } as any;
    case 'nomination.result':
      return {
        type: 'nomination.result',
        nomination: {
          nominatorSeat: data?.nominator,
          nomineeSeat: data?.nominee,
          votesFor: data?.votes_for ?? [],
          votesAgainst: data?.votes_against ?? [],
          passed: data?.passed ?? false,
          outcome: data?.outcome ?? null,
        },
        onTheBlock: data?.on_the_block ?? null,
        onTheBlockVotes: data?.on_the_block_votes ?? null,
      } as any;
    case 'execution':
      return { type: 'execution', seat: data?.seat, role: data?.role, deathCause: data?.death_cause, deathDay: data?.death_day, deathPhase: data?.death_phase } as any;
    case 'death':
      return { type: 'death', seat: data?.seat, cause: data?.cause ?? 'night', deathCause: data?.death_cause, deathDay: data?.death_day, deathPhase: data?.death_phase } as any;
    case 'resurrection':
      return { type: 'resurrection', seat: data?.seat, cause: data?.cause ?? 'night_resurrection' } as any;
    case 'night.action':
      return { type: 'night.action', seat: data?.seat, name: data?.name, role: data?.role, roleId: data?.role_id, action: data?.action, targetSeat: data?.target_seat, targetName: data?.target_name, effect: data?.effect, day: data?.day } as any;
    case 'breakout.formed':
      return {
        type: 'breakout.formed',
        groups: (data?.groups ?? []).map((g: any) => ({
          id: g.id,
          roundNumber: g.round_number ?? g.roundNumber ?? 1,
          members: g.members ?? [],
        })),
      } as any;
    case 'breakout.ended':
      return { type: 'breakout.ended', roundNumber: 0 } as any;
    case 'player.reasoning':
      return { type: 'player.reasoning', seat: data?.seat, reasoning: data?.reasoning, phase: data?.phase ?? '' } as any;
    case 'agent.tokens':
      return { type: 'agent.tokens', seat: data?.seat, promptTokens: data?.input_tokens ?? 0, completionTokens: data?.output_tokens ?? 0, totalCost: data?.cost_usd ?? data?.total_cost_usd ?? 0 } as any;
    case 'game.over':
      return { type: 'game.over', winner: data?.winner, winCondition: data?.reason } as any;
    case 'whisper.notification':
      return { type: 'whisper.notification', fromSeat: data?.from, toSeat: data?.to, whisperContent: data?.content ?? '', message: { id: crypto.randomUUID(), type: 'whisper_notification', phaseId: '', senderSeat: data?.from, content: `Seat ${data?.from} whispered to Seat ${data?.to}`, timestamp: Date.now() } } as any;
    case 'event.history': {
      // Batch of historical events from before this client connected.
      // Normalize each sub-event and collect the valid ones.
      // Tag each with its raw index so audio sync can map clips to events.
      const rawEvents: Array<{ type: string; data: any }> = data?.events ?? [];
      const normalized: ServerEvent[] = [];
      for (let i = 0; i < rawEvents.length; i++) {
        const evt = normalizeEvent(rawEvents[i]);
        if (evt) {
          (evt as any)._rawIndex = i;
          normalized.push(evt);
        }
      }
      return { type: 'event.history', events: normalized } as any;
    }
    case 'debrief.message':
      return {
        type: 'debrief.message',
        seat: data?.seat,
        agentId: data?.agent_id,
        characterName: data?.character_name,
        role: data?.role,
        alignment: data?.alignment,
        content: data?.content,
        survived: data?.survived,
      } as any;
    case 'game.created':
      // Not a state event — just log
      console.log('[ws] Game created:', data);
      return null;
    case 'monitor.started':
    case 'monitor.phase':
    case 'monitor.complete':
      // Pass through as-is for monitor UI handling
      return { type, ...data } as any;
    default:
      console.log('[ws] Unknown event:', type, data);
      return null;
  }
}

interface UseWebSocketReturn {
  connected: boolean;
  send: (data: unknown) => void;
  reconnect: () => void;
}

export function useWebSocket(gameId: string | null): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(INITIAL_RECONNECT_DELAY);
  const intentionalClose = useRef(false);

  const applyEvent = useGameStore((s) => s.applyEvent);
  const startReplay = useGameStore((s) => s.startReplay);
  const storeSetConnected = useGameStore((s) => s.setConnected);

  const connect = useCallback(() => {
    if (!gameId) return;
    // Don't connect if we're already in replay mode (GitHub fallback loaded)
    if (useGameStore.getState().replayMode) return;

    // Clean up any existing connection.
    if (wsRef.current) {
      intentionalClose.current = true;
      wsRef.current.close();
    }

    const url = `${WS_BASE}/ws/game/${gameId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    intentionalClose.current = false;

    ws.onopen = () => {
      setConnected(true);
      storeSetConnected(true);
      reconnectDelay.current = INITIAL_RECONNECT_DELAY;
    };

    // Track whether this is a replay (saved game, not live)
    let receivedInitialState: import('../types/events.ts').ServerEvent | null = null;

    ws.onmessage = (ev) => {
      try {
        const raw = JSON.parse(ev.data as string);
        const event = normalizeEvent(raw);
        if (!event) return;

        // First message is always game.state — save it to detect replay vs live
        if (event.type === 'game.state' && !receivedInitialState) {
          receivedInitialState = event;
          // Don't apply yet — wait to see if event.history follows (replay)
          // or if live events follow (live game)
          return;
        }

        // If we get event.history right after game.state, check if it's a completed game
        if (event.type === 'event.history' && receivedInitialState) {
          const historyEvents = (event as any).events ?? [];
          const hasGameOver = historyEvents.some((e: any) => e.type === 'game.over');

          if (hasGameOver) {
            // Completed game — enter replay mode
            console.log(`[ws] Entering replay mode (${historyEvents.length} events)`);
            startReplay(receivedInitialState, historyEvents);
            receivedInitialState = null;
            return;
          }

          // Live game catching up — apply initial state then history normally
          applyEvent(receivedInitialState);
          applyEvent(event);
          receivedInitialState = null;
          // Enable theatrical pacing for subsequent live events
          useGameStore.setState({ theatricalMode: true });
          return;
        }

        // If we get any other event after game.state without event.history,
        // this is a live game — apply the saved initial state and continue
        if (receivedInitialState) {
          applyEvent(receivedInitialState);
          receivedInitialState = null;
          // Enable theatrical pacing for subsequent live events
          useGameStore.setState({ theatricalMode: true });
        }

        // Ignore WS events while a replay is active (e.g. GitHub fallback loaded)
        const store = useGameStore.getState();
        if (store.replayMode) return;

        // Route through theatrical queue for live games
        if (store.theatricalMode) {
          store.enqueueTheatrical(event);
        } else {
          applyEvent(event);
        }
      } catch {
        console.warn('[ws] Failed to parse event:', ev.data);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      storeSetConnected(false);
      wsRef.current = null;

      // Don't reconnect if in replay mode (game loaded from GitHub, WS not needed)
      const { replayMode } = useGameStore.getState();
      if (!intentionalClose.current && !replayMode) {
        // Exponential backoff reconnect.
        const delay = reconnectDelay.current;
        reconnectDelay.current = Math.min(
          delay * 2,
          MAX_RECONNECT_DELAY,
        );
        reconnectTimer.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = (err) => {
      console.error('[ws] Error:', err);
      ws.close();
    };
  }, [gameId, applyEvent, storeSetConnected]);

  // Connect when gameId changes.
  useEffect(() => {
    if (!gameId) return;

    connect();

    return () => {
      intentionalClose.current = true;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [gameId, connect]);

  const send = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    } else {
      console.warn('[ws] Cannot send — not connected');
    }
  }, []);

  const reconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    reconnectDelay.current = INITIAL_RECONNECT_DELAY;
    connect();
  }, [connect]);

  return { connected, send, reconnect };
}
