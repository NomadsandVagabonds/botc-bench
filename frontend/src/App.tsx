import { Routes, Route } from 'react-router-dom';
import { LandingPage } from './components/LandingPage.tsx';
import { GameLobby } from './components/GameLobby.tsx';
import { GameView } from './components/game/GameView.tsx';
import { SpectatorView } from './features/wager/components/SpectatorView.tsx';

// Show landing page on production (bloodbench.com), GameLobby on localhost
const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={isProduction ? <LandingPage /> : <GameLobby />} />
      <Route path="/lobby" element={<GameLobby />} />
      <Route path="/admin" element={<GameLobby />} />
      <Route path="/game/:gameId" element={<GameView />} />
      <Route path="/spectate/:gameId" element={<SpectatorView />} />
    </Routes>
  );
}
