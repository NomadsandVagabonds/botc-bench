import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../../../stores/gameStore.ts';
import { useWagerStore } from '../wagerStore.ts';
import { CrownBalance } from './CrownBalance.tsx';

export function SpectatorHeader() {
  const gameState = useGameStore(s => s.gameState);
  const { bets, sessionSettled, crownsWon } = useWagerStore();
  const navigate = useNavigate();

  const phaseLabels: Record<string, string> = {
    setup: 'Setup',
    first_night: 'Night 0',
    night: `Night ${gameState?.dayNumber ?? ''}`,
    day_discussion: `Day ${gameState?.dayNumber ?? ''} - Discussion`,
    day_breakout: `Day ${gameState?.dayNumber ?? ''} - Breakout`,
    day_regroup: `Day ${gameState?.dayNumber ?? ''} - Regroup`,
    nominations: `Day ${gameState?.dayNumber ?? ''} - Nominations`,
    voting: `Day ${gameState?.dayNumber ?? ''} - Voting`,
    execution: `Day ${gameState?.dayNumber ?? ''} - Execution`,
    game_over: 'Game Over',
  };

  const phase = gameState?.phase ?? 'setup';
  const aliveCount = gameState?.players.filter(p => p.isAlive).length ?? 0;
  const totalCount = gameState?.players.length ?? 0;
  const activeBets = bets.filter(b => !b.settled).length;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '6px 16px',
      background: '#1a0e08',
      borderBottom: '2px solid #3d2812',
      boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{
          fontFamily: 'Georgia, serif', fontSize: 16,
          fontWeight: 'bold', color: '#c9a84c',
          textShadow: '0 1px 3px rgba(0,0,0,0.7)',
        }}>
          The Crown's Wager
        </span>

        <span style={{
          background: 'rgba(0,0,0,0.4)', border: '1px solid #5c3d1a',
          borderRadius: 3, padding: '2px 10px',
          fontFamily: 'Georgia, serif', fontSize: 12, color: '#c9a84c',
          textShadow: '0 1px 2px rgba(0,0,0,0.5)',
        }}>
          {phaseLabels[phase] ?? phase}
        </span>

        <span style={{ fontFamily: 'Georgia, serif', fontSize: 12, color: '#c9a84c99', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
          {aliveCount}/{totalCount} alive
        </span>

        {activeBets > 0 && (
          <span style={{ fontSize: 11, color: '#c9a84c66', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
            {activeBets} wager{activeBets !== 1 ? 's' : ''}
          </span>
        )}

        {sessionSettled && (
          <span style={{
            fontSize: 13, fontWeight: 'bold',
            color: crownsWon > 0 ? '#c9a84c' : '#8b0000',
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
          }}>
            {crownsWon > 0 ? `Won ${crownsWon.toFixed(0)} Crowns!` : 'Better luck next time'}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <CrownBalance />
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'linear-gradient(180deg, #4a4a4a, #2a2a2a)',
            border: '1px solid #1a1a1a', borderRadius: 3,
            color: '#999', padding: '3px 10px', fontSize: 11, cursor: 'pointer',
            fontFamily: 'Georgia, serif',
            boxShadow: 'inset 0 1px 0 #555',
          }}
        >Lobby</button>
      </div>
    </div>
  );
}
