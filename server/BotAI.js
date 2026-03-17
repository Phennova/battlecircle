/**
 * Bot AI Controller
 *
 * Main orchestrator that runs each tick. Evaluates all behaviors,
 * picks the highest priority, and translates the action into player input.
 */

import { writeFileSync, appendFileSync } from 'fs';
import { createBehaviors } from './BotBehaviors.js';
import {
  assessThreats, decideEngagement, calculateAim,
  smoothAim, shouldFire, evaluateGrenade, evaluateSniper
} from './BotCombat.js';
import { WEAPONS } from '../shared/weapons.js';
import { PLAYER_RADIUS, PICKUP_RANGE } from '../shared/constants.js';

export class BotAI {
  constructor(bot, gameRoom) {
    this.bot = bot;
    this.room = gameRoom;
    this.behaviors = createBehaviors(gameRoom.mode);

    // Navigation state
    this.currentPath = [];
    this.pathGoalX = 0;
    this.pathGoalY = 0;
    this.pathRecalcTimer = 0;
    this.stuckTimer = 0;
    this.lastPos = { x: bot.x, y: bot.y };

    // Awareness
    this.memory = []; // { id, x, y, timestamp } - last known enemy positions
    this.soundSources = []; // { x, y, timestamp }
    this.dangerZones = []; // { cells, expireAt }

    // Combat state
    this.targetId = null;
    this.currentBehavior = null;

    // Weapon preferences (random per bot)
    bot._weaponPrefs = {
      pistol: 0.2 + Math.random() * 0.3,
      shotgun: 0.3 + Math.random() * 0.6,
      rifle: 0.3 + Math.random() * 0.6,
      smg: 0.3 + Math.random() * 0.6,
      sniper: 0.2 + Math.random() * 0.5
    };

    // CTF role
    this.ctfRole = null;

    // Timers
    bot._fleeTimer = null;
    bot._burstState = null;
    bot._sniperState = null;
    bot._patrolGoal = null;
    bot._spawnTime = Date.now();
  }

  /**
   * Run one tick of AI. Call from GameRoom._tick().
   */
  tick(dt) {
    const bot = this.bot;
    if (!bot.alive) return;

    // Update awareness
    this._updateAwareness(dt);

    // Stuck detection — runs BEFORE behavior evaluation
    this._checkStuck(dt);

    // Build context for behaviors
    const ctx = this._buildContext();

    // Score all behaviors — committed goal system
    // Bot commits to a goal and only switches if something significantly more
    // important comes up (score exceeds committed goal by 15+)
    let bestScore = -1;
    let bestAction = null;
    const allScores = [];
    const COMMITMENT_BONUS = 15; // how much extra priority the current goal gets

    for (const behavior of this.behaviors) {
      const result = behavior(bot, ctx);
      if (result.score > 0) {
        // Commitment bonus: current behavior gets a significant bonus
        // so the bot doesn't switch unless something much more important happens
        const isCommitted = this.currentBehavior === result.type;
        const bonus = isCommitted ? COMMITMENT_BONUS : 0;
        const effectiveScore = result.score + bonus;
        allScores.push({ name: behavior.name, score: result.score, type: result.type });
        if (effectiveScore > bestScore) {
          bestScore = effectiveScore;
          bestAction = result;
        }
      }
    }

    // Also commit to the goal position — don't change goalX/goalY unless
    // switching to a different behavior type
    if (bestAction && this.currentBehavior === bestAction.type && this._committedGoal) {
      // Keep the committed goal position unless we've reached it
      const distToGoal = Math.sqrt(
        (bot.x - this._committedGoal.x) ** 2 + (bot.y - this._committedGoal.y) ** 2
      );
      if (distToGoal > 40) {
        bestAction.goalX = this._committedGoal.x;
        bestAction.goalY = this._committedGoal.y;
      } else {
        // Reached goal, clear commitment
        this._committedGoal = null;
      }
    } else if (bestAction && bestAction.goalX !== undefined) {
      // New behavior — commit to its goal
      this._committedGoal = { x: bestAction.goalX, y: bestAction.goalY };
    }

    // Debug logging (throttled to once per second per bot)
    if (!this._lastLogTime || Date.now() - this._lastLogTime > 1000) {
      this._lastLogTime = Date.now();
      const top3 = allScores.sort((a, b) => b.score - a.score).slice(0, 3);
      const hasGun = bot.gun ? `${bot.gun.type}(${bot.gun.magAmmo})` : 'UNARMED';
      const hp = Math.round(bot.health);
      const enemies = ctx.visibleEnemies.length;
      const items = ctx.visibleItems.length;
      const pathLen = this.currentPath.length;
      const goal = bestAction ? `${bestAction.type}` : 'none';
      const goalPos = bestAction?.goalX ? `(${Math.round(bestAction.goalX)},${Math.round(bestAction.goalY)})` : '';

      const logLine = `[BOT ${bot.name}] HP:${hp} Gun:${hasGun} ` +
        `Enemies:${enemies} Items:${items} Path:${pathLen} ` +
        `Action:${goal}${goalPos} ` +
        `Scores:[${top3.map(s => `${s.name}:${s.score}`).join(', ')}] ` +
        `Pos:(${Math.round(bot.x)},${Math.round(bot.y)}) ` +
        `Input:${bot.input.up?'U':''}${bot.input.down?'D':''}${bot.input.left?'L':''}${bot.input.right?'R':''}${bot.input.shooting?'S':''}`;
      console.log(logLine);
      try { appendFileSync('/Users/soren/Desktop/Battleroyale/bot_debug.log', logLine + '\n'); } catch(e) {}
    }

    // Execute the chosen action
    if (bestAction) {
      this.currentBehavior = bestAction.type;
      this._executeAction(bestAction, ctx, dt);
    }
  }

  /**
   * Build context object for behavior evaluation.
   */
  _buildContext() {
    const bot = this.bot;
    const room = this.room;
    const allWalls = room.allWalls;

    // Find visible enemies (same fog of war as players)
    const visibleEnemies = [];
    const visibleItems = [];

    room.players.forEach((p) => {
      if (p.id === bot.id || !p.alive) return;
      if (room.mode.teams && p.team === bot.team) return; // skip teammates

      // Simple LOS check (raycast)
      if (this._hasLOS(bot.x, bot.y, p.x, p.y, allWalls)) {
        const dist = Math.sqrt((p.x - bot.x) ** 2 + (p.y - bot.y) ** 2);
        if (dist < 600) { // vision range
          visibleEnemies.push(p);
          // Update memory
          this._rememberEnemy(p);
        }
      }
    });

    // Visible ground items
    for (const item of room.groundItems) {
      const dist = Math.sqrt((item.x - bot.x) ** 2 + (item.y - bot.y) ** 2);
      if (dist < 400 && this._hasLOS(bot.x, bot.y, item.x, item.y, allWalls)) {
        visibleItems.push(item);
      }
    }

    // Threat assessment
    const threats = assessThreats(bot, visibleEnemies);
    const nearestThreat = threats.length > 0 ? threats[0] : null;

    // Find cover relative to nearest threat
    let coverPos = null;
    if (nearestThreat && room.navGrid) {
      coverPos = room.navGrid.findCover(
        bot.x, bot.y,
        nearestThreat.enemy.x, nearestThreat.enemy.y,
        allWalls, 200
      );
    }

    // Check for nearby grenades
    let nearbyGrenade = null;
    for (const g of room.grenades) {
      const dist = Math.sqrt((g.x - bot.x) ** 2 + (g.y - bot.y) ** 2);
      if (dist < 120 && g.type === 'frag') {
        nearbyGrenade = g;
        break;
      }
    }

    // Last known enemy from memory
    const now = Date.now();
    const recentMemory = this.memory.filter(m => now - m.timestamp < 5000);
    const lastKnownEnemy = recentMemory.length > 0 ? recentMemory[0] : null;

    // Recent sound source
    const recentSound = this.soundSources.find(s => now - s.timestamp < 3000);

    return {
      map: room.map,
      zone: room.zone,
      allWalls,
      buildings: room.map.buildings,
      visibleEnemies,
      visibleItems,
      nearestEnemy: nearestThreat?.enemy || null,
      nearestEnemyDist: nearestThreat?.dist || Infinity,
      canSeeEnemy: nearestThreat != null,
      coverPos,
      nearbyGrenade,
      sniperLineNearby: false, // TODO: detect from sniperLine events
      lastKnownEnemy,
      soundSource: recentSound,
      modeRequiresKills: !room.mode.ctf,
      flags: room.flags,
      ctfRole: this.ctfRole,
      dangerCells: this._getActiveDangerCells()
    };
  }

  /**
   * Execute the chosen behavior action by setting bot input.
   */
  _executeAction(action, ctx, dt) {
    const bot = this.bot;

    // If escaping from stuck, don't reset input — let the escape direction apply
    if (this._escaping) {
      this._escaping = false;
      return; // skip entire action this tick, just move in escape direction
    }

    // Reset input
    bot.input.up = false;
    bot.input.down = false;
    bot.input.left = false;
    bot.input.right = false;
    bot.input.shooting = false;
    bot.input.scoping = false;

    switch (action.type) {
      case 'move':
      case 'move_and_pickup':
      case 'patrol_for_loot':
        this._navigateTo(action.goalX || bot.x, action.goalY || bot.y, ctx, dt);
        // Always try to pick up nearby equipment while moving
        this._opportunisticPickup(ctx);
        break;

      case 'combat': {
        const enemy = ctx.nearestEnemy;
        if (!enemy) break;

        const dist = ctx.nearestEnemyDist;
        const weapon = bot.gun ? WEAPONS[bot.gun.type] : null;
        const engagement = decideEngagement(bot, enemy, dist);

        // Aim at enemy
        if (weapon) {
          const aimAngle = calculateAim(bot, enemy, weapon);
          bot.angle = smoothAim(bot.angle, aimAngle, dt);
          bot.input.angle = bot.angle;
        }

        // Movement based on engagement — never get closer than 50px
        if (engagement === 'push') {
          if (dist > 50) {
            this._navigateTo(enemy.x, enemy.y, ctx, dt);
          }
          // If within 50px, stop pushing — just shoot
        } else if (engagement === 'retreat') {
          const awayAngle = Math.atan2(bot.y - enemy.y, bot.x - enemy.x);
          this._navigateTo(
            bot.x + Math.cos(awayAngle) * 150,
            bot.y + Math.sin(awayAngle) * 150,
            ctx, dt
          );
        } else if (engagement === 'flank') {
          const perpAngle = Math.atan2(enemy.y - bot.y, enemy.x - bot.x) + Math.PI / 2;
          this._navigateTo(
            bot.x + Math.cos(perpAngle) * 100,
            bot.y + Math.sin(perpAngle) * 100,
            ctx, dt
          );
        }
        // 'hold' = don't move

        // Shooting
        if (weapon && weapon.name !== 'Sniper') {
          if (shouldFire(bot, weapon, dist, dt)) {
            bot.input.shooting = true;
          }
        } else if (weapon && weapon.name === 'Sniper') {
          const sniperAction = evaluateSniper(bot, enemy, dist);
          if (sniperAction) {
            if (sniperAction.action === 'scope') {
              bot.input.scoping = true;
            } else if (sniperAction.action === 'fire') {
              this._emitAction('sniperFire', { angle: sniperAction.angle });
            }
          }
        }

        // Evaluate grenade opportunity
        const grenAction = evaluateGrenade(bot, ctx.visibleEnemies, ctx.allWalls);
        if (grenAction && grenAction.throw) {
          bot.angle = grenAction.angle;
          bot.input.angle = grenAction.angle;
          this._emitAction('throwGrenade');
        }
        break;
      }

      case 'heal':
      case 'flee_and_heal':
        if (action.flee) {
          this._navigateTo(action.goalX, action.goalY, ctx, dt);
        }
        if (action.useHeal && !bot.healing) {
          this._emitAction('useHeal');
        }
        break;

      case 'cover_and_reload':
        if (ctx.coverPos && !bot.reloading) {
          const distToCover = Math.sqrt((ctx.coverPos.x - bot.x) ** 2 + (ctx.coverPos.y - bot.y) ** 2);
          if (distToCover > 30) {
            this._navigateTo(ctx.coverPos.x, ctx.coverPos.y, ctx, dt);
          } else {
            this._emitAction('reload');
          }
        } else if (!bot.reloading) {
          // No cover available, reload while strafing
          const strafeAngle = bot.angle + Math.PI / 2;
          this._navigateTo(
            bot.x + Math.cos(strafeAngle) * 50,
            bot.y + Math.sin(strafeAngle) * 50,
            ctx, dt
          );
          this._emitAction('reload');
        }
        break;

      case 'reload':
        if (!bot.reloading) {
          this._emitAction('reload');
        }
        break;

      case 'throw_grenade':
        bot.angle = action.angle;
        bot.input.angle = action.angle;
        this._emitAction('throwGrenade');
        break;

      default:
        // Unknown action, do nothing
        break;
    }
  }

  /**
   * Navigate toward a world position using hybrid pathfinding.
   */
  _navigateTo(goalX, goalY, ctx, dt) {
    const bot = this.bot;
    const navGrid = this.room.navGrid;

    // (escaping check now handled in _executeAction)

    // If bot is on a blocked cell, override goal to nearest walkable cell
    if (navGrid) {
      const myCell = navGrid.worldToCell(bot.x, bot.y);
      if (!navGrid.isWalkable(myCell.c, myCell.r)) {
        const nearest = navGrid._findNearestWalkable(myCell.c, myCell.r);
        if (nearest) {
          const wp = navGrid.cellToWorld(nearest.c, nearest.r);
          goalX = wp.x;
          goalY = wp.y;
        }
      }
    }

    // Recalculate path periodically or when goal changes significantly
    this.pathRecalcTimer -= dt;
    const goalChanged = Math.abs(goalX - this.pathGoalX) > 60 || Math.abs(goalY - this.pathGoalY) > 60;

    if ((this.pathRecalcTimer <= 0 || goalChanged || this.currentPath.length === 0) && navGrid) {
      this.currentPath = navGrid.findPath(bot.x, bot.y, goalX, goalY, this._getActiveDangerCells());
      this.pathGoalX = goalX;
      this.pathGoalY = goalY;
      this.pathRecalcTimer = 0.5;

      // Debug: log pathfinding failures
      if (this.currentPath.length === 0 && this._lastLogTime && Date.now() - this._lastPathLog > 5000) {
        this._lastPathLog = Date.now();
        const startCell = navGrid.worldToCell(bot.x, bot.y);
        const endCell = navGrid.worldToCell(goalX, goalY);
        const startWalk = navGrid.isWalkable(startCell.c, startCell.r);
        const endWalk = navGrid.isWalkable(endCell.c, endCell.r);
        console.log(`[PATH FAIL ${bot.name}] from (${Math.round(bot.x)},${Math.round(bot.y)}) cell(${startCell.c},${startCell.r}) walkable:${startWalk} -> (${Math.round(goalX)},${Math.round(goalY)}) cell(${endCell.c},${endCell.r}) walkable:${endWalk}`);
      }
      if (!this._lastPathLog) this._lastPathLog = Date.now();
    }

    // Follow the path — if empty, move directly toward goal (fallback)
    let targetX = goalX;
    let targetY = goalY;

    if (this.currentPath.length > 0) {
      const nextWaypoint = this.currentPath[0];
      const distToWaypoint = Math.sqrt((nextWaypoint.x - bot.x) ** 2 + (nextWaypoint.y - bot.y) ** 2);

      if (distToWaypoint < 30) {
        this.currentPath.shift();
      }

      if (this.currentPath.length > 0) {
        targetX = this.currentPath[0].x;
        targetY = this.currentPath[0].y;
      }
    }

    // Check for closed doors on path and open them
    if (this.room.doors) {
      for (const door of this.room.doors) {
        if (!door.open) {
          const doorCX = door.wallRect.x + door.wallRect.w / 2;
          const doorCY = door.wallRect.y + door.wallRect.h / 2;
          const distToDoor = Math.sqrt((doorCX - bot.x) ** 2 + (doorCY - bot.y) ** 2);
          if (distToDoor < 60) {
            this._emitAction('pickup'); // opens door
          }
        }
      }
    }

    // Convert target to input directions
    const dx = targetX - bot.x;
    const dy = targetY - bot.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 5) {
      // Normalize direction and set input based on dominant axis
      const ndx = dx / dist;
      const ndy = dy / dist;

      // Use a dead zone of 0.3 to prevent jittery diagonal switching
      if (ndx > 0.3) bot.input.right = true;
      if (ndx < -0.3) bot.input.left = true;
      if (ndy > 0.3) bot.input.down = true;
      if (ndy < -0.3) bot.input.up = true;

      // Face movement direction when not in combat
      if (!this.targetId && this.currentBehavior !== 'combat') {
        bot.angle = smoothAim(bot.angle, moveAngle, dt);
        bot.input.angle = bot.angle;
      }
    }

    // (stuck detection moved to _checkStuck, runs in tick() before behaviors)
  }

  /**
   * Check if bot is stuck and force escape movement.
   */
  _checkStuck(dt) {
    const bot = this.bot;
    const movedDist = Math.sqrt((bot.x - this.lastPos.x) ** 2 + (bot.y - this.lastPos.y) ** 2);

    if (movedDist < 3) {
      this.stuckTimer += dt;
      this.stuckCount = (this.stuckCount || 0);

      if (this.stuckTimer > 0.3) {
        this.stuckTimer = 0;
        this.stuckCount++;
        this.currentPath = [];
        this.pathRecalcTimer = 0;

        // Clear all goals including committed goal
        bot._lootPatrolGoal = null;
        bot._huntGoal = null;
        bot._patrolGoal = null;
        this._committedGoal = null;
        this.currentBehavior = null;

        if (this.stuckCount > 4) {
          // Head toward map center
          this.stuckCount = 0;
          const centerX = this.room.map.width / 2 + (Math.random() - 0.5) * 300;
          const centerY = this.room.map.height / 2 + (Math.random() - 0.5) * 300;
          bot._lootPatrolGoal = { x: centerX, y: centerY };
          bot._huntGoal = { x: centerX, y: centerY };
        }

        // Set escape direction — cycle all 8 systematically
        this._escaping = true;
        const escapeDir = this.stuckCount % 8;
        const angles = [0, Math.PI/4, Math.PI/2, 3*Math.PI/4, Math.PI, -3*Math.PI/4, -Math.PI/2, -Math.PI/4];
        const chosen = angles[escapeDir];

        bot.input.up = false; bot.input.down = false;
        bot.input.left = false; bot.input.right = false;
        if (Math.cos(chosen) > 0.3) bot.input.right = true;
        if (Math.cos(chosen) < -0.3) bot.input.left = true;
        if (Math.sin(chosen) > 0.3) bot.input.down = true;
        if (Math.sin(chosen) < -0.3) bot.input.up = true;
      }
    } else {
      this.stuckTimer = 0;
      if (movedDist > 5) this.stuckCount = 0;
    }
    this.lastPos = { x: bot.x, y: bot.y };
  }

  /**
   * Try to pick up nearby equipment items while passing by.
   */
  _opportunisticPickup(ctx) {
    const bot = this.bot;
    for (const item of (ctx.visibleItems || [])) {
      if (item.slot === 'ammo') continue; // ammo auto-collects
      const dist = Math.sqrt((item.x - bot.x) ** 2 + (item.y - bot.y) ** 2);
      if (dist < PICKUP_RANGE + 10) {
        this._emitAction('pickup');
        return;
      }
    }
  }

  /**
   * Emit a game action (pickup, reload, heal, etc.)
   */
  _emitAction(action, data) {
    // Bots don't use sockets — directly call the handler on the game room
    this.room._handleBotAction(this.bot.id, action, data);
  }

  // ── Awareness ──

  _updateAwareness(dt) {
    const now = Date.now();
    // Clean old memory
    this.memory = this.memory.filter(m => now - m.timestamp < 5000);
    this.soundSources = this.soundSources.filter(s => now - s.timestamp < 3000);
    // Clean expired danger zones
    this.dangerZones = this.dangerZones.filter(d => now < d.expireAt);
  }

  _rememberEnemy(enemy) {
    const existing = this.memory.find(m => m.id === enemy.id);
    if (existing) {
      existing.x = enemy.x;
      existing.y = enemy.y;
      existing.timestamp = Date.now();
    } else {
      this.memory.push({ id: enemy.id, x: enemy.x, y: enemy.y, timestamp: Date.now() });
    }
  }

  hearGunshot(x, y) {
    const dist = Math.sqrt((x - this.bot.x) ** 2 + (y - this.bot.y) ** 2);
    if (dist < 400) {
      this.soundSources.push({ x, y, timestamp: Date.now() });
    }
  }

  addDangerZone(cells) {
    this.dangerZones.push({ cells, expireAt: Date.now() + 30000 });
  }

  _getActiveDangerCells() {
    const all = [];
    for (const dz of this.dangerZones) {
      all.push(...dz.cells);
    }
    return all;
  }

  _hasLOS(x1, y1, x2, y2, walls) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(dist / 5); // 5px steps to catch thin walls
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
}
