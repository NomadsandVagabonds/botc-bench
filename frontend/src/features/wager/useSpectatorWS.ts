/**
 * WebSocket hook for spectator mode.
 *
 * Connects to /ws/spectator/{gameId} for public-only events.
 * For completed games: enters replay mode (progressive reveal).
 * For live games: real-time event application.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useGameStore } from '../../stores/gameStore.ts';

// WS URL: explicit env var > derive from API URL > localhost default
const WS_BASE = import.meta.env.VITE_WS_URL
  || (import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/^http/, 'ws') : null)
  || 'ws://localhost:8000';

function normalizeSpectatorEvent(raw: { type: string; data: any }): any | null {
  const { type, data } = raw;
  if (!type) return null;

  switch (type) {
    case 'game.state': {
      return {
        type: 'game.state',
        state: {
          gameId: data?.game_id ?? '',
          phase: data?.phase ?? 'setup',
          dayNumber: data?.day_number ?? 0,
          players: (data?.players ?? []).map((p: any) => ({
            seat: p.seat,
            agentId: p.agent_id ?? '',
            characterName: p.character_name ?? '',
            modelName: p.model_name ?? '',
            role: '',
            roleId: '',
            roleType: '',
            alignment: '',
            isAlive: p.is_alive ?? true,
            isPoisoned: false,
            isDrunk: false,
            isProtected: false,
            ghostVoteUsed: p.ghost_vote_used ?? false,
            perceivedRole: null,
            butlerMaster: null,
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
          demonBluffs: [],
          rngSeed: null,
        },
      };
    }
    case 'phase.change':
      return { type: 'phase.change', phase: data?.phase, dayNumber: data?.day };
    case 'message.new': {
      let msgType = data?.type ?? 'public';
      if (msgType === 'group') msgType = 'breakout';
      if (msgType === 'public_speech') msgType = 'public';
      if (msgType === 'private_info') return null;
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
          ...(data?.phase != null ? { phase: data.phase } : {}),
          ...(data?.day != null ? { dayNumber: data.day } : {}),
        },
      };
    }
    case 'nomination.start':
      return { type: 'nomination.start', nominatorSeat: data?.nominator, nomineeSeat: data?.nominee };
    case 'vote.cast':
      return { type: 'vote.cast', voterSeat: data?.seat, nomineeSeat: data?.nominee, vote: data?.vote };
    case 'nomination.result':
      return {
        type: 'nomination.result',
        nomination: {
          nominatorSeat: data?.nominator, nomineeSeat: data?.nominee,
          votesFor: data?.votes_for ?? [], votesAgainst: data?.votes_against ?? [],
          passed: data?.passed ?? false, outcome: data?.outcome ?? null,
        },
        onTheBlock: data?.on_the_block ?? null,
        onTheBlockVotes: data?.on_the_block_votes ?? null,
      };
    case 'execution':
      return { type: 'execution', seat: data?.seat, role: '???' };
    case 'death':
      return { type: 'death', seat: data?.seat, cause: data?.cause ?? 'night' };
    case 'breakout.formed':
      return {
        type: 'breakout.formed',
        groups: (data?.groups ?? []).map((g: any) => ({
          id: g.id, roundNumber: g.round_number ?? 1, members: g.members ?? [],
        })),
      };
    case 'breakout.ended':
      return { type: 'breakout.ended', roundNumber: 0 };
    case 'game.over':
      return { type: 'game.over', winner: data?.winner, winCondition: data?.reason };
    case 'whisper.notification':
      return {
        type: 'whisper.notification',
        fromSeat: data?.from, toSeat: data?.to, whisperContent: '',
        message: {
          id: crypto.randomUUID(), type: 'whisper_notification', phaseId: '',
          senderSeat: data?.from,
          content: `Seat ${data?.from} whispered to Seat ${data?.to}`,
          timestamp: Date.now(),
        },
      };
    case 'event.history': {
      const rawEvents: Array<{ type: string; data: any }> = data?.events ?? [];
      const normalized: any[] = [];
      for (const evt of rawEvents) {
        const n = normalizeSpectatorEvent(evt);
        if (n) normalized.push(n);
      }
      return { type: 'event.history', events: normalized };
    }
    case 'night.action':
    case 'player.reasoning':
    case 'agent.tokens':
      return null;
    default:
      return null;
  }
}

export function useSpectatorWS(gameId: string | undefined) {
  const wsRef = useRef<WebSocket | null>(null);
  const applyEvent = useGameStore(s => s.applyEvent);
  const startReplay = useGameStore(s => s.startReplay);

  const connect = useCallback(() => {
    if (!gameId) return;
    const url = `${WS_BASE}/ws/spectator/${gameId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    let initialState: any = null;

    ws.onopen = () => {
      useGameStore.getState().setConnected(true);
      useGameStore.getState().setGameId(gameId);
    };

    ws.onmessage = (msg) => {
      try {
        const raw = JSON.parse(msg.data);
        const event = normalizeSpectatorEvent(raw);
        if (!event) return;

        if (event.type === 'game.state') {
          initialState = event;
          console.log('[spectator] game.state received:', event.state?.players?.length, 'players', event.state?.players?.[0]?.characterName);
        }

        // For completed games: intercept event.history and enter replay mode
        // (progressive reveal instead of dumping all messages at once)
        if (event.type === 'event.history' && initialState) {
          const hasGameOver = event.events.some((e: any) => e.type === 'game.over');
          if (hasGameOver) {
            console.log('[spectator] Entering replay mode:', event.events.length, 'events');
            startReplay(initialState, event.events);
            return;
          }
        }

        // Live game: apply events directly
        applyEvent(event);
      } catch (err) {
        console.error('[spectator] Error processing message:', err);
      }
    };

    ws.onclose = () => {
      useGameStore.getState().setConnected(false);
    };

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ command: 'ping' }));
      }
    }, 25_000);

    ws.addEventListener('close', () => clearInterval(pingInterval));
  }, [gameId, applyEvent, startReplay]);

  useEffect(() => {
    if (useGameStore.getState().showObserverInfo) {
      useGameStore.getState().toggleObserverInfo();
    }
    connect();
    return () => { wsRef.current?.close(); };
  }, [connect]);
}
