import { Routes, Route } from 'react-router-dom';
import { GameLobby } from './components/GameLobby.tsx';
import { GameView } from './components/game/GameView.tsx';
import { SpectatorView } from './features/wager/components/SpectatorView.tsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<GameLobby />} />
      <Route path="/game/:gameId" element={<GameView />} />
      <Route path="/spectate/:gameId" element={<SpectatorView />} />
    </Routes>
  );
}
