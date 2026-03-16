export class InputHandler {
  constructor(canvas) {
    this.keys = { up: false, down: false, left: false, right: false };
    this.shooting = false;
    this.angle = 0;
    this.canvas = canvas;
    this._pickupPressed = false;
    this._grenadePressed = false;
    this._healPressed = false;
    this._reloadPressed = false;

    // Sniper scope
    this.sniperMode = false;
    this.scopeStartTime = null;
    this._sniperFirePending = false;
    this._sniperFireAngle = 0;

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
    canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) this._onShoot(true); });
    canvas.addEventListener('mouseup', (e) => { if (e.button === 0) this._onShoot(false); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _onKey(e, down) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': this.keys.up = down; break;
      case 'KeyS': case 'ArrowDown': this.keys.down = down; break;
      case 'KeyA': case 'ArrowLeft': this.keys.left = down; break;
      case 'KeyD': case 'ArrowRight': this.keys.right = down; break;
      case 'Space':
        e.preventDefault();
        if (this.sniperMode) {
          if (down && !this.scopeStartTime) {
            this.scopeStartTime = performance.now();
          } else if (!down && this.scopeStartTime) {
            this._sniperFirePending = true;
            this._sniperFireAngle = this.angle;
            this.scopeStartTime = null;
          }
        } else {
          this.shooting = down;
        }
        break;
      case 'KeyE': if (down) this._pickupPressed = true; break;
      case 'KeyG': if (down) this._grenadePressed = true; break;
      case 'KeyH': if (down) this._healPressed = true; break;
      case 'KeyR': if (down) this._reloadPressed = true; break;
    }
  }

  _onShoot(down) {
    if (this.sniperMode) {
      if (down && !this.scopeStartTime) {
        this.scopeStartTime = performance.now();
      } else if (!down && this.scopeStartTime) {
        this._sniperFirePending = true;
        this._sniperFireAngle = this.angle;
        this.scopeStartTime = null;
      }
    } else {
      this.shooting = down;
    }
  }

  _onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left - this.canvas.width / 2;
    const my = e.clientY - rect.top - this.canvas.height / 2;
    this.angle = Math.atan2(my, mx);
  }

  setSniperMode(isSniper) {
    if (this.sniperMode && !isSniper) {
      // Exiting sniper mode, clear scope state
      this.scopeStartTime = null;
      this._sniperFirePending = false;
    }
    this.sniperMode = isSniper;
  }

  getScopeHoldTime() {
    if (!this.sniperMode || !this.scopeStartTime) return 0;
    return performance.now() - this.scopeStartTime;
  }

  getInput() {
    return {
      up: this.keys.up,
      down: this.keys.down,
      left: this.keys.left,
      right: this.keys.right,
      shooting: this.shooting,
      angle: this.angle
    };
  }

  consumePickup() {
    if (this._pickupPressed) { this._pickupPressed = false; return true; }
    return false;
  }

  consumeGrenade() {
    if (this._grenadePressed) { this._grenadePressed = false; return true; }
    return false;
  }

  consumeHeal() {
    if (this._healPressed) { this._healPressed = false; return true; }
    return false;
  }

  consumeReload() {
    if (this._reloadPressed) { this._reloadPressed = false; return true; }
    return false;
  }

  consumeSniperFire() {
    if (this._sniperFirePending) {
      this._sniperFirePending = false;
      return { angle: this._sniperFireAngle };
    }
    return null;
  }
}
