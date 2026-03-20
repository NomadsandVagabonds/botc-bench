/**
 * AdminGate — requires GitHub OAuth admin access on production.
 * On localhost, always allows access (no auth needed for local dev).
 */

import { useState, useEffect } from 'react';

const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

function getServerUrl(): string {
  return localStorage.getItem('bloodbench_server_url')
    || import.meta.env.VITE_API_URL
    || 'http://localhost:8000';
}

export function AdminGate({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState(!isProduction);
  const [checking, setChecking] = useState(isProduction);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isProduction) return;

    // Check for wager_token in URL params (GitHub OAuth callback)
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('wager_token');
    if (urlToken) {
      localStorage.setItem('wager_token', urlToken);
      // Clean URL
      params.delete('wager_token');
      const clean = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (clean ? `?${clean}` : ''));
    }

    const token = urlToken || localStorage.getItem('wager_token');
    if (!token) {
      setChecking(false);
      setError('not_logged_in');
      return;
    }

    const serverUrl = getServerUrl();
    fetch(`${serverUrl}/api/wager/auth/me`, {
      headers: { 'X-Wager-Token': token },
    })
      .then(r => {
        if (r.status === 401) {
          // Token is stale (DB was wiped on redeploy) — clear and show login
          localStorage.removeItem('wager_token');
          setError('not_logged_in');
          setChecking(false);
          return null;
        }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        if (data.github_id) {
          // Any authenticated GitHub user can access
          setAuthorized(true);
        } else {
          setError('not_logged_in');
        }
        setChecking(false);
      })
      .catch(() => {
        setError('server_error');
        setChecking(false);
      });
  }, []);

  // Localhost: always allow
  if (!isProduction) return <>{children}</>;

  if (checking) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a0806', color: '#c9a84c', fontFamily: 'Georgia, serif',
      }}>
        Verifying access...
      </div>
    );
  }

  if (authorized) return <>{children}</>;

  const handleGitHubLogin = () => {
    const serverUrl = getServerUrl();
    const redirect = window.location.pathname;
    window.location.href = `${serverUrl}/api/wager/auth/github?redirect=${encodeURIComponent(redirect)}`;
  };

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0a0806', fontFamily: 'Georgia, serif',
    }}>
      <div style={{
        background: '#1a1a2e', border: '2px solid #c9a84c', borderRadius: 12,
        padding: '40px 48px', maxWidth: 400, textAlign: 'center', color: '#e8d5a3',
      }}>
        <h2 style={{ color: '#c9a84c', margin: '0 0 12px', fontSize: 22 }}>Sign In to Play</h2>
        <p style={{ fontSize: 14, opacity: 0.8, margin: '0 0 24px' }}>
          Sign in with GitHub to start games with your own API keys.
          Bring your own keys, keep the replays.
        </p>

        {(
          <button
            onClick={handleGitHubLogin}
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
        )}

        <a href="/" style={{ display: 'block', marginTop: 16, fontSize: 13, color: '#8b7355' }}>
          Back to home
        </a>
      </div>
    </div>
  );
}
