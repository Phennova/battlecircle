/**
 * Procedural map generator for BattleCircle.
 * Generates random building placements, interior walls, doors,
 * loot slots, spawn points, and standalone barricades.
 */

const MAP_WIDTH = 2400;
const MAP_HEIGHT = 2400;
const WALL_THICKNESS = 10;
const DOORWAY_SIZE = 100;
const MARGIN = 80; // min distance from map edge for buildings
const BUILDING_GAP = 60; // min gap between buildings
const PLAYER_RADIUS = 18;

// Building size ranges
const BUILDING_TEMPLATES = [
  { minW: 300, maxW: 500, minH: 250, maxH: 400, name: 'large' },
  { minW: 250, maxW: 380, minH: 200, maxH: 320, name: 'medium' },
  { minW: 200, maxW: 300, minH: 180, maxH: 280, name: 'small' },
];

const SIDES = ['top', 'bottom', 'left', 'right'];

export function generateMap() {
  const map = {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    tileSize: 40,
    spawnPoints: [],
    walls: [],
    buildings: []
  };

  // Boundary walls
  map.walls.push({ x: 0, y: 0, w: MAP_WIDTH, h: WALL_THICKNESS });
  map.walls.push({ x: 0, y: MAP_HEIGHT - WALL_THICKNESS, w: MAP_WIDTH, h: WALL_THICKNESS });
  map.walls.push({ x: 0, y: 0, w: WALL_THICKNESS, h: MAP_HEIGHT });
  map.walls.push({ x: MAP_WIDTH - WALL_THICKNESS, y: 0, w: WALL_THICKNESS, h: MAP_HEIGHT });

  // Generate 8-11 buildings
  const buildingCount = 8 + Math.floor(Math.random() * 4);
  const placedBuildings = [];

  for (let i = 0; i < buildingCount; i++) {
    const building = tryPlaceBuilding(placedBuildings, i);
    if (building) {
      placedBuildings.push(building);
      map.buildings.push(building);
    }
  }

  // Generate 6-10 standalone barricades
  const barrierCount = 6 + Math.floor(Math.random() * 5);
  for (let i = 0; i < barrierCount; i++) {
    const barrier = tryPlaceBarrier(placedBuildings);
    if (barrier) {
      map.walls.push(barrier);
    }
  }

  // Generate 16 spawn points around map edges
  map.spawnPoints = generateSpawnPoints();

  return map;
}

function tryPlaceBuilding(placed, index) {
  const template = BUILDING_TEMPLATES[index % BUILDING_TEMPLATES.length];

  for (let attempt = 0; attempt < 50; attempt++) {
    const w = randInt(template.minW, template.maxW);
    const h = randInt(template.minH, template.maxH);
    // Snap to grid
    const x = snapToGrid(randInt(MARGIN, MAP_WIDTH - MARGIN - w));
    const y = snapToGrid(randInt(MARGIN, MAP_HEIGHT - MARGIN - h));

    // Check overlap with existing buildings
    let overlaps = false;
    for (const other of placed) {
      if (rectsOverlap(x, y, w, h, other.x, other.y, other.w, other.h, BUILDING_GAP)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    // Build the building
    const building = createBuilding(index, x, y, w, h);
    return building;
  }
  return null;
}

function createBuilding(index, x, y, w, h) {
  const id = `b${index}`;
  const T = WALL_THICKNESS;

  // Pick 1-2 door sides (at least 1)
  const doorCount = Math.random() < 0.4 ? 2 : 1;
  const shuffledSides = shuffleArray([...SIDES]);
  const doorSides = shuffledSides.slice(0, doorCount);

  // Generate door positions
  const doors = [];
  for (const side of doorSides) {
    let doorPos;
    if (side === 'top' || side === 'bottom') {
      doorPos = { x: x + w / 2, y: side === 'top' ? y : y + h, w: DOORWAY_SIZE, side };
    } else {
      doorPos = { x: side === 'left' ? x : x + w, y: y + h / 2, w: DOORWAY_SIZE, side };
    }
    doors.push(doorPos);
  }

  // Generate perimeter walls with door gaps
  const walls = [];

  const topDoors = doors.filter(d => d.side === 'top');
  const bottomDoors = doors.filter(d => d.side === 'bottom');
  const leftDoors = doors.filter(d => d.side === 'left');
  const rightDoors = doors.filter(d => d.side === 'right');

  genHWall(walls, x, y, w, topDoors);
  genHWall(walls, x, y + h - T, w, bottomDoors);
  genVWall(walls, x, y, h, leftDoors);
  genVWall(walls, x + w - T, y, h, rightDoors);

  // Maybe add 1 interior wall (50% chance for medium+ buildings)
  if ((w > 280 || h > 280) && Math.random() < 0.5) {
    const innerLeft = x + T;
    const innerRight = x + w - T;
    const innerTop = y + T;
    const innerBottom = y + h - T;

    if (Math.random() < 0.5) {
      // Horizontal divider with centered gap
      const divY = y + Math.floor(h * (0.35 + Math.random() * 0.3));
      const gapCenter = x + w / 2;
      const gapLeft = gapCenter - DOORWAY_SIZE / 2;
      const gapRight = gapCenter + DOORWAY_SIZE / 2;
      if (gapLeft > innerLeft && gapRight < innerRight) {
        walls.push({ x: innerLeft, y: divY, w: gapLeft - innerLeft, h: T });
        walls.push({ x: gapRight, y: divY, w: innerRight - gapRight, h: T });
      }
    } else {
      // Vertical divider with centered gap
      const divX = x + Math.floor(w * (0.35 + Math.random() * 0.3));
      const gapCenter = y + h / 2;
      const gapTop = gapCenter - DOORWAY_SIZE / 2;
      const gapBottom = gapCenter + DOORWAY_SIZE / 2;
      if (gapTop > innerTop && gapBottom < innerBottom) {
        walls.push({ x: divX, y: innerTop, w: T, h: gapTop - innerTop });
        walls.push({ x: divX, y: gapBottom, w: T, h: innerBottom - gapBottom });
      }
    }
  }

  // Generate loot slots (3-5 per building, inside interior)
  const lootCount = 3 + Math.floor(Math.random() * 3);
  const lootSlots = [];
  const lootMargin = 40;
  for (let i = 0; i < lootCount; i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const lx = x + lootMargin + Math.random() * (w - lootMargin * 2);
      const ly = y + lootMargin + Math.random() * (h - lootMargin * 2);
      // Check not too close to other slots
      let tooClose = false;
      for (const other of lootSlots) {
        if (Math.sqrt((lx - other.x) ** 2 + (ly - other.y) ** 2) < 50) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) {
        lootSlots.push({ x: Math.round(lx), y: Math.round(ly) });
        break;
      }
    }
  }

  return { id, x, y, w, h, walls, doors, lootSlots };
}

function tryPlaceBarrier(buildings) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const isHorizontal = Math.random() < 0.5;
    let barrier;
    if (isHorizontal) {
      barrier = {
        x: snapToGrid(randInt(100, MAP_WIDTH - 300)),
        y: snapToGrid(randInt(100, MAP_HEIGHT - 100)),
        w: randInt(100, 200),
        h: WALL_THICKNESS
      };
    } else {
      barrier = {
        x: snapToGrid(randInt(100, MAP_WIDTH - 100)),
        y: snapToGrid(randInt(100, MAP_HEIGHT - 300)),
        w: WALL_THICKNESS,
        h: randInt(100, 200)
      };
    }

    // Check not overlapping buildings (with margin)
    let clips = false;
    for (const b of buildings) {
      if (rectsOverlap(barrier.x, barrier.y, barrier.w, barrier.h,
                       b.x, b.y, b.w, b.h, 40)) {
        clips = true;
        break;
      }
    }
    if (!clips) return barrier;
  }
  return null;
}

function generateSpawnPoints() {
  const points = [];
  const count = 16;
  const edgeMargin = 60;

  // Distribute evenly around perimeter
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const perimeter = 2 * (MAP_WIDTH + MAP_HEIGHT);
    const pos = t * perimeter;

    let x, y;
    if (pos < MAP_WIDTH) {
      x = pos;
      y = edgeMargin;
    } else if (pos < MAP_WIDTH + MAP_HEIGHT) {
      x = MAP_WIDTH - edgeMargin;
      y = pos - MAP_WIDTH;
    } else if (pos < 2 * MAP_WIDTH + MAP_HEIGHT) {
      x = MAP_WIDTH - (pos - MAP_WIDTH - MAP_HEIGHT);
      y = MAP_HEIGHT - edgeMargin;
    } else {
      x = edgeMargin;
      y = MAP_HEIGHT - (pos - 2 * MAP_WIDTH - MAP_HEIGHT);
    }

    // Clamp and add some jitter
    x = Math.max(edgeMargin, Math.min(MAP_WIDTH - edgeMargin, x + (Math.random() - 0.5) * 80));
    y = Math.max(edgeMargin, Math.min(MAP_HEIGHT - edgeMargin, y + (Math.random() - 0.5) * 80));

    points.push({ x: Math.round(x), y: Math.round(y) });
  }

  return points;
}

// Helpers
function genHWall(walls, sx, wy, totalW, doors) {
  if (doors.length === 0) {
    walls.push({ x: sx, y: wy, w: totalW, h: WALL_THICKNESS });
    return;
  }
  doors.sort((a, b) => a.x - b.x);
  let cursor = sx;
  for (const d of doors) {
    const gapStart = Math.max(d.x - DOORWAY_SIZE / 2, sx);
    const gapEnd = Math.min(d.x + DOORWAY_SIZE / 2, sx + totalW);
    if (gapStart > cursor) walls.push({ x: cursor, y: wy, w: gapStart - cursor, h: WALL_THICKNESS });
    cursor = gapEnd;
  }
  if (cursor < sx + totalW) walls.push({ x: cursor, y: wy, w: sx + totalW - cursor, h: WALL_THICKNESS });
}

function genVWall(walls, wx, sy, totalH, doors) {
  if (doors.length === 0) {
    walls.push({ x: wx, y: sy, w: WALL_THICKNESS, h: totalH });
    return;
  }
  doors.sort((a, b) => a.y - b.y);
  let cursor = sy;
  for (const d of doors) {
    const gapStart = Math.max(d.y - DOORWAY_SIZE / 2, sy);
    const gapEnd = Math.min(d.y + DOORWAY_SIZE / 2, sy + totalH);
    if (gapStart > cursor) walls.push({ x: wx, y: cursor, w: WALL_THICKNESS, h: gapStart - cursor });
    cursor = gapEnd;
  }
  if (cursor < sy + totalH) walls.push({ x: wx, y: cursor, w: WALL_THICKNESS, h: sy + totalH - cursor });
}

function rectsOverlap(x1, y1, w1, h1, x2, y2, w2, h2, gap = 0) {
  return x1 - gap < x2 + w2 && x1 + w1 + gap > x2 &&
         y1 - gap < y2 + h2 && y1 + h1 + gap > y2;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function snapToGrid(val) {
  return Math.round(val / 40) * 40;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
