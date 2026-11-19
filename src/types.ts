export type MapId =
  | 'citadel_express'
  | 'grand_metropolis'
  | 'twin_bridges'
  | 'quarantine_citadel';

export type ScenarioId =
  | 'wwz_busan'
  | 'patient_zero'
  | 'multi_epicenter'
  | 'horde_invasion'
  | 'delayed_response'
  | 'super_spreader'
  | 'no_intervention';

export type TacticalTool =
  | 'inspect'
  | 'deploy_police'
  | 'deploy_swat'
  | 'deploy_medic'
  | 'lure_flare'
  | 'frag_bomb'
  | 'roadblock'
  | 'defend_zone'
  | 'evac_zone'
  | 'priority_sector';

export type AgentRole = 'civilian' | 'infected' | 'police' | 'medic';

export type ZombieVariant = 'standard' | 'runner' | 'brute';

export type CivilianState =
  | 'WALKING'
  | 'SOCIALIZING'
  | 'INVESTIGATING'
  | 'REPORTING'
  | 'FRIGHTENED'
  | 'FLEEING'
  | 'SEEKING_SHELTER'
  | 'SHELTERED'
  | 'EVACUATING'
  | 'BEING_ATTACKED'
  | 'INCUBATING'
  | 'CONVULSING';

export type ZombieState =
  | 'WANDERING'
  | 'PURSUING'
  | 'ATTACKING'
  | 'BREACHING';

export type PoliceState =
  | 'PATROLLING'
  | 'RESPONDING'
  | 'INVESTIGATING'
  | 'ENGAGING'
  | 'HOLDING_POSITION'
  | 'RETREATING';

export type MedicState =
  | 'PATROLLING'
  | 'RESPONDING'
  | 'TREATING'
  | 'FLEEING';

export interface Vec2 {
  x: number;
  z: number;
}

export interface RiverChannel {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface BridgeSpan {
  x: number;
  z: number;
  width: number;
  length: number;
  axis: 'z';
  name: string;
}

export interface StaticObstacleData {
  id: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotationY: number;
  kind: 'car' | 'taxi' | 'van' | 'truck_burning' | 'jersey_barrier' | 'container';
  color: number;
  isBurning?: boolean;
}

export interface ParkingLotFeature {
  x: number;
  z: number;
  width: number;
  depth: number;
  orientation: 'NS' | 'EW';
}

export interface BlastGateData {
  id: number;
  wallId: number;
  x: number;
  z: number;
  width: number;
  isOpen: boolean;
  breached: boolean;
  integrity: number;
  maxIntegrity: number;
  label: string;
}

export interface DefenseWallData {
  id: number;
  z: number;
  thickness: number;
  height: number;
  minX: number;
  maxX: number;
  label: string;
  layerIndex: number;
  breachedNotified: boolean;
  pyramidHeights: number[];
  bucketSize: number;
}

export interface ExpressTrainData {
  active: boolean;
  x: number;
  z: number;
  state: 'COOLDOWN' | 'APPROACHING' | 'DOCKED' | 'DEPARTING';
  timer: number;
  boardedTotal: number;
  stationX: number;
  stationZ: number;
  length: number;
}

export interface FirstPersonState {
  active: boolean;
  playerId: number | null;
  yaw: number;
  pitch: number;
  stamina: number;
  maxStamina: number;
  sprinting: boolean;
  nearestZombieDist: number;
  nearbyGateId: number | null;
  outcome: 'PLAYING' | 'ESCAPED' | 'INFECTED' | null;
  survivalTime: number;
}

export interface LureFlareData {
  id: number;
  x: number;
  z: number;
  radius: number;
  remaining: number;
  maxDuration: number;
  active: boolean;
}

export interface AlertBanner {
  text: string;
  severity: 'info' | 'warn' | 'danger';
  timestamp: number;
}

export interface BuildingData {
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
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  doorX: number;
  doorZ: number;
  color: number;
  accentColor: number;
  roofType: 'flat' | 'tower' | 'skyscraper' | 'pitched' | 'helipad' | 'hospital' | 'warehouse';
  isShelterCapable: boolean;
  shelterCapacity: number;
  shelteredAgentIds: number[];
  doorIntegrity: number;
  maxDoorIntegrity: number;
}

export interface NavNode {
  id: number;
  x: number;
  z: number;
  neighbors: number[];
  district: string;
  isIntersectionCorner: boolean;
}

export interface AgentData {
  id: number;
  name: string;
  role: AgentRole;
  isSwat: boolean;
  zombieVariant: ZombieVariant;
  x: number;
  z: number;
  vx: number;
  vz: number;
  rotationY: number;
  climbY: number;
  convulseTimer: number;
  isPlayerControlled: boolean;
  health: number;
  maxHealth: number;
  baseSpeed: number;
  bravery: number;
  awarenessRadius: number;

  // State machine fields
  civState: CivilianState;
  zombieState: ZombieState;
  policeState: PoliceState;
  medicState: MedicState;
  stateTimer: number;
  perceptionCooldown: number;
  repathCooldown: number;

  // Navigation
  path: Vec2[];
  pathIndex: number;
  targetPos: Vec2 | null;
  destinationLabel: string;
  homeBuildingId: string | null;
  shelterBuildingId: string | null;

  // Infection & Combat
  isIncubating: boolean;
  incubationTimer: number;
  maxIncubationTime: number;
  targetAgentId: number | null;
  threatPos: Vec2 | null;
  attackCooldown: number;
  reportProgress: number;
  hasReported: boolean;

  // Police / SWAT / Medic specific
  ammo: number;
  maxAmmo: number;
  reloadTimer: number;
  assignedZonePos: Vec2 | null;
  kills: number;
  cures: number;

  // Visual & Story
  shirtColor: number;
  pantsColor: number;
  skinColor: number;
  hairColor: number;
  animPhase: number;
  isAlive: boolean;
  isEvacuated: boolean;
  perceivedThreats: number;
  recentLogs: string[];
}

export interface VehicleData {
  id: number;
  type: 'sedan' | 'taxi' | 'van' | 'truck' | 'police_cruiser' | 'ambulance';
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  maxSpeed: number;
  color: number;
  isAbandoned: boolean;
  isBurning: boolean;
  isRunaway: boolean;
  runawayTimer: number;
  laneAxis: 'x' | 'z';
  laneCoord: number;
  hazardPhase: number;
}

export interface RoadblockData {
  id: number;
  x: number;
  z: number;
  rotationY: number;
  radius: number;
  integrity: number;
  maxIntegrity: number;
  active: boolean;
}

export interface EvacZoneData {
  id: number;
  x: number;
  z: number;
  radius: number;
  extractedCount: number;
  active: boolean;
}

export interface HoldZoneData {
  id: number;
  x: number;
  z: number;
  radius: number;
  active: boolean;
}

export interface PrioritySectorData {
  district: string;
  x: number;
  z: number;
  radius: number;
  active: boolean;
}

export interface IncidentReport {
  id: number;
  x: number;
  z: number;
  district: string;
  timestamp: number;
  dispatched: boolean;
  respondersAssigned: number;
  severity: number;
}

export interface VisualEffectEvent {
  type:
    | 'gunshot'
    | 'bite'
    | 'report_ring'
    | 'convert'
    | 'evac_flash'
    | 'cure'
    | 'lure_pulse'
    | 'explosion'
    | 'train_horn';
  x: number;
  z: number;
  targetX?: number;
  targetZ?: number;
  age: number;
  duration: number;
}

export interface EventLogItem {
  id: number;
  simTime: number;
  formattedTime: string;
  category: 'infection' | 'report' | 'police' | 'evac';
  message: string;
  x: number;
  z: number;
}

export interface TimeSeriesPoint {
  time: number;
  healthy: number;
  panicking: number;
  infected: number;
  evacuated: number;
  deceased: number;
}

export interface SimulationStats {
  healthy: number;
  panicking: number;
  sheltered: number;
  incubating: number;
  infected: number;
  brutes: number;
  police: number;
  medics: number;
  cured: number;
  evacuated: number;
  deceased: number;
  activeReports: number;
  commandPoints: number;
  hordeWave: number;
  line1Status: 'HOLDING' | 'BREACHED' | 'NONE';
  line2Status: 'HOLDING' | 'BREACHED' | 'NONE';
  line3Status: 'HOLDING' | 'BREACHED' | 'NONE';
  trainBoarded: number;
  simTime: number;
  outbreakStatus: 'CITY NORMAL' | 'LOCAL INCIDENT' | 'ACTIVE OUTBREAK' | 'CONTAINED' | 'CRITICAL COLLAPSE';
}

export interface ScenarioConfig {
  id: ScenarioId;
  mapId: MapId;
  seed: string;
  population: number;
  incubationSeconds: number;
  initialPolice: number;
  initialInfected: number;
  dispatchDelaySeconds: number;
  allowPlayerIntervention: boolean;
  enableWaves: boolean;
  fastStrain: boolean;
}
