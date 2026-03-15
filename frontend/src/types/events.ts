import type { Alignment, GameState, Message, NominationRecord, Phase } from './game.ts';

// ── Individual event payloads ───────────────────────────────────────

export interface GameStateEvent {
  type: 'game.state';
  state: GameState;
}

export interface PhaseChangeEvent {
  type: 'phase.change';
  phase: Phase;
  /** May be undefined when backend omits it (e.g. nominations resume after voting). */
  dayNumber?: number;
}

export interface MessageNewEvent {
  type: 'message.new';
  message: Message;
}

export interface WhisperNotificationEvent {
  type: 'whisper.notification';
  message: Message;
}

export interface NominationStartEvent {
  type: 'nomination.start';
  nominatorSeat: number;
  nomineeSeat: number;
}

export interface VoteCastEvent {
  type: 'vote.cast';
  voterSeat: number;
  nomineeSeat: number;
  vote: boolean;
}

export interface NominationResultEvent {
  type: 'nomination.result';
  nomination: NominationRecord;
  /** Seat of whoever is currently on the block (null if nobody). */
  onTheBlock: number | null;
  /** Vote count of the current block holder. */
  onTheBlockVotes: number | null;
}

export interface ExecutionEvent {
  type: 'execution';
  seat: number;
  role: string;
}

export interface DeathEvent {
  type: 'death';
  seat: number;
  cause: string;
  deathCause?: string;   // "executed" | "demon_kill" | "slayer_shot"
  deathDay?: number;
  deathPhase?: string;   // "day" | "night"
}

export interface NightActionEvent {
  type: 'night.action';
  seat: number;
  name: string;
  role: string;
  roleId: string;
  action: string;
  targetSeat: number | null;
  targetName: string | null;
  effect: string;
  day: number;
}

export interface BreakoutFormedEvent {
  type: 'breakout.formed';
  groups: { id: string; roundNumber: number; members: number[] }[];
}

export interface BreakoutEndedEvent {
  type: 'breakout.ended';
  roundNumber: number;
}

export interface PlayerReasoningEvent {
  type: 'player.reasoning';
  seat: number;
  reasoning: string;
  phase: Phase;
}

export interface AgentTokensEvent {
  type: 'agent.tokens';
  seat: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
}

export interface GameOverEvent {
  type: 'game.over';
  winner: Alignment;
  winCondition: string;
}

export interface DebriefMessageEvent {
  type: 'debrief.message';
  seat: number;
  agentId: string;
  characterName?: string;
  role: string;
  alignment: Alignment;
  content: string;
  survived: boolean;
}

export interface EventHistoryEvent {
  type: 'event.history';
  events: ServerEvent[];
}

// ── Union type ──────────────────────────────────────────────────────

export type ServerEvent =
  | GameStateEvent
  | PhaseChangeEvent
  | MessageNewEvent
  | WhisperNotificationEvent
  | NominationStartEvent
  | VoteCastEvent
  | NominationResultEvent
  | ExecutionEvent
  | DeathEvent
  | NightActionEvent
  | BreakoutFormedEvent
  | BreakoutEndedEvent
  | PlayerReasoningEvent
  | AgentTokensEvent
  | GameOverEvent
  | DebriefMessageEvent
  | EventHistoryEvent;
