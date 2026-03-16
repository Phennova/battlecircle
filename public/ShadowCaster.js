export class ShadowCaster {
  constructor() {
    this.segments = [];
    this._smokeSegmentCount = 0;
    this._doorSegmentCount = 0;
    this._baseSegmentCount = 0;
  }

  setWalls(wallRects) {
    this.segments = [];
    for (const r of wallRects) {
      this.segments.push({ ax: r.x, ay: r.y, bx: r.x + r.w, by: r.y });
      this.segments.push({ ax: r.x, ay: r.y + r.h, bx: r.x + r.w, by: r.y + r.h });
      this.segments.push({ ax: r.x, ay: r.y, bx: r.x, by: r.y + r.h });
      this.segments.push({ ax: r.x + r.w, ay: r.y, bx: r.x + r.w, by: r.y + r.h });
    }
    this._baseSegmentCount = this.segments.length;
    this._doorSegmentCount = 0;
  }

  setDoorWalls(doors) {
    // Remove previous door segments, add new ones for closed doors
    if (this._doorSegmentCount > 0) {
      this.segments.splice(this._baseSegmentCount, this._doorSegmentCount);
    }
    this._doorSegmentCount = 0;
    if (!doors) return;
    const closedDoors = doors.filter(d => !d.open);
    for (const d of closedDoors) {
      // Each door rect becomes 4 line segments
      this.segments.splice(this._baseSegmentCount + this._doorSegmentCount, 0,
        { ax: d.x, ay: d.y, bx: d.x + d.w, by: d.y },
        { ax: d.x, ay: d.y + d.h, bx: d.x + d.w, by: d.y + d.h },
        { ax: d.x, ay: d.y, bx: d.x, by: d.y + d.h },
        { ax: d.x + d.w, ay: d.y, bx: d.x + d.w, by: d.y + d.h }
      );
      this._doorSegmentCount += 4;
    }
  }

  addSmokeBlockers(smokes) {
    const SIDES = 12;
    this._smokeSegmentCount = smokes.length * SIDES;
    for (const smoke of smokes) {
      const r = 120;
      for (let i = 0; i < SIDES; i++) {
        const a1 = (Math.PI * 2 * i) / SIDES;
        const a2 = (Math.PI * 2 * (i + 1)) / SIDES;
        this.segments.push({
          ax: smoke.x + Math.cos(a1) * r,
          ay: smoke.y + Math.sin(a1) * r,
          bx: smoke.x + Math.cos(a2) * r,
          by: smoke.y + Math.sin(a2) * r
        });
      }
    }
  }

  removeSmokeBlockers() {
    if (this._smokeSegmentCount > 0) {
      this.segments.splice(this.segments.length - this._smokeSegmentCount, this._smokeSegmentCount);
      this._smokeSegmentCount = 0;
    }
  }

  computeVisibility(px, py, visionRange) {
    const range = visionRange || 600;

    const nearby = [];
    for (const seg of this.segments) {
      const minX = Math.min(seg.ax, seg.bx);
      const maxX = Math.max(seg.ax, seg.bx);
      const minY = Math.min(seg.ay, seg.by);
      const maxY = Math.max(seg.ay, seg.by);
      if (maxX < px - range || minX > px + range) continue;
      if (maxY < py - range || minY > py + range) continue;
      nearby.push(seg);
    }

    const bx1 = px - range, by1 = py - range;
    const bx2 = px + range, by2 = py + range;
    nearby.push({ ax: bx1, ay: by1, bx: bx2, by: by1 });
    nearby.push({ ax: bx2, ay: by1, bx: bx2, by: by2 });
    nearby.push({ ax: bx2, ay: by2, bx: bx1, by: by2 });
    nearby.push({ ax: bx1, ay: by2, bx: bx1, by: by1 });

    const angles = new Set();
    const eps = 0.00001;
    for (const seg of nearby) {
      const a1 = Math.atan2(seg.ay - py, seg.ax - px);
      const a2 = Math.atan2(seg.by - py, seg.bx - px);
      angles.add(a1 - eps);
      angles.add(a1);
      angles.add(a1 + eps);
      angles.add(a2 - eps);
      angles.add(a2);
      angles.add(a2 + eps);
    }

    const sortedAngles = [...angles].sort((a, b) => a - b);

    const points = [];
    for (const angle of sortedAngles) {
      const rdx = Math.cos(angle);
      const rdy = Math.sin(angle);

      let minT = range;
      let hitX = px + rdx * range;
      let hitY = py + rdy * range;

      for (const seg of nearby) {
        const result = this._raySegmentIntersect(px, py, rdx, rdy, seg);
        if (result !== null && result.t < minT && result.t > 0) {
          minT = result.t;
          hitX = result.x;
          hitY = result.y;
        }
      }

      points.push({ x: hitX, y: hitY });
    }

    return points;
  }

  _raySegmentIntersect(rx, ry, rdx, rdy, seg) {
    const sdx = seg.bx - seg.ax;
    const sdy = seg.by - seg.ay;
    const denom = rdx * sdy - rdy * sdx;
    if (Math.abs(denom) < 1e-10) return null;

    const t = ((seg.ax - rx) * sdy - (seg.ay - ry) * sdx) / denom;
    const u = ((seg.ax - rx) * rdy - (seg.ay - ry) * rdx) / denom;

    if (t >= 0 && u >= 0 && u <= 1) {
      return { t, x: rx + t * rdx, y: ry + t * rdy };
    }
    return null;
  }

  isVisible(px, py, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      if (((yi > py) !== (yj > py)) &&
          (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }
}
