import { useMemo, useCallback, useRef } from 'react';
import { useGameStore } from '../../stores/gameStore.ts';

/**
 * Timeline scrubber bar for replay mode.
 * Shows phase markers, current position, and allows click-to-seek.
 */

const PHASE_COLORS: Record<string, string> = {
  first_night: '#6366F1',
  night: '#6366F1',
  day_discussion: '#F59E0B',
  day_breakout: '#D97706',
  day_regroup: '#D97706',
  nominations: '#EF4444',
  voting: '#EF4444',
  execution: '#991B1B',
  game_over: '#10B981',
  debrief: '#8B5CF6',
};

const PHASE_LABELS: Record<string, string> = {
  first_night: 'N0',
  night: 'N',
  day_discussion: 'D',
  day_breakout: 'B',
  day_regroup: 'R',
  nominations: 'Nom',
  voting: 'V',
  execution: 'Ex',
  game_over: 'End',
  debrief: 'Deb',
};

interface PhaseMarker {
  index: number;      // event index in replay queue
  phase: string;
  day: number;
  label: string;
  color: string;
  position: number;   // 0-1 fraction along the bar
}

export function ReplayScrubber() {
  const replayMode = useGameStore((s) => s.replayMode);
  const replayQueue = useGameStore((s) => s.replayQueue);
  const replayIndex = useGameStore((s) => s.replayIndex);
  const replayTotal = useGameStore((s) => s.replayTotal);
  const replaySeekTo = useGameStore((s) => s.replaySeekTo);
  const barRef = useRef<HTMLDivElement>(null);

  // Extract phase markers from the replay queue
  const markers = useMemo((): PhaseMarker[] => {
    if (!replayQueue.length) return [];
    const result: PhaseMarker[] = [];
    let lastPhase = '';

    for (let i = 0; i < replayQueue.length; i++) {
      const evt = replayQueue[i];
      if (evt.type === 'phase.change') {
        const phase = (evt as any).phase ?? '';
        const day = (evt as any).dayNumber ?? 0;
        if (phase !== lastPhase) {
          const baseLabel = PHASE_LABELS[phase] ?? phase.slice(0, 3);
          const label = phase === 'night' ? `N${day}` : phase === 'day_discussion' ? `D${day}` : baseLabel;
          result.push({
            index: i,
            phase,
            day,
            label,
            color: PHASE_COLORS[phase] ?? '#666',
            position: i / replayQueue.length,
          });
          lastPhase = phase;
        }
      }
    }
    return result;
  }, [replayQueue]);

  const handleBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!barRef.current || !replayTotal) return;
    const rect = barRef.current.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetIndex = Math.round(fraction * replayTotal);
    replaySeekTo(targetIndex);
  }, [replayTotal, replaySeekTo]);

  const handleMarkerClick = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    replaySeekTo(index);
  }, [replaySeekTo]);

  if (!replayMode || !replayTotal) return null;

  const progress = replayTotal > 0 ? replayIndex / replayTotal : 0;

  return (
    <div style={styles.container}>
      {/* Phase marker labels above the bar */}
      <div style={styles.labels}>
        {markers.map((m, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${m.position * 100}%`,
              transform: 'translateX(-50%)',
              cursor: 'pointer',
            }}
            onClick={(e) => handleMarkerClick(m.index, e)}
            title={`${m.phase} (Day ${m.day})`}
          >
            <span style={{
              fontSize: '0.55rem',
              fontWeight: 700,
              color: m.color,
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}>
              {m.label}
            </span>
          </div>
        ))}
      </div>

      {/* Scrubber bar */}
      <div
        ref={barRef}
        style={styles.bar}
        onClick={handleBarClick}
      >
        {/* Phase colored segments */}
        {markers.map((m, i) => {
          const nextPos = i < markers.length - 1 ? markers[i + 1].position : 1;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${m.position * 100}%`,
                width: `${(nextPos - m.position) * 100}%`,
                height: '100%',
                background: `${m.color}33`,
                borderLeft: `1px solid ${m.color}66`,
              }}
            />
          );
        })}

        {/* Progress fill */}
        <div style={{
          ...styles.fill,
          width: `${progress * 100}%`,
        }} />

        {/* Playhead */}
        <div style={{
          ...styles.playhead,
          left: `${progress * 100}%`,
        }} />
      </div>

      {/* Event counter */}
      <div style={styles.counter}>
        {replayIndex} / {replayTotal}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '2px 16px 6px',
    background: 'rgba(0,0,0,0.3)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    userSelect: 'none',
  },
  labels: {
    position: 'relative',
    height: 14,
    marginBottom: 2,
  },
  bar: {
    position: 'relative',
    height: 8,
    background: 'rgba(255,255,255,0.08)',
    borderRadius: 4,
    cursor: 'pointer',
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: '100%',
    background: 'rgba(99, 102, 241, 0.4)',
    borderRadius: 4,
    transition: 'width 0.1s linear',
    pointerEvents: 'none',
  },
  playhead: {
    position: 'absolute',
    top: -2,
    width: 3,
    height: 12,
    background: '#6366F1',
    borderRadius: 2,
    transform: 'translateX(-50%)',
    boxShadow: '0 0 6px rgba(99,102,241,0.5)',
    transition: 'left 0.1s linear',
    pointerEvents: 'none',
  },
  counter: {
    fontSize: '0.55rem',
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'right',
    marginTop: 2,
    fontFamily: 'monospace',
  },
};
