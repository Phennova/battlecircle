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
    this.range = weapon.range;
    this.type = weapon.name.toLowerCase();
    this.alive = true;

    // Add player velocity to bullet velocity
    const bulletVx = Math.cos(angle) * weapon.bulletSpeed;
    const bulletVy = Math.sin(angle) * weapon.bulletSpeed;
    this.vx = bulletVx + (ownerVx || 0);
    this.vy = bulletVy + (ownerVy || 0);
    this.speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // Range based on actual distance from spawn point, not accumulated speed
    const dx = this.x - this.startX;
    const dy = this.y - this.startY;
    const distFromStart = Math.sqrt(dx * dx + dy * dy);
    if (distFromStart >= this.range) {
      this.alive = false;
    }
  }
}
