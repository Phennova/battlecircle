# BattleCircle — Claude Code Build Plan
> Top-down 2D multiplayer battle royale game

---

## Project Overview

A web-based, real-time multiplayer top-down 2D battle royale game. Players are circles that navigate a tiled map, loot buildings for weapons, and eliminate each other. Features include fog-of-war via shadow casting, a shrinking red zone, a persistent HUD, and multiple weapon types.

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Client rendering | HTML5 Canvas (2D context) | Direct pixel control for game loop + shadows |
| Client framework | Vanilla JS (ES Modules) | No build step, fast iteration |
| Server | Node.js + Express | Simple HTTP + static file serving |
| Realtime | Socket.IO | Reliable WebSocket abstraction with rooms |
| Map format | JSON tile/object map | Human-editable, easy to parse |
| Build/run | `npm run dev` via nodemon | Auto-restart on server changes |

**No bundler required.** Client JS is served as ES modules directly from `/public`.

---

## Directory Structure

```
battlecircle/
├── server/
│   ├── index.js           # Express + Socket.IO entry point
│   ├── GameRoom.js        # Server-side game state per lobby
│   ├── Player.js          # Server-side player model
│   ├── Bullet.js          # Server-side bullet simulation
│   ├── Grenade.js         # Server-side grenade simulation
│   └── map.json           # Authoritative map data
├── public/
│   ├── index.html         # Game shell + canvas
│   ├── main.js            # Client entry point — connects socket, starts loop
│   ├── Game.js            # Client game loop orchestrator
│   ├── Renderer.js        # All canvas drawing logic
│   ├── InputHandler.js    # Keyboard + mouse input
│   ├── ShadowCaster.js    # Fog-of-war shadow polygon builder
│   ├── HUD.js             # HUD rendering (slots, health, ammo, zone timer)
│   ├── SoundManager.js    # (optional) Audio cues
│   └── assets/
│       └── (any sprite sheets or sounds)
├── package.json
└── README.md
```

---

## Phase 1 — Project Scaffold & Server Setup

### Step 1.1 — Initialize project

```bash
mkdir battlecircle && cd battlecircle
npm init -y
npm install express socket.io
npm install --save-dev nodemon
```

Add to `package.json`:
```json
"scripts": {
  "start": "node server/index.js",
  "dev": "nodemon server/index.js"
}
```

### Step 1.2 — Basic Express + Socket.IO server (`server/index.js`)

- Serve `/public` as static files
- Create Socket.IO server on same HTTP instance
- On `connection`: log the socket ID
- On `disconnect`: log it
- Listen on port 3000

### Step 1.3 — Minimal HTML shell (`public/index.html`)

- One `<canvas id="game">` element, fullscreen via CSS (`width:100vw; height:100vh; display:block; background:#000`)
- Load `main.js` as `type="module"`
- A lobby overlay `<div id="lobby">` with a "Play" button that hides on game start
- A death/win screen `<div id="overlay">` hidden by default

---

## Phase 2 — Map Design & Server Authority

### Step 2.1 — Map format (`server/map.json`)

The map is a fixed-size grid. Recommended: **2400×2400 world units**, tile size **40×40**.

```json
{
  "width": 2400,
  "height": 2400,
  "tileSize": 40,
  "spawnEdgePoints": [
    { "x": 120, "y": 120 },
    { "x": 1200, "y": 20 },
    ...
  ],
  "walls": [
    { "x": 400, "y": 400, "w": 200, "h": 20 },
    ...
  ],
  "buildings": [
    {
      "id": "building_1",
      "x": 300, "y": 300, "w": 240, "h": 180,
      "walls": [...],
      "doors": [{ "x": 380, "y": 300, "w": 40, "h": 20, "open": false }],
      "lootSlots": [
        { "x": 340, "y": 340 },
        { "x": 420, "y": 360 }
      ]
    }
  ],
  "decorations": []
}
```

**Implementation notes:**
- `walls` are axis-aligned rectangles used for collision and shadow casting
- `buildings` contain inner wall segments and door gaps
- `lootSlots` are positions where items can spawn at game start
- `spawnEdgePoints` are 16–24 points distributed around map edges

### Step 2.2 — Map layout (design at least 6 buildings)

Hand-craft the map JSON with:
- 6–8 buildings of varying sizes scattered across the map
- Thin outer boundary walls
- Some standalone walls/cover objects scattered around the open areas
- Clear open corridors between buildings

Buildings should be placed so no two share the same loot density — one "military" building has 3 loot slots, most have 1–2.

---

## Phase 3 — Game Rooms & Lobby

### Step 3.1 — `GameRoom.js` (server-side state machine)

States: `WAITING → COUNTDOWN (3s) → ACTIVE → ENDED`

Responsibilities:
- Store player map: `{ socketId → Player }`
- Store bullets array, grenades array, loot items array
- Run a server-side game loop at 20 ticks/second (`setInterval`, 50ms)
- On `ACTIVE`: run physics tick, bullet movement, grenade timers, zone damage
- Emit `gameState` snapshot to all clients in room each tick
- Track zone state (see Phase 7)

### Step 3.2 — Lobby flow (server side)

On socket `connection`:
- Find a room in `WAITING` state with < `MAX_PLAYERS` (suggest 8–12)
- Add player to that room, or create new room
- Emit `roomJoined { roomId, playerId }` back to client

On `startGame` event (auto-trigger when room reaches minimum players, or after 30s with ≥ 2):
- Transition room to `COUNTDOWN`
- After 3s, transition to `ACTIVE`
- Spawn loot items at all `lootSlots` in map

---

## Phase 4 — Player Model

### Step 4.1 — `server/Player.js`

```js
class Player {
  constructor(id, spawnX, spawnY) {
    this.id = id;
    this.x = spawnX;
    this.y = spawnY;
    this.radius = 18;           // collision radius
    this.angle = 0;             // facing direction (radians, toward mouse)
    this.vx = 0;
    this.vy = 0;
    this.speed = 180;           // pixels per second
    this.health = 100;
    this.alive = true;

    // Inventory
    this.gun = null;            // { type, ammo } or null
    this.grenade = null;        // { type, count } or null
    this.heal = null;           // { type, count } or null

    // Input state (updated by client messages)
    this.input = {
      up: false, down: false, left: false, right: false,
      shooting: false, angle: 0
    };
  }
}
```

### Step 4.2 — Server movement update (inside game loop tick)

```
dt = time since last tick (seconds)
for each alive player:
  dx = (input.right - input.left)
  dy = (input.down - input.up)
  normalize if diagonal
  newX = player.x + dx * speed * dt
  newY = player.y + dy * speed * dt
  resolve collision against all wall rects
  player.x = resolvedX
  player.y = resolvedY
  player.angle = input.angle
```

Collision resolution: AABB circle-vs-rectangle. For each wall rect, find closest point on rect to circle center, push circle out if distance < radius.

### Step 4.3 — Client input sending

In `InputHandler.js`:
- Track `W/A/S/D` keydown/up state
- Track `mousemove` → compute angle from canvas center to mouse position
- Track `mousedown/up` for shooting
- Every frame, if input changed since last send, emit `playerInput { up, down, left, right, shooting, angle }` to server

---

## Phase 5 — Rendering Pipeline (Client)

### Step 5.1 — `Game.js` — client game loop

```js
// requestAnimationFrame loop
function loop(timestamp) {
  dt = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;

  // Latest state comes from socket 'gameState' event — stored in this.state
  renderer.draw(this.state, myPlayerId);
  hud.draw(this.state, myPlayerId);
  requestAnimationFrame(loop);
}
```

Client does **no physics** — it only renders the last server snapshot.

### Step 5.2 — `Renderer.js` — layered draw calls

Draw order (back to front):
1. **Background** — fill map with floor color/texture
2. **Floor decorations** — optional tile variation
3. **Loot items** — small icon circles with color by type
4. **Building floors** — filled rects (slightly lighter than outside)
5. **Bullets** — small colored dots
6. **Grenades** — small orange circles
7. **Other players** (those visible — outside shadow)
8. **Local player** — always drawn on top of shadow
9. **Shadow mask** (see Phase 6)
10. **Walls** — drawn above shadow so they are always visible as solid objects
11. **HUD** (separate canvas layer or drawn last)

Camera: translate canvas so local player is always centered.

```js
ctx.save();
ctx.translate(canvas.width/2 - player.x, canvas.height/2 - player.y);
// ... draw world ...
ctx.restore();
```

### Step 5.3 — Player rendering

- Circle with radius 18, colored by team/player index
- Direction indicator: a short line from center in facing direction
- Health bar above: small rect, red/green

---

## Phase 6 — Shadow Casting (Fog of War)

This is the most complex visual feature. The goal: cast shadows from all wall segments as if the player is a point light source. Any area in shadow is darkened, and enemy players inside shadow are hidden.

### Step 6.1 — Algorithm: 2D Visibility Polygon

In `ShadowCaster.js`, implement the **Visibility/Raycasting Polygon** algorithm:

**Input:** player position, array of wall segments (converted from wall rects to 4 line segments each)

**Steps:**
1. Collect all wall segment endpoints visible within a max range (e.g. 600px)
2. For each endpoint, compute angle from player
3. For each angle, also cast a ray at `angle - ε` and `angle + ε`
4. Sort all angles
5. For each angle, fire a ray from player origin and find the nearest intersection with any wall segment (or max range boundary)
6. Collect hit points in angular order — this forms the **visibility polygon**
7. Everything **outside** this polygon is in shadow

**Resources to implement:**
- The canonical reference is Amit Patel's "2D Visibility" article — the algorithm is well-documented
- Ray-segment intersection: standard parametric form (`t` and `u` parameters)
- Output: array of `{x, y}` points forming the lit polygon

### Step 6.2 — Rendering the shadow

```js
function drawShadow(ctx, visibilityPolygon, playerX, playerY, canvasW, canvasH) {
  // 1. Draw full-canvas dark overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
  ctx.fillRect(worldLeft, worldTop, mapWidth, mapHeight);

  // 2. Cut out the visibility polygon using 'destination-out'
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(visibilityPolygon[0].x, visibilityPolygon[0].y);
  for (let i = 1; i < visibilityPolygon.length; i++) {
    ctx.lineTo(visibilityPolygon[i].x, visibilityPolygon[i].y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}
```

Use an **offscreen canvas** for the shadow layer to avoid blending issues:
```js
const shadowCanvas = document.createElement('canvas');
const shadowCtx = shadowCanvas.getContext('2d');
// ... draw shadow onto shadowCanvas ...
// Then blit it onto main canvas:
ctx.drawImage(shadowCanvas, 0, 0);
```

### Step 6.3 — Server-side visibility (anti-cheat)

The server must **not send positions of players in shadow** to the client. In the game state snapshot:
- Before sending, compute which players are visible to each client using the same wall geometry
- Only include `players` array entries that are visible to that specific client
- This prevents cheating via packet sniffing

Server-side visibility check (simplified):
- For each other player, raycast from local player toward them
- If ray hits a wall before reaching that player, exclude them from snapshot

---

## Phase 7 — Items & Loot System

### Step 7.1 — Item types

**Guns:**

| Name | Fire Rate (shots/s) | Damage | Range (px) | Ammo Cap | Bullet Speed |
|---|---|---|---|---|---|
| Pistol | 2 | 20 | 400 | 12 | 500 |
| Shotgun | 0.8 | 8×5 pellets | 250 | 5 | 450 |
| SMG | 10 | 10 | 300 | 30 | 600 |
| Rifle | 1.5 | 35 | 700 | 10 | 800 |
| Sniper | 0.4 | 80 | 1200 | 5 | 1200 |

**Grenades:**
- `FragGrenade`: thrown, explodes after 2.5s, 60 damage in 80px radius, 3 per slot
- `SmokeGrenade`: creates a 120px radius smoke cloud for 6 seconds (blocks vision similarly to a wall) — optional stretch goal

**Heals:**
- `Bandage`: heals 25 HP, 1.5s use time, stackable to 5
- `MedKit`: heals 75 HP, 4s use time, 1 per slot

### Step 7.2 — Ground items (loot)

On game start, server randomly picks one item per loot slot from a weighted table:
```js
const lootTable = [
  { item: 'pistol', weight: 30 },
  { item: 'shotgun', weight: 15 },
  { item: 'smg', weight: 15 },
  { item: 'rifle', weight: 10 },
  { item: 'sniper', weight: 5 },
  { item: 'fragGrenade', weight: 15 },
  { item: 'bandage', weight: 20 },
  { item: 'medkit', weight: 10 },
];
```

Each ground item has `{ id, type, x, y, ammo (for guns) }`.

### Step 7.3 — Pickup logic

Client sends `pickup` event. Server:
- Checks if any ground item is within 40px of player
- If it's a gun and player has no gun: equip it, remove from ground
- If it's a gun and player has a gun: swap — drop current gun (with remaining ammo) at player position, equip new gun
- Same logic for grenade slot and heal slot
- Emit updated player state

### Step 7.4 — Dropping items

When a player dies:
- Drop their gun (with remaining ammo) at their position as a ground item
- Drop their grenade and heal items
- Emit `itemDropped` events to all clients

---

## Phase 8 — Combat

### Step 8.1 — Shooting

Client: on `mousedown` (or held for auto-fire weapons), emit `shoot { angle }`.

Server: on `shoot`:
- Check if player has a gun, has ammo, and fire rate cooldown has elapsed
- Create bullet: `{ id, ownerId, x: player.x, y: player.y, angle, speed, damage, range, distanceTraveled: 0 }`
- Decrement ammo by 1
- For shotgun: create 5 bullets with angle spread of ±0.15 radians

Each server tick, for each bullet:
```
bullet.x += cos(angle) * speed * dt
bullet.y += sin(angle) * speed * dt
bullet.distanceTraveled += speed * dt

if bullet.distanceTraveled >= bullet.range: remove bullet

for each alive player (not owner):
  if distance(bullet, player) < player.radius:
    player.health -= bullet.damage
    remove bullet
    if player.health <= 0: kill(player)

for each wall rect:
  if bullet intersects wall: remove bullet
```

### Step 8.2 — Grenades

Client: press `G` to throw grenade. Emit `throwGrenade { angle }`.

Server:
- Creates grenade at player position, moving at 300px/s in `angle` direction
- Grenade stops when it hits a wall or travels 350px
- After 2.5s, explode: damage all players within `explosionRadius` (80px)
  - Damage = 60 at center, falloff to 20 at edge
  - Check line-of-sight for damage (walls block explosion)
- Remove grenade from state

### Step 8.3 — Healing

Client: press `H` to use heal item. Emit `useHeal`.

Server:
- Validate player has heal item
- Start a `healingUntil = now + healDuration` timer on player
- Player cannot move or shoot while healing (enforce server-side)
- After `healDuration`, add HP (capped at 100), decrement heal count

### Step 8.4 — Kill & elimination

When `player.health <= 0`:
- Mark `player.alive = false`
- Emit `playerKilled { victimId, killerId }` to room
- Drop items at death position
- Check win condition: if only 1 player alive, emit `gameOver { winnerId }`

---

## Phase 9 — Red Zone

### Step 9.1 — Zone state (server)

```js
const zone = {
  active: false,
  centerX: mapWidth / 2,
  centerY: mapHeight / 2,
  currentRadius: Math.max(mapWidth, mapHeight),  // starts off-screen
  finalRadius: 120,   // small safe circle in center
  shrinkStartTime: null,
  shrinkDuration: 120_000,  // 120 seconds to fully close
  damagePerSecond: 8,
  activateAfterMs: 100_000  // 100 seconds into game
};
```

### Step 9.2 — Zone shrink logic (server tick)

```js
if (!zone.active && gameElapsedMs >= zone.activateAfterMs) {
  zone.active = true;
  zone.shrinkStartTime = now;
}

if (zone.active) {
  const t = Math.min(1, (now - zone.shrinkStartTime) / zone.shrinkDuration);
  zone.currentRadius = lerp(zone.startRadius, zone.finalRadius, t);

  // Damage players outside zone
  for (const player of alivePlayers) {
    const dist = distance(player, zone.center);
    if (dist > zone.currentRadius) {
      player.health -= zone.damagePerSecond * dt;
      if (player.health <= 0) kill(player);
    }
  }
}
```

Include `zone` in every `gameState` broadcast.

### Step 9.3 — Zone rendering (client)

In `Renderer.js`:
```js
// Draw red zone overlay — everything outside the safe circle
ctx.save();
ctx.fillStyle = 'rgba(200, 0, 0, 0.30)';
ctx.beginPath();
// Full map rect
ctx.rect(0, 0, mapWidth, mapHeight);
// Cut out the safe circle (even-odd fill rule)
ctx.arc(zone.centerX, zone.centerY, zone.currentRadius, 0, Math.PI * 2, true);
ctx.fill('evenodd');
ctx.restore();

// Draw pulsing red border ring
ctx.strokeStyle = `rgba(255, 50, 50, ${0.6 + 0.4 * Math.sin(Date.now() / 300)})`;
ctx.lineWidth = 3;
ctx.beginPath();
ctx.arc(zone.centerX, zone.centerY, zone.currentRadius, 0, Math.PI * 2);
ctx.stroke();
```

---

## Phase 10 — HUD

### Step 10.1 — `HUD.js` layout

Draw on top of world canvas (after all world rendering). Use screen-space coordinates (no camera transform).

Layout (bottom of screen):

```
[ GUN SLOT ]  [ GRENADE SLOT ]  [ HEAL SLOT ]
  [ammo: 24]      [x 3]            [x 2]
```

Far left: **Health bar** (green → yellow → red based on HP %)

Top right: **Zone timer** — "Zone closes in: 1:40" counting down to 100s mark, then "Zone active" with pulsing red text

Top left: **Players alive** counter

### Step 10.2 — Slot rendering

Each slot is a rounded rectangle:
- Empty: dark grey with dashed border
- Occupied: slightly lighter background, item icon (colored circle/shape representing the item), item name label
- Active/selected: bright outline glow
- For gun: ammo count below: `[■■■■□□□□]` pip display or `24 / 30` text

### Step 10.3 — Hit indicator

On `playerHit` event (server emits when local player is hit):
- Flash screen edge red for 300ms
- Scale/direction of flash indicates hit direction (optional)

---

## Phase 11 — Network Protocol (complete Socket.IO events)

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `playerInput` | `{ up, down, left, right, shooting, angle }` | Continuous input state |
| `shoot` | `{ angle }` | Fire gun |
| `throwGrenade` | `{ angle }` | Throw grenade |
| `useHeal` | `{}` | Use heal item |
| `pickup` | `{}` | Pick up nearest item |
| `dropGun` | `{}` | Drop current gun |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `roomJoined` | `{ roomId, playerId, map }` | After join — includes full map data |
| `gameStart` | `{ spawnPositions }` | Countdown done, game starting |
| `gameState` | Full state snapshot | 20×/sec tick broadcast |
| `playerKilled` | `{ victimId, killerId }` | Kill feed entry |
| `itemDropped` | `{ item }` | Item landed on ground |
| `gameOver` | `{ winnerId }` | Match ended |
| `playerHit` | `{ damage, angle }` | You were hit (for screen flash) |

### `gameState` snapshot structure

```js
{
  tick: 1042,
  players: [
    {
      id, x, y, angle, health, alive,
      gun: { type, ammo } | null,
      grenade: { type, count } | null,
      heal: { type, count } | null,
      healing: bool
    }
  ],
  bullets: [{ id, x, y, angle }],
  grenades: [{ id, x, y, explodeAt }],
  groundItems: [{ id, type, x, y, ammo }],
  zone: { active, centerX, centerY, currentRadius, finalRadius },
  gameElapsedMs: 45230,
  alivePlayers: 6
}
```

---

## Phase 12 — Polish & UX

### Step 12.1 — Lobby / menu screen

- Dark background with animated noise/grain texture using CSS
- Game title in bold display font
- "Waiting for players..." with animated dots
- Player count display: `3 / 8 players`
- Auto-start when max reached, or manual trigger

### Step 12.2 — Death screen

On `gameOver` or `playerKilled` (for local player):
- Canvas fades to greyscale (CSS filter)
- Overlay shows: "ELIMINATED" or "VICTORY" (if winner)
- Stats: survival time, kills
- "Play Again" button — socket emits `rejoinLobby`

### Step 12.3 — Visual effects

- **Muzzle flash**: small white circle at player position for 1 frame on shoot
- **Bullet trail**: faint line behind fast bullets (draw at prev+current position)
- **Explosion ring**: on grenade explode, draw expanding transparent circle that fades out over 400ms
- **Blood/hit particles**: small red dots that fly outward on player hit (purely cosmetic, client-side)
- **Zone damage pulse**: player circle flashes white when taking zone damage

### Step 12.4 — Audio (optional, implement last)

Use Web Audio API:
- Gunshot sound per weapon type (different pitch/character)
- Grenade bounce, grenade explosion
- Footstep sound (subtle, distance-based)
- Zone damage buzz
- Kill notification sound

---

## Phase 13 — Build Order for Claude Code

Follow this exact order to keep the build stable at every step:

1. **Scaffold** — `npm init`, file structure, `server/index.js` serving static files, `index.html` with canvas
2. **Map rendering** — parse `map.json` on client, draw walls and buildings (no server yet)
3. **Local player** — single-player movement, collision vs walls, keyboard input, camera pan
4. **Server connection** — Socket.IO join/lobby flow, server echoes player position
5. **Multiplayer movement** — server `GameRoom` tick loop, `playerInput` → server → `gameState` → render all players
6. **Loot system** — spawn ground items, pickup events, HUD slots update
7. **Shooting** — bullets created server-side, client renders them, hit detection, health bars
8. **Grenades** — throw, bounce, explode, damage
9. **Healing** — pickup, use, timer, HP restore
10. **Shadow casting** — implement `ShadowCaster.js`, offscreen canvas blend, server visibility filtering
11. **Red zone** — timer, shrink, damage, rendering
12. **HUD polish** — complete all HUD elements, zone timer, kill feed
13. **Game flow** — lobby, countdown, death/win screens, rejoin
14. **Visual effects** — particles, flashes, explosion rings
15. **Playtesting & balance** — adjust gun stats, zone timing, spawn points

---

## Key Implementation Notes for Claude Code

### Collision resolution (circle vs AABB)
```js
function resolveCircleAABB(cx, cy, radius, rect) {
  const nearX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const nearY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nearX;
  const dy = cy - nearY;
  const dist = Math.sqrt(dx*dx + dy*dy);
  if (dist < radius && dist > 0) {
    const overlap = radius - dist;
    return { x: cx + (dx/dist)*overlap, y: cy + (dy/dist)*overlap };
  }
  return { x: cx, y: cy };
}
```

### Ray-segment intersection (for shadow casting and server visibility)
```js
function raySegmentIntersect(rx, ry, rdx, rdy, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const denom = rdx * dy - rdy * dx;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((ax - rx) * dy - (ay - ry) * dx) / denom;
  const u = ((ax - rx) * rdy - (ay - ry) * rdx) / denom;
  if (t >= 0 && u >= 0 && u <= 1) return { t, x: rx + t*rdx, y: ry + t*rdy };
  return null;
}
```

### Server tick rate vs. client render rate
- Server: 20 ticks/sec (`setInterval` 50ms) — authoritative physics
- Client: 60fps via `requestAnimationFrame` — render only, no physics
- Client interpolates between the two most recent state snapshots for smooth rendering:
  ```js
  // Store last two snapshots with timestamps
  // lerp all positions based on (now - lastSnapshotTime) / tickInterval
  ```

### Preventing input lag feel
Send `playerInput` every frame (not just on change) — it's small and prevents the feeling of "sticky" controls.

---

## Stretch Goals (after core is working)

- [ ] Spectator mode after death — follow a living player
- [ ] Kill feed in HUD (scrolling list of recent kills)
- [ ] Minimap in corner showing zone and player dots
- [ ] Doors that can be opened/closed (toggle-able wall segments)
- [ ] Smoke grenades
- [ ] Different player skin colors / player name tags
- [ ] Leaderboard / post-game stats screen
- [ ] Mobile touch controls overlay

---

## Notes on Scope

This is a significant project. The core game (Phases 1–11) represents roughly **2,000–3,500 lines of code** across client and server. If Claude Code runs into token/context issues mid-session, the best resume points are:

- After Phase 5 (movement working, can test client rendering)
- After Phase 7 (loot system working, can test item flow)
- After Phase 10 (all game mechanics implemented, then polish)

Keep each file focused and well-commented. The separation of `GameRoom.js` (server state), `Renderer.js` (drawing), and `ShadowCaster.js` (fog of war) from the main loop is intentional — it makes each system independently debuggable.
