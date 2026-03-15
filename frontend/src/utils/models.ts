/** Map a model name or agentId to a provider color. */
export function getProviderColor(modelOrAgentId: string): string {
  const id = modelOrAgentId.toLowerCase();
  if (id.includes('claude') || id.includes('anthropic') || id.includes('haiku') || id.includes('sonnet') || id.includes('opus')) return '#D97706';
  if (id.includes('gpt') || id.includes('openai') || id.includes('o1-') || id.includes('o3-') || id.includes('o4-') || id === 'o3-mini') return '#10B981';
  if (id.includes('gemini') || id.includes('google')) return '#3B82F6';
  return '#9CA3AF'; // unknown = gray
}

export function getProviderName(modelOrAgentId: string): string {
  const id = modelOrAgentId.toLowerCase();
  if (id.includes('claude') || id.includes('anthropic') || id.includes('haiku') || id.includes('sonnet') || id.includes('opus')) return 'Anthropic';
  if (id.includes('gpt') || id.includes('openai') || id.includes('o1-') || id.includes('o3-') || id.includes('o4-') || id === 'o3-mini') return 'OpenAI';
  if (id.includes('gemini') || id.includes('google')) return 'Google';
  return 'Unknown';
}

/** Human-readable model name: "claude-haiku-4-5-20251001" -> "Haiku 4.5" */
export function shortModelName(modelName: string): string {
  const id = modelName.toLowerCase();
  // Anthropic
  if (id.includes('opus')) return 'Opus';
  if (id.includes('sonnet')) return 'Sonnet';
  if (id.includes('haiku')) return 'Haiku';
  // OpenAI
  if (id === 'gpt-4o-mini') return 'GPT-4o Mini';
  if (id.includes('gpt-4o')) return 'GPT-4o';
  if (id.includes('o3-mini')) return 'o3-mini';
  if (id.includes('o3')) return 'o3';
  // Google
  if (id.includes('flash')) return 'Flash';
  if (id.includes('pro')) return 'Gemini Pro';
  // Fallback: first two segments
  const parts = modelName.split('-');
  if (parts.length >= 2) return parts.slice(0, 2).join('-');
  return modelName.slice(0, 12);
}

/** @deprecated Use shortModelName instead */
export function shortAgentName(agentId: string): string {
  return shortModelName(agentId);
}

export function getPhaseColor(phase: string): string {
  switch (phase) {
    case 'night':
    case 'first_night':
      return '#6366F1';
    case 'day_discussion':
    case 'day_breakout':
    case 'day_regroup':
      return '#F59E0B';
    case 'nominations':
    case 'voting':
    case 'execution':
      return '#EF4444';
    case 'setup':
      return '#8B5CF6';
    case 'game_over':
      return '#10B981';
    case 'debrief':
      return '#C084FC';
    default:
      return '#6B7280';
  }
}

export function getPhaseLabel(phase: string): string {
  switch (phase) {
    case 'setup': return 'Setup';
    case 'first_night': return 'First Night';
    case 'night': return 'Night';
    case 'day_discussion': return 'Discussion';
    case 'day_breakout': return 'Breakout';
    case 'day_regroup': return 'Regroup';
    case 'nominations': return 'Nominations';
    case 'voting': return 'Voting';
    case 'execution': return 'Execution';
    case 'game_over': return 'Game Over';
    case 'debrief': return 'Debrief';
    default: return phase;
  }
}

export function getRoleTypeColor(roleType: string): string {
  switch (roleType) {
    case 'townsfolk': return '#3B82F6';
    case 'outsider': return '#06B6D4';
    case 'minion': return '#F97316';
    case 'demon': return '#DC2626';
    default: return '#6B7280';
  }
}
