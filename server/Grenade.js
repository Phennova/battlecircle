let nextGrenadeId = 0;

export class Grenade {
  constructor(ownerId, x, y, angle) {
    this.id = `g${nextGrenadeId++}`;
    this.ownerId = ownerId;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.speed = 300;
    this.maxDistance = 350;
    this.distanceTraveled = 0;
    this.stopped = false;
    this.fuseTime = 2500;
    this.createdAt = Date.now();
    this.explodeAt = Date.now() + this.fuseTime;
    this.explosionRadius = 80;
    this.centerDamage = 60;
    this.edgeDamage = 20;
    this.alive = true;
  }

  update(dt, walls) {
    if (this.stopped) return;

    const newX = this.x + Math.cos(this.angle) * this.speed * dt;
    const newY = this.y + Math.sin(this.angle) * this.speed * dt;

    for (const wall of walls) {
      if (newX >= wall.x && newX <= wall.x + wall.w &&
          newY >= wall.y && newY <= wall.y + wall.h) {
        this.stopped = true;
        return;
      }
    }

    this.x = newX;
    this.y = newY;
    this.distanceTraveled += this.speed * dt;

    if (this.distanceTraveled >= this.maxDistance) {
      this.stopped = true;
    }
  }

  shouldExplode() {
    return Date.now() >= this.explodeAt;
  }

  getDamageAt(dist) {
    if (dist > this.explosionRadius) return 0;
    const t = dist / this.explosionRadius;
    return this.centerDamage + (this.edgeDamage - this.centerDamage) * t;
  }
}
