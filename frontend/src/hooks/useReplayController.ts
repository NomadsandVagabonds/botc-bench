import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/gameStore.ts';

/**
 * Drives replay playback by calling replayNext() on a timer.
 *
 * Event pacing: different event types get different delays to feel natural.
 * Speed multiplier (1x/2x/4x) divides all delays.
 * Pause stops the timer.
 */

// Base delays in ms at 1x speed
const EVENT_DELAYS: Record<string, number> = {
  'phase.change': 2000,
  'message.new': 1200,
  'nomination.start': 1500,
  'vote.cast': 600,
  'nomination.result': 1200,
  'execution': 2000,
  'death': 2000,
  'breakout.formed': 1000,
  'breakout.ended': 500,
  'night.action': 800,
  'player.reasoning': 200, // Fast — these are observer-only background data
  'agent.tokens': 50,      // Nearly instant — just data
  'game.over': 2500,
  'debrief.message': 1500,
  'whisper.notification': 800,
  'game.state': 100,       // Initial state — fast
};

const DEFAULT_DELAY = 500;

export function useReplayController() {
  const replayMode = useGameStore((s) => s.replayMode);
  const paused = useGameStore((s) => s.paused);
  const speed = useGameStore((s) => s.speed);
  const replayNext = useGameStore((s) => s.replayNext);
  const replayQueue = useGameStore((s) => s.replayQueue);
  const replayIndex = useGameStore((s) => s.replayIndex);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!replayMode || paused || speed === 0) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const scheduleNext = () => {
      // Determine delay based on the NEXT event type
      const nextEvent = replayQueue[replayIndex];
      if (!nextEvent) return;

      const baseDelay = EVENT_DELAYS[nextEvent.type] ?? DEFAULT_DELAY;
      const actualDelay = Math.max(baseDelay / speed, 30); // Floor at 30ms

      timerRef.current = setTimeout(() => {
        const hasMore = replayNext();
        if (hasMore) {
          scheduleNext();
        }
      }, actualDelay);
    };

    scheduleNext();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [replayMode, paused, speed, replayIndex, replayNext, replayQueue]);
}
