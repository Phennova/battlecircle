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

  draw(cameraX, cameraY, visibilityPolygon) {
    const { ctx, canvas, map } = this;
    if (!map) return;

    const offsetX = canvas.width / 2 - cameraX;
    const offsetY = canvas.height / 2 - cameraY;

    ctx.save();
    ctx.translate(offsetX, offsetY);

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
      this.drawShadow(visibilityPolygon, cameraX, cameraY);
    }

    // Walls drawn ABOVE shadow so always visible
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.fillStyle = '#555';
    for (const w of this.allWalls) {
      ctx.fillRect(w.x, w.y, w.w, w.h);
    }
    ctx.restore();
  }

  drawShadow(visibilityPolygon, cameraX, cameraY) {
    const { ctx, canvas, shadowCanvas, shadowCtx, map } = this;
    if (!map || visibilityPolygon.length < 3) return;

    shadowCanvas.width = canvas.width;
    shadowCanvas.height = canvas.height;

    const offsetX = canvas.width / 2 - cameraX;
    const offsetY = canvas.height / 2 - cameraY;

    // Fill with dark
    shadowCtx.fillStyle = 'rgba(0, 0, 0, 0.88)';
    shadowCtx.fillRect(0, 0, shadowCanvas.width, shadowCanvas.height);

    // Cut out visibility polygon
    shadowCtx.globalCompositeOperation = 'destination-out';
    shadowCtx.fillStyle = '#fff';
    shadowCtx.beginPath();
    shadowCtx.moveTo(
      visibilityPolygon[0].x + offsetX,
      visibilityPolygon[0].y + offsetY
    );
    for (let i = 1; i < visibilityPolygon.length; i++) {
      shadowCtx.lineTo(
        visibilityPolygon[i].x + offsetX,
        visibilityPolygon[i].y + offsetY
      );
    }
    shadowCtx.closePath();
    shadowCtx.fill();
    shadowCtx.globalCompositeOperation = 'source-over';

    // Blit onto main canvas
    ctx.drawImage(shadowCanvas, 0, 0);
  }

  drawPlayer(x, y, angle, radius, color, health, maxHealth) {
    const { ctx } = this;
    // Body circle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Direction indicator
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * (radius + 8), y + Math.sin(angle) * (radius + 8));
    ctx.stroke();

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
  }

  drawBullets(bullets, cameraX, cameraY) {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.translate(canvas.width / 2 - cameraX, canvas.height / 2 - cameraY);
    for (const b of bullets) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawGroundItems(items, cameraX, cameraY, timestamp) {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.translate(canvas.width / 2 - cameraX, canvas.height / 2 - cameraY);

    const EQUIP_COLORS = {
      pistol: '#aaa',
      shotgun: '#ff8c42',
      rifle: '#4a9eff',
      frag: '#ff6347',
      bandage: '#50c878'
    };

    const glow = 0.3 + 0.15 * Math.sin(timestamp / 400);

    for (const item of items) {
      if (item.slot === 'ammo') {
        this._drawAmmoItem(ctx, item, timestamp);
      } else {
        const color = EQUIP_COLORS[item.type] || '#fff';
        // Glow
        ctx.fillStyle = color;
        ctx.globalAlpha = glow;
        ctx.beginPath();
        ctx.arc(item.x, item.y, 14, 0, Math.PI * 2);
        ctx.fill();
        // Solid circle
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(item.x, item.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  _drawAmmoItem(ctx, item, timestamp) {
    const AMMO_COLORS = { pistol: '#aaa', shotgun: '#ff8c42', rifle: '#4a9eff' };
    const color = AMMO_COLORS[item.ammoType] || '#fff';
    const glow = 0.2 + 0.1 * Math.sin(timestamp / 400);

    ctx.fillStyle = color;
    ctx.globalAlpha = glow;
    ctx.beginPath();
    ctx.arc(item.x, item.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = color;
    if (item.ammoType === 'pistol') {
      ctx.fillRect(item.x - 4, item.y - 4, 8, 8);
    } else if (item.ammoType === 'shotgun') {
      ctx.fillRect(item.x - 6, item.y - 3, 12, 6);
    } else if (item.ammoType === 'rifle') {
      ctx.beginPath();
      ctx.moveTo(item.x, item.y - 5);
      ctx.lineTo(item.x + 4, item.y);
      ctx.lineTo(item.x, item.y + 5);
      ctx.lineTo(item.x - 4, item.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawGrenades(grenades, cameraX, cameraY, timestamp) {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.translate(canvas.width / 2 - cameraX, canvas.height / 2 - cameraY);
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
    const offsetX = canvas.width / 2 - cameraX;
    const offsetY = canvas.height / 2 - cameraY;

    ctx.save();
    ctx.fillStyle = 'rgba(200, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.rect(offsetX, offsetY, map.width, map.height);
    ctx.arc(zone.centerX + offsetX, zone.centerY + offsetY, zone.currentRadius, 0, Math.PI * 2, true);
    ctx.fill('evenodd');

    const pulse = 0.6 + 0.4 * Math.sin(timestamp / 300);
    ctx.strokeStyle = `rgba(255, 50, 50, ${pulse})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(zone.centerX + offsetX, zone.centerY + offsetY, zone.currentRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawExplosions(explosions, cameraX, cameraY, now) {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.translate(canvas.width / 2 - cameraX, canvas.height / 2 - cameraY);
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
}
