# BattleCircle Features V2 — Design Specification

> Extended weapons, kill feed, spectator mode, smoke grenades, player names, leaderboard

## Overview

A batch of features to add depth and polish to the core BattleCircle game. All features are mostly independent and build on the existing codebase.

## 1. Player Names

### Name Generation
- Server maintains a pool of ~50 funny two-word names (e.g. "AggressivePotato", "SneakyWaffle", "ChaosGoblin", "TurboPickle")
- On join, server assigns a random unused name from the pool
- Name stored on the Player object and included in `toSnapshot()`

### Rendering
- Name displayed above each player's health bar in small white text (11px, center-aligned)
- Only visible when the player is inside the local player's visibility polygon
- Local player's name also shown above their circle

### Network
- `gameState.players[]` gains a `name` field
- `playerKilled` event gains `killerName` and `victimName` fields

## 2. Kill Feed

### Display
- Top-right corner of screen, below zone timer
- Shows last 5 kill entries, newest on top
- Each entry fades out after 5 seconds
- Format: `KillerName [weapon/cause] VictimName`
- Zone kills: `VictimName died to the zone`
- Grenade kills: show grenade as cause

### Data
- Server includes `cause` in `playerKilled` event: the weapon type string (e.g. "pistol", "shotgun", "rifle", "smg", "sniper", "frag") or "zone" for zone deaths, or "disconnect" for disconnects
- Kill feed format for special cases:
  - Zone: `VictimName died to the zone` (no killer)
  - Disconnect: `VictimName disconnected` (no killer)
  - Grenade: `KillerName [frag] VictimName`
- Client maintains a `killFeed` array, pushes new entries on `playerKilled`, removes entries older than 5 seconds each frame

### Rendering
- Each entry is a single line of text
- Killer name in white, victim name in red, cause in grey between them
- Background: semi-transparent dark rect behind each line for readability

## 3. Extended Weapons

### SMG
| Stat | Value |
|---|---|
| Fire Rate | 10/s |
| Damage | 10 |
| Range | 300px |
| Magazine | 30 |
| Reload Time | 1200ms |
| Bullet Speed | 600 |
| Spread | Random ±0.08 rad per bullet |
| Color | #e8e82e (yellow) |

- Each bullet gets a random angle offset within ±0.08 radians from aim direction (NOT the shotgun's evenly-distributed pellet spread — this is random per individual bullet)
- Implementation note: SMG has `pellets: 1` and `spread: 0.08`. The shooting code must apply random spread for single-pellet weapons with nonzero spread: `angle += (Math.random() - 0.5) * 2 * weapon.spread`. This differs from the shotgun's `pellets > 1` even-distribution path.
- High rate of fire + random spread = spray weapon, strong close range, weak at distance
- Added to loot table with weight 10

### Sniper
| Stat | Value |
|---|---|
| Fire Rate | 0.4/s (but see mechanic below) |
| Damage | 80 |
| Range | 1200px |
| Magazine | 5 |
| Reload Time | 2000ms |
| Bullet Speed | 1200 |
| Spread | 0 |
| Color | #8b4513 (brown) |

**Unique scope mechanic:**
- When sniper is equipped, holding spacebar does NOT fire. Instead it **zooms** — vision range extends from 600px to 1000px over 300ms (smooth lerp)
- Releasing spacebar fires one shot and vision snaps back to 600px
- If spacebar is tapped quickly (held < 100ms), fires without zooming (hip-fire)
- Other guns are unaffected — they still fire normally on spacebar hold

**Sniper input protocol:**
- The sniper mechanic is handled client-side. `InputHandler` tracks spacebar hold start time.
- When the equipped weapon is a sniper:
  - Client does NOT set `shooting: true` while spacebar is held. Instead it tracks `scopeStartTime`.
  - On spacebar release, client emits a new `sniperFire { angle }` event to the server.
  - Server handles `sniperFire` like a single shot: checks has sniper, has ammo, cooldown elapsed. Creates one bullet.
- `ShadowCaster.computeVisibility()` must accept a `visionRange` parameter instead of using the hardcoded constant. Client passes 600-1000 based on scope state. Performance at 1000px is acceptable — the map has ~70 total wall segments and filtering by range keeps it under 40 even at max scope.

**Tracer rounds:**
- Sniper bullets leave a visible tracer line from the fire position to the current bullet position
- Tracer rendered as a bright line that fades over 500ms after the bullet is gone
- Tracers are rendered as simple lines clipped to the screen — no polygon clipping needed. If the origin is off-screen but the bullet is visible, the line just extends off-screen (canvas clips it naturally).
- Tracer data: bullet snapshot gains `originX, originY` fields for sniper bullets only

### New Ammo Types
| Ammo Type | For Weapon | Per Pickup | Ground Color | Ground Shape |
|---|---|---|---|---|
| SMG Ammo | SMG | 20 rounds | #e8e82e (yellow) | Small triangle |
| Sniper Ammo | Sniper | 5 rounds | #8b4513 (brown) | Small circle with dot |

- Auto-collected on walk-over like existing ammo
- Added to loot table: SMG ammo weight 10, Sniper ammo weight 8

### MedKit
- Added to heal slot alongside bandages (swap on pickup, same slot)
- 75 HP heal, 4 second channel time, max stack: 1 (picking up another when you have one is ignored)
- Added to loot table with weight 6
- HUD shows "MedKit" label with a red cross icon (vs bandage's green cross)

### Updated Loot Table Weights (complete replacement — supersedes all previous tables)
| Item | Weight |
|---|---|
| Pistol | 16 |
| Shotgun | 12 |
| Rifle | 10 |
| SMG | 10 |
| Sniper | 6 |
| Frag Grenade | 10 |
| Smoke Grenade | 8 |
| Bandage | 12 |
| MedKit | 6 |
| Pistol Ammo | 10 |
| Shotgun Ammo | 9 |
| Rifle Ammo | 9 |
| SMG Ammo | 10 |
| Sniper Ammo | 8 |

### Held Weapon Visuals
- SMG: compact body with extended magazine hanging below
- Sniper: very long barrel with bipod detail and scope on top

### Ground Item Visuals
- SMG: yellow-ringed circle, compact body with magazine shape
- Sniper: brown-ringed circle, long barrel with scope silhouette

## 4. Healing Rework

Applies to ALL heal items (bandage and medkit):

- Press H to start healing. Once started, **cannot be cancelled**.
- During heal channel:
  - Movement speed reduced to **30%** (54px/s instead of 180px/s)
  - Cannot shoot (spacebar ignored)
  - Cannot reload (R ignored)
  - Cannot throw grenades (G ignored)
  - Cannot pick up items (E ignored)
  - CAN still aim with mouse (angle updates)
- Heal completes after full channel time:
  - Bandage: 1.5s → +25 HP (cap 100)
  - MedKit: 4.0s → +75 HP (cap 100)
- Server enforces all restrictions. Client shows "HEALING..." indicator.

**Changes from current behavior:**
- Currently: moving or shooting cancels the heal
- New: healing is uncancellable, player moves at 30% speed
- Reloading is unchanged — still cancelled by movement (reloading is a shorter commitment and should remain cancellable)

### ammoReserve Extension
- `Player.ammoReserve` must be extended to `{ pistol: 0, shotgun: 0, rifle: 0, smg: 0, sniper: 0 }`
- HUD ammo reserves display must show all 5 types
- `_dropItems` must drop all 5 ammo types on death

## 5. Smoke Grenades

### Behavior
- Shares grenade slot with frags — carry one type, swap on pickup (same as current grenade slot logic)
- Thrown with G key, same physics as frags: 300px/s, stops on wall hit or 350px distance
- **No fuse delay** — smoke activates immediately when grenade stops
- Creates a 120px radius smoke cloud at the stop position
- Smoke lasts 6 seconds, then fades out over 1 additional second (7s total from activation to gone)
- Smoke does no damage

### Visibility Blocking
- Smoke cloud is treated as a **circular vision blocker** for the shadow casting algorithm
- Implementation: when computing visibility polygon, add wall segments approximating the smoke circle (12-sided polygon inscribed in the 120px radius circle, converted to 12 line segments). `ShadowCaster` gets an `addTemporaryBlockers(smokes)` method that appends these segments before computing visibility and removes them after.
- **"Inside smoke" definition:** player center is within the 120px radius of any active smoke cloud
- **Players inside smoke:** vision range reduced to **40px** (pass 40 as visionRange to computeVisibility). They can see a tiny area around themselves but nothing beyond. The smoke polygon segments still block vision normally — they just can barely see past the edge.
- **Players outside smoke:** smoke polygon blocks line of sight like a wall. They cannot see players on the other side.
- Multiple overlapping smoke clouds are independent — each adds its own 12-sided polygon. They don't merge.

### Rendering
- Animated semi-transparent grey cloud with slow swirling motion
- Multiple overlapping circles at slightly different positions, animated with sin/cos offsets
- Opacity: starts at 0.6, stays steady for 6 seconds, fades to 0 over the last 1 second
- Color: `rgba(180, 180, 180, opacity)` with slight color variation per sub-circle

### Network
- `gameState` gains a `smokes` array: `[{ id, x, y, activatedAt, duration: 7000 }]`
- Server adds smoke to array when grenade stops, removes after 7 seconds
- Client handles rendering and vision blocking locally based on smoke positions

### Loot
- `smoke` type in grenade slot, weight 8 in loot table
- Ground item: grey circle with cloud-like swirl icon

## 6. Spectator Mode

### Flow
1. Player dies → 2-second death overlay ("ELIMINATED" + stats)
2. After 2 seconds, overlay shrinks to a small banner and spectator mode activates
3. Client enters spectator state: follows a living player

### Camera
- Camera centers on the spectated player's position
- Shadow casting runs from spectated player's position (see their fog of war)
- All rendering is from the spectated player's perspective

### Controls
- **Left/Right arrow keys** (or clicking arrows on screen): cycle between living players
- **Space**: exit spectator, return to death screen with Play Again button
- If the player being spectated dies, auto-switch to next living player

### HUD in Spectator
- Most HUD elements hidden (no inventory, no health bar, no ammo reserves)
- Shown: alive count (top-left), "Spectating: [PlayerName]" (bottom-center), navigation hints (bottom)
- Small "Play Again" button in top-right corner

### When Game Ends
- If spectating when game ends, show the victory/leaderboard screen for all players

### Implementation
- Primarily client-side. No new server events needed — the client already receives `gameState` with all players.
- Key client-side changes required:
  - Do NOT set `gameActive = false` on death. Instead set a `dead` flag. The game loop must keep running to receive `gameState` and render the spectated view.
  - Remove the `canvas.style.filter = 'grayscale(100%)'` on death (spectator should see normal colors).
  - Dismiss the ELIMINATED overlay after 2 seconds and switch to spectator rendering.
- Client stores `spectating: true` and `spectateTargetId` state
- Game loop uses spectated player's position instead of predicted position for camera and shadow casting

### HUD: Grenade Slot Display
- When carrying frags: show frag icon with "Frag" label
- When carrying smokes: show smoke cloud icon (grey swirl) with "Smoke" label
- Read `grenade.type` from player state to determine which to display

## 7. Leaderboard (End Screen)

### Data Tracking (Server)
- `Player` gains: `placement` (number, set when eliminated), `damageDealt` (running total)
- When a player dies: `player.placement = currentAlivePlayers + 1` (so last to die = 2nd, winner = 1st)
- When a player deals damage (bullet hit, grenade hit): `attacker.damageDealt += damage`
- **Disconnected players:** set placement before deleting from the players map. Store eliminated player data in a separate `finishedPlayers` array on GameRoom so standings survive disconnection.
- `gameOver` event includes `standings` array: all players (including disconnected) sorted by placement

### `gameOver` Event Update
```json
{
  "winnerId": "...",
  "standings": [
    { "name": "AggressivePotato", "placement": 1, "kills": 3, "damageDealt": 280 },
    { "name": "SneakyWaffle", "placement": 2, "kills": 1, "damageDealt": 120 },
    ...
  ]
}
```

### Rendering
- Shown on the end screen (VICTORY or ELIMINATED), below the personal stats
- Table format with columns: #, Name, Kills, Damage
- Winner's row highlighted in gold
- Local player's row highlighted with a subtle blue glow

## Build Order

1. Player names (server name pool, snapshot, render above players)
2. Kill feed (cause in playerKilled, HUD feed renderer)
3. SMG & Sniper (weapons.js, ammo types, sniper scope mechanic, tracers)
4. MedKit + healing rework (new item, uncancellable heal, slow movement)
5. Smoke grenades (new grenade type, smoke cloud vision blocking)
6. Spectator mode (client-side, follow living players)
7. Leaderboard (server tracking, end screen table)

## Files Affected

### New Files
- None — all changes are additions to existing files

### Modified Files
- `shared/weapons.js` — add SMG, Sniper definitions and new ammo types
- `server/Player.js` — add name, placement, damageDealt fields
- `server/GameRoom.js` — name assignment, loot table update, healing rework, smoke logic, kill cause tracking, leaderboard data
- `server/Grenade.js` — support smoke type (no damage, instant activation)
- `public/Renderer.js` — player name rendering, smoke cloud rendering, sniper tracer, SMG/sniper held weapon and ground item visuals
- `public/HUD.js` — kill feed, spectator HUD, leaderboard end screen
- `public/main.js` — sniper scope mechanic, spectator mode state, smoke vision blocking integration
- `public/ShadowCaster.js` — method to add temporary circular blockers (smoke clouds)
- `public/InputHandler.js` — track spacebar hold duration for sniper
