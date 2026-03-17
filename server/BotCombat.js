/**
 * Bot Combat AI
 *
 * Handles aiming, engagement decisions, shooting patterns,
 * threat assessment, and grenade logic.
 */

import { WEAPONS } from '../shared/weapons.js';
import { PLAYER_RADIUS } from '../shared/constants.js';

/**
 * Assess all visible enemies and return sorted by priority.
 */
export function assessThreats(bot, visibleEnemies) {
  return visibleEnemies.map(enemy => {
    let score = 0;

    // Distance (closer = more threatening)
    const dx = enemy.x - bot.x;
    const dy = enemy.y - bot.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    score += (600 - Math.min(dist, 600)) / 6; // 0-100 based on distance

    // Enemy aiming at us (check if their angle points toward us)
    const angleToUs = Math.atan2(bot.y - enemy.y, bot.x - enemy.x);
    const angleDiff = Math.abs(normalizeAngle(enemy.angle - angleToUs));
    if (angleDiff < 0.5) score += 40; // they're looking at us

    // Low HP enemy (easy kill)
    if (enemy.health < 30) score += 25;

    // Flag carrier (CTF priority)
    if (enemy._isCarrier) score += 50;

    return { enemy, score, dist };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Decide engagement type based on bot state.
 */
export function decideEngagement(bot, enemy, dist) {
  const hp = bot.health;
  const hasGoodWeapon = bot.gun && ['rifle', 'smg', 'shotgun', 'sniper'].includes(bot.gun.type);
  const magAmmo = bot.gun ? bot.gun.magAmmo : 0;
  const enemyLowHP = enemy.health < 40;

  if (hp > 60 && hasGoodWeapon && magAmmo > 3 && (enemyLowHP || dist < 300)) {
    return 'push'; // move toward enemy
  }
  if (hp < 30 || magAmmo === 0) {
    return 'retreat'; // break LOS, heal/reload
  }
  if (hp > 50 && magAmmo > 2 && dist > 200) {
    return 'flank'; // try to get a different angle
  }
  return 'hold'; // stay put, shoot from here
}

/**
 * Calculate aim angle toward a target with prediction and inaccuracy.
 */
export function calculateAim(bot, target, weapon) {
  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Lead the target based on their velocity and bullet travel time
  let aimX = target.x;
  let aimY = target.y;

  if (weapon && weapon.bulletSpeed > 0) {
    const travelTime = dist / weapon.bulletSpeed;
    // Estimate target velocity from input
    const inp = target.input || {};
    let tvx = ((inp.right ? 1 : 0) - (inp.left ? 1 : 0));
    let tvy = ((inp.down ? 1 : 0) - (inp.up ? 1 : 0));
    if (tvx !== 0 && tvy !== 0) {
      const len = Math.sqrt(tvx * tvx + tvy * tvy);
      tvx /= len;
      tvy /= len;
    }
    const targetSpeed = target.speed || 180;
    aimX += tvx * targetSpeed * travelTime;
    aimY += tvy * targetSpeed * travelTime;
  }

  let angle = Math.atan2(aimY - bot.y, aimX - bot.x);

  // Add inaccuracy based on distance
  const inaccuracy = 0.02 + (dist / 600) * 0.04; // 0.02-0.06 rad
  angle += (Math.random() - 0.5) * 2 * inaccuracy;

  return angle;
}

/**
 * Smoothly rotate bot angle toward target angle.
 * Returns the new angle after rotation this tick.
 */
export function smoothAim(currentAngle, targetAngle, dt) {
  const rotSpeed = 8; // rad/sec
  let diff = normalizeAngle(targetAngle - currentAngle);

  const maxRot = rotSpeed * dt;
  if (Math.abs(diff) < maxRot) {
    return targetAngle;
  }
  return currentAngle + Math.sign(diff) * maxRot;
}

/**
 * Decide whether the bot should fire this tick based on weapon firing patterns.
 */
export function shouldFire(bot, weapon, dist, dt) {
  if (!weapon || !bot.gun || bot.gun.magAmmo <= 0) return false;

  const type = weapon.name.toLowerCase();

  // Shotgun: only fire when close
  if (type === 'shotgun' && dist > 250) return false;

  // Sniper: handled separately via scope mechanic
  if (type === 'sniper') return false;

  // Burst fire patterns
  if (!bot._burstState) {
    bot._burstState = { firing: true, timer: 0, burstCount: 0 };
  }
  const bs = bot._burstState;
  bs.timer -= dt;

  if (type === 'smg') {
    // 8-15 round bursts with 200ms pauses
    if (bs.firing) {
      bs.burstCount++;
      if (bs.burstCount >= 8 + Math.floor(Math.random() * 8)) {
        bs.firing = false;
        bs.timer = 0.15 + Math.random() * 0.1;
        bs.burstCount = 0;
      }
      return true;
    } else if (bs.timer <= 0) {
      bs.firing = true;
      return true;
    }
    return false;
  }

  if (type === 'pistol') {
    // 2-3 shot bursts
    if (bs.firing) {
      bs.burstCount++;
      if (bs.burstCount >= 2 + Math.floor(Math.random() * 2)) {
        bs.firing = false;
        bs.timer = 0.3 + Math.random() * 0.2;
        bs.burstCount = 0;
      }
      return true;
    } else if (bs.timer <= 0) {
      bs.firing = true;
      return true;
    }
    return false;
  }

  // Rifle: single shots at fire rate (just hold fire)
  return true;
}

/**
 * Decide whether to throw a grenade and at what position.
 * Returns { throw: true, type: 'frag'|'smoke', targetX, targetY } or null.
 */
export function evaluateGrenade(bot, enemies, allWalls) {
  if (!bot.grenade || bot.grenade.count <= 0) return null;
  if (enemies.length === 0) return null;

  const grenType = bot.grenade.type;
  const nearestEnemy = enemies[0];
  const dx = nearestEnemy.x - bot.x;
  const dy = nearestEnemy.y - bot.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Don't throw frags at close range (self damage)
  if (grenType === 'frag' && dist < 100) return null;

  if (grenType === 'frag') {
    // Throw at enemy behind cover or clustered enemies
    const enemyBehindCover = !hasLineOfSightSimple(bot.x, bot.y, nearestEnemy.x, nearestEnemy.y, allWalls);

    if (enemyBehindCover || enemies.length >= 2) {
      return {
        throw: true,
        type: 'frag',
        targetX: nearestEnemy.x,
        targetY: nearestEnemy.y,
        angle: Math.atan2(dy, dx)
      };
    }
  }

  if (grenType === 'smoke') {
    // Smoke at own feet for escape
    if (bot.health < 40) {
      return {
        throw: true,
        type: 'smoke',
        targetX: bot.x,
        targetY: bot.y,
        angle: bot.angle
      };
    }
  }

  return null;
}

/**
 * Check if a sniper should scope and fire.
 */
export function evaluateSniper(bot, target, dist) {
  if (!bot.gun || bot.gun.type !== 'sniper') return null;
  if (bot.gun.magAmmo <= 0) return null;
  if (dist < 100) return null; // too close for sniper

  // Scope for 0.5-1s then fire
  if (!bot._sniperState) {
    bot._sniperState = { scoping: false, scopeStart: 0, scopeDuration: 0 };
  }

  const ss = bot._sniperState;
  if (!ss.scoping) {
    ss.scoping = true;
    ss.scopeStart = Date.now();
    ss.scopeDuration = 500 + Math.random() * 500;
    return { action: 'scope' };
  }

  if (Date.now() - ss.scopeStart >= ss.scopeDuration) {
    ss.scoping = false;
    return { action: 'fire', angle: calculateAim(bot, target, WEAPONS.sniper) };
  }

  return { action: 'scope' };
}

// Helpers

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function hasLineOfSightSimple(x1, y1, x2, y2, walls) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(dist / 10);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = x1 + dx * t;
    const py = y1 + dy * t;
    for (const wall of walls) {
      if (px >= wall.x && px <= wall.x + wall.w &&
          py >= wall.y && py <= wall.y + wall.h) {
        return false;
      }
    }
  }
  return true;
}
