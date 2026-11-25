import * as THREE from 'three';
import { AgentData, VehicleData } from './types';
import { AgentArchetype, VoxelTextureStudio } from './voxelTextures';

interface ArchetypeBucket {
  archetype: AgentArchetype;
  maxCount: number;
  activeCount: number;
  headInst: THREE.InstancedMesh;
  torsoInst: THREE.InstancedMesh;
  leftArmInst: THREE.InstancedMesh;
  rightArmInst: THREE.InstancedMesh;
  leftLegInst: THREE.InstancedMesh;
  rightLegInst: THREE.InstancedMesh;
}

interface VehicleVisualRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  hazardLeft: THREE.Mesh;
  hazardRight: THREE.Mesh;
  coneLeft: THREE.Mesh;
  coneRight: THREE.Mesh;
  sirenRed?: THREE.Mesh;
  sirenBlue?: THREE.Mesh;
}

interface Mat3 {
  r00: number;
  r10: number;
  r20: number;
  r01: number;
  r11: number;
  r21: number;
  r02: number;
  r12: number;
  r22: number;
}

const BUCKET_CAPS: Record<AgentArchetype, number> = {
  civilian: 2400,
  zombie_normal: 2400,
  zombie_runner: 1200,
  zombie_brute: 220,
  police: 320,
  swat: 200,
  medic: 200
};

const ALL_ARCHETYPES: AgentArchetype[] = [
  'civilian',
  'police',
  'swat',
  'medic',
  'zombie_normal',
  'zombie_runner',
  'zombie_brute'
];

export class AgentRenderer {
  public agentsGroup: THREE.Group;
  public vehiclesGroup: THREE.Group;
  private textures: VoxelTextureStudio;

  private buckets = new Map<AgentArchetype, ArchetypeBucket>();
  private shadowInst!: THREE.InstancedMesh;
  private weaponInst!: THREE.InstancedMesh;
  private maxShadows = 3000;
  private maxWeapons = 520;

  private vehicleRigs: Map<number, VehicleVisualRig> = new Map();
  private selectionBeacon: THREE.Group;

  private tmpColor = new THREE.Color();
  private whiteColor = new THREE.Color(0xffffff);
  private corpseColor = new THREE.Color(0x827070);
  private flashBodyColor = new THREE.Color(0xff9e9e);
  private flashHeadColor = new THREE.Color(0xffd4d4);
  private zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();
  private cullSphere = new THREE.Sphere(new THREE.Vector3(), 2.8);
  private camPos = new THREE.Vector3();

  private rootBasis: Mat3 = {
    r00: 1,
    r10: 0,
    r20: 0,
    r01: 0,
    r11: 1,
    r21: 0,
    r02: 0,
    r12: 0,
    r22: 1
  };
  private partBasis: Mat3 = {
    r00: 1,
    r10: 0,
    r20: 0,
    r01: 0,
    r11: 1,
    r21: 0,
    r02: 0,
    r12: 0,
    r22: 1
  };

  constructor(scene: THREE.Scene, textures?: VoxelTextureStudio) {
    this.textures = textures ?? new VoxelTextureStudio();
    this.agentsGroup = new THREE.Group();
    this.vehiclesGroup = new THREE.Group();
    scene.add(this.agentsGroup);
    scene.add(this.vehiclesGroup);

    this.initInstancedMeshes();

    this.selectionBeacon = new THREE.Group();
    const selRing = new THREE.Mesh(
      new THREE.RingGeometry(0.65, 0.85, 24),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide })
    );
    selRing.rotation.x = -Math.PI / 2;
    selRing.position.y = 0.08;

    const selCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.24, 0.55, 8),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    selCone.rotation.x = Math.PI;
    selCone.position.y = 2.55;
    this.selectionBeacon.add(selRing, selCone);
    this.selectionBeacon.visible = false;
    scene.add(this.selectionBeacon);
  }

  private initInstancedMeshes(): void {
    // Properly pivoted voxel body geometries
    const headGeo = new THREE.BoxGeometry(0.42, 0.42, 0.42);
    headGeo.translate(0, 0.21, 0); // Pivot at neck bottom

    const torsoGeo = new THREE.BoxGeometry(0.46, 0.60, 0.26);

    const armGeo = new THREE.BoxGeometry(0.16, 0.56, 0.16);
    armGeo.translate(0, -0.22, 0); // Pivot at shoulder

    const legGeo = new THREE.BoxGeometry(0.18, 0.58, 0.18);
    legGeo.translate(0, -0.26, 0); // Pivot at hip

    const makeInst = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material | THREE.Material[],
      maxCount: number,
      castShadow: boolean
    ) => {
      const inst = new THREE.InstancedMesh(geo, mat, maxCount);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.castShadow = castShadow;
      inst.receiveShadow = false;
      inst.frustumCulled = false;
      inst.count = 0;
      for (let i = 0; i < maxCount; i++) {
        inst.setMatrixAt(i, this.zeroMatrix);
        inst.setColorAt(i, this.whiteColor);
      }
      this.agentsGroup.add(inst);
      return inst;
    };

    for (const arch of ALL_ARCHETYPES) {
      const maxCount = BUCKET_CAPS[arch];
      const mats = this.textures.getAgentMaterials(arch);
      const bucket: ArchetypeBucket = {
        archetype: arch,
        maxCount,
        activeCount: 0,
        headInst: makeInst(headGeo, mats.headMats, maxCount, false),
        torsoInst: makeInst(torsoGeo, mats.torsoMats, maxCount, false),
        leftArmInst: makeInst(armGeo, mats.armMat, maxCount, false),
        rightArmInst: makeInst(armGeo, mats.armMat, maxCount, false),
        leftLegInst: makeInst(legGeo, mats.legMat, maxCount, false),
        rightLegInst: makeInst(legGeo, mats.legMat, maxCount, false)
      };
      this.buckets.set(arch, bucket);
    }

    // Grounded subtle voxel drop shadow
    const shadowGeo = new THREE.PlaneGeometry(0.62, 0.62);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x05070c,
      transparent: true,
      opacity: 0.36,
      depthWrite: false
    });
    this.shadowInst = makeInst(shadowGeo, shadowMat, this.maxShadows, false);

    // Dark gunmetal voxel firearm attached to right hand local space when armed officers engage
    const weaponGeo = new THREE.BoxGeometry(0.08, 0.56, 0.12);
    weaponGeo.translate(0, -0.46, 0.08);
    const weaponMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.45,
      metalness: 0.55
    });
    this.weaponInst = makeInst(weaponGeo, weaponMat, this.maxWeapons, false);
  }

  public clearAll(): void {
    for (const bucket of this.buckets.values()) {
      bucket.activeCount = 0;
      bucket.headInst.count = 0;
      bucket.torsoInst.count = 0;
      bucket.leftArmInst.count = 0;
      bucket.rightArmInst.count = 0;
      bucket.leftLegInst.count = 0;
      bucket.rightLegInst.count = 0;
    }
    this.shadowInst.count = 0;
    this.weaponInst.count = 0;

    for (const vRig of this.vehicleRigs.values()) {
      this.vehiclesGroup.remove(vRig.root);
    }
    this.vehicleRigs.clear();
    this.selectionBeacon.visible = false;
  }

  private computeBasis(out: Mat3, yaw: number, pitch: number, roll: number): void {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);

    out.r00 = cy * cr + sy * sp * sr;
    out.r10 = cp * sr;
    out.r20 = -sy * cr + cy * sp * sr;

    out.r01 = -cy * sr + sy * sp * cr;
    out.r11 = cp * cr;
    out.r21 = sy * sr + cy * sp * cr;

    out.r02 = sy * cp;
    out.r12 = -sp;
    out.r22 = cy * cp;
  }

  private writePartMatrix3D(
    arr: Float32Array,
    idx16: number,
    ax: number,
    ay: number,
    az: number,
    s: number,
    lx: number,
    ly: number,
    lz: number,
    py: number,
    pp: number,
    pr: number
  ): void {
    const R = this.rootBasis;
    const tx = ax + s * (R.r00 * lx + R.r01 * ly + R.r02 * lz);
    const ty = ay + s * (R.r10 * lx + R.r11 * ly + R.r12 * lz);
    const tz = az + s * (R.r20 * lx + R.r21 * ly + R.r22 * lz);

    if (py === 0 && pp === 0 && pr === 0) {
      arr[idx16 + 0] = R.r00 * s;
      arr[idx16 + 1] = R.r10 * s;
      arr[idx16 + 2] = R.r20 * s;
      arr[idx16 + 3] = 0;

      arr[idx16 + 4] = R.r01 * s;
      arr[idx16 + 5] = R.r11 * s;
      arr[idx16 + 6] = R.r21 * s;
      arr[idx16 + 7] = 0;

      arr[idx16 + 8] = R.r02 * s;
      arr[idx16 + 9] = R.r12 * s;
      arr[idx16 + 10] = R.r22 * s;
      arr[idx16 + 11] = 0;
    } else {
      this.computeBasis(this.partBasis, py, pp, pr);
      const L = this.partBasis;

      arr[idx16 + 0] = (R.r00 * L.r00 + R.r01 * L.r10 + R.r02 * L.r20) * s;
      arr[idx16 + 1] = (R.r10 * L.r00 + R.r11 * L.r10 + R.r12 * L.r20) * s;
      arr[idx16 + 2] = (R.r20 * L.r00 + R.r21 * L.r10 + R.r22 * L.r20) * s;
      arr[idx16 + 3] = 0;

      arr[idx16 + 4] = (R.r00 * L.r01 + R.r01 * L.r11 + R.r02 * L.r21) * s;
      arr[idx16 + 5] = (R.r10 * L.r01 + R.r11 * L.r11 + R.r12 * L.r21) * s;
      arr[idx16 + 6] = (R.r20 * L.r01 + R.r21 * L.r11 + R.r22 * L.r21) * s;
      arr[idx16 + 7] = 0;

      arr[idx16 + 8] = (R.r00 * L.r02 + R.r01 * L.r12 + R.r02 * L.r22) * s;
      arr[idx16 + 9] = (R.r10 * L.r02 + R.r11 * L.r12 + R.r12 * L.r22) * s;
      arr[idx16 + 10] = (R.r20 * L.r02 + R.r21 * L.r12 + R.r22 * L.r22) * s;
      arr[idx16 + 11] = 0;
    }

    arr[idx16 + 12] = tx;
    arr[idx16 + 13] = ty;
    arr[idx16 + 14] = tz;
    arr[idx16 + 15] = 1;
  }

  private resolveArchetype(a: AgentData): AgentArchetype {
    if (a.role === 'civilian' && a.civState === 'CONVULSING') {
      return 'zombie_normal';
    }
    if (a.role === 'infected') {
      if (a.zombieVariant === 'brute') return 'zombie_brute';
      if (a.zombieVariant === 'runner') return 'zombie_runner';
      return 'zombie_normal';
    }
    if (a.role === 'police') {
      return a.isSwat ? 'swat' : 'police';
    }
    if (a.role === 'medic') return 'medic';
    return 'civilian';
  }

  public syncAgents(
    agents: AgentData[],
    selectedAgentId: number | null,
    simTime: number,
    hiddenAgentId: number | null = null,
    isFirstPerson = false,
    camera?: THREE.Camera
  ): void {
    for (const bucket of this.buckets.values()) {
      bucket.activeCount = 0;
    }

    let shadowCount = 0;
    let weaponCount = 0;
    let selectedFound = false;

    const shadowArr = this.shadowInst.instanceMatrix.array as Float32Array;
    const weaponArr = this.weaponInst.instanceMatrix.array as Float32Array;

    let useCulling = false;
    if (camera) {
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
      this.camPos.setFromMatrixPosition(camera.matrixWorld);
      useCulling = true;
    }

    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      const isDeadCorpse = !a.isAlive && (a.deathTimer ?? 0) > 0;
      if (
        (!a.isAlive && !isDeadCorpse) ||
        a.isEvacuated ||
        (a.isTrainPassenger && !a.onTerminalFloor) ||
        a.civState === 'SHELTERED' ||
        a.id === hiddenAgentId
      ) {
        continue;
      }

      let distSq = 0;
      if (useCulling) {
        const yCenter = a.climbY + a.fallY + 1.1;
        this.cullSphere.center.set(a.x, yCenter, a.z);
        if (selectedAgentId !== a.id && !this.frustum.intersectsSphere(this.cullSphere)) {
          continue;
        }
        const dxC = a.x - this.camPos.x;
        const dyC = yCenter - this.camPos.y;
        const dzC = a.z - this.camPos.z;
        distSq = dxC * dxC + dyC * dyC + dzC * dzC;
      }
      const isDistant = useCulling && distSq > 15625;

      const arch = this.resolveArchetype(a);
      const bucket = this.buckets.get(arch)!;
      const slot = bucket.activeCount;
      if (slot >= bucket.maxCount) continue;
      bucket.activeCount++;
      const idx16 = slot * 16;

      const scaleMult =
        a.role === 'infected'
          ? a.zombieVariant === 'brute'
            ? 1.46
            : a.zombieVariant === 'runner'
            ? 0.96
            : 1.02
          : a.isSwat
          ? 1.12
          : 1.0;

      const speedSq = a.vx * a.vx + a.vz * a.vz;
      const speed = speedSq > 1e-6 ? Math.sqrt(speedSq) : 0;
      const isConvulsing = a.role === 'civilian' && a.civState === 'CONVULSING';
      const isClimbing = a.role === 'infected' && a.climbY > 0.25 && !a.onWallDeck && !a.onTerminalFloor;

      let rootYawOffset = 0;
      let rootPitch = 0;
      let rootRoll = 0;
      let strideBounce = 0;

      let headYaw = 0;
      let headPitch = 0;
      let headRoll = 0;

      let lArmPitch = 0;
      let lArmYaw = 0;
      let lArmRoll = 0.08;

      let rArmPitch = 0;
      let rArmYaw = 0;
      let rArmRoll = -0.08;

      let lLegPitch = 0;
      let rLegPitch = 0;
      let lLegRoll = 0;
      let rLegRoll = 0;

      if (isDeadCorpse) {
        const fallP = Math.min(1, (a.deathAge ?? 0) / 0.34);
        const ease = 1 - (1 - fallP) * (1 - fallP);
        const fx = Math.sin(a.rotationY);
        const fz = Math.cos(a.rotationY);
        const hitDot = (a.deathDirX ?? 0) * fx + (a.deathDirZ ?? 0) * fz;
        const collapseSign = hitDot >= 0 ? 1 : -1;
        rootPitch = collapseSign * 1.48 * ease;
        rootRoll = ((a.id % 2 === 0 ? 1 : -1) * 0.25) * ease;
        headPitch = collapseSign * 0.28 * ease;
        headRoll = ((a.id % 3) - 1) * 0.22 * ease;
        lArmPitch = (-0.65 - ((a.id % 4) * 0.22)) * ease;
        rArmPitch = (-0.55 - (((a.id + 1) % 4) * 0.24)) * ease;
        lArmRoll = (0.42 + ((a.id % 3) * 0.14)) * ease;
        rArmRoll = (-0.42 - ((a.id % 3) * 0.14)) * ease;
        lLegPitch = 0.16 * ease;
        rLegPitch = -0.14 * ease;
        lLegRoll = 0.14 * ease;
        rLegRoll = -0.14 * ease;
      } else if (isConvulsing) {
        // Train-to-Busan brutal bone-snapping convulsion before turning
        const p = a.animPhase + simTime * 22;
        const jitter = Math.sin(p * 2.1 + a.id);
        const snapFinal = a.convulseTimer < 0.28;
        rootPitch = snapFinal ? -0.18 : 0.98 + Math.sin(p) * 0.18;
        rootRoll = Math.cos(p * 1.4) * 0.28;
        headRoll = snapFinal ? -0.58 : (a.id % 2 === 0 ? 1 : -1) * (0.55 + jitter * 0.35);
        headYaw = Math.sin(p * 1.8) * 0.45;
        headPitch = snapFinal ? -0.35 : 0.25;
        lArmPitch = -1.3 + jitter * 0.75;
        rArmPitch = -1.2 - jitter * 0.75;
        lArmRoll = 0.45;
        rArmRoll = -0.45;
        lLegPitch = -0.55;
        rLegPitch = 0.25;
      } else if (a.role !== 'infected' && a.pinnedById !== null) {
        const str = simTime * 22 + a.id;
        if (a.attackMode === 'tackle_pin') {
          rootPitch = -1.42;
          rootRoll = Math.sin(str) * 0.22;
          headPitch = -0.25;
          headRoll = Math.cos(str * 1.3) * 0.35;
          lArmPitch = -1.6 + Math.sin(str) * 0.7;
          rArmPitch = -1.6 - Math.cos(str) * 0.7;
          lArmRoll = 0.35;
          rArmRoll = -0.35;
          lLegPitch = Math.sin(str * 1.2) * 0.45;
          rLegPitch = -Math.sin(str * 1.2) * 0.45;
        } else {
          rootPitch = -0.24;
          rootRoll = Math.sin(str * 1.1) * 0.14;
          headPitch = -0.35;
          headRoll = Math.sin(str * 1.4) * 0.24;
          lArmPitch = -1.35 + Math.sin(str) * 0.25;
          rArmPitch = -1.35 - Math.sin(str) * 0.25;
          lArmRoll = 0.22;
          rArmRoll = -0.22;
          lLegPitch = 0.15;
          rLegPitch = -0.18;
        }
      } else if (a.role !== 'infected' && a.stunnedTimer > 0.4) {
        const rec = 1 - Math.min(1, a.stunnedTimer / 1.15);
        rootPitch = -1.25 * (1 - rec) - 0.15 * rec;
        rootRoll = Math.sin(simTime * 16 + a.id) * 0.24 * (1 - rec);
        lArmPitch = -1.1;
        rArmPitch = -0.9;
        lArmRoll = 0.4;
        rArmRoll = -0.4;
      } else if (a.role === 'infected') {
        const neckSign = a.id % 2 === 0 ? 1 : -1;
        const baseNeckTilt = neckSign * (0.24 + ((a.id * 19) % 24) * 0.01);

        if (a.fallY > 0.05) {
          // Mid-air window-breach tumbling & flailing limbs
          const flail = simTime * 22 + a.id;
          rootPitch = a.fallRoll;
          rootRoll = a.fallRoll * 0.55;
          headPitch = -0.35;
          headRoll = baseNeckTilt + Math.sin(flail) * 0.35;
          lArmPitch = -2.1 + Math.sin(flail) * 1.1;
          rArmPitch = -2.1 - Math.cos(flail) * 1.1;
          lArmRoll = 0.55;
          rArmRoll = -0.55;
          lLegPitch = Math.sin(flail * 1.2) * 0.95;
          rLegPitch = -Math.sin(flail * 1.2) * 0.95;
        } else if (a.stunnedTimer > 0) {
          // Ground/car-hood impact sprawl snapping grotesquely back upright
          const rec = 1 - Math.min(1, a.stunnedTimer / 0.65);
          rootPitch = (1 - rec) * 1.32 + rec * 0.38;
          rootRoll = Math.sin(simTime * 28 + a.id) * 0.28 * (1 - rec);
          headPitch = -0.42;
          headRoll = Math.sin(simTime * 35 + a.id) * 0.45;
          lArmPitch = -1.6 + (1 - rec) * 0.5;
          rArmPitch = -1.4 - (1 - rec) * 0.5;
          lArmRoll = 0.35;
          rArmRoll = -0.35;
          lLegPitch = (1 - rec) * 0.45;
          rLegPitch = -(1 - rec) * 0.35;
        } else if (isClimbing) {
          const climbCycle = simTime * 15 + a.id * 1.7;
          rootPitch = -0.22;
          rootRoll = Math.sin(climbCycle * 0.7) * 0.16;
          headPitch = -0.35;
          headRoll = baseNeckTilt + Math.sin(climbCycle * 1.5) * 0.14;
          lArmPitch = -2.25 + Math.sin(climbCycle) * 0.75;
          rArmPitch = -2.25 - Math.sin(climbCycle) * 0.75;
          lArmRoll = 0.22;
          rArmRoll = -0.22;
          lLegPitch = -Math.sin(climbCycle) * 0.85;
          rLegPitch = Math.sin(climbCycle) * 0.85;
        } else if (a.zombieState === 'FEEDING') {
          const biteT = simTime * 20 + a.id;
          if (a.attackMode === 'tackle_pin') {
            rootPitch = 1.08;
            rootRoll = Math.sin(biteT * 0.6) * 0.14;
            headPitch = 0.32 + Math.sin(biteT) * 0.42;
            headRoll = baseNeckTilt * 0.8 + Math.cos(biteT * 0.8) * 0.25;
            lArmPitch = -1.35 + Math.sin(biteT * 0.5) * 0.22;
            rArmPitch = -1.35 - Math.sin(biteT * 0.5) * 0.22;
            lArmRoll = 0.25;
            rArmRoll = -0.25;
            lLegPitch = -0.85;
            rLegPitch = -0.65;
          } else {
            rootPitch = 0.38;
            rootRoll = Math.sin(biteT * 0.7) * 0.12;
            headPitch = 0.2 + Math.sin(biteT * 0.9) * 0.25;
            headRoll = baseNeckTilt;
            lArmPitch = -1.55;
            rArmPitch = -1.55;
            lArmYaw = -0.35;
            rArmYaw = 0.35;
            lLegPitch = 0.25;
            rLegPitch = -0.22;
          }
        } else if (a.zombieState === 'ATTACKING' || a.attackCooldown > 0.32) {
          if (a.attackMode === 'brute_slam') {
            const smash = Math.sin(simTime * 14 + a.id);
            rootPitch = 0.45 + smash * 0.32;
            rootRoll = Math.cos(simTime * 10 + a.id) * 0.12;
            headPitch = -0.18;
            lArmPitch = -1.45 - smash * 1.1;
            rArmPitch = -1.45 - smash * 1.1;
            lArmRoll = 0.28;
            rArmRoll = -0.28;
            lLegPitch = 0.35;
            rLegPitch = -0.3;
          } else if (a.attackMode === 'claw_swipe') {
            const lungePhase = simTime * 22 + a.id;
            rootPitch = 0.52;
            rootYawOffset = Math.sin(lungePhase) * 0.42;
            rootRoll = Math.sin(lungePhase) * 0.22;
            headPitch = -0.22;
            headRoll = baseNeckTilt * 1.2;
            lArmPitch = -1.6 + Math.sin(lungePhase) * 0.95;
            rArmPitch = -1.6 - Math.sin(lungePhase) * 0.95;
            lArmYaw = -0.45 + Math.cos(lungePhase) * 0.5;
            rArmYaw = 0.45 - Math.cos(lungePhase) * 0.5;
            lArmRoll = 0.36;
            rArmRoll = -0.36;
            lLegPitch = 0.48;
            rLegPitch = -0.42;
          } else {
            // Feral lunge bite
            const lungePhase = simTime * 18 + a.id;
            rootPitch = 0.62;
            rootRoll = Math.sin(lungePhase) * 0.18;
            headPitch = -0.24;
            headRoll = baseNeckTilt * 1.15;
            lArmPitch = -1.75 + Math.sin(lungePhase) * 0.52;
            rArmPitch = -1.75 - Math.cos(lungePhase) * 0.52;
            lArmYaw = -0.25;
            rArmYaw = 0.25;
            lArmRoll = 0.24;
            rArmRoll = -0.24;
            lLegPitch = 0.48;
            rLegPitch = -0.42;
          }
        } else if (speed > 1.2) {
          // Terrifying World War Z / Busan rabid sprint
          const ph = a.animPhase * 1.15;
          const isRunner = a.zombieVariant === 'runner';
          rootPitch = isRunner ? 0.50 : 0.38;
          rootRoll = Math.sin(ph) * (isRunner ? 0.24 : 0.18);
          rootYawOffset = Math.cos(ph) * 0.16;
          strideBounce = Math.abs(Math.sin(ph)) * 0.13;

          headRoll = baseNeckTilt + Math.sin(simTime * 22 + a.id * 5) * 0.10;
          headPitch = -0.18 + Math.cos(ph * 2) * 0.08;
          headYaw = Math.sin(simTime * 14 + a.id) * 0.14;

          // Asymmetric rabid flailing arms
          lArmPitch = -0.95 + Math.sin(ph) * 0.92;
          rArmPitch = -0.95 - Math.sin(ph) * 0.92;
          lArmRoll = 0.28 + Math.sin(ph * 0.9) * 0.18;
          rArmRoll = -0.28 - Math.cos(ph * 0.9) * 0.18;
          lArmYaw = -0.20 + Math.cos(ph) * 0.25;
          rArmYaw = 0.20 - Math.cos(ph) * 0.25;

          const legAmp = isRunner ? 1.12 : 0.95;
          lLegPitch = Math.sin(ph) * legAmp;
          rLegPitch = -Math.sin(ph) * legAmp;
          lLegRoll = 0.06;
          rLegRoll = -0.06;
        } else {
          // Asymmetric shambling limp
          const ph = a.animPhase + simTime * 2.2;
          rootPitch = 0.26;
          rootRoll = 0.11 * neckSign + Math.sin(ph) * 0.08;
          headRoll = baseNeckTilt + Math.sin(simTime * 9 + a.id) * 0.06;
          headPitch = 0.18;
          lArmPitch = -0.85 + Math.sin(ph) * 0.22;
          rArmPitch = -1.15 - Math.sin(ph) * 0.22;
          lArmRoll = 0.16;
          rArmRoll = -0.16;
          lLegPitch = Math.sin(ph) * 0.42;
          rLegPitch = -Math.sin(ph) * 0.28;
        }

        if ((a.hitFlinchTimer ?? 0) > 0) {
          const fl = Math.min(1, a.hitFlinchTimer! / 0.25);
          rootPitch -= fl * 0.52;
          headPitch -= fl * 0.42;
          rootYawOffset += (a.id % 2 === 0 ? 1 : -1) * fl * 0.34;
          lArmPitch -= fl * 0.35;
          rArmPitch -= fl * 0.35;
        }
      } else if (a.role === 'police') {
        const swing = speed > 0.15 ? Math.sin(a.animPhase) * 0.65 : 0;
        const coveringRetreat = a.policeState === 'RETREATING' && a.targetAgentId !== null;
        const engaging = coveringRetreat ||
          a.policeState === 'ENGAGING' || a.policeState === 'HOLDING_POSITION';
        if (a.policeState === 'CLIMBING') {
          const reach = Math.sin(simTime * 9 + a.id) * 0.55;
          lArmPitch = -2.2 + reach;
          rArmPitch = -2.2 - reach;
          lLegPitch = -reach;
          rLegPitch = reach;
        } else if (engaging) {
          const downwardAim = (a.onWallDeck || a.onTerminalFloor) && a.targetAgentId !== null ? a.wallAimPitch ?? 0 : 0;
          rootYawOffset = -0.18;
          rootPitch = 0.06;
          headPitch = downwardAim * 0.65;
          rArmPitch = -1.48 + downwardAim;
          rArmYaw = 0.12;
          lArmPitch = -1.25 + downwardAim;
          lArmYaw = 0.44;
          lLegPitch = coveringRetreat ? -swing : 0.22;
          rLegPitch = coveringRetreat ? swing : -0.25;
        } else {
          rootPitch = speed > 1.8 ? 0.10 : 0;
          lArmPitch = -swing;
          rArmPitch = -0.55; // Carrying patrol carbine ready
          lLegPitch = swing;
          rLegPitch = -swing;
        }
      } else {
        // Civilians & Medics
        const swing = speed > 0.15 ? Math.sin(a.animPhase) * 0.85 : 0;
        const panicked =
          a.role === 'civilian' &&
          (a.civState === 'FLEEING' ||
            a.civState === 'FRIGHTENED' ||
            a.civState === 'SEEKING_SHELTER' ||
            a.civState === 'BEING_ATTACKED');
        if (panicked && speed > 0.6) {
          rootPitch = 0.18;
          strideBounce = Math.abs(Math.sin(a.animPhase)) * 0.07;
          headYaw = Math.sin(simTime * 3.4 + a.id * 3) * 0.32;
          lArmPitch = -swing * 1.15 - 0.35;
          rArmPitch = swing * 1.15 - 0.35;
          lArmRoll = 0.14;
          rArmRoll = -0.14;
          lLegPitch = swing * 1.05;
          rLegPitch = -swing * 1.05;
        } else {
          lArmPitch = -swing * 0.7;
          rArmPitch = swing * 0.7;
          lLegPitch = swing * 0.75;
          rLegPitch = -swing * 0.75;
        }
      }

      const jitterX = !isDistant && isConvulsing ? Math.sin(simTime * 58 + a.id) * 0.12 : 0;
      const jitterZ = !isDistant && isConvulsing ? Math.cos(simTime * 51 + a.id) * 0.12 : 0;
      const ax = a.x + jitterX;
      const az = a.z + jitterZ;
      const pinnedDrop =
        a.role !== 'infected' && a.pinnedById !== null && a.attackMode === 'tackle_pin'
          ? 0.44
          : 0;
      const feedDrop =
        a.role === 'infected' && a.zombieState === 'FEEDING' && a.attackMode === 'tackle_pin'
          ? 0.34
          : 0;
      const stunDrop =
        a.fallY <= 0.05 && a.stunnedTimer > 0
          ? a.role === 'infected'
            ? 0.48 * Math.min(1, a.stunnedTimer / 0.65)
            : 0.42 * Math.min(1, a.stunnedTimer / 1.1)
          : 0;
      const corpseSink = isDeadCorpse
        ? (Math.min(1, (a.deathAge ?? 0) / 0.34) * 0.05) +
          ((a.deathTimer ?? 0) < 1.2 ? (1 - (a.deathTimer ?? 0) / 1.2) * 0.48 : 0)
        : 0;
      const ay =
        (isConvulsing ? -0.14 : 0.22) +
        a.climbY +
        a.fallY +
        strideBounce -
        Math.max(stunDrop, pinnedDrop, feedDrop, corpseSink);

      this.computeBasis(
        this.rootBasis,
        a.rotationY + rootYawOffset,
        rootPitch,
        rootRoll
      );

      // Write all 6 limbs in local archetype bucket
      const headArr = bucket.headInst.instanceMatrix.array as Float32Array;
      const torsoArr = bucket.torsoInst.instanceMatrix.array as Float32Array;
      const lArmArr = bucket.leftArmInst.instanceMatrix.array as Float32Array;
      const rArmArr = bucket.rightArmInst.instanceMatrix.array as Float32Array;
      const lLegArr = bucket.leftLegInst.instanceMatrix.array as Float32Array;
      const rLegArr = bucket.rightLegInst.instanceMatrix.array as Float32Array;

      this.writePartMatrix3D(torsoArr, idx16, ax, ay, az, scaleMult, 0, 0.87, 0, 0, 0, 0);
      this.writePartMatrix3D(
        headArr,
        idx16,
        ax,
        ay,
        az,
        scaleMult,
        0,
        1.18,
        0,
        headYaw,
        headPitch,
        headRoll
      );
      this.writePartMatrix3D(
        lArmArr,
        idx16,
        ax,
        ay,
        az,
        scaleMult,
        -0.33,
        1.11,
        0,
        lArmYaw,
        lArmPitch,
        lArmRoll
      );
      this.writePartMatrix3D(
        rArmArr,
        idx16,
        ax,
        ay,
        az,
        scaleMult,
        0.33,
        1.11,
        0,
        rArmYaw,
        rArmPitch,
        rArmRoll
      );
      this.writePartMatrix3D(
        lLegArr,
        idx16,
        ax,
        ay,
        az,
        scaleMult,
        -0.12,
        0.56,
        0,
        0,
        lLegPitch,
        lLegRoll
      );
      this.writePartMatrix3D(
        rLegArr,
        idx16,
        ax,
        ay,
        az,
        scaleMult,
        0.12,
        0.56,
        0,
        0,
        rLegPitch,
        rLegRoll
      );

      // Per-instance colors: civilian outfits/skin varied dynamically; zombie hit-flash/corpse tints; others static white
      if (arch === 'civilian') {
        if (a.isIncubating) {
          this.tmpColor.setHex(0xb4b8a4); // Subtle pale sickly complexion without neon tinting
        } else {
          this.tmpColor.setHex(a.skinColor).lerp(this.whiteColor, 0.35);
        }
        bucket.headInst.setColorAt(slot, this.tmpColor);

        this.tmpColor.setHex(a.shirtColor);
        bucket.torsoInst.setColorAt(slot, this.tmpColor);
        bucket.leftArmInst.setColorAt(slot, this.tmpColor);
        bucket.rightArmInst.setColorAt(slot, this.tmpColor);

        this.tmpColor.setHex(a.pantsColor);
        bucket.leftLegInst.setColorAt(slot, this.tmpColor);
        bucket.rightLegInst.setColorAt(slot, this.tmpColor);
      } else if (arch === 'zombie_normal' || arch === 'zombie_runner' || arch === 'zombie_brute') {
        let headTint = this.whiteColor;
        let bodyTint = this.whiteColor;
        if (isDeadCorpse) {
          headTint = this.corpseColor;
          bodyTint = this.corpseColor;
        } else if ((a.hitFlashTimer ?? 0) > 0) {
          headTint = this.flashHeadColor;
          bodyTint = this.flashBodyColor;
        }
        bucket.headInst.setColorAt(slot, headTint);
        bucket.torsoInst.setColorAt(slot, bodyTint);
        bucket.leftArmInst.setColorAt(slot, bodyTint);
        bucket.rightArmInst.setColorAt(slot, bodyTint);
        bucket.leftLegInst.setColorAt(slot, bodyTint);
        bucket.rightLegInst.setColorAt(slot, bodyTint);
      }

      // Grounded drop shadow
      if (!isDistant && !isDeadCorpse && shadowCount < this.maxShadows) {
        const shIdx = shadowCount * 16;
        shadowArr[shIdx + 0] = scaleMult;
        shadowArr[shIdx + 1] = 0;
        shadowArr[shIdx + 2] = 0;
        shadowArr[shIdx + 3] = 0;
        shadowArr[shIdx + 4] = 0;
        shadowArr[shIdx + 5] = 1;
        shadowArr[shIdx + 6] = 0;
        shadowArr[shIdx + 7] = 0;
        shadowArr[shIdx + 8] = 0;
        shadowArr[shIdx + 9] = 0;
        shadowArr[shIdx + 10] = scaleMult;
        shadowArr[shIdx + 11] = 0;
        shadowArr[shIdx + 12] = ax;
        shadowArr[shIdx + 13] = 0.255 + a.climbY;
        shadowArr[shIdx + 14] = az;
        shadowArr[shIdx + 15] = 1;
        shadowCount++;
      }

      // Weapon rifle for Police / SWAT
      if ((arch === 'police' || arch === 'swat') && weaponCount < this.maxWeapons) {
        const wIdx = weaponCount * 16;
        this.writePartMatrix3D(
          weaponArr,
          wIdx,
          ax,
          ay,
          az,
          scaleMult,
          0.33,
          1.11,
          0,
          rArmYaw,
          rArmPitch,
          rArmRoll
        );
        weaponCount++;
      }

      if (!isFirstPerson && selectedAgentId === a.id) {
        selectedFound = true;
        this.selectionBeacon.visible = true;
        this.selectionBeacon.position.set(a.x, 0.25 + a.climbY, a.z);
        this.selectionBeacon.rotation.y = simTime * 2.2;
      }
    }

    for (const bucket of this.buckets.values()) {
      const c = bucket.activeCount;
      bucket.headInst.count = c;
      bucket.torsoInst.count = c;
      bucket.leftArmInst.count = c;
      bucket.rightArmInst.count = c;
      bucket.leftLegInst.count = c;
      bucket.rightLegInst.count = c;

      if (c > 0) {
        bucket.headInst.instanceMatrix.needsUpdate = true;
        bucket.torsoInst.instanceMatrix.needsUpdate = true;
        bucket.leftArmInst.instanceMatrix.needsUpdate = true;
        bucket.rightArmInst.instanceMatrix.needsUpdate = true;
        bucket.leftLegInst.instanceMatrix.needsUpdate = true;
        bucket.rightLegInst.instanceMatrix.needsUpdate = true;

        if (
          bucket.archetype === 'civilian' ||
          bucket.archetype === 'zombie_normal' ||
          bucket.archetype === 'zombie_runner' ||
          bucket.archetype === 'zombie_brute'
        ) {
          if (bucket.headInst.instanceColor) bucket.headInst.instanceColor.needsUpdate = true;
          if (bucket.torsoInst.instanceColor) bucket.torsoInst.instanceColor.needsUpdate = true;
          if (bucket.leftArmInst.instanceColor) bucket.leftArmInst.instanceColor.needsUpdate = true;
          if (bucket.rightArmInst.instanceColor) bucket.rightArmInst.instanceColor.needsUpdate = true;
          if (bucket.leftLegInst.instanceColor) bucket.leftLegInst.instanceColor.needsUpdate = true;
          if (bucket.rightLegInst.instanceColor) bucket.rightLegInst.instanceColor.needsUpdate = true;
        }
      }
    }

    this.shadowInst.count = shadowCount;
    if (shadowCount > 0) this.shadowInst.instanceMatrix.needsUpdate = true;

    this.weaponInst.count = weaponCount;
    if (weaponCount > 0) this.weaponInst.instanceMatrix.needsUpdate = true;

    if (!selectedFound || isFirstPerson) {
      this.selectionBeacon.visible = false;
    }
  }

  private createVehicleRig(v: VehicleData): VehicleVisualRig {
    const root = new THREE.Group();
    const bodyGroup = new THREE.Group();
    root.add(bodyGroup);

    const isPolice = v.type === 'police_cruiser';
    const isAmbulance = v.type === 'ambulance';
    const isTruck = v.type === 'truck';
    const isVan = v.type === 'van' || isAmbulance;

    const paintTex = this.textures.getVehiclePaintTexture();
    const bodyMat = new THREE.MeshStandardMaterial({
      map: paintTex,
      color: isPolice ? 0x111827 : isAmbulance ? 0xf8fafc : isTruck ? 0x991b1b : v.color,
      roughness: 0.55,
      metalness: 0.18
    });
    const whiteMat = new THREE.MeshStandardMaterial({ map: paintTex, color: 0xf1f5f9, roughness: 0.45 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0b1220,
      roughness: 0.15,
      metalness: 0.65
    });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.5 });

    const wheelGeo = new THREE.BoxGeometry(0.32, 0.54, 0.54);
    const hubGeo = new THREE.BoxGeometry(0.35, 0.22, 0.22);
    const addWheel = (wx: number, wz: number) => {
      const tire = new THREE.Mesh(wheelGeo, wheelMat);
      tire.position.set(wx, 0.27, wz);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.position.set(wx, 0.27, wz);
      bodyGroup.add(tire, hub);
    };

    if (isTruck) {
      const trailer = new THREE.Mesh(
        new THREE.BoxGeometry(2.15, 1.95, 4.35),
        new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.65 })
      );
      trailer.position.set(0, 1.28, -0.65);
      trailer.castShadow = true;

      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.98, 1.48, 1.6), bodyMat);
      cab.position.set(0, 1.02, 2.38);
      cab.castShadow = true;

      const cabGlass = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.55, 0.25), glassMat);
      cabGlass.position.set(0, 1.26, 3.12);

      const bumper = new THREE.Mesh(
        new THREE.BoxGeometry(2.05, 0.35, 0.35),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.5 })
      );
      bumper.position.set(0, 0.38, 3.22);

      bodyGroup.add(trailer, cab, cabGlass, bumper);
      for (const wz of [-2.1, -0.6, 2.35]) {
        addWheel(-0.98, wz);
        addWheel(0.98, wz);
      }
    } else {
      const chassis = new THREE.Mesh(
        new THREE.BoxGeometry(1.78, isVan ? 1.15 : 0.72, 3.65),
        bodyMat
      );
      chassis.position.y = isVan ? 0.86 : 0.62;
      chassis.castShadow = true;
      bodyGroup.add(chassis);

      if (isPolice) {
        const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.68, 1.45), whiteMat);
        doorPanel.position.set(0, 0.62, -0.05);
        const roofCabin = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.54, 1.85), whiteMat);
        roofCabin.position.set(0, 1.15, -0.15);
        roofCabin.castShadow = true;
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.38, 1.55), glassMat);
        win.position.set(0, 1.14, -0.15);
        bodyGroup.add(doorPanel, roofCabin, win);
      } else if (isAmbulance) {
        const redStripe = new THREE.Mesh(
          new THREE.BoxGeometry(1.84, 0.26, 3.45),
          new THREE.MeshBasicMaterial({ color: 0xdc2626 })
        );
        redStripe.position.y = 0.86;
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.42, 0.2), glassMat);
        win.position.set(0, 1.12, 1.76);
        bodyGroup.add(redStripe, win);
      } else if (!isVan) {
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.54, 1.85), bodyMat);
        cabin.position.set(0, 1.14, -0.15);
        cabin.castShadow = true;
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.38, 1.55), glassMat);
        win.position.set(0, 1.14, -0.15);
        bodyGroup.add(cabin, win);
      } else {
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.42, 0.2), glassMat);
        win.position.set(0, 1.12, 1.76);
        bodyGroup.add(win);
      }

      for (const wz of [-1.1, 1.15]) {
        addWheel(-0.82, wz);
        addWheel(0.82, wz);
      }
    }

    // Taillights
    const tailZ = isTruck ? -2.85 : -1.84;
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    const tailL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.1), tailMat);
    tailL.position.set(-0.6, 0.62, tailZ);
    const tailR = tailL.clone();
    tailR.position.x = 0.6;
    bodyGroup.add(tailL, tailR);

    // Headlights & volumetric beam cones
    const hazardZ = isTruck ? 3.22 : 1.84;
    const hazardMatL = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const hazardMatR = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const hazardLeft = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.12), hazardMatL);
    hazardLeft.position.set(-0.6, 0.62, hazardZ);
    const hazardRight = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.12), hazardMatR);
    hazardRight.position.set(0.6, 0.62, hazardZ);
    bodyGroup.add(hazardLeft, hazardRight);

    const coneGeo = new THREE.ConeGeometry(1.75, 11.0, 14, 1, true);
    coneGeo.translate(0, -5.5, 0);
    coneGeo.rotateX(-Math.PI / 2); // Tip at (0,0,0), widens toward +Z
    const coneMat = this.textures.createVolumetricConeMaterial(0xfff1bf, 0.24);
    const coneLeft = new THREE.Mesh(coneGeo, coneMat);
    coneLeft.position.set(-0.6, 0.62, hazardZ + 0.05);
    const coneRight = new THREE.Mesh(coneGeo, coneMat);
    coneRight.position.set(0.6, 0.62, hazardZ + 0.05);
    bodyGroup.add(coneLeft, coneRight);

    let sirenRed: THREE.Mesh | undefined;
    let sirenBlue: THREE.Mesh | undefined;
    if (isPolice || isAmbulance) {
      const topY = isAmbulance ? 1.52 : 1.50;
      sirenRed = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.18, 0.26),
        new THREE.MeshBasicMaterial({ color: 0xef4444 })
      );
      sirenRed.position.set(-0.32, topY, -0.1);
      sirenBlue = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.18, 0.26),
        new THREE.MeshBasicMaterial({ color: isAmbulance ? 0xf8fafc : 0x3b82f6 })
      );
      sirenBlue.position.set(0.32, topY, -0.1);
      bodyGroup.add(sirenRed, sirenBlue);
    }

    this.vehiclesGroup.add(root);
    return { root, bodyGroup, hazardLeft, hazardRight, coneLeft, coneRight, sirenRed, sirenBlue };
  }

  public syncVehicles(vehicles: VehicleData[], simTime: number): void {
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      let rig = this.vehicleRigs.get(v.id);
      if (!rig) {
        rig = this.createVehicleRig(v);
        this.vehicleRigs.set(v.id, rig);
      }

      rig.root.position.set(v.x, 0.02, v.z);
      rig.root.rotation.y = Math.atan2(v.dirX, v.dirZ);

      // Tilted wreckage for crashed burning trucks/cars
      if (v.isBurning) {
        rig.bodyGroup.rotation.z = v.type === 'truck' ? 0.34 : 0.12;
        rig.bodyGroup.position.y = v.type === 'truck' ? 0.22 : 0.05;
        rig.coneLeft.visible = false;
        rig.coneRight.visible = false;
      } else {
        rig.bodyGroup.rotation.z = 0;
        rig.bodyGroup.position.y = 0;
        rig.coneLeft.visible = !v.isAbandoned;
        rig.coneRight.visible = !v.isAbandoned;
      }

      if (v.isAbandoned) {
        const blink = Math.sin(simTime * 8 + v.hazardPhase) > 0;
        rig.hazardLeft.visible = blink;
        rig.hazardRight.visible = blink;
        (rig.hazardLeft.material as THREE.MeshBasicMaterial).color.setHex(0xf97316);
        (rig.hazardRight.material as THREE.MeshBasicMaterial).color.setHex(0xf97316);
      } else {
        rig.hazardLeft.visible = true;
        rig.hazardRight.visible = true;
      }

      if (rig.sirenRed && rig.sirenBlue) {
        const flash = Math.sin(simTime * 14 + v.id) > 0;
        rig.sirenRed.visible = flash;
        rig.sirenBlue.visible = !flash;
      }
    }
  }
}
