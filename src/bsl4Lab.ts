import type {
  BuildingInteriorData,
  InteriorBox,
  LabContainmentPodData,
  LabDeviceData,
  SkybridgeData,
  WayfindingSignData
} from './types';

export const LAB_HALF_X = 52;
export const LAB_HALF_Z = 176;
export const LAB_CEILING_Y = 6.2;
export const LAB_REACTOR_CEILING_Y = 8.4;
export const LAB_APC_START_Z = 146;
export const LAB_TUNNEL_GATE_Z = 158;
export const LAB_EXIT_Z = 174;
export const LAB_APC_WARMUP_SECONDS = 40;

export const LAB_AIRLOCK_ZS = [-123, 24, 114] as const;

export const LAB_ROAD_XS = [-52, -36, -20, -8, 0, 8, 20, 36, 52] as const;
export const LAB_ROAD_ZS = [-176, -129, -117, -92, -64, -18, 18, 30, 70, 108, 120, 156, 176] as const;

export const LAB_REACTOR_CORE = { x: 0, z: -2, radius: 3.1 } as const;

export function getBsl4DistrictAtPos(_x: number, z: number): string {
  if (z < -129) return 'Zone 1 • Sector 0 Containment Vault';
  if (z < -92) return 'Zone 2 • Quarantine & Airlock Alpha';
  if (z < -64) return 'Zone 3 • Cryo Vault & Biobank';
  if (z < -18) return 'Zone 4 • Genetics & Autopsy Wing';
  if (z < 18) return 'Zone 5 • Vaulted Reactor Core';
  if (z < 70) return 'Zone 6 • Airlock Beta & Security Command';
  if (z < 108) return 'Zone 7 • Generator & Hazmat Bay';
  return 'Zone 8 • Airlock Gamma & Extraction Garage';
}

export const LAB_WALL_DEFS: Array<{
  z: number;
  height: number;
  thickness: number;
  label: string;
  layerIndex: number;
  gateXs: number[];
}> = [];

export const LAB_SKYBRIDGES: SkybridgeData[] = [
  {
    axis: 'EW',
    x: -18,
    z: -2,
    length: 14.0,
    width: 3.2,
    deckY: 4.6,
    label: 'West Reactor Catwalk',
    ladderXs: [-23.4, -12.6]
  },
  {
    axis: 'EW',
    x: 18,
    z: -2,
    length: 14.0,
    width: 3.2,
    deckY: 4.6,
    label: 'East Reactor Catwalk',
    ladderXs: [12.6, 23.4]
  }
];

export function createInitialLabPods(): LabContainmentPodData[] {
  const zRows = [-166, -157, -148, -139];
  const breachTimes = [2.1, 1.2, 4.5, 6.0, 9.5, 11.2, 14.5, 16.2];
  const pods: LabContainmentPodData[] = [];
  let idx = 0;
  for (let r = 0; r < zRows.length; r++) {
    for (const px of [-10, 10]) {
      idx++;
      pods.push({
        id: idx,
        x: px,
        z: zRows[r],
        breached: false,
        breachAt: breachTimes[idx - 1],
        label: idx === 1 ? 'Specimen Pod 01 (Subject-00 TYRANT)' : `Containment Pod 0${idx}`
      });
    }
  }
  return pods;
}

export const LAB_TURRET_POSITIONS = [
  { x: -7.5, z: 42 },
  { x: 7.5, z: 42 }
] as const;

export function createInitialLabDevices(): LabDeviceData[] {
  return [
    {
      id: 1,
      kind: 'cryo_valve',
      x: -4.8,
      z: -70,
      label: 'Cryo Purge Valve',
      state: 'ready',
      timer: 0,
      maxDuration: 8,
      cooldown: 0,
      cooldownDuration: 28,
      zoneZMin: -96,
      zoneZMax: -56
    },
    {
      id: 2,
      kind: 'turret_console',
      x: -8.6,
      z: 54,
      label: 'Security Turret Terminal',
      state: 'ready',
      timer: 0,
      maxDuration: 25,
      cooldown: 0,
      cooldownDuration: 35,
      zoneZMin: 30,
      zoneZMax: 70
    },
    {
      id: 3,
      kind: 'backup_generator',
      x: -30.5,
      z: 89,
      label: 'Backup Power Generator',
      state: 'ready',
      timer: 0,
      maxDuration: 0,
      cooldown: 0,
      cooldownDuration: 0,
      zoneZMin: 70,
      zoneZMax: 112
    }
  ];
}

export interface LabDoorSpec {
  side: 'N' | 'S' | 'E' | 'W';
  offset: number;
  width: number;
  isGlass: boolean;
  label: string;
  isAirlock?: boolean;
  airlockLine?: 1 | 2 | 3;
  maxIntegrity?: number;
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
  doors: LabDoorSpec[];
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
    x: -21,
    z: -78,
    width: 30,
    depth: 28,
    height: LAB_CEILING_Y,
    color: 0x26384d,
    accentColor: 0x38bdf8,
    theme: 'lab_cryo',
    shelterCapacity: 20,
    doors: [
      { side: 'E', offset: 0, width: 3.6, isGlass: true, label: 'Cryo Biobank East Glass Door' },
      { side: 'N', offset: -5, width: 3.4, isGlass: true, label: 'Cryo Biobank North Airlock Door' },
      { side: 'S', offset: -5, width: 3.4, isGlass: false, label: 'Cryo Biobank South Exit Door' }
    ],
    makeProps: (cx, cz) => [
      { minX: cx - 12.2, maxX: cx - 8.2, minZ: cz - 11.2, maxZ: cz - 9.4, height: 2.35, kind: 'cryo_tank' },
      { minX: cx + 7.2, maxX: cx + 11.4, minZ: cz - 11.2, maxZ: cz - 9.4, height: 2.35, kind: 'cryo_tank' },
      { minX: cx - 12.2, maxX: cx - 8.2, minZ: cz + 9.4, maxZ: cz + 11.2, height: 2.35, kind: 'cryo_tank' },
      { minX: cx + 7.2, maxX: cx + 11.4, minZ: cz + 9.4, maxZ: cz + 11.2, height: 1.15, kind: 'lab_bench' }
    ],
    makeLights: (cx, cz) => [
      { x: cx - 6.0, z: cz, flickerSeed: 0.7 },
      { x: cx + 6.0, z: cz, flickerSeed: 2.1 },
      { x: cx, z: cz + 6.0, flickerSeed: 3.5 }
    ]
  },
  {
    id: 'BLD-LAB-CRYO-E',
    name: 'Cryo Specimen Lab East',
    district: 'Zone 3 • Cryo Vault & Biobank',
    row: 3,
    col: 4,
    x: 21,
    z: -78,
    width: 30,
    depth: 28,
    height: LAB_CEILING_Y,
    color: 0x26384d,
    accentColor: 0x22d3ee,
    theme: 'lab_cryo',
    shelterCapacity: 20,
    doors: [
      { side: 'W', offset: 0, width: 3.6, isGlass: true, label: 'Cryo Lab West Glass Door' },
      { side: 'N', offset: 5, width: 3.4, isGlass: true, label: 'Cryo Lab North Airlock Door' },
      { side: 'S', offset: 5, width: 3.4, isGlass: false, label: 'Cryo Lab South Exit Door' }
    ],
    makeProps: (cx, cz) => [
      { minX: cx - 11.4, maxX: cx - 7.2, minZ: cz - 11.2, maxZ: cz - 9.4, height: 2.1, kind: 'server_rack' },
      { minX: cx + 8.2, maxX: cx + 12.2, minZ: cz - 11.2, maxZ: cz - 9.4, height: 2.35, kind: 'cryo_tank' },
      { minX: cx - 11.4, maxX: cx - 7.2, minZ: cz + 9.4, maxZ: cz + 11.2, height: 2.35, kind: 'cryo_tank' },
      { minX: cx + 8.2, maxX: cx + 12.2, minZ: cz + 9.4, maxZ: cz + 11.2, height: 1.15, kind: 'lab_bench' }
    ],
    makeLights: (cx, cz) => [
      { x: cx - 6.0, z: cz, flickerSeed: 1.2 },
      { x: cx + 6.0, z: cz, flickerSeed: 2.8 },
      { x: cx, z: cz - 6.0, flickerSeed: 4.3 }
    ]
  },
  {
    id: 'BLD-LAB-AUTOPSY',
    name: 'Virology & Autopsy Suite',
    district: 'Zone 4 • Genetics & Autopsy Wing',
    row: 4,
    col: 1,
    x: -26,
    z: -40,
    width: 20,
    depth: 28,
    height: LAB_CEILING_Y,
    color: 0x334155,
    accentColor: 0xf43f5e,
    theme: 'lab_bio',
    shelterCapacity: 22,
    doors: [
      { side: 'E', offset: 0, width: 3.4, isGlass: true, label: 'Autopsy East Corridor Glass Door' },
      { side: 'N', offset: 0, width: 3.4, isGlass: true, label: 'Autopsy North Entry Door' },
      { side: 'S', offset: 0, width: 3.4, isGlass: false, label: 'Autopsy South Exit Door' }
    ],
    makeProps: (cx, cz) => [
      { minX: cx - 7.6, maxX: cx - 4.0, minZ: cz - 10.6, maxZ: cz - 8.6, height: 1.05, kind: 'lab_bench' },
      { minX: cx + 4.0, maxX: cx + 7.6, minZ: cz - 10.6, maxZ: cz - 8.6, height: 1.05, kind: 'lab_bench' },
      { minX: cx - 7.6, maxX: cx - 4.0, minZ: cz + 8.6, maxZ: cz + 10.6, height: 1.15, kind: 'lab_bench' },
      { minX: cx + 4.0, maxX: cx + 7.6, minZ: cz + 8.6, maxZ: cz + 10.6, height: 2.1, kind: 'server_rack' }
    ],
    makeLights: (cx, cz) => [
      { x: cx - 4.0, z: cz, flickerSeed: 1.9 },
      { x: cx + 4.0, z: cz, flickerSeed: 3.4 },
      { x: cx, z: cz + 5.0, flickerSeed: 5.1 }
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
    width: 16,
    depth: 24,
    height: LAB_CEILING_Y,
    color: 0x1e3a5f,
    accentColor: 0x10b981,
    theme: 'lab_bio',
    shelterCapacity: 24,
    doors: [
      { side: 'W', offset: 0, width: 3.4, isGlass: true, label: 'Genetics West Glass Door' },
      { side: 'E', offset: 0, width: 3.4, isGlass: true, label: 'Genetics East Glass Door' },
      { side: 'N', offset: 0, width: 3.4, isGlass: true, label: 'Genetics North Airlock Door' },
      { side: 'S', offset: 0, width: 3.4, isGlass: true, label: 'Genetics South Atrium Door' }
    ],
    makeProps: (cx, cz) => [
      { minX: cx - 6.0, maxX: cx - 3.2, minZ: cz - 8.6, maxZ: cz - 6.8, height: 1.15, kind: 'lab_bench' },
      { minX: cx + 3.2, maxX: cx + 6.0, minZ: cz - 8.6, maxZ: cz - 6.8, height: 2.1, kind: 'server_rack' },
      { minX: cx - 6.0, maxX: cx - 3.2, minZ: cz + 6.8, maxZ: cz + 8.6, height: 2.1, kind: 'server_rack' },
      { minX: cx + 3.2, maxX: cx + 6.0, minZ: cz + 6.8, maxZ: cz + 8.6, height: 1.15, kind: 'lab_bench' }
    ],
    makeLights: (cx, cz) => [
      { x: cx - 3.2, z: cz - 4.0, flickerSeed: 0.4 },
      { x: cx + 3.2, z: cz + 4.0, flickerSeed: 2.6 }
    ]
  },
  {
    id: 'BLD-LAB-CLEANROOM',
    name: 'BSL-4 Cleanroom Wing',
    district: 'Zone 4 • Genetics & Autopsy Wing',
    row: 4,
    col: 4,
    x: 26,
    z: -40,
    width: 20,
    depth: 28,
    height: LAB_CEILING_Y,
    color: 0x3b4d63,
    accentColor: 0x38bdf8,
    theme: 'lab_cryo',
    shelterCapacity: 22,
    doors: [
      { side: 'W', offset: 0, width: 3.4, isGlass: true, label: 'Cleanroom West Glass Door' },
      { side: 'N', offset: 0, width: 3.4, isGlass: true, label: 'Cleanroom North Entry Door' },
      { side: 'S', offset: 0, width: 3.4, isGlass: false, label: 'Cleanroom South Exit Door' }
    ],
    makeProps: (cx, cz) => [
      { minX: cx - 7.6, maxX: cx - 4.0, minZ: cz - 10.6, maxZ: cz - 8.6, height: 2.1, kind: 'server_rack' },
      { minX: cx + 4.0, maxX: cx + 7.6, minZ: cz - 10.6, maxZ: cz - 8.6, height: 2.35, kind: 'cryo_tank' },
      { minX: cx - 7.6, maxX: cx - 4.0, minZ: cz + 8.6, maxZ: cz + 10.6, height: 1.15, kind: 'lab_bench' },
      { minX: cx + 4.0, maxX: cx + 7.6, minZ: cz + 8.6, maxZ: cz + 10.6, height: 1.15, kind: 'lab_bench' }
    ],
    makeLights: (cx, cz) => [
      { x: cx - 4.0, z: cz, flickerSeed: 1.5 },
      { x: cx + 4.0, z: cz, flickerSeed: 3.9 }
    ]
  },
  {
    id: 'BLD-LAB-SEC-CMD',
    name: 'Security Command Center',
    district: 'Zone 6 • Airlock Beta & Security Command',
    row: 6,
    col: 1,
    x: -23,
    z: 50,
    width: 26,
    depth: 26,
    height: LAB_CEILING_Y,
    color: 0x1e293b,
    accentColor: 0x38bdf8,
    theme: 'lab_armory',
    shelterCapacity: 26,
    doors: [
      { side: 'E', offset: 0, width: 3.6, isGlass: true, label: 'Command Center East Glass Door' },
      { side: 'N', offset: 3, width: 3.4, isGlass: false, label: 'Command Center North Door' },
      { side: 'S', offset: 3, width: 3.4, isGlass: false, label: 'Command Center South Door' }
    ],
    makeProps: (cx, cz) => [
      { minX: cx - 10.2, maxX: cx - 5.2, minZ: cz - 9.8, maxZ: cz - 7.8, height: 2.2, kind: 'server_rack' },
      { minX: cx + 5.8, maxX: cx + 10.2, minZ: cz - 9.8, maxZ: cz - 7.8, height: 2.2, kind: 'server_rack' },
      { minX: cx - 10.2, maxX: cx - 5.2, minZ: cz + 7.8, maxZ: cz + 9.8, height: 1.15, kind: 'lab_bench' },
      { minX: cx + 5.8, maxX: cx + 10.2, minZ: cz + 7.8, maxZ: cz + 9.8, height: 2.05, kind: 'weapon_rack' }
    ],
    makeLights: (cx, cz) => [
      { x: cx - 5.0, z: cz, flickerSeed: 0.8 },
      { x: cx + 5.0, z: cz, flickerSeed: 2.3 }
    ]
  },
  {
    id: 'BLD-LAB-ARMORY',
    name: 'Tactical Armory & Infirmary',
    district: 'Zone 6 • Airlock Beta & Security Command',
    row: 6,
    col: 4,
    x: 23,
    z: 50,
    width: 26,
    depth: 26,
    height: LAB_CEILING_Y,
    color: 0x293548,
    accentColor: 0xf59e0b,
    theme: 'lab_armory',
    shelterCapacity: 24,
    doors: [
      { side: 'W', offset: 0, width: 3.6, isGlass: true, label: 'Armory West Corridor Glass Door' },
      { side: 'N', offset: -3, width: 3.4, isGlass: false, label: 'Armory North Security Door' },
      { side: 'S', offset: -3, width: 3.4, isGlass: false, label: 'Armory South Exit Door' }
    ],
    makeProps: (cx, cz) => [
      { minX: cx - 10.2, maxX: cx - 5.8, minZ: cz - 9.8, maxZ: cz - 7.8, height: 2.05, kind: 'weapon_rack' },
      { minX: cx + 5.2, maxX: cx + 10.2, minZ: cz - 9.8, maxZ: cz - 7.8, height: 2.05, kind: 'weapon_rack' },
      { minX: cx - 10.2, maxX: cx - 5.8, minZ: cz + 7.8, maxZ: cz + 9.8, height: 1.05, kind: 'lab_bench' },
      { minX: cx + 5.2, maxX: cx + 10.2, minZ: cz + 7.8, maxZ: cz + 9.8, height: 1.15, kind: 'lab_bench' }
    ],
    makeLights: (cx, cz) => [
      { x: cx - 5.0, z: cz, flickerSeed: 1.7 },
      { x: cx + 5.0, z: cz, flickerSeed: 3.1 }
    ]
  }
];

function makeAirlockSpec(
  id: string,
  name: string,
  district: string,
  line: 1 | 2 | 3,
  x: number,
  z: number,
  width: number,
  doorWidth: number,
  maxIntegrity: number,
  prefix: string,
  flickerOffset: number
): LabInteriorRoomSpec {
  return {
    id,
    name,
    district,
    row: line * 2,
    col: x < 0 ? 1 : x > 0 ? 3 : 2,
    x,
    z,
    width,
    depth: 12,
    height: LAB_CEILING_Y,
    color: 0x1e293b,
    accentColor: line === 1 ? 0xef4444 : line === 2 ? 0xf59e0b : 0x22c55e,
    theme: 'lab_airlock',
    shelterCapacity: 0,
    doors: [
      {
        side: 'N',
        offset: 0,
        width: doorWidth,
        isGlass: true,
        isAirlock: true,
        airlockLine: line,
        maxIntegrity,
        label: `${prefix} North Blast Glass`
      },
      {
        side: 'S',
        offset: 0,
        width: doorWidth,
        isGlass: true,
        isAirlock: true,
        airlockLine: line,
        maxIntegrity,
        label: `${prefix} South Blast Glass`
      }
    ],
    makeProps: () => [],
    makeLights: (cx, cz) => [
      { x: cx, z: cz, flickerSeed: flickerOffset }
    ]
  };
}

export const LAB_AIRLOCK_ROOMS: LabInteriorRoomSpec[] = [
  makeAirlockSpec(
    'BLD-LAB-AIRLOCK-1W',
    'Airlock Alpha West Chamber',
    'Zone 2 • Quarantine & Airlock Alpha',
    1,
    -26,
    -123,
    12,
    4.2,
    220,
    'Airlock Alpha West',
    0.5
  ),
  makeAirlockSpec(
    'BLD-LAB-AIRLOCK-1C',
    'Airlock Alpha Central Chamber',
    'Zone 2 • Quarantine & Airlock Alpha',
    1,
    0,
    -123,
    16,
    5.0,
    280,
    'Airlock Alpha',
    1.1
  ),
  makeAirlockSpec(
    'BLD-LAB-AIRLOCK-1E',
    'Airlock Alpha East Chamber',
    'Zone 2 • Quarantine & Airlock Alpha',
    1,
    26,
    -123,
    12,
    4.2,
    220,
    'Airlock Alpha East',
    1.7
  ),
  makeAirlockSpec(
    'BLD-LAB-AIRLOCK-2W',
    'Airlock Beta West Chamber',
    'Zone 6 • Airlock Beta & Security Command',
    2,
    -20,
    24,
    12,
    4.2,
    220,
    'Airlock Beta West',
    2.2
  ),
  makeAirlockSpec(
    'BLD-LAB-AIRLOCK-2C',
    'Airlock Beta Central Chamber',
    'Zone 6 • Airlock Beta & Security Command',
    2,
    0,
    24,
    14,
    4.8,
    280,
    'Airlock Beta',
    2.9
  ),
  makeAirlockSpec(
    'BLD-LAB-AIRLOCK-2E',
    'Airlock Beta East Chamber',
    'Zone 6 • Airlock Beta & Security Command',
    2,
    20,
    24,
    12,
    4.2,
    220,
    'Airlock Beta East',
    3.5
  ),
  makeAirlockSpec(
    'BLD-LAB-AIRLOCK-3W',
    'Airlock Gamma West Chamber',
    'Zone 8 • Airlock Gamma & Extraction Garage',
    3,
    -20.5,
    114,
    11,
    4.0,
    240,
    'Airlock Gamma West',
    4.1
  ),
  makeAirlockSpec(
    'BLD-LAB-AIRLOCK-3C',
    'Airlock Gamma Central Chamber',
    'Zone 8 • Airlock Gamma & Extraction Garage',
    3,
    0,
    114,
    16,
    5.4,
    300,
    'Airlock Gamma',
    4.7
  ),
  makeAirlockSpec(
    'BLD-LAB-AIRLOCK-3E',
    'Airlock Gamma East Chamber',
    'Zone 8 • Airlock Gamma & Extraction Garage',
    3,
    20.5,
    114,
    11,
    4.0,
    240,
    'Airlock Gamma East',
    5.3
  )
];

export const LAB_SOLID_BULKHEADS: Array<{
  id: string;
  name: string;
  district: string;
  x: number;
  z: number;
  w: number;
  d: number;
  color: number;
  accent: number;
}> = [
  // Zone 1 bedrock sidewalls (-176..-129, leaving x in [-32, +32] open)
  { id: 'BLD-LAB-Z1-W', name: 'Sector 0 Bedrock Massif West', district: 'Zone 1 • Sector 0 Containment Vault', x: -42, z: -152.5, w: 20, d: 47, color: 0x0f172a, accent: 0x10b981 },
  { id: 'BLD-LAB-Z1-E', name: 'Sector 0 Bedrock Massif East', district: 'Zone 1 • Sector 0 Containment Vault', x: 42, z: -152.5, w: 20, d: 47, color: 0x0f172a, accent: 0x10b981 },

  // Line 1 Airlock Alpha Partition Wall (-129..-117 across x in [-52, +52])
  { id: 'BLD-LAB-L1-OW', name: 'Airlock Alpha West Bulkhead', district: 'Zone 2 • Quarantine & Airlock Alpha', x: -42, z: -123, w: 20, d: 12, color: 0x141d2b, accent: 0xef4444 },
  { id: 'BLD-LAB-L1-IW', name: 'Airlock Alpha West Pillar', district: 'Zone 2 • Quarantine & Airlock Alpha', x: -14, z: -123, w: 12, d: 12, color: 0x1e293b, accent: 0xef4444 },
  { id: 'BLD-LAB-L1-IE', name: 'Airlock Alpha East Pillar', district: 'Zone 2 • Quarantine & Airlock Alpha', x: 14, z: -123, w: 12, d: 12, color: 0x1e293b, accent: 0xef4444 },
  { id: 'BLD-LAB-L1-OE', name: 'Airlock Alpha East Bulkhead', district: 'Zone 2 • Quarantine & Airlock Alpha', x: 42, z: -123, w: 20, d: 12, color: 0x141d2b, accent: 0xef4444 },

  // Zone 2-3 bedrock sidewalls (-117..-64, flush with Cryo Lab walls at x=+-36)
  { id: 'BLD-LAB-Z23-W', name: 'Cryo Wing Bedrock Wall West', district: 'Zone 3 • Cryo Vault & Biobank', x: -44, z: -90.5, w: 16, d: 53, color: 0x0f172a, accent: 0x38bdf8 },
  { id: 'BLD-LAB-Z23-E', name: 'Cryo Wing Bedrock Wall East', district: 'Zone 3 • Cryo Vault & Biobank', x: 44, z: -90.5, w: 16, d: 53, color: 0x0f172a, accent: 0x38bdf8 },

  // Zone 4 bedrock sidewalls (-64..-18, flush with Autopsy/Cleanroom walls at x=+-36)
  { id: 'BLD-LAB-Z4-W', name: 'Autopsy Bedrock Wall West', district: 'Zone 4 • Genetics & Autopsy Wing', x: -44, z: -41, w: 16, d: 46, color: 0x0f172a, accent: 0x10b981 },
  { id: 'BLD-LAB-Z4-E', name: 'Cleanroom Bedrock Wall East', district: 'Zone 4 • Genetics & Autopsy Wing', x: 44, z: -41, w: 16, d: 46, color: 0x0f172a, accent: 0x38bdf8 },

  // Zone 5 Reactor Atrium bedrock/coolant massifs (-18..+18, leaving x in [-34, +34] open)
  { id: 'BLD-LAB-REACT-W', name: 'Reactor Coolant Massif West', district: 'Zone 5 • Vaulted Reactor Core', x: -43, z: 0, w: 18, d: 36, color: 0x172334, accent: 0x38bdf8 },
  { id: 'BLD-LAB-REACT-E', name: 'Reactor Coolant Massif East', district: 'Zone 5 • Vaulted Reactor Core', x: 43, z: 0, w: 18, d: 36, color: 0x172334, accent: 0x38bdf8 },

  // Line 2 Airlock Beta Partition Wall (+18..+30 across x in [-52, +52])
  { id: 'BLD-LAB-L2-OW', name: 'Airlock Beta West Bulkhead', district: 'Zone 6 • Airlock Beta & Security Command', x: -39, z: 24, w: 26, d: 12, color: 0x141d2b, accent: 0xf59e0b },
  { id: 'BLD-LAB-L2-IW', name: 'Airlock Beta West Pillar', district: 'Zone 6 • Airlock Beta & Security Command', x: -10.5, z: 24, w: 7, d: 12, color: 0x1e293b, accent: 0xf59e0b },
  { id: 'BLD-LAB-L2-IE', name: 'Airlock Beta East Pillar', district: 'Zone 6 • Airlock Beta & Security Command', x: 10.5, z: 24, w: 7, d: 12, color: 0x1e293b, accent: 0xf59e0b },
  { id: 'BLD-LAB-L2-OE', name: 'Airlock Beta East Bulkhead', district: 'Zone 6 • Airlock Beta & Security Command', x: 39, z: 24, w: 26, d: 12, color: 0x141d2b, accent: 0xf59e0b },

  // Zone 6 bedrock sidewalls (+30..+70, flush with Security Command / Armory at x=+-36)
  { id: 'BLD-LAB-Z6-W', name: 'Security Bedrock Wall West', district: 'Zone 6 • Airlock Beta & Security Command', x: -44, z: 50, w: 16, d: 40, color: 0x0f172a, accent: 0x38bdf8 },
  { id: 'BLD-LAB-Z6-E', name: 'Armory Bedrock Wall East', district: 'Zone 6 • Airlock Beta & Security Command', x: 44, z: 50, w: 16, d: 40, color: 0x0f172a, accent: 0xf59e0b },

  // Zone 7 Generator & Hazmat bedrock sidewalls (+70..+108, leaving x in [-34, +34] open)
  { id: 'BLD-LAB-GEN-W', name: 'Hazmat Bay Bedrock West', district: 'Zone 7 • Generator & Hazmat Bay', x: -43, z: 89, w: 18, d: 38, color: 0x141d2b, accent: 0xf59e0b },
  { id: 'BLD-LAB-GEN-E', name: 'Hazmat Bay Bedrock East', district: 'Zone 7 • Generator & Hazmat Bay', x: 43, z: 89, w: 18, d: 38, color: 0x141d2b, accent: 0xf59e0b },

  // Line 3 Airlock Gamma Partition Wall (+108..+120 across x in [-52, +52])
  { id: 'BLD-LAB-L3-OW', name: 'Airlock Gamma West Bulkhead', district: 'Zone 8 • Airlock Gamma & Extraction Garage', x: -39, z: 114, w: 26, d: 12, color: 0x141d2b, accent: 0x22c55e },
  { id: 'BLD-LAB-L3-IW', name: 'Airlock Gamma West Pillar', district: 'Zone 8 • Airlock Gamma & Extraction Garage', x: -11.5, z: 114, w: 7, d: 12, color: 0x1e293b, accent: 0x22c55e },
  { id: 'BLD-LAB-L3-IE', name: 'Airlock Gamma East Pillar', district: 'Zone 8 • Airlock Gamma & Extraction Garage', x: 11.5, z: 114, w: 7, d: 12, color: 0x1e293b, accent: 0x22c55e },
  { id: 'BLD-LAB-L3-OE', name: 'Airlock Gamma East Bulkhead', district: 'Zone 8 • Airlock Gamma & Extraction Garage', x: 39, z: 114, w: 26, d: 12, color: 0x141d2b, accent: 0x22c55e },

  // Zone 8 Garage sidewalls (+120..+156, leaving x in [-36, +36] open) & Escape Tunnel mountain rock (+156..+176)
  { id: 'BLD-LAB-Z8-W', name: 'Garage Bedrock Wall West', district: 'Zone 8 • Airlock Gamma & Extraction Garage', x: -44, z: 138, w: 16, d: 36, color: 0x0f172a, accent: 0x22c55e },
  { id: 'BLD-LAB-Z8-E', name: 'Garage Bedrock Wall East', district: 'Zone 8 • Airlock Gamma & Extraction Garage', x: 44, z: 138, w: 16, d: 36, color: 0x0f172a, accent: 0x22c55e },
  { id: 'BLD-LAB-TUNNEL-W', name: 'Escape Tunnel Bedrock West', district: 'Zone 8 • Airlock Gamma & Extraction Garage', x: -31.5, z: 166, w: 41, d: 20, color: 0x0b101b, accent: 0x22c55e },
  { id: 'BLD-LAB-TUNNEL-E', name: 'Escape Tunnel Bedrock East', district: 'Zone 8 • Airlock Gamma & Extraction Garage', x: 31.5, z: 166, w: 41, d: 20, color: 0x0b101b, accent: 0x22c55e }
];

export const LAB_HAZARD_PLACEMENTS: Array<{
  kind: 'fuel_truck' | 'fuel_barrel';
  x: number;
  z: number;
  rotationY: number;
  label: string;
}> = [
  { kind: 'fuel_barrel', x: -19.5, z: -133, rotationY: 0.2, label: 'Airlock Alpha West Fuel Drums' },
  { kind: 'fuel_barrel', x: 19.5, z: -133, rotationY: -0.2, label: 'Airlock Alpha East Fuel Drums' },
  { kind: 'fuel_barrel', x: 4.5, z: -86, rotationY: 0.15, label: 'Cryo Hall Hazmat Drums' },
  { kind: 'fuel_barrel', x: 4.5, z: -69, rotationY: -0.15, label: 'Cryo Valve Fuel Drums' },
  { kind: 'fuel_barrel', x: -28.0, z: 11.5, rotationY: 0.18, label: 'Reactor Atrium West Drums' },
  { kind: 'fuel_barrel', x: 28.0, z: 11.5, rotationY: -0.18, label: 'Reactor Atrium East Drums' },
  { kind: 'fuel_truck', x: -11.5, z: 88, rotationY: 0.08, label: 'West Hazmat Bay Fuel Tanker' },
  { kind: 'fuel_barrel', x: -5.2, z: 98.5, rotationY: 0.3, label: 'Generator Corridor Drums' },
  { kind: 'fuel_truck', x: 11.5, z: 88, rotationY: -0.08, label: 'East Hazmat Bay Fuel Tanker' },
  { kind: 'fuel_barrel', x: 5.2, z: 98.5, rotationY: -0.3, label: 'East Hazmat Spine Drums' },
  { kind: 'fuel_truck', x: -22.5, z: 132, rotationY: 0.16, label: 'West Garage Fuel Tanker' },
  { kind: 'fuel_truck', x: 22.5, z: 132, rotationY: -0.16, label: 'East Garage Fuel Tanker' }
];

export const LAB_WAYFINDING_SIGNS: WayfindingSignData[] = [
  {
    x: 0,
    z: -132,
    y: 4.7,
    width: 7.4,
    height: 1.65,
    rotationY: 0,
    title: 'SECTOR 0 BREACH ↓',
    subtitle: 'ENTER AIRLOCK α TO QUARANTINE WING',
    accentColor: '#ef4444',
    gantrySpan: 11.5
  },
  {
    x: 0,
    z: -95,
    y: 4.7,
    width: 7.4,
    height: 1.65,
    rotationY: 0,
    title: 'CRYO SPINE CORRIDOR ↓',
    subtitle: 'CRYO PURGE VALVE AHEAD • LOCKABLE LAB SUITES',
    accentColor: '#38bdf8',
    gantrySpan: 11.5
  },
  {
    x: -12,
    z: -21,
    y: 4.7,
    width: 6.4,
    height: 1.55,
    rotationY: 0,
    title: 'WEST LAB CORRIDOR ↓',
    subtitle: 'REACTOR ATRIUM VAULT AHEAD',
    accentColor: '#10b981',
    gantrySpan: 7.8
  },
  {
    x: 12,
    z: -21,
    y: 4.7,
    width: 6.4,
    height: 1.55,
    rotationY: 0,
    title: 'EAST LAB CORRIDOR ↓',
    subtitle: 'REACTOR CATWALKS & AIRLOCK β',
    accentColor: '#22d3ee',
    gantrySpan: 7.8
  },
  {
    x: 0,
    z: 14,
    y: 6.1,
    width: 7.4,
    height: 1.75,
    rotationY: 0,
    title: 'AIRLOCK β • DECON SEAL ↓',
    subtitle: 'SECURITY COMMAND & ARMORY SOUTH',
    accentColor: '#f59e0b',
    gantrySpan: 11.5
  },
  {
    x: 0,
    z: 71,
    y: 4.7,
    width: 7.4,
    height: 1.65,
    rotationY: 0,
    title: 'LOW-POWER HAZMAT BAY ↓',
    subtitle: 'CHECK FLASHLIGHT [T] • RESTORE GENERATOR [-30, 89]',
    accentColor: '#f97316',
    gantrySpan: 11.5
  },
  {
    x: 0,
    z: 105,
    y: 4.7,
    width: 7.4,
    height: 1.65,
    rotationY: 0,
    title: 'AIRLOCK γ • EXTRACTION GARAGE ↓',
    subtitle: 'APC-01 TUNNEL ESCAPE BAY AHEAD',
    accentColor: '#22c55e',
    gantrySpan: 11.5
  }
];
