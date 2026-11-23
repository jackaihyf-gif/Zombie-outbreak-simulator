import type { BlastGateData } from './types';

export const BLAST_GATE_WIDTH = 13;
export const WALL_DECK_RISE = 0.42;
export const WALL_DECK_OVERHANG = 0.56;
export const WALL_DECK_REAR_TRIM = 0.15;
export const WALL_BUILDING_CLEARANCE = 12;
export const GATE_CLOSE_SECONDS = 6;
export const GATE_OPEN_SECONDS = 3;
export const WALL_POST_SLOTS = 4;
export const WALL_OUTER_POST_SLOTS = 2;

export function gateClearHalfWidth(gate: BlastGateData): number {
  return gate.width / 2 * (gate.breached ? 1 : gate.openFraction);
}

export function wallPostX(gateX: number, outer = false): number {
  return gateX + (gateX < 0 ? 1 : -1) * (outer ? -1 : 1) * (BLAST_GATE_WIDTH / 2 + 2.8);
}

export function ladderZ(wall: { z: number; thickness: number }): number {
  return wall.z + wall.thickness / 2 + 0.48;
}

export function wallDeckFrontZ(wall: { z: number; thickness: number }): number {
  return wall.z - wall.thickness / 2 - WALL_DECK_OVERHANG + 0.035;
}

export function wallGuardX(postX: number, slot: number, slots = WALL_POST_SLOTS): number {
  return postX + (slot - (slots - 1) * 0.5) * 1.18;
}

export function wallLadderXs(gateX: number): number[] {
  return [
    ...Array.from({ length: WALL_POST_SLOTS }, (_, slot) => wallGuardX(wallPostX(gateX), slot)),
    ...Array.from({ length: WALL_OUTER_POST_SLOTS }, (_, slot) => wallGuardX(wallPostX(gateX, true), slot, WALL_OUTER_POST_SLOTS))
  ];
}

export function wallRetreatLadderXs(minX: number, maxX: number, gateXs: readonly number[]): number[] {
  const sorted = [...gateXs].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const clearance = BLAST_GATE_WIDTH / 2 + 20;
  const ladders: number[] = [];
  const west = sorted[0] - clearance;
  if (west >= minX + 4) ladders.push(west);
  for (let i = 0; i < sorted.length - 1; i++) {
    const left = sorted[i] + clearance;
    const right = sorted[i + 1] - clearance;
    if (right - left >= 12) ladders.push(left, right);
    else if (right >= left) ladders.push((left + right) / 2);
  }
  const east = sorted[sorted.length - 1] + clearance;
  if (east <= maxX - 4) ladders.push(east);
  return ladders;
}

export function wallDeckSpan(
  wall: { minX: number; maxX: number; id: number },
  gates: readonly BlastGateData[],
  x: number
): { minX: number; maxX: number } | null {
  let { minX, maxX } = wall;
  for (const gate of gates) {
    if (gate.wallId !== wall.id) continue;
    const half = gate.width / 2;
    if (x < gate.x - half) maxX = Math.min(maxX, gate.x - half);
    else if (x > gate.x + half) minX = Math.max(minX, gate.x + half);
    else return null;
  }
  const margin = 0.46;
  return x >= minX && x <= maxX ? { minX: minX + margin, maxX: maxX - margin } : null;
}
