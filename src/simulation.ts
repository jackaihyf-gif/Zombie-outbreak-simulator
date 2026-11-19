import { CityLayout } from './cityData';
import { generateAgentName, SeededRNG } from './rng';
import { hasLineOfSight, resolveWorldCollisions, SpatialGrid } from './spatial';
import {
  AgentData,
  AgentRole,
  AlertBanner,
  BlastGateData,
  BuildingData,
  DefenseWallData,
  EvacZoneData,
  EventLogItem,
  ExpressTrainData,
  FirstPersonState,
  HoldZoneData,
  IncidentReport,
  LureFlareData,
  PrioritySectorData,
  RoadblockData,
  ScenarioConfig,
  SimulationStats,
  TimeSeriesPoint,
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
  type: 'gunshot' | 'swat_shot' | 'radio' | 'cure' | 'bite' | 'siren' | 'explosion' | 'train_horn' | 'gate_slam',
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

    this.agents = [];
    this.vehicles = [];
    this.defenseWalls = [];
    this.blastGates = [];
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
      timer: 16,
      boardedTotal: 0,
      stationX: this.city.stationPos.x,
      stationZ: this.city.stationPos.z,
      length: 50
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
      outcome: null,
      survivalTime: 0
    };

    this.spawnInitialPopulation();
    this.spawnInitialVehicles();

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
      const node = this.rng.pick(this.city.navNodes);
      const civ = this.createAgent(
        'civilian',
        node.x + this.rng.range(-1.5, 1.5),
        node.z + this.rng.range(-1.5, 1.5),
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

  public step(dt: number): void {
    this.simTime += dt;

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
   * High-Speed Express Train cycle (Train to Busan style):
   * COOLDOWN (18s) -> APPROACHING (5s, horn + alert) -> DOCKED (14s boarding) -> DEPARTING (5s)
   */
  private updateExpressTrain(dt: number): void {
    const tr = this.expressTrain;
    if (!tr.active) return;

    const half = this.city.cityHalfX;
    const minX = -half - 65;
    const maxX = half + 65;

    tr.timer -= dt;

    if (tr.state === 'COOLDOWN') {
      tr.x = minX;
      if (tr.timer <= 0) {
        tr.state = 'APPROACHING';
        tr.timer = 5.0;
        this.effects.push({
          type: 'train_horn',
          x: tr.stationX,
          z: tr.stationZ,
          age: 0,
          duration: 1.5
        });
        if (this.onSound) this.onSound('train_horn', tr.stationX, tr.stationZ);
        this.triggerAlert('🚄 KTX EXPRESS APPROACHING STATION — 5s TO BOARDING!', 'info');
        this.addEventLog(
          'evac',
          `TRAIN ALERT: High-speed evacuation express approaching Grand Concourse!`,
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
        tr.timer = 14.0;
        tr.x = tr.stationX;
        this.triggerAlert('🚄 KTX EXPRESS DOCKED — 14s BOARDING WINDOW OPEN!', 'info');
      }
    } else if (tr.state === 'DOCKED') {
      tr.x = tr.stationX;
      const platX = tr.stationX;
      const platZ = tr.stationZ - 5.5;

      // Board civilians who reach the platform
      for (let i = 0; i < this.agents.length; i++) {
        const a = this.agents[i];
        if (!a.isAlive || a.isEvacuated || a.role !== 'civilian' || a.isPlayerControlled) continue;
        if (a.civState === 'SHELTERED' || a.civState === 'CONVULSING') continue;

        const distPlat = Math.hypot(a.x - platX, a.z - platZ);
        if (distPlat <= 13.5) {
          a.isEvacuated = true;
          tr.boardedTotal++;
          this.totalEvacuated++;
          this.logAgentAction(a, `Boarded the KTX Express Evacuation Train!`);
        } else if (distPlat <= 75 && a.civState !== 'EVACUATING' && a.repathCooldown <= 0) {
          a.civState = 'EVACUATING';
          a.repathCooldown = 1.2;
          a.destinationLabel = 'Express Train Platform';
          a.path = this.city.findPath(
            a.x,
            a.z,
            platX,
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
        tr.timer = 5.0;
        if (this.onSound) this.onSound('train_horn', tr.stationX, tr.stationZ);
        this.addEventLog(
          'evac',
          `TRAIN DEPARTED: Express departed with ${tr.boardedTotal} total evacuees!`,
          tr.stationX,
          tr.stationZ
        );
      }
    } else if (tr.state === 'DEPARTING') {
      const p = 1 - Math.max(0, tr.timer) / 5.0;
      const eased = p * p;
      tr.x = tr.stationX + (maxX - tr.stationX) * eased;
      this.plowZombiesOnTrack(tr);

      if (tr.timer <= 0) {
        tr.state = 'COOLDOWN';
        tr.timer = 18.0;
        tr.x = minX;
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
      const buckets: AgentData[][] = Array.from({ length: bucketCount }, () => []);

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

  private updateMedic(m: AgentData, dt: number): void {
    if (m.perceptionCooldown <= 0) {
      m.perceptionCooldown = 0.24 + (m.id % 5) * 0.03;

      const neighbors = this.spatial.queryRadius(m.x, m.z, m.awarenessRadius, this.neighborBuffer);
      let nearestZombie: AgentData | null = null;
      let nearestZombieDist = Infinity;
      let nearestPatient: AgentData | null = null;
      let bestPatientScore = Infinity;

      for (let i = 0; i < neighbors.length; i++) {
        const other = neighbors[i];
        if (!other.isAlive || other.id === m.id) continue;
        const d = Math.hypot(other.x - m.x, other.z - m.z);

        if (other.role === 'infected') {
          if (d < nearestZombieDist) {
            nearestZombieDist = d;
            nearestZombie = other;
          }
        } else if (
          (other.isIncubating || other.civState === 'CONVULSING' || other.health < other.maxHealth * 0.8) &&
          !other.isPlayerControlled
        ) {
          const score = d - (other.isIncubating || other.civState === 'CONVULSING' ? 40 : 0);
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
          const b = this.city.buildings.find((bld) => bld.id === a.shelterBuildingId);
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

    if (a.civState === 'SHELTERED') {
      const b = this.city.buildings.find((bld) => bld.id === a.shelterBuildingId);
      if (!b || b.doorIntegrity <= 0) {
        this.removeAgentFromShelter(a);
        a.civState = 'FLEEING';
        this.logAgentAction(a, 'Building shelter breached! Fleeing into street!');
      }
      return;
    }

    if (a.perceptionCooldown <= 0) {
      a.perceptionCooldown = 0.24 + (a.id % 5) * 0.03;

      const neighbors = this.spatial.queryRadius(a.x, a.z, a.awarenessRadius, this.neighborBuffer);
      let nearestThreat: AgentData | null = null;
      let nearestThreatDist = Infinity;
      let threatCount = 0;
      let nearestPanicking: AgentData | null = null;

      for (let i = 0; i < neighbors.length; i++) {
        const other = neighbors[i];
        if (other.id === a.id || !other.isAlive) continue;

        const dist = Math.hypot(other.x - a.x, other.z - a.z);
        if (other.role === 'infected' || other.civState === 'CONVULSING') {
          if (
            dist < 6.5 ||
            hasLineOfSight(a.x, a.z, other.x, other.z, this.city, this.defenseWalls, this.blastGates)
          ) {
            threatCount++;
            if (dist < nearestThreatDist) {
              nearestThreatDist = dist;
              nearestThreat = other;
            }
          }
        } else if (
          other.role === 'civilian' &&
          (other.civState === 'FLEEING' || other.civState === 'BEING_ATTACKED') &&
          dist < 10.0
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
              a.civState = 'SEEKING_SHELTER';
              a.shelterBuildingId = shelter.id;
              a.destinationLabel = `Shelter: ${shelter.name}`;
              a.path = this.city.findPath(
                a.x,
                a.z,
                shelter.doorX,
                shelter.doorZ,
                this.roadblocks,
                this.defenseWalls,
                this.blastGates,
                false
              );
              a.pathIndex = 0;
              a.repathCooldown = 1.1;
              this.logAgentAction(a, `Running for shelter at ${shelter.name}.`);
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
            this.blastGates
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
        const shelter = this.city.buildings.find((b) => b.id === a.shelterBuildingId);
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
    if (z.perceptionCooldown <= 0) {
      z.perceptionCooldown = 0.24 + (z.id % 5) * 0.03;

      const neighbors = this.spatial.queryRadius(z.x, z.z, z.awarenessRadius + 6, this.neighborBuffer);
      let bestTarget: AgentData | null = null;
      let bestScore = Infinity;
      let nearbyZombies = 0;

      for (let i = 0; i < neighbors.length; i++) {
        const candidate = neighbors[i];
        if (!candidate.isAlive) continue;
        const dist = Math.hypot(candidate.x - z.x, candidate.z - z.z);

        if (candidate.role === 'infected') {
          if (dist < 8.0) nearbyZombies++;
          continue;
        }
        if (candidate.civState === 'CONVULSING') continue;

        const isLoud =
          candidate.civState === 'FLEEING' ||
          candidate.policeState === 'ENGAGING' ||
          dist < 7.0;

        if (dist <= z.awarenessRadius || isLoud) {
          if (
            dist < 6.0 ||
            hasLineOfSight(z.x, z.z, candidate.x, candidate.z, this.city, this.defenseWalls, this.blastGates)
          ) {
            const score = dist + (candidate.isIncubating ? 24.0 : 0);
            if (score < bestScore) {
              bestScore = score;
              bestTarget = candidate;
            }
          }
        }
      }

      z.perceivedThreats = nearbyZombies;
      z.targetAgentId = bestTarget ? bestTarget.id : null;
    }

    const hordeFrenzy = z.perceivedThreats >= 4 ? 1.22 : 1.0;
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
        const lungeBoost = (targetDist < 7.0 ? 1.24 : 1.12) * hordeFrenzy;
        this.steerTowards(z, currentTarget.x, currentTarget.z, z.baseSpeed * lungeBoost, dt);
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
      z.path = this.city.findPath(
        z.x,
        z.z,
        goalNode.x,
        goalNode.z,
        this.roadblocks,
        this.defenseWalls,
        this.blastGates,
        true
      );
      z.pathIndex = 0;
      z.repathCooldown = 1.0;
    }
  }

  private performZombieAttack(zombie: AgentData, victim: AgentData): void {
    this.effects.push({
      type: 'bite',
      x: victim.x,
      z: victim.z,
      age: 0,
      duration: 0.55
    });
    if (this.onSound) this.onSound('bite', victim.x, victim.z);

    const isBrute = zombie.zombieVariant === 'brute';
    const baseDmg = isBrute ? 48 : 34;

    if (victim.isSwat) {
      victim.health -= isBrute ? 28 : 16;
      if (!isBrute) {
        const dx = zombie.x - victim.x;
        const dz = zombie.z - victim.z;
        const len = Math.hypot(dx, dz) || 1;
        zombie.x += (dx / len) * 1.4;
        zombie.z += (dz / len) * 1.4;
        this.logAgentAction(victim, `Repelled zombie lunge with SWAT shield!`);
      }
    } else {
      victim.health -= baseDmg;
    }

    if (victim.role === 'civilian') {
      if (!victim.isPlayerControlled) {
        victim.civState = 'BEING_ATTACKED';
        victim.stateTimer = 4.0;
      }

      if (!victim.isIncubating && victim.health > 0) {
        victim.isIncubating = true;
        victim.incubationTimer = this.config.incubationSeconds;
        victim.maxIncubationTime = this.config.incubationSeconds;
        this.logAgentAction(victim, `Bitten by ${zombie.name}! Infection incubating...`);
        this.logAgentAction(zombie, `Attacked and infected ${victim.name}.`);
        if (!victim.isPlayerControlled) {
          this.fleeFromThreat(victim, zombie.x, zombie.z);
        }
      }
    } else if (victim.role === 'police' && !victim.isSwat) {
      this.logAgentAction(victim, `Ambushed in close quarters by ${zombie.name}!`);
    }

    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (!v.isAbandoned && Math.hypot(v.x - victim.x, v.z - victim.z) < 7.5) {
        v.isAbandoned = true;
        v.speed = 0;
      }
    }

    if (victim.health <= 0) {
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

  public convertToInfected(agent: AgentData): void {
    const oldRole = agent.role;
    agent.role = 'infected';
    agent.isSwat = false;
    agent.isIncubating = false;
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

    if (p.perceptionCooldown <= 0) {
      p.perceptionCooldown = 0.22 + (p.id % 5) * 0.03;

      const neighbors = this.spatial.queryRadius(p.x, p.z, p.awarenessRadius, this.neighborBuffer);
      let nearestZombie: AgentData | null = null;
      let nearestDist = Infinity;
      let closeThreats = 0;

      for (let i = 0; i < neighbors.length; i++) {
        const other = neighbors[i];
        if (!other.isAlive || other.role !== 'infected') continue;
        const dist = Math.hypot(other.x - p.x, other.z - p.z);
        if (dist < 4.2) closeThreats++;

        if (
          dist < nearestDist &&
          hasLineOfSight(p.x, p.z, other.x, other.z, this.city, this.defenseWalls, this.blastGates)
        ) {
          nearestDist = dist;
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

    this.effects.push({
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
    a.path = this.city.findPath(
      a.x,
      a.z,
      targetNode.x,
      targetNode.z,
      this.roadblocks,
      this.defenseWalls,
      this.blastGates,
      false
    );
    a.pathIndex = 0;
    a.destinationLabel = `Fleeing towards ${targetNode.district}`;
  }

  private startEvacuating(a: AgentData, ez: EvacZoneData): void {
    if (a.civState === 'EVACUATING') return;
    a.civState = 'EVACUATING';
    a.repathCooldown = 1.1;
    a.destinationLabel = 'Evacuation Zone';
    a.path = this.city.findPath(
      a.x,
      a.z,
      ez.x,
      ez.z,
      this.roadblocks,
      this.defenseWalls,
      this.blastGates,
      false
    );
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
    const candidates = this.city.getBuildingsNearPos(x, z, this.buildingBuffer);
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
    const b = this.city.buildings.find((bld) => bld.id === a.shelterBuildingId);
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
    const boundX = this.city.cityHalfX + 5;
    const boundZ = this.city.cityHalfZ + 5;

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.isAlive || a.isEvacuated || a.civState === 'SHELTERED') continue;

      if (!a.isPlayerControlled) {
        const nearby = this.spatial.queryRadius(a.x, a.z, minSep * 1.4, this.neighborBuffer);
        let pushX = 0;
        let pushZ = 0;
        const limit = Math.min(nearby.length, 10);
        for (let j = 0; j < limit; j++) {
          const b = nearby[j];
          if (b.id === a.id) continue;
          const dx = a.x - b.x;
          const dz = a.z - b.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.001 && d < minSep) {
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

      resolveWorldCollisions(a, 0.55, this.city, this.defenseWalls, this.blastGates, a.climbY);

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

  public enterFirstPerson(): AgentData {
    // Release any previous player flag
    if (this.firstPerson.playerId !== null) {
      const prev = this.getAgentById(this.firstPerson.playerId);
      if (prev) prev.isPlayerControlled = false;
    }

    let player: AgentData | null = null;
    if (this.selectedAgentId !== null) {
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
      }
    }

    if (!player) {
      let spawnX = 0;
      let spawnZ = -this.city.cityHalfZ + 36;
      if (this.config.mapId === 'citadel_express') {
        spawnX = -52.5;
        spawnZ = -172;
      } else {
        const roadXs =
          this.city.roadXs.length > 0 ? this.city.roadXs : this.city.roadCoords;
        const roadX = roadXs.length > 0 ? this.rng.pick(roadXs) : 0;
        spawnX = roadX;
      }
      player = this.createAgent('civilian', spawnX, spawnZ, false);
      resolveWorldCollisions(player, 0.68, this.city, this.defenseWalls, this.blastGates, 0);
      player.name = `${player.name} (You)`;
      player.destinationLabel = 'Fleeing to Extraction';
      this.pushAgent(player);
    }

    player.isPlayerControlled = true;
    this.selectedAgentId = player.id;

    // Ensure clean panoramic West Blvd opening frame (relocate zombies hugging immediate spawn < 14m)
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.isAlive || a.role !== 'infected') continue;
      if (Math.hypot(a.x - player.x, a.z - player.z) < 14.5) {
        a.x = -52.5 + this.rng.range(-5.5, 5.5);
        a.z = player.z + this.rng.range(18, 32);
        resolveWorldCollisions(a, 0.55, this.city, this.defenseWalls, this.blastGates, a.climbY);
      }
    }

    this.firstPerson = {
      active: true,
      playerId: player.id,
      yaw: Math.PI, // face South toward Defense Lines / Express Station
      pitch: 0,
      stamina: 100,
      maxStamina: 100,
      sprinting: false,
      nearestZombieDist: 999,
      nearbyGateId: null,
      outcome: 'PLAYING',
      survivalTime: 0
    };

    return player;
  }

  public exitFirstPerson(): void {
    if (this.firstPerson.playerId !== null) {
      const player = this.getAgentById(this.firstPerson.playerId);
      if (player) {
        player.isPlayerControlled = false;
      }
    }
    this.firstPerson.active = false;
    this.firstPerson.outcome = null;
  }

  public updateFirstPersonPlayer(
    dt: number,
    moveForward: number,
    moveRight: number,
    wantSprint: boolean,
    interactPressed: boolean,
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

    this.firstPerson.survivalTime += dt;

    const isMoving = moveForward !== 0 || moveRight !== 0;
    if (wantSprint && isMoving && this.firstPerson.stamina > 2) {
      this.firstPerson.sprinting = true;
      this.firstPerson.stamina = Math.max(0, this.firstPerson.stamina - dt * 24);
    } else {
      this.firstPerson.sprinting = false;
      this.firstPerson.stamina = Math.min(100, this.firstPerson.stamina + dt * 16);
    }

    const speed = this.firstPerson.sprinting ? 6.3 : 3.3;
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

      resolveWorldCollisions(player, 0.68, this.city, this.defenseWalls, this.blastGates, 0);
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

    if (interactPressed && nearGateId !== null) {
      this.toggleBlastGate(nearGateId);
    }

    // Check nearest zombie distance for danger heartbeat vignette
    const nearZ = this.spatial.queryRadius(player.x, player.z, 24, this.neighborBuffer);
    let minZDist = 999;
    for (let i = 0; i < nearZ.length; i++) {
      const other = nearZ[i];
      if (other.isAlive && other.role === 'infected') {
        const d = Math.hypot(other.x - player.x, other.z - player.z);
        if (d < minZDist) minZDist = d;
      }
    }
    this.firstPerson.nearestZombieDist = minZDist;

    // Check extraction victory (Express Train DOCKED or active Evac Zone)
    if (
      this.expressTrain.active &&
      this.expressTrain.state === 'DOCKED' &&
      Math.hypot(player.x - this.expressTrain.stationX, player.z - (this.expressTrain.stationZ - 5.5)) <= 14.0
    ) {
      player.isEvacuated = true;
      this.totalEvacuated++;
      this.expressTrain.boardedTotal++;
      this.firstPerson.outcome = 'ESCAPED';
      this.logAgentAction(player, `Escaped aboard the KTX Express Evacuation Train!`);
      return player;
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
