import { useMemo, useState } from 'react';
import type { MonitorResult } from '../../types/monitor.ts';
import type { Player } from '../../types/game.ts';
import { Alignment } from '../../types/game.ts';

interface MonitorHeatmapProps {
  result: MonitorResult;
  players: Player[];
  currentPhaseIndex?: number;
}

/** Interpolate green -> yellow -> red based on 0-100 confidence. */
function ratingColor(value: number): string {
  const v = Math.max(0, Math.min(100, value));
  if (v <= 50) {
    // green (#22c55e) -> yellow (#eab308)
    const t = v / 50;
    const r = Math.round(0x22 + (0xea - 0x22) * t);
    const g = Math.round(0xc5 + (0xb3 - 0xc5) * t);
    const b = Math.round(0x5e + (0x08 - 0x5e) * t);
    return `rgb(${r},${g},${b})`;
  } else {
    // yellow (#eab308) -> red (#ef4444)
    const t = (v - 50) / 50;
    const r = Math.round(0xea + (0xef - 0xea) * t);
    const g = Math.round(0xb3 + (0x44 - 0xb3) * t);
    const b = Math.round(0x08 + (0x44 - 0x08) * t);
    return `rgb(${r},${g},${b})`;
  }
}

/** Short phase label for column headers. */
function phaseLabel(phase: string, day: number): string {
  switch (phase) {
    case 'first_night': return 'N0';
    case 'night': return `N${day}`;
    case 'day_discussion': return `D${day}`;
    case 'day_breakout': return `B${day}`;
    case 'day_regroup': return `R${day}`;
    case 'nominations': return `Nom${day}`;
    case 'voting': return `V${day}`;
    case 'execution': return `X${day}`;
    default: return phase.slice(0, 3).toUpperCase();
  }
}

export function MonitorHeatmap({ result, players, currentPhaseIndex }: MonitorHeatmapProps) {
  const [hoveredCell, setHoveredCell] = useState<{ seat: number; phase: number } | null>(null);

  const phases = useMemo(() => {
    if (currentPhaseIndex !== undefined) {
      return result.phases.slice(0, currentPhaseIndex + 1);
    }
    return result.phases;
  }, [result.phases, currentPhaseIndex]);

  // Build a set of bet cells for quick lookup
  const betCells = useMemo(() => {
    const set = new Set<string>();
    result.phases.forEach((p, pi) => {
      if (currentPhaseIndex !== undefined && pi > currentPhaseIndex) return;
      p.bets.forEach((seat) => set.add(`${seat}-${pi}`));
    });
    return set;
  }, [result.phases, currentPhaseIndex]);

  // Sort players by seat
  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => a.seat - b.seat),
    [players],
  );

  const CELL_SIZE = 36;
  const LABEL_WIDTH = 140;
  const TRUTH_WIDTH = 48;

  return (
    <div style={heatmapStyles.wrapper}>
      {/* Header label */}
      <div style={heatmapStyles.title}>
        Confidence Heatmap
        <span style={heatmapStyles.subtitle}>
          {phases.length} phase{phases.length !== 1 ? 's' : ''} analyzed
        </span>
      </div>

      <div style={heatmapStyles.scrollContainer}>
        <div style={{ display: 'inline-block', minWidth: '100%' }}>
          {/* Column headers */}
          <div style={{ display: 'flex', marginLeft: LABEL_WIDTH }}>
            {phases.map((p, i) => (
              <div
                key={i}
                style={{
                  width: CELL_SIZE,
                  textAlign: 'center',
                  fontSize: 10,
                  fontFamily: 'monospace',
                  color: 'rgba(255,255,255,0.5)',
                  padding: '2px 0',
                  transform: 'rotate(-45deg)',
                  transformOrigin: 'center center',
                  height: 28,
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                }}
              >
                {phaseLabel(p.phase, p.day)}
              </div>
            ))}
            {/* Truth column header */}
            <div
              style={{
                width: TRUTH_WIDTH,
                textAlign: 'center',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 700,
                color: 'rgba(255,255,255,0.7)',
                padding: '2px 0',
                height: 28,
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
              }}
            >
              Truth
            </div>
          </div>

          {/* Rows */}
          {sortedPlayers.map((player) => {
            const seatKey = String(player.seat);
            const isEvil = player.alignment === Alignment.EVIL;

            return (
              <div key={player.seat} style={heatmapStyles.row}>
                {/* Player label */}
                <div style={{
                  ...heatmapStyles.playerLabel,
                  width: LABEL_WIDTH,
                }}>
                  <span style={{
                    fontFamily: 'monospace',
                    fontSize: 10,
                    color: 'rgba(255,255,255,0.4)',
                    marginRight: 4,
                    minWidth: 16,
                  }}>
                    #{player.seat}
                  </span>
                  <span style={{
                    fontSize: 12,
                    color: '#e0e0e0',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {player.characterName}
                  </span>
                  {!player.isAlive && (
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginLeft: 4 }}>
                      dead
                    </span>
                  )}
                </div>

                {/* Rating cells */}
                {phases.map((phase, pi) => {
                  const rating = phase.ratings[seatKey];
                  const hasBet = betCells.has(`${player.seat}-${pi}`);
                  const isHovered =
                    hoveredCell?.seat === player.seat && hoveredCell?.phase === pi;

                  return (
                    <div
                      key={pi}
                      style={{
                        width: CELL_SIZE,
                        height: CELL_SIZE,
                        background: rating !== undefined
                          ? ratingColor(rating)
                          : 'rgba(255,255,255,0.04)',
                        border: isHovered
                          ? '2px solid #fff'
                          : '1px solid rgba(0,0,0,0.3)',
                        borderRadius: 3,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        cursor: 'default',
                        transition: 'border 0.1s',
                      }}
                      onMouseEnter={() => setHoveredCell({ seat: player.seat, phase: pi })}
                      onMouseLeave={() => setHoveredCell(null)}
                    >
                      {/* Show value on hover or if bet */}
                      {(isHovered || hasBet) && rating !== undefined && (
                        <span style={{
                          fontSize: hasBet ? 9 : 10,
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          color: rating > 60 ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)',
                          textShadow: rating > 60
                            ? '0 1px 2px rgba(255,255,255,0.2)'
                            : '0 1px 2px rgba(0,0,0,0.5)',
                        }}>
                          {Math.round(rating)}
                        </span>
                      )}

                      {/* Lock icon for bets */}
                      {hasBet && (
                        <span style={{
                          position: 'absolute',
                          top: 1,
                          right: 1,
                          fontSize: 8,
                          lineHeight: 1,
                        }}>
                          {result.all_bets.find(
                            (b) => b.seat === player.seat && b.phase_index === pi,
                          )?.correct
                            ? '\u2705'
                            : '\uD83D\uDD12'}
                        </span>
                      )}
                    </div>
                  );
                })}

                {/* Ground truth column */}
                <div style={{
                  width: TRUTH_WIDTH,
                  height: CELL_SIZE,
                  background: isEvil
                    ? 'rgba(239, 68, 68, 0.25)'
                    : 'rgba(34, 197, 94, 0.25)',
                  border: `1px solid ${isEvil ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)'}`,
                  borderRadius: 3,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  color: isEvil ? '#fca5a5' : '#86efac',
                }}>
                  {isEvil ? 'EVIL' : 'GOOD'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div style={heatmapStyles.legend}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Confidence evil:</span>
        <div style={heatmapStyles.legendBar}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>0</span>
          <div style={{
            flex: 1,
            height: 8,
            borderRadius: 4,
            background: 'linear-gradient(to right, #22c55e, #eab308, #ef4444)',
          }} />
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>100</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>
            \uD83D\uDD12 = bet locked
          </span>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>
            \u2705 = correct bet
          </span>
        </div>
      </div>
    </div>
  );
}

const heatmapStyles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '8px 0',
  },
  title: {
    fontSize: 13,
    fontWeight: 700,
    color: '#e0e0e0',
    padding: '0 12px',
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  },
  subtitle: {
    fontSize: 10,
    fontWeight: 400,
    color: 'rgba(255,255,255,0.35)',
  },
  scrollContainer: {
    overflowX: 'auto',
    overflowY: 'auto',
    maxHeight: 'calc(100vh - 240px)',
    padding: '4px 12px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    marginBottom: 1,
  },
  playerLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    paddingRight: 8,
    flexShrink: 0,
  },
  legend: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 12px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  legendBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    width: 120,
  },
};
