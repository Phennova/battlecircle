/**
 * Navigation Grid with A* Pathfinding
 *
 * Overlays a grid on the map. Each cell is walkable or blocked.
 * Supports dynamic rebuilding when walls are destroyed or doors change.
 * In BR mode, red zone cells can be marked impassable.
 */

const CELL_SIZE = 40;

export class NavGrid {
  constructor(mapWidth, mapHeight) {
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.cols = Math.ceil(mapWidth / CELL_SIZE);
    this.rows = Math.ceil(mapHeight / CELL_SIZE);
    this.grid = new Uint8Array(this.cols * this.rows); // 0 = walkable, 1 = blocked, 2 = danger zone
  }

  /**
   * Build the grid from wall data. Call on room creation and when walls change.
   */
  buildFromWalls(walls) {
    this.grid.fill(0);
    const margin = 8; // smaller than player radius to avoid blocking spawn points

    for (const wall of walls) {
      const minCol = Math.max(0, Math.floor((wall.x - margin) / CELL_SIZE));
      const maxCol = Math.min(this.cols - 1, Math.floor((wall.x + wall.w + margin) / CELL_SIZE));
      const minRow = Math.max(0, Math.floor((wall.y - margin) / CELL_SIZE));
      const maxRow = Math.min(this.rows - 1, Math.floor((wall.y + wall.h + margin) / CELL_SIZE));

      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
          this.grid[r * this.cols + c] = 1;
        }
      }
    }
  }

  /**
   * Mark cells outside the zone radius as impassable (for BR mode).
   */
  markZone(centerX, centerY, radius) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        if (this.grid[idx] === 1) continue; // already blocked by wall

        const cx = (c + 0.5) * CELL_SIZE;
        const cy = (r + 0.5) * CELL_SIZE;
        const dx = cx - centerX;
        const dy = cy - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        this.grid[idx] = dist > radius ? 2 : 0;
      }
    }
  }

  /**
   * Clear all zone markings (set danger cells back to walkable).
   */
  clearZoneMarking() {
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === 2) this.grid[i] = 0;
    }
  }

  /**
   * Add cost to cells near a danger point (death location avoidance).
   * Returns a cleanup function to remove the cost later.
   */
  addDangerZone(worldX, worldY, radius) {
    const cells = [];
    const minCol = Math.max(0, Math.floor((worldX - radius) / CELL_SIZE));
    const maxCol = Math.min(this.cols - 1, Math.floor((worldX + radius) / CELL_SIZE));
    const minRow = Math.max(0, Math.floor((worldY - radius) / CELL_SIZE));
    const maxRow = Math.min(this.rows - 1, Math.floor((worldY + radius) / CELL_SIZE));

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        cells.push({ r, c });
      }
    }
    return cells; // store these for A* cost adjustment
  }

  /**
   * Convert world position to grid cell.
   */
  worldToCell(x, y) {
    return {
      c: Math.floor(x / CELL_SIZE),
      r: Math.floor(y / CELL_SIZE)
    };
  }

  /**
   * Convert grid cell to world position (center of cell).
   */
  cellToWorld(c, r) {
    return {
      x: (c + 0.5) * CELL_SIZE,
      y: (r + 0.5) * CELL_SIZE
    };
  }

  /**
   * Check if a cell is walkable.
   */
  isWalkable(c, r) {
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return false;
    return this.grid[r * this.cols + c] === 0;
  }

  /**
   * A* pathfinding from world coordinates to world coordinates.
   * Returns array of {x, y} world positions, or empty array if no path.
   */
  findPath(fromX, fromY, toX, toY, dangerCells) {
    const start = this.worldToCell(fromX, fromY);
    const end = this.worldToCell(toX, toY);

    // Clamp to grid
    start.c = Math.max(0, Math.min(this.cols - 1, start.c));
    start.r = Math.max(0, Math.min(this.rows - 1, start.r));
    end.c = Math.max(0, Math.min(this.cols - 1, end.c));
    end.r = Math.max(0, Math.min(this.rows - 1, end.r));

    // If end is blocked, find nearest walkable cell
    if (!this.isWalkable(end.c, end.r)) {
      const nearest = this._findNearestWalkable(end.c, end.r);
      if (!nearest) return [];
      end.c = nearest.c;
      end.r = nearest.r;
    }

    // If start is blocked, find nearest walkable cell
    if (!this.isWalkable(start.c, start.r)) {
      const nearest = this._findNearestWalkable(start.c, start.r);
      if (!nearest) return [];
      start.c = nearest.c;
      start.r = nearest.r;
    }

    // Build danger cost set
    const dangerSet = new Set();
    if (dangerCells) {
      for (const dc of dangerCells) {
        dangerSet.add(dc.r * this.cols + dc.c);
      }
    }

    // A* implementation
    const startKey = start.r * this.cols + start.c;
    const endKey = end.r * this.cols + end.c;

    if (startKey === endKey) return [this.cellToWorld(end.c, end.r)];

    const openSet = new MinHeap();
    const gScore = new Map();
    const fScore = new Map();
    const cameFrom = new Map();

    gScore.set(startKey, 0);
    fScore.set(startKey, this._heuristic(start.c, start.r, end.c, end.r));
    openSet.push(startKey, fScore.get(startKey));

    const neighbors = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, -1], [-1, 1], [1, -1], [1, 1]
    ];
    const diagCost = 1.414;

    let iterations = 0;
    const maxIterations = 2000;

    while (openSet.size > 0 && iterations < maxIterations) {
      iterations++;
      const currentKey = openSet.pop();

      if (currentKey === endKey) {
        // Reconstruct path
        const path = [];
        let key = endKey;
        while (key !== undefined && key !== startKey) {
          const r = Math.floor(key / this.cols);
          const c = key % this.cols;
          path.unshift(this.cellToWorld(c, r));
          key = cameFrom.get(key);
        }
        return path;
      }

      const cr = Math.floor(currentKey / this.cols);
      const cc = currentKey % this.cols;

      for (const [dc, dr] of neighbors) {
        const nc = cc + dc;
        const nr = cr + dr;

        if (!this.isWalkable(nc, nr)) continue;

        // For diagonal movement, check that both adjacent cells are walkable
        if (dc !== 0 && dr !== 0) {
          if (!this.isWalkable(cc + dc, cr) || !this.isWalkable(cc, cr + dr)) continue;
        }

        const nKey = nr * this.cols + nc;
        const moveCost = (dc !== 0 && dr !== 0) ? diagCost : 1;
        const dangerCost = dangerSet.has(nKey) ? 10 : 0; // danger zones are expensive
        const tentG = (gScore.get(currentKey) || 0) + moveCost + dangerCost;

        if (tentG < (gScore.get(nKey) || Infinity)) {
          cameFrom.set(nKey, currentKey);
          gScore.set(nKey, tentG);
          const f = tentG + this._heuristic(nc, nr, end.c, end.r);
          fScore.set(nKey, f);
          openSet.push(nKey, f);
        }
      }
    }

    return []; // no path found
  }

  /**
   * Find nearest cover position relative to a threat.
   * Returns world position behind a wall that blocks line of sight from threat.
   */
  findCover(botX, botY, threatX, threatY, walls, maxDist) {
    maxDist = maxDist || 200;
    let bestPos = null;
    let bestDist = Infinity;

    // Sample positions near walls
    for (const wall of walls) {
      const positions = [
        { x: wall.x - 20, y: wall.y + wall.h / 2 },
        { x: wall.x + wall.w + 20, y: wall.y + wall.h / 2 },
        { x: wall.x + wall.w / 2, y: wall.y - 20 },
        { x: wall.x + wall.w / 2, y: wall.y + wall.h + 20 }
      ];

      for (const pos of positions) {
        const distFromBot = Math.sqrt((pos.x - botX) ** 2 + (pos.y - botY) ** 2);
        if (distFromBot > maxDist) continue;

        // Check if this position blocks LOS from threat
        if (this._wallBlocksLOS(pos.x, pos.y, threatX, threatY, wall)) {
          // Check if position is walkable
          const cell = this.worldToCell(pos.x, pos.y);
          if (this.isWalkable(cell.c, cell.r) && distFromBot < bestDist) {
            bestDist = distFromBot;
            bestPos = pos;
          }
        }
      }
    }

    return bestPos;
  }

  _wallBlocksLOS(posX, posY, threatX, threatY, wall) {
    // Simple check: does the wall rect intersect the line from pos to threat?
    const dx = threatX - posX;
    const dy = threatY - posY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(dist / 10);

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = posX + dx * t;
      const py = posY + dy * t;
      if (px >= wall.x && px <= wall.x + wall.w &&
          py >= wall.y && py <= wall.y + wall.h) {
        return true;
      }
    }
    return false;
  }

  _findNearestWalkable(c, r) {
    for (let radius = 1; radius < 10; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
          if (this.isWalkable(c + dc, r + dr)) {
            return { c: c + dc, r: r + dr };
          }
        }
      }
    }
    return null;
  }

  _heuristic(c1, r1, c2, r2) {
    // Octile distance
    const dx = Math.abs(c1 - c2);
    const dy = Math.abs(r1 - r2);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  }
}

/**
 * Simple binary min-heap for A* open set.
 */
class MinHeap {
  constructor() {
    this.data = [];
  }

  get size() { return this.data.length; }

  push(key, priority) {
    this.data.push({ key, priority });
    this._bubbleUp(this.data.length - 1);
  }

  pop() {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top.key;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.data[i].priority < this.data[parent].priority) {
        [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
        i = parent;
      } else break;
    }
  }

  _sinkDown(i) {
    const len = this.data.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < len && this.data[left].priority < this.data[smallest].priority) smallest = left;
      if (right < len && this.data[right].priority < this.data[smallest].priority) smallest = right;
      if (smallest !== i) {
        [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
        i = smallest;
      } else break;
    }
  }
}
