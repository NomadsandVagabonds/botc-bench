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

/** Display coin amount — always rounds up to whole number. */
export function CoinDisplay({ amount, size = 20 }: { amount: number; size?: number }) {
  const rounded = Math.ceil(amount);
  if (rounded <= 0) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <CoinIcon size={size} dim />
        <span style={{ fontSize: size * 0.55, color: '#8b7355', fontFamily: PX_FONT }}>0</span>
      </span>
    );
  }
  if (rounded <= 5) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        {Array.from({ length: rounded }, (_, i) => (
          <CoinIcon key={i} size={size} />
        ))}
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <CoinIcon size={size} />
      <span style={{ fontSize: size * 0.6, fontFamily: PX_FONT, fontWeight: 700, color: '#c9a84c' }}>
        x{rounded}
      </span>
    </span>
  );
}

// ── Shared font ─────────────────────────────────────────────────────

const PX_FONT = '"Press Start 2P", monospace';

// ── Credit Balance Display (inline in setup view) ───────────────────

export function CreditBalanceInline({
  balance,
  estimatedCost,
  onBuyCredits,
}: {
  balance: number | null;
  estimatedCost: number | null;
  onBuyCredits: () => void;
}) {
  const rounded = estimatedCost !== null ? Math.ceil(estimatedCost) : null;
  const sufficient = balance !== null && rounded !== null && balance >= rounded;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: '0.6rem', fontFamily: PX_FONT, color: '#c9a84c' }}>
          Balance:
        </span>
        {balance !== null ? (
          <CoinDisplay amount={balance} size={18} />
        ) : (
          <span style={{ fontSize: '0.6rem', fontFamily: PX_FONT, color: '#8b7355' }}>...</span>
        )}
        <button
          onClick={onBuyCredits}
          style={{
            background: 'linear-gradient(180deg, rgba(139, 26, 26, 0.15), rgba(92, 20, 20, 0.25))',
            border: '1px solid rgba(139, 26, 26, 0.4)',
            borderRadius: 2,
            padding: '3px 8px',
            color: '#c9a84c',
            fontFamily: PX_FONT,
            fontSize: '0.45rem',
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
        >
          BUY
        </button>
      </div>

      {rounded !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.55rem', fontFamily: PX_FONT, color: '#6b5840' }}>Cost:</span>
          <CoinDisplay amount={rounded} size={16} />
          {!sufficient && balance !== null && (
            <span style={{ fontSize: '0.45rem', fontFamily: PX_FONT, color: '#991B1B' }}>
              INSUFFICIENT
            </span>
          )}
        </div>
      )}
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
        <div style={styles.title}>Buy Credits</div>
        <div style={styles.subtitle}>1 credit = 1 game dollar. No expiration.</div>

        {loading && <div style={styles.loadingText}>Loading...</div>}
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
                <CoinDisplay amount={pack.credits} size={24} />
              </div>
              <div style={styles.packCredits}>
                {pack.credits.toFixed(0)} credits
              </div>
              <div style={styles.packPrice}>${pack.price_usd.toFixed(0)}</div>
            </button>
          ))}
        </div>

        <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
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
          <div style={styles.successTitle}>Processing...</div>
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
            Balance: {Math.ceil(balance ?? 0)} credits. Redirecting...
          </div>
        </>
      )}
      {status === 'error' && (
        <>
          <div style={styles.successTitle}>Error</div>
          <div style={styles.successText}>
            Payment processed. Credits may take a moment to appear.
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
    background: 'rgba(10, 8, 6, 0.8)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(4px)',
  },
  modal: {
    background: '#141420',
    border: '2px solid #c9a84c',
    borderRadius: 8,
    padding: '32px 36px',
    maxWidth: 460,
    width: '90%',
    textAlign: 'center',
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  },
  title: {
    fontFamily: PX_FONT,
    fontSize: '0.7rem',
    color: '#c9a84c',
    letterSpacing: '0.08em',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: '0.72rem',
    color: '#8b7355',
    marginBottom: 24,
  },
  loadingText: {
    fontFamily: PX_FONT,
    fontSize: '0.5rem',
    color: '#8b7355',
    padding: '20px 0',
  },
  errorText: {
    fontSize: '0.72rem',
    color: '#e74c3c',
    padding: '8px 12px',
    background: 'rgba(231, 76, 60, 0.1)',
    border: '1px solid rgba(231, 76, 60, 0.3)',
    borderRadius: 4,
    marginBottom: 12,
  },
  packGrid: {
    display: 'flex',
    gap: 14,
    justifyContent: 'center',
    marginBottom: 20,
  },
  packCard: {
    flex: '1 1 0',
    padding: '18px 14px',
    background: '#1a1a2e',
    border: '2px solid rgba(201, 168, 76, 0.25)',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 8,
  },
  packCoins: {
    marginBottom: 2,
  },
  packCredits: {
    fontFamily: PX_FONT,
    fontSize: '0.45rem',
    color: '#e8d5a3',
  },
  packPrice: {
    fontFamily: PX_FONT,
    fontSize: '0.65rem',
    fontWeight: 700,
    color: '#c9a84c',
  },
  cancelBtn: {
    background: 'none',
    border: '1px solid rgba(139, 115, 85, 0.3)',
    borderRadius: 4,
    color: '#8b7355',
    fontFamily: PX_FONT,
    fontSize: '0.45rem',
    padding: '6px 16px',
    cursor: 'pointer',
  },
  successPage: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0a0806',
    color: '#e8d5a3',
  },
  successTitle: {
    fontFamily: PX_FONT,
    fontSize: '0.7rem',
    color: '#c9a84c',
    marginBottom: 12,
  },
  successText: {
    fontSize: '0.85rem',
    color: '#8b7355',
    marginBottom: 20,
  },
  backLink: {
    fontFamily: PX_FONT,
    fontSize: '0.5rem',
    color: '#c9a84c',
    textDecoration: 'underline',
  },
};
