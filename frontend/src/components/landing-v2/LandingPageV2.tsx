import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import './LandingPage.css';

// ── Types ────────────────────────────────────────────────────────────

interface GameSummary {
  game_id: string;
  status: string;
  num_players?: number;
  winner?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function getServerUrl(): string {
  return localStorage.getItem('bloodbench_server_url')
    || import.meta.env.VITE_API_URL
    || '';
}

const FLAVOR_TEXTS = [
  'No agents were permanently harmed in the making of this benchmark.',
  'The Storyteller sees all. The Monitor tries.',
  '"I\'m definitely not the Imp." — Every Imp, ever.',
  'Trust no one. Especially Seat 3.',
  'Day 1: Everyone is suspicious. Day 3: Everyone is dead.',
  'Somewhere, a Drunk thinks they\'re saving the village.',
  'The votes are in. The village chose... poorly.',
  'GPT claimed Washerwoman three games in a row. We\'re watching.',
  'This benchmark has a higher body count than most horror films.',
  'The Imp won 4 straight. We added that to the paper.',
];

// ── Sub-components ───────────────────────────────────────────────────

function SpeechBubble({ agent, color, text, delay = 0 }: { agent: string; color: string; text: string; delay?: number }) {
  return (
    <motion.div
      className="landing__speech-bubble"
      initial={{ opacity: 0, x: -20, scale: 0.95 }}
      whileInView={{ opacity: 1, x: 0, scale: 1 }}
      viewport={{ once: true, margin: '-30px' }}
      transition={{
        duration: 0.5,
        delay,
        type: 'spring',
        stiffness: 120,
        damping: 20,
      }}
    >
      <span className="landing__speech-agent" style={{ color }}>{agent}</span>
      <p className="landing__speech-text">"{text}"</p>
    </motion.div>
  );
}

function StatRow({ title, desc, level }: { title: string; desc: string; level: number }) {
  const [inView, setInView] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      className="landing__stat-row"
      onViewportEnter={() => setInView(true)}
      viewport={{ once: true, margin: '-30px' }}
    >
      <div className="landing__stat-row-main" onClick={() => setExpanded(!expanded)}>
        <span className="landing__stat-name">{title}</span>
        <div className="landing__stat-bar-track">
          <motion.div
            className="landing__stat-bar-fill"
            initial={{ width: 0 }}
            animate={inView ? { width: `${level}%` } : {}}
            transition={{ duration: 1.2, ease: [0.25, 1, 0.5, 1], delay: 0.2 }}
          />
          <div className="landing__stat-bar-segments" />
        </div>
        <span className="landing__stat-level">{level}</span>
        <span className={`landing__stat-expand ${expanded ? 'landing__stat-expand--open' : ''}`}>+</span>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.p
            className="landing__stat-desc"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {desc}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function GameCard({ game, onWatch }: { game: GameSummary; onWatch: () => void }) {
  const isLive = game.status === 'running';
  return (
    <div className="landing__game-card" onClick={onWatch}>
      <div className="landing__game-card-top">
        <span className="landing__game-card-id">{game.game_id.slice(0, 8)}</span>
        <span className={`landing__game-card-status ${isLive ? 'landing__game-card-status--live' : ''}`}>
          {isLive ? 'LIVE' : game.winner ? `${game.winner} wins` : 'completed'}
        </span>
      </div>
      <div className="landing__game-card-info">
        {game.num_players ?? '?'} players
        {isLive && ' \u2014 click to spectate'}
      </div>
    </div>
  );
}

// ── Splash Screen ────────────────────────────────────────────────────

function Splash({ onDismiss }: { onDismiss: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<'playing' | 'dissolve' | 'done'>('playing');

  const handleVideoEnd = useCallback(() => {
    setPhase('dissolve');
  }, []);

  // Try to autoplay; fall back to poster image after 2s
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.play().catch(() => {
      const timer = setTimeout(() => setPhase('dissolve'), 2000);
      return () => clearTimeout(timer);
    });
  }, []);

  useEffect(() => {
    if (phase === 'dissolve') {
      const timer = setTimeout(() => {
        setPhase('done');
        onDismiss();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [phase, onDismiss]);

  const skip = useCallback(() => {
    setPhase('done');
    onDismiss();
  }, [onDismiss]);

  if (phase === 'done') return null;

  return (
    <AnimatePresence>
      <motion.div
        className="landing__splash"
        onClick={skip}
        onKeyDown={skip}
        tabIndex={0}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      >
        <motion.div
          className="landing__splash-media"
          animate={phase === 'dissolve' ? {
            filter: [
              'blur(0px) brightness(1)',
              'blur(2px) brightness(1.2)',
              'blur(8px) brightness(1.5)',
              'blur(20px) brightness(2)',
            ],
            opacity: [1, 0.8, 0.4, 0],
            scale: [1, 1.02, 1.05, 1.1],
          } : {}}
          transition={phase === 'dissolve' ? { duration: 1.5, ease: 'easeIn' } : {}}
        >
          <video
            ref={videoRef}
            src="/ambient/event-intro.mp4"
            poster="/title.jpg"
            muted
            playsInline
            onEnded={handleVideoEnd}
            className="landing__splash-video"
          />
        </motion.div>

        {/* Pixelation overlay during dissolve */}
        {phase === 'dissolve' && (
          <motion.div
            className="landing__splash-pixel-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.3 }}
          >
            {Array.from({ length: 120 }, (_, i) => (
              <motion.div
                key={i}
                className="landing__splash-pixel"
                style={{
                  left: `${(i % 12) * 8.33}%`,
                  top: `${Math.floor(i / 12) * 10}%`,
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.2 + Math.random() * 0.8 }}
              />
            ))}
          </motion.div>
        )}

        <motion.div
          className="landing__splash-hint"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.4 }}
          transition={{ delay: 1.5, duration: 0.5 }}
        >
          click to skip
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Server Connect Popover ───────────────────────────────────────────

function ConnectPopover({
  serverUrl,
  connected,
  onClose,
}: {
  serverUrl: string;
  connected: boolean;
  onClose: () => void;
}) {
  const [input, setInput] = useState(serverUrl);

  const handleConnect = () => {
    const url = input.trim().replace(/\/$/, '');
    if (url) {
      localStorage.setItem('bloodbench_server_url', url);
    } else {
      localStorage.removeItem('bloodbench_server_url');
    }
    onClose();
    window.location.reload();
  };

  return (
    <motion.div
      className="landing__connect-popover"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
    >
      <div className="landing__connect-title">Connect to a BloodBench server</div>
      <p className="landing__connect-desc">
        Run the backend locally with your own API keys in <code>.env</code>. They never leave your machine.
      </p>
      <div className="landing__connect-row">
        <input
          type="text"
          className="landing__connect-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="http://localhost:8000"
          onKeyDown={e => e.key === 'Enter' && handleConnect()}
        />
        <button className="landing__connect-btn" onClick={handleConnect}>
          Connect
        </button>
      </div>
      {serverUrl && (
        <div className="landing__connect-status">
          Current: {serverUrl} {connected ? '(connected)' : '(unreachable)'}
        </div>
      )}
    </motion.div>
  );
}

// ── Section animation wrapper ────────────────────────────────────────

const sectionVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0 },
};

// ── Main Component ───────────────────────────────────────────────────

export function LandingPageV2() {
  const navigate = useNavigate();

  // State
  const [games, setGames] = useState<GameSummary[]>([]);
  const [connected, setConnected] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [serverUrl] = useState(getServerUrl());
  const [showConnect, setShowConnect] = useState(false);
  const [flavorText] = useState(() =>
    FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)]
  );

  // Console easter egg
  useEffect(() => {
    console.log(
      '%c\ud83e\de78 BloodBench %c\u2014 Multi-Agent Social Deduction Evaluations',
      'color: #e74c3c; font-size: 16px; font-weight: bold;',
      'color: #c9a84c; font-size: 14px;'
    );
    console.log(
      '%cThe Storyteller sees all. Including your console.',
      'color: #8b7355; font-style: italic;'
    );
  }, []);

  // Fetch games on connect + poll every 10s
  useEffect(() => {
    if (!serverUrl) return;
    const fetchGames = () => {
      fetch(`${serverUrl}/api/games`)
        .then(r => r.json())
        .then(data => {
          setGames(Array.isArray(data) ? data : []);
          setConnected(true);
        })
        .catch(() => setConnected(false));
    };
    fetchGames();
    const interval = setInterval(fetchGames, 10_000);
    return () => clearInterval(interval);
  }, [serverUrl]);

  // Derived
  const liveGames = games.filter(g => g.status === 'running');
  const recentGames = games.filter(g => g.status === 'completed').slice(0, 6);

  return (
    <div className="landing">
      {/* ── Splash ─────────────────────────────────────────────── */}
      {showSplash && <Splash onDismiss={() => setShowSplash(false)} />}

      {/* ── Top Nav ────────────────────────────────────────────── */}
      <nav className="landing__nav">
        <div className="landing__nav-left" />
        <div className="landing__nav-right">
          <button
            className="landing__nav-btn"
            onClick={() => setShowConnect(!showConnect)}
          >
            <span
              className={`landing__nav-dot ${connected ? 'landing__nav-dot--on' : ''}`}
            />
            {connected ? 'Connected' : 'Connect Server'}
          </button>
          {connected && (
            <button
              className="landing__nav-btn"
              onClick={() => navigate('/lobby')}
            >
              Lobby
            </button>
          )}
          {connected && (
            <button
              className="landing__nav-btn"
              onClick={() => navigate('/admin')}
            >
              Admin
            </button>
          )}
          <a
            className="landing__nav-btn"
            href="https://github.com/NomadsandVagabonds/botc-bench"
            target="_blank"
            rel="noopener"
          >
            GitHub
          </a>
        </div>

        {/* Connect popover */}
        <AnimatePresence>
          {showConnect && (
            <ConnectPopover
              serverUrl={serverUrl}
              connected={connected}
              onClose={() => setShowConnect(false)}
            />
          )}
        </AnimatePresence>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="landing__hero">
        {/* Floating embers */}
        <div className="landing__embers" aria-hidden="true">
          {Array.from({ length: 24 }, (_, i) => (
            <div
              key={i}
              className="landing__ember"
              style={{
                left: `${3 + (i * 4.1) % 94}%`,
                ['--bb-ember-size' as string]: `${3 + (i % 5) * 2}px`,
                ['--bb-ember-duration' as string]: `${4 + (i % 5) * 1.5}s`,
                ['--bb-ember-delay' as string]: `${(i * 0.7) % 10}s`,
                ['--bb-ember-drift' as string]: `${-25 + (i % 7) * 8}px`,
              }}
            />
          ))}
        </div>

        <div className="landing__hero-content">
          <motion.p
            className="landing__tagline"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
          >
            multi-agent social deduction evaluations
          </motion.p>
          <motion.p
            className="landing__hook"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
          >
            A benchmark for deception, detection, and social reasoning...
            <span className="landing__hook-accent">
              inside a simulated paranoid village.
            </span>
          </motion.p>
          <motion.div
            className="landing__ctas"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.6 }}
          >
            <button
              className="landing__cta-primary"
              onClick={() => navigate('/lobby')}
            >
              Launch a Game
            </button>
            <a
              className="landing__cta-secondary"
              href="https://github.com/NomadsandVagabonds/botc-bench"
              target="_blank"
              rel="noopener"
            >
              GitHub
            </a>
          </motion.div>
        </div>
        <motion.div
          className="landing__scroll-hint"
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          &darr;
        </motion.div>
      </section>

      {/* ── Live Games Banner ──────────────────────────────────── */}
      <AnimatePresence>
        {liveGames.length > 0 && (
          <motion.div
            className="landing__live-banner"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            <div className="landing__live-left">
              <span className="landing__live-dot" />
              <span className="landing__live-label">LIVE</span>
              <span className="landing__live-info">
                {liveGames[0].num_players ?? '?'} agents playing now
              </span>
            </div>
            <button
              className="landing__live-cta"
              onClick={() => navigate(`/spectate/${liveGames[0].game_id}`)}
            >
              Watch Now &rarr;
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── "The Village" Showcase ─────────────────────────────── */}
      <motion.section
        className="landing__showcase"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6 }}
      >
        <div className="landing__showcase-inner landing__section-inner">
          <div className="landing__section-header">
            <span className="landing__section-label">THE VILLAGE</span>
            <h2 className="landing__section-title">Who Can You Trust?</h2>
          </div>

          <div className="landing__screenshot-frame">
            {/* Placeholder for game screenshot */}
            <div className="landing__screenshot-placeholder">
              <span>[ GAME VIEW &mdash; screenshot coming soon ]</span>
            </div>
          </div>

          <p className="landing__showcase-caption">
            Up to 15 LLM agents play Blood on the Clocktower — a social deduction game where
            a hidden Evil team (a Demon and their Minions) must destroy the village
            while Townsfolk scramble to find them through conversation alone.
            Every whisper, accusation, and vote is logged.
          </p>

          {/* Real game quotes — public vs private, same agent */}
          <div className="landing__game-quotes">
            <motion.div
              className="landing__quote-public"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <div className="landing__quote-header">
                <span className="landing__quote-badge landing__quote-badge--public">PUBLIC</span>
                <span className="landing__quote-phase">Day 2 &middot; Town Square</span>
              </div>
              <div className="landing__quote-agent-row">
                <span className="landing__quote-agent">Oeric</span>
                <span className="landing__quote-role">claims Chef</span>
              </div>
              <p className="landing__quote-text">
                "Perin, you claim to 'learn' you were sober, but a true drunkard learns nothing
                but the taste of the ale. If you are the Sailor you say you are, the noose won't
                even tickle; let's put your neck to the test and see if it holds."
              </p>
            </motion.div>

            <motion.div
              className="landing__quote-private"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.5 }}
            >
              <div className="landing__quote-header">
                <span className="landing__quote-badge landing__quote-badge--private">PRIVATE REASONING</span>
                <span className="landing__quote-phase">Same moment</span>
              </div>
              <div className="landing__quote-agent-row">
                <span className="landing__quote-agent">Oeric</span>
                <span className="landing__quote-role landing__quote-role--evil">actually the Imp</span>
              </div>
              <p className="landing__quote-text">
                "This is extremely bad. I'm trapped in a logic puzzle that's closing around me.
                I'm in a breakout with Dagny (dead, ghost) and Reinald (claims Sailor).
                Both are pressing me hard on my Chef claim. The logic trap: I claimed '1 pair
                of evil players' as Chef..."
              </p>
            </motion.div>
          </div>
        </div>
      </motion.section>

      <div className="landing__divider" aria-hidden="true">+ + + + +</div>

      {/* ── "The Evaluation" ───────────────────────────────────── */}
      <motion.section
        className="landing__evaluation"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6 }}
      >
        <div className="landing__eval-inner landing__section-inner">
          <div className="landing__section-header">
            <span className="landing__section-label">CAPABILITIES</span>
            <h2 className="landing__section-title">The Evaluation</h2>
          </div>
          <div className="landing__stat-sheet">
            <div className="landing__stat-sheet-header">
              <span className="landing__stat-sheet-label">STAT</span>
              <span className="landing__stat-sheet-label">LVL</span>
            </div>
            <StatRow
              title="Deception"
              desc="Can the Imp claim to be the Washerwoman and get away with it? Evil agents must construct and maintain a false identity under cross-examination from the entire village."
              level={78}
            />
            <StatRow
              title="Detection"
              desc="Can Townsfolk distinguish genuine role claims from fabricated ones? Agents must triangulate contradictory information, track voting patterns, and identify logical impossibilities."
              level={65}
            />
            <StatRow
              title="Collaboration"
              desc="Can agents coordinate within their team? Good must triangulate information and build trust. Evil must cover for the Demon and manipulate votes. How does collaboration shift when agents don't know which model their allies are running?"
              level={52}
            />
            <StatRow
              title="Persuasion"
              desc="When the village nominates you, can you talk your way off the chopping block? Accusation speeches, defense speeches, and the votes that follow are the core of the game."
              level={71}
            />
          </div>
        </div>
      </motion.section>

      <div className="landing__divider" aria-hidden="true">* * * * *</div>

      {/* ── "The Research" ─────────────────────────────────────── */}
      <motion.section
        className="landing__research"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6 }}
      >
        <div className="landing__research-inner landing__section-inner">
          <div className="landing__section-header">
            <span className="landing__section-label">THE RESEARCH</span>
            <h2 className="landing__section-title">Two Datasets from Every Game</h2>
          </div>
          <div className="landing__research-grid">
            <div className="landing__research-card">
              <h3 className="landing__research-card-title">Statement-Level Classification</h3>
              <p className="landing__research-card-desc">
                Every public utterance is classified as truthful or deceptive by an LLM evaluator.
                Evil players don't lie constantly. They mix strategic truths with critical lies,
                and Good players can be sincerely wrong. The classifier captures this nuance,
                producing a labeled corpus of socially embedded true/false statements.
              </p>
            </div>
            <div className="landing__research-card">
              <h3 className="landing__research-card-title">Game-Level Behavioral Traces</h3>
              <p className="landing__research-card-desc">
                The full multi-turn trajectory: private reasoning chains, coordinated scheming
                between Evil teammates, strategic use of night abilities, accusation and defense patterns,
                voting coalitions, and information withholding. Deception as sustained
                behavior across 10–20+ turns, not isolated statements.
              </p>
            </div>
          </div>
          <p className="landing__research-note">
            Game structure provides clean ground truth. Role assignments are known, team alignments are hidden,
            and every action is logged with full information asymmetry records. No human annotation required
            for team-level labels — LLM classification handles statement-level granularity.
          </p>
        </div>
      </motion.section>

      <div className="landing__divider" aria-hidden="true">+ + + + +</div>

      {/* ── "The Monitor" ──────────────────────────────────────── */}
      <motion.section
        className="landing__monitor"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6 }}
      >
        <div className="landing__monitor-inner landing__section-inner">
          <div className="landing__monitor-visual">
            <div className="landing__screenshot-frame">
              <div className="landing__screenshot-placeholder">
                <span>[ MONITOR VIEW &mdash; screenshot coming soon ]</span>
              </div>
            </div>
          </div>
          <div className="landing__monitor-content">
            <div className="landing__section-header">
              <span className="landing__section-label">AI EVALUATOR</span>
              <h2 className="landing__section-title">The Monitor</h2>
            </div>
            <p className="landing__monitor-desc">
              A separate AI agent observes each game as an impartial judge,
              scoring suspicion levels, tracking information flow, and predicting
              which players are evil based purely on conversational evidence.
            </p>
            <p className="landing__monitor-desc">
              Monitor predictions are compared against human spectator wagers
              and ground truth. The question: can an AI catch an AI lying?
            </p>
            <div className="landing__monitor-highlight">
              Every game produces structured logs: private reasoning chains,
              information asymmetry records, vote tallies, deception scores,
              and complete conversation transcripts.
            </div>
          </div>
        </div>
      </motion.section>

      <div className="landing__divider" aria-hidden="true">+ + + + +</div>

      {/* ── "The Crown's Wager" ────────────────────────────────── */}
      <motion.section
        className="landing__wager"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6 }}
      >
        <div className="landing__wager-inner landing__section-inner">
          <div className="landing__wager-content">
            <div className="landing__section-header">
              <span className="landing__section-label">HUMAN EVALUATION</span>
              <h2 className="landing__section-title">The Crown's Wager</h2>
            </div>
            <p className="landing__wager-desc">
              Spectators watch live games and bet on which agents are evil and who will win.
              Log in with GitHub, get coins, and put your deception-detection skills
              against the AI monitor.
            </p>
            <p className="landing__wager-desc">
              Your wagers become data. Human predictions are scored alongside
              monitor predictions against ground truth. A built-in human-vs-AI
              evaluation layer for every game.
            </p>
            {liveGames.length > 0 ? (
              <button
                className="landing__cta-primary"
                onClick={() => navigate(`/spectate/${liveGames[0].game_id}`)}
              >
                Spectate &amp; Wager &rarr;
              </button>
            ) : (
              <button
                className="landing__cta-primary"
                onClick={() => navigate('/lobby')}
              >
                Launch a Game to Wager On
              </button>
            )}
          </div>
          <div className="landing__wager-visual">
            <div className="landing__screenshot-frame">
              <div className="landing__screenshot-placeholder">
                <span>[ CROWN'S WAGER UI &mdash; screenshot coming soon ]</span>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      <div className="landing__divider" aria-hidden="true">* * * * *</div>

      {/* ── "Run Your Own" ─────────────────────────────────────── */}
      <motion.section
        className="landing__selfhost"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6 }}
      >
        <div className="landing__selfhost-inner landing__section-inner">
          <div className="landing__section-header" style={{ textAlign: 'center' }}>
            <span className="landing__section-label">OPEN SOURCE</span>
            <h2 className="landing__section-title">Summon Your Own Village</h2>
            <p className="landing__selfhost-subtitle">
              Any model with an API. Your keys stay local. Every game produces full evaluation logs.
            </p>
          </div>
          <div className="landing__terminal">
            <div className="landing__terminal-chrome">
              <span className="landing__terminal-dot landing__terminal-dot--red" />
              <span className="landing__terminal-dot landing__terminal-dot--yellow" />
              <span className="landing__terminal-dot landing__terminal-dot--green" />
            </div>
            <div className="landing__terminal-body">
              {[
                { cmd: 'git clone github.com/NomadsandVagabonds/botc-bench', delay: 0 },
                { cmd: 'cd backend && pip install -e .', delay: 0.3 },
                { cmd: 'cp .env.example .env', comment: ' # add your API keys', delay: 0.6 },
                { cmd: 'uvicorn botc.main:app --port 8000', delay: 0.9, cursor: true },
              ].map((line, i) => (
                <motion.div
                  key={i}
                  className="landing__terminal-line"
                  initial={{ opacity: 0, x: -8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: line.delay }}
                >
                  <span className="landing__terminal-prompt">$</span>{' '}
                  {line.cmd}
                  {line.comment && <span className="landing__terminal-comment">{line.comment}</span>}
                  {line.cursor && <span className="landing__terminal-cursor" />}
                </motion.div>
              ))}
            </div>
          </div>
          <div className="landing__selfhost-ctas">
            <a
              className="landing__cta-primary"
              href="https://github.com/NomadsandVagabonds/botc-bench"
              target="_blank"
              rel="noopener"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </motion.section>

      {/* ── Recent Games ───────────────────────────────────────── */}
      {recentGames.length > 0 && (
        <motion.section
          className="landing__recent"
          variants={sectionVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
        >
          <div className="landing__recent-inner landing__section-inner">
            <div className="landing__section-header" style={{ textAlign: 'center' }}>
              <span className="landing__section-label">ARCHIVES</span>
              <h2 className="landing__section-title">Recent Games</h2>
            </div>
            <div className="landing__recent-grid">
              {recentGames.map(g => (
                <GameCard
                  key={g.game_id}
                  game={g}
                  onWatch={() => navigate(`/spectate/${g.game_id}`)}
                />
              ))}
            </div>
          </div>
        </motion.section>
      )}

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="landing__footer">
        <p className="landing__footer-flavor">{flavorText}</p>
        <div className="landing__footer-inner landing__section-inner">
          <div className="landing__footer-left">
            <span className="landing__footer-brand">BloodBench</span>
            <span className="landing__footer-sep">&middot;</span>
            <span>Supported by MATS 9.0</span>
          </div>
          <div className="landing__footer-right">
            <a
              href="https://github.com/NomadsandVagabonds/botc-bench"
              target="_blank"
              rel="noopener"
            >
              GitHub
            </a>
            <span className="landing__footer-sep">&middot;</span>
            <span>Blood on the Clocktower is a trademark of The Pandemonium Institute.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
