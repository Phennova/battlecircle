import { VISION_RANGE } from '/shared/constants.js';

export class ShadowCaster {
  constructor() {
    this.segments = [];
  }

  setWalls(wallRects) {
    this.segments = [];
    for (const r of wallRects) {
      this.segments.push({ ax: r.x, ay: r.y, bx: r.x + r.w, by: r.y });
      this.segments.push({ ax: r.x, ay: r.y + r.h, bx: r.x + r.w, by: r.y + r.h });
      this.segments.push({ ax: r.x, ay: r.y, bx: r.x, by: r.y + r.h });
      this.segments.push({ ax: r.x + r.w, ay: r.y, bx: r.x + r.w, by: r.y + r.h });
    }
  }

  computeVisibility(px, py) {
    const range = VISION_RANGE;

    // Filter segments near the player
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

    // Add boundary segments (vision range box)
    const bx1 = px - range, by1 = py - range;
    const bx2 = px + range, by2 = py + range;
    nearby.push({ ax: bx1, ay: by1, bx: bx2, by: by1 });
    nearby.push({ ax: bx2, ay: by1, bx: bx2, by: by2 });
    nearby.push({ ax: bx2, ay: by2, bx: bx1, by: by2 });
    nearby.push({ ax: bx1, ay: by2, bx: bx1, by: by1 });

    // Collect unique angles from all endpoints
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

    // Cast ray for each angle, find nearest intersection
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
