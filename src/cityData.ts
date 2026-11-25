import {
  BlastGateData,
  BridgeSpan,
  BuildingData,
  BuildingInteriorData,
  DefenseWallData,
  ExplosiveHazardData,
  InteriorBox,
  InteriorDoorData,
  MapId,
  NavNode,
  OverpassData,
  ParkingLotFeature,
  RiverChannel,
  RoadblockData,
  SkybridgeData,
  StaticObstacleData,
  Vec2,
  WayfindingSignData
} from './types';
import { SeededRNG } from './rng';
import { KTX_LAST_LINE_Z } from './ktxTerminal';
import { WALL_BUILDING_CLEARANCE } from './perimeter';
import { segmentIntersectsAABB } from './spatial';

export const BLOCK_PITCH = 32; // distance between road centerlines for standard grid maps
export const ROAD_WIDTH = 8.0;
export const SIDEWALK_OFFSET = 5.3; // offset from road centerline to sidewalk centerline
const SPATIAL_CELL_SIZE = 32;

export interface ParkFeature {
  x: number;
  z: number;
  width: number;
  depth: number;
  kind?: 'park' | 'stadium_plaza';
}

export interface TreeData {
  x: number;
  z: number;
  scale: number;
  variant: number;
}

export interface StreetLampData {
  x: number;
  z: number;
  rotationY: number;
}

export interface WallDefinition {
  z: number;
  height: number;
  thickness: number;
  label: string;
  layerIndex: number;
  gateXs: number[];
}

export class CityLayout {
  public mapId: MapId;
  public gridBlocks: number;
  public cityHalfSize: number;
  public cityHalfX: number;
  public cityHalfZ: number;
  public roadCoords: number[] = [];
  public roadXs: number[] = [];
  public roadZs: number[] = [];

  public buildings: BuildingData[] = [];
  public navNodes: NavNode[] = [];
  public trees: TreeData[] = [];
  public lamps: StreetLampData[] = [];
  public rivers: RiverChannel[] = [];
  public bridges: BridgeSpan[] = [];
  public plazas: ParkFeature[] = [];
  public parkingLots: ParkingLotFeature[] = [];
  public staticObstacles: StaticObstacleData[] = [];
  public interiorDoors: InteriorDoorData[] = [];
  public evacSpawnPoints: Vec2[] = [];
  public occupiedBlockKeys = new Set<string>();
  public overpasses: OverpassData[] = [];
  public skybridges: SkybridgeData[] = [];
  public explosiveHazards: ExplosiveHazardData[] = [];
  public wayfindingSigns: WayfindingSignData[] = [];
  public highwayZone: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  public terminalPlaza: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

  public hasExpressRail = false;
  public railZ = 80;
  public railTracksZ: number[] = [];
  public stationPos: Vec2 = { x: 0, z: 80 };
  public wallDefs: WallDefinition[] = [];

  public centralPark: ParkFeature = { x: 0, z: 0, width: 21, depth: 21, kind: 'park' };
  public precinctPos: Vec2 = { x: 0, z: -32 };
  public hospitalPos: Vec2 = { x: -32, z: 0 };

  public buildingById: Map<string, BuildingData> = new Map();
  public tallObstacles: StaticObstacleData[] = [];
  private nodeMap: Map<string, number> = new Map();
  private spatialCells: BuildingData[][][] = [];
  private obstacleCells: StaticObstacleData[][][] = [];
  private navCells: NavNode[][][] = [];
  private spatialCols = 0;
  private spatialRows = 0;

  // Pre-allocated A* scratch buffers for zero-allocation pathfinding
  private gScore!: Float32Array;
  private fScore!: Float32Array;
  private cameFrom!: Int32Array;
  private seenStamp!: Uint32Array;
  private closedStamp!: Uint32Array;
  private openList: number[] = [];
  private searchStamp = 1;

  constructor(seed = 'METRO-2026', mapId: MapId = 'citadel_express') {
    this.mapId = mapId;

    if (mapId === 'citadel_express') {
      this.gridBlocks = 7;
      this.cityHalfX = 126; // 252m wide
      this.cityHalfZ = 228; // 456m deep elongated metropolis!
      this.cityHalfSize = 228;
      this.roadXs = [-126, -92, -52, -16, 26, 68, 98, 126];
      this.roadZs = [-228, -172, -118, -80, -42, -8, 20, 48, 88, 128, KTX_LAST_LINE_Z, 200, 228];
      this.roadCoords = this.roadXs;
    } else {
      this.gridBlocks = mapId === 'quarantine_citadel' ? 5 : 7;
      this.cityHalfSize = (this.gridBlocks * BLOCK_PITCH) / 2;
      this.cityHalfX = this.cityHalfSize;
      this.cityHalfZ = this.cityHalfSize;
      for (let i = 0; i <= this.gridBlocks; i++) {
        const c = -this.cityHalfSize + i * BLOCK_PITCH;
        this.roadCoords.push(c);
        this.roadXs.push(c);
        this.roadZs.push(c);
      }
    }

    this.spatialCols = Math.ceil((this.cityHalfX * 2 + 8) / SPATIAL_CELL_SIZE);
    this.spatialRows = Math.ceil((this.cityHalfZ * 2 + 8) / SPATIAL_CELL_SIZE);
    for (let r = 0; r < this.spatialRows; r++) {
      const rowArr: BuildingData[][] = [];
      const obsRow: StaticObstacleData[][] = [];
      const navRow: NavNode[][] = [];
      for (let c = 0; c < this.spatialCols; c++) {
        rowArr.push([]);
        obsRow.push([]);
        navRow.push([]);
      }
      this.spatialCells.push(rowArr);
      this.obstacleCells.push(obsRow);
      this.navCells.push(navRow);
    }

    const rng = new SeededRNG(`${seed}-${mapId}-CITY`);
    if (mapId === 'citadel_express') {
      this.buildOrganicCitadelExpress(rng);
      this.buildOrganicNavigationGraph();
    } else {
      this.buildBlocks(rng);
      this.buildNavigationGraph();
    }
    this.initPathfinderBuffers();
    this.buildStreetFurniture(rng);
  }

  public getDistrictName(row: number, col: number): string {
    if (this.mapId === 'citadel_express') {
      if (row <= 1) return 'Sector 1 • Outer Highway';
      if (row === 3 && col === 3) return 'Midtown Park';
      if (row <= 3) return 'Sector 2 • Midtown Buffer';
      if (row === 4 && col === 3) return 'Police Precinct';
      if (row === 4 && col === 2) return 'St. Jude Medical';
      if (row === 5 && col === 3) return 'Express Concourse';
      if (row === 6) return 'South Rail Depot';
      return 'Sector 3 • Citadel Safe Zone';
    }

    if (this.mapId === 'grand_metropolis') {
      if (row === 3 && col === 3) return 'Grand Memorial Park';
      if (row === 3 && col === 4) return 'Civic Stadium Plaza';
      if (row === 2 && col === 3) return 'Police Precinct';
      if (row === 3 && col === 2) return 'St. Jude Medical';
      if (row >= 2 && row <= 4 && col >= 2 && col <= 4) return 'Downtown Skyscrapers';
      if (row === 5 && col >= 1 && col <= 5) return 'Midtown Shopping';
      if (col === 6 && row >= 1 && col <= 5) return 'Eastside Industrial';
      if (row === 0) return 'Northside Heights';
      if (row === 6) return 'Southview District';
      if (col === 0) return 'Westgate Quarters';
      return 'Metro Suburbs';
    }

    if (this.mapId === 'twin_bridges') {
      if (row === 3) return 'Metro River Canal';
      if (row === 4 && col === 3) return 'Police Precinct';
      if (row === 4 && col === 2) return 'St. Jude Medical';
      if (row === 5 && col === 3) return 'South Memorial Park';
      if (row <= 2) {
        if (row >= 1 && col >= 2 && col <= 4) return 'North Downtown';
        if (row === 2 && (col === 1 || col === 5)) return 'North Waterfront';
        return 'Northside Heights';
      }
      if (row === 4 && col >= 4) return 'South Harbor Market';
      return 'South Safe Zone';
    }

    // quarantine_citadel (5x5)
    if (row === 2 && col === 2) return 'Memorial Park';
    if (row === 1 && col === 2) return 'Police Precinct';
    if (row === 2 && col === 1) return 'St. Jude Medical';
    if (row >= 1 && row <= 3 && col >= 1 && col <= 3) return 'Neon Downtown';
    if (row === 0) return 'North Citadel';
    if (row === 4) return 'South Citadel';
    if (col === 0) return 'West Citadel';
    return 'East Citadel';
  }

  public getDistrictAtPos(x: number, z: number): string {
    if (this.mapId === 'citadel_express') {
      if (z < -118) {
        return x >= -18 && x <= 82
          ? 'Sector 1 • North Highway Pileup'
          : 'Sector 1 • West Boulevard';
      }
      if (z < 48) {
        if (z >= 18 && x >= -16) return 'Sector 2 • Midtown Canal';
        if (x >= 28 && x <= 96) return 'Sector 2 • Midtown Parking & Shops';
        return 'Sector 2 • Commercial Canyon';
      }
      if (z < KTX_LAST_LINE_Z) {
        if (x >= -14 && x <= 24 && z >= 88 && z <= 128) return 'Sector 3 • Police Precinct';
        return 'Sector 3 • Inner Residential';
      }
      return 'Line 3 • KTX Express Terminal';
    }

    const col = Math.max(
      0,
      Math.min(this.gridBlocks - 1, Math.floor((x + this.cityHalfSize) / BLOCK_PITCH))
    );
    const row = Math.max(
      0,
      Math.min(this.gridBlocks - 1, Math.floor((z + this.cityHalfSize) / BLOCK_PITCH))
    );
    return this.getDistrictName(row, col);
  }

  public isPointInOpenWater(x: number, z: number, pad = 0): boolean {
    for (let i = 0; i < this.rivers.length; i++) {
      const r = this.rivers[i];
      if (x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad) {
        let onBridge = false;
        for (let b = 0; b < this.bridges.length; b++) {
          const br = this.bridges[b];
          if (Math.abs(x - br.x) <= br.width * 0.5 - pad) {
            onBridge = true;
            break;
          }
        }
        if (!onBridge) return true;
      }
    }
    return false;
  }

  private segmentCrossesWater(x1: number, z1: number, x2: number, z2: number): boolean {
    const minZ = Math.min(z1, z2);
    const maxZ = Math.max(z1, z2);
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    for (let i = 0; i < this.rivers.length; i++) {
      const r = this.rivers[i];
      if (maxX >= r.minX && minX <= r.maxX && maxZ > r.minZ && minZ < r.maxZ) {
        let onSameBridge = false;
        for (let b = 0; b < this.bridges.length; b++) {
          const br = this.bridges[b];
          if (
            Math.abs(x1 - br.x) <= br.width * 0.5 &&
            Math.abs(x2 - br.x) <= br.width * 0.5
          ) {
            onSameBridge = true;
            break;
          }
        }
        if (!onSameBridge) return true;
      }
    }
    return false;
  }

  private addParkTrees(cx: number, cz: number, rng: SeededRNG): void {
    const parkOffsets = [
      [-7.5, -7.5],
      [7.5, -7.5],
      [-7.5, 7.5],
      [7.5, 7.5],
      [-8.2, 0],
      [8.2, 0],
      [0, -8.2],
      [0, 8.2],
      [-4.5, -5.5],
      [5.0, 4.5]
    ];
    for (const [ox, oz] of parkOffsets) {
      this.trees.push({
        x: cx + ox,
        z: cz + oz,
        scale: rng.range(0.9, 1.35),
        variant: rng.int(0, 2)
      });
    }
  }

  private buildBlocks(rng: SeededRNG): void {
    let bIndex = 1;

    if (this.mapId === 'citadel_express') {
      this.wallDefs = [
        {
          z: -48,
          height: 7.8,
          thickness: 2.4,
          label: 'Defense Line 1 • Outer Citadel Wall',
          layerIndex: 1,
          gateXs: [-48, 48]
        },
        {
          z: 16,
          height: 7.8,
          thickness: 2.4,
          label: 'Defense Line 2 • Inner Citadel Wall',
          layerIndex: 2,
          gateXs: [-48, 48]
        }
      ];
      this.hasExpressRail = true;
      this.railZ = 80;
      this.stationPos = { x: 0, z: 80 };
      this.evacSpawnPoints = [];
    } else if (this.mapId === 'twin_bridges') {
      this.wallDefs = [
        {
          z: -18,
          height: 7.6,
          thickness: 2.4,
          label: 'Line 1 • North Bridgehead Wall',
          layerIndex: 1,
          gateXs: [-48, 48]
        },
        {
          z: 18,
          height: 7.6,
          thickness: 2.4,
          label: 'Line 2 • South Bridgehead Wall',
          layerIndex: 2,
          gateXs: [-48, 48]
        }
      ];
      this.rivers.push({ minX: -130, maxX: 130, minZ: -11.5, maxZ: 11.5 });
      this.bridges.push(
        { x: -48, z: 0, width: 13.0, length: 32, axis: 'z', name: 'West Twin Bridge' },
        { x: 48, z: 0, width: 13.0, length: 32, axis: 'z', name: 'East Twin Bridge' }
      );
      this.evacSpawnPoints = [{ x: 0, z: this.cityHalfSize - 2.5 }];
    } else if (this.mapId === 'grand_metropolis') {
      this.evacSpawnPoints = [
        { x: 0, z: this.cityHalfSize - 2.5 },
        { x: 0, z: -(this.cityHalfSize - 2.5) }
      ];
    } else {
      this.evacSpawnPoints = [{ x: 0, z: this.cityHalfSize - 2.5 }];
    }

    for (let row = 0; row < this.gridBlocks; row++) {
      for (let col = 0; col < this.gridBlocks; col++) {
        if (this.mapId === 'twin_bridges' && row === 3) {
          continue;
        }

        const cx = -this.cityHalfSize + col * BLOCK_PITCH + BLOCK_PITCH / 2;
        const cz = -this.cityHalfSize + row * BLOCK_PITCH + BLOCK_PITCH / 2;
        const district = this.getDistrictName(row, col);

        // 1. Memorial Park
        const isPark =
          (this.mapId === 'citadel_express' && row === 3 && col === 3) ||
          (this.mapId === 'grand_metropolis' && row === 3 && col === 3) ||
          (this.mapId === 'twin_bridges' && row === 5 && col === 3) ||
          (this.mapId === 'quarantine_citadel' && row === 2 && col === 2);
        if (isPark) {
          this.centralPark = { x: cx, z: cz, width: 21, depth: 21, kind: 'park' };
          this.addParkTrees(cx, cz, rng);
          continue;
        }

        // 2. Open Civic / Express Concourse Plazas
        const isStadiumPlaza = this.mapId === 'grand_metropolis' && row === 3 && col === 4;
        const isExpressConcourse = this.mapId === 'citadel_express' && row === 5 && col === 3;
        if (isStadiumPlaza || isExpressConcourse) {
          this.plazas.push({
            x: cx,
            z: cz,
            width: 21,
            depth: 21,
            kind: 'stadium_plaza'
          });
          for (const [ox, oz] of [
            [-8.4, -8.4],
            [8.4, -8.4],
            [-8.4, 8.4],
            [8.4, 8.4]
          ]) {
            this.trees.push({
              x: cx + ox,
              z: cz + oz,
              scale: 1.05,
              variant: rng.int(0, 2)
            });
          }
          continue;
        }

        // 3. Metro Police Precinct HQ
        const isPrecinct =
          (this.mapId === 'citadel_express' && row === 4 && col === 3) ||
          (this.mapId === 'grand_metropolis' && row === 2 && col === 3) ||
          (this.mapId === 'twin_bridges' && row === 4 && col === 3) ||
          (this.mapId === 'quarantine_citadel' && row === 1 && col === 2);
        if (isPrecinct) {
          this.precinctPos = { x: cx, z: cz + 11.5 };
          this.addBuilding({
            id: 'BLD-HQ',
            name: 'Metro Police Precinct HQ',
            district,
            blockRow: row,
            blockCol: col,
            x: cx,
            z: cz,
            width: 17.5,
            depth: 16.5,
            height: 16.5,
            doorSide: 'S',
            color: 0x1e3a5f,
            accentColor: 0x38bdf8,
            roofType: 'helipad',
            isShelterCapable: true,
            shelterCapacity: 40
          });
          continue;
        }

        // 4. St. Jude Medical Center
        const isHospital =
          (this.mapId === 'citadel_express' && row === 4 && col === 2) ||
          (this.mapId === 'grand_metropolis' && row === 3 && col === 2) ||
          (this.mapId === 'twin_bridges' && row === 4 && col === 2) ||
          (this.mapId === 'quarantine_citadel' && row === 2 && col === 1);
        if (isHospital) {
          this.hospitalPos = { x: cx + 11.5, z: cz };
          this.addBuilding({
            id: 'BLD-HOSP',
            name: 'St. Jude Medical Center',
            district,
            blockRow: row,
            blockCol: col,
            x: cx,
            z: cz,
            width: 18.0,
            depth: 17.5,
            height: 19.0,
            doorSide: 'E',
            color: 0xe2e8f0,
            accentColor: 0xef4444,
            roofType: 'hospital',
            isShelterCapable: true,
            shelterCapacity: 45
          });
          continue;
        }

        // 5. Downtown Skyscrapers (also in Citadel Express Midtown Buffer cols 2..4)
        const isSkyscraperBlock =
          district === 'Downtown Skyscrapers' ||
          district === 'North Downtown' ||
          district === 'Neon Downtown' ||
          (this.mapId === 'citadel_express' &&
            (row === 2 || row === 3) &&
            col >= 2 &&
            col <= 4);

        if (isSkyscraperBlock) {
          const minH = this.mapId === 'quarantine_citadel' ? 32 : 30;
          const maxH = this.mapId === 'quarantine_citadel' ? 50 : 54;
          const splitX = rng.chance(0.5);
          if (splitX) {
            this.addBuilding({
              id: `BLD-${bIndex++}`,
              name: `Apex Skyscraper ${bIndex}`,
              district,
              blockRow: row,
              blockCol: col,
              x: cx - 4.8,
              z: cz,
              width: 8.6,
              depth: 17.2,
              height: rng.range(minH, maxH),
              doorSide: 'W',
              color: rng.pick([0x283548, 0x1e293b, 0x26384d, 0x334155]),
              accentColor: rng.pick([0x38bdf8, 0x7dd3fc, 0xfbbf24]),
              roofType: 'skyscraper',
              isShelterCapable: true,
              shelterCapacity: 28
            });
            this.addBuilding({
              id: `BLD-${bIndex++}`,
              name: `Nexus Tower ${bIndex}`,
              district,
              blockRow: row,
              blockCol: col,
              x: cx + 4.8,
              z: cz,
              width: 8.6,
              depth: 17.2,
              height: rng.range(minH - 6, maxH - 6),
              doorSide: 'E',
              color: rng.pick([0x3b4d63, 0x273549, 0x334155]),
              accentColor: rng.pick([0x38bdf8, 0xfde047]),
              roofType: 'tower',
              isShelterCapable: true,
              shelterCapacity: 24
            });
          } else {
            this.addBuilding({
              id: `BLD-${bIndex++}`,
              name: `Metropolis Spire ${bIndex}`,
              district,
              blockRow: row,
              blockCol: col,
              x: cx,
              z: cz - 4.8,
              width: 17.2,
              depth: 8.6,
              height: rng.range(minH, maxH),
              doorSide: 'N',
              color: rng.pick([0x1f2d3d, 0x293548, 0x334155]),
              accentColor: 0x38bdf8,
              roofType: 'skyscraper',
              isShelterCapable: true,
              shelterCapacity: 28
            });
            this.addBuilding({
              id: `BLD-${bIndex++}`,
              name: `Skyline Plaza ${bIndex}`,
              district,
              blockRow: row,
              blockCol: col,
              x: cx,
              z: cz + 4.8,
              width: 17.2,
              depth: 8.6,
              height: rng.range(minH - 8, maxH - 8),
              doorSide: 'S',
              color: rng.pick([0x3f4e63, 0x2c3a4e]),
              accentColor: 0x93c5fd,
              roofType: 'tower',
              isShelterCapable: true,
              shelterCapacity: 22
            });
          }
          continue;
        }

        // 6. Industrial Warehouses / South Rail Depot
        if (district === 'Eastside Industrial' || district === 'South Rail Depot') {
          this.addBuilding({
            id: `BLD-${bIndex++}`,
            name: `Logistics Depot #${bIndex}`,
            district,
            blockRow: row,
            blockCol: col,
            x: cx,
            z: cz - 4.8,
            width: 17.5,
            depth: 8.4,
            height: rng.range(7.0, 9.5),
            doorSide: 'N',
            color: rng.pick([0x475569, 0x52525b, 0x3f3f46]),
            accentColor: 0xf97316,
            roofType: 'warehouse',
            isShelterCapable: true,
            shelterCapacity: 22
          });
          this.addBuilding({
            id: `BLD-${bIndex++}`,
            name: `Freight Terminal #${bIndex}`,
            district,
            blockRow: row,
            blockCol: col,
            x: cx,
            z: cz + 4.8,
            width: 17.5,
            depth: 8.4,
            height: rng.range(6.5, 9.0),
            doorSide: 'S',
            color: rng.pick([0x334155, 0x52525b, 0x4b5563]),
            accentColor: 0xeab308,
            roofType: 'warehouse',
            isShelterCapable: true,
            shelterCapacity: 20
          });
          continue;
        }

        // 7. Commercial Shopping / Waterfront Storefronts
        if (
          district === 'Midtown Shopping' ||
          district === 'North Waterfront' ||
          district === 'South Harbor Market' ||
          (this.mapId === 'citadel_express' && row === 1 && col >= 1 && col <= 5)
        ) {
          const shopColors = [0x9a4e36, 0x4b5563, 0x7c5a43, 0x374151, 0x6b4c3b];
          const awningColors = [0xf59e0b, 0x10b981, 0x3b82f6, 0xec4899, 0xef4444];
          const quadrants: Array<{
            ox: number;
            oz: number;
            side: 'N' | 'S' | 'E' | 'W';
            label: string;
          }> = [
            { ox: -4.8, oz: -4.8, side: 'N', label: 'Grand Market' },
            { ox: 4.8, oz: -4.8, side: 'E', label: 'Metro Cafe' },
            { ox: -4.8, oz: 4.8, side: 'W', label: 'City Pharmacy' },
            { ox: 4.8, oz: 4.8, side: 'S', label: 'Arcade & Books' }
          ];
          for (const q of quadrants) {
            this.addBuilding({
              id: `BLD-${bIndex++}`,
              name: `${q.label} #${bIndex}`,
              district,
              blockRow: row,
              blockCol: col,
              x: cx + q.ox,
              z: cz + q.oz,
              width: 8.2,
              depth: 8.2,
              height: rng.range(8.0, 14.0),
              doorSide: q.side,
              color: rng.pick(shopColors),
              accentColor: rng.pick(awningColors),
              roofType: 'flat',
              isShelterCapable: true,
              shelterCapacity: 14
            });
          }
          continue;
        }

        // 8. Residential Neighborhoods
        const resColors = [0x8c5843, 0x6e7b8b, 0x9e7256, 0x735145, 0x7f6e5d, 0x5c6b73];
        const roofColors = [0x3e2723, 0x475569, 0x5d4037, 0x334155];
        const subPlots: Array<{
          ox: number;
          oz: number;
          w: number;
          d: number;
          side: 'N' | 'S' | 'E' | 'W';
        }> = [
          { ox: -4.9, oz: -4.9, w: 8.0, d: 7.8, side: 'N' },
          { ox: 4.9, oz: -4.9, w: 8.0, d: 7.8, side: 'E' },
          { ox: -4.9, oz: 4.9, w: 8.0, d: 7.8, side: 'W' },
          { ox: 4.9, oz: 4.9, w: 8.0, d: 7.8, side: 'S' }
        ];

        for (let s = 0; s < subPlots.length; s++) {
          if (s === 3 && rng.chance(0.42)) {
            this.trees.push({
              x: cx + subPlots[s].ox - 1.5,
              z: cz + subPlots[s].oz - 1.5,
              scale: rng.range(0.85, 1.25),
              variant: rng.int(0, 2)
            });
            this.trees.push({
              x: cx + subPlots[s].ox + 1.8,
              z: cz + subPlots[s].oz + 1.5,
              scale: rng.range(0.8, 1.15),
              variant: rng.int(0, 2)
            });
            continue;
          }
          const sp = subPlots[s];
          const isApt = rng.chance(0.5);
          this.addBuilding({
            id: `BLD-${bIndex++}`,
            name: isApt
              ? `${district.split(' ')[0]} Apartments #${bIndex}`
              : `${district.split(' ')[0]} Residence #${bIndex}`,
            district,
            blockRow: row,
            blockCol: col,
            x: cx + sp.ox,
            z: cz + sp.oz,
            width: sp.w,
            depth: sp.d,
            height: isApt ? rng.range(10.5, 16.5) : rng.range(5.8, 8.6),
            doorSide: sp.side,
            color: rng.pick(resColors),
            accentColor: rng.pick(roofColors),
            roofType: isApt ? 'flat' : 'pitched',
            isShelterCapable: true,
            shelterCapacity: isApt ? 16 : 10
          });
        }

        this.trees.push({
          x: cx,
          z: cz,
          scale: rng.range(0.8, 1.1),
          variant: rng.int(0, 2)
        });
      }
    }

    if (this.mapId === 'twin_bridges') {
      const twinWrecks: Array<[number, number, number, 'car' | 'taxi' | 'jersey_barrier']> = [
        [-45.0, -40.0, 0.2, 'taxi'],
        [45.0, -40.0, -0.22, 'car'],
        [-51.8, 39.0, 0.14, 'jersey_barrier'],
        [51.8, 39.0, -0.14, 'jersey_barrier']
      ];
      for (const [ox, oz, rot, kind] of twinWrecks) {
        this.addObstacle({
          x: ox,
          z: oz,
          width: kind === 'jersey_barrier' ? 2.4 : 1.85,
          depth: kind === 'jersey_barrier' ? 0.75 : 3.7,
          height: kind === 'jersey_barrier' ? 1.0 : 1.32,
          rotationY: rot,
          kind,
          color: kind === 'taxi' ? 0xeab308 : kind === 'jersey_barrier' ? 0x64748b : 0x475569
        });
      }

      this.addExplosiveHazard({
        kind: 'fuel_truck',
        x: -51.4,
        z: -29.0,
        rotationY: 0.16,
        label: 'West Bridgehead Fuel Tanker'
      });
      this.addExplosiveHazard({
        kind: 'fuel_barrel',
        x: -45.6,
        z: -26.5,
        rotationY: 0.3,
        label: 'West Bridgehead Hazard Drums'
      });
      this.addExplosiveHazard({
        kind: 'fuel_truck',
        x: 51.4,
        z: -29.0,
        rotationY: -0.16,
        label: 'East Bridgehead Fuel Tanker'
      });
      this.addExplosiveHazard({
        kind: 'fuel_barrel',
        x: 45.6,
        z: -26.5,
        rotationY: -0.3,
        label: 'East Bridgehead Hazard Drums'
      });
      this.addExplosiveHazard({
        kind: 'fuel_barrel',
        x: -51.2,
        z: -4.0,
        rotationY: 0.1,
        label: 'West Bridge Deck Fuel Drums'
      });
      this.addExplosiveHazard({
        kind: 'fuel_barrel',
        x: 51.2,
        z: -4.0,
        rotationY: -0.1,
        label: 'East Bridge Deck Fuel Drums'
      });
      this.addExplosiveHazard({
        kind: 'fuel_truck',
        x: -51.2,
        z: 30.0,
        rotationY: -0.12,
        label: 'South West Approach Tanker'
      });
      this.addExplosiveHazard({
        kind: 'fuel_truck',
        x: 51.2,
        z: 30.0,
        rotationY: 0.12,
        label: 'South East Approach Tanker'
      });

      this.wayfindingSigns.push(
        {
          x: -48,
          z: -33,
          y: 6.2,
          width: 7.4,
          height: 1.9,
          rotationY: 0,
          title: 'WEST TWIN BRIDGE ↓',
          subtitle: 'LINE 1 NORTH BRIDGEHEAD',
          accentColor: '#38bdf8',
          gantrySpan: 12.6
        },
        {
          x: 48,
          z: -33,
          y: 6.2,
          width: 7.4,
          height: 1.9,
          rotationY: 0,
          title: 'EAST TWIN BRIDGE ↓',
          subtitle: 'LINE 1 NORTH BRIDGEHEAD',
          accentColor: '#38bdf8',
          gantrySpan: 12.6
        },
        {
          x: -48,
          z: 27,
          y: 6.2,
          width: 7.4,
          height: 1.9,
          rotationY: 0,
          title: 'LINE 2 SOUTH GATE ↓',
          subtitle: 'SOUTH SAFE ZONE & PRECINCT',
          accentColor: '#22c55e',
          gantrySpan: 12.6
        },
        {
          x: 48,
          z: 27,
          y: 6.2,
          width: 7.4,
          height: 1.9,
          rotationY: 0,
          title: 'LINE 2 SOUTH GATE ↓',
          subtitle: 'SOUTH HARBOR EVAC ROUTE',
          accentColor: '#22c55e',
          gantrySpan: 12.6
        }
      );
    } else if (this.mapId === 'grand_metropolis') {
      this.addExplosiveHazard({
        kind: 'fuel_truck',
        x: -45.5,
        z: -28,
        rotationY: 0.15,
        label: 'West Downtown Fuel Tanker'
      });
      this.addExplosiveHazard({
        kind: 'fuel_barrel',
        x: -49.5,
        z: -25,
        rotationY: 0.4,
        label: 'West Downtown Fuel Drums'
      });
      this.addExplosiveHazard({
        kind: 'fuel_truck',
        x: 45.5,
        z: -28,
        rotationY: -0.15,
        label: 'East Downtown Fuel Tanker'
      });
      this.addExplosiveHazard({
        kind: 'fuel_truck',
        x: -18.5,
        z: 36,
        rotationY: 0.1,
        label: 'Midtown South Fuel Tanker'
      });
      this.addExplosiveHazard({
        kind: 'fuel_barrel',
        x: 18.5,
        z: 36,
        rotationY: -0.25,
        label: 'Midtown Plaza Hazard Drums'
      });
    } else if (this.mapId === 'quarantine_citadel') {
      this.addExplosiveHazard({
        kind: 'fuel_truck',
        x: -18.5,
        z: -30,
        rotationY: 0.12,
        label: 'North West Quarantine Tanker'
      });
      this.addExplosiveHazard({
        kind: 'fuel_barrel',
        x: 18.5,
        z: -30,
        rotationY: 0.2,
        label: 'North East Hazard Drums'
      });
      this.addExplosiveHazard({
        kind: 'fuel_truck',
        x: 18.5,
        z: 30,
        rotationY: -0.12,
        label: 'South East Quarantine Tanker'
      });
      this.addExplosiveHazard({
        kind: 'fuel_barrel',
        x: -18.5,
        z: 30,
        rotationY: -0.2,
        label: 'South West Hazard Drums'
      });
    }
  }

  private addBuilding(params: {
    id: string;
    name: string;
    district: string;
    blockRow: number;
    blockCol: number;
    x: number;
    z: number;
    width: number;
    depth: number;
    height: number;
    doorSide: 'N' | 'S' | 'E' | 'W';
    color: number;
    accentColor: number;
    roofType: BuildingData['roofType'];
    isShelterCapable: boolean;
    shelterCapacity: number;
  }): BuildingData {
    const hw = params.width / 2;
    const hd = params.depth / 2;
    let doorX = params.x;
    let doorZ = params.z;

    if (params.doorSide === 'N') doorZ = params.z - hd - 1.1;
    else if (params.doorSide === 'S') doorZ = params.z + hd + 1.1;
    else if (params.doorSide === 'W') doorX = params.x - hw - 1.1;
    else if (params.doorSide === 'E') doorX = params.x + hw + 1.1;

    const bld: BuildingData = {
      id: params.id,
      name: params.name,
      district: params.district,
      blockRow: params.blockRow,
      blockCol: params.blockCol,
      x: params.x,
      z: params.z,
      width: params.width,
      depth: params.depth,
      height: params.height,
      minX: params.x - hw,
      maxX: params.x + hw,
      minZ: params.z - hd,
      maxZ: params.z + hd,
      doorX,
      doorZ,
      color: params.color,
      accentColor: params.accentColor,
      roofType: params.roofType,
      isShelterCapable: params.isShelterCapable,
      shelterCapacity: params.shelterCapacity,
      shelteredAgentIds: [],
      doorIntegrity: 100,
      maxDoorIntegrity: 100
    };

    this.buildings.push(bld);
    this.buildingById.set(bld.id, bld);

    const maxCellC = Math.max(0, this.spatialCols - 1);
    const maxCellR = Math.max(0, this.spatialRows - 1);
    const minC = Math.max(
      0,
      Math.min(maxCellC, Math.floor((bld.minX + this.cityHalfX) / SPATIAL_CELL_SIZE))
    );
    const maxC = Math.max(
      0,
      Math.min(maxCellC, Math.floor((bld.maxX + this.cityHalfX) / SPATIAL_CELL_SIZE))
    );
    const minR = Math.max(
      0,
      Math.min(maxCellR, Math.floor((bld.minZ + this.cityHalfZ) / SPATIAL_CELL_SIZE))
    );
    const maxR = Math.max(
      0,
      Math.min(maxCellR, Math.floor((bld.maxZ + this.cityHalfZ) / SPATIAL_CELL_SIZE))
    );
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        this.spatialCells[r][c].push(bld);
      }
    }
    return bld;
  }

  private configureWalkableInterior(
    b: BuildingData,
    theme: BuildingInteriorData['theme'],
    doorsSpec: Array<{
      side: 'N' | 'S' | 'E' | 'W';
      offset: number;
      width: number;
      isGlass: boolean;
      label: string;
    }>,
    props: InteriorBox[],
    lightFixtures: Array<{ x: number; z: number; flickerSeed: number }>
  ): void {
    const floorHeight = 4.0;
    const t = 0.55;
    const walls: InteriorBox[] = [];
    const doorIds: number[] = [];

    const doorsBySide: Record<'N' | 'S' | 'E' | 'W', typeof doorsSpec> = {
      N: [],
      S: [],
      E: [],
      W: []
    };

    for (const ds of doorsSpec) {
      doorsBySide[ds.side].push(ds);
      const id = this.interiorDoors.length + 1;
      doorIds.push(id);
      const dx =
        ds.side === 'W'
          ? b.minX + t * 0.5
          : ds.side === 'E'
          ? b.maxX - t * 0.5
          : b.x + ds.offset;
      const dz =
        ds.side === 'N'
          ? b.minZ + t * 0.5
          : ds.side === 'S'
          ? b.maxZ - t * 0.5
          : b.z + ds.offset;
      this.interiorDoors.push({
        id,
        buildingId: b.id,
        label: ds.label,
        side: ds.side,
        x: dx,
        z: dz,
        width: ds.width,
        isGlass: ds.isGlass,
        isLocked: false,
        isBroken: false,
        integrity: 100,
        maxIntegrity: 100,
        lastHitTime: -10
      });
    }

    const splitWallAxis = (
      side: 'N' | 'S' | 'E' | 'W',
      spanMin: number,
      spanMax: number,
      centerBase: number
    ) => {
      const list = doorsBySide[side]
        .map((d) => ({
          start: centerBase + d.offset - d.width * 0.5,
          end: centerBase + d.offset + d.width * 0.5
        }))
        .sort((a, b) => a.start - b.start);

      let cursor = spanMin;
      const segments: Array<[number, number]> = [];
      for (const cut of list) {
        if (cut.start > cursor + 0.15) {
          segments.push([cursor, Math.min(spanMax, cut.start)]);
        }
        cursor = Math.max(cursor, cut.end);
      }
      if (cursor < spanMax - 0.15) {
        segments.push([cursor, spanMax]);
      }

      for (const [s0, s1] of segments) {
        if (side === 'N') {
          walls.push({ minX: s0, maxX: s1, minZ: b.minZ, maxZ: b.minZ + t, height: floorHeight, kind: 'wall' });
        } else if (side === 'S') {
          walls.push({ minX: s0, maxX: s1, minZ: b.maxZ - t, maxZ: b.maxZ, height: floorHeight, kind: 'wall' });
        } else if (side === 'W') {
          walls.push({ minX: b.minX, maxX: b.minX + t, minZ: s0, maxZ: s1, height: floorHeight, kind: 'wall' });
        } else {
          walls.push({ minX: b.maxX - t, maxX: b.maxX, minZ: s0, maxZ: s1, height: floorHeight, kind: 'wall' });
        }
      }
    };

    splitWallAxis('N', b.minX, b.maxX, b.x);
    splitWallAxis('S', b.minX, b.maxX, b.x);
    splitWallAxis('W', b.minZ + t, b.maxZ - t, b.z);
    splitWallAxis('E', b.minZ + t, b.maxZ - t, b.z);

    b.interior = {
      theme,
      floorHeight,
      walls,
      props,
      doorIds,
      lightFixtures
    };
  }

  public getBuildingsNearPos(
    x: number,
    z: number,
    out: BuildingData[],
    margin = 2.2
  ): BuildingData[] {
    out.length = 0;
    const minC = Math.max(
      0,
      Math.min(this.spatialCols - 1, Math.floor((x - margin + this.cityHalfX) / SPATIAL_CELL_SIZE))
    );
    const maxC = Math.max(
      0,
      Math.min(this.spatialCols - 1, Math.floor((x + margin + this.cityHalfX) / SPATIAL_CELL_SIZE))
    );
    const minR = Math.max(
      0,
      Math.min(this.spatialRows - 1, Math.floor((z - margin + this.cityHalfZ) / SPATIAL_CELL_SIZE))
    );
    const maxR = Math.max(
      0,
      Math.min(this.spatialRows - 1, Math.floor((z + margin + this.cityHalfZ) / SPATIAL_CELL_SIZE))
    );

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const list = this.spatialCells[r][c];
        for (let i = 0; i < list.length; i++) {
          out.push(list[i]);
        }
      }
    }
    return out;
  }

  public getBuildingsInBox(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    out: BuildingData[]
  ): BuildingData[] {
    out.length = 0;
    const minC = Math.max(0, Math.floor((minX + this.cityHalfX) / SPATIAL_CELL_SIZE));
    const maxC = Math.min(
      this.spatialCols - 1,
      Math.floor((maxX + this.cityHalfX) / SPATIAL_CELL_SIZE)
    );
    const minR = Math.max(0, Math.floor((minZ + this.cityHalfZ) / SPATIAL_CELL_SIZE));
    const maxR = Math.min(
      this.spatialRows - 1,
      Math.floor((maxZ + this.cityHalfZ) / SPATIAL_CELL_SIZE)
    );

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const list = this.spatialCells[r][c];
        for (let i = 0; i < list.length; i++) {
          out.push(list[i]);
        }
      }
    }
    return out;
  }

  public getObstaclesNearPos(
    x: number,
    z: number,
    out: StaticObstacleData[],
    margin = 1.6
  ): StaticObstacleData[] {
    out.length = 0;
    const minC = Math.max(
      0,
      Math.min(this.spatialCols - 1, Math.floor((x - margin + this.cityHalfX) / SPATIAL_CELL_SIZE))
    );
    const maxC = Math.max(
      0,
      Math.min(this.spatialCols - 1, Math.floor((x + margin + this.cityHalfX) / SPATIAL_CELL_SIZE))
    );
    const minR = Math.max(
      0,
      Math.min(this.spatialRows - 1, Math.floor((z - margin + this.cityHalfZ) / SPATIAL_CELL_SIZE))
    );
    const maxR = Math.max(
      0,
      Math.min(this.spatialRows - 1, Math.floor((z + margin + this.cityHalfZ) / SPATIAL_CELL_SIZE))
    );

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const list = this.obstacleCells[r][c];
        for (let i = 0; i < list.length; i++) {
          out.push(list[i]);
        }
      }
    }
    return out;
  }

  private addObstacle(obs: Omit<StaticObstacleData, 'id'>): void {
    const cosR = Math.cos(obs.rotationY);
    const sinR = Math.sin(obs.rotationY);
    const boundR = Math.hypot(obs.width * 0.5, obs.depth * 0.5) + 0.25;
    const fullObs: StaticObstacleData = {
      id: this.staticObstacles.length + 1,
      ...obs,
      cosR,
      sinR,
      boundR
    };
    this.staticObstacles.push(fullObs);
    if (fullObs.height >= 2.2) {
      this.tallObstacles.push(fullObs);
    }
    const maxCellC = Math.max(0, this.spatialCols - 1);
    const maxCellR = Math.max(0, this.spatialRows - 1);
    const minC = Math.max(
      0,
      Math.min(maxCellC, Math.floor((obs.x - boundR + this.cityHalfX) / SPATIAL_CELL_SIZE))
    );
    const maxC = Math.max(
      0,
      Math.min(maxCellC, Math.floor((obs.x + boundR + this.cityHalfX) / SPATIAL_CELL_SIZE))
    );
    const minR = Math.max(
      0,
      Math.min(maxCellR, Math.floor((obs.z - boundR + this.cityHalfZ) / SPATIAL_CELL_SIZE))
    );
    const maxR = Math.max(
      0,
      Math.min(maxCellR, Math.floor((obs.z + boundR + this.cityHalfZ) / SPATIAL_CELL_SIZE))
    );
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        this.obstacleCells[r][c].push(fullObs);
      }
    }
  }

  private addExplosiveHazard(params: {
    kind: 'fuel_truck' | 'fuel_barrel';
    x: number;
    z: number;
    rotationY: number;
    label: string;
  }): void {
    const isTruck = params.kind === 'fuel_truck';
    const width = isTruck ? 2.35 : 1.5;
    const depth = isTruck ? 6.2 : 1.5;
    const height = isTruck ? 2.6 : 1.35;
    const hp = isTruck ? 90 : 40;
    const cosR = Math.cos(params.rotationY);
    const sinR = Math.sin(params.rotationY);
    this.explosiveHazards.push({
      id: this.explosiveHazards.length + 1,
      kind: params.kind,
      x: params.x,
      z: params.z,
      width,
      depth,
      height,
      rotationY: params.rotationY,
      hp,
      maxHp: hp,
      blastRadius: isTruck ? 13.5 : 9.0,
      damage: isTruck ? 340 : 240,
      detonated: false,
      burningTimer: 0,
      label: params.label,
      cosR,
      sinR,
      boundR: Math.hypot(width * 0.5, depth * 0.5) + 0.25
    });
  }

  private addParkingLotVehicles(
    lotX: number,
    lotZ: number,
    lotW: number,
    lotD: number,
    orientation: 'NS' | 'EW',
    rng: SeededRNG
  ): void {
    this.parkingLots.push({ x: lotX, z: lotZ, width: lotW, depth: lotD, orientation });
    const palette = [0x64748b, 0x3b82f6, 0x991b1b, 0x475569, 0x334155, 0x713f12, 0xe2e8f0];
    if (orientation === 'EW') {
      for (const rz of [lotZ - lotD * 0.28, lotZ + lotD * 0.28]) {
        for (let px = lotX - lotW * 0.36; px <= lotX + lotW * 0.36; px += 4.6) {
          if (rng.chance(0.28)) continue;
          const isTaxi = rng.chance(0.2);
          this.addObstacle({
            x: px + rng.range(-0.2, 0.2),
            z: rz,
            width: 1.85,
            depth: 3.7,
            height: 1.25,
            rotationY: (rz < lotZ ? 0 : Math.PI) + rng.range(-0.12, 0.12),
            kind: isTaxi ? 'taxi' : 'car',
            color: isTaxi ? 0xeab308 : rng.pick(palette)
          });
        }
      }
    } else {
      for (const rx of [lotX - lotW * 0.26, lotX + lotW * 0.26]) {
        for (let pz = lotZ - lotD * 0.36; pz <= lotZ + lotD * 0.36; pz += 4.6) {
          if (rng.chance(0.26)) continue;
          const isTaxi = rng.chance(0.22);
          this.addObstacle({
            x: rx,
            z: pz + rng.range(-0.2, 0.2),
            width: 1.85,
            depth: 3.7,
            height: 1.25,
            rotationY: (rx < lotX ? Math.PI / 2 : -Math.PI / 2) + rng.range(-0.12, 0.12),
            kind: isTaxi ? 'taxi' : 'car',
            color: isTaxi ? 0xeab308 : rng.pick(palette)
          });
        }
      }
    }
  }

  private buildOrganicCitadelExpress(rng: SeededRNG): void {
    let bIndex = 1;

    // 1. Three Distinct Progressive Defense Lines spaced ~166m and ~120m apart (456m deep city)
    this.wallDefs = [
      {
        z: -118,
        height: 8.4,
        thickness: 2.6,
        label: 'Defense Line 1 • Outer Highway Quarantine Wall',
        layerIndex: 1,
        gateXs: [-52, 26]
      },
      {
        z: 48,
        height: 8.0,
        thickness: 2.4,
        label: 'Defense Line 2 • Midtown Canal & Container Barricade',
        layerIndex: 2,
        gateXs: [-52, 26]
      },
      {
        z: KTX_LAST_LINE_Z,
        height: 8.2,
        thickness: 2.6,
        label: 'Defense Line 3 • KTX Terminal Last Perimeter',
        layerIndex: 3,
        gateXs: [-52, 26]
      }
    ];

    // 2. Express Rail Dual Tracks & South Station Concourse
    this.hasExpressRail = true;
    this.railZ = 196;
    this.railTracksZ = [196, 204];
    this.stationPos = { x: 0, z: 196 };
    this.highwayZone = { minX: -18, maxX: 82, minZ: -228, maxZ: -119 };
    this.terminalPlaza = { minX: -116, maxX: 116, minZ: KTX_LAST_LINE_Z + 1, maxZ: 222 };
    this.evacSpawnPoints = [];

    // 3. Midtown Concrete Canal dividing east/midtown + 2 Fortified Bridges (West Blvd x=-52 stays dry)
    this.rivers.push({ minX: -16, maxX: 132, minZ: 22, maxZ: 45 });
    this.bridges.push(
      { x: 26, z: 33.5, width: 12.5, length: 26, axis: 'z', name: 'Midtown Canal Bridge' },
      { x: 68, z: 33.5, width: 11.5, length: 26, axis: 'z', name: 'East Canal Bridge' }
    );

    const brickColors = [0x8c4b39, 0x734234, 0x965742, 0x6b4539];
    const concreteColors = [0x4b5563, 0x3b4454, 0x525d70, 0x374151];
    const towerColors = [0x1e293b, 0x263548, 0x1b2638, 0x334155];

    const addSkyscraperPair = (
      col: number,
      row: number,
      cx: number,
      cz: number,
      w: number,
      d: number
    ) => {
      this.occupiedBlockKeys.add(`${row}:${col}`);
      this.addBuilding({
        id: `BLD-${bIndex++}`,
        name: `Metro Tower ${bIndex}`,
        district: 'Downtown Skyscrapers',
        blockRow: row,
        blockCol: col,
        x: cx,
        z: cz - d * 0.24,
        width: w * 0.85,
        depth: d * 0.42,
        height: rng.range(34, 56),
        doorSide: 'E',
        color: rng.pick(towerColors),
        accentColor: rng.pick([0x38bdf8, 0xfbbf24, 0x7dd3fc]),
        roofType: 'skyscraper',
        isShelterCapable: true,
        shelterCapacity: 28
      });
      this.addBuilding({
        id: `BLD-${bIndex++}`,
        name: `Civic Highrise ${bIndex}`,
        district: 'Downtown Skyscrapers',
        blockRow: row,
        blockCol: col,
        x: cx,
        z: cz + d * 0.24,
        width: w * 0.85,
        depth: d * 0.40,
        height: rng.range(24, 42),
        doorSide: 'S',
        color: rng.pick(concreteColors),
        accentColor: 0x38bdf8,
        roofType: 'tower',
        isShelterCapable: true,
        shelterCapacity: 22
      });
    };

    // Helper for irregular L-shaped / Alley-split blocks instead of monotonous 2x2 grids
    const populateOrganicBlock = (
      row: number,
      col: number,
      x0: number,
      x1: number,
      z0: number,
      z1: number,
      district: string,
      pattern: 'L_CORNER' | 'ALLEY_PAIR' | 'COURTYARD' | 'INDUSTRIAL'
    ) => {
      this.occupiedBlockKeys.add(`${row}:${col}`);
      const cx = (x0 + x1) * 0.5;
      const cz = (z0 + z1) * 0.5;
      const usableW = x1 - x0 - ROAD_WIDTH - 3.6;
      const usableD = z1 - z0 - ROAD_WIDTH - 3.6;
      if (usableW < 8 || usableD < 8) return;

      if (pattern === 'INDUSTRIAL') {
        this.addBuilding({
          id: `BLD-${bIndex++}`,
          name: `East Logistics Depot #${bIndex}`,
          district,
          blockRow: row,
          blockCol: col,
          x: cx,
          z: cz,
          width: usableW * 0.88,
          depth: usableD * 0.72,
          height: rng.range(7.5, 10.5),
          doorSide: 'W',
          color: rng.pick(concreteColors),
          accentColor: 0x334155,
          roofType: 'warehouse',
          isShelterCapable: true,
          shelterCapacity: 24
        });
      } else if (pattern === 'L_CORNER') {
        const flipX = (row + col) % 2 === 0 ? -1 : 1;
        // Main wing + perpendicular wing leaving an open corner yard
        const w1 = usableW * 0.88;
        const d1 = Math.min(11.5, usableD * 0.42);
        this.addBuilding({
          id: `BLD-${bIndex++}`,
          name: `Corner Block ${bIndex}`,
          district,
          blockRow: row,
          blockCol: col,
          x: cx,
          z: cz - usableD * 0.26,
          width: w1,
          depth: d1,
          height: rng.range(9, 16),
          doorSide: 'S',
          color: rng.pick(brickColors),
          accentColor: 0x1e293b,
          roofType: 'flat',
          isShelterCapable: true,
          shelterCapacity: 18
        });
        const w2 = Math.min(11.5, usableW * 0.42);
        const d2 = usableD * 0.48;
        this.addBuilding({
          id: `BLD-${bIndex++}`,
          name: `Side Annex ${bIndex}`,
          district,
          blockRow: row,
          blockCol: col,
          x: cx + flipX * (usableW * 0.23),
          z: cz + usableD * 0.22,
          width: w2,
          depth: d2,
          height: rng.range(7, 12),
          doorSide: flipX > 0 ? 'W' : 'E',
          color: rng.pick(concreteColors),
          accentColor: 0x334155,
          roofType: 'flat',
          isShelterCapable: true,
          shelterCapacity: 14
        });
        this.trees.push({
          x: cx - flipX * (usableW * 0.25),
          z: cz + usableD * 0.22,
          scale: 1.05,
          variant: rng.int(0, 2)
        });
      } else if (pattern === 'ALLEY_PAIR') {
        // Two parallel tenement rows split by a narrow 4.6m walkable brick alley!
        const stripD = Math.max(7.5, (usableD - 5.2) * 0.48);
        const offZ = stripD * 0.5 + 2.4;
        this.addBuilding({
          id: `BLD-${bIndex++}`,
          name: `Alley Tenement N-${bIndex}`,
          district,
          blockRow: row,
          blockCol: col,
          x: cx,
          z: cz - offZ,
          width: usableW * 0.9,
          depth: stripD,
          height: rng.range(9.5, 15.5),
          doorSide: 'N',
          color: rng.pick(brickColors),
          accentColor: 0x334155,
          roofType: 'flat',
          isShelterCapable: true,
          shelterCapacity: 16
        });
        this.addBuilding({
          id: `BLD-${bIndex++}`,
          name: `Alley Tenement S-${bIndex}`,
          district,
          blockRow: row,
          blockCol: col,
          x: cx,
          z: cz + offZ,
          width: usableW * 0.9,
          depth: stripD,
          height: rng.range(8.0, 13.0),
          doorSide: 'W',
          color: rng.pick(concreteColors),
          accentColor: 0x475569,
          roofType: 'flat',
          isShelterCapable: true,
          shelterCapacity: 14
        });
      } else {
        // Courtyard shops with open landscaped interior
        const subW = usableW * 0.40;
        const subD = usableD * 0.38;
        this.addBuilding({
          id: `BLD-${bIndex++}`,
          name: `Brick Market ${bIndex}`,
          district,
          blockRow: row,
          blockCol: col,
          x: cx - usableW * 0.24,
          z: cz - usableD * 0.24,
          width: subW,
          depth: subD,
          height: rng.range(8.5, 13.5),
          doorSide: 'W',
          color: rng.pick(brickColors),
          accentColor: 0x475569,
          roofType: 'flat',
          isShelterCapable: true,
          shelterCapacity: 14
        });
        this.addBuilding({
          id: `BLD-${bIndex++}`,
          name: `Corner Pharmacy ${bIndex}`,
          district,
          blockRow: row,
          blockCol: col,
          x: cx + usableW * 0.24,
          z: cz + usableD * 0.22,
          width: subW,
          depth: subD,
          height: rng.range(11, 18),
          doorSide: 'E',
          color: rng.pick(concreteColors),
          accentColor: 0x38bdf8,
          roofType: 'tower',
          isShelterCapable: true,
          shelterCapacity: 16
        });
        this.trees.push({ x: cx + usableW * 0.2, z: cz - usableD * 0.22, scale: 1.0, variant: 1 });
      }
    };

    // Walk every irregular cell roadZs[r]..roadZs[r+1], roadXs[c]..roadXs[c+1]
    for (let r = 0; r < this.roadZs.length - 1; r++) {
      const z0 = this.roadZs[r];
      const z1 = this.roadZs[r + 1];
      const northWall = this.wallDefs.find((wall) => wall.z === z0);
      const southWall = this.wallDefs.find((wall) => wall.z === z1);
      const parcelZ0 = northWall ? z0 + northWall.thickness / 2 + WALL_BUILDING_CLEARANCE : z0;
      const parcelZ1 = southWall ? z1 - southWall.thickness / 2 - WALL_BUILDING_CLEARANCE : z1;
      const cz = (parcelZ0 + parcelZ1) * 0.5;
      const cellD = parcelZ1 - parcelZ0;

      for (let c = 0; c < this.roadXs.length - 1; c++) {
        const x0 = this.roadXs[c];
        const x1 = this.roadXs[c + 1];
        const cx = (x0 + x1) * 0.5;
        const cellW = x1 - x0;

        // Leave the South Rail Terminal Plaza open beyond the final defense line.
        if (z0 >= KTX_LAST_LINE_Z) {
          continue;
        }

        // Midtown Canal strip (z0 === 20, z1 === 48) west side only gets buildings (east is canal!)
        if (z0 === 20 && x1 > -16) {
          continue;
        }

        // Open Northern Multi-Lane Highway (x in [-16, 68], z < -118) has NO buildings!
        if (z1 <= -118 && x0 >= -18 && x1 <= 70) {
          continue;
        }

        // Sector 1 Iconic First-Person Approach Flanks (z = -228..-118)
        if (z1 <= -118) {
          if (c === 0) {
            // West background skyscrapers framing the sunset skyline
            addSkyscraperPair(c, r, cx, cz, cellW - ROAD_WIDTH - 2, cellD - ROAD_WIDTH - 4);
            continue;
          }
          if (c === 1) {
            // West of x = -52 Boulevard (Screen-Right when facing South!):
            this.occupiedBlockKeys.add(`${r}:${c}`);
            if (r === 1) {
              // Surface Parking Lot right along West Boulevard (-72, -148)
              this.addParkingLotVehicles(-72, -146, 23, 28, 'NS', rng);
              // Concrete shop north corner
              this.addBuilding({
                id: `BLD-${bIndex++}`,
                name: 'Westgate Motor Shop',
                district: 'Sector 1 • West Boulevard',
                blockRow: r,
                blockCol: c,
                x: -72,
                z: -165,
                width: 22,
                depth: 9.5,
                height: 11.5,
                doorSide: 'E',
                color: 0x4b5563,
                accentColor: 0x334155,
                roofType: 'flat',
                isShelterCapable: true,
                shelterCapacity: 14
              });
            } else {
              this.addBuilding({
                id: `BLD-${bIndex++}`,
                name: 'Boulevard Plaza North',
                district: 'Sector 1 • West Boulevard',
                blockRow: r,
                blockCol: c,
                x: cx,
                z: cz,
                width: 24,
                depth: 32,
                height: 17,
                doorSide: 'E',
                color: 0x3b4454,
                accentColor: 0x38bdf8,
                roofType: 'tower',
                isShelterCapable: true,
                shelterCapacity: 24
              });
            }
            continue;
          }
          if (c === 2) {
            // Screen-Left facing x = -52 Boulevard: Brick Shops with narrow dumpster alley!
            this.occupiedBlockKeys.add(`${r}:${c}`);
            if (r === 1) {
              const mart = this.addBuilding({
                id: `BLD-${bIndex++}`,
                name: '24H Avenue Mart',
                district: 'Sector 1 • West Boulevard',
                blockRow: r,
                blockCol: c,
                x: -34,
                z: -158,
                width: 19,
                depth: 13.5,
                height: 11.2,
                doorSide: 'W',
                color: 0x8c4b39,
                accentColor: 0x16a34a,
                roofType: 'flat',
                isShelterCapable: true,
                shelterCapacity: 16
              });
              this.configureWalkableInterior(
                mart,
                'mart',
                [
                  {
                    side: 'W',
                    offset: 0,
                    width: 3.4,
                    isGlass: true,
                    label: '24H Mart Front Glass Door'
                  },
                  {
                    side: 'S',
                    offset: 3.0,
                    width: 3.0,
                    isGlass: false,
                    label: '24H Mart Alley Exit Door'
                  }
                ],
                [
                  { minX: -41.4, maxX: -39.6, minZ: -163.3, maxZ: -160.2, height: 1.15, kind: 'counter' },
                  { minX: -37.2, maxX: -29.5, minZ: -160.4, maxZ: -159.4, height: 1.95, kind: 'shelf' },
                  { minX: -37.2, maxX: -29.5, minZ: -155.8, maxZ: -154.8, height: 1.95, kind: 'shelf' },
                  { minX: -26.3, maxX: -25.1, minZ: -162.8, maxZ: -153.5, height: 2.45, kind: 'cooler' }
                ],
                [
                  { x: -38, z: -158, flickerSeed: 0.7 },
                  { x: -32, z: -161.5, flickerSeed: 2.3 },
                  { x: -31, z: -154, flickerSeed: 4.1 }
                ]
              );
              // Keep the clinic and its walkable alley outside the wall clearance.
              const clinic = this.addBuilding({
                id: `BLD-${bIndex++}`,
                name: 'Northgate Brick Clinic',
                district: 'Sector 1 • West Boulevard',
                blockRow: r,
                blockCol: c,
                x: -34,
                z: -138.5,
                width: 19,
                depth: 14.0,
                height: 13.8,
                doorSide: 'W',
                color: 0x734234,
                accentColor: 0x38bdf8,
                roofType: 'flat',
                isShelterCapable: true,
                shelterCapacity: 18
              });
              this.configureWalkableInterior(
                clinic,
                'clinic',
                [
                  {
                    side: 'W',
                    offset: 0,
                    width: 3.2,
                    isGlass: true,
                    label: 'Clinic Front Glass Door'
                  },
                  {
                    side: 'N',
                    offset: 3.0,
                    width: 3.0,
                    isGlass: false,
                    label: 'Clinic North Alley Door'
                  },
                  {
                    side: 'S',
                    offset: -2.0,
                    width: 3.0,
                    isGlass: false,
                    label: 'Clinic South Exit Door'
                  }
                ],
                [
                  { minX: -39.5, maxX: -36.5, minZ: -142.7, maxZ: -141.6, height: 1.15, kind: 'counter' },
                  { minX: -39.5, maxX: -35.8, minZ: -135.7, maxZ: -134.8, height: 0.72, kind: 'bench' },
                  { minX: -28.2, maxX: -25.5, minZ: -143, maxZ: -141.3, height: 0.85, kind: 'bed' },
                  { minX: -28.2, maxX: -25.5, minZ: -136.7, maxZ: -135, height: 0.85, kind: 'bed' }
                ],
                [
                  { x: -38, z: -138.5, flickerSeed: 1.5 },
                  { x: -30, z: -141.5, flickerSeed: 3.2 },
                  { x: -30, z: -135, flickerSeed: 5.0 }
                ]
              );
            } else {
              populateOrganicBlock(r, c, x0, x1, parcelZ0, parcelZ1, 'Sector 1 • Outer Boulevard', 'ALLEY_PAIR');
            }
            continue;
          }
          if (c >= 5) {
            populateOrganicBlock(r, c, x0, x1, parcelZ0, parcelZ1, 'Sector 1 • East Freight', 'INDUSTRIAL');
          }
          continue;
        }

        // Sector 2 Special Civic & Parking Blocks (z = -118..48)
        if (r === 2 && c === 1) {
          // Midtown Pocket Park (-72, -99)
          this.occupiedBlockKeys.add(`${r}:${c}`);
          this.centralPark = { x: cx, z: cz, width: 24, depth: 22, kind: 'park' };
          this.addParkTrees(cx, cz, rng);
          continue;
        }

        if ((r === 3 || r === 4) && (c === 4 || c === 5)) {
          // East Midtown Surface Parking Lots (z = -80..-8, x = 26..98)
          this.occupiedBlockKeys.add(`${r}:${c}`);
          if (c === 4) {
            this.addParkingLotVehicles(
              cx,
              cz,
              cellW - ROAD_WIDTH - 4,
              cellD - ROAD_WIDTH - 4,
              'EW',
              rng
            );
          } else {
            populateOrganicBlock(r, c, x0, x1, parcelZ0, parcelZ1, 'Sector 2 • East Commercial', 'COURTYARD');
          }
          continue;
        }

        if (r === 4 && c === 2) {
          // Walkable dual-door pass-through Arcade Mart next to West Commercial Skybridge
          this.occupiedBlockKeys.add(`${r}:${c}`);
          const arcade = this.addBuilding({
            id: 'BLD-ARCADE',
            name: 'Midtown Arcade Mart',
            district: 'Sector 2 • West Commercial',
            blockRow: r,
            blockCol: c,
            x: cx,
            z: cz,
            width: 19,
            depth: 15,
            height: 11.5,
            doorSide: 'W',
            color: 0x6d3f35,
            accentColor: 0x22d3ee,
            roofType: 'flat',
            isShelterCapable: true,
            shelterCapacity: 18
          });
          this.configureWalkableInterior(
            arcade,
            'mart',
            [
              {
                side: 'W',
                offset: 0,
                width: 3.4,
                isGlass: true,
                label: 'Arcade West Blvd Glass Door'
              },
              {
                side: 'E',
                offset: 0,
                width: 3.4,
                isGlass: true,
                label: 'Arcade East Alley Glass Door'
              },
              {
                side: 'S',
                offset: 0,
                width: 3.2,
                isGlass: false,
                label: 'Arcade South Shortcut Door'
              }
            ],
            [
              { minX: cx - 7.5, maxX: cx - 3.2, minZ: cz - 5.5, maxZ: cz - 4.2, height: 1.15, kind: 'counter' },
              { minX: cx + 2.2, maxX: cx + 7.5, minZ: cz - 5.6, maxZ: cz - 4.4, height: 1.9, kind: 'shelf' },
              { minX: cx - 7.2, maxX: cx - 3.0, minZ: cz + 4.2, maxZ: cz + 5.5, height: 2.2, kind: 'cooler' },
              { minX: cx + 2.5, maxX: cx + 7.5, minZ: cz + 4.2, maxZ: cz + 5.4, height: 1.9, kind: 'shelf' }
            ],
            [
              { x: cx - 4.5, z: cz, flickerSeed: 1.1 },
              { x: cx + 4.5, z: cz, flickerSeed: 2.9 },
              { x: cx, z: cz + 3.5, flickerSeed: 4.4 }
            ]
          );
          continue;
        }

        if (r === 5 && c === 2) {
          // St. Jude Medical Center right north of Line 2
          this.occupiedBlockKeys.add(`${r}:${c}`);
          this.hospitalPos = { x: -42, z: cz };
          const hosp = this.addBuilding({
            id: 'BLD-HOSP',
            name: 'St. Jude Medical Center',
            district: 'Sector 2 • Medical Plaza',
            blockRow: r,
            blockCol: c,
            x: cx,
            z: cz,
            width: 21,
            depth: 17,
            height: 20,
            doorSide: 'W',
            color: 0xdbeafe,
            accentColor: 0xef4444,
            roofType: 'hospital',
            isShelterCapable: true,
            shelterCapacity: 48
          });
          this.configureWalkableInterior(
            hosp,
            'hospital',
            [
              {
                side: 'W',
                offset: 0,
                width: 3.8,
                isGlass: true,
                label: 'St. Jude Main Glass Door'
              },
              {
                side: 'S',
                offset: 0,
                width: 3.4,
                isGlass: true,
                label: 'St. Jude South Lobby Door'
              }
            ],
            [
              { minX: cx + 1.0, maxX: cx + 4.4, minZ: cz - 1.2, maxZ: cz + 1.2, height: 1.2, kind: 'counter' },
              { minX: cx - 5.6, maxX: cx - 4.5, minZ: cz - 4.8, maxZ: cz - 3.7, height: 4.0, kind: 'pillar' },
              { minX: cx - 5.6, maxX: cx - 4.5, minZ: cz + 3.7, maxZ: cz + 4.8, height: 4.0, kind: 'pillar' },
              { minX: cx + 5.2, maxX: cx + 6.3, minZ: cz - 4.8, maxZ: cz - 3.7, height: 4.0, kind: 'pillar' },
              { minX: cx + 5.2, maxX: cx + 6.3, minZ: cz + 3.7, maxZ: cz + 4.8, height: 4.0, kind: 'pillar' }
            ],
            [
              { x: cx - 4.5, z: cz, flickerSeed: 0.9 },
              { x: cx + 4.5, z: cz - 3.5, flickerSeed: 2.1 },
              { x: cx + 4.5, z: cz + 3.5, flickerSeed: 3.7 }
            ]
          );
          continue;
        }

        // Sector 3 Dual-Door Through-Shop, Precinct & South Parking
        if (r === 8 && c === 2) {
          this.occupiedBlockKeys.add(`${r}:${c}`);
          const pharm = this.addBuilding({
            id: 'BLD-PHARM-S3',
            name: 'Southside 24H Pharmacy',
            district: 'Sector 3 • South Residences',
            blockRow: r,
            blockCol: c,
            x: cx,
            z: cz,
            width: 19,
            depth: 15,
            height: 12.0,
            doorSide: 'W',
            color: 0x475569,
            accentColor: 0x34d399,
            roofType: 'flat',
            isShelterCapable: true,
            shelterCapacity: 20
          });
          this.configureWalkableInterior(
            pharm,
            'clinic',
            [
              {
                side: 'W',
                offset: 0,
                width: 3.4,
                isGlass: true,
                label: 'Pharmacy West Blvd Glass Door'
              },
              {
                side: 'E',
                offset: 0,
                width: 3.4,
                isGlass: true,
                label: 'Pharmacy Precinct Alley Door'
              },
              {
                side: 'S',
                offset: 0,
                width: 3.2,
                isGlass: false,
                label: 'Pharmacy South Station Door'
              }
            ],
            [
              { minX: cx - 7.5, maxX: cx - 3.0, minZ: cz - 5.5, maxZ: cz - 4.2, height: 1.15, kind: 'counter' },
              { minX: cx + 2.5, maxX: cx + 7.5, minZ: cz - 5.6, maxZ: cz - 4.4, height: 1.9, kind: 'shelf' },
              { minX: cx - 7.0, maxX: cx - 2.8, minZ: cz + 4.2, maxZ: cz + 5.2, height: 0.75, kind: 'bench' },
              { minX: cx + 2.5, maxX: cx + 7.5, minZ: cz + 4.2, maxZ: cz + 5.4, height: 1.9, kind: 'shelf' }
            ],
            [
              { x: cx - 4.5, z: cz, flickerSeed: 0.6 },
              { x: cx + 4.5, z: cz, flickerSeed: 2.5 },
              { x: cx, z: cz - 3.2, flickerSeed: 4.8 }
            ]
          );
          continue;
        }
        if (r === 8 && c === 3) {
          this.occupiedBlockKeys.add(`${r}:${c}`);
          this.precinctPos = { x: cx, z: cz + 14 };
          this.addBuilding({
            id: 'BLD-HQ',
            name: 'Metro Police Precinct HQ',
            district: 'Sector 3 • Police Precinct',
            blockRow: r,
            blockCol: c,
            x: cx,
            z: cz,
            width: 22,
            depth: 20,
            height: 17.5,
            doorSide: 'S',
            color: 0x1e3a5f,
            accentColor: 0x38bdf8,
            roofType: 'helipad',
            isShelterCapable: true,
            shelterCapacity: 42
          });
          continue;
        }
        if (r === 8 && c === 4) {
          this.occupiedBlockKeys.add(`${r}:${c}`);
          this.addParkingLotVehicles(
            cx,
            cz,
            cellW - ROAD_WIDTH - 4,
            cellD - ROAD_WIDTH - 4,
            'EW',
            rng
          );
          continue;
        }
        if (r === 9 && c === 3) {
          // Open South Concourse Plaza immediately north of Line 3 Station Perimeter
          this.occupiedBlockKeys.add(`${r}:${c}`);
          this.plazas.push({ x: cx, z: cz, width: 28, depth: 26, kind: 'stadium_plaza' });
          this.trees.push({ x: cx - 10, z: cz - 10, scale: 1.0, variant: 0 });
          this.trees.push({ x: cx + 10, z: cz - 10, scale: 1.0, variant: 1 });
          continue;
        }

        // Varied West Perimeter & Midtown Core Skyline (keep West edge open around Overpass so vistas breathe!)
        if (c === 0 && (r === 2 || r === 5 || r === 7)) {
          addSkyscraperPair(c, r, cx, cz, cellW - ROAD_WIDTH - 2, cellD - ROAD_WIDTH - 4);
          continue;
        }
        if (c === 3 && (r === 3 || r === 4)) {
          addSkyscraperPair(c, r, cx, cz, cellW - ROAD_WIDTH - 3, cellD - ROAD_WIDTH - 4);
          continue;
        }

        // Varied Organic City Patterns across remaining Midtown & Residential Blocks
        const pickPat = (r * 3 + c * 5) % 4;
        const pattern =
          c >= 6
            ? 'INDUSTRIAL'
            : pickPat === 0
            ? 'L_CORNER'
            : pickPat === 1
            ? 'ALLEY_PAIR'
            : 'COURTYARD';
        populateOrganicBlock(
          r,
          c,
          x0,
          x1,
          parcelZ0,
          parcelZ1,
          z1 <= 48 ? 'Sector 2 • Midtown Commercial' : 'Sector 3 • South Residences',
          pattern
        );
      }
    }

    // 3c. Layered Urban Infrastructure: Elevated Cross-Town Expressway + Pedestrian Skybridges
    const overpassPillars = [-110, -72, -34, 6, 46, 84, 112].map((px) => ({ x: px, z: -80 }));
    this.overpasses.push({
      axis: 'EW',
      x: 0,
      z: -80,
      length: 268,
      width: 10.4,
      deckY: 6.6,
      pillarPositions: overpassPillars,
      label: 'Midtown Elevated Expressway'
    });
    for (const p of overpassPillars) {
      this.addObstacle({
        x: p.x,
        z: p.z,
        width: 1.9,
        depth: 1.9,
        height: 6.6,
        rotationY: 0,
        kind: 'jersey_barrier',
        color: 0x475569
      });
    }
    this.skybridges.push(
      {
        axis: 'EW',
        x: -52,
        z: -25,
        length: 16.5,
        width: 3.2,
        deckY: 4.8,
        label: 'West Commercial Skybridge',
        ladderXs: [-58.2, -45.8]
      },
      {
        axis: 'EW',
        x: 26,
        z: 108,
        length: 16.5,
        width: 3.2,
        deckY: 4.8,
        label: 'Midtown Plaza Skybridge',
        ladderXs: [19.8, 32.2]
      }
    );

    // 3d. Shootable Explosive Fuel Tankers & Hazard Barrels + Illuminated Overhead Wayfinding Gantries
    this.addExplosiveHazard({
      kind: 'fuel_truck',
      x: -55.0,
      z: -154.0,
      rotationY: 0.14,
      label: 'West Blvd Fuel Tanker'
    });
    this.addExplosiveHazard({
      kind: 'fuel_barrel',
      x: -52.5,
      z: -159.0,
      rotationY: 0.25,
      label: 'West Blvd Fuel Drums'
    });
    this.addExplosiveHazard({
      kind: 'fuel_barrel',
      x: -48.6,
      z: -134.5,
      rotationY: -0.2,
      label: 'Line 1 West Approach Drums'
    });
    this.addExplosiveHazard({
      kind: 'fuel_truck',
      x: 23.8,
      z: -126.5,
      rotationY: -0.15,
      label: 'Line 1 East Fuel Tanker'
    });
    this.addExplosiveHazard({
      kind: 'fuel_barrel',
      x: 29.2,
      z: -127.0,
      rotationY: 0.3,
      label: 'Line 1 East Fuel Drums'
    });
    this.addExplosiveHazard({
      kind: 'fuel_barrel',
      x: -49.0,
      z: -39.5,
      rotationY: 0.12,
      label: 'Skybridge North Fuel Drums'
    });
    this.addExplosiveHazard({
      kind: 'fuel_truck',
      x: -54.8,
      z: -10.5,
      rotationY: 0.12,
      label: 'Midtown West Fuel Tanker'
    });
    this.addExplosiveHazard({
      kind: 'fuel_truck',
      x: 29.6,
      z: 11.5,
      rotationY: -0.18,
      label: 'Canal Bridgehead Fuel Tanker'
    });
    this.addExplosiveHazard({
      kind: 'fuel_barrel',
      x: 68.0,
      z: 29.0,
      rotationY: 0.15,
      label: 'East Canal Bridge Drums'
    });
    this.addExplosiveHazard({
      kind: 'fuel_barrel',
      x: -54.5,
      z: 42.0,
      rotationY: -0.1,
      label: 'Line 2 West Approach Drums'
    });
    this.addExplosiveHazard({
      kind: 'fuel_truck',
      x: 23.5,
      z: 92.0,
      rotationY: 0.22,
      label: 'Midtown Plaza Fuel Tanker'
    });
    this.addExplosiveHazard({
      kind: 'fuel_barrel',
      x: -48.6,
      z: 134.5,
      rotationY: 0.2,
      label: 'Line 3 West Approach Drums'
    });
    this.addExplosiveHazard({
      kind: 'fuel_truck',
      x: 29.2,
      z: 133.5,
      rotationY: -0.14,
      label: 'Line 3 East Fuel Tanker'
    });

    this.wayfindingSigns.push(
      {
        x: -52,
        z: -130,
        y: 6.4,
        width: 8.2,
        height: 1.95,
        rotationY: 0,
        title: 'LINE 1 · OUTER WALL ↓',
        subtitle: 'HOLD PERIMETER OR RETREAT SOUTH',
        accentColor: '#f59e0b',
        gantrySpan: 13.6
      },
      {
        x: 26,
        z: -130,
        y: 6.4,
        width: 8.2,
        height: 1.95,
        rotationY: 0,
        title: 'LINE 1 · EAST GATE ↓',
        subtitle: 'HIGHWAY FUNNEL • KTX 320m ↓',
        accentColor: '#38bdf8',
        gantrySpan: 13.6
      },
      {
        x: -52,
        z: -38,
        y: 6.4,
        width: 8.2,
        height: 1.95,
        rotationY: 0,
        title: 'SKYBRIDGE & ARCADE ↑',
        subtitle: 'LINE 2 DEFENSE 85m SOUTH ↓',
        accentColor: '#22d3ee',
        gantrySpan: 13.6
      },
      {
        x: 26,
        z: 18,
        y: 6.4,
        width: 8.2,
        height: 1.95,
        rotationY: 0,
        title: 'MIDTOWN CANAL BRIDGE ↓',
        subtitle: 'LINE 2 EAST GATE 30m SOUTH',
        accentColor: '#38bdf8',
        gantrySpan: 13.6
      },
      {
        x: -52,
        z: 34,
        y: 6.4,
        width: 8.2,
        height: 1.95,
        rotationY: 0,
        title: 'LINE 2 · INNER WALL ↓',
        subtitle: 'SECTOR 3 SAFE ROUTE SOUTH',
        accentColor: '#f59e0b',
        gantrySpan: 13.6
      },
      {
        x: -52,
        z: 132,
        y: 6.4,
        width: 8.2,
        height: 1.95,
        rotationY: 0,
        title: 'LINE 3 · KTX TERMINAL ↓',
        subtitle: 'EVACUATION PLATFORM ENTRANCE',
        accentColor: '#22c55e',
        gantrySpan: 13.6
      },
      {
        x: 26,
        z: 132,
        y: 6.4,
        width: 8.2,
        height: 1.95,
        rotationY: 0,
        title: 'KTX EXPRESS PLATFORM ↓',
        subtitle: 'BOARD SOUTH CONCOURSE TRAINS',
        accentColor: '#22c55e',
        gantrySpan: 13.6
      }
    );

    // 4. Populate Dramatic Traffic Pileups, Burning Trucks & Shipping Containers!
    const wreckColors = [0x991b1b, 0x3b82f6, 0x64748b, 0xe2e8f0, 0x1e293b];

    // 4a. First-Person West Boulevard Opening Pileup (x = -52, z = -166..-130) — Sideways box truck + weave corridor!
    this.addObstacle({
      x: -49.2,
      z: -147,
      width: 2.3,
      depth: 6.2,
      height: 2.45,
      rotationY: -2.18,
      kind: 'truck_burning',
      color: 0xd6d3d1,
      isBurning: true
    });
    this.addObstacle({
      x: -55.4,
      z: -140.5,
      width: 1.85,
      depth: 3.7,
      height: 1.35,
      rotationY: 2.55,
      kind: 'taxi',
      color: 0xeab308
    });
    this.addObstacle({
      x: -54.8,
      z: -131.5,
      width: 1.85,
      depth: 3.7,
      height: 1.35,
      rotationY: 2.86,
      kind: 'taxi',
      color: 0xeab308
    });
    this.addObstacle({
      x: -48.4,
      z: -158.5,
      width: 1.85,
      depth: 3.7,
      height: 1.3,
      rotationY: 0.28,
      kind: 'car',
      color: 0x6b1d1d
    });
    this.addObstacle({
      x: -47.6,
      z: -165.5,
      width: 1.85,
      depth: 3.6,
      height: 1.25,
      rotationY: 0.14,
      kind: 'car',
      color: 0x57534e
    });
    this.addObstacle({
      x: -51.6,
      z: -138,
      width: 1.85,
      depth: 3.7,
      height: 1.28,
      rotationY: -0.25,
      kind: 'car',
      color: 0x334155
    });
    this.addObstacle({
      x: -51.4,
      z: -149.8,
      width: 2.4,
      depth: 0.75,
      height: 1.0,
      rotationY: 0.22,
      kind: 'jersey_barrier',
      color: 0x64748b
    });
    this.addObstacle({
      x: -52.8,
      z: -141.2,
      width: 2.4,
      depth: 0.75,
      height: 1.0,
      rotationY: -0.18,
      kind: 'jersey_barrier',
      color: 0x64748b
    });

    // 4b. Open Highway Zone (x = -10..74, z = -222..-130) — Multi-lane Apocalypse Pileup + Concrete Medians
    for (let hz = -216; hz <= -136; hz += 16) {
      if (hz === -168 || hz === -152) continue; // Crossing gaps
      this.addObstacle({
        x: 32,
        z: hz,
        width: 0.9,
        depth: 5.5,
        height: 1.05,
        rotationY: 0,
        kind: 'jersey_barrier',
        color: 0x64748b
      });
    }
    this.addObstacle({
      x: 24.5,
      z: -148,
      width: 2.25,
      depth: 6.0,
      height: 2.4,
      rotationY: -0.35,
      kind: 'truck_burning',
      color: 0x991b1b,
      isBurning: true
    });
    this.addObstacle({
      x: 44,
      z: -186,
      width: 2.25,
      depth: 5.8,
      height: 2.4,
      rotationY: 0.42,
      kind: 'truck_burning',
      color: 0xb45309,
      isBurning: true
    });
    const highwayCarSpots: Array<[number, number, number, boolean]> = [
      [18, -138, 0.25, true],
      [29, -136, -0.2, false],
      [12, -162, 0.12, false],
      [38, -160, -0.4, true],
      [50, -146, 0.28, false],
      [6, -188, -0.25, true],
      [22, -196, 0.15, false],
      [56, -172, -0.18, false],
      [64, -198, 0.3, true]
    ];
    for (let i = 0; i < highwayCarSpots.length; i++) {
      const [hx, hz, rot, isTaxi] = highwayCarSpots[i];
      this.addObstacle({
        x: hx,
        z: hz,
        width: 1.85,
        depth: 3.7,
        height: 1.3,
        rotationY: rot,
        kind: isTaxi ? 'taxi' : i % 3 === 0 ? 'van' : 'car',
        color: isTaxi ? 0xeab308 : wreckColors[i % wreckColors.length]
      });
    }

    // 4c. Sector 2 Midtown Avenue Ambush Wrecks (forcing zig-zags & bridgehead funnels)
    this.addObstacle({
      x: -49.5,
      z: -24,
      width: 2.15,
      depth: 4.8,
      height: 1.9,
      rotationY: 0.35,
      kind: 'truck_burning',
      color: 0x7f1d1d,
      isBurning: true
    });
    this.addObstacle({
      x: -54.5,
      z: -18,
      width: 1.85,
      depth: 3.7,
      height: 1.3,
      rotationY: -0.25,
      kind: 'taxi',
      color: 0xeab308
    });
    this.addObstacle({
      x: 24.0,
      z: -56,
      width: 1.85,
      depth: 3.7,
      height: 1.3,
      rotationY: 0.45,
      kind: 'taxi',
      color: 0xeab308
    });
    this.addObstacle({
      x: 22.0,
      z: 14.0,
      width: 2.25,
      depth: 5.8,
      height: 2.4,
      rotationY: -1.85,
      kind: 'truck_burning',
      color: 0xd6d3d1,
      isBurning: true
    });
    this.addObstacle({
      x: 28.5,
      z: -62,
      width: 1.95,
      depth: 4.1,
      height: 1.6,
      rotationY: -0.2,
      kind: 'van',
      color: 0x3b82f6
    });

    // 4d. Stacked Corrugated Shipping Containers fortifying Defense Line 2 Canal Bridgeheads (z = 44.8..52.5)
    const containerCols = [0xd97706, 0x0e7490, 0x2563eb, 0xb91c1c];
    const containerSpots: Array<[number, number, number, boolean]> = [
      [-36, 44.8, 0, true],
      [-22, 44.8, 0, false],
      [11, 44.6, 0.04, true],
      [40, 44.6, -0.04, true],
      [11, 52.5, 0, true],
      [41, 52.5, 0.03, true],
      [-36, 52.5, 0, true]
    ];
    for (let i = 0; i < containerSpots.length; i++) {
      const [cx, cz, rot, stacked] = containerSpots[i];
      this.addObstacle({
        x: cx,
        z: cz,
        width: 6.4,
        depth: 2.5,
        height: stacked ? 5.2 : 2.6,
        rotationY: rot,
        kind: 'container',
        color: containerCols[i % containerCols.length]
      });
    }

    // 4e. Urban Parkour Alley & Plaza Shortcuts (vaultable by FP survivor, solid detour for infected!)
    const parkourObstacles: Array<{
      x: number;
      z: number;
      width: number;
      depth: number;
      rotationY: number;
      kind: 'parkour_fence' | 'dumpster';
    }> = [
      // Sector 1: 24H Mart <-> Northgate Clinic Brick Alley & West Blvd
      { x: -38.5, z: -146.5, width: 3.4, depth: 1.75, rotationY: 0.08, kind: 'dumpster' },
      { x: -26.5, z: -146.5, width: 4.8, depth: 0.42, rotationY: 0, kind: 'parkour_fence' },
      { x: -60.5, z: -152.0, width: 5.2, depth: 0.42, rotationY: 0.25, kind: 'parkour_fence' },
      { x: -46.5, z: -124.0, width: 4.6, depth: 0.42, rotationY: 0, kind: 'parkour_fence' },
      { x: -60.0, z: -102.0, width: 3.4, depth: 1.75, rotationY: -0.14, kind: 'dumpster' },
      // Sector 2: Midtown Canyon & East Midtown Parking Cut-Throughs
      { x: -44.0, z: -64.0, width: 5.0, depth: 0.42, rotationY: 0, kind: 'parkour_fence' },
      { x: -24.0, z: -56.0, width: 3.4, depth: 1.75, rotationY: 0.12, kind: 'dumpster' },
      { x: 34.0, z: -64.0, width: 5.2, depth: 0.42, rotationY: 0, kind: 'parkour_fence' },
      { x: 56.0, z: -48.0, width: 5.0, depth: 0.42, rotationY: Math.PI * 0.5, kind: 'parkour_fence' },
      { x: -44.0, z: -18.0, width: 5.0, depth: 0.42, rotationY: 0, kind: 'parkour_fence' },
      { x: 16.0, z: -20.0, width: 3.4, depth: 1.75, rotationY: 0, kind: 'dumpster' },
      // Sector 3: Approach & Precinct Alley Shortcuts
      { x: -44.0, z: 72.0, width: 5.2, depth: 0.42, rotationY: 0, kind: 'parkour_fence' },
      { x: 18.0, z: 108.0, width: 4.8, depth: 0.42, rotationY: Math.PI * 0.5, kind: 'parkour_fence' },
      { x: -24.0, z: 144.0, width: 3.4, depth: 1.75, rotationY: -0.1, kind: 'dumpster' }
    ];
    for (let i = 0; i < parkourObstacles.length; i++) {
      const p = parkourObstacles[i];
      this.addObstacle({
        x: p.x,
        z: p.z,
        width: p.width,
        depth: p.depth,
        height: p.kind === 'dumpster' ? 1.28 : 1.32,
        rotationY: p.rotationY,
        kind: p.kind,
        color: p.kind === 'dumpster' ? 0x1f3a2e : 0x334155
      });
    }

    // 4f. Rush-Hour Gridlock Vehicles, Crashed Transit Buses & Checkpoint Evacuation Queues
    const gridlockCars: Array<[number, number, number, 'car' | 'taxi' | 'van' | 'bus', boolean]> = [
      // Stalled West Boulevard rush-hour pileup with tilted smoking transit buses (zig-zag corridors preserved!)
      [-50.2, -32.0, 0.34, 'bus', true],
      [-54.5, -52.0, -0.18, 'taxi', false],
      [-49.8, -68.0, 0.22, 'car', false],
      [-54.2, -96.0, 0.08, 'taxi', false],
      [-49.4, -104.0, -0.12, 'van', false],
      [-54.6, -129.0, 0.05, 'car', false],
      // Midtown Avenue jammed commute & smoking bus near overpass
      [24.4, -68.0, -0.42, 'bus', true],
      [28.6, -54.0, 0.24, 'taxi', false],
      [23.5, -34.0, -0.22, 'car', false],
      [28.2, -22.0, 0.16, 'taxi', false],
      [24.0, -110.0, 0.1, 'van', false],
      // Defense Line checkpoint evacuation car queues
      [-54.4, 34.0, 0.06, 'taxi', false],
      [-49.5, 38.5, -0.05, 'car', false],
      [23.6, -132.0, 0.04, 'car', false],
      [28.5, -138.0, -0.08, 'taxi', false],
      [-53.6, 72.0, 0.28, 'bus', true],
      [-49.8, 152.0, 0.08, 'car', false],
      [28.2, 154.0, -0.06, 'taxi', false]
    ];
    for (let i = 0; i < gridlockCars.length; i++) {
      const [gx, gz, rot, kind, burn] = gridlockCars[i];
      this.addObstacle({
        x: gx,
        z: gz,
        width: kind === 'bus' ? 2.65 : kind === 'van' ? 1.95 : 1.85,
        depth: kind === 'bus' ? 8.6 : kind === 'van' ? 4.1 : 3.7,
        height: kind === 'bus' ? 2.85 : kind === 'van' ? 1.6 : 1.32,
        rotationY: rot,
        kind,
        color:
          kind === 'bus'
            ? i % 2 === 0
              ? 0xf59e0b
              : 0xe2e8f0
            : kind === 'taxi'
            ? 0xeab308
            : wreckColors[i % wreckColors.length],
        isBurning: burn
      });
    }
  }

  private getOrCreateNode(x: number, z: number, isCorner: boolean): number {
    const key = `${Math.round(x * 10)},${Math.round(z * 10)}`;
    const existing = this.nodeMap.get(key);
    if (existing !== undefined) return existing;

    const id = this.navNodes.length;
    this.navNodes.push({
      id,
      x,
      z,
      neighbors: [],
      district: this.getDistrictAtPos(x, z),
      isIntersectionCorner: isCorner
    });
    this.nodeMap.set(key, id);
    return id;
  }

  private linkNodes(a: number, b: number): void {
    if (a === b) return;
    const na = this.navNodes[a];
    const nb = this.navNodes[b];
    if (!na.neighbors.includes(b)) na.neighbors.push(b);
    if (!nb.neighbors.includes(a)) nb.neighbors.push(a);
  }

  private buildNavigationGraph(): void {
    const s = SIDEWALK_OFFSET;

    for (let row = 0; row < this.gridBlocks; row++) {
      if (this.mapId === 'twin_bridges' && row === 3) {
        continue;
      }

      for (let col = 0; col < this.gridBlocks; col++) {
        const westRoad = this.roadCoords[col];
        const eastRoad = this.roadCoords[col + 1];
        const northRoad = this.roadCoords[row];
        const southRoad = this.roadCoords[row + 1];

        const xLeft = westRoad + s;
        const xRight = eastRoad - s;
        const zTop = northRoad + s;
        const zBot = southRoad - s;
        const xMid = (xLeft + xRight) / 2;
        const zMid = (zTop + zBot) / 2;

        const nw = this.getOrCreateNode(xLeft, zTop, true);
        const nMid = this.getOrCreateNode(xMid, zTop, false);
        const ne = this.getOrCreateNode(xRight, zTop, true);

        const eMid = this.getOrCreateNode(xRight, zMid, false);
        const se = this.getOrCreateNode(xRight, zBot, true);

        const sMid = this.getOrCreateNode(xMid, zBot, false);
        const sw = this.getOrCreateNode(xLeft, zBot, true);

        const wMid = this.getOrCreateNode(xLeft, zMid, false);

        this.linkNodes(nw, nMid);
        this.linkNodes(nMid, ne);
        this.linkNodes(ne, eMid);
        this.linkNodes(eMid, se);
        this.linkNodes(se, sMid);
        this.linkNodes(sMid, sw);
        this.linkNodes(sw, wMid);
        this.linkNodes(wMid, nw);

        const isParkHere =
          Math.abs(xMid - this.centralPark.x) < 1 && Math.abs(zMid - this.centralPark.z) < 1;
        const isPlazaHere = this.plazas.some(
          (pl) => Math.abs(xMid - pl.x) < 1 && Math.abs(zMid - pl.z) < 1
        );
        if (isParkHere || isPlazaHere) {
          const centerPlaza = this.getOrCreateNode(xMid, zMid, false);
          this.linkNodes(centerPlaza, nMid);
          this.linkNodes(centerPlaza, sMid);
          this.linkNodes(centerPlaza, eMid);
          this.linkNodes(centerPlaza, wMid);
        }
      }
    }

    if (this.mapId === 'twin_bridges') {
      for (const br of this.bridges) {
        const xW = br.x - s;
        const xE = br.x + s;

        const bankNW = this.getOrCreateNode(xW, -16 - s, true);
        const bankNE = this.getOrCreateNode(xE, -16 - s, true);
        const bankSW = this.getOrCreateNode(xW, 16 + s, true);
        const bankSE = this.getOrCreateNode(xE, 16 + s, true);

        const brNW = this.getOrCreateNode(xW, -10.7, false);
        const brMW = this.getOrCreateNode(xW, 0, false);
        const brSW = this.getOrCreateNode(xW, 10.7, false);

        const brNE = this.getOrCreateNode(xE, -10.7, false);
        const brME = this.getOrCreateNode(xE, 0, false);
        const brSE = this.getOrCreateNode(xE, 10.7, false);

        this.linkNodes(bankNW, brNW);
        this.linkNodes(brNW, brMW);
        this.linkNodes(brMW, brSW);
        this.linkNodes(brSW, bankSW);

        this.linkNodes(bankNE, brNE);
        this.linkNodes(brNE, brME);
        this.linkNodes(brME, brSE);
        this.linkNodes(brSE, bankSE);

        this.linkNodes(brNW, brNE);
        this.linkNodes(brMW, brME);
        this.linkNodes(brSW, brSE);
      }
    }

    for (let i = 0; i < this.navNodes.length; i++) {
      for (let j = i + 1; j < this.navNodes.length; j++) {
        const a = this.navNodes[i];
        const b = this.navNodes[j];
        const dx = Math.abs(a.x - b.x);
        const dz = Math.abs(a.z - b.z);
        if ((dx < 0.2 && Math.abs(dz - s * 2) < 0.3) || (dz < 0.2 && Math.abs(dx - s * 2) < 0.3)) {
          if (!this.segmentCrossesWater(a.x, a.z, b.x, b.z)) {
            this.linkNodes(i, j);
          }
        }
      }
    }
  }

  private isNavPointBlocked(x: number, z: number, pad = 0.65): boolean {
    if (this.isPointInOpenWater(x, z, pad)) return true;
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      if (x >= b.minX - pad && x <= b.maxX + pad && z >= b.minZ - pad && z <= b.maxZ + pad) {
        if (!b.interior) return true;
        for (let wi = 0; wi < b.interior.walls.length; wi++) {
          const w = b.interior.walls[wi];
          if (x >= w.minX - pad && x <= w.maxX + pad && z >= w.minZ - pad && z <= w.maxZ + pad) {
            return true;
          }
        }
        for (let pi = 0; pi < b.interior.props.length; pi++) {
          const p = b.interior.props[pi];
          if (x >= p.minX - pad && x <= p.maxX + pad && z >= p.minZ - pad && z <= p.maxZ + pad) {
            return true;
          }
        }
      }
    }
    for (let i = 0; i < this.staticObstacles.length; i++) {
      const obs = this.staticObstacles[i];
      const cosR = Math.cos(obs.rotationY);
      const sinR = Math.sin(obs.rotationY);
      const dx = x - obs.x;
      const dz = z - obs.z;
      const lx = dx * cosR - dz * sinR;
      const lz = dx * sinR + dz * cosR;
      if (Math.abs(lx) <= obs.width * 0.5 + pad && Math.abs(lz) <= obs.depth * 0.5 + pad) {
        return true;
      }
    }
    return false;
  }

  private navBuildings: BuildingData[] = [];
  private navObstacles: StaticObstacleData[] = [];

  public isNavigationSegmentClear(x1: number, z1: number, x2: number, z2: number): boolean {
    if (this.segmentCrossesWater(x1, z1, x2, z2)) return false;
    const mx = (x1 + x2) * 0.5;
    const mz = (z1 + z2) * 0.5;
    const range = Math.hypot(x2 - x1, z2 - z1) * 0.5 + 0.6;
    const pad = 0.53;
    const hits = (box: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
      segmentIntersectsAABB(x1, z1, x2, z2, box.minX - pad, box.maxX + pad, box.minZ - pad, box.maxZ + pad);
    for (const b of this.getBuildingsNearPos(mx, mz, this.navBuildings, range)) {
      if (!hits(b)) continue;
      if (!b.interior || b.interior.walls.some(hits) || b.interior.props.some(hits)) return false;
    }
    for (const o of this.getObstaclesNearPos(mx, mz, this.navObstacles, range)) {
      const cos = o.cosR ?? Math.cos(o.rotationY);
      const sin = o.sinR ?? Math.sin(o.rotationY);
      const ax = x1 - o.x, az = z1 - o.z, bx = x2 - o.x, bz = z2 - o.z;
      const halfWidth = o.width * 0.5 + pad, halfDepth = o.depth * 0.5 + pad;
      if (segmentIntersectsAABB(ax * cos - az * sin, ax * sin + az * cos,
        bx * cos - bz * sin, bx * sin + bz * cos, -halfWidth, halfWidth, -halfDepth, halfDepth)) return false;
    }
    return true;
  }

  private buildOrganicNavigationGraph(): void {
    const s = SIDEWALK_OFFSET;
    const addSafeNode = (nx: number, nz: number, isCorner: boolean): number | null => {
      if (Math.abs(nx) > this.cityHalfX - 1.2 || Math.abs(nz) > this.cityHalfZ - 1.2) return null;
      if (this.isNavPointBlocked(nx, nz, 0.7)) return null;
      return this.getOrCreateNode(nx, nz, isCorner);
    };

    // 1. Irregular street sidewalk nodes around every road intersection
    for (let r = 0; r < this.roadZs.length - 1; r++) {
      const z0 = this.roadZs[r];
      const z1 = this.roadZs[r + 1];
      const zTop = z0 + s;
      const zBot = z1 - s;
      const zMid = (zTop + zBot) * 0.5;

      for (let c = 0; c < this.roadXs.length - 1; c++) {
        const x0 = this.roadXs[c];
        const x1 = this.roadXs[c + 1];
        const xLeft = x0 + s;
        const xRight = x1 - s;
        const xMid = (xLeft + xRight) * 0.5;

        addSafeNode(xLeft, zTop, true);
        addSafeNode(xMid, zTop, false);
        addSafeNode(xRight, zTop, true);
        addSafeNode(xRight, zMid, false);
        addSafeNode(xRight, zBot, true);
        addSafeNode(xMid, zBot, false);
        addSafeNode(xLeft, zBot, true);
        addSafeNode(xLeft, zMid, false);
        // Alley / courtyard center anchor
        addSafeNode(xMid, zMid, false);
      }
    }

    // 2. Boulevard & Defense Blast Gate centerlines so crowds weave smoothly through all gates & pileups
    for (const gx of [-52, 26]) {
      for (let gz = -216; gz <= 212; gz += 18) {
        addSafeNode(gx, gz, false);
        addSafeNode(gx - 3.6, gz, false);
        addSafeNode(gx + 3.6, gz, false);
      }
    }

    // 3. Open Highway multi-lane waypoints around pileups (x in [-14..70], z in [-216..-124])
    for (let hz = -216; hz <= -124; hz += 18) {
      for (const hx of [-6, 12, 42, 62]) {
        addSafeNode(hx, hz, false);
      }
    }

    // 4. Midtown Canal Bridges (x = 26 and x = 68, z = 18..52)
    for (const br of this.bridges) {
      for (const bz of [16, 24, 33.5, 42, 52]) {
        addSafeNode(br.x - 4.2, bz, false);
        addSafeNode(br.x, bz, false);
        addSafeNode(br.x + 4.2, bz, false);
      }
    }

    // 5. South Express Terminal Concourse (z = 172..216)
    for (const tx of [-92, -68, -52, -26, 0, 26, 52, 76, 98]) {
      for (const tz of [174, 189, 212]) {
        addSafeNode(tx, tz, false);
      }
    }

    // 6. Walkable 1st-Floor Landmarks: exterior doorway apron, threshold & interior corridor anchors
    for (const door of this.interiorDoors) {
      const nx = door.side === 'W' ? -1 : door.side === 'E' ? 1 : 0;
      const nz = door.side === 'N' ? -1 : door.side === 'S' ? 1 : 0;
      addSafeNode(door.x + nx * 1.8, door.z + nz * 1.8, false);
      addSafeNode(door.x, door.z, false);
      addSafeNode(door.x - nx * 1.8, door.z - nz * 1.8, false);
    }
    for (const b of this.buildings) {
      if (!b.interior) continue;
      for (const ox of [-b.width * 0.28, 0, b.width * 0.28]) {
        for (const oz of [-b.depth * 0.22, 0, b.depth * 0.22]) {
          addSafeNode(b.x + ox, b.z + oz, false);
        }
      }
    }

    // Connect all mutually reachable local corridor nodes (dist <= 27m, clear of water/buildings/pileups)
    const count = this.navNodes.length;
    for (let i = 0; i < count; i++) {
      const a = this.navNodes[i];
      for (let j = i + 1; j < count; j++) {
        const b = this.navNodes[j];
        const dx = Math.abs(a.x - b.x);
        const dz = Math.abs(a.z - b.z);
        if (dx > 27 || dz > 27) continue;
        const dist = Math.hypot(dx, dz);
        if (dist > 28) continue;
        // Prefer axis-aligned corridors or medium diagonals inside plazas/highways
        const isAligned = dx < 5.5 || dz < 5.5 || dist < 17.5;
        if (!isAligned) continue;
        if (this.isNavigationSegmentClear(a.x, a.z, b.x, b.z)) {
          this.linkNodes(i, j);
        }
      }
    }
  }

  private initPathfinderBuffers(): void {
    const count = this.navNodes.length;
    this.gScore = new Float32Array(count);
    this.fScore = new Float32Array(count);
    this.cameFrom = new Int32Array(count);
    this.seenStamp = new Uint32Array(count);
    this.closedStamp = new Uint32Array(count);
    this.openList = [];

    for (let r = 0; r < this.spatialRows; r++) {
      for (let c = 0; c < this.spatialCols; c++) {
        this.navCells[r][c].length = 0;
      }
    }
    const maxCellC = Math.max(0, this.spatialCols - 1);
    const maxCellR = Math.max(0, this.spatialRows - 1);
    for (let i = 0; i < count; i++) {
      const n = this.navNodes[i];
      const col = Math.max(
        0,
        Math.min(maxCellC, Math.floor((n.x + this.cityHalfX) / SPATIAL_CELL_SIZE))
      );
      const row = Math.max(
        0,
        Math.min(maxCellR, Math.floor((n.z + this.cityHalfZ) / SPATIAL_CELL_SIZE))
      );
      this.navCells[row][col].push(n);
    }
  }

  private buildStreetFurniture(rng: SeededRNG): void {
    for (let r = 0; r < this.roadZs.length; r++) {
      for (let c = 0; c < this.roadXs.length; c++) {
        const rx = this.roadXs[c];
        const rz = this.roadZs[r];
        if (
          this.highwayZone &&
          rx > this.highwayZone.minX + 4 &&
          rx < this.highwayZone.maxX - 4 &&
          rz < this.highwayZone.maxZ - 4
        ) {
          continue;
        }
        if (
          this.terminalPlaza &&
          rx > this.terminalPlaza.minX + 6 &&
          rx < this.terminalPlaza.maxX - 6 &&
          rz > this.terminalPlaza.minZ + 6
        ) {
          continue;
        }

        if (c < this.roadXs.length - 1 && r < this.roadZs.length - 1) {
          const lx = rx + 4.4;
          const lz = rz + 4.4;
          if (!this.isPointInOpenWater(lx, lz, 1.5)) {
            this.lamps.push({ x: lx, z: lz, rotationY: Math.PI * 0.25 });
          }
        }
        if (c > 0 && r > 0 && (r + c) % 2 === 0) {
          const lx = rx - 4.4;
          const lz = rz - 4.4;
          if (!this.isPointInOpenWater(lx, lz, 1.5)) {
            this.lamps.push({ x: lx, z: lz, rotationY: -Math.PI * 0.75 });
          }
        }
      }
    }

    if (this.highwayZone) {
      for (let hz = this.highwayZone.minZ + 12; hz <= this.highwayZone.maxZ - 12; hz += 24) {
        this.lamps.push({ x: this.highwayZone.minX + 1.5, z: hz, rotationY: 0 });
        this.lamps.push({ x: this.highwayZone.maxX - 1.5, z: hz, rotationY: Math.PI });
      }
    }

    for (const br of this.bridges) {
      for (const bz of [br.z - 8, br.z, br.z + 8]) {
        this.lamps.push({ x: br.x - br.width * 0.45, z: bz, rotationY: 0 });
        this.lamps.push({ x: br.x + br.width * 0.45, z: bz, rotationY: 0 });
      }
    }
  }

  public findNearestNode(x: number, z: number, minZ = -Infinity, maxZ = Infinity): NavNode {
    return this.findNearestMatchingNode(x, z, minZ, maxZ) ?? this.navNodes[0];
  }

  private findNearestMatchingNode(
    x: number, z: number, minZ: number, maxZ: number, accept?: (node: NavNode) => boolean
  ): NavNode | undefined {
    const maxCellC = Math.max(0, this.spatialCols - 1);
    const maxCellR = Math.max(0, this.spatialRows - 1);
    const col = Math.max(
      0,
      Math.min(maxCellC, Math.floor((x + this.cityHalfX) / SPATIAL_CELL_SIZE))
    );
    const row = Math.max(
      0,
      Math.min(maxCellR, Math.floor((z + this.cityHalfZ) / SPATIAL_CELL_SIZE))
    );

    let best: NavNode | undefined;
    let bestDistSq = Infinity;
    const minR = Math.max(0, row - 1);
    const maxR = Math.min(maxCellR, row + 1);
    const minC = Math.max(0, col - 1);
    const maxC = Math.min(maxCellC, col + 1);

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const list = this.navCells[r][c];
        for (let i = 0; i < list.length; i++) {
          const n = list[i];
          if (n.z < minZ || n.z >= maxZ) continue;
          const dx = n.x - x;
          const dz = n.z - z;
          const dSq = dx * dx + dz * dz;
          if (dSq < bestDistSq && (!accept || accept(n))) {
            bestDistSq = dSq;
            best = n;
          }
        }
      }
    }

    if (bestDistSq < Infinity) return best;

    for (let i = 0; i < this.navNodes.length; i++) {
      const n = this.navNodes[i];
      if (n.z < minZ || n.z >= maxZ) continue;
      const dx = n.x - x;
      const dz = n.z - z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq && (!accept || accept(n))) {
        bestDistSq = dSq;
        best = n;
      }
    }
    return best;
  }

  /**
   * Zero-allocation stamp-based A* pathfinding over sidewalks, bridges, and defense blast gates.
   */
  public findPath(
    startX: number,
    startZ: number,
    goalX: number,
    goalZ: number,
    roadblocks: RoadblockData[] = [],
    walls: DefenseWallData[] = [],
    gates: BlastGateData[] = [],
    isZombie = false
  ): Vec2[] {
    const nearestForPath = (x: number, z: number) => {
      let minZ = -Infinity;
      let maxZ = Infinity;
      for (const wall of walls) {
        if (z >= wall.z) minZ = Math.max(minZ, wall.z);
        else maxZ = Math.min(maxZ, wall.z);
      }
      return this.findNearestMatchingNode(x, z, minZ, maxZ, (node) =>
        node.neighbors.length > 0 && Math.hypot(node.x - x, node.z - z) <= 45 &&
        this.isNavigationSegmentClear(x, z, node.x, node.z));
    };
    const startNode = nearestForPath(startX, startZ);
    const goalNode = nearestForPath(goalX, goalZ);
    const crossesWall = walls.some((wall) => (startZ < wall.z) !== (goalZ < wall.z));
    const canGoDirect = () => !crossesWall && this.isNavigationSegmentClear(startX, startZ, goalX, goalZ);
    if (!startNode || !goalNode) return canGoDirect() ? [{ x: goalX, z: goalZ }] : [];
    if (startNode.id === goalNode.id) {
      return canGoDirect() ? [{ x: goalX, z: goalZ }] : [{ x: startNode.x, z: startNode.z }, { x: goalX, z: goalZ }];
    }

    this.searchStamp++;
    if (this.searchStamp >= 0xfffffff0) {
      this.seenStamp.fill(0);
      this.closedStamp.fill(0);
      this.searchStamp = 1;
    }
    const stamp = this.searchStamp;
    this.openList.length = 0;

    this.seenStamp[startNode.id] = stamp;
    this.gScore[startNode.id] = 0;
    this.fScore[startNode.id] = Math.hypot(goalNode.x - startNode.x, goalNode.z - startNode.z);
    this.cameFrom[startNode.id] = -1;
    this.openList.push(startNode.id);

    while (this.openList.length > 0) {
      let bestIdx = 0;
      let currentId = this.openList[0];
      let bestF = this.fScore[currentId];
      for (let i = 1; i < this.openList.length; i++) {
        const id = this.openList[i];
        if (this.fScore[id] < bestF) {
          bestF = this.fScore[id];
          currentId = id;
          bestIdx = i;
        }
      }

      if (currentId === goalNode.id) {
        const result: Vec2[] = [];
        let curr = currentId;
        while (curr !== -1 && curr !== startNode.id) {
          const n = this.navNodes[curr];
          result.push({ x: n.x, z: n.z });
          curr = this.cameFrom[curr];
        }
        result.reverse();
        if (Math.hypot(startX - startNode.x, startZ - startNode.z) > 0.75) result.unshift({ x: startNode.x, z: startNode.z });
        if (Math.hypot(goalNode.x - goalX, goalNode.z - goalZ) > 0.1) result.push({ x: goalX, z: goalZ });
        return result;
      }

      this.openList[bestIdx] = this.openList[this.openList.length - 1];
      this.openList.pop();
      this.closedStamp[currentId] = stamp;

      const current = this.navNodes[currentId];
      for (let i = 0; i < current.neighbors.length; i++) {
        const neighborId = current.neighbors[i];
        if (this.closedStamp[neighborId] === stamp) continue;

        const neighbor = this.navNodes[neighborId];
        let stepCost = Math.hypot(neighbor.x - current.x, neighbor.z - current.z);
        const mx = (current.x + neighbor.x) * 0.5;
        const mz = (current.z + neighbor.z) * 0.5;

        // Check solid Defense Walls & Blast Gates
        let blockedBySolidWall = false;
        for (let wi = 0; wi < walls.length; wi++) {
          const w = walls[wi];
          if ((current.z < w.z) !== (neighbor.z < w.z)) {
            let matchingGate: BlastGateData | null = null;
            const x = current.x + (neighbor.x - current.x) * (w.z - current.z) / (neighbor.z - current.z);
            for (let gi = 0; gi < gates.length; gi++) {
              const g = gates[gi];
              if (g.wallId === w.id && Math.abs(x - g.x) <= g.width * 0.5 - 0.55) {
                matchingGate = g;
                break;
              }
            }
            if (!matchingGate) {
              blockedBySolidWall = true;
              break;
            }
            if (!matchingGate.breached && (!matchingGate.isOpen || matchingGate.openFraction < 0.17)) {
              if (!isZombie) {
                blockedBySolidWall = true;
                break;
              }
              if (!matchingGate.isOpen) stepCost += 40;
            }
          }
        }
        if (blockedBySolidWall) continue;

        for (let r = 0; r < roadblocks.length; r++) {
          const rb = roadblocks[r];
          if (!rb.active) continue;
          const distSq = (mx - rb.x) * (mx - rb.x) + (mz - rb.z) * (mz - rb.z);
          if (distSq < (rb.radius + 4.5) * (rb.radius + 4.5)) {
            stepCost += 120;
          }
        }

        const tentativeG = this.gScore[currentId] + stepCost;
        const alreadySeen = this.seenStamp[neighborId] === stamp;
        if (!alreadySeen || tentativeG < this.gScore[neighborId]) {
          this.cameFrom[neighborId] = currentId;
          this.gScore[neighborId] = tentativeG;
          this.fScore[neighborId] =
            tentativeG + Math.hypot(goalNode.x - neighbor.x, goalNode.z - neighbor.z);
          if (!alreadySeen) {
            this.seenStamp[neighborId] = stamp;
            this.openList.push(neighborId);
          }
        }
      }
    }

    return canGoDirect() ? [{ x: goalX, z: goalZ }] : [];
  }
}
