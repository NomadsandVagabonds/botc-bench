/**
 * SpectatorView — The Crown's Wager.
 *
 * 3-column layout: Chat | Map | Wager Panel
 * Works for live games AND completed game replays.
 */

import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useGameStore } from '../../../stores/gameStore.ts';
import { TownMap } from '../../../components/game/TownMap.tsx';
import { VotingOverlay } from '../../../components/game/VotingOverlay.tsx';
import { useSpectatorWS } from '../useSpectatorWS.ts';
import { useWagerStore } from '../wagerStore.ts';
import { AuthModal } from './AuthModal.tsx';
import { SpectatorHeader } from './SpectatorHeader.tsx';
import { WagerPanel } from './WagerPanel.tsx';
import { ChatPanel } from './ChatPanel.tsx';
import { ReplayControls } from './ReplayControls.tsx';

export function SpectatorView() {
  const { gameId } = useParams<{ gameId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const gameState = useGameStore(s => s.gameState);
  const connected = useGameStore(s => s.connected);
  const replayMode = useGameStore(s => s.replayMode);
  const {
    authenticated, authLoading, loadUser, joinGame, loadSession,
    refreshMarkets, showAuthModal, sessionSettled, settleGame,
  } = useWagerStore();
  const prevPhaseRef = useRef<string | null>(null);

  useSpectatorWS(gameId);

  // Handle GitHub OAuth callback — save token from URL, clean params
  useEffect(() => {
    const token = searchParams.get('wager_token');
    if (token) {
      localStorage.setItem('wager_token', token);
      searchParams.delete('wager_token');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (useGameStore.getState().showObserverInfo) {
      useGameStore.getState().toggleObserverInfo();
    }
  }, []);

  useEffect(() => { loadUser(); }, [loadUser]);

  useEffect(() => {
    if (authenticated && gameId) {
      joinGame(gameId).catch(() => loadSession(gameId));
    }
  }, [authenticated, gameId, joinGame, loadSession]);

  useEffect(() => {
    if (!gameId || !authenticated) return;
    refreshMarkets(gameId);
    const interval = setInterval(() => refreshMarkets(gameId), 8_000);
    return () => clearInterval(interval);
  }, [gameId, authenticated, refreshMarkets]);

  useEffect(() => {
    const phase = gameState?.phase;
    if (phase && phase !== prevPhaseRef.current) {
      prevPhaseRef.current = phase;
      if (gameId && authenticated) refreshMarkets(gameId);
    }
  }, [gameState?.phase, gameId, authenticated, refreshMarkets]);

  useEffect(() => {
    const isOver = gameState?.phase === 'game_over' || gameState?.winner;
    if (isOver && gameId && authenticated && !sessionSettled) {
      // Trigger settlement, then reload session
      const timer = setTimeout(() => settleGame(gameId), 2000);
      return () => clearTimeout(timer);
    }
  }, [gameState?.phase, gameState?.winner, gameId, authenticated, sessionSettled, settleGame]);

  useEffect(() => {
    return () => { useGameStore.getState().reset(); };
  }, []);

  if (authLoading) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a0a1a', color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: 18,
      }}>
        Preparing the wager hall...
      </div>
    );
  }

  if (!connected && !gameState) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a0a1a', color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: 18,
      }}>
        Connecting to the village...
      </div>
    );
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#0a0a1a', overflow: 'hidden',
    }}>
      {showAuthModal && <AuthModal />}

      <SpectatorHeader />
      {replayMode && <ReplayControls />}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* Left: Chat — always visible */}
        <ChatPanel />

        {/* Center: Map (scales to fill) */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minWidth: 300 }}>
          {gameState && (
            <>
              <TownMap />
              <VotingOverlay />
            </>
          )}
          {/* Floating banner — fixed to top center of page */}
          <img
            src="/banner_crown.png" alt="The Crown's Wager"
            style={{
              position: 'fixed', top: 0, left: '50%',
              transform: 'translateX(-50%)',
              width: 520, pointerEvents: 'none', zIndex: 50,
              filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.6))',
            }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>

        {/* Right: Wager panel */}
        <WagerPanel />

        {/* Gargoyle corners — decorative, behind panel content */}
        <img
          src="/garg_bottom_L.png" alt=""
          style={{
            position: 'absolute', bottom: 0, left: 0,
            width: 320, pointerEvents: 'none', zIndex: 0,
          }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <img
          src="/garg_bottom_R.png" alt=""
          style={{
            position: 'absolute', bottom: 0, right: -20,
            width: 441, pointerEvents: 'none', zIndex: 0,
          }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      </div>
    </div>
  );
}
