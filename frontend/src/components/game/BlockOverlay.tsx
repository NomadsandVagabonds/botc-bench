/**
 * BlockOverlay — dramatic full-screen flash when a player is put "on the block"
 *
 * Shows their execution portrait with "X is ON THE BLOCK" text for 3 seconds,
 * then fades out. The theatrical pacer ensures this only triggers after
 * the accusation/defense overlays have finished.
 */

import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Player, OnTheBlock } from '../../types/game.ts';

// ── Asset check ─────────────────────────────────────────────────────

const execCache = new Map<number, boolean>();

function useExecutionAsset(spriteId: number | null): boolean | null {
  const [exists, setExists] = useState<boolean | null>(
    spriteId != null && execCache.has(spriteId) ? execCache.get(spriteId)! : null,
  );

  useEffect(() => {
    if (spriteId == null) return;
    if (execCache.has(spriteId)) {
      setExists(execCache.get(spriteId)!);
      return;
    }
    const img = new Image();
    img.onload = () => { execCache.set(spriteId, true); setExists(true); };
    img.onerror = () => { execCache.set(spriteId, false); setExists(false); };
    img.src = `/final_executions/execution_${spriteId}.png`;
  }, [spriteId]);

  return exists;
}

// ── Component ───────────────────────────────────────────────────────

interface BlockOverlayProps {
  onTheBlock: OnTheBlock | null;
  players: Player[];
  spriteIds: number[];
}

const DISPLAY_MS = 3000;
const FADE_IN_MS = 0.3;

export function BlockOverlay({ onTheBlock, players, spriteIds }: BlockOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [displayData, setDisplayData] = useState<{
    name: string;
    spriteId: number;
    voteCount: number;
  } | null>(null);
  const lastShownRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show when onTheBlock transitions to a new value
  useEffect(() => {
    if (!onTheBlock) {
      lastShownRef.current = null;
      return;
    }

    const key = `${onTheBlock.seat}-${onTheBlock.voteCount}`;
    if (key === lastShownRef.current) return;
    lastShownRef.current = key;

    const player = players.find(p => p.seat === onTheBlock.seat);
    if (!player) return;

    const spriteId = spriteIds[player.seat % spriteIds.length];

    setDisplayData({
      name: player.characterName || player.agentId || `Seat ${player.seat}`,
      spriteId,
      voteCount: onTheBlock.voteCount,
    });
    setVisible(true);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), DISPLAY_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onTheBlock, players, spriteIds]);

  const spriteId = displayData?.spriteId ?? null;
  const assetExists = useExecutionAsset(spriteId);

  if (!displayData || assetExists === false) return null;

  return (
    <AnimatePresence>
      {visible && assetExists && (
        <motion.div
          key={`block-${displayData.spriteId}`}
          style={styles.backdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: FADE_IN_MS }}
        >
          <motion.img
            src={`/final_executions/execution_${displayData.spriteId}.png`}
            alt={`${displayData.name} on the block`}
            style={styles.image}
            initial={{ scale: 1.05 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.4 }}
          />
          <motion.div
            style={styles.textContainer}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.3 }}
          >
            <div style={styles.text}>
              {displayData.name.toUpperCase()} is ON THE BLOCK
            </div>
          </motion.div>
        </motion.div>
      )}
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
    background: 'rgba(0, 0, 0, 0.88)',
    boxShadow: 'inset 0 0 120px rgba(139, 26, 26, 0.3)',
    pointerEvents: 'none',
  },
  image: {
    maxHeight: '65vh',
    maxWidth: '90vw',
    objectFit: 'contain',
    filter: 'drop-shadow(0 0 30px rgba(139, 26, 26, 0.4))',
  },
  textContainer: {
    marginTop: 20,
    textAlign: 'center',
  },
  text: {
    fontFamily: "'Press Start 2P', monospace",
    fontSize: 'clamp(12px, 2vw, 18px)',
    color: '#c9a84c',
    letterSpacing: 2,
    textShadow: '0 0 12px rgba(201, 168, 76, 0.4), 0 2px 8px rgba(0, 0, 0, 0.8)',
    lineHeight: 1.6,
  },
};

export default BlockOverlay;
