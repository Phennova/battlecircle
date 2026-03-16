# Capture the Flag — Design Specification

> 3v3 team mode with flag capture, hold timers, class-based loadouts

## Mode Config

- Mode ID: `ctf_3v3`
- 6 players, 2 teams of 3
- Respawn enabled (3 second timer)
- No shrinking zone
- Win condition: first team to accumulate 180 seconds (3 minutes) of flag hold time

## Map

- Same 2400x2400 procedurally generated map
- **No buildings** — open field
- 12-16 standalone barriers for cover (more than normal modes)
- Map divided at x=1200 — left half is Blue territory, right half is Red territory
- Floor tint: blue side `rgba(40,60,120,0.15)` overlay, red side `rgba(120,40,40,0.15)` overlay
- Territory divider: thin dashed white line at x=1200, visible on map and minimap

### Flag Zones

- Blue flag zone: 200x200 area centered at (600, 1200)
- Red flag zone: 200x200 area centered at (1800, 1200)
- Rendered as highlighted square with dashed border in team color
- Each zone contains one flag (rendered as a colored triangle/pennant icon)

## Flag Mechanics

### States

Each flag has three states:

| State | Meaning | Timer runs? |
|---|---|---|
| `home` | Flag is in its own team's zone | No |
| `carried` | An enemy player is carrying the flag | No |
| `held` | Flag is in the capturing team's zone | Yes — counts toward that team's win |

### Flow

1. Flag starts `home` in its team's zone
2. Enemy player walks within 30px of the flag in the zone — auto-pickup, flag state becomes `carried`, player becomes carrier
3. Carrier runs back across the midline (x=1200) into their own territory
4. Flag instantly teleports to the carrier's team flag zone, state becomes `held`
5. While `held`, the capturing team's hold timer counts up each tick
6. Enemy team can go to the flag zone, walk within 30px to grab it — state becomes `carried` again, timer pauses
7. First team to 180 seconds cumulative hold time wins

### Flag on Carrier Death

- Flag teleports back to the flag's **original team's zone** (the team it belongs to)
- State resets to `home`
- Hold timer for the capturing team pauses (does not reset — cumulative)

### Flag on Carrier Disconnect

- Same as death — flag returns home

## Respawn & Class System

### Respawn Flow

1. Player dies
2. 3-second death overlay with class selection screen
3. Player picks a class (or keeps current selection)
4. Player respawns near teammates with chosen loadout

### Classes

| Class | Gun | Grenades | Heal |
|---|---|---|---|
| Rusher | SMG | Frag x2 | Bandage x3 |
| Assault | Rifle | Frag x2 | Bandage x3 |
| Breacher | Shotgun | Smoke x2 | MedKit x1 |
| Marksman | Sniper | Smoke x2 | Bandage x3 |

### Ammo

- Infinite ammo reserve (always 999 for all types) — no ammo pickups
- Must still reload (magazine empties, press R)
- No ground loot spawns in CTF

## Flag Carrier Visuals

### Glowing Border

- Carrier's player circle gets a pulsing gold/yellow glow border
- `rgba(255, 215, 0, alpha)` with alpha oscillating 0.4-0.8 via sine wave

### Minimap

- Flag carrier shown as a bright gold dot on everyone's minimap regardless of team or fog of war
- Flag zones shown as colored squares on minimap

### Directional Arrow

- All players see a small arrow at the edge of their screen pointing toward the flag carrier
- Arrow is colored to match the carrier's team (blue or red)
- Only shown when carrier is off-screen
- Arrow hugs the screen edge, rotates to point toward carrier position

## HUD Additions

### Flag Status Bar (top center)

```
Blue Flag: HOME          Red Flag: HELD by SneakyWaffle
[====--------] 1:24      [------------] 0:00
```

- Shows each flag's current state (HOME / CARRIED by Name / HELD)
- Progress bar under each showing cumulative hold time (fills to 3:00)
- Blue flag info on the left, red flag info on the right

### No Zone Timer

- Zone timer hidden in CTF (no zone)

### No Alive Counter

- Replaced by flag status — players always respawn so alive count is irrelevant

## Server State

### Flag Object

```js
{
  team: 'blue', // which team this flag belongs to
  state: 'home', // 'home' | 'carried' | 'held'
  carrierId: null, // socket ID of carrier (when carried)
  holdTime: 0, // cumulative seconds the enemy has held this flag
  holdingTeam: null, // which team is holding this flag (0 or 1)
  zoneX: 600, // flag zone center X
  zoneY: 1200 // flag zone center Y
}
```

### Tick Processing

1. For each flag in `held` state: increment `holdTime` by dt for the holding team
2. Check win: if either team's captured flag `holdTime >= 180`, that team wins
3. For each flag in `carried` state: check if carrier crossed midline into own territory — if so, teleport flag to carrier's zone, state → `held`

### Flag Pickup (in tick or on proximity)

- Each tick, check if any alive enemy player is within 30px of a flag that is `home` or `held`
- If so: set flag state to `carried`, set `carrierId`
- A player can only carry one flag at a time (shouldn't matter in 2-flag CTF but enforce anyway)

### gameState Broadcast Additions

```js
flags: [
  { team: 'blue', state: 'home', carrierId: null, holdTime: 0, holdingTeam: null, zoneX: 600, zoneY: 1200 },
  { team: 'red', state: 'carried', carrierId: 'abc123', holdTime: 45.2, holdingTeam: 0, zoneX: 1800, zoneY: 1200 }
],
ctfTimers: [42.5, 0] // [blue team hold time, red team hold time]
```

## Map Generator Changes

- When mode is CTF: skip building generation, increase barrier count to 12-16
- Barriers should be distributed across both halves (6-8 per side)
- Flag zones must not overlap with barriers (validate during generation)
- Spawn points: blue team spawns on left half, red team spawns on right half

## gameModes.js Addition

```js
ctf_3v3: {
  name: 'Capture the Flag 3v3',
  description: 'Capture and hold the enemy flag',
  minPlayers: 6,
  maxPlayers: 6,
  teams: true,
  teamSize: 3,
  teamCount: 2,
  respawn: true,
  scoreToWin: null, // uses holdTime instead
  hasZone: false,
  respawnTime: 3000,
  ctf: true,
  holdTimeToWin: 180
}
```

## Files Affected

- `shared/gameModes.js` — add CTF mode config
- `server/GameRoom.js` — flag state, flag tick logic, class spawning, CTF win condition, carrier death handling
- `server/mapGenerator.js` — CTF map variant (no buildings, more barriers, flag zones)
- `public/index.html` — add CTF mode button to homepage
- `public/main.js` — class select UI on respawn, flag carrier arrow, flag pickup rendering, territory tint, CTF HUD
- `public/Renderer.js` — flag zone rendering, territory tint, flag icon, carrier glow, territory divider line
- `public/HUD.js` — flag status bars, hold timer progress, directional carrier arrow, CTF minimap (flag zones + carrier dot)
