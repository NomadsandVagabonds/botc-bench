import { useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../../stores/gameStore.ts';
import type { ReasoningEntry } from '../../stores/gameStore.ts';
import { getProviderColor, getRoleTypeColor, getPhaseLabel, getPhaseColor } from '../../utils/models.ts';
import type { Player } from '../../types/game.ts';
import { pickSpriteIds } from '../../data/characters.ts';

// ── Status pills ──────────────────────────────────────────────────────

function StatusPill({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: '0.72rem',
        fontWeight: 600,
        background: `${color}22`,
        color,
        border: `1px solid ${color}33`,
      }}
    >
      {label}
    </span>
  );
}

// ── Role info ─────────────────────────────────────────────────────────

const ROLE_ABILITIES: Record<string, string> = {
  washerwoman: 'You start knowing that 1 of 2 players is a particular Townsfolk.',
  librarian: 'You start knowing that 1 of 2 players is a particular Outsider (or that zero are in play).',
  investigator: 'You start knowing that 1 of 2 players is a particular Minion.',
  chef: 'You start knowing how many pairs of evil players there are.',
  empath: 'Each night, you learn how many of your 2 alive neighbours are evil.',
  fortune_teller: 'Each night, choose 2 players: you learn if either is a Demon. There is a good player that registers as a Demon to you.',
  undertaker: 'Each night (except the first), you learn which role the player executed today was.',
  monk: 'Each night (except the first), choose a player (not yourself): they are safe from the Demon tonight.',
  ravenkeeper: 'If you die at night, you are woken to choose a player: you learn their role.',
  virgin: 'The 1st time you are nominated, if the nominator is a Townsfolk, they are executed immediately.',
  slayer: 'Once per game, during the day, publicly choose a player: if they are the Demon, they die.',
  soldier: 'You are safe from the Demon.',
  mayor: 'If only 3 players live & no execution occurs, your team wins. If you are about to die at night, another player might die instead.',
  butler: 'Each night, choose a player (not yourself): tomorrow, you may only vote if they are voting too.',
  drunk: 'You do not know you are the Drunk. You think you are a Townsfolk, but you are not.',
  recluse: 'You might register as evil & as a Minion or Demon, even if dead.',
  saint: 'If you die by execution, your team loses.',
  poisoner: 'Each night, choose a player: they are poisoned tonight and tomorrow day.',
  spy: 'Each night, you see the Grimoire. You might register as good & as a Townsfolk or Outsider, even if dead.',
  scarlet_woman: 'If there are 5 or more players alive (Travellers don\'t count) & the Demon dies, you become the Demon.',
  baron: '2 Outsiders have been added.',
  imp: 'Each night (except the first), choose a player: they die. If you kill yourself this way, a Minion becomes the Imp.',
};

function getRoleAbility(role: string): string {
  const key = role.toLowerCase().replace(/\s+/g, '_');
  return ROLE_ABILITIES[key] ?? 'No ability description available.';
}

// ── Reasoning feed ────────────────────────────────────────────────────

function ReasoningFeed({ entries }: { entries: ReasoningEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  return (
    <div style={{ ...styles.section, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={styles.sectionLabel}>
        Private Reasoning
        {entries.length > 0 && (
          <span style={{ marginLeft: 6, opacity: 0.5, fontWeight: 400 }}>
            ({entries.length} {entries.length === 1 ? 'entry' : 'entries'})
          </span>
        )}
      </div>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          background: 'rgba(0,0,0,0.2)',
          borderRadius: 6,
          padding: 6,
        }}
      >
        {entries.length === 0 ? (
          <div
            style={{
              fontSize: '0.78rem',
              fontFamily: 'var(--font-mono)',
              color: 'rgba(255,255,255,0.4)',
              padding: 6,
            }}
          >
            No reasoning captured yet.
          </div>
        ) : (
          entries.map((entry, idx) => {
            const phaseColor = getPhaseColor(entry.phase);
            const isNight = entry.phase === 'night' || entry.phase === 'first_night';
            return (
              <div
                key={idx}
                style={{
                  padding: '8px 8px',
                  borderBottom: idx < entries.length - 1
                    ? '1px solid rgba(255,255,255,0.06)'
                    : undefined,
                  background: isNight ? 'rgba(99,102,241,0.06)' : undefined,
                  borderRadius: 4,
                  marginBottom: 2,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: phaseColor,
                    }}
                  >
                    {getPhaseLabel(entry.phase)}
                  </span>
                  <span
                    style={{
                      fontSize: '0.62rem',
                      color: 'rgba(255,255,255,0.3)',
                    }}
                  >
                    Day {entry.dayNumber}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: '0.76rem',
                    fontFamily: 'var(--font-mono)',
                    color: 'rgba(255,255,255,0.6)',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {entry.reasoning}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────

export function PlayerDetailDrawer() {
  const selectedSeat = useGameStore((s) => s.selectedPlayer);
  const selectPlayer = useGameStore((s) => s.selectPlayer);
  const gameState = useGameStore((s) => s.gameState);
  const showObserverInfo = useGameStore((s) => s.showObserverInfo);
  const playerReasoning = useGameStore((s) => s.playerReasoning);
  const tokenUsage = useGameStore((s) => s.tokenUsage);

  const player: Player | undefined = useMemo(
    () => gameState?.players.find((p) => p.seat === selectedSeat),
    [gameState?.players, selectedSeat],
  );

  const spriteId = useMemo(() => {
    if (selectedSeat === null || !gameState) return null;
    const ids = pickSpriteIds(gameState.gameId || 'default', gameState.players.length);
    return ids[selectedSeat % ids.length];
  }, [selectedSeat, gameState?.gameId, gameState?.players.length]);

  const reasoningEntries: ReasoningEntry[] = selectedSeat !== null
    ? (playerReasoning[selectedSeat] ?? [])
    : [];
  const tokens = selectedSeat !== null ? tokenUsage[selectedSeat] : undefined;

  return (
    <AnimatePresence>
      {player && (
        <motion.div
          key="drawer"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          style={styles.drawer}
        >
          {/* Header */}
          <div style={styles.header}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 52,
                height: 52,
                borderRadius: 8,
                overflow: 'hidden',
                flexShrink: 0,
                background: 'rgba(0,0,0,0.3)',
                border: `2px solid ${getProviderColor(player.modelName || player.agentId)}`,
              }}>
                {spriteId && (
                  <img
                    src={`/final_avatars/avatar_${spriteId}.png`}
                    alt={player.characterName || ''}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                )}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                  {player.characterName || player.agentId}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>
                  Seat {player.seat}
                </div>
                {player.characterName && (
                  <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)' }}>
                    {player.agentId}
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => selectPlayer(null)}
              style={styles.closeBtn}
              aria-label="Close drawer"
            >
              x
            </button>
          </div>

          {/* Status */}
          <div style={styles.section}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <StatusPill
                label={player.isAlive ? 'Alive' : 'Dead'}
                color={player.isAlive ? '#10B981' : '#EF4444'}
              />
              {player.isDrunk && showObserverInfo && (
                <StatusPill label="Drunk" color="#F59E0B" />
              )}
              {player.isPoisoned && !player.isDrunk && showObserverInfo && (
                <StatusPill label="Poisoned" color="#A855F7" />
              )}
              {player.isProtected && showObserverInfo && (
                <StatusPill label="Protected" color="#22D3EE" />
              )}
              {!player.isAlive && (
                <StatusPill
                  label={player.ghostVoteUsed ? '\uD83D\uDC7B Vote used' : '\uD83D\uDC7B Vote ready'}
                  color={player.ghostVoteUsed ? '#6B7280' : '#6ee7b7'}
                />
              )}
            </div>
          </div>

          {/* Death info */}
          {!player.isAlive && player.deathCause && (
            <div style={styles.section}>
              <div style={styles.sectionLabel}>Cause of Death</div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: '0.88rem',
                  color: '#EF4444',
                }}
              >
                <span>{player.deathCause === 'executed' ? '\u2694\uFE0F' : player.deathCause === 'demon_kill' ? '\uD83D\uDC80' : '\uD83D\uDCA5'}</span>
                <span style={{ fontWeight: 600 }}>
                  {player.deathPhase === 'night'
                    ? `Died: Night ${player.deathDay ?? '?'}`
                    : `Died: Day ${player.deathDay ?? '?'}`}
                  {' '}
                  ({player.deathCause === 'executed'
                    ? 'Executed'
                    : player.deathCause === 'demon_kill'
                    ? 'Demon Kill'
                    : player.deathCause === 'slayer_shot'
                    ? 'Slayer Shot'
                    : player.deathCause})
                </span>
              </div>
            </div>
          )}

          {/* Role info (observer only) */}
          {showObserverInfo && (
            <div style={styles.section}>
              <div style={styles.sectionLabel}>Role</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span
                  style={{
                    fontSize: '1.05rem',
                    fontWeight: 700,
                    color: getRoleTypeColor(player.roleType),
                  }}
                >
                  {player.role}
                </span>
                <span
                  className="pill"
                  style={{
                    background: `${getRoleTypeColor(player.roleType)}22`,
                    color: getRoleTypeColor(player.roleType),
                    fontSize: '0.65rem',
                  }}
                >
                  {player.roleType}
                </span>
              </div>
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'rgba(255,255,255,0.55)',
                  lineHeight: 1.5,
                }}
              >
                {getRoleAbility(player.role)}
              </div>
              <div style={{ marginTop: 8 }}>
                <StatusPill
                  label={player.alignment === 'good' ? 'Good' : 'Evil'}
                  color={player.alignment === 'good' ? '#3B82F6' : '#EF4444'}
                />
              </div>
              {player.perceivedRole && player.perceivedRole !== player.role && (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: '0.78rem',
                    color: '#A855F7',
                    fontStyle: 'italic',
                  }}
                >
                  Thinks they are: {player.perceivedRole}
                </div>
              )}
            </div>
          )}

          {/* Token usage */}
          {tokens && (
            <div style={styles.section}>
              <div style={styles.sectionLabel}>Token Usage</div>
              <div style={styles.tokenGrid}>
                <span className="text-muted">Prompt</span>
                <span className="mono">{tokens.prompt.toLocaleString()}</span>
                <span className="text-muted">Completion</span>
                <span className="mono">{tokens.completion.toLocaleString()}</span>
                <span className="text-muted">Cost</span>
                <span className="mono">${tokens.cost.toFixed(4)}</span>
              </div>
            </div>
          )}

          {/* Reasoning feed */}
          {showObserverInfo && (
            <ReasoningFeed entries={reasoningEntries} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const styles: Record<string, React.CSSProperties> = {
  drawer: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 340,
    height: '100%',
    background: '#12121f',
    borderLeft: '1px solid rgba(255,255,255,0.1)',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 200,
    boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '0.85rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    border: 'none',
  },
  section: {
    padding: '12px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  sectionLabel: {
    fontSize: '0.7rem',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: 'rgba(255,255,255,0.35)',
    marginBottom: 8,
  },
  tokenGrid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '4px 12px',
    fontSize: '0.8rem',
  },
};
