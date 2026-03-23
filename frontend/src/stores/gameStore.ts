import { create } from 'zustand';
import type { DebriefMessage, GameState, MessageType, NightActionEntry, Phase } from '../types/game.ts';
import type { ServerEvent } from '../types/events.ts';
import type { MonitorPhaseAssessment, MonitorResult } from '../types/monitor.ts';

// ── Reasoning entry ─────────────────────────────────────────────────

export interface ReasoningEntry {
  reasoning: string;
  phase: Phase;
  dayNumber: number;
  timestamp: number;
}

// ── UI state types ──────────────────────────────────────────────────

export interface MessageFilter {
  types: MessageType[];
  seatFilter: number | null;
  groupFilter: string | null;
}

export interface GameStore {
  // Connection
  connected: boolean;
  gameId: string | null;

  // Game state (full snapshot from server)
  gameState: GameState | null;

  // UI state
  selectedPlayer: number | null;
  selectedGroup: string | null;
  showObserverInfo: boolean;
  messageFilter: MessageFilter;
  speed: number; // 1 = normal, 2 = 2x, 0 = paused
  paused: boolean;

  // Player reasoning cache (seat -> chronological reasoning entries)
  playerReasoning: Record<number, ReasoningEntry[]>;

  // Token tracking (seat -> cumulative)
  tokenUsage: Record<number, { prompt: number; completion: number; cost: number }>;

  // Night action log (observer mode)
  nightActions: NightActionEntry[];

  // Debrief messages (post-game reactions from agents)
  debriefMessages: DebriefMessage[];

  // All nominations across all days (never cleared — for stats)
  allNominations: import('../types/game.ts').NominationRecord[];

  // Audio volumes (0-1)
  masterVolume: number;
  voiceVolume: number;
  musicVolume: number;
  setVolumes: (master: number, voice: number, music: number) => void;

  // Replay system
  replayMode: boolean;
  replayQueue: ServerEvent[];
  replayIndex: number;
  replayTotal: number;
  replayInitialState: ServerEvent | null;

  // Theatrical pacing (live games only — buffers ALL events, not just messages)
  theatricalEventQueue: ServerEvent[];
  theatricalMode: boolean;
  theatricalHold: boolean;  // pause draining (e.g. during intro narration)
  enqueueTheatrical: (event: ServerEvent) => void;
  drainTheatricalEvent: () => ServerEvent | null;

  // Active accusation/defense overlay
  activeSpeech: {
    type: 'accusation' | 'defense';
    speakerSeat: number;
    otherSeat: number;
    content: string;
  } | null;
  accusationOverlayVisible: boolean;  // true while AccusationOverlay is actually rendering on screen

  // Live monitor streaming
  liveMonitor: {
    monitorId: string;
    model: string;
    totalPhases: number;
    phases: MonitorPhaseAssessment[];
    complete: boolean;
    result: MonitorResult | null;
  } | null;

  // Actions
  setConnected: (connected: boolean) => void;
  setGameId: (gameId: string | null) => void;
  setGameState: (state: GameState) => void;
  applyEvent: (event: ServerEvent) => void;
  startReplay: (initialState: ServerEvent, events: ServerEvent[]) => void;
  replayNext: () => boolean; // returns false when done
  replaySeekTo: (targetIndex: number) => void;
  selectPlayer: (seat: number | null) => void;
  selectGroup: (groupId: string | null) => void;
  toggleObserverInfo: () => void;
  setMessageFilter: (filter: Partial<MessageFilter>) => void;
  setSpeed: (speed: number) => void;
  togglePause: () => void;
  reset: () => void;
}

const initialMessageFilter: MessageFilter = {
  types: [],
  seatFilter: null,
  groupFilter: null,
};

export const useGameStore = create<GameStore>()((set, get) => ({
  // ── Initial state ───────────────────────────────────────────────
  connected: false,
  gameId: null,
  gameState: null,
  selectedPlayer: null,
  selectedGroup: null,
  showObserverInfo: true,
  messageFilter: initialMessageFilter,
  speed: 1,
  paused: false,
  playerReasoning: {},
  tokenUsage: {},
  nightActions: [],
  debriefMessages: [],
  allNominations: [],
  masterVolume: 0.8,
  voiceVolume: 1.0,
  musicVolume: 0.5,
  setVolumes: (master, voice, music) => set({ masterVolume: master, voiceVolume: voice, musicVolume: music }),
  replayMode: false,
  replayQueue: [],
  replayIndex: 0,
  replayTotal: 0,
  replayInitialState: null,
  theatricalEventQueue: [],
  theatricalMode: false,
  theatricalHold: false,
  activeSpeech: null, accusationOverlayVisible: false,
  liveMonitor: null,

  // ── Connection ──────────────────────────────────────────────────
  setConnected: (connected) => set({ connected }),
  setGameId: (gameId) => set({ gameId }),

  // ── Full state replacement ──────────────────────────────────────
  setGameState: (state) => set({ gameState: state }),

  // ── Incremental event application ──────────────────────────────
  applyEvent: (event) => {
    const { gameState } = get();

    switch (event.type) {
      case 'game.state': {
        set({ gameState: event.state });
        break;
      }

      case 'phase.change': {
        if (!gameState) break;
        // Preserve current dayNumber when backend omits it (e.g. nominations resume after voting)
        const effectiveDay = event.dayNumber ?? gameState.dayNumber;
        const phaseLabels: Record<string, string> = {
          first_night: '🌙 Night 0 — First Night',
          night: `🌙 Night ${effectiveDay}`,
          day_discussion: `☀️ Day ${effectiveDay} — Open Discussion`,
          day_breakout: `🗣️ Day ${effectiveDay} — Breakout Groups`,
          day_regroup: `📢 Day ${effectiveDay} — Regroup`,
          nominations: `⚖️ Day ${effectiveDay} — Nominations`,
          voting: `🗳️ Day ${effectiveDay} — Voting`,
          execution: `☠️ Day ${effectiveDay} — Execution`,
          game_over: '🏁 Game Over',
          debrief: '🎭 Post-Game Debrief',
        };
        const phaseMsg = {
          id: crypto.randomUUID(),
          type: 'system' as const,
          phaseId: '',
          senderSeat: null as number | null,
          content: phaseLabels[event.phase] ?? `Phase: ${event.phase}`,
          groupId: null as string | null,
          timestamp: Date.now(),
          phase: event.phase,
          dayNumber: effectiveDay,
        };
        const phaseUpdate: any = {
          ...gameState,
          phase: event.phase,
          dayNumber: effectiveDay,
          messages: [...gameState.messages, phaseMsg],
        };
        // Clear nominations and breakout groups on new day
        if (event.phase === 'day_discussion') {
          phaseUpdate.nominations = [];
          phaseUpdate.breakoutGroups = [];
          phaseUpdate.executedToday = null;
          phaseUpdate.nightKills = [];
          phaseUpdate.onTheBlock = null;
        }
        // Apply player status updates (poison/drunk/protected) if present
        const statuses = (event as any).playerStatuses as Array<{ seat: number; is_alive: boolean; is_poisoned: boolean; is_drunk: boolean; is_protected: boolean }> | undefined;
        if (statuses && phaseUpdate.players) {
          phaseUpdate.players = phaseUpdate.players.map((p: any) => {
            const s = statuses.find((st: any) => st.seat === p.seat);
            if (!s) return p;
            return { ...p, isAlive: s.is_alive, isPoisoned: s.is_poisoned, isDrunk: s.is_drunk, isProtected: s.is_protected };
          });
        }
        // Clear activeSpeech on phase change, EXCEPT when transitioning to voting
        // (defense overlay should persist through voting until nomination.result)
        const keepSpeech = event.phase === 'voting';
        set({ gameState: phaseUpdate, ...(keepSpeech ? {} : { activeSpeech: null }) });
        break;
      }

      case 'message.new': {
        if (!gameState) break;
        // Dedup: check ALL existing messages for content+sender+type match.
        // Messages can arrive via both live WebSocket and event.history replay
        // with different timestamps, so we match on content identity not time.
        const isDup = gameState.messages.some(
          m => m.content === event.message.content &&
               m.senderSeat === event.message.senderSeat &&
               m.type === event.message.type
        );
        if (isDup) break;
        // Stamp with current phase/day for accordion grouping
        const stamped = {
          ...event.message,
          phase: event.message.phase ?? gameState.phase,
          dayNumber: event.message.dayNumber ?? gameState.dayNumber,
        };
        // Set active speech overlay for accusation/defense
        const updates: any = {
          gameState: {
            ...gameState,
            messages: [...gameState.messages, stamped],
          },
        };
        if (stamped.type === 'accusation' || stamped.type === 'defense') {
          const latestNom = gameState.nominations[gameState.nominations.length - 1];
          const otherSeat = stamped.type === 'accusation'
            ? latestNom?.nomineeSeat ?? -1
            : latestNom?.nominatorSeat ?? -1;
          updates.activeSpeech = {
            type: stamped.type,
            speakerSeat: stamped.senderSeat,
            otherSeat,
            content: stamped.content,
          };
        }
        set(updates);
        break;
      }

      case 'whisper.notification': {
        if (!gameState) break;
        const fromPlayer = gameState.players.find(p => p.seat === (event as any).fromSeat);
        const toPlayer = gameState.players.find(p => p.seat === (event as any).toSeat);
        const fromName = fromPlayer ? `${fromPlayer.characterName || 'Seat ' + fromPlayer.seat}` : `Seat ${(event as any).fromSeat}`;
        const toName = toPlayer ? `${toPlayer.characterName || 'Seat ' + toPlayer.seat}` : `Seat ${(event as any).toSeat}`;
        const whisperContent = (event as any).whisperContent || '';
        const whisperMsg = {
          ...event.message,
          // Public notification (shown in chat)
          content: `${fromName} whispered to ${toName}`,
          // Full content for whispers tab (observer mode)
          whisperContent,
          fromSeat: (event as any).fromSeat,
          toSeat: (event as any).toSeat,
          fromName,
          toName,
        };
        set({
          gameState: {
            ...gameState,
            whispers: [...gameState.whispers, whisperMsg],
          },
        });
        break;
      }

      case 'nomination.start': {
        if (!gameState) break;
        // Dedup: skip if we already have this exact nomination
        const alreadyExists = gameState.nominations.some(
          n => n.nominatorSeat === event.nominatorSeat && n.nomineeSeat === event.nomineeSeat
        );
        if (alreadyExists) break;
        const pending: import('../types/game.ts').NominationRecord = {
          nominatorSeat: event.nominatorSeat,
          nomineeSeat: event.nomineeSeat,
          votesFor: [],
          votesAgainst: [],
          passed: false,
          outcome: null,
        };
        const nomMsg = {
          id: crypto.randomUUID(),
          type: 'system' as const,
          phaseId: '',
          senderSeat: null as number | null,
          content: (() => {
            const nominator = gameState.players.find(p => p.seat === event.nominatorSeat);
            const nominee = gameState.players.find(p => p.seat === event.nomineeSeat);
            const nominatorName = nominator?.characterName || `Seat ${event.nominatorSeat}`;
            const nomineeName = nominee?.characterName || `Seat ${event.nomineeSeat}`;
            return `${nominatorName} nominates ${nomineeName} for execution.`;
          })(),
          groupId: null as string | null,
          timestamp: Date.now(),
          phase: gameState.phase,
          dayNumber: gameState.dayNumber,
        };
        set({
          gameState: {
            ...gameState,
            nominations: [...gameState.nominations, pending],
            messages: [...gameState.messages, nomMsg],
          },
          allNominations: [...get().allNominations, { ...pending }],
        });
        break;
      }

      case 'vote.cast': {
        if (!gameState) break;
        const noms = [...gameState.nominations];
        const current = noms.findLast(
          (n) => n.nomineeSeat === event.nomineeSeat,
        );
        if (current) {
          if (event.vote) {
            current.votesFor = [...current.votesFor, event.voterSeat];
          } else {
            current.votesAgainst = [...current.votesAgainst, event.voterSeat];
          }
        }
        const voteMsg = {
          id: crypto.randomUUID(),
          type: 'system' as const,
          phaseId: '',
          senderSeat: null as number | null,
          content: (() => {
            const voter = gameState.players.find(p => p.seat === event.voterSeat);
            const nominee = gameState.players.find(p => p.seat === event.nomineeSeat);
            const voterName = voter?.characterName || `Seat ${event.voterSeat}`;
            const nomineeName = nominee?.characterName || `Seat ${event.nomineeSeat}`;
            return `${voterName} votes ${event.vote ? 'YES' : 'NO'} on ${nomineeName}.`;
          })(),
          groupId: null as string | null,
          timestamp: Date.now(),
          phase: gameState.phase,
          dayNumber: gameState.dayNumber,
        };
        // Also update allNominations
        const allNoms = [...get().allNominations];
        const allCurrent = allNoms.findLast(
          (n) => n.nomineeSeat === event.nomineeSeat && n.nominatorSeat === current?.nominatorSeat,
        );
        if (allCurrent) {
          if (event.vote) {
            allCurrent.votesFor = [...allCurrent.votesFor, event.voterSeat];
          } else {
            allCurrent.votesAgainst = [...allCurrent.votesAgainst, event.voterSeat];
          }
        }
        // Update ghost vote status if included in the event
        let updatedPlayers = gameState.players;
        if ((event as any).ghost_vote_used === true) {
          updatedPlayers = gameState.players.map(p =>
            p.seat === event.voterSeat ? { ...p, ghostVoteUsed: true } : p
          );
        }
        set({ gameState: { ...gameState, players: updatedPlayers, nominations: noms, messages: [...gameState.messages, voteMsg] }, allNominations: allNoms });
        break;
      }

      case 'nomination.result': {
        if (!gameState) break;
        const nrEvent = event as import('../types/events.ts').NominationResultEvent;
        // Replace the last nomination for this nominee with the final result.
        const updated = gameState.nominations.map((n) =>
          n.nominatorSeat === nrEvent.nomination.nominatorSeat &&
          n.nomineeSeat === nrEvent.nomination.nomineeSeat
            ? nrEvent.nomination
            : n,
        );
        // Update on-the-block tracking
        const newOnTheBlock: import('../types/game.ts').OnTheBlock | null =
          nrEvent.onTheBlock != null && nrEvent.onTheBlockVotes != null
            ? { seat: nrEvent.onTheBlock, voteCount: nrEvent.onTheBlockVotes }
            : null;
        set({ gameState: { ...gameState, nominations: updated, onTheBlock: newOnTheBlock }, activeSpeech: null });
        break;
      }

      case 'execution': {
        if (!gameState) break;
        const players = gameState.players.map((p) =>
          p.seat === event.seat ? {
            ...p,
            isAlive: false,
            deathCause: (event as any).deathCause ?? 'executed',
            deathDay: (event as any).deathDay ?? gameState.dayNumber,
            deathPhase: (event as any).deathPhase ?? 'day',
          } : p,
        );
        const execPlayer = gameState.players.find(p => p.seat === event.seat);
        const execMsg = {
          id: crypto.randomUUID(),
          type: 'system' as const,
          phaseId: '',
          senderSeat: null as number | null,
          content: `⚖️ ${execPlayer?.characterName ?? execPlayer?.agentId ?? 'Seat ' + event.seat} (${event.role}) has been EXECUTED.`,
          groupId: null as string | null,
          timestamp: Date.now(),
          phase: gameState.phase,
          dayNumber: gameState.dayNumber,
        };
        set({
          gameState: {
            ...gameState,
            players,
            executedToday: event.seat,
            messages: [...gameState.messages, execMsg],
          },
        });
        break;
      }

      case 'death': {
        if (!gameState) break;
        const afterDeath = gameState.players.map((p) =>
          p.seat === event.seat ? {
            ...p,
            isAlive: false,
            deathCause: (event as any).deathCause ?? event.cause,
            deathDay: (event as any).deathDay ?? gameState.dayNumber,
            deathPhase: (event as any).deathPhase ?? (event.cause === 'night_kill' || event.cause === 'demon_kill' ? 'night' : 'day'),
          } : p,
        );
        // Don't create a death message here — the backend already sends a
        // narration via message.new, so adding one here causes duplicates.
        set({
          gameState: {
            ...gameState,
            players: afterDeath,
            nightKills: [...gameState.nightKills, event.seat],
          },
        });
        break;
      }

      case 'resurrection': {
        if (!gameState) break;
        const afterResurrection = gameState.players.map((p) =>
          p.seat === event.seat ? {
            ...p,
            isAlive: true,
            deathCause: null,
            deathDay: null,
            deathPhase: null,
          } : p,
        );
        set({
          gameState: {
            ...gameState,
            players: afterResurrection,
            nightKills: gameState.nightKills.filter((seat) => seat !== event.seat),
          },
        });
        break;
      }

      case 'breakout.formed': {
        if (!gameState) break;
        set({
          gameState: {
            ...gameState,
            breakoutGroups: [
              ...gameState.breakoutGroups,
              ...event.groups,
            ],
          },
        });
        break;
      }

      case 'breakout.ended': {
        // We keep them in history; UI can filter by roundNumber.
        break;
      }

      case 'night.action': {
        // Dedup: skip if we already have an entry with same seat+day+action
        // (can arrive via both live WebSocket and event.history)
        const existingNA = get().nightActions;
        const isDupNA = existingNA.some(
          e => e.seat === event.seat && e.day === event.day && e.action === event.action
        );
        if (isDupNA) break;
        const entry: NightActionEntry = {
          seat: event.seat,
          name: event.name,
          role: event.role,
          roleId: event.roleId,
          action: event.action,
          targetSeat: event.targetSeat,
          targetName: event.targetName,
          effect: event.effect,
          day: event.day,
          timestamp: Date.now(),
        };
        set({ nightActions: [...get().nightActions, entry] });
        break;
      }

      case 'player.reasoning': {
        const prevEntries = get().playerReasoning[event.seat] ?? [];
        // Dedup: skip if we already have an entry with the same reasoning text
        // for this seat (can arrive via both live WebSocket and event.history)
        const isDupReasoning = prevEntries.some(
          e => e.reasoning === event.reasoning
        );
        if (isDupReasoning) break;
        const gs = get().gameState;
        const entry: ReasoningEntry = {
          reasoning: event.reasoning,
          phase: event.phase || gs?.phase || 'setup',
          dayNumber: gs?.dayNumber ?? 0,
          timestamp: Date.now(),
        };
        set({
          playerReasoning: {
            ...get().playerReasoning,
            [event.seat]: [...prevEntries, entry],
          },
        });
        break;
      }

      case 'agent.tokens': {
        const prev = get().tokenUsage[event.seat] ?? {
          prompt: 0,
          completion: 0,
          cost: 0,
        };
        set({
          tokenUsage: {
            ...get().tokenUsage,
            [event.seat]: {
              prompt: prev.prompt + event.promptTokens,
              completion: prev.completion + event.completionTokens,
              cost: prev.cost + event.totalCost,
            },
          },
        });
        break;
      }

      case 'game.over': {
        if (!gameState) break;
        const winMsg = {
          id: crypto.randomUUID(),
          type: 'system' as const,
          phaseId: '',
          senderSeat: null as number | null,
          content: `🏁 GAME OVER — ${(event.winner ?? 'unknown').toUpperCase()} WINS! ${event.winCondition ?? ''}`,
          groupId: null as string | null,
          timestamp: Date.now(),
          phase: 'game_over' as const,
          dayNumber: gameState.dayNumber,
        };
        set({
          gameState: {
            ...gameState,
            phase: 'game_over',
            winner: event.winner,
            winCondition: event.winCondition,
            messages: [...gameState.messages, winMsg],
          },
        });
        break;
      }

      case 'debrief.message': {
        const debriefMsg: DebriefMessage = {
          seat: event.seat,
          agentId: event.agentId,
          characterName: event.characterName,
          role: event.role,
          alignment: event.alignment,
          content: event.content,
          survived: event.survived,
        };
        set({
          debriefMessages: [...get().debriefMessages, debriefMsg],
        });
        // Also update phase to debrief if not already
        if (gameState && gameState.phase !== 'debrief') {
          set({
            gameState: { ...get().gameState!, phase: 'debrief' },
          });
        }
        break;
      }

      case 'monitor.started': {
        const e = event as any;
        set({
          liveMonitor: {
            monitorId: e.monitor_id ?? '',
            model: e.model ?? '',
            totalPhases: e.total_phases ?? 0,
            phases: [],
            complete: false,
            result: null,
          },
        });
        break;
      }

      case 'monitor.phase': {
        const e = event as any;
        const prev = get().liveMonitor;
        if (!prev) break;
        const phase: MonitorPhaseAssessment = {
          phase: e.phase ?? '',
          day: e.day ?? 0,
          analysis: e.analysis ?? '',
          ratings: e.ratings ?? {},
          bets: e.bets ?? [],
        };
        set({
          liveMonitor: {
            ...prev,
            phases: [...prev.phases, phase],
          },
        });
        break;
      }

      case 'monitor.complete': {
        const e = event as any;
        const prev = get().liveMonitor;
        if (!prev) break;
        set({
          liveMonitor: {
            ...prev,
            complete: true,
            result: e as MonitorResult,
          },
        });
        break;
      }

      case 'event.history': {
        // Batch-replay all historical events in a single state update to
        // avoid triggering N re-renders when a client connects mid-game.
        const historyEvents = (event as import('../types/events.ts').EventHistoryEvent).events;
        if (!historyEvents || historyEvents.length === 0) break;

        // If we don't have gameState yet, look for a game.state event in history
        // (saved games loaded from disk may not have a separate game.state message)
        let baseState = gameState;
        if (!baseState) {
          const stateEvt = historyEvents.find((e: any) => e.type === 'game.state');
          if (stateEvt) {
            baseState = (stateEvt as any).state;
            // Also set it immediately so subsequent logic works
            set({ gameState: baseState });
          }
        }
        if (!baseState) break;

        // Mutable accumulators — build up state, then commit once.
        const msgs: typeof baseState.messages = [...baseState.messages];
        let hPlayers = [...baseState.players];
        let hNominations = [...baseState.nominations];
        const hAllNominations: import('../types/game.ts').NominationRecord[] = [...get().allNominations];
        let hOnTheBlock: import('../types/game.ts').OnTheBlock | null = baseState.onTheBlock;
        const hGroups = [...baseState.breakoutGroups];
        const hWhispers = [...baseState.whispers];
        const hNightKills = [...baseState.nightKills];
        let hPhase = baseState.phase;
        let hDay = baseState.dayNumber;
        let hExecuted = baseState.executedToday;
        let hWinner = baseState.winner;
        let hWinCondition = baseState.winCondition;
        const hReasoning: Record<number, ReasoningEntry[]> = { ...get().playerReasoning };
        const hTokens: Record<number, { prompt: number; completion: number; cost: number }> = { ...get().tokenUsage };
        const hNightActions: NightActionEntry[] = [...get().nightActions];
        const hDebrief: DebriefMessage[] = [...get().debriefMessages];

        const makePhaseLabel = (p: string, d: number): string => {
          const map: Record<string, string> = {
            first_night: '\uD83C\uDF19 Night 0 \u2014 First Night',
            night: `\uD83C\uDF19 Night ${d}`,
            day_discussion: `\u2600\uFE0F Day ${d} \u2014 Open Discussion`,
            day_breakout: `\uD83D\uDDE3\uFE0F Day ${d} \u2014 Breakout Groups`,
            day_regroup: `\uD83D\uDCE2 Day ${d} \u2014 Regroup`,
            nominations: `\u2696\uFE0F Day ${d} \u2014 Nominations`,
            voting: `\uD83D\uDDF3\uFE0F Day ${d} \u2014 Voting`,
            execution: `\u2620\uFE0F Day ${d} \u2014 Execution`,
            game_over: '\uD83C\uDFC1 Game Over',
            debrief: '\uD83C\uDFAD Post-Game Debrief',
          };
          return map[p] ?? `Phase: ${p}`;
        };

        for (const evt of historyEvents) {
          switch (evt.type) {
            case 'game.state':
              // Already extracted as baseState above — skip during replay
              break;
            case 'phase.change': {
              const pc = evt as import('../types/events.ts').PhaseChangeEvent;
              hPhase = pc.phase;
              // Preserve previous day when backend omits dayNumber (e.g. nominations resume)
              if (pc.dayNumber != null) hDay = pc.dayNumber;
              msgs.push({
                id: crypto.randomUUID(),
                type: 'system' as const,
                phaseId: '',
                senderSeat: null,
                content: makePhaseLabel(pc.phase, hDay),
                groupId: null,
                timestamp: Date.now(),
                phase: pc.phase,
                dayNumber: hDay,
              } as any);
              if (pc.phase === 'day_discussion') {
                hNominations = [];
                hOnTheBlock = null;
                hGroups.length = 0;
                hExecuted = null;
                hNightKills.length = 0;
              }
              // Apply player status updates (poison/drunk/protected)
              const pStatuses = (pc as any).playerStatuses as Array<{ seat: number; is_alive: boolean; is_poisoned: boolean; is_drunk: boolean; is_protected: boolean }> | undefined;
              if (pStatuses) {
                hPlayers = hPlayers.map(p => {
                  const s = pStatuses.find(st => st.seat === p.seat);
                  if (!s) return p;
                  return { ...p, isAlive: s.is_alive, isPoisoned: s.is_poisoned, isDrunk: s.is_drunk, isProtected: s.is_protected };
                });
              }
              break;
            }
            case 'message.new': {
              const mn = evt as import('../types/events.ts').MessageNewEvent;
              const mnType = mn.message.type;
              // Dedup: skip if this private_info/narration message already
              // exists (e.g. arrived via live WebSocket before history replay)
              if (mnType === 'private_info' || mnType === 'narration') {
                const alreadyHave = msgs.some(
                  m => m.content === mn.message.content &&
                       m.senderSeat === mn.message.senderSeat &&
                       m.type === mnType
                );
                if (alreadyHave) break;
              }
              msgs.push({
                ...mn.message,
                phase: (mn.message as any).phase ?? hPhase,
                dayNumber: (mn.message as any).dayNumber ?? hDay,
              } as any);
              break;
            }
            case 'whisper.notification': {
              const wn = evt as any;
              const fromP = hPlayers.find(p => p.seat === wn.fromSeat);
              const toP = hPlayers.find(p => p.seat === wn.toSeat);
              const fName = fromP ? (fromP.characterName || `Seat ${fromP.seat}`) : `Seat ${wn.fromSeat}`;
              const tName = toP ? (toP.characterName || `Seat ${toP.seat}`) : `Seat ${wn.toSeat}`;
              hWhispers.push({
                ...wn.message,
                content: `${fName} whispered to ${tName}`,
                whisperContent: wn.whisperContent || '',
                fromSeat: wn.fromSeat,
                toSeat: wn.toSeat,
                fromName: fName,
                toName: tName,
              });
              break;
            }
            case 'nomination.start': {
              const ns = evt as import('../types/events.ts').NominationStartEvent;
              const exists = hNominations.some(
                n => n.nominatorSeat === ns.nominatorSeat && n.nomineeSeat === ns.nomineeSeat
              );
              const newNom = {
                nominatorSeat: ns.nominatorSeat,
                nomineeSeat: ns.nomineeSeat,
                votesFor: [] as number[],
                votesAgainst: [] as number[],
                passed: false,
                outcome: null as string | null,
              };
              if (!exists) {
                hNominations.push(newNom);
                msgs.push({
                  id: crypto.randomUUID(),
                  type: 'system' as const,
                  phaseId: '',
                  senderSeat: null,
                  content: `Seat ${ns.nominatorSeat} nominates Seat ${ns.nomineeSeat} for execution.`,
                  groupId: null,
                  timestamp: Date.now(),
                  phase: hPhase,
                  dayNumber: hDay,
                } as any);
              }
              // Always add to allNominations (never cleared between days)
              hAllNominations.push({ ...newNom });
              break;
            }
            case 'vote.cast': {
              const vc = evt as import('../types/events.ts').VoteCastEvent;
              const nom = [...hNominations].reverse().find(n => n.nomineeSeat === vc.nomineeSeat);
              if (nom) {
                if (vc.vote) {
                  nom.votesFor = [...nom.votesFor, vc.voterSeat];
                } else {
                  nom.votesAgainst = [...nom.votesAgainst, vc.voterSeat];
                }
              }
              // Also update allNominations
              const allNom = [...hAllNominations].reverse().find(n => n.nomineeSeat === vc.nomineeSeat);
              if (allNom) {
                if (vc.vote) {
                  allNom.votesFor = [...allNom.votesFor, vc.voterSeat];
                } else {
                  allNom.votesAgainst = [...allNom.votesAgainst, vc.voterSeat];
                }
              }
              msgs.push({
                id: crypto.randomUUID(),
                type: 'system' as const,
                phaseId: '',
                senderSeat: null,
                content: `Seat ${vc.voterSeat} votes ${vc.vote ? 'YES' : 'NO'} on Seat ${vc.nomineeSeat}.`,
                groupId: null,
                timestamp: Date.now(),
                phase: hPhase,
                dayNumber: hDay,
              } as any);
              break;
            }
            case 'nomination.result': {
              const nr = evt as import('../types/events.ts').NominationResultEvent;
              hNominations = hNominations.map(n =>
                n.nominatorSeat === nr.nomination.nominatorSeat &&
                n.nomineeSeat === nr.nomination.nomineeSeat
                  ? nr.nomination
                  : n,
              );
              hOnTheBlock = nr.onTheBlock != null && nr.onTheBlockVotes != null
                ? { seat: nr.onTheBlock, voteCount: nr.onTheBlockVotes }
                : null;
              break;
            }
            case 'execution': {
              const ex = evt as import('../types/events.ts').ExecutionEvent;
              const execP = hPlayers.find(p => p.seat === ex.seat);
              hPlayers = hPlayers.map(p => p.seat === ex.seat ? {
                ...p, isAlive: false,
                deathCause: (ex as any).deathCause ?? 'executed',
                deathDay: (ex as any).deathDay ?? hDay,
                deathPhase: (ex as any).deathPhase ?? 'day',
              } : p);
              hExecuted = ex.seat;
              msgs.push({
                id: crypto.randomUUID(),
                type: 'system' as const,
                phaseId: '',
                senderSeat: null,
                content: `\u2696\uFE0F ${execP?.agentId ?? 'Seat ' + ex.seat} (${ex.role}) has been EXECUTED.`,
                groupId: null,
                timestamp: Date.now(),
                phase: hPhase,
                dayNumber: hDay,
              } as any);
              break;
            }
            case 'death': {
              const de = evt as import('../types/events.ts').DeathEvent;
              hPlayers = hPlayers.map(p => p.seat === de.seat ? {
                ...p, isAlive: false,
                deathCause: (de as any).deathCause ?? de.cause,
                deathDay: (de as any).deathDay ?? hDay,
                deathPhase: (de as any).deathPhase ?? (de.cause === 'night_kill' || de.cause === 'demon_kill' ? 'night' : 'day'),
              } : p);
              hNightKills.push(de.seat);
              // Don't push a death message — the backend already sends a
              // narration via message.new, so adding one here causes duplicates.
              break;
            }
            case 'resurrection': {
              const rs = evt as import('../types/events.ts').ResurrectionEvent;
              hPlayers = hPlayers.map(p => p.seat === rs.seat ? {
                ...p,
                isAlive: true,
                deathCause: null,
                deathDay: null,
                deathPhase: null,
              } : p);
              const idx = hNightKills.lastIndexOf(rs.seat);
              if (idx >= 0) hNightKills.splice(idx, 1);
              break;
            }
            case 'breakout.formed': {
              const bf = evt as import('../types/events.ts').BreakoutFormedEvent;
              hGroups.push(...bf.groups);
              break;
            }
            case 'night.action': {
              const na = evt as import('../types/events.ts').NightActionEvent;
              // Dedup: skip if same seat+day+action already present
              const dupNA = hNightActions.some(
                e => e.seat === na.seat && e.day === na.day && e.action === na.action
              );
              if (!dupNA) {
                hNightActions.push({
                  seat: na.seat,
                  name: na.name,
                  role: na.role,
                  roleId: na.roleId,
                  action: na.action,
                  targetSeat: na.targetSeat,
                  targetName: na.targetName,
                  effect: na.effect,
                  day: na.day,
                  timestamp: Date.now(),
                });
              }
              break;
            }
            case 'player.reasoning': {
              const pr = evt as import('../types/events.ts').PlayerReasoningEvent;
              const prevR = hReasoning[pr.seat] ?? [];
              // Dedup: skip if we already have an entry with the same reasoning text
              const dupR = prevR.some(e => e.reasoning === pr.reasoning);
              if (!dupR) {
                prevR.push({
                  reasoning: pr.reasoning,
                  phase: pr.phase || hPhase,
                  dayNumber: hDay,
                  timestamp: Date.now(),
                });
                hReasoning[pr.seat] = prevR;
              }
              break;
            }
            case 'agent.tokens': {
              const at = evt as import('../types/events.ts').AgentTokensEvent;
              const prevT = hTokens[at.seat] ?? { prompt: 0, completion: 0, cost: 0 };
              hTokens[at.seat] = {
                prompt: prevT.prompt + at.promptTokens,
                completion: prevT.completion + at.completionTokens,
                cost: prevT.cost + at.totalCost,
              };
              break;
            }
            case 'game.over': {
              const go = evt as import('../types/events.ts').GameOverEvent;
              hWinner = go.winner;
              hWinCondition = go.winCondition;
              msgs.push({
                id: crypto.randomUUID(),
                type: 'system' as const,
                phaseId: '',
                senderSeat: null,
                content: `\uD83C\uDFC1 GAME OVER \u2014 ${(go.winner ?? 'unknown').toUpperCase()} WINS! ${go.winCondition ?? ''}`,
                groupId: null,
                timestamp: Date.now(),
                phase: 'game_over',
                dayNumber: hDay,
              } as any);
              break;
            }
            case 'debrief.message': {
              const dm = evt as import('../types/events.ts').DebriefMessageEvent;
              hDebrief.push({
                seat: dm.seat,
                agentId: dm.agentId,
                characterName: dm.characterName,
                role: dm.role,
                alignment: dm.alignment,
                content: dm.content,
                survived: dm.survived,
                timestamp: Date.now(),
              });
              break;
            }
            default:
              break;
          }
        }

        // Single batched state update — one re-render for the entire history.
        set({
          gameState: {
            ...baseState,
            phase: hPhase,
            dayNumber: hDay,
            players: hPlayers,
            messages: msgs,
            nominations: hNominations,
            onTheBlock: hOnTheBlock,
            breakoutGroups: hGroups,
            whispers: hWhispers,
            nightKills: hNightKills,
            executedToday: hExecuted,
            winner: hWinner,
            winCondition: hWinCondition,
          },
          playerReasoning: hReasoning,
          tokenUsage: hTokens,
          nightActions: hNightActions,
          debriefMessages: hDebrief,
          allNominations: hAllNominations,
        });
        console.log(`[ws] Replayed ${historyEvents.length} historical events`);
        break;
      }
    }
  },

  // ── UI actions ──────────────────────────────────────────────────
  selectPlayer: (seat) => set({ selectedPlayer: seat }),
  selectGroup: (groupId) => set({ selectedGroup: groupId }),
  toggleObserverInfo: () =>
    set((s) => ({ showObserverInfo: !s.showObserverInfo })),
  setMessageFilter: (filter) =>
    set((s) => ({
      messageFilter: { ...s.messageFilter, ...filter },
    })),
  setSpeed: (speed) => set({ speed, paused: speed === 0 }),
  togglePause: () =>
    set((s) => ({
      paused: !s.paused,
      speed: s.paused ? (s.speed === 0 ? 1 : s.speed) : 0,
    })),

  // ── Theatrical pacing ───────────────────────────────────────────
  enqueueTheatrical: (event) => {
    set({ theatricalEventQueue: [...get().theatricalEventQueue, event] });
  },
  drainTheatricalEvent: () => {
    const queue = get().theatricalEventQueue;
    if (queue.length === 0) return null;
    const [next, ...rest] = queue;
    set({ theatricalEventQueue: rest });
    get().applyEvent(next);
    return next;
  },

  // ── Replay ──────────────────────────────────────────────────────
  startReplay: (initialState, events) => {
    // Apply initial state but override to setup phase (not game_over)
    // so the replay starts from the beginning visually
    const cleanState = {
      ...initialState,
      state: {
        ...(initialState as any).state,
        phase: 'setup',
        dayNumber: 0,
        winner: undefined,
        winCondition: undefined,
        // Reset all players to alive for visual start
        players: ((initialState as any).state?.players ?? []).map((p: any) => ({
          ...p,
          isAlive: true,
        })),
        messages: [],
        nominations: [],
        nightKills: [],
        executedToday: undefined,
      },
    };
    get().applyEvent(cleanState);
    set({
      replayMode: true,
      replayQueue: events,
      replayIndex: 0,
      replayTotal: events.length,
      replayInitialState: cleanState,
      paused: true, // Start paused so user can hit play
      speed: 1,
      theatricalEventQueue: [],
      theatricalMode: false, theatricalHold: false,
    });
  },

  replayNext: () => {
    const { replayQueue, replayIndex } = get();
    if (replayIndex >= replayQueue.length) {
      set({ replayMode: false });
      return false;
    }
    const event = replayQueue[replayIndex];
    get().applyEvent(event);
    set({ replayIndex: replayIndex + 1 });
    return replayIndex + 1 < replayQueue.length;
  },

  replaySeekTo: (targetIndex: number) => {
    const { replayQueue, replayInitialState } = get();
    if (!replayInitialState || !replayQueue.length) return;

    const clamped = Math.max(0, Math.min(targetIndex, replayQueue.length));

    // Reset to initial state
    get().applyEvent(replayInitialState);
    // Clear accumulated state
    set({
      playerReasoning: {},
      tokenUsage: {},
      nightActions: [],
      debriefMessages: [],
      allNominations: [],
    });

    // Re-apply events up to target
    for (let i = 0; i < clamped; i++) {
      get().applyEvent(replayQueue[i]);
    }
    set({ replayIndex: clamped, paused: true });
  },

  // ── Reset ───────────────────────────────────────────────────────
  reset: () =>
    set({
      connected: false,
      gameId: null,
      gameState: null,
      selectedPlayer: null,
      selectedGroup: null,
      showObserverInfo: true,
      messageFilter: initialMessageFilter,
      speed: 1,
      paused: false,
      playerReasoning: {},
      tokenUsage: {},
      nightActions: [],
      debriefMessages: [],
      allNominations: [],
      replayMode: false,
      replayQueue: [],
      replayIndex: 0,
      replayTotal: 0,
      replayInitialState: null,
      theatricalEventQueue: [],
      theatricalMode: false, theatricalHold: false,
      activeSpeech: null, accusationOverlayVisible: false,
      liveMonitor: null,
    }),
}));
