/**
 * Replay controls — stone-themed bar.
 */

import { useEffect, useRef } from 'react';
import { useGameStore } from '../../../stores/gameStore.ts';

export function ReplayControls() {
  const { replayMode, replayIndex, replayTotal, replayNext, paused, togglePause, speed, setSpeed } = useGameStore();
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!replayMode || paused) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    const delay = Math.max(100, 1500 / speed);
    timerRef.current = window.setInterval(() => {
      const hasMore = useGameStore.getState().replayNext();
      if (!hasMore) {
        if (timerRef.current) clearInterval(timerRef.current);
      }
    }, delay);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [replayMode, paused, speed]);

  if (!replayMode) return null;

  const progress = replayTotal > 0 ? (replayIndex / replayTotal) * 100 : 0;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '5px 16px',
      background: 'linear-gradient(180deg, #3a3a3a 0%, #2a2a2a 50%, #222 100%)',
      borderBottom: '2px solid #1a1a1a',
      boxShadow: 'inset 0 1px 0 #555, 0 2px 4px rgba(0,0,0,0.3)',
      fontFamily: 'Georgia, serif', color: '#c9a84c',
    }}>
      <span style={{ fontSize: 10, color: '#999', textTransform: 'uppercase', letterSpacing: 1 }}>Replay</span>

      <button
        onClick={togglePause}
        style={{
          background: 'linear-gradient(180deg, #4a4a4a, #333)',
          border: '1px solid #1a1a1a', borderRadius: 3,
          color: '#c9a84c', padding: '3px 12px', fontSize: 12, cursor: 'pointer',
          fontFamily: 'Georgia, serif',
          boxShadow: 'inset 0 1px 0 #666',
          textShadow: '0 1px 1px rgba(0,0,0,0.5)',
        }}
      >
        {paused ? 'Play' : 'Pause'}
      </button>

      <button
        onClick={() => replayNext()}
        disabled={replayIndex >= replayTotal}
        style={{
          background: 'linear-gradient(180deg, #3a3a3a, #2a2a2a)',
          border: '1px solid #1a1a1a', borderRadius: 3,
          color: '#999', padding: '3px 10px', fontSize: 11, cursor: 'pointer',
          fontFamily: 'Georgia, serif',
          boxShadow: 'inset 0 1px 0 #555',
        }}
      >
        Step
      </button>

      <select
        value={speed}
        onChange={e => setSpeed(Number(e.target.value))}
        style={{
          background: '#333', border: '1px solid #1a1a1a', borderRadius: 3,
          color: '#c9a84c', padding: '3px 6px', fontSize: 11,
          fontFamily: 'Georgia, serif',
        }}
      >
        <option value={0.5}>0.5x</option>
        <option value={1}>1x</option>
        <option value={2}>2x</option>
        <option value={4}>4x</option>
        <option value={8}>8x</option>
      </select>

      {/* Progress bar */}
      <div style={{
        flex: 1, height: 6, background: '#1a1a1a', borderRadius: 3,
        overflow: 'hidden', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5)',
      }}>
        <div style={{
          width: `${progress}%`, height: '100%',
          background: 'linear-gradient(90deg, #5c3d1a, #c9a84c)',
          borderRadius: 3, transition: 'width 0.2s',
        }} />
      </div>

      <span style={{ fontSize: 11, color: '#999', fontFamily: 'monospace', minWidth: 60, textAlign: 'right' }}>
        {replayIndex}/{replayTotal}
      </span>
    </div>
  );
}
