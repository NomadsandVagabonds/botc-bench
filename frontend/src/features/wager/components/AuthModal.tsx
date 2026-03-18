import { useState } from 'react';
import { useWagerStore } from '../wagerStore.ts';

export function AuthModal() {
  const [name, setName] = useState('');
  const { showAuthModal, claimName, error, clearError } = useWagerStore();

  if (!showAuthModal) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return;
    await claimName(name.trim());
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)',
    }}>
      <div style={{
        background: '#1a1a2e', border: '2px solid #c9a84c',
        borderRadius: 12, padding: '32px 40px', maxWidth: 400,
        fontFamily: 'Georgia, serif', color: '#e8d5a3',
        textAlign: 'center',
      }}>
        <img src="/coin.png" alt="Crown" style={{ width: 48, height: 48, marginBottom: 8 }} />
        <h2 style={{ margin: '0 0 8px', color: '#c9a84c', fontSize: 24 }}>
          The Crown's Wager
        </h2>
        <p style={{ margin: '0 0 24px', fontSize: 14, opacity: 0.8 }}>
          Enter thy name to begin. Returning players will be recognized.
        </p>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={name}
            onChange={e => { setName(e.target.value); clearError(); }}
            placeholder="Enter thy name..."
            maxLength={24}
            style={{
              width: '100%', padding: '10px 14px',
              background: '#0d0d1a', border: '1px solid #c9a84c',
              borderRadius: 6, color: '#e8d5a3', fontSize: 16,
              fontFamily: 'Georgia, serif', boxSizing: 'border-box',
              outline: 'none',
            }}
          />

          {error && (
            <p style={{ color: '#8b0000', fontSize: 13, margin: '8px 0 0' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={name.trim().length < 2}
            style={{
              marginTop: 16, width: '100%', padding: '10px 0',
              background: name.trim().length >= 2 ? '#c9a84c' : '#555',
              color: '#1a1a2e', border: 'none', borderRadius: 6,
              fontSize: 16, fontFamily: 'Georgia, serif', fontWeight: 'bold',
              cursor: name.trim().length >= 2 ? 'pointer' : 'default',
            }}
          >
            Enter the Wager Hall
          </button>
        </form>
      </div>
    </div>
  );
}
