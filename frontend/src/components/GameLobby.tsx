import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { listGames, createConfiguredGame } from '../api/rest.ts';
import type { GameListItem, SeatModelConfig } from '../api/rest.ts';

// ── Available models ──────────────────────────────────────────────────

const AVAILABLE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4.6', provider: 'anthropic' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { id: 'o3-mini', label: 'o3-mini', provider: 'openai' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google' },
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

// Roles keyed by script — only Trouble Brewing for now
const SCRIPT_ROLES: Record<string, RoleInfo[]> = {
  trouble_brewing: [
    // Townsfolk
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
    // Outsiders
    { id: 'butler', name: 'Butler', type: 'outsider' },
    { id: 'drunk', name: 'Drunk', type: 'outsider' },
    { id: 'recluse', name: 'Recluse', type: 'outsider' },
    { id: 'saint', name: 'Saint', type: 'outsider' },
    // Minions
    { id: 'poisoner', name: 'Poisoner', type: 'minion' },
    { id: 'spy', name: 'Spy', type: 'minion' },
    { id: 'scarlet_woman', name: 'Scarlet Woman', type: 'minion' },
    { id: 'baron', name: 'Baron', type: 'minion' },
    // Demon
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

// ── Distribution table ──────────────────────────────────────────────

const ROLE_DISTRIBUTION: Record<number, [number, number, number, number]> = {
  // [townsfolk, outsiders, minions, demons]
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

function getExpectedDistribution(playerCount: number, hasBaronOverride?: boolean): { t: number; o: number; m: number; d: number } {
  const [baseT, baseO, m, d] = ROLE_DISTRIBUTION[playerCount] ?? [0, 0, 0, 0];
  const hasBaron = hasBaronOverride ?? false;
  const t = hasBaron ? baseT - 2 : baseT;
  const o = hasBaron ? baseO + 2 : baseO;
  return { t, o, m, d };
}

// ── Validation ──────────────────────────────────────────────────────

function validateRoleAssignment(
  seatRoles: string[],
  playerCount: number,
  scriptId: string,
): string[] {
  const roles = SCRIPT_ROLES[scriptId];
  if (!roles) return ['Role assignment is only available for Trouble Brewing.'];

  const assigned = seatRoles.slice(0, playerCount);
  const warnings: string[] = [];

  // Count unassigned
  const unassigned = assigned.filter((r) => r === '').length;
  if (unassigned > 0) {
    warnings.push(`${unassigned} seat(s) have no role assigned.`);
    return warnings;
  }

  // Check duplicates
  const seen = new Set<string>();
  for (const id of assigned) {
    if (seen.has(id)) {
      const role = roles.find((r) => r.id === id);
      warnings.push(`Duplicate: ${role?.name ?? id}`);
    }
    seen.add(id);
  }

  // Count by type
  const counts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
  for (const id of assigned) {
    const role = roles.find((r) => r.id === id);
    if (role) counts[role.type]++;
  }

  const hasBaron = assigned.includes('baron');
  const expected = getExpectedDistribution(playerCount, hasBaron);

  if (counts.demon !== expected.d) {
    warnings.push(`Need exactly ${expected.d} Demon (have ${counts.demon}).`);
  }
  if (counts.minion !== expected.m) {
    warnings.push(`Need exactly ${expected.m} Minion(s) (have ${counts.minion}).`);
  }
  if (counts.townsfolk !== expected.t) {
    warnings.push(`Need ${expected.t} Townsfolk (have ${counts.townsfolk}).`);
  }
  if (counts.outsider !== expected.o) {
    warnings.push(`Need ${expected.o} Outsider(s) (have ${counts.outsider}).`);
  }

  return warnings;
}

// ── Seat row (random mode) ──────────────────────────────────────────

function SeatRow({ seat, model, onChange }: { seat: number; model: string; onChange: (m: string) => void }) {
  const selected = AVAILABLE_MODELS.find((m) => m.id === model);
  const color = selected ? PROVIDER_COLORS[selected.provider] : '#6B7280';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: 20, height: 20, borderRadius: '50%', background: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.6rem', fontWeight: 700, color: '#1a0e04', flexShrink: 0,
      }}>{seat}</div>
      <select value={model} onChange={(e) => onChange(e.target.value)} style={s.select}>
        {AVAILABLE_MODELS.map((m) => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>
    </div>
  );
}

// ── Seat row (assigned mode) ────────────────────────────────────────

function AssignedSeatRow({
  seat, model, roleId, scriptId, usedRoles,
  onModelChange, onRoleChange,
}: {
  seat: number;
  model: string;
  roleId: string;
  scriptId: string;
  usedRoles: Set<string>;
  onModelChange: (m: string) => void;
  onRoleChange: (r: string) => void;
}) {
  const selected = AVAILABLE_MODELS.find((m) => m.id === model);
  const modelColor = selected ? PROVIDER_COLORS[selected.provider] : '#6B7280';
  const roles = SCRIPT_ROLES[scriptId] ?? [];
  const currentRole = roles.find((r) => r.id === roleId);
  const roleColor = currentRole ? ROLE_TYPE_COLORS[currentRole.type] : '#6B7280';

  // Group roles by type for optgroup
  const grouped = new Map<string, RoleInfo[]>();
  for (const r of roles) {
    const list = grouped.get(r.type) ?? [];
    list.push(r);
    grouped.set(r.type, list);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{
        width: 18, height: 18, borderRadius: '50%', background: modelColor,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.55rem', fontWeight: 700, color: '#1a0e04', flexShrink: 0,
      }}>{seat}</div>
      <select value={model} onChange={(e) => onModelChange(e.target.value)}
        style={{ ...s.select, flex: '1 1 45%', fontSize: '0.7rem', padding: '3px 4px' }}>
        {AVAILABLE_MODELS.map((m) => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>
      <select value={roleId} onChange={(e) => onRoleChange(e.target.value)}
        style={{
          ...s.select, flex: '1 1 45%', fontSize: '0.7rem', padding: '3px 4px',
          borderLeft: `3px solid ${roleColor}`,
        }}>
        <option value="">-- role --</option>
        {Array.from(grouped.entries()).map(([type, typeRoles]) => (
          <optgroup key={type} label={ROLE_TYPE_LABELS[type]}>
            {typeRoles.map((r) => {
              const taken = usedRoles.has(r.id) && r.id !== roleId;
              return (
                <option key={r.id} value={r.id} disabled={taken}
                  style={{ color: taken ? '#aaa' : undefined }}>
                  {r.name}{taken ? ' (taken)' : ''}
                </option>
              );
            })}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

// ── Distribution summary ────────────────────────────────────────────

function DistributionSummary({ playerCount, seatRoles, roleMode, scriptId }: {
  playerCount: number;
  seatRoles: string[];
  roleMode: 'random' | 'assigned';
  scriptId: string;
}) {
  const base = getExpectedDistribution(playerCount, false);
  const withBaron = getExpectedDistribution(playerCount, true);

  // Current assignment counts (only in assigned mode)
  const roles = SCRIPT_ROLES[scriptId] ?? [];
  const assigned = seatRoles.slice(0, playerCount);
  const counts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
  for (const id of assigned) {
    const role = roles.find((r) => r.id === id);
    if (role) counts[role.type]++;
  }

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
          return (
            <span key={type} style={{ color: isOk ? '#5a4630' : '#991B1B', fontWeight: isOk ? 400 : 700 }}>
              <span style={{ color: ROLE_TYPE_COLORS[type], fontWeight: 700 }}>
                {exp}{type[0].toUpperCase()}
              </span>
              {roleMode === 'assigned' && ` (${cur})`}
            </span>
          );
        })}
      </div>
      {hasBaron && (
        <div style={{ fontStyle: 'italic', color: '#8b7355', marginTop: 2 }}>
          Baron: +2 Outsiders, -2 Townsfolk
        </div>
      )}
      <div style={{ color: '#8b7355', marginTop: 2 }}>
        Base: {base.t}T {base.o}O {base.m}M {base.d}D
        {base.o !== withBaron.o && ` | w/ Baron: ${withBaron.t}T ${withBaron.o}O ${withBaron.m}M ${withBaron.d}D`}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────

export function GameLobby() {
  const navigate = useNavigate();
  const [playerCount, setPlayerCount] = useState(7);
  const [script, setScript] = useState(SCRIPTS[0].value);
  const [seatModels, setSeatModels] = useState<string[]>(Array(15).fill(AVAILABLE_MODELS[0].id));
  const [seatRoles, setSeatRoles] = useState<string[]>(Array(15).fill(''));
  const [roleMode, setRoleMode] = useState<'random' | 'assigned'>('random');
  const [showConfig, setShowConfig] = useState(false);

  const [games, setGames] = useState<GameListItem[]>([]);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchGames = useCallback(async () => {
    try { setGames(await listGames()); setGamesError(null); }
    catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setGamesError(msg.includes('fetch') || msg.includes('Network') ? 'Cannot connect to server' : msg);
    } finally { setGamesLoading(false); }
  }, []);

  useEffect(() => {
    void fetchGames();
    pollRef.current = setInterval(() => void fetchGames(), POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchGames]);

  const handleModelChange = useCallback((seat: number, model: string) => {
    setSeatModels((prev) => { const next = [...prev]; next[seat] = model; return next; });
  }, []);

  const handleRoleChange = useCallback((seat: number, role: string) => {
    setSeatRoles((prev) => { const next = [...prev]; next[seat] = role; return next; });
  }, []);

  const fillAllWith = useCallback((model: string) => { setSeatModels(Array(15).fill(model)); }, []);

  // Compute used roles set for preventing duplicates
  const usedRoles = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < playerCount; i++) {
      if (seatRoles[i]) set.add(seatRoles[i]);
    }
    return set;
  }, [seatRoles, playerCount]);

  // Validation warnings for assigned mode
  const roleWarnings = useMemo(() => {
    if (roleMode !== 'assigned') return [];
    return validateRoleAssignment(seatRoles, playerCount, script);
  }, [roleMode, seatRoles, playerCount, script]);

  // "Team vs Team" preset: evil seats first, then good
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
    // Assign evil seats first
    for (let i = 0; i < dist.d && seat < playerCount; i++) {
      newRoles[seat++] = demons[i]?.id ?? '';
    }
    for (let i = 0; i < dist.m && seat < playerCount; i++) {
      newRoles[seat++] = minions[i]?.id ?? '';
    }
    // Then good seats
    for (let i = 0; i < dist.t && seat < playerCount; i++) {
      newRoles[seat++] = townsfolk[i]?.id ?? '';
    }
    for (let i = 0; i < dist.o && seat < playerCount; i++) {
      newRoles[seat++] = outsiders[i]?.id ?? '';
    }

    setSeatRoles(newRoles);
    setRoleMode('assigned');
  }, [script, playerCount]);

  const handleStart = useCallback(async () => {
    setStarting(true); setStartError(null);

    // Block start if assigned mode has validation errors
    if (roleMode === 'assigned' && roleWarnings.length > 0) {
      setStartError('Fix role assignment errors before starting.');
      setStarting(false);
      return;
    }

    try {
      const seed = Math.floor(Math.random() * 100_000);
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
        max_days: 50,
        reveal_models: true,
      });
      navigate(`/game/${result.game_id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      if (msg.includes('fetch') || msg.includes('Network')) setStartError('Cannot connect to server.');
      else if (msg.includes('API keys') || msg.includes('Missing')) setStartError('Missing API keys. Add to .env.');
      else setStartError(msg);
    } finally { setStarting(false); }
  }, [playerCount, script, seatModels, seatRoles, roleMode, roleWarnings, navigate]);

  const isAssignedAvailable = script in SCRIPT_ROLES;

  return (
    <div style={s.page}>
      {/* Scroll background */}
      <img src="/scroll_lg.jpg" alt="" style={s.scrollBg} />

      {/* Content area */}
      <div style={s.content}>
        {/* Menu buttons */}
        <div style={s.menuArea}>
          <button
            style={{ ...s.menuBtn, ...s.menuBtnPrimary, opacity: starting ? 0.5 : 1 }}
            onClick={() => void handleStart()}
            disabled={starting}
          >
            {starting ? '... Summoning Agents ...' : 'Start Game'}
          </button>

          <button style={s.menuBtn} onClick={() => setShowConfig(!showConfig)}>
            {showConfig ? 'Hide Options' : 'Options'}
          </button>

          {games.length > 0 && (
            <button style={s.menuBtn} onClick={() => {
              document.getElementById('games-section')?.scrollIntoView({ behavior: 'smooth' });
            }}>
              Past Games ({games.length})
            </button>
          )}
        </div>

        {startError && <div style={s.errorBox}>{startError}</div>}

        {/* Config panel */}
        {showConfig && (
          <div style={s.configPanel}>
            <div style={s.configGrid}>
              {/* Left: Script + Players + Quick Fill + Role Mode */}
              <div>
                <div style={s.field}>
                  <label style={s.label}>Script</label>
                  <select value={script} onChange={(e) => setScript(e.target.value)} style={s.select}>
                    {SCRIPTS.map((sc) => (
                      <option key={sc.value} value={sc.value}>
                        {sc.label}{sc.note ? ` (${sc.note})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={s.field}>
                  <label style={s.label}>Players</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="range" min={5} max={15} value={playerCount}
                      onChange={(e) => setPlayerCount(Number(e.target.value))}
                      style={{ flex: 1, accentColor: '#8b5e2a' }}
                    />
                    <span style={{ fontFamily: 'monospace', fontSize: '1.1rem', color: '#2a1a0a', fontWeight: 700 }}>
                      {playerCount}
                    </span>
                  </div>
                </div>

                <div style={s.field}>
                  <label style={s.label}>Quick Fill</label>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {QUICK_FILL_PRESETS.map((preset) => (
                      <button key={preset.label} style={{
                        ...s.smallBtn,
                        borderLeft: `3px solid ${preset.modelId === '__mixed__' ? '#8b5e2a' : PROVIDER_COLORS[preset.provider] ?? '#6B7280'}`,
                      }} onClick={() => {
                        if (preset.modelId === '__mixed__') setSeatModels(buildMixedSeatModels(15));
                        else fillAllWith(preset.modelId);
                      }}>
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Role Mode Toggle */}
                <div style={s.field}>
                  <label style={s.label}>Role Assignment</label>
                  <div style={{ display: 'flex', gap: 0, borderRadius: 3, overflow: 'hidden', border: '1px solid rgba(92, 61, 26, 0.25)' }}>
                    <button
                      style={{
                        ...s.toggleBtn,
                        background: roleMode === 'random' ? 'rgba(92, 61, 26, 0.2)' : 'transparent',
                        fontWeight: roleMode === 'random' ? 700 : 400,
                      }}
                      onClick={() => setRoleMode('random')}
                    >
                      Random
                    </button>
                    <button
                      style={{
                        ...s.toggleBtn,
                        background: roleMode === 'assigned' ? 'rgba(92, 61, 26, 0.2)' : 'transparent',
                        fontWeight: roleMode === 'assigned' ? 700 : 400,
                        opacity: isAssignedAvailable ? 1 : 0.4,
                      }}
                      onClick={() => { if (isAssignedAvailable) setRoleMode('assigned'); }}
                      disabled={!isAssignedAvailable}
                      title={isAssignedAvailable ? undefined : 'Only available for Trouble Brewing'}
                    >
                      Assigned
                    </button>
                  </div>
                </div>

                {/* Role presets (only in assigned mode) */}
                {roleMode === 'assigned' && (
                  <div style={s.field}>
                    <label style={s.label}>Role Presets</label>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      <button style={{
                        ...s.smallBtn,
                        borderLeft: '3px solid #EF4444',
                      }} onClick={applyTeamVsTeamPreset}>
                        Team vs Team
                      </button>
                    </div>
                  </div>
                )}

                {/* Distribution summary */}
                <DistributionSummary
                  playerCount={playerCount}
                  seatRoles={seatRoles}
                  roleMode={roleMode}
                  scriptId={script}
                />

                {/* Validation warnings */}
                {roleMode === 'assigned' && roleWarnings.length > 0 && (
                  <div style={{
                    marginTop: 6, padding: '6px 8px', borderRadius: 3,
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                  }}>
                    {roleWarnings.map((w, i) => (
                      <div key={i} style={{ fontSize: '0.62rem', color: '#991B1B', lineHeight: 1.4 }}>{w}</div>
                    ))}
                  </div>
                )}

                <p style={{ fontSize: '0.65rem', color: '#8b7355', marginTop: 6 }}>
                  API keys loaded from server .env
                </p>
              </div>

              {/* Right: Seats */}
              <div>
                <label style={s.label}>
                  Seat Assignments {roleMode === 'assigned' && '(Model + Role)'}
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 320, overflowY: 'auto' }}>
                  {roleMode === 'random' ? (
                    Array.from({ length: playerCount }, (_, i) => (
                      <SeatRow key={i} seat={i} model={seatModels[i]} onChange={(m) => handleModelChange(i, m)} />
                    ))
                  ) : (
                    Array.from({ length: playerCount }, (_, i) => (
                      <AssignedSeatRow
                        key={i}
                        seat={i}
                        model={seatModels[i]}
                        roleId={seatRoles[i]}
                        scriptId={script}
                        usedRoles={usedRoles}
                        onModelChange={(m) => handleModelChange(i, m)}
                        onRoleChange={(r) => handleRoleChange(i, r)}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Past games */}
        {(games.length > 0 || gamesError) && (
          <div id="games-section" style={s.gamesSection}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={s.label}>Past Games</span>
              <button style={s.smallBtn} onClick={() => void fetchGames()}>Refresh</button>
            </div>
            {gamesError && <div style={s.errorBox}>{gamesError}</div>}
            {gamesLoading ? (
              <div style={{ textAlign: 'center', color: '#8b7355', padding: 12, fontSize: '0.8rem' }}>Loading...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {games.map((g) => (
                  <div key={g.game_id} onClick={() => navigate(`/game/${g.game_id}`)}
                    style={s.gameCard} role="button" tabIndex={0}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#3d2812' }}>
                      {g.game_id.slice(0, 8)}
                    </span>
                    <span style={{
                      fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                      textTransform: 'uppercase',
                      background: g.status === 'running' ? '#F59E0B22' : g.status === 'completed' ? '#10B98122' : '#EF444422',
                      color: g.status === 'running' ? '#92400E' : g.status === 'completed' ? '#065F46' : '#991B1B',
                    }}>
                      {g.status}
                    </span>
                    {g.winner && (
                      <span style={{
                        fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                        background: g.winner === 'good' ? '#3B82F622' : '#EF444422',
                        color: g.winner === 'good' ? '#1E40AF' : '#991B1B',
                      }}>
                        {g.winner} wins
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
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
    paddingTop: '22vh',
  },
  subtitle: {
    fontSize: '0.85rem',
    color: '#3d2812',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    fontWeight: 700,
    marginBottom: 24,
    textAlign: 'center',
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
  configPanel: {
    width: '100%',
    marginBottom: 16,
  },
  configGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 20,
  },
  field: {
    marginBottom: 12,
  },
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
  gamesSection: {
    width: '100%',
    marginBottom: 20,
  },
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
};
