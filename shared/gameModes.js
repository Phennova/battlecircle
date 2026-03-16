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
    description: 'First team to 20 kills',
    minPlayers: 4,
    maxPlayers: 4,
    teams: true,
    teamSize: 2,
    teamCount: 2,
    respawn: true,
    scoreToWin: 20,
    hasZone: false,
    respawnTime: 3000
  },
  tdm_3v3: {
    name: 'Team Deathmatch 3v3',
    description: 'First team to 20 kills',
    minPlayers: 6,
    maxPlayers: 6,
    teams: true,
    teamSize: 3,
    teamCount: 2,
    respawn: true,
    scoreToWin: 20,
    hasZone: false,
    respawnTime: 3000
  },
  tdm_4v4: {
    name: 'Team Deathmatch 4v4',
    description: 'First team to 20 kills',
    minPlayers: 8,
    maxPlayers: 8,
    teams: true,
    teamSize: 4,
    teamCount: 2,
    respawn: true,
    scoreToWin: 20,
    hasZone: false,
    respawnTime: 3000
  }
};
