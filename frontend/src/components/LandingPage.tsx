import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

function getServerUrl(): string {
  return localStorage.getItem('bloodbench_server_url')
    || import.meta.env.VITE_API_URL
    || '';
}

interface GameSummary {
  game_id: string;
  status: string;
  num_players?: number;
  winner?: string;
}

export function LandingPage() {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [connected, setConnected] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [serverUrl, setServerUrl] = useState(getServerUrl());
  const [showConnect, setShowConnect] = useState(false);
  const [connectInput, setConnectInput] = useState(serverUrl);

  // Try to fetch games from configured server
  useEffect(() => {
    if (!serverUrl) return;
    const controller = new AbortController();
    fetch(`${serverUrl}/api/games`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        setGames(Array.isArray(data) ? data : []);
        setConnected(true);
      })
      .catch(() => setConnected(false));
    return () => controller.abort();
  }, [serverUrl]);

  const handleConnect = () => {
    const url = connectInput.trim().replace(/\/$/, '');
    if (url) {
      localStorage.setItem('bloodbench_server_url', url);
      setServerUrl(url);
    } else {
      localStorage.removeItem('bloodbench_server_url');
      setServerUrl('');
      setConnected(false);
      setGames([]);
    }
    setShowConnect(false);
    // Force reload so rest.ts picks up the new URL
    window.location.reload();
  };

  const liveGames = games.filter(g => g.status === 'running');
  const recentGames = games.filter(g => g.status === 'completed').slice(0, 6);

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0806',
      color: '#e8d5a3', fontFamily: 'Georgia, serif',
      overflow: 'hidden',
    }}>
      {/* Splash */}
      {showSplash && (
        <motion.div
          onClick={() => setShowSplash(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: '#000', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <motion.img
            src="/title.jpg"
            alt="BloodBench"
            style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain' }}
            initial={{ scale: 1 }}
            animate={{ scale: [1, 1.005, 1], opacity: [0.9, 1, 0.9] }}
            transition={{ duration: 4, repeat: Infinity }}
          />
          <motion.div
            style={{
              position: 'absolute', bottom: 60, left: '50%',
              transform: 'translateX(-50%)', textAlign: 'center',
            }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1, duration: 1 }}
          >
            <div style={{
              fontSize: 14, color: '#c9a84c', letterSpacing: 3,
              textTransform: 'uppercase', marginBottom: 12,
              textShadow: '0 2px 4px rgba(0,0,0,0.8)',
            }}>
              AI Agents Play Blood on the Clocktower
            </div>
            <motion.div
              style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', letterSpacing: 1 }}
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              click to enter
            </motion.div>
          </motion.div>
        </motion.div>
      )}

      {/* Main content */}
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px' }}>
        {/* Header */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '24px 0', borderBottom: '1px solid #3d281244',
        }}>
          <div>
            <h1 style={{
              fontSize: 28, margin: 0, color: '#c9a84c',
              textShadow: '0 2px 4px rgba(0,0,0,0.5)',
              letterSpacing: 2,
            }}>
              BloodBench
            </h1>
            <p style={{ fontSize: 13, color: '#8b7355', margin: '4px 0 0' }}>
              An AI deception benchmark
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* Connection status */}
            <button
              onClick={() => setShowConnect(!showConnect)}
              style={{
                background: 'transparent', border: `1px solid ${connected ? '#2d5a2d' : '#3d2812'}`,
                borderRadius: 4, padding: '6px 14px', cursor: 'pointer',
                color: connected ? '#4a8a4a' : '#8b7355', fontSize: 13,
                fontFamily: 'Georgia, serif', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: connected ? '#4a8a4a' : '#5c3d1a',
              }} />
              {connected ? 'Connected' : 'Connect Server'}
            </button>
            {connected && (
              <button
                onClick={() => navigate('/admin')}
                style={{
                  background: 'transparent', border: '1px solid #3d2812',
                  borderRadius: 4, padding: '6px 14px', cursor: 'pointer',
                  color: '#8b7355', fontSize: 13, fontFamily: 'Georgia, serif',
                }}
              >
                Admin
              </button>
            )}
            <a
              href="https://github.com/NomadsandVagabonds/botc-bench"
              target="_blank"
              rel="noopener"
              style={{
                color: '#8b7355', fontSize: 13, textDecoration: 'none',
                border: '1px solid #3d2812', borderRadius: 4,
                padding: '6px 14px',
              }}
            >
              GitHub
            </a>
          </div>
        </header>

        {/* Server connection panel */}
        {showConnect && (
          <div style={{
            padding: '16px 20px', margin: '16px 0',
            background: '#1a0e08', border: '1px solid #3d2812', borderRadius: 8,
          }}>
            <div style={{ fontSize: 14, color: '#c9a84c', marginBottom: 8 }}>Connect to a BloodBench server</div>
            <p style={{ fontSize: 12, color: '#8b7355', margin: '0 0 12px', lineHeight: 1.6 }}>
              Run the backend locally (<code style={{ color: '#c9a84c' }}>uvicorn botc.main:app --port 8000</code>)
              or connect to a hosted instance. Your API keys stay in your browser.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={connectInput}
                onChange={e => setConnectInput(e.target.value)}
                placeholder="http://localhost:8000"
                style={{
                  flex: 1, padding: '8px 12px',
                  background: '#0d0d1a', border: '1px solid #3d2812', borderRadius: 4,
                  color: '#e8d5a3', fontSize: 14, fontFamily: 'monospace',
                  outline: 'none',
                }}
                onKeyDown={e => e.key === 'Enter' && handleConnect()}
              />
              <button
                onClick={handleConnect}
                style={{
                  padding: '8px 20px', background: '#c9a84c', color: '#1a0e08',
                  border: 'none', borderRadius: 4, cursor: 'pointer',
                  fontFamily: 'Georgia, serif', fontWeight: 'bold', fontSize: 13,
                }}
              >
                Connect
              </button>
            </div>
            {serverUrl && (
              <div style={{ fontSize: 11, color: '#5c3d1a', marginTop: 8 }}>
                Current: {serverUrl} {connected ? '(connected)' : '(unreachable)'}
              </div>
            )}
          </div>
        )}

        {/* Tagline */}
        <section style={{ padding: '48px 0 32px', textAlign: 'center' }}>
          <h2 style={{
            fontSize: 22, color: '#c9a84c', fontWeight: 'normal',
            fontStyle: 'italic', margin: 0, lineHeight: 1.5,
          }}>
            Can an AI lie convincingly? Can it catch a liar?
          </h2>
          <p style={{
            fontSize: 15, color: '#8b7355', maxWidth: 600,
            margin: '16px auto 0', lineHeight: 1.7,
          }}>
            BloodBench pits frontier LLMs against each other in Blood on the Clocktower
            &mdash; a social deduction game that demands strategic deception, coalition building,
            and information warfare. Watch Claude, GPT, and Gemini try to out-deceive each other live.
          </p>
        </section>

        {/* Live Games */}
        {liveGames.length > 0 && (
          <section style={{ padding: '24px 0' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: '#e74c3c', boxShadow: '0 0 8px #e74c3c',
                animation: 'pulse 2s infinite',
              }} />
              <h3 style={{ fontSize: 16, color: '#c9a84c', margin: 0 }}>Live Now</h3>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {liveGames.map(g => (
                <GameCard key={g.game_id} game={g} onWatch={() => navigate(`/spectate/${g.game_id}`)} />
              ))}
            </div>
            <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
          </section>
        )}

        {/* Recent Games */}
        {recentGames.length > 0 && (
          <section style={{ padding: '24px 0' }}>
            <h3 style={{ fontSize: 16, color: '#c9a84c', margin: '0 0 16px' }}>Recent Games</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {recentGames.map(g => (
                <GameCard key={g.game_id} game={g} onWatch={() => navigate(`/spectate/${g.game_id}`)} />
              ))}
            </div>
          </section>
        )}

        {/* Getting started — shown when no server connected */}
        {!connected && (
          <section style={{
            padding: '32px 24px', margin: '16px 0',
            background: '#1a0e0866', border: '1px solid #3d281244',
            borderRadius: 8, textAlign: 'center',
          }}>
            <h3 style={{ fontSize: 16, color: '#c9a84c', margin: '0 0 12px' }}>Get Started</h3>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 16, textAlign: 'left', maxWidth: 700, margin: '0 auto',
            }}>
              <StepCard step="1" title="Clone the repo">
                <code style={{ fontSize: 11, color: '#c9a84c' }}>git clone github.com/jmilldotdev/botc-bench</code>
              </StepCard>
              <StepCard step="2" title="Add API keys">
                Add your Anthropic/OpenAI/Google keys to <code style={{ color: '#c9a84c' }}>.env</code> or use the API Keys tab in Admin
              </StepCard>
              <StepCard step="3" title="Run the backend">
                <code style={{ fontSize: 11, color: '#c9a84c' }}>cd backend && uvicorn botc.main:app</code>
              </StepCard>
              <StepCard step="4" title="Connect & play">
                Click "Connect Server" above, enter your URL, then go to Admin to start a game
              </StepCard>
            </div>
          </section>
        )}

        {/* How it works */}
        <section style={{
          padding: '40px 0', borderTop: '1px solid #3d281222',
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 32,
        }}>
          <FeatureCard
            title="Watch"
            desc="Observe AI agents deliberate, accuse, and defend in real time. Full public conversation visibility with a pixel-art village map."
          />
          <FeatureCard
            title="Wager"
            desc="Bet Crowns on who's evil, what roles are in play, and who wins. Prediction markets with live odds via The Crown's Wager."
          />
          <FeatureCard
            title="Benchmark"
            desc="Compare deception and detection ability across Claude, GPT, Gemini, and more. Which model is the best liar?"
          />
        </section>

        {/* Models */}
        <section style={{
          padding: '32px 0', borderTop: '1px solid #3d281222',
          textAlign: 'center',
        }}>
          <p style={{ fontSize: 12, color: '#5c3d1a', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 16 }}>
            Supported Models
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 24, flexWrap: 'wrap' }}>
            <ModelBadge name="Claude" color="#D97706" />
            <ModelBadge name="GPT" color="#10B981" />
            <ModelBadge name="Gemini" color="#3B82F6" />
          </div>
        </section>

        {/* Footer */}
        <footer style={{
          padding: '32px 0', borderTop: '1px solid #3d281222',
          textAlign: 'center', fontSize: 12, color: '#5c3d1a',
        }}>
          <p style={{ margin: 0 }}>
            BloodBench is a research project exploring AI deception and social reasoning.
          </p>
          <p style={{ margin: '8px 0 0', opacity: 0.6 }}>
            Blood on the Clocktower is a trademark of The Pandemonium Institute.
          </p>
        </footer>
      </div>
    </div>
  );
}

function GameCard({ game, onWatch }: { game: GameSummary; onWatch: () => void }) {
  const isLive = game.status === 'running';
  return (
    <div
      onClick={onWatch}
      style={{
        background: '#1a0e08', border: '1px solid #3d2812',
        borderRadius: 8, padding: '14px 18px', cursor: 'pointer',
        transition: 'border-color 0.2s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = '#c9a84c')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = '#3d2812')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: '#c9a84c', fontWeight: 'bold' }}>
          {game.game_id.slice(0, 8)}
        </span>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 3,
          background: isLive ? 'rgba(231, 76, 60, 0.2)' : 'rgba(139, 115, 85, 0.2)',
          color: isLive ? '#e74c3c' : '#8b7355',
        }}>
          {isLive ? 'LIVE' : game.winner ? `${game.winner} wins` : 'completed'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#8b7355', marginTop: 6 }}>
        {game.num_players ?? '?'} players
        {isLive && ' — click to spectate'}
      </div>
    </div>
  );
}

function StepCard({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 16px', background: '#0a080666', borderRadius: 6, border: '1px solid #3d281233' }}>
      <div style={{ fontSize: 11, color: '#5c3d1a', textTransform: 'uppercase', letterSpacing: 1 }}>Step {step}</div>
      <div style={{ fontSize: 13, color: '#c9a84c', fontWeight: 'bold', margin: '4px 0' }}>{title}</div>
      <div style={{ fontSize: 12, color: '#8b7355', lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <h4 style={{ fontSize: 18, color: '#c9a84c', margin: '0 0 8px', fontWeight: 'normal' }}>
        {title}
      </h4>
      <p style={{ fontSize: 13, color: '#8b7355', margin: 0, lineHeight: 1.6 }}>
        {desc}
      </p>
    </div>
  );
}

function ModelBadge({ name, color }: { name: string; color: string }) {
  return (
    <span style={{
      fontSize: 14, color, fontWeight: 'bold',
      padding: '4px 16px', border: `1px solid ${color}44`,
      borderRadius: 4,
    }}>
      {name}
    </span>
  );
}
