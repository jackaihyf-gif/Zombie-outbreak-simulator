import type { PlayerRole, PlayerWeapon } from './types';

export const PLAYER_KILL_REWARD = { kills: 5, magazines: 2 };

export const PLAYER_LOADOUTS: Record<PlayerRole, readonly PlayerWeapon[]> = {
  civilian: [],
  police: ['pistol', 'shotgun'],
  swat: ['carbine', 'shotgun']
};

export const PLAYER_WEAPONS = {
  pistol: { capacity: 12, reserve: 48, damage: 45, range: 32, interval: 0.32, reload: 1.2, kick: 0.15, flash: 0.65 },
  carbine: { capacity: 24, reserve: 96, damage: 36, range: 52, interval: 0.14, reload: 1.6, kick: 0.09, flash: 0.8 },
  shotgun: { capacity: 6, reserve: 30, damage: 150, range: 21, interval: 0.8, reload: 1.75, kick: 0.22, flash: 1.12 }
} satisfies Record<PlayerWeapon, {
  capacity: number; reserve: number; damage: number; range: number; interval: number; reload: number; kick: number; flash: number;
}>;
