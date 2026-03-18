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

function settledDisplay(bet: Bet): { text: string; color: string } {
  // Sold early: correct === null, crownsPayout has sale proceeds
  if (bet.correct === null && bet.crownsPayout != null) {
    const pl = bet.crownsPayout - bet.crownsSpent;
    return {
      text: `${pl >= 0 ? '+' : ''}${pl.toFixed(0)} (sold)`,
      color: '#8b7355',
    };
  }
  // Won
  if (bet.correct) {
    const profit = (bet.crownsPayout ?? 0) - bet.crownsSpent;
    return { text: `+${profit.toFixed(0)}`, color: '#2d5a2d' };
  }
  // Lost
  return { text: `-${bet.crownsSpent.toFixed(0)}`, color: '#8b0000' };
}

export function BetCard({ bet }: { bet: Bet }) {
  const gameState = useGameStore(s => s.gameState);
  const { sellBet, gameId } = useWagerStore();
  const players = gameState?.players ?? [];
  const isGameOver = gameState?.phase === 'game_over';

  const label = marketLabel(bet.marketId, players);
  const sideLabel = bet.marketId === 'winner_evil'
    ? (bet.side === 'yes' ? 'Evil wins' : 'Good wins')
    : (bet.side === 'yes' ? 'Evil' : 'Good');

  const isSold = bet.settled && bet.correct === null;
  const bgColor = bet.settled
    ? (isSold ? 'rgba(139, 115, 85, 0.1)' : (bet.correct ? 'rgba(45, 90, 45, 0.15)' : 'rgba(139, 0, 0, 0.15)'))
    : 'rgba(60, 40, 18, 0.08)';
  const borderColor = bet.settled
    ? (isSold ? '#8b735544' : (bet.correct ? '#2d5a2d55' : '#8b000055'))
    : '#8b735533';

  return (
    <div style={{
      padding: '10px 14px', marginBottom: 8,
      background: bgColor,
      border: `1px solid ${borderColor}`,
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
              color: settledDisplay(bet).color,
            }}>
              {settledDisplay(bet).text}
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
          onClick={() => gameId && sellBet(gameId, bet.id)}
          style={{
            marginTop: 6, padding: '2px 10px', background: 'transparent',
            border: '1px solid #8b735544', borderRadius: 4,
            color: '#5c3d1a', fontSize: 11, cursor: 'pointer', fontFamily: 'Georgia, serif',
          }}
        >Sell Position (10% spread)</button>
      )}
    </div>
  );
}
