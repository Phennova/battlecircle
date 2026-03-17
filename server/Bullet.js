let nextBulletId = 0;

export class Bullet {
  constructor(ownerId, x, y, angle, weapon, ownerVx, ownerVy) {
    this.id = `b${nextBulletId++}`;
    this.ownerId = ownerId;
    this.startX = x;
    this.startY = y;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.damage = weapon.damage;
    this.type = weapon.name.toLowerCase();
    this.alive = true;

    // Add player velocity to bullet velocity
    const bulletVx = Math.cos(angle) * weapon.bulletSpeed;
    const bulletVy = Math.sin(angle) * weapon.bulletSpeed;
    this.vx = bulletVx + (ownerVx || 0);
    this.vy = bulletVy + (ownerVy || 0);
    this.speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);

    // Predict how far the player will move during bullet flight
    // and add that to the range so the effective distance stays consistent
    const baseRange = weapon.range;
    const flightTime = baseRange / weapon.bulletSpeed;
    const bulletDir = { x: Math.cos(angle), y: Math.sin(angle) };
    // Project player velocity onto bullet direction
    const playerAlongBullet = (ownerVx || 0) * bulletDir.x + (ownerVy || 0) * bulletDir.y;
    // Add the distance the player covers along the bullet's path during flight
    this.range = baseRange + Math.max(0, playerAlongBullet * flightTime);
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const dx = this.x - this.startX;
    const dy = this.y - this.startY;
    const distFromStart = Math.sqrt(dx * dx + dy * dy);
    if (distFromStart >= this.range) {
      this.alive = false;
    }
  }
}
