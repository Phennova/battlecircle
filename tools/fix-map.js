/**
 * Map Wall Generator & Validator
 *
 * Regenerates all building walls from bounding boxes and door positions.
 * Ensures walls connect properly with consistent doorway sizes.
 *
 * Usage: node tools/fix-map.js [--doorway-size 80] [--dry-run]
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(__dirname, '..', 'server', 'map.json');
const WALL_THICKNESS = 10;
const DEFAULT_DOORWAY = 80;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const doorwaySize = (() => {
  const idx = args.indexOf('--doorway-size');
  return idx !== -1 ? parseInt(args[idx + 1]) : DEFAULT_DOORWAY;
})();

const map = JSON.parse(readFileSync(MAP_PATH, 'utf-8'));

let issues = 0;
let fixes = 0;

console.log(`Map: ${map.width}x${map.height}, ${map.buildings.length} buildings`);
console.log(`Doorway size: ${doorwaySize}px, Wall thickness: ${WALL_THICKNESS}px`);
console.log('---');

for (const building of map.buildings) {
  const { id, x, y, w, h, doors, lootSlots } = building;
  const oldWallCount = building.walls.length;

  console.log(`\nBuilding ${id}: (${x},${y}) ${w}x${h}`);

  // Classify each door by which perimeter wall it's on
  const classifiedDoors = [];
  for (const door of doors) {
    const side = classifyDoor(door, x, y, w, h);
    if (!side) {
      console.log(`  WARNING: Door at (${door.x},${door.y}) doesn't match any perimeter wall`);
      issues++;
      // Try to find closest wall
      const closest = findClosestWall(door, x, y, w, h);
      if (closest) {
        console.log(`  -> Snapping to ${closest.side} wall`);
        classifiedDoors.push({ ...door, side: closest.side, pos: closest.pos });
        fixes++;
      }
    } else {
      classifiedDoors.push({ ...door, side: side.side, pos: side.pos });
    }
  }

  // Generate perimeter walls with door gaps
  const newWalls = [];

  // Top wall (horizontal): y = building.y
  const topDoors = classifiedDoors.filter(d => d.side === 'top');
  generateHorizontalWall(newWalls, x, y, w, topDoors, doorwaySize);

  // Bottom wall (horizontal): y = building.y + building.h - WALL_THICKNESS
  const bottomDoors = classifiedDoors.filter(d => d.side === 'bottom');
  generateHorizontalWall(newWalls, x, y + h - WALL_THICKNESS, w, bottomDoors, doorwaySize);

  // Left wall (vertical): x = building.x
  const leftDoors = classifiedDoors.filter(d => d.side === 'left');
  generateVerticalWall(newWalls, x, y, h, leftDoors, doorwaySize);

  // Right wall (vertical): x = building.x + building.w - WALL_THICKNESS
  const rightDoors = classifiedDoors.filter(d => d.side === 'right');
  generateVerticalWall(newWalls, x + w - WALL_THICKNESS, y, h, rightDoors, doorwaySize);

  // Preserve interior walls (walls that aren't on the perimeter)
  const interiorWalls = building.walls.filter(wall => {
    return !isPerimeterWall(wall, x, y, w, h);
  });
  newWalls.push(...interiorWalls);

  // Validate loot slots are inside building
  for (const slot of lootSlots) {
    if (slot.x < x + WALL_THICKNESS || slot.x > x + w - WALL_THICKNESS ||
        slot.y < y + WALL_THICKNESS || slot.y > y + h - WALL_THICKNESS) {
      console.log(`  WARNING: Loot slot at (${slot.x},${slot.y}) is outside building interior`);
      issues++;
    }
  }

  // Report changes
  const wallsChanged = JSON.stringify(building.walls) !== JSON.stringify(newWalls);
  if (wallsChanged) {
    console.log(`  Walls: ${oldWallCount} -> ${newWalls.length} (${wallsChanged ? 'FIXED' : 'OK'})`);
    fixes++;
  } else {
    console.log(`  Walls: ${oldWallCount} (OK)`);
  }

  // Log door positions
  for (const d of classifiedDoors) {
    console.log(`  Door: ${d.side} wall at pos ${d.pos}, gap ${doorwaySize}px`);
  }

  building.walls = newWalls;

  // Update door entries to match actual gap positions
  building.doors = classifiedDoors.map(d => ({
    x: d.x, y: d.y, w: doorwaySize, side: d.side
  }));
}

// Validate outer boundary walls
console.log('\n--- Boundary Walls ---');
const expectedBoundary = [
  { x: 0, y: 0, w: map.width, h: WALL_THICKNESS, label: 'top' },
  { x: 0, y: map.height - WALL_THICKNESS, w: map.width, h: WALL_THICKNESS, label: 'bottom' },
  { x: 0, y: 0, w: WALL_THICKNESS, h: map.height, label: 'left' },
  { x: map.width - WALL_THICKNESS, y: 0, w: WALL_THICKNESS, h: map.height, label: 'right' },
];

for (const expected of expectedBoundary) {
  const found = map.walls.find(w =>
    w.x === expected.x && w.y === expected.y &&
    w.w === expected.w && w.h === expected.h
  );
  if (found) {
    console.log(`  ${expected.label}: OK`);
  } else {
    console.log(`  ${expected.label}: MISSING or misaligned, fixing...`);
    // Remove any wall that's close to this position
    map.walls = map.walls.filter(w => {
      if (expected.label === 'top' && w.y === 0 && w.h <= WALL_THICKNESS && w.w > map.width / 2) return false;
      if (expected.label === 'bottom' && w.y >= map.height - WALL_THICKNESS - 2 && w.h <= WALL_THICKNESS && w.w > map.width / 2) return false;
      if (expected.label === 'left' && w.x === 0 && w.w <= WALL_THICKNESS && w.h > map.height / 2) return false;
      if (expected.label === 'right' && w.x >= map.width - WALL_THICKNESS - 2 && w.w <= WALL_THICKNESS && w.h > map.height / 2) return false;
      return true;
    });
    map.walls.push({ x: expected.x, y: expected.y, w: expected.w, h: expected.h });
    fixes++;
  }
}

// Validate spawn points are inside map and not inside walls
console.log('\n--- Spawn Points ---');
const allWalls = [...map.walls];
for (const b of map.buildings) allWalls.push(...b.walls);

for (let i = 0; i < map.spawnPoints.length; i++) {
  const sp = map.spawnPoints[i];
  if (sp.x < 20 || sp.x > map.width - 20 || sp.y < 20 || sp.y > map.height - 20) {
    console.log(`  Spawn ${i} at (${sp.x},${sp.y}): too close to edge`);
    issues++;
  }
  for (const wall of allWalls) {
    if (sp.x >= wall.x - 18 && sp.x <= wall.x + wall.w + 18 &&
        sp.y >= wall.y - 18 && sp.y <= wall.y + wall.h + 18) {
      // Check if actually overlapping (with player radius 18)
      if (sp.x >= wall.x && sp.x <= wall.x + wall.w &&
          sp.y >= wall.y && sp.y <= wall.y + wall.h) {
        console.log(`  Spawn ${i} at (${sp.x},${sp.y}): INSIDE a wall!`);
        issues++;
      }
    }
  }
}
console.log(`  ${map.spawnPoints.length} spawn points checked`);

// Summary
console.log('\n===========================');
console.log(`Issues found: ${issues}`);
console.log(`Fixes applied: ${fixes}`);

if (!dryRun && fixes > 0) {
  writeFileSync(MAP_PATH, JSON.stringify(map, null, 2) + '\n');
  console.log(`\nMap saved to ${MAP_PATH}`);
} else if (dryRun) {
  console.log('\n(Dry run — no changes written)');
} else {
  console.log('\nNo fixes needed.');
}


// ---- Helper functions ----

function classifyDoor(door, bx, by, bw, bh) {
  const tolerance = WALL_THICKNESS + 5;

  // Top wall
  if (Math.abs(door.y - by) < tolerance && door.x >= bx && door.x <= bx + bw) {
    return { side: 'top', pos: door.x };
  }
  // Bottom wall
  if (Math.abs(door.y - (by + bh - WALL_THICKNESS)) < tolerance && door.x >= bx && door.x <= bx + bw) {
    return { side: 'bottom', pos: door.x };
  }
  if (Math.abs(door.y - (by + bh)) < tolerance && door.x >= bx && door.x <= bx + bw) {
    return { side: 'bottom', pos: door.x };
  }
  // Left wall
  if (Math.abs(door.x - bx) < tolerance && door.y >= by && door.y <= by + bh) {
    return { side: 'left', pos: door.y };
  }
  // Right wall
  if (Math.abs(door.x - (bx + bw - WALL_THICKNESS)) < tolerance && door.y >= by && door.y <= by + bh) {
    return { side: 'right', pos: door.y };
  }
  if (Math.abs(door.x - (bx + bw)) < tolerance && door.y >= by && door.y <= by + bh) {
    return { side: 'right', pos: door.y };
  }

  return null;
}

function findClosestWall(door, bx, by, bw, bh) {
  const sides = [
    { side: 'top', dist: Math.abs(door.y - by), pos: door.x },
    { side: 'bottom', dist: Math.abs(door.y - (by + bh)), pos: door.x },
    { side: 'left', dist: Math.abs(door.x - bx), pos: door.y },
    { side: 'right', dist: Math.abs(door.x - (bx + bw)), pos: door.y },
  ];
  sides.sort((a, b) => a.dist - b.dist);
  return sides[0];
}

function isPerimeterWall(wall, bx, by, bw, bh) {
  const tolerance = 2;
  // Top
  if (Math.abs(wall.y - by) < tolerance && wall.x >= bx - tolerance && wall.x + wall.w <= bx + bw + tolerance && wall.h <= WALL_THICKNESS + tolerance) return true;
  // Bottom
  if (Math.abs(wall.y - (by + bh - WALL_THICKNESS)) < tolerance && wall.x >= bx - tolerance && wall.x + wall.w <= bx + bw + tolerance && wall.h <= WALL_THICKNESS + tolerance) return true;
  // Left
  if (Math.abs(wall.x - bx) < tolerance && wall.y >= by - tolerance && wall.y + wall.h <= by + bh + tolerance && wall.w <= WALL_THICKNESS + tolerance) return true;
  // Right
  if (Math.abs(wall.x - (bx + bw - WALL_THICKNESS)) < tolerance && wall.y >= by - tolerance && wall.y + wall.h <= by + bh + tolerance && wall.w <= WALL_THICKNESS + tolerance) return true;
  return false;
}

function generateHorizontalWall(walls, startX, wallY, totalWidth, doors, doorWidth) {
  if (doors.length === 0) {
    walls.push({ x: startX, y: wallY, w: totalWidth, h: WALL_THICKNESS });
    return;
  }

  // Sort doors by x position
  doors.sort((a, b) => a.pos - b.pos);

  // Center each door gap on its position
  let cursor = startX;
  for (const door of doors) {
    const gapStart = door.pos - doorWidth / 2;
    const gapEnd = door.pos + doorWidth / 2;

    // Clamp to building bounds
    const clampedStart = Math.max(gapStart, startX);
    const clampedEnd = Math.min(gapEnd, startX + totalWidth);

    // Wall segment before the gap
    if (clampedStart > cursor) {
      walls.push({ x: cursor, y: wallY, w: clampedStart - cursor, h: WALL_THICKNESS });
    }
    cursor = clampedEnd;
  }

  // Wall segment after the last gap
  if (cursor < startX + totalWidth) {
    walls.push({ x: cursor, y: wallY, w: startX + totalWidth - cursor, h: WALL_THICKNESS });
  }
}

function generateVerticalWall(walls, wallX, startY, totalHeight, doors, doorWidth) {
  if (doors.length === 0) {
    walls.push({ x: wallX, y: startY, w: WALL_THICKNESS, h: totalHeight });
    return;
  }

  doors.sort((a, b) => a.pos - b.pos);

  let cursor = startY;
  for (const door of doors) {
    const gapStart = door.pos - doorWidth / 2;
    const gapEnd = door.pos + doorWidth / 2;

    const clampedStart = Math.max(gapStart, startY);
    const clampedEnd = Math.min(gapEnd, startY + totalHeight);

    if (clampedStart > cursor) {
      walls.push({ x: wallX, y: cursor, w: WALL_THICKNESS, h: clampedStart - cursor });
    }
    cursor = clampedEnd;
  }

  if (cursor < startY + totalHeight) {
    walls.push({ x: wallX, y: cursor, w: WALL_THICKNESS, h: startY + totalHeight - cursor });
  }
}
