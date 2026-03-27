import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { listGames, createConfiguredGame, getModelStats, getAudioManifest, generateGameAudio, startMonitor, listMonitors } from '../api/rest.ts';
import type { GameListItem, SeatModelConfig, ModelStatsResponse } from '../api/rest.ts';
import type { MonitorResult } from '../types/monitor.ts';
import { useGameStore } from '../stores/gameStore.ts';
import { CHARACTERS_SORTED } from '../data/characters.ts';
import { SplashScreen } from './SplashScreen.tsx';
import { PageTransition } from './PageTransition.tsx';
import { CreditBalanceInline, CreditPurchaseModal } from './CreditSystem.tsx';
import { estimateCost, getCreditBalance } from '../api/rest.ts';

// ── Available models ──────────────────────────────────────────────────

const AVAILABLE_MODELS = [
  // Anthropic (first-party)
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4.6', provider: 'anthropic' },
  // OpenAI (first-party)
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
  { id: 'o3-mini', label: 'o3-mini', provider: 'openai' },
  { id: 'o4-mini', label: 'o4-mini', provider: 'openai' },
  { id: 'gpt-4.1', label: 'GPT-4.1', provider: 'openai' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'openai' },
  { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', provider: 'openai' },
  // Google (first-party)
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', provider: 'google' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', provider: 'google' },
  // OpenRouter — non-first-party models only
  { id: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B (OR)', provider: 'openrouter' },
  { id: 'mistralai/mistral-large', label: 'Mistral Large (OR)', provider: 'openrouter' },
  { id: 'moonshotai/kimi-k2', label: 'Kimi K2 (OR)', provider: 'openrouter' },
  { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1 (OR)', provider: 'openrouter' },
  { id: 'qwen/qwen3-235b-a22b', label: 'Qwen3 235B (OR)', provider: 'openrouter' },
  { id: 'x-ai/grok-4.20-beta', label: 'Grok 4.20 (OR)', provider: 'openrouter' },
];

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#D97706',
  openai: '#10B981',
  google: '#3B82F6',
  openrouter: '#9333EA',
};

const SCRIPTS: { label: string; value: string; note?: string }[] = [
  { label: 'Trouble Brewing', value: 'trouble_brewing' },
];

function buildMixedSeatModels(count: number): string[] {
  // Round-robin across Stripe-eligible models
  const mixedOrder = ['claude-haiku-4-5-20251001', 'gpt-4o', 'gemini-3-flash-preview', 'o4-mini', 'gpt-5.4-mini'];
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
  townsfolk: '#6b5840',
  outsider: '#5c3d1a',
  minion: '#b34a28',
  demon: '#991B1B',
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
  const randomCount = assigned.filter((r) => r === '').length;

  // Check duplicates among assigned roles
  const seen = new Set<string>();
  for (const id of assigned) {
    if (!id) continue;
    if (seen.has(id)) { const role = roles.find((r) => r.id === id); warnings.push(`Duplicate: ${role?.name ?? id}`); }
    seen.add(id);
  }

  // Count assigned roles by type
  const counts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
  for (const id of assigned) { if (!id) continue; const role = roles.find((r) => r.id === id); if (role) counts[role.type]++; }
  const hasBaron = assigned.includes('baron');
  const expected = getExpectedDistribution(playerCount, hasBaron);

  // Only warn about over-assignment (under-assignment is fine — random fills the gap)
  if (counts.demon > expected.d) warnings.push(`Too many Demons (${counts.demon} > ${expected.d}).`);
  if (counts.minion > expected.m) warnings.push(`Too many Minions (${counts.minion} > ${expected.m}).`);
  if (counts.townsfolk > expected.t) warnings.push(`Too many Townsfolk (${counts.townsfolk} > ${expected.t}).`);
  if (counts.outsider > expected.o) warnings.push(`Too many Outsiders (${counts.outsider} > ${expected.o}).`);

  // Info message for random seats (not an error)
  if (randomCount > 0 && randomCount < playerCount) {
    warnings.push(`${randomCount} seat(s) will be randomly assigned.`);
  }
  return warnings;
}

// ── Character select (shared by both seat row types) ────────────────

function CharacterSelect({ spriteId, usedCharacters, onChange }: {
  spriteId: number | null;
  usedCharacters: Set<number>;
  onChange: (id: number | null) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 40%' }}>
      {spriteId != null && (
        <img
          src={`/sprites/sprite_${spriteId}.gif`}
          alt=""
          style={{ width: 28, height: 28, imageRendering: 'pixelated' as any, flexShrink: 0 }}
        />
      )}
      <select
        value={spriteId ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        style={{ ...st.select, flex: 1, fontSize: '0.65rem', padding: '3px 4px' }}
      >
        <option value="">-- random --</option>
        {CHARACTERS_SORTED.map((c) => {
          const taken = usedCharacters.has(c.spriteId) && c.spriteId !== spriteId;
          return (
            <option key={c.spriteId} value={c.spriteId} disabled={taken} style={{ color: taken ? '#aaa' : undefined }}>
              {c.name}{taken ? ' (taken)' : ''}
            </option>
          );
        })}
      </select>
    </div>
  );
}

// ── Model select with Stripe/API grouping ───────────────────────────

function ModelSelect({ value, onChange, style: extraStyle }: {
  value: string; onChange: (m: string) => void; style?: React.CSSProperties;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...st.select, ...extraStyle }}>
      {AVAILABLE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
    </select>
  );
}

// ── Seat rows ───────────────────────────────────────────────────────

function SeatRow({ seat, model, spriteId, usedCharacters, onChange, onCharChange }: {
  seat: number; model: string; spriteId: number | null; usedCharacters: Set<number>;
  onChange: (m: string) => void; onCharChange: (id: number | null) => void;
}) {
  const selected = AVAILABLE_MODELS.find((m) => m.id === model);
  const provColor = selected ? PROVIDER_COLORS[selected.provider] : '#5c3d1a';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#3d2812', border: `2px solid ${provColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: '#c9a84c', flexShrink: 0 }}>{seat}</div>
      <ModelSelect value={model} onChange={onChange} style={{ flex: '1 1 45%' }} />
      <CharacterSelect spriteId={spriteId} usedCharacters={usedCharacters} onChange={onCharChange} />
    </div>
  );
}

function AssignedSeatRow({ seat, model, roleId, scriptId, spriteId, usedRoles, usedCharacters, onModelChange, onRoleChange, onCharChange }: {
  seat: number; model: string; roleId: string; scriptId: string; spriteId: number | null;
  usedRoles: Set<string>; usedCharacters: Set<number>;
  onModelChange: (m: string) => void; onRoleChange: (r: string) => void; onCharChange: (id: number | null) => void;
}) {
  const selected = AVAILABLE_MODELS.find((m) => m.id === model);
  const modelColor = selected ? PROVIDER_COLORS[selected.provider] : '#5c3d1a';
  const roles = SCRIPT_ROLES[scriptId] ?? [];
  const currentRole = roles.find((r) => r.id === roleId);
  const roleColor = currentRole ? ROLE_TYPE_COLORS[currentRole.type] : '#5c3d1a';
  const grouped = new Map<string, RoleInfo[]>();
  for (const r of roles) { const list = grouped.get(r.type) ?? []; list.push(r); grouped.set(r.type, list); }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#3d2812', border: `2px solid ${modelColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 700, color: '#c9a84c', flexShrink: 0 }}>{seat}</div>
      <ModelSelect value={model} onChange={onModelChange} style={{ flex: '1 1 30%', fontSize: '0.7rem', padding: '3px 4px' }} />
      <select value={roleId} onChange={(e) => onRoleChange(e.target.value)} style={{ ...st.select, flex: '1 1 30%', fontSize: '0.7rem', padding: '3px 4px', borderLeft: `3px solid ${roleColor}` }}>
        <option value="">-- random --</option>
        {Array.from(grouped.entries()).map(([type, typeRoles]) => (
          <optgroup key={type} label={ROLE_TYPE_LABELS[type]}>
            {typeRoles.map((r) => { const taken = usedRoles.has(r.id) && r.id !== roleId; return <option key={r.id} value={r.id} disabled={taken} style={{ color: taken ? '#aaa' : undefined }}>{r.name}{taken ? ' (taken)' : ''}</option>; })}
          </optgroup>
        ))}
      </select>
      <CharacterSelect spriteId={spriteId} usedCharacters={usedCharacters} onChange={onCharChange} />
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
    <div style={{ fontSize: 13, color: '#3d2812', lineHeight: 1.7, marginTop: 8 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Required for {playerCount} players:</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {(['townsfolk', 'outsider', 'minion', 'demon'] as const).map((type) => {
          const exp = type === 'townsfolk' ? expected.t : type === 'outsider' ? expected.o : type === 'minion' ? expected.m : expected.d;
          const cur = counts[type];
          const isOk = roleMode === 'random' || cur === exp;
          const fullName = ROLE_TYPE_LABELS[type] ?? type;
          return (
            <span key={type} style={{ color: isOk ? '#3d2812' : '#991B1B', fontWeight: isOk ? 400 : 700 }}>
              <span style={{ color: ROLE_TYPE_COLORS[type], fontWeight: 700 }}>{exp}</span> {fullName}{roleMode === 'assigned' ? ` (${cur} assigned)` : ''}
            </span>
          );
        })}
      </div>
      {hasBaron && <div style={{ fontStyle: 'italic', color: '#5a4630', marginTop: 4, fontSize: 12 }}>Baron: +2 Outsiders, -2 Townsfolk</div>}
    </div>
  );
}

// ── Admin mode ──────────────────────────────────────────────────────
// Activated by entering a passphrase. Triple-click the title to open
// the prompt. Session persists to localStorage until explicitly cleared.

const ADMIN_HASH = import.meta.env.VITE_ADMIN_HASH ?? '';

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function useAdminMode() {
  const [isAdmin, setIsAdmin] = useState(
    () => localStorage.getItem('bloodbench_admin') === '1',
  );

  const authenticate = useCallback(async (passphrase: string): Promise<boolean> => {
    const hash = await sha256(passphrase);
    if (hash === ADMIN_HASH) {
      localStorage.setItem('bloodbench_admin', '1');
      setIsAdmin(true);
      return true;
    }
    return false;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('bloodbench_admin');
    setIsAdmin(false);
  }, []);

  return { isAdmin, authenticate, logout };
}

function AdminPassphraseModal({ onSubmit, onClose }: { onSubmit: (pw: string) => void; onClose: () => void }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.6)', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: '#1a1a2e', border: '2px solid #c9a84c', borderRadius: 10,
        padding: '28px 32px', minWidth: 280, textAlign: 'center',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '0.9rem', marginBottom: 16 }}>
          Storyteller Access
        </div>
        <form onSubmit={e => { e.preventDefault(); onSubmit(value); }}>
          <input
            ref={inputRef}
            type="password"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Passphrase"
            style={{
              width: '100%', padding: '8px 12px', boxSizing: 'border-box',
              background: '#0a0806', border: '1px solid #5c3d1a', borderRadius: 4,
              color: '#e8d5a3', fontSize: '0.85rem', fontFamily: 'monospace',
              outline: 'none',
            }}
          />
          <button type="submit" style={{
            marginTop: 12, width: '100%', padding: '8px 0',
            background: '#5c3d1a', color: '#e8d5a3', border: 'none',
            borderRadius: 4, fontSize: '0.8rem', fontFamily: 'Georgia, serif',
            cursor: 'pointer',
          }}>
            Enter
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Options tabs ─────────────────────────────────────────────────────

type OptionsTab = 'rules' | 'conversation' | 'agents' | 'audio' | 'fun' | 'monitor' | 'wager' | 'probabilities' | 'api' | 'voice' | 'stats';

const OPTIONS_TABS: { id: OptionsTab; label: string; stub?: boolean; adminOnly?: boolean }[] = [
  { id: 'rules', label: 'Game Rules' },
  { id: 'conversation', label: 'Conversation', adminOnly: true },
  { id: 'agents', label: 'Agent Tuning', adminOnly: true },
  { id: 'audio', label: 'Audio' },
  { id: 'fun', label: 'Fun', adminOnly: true },
  { id: 'monitor', label: 'Monitor', adminOnly: true },
  { id: 'wager', label: "Crown's Wager", adminOnly: true },
  { id: 'probabilities', label: 'Probabilities', stub: true, adminOnly: true },
  { id: 'api', label: 'API Keys' },
  { id: 'voice', label: 'Voice', adminOnly: true },
  { id: 'stats', label: 'Stats', adminOnly: true },
];

const SPEECH_STYLE_PRESETS: { id: string; label: string; description: string; prompt: string }[] = [
  { id: '', label: 'Normal', description: 'Default medieval villager speech', prompt: '' },
  {
    id: 'macbeth',
    label: 'Macbeth',
    description: 'Shakespearean iambic pentameter in the style of Macbeth',
    prompt: `You MUST speak exclusively in Shakespearean iambic pentameter, in the style of Macbeth. Every line of dialogue in your <SAY> tags must be written as blank verse — ten syllables per line, alternating unstressed and stressed syllables. Use "thee", "thou", "hath", "doth", "ere", "whence", "forsooth", "'tis", and other Early Modern English vocabulary. Reference blood, daggers, prophecy, ambition, guilt, and darkness. Deliver accusations as if condemning a traitor before the throne. Deliver defenses as tortured soliloquies. This is mandatory for ALL speech.`,
  },
  {
    id: 'noir',
    label: 'Film Noir',
    description: 'Hard-boiled 1940s detective narration',
    prompt: `You MUST speak in the style of a 1940s film noir detective. Use hard-boiled, cynical narration. Short, punchy sentences. Refer to other players as "dames", "mugs", "palookas", or "wise guys". Describe everything in rain-soaked metaphors. Talk about "this rotten town" and how "nobody's clean". Smoke metaphorical cigarettes. Every accusation should sound like you're cracking a case. Every defense like a suspect in an interrogation room.`,
  },
  {
    id: 'pirate',
    label: 'Pirate',
    description: 'Swashbuckling pirate crew on a cursed ship',
    prompt: `You MUST speak as a swashbuckling pirate. Use "arr", "ye", "matey", "scallywag", "bilge rat", "landlubber", "shiver me timbers", "walk the plank", "Davy Jones' locker", and other pirate vocabulary. Refer to the town as "the ship" or "this cursed vessel". Accusations are demands to "keelhaul" or "maroon" the accused. Everything is about treasure, mutiny, the sea, rum, and the pirate code.`,
  },
  {
    id: 'reality_tv',
    label: 'Reality TV',
    description: 'Over-dramatic reality show confessionals',
    prompt: `You MUST speak as a contestant on a trashy reality TV show. Use dramatic confessional-style monologues. Say things like "I'm not here to make friends", "that's sus", "receipts don't lie", and "the tea is SCALDING". Be petty, dramatic, and shade-throwing. Reference alliances, blindsides, and "playing the game". Accusations should sound like reunion show callouts. Every speech should feel like it ends with a dramatic music sting.`,
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Write your own speech style prompt',
    prompt: '',
  },
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
              const provColor = PROVIDER_COLORS[provider] ?? '#5c3d1a';
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

// ── Monitor panel ────────────────────────────────────────────────────

type MonitorSubTab = 'run' | 'results' | 'batch' | 'compare' | 'settings';

const MONITOR_SUB_TABS: { id: MonitorSubTab; label: string; stub?: boolean }[] = [
  { id: 'run', label: 'Run Monitor' },
  { id: 'results', label: 'Results' },
  { id: 'batch', label: 'Batch Run', stub: true },
  { id: 'compare', label: 'Compare Models', stub: true },
  { id: 'settings', label: 'Settings', stub: true },
];

const MONITOR_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic', cost: '$' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4.6', provider: 'anthropic', cost: '$$' },
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4.6', provider: 'anthropic', cost: '$$$' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai', cost: '$' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai', cost: '$$' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'openai', cost: '$' },
  { id: 'gpt-4.1', label: 'GPT-4.1', provider: 'openai', cost: '$$' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', provider: 'openai', cost: '$' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google', cost: '$' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google', cost: '$$' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', provider: 'google', cost: '$' },
];

function MonitorOptionsPanel({ games }: { games: GameListItem[] }) {
  const [subTab, setSubTab] = useState<MonitorSubTab>('run');
  const [selectedModel, setSelectedModel] = useState(MONITOR_MODELS[0].id);
  const [includeGroups, setIncludeGroups] = useState(false);
  const [monitorStatus, setMonitorStatus] = useState<Record<string, 'idle' | 'running' | 'done' | 'error'>>({});
  const [monitorResults, setMonitorResults] = useState<Record<string, MonitorResult[]>>({});
  const [monitorErrors, setMonitorErrors] = useState<Record<string, string>>({});

  const completedGames = games.filter(g => g.status === 'completed');

  // Load existing monitor results on mount
  useEffect(() => {
    for (const g of completedGames) {
      listMonitors(g.game_id)
        .then((results) => {
          if (results.length > 0) {
            setMonitorResults(prev => ({ ...prev, [g.game_id]: results }));
            setMonitorStatus(prev => ({ ...prev, [g.game_id]: 'done' }));
          }
        })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedGames.length]);

  const handleRunMonitor = async (gameId: string) => {
    const model = MONITOR_MODELS.find(m => m.id === selectedModel);
    if (!model) return;

    setMonitorStatus(prev => ({ ...prev, [gameId]: 'running' }));
    setMonitorErrors(prev => { const n = { ...prev }; delete n[gameId]; return n; });

    try {
      await startMonitor(gameId, {
        provider: model.provider,
        model: model.id,
        temperature: 0.3,
        include_groups: includeGroups,
      });
      // Poll for completion
      const poll = setInterval(async () => {
        try {
          const results = await listMonitors(gameId);
          const latest = results[results.length - 1];
          if (latest && latest.config.model === model.id) {
            clearInterval(poll);
            setMonitorResults(prev => ({ ...prev, [gameId]: results }));
            setMonitorStatus(prev => ({ ...prev, [gameId]: 'done' }));
          }
        } catch { /* keep polling */ }
      }, 3000);
      // Safety timeout
      setTimeout(() => clearInterval(poll), 300_000);
    } catch (err) {
      setMonitorStatus(prev => ({ ...prev, [gameId]: 'error' }));
      setMonitorErrors(prev => ({
        ...prev,
        [gameId]: err instanceof Error ? err.message : 'Failed to start monitor',
      }));
    }
  };

  const modelInfo = MONITOR_MODELS.find(m => m.id === selectedModel);

  const subTabBarStyle: React.CSSProperties = {
    display: 'flex', gap: 0, marginBottom: 12, borderRadius: 3,
    overflow: 'hidden', border: '1px solid rgba(92, 61, 26, 0.2)', width: 'fit-content',
  };
  const subTabStyle: React.CSSProperties = {
    padding: '4px 10px', fontSize: '0.62rem', fontWeight: 500, cursor: 'pointer',
    background: 'transparent', border: 'none', color: '#5c3d1a',
    borderRight: '1px solid rgba(92, 61, 26, 0.15)',
  };
  const subTabActiveStyle: React.CSSProperties = {
    background: 'rgba(139, 94, 42, 0.15)', fontWeight: 700, color: '#8b5e2a',
  };

  if (subTab === 'batch') {
    return (
      <div>
        <div style={subTabBarStyle}>
          {MONITOR_SUB_TABS.map(t => (
            <button key={t.id} style={{ ...subTabStyle, ...(subTab === t.id ? subTabActiveStyle : {}), ...(t.id === MONITOR_SUB_TABS[MONITOR_SUB_TABS.length - 1].id ? { borderRight: 'none' } : {}) }}
              onClick={() => setSubTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <StubPanel title="Batch Monitor Runs" description="Queue monitor runs across multiple games at once. Select games, choose one or more models, and let them run in parallel. Useful for benchmarking a model's deception detection across your full game library." />
      </div>
    );
  }

  if (subTab === 'compare') {
    return (
      <div>
        <div style={subTabBarStyle}>
          {MONITOR_SUB_TABS.map(t => (
            <button key={t.id} style={{ ...subTabStyle, ...(subTab === t.id ? subTabActiveStyle : {}), ...(t.id === MONITOR_SUB_TABS[MONITOR_SUB_TABS.length - 1].id ? { borderRight: 'none' } : {}) }}
              onClick={() => setSubTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <StubPanel title="Multi-Model Comparison" description="Run the same game through 2-5 different monitor models side-by-side. Compare deception detection scores, analysis quality, cost efficiency, and where each model's suspicions diverge. Export comparison tables." />
      </div>
    );
  }

  if (subTab === 'results') {
    const gamesWithMonitors = completedGames.filter(g => (monitorResults[g.game_id] ?? []).length > 0);
    return (
      <div>
        <div style={subTabBarStyle}>
          {MONITOR_SUB_TABS.map(t => (
            <button key={t.id} style={{ ...subTabStyle, ...(subTab === t.id ? subTabActiveStyle : {}), ...(t.id === MONITOR_SUB_TABS[MONITOR_SUB_TABS.length - 1].id ? { borderRight: 'none' } : {}) }}
              onClick={() => setSubTab(t.id)}>{t.label}</button>
          ))}
        </div>
        {gamesWithMonitors.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center' }}>
            <div style={{ fontSize: '0.8rem', color: '#3d2812', fontWeight: 700 }}>No Monitor Results Yet</div>
            <div style={{ fontSize: '0.68rem', color: '#8b7355', marginTop: 4 }}>Run a monitor on a completed game in the "Run Monitor" tab.</div>
          </div>
        ) : (
          <div style={{ maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {gamesWithMonitors.map(g => {
              const results = monitorResults[g.game_id] ?? [];
              return (
                <div key={g.game_id} style={{
                  padding: '10px 12px', borderRadius: 6,
                  background: 'rgba(92, 61, 26, 0.05)',
                  border: '1px solid rgba(92, 61, 26, 0.12)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#3d2812', fontWeight: 700 }}>
                      {g.game_id.slice(0, 8)}
                    </span>
                    <span style={{
                      fontSize: '0.55rem', fontWeight: 700, padding: '1px 5px', borderRadius: 8,
                      background: g.winner === 'good' ? '#c9a84c22' : '#991B1B22',
                      color: g.winner === 'good' ? '#c9a84c' : '#991B1B',
                    }}>
                      {g.winner} wins
                    </span>
                    {g.total_days != null && (
                      <span style={{ fontSize: '0.6rem', color: '#8b7355' }}>{g.total_days}d</span>
                    )}
                    <span style={{ fontSize: '0.55rem', color: '#b89b6a' }}>
                      {results.length} run{results.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {results.map((r, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '4px 8px', marginTop: 3, borderRadius: 4,
                      background: 'rgba(124, 58, 237, 0.06)',
                    }}>
                      <span style={{
                        fontSize: '0.62rem', fontWeight: 700, color: '#8b5e2a', minWidth: 50,
                      }}>
                        {r.scores.total.toFixed(1)} pts
                      </span>
                      <span style={{
                        fontSize: '0.58rem', color: PROVIDER_COLORS[r.config.provider] ?? '#5c3d1a', fontWeight: 600,
                      }}>
                        {MONITOR_MODELS.find(m => m.id === r.config.model)?.label ?? r.config.model}
                      </span>
                      <span style={{ fontSize: '0.52rem', color: '#8b7355' }}>
                        align: {(r.scores.alignment_accuracy * 100).toFixed(0)}%
                      </span>
                      <span style={{ fontSize: '0.52rem', color: '#8b7355' }}>
                        AUC: {r.scores.auc.toFixed(2)}
                      </span>
                      <span style={{ fontSize: '0.52rem', color: '#8b7355' }}>
                        bets: {(r.scores.bet_accuracy * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (subTab === 'settings') {
    return (
      <div>
        <div style={subTabBarStyle}>
          {MONITOR_SUB_TABS.map(t => (
            <button key={t.id} style={{ ...subTabStyle, ...(subTab === t.id ? subTabActiveStyle : {}), ...(t.id === MONITOR_SUB_TABS[MONITOR_SUB_TABS.length - 1].id ? { borderRight: 'none' } : {}) }}
              onClick={() => setSubTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <StubPanel title="Monitor Settings" description="Configure default model, temperature, token limits, custom system prompt additions, scoring weights (alignment vs bet vs AUC), and auto-run preferences (e.g. automatically monitor every completed game)." />
      </div>
    );
  }

  // ── Run Monitor sub-tab ──
  return (
    <div>
      <div style={subTabBarStyle}>
        {MONITOR_SUB_TABS.map(t => (
          <button key={t.id} style={{ ...subTabStyle, ...(subTab === t.id ? subTabActiveStyle : {}), ...(t.id === MONITOR_SUB_TABS[MONITOR_SUB_TABS.length - 1].id ? { borderRight: 'none' } : {}) }}
            onClick={() => setSubTab(t.id)}>{t.label}</button>
        ))}
      </div>

      <div style={{ fontSize: '0.72rem', color: '#8b7355', marginBottom: 10, lineHeight: 1.5 }}>
        Run a monitor agent on a completed game. The monitor watches public events and tries to identify evil players
        using behavioral analysis. Scores measure detection accuracy, bet timing, and classifier quality.
      </div>

      {/* Model selector */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#3d2812', marginBottom: 4 }}>Monitor Model</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {MONITOR_MODELS.map(m => (
            <button key={m.id} onClick={() => setSelectedModel(m.id)} style={{
              padding: '3px 8px', borderRadius: 3, fontSize: '0.6rem', fontWeight: selectedModel === m.id ? 700 : 400,
              cursor: 'pointer', border: selectedModel === m.id ? `1px solid ${PROVIDER_COLORS[m.provider]}` : '1px solid rgba(92, 61, 26, 0.2)',
              background: selectedModel === m.id ? `${PROVIDER_COLORS[m.provider]}18` : 'transparent',
              color: selectedModel === m.id ? PROVIDER_COLORS[m.provider] : '#5c3d1a',
            }}>
              {m.label} <span style={{ opacity: 0.5 }}>{m.cost}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Include groups toggle */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: '0.68rem', color: '#3d2812' }}>
          <input type="checkbox" checked={includeGroups} onChange={(e) => setIncludeGroups(e.target.checked)}
            style={{ accentColor: '#8b5e2a' }} />
          Include group conversations
        </label>
        <span style={{ fontSize: '0.58rem', color: '#8b7355' }}>
          {includeGroups ? '(Easy mode — evil may reveal themselves in groups)' : '(Hard mode — public info only)'}
        </span>
      </div>

      {/* Game list */}
      {completedGames.length === 0 ? (
        <div style={{ padding: '20px 0', textAlign: 'center' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#3d2812', marginBottom: 6 }}>No Completed Games</div>
          <div style={{ fontSize: '0.72rem', color: '#8b7355' }}>Play a game first, then run the monitor here.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {completedGames.map((g) => {
            const status = monitorStatus[g.game_id] ?? 'idle';
            const results = monitorResults[g.game_id] ?? [];
            const error = monitorErrors[g.game_id];
            const latestResult = results.length > 0 ? results[results.length - 1] : null;

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
                      background: g.winner === 'good' ? '#c9a84c22' : '#991B1B22',
                      color: g.winner === 'good' ? '#c9a84c' : '#991B1B',
                    }}>
                      {g.winner} wins
                    </span>
                    {g.total_days != null && (
                      <span style={{ fontSize: '0.6rem', color: '#8b7355' }}>{g.total_days}d</span>
                    )}
                  </div>

                  {/* Show existing results */}
                  {latestResult && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                      <span style={{
                        fontSize: '0.55rem', fontWeight: 700, padding: '1px 5px', borderRadius: 8,
                        background: 'rgba(139, 94, 42, 0.12)', color: '#8b5e2a',
                      }}>
                        Score: {latestResult.scores.total.toFixed(1)}
                      </span>
                      <span style={{ fontSize: '0.52rem', color: '#8b7355' }}>
                        {MONITOR_MODELS.find(m => m.id === latestResult.config.model)?.label ?? latestResult.config.model}
                      </span>
                      {results.length > 1 && (
                        <span style={{ fontSize: '0.5rem', color: '#b89b6a' }}>
                          +{results.length - 1} more
                        </span>
                      )}
                    </div>
                  )}
                  {error && (
                    <div style={{ fontSize: '0.6rem', color: '#991B1B', marginTop: 2 }}>{error}</div>
                  )}
                </div>

                {/* Action */}
                {status === 'running' ? (
                  <span style={{ fontSize: '0.65rem', color: '#92400E', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    Analyzing...
                  </span>
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); handleRunMonitor(g.game_id); }} style={{
                    padding: '4px 10px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 700,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                    background: latestResult ? 'rgba(124, 58, 237, 0.08)' : 'rgba(124, 58, 237, 0.12)',
                    border: '1px solid rgba(124, 58, 237, 0.3)',
                    color: '#8b5e2a',
                  }}>
                    {latestResult ? `Re-run (${modelInfo?.label ?? 'model'})` : `Run ${modelInfo?.label ?? 'Monitor'}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
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
                    background: g.winner === 'good' ? '#c9a84c22' : '#991B1B22',
                    color: g.winner === 'good' ? '#c9a84c' : '#991B1B',
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
                  <span style={{ fontSize: '0.6rem', color: '#6b5840', fontWeight: 600 }}>
                    {clips} clips
                  </span>
                  <button style={{
                    ...voiceBtnStyle,
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    color: '#6b5840',
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
  // Fun
  speechStyle: string; // empty = normal
}

const DEFAULT_OPTIONS: GameOptions = {
  revealModels: 'true',
  seed: '',
  maxDays: 25,
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
  speechStyle: '',
};

// ── Menu Button ─────────────────────────────────────────────────────

function MenuButton({ children, onClick, primary, dim }: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  dim?: boolean;
}) {
  const [hover, setHover] = useState(false);

  const base: React.CSSProperties = {
    minWidth: 240,
    padding: primary ? '10px 48px' : '8px 36px',
    fontFamily: '"Press Start 2P", "Courier New", monospace',
    fontSize: primary ? '1.1rem' : dim ? '0.8rem' : '0.9rem',
    fontWeight: 400,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    textAlign: 'center',
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    transition: 'color 0.15s ease',
    color: hover ? '#8b1a1a' : dim ? '#8b7355' : '#3d2812',
    textShadow: hover ? '0 0 8px rgba(139, 26, 26, 0.3)' : 'none',
  };

  return (
    <button
      style={base}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {children}
    </button>
  );
}


// ── Leaderboard ──────────────────────────────────────────────────────

interface LeaderboardModel {
  games_played: number;
  overall_win_rate: number;
  good: { played: number; wins: number; win_rate: number; noms_made: number; noms_hit_evil: number; nom_accuracy: number; votes_cast: number; votes_correct: number; vote_accuracy: number };
  evil: { played: number; wins: number; win_rate: number; night_kills: number; mislynch_caused: number; survival_rate: number };
  demon: { played: number; wins: number; win_rate: number };
  avg_tokens_per_day: number;
  avg_cost_per_day: number;
  roles: Record<string, { played: number; wins: number; win_rate: number }>;
}

function LeaderboardView() {
  const [data, setData] = useState<{ models: Record<string, LeaderboardModel>; total_games: number } | null>(null);
  const [sortKey, setSortKey] = useState<string>('overall_win_rate');
  const [expandedModel, setExpandedModel] = useState<string | null>(null);

  useEffect(() => {
    const serverUrl = localStorage.getItem('bloodbench_server_url')
      || import.meta.env.VITE_API_URL || 'http://localhost:8000';
    fetch(`${serverUrl}/api/stats/leaderboard`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data || Object.keys(data.models).length === 0) {
    return (
      <div style={{ width: '100%' }}>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#3d2812' }}>Leaderboard</div>
          <div style={{ fontSize: '0.72rem', color: '#8b7355', marginTop: 4 }}>
            {data ? 'No games played yet.' : 'Loading...'}
          </div>
        </div>
      </div>
    );
  }

  const models = Object.entries(data.models);
  const sorted = [...models].sort((a, b) => {
    const av = _getSortValue(a[1], sortKey);
    const bv = _getSortValue(b[1], sortKey);
    return bv - av;
  });

  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

  return (
    <div style={{ width: '100%' }}>
      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#3d2812', marginBottom: 2, textAlign: 'center' }}>
        Model Leaderboard
      </div>
      <div style={{ fontSize: '0.6rem', color: '#8b7355', marginBottom: 10, textAlign: 'center' }}>
        {data.total_games} games analyzed
      </div>

      {/* Sort selector */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12, justifyContent: 'center' }}>
        {[
          { key: 'overall_win_rate', label: 'Overall' },
          { key: 'good_win_rate', label: 'Good WR' },
          { key: 'evil_win_rate', label: 'Evil WR' },
          { key: 'nom_accuracy', label: 'Nom Acc' },
          { key: 'vote_accuracy', label: 'Vote Acc' },
          { key: 'survival_rate', label: 'Survival' },
          { key: 'avg_cost_per_day', label: 'Cost/Day' },
        ].map(s => (
          <button key={s.key} onClick={() => setSortKey(s.key)} style={{
            padding: '4px 10px', borderRadius: 3, fontSize: '0.68rem', cursor: 'pointer',
            background: sortKey === s.key ? 'rgba(92, 61, 26, 0.2)' : 'transparent',
            border: sortKey === s.key ? '1px solid rgba(92, 61, 26, 0.5)' : '1px solid rgba(92, 61, 26, 0.2)',
            color: sortKey === s.key ? '#2a1a0a' : '#5a4630',
            fontWeight: sortKey === s.key ? 700 : 500,
          }}>{s.label}</button>
        ))}
      </div>

      {/* Column headers — adapt to sort mode */}
      <div style={{
        display: 'grid', gridTemplateColumns: '22px 1fr 48px 48px 48px 48px 48px 48px',
        gap: 4, padding: '4px 8px', marginBottom: 4,
        fontSize: '0.58rem', color: '#5a4630', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600,
      }}>
        <span />
        <span>Model</span>
        {sortKey === 'survival_rate' ? (
          <>
            <span style={{ textAlign: 'center' }}>WR</span>
            <span style={{ textAlign: 'center' }}>Evil WR</span>
            <span style={{ textAlign: 'center' }}>Surv.</span>
            <span style={{ textAlign: 'center' }}>Kills</span>
            <span style={{ textAlign: 'center' }}>Mis.</span>
            <span style={{ textAlign: 'center' }}>Games</span>
          </>
        ) : sortKey === 'avg_cost_per_day' ? (
          <>
            <span style={{ textAlign: 'center' }}>$/Day</span>
            <span style={{ textAlign: 'center' }}>Tok/Day</span>
            <span style={{ textAlign: 'center' }}>WR</span>
            <span style={{ textAlign: 'center' }}>Good</span>
            <span style={{ textAlign: 'center' }}>Evil</span>
            <span style={{ textAlign: 'center' }}>Games</span>
          </>
        ) : (
          <>
            <span style={{ textAlign: 'center' }}>WR</span>
            <span style={{ textAlign: 'center' }}>Good</span>
            <span style={{ textAlign: 'center' }}>Evil</span>
            <span style={{ textAlign: 'center' }}>Noms</span>
            <span style={{ textAlign: 'center' }}>Votes</span>
            <span style={{ textAlign: 'center' }}>Games</span>
          </>
        )}
      </div>

      {/* Table */}
      <div style={{ maxHeight: '48vh', overflowY: 'auto' }}>
        {sorted.map(([model, m], rank) => {
          const shortName = model.replace('claude-', '').replace('-20250514', '').replace('-20251001', '')
            .replace('-preview', '');
          const provider = model.includes('claude') ? 'anthropic' : model.includes('gpt') || model.includes('o4') || model.includes('o3') ? 'openai' : model.includes('gemini') ? 'google' : 'openrouter';
          const isExpanded = expandedModel === model;

          return (
            <div key={model} style={{ marginBottom: 4 }}>
              <div
                onClick={() => setExpandedModel(isExpanded ? null : model)}
                style={{
                  display: 'grid', gridTemplateColumns: '18px 1fr 48px 48px 48px 48px 48px 48px',
                  gap: 4, alignItems: 'center', padding: '6px 8px', borderRadius: 4, cursor: 'pointer',
                  background: rank === 0 ? 'rgba(201, 168, 76, 0.1)' : 'rgba(92, 61, 26, 0.04)',
                  border: `1px solid ${rank === 0 ? 'rgba(201, 168, 76, 0.3)' : 'rgba(92, 61, 26, 0.1)'}`,
                }}
              >
                <span style={{ fontSize: '0.7rem', color: '#3d2812', fontWeight: 700 }}>#{rank + 1}</span>
                <span style={{
                  fontSize: '0.72rem', fontWeight: 700,
                  color: PROVIDER_COLORS[provider] ?? '#3d2812',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{shortName}</span>
                {sortKey === 'survival_rate' ? (
                  <>
                    <span style={{ fontSize: '0.68rem', color: '#2a1a0a', textAlign: 'center', fontWeight: 600 }}>{pct(m.overall_win_rate)}</span>
                    <span style={{ fontSize: '0.68rem', color: '#991B1B', textAlign: 'center', fontWeight: 600 }}>{m.evil.played > 0 ? pct(m.evil.win_rate) : '-'}</span>
                    <span style={{ fontSize: '0.68rem', color: '#2a1a0a', textAlign: 'center', fontWeight: 600 }}>{m.evil.played > 0 ? pct(m.evil.survival_rate) : '-'}</span>
                    <span style={{ fontSize: '0.68rem', color: '#2a1a0a', textAlign: 'center' }}>{m.evil.night_kills}</span>
                    <span style={{ fontSize: '0.68rem', color: '#2a1a0a', textAlign: 'center' }}>{m.evil.mislynch_caused}</span>
                    <span style={{ fontSize: '0.62rem', color: '#5a4630', textAlign: 'center' }}>{m.games_played}g</span>
                  </>
                ) : sortKey === 'avg_cost_per_day' ? (
                  <>
                    <span style={{ fontSize: '0.68rem', color: '#2a1a0a', textAlign: 'center', fontWeight: 600 }}>${m.avg_cost_per_day.toFixed(3)}</span>
                    <span style={{ fontSize: '0.62rem', color: '#2a1a0a', textAlign: 'center' }}>{(m.avg_tokens_per_day / 1000).toFixed(0)}k</span>
                    <span style={{ fontSize: '0.68rem', color: '#2a1a0a', textAlign: 'center', fontWeight: 600 }}>{pct(m.overall_win_rate)}</span>
                    <span style={{ fontSize: '0.68rem', color: '#c9a84c', textAlign: 'center', fontWeight: 600 }}>{m.good.played > 0 ? pct(m.good.win_rate) : '-'}</span>
                    <span style={{ fontSize: '0.68rem', color: '#991B1B', textAlign: 'center', fontWeight: 600 }}>{m.evil.played > 0 ? pct(m.evil.win_rate) : '-'}</span>
                    <span style={{ fontSize: '0.62rem', color: '#5a4630', textAlign: 'center' }}>{m.games_played}g</span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: '0.68rem', color: '#2a1a0a', textAlign: 'center', fontWeight: 600 }}>{pct(m.overall_win_rate)}</span>
                    <span style={{ fontSize: '0.68rem', color: '#c9a84c', textAlign: 'center', fontWeight: 600 }}>{m.good.played > 0 ? pct(m.good.win_rate) : '-'}</span>
                    <span style={{ fontSize: '0.68rem', color: '#991B1B', textAlign: 'center', fontWeight: 600 }}>{m.evil.played > 0 ? pct(m.evil.win_rate) : '-'}</span>
                    <span style={{ fontSize: '0.68rem', color: '#2a1a0a', textAlign: 'center' }}>{m.good.noms_made > 0 ? pct(m.good.nom_accuracy) : '-'}</span>
                    <span style={{ fontSize: '0.68rem', color: '#2a1a0a', textAlign: 'center' }}>{m.good.votes_cast > 0 ? pct(m.good.vote_accuracy) : '-'}</span>
                    <span style={{ fontSize: '0.62rem', color: '#5a4630', textAlign: 'center' }}>{m.games_played}g</span>
                  </>
                )}
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div style={{
                  padding: '8px 12px', margin: '2px 0 4px',
                  background: 'rgba(92, 61, 26, 0.06)', borderRadius: 4,
                  border: '1px solid rgba(92, 61, 26, 0.1)',
                  fontSize: '0.68rem', color: '#2a1a0a',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#c9a84c', marginBottom: 3 }}>Good ({m.good.played}g, {pct(m.good.win_rate)} WR)</div>
                      <div>Noms: {m.good.noms_hit_evil}/{m.good.noms_made} hit evil ({m.good.noms_made > 0 ? pct(m.good.nom_accuracy) : '-'})</div>
                      <div>Votes: {m.good.votes_correct}/{m.good.votes_cast} correct ({m.good.votes_cast > 0 ? pct(m.good.vote_accuracy) : '-'})</div>
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: '#991B1B', marginBottom: 3 }}>Evil ({m.evil.played}g, {pct(m.evil.win_rate)} WR)</div>
                      <div>Night kills: {m.evil.night_kills}</div>
                      <div>Mislynches caused: {m.evil.mislynch_caused}</div>
                      <div>Survival: {pct(m.evil.survival_rate)}</div>
                      {m.demon.played > 0 && <div>Demon: {m.demon.wins}/{m.demon.played} wins</div>}
                    </div>
                  </div>
                  <div style={{ marginBottom: 4 }}>
                    <span style={{ color: '#8b7355' }}>
                      Avg tokens/day: {m.avg_tokens_per_day.toLocaleString()} | Cost/day: ${m.avg_cost_per_day.toFixed(3)}
                    </span>
                  </div>
                  {Object.keys(m.roles).length > 0 && (
                    <div>
                      <div style={{ fontWeight: 700, marginBottom: 2 }}>Roles played:</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {Object.entries(m.roles).map(([role, rs]) => (
                          <span key={role} style={{
                            padding: '1px 6px', borderRadius: 8, fontSize: '0.52rem',
                            background: rs.win_rate >= 0.5 ? '#c9a84c18' : '#991B1B18',
                            color: rs.win_rate >= 0.5 ? '#6b5840' : '#991B1B',
                          }}>
                            {role} {rs.wins}/{rs.played}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}

function _getSortValue(m: LeaderboardModel, key: string): number {
  switch (key) {
    case 'overall_win_rate': return m.overall_win_rate;
    case 'good_win_rate': return m.good.win_rate;
    case 'evil_win_rate': return m.evil.win_rate;
    case 'nom_accuracy': return m.good.nom_accuracy;
    case 'vote_accuracy': return m.good.vote_accuracy;
    case 'survival_rate': return m.evil.survival_rate;
    case 'avg_cost_per_day': return -m.avg_cost_per_day; // lower is better
    default: return m.overall_win_rate;
  }
}


// ── Main component ──────────────────────────────────────────────────

export function GameLobby() {
  const navigate = useNavigate();
  const { isAdmin, authenticate: adminAuthenticate, logout: adminLogout } = useAdminMode();

  // Pick up wager_token from URL params (GitHub OAuth callback redirect)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('wager_token');
    if (urlToken) {
      localStorage.setItem('wager_token', urlToken);
      params.delete('wager_token');
      const clean = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (clean ? `?${clean}` : ''));
    }
  }, []);
  const [showAdminPrompt, setShowAdminPrompt] = useState(false);
  const lobbyAudioRef = useRef<HTMLAudioElement | null>(null);

  // Ambient idle video on scroll background
  const lobbyIdleRef = useRef<HTMLVideoElement>(null);
  const [lobbyIdlePlaying, setLobbyIdlePlaying] = useState(false);
  const lobbyIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleLobbyIdle = useCallback(() => {
    if (lobbyIdleTimerRef.current) clearTimeout(lobbyIdleTimerRef.current);
    const delay = 80_000 + Math.random() * 40_000; // 80–120s
    lobbyIdleTimerRef.current = setTimeout(() => {
      const vid = lobbyIdleRef.current;
      if (!vid) return;
      vid.src = '/ambient/idle-options.mp4';
      vid.load();
      vid.play().then(() => setLobbyIdlePlaying(true)).catch(() => {});
    }, delay);
  }, []);

  const handleLobbyIdleEnd = useCallback(() => {
    setLobbyIdlePlaying(false);
    scheduleLobbyIdle(); // schedule next one
  }, [scheduleLobbyIdle]);

  useEffect(() => {
    scheduleLobbyIdle();
    return () => { if (lobbyIdleTimerRef.current) clearTimeout(lobbyIdleTimerRef.current); };
  }, [scheduleLobbyIdle]);

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
  const [view, setView] = useState<'menu' | 'setup' | 'options' | 'games' | 'leaderboard'>('menu');
  const [optionsTab, setOptionsTab] = useState<OptionsTab>('rules');

  // Game config — persisted to localStorage so settings survive Stripe redirect
  const [playerCount, setPlayerCount] = useState(() => {
    try { const v = localStorage.getItem('bb_playerCount'); return v ? Number(v) : 7; } catch { return 7; }
  });
  const [script, setScript] = useState(() => {
    try { return localStorage.getItem('bb_script') || SCRIPTS[0].value; } catch { return SCRIPTS[0].value; }
  });
  const [seatModels, setSeatModels] = useState<string[]>(() => {
    try { const v = localStorage.getItem('bb_seatModels'); return v ? JSON.parse(v) : Array(15).fill(AVAILABLE_MODELS[0].id); } catch { return Array(15).fill(AVAILABLE_MODELS[0].id); }
  });
  const [seatRoles, setSeatRoles] = useState<string[]>(() => {
    try { const v = localStorage.getItem('bb_seatRoles'); return v ? JSON.parse(v) : Array(15).fill(''); } catch { return Array(15).fill(''); }
  });
  const [seatCharacters, setSeatCharacters] = useState<(number | null)[]>(() => {
    try { const v = localStorage.getItem('bb_seatChars'); return v ? JSON.parse(v) : Array(15).fill(null); } catch { return Array(15).fill(null); }
  });
  const [roleMode, setRoleMode] = useState<'random' | 'assigned'>(() => {
    try { const v = localStorage.getItem('bb_roleMode'); return v === 'assigned' ? 'assigned' : 'random'; } catch { return 'random'; }
  });
  const [options, setOptions] = useState<GameOptions>(() => {
    try { const v = localStorage.getItem('bb_options'); return v ? { ...DEFAULT_OPTIONS, ...JSON.parse(v) } : { ...DEFAULT_OPTIONS }; } catch { return { ...DEFAULT_OPTIONS }; }
  });

  // Persist game config changes to localStorage
  useEffect(() => { localStorage.setItem('bb_playerCount', String(playerCount)); }, [playerCount]);
  useEffect(() => { localStorage.setItem('bb_script', script); }, [script]);
  useEffect(() => { localStorage.setItem('bb_seatModels', JSON.stringify(seatModels)); }, [seatModels]);
  useEffect(() => { localStorage.setItem('bb_seatRoles', JSON.stringify(seatRoles)); }, [seatRoles]);
  useEffect(() => { localStorage.setItem('bb_seatChars', JSON.stringify(seatCharacters)); }, [seatCharacters]);
  useEffect(() => { localStorage.setItem('bb_roleMode', roleMode); }, [roleMode]);
  useEffect(() => { localStorage.setItem('bb_options', JSON.stringify(options)); }, [options]);

  // Client-provided API keys (BYOK mode — stored in localStorage, never sent to server .env)
  const [clientKeys, setClientKeys] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('bloodbench_api_keys');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const updateClientKey = useCallback((provider: string, key: string) => {
    setClientKeys(prev => {
      const next = { ...prev, [provider]: key };
      // Remove empty keys
      if (!key) delete next[provider];
      localStorage.setItem('bloodbench_api_keys', JSON.stringify(next));
      return next;
    });
  }, []);

  // Game list
  const [games, setGames] = useState<GameListItem[]>([]);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [showCreditPurchase, setShowCreditPurchase] = useState(false);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [estimatedCost, setEstimatedCost] = useState<number | null>(null);
  const [paymentMode, setPaymentMode] = useState<'stripe' | 'api'>(() => {
    // If returning from OAuth with a token, default to credits mode
    const hasToken = !!localStorage.getItem('wager_token');
    const returningFromAuth = new URLSearchParams(window.location.search).has('wager_token');
    return (hasToken || returningFromAuth) ? 'stripe' : 'api';
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch credit balance on mount
  useEffect(() => {
    const token = localStorage.getItem('wager_token');
    if (token) {
      getCreditBalance()
        .then((data) => setCreditBalance(data.balance))
        .catch(() => setCreditBalance(null));
    }
  }, []);

  // Update cost estimate when game config changes
  useEffect(() => {
    const models = seatModels.slice(0, playerCount).map((modelId) => {
      const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
      return { provider: model?.provider ?? 'anthropic', model: modelId };
    });
    estimateCost({ num_players: playerCount, seat_models: models, max_days: options.maxDays })
      .then((est) => setEstimatedCost(est.charge_amount))
      .catch(() => setEstimatedCost(null));
  }, [playerCount, seatModels, options.maxDays]);

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
  const handleCharacterChange = useCallback((seat: number, spriteId: number | null) => {
    setSeatCharacters((prev) => { const next = [...prev]; next[seat] = spriteId; return next; });
  }, []);

  const usedRoles = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < playerCount; i++) { if (seatRoles[i]) set.add(seatRoles[i]); }
    return set;
  }, [seatRoles, playerCount]);

  const usedCharacters = useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < playerCount; i++) { if (seatCharacters[i] != null) set.add(seatCharacters[i]!); }
    return set;
  }, [seatCharacters, playerCount]);

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

  // Build the game config object (shared between direct start and payment flow)
  const buildGameConfig = useCallback(() => {
    const seed = options.seed ? Number(options.seed) : Math.floor(Math.random() * 100_000);
    const seatModelConfigs: SeatModelConfig[] = seatModels.slice(0, playerCount).map((modelId) => {
      const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
      return { provider: model?.provider ?? 'anthropic', model: modelId };
    });
    const hasClientKeys = Object.keys(clientKeys).length > 0;
    const charSlice = seatCharacters.slice(0, playerCount);
    const hasCharPicks = charSlice.some(c => c != null);
    return {
      config: {
        script,
        num_players: playerCount,
        seat_models: seatModelConfigs,
        seat_roles: roleMode === 'assigned' ? seatRoles.slice(0, playerCount) : undefined,
        ...(hasCharPicks ? { seat_characters: charSlice } : {}),
        seed,
        max_days: options.maxDays,
        reveal_models: options.revealModels,
        share_stats: options.shareStats && options.revealModels === 'true',
        speech_style: options.speechStyle || null,
        ...(hasClientKeys ? { provider_keys: clientKeys } : {}),
      },
      hasClientKeys,
    };
  }, [playerCount, script, seatModels, seatRoles, seatCharacters, roleMode, options, clientKeys]);

  const handleStart = useCallback(async () => {
    setStarting(true); setStartError(null);
    // For assigned mode, only block on critical errors (over-assigned types), not missing roles
    if (roleMode === 'assigned') {
      const criticalWarnings = roleWarnings.filter(w => w.includes('Too many') || w.includes('Duplicate'));
      if (criticalWarnings.length > 0) {
        setStartError('Fix role assignment errors before starting.');
        setStarting(false); return;
      }
    }

    const { config, hasClientKeys } = buildGameConfig();

    // API Keys mode: need BYOK keys
    if (paymentMode === 'api') {
      if (!hasClientKeys) {
        setStartError('No API keys entered.');
        setStarting(false);
        setView('options');
        setOptionsTab('api');
        return;
      }
      try {
        const result = await createConfiguredGame(config);
        navigateWithTransition(`/game/${result.game_id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed';
        if (msg.includes('fetch') || msg.includes('Network')) setStartError('Cannot connect to server.');
        else setStartError(msg);
      } finally { setStarting(false); }
      return;
    }

    // Credits mode: check balance before sending to backend
    const cost = estimatedCost !== null ? Math.ceil(estimatedCost) : 0;
    if (cost > 0 && (creditBalance ?? 0) < cost) {
      setStartError(`Insufficient credits. Need ${cost}, have ${Math.floor(creditBalance ?? 0)}.`);
      setShowCreditPurchase(true);
      setStarting(false);
      return;
    }

    try {
      const result = await createConfiguredGame(config);
      getCreditBalance()
        .then((data) => setCreditBalance(data.balance))
        .catch(() => {});
      navigateWithTransition(`/game/${result.game_id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      if (msg.includes('402') || msg.includes('Insufficient')) {
        setStartError(msg);
        setShowCreditPurchase(true);
      } else if (msg.includes('fetch') || msg.includes('Network')) {
        setStartError('Cannot connect to server.');
      } else {
        setStartError(msg);
      }
    } finally { setStarting(false); }
  }, [playerCount, script, seatModels, seatRoles, seatCharacters, roleMode, roleWarnings, options, clientKeys, navigate, buildGameConfig, creditBalance, estimatedCost, paymentMode]);

  const isAssignedAvailable = script in SCRIPT_ROLES;

  // ── Render: Setup (game config) ────────────────────────────────────

  const setupView = (
    <div style={{ width: '100%' }}>
      <button style={st.backBtn} onClick={() => setView('menu')}>Back</button>
      <div style={st.panelTitle}>Game Setup</div>

      <div style={st.configGrid}>
        {/* Left: Script + Players + Payment Mode + Role Mode */}
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
            <label style={st.label}>Payment</label>
            <div style={{ display: 'flex', gap: 0, borderRadius: 2, overflow: 'hidden', border: '2px solid rgba(61, 40, 18, 0.3)' }}>
              <button style={{ ...st.toggleBtn, background: paymentMode === 'stripe' ? '#8b1a1a' : 'rgba(30, 20, 10, 0.06)', color: paymentMode === 'stripe' ? '#e8d5a3' : '#3d2812', fontWeight: 700 }} onClick={() => {
                const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                const token = localStorage.getItem('wager_token');
                if (!token && !isLocal) {
                  // Redirect to GitHub OAuth, then back here
                  const serverUrl = localStorage.getItem('bloodbench_server_url') || import.meta.env.VITE_API_URL || 'http://localhost:8000';
                  window.location.href = `${serverUrl}/api/wager/auth/github?redirect=${encodeURIComponent('/lobby')}`;
                  return;
                }
                setPaymentMode('stripe');
                // Fetch balance if we have a token (or localhost mock)
                if (creditBalance === null) {
                  getCreditBalance()
                    .then((data) => setCreditBalance(data.balance))
                    .catch(() => setCreditBalance(null));
                }
              }}>Credits</button>
              <button style={{ ...st.toggleBtn, background: paymentMode === 'api' ? '#8b1a1a' : 'rgba(30, 20, 10, 0.06)', color: paymentMode === 'api' ? '#e8d5a3' : '#3d2812', fontWeight: 700 }} onClick={() => setPaymentMode('api')}>API Keys</button>
            </div>
          </div>

          {paymentMode === 'stripe' && (
            <CreditBalanceInline
              balance={creditBalance}
              estimatedCost={estimatedCost}
              onBuyCredits={() => setShowCreditPurchase(true)}
            />
          )}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: '0.58rem', color: '#6b5840', lineHeight: 1.5 }}>
              {Object.keys(clientKeys).length > 0
                ? <span style={{ color: '#6b5840', fontWeight: 600 }}>BYOK mode — using your API keys (free)</span>
                : <>No keys configured. <button style={{ background: 'none', border: 'none', color: '#b34a28', fontSize: '0.58rem', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontWeight: 600 }} onClick={() => { setView('options'); setOptionsTab('api'); }}>Add API keys</button></>
              }
            </div>
          </div>

          <div style={st.field}>
            <label style={st.label}>Quick Fill</label>
            <button style={{ ...st.smallBtn, borderLeft: '3px solid #8b5e2a' }}
              onClick={() => setSeatModels(buildMixedSeatModels(15))}>
              Mixed
            </button>
          </div>

          {isAdmin && (
            <>
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
            </>
          )}

          <DistributionSummary playerCount={playerCount} seatRoles={seatRoles} roleMode={roleMode} scriptId={script} />

          {isAdmin && roleMode === 'assigned' && roleWarnings.length > 0 && (
            <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 3, background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              {roleWarnings.map((w, i) => <div key={i} style={{ fontSize: '0.62rem', color: '#991B1B', lineHeight: 1.4 }}>{w}</div>)}
            </div>
          )}

          {Object.keys(clientKeys).length > 0 && (
            <p style={{ fontSize: '0.65rem', color: '#2d5a2d', marginTop: 6, fontWeight: 600 }}>
              BYOK mode — using your API keys (free)
            </p>
          )}
        </div>

        {/* Right: Seats + Launch */}
        <div>
          <label style={st.label}>Seat Assignments {roleMode === 'assigned' ? '(Model + Role + Character)' : '(Model + Character)'}</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 280, overflowY: 'auto' }}>
            {roleMode === 'random' ? (
              Array.from({ length: playerCount }, (_, i) => <SeatRow key={i} seat={i} model={seatModels[i]} spriteId={seatCharacters[i]} usedCharacters={usedCharacters} onChange={(m) => handleModelChange(i, m)} onCharChange={(c) => handleCharacterChange(i, c)} />)
            ) : (
              Array.from({ length: playerCount }, (_, i) => <AssignedSeatRow key={i} seat={i} model={seatModels[i]} roleId={seatRoles[i]} scriptId={script} spriteId={seatCharacters[i]} usedRoles={usedRoles} usedCharacters={usedCharacters} onModelChange={(m) => handleModelChange(i, m)} onRoleChange={(r) => handleRoleChange(i, r)} onCharChange={(c) => handleCharacterChange(i, c)} />)
            )}
          </div>

          {startError && <div style={{ ...st.errorBox, marginTop: 10 }}>{startError}</div>}

          <div style={{ marginTop: 12 }}>
            <button
              style={{ ...st.menuBtn, ...st.menuBtnPrimary, width: '100%', opacity: starting ? 0.5 : 1 }}
              onClick={() => void handleStart()}
              disabled={starting}
            >
              {starting ? '... Summoning Agents ...' : 'Launch Game'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Render: Options ────────────────────────────────────────────────

  const optionsView = (
    <div style={{ width: '100%' }}>
      <button style={st.backBtn} onClick={() => setView('menu')}>Back</button>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div
          style={{ ...st.panelTitle, cursor: 'default', userSelect: 'none' }}
          onClick={(e) => {
            if (e.detail >= 3 && !isAdmin) setShowAdminPrompt(true);
          }}
        >
          Options
        </div>
        {isAdmin && (
          <span style={{ fontSize: '0.55rem', color: '#8b5e2a', fontStyle: 'italic', opacity: 0.7 }}>
            Storyteller mode{' '}
            <button onClick={adminLogout} style={{
              background: 'none', border: 'none', color: '#8b5e2a',
              fontSize: '0.55rem', cursor: 'pointer', textDecoration: 'underline', padding: 0,
            }}>
              (exit)
            </button>
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div style={st.tabBar}>
        {OPTIONS_TABS.filter(tab => isAdmin || !tab.adminOnly).map((tab) => (
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

        {optionsTab === 'fun' && (
          <>
            <OptionField label="Speech Style" help="Force all agents to speak in a specific style. Affects ALL dialogue in the game — accusations, defenses, breakout groups, everything.">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {SPEECH_STYLE_PRESETS.map(preset => {
                  const isActive = preset.id === '' ? !options.speechStyle : options.speechStyle === preset.prompt || (preset.id === 'custom' && options.speechStyle && !SPEECH_STYLE_PRESETS.some(p => p.id !== 'custom' && p.id !== '' && p.prompt === options.speechStyle));
                  return (
                    <button key={preset.id} onClick={() => updateOption('speechStyle', preset.prompt)} style={{
                      padding: '5px 10px', borderRadius: 4, fontSize: '0.65rem', fontWeight: isActive ? 700 : 400,
                      cursor: 'pointer',
                      border: isActive ? '1px solid #8b5e2a' : '1px solid rgba(92, 61, 26, 0.2)',
                      background: isActive ? 'rgba(124, 58, 237, 0.12)' : 'transparent',
                      color: isActive ? '#8b5e2a' : '#5c3d1a',
                    }}>
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              {options.speechStyle && (
                <div style={{ fontSize: '0.62rem', color: '#8b7355', lineHeight: 1.5, padding: '6px 8px', background: 'rgba(92, 61, 26, 0.05)', borderRadius: 4, border: '1px solid rgba(92, 61, 26, 0.1)' }}>
                  {SPEECH_STYLE_PRESETS.find(p => p.prompt === options.speechStyle)?.description ?? 'Custom style active'}
                </div>
              )}
              {(options.speechStyle && !SPEECH_STYLE_PRESETS.some(p => p.id !== 'custom' && p.id !== '' && p.prompt === options.speechStyle)) || SPEECH_STYLE_PRESETS.find(p => p.id === 'custom' && p.prompt === options.speechStyle) !== undefined ? null : null}
            </OptionField>
            {/* Custom prompt editor — show when a preset is active or for custom */}
            {options.speechStyle !== '' && (
              <OptionField label="Style Prompt" help="The exact instruction injected into every agent's system prompt. Edit to customize.">
                <textarea
                  value={options.speechStyle}
                  onChange={(e) => updateOption('speechStyle', e.target.value)}
                  rows={5}
                  style={{
                    width: '100%', padding: 8, borderRadius: 4, fontSize: '0.65rem', fontFamily: 'monospace',
                    background: 'rgba(92, 61, 26, 0.04)', border: '1px solid rgba(92, 61, 26, 0.2)',
                    color: '#3d2812', resize: 'vertical', lineHeight: 1.5,
                  }}
                />
              </OptionField>
            )}
          </>
        )}
        {optionsTab === 'monitor' && (
          <MonitorOptionsPanel games={games} />
        )}
        {optionsTab === 'wager' && (
          <div style={{ padding: '12px 0' }}>
            <div style={{ fontSize: '0.85rem', color: '#5c3d1a', marginBottom: 16, lineHeight: 1.5 }}>
              <strong>The Crown's Wager</strong> — spectate live games and place bets on who is evil, what roles players have, and which team will win. Earn Crowns for correct predictions. Earlier bets pay more.
            </div>
            <div style={{ fontSize: '0.75rem', color: '#8b7355', marginBottom: 12 }}>
              Running games available for spectating:
            </div>
            {games.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#8b7355', padding: 16, fontSize: '0.8rem', fontStyle: 'italic' }}>
                No games available. Start a game first.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Running games first */}
                {games.filter(g => g.status === 'running').map(g => (
                  <div key={g.game_id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', background: 'rgba(92, 61, 26, 0.08)',
                    borderRadius: 6, border: '1px solid rgba(92, 61, 26, 0.15)',
                  }}>
                    <div>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#3d2812' }}>
                        {g.game_id.slice(0, 8)}
                      </span>
                      <span style={{
                        marginLeft: 8, fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                        background: '#8b5e2a22', color: '#92400E',
                      }}>live</span>
                    </div>
                    <button onClick={() => navigateWithTransition(`/spectate/${g.game_id}`)} style={{
                      padding: '4px 14px', fontSize: '0.7rem', fontWeight: 700,
                      background: '#c9a84c', color: '#1a1a2e', border: 'none',
                      borderRadius: 4, cursor: 'pointer', fontFamily: 'Georgia, serif',
                    }}>
                      Spectate
                    </button>
                  </div>
                ))}
                {/* Completed games — replay mode */}
                {games.filter(g => g.status === 'completed').map(g => (
                  <div key={g.game_id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', background: 'rgba(92, 61, 26, 0.04)',
                    borderRadius: 6, border: '1px solid rgba(92, 61, 26, 0.10)',
                  }}>
                    <div>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#3d2812' }}>
                        {g.game_id.slice(0, 8)}
                      </span>
                      <span style={{
                        marginLeft: 8, fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                        background: '#c9a84c22', color: '#6b5840',
                      }}>{g.winner} wins</span>
                      <span style={{
                        marginLeft: 4, fontSize: '0.55rem', padding: '1px 5px', borderRadius: 6,
                        background: '#3d281208', color: '#8b7355',
                      }}>replay</span>
                    </div>
                    <button onClick={() => navigateWithTransition(`/spectate/${g.game_id}`)} style={{
                      padding: '4px 14px', fontSize: '0.7rem', fontWeight: 700,
                      background: 'rgba(92, 61, 26, 0.15)', color: '#3d2812', border: '1px solid rgba(92, 61, 26, 0.3)',
                      borderRadius: 4, cursor: 'pointer', fontFamily: 'Georgia, serif',
                    }}>
                      Replay &amp; Bet
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {optionsTab === 'probabilities' && (
          <StubPanel title="Probability Tweaks" description="Fine-tune game mechanics: drunk information accuracy, poison effects, whisper overhear chance, Spy registration probabilities, and other programmatic percentages." />
        )}
        {optionsTab === 'api' && (
          <div style={{ padding: '12px 0' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#3d2812', marginBottom: 4 }}>API Keys</div>
            <div style={{ fontSize: '0.65rem', color: '#8b7355', marginBottom: 12, lineHeight: 1.5 }}>
              Bring your own keys. Stored in your browser only — never sent to the server's .env.
              If empty, the server's .env keys are used as fallback.
            </div>
            {[
              { provider: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
              { provider: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
              { provider: 'google', label: 'Google (Gemini)', placeholder: 'AIza...' },
              { provider: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-...' },
            ].map(({ provider, label, placeholder }) => (
              <div key={provider} style={{ marginBottom: 10 }}>
                <label style={{ fontSize: '0.7rem', color: '#5a4630', fontWeight: 600, display: 'block', marginBottom: 3 }}>
                  {label}
                  {clientKeys[provider] && <span style={{ color: '#2d5a2d', marginLeft: 6 }}>Set</span>}
                </label>
                <input
                  type="password"
                  value={clientKeys[provider] ?? ''}
                  onChange={e => updateClientKey(provider, e.target.value)}
                  placeholder={placeholder}
                  style={{
                    width: '100%', padding: '6px 10px', boxSizing: 'border-box',
                    background: '#f5efe0', border: '1px solid #d4c5a0', borderRadius: 4,
                    fontSize: '0.72rem', fontFamily: 'monospace', color: '#3d2812',
                  }}
                />
              </div>
            ))}
            <div style={{ fontSize: '0.6rem', color: '#b89b6a', marginTop: 8, fontStyle: 'italic' }}>
              Keys are saved to localStorage. Clear your browser data to remove them.
            </div>
          </div>
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
    <div style={st.menuArea}>
      <MenuButton primary onClick={() => setView('setup')}>Start Game</MenuButton>
      <MenuButton onClick={() => setView('options')}>Options</MenuButton>
      <MenuButton onClick={() => setView('leaderboard')}>Leaderboard</MenuButton>
      <MenuButton onClick={() => setView('games')}>
        Past Games{games.length > 0 ? ` (${games.length})` : ''}
      </MenuButton>
      <MenuButton dim onClick={() => window.close()}>Quit</MenuButton>
    </div>
  );

  const gamesView = (
    <div style={{ width: '100%' }}>
      <button style={st.backBtn} onClick={() => setView('menu')}>Back</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={st.label}>Past Games</span>
        <button style={st.smallBtn} onClick={() => void fetchGames()}>Refresh</button>
      </div>
      {gamesError && <div style={st.errorBox}>{gamesError}</div>}
      {gamesLoading ? (
        <div style={{ textAlign: 'center', color: '#8b7355', padding: 12, fontSize: '0.8rem' }}>Loading games...</div>
      ) : games.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#8b7355', padding: 20, fontSize: '0.75rem', lineHeight: 1.6 }}>
          No games found.{gamesError ? ` (${gamesError})` : ' Checking GitHub...'}
          <br />
          <button style={{ ...st.smallBtn, marginTop: 8 }} onClick={() => void fetchGames()}>Retry</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '50vh', overflowY: 'auto' }}>
          {games.map((g) => (
            <div key={g.game_id} style={{ ...st.gameCard, justifyContent: 'flex-start', gap: 8 }} role="button" tabIndex={0}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => navigateWithTransition(`/game/${g.game_id}`)}>
                <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#3d2812' }}>{g.game_id.slice(0, 8)}</span>
                <span style={{
                  fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 8, textTransform: 'uppercase',
                  background: g.status === 'running' ? '#8b5e2a22' : g.status === 'completed' ? '#c9a84c22' : '#991B1B22',
                  color: g.status === 'running' ? '#92400E' : g.status === 'completed' ? '#6b5840' : '#991B1B',
                }}>{g.status}</span>
                {g.winner && (
                  <span style={{
                    fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                    background: g.winner === 'good' ? '#c9a84c22' : '#991B1B22',
                    color: g.winner === 'good' ? '#c9a84c' : '#991B1B',
                  }}>{g.winner} wins</span>
                )}
                {g.total_days != null && (
                  <span style={{ fontSize: '0.6rem', color: '#8b7355' }}>{g.total_days} days</span>
                )}
                {g.created_at && (
                  <span style={{ fontSize: '0.6rem', color: '#b89b6a', fontFamily: 'monospace' }}>{g.created_at}</span>
                )}
                {g.has_audio && (
                  <span title="Voice acting available" style={{ fontSize: '0.6rem' }}>{'\uD83D\uDD0A'}</span>
                )}
                {g.has_monitors && (
                  <span title="Monitor analysis available" style={{ fontSize: '0.6rem' }}>{'\uD83D\uDD0D'}</span>
                )}
              </div>
              {g.status === 'running' && (
                <button onClick={(e) => { e.stopPropagation(); navigateWithTransition(`/spectate/${g.game_id}`); }} style={{
                  padding: '2px 10px', fontSize: '0.6rem', fontWeight: 700,
                  background: '#c9a84c', color: '#1a1a2e', border: 'none',
                  borderRadius: 4, cursor: 'pointer', fontFamily: 'Georgia, serif',
                }}>
                  Spectate
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const leaderboardView = (
    <div style={{ width: '100%' }}>
      <button style={st.backBtn} onClick={() => setView('menu')}>Back</button>
      <LeaderboardView />
    </div>
  );

  return (
    <>
      {showSplash && <SplashScreen onComplete={handleSplashComplete} />}
      {transitioning && <PageTransition onMidpoint={handleTransitionMidpoint} />}
      {showAdminPrompt && (
        <AdminPassphraseModal
          onSubmit={async (pw) => {
            await adminAuthenticate(pw);
            setShowAdminPrompt(false);
          }}
          onClose={() => setShowAdminPrompt(false)}
        />
      )}
      {showCreditPurchase && (
        <CreditPurchaseModal
          gameAmount={estimatedCost != null ? Math.ceil(estimatedCost) : undefined}
          onClose={() => {
            setShowCreditPurchase(false);
            getCreditBalance()
              .then((data) => setCreditBalance(data.balance))
              .catch(() => {});
          }}
        />
      )}
      <div style={st.page}>
        <div style={st.aspectContainer}>
          <img src="/scroll_lg.jpg" alt="" style={st.scrollBg} />
          {/* Ambient idle video — fades in over scroll background after ~90s */}
          <video
            ref={lobbyIdleRef}
            onEnded={handleLobbyIdleEnd}
            muted
            playsInline
            style={{
              ...st.scrollBg,
              zIndex: 1,
              opacity: lobbyIdlePlaying ? 1 : 0,
              transition: 'opacity 0.6s ease',
            }}
          />
          <div style={st.content}>
            {view === 'menu' && menuView}
            {view === 'setup' && setupView}
            {view === 'options' && optionsView}
            {view === 'games' && gamesView}
            {view === 'leaderboard' && leaderboardView}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const st: Record<string, React.CSSProperties> = {
  // ── Layout: aspect-ratio locked to scroll image ──
  page: {
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: '#0a0806',
    overflow: 'auto',
  },
  aspectContainer: {
    position: 'relative',
    width: '100%',
    minHeight: '100vh',
    aspectRatio: '1.79',
    maxWidth: 'calc(100vh * 1.79)',
    overflow: 'visible',
  },
  scrollBg: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    zIndex: 0,
    pointerEvents: 'none',
  },
  content: {
    position: 'absolute',
    top: '27%',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '43%',
    maxHeight: '55%',
    overflowY: 'auto',
    boxSizing: 'border-box',
    padding: '0 12px',
  },
  // ── Menu ──
  menuArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  menuBtn: {
    background: 'rgba(30, 20, 10, 0.08)',
    border: '2px solid rgba(61, 40, 18, 0.3)',
    borderRadius: 2,
    padding: '10px 32px',
    color: '#1e140a',
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 10,
    cursor: 'pointer',
    minWidth: 220,
    textAlign: 'center',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    transition: 'background 0.15s, border-color 0.15s',
  },
  menuBtnPrimary: {
    background: '#8b1a1a',
    border: '2px solid #8b1a1a',
    fontSize: 11,
    padding: '12px 40px',
    color: '#e8d5a3',
    boxShadow: '0 0 0 2px #8b1a1a, 0 0 0 4px rgba(10,8,6,0.3), 0 4px 12px rgba(139,26,26,0.3)',
  },
  quitBtn: {
    marginTop: 8,
    background: 'rgba(30, 20, 10, 0.06)',
    border: '1px solid rgba(92, 61, 26, 0.2)',
    color: '#6b5840',
    fontSize: '0.8rem',
  },
  // ── Navigation ──
  backBtn: {
    background: 'none',
    border: 'none',
    color: '#5a4630',
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 8,
    cursor: 'pointer',
    padding: '4px 0',
    marginBottom: 8,
  },
  panelTitle: {
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 13,
    color: '#1e140a',
    letterSpacing: '0.5px',
    textAlign: 'center',
    marginBottom: 16,
    paddingBottom: 10,
    borderBottom: '2px solid rgba(61, 40, 18, 0.2)',
  },
  // ── Config / Setup ──
  configGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 20,
  },
  field: { marginBottom: 12 },
  label: {
    display: 'block',
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 9,
    color: '#3d2812',
    letterSpacing: '0.3px',
    marginBottom: 6,
  },
  select: {
    width: '100%',
    background: 'linear-gradient(180deg, rgba(92, 61, 26, 0.04), rgba(92, 61, 26, 0.1))',
    border: '1px solid rgba(139, 94, 42, 0.3)',
    borderRadius: 2,
    color: '#1e140a',
    padding: '4px 6px',
    fontSize: '0.78rem',
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.08)',
  },
  smallBtn: {
    background: 'linear-gradient(180deg, rgba(92, 61, 26, 0.06), rgba(92, 61, 26, 0.14))',
    border: '1px solid rgba(139, 94, 42, 0.3)',
    borderRadius: 2,
    padding: '3px 8px',
    color: '#3d2812',
    fontSize: '0.68rem',
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
  },
  toggleBtn: {
    flex: 1,
    border: 'none',
    borderRight: '1px solid rgba(92, 61, 26, 0.12)',
    padding: '5px 12px',
    color: '#1e140a',
    fontSize: '0.72rem',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  // ── Feedback ──
  errorBox: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.25)',
    borderLeft: '3px solid #991B1B',
    borderRadius: 2,
    padding: '8px 12px',
    fontSize: '0.78rem',
    color: '#991B1B',
    marginBottom: 10,
    maxWidth: 360,
    textAlign: 'center',
  },
  // ── Game List ──
  gamesSection: { width: '100%', marginBottom: 20 },
  gameCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    background: 'rgba(30, 20, 10, 0.06)',
    border: '1px solid rgba(139, 94, 42, 0.15)',
    borderLeft: '3px solid rgba(139, 94, 42, 0.25)',
    borderRadius: 2,
    cursor: 'pointer',
    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
  },
  // ── Options Tabs ──
  tabBar: {
    display: 'flex',
    gap: 2,
    flexWrap: 'wrap',
    marginBottom: 12,
    borderBottom: '2px solid rgba(139, 94, 42, 0.2)',
    paddingBottom: 2,
  },
  tab: {
    background: 'none',
    border: 'none',
    padding: '6px 8px',
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 7,
    color: '#8b7355',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    transition: 'color 0.15s, border-color 0.15s',
  },
  tabActive: {
    color: '#3d2812',
    borderBottomColor: '#8b1a1a',
  },
  tabContent: {
    minHeight: 200,
  },
  optLabel: {
    display: 'block',
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 8,
    color: '#3d2812',
    marginBottom: 4,
  },
  optHelp: {
    fontSize: '0.62rem',
    color: '#6b5840',
    lineHeight: 1.4,
    marginBottom: 2,
  },
};
