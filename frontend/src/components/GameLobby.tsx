import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { listGames, createConfiguredGame, getModelStats, getAudioManifest, generateGameAudio } from '../api/rest.ts';
import type { GameListItem, SeatModelConfig, ModelStatsResponse } from '../api/rest.ts';
import { useGameStore } from '../stores/gameStore.ts';
import { SplashScreen } from './SplashScreen.tsx';
import { PageTransition } from './PageTransition.tsx';

// ── Available models ──────────────────────────────────────────────────

const AVAILABLE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4.6', provider: 'anthropic' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { id: 'o3-mini', label: 'o3-mini', provider: 'openai' },
  { id: 'o4-mini', label: 'o4-mini', provider: 'openai' },
  { id: 'gpt-4.1', label: 'GPT-4.1', provider: 'openai' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'openai' },
  { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai' },
  // gpt-5.4-pro uses completions API, not chat — not compatible
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', provider: 'google' },
];

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#D97706',
  openai: '#10B981',
  google: '#3B82F6',
};

const SCRIPTS: { label: string; value: string; note?: string }[] = [
  { label: 'Trouble Brewing', value: 'trouble_brewing' },
  { label: 'Bad Moon Rising', value: 'bad_moon_rising', note: 'experimental' },
  { label: 'Sects & Violets', value: 'sects_and_violets', note: 'experimental' },
];

const QUICK_FILL_PRESETS = [
  { label: 'All Haiku', modelId: 'claude-haiku-4-5-20251001', provider: 'anthropic' },
  { label: 'All Sonnet', modelId: 'claude-sonnet-4-20250514', provider: 'anthropic' },
  { label: 'Mixed', modelId: '__mixed__', provider: '' },
] as const;

function buildMixedSeatModels(count: number): string[] {
  const mixedOrder = ['claude-haiku-4-5-20251001', 'gpt-4o-mini', 'gemini-2.5-flash'];
  return Array.from({ length: count }, (_, i) => mixedOrder[i % mixedOrder.length]);
}

const POLL_INTERVAL_MS = 15_000;

// ── Role data (Trouble Brewing) ─────────────────────────────────────

interface RoleInfo {
  id: string;
  name: string;
  type: 'townsfolk' | 'outsider' | 'minion' | 'demon';
}

const SCRIPT_ROLES: Record<string, RoleInfo[]> = {
  trouble_brewing: [
    { id: 'washerwoman', name: 'Washerwoman', type: 'townsfolk' },
    { id: 'librarian', name: 'Librarian', type: 'townsfolk' },
    { id: 'investigator', name: 'Investigator', type: 'townsfolk' },
    { id: 'chef', name: 'Chef', type: 'townsfolk' },
    { id: 'empath', name: 'Empath', type: 'townsfolk' },
    { id: 'fortune_teller', name: 'Fortune Teller', type: 'townsfolk' },
    { id: 'undertaker', name: 'Undertaker', type: 'townsfolk' },
    { id: 'monk', name: 'Monk', type: 'townsfolk' },
    { id: 'ravenkeeper', name: 'Ravenkeeper', type: 'townsfolk' },
    { id: 'virgin', name: 'Virgin', type: 'townsfolk' },
    { id: 'slayer', name: 'Slayer', type: 'townsfolk' },
    { id: 'soldier', name: 'Soldier', type: 'townsfolk' },
    { id: 'mayor', name: 'Mayor', type: 'townsfolk' },
    { id: 'butler', name: 'Butler', type: 'outsider' },
    { id: 'drunk', name: 'Drunk', type: 'outsider' },
    { id: 'recluse', name: 'Recluse', type: 'outsider' },
    { id: 'saint', name: 'Saint', type: 'outsider' },
    { id: 'poisoner', name: 'Poisoner', type: 'minion' },
    { id: 'spy', name: 'Spy', type: 'minion' },
    { id: 'scarlet_woman', name: 'Scarlet Woman', type: 'minion' },
    { id: 'baron', name: 'Baron', type: 'minion' },
    { id: 'imp', name: 'Imp', type: 'demon' },
  ],
};

const ROLE_TYPE_COLORS: Record<string, string> = {
  townsfolk: '#3B82F6',
  outsider: '#06B6D4',
  minion: '#F59E0B',
  demon: '#EF4444',
};

const ROLE_TYPE_LABELS: Record<string, string> = {
  townsfolk: 'Townsfolk',
  outsider: 'Outsiders',
  minion: 'Minions',
  demon: 'Demon',
};

const ROLE_DISTRIBUTION: Record<number, [number, number, number, number]> = {
  5:  [3, 0, 1, 1],
  6:  [3, 1, 1, 1],
  7:  [5, 0, 1, 1],
  8:  [5, 1, 1, 1],
  9:  [5, 2, 1, 1],
  10: [7, 0, 2, 1],
  11: [7, 1, 2, 1],
  12: [7, 2, 2, 1],
  13: [9, 0, 3, 1],
  14: [9, 1, 3, 1],
  15: [9, 2, 3, 1],
};

function getExpectedDistribution(playerCount: number, hasBaronOverride?: boolean) {
  const [baseT, baseO, m, d] = ROLE_DISTRIBUTION[playerCount] ?? [0, 0, 0, 0];
  const hasBaron = hasBaronOverride ?? false;
  return { t: hasBaron ? baseT - 2 : baseT, o: hasBaron ? baseO + 2 : baseO, m, d };
}

function validateRoleAssignment(seatRoles: string[], playerCount: number, scriptId: string): string[] {
  const roles = SCRIPT_ROLES[scriptId];
  if (!roles) return ['Role assignment is only available for Trouble Brewing.'];
  const assigned = seatRoles.slice(0, playerCount);
  const warnings: string[] = [];
  const unassigned = assigned.filter((r) => r === '').length;
  if (unassigned > 0) { warnings.push(`${unassigned} seat(s) have no role assigned.`); return warnings; }
  const seen = new Set<string>();
  for (const id of assigned) { if (seen.has(id)) { const role = roles.find((r) => r.id === id); warnings.push(`Duplicate: ${role?.name ?? id}`); } seen.add(id); }
  const counts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
  for (const id of assigned) { const role = roles.find((r) => r.id === id); if (role) counts[role.type]++; }
  const hasBaron = assigned.includes('baron');
  const expected = getExpectedDistribution(playerCount, hasBaron);
  if (counts.demon !== expected.d) warnings.push(`Need exactly ${expected.d} Demon (have ${counts.demon}).`);
  if (counts.minion !== expected.m) warnings.push(`Need exactly ${expected.m} Minion(s) (have ${counts.minion}).`);
  if (counts.townsfolk !== expected.t) warnings.push(`Need ${expected.t} Townsfolk (have ${counts.townsfolk}).`);
  if (counts.outsider !== expected.o) warnings.push(`Need ${expected.o} Outsider(s) (have ${counts.outsider}).`);
  return warnings;
}

// ── Seat rows ───────────────────────────────────────────────────────

function SeatRow({ seat, model, onChange }: { seat: number; model: string; onChange: (m: string) => void }) {
  const selected = AVAILABLE_MODELS.find((m) => m.id === model);
  const color = selected ? PROVIDER_COLORS[selected.provider] : '#6B7280';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 20, height: 20, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: '#1a0e04', flexShrink: 0 }}>{seat}</div>
      <select value={model} onChange={(e) => onChange(e.target.value)} style={st.select}>
        {AVAILABLE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
    </div>
  );
}

function AssignedSeatRow({ seat, model, roleId, scriptId, usedRoles, onModelChange, onRoleChange }: {
  seat: number; model: string; roleId: string; scriptId: string; usedRoles: Set<string>;
  onModelChange: (m: string) => void; onRoleChange: (r: string) => void;
}) {
  const selected = AVAILABLE_MODELS.find((m) => m.id === model);
  const modelColor = selected ? PROVIDER_COLORS[selected.provider] : '#6B7280';
  const roles = SCRIPT_ROLES[scriptId] ?? [];
  const currentRole = roles.find((r) => r.id === roleId);
  const roleColor = currentRole ? ROLE_TYPE_COLORS[currentRole.type] : '#6B7280';
  const grouped = new Map<string, RoleInfo[]>();
  for (const r of roles) { const list = grouped.get(r.type) ?? []; list.push(r); grouped.set(r.type, list); }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', background: modelColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 700, color: '#1a0e04', flexShrink: 0 }}>{seat}</div>
      <select value={model} onChange={(e) => onModelChange(e.target.value)} style={{ ...st.select, flex: '1 1 45%', fontSize: '0.7rem', padding: '3px 4px' }}>
        {AVAILABLE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <select value={roleId} onChange={(e) => onRoleChange(e.target.value)} style={{ ...st.select, flex: '1 1 45%', fontSize: '0.7rem', padding: '3px 4px', borderLeft: `3px solid ${roleColor}` }}>
        <option value="">-- role --</option>
        {Array.from(grouped.entries()).map(([type, typeRoles]) => (
          <optgroup key={type} label={ROLE_TYPE_LABELS[type]}>
            {typeRoles.map((r) => { const taken = usedRoles.has(r.id) && r.id !== roleId; return <option key={r.id} value={r.id} disabled={taken} style={{ color: taken ? '#aaa' : undefined }}>{r.name}{taken ? ' (taken)' : ''}</option>; })}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function DistributionSummary({ playerCount, seatRoles, roleMode, scriptId }: {
  playerCount: number; seatRoles: string[]; roleMode: 'random' | 'assigned'; scriptId: string;
}) {
  const base = getExpectedDistribution(playerCount, false);
  const withBaron = getExpectedDistribution(playerCount, true);
  const roles = SCRIPT_ROLES[scriptId] ?? [];
  const assigned = seatRoles.slice(0, playerCount);
  const counts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
  for (const id of assigned) { const role = roles.find((r) => r.id === id); if (role) counts[role.type]++; }
  const hasBaron = assigned.includes('baron');
  const expected = hasBaron ? withBaron : base;
  return (
    <div style={{ fontSize: '0.62rem', color: '#5a4630', lineHeight: 1.5, marginTop: 4 }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>Required for {playerCount}p:</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(['townsfolk', 'outsider', 'minion', 'demon'] as const).map((type) => {
          const exp = type === 'townsfolk' ? expected.t : type === 'outsider' ? expected.o : type === 'minion' ? expected.m : expected.d;
          const cur = counts[type];
          const isOk = roleMode === 'random' || cur === exp;
          return (<span key={type} style={{ color: isOk ? '#5a4630' : '#991B1B', fontWeight: isOk ? 400 : 700 }}><span style={{ color: ROLE_TYPE_COLORS[type], fontWeight: 700 }}>{exp}{type[0].toUpperCase()}</span>{roleMode === 'assigned' && ` (${cur})`}</span>);
        })}
      </div>
      {hasBaron && <div style={{ fontStyle: 'italic', color: '#8b7355', marginTop: 2 }}>Baron: +2 Outsiders, -2 Townsfolk</div>}
      <div style={{ color: '#8b7355', marginTop: 2 }}>Base: {base.t}T {base.o}O {base.m}M {base.d}D{base.o !== withBaron.o && ` | w/ Baron: ${withBaron.t}T ${withBaron.o}O ${withBaron.m}M ${withBaron.d}D`}</div>
    </div>
  );
}

// ── Options tabs ─────────────────────────────────────────────────────

type OptionsTab = 'rules' | 'conversation' | 'agents' | 'audio' | 'probabilities' | 'api' | 'voice' | 'stats';

const OPTIONS_TABS: { id: OptionsTab; label: string; stub?: boolean }[] = [
  { id: 'rules', label: 'Game Rules' },
  { id: 'conversation', label: 'Conversation' },
  { id: 'agents', label: 'Agent Tuning' },
  { id: 'audio', label: 'Audio' },
  { id: 'probabilities', label: 'Probabilities', stub: true },
  { id: 'api', label: 'API Keys', stub: true },
  { id: 'voice', label: 'Voice' },
  { id: 'stats', label: 'Stats' },
];

function OptionField({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={st.optLabel}>{label}</label>
      {help && <div style={st.optHelp}>{help}</div>}
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

function Toggle({ value, onChange, labels }: { value: boolean; onChange: (v: boolean) => void; labels?: [string, string] }) {
  const [off, on] = labels ?? ['Off', 'On'];
  return (
    <div style={{ display: 'flex', gap: 0, borderRadius: 3, overflow: 'hidden', border: '1px solid rgba(92, 61, 26, 0.25)', width: 'fit-content' }}>
      <button style={{ ...st.toggleBtn, background: !value ? 'rgba(92, 61, 26, 0.2)' : 'transparent', fontWeight: !value ? 700 : 400 }} onClick={() => onChange(false)}>{off}</button>
      <button style={{ ...st.toggleBtn, background: value ? 'rgba(92, 61, 26, 0.2)' : 'transparent', fontWeight: value ? 700 : 400 }} onClick={() => onChange(true)}>{on}</button>
    </div>
  );
}

function NumberField({ value, onChange, min, max, step, suffix }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="range" min={min ?? 0} max={max ?? 100} step={step ?? 1} value={value}
        onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1, accentColor: '#8b5e2a' }} />
      <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#2a1a0a', fontWeight: 700, minWidth: 40, textAlign: 'right' }}>
        {value}{suffix ?? ''}
      </span>
    </div>
  );
}

function StubPanel({ title, description }: { title: string; description: string }) {
  return (
    <div style={{ padding: '20px 0', textAlign: 'center' }}>
      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#3d2812', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: '0.72rem', color: '#8b7355', lineHeight: 1.5, maxWidth: 300, margin: '0 auto' }}>{description}</div>
      <div style={{ marginTop: 12, fontSize: '0.65rem', color: '#b89b6a', fontStyle: 'italic' }}>Coming soon</div>
    </div>
  );
}

// ── Stats panel ─────────────────────────────────────────────────────

function shortModelName(id: string): string {
  const entry = AVAILABLE_MODELS.find((m) => m.id === id);
  if (entry) return entry.label;
  // Fallback: strip date suffixes and common prefixes
  return id.replace(/-\d{8,}$/, '').replace(/^(claude-|gpt-|gemini-)/, (m) => m);
}

function providerForModel(id: string): string {
  return AVAILABLE_MODELS.find((m) => m.id === id)?.provider ?? 'unknown';
}

function rankBadge(rankings: string[], modelId: string): { text: string; color: string } {
  const idx = rankings.indexOf(modelId);
  if (idx < 0) return { text: '--', color: '#8b7355' };
  const rank = idx + 1;
  if (rank === 1) return { text: '#1', color: '#16a34a' };
  if (rank === 2) return { text: '#2', color: '#ca8a04' };
  if (rank === 3) return { text: '#3', color: '#d97706' };
  return { text: `#${rank}`, color: '#8b7355' };
}

function pct(rate: number | undefined): string {
  if (rate === undefined || rate === null) return '--';
  return `${Math.round(rate * 100)}%`;
}

function StatsPanel({ shareStats, revealModels, onToggleShare }: {
  shareStats: boolean;
  revealModels: string;
  onToggleShare: (v: boolean) => void;
}) {
  const [stats, setStats] = useState<ModelStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getModelStats()
      .then((data) => { if (!cancelled) { setStats(data); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load stats'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div style={{ padding: '20px 0', textAlign: 'center', fontSize: '0.8rem', color: '#8b7355' }}>Loading stats...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center' }}>
        <div style={{ fontSize: '0.78rem', color: '#991B1B', marginBottom: 6 }}>{error}</div>
        <div style={{ fontSize: '0.65rem', color: '#8b7355' }}>Make sure the backend is running and has the /api/stats/models endpoint.</div>
      </div>
    );
  }

  if (!stats || Object.keys(stats.models).length === 0) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#3d2812', marginBottom: 6 }}>No Stats Yet</div>
        <div style={{ fontSize: '0.72rem', color: '#8b7355', lineHeight: 1.5 }}>Play some games to start tracking model performance.</div>
      </div>
    );
  }

  // Sort by overall ranking
  const modelIds = stats.rankings.overall.length > 0
    ? stats.rankings.overall
    : Object.keys(stats.models);

  const shareDisabled = revealModels !== 'true';

  return (
    <div>
      <div style={{ fontSize: '0.62rem', color: '#8b7355', marginBottom: 8, textAlign: 'center' }}>
        {stats.total_games} game{stats.total_games !== 1 ? 's' : ''} played
      </div>

      {/* Leaderboard table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.68rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(92, 61, 26, 0.25)' }}>
              {['#', 'Model', 'Games', 'Good', 'Evil', 'Demon', 'Overall'].map((h) => (
                <th key={h} style={{
                  padding: '4px 6px', textAlign: h === 'Model' ? 'left' : 'center',
                  fontWeight: 700, color: '#3d2812', fontSize: '0.6rem',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modelIds.map((modelId, idx) => {
              const m = stats.models[modelId];
              if (!m) return null;
              const provider = providerForModel(modelId);
              const provColor = PROVIDER_COLORS[provider] ?? '#6B7280';
              const goodRank = rankBadge(stats.rankings.good, modelId);
              const evilRank = rankBadge(stats.rankings.evil, modelId);
              const demonRank = rankBadge(stats.rankings.demon, modelId);
              const overallRank = rankBadge(stats.rankings.overall, modelId);

              return (
                <tr key={modelId} style={{
                  borderBottom: '1px solid rgba(92, 61, 26, 0.1)',
                  background: idx % 2 === 0 ? 'rgba(92, 61, 26, 0.03)' : 'transparent',
                }}>
                  <td style={{ padding: '5px 6px', textAlign: 'center', fontWeight: 700, color: '#3d2812' }}>{idx + 1}</td>
                  <td style={{ padding: '5px 6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', background: provColor, flexShrink: 0,
                      }} />
                      <span style={{ fontWeight: 600, color: '#2a1a0a', whiteSpace: 'nowrap' }}>
                        {shortModelName(modelId)}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '5px 6px', textAlign: 'center', color: '#5a4630' }}>{m.games_played}</td>
                  <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                    <span style={{ color: '#5a4630' }}>{pct(m.as_good.win_rate)}</span>
                    {m.as_good.played > 0 && (
                      <span style={{ fontSize: '0.55rem', fontWeight: 700, color: goodRank.color, marginLeft: 3 }}>{goodRank.text}</span>
                    )}
                  </td>
                  <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                    <span style={{ color: '#5a4630' }}>{pct(m.as_evil.win_rate)}</span>
                    {m.as_evil.played > 0 && (
                      <span style={{ fontSize: '0.55rem', fontWeight: 700, color: evilRank.color, marginLeft: 3 }}>{evilRank.text}</span>
                    )}
                  </td>
                  <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                    <span style={{ color: '#5a4630' }}>{pct(m.as_demon.win_rate)}</span>
                    {m.as_demon.played > 0 && (
                      <span style={{ fontSize: '0.55rem', fontWeight: 700, color: demonRank.color, marginLeft: 3 }}>{demonRank.text}</span>
                    )}
                  </td>
                  <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                    <span style={{ fontWeight: 700, color: overallRank.color }}>{overallRank.text}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Subtext: games per alignment */}
      <div style={{ fontSize: '0.55rem', color: '#b89b6a', marginTop: 6, textAlign: 'center', fontStyle: 'italic' }}>
        Win rates based on completed games per alignment
      </div>

      {/* Share Stats toggle */}
      <div style={{
        marginTop: 16, padding: '10px 12px', borderRadius: 4,
        background: 'rgba(92, 61, 26, 0.05)', border: '1px solid rgba(92, 61, 26, 0.15)',
        opacity: shareDisabled ? 0.5 : 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#2a1a0a' }}>Share Stats with Agents</div>
            <div style={{ fontSize: '0.6rem', color: '#8b7355', lineHeight: 1.4, marginTop: 2 }}>
              {shareDisabled
                ? "Requires 'Reveal Models' to be enabled (Game Rules tab)"
                : shareStats
                  ? 'Agents will see historical model performance stats in their system prompt'
                  : 'Agents will not see other models\' historical stats'
              }
            </div>
          </div>
          <Toggle
            value={shareStats && !shareDisabled}
            onChange={(v) => { if (!shareDisabled) onToggleShare(v); }}
            labels={['Off', 'On']}
          />
        </div>
      </div>
    </div>
  );
}

// ── Voice panel ──────────────────────────────────────────────────────

function VoicePanel({ games }: { games: GameListItem[] }) {
  const [audioStatus, setAudioStatus] = useState<Record<string, 'none' | 'generating' | 'ready' | 'error'>>({});
  const [clipCounts, setClipCounts] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const completedGames = games.filter(g => g.status === 'completed');

  // Check which games already have audio on mount
  useEffect(() => {
    for (const g of completedGames) {
      getAudioManifest(g.game_id)
        .then((manifest) => {
          setAudioStatus(prev => ({ ...prev, [g.game_id]: 'ready' }));
          setClipCounts(prev => ({ ...prev, [g.game_id]: manifest.clips.length }));
        })
        .catch(() => {
          setAudioStatus(prev => ({ ...prev, [g.game_id]: 'none' }));
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedGames.length]);

  const handleGenerate = async (gameId: string) => {
    setAudioStatus(prev => ({ ...prev, [gameId]: 'generating' }));
    setErrors(prev => { const n = { ...prev }; delete n[gameId]; return n; });
    try {
      const result = await generateGameAudio(gameId);
      setAudioStatus(prev => ({ ...prev, [gameId]: 'ready' }));
      setClipCounts(prev => ({ ...prev, [gameId]: result.clips_generated }));
    } catch (err) {
      setAudioStatus(prev => ({ ...prev, [gameId]: 'error' }));
      setErrors(prev => ({ ...prev, [gameId]: err instanceof Error ? err.message : 'Generation failed' }));
    }
  };

  if (completedGames.length === 0) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#3d2812', marginBottom: 6 }}>No Completed Games</div>
        <div style={{ fontSize: '0.72rem', color: '#8b7355', lineHeight: 1.5 }}>Play a game first, then generate voice narration here.</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: '0.72rem', color: '#8b7355', marginBottom: 10, lineHeight: 1.5 }}>
        Generate AI voice narration for completed games using ElevenLabs. Each character gets a unique voice.
        Includes narrator intro and phase transitions. Audio is cached — regenerating skips existing clips.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {completedGames.map((g) => {
          const status = audioStatus[g.game_id] ?? 'none';
          const clips = clipCounts[g.game_id];
          const error = errors[g.game_id];

          return (
            <div key={g.game_id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 4,
              background: 'rgba(92, 61, 26, 0.05)',
              border: '1px solid rgba(92, 61, 26, 0.12)',
            }}>
              {/* Game info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#3d2812' }}>
                    {g.game_id.slice(0, 8)}
                  </span>
                  <span style={{
                    fontSize: '0.55rem', fontWeight: 700, padding: '1px 5px', borderRadius: 8,
                    background: g.winner === 'good' ? '#3B82F622' : '#EF444422',
                    color: g.winner === 'good' ? '#1E40AF' : '#991B1B',
                  }}>
                    {g.winner} wins
                  </span>
                  {g.total_days != null && (
                    <span style={{ fontSize: '0.6rem', color: '#8b7355' }}>
                      {g.total_days}d
                    </span>
                  )}
                </div>
                {error && (
                  <div style={{ fontSize: '0.6rem', color: '#991B1B', marginTop: 2 }}>{error}</div>
                )}
              </div>

              {/* Status / action */}
              {status === 'ready' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.6rem', color: '#065F46', fontWeight: 600 }}>
                    {clips} clips
                  </span>
                  <button style={{
                    ...voiceBtnStyle,
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    color: '#065F46',
                  }} onClick={() => handleGenerate(g.game_id)}>
                    Regenerate
                  </button>
                </div>
              )}
              {status === 'generating' && (
                <span style={{ fontSize: '0.7rem', color: '#92400E', fontWeight: 600 }}>
                  Generating...
                </span>
              )}
              {status === 'none' && (
                <button style={{
                  ...voiceBtnStyle,
                  background: 'rgba(99, 102, 241, 0.12)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  color: '#4338CA',
                }} onClick={() => handleGenerate(g.game_id)}>
                  Generate Narration
                </button>
              )}
              {status === 'error' && (
                <button style={{
                  ...voiceBtnStyle,
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#991B1B',
                }} onClick={() => handleGenerate(g.game_id)}>
                  Retry
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const voiceBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  fontSize: '0.65rem',
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

// ── Options state ────────────────────────────────────────────────────

interface GameOptions {
  // Game Rules
  revealModels: 'true' | 'false' | 'scramble';
  seed: string; // empty = random
  maxDays: number;
  // Conversation
  breakoutRounds: number;
  messagesPerAgent: number;
  regroupMessages: number;
  whispersPerRound: number;
  maxWhisperChars: number;
  openingStatements: boolean;
  // Agent Tuning
  maxSpeechTokens: number;
  maxReasoningTokens: number;
  maxGameCost: number; // 0 = unlimited
  maxConcurrentCalls: number;
  // Stats
  shareStats: boolean;
  // Audio
  masterVolume: number; // 0-100
  musicVolume: number;  // 0-100
  voiceVolume: number;  // 0-100
}

const DEFAULT_OPTIONS: GameOptions = {
  revealModels: 'true',
  seed: '',
  maxDays: 50,
  breakoutRounds: 1,
  messagesPerAgent: 2,
  regroupMessages: 1,
  whispersPerRound: 1,
  maxWhisperChars: 150,
  openingStatements: true,
  maxSpeechTokens: 300,
  maxReasoningTokens: 1024,
  maxGameCost: 0,
  maxConcurrentCalls: 3,
  shareStats: false,
  masterVolume: 80,
  musicVolume: 50,
  voiceVolume: 100,
};

// ── Main component ──────────────────────────────────────────────────

export function GameLobby() {
  const navigate = useNavigate();
  const lobbyAudioRef = useRef<HTMLAudioElement | null>(null);

  // Splash screen (only on first visit)
  const [showSplash, setShowSplash] = useState(() => {
    if (sessionStorage.getItem('botc_splash_seen')) return false;
    return true;
  });
  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
    sessionStorage.setItem('botc_splash_seen', '1');
  }, []);

  // Page transition
  const [transitioning, setTransitioning] = useState(false);
  const transitionTargetRef = useRef<string | null>(null);

  const navigateWithTransition = useCallback((path: string) => {
    transitionTargetRef.current = path;
    setTransitioning(true);
  }, []);

  const handleTransitionMidpoint = useCallback(() => {
    if (transitionTargetRef.current) {
      navigate(transitionTargetRef.current);
    }
  }, [navigate]);

  // View state
  const [view, setView] = useState<'menu' | 'setup' | 'options'>('menu');
  const [optionsTab, setOptionsTab] = useState<OptionsTab>('rules');

  // Game config
  const [playerCount, setPlayerCount] = useState(7);
  const [script, setScript] = useState(SCRIPTS[0].value);
  const [seatModels, setSeatModels] = useState<string[]>(Array(15).fill(AVAILABLE_MODELS[0].id));
  const [seatRoles, setSeatRoles] = useState<string[]>(Array(15).fill(''));
  const [roleMode, setRoleMode] = useState<'random' | 'assigned'>('random');
  const [options, setOptions] = useState<GameOptions>({ ...DEFAULT_OPTIONS });

  // Game list
  const [games, setGames] = useState<GameListItem[]>([]);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchGames = useCallback(async () => {
    try { setGames(await listGames()); setGamesError(null); }
    catch (err) { const msg = err instanceof Error ? err.message : 'Failed'; setGamesError(msg.includes('fetch') || msg.includes('Network') ? 'Cannot connect to server' : msg); }
    finally { setGamesLoading(false); }
  }, []);

  useEffect(() => {
    void fetchGames();
    pollRef.current = setInterval(() => void fetchGames(), POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchGames]);

  // Lobby music
  useEffect(() => {
    const audio = new Audio('/lobby.mp3');
    audio.loop = true;
    audio.volume = (options.masterVolume / 100) * (options.musicVolume / 100);
    lobbyAudioRef.current = audio;
    audio.play().catch(() => {
      // Autoplay blocked — start on first click
      const unlock = () => {
        audio.play().catch(() => {});
        window.removeEventListener('pointerdown', unlock);
      };
      window.addEventListener('pointerdown', unlock, { once: true });
    });
    return () => { audio.pause(); audio.src = ''; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync volume changes to lobby music
  useEffect(() => {
    if (lobbyAudioRef.current) {
      lobbyAudioRef.current.volume = (options.masterVolume / 100) * (options.musicVolume / 100);
    }
  }, [options.masterVolume, options.musicVolume]);

  // Sync volumes to game store (for replay controller)
  const setVolumes = useGameStore((s) => s.setVolumes);
  useEffect(() => {
    setVolumes(options.masterVolume / 100, options.voiceVolume / 100, options.musicVolume / 100);
  }, [options.masterVolume, options.voiceVolume, options.musicVolume, setVolumes]);

  const handleModelChange = useCallback((seat: number, model: string) => {
    setSeatModels((prev) => { const next = [...prev]; next[seat] = model; return next; });
  }, []);
  const handleRoleChange = useCallback((seat: number, role: string) => {
    setSeatRoles((prev) => { const next = [...prev]; next[seat] = role; return next; });
  }, []);
  const fillAllWith = useCallback((model: string) => { setSeatModels(Array(15).fill(model)); }, []);

  const usedRoles = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < playerCount; i++) { if (seatRoles[i]) set.add(seatRoles[i]); }
    return set;
  }, [seatRoles, playerCount]);

  const roleWarnings = useMemo(() => {
    if (roleMode !== 'assigned') return [];
    return validateRoleAssignment(seatRoles, playerCount, script);
  }, [roleMode, seatRoles, playerCount, script]);

  const applyTeamVsTeamPreset = useCallback(() => {
    const roles = SCRIPT_ROLES[script];
    if (!roles) return;
    const dist = getExpectedDistribution(playerCount, false);
    const newRoles = Array(15).fill('');
    const demons = roles.filter((r) => r.type === 'demon');
    const minions = roles.filter((r) => r.type === 'minion');
    const townsfolk = roles.filter((r) => r.type === 'townsfolk');
    const outsiders = roles.filter((r) => r.type === 'outsider');
    let seat = 0;
    for (let i = 0; i < dist.d && seat < playerCount; i++) newRoles[seat++] = demons[i]?.id ?? '';
    for (let i = 0; i < dist.m && seat < playerCount; i++) newRoles[seat++] = minions[i]?.id ?? '';
    for (let i = 0; i < dist.t && seat < playerCount; i++) newRoles[seat++] = townsfolk[i]?.id ?? '';
    for (let i = 0; i < dist.o && seat < playerCount; i++) newRoles[seat++] = outsiders[i]?.id ?? '';
    setSeatRoles(newRoles);
    setRoleMode('assigned');
  }, [script, playerCount]);

  const updateOption = useCallback(<K extends keyof GameOptions>(key: K, val: GameOptions[K]) => {
    setOptions((prev) => ({ ...prev, [key]: val }));
  }, []);

  const handleStart = useCallback(async () => {
    setStarting(true); setStartError(null);
    if (roleMode === 'assigned' && roleWarnings.length > 0) {
      setStartError('Fix role assignment errors before starting.');
      setStarting(false); return;
    }
    try {
      const seed = options.seed ? Number(options.seed) : Math.floor(Math.random() * 100_000);
      const seatModelConfigs: SeatModelConfig[] = seatModels.slice(0, playerCount).map((modelId) => {
        const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
        return { provider: model?.provider ?? 'anthropic', model: modelId };
      });
      const result = await createConfiguredGame({
        script,
        num_players: playerCount,
        seat_models: seatModelConfigs,
        seat_roles: roleMode === 'assigned' ? seatRoles.slice(0, playerCount) : undefined,
        seed,
        max_days: options.maxDays,
        reveal_models: options.revealModels,
        share_stats: options.shareStats && options.revealModels === 'true',
      });
      navigateWithTransition(`/game/${result.game_id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      if (msg.includes('fetch') || msg.includes('Network')) setStartError('Cannot connect to server.');
      else if (msg.includes('API keys') || msg.includes('Missing')) setStartError('Missing API keys. Add to .env.');
      else setStartError(msg);
    } finally { setStarting(false); }
  }, [playerCount, script, seatModels, seatRoles, roleMode, roleWarnings, options, navigate]);

  const isAssignedAvailable = script in SCRIPT_ROLES;

  // ── Render: Setup (game config) ────────────────────────────────────

  const setupView = (
    <div style={{ width: '100%' }}>
      <button style={st.backBtn} onClick={() => setView('menu')}>Back</button>
      <div style={st.panelTitle}>Game Setup</div>

      <div style={st.configGrid}>
        {/* Left: Script + Players + Quick Fill + Role Mode */}
        <div>
          <div style={st.field}>
            <label style={st.label}>Script</label>
            <select value={script} onChange={(e) => setScript(e.target.value)} style={st.select}>
              {SCRIPTS.map((sc) => <option key={sc.value} value={sc.value}>{sc.label}{sc.note ? ` (${sc.note})` : ''}</option>)}
            </select>
          </div>

          <div style={st.field}>
            <label style={st.label}>Players</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="range" min={5} max={15} value={playerCount}
                onChange={(e) => setPlayerCount(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#8b5e2a' }} />
              <span style={{ fontFamily: 'monospace', fontSize: '1.1rem', color: '#2a1a0a', fontWeight: 700 }}>{playerCount}</span>
            </div>
          </div>

          <div style={st.field}>
            <label style={st.label}>Quick Fill</label>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {QUICK_FILL_PRESETS.map((preset) => (
                <button key={preset.label} style={{ ...st.smallBtn, borderLeft: `3px solid ${preset.modelId === '__mixed__' ? '#8b5e2a' : PROVIDER_COLORS[preset.provider] ?? '#6B7280'}` }}
                  onClick={() => { if (preset.modelId === '__mixed__') setSeatModels(buildMixedSeatModels(15)); else fillAllWith(preset.modelId); }}>
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div style={st.field}>
            <label style={st.label}>Role Assignment</label>
            <div style={{ display: 'flex', gap: 0, borderRadius: 3, overflow: 'hidden', border: '1px solid rgba(92, 61, 26, 0.25)' }}>
              <button style={{ ...st.toggleBtn, background: roleMode === 'random' ? 'rgba(92, 61, 26, 0.2)' : 'transparent', fontWeight: roleMode === 'random' ? 700 : 400 }} onClick={() => setRoleMode('random')}>Random</button>
              <button style={{ ...st.toggleBtn, background: roleMode === 'assigned' ? 'rgba(92, 61, 26, 0.2)' : 'transparent', fontWeight: roleMode === 'assigned' ? 700 : 400, opacity: isAssignedAvailable ? 1 : 0.4 }}
                onClick={() => { if (isAssignedAvailable) setRoleMode('assigned'); }} disabled={!isAssignedAvailable}>Assigned</button>
            </div>
          </div>

          {roleMode === 'assigned' && (
            <div style={st.field}>
              <label style={st.label}>Role Presets</label>
              <div style={{ display: 'flex', gap: 5 }}>
                <button style={{ ...st.smallBtn, borderLeft: '3px solid #EF4444' }} onClick={applyTeamVsTeamPreset}>Team vs Team</button>
              </div>
            </div>
          )}

          <DistributionSummary playerCount={playerCount} seatRoles={seatRoles} roleMode={roleMode} scriptId={script} />

          {roleMode === 'assigned' && roleWarnings.length > 0 && (
            <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 3, background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              {roleWarnings.map((w, i) => <div key={i} style={{ fontSize: '0.62rem', color: '#991B1B', lineHeight: 1.4 }}>{w}</div>)}
            </div>
          )}

          <p style={{ fontSize: '0.65rem', color: '#8b7355', marginTop: 6 }}>API keys loaded from server .env</p>
        </div>

        {/* Right: Seats */}
        <div>
          <label style={st.label}>Seat Assignments {roleMode === 'assigned' && '(Model + Role)'}</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 320, overflowY: 'auto' }}>
            {roleMode === 'random' ? (
              Array.from({ length: playerCount }, (_, i) => <SeatRow key={i} seat={i} model={seatModels[i]} onChange={(m) => handleModelChange(i, m)} />)
            ) : (
              Array.from({ length: playerCount }, (_, i) => <AssignedSeatRow key={i} seat={i} model={seatModels[i]} roleId={seatRoles[i]} scriptId={script} usedRoles={usedRoles} onModelChange={(m) => handleModelChange(i, m)} onRoleChange={(r) => handleRoleChange(i, r)} />)
            )}
          </div>
        </div>
      </div>

      {startError && <div style={{ ...st.errorBox, marginTop: 12 }}>{startError}</div>}

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
        <button
          style={{ ...st.menuBtn, ...st.menuBtnPrimary, opacity: starting ? 0.5 : 1 }}
          onClick={() => void handleStart()}
          disabled={starting}
        >
          {starting ? '... Summoning Agents ...' : 'Launch Game'}
        </button>
      </div>
    </div>
  );

  // ── Render: Options ────────────────────────────────────────────────

  const optionsView = (
    <div style={{ width: '100%' }}>
      <button style={st.backBtn} onClick={() => setView('menu')}>Back</button>
      <div style={st.panelTitle}>Options</div>

      {/* Tab bar */}
      <div style={st.tabBar}>
        {OPTIONS_TABS.map((tab) => (
          <button key={tab.id}
            style={{ ...st.tab, ...(optionsTab === tab.id ? st.tabActive : {}) }}
            onClick={() => setOptionsTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={st.tabContent}>
        {optionsTab === 'rules' && (
          <>
            <OptionField label="Reveal Model Names" help="Visible = agents see real model names. Hidden = blind benchmark. Scramble = agents see randomized (mostly wrong) model names — tests whether agents detect behavior vs. name bias.">
              <div style={{ display: 'flex', gap: 0, borderRadius: 3, overflow: 'hidden', border: '1px solid rgba(92, 61, 26, 0.25)', width: 'fit-content' }}>
                {([['false', 'Hidden'], ['true', 'Visible'], ['scramble', 'Scramble']] as const).map(([val, label]) => (
                  <button key={val} style={{
                    ...st.toggleBtn,
                    background: options.revealModels === val ? 'rgba(92, 61, 26, 0.2)' : 'transparent',
                    fontWeight: options.revealModels === val ? 700 : 400,
                  }} onClick={() => updateOption('revealModels', val)}>
                    {label}
                  </button>
                ))}
              </div>
            </OptionField>
            <OptionField label="Random Seed" help="Set a specific seed for reproducible games. Leave empty for random.">
              <input type="text" value={options.seed} onChange={(e) => updateOption('seed', e.target.value)}
                placeholder="Random" style={{ ...st.select, width: 120 }} />
            </OptionField>
            <OptionField label={`Max Days: ${options.maxDays}`} help="Safety cap to prevent infinite games. Real BotC has no day limit.">
              <NumberField value={options.maxDays} onChange={(v) => updateOption('maxDays', v)} min={5} max={100} />
            </OptionField>
          </>
        )}

        {optionsTab === 'conversation' && (
          <>
            <OptionField label="Opening Statements" help="Each agent gives a brief opening speech at the start of each day.">
              <Toggle value={options.openingStatements} onChange={(v) => updateOption('openingStatements', v)} />
            </OptionField>
            <OptionField label={`Breakout Rounds: ${options.breakoutRounds}`} help="Number of small-group discussion rounds per day.">
              <NumberField value={options.breakoutRounds} onChange={(v) => updateOption('breakoutRounds', v)} min={0} max={5} />
            </OptionField>
            <OptionField label={`Messages per Agent: ${options.messagesPerAgent}`} help="How many messages each agent can send per breakout round.">
              <NumberField value={options.messagesPerAgent} onChange={(v) => updateOption('messagesPerAgent', v)} min={1} max={10} />
            </OptionField>
            <OptionField label={`Regroup Messages: ${options.regroupMessages}`} help="Messages each agent sends during the regroup phase after breakouts.">
              <NumberField value={options.regroupMessages} onChange={(v) => updateOption('regroupMessages', v)} min={0} max={5} />
            </OptionField>
            <OptionField label={`Whispers per Round: ${options.whispersPerRound}`} help="Private whispers each agent can send per breakout round.">
              <NumberField value={options.whispersPerRound} onChange={(v) => updateOption('whispersPerRound', v)} min={0} max={5} />
            </OptionField>
            <OptionField label={`Max Whisper Length: ${options.maxWhisperChars}`} help="Character limit for whisper messages.">
              <NumberField value={options.maxWhisperChars} onChange={(v) => updateOption('maxWhisperChars', v)} min={50} max={500} step={50} suffix=" chars" />
            </OptionField>
          </>
        )}

        {optionsTab === 'agents' && (
          <>
            <OptionField label={`Max Speech Tokens: ${options.maxSpeechTokens}`} help="Token limit for agent speech responses. Lower = shorter messages, cheaper games.">
              <NumberField value={options.maxSpeechTokens} onChange={(v) => updateOption('maxSpeechTokens', v)} min={50} max={1000} step={50} />
            </OptionField>
            <OptionField label={`Reasoning Budget: ${options.maxReasoningTokens}`} help="Token budget for agent reasoning (THINK blocks). Affects thinking model depth.">
              <NumberField value={options.maxReasoningTokens} onChange={(v) => updateOption('maxReasoningTokens', v)} min={256} max={4096} step={256} />
            </OptionField>
            <OptionField label={`Concurrent LLM Calls: ${options.maxConcurrentCalls}`} help="Max simultaneous API calls per provider. Higher = faster but may hit rate limits.">
              <NumberField value={options.maxConcurrentCalls} onChange={(v) => updateOption('maxConcurrentCalls', v)} min={1} max={10} />
            </OptionField>
            <OptionField label={`Max Game Cost: $${options.maxGameCost || '--'}`} help="Stop the game if API costs exceed this amount. 0 = unlimited.">
              <NumberField value={options.maxGameCost} onChange={(v) => updateOption('maxGameCost', v)} min={0} max={50} step={1} suffix="$" />
            </OptionField>
          </>
        )}

        {optionsTab === 'audio' && (
          <>
            <OptionField label={`Master Volume: ${options.masterVolume}%`} help="Controls all audio output.">
              <NumberField value={options.masterVolume} onChange={(v) => updateOption('masterVolume', v)} min={0} max={100} step={5} suffix="%" />
            </OptionField>
            <OptionField label={`Music Volume: ${options.musicVolume}%`} help="Background music in lobby and during gameplay.">
              <NumberField value={options.musicVolume} onChange={(v) => updateOption('musicVolume', v)} min={0} max={100} step={5} suffix="%" />
            </OptionField>
            <OptionField label={`Voice Volume: ${options.voiceVolume}%`} help="AI-generated character voices during replay narration.">
              <NumberField value={options.voiceVolume} onChange={(v) => updateOption('voiceVolume', v)} min={0} max={100} step={5} suffix="%" />
            </OptionField>
          </>
        )}

        {optionsTab === 'probabilities' && (
          <StubPanel title="Probability Tweaks" description="Fine-tune game mechanics: drunk information accuracy, poison effects, whisper overhear chance, Spy registration probabilities, and other programmatic percentages." />
        )}
        {optionsTab === 'api' && (
          <StubPanel title="API Key Management" description="Add, update, or remove API keys for Anthropic, OpenAI, and Google. Configure new models as providers release them. Keys are stored in the server .env file." />
        )}
        {optionsTab === 'voice' && (
          <VoicePanel games={games} />
        )}
        {optionsTab === 'stats' && (
          <StatsPanel
            shareStats={options.shareStats}
            revealModels={options.revealModels}
            onToggleShare={(v) => updateOption('shareStats', v)}
          />
        )}
      </div>
    </div>
  );

  // ── Render: Main menu ──────────────────────────────────────────────

  const menuView = (
    <>
      <div style={st.menuArea}>
        <button style={{ ...st.menuBtn, ...st.menuBtnPrimary }} onClick={() => setView('setup')}>
          Start Game
        </button>

        <button style={st.menuBtn} onClick={() => setView('options')}>
          Options
        </button>

        {games.length > 0 && (
          <button style={st.menuBtn} onClick={() => {
            document.getElementById('games-section')?.scrollIntoView({ behavior: 'smooth' });
          }}>
            Past Games ({games.length})
          </button>
        )}

        <button style={{ ...st.menuBtn, ...st.quitBtn }} onClick={() => window.close()}>
          Quit
        </button>
      </div>

      {/* Past games */}
      {(games.length > 0 || gamesError) && (
        <div id="games-section" style={st.gamesSection}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={st.label}>Past Games</span>
            <button style={st.smallBtn} onClick={() => void fetchGames()}>Refresh</button>
          </div>
          {gamesError && <div style={st.errorBox}>{gamesError}</div>}
          {gamesLoading ? (
            <div style={{ textAlign: 'center', color: '#8b7355', padding: 12, fontSize: '0.8rem' }}>Loading...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {games.map((g) => (
                <div key={g.game_id} onClick={() => navigateWithTransition(`/game/${g.game_id}`)} style={st.gameCard} role="button" tabIndex={0}>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#3d2812' }}>{g.game_id.slice(0, 8)}</span>
                  <span style={{
                    fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 8, textTransform: 'uppercase',
                    background: g.status === 'running' ? '#F59E0B22' : g.status === 'completed' ? '#10B98122' : '#EF444422',
                    color: g.status === 'running' ? '#92400E' : g.status === 'completed' ? '#065F46' : '#991B1B',
                  }}>{g.status}</span>
                  {g.winner && (
                    <span style={{
                      fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                      background: g.winner === 'good' ? '#3B82F622' : '#EF444422',
                      color: g.winner === 'good' ? '#1E40AF' : '#991B1B',
                    }}>{g.winner} wins</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );

  return (
    <>
      {showSplash && <SplashScreen onComplete={handleSplashComplete} />}
      {transitioning && <PageTransition onMidpoint={handleTransitionMidpoint} />}
      <div style={st.page}>
        <img src="/scroll_lg.jpg" alt="" style={st.scrollBg} />
        <div style={st.content}>
          {view === 'menu' && menuView}
          {view === 'setup' && setupView}
          {view === 'options' && optionsView}
        </div>
      </div>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const st: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    position: 'relative',
    display: 'flex',
    justifyContent: 'center',
    background: '#0a0806',
    overflow: 'auto',
  },
  scrollBg: {
    position: 'fixed',
    top: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    height: '100vh',
    maxWidth: '100vw',
    objectFit: 'contain',
    zIndex: 0,
    pointerEvents: 'none',
  },
  content: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%',
    maxWidth: 620,
    padding: '0 24px',
    paddingTop: '30vh',
  },
  menuArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  menuBtn: {
    background: 'rgba(92, 61, 26, 0.12)',
    border: '1px solid rgba(92, 61, 26, 0.35)',
    borderRadius: 3,
    padding: '8px 32px',
    color: '#2a1a0a',
    fontSize: '0.9rem',
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    minWidth: 220,
    textAlign: 'center',
  },
  menuBtnPrimary: {
    background: 'rgba(92, 61, 26, 0.2)',
    border: '2px solid rgba(92, 61, 26, 0.5)',
    fontSize: '1rem',
    padding: '10px 40px',
  },
  quitBtn: {
    marginTop: 8,
    background: 'rgba(92, 61, 26, 0.06)',
    border: '1px solid rgba(92, 61, 26, 0.2)',
    color: '#5a4630',
    fontSize: '0.8rem',
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: '#5a4630',
    fontSize: '0.75rem',
    fontWeight: 600,
    cursor: 'pointer',
    padding: '4px 0',
    marginBottom: 8,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  panelTitle: {
    fontSize: '0.95rem',
    fontWeight: 700,
    color: '#2a1a0a',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    textAlign: 'center',
    marginBottom: 16,
  },
  configGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 20,
  },
  field: { marginBottom: 12 },
  label: {
    display: 'block',
    fontSize: '0.65rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    color: '#3d2812',
    marginBottom: 4,
  },
  select: {
    width: '100%',
    background: 'rgba(92, 61, 26, 0.08)',
    border: '1px solid rgba(92, 61, 26, 0.25)',
    borderRadius: 3,
    color: '#2a1a0a',
    padding: '4px 6px',
    fontSize: '0.78rem',
  },
  smallBtn: {
    background: 'rgba(92, 61, 26, 0.08)',
    border: '1px solid rgba(92, 61, 26, 0.2)',
    borderRadius: 3,
    padding: '3px 8px',
    color: '#3d2812',
    fontSize: '0.68rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  toggleBtn: {
    flex: 1,
    border: 'none',
    padding: '5px 12px',
    color: '#2a1a0a',
    fontSize: '0.72rem',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  errorBox: {
    background: 'rgba(239, 68, 68, 0.12)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: 4,
    padding: '8px 12px',
    fontSize: '0.78rem',
    color: '#991B1B',
    marginBottom: 10,
    maxWidth: 360,
    textAlign: 'center',
  },
  gamesSection: { width: '100%', marginBottom: 20 },
  gameCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    background: 'rgba(92, 61, 26, 0.06)',
    border: '1px solid rgba(92, 61, 26, 0.12)',
    borderRadius: 3,
    cursor: 'pointer',
  },
  // Options tabs
  tabBar: {
    display: 'flex',
    gap: 2,
    flexWrap: 'wrap',
    marginBottom: 12,
    borderBottom: '1px solid rgba(92, 61, 26, 0.2)',
    paddingBottom: 2,
  },
  tab: {
    background: 'none',
    border: 'none',
    padding: '6px 10px',
    fontSize: '0.68rem',
    fontWeight: 600,
    color: '#8b7355',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    transition: 'color 0.15s, border-color 0.15s',
    letterSpacing: '0.03em',
  },
  tabActive: {
    color: '#2a1a0a',
    borderBottomColor: '#8b5e2a',
  },
  tabContent: {
    minHeight: 200,
  },
  optLabel: {
    display: 'block',
    fontSize: '0.72rem',
    fontWeight: 700,
    color: '#2a1a0a',
    marginBottom: 2,
  },
  optHelp: {
    fontSize: '0.62rem',
    color: '#8b7355',
    lineHeight: 1.4,
    marginBottom: 2,
  },
};
