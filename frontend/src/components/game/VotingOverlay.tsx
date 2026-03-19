import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../../stores/gameStore.ts';
import { getProviderColor, shortModelName } from '../../utils/models.ts';
import type { NominationRecord, OnTheBlock, Player } from '../../types/game.ts';
import { Phase } from '../../types/game.ts';

/**
 * Compact voting tracker pinned to the bottom center of the map.
 * Shows one nomination at a time with prev/next navigation.
 */

function outcomeLabel(outcome: string | null): { text: string; color: string } | null {
  switch (outcome) {
    case 'on_the_block':
    case 'replaced':
      return { text: 'ON THE BLOCK', color: '#f59e0b' };
    case 'tied':
      return { text: 'TIED — FREED', color: '#8b7355' };
    case 'failed':
      return { text: 'FAILED', color: '#4ade80' };
    default:
      return null;
  }
}

function VoteCard({
  nomination,
  players,
  aliveCount,
  isOnTheBlock,
}: {
  nomination: NominationRecord;
  players: Player[];
  aliveCount: number;
  isOnTheBlock: boolean;
}) {
  const nominator = players.find((p) => p.seat === nomination.nominatorSeat);
  const nominee = players.find((p) => p.seat === nomination.nomineeSeat);
  const forCount = nomination.votesFor.length;
  const threshold = Math.ceil(aliveCount / 2);
  const label = outcomeLabel(nomination.outcome);

  return (
    <div style={{
      ...(isOnTheBlock ? {
        borderLeft: '3px solid #f59e0b',
        paddingLeft: 8,
      } : {}),
    }}>
      {/* Who nominated whom + tally on same line */}
      <div style={card.row}>
        <div style={card.names}>
          <span style={{ color: nominator ? getProviderColor(nominator.modelName || nominator.agentId) : '#c4a265', fontWeight: 700 }}>
            {nominator ? (nominator.characterName || shortModelName(nominator.modelName || nominator.agentId)) : `Seat ${nomination.nominatorSeat}`}
          </span>
          <span style={card.arrow}>accuses</span>
          <span style={{
            color: nominee ? getProviderColor(nominee.modelName || nominee.agentId) : '#c4a265',
            fontWeight: 700,
          }}>
            {nominee ? (nominee.characterName || shortModelName(nominee.modelName || nominee.agentId)) : `Seat ${nomination.nomineeSeat}`}
          </span>
        </div>
        <div style={card.tally}>
          <span style={{ color: '#4ade80', fontWeight: 700 }}>{forCount}</span>
          <span style={card.slash}>/</span>
          <span style={{ color: '#c4a265', fontWeight: 600 }}>{threshold}</span>
          {label && (
            <span style={{ color: label.color, fontWeight: 800, fontSize: 11, marginLeft: 6, letterSpacing: '0.04em' }}>
              {label.text}
            </span>
          )}
        </div>
      </div>

      {/* Per-player vote dots */}
      <div style={card.dots}>
        {players
          .filter((p) => p.isAlive || !p.ghostVoteUsed)
          .map((p) => {
            const votedFor = nomination.votesFor.includes(p.seat);
            const votedAgainst = nomination.votesAgainst.includes(p.seat);
            const voted = votedFor || votedAgainst;
            const isGhostVote = votedFor && !p.isAlive;
            return (
              <div
                key={p.seat}
                title={`${p.characterName || shortModelName(p.modelName || p.agentId)}: ${isGhostVote ? 'GHOST VOTE' : votedFor ? 'YES' : votedAgainst ? 'NO' : '...'}`}
                style={{
                  ...card.dot,
                  background: isGhostVote
                    ? '#6ee7b7'
                    : votedFor
                      ? '#4ade80'
                      : votedAgainst
                        ? '#f87171'
                        : '#5c4f3a',
                  borderColor: isGhostVote ? '#4ade80' : voted ? 'transparent' : '#8b7355',
                  color: voted ? '#1a1206' : '#8b7355',
                }}
              >
                {isGhostVote ? '\uD83D\uDC7B' : votedFor ? '\u270B' : votedAgainst ? '\u2715' : p.seat}
              </div>
            );
          })}
      </div>
    </div>
  );
}

const card: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  names: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
  },
  arrow: {
    color: '#8b7355',
    fontSize: 11,
    fontStyle: 'italic',
  },
  tally: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 13,
  },
  slash: {
    color: '#8b7355',
    fontSize: 11,
  },
  dots: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 3,
    marginTop: 5,
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid',
    transition: 'background 0.3s',
  },
};

// ── Main overlay ──────────────────────────────────────────────────────

export function VotingOverlay() {
  const gameState = useGameStore((s) => s.gameState);
  const [viewIndex, setViewIndex] = useState<number | null>(null);

  const isVotingPhase = gameState?.phase === Phase.VOTING ||
    gameState?.phase === Phase.NOMINATIONS ||
    gameState?.phase === Phase.EXECUTION;

  const players = gameState?.players ?? [];
  const aliveCount = players.filter((p) => p.isAlive).length;
  const onTheBlock: OnTheBlock | null = gameState?.onTheBlock ?? null;

  const currentNominations = useMemo(() => {
    if (!gameState) return [];
    return gameState.nominations;
  }, [gameState?.nominations]);

  // Show the latest nomination by default, or the user-selected one
  const total = currentNominations.length;
  const activeIndex = viewIndex !== null ? Math.min(viewIndex, total - 1) : total - 1;
  const activeNom = total > 0 ? currentNominations[activeIndex] : null;

  // Auto-follow latest when new nominations arrive
  const prevTotal = useMemo(() => total, [total]);
  if (viewIndex !== null && total > prevTotal) {
    // New nomination arrived — jump to it
    setViewIndex(null);
  }

  return (
    <AnimatePresence>
      {isVotingPhase && activeNom && (
        <motion.div
          key="voting-parchment"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          style={styles.parchment}
        >
          {/* Header with nav */}
          <div style={styles.header}>
            {total > 1 && (
              <button
                style={styles.navBtn}
                onClick={() => setViewIndex(Math.max(0, activeIndex - 1))}
                disabled={activeIndex === 0}
              >
                {'\u25C0'}
              </button>
            )}
            <span style={styles.headerTitle}>
              {'\u2696'} Vote {activeIndex + 1}/{total} {'\u2696'}
            </span>
            {total > 1 && (
              <button
                style={styles.navBtn}
                onClick={() => setViewIndex(activeIndex + 1 >= total ? null : activeIndex + 1)}
                disabled={viewIndex === null && activeIndex === total - 1}
              >
                {'\u25B6'}
              </button>
            )}
          </div>

          {/* On the block banner */}
          {onTheBlock && (
            <div style={styles.blockBanner}>
              {(() => {
                const blockedPlayer = players.find(p => p.seat === onTheBlock.seat);
                const name = blockedPlayer?.characterName || `Seat ${onTheBlock.seat}`;
                return `${name} is ON THE BLOCK (${onTheBlock.voteCount} votes)`;
              })()}
            </div>
          )}

          {/* Single nomination card */}
          <div style={styles.body}>
            <VoteCard
              nomination={activeNom}
              players={players}
              aliveCount={aliveCount}
              isOnTheBlock={onTheBlock?.seat === activeNom.nomineeSeat &&
                (activeNom.outcome === 'on_the_block' || activeNom.outcome === 'replaced')}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const styles: Record<string, React.CSSProperties> = {
  parchment: {
    width: '100%',

    background: 'linear-gradient(180deg, #2a2115 0%, #1e180f 100%)',
    borderTop: '1px solid #5c4f3a',

    fontFamily: 'Georgia, "Times New Roman", serif',
    color: '#c4a265',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '6px 12px 4px',
    borderBottom: '1px solid rgba(139,115,85,0.3)',
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#d4b376',
  },
  navBtn: {
    background: 'none',
    border: 'none',
    color: '#c4a265',
    cursor: 'pointer',
    fontSize: 10,
    padding: '2px 6px',
    opacity: 0.7,
  },
  blockBanner: {
    padding: '3px 14px',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: '#f59e0b',
    background: 'rgba(245, 158, 11, 0.1)',
    borderBottom: '1px solid rgba(245, 158, 11, 0.3)',
    textAlign: 'center',
  },
  body: {
    padding: '6px 14px 8px',
  },
};
