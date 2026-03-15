import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../../stores/gameStore.ts';
import { getProviderColor, shortModelName } from '../../utils/models.ts';
import type { DebriefMessage } from '../../types/game.ts';
import type { Player, NominationRecord } from '../../types/game.ts';

// ── Stats computation ──────────────────────────────────────────────

interface PlayerStats {
  seat: number;
  characterName: string;
  modelName: string;
  alignment: string;
  survived: boolean;
  nominationsMade: number;
  correctNominations: number;
  incorrectNominations: number;
  yesVotes: number;
  correctVotes: number;
  incorrectVotes: number;
}

function computePlayerStats(
  players: Player[],
  nominations: NominationRecord[],
): PlayerStats[] {
  const playerBySeat: Record<number, Player> = {};
  for (const p of players) {
    playerBySeat[p.seat] = p;
  }

  // Initialise stats
  const stats: Record<number, PlayerStats> = {};
  for (const p of players) {
    stats[p.seat] = {
      seat: p.seat,
      characterName: p.characterName || `Seat ${p.seat}`,
      modelName: p.modelName || p.agentId,
      alignment: p.alignment,
      survived: p.isAlive,
      nominationsMade: 0,
      correctNominations: 0,
      incorrectNominations: 0,
      yesVotes: 0,
      correctVotes: 0,
      incorrectVotes: 0,
    };
  }

  for (const nom of nominations) {
    const nominee = playerBySeat[nom.nomineeSeat];
    if (!nominee) continue;
    const nomineeIsEvil = nominee.alignment === 'evil';

    // Nominator stats
    const nominatorStats = stats[nom.nominatorSeat];
    if (nominatorStats) {
      nominatorStats.nominationsMade++;
      if (nomineeIsEvil) {
        nominatorStats.correctNominations++;
      } else {
        nominatorStats.incorrectNominations++;
      }
    }

    // Voter stats
    for (const voterSeat of nom.votesFor) {
      const vs = stats[voterSeat];
      if (!vs) continue;
      vs.yesVotes++;
      if (nomineeIsEvil) {
        vs.correctVotes++;
      } else {
        vs.incorrectVotes++;
      }
    }
    for (const voterSeat of nom.votesAgainst) {
      const vs = stats[voterSeat];
      if (!vs) continue;
      // Voting NO on a good player is correct
      if (!nomineeIsEvil) {
        vs.correctVotes++;
      } else {
        vs.incorrectVotes++;
      }
    }
  }

  return players.map((p) => stats[p.seat]);
}

/**
 * Post-game debrief panel.
 *
 * Shows after the game ends: a role reveal table for ALL players
 * alongside each agent's reaction to learning the truth,
 * followed by a per-player stats card.
 */
export function DebriefPanel() {
  const navigate = useNavigate();
  const gameState = useGameStore((s) => s.gameState);
  const debriefMessages = useGameStore((s) => s.debriefMessages);

  const playerStats = useMemo(() => {
    if (!gameState) return [];
    return computePlayerStats(gameState.players, gameState.nominations);
  }, [gameState]);

  if (!gameState) return null;

  const isDebrief =
    gameState.phase === 'debrief' ||
    (gameState.phase === 'game_over' && debriefMessages.length > 0);

  if (!isDebrief) return null;

  // Build a lookup from seat -> debrief message for quick access
  const debriefBySeat: Record<number, DebriefMessage> = {};
  for (const msg of debriefMessages) {
    debriefBySeat[msg.seat] = msg;
  }

  const winner = gameState.winner;

  return (
    <motion.div
      style={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8 }}
    >
      <motion.div
        style={styles.panel}
        initial={{ scale: 0.9, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.6, type: 'spring', stiffness: 120 }}
      >
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerTitle}>The Grimoire Revealed</div>
          <div style={{
            ...styles.headerWinner,
            color: winner === 'good' ? '#4ade80' : '#f87171',
          }}>
            {winner === 'good' ? 'Good Triumphs' : 'Evil Prevails'}
          </div>
          {gameState.winCondition && (
            <div style={styles.headerReason}>{gameState.winCondition}</div>
          )}
        </div>

        {/* Role reveal + reactions */}
        <div style={styles.playerList}>
          <AnimatePresence>
            {gameState.players.map((player, idx) => {
              const debrief = debriefBySeat[player.seat];
              const isEvil = player.alignment === 'evil';
              const providerColor = getProviderColor(player.modelName || player.agentId);
              const displayName = debrief?.characterName || player.characterName || shortModelName(player.modelName || player.agentId);
              const modelLabel = shortModelName(player.modelName || player.agentId);

              return (
                <motion.div
                  key={player.seat}
                  style={{
                    ...styles.playerRow,
                    borderLeft: `3px solid ${isEvil ? '#f87171' : '#4ade80'}`,
                  }}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + idx * 0.1, duration: 0.4 }}
                >
                  {/* Player info */}
                  <div style={styles.playerInfo}>
                    <div style={styles.playerNameRow}>
                      <span style={styles.characterName}>
                        {displayName}
                      </span>
                      <span style={styles.seatLabel}>Seat {player.seat}</span>
                      {!player.isAlive && (
                        <span style={styles.deadBadge}>DEAD</span>
                      )}
                    </div>
                    <div style={styles.modelRow}>
                      <span style={{ ...styles.modelLabel, color: providerColor }}>
                        {modelLabel}
                      </span>
                    </div>
                    <div style={styles.roleRow}>
                      <span style={{
                        ...styles.roleName,
                        color: isEvil ? '#f87171' : '#93c5fd',
                      }}>
                        {player.role}
                      </span>
                      <span style={{
                        ...styles.alignmentBadge,
                        background: isEvil
                          ? 'rgba(248,113,113,0.15)'
                          : 'rgba(74,222,128,0.15)',
                        color: isEvil ? '#f87171' : '#4ade80',
                      }}>
                        {player.alignment.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {/* Debrief reaction */}
                  {debrief ? (
                    <motion.div
                      style={styles.reactionBubble}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.8 + idx * 0.15, duration: 0.3 }}
                    >
                      <div style={styles.reactionText}>
                        &ldquo;{debrief.content}&rdquo;
                      </div>
                    </motion.div>
                  ) : (
                    <div style={styles.waitingReaction}>
                      <span style={styles.waitingDots}>...</span>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* ── Post-game stats ───────────────────────────────────────── */}
        {playerStats.length > 0 && (
          <motion.div
            style={styles.statsSection}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5, duration: 0.6 }}
          >
            <div style={styles.statsTitle}>Performance Ledger</div>
            <div style={styles.statsTableWrap}>
              <table style={styles.statsTable}>
                <thead>
                  <tr>
                    <th style={styles.th}>Player</th>
                    <th style={{ ...styles.th, textAlign: 'center' }}>Noms</th>
                    <th style={{ ...styles.th, textAlign: 'center' }}>Correct</th>
                    <th style={{ ...styles.th, textAlign: 'center' }}>Votes</th>
                    <th style={{ ...styles.th, textAlign: 'center' }}>Accuracy</th>
                    <th style={{ ...styles.th, textAlign: 'center' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {playerStats.map((s) => {
                    const totalVoteDecisions = s.correctVotes + s.incorrectVotes;
                    const voteAccuracy = totalVoteDecisions > 0
                      ? Math.round((s.correctVotes / totalVoteDecisions) * 100)
                      : null;
                    const isEvil = s.alignment === 'evil';
                    const providerColor = getProviderColor(s.modelName);

                    return (
                      <tr key={s.seat} style={styles.statsRow}>
                        <td style={styles.td}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span style={{ fontWeight: 600, fontSize: 12, color: '#d4c4a0' }}>
                              {s.characterName}
                            </span>
                            <span style={{ fontSize: 10, color: providerColor }}>
                              {shortModelName(s.modelName)}
                            </span>
                          </div>
                        </td>
                        <td style={{ ...styles.td, textAlign: 'center' }}>
                          {s.nominationsMade > 0 ? (
                            <span>
                              {s.nominationsMade}
                              {' '}
                              <span style={{ fontSize: 10 }}>
                                (<span style={{ color: '#4ade80' }}>{s.correctNominations}</span>
                                /
                                <span style={{ color: '#f87171' }}>{s.incorrectNominations}</span>)
                              </span>
                            </span>
                          ) : (
                            <span style={{ color: 'rgba(255,255,255,0.2)' }}>--</span>
                          )}
                        </td>
                        <td style={{ ...styles.td, textAlign: 'center' }}>
                          {s.nominationsMade > 0 ? (
                            <span style={{
                              color: s.correctNominations > s.incorrectNominations ? '#4ade80'
                                : s.correctNominations < s.incorrectNominations ? '#f87171'
                                : '#d4c4a0'
                            }}>
                              {s.correctNominations}/{s.nominationsMade}
                            </span>
                          ) : (
                            <span style={{ color: 'rgba(255,255,255,0.2)' }}>--</span>
                          )}
                        </td>
                        <td style={{ ...styles.td, textAlign: 'center' }}>
                          {s.yesVotes > 0 ? (
                            <span>{s.yesVotes} YES</span>
                          ) : (
                            <span style={{ color: 'rgba(255,255,255,0.2)' }}>--</span>
                          )}
                        </td>
                        <td style={{ ...styles.td, textAlign: 'center' }}>
                          {voteAccuracy != null ? (
                            <span style={{
                              color: voteAccuracy >= 60 ? '#4ade80'
                                : voteAccuracy >= 40 ? '#fbbf24'
                                : '#f87171',
                              fontWeight: 600,
                            }}>
                              {voteAccuracy}%
                            </span>
                          ) : (
                            <span style={{ color: 'rgba(255,255,255,0.2)' }}>--</span>
                          )}
                        </td>
                        <td style={{ ...styles.td, textAlign: 'center' }}>
                          <span style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: 3,
                            letterSpacing: '0.05em',
                            background: s.survived
                              ? 'rgba(74,222,128,0.12)'
                              : 'rgba(255,255,255,0.06)',
                            color: s.survived ? '#4ade80' : '#888',
                          }}>
                            {s.survived ? 'ALIVE' : 'DEAD'}
                          </span>
                          <span style={{
                            fontSize: 9,
                            fontWeight: 700,
                            marginLeft: 4,
                            padding: '2px 6px',
                            borderRadius: 3,
                            background: isEvil
                              ? 'rgba(248,113,113,0.12)'
                              : 'rgba(74,222,128,0.12)',
                            color: isEvil ? '#f87171' : '#4ade80',
                          }}>
                            {s.alignment.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={styles.statsLegend}>
              Noms = nominations made (<span style={{ color: '#4ade80' }}>hit evil</span> / <span style={{ color: '#f87171' }}>hit good</span>).
              Accuracy = % of vote decisions (YES/NO) that targeted the correct alignment.
            </div>
          </motion.div>
        )}

        {/* ── Back to Lobby button ──────────────────────────────────── */}
        <motion.div
          style={styles.lobbyButtonWrap}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.0, duration: 0.4 }}
        >
          <button
            style={styles.lobbyButton}
            onClick={() => navigate('/')}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                'rgba(196,162,101,0.25)';
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                'rgba(196,162,101,0.6)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                'rgba(196,162,101,0.1)';
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                'rgba(196,162,101,0.35)';
            }}
          >
            Back to Lobby
          </button>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(8, 6, 3, 0.88)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 210,
    padding: 20,
  },
  panel: {
    width: '100%',
    maxWidth: 700,
    maxHeight: '85vh',
    overflowY: 'auto',
    background: 'linear-gradient(180deg, rgba(35,28,18,0.97) 0%, rgba(22,18,10,0.98) 100%)',
    border: '2px solid rgba(196,162,101,0.35)',
    borderRadius: 12,
    boxShadow: '0 12px 60px rgba(0,0,0,0.7), 0 0 80px rgba(196,162,101,0.08)',
    padding: '0 0 16px 0',
  },
  header: {
    textAlign: 'center' as const,
    padding: '28px 24px 20px',
    borderBottom: '1px solid rgba(196,162,101,0.2)',
    marginBottom: 8,
  },
  headerTitle: {
    fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
    fontSize: 'clamp(14px, 1.8vw, 20px)',
    fontStyle: 'italic',
    color: '#c4a265',
    letterSpacing: '0.15em',
    marginBottom: 6,
    textTransform: 'uppercase' as const,
  },
  headerWinner: {
    fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
    fontSize: 'clamp(22px, 3vw, 36px)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textShadow: '0 0 20px currentColor',
    marginBottom: 8,
  },
  headerReason: {
    fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
    fontSize: 'clamp(11px, 1.2vw, 14px)',
    fontStyle: 'italic',
    color: '#a89070',
  },
  playerList: {
    padding: '0 16px',
  },
  playerRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '10px 12px',
    marginBottom: 4,
    borderRadius: 6,
    background: 'rgba(255,255,255,0.02)',
  },
  playerInfo: {
    minWidth: 160,
    flexShrink: 0,
  },
  playerNameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  characterName: {
    fontWeight: 700,
    fontSize: 14,
    color: '#e8d8b4',
    fontFamily: 'Georgia, serif',
  },
  modelRow: {
    marginBottom: 2,
  },
  modelLabel: {
    fontSize: 10,
    fontWeight: 600,
  },
  seatLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
  },
  deadBadge: {
    fontSize: 9,
    fontWeight: 700,
    color: '#888',
    background: 'rgba(255,255,255,0.06)',
    padding: '1px 5px',
    borderRadius: 3,
    letterSpacing: '0.05em',
  },
  roleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  roleName: {
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'Georgia, serif',
  },
  alignmentBadge: {
    fontSize: 9,
    fontWeight: 700,
    padding: '1px 6px',
    borderRadius: 3,
    letterSpacing: '0.08em',
  },
  reactionBubble: {
    flex: 1,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
    padding: '8px 12px',
    borderLeft: '2px solid rgba(196,162,101,0.2)',
  },
  reactionText: {
    fontSize: 12,
    lineHeight: 1.5,
    color: '#d4c4a0',
    fontFamily: 'Georgia, serif',
    fontStyle: 'italic',
  },
  waitingReaction: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
  },
  waitingDots: {
    color: 'rgba(196,162,101,0.3)',
    fontSize: 16,
    letterSpacing: 3,
  },

  // ── Stats section ──────────────────────────────────────────────
  statsSection: {
    margin: '16px 16px 0',
    padding: '16px',
    borderTop: '1px solid rgba(196,162,101,0.2)',
  },
  statsTitle: {
    fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
    fontSize: 'clamp(13px, 1.5vw, 16px)',
    fontStyle: 'italic',
    color: '#c4a265',
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    textAlign: 'center' as const,
    marginBottom: 12,
  },
  statsTableWrap: {
    overflowX: 'auto' as const,
  },
  statsTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 12,
    color: '#d4c4a0',
  },
  th: {
    fontFamily: 'Georgia, serif',
    fontSize: 10,
    fontWeight: 700,
    color: '#a89070',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    padding: '6px 8px',
    borderBottom: '1px solid rgba(196,162,101,0.15)',
    textAlign: 'left' as const,
  },
  statsRow: {
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  td: {
    padding: '6px 8px',
    verticalAlign: 'middle' as const,
  },
  statsLegend: {
    marginTop: 8,
    fontSize: 10,
    color: 'rgba(168,144,112,0.6)',
    fontStyle: 'italic',
    textAlign: 'center' as const,
  },

  // ── Back to Lobby ──────────────────────────────────────────────
  lobbyButtonWrap: {
    display: 'flex',
    justifyContent: 'center',
    padding: '16px 16px 8px',
  },
  lobbyButton: {
    fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
    fontSize: 14,
    fontWeight: 600,
    color: '#c4a265',
    background: 'rgba(196,162,101,0.1)',
    border: '1px solid rgba(196,162,101,0.35)',
    borderRadius: 6,
    padding: '10px 28px',
    cursor: 'pointer',
    letterSpacing: '0.08em',
    transition: 'background 0.2s, border-color 0.2s',
  },
};
