/**
 * Waypoint-based pathfinding for the town map.
 *
 * The map is isometric pixel art with a central clocktower that blocks
 * direct movement. Agents walk along paths around the square, never
 * through the tower. Positions are in % of map dimensions.
 *
 * Layout (approximate):
 *
 *        [NW]----[N]----[NE]
 *        /                  \
 *      [W]   CLOCKTOWER    [E]
 *        \                  /
 *        [SW]----[S]----[SE]
 *
 * Plus destination nodes for buildings, groups, and the circle.
 */

export type Point = [number, number]; // [x%, y%]

// ---------------------------------------------------------------------------
// Waypoint graph — nodes around the town square
// ---------------------------------------------------------------------------

// Core ring waypoints around the clocktower (agents walk this ring)
const WAYPOINTS: Record<string, Point> = {
  // Ring around the tower (walkable path)
  NW:  [30, 32],
  N:   [50, 22],
  NE:  [70, 32],
  E:   [80, 50],
  SE:  [70, 68],
  S:   [50, 78],
  SW:  [30, 68],
  W:   [20, 50],

  // Building / group destinations (off the ring)
  BLDG_NW: [12, 38],   // left building upper
  BLDG_W:  [12, 58],   // left building lower
  BLDG_NE: [88, 38],   // right building upper
  BLDG_E:  [88, 58],   // right building lower
  BLDG_SW: [18, 82],   // bottom-left area
  BLDG_SE: [82, 82],   // bottom-right area

  // Town square center (in front of tower, for the nomination circle)
  SQ:      [50, 60],
};

// Adjacency — which waypoints connect to which
const EDGES: [string, string][] = [
  // Ring
  ['NW', 'N'],  ['N', 'NE'], ['NE', 'E'],  ['E', 'SE'],
  ['SE', 'S'],  ['S', 'SW'], ['SW', 'W'],  ['W', 'NW'],
  // Shortcuts across the bottom (in front of tower is fine)
  ['SW', 'S'],  ['S', 'SE'],
  ['SW', 'SQ'], ['SE', 'SQ'], ['S', 'SQ'],
  // Building connections
  ['NW', 'BLDG_NW'], ['W', 'BLDG_NW'],
  ['W', 'BLDG_W'],   ['SW', 'BLDG_W'],
  ['NE', 'BLDG_NE'], ['E', 'BLDG_NE'],
  ['E', 'BLDG_E'],   ['SE', 'BLDG_E'],
  ['SW', 'BLDG_SW'], ['S', 'BLDG_SW'],
  ['SE', 'BLDG_SE'], ['S', 'BLDG_SE'],
  // Square center
  ['W', 'SQ'],  ['E', 'SQ'],
];

// Build adjacency map
const ADJ: Record<string, string[]> = {};
for (const id of Object.keys(WAYPOINTS)) {
  ADJ[id] = [];
}
for (const [a, b] of EDGES) {
  ADJ[a].push(b);
  ADJ[b].push(a);
}

// ---------------------------------------------------------------------------
// Clocktower occlusion zone
// The tower has an isometric shape — narrower at top, wider at base.
// We define it as a series of horizontal slices rather than one rectangle.
// Coordinates are in % of map dimensions.
// ---------------------------------------------------------------------------

// Each slice: [yTop, yBottom, xLeft, xRight]
const TOWER_SLICES: [number, number, number, number][] = [
  [10, 20, 44, 56],   // bell/peak — very narrow
  [20, 30, 40, 60],   // upper tower
  [30, 42, 38, 62],   // mid tower (clock face area)
  [42, 52, 37, 63],   // lower tower / base
];

export function isBehindTower(x: number, y: number): boolean {
  for (const [yTop, yBot, xLeft, xRight] of TOWER_SLICES) {
    if (y >= yTop && y <= yBot && x >= xLeft && x <= xRight) {
      return true;
    }
  }
  return false;
}

/**
 * Z-index for a sprite based on its y position.
 * Higher y = closer to camera = higher z-index.
 * Sprites behind the tower get z-index below the tower foreground layer.
 */
export function spriteZIndex(x: number, y: number): number {
  if (isBehindTower(x, y)) {
    return 2; // Behind tower foreground (tower fg is z-index 5)
  }
  // y-based sorting: 10-99 range
  return Math.floor(10 + (y / 100) * 89);
}

// ---------------------------------------------------------------------------
// Pathfinding — BFS on the waypoint graph
// ---------------------------------------------------------------------------

function dist(a: Point, b: Point): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/** Find the nearest waypoint to a given position. */
export function nearestWaypoint(pos: Point): string {
  let best = 'SQ';
  let bestDist = Infinity;
  for (const [id, wp] of Object.entries(WAYPOINTS)) {
    const d = dist(pos, wp);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

/** BFS shortest path between two waypoints. Returns list of waypoint IDs. */
function bfsPath(startId: string, endId: string): string[] {
  if (startId === endId) return [startId];

  const queue: string[][] = [[startId]];
  const visited = new Set<string>([startId]);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];

    for (const neighbor of ADJ[current] || []) {
      if (neighbor === endId) {
        return [...path, neighbor];
      }
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }

  // No path found — direct (shouldn't happen with connected graph)
  return [startId, endId];
}

/**
 * Compute a path of [x%, y%] points from `from` to `to`,
 * walking through waypoints to avoid the clocktower.
 *
 * Returns an array of points to animate through sequentially.
 */
export function findPath(from: Point, to: Point): Point[] {
  const startWp = nearestWaypoint(from);
  const endWp = nearestWaypoint(to);

  // If start and end are near the same waypoint, or very close, go direct
  if (startWp === endWp || dist(from, to) < 8) {
    return [from, to];
  }

  // Check if direct line crosses the tower
  const directCrosses = lineIntersectsTower(from, to);

  if (!directCrosses) {
    // Safe to walk direct
    return [from, to];
  }

  // Find path through waypoints
  const wpPath = bfsPath(startWp, endWp);
  const points: Point[] = [from];

  for (const wpId of wpPath) {
    points.push(WAYPOINTS[wpId]);
  }

  points.push(to);
  return points;
}

/** Check if a line segment crosses the clocktower zone. */
function lineIntersectsTower(a: Point, b: Point): boolean {
  // Sample 10 points along the line, check if any are inside the tower
  for (let t = 0.1; t <= 0.9; t += 0.1) {
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    if (isBehindTower(x, y)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Destination positions for game phases
// ---------------------------------------------------------------------------

/** Idle positions around the town square for up to 15 players.
 *  All on cobblestone paths, clear of buildings and tower. */
export const TOWN_POSITIONS: Point[] = [
  [22, 50],              // seat 0 - left path
  [25, 36],              // seat 1 - upper-left path
  [30, 26],              // seat 2 - far left of tower
  [50, 14],              // seat 3 - above tower
  [70, 26],              // seat 4 - far right of tower
  [75, 36],              // seat 5 - upper-right path
  [78, 50],              // seat 6 - right path
  [72, 66],              // seat 7 - lower-right path
  [62, 74],              // seat 8 - bottom-right
  [50, 78],              // seat 9 - bottom center
  [38, 74],              // seat 10 - bottom-left
  [28, 66],              // seat 11 - lower-left path
  [22, 58],              // seat 12 - mid-left
  [28, 55],              // seat 13 - inner left (clear of tower)
  [72, 55],              // seat 14 - inner right (clear of tower)
];

/** Breakout group gathering positions (near buildings). */
export const GROUP_DESTINATIONS: Point[] = [
  WAYPOINTS.BLDG_NW,    // Group A - left building
  WAYPOINTS.BLDG_NE,    // Group B - right building
  WAYPOINTS.BLDG_SW,    // Group C - bottom left
  WAYPOINTS.BLDG_SE,    // Group D - bottom right
];

/** Nomination/voting arc center and radius.
 *  Sprites form a semicircular arc in front of (below) the clocktower
 *  so none are occluded by the tower foreground layer. */
export const CIRCLE_CENTER: Point = [50, 68];
export const CIRCLE_RADIUS = 22; // in % units

/** Night positions — agents go to edges / "inside" buildings. */
export const NIGHT_POSITIONS: Point[] = [
  WAYPOINTS.BLDG_NW,
  WAYPOINTS.BLDG_W,
  WAYPOINTS.BLDG_NE,
  WAYPOINTS.BLDG_E,
  WAYPOINTS.BLDG_SW,
  WAYPOINTS.BLDG_SE,
  [15, 45],
  [85, 45],
  [15, 72],
  [85, 72],
  [25, 85],
  [75, 85],
  [35, 85],
  [65, 85],
  [50, 85],
];

export { WAYPOINTS };
