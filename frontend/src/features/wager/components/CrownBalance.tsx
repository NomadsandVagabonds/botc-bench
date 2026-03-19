import { useWagerStore } from '../wagerStore.ts';

export function CrownBalance() {
  const { crownsBudget, crownsWon, sessionSettled, user } = useWagerStore();
  const total = sessionSettled ? crownsBudget + crownsWon : crownsBudget;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      fontFamily: 'Georgia, serif', color: '#c9a84c',
    }}>
      <img src="/coin.png" alt="Crown" style={{ width: 24, height: 24, borderRadius: '50%' }} />
      <span style={{ fontSize: 20, fontWeight: 'bold' }}>
        {total.toFixed(0)}
      </span>
      <span style={{ fontSize: 11, opacity: 0.7 }}>Crowns</span>

      {user && (
        <span style={{ fontSize: 12, color: '#8b7355', marginLeft: 4 }}>
          {user.displayName}
        </span>
      )}
    </div>
  );
}
