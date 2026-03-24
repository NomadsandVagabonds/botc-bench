import { useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../stores/gameStore.ts';
import { getAudioManifest, getAudioClipUrl } from '../api/rest.ts';
import type { AudioClip } from '../api/rest.ts';

/**
 * Audio-synced replay controller.
 *
 * Each normalized replay event carries a `_rawIndex` matching its position
 * in the original events array. The audio manifest maps `event_index` to
 * audio clips. We use this for direct lookup — no sequential counting.
 *
 * Flow:
 * 1. Apply the next replay event (visual updates immediately)
 * 2. Check if this event has an audio clip (by _rawIndex)
 * 3. If yes: play clip, wait for onended + pause, then go to 1
 * 4. If no: short delay (or instant for data events), then go to 1
 */

const TIMER_DELAYS: Record<string, number> = {
  'phase.change': 2000,
  'message.new': 1200,
  'nomination.start': 1500,
  'vote.cast': 600,
  'nomination.result': 1200,
  'execution': 2000,
  'death': 2000,
  'breakout.formed': 1000,
  'breakout.ended': 500,
  'night.action': 800,
  'player.reasoning': 0,
  'agent.tokens': 0,
  'game.over': 2500,
  'debrief.message': 1500,
  'whisper.notification': 800,
  'game.state': 0,
};

const DEFAULT_DELAY = 300;
const INTER_SPEAKER_PAUSE_MS = 1000;
const SAME_SPEAKER_PAUSE_MS = 400;

export function useReplayController() {
  const replayMode = useGameStore((s) => s.replayMode);
  const paused = useGameStore((s) => s.paused);
  const speed = useGameStore((s) => s.speed);
  const gameId = useGameStore((s) => s.gameState?.gameId);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Map from raw event index → audio clip
  const audioMapRef = useRef<Map<number, AudioClip>>(new Map());
  const audioReadyRef = useRef(false);
  const hasAudioRef = useRef(false);
  const prevSpeakerRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  const introClipRef = useRef<AudioClip | null>(null);
  const introPlayedRef = useRef(false);

  // Load audio manifest when replay starts
  useEffect(() => {
    if (!replayMode || !gameId) return;
    audioReadyRef.current = false;
    hasAudioRef.current = false;
    audioMapRef.current = new Map();
    runningRef.current = false;
    introClipRef.current = null;
    introPlayedRef.current = false;

    getAudioManifest(gameId)
      .then((manifest) => {
        const map = new Map<number, AudioClip>();
        for (const clip of manifest.clips) {
          if (clip.file && clip.event_index != null) {
            if (clip.event_index === -1) {
              // Intro clip — plays before any events
              introClipRef.current = clip;
            } else {
              map.set(clip.event_index, clip);
            }
          }
        }
        audioMapRef.current = map;
        hasAudioRef.current = map.size > 0 || introClipRef.current !== null;
        audioReadyRef.current = true;
        console.log(`[replay] Audio loaded: ${map.size} clips + ${introClipRef.current ? 'intro' : 'no intro'}`);
        // Kick the replay loop if user already clicked play while we were waiting
        const s = useGameStore.getState();
        if (s.replayMode && !s.paused && s.speed > 0 && !runningRef.current) {
          runningRef.current = true;
          step();
        }
      })
      .catch(() => {
        audioReadyRef.current = true;
        hasAudioRef.current = false;
        console.log('[replay] No audio, timer mode');
        // Kick the replay loop if user already clicked play while we were waiting
        const s = useGameStore.getState();
        if (s.replayMode && !s.paused && s.speed > 0 && !runningRef.current) {
          runningRef.current = true;
          step();
        }
      });

    return () => {
      runningRef.current = false;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [replayMode, gameId]);

  // Pause/stop audio when paused or seeking
  const replayIndex = useGameStore((s) => s.replayIndex);
  useEffect(() => {
    if (paused && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current = null;
      runningRef.current = false;
    }
  }, [paused, replayIndex]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Play a clip and call onDone when it finishes
  const playClip = (clip: AudioClip, onDone: () => void) => {
    const currentGameId = useGameStore.getState().gameState?.gameId;
    if (!clip.file || !currentGameId) { onDone(); return; }

    const url = getAudioClipUrl(currentGameId, clip.file);
    const audio = new Audio(url);
    // Apply volume settings
    const { masterVolume, voiceVolume } = useGameStore.getState();
    audio.volume = masterVolume * voiceVolume;
    audioRef.current = audio;

    audio.onended = () => {
      audioRef.current = null;
      const s = useGameStore.getState();
      if (!s.replayMode || s.paused || s.speed === 0) {
        runningRef.current = false;
        return;
      }
      const pauseMs = clip.speaker !== prevSpeakerRef.current
        ? INTER_SPEAKER_PAUSE_MS : SAME_SPEAKER_PAUSE_MS;
      prevSpeakerRef.current = clip.speaker;
      timerRef.current = setTimeout(onDone, pauseMs / s.speed);
    };
    audio.onerror = () => {
      audioRef.current = null;
      prevSpeakerRef.current = clip.speaker;
      timerRef.current = setTimeout(onDone, 200);
    };
    audio.play().catch(() => {
      audioRef.current = null;
      const delay = (clip.duration_s || 3) * 1000 / (useGameStore.getState().speed || 1);
      prevSpeakerRef.current = clip.speaker;
      timerRef.current = setTimeout(onDone, Math.max(delay, 200));
    });
  };

  // Single step: apply one event, then schedule next based on audio
  const step = () => {
    const store = useGameStore.getState();
    if (!store.replayMode || store.paused || store.speed === 0) {
      console.log('[replay-step] stopped:', { replayMode: store.replayMode, paused: store.paused, speed: store.speed });
      runningRef.current = false;
      return;
    }
    // Pause while accusation/defense overlay or death card is visible
    if (store.accusationOverlayVisible || store.deathCardVisible) {
      console.log('[replay-step] held for overlay:', { accusation: store.accusationOverlayVisible, deathCard: store.deathCardVisible });
      runningRef.current = false;
      return;
    }

    // Play intro before any events
    if (!introPlayedRef.current && introClipRef.current) {
      introPlayedRef.current = true;
      playClip(introClipRef.current, step);
      return;
    }

    const queue = store.replayQueue;
    const idx = store.replayIndex;
    if (idx >= queue.length) {
      runningRef.current = false;
      return;
    }

    // Get the event we're about to apply
    const event = queue[idx];
    const rawIndex = (event as any)._rawIndex as number | undefined;

    // Apply the event (visual updates now)
    const hasMore = store.replayNext();

    // Check for audio clip
    const clip = rawIndex != null ? audioMapRef.current.get(rawIndex) : undefined;

    if (clip?.file && hasAudioRef.current) {
      // Play audio clip, then advance when done
      playClip(clip, step);
    } else if (hasMore) {
      // No audio for this event — use timer delay or instant for data events
      if (hasAudioRef.current) {
        // In audio mode: data events advance instantly, visual events get tiny delay
        const delay = TIMER_DELAYS[event.type] ?? DEFAULT_DELAY;
        if (delay === 0) {
          // Instant — call step synchronously (batch data events)
          step();
        } else {
          // Small visual delay so the UI doesn't jump too fast
          const spd = useGameStore.getState().speed || 1;
          timerRef.current = setTimeout(step, Math.min(delay / spd, 300));
        }
      } else {
        // Timer-only mode: full delays
        const spd = useGameStore.getState().speed || 1;
        const baseDelay = TIMER_DELAYS[event.type] ?? DEFAULT_DELAY;
        timerRef.current = setTimeout(step, Math.max(baseDelay / spd, 30));
      }
    } else {
      runningRef.current = false;
    }
  };

  // Resume when accusation overlay or death card clears
  const overlayVisible = useGameStore((s) => s.accusationOverlayVisible);
  const deathCardVisible = useGameStore((s) => s.deathCardVisible);
  useEffect(() => {
    if (!overlayVisible && !deathCardVisible && replayMode && !paused && speed > 0 && !runningRef.current && audioReadyRef.current) {
      runningRef.current = true;
      timerRef.current = setTimeout(step, 500);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayVisible, deathCardVisible, replayMode, paused, speed]);

  // Start/stop the chain when play state changes
  useEffect(() => {
    console.log('[replay-ctrl] effect:', { replayMode, paused, speed, audioReady: audioReadyRef.current, running: runningRef.current });
    if (!replayMode || !audioReadyRef.current) {
      console.log('[replay-ctrl] blocked:', !replayMode ? 'not replay mode' : 'audio not ready');
      return;
    }

    if (paused || speed === 0) {
      clearTimer();
      runningRef.current = false;
      console.log('[replay-ctrl] paused');
      return;
    }

    if (!runningRef.current) {
      runningRef.current = true;
      console.log('[replay-ctrl] starting step loop');
      step();
    }

    return () => {
      clearTimer();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayMode, paused, speed, clearTimer]);
}
