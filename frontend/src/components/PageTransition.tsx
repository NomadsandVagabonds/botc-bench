import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

/**
 * Full-screen dissolve overlay. Fades to black, calls onMidpoint,
 * then fades back out. Use for page transitions.
 */
export function PageTransition({ onMidpoint, duration = 1.2 }: {
  onMidpoint: () => void;
  duration?: number;
}) {
  const [phase, setPhase] = useState<'in' | 'mid' | 'out'>('in');

  useEffect(() => {
    const halfDur = (duration / 2) * 1000;
    const t1 = setTimeout(() => {
      setPhase('mid');
      onMidpoint();
    }, halfDur);
    const t2 = setTimeout(() => setPhase('out'), halfDur + 200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onMidpoint, duration]);

  return (
    <motion.div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        zIndex: 10000,
        pointerEvents: phase === 'out' ? 'none' : 'all',
      }}
      initial={{ opacity: 0 }}
      animate={{
        opacity: phase === 'in' ? 1 : phase === 'mid' ? 1 : 0,
      }}
      transition={{ duration: duration / 2, ease: 'easeInOut' }}
    />
  );
}
