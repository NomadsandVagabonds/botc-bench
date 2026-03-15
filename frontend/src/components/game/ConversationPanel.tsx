import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../../stores/gameStore.ts';
import { getProviderColor, shortModelName, getPhaseLabel, getPhaseColor } from '../../utils/models.ts';
import type { Message, Player, Phase } from '../../types/game.ts';
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

// ── Single message ────────────────────────────────────────────────────

function MessageRow({
  message,
  players,
}: {
  message: Message;
  players: Player[];
}) {
  const sender = message.senderSeat !== null
    ? players.find((p) => p.seat === message.senderSeat)
    : null;

  const isWhisper = message.type === MessageType.WHISPER;
  const isSystem = message.type === MessageType.SYSTEM || message.type === MessageType.NARRATOR;
  const isAccusation = message.type === MessageType.ACCUSATION;
  const isDefense = message.type === MessageType.DEFENSE;
  const isSpeech = isAccusation || isDefense;

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
        {sender && (
          <>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: getProviderColor(sender.modelName || sender.agentId),
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                color: getProviderColor(sender.modelName || sender.agentId),
              }}
            >
              [{sender.seat}] {sender.characterName || shortModelName(sender.modelName || sender.agentId)}
            </span>
            {sender.characterName && (
              <span
                style={{
                  fontSize: '0.65rem',
                  color: 'rgba(255,255,255,0.3)',
                  fontWeight: 400,
                }}
              >
                {shortModelName(sender.modelName || sender.agentId)}
              </span>
            )}
          </>
        )}
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
}: {
  section: PhaseSection;
  isExpanded: boolean;
  onToggle: () => void;
  players: Player[];
}) {
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
              {section.messages.map((msg) => (
                <MessageRow key={msg.id} message={msg} players={players} />
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

// ── Main component ────────────────────────────────────────────────────

export function ConversationPanel() {
  const gameState = useGameStore((s) => s.gameState);
  const selectedGroup = useGameStore((s) => s.selectedGroup);
  const selectGroup = useGameStore((s) => s.selectGroup);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const players = gameState?.players ?? [];
  const messages = gameState?.messages ?? [];
  const whispers = gameState?.whispers ?? [];
  const breakoutGroups = gameState?.breakoutGroups ?? [];

  // Compute tab list: "Public" + one per active breakout group
  const latestRound = useMemo(() => {
    if (!breakoutGroups.length) return -1;
    return Math.max(...breakoutGroups.map((g) => g.roundNumber));
  }, [breakoutGroups]);

  const currentGroups = useMemo(
    () => breakoutGroups.filter((g) => g.roundNumber === latestRound),
    [breakoutGroups, latestRound],
  );

  const tabs = useMemo(() => {
    const t: { id: string | null; label: string }[] = [
      { id: null, label: 'Public' },
    ];
    currentGroups.forEach((g, idx) => {
      const memberNames = g.members
        .map((seat: any) => {
          const p = players.find((pl) => pl.seat === (typeof seat === 'string' ? parseInt(seat) : seat));
          return p ? (p.characterName || shortModelName(p.modelName || p.agentId)) : `S${seat}`;
        })
        .join(', ');
      t.push({
        id: g.id,
        label: `Grp ${String.fromCharCode(65 + idx)}: ${memberNames}`,
      });
    });
    // Add whispers tab if any exist
    if (whispers.length > 0) {
      t.push({ id: '__whispers__', label: 'Whispers' });
    }
    return t;
  }, [currentGroups, whispers.length]);

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

  // Filter messages for the selected tab
  const filteredMessages = useMemo(() => {
    if (selectedGroup === '__whispers__') {
      return whispers;
    }
    if (selectedGroup) {
      // Show messages for this specific group only
      return messages.filter((m) => m.groupId === selectedGroup);
    }
    // Public: show ALL messages (including breakout) inline in chronological order
    return messages;
  }, [messages, whispers, selectedGroup]);

  // Group messages into phase sections
  const sections = useMemo(
    () => groupMessagesIntoSections(filteredMessages, groupLabels),
    [filteredMessages, groupLabels],
  );

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

  return (
    <div style={styles.container}>
      {/* Tabs */}
      <div style={styles.tabs}>
        {tabs.map((tab) => (
          <button
            key={tab.id ?? 'public'}
            onClick={() => selectGroup(tab.id)}
            style={{
              ...styles.tab,
              borderBottom: selectedGroup === tab.id
                ? '2px solid #6366F1'
                : '2px solid transparent',
              color: selectedGroup === tab.id
                ? 'rgba(255,255,255,0.9)'
                : 'rgba(255,255,255,0.45)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Messages with accordion sections */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={styles.messages}
      >
        {sections.length === 0 ? (
          <div style={styles.empty} className="text-muted">
            No messages yet
          </div>
        ) : (
          sections.map((section) => (
            <AccordionSection
              key={section.key}
              section={section}
              isExpanded={expandedSections.has(section.key)}
              onToggle={() => toggleSection(section.key)}
              players={players}
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
