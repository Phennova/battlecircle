import { Renderer } from './Renderer.js';
import { InputHandler } from './InputHandler.js';
import { ShadowCaster } from './ShadowCaster.js';
import { HUD } from './HUD.js';
import { PLAYER_RADIUS, PLAYER_SPEED, PLAYER_HP } from '/shared/constants.js';
import { resolveAgainstWalls } from '/shared/collision.js';

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

// Player colors
const COLORS = ['#4a9eff', '#ff6b6b', '#50c878', '#ffc832', '#ff8c42', '#c77dff', '#64dfdf', '#ff5e78'];

// Lobby UI
const lobby = document.getElementById('lobby');
const lobbyStatus = lobby.querySelector('.status');
const startBtn = document.getElementById('startBtn');

startBtn.addEventListener('click', () => {
  socket.emit('requestStart');
});

socket.on('roomJoined', (data) => {
  myId = data.playerId;
  map = data.map;
  renderer.setMap(map);
  shadowCaster.setWalls(renderer.allWalls);
  lobbyStatus.textContent = 'Waiting for players...';
});

socket.on('playerCount', (data) => {
  lobbyStatus.textContent = `${data.count} / ${data.max} players`;
  startBtn.disabled = data.count < 2;
});

socket.on('countdown', (data) => {
  countdownEnd = Date.now() + data.seconds * 1000;
  lobby.style.display = 'none';
  // Initialize predicted position from spawn
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
        if (old) effects.explosions.push({ x: old.x, y: old.y, startTime: performance.now(), duration: 400 });
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
  if (data.victimId === myId) {
    gameActive = false;
    canvas.style.filter = 'grayscale(100%)';
    const survivalMs = gameState ? gameState.gameElapsedMs : 0;
    const myData = gameState ? gameState.players.find(p => p.id === myId) : null;
    const kills = myData ? myData.kills : 0;
    const sec = Math.floor(survivalMs / 1000);
    const overlay = document.getElementById('overlay');
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <h1 style="font-size:48px;color:#ff4444;letter-spacing:4px">ELIMINATED</h1>
      <p style="color:#aaa;margin:8px">Survived: ${Math.floor(sec/60)}m ${sec%60}s</p>
      <p style="color:#aaa;margin:8px">Kills: ${kills}</p>
      <button onclick="location.reload()" style="margin-top:20px;padding:12px 32px;font-size:18px;background:#4a9eff;color:#fff;border:none;border-radius:8px;cursor:pointer">Play Again</button>
    `;
  }
});

socket.on('gameOver', (data) => {
  gameActive = false;
  const overlay = document.getElementById('overlay');
  overlay.style.display = 'flex';
  if (data.winnerId === myId) {
    const stats = data.stats || {};
    const sec = Math.floor((stats.survivalMs || 0) / 1000);
    overlay.innerHTML = `
      <h1 style="font-size:48px;color:#ffc832;letter-spacing:4px">VICTORY</h1>
      <p style="color:#aaa;margin:8px">Survived: ${Math.floor(sec/60)}m ${sec%60}s</p>
      <p style="color:#aaa;margin:8px">Kills: ${stats.kills || 0}</p>
      <button onclick="location.reload()" style="margin-top:20px;padding:12px 32px;font-size:18px;background:#4a9eff;color:#fff;border:none;border-radius:8px;cursor:pointer">Play Again</button>
    `;
  }
});

// Input sending
function sendInput(inp) {
  const json = JSON.stringify(inp);
  if (json !== lastInputJSON) {
    socket.emit('playerInput', inp);
    lastInputJSON = json;
  }
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

let lastTime = performance.now();

function loop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;

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

  if (gameActive && gameState && map) {
    seq++;
    const inp = inputHandler.getInput();
    inp.seq = seq;
    sendInput(inp);

    // Handle action keys
    if (inputHandler.consumePickup()) socket.emit('pickup');
    if (inputHandler.consumeGrenade()) socket.emit('throwGrenade');
    if (inputHandler.consumeHeal()) socket.emit('useHeal');
    if (inputHandler.consumeReload()) socket.emit('reload');

    // Store input for prediction
    inputBuffer.push({ ...inp, seq, dt });

    // Apply local prediction
    let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if (dx !== 0 && dy !== 0) {
      const len = Math.sqrt(dx * dx + dy * dy);
      dx /= len;
      dy /= len;
    }
    predictedX += dx * PLAYER_SPEED * dt;
    predictedY += dy * PLAYER_SPEED * dt;
    const resolved = resolveAgainstWalls(predictedX, predictedY, PLAYER_RADIUS, renderer.allWalls);
    predictedX = resolved.x;
    predictedY = resolved.y;

    // Reconcile with server
    const me = gameState.players.find(p => p.id === myId);
    if (me && me.alive) {
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
        reconX += bdx * PLAYER_SPEED * bufferedInput.dt;
        reconY += bdy * PLAYER_SPEED * bufferedInput.dt;
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

      const renderX = predictedX;
      const renderY = predictedY;

      // Compute visibility
      const visibility = shadowCaster.computeVisibility(renderX, renderY);

      // Draw world
      renderer.draw(renderX, renderY, visibility);

      // Ground items (visible only)
      const visibleItems = gameState.groundItems.filter(item =>
        shadowCaster.isVisible(item.x, item.y, visibility)
      );
      renderer.drawGroundItems(visibleItems, renderX, renderY, timestamp);

      // Bullets (visible only)
      const visibleBullets = gameState.bullets.filter(b =>
        shadowCaster.isVisible(b.x, b.y, visibility)
      );
      renderer.drawBullets(visibleBullets, renderX, renderY);

      // Grenades (visible only)
      const visibleGrenades = gameState.grenades.filter(g =>
        shadowCaster.isVisible(g.x, g.y, visibility)
      );
      renderer.drawGrenades(visibleGrenades, renderX, renderY, timestamp);

      // Other players
      ctx.save();
      ctx.translate(canvas.width / 2 - renderX, canvas.height / 2 - renderY);

      const playerIndex = gameState.players.findIndex(p => p.id === myId);
      gameState.players.forEach((p, i) => {
        if (p.id === myId || !p.alive) return;
        const interp = getInterpolatedPlayer(p.id);
        if (shadowCaster.isVisible(interp.x, interp.y, visibility)) {
          renderer.drawPlayer(interp.x, interp.y, interp.angle, PLAYER_RADIUS, COLORS[i % COLORS.length], interp.health, PLAYER_HP);
        }
      });

      // Local player
      renderer.drawPlayer(renderX, renderY, inp.angle, PLAYER_RADIUS, COLORS[playerIndex % COLORS.length], me.health, PLAYER_HP);

      ctx.restore();

      // Zone overlay
      renderer.drawZone(gameState.zone, renderX, renderY, timestamp);

      // Explosions
      effects.explosions = effects.explosions.filter(e => performance.now() - e.startTime < e.duration);
      renderer.drawExplosions(effects.explosions, renderX, renderY, performance.now());

      // Hit flash
      renderer.drawHitFlash(canvas.width, canvas.height, effects.hitFlash, performance.now());
      if (effects.hitFlash && performance.now() - effects.hitFlash.startTime > effects.hitFlash.duration) {
        effects.hitFlash = null;
      }

      // HUD (screen-space, drawn last)
      hud.draw(ctx, canvas.width, canvas.height, me, gameState);
    }
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
