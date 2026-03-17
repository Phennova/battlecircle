/**
 * Bot Behavior Implementations
 *
 * Each behavior function takes (bot, context) and returns { score, action }
 * where action is { type, goalX, goalY, shooting, throwGrenade, useHeal, reload, ... }
 */

import { WEAPONS, AMMO_TYPES } from '../shared/weapons.js';
import { PLAYER_RADIUS } from '../shared/constants.js';

/**
 * Create all behaviors for a bot. Returns an array of behavior functions.
 */
export function createBehaviors(modeConfig) {
  const behaviors = [
    zoneSafety,
    fleeAndHeal,
    fleeAndFindHeals,
    lootWeaponUnarmed,
    swapWeaponDesperate,
    reloadUrgent,
    throwGrenade,
    combatEngage,
    dodgeThreat,
    reloadSafe,
    swapWeaponUpgrade,
    lootWeapon,
    lootAmmo,
    lootHeal,
    huntEnemy,
    patrol
  ];

  // Add game-mode specific behaviors
  if (modeConfig.ctf) {
    behaviors.push(ctfGrabFlag, ctfReturnFlag, ctfDefendZone);
  }

  if (modeConfig.hasZone) {
    behaviors.push(zoneMoveInward);
  }

  return behaviors;
}

// ────────────────────────────────────────────────────
// SURVIVAL BEHAVIORS
// ────────────────────────────────────────────────────

function zoneSafety(bot, ctx) {
  if (!ctx.zone || !ctx.zone.active) return { score: 0 };
  const dx = bot.x - ctx.zone.centerX;
  const dy = bot.y - ctx.zone.centerY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= ctx.zone.currentRadius - 50) return { score: 0 };

  return {
    score: 110,
    goalX: ctx.zone.centerX,
    goalY: ctx.zone.centerY,
    type: 'move'
  };
}

function zoneMoveInward(bot, ctx) {
  if (!ctx.zone || !ctx.zone.active) return { score: 0 };
  const dx = bot.x - ctx.zone.centerX;
  const dy = bot.y - ctx.zone.centerY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // If in outer 30% of safe area, start moving in
  if (dist < ctx.zone.currentRadius * 0.7) return { score: 0 };

  return {
    score: 20,
    goalX: ctx.zone.centerX + (Math.random() - 0.5) * ctx.zone.currentRadius * 0.3,
    goalY: ctx.zone.centerY + (Math.random() - 0.5) * ctx.zone.currentRadius * 0.3,
    type: 'move'
  };
}

function fleeAndHeal(bot, ctx) {
  if (bot.health >= 30 || !bot.heal || bot.heal.count <= 0) return { score: 0 };

  // Need to get to cover first
  const hasCover = !ctx.nearestEnemy || !ctx.canSeeEnemy;

  return {
    score: 100,
    type: hasCover ? 'heal' : 'flee_and_heal',
    useHeal: hasCover,
    flee: !hasCover,
    goalX: ctx.coverPos ? ctx.coverPos.x : bot.x,
    goalY: ctx.coverPos ? ctx.coverPos.y : bot.y
  };
}

function fleeAndFindHeals(bot, ctx) {
  if (bot.health >= 30 || (bot.heal && bot.heal.count > 0)) return { score: 0 };

  // Search for heal items on ground
  const healItem = findNearestItem(bot, ctx.visibleItems, ['bandage', 'medkit']);
  if (!healItem && bot._fleeTimer && Date.now() - bot._fleeTimer > 10000) return { score: 0 };

  if (!bot._fleeTimer) bot._fleeTimer = Date.now();

  return {
    score: 95,
    type: 'move',
    goalX: healItem ? healItem.x : (ctx.coverPos ? ctx.coverPos.x : bot.x + (Math.random() - 0.5) * 200),
    goalY: healItem ? healItem.y : (ctx.coverPos ? ctx.coverPos.y : bot.y + (Math.random() - 0.5) * 200)
  };
}

// ────────────────────────────────────────────────────
// WEAPON / AMMO BEHAVIORS
// ────────────────────────────────────────────────────

function lootWeaponUnarmed(bot, ctx) {
  if (bot.gun) return { score: 0 };
  const weaponItem = findNearestItem(bot, ctx.visibleItems, ['pistol', 'shotgun', 'rifle', 'smg', 'sniper']);
  if (!weaponItem) {
    // No weapon visible — wander toward buildings to find one
    if (!bot._lootPatrolGoal || distSq(bot, bot._lootPatrolGoal) < 3600) {
      // Pick a random building to search
      const buildings = ctx.buildings || [];
      if (buildings.length > 0) {
        const b = buildings[Math.floor(Math.random() * buildings.length)];
        bot._lootPatrolGoal = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      } else {
        bot._lootPatrolGoal = {
          x: 200 + Math.random() * (ctx.map.width - 400),
          y: 200 + Math.random() * (ctx.map.height - 400)
        };
      }
    }
    return { score: 95, type: 'patrol_for_loot', goalX: bot._lootPatrolGoal.x, goalY: bot._lootPatrolGoal.y };
  }

  return {
    score: 95,
    type: 'move_and_pickup',
    goalX: weaponItem.x,
    goalY: weaponItem.y
  };
}

function swapWeaponDesperate(bot, ctx) {
  if (!bot.gun || bot.gun.magAmmo > 0) return { score: 0 };
  const ammoType = WEAPONS[bot.gun.type]?.ammoType;
  if (ammoType && bot.ammoReserve[ammoType] > 0) return { score: 0 };
  if (!ctx.nearestEnemy) return { score: 0 };

  // Look for any ground weapon nearby
  const weaponItem = findNearestItem(bot, ctx.visibleItems, ['pistol', 'shotgun', 'rifle', 'smg', 'sniper'], 200);
  if (!weaponItem) return { score: 0 };

  return {
    score: 92,
    type: 'move_and_pickup',
    goalX: weaponItem.x,
    goalY: weaponItem.y
  };
}

function swapWeaponUpgrade(bot, ctx) {
  if (!bot.gun || ctx.nearestEnemy) return { score: 0 };

  const currentScore = getWeaponScore(bot.gun.type, bot, ctx);
  const weaponItems = (ctx.visibleItems || []).filter(i => i.slot === 'gun');

  let bestItem = null;
  let bestScore = currentScore;
  for (const item of weaponItems) {
    const score = getWeaponScore(item.type, bot, ctx);
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  if (!bestItem) return { score: 0 };
  return {
    score: 38,
    type: 'move_and_pickup',
    goalX: bestItem.x,
    goalY: bestItem.y
  };
}

function lootWeapon(bot, ctx) {
  if (!bot.gun || ctx.nearestEnemy) return { score: 0 };
  const currentScore = getWeaponScore(bot.gun.type, bot, ctx);
  if (currentScore > 3) return { score: 0 }; // already have a decent weapon

  const weaponItem = findNearestItem(bot, ctx.visibleItems, ['pistol', 'shotgun', 'rifle', 'smg', 'sniper']);
  if (!weaponItem) return { score: 0 };

  return {
    score: 35,
    type: 'move_and_pickup',
    goalX: weaponItem.x,
    goalY: weaponItem.y
  };
}

function lootAmmo(bot, ctx) {
  if (!bot.gun || ctx.nearestEnemy) return { score: 0 };
  const ammoType = WEAPONS[bot.gun.type]?.ammoType;
  if (!ammoType || bot.ammoReserve[ammoType] > 20) return { score: 0 };

  const ammoItem = findNearestItem(bot, ctx.visibleItems, [`${ammoType}_ammo`], 400);
  // Ammo auto-collects, so just walk near it
  if (!ammoItem) return { score: 0 };

  return {
    score: 30,
    type: 'move',
    goalX: ammoItem.x,
    goalY: ammoItem.y
  };
}

function lootHeal(bot, ctx) {
  if (bot.health > 70 || (bot.heal && bot.heal.count > 0)) return { score: 0 };
  if (ctx.nearestEnemy) return { score: 0 };

  const healItem = findNearestItem(bot, ctx.visibleItems, ['bandage', 'medkit']);
  if (!healItem) return { score: 0 };

  return {
    score: 25,
    type: 'move_and_pickup',
    goalX: healItem.x,
    goalY: healItem.y
  };
}

// ────────────────────────────────────────────────────
// COMBAT BEHAVIORS
// ────────────────────────────────────────────────────

function combatEngage(bot, ctx) {
  if (!ctx.nearestEnemy || !ctx.canSeeEnemy) return { score: 0 };

  // If unarmed and enemy is visible, FLEE instead of standing still
  if (!bot.gun) {
    const dx = bot.x - ctx.nearestEnemy.x;
    const dy = bot.y - ctx.nearestEnemy.y;
    const fleeAngle = Math.atan2(dy, dx);
    return {
      score: 97, // higher than lootWeaponUnarmed (95) — survival first
      type: 'move',
      goalX: bot.x + Math.cos(fleeAngle) * 300,
      goalY: bot.y + Math.sin(fleeAngle) * 300
    };
  }

  let score = 80;
  if (bot.health > 70 && bot.gun.magAmmo > 3) score += 15;
  if (bot.health < 25) score -= 30;
  if (bot.gun.magAmmo < 3) score -= 20;

  // Close range enemy boost — can't ignore someone right next to you
  if (ctx.nearestEnemyDist < 150) score += 10;

  return {
    score: Math.max(0, score),
    type: 'combat',
    targetId: ctx.nearestEnemy.id
  };
}

function reloadUrgent(bot, ctx) {
  if (!bot.gun || bot.gun.magAmmo > 0) return { score: 0 };
  const ammoType = WEAPONS[bot.gun.type]?.ammoType;
  if (!ammoType || bot.ammoReserve[ammoType] <= 0) return { score: 0 };
  if (!ctx.nearestEnemy) return { score: 0 }; // not urgent if no enemies

  return {
    score: 90,
    type: 'cover_and_reload',
    goalX: ctx.coverPos ? ctx.coverPos.x : bot.x,
    goalY: ctx.coverPos ? ctx.coverPos.y : bot.y
  };
}

function reloadSafe(bot, ctx) {
  if (!bot.gun) return { score: 0 };
  const weapon = WEAPONS[bot.gun.type];
  if (!weapon) return { score: 0 };
  if (bot.gun.magAmmo > weapon.magSize * 0.3) return { score: 0 };
  const ammoType = weapon.ammoType;
  if (!ammoType || bot.ammoReserve[ammoType] <= 0) return { score: 0 };
  if (ctx.nearestEnemy && ctx.canSeeEnemy) return { score: 0 }; // not safe

  return {
    score: 40,
    type: 'reload'
  };
}

function throwGrenade(bot, ctx) {
  if (!bot.grenade || bot.grenade.count <= 0) return { score: 0 };
  if (!ctx.nearestEnemy || !ctx.canSeeEnemy) return { score: 0 };

  const dx = ctx.nearestEnemy.x - bot.x;
  const dy = ctx.nearestEnemy.y - bot.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Don't throw frags too close
  if (bot.grenade.type === 'frag' && dist < 100) return { score: 0 };

  return {
    score: 85,
    type: 'throw_grenade',
    angle: Math.atan2(dy, dx)
  };
}

function dodgeThreat(bot, ctx) {
  if (!ctx.nearbyGrenade && !ctx.sniperLineNearby) return { score: 0 };

  // Move perpendicular to the threat
  let dodgeAngle;
  if (ctx.nearbyGrenade) {
    const dx = bot.x - ctx.nearbyGrenade.x;
    const dy = bot.y - ctx.nearbyGrenade.y;
    dodgeAngle = Math.atan2(dy, dx) + (Math.random() < 0.5 ? 0.5 : -0.5);
  } else {
    dodgeAngle = bot.angle + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
  }

  return {
    score: 70,
    type: 'move',
    goalX: bot.x + Math.cos(dodgeAngle) * 100,
    goalY: bot.y + Math.sin(dodgeAngle) * 100
  };
}

// ────────────────────────────────────────────────────
// SEARCH / PATROL BEHAVIORS
// ────────────────────────────────────────────────────

function huntEnemy(bot, ctx) {
  if (ctx.nearestEnemy && ctx.canSeeEnemy) return { score: 0 };
  if (!ctx.modeRequiresKills) return { score: 0 };

  // Use last known enemy or sound, otherwise persist a hunt goal
  if (ctx.lastKnownEnemy) {
    bot._huntGoal = { x: ctx.lastKnownEnemy.x, y: ctx.lastKnownEnemy.y };
  } else if (ctx.soundSource) {
    bot._huntGoal = { x: ctx.soundSource.x, y: ctx.soundSource.y };
  }

  // Pick a new random hunt goal if we don't have one or we reached it
  if (!bot._huntGoal || distSq(bot, bot._huntGoal) < 3600) {
    bot._huntGoal = {
      x: 200 + Math.random() * (ctx.map.width - 400),
      y: 200 + Math.random() * (ctx.map.height - 400)
    };
  }

  return {
    score: 45,
    type: 'move',
    goalX: bot._huntGoal.x, goalY: bot._huntGoal.y
  };
}

function patrol(bot, ctx) {
  // Pick a random destination if we don't have one or reached it
  if (!bot._patrolGoal || distSq(bot, bot._patrolGoal) < 2500) {
    bot._patrolGoal = {
      x: 100 + Math.random() * (ctx.map.width - 200),
      y: 100 + Math.random() * (ctx.map.height - 200)
    };
  }

  return {
    score: 10,
    type: 'move',
    goalX: bot._patrolGoal.x,
    goalY: bot._patrolGoal.y
  };
}

// ────────────────────────────────────────────────────
// CTF BEHAVIORS
// ────────────────────────────────────────────────────

function ctfGrabFlag(bot, ctx) {
  if (!ctx.ctfRole || ctx.ctfRole !== 'attacker') return { score: 0 };
  if (bot._carryingFlag) return { score: 0 };
  const enemyFlag = ctx.flags?.find(f => f.teamIndex !== bot.team);
  if (!enemyFlag || enemyFlag.state === 'carried') return { score: 0 };

  return {
    score: 60,
    type: 'move',
    goalX: enemyFlag.zoneX,
    goalY: enemyFlag.zoneY
  };
}

function ctfReturnFlag(bot, ctx) {
  if (!bot._carryingFlag) return { score: 0 };

  // Beeline to own territory
  const midline = ctx.map.width / 2;
  const goalX = bot.team === 0 ? midline - 100 : midline + 100;

  return {
    score: 55,
    type: 'move',
    goalX,
    goalY: bot.y // stay on same Y, just cross midline
  };
}

function ctfDefendZone(bot, ctx) {
  if (!ctx.ctfRole || ctx.ctfRole !== 'defender') return { score: 0 };
  const ownFlag = ctx.flags?.find(f => f.teamIndex === bot.team);
  if (!ownFlag) return { score: 0 };

  return {
    score: 50,
    type: 'move',
    goalX: ownFlag.zoneX + (Math.random() - 0.5) * 80,
    goalY: ownFlag.zoneY + (Math.random() - 0.5) * 80
  };
}

// ────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────

function findNearestItem(bot, items, types, maxDist) {
  if (!items) return null;
  maxDist = maxDist || 600;
  let nearest = null;
  let nearestDist = maxDist;

  for (const item of items) {
    if (!types.includes(item.type)) continue;
    const d = Math.sqrt((item.x - bot.x) ** 2 + (item.y - bot.y) ** 2);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = item;
    }
  }
  return nearest;
}

function getWeaponScore(type, bot, ctx) {
  const pref = bot._weaponPrefs?.[type] || 0.5;
  // Check if indoor
  const indoor = ctx.buildings?.some(b =>
    bot.x >= b.x && bot.x <= b.x + b.w && bot.y >= b.y && bot.y <= b.y + b.h
  );

  const tiers = indoor
    ? { shotgun: 5, smg: 4, rifle: 3, pistol: 2, sniper: 1 }
    : { sniper: 5, rifle: 4, smg: 3, shotgun: 2, pistol: 1 };

  return (tiers[type] || 1) * pref;
}

function distSq(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
