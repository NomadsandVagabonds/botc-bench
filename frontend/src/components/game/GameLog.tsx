import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../../stores/gameStore.ts';
import { shortModelName } from '../../utils/models.ts';
import type { Message, NightActionEntry, Player } from '../../types/game.ts';
import { MessageType } from '../../types/game.ts';

// ── Log entry ─────────────────────────────────────────────────────────

interface LogEntry {
  id: string;
  timestamp: number;
  icon: string;
  text: string;
  color: string;
}

function buildLogEntries(
  messages: Message[],
  players: Player[],
  nightActions: NightActionEntry[],
  showObserverInfo: boolean,
): LogEntry[] {
  const entries: LogEntry[] = [];

  const findPlayer = (seat: number) =>
    players.find((p) => p.seat === seat);

  // Add night action entries (observer only)
  if (showObserverInfo) {
    for (const action of nightActions) {
      entries.push({
        id: `night-action-${action.seat}-${action.day}-${action.action}-${action.timestamp}`,
        timestamp: action.timestamp,
        icon: '\uD83C\uDF19',  // moon
        text: `[${action.role}] ${action.effect}`,
        color: '#A855F7',  // purple
      });
    }
  }

  for (const msg of messages) {
    if (msg.type === MessageType.SYSTEM || msg.type === MessageType.NARRATOR) {
      const content = msg.content.toLowerCase();

      // Deaths
      if (content.includes('died') || content.includes('killed') || content.includes('death')) {
        entries.push({
          id: msg.id,
          timestamp: msg.timestamp,
          icon: '\u2620',
          text: msg.content,
          color: '#EF4444',
        });
        continue;
      }

      // Executions
      if (content.includes('executed') || content.includes('execution')) {
        entries.push({
          id: msg.id,
          timestamp: msg.timestamp,
          icon: '\u2694',
          text: msg.content,
          color: '#F97316',
        });
        continue;
      }

      // Phase changes
      if (content.includes('phase') || content.includes('night falls') || content.includes('dawn') || content.includes('day begins')) {
        entries.push({
          id: msg.id,
          timestamp: msg.timestamp,
          icon: '\u25CB',
          text: msg.content,
          color: '#6366F1',
        });
        continue;
      }

      // Nomination speeches
      if (content.includes('nominat')) {
        entries.push({
          id: msg.id,
          timestamp: msg.timestamp,
          icon: '\u261D',
          text: msg.content,
          color: '#F59E0B',
        });
        continue;
      }

      // Default system message
      entries.push({
        id: msg.id,
        timestamp: msg.timestamp,
        icon: '\u2022',
        text: msg.content,
        color: 'rgba(255,255,255,0.4)',
      });
    }

    // Nomination speeches
    if (msg.type === MessageType.ACCUSATION) {
      const speaker = msg.senderSeat !== null ? findPlayer(msg.senderSeat) : null;
      entries.push({
        id: msg.id,
        timestamp: msg.timestamp,
        icon: '\u261D',
        text: `[${msg.senderSeat}] ${speaker ? shortModelName(speaker.modelName || speaker.agentId) : '?'} nominates: "${msg.content.slice(0, 80)}${msg.content.length > 80 ? '...' : ''}"`,
        color: '#F59E0B',
      });
    }

    if (msg.type === MessageType.DEFENSE) {
      const speaker = msg.senderSeat !== null ? findPlayer(msg.senderSeat) : null;
      entries.push({
        id: msg.id,
        timestamp: msg.timestamp,
        icon: '\u26A1',
        text: `[${msg.senderSeat}] ${speaker ? shortModelName(speaker.modelName || speaker.agentId) : '?'} defends: "${msg.content.slice(0, 80)}${msg.content.length > 80 ? '...' : ''}"`,
        color: '#EF4444',
      });
    }
  }

  return entries.sort((a, b) => a.timestamp - b.timestamp);
}

// ── Main component ────────────────────────────────────────────────────

export function GameLog() {
  const [collapsed, setCollapsed] = useState(true);
  const gameState = useGameStore((s) => s.gameState);
  const showObserverInfo = useGameStore((s) => s.showObserverInfo);
  const nightActions = useGameStore((s) => s.nightActions);

  const messages = gameState?.messages ?? [];
  const players = gameState?.players ?? [];

  const entries = useMemo(
    () => buildLogEntries(messages, players, nightActions, showObserverInfo),
    [messages, players, nightActions, showObserverInfo],
  );

  return (
    <div style={styles.container}>
      {/* Toggle bar */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={styles.toggleBar}
      >
        <span style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.04em' }}>
          GAME LOG
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="text-muted" style={{ fontSize: '0.75rem' }}>
            {entries.length} events
          </span>
          <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' }}>
            {collapsed ? '\u25B2' : '\u25BC'}
          </span>
        </span>
      </button>

      {/* Log content */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            key="log"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={styles.content}>
              {entries.length === 0 ? (
                <div className="text-muted" style={{ padding: 12, fontSize: '0.8rem' }}>
                  No events yet
                </div>
              ) : (
                entries.map((entry) => {
                  const isNightAction = entry.id.startsWith('night-action-');
                  return (
                    <div
                      key={entry.id}
                      style={{
                        ...styles.entry,
                        ...(isNightAction ? styles.nightActionEntry : {}),
                      }}
                    >
                      <span style={{ color: entry.color, flexShrink: 0 }}>
                        {entry.icon}
                      </span>
                      <span
                        style={{
                          fontSize: '0.78rem',
                          color: isNightAction ? '#C4B5FD' : 'rgba(255,255,255,0.7)',
                          fontFamily: 'var(--font-mono)',
                          lineHeight: 1.4,
                          fontStyle: isNightAction ? 'italic' : 'normal',
                        }}
                      >
                        {entry.text}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    borderTop: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.02)',
  },
  toggleBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '6px 16px',
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
  },
  content: {
    maxHeight: 200,
    overflowY: 'auto',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  entry: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '4px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
  },
  nightActionEntry: {
    background: 'rgba(139, 92, 246, 0.06)',
    borderLeft: '2px solid rgba(139, 92, 246, 0.3)',
  },
};
