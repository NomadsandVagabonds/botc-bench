import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { TownMap } from './TownMap.tsx';
import { GameHeader } from './GameHeader.tsx';
import { ConversationPanel } from './ConversationPanel.tsx';
import { PlayerDetailDrawer } from './PlayerDetailDrawer.tsx';
import { VotingOverlay } from './VotingOverlay.tsx';
import { DebriefPanel } from './DebriefPanel.tsx';
import { GameLog } from './GameLog.tsx';
import { useGameStore } from '../../stores/gameStore.ts';
import { useWebSocket } from '../../hooks/useWebSocket.ts';

export function GameView() {
  const { gameId } = useParams<{ gameId: string }>();
  const { connected } = useWebSocket(gameId ?? null);
  const gameState = useGameStore((s) => s.gameState);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(false);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);

  const playAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = 0.35;
    audio.loop = true;
    audio.muted = muted;

    void audio.play()
      .then(() => {
        setNeedsAudioUnlock(false);
      })
      .catch(() => {
        // Most browsers block unmuted autoplay until a user gesture.
        if (!muted) {
          setNeedsAudioUnlock(true);
        }
      });
  }, [muted]);

  useEffect(() => {
    playAudio();
  }, [playAudio]);

  useEffect(() => {
    if (!needsAudioUnlock || muted) return;

    const unlock = () => {
      playAudio();
    };

    // Retry on first user interaction so sound starts even if autoplay was blocked.
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [needsAudioUnlock, muted, playAudio]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
    };
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => !prev);
  }, []);

  const loadingView = (
    <div style={styles.loading}>
      <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>
        {connected ? 'Connected — waiting for game state...' : `Connecting to game ${gameId}...`}
      </div>
      <div style={{ marginTop: 8, color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem' }}>
        {connected
          ? 'WebSocket connected, waiting for first event'
          : 'Establishing WebSocket connection'}
      </div>
      {needsAudioUnlock && !muted ? (
        <button
          className="btn btn-secondary"
          style={{ marginTop: 12, padding: '6px 10px' }}
          onClick={playAudio}
        >
          Enable soundtrack
        </button>
      ) : null}
    </div>
  );

  const gameView = (
    <div style={styles.layout}>
      <GameHeader muted={muted} onToggleMute={toggleMute} />

      <div style={styles.body}>
        {/* Left: circle + overlays */}
        <div style={styles.mapArea}>
          <TownMap />
          <VotingOverlay />
          <PlayerDetailDrawer />
          <DebriefPanel />
        </div>

        {/* Right: conversation */}
        <div style={styles.conversationArea}>
          <ConversationPanel />
        </div>
      </div>

      <GameLog />
    </div>
  );

  return (
    <>
      <audio ref={audioRef} src="/track2.mp3" preload="auto" />
      {gameState ? gameView : loadingView}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  layout: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
  },
  body: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  mapArea: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  conversationArea: {
    width: 380,
    flexShrink: 0,
    overflow: 'hidden',
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
  },
};
