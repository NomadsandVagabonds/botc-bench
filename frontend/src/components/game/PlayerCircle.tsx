import { useMemo } from 'react';
import { useGameStore } from '../../stores/gameStore.ts';
import { getProviderColor, shortModelName } from '../../utils/models.ts';
import type { Player, BreakoutGroup } from '../../types/game.ts';

// ── Geometry ──────────────────────────────────────────────────────────

const SVG_SIZE = 500;
const CENTER = SVG_SIZE / 2;
const RADIUS = 190;
const SEAT_R = 22;

function seatPos(index: number, total: number) {
  const angle = (2 * Math.PI * index) / total - Math.PI / 2;
  return {
    x: CENTER + RADIUS * Math.cos(angle),
    y: CENTER + RADIUS * Math.sin(angle),
  };
}

// ── Breakout arcs ─────────────────────────────────────────────────────

const GROUP_COLORS = [
  '#6366F1', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F97316',
];

function BreakoutArcs({
  groups,
  total,
}: {
  groups: BreakoutGroup[];
  total: number;
}) {
  const arcR = RADIUS + 34;

  return (
    <>
      {groups.map((g, gi) => {
        if (g.members.length < 2) return null;
        const angles = g.members
          .map((s) => ((2 * Math.PI * s) / total - Math.PI / 2))
          .sort((a, b) => a - b);

        const startAngle = angles[0] - 0.12;
        const endAngle = angles[angles.length - 1] + 0.12;
        const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

        const x1 = CENTER + arcR * Math.cos(startAngle);
        const y1 = CENTER + arcR * Math.sin(startAngle);
        const x2 = CENTER + arcR * Math.cos(endAngle);
        const y2 = CENTER + arcR * Math.sin(endAngle);

        return (
          <path
            key={g.id}
            d={`M ${x1} ${y1} A ${arcR} ${arcR} 0 ${largeArc} 1 ${x2} ${y2}`}
            fill="none"
            stroke={GROUP_COLORS[gi % GROUP_COLORS.length]}
            strokeWidth={3}
            strokeLinecap="round"
            opacity={0.6}
          />
        );
      })}
    </>
  );
}

// ── Single seat ───────────────────────────────────────────────────────

function SeatNode({
  player,
  pos,
  isSelected,
  showRole,
  onClick,
}: {
  player: Player;
  pos: { x: number; y: number };
  isSelected: boolean;
  showRole: boolean;
  onClick: () => void;
}) {
  const color = getProviderColor(player.modelName || player.agentId);
  const alive = player.isAlive;

  return (
    <g
      onClick={onClick}
      style={{ cursor: 'pointer' }}
      role="button"
      aria-label={`Seat ${player.seat}: ${player.agentId}`}
    >
      {/* Selection ring */}
      {isSelected && (
        <circle
          cx={pos.x}
          cy={pos.y}
          r={SEAT_R + 5}
          fill="none"
          stroke="#fff"
          strokeWidth={2}
          opacity={0.7}
        />
      )}

      {/* Pulsing glow for alive agents */}
      {alive && (
        <circle
          cx={pos.x}
          cy={pos.y}
          r={SEAT_R + 2}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          opacity={0.3}
        >
          <animate
            attributeName="opacity"
            values="0.15;0.5;0.15"
            dur="2.5s"
            repeatCount="indefinite"
          />
        </circle>
      )}

      {/* Main circle */}
      <circle
        cx={pos.x}
        cy={pos.y}
        r={SEAT_R}
        fill={alive ? color : '#374151'}
        opacity={alive ? 0.9 : 0.4}
        stroke={alive ? color : '#4B5563'}
        strokeWidth={alive ? 2 : 1}
      />

      {/* Dead cross */}
      {!alive && (
        <>
          <line
            x1={pos.x - 8}
            y1={pos.y - 8}
            x2={pos.x + 8}
            y2={pos.y + 8}
            stroke="#EF4444"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <line
            x1={pos.x + 8}
            y1={pos.y - 8}
            x2={pos.x - 8}
            y2={pos.y + 8}
            stroke="#EF4444"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </>
      )}

      {/* Seat number */}
      <text
        x={pos.x}
        y={pos.y + 1}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={12}
        fontWeight={700}
        fill="#fff"
        style={{ pointerEvents: 'none' }}
      >
        {player.seat}
      </text>

      {/* Agent name (below circle) */}
      <text
        x={pos.x}
        y={pos.y + SEAT_R + 14}
        textAnchor="middle"
        fontSize={9}
        fill="rgba(255,255,255,0.6)"
        style={{ pointerEvents: 'none' }}
      >
        {shortModelName(player.modelName || player.agentId)}
      </text>

      {/* Role (above circle, observer mode only) */}
      {showRole && (
        <text
          x={pos.x}
          y={pos.y - SEAT_R - 8}
          textAnchor="middle"
          fontSize={9}
          fontWeight={600}
          fill={alive ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)'}
          style={{ pointerEvents: 'none', fontFamily: 'var(--font-mono)' }}
        >
          {player.role}
        </text>
      )}

      {/* Status indicators */}
      {(player.isPoisoned || player.isDrunk) && (
        <circle cx={pos.x + SEAT_R - 4} cy={pos.y - SEAT_R + 4} r={4} fill={player.isDrunk ? '#F59E0B' : '#A855F7'} />
      )}
      {player.isProtected && (
        <circle cx={pos.x - SEAT_R + 4} cy={pos.y - SEAT_R + 4} r={4} fill="#22D3EE" />
      )}
    </g>
  );
}

// ── Main component ────────────────────────────────────────────────────

export function PlayerCircle() {
  const gameState = useGameStore((s) => s.gameState);
  const selectedPlayer = useGameStore((s) => s.selectedPlayer);
  const showObserverInfo = useGameStore((s) => s.showObserverInfo);
  const selectPlayer = useGameStore((s) => s.selectPlayer);

  const players = gameState?.players ?? [];

  const positions = useMemo(
    () => players.map((_, i) => seatPos(i, players.length)),
    [players.length],
  );

  // Current breakout groups (latest round)
  const currentBreakouts = useMemo(() => {
    if (!gameState?.breakoutGroups.length) return [];
    const maxRound = Math.max(...gameState.breakoutGroups.map((g) => g.roundNumber));
    return gameState.breakoutGroups.filter((g) => g.roundNumber === maxRound);
  }, [gameState?.breakoutGroups]);

  if (!players.length) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <span className="text-muted">No game loaded</span>
      </div>
    );
  }

  const aliveCount = players.filter((p) => p.isAlive).length;

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '1' }}>
      <svg
        viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
        style={{ width: '100%', height: '100%' }}
      >
        {/* Connecting ring */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={1}
        />

        {/* Center info */}
        <text
          x={CENTER}
          y={CENTER - 12}
          textAnchor="middle"
          fontSize={28}
          fontWeight={700}
          fill="rgba(255,255,255,0.8)"
        >
          {aliveCount}/{players.length}
        </text>
        <text
          x={CENTER}
          y={CENTER + 12}
          textAnchor="middle"
          fontSize={11}
          fill="rgba(255,255,255,0.4)"
        >
          alive
        </text>

        {/* Breakout arcs */}
        {gameState?.phase === 'day_breakout' && (
          <BreakoutArcs groups={currentBreakouts} total={players.length} />
        )}

        {/* Player seats */}
        {players.map((player, i) => (
          <SeatNode
            key={player.seat}
            player={player}
            pos={positions[i]}
            isSelected={selectedPlayer === player.seat}
            showRole={showObserverInfo}
            onClick={() =>
              selectPlayer(selectedPlayer === player.seat ? null : player.seat)
            }
          />
        ))}
      </svg>
    </div>
  );
}
