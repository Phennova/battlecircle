import { Player } from './Player.js';
import { Bullet } from './Bullet.js';
import { Grenade } from './Grenade.js';
import { generateName } from './names.js';
import { BotAI } from './BotAI.js';
import { NavGrid } from './NavGrid.js';
import { resolveAgainstWalls } from '../shared/collision.js';
import { PLAYER_RADIUS, BULLET_RADIUS, PICKUP_RANGE, TICK_INTERVAL } from '../shared/constants.js';
import { WEAPONS, AMMO_TYPES } from '../shared/weapons.js';
import { GAME_MODES, CTF_CLASSES } from '../shared/gameModes.js';

const STATES = { WAITING: 'WAITING', COUNTDOWN: 'COUNTDOWN', ACTIVE: 'ACTIVE', ENDED: 'ENDED' };

const TEAM_COLORS = ['blue', 'red'];

const LOOT_TABLE = [
  { type: 'pistol', slot: 'gun', weight: 10 },
  { type: 'shotgun', slot: 'gun', weight: 8 },
  { type: 'rifle', slot: 'gun', weight: 7 },
  { type: 'smg', slot: 'gun', weight: 7 },
  { type: 'sniper', slot: 'gun', weight: 4 },
  { type: 'frag', slot: 'grenade', weight: 10 },
  { type: 'smoke', slot: 'grenade', weight: 8 },
  { type: 'bandage', slot: 'heal', weight: 18 },
  { type: 'medkit', slot: 'heal', weight: 8 },
  { type: 'light_ammo', slot: 'ammo', ammoType: 'light', weight: 22 },
  { type: 'shells_ammo', slot: 'ammo', ammoType: 'shells', weight: 20 },
  { type: 'heavy_ammo', slot: 'ammo', ammoType: 'heavy', weight: 20 },
];

const ITEMS_PER_SLOT = 3;

let nextItemId = 0;

export class GameRoom {
  constructor(id, map, io, modeId = 'battle_royale') {
    this.id = id;
    this.map = map;
    this.io = io;
    this.modeId = modeId;
    this.mode = GAME_MODES[modeId];
    this.state = STATES.WAITING;
    this.teamScores = this.mode.teams ? [0, 0] : null;
    this.respawnQueue = []; // { playerId, respawnAt }

    // CTF state
    this.flags = null;
    if (this.mode.ctf && map.flagZones) {
      this.flags = map.flagZones.map(fz => ({
        team: fz.team,
        teamIndex: fz.team === 'blue' ? 0 : 1,
        state: 'home', // 'home' | 'carried' | 'held'
        carrierId: null,
        holdTime: 0,
        holdingTeam: null,
        zoneX: fz.x + fz.w / 2,
        zoneY: fz.y + fz.h / 2,
        zone: fz
      }));
      this.ctfTimers = [0, 0]; // cumulative hold time per team
    }

    this.players = new Map();
    this.bullets = [];
    this.grenades = [];
    this.groundItems = [];
    this.smokes = [];
    this.tick = 0;
    this.gameStartTime = null;
    this.tickInterval = null;
    this.lastTickTime = null;
    this.usedNames = new Set();
    this.finishedPlayers = [];
    this.bots = []; // BotAI instances
    this.navGrid = new NavGrid(map.width, map.height);

    // Static walls (never change)
    this.staticWalls = [...map.walls];
    for (const b of map.buildings) {
      this.staticWalls.push(...b.walls);
    }

    // Interactive doors — start closed
    this.doors = [];
    this.wallDamage = new Map(); // "wallIdx" -> hit count
    this.destroyedWalls = new Set(); // indices of destroyed static walls
    let doorId = 0;
    for (const b of map.buildings) {
      for (const d of (b.doors || [])) {
        const door = {
          id: `door_${doorId++}`,
          x: d.x,
          y: d.y,
          w: d.w || 100,
          side: d.side,
          buildingId: b.id,
          open: false,
          animProgress: 0 // 0 = closed, 1 = open
        };
        // Compute the wall rect when closed
        if (d.side === 'top' || d.side === 'bottom') {
          const wallY = d.side === 'top' ? b.y : b.y + b.h - 10;
          door.wallRect = { x: d.x - door.w / 2, y: wallY, w: door.w, h: 10 };
        } else {
          const wallX = d.side === 'left' ? b.x : b.x + b.w - 10;
          door.wallRect = { x: wallX, y: d.y - door.w / 2, w: 10, h: door.w };
        }
        this.doors.push(door);
      }
    }

    this._rebuildAllWalls();

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
    // Use auth display name if available, otherwise generate random name
    const name = socket.authUsername || generateName(this.usedNames);
    this.usedNames.add(name);
    // Create player at temp position, assign team, then pick spawn
    const player = new Player(socket.id, 0, 0, name);
    player.supabaseId = socket.supabaseId || null;

    // Assign team for team modes (auto-balance)
    if (this.mode.teams) {
      const teamCounts = [0, 0];
      this.players.forEach(p => { if (p.team !== undefined) teamCounts[p.team]++; });
      player.team = teamCounts[0] <= teamCounts[1] ? 0 : 1;
    }

    // Pick spawn (uses team info for clustering)
    const spawn = this._pickSpawn(player);
    player.x = spawn.x;
    player.y = spawn.y;

    this.players.set(socket.id, player);
    socket.join(this.id);

    socket.emit('roomJoined', {
      roomId: this.id,
      playerId: socket.id,
      map: this.map,
      modeId: this.modeId,
      mode: this.mode
    });

    socket.on('playerInput', (data) => {
      const p = this.players.get(socket.id);
      if (p && p.alive) {
        p.input = data;
        p.angle = data.angle;
      }
    });

    socket.on('joinTeam', (teamIndex) => {
      const p = this.players.get(socket.id);
      if (!p || this.state !== STATES.WAITING || !this.mode.teams) return;
      if (teamIndex !== 0 && teamIndex !== 1) return;
      // Check team isn't full
      const teamCount = [...this.players.values()].filter(pl => pl.team === teamIndex).length;
      if (teamCount >= this.mode.teamSize) return;
      p.team = teamIndex;
      p.ready = false; // must re-ready after switching
      this._broadcastLobby();
    });

    socket.on('voteFillBots', () => {
      const p = this.players.get(socket.id);
      if (!p || this.state !== STATES.WAITING || this.mode.arcade) return;
      if (this.players.size < 1) return;

      p.votedFillBots = true;
      this._broadcastLobby();
      this._checkBotFillVote();
    });

    socket.on('toggleReady', () => {
      const p = this.players.get(socket.id);
      if (!p || this.state !== STATES.WAITING) return;
      // In team mode, must have a team to ready up
      if (this.mode.teams && p.team === undefined) return;
      p.ready = !p.ready;
      this._broadcastLobby();
      this._checkAllReady();
    });

    socket.on('pickup', () => {
      const p = this.players.get(socket.id);
      if (!p || !p.alive || p.healing || this.state !== STATES.ACTIVE) return;

      // Check for nearby door first
      const nearDoor = this._findNearbyDoor(p);
      if (nearDoor) {
        nearDoor.open = !nearDoor.open;
        this._rebuildAllWalls();
        return;
      }

      this._handlePickup(p);
    });

    socket.on('throwGrenade', () => {
      const p = this.players.get(socket.id);
      if (!p || !p.alive || !p.grenade || p.grenade.count <= 0 || p.healing || this.state !== STATES.ACTIVE) return;
      const grenType = p.grenade.type;
      p.grenade.count--;
      if (p.grenade.count <= 0) p.grenade = null;
      this.grenades.push(new Grenade(p.id, p.x, p.y, p.angle, grenType));
    });

    socket.on('useHeal', () => {
      const p = this.players.get(socket.id);
      if (!p || !p.alive || !p.heal || p.heal.count <= 0 || p.healing || p.reloading || this.state !== STATES.ACTIVE) return;
      if (p.health >= 100) return;
      p.healing = true;
      const healTime = p.heal.type === 'medkit' ? 4000 : 1500;
      p.healingUntil = Date.now() + healTime;
    });

    socket.on('reload', () => {
      const p = this.players.get(socket.id);
      if (!p || !p.alive || !p.gun || p.reloading || p.healing) return;
      const weapon = WEAPONS[p.gun.type];
      if (p.gun.magAmmo >= weapon.magSize) return;
      if (p.ammoReserve[weapon.ammoType] <= 0) return;
      p.reloading = true;
      p.reloadingUntil = Date.now() + WEAPONS[p.gun.type].reloadTime;
    });

    socket.on('sniperFire', (data) => {
      const p = this.players.get(socket.id);
      if (!p || !p.alive || !p.gun || p.gun.type !== 'sniper' || p.healing || p.reloading) return;
      if (this.state !== STATES.ACTIVE) return;

      const weapon = WEAPONS.sniper;
      const now = Date.now();
      const cooldown = 1000 / weapon.fireRate;
      if (now - p.lastShotTime < cooldown) return;
      if (p.gun.magAmmo <= 0) return;

      p.lastShotTime = now;
      p.gun.magAmmo--;

      // Hitscan: instant line from player position in aim direction
      // Hits ANY player along the line, ignores walls, infinite range
      const angle = data.angle || p.angle;
      const lineLen = 3000; // effectively infinite on our map
      const endX = p.x + Math.cos(angle) * lineLen;
      const endY = p.y + Math.sin(angle) * lineLen;

      // Check all players along the line
      this.players.forEach((target) => {
        if (!target.alive || target.id === p.id) return;
        // Block friendly fire in team modes
        if (this.mode.teams && p.team === target.team) return;

        // Distance from point to line segment
        const dist = this._pointToLineDist(target.x, target.y, p.x, p.y, endX, endY);
        if (dist < PLAYER_RADIUS) {
          target.health -= weapon.damage;
          p.damageDealt += weapon.damage;

          const victimSocket = this.io.sockets.sockets.get(target.id);
          if (victimSocket) {
            victimSocket.emit('playerHit', { damage: weapon.damage, angle });
          }

          if (target.health <= 0) {
            this._handleKill(target, p.id, 'sniper');
          }
        }
      });

      // Broadcast the hitscan line for visual rendering
      this.io.to(this.id).emit('sniperLine', {
        x: p.x, y: p.y, angle, endX, endY, shooterId: p.id
      });
    });

    socket.on('selectClass', (classId) => {
      const p = this.players.get(socket.id);
      if (!p || !this.mode.ctf) return;
      p.selectedClass = classId;
    });

    socket.on('disconnect', () => {
      this._removePlayer(socket.id);
    });

    this._broadcastLobby();
  }

  _removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (player && player.alive && this.state === STATES.ACTIVE) {
      player.alive = false;
      player.health = 0;
      const alivePlayers = [...this.players.values()].filter(p => p.alive);
      player.placement = alivePlayers.length + 1;
      this.finishedPlayers.push({
        name: player.name,
        placement: player.placement,
        kills: player.kills,
        damageDealt: Math.round(player.damageDealt)
      });
      this._dropItems(player);
      this.io.to(this.id).emit('playerKilled', {
        victimId: socketId, killerId: null,
        victimName: player.name, killerName: null,
        cause: 'disconnect'
      });
      this._checkWin();
    }
    if (player) this.usedNames.delete(player.name);
    this.players.delete(socketId);

    if (this.state === STATES.WAITING) {
      this._broadcastLobby();
    }
  }

  _assignSpawnPositions() {
    const spawns = [...this.map.spawnPoints];

    if (this.mode.teams) {
      // Pick two spawn areas as far apart as possible
      let bestDist = 0;
      let spawnA = spawns[0], spawnB = spawns[1];
      for (let i = 0; i < spawns.length; i++) {
        for (let j = i + 1; j < spawns.length; j++) {
          const d = Math.sqrt((spawns[i].x - spawns[j].x) ** 2 + (spawns[i].y - spawns[j].y) ** 2);
          if (d > bestDist) { bestDist = d; spawnA = spawns[i]; spawnB = spawns[j]; }
        }
      }

      // Team 0 (blue) gets spawns near spawnA, team 1 (red) gets spawns near spawnB
      const teamAnchors = [spawnA, spawnB];

      this.players.forEach((player) => {
        const anchor = teamAnchors[player.team] || teamAnchors[0];
        // Find closest available spawn to team anchor
        const sortedSpawns = spawns
          .map(sp => ({ sp, dist: Math.sqrt((sp.x - anchor.x) ** 2 + (sp.y - anchor.y) ** 2) }))
          .sort((a, b) => a.dist - b.dist);

        // Pick the closest spawn that isn't too close to an already-assigned player
        for (const { sp } of sortedSpawns) {
          let tooClose = false;
          this.players.forEach(other => {
            if (other.id === player.id) return;
            if (Math.sqrt((sp.x - other.x) ** 2 + (sp.y - other.y) ** 2) < 40) tooClose = true;
          });
          if (!tooClose) {
            player.x = sp.x;
            player.y = sp.y;
            this._ensureWalkableSpawn(player);
            return;
          }
        }
        // Fallback: just use anchor
        player.x = anchor.x;
        player.y = anchor.y;
      });
    } else {
      // FFA: spread everyone out maximally
      const assigned = [];
      this.players.forEach((player) => {
        let best = spawns[0];
        let bestMinDist = 0;
        for (const sp of spawns) {
          let minDist = Infinity;
          for (const u of assigned) {
            const d = Math.sqrt((sp.x - u.x) ** 2 + (sp.y - u.y) ** 2);
            if (d < minDist) minDist = d;
          }
          if (assigned.length === 0) minDist = Infinity;
          if (minDist > bestMinDist) { bestMinDist = minDist; best = sp; }
        }
        player.x = best.x;
        player.y = best.y;
        // Validate spawn is on walkable cell, adjust if not
        this._ensureWalkableSpawn(player);
        assigned.push({ x: player.x, y: player.y });
      });
    }
  }

  _ensureWalkableSpawn(player) {
    const cell = this.navGrid.worldToCell(player.x, player.y);
    if (!this.navGrid.isWalkable(cell.c, cell.r)) {
      const nearest = this.navGrid._findNearestWalkable(cell.c, cell.r);
      if (nearest) {
        const wp = this.navGrid.cellToWorld(nearest.c, nearest.r);
        player.x = wp.x;
        player.y = wp.y;
      }
    }
  }

  _pickSpawn(forPlayer) {
    const spawns = [...this.map.spawnPoints];

    // In team modes, try to spawn near teammates
    if (this.mode.teams && forPlayer && forPlayer.team !== undefined) {
      const teammates = [...this.players.values()].filter(
        p => p.id !== forPlayer.id && p.team === forPlayer.team && p.alive
      );
      if (teammates.length > 0) {
        // Pick spawn closest to teammates' average position
        const avgX = teammates.reduce((s, t) => s + t.x, 0) / teammates.length;
        const avgY = teammates.reduce((s, t) => s + t.y, 0) / teammates.length;
        let best = spawns[0];
        let bestDist = Infinity;
        for (const sp of spawns) {
          const d = Math.sqrt((sp.x - avgX) ** 2 + (sp.y - avgY) ** 2);
          if (d < bestDist) { bestDist = d; best = sp; }
        }
        return best;
      }
    }

    // Default: pick spawn farthest from all other players
    const used = [...this.players.values()].map(p => ({ x: p.x, y: p.y }));
    if (used.length === 0) return spawns[Math.floor(Math.random() * spawns.length)];

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

  _findNearbyDoor(player) {
    const DOOR_INTERACT_RANGE = 60;
    let nearest = null;
    let nearestDist = Infinity;
    for (const door of this.doors) {
      // Distance from player to door center
      const doorCenterX = door.wallRect.x + door.wallRect.w / 2;
      const doorCenterY = door.wallRect.y + door.wallRect.h / 2;
      const dx = player.x - doorCenterX;
      const dy = player.y - doorCenterY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < DOOR_INTERACT_RANGE && dist < nearestDist) {
        nearestDist = dist;
        nearest = door;
      }
    }
    return nearest;
  }

  _rebuildAllWalls() {
    this.allWalls = this.staticWalls.filter((_, idx) => !this.destroyedWalls.has(idx));
    for (const door of this.doors) {
      if (!door.open) {
        this.allWalls.push(door.wallRect);
      }
    }
    // Rebuild nav grid — exclude closed doors so bots can path through them
    // (bots open doors when they reach them)
    const navWalls = this.staticWalls.filter((_, idx) => !this.destroyedWalls.has(idx));
    this.navGrid.buildFromWalls(navWalls);
  }

  _spawnBots() {
    const botCount = this.mode.botCount || 0;
    if (botCount <= 0) return;

    for (let i = 0; i < botCount; i++) {
      const botId = `bot_${i}_${Date.now()}`;
      const name = generateName(this.usedNames);
      this.usedNames.add(name);
      const bot = new Player(botId, 0, 0, name);
      bot.isBot = true;

      // Assign team for team modes
      if (this.mode.teams) {
        const teamCounts = [0, 0];
        this.players.forEach(p => { if (p.team !== undefined) teamCounts[p.team]++; });
        bot.team = teamCounts[0] <= teamCounts[1] ? 0 : 1;
      }

      this.players.set(botId, bot);

      // Create AI controller
      const ai = new BotAI(bot, this);
      bot._ai = ai; // back-reference for behaviors to access AI state
      this.bots.push(ai);

      // Assign CTF roles
      if (this.mode.ctf) {
        const teamBots = this.bots.filter(b => b.bot.team === bot.team);
        if (teamBots.length === 1) ai.ctfRole = 'attacker';
        else if (teamBots.length === 2) ai.ctfRole = 'defender';
        else ai.ctfRole = 'support';
      }
    }
  }

  _handleBotAction(botId, action, data) {
    const bot = this.players.get(botId);
    if (!bot || !bot.alive) return;

    switch (action) {
      case 'pickup': {
        // Check for nearby door first
        const nearDoor = this._findNearbyDoor(bot);
        if (nearDoor) {
          nearDoor.open = !nearDoor.open;
          this._rebuildAllWalls();
          return;
        }
        this._handlePickup(bot);
        break;
      }
      case 'throwGrenade':
        if (bot.grenade && bot.grenade.count > 0 && !bot.healing) {
          const grenType = bot.grenade.type;
          bot.grenade.count--;
          if (bot.grenade.count <= 0) bot.grenade = null;
          this.grenades.push(new Grenade(bot.id, bot.x, bot.y, bot.angle, grenType));
        }
        break;
      case 'useHeal':
        if (bot.heal && bot.heal.count > 0 && !bot.healing && !bot.reloading && bot.health < 100) {
          bot.healing = true;
          const healTime = bot.heal.type === 'medkit' ? 4000 : 1500;
          bot.healingUntil = Date.now() + healTime;
        }
        break;
      case 'reload':
        if (bot.gun && !bot.reloading && !bot.healing) {
          const weapon = WEAPONS[bot.gun.type];
          if (bot.gun.magAmmo < weapon.magSize && bot.ammoReserve[weapon.ammoType] > 0) {
            bot.reloading = true;
            bot.reloadingUntil = Date.now() + weapon.reloadTime;
          }
        }
        break;
      case 'sniperFire':
        if (bot.gun && bot.gun.type === 'sniper' && !bot.healing && !bot.reloading) {
          const weapon = WEAPONS.sniper;
          const now = Date.now();
          if (now - bot.lastShotTime < 1000 / weapon.fireRate) return;
          if (bot.gun.magAmmo <= 0) return;
          bot.lastShotTime = now;
          bot.gun.magAmmo--;
          const angle = data?.angle || bot.angle;
          const lineLen = 3000;
          const endX = bot.x + Math.cos(angle) * lineLen;
          const endY = bot.y + Math.sin(angle) * lineLen;
          // Hitscan damage
          this.players.forEach((target) => {
            if (!target.alive || target.id === bot.id) return;
            if (this.mode.teams && bot.team === target.team) return;
            const dist = this._pointToLineDist(target.x, target.y, bot.x, bot.y, endX, endY);
            if (dist < PLAYER_RADIUS) {
              target.health -= weapon.damage;
              bot.damageDealt += weapon.damage;
              if (target.health <= 0) {
                this._handleKill(target, bot.id, 'sniper');
              }
            }
          });
          this.io.to(this.id).emit('sniperLine', { x: bot.x, y: bot.y, angle, endX, endY, shooterId: bot.id });
        }
        break;
    }
  }

  _broadcastLobby() {
    const playerList = [];
    this.players.forEach((p) => {
      playerList.push({
        name: p.name,
        ready: p.ready || false,
        team: p.team !== undefined ? TEAM_COLORS[p.team] : null,
        isBot: p.isBot || false
      });
    });
    const humans = [...this.players.values()].filter(p => !p.isBot);
    const votedCount = humans.filter(p => p.votedFillBots).length;
    this.io.to(this.id).emit('lobbyUpdate', {
      players: playerList,
      count: this.players.size,
      max: this.mode.maxPlayers,
      modeId: this.modeId,
      teams: this.mode.teams,
      botVotes: votedCount,
      botVotesNeeded: Math.ceil(humans.length / 2),
      isArcade: this.mode.arcade || false
    });
  }

  _checkBotFillVote() {
    const humans = [...this.players.values()].filter(p => !p.isBot);
    if (humans.length === 0) return;

    const voted = humans.filter(p => p.votedFillBots).length;
    const needed = Math.ceil(humans.length / 2); // majority

    if (voted >= needed) {
      // Fill remaining slots with bots
      const maxPlayers = this.mode.maxPlayers || 8;
      const slotsToFill = maxPlayers - this.players.size;
      if (slotsToFill <= 0) return;

      // Temporarily set botCount and spawn
      const origBotCount = this.mode.botCount;
      this.mode.botCount = slotsToFill;
      this._spawnBots();
      this.mode.botCount = origBotCount;

      // Auto-ready all bots
      this.bots.forEach(ai => { ai.bot.ready = true; });

      // In team modes, assign bots to teams to balance
      if (this.mode.teams) {
        this.bots.forEach(ai => {
          if (ai.bot.team === undefined) {
            const teamCounts = [0, 0];
            this.players.forEach(p => { if (p.team !== undefined) teamCounts[p.team]++; });
            ai.bot.team = teamCounts[0] <= teamCounts[1] ? 0 : 1;
          }
        });
      }

      this._broadcastLobby();
      this.io.to(this.id).emit('botsFilled', { count: slotsToFill });
    }
  }

  _checkAllReady() {
    if (this.players.size < this.mode.minPlayers) return;
    // In team modes, all players must have a team
    if (this.mode.teams) {
      const allTeamed = [...this.players.values()].every(p => p.team !== undefined);
      if (!allTeamed) return;
    }
    const allReady = [...this.players.values()].every(p => p.ready);
    if (allReady) {
      this._startCountdown();
    }
  }

  _startCountdown() {
    this.state = STATES.COUNTDOWN;
    if (!this.mode.ctf) this._spawnLoot();

    // Spawn bots for arcade modes
    if (this.mode.arcade) {
      this._spawnBots();
    }

    // Re-assign spawn positions now that teams are finalized
    this._assignSpawnPositions();

    const spawnPositions = {};
    this.players.forEach((p, id) => {
      spawnPositions[id] = { x: p.x, y: p.y };
    });
    this.io.to(this.id).emit('countdown', { spawnPositions, seconds: 3 });

    setTimeout(() => {
      this.state = STATES.ACTIVE;
      this.gameStartTime = Date.now();
      this.lastTickTime = Date.now();

      // Apply class loadouts for CTF
      if (this.mode.ctf) {
        this.players.forEach((player) => {
          const classId = player.selectedClass || 'assault'; // default to assault
          const cls = CTF_CLASSES[classId];
          if (cls) {
            player.gun = { type: cls.gun, magAmmo: WEAPONS[cls.gun].magSize };
            player.grenade = { type: cls.grenade.type, count: cls.grenade.count };
            player.heal = { type: cls.heal.type, count: cls.heal.count };
            player.ammoReserve = { light: 999, shells: 999, heavy: 999 };
          }
        });
      }

      this.io.to(this.id).emit('gameStart', {});
      this._startTickLoop();
    }, 3000);
  }

  _spawnLoot() {
    const totalWeight = LOOT_TABLE.reduce((s, i) => s + i.weight, 0);

    for (const building of this.map.buildings) {
      for (const slot of building.lootSlots) {
        for (let n = 0; n < ITEMS_PER_SLOT; n++) {
          let roll = Math.random() * totalWeight;
          let picked = LOOT_TABLE[0];
          for (const entry of LOOT_TABLE) {
            roll -= entry.weight;
            if (roll <= 0) { picked = entry; break; }
          }

          const offsetX = (n === 0) ? 0 : (Math.random() - 0.5) * 30;
          const offsetY = (n === 0) ? 0 : (Math.random() - 0.5) * 30;

          const item = {
            id: `item_${nextItemId++}`,
            type: picked.type,
            slot: picked.slot,
            x: slot.x + offsetX,
            y: slot.y + offsetY
          };

          if (picked.slot === 'gun') {
            item.magAmmo = WEAPONS[picked.type].magSize;
          } else if (picked.slot === 'grenade' || picked.slot === 'heal') {
            item.count = 1;
          } else if (picked.slot === 'ammo') {
            item.ammoType = picked.ammoType;
            item.amount = AMMO_TYPES[picked.ammoType].perPickup;
          }

          this.groundItems.push(item);
        }
      }
    }

    // Spawn ammo near standalone barricades (walls beyond boundary walls)
    const AMMO_ITEMS = [
      { type: 'light_ammo', slot: 'ammo', ammoType: 'light' },
      { type: 'shells_ammo', slot: 'ammo', ammoType: 'shells' },
      { type: 'heavy_ammo', slot: 'ammo', ammoType: 'heavy' },
    ];
    const barriers = this.map.walls.slice(4); // skip 4 boundary walls
    for (const wall of barriers) {
      // 70% chance to spawn ammo near each barrier
      if (Math.random() > 0.7) continue;
      const ammoType = AMMO_ITEMS[Math.floor(Math.random() * AMMO_ITEMS.length)];
      // Place behind/beside the barrier
      let ax, ay;
      if (wall.h <= 12) {
        // Horizontal barrier — spawn above or below
        ax = wall.x + Math.random() * wall.w;
        ay = wall.y + (Math.random() < 0.5 ? -20 : wall.h + 20);
      } else {
        // Vertical barrier — spawn left or right
        ax = wall.x + (Math.random() < 0.5 ? -20 : wall.w + 20);
        ay = wall.y + Math.random() * wall.h;
      }
      this.groundItems.push({
        id: `item_${nextItemId++}`,
        type: ammoType.type,
        slot: 'ammo',
        ammoType: ammoType.ammoType,
        amount: AMMO_TYPES[ammoType.ammoType].perPickup,
        x: ax,
        y: ay
      });
    }
  }

  _handlePickup(player) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const item of this.groundItems) {
      if (item.slot === 'ammo') continue;
      const dx = item.x - player.x;
      const dy = item.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < PICKUP_RANGE && dist < nearestDist) {
        nearestDist = dist;
        nearest = item;
      }
    }
    if (!nearest) return;

    const idx = this.groundItems.indexOf(nearest);

    if (nearest.slot === 'gun') {
      if (player.gun) {
        this.groundItems.push({
          id: `item_${nextItemId++}`,
          type: player.gun.type,
          slot: 'gun',
          x: player.x, y: player.y,
          magAmmo: player.gun.magAmmo
        });
      }
      player.gun = { type: nearest.type, magAmmo: nearest.magAmmo || WEAPONS[nearest.type].magSize };
      player.reloading = false;
      player.reloadingUntil = 0;
    } else if (nearest.slot === 'grenade') {
      if (player.grenade && player.grenade.type === nearest.type && player.grenade.count < 3) {
        player.grenade.count = Math.min(3, player.grenade.count + (nearest.count || 1));
      } else if (player.grenade) {
        this.groundItems.push({
          id: `item_${nextItemId++}`,
          type: player.grenade.type,
          slot: 'grenade',
          x: player.x, y: player.y,
          count: player.grenade.count
        });
        player.grenade = { type: nearest.type, count: nearest.count || 1 };
      } else {
        player.grenade = { type: nearest.type, count: nearest.count || 1 };
      }
    } else if (nearest.slot === 'heal') {
      const maxStack = nearest.type === 'medkit' ? 1 : 5;
      if (player.heal && player.heal.type === nearest.type && player.heal.count >= maxStack) {
        return; // stack full
      }
      if (player.heal && player.heal.type === nearest.type) {
        player.heal.count = Math.min(maxStack, player.heal.count + (nearest.count || 1));
      } else if (player.heal) {
        this.groundItems.push({
          id: `item_${nextItemId++}`,
          type: player.heal.type,
          slot: 'heal',
          x: player.x, y: player.y,
          count: player.heal.count
        });
        player.heal = { type: nearest.type, count: nearest.count || 1 };
      } else {
        player.heal = { type: nearest.type, count: nearest.count || 1 };
      }
    }

    this.groundItems.splice(idx, 1);
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

    // 0. Run bot AI (sets bot.input before movement processing)
    for (const botAI of this.bots) {
      try {
        botAI.tick(dt);
      } catch (e) {
        // Don't let a bot AI error crash the game loop
        console.error('Bot AI error:', e.message);
      }
    }

    // Update nav grid zone marking in BR
    if (this.zone && this.zone.active) {
      this.navGrid.markZone(this.zone.centerX, this.zone.centerY, this.zone.currentRadius);
    }

    // 1. Move players
    this.players.forEach((player) => {
      if (!player.alive) return;
      const inp = player.input;

      // Both healing and reloading: uncancellable, slow movement, no shooting
      const isScoping = player.input.scoping && player.gun && player.gun.type === 'sniper';
      const speedMultiplier = (player.healing || player.reloading) ? 0.3 : isScoping ? 0.4 : 1.0;

      let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      if (dx !== 0 && dy !== 0) {
        const len = Math.sqrt(dx * dx + dy * dy);
        dx /= len;
        dy /= len;
      }
      player.x += dx * player.speed * speedMultiplier * dt;
      player.y += dy * player.speed * speedMultiplier * dt;

      const resolved = resolveAgainstWalls(player.x, player.y, player.radius, this.allWalls);
      player.x = resolved.x;
      player.y = resolved.y;
    });

    // 1.25. Player-to-player repulsion — push overlapping players apart
    const playerArr = [...this.players.values()].filter(p => p.alive);
    for (let i = 0; i < playerArr.length; i++) {
      for (let j = i + 1; j < playerArr.length; j++) {
        const a = playerArr[i];
        const b = playerArr[j];
        const pdx = b.x - a.x;
        const pdy = b.y - a.y;
        const pDist = Math.sqrt(pdx * pdx + pdy * pdy);
        const minDist = PLAYER_RADIUS * 2;
        if (pDist < minDist && pDist > 0) {
          const overlap = (minDist - pDist) / 2;
          const nx = pdx / pDist;
          const ny = pdy / pDist;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;
        }
      }
    }

    // 1.5. Auto-collect ammo
    for (let i = this.groundItems.length - 1; i >= 0; i--) {
      const item = this.groundItems[i];
      if (item.slot !== 'ammo') continue;
      let collected = false;
      this.players.forEach((player) => {
        if (!player.alive || collected) return;
        const dx = item.x - player.x;
        const dy = item.y - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < PICKUP_RANGE) {
          player.ammoReserve[item.ammoType] += item.amount;
          collected = true;
        }
      });
      if (collected) {
        this.groundItems.splice(i, 1);
      }
    }

    // 2. Process shooting (not sniper — sniper uses sniperFire event)
    this.players.forEach((player) => {
      if (!player.alive || !player.input.shooting || !player.gun || player.healing || player.reloading) return;
      if (player.gun.type === 'sniper') return; // sniper uses sniperFire event

      const weapon = WEAPONS[player.gun.type];
      if (!weapon) return;

      const cooldown = 1000 / weapon.fireRate;
      if (now - player.lastShotTime < cooldown) return;
      if (player.gun.magAmmo <= 0) return;

      player.lastShotTime = now;
      player.gun.magAmmo--;

      // Calculate player velocity for bullet inheritance
      const inp = player.input;
      let pdx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      let pdy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      if (pdx !== 0 && pdy !== 0) {
        const len = Math.sqrt(pdx * pdx + pdy * pdy);
        pdx /= len;
        pdy /= len;
      }
      const isScoping = inp.scoping && player.gun.type === 'sniper';
      const sMult = (player.healing || player.reloading) ? 0.3 : isScoping ? 0.4 : 1.0;
      const ownerVx = pdx * player.speed * sMult;
      const ownerVy = pdy * player.speed * sMult;

      for (let i = 0; i < weapon.pellets; i++) {
        let angle = player.angle;
        if (weapon.pellets > 1) {
          const step = (weapon.spread * 2) / (weapon.pellets - 1);
          angle = player.angle - weapon.spread + step * i;
        } else if (weapon.spread > 0) {
          angle += (Math.random() - 0.5) * 2 * weapon.spread;
        }
        this.bullets.push(new Bullet(player.id, player.x, player.y, angle, weapon, ownerVx, ownerVy));
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

      let hitWall = false;
      let hitWallIdx = -1;
      for (let wi = 0; wi < this.allWalls.length; wi++) {
        const wall = this.allWalls[wi];
        if (bullet.x >= wall.x && bullet.x <= wall.x + wall.w &&
            bullet.y >= wall.y && bullet.y <= wall.y + wall.h) {
          hitWall = true;
          hitWallIdx = wi;
          break;
        }
      }
      if (hitWall) {
        // Track shrapnel hits on walls
        if (bullet.type === 'shrapnel' && hitWallIdx >= 0) {
          // Find matching static wall index
          const hitRect = this.allWalls[hitWallIdx];
          const staticIdx = this.staticWalls.indexOf(hitRect);
          if (staticIdx >= 0 && !this.destroyedWalls.has(staticIdx)) {
            const key = staticIdx;
            const hits = (this.wallDamage.get(key) || 0) + 1;
            this.wallDamage.set(key, hits);
            if (hits >= 3) {
              this.destroyedWalls.add(staticIdx);
              this._rebuildAllWalls();
            }
          }
        }
        this.bullets.splice(i, 1);
        continue;
      }

      let hitPlayer = false;
      const bulletOwner = this.players.get(bullet.ownerId);
      this.players.forEach((player) => {
        if (hitPlayer || !player.alive || player.id === bullet.ownerId) return;
        // Block friendly fire in team modes
        if (this.mode.teams && bulletOwner && bulletOwner.team === player.team) return;
        const dx = bullet.x - player.x;
        const dy = bullet.y - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < PLAYER_RADIUS + BULLET_RADIUS) {
          player.health -= bullet.damage;
          hitPlayer = true;

          // Track damage
          const attacker = this.players.get(bullet.ownerId);
          if (attacker) attacker.damageDealt += bullet.damage;

          const victimSocket = this.io.sockets.sockets.get(player.id);
          if (victimSocket) {
            victimSocket.emit('playerHit', { damage: bullet.damage, angle: bullet.angle });
          }

          if (player.health <= 0) {
            this._handleKill(player, bullet.ownerId, bullet.type === 'shrapnel' ? 'frag' : bullet.type);
          }
        }
      });
      if (hitPlayer) {
        this.bullets.splice(i, 1);
      }
    }

    // 4. Update grenades
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const gren = this.grenades[i];
      gren.update(dt, this.allWalls);

      // Smoke: activate immediately on stop
      if (gren.shouldActivateSmoke()) {
        this.smokes.push({
          id: `smoke_${nextItemId++}`,
          x: gren.x,
          y: gren.y,
          activatedAt: Date.now(),
          duration: 20000
        });
        this.grenades.splice(i, 1);
        continue;
      }

      // Frag: explode into shrapnel burst
      if (gren.shouldExplode()) {
        // Spawn ~25 shrapnel projectiles with random angles and varied speeds
        const SHRAPNEL_COUNT = 45;
        const SHRAPNEL_RANGE = 140; // +75% from original 80
        const SHRAPNEL_DAMAGE = 10;
        const shrapnelWeapon = {
          bulletSpeed: 0, // set per piece
          damage: SHRAPNEL_DAMAGE,
          range: SHRAPNEL_RANGE,
          name: 'frag'
        };

        for (let s = 0; s < SHRAPNEL_COUNT; s++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 250 + Math.random() * 300; // 250-550 px/s (varied for stagger)
          const piece = new Bullet(gren.ownerId, gren.x, gren.y, angle, shrapnelWeapon, 0, 0);
          piece.speed = speed;
          piece.vx = Math.cos(angle) * speed;
          piece.vy = Math.sin(angle) * speed;
          piece.type = 'shrapnel';
          // Slight random offset from center so they don't all start at exact same point
          piece.x += (Math.random() - 0.5) * 6;
          piece.y += (Math.random() - 0.5) * 6;
          this.bullets.push(piece);
        }
        this.grenades.splice(i, 1);
      }
    }

    // 4.5. Remove expired smokes
    this.smokes = this.smokes.filter(s => Date.now() - s.activatedAt < s.duration);

    // 5. Update healing (uncancellable)
    this.players.forEach((player) => {
      if (!player.alive || !player.healing) return;
      if (now >= player.healingUntil) {
        const healAmount = player.heal.type === 'medkit' ? 75 : 25;
        player.health = Math.min(100, player.health + healAmount);
        player.healing = false;
        player.healingUntil = 0;
        if (player.heal) {
          player.heal.count--;
          if (player.heal.count <= 0) player.heal = null;
        }
      }
    });

    // 6. Update reloading
    this.players.forEach((player) => {
      if (!player.alive || !player.reloading) return;
      if (now >= player.reloadingUntil) {
        const weapon = WEAPONS[player.gun.type];
        const needed = weapon.magSize - player.gun.magAmmo;
        const available = player.ammoReserve[weapon.ammoType];
        const toLoad = Math.min(needed, available);
        player.gun.magAmmo += toLoad;
        player.ammoReserve[weapon.ammoType] -= toLoad;
        player.reloading = false;
        player.reloadingUntil = 0;
      }
    });

    // 7. Update zone
    const elapsed = now - this.gameStartTime;
    if (!this.zone.active && elapsed >= this.zone.activateAfterMs) {
      this.zone.active = true;
      this.zone.shrinkStartTime = now;
    }
    if (this.zone.active) {
      const t = Math.min(1, (now - this.zone.shrinkStartTime) / this.zone.shrinkDuration);
      this.zone.currentRadius = this.zone.startRadius + (this.zone.finalRadius - this.zone.startRadius) * t;

      this.players.forEach((player) => {
        if (!player.alive) return;
        const dx = player.x - this.zone.centerX;
        const dy = player.y - this.zone.centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > this.zone.currentRadius) {
          player.health -= this.zone.damagePerSecond * dt;
          // Emit hit flash for zone damage (throttled to ~2/sec)
          if (!player._lastZoneHitEmit || now - player._lastZoneHitEmit > 500) {
            player._lastZoneHitEmit = now;
            const victimSocket = this.io.sockets.sockets.get(player.id);
            if (victimSocket) {
              victimSocket.emit('playerHit', { damage: this.zone.damagePerSecond * 0.5, angle: Math.atan2(dy, dx) });
            }
          }
          if (player.health <= 0) {
            this._handleKill(player, null, 'zone');
          }
        }
      });
    }

    // 8. CTF flag logic
    if (this.flags) {
      this._processCTFFlags(dt);
    }

    // 9. Process respawns
    if (this.mode.respawn) {
      this._processRespawns(now);
    }

    // 9. Broadcast state
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
      bullets: this.bullets.map(b => ({
        id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, angle: b.angle, type: b.type, ownerId: b.ownerId,
        originX: b.originX, originY: b.originY
      })),
      grenades: this.grenades.map(g => ({ id: g.id, x: g.x, y: g.y, explodeAt: g.explodeAt, type: g.type })),
      groundItems: this.groundItems.map(i => ({
        id: i.id, type: i.type, slot: i.slot, x: i.x, y: i.y,
        magAmmo: i.magAmmo, count: i.count, ammoType: i.ammoType, amount: i.amount
      })),
      smokes: this.smokes.map(s => ({ id: s.id, x: s.x, y: s.y, activatedAt: s.activatedAt, duration: s.duration })),
      doors: this.doors.map(d => ({ id: d.id, x: d.wallRect.x, y: d.wallRect.y, w: d.wallRect.w, h: d.wallRect.h, open: d.open, side: d.side })),
      destroyedWalls: [...this.destroyedWalls],
      teamScores: this.teamScores,
      modeId: this.modeId,
      flags: this.flags ? this.flags.map(f => ({
        team: f.team, state: f.state, carrierId: f.carrierId,
        holdingTeam: f.holdingTeam, zoneX: f.zoneX, zoneY: f.zoneY,
        zone: f.zone
      })) : null,
      ctfTimers: this.ctfTimers || null,
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

  _handleKill(player, killerId, cause) {
    player.health = 0;
    player.alive = false;
    player.deaths++;

    const attacker = killerId ? this.players.get(killerId) : null;
    if (attacker) attacker.kills++;

    // Team score
    if (this.mode.teams && attacker && attacker.team !== undefined) {
      this.teamScores[attacker.team]++;
    }

    // CTF: if carrier dies, flag returns home
    if (this.flags) {
      for (const flag of this.flags) {
        if (flag.state === 'carried' && flag.carrierId === player.id) {
          flag.state = 'home';
          flag.carrierId = null;
          flag.holdingTeam = null;
        }
      }
    }

    this.io.to(this.id).emit('playerKilled', {
      victimId: player.id, killerId,
      victimName: player.name,
      killerName: attacker ? attacker.name : null,
      cause
    });

    if (this.mode.respawn) {
      // Queue respawn
      this.respawnQueue.push({
        playerId: player.id,
        respawnAt: Date.now() + this.mode.respawnTime
      });
    } else {
      this._recordElimination(player);
      this._dropItems(player);
    }

    this._checkWin();
  }

  _processCTFFlags(dt) {
    const MIDLINE = this.map.width / 2;
    const FLAG_PICKUP_RANGE = 30;

    for (const flag of this.flags) {
      if (flag.state === 'held') {
        // Increment hold timer for the holding team
        this.ctfTimers[flag.holdingTeam] += dt;

        // Check win
        if (this.ctfTimers[flag.holdingTeam] >= this.mode.holdTimeToWin) {
          this.state = STATES.ENDED;
          clearInterval(this.tickInterval);
          const winningTeam = TEAM_COLORS[flag.holdingTeam];
          const standings = [...this.players.values()].map(p => ({
            name: p.name,
            team: TEAM_COLORS[p.team] || '?',
            kills: p.kills,
            damageDealt: Math.round(p.damageDealt)
          })).sort((a, b) => b.kills - a.kills);
          this.io.to(this.id).emit('gameOver', {
            winnerId: null,
            winningTeam,
            teamScores: this.ctfTimers.map(t => Math.round(t)),
            standings
          });
          return;
        }

        // Check if enemy player can grab the flag from the zone
        this.players.forEach((player) => {
          if (!player.alive) return;
          // Only the team that OWNS this flag can grab it back from enemy zone
          if (player.team !== flag.teamIndex) return;
          const dx = player.x - flag.zoneX;
          const dy = player.y - flag.zoneY;
          // The flag is in the ENEMY's zone (holdingTeam's zone)
          const holdingZone = this.flags.find(f => f.teamIndex === flag.holdingTeam);
          if (!holdingZone) return;
          const dzx = player.x - holdingZone.zoneX;
          const dzy = player.y - holdingZone.zoneY;
          if (Math.sqrt(dzx * dzx + dzy * dzy) < FLAG_PICKUP_RANGE + 100) {
            // Player is in the zone where their flag is held — pick it up
            flag.state = 'carried';
            flag.carrierId = player.id;
            flag.holdingTeam = null;
          }
        });
      }

      if (flag.state === 'home') {
        // Check if enemy player picks up the flag
        this.players.forEach((player) => {
          if (!player.alive) return;
          if (player.team === flag.teamIndex) return; // can't pick up own flag
          const dx = player.x - flag.zoneX;
          const dy = player.y - flag.zoneY;
          if (Math.sqrt(dx * dx + dy * dy) < FLAG_PICKUP_RANGE + 100) {
            flag.state = 'carried';
            flag.carrierId = player.id;
          }
        });
      }

      if (flag.state === 'carried') {
        const carrier = this.players.get(flag.carrierId);
        if (!carrier || !carrier.alive) {
          // Carrier died or disconnected — flag returns home
          flag.state = 'home';
          flag.carrierId = null;
          flag.holdingTeam = null;
          continue;
        }

        // Check if carrier crossed midline into own territory
        const carrierTeam = carrier.team;
        const inOwnTerritory = (carrierTeam === 0 && carrier.x < MIDLINE) ||
                               (carrierTeam === 1 && carrier.x >= MIDLINE);
        if (inOwnTerritory && flag.teamIndex !== carrierTeam) {
          // Flag captured — teleport to carrier's team zone
          const carrierZoneFlag = this.flags.find(f => f.teamIndex === carrierTeam);
          flag.state = 'held';
          flag.carrierId = null;
          flag.holdingTeam = carrierTeam;
        }
      }
    }
  }

  _processRespawns(now) {
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const entry = this.respawnQueue[i];
      if (now >= entry.respawnAt) {
        const player = this.players.get(entry.playerId);
        if (player) {
          const spawn = this._pickSpawn(player);
          player.x = spawn.x;
          player.y = spawn.y;
          player.health = 100;
          player.alive = true;
          player.healing = false;
          player.healingUntil = 0;
          player.reloading = false;
          player.reloadingUntil = 0;
          // Apply loadout
          if (this.mode.ctf && player.selectedClass && CTF_CLASSES[player.selectedClass]) {
            const cls = CTF_CLASSES[player.selectedClass];
            player.gun = { type: cls.gun, magAmmo: WEAPONS[cls.gun].magSize };
            player.grenade = { type: cls.grenade.type, count: cls.grenade.count };
            player.heal = { type: cls.heal.type, count: cls.heal.count };
            player.ammoReserve = { light: 999, shells: 999, heavy: 999 };
          } else {
            player.gun = { type: 'pistol', magAmmo: WEAPONS.pistol.magSize };
            player.ammoReserve = { light: 24, shells: 0, heavy: 0 };
          }
        }
        this.respawnQueue.splice(i, 1);
      }
    }
  }

  _recordElimination(player) {
    const alivePlayers = [...this.players.values()].filter(p => p.alive);
    player.placement = alivePlayers.length + 1;
    this.finishedPlayers.push({
      name: player.name,
      placement: player.placement,
      kills: player.kills,
      damageDealt: Math.round(player.damageDealt)
    });
  }

  _dropItems(player) {
    if (player.gun) {
      this.groundItems.push({
        id: `item_${nextItemId++}`,
        type: player.gun.type,
        slot: 'gun',
        x: player.x, y: player.y,
        magAmmo: player.gun.magAmmo
      });
      player.gun = null;
    }
    if (player.grenade) {
      this.groundItems.push({
        id: `item_${nextItemId++}`,
        type: player.grenade.type,
        slot: 'grenade',
        x: player.x, y: player.y,
        count: player.grenade.count
      });
      player.grenade = null;
    }
    if (player.heal) {
      this.groundItems.push({
        id: `item_${nextItemId++}`,
        type: player.heal.type,
        slot: 'heal',
        x: player.x, y: player.y,
        count: player.heal.count
      });
      player.heal = null;
    }
    for (const [type, amount] of Object.entries(player.ammoReserve)) {
      if (amount > 0) {
        const ammoType = AMMO_TYPES[type];
        if (!ammoType) continue;
        const perPickup = ammoType.perPickup;
        const itemCount = Math.ceil(amount / perPickup);
        for (let i = 0; i < itemCount; i++) {
          const dropAmount = Math.min(perPickup, amount - i * perPickup);
          this.groundItems.push({
            id: `item_${nextItemId++}`,
            type: `${type}_ammo`,
            slot: 'ammo',
            ammoType: type,
            amount: dropAmount,
            x: player.x + (Math.random() - 0.5) * 20,
            y: player.y + (Math.random() - 0.5) * 20
          });
        }
        player.ammoReserve[type] = 0;
      }
    }
  }

  _checkWin() {
    if (this.state !== STATES.ACTIVE) return;

    // TDM team elimination: check if an entire team is dead
    if (this.mode.teamElimination) {
      const teamAlive = [0, 0];
      this.players.forEach(p => {
        if (p.alive && p.team !== undefined) teamAlive[p.team]++;
      });

      for (let t = 0; t < 2; t++) {
        if (teamAlive[t] === 0 && teamAlive[1 - t] > 0) {
          this.state = STATES.ENDED;
          clearInterval(this.tickInterval);
          const winningTeam = TEAM_COLORS[1 - t];
          const standings = [...this.players.values()].map(p => ({
            name: p.name,
            team: TEAM_COLORS[p.team] || '?',
            kills: p.kills,
            damageDealt: Math.round(p.damageDealt)
          })).sort((a, b) => b.kills - a.kills);
          this.io.to(this.id).emit('gameOver', {
            winnerId: null,
            winningTeam,
            teamScores: [teamAlive[0], teamAlive[1]],
            standings
          });
          return;
        }
      }
      return;
    }

    // TDM score-based: check team scores
    if (this.mode.teams && this.mode.scoreToWin) {
      for (let t = 0; t < this.teamScores.length; t++) {
        if (this.teamScores[t] >= this.mode.scoreToWin) {
          this.state = STATES.ENDED;
          clearInterval(this.tickInterval);
          const winningTeam = TEAM_COLORS[t];
          const standings = [...this.players.values()].map(p => ({
            name: p.name,
            team: TEAM_COLORS[p.team] || '?',
            kills: p.kills,
            damageDealt: Math.round(p.damageDealt)
          })).sort((a, b) => b.kills - a.kills);
          this.io.to(this.id).emit('gameOver', {
            winnerId: null,
            winningTeam,
            teamScores: this.teamScores,
            standings
          });
          return;
        }
      }
      return;
    }

    // Battle Royale: last alive wins
    const alive = [...this.players.values()].filter(p => p.alive);
    if (alive.length <= 1) {
      this.state = STATES.ENDED;
      clearInterval(this.tickInterval);
      const winner = alive.length === 1 ? alive[0] : null;
      if (winner) {
        winner.placement = 1;
        this.finishedPlayers.push({
          name: winner.name,
          placement: 1,
          kills: winner.kills,
          damageDealt: Math.round(winner.damageDealt)
        });
      }
      const standings = this.finishedPlayers.sort((a, b) => a.placement - b.placement);
      this.io.to(this.id).emit('gameOver', {
        winnerId: winner ? winner.id : null,
        standings
      });
    }
  }

  _pointToLineDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
  }

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

  get isFull() { return this.players.size >= this.mode.maxPlayers; }
  get isEmpty() { return this.players.size === 0; }
}
