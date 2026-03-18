import { useGameStore } from '../../../stores/gameStore.ts';
import { useWagerStore } from '../wagerStore.ts';
import type { Bet } from '../types.ts';

function marketLabel(marketId: string, players: any[]): string {
  if (marketId === 'winner_evil') return 'Game Winner';
  if (marketId.startsWith('alignment_seat_')) {
    const seat = parseInt(marketId.split('_').pop()!, 10);
    const p = players.find((pl: any) => pl.seat === seat);
    return p?.characterName || `Seat ${seat}`;
  }
  return marketId;
}

export function BetCard({ bet }: { bet: Bet }) {
  const gameState = useGameStore(s => s.gameState);
  const { cancelBet, gameId } = useWagerStore();
  const players = gameState?.players ?? [];
  const isGameOver = gameState?.phase === 'game_over';

  const label = marketLabel(bet.marketId, players);
  const sideLabel = bet.marketId === 'winner_evil'
    ? (bet.side === 'yes' ? 'Evil wins' : 'Good wins')
    : (bet.side === 'yes' ? 'Evil' : 'Good');

  return (
    <div style={{
      padding: '10px 14px', marginBottom: 8,
      background: bet.settled
        ? (bet.correct ? 'rgba(45, 90, 45, 0.15)' : 'rgba(139, 0, 0, 0.15)')
        : 'rgba(60, 40, 18, 0.08)',
      border: `1px solid ${bet.settled ? (bet.correct ? '#2d5a2d55' : '#8b000055') : '#8b735533'}`,
      borderRadius: 6, fontFamily: 'Georgia, serif', color: '#3d2812',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 'bold' }}>
            {label}{' '}
            <span style={{ color: bet.side === 'yes' ? '#8b0000' : '#2d5a2d', fontWeight: 'bold' }}>
              {sideLabel}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#3d2812', marginTop: 2 }}>
            {bet.crownsSpent.toFixed(0)}C &rarr; {bet.shares.toFixed(1)} shares
            {' '}&middot;{' '}@{(bet.probAtPurchase * 100).toFixed(0)}%
            {' '}&middot;{' '}Day {bet.dayPlaced}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {bet.settled ? (
            <div style={{
              fontSize: 15, fontWeight: 'bold',
              color: bet.correct ? '#2d5a2d' : '#8b0000',
            }}>
              {bet.correct ? `+${((bet.crownsPayout ?? 0) - bet.crownsSpent).toFixed(0)}` : `-${bet.crownsSpent.toFixed(0)}`}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#2d5a2d', fontWeight: 'bold' }}>
              +{bet.potentialProfit.toFixed(0)} if right
            </div>
          )}
        </div>
      </div>

      {!bet.settled && !isGameOver && (
        <button
          onClick={() => gameId && cancelBet(gameId, bet.id)}
          style={{
            marginTop: 6, padding: '2px 10px', background: 'transparent',
            border: '1px solid #8b735544', borderRadius: 4,
            color: '#8b0000', fontSize: 11, cursor: 'pointer', fontFamily: 'Georgia, serif',
          }}
        >Cancel (10% tax)</button>
      )}
    </div>
  );
}
