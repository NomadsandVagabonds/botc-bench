import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../../stores/gameStore.ts';
import { getProviderColor, shortModelName } from '../../utils/models.ts';
import type { NominationRecord, OnTheBlock, Player } from '../../types/game.ts';
import { Phase } from '../../types/game.ts';

/**
 * Parchment-style voting tracker pinned to the bottom of the map.
 * Shows nominations, vote tally, per-player vote indicators,
 * and "ON THE BLOCK" status for the current highest vote holder.
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

function VoteRow({
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
      ...row.container,
      ...(isOnTheBlock ? {
        background: 'rgba(245, 158, 11, 0.08)',
        borderLeft: '3px solid #f59e0b',
        paddingLeft: 8,
      } : {}),
    }}>
      {/* Who nominated whom */}
      <div style={row.names}>
        <span style={{ color: nominator ? getProviderColor(nominator.modelName || nominator.agentId) : '#c4a265' }}>
          {nominator ? (nominator.characterName || shortModelName(nominator.modelName || nominator.agentId)) : `Seat ${nomination.nominatorSeat}`}
        </span>
        <span style={row.arrow}>accuses</span>
        <span style={{
          color: nominee ? getProviderColor(nominee.modelName || nominee.agentId) : '#c4a265',
          fontWeight: 700,
        }}>
          {nominee ? (nominee.characterName || shortModelName(nominee.modelName || nominee.agentId)) : `Seat ${nomination.nomineeSeat}`}
        </span>
      </div>

      {/* Vote tally */}
      <div style={row.tally}>
        <span style={row.forCount}>{forCount}</span>
        <span style={row.slash}>/</span>
        <span style={row.threshold}>{threshold}</span>
        <span style={row.slash}>needed</span>
      </div>

      {/* Per-player vote dots */}
      <div style={row.dots}>
        {players
          .filter((p) => p.isAlive || !p.ghostVoteUsed)
          .map((p) => {
            const votedFor = nomination.votesFor.includes(p.seat);
            const votedAgainst = nomination.votesAgainst.includes(p.seat);
            const voted = votedFor || votedAgainst;
            return (
              <div
                key={p.seat}
                title={`${p.characterName || shortModelName(p.modelName || p.agentId)}: ${votedFor ? 'YES' : votedAgainst ? 'NO' : '...'}`}
                style={{
                  ...row.dot,
                  background: votedFor
                    ? '#4ade80'
                    : votedAgainst
                      ? '#f87171'
                      : '#5c4f3a',
                  borderColor: voted ? 'transparent' : '#8b7355',
                  color: voted ? '#1a1206' : '#8b7355',
                }}
              >
                {votedFor ? '\u270B' : votedAgainst ? '\u2715' : p.seat}
              </div>
            );
          })}
      </div>

      {/* Result — now shows outcome from the on-the-block system */}
      {label && (
        <div style={{
          ...row.result,
          color: label.color,
        }}>
          {label.text}
        </div>
      )}
    </div>
  );
}

const row: Record<string, React.CSSProperties> = {
  container: {
    padding: '6px 0',
    borderBottom: '1px solid rgba(139,115,85,0.2)',
  },
  names: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
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
    marginTop: 3,
    fontSize: 12,
  },
  forCount: {
    color: '#4ade80',
    fontWeight: 700,
    fontSize: 14,
  },
  threshold: {
    color: '#c4a265',
    fontWeight: 600,
  },
  slash: {
    color: '#8b7355',
    fontSize: 11,
  },
  dots: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 3,
    marginTop: 4,
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
  result: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
};

// ── Main overlay ──────────────────────────────────────────────────────

export function VotingOverlay() {
  const gameState = useGameStore((s) => s.gameState);

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

  return (
    <AnimatePresence>
      {isVotingPhase && currentNominations.length > 0 && (
        <motion.div
          key="voting-parchment"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 30 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          style={styles.parchment}
        >
          {/* Header */}
          <div style={styles.header}>
            <span style={styles.headerIcon}>{'\u2696'}</span>
            <span>Town Vote</span>
            <span style={styles.headerIcon}>{'\u2696'}</span>
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

          {/* Nominations */}
          <div style={styles.body}>
            {currentNominations.map((nom, i) => (
              <VoteRow
                key={`${nom.nominatorSeat}-${nom.nomineeSeat}-${i}`}
                nomination={nom}
                players={players}
                aliveCount={aliveCount}
                isOnTheBlock={onTheBlock?.seat === nom.nomineeSeat &&
                  (nom.outcome === 'on_the_block' || nom.outcome === 'replaced')}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const styles: Record<string, React.CSSProperties> = {
  parchment: {
    position: 'absolute',
    bottom: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'min(420px, 85%)',
    zIndex: 90,

    // Parchment look
    background: 'linear-gradient(180deg, #2a2115 0%, #1e180f 100%)',
    border: '2px solid #5c4f3a',
    borderRadius: 6,
    boxShadow: '0 4px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(196,162,101,0.15)',

    fontFamily: 'Georgia, "Times New Roman", serif',
    color: '#c4a265',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '8px 12px 4px',
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#d4b376',
    borderBottom: '1px solid rgba(139,115,85,0.3)',
  },
  headerIcon: {
    fontSize: 12,
    opacity: 0.6,
  },
  blockBanner: {
    padding: '4px 14px',
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: '#f59e0b',
    background: 'rgba(245, 158, 11, 0.1)',
    borderBottom: '1px solid rgba(245, 158, 11, 0.3)',
    textAlign: 'center',
  },
  body: {
    padding: '4px 14px 10px',
    maxHeight: 200,
    overflowY: 'auto',
  },
};
