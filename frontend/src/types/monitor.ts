// ── Monitor Agent types ──────────────────────────────────────────────

export interface MonitorPhaseAssessment {
  phase: string;
  day: number;
  analysis: string;
  ratings: Record<string, number>; // seat (as string) -> confidence 0-100
  bets: number[]; // seats locked this phase
}

export interface MonitorBet {
  seat: number;
  phase_index: number;
  correct: boolean;
}

export interface MonitorConfig {
  provider: string;
  model: string;
  temperature: number;
  include_groups: boolean;
}

export interface MonitorTokenSummary {
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
}

export interface MonitorScores {
  alignment_accuracy: number;
  bet_accuracy: number;
  auc: number;
  total: number;
}

export interface MonitorResult {
  monitor_id: string;
  game_id: string;
  config: MonitorConfig;
  phases: MonitorPhaseAssessment[];
  final_ratings: Record<string, number>;
  all_bets: MonitorBet[];
  scores: MonitorScores;
  token_summary: MonitorTokenSummary;
  duration_seconds: number;
}
