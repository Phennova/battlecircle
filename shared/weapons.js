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
    color: '#aaa',
    ammoType: 'light'
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
    color: '#ff8c42',
    ammoType: 'shells'
  },
  rifle: {
    name: 'Rifle',
    fireRate: 1.5,
    damage: 35,
    range: 700,
    magSize: 10,
    reloadTime: 1500,
    bulletSpeed: 1200,
    pellets: 1,
    spread: 0,
    color: '#4a9eff',
    ammoType: 'heavy'
  },
  smg: {
    name: 'SMG',
    fireRate: 10,
    damage: 10,
    range: 300,
    magSize: 30,
    reloadTime: 1200,
    bulletSpeed: 600,
    pellets: 1,
    spread: 0.08,
    color: '#e8e82e',
    ammoType: 'light'
  },
  sniper: {
    name: 'Sniper',
    fireRate: 0.4,
    damage: 80,
    range: 1200,
    magSize: 5,
    reloadTime: 2000,
    bulletSpeed: 1800,
    pellets: 1,
    spread: 0,
    color: '#8b4513',
    ammoType: 'heavy'
  }
};

export const AMMO_TYPES = {
  light: { name: 'Light Ammo', perPickup: 15, color: '#e8d44d' },
  shells: { name: 'Shotgun Shells', perPickup: 8, color: '#ff8c42' },
  heavy: { name: 'Heavy Ammo', perPickup: 10, color: '#5a7fa8' }
};
