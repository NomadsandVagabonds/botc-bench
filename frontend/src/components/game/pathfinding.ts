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
// Walkability grid — 100x100 collision mask from block.jpg
// Base64-encoded packed bits: 1 = blocked, 0 = walkable
// ---------------------------------------------------------------------------

const WALK_GRID_B64 = '///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////n///////////////8f////////+f/////h/////////4/////8H/////////h/////gf////////+D////8B/////////4H////wD//9//+///gf////gH//n//5//+D/////AP/8f//j//4f////8Af/h//+H//B/////wA/4AAAAH/4P/////AB/AAAAAP/B/////8AD4AAAAAfYD/////wADAAAAAA4AP/////AAAAAAAAAAA/////8AAAAAAAAAAD/////wAAAAAAAAAAP/////AAAAAAAAAAA/////8AAAAAAAAAAD/////wAAAAAAAAAAP////+AAAAAAAAAAA/////4AAAAAAAAAAD/////gAAAAAAAAAAP////+AAAAAAAAAAA/////4AAAAAAAAAAD/////gAAAAAAAAAAP////+AAAAAAAAAAA/////4AAAAAAAAAAD/////AAAAAAAAAAAP////4AAAAAAAAAAA/////AAAAAAAAAAAD////8AAAAH//4AAAP////gAAAAf//gAAA////8AAAAB//+AAAB////gAAAAH//4AAAB///8AAAAAf//gAAAD///gAAAAB//+AAAAD///AAAAAH//8AAAAH//+AAAAA///wAAAAH//8AAAAD///AAAAA///4AAAAP//8AAAAH///wAAAA///wAAAA////gAAAD///AAAAP////AAAAP//8AAAB////8AAAA///wAAAP////4AAAD///AAAA/////wAAAP//8AAAH/////AAAA///wAAA/////+AAAD///AAAH/////4AAAP//8AAAf/////wAAA///4AAD//////AAAD///4AAf/////8AAAf///AAA//////wAAA///4AAD//////AAAB///AAAP/////8AAAD//4AAA//////wAAAD//AAAD//////AAAAH/4AAAP/////8AAAAP/AAAA//////wAAAAf4AAAD//////AAAAAfAAAAP/////8AAAAA4AAAA//////gAAAABAAAAD/////+AAgAAAAAAAP/////4ADAAAAAAAAf/////gAOAAAAABgB/////+AB8AAAAAOAH/////4AH4AAAAB4Af/////gAfwAAAAPwB/////+AD/gAAAB/AH/////4AP/AAAAP8Af/////AB/+AAAB/4B/////4AH/8AAAP/gH/////AAf/4AAB/+AP////4AD//4AAP/8Af////AAP//wAB//wA////4AA///gAP//AA///7AAH//+AB//+AB/+/AAAP//8AP//4AD/D4AAA///wB///gAH4PAAAD///gH//8AADg4AAAP//+A///4AAEA=';

// ---------------------------------------------------------------------------
// Spawn entry points — alleyways between buildings where sprites walk in from
// ---------------------------------------------------------------------------

/** Off-screen spawn points at the edges of walkable alleys.
 *  Sprites start here and walk along the ring to their idle positions. */
export const ENTRY_POINTS: Point[] = [
  [16, 25],   // upper-left alley
  [83, 25],   // upper-right alley
  [11, 50],   // left alley
  [81, 50],   // right alley
  [17, 80],   // lower-left alley
  [79, 75],   // lower-right alley
  [45, 95],   // bottom-left
  [55, 96],   // bottom-right
];

const WALK_GRID_SIZE = 100;
let _walkGrid: Uint8Array | null = null;

function getWalkGrid(): Uint8Array {
  if (_walkGrid) return _walkGrid;
  const binary = atob(WALK_GRID_B64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // Unpack bits into a flat 100x100 array (1 = blocked)
  _walkGrid = new Uint8Array(WALK_GRID_SIZE * WALK_GRID_SIZE);
  for (let i = 0; i < WALK_GRID_SIZE * WALK_GRID_SIZE; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = 7 - (i % 8);
    _walkGrid[i] = (bytes[byteIdx] >> bitIdx) & 1;
  }
  return _walkGrid;
}

/** Check if a position (in %) is walkable according to the collision grid. */
export function isWalkable(x: number, y: number): boolean {
  const grid = getWalkGrid();
  const gx = Math.min(WALK_GRID_SIZE - 1, Math.max(0, Math.floor(x)));
  const gy = Math.min(WALK_GRID_SIZE - 1, Math.max(0, Math.floor(y)));
  return grid[gy * WALK_GRID_SIZE + gx] === 0;
}

/** Check if a straight line between two points stays on walkable terrain. */
function lineIsWalkable(a: Point, b: Point): boolean {
  const steps = Math.max(Math.ceil(dist(a, b)), 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isWalkable(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) {
      return false;
    }
  }
  return true;
}

/** Clamp a position to the nearest walkable cell, interpolating toward fallback. */
export function clampToWalkable(pos: Point, fallback: Point): Point {
  if (isWalkable(pos[0], pos[1])) return pos;
  for (let t = 0.1; t <= 1.0; t += 0.1) {
    const x = pos[0] + (fallback[0] - pos[0]) * t;
    const y = pos[1] + (fallback[1] - pos[1]) * t;
    if (isWalkable(x, y)) return [x, y];
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Waypoint graph — nodes around the town square
// ---------------------------------------------------------------------------

// Core ring waypoints around the clocktower (agents walk this ring)
// The upper ring splits into left alley (NW→NW_UP) and right alley (NE_UP→NE)
// because the direct NW→NE path crosses rooftops above the tower.
const WAYPOINTS: Record<string, Point> = {
  // Full ring around the tower (sprites walk behind the upper tower)
  NW:      [30, 32],
  N:       [50, 32],    // behind the tower — occluded by clocktower.png
  NE:      [72, 32],
  E:       [80, 50],
  SE:      [70, 68],
  S_RIGHT: [65, 78],    // right of tower base
  S:       [50, 82],    // below tower base
  S_LEFT:  [35, 78],    // left of tower base
  SW:      [30, 68],
  W:       [20, 50],

  // Alley entry points (off the ring, into building gaps)
  NW_UP:   [20, 27],
  NE_UP:   [78, 29],

  // Building / group destinations (off the ring)
  BLDG_NW: [16, 38],
  BLDG_W:  [12, 58],
  BLDG_NE: [81, 38],
  BLDG_E:  [88, 58],
  BLDG_SW: [18, 82],
  BLDG_SE: [80, 82],
};

// Adjacency — which waypoints connect to which
const EDGES: [string, string][] = [
  // Full ring — sprites walk behind the upper tower and around the base
  ['NW', 'N'],  ['N', 'NE'],  // behind the tower (occluded by clocktower.png z-100)
  ['NE', 'E'],  ['E', 'SE'],
  ['SE', 'S_RIGHT'], ['S_RIGHT', 'S'], ['S', 'S_LEFT'], ['S_LEFT', 'SW'],
  ['SW', 'W'],  ['W', 'NW'],
  // Upper alley entries
  ['NW', 'NW_UP'],
  ['NE', 'NE_UP'],
  // Building connections
  ['NW', 'BLDG_NW'], ['W', 'BLDG_NW'],
  ['W', 'BLDG_W'],   ['SW', 'BLDG_W'],
  ['NE', 'BLDG_NE'], ['E', 'BLDG_NE'],
  ['E', 'BLDG_E'],   ['SE', 'BLDG_E'],
  ['SW', 'BLDG_SW'], ['S_LEFT', 'BLDG_SW'],
  ['SE', 'BLDG_SE'], ['S_RIGHT', 'BLDG_SE'],
  ['S', 'BLDG_SW'],  ['S', 'BLDG_SE'],
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
// Measured from clocktower.png opaque alpha regions
const TOWER_SLICES: [number, number, number, number][] = [
  [ 0, 10, 46, 54],   // spire tip — very narrow
  [10, 20, 41, 59],   // bell/peak
  [20, 35, 41, 59],   // upper tower + clock face
  [35, 50, 40, 60],   // mid tower
  [50, 60, 40, 60],   // lower tower / base
  [60, 68, 40, 58],   // tower foundation
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
  // y-based sorting: 10-99 range (must be above tower fg at z-5)
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
export function findPath(from: Point, to: Point, forceWaypoints = false): Point[] {
  const startWp = nearestWaypoint(from);
  const endWp = nearestWaypoint(to);

  // If start is off-grid (spawn entry point), always route through waypoints
  const startOffGrid = !isWalkable(from[0], from[1]);

  if (!forceWaypoints && !startOffGrid) {
    // If start and end are near the same waypoint, or very close, go direct
    if (startWp === endWp || dist(from, to) < 8) {
      return [from, to];
    }

    // Check if direct line stays on walkable terrain
    if (lineIsWalkable(from, to)) {
      return [from, to];
    }
  }

  // eslint-disable-next-line no-console
  console.log('[findPath]', { from, to, forceWaypoints, startOffGrid, startWp, endWp });

  // Route through waypoints
  const wpPath = bfsPath(startWp, endWp);

  // Build full path: from → waypoints → to
  // Validate each segment stays on walkable terrain
  const allPoints: Point[] = [];
  for (const wpId of wpPath) {
    allPoints.push(WAYPOINTS[wpId]);
  }

  const points: Point[] = [from];

  // First leg: from → first waypoint. If blocked, step through start waypoint first.
  if (allPoints.length > 0 && !lineIsWalkable(from, allPoints[0])) {
    // Insert the nearest waypoint to 'from' as a stepping stone
    const stepWp = WAYPOINTS[startWp];
    if (stepWp[0] !== allPoints[0][0] || stepWp[1] !== allPoints[0][1]) {
      points.push(stepWp);
    }
  }

  // Middle: all BFS waypoints
  for (const wp of allPoints) {
    points.push(wp);
  }

  // Last leg: last waypoint → to. If blocked, step through end waypoint.
  const lastWp = allPoints.length > 0 ? allPoints[allPoints.length - 1] : from;
  if (!lineIsWalkable(lastWp, to)) {
    const stepWp = WAYPOINTS[endWp];
    if (stepWp[0] !== lastWp[0] || stepWp[1] !== lastWp[1]) {
      points.push(stepWp);
    }
  }

  points.push(to);
  return points;
}

// ---------------------------------------------------------------------------
// Destination positions for game phases
// ---------------------------------------------------------------------------

/** Idle positions around the town square for up to 15 players.
 *  All on cobblestone paths, clear of buildings and tower. */
export const TOWN_POSITIONS: Point[] = [
  [22, 50],              // seat 0 - left path
  [25, 36],              // seat 1 - upper-left path
  [38, 32],              // seat 2 - behind tower left
  [50, 32],              // seat 3 - behind tower center
  [62, 32],              // seat 4 - behind tower right
  [75, 36],              // seat 5 - upper-right path
  [78, 50],              // seat 6 - right path
  [72, 66],              // seat 7 - lower-right path
  [62, 74],              // seat 8 - bottom-right
  [50, 82],              // seat 9 - bottom center (below tower base)
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
export const CIRCLE_CENTER: Point = [50, 84];
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
  [81, 45],
  [18, 72],
  [79, 72],
  [25, 85],
  [75, 85],
  [35, 85],
  [65, 85],
  [50, 85],
];

export { WAYPOINTS };
