# Bot AI System — Design Specification

> Intelligent server-side bots with behavior priority system, hybrid pathfinding, contextual combat, game mode coordination, and arcade mode variants

## Overview

Server-side AI bots that behave like competent human players. Bots use the same Player, Bullet, Grenade, and game systems as humans. They have the same fog of war limitations — they can only "see" what's in their visibility polygon, no cheating.

Each bot has a **priority evaluator** that rescores all behaviors every tick and executes the highest-priority one. Bots have randomized weapon preferences for personality variation but share the same intelligence.

## Arcade Mode Variants

Every existing game mode gets an arcade version where one human player joins and all other slots are auto-filled with bots:

| Mode | Arcade Variant | Slots |
|---|---|---|
| Battle Royale | Arcade BR | 1 human + 7 bots |
| TDM 2v2 | Arcade TDM 2v2 | 1 human + 3 bots |
| TDM 3v3 | Arcade TDM 3v3 | 1 human + 5 bots |
| TDM 4v4 | Arcade TDM 4v4 | 1 human + 7 bots |
| CTF 3v3 | Arcade CTF 3v3 | 1 human + 5 bots |

- Arcade modes appear on the homepage as a separate section below PvP modes
- When the human joins, all bot slots fill immediately — no waiting
- Game starts as soon as the human readies up
- In team modes, bots are evenly distributed. Human picks their team, bots fill both sides.
- Bots get random funny names from the same name pool as human players, prefixed with nothing (no [BOT] tag — they should feel like real players)

### gameModes.js additions

Each arcade mode mirrors its PvP counterpart but with:
```
arcade: true,
minPlayers: 1,
maxPlayers: 1, // only 1 human
botCount: N   // auto-fill this many bots
```

## Behavior Priority System

Every tick, the bot scores all behaviors and executes the highest-scoring one. Priorities are dynamic — base priority adjusts based on context.

### Priority Table

| Base Priority | Behavior | Triggers | Dynamic Adjustments |
|---|---|---|---|
| **110** | **Zone: Stay Safe** | In red zone OR zone shrinking and bot is near edge (BR only) | Always #1 in BR. Pathfinding marks red zone as impassable. If caught in red zone, overrides everything — path inward immediately. |
| 100 | **Flee & Heal** | HP < 30% and has heal item | Path behind nearest cover relative to enemy, then heal. If no heals found within 8 seconds, drops to 0 (stop running, fight). |
| 95 | **Flee & Find Heals** | HP < 30% and NO heal item | Search for ground heal items while fleeing. Drops to 0 after 10 seconds (accept fate, fight). |
| 95 | **Loot: Weapon (unarmed)** | Bot has no gun at all | Grab nearest gun regardless of preference. |
| 92 | **Swap Weapon (desperate)** | In combat, magazine empty, reserve ammo 0, no matching ammo nearby | Look for any ground weapon within ~200px and grab it. If none found, use grenades or rush enemy. |
| 90 | **Reload (urgent)** | In combat, magazine empty, has reserve ammo | Step 1: path behind nearest cover (break line of sight). Step 2: once behind cover, start reload. If no cover within ~150px, reload while strafing. If enemy pushing toward cover, cancel reload and swap weapon or throw grenade. |
| 85 | **Throw Grenade** | Enemy visible, has grenades, and: enemy behind cover OR enemies clustered OR enemy in doorway | Frags: aim at wall near enemy (break cover or splash damage). Smokes: throw at own feet for escape or flag approach cover. Won't throw frags at close range (self-damage awareness). |
| 80 | **Combat: Engage** | Enemy visible within weapon range | +15 if HP > 70% and good weapon. -30 if HP < 25% (flee instead). -20 if magazine < 3 rounds (reload first). When enemy spotted during another task, combat recalculates instantly — if bot has high HP + ammo, combat jumps above current task; if low HP or out of ammo, stays on flee/reload. |
| 70 | **Dodge Threat** | Grenade nearby OR sniper line detected OR shrapnel incoming | Sprint perpendicular to the threat direction. |
| 60 | **CTF: Grab Flag** | Assigned attacker role, enemy flag is home/held in enemy zone | Path to enemy flag zone. Throw smoke on approach for cover. |
| 55 | **CTF: Return Flag** | Bot is carrying enemy flag | Top priority when carrying — beeline to own territory across midline. |
| 50 | **CTF: Defend Zone** | Assigned defender role | Patrol near own flag zone, intercept enemies who enter. |
| 45 | **Hunt Enemy** | No enemies visible, game mode requires kills (TDM/BR) | Move toward last known enemy positions or high-traffic areas. |
| 40 | **Reload (safe)** | Magazine < 30%, no enemies nearby (no enemies visible for 3+ seconds) | Reload immediately in place — already safe. |
| 38 | **Swap Weapon (upgrade)** | Not in combat, better weapon visible on ground | Evaluates weapon tier × personal preference weight. Walks to it and picks up. |
| 35 | **Loot: Weapon** | Has a gun but it's low tier relative to preference | Path to preferred weapon type if visible. |
| 30 | **Loot: Ammo** | Reserve ammo low for equipped weapon's ammo type | Path to matching ammo on ground. |
| 25 | **Loot: Heal** | HP < 70%, no heal items, heal item visible nearby | Grab heal items opportunistically. |
| 20 | **Zone: Move Inward** | Zone will shrink soon and bot is in outer 30% of safe area (BR only) | Pre-position toward center before zone forces it. |
| 10 | **Patrol** | Nothing else to do | Roam toward unexplored/unvisited areas of the map. |

### Key Rules

- **Never reload while exposed to an enemy** unless there is literally no other option (no cover, no weapon to swap, no grenades). In that desperate case, reload while strafing.
- **Zone is king in BR**: pathfinding grid marks red zone cells as impassable. Bot always routes inside safe area.
- **Enemy spotted during non-combat task**: combat priority recalculates instantly based on HP, ammo, and weapon status. High HP + ammo = engage. Low HP or dry = flee/reload.
- **Completely out of everything** (no gun, no ammo, no grenades, no heals): rush enemies recklessly (nothing to lose).
- **Healing and reloading** both require getting to safety first — path behind cover, then channel.

## Weapon Preferences

Each bot rolls random preference weights on spawn:

```js
preferredWeapons: {
  pistol: random(0.2, 0.5),
  shotgun: random(0.3, 0.9),
  rifle: random(0.3, 0.9),
  smg: random(0.3, 0.9),
  sniper: random(0.2, 0.7)
}
```

### Weapon tier evaluation (contextual)

Base tier scores:
- Open areas: Sniper 5 > Rifle 4 > SMG 3 > Shotgun 2 > Pistol 1
- Inside buildings (bot center inside building bounding box): Shotgun 5 > SMG 4 > Rifle 3 > Pistol 2 > Sniper 1

Final score = base tier × preference weight. Bot picks up/keeps the weapon with the highest final score.

When unarmed (no gun at all), preference is ignored — grab the nearest gun.

Preference also affects loot pathing: bot that prefers shotguns will path toward shotgun ammo and shotgun ground items over others.

### Ammo awareness

Each tick, bot checks:
1. Can I reload? (reserve > 0 for my weapon's ammo type) → yes: reload when safe
2. If not: is there matching ammo on ground within vision? → go get it
3. If not: is there a better weapon on ground? → go swap
4. If not and in combat: weapon is dead weight, switch to grenades or flee
5. Completely out of everything: rush recklessly

## Navigation — Hybrid Pathfinding

### Grid layer (long-distance)

- Navigation grid overlaid on 2400×2400 map — 40px cell size = 60×60 grid (3600 cells)
- Each cell marked walkable or blocked based on wall collision
- Grid rebuilt when walls are destroyed (shrapnel) or doors open/close
- A* pathfinding from current cell to goal cell
- In BR mode, red zone cells marked impassable — bots never path outside safe area
- Path recalculates every 0.5 seconds or immediately when goal changes

### Raycasting layer (short-range)

- Within 80px of next waypoint or near walls, bot uses raycasts to fine-tune movement
- Cast 5 rays in forward arc — if any hit wall within player radius + margin, steer away
- Handles sliding along walls, navigating through doorways, corner avoidance
- If bot hasn't moved more than 5px in 2 seconds, trigger "stuck recovery" — pick random perpendicular direction and move for 0.5s

### Goal-based pathing

- Each behavior sets a **goal position** (enemy location, loot item, flag zone, zone center, etc.)
- Navigation system pathfinds to that goal
- Bot moves along A* path, switching to ray steering when close to walls
- Smooth movement along path — not jerky cell-to-cell snapping

### Door interaction

- When a bot's A* path goes through a cell that contains a closed door, the bot opens the door (emits `pickup` event when within interaction range)
- When fleeing, bot closes doors behind itself to slow pursuers (emits `pickup` on the door after passing through)

### Cover awareness

- **In combat, not pushing**: prefer positions near walls (within 30px of a wall but with line of sight to enemy)
- **Fleeing**: path to nearest wall to break line of sight from enemy
- **Healing/reloading**: find wall to hide behind relative to last known enemy position
- **Cover evaluation**: for each nearby wall segment, check if it blocks line of sight from the threat — pick the nearest one that does

## Combat AI

### Aiming

- Bot aims at target's **predicted position** — leads the shot based on target velocity and bullet travel time
- Aim has slight random offset: ±0.02-0.06 rad depending on distance (farther = more offset)
- Aim tracks smoothly — doesn't snap instantly, rotates at ~8 rad/sec toward target (human-like tracking speed)
- When scoping with sniper, aim tightens (offset halved)

### Engagement decisions

Based on HP, ammo, weapon, and position:

| Decision | Conditions | Action |
|---|---|---|
| **Push** | HP > 60%, good weapon, enemy is hurt or reloading | Move toward enemy while shooting |
| **Hold** | HP 30-60%, decent position near cover | Stay put, shoot from current position |
| **Retreat** | HP < 30% OR out of ammo | Break line of sight, find cover, heal/reload |
| **Flank** | Enemy behind cover, bot has full HP | Path around the wall using A* to get a different angle with line of sight |

### Shooting behavior

Bots don't hold fire continuously — fire in bursts matching weapon type:

| Weapon | Firing pattern |
|---|---|
| SMG | 8-15 round bursts, 200ms pauses between bursts |
| Rifle | Single shots at natural fire rate |
| Shotgun | Fire when within 200px, close distance first |
| Sniper | Scope for 0.5-1s, fire, reposition to new cover |
| Pistol | Controlled 2-3 shot bursts |

Bot stops shooting when magazine hits 0 — immediately triggers reload behavior (find cover first).

### Grenade usage

| Situation | Grenade | Action |
|---|---|---|
| Enemy behind cover | Frag | Aim at the wall near them to break it or splash |
| Enemy in doorway | Frag | Area denial, throw at the doorway |
| Multiple enemies grouped | Frag | Throw at center of group |
| Fleeing, need cover | Smoke | Throw at own feet |
| CTF flag approach | Smoke | Throw at enemy flag zone before entering |
| Enemy too close | None | Don't throw frags at close range (self-damage) |

### Threat assessment

Bot tracks all visible enemies and prioritizes:

1. **Enemies shooting at the bot** (immediate threat — highest priority)
2. **Nearest enemy** (proximity danger)
3. **Low-HP enemies** (easy kill opportunity)
4. **Flag carriers** (CTF priority target)

Switches target if a higher-priority threat appears mid-combat.

## Awareness Systems

### Vision (same fog of war as players)

- Bots use the same visibility polygon system as human players
- Can only detect enemies, items, and map features within their vision polygon
- Cannot see through walls, smoke, or outside vision range
- Visibility computed server-side each tick for each bot

### Sound awareness

- Bots "hear" gunshots within 400px even through walls
- Hearing adds a soft investigation marker at the sound source (lower priority than visual contact)
- Does not reveal exact enemy position — just a direction to investigate

### Memory

- When a bot loses sight of an enemy, it remembers the last known position for 5 seconds
- Bot will path to that position to investigate
- After 5 seconds, memory fades — enemy is "lost"
- Memory resets if the enemy is spotted again

### Death learning

- If a bot dies at a specific location, other bots on the same team deprioritize that area for 30 seconds
- Simple "danger zone" radius of 200px around the death location
- Bots will path around danger zones if possible (adds cost to those A* grid cells)

## Game Mode Coordination

### Battle Royale

| Game Phase | Determined by | Bot behavior |
|---|---|---|
| Early game | Zone is large (> 70% of original radius) | Prioritize looting: weapon → ammo → heals. Path to nearest building, loot it, move to next. |
| Mid game | Zone shrinking (30-70%) | Shift toward hunting. Move toward map center, use cover, engage enemies encountered. |
| Late game | Zone small (< 30%) | Play aggressively, push remaining players. Less looting, more fighting. |

- Bots avoid open ground when possible, path between cover points
- Zone always takes priority over everything else

### TDM (Team Deathmatch — Elimination)

- No looting phase — focus on finding and eliminating enemies
- Spawn → immediately path toward enemy team's side of map
- After a kill, assess: heal if needed, otherwise push next enemy
- Track which teammates are alive — if bot is last alive, play more cautiously (hold position near cover, don't push)
- If teammates are fighting nearby (gunshots heard), path toward the fight to assist

### CTF (Capture the Flag) — Team Role Assignment

On game start, bots on each team dynamically assign roles:

| Role | Count | Behavior |
|---|---|---|
| **Attacker** | 1 | Goes for enemy flag. Throws smoke on approach. |
| **Defender** | 1 | Stays near own flag zone. Intercepts enemies who enter. |
| **Support** | 1 | Follows attacker or responds to threats flexibly. |

Roles reassign on events:

| Event | Reassignment |
|---|---|
| Attacker dies | Support becomes Attacker |
| Enemy grabs our flag | Defender chases carrier, Support defends zone |
| Bot carrying flag | All living teammates become Escort (path between carrier and enemies) |
| Flag returned home | Roles reset to default assignment |

CTF-specific: bots have infinite ammo in CTF, so all loot behaviors are disabled. Focus purely on flag objectives and combat.

### Cross-Mode Intelligence

- **Sound awareness**: hear gunshots within 400px through walls → investigate
- **Memory**: remember last known enemy position for 5 seconds after losing sight
- **Death learning**: teammates avoid areas where a teammate died recently (30s cooldown, 200px radius)
- **Ammo awareness in CTF**: disabled (infinite ammo), no loot behaviors active
- **Door usage**: bots open doors to path through, close doors behind when fleeing

## Server Architecture

### Bot Player class

Bots use the same `Player` class as humans. They don't connect via Socket.IO — instead, the server creates them directly in the `GameRoom`:

```js
// Bot is a Player with an AI controller attached
const bot = new Player(botId, spawnX, spawnY, botName);
bot.isBot = true;
bot.ai = new BotAI(bot, gameRoom);
```

### BotAI controller

Each bot has a `BotAI` instance that:
- Runs every server tick (50ms)
- Reads the game state (players, items, map, zone, flags)
- Computes visibility polygon for the bot's position
- Scores all behaviors
- Sets the bot's `input` state (up/down/left/right, angle, shooting)
- Emits events (pickup, throwGrenade, useHeal, reload, sniperFire) directly on the game room

### Tick flow

```
GameRoom._tick():
  1. Run AI for each bot (sets bot.input)
  2. Process player movement (bots move like players)
  3. Process shooting (bots shoot like players)
  4. ... rest of normal tick
```

### Navigation grid

- `NavGrid` class: builds walkable grid from wall data
- Shared per room (all bots in a room share the same grid)
- Rebuilt when walls are destroyed or doors change state
- A* implementation returns array of cell positions
- Exposed as `navGrid.findPath(fromX, fromY, toX, toY)` → `[{x,y}, ...]`

## Files

### New files
- `server/BotAI.js` — main bot AI controller (behavior scoring, state machine, decision making)
- `server/NavGrid.js` — navigation grid, A* pathfinding, cell marking
- `server/BotCombat.js` — combat-specific AI (aiming, engagement decisions, threat assessment, shooting patterns)
- `server/BotBehaviors.js` — individual behavior implementations (flee, loot, patrol, CTF roles, etc.)

### Modified files
- `shared/gameModes.js` — add arcade mode variants with `arcade: true` and `botCount`
- `server/GameRoom.js` — spawn bots on game start for arcade modes, run bot AI each tick, handle bot events
- `server/index.js` — handle arcade room creation (1 human + bots)
- `public/index.html` — add arcade mode section to homepage
- `public/main.js` — arcade mode lobby flow (auto-ready, immediate start)
