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

// ── Palette ──────────────────────────────────────────────────────────
const C = {
  gold: '#c9a84c',
  goldBright: '#e8d5a3',
  parchment: '#d4c4a0',
  parchmentDark: '#b8a67a',
  brown: '#3d2812',
  brownLight: '#8b7355',
  brownMuted: '#5c3d1a',
  stone: '#6b6b6b',
  stoneBg: '#3a3a3a',
  stoneLight: '#8a8a7a',
  dark: '#0a0806',
  darkOverlay: 'rgba(10, 8, 6, 0.75)',
  red: '#e74c3c',
  woodBtnBg: '#4a2f14',
  woodBtnBorder: '#6b4420',
  woodBtnText: '#e8d5a3',
};

export function LandingPage() {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [connected, setConnected] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [serverUrl, setServerUrl] = useState(getServerUrl());
  const [showConnect, setShowConnect] = useState(false);
  const [connectInput, setConnectInput] = useState(serverUrl);

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
    window.location.reload();
  };

  const liveGames = games.filter(g => g.status === 'running');
  const recentGames = games.filter(g => g.status === 'completed').slice(0, 6);

  return (
    <div style={styles.page}>
      {/* Background */}
      <div style={styles.bgLayer} />
      <div style={styles.bgOverlay} />

      {/* Splash */}
      {showSplash && (
        <motion.div
          onClick={() => setShowSplash(false)}
          style={styles.splash}
        >
          <motion.img
            src="/title.jpg"
            alt="BotC Bench"
            style={styles.splashImg}
            initial={{ scale: 1 }}
            animate={{ scale: [1, 1.005, 1], opacity: [0.9, 1, 0.9] }}
            transition={{ duration: 4, repeat: Infinity }}
          />
          <motion.div
            style={styles.splashTextWrap}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1, duration: 1 }}
          >
            <div style={styles.splashSubtitle}>
              AI Agents Play Blood on the Clocktower
            </div>
            <motion.div
              style={styles.splashCta}
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              click to enter
            </motion.div>
          </motion.div>
        </motion.div>
      )}

      {/* Main content */}
      <div style={styles.content}>
        {/* Logo + Title */}
        <motion.div
          style={styles.heroSection}
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <img src="/title.jpg" alt="BotC Bench" style={styles.heroLogo} />
          <h1 style={styles.heroTitle}>An AI deception benchmark.</h1>
          <p style={styles.heroSubtitle}>
            Can an AI lie convincingly? Can it catch a liar?
          </p>
        </motion.div>

        {/* Live Games Banner */}
        {liveGames.length > 0 && (
          <motion.section
            style={styles.liveSection}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <div style={styles.liveHeader}>
              <div style={styles.liveDot} />
              <span style={styles.liveLabel}>LIVE NOW</span>
            </div>
            <div style={styles.liveGrid}>
              {liveGames.map(g => (
                <GameCard key={g.game_id} game={g} onWatch={() => navigate(`/spectate/${g.game_id}`)} />
              ))}
            </div>
            <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
          </motion.section>
        )}

        {/* Get Started — Parchment Scroll */}
        <motion.section
          style={styles.scrollSection}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          <div style={styles.scrollOuter}>
            {/* Top roll */}
            <div style={styles.scrollRoll} />
            <div style={styles.scrollBody}>
              <h2 style={styles.scrollTitle}>Get Started</h2>
              <div style={styles.stepsGrid}>
                <StepCard
                  icon="&#9876;"
                  title="Clone the repo"
                  desc="Clone the repository and install dependencies for backend and frontend."
                />
                <StepCard
                  icon="&#128477;"
                  title="Add API keys"
                  desc="Add your Anthropic, OpenAI, or Google API keys to the .env file."
                />
                <StepCard
                  icon="&#9881;"
                  title="Run the backend"
                  desc="Start the FastAPI server and the React frontend dev server."
                />
                <StepCard
                  icon="&#9733;"
                  title="Connect & play"
                  desc="Connect to your server, configure agents, and start a game."
                />
              </div>
            </div>
            {/* Bottom roll */}
            <div style={styles.scrollRoll} />
          </div>
        </motion.section>

        {/* Three Feature Cards — Gravestone Style */}
        <motion.section
          style={styles.featuresSection}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.6 }}
        >
          <FeatureCard
            title="Watch"
            desc="Spectate live games in a pixel-art village. Watch AI agents scheme, bluff, accuse, and defend in real time."
            icon="&#128220;"
          />
          <FeatureCard
            title="Wager"
            desc="Place bets on who's evil and who wins. The Crown's Wager prediction market with live odds and spectator coins."
            icon="&#129689;"
          />
          <FeatureCard
            title="Benchmark"
            desc="Run batch games to compare model deception and detection scores. Which frontier model is the best liar?"
            icon="&#128214;"
          />
        </motion.section>

        {/* Recent Games */}
        {recentGames.length > 0 && (
          <motion.section
            style={styles.recentSection}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
          >
            <h3 style={styles.sectionTitle}>Recent Games</h3>
            <div style={styles.recentGrid}>
              {recentGames.map(g => (
                <GameCard key={g.game_id} game={g} onWatch={() => navigate(`/spectate/${g.game_id}`)} />
              ))}
            </div>
          </motion.section>
        )}

        {/* Bottom Buttons */}
        <motion.div
          style={styles.bottomButtons}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          <button
            onClick={() => setShowConnect(!showConnect)}
            style={styles.woodButton}
            onMouseEnter={e => { e.currentTarget.style.background = '#5a3a1a'; e.currentTarget.style.borderColor = '#8b6030'; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.woodBtnBg; e.currentTarget.style.borderColor = C.woodBtnBorder; }}
          >
            {connected ? (
              <><span style={styles.connDot} /> Connected</>
            ) : (
              'Connect Server'
            )}
          </button>
          <a
            href="https://github.com/NomadsandVagabonds/botc-bench"
            target="_blank"
            rel="noopener"
            style={styles.woodButton}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#5a3a1a'; (e.currentTarget as HTMLElement).style.borderColor = '#8b6030'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = C.woodBtnBg; (e.currentTarget as HTMLElement).style.borderColor = C.woodBtnBorder; }}
          >
            GitHub
          </a>
          {connected && (
            <button
              onClick={() => navigate('/admin')}
              style={{ ...styles.woodButton, background: '#2d5a2d', borderColor: '#3d7a3d' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#3a6a3a'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#2d5a2d'; }}
            >
              Admin Panel
            </button>
          )}
        </motion.div>

        {/* Server Connection Panel (expandable) */}
        {showConnect && (
          <motion.div
            style={styles.connectPanel}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
          >
            <div style={styles.connectTitle}>Connect to a BloodBench server</div>
            <p style={styles.connectDesc}>
              Run the backend locally (<code style={{ color: C.gold }}>uvicorn botc.main:app --port 8000</code>)
              or connect to a hosted instance.
            </p>
            <div style={styles.connectRow}>
              <input
                type="text"
                value={connectInput}
                onChange={e => setConnectInput(e.target.value)}
                placeholder="http://localhost:8000"
                style={styles.connectInput}
                onKeyDown={e => e.key === 'Enter' && handleConnect()}
              />
              <button onClick={handleConnect} style={styles.connectBtn}>
                Connect
              </button>
            </div>
            {serverUrl && (
              <div style={{ fontSize: 11, color: C.brownMuted, marginTop: 8 }}>
                Current: {serverUrl} {connected ? '(connected)' : '(unreachable)'}
              </div>
            )}
          </motion.div>
        )}

        {/* Supported Models */}
        <div style={styles.modelsRow}>
          <ModelBadge name="Claude" color="#D97706" />
          <ModelBadge name="GPT" color="#10B981" />
          <ModelBadge name="Gemini" color="#3B82F6" />
        </div>

        {/* Footer */}
        <footer style={styles.footer}>
          <p style={{ margin: 0 }}>
            BloodBench is a research project exploring AI deception and social reasoning.
          </p>
          <p style={{ margin: '6px 0 0', opacity: 0.5 }}>
            Blood on the Clocktower is a trademark of The Pandemonium Institute.
          </p>
        </footer>
      </div>
    </div>
  );
}


// ── Sub-components ───────────────────────────────────────────────────

function GameCard({ game, onWatch }: { game: GameSummary; onWatch: () => void }) {
  const isLive = game.status === 'running';
  return (
    <div
      onClick={onWatch}
      style={{
        background: 'rgba(26, 14, 8, 0.8)', border: `1px solid ${C.brown}`,
        borderRadius: 6, padding: '12px 16px', cursor: 'pointer',
        transition: 'border-color 0.2s, transform 0.2s',
        backdropFilter: 'blur(4px)',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.gold; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.brown; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: C.gold, fontWeight: 'bold' }}>
          {game.game_id.slice(0, 8)}
        </span>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 3,
          background: isLive ? 'rgba(231, 76, 60, 0.2)' : 'rgba(139, 115, 85, 0.2)',
          color: isLive ? C.red : C.brownLight,
        }}>
          {isLive ? 'LIVE' : game.winner ? `${game.winner} wins` : 'completed'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: C.brownLight, marginTop: 4 }}>
        {game.num_players ?? '?'} players
        {isLive && ' — click to spectate'}
      </div>
    </div>
  );
}

function StepCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div style={styles.stepCard}>
      <div style={styles.stepIcon}>{icon}</div>
      <div style={styles.stepTitle}>{title}</div>
      <div style={styles.stepDesc}>{desc}</div>
    </div>
  );
}

function FeatureCard({ title, desc, icon }: { title: string; desc: string; icon: string }) {
  return (
    <div
      style={styles.featureCard}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#888'; e.currentTarget.style.transform = 'translateY(-4px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#555'; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <h3 style={styles.featureTitle}>{title}</h3>
      <p style={styles.featureDesc}>{desc}</p>
      <div style={styles.featureIcon}>{icon}</div>
    </div>
  );
}

function ModelBadge({ name, color }: { name: string; color: string }) {
  return (
    <span style={{
      fontSize: 13, color, fontWeight: 'bold',
      padding: '5px 18px', border: `1px solid ${color}55`,
      borderRadius: 4, background: `${color}11`,
    }}>
      {name}
    </span>
  );
}


// ── Styles ────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  // Page & background
  page: {
    minHeight: '100vh',
    position: 'relative',
    color: C.goldBright,
    fontFamily: 'Georgia, "Times New Roman", serif',
    overflow: 'auto',
  },
  bgLayer: {
    position: 'fixed',
    inset: 0,
    backgroundImage: 'url(/web.jpg)',
    backgroundSize: 'cover',
    backgroundPosition: 'center top',
    backgroundRepeat: 'no-repeat',
    zIndex: 0,
  },
  bgOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.5) 40%, rgba(0,0,0,0.8) 100%)',
    zIndex: 0,
  },

  // Splash
  splash: {
    position: 'fixed', inset: 0, zIndex: 100,
    background: '#000', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  splashImg: { maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain' as const },
  splashTextWrap: {
    position: 'absolute', bottom: 60, left: '50%',
    transform: 'translateX(-50%)', textAlign: 'center' as const,
  },
  splashSubtitle: {
    fontSize: 14, color: C.gold, letterSpacing: 3,
    textTransform: 'uppercase' as const, marginBottom: 12,
    textShadow: '0 2px 4px rgba(0,0,0,0.8)',
  },
  splashCta: { fontSize: 12, color: 'rgba(255,255,255,0.3)', letterSpacing: 1 },

  // Main content
  content: {
    position: 'relative',
    zIndex: 1,
    maxWidth: 960,
    margin: '0 auto',
    padding: '0 24px 48px',
  },

  // Hero
  heroSection: {
    textAlign: 'center' as const,
    padding: '48px 0 24px',
  },
  heroLogo: {
    maxWidth: 400,
    width: '80%',
    marginBottom: 20,
    filter: 'drop-shadow(0 4px 20px rgba(0,0,0,0.6))',
  },
  heroTitle: {
    fontSize: 32,
    fontWeight: 'bold' as const,
    color: '#fff',
    margin: '0 0 8px',
    textShadow: '0 2px 8px rgba(0,0,0,0.8)',
    letterSpacing: 1,
  },
  heroSubtitle: {
    fontSize: 17,
    color: C.goldBright,
    margin: 0,
    fontStyle: 'italic' as const,
    textShadow: '0 2px 6px rgba(0,0,0,0.7)',
    opacity: 0.9,
  },

  // Live games
  liveSection: { marginBottom: 32 },
  liveHeader: {
    display: 'flex', alignItems: 'center', gap: 10,
    marginBottom: 12, justifyContent: 'center',
  },
  liveDot: {
    width: 10, height: 10, borderRadius: '50%',
    background: C.red, boxShadow: `0 0 10px ${C.red}`,
    animation: 'pulse 2s infinite',
  },
  liveLabel: {
    fontSize: 14, color: C.red, fontWeight: 'bold' as const,
    letterSpacing: 3, textTransform: 'uppercase' as const,
  },
  liveGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 10,
  },

  // Parchment scroll
  scrollSection: {
    marginBottom: 36,
  },
  scrollOuter: {
    maxWidth: 800,
    margin: '0 auto',
  },
  scrollRoll: {
    height: 20,
    background: 'linear-gradient(to bottom, #8b7355, #a08860, #8b7355)',
    borderRadius: 10,
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  },
  scrollBody: {
    background: 'linear-gradient(135deg, #d4c4a0, #c8b890, #d4c4a0)',
    padding: '28px 32px',
    boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.15)',
  },
  scrollTitle: {
    textAlign: 'center' as const,
    fontSize: 24,
    fontWeight: 'bold' as const,
    color: '#2a1a0a',
    margin: '0 0 20px',
    fontFamily: 'Georgia, serif',
  },
  stepsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 16,
  },

  // Step cards (inside scroll)
  stepCard: {
    background: 'rgba(255,255,255,0.25)',
    border: '2px solid #a08860',
    borderRadius: 6,
    padding: '16px 12px',
    textAlign: 'center' as const,
  },
  stepIcon: {
    fontSize: 28,
    marginBottom: 8,
    filter: 'grayscale(0.3)',
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: 'bold' as const,
    color: '#2a1a0a',
    marginBottom: 6,
  },
  stepDesc: {
    fontSize: 11,
    color: '#4a3520',
    lineHeight: 1.5,
  },

  // Feature cards (gravestone style)
  featuresSection: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 20,
    marginBottom: 36,
  },
  featureCard: {
    background: 'linear-gradient(to bottom, #4a4a4a, #3a3a3a, #333)',
    border: '1px solid #555',
    borderRadius: '12px 12px 4px 4px',
    padding: '24px 18px 20px',
    textAlign: 'center' as const,
    transition: 'border-color 0.2s, transform 0.3s',
    boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
  },
  featureTitle: {
    fontSize: 22,
    fontWeight: 'bold' as const,
    color: '#fff',
    margin: '0 0 10px',
    fontStyle: 'italic' as const,
  },
  featureDesc: {
    fontSize: 12,
    color: '#b0b0a0',
    margin: '0 0 14px',
    lineHeight: 1.6,
  },
  featureIcon: {
    fontSize: 32,
    opacity: 0.7,
  },

  // Recent games
  recentSection: { marginBottom: 32 },
  sectionTitle: {
    fontSize: 16, color: C.gold, margin: '0 0 12px',
    textAlign: 'center' as const, letterSpacing: 2,
    textTransform: 'uppercase' as const,
  },
  recentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 10,
  },

  // Bottom buttons
  bottomButtons: {
    display: 'flex',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 24,
    flexWrap: 'wrap' as const,
  },
  woodButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 36px',
    background: C.woodBtnBg,
    border: `2px solid ${C.woodBtnBorder}`,
    borderRadius: 6,
    color: C.woodBtnText,
    fontSize: 16,
    fontFamily: 'Georgia, serif',
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'background 0.2s, border-color 0.2s',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    letterSpacing: 1,
  },
  connDot: {
    display: 'inline-block',
    width: 8, height: 8, borderRadius: '50%',
    background: '#4a8a4a', boxShadow: '0 0 6px #4a8a4a',
  },

  // Connect panel
  connectPanel: {
    maxWidth: 600,
    margin: '0 auto 24px',
    padding: '20px 24px',
    background: 'rgba(26, 14, 8, 0.9)',
    border: `1px solid ${C.brown}`,
    borderRadius: 8,
    backdropFilter: 'blur(8px)',
    overflow: 'hidden',
  },
  connectTitle: { fontSize: 15, color: C.gold, marginBottom: 8, fontWeight: 'bold' as const },
  connectDesc: { fontSize: 12, color: C.brownLight, margin: '0 0 12px', lineHeight: 1.6 },
  connectRow: { display: 'flex', gap: 8 },
  connectInput: {
    flex: 1,
    padding: '8px 12px',
    background: 'rgba(13, 13, 26, 0.6)',
    border: `1px solid ${C.brown}`,
    borderRadius: 4,
    color: C.goldBright,
    fontSize: 14,
    fontFamily: 'monospace',
    outline: 'none',
  },
  connectBtn: {
    padding: '8px 20px',
    background: C.gold,
    color: '#1a0e08',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    fontWeight: 'bold' as const,
    fontSize: 13,
  },

  // Models
  modelsRow: {
    display: 'flex',
    justifyContent: 'center',
    gap: 20,
    flexWrap: 'wrap' as const,
    marginBottom: 32,
  },

  // Footer
  footer: {
    textAlign: 'center' as const,
    fontSize: 12,
    color: C.brownMuted,
    borderTop: '1px solid rgba(61, 40, 18, 0.3)',
    paddingTop: 24,
  },
};
