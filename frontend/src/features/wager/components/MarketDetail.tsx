/**
 * Market detail view — parchment-themed.
 * Probability chart, liquidity, recent trades.
 */

import { useEffect, useState, useRef } from 'react';
import { useGameStore } from '../../../stores/gameStore.ts';
import { useWagerStore } from '../wagerStore.ts';

interface HistoryPoint {
  probYes: number;
  eventType: string;
  actor: string | null;
  timestamp: number;
}

function marketLabel(marketId: string, players: any[]): string {
  if (marketId === 'winner_evil') return 'Evil Wins the Game';
  if (marketId.startsWith('alignment_seat_')) {
    const seat = parseInt(marketId.split('_').pop()!, 10);
    const p = players.find((pl: any) => pl.seat === seat);
    return `${p?.characterName || `Seat ${seat}`} is Evil`;
  }
  if (marketId.startsWith('custom_')) return marketId.replace('custom_', '').replace(/_/g, ' ');
  return marketId;
}

function ProbChart({ history }: { history: HistoryPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const pad = { top: 10, bottom: 20, left: 35, right: 10 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    ctx.clearRect(0, 0, w, h);

    // Transparent background (parchment shows through)

    // Grid lines
    ctx.strokeStyle = 'rgba(61, 40, 18, 0.2)';
    ctx.lineWidth = 1;
    for (const pct of [0.25, 0.5, 0.75]) {
      const y = pad.top + plotH * (1 - pct);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = '#5c3d1a';
      ctx.font = '10px Georgia';
      ctx.textAlign = 'right';
      ctx.fillText(`${(pct * 100).toFixed(0)}%`, pad.left - 4, y + 3);
    }

    // Probability line — deep green
    const minT = history[0].timestamp;
    const maxT = history[history.length - 1].timestamp;
    const tRange = maxT - minT || 1;

    ctx.strokeStyle = '#2d5a2d';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    for (let i = 0; i < history.length; i++) {
      const x = pad.left + (plotW * (history[i].timestamp - minT)) / tRange;
      const y = pad.top + plotH * (1 - history[i].probYes);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        const prevY = pad.top + plotH * (1 - history[i - 1].probYes);
        ctx.lineTo(x, prevY);
        ctx.lineTo(x, y);
      }
    }
    const lastY = pad.top + plotH * (1 - history[history.length - 1].probYes);
    ctx.lineTo(w - pad.right, lastY);
    ctx.stroke();

    // Fill under — subtle
    ctx.lineTo(w - pad.right, pad.top + plotH);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(45, 90, 45, 0.1)';
    ctx.fill();

  }, [history]);

  return (
    <canvas
      ref={canvasRef}
      width={340}
      height={160}
      style={{ width: '100%', height: 160, borderRadius: 4, border: '1px solid rgba(61, 40, 18, 0.2)' }}
    />
  );
}

interface MarketDetailProps {
  gameId: string;
  marketId: string;
  onBack: () => void;
}

export function MarketDetail({ gameId, marketId, onBack }: MarketDetailProps) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const gameState = useGameStore(s => s.gameState);
  const { markets, bets } = useWagerStore();
  const players = gameState?.players ?? [];

  const market = markets.find(m => m.marketId === marketId);
  const marketBets = bets.filter(b => b.marketId === marketId);

  useEffect(() => {
    setLoading(true);
    const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
    fetch(`${base}/api/wager/games/${gameId}/markets/${marketId}/history`)
      .then(r => r.json())
      .then(data => {
        setHistory((data.history ?? []).map((h: any) => ({
          probYes: h.prob_yes,
          eventType: h.event_type,
          actor: h.actor,
          timestamp: h.timestamp,
        })));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [gameId, marketId]);

  const label = marketLabel(marketId, players);
  const currentProb = market?.probYes ?? 0.5;
  const liquidity = market ? (market.yesPool + market.noPool).toFixed(0) : '?';

  return (
    <div style={{ padding: 12, fontFamily: 'Georgia, serif', color: '#3d2812', overflow: 'auto', flex: 1 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button onClick={onBack} style={{
          background: 'linear-gradient(180deg, #4a4a4a, #2a2a2a)',
          border: '1px solid #1a1a1a', borderRadius: 3,
          color: '#c9a84c', padding: '3px 10px', fontSize: 12, cursor: 'pointer',
          fontFamily: 'Georgia, serif',
          boxShadow: 'inset 0 1px 0 #666',
          textShadow: '0 1px 1px rgba(0,0,0,0.5)',
        }}>Back</button>
        <span style={{ fontSize: 14, fontWeight: 'bold' }}>{label}</span>
      </div>

      {/* Current probability */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 'bold', color: '#3d2812' }}>
          {(currentProb * 100).toFixed(0)}%
        </span>
        <span style={{ fontSize: 13, color: '#5c3d1a' }}>chance</span>
      </div>

      {/* Chart */}
      <div style={{ marginBottom: 16 }}>
        {loading ? (
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5c3d1a' }}>
            Loading...
          </div>
        ) : history.length < 2 ? (
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5c3d1a', fontSize: 13 }}>
            Not enough data for chart yet
          </div>
        ) : (
          <ProbChart history={history} />
        )}
      </div>

      {/* Liquidity & stats */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16,
        fontSize: 12,
      }}>
        <div style={{ padding: '8px 10px', border: '1px solid rgba(61, 40, 18, 0.2)', borderRadius: 4 }}>
          <div style={{ color: '#5c3d1a', marginBottom: 2 }}>Liquidity</div>
          <div style={{ color: '#3d2812', fontWeight: 'bold' }}>
            <img src="/coin.png" alt="" style={{ width: 12, height: 12, verticalAlign: 'middle', marginRight: 4 }} />
            {liquidity}
          </div>
        </div>
        <div style={{ padding: '8px 10px', border: '1px solid rgba(61, 40, 18, 0.2)', borderRadius: 4 }}>
          <div style={{ color: '#5c3d1a', marginBottom: 2 }}>Trades</div>
          <div style={{ color: '#3d2812', fontWeight: 'bold' }}>
            {history.filter(h => h.eventType === 'bet').length}
          </div>
        </div>
        <div style={{ padding: '8px 10px', border: '1px solid rgba(61, 40, 18, 0.2)', borderRadius: 4 }}>
          <div style={{ color: '#5c3d1a', marginBottom: 2 }}>YES Pool</div>
          <div style={{ color: '#3d2812' }}>{market?.yesPool.toFixed(0) ?? '?'}</div>
        </div>
        <div style={{ padding: '8px 10px', border: '1px solid rgba(61, 40, 18, 0.2)', borderRadius: 4 }}>
          <div style={{ color: '#5c3d1a', marginBottom: 2 }}>NO Pool</div>
          <div style={{ color: '#3d2812' }}>{market?.noPool.toFixed(0) ?? '?'}</div>
        </div>
      </div>

      {/* Recent activity */}
      <div style={{ fontSize: 12 }}>
        <div style={{ color: '#5c3d1a', marginBottom: 6, fontWeight: 'bold' }}>Recent Activity</div>
        {history.slice(-8).reverse().map((h, i) => (
          <div key={i} style={{
            padding: '3px 0', borderBottom: '1px solid rgba(61, 40, 18, 0.1)',
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span style={{ color: '#5c3d1a' }}>
              {h.actor ?? 'System'} {h.eventType === 'bet' ? 'traded' : h.eventType}
            </span>
            <span style={{ color: '#3d2812', fontWeight: 'bold' }}>{(h.probYes * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>

      {/* My bets on this market */}
      {marketBets.length > 0 && (
        <div style={{ marginTop: 16, fontSize: 12 }}>
          <div style={{ color: '#3d2812', marginBottom: 6, fontWeight: 'bold' }}>Your Positions</div>
          {marketBets.map(b => (
            <div key={b.id} style={{
              padding: '4px 8px', marginBottom: 4,
              border: '1px solid rgba(61, 40, 18, 0.15)', borderRadius: 4,
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>
                <span style={{ color: b.side === 'yes' ? '#8b0000' : '#2d5a2d', fontWeight: 'bold' }}>
                  {b.side.toUpperCase()}
                </span>
                {' '}{b.shares.toFixed(1)} shares @ {(b.probAtPurchase * 100).toFixed(0)}%
              </span>
              <span style={{ color: b.settled ? (b.correct ? '#2d5a2d' : '#8b0000') : '#5c3d1a', fontWeight: 'bold' }}>
                {b.settled ? (b.correct ? `+${((b.crownsPayout ?? 0) - b.crownsSpent).toFixed(0)}` : `-${b.crownsSpent.toFixed(0)}`) : `${b.crownsSpent.toFixed(0)}C`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
