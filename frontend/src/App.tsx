import { Routes, Route } from 'react-router-dom';
import { LandingPage } from './components/LandingPage.tsx';
import { LandingPageV2 } from './components/landing-v2/LandingPageV2.tsx';
import { GameLobby } from './components/GameLobby.tsx';
import { AdminGate } from './components/AdminGate.tsx';
import { GameView } from './components/game/GameView.tsx';
import { SpectatorView } from './features/wager/components/SpectatorView.tsx';

// Show landing page on production (bloodbench.com), GameLobby on localhost
const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={isProduction ? <LandingPageV2 /> : <GameLobby />} />
      <Route path="/landing" element={<LandingPageV2 />} />
      <Route path="/landing-old" element={<LandingPage />} />
      <Route path="/lobby" element={<AdminGate><GameLobby /></AdminGate>} />
      <Route path="/game/:gameId" element={<AdminGate><GameView /></AdminGate>} />
      <Route path="/spectate/:gameId" element={<SpectatorView />} />
    </Routes>
  );
}
