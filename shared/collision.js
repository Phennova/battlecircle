export function resolveCircleAABB(cx, cy, radius, rect) {
  const nearX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const nearY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nearX;
  const dy = cy - nearY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < radius) {
    if (dist > 0) {
      const overlap = radius - dist;
      return { x: cx + (dx / dist) * overlap, y: cy + (dy / dist) * overlap };
    } else {
      // Center inside rect — push along axis of least penetration
      const overlapLeft = cx - rect.x;
      const overlapRight = (rect.x + rect.w) - cx;
      const overlapTop = cy - rect.y;
      const overlapBottom = (rect.y + rect.h) - cy;
      const min = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
      if (min === overlapLeft) return { x: rect.x - radius, y: cy };
      if (min === overlapRight) return { x: rect.x + rect.w + radius, y: cy };
      if (min === overlapTop) return { x: cx, y: rect.y - radius };
      return { x: cx, y: rect.y + rect.h + radius };
    }
  }
  return { x: cx, y: cy };
}

export function resolveAgainstWalls(cx, cy, radius, walls) {
  let x = cx, y = cy;
  for (const wall of walls) {
    const resolved = resolveCircleAABB(x, y, radius, wall);
    x = resolved.x;
    y = resolved.y;
  }
  return { x, y };
}
