export const GAME_MODES = {
  battle_royale: {
    name: 'Battle Royale',
    description: 'Free-for-all, last one standing',
    minPlayers: 2,
    maxPlayers: 8,
    teams: false,
    respawn: false,
    scoreToWin: null,
    hasZone: true,
    respawnTime: 0
  },
  tdm_2v2: {
    name: 'Team Deathmatch 2v2',
    description: 'Eliminate the enemy team',
    minPlayers: 4,
    maxPlayers: 4,
    teams: true,
    teamSize: 2,
    teamCount: 2,
    respawn: false,
    scoreToWin: null,
    hasZone: false,
    respawnTime: 0,
    teamElimination: true
  },
  tdm_3v3: {
    name: 'Team Deathmatch 3v3',
    description: 'Eliminate the enemy team',
    minPlayers: 6,
    maxPlayers: 6,
    teams: true,
    teamSize: 3,
    teamCount: 2,
    respawn: false,
    scoreToWin: null,
    hasZone: false,
    respawnTime: 0,
    teamElimination: true
  },
  tdm_4v4: {
    name: 'Team Deathmatch 4v4',
    description: 'Eliminate the enemy team',
    minPlayers: 8,
    maxPlayers: 8,
    teams: true,
    teamSize: 4,
    teamCount: 2,
    respawn: false,
    scoreToWin: null,
    hasZone: false,
    respawnTime: 0,
    teamElimination: true
  },
  ctf_3v3: {
    name: 'Capture the Flag 3v3',
    description: 'Capture and hold the enemy flag',
    minPlayers: 6,
    maxPlayers: 6,
    teams: true,
    teamSize: 3,
    teamCount: 2,
    respawn: true,
    scoreToWin: null,
    hasZone: false,
    respawnTime: 3000,
    ctf: true,
    holdTimeToWin: 180
  },

  // ── ARCADE MODES (1 human + bots) ──
  arcade_br: {
    name: 'Arcade: Battle Royale',
    description: 'Battle Royale vs bots',
    minPlayers: 1, maxPlayers: 1,
    teams: false, respawn: false, scoreToWin: null,
    hasZone: true, respawnTime: 0,
    arcade: true, botCount: 7
  },
  arcade_tdm_2v2: {
    name: 'Arcade: TDM 2v2',
    description: 'Team elimination vs bots',
    minPlayers: 1, maxPlayers: 1,
    teams: true, teamSize: 2, teamCount: 2,
    respawn: false, scoreToWin: null, hasZone: false, respawnTime: 0,
    teamElimination: true, arcade: true, botCount: 3
  },
  arcade_tdm_3v3: {
    name: 'Arcade: TDM 3v3',
    description: 'Team elimination vs bots',
    minPlayers: 1, maxPlayers: 1,
    teams: true, teamSize: 3, teamCount: 2,
    respawn: false, scoreToWin: null, hasZone: false, respawnTime: 0,
    teamElimination: true, arcade: true, botCount: 5
  },
  arcade_ctf: {
    name: 'Arcade: CTF 3v3',
    description: 'Capture the Flag vs bots',
    minPlayers: 1, maxPlayers: 1,
    teams: true, teamSize: 3, teamCount: 2,
    respawn: true, scoreToWin: null, hasZone: false, respawnTime: 3000,
    ctf: true, holdTimeToWin: 180, arcade: true, botCount: 5
  }
};

export const CTF_CLASSES = {
  rusher: { name: 'Rusher', gun: 'smg', grenade: { type: 'frag', count: 2 }, heal: { type: 'bandage', count: 3 } },
  assault: { name: 'Assault', gun: 'rifle', grenade: { type: 'frag', count: 2 }, heal: { type: 'bandage', count: 3 } },
  breacher: { name: 'Breacher', gun: 'shotgun', grenade: { type: 'smoke', count: 2 }, heal: { type: 'medkit', count: 1 } },
  marksman: { name: 'Marksman', gun: 'sniper', grenade: { type: 'smoke', count: 2 }, heal: { type: 'bandage', count: 3 } }
};
