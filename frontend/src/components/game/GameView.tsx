import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TownMap } from './TownMap.tsx';
import { GameHeader } from './GameHeader.tsx';
import { ConversationPanel } from './ConversationPanel.tsx';
import { PlayerDetailDrawer } from './PlayerDetailDrawer.tsx';
import { VotingOverlay } from './VotingOverlay.tsx';
import { DebriefPanel } from './DebriefPanel.tsx';
import { GameLog } from './GameLog.tsx';
import { ReplayScrubber } from './ReplayScrubber.tsx';
import { MonitorPanel } from './MonitorPanel.tsx';
import { useGameStore } from '../../stores/gameStore.ts';
import { useWebSocket } from '../../hooks/useWebSocket.ts';
import { useReplayController } from '../../hooks/useReplayController.ts';
import { getGameStatus, listMonitors } from '../../api/rest.ts';
import type { MonitorResult } from '../../types/monitor.ts';

export function GameView() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const reset = useGameStore((s) => s.reset);
  // Reset store when game changes
  useEffect(() => {
    reset();
  }, [gameId, reset]);
  const { connected } = useWebSocket(gameId ?? null);
  useReplayController();
  const gameState = useGameStore((s) => s.gameState);
  const replayMode = useGameStore((s) => s.replayMode);
  const masterVolume = useGameStore((s) => s.masterVolume);
  const musicVolume = useGameStore((s) => s.musicVolume);
  const voiceVolume = useGameStore((s) => s.voiceVolume);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const introAudioRef = useRef<HTMLAudioElement | null>(null);
  const introPlayedRef = useRef(false);
  const paused = useGameStore((s) => s.paused);
  const replayIndex = useGameStore((s) => s.replayIndex);
  const [muted, setMuted] = useState(false);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [allMonitorResults, setAllMonitorResults] = useState<MonitorResult[]>([]);
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null);
  const [showMonitor, setShowMonitor] = useState(false);

  // Live monitor streaming from WebSocket
  const liveMonitor = useGameStore((s) => s.liveMonitor);

  // Build the effective monitor result — live takes priority, then selected, then latest saved
  const monitorResult: MonitorResult | null = useMemo(() => {
    // If we have a completed live monitor, use its full result
    if (liveMonitor?.complete && liveMonitor.result) {
      return liveMonitor.result;
    }
    // If live monitor is in progress, build a partial result for streaming display
    if (liveMonitor && liveMonitor.phases.length > 0) {
      const lastPhase = liveMonitor.phases[liveMonitor.phases.length - 1];
      return {
        monitor_id: liveMonitor.monitorId,
        game_id: gameId ?? '',
        config: { provider: '', model: liveMonitor.model, temperature: 0.3, include_groups: false },
        phases: liveMonitor.phases,
        final_ratings: lastPhase.ratings,
        all_bets: [],
        scores: { alignment_accuracy: 0, bet_accuracy: 0, auc: 0, total: 0 },
        token_summary: { input_tokens: 0, output_tokens: 0, total_cost_usd: 0 },
        duration_seconds: 0,
      } as MonitorResult;
    }
    // Use selected monitor, or fall back to latest
    if (selectedMonitorId) {
      return allMonitorResults.find(r => r.monitor_id === selectedMonitorId) ?? null;
    }
    return allMonitorResults.length > 0 ? allMonitorResults[allMonitorResults.length - 1] : null;
  }, [liveMonitor, allMonitorResults, selectedMonitorId, gameId]);

  // When live monitor completes, add it to the list
  useEffect(() => {
    if (liveMonitor?.complete && liveMonitor.result) {
      setAllMonitorResults(prev => {
        if (prev.some(r => r.monitor_id === liveMonitor.result!.monitor_id)) return prev;
        return [...prev, liveMonitor.result!];
      });
      setSelectedMonitorId(liveMonitor.result.monitor_id);
    }
  }, [liveMonitor?.complete]);

  // Auto-show monitor panel when live streaming starts
  useEffect(() => {
    if (liveMonitor && liveMonitor.phases.length > 0 && !showMonitor) {
      setShowMonitor(true);
    }
  }, [liveMonitor?.phases.length]);

  // Play narrator intro once when game state loads (for any game — live or replay)
  useEffect(() => {
    if (!gameState || introPlayedRef.current) return;
    // For replay mode, the replay controller handles the intro clip — skip here
    if (replayMode) return;
    introPlayedRef.current = true;

    const intro = new Audio('/intro.mp3');
    intro.volume = masterVolume * voiceVolume;
    introAudioRef.current = intro;
    intro.play().catch(() => {
      const unlock = () => {
        intro.volume = masterVolume * voiceVolume;
        intro.play().catch(() => {});
        window.removeEventListener('pointerdown', unlock);
      };
      window.addEventListener('pointerdown', unlock, { once: true });
    });
    intro.onended = () => { introAudioRef.current = null; };

    return () => { intro.pause(); intro.src = ''; introAudioRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, replayMode]);

  // Stop intro audio when paused or when user seeks (replayIndex jumps)
  useEffect(() => {
    if (paused && introAudioRef.current) {
      introAudioRef.current.pause();
      introAudioRef.current = null;
    }
  }, [paused, replayIndex]);

  // Sync game music volume from store
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = masterVolume * musicVolume;
    }
  }, [masterVolume, musicVolume]);

  const playAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = masterVolume * musicVolume;
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

  useEffect(() => {
    setLoadError(null);
  }, [gameId]);

  // Load all saved monitor results when viewing a completed game (replay mode)
  useEffect(() => {
    if (!gameId || !replayMode) return;
    listMonitors(gameId)
      .then((results) => {
        if (results.length > 0) {
          setAllMonitorResults(results);
          setSelectedMonitorId(results[results.length - 1].monitor_id);
        }
      })
      .catch(() => {});
  }, [gameId, replayMode]);

  useEffect(() => {
    if (!gameId || gameState) return;
    let cancelled = false;

    const checkStatus = async () => {
      try {
        const status = await getGameStatus(gameId);
        if (cancelled) return;
        if (status.status === 'failed') {
          setLoadError(status.error ? `Game failed: ${status.error}` : 'Game failed on the server.');
        } else if (status.status === 'stopped') {
          setLoadError('Game was stopped.');
        }
      } catch {
        // Keep waiting on websocket reconnect/status checks.
      }
    };

    void checkStatus();
    const timer = setInterval(() => void checkStatus(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [gameId, gameState]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => !prev);
  }, []);

  // Monitor status for the toggle button
  const isMonitorStreaming = liveMonitor != null && !liveMonitor.complete;
  const monitorPhaseProgress = liveMonitor
    ? `${liveMonitor.phases.length}/${liveMonitor.totalPhases}`
    : null;

  const loadingView = (
    <div style={styles.loading}>
      <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>
        {connected ? 'Connected — loading game...' : `Connecting to game ${gameId}...`}
      </div>
      <div style={{ marginTop: 8, color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem' }}>
        {connected
          ? 'WebSocket connected, waiting for first event'
          : 'Establishing WebSocket connection'}
      </div>
      {loadError ? (
        <div style={{ marginTop: 12, color: '#fecaca', fontSize: '0.85rem', textAlign: 'center', maxWidth: 560 }}>
          {loadError}
          <div style={{ marginTop: 10 }}>
            <button
              className="btn btn-secondary"
              style={{ padding: '6px 10px' }}
              onClick={() => navigate('/')}
            >
              Back to lobby
            </button>
          </div>
        </div>
      ) : null}
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
      <ReplayScrubber />

      <div style={styles.body}>
        {/* Left: circle + overlays */}
        <div style={styles.mapArea}>
          <TownMap />
          <VotingOverlay />
          <PlayerDetailDrawer />
          <DebriefPanel />

          {/* Monitor toggle button */}
          {(monitorResult || isMonitorStreaming) && (
            <button
              onClick={() => setShowMonitor(!showMonitor)}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                zIndex: 100,
                padding: '5px 10px',
                background: showMonitor ? '#7c3aed' : 'rgba(55, 65, 81, 0.85)',
                color: '#e0e0e0',
                border: showMonitor
                  ? '1px solid rgba(124, 58, 237, 0.5)'
                  : '1px solid rgba(75, 85, 99, 0.6)',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 11,
                fontFamily: 'monospace',
                fontWeight: 600,
                transition: 'all 0.2s',
                backdropFilter: 'blur(4px)',
                letterSpacing: '0.03em',
              }}
            >
              {isMonitorStreaming
                ? `\u25C9 Analyzing ${monitorPhaseProgress}`
                : showMonitor ? '\u2716 Monitor' : '\u{1F50D} Monitor'}
            </button>
          )}
        </div>

        {/* Right: conversation or monitor */}
        <div style={styles.conversationArea}>
          {showMonitor && monitorResult && gameState ? (
            <MonitorPanel
              result={monitorResult}
              players={gameState.players}
              currentPhaseIndex={replayMode ? replayIndex : undefined}
              allResults={allMonitorResults}
              selectedId={selectedMonitorId}
              onSelectResult={setSelectedMonitorId}
            />
          ) : (
            <ConversationPanel />
          )}
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
