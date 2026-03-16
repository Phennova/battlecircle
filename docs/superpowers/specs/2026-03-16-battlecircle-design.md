# BattleCircle — Design Specification

> Top-down 2D multiplayer battle royale with fog-of-war shadow casting

## Context & Goals

A web-based real-time multiplayer top-down 2D battle royale game. Players are circles that navigate a tiled map, loot buildings for weapons, and eliminate each other. The defining feature is fog-of-war via 2D visibility polygon shadow casting — enemies behind walls are invisible, creating tense ambush-and-explore gameplay.

**Primary goal:** Fun to play with friends (4-8 players). Not intended for large-scale hosting initially, but should be trivially deployable if it's good enough to expand.

**Deployment model:** Works on LAN out of the box (`npm run dev`, friends connect to host IP). Single `node server/index.js` with no external dependencies beyond Socket.IO makes future deployment to a VPS trivial.

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Client rendering | HTML5 Canvas (2D context) | Direct pixel control for game loop + shadows |
| Client framework | Vanilla JS (ES Modules) | No build step, fast iteration |
| Server | Node.js + Express | Simple HTTP + static file serving |
| Realtime | Socket.IO | Reliable WebSocket abstraction with rooms |
| Map format | JSON tile/object map | Human-editable, easy to parse |
| Build/run | `npm run dev` via nodemon | Auto-restart on server changes |

No bundler required. Client JS is served as ES modules directly from `/public`.

## Architecture

### Directory Structure

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
│   └── HUD.js             # HUD rendering (slots, health, ammo, zone timer)
├── package.json
└── README.md
```

### Key Design Decisions

1. **Server-authoritative physics** — Server runs all movement, collision, bullet, and damage logic at 20 ticks/sec. Client only renders.
2. **Client-side prediction for local player** — Client immediately applies movement input, then reconciles with server snapshots. Other players are interpolated between snapshots. This keeps movement feeling instant over the internet while the server stays authoritative.
3. **No build step** — ES modules served directly from /public. No webpack, no bundler.
4. **Fog of war is the core feature** — Shadow casting is built into the rendering pipeline from Phase 3 (not bolted on later). Every feature is developed and tested in the context of fog of war.
5. **Simple 3-slot inventory** — Gun, grenade, heal. Pick up to fill, swap to replace. No inventory management UI needed.
6. **No emojis** — All icons and visual elements are canvas-drawn geometric shapes. No Unicode emoji characters anywhere in the product.
7. **Server-side visibility filtering deferred** — Since this is for friends, we trust the client to hide shadowed enemies. Anti-cheat filtering can be added later if the game goes public.

### Data Flow

```
Client                              Server
──────                              ──────
InputHandler reads WASD/mouse
  → emit playerInput (every frame)  → GameRoom stores input state
                                    → Tick loop (50ms):
                                        1. Compute dt
                                        2. Move players (input × speed × dt)
                                        3. Resolve wall collisions
                                        4. Process shooting → create bullets
                                        5. Move bullets, check hits
                                        6. Update grenades
                                        7. Update healing timers
                                        8. Update zone (shrink, damage)
                                        9. Check win condition
  ← receive gameState (20×/sec)     ← Broadcast snapshot to all clients

Game.js processes snapshot:
  1. Apply client-side prediction
  2. Interpolate remote players
  3. Compute visibility polygon
  4. Renderer draws world + shadow
  5. HUD draws overlay
```

## Game Loop Detail

### Server Tick (20 ticks/sec — every 50ms)

1. **Compute dt** — time since last tick in seconds, clamped to max 100ms to prevent spiral-of-death
2. **Process player movement** — read input → compute velocity (normalize diagonal) → apply speed × dt → resolve circle-vs-AABB collisions against all walls
3. **Process shooting** — check fire rate cooldowns, create Bullet entities, decrement ammo
4. **Update bullets** — move by speed × dt, remove on wall hit / player hit (apply damage) / max range exceeded
5. **Update grenades** — move, stop on wall hit, explode after fuse timer (radius damage with LOS check)
6. **Update healing** — if heal timer complete: apply HP; if player moved/shot: cancel heal
7. **Update zone** — activate at 60s, shrink via lerp, damage players outside
8. **Check win condition** — if ≤ 1 player alive: emit gameOver
9. **Broadcast gameState** — full snapshot to all clients

### Client Frame (60fps via requestAnimationFrame)

1. **Read input** — WASD + mouse, emit playerInput to server
2. **Client-side prediction** — apply movement locally, store input + sequence number in buffer
3. **Reconcile with server** — on snapshot: discard processed inputs, re-apply remaining from server position, smooth-correct if diverged > 2px
4. **Interpolate other players** — lerp between two most recent snapshots
5. **Compute visibility polygon** — ShadowCaster processes wall segments within 600px
6. **Render** — floor → building floors → loot → bullets → grenades → visible players → local player → shadow mask → walls (on top) → zone overlay → HUD

## Map Design

### Specs

- **World size:** 2400 × 2400 units
- **Tile size:** 40 × 40
- **Grid:** 60 × 60 tiles
- **Buildings:** 6-8 varied sizes, scattered across map
- **Loot slots:** 1-3 per building (one "military" building with 3 slots, most have 1-2)
- **Spawn points:** 16 points distributed around map edges
- **Standalone cover:** Thin walls/objects in open areas between buildings
- **Outer boundary:** Thin walls around map perimeter

### Map Format (map.json)

```json
{
  "width": 2400,
  "height": 2400,
  "tileSize": 40,
  "spawnPoints": [{ "x": 120, "y": 120 }, ...],
  "walls": [{ "x": 400, "y": 400, "w": 200, "h": 20 }, ...],
  "buildings": [{
    "id": "building_1",
    "x": 300, "y": 300, "w": 240, "h": 180,
    "walls": [...],
    "doors": [{ "x": 380, "y": 300, "w": 40, "h": 20 }],
    "lootSlots": [{ "x": 340, "y": 340 }, { "x": 420, "y": 360 }]
  }]
}
```

- `walls` are axis-aligned rectangles used for collision and shadow casting
- `buildings` contain inner wall segments and door gaps
- `lootSlots` are positions where items spawn at game start

## Shadow Casting (Fog of War)

### Algorithm: 2D Visibility Polygon

Implemented in `ShadowCaster.js`. Runs every client frame.

**Input:** player position, array of wall segments (wall rects converted to 4 line segments each), max range (600px)

**Steps:**
1. Collect wall segments within 600px of player
2. Convert each wall rect to 4 line segments
3. Gather all unique endpoints
4. For each endpoint, compute angle from player
5. Cast 3 rays per endpoint: angle, angle - ε, angle + ε
6. Sort all rays by angle
7. For each ray, find nearest wall intersection (or max range boundary) using parametric ray-segment intersection
8. Collect hit points in angular order → this is the visibility polygon
9. Everything outside this polygon is in shadow

### Shadow Rendering

Uses an offscreen canvas to avoid blending issues:
1. Fill offscreen canvas with dark overlay (`rgba(0, 0, 0, 0.88)`)
2. Cut out visibility polygon using `destination-out` composite operation
3. Blit offscreen canvas onto main canvas
4. Draw walls on top (always visible as solid objects)

### Visibility Filtering

Enemies inside the shadow (outside the visibility polygon) are not rendered. This is checked client-side by testing if each remote player's position falls inside the visibility polygon.

### Performance

Only wall segments within 600px are processed. With ~50 total segments on the map, this reduces to ~15-25 per frame. No spatial partitioning needed at this map size.

## Combat System

### Initial Weapons (Phase 1)

| Weapon | Fire Rate | Damage | Range | Ammo | Bullet Speed | Role |
|---|---|---|---|---|---|---|
| Pistol | 2/s | 20 | 400px | 12 | 500 | Reliable starter. 5 shots to kill. |
| Shotgun | 0.8/s | 8×5 pellets | 250px | 5 | 450 | CQB. 40 damage if all pellets hit. Pairs with fog ambushes. |
| Rifle | 1.5/s | 35 | 700px | 10 | 800 | Mid-long range. 3 shots to kill. |

**Future weapons (post-launch):** SMG (10/s, 10dmg, spray), Sniper (0.4/s, 80dmg, long range)

### Shooting Pipeline

1. Client: mousedown → emit `shoot { angle }` to server
2. Server: validate (has gun, has ammo, cooldown elapsed)
3. Server: create Bullet entity at player position (shotgun: 5 pellets, ±0.15 rad spread)
4. Server: decrement ammo
5. Each tick: move bullet by speed × dt
6. Hit detection: circle-vs-circle for players, circle-vs-AABB for walls
7. On player hit: apply damage, remove bullet, check kill
8. On wall hit or max range: remove bullet

### Grenades

- **Frag Grenade:** press G to throw at 300px/s toward aim direction
- Stops on wall hit or at 350px travel distance
- 2.5s fuse timer
- Explosion: 80px radius, 60 damage at center → 20 at edge (linear falloff)
- Walls block explosion damage (LOS check from explosion center to each player)
- Stack size: 3

### Healing

- **Bandage:** press H to use, 1.5s channel time, heals 25 HP (capped at 100)
- Player cannot move or shoot while healing (server-enforced)
- Moving or shooting cancels the heal
- Stack size: 5
- **MedKit** (75 HP, 4s, 1 per slot) added with expanded weapon set

### Kill Flow

1. Player health ≤ 0 → mark `alive = false`
2. Drop all items at death position as ground loot
3. Emit `playerKilled { victimId, killerId }` to room
4. Check if 1 player remains → emit `gameOver { winnerId }`

## Items & Loot

### Inventory Model

Three slots, each holds one item type:

| Slot | Holds | Behavior |
|---|---|---|
| Gun | 1 weapon + ammo count | Pick up to equip, pick up another to swap (dropped gun keeps remaining ammo) |
| Grenade | 1 grenade type, stacks to 3 | Same type adds to stack, different type swaps |
| Heal | 1 heal type, stacks to 5 | Same type adds to stack, different type swaps |

All slots start empty. Players start unarmed.

### Loot Spawning

On game start, server rolls one random item per loot slot using weighted table:

| Item | Weight |
|---|---|
| Pistol | 30 |
| Shotgun | 15 |
| Rifle | 10 |
| Frag Grenade | 15 |
| Bandage | 20 |

### Pickup

- Client sends `pickup` when player presses E
- Server checks: any ground item within 40px of player?
- If matching slot is empty: equip
- If matching slot is occupied: swap (drop current item at player position)
- Grenades/bandages of same type: add to stack (up to max)

## Red Zone

### Zone State

```
centerX: 1200 (map center)
centerY: 1200
startRadius: ~1700 (covers full map)
finalRadius: 120 (tiny end circle)
activateAfterMs: 60000 (60 seconds — tuned for 4-8 players)
shrinkDuration: 120000 (120 seconds to fully close)
damagePerSecond: 8
```

### Shrink Logic

- Zone activates at 60s into the match
- Radius lerps linearly from startRadius to finalRadius over 120s
- Each tick: damage all players outside zone by 8 HP/s × dt
- Zone state included in every gameState broadcast

### Rendering

- Red semi-transparent overlay over everything outside the safe circle (even-odd fill rule)
- Pulsing red border ring on the circle edge (sinusoidal opacity animation)

## Game Flow

### Match State Machine

`WAITING → COUNTDOWN (3s) → ACTIVE → ENDED`

### Lobby (WAITING)

- All players auto-join the same room (no room codes)
- Game starts when: max players (8) reached, OR any player clicks Start with ≥ 2 players, OR 30s auto-timer with ≥ 2 players
- UI: dark background, game title, "Waiting for players..." with count

### Countdown

- 3-second countdown overlay
- Players see their spawn positions
- Loot spawned at all building loot slots

### Active

- Full gameplay: movement, combat, looting, zone
- Continues until ≤ 1 player alive

### Ended

- Winner: "VICTORY" screen with gold text, stats (survival time, kills)
- Eliminated players: "ELIMINATED" screen with red text, canvas fades to greyscale
- "Play Again" button → rejoin lobby

## HUD Layout

All elements drawn on canvas (screen-space, no camera transform). No emojis — all icons are canvas-drawn geometric shapes.

- **Top-left:** Alive player count ("Alive: 5 / 8")
- **Top-right:** Zone timer ("Zone in: 1:24" → "Zone active" with pulsing red)
- **Bottom-left:** Health bar (green → yellow → red gradient based on HP%)
- **Bottom-center:** 3 inventory slots (rounded rects with canvas-drawn item icons, ammo/count labels, active slot has bright border glow)
- **Bottom-right:** Keybind hints (E pickup, G grenade, H heal)
- **Hit indicator:** 300ms red flash on screen edge when damaged

### Item Icons (canvas-drawn)

- **Guns:** colored rectangle with barrel shape
- **Grenades:** circle with fuse line
- **Bandages:** cross/plus shape

## Network Protocol

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `playerInput` | `{ up, down, left, right, shooting, angle, seq }` | Continuous input state with sequence number |
| `shoot` | `{ angle }` | Fire gun |
| `throwGrenade` | `{ angle }` | Throw grenade |
| `useHeal` | `{}` | Use heal item |
| `pickup` | `{}` | Pick up nearest item |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `roomJoined` | `{ roomId, playerId, map }` | After join — includes full map data |
| `gameStart` | `{ spawnPositions }` | Countdown done, game starting |
| `gameState` | Full state snapshot | 20×/sec tick broadcast |
| `playerKilled` | `{ victimId, killerId }` | Kill feed entry |
| `gameOver` | `{ winnerId }` | Match ended |
| `playerHit` | `{ damage, angle }` | You were hit (for hit flash) |

### gameState Snapshot

```json
{
  "tick": 1042,
  "lastProcessedInput": { "<playerId>": 583 },
  "players": [{
    "id": "", "x": 0, "y": 0, "angle": 0,
    "health": 100, "alive": true,
    "gun": { "type": "rifle", "ammo": 8 },
    "grenade": { "type": "frag", "count": 2 },
    "heal": { "type": "bandage", "count": 3 },
    "healing": false
  }],
  "bullets": [{ "id": "", "x": 0, "y": 0, "angle": 0 }],
  "grenades": [{ "id": "", "x": 0, "y": 0, "explodeAt": 0 }],
  "groundItems": [{ "id": "", "type": "", "x": 0, "y": 0, "ammo": 0 }],
  "zone": { "active": true, "centerX": 1200, "centerY": 1200, "currentRadius": 800, "finalRadius": 120 },
  "gameElapsedMs": 45230,
  "alivePlayers": 6
}
```

Note: `lastProcessedInput` maps each player ID to the last input sequence number the server processed, enabling client-side prediction reconciliation.

## Visual Effects (Phase 12)

- **Muzzle flash:** small white circle at player position for 1 frame on shoot
- **Bullet trail:** faint line from previous to current bullet position
- **Explosion ring:** expanding transparent circle that fades out over 400ms
- **Hit particles:** small red dots flying outward on player hit (client-side cosmetic)
- **Zone damage pulse:** player circle flashes white when taking zone damage

## Key Algorithms

### Collision Resolution (Circle vs AABB)

```
For each wall rect:
  nearX = clamp(circle.x, rect.x, rect.x + rect.w)
  nearY = clamp(circle.y, rect.y, rect.y + rect.h)
  dx = circle.x - nearX
  dy = circle.y - nearY
  dist = sqrt(dx² + dy²)
  if dist < radius and dist > 0:
    overlap = radius - dist
    push circle out by (dx/dist * overlap, dy/dist * overlap)
```

### Ray-Segment Intersection (for shadow casting)

Standard parametric form with t and u parameters. Returns intersection point if t ≥ 0 and 0 ≤ u ≤ 1.

## Build Order (Identity-First)

| Phase | What | Key Files | Test |
|---|---|---|---|
| 1 | Scaffold & Static Server | index.js, index.html, main.js | Black canvas in browser |
| 2 | Map + Walls + Renderer | map.json, Renderer.js | See full map with buildings |
| **3** | **Local Player + Shadow Casting** | InputHandler.js, ShadowCaster.js, Game.js | **Move around with fog of war** |
| **4** | **Multiplayer + Fog of War** | GameRoom.js, Player.js | **Players appear/disappear around corners** |
| 5 | Shooting & Combat | Bullet.js | Shoot each other, health, kills |
| 6 | Loot System | loot logic in GameRoom.js | Find and pick up weapons |
| 7 | Client-Side Prediction | prediction in Game.js | Instant movement feel |
| 8 | Red Zone | zone in GameRoom.js | Zone shrinks, damages |
| 9 | Grenades & Healing | Grenade.js, heal logic | Throw grenades, heal |
| 10 | HUD | HUD.js | Full HUD with canvas icons |
| 11 | Game Flow & Lobby | lobby UI, state machine | Full match lifecycle |
| 12 | Polish & Effects | Renderer.js additions | Particles, flashes, balance |

**Natural resume points:** After Phase 3 (solo + shadows), After Phase 6 (multiplayer + loot + combat), After Phase 9 (all mechanics).

## Future Scope (Post-Launch)

- Expanded weapons: SMG, Sniper, MedKit
- Spectator mode after death
- Kill feed in HUD
- Minimap showing zone and player dots
- Doors that open/close
- Smoke grenades
- Player name tags / skin colors
- Post-game stats / leaderboard
- Server-side visibility filtering (anti-cheat)
- Deployment to VPS for internet play
