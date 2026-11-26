import type { KtxGateId } from './ktxTerminal';
import type { TrainLayout } from './trainLayout';
export type GraphicsQuality = 'high' | 'medium' | 'low';

export type MapId =
  | 'citadel_express'
  | 'grand_metropolis'
  | 'twin_bridges'
  | 'quarantine_citadel'
  | 'bsl4_lab';

export type ScenarioId =
  | 'wwz_busan'
  | 'patient_zero'
  | 'multi_epicenter'
  | 'horde_invasion'
  | 'breach_siege'
  | 'delayed_response'
  | 'super_spreader'
  | 'no_intervention';

export type TacticalTool =
  | 'inspect'
  | 'deploy_police'
  | 'deploy_swat'
  | 'deploy_hunters'
  | 'deploy_medic'
  | 'lure_flare'
  | 'frag_bomb'
  | 'roadblock'
  | 'defend_zone'
  | 'evac_zone'
  | 'priority_sector';

export type AgentRole = 'civilian' | 'infected' | 'police' | 'medic';

export type ZombieVariant = 'standard' | 'runner' | 'brute';

export type ZombieAttackMode =
  | 'none'
  | 'tackle_pin'
  | 'neck_grapple'
  | 'claw_swipe'
  | 'brute_slam';

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
  | 'FEEDING'
  | 'BREACHING';

export type PoliceState =
  | 'PATROLLING'
  | 'RESPONDING'
  | 'INVESTIGATING'
  | 'ENGAGING'
  | 'HOLDING_POSITION'
  | 'CLIMBING'
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
  kind:
    | 'car'
    | 'taxi'
    | 'van'
    | 'truck_burning'
    | 'bus'
    | 'jersey_barrier'
    | 'container'
    | 'parkour_fence'
    | 'dumpster';
  color: number;
  isBurning?: boolean;
  cosR?: number;
  sinR?: number;
  boundR?: number;
}

export interface OverpassData {
  axis: 'EW' | 'NS';
  x: number;
  z: number;
  length: number;
  width: number;
  deckY: number;
  pillarPositions: Array<{ x: number; z: number }>;
  label: string;
}

export interface SkybridgeData {
  axis: 'EW' | 'NS';
  x: number;
  z: number;
  length: number;
  width: number;
  deckY: number;
  label: string;
  ladderXs?: [number, number];
}

export interface ExplosiveHazardData {
  id: number;
  kind: 'fuel_truck' | 'fuel_barrel';
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotationY: number;
  hp: number;
  maxHp: number;
  blastRadius: number;
  damage: number;
  detonated: boolean;
  burningTimer: number;
  label: string;
  cosR?: number;
  sinR?: number;
  boundR?: number;
}

export interface WayfindingSignData {
  x: number;
  z: number;
  y: number;
  width: number;
  height: number;
  rotationY: number;
  title: string;
  subtitle: string;
  accentColor: string;
  gantrySpan?: number;
}

export interface LabContainmentPodData {
  id: number;
  x: number;
  z: number;
  breached: boolean;
  breachAt: number;
  label: string;
}

export interface ExtractionApcData {
  active: boolean;
  x: number;
  z: number;
  startZ: number;
  tunnelGateZ: number;
  exitZ: number;
  state: 'STANDBY' | 'WARMING_UP' | 'BOARDING' | 'DEPARTING' | 'ESCAPED';
  timer: number;
  warmupDuration: number;
  shutterOpenFraction: number;
  boardedCount: number;
  playerAboard: boolean;
  waveTriggeredHalfway: boolean;
}

export interface TrainBulkheadDoorData {
  id: number;
  localX: number;
  label: string;
  isLocked: boolean;
  isBroken: boolean;
  integrity: number;
  maxIntegrity: number;
  lastHitTime: number;
  manualUntil: number;
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
  openFraction: number;
  breached: boolean;
  integrity: number;
  maxIntegrity: number;
  lastDamagedAt: number;
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
  pyramidBreachNotified: boolean;
  pyramidHeights: number[];
  bucketSize: number;
  retreatLadderXs: number[];
}

export interface ExpressTrainData {
  active: boolean;
  x: number;
  z: number;
  state: 'COOLDOWN' | 'APPROACHING' | 'DOCKED' | 'DEPARTING' | 'QUARANTINE';
  timer: number;
  boardedTotal: number;
  stationX: number;
  stationZ: number;
  layout: TrainLayout;
  currentLoad: number;
  carHeight: number;
  boardingDoorLocalX: number;
  cabinSwitchLocalX: number;
  doors: TrainBulkheadDoorData[];
  playerInsideCar: number;
  playerDeparting: boolean;
}

export interface SupplyPickupData {
  id: number;
  x: number;
  z: number;
  kind: 'energy_drink' | 'antiviral_kit' | 'emergency_pack';
  label: string;
  collected: boolean;
}

export interface AmmoCacheData {
  id: number;
  x: number;
  y: number;
  z: number;
  readyAt: number;
}

export type PlayerRole = 'civilian' | 'police' | 'swat';
export type PlayerWeapon = 'pistol' | 'shotgun' | 'carbine';

export interface PlayerSpawnPoint extends Vec2 {
  y: number;
  wallId?: number;
}

export interface PlayerWeaponState {
  id: PlayerWeapon;
  ammo: number;
  reserve: number;
  cooldown: number;
  reloadTimer: number;
  reloadDuration?: number;
  activeReloadAttempted?: boolean;
  activeReloadFeedback?: 'none' | 'perfect' | 'jammed';
  activeReloadFeedbackTimer?: number;
  steadyTimer?: number;
  dryFireCooldown?: number;
  shots: number;
  lastHit: boolean;
  hitTimer: number;
  lastHeadshot?: boolean;
  spread?: number;
}

export interface PlayerMission {
  kind: 'hold' | 'clear';
  x: number;
  y: number;
  z: number;
  district: string;
  remaining: number;
  hostiles: number;
  totalTargets: number;
  targetIds: number[];
  complete: boolean;
}

export interface CrisisBanner {
  id: number;
  titleEn: string;
  titleZh: string;
  subtitleEn: string;
  subtitleZh: string;
  severity: 'warn' | 'danger' | 'info';
  timestamp: number;
  duration: number;
  x?: number;
  z?: number;
}

export interface KillFeedCallout {
  seq: number;
  kind: 'headshot' | 'streak' | 'brute' | 'reward' | 'hazard';
  textEn: string;
  textZh: string;
  timestamp: number;
}

export interface FirstPersonState {
  active: boolean;
  playerId: number | null;
  role: PlayerRole;
  weapon: PlayerWeaponState | null;
  mission: PlayerMission | null;
  killRewardProgress: number;
  killRewardAmmo: number;
  yaw: number;
  pitch: number;
  stamina: number;
  maxStamina: number;
  sprinting: boolean;
  nearestZombieDist: number;
  nearbyGateId: number | null;
  wallLadder: 'up' | 'down' | 'climbing' | null;
  skybridgeLadder?: 'up' | 'down' | 'climbing' | null;
  nearbyDoorId: number | null;
  insideBuildingId: string | null;
  pursuers: number;
  shoveCooldown: number;
  decoyCooldown: number;
  adrenalineTimer: number;
  vaultY: number;
  vaultRoll: number;
  nearbyVaultLabel: string | null;
  nearbyCarId: number | null;
  nearbyPickupId: number | null;
  nearbyAmmoId: number | null;
  nearbyTrainDoorId: number | null;
  nearbyKtxGate: KtxGateId | null;
  nearTrainCabinConsole: boolean;
  insideTrainCar: number;
  nearExtractionApc?: 'ignite' | 'warming' | 'board' | null;
  insideExtractionApc?: boolean;
  waypointX: number;
  waypointZ: number;
  waypointLabel: string;
  spawnLabel: string;
  outcome: 'PLAYING' | 'ESCAPED' | 'INFECTED' | 'QUARANTINED' | null;
  survivalTime: number;
  damageFlashTimer?: number;
  damageFromAngle?: number;
  aiming?: boolean;
  flashlightOn?: boolean;
  flashlightFlickerTimer?: number;
  lastStandCooldown?: number;
  kills?: number;
  headshots?: number;
  bruteKills?: number;
  shotsFired?: number;
  shotsHit?: number;
  killStreak?: number;
  killStreakTimer?: number;
  maxKillStreak?: number;
  lastCallout?: KillFeedCallout | null;
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

export interface InteriorBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  kind:
    | 'wall'
    | 'shelf'
    | 'counter'
    | 'cooler'
    | 'bed'
    | 'pillar'
    | 'bench'
    | 'ticket_booth'
    | 'turnstile'
    | 'departure_board'
    | 'escalator';
  color?: number;
}

export interface InteriorDoorData {
  id: number;
  buildingId: string;
  label: string;
  side: 'N' | 'S' | 'E' | 'W';
  x: number;
  z: number;
  width: number;
  isGlass: boolean;
  isLocked: boolean;
  isBroken: boolean;
  integrity: number;
  maxIntegrity: number;
  lastHitTime: number;
}

export interface BuildingInteriorData {
  theme: 'mart' | 'clinic' | 'hospital' | 'terminal';
  floorHeight: number;
  walls: InteriorBox[];
  props: InteriorBox[];
  doorIds: number[];
  lightFixtures: Array<{ x: number; z: number; flickerSeed: number }>;
}

export interface BrokenWindowData {
  buildingId: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
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
  interior?: BuildingInteriorData;
  hasUpperBreach?: boolean;
  blackoutStage?: number;
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
  isHunter?: boolean;
  avoidsEvacuation?: boolean;
  zombieVariant: ZombieVariant;
  x: number;
  z: number;
  vx: number;
  vz: number;
  rotationY: number;
  climbY: number;
  onWallDeck?: boolean;
  wallAimPitch?: number;
  onTerminalFloor?: boolean;
  convulseTimer: number;
  fallY: number;
  fallVy: number;
  fallRoll: number;
  stunnedTimer: number;
  attackMode: ZombieAttackMode;
  grappleTargetId: number | null;
  pinnedById: number | null;
  pinTimer: number;
  biteCount: number;
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
  isTrainPassenger?: boolean;
  perceivedThreats: number;
  recentLogs: string[];
  lastProgressX: number;
  lastProgressZ: number;
  stuckTimer: number;
  avoidSide: number;
  avoidTimer: number;
  hitFlinchTimer?: number;
  hitFlashTimer?: number;
  hitSlowTimer?: number;
  hitDirX?: number;
  hitDirZ?: number;
  deathTimer?: number;
  deathAge?: number;
  deathDirX?: number;
  deathDirZ?: number;
  deathHeadshot?: boolean;
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
    | 'player_shot'
    | 'bite'
    | 'blood_burst'
    | 'report_ring'
    | 'convert'
    | 'evac_flash'
    | 'cure'
    | 'lure_pulse'
    | 'explosion'
    | 'train_horn'
    | 'window_shatter'
    | 'door_pound'
    | 'car_alarm_pulse';
  x: number;
  z: number;
  y?: number;
  dirX?: number;
  dirZ?: number;
  targetX?: number;
  targetY?: number;
  targetZ?: number;
  impact?: 'dust' | 'metal' | 'infected';
  headshot?: boolean;
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
  line1Status: 'HOLDING' | 'WITHDRAWN' | 'BREACHED' | 'NONE';
  line2Status: 'HOLDING' | 'WITHDRAWN' | 'BREACHED' | 'NONE';
  line3Status: 'HOLDING' | 'WITHDRAWN' | 'BREACHED' | 'NONE';
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
