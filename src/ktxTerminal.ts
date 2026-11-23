import type { Vec2 } from './types';
import { TRAIN_BOARDING_X } from './trainLayout';
import { segmentIntersectsAABB } from './spatial';

export const KTX_LAST_LINE_Z = 148;
export const KTX_PLATFORM_Y = 6;
export const KTX_RAIL_Z = 196;
export const KTX_ENTRY = { x: 26, z: 152.7 };
export const KTX_TRANSFER_X = -27;
export const KTX_INTAKE_Z = 155.3;
export const KTX_FORECOURT_CROSSING = { x: -10, z: 152.65, width: 4.7 };
export const KTX_BOARDING = { x: TRAIN_BOARDING_X, z: KTX_RAIL_Z };

export const KTX_GATES = {
  public: { x: 32, z: 166, width: 11, y: 0, axis: 'x', label: 'KTX East Gate' },
  crew: { x: -43, z: 166, width: 7, y: 0, axis: 'x', label: 'KTX West Gate' },
  transfer: { x: KTX_TRANSFER_X, z: 191.45, width: 2.5, y: KTX_PLATFORM_Y, axis: 'z', label: 'KTX Service Partition' }
} as const;
export type KtxGateId = keyof typeof KTX_GATES;
export type KtxLane = Exclude<KtxGateId, 'transfer'>;
export const KTX_LANES = ['public', 'crew'] as const;
export const KTX_GATE_IDS = ['public', 'crew', 'transfer'] as const;
export function ktxGateBox(id: KtxGateId) {
  const g = KTX_GATES[id];
  return { x: g.x, z: g.z, y: g.y, width: g.axis === 'x' ? g.width : 0.34,
    depth: g.axis === 'z' ? g.width : 0.34, height: 2.65 };
}
export interface KtxGateState {
  open: boolean;
  integrity: number;
  maxIntegrity: number;
  lastDamagedAt: number;
  manualUntil: number;
}
export type KtxGates = Record<KtxGateId, KtxGateState>;

export interface KtxSurface {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  fromY: number;
  toY: number;
}

export const KTX_SURFACES: readonly KtxSurface[] = [
  { id: 'east-lower', minX: 26.5, maxX: 37.5, minZ: 167, maxZ: 176, fromY: 0, toY: 3 },
  { id: 'east-landing', minX: 26.5, maxX: 49, minZ: 176, maxZ: 181, fromY: 3, toY: 3 },
  { id: 'east-upper', minX: 39, maxX: 49, minZ: 181, maxZ: 189, fromY: 3, toY: 6 },
  { id: 'west-lower', minX: -46.5, maxX: -39.5, minZ: 167, maxZ: 176, fromY: 0, toY: 3 },
  { id: 'west-landing', minX: -57, maxX: -39.5, minZ: 176, maxZ: 181, fromY: 3, toY: 3 },
  { id: 'west-upper', minX: -57, maxX: -50, minZ: 181, maxZ: 189, fromY: 3, toY: 6 },
  { id: 'tower-stair', minX: -62, maxX: -58, minZ: 153, maxZ: 161, fromY: 0, toY: 4 },
  { id: 'tower', minX: -64, maxX: -54, minZ: 161, maxZ: 165, fromY: 4, toY: 4 },
  { id: 'terrace', minX: 8, maxX: 24.5, minZ: 157.5, maxZ: 189, fromY: 6, toY: 6 },
  { id: 'platform', minX: -61, maxX: 56, minZ: 189, maxZ: 194, fromY: 6, toY: 6 },
  { id: 'boarding', minX: TRAIN_BOARDING_X - 1.5, maxX: TRAIN_BOARDING_X + 1.5, minZ: 194, maxZ: 196.4, fromY: 6, toY: 6 }
];

const links = [
  ['east-lower', 'east-landing'], ['east-landing', 'east-upper'], ['east-upper', 'platform'],
  ['west-lower', 'west-landing'], ['west-landing', 'west-upper'], ['west-upper', 'platform'],
  ['tower-stair', 'tower'], ['terrace', 'platform'], ['platform', 'boarding']
];

export const KTX_GROUND_ENTRIES = ['east-lower', 'west-lower', 'tower-stair'];

export const KTX_STATION_POSTS = [
  { surface: 'terrace', x: 11.6, z: 162.3 },
  { surface: 'terrace', x: 21.3, z: 172.2 },
  { surface: 'terrace', x: 11.6, z: 183.4 },
  { surface: 'terrace', x: 21.3, z: 162.3 },
  { surface: 'east-landing', x: 30.6, z: 179.7 },
  { surface: 'platform', x: 30.5, z: 190.0 },
  { surface: 'terrace', x: 11.6, z: 172.2 },
  { surface: 'platform', x: 4.3, z: 190.0 },
  { surface: 'terrace', x: 21.3, z: 183.4 },
  { surface: 'east-landing', x: 37.3, z: 179.8 },
  { surface: 'platform', x: -7.4, z: 190.0 }
] as const;

export function ktxCanWalkBetween(from: KtxSurface, to: KtxSurface): boolean {
  return from.id === to.id || links.some(([a, b]) =>
    (from.id === a && to.id === b) || (from.id === b && to.id === a));
}

export function ktxSurfaceAt(x: number, z: number, height = 0): KtxSurface | undefined {
  return KTX_SURFACES.find((s) => x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ &&
    Math.abs(ktxSurfaceHeight(s, x, z) - height) <= 0.53);
}

export function ktxSurfaceHeight(surface: KtxSurface, _x: number, z: number): number {
  const t = (z - surface.minZ) / (surface.maxZ - surface.minZ);
  return surface.fromY + (surface.toY - surface.fromY) * t;
}

export const KTX_SHOT_FLOORS = KTX_SURFACES.flatMap((surface) => {
  const { minX, maxX, minZ, maxZ, fromY, toY } = surface;
  if (fromY === toY) return [{ minX, maxX, minZ, maxZ, minY: fromY - 0.56, maxY: fromY }];
  const steps = Math.ceil((toY - fromY) / 0.19);
  const depth = (maxZ - minZ) / steps;
  return Array.from({ length: steps }, (_, index) => {
    const z = minZ + (index + 0.5) * depth;
    const y = ktxSurfaceHeight(surface, minX, z);
    return {
      minX, maxX, minZ: z - (depth + 0.015) / 2, maxZ: z + (depth + 0.015) / 2,
      minY: y - 0.33, maxY: y + 0.01
    };
  });
});

export function ktxContains(x: number, z: number): boolean {
  return x > -68 && x < 64 && z >= 152 && z < 207;
}

interface KtxBox extends Vec2 {
  y?: number;
  width: number;
  depth: number;
  height: number;
  kind: 'wall' | 'cover' | 'pier' | 'supply' | 'bench' | 'locker';
}
export const KTX_BOXES: readonly KtxBox[] = [
  { x: -54, z: 166, width: 15, depth: 0.6, height: 2.6, kind: 'wall' },
  { x: -32, z: 166, width: 15, depth: 0.6, height: 2.6, kind: 'wall' },
  { x: 20, z: 166, width: 13, depth: 0.6, height: 2.6, kind: 'wall' },
  { x: 47, z: 166, width: 19, depth: 0.6, height: 2.6, kind: 'wall' },
  ...[-46.7, -39.3, 26.3, 37.7].map((x): KtxBox =>
    ({ x, z: 168.3, width: 0.36, depth: 4.9, height: 2.65, kind: 'wall' })),
  { x: -54, z: 159, width: 5, depth: 1, height: 1.05, kind: 'cover' },
  { x: -32, z: 160, width: 4, depth: 1, height: 1.05, kind: 'cover' },
  { x: 42, z: 161, width: 5, depth: 1, height: 1.05, kind: 'cover' },
  { x: 18, z: 158, width: 5, depth: 1, height: 1.05, kind: 'cover' },
  { x: 4, z: 176, width: 7, depth: 4, height: 2.4, kind: 'supply' },
  { x: 53, z: 157.5, width: 4.4, depth: 3.6, height: 2.5, kind: 'supply' },
  ...[168, 173, 178].map((z): KtxBox =>
    ({ x: 9.3, z, y: KTX_PLATFORM_Y, width: 0.72, depth: 3.1, height: 0.94, kind: 'bench' })),
  { x: 23.45, z: 163.5, y: KTX_PLATFORM_Y, width: 0.66, depth: 2.8, height: 1.62, kind: 'locker' },
  { x: 13, z: 162.5, width: 3, depth: 0.74, height: 1.45, kind: 'locker' },
  { x: 52.8, z: 162.6, width: 2.8, depth: 0.8, height: 0.94, kind: 'bench' },
  ...[[149, KTX_FORECOURT_CROSSING.z - KTX_FORECOURT_CROSSING.width / 2],
    [KTX_FORECOURT_CROSSING.z + KTX_FORECOURT_CROSSING.width / 2, 188.5]].map(([start, end]): KtxBox =>
    ({ x: KTX_FORECOURT_CROSSING.x, z: (start + end) / 2, width: 0.72, depth: end - start, height: 2.7, kind: 'wall' })),
  { x: 14, z: KTX_INTAKE_Z, width: 16, depth: 0.5, height: 2.65, kind: 'wall' },
  { x: 45, z: KTX_INTAKE_Z, width: 22, depth: 0.5, height: 2.65, kind: 'wall' },
  { x: 6, z: 160.65, width: 0.54, depth: 11.2, height: 2.65, kind: 'wall' },
  { x: 56, z: 160.65, width: 0.54, depth: 11.2, height: 2.65, kind: 'wall' },
  { x: 9.85, z: 166, width: 7.7, depth: 0.6, height: 2.65, kind: 'wall' },
  { x: 9, z: 158.8, width: 0.76, depth: 0.76, height: 5.72, kind: 'pier' },
  { x: 23.5, z: 169.5, width: 0.76, depth: 0.76, height: 5.72, kind: 'pier' },
  { x: 9, z: 181.5, width: 0.76, depth: 0.76, height: 5.72, kind: 'pier' },
  { x: KTX_TRANSFER_X, z: 189.6, y: KTX_PLATFORM_Y, width: 0.5, depth: 1.2, height: 3, kind: 'wall' },
  { x: KTX_TRANSFER_X, z: 193.35, y: KTX_PLATFORM_Y, width: 0.5, depth: 1.3, height: 3, kind: 'wall' },
  ...[-112, -84, -56, -28, 0, 28, 56, 84, 112].map((x): KtxBox =>
    ({ x, z: 199, width: 2.3, depth: 3.2, height: 5.5, kind: 'pier' }))
];

const lowerStairs = KTX_SURFACES.filter((surface) => surface.id.endsWith('-lower'));
function ktxUnderStair(x: number, z: number): boolean {
  return lowerStairs.some((stair) => x >= stair.minX - 0.45 && x <= stair.maxX + 0.45 &&
    z > stair.minZ + 0.08 && z <= stair.maxZ + 0.45);
}

const solidGroundBoxes = KTX_BOXES.filter((box) => !box.y).map((box) => ({
  minX: box.x - box.width / 2 - 0.4, maxX: box.x + box.width / 2 + 0.4,
  minZ: box.z - box.depth / 2 - 0.4, maxZ: box.z + box.depth / 2 + 0.4
}));

export function ktxGroundEscape(point: Vec2): Vec2 | undefined {
  const box = solidGroundBoxes.find(({ minX, maxX, minZ, maxZ }) =>
    point.x > minX && point.x < maxX && point.z > minZ && point.z < maxZ);
  if (!box) return;
  const exits = [
    { x: box.minX - 0.21, z: point.z }, { x: box.maxX + 0.21, z: point.z },
    { x: point.x, z: box.minZ - 0.21 }, { x: point.x, z: box.maxZ + 0.21 }
  ];
  return exits.sort((a, b) => Math.hypot(a.x - point.x, a.z - point.z) - Math.hypot(b.x - point.x, b.z - point.z))[0];
}

// Ground circulation must reach the first step from its entrance, not from underneath.
const groundObstacles = [
  ...solidGroundBoxes,
  ...lowerStairs.map((stair) => ({
    minX: stair.minX - 0.45, maxX: stair.maxX + 0.45, minZ: stair.minZ + 0.08, maxZ: stair.maxZ + 0.45
  }))
];

export function ktxGroundSegmentClear(from: Vec2, to: Vec2): boolean {
  return !groundObstacles.some((box) =>
    segmentIntersectsAABB(from.x, from.z, to.x, to.z, box.minX, box.maxX, box.minZ, box.maxZ));
}

const groundCorners = groundObstacles.flatMap((box) =>
  [box.minX - 0.45, box.maxX + 0.45].flatMap((x) =>
    [box.minZ - 0.45, box.maxZ + 0.45].map((z) => ({ x, z }))))
  .filter((node) => node.x >= -67 && node.x <= 63 && node.z > 150.55 && node.z < 195 &&
    ktxGroundSegmentClear(node, node));
const groundLinks = groundCorners.map((from) => groundCorners
  .map((to, index) => ({ to, index }))
  .filter(({ to }) => to !== from && ktxGroundSegmentClear(from, to))
  .map(({ to, index }) => ({ index, length: Math.hypot(to.x - from.x, to.z - from.z) })));

export function ktxGroundDetour(from: Vec2, to: Vec2): Vec2[] {
  const distances = groundCorners.map((node) =>
    ktxGroundSegmentClear(from, node) ? Math.hypot(from.x - node.x, from.z - node.z) : Infinity);
  const previous = groundCorners.map(() => -1);
  const visited = new Set<number>();
  const reachesGoal = groundCorners.map((node) => ktxGroundSegmentClear(node, to));
  let best = Infinity;
  let end = -1;
  while (visited.size < groundCorners.length) {
    let next = -1;
    let distance = Infinity;
    for (let i = 0; i < distances.length; i++) {
      if (!visited.has(i) && distances[i] < distance) {
        distance = distances[i];
        next = i;
      }
    }
    if (next < 0 || distance >= best) break;
    visited.add(next);
    if (reachesGoal[next]) {
      const node = groundCorners[next];
      const total = distance + Math.hypot(to.x - node.x, to.z - node.z);
      if (total < best) {
        best = total;
        end = next;
      }
    }
    for (const link of groundLinks[next]) {
      if (distance + link.length >= distances[link.index]) continue;
      distances[link.index] = distance + link.length;
      previous[link.index] = next;
    }
  }
  const path: Vec2[] = [];
  for (let index = end; index >= 0; index = previous[index]) path.push(groundCorners[index]);
  return path.reverse();
}

export function ktxWaypoint(x: number, z: number, height: number, lane: KtxLane, docked: boolean,
  gateOpen: boolean, slot = 0): Vec2 & { label: string; direct?: boolean } {
  const at = (x: number, z: number, label: string) => ({ x, z, label });
  const gate = KTX_GATES[lane];
  const spread = (slot % 5 - 2) * 1.15;
  const surface = ktxSurfaceAt(x, z, height)?.id;
  switch (surface) {
    case 'east-lower': return { ...at(32 + spread, 178.6, 'KTX East Stair'), direct: true };
    case 'west-lower': return { ...at(-43 + spread, 178.6, 'KTX West Stair'), direct: true };
    case 'east-landing': return x < 40.5 ? at(43, 178.6, 'KTX East Landing') : at(44 + spread, 183, 'KTX East Stair');
    case 'west-landing': return x > -50.8 ? at(-53.5, 178.6, 'KTX West Landing') : at(-53.5 + spread, 183, 'KTX West Stair');
    case 'east-upper': return at(44 + spread, 192, 'KTX Platform');
    case 'west-upper': return at(-53.5 + spread, 192, 'KTX Platform');
    case 'terrace': return docked ? at(x, 191, 'KTX Boarding Queue') : at(12 + slot % 10, 183, 'KTX Platform');
    case 'platform':
      if (x <= KTX_TRANSFER_X + 1) {
        return x < KTX_TRANSFER_X - 1 && Math.abs(z - KTX_GATES.transfer.z) > 0.38
          ? at(Math.max(x + 1, KTX_TRANSFER_X - 3), KTX_GATES.transfer.z, 'KTX Service Platform')
          : at(KTX_TRANSFER_X + 2.1, KTX_GATES.transfer.z, 'KTX Service Partition');
      }
      if (!docked && slot % 2 === 0 && lane === 'public') {
        return x < 9 || x > 23.5 ? at(16.5, 190.4, 'KTX Platform') : at(x, 185, 'KTX Platform');
      }
      if (!docked) return at(TRAIN_BOARDING_X + (slot % 12 - 5) * 1.9, 190.3 + slot % 3, 'Wait on KTX Platform');
      if (Math.abs(x - TRAIN_BOARDING_X) > 0.95) return at(TRAIN_BOARDING_X, 192.1, 'KTX Boarding Queue');
      return at(TRAIN_BOARDING_X, 196, 'KTX Boarding Door');
    case 'boarding': return docked ? at(TRAIN_BOARDING_X, 196.5, 'KTX Boarding Door') : at(TRAIN_BOARDING_X, 192.1, 'Wait on KTX Platform');
    default:
      if (lane === 'public' && z < KTX_INTAKE_Z + 0.6) {
        const insideX = 27.9 + (slot % 5 - 2) * 1.05;
        if (z < KTX_INTAKE_Z - 0.7 && (x < 23.2 || x > 32.8)) return at(insideX, 153.3, 'KTX Intake');
        return at(insideX, 157.2, 'KTX Intake');
      }
      if (!gateOpen) {
        const west = slot % 2 === 1;
        const row = Math.floor(slot / 2) % 4;
        const x = (west ? 21.25 : 43) + (slot % 7) * (west ? 0.62 : 1.05);
        return at(x, (west ? [158, 159.9, 161.8, 163.65] : [158.1, 159.6, 163.35, 164.5])[row], 'KTX Holding Area');
      }
      if (z > 167.08 && height <= 0.05) {
        if (ktxUnderStair(x, z)) return { ...at(x, 177.2, 'KTX Ground Passage'), direct: true };
        return lane === 'public' ? at(27.9 + spread, 153.3, 'KTX Intake') : at(gate.x + spread, 162.5, gate.label);
      }
      if (Math.abs(x - gate.x) > gate.width / 2 - 0.85) return at(gate.x + spread, 162.5, gate.label);
      if (z < 165) return at(gate.x + spread, 165.6, gate.label);
      return { ...at(gate.x + spread, 170, gate.label), direct: true };
  }
}
