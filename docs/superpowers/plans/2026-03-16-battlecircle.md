# BattleCircle Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web-based top-down 2D multiplayer battle royale with fog-of-war shadow casting.

**Architecture:** Server-authoritative Node.js + Socket.IO backend runs physics at 20 ticks/sec. Vanilla JS ES module client renders via HTML5 Canvas at 60fps with client-side prediction for local player. Shadow casting via 2D visibility polygon algorithm is the core visual feature.

**Tech Stack:** Node.js, Express, Socket.IO, HTML5 Canvas, Vanilla JS ES Modules, nodemon

**Spec:** `docs/superpowers/specs/2026-03-16-battlecircle-design.md`

---

## Chunk 1: Scaffold, Map & Solo Player with Shadows (Phases 1-3)

After this chunk: a single player can move around the map with full fog-of-war shadow casting. No server needed yet — purely client-side.

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `server/index.js`
- Create: `public/index.html`
- Create: `public/main.js`

- [ ] **Step 1: Initialize npm project**

```bash
cd /Users/soren/Desktop/Battleroyale
npm init -y
npm install express socket.io
npm install --save-dev nodemon
```

Then edit `package.json` scripts:
```json
"scripts": {
  "start": "node server/index.js",
  "dev": "npx nodemon server/index.js"
}
```

- [ ] **Step 2: Create Express + Socket.IO server**

Create `server/index.js`:
```js
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(join(__dirname, '..', 'public')));

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`BattleCircle server running on http://localhost:${PORT}`);
});
```

Add `"type": "module"` to `package.json` for ES module support.

- [ ] **Step 3: Create HTML shell**

Create `public/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BattleCircle</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; overflow: hidden; }
    canvas#game {
      display: block;
      width: 100vw;
      height: 100vh;
    }
    #lobby {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.85);
      color: #fff;
      font-family: sans-serif;
      z-index: 10;
    }
    #lobby h1 { font-size: 48px; margin-bottom: 20px; }
    #lobby .status { color: #888; margin-bottom: 20px; }
    #lobby button {
      padding: 12px 32px;
      font-size: 18px;
      background: #4a9eff;
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
    }
    #lobby button:hover { background: #3a8eef; }
    #lobby button:disabled { background: #555; cursor: not-allowed; }
    #overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.7);
      color: #fff;
      font-family: sans-serif;
      z-index: 10;
    }
  </style>
</head>
<body>
  <canvas id="game"></canvas>
  <div id="lobby">
    <h1>BattleCircle</h1>
    <div class="status">Connecting...</div>
    <button id="startBtn" disabled>Start Game</button>
  </div>
  <div id="overlay"></div>
  <script type="module" src="main.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create client entry point**

Create `public/main.js`:
```js
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Temporary: fill with dark background to confirm it works
ctx.fillStyle = '#1a1a2e';
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.fillStyle = '#fff';
ctx.font = '24px sans-serif';
ctx.textAlign = 'center';
ctx.fillText('BattleCircle - Canvas Ready', canvas.width / 2, canvas.height / 2);
```

- [ ] **Step 5: Verify and commit**

```bash
npm run dev
# Open http://localhost:3000 — should see dark canvas with "BattleCircle - Canvas Ready" text
# Lobby overlay visible on top
```

```bash
git add package.json package-lock.json server/index.js public/index.html public/main.js
git commit -m "feat: scaffold project with Express, Socket.IO, and canvas shell"
```

---

### Task 2: Map Data & Renderer

**Files:**
- Create: `server/map.json`
- Create: `public/Renderer.js`
- Modify: `public/main.js`

- [ ] **Step 1: Create map.json**

Create `server/map.json` with 8 buildings, 16 spawn points, standalone cover walls, and outer boundary. Full map data (this is a large JSON file — all coordinates hand-crafted per the spec's 2400x2400 world):

```json
{
  "width": 2400,
  "height": 2400,
  "tileSize": 40,
  "spawnPoints": [
    {"x": 120, "y": 120},
    {"x": 600, "y": 40},
    {"x": 1200, "y": 40},
    {"x": 1800, "y": 40},
    {"x": 2280, "y": 120},
    {"x": 2360, "y": 600},
    {"x": 2360, "y": 1200},
    {"x": 2360, "y": 1800},
    {"x": 2280, "y": 2280},
    {"x": 1800, "y": 2360},
    {"x": 1200, "y": 2360},
    {"x": 600, "y": 2360},
    {"x": 120, "y": 2280},
    {"x": 40, "y": 1800},
    {"x": 40, "y": 1200},
    {"x": 40, "y": 600}
  ],
  "walls": [
    {"x": 0, "y": 0, "w": 2400, "h": 10},
    {"x": 0, "y": 2390, "w": 2400, "h": 10},
    {"x": 0, "y": 0, "w": 10, "h": 2400},
    {"x": 2390, "y": 0, "w": 10, "h": 2400},

    {"x": 780, "y": 500, "w": 120, "h": 10},
    {"x": 1500, "y": 900, "w": 10, "h": 100},
    {"x": 600, "y": 1400, "w": 100, "h": 10},
    {"x": 1800, "y": 1600, "w": 10, "h": 120},
    {"x": 1000, "y": 1900, "w": 140, "h": 10},
    {"x": 400, "y": 1000, "w": 10, "h": 80}
  ],
  "buildings": [
    {
      "id": "b1",
      "x": 160, "y": 200, "w": 280, "h": 200,
      "walls": [
        {"x": 160, "y": 200, "w": 280, "h": 10},
        {"x": 160, "y": 390, "w": 280, "h": 10},
        {"x": 160, "y": 200, "w": 10, "h": 200},
        {"x": 430, "y": 200, "w": 10, "h": 200},
        {"x": 300, "y": 200, "w": 10, "h": 100}
      ],
      "doors": [
        {"x": 250, "y": 390, "w": 50}
      ],
      "lootSlots": [
        {"x": 220, "y": 300},
        {"x": 380, "y": 300}
      ]
    },
    {
      "id": "b2",
      "x": 1200, "y": 80, "w": 360, "h": 240,
      "walls": [
        {"x": 1200, "y": 80, "w": 360, "h": 10},
        {"x": 1200, "y": 310, "w": 360, "h": 10},
        {"x": 1200, "y": 80, "w": 10, "h": 240},
        {"x": 1550, "y": 80, "w": 10, "h": 240},
        {"x": 1200, "y": 200, "w": 160, "h": 10},
        {"x": 1400, "y": 200, "w": 160, "h": 10}
      ],
      "doors": [
        {"x": 1360, "y": 200, "w": 40},
        {"x": 1350, "y": 310, "w": 60}
      ],
      "lootSlots": [
        {"x": 1280, "y": 140},
        {"x": 1480, "y": 140},
        {"x": 1380, "y": 260}
      ]
    },
    {
      "id": "b3",
      "x": 320, "y": 800, "w": 200, "h": 280,
      "walls": [
        {"x": 320, "y": 800, "w": 200, "h": 10},
        {"x": 320, "y": 1070, "w": 200, "h": 10},
        {"x": 320, "y": 800, "w": 10, "h": 280},
        {"x": 510, "y": 800, "w": 10, "h": 280}
      ],
      "doors": [
        {"x": 510, "y": 900, "w": 50}
      ],
      "lootSlots": [
        {"x": 420, "y": 900}
      ]
    },
    {
      "id": "b4_military",
      "x": 960, "y": 880, "w": 320, "h": 280,
      "walls": [
        {"x": 960, "y": 880, "w": 320, "h": 10},
        {"x": 960, "y": 1150, "w": 320, "h": 10},
        {"x": 960, "y": 880, "w": 10, "h": 280},
        {"x": 1270, "y": 880, "w": 10, "h": 280},
        {"x": 1100, "y": 880, "w": 10, "h": 140},
        {"x": 1100, "y": 1060, "w": 10, "h": 100}
      ],
      "doors": [
        {"x": 1100, "y": 1020, "w": 40},
        {"x": 1050, "y": 1150, "w": 60}
      ],
      "lootSlots": [
        {"x": 1020, "y": 960},
        {"x": 1180, "y": 960},
        {"x": 1180, "y": 1100}
      ]
    },
    {
      "id": "b5",
      "x": 1700, "y": 640, "w": 240, "h": 200,
      "walls": [
        {"x": 1700, "y": 640, "w": 240, "h": 10},
        {"x": 1700, "y": 830, "w": 240, "h": 10},
        {"x": 1700, "y": 640, "w": 10, "h": 200},
        {"x": 1930, "y": 640, "w": 10, "h": 200}
      ],
      "doors": [
        {"x": 1700, "y": 720, "w": 50}
      ],
      "lootSlots": [
        {"x": 1780, "y": 720},
        {"x": 1860, "y": 720}
      ]
    },
    {
      "id": "b6",
      "x": 160, "y": 1600, "w": 300, "h": 240,
      "walls": [
        {"x": 160, "y": 1600, "w": 300, "h": 10},
        {"x": 160, "y": 1830, "w": 300, "h": 10},
        {"x": 160, "y": 1600, "w": 10, "h": 240},
        {"x": 450, "y": 1600, "w": 10, "h": 240},
        {"x": 310, "y": 1600, "w": 10, "h": 120}
      ],
      "doors": [
        {"x": 300, "y": 1830, "w": 50}
      ],
      "lootSlots": [
        {"x": 240, "y": 1700},
        {"x": 400, "y": 1700}
      ]
    },
    {
      "id": "b7",
      "x": 1400, "y": 1500, "w": 400, "h": 280,
      "walls": [
        {"x": 1400, "y": 1500, "w": 400, "h": 10},
        {"x": 1400, "y": 1770, "w": 400, "h": 10},
        {"x": 1400, "y": 1500, "w": 10, "h": 280},
        {"x": 1790, "y": 1500, "w": 10, "h": 280},
        {"x": 1580, "y": 1500, "w": 10, "h": 140}
      ],
      "doors": [
        {"x": 1580, "y": 1640, "w": 40},
        {"x": 1500, "y": 1770, "w": 60}
      ],
      "lootSlots": [
        {"x": 1480, "y": 1600},
        {"x": 1680, "y": 1600}
      ]
    },
    {
      "id": "b8",
      "x": 800, "y": 1800, "w": 200, "h": 200,
      "walls": [
        {"x": 800, "y": 1800, "w": 200, "h": 10},
        {"x": 800, "y": 1990, "w": 200, "h": 10},
        {"x": 800, "y": 1800, "w": 10, "h": 200},
        {"x": 990, "y": 1800, "w": 10, "h": 200}
      ],
      "doors": [
        {"x": 870, "y": 1800, "w": 50}
      ],
      "lootSlots": [
        {"x": 900, "y": 1900}
      ]
    }
  ]
}
```

- [ ] **Step 2: Serve map.json via API endpoint**

Add to `server/index.js` before the Socket.IO block:
```js
import { readFileSync } from 'fs';

const mapData = JSON.parse(readFileSync(join(__dirname, 'map.json'), 'utf-8'));

app.get('/api/map', (req, res) => {
  res.json(mapData);
});
```

- [ ] **Step 3: Create Renderer.js**

Create `public/Renderer.js`:
```js
export class Renderer {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.map = null;
    this.allWalls = []; // flattened list of all wall rects for collision/shadow
  }

  setMap(map) {
    this.map = map;
    // Flatten all walls: outer walls + building walls
    this.allWalls = [...map.walls];
    for (const b of map.buildings) {
      this.allWalls.push(...b.walls);
    }
  }

  draw(cameraX, cameraY) {
    const { ctx, canvas, map } = this;
    if (!map) return;

    ctx.save();
    // Camera transform: center on player
    const offsetX = canvas.width / 2 - cameraX;
    const offsetY = canvas.height / 2 - cameraY;
    ctx.translate(offsetX, offsetY);

    // Floor
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, map.width, map.height);

    // Building floors (lighter)
    ctx.fillStyle = '#252540';
    for (const b of map.buildings) {
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }

    // Walls
    ctx.fillStyle = '#555';
    for (const w of this.allWalls) {
      ctx.fillRect(w.x, w.y, w.w, w.h);
    }

    // Loot slot markers (debug — small dots)
    ctx.fillStyle = 'rgba(255, 200, 50, 0.3)';
    for (const b of map.buildings) {
      for (const slot of b.lootSlots) {
        ctx.beginPath();
        ctx.arc(slot.x, slot.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Spawn point markers (debug — small green dots)
    ctx.fillStyle = 'rgba(80, 200, 120, 0.3)';
    for (const sp of map.spawnPoints) {
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
```

- [ ] **Step 4: Update main.js to fetch map and render**

Replace `public/main.js`:
```js
import { Renderer } from './Renderer.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

const renderer = new Renderer(canvas, ctx);

// Hide lobby for now to see the map
document.getElementById('lobby').style.display = 'none';

// Fetch map and start rendering
const res = await fetch('/api/map');
const map = await res.json();
renderer.setMap(map);

// Temporary: render centered on map middle
function loop() {
  renderer.draw(map.width / 2, map.height / 2);
  requestAnimationFrame(loop);
}
loop();
```

- [ ] **Step 5: Verify and commit**

```bash
# Refresh browser — should see the full map with buildings, walls, loot/spawn markers
# Pan isn't implemented yet but the map should be visible centered on (1200, 1200)
```

```bash
git add server/map.json public/Renderer.js public/main.js server/index.js
git commit -m "feat: add map data and renderer with buildings, walls, and markers"
```

---

### Task 3: Local Player Movement & Collision

**Files:**
- Create: `public/InputHandler.js`
- Create: `shared/constants.js`
- Create: `shared/collision.js`
- Modify: `public/main.js`
- Modify: `public/Renderer.js`

- [ ] **Step 1: Create shared constants**

Create `shared/constants.js` (shared between client and server later):
```js
export const PLAYER_RADIUS = 18;
export const PLAYER_SPEED = 180;
export const BULLET_RADIUS = 3;
export const PICKUP_RANGE = 40;
export const VISION_RANGE = 600;
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const PLAYER_HP = 100;
export const TICK_RATE = 20;
export const TICK_INTERVAL = 1000 / TICK_RATE;
```

- [ ] **Step 2: Create shared collision module**

Create `shared/collision.js`:
```js
export function resolveCircleAABB(cx, cy, radius, rect) {
  const nearX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const nearY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nearX;
  const dy = cy - nearY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < radius) {
    if (dist > 0) {
      const overlap = radius - dist;
      return { x: cx + (dx / dist) * overlap, y: cy + (dy / dist) * overlap };
    } else {
      // Center inside rect — push along axis of least penetration
      const overlapLeft = cx - rect.x;
      const overlapRight = (rect.x + rect.w) - cx;
      const overlapTop = cy - rect.y;
      const overlapBottom = (rect.y + rect.h) - cy;
      const min = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
      if (min === overlapLeft) return { x: rect.x - radius, y: cy };
      if (min === overlapRight) return { x: rect.x + rect.w + radius, y: cy };
      if (min === overlapTop) return { x: cx, y: rect.y - radius };
      return { x: cx, y: rect.y + rect.h + radius };
    }
  }
  return { x: cx, y: cy };
}

export function resolveAgainstWalls(cx, cy, radius, walls) {
  let x = cx, y = cy;
  for (const wall of walls) {
    const resolved = resolveCircleAABB(x, y, radius, wall);
    x = resolved.x;
    y = resolved.y;
  }
  return { x, y };
}
```

- [ ] **Step 3: Create InputHandler**

Create `public/InputHandler.js`:
```js
export class InputHandler {
  constructor(canvas) {
    this.keys = { up: false, down: false, left: false, right: false };
    this.shooting = false;
    this.angle = 0;
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
    canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    canvas.addEventListener('mousedown', () => { this.shooting = true; });
    canvas.addEventListener('mouseup', () => { this.shooting = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _onKey(e, down) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': this.keys.up = down; break;
      case 'KeyS': case 'ArrowDown': this.keys.down = down; break;
      case 'KeyA': case 'ArrowLeft': this.keys.left = down; break;
      case 'KeyD': case 'ArrowRight': this.keys.right = down; break;
    }
  }

  _onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left - this.canvas.width / 2;
    const my = e.clientY - rect.top - this.canvas.height / 2;
    this.angle = Math.atan2(my, mx);
  }

  getInput() {
    return {
      up: this.keys.up,
      down: this.keys.down,
      left: this.keys.left,
      right: this.keys.right,
      shooting: this.shooting,
      angle: this.angle
    };
  }
}
```

- [ ] **Step 4: Add player drawing to Renderer**

Add method to `public/Renderer.js` inside the class:
```js
drawPlayer(x, y, angle, radius, color, health, maxHealth) {
  const { ctx } = this;
  // Body circle
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Direction indicator
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(angle) * (radius + 8), y + Math.sin(angle) * (radius + 8));
  ctx.stroke();

  // Health bar
  if (health < maxHealth) {
    const barW = radius * 2.5;
    const barH = 4;
    const barX = x - barW / 2;
    const barY = y - radius - 12;
    const pct = health / maxHealth;
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = pct > 0.5 ? '#50c878' : pct > 0.25 ? '#ffc832' : '#ff4444';
    ctx.fillRect(barX, barY, barW * pct, barH);
  }
}
```

- [ ] **Step 5: Wire up local player movement in main.js**

Replace `public/main.js`:
```js
import { Renderer } from './Renderer.js';
import { InputHandler } from './InputHandler.js';
import { PLAYER_RADIUS, PLAYER_SPEED, PLAYER_HP } from './shared/constants.js';
import { resolveAgainstWalls } from './shared/collision.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

const renderer = new Renderer(canvas, ctx);
const input = new InputHandler(canvas);

document.getElementById('lobby').style.display = 'none';

const res = await fetch('/api/map');
const map = await res.json();
renderer.setMap(map);

// Local player state (temporary — will be server-driven later)
const player = {
  x: map.spawnPoints[0].x,
  y: map.spawnPoints[0].y,
  angle: 0,
  health: PLAYER_HP
};

let lastTime = performance.now();

function loop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;

  // Read input
  const inp = input.getInput();
  player.angle = inp.angle;

  // Movement
  let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
  if (dx !== 0 && dy !== 0) {
    const len = Math.sqrt(dx * dx + dy * dy);
    dx /= len;
    dy /= len;
  }
  player.x += dx * PLAYER_SPEED * dt;
  player.y += dy * PLAYER_SPEED * dt;

  // Collision
  const resolved = resolveAgainstWalls(player.x, player.y, PLAYER_RADIUS, renderer.allWalls);
  player.x = resolved.x;
  player.y = resolved.y;

  // Render
  renderer.draw(player.x, player.y);

  // Draw player (in world-space, need camera offset)
  ctx.save();
  ctx.translate(canvas.width / 2 - player.x, canvas.height / 2 - player.y);
  renderer.drawPlayer(player.x, player.y, player.angle, PLAYER_RADIUS, '#4a9eff', player.health, PLAYER_HP);
  ctx.restore();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
```

- [ ] **Step 6: Serve shared modules to the client**

Add to `server/index.js` (before the static middleware):
```js
app.use('/shared', express.static(join(__dirname, '..', 'shared')));
```

Update import paths in `public/main.js`:
```js
import { PLAYER_RADIUS, PLAYER_SPEED, PLAYER_HP } from '/shared/constants.js';
import { resolveAgainstWalls } from '/shared/collision.js';
```

- [ ] **Step 7: Verify and commit**

```bash
# Refresh browser — WASD to move, mouse to aim
# Player circle should move around map, collide with walls
# Camera follows player
```

```bash
git add shared/ public/InputHandler.js public/Renderer.js public/main.js server/index.js
git commit -m "feat: add local player movement with WASD, mouse aim, and wall collision"
```

---

### Task 4: Shadow Casting (Fog of War)

**Files:**
- Create: `public/ShadowCaster.js`
- Modify: `public/Renderer.js`
- Modify: `public/main.js`

- [ ] **Step 1: Create ShadowCaster.js**

Create `public/ShadowCaster.js`:
```js
import { VISION_RANGE } from '/shared/constants.js';

export class ShadowCaster {
  constructor() {
    this.segments = [];
  }

  /**
   * Set wall segments from wall rects.
   * Each rect becomes 4 line segments.
   */
  setWalls(wallRects) {
    this.segments = [];
    for (const r of wallRects) {
      // Top
      this.segments.push({ ax: r.x, ay: r.y, bx: r.x + r.w, by: r.y });
      // Bottom
      this.segments.push({ ax: r.x, ay: r.y + r.h, bx: r.x + r.w, by: r.y + r.h });
      // Left
      this.segments.push({ ax: r.x, ay: r.y, bx: r.x, by: r.y + r.h });
      // Right
      this.segments.push({ ax: r.x + r.w, ay: r.y, bx: r.x + r.w, by: r.y + r.h });
    }
  }

  /**
   * Compute visibility polygon from a point.
   * Returns array of {x, y} points forming the lit area.
   */
  computeVisibility(px, py) {
    const range = VISION_RANGE;

    // Filter segments near the player
    const nearby = [];
    for (const seg of this.segments) {
      // Quick AABB check: is any part of segment within range?
      const minX = Math.min(seg.ax, seg.bx);
      const maxX = Math.max(seg.ax, seg.bx);
      const minY = Math.min(seg.ay, seg.by);
      const maxY = Math.max(seg.ay, seg.by);
      if (maxX < px - range || minX > px + range) continue;
      if (maxY < py - range || minY > py + range) continue;
      nearby.push(seg);
    }

    // Add boundary segments (vision range box)
    const bx1 = px - range, by1 = py - range;
    const bx2 = px + range, by2 = py + range;
    nearby.push({ ax: bx1, ay: by1, bx: bx2, by: by1 });
    nearby.push({ ax: bx2, ay: by1, bx: bx2, by: by2 });
    nearby.push({ ax: bx2, ay: by2, bx: bx1, by: by2 });
    nearby.push({ ax: bx1, ay: by2, bx: bx1, by: by1 });

    // Collect unique angles from all endpoints
    const angles = new Set();
    const eps = 0.00001;
    for (const seg of nearby) {
      const a1 = Math.atan2(seg.ay - py, seg.ax - px);
      const a2 = Math.atan2(seg.by - py, seg.bx - px);
      angles.add(a1 - eps);
      angles.add(a1);
      angles.add(a1 + eps);
      angles.add(a2 - eps);
      angles.add(a2);
      angles.add(a2 + eps);
    }

    // Sort angles
    const sortedAngles = [...angles].sort((a, b) => a - b);

    // Cast ray for each angle, find nearest intersection
    const points = [];
    for (const angle of sortedAngles) {
      const rdx = Math.cos(angle);
      const rdy = Math.sin(angle);

      let minT = range;
      let hitX = px + rdx * range;
      let hitY = py + rdy * range;

      for (const seg of nearby) {
        const result = this._raySegmentIntersect(px, py, rdx, rdy, seg);
        if (result !== null && result.t < minT && result.t > 0) {
          minT = result.t;
          hitX = result.x;
          hitY = result.y;
        }
      }

      points.push({ x: hitX, y: hitY });
    }

    return points;
  }

  _raySegmentIntersect(rx, ry, rdx, rdy, seg) {
    const sdx = seg.bx - seg.ax;
    const sdy = seg.by - seg.ay;
    const denom = rdx * sdy - rdy * sdx;
    if (Math.abs(denom) < 1e-10) return null;

    const t = ((seg.ax - rx) * sdy - (seg.ay - ry) * sdx) / denom;
    const u = ((seg.ax - rx) * rdy - (seg.ay - ry) * rdx) / denom;

    if (t >= 0 && u >= 0 && u <= 1) {
      return { t, x: rx + t * rdx, y: ry + t * rdy };
    }
    return null;
  }

  /**
   * Check if a point is inside the visibility polygon.
   * Uses ray casting point-in-polygon test.
   */
  isVisible(px, py, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      if (((yi > py) !== (yj > py)) &&
          (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }
}
```

- [ ] **Step 2: Add shadow rendering to Renderer**

Add to `public/Renderer.js`:

Constructor additions:
```js
this.shadowCanvas = document.createElement('canvas');
this.shadowCtx = this.shadowCanvas.getContext('2d');
```

Add method:
```js
drawShadow(visibilityPolygon, cameraX, cameraY) {
  const { ctx, canvas, shadowCanvas, shadowCtx, map } = this;
  if (!map || visibilityPolygon.length < 3) return;

  // Size shadow canvas to match main canvas
  shadowCanvas.width = canvas.width;
  shadowCanvas.height = canvas.height;

  const offsetX = canvas.width / 2 - cameraX;
  const offsetY = canvas.height / 2 - cameraY;

  // Fill with dark
  shadowCtx.fillStyle = 'rgba(0, 0, 0, 0.88)';
  shadowCtx.fillRect(0, 0, shadowCanvas.width, shadowCanvas.height);

  // Cut out visibility polygon
  shadowCtx.globalCompositeOperation = 'destination-out';
  shadowCtx.fillStyle = '#fff';
  shadowCtx.beginPath();
  shadowCtx.moveTo(
    visibilityPolygon[0].x + offsetX,
    visibilityPolygon[0].y + offsetY
  );
  for (let i = 1; i < visibilityPolygon.length; i++) {
    shadowCtx.lineTo(
      visibilityPolygon[i].x + offsetX,
      visibilityPolygon[i].y + offsetY
    );
  }
  shadowCtx.closePath();
  shadowCtx.fill();
  shadowCtx.globalCompositeOperation = 'source-over';

  // Blit onto main canvas
  ctx.drawImage(shadowCanvas, 0, 0);
}
```

- [ ] **Step 3: Update draw order in Renderer.draw()**

Modify `Renderer.draw()` to accept visibility polygon and draw in correct order:

```js
draw(cameraX, cameraY, visibilityPolygon) {
  const { ctx, canvas, map } = this;
  if (!map) return;

  ctx.save();
  const offsetX = canvas.width / 2 - cameraX;
  const offsetY = canvas.height / 2 - cameraY;
  ctx.translate(offsetX, offsetY);

  // Floor
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, map.width, map.height);

  // Building floors
  ctx.fillStyle = '#252540';
  for (const b of map.buildings) {
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }

  // Loot slot markers (debug)
  ctx.fillStyle = 'rgba(255, 200, 50, 0.3)';
  for (const b of map.buildings) {
    for (const slot of b.lootSlots) {
      ctx.beginPath();
      ctx.arc(slot.x, slot.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();

  // Shadow overlay (screen-space)
  if (visibilityPolygon) {
    this.drawShadow(visibilityPolygon, cameraX, cameraY);
  }

  // Walls drawn ABOVE shadow so always visible
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.fillStyle = '#555';
  for (const w of this.allWalls) {
    ctx.fillRect(w.x, w.y, w.w, w.h);
  }
  ctx.restore();
}
```

- [ ] **Step 4: Integrate shadow casting into main.js**

Update `public/main.js` to use ShadowCaster:

Add import:
```js
import { ShadowCaster } from './ShadowCaster.js';
```

After `renderer.setMap(map)`:
```js
const shadowCaster = new ShadowCaster();
shadowCaster.setWalls(renderer.allWalls);
```

In the loop, before rendering:
```js
const visibility = shadowCaster.computeVisibility(player.x, player.y);
```

Update render calls:
```js
renderer.draw(player.x, player.y, visibility);

// Draw player on top of shadow
ctx.save();
ctx.translate(canvas.width / 2 - player.x, canvas.height / 2 - player.y);
renderer.drawPlayer(player.x, player.y, player.angle, PLAYER_RADIUS, '#4a9eff', player.health, PLAYER_HP);
ctx.restore();
```

- [ ] **Step 5: Verify and commit**

```bash
# Refresh browser — should see fog of war!
# Dark shadow everywhere except where you can see
# Walls cast shadows, walking behind walls hides areas
# Walking into buildings reveals interior through doorways
# This is the identity milestone
```

```bash
git add public/ShadowCaster.js public/Renderer.js public/main.js
git commit -m "feat: implement 2D visibility polygon shadow casting (fog of war)"
```

---

## Chunk 2: Multiplayer, Shooting & Loot (Phases 4-6)

After this chunk: multiple players can connect, see each other through fog of war, shoot, pick up weapons, and die.

### Task 5: Server-Side Game Room & Multiplayer

**Files:**
- Create: `server/GameRoom.js`
- Create: `server/Player.js`
- Modify: `server/index.js`
- Modify: `public/main.js`
- Modify: `public/Renderer.js`

- [ ] **Step 1: Create Player.js**

Create `server/Player.js`:
```js
import { PLAYER_RADIUS, PLAYER_SPEED, PLAYER_HP } from '../shared/constants.js';

export class Player {
  constructor(id, spawnX, spawnY) {
    this.id = id;
    this.x = spawnX;
    this.y = spawnY;
    this.radius = PLAYER_RADIUS;
    this.angle = 0;
    this.speed = PLAYER_SPEED;
    this.health = PLAYER_HP;
    this.alive = true;

    // Inventory
    this.gun = null;
    this.grenade = null;
    this.heal = null;

    // Input state
    this.input = {
      up: false, down: false, left: false, right: false,
      shooting: false, angle: 0, seq: 0
    };

    // Shooting cooldown
    this.lastShotTime = 0;

    // Healing state
    this.healing = false;
    this.healingUntil = 0;

    // Stats
    this.kills = 0;
    this.joinedAt = Date.now();
  }

  toSnapshot() {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      angle: this.angle,
      health: this.health,
      alive: this.alive,
      gun: this.gun,
      grenade: this.grenade,
      heal: this.heal,
      healing: this.healing
    };
  }
}
```

- [ ] **Step 2: Create GameRoom.js**

Create `server/GameRoom.js`:
```js
import { Player } from './Player.js';
import { resolveAgainstWalls } from '../shared/collision.js';
import { PLAYER_RADIUS, PLAYER_SPEED, TICK_INTERVAL } from '../shared/constants.js';

const STATES = { WAITING: 'WAITING', COUNTDOWN: 'COUNTDOWN', ACTIVE: 'ACTIVE', ENDED: 'ENDED' };

export class GameRoom {
  constructor(id, map, io) {
    this.id = id;
    this.map = map;
    this.io = io;
    this.state = STATES.WAITING;
    this.players = new Map();
    this.bullets = [];
    this.grenades = [];
    this.groundItems = [];
    this.tick = 0;
    this.gameStartTime = null;
    this.tickInterval = null;
    this.lastTickTime = null;
    this.autoStartTimer = null;

    // Flatten walls for collision
    this.allWalls = [...map.walls];
    for (const b of map.buildings) {
      this.allWalls.push(...b.walls);
    }

    // Zone state
    this.zone = {
      active: false,
      centerX: map.width / 2,
      centerY: map.height / 2,
      startRadius: Math.sqrt(map.width * map.width + map.height * map.height) / 2,
      currentRadius: Math.sqrt(map.width * map.width + map.height * map.height) / 2,
      finalRadius: 120,
      activateAfterMs: 60000,
      shrinkDuration: 120000,
      shrinkStartTime: null,
      damagePerSecond: 8
    };
  }

  addPlayer(socket) {
    // Assign spawn point (maximize distance from others)
    const spawn = this._pickSpawn();
    const player = new Player(socket.id, spawn.x, spawn.y);
    this.players.set(socket.id, player);
    socket.join(this.id);

    // Send room info
    socket.emit('roomJoined', {
      roomId: this.id,
      playerId: socket.id,
      map: this.map
    });

    // Handle input
    socket.on('playerInput', (data) => {
      const p = this.players.get(socket.id);
      if (p && p.alive) {
        p.input = data;
        p.angle = data.angle;
      }
    });

    socket.on('requestStart', () => {
      if (this.state === STATES.WAITING && this.players.size >= 2) {
        this._startCountdown();
      }
    });

    socket.on('disconnect', () => {
      this._removePlayer(socket.id);
    });

    // Auto-start timer
    if (this.players.size >= 2 && !this.autoStartTimer && this.state === STATES.WAITING) {
      this.autoStartTimer = setTimeout(() => {
        if (this.state === STATES.WAITING && this.players.size >= 2) {
          this._startCountdown();
        }
      }, 30000);
    }

    // Notify all players of count
    this.io.to(this.id).emit('playerCount', { count: this.players.size, max: 8 });
  }

  _removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (player && player.alive && this.state === STATES.ACTIVE) {
      player.alive = false;
      player.health = 0;
      this._dropItems(player);
      this.io.to(this.id).emit('playerKilled', { victimId: socketId, killerId: null });
      this._checkWin();
    }
    this.players.delete(socketId);

    if (this.players.size < 2 && this.autoStartTimer) {
      clearTimeout(this.autoStartTimer);
      this.autoStartTimer = null;
    }

    this.io.to(this.id).emit('playerCount', { count: this.players.size, max: 8 });
  }

  _pickSpawn() {
    const spawns = [...this.map.spawnPoints];
    const used = [...this.players.values()].map(p => ({ x: p.x, y: p.y }));
    if (used.length === 0) return spawns[Math.floor(Math.random() * spawns.length)];

    // Greedy: pick spawn farthest from all assigned players
    let best = spawns[0];
    let bestMinDist = 0;
    for (const sp of spawns) {
      let minDist = Infinity;
      for (const u of used) {
        const d = Math.sqrt((sp.x - u.x) ** 2 + (sp.y - u.y) ** 2);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        best = sp;
      }
    }
    return best;
  }

  _startCountdown() {
    if (this.autoStartTimer) {
      clearTimeout(this.autoStartTimer);
      this.autoStartTimer = null;
    }
    this.state = STATES.COUNTDOWN;

    const spawnPositions = {};
    this.players.forEach((p, id) => {
      spawnPositions[id] = { x: p.x, y: p.y };
    });
    this.io.to(this.id).emit('countdown', { spawnPositions, seconds: 3 });

    setTimeout(() => {
      this.state = STATES.ACTIVE;
      this.gameStartTime = Date.now();
      this.lastTickTime = Date.now();
      this.io.to(this.id).emit('gameStart', {});
      this._startTickLoop();
    }, 3000);
  }

  _startTickLoop() {
    this.tickInterval = setInterval(() => this._tick(), TICK_INTERVAL);
  }

  _tick() {
    if (this.state !== STATES.ACTIVE) return;

    const now = Date.now();
    const dt = Math.min((now - this.lastTickTime) / 1000, 0.1);
    this.lastTickTime = now;
    this.tick++;

    // 1. Move players
    this.players.forEach((player) => {
      if (!player.alive) return;
      const inp = player.input;

      // Cancel healing if moving or shooting
      if (player.healing && (inp.up || inp.down || inp.left || inp.right || inp.shooting)) {
        player.healing = false;
        player.healingUntil = 0;
      }

      // Skip movement if healing
      if (player.healing) return;

      let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      if (dx !== 0 && dy !== 0) {
        const len = Math.sqrt(dx * dx + dy * dy);
        dx /= len;
        dy /= len;
      }
      player.x += dx * player.speed * dt;
      player.y += dy * player.speed * dt;

      const resolved = resolveAgainstWalls(player.x, player.y, player.radius, this.allWalls);
      player.x = resolved.x;
      player.y = resolved.y;
    });

    // Broadcast state
    this._broadcastState();
  }

  _broadcastState() {
    const players = [];
    const lastProcessedInput = {};
    this.players.forEach((p, id) => {
      players.push(p.toSnapshot());
      lastProcessedInput[id] = p.input.seq || 0;
    });

    const snapshot = {
      tick: this.tick,
      lastProcessedInput,
      players,
      bullets: this.bullets.map(b => ({ id: b.id, x: b.x, y: b.y, angle: b.angle, type: b.type, ownerId: b.ownerId })),
      grenades: this.grenades.map(g => ({ id: g.id, x: g.x, y: g.y, explodeAt: g.explodeAt })),
      groundItems: this.groundItems.map(i => ({ id: i.id, type: i.type, x: i.x, y: i.y, ammo: i.ammo })),
      zone: {
        active: this.zone.active,
        centerX: this.zone.centerX,
        centerY: this.zone.centerY,
        currentRadius: this.zone.currentRadius,
        finalRadius: this.zone.finalRadius
      },
      gameElapsedMs: this.gameStartTime ? Date.now() - this.gameStartTime : 0,
      alivePlayers: [...this.players.values()].filter(p => p.alive).length
    };

    this.io.to(this.id).emit('gameState', snapshot);
  }

  _dropItems(player) {
    // Will be implemented in Task 7 (Loot System)
  }

  _checkWin() {
    const alive = [...this.players.values()].filter(p => p.alive);
    if (alive.length <= 1 && this.state === STATES.ACTIVE) {
      this.state = STATES.ENDED;
      clearInterval(this.tickInterval);
      const winnerId = alive.length === 1 ? alive[0].id : null;
      this.io.to(this.id).emit('gameOver', { winnerId });
    }
  }

  get isFull() { return this.players.size >= 8; }
  get isEmpty() { return this.players.size === 0; }
}
```

- [ ] **Step 3: Wire GameRoom into server/index.js**

Replace `server/index.js`:
```js
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { GameRoom } from './GameRoom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const mapData = JSON.parse(readFileSync(join(__dirname, 'map.json'), 'utf-8'));

app.use('/shared', express.static(join(__dirname, '..', 'shared')));
app.use(express.static(join(__dirname, '..', 'public')));

app.get('/api/map', (req, res) => res.json(mapData));

// Room management
let currentRoom = null;
const rooms = new Map();

function getOrCreateRoom() {
  if (currentRoom && !currentRoom.isFull && currentRoom.state === 'WAITING') {
    return currentRoom;
  }
  const id = `room_${Date.now()}`;
  const room = new GameRoom(id, mapData, io);
  rooms.set(id, room);
  currentRoom = room;
  return room;
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  const room = getOrCreateRoom();
  room.addPlayer(socket);

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    // Cleanup empty rooms
    rooms.forEach((r, id) => {
      if (r.isEmpty) rooms.delete(id);
    });
    if (currentRoom && currentRoom.isEmpty) currentRoom = null;
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`BattleCircle server running on http://localhost:${PORT}`);
});
```

- [ ] **Step 4: Update main.js for multiplayer**

Replace `public/main.js` with multiplayer-aware client:
```js
import { Renderer } from './Renderer.js';
import { InputHandler } from './InputHandler.js';
import { ShadowCaster } from './ShadowCaster.js';
import { PLAYER_RADIUS, PLAYER_SPEED, PLAYER_HP } from '/shared/constants.js';
import { resolveAgainstWalls } from '/shared/collision.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

const renderer = new Renderer(canvas, ctx);
const inputHandler = new InputHandler(canvas);
const shadowCaster = new ShadowCaster();

// Connect to server
const socket = io();
let myId = null;
let map = null;
let gameState = null;
let prevGameState = null;
let gameActive = false;

// Lobby UI
const lobby = document.getElementById('lobby');
const lobbyStatus = lobby.querySelector('.status');
const startBtn = document.getElementById('startBtn');

startBtn.addEventListener('click', () => {
  socket.emit('requestStart');
});

socket.on('roomJoined', (data) => {
  myId = data.playerId;
  map = data.map;
  renderer.setMap(map);
  shadowCaster.setWalls(renderer.allWalls);
  lobbyStatus.textContent = 'Waiting for players...';
});

socket.on('playerCount', (data) => {
  lobbyStatus.textContent = `${data.count} / ${data.max} players`;
  startBtn.disabled = data.count < 2;
});

socket.on('countdown', (data) => {
  lobbyStatus.textContent = `Starting in 3...`;
  let sec = 3;
  const countdownInterval = setInterval(() => {
    sec--;
    if (sec > 0) {
      lobbyStatus.textContent = `Starting in ${sec}...`;
    } else {
      clearInterval(countdownInterval);
    }
  }, 1000);
});

socket.on('gameStart', () => {
  gameActive = true;
  lobby.style.display = 'none';
});

socket.on('gameState', (state) => {
  prevGameState = gameState;
  gameState = state;
});

socket.on('gameOver', (data) => {
  gameActive = false;
  const overlay = document.getElementById('overlay');
  overlay.style.display = 'flex';
  if (data.winnerId === myId) {
    overlay.innerHTML = '<h1 style="font-size:48px;color:#ffc832;letter-spacing:4px">VICTORY</h1><button onclick="location.reload()" style="margin-top:20px;padding:12px 32px;font-size:18px;background:#4a9eff;color:#fff;border:none;border-radius:8px;cursor:pointer">Play Again</button>';
  } else {
    overlay.innerHTML = '<h1 style="font-size:48px;color:#ff4444;letter-spacing:4px">ELIMINATED</h1><button onclick="location.reload()" style="margin-top:20px;padding:12px 32px;font-size:18px;background:#4a9eff;color:#fff;border:none;border-radius:8px;cursor:pointer">Play Again</button>';
  }
});

socket.on('playerKilled', (data) => {
  if (data.victimId === myId) {
    gameActive = false;
    const overlay = document.getElementById('overlay');
    overlay.style.display = 'flex';
    overlay.innerHTML = '<h1 style="font-size:48px;color:#ff4444;letter-spacing:4px">ELIMINATED</h1><button onclick="location.reload()" style="margin-top:20px;padding:12px 32px;font-size:18px;background:#4a9eff;color:#fff;border:none;border-radius:8px;cursor:pointer">Play Again</button>';
  }
});

// Input sending
let lastInputJSON = '';
function sendInput(seq) {
  const inp = inputHandler.getInput();
  inp.seq = seq;
  const json = JSON.stringify(inp);
  if (json !== lastInputJSON) {
    socket.emit('playerInput', inp);
    lastInputJSON = json;
  }
}

// Player colors
const COLORS = ['#4a9eff', '#ff6b6b', '#50c878', '#ffc832', '#ff8c42', '#c77dff', '#64dfdf', '#ff5e78'];

let seq = 0;
let lastTime = performance.now();

function loop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;

  if (gameActive && gameState && map) {
    seq++;
    sendInput(seq);

    // Find my player
    const me = gameState.players.find(p => p.id === myId);
    if (me && me.alive) {
      // Compute visibility
      const visibility = shadowCaster.computeVisibility(me.x, me.y);

      // Draw
      renderer.draw(me.x, me.y, visibility);

      // Draw other players (only if visible)
      ctx.save();
      ctx.translate(canvas.width / 2 - me.x, canvas.height / 2 - me.y);

      const playerIndex = gameState.players.findIndex(p => p.id === myId);
      gameState.players.forEach((p, i) => {
        if (p.id === myId || !p.alive) return;
        if (shadowCaster.isVisible(p.x, p.y, visibility)) {
          renderer.drawPlayer(p.x, p.y, p.angle, PLAYER_RADIUS, COLORS[i % COLORS.length], p.health, PLAYER_HP);
        }
      });

      // Draw local player on top
      renderer.drawPlayer(me.x, me.y, me.angle, PLAYER_RADIUS, COLORS[playerIndex % COLORS.length], me.health, PLAYER_HP);

      ctx.restore();
    }
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
```

- [ ] **Step 5: Add Socket.IO client script to HTML**

Add to `public/index.html` before the main.js script tag:
```html
<script src="/socket.io/socket.io.js"></script>
```

- [ ] **Step 6: Verify and commit**

```bash
# Open two browser tabs to http://localhost:3000
# Both should join lobby, see player count update
# Click Start with 2+ players — 3s countdown, then game starts
# Both players visible, moving around with WASD
# Players behind walls are hidden by fog of war
```

```bash
git add server/GameRoom.js server/Player.js server/index.js public/main.js public/index.html
git commit -m "feat: add multiplayer with server-authoritative movement and fog of war"
```

---

### Task 6: Shooting & Combat

**Files:**
- Create: `server/Bullet.js`
- Create: `shared/weapons.js`
- Modify: `server/GameRoom.js`
- Modify: `public/Renderer.js`

- [ ] **Step 1: Create weapon definitions**

Create `shared/weapons.js`:
```js
export const WEAPONS = {
  pistol: {
    name: 'Pistol',
    fireRate: 2,       // shots/sec
    damage: 20,
    range: 400,
    ammo: 12,
    bulletSpeed: 500,
    pellets: 1,
    spread: 0,
    color: '#aaa'
  },
  shotgun: {
    name: 'Shotgun',
    fireRate: 0.8,
    damage: 8,
    range: 250,
    ammo: 5,
    bulletSpeed: 450,
    pellets: 5,
    spread: 0.15,      // ±0.15 rad
    color: '#ff8c42'
  },
  rifle: {
    name: 'Rifle',
    fireRate: 1.5,
    damage: 35,
    range: 700,
    ammo: 10,
    bulletSpeed: 800,
    pellets: 1,
    spread: 0,
    color: '#4a9eff'
  }
};
```

- [ ] **Step 2: Create Bullet.js**

Create `server/Bullet.js`:
```js
let nextBulletId = 0;

export class Bullet {
  constructor(ownerId, x, y, angle, weapon) {
    this.id = `b${nextBulletId++}`;
    this.ownerId = ownerId;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.speed = weapon.bulletSpeed;
    this.damage = weapon.damage;
    this.range = weapon.range;
    this.type = weapon.name.toLowerCase();
    this.distanceTraveled = 0;
    this.alive = true;
  }

  update(dt) {
    const dx = Math.cos(this.angle) * this.speed * dt;
    const dy = Math.sin(this.angle) * this.speed * dt;
    this.x += dx;
    this.y += dy;
    this.distanceTraveled += this.speed * dt;
    if (this.distanceTraveled >= this.range) {
      this.alive = false;
    }
  }
}
```

- [ ] **Step 3: Add shooting and bullet logic to GameRoom._tick()**

Add to `server/GameRoom.js` imports:
```js
import { Bullet } from './Bullet.js';
import { WEAPONS } from '../shared/weapons.js';
import { PLAYER_RADIUS, BULLET_RADIUS } from '../shared/constants.js';
```

In `_tick()`, after player movement, add:

```js
// 2. Process shooting
this.players.forEach((player) => {
  if (!player.alive || !player.input.shooting || !player.gun || player.healing) return;

  const weapon = WEAPONS[player.gun.type];
  if (!weapon) return;

  const cooldown = 1000 / weapon.fireRate;
  const now = Date.now();
  if (now - player.lastShotTime < cooldown) return;
  if (player.gun.ammo <= 0) return;

  player.lastShotTime = now;
  player.gun.ammo--;

  // Create bullets
  for (let i = 0; i < weapon.pellets; i++) {
    let angle = player.angle;
    if (weapon.pellets > 1) {
      // Evenly distribute across spread arc
      const step = (weapon.spread * 2) / (weapon.pellets - 1);
      angle = player.angle - weapon.spread + step * i;
    }
    this.bullets.push(new Bullet(player.id, player.x, player.y, angle, weapon));
  }
});

// 3. Update bullets
for (let i = this.bullets.length - 1; i >= 0; i--) {
  const bullet = this.bullets[i];
  bullet.update(dt);

  if (!bullet.alive) {
    this.bullets.splice(i, 1);
    continue;
  }

  // Wall collision
  let hitWall = false;
  for (const wall of this.allWalls) {
    if (bullet.x >= wall.x && bullet.x <= wall.x + wall.w &&
        bullet.y >= wall.y && bullet.y <= wall.y + wall.h) {
      hitWall = true;
      break;
    }
  }
  if (hitWall) {
    this.bullets.splice(i, 1);
    continue;
  }

  // Player collision
  let hitPlayer = false;
  this.players.forEach((player) => {
    if (hitPlayer || !player.alive || player.id === bullet.ownerId) return;
    const dx = bullet.x - player.x;
    const dy = bullet.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < PLAYER_RADIUS + BULLET_RADIUS) {
      player.health -= bullet.damage;
      hitPlayer = true;

      // Emit hit feedback to victim
      const victimSocket = this.io.sockets.sockets.get(player.id);
      if (victimSocket) {
        victimSocket.emit('playerHit', { damage: bullet.damage, angle: bullet.angle });
      }

      if (player.health <= 0) {
        player.health = 0;
        player.alive = false;
        const attacker = this.players.get(bullet.ownerId);
        if (attacker) attacker.kills++;
        this._dropItems(player);
        this.io.to(this.id).emit('playerKilled', { victimId: player.id, killerId: bullet.ownerId });
        this._checkWin();
      }
    }
  });
  if (hitPlayer) {
    this.bullets.splice(i, 1);
  }
}
```

- [ ] **Step 4: Give all players a temporary starter pistol**

In `GameRoom.addPlayer()`, after creating the player:
```js
// Temporary starter weapon (until loot system is built)
player.gun = { type: 'pistol', ammo: 12 };
```

- [ ] **Step 5: Add bullet rendering to Renderer.js**

Add method to `Renderer`:
```js
drawBullets(bullets, cameraX, cameraY) {
  const { ctx, canvas } = this;
  ctx.save();
  ctx.translate(canvas.width / 2 - cameraX, canvas.height / 2 - cameraY);
  for (const b of bullets) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
```

- [ ] **Step 6: Render bullets in main.js**

In the game loop in `main.js`, after drawing the map and before drawing players:
```js
// Draw bullets
if (gameState.bullets.length > 0) {
  renderer.drawBullets(gameState.bullets, me.x, me.y);
}
```

- [ ] **Step 7: Verify and commit**

```bash
# Two tabs — both players have pistols
# Click to shoot — bullets appear, travel, hit walls/players
# Health decreases on hit, players can be killed
# ELIMINATED overlay on death
```

```bash
git add server/Bullet.js shared/weapons.js server/GameRoom.js public/Renderer.js public/main.js
git commit -m "feat: add shooting with bullets, hit detection, and kill flow"
```

---

### Task 7: Loot System

**Files:**
- Modify: `server/GameRoom.js`
- Modify: `public/Renderer.js`
- Modify: `public/main.js`
- Modify: `public/InputHandler.js`

- [ ] **Step 1: Add loot table and spawning to GameRoom**

Add to `server/GameRoom.js`:
```js
import { PICKUP_RANGE } from '../shared/constants.js';

// Loot table
const LOOT_TABLE = [
  { type: 'pistol', slot: 'gun', weight: 30 },
  { type: 'shotgun', slot: 'gun', weight: 15 },
  { type: 'rifle', slot: 'gun', weight: 10 },
  { type: 'frag', slot: 'grenade', weight: 15 },
  { type: 'bandage', slot: 'heal', weight: 20 },
];
```

Add method to `GameRoom`:
```js
_spawnLoot() {
  let itemId = 0;
  const totalWeight = LOOT_TABLE.reduce((s, i) => s + i.weight, 0);

  for (const building of this.map.buildings) {
    for (const slot of building.lootSlots) {
      let roll = Math.random() * totalWeight;
      let picked = LOOT_TABLE[0];
      for (const entry of LOOT_TABLE) {
        roll -= entry.weight;
        if (roll <= 0) { picked = entry; break; }
      }

      const item = {
        id: `item_${itemId++}`,
        type: picked.type,
        slot: picked.slot,
        x: slot.x,
        y: slot.y
      };

      // Add ammo for guns
      if (picked.slot === 'gun') {
        item.ammo = WEAPONS[picked.type].ammo;
      }

      this.groundItems.push(item);
    }
  }
}
```

Call `this._spawnLoot()` in `_startCountdown()` right before the setTimeout.

- [ ] **Step 2: Remove starter pistol, add pickup handler**

Remove the temporary starter pistol from `addPlayer()`.

Add pickup handler in `addPlayer()`:
```js
socket.on('pickup', () => {
  const p = this.players.get(socket.id);
  if (!p || !p.alive || this.state !== STATES.ACTIVE) return;

  // Find nearest item in range
  let nearest = null;
  let nearestDist = Infinity;
  for (const item of this.groundItems) {
    const dx = item.x - p.x;
    const dy = item.y - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < PICKUP_RANGE && dist < nearestDist) {
      nearestDist = dist;
      nearest = item;
    }
  }
  if (!nearest) return;

  const idx = this.groundItems.indexOf(nearest);

  if (nearest.slot === 'gun') {
    if (p.gun) {
      // Swap — drop current gun
      this.groundItems.push({
        id: `item_${Date.now()}`,
        type: p.gun.type,
        slot: 'gun',
        x: p.x,
        y: p.y,
        ammo: p.gun.ammo
      });
    }
    p.gun = { type: nearest.type, ammo: nearest.ammo };
  } else if (nearest.slot === 'grenade') {
    if (p.grenade && p.grenade.type === nearest.type && p.grenade.count < 3) {
      p.grenade.count++;
    } else if (p.grenade) {
      // Swap
      this.groundItems.push({
        id: `item_${Date.now()}`,
        type: p.grenade.type,
        slot: 'grenade',
        x: p.x, y: p.y,
        count: p.grenade.count
      });
      p.grenade = { type: nearest.type, count: 1 };
    } else {
      p.grenade = { type: nearest.type, count: 1 };
    }
  } else if (nearest.slot === 'heal') {
    if (p.heal && p.heal.type === nearest.type && p.heal.count < 5) {
      p.heal.count++;
    } else if (p.heal) {
      this.groundItems.push({
        id: `item_${Date.now()}`,
        type: p.heal.type,
        slot: 'heal',
        x: p.x, y: p.y,
        count: p.heal.count
      });
      p.heal = { type: nearest.type, count: 1 };
    } else {
      p.heal = { type: nearest.type, count: 1 };
    }
  }

  this.groundItems.splice(idx, 1);
});
```

- [ ] **Step 3: Implement _dropItems**

Replace the stub `_dropItems` in `GameRoom`:
```js
_dropItems(player) {
  if (player.gun) {
    this.groundItems.push({
      id: `item_${Date.now()}_gun`,
      type: player.gun.type,
      slot: 'gun',
      x: player.x,
      y: player.y,
      ammo: player.gun.ammo
    });
    player.gun = null;
  }
  if (player.grenade) {
    this.groundItems.push({
      id: `item_${Date.now()}_gren`,
      type: player.grenade.type,
      slot: 'grenade',
      x: player.x,
      y: player.y,
      count: player.grenade.count
    });
    player.grenade = null;
  }
  if (player.heal) {
    this.groundItems.push({
      id: `item_${Date.now()}_heal`,
      type: player.heal.type,
      slot: 'heal',
      x: player.x,
      y: player.y,
      count: player.heal.count
    });
    player.heal = null;
  }
}
```

- [ ] **Step 4: Add ground item rendering**

Add to `Renderer.js`:
```js
drawGroundItems(items, cameraX, cameraY, timestamp) {
  const { ctx, canvas } = this;
  ctx.save();
  ctx.translate(canvas.width / 2 - cameraX, canvas.height / 2 - cameraY);

  const ITEM_COLORS = {
    pistol: '#aaa',
    shotgun: '#ff8c42',
    rifle: '#4a9eff',
    frag: '#ff6347',
    bandage: '#50c878'
  };

  const glow = 0.3 + 0.15 * Math.sin(timestamp / 400);

  for (const item of items) {
    const color = ITEM_COLORS[item.type] || '#fff';
    // Glow
    ctx.fillStyle = color;
    ctx.globalAlpha = glow;
    ctx.beginPath();
    ctx.arc(item.x, item.y, 14, 0, Math.PI * 2);
    ctx.fill();
    // Solid circle
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(item.x, item.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
}
```

- [ ] **Step 5: Add E key for pickup in InputHandler**

Add to `InputHandler._onKey()`:
```js
case 'KeyE': if (down) this._pickupPressed = true; break;
```

Add to `InputHandler`:
```js
consumePickup() {
  if (this._pickupPressed) {
    this._pickupPressed = false;
    return true;
  }
  return false;
}
```

Initialize `this._pickupPressed = false;` in constructor.

- [ ] **Step 6: Wire ground items and pickup into main.js**

In the game loop, render ground items (filter by visibility):
```js
// Ground items (only visible ones)
const visibleItems = gameState.groundItems.filter(item =>
  shadowCaster.isVisible(item.x, item.y, visibility)
);
renderer.drawGroundItems(visibleItems, me.x, me.y, timestamp);
```

Handle pickup:
```js
if (inputHandler.consumePickup()) {
  socket.emit('pickup');
}
```

- [ ] **Step 7: Verify and commit**

```bash
# Ground items visible in buildings
# Walk near item, press E to pick up
# Gun equips, can shoot with it
# Kill player, their items drop on the ground
# Pick up dropped items
```

```bash
git add server/GameRoom.js shared/weapons.js public/Renderer.js public/InputHandler.js public/main.js
git commit -m "feat: add loot system with ground items, pickup, swap, and death drops"
```

---

## Chunk 3: Prediction, Zone, Grenades & Healing (Phases 7-9)

After this chunk: all core mechanics work — client prediction, shrinking zone, grenades, healing.

### Task 8: Client-Side Prediction

**Files:**
- Modify: `public/main.js`

- [ ] **Step 1: Implement prediction with input buffer and reconciliation**

In `public/main.js`, add prediction state:
```js
// Client prediction state
const inputBuffer = [];
let predictedX = 0, predictedY = 0;
let serverReconciled = false;
```

Replace the input sending and rendering section of the game loop with prediction logic:

```js
if (gameActive && gameState && map) {
  seq++;
  const inp = inputHandler.getInput();
  inp.seq = seq;

  // Send input on change
  const json = JSON.stringify(inp);
  if (json !== lastInputJSON) {
    socket.emit('playerInput', inp);
    lastInputJSON = json;
  }

  // Store input in buffer for reconciliation
  inputBuffer.push({ ...inp, seq, dt });

  // Apply local prediction
  let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
  if (dx !== 0 && dy !== 0) {
    const len = Math.sqrt(dx * dx + dy * dy);
    dx /= len;
    dy /= len;
  }
  predictedX += dx * PLAYER_SPEED * dt;
  predictedY += dy * PLAYER_SPEED * dt;
  const resolved = resolveAgainstWalls(predictedX, predictedY, PLAYER_RADIUS, renderer.allWalls);
  predictedX = resolved.x;
  predictedY = resolved.y;

  // Reconcile with server
  const me = gameState.players.find(p => p.id === myId);
  if (me && me.alive) {
    const lastAcked = gameState.lastProcessedInput[myId] || 0;

    // Discard acknowledged inputs
    while (inputBuffer.length > 0 && inputBuffer[0].seq <= lastAcked) {
      inputBuffer.shift();
    }

    // Re-predict from server position
    let reconX = me.x;
    let reconY = me.y;
    for (const bufferedInput of inputBuffer) {
      let bdx = (bufferedInput.right ? 1 : 0) - (bufferedInput.left ? 1 : 0);
      let bdy = (bufferedInput.down ? 1 : 0) - (bufferedInput.up ? 1 : 0);
      if (bdx !== 0 && bdy !== 0) {
        const len = Math.sqrt(bdx * bdx + bdy * bdy);
        bdx /= len;
        bdy /= len;
      }
      reconX += bdx * PLAYER_SPEED * bufferedInput.dt;
      reconY += bdy * PLAYER_SPEED * bufferedInput.dt;
      const r = resolveAgainstWalls(reconX, reconY, PLAYER_RADIUS, renderer.allWalls);
      reconX = r.x;
      reconY = r.y;
    }

    // Smooth correction
    const errX = reconX - predictedX;
    const errY = reconY - predictedY;
    const err = Math.sqrt(errX * errX + errY * errY);
    if (err > 2) {
      predictedX += errX * 0.3;
      predictedY += errY * 0.3;
    } else {
      predictedX = reconX;
      predictedY = reconY;
    }

    // Use predicted position for rendering
    const renderX = predictedX;
    const renderY = predictedY;

    const visibility = shadowCaster.computeVisibility(renderX, renderY);
    renderer.draw(renderX, renderY, visibility);

    // Ground items
    const visibleItems = gameState.groundItems.filter(item =>
      shadowCaster.isVisible(item.x, item.y, visibility)
    );
    renderer.drawGroundItems(visibleItems, renderX, renderY, timestamp);

    // Bullets
    if (gameState.bullets.length > 0) {
      renderer.drawBullets(gameState.bullets, renderX, renderY);
    }

    // Other players
    ctx.save();
    ctx.translate(canvas.width / 2 - renderX, canvas.height / 2 - renderY);
    const playerIndex = gameState.players.findIndex(p => p.id === myId);
    gameState.players.forEach((p, i) => {
      if (p.id === myId || !p.alive) return;
      if (shadowCaster.isVisible(p.x, p.y, visibility)) {
        renderer.drawPlayer(p.x, p.y, p.angle, PLAYER_RADIUS, COLORS[i % COLORS.length], p.health, PLAYER_HP);
      }
    });

    // Local player at predicted position
    renderer.drawPlayer(renderX, renderY, inp.angle, PLAYER_RADIUS, COLORS[playerIndex % COLORS.length], me.health, PLAYER_HP);
    ctx.restore();
  }

  if (inputHandler.consumePickup()) {
    socket.emit('pickup');
  }
}
```

Initialize prediction position on gameStart:
```js
socket.on('gameStart', () => {
  gameActive = true;
  lobby.style.display = 'none';
  // Initialize prediction from server state
  if (gameState) {
    const me = gameState.players.find(p => p.id === myId);
    if (me) {
      predictedX = me.x;
      predictedY = me.y;
    }
  }
});
```

- [ ] **Step 2: Verify and commit**

```bash
# Movement should feel instant (no waiting for server round-trip)
# Open Chrome DevTools Network tab, add artificial latency — movement still smooth
# Other players interpolate smoothly
```

```bash
git add public/main.js
git commit -m "feat: add client-side prediction with input buffer and server reconciliation"
```

---

### Task 9: Red Zone

**Files:**
- Modify: `server/GameRoom.js`
- Modify: `public/Renderer.js`

- [ ] **Step 1: Add zone logic to server tick**

Add to `GameRoom._tick()`, after bullet processing:

```js
// 4. Update zone
const elapsed = Date.now() - this.gameStartTime;
if (!this.zone.active && elapsed >= this.zone.activateAfterMs) {
  this.zone.active = true;
  this.zone.shrinkStartTime = Date.now();
}
if (this.zone.active) {
  const t = Math.min(1, (Date.now() - this.zone.shrinkStartTime) / this.zone.shrinkDuration);
  this.zone.currentRadius = this.zone.startRadius + (this.zone.finalRadius - this.zone.startRadius) * t;

  // Damage players outside zone
  this.players.forEach((player) => {
    if (!player.alive) return;
    const dx = player.x - this.zone.centerX;
    const dy = player.y - this.zone.centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > this.zone.currentRadius) {
      player.health -= this.zone.damagePerSecond * dt;
      if (player.health <= 0) {
        player.health = 0;
        player.alive = false;
        this._dropItems(player);
        this.io.to(this.id).emit('playerKilled', { victimId: player.id, killerId: null });
        this._checkWin();
      }
    }
  });
}
```

- [ ] **Step 2: Add zone rendering**

Add to `Renderer.js`:
```js
drawZone(zone, cameraX, cameraY, timestamp) {
  if (!zone || !zone.active) return;
  const { ctx, canvas, map } = this;
  const offsetX = canvas.width / 2 - cameraX;
  const offsetY = canvas.height / 2 - cameraY;

  ctx.save();
  // Red overlay outside safe circle
  ctx.fillStyle = 'rgba(200, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.rect(offsetX, offsetY, map.width, map.height);
  ctx.arc(zone.centerX + offsetX, zone.centerY + offsetY, zone.currentRadius, 0, Math.PI * 2, true);
  ctx.fill('evenodd');

  // Pulsing border
  const pulse = 0.6 + 0.4 * Math.sin(timestamp / 300);
  ctx.strokeStyle = `rgba(255, 50, 50, ${pulse})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(zone.centerX + offsetX, zone.centerY + offsetY, zone.currentRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
```

- [ ] **Step 3: Render zone in main.js**

After rendering players, before `ctx.restore()`:
```js
// Zone overlay
renderer.drawZone(gameState.zone, renderX, renderY, timestamp);
```

- [ ] **Step 4: Verify and commit**

```bash
# Start a game, wait 60 seconds — zone appears and shrinks
# Red overlay covers area outside safe circle
# Players outside zone take damage
```

```bash
git add server/GameRoom.js public/Renderer.js public/main.js
git commit -m "feat: add shrinking red zone with damage and pulsing border"
```

---

### Task 10: Grenades & Healing

**Files:**
- Create: `server/Grenade.js`
- Modify: `server/GameRoom.js`
- Modify: `public/InputHandler.js`
- Modify: `public/main.js`
- Modify: `public/Renderer.js`

- [ ] **Step 1: Create Grenade.js**

Create `server/Grenade.js`:
```js
let nextGrenadeId = 0;

export class Grenade {
  constructor(ownerId, x, y, angle) {
    this.id = `g${nextGrenadeId++}`;
    this.ownerId = ownerId;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.speed = 300;
    this.maxDistance = 350;
    this.distanceTraveled = 0;
    this.stopped = false;
    this.fuseTime = 2500; // ms
    this.createdAt = Date.now();
    this.explodeAt = Date.now() + this.fuseTime;
    this.explosionRadius = 80;
    this.centerDamage = 60;
    this.edgeDamage = 20;
    this.alive = true;
  }

  update(dt, walls) {
    if (this.stopped) return;

    const dx = Math.cos(this.angle) * this.speed * dt;
    const dy = Math.sin(this.angle) * this.speed * dt;
    const newX = this.x + dx;
    const newY = this.y + dy;

    // Wall collision — stop immediately
    for (const wall of walls) {
      if (newX >= wall.x && newX <= wall.x + wall.w &&
          newY >= wall.y && newY <= wall.y + wall.h) {
        this.stopped = true;
        return;
      }
    }

    this.x = newX;
    this.y = newY;
    this.distanceTraveled += this.speed * dt;

    if (this.distanceTraveled >= this.maxDistance) {
      this.stopped = true;
    }
  }

  shouldExplode() {
    return Date.now() >= this.explodeAt;
  }

  getDamageAt(dist) {
    if (dist > this.explosionRadius) return 0;
    const t = dist / this.explosionRadius;
    return this.centerDamage + (this.edgeDamage - this.centerDamage) * t;
  }
}
```

- [ ] **Step 2: Add grenade and healing logic to GameRoom**

Add import:
```js
import { Grenade } from './Grenade.js';
```

Add grenade handler in `addPlayer()`:
```js
socket.on('throwGrenade', () => {
  const p = this.players.get(socket.id);
  if (!p || !p.alive || !p.grenade || p.grenade.count <= 0 || this.state !== STATES.ACTIVE) return;
  p.grenade.count--;
  if (p.grenade.count <= 0) p.grenade = null;
  this.grenades.push(new Grenade(p.id, p.x, p.y, p.angle));
});

socket.on('useHeal', () => {
  const p = this.players.get(socket.id);
  if (!p || !p.alive || !p.heal || p.heal.count <= 0 || p.healing || this.state !== STATES.ACTIVE) return;
  if (p.health >= 100) return;
  p.healing = true;
  p.healingUntil = Date.now() + 1500; // 1.5s bandage
});
```

In `_tick()`, after zone update, add grenade and healing processing:

```js
// 5. Update grenades
for (let i = this.grenades.length - 1; i >= 0; i--) {
  const gren = this.grenades[i];
  gren.update(dt, this.allWalls);

  if (gren.shouldExplode()) {
    // Damage nearby players with LOS check
    this.players.forEach((player) => {
      if (!player.alive) return;
      const dx = player.x - gren.x;
      const dy = player.y - gren.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > gren.explosionRadius) return;

      // LOS check — raycast from grenade to player
      const hasLOS = this._hasLineOfSight(gren.x, gren.y, player.x, player.y);
      if (!hasLOS) return;

      const dmg = gren.getDamageAt(dist);
      player.health -= dmg;

      const victimSocket = this.io.sockets.sockets.get(player.id);
      if (victimSocket) {
        victimSocket.emit('playerHit', { damage: dmg, angle: Math.atan2(dy, dx) });
      }

      if (player.health <= 0) {
        player.health = 0;
        player.alive = false;
        const attacker = this.players.get(gren.ownerId);
        if (attacker) attacker.kills++;
        this._dropItems(player);
        this.io.to(this.id).emit('playerKilled', { victimId: player.id, killerId: gren.ownerId });
        this._checkWin();
      }
    });
    this.grenades.splice(i, 1);
  }
}

// 6. Update healing
this.players.forEach((player) => {
  if (!player.alive || !player.healing) return;
  if (Date.now() >= player.healingUntil) {
    player.health = Math.min(100, player.health + 25);
    player.healing = false;
    player.healingUntil = 0;
    if (player.heal) {
      player.heal.count--;
      if (player.heal.count <= 0) player.heal = null;
    }
  }
});
```

Add LOS helper to `GameRoom`:
```js
_hasLineOfSight(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(dist / 5);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = x1 + dx * t;
    const py = y1 + dy * t;
    for (const wall of this.allWalls) {
      if (px >= wall.x && px <= wall.x + wall.w &&
          py >= wall.y && py <= wall.y + wall.h) {
        return false;
      }
    }
  }
  return true;
}
```

- [ ] **Step 3: Add G and H keys to InputHandler**

Add to `InputHandler`:
```js
// In constructor
this._grenadePressed = false;
this._healPressed = false;

// In _onKey
case 'KeyG': if (down) this._grenadePressed = true; break;
case 'KeyH': if (down) this._healPressed = true; break;
```

```js
consumeGrenade() {
  if (this._grenadePressed) { this._grenadePressed = false; return true; }
  return false;
}
consumeHeal() {
  if (this._healPressed) { this._healPressed = false; return true; }
  return false;
}
```

- [ ] **Step 4: Add grenade rendering**

Add to `Renderer.js`:
```js
drawGrenades(grenades, cameraX, cameraY, timestamp) {
  const { ctx, canvas } = this;
  ctx.save();
  ctx.translate(canvas.width / 2 - cameraX, canvas.height / 2 - cameraY);
  for (const g of grenades) {
    // Grenade body
    ctx.fillStyle = '#ff8c42';
    ctx.beginPath();
    ctx.arc(g.x, g.y, 6, 0, Math.PI * 2);
    ctx.fill();
    // Fuse indicator — flash faster as it nears explosion
    const timeLeft = g.explodeAt - Date.now();
    const flashRate = Math.max(100, timeLeft / 3);
    if (Math.sin(timestamp / flashRate * Math.PI) > 0) {
      ctx.fillStyle = '#ff0';
      ctx.beginPath();
      ctx.arc(g.x, g.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
```

- [ ] **Step 5: Wire grenades and healing into main.js**

In the game loop:
```js
if (inputHandler.consumeGrenade()) socket.emit('throwGrenade');
if (inputHandler.consumeHeal()) socket.emit('useHeal');
```

Render grenades (alongside bullets):
```js
if (gameState.grenades.length > 0) {
  renderer.drawGrenades(gameState.grenades, renderX, renderY, timestamp);
}
```

- [ ] **Step 6: Verify and commit**

```bash
# Pick up grenades from loot
# Press G — grenade slides along ground, explodes after 2.5s
# Grenade damages nearby players, walls block damage
# Pick up bandages, press H — player heals after 1.5s
# Moving cancels healing
```

```bash
git add server/Grenade.js server/GameRoom.js public/InputHandler.js public/Renderer.js public/main.js
git commit -m "feat: add grenades with explosion damage and bandage healing"
```

---

## Chunk 4: HUD, Game Flow & Polish (Phases 10-12)

After this chunk: complete, playable game with full HUD, lobby flow, and visual effects.

### Task 11: HUD

**Files:**
- Create: `public/HUD.js`
- Modify: `public/main.js`

- [ ] **Step 1: Create HUD.js**

Create `public/HUD.js` with full HUD rendering — health bar, 3 inventory slots with canvas-drawn icons, zone timer, alive count, keybind hints. All icons drawn as geometric shapes (no emojis). See spec section "HUD Layout" for exact positioning.

Key elements:
- `drawHealthBar(ctx, x, y, health, maxHealth)` — green→yellow→red gradient
- `drawSlot(ctx, x, y, w, h, item, slotType, isActive)` — rounded rect with canvas-drawn icon
- `drawGunIcon(ctx, x, y, color)` — rectangle with barrel
- `drawGrenadeIcon(ctx, x, y)` — circle with fuse line
- `drawBandageIcon(ctx, x, y)` — cross shape
- `drawZoneTimer(ctx, x, y, gameElapsedMs, zoneActive)` — countdown or "Zone active"
- `draw(ctx, canvasW, canvasH, playerData, gameState)` — orchestrates all HUD elements

- [ ] **Step 2: Integrate HUD into main.js**

Import and call `hud.draw()` at the end of each frame after all world rendering.

- [ ] **Step 3: Verify and commit**

```bash
git add public/HUD.js public/main.js
git commit -m "feat: add full HUD with health, inventory slots, zone timer, and alive count"
```

---

### Task 12: Game Flow & Lobby Polish

**Files:**
- Modify: `public/index.html`
- Modify: `public/main.js`
- Modify: `server/GameRoom.js`

- [ ] **Step 1: Polish lobby UI**

Update lobby div in `index.html` with styled elements: animated title, player count, Start button that enables at 2+ players, "Waiting for players..." animation.

- [ ] **Step 2: Add countdown overlay**

Render 3-2-1 countdown centered on canvas during COUNTDOWN state.

- [ ] **Step 3: Polish death/win screens**

On `playerKilled` (victim is local): fade canvas to greyscale via CSS filter, show ELIMINATED with stats (survival time, kills). On `gameOver` (winner): show VICTORY. Both with Play Again button that reloads.

- [ ] **Step 4: Add rejoin flow**

On Play Again click: `location.reload()` for simplicity. Player reconnects fresh.

- [ ] **Step 5: Verify and commit**

```bash
# Full match lifecycle: lobby → countdown → game → death/victory → play again
git add public/index.html public/main.js server/GameRoom.js
git commit -m "feat: complete game flow with lobby, countdown, death/win screens"
```

---

### Task 13: Visual Effects & Polish

**Files:**
- Modify: `public/Renderer.js`
- Modify: `public/main.js`

- [ ] **Step 1: Add muzzle flash**

On shoot, draw small white circle at player position for 1 frame. Track `lastShotTick` per player in client state.

- [ ] **Step 2: Add bullet trails**

Draw faint line from bullet's previous position to current position.

- [ ] **Step 3: Add explosion ring**

On grenade explode, add expanding transparent circle animation that fades over 400ms. Track explosions in client-side array.

- [ ] **Step 4: Add hit direction flash**

On `playerHit` event, flash red on screen edge for 300ms. Use CSS or canvas overlay.

- [ ] **Step 5: Add zone damage pulse**

When local player is outside zone, pulse player circle white.

- [ ] **Step 6: Verify and commit**

```bash
# All visual effects visible during gameplay
git add public/Renderer.js public/main.js
git commit -m "feat: add visual effects — muzzle flash, bullet trails, explosions, hit flash"
```

---

### Task 14: Playtesting & Balance Pass

- [ ] **Step 1: Test with multiple browser tabs**

Open 3-4 tabs, play through a full match. Note any issues with:
- Movement feel
- Weapon balance (TTK, range)
- Zone timing
- Loot distribution
- Shadow casting performance
- Network feel

- [ ] **Step 2: Adjust constants as needed**

Tune values in `shared/constants.js` and `shared/weapons.js` based on playtesting.

- [ ] **Step 3: Final commit**

```bash
git add shared/constants.js shared/weapons.js
git commit -m "chore: balance pass and bug fixes from playtesting"
```

---

## Errata: Corrections From Plan Review

The following fixes MUST be applied during implementation. They correct bugs and gaps found during review.

### E1: Fix import paths in Task 3, Step 5

In `public/main.js`, use `/shared/` paths (not `./shared/`) from the start since shared modules are served via Express static middleware at `/shared`:

```js
import { PLAYER_RADIUS, PLAYER_SPEED, PLAYER_HP } from '/shared/constants.js';
import { resolveAgainstWalls } from '/shared/collision.js';
```

### E2: Add remote player interpolation (missing from plan)

In `public/main.js`, store the two most recent `gameState` snapshots and their timestamps. For remote players, lerp between `prevGameState` and `gameState` positions:

```js
// At module level
let snapshotTime = 0;
let prevSnapshotTime = 0;

// In the gameState handler
socket.on('gameState', (state) => {
  prevGameState = gameState;
  prevSnapshotTime = snapshotTime;
  gameState = state;
  snapshotTime = performance.now();
});

// In the render loop, for each remote player:
function getInterpolatedPlayer(playerId) {
  const curr = gameState.players.find(p => p.id === playerId);
  if (!prevGameState || !curr) return curr;
  const prev = prevGameState.players.find(p => p.id === playerId);
  if (!prev) return curr;

  const elapsed = performance.now() - snapshotTime;
  const interval = snapshotTime - prevSnapshotTime || 50;
  const t = Math.min(1, elapsed / interval);

  return {
    ...curr,
    x: prev.x + (curr.x - prev.x) * t,
    y: prev.y + (curr.y - prev.y) * t,
    angle: curr.angle // Don't interpolate angle
  };
}
```

Use `getInterpolatedPlayer(p.id)` when rendering remote players instead of raw `p.x, p.y`.

### E3: Filter bullets and grenades by visibility

In the render loop in `main.js`, filter bullets and grenades by the visibility polygon before rendering:

```js
const visibleBullets = gameState.bullets.filter(b =>
  shadowCaster.isVisible(b.x, b.y, visibility)
);
renderer.drawBullets(visibleBullets, renderX, renderY);

const visibleGrenades = gameState.grenades.filter(g =>
  shadowCaster.isVisible(g.x, g.y, visibility)
);
renderer.drawGrenades(visibleGrenades, renderX, renderY, timestamp);
```

### E4: Fix grenade/bandage pickup count bug (Task 7, Step 2)

When picking up a grenade or bandage ground item, respect the item's `count` field (death drops can have count > 1):

```js
// Replace: p.grenade = { type: nearest.type, count: 1 };
// With:
p.grenade = { type: nearest.type, count: nearest.count || 1 };

// Replace: p.grenade.count++;
// With:
p.grenade.count = Math.min(3, p.grenade.count + (nearest.count || 1));

// Same pattern for heal slot:
// Replace: p.heal = { type: nearest.type, count: 1 };
// With:
p.heal = { type: nearest.type, count: nearest.count || 1 };

// Replace: p.heal.count++;
// With:
p.heal.count = Math.min(5, p.heal.count + (nearest.count || 1));
```

### E5: Fix groundItems snapshot to include count

In `GameRoom._broadcastState()`, the groundItems mapping must include `count`:

```js
groundItems: this.groundItems.map(i => ({
  id: i.id, type: i.type, x: i.x, y: i.y,
  ammo: i.ammo, count: i.count
})),
```

In `_spawnLoot()`, add `count: 1` to grenade and bandage ground items:

```js
if (picked.slot === 'grenade' || picked.slot === 'heal') {
  item.count = 1;
}
```

### E6: Add kills to Player snapshot and gameOver payload

In `server/Player.js` `toSnapshot()`:
```js
toSnapshot() {
  return {
    // ...existing fields...
    kills: this.kills
  };
}
```

In `GameRoom._checkWin()`, include stats in gameOver:
```js
const winner = alive.length === 1 ? alive[0] : null;
this.io.to(this.id).emit('gameOver', {
  winnerId: winner ? winner.id : null,
  stats: winner ? { kills: winner.kills, survivalMs: Date.now() - this.gameStartTime } : null
});
```

### E7: Initialize zone.shrinkStartTime

In the zone object constructor in `GameRoom`, ensure `shrinkStartTime: null` is present (it is in the plan code but verify it isn't omitted during implementation).

### E8: Full HUD.js implementation (Task 11)

Task 11 needs complete code. Here is the full `public/HUD.js`:

```js
import { WEAPONS } from '/shared/weapons.js';

export class HUD {
  draw(ctx, canvasW, canvasH, me, gameState) {
    if (!me || !gameState) return;

    this._drawHealthBar(ctx, 20, canvasH - 50, 200, me.health, 100);
    this._drawInventorySlots(ctx, canvasW, canvasH, me);
    this._drawAliveCount(ctx, 20, 30, gameState.alivePlayers, gameState.players.length);
    this._drawZoneTimer(ctx, canvasW - 20, 30, gameState.gameElapsedMs, gameState.zone);
    this._drawKeybindHints(ctx, canvasW - 20, canvasH - 20);
  }

  _drawHealthBar(ctx, x, y, width, health, maxHealth) {
    const barH = 10;
    const pct = Math.max(0, health / maxHealth);
    // Background
    ctx.fillStyle = '#333';
    ctx.fillRect(x, y, width, barH);
    // Fill
    const color = pct > 0.5 ? '#50c878' : pct > 0.25 ? '#ffc832' : '#ff4444';
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width * pct, barH);
    // Border
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, barH);
    // Label
    ctx.fillStyle = '#ccc';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`HP ${Math.ceil(health)} / ${maxHealth}`, x, y - 4);
  }

  _drawInventorySlots(ctx, canvasW, canvasH, me) {
    const slotW = 80, slotH = 60, gap = 10;
    const totalW = slotW * 3 + gap * 2;
    const startX = (canvasW - totalW) / 2;
    const y = canvasH - slotH - 15;

    // Gun slot
    this._drawSlot(ctx, startX, y, slotW, slotH, me.gun, 'gun', true);
    // Grenade slot
    this._drawSlot(ctx, startX + slotW + gap, y, slotW, slotH, me.grenade, 'grenade', false);
    // Heal slot
    this._drawSlot(ctx, startX + (slotW + gap) * 2, y, slotW, slotH, me.heal, 'heal', false);
  }

  _drawSlot(ctx, x, y, w, h, item, slotType, isActive) {
    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeStyle = isActive ? 'rgba(74,158,255,0.6)' : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    this._roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.stroke();

    if (isActive && item) {
      ctx.shadowColor = 'rgba(74,158,255,0.3)';
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (!item) {
      // Empty slot
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#444';
      this._roundRect(ctx, x + 8, y + 8, w - 16, h - 16, 4);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    const cx = x + w / 2, cy = y + h / 2 - 6;

    if (slotType === 'gun') {
      const weapon = WEAPONS[item.type];
      const color = weapon ? weapon.color : '#aaa';
      this._drawGunIcon(ctx, cx, cy, color);
      // Name
      ctx.fillStyle = color;
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(weapon ? weapon.name : item.type, cx, cy + 16);
      // Ammo
      ctx.fillStyle = '#888';
      ctx.fillText(`${item.ammo}`, cx, cy + 26);
    } else if (slotType === 'grenade') {
      this._drawGrenadeIcon(ctx, cx, cy);
      ctx.fillStyle = '#ff8c42';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Frag', cx, cy + 16);
      ctx.fillStyle = '#888';
      ctx.fillText(`x ${item.count}`, cx, cy + 26);
    } else if (slotType === 'heal') {
      this._drawBandageIcon(ctx, cx, cy);
      ctx.fillStyle = '#50c878';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Bandage', cx, cy + 16);
      ctx.fillStyle = '#888';
      ctx.fillText(`x ${item.count}`, cx, cy + 26);
    }
  }

  _drawGunIcon(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x - 12, y - 3, 24, 6);
    ctx.fillRect(x + 10, y - 5, 6, 3);
  }

  _drawGrenadeIcon(ctx, x, y) {
    ctx.fillStyle = '#ff8c42';
    ctx.beginPath();
    ctx.arc(x, y + 2, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ff8c42';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y - 10);
    ctx.stroke();
  }

  _drawBandageIcon(ctx, x, y) {
    ctx.fillStyle = '#50c878';
    ctx.fillRect(x - 7, y - 2, 14, 4);
    ctx.fillRect(x - 2, y - 7, 4, 14);
  }

  _drawAliveCount(ctx, x, y, alive, total) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - 5, y - 15, 110, 24);
    ctx.fillStyle = '#888';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Alive: `, x, y);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${alive}`, x + 45, y);
    ctx.fillStyle = '#555';
    ctx.fillText(` / ${total}`, x + 55, y);
  }

  _drawZoneTimer(ctx, x, y, elapsedMs, zone) {
    ctx.textAlign = 'right';
    ctx.font = '13px sans-serif';

    if (!zone.active) {
      const remaining = Math.max(0, 60000 - elapsedMs);
      const sec = Math.ceil(remaining / 1000);
      const min = Math.floor(sec / 60);
      const s = sec % 60;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - 130, y - 15, 135, 24);
      ctx.fillStyle = '#ff6b6b';
      ctx.fillText(`Zone in: ${min}:${s.toString().padStart(2, '0')}`, x, y);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - 100, y - 15, 105, 24);
      const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 300);
      ctx.fillStyle = `rgba(255, 80, 80, ${pulse})`;
      ctx.fillText('Zone active', x, y);
    }
  }

  _drawKeybindHints(ctx, x, y) {
    ctx.textAlign = 'right';
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#444';
    ctx.fillText('E Pickup   G Grenade   H Heal', x, y);
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
```

### E9: Full visual effects code (Task 13)

Create a client-side effects tracker in `main.js`:

```js
// Effects state
const effects = {
  explosions: [],  // { x, y, startTime, duration: 400 }
  hitFlash: null,  // { angle, startTime, duration: 300 }
  prevBulletIds: new Set(),
  prevGrenadeIds: new Set()
};

// Detect new bullets for muzzle flash (compare bullet IDs between frames)
// Detect grenade removals for explosions (compare grenade IDs between frames)
socket.on('gameState', (state) => {
  // Track explosions: grenades that disappeared
  if (gameState) {
    const oldIds = new Set(gameState.grenades.map(g => g.id));
    const newIds = new Set(state.grenades.map(g => g.id));
    for (const [id] of oldIds) {
      if (!newIds.has(id)) {
        const old = gameState.grenades.find(g => g.id === id);
        if (old) effects.explosions.push({ x: old.x, y: old.y, startTime: performance.now(), duration: 400 });
      }
    }
  }
  // ... existing snapshot storage ...
});

socket.on('playerHit', (data) => {
  effects.hitFlash = { angle: data.angle, startTime: performance.now(), duration: 300 };
});
```

Rendering in `Renderer.js`:

```js
drawExplosions(explosions, cameraX, cameraY, now) {
  const { ctx, canvas } = this;
  ctx.save();
  ctx.translate(canvas.width / 2 - cameraX, canvas.height / 2 - cameraY);
  for (const exp of explosions) {
    const elapsed = now - exp.startTime;
    if (elapsed > exp.duration) continue;
    const t = elapsed / exp.duration;
    const radius = 80 * t;
    const alpha = 1 - t;
    ctx.strokeStyle = `rgba(255, 150, 50, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(exp.x, exp.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

drawHitFlash(ctx, canvasW, canvasH, hitFlash, now) {
  if (!hitFlash) return;
  const elapsed = now - hitFlash.startTime;
  if (elapsed > hitFlash.duration) return;
  const alpha = 0.4 * (1 - elapsed / hitFlash.duration);
  ctx.fillStyle = `rgba(255, 0, 0, ${alpha})`;
  ctx.fillRect(0, 0, canvasW, canvasH);
}
```

### E10: Full lobby and death/win screen code (Task 12)

Lobby countdown — render on canvas in the game loop when state is COUNTDOWN:

```js
// In main.js, track countdown state
let countdownEnd = null;

socket.on('countdown', (data) => {
  countdownEnd = Date.now() + data.seconds * 1000;
  lobbyStatus.textContent = '';
});

// In loop, if countdownEnd is set and game not active:
if (countdownEnd && !gameActive) {
  const remaining = Math.ceil((countdownEnd - Date.now()) / 1000);
  if (remaining > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 72px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(remaining.toString(), canvas.width / 2, canvas.height / 2);
  }
}
```

Death screen — apply greyscale CSS filter and show stats:

```js
socket.on('playerKilled', (data) => {
  if (data.victimId === myId) {
    gameActive = false;
    canvas.style.filter = 'grayscale(100%)';
    const survivalMs = gameState ? gameState.gameElapsedMs : 0;
    const myData = gameState.players.find(p => p.id === myId);
    const kills = myData ? myData.kills : 0;
    const sec = Math.floor(survivalMs / 1000);
    const overlay = document.getElementById('overlay');
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <h1 style="font-size:48px;color:#ff4444;letter-spacing:4px">ELIMINATED</h1>
      <p style="color:#aaa;margin:8px">Survived: ${Math.floor(sec/60)}m ${sec%60}s</p>
      <p style="color:#aaa;margin:8px">Kills: ${kills}</p>
      <button onclick="location.reload()" style="margin-top:20px;padding:12px 32px;font-size:18px;background:#4a9eff;color:#fff;border:none;border-radius:8px;cursor:pointer">Play Again</button>
    `;
  }
});
```
