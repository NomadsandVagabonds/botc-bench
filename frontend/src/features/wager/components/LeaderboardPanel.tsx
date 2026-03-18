import { useEffect } from 'react';
import { useWagerStore } from '../wagerStore.ts';

export function LeaderboardPanel() {
  const { leaderboard, loadLeaderboard } = useWagerStore();

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  if (leaderboard.length === 0) {
    return (
      <div style={{
        padding: 24, textAlign: 'center',
        fontFamily: 'Georgia, serif', color: '#5c3d1a',
      }}>
        No wagers have been settled yet.<br />
        Be the first to make thy mark.
      </div>
    );
  }

  return (
    <div style={{ padding: 12, fontFamily: 'Georgia, serif', color: '#3d2812' }}>
      <h3 style={{ margin: '0 0 12px', color: '#3d2812', fontSize: 16 }}>
        Ye Olde Leaderboard
      </h3>

      <div style={{
        display: 'grid', gridTemplateColumns: '30px 1fr 80px 60px',
        gap: '4px 8px', fontSize: 13,
      }}>
        <div style={{ color: '#5c3d1a', fontWeight: 'bold' }}>#</div>
        <div style={{ color: '#5c3d1a', fontWeight: 'bold' }}>Name</div>
        <div style={{ color: '#5c3d1a', fontWeight: 'bold', textAlign: 'right' }}>Crowns</div>
        <div style={{ color: '#5c3d1a', fontWeight: 'bold', textAlign: 'right' }}>Acc.</div>

        {leaderboard.map(entry => (
          <div key={entry.rank} style={{ display: 'contents' }}>
            <div style={{ color: entry.rank <= 3 ? '#5c3d1a' : '#8b7355', fontWeight: entry.rank <= 3 ? 'bold' : 'normal' }}>
              {entry.rank}
            </div>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.displayName}
            </div>
            <div style={{ textAlign: 'right', color: '#3d2812', fontWeight: 'bold' }}>
              {entry.totalCrownsEarned}
            </div>
            <div style={{ textAlign: 'right', color: '#5c3d1a' }}>
              {entry.accuracyPct.toFixed(0)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
