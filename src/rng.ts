import { AgentRole } from './types';

export class SeededRNG {
  private state: number;

  constructor(seedStr: string) {
    this.state = SeededRNG.hashString(seedStr || 'METRO-2026');
  }

  public static hashString(str: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h === 0 ? 0x1337cafe : h >>> 0;
  }

  public next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  public range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  public int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  public pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  public chance(probability: number): boolean {
    return this.next() < probability;
  }
}

const FIRST_NAMES = [
  'Elena', 'Marcus', 'Claire', 'David', 'Sophia', 'Liam', 'Maya', 'Noah',
  'Hannah', 'Ethan', 'Chloe', 'Lucas', 'Zoe', 'Mason', 'Lily', 'Logan',
  'Aria', 'Jacob', 'Nina', 'Victor', 'Grace', 'Daniel', 'Ruby', 'Isaac',
  'Nora', 'Julian', 'Eva', 'Caleb', 'Sienna', 'Owen', 'Tara', 'Felix',
  'Kira', 'Arthur', 'Diana', 'Hector', 'Iris', 'Leon', 'Ada', 'Carlos'
];

const LAST_NAMES = [
  'Vance', 'Chen', 'Mercer', 'Reyes', 'Kowalski', 'Patel', 'Takahashi', 'Brooks',
  'Navarro', 'Sterling', 'Okafor', 'Lindqvist', 'Moreau', 'Sato', 'Fletcher',
  'Valdez', 'Kim', 'Rossi', 'Novak', 'Diaz', 'Alvarez', 'Bennett', 'Cole',
  'Frost', 'Grant', 'Hayes', 'Jensen', 'Keller', 'Lawson', 'Mendez'
];

export function generateAgentName(rng: SeededRNG, role: AgentRole, isSwat = false): string {
  const first = rng.pick(FIRST_NAMES);
  const last = rng.pick(LAST_NAMES);
  if (role === 'police') {
    if (isSwat) return `SWAT ${first} ${last}`;
    const rank = rng.chance(0.25) ? 'Sgt.' : 'Ofc.';
    return `${rank} ${first} ${last}`;
  }
  if (role === 'medic') {
    return `Medic ${first} ${last}`;
  }
  return `${first} ${last}`;
}
