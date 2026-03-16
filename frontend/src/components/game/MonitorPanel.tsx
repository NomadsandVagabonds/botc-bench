import { useState, useMemo } from 'react';
import type { MonitorResult, MonitorPhaseAssessment } from '../../types/monitor.ts';
import type { Player } from '../../types/game.ts';
import { Alignment } from '../../types/game.ts';
import { MonitorHeatmap } from './MonitorHeatmap.tsx';
import { getProviderColor, shortModelName } from '../../utils/models.ts';

interface MonitorPanelProps {
  result: MonitorResult;
  players: Player[];
  currentPhaseIndex?: number;
  allResults?: MonitorResult[];
  selectedId?: string | null;
  onSelectResult?: (monitorId: string) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Interpolate green -> yellow -> red for 0-100. */
function ratingBarColor(value: number): string {
  const v = Math.max(0, Math.min(100, value));
  if (v <= 50) {
    const t = v / 50;
    const r = Math.round(0x22 + (0xea - 0x22) * t);
    const g = Math.round(0xc5 + (0xb3 - 0xc5) * t);
    const b = Math.round(0x5e + (0x08 - 0x5e) * t);
    return `rgb(${r},${g},${b})`;
  }
  const t = (v - 50) / 50;
  const r = Math.round(0xea + (0xef - 0xea) * t);
  const g = Math.round(0xb3 + (0x44 - 0xb3) * t);
  const b = Math.round(0x08 + (0x44 - 0x08) * t);
  return `rgb(${r},${g},${b})`;
}

/** Human-readable phase name. */
function formatPhase(phase: string, day: number): string {
  switch (phase) {
    case 'first_night': return 'Night 0';
    case 'night': return `Night ${day}`;
    case 'day_discussion': return `Day ${day} \u2014 Discussion`;
    case 'day_breakout': return `Day ${day} \u2014 Breakout`;
    case 'day_regroup': return `Day ${day} \u2014 Regroup`;
    case 'nominations': return `Day ${day} \u2014 Nominations`;
    case 'voting': return `Day ${day} \u2014 Voting`;
    case 'execution': return `Day ${day} \u2014 Execution`;
    case 'setup': return 'Setup';
    default: return phase;
  }
}

// ── Phase Card ──────────────────────────────────────────────────────

function PhaseCard({
  assessment,
  phaseIndex,
  players,
  expanded,
  onToggle,
  betsForPhase,
}: {
  assessment: MonitorPhaseAssessment;
  phaseIndex: number;
  players: Player[];
  expanded: boolean;
  onToggle: () => void;
  betsForPhase: Array<{ seat: number; correct: boolean }>;
}) {
  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => a.seat - b.seat),
    [players],
  );

  const isNight = assessment.phase.includes('night');

  return (
    <div style={{
      ...cardStyles.card,
      borderLeftColor: isNight ? '#6366f1' : '#f59e0b',
    }}>
      {/* Phase header */}
      <div style={cardStyles.header} onClick={onToggle}>
        <div style={cardStyles.headerLeft}>
          <span style={{
            ...cardStyles.phaseIcon,
            color: isNight ? '#818cf8' : '#fbbf24',
          }}>
            {isNight ? '\u263D' : '\u2600'}
          </span>
          <span style={cardStyles.phaseLabel}>
            {formatPhase(assessment.phase, assessment.day)}
          </span>
        </div>
        <div style={cardStyles.headerRight}>
          {betsForPhase.length > 0 && (
            <span style={cardStyles.betCount}>
              {betsForPhase.length} bet{betsForPhase.length !== 1 ? 's' : ''}
            </span>
          )}
          <span style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.3)',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 0.2s',
            display: 'inline-block',
          }}>
            {'\u25BC'}
          </span>
        </div>
      </div>

      {/* Analysis text */}
      <div
        style={{
          ...cardStyles.analysis,
          ...(expanded ? cardStyles.analysisExpanded : cardStyles.analysisCollapsed),
        }}
        onClick={onToggle}
      >
        {assessment.analysis.split('\n').map((line, i) => (
          <p key={i} style={{ margin: '0 0 4px 0' }}>
            {line.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
              part.startsWith('**') && part.endsWith('**')
                ? <strong key={j} style={{ color: '#e0e0e0', fontWeight: 600 }}>{part.slice(2, -2)}</strong>
                : part
            )}
          </p>
        ))}
      </div>

      {/* Compact ratings bars */}
      <div style={cardStyles.ratingsGrid}>
        {sortedPlayers.map((player) => {
          const rating = assessment.ratings[String(player.seat)];
          if (rating === undefined) return null;
          const isEvil = player.alignment === Alignment.EVIL;
          const hasBet = betsForPhase.some((b) => b.seat === player.seat);
          const betCorrect = betsForPhase.find((b) => b.seat === player.seat)?.correct;

          return (
            <div key={player.seat} style={cardStyles.ratingRow}>
              <span style={{
                ...cardStyles.ratingName,
                color: isEvil ? 'rgba(252,165,165,0.7)' : 'rgba(255,255,255,0.6)',
              }} title={`${player.characterName} (Seat ${player.seat})`}>
                {player.characterName.slice(0, 5)}
              </span>
              <div style={cardStyles.barTrack}>
                <div style={{
                  width: `${Math.max(2, rating)}%`,
                  height: '100%',
                  background: ratingBarColor(rating),
                  borderRadius: 2,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <span style={{
                ...cardStyles.ratingValue,
                color: ratingBarColor(rating),
              }}>
                {Math.round(rating)}
              </span>
              {hasBet && (
                <span style={{
                  fontSize: 10,
                  marginLeft: 2,
                  color: betCorrect ? '#22c55e' : '#ef4444',
                }}>
                  {betCorrect ? '\u2713' : '\u2717'}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Bet badges */}
      {betsForPhase.length > 0 && (
        <div style={cardStyles.betRow}>
          {betsForPhase.map((bet) => {
            const player = players.find((p) => p.seat === bet.seat);
            return (
              <span
                key={bet.seat}
                style={{
                  ...cardStyles.betBadge,
                  background: bet.correct
                    ? 'rgba(34, 197, 94, 0.15)'
                    : 'rgba(239, 68, 68, 0.15)',
                  borderColor: bet.correct
                    ? 'rgba(34, 197, 94, 0.4)'
                    : 'rgba(239, 68, 68, 0.4)',
                  color: bet.correct ? '#86efac' : '#fca5a5',
                }}
              >
                {'\uD83D\uDD12'} #{bet.seat} {player?.characterName ?? ''}
                {bet.correct ? ' \u2713' : ' \u2717'}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Scores Display ──────────────────────────────────────────────────

function ScoresBar({ result }: { result: MonitorResult }) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const { scores, token_summary, duration_seconds } = result;

  return (
    <div
      style={scoresStyles.wrapper}
      onMouseEnter={() => setShowBreakdown(true)}
      onMouseLeave={() => setShowBreakdown(false)}
    >
      <div style={scoresStyles.totalScore}>
        <span style={scoresStyles.totalValue}>
          {scores.total.toFixed(1)}
        </span>
        <span style={scoresStyles.totalLabel}>score</span>
      </div>

      {showBreakdown && (
        <div style={scoresStyles.breakdown}>
          <div style={scoresStyles.breakdownRow}>
            <span style={scoresStyles.breakdownLabel}>Alignment Acc</span>
            <span style={scoresStyles.breakdownValue}>
              {(scores.alignment_accuracy * 100).toFixed(1)}%
            </span>
          </div>
          <div style={scoresStyles.breakdownRow}>
            <span style={scoresStyles.breakdownLabel}>Bet Accuracy</span>
            <span style={scoresStyles.breakdownValue}>
              {(scores.bet_accuracy * 100).toFixed(1)}%
            </span>
          </div>
          <div style={scoresStyles.breakdownRow}>
            <span style={scoresStyles.breakdownLabel}>AUC</span>
            <span style={scoresStyles.breakdownValue}>
              {scores.auc.toFixed(3)}
            </span>
          </div>
          <div style={{ ...scoresStyles.breakdownRow, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 4, marginTop: 2 }}>
            <span style={scoresStyles.breakdownLabel}>Cost</span>
            <span style={scoresStyles.breakdownValue}>
              ${token_summary.total_cost_usd.toFixed(4)}
            </span>
          </div>
          <div style={scoresStyles.breakdownRow}>
            <span style={scoresStyles.breakdownLabel}>Duration</span>
            <span style={scoresStyles.breakdownValue}>
              {duration_seconds.toFixed(1)}s
            </span>
          </div>
          <div style={scoresStyles.breakdownRow}>
            <span style={scoresStyles.breakdownLabel}>Tokens</span>
            <span style={scoresStyles.breakdownValue}>
              {(token_summary.input_tokens + token_summary.output_tokens).toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Bottom Ratings Bar ──────────────────────────────────────────────

function CurrentRatingsBar({
  ratings,
  players,
}: {
  ratings: Record<string, number>;
  players: Player[];
}) {
  const sorted = useMemo(
    () => [...players].sort((a, b) => a.seat - b.seat),
    [players],
  );

  return (
    <div style={bottomBarStyles.wrapper}>
      {sorted.map((player) => {
        const rating = ratings[String(player.seat)];
        if (rating === undefined) return null;
        return (
          <div key={player.seat} style={bottomBarStyles.cell}>
            <div style={{
              ...bottomBarStyles.bar,
              height: `${Math.max(4, rating)}%`,
              background: ratingBarColor(rating),
            }} />
            <span style={bottomBarStyles.label}>
              {player.characterName.slice(0, 4)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Panel ──────────────────────────────────────────────────────

export function MonitorPanel({ result, players, currentPhaseIndex, allResults, selectedId, onSelectResult }: MonitorPanelProps) {
  const [view, setView] = useState<'timeline' | 'heatmap'>('timeline');
  const [expandedPhase, setExpandedPhase] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const hasMultiple = (allResults?.length ?? 0) > 1;

  const visiblePhases = useMemo(() => {
    if (currentPhaseIndex !== undefined) {
      return result.phases.slice(0, currentPhaseIndex + 1);
    }
    return result.phases;
  }, [result.phases, currentPhaseIndex]);

  // Build bets lookup by phase index
  const betsByPhase = useMemo(() => {
    const map = new Map<number, Array<{ seat: number; correct: boolean }>>();
    for (const bet of result.all_bets) {
      if (currentPhaseIndex !== undefined && bet.phase_index > currentPhaseIndex) continue;
      const existing = map.get(bet.phase_index) ?? [];
      existing.push({ seat: bet.seat, correct: bet.correct });
      map.set(bet.phase_index, existing);
    }
    return map;
  }, [result.all_bets, currentPhaseIndex]);

  // Ratings from the last visible phase (for bottom bar)
  const currentRatings = useMemo(() => {
    if (visiblePhases.length === 0) return result.final_ratings;
    return visiblePhases[visiblePhases.length - 1].ratings;
  }, [visiblePhases, result.final_ratings]);

  const providerColor = getProviderColor(result.config.model);
  const modelLabel = shortModelName(result.config.model);

  return (
    <div style={panelStyles.container}>
      {/* Header */}
      <div style={panelStyles.header}>
        <div style={{ ...panelStyles.headerLeft, position: 'relative' }}>
          {/* Model badge — clickable if multiple results */}
          <div
            style={{
              ...panelStyles.modelBadge,
              background: `${providerColor}20`,
              borderColor: `${providerColor}50`,
              cursor: hasMultiple ? 'pointer' : 'default',
            }}
            onClick={hasMultiple ? () => setShowPicker(!showPicker) : undefined}
          >
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: providerColor,
              flexShrink: 0,
            }} />
            <span style={{ color: providerColor, fontWeight: 600 }}>
              {modelLabel}
            </span>
            {hasMultiple && (
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, marginLeft: 2 }}>
                {'\u25BC'}
              </span>
            )}
          </div>
          <span style={panelStyles.monitorLabel}>Monitor</span>

          {/* Picker dropdown */}
          {showPicker && allResults && onSelectResult && (
            <div style={panelStyles.pickerDropdown}>
              {allResults.map((r) => {
                const pc = getProviderColor(r.config.model);
                const ml = shortModelName(r.config.model);
                const isSelected = r.monitor_id === selectedId;
                return (
                  <div
                    key={r.monitor_id}
                    onClick={() => { onSelectResult(r.monitor_id); setShowPicker(false); }}
                    style={{
                      ...panelStyles.pickerItem,
                      background: isSelected ? 'rgba(124, 58, 237, 0.15)' : 'transparent',
                    }}
                  >
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: pc, flexShrink: 0 }} />
                    <span style={{ color: pc, fontWeight: 600, fontSize: 11 }}>{ml}</span>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontFamily: 'monospace' }}>
                      {r.scores.total.toFixed(1)}
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9 }}>
                      {r.monitor_id.slice(0, 6)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <ScoresBar result={result} />
      </div>

      {/* Tab bar */}
      <div style={panelStyles.tabs}>
        <button
          style={{
            ...panelStyles.tab,
            ...(view === 'timeline' ? panelStyles.tabActive : {}),
          }}
          onClick={() => setView('timeline')}
        >
          Timeline
        </button>
        <button
          style={{
            ...panelStyles.tab,
            ...(view === 'heatmap' ? panelStyles.tabActive : {}),
          }}
          onClick={() => setView('heatmap')}
        >
          Heatmap
        </button>
        <div style={{ flex: 1 }} />
        <span style={panelStyles.phaseCount}>
          {visiblePhases.length}/{result.phases.length} phases
        </span>
      </div>

      {/* Content */}
      <div style={panelStyles.content}>
        {view === 'timeline' ? (
          <div style={panelStyles.timeline}>
            {visiblePhases.map((phase, i) => (
              <PhaseCard
                key={i}
                assessment={phase}
                phaseIndex={i}
                players={players}
                expanded={expandedPhase === i}
                onToggle={() => setExpandedPhase(expandedPhase === i ? null : i)}
                betsForPhase={betsByPhase.get(i) ?? []}
              />
            ))}
            {visiblePhases.length === 0 && (
              <div style={panelStyles.empty}>
                No phases analyzed yet.
              </div>
            )}
          </div>
        ) : (
          <MonitorHeatmap
            result={result}
            players={players}
            currentPhaseIndex={currentPhaseIndex}
          />
        )}
      </div>

      {/* Bottom ratings bar */}
      <CurrentRatingsBar ratings={currentRatings} players={players} />
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const panelStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#1a1a2e',
    borderLeft: '1px solid rgba(255,255,255,0.08)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.03)',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    gap: 8,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  modelBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 8px',
    borderRadius: 6,
    border: '1px solid',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  monitorLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  },
  pickerDropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    marginTop: 4,
    zIndex: 50,
    background: '#1e1e36',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 6,
    padding: 4,
    minWidth: 200,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  pickerItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 8px',
    borderRadius: 4,
    cursor: 'pointer',
  } as React.CSSProperties,
  tabs: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: '4px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  tab: {
    padding: '5px 12px',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.4)',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
    transition: 'color 0.15s, border-color 0.15s',
  },
  tabActive: {
    color: '#e0e0e0',
    borderBottomColor: '#7c3aed',
  },
  phaseCount: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: 'rgba(255,255,255,0.25)',
  },
  content: {
    flex: 1,
    overflow: 'auto',
  },
  timeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '8px 8px',
  },
  empty: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.3)',
    fontSize: 13,
    padding: '40px 0',
  },
};

const cardStyles: Record<string, React.CSSProperties> = {
  card: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderLeft: '3px solid',
    borderRadius: 6,
    padding: '8px 10px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    marginBottom: 6,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  phaseIcon: {
    fontSize: 14,
  },
  phaseLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: '#e0e0e0',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  betCount: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#c084fc',
    background: 'rgba(192, 132, 252, 0.1)',
    padding: '1px 6px',
    borderRadius: 4,
  },
  analysis: {
    fontSize: 11,
    lineHeight: '1.6',
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 8,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    cursor: 'pointer',
  },
  analysisCollapsed: {
    maxHeight: 40,
    overflow: 'hidden',
    WebkitMaskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)',
    maskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)',
  } as React.CSSProperties,
  analysisExpanded: {
    maxHeight: 'none',
    overflow: 'visible',
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11.5,
    lineHeight: '1.7',
    paddingBottom: 4,
  } as React.CSSProperties,
  ratingsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  ratingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    height: 16,
  },
  ratingName: {
    fontSize: 10,
    fontFamily: 'monospace',
    width: 38,
    textAlign: 'right' as const,
    flexShrink: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
  barTrack: {
    flex: 1,
    height: 6,
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  ratingValue: {
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: 700,
    width: 24,
    textAlign: 'right' as const,
    flexShrink: 0,
  },
  betRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
    paddingTop: 6,
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  betBadge: {
    fontSize: 10,
    fontFamily: 'monospace',
    padding: '2px 6px',
    borderRadius: 4,
    border: '1px solid',
    whiteSpace: 'nowrap' as const,
  },
};

const scoresStyles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'relative',
    cursor: 'default',
  },
  totalScore: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 4,
  },
  totalValue: {
    fontSize: 20,
    fontWeight: 700,
    fontFamily: 'monospace',
    color: '#c084fc',
  },
  totalLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: 'monospace',
  },
  breakdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    background: '#16213e',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    padding: '8px 12px',
    zIndex: 50,
    minWidth: 180,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  breakdownRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    padding: '2px 0',
  },
  breakdownLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
  },
  breakdownValue: {
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 600,
    color: '#e0e0e0',
  },
};

const bottomBarStyles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 2,
    padding: '6px 12px 8px',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(0,0,0,0.15)',
    height: 52,
  },
  cell: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    height: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '80%',
    borderRadius: 2,
    minHeight: 2,
    transition: 'height 0.3s ease, background 0.3s ease',
  },
  label: {
    fontSize: 8,
    fontFamily: 'monospace',
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center' as const,
    lineHeight: 1,
  },
};
