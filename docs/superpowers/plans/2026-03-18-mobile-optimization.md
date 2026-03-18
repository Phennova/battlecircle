# Mobile Optimization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BattleCircle fully playable on mobile browsers with responsive layouts, dual joystick touch controls, and landscape enforcement.

**Architecture:** CSS media queries handle responsive layout (auth, home, lobby). A new `TouchControls.js` module manages dual joystick + action buttons as HTML overlays, writing directly to `InputHandler` properties. Landscape lock uses Fullscreen + Screen Orientation APIs during gameplay only.

**Tech Stack:** Vanilla JS, CSS media queries, Touch Events API, Fullscreen API, Screen Orientation API

---

## Chunk 1: Foundation — Mobile Detection, Viewport, Portrait Blocker

### Task 1: Mobile Detection & Viewport Meta

**Files:**
- Modify: `public/index.html:5` (viewport meta)
- Modify: `public/main.js:8-13` (add isMobile after imports)

- [ ] **Step 1: Update viewport meta tag**

In `public/index.html`, replace line 5:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no">
```

- [ ] **Step 2: Add isMobile detection to main.js**

At the top of `public/main.js`, after the Supabase imports (around line 14), add:
```javascript
// ═══ MOBILE DETECTION ═══
const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
if (isMobile) document.body.classList.add('is-mobile');
window.isMobile = isMobile; // expose globally for other modules
```

- [ ] **Step 3: Commit**
```bash
git add public/index.html public/main.js
git commit -m "feat(mobile): add mobile detection and viewport meta"
```

### Task 2: Portrait Blocker Overlay

**Files:**
- Modify: `public/index.html` (add overlay HTML + CSS)

- [ ] **Step 1: Add portrait blocker CSS**

In `public/index.html`, add before the `/* ═══ AUTH SCREEN ═══ */` comment in the `<style>` block:
```css
/* ═══ PORTRAIT BLOCKER ═══ */
#portraitBlocker {
  display: none;
  position: fixed; inset: 0; z-index: 9999;
  background: var(--bg-deep);
  flex-direction: column;
  align-items: center; justify-content: center;
  font-family: var(--font-display);
}
#portraitBlocker .rotate-icon {
  font-size: 48px; margin-bottom: 24px;
  animation: rotate-hint 2s ease-in-out infinite;
}
#portraitBlocker .rotate-text {
  font-size: 12px; letter-spacing: 4px;
  color: var(--text-dim);
}
@keyframes rotate-hint {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(90deg); }
}
@media (orientation: portrait) {
  body.is-mobile.in-game #portraitBlocker {
    display: flex;
  }
}
```

- [ ] **Step 2: Add portrait blocker HTML**

Add this right after the opening `<body>` tag, before the `<canvas>`:
```html
<div id="portraitBlocker">
  <div class="rotate-icon">&#x21BB;</div>
  <div class="rotate-text">ROTATE YOUR DEVICE</div>
</div>
```

- [ ] **Step 3: Commit**
```bash
git add public/index.html
git commit -m "feat(mobile): add portrait blocker overlay for gameplay"
```

### Task 3: Fullscreen & Orientation Lock on Game Start

**Files:**
- Modify: `public/main.js` (countdown handler)

- [ ] **Step 1: Add fullscreen + orientation lock**

In `public/main.js`, find the `socket.on('countdown', ...)` handler. At the top of that handler (after `countdownEnd = ...`), add:
```javascript
  // Mobile: enter fullscreen and lock landscape
  if (isMobile) {
    document.body.classList.add('in-game');
    try {
      await document.documentElement.requestFullscreen?.();
      await screen.orientation?.lock?.('landscape');
    } catch (e) { /* not all browsers support orientation lock */ }
  }
```

Note: The callback needs to become `async`. Change `socket.on('countdown', (data) => {` to `socket.on('countdown', async (data) => {`.

- [ ] **Step 2: Remove in-game class on game over**

In the `socket.on('gameOver', ...)` handler, add at the top:
```javascript
  if (isMobile) document.body.classList.remove('in-game');
```

- [ ] **Step 3: Test manually**

Open on mobile (or Chrome DevTools mobile emulator). Click a mode, enter queue/lobby. When countdown starts, fullscreen should activate and portrait blocker should appear if phone is portrait.

- [ ] **Step 4: Commit**
```bash
git add public/main.js
git commit -m "feat(mobile): fullscreen + orientation lock on game start"
```

---

## Chunk 2: Responsive Auth & Home Page

### Task 4: Responsive Auth Page

**Files:**
- Modify: `public/index.html` (CSS)

- [ ] **Step 1: Add mobile auth CSS**

In `public/index.html`, add at the end of the `<style>` block (before `</style>`):
```css
/* ═══ MOBILE RESPONSIVE ═══ */
@media (max-width: 768px) {
  .auth-box {
    width: min(340px, calc(100vw - 32px)) !important;
    padding: 24px 20px !important;
  }
  .auth-input {
    height: 48px !important;
    font-size: 16px !important; /* prevents iOS zoom on focus */
  }
  .auth-submit {
    height: 48px !important;
    font-size: 14px !important;
  }
}
```

- [ ] **Step 2: Commit**
```bash
git add public/index.html
git commit -m "feat(mobile): responsive auth page"
```

### Task 5: Mobile Top Bar & Bottom Tab Bar HTML

**Files:**
- Modify: `public/index.html` (HTML + CSS)

- [ ] **Step 1: Add mobile top bar HTML**

In `public/index.html`, find the `<div id="modeSelect"` opening tag. Add this right before it (inside the main flex container, before the sidebar):
```html
<!-- Mobile Top Bar (hidden on desktop) -->
<div id="mobileTopBar">
  <div style="font-family:var(--font-display);font-size:13px;font-weight:900;letter-spacing:2px;color:var(--accent)">BATTLECIRCLE</div>
  <div style="text-align:right">
    <div style="font-family:var(--font-body);font-size:13px;color:var(--text-primary)" id="mobileUsername">Player</div>
    <div style="font-family:var(--font-body);font-size:10px;color:var(--text-dim)" id="mobileRating">1500</div>
  </div>
</div>
```

- [ ] **Step 2: Add mobile bottom tab bar HTML**

Add this right before the closing `</div>` of the mode select container (the outermost flex wrapper):
```html
<!-- Mobile Bottom Tab Bar (hidden on desktop) -->
<div id="mobileTabBar">
  <div class="mobile-tab active" data-page="play" onclick="window._switchPage('play')">PLAY</div>
  <div class="mobile-tab" data-page="leaderboard" onclick="window._switchPage('leaderboard')">LEADERBOARD</div>
  <div class="mobile-tab" data-page="profile" onclick="window._switchPage('profile')">PROFILE</div>
</div>
```

- [ ] **Step 3: Add mobile layout CSS**

Add to the responsive `@media (max-width: 768px)` block:
```css
  /* Hide desktop sidebar on mobile */
  #modeSelect > div:first-child { display: none !important; }

  /* Mobile top bar */
  #mobileTopBar {
    display: flex !important;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: rgba(12,16,28,0.95);
    border-bottom: 1px solid var(--border);
    position: fixed; top: 0; left: 0; right: 0; z-index: 10;
    height: 48px;
  }

  /* Mobile bottom tab bar */
  #mobileTabBar {
    display: flex !important;
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 10;
    height: 44px;
    background: rgba(12,16,28,0.98);
    border-top: 1px solid var(--border);
  }
  .mobile-tab {
    flex: 1;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-display);
    font-size: 9px; letter-spacing: 2px;
    color: var(--text-dim);
    cursor: pointer;
    border-top: 2px solid transparent;
    transition: all 0.15s;
  }
  .mobile-tab.active {
    color: var(--accent);
    border-top-color: var(--accent);
  }

  /* Main content area — account for fixed top/bottom bars */
  #mainContent {
    padding: 60px 16px 56px 16px !important;
  }

  /* Mode grid single column */
  #page-play > div:nth-child(2),
  #page-play > div:nth-child(4) {
    grid-template-columns: 1fr !important;
  }
}
```

- [ ] **Step 4: Hide mobile elements on desktop (add outside the media query)**

```css
#mobileTopBar { display: none; }
#mobileTabBar { display: none; }
```

- [ ] **Step 5: Commit**
```bash
git add public/index.html
git commit -m "feat(mobile): responsive home page with top bar and bottom tabs"
```

### Task 6: Wire Mobile Tab Bar & Populate Mobile Top Bar

**Files:**
- Modify: `public/main.js`

- [ ] **Step 1: Update _switchPage to sync mobile tabs**

In `public/main.js`, update the `_switchPage` function to also toggle mobile tab active state:
```javascript
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
```

- [ ] **Step 2: Populate mobile top bar in _populateSidebar**

In `_populateSidebar()`, after the existing sidebar population code, add:
```javascript
  // Also populate mobile top bar
  const mobileUser = document.getElementById('mobileUsername');
  const mobileRating = document.getElementById('mobileRating');
  if (mobileUser) mobileUser.textContent = displayName;
  if (mobileRating && data) mobileRating.textContent = Math.round(data.rating);
```

- [ ] **Step 3: Update _loadProfile to use isMobile for grid columns**

In the `_loadProfile` function, find the stats grid line with `grid-template-columns:repeat(4,1fr)` and replace both instances:
```javascript
const gridCols = isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)';
```
Use `gridCols` in both the stats grid and mode breakdown `grid-template-columns` style.

- [ ] **Step 4: Wrap leaderboard table in scrollable container**

In `_loadLeaderboard`, wrap the table HTML:
```javascript
container.innerHTML = `<div style="overflow-x:auto">${html}</div>`;
```
(instead of just `container.innerHTML = html;`)

- [ ] **Step 5: Commit**
```bash
git add public/main.js
git commit -m "feat(mobile): wire bottom tab bar and mobile-friendly profile/leaderboard"
```

---

## Chunk 3: Touch Controls

### Task 7: Create TouchControls.js — Dual Joystick Core

**Files:**
- Create: `public/TouchControls.js`

- [ ] **Step 1: Create the TouchControls module**

Create `public/TouchControls.js` with the dual joystick system:
```javascript
/**
 * Mobile touch controls — dual joystick + action buttons.
 * Writes directly to InputHandler properties.
 */
export class TouchControls {
  constructor(canvas, inputHandler) {
    this.canvas = canvas;
    this.input = inputHandler;
    this.active = false;
    this.spectating = false;

    // Joystick state
    this.leftTouch = null;  // touch identifier
    this.rightTouch = null;
    this.leftOrigin = { x: 0, y: 0 };
    this.rightOrigin = { x: 0, y: 0 };
    this.leftPos = { x: 0, y: 0 };
    this.rightPos = { x: 0, y: 0 };
    this.leftActive = false;
    this.rightActive = false;

    // Joystick config
    this.outerRadius = 60;
    this.innerRadius = 25;
    this.deadzone = 10;
    this.fireThreshold = 25;
    this.leftZone = 0.4;  // left 40%
    this.rightZone = 0.6; // right 40% (starts at 60%)

    // Scope state
    this.scopeActive = false;

    // Create overlay container
    this.overlay = document.createElement('div');
    this.overlay.id = 'touchControls';
    this.overlay.style.cssText = 'position:fixed;inset:0;z-index:15;pointer-events:none;display:none';
    document.body.appendChild(this.overlay);

    // Create joystick canvases
    this.leftJoystickEl = this._createJoystickElement('left');
    this.rightJoystickEl = this._createJoystickElement('right');
    this.overlay.appendChild(this.leftJoystickEl);
    this.overlay.appendChild(this.rightJoystickEl);

    // Create action buttons
    this.actionBar = this._createActionButtons();
    this.overlay.appendChild(this.actionBar);

    // Create scope button (hidden by default)
    this.scopeBtn = this._createScopeButton();
    this.overlay.appendChild(this.scopeBtn);

    // Touch event listeners on canvas
    canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    canvas.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
    canvas.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: false });
  }

  show() {
    this.active = true;
    this.overlay.style.display = 'block';
  }

  hide() {
    this.active = false;
    this.overlay.style.display = 'none';
    this._resetAll();
  }

  setSpectating(val) {
    this.spectating = val;
    this.leftJoystickEl.style.display = val ? 'none' : 'block';
    this.rightJoystickEl.style.display = val ? 'none' : 'block';
    this.actionBar.style.display = val ? 'none' : 'flex';
    this.scopeBtn.style.display = 'none';
  }

  setSniperVisible(visible) {
    this.scopeBtn.style.display = visible ? 'flex' : 'none';
  }

  // ── Touch Handlers ──

  _onTouchStart(e) {
    if (!this.active) return;
    e.preventDefault();

    for (const touch of e.changedTouches) {
      const x = touch.clientX;
      const y = touch.clientY;
      const w = window.innerWidth;

      if (this.spectating) {
        // Spectator: tap left/right to cycle
        if (x < w / 2) {
          this.input._spectatorPrev = true;
        } else {
          this.input._spectatorNext = true;
        }
        continue;
      }

      const zone = x / w;

      // Left zone (0% - 40%)
      if (zone < this.leftZone && this.leftTouch === null) {
        this.leftTouch = touch.identifier;
        this.leftOrigin = { x, y };
        this.leftPos = { x, y };
        this.leftActive = true;
        this._updateLeftJoystick();
      }
      // Right zone (60% - 100%)
      else if (zone >= this.rightZone && this.rightTouch === null) {
        this.rightTouch = touch.identifier;
        this.rightOrigin = { x, y };
        this.rightPos = { x, y };
        this.rightActive = true;
        this._updateRightJoystick();
      }
      // Center zone (40% - 60%): ignored
    }
  }

  _onTouchMove(e) {
    if (!this.active || this.spectating) return;
    e.preventDefault();

    for (const touch of e.changedTouches) {
      if (touch.identifier === this.leftTouch) {
        this.leftPos = { x: touch.clientX, y: touch.clientY };
        this._processLeftJoystick();
        this._updateLeftJoystick();
      }
      if (touch.identifier === this.rightTouch) {
        this.rightPos = { x: touch.clientX, y: touch.clientY };
        this._processRightJoystick();
        this._updateRightJoystick();
      }
    }
  }

  _onTouchEnd(e) {
    if (!this.active) return;
    e.preventDefault();

    for (const touch of e.changedTouches) {
      if (touch.identifier === this.leftTouch) {
        this.leftTouch = null;
        this.leftActive = false;
        this.input.keys.up = false;
        this.input.keys.down = false;
        this.input.keys.left = false;
        this.input.keys.right = false;
        this._updateLeftJoystick();
      }
      if (touch.identifier === this.rightTouch) {
        this.rightTouch = null;
        this.rightActive = false;
        this.input.shooting = false;
        // Aim angle persists — don't reset input.angle
        this._updateRightJoystick();
      }
    }
  }

  // ── Joystick Processing ──

  _processLeftJoystick() {
    const dx = this.leftPos.x - this.leftOrigin.x;
    const dy = this.leftPos.y - this.leftOrigin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < this.deadzone) {
      this.input.keys.up = false;
      this.input.keys.down = false;
      this.input.keys.left = false;
      this.input.keys.right = false;
      return;
    }

    const angle = Math.atan2(dy, dx);
    // Map angle to WASD booleans
    this.input.keys.right = Math.cos(angle) > 0.3;
    this.input.keys.left = Math.cos(angle) < -0.3;
    this.input.keys.down = Math.sin(angle) > 0.3;
    this.input.keys.up = Math.sin(angle) < -0.3;
  }

  _processRightJoystick() {
    const dx = this.rightPos.x - this.rightOrigin.x;
    const dy = this.rightPos.y - this.rightOrigin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < this.deadzone) {
      this.input.shooting = false;
      return;
    }

    // Set aim angle relative to canvas center
    this.input.angle = Math.atan2(dy, dx);

    // Auto-fire when dragged beyond threshold
    if (dist > this.fireThreshold) {
      if (this.input.sniperMode && !this.input.scopeStartTime && !this.input.scopeBlocked) {
        // Sniper: enter scope on drag
        if (!this.scopeActive) {
          this.scopeActive = true;
          this.input.scopeStartTime = performance.now();
        }
      } else if (!this.input.sniperMode) {
        this.input.shooting = true;
      }
    } else {
      this.input.shooting = false;
    }
  }

  _resetAll() {
    this.leftTouch = null;
    this.rightTouch = null;
    this.leftActive = false;
    this.rightActive = false;
    this.input.keys.up = false;
    this.input.keys.down = false;
    this.input.keys.left = false;
    this.input.keys.right = false;
    this.input.shooting = false;
  }

  // ── UI Elements ──

  _createJoystickElement(side) {
    const el = document.createElement('div');
    const size = this.outerRadius * 2;
    el.style.cssText = `position:fixed;width:${size}px;height:${size}px;pointer-events:none;opacity:0.3;transition:opacity 0.15s`;
    el.innerHTML = `
      <div style="position:absolute;inset:0;border-radius:50%;border:2px solid rgba(74,158,255,0.3)"></div>
      <div class="knob" style="position:absolute;width:${this.innerRadius*2}px;height:${this.innerRadius*2}px;border-radius:50%;background:rgba(74,158,255,0.2);border:2px solid rgba(74,158,255,0.5);left:50%;top:50%;transform:translate(-50%,-50%)"></div>
    `;
    if (side === 'left') {
      el.style.bottom = '20px';
      el.style.left = '20px';
    } else {
      el.style.bottom = '20px';
      el.style.right = '100px';
    }
    return el;
  }

  _updateLeftJoystick() {
    if (this.leftActive) {
      this.leftJoystickEl.style.opacity = '0.8';
      this.leftJoystickEl.style.left = (this.leftOrigin.x - this.outerRadius) + 'px';
      this.leftJoystickEl.style.top = (this.leftOrigin.y - this.outerRadius) + 'px';
      this.leftJoystickEl.style.bottom = 'auto';

      const dx = Math.min(Math.max(this.leftPos.x - this.leftOrigin.x, -this.outerRadius), this.outerRadius);
      const dy = Math.min(Math.max(this.leftPos.y - this.leftOrigin.y, -this.outerRadius), this.outerRadius);
      const knob = this.leftJoystickEl.querySelector('.knob');
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else {
      this.leftJoystickEl.style.opacity = '0.3';
      this.leftJoystickEl.style.left = '20px';
      this.leftJoystickEl.style.top = 'auto';
      this.leftJoystickEl.style.bottom = '20px';
      const knob = this.leftJoystickEl.querySelector('.knob');
      knob.style.transform = 'translate(-50%, -50%)';
    }
  }

  _updateRightJoystick() {
    if (this.rightActive) {
      this.rightJoystickEl.style.opacity = '0.8';
      this.rightJoystickEl.style.right = 'auto';
      this.rightJoystickEl.style.left = (this.rightOrigin.x - this.outerRadius) + 'px';
      this.rightJoystickEl.style.top = (this.rightOrigin.y - this.outerRadius) + 'px';
      this.rightJoystickEl.style.bottom = 'auto';

      const dx = Math.min(Math.max(this.rightPos.x - this.rightOrigin.x, -this.outerRadius), this.outerRadius);
      const dy = Math.min(Math.max(this.rightPos.y - this.rightOrigin.y, -this.outerRadius), this.outerRadius);
      const knob = this.rightJoystickEl.querySelector('.knob');
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else {
      this.rightJoystickEl.style.opacity = '0.3';
      this.rightJoystickEl.style.left = 'auto';
      this.rightJoystickEl.style.right = '100px';
      this.rightJoystickEl.style.top = 'auto';
      this.rightJoystickEl.style.bottom = '20px';
      const knob = this.rightJoystickEl.querySelector('.knob');
      knob.style.transform = 'translate(-50%, -50%)';
    }
  }

  _createActionButtons() {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;right:12px;bottom:140px;display:flex;flex-direction:column;gap:8px;pointer-events:auto;z-index:16';

    const buttons = [
      { key: '_reloadPressed', label: 'R', color: 'rgba(255,255,255,0.15)' },
      { key: '_healPressed', label: 'H', color: 'rgba(80,200,120,0.15)' },
      { key: '_grenadePressed', label: 'G', color: 'rgba(255,107,74,0.15)' },
      { key: '_pickupPressed', label: 'E', color: 'rgba(74,158,255,0.15)' }
    ];

    for (const btn of buttons) {
      const el = document.createElement('div');
      el.style.cssText = `width:44px;height:44px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:${btn.color};display:flex;align-items:center;justify-content:center;color:#e0e6f0;font-family:var(--font-display);font-size:12px;font-weight:bold;cursor:pointer;user-select:none`;
      el.textContent = btn.label;
      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.input[btn.key] = true;
      }, { passive: false });
      bar.appendChild(el);
    }

    return bar;
  }

  _createScopeButton() {
    const btn = document.createElement('div');
    btn.style.cssText = 'position:fixed;right:70px;bottom:20px;width:50px;height:50px;border-radius:50%;border:2px solid rgba(74,158,255,0.3);background:rgba(74,158,255,0.1);display:none;align-items:center;justify-content:center;pointer-events:auto;z-index:16;user-select:none';
    btn.innerHTML = '<span style="color:#4a9eff;font-family:var(--font-display);font-size:8px;letter-spacing:1px">SCOPE</span>';
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.input.sniperMode) {
        if (this.input.scopeStartTime) {
          // Exit scope — fire sniper
          this.input._sniperFirePending = true;
          this.input._sniperFireAngle = this.input.angle;
          this.input.scopeStartTime = null;
          this.scopeActive = false;
        } else if (!this.input.scopeBlocked) {
          // Enter scope
          this.input.scopeStartTime = performance.now();
          this.scopeActive = true;
        }
      }
    }, { passive: false });
    return btn;
  }
}
```

- [ ] **Step 2: Commit**
```bash
git add public/TouchControls.js
git commit -m "feat(mobile): create TouchControls.js with dual joystick + action buttons"
```

### Task 8: Integrate TouchControls into Main Game Loop

**Files:**
- Modify: `public/main.js`

- [ ] **Step 1: Import and initialize TouchControls**

In `public/main.js`, after the `InputHandler` import, add:
```javascript
import { TouchControls } from './TouchControls.js';
```

After `const inputHandler = new InputHandler(canvas);`, add:
```javascript
let touchControls = null;
if (isMobile) {
  touchControls = new TouchControls(canvas, inputHandler);
}
```

- [ ] **Step 2: Show touch controls when game starts**

In the `socket.on('countdown', ...)` handler, after the fullscreen/orientation code, add:
```javascript
  if (touchControls) touchControls.show();
```

In the `socket.on('gameOver', ...)` handler, add:
```javascript
  if (touchControls) touchControls.hide();
```

- [ ] **Step 3: Wire spectator mode to touch controls**

Find where spectating state changes in `main.js`. In the death handling code where `spectating = true` is set, add:
```javascript
  if (touchControls) touchControls.setSpectating(true);
```

Add spectator touch navigation — in the game loop where spectator arrow key input is checked, add:
```javascript
  // Mobile spectator navigation
  if (inputHandler._spectatorPrev) {
    inputHandler._spectatorPrev = false;
    // cycle to previous player (same as ArrowLeft)
    // existing spectator cycle logic
  }
  if (inputHandler._spectatorNext) {
    inputHandler._spectatorNext = false;
    // cycle to next player (same as ArrowRight)
    // existing spectator cycle logic
  }
```

- [ ] **Step 4: Wire sniper scope visibility**

In the game loop, where `inputHandler.setSniperMode()` is called, add after it:
```javascript
  if (touchControls) touchControls.setSniperVisible(player.gun?.type === 'sniper');
```

- [ ] **Step 5: Commit**
```bash
git add public/main.js
git commit -m "feat(mobile): integrate touch controls into game loop"
```

---

## Chunk 4: HUD Adjustments & Polish

### Task 9: Mobile HUD Sizing

**Files:**
- Modify: `public/HUD.js`

- [ ] **Step 1: Hide keybind hints on mobile**

In `public/HUD.js`, find the `drawHUD` method where `_drawKeybindHints` is called (line 21). Wrap it:
```javascript
if (!window.isMobile) {
  this._drawKeybindHints(ctx, canvasW - 20, canvasH - 14);
}
```

- [ ] **Step 2: Adjust minimap size on mobile**

Find where the minimap is drawn. The minimap size/position should check `window.isMobile` and use a smaller radius. Find the minimap drawing code and adjust:
```javascript
const minimapSize = window.isMobile ? 100 : 140;
```
(Apply wherever the minimap dimensions are used)

- [ ] **Step 3: Adjust kill feed position on mobile**

Find the kill feed rendering. On mobile, position it at top-center instead of top-left/right:
```javascript
const killFeedX = window.isMobile ? canvasW / 2 - 100 : /* existing position */;
```

- [ ] **Step 4: Commit**
```bash
git add public/HUD.js
git commit -m "feat(mobile): adjust HUD sizing for mobile screens"
```

### Task 10: Mobile-Friendly Overlays

**Files:**
- Modify: `public/main.js`

- [ ] **Step 1: Mobile-friendly CTF class select buttons**

In `public/main.js`, find the CTF class select overlay code (around line 624 and line 749). Replace the button padding to check `isMobile`:
```javascript
const btnPad = isMobile ? 'padding:16px 20px' : 'padding:12px 18px';
const btnFont = isMobile ? 'font-size:16px' : 'font-size:14px';
```
Apply to all 4 class buttons in both locations.

- [ ] **Step 2: Mobile-friendly lobby layout**

In the `socket.on('lobbyUpdate', ...)` handler, where the team select cards are rendered with `display:flex;gap:12px`, check `isMobile`:
```javascript
const teamDirection = isMobile ? 'flex-direction:column' : 'flex-direction:row';
```

- [ ] **Step 3: Mobile-friendly queue screen**

In `_showQueueScreen()`, check `isMobile` and use full-width layout:
```javascript
const queuePadding = isMobile ? 'padding:16px' : '';
const cancelBtnSize = isMobile ? 'padding:14px 40px;font-size:12px' : 'padding:10px 32px;font-size:10px';
```

- [ ] **Step 4: Commit**
```bash
git add public/main.js
git commit -m "feat(mobile): touch-friendly overlays for CTF, lobby, and queue"
```

### Task 11: Canvas Touch for Spectator Play Again

**Files:**
- Modify: `public/main.js`

- [ ] **Step 1: Add touchstart listener for canvas interactions**

In `public/main.js`, after the canvas setup, add a touch listener for the "Play Again" button that's drawn on canvas during spectator mode:
```javascript
if (isMobile) {
  canvas.addEventListener('touchstart', (e) => {
    // Only handle when spectating and overlay has Play Again
    if (!spectating) return;
    const touch = e.changedTouches[0];
    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    // Check if touch is on the Play Again button area (top-right)
    if (x > canvas.width - 130 && x < canvas.width - 10 && y > 5 && y < 35) {
      location.reload();
    }
  });
}
```

- [ ] **Step 2: Final test**

Test on mobile device or Chrome DevTools:
1. Auth page fits on small screens
2. Home page shows top bar + bottom tabs, no sidebar
3. Queue screen and lobby work in portrait
4. Game enters fullscreen landscape
5. Dual joysticks work — movement + aim + auto-fire
6. Action buttons (E/G/H/R) trigger correctly
7. Sniper scope button works
8. Spectator mode: tap left/right to cycle players
9. Game over screen shows properly
10. Desktop: everything unchanged

- [ ] **Step 3: Commit**
```bash
git add public/main.js
git commit -m "feat(mobile): canvas touch for spectator interactions"
```

### Task 12: Final Commit — All Mobile Changes

- [ ] **Step 1: Push all changes**
```bash
git push
```
