export const WEAPONS = {
  pistol: {
    name: 'Pistol',
    fireRate: 2,
    damage: 20,
    range: 400,
    magSize: 12,
    reloadTime: 1000,
    bulletSpeed: 500,
    pellets: 1,
    spread: 0,
    color: '#aaa'
  },
  shotgun: {
    name: 'Shotgun',
    fireRate: 0.8,
    damage: 8,
    range: 250,
    magSize: 5,
    reloadTime: 1500,
    bulletSpeed: 450,
    pellets: 5,
    spread: 0.15,
    color: '#ff8c42'
  },
  rifle: {
    name: 'Rifle',
    fireRate: 1.5,
    damage: 35,
    range: 700,
    magSize: 10,
    reloadTime: 1500,
    bulletSpeed: 800,
    pellets: 1,
    spread: 0,
    color: '#4a9eff'
  }
};

export const AMMO_TYPES = {
  pistol: { name: 'Pistol Ammo', perPickup: 12, color: '#aaa', shape: 'square' },
  shotgun: { name: 'Shotgun Shells', perPickup: 6, color: '#ff8c42', shape: 'rect' },
  rifle: { name: 'Rifle Rounds', perPickup: 8, color: '#4a9eff', shape: 'diamond' }
};
