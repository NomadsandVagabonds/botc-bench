/**
 * DeathCardOverlay — funeral scene shown when a character dies.
 *
 * For executions: shows "XXXXX WAS EXECUTED" over the funeral image.
 * For night deaths: shows the LLM-generated absurd death narration.
 * Multiple deaths stack one after another (3s each).
 *
 * Pauses the theatrical/replay pacer via accusationOverlayVisible-style
 * store flag so the next day doesn't start until all deaths are shown.
 */

import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../../stores/gameStore.ts';
import type { Player } from '../../types/game.ts';

// ── Constants ────────────────────────────────────────────────────────

const DISPLAY_MS = 4000;

// ── Asset check ─────────────────────────────────────────────────────

const deathCache = new Map<number, boolean>();

function useDeathAsset(spriteId: number | null): boolean | null {
  const [exists, setExists] = useState<boolean | null>(
    spriteId != null && deathCache.has(spriteId) ? deathCache.get(spriteId)! : null,
  );

  useEffect(() => {
    if (spriteId == null) return;
    if (deathCache.has(spriteId)) {
      setExists(deathCache.get(spriteId)!);
      return;
    }
    const img = new Image();
    img.onload = () => { deathCache.set(spriteId, true); setExists(true); };
    img.onerror = () => { deathCache.set(spriteId, false); setExists(false); };
    img.src = `/final_deaths/death_${spriteId}.png`;
  }, [spriteId]);

  return exists;
}

// ── Types ────────────────────────────────────────────────────────────

interface DeathCard {
  name: string;
  spriteId: number;
  text: string; // "EXECUTED" or narration text
  isExecution: boolean;
}

// ── Component ────────────────────────────────────────────────────────

interface DeathCardOverlayProps {
  players: Player[];
  spriteIds: number[];
}

export function DeathCardOverlay({ players, spriteIds }: DeathCardOverlayProps) {
  const [queue, setQueue] = useState<DeathCard[]>([]);
  const [current, setCurrent] = useState<DeathCard | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenDeathsRef = useRef<Set<string>>(new Set());
  const gameState = useGameStore((s) => s.gameState);

  // Watch for death-related messages
  useEffect(() => {
    if (!gameState?.messages.length) return;
    const latest = gameState.messages[gameState.messages.length - 1];

    // Execution death
    if (latest.type === 'system' && latest.content.includes('EXECUTED')) {
      // Extract name: "⚖️ Urswick (Imp) has been EXECUTED."
      const match = latest.content.match(/⚖️?\s*(.+?)\s*\(.+?\)\s*has been EXECUTED/);
      const name = match?.[1]?.trim();
      if (!name) return;

      const key = `exec-${name}-${gameState.dayNumber}`;
      if (seenDeathsRef.current.has(key)) return;
      seenDeathsRef.current.add(key);

      const player = players.find(p => p.characterName === name);
      if (!player) return;
      const spriteId = spriteIds[player.seat % spriteIds.length];

      setQueue(prev => [...prev, {
        name,
        spriteId,
        text: `${name.toUpperCase()} WAS EXECUTED`,
        isExecution: true,
      }]);
    }

    // Night death narration
    if (latest.type === 'narration' ||
        (latest.type === 'system' && latest.content.includes('narration:'))) {
      const narration = latest.content.replace('narration:', '').trim();

      // Try to find which player died from recent death events
      const recentDeaths = gameState.messages
        .slice(-10)
        .filter(m => m.type === 'system' && (m.content.includes('died') || m.content.includes('dead')));

      for (const deathMsg of recentDeaths) {
        // "Urswick died in the night" or "Urswick was found dead"
        for (const player of players) {
          if (!player.characterName) continue;
          if (deathMsg.content.includes(player.characterName) && !player.isAlive) {
            const key = `night-${player.characterName}-${gameState.dayNumber}`;
            if (seenDeathsRef.current.has(key)) continue;
            seenDeathsRef.current.add(key);

            const spriteId = spriteIds[player.seat % spriteIds.length];
            setQueue(prev => [...prev, {
              name: player.characterName!,
              spriteId,
              text: narration,
              isExecution: false,
            }]);
          }
        }
      }
    }
  }, [gameState?.messages.length, players, spriteIds]);

  // Pop from queue when current finishes
  useEffect(() => {
    if (current == null && queue.length > 0) {
      const [next, ...rest] = queue;
      setCurrent(next);
      setQueue(rest);
    }
  }, [current, queue]);

  // Track visibility in store so pacers wait
  const isShowing = current != null;
  useEffect(() => {
    if (isShowing) {
      useGameStore.setState({ deathCardVisible: true });
    }
    return () => {
      if (!isShowing) {
        useGameStore.setState({ deathCardVisible: false });
      }
    };
  }, [isShowing]);

  // Auto-dismiss after DISPLAY_MS
  useEffect(() => {
    if (!current) return;
    timerRef.current = setTimeout(() => {
      setCurrent(null);
      // Brief delay before checking if there's another card
      setTimeout(() => {
        useGameStore.setState({ deathCardVisible: false });
      }, 300);
    }, DISPLAY_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [current]);

  if (!current) return null;

  return <DeathCardDisplay card={current} />;
}

// ── Display component ────────────────────────────────────────────────

function DeathCardDisplay({ card }: { card: DeathCard }) {
  const assetExists = useDeathAsset(card.spriteId);

  // If no asset, just show a dark overlay with text
  return (
    <AnimatePresence>
      <motion.div
        key={`death-${card.name}`}
        style={styles.backdrop}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
      >
        {assetExists && (
          <motion.img
            src={`/final_deaths/death_${card.spriteId}.png`}
            alt={`${card.name} death scene`}
            style={styles.image}
            initial={{ scale: 1.05 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.6 }}
          />
        )}
        <motion.div
          style={styles.textContainer}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
        >
          <div style={card.isExecution ? styles.executionText : styles.narrationText}>
            {card.text}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Styles ───────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'absolute',
    inset: 0,
    zIndex: 107,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.92)',
    pointerEvents: 'none',
  },
  image: {
    maxHeight: '60vh',
    maxWidth: '85vw',
    objectFit: 'contain',
    filter: 'drop-shadow(0 0 30px rgba(0, 0, 0, 0.5))',
    borderRadius: 4,
  },
  textContainer: {
    marginTop: 20,
    textAlign: 'center',
    maxWidth: '80%',
    padding: '0 20px',
  },
  executionText: {
    fontFamily: "'Press Start 2P', monospace",
    fontSize: 'clamp(12px, 2vw, 18px)',
    color: '#EF4444',
    letterSpacing: 2,
    textShadow: '0 0 12px rgba(239, 68, 68, 0.4), 0 2px 8px rgba(0, 0, 0, 0.8)',
    lineHeight: 1.6,
  },
  narrationText: {
    fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
    fontStyle: 'italic',
    fontSize: 'clamp(13px, 1.5vw, 17px)',
    color: '#e8d4b0',
    textShadow: '0 0 12px rgba(200, 160, 80, 0.4), 0 2px 4px rgba(0, 0, 0, 0.8)',
    lineHeight: 1.6,
  },
};

export default DeathCardOverlay;
