import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameStore } from '../../stores/gameStore.ts';
import { getPhaseLabel } from '../../utils/models.ts';
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
  const aliveCount = gameState.players.filter((p) => p.isAlive).length;
  const totalPlayers = gameState.players.length;
  const totalCost = Object.values(tokenUsage).reduce((sum, t) => sum + t.cost, 0);
  const isGameOver = phase === 'game_over' || phase === 'debrief';

  return (
    <header style={s.header}>
      {/* Left cluster — identity & status */}
      <div style={s.left}>
        {/* Connection / replay badge */}
        {replayMode ? (
          <span style={s.replayBadge}>
            REPLAY {replayIndex}/{replayTotal}
          </span>
        ) : (
          <span
            style={{
              ...s.statusDot,
              background: connected ? '#6ee7b7' : '#f87171',
              boxShadow: connected
                ? '0 0 6px rgba(110,231,183,0.5)'
                : '0 0 6px rgba(248,113,113,0.4)',
            }}
            title={connected ? 'Connected' : 'Disconnected'}
          />
        )}

        {/* Game ID */}
        <span style={s.gameId}>{gameState.gameId.slice(0, 8)}</span>

        {/* Separator */}
        <span style={s.sep}>{'\u00B7'}</span>

        {/* Phase */}
        <span style={s.phase}>{getPhaseLabel(phase)}</span>

        {/* Separator */}
        <span style={s.sep}>{'\u00B7'}</span>

        {/* Day */}
        <span style={s.day}>Day {gameState.dayNumber}</span>

        {/* Separator */}
        <span style={s.sep}>{'\u00B7'}</span>

        {/* Alive */}
        <span style={s.alive}>
          {aliveCount}/{totalPlayers} alive
        </span>
      </div>

      {/* Right cluster — controls */}
      <div style={s.right}>
        {/* Cost */}
        <span style={s.cost} title="Total API cost">
          ${totalCost.toFixed(4)}
        </span>

        {/* Speed controls */}
        <div style={s.speedGroup}>
          <button style={s.ctrl} onClick={togglePause} title={paused ? 'Resume' : 'Pause'}>
            {paused ? '\u25B6' : '\u275A\u275A'}
          </button>
          {[0.25, 0.5, 1, 2, 4].map((sp) => (
            <button
              key={sp}
              style={{
                ...s.ctrl,
                ...(speed === sp && !paused ? s.ctrlActive : {}),
              }}
              onClick={() => setSpeed(sp)}
            >
              {sp}x
            </button>
          ))}
        </div>

        {/* Observer toggle */}
        <button
          style={{ ...s.ctrl, ...(showObserverInfo ? s.ctrlActive : {}) }}
          onClick={toggleObserverInfo}
          title={showObserverInfo ? 'Hide roles' : 'Show roles (observer)'}
        >
          {showObserverInfo ? '\uD83D\uDC41' : '\uD83D\uDC41\u200D\uD83D\uDDE8'}
        </button>

        {/* Mute */}
        <button style={s.ctrl} onClick={onToggleMute} title={muted ? 'Unmute' : 'Mute'}>
          {muted ? '\uD83D\uDD07' : '\uD83D\uDD0A'}
        </button>

        {/* Download (game over only) */}
        {isGameOver && gameId && (
          <button
            style={s.ctrl}
            onClick={() => {
              const url = `${window.location.protocol}//${window.location.host}/api/games/${gameId}/download`;
              const a = document.createElement('a');
              a.href = url;
              a.download = `game_${gameId}.json`;
              a.click();
            }}
            title="Download game JSON"
          >
            {'\u2B07'}
          </button>
        )}

        {/* Lobby */}
        <button style={s.lobbyBtn} onClick={() => navigate('/')} title="Back to lobby">
          Lobby
        </button>

        {/* Stop (live games only) */}
        {!replayMode && !isGameOver && (
          <button
            style={{
              ...s.stopBtn,
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
            title="Stop game"
          >
            {stopping ? '\u00B7\u00B7\u00B7' : 'Stop'}
          </button>
        )}
      </div>
    </header>
  );
}

// ── Parchment-dark header styles matching bloodbench.com ──────────────

const s: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 14px',
    background: '#1a0e08',
    borderBottom: '2px solid #3d2812',
    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
    gap: 10,
    flexWrap: 'wrap',
    minHeight: 40,
    fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },

  // Status indicators
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
  },
  replayBadge: {
    fontSize: '0.62rem',
    fontWeight: 700,
    color: '#c9a84c',
    background: 'rgba(0,0,0,0.4)',
    border: '1px solid #5c3d1a',
    borderRadius: 3,
    padding: '2px 7px',
    letterSpacing: '0.06em',
    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
  },
  gameId: {
    fontSize: '0.72rem',
    color: '#8b7355',
    fontFamily: 'monospace',
    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
  },
  sep: {
    color: '#5c3d1a',
    fontSize: '0.7rem',
  },
  phase: {
    fontSize: '0.72rem',
    fontWeight: 700,
    color: '#c9a84c',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    textShadow: '0 1px 3px rgba(0,0,0,0.7)',
  },
  day: {
    fontSize: '0.72rem',
    fontWeight: 600,
    color: '#d4b376',
    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
  },
  alive: {
    fontSize: '0.68rem',
    color: '#c9a84c99',
    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
  },

  // Controls
  cost: {
    fontSize: '0.65rem',
    color: '#8b7355',
    fontFamily: 'monospace',
    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
  },
  speedGroup: {
    display: 'flex',
    gap: 1,
  },
  ctrl: {
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid #3d2812',
    borderRadius: 3,
    color: '#8b7355',
    cursor: 'pointer',
    fontSize: '0.62rem',
    fontFamily: 'Georgia, serif',
    padding: '3px 7px',
    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
    transition: 'color 0.15s, border-color 0.15s',
  },
  ctrlActive: {
    color: '#c9a84c',
    borderColor: '#c9a84c44',
    background: 'rgba(201,168,76,0.12)',
  },
  lobbyBtn: {
    background: 'linear-gradient(180deg, #3d2812 0%, #2a1a0a 100%)',
    border: '1px solid #5c3d1a',
    borderRadius: 3,
    color: '#c9a84c',
    cursor: 'pointer',
    fontSize: '0.65rem',
    fontWeight: 700,
    fontFamily: 'Georgia, serif',
    padding: '3px 10px',
    letterSpacing: '0.04em',
    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
    boxShadow: 'inset 0 1px 0 rgba(201,168,76,0.15)',
  },
  stopBtn: {
    background: 'rgba(139, 26, 26, 0.2)',
    border: '1px solid rgba(139, 26, 26, 0.4)',
    borderRadius: 3,
    color: '#e8a0a0',
    cursor: 'pointer',
    fontSize: '0.62rem',
    fontFamily: 'Georgia, serif',
    padding: '3px 8px',
    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
  },
};
