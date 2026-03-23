import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useGameStore } from '../../stores/gameStore.ts';
import { Phase } from '../../types/game.ts';
import type { Message } from '../../types/game.ts';
import { getProviderColor, shortModelName } from '../../utils/models.ts';
import { AnimatePresence, motion } from 'framer-motion';
import AccusationOverlay from './AccusationOverlay.tsx';
import {
  findPath,
  spriteZIndex,
  isBehindTower,
  isWalkable,
  clampToWalkable,
  TOWN_POSITIONS,
  GROUP_DESTINATIONS,
  NIGHT_POSITIONS,
  ENTRY_POINTS,
  type Point,
} from './pathfinding.ts';

/**
 * Pixel-art town map with waypoint-based movement.
 *
 * Sprites walk around the clocktower (never through it).
 * The map is split into background + clocktower foreground layers
 * so sprites correctly occlude behind the tower.
 */

// ---------------------------------------------------------------------------
// Ambient video system — idle clips rotate randomly, event clips on triggers
// ---------------------------------------------------------------------------

const IDLE_CLIPS = [
  '/ambient/idle-dog-crossing.mp4',
  '/ambient/idle-plague-cart.mp4',
  '/ambient/idle-imps.mp4',
  '/ambient/idle-thief.mp4',
  '/ambient/idle-drunk.mp4',
  '/ambient/idle-horse.mp4',
  '/ambient/idle-horse2.mp4',
  '/ambient/idle-horse3.mp4',
  '/ambient/idle-lovers.mp4',
  '/ambient/idle-merchant.mp4',
  '/ambient/idle-merchant2.mp4',
  '/ambient/idle-notdead.mp4',
  '/ambient/idle-sweep.mp4',
  '/ambient/idle-climb.mp4',
];

// Clips that interact with the clocktower (e.g. rappelling) — render above the foreground overlay
const ABOVE_TOWER_CLIPS = new Set([
  '/ambient/idle-climb.mp4',
]);

const EVENT_CLIPS: Record<string, string> = {
  'evil-wins':   '/ambient/event-evil-wins.mp4',
  // 'good-wins':   '/ambient/event-good-wins.mp4',
  // 'execution':   '/ambient/event-execution.mp4',
  // 'night-falls': '/ambient/event-night-falls.mp4',
};

const IDLE_MIN_MS = 45_000;
const IDLE_MAX_MS = 90_000;

function useAmbientVideo(phase: string | undefined, winner: string | undefined) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [frozenOnLastFrame, setFrozenOnLastFrame] = useState(false);
  const [fullscreenTakeover, setFullscreenTakeover] = useState(false);
  const [gameOverReady, setGameOverReady] = useState(false);
  const [aboveTower, setAboveTower] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPhaseRef = useRef(phase);
  const isEventClipRef = useRef(false);

  const playClip = useCallback((src: string, isEvent = false, takeover = false) => {
    const vid = videoRef.current;
    if (!vid) return;
    isEventClipRef.current = isEvent;
    setFullscreenTakeover(takeover);
    setAboveTower(ABOVE_TOWER_CLIPS.has(src));
    vid.src = src;
    vid.load();
    vid.play().then(() => {
      setVideoPlaying(true);
      setFrozenOnLastFrame(false);
    }).catch(() => {
      // Autoplay blocked or file missing — if this was a game-over event,
      // show the overlay immediately so the game doesn't hang
      if (isEventClipRef.current) {
        isEventClipRef.current = false;
        setFullscreenTakeover(false);
        setGameOverReady(true);
      }
    });
  }, []);

  // Shuffle bag — play every clip once before repeating any
  const shuffleBagRef = useRef<string[]>([]);

  const scheduleIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (IDLE_CLIPS.length === 0) return;
    const delay = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
    idleTimerRef.current = setTimeout(() => {
      // Refill and shuffle when bag is empty
      if (shuffleBagRef.current.length === 0) {
        const bag = [...IDLE_CLIPS];
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }
        shuffleBagRef.current = bag;
      }
      const clip = shuffleBagRef.current.pop()!;
      playClip(clip);
    }, delay);
  }, [playClip]);

  // When video ends — idle clips crossfade back; event clips freeze on last frame
  const handleEnded = useCallback(() => {
    if (isEventClipRef.current) {
      // Freeze: keep video visible on its last frame, signal overlay is ready
      setVideoPlaying(true);
      setFrozenOnLastFrame(true);
      setGameOverReady(true);
    } else {
      setVideoPlaying(false);
      setAboveTower(false);
      scheduleIdle();
    }
  }, [scheduleIdle]);

  // Start idle rotation on mount
  useEffect(() => {
    scheduleIdle();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  // Event-triggered clips on phase changes
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (!phase || phase === prev) return;

    let eventKey: string | null = null;

    if (phase === 'game_over') {
      eventKey = winner === 'good' ? 'good-wins' : 'evil-wins';
    } else if (phase === 'night' || phase === 'first_night') {
      if (prev && prev !== 'night' && prev !== 'first_night') {
        eventKey = 'night-falls';
      }
    }

    if (phase === 'game_over') {
      if (eventKey && EVENT_CLIPS[eventKey]) {
        // Cancel pending idle, play event clip — overlay waits until clip ends
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        setGameOverReady(false);
        playClip(EVENT_CLIPS[eventKey], true, true);
      } else {
        // No event clip — show overlay immediately
        setGameOverReady(true);
      }
    } else if (eventKey && EVENT_CLIPS[eventKey]) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      playClip(EVENT_CLIPS[eventKey], true);
    }
  }, [phase, winner, playClip]);

  // If game is already over on mount (e.g. loading a finished game) and no
  // event clip was kicked off by the phase-change effect, show overlay immediately.
  const mountCheckedRef = useRef(false);
  useEffect(() => {
    if (mountCheckedRef.current) return;
    mountCheckedRef.current = true;
    if ((phase === 'game_over' || phase === 'debrief') && !isEventClipRef.current) {
      setGameOverReady(true);
    }
  }, []);

  const triggerEvent = useCallback((key: string) => {
    if (EVENT_CLIPS[key]) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      playClip(EVENT_CLIPS[key], true);
    }
  }, [playClip]);

  return { videoRef, videoPlaying, frozenOnLastFrame, fullscreenTakeover, gameOverReady, aboveTower, handleEnded, triggerEvent };
}

// DX Terminal sprite pool — local sprites, randomized per game
const SPRITE_IDS = [
  1160, 1161, 1162, 1163, 1164,
  2045, 2046, 2047, 2048, 2049,
  3312, 3313, 3314, 3315,
  4501, 4502, 4503, 4504,
  5678, 5679, 5680, 5681,
  6234, 6235, 6236,
  7890, 7891, 7892,
  8456, 8457, 8458,
  9123, 9124, 9125,
  10567, 10568, 10569,
  11234, 11235, 11236,
  12890, 12891, 12892,
  13456, 13457,
  14012, 14013,
  15678, 15679,
  16234, 16235,
  17681, 17682, 17683, 17684, 17685,
  17890, 17891,
  18456, 18457,
  19123, 19124,
  20567, 20568,
  21000, 22000, 23000, 24000, 25000, 26000, 27000, 28000, 29000,
];

/** Simple seeded PRNG (mulberry32) for deterministic sprite selection per game. */
function seededRandom(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick N unique sprite IDs from the pool using a game-specific seed. */
function pickSpriteIds(gameId: string, count: number): number[] {
  let hash = 0;
  for (let i = 0; i < gameId.length; i++) {
    hash = ((hash << 5) - hash + gameId.charCodeAt(i)) | 0;
  }
  const rng = seededRandom(hash);
  // Shuffle and pick
  const pool = [...SPRITE_IDS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function spriteUrl(id: number): string {
  return `/sprites/sprite_${id}.gif`;
}

// Walk speed: seconds per 10% of map distance (higher = slower)
const WALK_SPEED_PER_10 = 1.5;

/** Duration in seconds for a sprite to walk between two points. */
function walkDuration(from: Point, to: Point): number {
  const dx = from[0] - to[0];
  const dy = from[1] - to[1];
  const d = Math.sqrt(dx * dx + dy * dy);
  return Math.max(1.0, (d / 10) * WALK_SPEED_PER_10);
}

// ---------------------------------------------------------------------------
// Walking sprite — animates through a path of waypoints
// ---------------------------------------------------------------------------

function randomNearby(base: Point, seat: number): Point {
  // Small jitter so each seat wanders near their spot, constrained to walkable areas
  const t = Date.now() * 0.001 + seat * 137;
  const dx = Math.sin(t) * 3;
  const dy = Math.cos(t * 1.3) * 2;
  const nx = Math.max(5, Math.min(95, base[0] + dx));
  const ny = Math.max(5, Math.min(95, base[1] + dy));
  // Only wander there if the destination is walkable
  if (!isWalkable(nx, ny) || isBehindTower(nx, ny)) {
    return base; // Stay put
  }
  return [nx, ny];
}

interface WalkingSpriteProps {
  seat: number;
  spriteId: number;
  target: Point;
  isIdle: boolean;  // whether the sprite should wander
  isNight: boolean;
  color: string;
  isDead: boolean;
  isSelected: boolean;
  isEvil: boolean;
  showObserverInfo: boolean;
  agentId: string;
  characterName: string;
  modelName: string;
  role: string;
  isPoisoned: boolean;
  isDrunk: boolean;
  isProtected: boolean;
  isTalking: boolean;
  hidden: boolean;
  onClick: () => void;
}

function WalkingSprite({
  seat, spriteId, target, isIdle, isNight, color, isDead, isSelected, isEvil,
  showObserverInfo, agentId, characterName, modelName, role, isPoisoned, isDrunk, isProtected, isTalking, hidden, onClick,
}: WalkingSpriteProps) {
  // Spawn at a staggered entry point, then walk to the target
  const entryPoint = ENTRY_POINTS[seat % ENTRY_POINTS.length];
  const [currentPos, setCurrentPos] = useState<Point>(entryPoint);
  const [pathPoints, setPathPoints] = useState<Point[]>([]);
  const [pathIndex, setPathIndex] = useState(0);
  const prevTarget = useRef<Point>(entryPoint);
  const [isMoving, setIsMoving] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // When target changes, compute path and walk there via waypoints
  useEffect(() => {
    const prev = prevTarget.current;
    if (prev[0] === target[0] && prev[1] === target[1]) return;

    const path = findPath(prev, target, true);
    setPathPoints(path);
    setPathIndex(0);
    prevTarget.current = target;
  }, [target[0], target[1]]);

  // Step through path points one at a time, speed proportional to distance
  const [segmentDuration, setSegmentDuration] = useState(1);
  useEffect(() => {
    if (pathPoints.length === 0) return;
    if (pathIndex >= pathPoints.length) return;

    const nextPt = pathPoints[pathIndex];
    const dur = walkDuration(currentPos, nextPt);
    setSegmentDuration(dur);
    setCurrentPos(nextPt);

    if (pathIndex < pathPoints.length - 1) {
      const timer = setTimeout(() => {
        setPathIndex(i => i + 1);
      }, dur * 1000);
      return () => clearTimeout(timer);
    }
  }, [pathPoints, pathIndex]);

  // Track whether the sprite is actively walking between waypoints
  useEffect(() => {
    const moving = pathPoints.length > 0 && pathIndex < pathPoints.length - 1;
    setIsMoving(moving);
  }, [pathPoints, pathIndex]);

  // When sprite stops moving, capture current GIF frame to canvas
  useEffect(() => {
    if (!isMoving && imgRef.current && canvasRef.current) {
      const img = imgRef.current;
      const canvas = canvasRef.current;
      const captureFrame = () => {
        const w = img.naturalWidth || 32;
        const h = img.naturalHeight || 32;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0);
        }
      };
      // If image is already loaded, capture immediately
      if (img.complete && img.naturalWidth > 0) {
        captureFrame();
      } else {
        // Wait for load before capturing
        img.addEventListener('load', captureFrame, { once: true });
      }
    }
  }, [isMoving]);

  // Idle wandering — when at target and in an idle phase, amble nearby
  useEffect(() => {
    if (!isIdle || isNight) return;

    // Wait 5-12 seconds, then pick a nearby spot to wander to
    const delay = 5000 + Math.random() * 7000 + seat * 800;
    const timer = setInterval(() => {
      const wanderTarget = randomNearby(target, seat);
      const path = findPath(currentPos, wanderTarget);
      setPathPoints(path);
      setPathIndex(0);
    }, delay);

    return () => clearInterval(timer);
  }, [isIdle, isDead, isNight, target[0], target[1]]);

  const [x, y] = currentPos;
  const zIndex = spriteZIndex(x, y);

  const spriteFilter = isDead
    ? 'grayscale(0.8) brightness(0.6)'
    : isSelected
    ? `drop-shadow(0 0 6px ${color}) drop-shadow(0 0 12px ${color}66)`
    : (showObserverInfo && isEvil)
    ? 'drop-shadow(0 0 4px rgba(239,68,68,0.6)) drop-shadow(0 0 8px rgba(239,68,68,0.3)) drop-shadow(0 2px 3px rgba(0,0,0,0.6))'
    : 'drop-shadow(0 2px 3px rgba(0,0,0,0.6))';

  return (
    <motion.div
      style={{
        position: 'absolute',
        // Use framer-motion's x/y for centering offset — CSS transform
        // gets overwritten by framer-motion's scale animation
        x: '-50%',
        y: '-50%',
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        zIndex,
        cursor: 'pointer',
        opacity: hidden ? 0 : isDead ? 0.7 : 1,
        transition: 'opacity 0.6s ease',
        pointerEvents: hidden ? 'none' : 'auto',
      }}
      animate={{
        left: `${x}%`,
        top: `${y}%`,
        scale: isSelected ? 1.15 : 1,
      }}
      transition={{
        left: { duration: segmentDuration, ease: 'linear' },
        top: { duration: segmentDuration, ease: 'linear' },
        scale: { type: 'spring', stiffness: 200 },
      }}
      onClick={onClick}
    >
      {/* DX Terminal sprite — animated GIF when moving (alive only), frozen canvas otherwise.
           Dead sprites always show frozen canvas (no feet = ghostly glide). */}
      <img
        ref={imgRef}
        src={spriteUrl(spriteId)}
        alt={agentId}
        style={{
          width: '7vw',
          minWidth: 55,
          maxWidth: 92,
          imageRendering: 'pixelated',
          filter: spriteFilter,
          transition: 'filter 0.3s',
          display: (isMoving && !isDead) ? 'block' : 'none',
        }}
      />
      <motion.canvas
        ref={canvasRef}
        animate={isDead ? {
          // Ghost: exaggerated floating wobble + vertical bob
          rotate: [0, -6, 0, 6, 0],
          y: [0, -9, -3, -12, 0],
        } : !isMoving ? {
          // Alive idle: subtle breathing
          rotate: [0, -1.5, 0, 1.5, 0],
          y: [0, -1, 0, -1, 0],
        } : {}}
        transition={(isDead || !isMoving) ? {
          duration: isDead ? 2 + seat * 0.2 : 3 + seat * 0.3,
          repeat: Infinity,
          ease: 'easeInOut',
        } : {}}
        style={{
          width: '7vw',
          minWidth: 55,
          maxWidth: 92,
          imageRendering: 'pixelated',
          filter: spriteFilter,
          transition: 'filter 0.3s',
          display: (isMoving && !isDead) ? 'none' : 'block',
        }}
      />

      {/* Name label */}
      <div style={{ textAlign: 'center', marginTop: 2, lineHeight: 1.1 }}>
        <span style={{
          background: `${color}cc`,
          padding: '1px 4px',
          borderRadius: 2,
          fontSize: 9,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}>
          {characterName || agentId}
        </span>
        <span style={{
          display: 'block',
          fontSize: 7,
          color: 'rgba(255,255,255,0.4)',
          marginTop: 1,
          whiteSpace: 'nowrap',
        }}>
          {shortModelName(modelName || agentId)}
        </span>
        {showObserverInfo && (
          <span style={{
            display: 'block',
            fontSize: 8,
            color: isEvil ? '#f87171' : 'rgba(255,255,255,0.6)',
            marginTop: 1,
          }}>
            {role}
          </span>
        )}
      </div>

      {/* Observer-mode status indicators */}
      {showObserverInfo && (
        <>
{/* Evil glow applied via filter on the sprite img above */}
          {isDrunk && (
            <motion.div
              style={{
                position: 'absolute',
                top: -28,
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: 22,
                pointerEvents: 'none',
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.6))',
                zIndex: 1,
              }}
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              {'\uD83C\uDF7A'}
            </motion.div>
          )}
          {isPoisoned && !isDrunk && (
            <motion.div
              style={{
                position: 'absolute',
                top: -30,
                left: '50%',
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.6))',
                zIndex: 1,
              }}
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <img src="/poison.png" alt="poisoned" style={{ width: 24, height: 24 }} />
            </motion.div>
          )}
          {isProtected && (
            <motion.div
              style={{
                position: 'absolute',
                top: -28,
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: 22,
                pointerEvents: 'none',
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.6))',
                zIndex: 1,
              }}
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              {'\uD83D\uDEE1\uFE0F'}
            </motion.div>
          )}
        </>
      )}

      {/* Talking indicator — bubble.png above the current speaker */}
      {isTalking && (
        <motion.div
          key={`talking-${seat}`}
          style={{
            position: 'absolute',
            top: -40,
            left: '50%',
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            zIndex: 100,
          }}
          animate={{ opacity: [1, 1, 0, 0], y: [0, -3, -3, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', times: [0, 0.5, 0.5, 1] }}
        >
          <img src="/bubble.png" alt="" style={{ width: 35, height: 35 }} />
        </motion.div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Speech bubble
// ---------------------------------------------------------------------------

interface SpeechBubble {
  seat: number;
  content: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Main TownMap
// ---------------------------------------------------------------------------

export function TownMap() {
  const gameState = useGameStore((s) => s.gameState);
  const selectedPlayer = useGameStore((s) => s.selectedPlayer);
  const selectPlayer = useGameStore((s) => s.selectPlayer);
  const showObserverInfo = useGameStore((s) => s.showObserverInfo);
  const selectGroup = useGameStore((s) => s.selectGroup);
  // Generate unique sprite IDs seeded by game ID — same game always gets same sprites
  const spriteIds = useMemo(() => {
    const id = gameState?.gameId || 'default';
    return pickSpriteIds(id, 15);
  }, [gameState?.gameId]);

  const [bubbles, setBubbles] = useState<SpeechBubble[]>([]);
  const bubblesRef = useRef<SpeechBubble[]>([]);
  const [deathNarration, setDeathNarration] = useState<string | null>(null);
  const deathTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [talkingSeats, setTalkingSeats] = useState<number[]>([]);
  const prevMsgCountRef = useRef(0);

  // Ambient video system
  const { videoRef, videoPlaying, fullscreenTakeover, gameOverReady, aboveTower, handleEnded, triggerEvent } = useAmbientVideo(
    gameState?.phase,
    gameState?.winner ?? undefined,
  );

  // Watch for death narration events
  useEffect(() => {
    if (!gameState?.messages.length) return;
    const latest = gameState.messages[gameState.messages.length - 1];

    let narration: string | null = null;

    if (latest.type === 'narration' ||
        (latest.type === 'system' && latest.content.includes('narration:'))) {
      narration = latest.content.replace('narration:', '').trim();
    } else if (latest.type === 'system' &&
        (latest.content.includes('died') ||
         latest.content.includes('EXECUTED') ||
         latest.content.includes('dead'))) {
      narration = latest.content;
    }

    if (narration) {
      setDeathNarration(narration);
      triggerEvent('execution');
      // Clear any existing timer
      if (deathTimerRef.current) clearTimeout(deathTimerRef.current);
      // Set new fade-out timer (won't be cancelled by new messages)
      deathTimerRef.current = setTimeout(() => {
        setDeathNarration(null);
        deathTimerRef.current = null;
      }, 8000);
    }
  }, [gameState?.messages.length]);

  // Speech bubbles + talking indicator from new messages
  const msgCount = gameState?.messages.length ?? 0;
  useEffect(() => {
    if (!gameState || msgCount === 0 || msgCount <= prevMsgCountRef.current) {
      prevMsgCountRef.current = msgCount;
      return;
    }

    // Process all new messages since last render
    const newMsgs = gameState.messages.slice(prevMsgCountRef.current);
    prevMsgCountRef.current = msgCount;

    let lastSpeakerSeat: number | null = null;

    for (const msg of newMsgs) {
      if (msg.senderSeat === undefined || msg.senderSeat === null) continue;

      // Add text speech bubble
      const newBubble: SpeechBubble = {
        seat: msg.senderSeat,
        content: msg.content.slice(0, 80) + (msg.content.length > 80 ? '...' : ''),
        timestamp: Date.now(),
      };
      bubblesRef.current = [
        ...bubblesRef.current.filter(b => Date.now() - b.timestamp < 5000),
        newBubble,
      ];

      lastSpeakerSeat = msg.senderSeat;
    }

    setBubbles([...bubblesRef.current]);

    // Show talking bubble.png indicator — keep last 2 speakers
    if (lastSpeakerSeat !== null) {
      setTalkingSeats(prev => {
        const filtered = prev.filter(s => s !== lastSpeakerSeat);
        const updated = [...filtered, lastSpeakerSeat];
        // Keep only the last 2
        return updated.slice(-2);
      });
    }

    // Clear old text bubbles
    const timer = setTimeout(() => {
      bubblesRef.current = bubblesRef.current.filter(b => Date.now() - b.timestamp < 5000);
      setBubbles([...bubblesRef.current]);
    }, 5000);
    return () => clearTimeout(timer);
  }, [msgCount, gameState]);

  // Compute target position for each player based on current phase
  const getTarget = useCallback((seat: number): Point => {
    if (!gameState) return TOWN_POSITIONS[seat % TOWN_POSITIONS.length];

    const phase = gameState.phase;

    // Night — scatter to buildings / edges
    if (phase === Phase.NIGHT || phase === Phase.FIRST_NIGHT) {
      return NIGHT_POSITIONS[seat % NIGHT_POSITIONS.length];
    }

    // Breakout groups — cluster near buildings
    if (phase === Phase.DAY_BREAKOUT && gameState.breakoutGroups.length > 0) {
      const groupIdx = gameState.breakoutGroups.findIndex(g =>
        g.members.includes(seat)
      );
      if (groupIdx >= 0) {
        const group = gameState.breakoutGroups[groupIdx];
        const memberIdx = group.members.indexOf(seat);
        const dest = GROUP_DESTINATIONS[groupIdx % GROUP_DESTINATIONS.length];
        const angle = (memberIdx / group.members.length) * Math.PI * 2;
        const spread = 4;
        const pos: Point = [
          dest[0] + Math.cos(angle) * spread,
          dest[1] + Math.sin(angle) * spread,
        ];
        return clampToWalkable(pos, dest);
      }
    }

    // Nominations / voting — semicircular arc in front of the clocktower
    if (phase === Phase.NOMINATIONS || phase === Phase.VOTING) {
      const aliveSeats = gameState.players
        .filter(p => p.isAlive)
        .map(p => p.seat);
      const idx = aliveSeats.indexOf(seat);
      if (idx >= 0) {
        const total = aliveSeats.length;
        // Wide arc wrapping around the front of the tower
        const t = total > 1 ? idx / (total - 1) : 0.5;
        // Spread from left path to right path, curving down in the center
        const x = 18 + t * 64;  // 18% to 82% — full width of walkable area
        const y = 62 + Math.sin(t * Math.PI) * 20;  // 62% at edges, 82% at center
        return clampToWalkable([x, y], [50, 75]);
      }
    }

    // Default — idle positions around the square
    return TOWN_POSITIONS[seat % TOWN_POSITIONS.length];
  }, [gameState?.phase, gameState?.breakoutGroups, gameState?.players]);

  // Track current positions for speech bubble placement
  const spritePositions = useRef<Map<number, Point>>(new Map());
  const getSpritePos = (seat: number): Point => {
    return spritePositions.current.get(seat) || getTarget(seat);
  };

  // Night action log — collect system/narration messages from the current night phase
  const nightLogRef = useRef<HTMLDivElement>(null);
  const nightMessages: Message[] = useMemo(() => {
    if (!gameState) return [];
    const phase = gameState.phase;
    if (phase !== Phase.NIGHT && phase !== Phase.FIRST_NIGHT) return [];
    // Gather messages that arrived during night (system or narration type)
    const msgs = gameState.messages.filter(
      (m) => m.type === 'system' || m.type === 'narrator' || m.type === 'narration',
    );
    // Show at most the last 20 night messages
    return msgs.slice(-20);
  }, [gameState?.messages.length, gameState?.phase]);

  // Auto-scroll night log
  useEffect(() => {
    if (nightLogRef.current) {
      nightLogRef.current.scrollTop = nightLogRef.current.scrollHeight;
    }
  }, [nightMessages.length]);

  if (!gameState) return null;

  const isNight = gameState.phase === Phase.NIGHT || gameState.phase === Phase.FIRST_NIGHT;

  return (
    <div style={styles.container}>
      {/* Default background — looping torch flicker video replaces static map */}
      <video
        src="/ambient/idle-default.mp4"
        autoPlay
        loop
        muted
        playsInline
        poster="/map.jpg"
        style={{
          ...styles.mapImage,
          zIndex: 0,
        }}
      />

      {/* Event/idle clip layer — fades in over the default background */}
      <video
        ref={videoRef}
        onEnded={handleEnded}
        muted
        playsInline
        style={{
          ...styles.mapImage,
          zIndex: 1,
          opacity: videoPlaying ? 1 : 0,
          transition: 'opacity 0.5s ease',
        }}
      />

      {/* Night overlay — hidden during event clips */}
      <AnimatePresence>
        {isNight && !fullscreenTakeover && (
          <motion.div
            style={styles.nightOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.55 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2 }}
          />
        )}
      </AnimatePresence>

      {/* Clocktower foreground — same dimensions as map, alpha everywhere
           except the upper tower. Sits at z-index 5 so sprites behind
           the tower (z=2) are occluded, sprites in front (z=10+) are not. */}
      <img src="/clocktower.png" alt="" style={{
        ...styles.towerForeground,
        zIndex: aboveTower ? 0 : 100,
        opacity: fullscreenTakeover ? 0 : 1,
        transition: 'opacity 0.6s ease',
      }} />

      {/* Walking sprites */}
      {gameState.players.map((player) => {
        const phase = gameState.phase;
        const isIdlePhase = phase === Phase.DAY_DISCUSSION
          || phase === Phase.DAY_REGROUP
          || phase === Phase.SETUP;
        return (
          <WalkingSprite
            key={player.seat}
            seat={player.seat}
            spriteId={spriteIds[player.seat % spriteIds.length]}
            target={getTarget(player.seat)}
            isIdle={isIdlePhase}
            isNight={isNight}
            color={getProviderColor(player.modelName || player.agentId)}
            isDead={!player.isAlive}
            isSelected={selectedPlayer === player.seat}
            isEvil={player.alignment === 'evil'}
            showObserverInfo={showObserverInfo}
            agentId={player.agentId}
            characterName={player.characterName || ''}
            modelName={player.modelName || ''}
            role={player.role || ''}
            isPoisoned={player.isPoisoned || false}
            isDrunk={player.isDrunk || false}
            isProtected={player.isProtected || false}
            isTalking={talkingSeats.includes(player.seat)}
            hidden={fullscreenTakeover}
            onClick={() => selectPlayer(
              selectedPlayer === player.seat ? null : player.seat
            )}
          />
        );
      })}

      {/* Executioner — looms behind the player currently on the block */}
      <AnimatePresence>
        {gameState.onTheBlock && (() => {
          const blockSeat = gameState.onTheBlock!.seat;
          const blockTarget = getTarget(blockSeat);
          const exeZ = spriteZIndex(blockTarget[0], blockTarget[1]) - 1;
          return (
            <motion.div
              key="executioner"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.5 }}
              style={{
                position: 'absolute',
                left: `${blockTarget[0] + 3}%`,
                top: `${blockTarget[1] - 2}%`,
                x: '-50%',
                y: '-50%',
                zIndex: exeZ,
                pointerEvents: 'none',
                filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.7))',
              }}
            >
              <motion.img
                src="/exe.png"
                alt="Executioner"
                animate={{
                  y: [0, -2, 0, -2, 0],
                }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
                style={{
                  width: '8vw',
                  minWidth: 60,
                  maxWidth: 100,
                  imageRendering: 'pixelated',
                }}
              />
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Speech bubbles */}
      <AnimatePresence>
        {bubbles.map((bubble) => {
          const pos = getSpritePos(bubble.seat);
          return (
            <motion.div
              key={`bubble-${bubble.seat}-${bubble.timestamp}`}
              style={{
                ...styles.speechBubble,
                left: `${pos[0]}%`,
                top: `${pos[1] - 10}%`,
                zIndex: 100,
              }}
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <div style={styles.bubbleContent}>{bubble.content}</div>
              <div style={styles.bubbleTail} />
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Breakout group labels */}
      {gameState.phase === Phase.DAY_BREAKOUT &&
        gameState.breakoutGroups.map((group, idx) => {
          const dest = GROUP_DESTINATIONS[idx % GROUP_DESTINATIONS.length];
          return (
            <div
              key={group.id}
              onClick={() => selectGroup(group.id)}
              style={{
                ...styles.groupLabel,
                left: `${dest[0]}%`,
                top: `${dest[1] - 8}%`,
                cursor: 'pointer',
              }}
            >
              Group {String.fromCharCode(65 + idx)}
            </div>
          );
        })}

      {/* Game Over overlay — waits for event clip to finish, then fades in */}
      {gameState.phase === Phase.GAME_OVER && gameOverReady && (
        <motion.div
          style={styles.gameOverOverlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.5 }}
        >
          <motion.div
            style={styles.gameOverCard}
            initial={{ scale: 0.8, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.8, type: 'spring' }}
          >
            <div style={styles.gameOverTitle}>
              {gameState.winner === 'good' ? 'Good Triumphs' : 'Evil Prevails'}
            </div>
            <div style={{
              ...styles.gameOverWinner,
              color: gameState.winner === 'good' ? '#4ade80' : '#f87171',
            }}>
              {(gameState.winner ?? 'unknown').toUpperCase()} WINS
            </div>
            {gameState.winCondition && (
              <div style={styles.gameOverReason}>
                {gameState.winCondition}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}

      {/* Night atmosphere text */}
      {isNight && (
        <motion.div
          style={styles.nightText}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.8, duration: 1.5, ease: 'easeOut' }}
        >
          Night falls on the village...
        </motion.div>
      )}

      {/* Accusation/Defense dramatic overlay */}
      {gameState && (
        <AccusationOverlay
          players={gameState.players}
          spriteIds={spriteIds}
        />
      )}

      {/* Death narration (storyteller flavor text) */}
      <AnimatePresence>
        {deathNarration && (
          <motion.div
            style={styles.deathNarration}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.8 }}
          >
            <div style={styles.deathNarrationText}>{deathNarration}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Night action log — parchment-style scrollable log */}
      <AnimatePresence>
        {isNight && showObserverInfo && nightMessages.length > 0 && (
          <motion.div
            style={styles.nightLog}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.5 }}
          >
            <div style={styles.nightLogHeader}>Night Actions</div>
            <div ref={nightLogRef} style={styles.nightLogBody}>
              {nightMessages.map((msg) => (
                <div key={msg.id} style={styles.nightLogEntry}>
                  {msg.content}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    borderRadius: 8,
    isolation: 'isolate',  // Force stacking context so all children z-indices sort correctly
  },
  mapImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
    position: 'absolute',
    inset: 0,
    zIndex: 1,
  },
  nightOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'linear-gradient(180deg, #080820 0%, #12082a 50%, #0a0a1e 100%)',
    pointerEvents: 'none',
    zIndex: 105,
  },
  towerForeground: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    zIndex: 100,
    pointerEvents: 'none',
  },
  speechBubble: {
    position: 'absolute',
    transform: 'translate(-50%, -100%)',
    pointerEvents: 'none',
    maxWidth: 200,
  },
  bubbleContent: {
    background: 'rgba(255,255,255,0.95)',
    color: '#1a1a2e',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 11,
    lineHeight: 1.3,
    fontWeight: 500,
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  },
  bubbleTail: {
    width: 0,
    height: 0,
    borderLeft: '6px solid transparent',
    borderRight: '6px solid transparent',
    borderTop: '6px solid rgba(255,255,255,0.95)',
    margin: '0 auto',
  },
  groupLabel: {
    position: 'absolute',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(99, 102, 241, 0.8)',
    color: 'white',
    padding: '3px 10px',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 700,
    zIndex: 150,
    letterSpacing: 1,
  },
  nightText: {
    position: 'absolute',
    top: '42%',
    left: 0,
    right: 0,
    textAlign: 'center' as const,
    color: '#e8c868',
    fontSize: 'clamp(20px, 3vw, 32px)',
    fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
    fontStyle: 'italic',
    fontWeight: 400,
    letterSpacing: '0.15em',
    textShadow: '0 0 20px rgba(232,200,104,0.5), 0 0 40px rgba(200,160,60,0.3), 0 0 80px rgba(180,140,40,0.15)',
    zIndex: 110,
    pointerEvents: 'none',
  },
  deathNarration: {
    position: 'absolute',
    bottom: '15%',
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'min(500px, 80%)',
    zIndex: 110,
    pointerEvents: 'none',
    textAlign: 'center',
  },
  deathNarrationText: {
    fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
    fontStyle: 'italic',
    fontSize: 'clamp(13px, 1.5vw, 17px)',
    lineHeight: 1.5,
    color: '#e8d4b0',
    textShadow: '0 0 12px rgba(200,160,80,0.4), 0 2px 4px rgba(0,0,0,0.8)',
    padding: '12px 20px',
    background: 'linear-gradient(180deg, rgba(30,24,15,0.85) 0%, rgba(20,16,10,0.9) 100%)',
    border: '1px solid rgba(196,162,101,0.3)',
    borderRadius: 6,
  },
  gameOverOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(10, 8, 5, 0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
  },
  gameOverCard: {
    textAlign: 'center' as const,
    padding: '40px 60px',
    background: 'linear-gradient(180deg, rgba(35,28,18,0.95) 0%, rgba(25,20,12,0.98) 100%)',
    border: '2px solid rgba(196,162,101,0.4)',
    borderRadius: 12,
    boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 0 60px rgba(196,162,101,0.1)',
  },
  gameOverTitle: {
    fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
    fontSize: 'clamp(16px, 2vw, 22px)',
    fontStyle: 'italic',
    color: '#c4a265',
    letterSpacing: '0.15em',
    marginBottom: 8,
  },
  gameOverWinner: {
    fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
    fontSize: 'clamp(28px, 4vw, 48px)',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textShadow: '0 0 20px currentColor',
    marginBottom: 12,
  },
  gameOverReason: {
    fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
    fontSize: 'clamp(12px, 1.3vw, 16px)',
    fontStyle: 'italic',
    color: '#a89070',
    maxWidth: 400,
  },
  nightLog: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    width: 'min(280px, 35%)',
    maxHeight: '40%',
    zIndex: 115,
    display: 'flex',
    flexDirection: 'column',
    background: 'linear-gradient(180deg, rgba(45,36,22,0.92) 0%, rgba(35,28,16,0.95) 100%)',
    border: '1px solid rgba(196,162,101,0.35)',
    borderRadius: 6,
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    pointerEvents: 'auto',
  },
  nightLogHeader: {
    padding: '6px 12px',
    fontSize: '0.7rem',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    color: '#e8c868',
    borderBottom: '1px solid rgba(196,162,101,0.2)',
    fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
  },
  nightLogBody: {
    flex: 1,
    overflowY: 'auto',
    padding: '4px 0',
  },
  nightLogEntry: {
    padding: '4px 12px',
    fontSize: '0.75rem',
    lineHeight: 1.4,
    color: '#d4c4a0',
    fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
    fontStyle: 'italic',
    borderBottom: '1px solid rgba(196,162,101,0.08)',
  },
};
