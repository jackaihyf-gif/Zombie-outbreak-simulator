import type {
  BuildingInteriorData,
  InteriorBox,
  LabContainmentPodData,
  SkybridgeData,
  WayfindingSignData
} from './types';

export const LAB_HALF_X = 72;
export const LAB_HALF_Z = 180;
export const LAB_CEILING_Y = 8.4;
export const LAB_APC_START_Z = 146;
export const LAB_TUNNEL_GATE_Z = 158;
export const LAB_EXIT_Z = 177;
export const LAB_APC_WARMUP_SECONDS = 40;

export const LAB_ROAD_XS = [-72, -56, -24, 0, 24, 56, 72] as const;
export const LAB_ROAD_ZS = [-180, -136, -124, -100, -58, -16, 26, 74, 116, 152, 180] as const;

export const LAB_REACTOR_CORE = { x: 0, z: -4, radius: 3.1 } as const;

export function getBsl4DistrictAtPos(_x: number, z: number): string {
  if (z < -136) return 'Zone 1 • Sector 0 Containment Vault';
  if (z < -100) return 'Zone 2 • Quarantine & Bio-Lock 1';
  if (z < -58) return 'Zone 3 • Cryo Vault & Biobank';
  if (z < -16) return 'Zone 4 • Genetics & Autopsy Wing';
  if (z < 32) return 'Zone 5 • Reactor Core & Bio-Lock 2';
  if (z < 74) return 'Zone 6 • Security Command & Armory';
  if (z < 122) return 'Zone 7 • Generator & Hazmat Bay';
  return 'Zone 8 • Extraction Garage & Tunnel';
}

export const LAB_WALL_DEFS: Array<{
  z: number;
  height: number;
  thickness: number;
  label: string;
  layerIndex: number;
  gateXs: number[];
}> = [
  {
    z: -124,
    height: 7.4,
    thickness: 2.4,
    label: 'Bio-Lock 1 • Quarantine Bulkhead',
    layerIndex: 1,
    gateXs: [-24, 24]
  },
  {
    z: 26,
    height: 7.6,
    thickness: 2.4,
    label: 'Bio-Lock 2 • Reactor Containment',
    layerIndex: 2,
    gateXs: [-24, 24]
  },
  {
    z: 116,
    height: 7.8,
    thickness: 2.4,
    label: 'Bulkhead 3 • Extraction Garage',
    layerIndex: 3,
    gateXs: [-24, 24]
  }
];

export const LAB_SKYBRIDGES: SkybridgeData[] = [
  {
    axis: 'EW',
    x: -24,
    z: -4,
    length: 16.5,
    width: 3.2,
    deckY: 4.8,
    label: 'West Reactor Catwalk',
    ladderXs: [-30.2, -17.8]
  },
  {
    axis: 'EW',
    x: 24,
    z: -4,
    length: 16.5,
    width: 3.2,
    deckY: 4.8,
    label: 'East Reactor Catwalk',
    ladderXs: [17.8, 30.2]
  }
];

export function createInitialLabPods(): LabContainmentPodData[] {
  const zRows = [-168, -158, -148, -140];
  const breachTimes = [0.6, 1.8, 4.5, 6.0, 9.5, 11.2, 14.5, 16.2];
  const pods: LabContainmentPodData[] = [];
  let idx = 0;
  for (let r = 0; r < zRows.length; r++) {
    for (const px of [-12, 12]) {
      idx++;
      pods.push({
        id: idx,
        x: px,
        z: zRows[r],
        breached: false,
        breachAt: breachTimes[idx - 1],
        label: idx === 1 ? 'Specimen Pod 01 (Subject Alpha)' : `Containment Pod 0${idx}`
      });
    }
  }
  return pods;
}

export interface LabInteriorRoomSpec {
  id: string;
  name: string;
  district: string;
  row: number;
  col: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  color: number;
  accentColor: number;
  theme: BuildingInteriorData['theme'];
  shelterCapacity: number;
  doors: Array<{ side: 'N' | 'S' | 'E' | 'W'; offset: number; width: number; isGlass: boolean; label: string }>;
  makeProps: (cx: number, cz: number) => InteriorBox[];
  makeLights: (cx: number, cz: number) => Array<{ x: number; z: number; flickerSeed: number }>;
}

export const LAB_INTERIOR_ROOMS: LabInteriorRoomSpec[] = [
  {
    id: 'BLD-LAB-CRYO-W',
    name: 'Cryo Biobank West',
    district: 'Zone 3 • Cryo Vault & Biobank',
    row: 3,
    col: 1,
    x: -40,
    z: -84,
    width: 20,
    depth: 20,
    height: 8.2,
    color: 0x26384d,
    accentColor: 0x38bdf8,
    theme: 'mart',
    shelterCapacity: 20,
    doors: [
      { side: 'E', offset: 0, width: 3.4, isGlass: true, label: 'Cryo Biobank East Glass Door' },
      { side: 'N', offset: 0, width: 3.2, isGlass: true, label: 'Cryo Biobank North Airlock Door' },
      { side: 'S', offset: 0, width: 3.2, isGlass: false, label: 'Cryo Biobank South Exit Door' }
    ],
    makeProps: (cx, cz) => [
      { minX: cx - 7.8, maxX: cx - 3.6, minZ: cz - 7.2, maxZ: cz - 5.6, height: 2.3, kind: 'cooler' },
      { minX: cx + 3.4, maxX: cx + 7.8, minZ: cz - 7.2, maxZ: cz - 5.6, height: 2.3, kind: 'cooler' },
      { minX: cx - 7.8, maxX: cx - 3.6, minZ: cz + 5.6, maxZ: cz + 7.2, height: 2.3, kind: 'cooler' },
      { minX: cx + 3.4, maxX: cx + 7.8, minZ: cz + 5.6, maxZ: cz + 7.2, height: 1.2, kind: 'counter' }
    ],
    makeLights: (cx, cz) => [
      { x: cx - 4.0, z: cz, flickerSeed: 0.7 },
      { x: cx + 4.0, z: cz, flickerSeed: 2.1 },
      { x: cx, z: cz + 4.0, flickerSeed: 3.5 }
    ]
  },
  {
    id: 'BLD-LAB-CRYO-E',
    name: 'Cryo Specimen Lab East',
    district: 'Zone 3 • Cryo Vault & Biobank',
    row: 3,
    col: 4,
    x: 40,
    z: -84,
    width: 20,
    depth: 20,
    height: 8.2,
    color: 0x26384d,
    accentColor: 0x22d3ee,
    theme: 'clinic',
    shelterCapacity: 20,
    doors: [
      { side: 'W', offset: 0, width: 3.4, isGlass: true, label: 'Cryo Lab West Glass Door' },
      { side: 'N', offset: 0, width: 3.2, isGlass: true, label: 'Cryo Lab North Airlock Door' },
      { side: 'S', offset: 0, width: 3.2, isGlass: false, label: 'Cryo Lab South Exit Door' }
    ],
    makeProps: (cx, cz) => [
      { minX: cx - 7.4, maxX: cx - 3.5, minZ: cz - 7.0, maxZ: cz - 5.6, height: 1.9, kind: 'shelf' },
      { minX: cx + 3.5, maxX: cx + 7.4, minZ: cz - 7.0, maxZ: cz - 5.4, height: 2.3, kind: 'cooler' },
      { minX: cx - 7.2, maxX: cx - 3.5, minZ: cz + 5.5, maxZ: cz + 6.9, height: 0.9, kind: 'bed' },
      { minX: cx + 3.5, maxX: cx + 7.4, minZ: cz + 5.5, maxZ: cz + 6.8, height: 1.15, kind: 'counter' }
    ],
    makeLights: (cx, cz) => [
      { x: cx - 4.0, z: cz, flickerSeed: 1.2 },
      { x: cx + 4.0, z: cz, flickerSeed: 2.8 },
      { x: cx, z: cz - 4.0, flickerSeed: 4.3 }
    ]
  },
  {
    id: 'BLD-LAB-AUTOPSY',
    name: 'Virology & Autopsy Suite',
    district: 'Zone 4 • Genetics & Autopsy Wing',
    row: 4,
    col: 1,
    x: -40,
    z: -40,
    width: 20,
    depth: 22,
    height: 8.2,
    color: 0x334155,
    accentColor: 0xf43f5e,
    theme: 'clinic',
    shelterCapacity: 22,
    doors: [
      { side: 'E', offset: 0, width: 3.4, isGlass: true, label: 'Autopsy East Corridor Glass Door' },
      { side: 'N', offset: 0, width: 3.2, isGlass: true, label: 'Autopsy North Entry Door' },
      { side: 'S', offset: 0, width: 3.2, isGlass: false, label: 'Autopsy South Exit Door' }
    ],
    makeProps: (cx, cz) => [
      { minX: cx - 7.5, maxX: cx - 3.6, minZ: cz - 7.8, maxZ: cz - 6.0, height: 0.95, kind: 'bed' },
      { minX: cx + 3.6, maxX: cx + 7.5, minZ: cz - 7.8, maxZ: cz - 6.0, height: 0.95, kind: 'bed' },
      { minX: cx - 7.5, maxX: cx - 3.6, minZ: cz + 6.0, maxZ: cz + 7.6, height: 1.15, kind: 'counter' },
      { minX: cx + 3.6, maxX: cx + 7.5, minZ: cz + 6.0, maxZ: cz + 7.6, height: 1.9, kind: 'shelf' }
    ],
    makeLights: (cx, cz) => [
      { x: cx - 4.2, z: cz, flickerSeed: 1.9 },
      { x: cx + 4.2, z: cz, flickerSeed: 3.4 },
      { x: cx, z: cz + 4.2, flickerSeed: 5.1 }
    ]
  },
  {
    id: 'BLD-LAB-GENETICS',
    name: 'Genetics Core Lab',
    district: 'Zone 4 • Genetics & Autopsy Wing',
    row: 4,
    col: 3,
    x: 0,
    z: -40,
    width: 18,
    depth: 20,
    height: 8.2,
    color: 0x1e3a5f,
    accentColor: 0x10b981,
    theme: 'clinic',
    shelterCapacity: 24,
    doors: [
      { side: 'W', offset: 0, width: 3.4, isGlass: true, label: 'Genetics West Glass Door' },
      { side: 'E', offset: 0, width: 3.4, isGlass: true, label: 'Genetics East Glass Door' },
      { side: 'N', offset: 0, width: 3.4, isGlass: true, label: 'Genetics North Airlock Door' },
      { side: 'S', offset: 0, width: 3.4, isGlass: true, label: 'Genetics South Atrium Door' }
    ],
    makeProps: (cx, cz) => [
      { minX: cx - 6.8, maxX: cx - 3.4, minZ: cz - 7.0, maxZ: cz - 5.6, height: 1.2, kind: 'counter' },
      { minX: cx + 3.4, maxX: cx + 6.8, minZ: cz - 7.0, maxZ: cz - 5.6, height: 1.9, kind: 'shelf' },
      { minX: cx - 6.8, maxX: cx - 3.4, minZ: cz + 5.6, maxZ: cz + 7.0, height: 1.9, kind: 'shelf' },
      { minX: cx + 3.4, maxX: cx + 6.8, minZ: cz + 5.6, maxZ: cz + 7.0, height: 1.2, kind: 'counter' }
    ],
    makeLights: (cx, cz) => [
      { x: cx - 3.8, z: cz - 3.5, flickerSeed: 0.4 },
      { x: cx + 3.8, z: cz + 3.5, flickerSeed: 2.6 }
    ]
  },
  {
    id: 'BLD-LAB-CLEANROOM',
    name: 'BSL-4 Cleanroom Wing',
    district: 'Zone 4 • Genetics & Autopsy Wing',
    row: 4,
    col: 4,
    x: 40,
    z: -40,
    width: 20,
    depth: 22,
    height: 8.2,
    color: 0x3b4d63,
    accentColor: 0x38bdf8,
    theme: 'mart',
    shelterCapacity: 22,
    doors: [
      { side: 'W', offset: 0, width: 3.4, isGlass: true, label: 'Cleanroom West Glass Door' },
      { side: 'N', offset: 0, width: 3.2, isGlass: true, label: 'Cleanroom North Entry Door' },
      { side: 'S', offset: 0, width: 3.2, isGlass: false, label: 'Cleanroom South Exit Door' }
    ],
    makeProps: (cx, cz) => [
      { minX: cx - 7.5, maxX: cx - 3.6, minZ: cz - 7.6, maxZ: cz - 6.0, height: 1.9, kind: 'shelf' },
      { minX: cx + 3.6, maxX: cx + 7.5, minZ: cz - 7.6, maxZ: cz - 6.0, height: 2.2, kind: 'cooler' },
      { minX: cx - 7.5, maxX: cx - 3.6, minZ: cz + 6.0, maxZ: cz + 7.6, height: 1.15, kind: 'counter' },
      { minX: cx + 3.6, maxX: cx + 7.5, minZ: cz + 6.0, maxZ: cz + 7.6, height: 1.9, kind: 'shelf' }
    ],
    makeLights: (cx, cz) => [
      { x: cx - 4.0, z: cz, flickerSeed: 1.5 },
      { x: cx + 4.0, z: cz, flickerSeed: 3.9 }
    ]
  },
  {
    id: 'BLD-LAB-SEC-CMD',
    name: 'Security Command Center',
    district: 'Zone 6 • Security Command & Armory',
    row: 6,
    col: 1,
    x: -40,
    z: 56,
    width: 20,
    depth: 20,
    height: 8.2,
    color: 0x1e293b,
    accentColor: 0x38bdf8,
    theme: 'terminal',
    shelterCapacity: 26,
    doors: [
      { side: 'E', offset: 0, width: 3.4, isGlass: true, label: 'Command Center East Glass Door' },
      { side: 'N', offset: 0, width: 3.2, isGlass: false, label: 'Command Center North Door' },
      { side: 'S', offset: 0, width: 3.2, isGlass: false, label: 'Command Center South Door' }
    ],
    makeProps: (cx, cz) => [
      { minX: cx - 7.5, maxX: cx - 3.6, minZ: cz - 7.0, maxZ: cz - 5.4, height: 1.25, kind: 'counter' },
      { minX: cx + 3.6, maxX: cx + 7.5, minZ: cz - 7.0, maxZ: cz - 5.4, height: 1.25, kind: 'counter' },
      { minX: cx - 7.2, maxX: cx - 3.6, minZ: cz + 5.6, maxZ: cz + 6.9, height: 0.78, kind: 'bench' },
      { minX: cx + 3.6, maxX: cx + 7.4, minZ: cz + 5.6, maxZ: cz + 7.0, height: 1.9, kind: 'shelf' }
    ],
    makeLights: (cx, cz) => [
      { x: cx - 4.0, z: cz, flickerSeed: 0.8 },
      { x: cx + 4.0, z: cz, flickerSeed: 2.3 }
    ]
  },
  {
    id: 'BLD-LAB-ARMORY',
    name: 'Tactical Armory & Infirmary',
    district: 'Zone 6 • Security Command & Armory',
    row: 6,
    col: 4,
    x: 40,
    z: 56,
    width: 20,
    depth: 20,
    height: 8.2,
    color: 0x293548,
    accentColor: 0xf59e0b,
    theme: 'clinic',
    shelterCapacity: 24,
    doors: [
      { side: 'W', offset: 0, width: 3.4, isGlass: true, label: 'Armory West Corridor Glass Door' },
      { side: 'N', offset: 0, width: 3.2, isGlass: false, label: 'Armory North Security Door' },
      { side: 'S', offset: 0, width: 3.2, isGlass: false, label: 'Armory South Exit Door' }
    ],
    makeProps: (cx, cz) => [
      { minX: cx - 7.4, maxX: cx - 3.6, minZ: cz - 7.0, maxZ: cz - 5.6, height: 1.9, kind: 'shelf' },
      { minX: cx + 3.6, maxX: cx + 7.4, minZ: cz - 7.0, maxZ: cz - 5.6, height: 1.9, kind: 'shelf' },
      { minX: cx - 7.2, maxX: cx - 3.5, minZ: cz + 5.6, maxZ: cz + 7.0, height: 0.9, kind: 'bed' },
      { minX: cx + 3.6, maxX: cx + 7.4, minZ: cz + 5.6, maxZ: cz + 6.9, height: 1.2, kind: 'counter' }
    ],
    makeLights: (cx, cz) => [
      { x: cx - 4.0, z: cz, flickerSeed: 1.7 },
      { x: cx + 4.0, z: cz, flickerSeed: 3.1 }
    ]
  }
];

export const LAB_HAZARD_PLACEMENTS: Array<{
  kind: 'fuel_truck' | 'fuel_barrel';
  x: number;
  z: number;
  rotationY: number;
  label: string;
}> = [
  { kind: 'fuel_barrel', x: -24.5, z: -131.5, rotationY: 0.2, label: 'Bio-Lock 1 West Fuel Drums' },
  { kind: 'fuel_barrel', x: 24.5, z: -131.5, rotationY: -0.2, label: 'Bio-Lock 1 East Fuel Drums' },
  { kind: 'fuel_barrel', x: -6.5, z: -92.0, rotationY: 0.15, label: 'Cryo Hall Hazmat Drums' },
  { kind: 'fuel_barrel', x: 6.5, z: -68.0, rotationY: -0.15, label: 'Cryo Valve Fuel Drums' },
  { kind: 'fuel_truck', x: -21.0, z: 14.5, rotationY: 0.14, label: 'Reactor Bio-Lock 2 Tanker' },
  { kind: 'fuel_barrel', x: 21.5, z: 14.5, rotationY: -0.25, label: 'Reactor East Hazmat Drums' },
  { kind: 'fuel_truck', x: -25.2, z: 88.0, rotationY: 0.12, label: 'West Freight Bay Fuel Tanker' },
  { kind: 'fuel_barrel', x: -18.8, z: 91.5, rotationY: 0.35, label: 'West Freight Hazmat Drums' },
  { kind: 'fuel_truck', x: 25.2, z: 88.0, rotationY: -0.12, label: 'East Freight Bay Fuel Tanker' },
  { kind: 'fuel_barrel', x: 18.8, z: 91.5, rotationY: -0.35, label: 'East Freight Hazmat Drums' },
  { kind: 'fuel_barrel', x: 0, z: 102.0, rotationY: 0.1, label: 'Generator Spine Fuel Drums' },
  { kind: 'fuel_truck', x: -27.5, z: 132.0, rotationY: 0.22, label: 'West Garage Fuel Tanker' },
  { kind: 'fuel_truck', x: 27.5, z: 132.0, rotationY: -0.22, label: 'East Garage Fuel Tanker' }
];

export const LAB_WAYFINDING_SIGNS: WayfindingSignData[] = [
  {
    x: 0,
    z: -134,
    y: 6.0,
    width: 8.0,
    height: 1.85,
    rotationY: 0,
    title: 'SECTOR 0 BREACH ↓',
    subtitle: 'PROCEED SOUTH THROUGH BIO-LOCK 1',
    accentColor: '#ef4444',
    gantrySpan: 13.0
  },
  {
    x: -24,
    z: -102,
    y: 6.0,
    width: 7.4,
    height: 1.8,
    rotationY: 0,
    title: 'CRYO & GENETICS WINGS ↓',
    subtitle: 'LOCKABLE LAB CORRIDORS • AMMO SOUTH',
    accentColor: '#38bdf8',
    gantrySpan: 12.6
  },
  {
    x: 24,
    z: -102,
    y: 6.0,
    width: 7.4,
    height: 1.8,
    rotationY: 0,
    title: 'CRYO SPECIMEN WING ↓',
    subtitle: 'CHECK MEDKITS & BYPASS HALL',
    accentColor: '#22d3ee',
    gantrySpan: 12.6
  },
  {
    x: -24,
    z: 10,
    y: 6.0,
    width: 7.6,
    height: 1.85,
    rotationY: 0,
    title: 'REACTOR CATWALK ↑ • BIO-LOCK 2 ↓',
    subtitle: 'HOLD ATRIUM OR RETREAT SOUTH',
    accentColor: '#f59e0b',
    gantrySpan: 12.6
  },
  {
    x: 24,
    z: 10,
    y: 6.0,
    width: 7.6,
    height: 1.85,
    rotationY: 0,
    title: 'BIO-LOCK 2 • MAIN SEAL ↓',
    subtitle: 'SECURITY ARMORY 35m SOUTH',
    accentColor: '#f59e0b',
    gantrySpan: 12.6
  },
  {
    x: 0,
    z: 70,
    y: 6.0,
    width: 7.8,
    height: 1.85,
    rotationY: 0,
    title: 'LOW-POWER HAZMAT BAY ↓',
    subtitle: 'CHECK FLASHLIGHT [T] • EXTRACTION GARAGE 75m',
    accentColor: '#f97316',
    gantrySpan: 13.0
  },
  {
    x: -24,
    z: 106,
    y: 6.0,
    width: 7.4,
    height: 1.85,
    rotationY: 0,
    title: 'BULKHEAD 3 • EXTRACTION GARAGE ↓',
    subtitle: 'APC-01 ARMORED ESCAPE AHEAD',
    accentColor: '#22c55e',
    gantrySpan: 12.6
  },
  {
    x: 24,
    z: 106,
    y: 6.0,
    width: 7.4,
    height: 1.85,
    rotationY: 0,
    title: 'BULKHEAD 3 • APC-01 BAY ↓',
    subtitle: 'HOLD 40s WARMUP FOR TUNNEL ESCAPE',
    accentColor: '#22c55e',
    gantrySpan: 12.6
  }
];
