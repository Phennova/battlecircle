let nextBulletId = 0;

export class Bullet {
  constructor(ownerId, x, y, angle, weapon) {
    this.id = `b${nextBulletId++}`;
    this.ownerId = ownerId;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.speed = weapon.bulletSpeed;
    this.damage = weapon.damage;
    this.range = weapon.range;
    this.type = weapon.name.toLowerCase();
    this.distanceTraveled = 0;
    this.alive = true;
  }

  update(dt) {
    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
    this.distanceTraveled += this.speed * dt;
    if (this.distanceTraveled >= this.range) {
      this.alive = false;
    }
  }
}
