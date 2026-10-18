// All game-balance numbers live here. The game is tuned for a young player:
// enemies telegraph attacks, only a few may attack at once, and health regenerates.

export const HEROES = {
  jimmy: {
    id: 'jimmy',
    name: 'Jimmy',
    title: 'The Rookie',
    level: 1,
    cost: 0,
    health: 100,
    strength: 12,
    speed: 7.5,
    scale: 1.0,
    primary: 'punch',
    secondary: null,
    superAbility: null,
    coinMult: 1,
    color: '#2f7bff',
    blurb: 'A brave little robot ready for his first adventure!',
  },
  bob: {
    id: 'bob',
    name: 'Bob',
    title: 'Neutral & Normal',
    level: 2,
    cost: 400,
    health: 200,
    strength: 50,
    speed: 7.5,
    scale: 1.15,
    primary: 'blast',
    secondary: null,
    superAbility: 'laserSuper',
    coinMult: 1.5,
    color: '#7f8f7a',
    blurb: 'Just a normal robot. With a normal giant laser.',
  },
  nooby: {
    id: 'nooby',
    name: 'Nooby',
    title: 'Loves Stars',
    level: 3,
    cost: 1000,
    health: 50,
    strength: 50,
    speed: 8.6,
    scale: 0.95,
    primary: 'slice',
    secondary: null,
    superAbility: 'starSlice',
    coinMult: 2,
    color: '#9a5cff',
    blurb: 'Super fast sword fighter who is obsessed with stars.',
  },
  oli: {
    id: 'oli',
    name: 'Oli Bot',
    title: 'The G.O.A.T.',
    level: 4,
    cost: 2200,
    health: 500,
    strength: 100,
    speed: 7.8,
    scale: 1.35,
    primary: 'laser',
    secondary: 'blast',
    superAbility: 'rocket',
    coinMult: 2.5,
    color: '#d4a017',
    blurb: 'One of the strongest robots ever built. Lasers, blasts AND rockets!',
  },
};

export const HERO_ORDER = ['jimmy', 'bob', 'nooby', 'oli'];

export const ABILITIES = {
  punch: { name: 'Punch', icon: '👊', cooldown: 0.38 },
  slice: { name: 'Slice', icon: '🗡️', cooldown: 0.4 },
  blast: { name: 'Blast', icon: '💥', cooldown: 0.55 },
  laser: { name: 'Laser', icon: '🔴', cooldown: 0.9 },
  dash: { name: 'Dash', icon: '💨', cooldown: 1.1 },
  laserSuper: { name: 'MEGA LASER', icon: '⚡' },
  starSlice: { name: 'STAR SLICE', icon: '⭐' },
  rocket: { name: 'ROCKETS', icon: '🚀' },
};

// hpMul is multiplied by the current hero's strength, dmgMul by the hero's max health,
// so every hero needs a similar number of hits and can take a similar number of hits.
export const ENEMY_TYPES = {
  scrapper: {
    name: 'Scrapper', hpMul: 3.2, dmgMul: 0.06, speed: 4.0, range: 2.1,
    windup: 0.65, cooldown: 1.7, coins: 6, radius: 0.6, attack: 'melee', scale: 0.95,
  },
  zapper: {
    name: 'Zapper Drone', hpMul: 2.2, dmgMul: 0.045, speed: 4.8, range: 15,
    windup: 0.8, cooldown: 2.4, coins: 5, radius: 0.7, attack: 'ranged', scale: 1,
  },
  clanker: {
    name: 'Clanker', hpMul: 7, dmgMul: 0.1, speed: 3.1, range: 3.0,
    windup: 0.95, cooldown: 2.1, coins: 14, radius: 1.0, attack: 'melee', scale: 1.5,
  },
};

export const BOSSES = [
  { id: 'kingclank', name: 'King Clank', hpMul: 28, dmgMul: 0.12, coins: 80, body: '#b8441f', accent: '#ffcc33', eye: '#ff3300', angle: 30 },
  { id: 'megadrill', name: 'Mega Drill', hpMul: 32, dmgMul: 0.12, coins: 90, body: '#3d5a80', accent: '#e0e0e0', eye: '#ff2266', angle: 120 },
  { id: 'boombot', name: 'Boom Bot', hpMul: 36, dmgMul: 0.13, coins: 100, body: '#5c2a7a', accent: '#ff9e00', eye: '#ff00aa', angle: 210 },
  { id: 'rustytitan', name: 'Rusty Titan', hpMul: 40, dmgMul: 0.13, coins: 110, body: '#6b4b2a', accent: '#9acd32', eye: '#ff5500', angle: 300 },
];

export const ECONOMY = {
  deathPenalty: 0.25,       // fraction of coins lost when smashed
  mapCoinValue: 2,          // shiny coins lying around the map
  mapCoinRespawn: 45,
  enemyRespawn: 25,
  bossRespawn: 120,
};

export const WORLD = {
  playRadius: 182,
  terrainSize: 440,
  arenaRadius: 20,
  arenaDistance: 130,
  seed: 1337,
};
