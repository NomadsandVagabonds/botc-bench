import { useState } from 'react';
import { useWagerStore } from '../wagerStore.ts';
import { BetForm } from './BetForm.tsx';
import { BetCard } from './BetCard.tsx';
import { LeaderboardPanel } from './LeaderboardPanel.tsx';
import { MarketDetail } from './MarketDetail.tsx';

type Tab = 'wager' | 'bets' | 'standings';

const TAB_LABELS: Record<Tab, string> = {
  wager: 'Markets',
  bets: 'My Bets',
  standings: 'Standings',
};

export function WagerPanel() {
  const [tab, setTab] = useState<Tab>('wager');
  const [detailMarketId, setDetailMarketId] = useState<string | null>(null);
  const { bets, gameId } = useWagerStore();

  const activeBets = bets.filter(b => !b.settled);
  const settledBets = bets.filter(b => b.settled);

  // Show market detail overlay when a bet is clicked
  if (detailMarketId && gameId) {
    return (
      <div style={{
        width: 360, height: '100%',
        backgroundImage: 'url(/parchment.jpg)', backgroundSize: 'cover', backgroundPosition: 'center',
        borderLeft: '2px solid #3d2812', position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <MarketDetail
          gameId={gameId}
          marketId={detailMarketId}
          onBack={() => setDetailMarketId(null)}
        />
      </div>
    );
  }

  return (
    <div style={{
      width: 360, height: '100%',
      backgroundImage: 'url(/parchment.jpg)', backgroundSize: 'cover', backgroundPosition: 'center',
      borderLeft: '2px solid #3d2812',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      position: 'relative', zIndex: 1,
    }}>
      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: 2, padding: '0 4px', background: '#2a2a2a' }}>
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '10px 0', cursor: 'pointer',
              fontFamily: 'Georgia, serif', fontSize: 12, border: 'none',
              color: tab === t ? '#c9a84c' : '#888',
              fontWeight: tab === t ? 'bold' : 'normal',
              background: tab === t
                ? 'linear-gradient(180deg, #4a4a4a 0%, #333 40%, #2a2a2a 100%)'
                : 'linear-gradient(180deg, #3a3a3a 0%, #2a2a2a 40%, #222 100%)',
              boxShadow: tab === t
                ? 'inset 0 1px 0 #666, inset 0 -1px 0 #111, 0 2px 4px rgba(0,0,0,0.3)'
                : 'inset 0 1px 0 #444, inset 0 -1px 0 #111',
              borderRadius: '4px 4px 0 0',
              textShadow: tab === t ? '0 1px 2px rgba(0,0,0,0.5)' : 'none',
            }}
          >
            {TAB_LABELS[t]}
            {t === 'bets' && activeBets.length > 0 && (
              <span style={{
                marginLeft: 4, background: '#5c3d1a33', borderRadius: 8,
                padding: '1px 5px', fontSize: 10,
              }}>{activeBets.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'wager' && <BetForm onMarketDetail={setDetailMarketId} />}

        {tab === 'bets' && (
          <div style={{ padding: 12 }}>
            {activeBets.length === 0 && settledBets.length === 0 && (
              <p style={{ textAlign: 'center', color: '#3d2812', padding: 24, fontFamily: 'Georgia, serif' }}>
                No wagers placed yet. Fortune favours the bold.
              </p>
            )}
            {activeBets.length > 0 && (
              <>
                <h4 style={{ margin: '0 0 8px', color: '#3d2812', fontFamily: 'Georgia, serif', fontSize: 14 }}>
                  Active Wagers
                </h4>
                {activeBets.map(b => (
                  <div key={b.id} onClick={() => setDetailMarketId(b.marketId)} style={{ cursor: 'pointer' }}>
                    <BetCard bet={b} />
                  </div>
                ))}
              </>
            )}
            {settledBets.length > 0 && (
              <>
                <h4 style={{ margin: '16px 0 8px', color: '#3d2812', fontFamily: 'Georgia, serif', fontSize: 14 }}>
                  Settled
                </h4>
                {settledBets.map(b => (
                  <div key={b.id} onClick={() => setDetailMarketId(b.marketId)} style={{ cursor: 'pointer' }}>
                    <BetCard bet={b} />
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {tab === 'standings' && <LeaderboardPanel />}
      </div>

      {/* Gargoyles removed from here — moved to SpectatorView for full-width positioning */}
    </div>
  );
}
