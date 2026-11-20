import { CityLayout } from './cityData';
import { generateAgentName, SeededRNG } from './rng';
import { hasLineOfSight, resolveWorldCollisions, SpatialGrid } from './spatial';
import {
  AgentData,
  AgentRole,
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
  PrioritySectorData,
  RoadblockData,
  ScenarioConfig,
  SimulationStats,
  SupplyPickupData,
  TimeSeriesPoint,
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

export type SoundTrigger = (
  type:
    | 'gunshot'
    | 'swat_shot'
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
  private windowBreachCooldown = 2.8;
  private overpassDropCooldown = 5.5;
  private activeAlarmSet: Set<number> = new Set();
  private pathsComputedThisTick = 0;
  private pyramidBuckets: AgentData[][][] = [];
  private fpVaultActive = false;
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
      : this.config.id === 'horde_invasion' || this.config.id === 'wwz_busan'
      ? 180
      : 120;
    this.totalEvacuated = 0;
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
        pyramidHeights: new Array(bucketCount).fill(0),
        bucketSize
      });

      for (let gi = 0; gi < wd.gateXs.length; gi++) {
        const gx = wd.gateXs[gi];
        const sideLabel = gx < 0 ? 'West' : 'East';
        this.blastGates.push({
          id: this.nextEntityId++,
          wallId,
          x: gx,
          z: wd.z,
          width: 13.0,
          isOpen: true,
          breached: false,
          integrity: 260,
          maxIntegrity: 260,
          label: `Line ${wd.layerIndex} ${sideLabel} Gate`
        });
      }
    }

    this.expressTrain = {
      active: this.city.hasExpressRail,
      x: this.city.hasExpressRail ? this.city.stationPos.x : -this.city.cityHalfX - 65,
      z: this.city.railZ,
      state: this.city.hasExpressRail ? 'DOCKED' : 'COOLDOWN',
      timer: 40,
      boardedTotal: 0,
      stationX: this.city.stationPos.x,
      stationZ: this.city.stationPos.z,
      length: 54,
      carLength: 14.4,
      carWidth: 4.2,
      carHeight: 3.1,
      boardingDoorLocalX: -15.0,
      cabinSwitchLocalX: 21.0,
      doors: [
        {
          id: 1,
          localX: -7.5,
          label: 'Car 3 ↔ Car 2 Glass Door',
          isLocked: false,
          isBroken: false,
          integrity: 110,
          maxIntegrity: 110,
          lastHitTime: -99
        },
        {
          id: 2,
          localX: 7.5,
          label: 'Car 2 ↔ Car 1 Glass Door',
          isLocked: false,
          isBroken: false,
          integrity: 110,
          maxIntegrity: 110,
          lastHitTime: -99
        }
      ],
      playerInsideCar: 0,
      playerDeparting: false,
      departRideTimer: 0
    };

    this.firstPerson = {
      active: false,
      playerId: null,
      yaw: Math.PI,
      pitch: 0,
      stamina: 100,
      maxStamina: 100,
      sprinting: false,
      nearestZombieDist: 999,
      nearbyGateId: null,
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
      nearbyTrainDoorId: null,
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
    this.spawnInitialVehicles();
    this.spawnSupplyPickups();

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
    const isWwzBusan = this.config.id === 'wwz_busan';
    const isSuper = this.config.id === 'super_spreader';

    const policeCount = Math.max(this.config.initialPolice, Math.floor(totalPop / 25));
    const medicCount = Math.max(4, Math.floor(totalPop / 70));
    const initialInfCount = isHorde
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

    // 1. Police & SWAT
    const swatCount = Math.max(2, Math.floor(policeCount * 0.28));
    for (let i = 0; i < policeCount; i++) {
      const isSwat = i < swatCount;
      let node;
      if (isCitadel && i < this.blastGates.length * 2) {
        // Post guard squads just south of each Blast Gate
        const g = this.blastGates[i % this.blastGates.length];
        node = this.city.findNearestNode(g.x + this.rng.range(-3, 3), g.z + 6.5);
      } else if (i < 4) {
        node = this.city.findNearestNode(
          this.city.precinctPos.x + this.rng.range(-6, 6),
          this.city.precinctPos.z + this.rng.range(-4, 4)
        );
      } else if ((isTwin || isCitadel) && southNodes.length > 0 && this.rng.chance(0.65)) {
        node = this.rng.pick(southNodes);
      } else {
        node = this.rng.pick(this.city.navNodes);
      }

      const officer = this.createAgent(
        'police',
        node.x + this.rng.range(-1.2, 1.2),
        node.z + this.rng.range(-1.2, 1.2),
        isSwat
      );
      this.assignRandomPatrolDestination(officer);
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
      // Seed 3 civilians right inside KTX Central Station Hall on Citadel Express for instant Station/Train possession
      const nearStation = isCitadel && i < 3;
      const node = nearStation
        ? this.city.findNearestNode(this.rng.range(-10, 10), 178 + this.rng.range(-3, 4))
        : this.rng.pick(this.city.navNodes);
      const civ = this.createAgent(
        'civilian',
        nearStation ? this.rng.range(-10, 10) : node.x + this.rng.range(-1.5, 1.5),
        nearStation ? this.rng.range(176, 184) : node.z + this.rng.range(-1.5, 1.5),
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
    if (isHorde) {
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
      recentLogs: [`08:00:00 — Active in ${this.city.getDistrictAtPos(x, z)}.`]
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

  public triggerWindowBreach(b: BuildingData): void {
    if (b.height < 11) return;
    b.hasUpperBreach = true;

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

    const winY = this.rng.range(6.0, Math.max(6.2, Math.min(b.height - 2.0, 10.6)));
    const wx = b.x + dirX * (b.width * 0.5 + 0.06);
    const wz = b.z + dirZ * (b.depth * 0.5 + 0.06);
    const rotY = dirX !== 0 ? Math.PI / 2 : 0;

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
          if (b.height < 11 || b.hasUpperBreach) continue;
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
        if (bestTarget) {
          this.triggerWindowBreach(bestTarget);
          triggered = true;
        }
      }
      if (!triggered && this.brokenWindows.length < 12 && this.simTime > 4) {
        for (let bi = 0; bi < this.city.buildings.length; bi++) {
          const b = this.city.buildings[bi];
          if (b.height < 11 || b.hasUpperBreach) continue;
          const near = this.spatial.queryRadius(b.x, b.z, Math.max(b.width, b.depth) * 0.5 + 16, this.neighborBuffer);
          let zCount = 0;
          for (let k = 0; k < near.length; k++) {
            if (near[k].role === 'infected') zCount++;
          }
          if (zCount >= 3 || (this.firstPerson?.active && this.rng.next() < 0.15 && Math.abs(b.z) < 170)) {
            this.triggerWindowBreach(b);
            break;
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
      if (nearOverpass && (this.simTime > 6 || Boolean(fp))) {
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

    if (this.config.enableWaves && this.hordeWave > 0 && this.hordeWave < 3) {
      this.nextWaveTimer -= dt;
      if (this.nextWaveTimer <= 0) {
        this.hordeWave++;
        this.nextWaveTimer = 42;
        this.spawnHordeWavePack(35, 3, 10, false);
        if (this.onSound) this.onSound('siren', 0, -this.city.cityHalfZ + 12);
        this.triggerAlert(
          `CRIMSON TIDE WAVE ${this.hordeWave}: 35 Infected & Alpha Brutes Incoming!`,
          'danger'
        );
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

    this.spatial.clear();
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (a.isAlive && !a.isEvacuated && a.civState !== 'SHELTERED') {
        this.spatial.insert(a);
      }
    }

    this.processEmergencyDispatch();
    this.updateExpressTrain(dt);

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.isAlive || a.isEvacuated) continue;

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
        a.fallVy -= 22 * dt;
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

      if (a.role === 'civilian') {
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

  /**
   * High-Speed Express Train cycle (Option B Periodic 40s Docking + Walkable 3-Car KTX Climax):
   * COOLDOWN (22s) -> APPROACHING (5s, horn + alert) -> DOCKED (40s boarding) -> DEPARTING (5.5s)
   */
  private getTrainCarForPos(x: number, z: number): 0 | 1 | 2 | 3 {
    const tr = this.expressTrain;
    if (!tr.active || tr.state !== 'DOCKED') return 0;
    const lx = x - tr.x;
    const lz = z - tr.z;
    if (lx < -22.2 || lx > 22.2 || Math.abs(lz) > tr.carWidth * 0.5) return 0;
    if (lx < -7.5) return 3;
    if (lx < 7.5) return 2;
    return 1;
  }

  private resolveTrainCollisions(pos: Vec2, radius: number): void {
    const tr = this.expressTrain;
    if (!tr.active || tr.state !== 'DOCKED') return;
    if (pos.z < tr.z - 4.2 || pos.z > tr.z + 4.2 || Math.abs(pos.x - tr.x) > 27.5) return;

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

    const tx = tr.x;
    const tz = tr.z;
    // Aerodynamic head (+X) & tail (-X) noses outside cars
    pushBox(tx - 26.2, tx - 22.25, tz - 1.8, tz + 1.8);
    pushBox(tx + 22.15, tx + 26.2, tz - 1.8, tz + 1.8);

    // Outer car perimeter walls (North wall has a 3.6m open boarding door at Car 3 x ∈ [-16.8, -13.2])
    pushBox(tx - 22.3, tx - 16.85, tz - 2.18, tz - 1.92);
    pushBox(tx - 13.15, tx + 22.3, tz - 2.18, tz - 1.92);
    pushBox(tx - 22.3, tx + 22.3, tz + 1.92, tz + 2.18);
    // Rear Car 3 & Front Car 1 Cabin Endwalls
    pushBox(tx - 22.45, tx - 22.12, tz - 2.15, tz + 2.15);
    pushBox(tx + 21.95, tx + 22.35, tz - 2.15, tz + 2.15);

    // Side passenger seat banks leaving a wide 1.88m central aisle (z ∈ [tz - 0.94, tz + 0.94]) & Car 3 doorway entry clear
    pushBox(tx - 22.1, tx - 17.1, tz - 1.94, tz - 0.96);
    pushBox(tx - 12.9, tx + 21.8, tz - 1.94, tz - 0.96);
    pushBox(tx - 22.1, tx + 21.8, tz + 0.96, tz + 1.94);

    // Inter-car Bulkhead side walls + locked sliding glass connector doors
    for (let i = 0; i < tr.doors.length; i++) {
      const td = tr.doors[i];
      const dx = tx + td.localX;
      pushBox(dx - 0.18, dx + 0.18, tz - 2.15, tz - 0.88);
      pushBox(dx - 0.18, dx + 0.18, tz + 0.88, tz + 2.15);
      if (td.isLocked && !td.isBroken) {
        pushBox(dx - 0.16, dx + 0.16, tz - 0.9, tz + 0.9);
      }
    }
  }

  private updateExpressTrain(dt: number): void {
    const tr = this.expressTrain;
    if (!tr.active) return;

    const half = this.city.cityHalfX;
    const minX = -half - 65;
    const maxX = half + 65;
    const prevX = tr.x;

    tr.timer -= dt;

    if (tr.state === 'COOLDOWN') {
      tr.x = minX;
      if (tr.timer <= 0) {
        tr.state = 'APPROACHING';
        tr.timer = 5.0;
        tr.playerDeparting = false;
        tr.departRideTimer = 0;
        for (const d of tr.doors) {
          d.isLocked = false;
          d.isBroken = false;
          d.integrity = d.maxIntegrity;
          d.lastHitTime = -99;
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
        tr.timer = 40.0;
        tr.x = tr.stationX;
        this.triggerAlert('🚄 KTX-101 DOCKED (40s) — Board Car 3, Lock Doors & Reach Car 1!', 'info');

        // Push a small pursuing threat toward Car 3 rear plaza in FP mode for authentic Train to Busan tension
        if (this.firstPerson.active) {
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
      const platX = tr.stationX;
      const platZ = tr.stationZ - 5.5;

      // Board AI civilians who reach the platform / Car 3 entrance
      for (let i = 0; i < this.agents.length; i++) {
        const a = this.agents[i];
        if (!a.isAlive || a.isEvacuated || a.role !== 'civilian' || a.isPlayerControlled) continue;
        if (a.civState === 'SHELTERED' || a.civState === 'CONVULSING') continue;

        const distPlat = Math.hypot(a.x - (platX - 15.0), a.z - platZ);
        if (distPlat <= 3.8 || this.getTrainCarForPos(a.x, a.z) > 0) {
          a.isEvacuated = true;
          tr.boardedTotal++;
          this.totalEvacuated++;
          this.logAgentAction(a, `Boarded the KTX-101 Express Evacuation Train!`);
        } else if (distPlat <= 75 && a.civState !== 'EVACUATING' && a.repathCooldown <= 0) {
          a.civState = 'EVACUATING';
          a.repathCooldown = 1.2;
          a.destinationLabel = 'KTX Car 3 Boarding Door';
          a.path = this.city.findPath(
            a.x,
            a.z,
            platX - 15.0,
            platZ,
            this.roadblocks,
            this.defenseWalls,
            this.blastGates,
            false
          );
          a.pathIndex = 0;
        }
      }

      if (tr.timer <= 0) {
        tr.state = 'DEPARTING';
        tr.timer = 5.5;
        if (this.onSound) this.onSound('train_horn', tr.stationX, tr.stationZ);
        if (this.firstPerson.active && this.firstPerson.outcome === 'PLAYING') {
          const fp = this.getAgentById(this.firstPerson.playerId);
          if (fp && fp.isAlive && tr.playerInsideCar > 0) {
            tr.playerDeparting = true;
            tr.departRideTimer = 1.6;
            this.triggerAlert('🚄 KTX-101 DEPARTING FOR BUSAN — YOU MADE IT ON BOARD!', 'info');
          } else {
            this.triggerAlert('⚠ MISSED KTX-101! Hold out in Central Station until next train!', 'danger');
          }
        }
        this.addEventLog(
          'evac',
          `TRAIN DEPARTED: KTX-101 departed with ${tr.boardedTotal} total evacuees!`,
          tr.stationX,
          tr.stationZ
        );
      }
    } else if (tr.state === 'DEPARTING') {
      const p = 1 - Math.max(0, tr.timer) / 5.5;
      const eased = p * p;
      tr.x = tr.stationX + (maxX - tr.stationX) * eased;
      const deltaTrainX = tr.x - prevX;
      this.plowZombiesOnTrack(tr);

      if (tr.playerDeparting && this.firstPerson.active && this.firstPerson.outcome === 'PLAYING') {
        const fp = this.getAgentById(this.firstPerson.playerId);
        if (fp && fp.isAlive) {
          fp.x += deltaTrainX;
          tr.departRideTimer -= dt;
          if (tr.departRideTimer <= 0) {
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
        tr.state = 'COOLDOWN';
        tr.timer = 22.0;
        tr.x = minX;
        tr.playerDeparting = false;
      }
    }
  }

  private plowZombiesOnTrack(tr: ExpressTrainData): void {
    const near = this.spatial.queryRadius(tr.x, tr.z, 26, this.neighborBuffer);
    for (let i = 0; i < near.length; i++) {
      const a = near[i];
      if (!a.isAlive || a.role !== 'infected') continue;
      if (Math.abs(a.z - tr.z) < 2.6 && Math.abs(a.x - tr.x) < 26) {
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

    // 1. Gravity decay for any zombie not actively supported by a pyramid bucket
    for (let i = 0; i < this.agents.length; i++) {
      const z = this.agents[i];
      if (z.isAlive && z.role === 'infected' && z.climbY > 0) {
        z.climbY = Math.max(0, z.climbY - dt * 11.0);
      }
    }

    // 2. Check closed Blast Gate pounding
    for (let gi = 0; gi < this.blastGates.length; gi++) {
      const g = this.blastGates[gi];
      if (g.isOpen || g.breached) continue;

      const near = this.spatial.queryRadius(g.x, g.z, g.width * 0.5 + 3.5, this.neighborBuffer);
      let dps = 0;
      for (let k = 0; k < near.length; k++) {
        const z = near[k];
        if (!z.isAlive || z.role !== 'infected') continue;
        if (Math.abs(z.x - g.x) <= g.width * 0.5 + 1.5 && Math.abs(z.z - g.z) <= 3.8) {
          dps += z.zombieVariant === 'brute' ? 32 : 9;
        }
      }

      if (dps > 0) {
        g.integrity -= dps * dt;
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

    // 3. Bin pressing zombies into horizontal buckets along each wall to grow 3D Zombie Pyramids
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
        if (!z.isAlive || z.role !== 'infected') continue;
        if (z.z >= w.z - 6.8 && z.z <= w.z + 0.4) {
          // Exclude zombies standing at an open/breached gate opening
          let atPassableGate = false;
          for (let gi = 0; gi < this.blastGates.length; gi++) {
            const g = this.blastGates[gi];
            if (
              g.wallId === w.id &&
              (g.isOpen || g.breached) &&
              Math.abs(z.x - g.x) <= g.width * 0.5
            ) {
              atPassableGate = true;
              break;
            }
          }
          if (atPassableGate) continue;

          const bIdx = Math.max(
            0,
            Math.min(bucketCount - 1, Math.floor((z.x - w.minX) / w.bucketSize))
          );
          buckets[bIdx].push(z);
        }
      }

      for (let b = 0; b < bucketCount; b++) {
        const list = buckets[b];
        if (list.length >= 4) {
          w.pyramidHeights[b] = Math.min(
            w.height + 0.85,
            w.pyramidHeights[b] + (list.length - 3) * dt * 0.82
          );
        } else {
          w.pyramidHeights[b] = Math.max(0, w.pyramidHeights[b] - dt * 1.4);
        }

        const pH = w.pyramidHeights[b];
        if (pH <= 0.3) continue;

        // Sort zombies closest to wall first so front rank forms top of flesh ramp
        list.sort((a, b2) => b2.z - a.z);
        for (let k = 0; k < list.length; k++) {
          const z = list[k];
          const rankFactor = 1 - Math.min(0.85, k / Math.max(4, list.length));
          const targetClimb = Math.min(w.height + 0.25, pH * (0.35 + rankFactor * 0.72));
          z.climbY = Math.max(z.climbY, targetClimb);

          // Spill over wall top into the next sector!
          if (z.climbY >= w.height - 0.45) {
            z.z = w.z + 2.3;
            z.climbY = w.height - 0.5;
            z.path = [];
            z.pathIndex = 0;
            if (!w.breachedNotified) {
              w.breachedNotified = true;
              this.gridFlickerTimer = 2.6;
              this.blackoutMaxZ = Math.max(this.blackoutMaxZ, w.z);
              this.triggerAlert(
                `⚠ ${w.label.toUpperCase()} OVERRUN BY 3D ZOMBIE PYRAMID!`,
                'danger'
              );
              if (this.onSound) this.onSound('siren', z.x, w.z);
              this.addEventLog(
                'infection',
                `PYRAMID BREACH: Infected climbed over ${w.label} at x=${Math.round(z.x)}!`,
                z.x,
                w.z
              );
            }
          }
        }
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
    if (this.handlePinnedOrStunned(m)) return;
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

      if (this.simTime - rep.timestamp < this.config.dispatchDelaySeconds) {
        continue;
      }

      const candidates: Array<{ officer: AgentData; dist: number }> = [];
      for (let j = 0; j < this.agents.length; j++) {
        const a = this.agents[j];
        if (!a.isAlive || (a.role !== 'police' && a.role !== 'medic')) continue;
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
          ofc.path = this.city.findPath(
            ofc.x,
            ofc.z,
            rep.x,
            rep.z,
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
        this.addEventLog(
          'police',
          `DISPATCH: ${dispatchCount} unit(s) responding to 911 call in ${rep.district}.`,
          rep.x,
          rep.z
        );
      }
    }
  }

  private updateCivilian(a: AgentData, dt: number): void {
    // Player-controlled FP survivor is driven by updateFirstPersonPlayer
    if (a.isPlayerControlled) {
      if (a.civState === 'CONVULSING') {
        a.convulseTimer -= dt;
        if (a.convulseTimer <= 0) this.convertToInfected(a);
      } else if (a.isIncubating) {
        a.incubationTimer -= dt;
        a.health = Math.max(15, (a.incubationTimer / a.maxIncubationTime) * 100);
        if (a.incubationTimer <= 0) {
          a.isIncubating = false;
          a.civState = 'CONVULSING';
          a.convulseTimer = 2.0;
        }
      }
      return;
    }

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
        const evac = this.findNearestEvacZone(a.x, a.z, 55);

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
            this.rng.chance(0.28)
          ) {
            const shelter = this.findNearestAvailableShelter(a.x, a.z, 36);
            if (shelter) {
              const path = this.requestPath(a.x, a.z, shelter.doorX, shelter.doorZ, false);
              if (path) {
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
            const evac = this.findNearestEvacZone(a.x, a.z, 52);
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
          const ez = this.findNearestEvacZone(a.x, a.z, 60);
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
        const nearbyEvac = this.findNearestEvacZone(a.x, a.z, 26);
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

  private updateInfected(z: AgentData, dt: number): void {
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
        z.x += (victim.x - (dx / d) * targetGap - z.x) * pull;
        z.z += (victim.z - (dz / d) * targetGap - z.z) * pull;
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

    if (z.perceptionCooldown <= 0) {
      const crowdFactor = this.agents.length > 1400 ? 1.85 : this.agents.length > 800 ? 1.35 : 1.0;
      z.perceptionCooldown = 0.24 * crowdFactor + (z.id % 7) * 0.035;

      const neighbors = this.spatial.queryRadius(z.x, z.z, z.awarenessRadius + 6, this.neighborBuffer);
      let bestTarget: AgentData | null = null;
      let bestScore = Infinity;
      let nearbyZombies = 0;

      const maxN = Math.min(neighbors.length, 32);
      for (let i = 0; i < maxN; i++) {
        const candidate = neighbors[i];
        if (!candidate.isAlive) continue;
        const dx = candidate.x - z.x;
        const dz = candidate.z - z.z;
        const dSq = dx * dx + dz * dz;

        if (candidate.role === 'infected') {
          if (dSq < 64.0) nearbyZombies++;
          continue;
        }
        if (candidate.civState === 'CONVULSING') continue;

        const isLoud =
          candidate.civState === 'FLEEING' ||
          candidate.policeState === 'ENGAGING' ||
          dSq < 49.0;

        if (dSq <= z.awarenessRadius * z.awarenessRadius || isLoud) {
          const dist = Math.sqrt(dSq);
          const score =
            dist +
            (candidate.isIncubating ? 10.0 : 0) +
            (candidate.pinnedById !== null ? 14.0 : 0);
          if (
            score < bestScore &&
            (dSq < 36.0 ||
              hasLineOfSight(z.x, z.z, candidate.x, candidate.z, this.city, this.defenseWalls, this.blastGates, this.interiorDoors))
          ) {
            bestScore = score;
            bestTarget = candidate;
          }
        }
      }

      z.perceivedThreats = nearbyZombies;
      z.targetAgentId = bestTarget ? bestTarget.id : null;
    }

    const hordeFrenzy = z.perceivedThreats >= 4 ? 1.1 : 1.0;
    const breachMult = z.zombieVariant === 'brute' ? 3.0 : 1.0;

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
    if (this.expressTrain.active && this.expressTrain.state === 'DOCKED') {
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
              y: 1.4,
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
              y: 1.5,
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
        const zombieInside = Boolean(
          bld && z.x > bld.minX && z.x < bld.maxX && z.z > bld.minZ && z.z < bld.maxZ
        );
        if (zombieInside) continue;
        const fpInside =
          this.firstPerson.active && this.firstPerson.insideBuildingId === door.buildingId;
        const tgt = this.getAgentById(z.targetAgentId);
        const targetInside = Boolean(
          bld &&
            tgt &&
            tgt.isAlive &&
            tgt.x > bld.minX &&
            tgt.x < bld.maxX &&
            tgt.z > bld.minZ &&
            tgt.z < bld.maxZ
        );
        if (fpInside || targetInside) {
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

    const currentTarget = this.getAgentById(z.targetAgentId);
    const targetDist =
      currentTarget &&
      currentTarget.isAlive &&
      !currentTarget.isEvacuated &&
      currentTarget.civState !== 'SHELTERED' &&
      currentTarget.civState !== 'CONVULSING'
        ? Math.hypot(currentTarget.x - z.x, currentTarget.z - z.z)
        : Infinity;

    if (activeLure && targetDist > 4.5) {
      z.zombieState = 'PURSUING';
      z.destinationLabel = 'Drawn to Acoustic Lure';
      if (bestLureDist > 2.2) {
        this.steerTowards(z, activeLure.x, activeLure.z, z.baseSpeed * 1.15 * hordeFrenzy, dt);
      } else {
        z.vx *= 0.3;
        z.vz *= 0.3;
      }
      return;
    }

    if (currentTarget && targetDist < z.awarenessRadius + 10) {
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
        this.steerTowards(z, currentTarget.x, currentTarget.z, chaseSpeed, dt);
      }
      return;
    }

    z.targetAgentId = null;
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
        this.steerTowards(z, nearestAlarm.x, nearestAlarm.z, z.baseSpeed * 1.12 * hordeFrenzy, dt);
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
      if (path) {
        z.path = path;
        z.pathIndex = 0;
        z.repathCooldown = 1.0;
      } else {
        z.repathCooldown = 0.35;
      }
    }
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
    if (isBrute) {
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
    if (victim.isSwat) {
      zombie.attackMode = 'claw_swipe';
      zombie.attackCooldown = 1.1;
      this.pushEffect({ type: 'bite', x: victim.x, z: victim.z, age: 0, duration: 0.45 });
      if (this.onSound) this.onSound('bite', victim.x, victim.z);
      victim.health -= 14;
      const dx = zombie.x - victim.x;
      const dz = zombie.z - victim.z;
      const len = Math.hypot(dx, dz) || 1;
      zombie.x += (dx / len) * 1.5;
      zombie.z += (dz / len) * 1.5;
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
      this.pushEffect({ type: 'bite', x: victim.x, z: victim.z, age: 0, duration: 0.55 });
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
    const oldRole = agent.role;
    agent.role = 'infected';
    agent.isSwat = false;
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
    if (this.handlePinnedOrStunned(p)) return;

    if (p.perceptionCooldown <= 0) {
      const crowdFactor = this.agents.length > 1400 ? 1.85 : this.agents.length > 800 ? 1.35 : 1.0;
      p.perceptionCooldown = 0.22 * crowdFactor + (p.id % 7) * 0.035;

      const neighbors = this.spatial.queryRadius(p.x, p.z, p.awarenessRadius, this.neighborBuffer);
      let nearestZombie: AgentData | null = null;
      let nearestDistSq = Infinity;
      let closeThreats = 0;

      const maxN = Math.min(neighbors.length, 32);
      for (let i = 0; i < maxN; i++) {
        const other = neighbors[i];
        if (!other.isAlive || other.role !== 'infected') continue;
        const dx = other.x - p.x;
        const dz = other.z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < 17.64) closeThreats++;

        if (
          dSq < nearestDistSq &&
          hasLineOfSight(p.x, p.z, other.x, other.z, this.city, this.defenseWalls, this.blastGates, this.interiorDoors)
        ) {
          nearestDistSq = dSq;
          nearestZombie = other;
        }
      }

      p.perceivedThreats = closeThreats;
      p.targetAgentId = nearestZombie ? nearestZombie.id : null;
    }

    const nearestZombie = this.getAgentById(p.targetAgentId);
    const nearestDist =
      nearestZombie && nearestZombie.isAlive && nearestZombie.role === 'infected'
        ? Math.hypot(nearestZombie.x - p.x, nearestZombie.z - p.z)
        : Infinity;

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
        this.steerTowards(p, nearestZombie.x, nearestZombie.z, p.baseSpeed * 1.05, dt);
      }
      return;
    }

    p.targetAgentId = null;

    if (p.assignedZonePos) {
      const distZone = Math.hypot(p.x - p.assignedZonePos.x, p.z - p.assignedZonePos.z);
      if (distZone > 5.5) {
        p.policeState = 'RESPONDING';
        p.destinationLabel = 'Moving to Defense Zone';
        this.moveAlongPath(p, p.baseSpeed * 1.15, dt);
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
    if (reached) {
      p.policeState = 'PATROLLING';
      this.assignRandomPatrolDestination(p);
    }
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
      z: officer.z,
      targetX: target.x,
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
    target.health -= damage;

    if (target.health <= 0 && target.isAlive) {
      this.releaseGrapple(target);
      target.isAlive = false;
      this.totalDeceased++;
      officer.kills++;
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

  private assignRandomCivilianDestination(a: AgentData): void {
    const node = this.rng.pick(this.city.navNodes);
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
          Math.hypot(n.x - this.prioritySector!.x, n.z - this.prioritySector!.z) <=
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

    const node = this.rng.pick(this.city.navNodes);
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
    if (this.config.mapId === 'citadel_express' && a.z < this.city.stationPos.z - 12) {
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
    const targetNode = this.city.findNearestNode(fleeX, fleeZ);
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
    if (a.civState === 'EVACUATING') return;
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

  private moveAlongPath(a: AgentData, speed: number, dt: number): boolean {
    if (!a.path || a.pathIndex >= a.path.length) {
      a.vx = 0;
      a.vz = 0;
      return true;
    }

    const wp = a.path[a.pathIndex];
    const dx = wp.x - a.x;
    const dz = wp.z - a.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 1.1) {
      a.pathIndex++;
      if (a.pathIndex >= a.path.length) {
        a.vx = 0;
        a.vz = 0;
        return true;
      }
    }

    this.steerTowards(a, wp.x, wp.z, speed, dt);
    return false;
  }

  private steerTowards(a: AgentData, targetX: number, targetZ: number, speed: number, dt: number): void {
    const dx = targetX - a.x;
    const dz = targetZ - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return;

    const dirX = dx / dist;
    const dirZ = dz / dist;
    a.vx = dirX * speed;
    a.vz = dirZ * speed;
    a.x += a.vx * dt;
    a.z += a.vz * dt;
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
      if (!a.isAlive || a.isEvacuated || a.civState === 'SHELTERED') continue;

      if (!a.isPlayerControlled && a.pinnedById === null && a.grappleTargetId === null) {
        const nearby = this.spatial.queryRadius(a.x, a.z, minSep * 1.4, this.neighborBuffer);
        let pushX = 0;
        let pushZ = 0;
        const limit = Math.min(nearby.length, sepCap);
        for (let j = 0; j < limit; j++) {
          const b = nearby[j];
          if (b.id === a.id || a.grappleTargetId === b.id || a.pinnedById === b.id) continue;
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
        a.z += pushZ * dt;
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

      if (a.fallY <= 0.25) {
        resolveWorldCollisions(a, 0.55, this.city, this.defenseWalls, this.blastGates, a.climbY, this.interiorDoors);
        if (a.climbY <= 0.2) {
          this.resolveTrainCollisions(a, 0.55);
        }
      }

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
        if (!g.isOpen && !g.breached && Math.hypot(lookAheadX - g.x, lookAheadZ - g.z) < 4.5) {
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
        { x: -34.0, z: -135.0, yaw: Math.PI, label: 'Northgate Brick Clinic', scenic: 12 },
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

  private computeEscapeWaypoint(px: number, pz: number): { x: number; z: number; label: string } {
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
        const passBonus = g.isOpen || g.breached ? 0 : 45;
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
          label: `${bestGate.label}${bestGate.isOpen || bestGate.breached ? '' : ' (Sealed — [E] Open)'}`
        };
      }
    }

    if (this.city.hasExpressRail) {
      const tr = this.expressTrain;
      const carNum = this.getTrainCarForPos(px, pz);
      if (tr.state === 'DOCKED') {
        if (carNum === 3) {
          return { x: tr.x - 7.5, z: tr.z, label: 'KTX Car 3 → Push East through Car 2' };
        }
        if (carNum === 2) {
          return { x: tr.x + 7.5, z: tr.z, label: 'KTX Car 2 → Lock Doors & Push to Car 1' };
        }
        if (carNum === 1) {
          return { x: tr.x + tr.cabinSwitchLocalX, z: tr.z, label: 'Car 1 Safe Cabin Console [E]' };
        }
        return {
          x: tr.stationX + tr.boardingDoorLocalX,
          z: tr.stationZ - 2.35,
          label: 'KTX Car 3 Boarding Door'
        };
      }
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
          if (g.wallId === w.id && (g.isOpen || g.breached) && Math.abs(ex - g.x) <= g.width * 0.5 - 0.65) {
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

  public enterFirstPerson(spawnPreset: 'city' | 'ktx_terminal' = 'city'): AgentData {
    // Release any previous player flag
    if (this.firstPerson.playerId !== null) {
      const prev = this.getAgentById(this.firstPerson.playerId);
      if (prev) prev.isPlayerControlled = false;
    }

    let player: AgentData | null = null;
    let spawnLabel = 'Selected Civilian';
    let initialYaw = Math.PI;
    const isKtxPreset = spawnPreset === 'ktx_terminal' && this.city.hasExpressRail;

    if (isKtxPreset) {
      spawnLabel = 'KTX Platform 1 (Car 3 Boarding)';
      initialYaw = Math.PI;
      player = this.createAgent(
        'civilian',
        this.expressTrain.stationX + this.expressTrain.boardingDoorLocalX,
        189.2,
        false
      );
      resolveWorldCollisions(player, 0.68, this.city, this.defenseWalls, this.blastGates, 0, this.interiorDoors);
      player.name = `${player.name} (You)`;
      player.destinationLabel = 'Board KTX Car 3 → Car 1';
      this.pushAgent(player);

      this.expressTrain.state = 'DOCKED';
      this.expressTrain.x = this.expressTrain.stationX;
      this.expressTrain.timer = Math.max(this.expressTrain.timer, 36.0);
      this.expressTrain.playerDeparting = false;
      this.expressTrain.departRideTimer = 0;
      for (const td of this.expressTrain.doors) {
        td.isLocked = false;
        td.isBroken = false;
        td.integrity = td.maxIntegrity;
        td.lastHitTime = -99;
      }

      // Seed infected inside Car 2 aisle (charging toward Car 3 <-> Car 2 glass door) & pounding outside windows
      const seeds: Array<[number, number, ZombieVariant]> = [
        [-3.6, 196.0, 'standard'],
        [-9.2, 193.0, 'standard'],
        [-1.8, 193.0, 'runner'],
        [-24.0, 186.5, 'runner'],
        [-19.0, 185.0, 'standard']
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
        sel.role === 'civilian' &&
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
      player = this.createAgent('civilian', pick.x, pick.z, false);
      resolveWorldCollisions(player, 0.68, this.city, this.defenseWalls, this.blastGates, 0, this.interiorDoors);
      player.name = `${player.name} (You)`;
      player.destinationLabel = 'Fleeing to Extraction';
      this.pushAgent(player);
    }

    player.isPlayerControlled = true;
    this.selectedAgentId = player.id;

    // Clear breathing pocket around spawn (18m outdoor city spawn, or 8.5m on KTX platform while keeping window bangers outside train!)
    const clearR = isKtxPreset ? 8.5 : 18.0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.isAlive || a.role !== 'infected') continue;
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
    this.windowBreachCooldown = 2.4;

    const wp = this.computeEscapeWaypoint(player.x, player.z);
    this.firstPerson = {
      active: true,
      playerId: player.id,
      yaw: initialYaw,
      pitch: 0,
      stamina: 100,
      maxStamina: 100,
      sprinting: false,
      nearestZombieDist: 999,
      nearbyGateId: null,
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
      nearbyTrainDoorId: null,
      nearTrainCabinConsole: false,
      insideTrainCar: 0,
      waypointX: wp.x,
      waypointZ: wp.z,
      waypointLabel: wp.label,
      spawnLabel,
      outcome: 'PLAYING',
      survivalTime: 0
    };

    this.triggerAlert(
      `📍 ESCAPE START: ${spawnLabel} — [Space] Vault/Shove • [Q] Decoy • [E] Doors/Cars/Loot`,
      'info'
    );
    return player;
  }

  public exitFirstPerson(): void {
    if (this.firstPerson.playerId !== null) {
      const player = this.getAgentById(this.firstPerson.playerId);
      if (player) {
        player.isPlayerControlled = false;
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
    pitch: number
  ): AgentData | null {
    if (!this.firstPerson.active || this.firstPerson.playerId === null) return null;
    const player = this.getAgentById(this.firstPerson.playerId);
    if (!player) return null;

    this.firstPerson.yaw = yaw;
    this.firstPerson.pitch = pitch;

    if (!player.isAlive || player.role === 'infected' || player.civState === 'CONVULSING') {
      this.firstPerson.outcome = 'INFECTED';
      return player;
    }

    if (this.firstPerson.outcome !== 'PLAYING') {
      return player;
    }

    if (this.expressTrain.playerDeparting) {
      this.firstPerson.survivalTime += dt;
      this.firstPerson.insideTrainCar = 1;
      this.expressTrain.playerInsideCar = 1;
      this.firstPerson.nearbyTrainDoorId = null;
      this.firstPerson.nearTrainCabinConsole = false;
      this.firstPerson.nearbyPickupId = null;
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

      const baseSpeed = this.firstPerson.sprinting ? 8.5 : 5.2;
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
        player.x += player.vx * dt;
        player.z += player.vz * dt;
        player.rotationY = Math.atan2(dx, dz);
        player.animPhase += speed * dt * 3.2;

        resolveWorldCollisions(player, 0.68, this.city, this.defenseWalls, this.blastGates, 0, this.interiorDoors);
        this.resolveTrainCollisions(player, 0.62);
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
        if (!other.isAlive || other.id === player.id || other.civState === 'SHELTERED') continue;
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
          const push = (minGap - dist) / dist;
          other.x += dx * push;
          other.z += dz * push;
        }
      }
      for (let i = 0; i < this.vehicles.length; i++) {
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
    const vaultTarget = !this.fpVaultActive ? this.findVaultTarget(player, yaw) : null;
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
          if (!z.isAlive || z.role !== 'infected') continue;
          const dx = z.x - player.x;
          const dz = z.z - player.z;
          const d = Math.hypot(dx, dz) || 0.01;
          const dot = (dx / d) * fX + (dz / d) * fZ;
          if (d < 1.85 || dot > 0.15) {
            this.releaseGrapple(z);
            z.x += (dx / d) * 3.6;
            z.z += (dz / d) * 3.6;
            z.stunnedTimer = Math.max(z.stunnedTimer, 1.55);
            resolveWorldCollisions(z, 0.55, this.city, this.defenseWalls, this.blastGates, z.climbY, this.interiorDoors);
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

    const currentCar = this.getTrainCarForPos(player.x, player.z);
    this.firstPerson.insideTrainCar = currentCar;
    this.expressTrain.playerInsideCar = currentCar;

    let nearTrainDoorId: number | null = null;
    let bestTrainDoorDist = 2.65;
    if (this.expressTrain.active && this.expressTrain.state === 'DOCKED') {
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

    const nearCabinConsole =
      this.expressTrain.active &&
      this.expressTrain.state === 'DOCKED' &&
      currentCar === 1 &&
      Math.hypot(
        player.x - (this.expressTrain.x + this.expressTrain.cabinSwitchLocalX),
        player.z - this.expressTrain.z
      ) < 3.4;
    this.firstPerson.nearTrainCabinConsole = nearCabinConsole;

    if (interactPressed) {
      if (nearCabinConsole) {
        this.expressTrain.state = 'DEPARTING';
        this.expressTrain.timer = 5.5;
        this.expressTrain.playerDeparting = true;
        this.expressTrain.departRideTimer = 1.6;
        if (this.onSound) this.onSound('train_horn', this.expressTrain.stationX, this.expressTrain.stationZ);
        this.triggerAlert('🚄 KTX-101 EMERGENCY DEPARTURE INITIATED — HANG ON!', 'info');
        return player;
      } else if (nearTrainDoorId !== null) {
        const td = this.expressTrain.doors.find((d) => d.id === nearTrainDoorId && !d.isBroken);
        if (td) {
          td.isLocked = !td.isLocked;
          if (this.onSound) this.onSound('gate_slam', this.expressTrain.x + td.localX, this.expressTrain.z);
          this.triggerAlert(
            td.isLocked ? `🔒 SEALED ${td.label}!` : `🔓 UNLOCKED ${td.label}`,
            td.isLocked ? 'warn' : 'info'
          );
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

    const wp = this.computeEscapeWaypoint(player.x, player.z);
    this.firstPerson.waypointX = wp.x;
    this.firstPerson.waypointZ = wp.z;
    this.firstPerson.waypointLabel = wp.label;

    // Speed up Express Train only while waiting on platform; escape triggers inside walkable 3-car KTX (Car 1 [E] or riding out)
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
    if (ez && Math.hypot(player.x - ez.x, player.z - ez.z) <= ez.radius) {
      player.isEvacuated = true;
      ez.extractedCount++;
      this.totalEvacuated++;
      this.firstPerson.outcome = 'ESCAPED';
      this.logAgentAction(player, `Escaped via Evacuation Perimeter!`);
    }

    return player;
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

  public toggleBlastGate(gateId: number): boolean {
    const g = this.blastGates.find((bg) => bg.id === gateId);
    if (!g || g.breached) return false;
    g.isOpen = !g.isOpen;
    if (this.onSound) this.onSound('gate_slam', g.x, g.z);
    const stateLabel = g.isOpen ? 'OPENED' : 'SEALED';
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
      a.climbY = 0;
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
    this.commandPoints -= 20;

    const targetNode = this.city.findNearestNode(x, z);
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
    return true;
  }

  public deploySwatSquad(x: number, z: number): boolean {
    if (!this.config.allowPlayerIntervention || this.commandPoints < 35) return false;
    this.commandPoints -= 35;

    const targetNode = this.city.findNearestNode(x, z);
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
    this.commandPoints -= 15;

    const node = this.city.findNearestNode(x, z);
    this.holdZones.push({
      id: this.nextEntityId++,
      x: node.x,
      z: node.z,
      radius: 6.5,
      active: true
    });

    const officers = this.agents
      .filter((a) => a.isAlive && a.role === 'police')
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
      if (!a.isAlive || a.isEvacuated || a.role !== 'civilian' || a.civState === 'SHELTERED') continue;
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

    const w1 = this.defenseWalls.find((w) => w.layerIndex === 1);
    const w2 = this.defenseWalls.find((w) => w.layerIndex === 2);
    const w3 = this.defenseWalls.find((w) => w.layerIndex === 3);

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
      line1Status: !w1 ? 'NONE' : w1.breachedNotified ? 'BREACHED' : 'HOLDING',
      line2Status: !w2 ? 'NONE' : w2.breachedNotified ? 'BREACHED' : 'HOLDING',
      line3Status: !w3 ? 'NONE' : w3.breachedNotified ? 'BREACHED' : 'HOLDING',
      trainBoarded: this.expressTrain.boardedTotal,
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
