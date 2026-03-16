import { Renderer } from './Renderer.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

const renderer = new Renderer(canvas, ctx);

// Hide lobby for now to see the map
document.getElementById('lobby').style.display = 'none';

// Fetch map and start rendering
const res = await fetch('/api/map');
const map = await res.json();
renderer.setMap(map);

// Temporary: render centered on map middle
function loop() {
  renderer.draw(map.width / 2, map.height / 2);
  requestAnimationFrame(loop);
}
loop();
