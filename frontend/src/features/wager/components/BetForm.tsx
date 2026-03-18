import { useEffect } from 'react';
import { useGameStore } from '../../../stores/gameStore.ts';
import { useWagerStore } from '../wagerStore.ts';

/** Format market ID into a human label */
function marketLabel(marketId: string, players: any[]): string {
  if (marketId === 'winner_evil') return 'Evil Wins the Game';
  if (marketId.startsWith('alignment_seat_')) {
    const seat = parseInt(marketId.split('_').pop()!, 10);
    const p = players.find((pl: any) => pl.seat === seat);
    return p?.characterName || `Seat ${seat}`;
  }
  return marketId;
}

export function BetForm({ onMarketDetail }: { onMarketDetail?: (marketId: string) => void }) {
  const gameState = useGameStore(s => s.gameState);
  const {
    markets, selectedMarket, selectedSide, betAmount, quote, crownsBudget, error, gameId,
    setSelectedMarket, setSelectedSide, setBetAmount, fetchQuote, placeBet, clearError,
  } = useWagerStore();

  const players = gameState?.players ?? [];
  const isGameOver = gameState?.phase === 'game_over';

  // Fetch quote whenever selection changes
  useEffect(() => {
    if (gameId && selectedMarket && betAmount > 0) {
      fetchQuote(gameId);
    }
  }, [gameId, selectedMarket, selectedSide, betAmount, fetchQuote]);

  // Separate markets by type
  const alignmentMarkets = markets.filter(m => m.marketId.startsWith('alignment_seat_'));
  const winnerMarket = markets.find(m => m.marketId === 'winner_evil');

  const handlePlace = async () => {
    if (!gameId || isGameOver) return;
    await placeBet(gameId);
  };

  const selectedMkt = markets.find(m => m.marketId === selectedMarket);

  return (
    <div style={{ padding: 16, fontFamily: 'Georgia, serif', color: '#3d2812' }}>

      {/* Winner Market — always shown at top */}
      {winnerMarket && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>Who Shall Prevail?</div>
          <div style={{
            display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden',
            border: '2px solid #1a1a1a',
            boxShadow: 'inset 0 0 8px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.3)',
          }}>
            <button
              onClick={() => { setSelectedMarket('winner_evil'); setSelectedSide('yes'); }}
              style={{
                flex: 1, padding: '12px 0', fontSize: 14, cursor: 'pointer',
                fontFamily: 'Georgia, serif',
                border: 'none', borderRight: '1px solid #111',
                color: '#e8d5a3', fontWeight: 'bold',
                textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                background: selectedMarket === 'winner_evil' && selectedSide === 'yes'
                  ? 'linear-gradient(180deg, #6b1a1a 0%, #4a0e0e 50%, #3a0808 100%)'
                  : 'linear-gradient(180deg, #5a1515 0%, #3d0a0a 50%, #2a0505 100%)',
                boxShadow: selectedMarket === 'winner_evil' && selectedSide === 'yes'
                  ? 'inset 0 1px 0 #8b3333, inset 0 -2px 4px rgba(0,0,0,0.4)'
                  : 'inset 0 1px 0 #6b2222, inset 0 -1px 2px rgba(0,0,0,0.3)',
              }}
            >
              Evil {(winnerMarket.probYes * 100).toFixed(0)}%
            </button>
            <button
              onClick={() => { setSelectedMarket('winner_evil'); setSelectedSide('no'); }}
              style={{
                flex: 1, padding: '12px 0', fontSize: 14, cursor: 'pointer',
                fontFamily: 'Georgia, serif',
                border: 'none',
                color: '#e8d5a3', fontWeight: 'bold',
                textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                background: selectedMarket === 'winner_evil' && selectedSide === 'no'
                  ? 'linear-gradient(180deg, #1a5a1a 0%, #0e3a0e 50%, #082a08 100%)'
                  : 'linear-gradient(180deg, #154a15 0%, #0a300a 50%, #052005 100%)',
                boxShadow: selectedMarket === 'winner_evil' && selectedSide === 'no'
                  ? 'inset 0 1px 0 #338b33, inset 0 -2px 4px rgba(0,0,0,0.4)'
                  : 'inset 0 1px 0 #226b22, inset 0 -1px 2px rgba(0,0,0,0.3)',
              }}
            >
              Good {(winnerMarket.probNo * 100).toFixed(0)}%
            </button>
          </div>
        </div>
      )}

      {/* Alignment Markets */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>Player Alignment Markets</div>
        <div style={{ maxHeight: 220, overflow: 'auto' }}>
          {alignmentMarkets.map(m => {
            const seat = parseInt(m.marketId.split('_').pop()!, 10);
            const p = players.find((pl: any) => pl.seat === seat);
            if (p && !p.isAlive) return null;
            const name = p?.characterName || `Seat ${seat}`;
            const isSelected = selectedMarket === m.marketId;
            const pEvil = (m.probYes * 100).toFixed(0);

            return (
              <div key={m.marketId} style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3,
                padding: '4px 8px', borderRadius: 6,
                background: isSelected ? '#c9a84c15' : 'transparent',
                border: isSelected ? '1px solid #c9a84c44' : '1px solid transparent',
              }}>
                <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name}
                </span>
                <span style={{ fontSize: 11, color: '#8b0000', width: 35, textAlign: 'right' }}>
                  {pEvil}%
                </span>
                <button
                  onClick={() => { setSelectedMarket(m.marketId); setSelectedSide('yes'); clearError(); }}
                  style={{
                    padding: '3px 10px', fontSize: 11, borderRadius: 3, cursor: 'pointer',
                    fontFamily: 'Georgia, serif', fontWeight: 'bold',
                    border: '1px solid #4a1111',
                    color: '#e8c8c8',
                    textShadow: '0 1px 1px rgba(0,0,0,0.5)',
                    background: isSelected && selectedSide === 'yes'
                      ? 'linear-gradient(180deg, #6b1a1a, #3d0a0a)'
                      : 'linear-gradient(180deg, #4a1111, #2a0808)',
                    boxShadow: isSelected && selectedSide === 'yes'
                      ? 'inset 0 1px 0 #8b3333, 0 0 4px rgba(139,0,0,0.4)'
                      : 'inset 0 1px 0 #5a2020',
                  }}
                >Evil</button>
                <button
                  onClick={() => { setSelectedMarket(m.marketId); setSelectedSide('no'); clearError(); }}
                  style={{
                    padding: '3px 10px', fontSize: 11, borderRadius: 3, cursor: 'pointer',
                    fontFamily: 'Georgia, serif', fontWeight: 'bold',
                    border: '1px solid #114a11',
                    color: '#c8e8c8',
                    textShadow: '0 1px 1px rgba(0,0,0,0.5)',
                    background: isSelected && selectedSide === 'no'
                      ? 'linear-gradient(180deg, #1a5a1a, #0a3a0a)'
                      : 'linear-gradient(180deg, #114a11, #082a08)',
                    boxShadow: isSelected && selectedSide === 'no'
                      ? 'inset 0 1px 0 #338b33, 0 0 4px rgba(0,139,0,0.4)'
                      : 'inset 0 1px 0 #206b20',
                  }}
                >Good</button>
                {onMarketDetail && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onMarketDetail(m.marketId); }}
                    title="Market details"
                    style={{
                      padding: '2px 5px', fontSize: 10, borderRadius: 3, cursor: 'pointer',
                      border: 'none', background: 'rgba(60, 40, 18, 0.05)', color: '#5c3d1a',
                      fontFamily: 'monospace',
                    }}
                  >...</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bet Amount + Quote */}
      {selectedMarket && (
        <>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>
              Wagering on: <span style={{ color: '#5c3d1a' }}>{marketLabel(selectedMarket, players)}</span>
              {' '}&mdash;{' '}
              <span style={{ color: selectedSide === 'yes' ? '#8b0000' : '#2d5a2d', fontWeight: 'bold' }}>
                {selectedMarket === 'winner_evil'
                  ? (selectedSide === 'yes' ? 'Evil wins' : 'Good wins')
                  : (selectedSide === 'yes' ? 'Is Evil' : 'Is Good')
                }
              </span>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>
              Crowns: <span style={{ color: '#5c3d1a', fontWeight: 'bold' }}>{betAmount}</span>
              <span style={{ opacity: 0.7 }}> / {crownsBudget.toFixed(0)} remaining</span>
            </div>
            <input
              type="range"
              min={1} max={Math.min(50, Math.floor(crownsBudget))}
              value={betAmount}
              onChange={e => setBetAmount(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#c9a84c' }}
            />
          </div>

          {/* Live Quote */}
          {quote && (
            <div style={{
              padding: '8px 12px', marginBottom: 12,
              background: 'rgba(60, 40, 18, 0.08)', borderRadius: 6, border: '1px solid #8b735544',
              fontSize: 13,
            }}>
              <div>Shares: <span style={{ color: '#5c3d1a' }}>{quote.shares.toFixed(1)}</span></div>
              <div>Market price: <span style={{ color: '#5c3d1a' }}>{(quote.currentProb * 100).toFixed(0)}%</span></div>
              <div>
                If correct: <span style={{ color: '#2d5a2d' }}>
                  +{quote.potentialProfit.toFixed(1)} Crowns
                </span>
                <span style={{ opacity: 0.7 }}> ({quote.potentialPayout.toFixed(1)} payout)</span>
              </div>
            </div>
          )}

          {error && <p style={{ color: '#8b0000', fontSize: 13, margin: '0 0 8px' }}>{error}</p>}

          <button
            onClick={handlePlace}
            disabled={isGameOver || crownsBudget < 1 || !selectedMarket}
            style={{
              width: '100%', padding: '12px 0',
              background: isGameOver ? '#333'
                : 'linear-gradient(180deg, #4a3a1a 0%, #3d2812 50%, #2a1a08 100%)',
              color: '#e8d5a3', border: '2px solid #1a1a1a',
              borderRadius: 6,
              fontSize: 16, fontFamily: 'Georgia, serif', fontWeight: 'bold',
              cursor: isGameOver ? 'default' : 'pointer',
              opacity: crownsBudget < 1 ? 0.5 : 1,
              textShadow: '0 1px 2px rgba(0,0,0,0.5)',
              boxShadow: 'inset 0 1px 0 #6b5a3a, inset 0 -2px 4px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.3)',
            }}
          >
            {isGameOver ? 'Game Hath Concluded' :
             crownsBudget < 1 ? 'Thy Purse Is Empty' :
             'Place Wager'}
          </button>

          {/* Coin sack flourish */}
          <div style={{ textAlign: 'center', marginTop: 12, opacity: 0.85 }}>
            <img
              src="/sack.png"
              alt=""
              style={{ width: 72, height: 72 }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        </>
      )}

      {!selectedMarket && (
        <div style={{ textAlign: 'center', padding: 12, color: '#5c3d1a', fontSize: 13, fontStyle: 'italic' }}>
          Select a market above to place thy wager.
        </div>
      )}
    </div>
  );
}
