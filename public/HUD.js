import { WEAPONS } from '/shared/weapons.js';

export class HUD {
  draw(ctx, canvasW, canvasH, me, gameState) {
    if (!me || !gameState) return;

    this._drawHealthBar(ctx, 20, canvasH - 50, 200, me.health, 100);
    this._drawInventorySlots(ctx, canvasW, canvasH, me);
    this._drawAmmoReserves(ctx, canvasW, canvasH, me.ammoReserve, me.gun ? me.gun.type : null);
    this._drawAliveCount(ctx, 20, 30, gameState.alivePlayers, gameState.players.length);
    this._drawZoneTimer(ctx, canvasW - 20, 30, gameState.gameElapsedMs, gameState.zone);
    this._drawKeybindHints(ctx, canvasW - 20, canvasH - 20);

    if (me.reloading) {
      this._drawStatusIndicator(ctx, canvasW, canvasH, 'RELOADING...', '#ffc832');
    }
    if (me.healing) {
      this._drawStatusIndicator(ctx, canvasW, canvasH, 'HEALING...', '#50c878');
    }

    // Team scores for TDM
    if (gameState.teamScores) {
      this._drawTeamScores(ctx, canvasW, gameState.teamScores, gameState.modeId);
    }
  }

  drawMinimap(ctx, canvasW, canvasH, map, playerX, playerY, zone, destroyedWalls, teammates, flags) {
    if (!map) return;

    const SIZE = 140;
    const PADDING = 10;
    const mx = PADDING;
    const my = canvasH - SIZE - PADDING - 60; // above health bar area
    const scale = SIZE / map.width;
    const destroyed = destroyedWalls ? new Set(destroyedWalls) : new Set();

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(mx, my, SIZE, SIZE);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx, my, SIZE, SIZE);

    // Map floor
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(mx + 1, my + 1, SIZE - 2, SIZE - 2);

    // Buildings (filled rects)
    ctx.fillStyle = '#353555';
    for (const b of map.buildings) {
      ctx.fillRect(mx + b.x * scale, my + b.y * scale, b.w * scale, b.h * scale);
    }

    // All walls (static walls from map + building walls, minus destroyed)
    ctx.fillStyle = '#777';
    let wallIdx = 0;
    // Map-level walls
    for (const w of map.walls) {
      if (!destroyed.has(wallIdx)) {
        const wx = mx + w.x * scale;
        const wy = my + w.y * scale;
        const ww = Math.max(1, w.w * scale);
        const wh = Math.max(1, w.h * scale);
        ctx.fillRect(wx, wy, ww, wh);
      }
      wallIdx++;
    }
    // Building walls
    for (const b of map.buildings) {
      for (const w of b.walls) {
        if (!destroyed.has(wallIdx)) {
          const wx = mx + w.x * scale;
          const wy = my + w.y * scale;
          const ww = Math.max(1, w.w * scale);
          const wh = Math.max(1, w.h * scale);
          ctx.fillRect(wx, wy, ww, wh);
        }
        wallIdx++;
      }
    }

    // Zone circle
    if (zone && zone.active) {
      ctx.strokeStyle = 'rgba(255, 50, 50, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(mx + zone.centerX * scale, my + zone.centerY * scale, zone.currentRadius * scale, 0, Math.PI * 2);
      ctx.stroke();

      // Red fill outside zone
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = '#ff0000';
      ctx.beginPath();
      ctx.rect(mx, my, SIZE, SIZE);
      ctx.arc(mx + zone.centerX * scale, my + zone.centerY * scale, zone.currentRadius * scale, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.restore();
    }

    // CTF flag zones and carrier on minimap
    if (flags) {
      for (const flag of flags) {
        const fzColor = flag.team === 'blue' ? 'rgba(74,158,255,0.25)' : 'rgba(255,107,107,0.25)';
        if (flag.zone) {
          ctx.fillStyle = fzColor;
          ctx.fillRect(mx + flag.zone.x * scale, my + flag.zone.y * scale,
                       flag.zone.w * scale, flag.zone.h * scale);
        }
        // Carrier dot (gold, visible to all)
        if (flag.state === 'carried' && flag.carrierId) {
          const allPlayers = teammates; // we don't have all players here, use carrier position from flag
          // Draw at flag zone if we don't have carrier coords (they're in gameState.players)
        }
      }
      // CTF midline
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(mx + (map.width / 2) * scale, my);
      ctx.lineTo(mx + (map.width / 2) * scale, my + SIZE);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Teammate dots
    if (teammates && teammates.length > 0) {
      ctx.fillStyle = 'rgba(74, 158, 255, 0.6)';
      for (const t of teammates) {
        ctx.beginPath();
        ctx.arc(mx + t.x * scale, my + t.y * scale, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Local player dot
    ctx.fillStyle = '#4a9eff';
    ctx.beginPath();
    ctx.arc(mx + playerX * scale, my + playerY * scale, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawKillFeed(ctx, canvasW, entries, now) {
    const active = entries.filter(e => now - e.time < 5000);
    const x = canvasW - 20;
    let y = 70;

    ctx.textBaseline = 'top';
    ctx.font = '12px sans-serif';

    for (let i = active.length - 1; i >= 0; i--) {
      const e = active[i];
      const age = now - e.time;
      const alpha = age > 4000 ? 1 - (age - 4000) / 1000 : 1;
      ctx.globalAlpha = alpha;

      let text;
      if (e.cause === 'zone') {
        text = `${e.victimName} died to the zone`;
      } else if (e.cause === 'disconnect') {
        text = `${e.victimName} disconnected`;
      } else {
        text = `${e.killerName}  [${e.cause}]  ${e.victimName}`;
      }

      ctx.textAlign = 'right';
      const textW = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - textW - 10, y - 2, textW + 16, 18);

      if (e.cause === 'zone' || e.cause === 'disconnect') {
        ctx.fillStyle = '#ff6b6b';
        ctx.fillText(text, x, y);
      } else {
        ctx.fillStyle = '#ff6b6b';
        ctx.fillText(e.victimName, x, y);
        const victimW = ctx.measureText(e.victimName).width;
        const causeText = `  [${e.cause}]  `;
        ctx.fillStyle = '#888';
        ctx.fillText(causeText, x - victimW, y);
        const causeW = ctx.measureText(causeText).width;
        ctx.fillStyle = '#fff';
        ctx.fillText(e.killerName, x - victimW - causeW, y);
      }

      y += 20;
      if (y > 170) break;
    }

    ctx.globalAlpha = 1;
  }

  drawSpectatorHUD(ctx, canvasW, canvasH, targetName, aliveCount, totalCount) {
    this._drawAliveCount(ctx, 20, 30, aliveCount, totalCount);

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    const text = `Spectating: ${targetName}`;
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    ctx.fillRect(canvasW / 2 - tw / 2 - 12, canvasH - 50, tw + 24, 30);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, canvasW / 2, canvasH - 35);

    ctx.fillStyle = '#888';
    ctx.font = '11px sans-serif';
    ctx.fillText('Left/Right arrows to switch  |  Space to exit', canvasW / 2, canvasH - 15);

    // Play Again button
    ctx.fillStyle = 'rgba(74,158,255,0.8)';
    this._roundRect(ctx, canvasW - 120, 10, 110, 30, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Play Again', canvasW - 65, 25);
  }

  drawLeaderboard(ctx, canvasW, canvasH, standings, myName) {
    if (!standings || standings.length === 0) return;

    const tableW = 400;
    const rowH = 28;
    const startX = (canvasW - tableW) / 2;
    let y = canvasH / 2 + 40;

    ctx.font = 'bold 12px sans-serif';
    ctx.textBaseline = 'middle';

    // Header
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(startX, y, tableW, rowH);
    ctx.fillStyle = '#888';
    ctx.textAlign = 'left';
    ctx.fillText('#', startX + 10, y + rowH / 2);
    ctx.fillText('Name', startX + 40, y + rowH / 2);
    ctx.textAlign = 'right';
    ctx.fillText('Kills', startX + 280, y + rowH / 2);
    ctx.fillText('Damage', startX + 380, y + rowH / 2);
    y += rowH;

    ctx.font = '12px sans-serif';
    for (const p of standings) {
      const isWinner = p.placement === 1;
      const isMe = p.name === myName;

      ctx.fillStyle = isWinner ? 'rgba(255,200,50,0.15)' :
                      isMe ? 'rgba(74,158,255,0.1)' : 'rgba(0,0,0,0.5)';
      ctx.fillRect(startX, y, tableW, rowH);

      if (isWinner) {
        ctx.strokeStyle = 'rgba(255,200,50,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(startX, y, tableW, rowH);
      } else if (isMe) {
        ctx.strokeStyle = 'rgba(74,158,255,0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(startX, y, tableW, rowH);
      }

      ctx.fillStyle = isWinner ? '#ffc832' : '#ccc';
      ctx.textAlign = 'left';
      ctx.fillText(`${p.placement}`, startX + 10, y + rowH / 2);
      ctx.fillText(p.name, startX + 40, y + rowH / 2);
      ctx.textAlign = 'right';
      ctx.fillText(`${p.kills}`, startX + 280, y + rowH / 2);
      ctx.fillText(`${p.damageDealt}`, startX + 380, y + rowH / 2);

      y += rowH;
    }
  }

  _drawHealthBar(ctx, x, y, width, health, maxHealth) {
    const barH = 10;
    const pct = Math.max(0, health / maxHealth);
    ctx.fillStyle = '#333';
    ctx.fillRect(x, y, width, barH);
    const color = pct > 0.5 ? '#50c878' : pct > 0.25 ? '#ffc832' : '#ff4444';
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width * pct, barH);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, barH);
    ctx.fillStyle = '#ccc';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`HP ${Math.ceil(health)} / ${maxHealth}`, x, y - 4);
  }

  _drawInventorySlots(ctx, canvasW, canvasH, me) {
    const slotW = 80, slotH = 60, gap = 10;
    const totalW = slotW * 3 + gap * 2;
    const startX = (canvasW - totalW) / 2;
    const y = canvasH - slotH - 15;

    this._drawSlot(ctx, startX, y, slotW, slotH, me.gun, 'gun', true);
    this._drawSlot(ctx, startX + slotW + gap, y, slotW, slotH, me.grenade, 'grenade', false);
    this._drawSlot(ctx, startX + (slotW + gap) * 2, y, slotW, slotH, me.heal, 'heal', false);
  }

  _drawSlot(ctx, x, y, w, h, item, slotType, isActive) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this._roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = isActive ? 'rgba(74,158,255,0.6)' : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    this._roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();

    if (isActive && item) {
      ctx.shadowColor = 'rgba(74,158,255,0.3)';
      ctx.shadowBlur = 8;
      this._roundRect(ctx, x, y, w, h, 8);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (!item) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#444';
      this._roundRect(ctx, x + 8, y + 8, w - 16, h - 16, 4);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    const cx = x + w / 2, cy = y + h / 2 - 6;

    if (slotType === 'gun') {
      const weapon = WEAPONS[item.type];
      const color = weapon ? weapon.color : '#aaa';
      this._drawGunIcon(ctx, cx, cy, color, item.type);
      ctx.fillStyle = color;
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(weapon ? weapon.name : item.type, cx, cy + 16);
      ctx.fillStyle = '#888';
      ctx.fillText(`${item.magAmmo} / ${item.magSize}`, cx, cy + 26);
    } else if (slotType === 'grenade') {
      if (item.type === 'smoke') {
        this._drawSmokeIcon(ctx, cx, cy);
        ctx.fillStyle = '#aaa';
      } else {
        this._drawGrenadeIcon(ctx, cx, cy);
        ctx.fillStyle = '#ff8c42';
      }
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(item.type === 'smoke' ? 'Smoke' : 'Frag', cx, cy + 16);
      ctx.fillStyle = '#888';
      ctx.fillText(`x ${item.count}`, cx, cy + 26);
    } else if (slotType === 'heal') {
      if (item.type === 'medkit') {
        this._drawMedkitIcon(ctx, cx, cy);
        ctx.fillStyle = '#ff4444';
      } else {
        this._drawBandageIcon(ctx, cx, cy);
        ctx.fillStyle = '#50c878';
      }
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(item.type === 'medkit' ? 'MedKit' : 'Bandage', cx, cy + 16);
      ctx.fillStyle = '#888';
      ctx.fillText(`x ${item.count}`, cx, cy + 26);
    }
  }

  _drawGunIcon(ctx, x, y, color, gunType) {
    if (gunType === 'pistol') {
      ctx.fillStyle = '#777';
      ctx.fillRect(x - 4, y - 3, 12, 5);
      ctx.fillStyle = '#555';
      ctx.fillRect(x + 6, y - 4, 5, 7);
      ctx.fillStyle = '#666';
      ctx.fillRect(x - 1, y + 1, 4, 6);
    } else if (gunType === 'shotgun') {
      ctx.fillStyle = '#a06030';
      ctx.fillRect(x - 10, y - 2, 8, 5);
      ctx.fillStyle = '#555';
      ctx.fillRect(x - 2, y - 2, 14, 4);
      ctx.fillStyle = '#444';
      ctx.fillRect(x + 10, y - 3, 4, 6);
      ctx.fillStyle = '#906828';
      ctx.fillRect(x - 4, y - 5, 7, 3);
    } else if (gunType === 'rifle') {
      ctx.fillStyle = '#556';
      ctx.fillRect(x - 12, y - 2, 8, 5);
      ctx.fillStyle = '#444';
      ctx.fillRect(x - 4, y - 2, 16, 4);
      ctx.fillStyle = '#333';
      ctx.fillRect(x + 10, y - 3, 4, 6);
      ctx.fillStyle = '#668';
      ctx.fillRect(x - 1, y - 6, 8, 3);
    } else if (gunType === 'smg') {
      ctx.fillStyle = '#888';
      ctx.fillRect(x - 6, y - 3, 14, 5);
      ctx.fillStyle = '#555';
      ctx.fillRect(x + 6, y - 4, 4, 7);
      ctx.fillStyle = '#e8e82e';
      ctx.fillRect(x, y + 1, 4, 6);
    } else if (gunType === 'sniper') {
      ctx.fillStyle = '#6b4226';
      ctx.fillRect(x - 12, y - 2, 6, 4);
      ctx.fillStyle = '#444';
      ctx.fillRect(x - 6, y - 1, 20, 3);
      ctx.fillStyle = '#8b4513';
      ctx.fillRect(x - 2, y - 5, 8, 3);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(x - 12, y - 3, 24, 6);
    }
  }

  _drawGrenadeIcon(ctx, x, y) {
    ctx.fillStyle = '#ff8c42';
    ctx.beginPath();
    ctx.arc(x, y + 2, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ff8c42';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y - 10);
    ctx.stroke();
  }

  _drawSmokeIcon(ctx, x, y) {
    ctx.fillStyle = '#aaa';
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(x - 3, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 3, y - 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y + 3, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  _drawBandageIcon(ctx, x, y) {
    ctx.fillStyle = '#50c878';
    ctx.fillRect(x - 7, y - 2, 14, 4);
    ctx.fillRect(x - 2, y - 7, 4, 14);
  }

  _drawMedkitIcon(ctx, x, y) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 8, y - 8, 16, 16);
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(x - 6, y - 2, 12, 4);
    ctx.fillRect(x - 2, y - 6, 4, 12);
  }

  _drawAmmoReserves(ctx, canvasW, canvasH, ammoReserve, equippedGunType) {
    const x = canvasW - 140;
    let y = canvasH / 2 - 50;

    // Determine which ammo type the equipped weapon uses
    const equippedAmmoType = equippedGunType && WEAPONS[equippedGunType]
      ? WEAPONS[equippedGunType].ammoType : null;

    const types = [
      { key: 'light', name: 'Light Ammo', color: '#e8d44d' },
      { key: 'shells', name: 'Shells', color: '#ff8c42' },
      { key: 'heavy', name: 'Heavy Ammo', color: '#5a7fa8' }
    ];

    for (const t of types) {
      const isActive = equippedAmmoType === t.key;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x, y - 10, 125, 24);

      // Mini ammo icon
      ctx.fillStyle = t.color;
      if (t.key === 'light') {
        // Small bullet
        ctx.fillStyle = '#d4a843';
        ctx.fillRect(x + 8, y - 3, 3, 6);
        ctx.fillStyle = '#c87533';
        ctx.beginPath();
        ctx.moveTo(x + 8, y - 3);
        ctx.lineTo(x + 9.5, y - 6);
        ctx.lineTo(x + 11, y - 3);
        ctx.closePath();
        ctx.fill();
      } else if (t.key === 'shells') {
        // Shell
        ctx.fillStyle = '#cc4422';
        ctx.fillRect(x + 7, y - 4, 5, 6);
        ctx.fillStyle = '#d4a843';
        ctx.fillRect(x + 7, y + 2, 5, 2);
      } else if (t.key === 'heavy') {
        // Big bullet
        ctx.fillStyle = '#8a9bb0';
        ctx.fillRect(x + 8, y - 2, 4, 7);
        ctx.fillStyle = '#6a7d8e';
        ctx.beginPath();
        ctx.moveTo(x + 8, y - 2);
        ctx.lineTo(x + 10, y - 6);
        ctx.lineTo(x + 12, y - 2);
        ctx.closePath();
        ctx.fill();
      }

      // Label
      ctx.fillStyle = isActive ? '#fff' : '#777';
      ctx.font = isActive ? 'bold 11px sans-serif' : '11px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.name, x + 20, y);

      // Count
      ctx.textAlign = 'right';
      ctx.fillText(`${ammoReserve[t.key] || 0}`, x + 118, y);

      y += 28;
    }
  }

  _drawAliveCount(ctx, x, y, alive, total) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - 5, y - 15, 110, 24);
    ctx.fillStyle = '#888';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Alive: ', x, y);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${alive}`, x + 45, y);
    ctx.fillStyle = '#555';
    ctx.fillText(` / ${total}`, x + 55, y);
  }

  _drawZoneTimer(ctx, x, y, elapsedMs, zone) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '13px sans-serif';

    if (!zone.active) {
      const remaining = Math.max(0, 60000 - elapsedMs);
      const sec = Math.ceil(remaining / 1000);
      const min = Math.floor(sec / 60);
      const s = sec % 60;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - 130, y - 15, 135, 24);
      ctx.fillStyle = '#ff6b6b';
      ctx.fillText(`Zone in: ${min}:${s.toString().padStart(2, '0')}`, x, y);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - 100, y - 15, 105, 24);
      const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 300);
      ctx.fillStyle = `rgba(255, 80, 80, ${pulse})`;
      ctx.fillText('Zone active', x, y);
    }
  }

  _drawKeybindHints(ctx, x, y) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#444';
    ctx.fillText('E Pickup   G Grenade   H Heal   R Reload   Space Shoot', x, y);
  }

  drawCTFStatus(ctx, canvasW, flags, ctfTimers, holdTimeToWin, players) {
    if (!flags || !ctfTimers) return;

    const cx = canvasW / 2;
    const y = 20;
    const barW = 140;
    const barH = 8;

    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'top';

    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i];
      const isBlue = flag.team === 'blue';
      const color = isBlue ? '#4a9eff' : '#ff6b6b';
      const xOff = isBlue ? cx - barW - 30 : cx + 30;

      // Flag state text
      ctx.fillStyle = color;
      ctx.textAlign = isBlue ? 'right' : 'left';
      let stateText = 'HOME';
      if (flag.state === 'carried') {
        const carrier = players.find(p => p.id === flag.carrierId);
        stateText = `CARRIED by ${carrier ? carrier.name : '?'}`;
      } else if (flag.state === 'held') {
        stateText = 'HELD';
      }
      const labelX = isBlue ? xOff + barW : xOff;
      ctx.fillText(`${flag.team.toUpperCase()} Flag: ${stateText}`, labelX, y);

      // Hold timer bar
      const teamIdx = isBlue ? 0 : 1;
      const holdPct = Math.min(1, ctfTimers[teamIdx] / holdTimeToWin);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(xOff, y + 16, barW, barH);
      ctx.fillStyle = color;
      ctx.fillRect(xOff, y + 16, barW * holdPct, barH);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(xOff, y + 16, barW, barH);

      // Timer text
      const sec = Math.floor(ctfTimers[teamIdx]);
      const min = Math.floor(sec / 60);
      const s = sec % 60;
      ctx.fillStyle = '#aaa';
      ctx.font = '10px sans-serif';
      ctx.fillText(`${min}:${s.toString().padStart(2, '0')}`, labelX, y + 28);
    }
  }

  _drawTeamScores(ctx, canvasW, scores) {
    const y = 60;
    const cx = canvasW / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(cx - 80, y - 12, 160, 28);

    ctx.font = 'bold 16px sans-serif';
    ctx.textBaseline = 'middle';

    // Blue score
    ctx.fillStyle = '#4a9eff';
    ctx.textAlign = 'right';
    ctx.fillText(`${scores[0]}`, cx - 10, y);

    // Separator
    ctx.fillStyle = '#555';
    ctx.textAlign = 'center';
    ctx.fillText('-', cx, y);

    // Red score
    ctx.fillStyle = '#ff6b6b';
    ctx.textAlign = 'left';
    ctx.fillText(`${scores[1]}`, cx + 10, y);
  }

  _drawStatusIndicator(ctx, canvasW, canvasH, text, color) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(canvasW / 2 - 50, canvasH / 2 + 40, 100, 20);
    ctx.fillStyle = color;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvasW / 2, canvasH / 2 + 50);
  }

  drawWarning(ctx, canvasW, canvasH, warning, now) {
    if (!warning) return;
    const elapsed = now - warning.time;
    const duration = 1500;
    if (elapsed > duration) return;

    const alpha = elapsed > duration - 500 ? (duration - elapsed) / 500 : 1;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(warning.text).width;
    ctx.fillRect(canvasW / 2 - tw / 2 - 12, canvasH / 2 + 70, tw + 24, 28);
    ctx.fillStyle = '#ff6b6b';
    ctx.fillText(warning.text, canvasW / 2, canvasH / 2 + 84);
    ctx.globalAlpha = 1;
  }

  drawItemTooltip(ctx, canvasW, canvasH, items, playerX, playerY, cameraScale, doors) {
    const scale = cameraScale || 1;
    const DOOR_RANGE = 60;
    const ITEM_RANGE = 40;

    // Check for nearby door first
    let nearDoor = null;
    let nearDoorDist = Infinity;
    if (doors) {
      for (const door of doors) {
        const dcx = door.x + door.w / 2;
        const dcy = door.y + door.h / 2;
        const dx = playerX - dcx;
        const dy = playerY - dcy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < DOOR_RANGE && dist < nearDoorDist) {
          nearDoorDist = dist;
          nearDoor = door;
        }
      }
    }

    if (nearDoor) {
      const dcx = nearDoor.x + nearDoor.w / 2;
      const dcy = nearDoor.y + nearDoor.h / 2;
      const screenX = canvasW / 2 + (dcx - playerX) * scale;
      const screenY = canvasH / 2 + (dcy - playerY) * scale - 20 * scale;
      const label = nearDoor.open ? '[E] Close Door' : '[E] Open Door';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(screenX - tw / 2 - 6, screenY - 16, tw + 12, 20);
      ctx.fillStyle = '#e8d44d';
      ctx.fillText(label, screenX, screenY);
      return;
    }

    // Find nearest item within pickup range
    let nearest = null;
    let nearestDist = Infinity;
    for (const item of items) {
      if (item.slot === 'ammo') continue;
      const dx = item.x - playerX;
      const dy = item.y - playerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < ITEM_RANGE && dist < nearestDist) {
        nearestDist = dist;
        nearest = item;
      }
    }
    if (!nearest) return;

    const NAMES = {
      pistol: 'Pistol', shotgun: 'Shotgun', rifle: 'Rifle', smg: 'SMG', sniper: 'Sniper',
      frag: 'Frag Grenade', smoke: 'Smoke Grenade',
      bandage: 'Bandage', medkit: 'MedKit',
      light_ammo: 'Light Ammo', shells_ammo: 'Shotgun Shells', heavy_ammo: 'Heavy Ammo'
    };
    const name = NAMES[nearest.type] || nearest.type;

    const screenX = canvasW / 2 + (nearest.x - playerX) * scale;
    const screenY = canvasH / 2 + (nearest.y - playerY) * scale - 22 * scale;

    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const tw = ctx.measureText(`[E] ${name}`).width;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(screenX - tw / 2 - 6, screenY - 16, tw + 12, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(`[E] ${name}`, screenX, screenY);
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
