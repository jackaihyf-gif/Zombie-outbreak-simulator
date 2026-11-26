import { Box3, Ray, Vector3 } from 'three';
import type { CityLayout } from './cityData';
import { gateClearHalfWidth, WALL_DECK_OVERHANG, WALL_DECK_REAR_TRIM, WALL_DECK_RISE } from './perimeter';
import type {
  AgentData,
  BlastGateData,
  BuildingData,
  DefenseWallData,
  InteriorDoorData,
  StaticObstacleData,
  VehicleData
} from './types';

export type ShotSurface = 'dust' | 'metal' | 'infected';

export class ShotTrace {
  public readonly ray = new Ray(new Vector3(), new Vector3());
  public distance = 0;
  public surface?: ShotSurface;
  public target: AgentData | null = null;
  public hitHead = false;
  private box = new Box3();
  private contact = new Vector3();
  private localRay = new Ray();
  private endVec = new Vector3();
  private buildingBuf: BuildingData[] = [];
  private obstacleBuf: StaticObstacleData[] = [];
  private wallGateBuf: BlastGateData[] = [];

  constructor(x: number, y: number, z: number, yaw: number, pitch: number, range: number) {
    this.reset(x, y, z, yaw, pitch, range);
  }

  public reset(x: number, y: number, z: number, yaw: number, pitch: number, range: number): this {
    const cosPitch = Math.cos(pitch);
    this.ray.origin.set(x, y, z);
    this.ray.direction.set(-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch);
    this.distance = range;
    this.surface = undefined;
    this.target = null;
    this.hitHead = false;
    if (this.ray.direction.y < 0) {
      const ground = (0.22 - y) / this.ray.direction.y;
      if (ground > 0 && ground < range) {
        this.distance = ground;
        this.surface = 'dust';
      }
    }
    return this;
  }

  public testBox(
    minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number,
    surface: ShotSurface, target: AgentData | null = null, ray = this.ray, headshot = false
  ): void {
    if (minX >= maxX || minZ >= maxZ || minY >= maxY) return;
    this.box.min.set(minX, minY, minZ);
    this.box.max.set(maxX, maxY, maxZ);
    const contact = ray.intersectBox(this.box, this.contact);
    if (!contact) return;
    const distance = this.box.containsPoint(ray.origin) ? 0 : ray.origin.distanceTo(contact);
    if (distance >= this.distance) return;
    this.distance = distance;
    this.surface = surface;
    this.target = target;
    this.hitHead = headshot;
  }

  public testRotatedBox(x: number, z: number, width: number, depth: number, height: number, yaw: number): boolean {
    const prevDist = this.distance;
    const dx = this.ray.origin.x - x;
    const dz = this.ray.origin.z - z;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const direction = this.ray.direction;
    this.localRay.origin.set(dx * cos - dz * sin, this.ray.origin.y, dx * sin + dz * cos);
    this.localRay.direction.set(direction.x * cos - direction.z * sin, direction.y, direction.x * sin + direction.z * cos);
    this.testBox(-width / 2, width / 2, 0.1, height, -depth / 2, depth / 2, 'metal', null, this.localRay);
    return this.distance < prevDist;
  }

  public traceCity(
    city: CityLayout, walls: DefenseWallData[], gates: BlastGateData[],
    doors: InteriorDoorData[], vehicles: VehicleData[], ignoreWallDeckId?: number,
    gatesByWall?: Map<number, BlastGateData[]>
  ): void {
    const origin = this.ray.origin;
    const end = this.ray.at(this.distance, this.endVec);
    const minX = Math.min(origin.x, end.x);
    const maxX = Math.max(origin.x, end.x);
    const minZ = Math.min(origin.z, end.z);
    const maxZ = Math.max(origin.z, end.z);
    this.buildingBuf.length = 0;
    for (const b of city.getBuildingsInBox(minX, maxX, minZ, maxZ, this.buildingBuf)) {
      if (b.interior) {
        const ceiling = b.interior.floorHeight;
        this.testBox(b.minX, b.maxX, ceiling, b.height, b.minZ, b.maxZ, 'dust');
        for (const wall of b.interior.walls) {
          this.testBox(wall.minX, wall.maxX, 0, wall.height, wall.minZ, wall.maxZ, 'dust');
        }
        for (const prop of b.interior.props) {
          this.testBox(prop.minX, prop.maxX, 0, prop.height, prop.minZ, prop.maxZ, 'dust');
        }
      } else {
        this.testBox(b.minX, b.maxX, 0, b.height, b.minZ, b.maxZ, 'dust');
      }
    }
    for (const door of doors) {
      if (!door.isLocked || door.isBroken) continue;
      const acrossX = door.side === 'N' || door.side === 'S';
      const halfX = acrossX ? door.width / 2 : 0.1;
      const halfZ = acrossX ? 0.1 : door.width / 2;
      this.testBox(door.x - halfX, door.x + halfX, 0.2, 2.8, door.z - halfZ, door.z + halfZ, 'metal');
    }
    for (const wall of walls) {
      const half = wall.thickness / 2;
      const frontEdge = wall.z - half - WALL_DECK_OVERHANG;
      const rearEdge = wall.z + half + WALL_DECK_REAR_TRIM;
      if (rearEdge < minZ || frontEdge > maxZ) continue;
      const testWallSegment = (left: number, right: number) => {
        this.testBox(left, right, 0, wall.height, wall.z - half, wall.z + half, 'dust');
        if (wall.id !== ignoreWallDeckId) {
          this.testBox(left, right, wall.height, wall.height + WALL_DECK_RISE, frontEdge, rearEdge, 'dust');
        }
      };
      let segments = gatesByWall?.get(wall.id);
      if (!segments) {
        this.wallGateBuf.length = 0;
        for (let i = 0; i < gates.length; i++) {
          if (gates[i].wallId === wall.id) this.wallGateBuf.push(gates[i]);
        }
        if (this.wallGateBuf.length > 1) {
          this.wallGateBuf.sort((a, b) => a.x - b.x);
        }
        segments = this.wallGateBuf;
      }
      let start = wall.minX;
      for (const gate of segments) {
        const left = gate.x - gate.width / 2;
        const right = gate.x + gate.width / 2;
        testWallSegment(start, left);
        const gap = gateClearHalfWidth(gate);
        this.testBox(left, gate.x - gap, 0, wall.height - 0.2, wall.z - 0.46, wall.z + 0.46, 'metal');
        this.testBox(gate.x + gap, right, 0, wall.height - 0.2, wall.z - 0.46, wall.z + 0.46, 'metal');
        this.testBox(left, right, wall.height + 0.12, wall.height + 1.6, wall.z - half, wall.z + half, 'dust');
        start = right;
      }
      testWallSegment(start, wall.maxX);
    }
    const reach = Math.max(maxX - minX, maxZ - minZ) * 0.5 + 1;
    this.obstacleBuf.length = 0;
    for (const obstacle of city.getObstaclesNearPos((minX + maxX) / 2, (minZ + maxZ) / 2, this.obstacleBuf, reach)) {
      this.testRotatedBox(obstacle.x, obstacle.z, obstacle.width, obstacle.depth, obstacle.height, obstacle.rotationY);
    }
    for (const vehicle of vehicles) {
      if (vehicle.x < minX - 6 || vehicle.x > maxX + 6 || vehicle.z < minZ - 6 || vehicle.z > maxZ + 6) continue;
      const truck = vehicle.type === 'truck';
      const van = vehicle.type === 'van' || vehicle.type === 'ambulance';
      const yaw = Math.atan2(vehicle.dirX, vehicle.dirZ);
      const height = truck ? 2.28 : van ? 1.76 : 1.42;
      this.testRotatedBox(vehicle.x, vehicle.z, truck ? 2.18 : 1.84, truck ? 6.2 : 3.8, height, yaw);
    }
    for (const pod of city.labPods) {
      if (pod.x < minX - 2 || pod.x > maxX + 2 || pod.z < minZ - 2 || pod.z > maxZ + 2) continue;
      this.testBox(pod.x - 1.25, pod.x + 1.25, 0, 4.2, pod.z - 1.25, pod.z + 1.25, 'metal');
    }
    if (city.labReactorCore) {
      const rc = city.labReactorCore;
      if (rc.x + rc.radius >= minX && rc.x - rc.radius <= maxX && rc.z + rc.radius >= minZ && rc.z - rc.radius <= maxZ) {
        this.testBox(rc.x - rc.radius, rc.x + rc.radius, 0, 8.4, rc.z - rc.radius, rc.z + rc.radius, 'metal');
      }
    }
  }
}
