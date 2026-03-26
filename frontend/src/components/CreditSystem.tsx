import { useState, useEffect, useCallback } from 'react';
import { getCreditBalance, getCreditPacks, purchaseCredits, purchaseExactCredits } from '../api/rest.ts';
import type { CreditPack } from '../api/rest.ts';

// ── Design tokens (matching landing page) ───────────────────────────

const PX = '"Press Start 2P", monospace';
const SERIF = 'Georgia, "Palatino Linotype", serif';
const GOLD = '#c9a84c';
const GOLD_BRIGHT = '#e8d5a3';
const GOLD_DIM = '#8b7355';
const DARK = '#0a0806';
const DARK_CARD = '#141420';
const DARK_ELEVATED = '#1a1a2e';
const CRIMSON = '#8b1a1a';

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
        filter: dim ? 'grayscale(0.6)' : 'none',
      }}
    />
  );
}

/** Display coin amount — always rounds up to whole number. */
export function CoinDisplay({ amount, size = 22 }: { amount: number; size?: number }) {
  const rounded = Math.ceil(amount);
  if (rounded <= 0) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <CoinIcon size={size} dim />
        <span style={{ fontSize: Math.max(11, size * 0.5), color: GOLD_DIM, fontFamily: PX }}>0</span>
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
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <CoinIcon size={size} />
      <span style={{ fontSize: Math.max(12, size * 0.55), fontFamily: PX, color: '#3d2812' }}>
        x{rounded}
      </span>
    </span>
  );
}

// ── Credit Balance Display (inline in setup view — on parchment bg) ─

export function CreditBalanceInline({
  balance,
  estimatedCost,
  onBuyCredits,
}: {
  balance: number | null;
  estimatedCost: number | null;
  onBuyCredits: () => void;
}) {
  const cost = estimatedCost !== null ? Math.ceil(estimatedCost) : null;
  const sufficient = balance !== null && cost !== null && balance >= cost;

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Balance row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 9, fontFamily: PX, color: '#3d2812' }}>
          Balance
        </span>
        {balance !== null ? (
          <CoinDisplay amount={balance} size={20} />
        ) : (
          <span style={{ fontSize: 12, fontFamily: SERIF, color: '#5a4630' }}>loading...</span>
        )}
        <button
          onClick={onBuyCredits}
          style={{
            background: CRIMSON,
            border: 'none',
            borderRadius: 2,
            padding: '5px 12px',
            color: '#e8d5a3',
            fontFamily: PX,
            fontSize: 8,
            cursor: 'pointer',
            boxShadow: `0 0 0 2px ${CRIMSON}, 0 0 0 3px rgba(10,8,6,0.2)`,
            letterSpacing: '0.5px',
          }}
        >
          BUY
        </button>
      </div>

      {/* Cost row */}
      {cost !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, fontFamily: PX, color: '#5a4630' }}>This game</span>
          <CoinDisplay amount={cost} size={18} />
          {!sufficient && balance !== null && (
            <span style={{ fontSize: 8, fontFamily: PX, color: '#991B1B' }}>
              NEED MORE
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Credit Purchase Modal ───────────────────────────────────────────

// Fallback packs if API hasn't deployed yet
const FALLBACK_PACKS: CreditPack[] = [
  { id: 'pack_5', credits: 5, price_usd: 5, label: '$5 — 5 credits' },
  { id: 'pack_10', credits: 10, price_usd: 10, label: '$10 — 10 credits' },
  { id: 'pack_20', credits: 20, price_usd: 20, label: '$20 — 20 credits' },
];

export function CreditPurchaseModal({ onClose, gameAmount }: { onClose: () => void; gameAmount?: number }) {
  const [packs, setPacks] = useState<CreditPack[]>(FALLBACK_PACKS);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCreditPacks()
      .then((data) => {
        const fetched = data.packs ?? data as any;
        if (fetched.length > 0) setPacks(fetched);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false); // Use fallback packs
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
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        {/* Title */}
        <h2 style={st.modalTitle}>Buy Credits</h2>
        <p style={st.modalSub}>1 credit ≈ 1 game. No expiration.</p>

        {/* Divider */}
        <div style={st.divider} />

        {error && <div style={st.errorText}>{error}</div>}

        {/* Pay exact amount for this game */}
        {gameAmount != null && gameAmount > 0 && (
          <>
            <button
              style={{
                ...st.packCard,
                width: '100%',
                flexDirection: 'row' as const,
                justifyContent: 'center',
                gap: 12,
                padding: '14px 20px',
                border: `2px solid ${GOLD}`,
                marginBottom: 8,
                opacity: purchasing ? 0.4 : 1,
              }}
              onClick={async () => {
                setPurchasing('exact');
                setError(null);
                try {
                  const result = await purchaseExactCredits(Math.ceil(gameAmount));
                  window.location.href = result.url;
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Purchase failed');
                  setPurchasing(null);
                }
              }}
              disabled={!!purchasing}
            >
              <CoinDisplay amount={gameAmount} size={22} />
              <span style={{ fontFamily: PX, fontSize: 11, color: GOLD_BRIGHT }}>
                Pay ${Math.ceil(gameAmount)} for this game
              </span>
            </button>
            <p style={{ fontFamily: SERIF, fontSize: 12, color: GOLD_DIM, margin: '0 0 16px', fontStyle: 'italic' }}>
              Or buy a credit pack:
            </p>
          </>
        )}

        {/* Pack cards */}
        <div style={st.packGrid}>
          {packs.map((pack) => (
            <button
              key={pack.id}
              style={{
                ...st.packCard,
                opacity: purchasing && purchasing !== pack.id ? 0.35 : 1,
              }}
              onClick={() => void handlePurchase(pack.id)}
              disabled={!!purchasing || loading}
            >
              <div style={st.packCoinArea}>
                <CoinDisplay amount={pack.credits} size={28} />
              </div>
              <div style={st.packAmount}>{pack.credits.toFixed(0)}</div>
              <div style={st.packLabel}>credits</div>
              <div style={st.packDivider} />
              <div style={st.packPrice}>${pack.price_usd.toFixed(0)}</div>
            </button>
          ))}
        </div>

        {/* Cancel */}
        <button style={st.cancelBtn} onClick={onClose}>
          Cancel
        </button>
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
          setTimeout(() => { window.location.href = '/lobby'; }, 2500);
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
    <div style={st.successPage}>
      {status === 'checking' && (
        <>
          <div style={st.successTitle}>Processing purchase...</div>
          <div style={st.successSub}>Adding credits to your account.</div>
        </>
      )}
      {status === 'success' && (
        <>
          <div style={{ marginBottom: 20 }}>
            <CoinDisplay amount={balance ?? 0} size={40} />
          </div>
          <div style={st.successTitle}>Credits Added</div>
          <div style={st.successSub}>
            Balance: {Math.ceil(balance ?? 0)} credits. Redirecting to lobby...
          </div>
        </>
      )}
      {status === 'error' && (
        <>
          <div style={st.successTitle}>Something went wrong</div>
          <div style={st.successSub}>
            Payment processed. Credits may take a moment to appear.
          </div>
          <a href="/lobby" style={{ fontFamily: PX, fontSize: 11, color: GOLD, marginTop: 16 }}>
            Back to Lobby
          </a>
        </>
      )}
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const st: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(10, 8, 6, 0.85)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(6px)',
  },
  modal: {
    background: DARK_CARD,
    border: `2px solid ${GOLD}`,
    borderRadius: 4,
    padding: '36px 40px 28px',
    maxWidth: 500,
    width: '92%',
    textAlign: 'center',
    boxShadow: `0 0 40px rgba(201, 168, 76, 0.08), 0 24px 60px rgba(0,0,0,0.7)`,
  },
  modalTitle: {
    fontFamily: PX,
    fontSize: 14,
    color: GOLD_BRIGHT,
    letterSpacing: '1px',
    margin: '0 0 8px',
    fontWeight: 400,
  },
  modalSub: {
    fontFamily: SERIF,
    fontSize: 14,
    color: GOLD_DIM,
    margin: '0 0 0',
    fontStyle: 'italic',
  },
  divider: {
    height: 1,
    background: `linear-gradient(to right, transparent, ${GOLD_DIM}, transparent)`,
    margin: '20px 0',
    opacity: 0.4,
  },
  errorText: {
    fontFamily: SERIF,
    fontSize: 13,
    color: '#e74c3c',
    padding: '10px 14px',
    background: 'rgba(231, 76, 60, 0.1)',
    border: '1px solid rgba(231, 76, 60, 0.3)',
    borderRadius: 4,
    marginBottom: 16,
  },
  packGrid: {
    display: 'flex',
    gap: 16,
    justifyContent: 'center',
    marginBottom: 24,
  },
  packCard: {
    flex: '1 1 0',
    padding: '20px 16px 16px',
    background: DARK_ELEVATED,
    border: `1px solid rgba(201, 168, 76, 0.2)`,
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'border-color 0.2s, transform 0.15s, box-shadow 0.2s',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 4,
  },
  packCoinArea: {
    marginBottom: 6,
    minHeight: 32,
    display: 'flex',
    alignItems: 'center',
  },
  packAmount: {
    fontFamily: PX,
    fontSize: 16,
    color: GOLD_BRIGHT,
    lineHeight: 1,
  },
  packLabel: {
    fontFamily: SERIF,
    fontSize: 12,
    color: GOLD_DIM,
    fontStyle: 'italic',
  },
  packDivider: {
    width: '60%',
    height: 1,
    background: `rgba(201, 168, 76, 0.15)`,
    margin: '6px 0',
  },
  packPrice: {
    fontFamily: PX,
    fontSize: 13,
    color: GOLD,
  },
  cancelBtn: {
    background: 'transparent',
    border: `1px solid ${GOLD_DIM}`,
    borderRadius: 2,
    color: GOLD_DIM,
    fontFamily: PX,
    fontSize: 10,
    padding: '8px 24px',
    cursor: 'pointer',
    letterSpacing: '0.5px',
    transition: 'color 0.15s, border-color 0.15s',
  },
  // ── Success page ──
  successPage: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    background: DARK,
    color: GOLD_BRIGHT,
  },
  successTitle: {
    fontFamily: PX,
    fontSize: 14,
    color: GOLD,
    marginBottom: 12,
    letterSpacing: '1px',
  },
  successSub: {
    fontFamily: SERIF,
    fontSize: 16,
    color: GOLD_DIM,
    marginBottom: 20,
  },
};
