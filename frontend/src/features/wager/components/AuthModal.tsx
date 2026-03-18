import { useState } from 'react';
import { useWagerStore } from '../wagerStore.ts';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export function AuthModal() {
  const [name, setName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showManual, setShowManual] = useState(false);
  const { showAuthModal, claimName, error, clearError } = useWagerStore();

  if (!showAuthModal) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return;
    await claimName(name.trim(), passphrase.trim() || undefined);
  };

  const handleGitHub = () => {
    const redirect = window.location.pathname + window.location.search;
    window.location.href = `${API_BASE}/api/wager/auth/github?redirect=${encodeURIComponent(redirect)}`;
  };

  const isPassphraseError = error?.toLowerCase().includes('passphrase');

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)',
    }}>
      <div style={{
        background: '#1a1a2e', border: '2px solid #c9a84c',
        borderRadius: 12, padding: '32px 40px', maxWidth: 400, width: '90vw',
        fontFamily: 'Georgia, serif', color: '#e8d5a3',
        textAlign: 'center',
      }}>
        <img src="/coin.png" alt="Crown" style={{ width: 48, height: 48, marginBottom: 8 }} />
        <h2 style={{ margin: '0 0 8px', color: '#c9a84c', fontSize: 24 }}>
          The Crown's Wager
        </h2>
        <p style={{ margin: '0 0 24px', fontSize: 14, opacity: 0.8 }}>
          Sign in to place thy wagers.
        </p>

        {/* GitHub OAuth — primary */}
        <button
          onClick={handleGitHub}
          style={{
            width: '100%', padding: '12px 0',
            background: '#24292e', color: '#fff',
            border: '1px solid #444', borderRadius: 6,
            fontSize: 15, fontFamily: 'Georgia, serif', fontWeight: 'bold',
            cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 10,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          Sign in with GitHub
        </button>

        {/* Divider */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          margin: '20px 0', opacity: 0.4,
        }}>
          <div style={{ flex: 1, height: 1, background: '#c9a84c' }} />
          <span style={{ fontSize: 12 }}>or</span>
          <div style={{ flex: 1, height: 1, background: '#c9a84c' }} />
        </div>

        {/* Manual name + passphrase fallback */}
        {!showManual ? (
          <button
            onClick={() => setShowManual(true)}
            style={{
              background: 'transparent', border: '1px solid #5c3d1a',
              borderRadius: 6, padding: '8px 0', width: '100%',
              color: '#8b7355', fontSize: 13, cursor: 'pointer',
              fontFamily: 'Georgia, serif',
            }}
          >
            Enter with name &amp; passphrase instead
          </button>
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); clearError(); }}
              placeholder="Thy name..."
              maxLength={24}
              autoComplete="username"
              style={{
                width: '100%', padding: '10px 14px',
                background: '#0d0d1a', border: '1px solid #c9a84c',
                borderRadius: 6, color: '#e8d5a3', fontSize: 16,
                fontFamily: 'Georgia, serif', boxSizing: 'border-box',
                outline: 'none',
              }}
            />

            <input
              type="password"
              value={passphrase}
              onChange={e => { setPassphrase(e.target.value); clearError(); }}
              placeholder="Secret passphrase..."
              maxLength={64}
              autoComplete="current-password"
              style={{
                width: '100%', padding: '10px 14px', marginTop: 10,
                background: '#0d0d1a',
                border: `1px solid ${isPassphraseError ? '#8b0000' : '#5c3d1a'}`,
                borderRadius: 6, color: '#e8d5a3', fontSize: 16,
                fontFamily: 'Georgia, serif', boxSizing: 'border-box',
                outline: 'none',
              }}
            />

            <p style={{ margin: '8px 0 0', fontSize: 11, opacity: 0.5, fontStyle: 'italic' }}>
              New? Pick any name &amp; passphrase. Returning? Enter your credentials.
            </p>

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
        )}
      </div>
    </div>
  );
}
