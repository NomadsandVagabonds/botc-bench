import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Title splash screen that displays on first load,
 * then pixelate-dissolves into the lobby.
 */
export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<'hold' | 'dissolve' | 'done'>('hold');

  useEffect(() => {
    // Hold the title for 3 seconds, then start dissolving
    const holdTimer = setTimeout(() => setPhase('dissolve'), 3000);
    return () => clearTimeout(holdTimer);
  }, []);

  useEffect(() => {
    if (phase === 'dissolve') {
      // Dissolve takes 1.5 seconds, then complete
      const dissolveTimer = setTimeout(() => {
        setPhase('done');
        onComplete();
      }, 1500);
      return () => clearTimeout(dissolveTimer);
    }
  }, [phase, onComplete]);

  // Allow click/key to skip
  const skip = useCallback(() => {
    setPhase('done');
    onComplete();
  }, [onComplete]);

  if (phase === 'done') return null;

  return (
    <AnimatePresence>
      <motion.div
        style={styles.container}
        onClick={skip}
        onKeyDown={skip}
        tabIndex={0}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      >
        <motion.div
          style={styles.imageWrap}
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
          transition={phase === 'dissolve' ? {
            duration: 1.5,
            ease: 'easeIn',
          } : {}}
        >
          <img
            src="/title.jpg"
            alt="BotC Bench"
            style={styles.image}
          />
        </motion.div>

        {/* Pixelation overlay — a grid of squares that fade in during dissolve */}
        {phase === 'dissolve' && (
          <motion.div
            style={styles.pixelOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.3 }}
          >
            {Array.from({ length: 120 }, (_, i) => (
              <motion.div
                key={i}
                style={{
                  ...styles.pixel,
                  left: `${(i % 12) * 8.33}%`,
                  top: `${Math.floor(i / 12) * 10}%`,
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{
                  duration: 0.4,
                  delay: 0.2 + Math.random() * 0.8,
                }}
              />
            ))}
          </motion.div>
        )}

        {/* Skip hint */}
        <motion.div
          style={styles.skipHint}
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

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    background: '#000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    outline: 'none',
  },
  imageWrap: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    maxWidth: '90vw',
    maxHeight: '80vh',
    objectFit: 'contain',
    imageRendering: 'auto',
  },
  pixelOverlay: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    overflow: 'hidden',
  },
  pixel: {
    position: 'absolute',
    width: '8.33%',
    height: '10%',
    background: '#0a0806',
  },
  skipHint: {
    position: 'absolute',
    bottom: 30,
    left: '50%',
    transform: 'translateX(-50%)',
    color: 'rgba(255,255,255,0.4)',
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
  },
};
