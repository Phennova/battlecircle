import { Renderer } from './Renderer.js';
import { InputHandler } from './InputHandler.js';
import { ShadowCaster } from './ShadowCaster.js';
import { HUD } from './HUD.js';
import { PLAYER_RADIUS, PLAYER_SPEED, PLAYER_HP } from '/shared/constants.js';
import { resolveAgainstWalls } from '/shared/collision.js';
import { WEAPONS } from '/shared/weapons.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

const renderer = new Renderer(canvas, ctx);
const inputHandler = new InputHandler(canvas);
const shadowCaster = new ShadowCaster();
const hud = new HUD();

// Connect to server
const socket = io();
let myId = null;
let map = null;
let gameState = null;
let prevGameState = null;
let snapshotTime = 0;
let prevSnapshotTime = 0;
let gameActive = false;
let countdownEnd = null;

// Death and spectator state
let dead = false;
let spectating = false;
let spectateTargetId = null;
let deathTime = null;
let gameOverData = null;

// Client prediction
const inputBuffer = [];
let predictedX = 0, predictedY = 0;
let seq = 0;
let lastInputJSON = '';

// Effects
const effects = {
  explosions: [],
  hitFlash: null
};
let lastSniperFireTime = 0;
const killFeed = [];

// Warnings
let warning = null; // { text, time }
const tracerTrails = [];

// Player colors
const COLORS = ['#4a9eff', '#ff6b6b', '#50c878', '#ffc832', '#ff8c42', '#c77dff', '#64dfdf', '#ff5e78'];

// Lobby UI
const lobby = document.getElementById('lobby');
const lobbyStatus = lobby.querySelector('.status');
const readyBtn = document.getElementById('readyBtn');
const playerList = document.getElementById('playerList');
let isReady = false;

readyBtn.addEventListener('click', () => {
  isReady = !isReady;
  socket.emit('toggleReady');
  readyBtn.textContent = isReady ? 'Ready!' : 'Ready Up';
  readyBtn.style.background = isReady ? '#50c878' : '#555';
});

socket.on('roomJoined', (data) => {
  myId = data.playerId;
  map = data.map;
  renderer.setMap(map);
  shadowCaster.setWalls(renderer.allWalls);
  lobbyStatus.textContent = 'Waiting for players...';
  readyBtn.disabled = false;
});

socket.on('lobbyUpdate', (data) => {
  lobbyStatus.textContent = `${data.count} / ${data.max} players`;
  // Render player list with ready status
  playerList.innerHTML = data.players.map(p =>
    `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px;margin:4px 0;background:rgba(255,255,255,0.05);border-radius:6px">
      <span style="color:#ccc">${p.name}</span>
      <span style="color:${p.ready ? '#50c878' : '#888'};font-size:13px">${p.ready ? 'Ready' : 'Not Ready'}</span>
    </div>`
  ).join('');
});

socket.on('countdown', (data) => {
  countdownEnd = Date.now() + data.seconds * 1000;
  lobby.style.display = 'none';
  if (data.spawnPositions && data.spawnPositions[myId]) {
    predictedX = data.spawnPositions[myId].x;
    predictedY = data.spawnPositions[myId].y;
  }
});

socket.on('gameStart', () => {
  gameActive = true;
  countdownEnd = null;
});

socket.on('gameState', (state) => {
  // Track grenade removals for explosions
  if (gameState) {
    const oldIds = new Set(gameState.grenades.map(g => g.id));
    const newIds = new Set(state.grenades.map(g => g.id));
    for (const id of oldIds) {
      if (!newIds.has(id)) {
        const old = gameState.grenades.find(g => g.id === id);
        if (old && old.type !== 'smoke') {
          effects.explosions.push({ x: old.x, y: old.y, startTime: performance.now(), duration: 400 });
        }
      }
    }
    // Track sniper tracer trails
    const oldBullets = new Map(gameState.bullets.filter(b => b.type === 'sniper').map(b => [b.id, b]));
    for (const [id, old] of oldBullets) {
      if (!state.bullets.find(b => b.id === id)) {
        tracerTrails.push({ originX: old.originX, originY: old.originY, endX: old.x, endY: old.y, startTime: performance.now() });
      }
    }
  }

  prevGameState = gameState;
  prevSnapshotTime = snapshotTime;
  gameState = state;
  snapshotTime = performance.now();
});

socket.on('playerHit', (data) => {
  effects.hitFlash = { angle: data.angle, startTime: performance.now(), duration: 300 };
});

socket.on('playerKilled', (data) => {
  killFeed.push({ ...data, time: performance.now() });

  if (data.victimId === myId) {
    dead = true;
    deathTime = performance.now();
    // Show brief elimination overlay
    const overlay = document.getElementById('overlay');
    overlay.style.display = 'flex';
    const survivalMs = gameState ? gameState.gameElapsedMs : 0;
    const myData = gameState ? gameState.players.find(p => p.id === myId) : null;
    const kills = myData ? myData.kills : 0;
    const sec = Math.floor(survivalMs / 1000);
    overlay.innerHTML = `
      <h1 style="font-size:48px;color:#ff4444;letter-spacing:4px">ELIMINATED</h1>
      <p style="color:#aaa;margin:8px">Survived: ${Math.floor(sec/60)}m ${sec%60}s</p>
      <p style="color:#aaa;margin:8px">Kills: ${kills}</p>
    `;
    // After 2 seconds, switch to spectator mode
    setTimeout(() => {
      if (!gameOverData) {
        overlay.style.display = 'none';
        spectating = true;
        const alivePlayers = gameState ? gameState.players.filter(p => p.alive && p.id !== myId) : [];
        if (alivePlayers.length > 0) {
          spectateTargetId = alivePlayers[0].id;
        }
      }
    }, 2000);
  }
});

socket.on('gameOver', (data) => {
  gameOverData = data;
  spectating = false;
  gameActive = false;
  const overlay = document.getElementById('overlay');
  overlay.style.display = 'flex';

  const isWinner = data.winnerId === myId;
  const title = isWinner
    ? '<h1 style="font-size:48px;color:#ffc832;letter-spacing:4px;margin-bottom:16px">VICTORY</h1>'
    : '<h1 style="font-size:36px;color:#ff4444;letter-spacing:4px;margin-bottom:16px">GAME OVER</h1>';

  let leaderboardHTML = '';
  if (data.standings && data.standings.length > 0) {
    const me = gameState ? gameState.players.find(p => p.id === myId) : null;
    const myName = me ? me.name : '';
    const rows = data.standings.map(p => {
      const isMe = p.name === myName;
      const isFirst = p.placement === 1;
      const rowBg = isFirst ? 'rgba(255,200,50,0.15)' : isMe ? 'rgba(74,158,255,0.1)' : 'rgba(255,255,255,0.03)';
      const rowBorder = isFirst ? '1px solid rgba(255,200,50,0.3)' : isMe ? '1px solid rgba(74,158,255,0.2)' : 'none';
      const nameColor = isFirst ? '#ffc832' : '#ccc';
      return `<tr style="background:${rowBg};border:${rowBorder}">
        <td style="padding:6px 12px;color:#888">${p.placement}</td>
        <td style="padding:6px 12px;color:${nameColor}">${p.name}</td>
        <td style="padding:6px 12px;text-align:center;color:#ccc">${p.kills}</td>
        <td style="padding:6px 12px;text-align:center;color:#ccc">${p.damageDealt}</td>
      </tr>`;
    }).join('');

    leaderboardHTML = `
      <table style="border-collapse:collapse;margin:16px 0;font-size:13px;font-family:sans-serif;min-width:360px">
        <thead>
          <tr style="border-bottom:1px solid #444">
            <th style="padding:6px 12px;color:#888;text-align:left">#</th>
            <th style="padding:6px 12px;color:#888;text-align:left">Name</th>
            <th style="padding:6px 12px;color:#888;text-align:center">Kills</th>
            <th style="padding:6px 12px;color:#888;text-align:center">Damage</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  overlay.innerHTML = `
    ${title}
    ${leaderboardHTML}
    <button onclick="location.reload()" style="margin-top:12px;padding:12px 32px;font-size:18px;background:#4a9eff;color:#fff;border:none;border-radius:8px;cursor:pointer">Play Again</button>
  `;
});

// Input sending
function sendInput(inp) {
  const json = JSON.stringify(inp);
  if (json !== lastInputJSON) {
    socket.emit('playerInput', inp);
    lastInputJSON = json;
  }
}

// Bullet interpolation — extrapolate bullet positions based on their angle and speed
function getInterpolatedBullets(bullets) {
  // Extrapolate bullets forward for smooth rendering, but cap at half a tick
  // to avoid overshooting past where the server will detect a hit
  const elapsed = Math.min((performance.now() - snapshotTime) / 1000, 0.025);
  const BULLET_SPEEDS = { pistol: 500, shotgun: 450, rifle: 1200, smg: 600, sniper: 1800 };
  return bullets.map(b => {
    const speed = BULLET_SPEEDS[b.type] || 600;
    return {
      ...b,
      x: b.x + Math.cos(b.angle) * speed * elapsed,
      y: b.y + Math.sin(b.angle) * speed * elapsed
    };
  });
}

// Remote player interpolation
function getInterpolatedPlayer(playerId) {
  const curr = gameState.players.find(p => p.id === playerId);
  if (!prevGameState || !curr) return curr;
  const prev = prevGameState.players.find(p => p.id === playerId);
  if (!prev) return curr;

  const elapsed = performance.now() - snapshotTime;
  const interval = snapshotTime - prevSnapshotTime || 50;
  const t = Math.min(1, elapsed / interval);

  return {
    ...curr,
    x: prev.x + (curr.x - prev.x) * t,
    y: prev.y + (curr.y - prev.y) * t,
    angle: curr.angle
  };
}

// Spectator: Play Again click area
canvas.addEventListener('click', (e) => {
  if (spectating) {
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (cx >= canvas.width - 120 && cx <= canvas.width - 10 && cy >= 10 && cy <= 40) {
      location.reload();
    }
  }
});

let lastTime = performance.now();

function loop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;

  // Clean up kill feed
  while (killFeed.length > 0 && performance.now() - killFeed[0].time > 5000) {
    killFeed.shift();
  }
  // Clean up tracer trails
  while (tracerTrails.length > 0 && performance.now() - tracerTrails[0].startTime > 500) {
    tracerTrails.shift();
  }
  // Clean up explosions
  effects.explosions = effects.explosions.filter(e => performance.now() - e.startTime < e.duration);

  // Countdown overlay
  if (countdownEnd && !gameActive) {
    const remaining = Math.ceil((countdownEnd - Date.now()) / 1000);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (remaining > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 72px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(remaining.toString(), canvas.width / 2, canvas.height / 2);
    } else {
      ctx.fillStyle = '#888';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Starting...', canvas.width / 2, canvas.height / 2);
    }
    requestAnimationFrame(loop);
    return;
  }

  // Game over — leaderboard is in the HTML overlay now, nothing to draw
  if (gameOverData) {
    requestAnimationFrame(loop);
    return;
  }

  if ((gameActive || spectating) && gameState && map) {
    const me = gameState.players.find(p => p.id === myId);
    let viewX, viewY;
    let isScoping = false;

    if (!dead && me && me.alive) {
      // Normal gameplay
      seq++;
      const inp = inputHandler.getInput();
      inp.seq = seq;
      sendInput(inp);

      // Set sniper mode
      const isSniper = me.gun && me.gun.type === 'sniper';
      inputHandler.setSniperMode(isSniper);

      // Handle action keys (block during healing/reloading)
      if (!me.healing && !me.reloading) {
        if (inputHandler.consumePickup()) socket.emit('pickup');
        if (inputHandler.consumeGrenade()) {
          if (me.grenade && me.grenade.count > 0) {
            socket.emit('throwGrenade');
          } else {
            warning = { text: 'No grenades', time: performance.now() };
          }
        }
        if (inputHandler.consumeReload()) {
          if (!me.gun) {
            warning = { text: 'No weapon', time: performance.now() };
          } else if (me.gun.magAmmo >= me.gun.magSize) {
            warning = { text: 'Magazine full', time: performance.now() };
          } else if ((me.ammoReserve[WEAPONS[me.gun.type].ammoType] || 0) <= 0) {
            warning = { text: 'No ammo', time: performance.now() };
          } else {
            socket.emit('reload');
          }
        }
      } else {
        // Consume inputs silently during healing/reloading
        inputHandler.consumePickup();
        inputHandler.consumeGrenade();
        inputHandler.consumeReload();
      }
      if (inputHandler.consumeHeal()) {
        if (!me.healing && !me.reloading) {
          if (me.heal && me.heal.count > 0 && me.health < 100) {
            socket.emit('useHeal');
          } else if (!me.heal || me.heal.count <= 0) {
            warning = { text: 'No heals', time: performance.now() };
          } else if (me.health >= 100) {
            warning = { text: 'Full health', time: performance.now() };
          }
        }
      }

      // Warn on shooting with no ammo (non-sniper)
      if (inp.shooting && !isSniper && me.gun && me.gun.magAmmo <= 0) {
        if (!warning || performance.now() - warning.time > 1500) {
          if ((me.ammoReserve[WEAPONS[me.gun.type].ammoType] || 0) > 0) {
            warning = { text: 'Reload [R]', time: performance.now() };
          } else {
            warning = { text: 'No ammo', time: performance.now() };
          }
        }
      }
      if (inp.shooting && !isSniper && !me.gun) {
        if (!warning || performance.now() - warning.time > 1500) {
          warning = { text: 'No weapon', time: performance.now() };
        }
      }

      // Sniper fire
      const sniperFire = inputHandler.consumeSniperFire();
      if (sniperFire && !me.healing && !me.reloading) {
        if (me.gun && me.gun.magAmmo > 0) {
          socket.emit('sniperFire', { angle: sniperFire.angle });
          lastSniperFireTime = performance.now();
        } else if (me.gun && me.gun.magAmmo <= 0) {
          if ((me.ammoReserve.heavy || 0) > 0) {
            warning = { text: 'Reload [R]', time: performance.now() };
          } else {
            warning = { text: 'No ammo', time: performance.now() };
          }
        }
      } else if (sniperFire) {
        // consume silently
      }

      // Store input for prediction
      inputBuffer.push({ ...inp, seq, dt });

      // Client-side prediction
      let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      if (dx !== 0 && dy !== 0) {
        const len = Math.sqrt(dx * dx + dy * dy);
        dx /= len;
        dy /= len;
      }
      const speedMult = (me.healing || me.reloading) ? 0.3 : 1.0;
      predictedX += dx * PLAYER_SPEED * speedMult * dt;
      predictedY += dy * PLAYER_SPEED * speedMult * dt;
      const resolved = resolveAgainstWalls(predictedX, predictedY, PLAYER_RADIUS, renderer.allWalls);
      predictedX = resolved.x;
      predictedY = resolved.y;

      // Reconcile with server
      const lastAcked = gameState.lastProcessedInput[myId] || 0;
      while (inputBuffer.length > 0 && inputBuffer[0].seq <= lastAcked) {
        inputBuffer.shift();
      }
      let reconX = me.x;
      let reconY = me.y;
      for (const bufferedInput of inputBuffer) {
        let bdx = (bufferedInput.right ? 1 : 0) - (bufferedInput.left ? 1 : 0);
        let bdy = (bufferedInput.down ? 1 : 0) - (bufferedInput.up ? 1 : 0);
        if (bdx !== 0 && bdy !== 0) {
          const len = Math.sqrt(bdx * bdx + bdy * bdy);
          bdx /= len;
          bdy /= len;
        }
        reconX += bdx * PLAYER_SPEED * speedMult * bufferedInput.dt;
        reconY += bdy * PLAYER_SPEED * speedMult * bufferedInput.dt;
        const r = resolveAgainstWalls(reconX, reconY, PLAYER_RADIUS, renderer.allWalls);
        reconX = r.x;
        reconY = r.y;
      }
      const errX = reconX - predictedX;
      const errY = reconY - predictedY;
      const err = Math.sqrt(errX * errX + errY * errY);
      if (err > 2) {
        predictedX += errX * 0.3;
        predictedY += errY * 0.3;
      } else {
        predictedX = reconX;
        predictedY = reconY;
      }

      viewX = predictedX;
      viewY = predictedY;

      // Sniper scope vision
      let currentVisionRange = 600;
      if (isSniper && inputHandler.scopeStartTime) {
        const holdTime = performance.now() - inputHandler.scopeStartTime;
        const scopeProgress = Math.min(1, holdTime / 300);
        currentVisionRange = 600 + (1000 - 600) * scopeProgress;
        isScoping = true;
      }

      // Smoke vision check
      const activeSmokes = (gameState.smokes || []).filter(s => {
        const elapsed = Date.now() - s.activatedAt;
        return elapsed < s.duration;
      });

      let isInSmoke = false;
      for (const smoke of activeSmokes) {
        const sdx = viewX - smoke.x;
        const sdy = viewY - smoke.y;
        if (Math.sqrt(sdx * sdx + sdy * sdy) < 120) {
          isInSmoke = true;
          break;
        }
      }

      shadowCaster.addSmokeBlockers(activeSmokes);
      const effectiveVisionRange = isInSmoke ? 40 : currentVisionRange;
      const visibility = shadowCaster.computeVisibility(viewX, viewY, effectiveVisionRange);
      shadowCaster.removeSmokeBlockers();

      // Camera scale — zoom out when scoping, linger after firing
      let cameraScale = 1;
      if (isScoping) {
        cameraScale = 600 / currentVisionRange;
      } else if (isSniper && lastSniperFireTime > 0) {
        const sinceShot = performance.now() - lastSniperFireTime;
        const lingerDuration = 1000;
        if (sinceShot < lingerDuration) {
          // Hold zoomed out then ease back to 1
          const t = sinceShot / lingerDuration;
          const eased = t * t; // ease-in: stays zoomed longer, snaps back at end
          cameraScale = 0.6 + 0.4 * eased; // 0.6 → 1.0
        }
      }

      // Render
      renderer.draw(viewX, viewY, visibility, cameraScale);

      // Ground items
      const visibleItems = gameState.groundItems.filter(item =>
        shadowCaster.isVisible(item.x, item.y, visibility)
      );
      renderer.drawGroundItems(visibleItems, viewX, viewY, timestamp);

      // Bullets (interpolated for smooth motion)
      const interpBullets = getInterpolatedBullets(gameState.bullets);
      const visibleBullets = interpBullets.filter(b =>
        shadowCaster.isVisible(b.x, b.y, visibility)
      );
      renderer.drawBullets(visibleBullets, viewX, viewY);

      // Tracers
      renderer.drawTracers(visibleBullets, tracerTrails, viewX, viewY, performance.now());

      // Grenades
      const visibleGrenades = gameState.grenades.filter(g =>
        shadowCaster.isVisible(g.x, g.y, visibility)
      );
      renderer.drawGrenades(visibleGrenades, viewX, viewY, timestamp);

      // Players
      ctx.save();
      ctx.translate(canvas.width / 2 - viewX * cameraScale, canvas.height / 2 - viewY * cameraScale);
      ctx.scale(cameraScale, cameraScale);

      const playerIndex = gameState.players.findIndex(p => p.id === myId);
      gameState.players.forEach((p, i) => {
        if (p.id === myId || !p.alive) return;
        const interp = getInterpolatedPlayer(p.id);
        if (shadowCaster.isVisible(interp.x, interp.y, visibility)) {
          const otherGunType = interp.gun ? interp.gun.type : null;
          renderer.drawPlayer(interp.x, interp.y, interp.angle, PLAYER_RADIUS, COLORS[i % COLORS.length], interp.health, PLAYER_HP, otherGunType, interp.name);
        }
      });

      const myGunType = me.gun ? me.gun.type : null;
      renderer.drawPlayer(viewX, viewY, inp.angle, PLAYER_RADIUS, COLORS[playerIndex % COLORS.length], me.health, PLAYER_HP, myGunType, me.name);

      ctx.restore();

      // Zone, smoke clouds, effects
      renderer.drawZone(gameState.zone, viewX, viewY, timestamp);
      renderer.drawSmokeClouds(activeSmokes, viewX, viewY, timestamp);
      renderer.drawExplosions(effects.explosions, viewX, viewY, performance.now());
      renderer.drawHitFlash(canvas.width, canvas.height, effects.hitFlash, performance.now());
      if (effects.hitFlash && performance.now() - effects.hitFlash.startTime > effects.hitFlash.duration) {
        effects.hitFlash = null;
      }

      // Scope: no overlay, camera zoom handled by vision range

      // HUD
      hud.draw(ctx, canvas.width, canvas.height, me, gameState);
      hud.drawKillFeed(ctx, canvas.width, killFeed, performance.now());
      hud.drawWarning(ctx, canvas.width, canvas.height, warning, performance.now());
      hud.drawItemTooltip(ctx, canvas.width, canvas.height, gameState.groundItems, viewX, viewY, cameraScale);

    } else if (spectating && spectateTargetId && gameState) {
      // Spectator rendering
      const target = gameState.players.find(p => p.id === spectateTargetId && p.alive);
      if (!target) {
        const alive = gameState.players.filter(p => p.alive);
        if (alive.length > 0) {
          spectateTargetId = alive[0].id;
        }
      }

      const spectTarget = gameState.players.find(p => p.id === spectateTargetId);
      if (spectTarget) {
        viewX = spectTarget.x;
        viewY = spectTarget.y;

        const activeSmokes = (gameState.smokes || []).filter(s => Date.now() - s.activatedAt < s.duration);
        let isInSmoke = false;
        for (const smoke of activeSmokes) {
          if (Math.sqrt((viewX - smoke.x) ** 2 + (viewY - smoke.y) ** 2) < 120) {
            isInSmoke = true;
            break;
          }
        }

        shadowCaster.addSmokeBlockers(activeSmokes);
        const visibility = shadowCaster.computeVisibility(viewX, viewY, isInSmoke ? 40 : 600);
        shadowCaster.removeSmokeBlockers();

        renderer.draw(viewX, viewY, visibility);

        const visibleItems = gameState.groundItems.filter(item => shadowCaster.isVisible(item.x, item.y, visibility));
        renderer.drawGroundItems(visibleItems, viewX, viewY, timestamp);

        const interpBullets = getInterpolatedBullets(gameState.bullets);
        const visibleBullets = interpBullets.filter(b => shadowCaster.isVisible(b.x, b.y, visibility));
        renderer.drawBullets(visibleBullets, viewX, viewY);
        renderer.drawTracers(visibleBullets, tracerTrails, viewX, viewY, performance.now());

        const visibleGrenades = gameState.grenades.filter(g => shadowCaster.isVisible(g.x, g.y, visibility));
        renderer.drawGrenades(visibleGrenades, viewX, viewY, timestamp);

        ctx.save();
        ctx.translate(canvas.width / 2 - viewX, canvas.height / 2 - viewY);
        gameState.players.forEach((p, i) => {
          if (!p.alive) return;
          const interp = getInterpolatedPlayer(p.id);
          if (shadowCaster.isVisible(interp.x, interp.y, visibility)) {
            const gunType = interp.gun ? interp.gun.type : null;
            renderer.drawPlayer(interp.x, interp.y, interp.angle, PLAYER_RADIUS, COLORS[i % COLORS.length], interp.health, PLAYER_HP, gunType, interp.name);
          }
        });
        ctx.restore();

        renderer.drawZone(gameState.zone, viewX, viewY, timestamp);
        renderer.drawSmokeClouds(activeSmokes, viewX, viewY, timestamp);
        renderer.drawExplosions(effects.explosions, viewX, viewY, performance.now());

        hud.drawSpectatorHUD(ctx, canvas.width, canvas.height,
          spectTarget.name || '?', gameState.alivePlayers, gameState.players.length);
        hud.drawKillFeed(ctx, canvas.width, killFeed, performance.now());

        // Spectator controls
        if (inputHandler.keys.left) {
          const alive = gameState.players.filter(p => p.alive);
          const idx = alive.findIndex(p => p.id === spectateTargetId);
          spectateTargetId = alive[(idx - 1 + alive.length) % alive.length].id;
          inputHandler.keys.left = false;
        }
        if (inputHandler.keys.right) {
          const alive = gameState.players.filter(p => p.alive);
          const idx = alive.findIndex(p => p.id === spectateTargetId);
          spectateTargetId = alive[(idx + 1) % alive.length].id;
          inputHandler.keys.right = false;
        }
        if (inputHandler.shooting) {
          spectating = false;
          inputHandler.shooting = false;
          const overlay = document.getElementById('overlay');
          overlay.style.display = 'flex';
          overlay.innerHTML = `<h1 style="font-size:36px;color:#ff4444">ELIMINATED</h1>
            <button onclick="location.reload()" style="margin-top:20px;padding:12px 32px;font-size:18px;background:#4a9eff;color:#fff;border:none;border-radius:8px;cursor:pointer">Play Again</button>`;
        }
      }
    }
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
