import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../../stores/gameStore.ts';
import { getProviderColor, shortModelName, getPhaseLabel, getPhaseColor, getRoleTypeColor } from '../../utils/models.ts';
import type { Message, Player, Phase, NightActionEntry } from '../../types/game.ts';
import { MessageType } from '../../types/game.ts';

// ── Types ─────────────────────────────────────────────────────────────

interface PhaseSection {
  key: string;        // unique key like "day-1-day_discussion" or "day-1-day_breakout-groupId"
  phase: Phase;
  dayNumber: number;
  label: string;
  messages: Message[];
  isNight: boolean;
  groupId?: string | null;  // set for breakout group sections
}

type PanelTab = 'chat' | 'players' | 'whispers';

// ── Phase icons ───────────────────────────────────────────────────────

const PHASE_ICONS: Record<string, string> = {
  setup: '\u2699\uFE0F',
  first_night: '\uD83C\uDF19',
  night: '\uD83C\uDF19',
  day_discussion: '\u2600\uFE0F',
  day_breakout: '\uD83D\uDDE3\uFE0F',
  day_regroup: '\uD83D\uDCE2',
  nominations: '\u2696\uFE0F',
  voting: '\uD83D\uDDF3\uFE0F',
  execution: '\u2620\uFE0F',
  game_over: '\uD83C\uDFC1',
  debrief: '\uD83D\uDCDD',
};

function getPhaseIcon(phase: string): string {
  return PHASE_ICONS[phase] ?? '\u2B50';
}

// ── Message badge ─────────────────────────────────────────────────────

const TYPE_BADGE_COLORS: Record<string, string> = {
  public: '#3B82F6',
  whisper: '#A855F7',
  system: '#6B7280',
  narrator: '#F59E0B',
  narration: '#F59E0B',
  breakout: '#10B981',
  accusation: '#EF4444',
  defense: '#3B82F6',
  private_info: '#C084FC',
};

const TYPE_BADGE_LABELS: Record<string, string> = {
  accusation: 'ACCUSATION',
  defense: 'DEFENSE',
  private_info: 'NIGHT INFO',
  narration: 'NARRATOR',
  breakout: 'BREAKOUT',
};

function TypeBadge({ type }: { type: string }) {
  const color = TYPE_BADGE_COLORS[type] ?? '#6B7280';
  const label = TYPE_BADGE_LABELS[type] ?? type.replace('_', ' ');
  const isSpeech = type === 'accusation' || type === 'defense';
  const icon = type === 'accusation' ? '\u2696\uFE0F ' : type === 'defense' ? '\uD83D\uDEE1\uFE0F ' : '';
  return (
    <span
      style={{
        fontSize: isSpeech ? '0.7rem' : '0.65rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color,
        opacity: isSpeech ? 1 : 0.8,
      }}
    >
      {icon}{label}
    </span>
  );
}

// ── Clickable player name ─────────────────────────────────────────────

function ClickablePlayerName({
  sender,
  showRole,
}: {
  sender: Player;
  showRole?: boolean;
}) {
  const selectPlayer = useGameStore((s) => s.selectPlayer);
  const [hovered, setHovered] = useState(false);
  const providerColor = getProviderColor(sender.modelName || sender.agentId);
  const isEvil = sender.alignment === 'evil';

  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation();
        selectPlayer(sender.seat);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: providerColor,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: '0.8rem',
          fontWeight: 600,
          color: providerColor,
          textDecoration: hovered ? 'underline' : 'none',
          textUnderlineOffset: '2px',
        }}
      >
        [{sender.seat}] {sender.characterName || shortModelName(sender.modelName || sender.agentId)}
      </span>
      {showRole && sender.role && (
        <span
          style={{
            fontSize: '0.6rem',
            fontWeight: 700,
            color: isEvil ? '#f87171' : '#93c5fd',
            background: isEvil ? 'rgba(248,113,113,0.1)' : 'rgba(147,197,253,0.1)',
            padding: '1px 4px',
            borderRadius: 3,
          }}
        >
          {sender.role}
        </span>
      )}
      {sender.characterName && (
        <span
          style={{
            fontSize: '0.6rem',
            color: 'rgba(255,255,255,0.25)',
            fontWeight: 400,
          }}
        >
          {shortModelName(sender.modelName || sender.agentId)}
        </span>
      )}
    </span>
  );
}

// ── Single message ────────────────────────────────────────────────────

function MessageRow({
  message,
  players,
  showObserverInfo,
}: {
  message: Message;
  players: Player[];
  showObserverInfo: boolean;
}) {
  const sender = message.senderSeat !== null
    ? players.find((p) => p.seat === message.senderSeat)
    : null;

  const isWhisper = message.type === MessageType.WHISPER;
  const isSystem = message.type === MessageType.SYSTEM || message.type === MessageType.NARRATOR;
  const isAccusation = message.type === MessageType.ACCUSATION;
  const isDefense = message.type === MessageType.DEFENSE;
  const isSpeech = isAccusation || isDefense;

  const [internalExpanded, setInternalExpanded] = useState(false);
  const hasInternal = !!message.internal && showObserverInfo;

  // Distinct styling for accusation/defense speeches
  const speechStyle: React.CSSProperties = isSpeech
    ? {
        borderLeft: `3px solid ${isAccusation ? '#EF4444' : '#3B82F6'}`,
        background: isAccusation
          ? 'rgba(239, 68, 68, 0.08)'
          : 'rgba(59, 130, 246, 0.08)',
        margin: '4px 0',
        borderRadius: '0 6px 6px 0',
      }
    : {};

  return (
    <div
      className="animate-fade-in"
      style={{
        padding: isSpeech ? '8px 14px' : '6px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        fontStyle: isWhisper ? 'italic' : undefined,
        opacity: isSystem ? 0.7 : 1,
        ...speechStyle,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        {sender && <ClickablePlayerName sender={sender} showRole={showObserverInfo} />}
        <TypeBadge type={message.type} />
      </div>
      <div
        style={{
          fontSize: isSpeech ? '0.88rem' : '0.85rem',
          color: isSystem
            ? 'rgba(255,255,255,0.5)'
            : isSpeech
              ? 'rgba(255,255,255,0.95)'
              : 'rgba(255,255,255,0.85)',
          lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontWeight: isSpeech ? 500 : undefined,
        }}
      >
        {message.content}
      </div>
      {hasInternal && (
        <div
          style={{
            marginTop: 4,
            background: 'rgba(139, 92, 246, 0.08)',
            borderRadius: 4,
            border: '1px solid rgba(139, 92, 246, 0.15)',
            overflow: 'hidden',
          }}
        >
          <button
            onClick={() => setInternalExpanded(!internalExpanded)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              width: '100%',
              padding: '3px 8px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.68rem',
              fontWeight: 600,
              color: 'rgba(139, 92, 246, 0.6)',
              letterSpacing: '0.03em',
            }}
          >
            <span
              style={{
                transform: internalExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s',
                fontSize: '0.6rem',
              }}
            >
              {'\u25B6'}
            </span>
            Internal Reasoning
          </button>
          {internalExpanded && (
            <div
              style={{
                padding: '4px 8px 6px',
                fontSize: '0.78rem',
                fontStyle: 'italic',
                color: 'rgba(255, 255, 255, 0.5)',
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                opacity: 0.85,
              }}
            >
              {message.internal}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Accordion section header ──────────────────────────────────────────

function SectionHeader({
  section,
  isExpanded,
  onToggle,
}: {
  section: PhaseSection;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const phaseColor = getPhaseColor(section.phase);

  const isBreakout = !!section.groupId;

  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        padding: '8px 12px',
        background: section.isNight
          ? 'rgba(99, 102, 241, 0.12)'
          : isBreakout
            ? 'rgba(16, 185, 129, 0.08)'
            : 'rgba(255, 255, 255, 0.04)',
        border: 'none',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        cursor: 'pointer',
        gap: 8,
        transition: 'background 0.15s',
      }}
    >
      {/* Expand/collapse chevron */}
      <span
        style={{
          fontSize: '0.7rem',
          color: 'rgba(255,255,255,0.4)',
          transition: 'transform 0.2s',
          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
          flexShrink: 0,
        }}
      >
        {'\u25B6'}
      </span>

      {/* Phase icon */}
      <span style={{ fontSize: '0.85rem', flexShrink: 0 }}>
        {isBreakout ? '\uD83D\uDDE3\uFE0F' : getPhaseIcon(section.phase)}
      </span>

      {/* Phase label */}
      <span
        style={{
          fontSize: '0.78rem',
          fontWeight: 600,
          color: isBreakout ? '#10B981' : phaseColor,
          flex: 1,
          textAlign: 'left',
        }}
      >
        {section.label}
      </span>

      {/* Message count badge */}
      <span
        style={{
          fontSize: '0.65rem',
          fontWeight: 600,
          color: 'rgba(255,255,255,0.35)',
          background: 'rgba(255,255,255,0.06)',
          padding: '1px 6px',
          borderRadius: 8,
          flexShrink: 0,
        }}
      >
        {section.messages.length}
      </span>
    </button>
  );
}

// ── Accordion section ─────────────────────────────────────────────────

function AccordionSection({
  section,
  isExpanded,
  onToggle,
  players,
  showObserverInfo,
  nightActionsForSection,
}: {
  section: PhaseSection;
  isExpanded: boolean;
  onToggle: () => void;
  players: Player[];
  showObserverInfo: boolean;
  nightActionsForSection?: NightActionEntry[];
}) {
  const showNightActions = showObserverInfo && section.isNight && nightActionsForSection && nightActionsForSection.length > 0;

  return (
    <div>
      <SectionHeader
        section={section}
        isExpanded={isExpanded}
        onToggle={onToggle}
      />
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key={section.key}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                background: section.isNight
                  ? 'rgba(30, 27, 60, 0.3)'
                  : section.groupId
                    ? 'rgba(16, 185, 129, 0.04)'
                    : undefined,
              }}
            >
              {showNightActions && nightActionsForSection.map((entry, i) => (
                <NightActionRow key={`na-${entry.seat}-${entry.day}-${i}`} entry={entry} />
              ))}
              {section.messages.map((msg) => (
                <MessageRow key={msg.id} message={msg} players={players} showObserverInfo={showObserverInfo} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Group messages into phase sections ────────────────────────────────

function groupMessagesIntoSections(
  messages: Message[],
  groupLabels: Record<string, string> = {},
): PhaseSection[] {
  if (messages.length === 0) return [];

  const sections: PhaseSection[] = [];
  let currentKey: string | null = null;
  let currentSection: PhaseSection | null = null;

  for (const msg of messages) {
    const phase = msg.phase ?? 'setup';
    const dayNumber = msg.dayNumber ?? 0;
    const groupId = msg.groupId ?? null;

    // Include groupId in key so breakout groups get their own sections
    const key = groupId ? `${phase}-${dayNumber}-${groupId}` : `${phase}-${dayNumber}`;

    if (key !== currentKey) {
      // Start a new section
      const isNight = phase === 'night' || phase === 'first_night';
      let label = buildSectionLabel(phase, dayNumber);

      // Add group label for breakout sections
      if (groupId && groupLabels[groupId]) {
        label = `Day ${dayNumber} \u2014 ${groupLabels[groupId]}`;
      }

      currentSection = {
        key,
        phase: phase as Phase,
        dayNumber,
        label,
        messages: [],
        isNight,
        groupId,
      };
      sections.push(currentSection);
      currentKey = key;
    }

    currentSection!.messages.push(msg);
  }

  return sections;
}

function buildSectionLabel(phase: string, dayNumber: number): string {
  switch (phase) {
    case 'setup':
      return 'Setup';
    case 'first_night':
      return 'Night 0 \u2014 First Night';
    case 'night':
      return `Night ${dayNumber}`;
    case 'day_discussion':
      return `Day ${dayNumber} \u2014 Discussion`;
    case 'day_breakout':
      return `Day ${dayNumber} \u2014 Breakout Groups`;
    case 'day_regroup':
      return `Day ${dayNumber} \u2014 Regroup`;
    case 'nominations':
      return `Day ${dayNumber} \u2014 Nominations`;
    case 'voting':
      return `Day ${dayNumber} \u2014 Voting`;
    case 'execution':
      return `Day ${dayNumber} \u2014 Execution`;
    case 'game_over':
      return 'Game Over';
    case 'debrief':
      return 'Debrief';
    default:
      return `${getPhaseLabel(phase)} (Day ${dayNumber})`;
  }
}

// ── Player list row ──────────────────────────────────────────────────

function PlayerRow({ player }: { player: Player }) {
  const selectPlayer = useGameStore((s) => s.selectPlayer);
  const showObserverInfo = useGameStore((s) => s.showObserverInfo);
  const [hovered, setHovered] = useState(false);
  const providerColor = getProviderColor(player.modelName || player.agentId);

  return (
    <div
      onClick={() => selectPlayer(player.seat)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        cursor: 'pointer',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
        transition: 'background 0.15s',
      }}
    >
      {/* Provider-colored dot */}
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: providerColor,
          flexShrink: 0,
          boxShadow: `0 0 6px ${providerColor}66`,
        }}
      />

      {/* Name + model column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span
            style={{
              fontSize: '0.88rem',
              fontWeight: 600,
              color: 'rgba(255,255,255,0.9)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {player.characterName || player.agentId}
          </span>
          <span
            style={{
              fontSize: '0.65rem',
              color: 'rgba(255,255,255,0.3)',
              flexShrink: 0,
            }}
          >
            #{player.seat}
          </span>
        </div>
        <div
          style={{
            fontSize: '0.7rem',
            color: 'rgba(255,255,255,0.35)',
            marginTop: 1,
          }}
        >
          {shortModelName(player.modelName || player.agentId)}
        </div>
      </div>

      {/* Role + alignment (observer only) */}
      {showObserverInfo && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              color: getRoleTypeColor(player.roleType),
            }}
          >
            {player.role}
          </span>
          <span
            style={{
              fontSize: '0.6rem',
              fontWeight: 600,
              padding: '1px 5px',
              borderRadius: 4,
              background: player.alignment === 'good'
                ? 'rgba(59, 130, 246, 0.15)'
                : 'rgba(239, 68, 68, 0.15)',
              color: player.alignment === 'good' ? '#3B82F6' : '#EF4444',
            }}
          >
            {player.alignment === 'good' ? 'GOOD' : 'EVIL'}
          </span>
        </div>
      )}

      {/* Status badges */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
        <span
          style={{
            fontSize: '0.62rem',
            fontWeight: 600,
            padding: '1px 6px',
            borderRadius: 4,
            background: player.isAlive
              ? 'rgba(16, 185, 129, 0.15)'
              : 'rgba(239, 68, 68, 0.15)',
            color: player.isAlive ? '#10B981' : '#EF4444',
          }}
        >
          {player.isAlive ? 'ALIVE' : 'DEAD'}
        </span>

        {/* Observer-only status indicators */}
        {showObserverInfo && (
          <div style={{ display: 'flex', gap: 3 }}>
            {player.isPoisoned && !player.isDrunk && (
              <span style={{ fontSize: '0.6rem', color: '#A855F7', fontWeight: 600 }}>POI</span>
            )}
            {player.isDrunk && (
              <span style={{ fontSize: '0.6rem', color: '#F59E0B', fontWeight: 600 }}>DRK</span>
            )}
            {player.isProtected && (
              <span style={{ fontSize: '0.6rem', color: '#22D3EE', fontWeight: 600 }}>PRO</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Players tab content ──────────────────────────────────────────────

function PlayersTab({ players }: { players: Player[] }) {
  // Show alive players first, then dead, each sorted by seat
  const sortedPlayers = useMemo(() => {
    const alive = players.filter((p) => p.isAlive).sort((a, b) => a.seat - b.seat);
    const dead = players.filter((p) => !p.isAlive).sort((a, b) => a.seat - b.seat);
    return [...alive, ...dead];
  }, [players]);

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {sortedPlayers.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', fontSize: '0.85rem', color: 'rgba(255,255,255,0.4)' }}>
          No players yet
        </div>
      ) : (
        <>
          <div
            style={{
              padding: '8px 14px 4px',
              fontSize: '0.65rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'rgba(255,255,255,0.3)',
            }}
          >
            {players.filter((p) => p.isAlive).length} alive / {players.filter((p) => !p.isAlive).length} dead
          </div>
          {sortedPlayers.map((player) => (
            <PlayerRow key={player.seat} player={player} />
          ))}
        </>
      )}
    </div>
  );
}

// ── Night action row (observer only) ─────────────────────────────────

function NightActionRow({ entry }: { entry: NightActionEntry }) {
  const targetText = entry.targetName ? ` ${entry.targetName}` : '';
  const label = `\uD83C\uDF19 [${entry.role}] ${entry.name} ${entry.action}${targetText}`;

  return (
    <div
      style={{
        padding: '5px 12px',
        background: 'rgba(99, 102, 241, 0.10)',
        borderLeft: '3px solid rgba(139, 92, 246, 0.5)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        fontFamily: 'monospace',
        fontSize: '0.78rem',
        color: 'rgba(192, 132, 252, 0.9)',
        lineHeight: 1.45,
        whiteSpace: 'pre-wrap',
      }}
    >
      {label}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────

export function ConversationPanel() {
  const gameState = useGameStore((s) => s.gameState);
  const selectGroup = useGameStore((s) => s.selectGroup);
  const showObserverInfo = useGameStore((s) => s.showObserverInfo);
  const nightActions = useGameStore((s) => s.nightActions);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<PanelTab>('chat');

  const players = gameState?.players ?? [];
  const messages = gameState?.messages ?? [];
  const whispers = gameState?.whispers ?? [];
  const breakoutGroups = gameState?.breakoutGroups ?? [];

  const hasWhispers = whispers.length > 0;

  // Build a lookup from groupId to label for breakout group badges
  const groupLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    breakoutGroups.forEach((g) => {
      // Use letter index within each round
      const roundGroups = breakoutGroups.filter((bg) => bg.roundNumber === g.roundNumber);
      const indexInRound = roundGroups.indexOf(g);
      const letter = String.fromCharCode(65 + indexInRound);
      const memberNames = g.members
        .map((seat: any) => {
          const p = players.find((pl) => pl.seat === (typeof seat === 'string' ? parseInt(seat) : seat));
          return p ? (p.characterName || shortModelName(p.modelName || p.agentId)) : `S${seat}`;
        })
        .join(', ');
      labels[g.id] = `Group ${letter}: ${memberNames}`;
    });
    return labels;
  }, [breakoutGroups, players]);

  // For the chat tab, show ALL messages inline
  const chatMessages = useMemo(() => messages, [messages]);

  // For the whispers tab
  const whisperMessages = useMemo(() => whispers, [whispers]);

  // Pick the right messages based on active tab
  const filteredMessages = useMemo(() => {
    if (activeTab === 'whispers') return whisperMessages;
    return chatMessages;
  }, [activeTab, chatMessages, whisperMessages]);

  // Group messages into phase sections
  const sections = useMemo(
    () => groupMessagesIntoSections(filteredMessages, groupLabels),
    [filteredMessages, groupLabels],
  );

  // Build lookup of night actions by day number for rendering in night sections
  const nightActionsByDay = useMemo(() => {
    const map: Record<number, NightActionEntry[]> = {};
    for (const entry of nightActions) {
      if (!map[entry.day]) map[entry.day] = [];
      map[entry.day].push(entry);
    }
    return map;
  }, [nightActions]);

  // Track the latest section key for auto-expand
  const latestSectionKey = sections.length > 0 ? sections[sections.length - 1].key : null;

  // When sections change (new phase), auto-expand the latest and collapse previous latest
  const prevLatestRef = useRef<string | null>(null);
  useEffect(() => {
    if (latestSectionKey && latestSectionKey !== prevLatestRef.current) {
      setExpandedSections((prev) => {
        const next = new Set(prev);
        // Collapse the previous latest section
        if (prevLatestRef.current) {
          next.delete(prevLatestRef.current);
        }
        // Expand the new latest section
        next.add(latestSectionKey);
        return next;
      });
      prevLatestRef.current = latestSectionKey;
    }
  }, [latestSectionKey]);

  // Toggle a section's expanded state
  const toggleSection = useCallback((key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Auto-scroll on new messages in the latest expanded section
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredMessages.length, autoScroll]);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(atBottom);
  }

  // Keep selectedGroup in sync — clear it when switching to chat
  useEffect(() => {
    if (activeTab === 'chat') {
      selectGroup(null);
    } else if (activeTab === 'whispers') {
      selectGroup('__whispers__');
    }
  }, [activeTab, selectGroup]);

  // Build tab list
  const tabs: { id: PanelTab; label: string; show: boolean }[] = [
    { id: 'chat', label: 'Chat', show: true },
    { id: 'players', label: 'Players', show: true },
    { id: 'whispers', label: 'Whispers', show: true },
  ];

  return (
    <div style={styles.container}>
      {/* Tabs */}
      <div style={styles.tabs}>
        {tabs.filter((t) => t.show).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...styles.tab,
              borderBottom: activeTab === tab.id
                ? '2px solid #6366F1'
                : '2px solid transparent',
              color: activeTab === tab.id
                ? 'rgba(255,255,255,0.9)'
                : 'rgba(255,255,255,0.45)',
            }}
          >
            {tab.label}
            {tab.id === 'whispers' && whispers.length > 0 && (
              <span
                style={{
                  marginLeft: 5,
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  color: '#A855F7',
                  background: 'rgba(168, 85, 247, 0.15)',
                  padding: '0px 5px',
                  borderRadius: 8,
                }}
              >
                {whispers.length}
              </span>
            )}
            {tab.id === 'players' && players.length > 0 && (
              <span
                style={{
                  marginLeft: 5,
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  color: 'rgba(255,255,255,0.35)',
                  background: 'rgba(255,255,255,0.06)',
                  padding: '0px 5px',
                  borderRadius: 8,
                }}
              >
                {players.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'players' ? (
        <PlayersTab players={players} />
      ) : activeTab === 'whispers' ? (
        <div ref={scrollRef} onScroll={handleScroll} style={styles.messages}>
          {whispers.length === 0 ? (
            <div style={styles.empty} className="text-muted">No whispers yet</div>
          ) : (
            whispers.map((w: any, i: number) => {
              const from = players.find(p => p.seat === w.fromSeat);
              const to = players.find(p => p.seat === w.toSeat);
              const fromName = from?.characterName || `Seat ${w.fromSeat}`;
              const toName = to?.characterName || `Seat ${w.toSeat}`;
              const fromRole = showObserverInfo && from?.role ? from.role : null;
              const toRole = showObserverInfo && to?.role ? to.role : null;
              const fromColor = from ? getProviderColor(from.modelName || from.agentId) : '#888';
              const fromEvil = from?.alignment === 'evil';
              const toEvil = to?.alignment === 'evil';
              return (
                <div key={w.id || i} style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  borderLeft: '3px solid rgba(168, 85, 247, 0.4)',
                  background: 'rgba(168, 85, 247, 0.05)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: fromColor, flexShrink: 0 }} />
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: fromColor }}>{fromName}</span>
                    {fromRole && <span style={{ fontSize: '0.58rem', fontWeight: 700, color: fromEvil ? '#f87171' : '#93c5fd', background: fromEvil ? 'rgba(248,113,113,0.1)' : 'rgba(147,197,253,0.1)', padding: '1px 4px', borderRadius: 3 }}>{fromRole}</span>}
                    <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)' }}>to</span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{toName}</span>
                    {toRole && <span style={{ fontSize: '0.58rem', fontWeight: 700, color: toEvil ? '#f87171' : '#93c5fd', background: toEvil ? 'rgba(248,113,113,0.1)' : 'rgba(147,197,253,0.1)', padding: '1px 4px', borderRadius: 3 }}>{toRole}</span>}
                  </div>
                  {w.whisperContent && showObserverInfo ? (
                    <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.85)', fontStyle: 'italic', lineHeight: 1.45 }}>
                      &ldquo;{w.whisperContent}&rdquo;
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
                      Whisper content hidden (observer mode off)
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        <>
          {/* Messages with accordion sections */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            style={styles.messages}
          >
            {sections.length === 0 ? (
              <div style={styles.empty} className="text-muted">No messages yet</div>
            ) : (
              sections.map((section) => (
                <AccordionSection
                  key={section.key}
                  section={section}
                  isExpanded={expandedSections.has(section.key)}
                  onToggle={() => toggleSection(section.key)}
                  players={players}
                  showObserverInfo={showObserverInfo}
                  nightActionsForSection={section.isNight ? nightActionsByDay[section.dayNumber] : undefined}
                />
              ))
            )}
          </div>

          {/* Auto-scroll indicator */}
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                scrollRef.current?.scrollTo({
                  top: scrollRef.current.scrollHeight,
                  behavior: 'smooth',
                });
              }}
              style={styles.scrollBtn}
            >
              Scroll to bottom
            </button>
          )}
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    position: 'relative',
    background: 'rgba(255,255,255,0.02)',
    borderLeft: '1px solid rgba(255,255,255,0.08)',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    overflowX: 'auto',
    flexShrink: 0,
  },
  tab: {
    padding: '8px 14px',
    fontSize: '0.78rem',
    fontWeight: 600,
    background: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'color 0.15s',
    display: 'flex',
    alignItems: 'center',
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  empty: {
    padding: 24,
    textAlign: 'center',
    fontSize: '0.85rem',
  },
  scrollBtn: {
    position: 'absolute',
    bottom: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '4px 12px',
    fontSize: '0.75rem',
    background: 'rgba(99,102,241,0.8)',
    color: '#fff',
    borderRadius: 12,
    cursor: 'pointer',
    border: 'none',
  },
};
