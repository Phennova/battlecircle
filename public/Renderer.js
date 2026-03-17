export class Renderer {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.map = null;
    this.allWalls = [];
    this.shadowCanvas = document.createElement('canvas');
    this.shadowCtx = this.shadowCanvas.getContext('2d');
  }

  setMap(map) {
    this.map = map;
    this.allWalls = [...map.walls];
    for (const b of map.buildings) {
      this.allWalls.push(...b.walls);
    }
  }

  draw(cameraX, cameraY, visibilityPolygon, cameraScale, destroyedWalls, visionRange) {
    const { ctx, canvas, map } = this;
    if (!map) return;

    const scale = cameraScale || 1;
    this._currentScale = scale;
    const offsetX = canvas.width / 2 - cameraX * scale;
    const offsetY = canvas.height / 2 - cameraY * scale;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Floor
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, map.width, map.height);

    // Building floors (lighter)
    ctx.fillStyle = '#252540';
    for (const b of map.buildings) {
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }

    ctx.restore();

    // Shadow overlay (screen-space)
    if (visibilityPolygon) {
      this.drawShadow(visibilityPolygon, cameraX, cameraY, scale, visionRange);
    }

    // Walls drawn ABOVE shadow so always visible
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    const destroyed = destroyedWalls ? new Set(destroyedWalls) : new Set();
    ctx.fillStyle = '#555';
    for (let wi = 0; wi < this.allWalls.length; wi++) {
      if (destroyed.has(wi)) continue;
      const w = this.allWalls[wi];
      ctx.fillRect(w.x, w.y, w.w, w.h);
    }
    // Draw rubble at destroyed wall positions
    if (destroyed.size > 0) {
      ctx.fillStyle = '#443322';
      for (const idx of destroyed) {
        if (idx < this.allWalls.length) {
          const w = this.allWalls[idx];
          // Scattered rubble dots
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
    shadowCtx.fillStyle = 'rgba(0, 0, 0, 0.88)';
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

    // Now paint back darkness outside the circle to clip to round shape
    shadowCtx.globalCompositeOperation = 'source-over';
    shadowCtx.fillStyle = 'rgba(0, 0, 0, 0.88)';
    shadowCtx.beginPath();
    shadowCtx.rect(0, 0, canvas.width, canvas.height);
    shadowCtx.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
    shadowCtx.fill('evenodd');

    shadowCtx.globalCompositeOperation = 'source-over';

    // Blit onto main canvas
    ctx.drawImage(shadowCanvas, 0, 0);
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
    ctx.translate(canvas.width / 2 - cameraX * _s, canvas.height / 2 - cameraY * _s);
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
    ctx.translate(canvas.width / 2 - cameraX * _s, canvas.height / 2 - cameraY * _s);
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
    ctx.translate(canvas.width / 2 - cameraX * _s, canvas.height / 2 - cameraY * _s);
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
    const offsetX = canvas.width / 2 - cameraX * _s;
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
    ctx.translate(canvas.width / 2 - cameraX * _s, canvas.height / 2 - cameraY * _s);
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
    ctx.translate(canvas.width / 2 - cameraX * _s, canvas.height / 2 - cameraY * _s);
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
    ctx.translate(canvas.width / 2 - cameraX * _s, canvas.height / 2 - cameraY * _s);
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
    ctx.translate(canvas.width / 2 - cameraX * _s, canvas.height / 2 - cameraY * _s);
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
    const offsetX = canvas.width / 2 - cameraX * _s;
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
    ctx.translate(canvas.width / 2 - cameraX * _s, canvas.height / 2 - cameraY * _s);
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
