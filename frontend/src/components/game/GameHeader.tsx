import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameStore } from '../../stores/gameStore.ts';
import { getPhaseColor, getPhaseLabel } from '../../utils/models.ts';
import { stopGame } from '../../api/rest.ts';

interface GameHeaderProps {
  muted?: boolean;
  onToggleMute?: () => void;
}

export function GameHeader({ muted = false, onToggleMute }: GameHeaderProps) {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const gameState = useGameStore((s) => s.gameState);
  const showObserverInfo = useGameStore((s) => s.showObserverInfo);
  const toggleObserverInfo = useGameStore((s) => s.toggleObserverInfo);
  const speed = useGameStore((s) => s.speed);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const paused = useGameStore((s) => s.paused);
  const togglePause = useGameStore((s) => s.togglePause);
  const tokenUsage = useGameStore((s) => s.tokenUsage);
  const connected = useGameStore((s) => s.connected);
  const replayMode = useGameStore((s) => s.replayMode);
  const replayIndex = useGameStore((s) => s.replayIndex);
  const replayTotal = useGameStore((s) => s.replayTotal);
  const [stopping, setStopping] = useState(false);

  if (!gameState) return null;

  const phase = gameState.phase;
  const phaseColor = getPhaseColor(phase);
  const aliveCount = gameState.players.filter((p) => p.isAlive).length;
  const totalPlayers = gameState.players.length;

  // Total cost across all seats
  const totalCost = Object.values(tokenUsage).reduce(
    (sum, t) => sum + t.cost,
    0,
  );

  return (
    <header style={styles.header}>
      {/* Left: game info */}
      <div style={styles.left}>
        {/* Connection dot / Replay indicator */}
        {replayMode ? (
          <span style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            color: '#c4a265',
            background: 'rgba(196,162,101,0.15)',
            border: '1px solid rgba(196,162,101,0.3)',
            borderRadius: 4,
            padding: '2px 6px',
            letterSpacing: '0.05em',
          }}>
            REPLAY {replayIndex}/{replayTotal}
          </span>
        ) : (
          <div
            style={{
              ...styles.dot,
              background: connected ? '#10B981' : '#EF4444',
            }}
            title={connected ? 'Connected' : 'Disconnected'}
          />
        )}

        <span style={styles.gameId} className="mono">
          {gameState.gameId.slice(0, 8)}
        </span>

        {/* Phase pill */}
        <span
          className="pill"
          style={{
            background: `${phaseColor}22`,
            color: phaseColor,
            border: `1px solid ${phaseColor}44`,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: phaseColor,
            }}
          />
          {getPhaseLabel(phase)}
        </span>

        {/* Day counter */}
        <span style={styles.dayBadge}>
          Day {gameState.dayNumber}
        </span>

        {/* Alive count */}
        <span className="text-secondary" style={{ fontSize: '0.85rem' }}>
          {aliveCount}/{totalPlayers} alive
        </span>
      </div>

      {/* Right: controls */}
      <div style={styles.right}>
        <button
          className="btn btn-secondary"
          style={styles.smallBtn}
          onClick={() => navigate('/')}
          title="Back to lobby"
        >
          Lobby
        </button>
        {/* Token cost */}
        <span
          className="mono text-muted"
          style={{ fontSize: '0.8rem' }}
          title="Total API cost"
        >
          ${totalCost.toFixed(4)}
        </span>

        {/* Speed controls */}
        <div style={styles.speedGroup}>
          <button
            className="btn btn-secondary"
            style={styles.smallBtn}
            onClick={togglePause}
            title={paused ? 'Resume' : 'Pause'}
          >
            {paused ? '\u25B6' : '\u275A\u275A'}
          </button>
          {[0.25, 0.5, 1, 2, 4].map((s) => (
            <button
              key={s}
              className="btn btn-secondary"
              style={{
                ...styles.smallBtn,
                background: speed === s && !paused
                  ? 'rgba(99,102,241,0.3)'
                  : undefined,
              }}
              onClick={() => setSpeed(s)}
            >
              {s < 1 ? `${s}x` : `${s}x`}
            </button>
          ))}
        </div>

        {/* Observer toggle */}
        <button
          className="btn btn-secondary"
          style={styles.smallBtn}
          onClick={toggleObserverInfo}
          title={showObserverInfo ? 'Hide roles' : 'Show roles'}
        >
          {showObserverInfo ? '\uD83D\uDC41' : '\uD83D\uDC41\u200D\uD83D\uDDE8'}
        </button>

        {/* Soundtrack mute toggle */}
        <button
          className="btn btn-secondary"
          style={styles.smallBtn}
          onClick={onToggleMute}
          title={muted ? 'Unmute soundtrack' : 'Mute soundtrack'}
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>

        {/* Stop game (not shown during replay) */}
        {!replayMode && phase !== 'game_over' && phase !== 'debrief' && (
          <button
            style={{
              ...styles.smallBtn,
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#FCA5A5',
              opacity: stopping ? 0.5 : 1,
            }}
            onClick={async () => {
              if (!gameId || stopping) return;
              if (!confirm('Stop this game? This cannot be undone.')) return;
              setStopping(true);
              try {
                await stopGame(gameId);
                navigate('/');
              } catch {
                setStopping(false);
              }
            }}
            disabled={stopping}
            title="Stop game and return to lobby"
          >
            {stopping ? '...' : 'Stop'}
          </button>
        )}
      </div>
    </header>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    background: 'rgba(255,255,255,0.03)',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    gap: 12,
    flexWrap: 'wrap',
    minHeight: 48,
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  gameId: {
    fontSize: '0.8rem',
    color: 'rgba(255,255,255,0.4)',
  },
  dayBadge: {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.7)',
  },
  speedGroup: {
    display: 'flex',
    gap: 2,
  },
  smallBtn: {
    padding: '4px 8px',
    fontSize: '0.75rem',
    borderRadius: 6,
  },
};
