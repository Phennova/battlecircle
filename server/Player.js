import { PLAYER_RADIUS, PLAYER_SPEED, PLAYER_HP } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';

export class Player {
  constructor(id, spawnX, spawnY, name) {
    this.id = id;
    this.name = name;
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
    this.ammoReserve = { light: 0, shells: 0, heavy: 0 };

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

    // Reloading state
    this.reloading = false;
    this.reloadingUntil = 0;

    // Stats
    this.kills = 0;
    this.damageDealt = 0;
    this.placement = 0;
    this.joinedAt = Date.now();
  }

  toSnapshot() {
    return {
      id: this.id,
      name: this.name,
      x: this.x,
      y: this.y,
      angle: this.angle,
      health: this.health,
      alive: this.alive,
      gun: this.gun ? { type: this.gun.type, magAmmo: this.gun.magAmmo, magSize: WEAPONS[this.gun.type].magSize } : null,
      grenade: this.grenade,
      heal: this.heal,
      ammoReserve: this.ammoReserve,
      healing: this.healing,
      reloading: this.reloading,
      kills: this.kills
    };
  }
}
