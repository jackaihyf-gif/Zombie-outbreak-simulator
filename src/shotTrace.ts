import { Box3, Ray, Vector3 } from 'three';
import type { CityLayout } from './cityData';
import { gateClearHalfWidth, WALL_DECK_OVERHANG, WALL_DECK_REAR_TRIM, WALL_DECK_RISE } from './perimeter';
import type { AgentData, BlastGateData, DefenseWallData, InteriorDoorData, VehicleData } from './types';

export type ShotSurface = 'dust' | 'metal' | 'infected';

export class ShotTrace {
  public readonly ray: Ray;
  public distance: number;
  public surface?: ShotSurface;
  public target: AgentData | null = null;
  private box = new Box3();
  private contact = new Vector3();
  private localRay = new Ray();

  constructor(x: number, y: number, z: number, yaw: number, pitch: number, range: number) {
    this.ray = new Ray(new Vector3(x, y, z), new Vector3(
      -Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)
    ));
    this.distance = range;
    if (this.ray.direction.y < 0) {
      const ground = (0.22 - y) / this.ray.direction.y;
      if (ground > 0 && ground < range) {
        this.distance = ground;
        this.surface = 'dust';
      }
    }
  }

  public testBox(
    minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number,
    surface: ShotSurface, target: AgentData | null = null, ray = this.ray
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
  }

  public testRotatedBox(x: number, z: number, width: number, depth: number, height: number, yaw: number): void {
    const dx = this.ray.origin.x - x;
    const dz = this.ray.origin.z - z;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const direction = this.ray.direction;
    this.localRay.origin.set(dx * cos - dz * sin, this.ray.origin.y, dx * sin + dz * cos);
    this.localRay.direction.set(direction.x * cos - direction.z * sin, direction.y, direction.x * sin + direction.z * cos);
    this.testBox(-width / 2, width / 2, 0.1, height, -depth / 2, depth / 2, 'metal', null, this.localRay);
  }

  public traceCity(
    city: CityLayout, walls: DefenseWallData[], gates: BlastGateData[],
    doors: InteriorDoorData[], vehicles: VehicleData[]
  ): void {
    const origin = this.ray.origin;
    const end = this.ray.at(this.distance, new Vector3());
    const minX = Math.min(origin.x, end.x);
    const maxX = Math.max(origin.x, end.x);
    const minZ = Math.min(origin.z, end.z);
    const maxZ = Math.max(origin.z, end.z);
    for (const b of city.getBuildingsInBox(minX, maxX, minZ, maxZ, [])) {
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
        this.testBox(left, right, wall.height, wall.height + WALL_DECK_RISE, frontEdge, rearEdge, 'dust');
      };
      const segments = gates.filter((gate) => gate.wallId === wall.id).sort((a, b) => a.x - b.x);
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
    for (const obstacle of city.getObstaclesNearPos((minX + maxX) / 2, (minZ + maxZ) / 2, [], reach)) {
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
  }
}
