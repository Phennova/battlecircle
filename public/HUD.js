import { WEAPONS } from '/shared/weapons.js';

const FONT_DISPLAY = "'Orbitron', sans-serif";
const FONT_BODY = "'Rajdhani', sans-serif";
const COL_ACCENT = '#4a9eff';
const COL_DIM = '#5a6480';
const COL_MUTED = '#333a50';
const COL_TEXT = '#e0e6f0';
const COL_PANEL = 'rgba(12, 16, 28, 0.7)';
const COL_BORDER = 'rgba(74, 158, 255, 0.12)';

export class HUD {
  draw(ctx, canvasW, canvasH, me, gameState) {
    if (!me || !gameState) return;

    this._drawHealthBar(ctx, 20, canvasH - 55, 220, me.health, 100);
    this._drawInventorySlots(ctx, canvasW, canvasH, me);
    this._drawAmmoReserves(ctx, canvasW, canvasH, me.ammoReserve, me.gun ? me.gun.type : null);
    this._drawAliveCount(ctx, 20, 30, gameState.alivePlayers, gameState.players.length);
    this._drawZoneTimer(ctx, canvasW - 20, 30, gameState.gameElapsedMs, gameState.zone);
    this._drawKeybindHints(ctx, canvasW - 20, canvasH - 14);

    if (me.reloading) {
      this._drawStatusIndicator(ctx, canvasW, canvasH, 'RELOADING', '#ffc832');
    }
    if (me.healing) {
      this._drawStatusIndicator(ctx, canvasW, canvasH, 'HEALING', '#50c878');
    }

    if (gameState.teamScores) {
      this._drawTeamScores(ctx, canvasW, gameState.teamScores, gameState.modeId);
    }
  }

  drawKillFeed(ctx, canvasW, entries, now) {
    const active = entries.filter(e => now - e.time < 5000);
    const x = canvasW - 16;
    let y = 60;

    ctx.textBaseline = 'top';
    ctx.font = `500 12px ${FONT_BODY}`;

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

      // Panel background with left accent
      ctx.fillStyle = COL_PANEL;
      ctx.fillRect(x - textW - 14, y - 3, textW + 20, 20);
      ctx.fillStyle = e.cause === 'zone' ? '#ff6b4a' : COL_ACCENT;
      ctx.fillRect(x - textW - 14, y - 3, 2, 20);

      if (e.cause === 'zone' || e.cause === 'disconnect') {
        ctx.fillStyle = '#ff6b4a';
        ctx.fillText(text, x, y);
      } else {
        ctx.fillStyle = '#ff6b6b';
        ctx.fillText(e.victimName, x, y);
        const victimW = ctx.measureText(e.victimName).width;
        const causeText = `  [${e.cause}]  `;
        ctx.fillStyle = COL_MUTED;
        ctx.fillText(causeText, x - victimW, y);
        const causeW = ctx.measureText(causeText).width;
        ctx.fillStyle = COL_TEXT;
        ctx.fillText(e.killerName, x - victimW - causeW, y);
      }

      y += 22;
      if (y > 170) break;
    }
    ctx.globalAlpha = 1;
  }

  drawSpectatorHUD(ctx, canvasW, canvasH, targetName, aliveCount, totalCount) {
    this._drawAliveCount(ctx, 20, 30, aliveCount, totalCount);

    // Spectating banner
    ctx.fillStyle = COL_PANEL;
    const text = `SPECTATING: ${targetName.toUpperCase()}`;
    ctx.font = `700 13px ${FONT_DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    ctx.fillRect(canvasW / 2 - tw / 2 - 20, canvasH - 52, tw + 40, 30);
    ctx.fillStyle = COL_ACCENT;
    ctx.fillRect(canvasW / 2 - tw / 2 - 20, canvasH - 52, 2, 30);
    ctx.fillRect(canvasW / 2 + tw / 2 + 18, canvasH - 52, 2, 30);
    ctx.fillStyle = COL_TEXT;
    ctx.fillText(text, canvasW / 2, canvasH - 37);

    ctx.fillStyle = COL_DIM;
    ctx.font = `400 11px ${FONT_BODY}`;
    ctx.fillText('ARROWS to switch  |  SPACE to exit', canvasW / 2, canvasH - 14);

    // Play Again
    ctx.fillStyle = 'rgba(74,158,255,0.15)';
    ctx.strokeStyle = COL_ACCENT;
    ctx.lineWidth = 1;
    ctx.fillRect(canvasW - 126, 10, 116, 28);
    ctx.strokeRect(canvasW - 126, 10, 116, 28);
    ctx.fillStyle = COL_ACCENT;
    ctx.font = `700 10px ${FONT_DISPLAY}`;
    ctx.fillText('PLAY AGAIN', canvasW - 68, 25);
  }

  drawLeaderboard(ctx, canvasW, canvasH, standings, myName) {
    if (!standings || standings.length === 0) return;

    const tableW = 420;
    const rowH = 30;
    const startX = (canvasW - tableW) / 2;
    let y = canvasH / 2 + 40;

    // Header
    ctx.fillStyle = 'rgba(74,158,255,0.08)';
    ctx.fillRect(startX, y, tableW, rowH);
    ctx.fillStyle = COL_ACCENT;
    ctx.fillRect(startX, y, tableW, 1);
    ctx.font = `700 10px ${FONT_DISPLAY}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COL_DIM;
    ctx.textAlign = 'left';
    ctx.fillText('#', startX + 12, y + rowH / 2);
    ctx.fillText('NAME', startX + 42, y + rowH / 2);
    ctx.textAlign = 'right';
    ctx.fillText('KILLS', startX + 290, y + rowH / 2);
    ctx.fillText('DMG', startX + 400, y + rowH / 2);
    y += rowH;

    ctx.font = `500 13px ${FONT_BODY}`;
    for (const p of standings) {
      const isWinner = p.placement === 1;
      const isMe = p.name === myName;

      ctx.fillStyle = isWinner ? 'rgba(255,200,50,0.08)' :
                      isMe ? 'rgba(74,158,255,0.06)' : 'rgba(255,255,255,0.02)';
      ctx.fillRect(startX, y, tableW, rowH);

      if (isWinner) {
        ctx.fillStyle = '#ffc832';
        ctx.fillRect(startX, y, 2, rowH);
      } else if (isMe) {
        ctx.fillStyle = COL_ACCENT;
        ctx.fillRect(startX, y, 2, rowH);
      }

      ctx.fillStyle = isWinner ? '#ffc832' : isMe ? COL_TEXT : '#8890a0';
      ctx.textAlign = 'left';
      ctx.fillText(`${p.placement || ''}`, startX + 12, y + rowH / 2);
      ctx.fillText(p.name, startX + 42, y + rowH / 2);
      ctx.textAlign = 'right';
      ctx.fillText(`${p.kills}`, startX + 290, y + rowH / 2);
      ctx.fillText(`${p.damageDealt}`, startX + 400, y + rowH / 2);

      y += rowH;
    }
  }

  drawCTFStatus(ctx, canvasW, flags, ctfTimers, holdTimeToWin, players) {
    if (!flags || !ctfTimers) return;

    const cx = canvasW / 2;
    const y = 18;
    const barW = 150;
    const barH = 6;

    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i];
      const isBlue = flag.team === 'blue';
      const color = isBlue ? '#4a9eff' : '#ff6b6b';
      const xOff = isBlue ? cx - barW - 40 : cx + 40;

      ctx.font = `700 10px ${FONT_DISPLAY}`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = color;
      ctx.textAlign = isBlue ? 'right' : 'left';
      let stateText = 'HOME';
      if (flag.state === 'carried') {
        const carrier = players.find(p => p.id === flag.carrierId);
        stateText = `CARRIED: ${carrier ? carrier.name.toUpperCase() : '?'}`;
      } else if (flag.state === 'held') {
        stateText = 'HELD';
      }
      const labelX = isBlue ? xOff + barW : xOff;
      ctx.fillText(`${flag.team.toUpperCase()} FLAG: ${stateText}`, labelX, y);

      // Hold timer bar
      const teamIdx = isBlue ? 0 : 1;
      const holdPct = Math.min(1, ctfTimers[teamIdx] / holdTimeToWin);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(xOff, y + 16, barW, barH);
      ctx.fillStyle = color;
      ctx.fillRect(xOff, y + 16, barW * holdPct, barH);

      const sec = Math.floor(ctfTimers[teamIdx]);
      const min = Math.floor(sec / 60);
      const s = sec % 60;
      ctx.font = `400 10px ${FONT_DISPLAY}`;
      ctx.fillStyle = COL_DIM;
      ctx.fillText(`${min}:${s.toString().padStart(2, '0')}`, labelX, y + 26);
    }
  }

  drawShotCooldown(ctx, canvasW, canvasH, cooldownPct) {
    if (cooldownPct >= 1) return;

    const cx = canvasW / 2;
    const cy = canvasH / 2;
    const radius = 20;

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + cooldownPct * Math.PI * 2;
    ctx.strokeStyle = cooldownPct > 0.8 ? 'rgba(80,200,120,0.5)' : 'rgba(74,158,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.stroke();
  }

  drawMinimap(ctx, canvasW, canvasH, map, playerX, playerY, zone, destroyedWalls, teammates, flags) {
    if (!map) return;

    const SIZE = 140;
    const PADDING = 10;
    const mx = PADDING;
    const my = canvasH - SIZE - PADDING - 70;
    const scale = SIZE / map.width;
    const destroyed = destroyedWalls ? new Set(destroyedWalls) : new Set();

    // Panel background
    ctx.fillStyle = COL_PANEL;
    ctx.fillRect(mx - 1, my - 1, SIZE + 2, SIZE + 2);
    ctx.strokeStyle = COL_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(mx - 1, my - 1, SIZE + 2, SIZE + 2);

    // Top accent line
    ctx.fillStyle = COL_ACCENT;
    ctx.fillRect(mx - 1, my - 1, SIZE + 2, 1);

    // Map floor
    ctx.fillStyle = '#0e1018';
    ctx.fillRect(mx, my, SIZE, SIZE);

    // Buildings
    ctx.fillStyle = '#1a1e30';
    for (const b of map.buildings) {
      ctx.fillRect(mx + b.x * scale, my + b.y * scale, b.w * scale, b.h * scale);
    }

    // Walls
    ctx.fillStyle = '#444a5a';
    let wallIdx = 0;
    for (const w of map.walls) {
      if (!destroyed.has(wallIdx)) {
        ctx.fillRect(mx + w.x * scale, my + w.y * scale, Math.max(1, w.w * scale), Math.max(1, w.h * scale));
      }
      wallIdx++;
    }
    for (const b of map.buildings) {
      for (const w of b.walls) {
        if (!destroyed.has(wallIdx)) {
          ctx.fillRect(mx + w.x * scale, my + w.y * scale, Math.max(1, w.w * scale), Math.max(1, w.h * scale));
        }
        wallIdx++;
      }
    }

    // CTF elements
    if (flags) {
      for (const flag of flags) {
        const fzColor = flag.team === 'blue' ? 'rgba(74,158,255,0.2)' : 'rgba(255,107,107,0.2)';
        if (flag.zone) {
          ctx.fillStyle = fzColor;
          ctx.fillRect(mx + flag.zone.x * scale, my + flag.zone.y * scale, flag.zone.w * scale, flag.zone.h * scale);
        }
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(mx + (map.width / 2) * scale, my);
      ctx.lineTo(mx + (map.width / 2) * scale, my + SIZE);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Zone
    if (zone && zone.active) {
      ctx.strokeStyle = 'rgba(255, 50, 50, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mx + zone.centerX * scale, my + zone.centerY * scale, zone.currentRadius * scale, 0, Math.PI * 2);
      ctx.stroke();

      ctx.save();
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = '#ff0000';
      ctx.beginPath();
      ctx.rect(mx, my, SIZE, SIZE);
      ctx.arc(mx + zone.centerX * scale, my + zone.centerY * scale, zone.currentRadius * scale, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.restore();
    }

    // Teammates
    if (teammates && teammates.length > 0) {
      ctx.fillStyle = 'rgba(74, 158, 255, 0.5)';
      for (const t of teammates) {
        ctx.beginPath();
        ctx.arc(mx + t.x * scale, my + t.y * scale, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Local player
    ctx.fillStyle = COL_ACCENT;
    ctx.beginPath();
    ctx.arc(mx + playerX * scale, my + playerY * scale, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Label
    ctx.fillStyle = COL_DIM;
    ctx.font = `700 8px ${FONT_DISPLAY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('MAP', mx + 4, my + 4);
  }

  drawWarning(ctx, canvasW, canvasH, warning, now) {
    if (!warning) return;
    const elapsed = now - warning.time;
    const duration = 1500;
    if (elapsed > duration) return;

    const alpha = elapsed > duration - 500 ? (duration - elapsed) / 500 : 1;
    ctx.globalAlpha = alpha;
    ctx.font = `700 13px ${FONT_DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(warning.text).width;
    ctx.fillStyle = COL_PANEL;
    ctx.fillRect(canvasW / 2 - tw / 2 - 16, canvasH / 2 + 66, tw + 32, 30);
    ctx.fillStyle = '#ff6b4a';
    ctx.fillRect(canvasW / 2 - tw / 2 - 16, canvasH / 2 + 66, 2, 30);
    ctx.fillText(warning.text, canvasW / 2, canvasH / 2 + 81);
    ctx.globalAlpha = 1;
  }

  drawItemTooltip(ctx, canvasW, canvasH, items, playerX, playerY, cameraScale, doors) {
    const scale = cameraScale || 1;
    const DOOR_RANGE = 60;
    const ITEM_RANGE = 40;

    // Check doors
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
      const label = nearDoor.open ? '[E] CLOSE' : '[E] OPEN';
      this._drawTooltip(ctx, screenX, screenY, label, '#ffc832');
      return;
    }

    // Check items
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
      pistol: 'PISTOL', shotgun: 'SHOTGUN', rifle: 'RIFLE', smg: 'SMG', sniper: 'SNIPER',
      frag: 'FRAG GRENADE', smoke: 'SMOKE GRENADE',
      bandage: 'BANDAGE', medkit: 'MEDKIT',
      light_ammo: 'LIGHT AMMO', shells_ammo: 'SHELLS', heavy_ammo: 'HEAVY AMMO'
    };
    const name = NAMES[nearest.type] || nearest.type;

    const screenX = canvasW / 2 + (nearest.x - playerX) * scale;
    const screenY = canvasH / 2 + (nearest.y - playerY) * scale - 22 * scale;
    this._drawTooltip(ctx, screenX, screenY, `[E] ${name}`, COL_TEXT);
  }

  _drawTooltip(ctx, x, y, text, color) {
    ctx.font = `700 10px ${FONT_DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = COL_PANEL;
    ctx.fillRect(x - tw / 2 - 8, y - 18, tw + 16, 20);
    ctx.fillStyle = color;
    ctx.fillRect(x - tw / 2 - 8, y - 18, 2, 20);
    ctx.fillText(text, x, y - 1);
  }

  _drawHealthBar(ctx, x, y, width, health, maxHealth) {
    const barH = 8;
    const pct = Math.max(0, health / maxHealth);

    // Panel
    ctx.fillStyle = COL_PANEL;
    ctx.fillRect(x - 2, y - 18, width + 4, barH + 22);
    ctx.fillStyle = COL_ACCENT;
    ctx.fillRect(x - 2, y - 18, width + 4, 1);

    // Label
    ctx.fillStyle = COL_DIM;
    ctx.font = `700 9px ${FONT_DISPLAY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('HP', x + 2, y - 6);
    ctx.fillStyle = COL_TEXT;
    ctx.font = `600 12px ${FONT_BODY}`;
    ctx.fillText(`${Math.ceil(health)} / ${maxHealth}`, x + 24, y - 5);

    // Bar background
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x, y, width, barH);

    // Bar fill
    const color = pct > 0.5 ? '#50c878' : pct > 0.25 ? '#ffc832' : '#ff4444';
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width * pct, barH);

    // Glow on bar end
    if (pct > 0 && pct < 1) {
      const endX = x + width * pct;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(endX - 2, y - 1, 4, barH + 2);
      ctx.globalAlpha = 1;
    }
  }

  _drawInventorySlots(ctx, canvasW, canvasH, me) {
    const slotW = 76, slotH = 56, gap = 6;
    const totalW = slotW * 3 + gap * 2;
    const startX = (canvasW - totalW) / 2;
    const y = canvasH - slotH - 10;

    this._drawSlot(ctx, startX, y, slotW, slotH, me.gun, 'gun', true);
    this._drawSlot(ctx, startX + slotW + gap, y, slotW, slotH, me.grenade, 'grenade', false);
    this._drawSlot(ctx, startX + (slotW + gap) * 2, y, slotW, slotH, me.heal, 'heal', false);
  }

  _drawSlot(ctx, x, y, w, h, item, slotType, isActive) {
    // Panel
    ctx.fillStyle = COL_PANEL;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = isActive ? 'rgba(74,158,255,0.3)' : COL_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    if (isActive && item) {
      ctx.fillStyle = COL_ACCENT;
      ctx.fillRect(x, y, w, 1);
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = COL_ACCENT;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
    }

    if (!item) {
      ctx.strokeStyle = COL_MUTED;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
      ctx.setLineDash([]);
      return;
    }

    const cx = x + w / 2, cy = y + h / 2 - 5;

    if (slotType === 'gun') {
      const weapon = WEAPONS[item.type];
      const color = weapon ? weapon.color : '#aaa';
      this._drawGunIcon(ctx, cx, cy, color, item.type);
      ctx.fillStyle = COL_DIM;
      ctx.font = `700 8px ${FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(weapon ? weapon.name.toUpperCase() : item.type, cx, cy + 15);
      ctx.fillStyle = COL_TEXT;
      ctx.font = `600 10px ${FONT_BODY}`;
      ctx.fillText(`${item.magAmmo}/${item.magSize}`, cx, cy + 25);
    } else if (slotType === 'grenade') {
      if (item.type === 'smoke') {
        this._drawSmokeIcon(ctx, cx, cy);
        ctx.fillStyle = COL_DIM;
      } else {
        this._drawGrenadeIcon(ctx, cx, cy);
        ctx.fillStyle = '#ff8c42';
      }
      ctx.font = `700 8px ${FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(item.type === 'smoke' ? 'SMOKE' : 'FRAG', cx, cy + 15);
      ctx.fillStyle = COL_TEXT;
      ctx.font = `600 10px ${FONT_BODY}`;
      ctx.fillText(`x${item.count}`, cx, cy + 25);
    } else if (slotType === 'heal') {
      if (item.type === 'medkit') {
        this._drawMedkitIcon(ctx, cx, cy);
        ctx.fillStyle = '#ff4444';
      } else {
        this._drawBandageIcon(ctx, cx, cy);
        ctx.fillStyle = '#50c878';
      }
      ctx.font = `700 8px ${FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(item.type === 'medkit' ? 'MEDKIT' : 'BANDAGE', cx, cy + 15);
      ctx.fillStyle = COL_TEXT;
      ctx.font = `600 10px ${FONT_BODY}`;
      ctx.fillText(`x${item.count}`, cx, cy + 25);
    }
  }

  _drawGunIcon(ctx, x, y, color, gunType) {
    if (gunType === 'pistol') {
      ctx.fillStyle = '#777'; ctx.fillRect(x-4,y-3,12,5); ctx.fillStyle = '#555'; ctx.fillRect(x+6,y-4,5,7); ctx.fillStyle = '#666'; ctx.fillRect(x-1,y+1,4,6);
    } else if (gunType === 'shotgun') {
      ctx.fillStyle = '#a06030'; ctx.fillRect(x-10,y-2,8,5); ctx.fillStyle = '#555'; ctx.fillRect(x-2,y-2,14,4); ctx.fillStyle = '#444'; ctx.fillRect(x+10,y-3,4,6); ctx.fillStyle = '#906828'; ctx.fillRect(x-4,y-5,7,3);
    } else if (gunType === 'rifle') {
      ctx.fillStyle = '#556'; ctx.fillRect(x-12,y-2,8,5); ctx.fillStyle = '#444'; ctx.fillRect(x-4,y-2,16,4); ctx.fillStyle = '#333'; ctx.fillRect(x+10,y-3,4,6); ctx.fillStyle = '#668'; ctx.fillRect(x-1,y-6,8,3);
    } else if (gunType === 'smg') {
      ctx.fillStyle = '#888'; ctx.fillRect(x-6,y-3,14,5); ctx.fillStyle = '#555'; ctx.fillRect(x+6,y-4,4,7); ctx.fillStyle = '#e8e82e'; ctx.fillRect(x,y+1,4,6);
    } else if (gunType === 'sniper') {
      ctx.fillStyle = '#6b4226'; ctx.fillRect(x-12,y-2,6,4); ctx.fillStyle = '#444'; ctx.fillRect(x-6,y-1,20,3); ctx.fillStyle = '#8b4513'; ctx.fillRect(x-2,y-5,8,3);
    } else {
      ctx.fillStyle = color; ctx.fillRect(x-12,y-3,24,6);
    }
  }

  _drawGrenadeIcon(ctx, x, y) {
    ctx.fillStyle = '#ff8c42'; ctx.beginPath(); ctx.arc(x,y+2,7,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#ff8c42'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x,y-5); ctx.lineTo(x,y-10); ctx.stroke();
  }

  _drawSmokeIcon(ctx, x, y) {
    ctx.fillStyle = '#aaa'; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.arc(x-3,y,6,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x+3,y-2,5,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x,y+3,5,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  _drawBandageIcon(ctx, x, y) {
    ctx.fillStyle = '#50c878'; ctx.fillRect(x-7,y-2,14,4); ctx.fillRect(x-2,y-7,4,14);
  }

  _drawMedkitIcon(ctx, x, y) {
    ctx.fillStyle = '#fff'; ctx.fillRect(x-8,y-8,16,16);
    ctx.fillStyle = '#ff4444'; ctx.fillRect(x-6,y-2,12,4); ctx.fillRect(x-2,y-6,4,12);
  }

  _drawAmmoReserves(ctx, canvasW, canvasH, ammoReserve, equippedGunType) {
    const x = canvasW - 145;
    let y = canvasH / 2 - 50;

    const equippedAmmoType = equippedGunType && WEAPONS[equippedGunType]
      ? WEAPONS[equippedGunType].ammoType : null;

    const types = [
      { key: 'light', name: 'LIGHT', color: '#e8d44d' },
      { key: 'shells', name: 'SHELLS', color: '#ff8c42' },
      { key: 'heavy', name: 'HEAVY', color: '#5a7fa8' }
    ];

    for (const t of types) {
      const isActive = equippedAmmoType === t.key;

      ctx.fillStyle = COL_PANEL;
      ctx.fillRect(x, y - 11, 130, 24);
      if (isActive) {
        ctx.fillStyle = t.color;
        ctx.fillRect(x, y - 11, 2, 24);
      }

      // Mini icon
      ctx.fillStyle = t.color;
      if (t.key === 'light') {
        ctx.fillStyle = '#d4a843'; ctx.fillRect(x+10,y-3,3,6);
        ctx.fillStyle = '#c87533'; ctx.beginPath(); ctx.moveTo(x+10,y-3); ctx.lineTo(x+11.5,y-6); ctx.lineTo(x+13,y-3); ctx.closePath(); ctx.fill();
      } else if (t.key === 'shells') {
        ctx.fillStyle = '#cc4422'; ctx.fillRect(x+9,y-4,5,6);
        ctx.fillStyle = '#d4a843'; ctx.fillRect(x+9,y+2,5,2);
      } else {
        ctx.fillStyle = '#8a9bb0'; ctx.fillRect(x+10,y-2,4,7);
        ctx.fillStyle = '#6a7d8e'; ctx.beginPath(); ctx.moveTo(x+10,y-2); ctx.lineTo(x+12,y-6); ctx.lineTo(x+14,y-2); ctx.closePath(); ctx.fill();
      }

      ctx.fillStyle = isActive ? COL_TEXT : COL_DIM;
      ctx.font = isActive ? `700 10px ${FONT_DISPLAY}` : `400 10px ${FONT_DISPLAY}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.name, x + 22, y);

      ctx.textAlign = 'right';
      ctx.fillText(`${ammoReserve[t.key] || 0}`, x + 124, y);

      y += 28;
    }
  }

  _drawAliveCount(ctx, x, y, alive, total) {
    ctx.fillStyle = COL_PANEL;
    ctx.fillRect(x - 4, y - 16, 100, 26);
    ctx.fillStyle = COL_ACCENT;
    ctx.fillRect(x - 4, y - 16, 100, 1);

    ctx.font = `700 9px ${FONT_DISPLAY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COL_DIM;
    ctx.fillText('ALIVE', x + 2, y);
    ctx.fillStyle = COL_TEXT;
    ctx.font = `700 14px ${FONT_BODY}`;
    ctx.fillText(`${alive}`, x + 52, y);
    ctx.fillStyle = COL_MUTED;
    ctx.font = `400 12px ${FONT_BODY}`;
    ctx.fillText(`/ ${total}`, x + 66, y);
  }

  _drawZoneTimer(ctx, x, y, elapsedMs, zone) {
    ctx.textBaseline = 'alphabetic';

    if (!zone.active) {
      const remaining = Math.max(0, 60000 - elapsedMs);
      const sec = Math.ceil(remaining / 1000);
      const min = Math.floor(sec / 60);
      const s = sec % 60;

      ctx.fillStyle = COL_PANEL;
      ctx.fillRect(x - 136, y - 16, 140, 26);
      ctx.fillStyle = '#ff6b4a';
      ctx.fillRect(x - 136, y - 16, 140, 1);

      ctx.font = `700 9px ${FONT_DISPLAY}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = COL_DIM;
      ctx.fillText('ZONE', x - 60, y);
      ctx.fillStyle = '#ff6b4a';
      ctx.font = `700 14px ${FONT_BODY}`;
      ctx.fillText(`${min}:${s.toString().padStart(2, '0')}`, x - 4, y);
    } else {
      ctx.fillStyle = COL_PANEL;
      ctx.fillRect(x - 110, y - 16, 114, 26);
      ctx.fillStyle = '#ff6b4a';
      ctx.fillRect(x - 110, y - 16, 114, 1);

      const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 300);
      ctx.globalAlpha = pulse;
      ctx.font = `700 10px ${FONT_DISPLAY}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ff6b4a';
      ctx.fillText('ZONE ACTIVE', x - 4, y);
      ctx.globalAlpha = 1;
    }
  }

  _drawKeybindHints(ctx, x, y) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `400 10px ${FONT_BODY}`;
    ctx.fillStyle = COL_MUTED;
    ctx.fillText('E Pickup   G Grenade   H Heal   R Reload   Space Shoot', x, y);
  }

  _drawTeamScores(ctx, canvasW, scores) {
    const y = 55;
    const cx = canvasW / 2;

    ctx.fillStyle = COL_PANEL;
    ctx.fillRect(cx - 70, y - 12, 140, 28);

    ctx.font = `700 16px ${FONT_DISPLAY}`;
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#4a9eff';
    ctx.textAlign = 'right';
    ctx.fillText(`${scores[0]}`, cx - 12, y);

    ctx.fillStyle = COL_MUTED;
    ctx.textAlign = 'center';
    ctx.font = `400 12px ${FONT_BODY}`;
    ctx.fillText('-', cx, y);

    ctx.fillStyle = '#ff6b6b';
    ctx.font = `700 16px ${FONT_DISPLAY}`;
    ctx.textAlign = 'left';
    ctx.fillText(`${scores[1]}`, cx + 12, y);
  }

  _drawStatusIndicator(ctx, canvasW, canvasH, text, color) {
    ctx.fillStyle = COL_PANEL;
    ctx.font = `700 11px ${FONT_DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    ctx.fillRect(canvasW / 2 - tw / 2 - 14, canvasH / 2 + 38, tw + 28, 26);
    ctx.fillStyle = color;
    ctx.fillRect(canvasW / 2 - tw / 2 - 14, canvasH / 2 + 38, 2, 26);
    ctx.fillText(text, canvasW / 2, canvasH / 2 + 51);
  }
}
