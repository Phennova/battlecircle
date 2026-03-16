import { Renderer } from './Renderer.js';
import { InputHandler } from './InputHandler.js';
import { ShadowCaster } from './ShadowCaster.js';
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

// Hide lobby for now
document.getElementById('lobby').style.display = 'none';

// Fetch map and start rendering
const res = await fetch('/api/map');
const map = await res.json();
renderer.setMap(map);
shadowCaster.setWalls(renderer.allWalls);

// Local player state (temporary — will be server-driven later)
const player = {
  x: map.spawnPoints[0].x,
  y: map.spawnPoints[0].y,
  angle: 0,
  health: PLAYER_HP
};

let lastTime = performance.now();

function loop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;

  // Read input
  const inp = inputHandler.getInput();
  player.angle = inp.angle;

  // Movement
  let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
  if (dx !== 0 && dy !== 0) {
    const len = Math.sqrt(dx * dx + dy * dy);
    dx /= len;
    dy /= len;
  }
  player.x += dx * PLAYER_SPEED * dt;
  player.y += dy * PLAYER_SPEED * dt;

  // Collision
  const resolved = resolveAgainstWalls(player.x, player.y, PLAYER_RADIUS, renderer.allWalls);
  player.x = resolved.x;
  player.y = resolved.y;

  // Shadow casting
  const visibility = shadowCaster.computeVisibility(player.x, player.y);

  // Render
  renderer.draw(player.x, player.y, visibility);

  // Draw player on top of shadow
  ctx.save();
  ctx.translate(canvas.width / 2 - player.x, canvas.height / 2 - player.y);
  renderer.drawPlayer(player.x, player.y, player.angle, PLAYER_RADIUS, '#4a9eff', player.health, PLAYER_HP);
  ctx.restore();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
