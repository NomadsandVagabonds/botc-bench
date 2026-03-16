import { Routes, Route } from 'react-router-dom';
import { GameLobby } from './components/GameLobby.tsx';
import { GameView } from './components/game/GameView.tsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<GameLobby />} />
      <Route path="/game/:gameId" element={<GameView />} />
    </Routes>
  );
}
