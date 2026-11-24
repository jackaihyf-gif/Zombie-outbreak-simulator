import { getTrainLayout, KTX_DEPARTURE_SECONDS, KTX_EMERGENCY_INFECTED, KTX_QUARANTINE_SECONDS, KTX_RAIL_EXTENSION,
  TRAIN_BOARDING_X, TRAIN_NOSE_LENGTH, TRAIN_SEAT_SIDES, TRAIN_WIDTH } from './trainLayout';
import { CityLayout } from './cityData';
import {
  BLAST_GATE_WIDTH, gateClearHalfWidth, GATE_CLOSE_SECONDS, GATE_OPEN_SECONDS,
  ladderZ, WALL_DECK_REAR_TRIM, WALL_DECK_RISE, wallDeckFrontZ, wallDeckSpan, wallGuardX, wallLadderXs,
  wallPostX, wallRetreatLadderXs, WALL_OUTER_POST_SLOTS, WALL_POST_SLOTS
} from './perimeter';
import { PLAYER_KILL_REWARD, PLAYER_LOADOUTS, PLAYER_WEAPONS } from './playerLoadouts';
import type { RadioCall, RadioTransmission } from './policeRadio';
import {
  KTX_BOXES, KTX_ENTRY, KTX_GATES, KTX_GATE_IDS, KTX_GROUND_ENTRIES, KTX_LANES, KTX_LAST_LINE_Z,
  KTX_PLATFORM_Y, KTX_SHOT_FLOORS, KTX_STATION_POSTS, KTX_TRANSFER_X,
  type KtxGateId, type KtxGates, type KtxLane, type KtxSurface,
  ktxGateBox, ktxCanWalkBetween, ktxContains, ktxGroundDetour, ktxGroundEscape, ktxGroundSegmentClear,
  ktxSurfaceAt, ktxSurfaceHeight, ktxWaypoint
} from './ktxTerminal';
import { generateAgentName, SeededRNG } from './rng';
import { hasLineOfSight, resolveWorldCollisions, segmentIntersectsAABB, SpatialGrid } from './spatial';
import { ShotTrace } from './shotTrace';
import {
  AgentData,
  AgentRole,
  AmmoCacheData,
  AlertBanner,
  BlastGateData,
  BrokenWindowData,
  BuildingData,
  DefenseWallData,
  EvacZoneData,
  EventLogItem,
  ExpressTrainData,
  FirstPersonState,
  HoldZoneData,
  IncidentReport,
  InteriorDoorData,
  LureFlareData,
  PlayerRole,
  PlayerSpawnPoint,
  PlayerWeapon,
  PrioritySectorData,
  RoadblockData,
  ScenarioConfig,
  SimulationStats,
  StaticObstacleData,
  SupplyPickupData,
  TimeSeriesPoint,
  TrainBulkheadDoorData,
  Vec2,
  VehicleData,
  VisualEffectEvent,
  ZombieVariant
} from './types';

const SHIRT_PALETTE = [
  0x38bdf8, 0x60a5fa, 0x34d399, 0xa78bfa, 0xf472b6,
  0xfbbf24, 0x94a3b8, 0xe2e8f0, 0x2dd4bf, 0x818cf8
];
const PANTS_PALETTE = [0x1e293b, 0x334155, 0x0f172a, 0x3f3f46, 0x27272a];
const SKIN_PALETTE = [0xfde68a, 0xfcd34d, 0xfdba74, 0xd97706, 0x92400e];
const VEHICLE_COLORS = [0x3b82f6, 0xe2e8f0, 0x64748b, 0xef4444, 0x10b981, 0x6366f1];

const PYRAMID_TIER_WIDTHS = [5, 3, 3, 2, 2, 1, 2];
const PYRAMID_CAPACITY = PYRAMID_TIER_WIDTHS.reduce((count, width) => count + width, 0);
const FALL_GRAVITY = 22;
const AMMO_CACHE_COOLDOWN = 20;
const HOLD_MISSION_RADIUS = 10;
const CLEAR_MISSION_RADIUS = 16;
const GROUND_GUARDS_PER_GATE = 2;
const INITIAL_WALL_GUARDS_PER_GATE = 6;
const WALL_GARRISON_SLOTS_PER_GATE = INITIAL_WALL_GUARDS_PER_GATE * 3;
const OUTER_GARRISON_SLOTS_PER_GATE = WALL_OUTER_POST_SLOTS * 3;
const GUARD_MUZZLE_HEIGHT = 1.35;
const GUARD_TARGET_HEIGHT = 1.15;

interface WallGuardPost {
  wall: DefenseWallData;
  x: number;
  slot: number;
  deckX: number;
  ladderX: number;
}

interface OfficerFallback {
  post: { wall: DefenseWallData | null; x: number; z: number };
  gate: BlastGateData | null;
  passingGate?: BlastGateData;
  ladder?: { x: number; wall: DefenseWallData; checkAt: number };
  nextWallPost?: WallGuardPost;
  cover?: { post: { wall: DefenseWallData; x: number; z: number }; until: number; checkAt: number };
}
const SHOTGUN_PATTERN = [[0, 0], [-0.035, 0.013], [0.034, -0.012], [-0.015, -0.038], [0.016, 0.034]];
const CENTER_SHOT = [[0, 0]];
export const SIEGE_WAVE_SIZES = [80, 94, 106, 118, 130, 142] as const;
const SIEGE_WAVE_INTERVAL = 28;

export type SoundTrigger = (
  type:
    | 'gunshot'
    | 'swat_shot'
    | 'player_pistol'
    | 'player_shotgun'
    | 'player_carbine'
    | 'player_reload'
    | 'radio'
    | 'cure'
    | 'bite'
    | 'siren'
    | 'explosion'
    | 'train_horn'
    | 'gate_slam'
    | 'window_shatter'
    | 'body_thud'
    | 'door_pound'
    | 'car_alarm',
  x: number,
  z: number
) => void;

export class OutbreakSimulation {
  public config: ScenarioConfig;
  public rng: SeededRNG;
  public city: CityLayout;
  public spatial: SpatialGrid;
  public onSound?: SoundTrigger;

  public agents: AgentData[] = [];
  public vehicles: VehicleData[] = [];
  public defenseWalls: DefenseWallData[] = [];
  public blastGates: BlastGateData[] = [];
  public expressTrain!: ExpressTrainData;
  public firstPerson!: FirstPersonState;
  public ktxGates: KtxGates = this.newKtxGates();
  private ktxRetreat = { public: false, crew: false };
  private ktxPlatformLost = false;
  private ktxPlatformCivilians = 0;
  private ktxLandingHoldUntil: Partial<Record<KtxLane, number>> = {};
  private stationOfficers = new Map<number, KtxLane>();
  private stationDefensePosts = new Map<number, typeof KTX_STATION_POSTS[number]>();
  private stationFiringPositions = new WeakMap<AgentData, Vec2>();
  private stationDetours = new WeakMap<AgentData, { goal: Vec2; path: Vec2[]; retryAt: number }>();
  private nextKtxThreatCheck = 0;

  private newKtxGates(): KtxGates {
    return {
      public: { open: true, openFraction: 1, integrity: 240, maxIntegrity: 240, lastDamagedAt: -Infinity, manualUntil: 0 },
      crew: { open: false, openFraction: 0, integrity: 200, maxIntegrity: 200, lastDamagedAt: -Infinity, manualUntil: 0 },
      mezzanine: { open: true, openFraction: 1, integrity: 280, maxIntegrity: 280, lastDamagedAt: -Infinity, manualUntil: 0 },
      transfer: { open: false, openFraction: 0, integrity: 340, maxIntegrity: 340, lastDamagedAt: -Infinity, manualUntil: 0 }
    };
  }
  private trainPassengers = new Set<number>();
  private trainSeats = new Map<number, { x: number; z: number; seating: boolean }>();
  public commanderOrder = '';

  public roadblocks: RoadblockData[] = [];
  public evacZones: EvacZoneData[] = [];
  public holdZones: HoldZoneData[] = [];
  public lureFlares: LureFlareData[] = [];
  public prioritySector: PrioritySectorData | null = null;
  public reports: IncidentReport[] = [];
  public effects: VisualEffectEvent[] = [];
  public eventLog: EventLogItem[] = [];
  public history: TimeSeriesPoint[] = [];

  public simTime = 0;
  public commandPoints = 180;
  public totalEvacuated = 0;
  public readonly policeRadio: RadioTransmission[] = [];
  private radioCooldowns = new Map<string, number>();
  private nextRadioCheck = 2;
  public totalDeceased = 0;
  public totalCured = 0;
  public hordeWave = 0;
  public nextWaveTimer = 0;
  public lastAlert: AlertBanner | null = null;
  public selectedAgentId: number | null = null;
  public patientZeroId: number | null = null;

  private nextAgentId = 1;
  private nextEventId = 1;
  private nextEntityId = 1;
  private historySampleTimer = 0;
  private bruteSeen = false;
  private neighborBuffer: AgentData[] = [];
  private buildingBuffer: BuildingData[] = [];
  private agentById: Map<number, AgentData> = new Map();

  public interiorDoors: InteriorDoorData[] = [];
  public brokenWindows: BrokenWindowData[] = [];
  public carAlarms: Map<number, { x: number; z: number; remaining: number; beepTimer: number }> = new Map();
  public gridFlickerTimer = 0;
  public blackoutMaxZ = -999;
  public supplyPickups: SupplyPickupData[] = [];
  public ammoCaches: AmmoCacheData[] = [];
  private windowBreachCooldown = 2.8;
  private overpassDropCooldown = 5.5;
  private activeAlarmSet: Set<number> = new Set();
  private obsAvoidBuffer: StaticObstacleData[] = [];
  private avoidProbeBuf: StaticObstacleData[] = [];
  private pathsComputedThisTick = 0;
  private pathProgress = new WeakMap<AgentData, { path: Vec2[]; index: number; distance: number; stalled: number }>();
  private pursuitGoals = new WeakMap<AgentData, Vec2 & { path: Vec2[] }>();
  private pyramidBuckets: AgentData[][][] = [];
  private pyramidMembers = new Set<number>();
  private nextWallGateCheck = 0;
  private gateTraffic = new Map<number, {
    infected: number; exitThreat: boolean; crowd: number; unsafeUntil: number;
  }>();
  private civilianGateChoices = new Map<number, BlastGateData>();
  private civilianEvacuationStage = 0;
  private stagedCivilians = new Set<number>();
  private gateWaitingSpots = new Map<number, Vec2[]>();
  private wallCrossings = new Map<number, {
    wall: DefenseWallData; progress: number; startZ: number; deck: { minX: number; maxX: number } | null;
  }>();
  private wallAssignments = new Map<number, WallGuardPost>();
  private groundPosts = new Map<number, { wall: DefenseWallData | null; x: number; z: number }>();
  private fallbacks = new Map<number, OfficerFallback>();
  private policeFrontZ = -Infinity;
  private nextCommanderOrder = 0;
  private nextCommanderSupport = 0;
  private guardSealedGates = new Map<number, number>();
  private gateCooldown = new Map<number, number>();
  private fpVaultActive = false;
  private fpWallDeck: { wall: DefenseWallData; minX: number; maxX: number } | null = null;
  private fpLadderTravel: {
    wall: DefenseWallData; x: number; progress: number; ascending: boolean; startX: number; startZ: number;
  } | null = null;
  private fpVaultTimer = 0;
  private fpVaultDuration = 0.38;
  private fpVaultStartX = 0;
  private fpVaultStartZ = 0;
  private fpVaultEndX = 0;
  private fpVaultEndZ = 0;
  private fpVaultPeakY = 1.0;
  private fpGraceTimer = 0;
  private fpSafeTimer = 0;

  public getActiveAlarmObstacleIds(): Set<number> {
    this.activeAlarmSet.clear();
    for (const id of this.carAlarms.keys()) {
      this.activeAlarmSet.add(id);
    }
    return this.activeAlarmSet;
  }

  private pushEffect(ev: VisualEffectEvent): void {
    if (
      this.effects.length >= 160 &&
      (ev.type === 'bite' || ev.type === 'convert' || ev.type === 'gunshot')
    ) {
      return;
    }
    this.effects.push(ev);
  }

  private requestPath(
    startX: number,
    startZ: number,
    goalX: number,
    goalZ: number,
    isZombie: boolean
  ): Vec2[] | null {
    if (this.pathsComputedThisTick >= 18) return null;
    this.pathsComputedThisTick++;
    return this.city.findPath(
      startX,
      startZ,
      goalX,
      goalZ,
      this.roadblocks,
      this.defenseWalls,
      this.blastGates,
      isZombie
    );
  }

  constructor(config: ScenarioConfig) {
    this.config = { ...config };
    this.rng = new SeededRNG(this.config.seed);
    this.city = new CityLayout(this.config.seed, this.config.mapId);
    this.spatial = new SpatialGrid(10);
    this.reset(this.config);
  }

  public reset(newConfig?: Partial<ScenarioConfig>): void {
    if (newConfig) {
      this.config = { ...this.config, ...newConfig };
    }
    this.rng = new SeededRNG(this.config.seed);
    this.city = new CityLayout(this.config.seed, this.config.mapId);
    this.spatial.clear();
    this.agentById.clear();
    this.pyramidBuckets = [];
    this.ktxGates = this.newKtxGates();
    this.ktxRetreat = { public: false, crew: false };
    this.ktxPlatformLost = false;
    this.ktxPlatformCivilians = 0;
    this.ktxLandingHoldUntil = {};
    this.stationOfficers.clear();
    this.stationDefensePosts.clear();
    this.nextKtxThreatCheck = 0;
    this.trainPassengers.clear();
    this.trainSeats.clear();
    this.pyramidMembers.clear();
    this.nextWallGateCheck = 0;
    this.gateTraffic.clear();
    this.civilianGateChoices.clear();
    this.civilianEvacuationStage = 0;
    this.stagedCivilians.clear();
    this.gateWaitingSpots.clear();
    this.wallCrossings.clear();
    this.wallAssignments.clear();
    this.groundPosts.clear();
    this.fallbacks.clear();
    this.policeFrontZ = -Infinity;
    this.nextCommanderOrder = 0;
    this.nextCommanderSupport = 0;
    this.guardSealedGates.clear();
    this.gateCooldown.clear();
    this.commanderOrder = '';
    this.pathsComputedThisTick = 0;

    this.agents = [];
    this.vehicles = [];
    this.defenseWalls = [];
    this.blastGates = [];
    this.interiorDoors = this.city.interiorDoors.map((d) => ({ ...d }));
    this.brokenWindows = [];
    this.carAlarms.clear();
    this.supplyPickups = [];
    this.fpVaultActive = false;
    this.fpWallDeck = null;
    this.fpLadderTravel = null;
    this.fpVaultTimer = 0;
    this.fpGraceTimer = 0;
    this.fpSafeTimer = 0;
    this.roadblocks = [];
    this.evacZones = [];
    this.holdZones = [];
    this.lureFlares = [];
    this.prioritySector = null;
    this.reports = [];
    this.effects = [];
    this.eventLog = [];
    this.history = [];

    this.simTime = 0;
    this.gridFlickerTimer = 0;
    this.blackoutMaxZ = -999;
    this.windowBreachCooldown = 2.8;
    this.overpassDropCooldown = 5.5;
    this.commandPoints = !this.config.allowPlayerIntervention
      ? 0
      : this.config.id === 'horde_invasion' || this.config.id === 'wwz_busan' || this.config.id === 'breach_siege'
      ? 180
      : 120;
    this.totalEvacuated = 0;
    this.policeRadio.length = 0;
    this.radioCooldowns.clear();
    this.nextRadioCheck = 2;
    this.transmitRadio({ kind: 'ready' });
    this.totalDeceased = 0;
    this.totalCured = 0;
    this.hordeWave = 0;
    this.nextWaveTimer = 0;
    this.lastAlert = null;
    this.bruteSeen = false;
    this.selectedAgentId = null;
    this.patientZeroId = null;
    this.nextAgentId = 1;
    this.nextEventId = 1;
    this.nextEntityId = 1;
    this.historySampleTimer = 0;

    // Build Defense Walls & Open Blast Gates (user closes them strategically!)
    const minX = -this.city.cityHalfX - 10;
    const maxX = this.city.cityHalfX + 10;
    const bucketSize = 6;
    const bucketCount = Math.ceil((maxX - minX) / bucketSize);
    const siege = this.config.id === 'breach_siege';
    const gateIntegrity = siege ? 1800 : 950;

    for (const wd of this.city.wallDefs) {
      const wallId = this.nextEntityId++;
      this.defenseWalls.push({
        id: wallId,
        z: wd.z,
        thickness: wd.thickness,
        height: wd.height,
        minX,
        maxX,
        label: wd.label,
        layerIndex: wd.layerIndex,
        breachedNotified: false,
        pyramidBreachNotified: false,
        pyramidHeights: new Array(bucketCount).fill(0),
        bucketSize,
        retreatLadderXs: wallRetreatLadderXs(minX, maxX, wd.gateXs)
      });

      for (let gi = 0; gi < wd.gateXs.length; gi++) {
        const gx = wd.gateXs[gi];
        const sideLabel = gx < 0 ? 'West' : 'East';
        this.blastGates.push({
          id: this.nextEntityId++,
          wallId,
          x: gx,
          z: wd.z,
          width: BLAST_GATE_WIDTH,
          isOpen: !siege,
          openFraction: siege ? 0 : 1,
          breached: false,
          integrity: gateIntegrity,
          maxIntegrity: gateIntegrity,
          lastDamagedAt: -Infinity,
          label: `Line ${wd.layerIndex} ${sideLabel} Gate`
        });
      }
    }

    const trainLayout = getTrainLayout(this.layeredKtx);
    this.expressTrain = {
      active: this.city.hasExpressRail,
      x: this.city.hasExpressRail ? this.city.stationPos.x : -this.city.cityHalfX - 65,
      z: this.city.railZ,
      state: this.city.hasExpressRail ? 'DOCKED' : 'COOLDOWN',
      timer: this.layeredKtx ? 60 : 40,
      boardedTotal: 0,
      stationX: this.city.stationPos.x,
      stationZ: this.city.stationPos.z,
      layout: trainLayout,
      currentLoad: 0,
      carHeight: 3.1,
      boardingDoorLocalX: TRAIN_BOARDING_X,
      cabinSwitchLocalX: trainLayout.frontX - 1.2,
      doors: trainLayout.bulkheads.map((localX, index) => ({
        id: index + 1,
        localX,
        label: `Car ${trainLayout.carCount - index} ↔ Car ${trainLayout.carCount - index - 1} Glass Door`,
        isLocked: false,
        isBroken: false,
        integrity: this.layeredKtx ? 180 : 110,
        maxIntegrity: this.layeredKtx ? 180 : 110,
        lastHitTime: -99,
        manualUntil: 0
      })),
      playerInsideCar: 0,
      playerDeparting: false
    };

    this.firstPerson = {
      active: false,
      playerId: null,
      role: 'civilian',
      weapon: null,
      mission: null,
      killRewardProgress: 0,
      killRewardAmmo: 0,
      yaw: Math.PI,
      pitch: 0,
      stamina: 100,
      maxStamina: 100,
      sprinting: false,
      nearestZombieDist: 999,
      nearbyGateId: null,
      wallLadder: null,
      nearbyDoorId: null,
      insideBuildingId: null,
      pursuers: 0,
      shoveCooldown: 0,
      decoyCooldown: 0,
      adrenalineTimer: 0,
      vaultY: 0,
      vaultRoll: 0,
      nearbyVaultLabel: null,
      nearbyCarId: null,
      nearbyPickupId: null,
      nearbyAmmoId: null,
      nearbyTrainDoorId: null,
      nearbyKtxGate: null,
      nearTrainCabinConsole: false,
      insideTrainCar: 0,
      waypointX: 0,
      waypointZ: 0,
      waypointLabel: '',
      spawnLabel: '',
      outcome: null,
      survivalTime: 0
    };

    this.spawnInitialPopulation();
    if (this.layeredKtx) {
      for (const [x, z, y, lane] of [
        [-59, 163, 4, 'crew'], [-51, 160.6, 0, 'crew'], [-33, 161.8, 0, 'crew'],
        [43, 162.2, 0, 'public'], [20, 160.2, 0, 'public'], [45, 178.8, 3, 'public']
      ] as const) {
        const officer = this.createAgent('police', x, z, y > 0);
        officer.climbY = y;
        officer.onTerminalFloor = y > 0;
        this.stationOfficers.set(officer.id, lane);
        this.groundPosts.set(officer.id, { wall: null, x, z });
        this.pushAgent(officer);
      }
      for (const post of KTX_STATION_POSTS.slice(0, 3)) {
        const officer = this.createAgent('police', post.x, post.z, false);
        officer.climbY = KTX_PLATFORM_Y;
        officer.onTerminalFloor = true;
        this.stationOfficers.set(officer.id, 'public');
        this.stationDefensePosts.set(officer.id, post);
        this.pushAgent(officer);
      }
    }
    this.spawnInitialVehicles();
    this.spawnSupplyPickups();
    this.spawnAmmoCaches();

    for (const pt of this.city.evacSpawnPoints) {
      this.evacZones.push({
        id: this.nextEntityId++,
        x: pt.x,
        z: pt.z,
        radius: 7.5,
        extractedCount: 0,
        active: true
      });
    }

    this.recordHistoryPoint();
  }

  private spawnAmmoCaches(): void {
    this.ammoCaches = [];
    const addGround = (x: number, z: number) => {
      const pos = { x, z };
      resolveWorldCollisions(pos, 0.75, this.city, this.defenseWalls, this.blastGates, 0, this.interiorDoors);
      if (this.ammoCaches.some((cache) => cache.y === 0 && Math.hypot(cache.x - pos.x, cache.z - pos.z) < 3)) return;
      this.ammoCaches.push({ id: this.nextEntityId++, x: pos.x, y: 0, z: pos.z, readyAt: 0 });
    };
    for (const gate of this.blastGates) {
      const wall = this.defenseWalls.find((candidate) => candidate.id === gate.wallId)!;
      const towardCenter = gate.x < 0 ? 1 : -1;
      const x = wallPostX(gate.x) + towardCenter * 6;
      addGround(x, ladderZ(wall) + 3.8);
      this.ammoCaches.push({
        id: this.nextEntityId++, x, y: wall.height + WALL_DECK_RISE, z: wall.z + 0.58, readyAt: 0
      });
      if (wall.layerIndex === 1) addGround(gate.x + 3 * towardCenter, wall.z - 17);
    }
    const precinct = this.city.findNearestNode(this.city.precinctPos.x, this.city.precinctPos.z);
    addGround(precinct.x, precinct.z);
    const resupply = this.layeredKtx ? { x: 9.5, z: 174.8 }
      : this.city.hasExpressRail
      ? this.city.findNearestNode(this.city.stationPos.x, this.city.stationPos.z - 12)
      : this.city.findNearestNode(this.city.hospitalPos.x, this.city.hospitalPos.z);
    addGround(resupply.x, resupply.z);
    if (this.layeredKtx) {
      addGround(-36, 157);
      this.ammoCaches.push({ id: this.nextEntityId++, x: -21, y: KTX_PLATFORM_Y, z: 190.1, readyAt: 0 });
    }
    if (this.defenseWalls.length === 0) {
      for (const x of [-0.52, 0.52]) {
        for (const z of [-0.52, 0.52]) {
          const node = this.city.findNearestNode(x * this.city.cityHalfX, z * this.city.cityHalfZ);
          addGround(node.x, node.z);
        }
      }
    }
  }

  private spawnSupplyPickups(): void {
    this.supplyPickups = [];
    for (let i = 0; i < this.city.buildings.length; i++) {
      const b = this.city.buildings[i];
      if (!b.interior) continue;
      if (b.interior.theme === 'mart') {
        this.supplyPickups.push({
          id: this.nextEntityId++,
          x: b.x - 1.5,
          z: b.z + 0.5,
          kind: 'energy_drink',
          label: 'Cold Energy Drink (Full Stamina + Surge)',
          collected: false
        });
      } else if (b.interior.theme === 'clinic' || b.interior.theme === 'hospital') {
        this.supplyPickups.push({
          id: this.nextEntityId++,
          x: b.x,
          z: b.z,
          kind: 'antiviral_kit',
          label: 'Antiviral Medkit (+65 HP & Cure)',
          collected: false
        });
      } else if (b.interior.theme === 'terminal') {
        this.supplyPickups.push({
          id: this.nextEntityId++,
          x: b.x,
          z: b.z,
          kind: 'emergency_pack',
          label: 'Emergency Tactical Pack (+HP & Decoy)',
          collected: false
        });
      }
    }

    if (this.config.mapId === 'citadel_express') {
      this.supplyPickups.push(
        {
          id: this.nextEntityId++,
          x: 8.4,
          z: 155.3,
          kind: 'emergency_pack',
          label: 'Emergency Tactical Pack (+HP & Decoy)',
          collected: false
        },
        {
          id: this.nextEntityId++,
          x: -31.0,
          z: -146.5,
          kind: 'energy_drink',
          label: 'Alley Energy Stash (Full Stamina + Surge)',
          collected: false
        },
        {
          id: this.nextEntityId++,
          x: 56.0,
          z: -42.0,
          kind: 'emergency_pack',
          label: 'Midtown Supply Pack (+HP & Decoy)',
          collected: false
        }
      );
    } else {
      this.supplyPickups.push(
        {
          id: this.nextEntityId++,
          x: this.city.hospitalPos.x,
          z: this.city.hospitalPos.z,
          kind: 'antiviral_kit',
          label: 'Antiviral Medkit (+65 HP & Cure)',
          collected: false
        },
        {
          id: this.nextEntityId++,
          x: this.city.precinctPos.x,
          z: this.city.precinctPos.z,
          kind: 'emergency_pack',
          label: 'Emergency Tactical Pack (+HP & Decoy)',
          collected: false
        }
      );
    }
  }

  private withEvacuationTotal(message: string): string {
    return `${message} · Evacuated this round: ${this.totalEvacuated}`;
  }

  public triggerAlert(text: string, severity: AlertBanner['severity']): void {
    this.lastAlert = {
      text,
      severity,
      timestamp: performance.now()
    };
  }

  private pushAgent(agent: AgentData): void {
    this.agents.push(agent);
    this.agentById.set(agent.id, agent);
  }

  public getAgentById(id: number | null): AgentData | null {
    if (id === null) return null;
    return this.agentById.get(id) || null;
  }

  private spawnInitialPopulation(): void {
    const totalPop = this.config.population;
    const isTwin = this.config.mapId === 'twin_bridges';
    const isCitadel = this.config.mapId === 'citadel_express';
    const isHorde = this.config.id === 'horde_invasion';
    const isSiege = this.config.id === 'breach_siege';
    const isWwzBusan = this.config.id === 'wwz_busan';
    const isSuper = this.config.id === 'super_spreader';

    const startingWallGuards = INITIAL_WALL_GUARDS_PER_GATE + WALL_OUTER_POST_SLOTS;
    const wallGuardCount = this.blastGates.length * startingWallGuards;
    const groundGuardCount = this.blastGates.length * GROUND_GUARDS_PER_GATE;
    const extraWallGuards = wallGuardCount + groundGuardCount - this.blastGates.length * 2;
    const policeCount = Math.max(this.config.initialPolice, Math.floor(totalPop / 25)) + extraWallGuards;
    const medicCount = Math.max(4, Math.floor(totalPop / 70));
    const initialInfCount = isSiege
      ? this.getSiegeWaveSize(0)
      : isHorde
      ? 55
      : isWwzBusan
      ? 18
      : this.config.id === 'multi_epicenter'
      ? 5
      : isSuper
      ? 3
      : this.config.id === 'delayed_response'
      ? 2
      : this.config.id === 'no_intervention'
      ? this.city.gridBlocks >= 7
        ? 2
        : 1
      : Math.max(1, this.config.initialInfected);

    const civCount = Math.max(30, totalPop - policeCount - medicCount - initialInfCount);

    const line1Z = this.city.wallDefs[0]?.z ?? -56;
    const southNodes = this.city.navNodes.filter((n) => n.z > (isCitadel ? 52 : 18));
    const northNodes = this.city.navNodes.filter((n) => n.z < (isCitadel ? line1Z - 6 : -18));
    const sector1Nodes = this.city.navNodes.filter((n) => n.z < (isCitadel ? line1Z - 6 : -56));
    const populationNodes = isCitadel ? this.city.navNodes.filter((n) => n.z < KTX_LAST_LINE_Z - 2) : this.city.navNodes;

    // 1. Police & SWAT
    const swatCount = Math.max(2, Math.floor(policeCount * 0.28));
    for (let i = 0; i < policeCount; i++) {
      const isSwat = i < swatCount;
      let node;
      if (i < wallGuardCount) {
        // Post guard squads just south of each Blast Gate
        const g = this.blastGates[i % this.blastGates.length];
        node = this.city.findNearestNode(g.x + this.rng.range(-3, 3), g.z + 6.5);
      } else if (i < 4) {
        node = this.city.findNearestNode(
          this.city.precinctPos.x + this.rng.range(-6, 6),
          this.city.precinctPos.z + this.rng.range(-4, 4)
        );
      } else if (i < wallGuardCount + groundGuardCount) {
        const gate = this.blastGates[i % this.blastGates.length];
        node = this.city.findNearestNode(gate.x, gate.z + 7);
      } else if (isTwin && southNodes.length > 0 && this.rng.chance(0.65)) {
        node = this.rng.pick(southNodes);
      } else {
        node = this.rng.pick(populationNodes);
      }

      const officer = this.createAgent(
        'police',
        node.x + this.rng.range(-1.2, 1.2),
        node.z + this.rng.range(-1.2, 1.2),
        isSwat
      );
      if (i < wallGuardCount) {
        const gate = this.blastGates[i % this.blastGates.length];
        const wall = this.defenseWalls.find((candidate) => candidate.id === gate.wallId)!;
        const rank = Math.floor(i / this.blastGates.length);
        const outer = rank >= INITIAL_WALL_GUARDS_PER_GATE;
        const x = wallPostX(gate.x, outer);
        const slot = outer ? rank - INITIAL_WALL_GUARDS_PER_GATE : rank;
        this.assignWallPost(officer, wall, x, slot);
        officer.x = this.wallAssignments.get(officer.id)!.deckX;
        officer.z = wallDeckFrontZ(wall);
        officer.climbY = wall.height + WALL_DECK_RISE;
        officer.onWallDeck = true;
        officer.rotationY = Math.PI;
        officer.policeState = 'HOLDING_POSITION';
      } else if (i < wallGuardCount + groundGuardCount) {
        const gate = this.blastGates[i % this.blastGates.length];
        const wall = this.defenseWalls.find((candidate) => candidate.id === gate.wallId)!;
        const slot = Math.floor(i / this.blastGates.length) - startingWallGuards;
        const post = this.groundPostForGate(wall, gate, slot);
        officer.x = post.x;
        officer.z = post.z;
        this.groundPosts.set(officer.id, post);
        officer.policeState = 'HOLDING_POSITION';
      } else {
        this.assignRandomPatrolDestination(officer);
      }
      this.pushAgent(officer);
    }

    // 2. Field Paramedics at St. Jude Medical Center
    for (let i = 0; i < medicCount; i++) {
      const hospNode = this.city.findNearestNode(
        this.city.hospitalPos.x + this.rng.range(-5, 5),
        this.city.hospitalPos.z + this.rng.range(-5, 5)
      );
      const medic = this.createAgent(
        'medic',
        hospNode.x + this.rng.range(-1, 1),
        hospNode.z + this.rng.range(-1, 1),
        false
      );
      this.assignRandomPatrolDestination(medic);
      this.pushAgent(medic);
    }

    // 3. Autonomous Civilians
    for (let i = 0; i < civCount; i++) {
      // A few civilians start inside the protected intake.
      const nearStation = isCitadel && i < 3;
      const node = nearStation
        ? this.city.findNearestNode(KTX_GATES.public.x, 159)
        : this.rng.pick(populationNodes);
      const civ = this.createAgent(
        'civilian',
        nearStation ? this.rng.range(26, 35) : node.x + this.rng.range(-1.5, 1.5),
        nearStation ? this.rng.range(157, 160) : node.z + this.rng.range(-1.5, 1.5),
        false
      );
      if (this.rng.chance(0.16)) {
        civ.civState = 'SOCIALIZING';
        civ.stateTimer = this.rng.range(3, 9);
        civ.destinationLabel = `Chatting at ${node.district}`;
      } else {
        this.assignRandomCivilianDestination(civ);
      }
      this.pushAgent(civ);
    }

    // 4. Initial Infected by Mode & Map
    if (isSiege) {
      this.spawnSiegeWave();
    } else if (isHorde) {
      this.hordeWave = 1;
      this.nextWaveTimer = 38;
      this.spawnHordeWavePack(55, 4, 14, true);
      this.triggerAlert('CRIMSON TIDE WAVE 1: 55 Infected breaching Northern Perimeter!', 'danger');
    } else if (isWwzBusan) {
      this.hordeWave = 1;
      this.nextWaveTimer = 40;
      const pool = sector1Nodes.length > 0 ? sector1Nodes : northNodes.length > 0 ? northNodes : this.city.navNodes;
      for (let i = 0; i < initialInfCount; i++) {
        const node = this.rng.pick(pool);
        const variant: ZombieVariant = i === 0 ? 'brute' : i <= 4 ? 'runner' : 'standard';
        const zmb = this.createAgent(
          'infected',
          node.x + this.rng.range(-2.5, 2.5),
          node.z + this.rng.range(-2.5, 2.5),
          false,
          variant
        );
        if (i === 0) {
          zmb.name = `Patient Zero (${zmb.name})`;
          this.patientZeroId = zmb.id;
          this.bruteSeen = true;
        }
        this.pushAgent(zmb);
      }
      this.addEventLog(
        'infection',
        `WWZ × BUSAN SURGE: 18 Hyper-Rabid Infected erupting in Sector 1! Close Blast Gates when crowds pass!`,
        0,
        isCitadel ? line1Z - 35 : -75
      );
      this.triggerAlert('WWZ × BUSAN SURGE: Sector 1 Outbreak! Protect Defense Line 1!', 'danger');
    } else {
      let candidateNodes = this.city.navNodes.filter(
        (n) =>
          n.district !== 'Police Precinct' &&
          Math.hypot(n.x - this.city.precinctPos.x, n.z - this.city.precinctPos.z) > 30
      );
      if (isCitadel && sector1Nodes.length > 0) {
        candidateNodes = sector1Nodes;
      } else if (isTwin && northNodes.length > 0) {
        candidateNodes = northNodes;
      }
      if (candidateNodes.length === 0) candidateNodes = this.city.navNodes;

      const chosenNodes: typeof candidateNodes = [];
      for (let i = 0; i < initialInfCount; i++) {
        let pick = this.rng.pick(candidateNodes);
        if (chosenNodes.length > 0) {
          for (let attempt = 0; attempt < 8; attempt++) {
            const c = this.rng.pick(candidateNodes);
            const tooClose = chosenNodes.some((prev) => Math.hypot(prev.x - c.x, prev.z - c.z) < 42);
            if (!tooClose) {
              pick = c;
              break;
            }
          }
        }
        chosenNodes.push(pick);

        let variant: ZombieVariant = 'standard';
        if (isSuper) {
          variant = i === 0 ? 'brute' : 'runner';
        } else if (this.config.id === 'multi_epicenter' && i === 0) {
          variant = 'runner';
        }

        const pz = this.createAgent('infected', pick.x, pick.z, false, variant);
        if (i === 0) {
          pz.name = `${pz.name} (Patient Zero)`;
          this.patientZeroId = pz.id;
        }
        pz.recentLogs.unshift('08:00:00 — Contracted unknown pathogen (Outbreak Origin).');
        this.pushAgent(pz);

        this.addEventLog(
          'infection',
          `BIO-ALERT: ${variant !== 'standard' ? variant.toUpperCase() + ' ' : ''}${
            pz.name
          } detected in ${pick.district}.`,
          pz.x,
          pz.z
        );
      }

      if (this.config.id === 'multi_epicenter') {
        this.triggerAlert('MULTI-EPICENTER OUTBREAK: 5 Simultaneous Bio-Incidents Reported!', 'danger');
      } else if (isSuper) {
        this.triggerAlert('FAST STRAIN ALERT: Aggressive Runners & Alpha Brute Sighted!', 'danger');
      } else if (this.config.id === 'delayed_response') {
        this.triggerAlert('DISPATCH BLACKOUT: 35s Police Communications Outage!', 'warn');
      }
    }
  }

  private spawnHordeWavePack(
    total: number,
    bruteCount: number,
    runnerCount: number,
    isInitial: boolean
  ): void {
    const northEdgeZ = -this.city.cityHalfZ + 10;
    const edgeNodes = this.city.navNodes.filter((n) => n.z <= northEdgeZ + 22);
    const pool = edgeNodes.length > 0 ? edgeNodes : this.city.navNodes;

    for (let i = 0; i < total; i++) {
      const variant: ZombieVariant =
        i < bruteCount ? 'brute' : i < bruteCount + runnerCount ? 'runner' : 'standard';
      const baseNode = this.rng.pick(pool);
      const x = Math.max(
        -this.city.cityHalfX + 4,
        Math.min(this.city.cityHalfX - 4, baseNode.x + this.rng.range(-4, 4))
      );
      const z = Math.max(
        -this.city.cityHalfZ + 4,
        Math.min(this.city.cityHalfZ - 4, baseNode.z + this.rng.range(-3, 3))
      );

      const zmb = this.createAgent('infected', x, z, false, variant);
      if (isInitial && i === 0) {
        this.patientZeroId = zmb.id;
      }
      if (variant === 'brute') {
        this.bruteSeen = true;
      }
      const targetNode = this.city.findNearestNode(x * 0.6, this.city.cityHalfZ * 0.55);
      zmb.path = this.city.findPath(
        x,
        z,
        targetNode.x,
        targetNode.z,
        this.roadblocks,
        this.defenseWalls,
        this.blastGates,
        true
      );
      zmb.pathIndex = 0;
      this.pushAgent(zmb);
    }

    this.addEventLog(
      'infection',
      `HORDE WAVE ${this.hordeWave}: ${total} infected (${bruteCount} Brutes, ${runnerCount} Runners) surging from North!`,
      0,
      northEdgeZ
    );
  }

  private getSiegeWaveSize(index: number): number {
    const size = SIEGE_WAVE_SIZES[index];
    return this.config.population >= 2000 ? Math.round(size * 0.8) : size;
  }

  private spawnSiegeWave(): void {
    const total = this.getSiegeWaveSize(this.hordeWave);
    this.hordeWave++;
    this.nextWaveTimer = this.hordeWave < SIEGE_WAVE_SIZES.length ? SIEGE_WAVE_INTERVAL : 0;

    const front = this.defenseWalls.find((wall) => !wall.breachedNotified);
    const first = this.defenseWalls[0];
    const gates = this.blastGates.filter((gate) => gate.wallId === (front?.id ?? this.defenseWalls.at(-1)?.id));
    const previousLine = front ? this.defenseWalls[this.defenseWalls.indexOf(front) - 1] : this.defenseWalls.at(-1);
    const spawnZ = previousLine ? previousLine.z + 13 : first ? first.z - 35 : -this.city.cityHalfZ + 15;
    const groupCount = Math.max(1, gates.length);
    for (let i = 0; i < total; i++) {
      const gate = gates[i % groupCount];
      const x = (gate?.x ?? 0) + this.rng.range(-4.2, 4.2);
      const z = spawnZ + this.rng.range(-5, 5);
      const variantSlot = Math.floor(i / groupCount) % 10;
      const variant: ZombieVariant = variantSlot === 0 ? 'brute' : variantSlot <= 3 ? 'runner' : 'standard';
      const infected = this.createAgent('infected', x, z, false, variant);
      infected.rotationY = 0;
      resolveWorldCollisions(infected, 0.55, this.city, this.defenseWalls, this.blastGates, 0, this.interiorDoors);
      if (this.hordeWave === 1 && i === 0) {
        this.patientZeroId = infected.id;
        this.bruteSeen = true;
      }
      this.pushAgent(infected);
    }
    const order = front ? `Line ${front.layerIndex}` : 'KTX Terminal';
    const message = `SIEGE WAVE ${this.hordeWave}/${SIEGE_WAVE_SIZES.length}: ${total} infected advancing on ${order}!`;
    this.triggerAlert(message, 'danger');
    this.addEventLog('infection', message, gates[0]?.x ?? 0, spawnZ);
    this.onSound?.('siren', gates[0]?.x ?? 0, spawnZ);
  }

  private createAgent(
    role: AgentRole,
    x: number,
    z: number,
    isSwat = false,
    zombieVariant: ZombieVariant = 'standard'
  ): AgentData {
    const id = this.nextAgentId++;
    let name = generateAgentName(this.rng, role, isSwat);
    if (role === 'infected') {
      if (zombieVariant === 'brute') name = `Alpha Brute (${name})`;
      else if (zombieVariant === 'runner') name = `Runner (${name})`;
    }

    let maxHp = 100;
    let speed = this.rng.range(2.6, 3.4);

    if (role === 'police') {
      maxHp = isSwat ? 210 : 130;
      speed = isSwat ? 4.8 : this.rng.range(4.4, 4.95);
    } else if (role === 'medic') {
      maxHp = 115;
      speed = 4.65;
    } else if (role === 'infected') {
      if (zombieVariant === 'brute') {
        maxHp = 320;
        speed = 3.55;
      } else if (zombieVariant === 'runner') {
        maxHp = 85;
        speed = this.rng.range(4.8, 5.15);
      } else {
        maxHp = 115;
        speed = this.rng.range(3.75, 4.25);
      }
      if (this.config.fastStrain) {
        speed *= this.config.id === 'wwz_busan' ? 1.15 : 1.22;
      }
    }

    return {
      id,
      name,
      role,
      isSwat,
      avoidsEvacuation: role === 'civilian' && this.layeredKtx && (id * 37) % 100 < 18,
      zombieVariant,
      x,
      z,
      vx: 0,
      vz: 0,
      rotationY: this.rng.range(0, Math.PI * 2),
      climbY: 0,
      convulseTimer: 0,
      fallY: 0,
      fallVy: 0,
      fallRoll: 0,
      stunnedTimer: 0,
      attackMode: 'none',
      grappleTargetId: null,
      pinnedById: null,
      pinTimer: 0,
      biteCount: 0,
      isPlayerControlled: false,
      health: maxHp,
      maxHealth: maxHp,
      baseSpeed: speed,
      bravery: role === 'police' || role === 'medic' ? 0.95 : this.rng.range(0.1, 0.95),
      awarenessRadius:
        role === 'police' ? 24 : role === 'medic' ? 26 : role === 'infected' ? 24 : 16,

      civState: 'WALKING',
      zombieState: 'WANDERING',
      policeState: 'PATROLLING',
      medicState: 'PATROLLING',
      stateTimer: 0,
      perceptionCooldown: (id % 5) * 0.05,
      repathCooldown: 0,

      path: [],
      pathIndex: 0,
      targetPos: null,
      destinationLabel: 'City Sidewalk',
      homeBuildingId: null,
      shelterBuildingId: null,

      isIncubating: false,
      incubationTimer: 0,
      maxIncubationTime: this.config.incubationSeconds,
      targetAgentId: null,
      threatPos: null,
      attackCooldown: 0,
      reportProgress: 0,
      hasReported: false,

      ammo: isSwat ? 10 : 8,
      maxAmmo: isSwat ? 10 : 8,
      reloadTimer: 0,
      assignedZonePos: null,
      kills: 0,
      cures: 0,

      shirtColor:
        role === 'police'
          ? isSwat
            ? 0x1e293b
            : 0x1d4ed8
          : role === 'medic'
          ? 0xf8fafc
          : this.rng.pick(SHIRT_PALETTE),
      pantsColor:
        role === 'police' ? 0x0f172a : role === 'medic' ? 0x065f46 : this.rng.pick(PANTS_PALETTE),
      skinColor: this.rng.pick(SKIN_PALETTE),
      hairColor: 0x1e293b,
      animPhase: this.rng.range(0, Math.PI * 2),
      isAlive: true,
      isEvacuated: false,
      perceivedThreats: 0,
      recentLogs: [`08:00:00 — Active in ${this.city.getDistrictAtPos(x, z)}.`],
      lastProgressX: x,
      lastProgressZ: z,
      stuckTimer: 0,
      avoidSide: this.rng.chance(0.5) ? 1 : -1,
      avoidTimer: 0
    };
  }

  private spawnInitialVehicles(): void {
    let vid = 1;
    const halfX = this.city.cityHalfX;
    const halfZ = this.city.cityHalfZ;
    const isTwin = this.config.mapId === 'twin_bridges';
    const isCitadel = this.config.mapId === 'citadel_express';

    const roadZs = this.city.roadZs.length > 0 ? this.city.roadZs : this.city.roadCoords;
    const roadXs = this.city.roadXs.length > 0 ? this.city.roadXs : this.city.roadCoords;
    const railTracks =
      this.city.railTracksZ.length > 0 ? this.city.railTracksZ : [this.city.railZ];

    const isSpotClear = (vx: number, vz: number): boolean => {
      if (isCitadel && Math.abs(vx + 52) < 9 && vz < -122 && vz > -172) return false;
      if (this.defenseWalls.some((w) => Math.abs(vz - w.z) < 4.5)) return false;
      const onBridge = this.city.bridges.some(
        (br) =>
          Math.abs(vx - br.x) <= br.width * 0.5 && Math.abs(vz - br.z) <= br.length * 0.55
      );
      if (
        !onBridge &&
        this.city.rivers.some(
          (rv) => vx >= rv.minX - 2 && vx <= rv.maxX + 2 && vz >= rv.minZ - 2 && vz <= rv.maxZ + 2
        )
      ) {
        return false;
      }
      if (this.city.terminalPlaza) {
        const tp = this.city.terminalPlaza;
        if (vx >= tp.minX - 2 && vx <= tp.maxX + 2 && vz >= tp.minZ - 2 && vz <= tp.maxZ + 2) {
          return false;
        }
      }
      for (const obs of this.city.staticObstacles) {
        if (Math.hypot(vx - obs.x, vz - obs.z) < Math.max(obs.width, obs.depth) * 0.5 + 3.2) {
          return false;
        }
      }
      for (const b of this.city.buildings) {
        if (vx >= b.minX - 1.6 && vx <= b.maxX + 1.6 && vz >= b.minZ - 1.6 && vz <= b.maxZ + 1.6) {
          return false;
        }
      }
      return true;
    };

    for (let r = 0; r < roadZs.length; r++) {
      const roadCoord = roadZs[r];
      const isRailZ =
        this.city.hasExpressRail && railTracks.some((rt) => Math.abs(roadCoord - rt) < 4.2);
      const isWallZ = this.defenseWalls.some((w) => Math.abs(roadCoord - w.z) < 3.2);
      const isPlazaZ =
        this.city.terminalPlaza &&
        roadCoord >= this.city.terminalPlaza.minZ - 1 &&
        roadCoord <= this.city.terminalPlaza.maxZ + 1;

      if (!isRailZ && !isWallZ && !isPlazaZ) {
        const carsPerDir = isCitadel && roadCoord < -48 ? 2 : 1;
        for (const dir of [-1, 1]) {
          for (let c = 0; c < carsPerDir; c++) {
            const laneZ = roadCoord + (dir === 1 ? 1.85 : -1.85);
            let startX = 0;
            let placed = false;
            for (let attempt = 0; attempt < 6; attempt++) {
              const candidateX = this.rng.range(-halfX + 12, halfX - 12);
              if (isSpotClear(candidateX, laneZ)) {
                startX = candidateX;
                placed = true;
                break;
              }
            }
            if (!placed) continue;

            const roll = this.rng.next();
            const type: VehicleData['type'] =
              roll < 0.14
                ? 'police_cruiser'
                : roll < 0.22
                ? 'ambulance'
                : roll < 0.42
                ? 'truck'
                : roll < 0.62
                ? 'taxi'
                : roll < 0.76
                ? 'van'
                : 'sedan';

            this.vehicles.push({
              id: vid++,
              type,
              x: startX,
              z: laneZ,
              dirX: dir,
              dirZ: 0,
              speed: 7.5,
              maxSpeed:
                type === 'police_cruiser' || type === 'ambulance'
                  ? 9.5
                  : type === 'truck'
                  ? 6.5
                  : this.rng.range(6.8, 8.6),
              color:
                type === 'taxi'
                  ? 0xfacc15
                  : type === 'truck'
                  ? 0x475569
                  : this.rng.pick(VEHICLE_COLORS),
              isAbandoned: false,
              isBurning: false,
              isRunaway: false,
              runawayTimer: 0,
              laneAxis: 'x',
              laneCoord: laneZ,
              hazardPhase: this.rng.range(0, 6.28)
            });
          }
        }
      }
    }

    for (let r = 0; r < roadXs.length; r++) {
      const roadCoord = roadXs[r];
      const isBridgeAvenue = !isTwin || this.city.bridges.some((b) => Math.abs(b.x - roadCoord) < 2);
      if (isBridgeAvenue) {
        for (const dir of [-1, 1]) {
          if (!isTwin && !isCitadel && this.rng.chance(0.35)) continue;
          const laneX = roadCoord + (dir === 1 ? -1.85 : 1.85);
          let startZ = 0;
          let placed = false;
          for (let attempt = 0; attempt < 6; attempt++) {
            const candidateZ = this.rng.range(-halfZ + 14, halfZ - 14);
            if (isSpotClear(laneX, candidateZ)) {
              startZ = candidateZ;
              placed = true;
              break;
            }
          }
          if (!placed) continue;

          const roll = this.rng.next();
          const type: VehicleData['type'] =
            roll < 0.2 ? 'truck' : roll < 0.42 ? 'taxi' : 'sedan';

          this.vehicles.push({
            id: vid++,
            type,
            x: laneX,
            z: startZ,
            dirX: 0,
            dirZ: dir,
            speed: 7.2,
            maxSpeed: type === 'truck' ? 6.5 : this.rng.range(6.8, 8.5),
            color:
              type === 'taxi'
                ? 0xfacc15
                : type === 'truck'
                ? 0x334155
                : this.rng.pick(VEHICLE_COLORS),
            isAbandoned: false,
            isBurning: false,
            isRunaway: false,
            runawayTimer: 0,
            laneAxis: 'z',
            laneCoord: laneX,
            hazardPhase: this.rng.range(0, 6.28)
          });
        }
      }
    }
  }

  public formatClock(seconds: number): string {
    const baseSeconds = 8 * 3600 + Math.floor(seconds * 4);
    const hrs = Math.floor(baseSeconds / 3600) % 24;
    const mins = Math.floor((baseSeconds % 3600) / 60);
    const secs = baseSeconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  }

  public logAgentAction(agent: AgentData, text: string): void {
    const entry = `${this.formatClock(this.simTime)} — ${text}`;
    agent.recentLogs.unshift(entry);
    if (agent.recentLogs.length > 8) {
      agent.recentLogs.pop();
    }
  }

  public addEventLog(
    category: 'infection' | 'report' | 'police' | 'evac',
    message: string,
    x: number,
    z: number
  ): void {
    this.eventLog.unshift({
      id: this.nextEventId++,
      simTime: this.simTime,
      formattedTime: this.formatClock(this.simTime),
      category,
      message,
      x,
      z
    });
    if (this.eventLog.length > 45) {
      this.eventLog.pop();
    }
  }

  private canSpawnFallingInfected(z: number): boolean {
    return this.defenseWalls.every((wall) => wall.z > z || wall.breachedNotified);
  }

  private fallingTime(height: number, upwardSpeed: number): number {
    return (upwardSpeed + Math.sqrt(upwardSpeed * upwardSpeed + 2 * FALL_GRAVITY * height)) / FALL_GRAVITY;
  }

  public triggerWindowBreach(b: BuildingData): boolean {
    if (b.height < 11 || b.hasUpperBreach || !this.canSpawnFallingInfected(b.z)) return false;

    let dirX = 0;
    let dirZ = -1;
    const fp = this.firstPerson?.active ? this.agentById.get(this.firstPerson.playerId ?? -1) : undefined;
    if (fp && fp.isAlive) {
      const dx = fp.x - b.x;
      const dz = fp.z - b.z;
      if (Math.abs(dx) > Math.abs(dz)) {
        dirX = dx >= 0 ? 1 : -1;
        dirZ = 0;
      } else {
        dirX = 0;
        dirZ = dz >= 0 ? 1 : -1;
      }
    } else if (Math.abs(b.x) > 10) {
      dirX = b.x > 0 ? -1 : 1;
      dirZ = 0;
    }

    const maxWindowY = Math.max(6.2, Math.min(b.height - 2.0, 10.6));
    const wx = b.x + dirX * (b.width * 0.5 + 0.06);
    const wz = b.z + dirZ * (b.depth * 0.5 + 0.06);
    const rotY = dirX !== 0 ? Math.PI / 2 : 0;
    const maxFallTime = this.fallingTime(maxWindowY, 2.2);
    const southernLanding = wz + 0.5 +
      (dirZ > 0 ? 0.75 + 5.4 * maxFallTime : Math.abs(dirX) * 0.55 * (1 + 0.9 * maxFallTime));
    if (!this.canSpawnFallingInfected(southernLanding)) return false;

    b.hasUpperBreach = true;
    const winY = this.rng.range(6.0, maxWindowY);
    this.brokenWindows.push({
      buildingId: b.id,
      x: wx,
      y: winY,
      z: wz,
      rotY
    });

    this.effects.push({
      type: 'window_shatter',
      x: wx,
      y: winY,
      z: wz,
      dirX,
      dirZ,
      age: 0,
      duration: 1.4
    });

    if (this.onSound) this.onSound('window_shatter', wx, wz);
    this.addEventLog('infection', `UPPER BREACH: Infected burst through upper window at ${b.name}!`, wx, wz);

    const dropCount = this.rng.next() < 0.45 ? 2 : 1;
    for (let k = 0; k < dropCount; k++) {
      const spread = (k - (dropCount - 1) * 0.5) * 1.1;
      const spawnX = wx + dirX * 0.75 + dirZ * spread;
      const spawnZ = wz + dirZ * 0.75 - dirX * spread;
      const variant: ZombieVariant = this.rng.next() < 0.35 ? 'runner' : 'standard';
      const zmb = this.createAgent('infected', spawnX, spawnZ, false, variant);
      zmb.fallY = winY;
      zmb.fallVy = this.rng.range(0.5, 2.2);
      zmb.fallRoll = this.rng.range(0, Math.PI * 2);
      const horizSpeed = this.rng.range(3.2, 5.4);
      zmb.vx = dirX * horizSpeed + dirZ * (spread * 0.9);
      zmb.vz = dirZ * horizSpeed - dirX * (spread * 0.9);
      zmb.rotationY = Math.atan2(dirX, dirZ);
      this.pushAgent(zmb);
    }
    return true;
  }

  public step(dt: number): void {
    this.simTime += dt;
    this.pathsComputedThisTick = 0;
    if (this.gridFlickerTimer > 0) this.gridFlickerTimer = Math.max(0, this.gridFlickerTimer - dt);
    if (this.windowBreachCooldown > 0) this.windowBreachCooldown -= dt;
    if (this.overpassDropCooldown > 0) this.overpassDropCooldown -= dt;
    if (this.fpGraceTimer > 0) this.fpGraceTimer = Math.max(0, this.fpGraceTimer - dt);

    for (const [id, alarm] of this.carAlarms.entries()) {
      alarm.remaining -= dt;
      alarm.beepTimer -= dt;
      if (alarm.beepTimer <= 0) {
        alarm.beepTimer = 1.15;
        if (this.onSound) this.onSound('car_alarm', alarm.x, alarm.z);
        this.effects.push({
          type: 'car_alarm_pulse',
          x: alarm.x,
          z: alarm.z,
          age: 0,
          duration: 0.75
        });
      }
      if (alarm.remaining <= 0) {
        this.carAlarms.delete(id);
      }
    }

    if (this.windowBreachCooldown <= 0) {
      let triggered = false;
      const fp = this.firstPerson?.active ? this.agentById.get(this.firstPerson.playerId ?? -1) : undefined;
      if (fp && fp.isAlive && this.brokenWindows.length < 18) {
        const fwdX = -Math.sin(this.firstPerson.yaw);
        const fwdZ = -Math.cos(this.firstPerson.yaw);
        let bestTarget: BuildingData | null = null;
        let bestScore = Infinity;
        for (let bi = 0; bi < this.city.buildings.length; bi++) {
          const b = this.city.buildings[bi];
          if (b.height < 11 || b.hasUpperBreach || !this.canSpawnFallingInfected(b.z)) continue;
          const distToFp = Math.hypot(b.x - fp.x, b.z - fp.z);
          const dot = (b.x - fp.x) * fwdX + (b.z - fp.z) * fwdZ;
          if (dot > -4 && distToFp < 46 && distToFp > 13.5) {
            const score = distToFp - (b.interior ? 16 : 0);
            if (score < bestScore) {
              bestScore = score;
              bestTarget = b;
            }
          }
        }
        if (bestTarget) triggered = this.triggerWindowBreach(bestTarget);
      }
      if (!triggered && this.brokenWindows.length < 12 && this.simTime > 4) {
        for (let bi = 0; bi < this.city.buildings.length; bi++) {
          const b = this.city.buildings[bi];
          if (b.height < 11 || b.hasUpperBreach || !this.canSpawnFallingInfected(b.z)) continue;
          const near = this.spatial.queryRadius(b.x, b.z, Math.max(b.width, b.depth) * 0.5 + 16, this.neighborBuffer);
          let zCount = 0;
          for (let k = 0; k < near.length; k++) {
            if (near[k].role === 'infected') zCount++;
          }
          if (zCount >= 3 || (this.firstPerson?.active && this.rng.next() < 0.15 && Math.abs(b.z) < 170)) {
            if (this.triggerWindowBreach(b)) break;
          }
        }
      }
      this.windowBreachCooldown = this.firstPerson?.active
        ? this.rng.range(7.5, 12.5)
        : this.rng.range(4.2, 7.8);
    }

    // Elevated Expressway Overpass sky-fall zombies spilling onto jammed avenue
    if (this.overpassDropCooldown <= 0 && this.city.overpasses.length > 0 && this.agents.length < 2350) {
      const op = this.city.overpasses[0];
      const fp = this.firstPerson?.active ? this.agentById.get(this.firstPerson.playerId ?? -1) : undefined;
      const nearOverpass = fp
        ? Math.abs(fp.z - op.z) < 42
        : this.city.staticObstacles.length > 0;
      const southernLanding = op.z + op.width * 0.45 + 2.9 * this.fallingTime(op.deckY, 1.2) + 0.5;
      if (nearOverpass && (this.simTime > 6 || Boolean(fp)) && this.canSpawnFallingInfected(southernLanding)) {
        const dropCount = fp ? 1 : 2;
        for (let k = 0; k < dropCount; k++) {
          let spawnX = fp ? fp.x + this.rng.pick([-1, 1]) * this.rng.range(13, 20) : this.rng.pick([-52, 26]) + this.rng.range(-8, 8);
          spawnX = Math.max(-this.city.cityHalfX + 12, Math.min(this.city.cityHalfX - 12, spawnX));
          const sideSign = this.rng.pick([-1, 1]);
          const zmb = this.createAgent('infected', spawnX, op.z + sideSign * (op.width * 0.45), false, k === 0 ? 'runner' : 'standard');
          zmb.fallY = op.deckY;
          zmb.fallVy = 1.2;
          zmb.vx = this.rng.range(-0.8, 0.8);
          zmb.vz = sideSign * 2.9;
          this.pushAgent(zmb);
        }
        if (fp && Math.abs(fp.z - op.z) < 32) {
          this.triggerAlert('⚠ OVERPASS DROP: Infected tumbling from the elevated highway!', 'warn');
        }
      }
      this.overpassDropCooldown = this.rng.range(8.5, 13.5);
    }

    if (this.config.allowPlayerIntervention) {
      this.commandPoints = Math.min(260, this.commandPoints + dt * 1.8);
    }

    const siege = this.config.id === 'breach_siege';
    const maxWaves = siege ? SIEGE_WAVE_SIZES.length : 3;
    if (this.config.enableWaves && this.hordeWave > 0 && this.hordeWave < maxWaves) {
      this.nextWaveTimer -= dt;
      if (this.nextWaveTimer <= 0) {
        if (siege) {
          this.spawnSiegeWave();
        } else {
          this.hordeWave++;
          this.nextWaveTimer = 42;
          this.spawnHordeWavePack(35, 3, 10, false);
          this.onSound?.('siren', 0, -this.city.cityHalfZ + 12);
          this.triggerAlert(
            `CRIMSON TIDE WAVE ${this.hordeWave}: 35 Infected & Alpha Brutes Incoming!`,
            'danger'
          );
        }
      }
    }

    // Update Acoustic Lure Flares
    for (let i = 0; i < this.lureFlares.length; i++) {
      const lf = this.lureFlares[i];
      if (!lf.active) continue;
      const prevBucket = Math.floor(lf.remaining / 1.2);
      lf.remaining -= dt;
      const currBucket = Math.floor(lf.remaining / 1.2);
      if (currBucket !== prevBucket) {
        this.effects.push({
          type: 'lure_pulse',
          x: lf.x,
          z: lf.z,
          age: 0,
          duration: 1.05
        });
      }
      if (lf.remaining <= 0) {
        lf.active = false;
      }
    }

    this.rebuildAgentSpatialGrid();

    this.updateCivilianEvacuationStage();
    this.updatePoliceRadio();
    this.updateWallGateOrders();
    this.updateGateTravel(dt);
    this.updateAICommander();
    this.processEmergencyDispatch();
    this.updateKtxDefense(dt);
    const trainWasMoving = this.ktxInTransit();
    this.updateExpressTrain(dt);
    if (trainWasMoving || this.ktxInTransit()) this.rebuildAgentSpatialGrid();

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.isAlive || a.isEvacuated || (a.isTrainPassenger && !this.ridingKtx(a))) continue;

      if (a.attackCooldown > 0) a.attackCooldown -= dt;
      if (a.stateTimer > 0) a.stateTimer -= dt;
      if (a.perceptionCooldown > 0) a.perceptionCooldown -= dt;
      if (a.repathCooldown > 0) a.repathCooldown -= dt;
      if (a.stunnedTimer > 0) a.stunnedTimer = Math.max(0, a.stunnedTimer - dt);
      if (a.pinTimer > 0) a.pinTimer = Math.max(0, a.pinTimer - dt);
      if (a.pinnedById !== null) {
        const att = this.getAgentById(a.pinnedById);
        if (!att || !att.isAlive || att.role !== 'infected' || att.grappleTargetId !== a.id) {
          a.pinnedById = null;
          a.attackMode = 'none';
          a.pinTimer = 0;
          a.stunnedTimer = Math.max(a.stunnedTimer, 0.32);
        }
      }

      if (a.fallY > 0) {
        a.fallVy -= FALL_GRAVITY * dt;
        a.fallY += a.fallVy * dt;
        a.x += a.vx * dt;
        a.z += a.vz * dt;
        a.fallRoll += dt * 7.5;
        if (a.fallY <= 0) {
          a.fallY = 0;
          a.fallVy = 0;
          a.fallRoll = 0;
          a.vx = 0;
          a.vz = 0;
          a.stunnedTimer = 0.65;
          if (this.onSound) this.onSound('body_thud', a.x, a.z);
          this.effects.push({
            type: 'bite',
            x: a.x,
            z: a.z,
            age: 0,
            duration: 0.75
          });
          for (let oi = 0; oi < this.city.staticObstacles.length; oi++) {
            const obs = this.city.staticObstacles[oi];
            if (obs.kind !== 'car' && obs.kind !== 'taxi' && obs.kind !== 'van') continue;
            if (Math.hypot(a.x - obs.x, a.z - obs.z) <= 3.8) {
              this.carAlarms.set(obs.id, {
                x: obs.x,
                z: obs.z,
                remaining: 18,
                beepTimer: 0.15
              });
              if (this.onSound) this.onSound('car_alarm', obs.x, obs.z);
              break;
            }
          }
        }
        continue;
      }

      if (a.isPlayerControlled && a.role !== 'infected') {
        this.updatePlayerInfection(a, dt);
      } else if (a.role === 'civilian') {
        this.updateCivilian(a, dt);
      } else if (a.role === 'infected') {
        this.updateInfected(a, dt);
      } else if (a.role === 'police') {
        this.updatePolice(a, dt);
      } else if (a.role === 'medic') {
        this.updateMedic(a, dt);
      }
    }

    this.updateWallsAndPyramids(dt);
    this.updatePoliceFront();
    this.applyCrowdSeparationAndCollisions(dt);
    this.updateVehicles(dt);

    for (let i = this.effects.length - 1; i >= 0; i--) {
      this.effects[i].age += dt;
      if (this.effects[i].age >= this.effects[i].duration) {
        this.effects.splice(i, 1);
      }
    }

    this.historySampleTimer += dt;
    if (this.historySampleTimer >= 1.0) {
      this.historySampleTimer = 0;
      this.recordHistoryPoint();
    }
  }

  public get layeredKtx(): boolean {
    return this.config.mapId === 'citadel_express';
  }

  private rebuildAgentSpatialGrid(): void {
    this.spatial.clear();
    for (const a of this.agents) {
      if (a.isAlive && !a.isEvacuated && (!a.isTrainPassenger || this.ridingKtx(a)) && a.civState !== 'SHELTERED') {
        this.spatial.insert(a);
      }
    }
  }

  private ridingKtx(agent: AgentData): boolean {
    return this.ktxInTransit() && !!agent.isTrainPassenger;
  }

  private ktxInTransit(): boolean {
    return this.layeredKtx && (this.expressTrain.state === 'DEPARTING' || this.expressTrain.state === 'QUARANTINE');
  }

  private getTrainCarForAgent(agent: AgentData): number {
    return this.getTrainCarForPos(agent.x, agent.z, agent.climbY, this.ridingKtx(agent));
  }

  private getTrainCarForPos(x: number, z: number, height = 0, riding = false): number {
    const tr = this.expressTrain;
    if (!tr.active || (tr.state !== 'DOCKED' && !riding)) return 0;
    if (this.layeredKtx && (Math.abs(height - KTX_PLATFORM_Y) > 0.48 || z < tr.z - 1.95)) return 0;
    const lx = x - tr.x;
    const lz = z - tr.z;
    const { rearX, frontX, carPitch, carCount } = tr.layout;
    if (lx < rearX || lx > frontX || Math.abs(lz) > TRAIN_WIDTH / 2) return 0;
    return carCount - Math.floor((lx - rearX + 0.3) / carPitch);
  }

  private ktxGateOpen(id: KtxGateId): boolean {
    const gate = this.ktxGates[id];
    return gate.open || gate.integrity <= 0;
  }

  private updateKtxDefense(dt: number): void {
    if (!this.layeredKtx) return;
    const updatePressure = this.simTime >= this.nextKtxThreatCheck;
    if (updatePressure) this.nextKtxThreatCheck = this.simTime + 0.45;
    if (updatePressure) {
      let infected = 0;
      let platformCivilians = 0;
      for (const a of this.spatial.queryRadius(20, 191.5, 86, this.neighborBuffer)) {
        if (!a.isAlive || a.isEvacuated || a.isTrainPassenger || a.climbY < KTX_PLATFORM_Y - 0.3 ||
            a.x <= KTX_TRANSFER_X || a.z < 188.5) continue;
        if (a.role === 'infected') {
          if (!this.ktxPlatformLost && (++infected >= 4 || (a.z > 191 && Math.abs(a.x - TRAIN_BOARDING_X) <= 5))) {
            this.ktxPlatformLost = true;
            this.ktxRetreat.public = this.ktxRetreat.crew = true;
          }
        } else if (a.role === 'civilian' && a.z >= 189) {
          platformCivilians++;
        }
      }
      this.ktxPlatformCivilians = platformCivilians;
    }
    for (const id of KTX_LANES) {
      const point = KTX_GATES[id];
      const gate = this.ktxGates[id];
      let pressure = 0;
      let attackers = 0;
      let occupied = false;
      let friendlyWaiting = false;
      for (const a of this.spatial.queryRadius(point.x, point.z, 19, this.neighborBuffer)) {
        if (!a.isAlive || a.isEvacuated || a.climbY > 1.4) continue;
        const dx = Math.abs(a.x - point.x);
        const dz = Math.abs(a.z - point.z);
        if (a.role === 'infected') {
          if (a.z <= point.z + 2 && dx < point.width / 2 + 8) pressure++;
          if (a.z < point.z + 0.4 && dx < point.width / 2 + 0.65 && dz < 2.35 &&
              a.targetAgentId === null && a.stunnedTimer <= 0) attackers += a.zombieVariant === 'brute' ? 3 : 1;
        } else if (a.role === 'police' || a.role === 'civilian') {
          if (dx < point.width / 2 && dz < 1.35) occupied = true;
          if (this.stationOfficers.get(a.id) === id && a.z < point.z && dx < point.width / 2 + 3 && dz < 5) {
            friendlyWaiting = true;
          }
        }
      }
      if (pressure >= 5 || gate.integrity <= 0) this.ktxRetreat[id] = true;
      this.damageKtxGate(id, attackers, dt);
      if (!updatePressure || this.simTime < gate.manualUntil || occupied) continue;
      const open = id === 'public' ? pressure < 3 || (friendlyWaiting && attackers === 0)
        : this.ktxRetreat.crew && friendlyWaiting;
      this.setKtxGate(id, open);
    }

    const point = KTX_GATES.transfer;
    const gate = this.ktxGates.transfer;
    let attackers = 0;
    let occupied = false;
    let friendlyWaiting = false;
    let infectedNear = false;
    for (const a of this.spatial.queryRadius(point.x, point.z, 7, this.neighborBuffer)) {
      if (!a.isAlive || a.isEvacuated || a.isTrainPassenger || Math.abs(a.climbY - point.y) > 0.55) continue;
      const dx = a.x - point.x;
      const dz = Math.abs(a.z - point.z);
      if (dz > point.width / 2 + 1.25) continue;
      if (a.role === 'infected' && dx < 0.5) {
        if (dx > -3.7) infectedNear = true;
        if (dx > -2.1 && dz < point.width / 2 + 0.4 && a.stunnedTimer <= 0 && a.targetAgentId === null) {
          attackers += a.zombieVariant === 'brute' ? 3 : 1;
        }
      } else if (a.role !== 'infected') {
        if (Math.abs(dx) < 0.75 && dz < point.width / 2) occupied = true;
        if ((a.role === 'police' || a.role === 'civilian') && dx < 0 && dx > -7) friendlyWaiting = true;
      }
    }
    this.damageKtxGate('transfer', attackers, dt);
    if (updatePressure && this.simTime >= gate.manualUntil && !occupied) {
      this.setKtxGate('transfer', friendlyWaiting && !infectedNear);
    }

    const mezzPt = KTX_GATES.mezzanine;
    const mezzGate = this.ktxGates.mezzanine;
    let mezzAttackers = 0;
    let mezzOccupied = false;
    let mezzFriendlyWaiting = false;
    let mezzInfectedNear = 0;
    for (const a of this.spatial.queryRadius(mezzPt.x, mezzPt.z, 14, this.neighborBuffer)) {
      if (!a.isAlive || a.isEvacuated || Math.abs(a.climbY - mezzPt.y) > 1.25) continue;
      const dx = Math.abs(a.x - mezzPt.x);
      const dz = Math.abs(a.z - mezzPt.z);
      if (a.role === 'infected') {
        if (a.z <= mezzPt.z + 2.2 && dx < mezzPt.width / 2 + 6) mezzInfectedNear++;
        if (a.z <= mezzPt.z + 0.5 && dx < mezzPt.width / 2 + 0.65 && dz < 2.25 &&
            a.targetAgentId === null && a.stunnedTimer <= 0) {
          mezzAttackers += a.zombieVariant === 'brute' ? 3 : 1;
        }
      } else if (a.role === 'police' || a.role === 'civilian') {
        if (dx < mezzPt.width / 2 && dz < 1.35) mezzOccupied = true;
        if (a.z <= mezzPt.z && dx < mezzPt.width / 2 + 5 && dz < 5.5 &&
            (this.stationOfficers.get(a.id) === 'public' || a.role === 'civilian')) {
          mezzFriendlyWaiting = true;
        }
      }
    }
    this.damageKtxGate('mezzanine', mezzAttackers, dt);
    if (updatePressure && this.simTime >= mezzGate.manualUntil && !mezzOccupied) {
      const sealThreat = this.ktxRetreat.public ? mezzInfectedNear >= 1 : mezzInfectedNear >= 3;
      const allowPassage = !sealThreat || (mezzFriendlyWaiting && mezzAttackers === 0 && mezzInfectedNear < 2);
      this.setKtxGate('mezzanine', allowPassage);
    }

    for (const id of KTX_GATE_IDS) {
      const ktxGate = this.ktxGates[id];
      const target = (ktxGate.open || ktxGate.integrity <= 0) ? 1 : 0;
      const step = dt * 2.4;
      if (ktxGate.openFraction < target) ktxGate.openFraction = Math.min(target, ktxGate.openFraction + step);
      else if (ktxGate.openFraction > target) ktxGate.openFraction = Math.max(target, ktxGate.openFraction - step);
    }
  }

  private damageKtxGate(id: KtxGateId, attackers: number, dt: number): void {
    const gate = this.ktxGates[id];
    if (gate.open || gate.integrity <= 0 || attackers === 0) return;
    gate.integrity = Math.max(0, gate.integrity - Math.min(34, attackers * 8) * dt);
    gate.lastDamagedAt = this.simTime;
    if (gate.integrity > 0) return;
    const point = KTX_GATES[id];
    this.triggerAlert('BREACH: ' + point.label, 'danger');
    this.addEventLog('infection', 'BREACH: ' + point.label, point.x, point.z);
    this.onSound?.('gate_slam', point.x, point.z);
  }

  private setKtxGate(id: KtxGateId, open: boolean): void {
    const gate = this.ktxGates[id];
    if (gate.integrity <= 0 || gate.open === open) return;
    gate.open = open;
    const point = KTX_GATES[id];
    this.transmitRadio({ kind: open ? 'gateOpening' : 'gateClosing', place: point.label });
    this.onSound?.('gate_slam', point.x, point.z);
  }

  private constrainKtxMove(agent: AgentData, oldX: number, oldZ: number): void {
    if (this.ridingKtx(agent)) {
      if (!this.trainSeats.get(agent.id)?.seating) this.resolveTrainCollisions(agent, 0.55);
      return;
    }
    const entranceZ = KTX_LAST_LINE_Z + 0.5;
    if (!this.layeredKtx || agent.onWallDeck || agent.fallY > 0.05 || (agent.z < entranceZ && oldZ < entranceZ)) return;
    const previous = ktxSurfaceAt(oldX, oldZ, agent.climbY);
    const previousCar = this.getTrainCarForPos(oldX, oldZ, agent.climbY);
    const supportedHeight = previous ? ktxSurfaceHeight(previous, oldX, oldZ) : agent.climbY;
    const heightAt = (x: number, z: number): number | null => {
      const blocked = (box: { x: number; z: number; width: number; depth: number; height: number; y?: number }) => {
        const base = box.y ?? 0;
        if (supportedHeight < base - 0.35 || supportedHeight >= base + box.height - 0.03) return false;
        const halfW = box.width / 2 + 0.4;
        const halfD = box.depth / 2 + 0.4;
        const depth = (px: number, pz: number) => Math.min(halfW - Math.abs(px - box.x), halfD - Math.abs(pz - box.z));
        const before = depth(oldX, oldZ);
        if (before > 0) return depth(x, z) >= before;
        if (depth(x, z) > 0) return true;
        return segmentIntersectsAABB(oldX, oldZ, x, z, box.x - halfW, box.x + halfW, box.z - halfD, box.z + halfD);
      };
      if (KTX_BOXES.some(blocked) || KTX_GATE_IDS.some((id) => !this.ktxGateOpen(id) && blocked(ktxGateBox(id)))) return null;

      const surface = ktxSurfaceAt(x, z, supportedHeight);
      if (surface) {
        if (surface.id === 'boarding' && this.expressTrain.state !== 'DOCKED') return null;
        if (previous && !ktxCanWalkBetween(previous, surface)) return null;
        if (!previous && (previousCar ? surface.id !== 'boarding' :
            !KTX_GROUND_ENTRIES.includes(surface.id) || oldZ > surface.minZ + 0.06)) return null;
        return ktxSurfaceHeight(surface, x, z);
      }
      if (this.getTrainCarForPos(x, z, supportedHeight) && (previousCar || previous?.id === 'boarding')) return KTX_PLATFORM_Y;
      if (previous && (!KTX_GROUND_ENTRIES.includes(previous.id) || z >= previous.minZ)) return null;
      return supportedHeight <= 0.53 ? 0 : null;
    };
    const candidates = [[agent.x, agent.z], [agent.x, oldZ], [oldX, agent.z]];
    for (const [x, z] of candidates) {
      const y = heightAt(x, z);
      if (y === null) continue;
      agent.x = x;
      agent.z = z;
      agent.climbY = y;
      agent.onTerminalFloor = y > 0;
      return;
    }
    agent.x = oldX;
    agent.z = oldZ;
    agent.vx = 0;
    agent.vz = 0;
  }

  private ktxBlocksSight(from: AgentData, to: AgentData): boolean {
    if (!this.layeredKtx || Math.max(from.z, to.z) < KTX_LAST_LINE_Z + 0.5) return false;
    const y = Math.min(from.climbY, to.climbY) + 1.1;
    const intersects = (x: number, z: number, width: number, depth: number) =>
      segmentIntersectsAABB(from.x, from.z, to.x, to.z,
        x - width / 2, x + width / 2, z - depth / 2, z + depth / 2);
    const blocks = (box: { x: number; z: number; width: number; depth: number; height: number; y?: number }) => {
      const base = box.y ?? 0;
      return y >= base && y < base + box.height && intersects(box.x, box.z, box.width, box.depth);
    };
    return KTX_BOXES.some(blocks) || KTX_GATE_IDS.some((id) => !this.ktxGateOpen(id) && blocks(ktxGateBox(id)));
  }

  private moveThroughTerminal(agent: AgentData, dt: number, officerLane?: KtxLane): boolean {
    if (!this.layeredKtx || agent.z < KTX_LAST_LINE_Z + 1.4 || agent.onWallDeck || agent.fallY > 0.1) return false;
    const infected = agent.role === 'infected';
    const lane = officerLane ?? (infected && agent.x < -10 ? 'crew' : 'public');
    const docked = this.expressTrain.state === 'DOCKED' &&
      (infected || !!officerLane || this.expressTrain.currentLoad < this.expressTrain.layout.capacity);
    const surface = ktxSurfaceAt(agent.x, agent.z, agent.climbY)?.id;
    const car = this.getTrainCarForPos(agent.x, agent.z, agent.climbY);
    if (docked && (surface === 'boarding' && agent.z < this.expressTrain.z - 0.35 ||
        !car && surface === 'platform' && agent.x > KTX_TRANSFER_X + 1)) {
      this.moveThroughTrainDoor(agent, agent.baseSpeed, dt);
      return true;
    }
    if (docked && car) {
      agent.destinationLabel = 'Moving through KTX';
      this.moveAlongTrainAisle(agent, this.expressTrain.x + this.expressTrain.cabinSwitchLocalX - 2, agent.baseSpeed, dt);
      return true;
    }
    const platformBusy = !infected && !officerLane && this.ktxPlatformCivilians >= 72;
    const waypoint = ktxWaypoint(agent.x, agent.z, agent.climbY, lane, docked,
      infected || !!officerLane || this.ktxGateOpen(lane), agent.id,
      infected || !!officerLane || this.ktxGateOpen('mezzanine'), platformBusy);
    agent.destinationLabel = waypoint.label;
    if (Math.hypot(waypoint.x - agent.x, waypoint.z - agent.z) > 0.29) {
      if (waypoint.direct) this.steerTowards(agent, waypoint.x, waypoint.z, agent.baseSpeed, dt);
      else this.steerAroundStationGround(agent, waypoint, agent.baseSpeed, dt);
    } else {
      agent.vx = 0;
      agent.vz = 0;
    }
    return true;
  }

  private steerAroundStationGround(agent: AgentData, goal: Vec2, speed: number, dt: number): void {
    if (!this.layeredKtx || agent.climbY > 0.12 || agent.z < KTX_LAST_LINE_Z + 1.4 || goal.z < KTX_LAST_LINE_Z + 1.4 ||
        ktxGroundSegmentClear(agent, goal)) {
      this.stationDetours.delete(agent);
      this.steerTowards(agent, goal.x, goal.z, speed, dt);
      return;
    }
    const escape = ktxGroundEscape(agent);
    if (escape) {
      this.stationDetours.delete(agent);
      this.steerTowards(agent, escape.x, escape.z, speed, dt);
      return;
    }
    let detour = this.stationDetours.get(agent);
    if (!detour || Math.hypot(detour.goal.x - goal.x, detour.goal.z - goal.z) > 1.2 || detour.retryAt <= this.simTime) {
      detour = { goal, path: ktxGroundDetour(agent, goal), retryAt: this.simTime + 1.25 + (agent.id % 5) * 0.11 };
      this.stationDetours.set(agent, detour);
    }
    let next = goal;
    for (let i = detour.path.length - 1; i >= 0; i--) {
      if (!ktxGroundSegmentClear(agent, detour.path[i])) continue;
      next = detour.path[i];
      break;
    }
    this.steerTowards(agent, next.x, next.z, speed, dt);
  }

  private moveThroughTrainDoor(agent: AgentData, speed: number, dt: number): void {
    const tr = this.expressTrain;
    const doorX = tr.x + tr.boardingDoorLocalX;
    const apronZ = tr.z - 3.9;
    const aligned = Math.abs(agent.x - doorX) <= 0.33 || agent.z >= tr.z - 2;
    const z = aligned ? tr.z : apronZ;
    agent.destinationLabel = 'KTX Boarding Door';
    this.steerTowards(agent, doorX, z, speed, dt);
  }

  private moveToTrainSeat(agent: AgentData, dt: number): boolean {
    const tr = this.expressTrain;
    if (!this.layeredKtx || !this.getTrainCarForAgent(agent)) return false;
    const assignedSeat = this.trainSeats.get(agent.id);
    if (!assignedSeat && !this.ridingKtx(agent)) return false;
    const blocked = assignedSeat && tr.doors.some((door) => door.isLocked && !door.isBroken &&
      (agent.x < tr.x + door.localX) !== (assignedSeat.x < tr.x + door.localX));
    if (blocked) this.trainSeats.delete(agent.id);
    if (!assignedSeat || blocked) this.assignTrainSeat(agent);
    const seat = this.trainSeats.get(agent.id);
    if (!seat) {
      agent.vx = agent.vz = 0;
      return true;
    }
    if (agent.role === 'police') {
      agent.targetAgentId = null;
      agent.policeState = 'HOLDING_POSITION';
    }
    agent.destinationLabel = 'Aboard KTX-101';
    if (!seat.seating && Math.abs(agent.x - seat.x) <= 0.26) seat.seating = true;
    if (seat.seating && Math.abs(agent.z - seat.z) <= 0.15) {
      agent.vx = agent.vz = 0;
      return true;
    }
    if (seat.seating) this.steerTowards(agent, seat.x, seat.z, agent.baseSpeed, dt);
    else this.moveAlongTrainAisle(agent, seat.x, agent.baseSpeed, dt);
    return true;
  }

  private reactToTrainThreat(agent: AgentData, dt: number): boolean {
    if (!this.layeredKtx || !this.getTrainCarForAgent(agent)) return false;
    const tr = this.expressTrain;
    const nearby = this.spatial.queryRadius(agent.x, agent.z, 26, this.neighborBuffer);
    const doorBetween = (x: number, targetX: number) => tr.doors.some((door) => door.isLocked && !door.isBroken &&
      (x < tr.x + door.localX) !== (targetX < tr.x + door.localX));
    const threats: AgentData[] = [];
    let threat: AgentData | undefined;
    let distance = 26;
    for (const other of nearby) {
      if (!other.isAlive || other.role !== 'infected' || !this.getTrainCarForAgent(other) ||
          doorBetween(agent.x, other.x)) continue;
      threats.push(other);
      const range = Math.hypot(other.x - agent.x, other.z - agent.z);
      if (range >= distance) continue;
      threat = other;
      distance = range;
    }
    if (!threat) return false;

    const officer = agent.role === 'police';
    const direction = agent.x < threat.x ? -1 : 1;
    const doors = direction > 0 ? tr.doors : [...tr.doors].reverse();
    const refuge = doors.find((door) => {
      const x = tr.x + door.localX;
      return !doorBetween(agent.x, x + direction * 0.85) &&
        (x - threat.x) * direction > 0.65 &&
        (x - agent.x) * direction >= (officer && !door.isBroken ? -3.15 : 0.1);
    });
    const doorX = refuge ? tr.x + refuge.localX : undefined;
    const seat = this.trainSeats.get(agent.id);
    if (seat && Math.abs(agent.z - tr.z) <= 0.38) seat.seating = false;

    const clearOfDoor = doorX !== undefined && (agent.x - doorX) * direction >= 1.15;
    if (officer && refuge && doorX !== undefined && clearOfDoor && !refuge.isBroken &&
        (doorX - threat.x) * direction <= 14 && this.simTime >= refuge.manualUntil) {
      const occupied = nearby.some((other) => other.isAlive && !other.isEvacuated &&
        this.getTrainCarForAgent(other) &&
        (Math.abs(other.x - doorX) < 0.85 && Math.abs(other.z - tr.z) < 1.3 ||
          other.role !== 'infected' && other.civState !== 'CONVULSING' &&
          (doorX - other.x) * direction > 0 && (other.x - threat.x) * direction > 0));
      if (!occupied) {
        this.setTrainBulkhead(refuge, true);
        this.transmitRadio({ kind: 'gateClosing', place: refuge.label }, agent);
        agent.destinationLabel = 'Sealing KTX carriage';
        return true;
      }
    }

    const limit = tr.x + (direction > 0 ? tr.layout.frontX - 1.4 : tr.layout.rearX + 1.4);
    let goal = doorX === undefined ? limit : doorX + direction * (officer && !refuge?.isBroken ? 2.35 : 4.5);
    for (const other of threats) {
      if ((other.x - agent.x) * direction <= 0 || (other.x - goal) * direction > 3) continue;
      goal = other.x - direction * 3;
    }
    agent.vx = agent.vz = 0;
    if ((goal - agent.x) * direction > 0.2 || Math.abs(agent.z - tr.z) > 0.25) {
      this.moveAlongTrainAisle(agent, goal, agent.baseSpeed * (officer ? 1.12 : 1.28), dt);
    }
    if (officer) {
      agent.policeState = 'RETREATING';
      agent.destinationLabel = 'Covering KTX carriage';
      agent.targetAgentId = threat.id;
      let clearShot = distance <= 17;
      if (clearShot) {
        this.visitTrainCover((minX, maxX, minZ, maxZ, height) => {
          if (clearShot && height > 1.35 &&
              segmentIntersectsAABB(agent.x, agent.z, threat.x, threat.z, minX, maxX, minZ, maxZ)) clearShot = false;
        });
      }
      if (clearShot) {
        agent.rotationY = Math.atan2(threat.x - agent.x, threat.z - agent.z);
        if (agent.attackCooldown <= 0 && agent.reloadTimer <= 0 && agent.ammo > 0) this.firePoliceWeapon(agent, threat);
      }
    } else {
      agent.civState = 'FLEEING';
      agent.destinationLabel = 'Fleeing through KTX carriages';
    }
    return true;
  }

  private setTrainBulkhead(door: TrainBulkheadDoorData, locked: boolean): void {
    door.isLocked = locked;
    const tr = this.expressTrain;
    this.onSound?.('gate_slam', tr.x + door.localX, tr.z);
    this.triggerAlert(locked ? `🔒 SEALED ${door.label}!` : `🔓 UNLOCKED ${door.label}`, locked ? 'warn' : 'info');
  }

  private moveAlongTrainAisle(agent: AgentData, x: number, speed: number, dt: number): void {
    const aisleZ = this.expressTrain.z;
    this.steerTowards(agent, Math.abs(agent.z - aisleZ) > 0.25 ? agent.x : x, aisleZ, speed, dt);
  }

  private resolveTrainCollisions(pos: Vec2, radius: number): void {
    const tr = this.expressTrain;
    if (!tr.active || (tr.state !== 'DOCKED' && tr.state !== 'DEPARTING' && tr.state !== 'QUARANTINE')) return;
    if (pos.z < tr.z - 4.2 || pos.z > tr.z + 4.2 || pos.x < tr.x + tr.layout.rearX - 5 || pos.x > tr.x + tr.layout.frontX + 5) return;

    const pushBox = (bMinX: number, bMaxX: number, bMinZ: number, bMaxZ: number) => {
      const minX = bMinX - radius;
      const maxX = bMaxX + radius;
      const minZ = bMinZ - radius;
      const maxZ = bMaxZ + radius;
      if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ) {
        const dL = pos.x - minX;
        const dR = maxX - pos.x;
        const dT = pos.z - minZ;
        const dB = maxZ - pos.z;
        const m = Math.min(dL, dR, dT, dB);
        if (m === dL) pos.x = minX - 0.01;
        else if (m === dR) pos.x = maxX + 0.01;
        else if (m === dT) pos.z = minZ - 0.01;
        else pos.z = maxZ + 0.01;
      }
    };

    this.visitTrainCover(pushBox);
  }

  private visitTrainCover(
    pushBox: (minX: number, maxX: number, minZ: number, maxZ: number, height: number) => void
  ): void {
    const tr = this.expressTrain;
    if (!tr.active || (tr.state !== 'DOCKED' && tr.state !== 'DEPARTING' && tr.state !== 'QUARANTINE')) return;
    const tx = tr.x;
    const tz = tr.z;
    const wall = (minX: number, maxX: number, minZ: number, maxZ: number) =>
      pushBox(minX, maxX, minZ, maxZ, tr.carHeight + 0.25);
    const rear = tx + tr.layout.rearX;
    const front = tx + tr.layout.frontX;
    const door = tx + tr.boardingDoorLocalX;
    wall(rear - TRAIN_NOSE_LENGTH, rear - 0.05, tz - 1.8, tz + 1.8);
    wall(front - 0.05, front + TRAIN_NOSE_LENGTH, tz - 1.8, tz + 1.8);

    wall(rear - 0.1, door - 1.85, tz - 2.18, tz - 1.92);
    wall(door + 1.85, front + 0.1, tz - 2.18, tz - 1.92);
    if (tr.state !== 'DOCKED') wall(door - 1.85, door + 1.85, tz - 2.18, tz - 1.92);
    wall(rear - 0.1, front + 0.1, tz + 1.92, tz + 2.18);
    wall(rear - 0.25, rear + 0.08, tz - 2.15, tz + 2.15);
    wall(front - 0.25, front + 0.15, tz - 2.15, tz + 2.15);

    const seatStart = tr.layout.seatRows[tr.layout.seatRows.length - 1] + 0.33;
    for (const center of tr.layout.centers) {
      const x = tx + center;
      for (const side of [-1, 1]) {
        pushBox(x - seatStart, x - 2.02, tz + side * 1.43 - 0.52, tz + side * 1.43 + 0.52, 1.35);
        pushBox(x + 2.02, x + seatStart, tz + side * 1.43 - 0.52, tz + side * 1.43 + 0.52, 1.35);
      }
    }

    // Inter-car Bulkhead side walls + locked sliding glass connector doors
    for (let i = 0; i < tr.doors.length; i++) {
      const td = tr.doors[i];
      const dx = tx + td.localX;
      wall(dx - 0.18, dx + 0.18, tz - 2.15, tz - 0.88);
      wall(dx - 0.18, dx + 0.18, tz + 0.88, tz + 2.15);
      if (td.isLocked && !td.isBroken) {
        wall(dx - 0.16, dx + 0.16, tz - 0.9, tz + 0.9);
      }
    }
  }

  private updateExpressTrain(dt: number): void {
    const tr = this.expressTrain;
    if (!tr.active) return;

    const half = this.city.cityHalfX;
    const minX = -half - tr.layout.frontX - TRAIN_NOSE_LENGTH - 8;
    const maxX = half - tr.layout.rearX + TRAIN_NOSE_LENGTH + 8 + (this.layeredKtx ? KTX_RAIL_EXTENSION : 0);
    const prevX = tr.x;

    tr.timer -= dt;

    if (tr.state === 'COOLDOWN') {
      tr.x = minX;
      if (tr.timer <= 0) {
        tr.state = 'APPROACHING';
        tr.timer = 5.0;
        tr.playerDeparting = false;
        tr.playerInsideCar = 0;
        tr.currentLoad = 0;
        for (const d of tr.doors) {
          d.isLocked = false;
          d.isBroken = false;
          d.integrity = d.maxIntegrity;
          d.lastHitTime = -99;
          d.manualUntil = 0;
        }
        this.effects.push({
          type: 'train_horn',
          x: tr.stationX,
          z: tr.stationZ,
          age: 0,
          duration: 1.5
        });
        if (this.onSound) this.onSound('train_horn', tr.stationX, tr.stationZ);
        this.triggerAlert('🚄 KTX-101 APPROACHING PLATFORM — 5s TO BOARDING!', 'info');
        this.addEventLog(
          'evac',
          `TRAIN ALERT: High-speed evacuation express approaching Central Station!`,
          tr.stationX,
          tr.stationZ
        );
      }
    } else if (tr.state === 'APPROACHING') {
      const p = 1 - Math.max(0, tr.timer) / 5.0;
      const eased = 1 - (1 - p) * (1 - p);
      tr.x = minX + (tr.stationX - minX) * eased;
      this.plowZombiesOnTrack(tr);

      if (tr.timer <= 0) {
        tr.state = 'DOCKED';
        tr.timer = this.layeredKtx ? 60 : 40;
        tr.x = tr.stationX;
        this.triggerAlert(`KTX-101 DOCKED (${tr.timer}s): BOARD CAR ${tr.layout.carCount}`, 'info');

        // Push a small pursuing threat toward Car 3 rear plaza in FP mode for authentic Train to Busan tension
        if (this.firstPerson.active && !this.layeredKtx) {
          let nearTermZ = 0;
          const platNear = this.spatial.queryRadius(tr.stationX - 15, 188, 22, this.neighborBuffer);
          for (let i = 0; i < platNear.length; i++) {
            if (platNear[i].isAlive && platNear[i].role === 'infected') nearTermZ++;
          }
          if (nearTermZ < 2 && this.agents.length < 2380) {
            const fp = this.getAgentById(this.firstPerson.playerId);
            for (let k = 0; k < 2; k++) {
              const sx = tr.stationX - 20 - k * 3.5;
              const sz = 186.5 + k * 2.0;
              if (!fp || Math.hypot(fp.x - sx, fp.z - sz) > 9.0) {
                const zmb = this.createAgent('infected', sx, sz, false, k === 0 ? 'runner' : 'standard');
                this.pushAgent(zmb);
              }
            }
          }
        }
      }
    } else if (tr.state === 'DOCKED') {
      tr.x = tr.stationX;
      const boardingX = tr.stationX + tr.boardingDoorLocalX;
      const platZ = tr.stationZ - 5.5;
      const playerCar = this.getBoardedPlayerCar();
      if (this.layeredKtx) {
        for (const id of this.trainPassengers) {
          const rider = this.getAgentById(id);
          if (rider?.isAlive && rider.role !== 'infected' &&
              this.getTrainCarForPos(rider.x, rider.z, rider.climbY)) continue;
          this.trainSeats.delete(id);
          this.trainPassengers.delete(id);
        }
      }
      tr.currentLoad = this.trainPassengers.size + (playerCar ? 1 : 0);

      for (const a of this.agents) {
        if (tr.currentLoad >= tr.layout.capacity) break;
        if (!a.isAlive || a.isEvacuated || this.trainPassengers.has(a.id) || a.isPlayerControlled ||
            (a.role !== 'civilian' && !(a.role === 'police' && this.layeredKtx))) continue;
        if (a.avoidsEvacuation || a.civState === 'SHELTERED' || a.civState === 'CONVULSING') continue;
        const car = this.getTrainCarForPos(a.x, a.z, a.climbY);
        const distPlat = Math.hypot(a.x - boardingX, a.z - platZ);
        const boarded = this.layeredKtx
          ? car > 0 && a.z >= tr.z - 0.45
          : car > 0 || distPlat <= 3.8;
        if (boarded) {
          if (this.layeredKtx) {
            if (!this.assignTrainSeat(a)) continue;
          } else {
            a.isTrainPassenger = true;
          }
          this.trainPassengers.add(a.id);
          tr.currentLoad++;
          this.logAgentAction(a, 'Boarded the KTX-101. Waiting for departure.');
        } else if (!this.layeredKtx && distPlat <= 75 && a.civState !== 'EVACUATING' && a.repathCooldown <= 0) {
          a.civState = 'EVACUATING';
          a.repathCooldown = 1.2;
          a.destinationLabel = 'KTX Car 3 Boarding Door';
          a.path = this.city.findPath(a.x, a.z, boardingX, platZ, this.roadblocks, this.defenseWalls, this.blastGates, false);
          a.pathIndex = 0;
        }
      }

      this.dispatchExpressTrainIfReady(playerCar);
    } else if (tr.state === 'DEPARTING') {
      const p = 1 - Math.max(0, tr.timer) / (this.layeredKtx ? KTX_DEPARTURE_SECONDS : 5.5);
      const eased = p * p * (3 - 2 * p);
      tr.x = tr.stationX + (maxX - tr.stationX) * eased;
      const deltaTrainX = tr.x - prevX;
      for (const id of this.trainPassengers) {
        const rider = this.getAgentById(id);
        if (rider) rider.x += deltaTrainX;
      }
      for (const seat of this.trainSeats.values()) seat.x += deltaTrainX;
      this.plowZombiesOnTrack(tr);

      if (!this.layeredKtx && tr.playerDeparting && this.firstPerson.active && this.firstPerson.outcome === 'PLAYING') {
        const fp = this.getAgentById(this.firstPerson.playerId);
        if (fp && fp.isAlive) {
          fp.x += deltaTrainX;
          if (tr.timer <= 0) {
            tr.playerDeparting = false;
            fp.isEvacuated = true;
            this.totalEvacuated++;
            tr.boardedTotal++;
            this.firstPerson.outcome = 'ESCAPED';
            this.logAgentAction(fp, `Escaped aboard KTX-101 Express to Busan!`);
          }
        } else {
          tr.playerDeparting = false;
        }
      }

      if (tr.timer <= 0) {
        if (this.layeredKtx && this.countTrainInfected() > 0) {
          tr.state = 'QUARANTINE';
          tr.timer = KTX_QUARANTINE_SECONDS;
          this.triggerAlert('KTX QUARANTINE: Eliminate all infected aboard.', 'danger');
        } else {
          this.finishTrainTrip(minX);
        }
      }
    } else if (tr.state === 'QUARANTINE') {
      if (this.countTrainInfected() === 0) this.finishTrainTrip(minX);
      else if (tr.timer <= 0) this.finishTrainTrip(minX, true);
    }
  }

  public countTrainInfected(): number {
    let count = 0;
    if (this.layeredKtx && this.expressTrain.state === 'DOCKED') {
      for (const a of this.agents) {
        if (a.isAlive && a.role === 'infected' && this.getTrainCarForAgent(a) > 0) count++;
      }
      return count;
    }
    for (const id of this.trainPassengers) {
      const rider = this.getAgentById(id);
      if (rider?.isAlive && rider.role === 'infected') count++;
    }
    return count;
  }

  private finishTrainTrip(returnX: number, quarantined = false): void {
    const tr = this.expressTrain;
    if (quarantined) {
      for (const id of this.trainPassengers) {
        const rider = this.getAgentById(id);
        if (!rider) continue;
        if (rider.isAlive && rider.role !== 'infected') {
          this.logAgentAction(rider, 'Held in train quarantine.');
          if (this.firstPerson.active && this.firstPerson.playerId === id && this.firstPerson.outcome === 'PLAYING') {
            this.firstPerson.outcome = 'QUARANTINED';
          }
        }
        rider.isTrainPassenger = false;
        rider.isAlive = false;
      }
      this.trainPassengers.clear();
      this.trainSeats.clear();
      this.triggerAlert('KTX EVACUATION FAILED: Infected remain aboard.', 'danger');
    } else {
      const before = this.totalEvacuated;
      this.evacuateTrainPassengers();
      if (this.layeredKtx) {
        this.triggerAlert(this.withEvacuationTotal(`KTX ARRIVED: ${this.totalEvacuated - before} safely evacuated.`), 'info');
      }
    }
    tr.state = 'COOLDOWN';
    tr.timer = 22;
    tr.currentLoad = 0;
    tr.playerInsideCar = 0;
    tr.x = returnX;
    tr.playerDeparting = false;
  }

  private assignTrainSeat(agent: AgentData): boolean {
    const tr = this.expressTrain;
    const occupied = new Set([...this.trainSeats.values()].map((seat) => `${seat.x},${seat.z}`));
    const rows = [...tr.layout.seatRows].sort((a, b) => b - a);
    for (let car = tr.layout.centers.length - 1; car >= 0; car--) {
      const center = tr.x + tr.layout.centers[car];
      if (tr.doors.some((door) => door.isLocked && !door.isBroken &&
          (agent.x < tr.x + door.localX) !== (center < tr.x + door.localX))) continue;
      for (const row of rows) {
        for (const side of TRAIN_SEAT_SIDES) {
          const x = center + row, z = tr.z + side;
          if (occupied.has(`${x},${z}`)) continue;
          this.trainSeats.set(agent.id, { x, z, seating: false });
          return true;
        }
      }
    }
    return false;
  }

  private getBoardedPlayerCar(): number {
    if (!this.firstPerson.active || this.firstPerson.outcome !== 'PLAYING') return 0;
    const player = this.getAgentById(this.firstPerson.playerId);
    return player?.isAlive && player.role !== 'infected' && player.civState !== 'CONVULSING'
      ? this.getTrainCarForPos(player.x, player.z, player.climbY)
      : 0;
  }

  private dispatchExpressTrainIfReady(playerCar: number): boolean {
    const tr = this.expressTrain;
    if (this.layeredKtx && this.countTrainInfected() >= KTX_EMERGENCY_INFECTED) {
      this.departExpressTrain('infestation', playerCar);
    } else if (tr.currentLoad >= tr.layout.capacity) {
      this.departExpressTrain('full', playerCar);
    } else if (tr.timer <= 0) {
      this.departExpressTrain('scheduled', playerCar);
    } else {
      return false;
    }
    return true;
  }

  private departExpressTrain(reason: 'full' | 'scheduled' | 'manual' | 'infestation', playerCar: number): void {
    const tr = this.expressTrain;
    tr.currentLoad = this.trainPassengers.size + (playerCar ? 1 : 0);
    if (this.layeredKtx) {
      for (const a of this.agents) {
        if (!a.isAlive || a.isEvacuated || !this.getTrainCarForAgent(a) ||
            (a.isPlayerControlled && !playerCar) || (a.role === 'civilian' && a.avoidsEvacuation && !a.isPlayerControlled) ||
            (!a.isPlayerControlled && !this.trainPassengers.has(a.id) && a.role !== 'infected' && a.z < tr.z - 0.45)) continue;
        this.trainPassengers.add(a.id);
        a.isTrainPassenger = true;
        a.vx = a.vz = 0;
      }
      tr.currentLoad = this.trainPassengers.size - this.countTrainInfected();
    } else {
      this.evacuateTrainPassengers();
    }
    tr.state = 'DEPARTING';
    tr.timer = this.layeredKtx ? KTX_DEPARTURE_SECONDS : 5.5;
    tr.playerInsideCar = playerCar;
    tr.playerDeparting = playerCar > 0;
    this.onSound?.('train_horn', tr.stationX, tr.stationZ);
    let message = 'KTX-101 DEPARTED';
    if (reason === 'infestation') {
      message = this.firstPerson.active && this.firstPerson.outcome === 'PLAYING' && !playerCar
        ? 'KTX EMERGENCY: Infected boarded. You missed the train.'
        : 'KTX EMERGENCY: Infected boarded. Departing immediately.';
    } else if (reason === 'full') {
      message = playerCar ? 'KTX-101 FULL: YOU ARE ON BOARD' : 'KTX-101 FULL: DEPARTING NOW';
    } else if (reason === 'manual') {
      message = 'KTX-101 EMERGENCY DEPARTURE';
    } else if (playerCar) {
      message = '🚄 KTX-101 DEPARTING FOR BUSAN — YOU MADE IT ON BOARD!';
    } else if (this.firstPerson.active && this.firstPerson.outcome === 'PLAYING') {
      message = '⚠ MISSED KTX-101! Hold out in Central Station until next train!';
    }
    this.triggerAlert(this.withEvacuationTotal(message), reason === 'infestation' || message.startsWith('⚠') ? 'danger' : 'info');
    const departure = reason === 'infestation' ? message :
      `TRAIN DEPARTED: KTX-101 carried ${tr.currentLoad}/${tr.layout.capacity} passengers.`;
    this.addEventLog('evac', this.withEvacuationTotal(departure), tr.stationX, tr.stationZ);
  }

  private evacuateTrainPassengers(): void {
    for (const id of this.trainPassengers) {
      const passenger = this.getAgentById(id);
      if (!passenger) continue;
      passenger.isTrainPassenger = false;
      if (!passenger.isAlive || passenger.isEvacuated) continue;
      if (passenger.role === 'infected') {
        passenger.isAlive = false;
        continue;
      }
      passenger.isEvacuated = true;
      this.expressTrain.boardedTotal++;
      this.totalEvacuated++;
      if (this.firstPerson.active && this.firstPerson.playerId === id && this.firstPerson.outcome === 'PLAYING') {
        this.firstPerson.outcome = 'ESCAPED';
      }
      this.logAgentAction(passenger, 'Evacuated aboard KTX-101.');
    }
    this.trainPassengers.clear();
    this.trainSeats.clear();
  }

  private plowZombiesOnTrack(tr: ExpressTrainData): void {
    const rear = tr.x + tr.layout.rearX - TRAIN_NOSE_LENGTH;
    const front = tr.x + tr.layout.frontX + TRAIN_NOSE_LENGTH;
    const near = this.spatial.queryRadius((rear + front) / 2, tr.z, (front - rear) / 2 + 1, this.neighborBuffer);
    for (let i = 0; i < near.length; i++) {
      const a = near[i];
      if (!a.isAlive || a.isTrainPassenger || a.role !== 'infected') continue;
      if (this.layeredKtx && (a.z < 194.05 || a.climbY < KTX_PLATFORM_Y - 0.5)) continue;
      if (Math.abs(a.z - tr.z) < 2.6 && a.x >= rear && a.x <= front) {
        a.isAlive = false;
        this.totalDeceased++;
      }
    }
  }

  /**
   * 3D Zombie Pyramid Accumulation & Defense Wall/Gate Breaching (WWZ style)
   */
  private updateWallsAndPyramids(dt: number): void {
    if (this.defenseWalls.length === 0) return;

    // Let climbers fight defenders on the fighting platform before dropping into the next sector.
    for (const [id, crossing] of this.wallCrossings) {
      const z = this.getAgentById(id);
      if (!z?.isAlive || z.role !== 'infected' || z.climbY === 0) {
        this.wallCrossings.delete(id);
        continue;
      }
      const { wall, startZ, deck } = crossing;
      const deckY = wall.height + WALL_DECK_RISE;
      z.vx = 0;
      z.vz = 0;
      if (crossing.progress < 1) {
        crossing.progress = Math.min(1, crossing.progress + dt / 0.9);
        z.z = startZ + (wall.z + 0.25 - startZ) * Math.max(0, (crossing.progress - 0.2) / 0.8);
        z.climbY = Math.min(deckY, z.climbY + 3 * dt);
        z.rotationY = 0;
        z.onWallDeck = crossing.progress === 1 && deck !== null;
        if (z.onWallDeck && !wall.pyramidBreachNotified) {
          wall.pyramidBreachNotified = true;
          this.triggerAlert(`INFECTED ON LINE ${wall.layerIndex} WALL: Hold the gates!`, 'warn');
          this.onSound?.('siren', z.x, wall.z);
          this.addEventLog(
            'infection',
            `PYRAMID BREACH: Infected reached the top of ${wall.label} at x=${Math.round(z.x)}!`,
            z.x,
            wall.z
          );
        }
        continue;
      }
      if (z.stunnedTimer > 0) continue;
      let target: AgentData | null = null;
      let nearest = 9;
      if (deck) {
        for (const defender of this.spatial.queryRadius(z.x, z.z, nearest, this.neighborBuffer)) {
          if (!defender.isAlive || !defender.onWallDeck || defender.role === 'infected' ||
              defender.x < deck.minX - 0.38 || defender.x > deck.maxX + 0.38 ||
              Math.abs(defender.climbY - z.climbY) > 0.9 ||
              defender.z < wallDeckFrontZ(wall) - 0.1 || defender.z > wall.z + wall.thickness / 2 + WALL_DECK_REAR_TRIM) continue;
          const distance = Math.hypot(defender.x - z.x, defender.z - z.z);
          if (distance < nearest) {
            nearest = distance;
            target = defender;
          }
        }
      }
      if (target && deck) {
        z.rotationY = Math.atan2(target.x - z.x, target.z - z.z);
        z.targetAgentId = target.id;
        z.zombieState = nearest <= 1.45 ? 'ATTACKING' : 'PURSUING';
        z.destinationLabel = `Attacking defenders on Line ${wall.layerIndex}`;
        if (nearest > 1.45) {
          const step = Math.min(nearest - 1.42, z.baseSpeed * 0.6 * dt);
          z.vx = Math.sin(z.rotationY) * step / dt;
          z.vz = Math.cos(z.rotationY) * step / dt;
          z.x = Math.max(deck.minX, Math.min(deck.maxX, z.x + z.vx * dt));
          z.z = Math.max(wallDeckFrontZ(wall), Math.min(wall.z + wall.thickness / 2, z.z + z.vz * dt));
          z.animPhase += step * 3;
        } else if (z.attackCooldown <= 0) {
          z.attackMode = 'claw_swipe';
          z.attackCooldown = 0.92;
          if (target.isPlayerControlled) this.performZombieAttack(z, target);
          else this.applySustainedBite(z, target, target.isSwat ? 17 : 23);
        }
        continue;
      }
      z.targetAgentId = null;
      z.zombieState = 'BREACHING';
      z.destinationLabel = `Dropping behind Line ${wall.layerIndex}`;
      z.rotationY = 0;
      z.z += dt * 3.5;
      if (z.z < wall.z + wall.thickness / 2 + 0.85) continue;
      this.wallCrossings.delete(id);
      z.onWallDeck = false;
      z.fallY = z.climbY;
      z.fallVy = -1;
      z.climbY = 0;
      z.vz = 1.7;
    }

    // The crowd can pound the panels once the opening is too narrow to pass.
    for (let gi = 0; gi < this.blastGates.length; gi++) {
      const g = this.blastGates[gi];
      if (g.openFraction > 0.22 || g.breached) continue;

      const near = this.spatial.queryRadius(g.x, g.z, g.width * 0.5 + 3.5, this.neighborBuffer);
      let dps = 0;
      for (let k = 0; k < near.length; k++) {
        const z = near[k];
        if (!z.isAlive || z.role !== 'infected' || z.climbY > 0.5 || z.fallY > 0 ||
            z.targetAgentId !== null || z.grappleTargetId !== null) continue;
        if (Math.abs(z.x - g.x) <= g.width * 0.5 + 1.5 && Math.abs(z.z - g.z) <= 3.8) {
          dps += z.zombieVariant === 'brute' ? 20 : 6;
        }
      }

      if (dps > 0) {
        g.integrity -= Math.min(68, dps) * dt;
        g.lastDamagedAt = this.simTime;
        if (g.integrity <= 0) {
          g.integrity = 0;
          g.breached = true;
          this.effects.push({
            type: 'explosion',
            x: g.x,
            z: g.z,
            age: 0,
            duration: 0.7
          });
          if (this.onSound) this.onSound('explosion', g.x, g.z);
          this.addEventLog(
            'infection',
            `GATE SHATTERED: ${g.label} collapsed under infected assault!`,
            g.x,
            g.z
          );
          const wall = this.defenseWalls.find((w) => w.id === g.wallId);
          if (wall && !wall.breachedNotified) {
            wall.breachedNotified = true;
            this.gridFlickerTimer = 2.6;
            this.blackoutMaxZ = Math.max(this.blackoutMaxZ, wall.z);
            this.triggerAlert(`⚠ ${wall.label.toUpperCase()} BREACHED! FALL BACK!`, 'danger');
            if (this.onSound) this.onSound('siren', g.x, g.z);
          }
        }
      }
    }

    this.pyramidMembers.clear();
    // Each wall segment has a broad ground tier that supports progressively narrower tiers.
    for (let wi = 0; wi < this.defenseWalls.length; wi++) {
      const w = this.defenseWalls[wi];
      const bucketCount = w.pyramidHeights.length;
      let buckets = this.pyramidBuckets[wi];
      if (!buckets || buckets.length !== bucketCount) {
        buckets = Array.from({ length: bucketCount }, () => []);
        this.pyramidBuckets[wi] = buckets;
      } else {
        for (let b = 0; b < bucketCount; b++) {
          buckets[b].length = 0;
        }
      }

      for (let i = 0; i < this.agents.length; i++) {
        const z = this.agents[i];
        if (!z.isAlive || z.role !== 'infected' || z.fallY > 0 || z.stunnedTimer > 0 ||
            z.grappleTargetId !== null || z.targetAgentId !== null || this.wallCrossings.has(z.id)) continue;
        if (z.z >= w.z - 6.8 && z.z <= w.z + 0.4) {
          let atGate = false;
          for (let gi = 0; gi < this.blastGates.length; gi++) {
            const g = this.blastGates[gi];
            if (
              g.wallId === w.id &&
              Math.abs(z.x - g.x) <= g.width * 0.5 + 0.3
            ) {
              atGate = true;
              break;
            }
          }
          if (atGate) continue;

          const bIdx = Math.max(
            0,
            Math.min(bucketCount - 1, Math.floor((z.x - w.minX) / w.bucketSize))
          );
          buckets[bIdx].push(z);
        }
      }

      for (let b = 0; b < bucketCount; b++) {
        const list = buckets[b];
        w.pyramidHeights[b] = 0;
        if (list.length < PYRAMID_TIER_WIDTHS[0]) continue;
        list.sort((a, other) => a.id - other.id);
        const count = Math.min(list.length, PYRAMID_CAPACITY);
        let minX = w.minX + b * w.bucketSize + 0.35;
        let maxX = Math.min(w.maxX, minX + w.bucketSize - 0.7);
        for (const gate of this.blastGates) {
          if (gate.wallId !== w.id) continue;
          if (list[0].x < gate.x) maxX = Math.min(maxX, gate.x - gate.width / 2 - 0.4);
          else minX = Math.max(minX, gate.x + gate.width / 2 + 0.4);
        }
        if (maxX - minX < 2.1) continue;

        const centerX = (minX + maxX) * 0.5;
        const tierHeight = (w.height + WALL_DECK_RISE) / (PYRAMID_TIER_WIDTHS.length - 1);
        let firstInTier = 0;
        let supportY = 0;
        for (let tier = 0; tier < PYRAMID_TIER_WIDTHS.length && firstInTier < count; tier++) {
          const capacity = PYRAMID_TIER_WIDTHS[tier];
          const width = Math.min(capacity, count - firstInTier);
          const targetY = Math.min(tier * tierHeight, supportY + tierHeight);
          const tierZ = w.z - w.thickness / 2 - 0.6 - (PYRAMID_TIER_WIDTHS.length - 1 - tier) * 0.52;
          const spacing = Math.min(0.94, (maxX - minX) / Math.max(1, capacity - 1));
          let lowest = Infinity;
          for (let slot = 0; slot < width; slot++) {
            const z = list[firstInTier + slot];
            const x = centerX + (slot - (width - 1) * 0.5) * spacing;
            const advance = Math.min(1, dt * 2.6);
            z.x += (x - z.x) * advance;
            z.z += (tierZ - z.z) * advance;
            const lift = Math.max(-5 * dt, Math.min(2.7 * dt, targetY - z.climbY));
            z.climbY = Math.max(0, z.climbY + lift);
            z.rotationY = 0;
            z.vx = 0;
            z.vz = 0;
            z.zombieState = 'BREACHING';
            z.destinationLabel = `Climbing ${w.label}`;
            this.pyramidMembers.add(z.id);
            lowest = Math.min(lowest, z.climbY);
            w.pyramidHeights[b] = Math.max(w.pyramidHeights[b], z.climbY);
            if (tier !== PYRAMID_TIER_WIDTHS.length - 1 || z.climbY < w.height - 0.7 ||
                Math.abs(z.z - tierZ) > 0.45) continue;

            const deck = wallDeckSpan(w, this.blastGates, z.x);
            this.wallCrossings.set(z.id, { wall: w, progress: 0, startZ: z.z, deck });
            z.path = [];
            z.pathIndex = 0;
          }
          supportY = lowest;
          firstInTier += width;
        }
      }
    }

    for (const z of this.agents) {
      if (z.isAlive && z.role === 'infected' && z.climbY > 0 && !z.onTerminalFloor &&
          !this.pyramidMembers.has(z.id) && !this.wallCrossings.has(z.id)) {
        z.climbY = Math.max(0, z.climbY - dt * 11);
      }
    }
  }

  private transmitRadio(call: RadioCall, officer?: AgentData): void {
    this.policeRadio.push({
      call,
      time: this.simTime,
      unit: officer ? { id: officer.id, isSwat: officer.isSwat } : null
    });
    if (this.policeRadio.length > 16) this.policeRadio.shift();
  }

  private updatePoliceRadio(): void {
    if (this.simTime < this.nextRadioCheck) return;
    this.nextRadioCheck = this.simTime + 3.5;
    let report: { officer: AgentData; call: RadioCall; score: number; key: string } | undefined;
    for (const officer of this.agents) {
      if (officer.role !== 'police' || !officer.isAlive || officer.isEvacuated || officer.isTrainPassenger ||
          officer.isPlayerControlled || officer.civState === 'CONVULSING' || officer.policeState === 'CLIMBING' ||
          officer.pinnedById !== null || officer.stunnedTimer > 0) continue;

      let infected = 0;
      let police = 0;
      let civiliansNearby = false;
      const wall = officer.onWallDeck ? this.wallAssignments.get(officer.id)?.wall : undefined;
      for (const agent of this.spatial.queryRadius(officer.x, officer.z, 26, this.neighborBuffer)) {
        if (!agent.isAlive || agent.isEvacuated || agent.isTrainPassenger) continue;
        if (agent.role === 'infected') {
          const visible = wall ? this.canWallGuardSee(officer, agent, wall) :
            hasLineOfSight(officer.x, officer.z, agent.x, agent.z, this.city, this.defenseWalls, this.blastGates, this.interiorDoors);
          if (visible) infected++;
        } else if (agent.role === 'police') {
          police++;
        } else if (agent.role === 'civilian' && Math.hypot(agent.x - officer.x, agent.z - officer.z) <= 18) {
          civiliansNearby = true;
        }
      }
      if (infected === 0) continue;

      const place = this.city.getDistrictAtPos(officer.x, officer.z);
      const options = [
        { kind: 'warning', priority: 3, applies: civiliansNearby && infected >= 2 },
        { kind: 'support', priority: 2, applies: infected >= Math.max(4, police * 2) },
        { kind: 'contact', priority: 1, applies: true }
      ] as const;
      for (const { kind, priority, applies } of options) {
        if (!applies) continue;
        const key = `${kind}:${place}`;
        if ((this.radioCooldowns.get(key) ?? 0) > this.simTime) continue;
        const score = priority * 100 + Math.min(infected, 99);
        if (!report || score > report.score) report = { officer, call: { kind, place, count: infected }, score, key };
        break;
      }
    }
    if (report) {
      this.radioCooldowns.set(report.key, this.simTime + 24);
      this.transmitRadio(report.call, report.officer);
    }
  }

  private updateWallGateOrders(): void {
    if (this.simTime < this.nextWallGateCheck) return;
    this.nextWallGateCheck = this.simTime + 0.65;
    for (const gate of this.blastGates) {
      let infected = 0;
      let nearGateInfected = 0;
      let nearest = Infinity;
      let exitThreat = false;
      let inPassage = false;
      let waiting = 0;
      let crowd = 0;
      for (const agent of this.spatial.queryRadius(gate.x, gate.z, 42, this.neighborBuffer)) {
        if (!agent.isAlive || agent.isEvacuated || agent.isTrainPassenger) continue;
        const dx = Math.abs(agent.x - gate.x);
        const dz = agent.z - gate.z;
        const distance = Math.hypot(dx, dz);
        if (agent.role === 'infected') {
          nearest = Math.min(nearest, distance);
          if (distance <= 24) infected++;
          if (distance <= 13.5) nearGateInfected++;
          if (dz >= 0 && dz <= 12 && dx < gate.width / 2 + 2) exitThreat = true;
        } else if (agent.role === 'civilian') {
          if (dx < gate.width / 2 && Math.abs(dz) < 2.8) inPassage = true;
          if (dz <= 0 && (agent.civState === 'EVACUATING' || agent.civState === 'FLEEING')) {
            waiting++;
            if (distance < 17) crowd++;
          }
        }
      }
      const pressure = nearGateInfected >= 2 || nearest < 9.5 || exitThreat;
      const unsafeUntil = pressure ? this.simTime + 4 : this.gateTraffic.get(gate.id)?.unsafeUntil ?? 0;
      this.gateTraffic.set(gate.id, { infected, exitThreat, crowd, unsafeUntil });
      if (gate.breached || gate.z <= this.policeFrontZ || this.simTime < (this.gateCooldown.get(gate.id) ?? 0)) continue;
      const postX = wallPostX(gate.x);
      let guard: AgentData | null = null;
      for (const [id, post] of this.wallAssignments) {
        if (post.wall.id !== gate.wallId || (post.x !== postX && post.x !== wallPostX(gate.x, true))) continue;
        const officer = this.getAgentById(id);
        if (officer?.isAlive && officer.role === 'police' && officer.stunnedTimer <= 0 &&
            (officer.policeState === 'HOLDING_POSITION' || officer.policeState === 'ENGAGING')) {
          guard = officer;
          break;
        }
      }
      if (!guard) continue;

      if (gate.isOpen && pressure && !inPassage) {
        this.toggleBlastGate(gate.id);
        this.guardSealedGates.set(gate.id, this.simTime);
        this.transmitRadio({ kind: 'gateClosing', place: gate.label }, guard);
        this.logAgentAction(guard, `Spotted incoming infected and ordered ${gate.label} closed.`);
        if (this.onSound) this.onSound('radio', gate.x, gate.z);
      } else {
        const sealedAt = this.guardSealedGates.get(gate.id);
        const initialEvacuation = this.layeredKtx && !this.gateCooldown.has(gate.id) && waiting > 0;
        const guardsReopening = sealedAt !== undefined && this.simTime - sealedAt >= 6.5;
        if (!gate.isOpen && nearGateInfected === 0 && !exitThreat && waiting > 0 && (initialEvacuation || guardsReopening)) {
          this.toggleBlastGate(gate.id);
          this.gateCooldown.set(gate.id, this.simTime + GATE_OPEN_SECONDS);
          this.transmitRadio({ kind: 'gateOpening', place: gate.label }, guard);
          this.logAgentAction(guard, `All clear at ${gate.label}. Reopening the passage.`);
        }
      }
    }
  }

  private updateGateTravel(dt: number): void {
    for (const gate of this.blastGates) {
      const target = gate.isOpen ? 1 : 0;
      if (gate.breached || gate.openFraction === target) continue;
      gate.openFraction = gate.isOpen
        ? Math.min(1, gate.openFraction + dt / GATE_OPEN_SECONDS)
        : Math.max(0, gate.openFraction - dt / GATE_CLOSE_SECONDS);
      if (gate.openFraction === target) {
        if (this.onSound) this.onSound('gate_slam', gate.x, gate.z);
        this.addEventLog('police', `BLAST GATE: ${gate.label} ${gate.isOpen ? 'OPEN' : 'SEALED'}.`, gate.x, gate.z);
      }
    }
  }

  private updateAICommander(): void {
    if (!this.firstPerson.active || this.firstPerson.outcome !== 'PLAYING' ||
        !this.config.allowPlayerIntervention || this.simTime < this.nextCommanderOrder) return;
    this.nextCommanderOrder = this.simTime + 2.5;
    const player = this.getAgentById(this.firstPerson.playerId);
    if (!player?.isAlive) return;

    let threatenedGate: BlastGateData | null = null;
    let maxPressure = 3;
    for (const gate of this.blastGates) {
      if (gate.z <= this.policeFrontZ) continue;
      let infected = 0;
      for (const agent of this.spatial.queryRadius(gate.x, gate.z - 4, 25, this.neighborBuffer)) {
        if (!agent.isAlive || agent.isEvacuated) continue;
        if (agent.role === 'infected' && agent.z < gate.z + 2) infected++;
      }
      if (infected > maxPressure) {
        threatenedGate = gate;
        maxPressure = infected;
      }
    }

    if (this.simTime < this.nextCommanderSupport) return;
    let strike: { x: number; z: number; height: number } | null = null;
    for (const wall of this.defenseWalls) {
      for (let bucket = 0; bucket < wall.pyramidHeights.length; bucket++) {
        const height = wall.pyramidHeights[bucket];
        const x = wall.minX + (bucket + 0.5) * wall.bucketSize;
        const z = wall.z - 3;
        if (height >= wall.height * 0.68 && height > (strike?.height ?? 0) &&
            Math.hypot(player.x - x, player.z - z) > 18) strike = { x, z, height };
      }
    }
    if (strike && this.deployFragBomb(strike.x, strike.z)) {
      this.commanderOrder = 'Ordered a strike on a zombie pile';
      this.nextCommanderSupport = this.simTime + 13;
      return;
    }

    if (threatenedGate) {
      const gate = threatenedGate;
      const wall = this.defenseWalls.find((candidate) => candidate.id === gate.wallId)!;
      const postX = wallPostX(gate.x);
      const vacancies = this.getVacantWallSlots(wall, postX);
      if (vacancies.length >= 2 && this.deploySwatSquad(postX, wall.z)) {
        this.commanderOrder = `Sent SWAT to Line ${wall.layerIndex}`;
        this.nextCommanderSupport = this.simTime + 15;
        return;
      }
    }

    const nearby = this.spatial.queryRadius(player.x, player.z, 32, this.neighborBuffer);
    let infectedCount = 0;
    let officers = 0;
    for (const agent of nearby) {
      if (!agent.isAlive || agent.isEvacuated) continue;
      if (agent.role === 'infected') infectedCount++;
      if (agent.role === 'police') officers++;
    }
    if (infectedCount >= 5 && officers < 2 && this.commandPoints >= 35 && this.canReinforceAt(player.z)) {
      const responseNode = this.city.findNearestNode(player.x, player.z + 12);
      if (this.deployPoliceSquad(responseNode.x, responseNode.z)) {
        this.commanderOrder = `Sent a patrol to ${responseNode.district}`;
        this.nextCommanderSupport = this.simTime + 16;
      }
    }
  }

  private handlePinnedOrStunned(a: AgentData): boolean {
    if (a.pinnedById !== null) {
      a.vx = 0;
      a.vz = 0;
      if (
        a.stunnedTimer <= 0 &&
        a.attackMode === 'neck_grapple' &&
        (a.role === 'police' || a.bravery > 0.72) &&
        a.attackCooldown <= 0
      ) {
        a.attackCooldown = 1.0;
        if (this.rng.chance(a.role === 'police' ? 0.42 : 0.3)) {
          const att = this.getAgentById(a.pinnedById);
          if (att) {
            const dx = att.x - a.x;
            const dz = att.z - a.z;
            const d = Math.hypot(dx, dz) || 1;
            const oldX = att.x, oldZ = att.z;
            att.x += (dx / d) * 1.6;
            att.z += (dz / d) * 1.6;
            att.stunnedTimer = 0.95;
            resolveWorldCollisions(
              att,
              0.55,
              this.city,
              this.defenseWalls,
              this.blastGates,
              att.climbY,
              this.interiorDoors
            );
            this.constrainKtxMove(att, oldX, oldZ);
          }
          this.releaseGrapple(a);
          a.stunnedTimer = 0;
          this.logAgentAction(a, 'Broke free from zombie grapple!');
          if (a.role === 'civilian' && att) {
            this.fleeFromThreat(a, att.x, att.z);
          }
          return true;
        }
      }
      return true;
    }

    if (a.stunnedTimer > 0) {
      a.vx *= 0.82;
      a.vz *= 0.82;
      return true;
    }
    return false;
  }

  private updateMedic(m: AgentData, dt: number): void {
    if (this.handlePinnedOrStunned(m) || this.clearInnerGateApproach(m, dt)) return;
    if (m.perceptionCooldown <= 0) {
      const crowdFactor = this.agents.length > 1400 ? 1.85 : this.agents.length > 800 ? 1.35 : 1.0;
      m.perceptionCooldown = 0.24 * crowdFactor + (m.id % 7) * 0.035;

      const neighbors = this.spatial.queryRadius(m.x, m.z, m.awarenessRadius, this.neighborBuffer);
      let nearestZombie: AgentData | null = null;
      let nearestZombieDist = Infinity;
      let nearestPatient: AgentData | null = null;
      let bestPatientScore = Infinity;

      const maxN = Math.min(neighbors.length, 32);
      for (let i = 0; i < maxN; i++) {
        const other = neighbors[i];
        if (!other.isAlive || other.id === m.id) continue;
        const dx = other.x - m.x;
        const dz = other.z - m.z;
        const dSq = dx * dx + dz * dz;

        if (other.role === 'infected') {
          if (dSq < nearestZombieDist * nearestZombieDist) {
            nearestZombieDist = Math.sqrt(dSq);
            nearestZombie = other;
          }
        } else if (
          other.isIncubating ||
          other.civState === 'CONVULSING' ||
          other.health < other.maxHealth * 0.85
        ) {
          const d = Math.sqrt(dSq);
          const score =
            d -
            (other.isIncubating || other.civState === 'CONVULSING' ? 40 : 0) -
            (other.isPlayerControlled ? 55 : 0);
          if (score < bestPatientScore) {
            bestPatientScore = score;
            nearestPatient = other;
          }
        }
      }

      if (nearestZombie && nearestZombieDist < 4.5) {
        m.medicState = 'FLEEING';
        m.threatPos = { x: nearestZombie.x, z: nearestZombie.z };
        m.targetAgentId = null;
        m.destinationLabel = 'Evading Hostile';
      } else if (nearestPatient) {
        m.medicState = 'TREATING';
        m.targetAgentId = nearestPatient.id;
        m.destinationLabel = nearestPatient.isIncubating
          ? `Curing ${nearestPatient.name}`
          : `Treating ${nearestPatient.name}`;
      } else if (m.medicState === 'FLEEING' || m.medicState === 'TREATING') {
        m.medicState = 'PATROLLING';
        m.targetAgentId = null;
      }
    }

    if (m.medicState === 'FLEEING' && m.threatPos) {
      const awayX = m.x + (m.x - m.threatPos.x) * 3;
      const awayZ = m.z + (m.z - m.threatPos.z) * 3;
      this.steerTowards(m, awayX, awayZ, m.baseSpeed * 1.15, dt);
      return;
    }

    if (m.medicState === 'TREATING') {
      const patient = this.getAgentById(m.targetAgentId);
      if (
        patient &&
        patient.isAlive &&
        !patient.isEvacuated &&
        (patient.isIncubating || patient.civState === 'CONVULSING' || patient.health < patient.maxHealth * 0.85)
      ) {
        const dist = Math.hypot(patient.x - m.x, patient.z - m.z);
        if (dist <= 1.95) {
          if (m.attackCooldown <= 0) {
            m.attackCooldown = 1.2;
            const wasIncubating = patient.isIncubating || patient.civState === 'CONVULSING';
            patient.isIncubating = false;
            patient.incubationTimer = 0;
            patient.convulseTimer = 0;
            patient.health = patient.maxHealth;
            patient.civState = 'WALKING';

            this.effects.push({
              type: 'cure',
              x: patient.x,
              z: patient.z,
              age: 0,
              duration: 0.85
            });
            if (this.onSound) this.onSound('cure', patient.x, patient.z);

            if (wasIncubating) {
              m.cures++;
              this.totalCured++;
              const district = this.city.getDistrictAtPos(m.x, m.z);
              this.logAgentAction(m, `Administered antiviral serum to ${patient.name}!`);
              this.logAgentAction(patient, `Cured of infection by ${m.name}!`);
              this.addEventLog(
                'evac',
                `SERUM CURE: ${m.name} cured ${patient.name} in ${district}!`,
                patient.x,
                patient.z
              );
            }
          }
        } else {
          this.steerTowards(m, patient.x, patient.z, m.baseSpeed * 1.15, dt);
        }
        return;
      } else {
        m.medicState = 'PATROLLING';
        m.targetAgentId = null;
      }
    }

    const reached = this.moveAlongPath(m, m.baseSpeed * 0.9, dt);
    if (reached) {
      m.medicState = 'PATROLLING';
      this.assignRandomPatrolDestination(m);
    }
  }

  private processEmergencyDispatch(): void {
    for (let i = 0; i < this.reports.length; i++) {
      const rep = this.reports[i];
      if (rep.dispatched) continue;
      if (!this.canReinforceAt(rep.z)) continue;

      if (this.simTime - rep.timestamp < this.config.dispatchDelaySeconds) {
        continue;
      }

      const gate = this.nearbyThreatenedGate(rep.x, rep.z);
      if (gate && !this.canReinforceAt(gate.z)) continue;
      const wall = gate && this.defenseWalls.find((line) => line.id === gate.wallId);
      const candidates: Array<{ officer: AgentData; dist: number }> = [];
      for (let j = 0; j < this.agents.length; j++) {
        const a = this.agents[j];
        if (!a.isAlive || a.isPlayerControlled || a.isHunter || !this.canReinforceAt(a.z) ||
            this.fallbacks.has(a.id) || this.wallAssignments.has(a.id) || this.groundPosts.has(a.id) ||
            (gate && a.z < gate.z + 2) || (a.role !== 'police' && a.role !== 'medic')) continue;
        if (
          (a.role === 'police' &&
            (a.policeState === 'PATROLLING' || a.policeState === 'INVESTIGATING')) ||
          (a.role === 'medic' && a.medicState === 'PATROLLING')
        ) {
          const d = Math.hypot(a.x - rep.x, a.z - rep.z);
          candidates.push({ officer: a, dist: d });
        }
      }

      candidates.sort((a, b) => a.dist - b.dist);
      const dispatchCount = Math.min(3, candidates.length);
      if (dispatchCount > 0) {
        for (let k = 0; k < dispatchCount; k++) {
          const ofc = candidates[k].officer;
          if (ofc.role === 'police') ofc.policeState = 'RESPONDING';
          else ofc.medicState = 'RESPONDING';
          ofc.destinationLabel = `911 Dispatch (${rep.district})`;
          const flank = gate && wall ? this.groundPostForGate(wall, gate, 2 + ofc.id % 10) : null;
          if (flank && ofc.role === 'police') this.groundPosts.set(ofc.id, flank);
          const destination = flank ?? rep;
          ofc.path = this.city.findPath(
            ofc.x,
            ofc.z,
            destination.x,
            destination.z,
            this.roadblocks,
            this.defenseWalls,
            this.blastGates,
            false
          );
          ofc.pathIndex = 0;
          this.logAgentAction(ofc, `Dispatched to emergency 911 report in ${rep.district}.`);
        }
        rep.dispatched = true;
        rep.respondersAssigned = dispatchCount;
        this.transmitRadio({ kind: 'dispatch', place: rep.district, count: dispatchCount });
        this.addEventLog(
          'police',
          `DISPATCH: ${dispatchCount} unit(s) responding to 911 call in ${rep.district}.`,
          rep.x,
          rep.z
        );
      }
    }
  }

  private updatePlayerInfection(a: AgentData, dt: number): void {
    if (a.civState === 'CONVULSING') {
      a.convulseTimer -= dt;
      if (a.convulseTimer <= 0) this.convertToInfected(a);
    } else if (a.isIncubating) {
      a.incubationTimer -= dt;
      a.health = Math.min(a.health, Math.max(15, (a.incubationTimer / a.maxIncubationTime) * a.maxHealth));
      if (a.incubationTimer <= 0) {
        a.isIncubating = false;
        a.civState = 'CONVULSING';
        a.convulseTimer = 2.0;
      }
    }
  }

  private updateCivilian(a: AgentData, dt: number): void {
    if (a.civState === 'CONVULSING') {
      a.vx = 0;
      a.vz = 0;
      a.convulseTimer -= dt;
      if (a.convulseTimer <= 0) {
        this.convertToInfected(a);
      }
      return;
    }

    if (a.isIncubating) {
      a.incubationTimer -= dt;
      a.health = Math.max(15, (a.incubationTimer / a.maxIncubationTime) * 100);
      if (a.incubationTimer <= 0) {
        if (a.civState === 'SHELTERED' && a.shelterBuildingId) {
          const b = this.city.buildingById.get(a.shelterBuildingId);
          if (b && b.shelteredAgentIds.length > 1) {
            for (const occId of [...b.shelteredAgentIds]) {
              if (occId === a.id) continue;
              const occ = this.getAgentById(occId);
              if (occ && occ.isAlive && !occ.isIncubating && this.rng.chance(0.55)) {
                occ.isIncubating = true;
                occ.incubationTimer = Math.max(2.0, this.config.incubationSeconds * 0.7);
                occ.maxIncubationTime = occ.incubationTimer;
                this.logAgentAction(occ, `Bitten inside ${b.name} shelter panic!`);
              }
            }
            b.doorIntegrity = 0;
            if (!b.hasUpperBreach && b.height >= 11) this.triggerWindowBreach(b);
            this.addEventLog(
              'infection',
              `SHELTER OUTBREAK: Infected carrier turned inside ${b.name}! Occupants fleeing!`,
              b.doorX,
              b.doorZ
            );
          }
          this.removeAgentFromShelter(a);
        }
        a.isIncubating = false;
        a.civState = 'CONVULSING';
        a.convulseTimer = 2.0;
        a.destinationLabel = 'Convulsing — Turning!';
        a.vx = 0;
        a.vz = 0;
        return;
      }
    }

    if (this.handlePinnedOrStunned(a)) return;
    if (this.reactToTrainThreat(a, dt)) return;
    if (this.moveToTrainSeat(a, dt)) return;
    if (
      a.avoidsEvacuation &&
      this.layeredKtx &&
      (a.z >= KTX_LAST_LINE_Z + 1.0 ||
        (this.civilianEvacuationStage === 2 && (a.civState === 'FLEEING' || a.threatPos !== null)))
    ) {
      a.avoidsEvacuation = false;
    }
    if (this.layeredKtx && !a.avoidsEvacuation && this.guideCivilianToKtx(a, dt)) {
      a.civState = 'EVACUATING';
      return;
    }
    if (a.civState !== 'SHELTERED' && this.clearInnerGateApproach(a, dt)) return;

    if (a.civState === 'SHELTERED') {
      const b = a.shelterBuildingId ? this.city.buildingById.get(a.shelterBuildingId) : undefined;
      if (!b || b.doorIntegrity <= 0) {
        this.removeAgentFromShelter(a);
        a.civState = 'FLEEING';
        this.logAgentAction(a, 'Building shelter breached! Fleeing into street!');
      }
      return;
    }

    if (a.perceptionCooldown <= 0) {
      const crowdFactor = this.agents.length > 1400 ? 1.85 : this.agents.length > 800 ? 1.35 : 1.0;
      a.perceptionCooldown = 0.24 * crowdFactor + (a.id % 7) * 0.035;

      const neighbors = this.spatial.queryRadius(a.x, a.z, a.awarenessRadius, this.neighborBuffer);
      let nearestThreat: AgentData | null = null;
      let nearestThreatDist = Infinity;
      let nearestThreatDistSq = Infinity;
      let threatCount = 0;
      let nearestPanicking: AgentData | null = null;

      const maxN = Math.min(neighbors.length, 32);
      for (let i = 0; i < maxN; i++) {
        const other = neighbors[i];
        if (other.id === a.id || !other.isAlive) continue;

        const dx = other.x - a.x;
        const dz = other.z - a.z;
        const dSq = dx * dx + dz * dz;
        if (other.role === 'infected' || other.civState === 'CONVULSING') {
          if (dSq < 42.25) {
            threatCount++;
            if (dSq < nearestThreatDistSq) {
              nearestThreatDistSq = dSq;
              nearestThreatDist = Math.sqrt(dSq);
              nearestThreat = other;
            }
          } else if (
            (dSq < nearestThreatDistSq || threatCount < 4) &&
            hasLineOfSight(a.x, a.z, other.x, other.z, this.city, this.defenseWalls, this.blastGates, this.interiorDoors)
          ) {
            threatCount++;
            if (dSq < nearestThreatDistSq) {
              nearestThreatDistSq = dSq;
              nearestThreatDist = Math.sqrt(dSq);
              nearestThreat = other;
            }
          }
        } else if (
          !nearestPanicking &&
          other.role === 'civilian' &&
          (other.civState === 'FLEEING' || other.civState === 'BEING_ATTACKED') &&
          dSq < 100.0
        ) {
          nearestPanicking = other;
        }
      }

      a.perceivedThreats = threatCount;

      if (nearestThreat) {
        a.threatPos = { x: nearestThreat.x, z: nearestThreat.z };
        const evac = a.avoidsEvacuation ? null : this.findNearestEvacZone(a.x, a.z, 55);

        if (
          !a.hasReported &&
          !a.isIncubating &&
          a.bravery > 0.62 &&
          nearestThreatDist > 5.0 &&
          a.civState !== 'REPORTING'
        ) {
          a.civState = 'REPORTING';
          a.reportProgress = 0;
          a.destinationLabel = 'Calling 911 Emergency';
          this.logAgentAction(a, `Witnessed attack! Calling 911 emergency dispatch.`);
        } else if (a.civState !== 'REPORTING' || nearestThreatDist <= 4.2) {
          if (evac && a.repathCooldown <= 0) {
            this.startEvacuating(a, evac);
          } else if (
            !a.isIncubating &&
            a.civState !== 'SEEKING_SHELTER' &&
            a.repathCooldown <= 0 &&
            this.rng.chance(a.avoidsEvacuation ? 0.58 : 0.28)
          ) {
            const shelter = this.findNearestAvailableShelter(a.x, a.z, 36);
            if (shelter) {
              const path = this.requestPath(a.x, a.z, shelter.doorX, shelter.doorZ, false);
              if (path?.length) {
                a.civState = 'SEEKING_SHELTER';
                a.shelterBuildingId = shelter.id;
                a.destinationLabel = `Shelter: ${shelter.name}`;
                a.path = path;
                a.pathIndex = 0;
                a.repathCooldown = 1.1;
                this.logAgentAction(a, `Running for shelter at ${shelter.name}.`);
              } else {
                this.fleeFromThreat(a, nearestThreat.x, nearestThreat.z);
              }
            } else {
              this.fleeFromThreat(a, nearestThreat.x, nearestThreat.z);
            }
          } else if (a.civState !== 'SEEKING_SHELTER' && a.repathCooldown <= 0) {
            this.fleeFromThreat(a, nearestThreat.x, nearestThreat.z);
          }
        }
      } else if (
        nearestPanicking &&
        (a.civState === 'WALKING' || a.civState === 'SOCIALIZING' || a.civState === 'INVESTIGATING')
      ) {
        if (
          hasLineOfSight(
            a.x,
            a.z,
            nearestPanicking.x,
            nearestPanicking.z,
            this.city,
            this.defenseWalls,
            this.blastGates,
            this.interiorDoors
          )
        ) {
          if (a.bravery > 0.72 && a.civState !== 'INVESTIGATING') {
            a.civState = 'INVESTIGATING';
            a.stateTimer = 3.5;
            a.targetPos = { x: nearestPanicking.x, z: nearestPanicking.z };
            a.destinationLabel = 'Investigating commotion';
            this.logAgentAction(a, `Noticed panicked crowd; investigating disturbance.`);
          } else if (nearestPanicking.threatPos) {
            a.threatPos = { ...nearestPanicking.threatPos };
            const evac = a.avoidsEvacuation ? null : this.findNearestEvacZone(a.x, a.z, 52);
            if (evac) {
              this.startEvacuating(a, evac);
            } else if (a.repathCooldown <= 0) {
              this.fleeFromThreat(a, nearestPanicking.threatPos.x, nearestPanicking.threatPos.z);
              this.logAgentAction(a, `Caught in crowd panic; fleeing down street.`);
            }
          }
        }
      }
    }

    switch (a.civState) {
      case 'REPORTING': {
        a.vx *= 0.5;
        a.vz *= 0.5;
        a.reportProgress += dt;
        if (a.reportProgress >= 1.8) {
          a.hasReported = true;
          const district = this.city.getDistrictAtPos(a.x, a.z);
          const reportX = a.threatPos ? a.threatPos.x : a.x;
          const reportZ = a.threatPos ? a.threatPos.z : a.z;

          const duplicate = this.reports.some(
            (r) => !r.dispatched && Math.hypot(r.x - reportX, r.z - reportZ) < 16
          );
          if (!duplicate) {
            this.reports.push({
              id: this.nextEntityId++,
              x: reportX,
              z: reportZ,
              district,
              timestamp: this.simTime,
              dispatched: false,
              respondersAssigned: 0,
              severity: 1
            });
            this.effects.push({
              type: 'report_ring',
              x: a.x,
              z: a.z,
              age: 0,
              duration: 1.6
            });
            if (this.onSound) this.onSound('radio', a.x, a.z);
            this.addEventLog(
              'report',
              `911 CALL: ${a.name} reported violent attack in ${district}!`,
              reportX,
              reportZ
            );
            if (this.config.allowPlayerIntervention) {
              this.commandPoints = Math.min(260, this.commandPoints + 5);
            }
          }
          if (a.threatPos) {
            this.fleeFromThreat(a, a.threatPos.x, a.threatPos.z);
          } else {
            a.civState = 'FLEEING';
          }
        }
        break;
      }

      case 'SEEKING_SHELTER': {
        const shelter = a.shelterBuildingId ? this.city.buildingById.get(a.shelterBuildingId) : undefined;
        if (
          !shelter ||
          shelter.doorIntegrity <= 0 ||
          shelter.shelteredAgentIds.length >= shelter.shelterCapacity
        ) {
          a.civState = 'FLEEING';
          a.shelterBuildingId = null;
          if (a.threatPos) this.fleeFromThreat(a, a.threatPos.x, a.threatPos.z);
          break;
        }
        this.moveAlongPath(a, a.baseSpeed * 1.42, dt);
        const distToDoor = Math.hypot(a.x - shelter.doorX, a.z - shelter.doorZ);
        if (distToDoor < 1.8) {
          shelter.shelteredAgentIds.push(a.id);
          a.civState = 'SHELTERED';
          a.vx = 0;
          a.vz = 0;
          a.destinationLabel = `Inside ${shelter.name}`;
          this.logAgentAction(a, `Took shelter inside ${shelter.name}.`);
        }
        break;
      }

      case 'EVACUATING': {
        const ez = this.findNearestEvacZone(a.x, a.z, 150);
        if (!ez) {
          if (this.expressTrain.active && (this.expressTrain.state === 'APPROACHING' || this.expressTrain.state === 'DOCKED')) {
            this.moveAlongPath(a, a.baseSpeed * 1.48, dt);
            break;
          }
          a.civState = 'WALKING';
          this.assignRandomCivilianDestination(a);
          break;
        }
        this.moveAlongPath(a, a.baseSpeed * 1.45, dt);
        const distToEvac = Math.hypot(a.x - ez.x, a.z - ez.z);
        if (distToEvac <= ez.radius) {
          a.isEvacuated = true;
          ez.extractedCount++;
          this.totalEvacuated++;
          this.logAgentAction(a, `Safely evacuated from the city!`);
          if (this.totalEvacuated % 25 === 1) {
            this.addEventLog(
              'evac',
              `EVACUATION: ${this.totalEvacuated} civilians extracted via evacuation perimeter.`,
              ez.x,
              ez.z
            );
          }
        }
        break;
      }

      case 'FLEEING':
      case 'FRIGHTENED':
      case 'BEING_ATTACKED': {
        const speedMult = a.isIncubating ? 1.15 : 1.5;
        this.moveAlongPath(a, a.baseSpeed * speedMult, dt);
        if (a.stateTimer <= 0 && a.perceivedThreats === 0) {
          const ez = a.avoidsEvacuation ? null : this.findNearestEvacZone(a.x, a.z, 60);
          if (ez) {
            this.startEvacuating(a, ez);
          } else {
            a.civState = 'WALKING';
            this.assignRandomCivilianDestination(a);
          }
        }
        break;
      }

      case 'INVESTIGATING': {
        if (a.targetPos) {
          this.steerTowards(a, a.targetPos.x, a.targetPos.z, a.baseSpeed * 0.85, dt);
        }
        if (a.stateTimer <= 0) {
          a.civState = 'WALKING';
          this.assignRandomCivilianDestination(a);
        }
        break;
      }

      case 'SOCIALIZING': {
        a.vx *= 0.7;
        a.vz *= 0.7;
        if (a.stateTimer <= 0) {
          a.civState = 'WALKING';
          this.assignRandomCivilianDestination(a);
        }
        break;
      }

      case 'WALKING':
      default: {
        const nearbyEvac = a.avoidsEvacuation ? null : this.findNearestEvacZone(a.x, a.z, 26);
        if (nearbyEvac) {
          const isDefaultEvac = nearbyEvac.id <= this.city.evacSpawnPoints.length;
          const localDanger = this.reports.some((r) => Math.hypot(r.x - a.x, r.z - a.z) < 36);
          if (!isDefaultEvac || localDanger) {
            this.startEvacuating(a, nearbyEvac);
            break;
          }
        }

        const reached = this.moveAlongPath(a, a.baseSpeed, dt);
        if (reached) {
          if (this.rng.chance(0.32)) {
            a.civState = 'SOCIALIZING';
            a.stateTimer = this.rng.range(3.0, 7.5);
            a.destinationLabel = `Resting in ${this.city.getDistrictAtPos(a.x, a.z)}`;
          } else {
            this.assignRandomCivilianDestination(a);
          }
        }
        break;
      }
    }
  }

  private updateCivilianEvacuationStage(): void {
    if (!this.layeredKtx || this.civilianEvacuationStage === 2) return;
    const [first, second] = this.defenseWalls;
    if (!first || !second) return;
    const infectedAtOrBeyond = (z: number) =>
      this.agents.some((a) => a.isAlive && a.role === 'infected' && !a.isTrainPassenger && a.z >= z - 22);
    const stage = second.breachedNotified || infectedAtOrBeyond(second.z) ? 2 :
      this.civilianEvacuationStage === 0 && (first.breachedNotified || infectedAtOrBeyond(first.z)) ? 1 : this.civilianEvacuationStage;
    if (stage === this.civilianEvacuationStage) return;
    this.civilianEvacuationStage = stage;
    const message = stage === 1 ? 'EVACUATION: Sector 2, proceed through Line 3 to KTX.' :
      'EVACUATION: Sector 3 and rally groups, proceed to KTX.';
    this.triggerAlert(message, 'warn');
    this.addEventLog('evac', message, 0, stage === 1 ? first.z : second.z);
  }

  private guideCivilianToKtx(a: AgentData, dt: number): boolean {
    const [first, second, last] = this.defenseWalls;
    if (!first || !second || !last) return false;
    if (a.z >= last.z + 1.4) {
      if (a.civState === 'SHELTERED') this.removeAgentFromShelter(a);
      return this.moveThroughTerminal(a, dt);
    }
    const holdBehindLine = this.civilianEvacuationStage < 2;
    if (holdBehindLine && !this.stagedCivilians.has(a.id)) {
      const inSectorTwo = a.z >= first.z && a.z < second.z;
      const outerRefugee = a.z < first.z && (a.civState === 'FLEEING' || a.civState === 'EVACUATING' ||
        !this.canReinforceAt(a.z) || !!this.nearbyThreatenedGate(a.x, a.z));
      if ((!inSectorTwo || this.civilianEvacuationStage === 0) && !outerRefugee) return false;
      this.stagedCivilians.add(a.id);
    }
    if (a.civState === 'SHELTERED') this.removeAgentFromShelter(a);
    const wall = this.defenseWalls.find((line) => a.z < line.z + (line === last ? 1.4 : line.thickness / 2 + 0.6));
    if (!wall) return false;
    const previous = this.civilianGateChoices.get(a.id);
    const passage = this.blastGates.find((gate) => gate.wallId === wall.id &&
      Math.abs(a.x - gate.x) < gateClearHalfWidth(gate) - 0.45 && Math.abs(a.z - gate.z) < 2.8 &&
      !this.gateTraffic.get(gate.id)?.exitThreat);
    const gate = passage ?? this.chooseEvacuationGate(a, wall, previous);
    if (!gate) return false;
    this.civilianGateChoices.set(a.id, gate);

    const canCross = passage === gate || this.canCivilianCrossGate(gate);
    if (!canCross) {
      const immediateThreat = this.spatial
        .queryRadius(a.x, a.z, 10, this.neighborBuffer)
        .some((other) => other.isAlive && other.role === 'infected');
      if (immediateThreat) return false;
    }
    const lane = Math.min(2.5, Math.max(0, gateClearHalfWidth(gate) - 1)) * (a.id % 5 - 2) / 2;
    const approach = a.z < gate.z - 14 || (a.z < gate.z - 2.6 && Math.abs(a.x - gate.x) > gateClearHalfWidth(gate) - 0.4);
    const goal = canCross
      ? { x: gate.x + lane, z: gate.z + (approach ? -2.6 : 5.2) }
      : this.gateWaitingPoint(a, gate);
    const destination = canCross
      ? `${approach ? 'Approaching' : 'Evacuating through'} ${gate.label}`
      : `Waiting away from ${gate.label}`;
    this.moveToGateGoal(a, goal, destination, a.baseSpeed * 1.3, dt);
    return true;
  }

  private clearInnerGateApproach(agent: AgentData, dt: number): boolean {
    if (agent.role === 'civilian' && this.layeredKtx && agent.z >= KTX_LAST_LINE_Z + 0.5) return false;
    const gate = this.blastGates.find((g) => agent.z > g.z + 0.9 && agent.z < g.z + 8.5 &&
      Math.abs(agent.x - g.x) < g.width / 2 + 2.4 && !this.isGateSafe(g));
    if (!gate) return false;

    const side = Math.abs(agent.x - gate.x) < 0.5 ? (agent.id % 2 ? 1 : -1) : Math.sign(agent.x - gate.x);
    const goal = { x: gate.x + side * (gate.width / 2 + 4), z: gate.z + 10 };
    this.moveToGateGoal(agent, goal, `Clearing the inside of ${gate.label}`, agent.baseSpeed, dt);
    return true;
  }

  private isGateThreatened(gate: BlastGateData): boolean {
    return (this.gateTraffic.get(gate.id)?.unsafeUntil ?? 0) > this.simTime;
  }

  private canCivilianCrossGate(gate: BlastGateData): boolean {
    return (gate.isOpen || gate.breached) && gateClearHalfWidth(gate) > 1.05 && !this.gateTraffic.get(gate.id)?.exitThreat;
  }

  private isGateSafe(gate: BlastGateData): boolean {
    return (gate.isOpen || gate.breached) && gateClearHalfWidth(gate) > 1.05 && !this.isGateThreatened(gate);
  }

  private chooseEvacuationGate(agent: AgentData, wall: DefenseWallData, previous?: BlastGateData): BlastGateData | undefined {
    let best: BlastGateData | undefined;
    let bestScore = Infinity;
    for (const gate of this.blastGates) {
      if (gate.wallId !== wall.id) continue;
      const traffic = this.gateTraffic.get(gate.id);
      const penalty = !this.canCivilianCrossGate(gate)
        ? 380 + (traffic?.infected ?? 0) * 3
        : this.isGateThreatened(gate)
        ? 140 + (traffic?.infected ?? 0) * 2
        : 0;
      const score = Math.abs(gate.x - agent.x) + penalty + Math.min(60, traffic?.crowd ?? 0) * 1.8 - (gate === previous ? 9 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = gate;
      }
    }
    return best;
  }

  private gateWaitingPoint(agent: AgentData, gate: BlastGateData): Vec2 {
    let spots = this.gateWaitingSpots.get(gate.id);
    if (!spots) {
      spots = [];
      this.gateWaitingSpots.set(gate.id, spots);
    }
    const slot = agent.id % 32;
    return spots[slot] ??= this.findGateWaitingPoint(gate, slot);
  }

  private findGateWaitingPoint(gate: BlastGateData, slot: number): Vec2 {
    const side = slot % 2 ? -1 : 1;
    const offset = 9 + (slot % 8) * 1.45;
    const x = gate.x + side * offset;
    const z = gate.z - 13 - Math.floor(slot / 8) * 2.4;
    const candidates = [{ x, z }, { x, z: gate.z - 30 }, { x: gate.x - side * offset, z: gate.z - 16 }];
    for (const point of candidates) {
      resolveWorldCollisions(point, 0.6, this.city, this.defenseWalls, this.blastGates, 0, this.interiorDoors);
      if (point.z <= gate.z - 11 && !this.isProbeBlocked(point.x, point.z)) return point;
    }
    return this.city.findNearestNode(x, gate.z - 34);
  }

  private moveToGateGoal(agent: AgentData, goal: Vec2, label: string, speed: number, dt: number): void {
    const previous = this.pursuitGoals.get(agent);
    if (agent.path.length === 0 || (previous && Math.hypot(goal.x - previous.x, goal.z - previous.z) > 9)) {
      agent.path = [];
      agent.pathIndex = 0;
      agent.repathCooldown = 0;
    }
    agent.destinationLabel = label;
    if (Math.hypot(agent.x - goal.x, agent.z - goal.z) <= 0.72) {
      agent.vx = 0;
      agent.vz = 0;
      return;
    }
    this.pursuePositionSmart(agent, goal.x, goal.z, speed, dt);
  }

  private updateInfected(z: AgentData, dt: number): void {
    if (this.wallCrossings.has(z.id)) return;
    if (z.fallY > 0 || z.stunnedTimer > 0) {
      z.vx *= 0.6;
      z.vz *= 0.6;
      return;
    }

    if (z.grappleTargetId !== null) {
      const victim = this.getAgentById(z.grappleTargetId);
      if (
        !victim ||
        !victim.isAlive ||
        victim.isEvacuated ||
        this.ridingKtx(victim) !== this.ridingKtx(z) ||
        (victim.isTrainPassenger && !this.ridingKtx(victim)) ||
        victim.role === 'infected' ||
        victim.civState === 'CONVULSING' ||
        z.pinTimer <= 0 ||
        victim.pinnedById !== z.id
      ) {
        this.releaseGrapple(z);
      } else {
        z.zombieState = 'FEEDING';
        z.vx = 0;
        z.vz = 0;
        const dx = victim.x - z.x;
        const dz = victim.z - z.z;
        const d = Math.hypot(dx, dz) || 0.01;
        z.rotationY = Math.atan2(dx, dz);
        const targetGap = z.attackMode === 'tackle_pin' ? 0.52 : 0.78;
        const pull = Math.min(1, dt * 10);
        const oldX = z.x, oldZ = z.z;
        z.x += (victim.x - (dx / d) * targetGap - z.x) * pull;
        z.z += (victim.z - (dz / d) * targetGap - z.z) * pull;
        this.constrainKtxMove(z, oldX, oldZ);
        z.destinationLabel =
          z.attackMode === 'tackle_pin'
            ? `Pinning & Mauling ${victim.name}`
            : `Grappling ${victim.name}`;
        if (z.attackCooldown <= 0) {
          z.attackCooldown = z.attackMode === 'tackle_pin' ? 0.82 : 0.9;
          this.applySustainedBite(z, victim);
        }
        return;
      }
    }

    const onPyramid = this.pyramidMembers.has(z.id);
    if (z.perceptionCooldown <= 0) {
      const crowdFactor = this.agents.length > 1400 ? 1.85 : this.agents.length > 800 ? 1.35 : 1.0;
      z.perceptionCooldown = 0.24 * crowdFactor + (z.id % 7) * 0.035;

      let bestTarget: AgentData | null = null;
      let bestScore = Infinity;
      let nearbyZombies = 0;
      const neighbors = this.spatial.queryRadius(z.x, z.z, z.awarenessRadius + 6, this.neighborBuffer);
      for (const candidate of neighbors) {
        if (!candidate.isAlive || candidate.id === z.id) continue;
        const dx = candidate.x - z.x;
        const dz = candidate.z - z.z;
        if (candidate.role === 'infected') {
          if (dx * dx + dz * dz < 64) nearbyZombies++;
          continue;
        }
        const score = Math.hypot(dx, dz) + (candidate.isIncubating ? 10 : 0) + (candidate.pinnedById !== null ? 14 : 0);
        if (score >= bestScore || !this.canPursueInfectionTarget(z, candidate, onPyramid)) continue;
        if (!hasLineOfSight(z.x, z.z, candidate.x, candidate.z, this.city, this.defenseWalls, this.blastGates, this.interiorDoors)) continue;
        bestScore = score;
        bestTarget = candidate;
      }
      z.perceivedThreats = nearbyZombies;
      z.targetAgentId = bestTarget?.id ?? null;
    }

    const currentTarget = this.getAgentById(z.targetAgentId);
    const hasTarget = this.canPursueInfectionTarget(z, currentTarget, onPyramid);
    if (!hasTarget) z.targetAgentId = null;
    if (onPyramid) {
      if (hasTarget && z.climbY > 0) {
        z.fallY = z.climbY;
        z.fallVy = -1;
        z.climbY = 0;
      }
      return;
    }

    const hordeFrenzy = z.perceivedThreats >= 4 ? 1.1 : 1.0;
    const breachMult = z.zombieVariant === 'brute' ? 3.0 : 1.0;

    if (hasTarget) {
      const tr = this.expressTrain;
      if (this.layeredKtx && this.getTrainCarForAgent(currentTarget)) {
        const car = this.getTrainCarForAgent(z);
        const surface = ktxSurfaceAt(z.x, z.z, z.climbY)?.id;
        if (surface === 'boarding' && z.z < tr.z - 0.35 ||
            !car && surface === 'platform' && z.x > KTX_TRANSFER_X + 1) {
          z.zombieState = 'PURSUING';
          this.moveThroughTrainDoor(z, z.baseSpeed, dt);
          return;
        }
        if (car && Math.abs(z.x - currentTarget.x) > 1.15 &&
            Math.abs(currentTarget.z - tr.z) > 0.65) {
          z.zombieState = 'PURSUING';
          this.moveAlongTrainAisle(z, currentTarget.x, z.baseSpeed, dt);
          return;
        }
      }
      const targetDist = Math.hypot(currentTarget.x - z.x, currentTarget.z - z.z, currentTarget.climbY - z.climbY);
      if (currentTarget.isPlayerControlled) {
        if (
          targetDist > 8.5 &&
          !hasLineOfSight(
            z.x,
            z.z,
            currentTarget.x,
            currentTarget.z,
            this.city,
            this.defenseWalls,
            this.blastGates,
            this.interiorDoors
          )
        ) {
          z.stateTimer += dt;
          if (z.stateTimer >= 2.6) {
            z.stateTimer = 0;
            z.targetAgentId = null;
            z.zombieState = 'WANDERING';
            z.destinationLabel = 'Lost Sight';
            return;
          }
        } else {
          z.stateTimer = 0;
        }
      }

      z.zombieState = 'PURSUING';
      z.destinationLabel = `Pursuing ${currentTarget.name}`;

      const brute = z.zombieVariant === 'brute';
      const attackRange = currentTarget.isPlayerControlled
        ? brute
          ? 2.25
          : 1.95
        : brute
        ? 1.85
        : 1.52;
      const keepDist = brute ? 2.18 : 1.88;

      if (targetDist <= attackRange) {
        z.zombieState = 'ATTACKING';
        z.rotationY = Math.atan2(currentTarget.x - z.x, currentTarget.z - z.z);
        if (currentTarget.isPlayerControlled) {
          z.vx *= 0.15;
          z.vz *= 0.15;
          if (targetDist < keepDist && targetDist > 0.001) {
            const push = (keepDist - targetDist) / targetDist;
            z.x -= (currentTarget.x - z.x) * push;
            z.z -= (currentTarget.z - z.z) * push;
          }
        }
        if (z.attackCooldown <= 0) {
          z.attackCooldown = z.zombieVariant === 'runner' ? 0.72 : 0.92;
          this.performZombieAttack(z, currentTarget);
        }
      } else {
        const lungeBoost = (targetDist < 5.0 ? 1.12 : 1.05) * hordeFrenzy;
        const maxChaseSpeed =
          z.zombieVariant === 'runner' ? 6.1 : z.zombieVariant === 'brute' ? 4.3 : 4.95;
        const chaseSpeed = Math.min(z.baseSpeed * lungeBoost, maxChaseSpeed);
        this.pursuePositionSmart(z, currentTarget.x, currentTarget.z, chaseSpeed, dt, currentTarget);
      }
      return;
    }

    // Roadblock collision & breaching
    for (let r = 0; r < this.roadblocks.length; r++) {
      const rb = this.roadblocks[r];
      if (!rb.active) continue;
      const distRb = Math.hypot(z.x - rb.x, z.z - rb.z);
      if (distRb < rb.radius + 1.0) {
        z.zombieState = 'BREACHING';
        z.destinationLabel = 'Attacking Police Barricade';
        z.vx = 0;
        z.vz = 0;
        rb.integrity -= dt * 15 * hordeFrenzy * breachMult;
        if (rb.integrity <= 0) {
          rb.active = false;
          this.addEventLog(
            'infection',
            `BREACH: Police roadblock overrun by infected in ${this.city.getDistrictAtPos(rb.x, rb.z)}!`,
            rb.x,
            rb.z
          );
          this.triggerAlert(
            `BARRICADE BREACHED in ${this.city.getDistrictAtPos(rb.x, rb.z)}!`,
            'warn'
          );
        }
        return;
      }
    }

    // Locked Train Inter-Car Bulkhead Glass Door pounding & shattering
    if (this.expressTrain.active &&
        (this.layeredKtx ? this.getTrainCarForAgent(z) : this.expressTrain.state === 'DOCKED')) {
      const tr = this.expressTrain;
      for (let tdi = 0; tdi < tr.doors.length; tdi++) {
        const td = tr.doors[tdi];
        if (!td.isLocked || td.isBroken) continue;
        const doorX = tr.x + td.localX;
        if (Math.hypot(z.x - doorX, z.z - tr.z) < 2.2) {
          z.zombieState = 'BREACHING';
          z.destinationLabel = `Pounding ${td.label}`;
          z.rotationY = Math.atan2(doorX - z.x, tr.z - z.z);
          z.vx = 0;
          z.vz = 0;
          const prevTick = Math.floor(td.lastHitTime / 0.55);
          td.integrity -= dt * 15 * hordeFrenzy * breachMult;
          td.lastHitTime = this.simTime;
          if (Math.floor(this.simTime / 0.55) !== prevTick) {
            this.effects.push({
              type: 'door_pound',
              x: doorX,
              y: z.climbY + 1.4,
              z: tr.z,
              age: 0,
              duration: 0.42
            });
            if (this.onSound) this.onSound('door_pound', doorX, tr.z);
          }
          if (td.integrity <= 0) {
            td.integrity = 0;
            td.isBroken = true;
            td.isLocked = false;
            this.effects.push({
              type: 'window_shatter',
              x: doorX,
              y: z.climbY + 1.5,
              z: tr.z,
              dirX: 1,
              dirZ: 0,
              age: 0,
              duration: 0.75
            });
            if (this.onSound) this.onSound('window_shatter', doorX, tr.z);
            this.triggerAlert(`⚠ SHATTERED: Infected broke through ${td.label}!`, 'danger');
          }
          return;
        }
      }
    }

    // Locked Interior Door pounding & shattering
    for (let di = 0; di < this.interiorDoors.length; di++) {
      const door = this.interiorDoors[di];
      if (!door.isLocked || door.isBroken) continue;
      const distDoor = Math.hypot(z.x - door.x, z.z - door.z);
      if (distDoor < 2.35) {
        const bld = this.city.buildingById.get(door.buildingId);
        if (!bld || this.insideBuilding(bld, z)) continue;
        const targetInside = this.spatial.queryRadius(z.x, z.z, z.awarenessRadius, this.neighborBuffer).some((target) =>
          target.isAlive && !target.isEvacuated && !target.isTrainPassenger && target.role !== 'infected' &&
          this.insideBuilding(bld, target)
        );
        if (targetInside) {
          z.zombieState = 'BREACHING';
          z.destinationLabel = `Pounding ${door.label}`;
          z.rotationY = Math.atan2(door.x - z.x, door.z - z.z);
          z.vx = 0;
          z.vz = 0;
          const prevTick = Math.floor(door.lastHitTime / 0.55);
          door.integrity -= dt * 13 * hordeFrenzy * breachMult;
          door.lastHitTime = this.simTime;
          if (Math.floor(this.simTime / 0.55) !== prevTick) {
            this.effects.push({
              type: 'door_pound',
              x: door.x,
              y: 1.4,
              z: door.z,
              age: 0,
              duration: 0.42
            });
            if (this.onSound) this.onSound('door_pound', door.x, door.z);
          }
          if (door.integrity <= 0) {
            door.integrity = 0;
            door.isBroken = true;
            door.isLocked = false;
            const dX = door.side === 'E' ? 1 : door.side === 'W' ? -1 : 0;
            const dZ = door.side === 'S' ? 1 : door.side === 'N' ? -1 : 0;
            this.effects.push({
              type: 'window_shatter',
              x: door.x,
              y: 1.5,
              z: door.z,
              dirX: dX,
              dirZ: dZ,
              age: 0,
              duration: 1.1
            });
            if (this.onSound) this.onSound('window_shatter', door.x, door.z);
            this.addEventLog(
              'infection',
              `DOOR SHATTERED: Infected broke through ${door.label}!`,
              door.x,
              door.z
            );
            this.triggerAlert(`${door.label} SHATTERED!`, 'danger');
          }
          return;
        }
      }
    }

    // Acoustic Lure Flare check
    let activeLure: LureFlareData | null = null;
    let bestLureDist = Infinity;
    for (let l = 0; l < this.lureFlares.length; l++) {
      const lf = this.lureFlares[l];
      if (!lf.active) continue;
      const d = Math.hypot(lf.x - z.x, lf.z - z.z);
      if (d <= lf.radius && d < bestLureDist) {
        bestLureDist = d;
        activeLure = lf;
      }
    }

    if (activeLure) {
      z.zombieState = 'PURSUING';
      z.destinationLabel = 'Drawn to Acoustic Lure';
      if (bestLureDist > 2.2) {
        this.pursuePositionSmart(z, activeLure.x, activeLure.z, z.baseSpeed * 1.15 * hordeFrenzy, dt);
      } else {
        z.vx *= 0.3;
        z.vz *= 0.3;
      }
      return;
    }

    if (this.ridingKtx(z)) {
      z.zombieState = 'PURSUING';
      this.moveAlongTrainAisle(z, this.expressTrain.x + this.expressTrain.cabinSwitchLocalX - 2, z.baseSpeed, dt);
      return;
    }
    if (this.moveThroughTerminal(z, dt)) {
      z.zombieState = 'PURSUING';
      return;
    }

    const nearBuildings = this.city.getBuildingsNearPos(z.x, z.z, this.buildingBuffer);
    for (let i = 0; i < nearBuildings.length; i++) {
      const b = nearBuildings[i];
      if (b.shelteredAgentIds.length > 0 && b.doorIntegrity > 0) {
        const dDoor = Math.hypot(z.x - b.doorX, z.z - b.doorZ);
        if (dDoor < 3.2) {
          z.zombieState = 'BREACHING';
          z.destinationLabel = `Pounding on ${b.name}`;
          this.steerTowards(z, b.doorX, b.doorZ, z.baseSpeed * 0.7, dt);
          if (dDoor < 1.6) {
            b.doorIntegrity -= dt * 12 * hordeFrenzy * breachMult;
            if (b.doorIntegrity <= 0) {
              if (!b.hasUpperBreach && b.height >= 11) this.triggerWindowBreach(b);
              this.addEventLog(
                'infection',
                `SHELTER BREACHED: Infected broke into ${b.name}!`,
                b.doorX,
                b.doorZ
              );
            }
          }
          return;
        }
      }
    }

    if (this.config.id === 'breach_siege' ? this.advanceSiegeFront(z, dt) : this.approachWallPile(z, dt)) return;

    let nearestAlarm: { x: number; z: number } | null = null;
    let bestAlarmDist = 26.0;
    for (const alarm of this.carAlarms.values()) {
      const d = Math.hypot(alarm.x - z.x, alarm.z - z.z);
      if (d < bestAlarmDist) {
        bestAlarmDist = d;
        nearestAlarm = alarm;
      }
    }
    if (nearestAlarm) {
      z.zombieState = 'PURSUING';
      z.destinationLabel = 'Drawn to Car Alarm';
      if (bestAlarmDist > 2.4) {
        this.pursuePositionSmart(z, nearestAlarm.x, nearestAlarm.z, z.baseSpeed * 1.12 * hordeFrenzy, dt);
      } else {
        z.vx *= 0.3;
        z.vz *= 0.3;
      }
      return;
    }

    z.zombieState = 'WANDERING';
    z.destinationLabel = 'Roaming Street';
    const reached = this.moveAlongPath(z, z.baseSpeed * 0.85, dt);
    if ((reached || z.path.length === 0) && z.repathCooldown <= 0) {
      // On Citadel Express, bias wandering zombies southward toward the next defense line / station!
      let goalNode;
      if (this.config.mapId === 'citadel_express' && this.rng.chance(0.7)) {
        const targetZ = Math.min(this.city.cityHalfZ - 10, z.z + 52);
        const gateXs = this.city.wallDefs[0]?.gateXs ?? [-52, 26];
        const targetX = this.rng.chance(0.6)
          ? this.rng.pick(gateXs)
          : this.rng.range(-this.city.cityHalfX + 18, this.city.cityHalfX - 18);
        goalNode = this.city.findNearestNode(targetX, targetZ);
      } else {
        goalNode = this.rng.pick(this.city.navNodes);
      }
      const path = this.requestPath(z.x, z.z, goalNode.x, goalNode.z, true);
      if (path?.length) {
        z.path = path;
        z.pathIndex = 0;
        z.repathCooldown = 1.0;
      } else {
        z.repathCooldown = 0.35;
      }
    }
  }

  private insideBuilding(building: BuildingData, pos: Vec2): boolean {
    return pos.x > building.minX && pos.x < building.maxX && pos.z > building.minZ && pos.z < building.maxZ;
  }

  private canPursueInfectionTarget(z: AgentData, target: AgentData | null, onPyramid: boolean): target is AgentData {
    if (!target?.isAlive || target.isEvacuated || this.ridingKtx(z) !== this.ridingKtx(target) ||
        (target.isTrainPassenger && !this.ridingKtx(target)) || target.role === 'infected' ||
        target.civState === 'SHELTERED' || target.civState === 'CONVULSING') return false;
    const hearing = target.civState === 'FLEEING' || target.policeState === 'ENGAGING' ||
      (target.policeState === 'RETREATING' && target.targetAgentId !== null);
    if (Math.hypot(target.x - z.x, target.z - z.z) > z.awarenessRadius + (hearing ? 6 : 0)) return false;
    if (Math.abs(target.climbY + target.fallY - (onPyramid ? 0 : z.climbY)) > 1.6) return false;

    const tr = this.expressTrain;
    if (tr.active && (tr.state === 'DOCKED' || this.ridingKtx(z)) && Math.abs(z.z - tr.z) <= 2.2 && Math.abs(target.z - tr.z) <= 2.2 &&
        tr.doors.some((door) => door.isLocked && !door.isBroken &&
          (z.x < tr.x + door.localX) !== (target.x < tr.x + door.localX))) return false;
    for (const door of this.interiorDoors) {
      if (!door.isLocked || door.isBroken || Math.hypot(z.x - door.x, z.z - door.z) >= 2.35) continue;
      const building = this.city.buildingById.get(door.buildingId);
      if (building && this.insideBuilding(building, target) && !this.insideBuilding(building, z)) return false;
    }
    if (this.layeredKtx && z.z >= 152 && target.z >= 152) {
      const from = ktxSurfaceAt(z.x, z.z, z.climbY);
      const to = ktxSurfaceAt(target.x, target.z, target.climbY);
      if (from && to && !ktxCanWalkBetween(from, to)) return false;
      if (this.ktxBlocksSight(z, target)) return false;
    }
    return true;
  }

  private releaseGrapple(agent: AgentData): void {
    if (agent.grappleTargetId !== null) {
      const victim = this.getAgentById(agent.grappleTargetId);
      if (victim && victim.pinnedById === agent.id) {
        victim.pinnedById = null;
        victim.attackMode = 'none';
        victim.pinTimer = 0;
        if (victim.isAlive && victim.role !== 'infected' && victim.civState !== 'CONVULSING') {
          victim.stunnedTimer = Math.max(victim.stunnedTimer, 0.35);
        }
      }
      agent.grappleTargetId = null;
      agent.pinTimer = 0;
      agent.attackMode = 'none';
    }
    if (agent.pinnedById !== null) {
      const attacker = this.getAgentById(agent.pinnedById);
      if (attacker && attacker.grappleTargetId === agent.id) {
        attacker.grappleTargetId = null;
        attacker.pinTimer = 0;
        attacker.attackMode = 'none';
        attacker.zombieState = 'WANDERING';
      }
      agent.pinnedById = null;
      agent.attackMode = 'none';
      agent.pinTimer = 0;
    }
  }

  private checkVictimCollapseOrDeath(victim: AgentData): void {
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (!v.isAbandoned && Math.hypot(v.x - victim.x, v.z - victim.z) < 7.5) {
        v.isAbandoned = true;
        v.speed = 0;
      }
    }

    if (victim.health <= 0) {
      this.releaseGrapple(victim);
      if (victim.role === 'civilian' && this.rng.chance(0.8)) {
        victim.isIncubating = false;
        victim.civState = 'CONVULSING';
        victim.convulseTimer = 1.6;
        victim.health = 10;
        victim.vx = 0;
        victim.vz = 0;
        this.logAgentAction(victim, `Collapsing and convulsing violently!`);
      } else if (this.rng.chance(0.75)) {
        this.convertToInfected(victim);
      } else {
        victim.isAlive = false;
        this.totalDeceased++;
        this.logAgentAction(victim, `Killed during outbreak attack.`);
      }
    }
  }

  private applySustainedBite(zombie: AgentData, victim: AgentData, customDmg?: number): void {
    this.pushEffect({
      type: 'bite',
      x: victim.x,
      y: victim.climbY,
      z: victim.z,
      age: 0,
      duration: 0.55
    });
    if (this.onSound) this.onSound('bite', victim.x, victim.z);

    const dmg =
      customDmg ??
      (zombie.attackMode === 'tackle_pin' ? this.rng.range(18, 22) : this.rng.range(16, 20));
    victim.health -= dmg;
    victim.biteCount++;

    if (victim.role === 'civilian') {
      if (!victim.isPlayerControlled) {
        victim.civState = 'BEING_ATTACKED';
        victim.stateTimer = 4.0;
      }
      if (!victim.isIncubating && victim.health > 0 && (victim.biteCount >= 2 || victim.health <= 55)) {
        victim.isIncubating = true;
        victim.incubationTimer = this.config.incubationSeconds;
        victim.maxIncubationTime = this.config.incubationSeconds;
        this.logAgentAction(victim, `Mauled and infected by ${zombie.name}!`);
        this.logAgentAction(zombie, `Infected pinned victim ${victim.name}.`);
      }
    }

    this.checkVictimCollapseOrDeath(victim);
  }

  private performZombieAttack(zombie: AgentData, victim: AgentData): void {
    const isBrute = zombie.zombieVariant === 'brute';

    // Mode 4: Alpha Brute Heavy Ground Slam + Knockback
    if (isBrute && !victim.onWallDeck) {
      if (victim.isPlayerControlled && this.fpGraceTimer > 0) {
        zombie.attackCooldown = 0.7;
        return;
      }
      if (victim.isPlayerControlled) {
        this.fpGraceTimer = 1.05;
      }
      zombie.attackMode = 'brute_slam';
      zombie.attackCooldown = 1.45;
      this.pushEffect({ type: 'bite', x: victim.x, z: victim.z, age: 0, duration: 0.65 });
      this.pushEffect({ type: 'door_pound', x: victim.x, y: 0.9, z: victim.z, age: 0, duration: 0.45 });
      if (this.onSound) this.onSound('body_thud', victim.x, victim.z);

      this.releaseGrapple(victim);
      victim.health -= victim.isSwat ? 24 : victim.isPlayerControlled ? 26 : 42;
      victim.biteCount++;
      const dx = victim.x - zombie.x;
      const dz = victim.z - zombie.z;
      const d = Math.hypot(dx, dz) || 1;
      const pushDist = victim.isPlayerControlled ? 2.1 : 2.6;
      const oldX = victim.x, oldZ = victim.z;
      victim.x += (dx / d) * pushDist;
      victim.z += (dz / d) * pushDist;
      resolveWorldCollisions(
        victim,
        0.55,
        this.city,
        this.defenseWalls,
        this.blastGates,
        victim.climbY,
        this.interiorDoors
      );
      this.constrainKtxMove(victim, oldX, oldZ);
      victim.stunnedTimer = Math.max(victim.stunnedTimer, victim.isPlayerControlled ? 0.35 : 1.15);

      if (victim.role === 'civilian') {
        if (!victim.isPlayerControlled) {
          victim.civState = 'BEING_ATTACKED';
          victim.stateTimer = 4.0;
        }
        const canInfect = victim.isPlayerControlled
          ? victim.health <= 28 || victim.biteCount >= 5
          : this.rng.chance(0.65);
        if (!victim.isIncubating && victim.health > 0 && canInfect) {
          victim.isIncubating = true;
          const incub = victim.isPlayerControlled
            ? Math.max(18.0, this.config.incubationSeconds)
            : this.config.incubationSeconds;
          victim.incubationTimer = incub;
          victim.maxIncubationTime = incub;
          this.logAgentAction(victim, `Crushed & infected by ${zombie.name}!`);
        } else {
          this.logAgentAction(victim, `Slammed to the pavement by Alpha Brute!`);
        }
      }
      this.checkVictimCollapseOrDeath(victim);
      return;
    }

    // SWAT ballistic riot shield repel against non-Brute infected
    if (victim.isSwat && !victim.isPlayerControlled) {
      zombie.attackMode = 'claw_swipe';
      zombie.attackCooldown = 1.1;
      this.pushEffect({ type: 'bite', x: victim.x, z: victim.z, age: 0, duration: 0.45 });
      if (this.onSound) this.onSound('bite', victim.x, victim.z);
      victim.health -= 14;
      const dx = zombie.x - victim.x;
      const dz = zombie.z - victim.z;
      const len = Math.hypot(dx, dz) || 1;
      const oldX = zombie.x, oldZ = zombie.z;
      zombie.x += (dx / len) * 1.5;
      zombie.z += (dz / len) * 1.5;
      this.constrainKtxMove(zombie, oldX, oldZ);
      zombie.stunnedTimer = Math.max(zombie.stunnedTimer, 0.65);
      this.logAgentAction(victim, `Repelled zombie lunge with SWAT shield!`);
      this.checkVictimCollapseOrDeath(victim);
      return;
    }

    // First-person player: fair damage, grace frames, 18s incubation only when badly mauled
    if (victim.isPlayerControlled) {
      if (this.fpGraceTimer > 0) {
        zombie.attackCooldown = 0.65;
        return;
      }
      this.fpGraceTimer = 1.05;
      this.pushEffect({ type: 'bite', x: victim.x, y: victim.climbY, z: victim.z, age: 0, duration: 0.55 });
      if (this.onSound) this.onSound('bite', victim.x, victim.z);
      const r = this.rng.next();
      let dmg = 12;
      if (r < 0.45) {
        zombie.attackMode = 'claw_swipe';
        zombie.attackCooldown = 1.05;
      } else if (r < 0.75) {
        zombie.attackMode = 'neck_grapple';
        zombie.attackCooldown = 1.25;
        victim.stunnedTimer = Math.max(victim.stunnedTimer, 0.28);
        dmg = 16;
      } else {
        zombie.attackMode = 'tackle_pin';
        zombie.attackCooldown = 1.35;
        victim.stunnedTimer = Math.max(victim.stunnedTimer, 0.38);
        this.firstPerson.stamina = Math.max(0, this.firstPerson.stamina - 14);
        dmg = 20;
      }
      victim.health -= dmg;
      victim.biteCount++;
      if (!victim.isIncubating && victim.health > 0 && (victim.health <= 28 || victim.biteCount >= 5)) {
        victim.isIncubating = true;
        const fpIncub = Math.max(18.0, this.config.incubationSeconds);
        victim.incubationTimer = fpIncub;
        victim.maxIncubationTime = fpIncub;
        this.logAgentAction(victim, `Severely mauled by ${zombie.name}! Seek an Antiviral Medkit or Paramedic!`);
        this.triggerAlert('⚠ INFECTED (18s): Grab a green Antiviral Kit or find a Medic!', 'danger');
      }
      this.checkVictimCollapseOrDeath(victim);
      return;
    }

    // AI Civilians / Police / Medics: Tackle-Pin Mauling, Neck Grapple, or Claw Swipe
    if (victim.pinnedById === null) {
      const r = this.rng.next();
      const pinThresh = zombie.zombieVariant === 'runner' ? 0.65 : 0.55;
      const grappleThresh = pinThresh + (zombie.zombieVariant === 'runner' ? 0.2 : 0.3);

      if (r < pinThresh) {
        // Mode 1: Tackle-Pin Ground Mauling (3.2-4.8s continuous lock)
        zombie.attackMode = 'tackle_pin';
        victim.attackMode = 'tackle_pin';
        zombie.grappleTargetId = victim.id;
        victim.pinnedById = zombie.id;
        zombie.zombieState = 'FEEDING';
        const dur = this.rng.range(3.2, 4.8);
        zombie.pinTimer = dur;
        victim.pinTimer = dur;
        zombie.attackCooldown = 0.78;
        victim.vx = 0;
        victim.vz = 0;
        if (victim.role === 'civilian') victim.civState = 'BEING_ATTACKED';
        victim.destinationLabel = `Pinned down by ${zombie.name}!`;
        this.logAgentAction(zombie, `Tackled and pinned ${victim.name} to the ground!`);
        this.logAgentAction(victim, `Tackled and pinned by ${zombie.name}!`);
        this.applySustainedBite(zombie, victim, 15);
      } else if (r < grappleThresh) {
        // Mode 2: Upright Neck Grapple Clinch (2.4-3.6s continuous clinch)
        zombie.attackMode = 'neck_grapple';
        victim.attackMode = 'neck_grapple';
        zombie.grappleTargetId = victim.id;
        victim.pinnedById = zombie.id;
        zombie.zombieState = 'FEEDING';
        const dur = this.rng.range(2.4, 3.6);
        zombie.pinTimer = dur;
        victim.pinTimer = dur;
        zombie.attackCooldown = 0.85;
        victim.vx = 0;
        victim.vz = 0;
        if (victim.role === 'civilian') victim.civState = 'BEING_ATTACKED';
        victim.destinationLabel = `Grappled by ${zombie.name}!`;
        this.logAgentAction(zombie, `Grappled ${victim.name} in a neck clinch!`);
        this.logAgentAction(victim, `Grabbed in close quarters by ${zombie.name}!`);
        this.applySustainedBite(zombie, victim, 17);
      } else {
        // Mode 3: Fast Claw Swipe Scratch (35% infect chance, victim flees!)
        zombie.attackMode = 'claw_swipe';
        zombie.attackCooldown = 0.95;
        this.pushEffect({ type: 'bite', x: victim.x, z: victim.z, age: 0, duration: 0.5 });
        if (this.onSound) this.onSound('bite', victim.x, victim.z);
        victim.health -= 17;
        victim.biteCount++;
        if (victim.role === 'civilian') {
          victim.civState = 'BEING_ATTACKED';
          victim.stateTimer = 4.0;
          if (!victim.isIncubating && victim.health > 0 && this.rng.chance(0.35)) {
            victim.isIncubating = true;
            victim.incubationTimer = this.config.incubationSeconds;
            victim.maxIncubationTime = this.config.incubationSeconds;
            this.logAgentAction(victim, `Deeply slashed & infected by ${zombie.name}!`);
          } else {
            this.logAgentAction(victim, `Slashed by ${zombie.name}, scrambling away!`);
          }
          if (victim.health > 0) {
            this.fleeFromThreat(victim, zombie.x, zombie.z);
          }
        } else {
          this.logAgentAction(victim, `Slashed in close quarters by ${zombie.name}!`);
        }
        this.checkVictimCollapseOrDeath(victim);
      }
    } else {
      // Pile-on bite while another zombie pins this victim
      zombie.attackMode = 'claw_swipe';
      zombie.attackCooldown = 1.05;
      this.applySustainedBite(zombie, victim, 14);
    }
  }

  public convertToInfected(agent: AgentData): void {
    this.releaseGrapple(agent);
    const wallPost = this.wallAssignments.get(agent.id);
    const playerWall = agent.isPlayerControlled ? this.fpWallDeck?.wall ?? this.fpLadderTravel?.wall : undefined;
    const wall = wallPost?.wall ?? playerWall;
    const deck = wall && agent.onWallDeck ? wallDeckSpan(wall, this.blastGates, agent.x) : null;
    if (wall && deck) {
      this.wallCrossings.set(agent.id, { wall, deck, progress: 1, startZ: agent.z });
    } else if (wall && agent.climbY > 0) {
      agent.z = ladderZ(wall) + 0.7;
      agent.fallY = agent.climbY;
      agent.fallVy = 0;
      agent.climbY = 0;
      agent.vz = 1;
      agent.onWallDeck = false;
    }
    if (playerWall) {
      this.fpWallDeck = null;
      this.fpLadderTravel = null;
      this.firstPerson.wallLadder = null;
    }
    this.wallAssignments.delete(agent.id);
    this.groundPosts.delete(agent.id);
    this.fallbacks.delete(agent.id);
    this.stationOfficers.delete(agent.id);
    this.stationDefensePosts.delete(agent.id);
    this.civilianGateChoices.delete(agent.id);
    this.stagedCivilians.delete(agent.id);
    const oldRole = agent.role;
    agent.role = 'infected';
    agent.isSwat = false;
    agent.isHunter = false;
    agent.isIncubating = false;
    agent.attackMode = 'none';
    agent.biteCount = 0;
    agent.zombieState = 'WANDERING';
    agent.targetAgentId = null;

    const infCount = this.agents.reduce(
      (acc, x) => acc + (x.isAlive && x.role === 'infected' ? 1 : 0),
      0
    );
    const roll = this.rng.next();
    let variant: ZombieVariant = 'standard';
    if (this.config.fastStrain) {
      if (roll < 0.14) variant = 'brute';
      else if (roll < 0.56) variant = 'runner';
    } else if (infCount >= 15) {
      if (roll < 0.08) variant = 'brute';
      else if (roll < 0.34) variant = 'runner';
    } else if (roll < 0.15) {
      variant = 'runner';
    }

    agent.zombieVariant = variant;
    if (variant === 'brute') {
      agent.health = 320;
      agent.maxHealth = 320;
      agent.baseSpeed = 3.9;
      agent.name = `Alpha Brute (${agent.name})`;
      if (!this.bruteSeen) {
        this.bruteSeen = true;
        this.triggerAlert(
          `ALPHA BRUTE MUTATION spotted in ${this.city.getDistrictAtPos(agent.x, agent.z)}!`,
          'danger'
        );
      }
    } else if (variant === 'runner') {
      agent.health = 85;
      agent.maxHealth = 85;
      agent.baseSpeed = this.rng.range(5.4, 5.9);
      agent.name = `Runner (${agent.name})`;
    } else {
      agent.health = 115;
      agent.maxHealth = 115;
      agent.baseSpeed = this.rng.range(4.15, 4.75);
    }
    if (this.config.fastStrain) {
      agent.baseSpeed *= 1.22;
    }

    agent.destinationLabel = 'Hunting Targets';

    this.effects.push({
      type: 'convert',
      x: agent.x,
      z: agent.z,
      age: 0,
      duration: 0.9
    });

    const district = this.city.getDistrictAtPos(agent.x, agent.z);
    this.logAgentAction(agent, `Transformed into ${variant} infected in ${district}!`);
    this.addEventLog(
      'infection',
      `CONTAGION: ${oldRole === 'police' ? 'Officer ' : ''}${agent.name} turned in ${district}!`,
      agent.x,
      agent.z
    );
  }

  private updatePolice(p: AgentData, dt: number): void {
    if (p.reloadTimer > 0) {
      p.reloadTimer -= dt;
      if (p.reloadTimer <= 0) {
        p.ammo = p.maxAmmo;
      }
    }
    if (p.stunnedTimer <= 0 && (p.pinnedById === null || p.attackMode === 'neck_grapple')) {
      const wall = p.onWallDeck
        ? this.wallAssignments.get(p.id)?.wall ?? this.fallbacks.get(p.id)?.ladder?.wall
        : undefined;
      this.fireOnImmediateThreat(p, wall);
    }
    if (this.handlePinnedOrStunned(p)) return;
    if (this.reactToTrainThreat(p, dt)) return;
    if (this.moveToTrainSeat(p, dt)) return;
    if (p.isHunter) {
      this.updateHunter(p, dt);
      return;
    }

    if (!this.fallbacks.has(p.id) && !this.canReinforceAt(p.z)) this.orderPoliceFallback(p);
    const fallback = this.fallbacks.get(p.id);
    if (fallback) {
      const cover = fallback.cover;
      if (cover && this.simTime < cover.until) {
        if (this.simTime < cover.checkAt || this.civiliansNeedCover(cover.post)) {
          if (this.simTime >= cover.checkAt) cover.checkAt = this.simTime + 0.4;
          this.updateGroundGuard(p, { ...cover.post, z: Math.max(p.z, cover.post.z) }, dt);
          p.destinationLabel = 'Covering civilian evacuation';
          return;
        }
      }
      fallback.cover = undefined;
      this.updateOfficerFallback(p, fallback, dt);
      if (p.onWallDeck && fallback.ladder) this.coverOfficerFallback(p, fallback.ladder.wall);
      else if (!fallback.ladder && this.fallbacks.has(p.id)) this.coverOfficerFallback(p);
      return;
    }
    const wallPost = this.wallAssignments.get(p.id);
    if (wallPost) {
      this.updateWallGuard(p, wallPost, dt);
      return;
    }
    const stationSurface = this.layeredKtx ? ktxSurfaceAt(p.x, p.z, p.climbY)?.id : undefined;
    const stationLane = this.stationOfficers.get(p.id) ??
      (this.ktxPlatformLost && (stationSurface === 'platform' || stationSurface === 'boarding' || stationSurface === 'terrace') ?
        (p.x <= KTX_TRANSFER_X ? 'crew' : 'public') : undefined);
    const stationPost = this.stationDefensePosts.get(p.id);
    if (stationPost && !this.ktxPlatformLost &&
        (stationPost.surface !== 'east-landing' || !this.ktxRetreat.public)) {
      this.updateStationDefensePost(p, stationPost, stationSurface, dt);
      return;
    }
    if (stationLane && this.ktxRetreat[stationLane]) {
      const surface = stationSurface;
      if (surface === 'tower' || surface === 'tower-stair') {
        const goalZ = Math.abs(p.x + 60) > 0.8 && p.z >= 161 ? 163 : 152.6;
        this.steerTowards(p, -60, goalZ, p.baseSpeed, dt);
      } else if (stationLane === 'crew' && p.x < -57 && p.z < 153.15) {
        this.steerTowards(p, -56.5, 152.55, p.baseSpeed, dt);
      } else if (!this.ktxPlatformLost && surface === 'platform' && p.x > KTX_TRANSFER_X + 1) {
        const posts = stationLane === 'crew' ? [-23.4, -20.4, -10.3, -5.2, 0.5] : [8, 13, 18, 23, 27, 35.4, 49];
        this.updateGroundGuard(p, { wall: null, x: posts[p.id % posts.length], z: 189.75 + (p.id % 3) * 0.35 }, dt);
        p.destinationLabel = 'Holding KTX platform';
        return;
      } else if (stationLane === 'crew' && surface === 'platform' && p.x < KTX_TRANSFER_X &&
          !this.ktxGateOpen('transfer') && p.x > KTX_TRANSFER_X - 7) {
        const post = { wall: null, x: KTX_TRANSFER_X - 3.2 - (p.id % 3) * 0.85,
          z: KTX_GATES.transfer.z + (p.id % 3 - 1) * 1.1 };
        this.updateGroundGuard(p, post, dt);
        p.destinationLabel = 'Covering KTX service partition';
        return;
      } else {
        if (surface === 'terrace') {
          this.steerTowards(p, Math.max(11, Math.min(22, p.x)), 191.25, p.baseSpeed, dt);
          p.destinationLabel = 'Falling back from KTX waiting deck';
        } else if (surface === 'west-landing' || surface === 'east-landing') {
          const until = this.ktxLandingHoldUntil[stationLane] ??= this.simTime + 3.5;
          if (this.simTime < until) {
            const x = stationLane === 'crew' ? -53 + (p.id % 4) * 3.2 : 39.2 + (p.id % 4) * 2.4;
            this.updateGroundGuard(p, { wall: null, x, z: 177.2 }, dt);
            p.destinationLabel = 'Covering KTX stair landing';
            return;
          }
          this.moveThroughTerminal(p, dt, stationLane);
        } else {
          this.moveThroughTerminal(p, dt, stationLane);
        }
      }
      p.policeState = 'RETREATING';
      this.coverOfficerFallback(p);
      return;
    }
    const ground = this.groundPosts.get(p.id);
    if (ground) {
      this.updateGroundGuard(p, ground, dt);
      return;
    }

    const gate = this.nearbyThreatenedGate(p.x, p.z);
    const wall = gate && this.defenseWalls.find((line) => line.id === gate.wallId);
    if (gate && wall && p.z > wall.z + wall.thickness / 2 && this.canReinforceAt(wall.z)) {
      const flank = this.groundPostForGate(wall, gate, 2 + p.id % 10);
      p.path = [];
      p.pathIndex = 0;
      p.assignedZonePos = null;
      this.groundPosts.set(p.id, flank);
      this.updateGroundGuard(p, flank, dt);
      return;
    }

    if (this.clearInnerGateApproach(p, dt)) return;

    if (p.perceptionCooldown <= 0) {
      const crowdFactor = this.agents.length > 1400 ? 1.85 : this.agents.length > 800 ? 1.35 : 1.0;
      p.perceptionCooldown = 0.22 * crowdFactor + (p.id % 7) * 0.035;

      const neighbors = this.spatial.queryRadius(p.x, p.z, p.awarenessRadius, this.neighborBuffer);
      let nearestZombie: AgentData | null = null;
      let nearestDistSq = Infinity;
      let closeThreats = 0;

      for (let i = 0; i < neighbors.length; i++) {
        const other = neighbors[i];
        if (!other.isAlive || other.role !== 'infected') continue;
        const dx = other.x - p.x;
        const dz = other.z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < 17.64 && Math.abs(other.climbY - p.climbY) < 2) closeThreats++;

        if (
          dSq < nearestDistSq &&
          this.canOfficerSee(p, other)
        ) {
          nearestDistSq = dSq;
          nearestZombie = other;
        }
      }

      p.perceivedThreats = closeThreats;
      p.targetAgentId = nearestZombie ? nearestZombie.id : null;
    }

    const candidate = this.getAgentById(p.targetAgentId);
    const nearestZombie = candidate?.isAlive && candidate.role === 'infected' && this.canOfficerSee(p, candidate) ? candidate : null;
    const nearestDist = nearestZombie ? Math.hypot(nearestZombie.x - p.x, nearestZombie.z - p.z) : Infinity;

    const retreatThreshold = p.isSwat ? 5 : 3;
    if (
      nearestZombie &&
      nearestDist < p.awarenessRadius + 6 &&
      ((p.perceivedThreats >= retreatThreshold && nearestDist < 4.2) ||
        (p.reloadTimer > 0 && nearestDist < 3.6))
    ) {
      p.policeState = 'RETREATING';
      p.destinationLabel = 'Tactical Fallback';
      const awayX = p.x + (p.x - nearestZombie.x) * 2.5;
      const awayZ = p.z + (p.z - nearestZombie.z) * 2.5;
      this.steerTowards(p, awayX, awayZ, p.baseSpeed * 0.95, dt);
      p.rotationY = Math.atan2(nearestZombie.x - p.x, nearestZombie.z - p.z);

      if (p.attackCooldown <= 0 && p.reloadTimer <= 0 && p.ammo > 0 && nearestDist <= 14.5) {
        this.firePoliceWeapon(p, nearestZombie);
      }
      return;
    }

    if (nearestZombie && nearestDist < p.awarenessRadius + 6) {
      const dx = nearestZombie.x - p.x;
      const dz = nearestZombie.z - p.z;
      p.rotationY = Math.atan2(dx, dz);

      if (nearestDist <= 14.5) {
        p.policeState = 'ENGAGING';
        p.destinationLabel = p.isSwat ? 'SWAT Suppression' : 'Engaging Hostile';
        if (nearestDist < 5.5) {
          this.steerTowards(p, p.x - dx, p.z - dz, p.baseSpeed * 0.75, dt);
        } else {
          p.vx *= 0.4;
          p.vz *= 0.4;
        }

        if (p.attackCooldown <= 0 && p.reloadTimer <= 0 && p.ammo > 0) {
          this.firePoliceWeapon(p, nearestZombie);
        }
      } else {
        p.policeState = 'ENGAGING';
        p.destinationLabel = 'Pursuing Hostile';
        this.pursuePositionSmart(p, nearestZombie.x, nearestZombie.z, p.baseSpeed * 1.05, dt, nearestZombie);
      }
      return;
    }

    p.targetAgentId = null;

    if (p.assignedZonePos) {
      const distZone = Math.hypot(p.x - p.assignedZonePos.x, p.z - p.assignedZonePos.z);
      if (distZone > 5.5) {
        p.policeState = 'RESPONDING';
        p.destinationLabel = 'Moving to Defense Zone';
        if (p.pathIndex < p.path.length && !this.moveAlongPath(p, p.baseSpeed * 1.15, dt)) return;
        this.pursuePositionSmart(p, p.assignedZonePos.x, p.assignedZonePos.z, p.baseSpeed * 1.15, dt);
      } else {
        p.policeState = 'HOLDING_POSITION';
        p.destinationLabel = 'Holding Perimeter';
        p.vx *= 0.5;
        p.vz *= 0.5;
      }
      return;
    }

    const speed = p.policeState === 'RESPONDING' ? p.baseSpeed * 1.2 : p.baseSpeed * 0.85;
    const reached = this.moveAlongPath(p, speed, dt);
    if (reached && p.repathCooldown <= 0) {
      p.policeState = 'PATROLLING';
      this.assignRandomPatrolDestination(p);
      p.repathCooldown = 0.3 + (p.id % 7) * 0.06;
    }
  }

  private updateStationDefensePost(p: AgentData, post: typeof KTX_STATION_POSTS[number], surface: string | undefined, dt: number): void {
    if (surface === post.surface) {
      this.updateGroundGuard(p, { wall: null, x: post.x, z: post.z }, dt);
      p.destinationLabel = post.surface === 'terrace' ? 'Holding KTX waiting deck'
        : post.surface === 'east-landing' ? 'Covering KTX stair landing' : 'Holding KTX platform';
      return;
    }
    if (post.surface === 'terrace' && surface === 'platform') {
      this.steerTowards(p, post.x, Math.abs(p.x - post.x) > 0.7 ? 191 : 187.7, p.baseSpeed, dt);
    } else if (!surface && p.z >= 157 && p.z < 165 && !this.ktxGateOpen('public')) {
      const x = p.id % 2 ? 26.6 + p.id % 3 : 37.3 - p.id % 3;
      this.updateGroundGuard(p, { wall: null, x, z: 162 + (p.id % 4) * 0.6 }, dt);
      return;
    } else {
      this.moveThroughTerminal(p, dt, 'public');
    }
    this.coverOfficerFallback(p);
  }

  private updateHunter(p: AgentData, dt: number): void {
    const boundary = (target: AgentData) => this.defenseWalls.find((wall) => (p.z < wall.z) !== (target.z < wall.z));
    let target = this.getAgentById(p.targetAgentId);
    if (p.perceptionCooldown <= 0 || (target && !target.isAlive)) {
      p.perceptionCooldown = 0.9 + (p.id % 5) * 0.12;
      target = null;
      let best = Infinity;
      for (const infected of this.agents) {
        if (!infected.isAlive || infected.role !== 'infected' || infected.isTrainPassenger || infected.fallY > 0.3 ||
            (infected.onWallDeck && !infected.onTerminalFloor)) continue;
        const wall = boundary(infected);
        const score = Math.hypot(infected.x - p.x, infected.z - p.z) + (wall ? 20 : 0);
        if (score >= best || (wall && !this.blastGates.some((gate) => gate.wallId === wall.id && !this.isGateThreatened(gate)))) continue;
        best = score;
        target = infected;
      }
      p.targetAgentId = target?.id ?? null;
    }
    if (!target) {
      p.policeState = 'PATROLLING';
      if (this.moveAlongPath(p, p.baseSpeed * 0.9, dt) && p.repathCooldown <= 0) {
        this.assignRandomPatrolDestination(p);
        p.repathCooldown = 0.8;
      }
      p.destinationLabel = 'Hunter team searching';
      return;
    }

    p.destinationLabel = 'Hunter team pursuing infected';
    const distance = Math.hypot(target.x - p.x, target.z - p.z);
    const wall = boundary(target);
    if (wall) {
      const gate = this.chooseEvacuationGate(p, wall);
      if (!gate || this.isGateThreatened(gate)) {
        p.vx = p.vz = 0;
        return;
      }
      p.policeState = 'RESPONDING';
      const direction = Math.sign(target.z - p.z);
      const ready = Math.abs(p.x - gate.x) <= 1.4 && Math.abs(p.z - gate.z) <= 5;
      if (ready && !gate.isOpen && !gate.breached) this.toggleBlastGate(gate.id);
      if (ready && this.isGateSafe(gate)) this.steerTowards(p, gate.x, gate.z + direction * 4.2, p.baseSpeed, dt);
      else this.pursuePositionSmart(p, gate.x, gate.z - direction * 3.4, p.baseSpeed, dt);
      return;
    }

    const clearShot = this.canOfficerSee(p, target);
    p.policeState = clearShot && distance <= 17 ? 'ENGAGING' : 'RESPONDING';
    p.vx = p.vz = 0;
    if (clearShot && distance <= 17) {
      if (distance < 5.2) this.steerTowards(p, 2 * p.x - target.x, 2 * p.z - target.z, p.baseSpeed * 0.9, dt);
      p.rotationY = Math.atan2(target.x - p.x, target.z - p.z);
      if (p.attackCooldown <= 0 && p.reloadTimer <= 0 && p.ammo > 0) this.firePoliceWeapon(p, target);
    } else if (this.layeredKtx && target.z >= 167 && target.climbY > p.climbY + 1.4 &&
        this.moveThroughTerminal(p, dt, p.x < -10 ? 'crew' : 'public')) {
      return;
    } else {
      this.pursuePositionSmart(p, target.x, target.z, p.baseSpeed, dt, target);
    }
  }

  private canReinforceAt(z: number): boolean {
    return z > this.policeFrontZ + 0.5 && !this.defenseWalls.some((wall) => wall.breachedNotified && z <= wall.z + 0.5);
  }

  private policeDeploymentPoint(x: number, z: number): Vec2 {
    if (!this.layeredKtx || z <= KTX_LAST_LINE_Z + 0.5) return this.city.findNearestNode(x, z);
    const point = { x, z: Math.min(z, 154.8) };
    resolveWorldCollisions(point, 0.76, this.city, this.defenseWalls, this.blastGates, 0, this.interiorDoors);
    return point;
  }

  private nearbyThreatenedGate(x: number, z: number): BlastGateData | undefined {
    return this.blastGates.find((gate) => this.isGateThreatened(gate) &&
      Math.abs(x - gate.x) < gate.width / 2 + 7 && Math.abs(z - gate.z) <= 17);
  }

  private groundPostForGate(wall: DefenseWallData, gate: BlastGateData, slot: number): { wall: DefenseWallData; x: number; z: number } {
    const sign = slot % 2 ? 1 : -1;
    const pos = {
      x: gate.x + sign * (gate.width / 2 + 2.6 + Math.floor(slot / 2) * 1.25),
      z: Math.min(wall.z + 7.4 + Math.floor(slot / 4) * 1.5, this.layeredKtx ? 154.3 : this.city.cityHalfZ - 2)
    };
    resolveWorldCollisions(pos, 0.68, this.city, this.defenseWalls, this.blastGates, 0, this.interiorDoors);
    return { wall, ...pos };
  }

  private updatePoliceFront(): void {
    const line = this.defenseWalls.reduce<DefenseWallData | null>((front, wall) =>
      wall.breachedNotified && wall.z > this.policeFrontZ && (!front || wall.z > front.z) ? wall : front, null);
    if (!line) return;
    this.policeFrontZ = line.z;
    const next = this.defenseWalls.find((wall) => wall.z > this.policeFrontZ);
    for (const officer of this.agents) {
      if (!officer.isAlive || officer.isEvacuated || officer.role !== 'police' ||
          officer.isPlayerControlled || officer.isHunter) continue;
      const assignment = this.wallAssignments.get(officer.id)?.wall ?? this.groundPosts.get(officer.id)?.wall;
      if (!this.canReinforceAt(officer.z) || (assignment && assignment.z <= line.z) || this.fallbacks.has(officer.id)) {
        const post = this.groundPosts.get(officer.id);
        this.orderPoliceFallback(officer);
        const retreat = this.fallbacks.get(officer.id);
        if (retreat && post?.wall === line && officer.climbY < 0.5 &&
            officer.z > line.z + line.thickness / 2 && Math.hypot(officer.x - post.x, officer.z - post.z) <= 12 &&
            this.civiliansNeedCover({ wall: line, x: officer.x, z: officer.z })) {
          retreat.cover = { post: { wall: line, x: officer.x, z: officer.z },
            until: this.simTime + 8 + (officer.id % 4) * 0.7, checkAt: this.simTime + 0.4 };
        }
      }
    }
    this.commanderOrder = this.fallbackLabel(next);
    this.transmitRadio({ kind: 'fallback', line: line.layerIndex, order: this.commanderOrder });
    const notice = `Line ${line.layerIndex} breached · ${this.commanderOrder}`;
    this.triggerAlert(this.withEvacuationTotal(notice), 'warn');
    this.addEventLog('police', this.withEvacuationTotal(notice), 0, line.z);
  }

  private civiliansNeedCover(post: { wall: DefenseWallData; x: number; z: number }): boolean {
    return this.spatial.queryRadius(post.x, post.z, 31, this.neighborBuffer).some((a) =>
      a.role === 'civilian' && a.isAlive && !a.isEvacuated && !a.isTrainPassenger &&
      a.civState !== 'SHELTERED' && a.z <= post.wall.z + 6);
  }

  private fallbackLabel(wall?: DefenseWallData | null): string {
    if (wall) return `Falling back to Line ${wall.layerIndex}`;
    return this.layeredKtx ? 'Falling back to the KTX forecourt' : 'Falling back to the inner city';
  }

  private orderPoliceFallback(p: AgentData): void {
    const prior = this.wallAssignments.get(p.id);
    const retreat = this.fallbacks.get(p.id);
    const wall = this.defenseWalls.find((candidate) => candidate.z > this.policeFrontZ && !candidate.breachedNotified);
    const gate = wall ? this.blastGates.filter((g) => g.wallId === wall.id &&
      (!this.layeredKtx || wall.z !== KTX_LAST_LINE_Z || p.z < KTX_LAST_LINE_Z + 0.5 ||
        (g.x < 0) === (p.x < -10)))
      .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0] : null;
    let nextWallPost: WallGuardPost | undefined;
    if (wall && (prior || retreat?.nextWallPost)) {
      const posts = this.blastGates.filter((g) => g.wallId === wall.id)
        .flatMap((gate) => [wallPostX(gate.x), wallPostX(gate.x, true)])
        .sort((a, b) => Math.abs(a - p.x) - Math.abs(b - p.x));
      for (const x of posts) {
        const [slot] = this.getVacantWallSlots(wall, x);
        if (slot === undefined) continue;
        nextWallPost = this.makeWallGuardPost(wall, x, slot);
        break;
      }
    }
    const post = nextWallPost
      ? { wall: nextWallPost.wall, x: nextWallPost.ladderX, z: ladderZ(nextWallPost.wall) + 1.15 }
      : wall && gate
      ? this.groundPostForGate(wall, gate, 2 + p.id % 6)
      : this.layeredKtx ? this.ktxFallbackPost(p) :
        { wall: null, x: (p.id % 15 - 7) * 1.45, z: Math.min(this.city.cityHalfZ - 4, this.policeFrontZ + 11) };
    const ladder = prior && p.climbY > 0
      ? { x: p.onWallDeck ? this.chooseWallRetreatLadder(p, prior.wall, prior.ladderX) : prior.ladderX,
        wall: prior.wall, checkAt: this.simTime + 0.65 }
      : retreat?.ladder;
    this.wallAssignments.delete(p.id);
    this.groundPosts.delete(p.id);
    this.fallbacks.set(p.id, { post, gate: gate ?? null, passingGate: retreat?.passingGate, ladder, nextWallPost });
    p.assignedZonePos = null;
    p.targetAgentId = null;
    p.path = [];
    p.pathIndex = 0;
    p.repathCooldown = 0;
    p.perceptionCooldown = 0;
    p.policeState = 'RETREATING';
  }

  private ktxFallbackPost(p: AgentData): { wall: null; x: number; z: number } {
    if (p.z >= 155) return { wall: null, x: p.x, z: p.z };
    const flank = p.x < -10 ? [-55, -51, -47, -37, -33, -29, -25] : [9, 13, 17, 21, 37, 41, 45, 49, 53];
    const slot = p.id % (flank.length * 2);
    return { wall: null, x: flank[slot % flank.length], z: slot < flank.length ? 152.2 : 154.1 };
  }

  private chooseWallRetreatLadder(p: AgentData, wall: DefenseWallData, fallbackX: number): number {
    const span = wallDeckSpan(wall, this.blastGates, p.x);
    if (!span) return fallbackX;
    const landingZ = ladderZ(wall) + 0.7;
    let choice = fallbackX;
    let best = Infinity;
    for (const x of wall.retreatLadderXs) {
      if (x < span.minX || x > span.maxX || this.city.isPointInOpenWater(x, landingZ, 0.6)) continue;
      const landing = { x, z: landingZ };
      resolveWorldCollisions(landing, 0.58, this.city, this.defenseWalls, this.blastGates, 0, this.interiorDoors);
      if (Math.hypot(landing.x - x, landing.z - landingZ) > 0.25) continue;
      let score = Math.abs(p.x - x);
      for (const infected of this.spatial.queryRadius(x, landingZ + 2.1, 16, this.neighborBuffer)) {
        if (!infected.isAlive || infected.role !== 'infected' || infected.climbY + infected.fallY > 2.1 ||
            infected.z < wall.z) continue;
        const distance = Math.hypot(infected.x - x, infected.z - landingZ);
        score += Math.max(0, 15 - distance) * 2.4;
      }
      for (const [id, other] of this.fallbacks) {
        if (id !== p.id && other.ladder?.wall === wall && other.ladder.x === x && this.getAgentById(id)?.isAlive) {
          score += 2.5;
        }
      }
      if (score >= best) continue;
      best = score;
      choice = x;
    }
    return choice;
  }

  private updateOfficerFallback(
    p: AgentData,
    retreat: OfficerFallback,
    dt: number
  ): void {
    let { post } = retreat;
    p.policeState = 'RETREATING';
    if (retreat.ladder && p.climbY > 0) {
      const ladder = retreat.ladder;
      const { wall } = ladder;
      const z = ladderZ(wall);
      p.policeState = 'CLIMBING';
      p.destinationLabel = this.fallbackLabel(post.wall);
      p.vx = 0;
      p.vz = 0;
      if (p.onWallDeck && Math.abs(p.x - ladder.x) <= 1.2 && this.simTime >= ladder.checkAt) {
        ladder.x = this.chooseWallRetreatLadder(p, wall, ladder.x);
        ladder.checkAt = this.simTime + 0.65;
      }
      const x = ladder.x;
      if (p.onWallDeck && Math.abs(p.x - x) > 0.24) {
        const step = Math.min(Math.abs(p.x - x), p.baseSpeed * dt);
        const direction = Math.sign(x - p.x);
        p.x += direction * step;
        p.vx = direction * step / dt;
        p.rotationY = direction * Math.PI / 2;
        p.animPhase += step * 3.2;
        return;
      }
      p.x = x;
      p.z = Math.min(z, p.z + dt * 2.8);
      if (p.z >= z - 0.02) {
        p.onWallDeck = false;
        p.climbY = Math.max(0, p.climbY - dt * 2.65);
        if (p.climbY === 0) p.z = z + 0.7;
      }
      return;
    }
    retreat.ladder = undefined;
    let goal: Vec2 = post;
    if (retreat.passingGate && p.z >= retreat.passingGate.z + 2.5) {
      const crossed = retreat.passingGate;
      retreat.passingGate = undefined;
      if (!post.wall && this.layeredKtx) post = retreat.post = this.ktxFallbackPost(p);
      else if (!retreat.nextWallPost && post.wall?.id === crossed.wallId && this.layeredKtx && crossed.z === KTX_LAST_LINE_Z) {
        post = retreat.post = this.groundPostForGate(post.wall, crossed, 2 + p.id % 6);
      }
      p.path = [];
      p.pathIndex = 0;
      p.repathCooldown = 0;
    }
    const crossing = this.defenseWalls.find((wall) => p.z < wall.z - 0.5 && wall.z < post.z);
    const preferred = retreat.gate?.wallId === crossing?.id ? retreat.gate ?? undefined : undefined;
    const gate = retreat.passingGate ?? (crossing && this.chooseEvacuationGate(p, crossing, preferred));
    if (gate && !retreat.passingGate && this.isGateThreatened(gate)) {
      this.moveToGateGoal(p, this.gateWaitingPoint(p, gate), `Waiting away from ${gate.label}`, p.baseSpeed * 1.05, dt);
      return;
    }
    const destination = gate ? `Crossing ${gate.label}` : this.fallbackLabel(post.wall);
    if (p.destinationLabel !== destination) {
      p.destinationLabel = destination;
      p.path = [];
      p.pathIndex = 0;
      p.repathCooldown = 0;
    }
    if (gate) {
      goal = { x: gate.x, z: gate.z - 4 };
      if (retreat.passingGate || Math.hypot(p.x - goal.x, p.z - goal.z) < 4.5) {
        if (!gate.isOpen && !gate.breached) this.toggleBlastGate(gate.id);
        if (gateClearHalfWidth(gate) > 0.78) {
          retreat.passingGate = gate;
          this.steerTowards(p, gate.x, gate.z + 4.3, p.baseSpeed * 1.18, dt);
          return;
        }
      }
    }
    if (Math.hypot(p.x - goal.x, p.z - goal.z) <= 1.0) {
      p.vx = 0;
      p.vz = 0;
      if (goal === post) {
        this.fallbacks.delete(p.id);
        if (retreat.nextWallPost) {
          const { wall, x, slot } = retreat.nextWallPost;
          this.assignWallPost(p, wall, x, slot);
          return;
        }
        this.groundPosts.set(p.id, post);
        if (!post.wall && this.layeredKtx) {
          const lane = post.x < -10 ? 'crew' : 'public';
          this.stationOfficers.set(p.id, lane);
          if (lane === 'public' && !this.ktxPlatformLost) {
            const reserved = new Set([...this.stationDefensePosts].flatMap(([id, position]) =>
              this.getAgentById(id)?.isAlive ? [position] : []));
            const stationPost = KTX_STATION_POSTS.find((position) => !reserved.has(position) &&
              (position.surface !== 'east-landing' || !this.ktxRetreat.public));
            if (stationPost) this.stationDefensePosts.set(p.id, stationPost);
          }
        }
      }
      return;
    }
    if (this.layeredKtx && !gate && p.z >= KTX_LAST_LINE_Z + 0.5 && (!post.wall || post.wall.z === KTX_LAST_LINE_Z)) {
      this.steerAroundStationGround(p, goal, p.baseSpeed * 1.18, dt);
      return;
    }
    if (p.repathCooldown <= 0 && (p.pathIndex >= p.path.length || p.stuckTimer > 0.65)) {
      const path = this.requestPath(p.x, p.z, goal.x, goal.z, false);
      if (path?.length) {
        p.path = path;
        p.pathIndex = 0;
        p.repathCooldown = 1.6 + (p.id % 7) * 0.085;
      } else {
        p.repathCooldown = 0.45 + (p.id % 5) * 0.08;
      }
    }
    if (p.pathIndex < p.path.length) this.moveAlongPath(p, p.baseSpeed * 1.18, dt);
    else this.steerTowards(p, goal.x, goal.z, p.baseSpeed * 1.18, dt);
  }

  private coverOfficerFallback(officer: AgentData, wall?: DefenseWallData): void {
    const range = 17;
    const canTarget = (target: AgentData | null | undefined): target is AgentData =>
      !!target?.isAlive && target.role === 'infected' &&
      Math.abs(target.climbY + target.fallY - officer.climbY) < 1.6 &&
      Math.hypot(target.x - officer.x, target.z - officer.z) <= range;
    const canSee = (target: AgentData) => this.canOfficerSee(officer, target, wall);

    let target = this.getAgentById(officer.targetAgentId);
    if (officer.perceptionCooldown <= 0) {
      officer.perceptionCooldown = 0.25 + (officer.id % 5) * 0.03;
      target = null;
      let best = Infinity;
      for (const infected of this.spatial.queryRadius(officer.x, officer.z, range, this.neighborBuffer)) {
        if (!canTarget(infected)) continue;
        const dx = infected.x - officer.x;
        const dz = infected.z - officer.z;
        const ahead = dx * officer.vx + dz * officer.vz > 0;
        const score = Math.hypot(dx, dz) + (ahead ? 3 : 0);
        if (score >= best || !canSee(infected)) continue;
        best = score;
        target = infected;
      }
    }
    if (!canTarget(target)) {
      officer.targetAgentId = null;
      return;
    }
    officer.targetAgentId = target.id;
    officer.rotationY = Math.atan2(target.x - officer.x, target.z - officer.z);
    if (officer.attackCooldown <= 0 && officer.reloadTimer <= 0 && officer.ammo > 0 && canSee(target)) {
      this.firePoliceWeapon(officer, target);
    }
  }

  private updateGroundGuard(p: AgentData, post: { wall: DefenseWallData | null; x: number; z: number }, dt: number): void {
    const disengaging = p.policeState === 'RETREATING';
    p.policeState = 'HOLDING_POSITION';
    p.destinationLabel = post.wall ? `Holding Line ${post.wall.layerIndex} ground post` : 'Holding KTX forecourt';
    p.vx = 0;
    p.vz = 0;
    p.wallAimPitch = 0;
    const deck = this.layeredKtx && p.climbY > 2.8 && !this.getTrainCarForAgent(p)
      ? ktxSurfaceAt(p.x, p.z, p.climbY) : undefined;
    const elevatedPost = deck && deck.fromY === deck.toY ? deck : undefined;
    if (p.perceptionCooldown <= 0) {
      p.perceptionCooldown = 0.34 + (p.id % 5) * 0.03;
      p.targetAgentId = null;
      this.stationFiringPositions.delete(p);
      let nearest = Infinity;
      for (const infected of this.spatial.queryRadius(p.x, p.z, 17, this.neighborBuffer)) {
        if (!infected.isAlive || infected.role !== 'infected') continue;
        const height = p.climbY - infected.climbY - infected.fallY;
        const lower = height > 1.9;
        if (height < -1.9 || (lower && !elevatedPost)) continue;
        const distance = Math.hypot(infected.x - p.x, infected.z - p.z, height);
        const score = distance + (lower ? 3.5 : 0);
        if (distance >= 17 || score >= nearest) continue;
        const clear = elevatedPost ? this.guardHasShot(p, p.climbY, infected) : this.canOfficerSee(p, infected);
        const spot = !clear && lower && elevatedPost ? this.stationFiringPosition(p, post, elevatedPost, infected) : undefined;
        if (!clear && !spot) continue;
        if (spot) this.stationFiringPositions.set(p, spot);
        else this.stationFiringPositions.delete(p);
        nearest = score;
        p.targetAgentId = infected.id;
      }
    }
    const candidate = this.getAgentById(p.targetAgentId);
    const target = candidate?.isAlive && candidate.role === 'infected' ? candidate : null;
    const distance = target ? Math.hypot(p.x - target.x, p.z - target.z) : Infinity;
    const lower = !!target && !!elevatedPost && p.climbY - target.climbY - target.fallY > 1.9;
    const firingPosition = lower ? this.stationFiringPositions.get(p) : undefined;
    if (lower) {
      p.policeState = 'ENGAGING';
      if (firingPosition && Math.hypot(p.x - firingPosition.x, p.z - firingPosition.z) > 0.1) {
        this.steerTowards(p, firingPosition.x, firingPosition.z, p.baseSpeed * 0.75, dt);
      }
    } else if (target && distance < (disengaging ? 9 : 7)) {
      p.policeState = 'RETREATING';
      p.destinationLabel = 'Tactical Fallback';
      const awayX = p.x + (p.x - target.x) * 2;
      const awayZ = Math.max(post.wall ? post.wall.z + 3.5 : -Infinity, p.z + (p.z - target.z) * 2);
      this.steerTowards(p, awayX, awayZ, p.baseSpeed, dt);
    } else {
      if (target) p.policeState = 'ENGAGING';
      if (Math.hypot(post.x - p.x, post.z - p.z) > 2.25) {
        if (p.climbY < 0.1 && (!this.layeredKtx || !ktxContains(p.x, p.z))) {
          this.pursuePositionSmart(p, post.x, post.z, p.baseSpeed * 0.9, dt);
        } else {
          this.steerAroundStationGround(p, post, p.baseSpeed * 0.9, dt);
        }
      }
    }
    if (target) {
      p.rotationY = Math.atan2(target.x - p.x, target.z - p.z);
      if (elevatedPost) this.aimGuardAtHeight(p, target);
      if (p.attackCooldown <= 0 && p.reloadTimer <= 0 && p.ammo > 0 && distance < 17 &&
          (elevatedPost ? this.guardHasShot(p, p.climbY, target) : this.canOfficerSee(p, target))) {
        this.firePoliceWeapon(p, target);
      }
    }
  }

  private stationFiringPosition(guard: AgentData, post: Vec2, deck: KtxSurface, target: AgentData): Vec2 | undefined {
    const margin = 0.12;
    const left = deck.minX + margin, right = deck.maxX - margin;
    const front = deck.minZ + margin, rear = deck.maxZ - margin;
    const x = Math.max(left, Math.min(right, target.x));
    const z = Math.max(front, Math.min(rear, target.z));
    const spots = [{ x, z: front }, { x, z: rear }, { x: left, z }, { x: right, z }];
    return spots.sort((a, b) => Math.hypot(a.x - guard.x, a.z - guard.z) - Math.hypot(b.x - guard.x, b.z - guard.z))
      .find((spot) => Math.hypot(spot.x - post.x, spot.z - post.z) <= 9 &&
        !KTX_BOXES.some((box) => Math.abs((box.y ?? 0) - guard.climbY) < 0.3 &&
          Math.abs(spot.x - box.x) < box.width / 2 + 0.5 && Math.abs(spot.z - box.z) < box.depth / 2 + 0.5) &&
        this.guardHasShot(spot, guard.climbY, target));
  }

  private assignWallPost(p: AgentData, wall: DefenseWallData, x: number, slot: number): void {
    this.groundPosts.delete(p.id);
    this.wallAssignments.set(p.id, this.makeWallGuardPost(wall, x, slot));
    p.targetAgentId = null;
    p.onWallDeck = false;
    p.assignedZonePos = null;
    p.path = [];
    p.pathIndex = 0;
    p.repathCooldown = 0;
    p.policeState = 'RESPONDING';
    p.destinationLabel = `Moving to Line ${wall.layerIndex} ladder`;
  }

  private makeWallGuardPost(wall: DefenseWallData, x: number, slot: number): WallGuardPost {
    const gates = this.blastGates.filter((gate) => gate.wallId === wall.id).sort((a, b) => a.x - b.x);
    const outer = gates.find((gate) => wallPostX(gate.x, true) === x);
    if (outer) {
      const direction = Math.sign(x - outer.x);
      const rank = Math.floor(slot / WALL_OUTER_POST_SLOTS);
      const baseOffset = slot === 0 ? 0.18 : slot % WALL_OUTER_POST_SLOTS === 0 ? 3.3 : 11.8;
      const desired = outer.x + direction * (outer.width / 2 + baseOffset + [0, -1.65, 1.65][rank]);
      const deckX = Math.max(wall.minX + 0.55, Math.min(wall.maxX - 0.55, desired));
      return { wall, x, slot, deckX, ladderX: wallGuardX(x, slot % WALL_OUTER_POST_SLOTS, WALL_OUTER_POST_SLOTS) };
    }
    const ladderX = wallGuardX(x, slot % WALL_POST_SLOTS);
    if (gates.length < 2) return { wall, x, slot, deckX: ladderX, ladderX };
    const left = gates[0];
    const right = gates[gates.length - 1];
    const center = (left.x + right.x) / 2;
    const west = x < center;
    const gateEdge = west ? left.x + left.width / 2 : right.x - right.width / 2;
    const edge = gateEdge + (west ? 0.9 : -0.9);
    const rank = Math.floor(slot / INITIAL_WALL_GUARDS_PER_GATE);
    const index = (slot % INITIAL_WALL_GUARDS_PER_GATE) * 3 + [1, 0, 2][rank];
    const deckX = slot === 0 ? gateEdge + (west ? 0.18 : -0.18)
      : edge + (center - edge) * (index + 0.5) / WALL_GARRISON_SLOTS_PER_GATE;
    return { wall, x, slot, deckX, ladderX };
  }

  private advanceSiegeFront(z: AgentData, dt: number): boolean {
    if (this.defenseWalls.length === 0) return false;
    const wall = this.defenseWalls.find((candidate) => z.z < candidate.z + candidate.thickness / 2 + 0.65);
    if (!wall) {
      const station = this.city.stationPos;
      if (Math.hypot(station.x - z.x, station.z - z.z) < 16) return false;
      z.zombieState = 'PURSUING';
      z.destinationLabel = 'Advancing on the KTX terminal';
      this.pursuePositionSmart(z, station.x, station.z - 7, z.baseSpeed, dt);
      return true;
    }
    let gate: BlastGateData | null = null;
    let nearest = Infinity;
    for (const candidate of this.blastGates) {
      if (candidate.wallId !== wall.id) continue;
      const distance = Math.abs(z.x - candidate.x);
      if (distance < nearest) {
        nearest = distance;
        gate = candidate;
      }
    }
    if (!gate) return false;
    const gap = gateClearHalfWidth(gate);
    const flank = z.id % 5 >= 2;
    const half = wall.thickness / 2;
    let x = gate.x;
    let targetZ = wall.z + half + 1.6;
    if (gap >= 0.85) {
      x += ((z.id % 7) - 3) / 3 * Math.min(2.2, gap - 0.65);
      z.zombieState = 'PURSUING';
      z.destinationLabel = `Surging through ${gate.label}`;
    } else {
      x = flank ? wallPostX(gate.x) : gate.x + ((z.id % 9) - 4) * 0.72;
      targetZ = flank ? wall.z - 4 : wall.z - half - 0.72;
      z.zombieState = 'BREACHING';
      z.destinationLabel = flank ? `Climbing ${wall.label}` : `Pounding ${gate.label}`;
      if (Math.hypot(z.x - x, z.z - targetZ) < 0.48) {
        z.vx = 0;
        z.vz = 0;
        z.rotationY = 0;
        return true;
      }
    }
    this.pursuePositionSmart(z, x, targetZ, Math.min(z.baseSpeed, 5.6), dt);
    return true;
  }

  private approachWallPile(z: AgentData, dt: number): boolean {
    // Keep some infected at the doors so the horde attacks the gate and the wall face.
    if (z.id % 4 === 0) return false;
    let x = 0;
    let approachZ = 0;
    let closest = 22;
    for (const gate of this.blastGates) {
      const northDistance = gate.z - z.z;
      if (gate.isOpen || gate.breached || northDistance < 1.5 || northDistance > 20) continue;
      const targetX = wallPostX(gate.x);
      const targetZ = gate.z - 4;
      const distance = Math.hypot(targetX - z.x, targetZ - z.z);
      if (distance < closest &&
          hasLineOfSight(z.x, z.z, targetX, targetZ, this.city, this.defenseWalls, this.blastGates, this.interiorDoors)) {
        closest = distance;
        x = targetX;
        approachZ = targetZ;
      }
    }
    if (closest === 22) return false;
    z.zombieState = 'BREACHING';
    z.destinationLabel = 'Joining the wall assault';
    this.steerTowards(z, x, approachZ, Math.min(z.baseSpeed, 4.5), dt);
    return true;
  }

  private updateWallGuard(
    p: AgentData,
    post: WallGuardPost,
    dt: number
  ): void {
    const { wall } = post;
    const x = post.ladderX;
    const z = ladderZ(wall);
    const deckY = wall.height + WALL_DECK_RISE;
    const deckZ = wall.z + 0.35;
    if (p.climbY === 0 && Math.hypot(p.x - x, p.z - z) > 0.26) {
      if (hasLineOfSight(p.x, p.z, x, z, this.city, this.defenseWalls, this.blastGates, this.interiorDoors)) {
        this.steerTowards(p, x, z, p.baseSpeed, dt);
      } else {
        if (p.repathCooldown <= 0) {
          p.path = this.requestPath(p.x, p.z, x, z + 1, false) ?? [];
          p.pathIndex = 0;
          p.repathCooldown = 2;
        }
        this.moveAlongPath(p, p.baseSpeed, dt);
      }
      return;
    }

    if (!p.onWallDeck && (p.climbY < deckY || p.z > deckZ)) {
      p.policeState = 'CLIMBING';
      p.destinationLabel = `Climbing to Line ${wall.layerIndex}`;
      p.x = x;
      p.vx = 0;
      p.vz = 0;
      p.rotationY = Math.PI;
      if (p.climbY < deckY) {
        p.z = z;
        p.climbY = Math.min(deckY, p.climbY + 2.2 * dt);
      } else {
        p.z = Math.max(deckZ, p.z - 2.2 * dt);
      }
      return;
    }

    p.onWallDeck = true;
    p.policeState = 'HOLDING_POSITION';
    p.destinationLabel = `Holding Line ${wall.layerIndex} wall`;
    p.wallAimPitch = 0;
    p.vx = 0;
    p.vz = 0;
    const guardZ = wallDeckFrontZ(wall);
    const gate = this.blastGates.find((candidate) => candidate.wallId === wall.id && !candidate.breached &&
      (wallPostX(candidate.x) === post.x || wallPostX(candidate.x, true) === post.x) &&
      Math.abs(post.deckX - candidate.x) < 17);
    const attackingGate = (infected: AgentData) => !!gate && gate.openFraction <= 0.22 &&
      infected.climbY + infected.fallY < 0.65 && infected.z < gate.z - 0.45 && infected.z >= gate.z - 4.1 &&
      Math.abs(infected.x - gate.x) <= gate.width / 2 + 1.5;
    if (p.perceptionCooldown <= 0) {
      p.perceptionCooldown = 0.27 + (p.id % 5) * 0.035;
      p.targetAgentId = null;
      let closest = 20;
      for (const infected of this.spatial.queryRadius(p.x, p.z, closest, this.neighborBuffer)) {
        if (!infected.isAlive || infected.role !== 'infected') continue;
        const height = p.climbY - infected.climbY - infected.fallY;
        const distance = Math.hypot(p.x - infected.x, p.z - infected.z, height);
        if (distance > 20) continue;
        const gateTarget = attackingGate(infected);
        const score = distance - (infected.onWallDeck ? 14 : gateTarget ? 6 : 0);
        if (score >= closest || !this.canWallGuardSee(p, infected, wall)) continue;
        closest = score;
        p.targetAgentId = infected.id;
      }
    }

    const target = this.getAgentById(p.targetAgentId);
    const dx = post.deckX - p.x;
    const dz = guardZ - p.z;
    const distanceToPost = Math.hypot(dx, dz);
    if (distanceToPost > 0.001) {
      const step = Math.min(distanceToPost, p.baseSpeed * dt);
      p.vx = dx * step / (distanceToPost * dt);
      p.vz = dz * step / (distanceToPost * dt);
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.rotationY = Math.atan2(dx, dz);
      p.animPhase += step * 3.2;
    }
    if (!target?.isAlive || target.role !== 'infected') {
      if (distanceToPost <= 0.001) p.rotationY = Math.PI;
      return;
    }
    p.rotationY = Math.atan2(target.x - p.x, target.z - p.z);
    const flatRange = Math.hypot(p.x - target.x, p.z - target.z);
    const height = p.climbY - target.climbY - target.fallY;
    const distance = Math.hypot(flatRange, height);
    this.aimGuardAtHeight(p, target);
    if (p.attackCooldown <= 0 && p.reloadTimer <= 0 && p.ammo > 0 && distance <= 20 &&
        this.canWallGuardSee(p, target, wall)) {
      p.policeState = 'ENGAGING';
      this.firePoliceWeapon(p, target);
    }
  }

  private canWallGuardSee(guard: AgentData, target: AgentData, wall: DefenseWallData): boolean {
    return guard.climbY >= wall.height - 0.6 && this.guardHasShot(guard, guard.climbY, target);
  }

  private aimGuardAtHeight(officer: AgentData, target: AgentData): void {
    const height = officer.climbY + GUARD_MUZZLE_HEIGHT - target.climbY - target.fallY - GUARD_TARGET_HEIGHT;
    officer.wallAimPitch = Math.max(-0.55, Math.min(1.43, Math.atan2(height, Math.hypot(target.x - officer.x, target.z - officer.z))));
  }

  private guardHasShot(from: Vec2, height: number, target: AgentData): boolean {
    const muzzleY = height + GUARD_MUZZLE_HEIGHT;
    const dx = target.x - from.x, dz = target.z - from.z;
    const dy = target.climbY + target.fallY + GUARD_TARGET_HEIGHT - muzzleY;
    const distance = Math.hypot(dx, dy, dz);
    const trace = new ShotTrace(from.x, muzzleY, from.z, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)), distance);
    trace.traceCity(this.city, this.defenseWalls, this.blastGates, this.interiorDoors, this.vehicles);
    this.traceRailAndStationCover(trace);
    return trace.distance >= distance - 0.025;
  }

  private traceRailAndStationCover(trace: ShotTrace): void {
    const trainDeck = this.layeredKtx ? KTX_PLATFORM_Y : 0;
    const startZ = trace.ray.origin.z;
    const endZ = startZ + trace.ray.direction.z * trace.distance;
    const minZ = Math.min(startZ, endZ), maxZ = Math.max(startZ, endZ);
    if (this.expressTrain.z + 2.2 >= minZ && this.expressTrain.z - 2.2 <= maxZ) {
      this.visitTrainCover((minX, maxX, z1, z2, height) =>
        trace.testBox(minX, maxX, trainDeck + 0.2, trainDeck + height, z1, z2, 'metal'));
    }
    if (!this.layeredKtx || maxZ < KTX_LAST_LINE_Z || minZ >= 207) return;
    for (const floor of KTX_SHOT_FLOORS) {
      if (floor.minZ > maxZ || floor.maxZ < minZ) continue;
      trace.testBox(floor.minX, floor.maxX, floor.minY, floor.maxY, floor.minZ, floor.maxZ, 'dust');
    }
    if (maxZ >= 193.1 && minZ <= 206.9) {
      const tr = this.expressTrain;
      const span = this.city.cityHalfX + 20;
      const east = span + KTX_RAIL_EXTENSION + tr.layout.carPitch * tr.layout.carCount;
      trace.testBox(-span, east, KTX_PLATFORM_Y - 1.34, KTX_PLATFORM_Y - 0.48, 193.1, 206.9, 'dust');
    }
    for (const box of KTX_BOXES) {
      if (box.z - box.depth / 2 > maxZ || box.z + box.depth / 2 < minZ) continue;
      const y = box.y ?? 0;
      trace.testBox(box.x - box.width / 2, box.x + box.width / 2, y, y + box.height,
        box.z - box.depth / 2, box.z + box.depth / 2, 'dust');
    }
    for (const id of KTX_GATE_IDS) {
      if (this.ktxGateOpen(id)) continue;
      const box = ktxGateBox(id);
      trace.testBox(box.x - box.width / 2, box.x + box.width / 2, box.y, box.y + box.height,
        box.z - box.depth / 2, box.z + box.depth / 2, 'metal');
    }
  }

  private canOfficerSee(officer: AgentData, target: AgentData, wall?: DefenseWallData): boolean {
    if (wall) return this.canWallGuardSee(officer, target, wall);
    if (this.ridingKtx(officer) !== this.ridingKtx(target) ||
        Math.abs(officer.climbY - target.climbY - target.fallY) > 2.1 ||
        this.ktxBlocksSight(officer, target)) return false;
    if (this.getTrainCarForAgent(officer) || this.getTrainCarForAgent(target)) {
      let blocked = false;
      this.visitTrainCover((minX, maxX, minZ, maxZ, height) => {
        if (!blocked && height > 1.35 &&
            segmentIntersectsAABB(officer.x, officer.z, target.x, target.z, minX, maxX, minZ, maxZ)) blocked = true;
      });
      if (blocked) return false;
    }
    return hasLineOfSight(officer.x, officer.z, target.x, target.z, this.city, this.defenseWalls, this.blastGates, this.interiorDoors);
  }

  private fireOnImmediateThreat(officer: AgentData, wall?: DefenseWallData): void {
    if (officer.attackCooldown > 0 || officer.reloadTimer > 0 || officer.ammo <= 0) return;
    let closest = 3.8;
    let target: AgentData | undefined;
    for (const infected of this.spatial.queryRadius(officer.x, officer.z, closest, this.neighborBuffer)) {
      if (!infected.isAlive || infected.role !== 'infected' ||
          (officer.pinnedById !== null && infected.id !== officer.pinnedById)) continue;
      const distance = Math.hypot(infected.x - officer.x, infected.z - officer.z, infected.climbY + infected.fallY - officer.climbY);
      if (distance >= closest || !this.canOfficerSee(officer, infected, wall)) continue;
      target = infected;
      closest = distance;
    }
    if (!target) return;
    officer.targetAgentId = target.id;
    officer.rotationY = Math.atan2(target.x - officer.x, target.z - officer.z);
    this.firePoliceWeapon(officer, target);
  }

  private firePoliceWeapon(officer: AgentData, target: AgentData): void {
    officer.attackCooldown = officer.isSwat ? 0.62 : 1.0;
    officer.ammo--;
    if (officer.ammo <= 0) {
      officer.reloadTimer = officer.isSwat ? 1.55 : 2.15;
    }

    this.pushEffect({
      type: 'gunshot',
      x: officer.x,
      y: officer.climbY + GUARD_MUZZLE_HEIGHT,
      z: officer.z,
      targetX: target.x,
      targetY: target.climbY + target.fallY + GUARD_TARGET_HEIGHT,
      targetZ: target.z,
      age: 0,
      duration: 0.18
    });

    if (this.onSound) {
      this.onSound(officer.isSwat ? 'swat_shot' : 'gunshot', officer.x, officer.z);
    }

    const dist = Math.hypot(target.x - officer.x, target.z - officer.z);
    const hitChance = officer.isSwat ? 0.9 : dist < 6.0 ? 0.86 : 0.72;
    if (!this.rng.chance(hitChance)) {
      return;
    }

    const damage = officer.isSwat ? this.rng.range(50, 70) : this.rng.range(30, 44);
    this.damageInfected(officer, target, damage);
  }

  private damageInfected(officer: AgentData, target: AgentData, damage: number): void {
    target.health -= damage;

    if (target.health <= 0 && target.isAlive) {
      this.releaseGrapple(target);
      target.isAlive = false;
      this.totalDeceased++;
      officer.kills++;
      this.recordPlayerKillReward(officer);
      const district = this.city.getDistrictAtPos(target.x, target.z);
      this.logAgentAction(officer, `Neutralized ${target.name} in ${district} (Kills: ${officer.kills}).`);
      this.addEventLog(
        'police',
        `HOSTILE DOWN: ${officer.name} neutralized ${target.name} in ${district}.`,
        target.x,
        target.z
      );
      if (this.config.allowPlayerIntervention) {
        this.commandPoints = Math.min(260, this.commandPoints + 8);
      }
    }
  }

  private isInSamePatrolSector(fromZ: number, toZ: number): boolean {
    return !this.defenseWalls.some((wall) =>
      fromZ >= wall.z ? toZ < wall.z + 3 : toZ > wall.z - 3
    );
  }

  private assignRandomCivilianDestination(a: AgentData): void {
    const nodes = this.defenseWalls.length
      ? this.city.navNodes.filter((node) => this.isInSamePatrolSector(a.z, node.z))
      : this.city.navNodes;
    if (nodes.length === 0) {
      a.path = [];
      a.pathIndex = 0;
      return;
    }
    const node = this.rng.pick(nodes);
    a.path = this.city.findPath(
      a.x,
      a.z,
      node.x,
      node.z,
      this.roadblocks,
      this.defenseWalls,
      this.blastGates,
      false
    );
    a.pathIndex = 0;
    a.destinationLabel = `Walking to ${node.district}`;
  }

  private assignRandomPatrolDestination(p: AgentData): void {
    if (this.prioritySector && this.prioritySector.active && this.rng.chance(0.65)) {
      const sectorNodes = this.city.navNodes.filter(
        (n) =>
          this.canReinforceAt(n.z) && this.isInSamePatrolSector(p.z, n.z) && Math.hypot(n.x - this.prioritySector!.x, n.z - this.prioritySector!.z) <=
          this.prioritySector!.radius + 10
      );
      if (sectorNodes.length > 0) {
        const node = this.rng.pick(sectorNodes);
        p.path = this.city.findPath(
          p.x,
          p.z,
          node.x,
          node.z,
          this.roadblocks,
          this.defenseWalls,
          this.blastGates,
          false
        );
        p.pathIndex = 0;
        p.destinationLabel = `Priority Patrol: ${node.district}`;
        return;
      }
    }

    const nodes = this.defenseWalls.length ? this.city.navNodes.filter((node) =>
      this.isInSamePatrolSector(p.z, node.z) && (p.role !== 'police' ||
        (this.canReinforceAt(node.z) && (!this.layeredKtx || node.z < 156)))) : this.city.navNodes;
    if (nodes.length === 0) {
      p.path = [];
      p.pathIndex = 0;
      return;
    }
    const node = this.rng.pick(nodes);
    p.path = this.city.findPath(
      p.x,
      p.z,
      node.x,
      node.z,
      this.roadblocks,
      this.defenseWalls,
      this.blastGates,
      false
    );
    p.pathIndex = 0;
    p.destinationLabel = `Patrolling ${node.district}`;
  }

  private fleeFromThreat(a: AgentData, threatX: number, threatZ: number): void {
    a.civState = 'FLEEING';
    a.stateTimer = 5.5;
    a.repathCooldown = 1.1;
    const halfX = this.city.cityHalfX;
    const halfZ = this.city.cityHalfZ;

    // On Citadel Express, fleeing civilians naturally head southward toward the Safe Zone & Express Station!
    let fleeX: number;
    let fleeZ: number;
    if (this.layeredKtx && !a.avoidsEvacuation && a.z < this.city.stationPos.z - 12) {
      fleeX = a.x + this.rng.range(-18, 18);
      fleeZ = Math.min(halfZ - 8, a.z + 36);
    } else {
      const dx = a.x - threatX;
      const dz = a.z - threatZ;
      const len = Math.hypot(dx, dz) || 1;
      fleeX = a.x + (dx / len) * 28;
      fleeZ = a.z + (dz / len) * 28;
    }

    fleeX = Math.max(-halfX + 4, Math.min(halfX - 4, fleeX));
    fleeZ = Math.max(-halfZ + 4, Math.min(halfZ - 4, fleeZ));
    let minZ = -Infinity;
    let maxZ = Infinity;
    if (a.avoidsEvacuation) {
      for (const wall of this.defenseWalls) {
        if (a.z >= wall.z) minZ = Math.max(minZ, wall.z);
        else maxZ = Math.min(maxZ, wall.z);
      }
    }
    const targetNode = this.city.findNearestNode(fleeX, fleeZ, minZ, maxZ);
    const fleePath = this.requestPath(a.x, a.z, targetNode.x, targetNode.z, false);
    if (fleePath) {
      a.path = fleePath;
      a.repathCooldown = 1.1;
    } else {
      a.path = [{ x: targetNode.x, z: targetNode.z }];
      a.repathCooldown = 0.4;
    }
    a.pathIndex = 0;
    a.destinationLabel = `Fleeing towards ${targetNode.district}`;
  }

  private startEvacuating(a: AgentData, ez: EvacZoneData): void {
    if (a.avoidsEvacuation || a.civState === 'EVACUATING') return;
    a.civState = 'EVACUATING';
    a.destinationLabel = 'Evacuation Zone';
    const evacPath = this.requestPath(a.x, a.z, ez.x, ez.z, false);
    if (evacPath) {
      a.path = evacPath;
      a.repathCooldown = 1.1;
    } else {
      a.path = [{ x: ez.x, z: ez.z }];
      a.repathCooldown = 0.4;
    }
    a.pathIndex = 0;
    this.logAgentAction(a, `Heading to designated Evacuation Zone.`);
  }

  private findNearestEvacZone(x: number, z: number, maxDist: number): EvacZoneData | null {
    let best: EvacZoneData | null = null;
    let bestDist = maxDist;
    for (let i = 0; i < this.evacZones.length; i++) {
      const ez = this.evacZones[i];
      if (!ez.active) continue;
      const d = Math.hypot(ez.x - x, ez.z - z);
      if (d < bestDist) {
        bestDist = d;
        best = ez;
      }
    }
    return best;
  }

  private findNearestAvailableShelter(x: number, z: number, maxDist: number): BuildingData | null {
    let best: BuildingData | null = null;
    let bestDist = maxDist;
    const candidates = this.city.getBuildingsNearPos(x, z, this.buildingBuffer, maxDist);
    for (let i = 0; i < candidates.length; i++) {
      const b = candidates[i];
      if (!b.isShelterCapable || b.doorIntegrity <= 0) continue;
      if (b.shelteredAgentIds.length >= b.shelterCapacity) continue;
      const d = Math.hypot(b.doorX - x, b.doorZ - z);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  }

  private removeAgentFromShelter(a: AgentData): void {
    if (!a.shelterBuildingId) return;
    const b = this.city.buildingById.get(a.shelterBuildingId);
    if (b) {
      const idx = b.shelteredAgentIds.indexOf(a.id);
      if (idx !== -1) b.shelteredAgentIds.splice(idx, 1);
      a.x = b.doorX + this.rng.range(-0.8, 0.8);
      a.z = b.doorZ + this.rng.range(-0.8, 0.8);
    }
    a.shelterBuildingId = null;
  }

  private isProbeBlocked(px: number, pz: number): boolean {
    if (this.city.isPointInOpenWater(px, pz, 0.5)) return true;
    const obs = this.city.getObstaclesNearPos(px, pz, this.avoidProbeBuf, 2.2);
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const cosR = o.cosR ?? Math.cos(o.rotationY);
      const sinR = o.sinR ?? Math.sin(o.rotationY);
      const dx = px - o.x;
      const dz = pz - o.z;
      const lx = dx * cosR - dz * sinR;
      const lz = dx * sinR + dz * cosR;
      if (Math.abs(lx) < o.width * 0.5 + 0.62 && Math.abs(lz) < o.depth * 0.5 + 0.62) {
        return true;
      }
    }
    return false;
  }

  private pursuePositionSmart(
    z: AgentData,
    gx: number,
    gz: number,
    speed: number,
    dt: number,
    targetAgent?: AgentData
  ): void {
    if (this.ridingKtx(z)) {
      this.steerTowards(z, gx, gz, speed, dt);
      return;
    }
    if (this.layeredKtx && ktxContains(z.x, z.z) && z.climbY <= 0.12 && gz >= KTX_LAST_LINE_Z + 2.5) {
      this.steerAroundStationGround(z, { x: gx, z: gz }, speed, dt);
      return;
    }
    let navX = gx;
    let navZ = gz;

    // Route outside infected to the open rear-car doorway.
    const tr = this.expressTrain;
    if (!this.layeredKtx && tr.active && tr.state === 'DOCKED' && this.getTrainCarForPos(gx, gz) > 0 && this.getTrainCarForPos(z.x, z.z) === 0) {
      const doorX = tr.x + tr.boardingDoorLocalX;
      const apronZ = tr.z - 2.35;
      if (Math.hypot(z.x - doorX, z.z - apronZ) <= 2.35) {
        this.steerTowards(z, doorX, tr.z, speed, dt);
        return;
      }
      navX = doorX;
      navZ = apronZ;
    } else if (targetAgent) {
      // 2. Walkable Building Door Funnel: outside zombie chasing indoor survivor routes to building door first
      const nearBlds = this.city.getBuildingsNearPos(gx, gz, this.buildingBuffer, 1.5);
      for (let bi = 0; bi < nearBlds.length; bi++) {
        const b = nearBlds[bi];
        if (!b.interior) continue;
        const tgtIn = gx > b.minX && gx < b.maxX && gz > b.minZ && gz < b.maxZ;
        const zIn = z.x > b.minX && z.x < b.maxX && z.z > b.minZ && z.z < b.maxZ;
        if (tgtIn && !zIn) {
          let bestDoor: InteriorDoorData | null = null;
          let bestScore = Infinity;
          for (let di = 0; di < this.interiorDoors.length; di++) {
            const d = this.interiorDoors[di];
            if (d.buildingId !== b.id) continue;
            const sc = Math.hypot(d.x - z.x, d.z - z.z) + (d.isLocked && !d.isBroken ? 18 : 0);
            if (sc < bestScore) {
              bestScore = sc;
              bestDoor = d;
            }
          }
          if (bestDoor) {
            navX = bestDoor.x;
            navZ = bestDoor.z;
          }
          break;
        }
      }
    }

    const dGoal = Math.hypot(navX - z.x, navZ - z.z);
    if (
      dGoal > 1.4 &&
      z.climbY <= 0.1 &&
      (!hasLineOfSight(z.x, z.z, navX, navZ, this.city, this.defenseWalls, this.blastGates, this.interiorDoors) ||
        !this.city.isNavigationSegmentClear(z.x, z.z, navX, navZ))
    ) {
      const previous = this.pursuitGoals.get(z);
      if (!previous || previous.path !== z.path || Math.hypot(navX - previous.x, navZ - previous.z) > 5) {
        z.path = [];
        z.pathIndex = 0;
      }
      if (z.repathCooldown <= 0 && z.pathIndex >= z.path.length) {
        const path = this.requestPath(z.x, z.z, navX, navZ, z.role === 'infected');
        if (path?.length) {
          z.path = path;
          z.pathIndex = 0;
          this.pursuitGoals.set(z, { x: navX, z: navZ, path });
          z.repathCooldown = 1.05 + (z.id % 5) * 0.08;
        } else {
          z.repathCooldown = 0.4 + (z.id % 7) * 0.06;
        }
      }
      if (z.pathIndex < z.path.length && !this.moveAlongPath(z, speed, dt)) return;
    }

    this.steerTowards(z, navX, navZ, speed, dt);
  }

  private moveAlongPath(a: AgentData, speed: number, dt: number): boolean {
    const reached = () => {
      a.vx = 0;
      a.vz = 0;
      this.pathProgress.delete(a);
      return true;
    };
    while (a.pathIndex < a.path.length && Math.hypot(a.path[a.pathIndex].x - a.x, a.path[a.pathIndex].z - a.z) < 0.85) {
      a.pathIndex++;
    }
    if (a.pathIndex >= a.path.length) return reached();

    const wp = a.path[a.pathIndex];
    if (a.role !== 'infected') {
      for (const wall of this.defenseWalls) {
        if ((a.z < wall.z) === (wp.z < wall.z)) continue;
        const x = a.x + (wp.x - a.x) * (wall.z - a.z) / (wp.z - a.z);
        const passable = this.blastGates.some((gate) => gate.wallId === wall.id &&
          this.canCivilianCrossGate(gate) && Math.abs(x - gate.x) < gateClearHalfWidth(gate) - 0.5);
        if (!passable) {
          a.path = [];
          a.pathIndex = 0;
          return reached();
        }
      }
    }
    const dist = Math.hypot(wp.x - a.x, wp.z - a.z);
    const progress = this.pathProgress.get(a);
    if (!progress || progress.path !== a.path || progress.index !== a.pathIndex) {
      this.pathProgress.set(a, { path: a.path, index: a.pathIndex, distance: dist, stalled: 0 });
    } else if (dist < progress.distance - 0.35) {
      progress.distance = dist;
      progress.stalled = 0;
    } else if (speed > 0.6 && (progress.stalled += dt) >= 2.2) {
      a.path = [];
      a.pathIndex = 0;
      a.repathCooldown = 0;
      return reached();
    }

    this.steerTowards(a, wp.x, wp.z, speed, dt);
    return false;
  }

  private steerTowards(a: AgentData, targetX: number, targetZ: number, speed: number, dt: number): void {
    const dx = targetX - a.x;
    const dz = targetZ - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return;

    let dirX = dx / dist;
    let dirZ = dz / dist;

    // Anti-sticking progress tracker + proactive tangent weaving around parked vehicles, buses & barricades
    if (!a.isPlayerControlled && a.climbY <= 0.1 && a.stunnedTimer <= 0 && a.pinnedById === null &&
        a.grappleTargetId === null && (!this.layeredKtx || !ktxContains(a.x, a.z))) {
      if (Math.hypot(a.x - a.lastProgressX, a.z - a.lastProgressZ) >= 0.28) {
        a.lastProgressX = a.x;
        a.lastProgressZ = a.z;
        a.stuckTimer = 0;
      } else if (speed > 0.6) {
        a.stuckTimer += dt;
        if (a.stuckTimer >= 0.42) {
          a.stuckTimer = 0;
          if (a.avoidTimer > 0) {
            a.avoidSide = -a.avoidSide;
          } else {
            const angL = Math.atan2(dirZ, dirX) + 1.15;
            const angR = Math.atan2(dirZ, dirX) - 1.15;
            const bL = this.isProbeBlocked(a.x + Math.cos(angL) * 1.45, a.z + Math.sin(angL) * 1.45);
            const bR = this.isProbeBlocked(a.x + Math.cos(angR) * 1.45, a.z + Math.sin(angR) * 1.45);
            a.avoidSide = bL && !bR ? -1 : !bL && bR ? 1 : a.avoidSide;
          }
          a.avoidTimer = 1.05;
        }
      }

      if (a.avoidTimer > 0) {
        a.avoidTimer = Math.max(0, a.avoidTimer - dt);
        const turn = a.avoidSide * 1.15;
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        const rx = dirX * c - dirZ * s;
        const rz = dirX * s + dirZ * c;
        dirX = rx;
        dirZ = rz;
      } else if (dist > 1.4) {
        const fx = a.x + dirX * 1.35;
        const fz = a.z + dirZ * 1.35;
        const nearObs = this.city.getObstaclesNearPos(fx, fz, this.obsAvoidBuffer, 2.3);
        for (let oi = 0; oi < nearObs.length; oi++) {
          const o = nearObs[oi];
          const cosR = o.cosR ?? Math.cos(o.rotationY);
          const sinR = o.sinR ?? Math.sin(o.rotationY);
          const rx = fx - o.x;
          const rz = fz - o.z;
          const lx = rx * cosR - rz * sinR;
          const lz = rx * sinR + rz * cosR;
          if (Math.abs(lx) < o.width * 0.5 + 0.68 && Math.abs(lz) < o.depth * 0.5 + 0.68) {
            const cross = dirX * (o.z - a.z) - dirZ * (o.x - a.x);
            const side = cross >= 0 ? -1 : 1;
            const turn = side * 1.05;
            const c = Math.cos(turn);
            const s = Math.sin(turn);
            const nx = dirX * c - dirZ * s;
            const nz = dirX * s + dirZ * c;
            dirX = nx;
            dirZ = nz;
            break;
          }
        }
      }
    }

    a.vx = dirX * speed;
    a.vz = dirZ * speed;
    const oldX = a.x, oldZ = a.z;
    a.x += a.vx * dt;
    a.z += a.vz * dt;
    this.constrainKtxMove(a, oldX, oldZ);
    a.rotationY = Math.atan2(dirX, dirZ);
    a.animPhase += speed * dt * 3.2;
  }

  private applyCrowdSeparationAndCollisions(dt: number): void {
    const minSep = 0.78;
    const minSepSq = minSep * minSep;
    const boundX = this.city.cityHalfX + 5;
    const boundZ = this.city.cityHalfZ + 5;
    const sepCap = this.agents.length > 1200 ? 6 : 10;

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.isAlive || a.isEvacuated || (a.isTrainPassenger && !this.ridingKtx(a)) || a.civState === 'SHELTERED') continue;
      if (this.ridingKtx(a)) continue;
      if (a.isPlayerControlled && this.expressTrain.playerDeparting) continue;
      if (this.trainSeats.get(a.id)?.seating) continue;
      const oldX = a.x, oldZ = a.z;
      if ((a.isPlayerControlled && (this.fpLadderTravel || this.fpWallDeck)) ||
          (this.fallbacks.get(a.id)?.ladder && a.climbY > 0) ||
          (a.role === 'police' && a.climbY > 0 && this.wallAssignments.has(a.id)) || this.wallCrossings.has(a.id)) continue;

      const inTrain = this.layeredKtx && this.getTrainCarForPos(a.x, a.z, a.climbY) > 0;
      const enteringTrain = this.layeredKtx && this.expressTrain.state === 'DOCKED' &&
        a.climbY >= KTX_PLATFORM_Y - 0.4 && a.z >= this.expressTrain.z - 3 &&
        Math.abs(a.x - this.expressTrain.x - this.expressTrain.boardingDoorLocalX) <= 1.35;
      if (!enteringTrain && !a.isPlayerControlled && !this.pyramidMembers.has(a.id) &&
          a.pinnedById === null && a.grappleTargetId === null) {
        const nearby = this.spatial.queryRadius(a.x, a.z, minSep * 1.4, this.neighborBuffer);
        let pushX = 0;
        let pushZ = 0;
        const limit = Math.min(nearby.length, sepCap);
        for (let j = 0; j < limit; j++) {
          const b = nearby[j];
          if (b.id === a.id || a.grappleTargetId === b.id || a.pinnedById === b.id) continue;
          if (Math.abs(a.climbY + a.fallY - b.climbY - b.fallY) > 0.85) continue;
          const dx = a.x - b.x;
          const dz = a.z - b.z;
          const dSq = dx * dx + dz * dz;
          if (dSq > 1e-6 && dSq < minSepSq) {
            const d = Math.sqrt(dSq);
            const overlap = (minSep - d) / d;
            pushX += dx * overlap * 3.5;
            pushZ += dz * overlap * 3.5;
          }
        }

        a.x += pushX * dt;
        if (!inTrain) a.z += pushZ * dt;
      }

      for (let r = 0; r < this.roadblocks.length; r++) {
        const rb = this.roadblocks[r];
        if (!rb.active) continue;
        const dx = a.x - rb.x;
        const dz = a.z - rb.z;
        const d = Math.hypot(dx, dz);
        if (d < rb.radius && a.role !== 'police' && a.role !== 'medic' && d > 0.001) {
          a.x = rb.x + (dx / d) * rb.radius;
          a.z = rb.z + (dz / d) * rb.radius;
        }
      }

      if (a.fallY <= 0.25 && !(this.layeredKtx && ktxContains(oldX, oldZ))) {
        resolveWorldCollisions(a, 0.55, this.city, this.defenseWalls, this.blastGates, a.climbY, this.interiorDoors);
      }
      if (this.layeredKtx ? a.climbY >= KTX_PLATFORM_Y - 0.4 : a.climbY <= 0.2) this.resolveTrainCollisions(a, 0.55);
      this.constrainKtxMove(a, oldX, oldZ);

      a.x = Math.max(-boundX, Math.min(boundX, a.x));
      a.z = Math.max(-boundZ, Math.min(boundZ, a.z));
    }
  }

  private updateVehicles(dt: number): void {
    const limitX = this.city.cityHalfX + 10;
    const limitZ = this.city.cityHalfZ + 10;

    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (v.isAbandoned) {
        if (!v.isBurning && v.type !== 'police_cruiser' && v.type !== 'ambulance') {
          const near = this.spatial.queryRadius(v.x, v.z, 6.0, this.neighborBuffer);
          let zCount = 0;
          for (let k = 0; k < near.length; k++) {
            if (near[k].role === 'infected') zCount++;
          }
          if (zCount >= 2) {
            v.isBurning = true;
          }
        }
        continue;
      }

      // Runaway Heavy Truck plowing through zombies before crashing in flames!
      if (v.isRunaway) {
        v.runawayTimer -= dt;
        v.speed = 16.5;
        v.x += v.dirX * v.speed * dt;
        v.z += v.dirZ * v.speed * dt;

        const hit = this.spatial.queryRadius(v.x, v.z, 2.8, this.neighborBuffer);
        for (let k = 0; k < hit.length; k++) {
          const a = hit[k];
          if (a.isAlive && a.role === 'infected') {
            a.isAlive = false;
            this.totalDeceased++;
          }
        }

        const hitWall = this.defenseWalls.some((w) => Math.abs(v.z - w.z) < 2.8);
        const hitStaticObs = this.city.staticObstacles.some(
          (obs) => Math.hypot(v.x - obs.x, v.z - obs.z) < Math.max(obs.width, obs.depth) * 0.5 + 1.8
        );
        if (
          v.runawayTimer <= 0 ||
          hitWall ||
          hitStaticObs ||
          Math.abs(v.x) > limitX ||
          Math.abs(v.z) > limitZ
        ) {
          v.isRunaway = false;
          v.isAbandoned = true;
          v.isBurning = true;
          v.speed = 0;
          this.effects.push({
            type: 'explosion',
            x: v.x,
            z: v.z,
            age: 0,
            duration: 0.75
          });
          if (this.onSound) this.onSound('explosion', v.x, v.z);
        }
        continue;
      }

      let blocked = false;
      const lookAheadX = v.x + v.dirX * 4.5;
      const lookAheadZ = v.z + v.dirZ * 4.5;

      // Stop at closed Blast Gates
      for (let gi = 0; gi < this.blastGates.length; gi++) {
        const g = this.blastGates[gi];
        if (gateClearHalfWidth(g) < 1.1 && Math.hypot(lookAheadX - g.x, lookAheadZ - g.z) < 4.5) {
          blocked = true;
          break;
        }
      }

      if (!blocked) {
        for (let r = 0; r < this.roadblocks.length; r++) {
          const rb = this.roadblocks[r];
          if (!rb.active) continue;
          if (Math.hypot(lookAheadX - rb.x, lookAheadZ - rb.z) < rb.radius + 2.2) {
            blocked = true;
            break;
          }
        }
      }

      if (!blocked) {
        for (let j = 0; j < this.vehicles.length; j++) {
          if (i === j) continue;
          const other = this.vehicles[j];
          const dx = other.x - v.x;
          const dz = other.z - v.z;
          const forwardDist = dx * v.dirX + dz * v.dirZ;
          const lateralDist = Math.abs(dx * v.dirZ - dz * v.dirX);
          if (forwardDist > 0 && forwardDist < 5.6 && lateralDist < 1.9) {
            blocked = true;
            break;
          }
        }
      }

      if (!blocked) {
        const obsList = this.city.staticObstacles;
        for (let oi = 0; oi < obsList.length; oi++) {
          const obs = obsList[oi];
          if (
            Math.hypot(lookAheadX - obs.x, lookAheadZ - obs.z) <
            Math.max(obs.width, obs.depth) * 0.5 + 2.4
          ) {
            blocked = true;
            break;
          }
        }
      }

      if (!blocked) {
        const peds = this.spatial.queryRadius(lookAheadX, lookAheadZ, 2.4, this.neighborBuffer);
        if (peds.length > 0) {
          let sawZombie = false;
          for (let p = 0; p < peds.length; p++) {
            if (peds[p].role === 'infected') {
              sawZombie = true;
              break;
            }
          }
          if (sawZombie && v.type === 'truck' && this.rng.chance(0.45)) {
            v.isRunaway = true;
            v.runawayTimer = 3.5;
          } else {
            blocked = true;
            if (sawZombie && v.type !== 'police_cruiser' && v.type !== 'ambulance') {
              v.isAbandoned = true;
              v.speed = 0;
            }
          }
        }
      }

      if (blocked) {
        v.speed = Math.max(0, v.speed - dt * 18);
      } else {
        v.speed = Math.min(v.maxSpeed, v.speed + dt * 9);
      }

      v.x += v.dirX * v.speed * dt;
      v.z += v.dirZ * v.speed * dt;

      if (v.x > limitX) v.x = -limitX;
      if (v.x < -limitX) v.x = limitX;
      if (v.z > limitZ) v.z = -limitZ;
      if (v.z < -limitZ) v.z = limitZ;
    }
  }

  // ============================================================================
  // FIRST-PERSON UNARMED SURVIVOR ESCAPE MODE
  // ============================================================================

  private pickDynamicSafeSpawn(): { x: number; z: number; yaw: number; label: string } {
    if (this.config.mapId === 'citadel_express') {
      const candidates: Array<{ x: number; z: number; yaw: number; label: string; scenic?: number }> = [
        { x: -52.0, z: -102.0, yaw: Math.PI, label: 'West Blvd Expressway Approach', scenic: 24 },
        { x: -52.0, z: -42.0, yaw: Math.PI, label: 'Sector 2 Commercial Canyon', scenic: 22 },
        { x: 26.0, z: -102.0, yaw: Math.PI, label: 'Midtown Overpass Approach', scenic: 20 },
        { x: -34.0, z: -157.5, yaw: Math.PI, label: '24H Avenue Mart Floor', scenic: 14 },
        { x: -34.0, z: -138.5, yaw: Math.PI, label: 'Northgate Brick Clinic', scenic: 12 },
        { x: -52.0, z: -172.0, yaw: Math.PI, label: 'Sector 1 West Blvd', scenic: 10 },
        { x: 56.0, z: -64.0, yaw: Math.PI, label: 'Midtown East Parking Lot', scenic: 8 },
        { x: -16.0, z: 32.0, yaw: Math.PI, label: 'Midtown Canal Bridgehead', scenic: 8 }
      ];
      const scored = candidates.map((c) => {
        const near = this.spatial.queryRadius(c.x, c.z, 32, this.neighborBuffer);
        let zNear = 0;
        let minD = 999;
        for (let i = 0; i < near.length; i++) {
          const a = near[i];
          if (!a.isAlive || a.role !== 'infected') continue;
          zNear++;
          const d = Math.hypot(a.x - c.x, a.z - c.z);
          if (d < minD) minD = d;
        }
        const score = minD * 2.5 - zNear * 9.0 + (c.scenic ?? 0);
        return { ...c, minD, score };
      });
      const safePool = scored.filter((s) => s.minD >= 14.0);
      const ranked = (safePool.length > 0 ? safePool : scored).sort((a, b) => b.score - a.score);
      const topSlice = ranked.slice(0, Math.min(2, ranked.length));
      return this.rng.pick(topSlice);
    }

    const step = Math.max(1, Math.floor(this.city.navNodes.length / 12));
    const scoredNodes: Array<{ x: number; z: number; yaw: number; label: string; minD: number; score: number }> = [];
    for (let i = 0; i < this.city.navNodes.length; i += step) {
      const n = this.city.navNodes[i];
      const near = this.spatial.queryRadius(n.x, n.z, 32, this.neighborBuffer);
      let zNear = 0;
      let minD = 999;
      for (let j = 0; j < near.length; j++) {
        const a = near[j];
        if (!a.isAlive || a.role !== 'infected') continue;
        zNear++;
        const d = Math.hypot(a.x - n.x, a.z - n.z);
        if (d < minD) minD = d;
      }
      const ez = this.evacZones[0];
      const distGoal = ez ? Math.hypot(n.x - ez.x, n.z - ez.z) : 80;
      const rangeBonus = distGoal >= 65 && distGoal <= 190 ? 14 : 0;
      scoredNodes.push({
        x: n.x,
        z: n.z,
        yaw: Math.PI,
        label: n.district,
        minD,
        score: minD * 2.5 - zNear * 9.0 + rangeBonus
      });
    }
    const safeNodes = scoredNodes.filter((s) => s.minD >= 14.0);
    const ranked = (safeNodes.length > 0 ? safeNodes : scoredNodes).sort((a, b) => b.score - a.score);
    const pick = ranked[Math.floor(this.rng.next() * Math.min(3, ranked.length))];
    return pick ?? { x: 0, z: -this.city.cityHalfZ + 36, yaw: Math.PI, label: 'City Street' };
  }

  private computeEscapeWaypoint(px: number, pz: number, height = 0): { x: number; z: number; label: string } {
    let nextWall: DefenseWallData | null = null;
    for (let i = 0; i < this.defenseWalls.length; i++) {
      const w = this.defenseWalls[i];
      if (w.z > pz - 1.5 && (!nextWall || w.z < nextWall.z)) {
        nextWall = w;
      }
    }
    if (nextWall) {
      let bestGate: BlastGateData | null = null;
      let bestScore = Infinity;
      for (let gi = 0; gi < this.blastGates.length; gi++) {
        const g = this.blastGates[gi];
        if (g.wallId !== nextWall.id) continue;
        const passBonus = gateClearHalfWidth(g) >= 0.75 ? 0 : 45;
        const score = Math.abs(g.x - px) + passBonus;
        if (score < bestScore) {
          bestScore = score;
          bestGate = g;
        }
      }
      if (bestGate) {
        return {
          x: bestGate.x,
          z: bestGate.z + 2.0,
          label: `${bestGate.label}${bestGate.breached || bestGate.isOpen ? '' : bestGate.openFraction > 0 ? ' (Closing)' : ' (Sealed — [E] Open)'}`
        };
      }
    }

    if (this.city.hasExpressRail) {
      const tr = this.expressTrain;
      const carNum = this.getTrainCarForPos(px, pz, height);
      if (tr.state === 'DOCKED') {
        if (carNum > 1) {
          const door = tr.doors[tr.layout.carCount - carNum];
          return { x: tr.x + door.localX + 0.6, z: tr.z, label: `KTX Car ${carNum} → Car ${carNum - 1}` };
        }
        if (carNum === 1) {
          return { x: tr.x + tr.cabinSwitchLocalX, z: tr.z, label: 'Car 1 Safe Cabin Console [E]' };
        }
        if (this.layeredKtx) return ktxWaypoint(px, pz, height, 'public', true, this.ktxGateOpen('public'));
        return {
          x: tr.stationX + tr.boardingDoorLocalX,
          z: tr.stationZ - 2.35,
          label: 'KTX Car 3 Boarding Door'
        };
      }
      if (this.layeredKtx) return ktxWaypoint(px, pz, height, 'public', false, this.ktxGateOpen('public'));
      return {
        x: tr.stationX,
        z: tr.stationZ - 5.8,
        label: tr.state === 'COOLDOWN' ? 'Wait in Concourse / Platform' : 'KTX Express Platform'
      };
    }
    const ez = this.findNearestEvacZone(px, pz, 500);
    if (ez) {
      return { x: ez.x, z: ez.z, label: 'Evacuation Zone' };
    }
    return { x: 0, z: this.city.cityHalfZ - 12, label: 'South Perimeter' };
  }

  private isVaultLandingSafe(ex: number, ez: number): boolean {
    if (this.layeredKtx && ez >= 157 && (ktxContains(ex, ez) || ez >= 193.85)) return false;
    const boundX = this.city.cityHalfX + 3.5;
    const boundZ = this.city.cityHalfZ + 3.5;
    if (Math.abs(ex) > boundX || Math.abs(ez) > boundZ) return false;
    if (this.city.isPointInOpenWater(ex, ez, 0.7)) return false;

    for (let wi = 0; wi < this.defenseWalls.length; wi++) {
      const w = this.defenseWalls[wi];
      if (Math.abs(ez - w.z) < w.thickness * 0.5 + 0.75) {
        let openGate = false;
        for (let gi = 0; gi < this.blastGates.length; gi++) {
          const g = this.blastGates[gi];
          if (g.wallId === w.id && Math.abs(ex - g.x) <= gateClearHalfWidth(g) - 0.65) {
            openGate = true;
            break;
          }
        }
        if (!openGate) return false;
      }
    }

    const nearBlds = this.city.getBuildingsNearPos(ex, ez, this.buildingBuffer, 2.0);
    for (let i = 0; i < nearBlds.length; i++) {
      const b = nearBlds[i];
      if (!b.interior) {
        if (ex >= b.minX - 0.68 && ex <= b.maxX + 0.68 && ez >= b.minZ - 0.68 && ez <= b.maxZ + 0.68) {
          return false;
        }
      } else if (ex >= b.minX - 1.0 && ex <= b.maxX + 1.0 && ez >= b.minZ - 1.0 && ez <= b.maxZ + 1.0) {
        for (let w = 0; w < b.interior.walls.length; w++) {
          const iw = b.interior.walls[w];
          if (ex >= iw.minX - 0.55 && ex <= iw.maxX + 0.55 && ez >= iw.minZ - 0.55 && ez <= iw.maxZ + 0.55) {
            return false;
          }
        }
        for (let p = 0; p < b.interior.props.length; p++) {
          const ip = b.interior.props[p];
          if (ex >= ip.minX - 0.5 && ex <= ip.maxX + 0.5 && ez >= ip.minZ - 0.5 && ez <= ip.maxZ + 0.5) {
            return false;
          }
        }
      }
    }

    const obsBuf: typeof this.city.staticObstacles = [];
    const nearObs = this.city.getObstaclesNearPos(ex, ez, obsBuf, 1.5);
    for (let i = 0; i < nearObs.length; i++) {
      const o = nearObs[i];
      const dx = ex - o.x;
      const dz = ez - o.z;
      const cosR = o.cosR ?? Math.cos(o.rotationY);
      const sinR = o.sinR ?? Math.sin(o.rotationY);
      const lx = dx * cosR - dz * sinR;
      const lz = dx * sinR + dz * cosR;
      if (Math.abs(lx) < o.width * 0.5 + 0.55 && Math.abs(lz) < o.depth * 0.5 + 0.55) {
        return false;
      }
    }
    return true;
  }

  private findVaultTarget(
    player: AgentData,
    yaw: number
  ): { endX: number; endZ: number; peakY: number; label: string } | null {
    const fX = -Math.sin(yaw);
    const fZ = -Math.cos(yaw);
    const obsBuf: typeof this.city.staticObstacles = [];
    const nearObs = this.city.getObstaclesNearPos(player.x + fX * 1.4, player.z + fZ * 1.4, obsBuf, 3.0);

    let best: { endX: number; endZ: number; peakY: number; label: string; dist: number } | null = null;
    const consider = (
      ox: number,
      oz: number,
      hw: number,
      hd: number,
      cosR: number,
      sinR: number,
      height: number,
      label: string
    ) => {
      const rx = ox - player.x;
      const rz = oz - player.z;
      const projFwd = rx * fX + rz * fZ;
      if (projFwd < 0.25 || projFwd > 3.1) return;

      const latOffset = Math.abs(-rx * fZ + rz * fX);
      const halfSpanFwd = Math.abs(fX * cosR - fZ * sinR) * hw + Math.abs(fX * sinR + fZ * cosR) * hd;
      const halfSpanLat = Math.abs(-fZ * cosR - fX * sinR) * hw + Math.abs(-fZ * sinR + fX * cosR) * hd;
      if (latOffset > halfSpanLat + 0.65) return;

      const surfaceDist = projFwd - halfSpanFwd;
      if (surfaceDist > 1.75 || surfaceDist < -0.35) return;

      const landDist = Math.max(2.3, Math.min(4.8, projFwd + halfSpanFwd + 0.92));
      const endX = player.x + fX * landDist;
      const endZ = player.z + fZ * landDist;
      if (!this.isVaultLandingSafe(endX, endZ)) return;

      if (!best || surfaceDist < best.dist) {
        best = {
          endX,
          endZ,
          peakY: Math.min(1.42, Math.max(0.75, height + 0.28)),
          label,
          dist: surfaceDist
        };
      }
    };

    for (let i = 0; i < nearObs.length; i++) {
      const o = nearObs[i];
      if (o.height > 1.65) continue;
      const lbl =
        o.kind === 'parkour_fence'
          ? 'Parkour Fence'
          : o.kind === 'dumpster'
          ? 'Alley Dumpster'
          : o.kind === 'jersey_barrier'
          ? 'Concrete Barrier'
          : o.kind === 'taxi'
          ? 'Yellow Taxi'
          : o.kind === 'van'
          ? 'Delivery Van'
          : 'Parked Car';
      consider(
        o.x,
        o.z,
        o.width * 0.5,
        o.depth * 0.5,
        o.cosR ?? Math.cos(o.rotationY),
        o.sinR ?? Math.sin(o.rotationY),
        o.height,
        lbl
      );
    }

    const nearBlds = this.city.getBuildingsNearPos(player.x, player.z, this.buildingBuffer, 2.5);
    for (let bi = 0; bi < nearBlds.length; bi++) {
      const b = nearBlds[bi];
      if (!b.interior) continue;
      for (let pi = 0; pi < b.interior.props.length; pi++) {
        const p = b.interior.props[pi];
        if (p.height > 1.45) continue;
        const lbl = p.kind === 'counter' ? 'Store Counter' : p.kind === 'bed' ? 'Clinic Bed' : 'Bench';
        consider(
          (p.minX + p.maxX) * 0.5,
          (p.minZ + p.maxZ) * 0.5,
          (p.maxX - p.minX) * 0.5,
          (p.maxZ - p.minZ) * 0.5,
          1,
          0,
          p.height,
          lbl
        );
      }
    }

    for (let ri = 0; ri < this.roadblocks.length; ri++) {
      const rb = this.roadblocks[ri];
      if (!rb.active) continue;
      consider(rb.x, rb.z, rb.radius * 0.8, 0.55, Math.cos(rb.rotationY), Math.sin(rb.rotationY), 1.2, 'Barricade');
    }

    return best;
  }

  public canSpawnPlayerAt(point: PlayerSpawnPoint): boolean {
    const { x, y, z } = point;
    const radius = 0.64;
    if (![x, y, z].every(Number.isFinite) || Math.abs(x) > this.city.cityHalfX - radius ||
        Math.abs(z) > this.city.cityHalfZ - radius) return false;
    if (point.wallId !== undefined) {
      const wall = this.defenseWalls.find((candidate) => candidate.id === point.wallId);
      const span = wall && wallDeckSpan(wall, this.blastGates, x);
      return !!wall && !!span && x >= span.minX && x <= span.maxX &&
        z >= wallDeckFrontZ(wall) && z <= wall.z + wall.thickness / 2 - WALL_DECK_REAR_TRIM &&
        Math.abs(y - wall.height - WALL_DECK_RISE) < 0.05;
    }
    const surface = this.layeredKtx ? ktxSurfaceAt(x, z, y) : undefined;
    const trainCar = this.getTrainCarForPos(x, z, y);
    if (surface?.id === 'boarding' && this.expressTrain.state !== 'DOCKED') return false;
    if (y !== 0 && !trainCar && (!surface || Math.abs(ktxSurfaceHeight(surface, x, z) - y) > 0.06)) return false;
    if (y === 0 && this.city.isPointInOpenWater(x, z, radius)) return false;
    if (this.layeredKtx && z >= KTX_LAST_LINE_Z + 0.5) {
      const overlaps = (box: { x: number; z: number; y?: number; width: number; depth: number; height: number }) => {
        const base = box.y ?? 0;
        return y + 1.75 > base && y < base + box.height &&
          Math.abs(x - box.x) < box.width / 2 + radius && Math.abs(z - box.z) < box.depth / 2 + radius;
      };
      if (KTX_BOXES.some(overlaps) || KTX_GATE_IDS.some((id) => !this.ktxGateOpen(id) && overlaps(ktxGateBox(id)))) return false;
    }
    const probe = { x, z };
    if (!this.layeredKtx || !ktxContains(x, z)) {
      resolveWorldCollisions(probe, radius, this.city, this.defenseWalls, this.blastGates, y, this.interiorDoors);
    }
    if (trainCar || !this.layeredKtx || y >= KTX_PLATFORM_Y - 0.4) this.resolveTrainCollisions(probe, radius);
    return Math.hypot(probe.x - x, probe.z - z) < 0.025;
  }

  public enterFirstPerson(
    spawnPreset: 'city' | 'ktx_terminal' = 'city',
    role: PlayerRole = 'civilian',
    weapon?: PlayerWeapon,
    spawnPoint?: PlayerSpawnPoint
  ): AgentData {
    this.commanderOrder = this.config.allowPlayerIntervention ? 'Monitoring the outbreak' : 'Stand down';
    this.nextCommanderOrder = this.simTime + 2;
    // Release any previous player flag
    if (this.firstPerson.playerId !== null) {
      const prev = this.getAgentById(this.firstPerson.playerId);
      if (prev) {
        this.leavePlayerWall(prev);
        prev.isPlayerControlled = false;
      }
    }

    let player: AgentData | null = null;
    let spawnLabel = '';
    let initialYaw = Math.PI;
    const isKtxPreset = spawnPreset === 'ktx_terminal' && this.city.hasExpressRail;
    if (isKtxPreset) role = 'civilian';
    const choices = PLAYER_LOADOUTS[role];
    const weaponId = weapon && choices.includes(weapon) ? weapon : choices[0];

    if (spawnPoint && this.canSpawnPlayerAt(spawnPoint)) {
      const { x, y, z, wallId } = spawnPoint;
      const wall = this.defenseWalls.find((candidate) => candidate.id === wallId);
      const span = wall && wallDeckSpan(wall, this.blastGates, x);
      player = this.createAgent(role === 'civilian' ? 'civilian' : 'police', x, z, role === 'swat');
      player.climbY = y;
      player.onWallDeck = !!span;
      player.onTerminalFloor = !span && y > 0;
      if (wall && span) this.fpWallDeck = { wall, ...span };
      spawnLabel = wall?.label ?? this.city.getDistrictAtPos(x, z);
      this.pushAgent(player);
    } else if (isKtxPreset) {
      spawnLabel = this.layeredKtx ? 'KTX Forecourt' : 'KTX Platform 1';
      initialYaw = Math.PI;
      player = this.createAgent(
        'civilian',
        this.layeredKtx ? KTX_ENTRY.x : this.expressTrain.stationX + this.expressTrain.boardingDoorLocalX,
        this.layeredKtx ? KTX_ENTRY.z : 189.2,
        false
      );
      resolveWorldCollisions(player, 0.68, this.city, this.defenseWalls, this.blastGates, 0, this.interiorDoors);
      player.name = `${player.name} (You)`;
      player.destinationLabel = this.layeredKtx ? KTX_GATES.public.label : 'KTX Boarding Door';
      this.pushAgent(player);

      this.expressTrain.state = 'DOCKED';
      this.expressTrain.x = this.expressTrain.stationX;
      this.expressTrain.timer = Math.max(this.expressTrain.timer, 36.0);
      this.expressTrain.playerDeparting = false;
      for (const td of this.expressTrain.doors) {
        td.isLocked = false;
        td.isBroken = false;
        td.integrity = td.maxIntegrity;
        td.lastHitTime = -99;
      }

      // Citadel infections approach the station from the ground like the rest of the wave.
      const seeds: Array<[number, number, ZombieVariant]> = this.layeredKtx ? [
        [-51.2, 132, 'standard'], [-48, 135.5, 'runner'], [-39, 137.2, 'standard']
      ] : [
        [this.expressTrain.layout.bulkheads[0] + 3.9, this.expressTrain.z, 'standard'],
        [-9.2, 193.0, 'standard'],
        [-1.8, 193.0, 'runner'],
        [-20.0, 191.7, 'runner'],
        [-9.0, 192.0, 'standard']
      ];
      for (const [sx, sz, variant] of seeds) {
        const zmb = this.createAgent('infected', sx, sz, false, variant);
        zmb.rotationY = sz >= 195.5 ? -Math.PI * 0.5 : sz > 190 ? 0 : Math.PI * 0.25;
        this.pushAgent(zmb);
      }
    } else if (this.selectedAgentId !== null) {
      const sel = this.getAgentById(this.selectedAgentId);
      if (
        sel &&
        sel.isAlive &&
        !sel.isEvacuated &&
        (role === 'civilian' ? sel.role === 'civilian' : sel.role === 'police' && sel.isSwat === (role === 'swat')) &&
        sel.climbY === 0 && sel.fallY === 0 && !sel.isHunter && !this.wallAssignments.has(sel.id) &&
        sel.civState !== 'SHELTERED' &&
        sel.civState !== 'CONVULSING'
      ) {
        player = sel;
        spawnLabel = sel.name;
      }
    }

    if (!player) {
      const pick = this.pickDynamicSafeSpawn();
      spawnLabel = pick.label;
      initialYaw = pick.yaw;
      if (role !== 'civilian') {
        let closest = 45;
        for (const agent of this.agents) {
          if (agent.role !== 'police' || agent.isSwat !== (role === 'swat') || !agent.isAlive ||
              agent.isHunter || agent.isIncubating || agent.pinnedById !== null || agent.fallY > 0 || this.wallAssignments.has(agent.id)) continue;
          const distance = Math.hypot(agent.x - pick.x, agent.z - pick.z);
          if (distance < closest) {
            player = agent;
            closest = distance;
          }
        }
      }
      if (player) {
        spawnLabel = this.city.getDistrictAtPos(player.x, player.z);
      } else {
        player = this.createAgent(role === 'civilian' ? 'civilian' : 'police', pick.x, pick.z, role === 'swat');
        resolveWorldCollisions(player, 0.68, this.city, this.defenseWalls, this.blastGates, 0, this.interiorDoors);
        this.pushAgent(player);
      }
    }

    player.isPlayerControlled = true;
    player.destinationLabel = role === 'civilian' ? 'Fleeing to Extraction' : 'Awaiting Commander Orders';
    this.selectedAgentId = player.id;

    // Clear breathing pocket around spawn (18m outdoor city spawn, or 8.5m on KTX platform while keeping window bangers outside train!)
    const clearR = spawnPoint ? 0 : isKtxPreset ? 8.5 : role === 'civilian' ? 18 : 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.isAlive || a.role !== 'infected' || a.onTerminalFloor) continue;
      if (Math.hypot(a.x - player.x, a.z - player.z) < clearR) {
        a.x = player.x + this.rng.range(-12, 12);
        a.z = Math.max(-this.city.cityHalfZ + 8, player.z - this.rng.range(24, 34));
        a.targetAgentId = null;
        resolveWorldCollisions(a, 0.55, this.city, this.defenseWalls, this.blastGates, a.climbY, this.interiorDoors);
      }
    }

    this.fpVaultActive = false;
    this.fpVaultTimer = 0;
    this.fpGraceTimer = 2.5;
    this.fpSafeTimer = 0;
    if (!spawnPoint) this.windowBreachCooldown = 2.4;

    const wp = this.computeEscapeWaypoint(player.x, player.z, player.climbY);
    const resumeKillReward = this.firstPerson.playerId === player.id && this.firstPerson.weapon?.id === weaponId;
    this.firstPerson = {
      active: true,
      playerId: player.id,
      role,
      weapon: weaponId ? {
        id: weaponId, ammo: PLAYER_WEAPONS[weaponId].capacity, reserve: PLAYER_WEAPONS[weaponId].reserve,
        cooldown: 0, reloadTimer: 0, shots: 0, lastHit: false, hitTimer: 0
      } : null,
      mission: null,
      killRewardProgress: resumeKillReward ? this.firstPerson.killRewardProgress : 0,
      killRewardAmmo: resumeKillReward ? this.firstPerson.killRewardAmmo : 0,
      yaw: initialYaw,
      pitch: 0,
      stamina: 100,
      maxStamina: 100,
      sprinting: false,
      nearestZombieDist: 999,
      nearbyGateId: null,
      wallLadder: null,
      nearbyDoorId: null,
      insideBuildingId: null,
      pursuers: 0,
      shoveCooldown: 0,
      decoyCooldown: 0,
      adrenalineTimer: 0,
      vaultY: 0,
      vaultRoll: 0,
      nearbyVaultLabel: null,
      nearbyCarId: null,
      nearbyPickupId: null,
      nearbyAmmoId: null,
      nearbyTrainDoorId: null,
      nearbyKtxGate: null,
      nearTrainCabinConsole: false,
      insideTrainCar: 0,
      waypointX: wp.x,
      waypointZ: wp.z,
      waypointLabel: wp.label,
      spawnLabel,
      outcome: 'PLAYING',
      survivalTime: 0
    };

    return player;
  }

  public exitFirstPerson(): void {
    if (this.firstPerson.playerId !== null) {
      const player = this.getAgentById(this.firstPerson.playerId);
      if (player) {
        this.leavePlayerWall(player);
        player.isPlayerControlled = false;
        if (player.role === 'police') {
          player.targetAgentId = null;
          player.path = [];
          player.pathIndex = 0;
        }
      }
    }
    this.fpVaultActive = false;
    this.firstPerson.active = false;
    this.firstPerson.outcome = null;
  }

  public updateFirstPersonPlayer(
    dt: number,
    moveForward: number,
    moveRight: number,
    wantSprint: boolean,
    interactPressed: boolean,
    spacePressed: boolean,
    decoyPressed: boolean,
    yaw: number,
    pitch: number,
    actions?: { fire: boolean; reload: boolean; requestMission: boolean }
  ): AgentData | null {
    if (!this.firstPerson.active || this.firstPerson.playerId === null) return null;
    const player = this.getAgentById(this.firstPerson.playerId);
    if (!player) return null;

    this.firstPerson.yaw = yaw;
    this.firstPerson.pitch = pitch;

    if (this.firstPerson.outcome !== 'PLAYING') return player;
    if (!player.isAlive || player.role === 'infected' || player.civState === 'CONVULSING') {
      this.firstPerson.outcome = 'INFECTED';
      return player;
    }

    if (this.ridingKtx(player)) {
      this.updatePlayerDuringTrainRide(player, dt, moveForward, moveRight, interactPressed, actions);
      return player;
    }

    if (this.expressTrain.playerDeparting) {
      this.firstPerson.survivalTime += dt;
      this.firstPerson.insideTrainCar = this.expressTrain.playerInsideCar;
      this.firstPerson.nearbyTrainDoorId = null;
      this.firstPerson.nearbyKtxGate = null;
      this.firstPerson.nearTrainCabinConsole = false;
      this.firstPerson.nearbyPickupId = null;
      this.firstPerson.nearbyAmmoId = null;
      this.firstPerson.nearbyDoorId = null;
      this.firstPerson.nearbyGateId = null;
      this.firstPerson.nearbyCarId = null;
      this.firstPerson.nearbyVaultLabel = null;
      return player;
    }

    this.firstPerson.survivalTime += dt;
    if (this.firstPerson.shoveCooldown > 0) {
      this.firstPerson.shoveCooldown = Math.max(0, this.firstPerson.shoveCooldown - dt);
    }
    if (this.firstPerson.decoyCooldown > 0) {
      this.firstPerson.decoyCooldown = Math.max(0, this.firstPerson.decoyCooldown - dt);
    }
    if (this.firstPerson.adrenalineTimer > 0) {
      this.firstPerson.adrenalineTimer = Math.max(0, this.firstPerson.adrenalineTimer - dt);
    }

    if (!this.fpVaultActive && this.updatePlayerWall(player, dt, moveForward, moveRight, interactPressed, actions)) {
      return player;
    }

    if (this.fpVaultActive) {
      this.fpVaultTimer += dt;
      const t = Math.min(1, this.fpVaultTimer / this.fpVaultDuration);
      player.x = this.fpVaultStartX + (this.fpVaultEndX - this.fpVaultStartX) * t;
      player.z = this.fpVaultStartZ + (this.fpVaultEndZ - this.fpVaultStartZ) * t;
      player.animPhase += 12 * dt;
      this.firstPerson.vaultY = Math.sin(t * Math.PI) * this.fpVaultPeakY;
      this.firstPerson.vaultRoll = Math.sin(t * Math.PI) * 0.085;
      if (t >= 1) {
        this.fpVaultActive = false;
        this.firstPerson.vaultY = 0;
        this.firstPerson.vaultRoll = 0;
        this.firstPerson.adrenalineTimer = Math.max(this.firstPerson.adrenalineTimer, 1.2);
        resolveWorldCollisions(player, 0.68, this.city, this.defenseWalls, this.blastGates, 0, this.interiorDoors);
        this.resolveTrainCollisions(player, 0.62);
      }
    } else {
      const isMoving = moveForward !== 0 || moveRight !== 0;
      const unlimitedStamina = this.firstPerson.adrenalineTimer > 0;
      if (wantSprint && isMoving && (unlimitedStamina || this.firstPerson.stamina > 2)) {
        this.firstPerson.sprinting = true;
        if (!unlimitedStamina) {
          this.firstPerson.stamina = Math.max(0, this.firstPerson.stamina - dt * 13);
        }
      } else {
        this.firstPerson.sprinting = false;
        const recRate = isMoving ? 22 : 34;
        this.firstPerson.stamina = Math.min(100, this.firstPerson.stamina + dt * recRate);
      }

      const speedScale = this.firstPerson.role === 'swat' ? 0.82 : this.firstPerson.role === 'police' ? 0.92 : 1;
      const baseSpeed = (this.firstPerson.sprinting ? 8.5 : 5.2) * speedScale;
      const rushMult = unlimitedStamina ? 1.18 : 1.0;
      const speed = baseSpeed * rushMult * (player.stunnedTimer > 0 ? 0.65 : 1.0);
      if (isMoving) {
        const fX = -Math.sin(yaw);
        const fZ = -Math.cos(yaw);
        const rX = Math.cos(yaw);
        const rZ = -Math.sin(yaw);
        let dx = fX * moveForward + rX * moveRight;
        let dz = fZ * moveForward + rZ * moveRight;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;

        player.vx = dx * speed;
        player.vz = dz * speed;
        const oldX = player.x, oldZ = player.z;
        player.x += player.vx * dt;
        player.z += player.vz * dt;
        player.rotationY = Math.atan2(dx, dz);
        player.animPhase += speed * dt * 3.2;

        if (!(this.layeredKtx && ktxContains(oldX, oldZ))) {
          resolveWorldCollisions(player, 0.68, this.city, this.defenseWalls, this.blastGates, player.climbY, this.interiorDoors);
        }
        if (!this.layeredKtx || player.climbY >= KTX_PLATFORM_Y - 0.4) this.resolveTrainCollisions(player, 0.62);
        this.constrainKtxMove(player, oldX, oldZ);
        const boundX = this.city.cityHalfX + 4;
        const boundZ = this.city.cityHalfZ + 4;
        player.x = Math.max(-boundX, Math.min(boundX, player.x));
        player.z = Math.max(-boundZ, Math.min(boundZ, player.z));
      } else {
        player.vx = 0;
        player.vz = 0;
      }

      // Prevent agents & vehicles from clipping into first-person camera near plane
      for (let i = 0; i < this.agents.length; i++) {
        const other = this.agents[i];
        if (!other.isAlive || other.isTrainPassenger || other.id === player.id || other.civState === 'SHELTERED' ||
            Math.abs(player.climbY - other.climbY - other.fallY) > 1.3) continue;
        const minGap =
          other.role === 'infected'
            ? other.zombieVariant === 'brute'
              ? 2.18
              : 1.88
            : 1.35;
        const dx = other.x - player.x;
        const dz = other.z - player.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.001 && dist < minGap) {
          const oldX = other.x, oldZ = other.z;
          const push = (minGap - dist) / dist;
          other.x += dx * push;
          other.z += dz * push;
          this.constrainKtxMove(other, oldX, oldZ);
        }
      }
      for (let i = 0; player.climbY < 0.6 && i < this.vehicles.length; i++) {
        const v = this.vehicles[i];
        const dx = player.x - v.x;
        const dz = player.z - v.z;
        const dist = Math.hypot(dx, dz);
        const minCarGap = v.type === 'truck' ? 3.4 : 2.65;
        if (dist > 0.001 && dist < minCarGap) {
          const push = (minCarGap - dist) / dist;
          player.x += dx * push;
          player.z += dz * push;
        }
      }
    }

    // Check Parkour Vault target ahead
    const vaultTarget = !this.fpVaultActive && !(this.layeredKtx && player.z >= 156)
      ? this.findVaultTarget(player, yaw) : null;
    this.firstPerson.nearbyVaultLabel = vaultTarget ? vaultTarget.label : null;

    if (spacePressed && !this.fpVaultActive) {
      if (vaultTarget) {
        this.fpVaultActive = true;
        this.fpVaultTimer = 0;
        this.fpVaultStartX = player.x;
        this.fpVaultStartZ = player.z;
        this.fpVaultEndX = vaultTarget.endX;
        this.fpVaultEndZ = vaultTarget.endZ;
        this.fpVaultPeakY = vaultTarget.peakY;
        this.firstPerson.stamina = Math.max(0, this.firstPerson.stamina - 10);
        if (this.onSound) this.onSound('body_thud', player.x, player.z);
      } else if (this.firstPerson.shoveCooldown <= 0) {
        // Emergency Shove: clear up to 3 infected around/ahead + escape grapple
        this.firstPerson.shoveCooldown = 1.6;
        this.fpGraceTimer = Math.max(this.fpGraceTimer, 0.55);
        this.firstPerson.stamina = Math.max(0, this.firstPerson.stamina - 12);
        this.releaseGrapple(player);
        const fX = -Math.sin(yaw);
        const fZ = -Math.cos(yaw);
        const near = this.spatial.queryRadius(player.x, player.z, 3.6, this.neighborBuffer);
        let shoved = 0;
        for (let i = 0; i < near.length && shoved < 3; i++) {
          const z = near[i];
          if (!z.isAlive || z.role !== 'infected' || z.climbY + z.fallY > 1.3) continue;
          const dx = z.x - player.x;
          const dz = z.z - player.z;
          const d = Math.hypot(dx, dz) || 0.01;
          const dot = (dx / d) * fX + (dz / d) * fZ;
          if (d < 1.85 || dot > 0.15) {
            this.releaseGrapple(z);
            const oldX = z.x, oldZ = z.z;
            z.x += (dx / d) * 3.6;
            z.z += (dz / d) * 3.6;
            z.stunnedTimer = Math.max(z.stunnedTimer, 1.55);
            resolveWorldCollisions(z, 0.55, this.city, this.defenseWalls, this.blastGates, z.climbY, this.interiorDoors);
            this.constrainKtxMove(z, oldX, oldZ);
            shoved++;
          }
        }
        this.pushEffect({
          type: 'door_pound',
          x: player.x + fX * 1.1,
          y: 1.2,
          z: player.z + fZ * 1.1,
          age: 0,
          duration: 0.42
        });
        if (this.onSound) this.onSound('body_thud', player.x, player.z);
      }
    }

    if (decoyPressed && this.firstPerson.decoyCooldown <= 0) {
      this.firstPerson.decoyCooldown = 8.0;
      const fX = -Math.sin(yaw);
      const fZ = -Math.cos(yaw);
      let dxPos = player.x + fX * 15.0;
      let dzPos = player.z + fZ * 15.0;
      const boundX = this.city.cityHalfX - 2;
      const boundZ = this.city.cityHalfZ - 2;
      dxPos = Math.max(-boundX, Math.min(boundX, dxPos));
      dzPos = Math.max(-boundZ, Math.min(boundZ, dzPos));
      this.lureFlares.push({
        id: this.nextEntityId++,
        x: dxPos,
        z: dzPos,
        radius: 24,
        remaining: 9.5,
        maxDuration: 9.5,
        active: true
      });
      if (this.onSound) this.onSound('window_shatter', dxPos, dzPos);
      this.triggerAlert('🍾 NOISE DECOY THROWN — Luring nearby infected!', 'info');
    }

    let insideId: string | null = null;
    const nearBlds = this.city.getBuildingsNearPos(player.x, player.z, this.buildingBuffer);
    for (let bi = 0; bi < nearBlds.length; bi++) {
      const b = nearBlds[bi];
      if (
        b.interior &&
        player.x > b.minX &&
        player.x < b.maxX &&
        player.z > b.minZ &&
        player.z < b.maxZ
      ) {
        insideId = b.id;
        break;
      }
    }
    this.firstPerson.insideBuildingId = insideId;

    let nearPickupId: number | null = null;
    let bestPickupDist = 2.6;
    for (let pi = 0; pi < this.supplyPickups.length; pi++) {
      const p = this.supplyPickups[pi];
      if (p.collected) continue;
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d < bestPickupDist) {
        bestPickupDist = d;
        nearPickupId = p.id;
      }
    }
    this.firstPerson.nearbyPickupId = nearPickupId;

    let nearDoorId: number | null = null;
    let bestDoorDist = 3.2;
    for (let di = 0; di < this.interiorDoors.length; di++) {
      const door = this.interiorDoors[di];
      if (door.isBroken) continue;
      const d = Math.hypot(door.x - player.x, door.z - player.z);
      if (d < bestDoorDist) {
        bestDoorDist = d;
        nearDoorId = door.id;
      }
    }
    this.firstPerson.nearbyDoorId = nearDoorId;

    // Check nearest Blast Gate within 11 units for [E] toggle
    let nearGateId: number | null = null;
    let bestGateDist = 11.0;
    for (let i = 0; i < this.blastGates.length; i++) {
      const g = this.blastGates[i];
      if (g.breached) continue;
      const d = Math.hypot(g.x - player.x, g.z - player.z);
      if (d < bestGateDist) {
        bestGateDist = d;
        nearGateId = g.id;
      }
    }
    this.firstPerson.nearbyGateId = nearGateId;

    let nearCarId: number | null = null;
    let bestCarDist = 3.8;
    const obsBuf: typeof this.city.staticObstacles = [];
    const carCandidates = this.city.getObstaclesNearPos(player.x, player.z, obsBuf, 4.2);
    for (let ci = 0; ci < carCandidates.length; ci++) {
      const obs = carCandidates[ci];
      if (obs.kind !== 'car' && obs.kind !== 'taxi' && obs.kind !== 'van') continue;
      if (this.carAlarms.has(obs.id)) continue;
      const d = Math.hypot(obs.x - player.x, obs.z - player.z);
      if (d < bestCarDist) {
        bestCarDist = d;
        nearCarId = obs.id;
      }
    }
    this.firstPerson.nearbyCarId = nearCarId;

    const currentCar = this.getTrainCarForPos(player.x, player.z, player.climbY);
    this.firstPerson.insideTrainCar = currentCar;
    this.expressTrain.playerInsideCar = currentCar;
    if (this.expressTrain.state === 'DOCKED') {
      this.expressTrain.currentLoad = this.trainPassengers.size + (currentCar ? 1 : 0);
      if (this.dispatchExpressTrainIfReady(currentCar)) return player;
    }

    let nearTrainDoorId: number | null = null;
    let bestTrainDoorDist = 2.65;
    if (currentCar > 0) {
      for (let tdi = 0; tdi < this.expressTrain.doors.length; tdi++) {
        const td = this.expressTrain.doors[tdi];
        if (td.isBroken) continue;
        const d = Math.hypot(player.x - (this.expressTrain.x + td.localX), player.z - this.expressTrain.z);
        if (d < bestTrainDoorDist) {
          bestTrainDoorDist = d;
          nearTrainDoorId = td.id;
        }
      }
    }
    this.firstPerson.nearbyTrainDoorId = nearTrainDoorId;
    const stationGate = this.layeredKtx ? KTX_GATE_IDS.find((id) => {
      const box = ktxGateBox(id);
      return this.ktxGates[id].integrity > 0 && Math.abs(player.climbY - box.y) < 1.1 &&
        Math.abs(player.x - box.x) < box.width / 2 + 1.8 && Math.abs(player.z - box.z) < box.depth / 2 + 1.6;
    }) : undefined;
    this.firstPerson.nearbyKtxGate = stationGate ?? null;

    const nearCabinConsole =
      this.expressTrain.active &&
      this.expressTrain.state === 'DOCKED' &&
      currentCar === 1 &&
      Math.hypot(
        player.x - (this.expressTrain.x + this.expressTrain.cabinSwitchLocalX),
        player.z - this.expressTrain.z
      ) < 3.4;
    this.firstPerson.nearTrainCabinConsole = nearCabinConsole;

    const ammoUsed = this.updateAmmoInteraction(player, interactPressed);
    if (interactPressed && !ammoUsed) {
      if (stationGate) {
        const gate = this.ktxGates[stationGate];
        gate.manualUntil = this.simTime + 18;
        this.setKtxGate(stationGate, !gate.open);
        return player;
      }
      if (nearCabinConsole) {
        this.departExpressTrain('manual', currentCar);
        return player;
      } else if (nearTrainDoorId !== null) {
        const td = this.expressTrain.doors.find((d) => d.id === nearTrainDoorId && !d.isBroken);
        if (td) {
          td.manualUntil = this.simTime + 5;
          this.setTrainBulkhead(td, !td.isLocked);
          if (td.isLocked) {
            this.resolveTrainCollisions(player, 0.62);
          }
        }
      } else if (nearPickupId !== null) {
        const pickup = this.supplyPickups.find((p) => p.id === nearPickupId && !p.collected);
        if (pickup) {
          pickup.collected = true;
          if (pickup.kind === 'energy_drink') {
            this.firstPerson.stamina = 100;
            this.firstPerson.adrenalineTimer = 8.0;
            if (this.onSound) this.onSound('cure', pickup.x, pickup.z);
            this.triggerAlert('⚡ ENERGY DRINK: 8s Unlimited Sprint Surge!', 'info');
          } else if (pickup.kind === 'antiviral_kit') {
            player.health = Math.min(player.maxHealth, player.health + 65);
            player.isIncubating = false;
            player.incubationTimer = 0;
            player.biteCount = 0;
            if (this.onSound) this.onSound('cure', pickup.x, pickup.z);
            this.triggerAlert('💉 ANTIVIRAL MEDKIT: +65 HP & Infection Cured!', 'info');
          } else {
            player.health = Math.min(player.maxHealth, player.health + 40);
            this.firstPerson.stamina = Math.min(100, this.firstPerson.stamina + 60);
            this.firstPerson.decoyCooldown = 0;
            if (this.onSound) this.onSound('cure', pickup.x, pickup.z);
            this.triggerAlert('🎒 EMERGENCY PACK: +40 HP • +60 Stamina • Decoy Refreshed!', 'info');
          }
        }
      } else if (nearDoorId !== null) {
        const door = this.interiorDoors.find((d) => d.id === nearDoorId);
        if (door && !door.isBroken) {
          door.isLocked = !door.isLocked;
          if (this.onSound) this.onSound('gate_slam', door.x, door.z);
          if (door.isLocked) {
            resolveWorldCollisions(
              player,
              0.68,
              this.city,
              this.defenseWalls,
              this.blastGates,
              0,
              this.interiorDoors
            );
          }
        }
      } else if (nearGateId !== null) {
        this.toggleBlastGate(nearGateId);
      } else if (nearCarId !== null) {
        const car = carCandidates.find((o) => o.id === nearCarId);
        if (car) {
          this.carAlarms.set(car.id, {
            x: car.x,
            z: car.z,
            remaining: 18,
            beepTimer: 0.1
          });
          if (this.onSound) this.onSound('car_alarm', car.x, car.z);
          this.triggerAlert('🚨 CAR ALARM TRIGGERED — Distracting nearby horde!', 'warn');
        }
      }
    }

    // Check nearest zombie distance, pursuer count & out-of-combat light recovery
    const nearZ = this.spatial.queryRadius(player.x, player.z, 32, this.neighborBuffer);
    let minZDist = 999;
    let pursuers = 0;
    for (let i = 0; i < nearZ.length; i++) {
      const other = nearZ[i];
      if (other.isAlive && other.role === 'infected') {
        const d = Math.hypot(other.x - player.x, other.z - player.z);
        if (d < minZDist) minZDist = d;
        if (other.targetAgentId === player.id) pursuers++;
      }
    }
    this.firstPerson.nearestZombieDist = minZDist;
    this.firstPerson.pursuers = pursuers;

    if (minZDist > 9.5 && !player.isIncubating && player.health < 70) {
      this.fpSafeTimer += dt;
      if (this.fpSafeTimer >= 3.5) {
        player.health = Math.min(70, player.health + dt * 3.0);
      }
    } else {
      this.fpSafeTimer = 0;
    }

    if (this.firstPerson.weapon) {
      this.updatePlayerWeapon(player, dt, actions?.fire ?? false, actions?.reload ?? false);
      this.updatePlayerMission(player, dt, actions?.requestMission ?? false);
    } else {
      const wp = this.computeEscapeWaypoint(player.x, player.z, player.climbY);
      this.firstPerson.waypointX = wp.x;
      this.firstPerson.waypointZ = wp.z;
      this.firstPerson.waypointLabel = wp.label;
    }

    // Call the next train sooner when the player is waiting near the station.
    if (this.expressTrain.active) {
      const distStation = Math.hypot(
        player.x - this.expressTrain.stationX,
        player.z - (this.expressTrain.stationZ - 5.5)
      );
      if (distStation <= 18.0 && this.expressTrain.state === 'COOLDOWN' && this.expressTrain.timer > 2.5) {
        this.expressTrain.timer = 2.5;
        this.triggerAlert('🚄 EMERGENCY EXPRESS DISPATCHED — Train arriving in 7.5s!', 'info');
      }
    }

    const ez = this.findNearestEvacZone(player.x, player.z, 20);
    if (this.firstPerson.role === 'civilian' && ez && Math.hypot(player.x - ez.x, player.z - ez.z) <= ez.radius) {
      player.isEvacuated = true;
      ez.extractedCount++;
      this.totalEvacuated++;
      this.firstPerson.outcome = 'ESCAPED';
      this.logAgentAction(player, `Escaped via Evacuation Perimeter!`);
    }

    return player;
  }

  private nearestPlayerLadder(player: AgentData, range: number): { wall: DefenseWallData; x: number } | null {
    let nearest = range;
    let result: { wall: DefenseWallData; x: number } | null = null;
    const deck = this.fpWallDeck;
    for (const wall of this.defenseWalls) {
      if (deck && wall !== deck.wall) continue;
      const z = deck ? wall.z + 0.45 : ladderZ(wall) + 0.54;
      if (!deck && player.z < wall.z + wall.thickness / 2) continue;
      const gateLadders = this.blastGates.filter((gate) => gate.wallId === wall.id).flatMap((gate) => wallLadderXs(gate.x));
      for (const x of [...gateLadders, ...wall.retreatLadderXs]) {
        if (deck && (x < deck.minX || x > deck.maxX)) continue;
        const distance = Math.hypot(player.x - x, player.z - z);
        if (distance < nearest) {
          nearest = distance;
          result = { wall, x };
        }
      }
    }
    return result;
  }

  private leavePlayerWall(player: AgentData): void {
    const ladder = this.fpLadderTravel ?? (this.fpWallDeck ? this.nearestPlayerLadder(player, Infinity) : null);
    if (ladder) {
      player.x = ladder.x;
      player.z = ladderZ(ladder.wall) + 0.9;
      player.climbY = 0;
      player.onWallDeck = false;
      resolveWorldCollisions(player, 0.68, this.city, this.defenseWalls, this.blastGates, 0, this.interiorDoors);
    }
    this.fpWallDeck = null;
    this.fpLadderTravel = null;
    this.firstPerson.wallLadder = null;
  }

  private updatePlayerWall(
    player: AgentData, dt: number, forward: number, right: number, interact: boolean,
    actions?: { fire: boolean; reload: boolean; requestMission: boolean }
  ): boolean {
    const fp = this.firstPerson;
    const deck = this.fpWallDeck;
    if (!this.fpLadderTravel) {
      const ladder = this.nearestPlayerLadder(player, deck ? 1.3 : 1.9);
      fp.wallLadder = ladder ? (deck ? 'down' : 'up') : null;
      if (ladder && interact) {
        this.releaseGrapple(player);
        player.onWallDeck = false;
        this.fpLadderTravel = { ...ladder, progress: 0, ascending: !deck, startX: player.x, startZ: player.z };
      }
    }
    const travel = this.fpLadderTravel;
    if (!travel && !deck) return false;
    this.clearGroundInteractionsForWall();
    fp.sprinting = false;
    player.vx = 0;
    player.vz = 0;

    if (travel) {
      const { wall, x, ascending, startX, startZ } = travel;
      const groundZ = ladderZ(wall);
      const topZ = wall.z + 0.45;
      const deckY = wall.height + WALL_DECK_RISE;
      travel.progress = Math.min(1, travel.progress + dt / (deckY / 2.3 + 0.55));
      const mount = Math.min(1, travel.progress / 0.12);
      const climb = Math.max(0, Math.min(1, (travel.progress - 0.12) / 0.76));
      const exit = Math.max(0, (travel.progress - 0.88) / 0.12);
      player.x = startX + (x - startX) * mount;
      player.z = startZ + (groundZ - startZ) * mount + ((ascending ? topZ : groundZ + 0.7) - groundZ) * exit;
      player.climbY = deckY * (ascending ? climb : 1 - climb);
      fp.wallLadder = 'climbing';
      if (travel.progress === 1) {
        const span = ascending ? wallDeckSpan(wall, this.blastGates, x) : null;
        this.fpWallDeck = span ? { wall, ...span } : null;
        this.fpLadderTravel = null;
        player.onWallDeck = this.fpWallDeck !== null;
        fp.wallLadder = ascending ? 'down' : 'up';
        if (!ascending) resolveWorldCollisions(player, 0.68, this.city, this.defenseWalls, this.blastGates, 0, this.interiorDoors);
      }
    } else if (deck) {
      const speed = player.stunnedTimer > 0 ? 2 : 4.2;
      const length = Math.hypot(forward, right) || 1;
      const dx = (-Math.sin(fp.yaw) * forward + Math.cos(fp.yaw) * right) / length;
      const dz = (-Math.cos(fp.yaw) * forward - Math.sin(fp.yaw) * right) / length;
      player.x = Math.max(deck.minX, Math.min(deck.maxX, player.x + dx * speed * dt));
      player.z = Math.max(wallDeckFrontZ(deck.wall), Math.min(deck.wall.z + 0.85, player.z + dz * speed * dt));
      if (forward || right) {
        player.vx = dx * speed;
        player.vz = dz * speed;
        player.rotationY = Math.atan2(dx, dz);
        player.animPhase += speed * dt * 3;
      }
    }

    fp.nearestZombieDist = 999;
    fp.pursuers = 0;
    for (const infected of this.spatial.queryRadius(player.x, player.z, 32, this.neighborBuffer)) {
      if (!infected.isAlive || infected.role !== 'infected') continue;
      const distance = Math.hypot(player.x - infected.x, player.z - infected.z, player.climbY - infected.climbY - infected.fallY);
      fp.nearestZombieDist = Math.min(fp.nearestZombieDist, distance);
      if (infected.targetAgentId === player.id) fp.pursuers++;
    }
    if (fp.weapon) {
      if (!travel) this.updateAmmoInteraction(player, interact);
      this.updatePlayerWeapon(player, dt, !travel && (actions?.fire ?? false), actions?.reload ?? false);
      if (!travel) this.updatePlayerMission(player, dt, actions?.requestMission ?? false);
    }
    return true;
  }

  private clearGroundInteractionsForWall(): void {
    const fp = this.firstPerson;
    fp.insideBuildingId = null;
    fp.insideTrainCar = 0;
    fp.nearbyVaultLabel = null;
    fp.nearbyPickupId = null;
    fp.nearbyAmmoId = null;
    fp.nearbyDoorId = null;
    fp.nearbyGateId = null;
    fp.nearbyCarId = null;
    fp.nearbyTrainDoorId = null;
    fp.nearbyKtxGate = null;
    fp.nearTrainCabinConsole = false;
  }

  public findNearestAmmoCache(player: AgentData, readyOnly = false, range = Infinity): AmmoCacheData | null {
    let nearest = range;
    let result: AmmoCacheData | null = null;
    for (const cache of this.ammoCaches) {
      if (Math.abs(player.climbY - cache.y) > 0.9 || (readyOnly && cache.readyAt > this.simTime)) continue;
      if (this.fpWallDeck) {
        if (cache.x < this.fpWallDeck.minX || cache.x > this.fpWallDeck.maxX ||
            Math.abs(cache.z - this.fpWallDeck.wall.z) > 1) continue;
      } else if (!this.isSameMissionSector(player.z, cache.z)) continue;
      const distance = Math.hypot(player.x - cache.x, player.z - cache.z);
      if (distance < nearest) {
        nearest = distance;
        result = cache;
      }
    }
    return result;
  }

  private updateAmmoInteraction(player: AgentData, interact: boolean): boolean {
    const fp = this.firstPerson;
    const weapon = fp.weapon;
    const cache = weapon ? this.findNearestAmmoCache(player, false, 2.5) : null;
    fp.nearbyAmmoId = cache?.id ?? null;
    if (!weapon || !cache || !interact || cache.readyAt > this.simTime) return false;
    const loadout = PLAYER_WEAPONS[weapon.id];
    if (weapon.ammo === loadout.capacity && weapon.reserve === loadout.reserve) return false;
    weapon.ammo = loadout.capacity;
    weapon.reserve = loadout.reserve;
    weapon.reloadTimer = 0;
    cache.readyAt = this.simTime + AMMO_CACHE_COOLDOWN;
    this.onSound?.('player_reload', player.x, player.z);
    this.triggerAlert('AMMUNITION RESTOCKED', 'info');
    return true;
  }

  private updatePlayerDuringTrainRide(
    player: AgentData, dt: number, forward: number, right: number, interact: boolean,
    actions?: { fire: boolean; reload: boolean }
  ): void {
    const fp = this.firstPerson;
    const tr = this.expressTrain;
    fp.survivalTime += dt;
    fp.sprinting = false;
    fp.stamina = Math.min(fp.maxStamina, fp.stamina + 22 * dt);
    fp.nearbyKtxGate = null;
    fp.nearTrainCabinConsole = false;
    fp.nearbyPickupId = null;
    fp.nearbyAmmoId = null;
    fp.nearbyDoorId = null;
    fp.nearbyGateId = null;
    fp.nearbyCarId = null;
    fp.nearbyVaultLabel = null;
    fp.wallLadder = null;
    fp.insideBuildingId = null;
    player.vx = player.vz = 0;
    const inputLength = Math.hypot(forward, right);
    if (inputLength > 0 && player.pinnedById === null) {
      const speed = player.stunnedTimer > 0 ? 2.1 : 4.6;
      const fromX = player.x, fromZ = player.z;
      player.vx = speed * (-Math.sin(fp.yaw) * forward + Math.cos(fp.yaw) * right) / inputLength;
      player.vz = speed * (-Math.cos(fp.yaw) * forward - Math.sin(fp.yaw) * right) / inputLength;
      player.x += player.vx * dt;
      player.z += player.vz * dt;
      this.resolveTrainCollisions(player, 0.62);
      if (!this.getTrainCarForAgent(player)) {
        player.x = fromX;
        player.z = fromZ;
      }
      player.animPhase += speed * dt * 3.2;
    }
    fp.insideTrainCar = tr.playerInsideCar = this.getTrainCarForAgent(player);
    const door = tr.doors.find((d) => !d.isBroken &&
      Math.hypot(player.x - tr.x - d.localX, player.z - tr.z) <= 2.65);
    fp.nearbyTrainDoorId = door?.id ?? null;
    if (door && interact) {
      door.manualUntil = this.simTime + 5;
      this.setTrainBulkhead(door, !door.isLocked);
      if (door.isLocked) this.resolveTrainCollisions(player, 0.62);
    }
    if (fp.weapon) this.updatePlayerWeapon(player, dt, actions?.fire ?? false, actions?.reload ?? false);
  }

  private updatePlayerWeapon(player: AgentData, dt: number, fire: boolean, reload: boolean): void {
    const state = this.firstPerson.weapon!;
    const weapon = PLAYER_WEAPONS[state.id];
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.hitTimer = Math.max(0, state.hitTimer - dt);
    if (state.reloadTimer > 0) {
      state.reloadTimer = Math.max(0, state.reloadTimer - dt);
      if (state.reloadTimer === 0) {
        const rounds = Math.min(state.reserve, weapon.capacity - state.ammo);
        state.ammo += rounds;
        state.reserve -= rounds;
        this.claimKillRewardAmmo();
      }
      return;
    }
    if ((reload || (fire && state.ammo === 0)) && state.ammo < weapon.capacity && state.reserve > 0) {
      state.reloadTimer = weapon.reload;
      this.onSound?.('player_reload', player.x, player.z);
      return;
    }
    if (!fire || state.cooldown > 0 || state.ammo === 0 || this.fpVaultActive || player.stunnedTimer > 0) return;

    const fp = this.firstPerson;
    const eyeY = 1.68 + player.climbY + fp.vaultY;
    const nearby = this.spatial.queryRadius(player.x, player.z, weapon.range, this.neighborBuffer);
    const spread = state.id === 'shotgun' ? SHOTGUN_PATTERN : CENTER_SHOT;
    const damageByTarget = new Map<AgentData, number>();
    for (const [yawOffset, pitchOffset] of spread) {
      const trace = new ShotTrace(player.x, eyeY, player.z, fp.yaw + yawOffset, fp.pitch + pitchOffset, weapon.range);
      trace.traceCity(this.city, this.defenseWalls, this.blastGates, this.interiorDoors, this.vehicles);
      this.traceRailAndStationCover(trace);
      for (const infected of nearby) {
        if (!infected.isAlive || infected.role !== 'infected') continue;
        const distance = Math.hypot(infected.x - player.x, infected.z - player.z);
        if (distance > trace.distance + 1.15) continue;
        const brute = infected.zombieVariant === 'brute';
        const radius = brute ? 0.64 : 0.42;
        const baseY = infected.climbY + infected.fallY;
        const downed = infected.stunnedTimer > 0 && infected.fallY < 0.25;
        trace.testBox(
          infected.x - radius, infected.x + radius, baseY + 0.15,
          baseY + (brute ? 2.9 : downed ? 1.7 : 2.15), infected.z - radius, infected.z + radius,
          'infected', infected
        );
      }
      if (trace.target) {
        const falloff = state.id === 'shotgun' ? Math.max(0.35, 1 - trace.distance / 25) : 1;
        const damage = weapon.damage / spread.length * falloff;
        damageByTarget.set(trace.target, (damageByTarget.get(trace.target) ?? 0) + damage);
      }
      const direction = trace.ray.direction;
      this.effects.push({
        type: 'player_shot', x: player.x, y: eyeY, z: player.z,
        targetX: player.x + direction.x * trace.distance,
        targetY: eyeY + direction.y * trace.distance,
        targetZ: player.z + direction.z * trace.distance,
        impact: trace.surface, age: 0, duration: 0.34
      });
    }

    state.ammo--;
    state.cooldown = weapon.interval;
    state.shots++;
    state.lastHit = damageByTarget.size > 0;
    if (state.lastHit) state.hitTimer = 0.18;
    this.onSound?.(`player_${state.id}`, player.x, player.z);
    for (const [target, damage] of damageByTarget) {
      this.damageInfected(player, target, damage);
    }
  }

  private recordPlayerKillReward(player: AgentData): void {
    const fp = this.firstPerson;
    if (!fp.active || fp.outcome !== 'PLAYING' || fp.playerId !== player.id || !player.isPlayerControlled || !fp.weapon) return;
    if (++fp.killRewardProgress < PLAYER_KILL_REWARD.kills) return;
    fp.killRewardProgress = 0;
    const rounds = PLAYER_WEAPONS[fp.weapon.id].capacity * PLAYER_KILL_REWARD.magazines;
    fp.killRewardAmmo += rounds;
    this.claimKillRewardAmmo();
    this.triggerAlert(`KILL REWARD: ${rounds} rounds earned`, 'info');
    this.onSound?.('radio', player.x, player.z);
  }

  private claimKillRewardAmmo(): void {
    const fp = this.firstPerson;
    if (!fp.weapon || fp.killRewardAmmo <= 0) return;
    const space = Math.max(0, PLAYER_WEAPONS[fp.weapon.id].reserve - fp.weapon.reserve);
    const rounds = Math.min(space, fp.killRewardAmmo);
    fp.weapon.reserve += rounds;
    fp.killRewardAmmo -= rounds;
  }

  private updatePlayerMission(player: AgentData, dt: number, request: boolean): void {
    const fp = this.firstPerson;
    if (request && this.config.allowPlayerIntervention) {
      const canRequestClear = !fp.mission || (fp.mission.complete && fp.mission.kind !== 'clear');
      const focus = canRequestClear
        ? this.spatial.queryRadius(player.x, player.z, 32, this.neighborBuffer)
            .filter((agent) => this.isMissionThreat(agent, player.x, player.z, player.climbY, 32))
            .sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))[0]
        : undefined;
      const zone = this.findReachableMissionPoint(player, focus);
      const targetIds = focus
        ? this.spatial.queryRadius(zone.x, zone.z, CLEAR_MISSION_RADIUS, this.neighborBuffer)
            .filter((agent) => this.isMissionThreat(agent, zone.x, zone.z, zone.y, CLEAR_MISSION_RADIUS))
            .sort((a, b) => Math.hypot(a.x - zone.x, a.z - zone.z) - Math.hypot(b.x - zone.x, b.z - zone.z))
            .slice(0, 3).map((agent) => agent.id)
        : [];
      const clear = targetIds.length > 0;
      fp.mission = {
        kind: clear ? 'clear' : 'hold',
        x: zone.x, y: zone.y, z: zone.z, district: this.city.getDistrictAtPos(zone.x, zone.z),
        remaining: clear ? 2 : 8, hostiles: targetIds.length, totalTargets: targetIds.length,
        targetIds, complete: false
      };
      this.onSound?.('radio', player.x, player.z);
    }

    const mission = fp.mission;
    if (!mission || mission.complete) return;
    const radius = mission.kind === 'clear' ? CLEAR_MISSION_RADIUS : HOLD_MISSION_RADIUS;
    if (mission.kind === 'clear') {
      mission.targetIds = mission.targetIds.filter((id) =>
        this.isMissionThreat(this.getAgentById(id), mission.x, mission.z, mission.y, radius));
      mission.hostiles = mission.targetIds.length;
    }
    if (Math.abs(player.climbY - mission.y) > 1.5 ||
        Math.hypot(player.x - mission.x, player.z - mission.z) > radius ||
        !this.isSameMissionSector(player.z, mission.z) ||
        mission.hostiles > 0) return;
    mission.remaining = Math.max(0, mission.remaining - dt);
    if (mission.remaining === 0) {
      mission.complete = true;
      const weapon = fp.weapon!;
      const loadout = PLAYER_WEAPONS[weapon.id];
      weapon.reserve = Math.min(loadout.reserve, weapon.reserve + loadout.capacity * 2);
      this.onSound?.('radio', player.x, player.z);
    }
  }

  private isMissionThreat(agent: AgentData | null, x: number, z: number, y: number, radius: number): agent is AgentData {
    return Boolean(agent?.isAlive && agent.role === 'infected' &&
      Math.abs(y - agent.climbY - agent.fallY) < 2 &&
      Math.hypot(agent.x - x, agent.z - z) <= radius &&
      this.isSameMissionSector(z, agent.z) &&
      hasLineOfSight(x, z, agent.x, agent.z, this.city, this.defenseWalls, this.blastGates, this.interiorDoors));
  }

  private isSameMissionSector(z1: number, z2: number): boolean {
    return !this.defenseWalls.some((wall) => (z1 < wall.z) !== (z2 < wall.z));
  }

  private findReachableMissionPoint(player: AgentData, focus?: AgentData): { x: number; y: number; z: number } {
    if (this.fpWallDeck) {
      const { minX, maxX } = this.fpWallDeck;
      const forward = -Math.sin(this.firstPerson.yaw);
      const x = focus?.x ?? player.x + (forward < 0 ? -11 : 11);
      return { x: Math.max(minX, Math.min(maxX, x)), y: player.climbY, z: player.z };
    }
    const desiredX = focus?.x ?? player.x - Math.sin(this.firstPerson.yaw) * 19;
    const desiredZ = focus?.z ?? player.z - Math.cos(this.firstPerson.yaw) * 19;
    const candidates = this.city.navNodes.filter((node) => {
      const range = Math.hypot(node.x - player.x, node.z - player.z);
      return range >= 7 && range <= 35 && this.isSameMissionSector(node.z, player.z);
    }).sort((a, b) => Math.hypot(a.x - desiredX, a.z - desiredZ) - Math.hypot(b.x - desiredX, b.z - desiredZ));
    for (const node of candidates.slice(0, 18)) {
      if (this.canWalkToMissionPoint(player, node)) {
        return { x: node.x, y: 0, z: node.z };
      }
    }
    return { x: player.x, y: player.climbY, z: player.z };
  }

  private canWalkToMissionPoint(from: Vec2, goal: Vec2): boolean {
    if (!hasLineOfSight(from.x, from.z, goal.x, goal.z, this.city, this.defenseWalls, this.blastGates, this.interiorDoors)) return false;
    const samples = Math.ceil(Math.hypot(goal.x - from.x, goal.z - from.z) / 1.6);
    const probe = { x: 0, z: 0 };
    for (let i = 1; i <= samples; i++) {
      const x = from.x + (goal.x - from.x) * i / samples;
      const z = from.z + (goal.z - from.z) * i / samples;
      probe.x = x;
      probe.z = z;
      resolveWorldCollisions(probe, 0.68, this.city, this.defenseWalls, this.blastGates, 0, this.interiorDoors);
      this.resolveTrainCollisions(probe, 0.62);
      if (Math.hypot(probe.x - x, probe.z - z) > 0.22) return false;
    }
    return true;
  }

  // ============================================================================
  // PLAYER TACTICAL COMMANDS, BLAST GATES & FRAG BOMB
  // ============================================================================

  public findGateAtPos(x: number, z: number, radius = 9.0): BlastGateData | null {
    let best: BlastGateData | null = null;
    let bestDist = radius;
    for (let i = 0; i < this.blastGates.length; i++) {
      const g = this.blastGates[i];
      const d = Math.hypot(g.x - x, g.z - z);
      if (d < bestDist) {
        bestDist = d;
        best = g;
      }
    }
    return best;
  }

  private findWallPost(x: number, z: number): { wall: DefenseWallData; x: number } | null {
    let result: { wall: DefenseWallData; x: number } | null = null;
    let closest = Infinity;
    for (const gate of this.blastGates) {
      if (Math.abs(z - gate.z) > 4) continue;
      const wall = this.defenseWalls.find((candidate) => candidate.id === gate.wallId)!;
      if (x < wall.minX || x > wall.maxX) continue;
      for (const postX of [wallPostX(gate.x), wallPostX(gate.x, true)]) {
        const distance = Math.abs(x - postX);
        if (distance < closest) {
          closest = distance;
          result = { wall, x: postX };
        }
      }
    }
    return result;
  }

  private getVacantWallSlots(wall: DefenseWallData, x: number): number[] {
    const occupied = new Set<number>();
    for (const [id, post] of this.wallAssignments) {
      if (post.wall === wall && post.x === x && this.getAgentById(id)?.isAlive) occupied.add(post.slot);
    }
    for (const [id, fallback] of this.fallbacks) {
      const post = fallback.nextWallPost;
      if (post?.wall === wall && post.x === x && this.getAgentById(id)?.isAlive) occupied.add(post.slot);
    }
    const gates = this.blastGates.filter((gate) => gate.wallId === wall.id);
    const count = gates.some((gate) => wallPostX(gate.x, true) === x) ? OUTER_GARRISON_SLOTS_PER_GATE
      : gates.length >= 2 ? WALL_GARRISON_SLOTS_PER_GATE : WALL_POST_SLOTS;
    return Array.from({ length: count }, (_, slot) => slot).filter((slot) => !occupied.has(slot));
  }

  public toggleBlastGate(gateId: number): boolean {
    const g = this.blastGates.find((bg) => bg.id === gateId);
    if (!g || g.breached) return false;
    this.guardSealedGates.delete(gateId);
    this.gateCooldown.set(gateId, this.simTime + 12);
    g.isOpen = !g.isOpen;
    const stateLabel = g.isOpen ? 'OPENING' : 'CLOSING';
    this.triggerAlert(`${g.label.toUpperCase()} ${stateLabel}!`, g.isOpen ? 'info' : 'warn');
    this.addEventLog('police', `BLAST GATE: ${g.label} ${stateLabel}.`, g.x, g.z);
    return true;
  }

  public deployFragBomb(x: number, z: number): boolean {
    if (!this.config.allowPlayerIntervention || this.commandPoints < 20) return false;
    this.commandPoints -= 20;

    this.effects.push({
      type: 'explosion',
      x,
      z,
      age: 0,
      duration: 0.75
    });
    if (this.onSound) this.onSound('explosion', x, z);

    let killed = 0;
    const hit = this.spatial.queryRadius(x, z, 12.0, this.neighborBuffer);
    for (let i = 0; i < hit.length; i++) {
      const a = hit[i];
      if (!a.isAlive || a.role !== 'infected') continue;
      a.health -= 260;
      if (!a.onTerminalFloor) a.climbY = 0;
      if (a.health <= 0) {
        a.isAlive = false;
        this.totalDeceased++;
        killed++;
      }
    }

    // Collapse any 3D Zombie Pyramid buckets within 14 units
    for (let wi = 0; wi < this.defenseWalls.length; wi++) {
      const w = this.defenseWalls[wi];
      if (Math.abs(z - w.z) <= 14.0) {
        for (let b = 0; b < w.pyramidHeights.length; b++) {
          const bx = w.minX + (b + 0.5) * w.bucketSize;
          if (Math.hypot(bx - x, w.z - z) <= 14.0) {
            w.pyramidHeights[b] = 0;
          }
        }
      }
    }

    const district = this.city.getDistrictAtPos(x, z);
    this.addEventLog(
      'police',
      `FRAG STRIKE: Explosive charge eliminated ${killed} infected & collapsed pyramid in ${district}!`,
      x,
      z
    );
    return true;
  }

  public deployPoliceSquad(x: number, z: number): boolean {
    if (!this.config.allowPlayerIntervention || this.commandPoints < 20) return false;
    const targetNode = this.policeDeploymentPoint(x, z);
    if (!this.canReinforceAt(z) || !this.canReinforceAt(targetNode.z - 1)) {
      this.triggerAlert('NO REINFORCEMENTS BEYOND THE FALLEN LINE', 'warn');
      return false;
    }
    this.commandPoints -= 20;
    const district = this.city.getDistrictAtPos(x, z);

    for (let i = 0; i < 2; i++) {
      const officer = this.createAgent(
        'police',
        targetNode.x + (i === 0 ? -0.9 : 0.9),
        targetNode.z + (i === 0 ? -0.6 : 0.6),
        false
      );
      officer.policeState = 'HOLDING_POSITION';
      officer.assignedZonePos = { x: targetNode.x, z: targetNode.z };
      officer.destinationLabel = `Patrol Deploy (${district})`;
      this.logAgentAction(officer, `Deployed to ${district} by Tactical Command.`);
      this.pushAgent(officer);
    }

    if (this.onSound) this.onSound('radio', targetNode.x, targetNode.z);
    this.addEventLog(
      'police',
      `PATROL DEPLOY: 2 patrol officers deployed to ${district}.`,
      targetNode.x,
      targetNode.z
    );
    this.transmitRadio({ kind: 'dispatch', place: district, count: 2 });
    return true;
  }

  public deployHunterTeam(x: number, z: number): boolean {
    if (!this.config.allowPlayerIntervention || this.commandPoints < 45) return false;
    const point = this.policeDeploymentPoint(x, z);
    if (!this.canReinforceAt(z) || !this.canReinforceAt(point.z)) {
      this.triggerAlert('NO REINFORCEMENTS BEYOND THE FALLEN LINE', 'warn');
      return false;
    }
    this.commandPoints -= 45;
    for (const offset of [-0.95, 0.95]) {
      const officer = this.createAgent('police', point.x + offset, point.z, true);
      resolveWorldCollisions(officer, 0.65, this.city, this.defenseWalls, this.blastGates, 0, this.interiorDoors);
      officer.isHunter = true;
      officer.shirtColor = 0x8b5bb5;
      officer.destinationLabel = 'Hunter team searching';
      this.pushAgent(officer);
    }
    this.triggerAlert('Hunter team deployed', 'info');
    this.onSound?.('radio', point.x, point.z);
    return true;
  }

  public deploySwatSquad(x: number, z: number): boolean {
    if (!this.config.allowPlayerIntervention || this.commandPoints < 35) return false;
    const post = this.findWallPost(x, z);
    if (!this.canReinforceAt(post?.wall.z ?? z)) {
      this.triggerAlert('NO REINFORCEMENTS BEYOND THE FALLEN LINE', 'warn');
      return false;
    }
    if (post) {
      const slots = this.getVacantWallSlots(post.wall, post.x).slice(0, 2);
      if (slots.length === 0) return false;
      this.commandPoints -= 35;
      for (const slot of slots) {
        const x = this.makeWallGuardPost(post.wall, post.x, slot).ladderX;
        const z = ladderZ(post.wall) + 1.1 + (slot % WALL_POST_SLOTS);
        const guard = this.createAgent('police', x, z, true);
        this.assignWallPost(guard, post.wall, post.x, slot);
        this.pushAgent(guard);
      }
      if (this.onSound) this.onSound('radio', post.x, post.wall.z);
      this.addEventLog('police', `SWAT DEPLOY: ${slots.length} operators assigned to Line ${post.wall.layerIndex}.`, post.x, post.wall.z);
      this.transmitRadio({ kind: 'dispatch', place: `Line ${post.wall.layerIndex}`, count: slots.length });
      return true;
    }
    const targetNode = this.policeDeploymentPoint(x, z);
    if (!this.canReinforceAt(targetNode.z - 1)) {
      this.triggerAlert('NO REINFORCEMENTS BEYOND THE FALLEN LINE', 'warn');
      return false;
    }
    this.commandPoints -= 35;
    const district = this.city.getDistrictAtPos(x, z);

    for (let i = 0; i < 2; i++) {
      const swat = this.createAgent(
        'police',
        targetNode.x + (i === 0 ? -1.0 : 1.0),
        targetNode.z + (i === 0 ? -0.7 : 0.7),
        true
      );
      swat.policeState = 'HOLDING_POSITION';
      swat.assignedZonePos = { x: targetNode.x, z: targetNode.z };
      swat.destinationLabel = `SWAT Containment (${district})`;
      this.logAgentAction(swat, `SWAT heavy response team deployed to ${district}.`);
      this.pushAgent(swat);
    }

    if (this.onSound) this.onSound('radio', targetNode.x, targetNode.z);
    this.addEventLog(
      'police',
      `SWAT DEPLOY: 2 heavy SWAT operators deployed to ${district}.`,
      targetNode.x,
      targetNode.z
    );
    this.transmitRadio({ kind: 'dispatch', place: district, count: 2 });
    return true;
  }

  public deployMedicSquad(x: number, z: number): boolean {
    if (!this.config.allowPlayerIntervention || this.commandPoints < 25) return false;
    this.commandPoints -= 25;

    const targetNode = this.city.findNearestNode(x, z);
    const district = this.city.getDistrictAtPos(x, z);

    for (let i = 0; i < 2; i++) {
      const medic = this.createAgent(
        'medic',
        targetNode.x + (i === 0 ? -0.8 : 0.8),
        targetNode.z + (i === 0 ? -0.5 : 0.5),
        false
      );
      medic.medicState = 'RESPONDING';
      medic.destinationLabel = `Medical Triage (${district})`;
      this.logAgentAction(medic, `Emergency paramedic unit deployed to ${district}.`);
      this.pushAgent(medic);
    }

    if (this.onSound) this.onSound('cure', targetNode.x, targetNode.z);
    this.addEventLog(
      'evac',
      `MEDIC DEPLOY: 2 field paramedics with antiviral serum deployed to ${district}.`,
      targetNode.x,
      targetNode.z
    );
    return true;
  }

  public deployLureFlare(x: number, z: number): boolean {
    if (!this.config.allowPlayerIntervention || this.commandPoints < 15) return false;
    this.commandPoints -= 15;

    const node = this.city.findNearestNode(x, z);
    this.lureFlares.push({
      id: this.nextEntityId++,
      x: node.x,
      z: node.z,
      radius: 58,
      remaining: 20,
      maxDuration: 20,
      active: true
    });

    this.effects.push({
      type: 'lure_pulse',
      x: node.x,
      z: node.z,
      age: 0,
      duration: 1.05
    });

    if (this.onSound) this.onSound('siren', node.x, node.z);
    const district = this.city.getDistrictAtPos(node.x, node.z);
    this.triggerAlert(`ACOUSTIC LURE FLARE deployed in ${district} (20s)!`, 'info');
    this.addEventLog(
      'report',
      `LURE FLARE: Acoustic zombie decoy active for 20s in ${district}.`,
      node.x,
      node.z
    );
    return true;
  }

  public establishRoadblock(x: number, z: number): boolean {
    if (!this.config.allowPlayerIntervention || this.commandPoints < 15) return false;
    this.commandPoints -= 15;

    const roadXs = this.city.roadXs.length > 0 ? this.city.roadXs : this.city.roadCoords;
    const roadZs = this.city.roadZs.length > 0 ? this.city.roadZs : this.city.roadCoords;
    let minDx = Infinity;
    let minDz = Infinity;
    let nearestRx = x;
    let nearestRz = z;
    for (const rx of roadXs) {
      if (Math.abs(x - rx) < minDx) {
        minDx = Math.abs(x - rx);
        nearestRx = rx;
      }
    }
    for (const rz of roadZs) {
      if (Math.abs(z - rz) < minDz) {
        minDz = Math.abs(z - rz);
        nearestRz = rz;
      }
    }

    const snapToVerticalRoad = minDx < minDz;
    const rbX = snapToVerticalRoad ? nearestRx : x;
    const rbZ = snapToVerticalRoad ? z : nearestRz;
    const rotationY = snapToVerticalRoad ? 0 : Math.PI / 2;

    this.roadblocks.push({
      id: this.nextEntityId++,
      x: rbX,
      z: rbZ,
      rotationY,
      radius: 3.6,
      integrity: 150,
      maxIntegrity: 150,
      active: true
    });

    if (this.onSound) this.onSound('radio', rbX, rbZ);
    const district = this.city.getDistrictAtPos(rbX, rbZ);
    this.addEventLog(
      'police',
      `CONTAINMENT: Police barricade established in ${district}.`,
      rbX,
      rbZ
    );
    return true;
  }

  public orderDefendZone(x: number, z: number): boolean {
    if (!this.config.allowPlayerIntervention || this.commandPoints < 15) return false;
    const post = this.findWallPost(x, z);
    if (!this.canReinforceAt(post?.wall.z ?? z)) {
      this.triggerAlert('NO REINFORCEMENTS BEYOND THE FALLEN LINE', 'warn');
      return false;
    }
    if (post) {
      const slots = this.getVacantWallSlots(post.wall, post.x);
      const officers = this.agents
        .filter((a) => a.isAlive && a.role === 'police' && !a.isHunter && a.z > post.wall.z && !this.wallAssignments.has(a.id) &&
          !this.groundPosts.has(a.id) && !this.fallbacks.has(a.id))
        .sort((a, b) => Math.hypot(a.x - post.x, a.z - post.wall.z) - Math.hypot(b.x - post.x, b.z - post.wall.z))
        .slice(0, slots.length);
      if (officers.length === 0) {
        this.triggerAlert(slots.length ? 'No officers available behind this wall.' : 'This wall post is fully staffed.', 'info');
        return false;
      }
      this.commandPoints -= 15;
      officers.forEach((officer, i) => this.assignWallPost(officer, post.wall, post.x, slots[i]));
      if (this.onSound) this.onSound('radio', post.x, post.wall.z);
      this.addEventLog('police', `DEFENSE ORDER: ${officers.length} officers ordered onto Line ${post.wall.layerIndex}.`, post.x, post.wall.z);
      return true;
    }
    const node = this.policeDeploymentPoint(x, z);
    if (!this.canReinforceAt(node.z)) {
      this.triggerAlert('NO REINFORCEMENTS BEYOND THE FALLEN LINE', 'warn');
      return false;
    }
    this.commandPoints -= 15;
    this.holdZones.push({
      id: this.nextEntityId++,
      x: node.x,
      z: node.z,
      radius: 6.5,
      active: true
    });

    const officers = this.agents
      .filter((a) => a.isAlive && a.role === 'police' && !a.isHunter && this.canReinforceAt(a.z) && !this.wallAssignments.has(a.id) &&
        !this.groundPosts.has(a.id) && !this.fallbacks.has(a.id))
      .map((a) => ({ a, d: Math.hypot(a.x - node.x, a.z - node.z) }))
      .sort((u, v) => u.d - v.d)
      .slice(0, 4);

    const district = this.city.getDistrictAtPos(node.x, node.z);
    for (const { a } of officers) {
      a.assignedZonePos = { x: node.x, z: node.z };
      a.policeState = 'RESPONDING';
      a.destinationLabel = `Defending ${district}`;
      a.path = this.city.findPath(
        a.x,
        a.z,
        node.x,
        node.z,
        this.roadblocks,
        this.defenseWalls,
        this.blastGates,
        false
      );
      a.pathIndex = 0;
      this.logAgentAction(a, `Ordered to hold defensive perimeter in ${district}.`);
    }

    if (this.onSound) this.onSound('radio', node.x, node.z);
    this.addEventLog(
      'police',
      `DEFENSE ORDER: ${officers.length} officers ordered to hold perimeter in ${district}.`,
      node.x,
      node.z
    );
    return true;
  }

  public designateEvacZone(x: number, z: number): boolean {
    if (!this.config.allowPlayerIntervention || this.commandPoints < 20) return false;
    this.commandPoints -= 20;

    const node = this.city.findNearestNode(x, z);
    const ez: EvacZoneData = {
      id: this.nextEntityId++,
      x: node.x,
      z: node.z,
      radius: 7.0,
      extractedCount: 0,
      active: true
    };
    this.evacZones.push(ez);

    const district = this.city.getDistrictAtPos(node.x, node.z);
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.isAlive || a.isEvacuated || a.isPlayerControlled || a.role !== 'civilian' || a.civState === 'SHELTERED') continue;
      if (Math.hypot(a.x - ez.x, a.z - ez.z) <= 55) {
        this.startEvacuating(a, ez);
      }
    }

    if (this.onSound) this.onSound('radio', node.x, node.z);
    this.addEventLog(
      'evac',
      `EVAC BEACON: Emergency extraction zone designated in ${district}.`,
      node.x,
      node.z
    );
    return true;
  }

  public prioritizeSector(x: number, z: number): boolean {
    if (!this.config.allowPlayerIntervention || this.commandPoints < 10) return false;
    if (!this.canReinforceAt(z)) {
      this.triggerAlert('NO REINFORCEMENTS BEYOND THE FALLEN LINE', 'warn');
      return false;
    }
    this.commandPoints -= 10;

    const halfX = this.city.cityHalfX;
    const halfZ = this.city.cityHalfZ;
    const cx = Math.max(-halfX + 14, Math.min(halfX - 14, x));
    const cz = Math.max(-halfZ + 14, Math.min(halfZ - 14, z));
    const district = this.city.getDistrictAtPos(cx, cz);

    this.prioritySector = {
      district,
      x: cx,
      z: cz,
      radius: 18,
      active: true
    };

    for (const a of this.agents) {
      if (a.isAlive && a.role === 'police' && a.policeState === 'PATROLLING') {
        this.assignRandomPatrolDestination(a);
      }
    }

    if (this.onSound) this.onSound('radio', cx, cz);
    this.addEventLog(
      'police',
      `SECTOR PRIORITY: High-priority protection designated for ${district}.`,
      cx,
      cz
    );
    return true;
  }

  public getHotspotPosition(): { x: number; z: number } | null {
    let sumX = 0;
    let sumZ = 0;
    let count = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.isAlive || a.isEvacuated) continue;
      if (a.role === 'infected') {
        const w = a.zombieVariant === 'brute' ? 3 : 1;
        sumX += a.x * w;
        sumZ += a.z * w;
        count += w;
      }
    }
    if (count === 0) return null;
    return { x: sumX / count, z: sumZ / count };
  }

  public getStats(): SimulationStats {
    let healthy = 0;
    let panicking = 0;
    let sheltered = 0;
    let incubating = 0;
    let infected = 0;
    let brutes = 0;
    let police = 0;
    let medics = 0;

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.isAlive || a.isEvacuated) continue;

      if (a.role === 'police') {
        police++;
      } else if (a.role === 'medic') {
        medics++;
      } else if (a.role === 'infected') {
        infected++;
        if (a.zombieVariant === 'brute') brutes++;
      } else {
        if (a.isIncubating || a.civState === 'CONVULSING') {
          incubating++;
          infected++;
        } else {
          healthy++;
        }
        if (a.civState === 'SHELTERED') {
          sheltered++;
        } else if (
          a.civState === 'FLEEING' ||
          a.civState === 'FRIGHTENED' ||
          a.civState === 'SEEKING_SHELTER' ||
          a.civState === 'BEING_ATTACKED'
        ) {
          panicking++;
        }
      }
    }

    const activeReports = this.reports.filter((r) => !r.dispatched).length;

    let outbreakStatus: SimulationStats['outbreakStatus'] = 'CITY NORMAL';
    if (infected === 0 && this.simTime > 3) {
      outbreakStatus = 'CONTAINED';
    } else if (infected > healthy && infected > 25) {
      outbreakStatus = 'CRITICAL COLLAPSE';
    } else if (infected >= 8) {
      outbreakStatus = 'ACTIVE OUTBREAK';
    } else if (infected >= 1 && (this.reports.length > 0 || panicking > 0 || incubating > 0)) {
      outbreakStatus = 'LOCAL INCIDENT';
    }

    const lineStatus = (index: number): SimulationStats['line1Status'] => {
      const wall = this.defenseWalls.find((line) => line.layerIndex === index);
      if (!wall) return 'NONE';
      if (wall.breachedNotified) return 'BREACHED';
      return wall.z <= this.policeFrontZ ? 'WITHDRAWN' : 'HOLDING';
    };

    return {
      healthy,
      panicking,
      sheltered,
      incubating,
      infected,
      brutes,
      police,
      medics,
      cured: this.totalCured,
      evacuated: this.totalEvacuated,
      deceased: this.totalDeceased,
      activeReports,
      commandPoints: Math.floor(this.commandPoints),
      hordeWave: this.hordeWave,
      line1Status: lineStatus(1),
      line2Status: lineStatus(2),
      line3Status: lineStatus(3),
      trainBoarded: this.expressTrain.boardedTotal + this.trainPassengers.size -
        (this.ktxInTransit() ? this.countTrainInfected() : 0),
      simTime: this.simTime,
      outbreakStatus
    };
  }

  private recordHistoryPoint(): void {
    const s = this.getStats();
    this.history.push({
      time: this.simTime,
      healthy: s.healthy,
      panicking: s.panicking,
      infected: s.infected,
      evacuated: s.evacuated,
      deceased: s.deceased
    });
    if (this.history.length > 180) {
      this.history.shift();
    }
  }
}
