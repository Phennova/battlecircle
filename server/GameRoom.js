import { Player } from './Player.js';
import { Bullet } from './Bullet.js';
import { Grenade } from './Grenade.js';
import { resolveAgainstWalls } from '../shared/collision.js';
import { PLAYER_RADIUS, BULLET_RADIUS, PICKUP_RANGE, TICK_INTERVAL } from '../shared/constants.js';
import { WEAPONS, AMMO_TYPES } from '../shared/weapons.js';

const STATES = { WAITING: 'WAITING', COUNTDOWN: 'COUNTDOWN', ACTIVE: 'ACTIVE', ENDED: 'ENDED' };

const LOOT_TABLE = [
  { type: 'pistol', slot: 'gun', weight: 18 },
  { type: 'shotgun', slot: 'gun', weight: 12 },
  { type: 'rifle', slot: 'gun', weight: 10 },
  { type: 'frag', slot: 'grenade', weight: 12 },
  { type: 'bandage', slot: 'heal', weight: 14 },
  { type: 'pistol_ammo', slot: 'ammo', ammoType: 'pistol', weight: 12 },
  { type: 'shotgun_ammo', slot: 'ammo', ammoType: 'shotgun', weight: 11 },
  { type: 'rifle_ammo', slot: 'ammo', ammoType: 'rifle', weight: 11 },
];

const ITEMS_PER_SLOT = 2; // spawn multiple items per loot slot for higher density

let nextItemId = 0;

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

    this.allWalls = [...map.walls];
    for (const b of map.buildings) {
      this.allWalls.push(...b.walls);
    }

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
    const spawn = this._pickSpawn();
    const player = new Player(socket.id, spawn.x, spawn.y);
    this.players.set(socket.id, player);
    socket.join(this.id);

    socket.emit('roomJoined', {
      roomId: this.id,
      playerId: socket.id,
      map: this.map
    });

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

    socket.on('pickup', () => {
      const p = this.players.get(socket.id);
      if (!p || !p.alive || this.state !== STATES.ACTIVE) return;
      this._handlePickup(p);
    });

    socket.on('throwGrenade', () => {
      const p = this.players.get(socket.id);
      if (!p || !p.alive || !p.grenade || p.grenade.count <= 0 || this.state !== STATES.ACTIVE) return;
      p.grenade.count--;
      if (p.grenade.count <= 0) p.grenade = null;
      this.grenades.push(new Grenade(p.id, p.x, p.y, p.angle));
    });

    socket.on('useHeal', () => {
      const p = this.players.get(socket.id);
      if (!p || !p.alive || !p.heal || p.heal.count <= 0 || p.healing || p.reloading || this.state !== STATES.ACTIVE) return;
      if (p.health >= 100) return;
      p.healing = true;
      p.healingUntil = Date.now() + 1500;
    });

    socket.on('reload', () => {
      const p = this.players.get(socket.id);
      if (!p || !p.alive || !p.gun || p.reloading || p.healing) return;
      if (p.gun.magAmmo >= WEAPONS[p.gun.type].magSize) return;
      if (p.ammoReserve[p.gun.type] <= 0) return;
      p.reloading = true;
      p.reloadingUntil = Date.now() + WEAPONS[p.gun.type].reloadTime;
    });

    socket.on('disconnect', () => {
      this._removePlayer(socket.id);
    });

    if (this.players.size >= 2 && !this.autoStartTimer && this.state === STATES.WAITING) {
      this.autoStartTimer = setTimeout(() => {
        if (this.state === STATES.WAITING && this.players.size >= 2) {
          this._startCountdown();
        }
      }, 30000);
    }

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
    this._spawnLoot();

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

          // Spread items slightly so they don't stack perfectly
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
  }

  _handlePickup(player) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const item of this.groundItems) {
      if (item.slot === 'ammo') continue; // ammo auto-collects, not E key
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
      // Cancel reload if switching guns
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
      if (player.heal && player.heal.type === nearest.type && player.heal.count < 5) {
        player.heal.count = Math.min(5, player.heal.count + (nearest.count || 1));
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

    // 1. Move players
    this.players.forEach((player) => {
      if (!player.alive) return;
      const inp = player.input;

      // Cancel healing/reloading if moving or shooting
      if (player.healing && (inp.up || inp.down || inp.left || inp.right || inp.shooting)) {
        player.healing = false;
        player.healingUntil = 0;
      }
      if (player.reloading && (inp.up || inp.down || inp.left || inp.right)) {
        player.reloading = false;
        player.reloadingUntil = 0;
      }

      // Skip movement if healing or reloading
      if (player.healing || player.reloading) return;

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

    // 2. Process shooting
    this.players.forEach((player) => {
      if (!player.alive || !player.input.shooting || !player.gun || player.healing || player.reloading) return;

      const weapon = WEAPONS[player.gun.type];
      if (!weapon) return;

      const cooldown = 1000 / weapon.fireRate;
      if (now - player.lastShotTime < cooldown) return;
      if (player.gun.magAmmo <= 0) return;

      player.lastShotTime = now;
      player.gun.magAmmo--;

      for (let i = 0; i < weapon.pellets; i++) {
        let angle = player.angle;
        if (weapon.pellets > 1) {
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

    // 4. Update grenades
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const gren = this.grenades[i];
      gren.update(dt, this.allWalls);

      if (gren.shouldExplode()) {
        this.players.forEach((player) => {
          if (!player.alive) return;
          const dx = player.x - gren.x;
          const dy = player.y - gren.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > gren.explosionRadius) return;

          if (!this._hasLineOfSight(gren.x, gren.y, player.x, player.y)) return;

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

    // 5. Update healing
    this.players.forEach((player) => {
      if (!player.alive || !player.healing) return;
      if (now >= player.healingUntil) {
        player.health = Math.min(100, player.health + 25);
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
        const available = player.ammoReserve[player.gun.type];
        const toLoad = Math.min(needed, available);
        player.gun.magAmmo += toLoad;
        player.ammoReserve[player.gun.type] -= toLoad;
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

    // 8. Check win condition
    this._checkWin();

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
      bullets: this.bullets.map(b => ({ id: b.id, x: b.x, y: b.y, angle: b.angle, type: b.type, ownerId: b.ownerId })),
      grenades: this.grenades.map(g => ({ id: g.id, x: g.x, y: g.y, explodeAt: g.explodeAt })),
      groundItems: this.groundItems.map(i => ({
        id: i.id, type: i.type, slot: i.slot, x: i.x, y: i.y,
        magAmmo: i.magAmmo, count: i.count, ammoType: i.ammoType, amount: i.amount
      })),
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
    // Drop ammo reserves
    for (const [type, amount] of Object.entries(player.ammoReserve)) {
      if (amount > 0) {
        const perPickup = AMMO_TYPES[type].perPickup;
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
    const alive = [...this.players.values()].filter(p => p.alive);
    if (alive.length <= 1 && this.state === STATES.ACTIVE) {
      this.state = STATES.ENDED;
      clearInterval(this.tickInterval);
      const winner = alive.length === 1 ? alive[0] : null;
      this.io.to(this.id).emit('gameOver', {
        winnerId: winner ? winner.id : null,
        stats: winner ? { kills: winner.kills, survivalMs: Date.now() - this.gameStartTime } : null
      });
    }
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

  get isFull() { return this.players.size >= 8; }
  get isEmpty() { return this.players.size === 0; }
}
