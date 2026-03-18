import { Renderer } from './Renderer.js';
import { InputHandler } from './InputHandler.js';
import { ShadowCaster } from './ShadowCaster.js';
import { HUD } from './HUD.js';
import { PLAYER_RADIUS, PLAYER_SPEED, PLAYER_HP } from '/shared/constants.js';
import { resolveAgainstWalls } from '/shared/collision.js';
import { WEAPONS } from '/shared/weapons.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { TouchControls } from './TouchControls.js';

// ═══ MOBILE DETECTION ═══
const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
if (isMobile) document.body.classList.add('is-mobile');
window.isMobile = isMobile;

// ═══ AUTH ═══
const SUPABASE_URL = 'https://tzsqedjxlytvkoxyoepe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6c3FlZGp4bHl0dmtveHlvZXBlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MTU3OTIsImV4cCI6MjA4OTM5MTc5Mn0.B9ynes5NLZn9Zkcvwl5okZxH4_Qg_Nn_k-OqTEmSNd0';
const sbClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let isSignUp = true;

const authScreen = document.getElementById('authScreen');
const authEmail = document.getElementById('authEmail');
const authUsername = document.getElementById('authUsername');
const authPassword = document.getElementById('authPassword');
const authSubmit = document.getElementById('authSubmit');
const authError = document.getElementById('authError');
const authToggleText = document.getElementById('authToggleText');
const authToggleLink = document.getElementById('authToggleLink');

window._toggleAuth = () => {
  isSignUp = !isSignUp;
  authSubmit.textContent = isSignUp ? 'SIGN UP' : 'LOGIN';
  authToggleText.textContent = isSignUp ? 'Have an account?' : 'No account?';
  authToggleLink.textContent = isSignUp ? 'Login' : 'Sign Up';
  authUsername.style.display = isSignUp ? 'block' : 'none';
  authError.textContent = '';
};

authSubmit.addEventListener('click', async () => {
  const email = authEmail.value.trim();
  const password = authPassword.value;
  const username = authUsername.value.trim();
  authError.textContent = '';

  if (!email) {
    authError.textContent = 'Email is required';
    return;
  }
  if (!password || password.length < 6) {
    authError.textContent = 'Password must be at least 6 characters';
    return;
  }
  if (isSignUp && (!username || username.length < 3)) {
    authError.textContent = 'Display name must be at least 3 characters';
    return;
  }

  authSubmit.disabled = true;
  authSubmit.textContent = 'LOADING...';

  try {
    if (isSignUp) {
      const { data, error } = await sbClient.auth.signUp({
        email,
        password,
        options: { data: { username } }
      });
      if (error) throw error;
      currentUser = data.user;

      // Create player profile
      await sbClient.from('players').insert({
        id: currentUser.id,
        username
      });
    } else {
      const { data, error } = await sbClient.auth.signInWithPassword({
        email,
        password
      });
      if (error) throw error;
      currentUser = data.user;
    }

    // Success — hide auth, show mode select
    authScreen.style.display = 'none';
    document.getElementById('modeSelect').style.display = 'flex';
    _populateSidebar();
  } catch (err) {
    authError.textContent = err.message === 'Invalid login credentials'
      ? 'Wrong email or password'
      : err.message || 'Something went wrong';
  }

  authSubmit.disabled = false;
  authSubmit.textContent = isSignUp ? 'SIGN UP' : 'LOGIN';
});

async function _populateSidebar() {
  const displayName = currentUser?.user_metadata?.username || currentUser?.email?.split('@')[0] || 'Player';
  const el = document.getElementById('sidebarUsername');
  if (el) el.textContent = displayName;

  // Load stats from Supabase
  const { data } = await sbClient.from('players').select('*').eq('id', currentUser.id).single();
  if (data) {
    const ratingEl = document.getElementById('sidebarRating');
    if (ratingEl) ratingEl.textContent = `Rating: ${Math.round(data.rating)}`;
    const kd = data.total_deaths > 0 ? (data.total_kills / data.total_deaths).toFixed(1) : data.total_kills;
    document.getElementById('statWins').textContent = data.total_wins;
    document.getElementById('statKills').textContent = data.total_kills;
    document.getElementById('statKD').textContent = kd;
    document.getElementById('statRating').textContent = Math.round(data.rating);
    document.getElementById('statGames').textContent = data.total_games;
  }
  // Mobile top bar
  const mobileUser = document.getElementById('mobileUsername');
  const mobileRating = document.getElementById('mobileRating');
  if (mobileUser) mobileUser.textContent = displayName;
  if (mobileRating && data) mobileRating.textContent = Math.round(data.rating);
}

// Check for existing session
(async () => {
  const { data: { session } } = await sbClient.auth.getSession();
  if (session) {
    currentUser = session.user;
    authScreen.style.display = 'none';
    document.getElementById('modeSelect').style.display = 'flex';
    _populateSidebar();
  }
})();

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

let touchControls = null;
if (isMobile) {
  touchControls = new TouchControls(canvas, inputHandler);
}

// Connect to server
const socket = io({
  auth: async (cb) => {
    const { data: { session } } = await sbClient.auth.getSession();
    cb({
      token: session?.access_token || null,
      username: currentUser?.user_metadata?.username || currentUser?.email?.split('@')[0] || null
    });
  }
});
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
let cameraX = 0, cameraY = 0;
let seq = 0;
let lastInputJSON = '';

// Effects
const effects = {
  explosions: [],
  hitFlash: null
};
let lastSniperFireTime = 0;
let lastShotTime = -10000; // client-side shot cooldown tracking (start ready)
let prevMagAmmo = -1; // to detect when a shot was fired
const killFeed = [];

// Warnings
let warning = null; // { text, time }
const tracerTrails = [];

// Player colors
const COLORS = ['#4a9eff', '#ff6b6b', '#50c878', '#ffc832', '#ff8c42', '#c77dff', '#64dfdf', '#ff5e78'];
const TEAM_RENDER_COLORS = { blue: '#4a9eff', red: '#ff6b6b' };

function getPlayerColor(player, index) {
  if (player.team !== undefined && player.team !== null) {
    const teamName = player.team === 0 ? 'blue' : player.team === 1 ? 'red' : null;
    if (teamName) return TEAM_RENDER_COLORS[teamName];
  }
  return COLORS[index % COLORS.length];
}

// Lobby UI (must be declared before mode select references them)
const lobby = document.getElementById('lobby');
const lobbyStatus = lobby.querySelector('.status');
const readyBtn = document.getElementById('readyBtn');
const playerList = document.getElementById('playerList');

// Mode select
const modeSelect = document.getElementById('modeSelect');
const modeLabel = document.getElementById('modeLabel');
let currentMode = null;

function _joinMode(btn) {
  const modeId = btn.dataset.mode;
  if (!modeId || currentMode) return;
  currentMode = modeId;
  const nameEl = btn.querySelector('.mode-name');
  const modeName = nameEl ? nameEl.textContent : modeId;
  modeLabel.textContent = modeName;
  const isArcade = modeId.startsWith('arcade_');

  if (isArcade) {
    // Arcade: direct join, show lobby immediately
    modeSelect.style.display = 'none';
    lobby.style.display = 'flex';
    socket.emit('joinMode', modeId);
  } else {
    // Competitive: show queue screen
    modeSelect.style.display = 'none';
    _showQueueScreen(modeName);
    socket.emit('joinQueue', modeId);
  }
}

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    _joinMode(btn);
  });
});

// Fallback: also listen on document for mode-btn clicks
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-btn');
  if (btn && modeSelect.style.display !== 'none') {
    _joinMode(btn);
  }
});

document.getElementById('backBtn').addEventListener('click', () => {
  // If in queue, leave it
  if (document.getElementById('queueScreen')?.style.display === 'flex') {
    socket.emit('leaveQueue');
  }
  location.reload();
});
let isReady = false;
let currentModeConfig = null;
let queueTimer = null;

function _showQueueScreen(modeName) {
  let screen = document.getElementById('queueScreen');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'queueScreen';
    screen.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(6,8,16,0.95);z-index:20';
    document.body.appendChild(screen);
  }
  screen.style.display = 'flex';
  screen.innerHTML = `
    <div style="font-family:var(--font-display);font-size:9px;letter-spacing:4px;color:var(--text-muted);margin-bottom:8px">MATCHMAKING</div>
    <div style="font-family:var(--font-display);font-size:20px;color:var(--accent);letter-spacing:3px;margin-bottom:24px">${modeName}</div>
    <div id="queueTimerDisplay" style="font-family:var(--font-display);font-size:36px;color:var(--text-primary);margin-bottom:8px">0:00</div>
    <div id="queueInfo" style="font-family:var(--font-body);font-size:14px;color:var(--text-dim);margin-bottom:8px">Searching for players...</div>
    <div id="queueRange" style="font-family:var(--font-body);font-size:12px;color:var(--text-muted);margin-bottom:32px"></div>
    <button id="cancelQueueBtn" style="padding:10px 32px;font-family:var(--font-display);font-size:10px;letter-spacing:2px;background:transparent;color:var(--text-dim);border:1px solid var(--border);cursor:pointer">CANCEL</button>
  `;
  document.getElementById('cancelQueueBtn').addEventListener('click', () => {
    socket.emit('leaveQueue');
    _hideQueueScreen();
    currentMode = null;
    modeSelect.style.display = 'flex';
  });

  // Start timer
  const startTime = Date.now();
  clearInterval(queueTimer);
  queueTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const min = Math.floor(elapsed / 60);
    const sec = String(elapsed % 60).padStart(2, '0');
    const el = document.getElementById('queueTimerDisplay');
    if (el) el.textContent = `${min}:${sec}`;
  }, 1000);
}

function _hideQueueScreen() {
  clearInterval(queueTimer);
  const screen = document.getElementById('queueScreen');
  if (screen) screen.style.display = 'none';
}

// Queue events
socket.on('queueJoined', (data) => {
  const rangeEl = document.getElementById('queueRange');
  if (rangeEl) rangeEl.textContent = `Rating range: ±${data.ratingRange}`;
});

socket.on('queueStatus', (data) => {
  const infoEl = document.getElementById('queueInfo');
  const rangeEl = document.getElementById('queueRange');
  if (infoEl) infoEl.textContent = `${data.playersInQueue} player${data.playersInQueue !== 1 ? 's' : ''} in queue — ${data.estimatedWait}`;
  if (rangeEl) rangeEl.textContent = `Rating range: ±${data.ratingRange}`;
});

socket.on('queueError', (data) => {
  _hideQueueScreen();
  currentMode = null;
  modeSelect.style.display = 'flex';
  alert(data.message);
});

socket.on('queueLeft', () => {
  _hideQueueScreen();
});

socket.on('matchFound', (data) => {
  _hideQueueScreen();
  // Show lobby
  lobby.style.display = 'flex';
  const label = data.hasBots ? `${modeLabel.textContent} (Bot Fill)` : modeLabel.textContent;
  modeLabel.textContent = label;
});

readyBtn.addEventListener('click', () => {
  isReady = !isReady;
  socket.emit('toggleReady');
  readyBtn.textContent = isReady ? 'READY' : 'READY UP';
  readyBtn.classList.toggle('is-ready', isReady);
});

socket.on('roomJoined', (data) => {
  myId = data.playerId;
  map = data.map;
  currentModeConfig = data.mode;
  renderer.setMap(map);
  shadowCaster.setWalls(renderer.allWalls);
  lobbyStatus.textContent = 'Waiting for players...';
  readyBtn.disabled = false;
});

socket.on('lobbyUpdate', (data) => {
  lobbyStatus.textContent = `${data.count} / ${data.max} players`;

  if (data.teams) {
    const blue = data.players.filter(p => p.team === 'blue');
    const red = data.players.filter(p => p.team === 'red');
    const unassigned = data.players.filter(p => !p.team);

    const teamCard = (color, label, players, teamIdx) => {
      const accent = color === 'blue' ? '#4a9eff' : '#ff6b6b';
      const bg = color === 'blue' ? 'rgba(74,158,255,0.05)' : 'rgba(255,107,107,0.05)';
      const borderC = color === 'blue' ? 'rgba(74,158,255,0.15)' : 'rgba(255,107,107,0.15)';
      return `
        <div style="flex:1;border:1px solid ${borderC};background:${bg};padding:16px;clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,10px 100%,0 calc(100% - 10px))">
          <div style="font-family:Orbitron,sans-serif;font-size:11px;letter-spacing:3px;color:${accent};margin-bottom:10px;text-transform:uppercase">${label}</div>
          <button onclick="window._joinTeam(${teamIdx})" style="width:100%;padding:6px;background:transparent;border:1px solid ${accent};color:${accent};cursor:pointer;font-family:Orbitron,sans-serif;font-size:10px;letter-spacing:2px;margin-bottom:10px;transition:background 0.2s;text-transform:uppercase"
            onmouseover="this.style.background='${bg}'" onmouseout="this.style.background='transparent'">Join</button>
          ${players.map(p => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;margin:3px 0;border-left:2px solid ${p.ready ? '#50c878' : accent};background:rgba(255,255,255,0.02)">
              <span style="font-family:Rajdhani,sans-serif;font-size:14px;font-weight:500;color:${accent}">${p.name}</span>
              ${p.ready ? '<span style="font-family:\'Orbitron\',sans-serif;font-size:9px;color:#50c878;letter-spacing:1px">READY</span>' : ''}
            </div>`).join('')}
        </div>`;
    };

    playerList.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:8px">
        ${teamCard('blue', 'Blue Team', blue, 0)}
        ${teamCard('red', 'Red Team', red, 1)}
      </div>
      ${unassigned.length > 0 ? `<div style="color:#5a6480;font-size:12px;text-align:center;font-family:Rajdhani,sans-serif;letter-spacing:1px;margin-top:8px">${unassigned.map(p => p.name).join(', ')} - select a team</div>` : ''}
    `;
  } else {
    playerList.innerHTML = data.players.map(p =>
      `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px;margin:3px 0;border-left:2px solid ${p.ready ? '#50c878' : 'rgba(74,158,255,0.2)'};background:rgba(255,255,255,0.02);transition:background 0.15s"
        onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='rgba(255,255,255,0.02)'">
        <span style="font-family:Rajdhani,sans-serif;font-size:15px;font-weight:500;color:#e0e6f0">${p.name}</span>
        <span style="font-family:Orbitron,sans-serif;font-size:9px;letter-spacing:1px;color:${p.ready ? '#50c878' : '#333a50'}">${p.ready ? 'READY' : 'WAITING'}</span>
      </div>`
    ).join('');
  }

  // Add fill with bots button (not in arcade modes)
  if (!data.isArcade && data.count < data.max) {
    playerList.innerHTML += `
      <div style="margin-top:12px;text-align:center">
        <button onclick="window._voteFillBots()" style="padding:8px 20px;background:transparent;border:1px solid rgba(255,200,50,0.3);color:#ffc832;cursor:pointer;font-family:Orbitron,sans-serif;font-size:9px;letter-spacing:2px;text-transform:uppercase;transition:all 0.2s"
          onmouseover="this.style.background='rgba(255,200,50,0.08)'" onmouseout="this.style.background='transparent'">
          Fill with Bots (${data.botVotes}/${data.botVotesNeeded} votes)
        </button>
      </div>`;
  }
});

// Team join handler (called from inline onclick)
window._joinTeam = (teamIndex) => {
  socket.emit('joinTeam', teamIndex);
  isReady = false;
  readyBtn.textContent = 'Ready Up';
  readyBtn.style.background = '#555';
};

window._selectClass = (classId) => {
  socket.emit('selectClass', classId);
};

window._switchPage = (page) => {
  document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display = 'none');
  const target = document.getElementById(`page-${page}`);
  if (target) target.style.display = 'block';
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  document.querySelector(`.sidebar-link[data-page="${page}"]`)?.classList.add('active');
  document.querySelectorAll('.mobile-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.mobile-tab[data-page="${page}"]`)?.classList.add('active');
  if (page === 'leaderboard') _loadLeaderboard();
  if (page === 'profile') _loadProfile();
};

// ═══ LEADERBOARD ═══
let _lbType = 'overall';
let _lbLastFetched = null;

async function _loadLeaderboard() {
  const container = document.getElementById('leaderboardContent');
  const updatedEl = document.getElementById('leaderboardUpdated');
  container.innerHTML = '<div class="lb-loading">Loading...</div>';

  const view = _lbType === 'kills' ? 'leaderboard_kills' : 'leaderboard_overall';
  const { data, error } = await sbClient.from(view).select('*').limit(50);

  if (error || !data) {
    container.innerHTML = '<div class="lb-loading">Failed to load leaderboard</div>';
    return;
  }

  if (data.length === 0) {
    container.innerHTML = '<div class="lb-loading">No players yet. Play some games!</div>';
    return;
  }

  _lbLastFetched = Date.now();
  if (updatedEl) updatedEl.textContent = 'Just now';

  const myId = currentUser?.id;
  let html = '<table class="lb-table"><thead><tr>';
  html += '<th>#</th><th>NAME</th><th>RATING</th><th>WINS</th><th>KILLS</th><th>K/D</th><th>GAMES</th>';
  html += '</tr></thead><tbody>';

  data.forEach((row, i) => {
    const rank = i + 1;
    const rankClass = rank <= 3 ? ` lb-rank-${rank}` : '';
    const selfClass = row.id === myId ? ' lb-self' : '';
    const kd = row.total_deaths > 0
      ? (row.total_kills / row.total_deaths).toFixed(1)
      : row.total_kills || 0;

    html += `<tr class="${rankClass}${selfClass}">`;
    html += `<td><span class="lb-rank-num">${rank}</span></td>`;
    html += `<td>${_escapeHtml(row.username || 'Unknown')}</td>`;
    html += `<td>${Math.round(row.rating || 1500)}</td>`;
    html += `<td>${row.total_wins || 0}</td>`;
    html += `<td>${row.total_kills || 0}</td>`;
    html += `<td>${kd}</td>`;
    html += `<td>${row.total_games || 0}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = `<div style="overflow-x:auto">${html}</div>`;
}

function _escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Leaderboard tab switching
document.querySelectorAll('.lb-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    _lbType = tab.dataset.lb;
    _loadLeaderboard();
  });
});

// Update "last fetched" timestamp
setInterval(() => {
  if (!_lbLastFetched) return;
  const el = document.getElementById('leaderboardUpdated');
  if (!el) return;
  const secs = Math.round((Date.now() - _lbLastFetched) / 1000);
  if (secs < 5) el.textContent = 'Just now';
  else if (secs < 60) el.textContent = `${secs}s ago`;
  else el.textContent = `${Math.round(secs / 60)}m ago`;
}, 5000);

// ═══ PROFILE ═══
async function _loadProfile() {
  const container = document.getElementById('profileContent');
  if (!currentUser) {
    container.innerHTML = '<div class="lb-loading">Sign in to view your profile</div>';
    return;
  }
  container.innerHTML = '<div class="lb-loading">Loading...</div>';

  const { data: player } = await sbClient.from('players').select('*').eq('id', currentUser.id).single();
  if (!player) {
    container.innerHTML = '<div class="lb-loading">No profile found</div>';
    return;
  }

  const kd = player.total_deaths > 0 ? (player.total_kills / player.total_deaths).toFixed(2) : player.total_kills;
  const winRate = player.total_games > 0 ? ((player.total_wins / player.total_games) * 100).toFixed(1) : 0;
  const rating = Math.round(player.rating || 1500);
  let tier = 'Bronze';
  if (rating >= 2100) tier = 'Diamond';
  else if (rating >= 1800) tier = 'Platinum';
  else if (rating >= 1500) tier = 'Gold';
  else if (rating >= 1200) tier = 'Silver';

  const tierColors = { Bronze: '#cd7f32', Silver: '#c0c0c0', Gold: '#ffd700', Platinum: '#4a9eff', Diamond: '#b44aff' };

  let html = '';
  // Header
  html += `<div style="display:flex;align-items:center;gap:16px;margin-bottom:24px">`;
  html += `<div>`;
  html += `<div style="font-family:var(--font-display);font-size:20px;font-weight:900;color:var(--text-primary)">${_escapeHtml(player.username)}</div>`;
  html += `<div style="font-family:var(--font-display);font-size:11px;letter-spacing:2px;color:${tierColors[tier]};margin-top:4px">${tier} - ${rating}</div>`;
  html += `</div></div>`;

  // Stats grid
  html += `<div style="display:grid;grid-template-columns:repeat(${isMobile ? 2 : 4},1fr);gap:10px;margin-bottom:24px">`;
  const stats = [
    ['KILLS', player.total_kills || 0],
    ['DEATHS', player.total_deaths || 0],
    ['K/D', kd],
    ['WIN RATE', `${winRate}%`],
    ['WINS', player.total_wins || 0],
    ['GAMES', player.total_games || 0],
    ['DAMAGE', player.total_damage_dealt || 0],
    ['BEST GAME', `${player.highest_kill_game || 0} kills`]
  ];
  for (const [label, val] of stats) {
    html += `<div style="background:rgba(255,255,255,0.02);padding:10px 12px;border-left:2px solid var(--border)">`;
    html += `<div style="font-family:var(--font-display);font-size:8px;letter-spacing:2px;color:var(--text-muted)">${label}</div>`;
    html += `<div style="font-family:var(--font-body);font-size:18px;color:var(--text-primary);margin-top:2px">${val}</div>`;
    html += `</div>`;
  }
  html += `</div>`;

  // Per-mode breakdown
  html += `<div style="font-family:var(--font-display);font-size:8px;letter-spacing:3px;color:var(--text-muted);margin-bottom:10px">MODE BREAKDOWN</div>`;
  html += `<div style="display:grid;grid-template-columns:repeat(${isMobile ? 2 : 4},1fr);gap:10px">`;
  const modes = [
    ['BR', player.br_wins || 0, player.br_games || 0],
    ['TDM', player.tdm_wins || 0, player.tdm_games || 0],
    ['CTF', player.ctf_wins || 0, player.ctf_games || 0],
    ['ARCADE', '-', player.arcade_games || 0]
  ];
  for (const [mode, wins, games] of modes) {
    html += `<div style="background:rgba(255,255,255,0.02);padding:10px 12px;border-left:2px solid var(--border)">`;
    html += `<div style="font-family:var(--font-display);font-size:8px;letter-spacing:2px;color:var(--text-muted)">${mode}</div>`;
    html += `<div style="font-family:var(--font-body);font-size:14px;color:var(--text-primary);margin-top:2px">${wins === '-' ? '' : `${wins}W `}${games}G</div>`;
    html += `</div>`;
  }
  html += `</div>`;

  // Match history
  html += `<div style="font-family:var(--font-display);font-size:8px;letter-spacing:3px;color:var(--text-muted);margin:24px 0 10px">RECENT MATCHES</div>`;
  const { data: matches } = await sbClient
    .from('match_results')
    .select('*, matches(mode, started_at, duration_ms)')
    .eq('player_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (matches && matches.length > 0) {
    for (const m of matches) {
      const mode = m.matches?.mode || '?';
      const resultColor = m.won ? '#50c878' : '#ff4a4a';
      const resultText = m.won ? 'WIN' : 'LOSS';
      const date = m.matches?.started_at ? new Date(m.matches.started_at).toLocaleDateString() : '';
      html += `<div style="display:flex;align-items:center;gap:12px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.03)">`;
      html += `<div style="font-family:var(--font-display);font-size:9px;letter-spacing:1px;color:${resultColor};width:36px">${resultText}</div>`;
      html += `<div style="font-family:var(--font-body);font-size:13px;color:var(--text-dim);width:80px">${mode}</div>`;
      html += `<div style="font-family:var(--font-body);font-size:13px;color:var(--text-primary)">${m.kills}K / ${m.deaths}D / ${m.damage_dealt}dmg</div>`;
      html += `<div style="flex:1"></div>`;
      html += `<div style="font-family:var(--font-body);font-size:11px;color:var(--text-muted)">${date}</div>`;
      html += `</div>`;
    }
  } else {
    html += `<div style="font-family:var(--font-body);font-size:13px;color:var(--text-dim);padding:16px 0">No matches played yet</div>`;
  }

  container.innerHTML = html;
}

window._logout = async () => {
  await sbClient.auth.signOut();
  location.reload();
};

window._voteFillBots = () => {
  socket.emit('voteFillBots');
};

socket.on('countdown', async (data) => {
  countdownEnd = Date.now() + data.seconds * 1000;
  lobby.style.display = 'none';

  // Mobile: enter fullscreen and lock landscape
  if (isMobile) {
    document.body.classList.add('in-game');
    try {
      await document.documentElement.requestFullscreen?.();
      await screen.orientation?.lock?.('landscape');
    } catch (e) { /* not all browsers support orientation lock */ }
    if (touchControls) touchControls.show();
  }
  if (data.spawnPositions && data.spawnPositions[myId]) {
    predictedX = data.spawnPositions[myId].x;
    predictedY = data.spawnPositions[myId].y;
  }

  // CTF: show class select during countdown
  if (currentModeConfig && currentModeConfig.ctf) {
    const overlay = document.getElementById('overlay');
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <h1 style="font-family:Orbitron,sans-serif;font-size:24px;color:#e0e6f0;margin-bottom:8px;letter-spacing:4px">CHOOSE YOUR CLASS</h1>
      <p style="color:#888;margin-bottom:16px">Game starting soon...</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
        <button onclick="window._selectClass('rusher')" style="padding:12px 18px;background:rgba(232,226,46,0.15);border:1px solid #e8e82e;color:#e8e82e;border-radius:6px;cursor:pointer;font-size:14px">
          <div style="font-weight:bold">Rusher</div><div style="font-size:11px;color:#aaa">SMG + Frags + Bandages</div>
        </button>
        <button onclick="window._selectClass('assault')" style="padding:12px 18px;background:rgba(74,158,255,0.15);border:1px solid #4a9eff;color:#4a9eff;border-radius:6px;cursor:pointer;font-size:14px">
          <div style="font-weight:bold">Assault</div><div style="font-size:11px;color:#aaa">Rifle + Frags + Bandages</div>
        </button>
        <button onclick="window._selectClass('breacher')" style="padding:12px 18px;background:rgba(255,140,66,0.15);border:1px solid #ff8c42;color:#ff8c42;border-radius:6px;cursor:pointer;font-size:14px">
          <div style="font-weight:bold">Breacher</div><div style="font-size:11px;color:#aaa">Shotgun + Smokes + MedKit</div>
        </button>
        <button onclick="window._selectClass('marksman')" style="padding:12px 18px;background:rgba(139,69,19,0.15);border:1px solid #8b4513;color:#cd853f;border-radius:6px;cursor:pointer;font-size:14px">
          <div style="font-weight:bold">Marksman</div><div style="font-size:11px;color:#aaa">Sniper + Smokes + Bandages</div>
        </button>
      </div>
    `;
  }
});

socket.on('gameStart', () => {
  gameActive = true;
  countdownEnd = null;
  // Dismiss class select overlay
  document.getElementById('overlay').style.display = 'none';
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
          renderer.triggerScreenShake(8, 300);
        }
      }
    }
    // Track bullet removals for sparks and tracers
    const oldBulletMap = new Map(gameState.bullets.map(b => [b.id, b]));
    for (const [id, old] of oldBulletMap) {
      if (!state.bullets.find(b => b.id === id)) {
        // Bullet disappeared — spawn sparks at last position
        renderer.spawnBulletSparks(old.x, old.y);
        // Sniper tracer trail
        if (old.type === 'sniper' && old.originX != null) {
          tracerTrails.push({ originX: old.originX, originY: old.originY, endX: old.x, endY: old.y, startTime: performance.now() });
        }
      }
    }

    // Detect new bullets for muzzle flash
    for (const b of state.bullets) {
      if (!oldBulletMap.has(b.id) && b.type !== 'shrapnel') {
        const owner = gameState.players.find(p => p.id === b.ownerId);
        if (owner) {
          renderer.spawnMuzzleFlash(owner.x + Math.cos(owner.angle) * 24, owner.y + Math.sin(owner.angle) * 24);
        }
      }
    }

    // Detect player health changes for damage particles/numbers
    for (const newP of state.players) {
      const oldP = gameState.players.find(p => p.id === newP.id);
      if (oldP && newP.health < oldP.health) {
        const dmg = oldP.health - newP.health;
        renderer.spawnDamageParticles(newP.x, newP.y);
        renderer.addDamageNumber(newP.x, newP.y, dmg);
        // If this is someone WE hit, show hit marker
        if (newP.id !== myId) {
          renderer.showHitMarker();
        }
      }
      // Detect deaths for death animation
      if (oldP && oldP.alive && !newP.alive) {
        const idx = state.players.indexOf(newP);
        const color = getPlayerColor(newP, idx);
        renderer.addDeathAnim(newP.x, newP.y, color, 18);
      }
    }
  }

  prevGameState = gameState;
  prevSnapshotTime = snapshotTime;
  gameState = state;
  snapshotTime = performance.now();
});

// Sniper hitscan lines
const sniperLines = []; // { x, y, endX, endY, time }

socket.on('sniperLine', (data) => {
  sniperLines.push({ ...data, time: performance.now() });
});

socket.on('playerHit', (data) => {
  effects.hitFlash = { angle: data.angle, startTime: performance.now(), duration: 300 };
  renderer.triggerScreenShake(data.damage * 0.3, 200);
});

socket.on('playerKilled', (data) => {
  killFeed.push({ ...data, time: performance.now() });

  if (data.victimId === myId) {
    const isCTF = currentModeConfig && currentModeConfig.ctf;
    const isRespawn = currentModeConfig && currentModeConfig.respawn;

    if (isCTF) {
      // CTF: death with class select
      dead = true;
      deathTime = performance.now();
      const overlay = document.getElementById('overlay');
      overlay.style.display = 'flex';
      overlay.innerHTML = `
        <h1 style="font-size:36px;color:#ff4444">KILLED</h1>
        <p style="color:#888;margin:8px 0 16px">Choose a class:</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
          <button onclick="window._selectClass('rusher')" style="padding:10px 16px;background:rgba(232,226,46,0.15);border:1px solid #e8e82e;color:#e8e82e;border-radius:6px;cursor:pointer;font-size:13px">
            <div style="font-weight:bold">Rusher</div><div style="font-size:11px;color:#aaa">SMG + Frags + Bandages</div>
          </button>
          <button onclick="window._selectClass('assault')" style="padding:10px 16px;background:rgba(74,158,255,0.15);border:1px solid #4a9eff;color:#4a9eff;border-radius:6px;cursor:pointer;font-size:13px">
            <div style="font-weight:bold">Assault</div><div style="font-size:11px;color:#aaa">Rifle + Frags + Bandages</div>
          </button>
          <button onclick="window._selectClass('breacher')" style="padding:10px 16px;background:rgba(255,140,66,0.15);border:1px solid #ff8c42;color:#ff8c42;border-radius:6px;cursor:pointer;font-size:13px">
            <div style="font-weight:bold">Breacher</div><div style="font-size:11px;color:#aaa">Shotgun + Smokes + MedKit</div>
          </button>
          <button onclick="window._selectClass('marksman')" style="padding:10px 16px;background:rgba(139,69,19,0.15);border:1px solid #8b4513;color:#cd853f;border-radius:6px;cursor:pointer;font-size:13px">
            <div style="font-weight:bold">Marksman</div><div style="font-size:11px;color:#aaa">Sniper + Smokes + Bandages</div>
          </button>
        </div>
        <p style="color:#555;margin-top:12px;font-size:11px">Respawning in 3s...</p>
      `;
    } else if (isRespawn) {
      // TDM: brief death flash, then wait for respawn
      dead = true;
      deathTime = performance.now();
      const overlay = document.getElementById('overlay');
      overlay.style.display = 'flex';
      overlay.innerHTML = `<h1 style="font-size:36px;color:#ff4444">KILLED</h1><p style="color:#888;margin-top:8px">Respawning...</p>`;
    } else {
      // BR: death -> spectator
      dead = true;
      deathTime = performance.now();
      const overlay = document.getElementById('overlay');
      overlay.style.display = 'flex';
      const survivalMs = gameState ? gameState.gameElapsedMs : 0;
      const myData = gameState ? gameState.players.find(p => p.id === myId) : null;
      const kills = myData ? myData.kills : 0;
      const sec = Math.floor(survivalMs / 1000);
      overlay.innerHTML = `
        <h1 style="font-family:Orbitron,sans-serif;font-size:42px;color:#ff6b4a;letter-spacing:6px">ELIMINATED</h1>
        <p style="color:#aaa;margin:8px">Survived: ${Math.floor(sec/60)}m ${sec%60}s</p>
        <p style="color:#aaa;margin:8px">Kills: ${kills}</p>
      `;
      setTimeout(() => {
        if (!gameOverData) {
          overlay.style.display = 'none';
          spectating = true;
          if (touchControls) touchControls.setSpectating(true);
          const alivePlayers = gameState ? gameState.players.filter(p => p.alive && p.id !== myId) : [];
          if (alivePlayers.length > 0) {
            spectateTargetId = alivePlayers[0].id;
          }
        }
      }, 2000);
    }
  }
});

socket.on('gameOver', (data) => {
  gameOverData = data;
  spectating = false;
  gameActive = false;
  if (isMobile) {
    document.body.classList.remove('in-game');
    if (touchControls) touchControls.hide();
  }
  const overlay = document.getElementById('overlay');
  overlay.style.display = 'flex';

  // Determine title
  let title;
  if (data.winningTeam) {
    // TDM mode
    const me = gameState ? gameState.players.find(p => p.id === myId) : null;
    const myTeam = me ? (me.team === 0 ? 'blue' : 'red') : null;
    const won = myTeam === data.winningTeam;
    const teamColor = data.winningTeam === 'blue' ? '#4a9eff' : '#ff6b6b';
    title = won
      ? `<h1 style="font-family:Orbitron,sans-serif;font-size:42px;color:#ffc832;letter-spacing:6px;margin-bottom:8px">VICTORY</h1>
         <div style="color:${teamColor};font-size:18px;margin-bottom:8px">${data.winningTeam.toUpperCase()} TEAM WINS</div>
         <div style="color:#888;font-size:16px;margin-bottom:16px">${data.teamScores[0]} - ${data.teamScores[1]}</div>`
      : `<h1 style="font-family:Orbitron,sans-serif;font-size:32px;color:#ff6b4a;letter-spacing:5px;margin-bottom:8px">DEFEAT</h1>
         <div style="color:${teamColor};font-size:18px;margin-bottom:8px">${data.winningTeam.toUpperCase()} TEAM WINS</div>
         <div style="color:#888;font-size:16px;margin-bottom:16px">${data.teamScores[0]} - ${data.teamScores[1]}</div>`;
  } else {
    const isWinner = data.winnerId === myId;
    title = isWinner
      ? '<h1 style="font-family:Orbitron,sans-serif;font-size:42px;color:#ffc832;letter-spacing:6px;margin-bottom:16px">VICTORY</h1>'
      : '<h1 style="font-family:Orbitron,sans-serif;font-size:32px;color:#ff6b4a;letter-spacing:5px;margin-bottom:16px">GAME OVER</h1>';
  }

  let leaderboardHTML = '';
  if (data.standings && data.standings.length > 0) {
    const me = gameState ? gameState.players.find(p => p.id === myId) : null;
    const myName = me ? me.name : '';
    const hasPlacements = data.standings[0].placement !== undefined;
    const hasTeams = data.standings[0].team !== undefined;

    const rows = data.standings.map(p => {
      const isMe = p.name === myName;
      const teamColor = p.team === 'blue' ? '#4a9eff' : p.team === 'red' ? '#ff6b6b' : '#ccc';
      const rowBg = isMe ? 'rgba(74,158,255,0.1)' : 'rgba(255,255,255,0.03)';
      return `<tr style="background:${rowBg}">
        ${hasPlacements ? `<td style="padding:6px 12px;color:#888">${p.placement}</td>` : ''}
        ${hasTeams ? `<td style="padding:6px 12px;color:${teamColor};font-size:11px">${(p.team || '').toUpperCase()}</td>` : ''}
        <td style="padding:6px 12px;color:${isMe ? '#fff' : '#ccc'}">${p.name}</td>
        <td style="padding:6px 12px;text-align:center;color:#ccc">${p.kills}</td>
        <td style="padding:6px 12px;text-align:center;color:#ccc">${p.damageDealt}</td>
      </tr>`;
    }).join('');

    leaderboardHTML = `
      <table style="border-collapse:collapse;margin:16px 0;font-size:13px;font-family:Rajdhani,sans-serif;min-width:360px">
        <thead>
          <tr style="border-bottom:1px solid #444">
            ${hasPlacements ? '<th style="padding:6px 12px;color:#888;text-align:left">#</th>' : ''}
            ${hasTeams ? '<th style="padding:6px 12px;color:#888;text-align:left">Team</th>' : ''}
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
    <div id="ratingChange" style="font-family:Orbitron,sans-serif;font-size:14px;letter-spacing:2px;margin-bottom:12px;min-height:24px"></div>
    ${leaderboardHTML}
    <button onclick="location.reload()" style="margin-top:12px;padding:14px 40px;font-family:Orbitron,sans-serif;font-size:12px;letter-spacing:3px;background:transparent;color:#4a9eff;border:2px solid rgba(74,158,255,0.4);cursor:pointer;text-transform:uppercase">Play Again</button>
  `;
});

socket.on('ratingUpdate', (changes) => {
  const myChange = changes[myId];
  if (!myChange) return;

  const el = document.getElementById('ratingChange');
  if (!el) return;

  const delta = myChange.delta;
  const sign = delta >= 0 ? '+' : '';
  const color = delta >= 0 ? '#50c878' : '#ff4a4a';
  const botTag = myChange.hasBots ? ' <span style="color:var(--text-muted,#333a50);font-size:10px;letter-spacing:1px">BOT MATCH</span>' : '';

  el.innerHTML = `<span style="color:var(--text-dim,#5a6480)">${myChange.before}</span> <span style="color:${color}">${sign}${delta}</span> <span style="color:var(--text-primary,#e0e6f0)">${myChange.after}</span>${botTag}`;

  // Refresh sidebar stats
  _populateSidebar();
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
  // Extrapolate bullets forward using actual velocity, cap at half a tick
  const elapsed = Math.min((performance.now() - snapshotTime) / 1000, 0.025);
  return bullets.map(b => {
    // Use server-provided velocity if available, fall back to angle-based
    const vx = b.vx != null ? b.vx : Math.cos(b.angle) * 600;
    const vy = b.vy != null ? b.vy : Math.sin(b.angle) * 600;
    return {
      ...b,
      x: b.x + vx * elapsed,
      y: b.y + vy * elapsed
    };
  });
}

// Remote player interpolation with extrapolation
function getInterpolatedPlayer(playerId) {
  const curr = gameState.players.find(p => p.id === playerId);
  if (!prevGameState || !curr) return curr;
  const prev = prevGameState.players.find(p => p.id === playerId);
  if (!prev) return curr;

  const elapsed = performance.now() - snapshotTime;
  const interval = snapshotTime - prevSnapshotTime || 50;
  const t = elapsed / interval;

  if (t <= 1) {
    // Normal interpolation between prev and current
    return {
      ...curr,
      x: prev.x + (curr.x - prev.x) * t,
      y: prev.y + (curr.y - prev.y) * t,
      angle: curr.angle
    };
  } else {
    // Extrapolate past current snapshot using velocity
    const vx = curr.x - prev.x;
    const vy = curr.y - prev.y;
    const extraT = Math.min(t - 1, 1); // cap extrapolation at 1 interval
    return {
      ...curr,
      x: curr.x + vx * extraT,
      y: curr.y + vy * extraT,
      angle: curr.angle
    };
  }
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
      ctx.font = "900 72px 'Orbitron', sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(remaining.toString(), canvas.width / 2, canvas.height / 2);
    } else {
      ctx.fillStyle = '#888';
      ctx.font = "400 18px 'Orbitron', sans-serif";
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
    let viewX = cameraX, viewY = cameraY;
    let isScoping = false;

    // Detect respawn in TDM
    if (dead && me && me.alive && currentModeConfig && currentModeConfig.respawn) {
      dead = false;
      deathTime = null;
      predictedX = me.x;
      predictedY = me.y;
      inputBuffer.length = 0;
      document.getElementById('overlay').style.display = 'none';
    }

    if (!dead && me && me.alive) {
      // Normal gameplay
      seq++;
      const inp = inputHandler.getInput();
      inp.seq = seq;
      sendInput(inp);

      // Detect shots fired (mag ammo decreased)
      const currentMagAmmo = me.gun ? me.gun.magAmmo : -1;
      if (prevMagAmmo >= 0 && currentMagAmmo < prevMagAmmo && currentMagAmmo >= 0) {
        lastShotTime = performance.now();
      }
      prevMagAmmo = currentMagAmmo;

      // Shot cooldown
      const weapon = me.gun ? WEAPONS[me.gun.type] : null;
      const shotCooldown = weapon ? 1000 / weapon.fireRate : 0;
      const timeSinceShot = performance.now() - lastShotTime;
      const cooldownPct = shotCooldown > 0 ? Math.min(1, timeSinceShot / shotCooldown) : 1;
      const onCooldown = cooldownPct < 1;

      // Set sniper mode
      const isSniper = me.gun && me.gun.type === 'sniper';
      inputHandler.setSniperMode(isSniper);
      inputHandler.scopeBlocked = onCooldown;
      if (touchControls) touchControls.setSniperVisible(isSniper);

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
          lastShotTime = performance.now();
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
      // Build collision walls: static walls minus destroyed, plus closed doors
      const destroyed = gameState.destroyedWalls ? new Set(gameState.destroyedWalls) : new Set();
      const activeStaticWalls = destroyed.size > 0
        ? renderer.allWalls.filter((_, i) => !destroyed.has(i))
        : renderer.allWalls;
      const closedDoorWalls = (gameState.doors || []).filter(d => !d.open);
      const allCollisionWalls = closedDoorWalls.length > 0
        ? [...activeStaticWalls, ...closedDoorWalls]
        : activeStaticWalls;

      isScoping = isSniper && inputHandler.scopeStartTime;
      const speedMult = (me.healing || me.reloading) ? 0.3 : isScoping ? 0.4 : 1.0;
      predictedX += dx * PLAYER_SPEED * speedMult * dt;
      predictedY += dy * PLAYER_SPEED * speedMult * dt;
      const resolved = resolveAgainstWalls(predictedX, predictedY, PLAYER_RADIUS, allCollisionWalls);
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
        const r = resolveAgainstWalls(reconX, reconY, PLAYER_RADIUS, allCollisionWalls);
        reconX = r.x;
        reconY = r.y;
      }
      const errX = reconX - predictedX;
      const errY = reconY - predictedY;
      const err = Math.sqrt(errX * errX + errY * errY);
      if (err > 100) {
        // Teleport — too far off (respawn, lag spike)
        predictedX = reconX;
        predictedY = reconY;
      } else if (err > 1) {
        // Smooth correction — blend toward server position
        const blend = Math.min(0.2, err * 0.01);
        predictedX += errX * blend;
        predictedY += errY * blend;
      }

      // Cap input buffer to prevent growing unbounded
      if (inputBuffer.length > 60) {
        inputBuffer.splice(0, inputBuffer.length - 60);
      }

      // Smooth camera
      if (cameraX === 0 && cameraY === 0) {
        cameraX = predictedX;
        cameraY = predictedY;
      } else {
        cameraX += (predictedX - cameraX) * 0.35;
        cameraY += (predictedY - cameraY) * 0.35;
      }
      viewX = cameraX;
      viewY = cameraY;

      // Sniper scope vision
      let currentVisionRange = 600;
      if (isSniper && inputHandler.scopeStartTime) {
        // Actively scoping
        const holdTime = performance.now() - inputHandler.scopeStartTime;
        const scopeProgress = Math.min(1, holdTime / 300);
        currentVisionRange = 600 + (1000 - 600) * scopeProgress;
        isScoping = true;
      } else if (isSniper && lastSniperFireTime > 0) {
        // After shot: keep extended vision during linger, then ease back
        const sinceShot = performance.now() - lastSniperFireTime;
        const lingerDuration = 1000;
        if (sinceShot < lingerDuration) {
          const t = sinceShot / lingerDuration;
          const eased = t * t;
          currentVisionRange = 600 + (1000 - 600) * (1 - eased);
        }
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

      shadowCaster.setDynamicWalls(gameState.doors, gameState.destroyedWalls);
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
      renderer.draw(viewX, viewY, visibility, cameraScale, gameState.destroyedWalls, effectiveVisionRange);

      // CTF territory tint and flag zones
      if (gameState.flags) {
        renderer.drawCTFTerritories(viewX, viewY, map.width, map.height);
        renderer.drawFlagZones(gameState.flags, viewX, viewY, timestamp);
      }

      // Ground items (all — shadow overlay will hide what's in shadow)
      renderer.drawGroundItems(gameState.groundItems, viewX, viewY, timestamp);

      // Bullets (interpolated for smooth motion)
      const interpBullets = getInterpolatedBullets(gameState.bullets);
      renderer.drawBullets(interpBullets, viewX, viewY);

      // Tracers
      renderer.drawTracers(interpBullets, tracerTrails, viewX, viewY, performance.now());

      // Grenades
      renderer.drawGrenades(gameState.grenades, viewX, viewY, timestamp);

      // Other players (all alive — shadow covers hidden parts)
      ctx.save();
      ctx.translate(canvas.width / 2 - viewX * cameraScale + (renderer._shakeOffsetX||0), canvas.height / 2 - viewY * cameraScale + (renderer._shakeOffsetY||0));
      ctx.scale(cameraScale, cameraScale);

      const playerIndex = gameState.players.findIndex(p => p.id === myId);
      gameState.players.forEach((p, i) => {
        if (p.id === myId || !p.alive) return;
        const interp = getInterpolatedPlayer(p.id);
        const otherGunType = interp.gun ? interp.gun.type : null;
        renderer.drawPlayer(interp.x, interp.y, interp.angle, PLAYER_RADIUS, getPlayerColor(p || interp, i), interp.health, PLAYER_HP, otherGunType, interp.name);
        // CTF carrier glow
        if (gameState.flags) {
          for (const flag of gameState.flags) {
            if (flag.state === 'carried' && flag.carrierId === p.id) {
              renderer.drawCarrierGlow(interp.x, interp.y, PLAYER_RADIUS, timestamp);
            }
          }
        }
      });

      ctx.restore();

      // Shadow overlay ON TOP of entities — covers hidden parts but leaves visible edges
      renderer.drawShadowAndWalls();

      // Particles and effects (drawn above shadow)
      renderer.addFootstep(viewX, viewY);
      renderer.updateAndDrawParticles(viewX, viewY, dt, timestamp);

      // Local player drawn ABOVE shadow (always fully visible)
      ctx.save();
      ctx.translate(canvas.width / 2 - viewX * cameraScale + (renderer._shakeOffsetX||0), canvas.height / 2 - viewY * cameraScale + (renderer._shakeOffsetY||0));
      ctx.scale(cameraScale, cameraScale);
      const myGunType = me.gun ? me.gun.type : null;
      // Weapon range preview
      if (me.gun && WEAPONS[me.gun.type]) {
        renderer._sniperScoping = isScoping;
        renderer.drawWeaponRange(ctx, viewX, viewY, inp.angle, WEAPONS[me.gun.type], cameraScale);
      }
      renderer.drawPlayer(viewX, viewY, inp.angle, PLAYER_RADIUS, getPlayerColor(me, playerIndex), me.health, PLAYER_HP, myGunType, me.name);
      // CTF carrier glow for local player
      if (gameState.flags) {
        for (const flag of gameState.flags) {
          if (flag.state === 'carried' && flag.carrierId === myId) {
            renderer.drawCarrierGlow(viewX, viewY, PLAYER_RADIUS, timestamp);
          }
        }
      }

      // Healing plus symbols and reload bullet icons on local player
      renderer.drawPlayerStatusEffects(ctx, [{ ...me, x: viewX, y: viewY }], timestamp);

      ctx.restore();

      // Status effects on other players (in world space)
      ctx.save();
      ctx.translate(canvas.width / 2 - viewX * cameraScale + (renderer._shakeOffsetX||0), canvas.height / 2 - viewY * cameraScale + (renderer._shakeOffsetY||0));
      ctx.scale(cameraScale, cameraScale);
      renderer.drawPlayerStatusEffects(ctx, gameState.players.filter(p => p.id !== myId && p.alive), timestamp);
      ctx.restore();

      // Doors
      if (gameState.doors) {
        renderer.drawDoors(gameState.doors, viewX, viewY, timestamp);
      }

      // Zone, smoke clouds, effects
      renderer.drawZone(gameState.zone, viewX, viewY, timestamp);
      renderer.drawSmokeClouds(activeSmokes, viewX, viewY, timestamp);
      renderer.drawExplosions(effects.explosions, viewX, viewY, performance.now());
      renderer.drawSniperLines(sniperLines, viewX, viewY, performance.now());
      renderer.drawHitFlash(canvas.width, canvas.height, effects.hitFlash, performance.now());
      if (effects.hitFlash && performance.now() - effects.hitFlash.startTime > effects.hitFlash.duration) {
        effects.hitFlash = null;
      }

      // Scope: no overlay, camera zoom handled by vision range

      // HUD
      hud.draw(ctx, canvas.width, canvas.height, me, gameState);
      renderer.drawActionProgressBar(ctx, canvas.width, canvas.height, me, gameState);
      if (me.gun && onCooldown) {
        hud.drawShotCooldown(ctx, canvas.width, canvas.height, cooldownPct);
      }
      const teammates = (me.team !== undefined && me.team !== null)
        ? gameState.players.filter(p => p.id !== myId && p.alive && p.team === me.team)
        : [];
      hud.drawMinimap(ctx, canvas.width, canvas.height, map, viewX, viewY, gameState.zone, gameState.destroyedWalls, teammates, gameState.flags);
      hud.drawKillFeed(ctx, canvas.width, killFeed, performance.now());
      hud.drawWarning(ctx, canvas.width, canvas.height, warning, performance.now());
      hud.drawItemTooltip(ctx, canvas.width, canvas.height, gameState.groundItems, viewX, viewY, cameraScale, gameState.doors);

      // CTF HUD
      if (gameState.flags && gameState.ctfTimers && currentModeConfig) {
        hud.drawCTFStatus(ctx, canvas.width, gameState.flags, gameState.ctfTimers,
          currentModeConfig.holdTimeToWin || 180, gameState.players);
        // Carrier arrows
        for (const flag of gameState.flags) {
          if (flag.state === 'carried' && flag.carrierId) {
            const carrier = gameState.players.find(p => p.id === flag.carrierId);
            if (carrier) {
              const teamColor = flag.team === 'blue' ? '#4a9eff' : '#ff6b6b';
              renderer.drawCarrierArrow(ctx, canvas.width, canvas.height,
                carrier.x, carrier.y, viewX, viewY, teamColor);
            }
          }
        }
      }

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

        shadowCaster.setDynamicWalls(gameState.doors, gameState.destroyedWalls);
        shadowCaster.addSmokeBlockers(activeSmokes);
        const visibility = shadowCaster.computeVisibility(viewX, viewY, isInSmoke ? 40 : 600);
        shadowCaster.removeSmokeBlockers();

        renderer.draw(viewX, viewY, visibility, 1, gameState.destroyedWalls, isInSmoke ? 40 : 600);

        renderer.drawGroundItems(gameState.groundItems, viewX, viewY, timestamp);

        const interpBullets = getInterpolatedBullets(gameState.bullets);
        renderer.drawBullets(interpBullets, viewX, viewY);
        renderer.drawTracers(interpBullets, tracerTrails, viewX, viewY, performance.now());

        renderer.drawGrenades(gameState.grenades, viewX, viewY, timestamp);

        ctx.save();
        ctx.translate(canvas.width / 2 - viewX, canvas.height / 2 - viewY);
        gameState.players.forEach((p, i) => {
          if (!p.alive) return;
          const interp = getInterpolatedPlayer(p.id);
          const gunType = interp.gun ? interp.gun.type : null;
          renderer.drawPlayer(interp.x, interp.y, interp.angle, PLAYER_RADIUS, getPlayerColor(p || interp, i), interp.health, PLAYER_HP, gunType, interp.name);
        });
        ctx.restore();

        renderer.drawShadowAndWalls();

        if (gameState.doors) renderer.drawDoors(gameState.doors, viewX, viewY, timestamp);
        renderer.drawZone(gameState.zone, viewX, viewY, timestamp);
        renderer.drawSmokeClouds(activeSmokes, viewX, viewY, timestamp);
        renderer.drawExplosions(effects.explosions, viewX, viewY, performance.now());
        renderer.drawSniperLines(sniperLines, viewX, viewY, performance.now());

        hud.drawSpectatorHUD(ctx, canvas.width, canvas.height,
          spectTarget.name || '?', gameState.alivePlayers, gameState.players.length);
        hud.drawMinimap(ctx, canvas.width, canvas.height, map, viewX, viewY, gameState.zone, gameState.destroyedWalls, [], gameState.flags);
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
        // Mobile spectator navigation
        if (inputHandler._spectatorPrev) {
          inputHandler._spectatorPrev = false;
          const alive = gameState.players.filter(p => p.alive);
          const idx = alive.findIndex(p => p.id === spectateTargetId);
          spectateTargetId = alive[(idx - 1 + alive.length) % alive.length].id;
        }
        if (inputHandler._spectatorNext) {
          inputHandler._spectatorNext = false;
          const alive = gameState.players.filter(p => p.alive);
          const idx = alive.findIndex(p => p.id === spectateTargetId);
          spectateTargetId = alive[(idx + 1) % alive.length].id;
        }
        if (inputHandler.shooting) {
          spectating = false;
          inputHandler.shooting = false;
          const overlay = document.getElementById('overlay');
          overlay.style.display = 'flex';
          overlay.innerHTML = `<h1 style="font-size:36px;color:#ff4444">ELIMINATED</h1>
            <button onclick="location.reload()" style="margin-top:20px;padding:14px 40px;font-family:Orbitron,sans-serif;font-size:12px;letter-spacing:3px;background:transparent;color:#4a9eff;border:2px solid rgba(74,158,255,0.4);cursor:pointer;text-transform:uppercase">Play Again</button>`;
        }
      }
    }
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
