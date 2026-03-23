/**
 * Dramatic accusation/defense overlay — Phoenix Wright-style character pop-up
 * with typewriter text box. Renders on top of the TownMap during nominations.
 *
 * Manages its own display timing: each speech stays on screen until the
 * typewriter finishes + a linger period, regardless of when the store
 * clears activeSpeech or pushes a new one.
 */

import { motion } from 'framer-motion';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useGameStore } from '../../stores/gameStore.ts';

// ── Types ────────────────────────────────────────────────────────────

interface SpeechData {
  type: 'accusation' | 'defense';
  speakerName: string;
  otherName: string;
  content: string;
  spriteId: number;
}

// ── Constants ────────────────────────────────────────────────────────

const TYPEWRITER_SPEED = 35;       // ms per character
const TYPEWRITER_DELAY = 600;      // ms before typewriter starts (entrance animation)
const LINGER_AFTER_COMPLETE = 5000; // ms to keep showing after typewriter finishes

// ── Asset lookup ─────────────────────────────────────────────────────

function accusationUrl(spriteId: number, type: 'accusation' | 'defense'): string {
  if (type === 'defense') {
    return `/final_accusations/sprite_${spriteId}_defense.png`;
  }
  return `/final_accusations/sprite_${spriteId}.png`;
}

const assetCache = new Map<number, boolean>();

function useAssetExists(spriteId: number | null): boolean | null {
  const [exists, setExists] = useState<boolean | null>(
    spriteId != null && assetCache.has(spriteId) ? assetCache.get(spriteId)! : null,
  );

  useEffect(() => {
    if (spriteId == null) return;
    if (assetCache.has(spriteId)) {
      setExists(assetCache.get(spriteId)!);
      return;
    }
    const img = new Image();
    img.onload = () => {
      assetCache.set(spriteId, true);
      setExists(true);
    };
    img.onerror = () => {
      assetCache.set(spriteId, false);
      setExists(false);
    };
    img.src = accusationUrl(spriteId, 'accusation');
  }, [spriteId]);

  return exists;
}

// ── Typewriter hook ──────────────────────────────────────────────────

function useTypewriter(
  text: string,
  speed: number,
  delay: number,
  onComplete?: () => void,
): string {
  const [displayed, setDisplayed] = useState('');
  const indexRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);

  useEffect(() => {
    setDisplayed('');
    indexRef.current = 0;
    completedRef.current = false;
    if (intervalRef.current) clearInterval(intervalRef.current);

    const delayTimer = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        indexRef.current += 1;
        if (indexRef.current >= text.length) {
          setDisplayed(text);
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          if (!completedRef.current) {
            completedRef.current = true;
            onComplete?.();
          }
        } else {
          setDisplayed(text.slice(0, indexRef.current));
        }
      }, speed);
    }, delay);

    return () => {
      clearTimeout(delayTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [text, speed, delay, onComplete]);

  return displayed;
}

// ── Orchestrator component (reads store, manages queue) ─────────────

interface AccusationOverlayProps {
  players: Array<{ seat: number; characterName?: string }>;
  spriteIds: number[];
}

export default function AccusationOverlayController({ players, spriteIds }: AccusationOverlayProps) {
  const activeSpeech = useGameStore((s) => s.activeSpeech);
  const [queue, setQueue] = useState<SpeechData[]>([]);
  const [current, setCurrent] = useState<SpeechData | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const lingerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEnqueuedRef = useRef<string | null>(null);
  const playersRef = useRef(players);
  playersRef.current = players;
  const spriteIdsRef = useRef(spriteIds);
  spriteIdsRef.current = spriteIds;

  // When activeSpeech changes, enqueue it (only deps: activeSpeech identity)
  useEffect(() => {
    if (!activeSpeech) return;
    // Dedup: don't re-enqueue the same speech
    const key = `${activeSpeech.type}-${activeSpeech.speakerSeat}-${activeSpeech.content.slice(0, 50)}`;
    if (key === lastEnqueuedRef.current) return;
    lastEnqueuedRef.current = key;

    const currentPlayers = playersRef.current;
    const currentSpriteIds = spriteIdsRef.current;
    const speaker = currentPlayers.find(p => p.seat === activeSpeech.speakerSeat);
    const other = currentPlayers.find(p => p.seat === activeSpeech.otherSeat);
    const spriteId = currentSpriteIds[activeSpeech.speakerSeat % currentSpriteIds.length];

    const speech: SpeechData = {
      type: activeSpeech.type,
      speakerName: speaker?.characterName || `Seat ${activeSpeech.speakerSeat}`,
      otherName: other?.characterName || `Seat ${activeSpeech.otherSeat}`,
      content: activeSpeech.content,
      spriteId,
    };

    setQueue(prev => [...prev, speech]);
  }, [activeSpeech]);

  // When current is null and queue has items, pop the next one
  useEffect(() => {
    if (current == null && queue.length > 0) {
      const [next, ...rest] = queue;
      setCurrent(next);
      setQueue(rest);
      setDismissed(false);
    }
  }, [current, queue]);

  // Track visibility in store so other overlays (BlockOverlay, death narration) can wait
  const isRendering = !!(current && !dismissed);
  useEffect(() => {
    useGameStore.setState({ accusationOverlayVisible: isRendering });
  }, [isRendering]);

  // Called when typewriter finishes — start linger timer
  const handleTypewriterComplete = useCallback(() => {
    if (lingerTimerRef.current) clearTimeout(lingerTimerRef.current);
    lingerTimerRef.current = setTimeout(() => {
      setDismissed(true);
      // Wait for exit animation before clearing current
      setTimeout(() => setCurrent(null), 500);
    }, LINGER_AFTER_COMPLETE);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (lingerTimerRef.current) clearTimeout(lingerTimerRef.current);
      useGameStore.setState({ accusationOverlayVisible: false });
    };
  }, []);

  if (!current || dismissed) return null;

  return (
    <AccusationOverlayDisplay
      key={`${current.type}-${current.speakerName}-${current.content.slice(0, 20)}`}
      speech={current}
      onTypewriterComplete={handleTypewriterComplete}
    />
  );
}

// ── Display component (renders one speech) ──────────────────────────

function AccusationOverlayDisplay({
  speech,
  onTypewriterComplete,
}: {
  speech: SpeechData;
  onTypewriterComplete: () => void;
}) {
  const assetExists = useAssetExists(speech.spriteId);
  const stableCallback = useRef(onTypewriterComplete);
  stableCallback.current = onTypewriterComplete;
  const memoizedCallback = useCallback(() => stableCallback.current(), []);
  const typedText = useTypewriter(speech.content, TYPEWRITER_SPEED, TYPEWRITER_DELAY, memoizedCallback);
  const textRef = useRef<HTMLDivElement>(null);
  const isAccusation = speech.type === 'accusation';

  // Auto-scroll text box as typewriter progresses
  useEffect(() => {
    if (textRef.current) {
      textRef.current.scrollTop = textRef.current.scrollHeight;
    }
  }, [typedText]);

  // If no asset, fire completion immediately so the queue moves on
  useEffect(() => {
    if (assetExists === false) {
      onTypewriterComplete();
    }
  }, [assetExists, onTypewriterComplete]);

  if (assetExists !== true) return null;

  const badgeColor = isAccusation ? '#EF4444' : '#3B82F6';
  const badgeLabel = isAccusation ? 'ACCUSATION' : 'DEFENSE';
  const badgeIcon = isAccusation ? '\u2696\uFE0F' : '\uD83D\uDEE1\uFE0F';

  return (
    <motion.div
      style={styles.backdrop}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Character image */}
      <motion.div
        style={{
          ...styles.characterContainer,
          ...(isAccusation ? styles.characterLeft : styles.characterRight),
        }}
        initial={{ x: isAccusation ? '-100%' : '100%' }}
        animate={{ x: 0 }}
        exit={{ x: isAccusation ? '-100%' : '100%' }}
        transition={{ type: 'spring', stiffness: 120, damping: 20, mass: 1 }}
      >
        <img
          src={accusationUrl(speech.spriteId, speech.type)}
          alt={speech.speakerName}
          style={{
            ...styles.characterImage,
            // Base image for accusation, _defense image for defense — no CSS flip needed
          }}
        />
      </motion.div>

      {/* Text box */}
      <motion.div
        style={{
          ...styles.textBox,
          ...(isAccusation ? styles.textBoxRight : styles.textBoxLeft),
        }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.6, delay: 0.2 }}
      >
        {/* Title */}
        <div style={{ ...styles.title, color: badgeColor }}>
          {badgeIcon} {badgeLabel}
        </div>

        {/* Divider */}
        <div style={{ ...styles.divider, borderColor: badgeColor }} />

        {/* Header */}
        <div style={styles.header}>
          {isAccusation
            ? `${speech.speakerName} accuses ${speech.otherName}`
            : `${speech.speakerName} defends against ${speech.otherName}'s accusation`}
        </div>

        {/* Speech text with typewriter */}
        <div ref={textRef} style={styles.speechBody}>
          {typedText}
          {typedText.length < speech.content.length && (
            <span style={styles.cursor}>|</span>
          )}
        </div>

        {/* Attribution */}
        <div style={styles.attribution}>— {speech.speakerName}</div>
      </motion.div>
    </motion.div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    zIndex: 108,
    display: 'flex',
    alignItems: 'flex-end',
    pointerEvents: 'none',
    overflow: 'hidden',
  },

  // Character positioning
  characterContainer: {
    position: 'absolute',
    bottom: 0,
    zIndex: 109,
    height: '60%',
    display: 'flex',
    alignItems: 'flex-end',
  },
  characterLeft: {
    left: '2%',
  },
  characterRight: {
    right: '2%',
  },
  characterImage: {
    height: '100%',
    width: 'auto',
    objectFit: 'contain',
    imageRendering: 'auto' as any,
    filter: 'drop-shadow(0 4px 20px rgba(0,0,0,0.6))',
  },

  // Text box positioning
  textBox: {
    position: 'absolute',
    top: '8%',
    zIndex: 109,
    width: '48%',
    maxHeight: '65%',
    display: 'flex',
    flexDirection: 'column',
    background: 'linear-gradient(180deg, rgba(20,16,10,0.95) 0%, rgba(12,10,6,0.97) 100%)',
    border: '2px solid rgba(196,162,101,0.5)',
    borderRadius: 4,
    padding: '18px 22px',
    boxShadow: 'inset 0 0 30px rgba(0,0,0,0.3), 0 4px 20px rgba(0,0,0,0.5)',
    pointerEvents: 'auto',
  },
  textBoxRight: {
    right: '3%',
  },
  textBoxLeft: {
    left: '3%',
  },

  // Title header — pixel font for that FF/RPG feel
  title: {
    fontSize: 'clamp(14px, 2vw, 22px)',
    fontWeight: 400,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    fontFamily: '"Press Start 2P", monospace',
    textShadow: '0 2px 8px rgba(0,0,0,0.6), 0 0 20px currentColor',
    imageRendering: 'pixelated' as any,
  },

  divider: {
    height: 2,
    border: 'none',
    borderTop: '2px solid',
    opacity: 0.4,
    margin: '10px 0 12px',
  },

  header: {
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 'clamp(7px, 0.8vw, 9px)',
    lineHeight: 1.8,
    color: 'rgba(196,162,101,0.7)',
    marginBottom: 10,
  },

  speechBody: {
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 'clamp(8px, 0.9vw, 11px)',
    lineHeight: 2.0,
    color: '#e8d4b0',
    textShadow: '0 0 8px rgba(200,160,80,0.2)',
    overflowY: 'auto',
    flex: 1,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },

  cursor: {
    animation: 'blink 0.6s step-end infinite',
    color: '#e8d4b0',
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 'inherit',
  },

  attribution: {
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 'clamp(6px, 0.7vw, 8px)',
    color: 'rgba(196,162,101,0.5)',
    marginTop: 12,
    textAlign: 'right' as const,
  },
};
