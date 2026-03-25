import { useState, useEffect, useCallback } from 'react';
import { getCreditBalance, getCreditPacks, purchaseCredits } from '../api/rest.ts';
import type { CreditPack } from '../api/rest.ts';

// ── Coin Display ────────────────────────────────────────────────────

function CoinIcon({ size = 24, dim = false }: { size?: number; dim?: boolean }) {
  return (
    <img
      src="/coin.png"
      alt=""
      style={{
        width: size,
        height: size,
        imageRendering: 'auto',
        opacity: dim ? 0.3 : 1,
        filter: dim ? 'grayscale(0.5)' : 'none',
      }}
    />
  );
}

function CoinDisplay({ amount, size = 20 }: { amount: number; size?: number }) {
  if (amount <= 0) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <CoinIcon size={size} dim />
        <span style={{ fontSize: size * 0.6, color: '#8b7355', fontStyle: 'italic' }}>Empty</span>
      </span>
    );
  }
  if (amount <= 5) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        {Array.from({ length: Math.floor(amount) }, (_, i) => (
          <CoinIcon key={i} size={size} />
        ))}
        {amount % 1 > 0 && (
          <span style={{ fontSize: size * 0.55, fontFamily: 'monospace', color: '#5a4630', marginLeft: 2 }}>
            +{(amount % 1).toFixed(1).slice(1)}
          </span>
        )}
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <CoinIcon size={size} />
      <span style={{ fontSize: size * 0.7, fontFamily: 'monospace', fontWeight: 700, color: '#2a1a0a' }}>
        {amount % 1 === 0 ? `${amount}` : amount.toFixed(1)}
      </span>
    </span>
  );
}

// ── Credit Badge (for lobby header) ─────────────────────────────────

export function CreditBadge({
  balance,
  onClick,
}: {
  balance: number | null;
  onClick: () => void;
}) {
  if (balance === null) return null;
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        background: 'rgba(92, 61, 26, 0.1)',
        border: '1px solid rgba(139, 94, 42, 0.3)',
        borderRadius: 4,
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
      title="Click to buy credits"
    >
      <CoinDisplay amount={balance} size={18} />
    </button>
  );
}

// ── Credit Balance Display (inline in setup view) ───────────────────

export function CreditBalanceInline({
  balance,
  estimatedCost,
  onBuyCredits,
  onUseApiKeys,
}: {
  balance: number | null;
  estimatedCost: number | null;
  onBuyCredits: () => void;
  onUseApiKeys: () => void;
}) {
  const sufficient = balance !== null && estimatedCost !== null && balance >= estimatedCost;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#3d2812' }}>
          Balance:
        </span>
        {balance !== null ? (
          <CoinDisplay amount={balance} size={18} />
        ) : (
          <span style={{ fontSize: '0.7rem', color: '#8b7355' }}>Loading...</span>
        )}
        <button
          onClick={onBuyCredits}
          style={{
            background: 'none',
            border: 'none',
            color: '#5b21b6',
            fontSize: '0.62rem',
            fontWeight: 700,
            cursor: 'pointer',
            textDecoration: 'underline',
            padding: 0,
          }}
        >
          Buy Credits
        </button>
      </div>

      {estimatedCost !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.62rem', color: '#5a4630' }}>This game:</span>
          <CoinDisplay amount={estimatedCost} size={16} />
          {!sufficient && balance !== null && (
            <span style={{ fontSize: '0.58rem', color: '#991B1B', fontWeight: 600 }}>
              (insufficient)
            </span>
          )}
        </div>
      )}

      <button
        onClick={onUseApiKeys}
        style={{
          background: 'none',
          border: 'none',
          color: '#8b7355',
          fontSize: '0.58rem',
          cursor: 'pointer',
          textDecoration: 'underline',
          padding: '4px 0 0 0',
        }}
      >
        Or use your own API keys
      </button>
    </div>
  );
}

// ── Credit Purchase Modal ───────────────────────────────────────────

export function CreditPurchaseModal({ onClose }: { onClose: () => void }) {
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCreditPacks()
      .then((data) => {
        setPacks(data.packs ?? data as any);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load credit packs');
        setLoading(false);
      });
  }, []);

  const handlePurchase = useCallback(async (packId: string) => {
    setPurchasing(packId);
    setError(null);
    try {
      const result = await purchaseCredits(packId);
      window.location.href = result.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed');
      setPurchasing(null);
    }
  }, []);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>BUY CREDITS</div>
        <div style={styles.subtitle}>Credits are used to run games on our servers.</div>

        {loading && <div style={styles.loadingText}>Loading packs...</div>}
        {error && <div style={styles.errorText}>{error}</div>}

        <div style={styles.packGrid}>
          {packs.map((pack) => (
            <button
              key={pack.id}
              style={{
                ...styles.packCard,
                opacity: purchasing && purchasing !== pack.id ? 0.4 : 1,
              }}
              onClick={() => void handlePurchase(pack.id)}
              disabled={!!purchasing}
            >
              <div style={styles.packCoins}>
                <CoinDisplay amount={pack.credits} size={22} />
              </div>
              <div style={styles.packCredits}>{pack.credits} credits</div>
              <div style={styles.packPrice}>${pack.price_usd.toFixed(0)}</div>
              {pack.credits > pack.price_usd && (
                <div style={styles.packBonus}>
                  +{Math.round(((pack.credits - pack.price_usd) / pack.price_usd) * 100)}% bonus
                </div>
              )}
            </button>
          ))}
        </div>

        <div style={styles.note}>
          Credits never expire. 1 credit &#8776; $1 of API cost.
        </div>

        <button style={styles.closeBtn} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ── Credit Success Page ─────────────────────────────────────────────

export function CreditSuccessPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [status, setStatus] = useState<'checking' | 'success' | 'error'>('checking');

  useEffect(() => {
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      try {
        const result = await getCreditBalance();
        if (result.balance > 0) {
          setBalance(result.balance);
          setStatus('success');
          clearInterval(poll);
          // Auto-redirect to lobby after 2s
          setTimeout(() => { window.location.href = '/lobby'; }, 2000);
        }
      } catch {
        // Keep polling
      }
      if (attempts >= 15) {
        clearInterval(poll);
        setStatus('error');
      }
    }, 2000);

    return () => clearInterval(poll);
  }, []);

  return (
    <div style={styles.successPage}>
      {status === 'checking' && (
        <>
          <div style={styles.successTitle}>Processing purchase...</div>
          <div style={styles.successText}>Adding credits to your account.</div>
        </>
      )}
      {status === 'success' && (
        <>
          <div style={{ marginBottom: 16 }}>
            <CoinDisplay amount={balance ?? 0} size={36} />
          </div>
          <div style={styles.successTitle}>Credits Added!</div>
          <div style={styles.successText}>
            Your balance: {balance?.toFixed(1)} credits. Redirecting to lobby...
          </div>
        </>
      )}
      {status === 'error' && (
        <>
          <div style={styles.successTitle}>Something went wrong</div>
          <div style={styles.successText}>
            Your payment was processed but credits may take a moment to appear.
          </div>
          <a href="/lobby" style={styles.backLink}>Back to lobby</a>
        </>
      )}
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(10, 8, 6, 0.7)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(4px)',
  },
  modal: {
    background: '#f5efe0',
    border: '2px solid rgba(92, 61, 26, 0.4)',
    borderRadius: 8,
    padding: '28px 32px',
    maxWidth: 440,
    width: '90%',
    textAlign: 'center',
    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
  },
  title: {
    fontSize: '0.75rem',
    fontWeight: 700,
    letterSpacing: '0.15em',
    textTransform: 'uppercase' as const,
    color: '#3d2812',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: '0.68rem',
    color: '#8b7355',
    marginBottom: 20,
  },
  loadingText: {
    fontSize: '0.8rem',
    color: '#8b7355',
    padding: '20px 0',
  },
  errorText: {
    fontSize: '0.75rem',
    color: '#991B1B',
    padding: '8px 12px',
    background: 'rgba(239, 68, 68, 0.08)',
    borderRadius: 4,
    marginBottom: 8,
  },
  packGrid: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
    marginBottom: 16,
  },
  packCard: {
    flex: '1 1 0',
    padding: '16px 12px',
    background: 'rgba(92, 61, 26, 0.06)',
    border: '2px solid rgba(139, 94, 42, 0.25)',
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 6,
  },
  packCoins: {
    marginBottom: 4,
  },
  packCredits: {
    fontSize: '0.8rem',
    fontWeight: 700,
    color: '#2a1a0a',
  },
  packPrice: {
    fontSize: '1rem',
    fontWeight: 700,
    color: '#5b21b6',
  },
  packBonus: {
    fontSize: '0.58rem',
    fontWeight: 700,
    color: '#16a34a',
    background: 'rgba(22, 163, 74, 0.1)',
    padding: '1px 6px',
    borderRadius: 8,
  },
  note: {
    fontSize: '0.6rem',
    color: '#8b7355',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#8b7355',
    fontSize: '0.72rem',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  successPage: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0a0806',
    color: '#f5efe0',
  },
  successTitle: {
    fontSize: '1.2rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    marginBottom: 12,
  },
  successText: {
    fontSize: '0.85rem',
    color: '#b89b6a',
    marginBottom: 20,
  },
  backLink: {
    color: '#c9a84c',
    fontSize: '0.8rem',
    textDecoration: 'underline',
  },
};
