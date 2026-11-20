import { CityLayout } from './cityData';
import {
  AgentData,
  BlastGateData,
  BuildingData,
  DefenseWallData,
  InteriorDoorData,
  StaticObstacleData,
  Vec2
} from './types';

export class SpatialGrid {
  private cellSize: number;
  private cells: Map<number, AgentData[]> = new Map();
  private activeBuckets: AgentData[][] = [];

  constructor(cellSize = 10) {
    this.cellSize = cellSize;
  }

  private hash(cx: number, cz: number): number {
    return ((cx + 512) << 12) | ((cz + 512) & 0xfff);
  }

  public clear(): void {
    for (let i = 0; i < this.activeBuckets.length; i++) {
      this.activeBuckets[i].length = 0;
    }
    this.activeBuckets.length = 0;
  }

  public insert(agent: AgentData): void {
    const cx = Math.floor(agent.x / this.cellSize);
    const cz = Math.floor(agent.z / this.cellSize);
    const key = this.hash(cx, cz);
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    if (bucket.length === 0) {
      this.activeBuckets.push(bucket);
    }
    bucket.push(agent);
  }

  public queryRadius(x: number, z: number, radius: number, out: AgentData[] = []): AgentData[] {
    out.length = 0;
    const rSq = radius * radius;
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCz = Math.floor((z - radius) / this.cellSize);
    const maxCz = Math.floor((z + radius) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.cells.get(this.hash(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const a = bucket[i];
          const dx = a.x - x;
          const dz = a.z - z;
          if (dx * dx + dz * dz <= rSq) {
            out.push(a);
          }
        }
      }
    }
    return out;
  }
}

const losScratch: BuildingData[] = [];
const colScratch: BuildingData[] = [];
const obsScratch: StaticObstacleData[] = [];

/**
 * Checks if segment (x1,z1)->(x2,z2) intersects an expanded 2D AABB
 */
export function segmentIntersectsAABB(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number
): boolean {
  let tmin = 0;
  let tmax = 1;
  const dx = x2 - x1;
  const dz = z2 - z1;

  if (Math.abs(dx) < 1e-6) {
    if (x1 < minX || x1 > maxX) return false;
  } else {
    const invD = 1 / dx;
    let t1 = (minX - x1) * invD;
    let t2 = (maxX - x1) * invD;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }

  if (Math.abs(dz) < 1e-6) {
    if (z1 < minZ || z1 > maxZ) return false;
  } else {
    const invD = 1 / dz;
    let t1 = (minZ - z1) * invD;
    let t2 = (maxZ - z1) * invD;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }

  return tmin <= tmax;
}

export function hasLineOfSight(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  city: CityLayout,
  walls: DefenseWallData[] = [],
  gates: BlastGateData[] = [],
  _interiorDoors: InteriorDoorData[] = []
): boolean {
  // Check tall solid defense walls first
  for (let wi = 0; wi < walls.length; wi++) {
    const w = walls[wi];
    const crosses =
      (z1 < w.z - 0.1 && z2 > w.z + 0.1) || (z2 < w.z - 0.1 && z1 > w.z + 0.1);
    if (crosses) {
      const t = (w.z - z1) / (z2 - z1);
      const ix = x1 + t * (x2 - x1);
      let throughOpenGate = false;
      for (let gi = 0; gi < gates.length; gi++) {
        const g = gates[gi];
        if (
          g.wallId === w.id &&
          (g.isOpen || g.breached) &&
          Math.abs(ix - g.x) <= g.width * 0.5
        ) {
          throughOpenGate = true;
          break;
        }
      }
      if (!throughOpenGate) return false;
    }
  }

  const segMinX = Math.min(x1, x2);
  const segMaxX = Math.max(x1, x2);
  const segMinZ = Math.min(z1, z2);
  const segMaxZ = Math.max(z1, z2);

  const buildings = city.getBuildingsInBox(segMinX, segMaxX, segMinZ, segMaxZ, losScratch);
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (b.maxX < segMinX || b.minX > segMaxX || b.maxZ < segMinZ || b.minZ > segMaxZ) {
      continue;
    }
    if (!b.interior) {
      if (
        segmentIntersectsAABB(
          x1,
          z1,
          x2,
          z2,
          b.minX + 0.2,
          b.maxX - 0.2,
          b.minZ + 0.2,
          b.maxZ - 0.2
        )
      ) {
        return false;
      }
    } else {
      for (let wi = 0; wi < b.interior.walls.length; wi++) {
        const w = b.interior.walls[wi];
        if (segmentIntersectsAABB(x1, z1, x2, z2, w.minX, w.maxX, w.minZ, w.maxZ)) {
          return false;
        }
      }
      for (let pi = 0; pi < b.interior.props.length; pi++) {
        const p = b.interior.props[pi];
        if (p.height >= 2.2 && segmentIntersectsAABB(x1, z1, x2, z2, p.minX, p.maxX, p.minZ, p.maxZ)) {
          return false;
        }
      }
    }
  }
  for (let i = 0; i < city.tallObstacles.length; i++) {
    const obs = city.tallObstacles[i];
    const r = obs.boundR ?? Math.max(obs.width, obs.depth) * 0.6;
    if (
      obs.x + r < segMinX ||
      obs.x - r > segMaxX ||
      obs.z + r < segMinZ ||
      obs.z - r > segMaxZ
    ) {
      continue;
    }
    const hw = obs.width * 0.5;
    const hd = obs.depth * 0.5;
    if (segmentIntersectsAABB(x1, z1, x2, z2, obs.x - hw, obs.x + hw, obs.z - hd, obs.z + hd)) {
      return false;
    }
  }
  return true;
}

function pushOutBox(
  pos: Vec2,
  radius: number,
  boxMinX: number,
  boxMaxX: number,
  boxMinZ: number,
  boxMaxZ: number
): void {
  const minX = boxMinX - radius;
  const maxX = boxMaxX + radius;
  const minZ = boxMinZ - radius;
  const maxZ = boxMaxZ + radius;

  if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ) {
    const dLeft = pos.x - minX;
    const dRight = maxX - pos.x;
    const dTop = pos.z - minZ;
    const dBottom = maxZ - pos.z;

    const minDist = Math.min(dLeft, dRight, dTop, dBottom);
    if (minDist === dLeft) pos.x = minX - 0.01;
    else if (minDist === dRight) pos.x = maxX + 0.01;
    else if (minDist === dTop) pos.z = minZ - 0.01;
    else pos.z = maxZ + 0.01;
  }
}

/**
 * Pushes position (x, z) out of nearby building footprints (or walkable 1st-floor interior walls/props/locked doors),
 * open river channels, static pileup obstacles / shipping containers, and closed defense walls.
 */
export function resolveWorldCollisions(
  pos: Vec2,
  radius: number,
  city: CityLayout,
  walls: DefenseWallData[] = [],
  gates: BlastGateData[] = [],
  climbY = 0,
  interiorDoors: InteriorDoorData[] = []
): void {
  const buildings = city.getBuildingsNearPos(pos.x, pos.z, colScratch, radius + 1.4);
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (!b.interior) {
      pushOutBox(pos, radius, b.minX, b.maxX, b.minZ, b.maxZ);
    } else if (
      pos.x >= b.minX - radius - 1.2 &&
      pos.x <= b.maxX + radius + 1.2 &&
      pos.z >= b.minZ - radius - 1.2 &&
      pos.z <= b.maxZ + radius + 1.2
    ) {
      for (let wi = 0; wi < b.interior.walls.length; wi++) {
        const w = b.interior.walls[wi];
        pushOutBox(pos, radius, w.minX, w.maxX, w.minZ, w.maxZ);
      }
      for (let pi = 0; pi < b.interior.props.length; pi++) {
        const p = b.interior.props[pi];
        pushOutBox(pos, radius, p.minX, p.maxX, p.minZ, p.maxZ);
      }
      for (let di = 0; di < interiorDoors.length; di++) {
        const door = interiorDoors[di];
        if (door.buildingId !== b.id || !door.isLocked || door.isBroken) continue;
        if (door.side === 'N' || door.side === 'S') {
          pushOutBox(
            pos,
            radius,
            door.x - door.width * 0.5,
            door.x + door.width * 0.5,
            door.z - 0.34,
            door.z + 0.34
          );
        } else {
          pushOutBox(
            pos,
            radius,
            door.x - 0.34,
            door.x + 0.34,
            door.z - door.width * 0.5,
            door.z + door.width * 0.5
          );
        }
      }
    }
  }

  // Push out of spatial static wrecked vehicles, jersey barriers, burning trucks & shipping containers (OBB)
  const nearObs = city.getObstaclesNearPos(pos.x, pos.z, obsScratch, radius + 0.8);
  for (let i = 0; i < nearObs.length; i++) {
    const obs = nearObs[i];
    const hw = obs.width * 0.5 + radius;
    const hd = obs.depth * 0.5 + radius;
    const dx = pos.x - obs.x;
    const dz = pos.z - obs.z;
    const rBound = (obs.boundR ?? Math.max(hw, hd) + 1.5) + radius;
    if (Math.abs(dx) > rBound || Math.abs(dz) > rBound) continue;

    const cosR = obs.cosR ?? Math.cos(obs.rotationY);
    const sinR = obs.sinR ?? Math.sin(obs.rotationY);
    const lx = dx * cosR - dz * sinR;
    const lz = dx * sinR + dz * cosR;

    if (Math.abs(lx) < hw && Math.abs(lz) < hd) {
      const penX = hw - Math.abs(lx);
      const penZ = hd - Math.abs(lz);
      let pushLx = 0;
      let pushLz = 0;
      if (penX < penZ) {
        pushLx = (lx >= 0 ? 1 : -1) * (penX + 0.02);
      } else {
        pushLz = (lz >= 0 ? 1 : -1) * (penZ + 0.02);
      }
      pos.x += pushLx * cosR + pushLz * sinR;
      pos.z += -pushLx * sinR + pushLz * cosR;
    }
  }

  for (let i = 0; i < city.rivers.length; i++) {
    const r = city.rivers[i];
    if (
      pos.x >= r.minX - radius &&
      pos.x <= r.maxX + radius &&
      pos.z > r.minZ - radius &&
      pos.z < r.maxZ + radius
    ) {
      let onBridge = false;
      for (let b = 0; b < city.bridges.length; b++) {
        const br = city.bridges[b];
        const halfDeck = br.width * 0.5 - radius;
        const dx = pos.x - br.x;
        if (Math.abs(dx) <= halfDeck) {
          onBridge = true;
          break;
        }
        if (pos.z > r.minZ && pos.z < r.maxZ && Math.abs(dx) <= br.width * 0.5 + 1.5) {
          pos.x = br.x + Math.sign(dx) * halfDeck;
          onBridge = true;
          break;
        }
      }

      if (!onBridge) {
        const distNorth = pos.z - (r.minZ - radius);
        const distSouth = r.maxZ + radius - pos.z;
        if (distNorth <= distSouth) {
          pos.z = r.minZ - radius - 0.02;
        } else {
          pos.z = r.maxZ + radius + 0.02;
        }
      }
    }
  }

  for (let wi = 0; wi < walls.length; wi++) {
    const w = walls[wi];
    const halfThick = w.thickness * 0.5 + radius;
    if (Math.abs(pos.z - w.z) < halfThick) {
      let canPassGate = false;
      for (let gi = 0; gi < gates.length; gi++) {
        const g = gates[gi];
        if (
          g.wallId === w.id &&
          (g.isOpen || g.breached) &&
          Math.abs(pos.x - g.x) <= g.width * 0.5 - radius
        ) {
          canPassGate = true;
          break;
        }
      }
      if (canPassGate || climbY >= w.height - 0.55) {
        continue;
      }

      if (pos.z <= w.z) {
        pos.z = w.z - halfThick - 0.01;
      } else {
        pos.z = w.z + halfThick + 0.01;
      }
    }
  }
}
