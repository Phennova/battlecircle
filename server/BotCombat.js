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
 * Uses position tracking to estimate smoothed velocity instead of
 * instantaneous input, preventing overshoot on strafing targets.
 */
export function calculateAim(bot, target, weapon) {
  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Track target positions over time for velocity estimation
  if (!bot._aimTracker) bot._aimTracker = {};
  if (!bot._aimTracker[target.id]) {
    bot._aimTracker[target.id] = { positions: [], avgVx: 0, avgVy: 0 };
  }
  const tracker = bot._aimTracker[target.id];
  const now = Date.now();

  // Sample position every 100ms
  const lastSample = tracker.positions[tracker.positions.length - 1];
  if (!lastSample || now - lastSample.t > 100) {
    tracker.positions.push({ x: target.x, y: target.y, t: now });
    // Keep last 15 samples (~1.5 seconds of history)
    if (tracker.positions.length > 15) tracker.positions.shift();
  }

  // Calculate smoothed velocity from position history
  let aimX = target.x;
  let aimY = target.y;

  if (weapon && tracker.positions.length >= 3) {
    const samples = tracker.positions;
    const oldest = samples[0];
    const newest = samples[samples.length - 1];
    const trackDt = (newest.t - oldest.t) / 1000;

    if (trackDt > 0.1) {
      // Raw velocity over full tracking window
      const rawVx = (newest.x - oldest.x) / trackDt;
      const rawVy = (newest.y - oldest.y) / trackDt;

      // Exponential moving average to smooth out oscillation
      const smoothFactor = 0.3;
      tracker.avgVx = tracker.avgVx * (1 - smoothFactor) + rawVx * smoothFactor;
      tracker.avgVy = tracker.avgVy * (1 - smoothFactor) + rawVy * smoothFactor;

      // For strafing detection: check if recent positions oscillate
      // If the target reverses direction frequently, reduce lead amount
      let directionChanges = 0;
      for (let i = 2; i < samples.length; i++) {
        const prevDx = samples[i-1].x - samples[i-2].x;
        const currDx = samples[i].x - samples[i-1].x;
        if (prevDx * currDx < 0) directionChanges++; // X direction reversed
        const prevDy = samples[i-1].y - samples[i-2].y;
        const currDy = samples[i].y - samples[i-1].y;
        if (prevDy * currDy < 0) directionChanges++;
      }

      // Strafe factor: more reversals = aim more at center, less lead
      const strafeFactor = Math.max(0.1, 1 - directionChanges * 0.1);

      if (weapon.bulletSpeed > 0) {
        const travelTime = dist / weapon.bulletSpeed;
        aimX += tracker.avgVx * travelTime * strafeFactor;
        aimY += tracker.avgVy * travelTime * strafeFactor;
      }

      // For long range: also aim at average position center (strafe midpoint)
      if (dist > 300 && samples.length >= 6) {
        let sumX = 0, sumY = 0;
        for (const s of samples) { sumX += s.x; sumY += s.y; }
        const centerX = sumX / samples.length;
        const centerY = sumY / samples.length;

        // Blend between predicted position and center based on strafe amount
        const centerBlend = Math.min(0.5, directionChanges * 0.08);
        aimX = aimX * (1 - centerBlend) + centerX * centerBlend;
        aimY = aimY * (1 - centerBlend) + centerY * centerBlend;
      }
    }
  } else if (weapon && weapon.bulletSpeed > 0) {
    // Fallback: use input-based prediction if not enough tracking data
    const inp = target.input || {};
    let tvx = ((inp.right ? 1 : 0) - (inp.left ? 1 : 0));
    let tvy = ((inp.down ? 1 : 0) - (inp.up ? 1 : 0));
    if (tvx !== 0 && tvy !== 0) {
      const len = Math.sqrt(tvx * tvx + tvy * tvy);
      tvx /= len;
      tvy /= len;
    }
    const targetSpeed = target.speed || 180;
    const travelTime = dist / weapon.bulletSpeed;
    aimX += tvx * targetSpeed * travelTime;
    aimY += tvy * targetSpeed * travelTime;
  }

  let angle = Math.atan2(aimY - bot.y, aimX - bot.x);

  // Add inaccuracy based on distance (reduced at long range for better aim)
  const inaccuracy = 0.015 + (dist / 800) * 0.025;
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

  // Cooldown — don't throw more than once every 2 seconds
  const now = Date.now();
  if (bot._lastGrenadeTime && now - bot._lastGrenadeTime < 2000) return null;

  const grenType = bot.grenade.type;
  const nearestEnemy = enemies[0];
  const dx = nearestEnemy.x - bot.x;
  const dy = nearestEnemy.y - bot.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Don't throw frags at close range (self damage)
  if (grenType === 'frag' && dist < 100) return null;

  if (grenType === 'frag') {
    const enemyBehindCover = !hasLineOfSightSimple(bot.x, bot.y, nearestEnemy.x, nearestEnemy.y, allWalls);

    if (enemyBehindCover || enemies.length >= 2 || dist > 200) {
      // Track enemy movement to predict where they'll be
      if (!bot._enemyTracker) bot._enemyTracker = {};
      const tracker = bot._enemyTracker;
      if (!tracker[nearestEnemy.id]) {
        tracker[nearestEnemy.id] = { positions: [], lastUpdate: 0 };
      }
      const et = tracker[nearestEnemy.id];

      // Sample enemy position every 200ms
      if (now - et.lastUpdate > 200) {
        et.positions.push({ x: nearestEnemy.x, y: nearestEnemy.y, t: now });
        if (et.positions.length > 10) et.positions.shift();
        et.lastUpdate = now;
      }

      // Calculate average velocity from tracked positions
      let predictX = nearestEnemy.x;
      let predictY = nearestEnemy.y;
      if (et.positions.length >= 3) {
        const oldest = et.positions[0];
        const newest = et.positions[et.positions.length - 1];
        const trackDt = (newest.t - oldest.t) / 1000;
        if (trackDt > 0.1) {
          const vx = (newest.x - oldest.x) / trackDt;
          const vy = (newest.y - oldest.y) / trackDt;

          // Predict where enemy will be when grenade arrives
          // Grenade travel time = dist / 300 + fuse time (2.5s)
          const travelTime = dist / 300;
          const totalTime = travelTime + 1.5; // lead by 1.5s, not full fuse

          predictX = nearestEnemy.x + vx * totalTime;
          predictY = nearestEnemy.y + vy * totalTime;
        }
      }

      bot._lastGrenadeTime = now;
      const pdx = predictX - bot.x;
      const pdy = predictY - bot.y;
      return {
        throw: true,
        type: 'frag',
        targetX: predictX,
        targetY: predictY,
        angle: Math.atan2(pdy, pdx)
      };
    }
  }

  if (grenType === 'smoke') {
    if (bot.health < 40) {
      bot._lastGrenadeTime = now;
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
