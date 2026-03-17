import { WEAPONS } from '/shared/weapons.js';

export class Renderer {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.map = null;
    this.allWalls = [];
    this.shadowCanvas = document.createElement('canvas');
    this.shadowCtx = this.shadowCanvas.getContext('2d');
    this.screenShake = { x: 0, y: 0, intensity: 0, startTime: 0, duration: 0 };
    this._floorPattern = null;
    this._buildingPattern = null;

    // Particle systems
    this.particles = []; // { x, y, vx, vy, life, maxLife, color, size }
    this.dustMotes = []; // ambient floating particles
    this.footsteps = []; // { x, y, time }
    this.damageNumbers = []; // { x, y, text, time, color }
    this.hitMarker = null; // { time }
    this.muzzleFlashes = []; // { x, y, time }
    this.deathAnims = []; // { x, y, time, color, radius }
  }

  setMap(map) {
    this.map = map;
    this.allWalls = [...map.walls];
    for (const b of map.buildings) {
      this.allWalls.push(...b.walls);
    }
    this._createFloorPatterns();
  }

  _createFloorPatterns() {
    // Create a subtle tiled floor pattern
    const tile = document.createElement('canvas');
    tile.width = 40;
    tile.height = 40;
    const tc = tile.getContext('2d');
    tc.fillStyle = '#1a1a2e';
    tc.fillRect(0, 0, 40, 40);
    // Subtle grid lines
    tc.strokeStyle = 'rgba(255,255,255,0.03)';
    tc.lineWidth = 1;
    tc.strokeRect(0.5, 0.5, 39, 39);
    // Random noise dots for texture
    tc.fillStyle = 'rgba(255,255,255,0.015)';
    for (let i = 0; i < 8; i++) {
      tc.fillRect(Math.random() * 38 + 1, Math.random() * 38 + 1, 1, 1);
    }
    tc.fillStyle = 'rgba(0,0,0,0.03)';
    for (let i = 0; i < 5; i++) {
      tc.fillRect(Math.random() * 38 + 1, Math.random() * 38 + 1, 2, 2);
    }
    this._floorPattern = this.ctx.createPattern(tile, 'repeat');

    // Building floor pattern — lighter with checkered hint
    const btile = document.createElement('canvas');
    btile.width = 40;
    btile.height = 40;
    const bc = btile.getContext('2d');
    bc.fillStyle = '#252540';
    bc.fillRect(0, 0, 40, 40);
    bc.fillStyle = 'rgba(255,255,255,0.02)';
    bc.fillRect(0, 0, 20, 20);
    bc.fillRect(20, 20, 20, 20);
    bc.strokeStyle = 'rgba(255,255,255,0.04)';
    bc.lineWidth = 0.5;
    bc.strokeRect(0.5, 0.5, 39, 39);
    this._buildingPattern = this.ctx.createPattern(btile, 'repeat');
  }

  triggerScreenShake(intensity, duration) {
    this.screenShake.intensity = intensity;
    this.screenShake.startTime = performance.now();
    this.screenShake.duration = duration;
  }

  _getShakeOffset() {
    const s = this.screenShake;
    if (s.intensity <= 0) return { x: 0, y: 0 };
    const elapsed = performance.now() - s.startTime;
    if (elapsed > s.duration) {
      s.intensity = 0;
      return { x: 0, y: 0 };
    }
    const decay = 1 - elapsed / s.duration;
    const mag = s.intensity * decay;
    return {
      x: (Math.random() - 0.5) * 2 * mag,
      y: (Math.random() - 0.5) * 2 * mag
    };
  }

  draw(cameraX, cameraY, visibilityPolygon, cameraScale, destroyedWalls, visionRange) {
    const { ctx, canvas, map } = this;
    if (!map) return;

    const scale = cameraScale || 1;
    this._currentScale = scale;
    this._lastVisionRange = visionRange;
    this._lastVisibility = visibilityPolygon;
    this._lastCameraX = cameraX;
    this._lastCameraY = cameraY;
    this._lastDestroyed = destroyedWalls;

    const shake = this._getShakeOffset();
    const offsetX = canvas.width / 2 - cameraX * scale + shake.x;
    const offsetY = canvas.height / 2 - cameraY * scale + shake.y;
    this._shakeOffsetX = shake.x;
    this._shakeOffsetY = shake.y;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Floor with texture pattern
    if (this._floorPattern) {
      ctx.fillStyle = this._floorPattern;
    } else {
      ctx.fillStyle = '#1a1a2e';
    }
    ctx.fillRect(0, 0, map.width, map.height);

    // Building floors with checkered pattern
    for (const b of map.buildings) {
      if (this._buildingPattern) {
        ctx.fillStyle = this._buildingPattern;
      } else {
        ctx.fillStyle = '#252540';
      }
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }

    ctx.restore();
  }

  // Call AFTER drawing all entities to overlay shadow on top
  drawShadowAndWalls() {
    const { ctx, canvas } = this;
    const visibilityPolygon = this._lastVisibility;
    const cameraX = this._lastCameraX;
    const cameraY = this._lastCameraY;
    const scale = this._currentScale || 1;
    const visionRange = this._lastVisionRange;
    const destroyedWalls = this._lastDestroyed;

    // Shadow overlay on top of entities
    if (visibilityPolygon) {
      this.drawShadow(visibilityPolygon, cameraX, cameraY, scale, visionRange);
    }

    // Walls on top of shadow with drop shadows and beveled edges
    const sx = this._shakeOffsetX || 0;
    const sy = this._shakeOffsetY || 0;
    const offsetX = canvas.width / 2 - cameraX * scale + sx;
    const offsetY = canvas.height / 2 - cameraY * scale + sy;
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    const destroyed = destroyedWalls ? new Set(destroyedWalls) : new Set();

    // Drop shadows first
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    for (let wi = 0; wi < this.allWalls.length; wi++) {
      if (destroyed.has(wi)) continue;
      const w = this.allWalls[wi];
      ctx.fillRect(w.x + 3, w.y + 3, w.w, w.h);
    }

    // Wall bodies
    for (let wi = 0; wi < this.allWalls.length; wi++) {
      if (destroyed.has(wi)) continue;
      const w = this.allWalls[wi];
      // Main body
      ctx.fillStyle = '#5a5a6a';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      // Top/left highlight
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(w.x, w.y, w.w, 2);
      ctx.fillRect(w.x, w.y, 2, w.h);
      // Bottom/right dark edge
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(w.x, w.y + w.h - 2, w.w, 2);
      ctx.fillRect(w.x + w.w - 2, w.y, 2, w.h);
    }
    if (destroyed.size > 0) {
      ctx.fillStyle = '#443322';
      for (const idx of destroyed) {
        if (idx < this.allWalls.length) {
          const w = this.allWalls[idx];
          for (let r = 0; r < 6; r++) {
            const rx = w.x + Math.random() * w.w;
            const ry = w.y + Math.random() * w.h;
            ctx.beginPath();
            ctx.arc(rx, ry, 2 + Math.random() * 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    ctx.restore();
  }

  drawShadow(visibilityPolygon, cameraX, cameraY, scale, visionRange) {
    const { ctx, canvas, shadowCanvas, shadowCtx, map } = this;
    if (!map || visibilityPolygon.length < 3) return;

    shadowCanvas.width = canvas.width;
    shadowCanvas.height = canvas.height;

    const s = scale || 1;
    const offsetX = canvas.width / 2 - cameraX * s;
    const offsetY = canvas.height / 2 - cameraY * s;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = (visionRange || 600) * s;

    // Fill with dark
    shadowCtx.fillStyle = 'rgba(0, 0, 0, 0.97)';
    shadowCtx.fillRect(0, 0, shadowCanvas.width, shadowCanvas.height);

    // Cut out: intersect visibility polygon with a circle
    // First cut the polygon
    shadowCtx.globalCompositeOperation = 'destination-out';
    shadowCtx.fillStyle = '#fff';
    shadowCtx.beginPath();
    shadowCtx.moveTo(
      visibilityPolygon[0].x * s + offsetX,
      visibilityPolygon[0].y * s + offsetY
    );
    for (let i = 1; i < visibilityPolygon.length; i++) {
      shadowCtx.lineTo(
        visibilityPolygon[i].x * s + offsetX,
        visibilityPolygon[i].y * s + offsetY
      );
    }
    shadowCtx.closePath();
    shadowCtx.fill();

    // Soft gradient edge at vision boundary instead of hard circle
    shadowCtx.globalCompositeOperation = 'source-over';
    const fadeWidth = radius * 0.15; // 15% of radius is the fade zone
    const innerRadius = radius - fadeWidth;

    // Radial gradient: transparent center -> dark edge
    const grad = shadowCtx.createRadialGradient(
      centerX, centerY, innerRadius,
      centerX, centerY, radius
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.97)');
    shadowCtx.fillStyle = grad;
    shadowCtx.beginPath();
    shadowCtx.rect(0, 0, canvas.width, canvas.height);
    shadowCtx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2, true);
    shadowCtx.fill('evenodd');

    // Full darkness beyond the radius
    shadowCtx.fillStyle = 'rgba(0,0,0,0.97)';
    shadowCtx.beginPath();
    shadowCtx.rect(0, 0, canvas.width, canvas.height);
    shadowCtx.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
    shadowCtx.fill('evenodd');

    shadowCtx.globalCompositeOperation = 'source-over';

    // Blit onto main canvas
    ctx.drawImage(shadowCanvas, 0, 0);

    // Vignette — subtle darkening at screen corners
    const vigGrad = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, canvas.width * 0.3,
      canvas.width / 2, canvas.height / 2, canvas.width * 0.7
    );
    vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vigGrad.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  drawPlayer(x, y, angle, radius, color, health, maxHealth, gunType, name) {
    const { ctx } = this;

    // Draw held weapon behind or in front of player depending on angle
    if (gunType) {
      this._drawHeldWeapon(ctx, x, y, angle, radius, gunType);
    }

    // Body circle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner highlight
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(x - 3, y - 3, radius * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // Health bar
    if (health < maxHealth) {
      const barW = radius * 2.5;
      const barH = 4;
      const barX = x - barW / 2;
      const barY = y - radius - 12;
      const pct = health / maxHealth;
      ctx.fillStyle = '#333';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = pct > 0.5 ? '#50c878' : pct > 0.25 ? '#ffc832' : '#ff4444';
      ctx.fillRect(barX, barY, barW * pct, barH);
    }

    // Name tag
    if (name) {
      ctx.fillStyle = '#fff';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const nameY = health < maxHealth ? (y - radius - 16) : (y - radius - 8);
      ctx.fillText(name, x, nameY);
    }
  }

  _drawHeldWeapon(ctx, px, py, angle, radius, gunType) {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);

    const WEAPON_COLORS = { pistol: '#888', shotgun: '#a06030', rifle: '#556' };
    const bodyColor = WEAPON_COLORS[gunType] || '#888';
    const metalColor = '#444';

    if (gunType === 'pistol') {
      // Compact pistol shape
      ctx.fillStyle = bodyColor;
      ctx.fillRect(radius - 2, -3, 16, 6);        // barrel
      ctx.fillStyle = metalColor;
      ctx.fillRect(radius + 10, -4, 6, 8);         // muzzle
      ctx.fillRect(radius, -5, 4, 3);               // sight
    } else if (gunType === 'shotgun') {
      // Wide shotgun
      ctx.fillStyle = bodyColor;
      ctx.fillRect(radius - 4, -4, 12, 8);         // stock/grip
      ctx.fillStyle = metalColor;
      ctx.fillRect(radius + 8, -3, 18, 6);         // barrel
      ctx.fillStyle = '#333';
      ctx.fillRect(radius + 22, -4, 6, 8);         // muzzle (wider)
      ctx.fillStyle = bodyColor;
      ctx.fillRect(radius + 4, -6, 8, 3);          // pump
    } else if (gunType === 'rifle') {
      // Long rifle
      ctx.fillStyle = bodyColor;
      ctx.fillRect(radius - 6, -3, 10, 6);         // stock
      ctx.fillStyle = metalColor;
      ctx.fillRect(radius + 4, -3, 24, 5);         // barrel
      ctx.fillStyle = '#333';
      ctx.fillRect(radius + 24, -4, 6, 7);         // muzzle
      ctx.fillStyle = '#668';
      ctx.fillRect(radius + 8, -7, 10, 4);         // scope
    } else if (gunType === 'smg') {
      ctx.fillStyle = '#888';
      ctx.fillRect(radius - 2, -3, 14, 6);
      ctx.fillStyle = metalColor;
      ctx.fillRect(radius + 10, -4, 6, 8);
      ctx.fillStyle = '#e8e82e';
      ctx.fillRect(radius + 2, 3, 5, 8);
    } else if (gunType === 'sniper') {
      ctx.fillStyle = '#6b4226';
      ctx.fillRect(radius - 8, -3, 12, 6);
      ctx.fillStyle = metalColor;
      ctx.fillRect(radius + 4, -2, 30, 4);
      ctx.fillStyle = '#333';
      ctx.fillRect(radius + 30, -3, 6, 6);
      ctx.fillStyle = '#8b4513';
      ctx.fillRect(radius + 8, -8, 12, 5);
      ctx.fillStyle = '#a0522d';
      ctx.fillRect(radius + 10, -7, 8, 2);
    }

    ctx.restore();
  }

  drawBullets(bullets, cameraX, cameraY) {
    const { ctx, canvas } = this;
    ctx.save();
    const _s = this._currentScale || 1;
    ctx.translate(canvas.width / 2 - cameraX * _s + (this._shakeOffsetX||0), canvas.height / 2 - cameraY * _s + (this._shakeOffsetY||0));
    ctx.scale(_s, _s);
    for (const b of bullets) {
      if (b.type === 'shrapnel') {
        // Irregular angular shrapnel piece
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle + b.x * 0.1); // unique rotation per piece
        ctx.fillStyle = '#cc8844';
        ctx.beginPath();
        // Irregular polygon (3-4 points, jagged)
        const seed = (b.id ? b.id.charCodeAt(1) || 0 : 0) % 4;
        if (seed === 0) {
          ctx.moveTo(-3, -1);
          ctx.lineTo(1, -3);
          ctx.lineTo(3, 1);
          ctx.lineTo(-1, 2);
        } else if (seed === 1) {
          ctx.moveTo(-2, -2);
          ctx.lineTo(3, -1);
          ctx.lineTo(1, 3);
          ctx.lineTo(-2, 1);
        } else if (seed === 2) {
          ctx.moveTo(0, -3);
          ctx.lineTo(3, 0);
          ctx.lineTo(0, 2);
          ctx.lineTo(-2, -1);
        } else {
          ctx.moveTo(-1, -3);
          ctx.lineTo(2, -2);
          ctx.lineTo(3, 1);
          ctx.lineTo(-2, 2);
        }
        ctx.closePath();
        ctx.fill();
        // Hot orange edge
        ctx.strokeStyle = '#ff8833';
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawGroundItems(items, cameraX, cameraY, timestamp) {
    const { ctx, canvas } = this;
    ctx.save();
    const _s = this._currentScale || 1;
    ctx.translate(canvas.width / 2 - cameraX * _s + (this._shakeOffsetX||0), canvas.height / 2 - cameraY * _s + (this._shakeOffsetY||0));
    ctx.scale(_s, _s);

    const EQUIP_COLORS = {
      pistol: '#aaa',
      shotgun: '#ff8c42',
      rifle: '#4a9eff',
      frag: '#ff6347',
      smoke: '#aaa',
      bandage: '#50c878',
      medkit: '#ff4444'
    };

    const glow = 0.3 + 0.15 * Math.sin(timestamp / 400);

    for (const item of items) {
      if (item.slot === 'ammo') {
        this._drawAmmoItem(ctx, item, timestamp);
      } else if (item.slot === 'gun') {
        this._drawGroundGun(ctx, item, timestamp);
      } else {
        // Grenades and bandages - colored circle with icon
        const color = EQUIP_COLORS[item.type] || '#fff';
        ctx.fillStyle = color;
        ctx.globalAlpha = glow;
        ctx.beginPath();
        ctx.arc(item.x, item.y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        if (item.type === 'frag') {
          // Grenade shape
          ctx.fillStyle = '#ff6347';
          ctx.beginPath();
          ctx.arc(item.x, item.y + 1, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#c42';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          // Pin
          ctx.strokeStyle = '#ddd';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(item.x, item.y - 7);
          ctx.lineTo(item.x, item.y - 12);
          ctx.lineTo(item.x + 4, item.y - 12);
          ctx.stroke();
        } else if (item.type === 'smoke') {
          ctx.fillStyle = '#aaa';
          ctx.globalAlpha = 0.7;
          ctx.beginPath();
          ctx.arc(item.x - 3, item.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(item.x + 3, item.y - 2, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(item.x, item.y + 3, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else if (item.type === 'bandage') {
          ctx.fillStyle = '#50c878';
          ctx.beginPath();
          ctx.arc(item.x, item.y, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.fillRect(item.x - 5, item.y - 1.5, 10, 3);
          ctx.fillRect(item.x - 1.5, item.y - 5, 3, 10);
        } else if (item.type === 'medkit') {
          ctx.fillStyle = '#fff';
          ctx.fillRect(item.x - 8, item.y - 8, 16, 16);
          ctx.fillStyle = '#ff4444';
          ctx.fillRect(item.x - 5, item.y - 1.5, 10, 3);
          ctx.fillRect(item.x - 1.5, item.y - 5, 3, 10);
        }
      }
    }

    ctx.restore();
  }

  _drawGroundGun(ctx, item, timestamp) {
    const glow = 0.25 + 0.15 * Math.sin(timestamp / 400);
    const COLORS = { pistol: '#aaa', shotgun: '#ff8c42', rifle: '#4a9eff', smg: '#e8e82e', sniper: '#8b4513' };
    const color = COLORS[item.type] || '#aaa';

    // Glow circle
    ctx.fillStyle = color;
    ctx.globalAlpha = glow;
    ctx.beginPath();
    ctx.arc(item.x, item.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Dark backing plate
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.arc(item.x, item.y, 13, 0, Math.PI * 2);
    ctx.fill();

    if (item.type === 'pistol') {
      // Compact pistol
      ctx.fillStyle = '#777';
      ctx.fillRect(item.x - 3, item.y - 2, 10, 4);       // body
      ctx.fillStyle = '#555';
      ctx.fillRect(item.x + 5, item.y - 3, 5, 6);         // muzzle
      ctx.fillStyle = '#666';
      ctx.fillRect(item.x - 1, item.y + 1, 4, 6);         // grip
    } else if (item.type === 'shotgun') {
      // Wide shotgun
      ctx.fillStyle = '#a06030';
      ctx.fillRect(item.x - 8, item.y - 2, 8, 5);         // stock
      ctx.fillStyle = '#555';
      ctx.fillRect(item.x, item.y - 2, 12, 4);            // barrel
      ctx.fillStyle = '#444';
      ctx.fillRect(item.x + 10, item.y - 3, 4, 6);        // muzzle
      ctx.fillStyle = '#906828';
      ctx.fillRect(item.x - 2, item.y - 5, 6, 3);         // pump
    } else if (item.type === 'rifle') {
      // Long rifle with scope
      ctx.fillStyle = '#556';
      ctx.fillRect(item.x - 10, item.y - 2, 8, 4);        // stock
      ctx.fillStyle = '#444';
      ctx.fillRect(item.x - 2, item.y - 2, 16, 4);        // barrel
      ctx.fillStyle = '#333';
      ctx.fillRect(item.x + 12, item.y - 3, 4, 6);        // muzzle
      ctx.fillStyle = '#668';
      ctx.fillRect(item.x + 1, item.y - 6, 8, 3);         // scope
      ctx.fillStyle = '#779';
      ctx.fillRect(item.x + 3, item.y - 5, 4, 1);         // scope lens
    } else if (item.type === 'smg') {
      ctx.fillStyle = '#888';
      ctx.fillRect(item.x - 6, item.y - 2, 14, 5);
      ctx.fillStyle = '#555';
      ctx.fillRect(item.x + 6, item.y - 3, 4, 6);
      ctx.fillStyle = '#e8e82e';
      ctx.fillRect(item.x - 1, item.y + 2, 4, 7);
    } else if (item.type === 'sniper') {
      ctx.fillStyle = '#6b4226';
      ctx.fillRect(item.x - 10, item.y - 2, 6, 4);
      ctx.fillStyle = '#444';
      ctx.fillRect(item.x - 4, item.y - 2, 18, 3);
      ctx.fillStyle = '#333';
      ctx.fillRect(item.x + 12, item.y - 3, 4, 5);
      ctx.fillStyle = '#8b4513';
      ctx.fillRect(item.x, item.y - 6, 8, 3);
    }

    // Border ring
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(item.x, item.y, 13, 0, Math.PI * 2);
    ctx.stroke();
  }

  _drawAmmoItem(ctx, item, timestamp) {
    const AMMO_COLORS = { light: '#e8d44d', shells: '#ff8c42', heavy: '#5a7fa8' };
    const color = AMMO_COLORS[item.ammoType] || '#fff';
    const glow = 0.2 + 0.1 * Math.sin(timestamp / 400);

    // Glow
    ctx.fillStyle = color;
    ctx.globalAlpha = glow;
    ctx.beginPath();
    ctx.arc(item.x, item.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (item.ammoType === 'light') {
      // Small bullet cartridges — 3 little bullets in a row
      for (let i = -1; i <= 1; i++) {
        const bx = item.x + i * 5;
        // Casing (brass)
        ctx.fillStyle = '#d4a843';
        ctx.fillRect(bx - 1.5, item.y - 2, 3, 7);
        // Tip (copper)
        ctx.fillStyle = '#c87533';
        ctx.beginPath();
        ctx.moveTo(bx - 1.5, item.y - 2);
        ctx.lineTo(bx, item.y - 5);
        ctx.lineTo(bx + 1.5, item.y - 2);
        ctx.closePath();
        ctx.fill();
        // Primer (bottom circle)
        ctx.fillStyle = '#b8942e';
        ctx.beginPath();
        ctx.arc(bx, item.y + 5, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (item.ammoType === 'shells') {
      // Shotgun shells — 2 fat cylinders side by side
      for (let i = -1; i <= 0; i++) {
        const sx = item.x + i * 7 + 3;
        // Shell body (red/orange)
        ctx.fillStyle = '#cc4422';
        ctx.fillRect(sx - 3, item.y - 5, 6, 8);
        // Brass base
        ctx.fillStyle = '#d4a843';
        ctx.fillRect(sx - 3, item.y + 3, 6, 3);
        // Top crimp
        ctx.fillStyle = '#aa3318';
        ctx.beginPath();
        ctx.arc(sx, item.y - 5, 3, Math.PI, 0);
        ctx.fill();
      }
    } else if (item.ammoType === 'heavy') {
      // Large rifle/sniper cartridge — 2 bigger bullets
      for (let i = -1; i <= 0; i++) {
        const bx = item.x + i * 7 + 3;
        // Casing (brass, longer)
        ctx.fillStyle = '#8a9bb0';
        ctx.fillRect(bx - 2, item.y - 1, 4, 8);
        // Tip (pointed, steel-colored)
        ctx.fillStyle = '#6a7d8e';
        ctx.beginPath();
        ctx.moveTo(bx - 2, item.y - 1);
        ctx.lineTo(bx, item.y - 7);
        ctx.lineTo(bx + 2, item.y - 1);
        ctx.closePath();
        ctx.fill();
        // Primer
        ctx.fillStyle = '#b8942e';
        ctx.beginPath();
        ctx.arc(bx, item.y + 7, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawGrenades(grenades, cameraX, cameraY, timestamp) {
    const { ctx, canvas } = this;
    ctx.save();
    const _s = this._currentScale || 1;
    ctx.translate(canvas.width / 2 - cameraX * _s + (this._shakeOffsetX||0), canvas.height / 2 - cameraY * _s + (this._shakeOffsetY||0));
    ctx.scale(_s, _s);
    for (const g of grenades) {
      ctx.fillStyle = '#ff8c42';
      ctx.beginPath();
      ctx.arc(g.x, g.y, 6, 0, Math.PI * 2);
      ctx.fill();
      const timeLeft = g.explodeAt - Date.now();
      const flashRate = Math.max(100, timeLeft / 3);
      if (Math.sin(timestamp / flashRate * Math.PI) > 0) {
        ctx.fillStyle = '#ff0';
        ctx.beginPath();
        ctx.arc(g.x, g.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawZone(zone, cameraX, cameraY, timestamp) {
    if (!zone || !zone.active) return;
    const { ctx, canvas, map } = this;
    const _s = this._currentScale || 1;
    const offsetX = canvas.width / 2 - cameraX * _s + (this._shakeOffsetX||0);
    const offsetY = canvas.height / 2 - cameraY * _s;

    ctx.save();
    ctx.fillStyle = 'rgba(200, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.rect(offsetX, offsetY, map.width * _s, map.height * _s);
    ctx.arc(zone.centerX * _s + offsetX, zone.centerY * _s + offsetY, zone.currentRadius * _s, 0, Math.PI * 2, true);
    ctx.fill('evenodd');

    const pulse = 0.6 + 0.4 * Math.sin(timestamp / 300);
    ctx.strokeStyle = `rgba(255, 50, 50, ${pulse})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(zone.centerX * _s + offsetX, zone.centerY * _s + offsetY, zone.currentRadius * _s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawExplosions(explosions, cameraX, cameraY, now) {
    const { ctx, canvas } = this;
    ctx.save();
    const _s = this._currentScale || 1;
    ctx.translate(canvas.width / 2 - cameraX * _s + (this._shakeOffsetX||0), canvas.height / 2 - cameraY * _s + (this._shakeOffsetY||0));
    ctx.scale(_s, _s);
    for (const exp of explosions) {
      const elapsed = now - exp.startTime;
      if (elapsed > exp.duration) continue;
      const t = elapsed / exp.duration;
      const radius = 80 * t;
      const alpha = 1 - t;
      ctx.strokeStyle = `rgba(255, 150, 50, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(exp.x, exp.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawHitFlash(canvasW, canvasH, hitFlash, now) {
    if (!hitFlash) return;
    const elapsed = now - hitFlash.startTime;
    if (elapsed > hitFlash.duration) return;
    const alpha = 0.4 * (1 - elapsed / hitFlash.duration);
    this.ctx.fillStyle = `rgba(255, 0, 0, ${alpha})`;
    this.ctx.fillRect(0, 0, canvasW, canvasH);
  }

  drawSmokeClouds(smokes, cameraX, cameraY, timestamp) {
    const { ctx, canvas } = this;
    ctx.save();
    const _s = this._currentScale || 1;
    ctx.translate(canvas.width / 2 - cameraX * _s + (this._shakeOffsetX||0), canvas.height / 2 - cameraY * _s + (this._shakeOffsetY||0));
    ctx.scale(_s, _s);

    for (const smoke of smokes) {
      const elapsed = Date.now() - smoke.activatedAt;
      if (elapsed > smoke.duration) continue;

      let opacity = 0.6;
      const fadeStart = smoke.duration - 2000;
      if (elapsed > fadeStart) {
        opacity = 0.6 * (1 - (elapsed - fadeStart) / 1000);
      }

      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 * i) / 8;
        const wobble = Math.sin(timestamp / 800 + i * 1.2) * 15;
        const cx = smoke.x + Math.cos(angle + timestamp / 3000) * (30 + wobble);
        const cy = smoke.y + Math.sin(angle + timestamp / 3000) * (30 + wobble);
        const r = 60 + Math.sin(timestamp / 600 + i) * 10;
        const shade = 170 + Math.sin(i * 0.8) * 20;

        ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${opacity * 0.4})`;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = `rgba(180, 180, 180, ${opacity * 0.3})`;
      ctx.beginPath();
      ctx.arc(smoke.x, smoke.y, 100, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawTracers(bullets, tracerTrails, cameraX, cameraY, now) {
    const { ctx, canvas } = this;
    ctx.save();
    const _s = this._currentScale || 1;
    ctx.translate(canvas.width / 2 - cameraX * _s + (this._shakeOffsetX||0), canvas.height / 2 - cameraY * _s + (this._shakeOffsetY||0));
    ctx.scale(_s, _s);

    for (const b of bullets) {
      if (b.type === 'sniper' && b.originX != null) {
        ctx.strokeStyle = 'rgba(255, 200, 100, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.originX, b.originY);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    for (const t of tracerTrails) {
      const elapsed = now - t.startTime;
      if (elapsed > 500) continue;
      const alpha = 0.5 * (1 - elapsed / 500);
      ctx.strokeStyle = `rgba(255, 200, 100, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(t.originX, t.originY);
      ctx.lineTo(t.endX, t.endY);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawDoors(doors, cameraX, cameraY, timestamp) {
    const { ctx, canvas } = this;
    ctx.save();
    const _s = this._currentScale || 1;
    ctx.translate(canvas.width / 2 - cameraX * _s + (this._shakeOffsetX||0), canvas.height / 2 - cameraY * _s + (this._shakeOffsetY||0));
    ctx.scale(_s, _s);

    for (const door of doors) {
      if (door.open) {
        // Open doors — draw thin recessed panels on each side
        this._drawOpenDoor(ctx, door);
      } else {
        // Closed doors — draw with caution tape
        this._drawClosedDoor(ctx, door);
      }
    }

    ctx.restore();
  }

  _drawClosedDoor(ctx, door) {
    const { x, y, w, h } = door;
    const isHorizontal = w > h;

    // Door panels
    ctx.fillStyle = '#665533';
    ctx.fillRect(x, y, w, h);

    // Caution tape diagonal stripes
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    const stripeW = 8;
    ctx.fillStyle = '#e8c020';
    if (isHorizontal) {
      for (let sx = x - h; sx < x + w + h; sx += stripeW * 2) {
        ctx.beginPath();
        ctx.moveTo(sx, y);
        ctx.lineTo(sx + h, y + h);
        ctx.lineTo(sx + h + stripeW, y + h);
        ctx.lineTo(sx + stripeW, y);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      for (let sy = y - w; sy < y + h + w; sy += stripeW * 2) {
        ctx.beginPath();
        ctx.moveTo(x, sy);
        ctx.lineTo(x + w, sy + w);
        ctx.lineTo(x + w, sy + w + stripeW);
        ctx.lineTo(x, sy + stripeW);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.restore();

    // Border
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    // Center split line (double doors)
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (isHorizontal) {
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w / 2, y + h);
    } else {
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w, y + h / 2);
    }
    ctx.stroke();
  }

  _drawOpenDoor(ctx, door) {
    const { x, y, w, h, side } = door;
    const isHorizontal = w > h;
    const panelSize = 8;

    ctx.fillStyle = '#554422';
    ctx.globalAlpha = 0.5;

    if (isHorizontal) {
      // Two thin panels slid to sides
      ctx.fillRect(x, y, panelSize, h);
      ctx.fillRect(x + w - panelSize, y, panelSize, h);
    } else {
      ctx.fillRect(x, y, w, panelSize);
      ctx.fillRect(x, y + h - panelSize, w, panelSize);
    }

    ctx.globalAlpha = 1;
  }

  drawCTFTerritories(cameraX, cameraY, mapWidth, mapHeight) {
    const { ctx, canvas } = this;
    const _s = this._currentScale || 1;
    const offsetX = canvas.width / 2 - cameraX * _s + (this._shakeOffsetX||0);
    const offsetY = canvas.height / 2 - cameraY * _s;

    ctx.save();
    // Blue side (left half)
    ctx.fillStyle = 'rgba(40,60,120,0.12)';
    ctx.fillRect(offsetX, offsetY, (mapWidth / 2) * _s, mapHeight * _s);
    // Red side (right half)
    ctx.fillStyle = 'rgba(120,40,40,0.12)';
    ctx.fillRect(offsetX + (mapWidth / 2) * _s, offsetY, (mapWidth / 2) * _s, mapHeight * _s);
    // Midline
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.setLineDash([10 * _s, 10 * _s]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(offsetX + (mapWidth / 2) * _s, offsetY);
    ctx.lineTo(offsetX + (mapWidth / 2) * _s, offsetY + mapHeight * _s);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawFlagZones(flags, cameraX, cameraY, timestamp) {
    if (!flags) return;
    const { ctx, canvas } = this;
    ctx.save();
    const _s = this._currentScale || 1;
    ctx.translate(canvas.width / 2 - cameraX * _s + (this._shakeOffsetX||0), canvas.height / 2 - cameraY * _s + (this._shakeOffsetY||0));
    ctx.scale(_s, _s);

    for (const flag of flags) {
      const zone = flag.zone;
      if (!zone) continue;
      const color = flag.team === 'blue' ? '#4a9eff' : '#ff6b6b';

      // Zone border
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(zone.x, zone.y, zone.w, zone.h);
      ctx.setLineDash([]);

      // Zone fill
      ctx.fillStyle = flag.team === 'blue' ? 'rgba(74,158,255,0.06)' : 'rgba(255,107,107,0.06)';
      ctx.fillRect(zone.x, zone.y, zone.w, zone.h);

      // Flag icon (if home or held in this zone)
      if (flag.state === 'home' || (flag.state === 'held' && flag.holdingTeam !== null)) {
        const fx = flag.state === 'home' ? flag.zoneX : flag.zoneX;
        const fy = flag.state === 'home' ? flag.zoneY : flag.zoneY;
        // Draw at the correct zone
        const drawX = flag.state === 'held'
          ? flags.find(f => f.team !== flag.team)?.zoneX || flag.zoneX
          : flag.zoneX;
        const drawY = flag.state === 'held'
          ? flags.find(f => f.team !== flag.team)?.zoneY || flag.zoneY
          : flag.zoneY;

        // Flag pennant
        ctx.fillStyle = color;
        ctx.fillRect(drawX - 1, drawY - 20, 3, 25); // pole
        ctx.beginPath();
        ctx.moveTo(drawX + 2, drawY - 20);
        ctx.lineTo(drawX + 18, drawY - 14);
        ctx.lineTo(drawX + 2, drawY - 8);
        ctx.closePath();
        ctx.fill();

        // Pulsing glow if held
        if (flag.state === 'held') {
          const pulse = 0.3 + 0.2 * Math.sin(timestamp / 300);
          ctx.fillStyle = `rgba(255, 215, 0, ${pulse})`;
          ctx.beginPath();
          ctx.arc(drawX, drawY - 10, 25, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.restore();
  }

  drawCarrierGlow(x, y, radius, timestamp) {
    const { ctx } = this;
    const alpha = 0.4 + 0.4 * Math.sin(timestamp / 200);
    ctx.strokeStyle = `rgba(255, 215, 0, ${alpha})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawCarrierArrow(ctx, canvasW, canvasH, carrierX, carrierY, viewX, viewY, teamColor) {
    const dx = carrierX - viewX;
    const dy = carrierY - viewY;
    const angle = Math.atan2(dy, dx);

    // Check if carrier is off-screen
    const _s = this._currentScale || 1;
    const screenX = canvasW / 2 + dx * _s;
    const screenY = canvasH / 2 + dy * _s;
    if (screenX > 20 && screenX < canvasW - 20 && screenY > 20 && screenY < canvasH - 20) return;

    // Arrow at screen edge
    const margin = 40;
    const arrowX = Math.max(margin, Math.min(canvasW - margin, screenX));
    const arrowY = Math.max(margin, Math.min(canvasH - margin, screenY));

    ctx.save();
    ctx.translate(arrowX, arrowY);
    ctx.rotate(angle);
    ctx.fillStyle = teamColor;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-6, -7);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // === PARTICLE & EFFECTS SYSTEM ===

  spawnBulletSparks(x, y) {
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 50 + Math.random() * 100;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.2 + Math.random() * 0.15,
        maxLife: 0.3,
        color: `hsl(${40 + Math.random() * 20}, 100%, ${60 + Math.random() * 30}%)`,
        size: 1 + Math.random() * 2
      });
    }
  }

  spawnDamageParticles(x, y) {
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 80;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.3 + Math.random() * 0.3,
        maxLife: 0.5,
        color: '#ff3333',
        size: 1.5 + Math.random() * 2
      });
    }
  }

  spawnMuzzleFlash(x, y) {
    this.muzzleFlashes.push({ x, y, time: performance.now() });
  }

  addDamageNumber(x, y, damage) {
    this.damageNumbers.push({
      x: x + (Math.random() - 0.5) * 20,
      y: y - 20,
      text: `-${Math.round(damage)}`,
      time: performance.now(),
      color: '#ff4444'
    });
  }

  showHitMarker() {
    this.hitMarker = { time: performance.now() };
  }

  addDeathAnim(x, y, color, radius) {
    this.deathAnims.push({ x, y, time: performance.now(), color, radius });
  }

  addFootstep(x, y) {
    // Only add if far enough from last footstep
    const last = this.footsteps[this.footsteps.length - 1];
    if (last) {
      const dx = x - last.x, dy = y - last.y;
      if (dx * dx + dy * dy < 400) return; // ~20px apart
    }
    this.footsteps.push({ x, y, time: performance.now() });
    if (this.footsteps.length > 60) this.footsteps.shift();
  }

  updateAndDrawParticles(cameraX, cameraY, dt, timestamp) {
    const { ctx, canvas } = this;
    const _s = this._currentScale || 1;

    ctx.save();
    ctx.translate(canvas.width / 2 - cameraX * _s + (this._shakeOffsetX||0), canvas.height / 2 - cameraY * _s + (this._shakeOffsetY||0));
    ctx.scale(_s, _s);

    // Update and draw particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Footstep trails
    const now = performance.now();
    for (let i = this.footsteps.length - 1; i >= 0; i--) {
      const f = this.footsteps[i];
      const age = (now - f.time) / 1000;
      if (age > 3) { this.footsteps.splice(i, 1); continue; }
      const alpha = 0.15 * (1 - age / 3);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#888';
      ctx.beginPath();
      ctx.arc(f.x, f.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Muzzle flashes
    for (let i = this.muzzleFlashes.length - 1; i >= 0; i--) {
      const mf = this.muzzleFlashes[i];
      const age = now - mf.time;
      if (age > 80) { this.muzzleFlashes.splice(i, 1); continue; }
      const alpha = 1 - age / 80;
      ctx.globalAlpha = alpha * 0.8;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(mf.x, mf.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffa';
      ctx.beginPath();
      ctx.arc(mf.x, mf.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Death animations
    for (let i = this.deathAnims.length - 1; i >= 0; i--) {
      const d = this.deathAnims[i];
      const age = (now - d.time) / 1000;
      if (age > 0.5) { this.deathAnims.splice(i, 1); continue; }
      const t = age / 0.5;
      const r = d.radius * (1 - t * 0.7);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
      ctx.fill();
      // Expanding ring
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = (1 - t) * 0.5;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.radius + d.radius * t, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    // Damage numbers (screen-space)
    ctx.save();
    ctx.translate(canvas.width / 2 - cameraX * _s + (this._shakeOffsetX||0), canvas.height / 2 - cameraY * _s + (this._shakeOffsetY||0));
    ctx.scale(_s, _s);
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const dn = this.damageNumbers[i];
      const age = (now - dn.time) / 1000;
      if (age > 1) { this.damageNumbers.splice(i, 1); continue; }
      const alpha = 1 - age;
      const floatY = dn.y - age * 40;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = dn.color;
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dn.text, dn.x, floatY);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Hit marker (screen center X)
    if (this.hitMarker) {
      const age = now - this.hitMarker.time;
      if (age > 200) { this.hitMarker = null; }
      else {
        const alpha = 1 - age / 200;
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        const s = 8;
        ctx.beginPath();
        ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx - s/3, cy - s/3);
        ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx + s/3, cy - s/3);
        ctx.moveTo(cx - s, cy + s); ctx.lineTo(cx - s/3, cy + s/3);
        ctx.moveTo(cx + s, cy + s); ctx.lineTo(cx + s/3, cy + s/3);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Ambient dust motes
    this._updateDustMotes(cameraX, cameraY, dt, timestamp);
  }

  _updateDustMotes(cameraX, cameraY, dt, timestamp) {
    const { ctx, canvas } = this;
    const _s = this._currentScale || 1;

    // Spawn new motes if needed
    while (this.dustMotes.length < 20) {
      this.dustMotes.push({
        x: cameraX + (Math.random() - 0.5) * canvas.width / _s,
        y: cameraY + (Math.random() - 0.5) * canvas.height / _s,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 8 - 3,
        size: 0.5 + Math.random() * 1.5,
        phase: Math.random() * Math.PI * 2
      });
    }

    ctx.save();
    ctx.translate(canvas.width / 2 - cameraX * _s + (this._shakeOffsetX||0), canvas.height / 2 - cameraY * _s + (this._shakeOffsetY||0));
    ctx.scale(_s, _s);

    for (let i = this.dustMotes.length - 1; i >= 0; i--) {
      const m = this.dustMotes[i];
      m.x += m.vx * dt + Math.sin(timestamp / 2000 + m.phase) * 0.3;
      m.y += m.vy * dt;

      // Remove if too far from camera
      if (Math.abs(m.x - cameraX) > canvas.width / _s ||
          Math.abs(m.y - cameraY) > canvas.height / _s) {
        this.dustMotes.splice(i, 1);
        continue;
      }

      const alpha = 0.15 + 0.1 * Math.sin(timestamp / 1000 + m.phase);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#aaa';
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawWeaponRange(ctx, x, y, angle, weapon, cameraScale) {
    if (!weapon || weapon.name === 'Sniper') return;
    const _s = cameraScale || 1;
    const range = weapon.range;
    const color = weapon.color;

    ctx.save();
    ctx.globalAlpha = 0.12;

    if (weapon.pellets > 1) {
      // Shotgun: wide cone outline
      const spread = weapon.spread;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      // Left edge of cone
      ctx.moveTo(x, y);
      ctx.lineTo(
        x + Math.cos(angle - spread) * range,
        y + Math.sin(angle - spread) * range
      );
      // Arc at the end
      ctx.arc(x, y, range, angle - spread, angle + spread);
      // Right edge back
      ctx.lineTo(x, y);
      ctx.stroke();

      // Subtle fill
      ctx.globalAlpha = 0.03;
      ctx.fillStyle = color;
      ctx.fill();

    } else if (weapon.spread > 0) {
      // SMG: narrow cone showing spread
      const spread = weapon.spread;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(
        x + Math.cos(angle - spread) * range,
        y + Math.sin(angle - spread) * range
      );
      ctx.arc(x, y, range, angle - spread, angle + spread);
      ctx.lineTo(x, y);
      ctx.stroke();

      // Center line (most likely path)
      ctx.globalAlpha = 0.08;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * 30, y + Math.sin(angle) * 30);
      ctx.lineTo(x + Math.cos(angle) * range, y + Math.sin(angle) * range);
      ctx.stroke();
      ctx.setLineDash([]);

      // Subtle cone fill
      ctx.globalAlpha = 0.02;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle - spread) * range, y + Math.sin(angle - spread) * range);
      ctx.arc(x, y, range, angle - spread, angle + spread);
      ctx.closePath();
      ctx.fill();

    } else if (weapon.name === 'Rifle') {
      // Rifle: thick outlined line
      const width = 6;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(
        x + Math.cos(angle) * 30,
        y + Math.sin(angle) * 30
      );
      ctx.lineTo(
        x + Math.cos(angle) * range,
        y + Math.sin(angle) * range
      );
      ctx.stroke();

      // Range end marker
      ctx.globalAlpha = 0.15;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      const endX = x + Math.cos(angle) * range;
      const endY = y + Math.sin(angle) * range;
      const perpAngle = angle + Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(endX + Math.cos(perpAngle) * 8, endY + Math.sin(perpAngle) * 8);
      ctx.lineTo(endX - Math.cos(perpAngle) * 8, endY - Math.sin(perpAngle) * 8);
      ctx.stroke();

    } else {
      // Pistol: thin outlined line
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(
        x + Math.cos(angle) * 30,
        y + Math.sin(angle) * 30
      );
      ctx.lineTo(
        x + Math.cos(angle) * range,
        y + Math.sin(angle) * range
      );
      ctx.stroke();
      ctx.setLineDash([]);

      // Range end dot
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(
        x + Math.cos(angle) * range,
        y + Math.sin(angle) * range,
        3, 0, Math.PI * 2
      );
      ctx.fill();
    }

    ctx.restore();
  }

  drawPlayerStatusEffects(ctx, players, timestamp) {
    // Draw healing plus symbols and reload bullet icons above players
    for (const p of players) {
      if (!p.alive) continue;

      if (p.healing) {
        // Floating plus symbols
        for (let i = 0; i < 3; i++) {
          const phase = timestamp / 600 + i * 2.1;
          const floatY = -30 - (phase % 1) * 25;
          const alpha = 1 - (phase % 1);
          const offsetX = Math.sin(phase * 3 + i) * 10;
          ctx.globalAlpha = alpha * 0.7;
          ctx.fillStyle = '#50c878';
          ctx.font = 'bold 14px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('+', p.x + offsetX, p.y + floatY);
        }
        ctx.globalAlpha = 1;
      }

      if (p.reloading) {
        // Small bullet icons circling
        for (let i = 0; i < 4; i++) {
          const angle = timestamp / 400 + (i * Math.PI / 2);
          const rx = p.x + Math.cos(angle) * 26;
          const ry = p.y + Math.sin(angle) * 26;
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = '#d4a843';
          ctx.fillRect(rx - 1, ry - 3, 2, 5);
          ctx.fillStyle = '#c87533';
          ctx.beginPath();
          ctx.moveTo(rx - 1, ry - 3);
          ctx.lineTo(rx, ry - 5);
          ctx.lineTo(rx + 1, ry - 3);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  drawActionProgressBar(ctx, canvasW, canvasH, me, gameState) {
    // Show progress bar for healing or reloading
    if (!me || (!me.healing && !me.reloading)) return;

    const barW = 120;
    const barH = 6;
    const cx = canvasW / 2;
    const cy = canvasH / 2 + 35;

    // Estimate progress from game state timing
    // We don't have exact start time, so use a pulse animation as fallback
    let label, color, progress;

    if (me.healing) {
      const healItem = me.heal;
      const duration = healItem && healItem.type === 'medkit' ? 4000 : 1500;
      // Animate progress bar
      if (!this._healStart || !this._wasHealing) this._healStart = performance.now();
      this._wasHealing = true;
      progress = Math.min(1, (performance.now() - this._healStart) / duration);
      label = 'HEALING';
      color = '#50c878';
    } else {
      this._wasHealing = false;
      this._healStart = null;
    }

    if (me.reloading) {
      const gun = me.gun;
      if (gun) {
        const weapon = WEAPONS[gun.type];
        const duration = weapon ? weapon.reloadTime : 1500;
        if (!this._reloadStart || !this._wasReloading) this._reloadStart = performance.now();
        this._wasReloading = true;
        progress = Math.min(1, (performance.now() - this._reloadStart) / duration);
        label = 'RELOADING';
        color = '#ffc832';
      }
    } else {
      this._wasReloading = false;
      this._reloadStart = null;
    }

    if (progress === undefined) return;

    // Background bar
    ctx.fillStyle = 'rgba(12, 16, 28, 0.7)';
    ctx.fillRect(cx - barW / 2 - 4, cy - 12, barW + 8, barH + 18);
    ctx.fillStyle = color;
    ctx.fillRect(cx - barW / 2 - 4, cy - 12, 2, barH + 18);

    // Label
    ctx.font = "700 9px 'Orbitron', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.fillText(label, cx, cy - 2);

    // Bar track
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(cx - barW / 2, cy + 2, barW, barH);

    // Bar fill
    ctx.fillStyle = color;
    ctx.fillRect(cx - barW / 2, cy + 2, barW * progress, barH);

    // Glow at fill end
    if (progress > 0 && progress < 1) {
      ctx.globalAlpha = 0.4;
      ctx.fillRect(cx - barW / 2 + barW * progress - 2, cy, 4, barH + 4);
      ctx.globalAlpha = 1;
    }
  }

  drawSniperLines(lines, cameraX, cameraY, now) {
    const { ctx, canvas } = this;
    const _s = this._currentScale || 1;

    ctx.save();
    ctx.translate(canvas.width / 2 - cameraX * _s + (this._shakeOffsetX||0), canvas.height / 2 - cameraY * _s + (this._shakeOffsetY||0));
    ctx.scale(_s, _s);

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const age = now - line.time;
      const duration = 300;
      if (age > duration) { lines.splice(i, 1); continue; }

      const t = age / duration;

      // Bright core line that fades
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3 * (1 - t * 0.5);
      ctx.beginPath();
      ctx.moveTo(line.x, line.y);
      ctx.lineTo(line.endX, line.endY);
      ctx.stroke();

      // Orange/red glow around it
      ctx.globalAlpha = (1 - t) * 0.4;
      ctx.strokeStyle = '#ff6b4a';
      ctx.lineWidth = 8 * (1 - t * 0.3);
      ctx.beginPath();
      ctx.moveTo(line.x, line.y);
      ctx.lineTo(line.endX, line.endY);
      ctx.stroke();

      // Flash at origin
      if (age < 80) {
        ctx.globalAlpha = (1 - age / 80) * 0.6;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(line.x, line.y, 15, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawScopeOverlay(ctx, canvasW, canvasH) {
    ctx.strokeStyle = 'rgba(255, 200, 100, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(canvasW / 2 - 30, canvasH / 2);
    ctx.lineTo(canvasW / 2 + 30, canvasH / 2);
    ctx.moveTo(canvasW / 2, canvasH / 2 - 30);
    ctx.lineTo(canvasW / 2, canvasH / 2 + 30);
    ctx.stroke();
  }
}
