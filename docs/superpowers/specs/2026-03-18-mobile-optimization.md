# Mobile Optimization — Design Specification

> Responsive UI, touch controls, and landscape enforcement for mobile play

## Overview

Make BattleCircle fully playable on mobile browsers. The app currently has zero mobile support — no touch events, no responsive CSS, no media queries. This spec covers responsive layouts for auth/home pages, dual joystick touch controls for gameplay, landscape enforcement during matches, and HUD adjustments.

---

## Section 1: Mobile Detection & Landscape Lock

**Detection:** Set a global `isMobile` flag via `'ontouchstart' in window || navigator.maxTouchPoints > 0`. Used throughout the app to conditionally render touch controls and apply mobile layouts.

**Viewport:** Update meta tag to `width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no` to prevent pinch-zoom.

**Landscape enforcement (gameplay only):**
- When countdown begins, request fullscreen via `document.documentElement.requestFullscreen()`
- Then call `screen.orientation.lock('landscape')` (wrapped in try/catch — not all browsers support it)
- CSS `@media (orientation: portrait)` shows a "Rotate your device" overlay that blocks the game canvas
- Auth and home pages work in both orientations — no lock applied

**Files:** `public/index.html`, `public/main.js`

---

## Section 2: Responsive Auth Page

The auth screen is already a centered vertical card (`.auth-box` at 340px fixed width). Minimal changes needed:

- Width becomes `min(340px, calc(100vw - 32px))` so it fits on small screens with 16px padding each side
- Input height bumped to 48px on mobile for proper touch targets (44px minimum)
- Font size 16px+ on inputs to prevent iOS auto-zoom on focus
- No structural changes — it's already a centered vertical stack

**Files:** `public/index.html`

---

## Section 3: Responsive Home Page

Breakpoint: `@media (max-width: 768px)`

**Sidebar (220px fixed) hides completely on mobile.**

**Top bar appears:**
- "BATTLECIRCLE" title on the left
- Player name + rating on the right
- Compact height (~48px)

**Bottom tab bar appears (fixed to bottom):**
- Three tabs: PLAY / LEADERBOARD / PROFILE
- 44px height, same styling as sidebar links but horizontal
- Active tab gets accent color + top border
- Wired to the same `_switchPage()` function as sidebar links

**Mode grid:**
- Switches from 2-column to single column
- Full-width mode buttons
- Arcade section also stacks to single column

**Stats bar:** Stays at bottom of play page content, above the tab bar.

**Leaderboard:** Table gets `overflow-x: auto` wrapper for horizontal scroll on narrow screens.

**Profile:** Stats grid changes from 4-column to 2-column. Mode breakdown also 2-column. These grids are generated in JS with inline styles, so the profile/leaderboard rendering functions in `main.js` must check `isMobile` and emit `repeat(2, 1fr)` instead of `repeat(4, 1fr)`.

**Lobby:** Team select cards and player list are also JS-generated with inline styles. Check `isMobile` in the lobby update handler and use `flex-direction: column` instead of `flex-direction: row` for team layout.

**Queue screen:** Built dynamically in `_showQueueScreen()` in `main.js`. Check `isMobile` for full-width layout and larger cancel button.

**Files:** `public/index.html`, `public/main.js`

---

## Section 4: Touch Controls (Dual Joystick)

New file: `public/TouchControls.js` — keeps all touch logic isolated.

Only rendered when `isMobile` is true. Desktop input unchanged.

### Left Joystick (Movement)
- Appears where the player first touches the left 40% of screen
- Outer ring: 120px diameter, semi-transparent border
- Inner knob: 50px diameter, follows finger within outer ring bounds
- Calculates angle + magnitude, maps to equivalent WASD input (up/down/left/right booleans + normalized speed)
- Deadzone: 10px (prevents drift from resting thumb)
- Fades to low opacity when not touched

### Right Joystick (Aim + Auto-Fire)
- Same visual mechanic on right 40% of screen
- Dragging sets the aim angle (`input.angle`)
- Auto-fires when knob is dragged beyond 25px threshold (prevents accidental shots from light taps)
- Releasing the joystick stops firing
- Aim angle persists after release (player keeps facing last aimed direction)

### Action Buttons
- Column of 4 buttons on the right edge, above the joystick zone
- E (pickup/door), G (grenade), H (heal), R (reload)
- 44px square, semi-transparent background, rounded corners
- Emit the same events as their keyboard equivalents

### Scope Button (Sniper)
- Only visible when holding a sniper
- Tap to enter scope mode, tap again (or fire) to exit
- While scoped: right joystick still controls aim, `scopeStartTime` is set on scope-enter so hold-duration damage scaling works the same as desktop
- Firing while scoped exits scope automatically (same as desktop release-to-fire)
- Positioned left of the right joystick zone

### Spectator Mode (after death)
- Left joystick hidden, right joystick hidden
- Tap left/right halves of screen to cycle between players (replaces arrow keys)
- "Play Again" button rendered in HUD uses touch hit-testing (already canvas-drawn, needs `touchstart` listener on canvas)

### CTF Class Select
- Class selection overlay during CTF countdown: buttons get 48px min height for touch targets
- Check `isMobile` in the class select JS template and use larger padding

### Technical Details
- All touch handlers use `{ passive: false }` with `preventDefault()` to block scrolling/zooming during gameplay
- Multi-touch: left and right thumbs tracked independently via `touch.identifier`
- Center 20% of screen (between joystick zones): touches ignored — prevents accidental input when thumbs drift inward
- `TouchControls` writes directly to `InputHandler` properties (`keys`, `shooting`, `angle`, and the consume flags like `_pickupPressed`, `_grenadePressed`, etc.) — the game loop reads from `InputHandler.getInput()` unchanged
- Action buttons set the corresponding `_pickupPressed` / `_grenadePressed` / `_healPressed` / `_reloadPressed` flags on `InputHandler` so the existing consume-once pattern works
- Touch controls rendered as HTML elements positioned absolutely over the canvas (not drawn on canvas)
- Keybind hints (`_drawKeybindHints` in HUD.js) hidden when `isMobile` is true

### Fullscreen Lifecycle
- Fullscreen + orientation lock requested on countdown start
- On game over: fullscreen remains active (page reload exits it naturally)
- "Play Again" reloads the page, which exits fullscreen — this is acceptable

**Files:** `public/TouchControls.js` (new), `public/InputHandler.js`, `public/main.js`

---

## Section 5: Mobile HUD Adjustments

- Health bar and ammo display: scale up text and bar thickness slightly on mobile for readability at arm's length
- Minimap: shrink to avoid overlapping joystick zones (top-left corner, smaller radius)
- Kill feed: move to top-center (away from both joystick areas)
- Game over screen: full-width layout, larger buttons (48px+ height)
- Queue screen: full-width, larger cancel button
- Lobby screen: stacks vertically on mobile — player list, team select, ready button all full-width

**Files:** `public/HUD.js`, `public/main.js`

---

## Section 6: Files Summary

| File | Changes |
|---|---|
| `public/index.html` | Viewport meta update, responsive CSS (`@media` breakpoints), bottom tab bar HTML, top bar HTML, portrait blocker overlay |
| `public/main.js` | `isMobile` detection, fullscreen + orientation lock on game start, bottom tab bar wiring, hide sidebar on mobile |
| `public/TouchControls.js` (new) | Dual joystick rendering + touch event handling, action buttons, scope button |
| `public/InputHandler.js` | Accept touch input alongside keyboard/mouse — TouchControls writes to the same input state object |
| `public/HUD.js` | Mobile size adjustments for health/ammo/minimap/kill feed positioning |
| `public/Renderer.js` | Minor — ensure touch control overlay doesn't interfere with canvas rendering |

---

## Testing

- **Desktop:** No changes to behavior. Mouse + keyboard work exactly as before.
- **Mobile (landscape):** Dual joysticks appear, movement and aim/fire work, action buttons trigger pickup/grenade/heal/reload.
- **Mobile (portrait in game):** "Rotate your device" overlay blocks gameplay.
- **Mobile (portrait on home/auth):** Pages display correctly with bottom tab bar navigation.
- **Tablet:** Same as mobile but with more screen space — controls scale appropriately.
