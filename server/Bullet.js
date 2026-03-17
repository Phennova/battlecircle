let nextBulletId = 0;

export class Bullet {
  constructor(ownerId, x, y, angle, weapon, ownerVx, ownerVy) {
    this.id = `b${nextBulletId++}`;
    this.ownerId = ownerId;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.damage = weapon.damage;
    this.range = weapon.range;
    this.type = weapon.name.toLowerCase();
    this.distanceTraveled = 0;
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
    this.distanceTraveled += this.speed * dt;
    if (this.distanceTraveled >= this.range) {
      this.alive = false;
    }
  }
}
