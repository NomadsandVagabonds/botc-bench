// ── Const-object enums ──────────────────────────────────────────────

export const Alignment = { GOOD: 'good', EVIL: 'evil' } as const;
export type Alignment = (typeof Alignment)[keyof typeof Alignment];

export const Phase = {
  SETUP: 'setup',
  FIRST_NIGHT: 'first_night',
  DAY_DISCUSSION: 'day_discussion',
  DAY_BREAKOUT: 'day_breakout',
  DAY_REGROUP: 'day_regroup',
  NOMINATIONS: 'nominations',
  VOTING: 'voting',
  EXECUTION: 'execution',
  NIGHT: 'night',
  GAME_OVER: 'game_over',
  DEBRIEF: 'debrief',
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export const RoleType = {
  TOWNSFOLK: 'townsfolk',
  OUTSIDER: 'outsider',
  MINION: 'minion',
  DEMON: 'demon',
} as const;
export type RoleType = (typeof RoleType)[keyof typeof RoleType];

export const MessageType = {
  PUBLIC: 'public',
  WHISPER: 'whisper',
  SYSTEM: 'system',
  NARRATOR: 'narrator',
  BREAKOUT: 'breakout',
  ACCUSATION: 'accusation',
  DEFENSE: 'defense',
  PRIVATE_INFO: 'private_info',
  NARRATION: 'narration',
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

// ── Model providers ─────────────────────────────────────────────────

export const ModelProvider = {
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  GOOGLE: 'google',
} as const;
export type ModelProvider = (typeof ModelProvider)[keyof typeof ModelProvider];

export const MODEL_COLORS: Record<string, string> = {
  anthropic: '#D97706',
  openai: '#10B981',
  google: '#3B82F6',
};

// ── Core interfaces ─────────────────────────────────────────────────

export interface Player {
  seat: number;
  agentId: string;
  /** Medieval character name assigned during setup (primary display name). */
  characterName: string;
  /** Model identifier (e.g., "claude-haiku-4-5-20251001") for provider color coding. */
  modelName: string;
  role: string;
  roleType: RoleType;
  alignment: Alignment;
  isAlive: boolean;
  ghostVoteUsed: boolean;
  isPoisoned: boolean;
  isDrunk: boolean;
  isProtected: boolean;
  /** Role as perceived by this player (may differ due to poisoning / drunk). */
  perceivedRole: string | null;
  /** Seat number of the Butler's chosen master, if applicable. */
  butlerMaster: number | null;
  /** Death metadata — populated when the player dies. */
  deathCause?: string | null;   // "executed" | "demon_kill" | "slayer_shot"
  deathDay?: number | null;
  deathPhase?: string | null;   // "day" | "night"
}

export interface Message {
  id: string;
  type: MessageType;
  phaseId: string;
  senderSeat: number | null;
  content: string;
  /** Present for breakout / whisper messages. */
  groupId: string | null;
  timestamp: number;
  /** Phase when this message was created (for accordion grouping). */
  phase?: Phase;
  /** Day number when this message was created (for accordion grouping). */
  dayNumber?: number;
  /** Internal reasoning / commands stripped from public speech (observer-only). */
  internal?: string;
}

export interface BreakoutGroup {
  id: string;
  roundNumber: number;
  members: number[];
}

export interface NominationRecord {
  nominatorSeat: number;
  nomineeSeat: number;
  votesFor: number[];
  votesAgainst: number[];
  passed: boolean;
  /** Outcome after vote evaluation:
   *  "on_the_block" | "replaced" | "tied" | "failed" | null */
  outcome: string | null;
}

/** Tracks who is currently "on the block" during nominations */
export interface OnTheBlock {
  seat: number;
  voteCount: number;
}

export interface GameState {
  gameId: string;
  phase: Phase;
  dayNumber: number;
  players: Player[];
  messages: Message[];
  breakoutGroups: BreakoutGroup[];
  nominations: NominationRecord[];
  /** Who is currently "on the block" (pending execution after all nominations). */
  onTheBlock: OnTheBlock | null;
  whispers: Message[];
  executedToday: number | null;
  nightKills: number[];
  winner: Alignment | null;
  winCondition: string | null;
  /** Bluff tokens shown to the Demon during setup. */
  demonBluffs: string[];
  rngSeed: string | null;
}

export interface GameConfig {
  script: string;
  playerCount: number;
  agentConfigs: AgentConfig[];
}

export interface AgentConfig {
  agentId: string;
  model: string;
  temperature?: number;
}

export interface GameSummary {
  gameId: string;
  phase: Phase;
  dayNumber: number;
  playerCount: number;
  aliveCount: number;
  winner: Alignment | null;
  createdAt: string;
}

// ── Debrief ─────────────────────────────────────────────────────────

export interface DebriefMessage {
  seat: number;
  agentId: string;
  /** Medieval character name (e.g., "Niamh"). */
  characterName?: string;
  role: string;
  alignment: Alignment;
  content: string;
  survived: boolean;
  timestamp?: number;
}

// ── Reasoning ───────────────────────────────────────────────────────

export interface ReasoningEntry {
  seat: number;
  reasoning: string;
  phase: Phase;
  timestamp: number;
}

// ── Night action log ────────────────────────────────────────────────

export interface NightActionEntry {
  seat: number;
  name: string;
  role: string;
  roleId: string;
  action: string;
  targetSeat: number | null;
  targetName: string | null;
  effect: string;
  day: number;
  timestamp: number;
}

// ── Token tracking ──────────────────────────────────────────────────

export interface TokenUsage {
  seat: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
}
