/**
 * Theatrical event pacer — drains buffered events at a paced speed.
 *
 * During live games, ALL WebSocket events are buffered in theatricalEventQueue
 * instead of being applied immediately. This hook drains them one at a time
 * via applyEvent, so sprites, phase changes, messages, and overlays all
 * update in lockstep — just like replay mode.
 *
 * No-ops during replay mode (replay has its own pacing via useReplayController).
 */

import { useCallback, useEffect, useRef } from 'react';
import { useGameStore } from '../stores/gameStore.ts';
import type { ServerEvent } from '../types/events.ts';

// ── Delay calculation ───────────────────────────────────────────────

const THEATRICAL_DELAYS: Record<string, number> = {
  'phase.change': 2500,
  'message.new': 3000,
  'nomination.start': 2000,
  'vote.cast': 1000,
  'nomination.result': 2000,
  'execution': 3000,
  'death': 2500,
  'breakout.formed': 1500,
  'breakout.ended': 800,
  'night.action': 1200,
  'player.reasoning': 0,
  'agent.tokens': 0,
  'game.over': 4000,
  'debrief.message': 3000,
  'whisper.notification': 1500,
  'game.state': 0,
};

function calculateEventDelay(event: ServerEvent, remaining: number): number {
  const base = THEATRICAL_DELAYS[event.type] ?? 1500;
  if (base === 0) return 0; // data events drain instantly

  // For message events, scale by word count (~250 WPM = 4 words/sec)
  if (event.type === 'message.new') {
    const content = (event as any).message?.content ?? '';
    const words = content.split(/\s+/).length;
    const readTime = (words / 4) * 1000;
    const msgType = (event as any).message?.type;
    const typeBase = msgType === 'accusation' || msgType === 'defense' ? 6000 : base;
    const delay = Math.max(2500, Math.max(readTime, typeBase));

    if (remaining > 20) {
      const speedup = Math.max(0.25, 1.0 - (remaining - 20) * 0.03);
      return Math.max(800, delay * speedup);
    }
    return delay;
  }

  // Catch-up for non-message events
  if (remaining > 20) {
    const speedup = Math.max(0.25, 1.0 - (remaining - 20) * 0.03);
    return Math.max(400, base * speedup);
  }
  return base;
}

// ── Hook ────────────────────────────────────────────────────────────

export function useTheatricalPacer() {
  const theatricalMode = useGameStore((s) => s.theatricalMode);
  const replayMode = useGameStore((s) => s.replayMode);
  const queueLength = useGameStore((s) => s.theatricalEventQueue.length);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainingRef = useRef(false);

  const drain = useCallback(() => {
    const store = useGameStore.getState();
    if (store.theatricalEventQueue.length === 0 || store.replayMode || !store.theatricalMode || store.theatricalHold || store.accusationOverlayVisible || store.deathCardVisible) {
      drainingRef.current = false;
      return;
    }

    const next = store.drainTheatricalEvent();
    if (!next) {
      drainingRef.current = false;
      return;
    }

    const delay = calculateEventDelay(next, store.theatricalEventQueue.length);

    if (delay === 0) {
      // Data event — drain next immediately (batch data events together)
      drain();
    } else {
      timerRef.current = setTimeout(drain, delay);
    }
  }, []);

  const theatricalHold = useGameStore((s) => s.theatricalHold);
  const overlayVisible = useGameStore((s) => s.accusationOverlayVisible);
  const deathCardVisible = useGameStore((s) => s.deathCardVisible);

  // Start draining when queue grows and we're not already draining
  // Also restart when overlay/death card clears
  useEffect(() => {
    if (queueLength > 0 && !drainingRef.current && theatricalMode && !replayMode && !theatricalHold && !overlayVisible && !deathCardVisible) {
      drainingRef.current = true;
      timerRef.current = setTimeout(drain, 300);
    }
  }, [queueLength, theatricalMode, replayMode, theatricalHold, overlayVisible, deathCardVisible, drain]);

  // Clear timer when entering replay mode or on unmount
  useEffect(() => {
    if (replayMode && timerRef.current) {
      clearTimeout(timerRef.current);
      drainingRef.current = false;
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [replayMode]);
}
