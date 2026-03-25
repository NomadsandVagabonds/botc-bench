import { useState, useEffect, useCallback } from 'react';
import { estimateCost, createCheckout, getStripeConfig } from '../api/rest.ts';
import type { CostEstimate, ConfiguredGameRequest } from '../api/rest.ts';

// ── Available models (mirrored from GameLobby for display) ──────────

const MODEL_LABELS: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'claude-sonnet-4-20250514': 'Claude Sonnet 4.6',
  'claude-opus-4-20250514': 'Claude Opus 4.6',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4o': 'GPT-4o',
  'o3-mini': 'o3-mini',
  'o4-mini': 'o4-mini',
  'gpt-4.1': 'GPT-4.1',
  'gpt-4.1-mini': 'GPT-4.1 Mini',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-3-flash-preview': 'Gemini 3 Flash',
  'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
};

function shortModelName(id: string): string {
  return MODEL_LABELS[id] ?? id;
}

// ── Types ───────────────────────────────────────────────────────────

interface PaymentGateProps {
  gameConfig: ConfiguredGameRequest;
  onClose: () => void;
  onUseOwnKeys: () => void;
}

// ── Component ───────────────────────────────────────────────────────

export function PaymentGate({ gameConfig, onClose, onUseOwnKeys }: PaymentGateProps) {
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [allowedModels, setAllowedModels] = useState<Set<string>>(new Set());

  // Check if Stripe is configured + get allowed models
  useEffect(() => {
    getStripeConfig()
      .then((config) => {
        setPaymentsEnabled(config.payments_enabled);
        setAllowedModels(new Set(config.paid_allowed_models ?? []));
      })
      .catch(() => setPaymentsEnabled(false));
  }, []);

  // Check for disallowed models
  const disallowedModels = allowedModels.size > 0
    ? [...new Set(gameConfig.seat_models.map(sm => sm.model))].filter(m => !allowedModels.has(m))
    : [];
  const hasDisallowed = disallowedModels.length > 0;

  // Fetch cost estimate
  useEffect(() => {
    setLoading(true);
    setError(null);
    estimateCost({
      num_players: gameConfig.num_players,
      seat_models: gameConfig.seat_models,
      max_days: gameConfig.max_days,
    })
      .then((est) => {
        setEstimate(est);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to estimate cost');
        setLoading(false);
      });
  }, [gameConfig.num_players, gameConfig.seat_models, gameConfig.max_days]);

  const handleCheckout = useCallback(async () => {
    setCheckingOut(true);
    setError(null);
    try {
      const result = await createCheckout(gameConfig);
      // Redirect to Stripe Checkout
      window.location.href = result.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
      setCheckingOut(false);
    }
  }, [gameConfig]);

  // Summarize models
  const modelCounts: Record<string, number> = {};
  for (const sm of gameConfig.seat_models) {
    modelCounts[sm.model] = (modelCounts[sm.model] || 0) + 1;
  }
  const modelSummary = Object.entries(modelCounts)
    .map(([m, c]) => `${shortModelName(m)} x${c}`)
    .join(', ');

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>ESTIMATED GAME COST</div>

        {loading && (
          <div style={styles.loadingText}>Calculating estimate...</div>
        )}

        {error && !loading && (
          <div style={styles.errorText}>{error}</div>
        )}

        {estimate && !loading && (
          <>
            <div style={styles.configLine}>
              {gameConfig.num_players} players &times; ~{estimate.est_days} days
            </div>
            <div style={styles.modelLine}>{modelSummary}</div>

            <div style={styles.divider} />

            <div style={styles.costRow}>
              <span style={styles.costLabel}>Estimated:</span>
              <span style={styles.costValue}>${estimate.estimated_cost.toFixed(2)}</span>
            </div>
            <div style={styles.costRow}>
              <span style={styles.costLabel}>Charge:</span>
              <span style={{ ...styles.costValue, fontWeight: 700, fontSize: '1.1rem' }}>
                ${estimate.charge_amount.toFixed(2)}
              </span>
            </div>

            <div style={styles.bufferNote}>
              Includes buffer for variance. If the game costs less, the surplus covers server + Stripe fees.
            </div>

            {/* Per-model breakdown */}
            {Object.keys(estimate.breakdown).length > 1 && (
              <div style={styles.breakdown}>
                {Object.entries(estimate.breakdown).map(([model, info]) => (
                  <div key={model} style={styles.breakdownRow}>
                    <span style={styles.breakdownModel}>{shortModelName(model)} x{info.count}</span>
                    <span style={styles.breakdownCost}>${info.total_est.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {hasDisallowed && (
          <div style={styles.disallowedWarning}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Models not available for paid games:</div>
            {disallowedModels.map(m => (
              <div key={m}>{shortModelName(m)}</div>
            ))}
            <div style={{ marginTop: 6, fontStyle: 'italic' }}>
              Switch to allowed models or use your own API keys.
            </div>
          </div>
        )}

        <div style={styles.divider} />

        <div style={styles.buttonRow}>
          <button
            style={{
              ...styles.btn,
              ...styles.btnPrimary,
              opacity: checkingOut || loading || !paymentsEnabled || hasDisallowed ? 0.5 : 1,
            }}
            onClick={() => void handleCheckout()}
            disabled={checkingOut || loading || !paymentsEnabled || hasDisallowed}
          >
            {checkingOut ? 'Redirecting...' : hasDisallowed ? 'Unsupported Models' : !paymentsEnabled ? 'Payments Not Configured' : 'Pay with Stripe'}
          </button>
          <button
            style={{ ...styles.btn, ...styles.btnSecondary }}
            onClick={onUseOwnKeys}
          >
            Use Own API Keys
          </button>
        </div>

        <button style={styles.closeBtn} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ── Payment Success Page ────────────────────────────────────────────

export function PaymentSuccess() {
  const [status, setStatus] = useState<'checking' | 'success' | 'waiting' | 'error'>('checking');
  const [gameId, setGameId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (!sessionId) {
      setStatus('error');
      return;
    }

    let attempts = 0;
    const maxAttempts = 30;

    const poll = setInterval(async () => {
      attempts++;
      try {
        const { getPaymentStatus } = await import('../api/rest.ts');
        const result = await getPaymentStatus(sessionId);
        if (result.game_id) {
          setGameId(result.game_id);
          setStatus('success');
          clearInterval(poll);
        } else if (result.payment_status === 'paid') {
          setStatus('waiting');
        }
      } catch {
        // Keep polling
      }
      if (attempts >= maxAttempts) {
        clearInterval(poll);
        if (!gameId) setStatus('error');
      }
    }, 2000);

    return () => clearInterval(poll);
  }, []);

  if (status === 'success' && gameId) {
    // Auto-redirect to the game
    window.location.href = `/game/${gameId}`;
    return (
      <div style={styles.successPage}>
        <div style={styles.successTitle}>Payment Successful!</div>
        <div style={styles.successText}>Redirecting to your game...</div>
      </div>
    );
  }

  if (status === 'waiting') {
    return (
      <div style={styles.successPage}>
        <div style={styles.successTitle}>Payment Received</div>
        <div style={styles.successText}>Starting your game... this may take a moment.</div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={styles.successPage}>
        <div style={styles.successTitle}>Something went wrong</div>
        <div style={styles.successText}>
          Your payment was processed but we couldn't find the game.
          Please contact support with your Stripe receipt.
        </div>
        <a href="/" style={styles.backLink}>Back to lobby</a>
      </div>
    );
  }

  return (
    <div style={styles.successPage}>
      <div style={styles.successTitle}>Verifying payment...</div>
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
    maxWidth: 400,
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
    marginBottom: 16,
  },
  loadingText: {
    fontSize: '0.8rem',
    color: '#8b7355',
    padding: '20px 0',
  },
  errorText: {
    fontSize: '0.8rem',
    color: '#991B1B',
    padding: '12px',
    background: 'rgba(239, 68, 68, 0.08)',
    borderRadius: 4,
    marginBottom: 8,
  },
  configLine: {
    fontSize: '0.85rem',
    color: '#2a1a0a',
    marginBottom: 4,
  },
  modelLine: {
    fontSize: '0.72rem',
    color: '#5a4630',
    marginBottom: 12,
  },
  divider: {
    height: 1,
    background: 'rgba(92, 61, 26, 0.15)',
    margin: '12px 0',
  },
  costRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
  },
  costLabel: {
    fontSize: '0.8rem',
    color: '#5a4630',
  },
  costValue: {
    fontSize: '0.95rem',
    color: '#2a1a0a',
    fontFamily: 'monospace',
  },
  bufferNote: {
    fontSize: '0.65rem',
    color: '#8b7355',
    lineHeight: 1.5,
    marginTop: 8,
    fontStyle: 'italic',
  },
  breakdown: {
    marginTop: 8,
    padding: '8px 12px',
    background: 'rgba(92, 61, 26, 0.04)',
    borderRadius: 4,
  },
  breakdownRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '2px 0',
  },
  breakdownModel: {
    fontSize: '0.68rem',
    color: '#5a4630',
  },
  breakdownCost: {
    fontSize: '0.68rem',
    color: '#2a1a0a',
    fontFamily: 'monospace',
  },
  disallowedWarning: {
    fontSize: '0.72rem',
    color: '#991B1B',
    background: 'rgba(239, 68, 68, 0.08)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    borderRadius: 4,
    padding: '10px 14px',
    marginTop: 8,
    textAlign: 'left' as const,
    lineHeight: 1.5,
  },
  buttonRow: {
    display: 'flex',
    gap: 10,
    justifyContent: 'center',
    marginTop: 4,
  },
  btn: {
    padding: '10px 20px',
    borderRadius: 4,
    fontSize: '0.8rem',
    fontWeight: 700,
    cursor: 'pointer',
    border: 'none',
    letterSpacing: '0.04em',
  },
  btnPrimary: {
    background: '#5b21b6',
    color: '#fff',
  },
  btnSecondary: {
    background: 'rgba(92, 61, 26, 0.12)',
    color: '#3d2812',
    border: '1px solid rgba(92, 61, 26, 0.3)',
  },
  closeBtn: {
    marginTop: 12,
    background: 'none',
    border: 'none',
    color: '#8b7355',
    fontSize: '0.72rem',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  // Payment success page styles
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
