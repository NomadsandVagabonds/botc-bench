import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import './EventCountdown.css';

// ── Types ────────────────────────────────────────────────────────────

export interface EventData {
  start_time: string;   // ISO 8601
  prize_pool: number;
  title?: string;
  description?: string;
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function calcTimeLeft(target: string): TimeLeft | null {
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return null;
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
    total: diff,
  };
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

// ── Digit component with flip animation ─────────────────────────────

function CountdownDigit({ value, label }: { value: string; label: string }) {
  return (
    <div className="event__unit">
      <div className="event__digit-box">
        <AnimatePresence mode="popLayout">
          <motion.span
            key={value}
            className="event__digit"
            initial={{ y: -8, opacity: 0.3 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </div>
      <span className="event__unit-label">{label}</span>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────

interface EventCountdownProps {
  event: EventData;
  liveGameId?: string;
}

export function EventCountdown({ event, liveGameId }: EventCountdownProps) {
  const navigate = useNavigate();
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(null);

  useEffect(() => {
    if (!event.start_time) return;
    const tick = () => setTimeLeft(calcTimeLeft(event.start_time));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [event.start_time]);

  const isLive = !!liveGameId;
  const isPast = !timeLeft && !isLive;
  const isUrgent = timeLeft && timeLeft.total < 300_000;  // < 5 min
  const isSoon = timeLeft && timeLeft.total < 3_600_000;  // < 1 hour

  if (isPast) return null;

  return (
    <motion.div
      className={`event ${isLive ? 'event--live' : ''} ${isUrgent ? 'event--urgent' : ''}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2 }}
    >
      {isLive ? (
        /* ── LIVE state ───────────────────────────────────── */
        <>
          <div className="event__live-badge">
            <span className="event__live-dot" />
            <span className="event__live-text">LIVE</span>
          </div>
          <h2 className="event__title">
            {event.title || 'The Trial Is Underway'}
          </h2>
          <div className="event__prize">
            <img src="/coin.png" alt="" className="event__coin" />
            <span>${event.prize_pool} in prizes</span>
          </div>
          <p className="event__instructions">
            Watch the game. Predict which agents are Evil. Beat the AI Monitor.
          </p>
          <button
            className="event__cta event__cta--live"
            onClick={() => navigate(`/spectate/${liveGameId}`)}
          >
            Spectate &amp; Wager &rarr;
          </button>
        </>
      ) : (
        /* ── Countdown state ──────────────────────────────── */
        <>
          <span className="event__label">
            {isUrgent ? 'TRIAL IMMINENT' : isSoon ? 'TRIAL APPROACHES' : 'NEXT TRIAL'}
          </span>
          {event.title && <h2 className="event__title">{event.title}</h2>}

          <div className="event__countdown">
            {timeLeft!.days > 0 && (
              <>
                <CountdownDigit value={String(timeLeft!.days)} label="DAYS" />
                <span className="event__separator">:</span>
              </>
            )}
            <CountdownDigit value={pad(timeLeft!.hours)} label="HRS" />
            <span className="event__separator">:</span>
            <CountdownDigit value={pad(timeLeft!.minutes)} label="MIN" />
            <span className="event__separator">:</span>
            <CountdownDigit value={pad(timeLeft!.seconds)} label="SEC" />
          </div>

          <div className="event__prize">
            <img src="/coin.png" alt="" className="event__coin" />
            <span>${event.prize_pool} in prizes</span>
          </div>

          <p className="event__instructions">
            {event.description || 'Watch the game live. Predict which agents are Evil. Beat the AI Monitor. Win Crowns.'}
          </p>
        </>
      )}
    </motion.div>
  );
}
