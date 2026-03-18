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
    this.leftTouch = null;
    this.rightTouch = null;
    this.leftOrigin = { x: 0, y: 0 };
    this.rightOrigin = { x: 0, y: 0 };
    this.leftPos = { x: 0, y: 0 };
    this.rightPos = { x: 0, y: 0 };
    this.leftActive = false;
    this.rightActive = false;

    // Config
    this.outerRadius = 60;
    this.innerRadius = 25;
    this.deadzone = 10;
    this.fireThreshold = 25;
    this.leftZone = 0.4;
    this.rightZone = 0.6;

    // Scope
    this.scopeActive = false;

    // Create overlay
    this.overlay = document.createElement('div');
    this.overlay.id = 'touchControls';
    this.overlay.style.cssText = 'position:fixed;inset:0;z-index:15;pointer-events:none;display:none';
    document.body.appendChild(this.overlay);

    // Create joystick elements
    this.leftJoystickEl = this._createJoystickElement('left');
    this.rightJoystickEl = this._createJoystickElement('right');
    this.overlay.appendChild(this.leftJoystickEl);
    this.overlay.appendChild(this.rightJoystickEl);

    // Action buttons
    this.actionBar = this._createActionButtons();
    this.overlay.appendChild(this.actionBar);

    // Scope button (hidden by default)
    this.scopeBtn = this._createScopeButton();
    this.overlay.appendChild(this.scopeBtn);

    // Touch listeners
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
        if (x < w / 2) {
          this.input._spectatorPrev = true;
        } else {
          this.input._spectatorNext = true;
        }
        continue;
      }

      const zone = x / w;

      if (zone < this.leftZone && this.leftTouch === null) {
        this.leftTouch = touch.identifier;
        this.leftOrigin = { x, y };
        this.leftPos = { x, y };
        this.leftActive = true;
        this._updateLeftJoystick();
      } else if (zone >= this.rightZone && this.rightTouch === null) {
        this.rightTouch = touch.identifier;
        this.rightOrigin = { x, y };
        this.rightPos = { x, y };
        this.rightActive = true;
        this._updateRightJoystick();
      }
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

    this.input.angle = Math.atan2(dy, dx);

    if (dist > this.fireThreshold) {
      if (this.input.sniperMode && !this.input.scopeStartTime && !this.input.scopeBlocked) {
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
    this.scopeActive = false;
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
          this.input._sniperFirePending = true;
          this.input._sniperFireAngle = this.input.angle;
          this.input.scopeStartTime = null;
          this.scopeActive = false;
        } else if (!this.input.scopeBlocked) {
          this.input.scopeStartTime = performance.now();
          this.scopeActive = true;
        }
      }
    }, { passive: false });
    return btn;
  }
}
