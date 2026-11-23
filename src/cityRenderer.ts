import { getTrainLayout, KTX_RAIL_EXTENSION, TRAIN_SEAT_SIDES, TRAIN_WIDTH } from './trainLayout';
import * as THREE from 'three';
import { BLOCK_PITCH, CityLayout, ROAD_WIDTH } from './cityData';
import { BLAST_GATE_WIDTH, ladderZ, WALL_DECK_OVERHANG, WALL_DECK_REAR_TRIM, wallLadderXs,
  WALL_DECK_RISE, wallRetreatLadderXs } from './perimeter';
import { KTX_BOXES, KTX_FORECOURT_CROSSING, KTX_GATES, KTX_GATE_IDS, KTX_PLATFORM_Y, KTX_SURFACES,
  type KtxGateId, type KtxGates, ktxGateBox, ktxSurfaceHeight } from './ktxTerminal';
import {
  AmmoCacheData,
  BlastGateData,
  BrokenWindowData,
  BuildingData,
  DefenseWallData,
  EvacZoneData,
  ExpressTrainData,
  HoldZoneData,
  InteriorDoorData,
  LureFlareData,
  PrioritySectorData,
  RoadblockData,
  StaticObstacleData,
  SupplyPickupData,
  TacticalTool,
  VehicleData,
  VisualEffectEvent
} from './types';
import { NeonSignLabel, VoxelTextureStudio } from './voxelTextures';

export type AtmosphereStage = 'dusk' | 'night' | 'day';

interface BlastGateVisual {
  group: THREE.Group;
  leftDoor: THREE.Mesh;
  rightDoor: THREE.Mesh;
  boomArmPivot: THREE.Group;
  beaconMat: THREE.MeshBasicMaterial;
}

interface TrainDoorVisual {
  doorGroup: THREE.Group;
  slidingLeaf: THREE.Mesh;
  glassMat: THREE.MeshBasicMaterial;
  lockBadge: THREE.Mesh;
  baseX: number;
  lastDamageStage: 0 | 1 | 2;
}

interface InteriorDoorVisual {
  group: THREE.Group;
  pivotLeft: THREE.Group;
  pivotRight: THREE.Group;
  lockBadge: THREE.Mesh;
  glassMat?: THREE.MeshBasicMaterial;
  frameMat: THREE.MeshStandardMaterial;
  baseX: number;
  baseZ: number;
  isGlass: boolean;
  lastDamageStage: 0 | 1 | 2;
}

interface InteriorLightVisual {
  bulbMat: THREE.MeshBasicMaterial;
  coneMesh: THREE.Mesh;
  buildingId: string;
  flickerSeed: number;
}

export class CityRenderer {
  public scene: THREE.Scene;
  public cityGroup: THREE.Group;
  public tacticalGroup: THREE.Group;
  public effectsGroup: THREE.Group;
  public worldBarsGroup: THREE.Group;
  public previewGroup: THREE.Group;
  public horizonGroup: THREE.Group;
  public groundMesh!: THREE.Mesh;

  public atmosphereStage: AtmosphereStage = 'dusk';

  private currentLayout!: CityLayout;
  private sunLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private ambientLight!: THREE.AmbientLight;
  private interiorPointLight!: THREE.PointLight;
  private trainRedPointLight!: THREE.PointLight;
  private baseAmbientIntensity = 0.48;
  private baseHemiIntensity = 0.78;
  private baseSunIntensity = 2.85;

  private skyDomeMesh!: THREE.Mesh;
  private skyMat!: THREE.MeshBasicMaterial;
  private skyTextures: Partial<Record<AtmosphereStage, THREE.CanvasTexture>> = {};

  private roadblockMeshes: Map<number, THREE.Group> = new Map();
  private evacMeshes: Map<number, THREE.Group> = new Map();
  private holdMeshes: Map<number, THREE.Group> = new Map();
  private lureMeshes: Map<number, THREE.Group> = new Map();
  private pickupMeshes: Map<number, THREE.Group> = new Map();
  private gateVisuals: Map<string, BlastGateVisual> = new Map();
  private interiorDoorVisuals: Map<number, InteriorDoorVisual> = new Map();
  private interiorFixtures: InteriorLightVisual[] = [];
  private alarmBeaconMeshes: Map<number, THREE.Object3D> = new Map();
  private brokenWindowCount = 0;
  private priorityMesh: THREE.Group | null = null;

  private expressTrainGroup: THREE.Group | null = null;
  private stationBeaconMat: THREE.MeshBasicMaterial | null = null;
  private trainDoorVisuals: Map<number, TrainDoorVisual> = new Map();
  private trainConsoleLightMat: THREE.MeshBasicMaterial | null = null;
  private trainEmergencyLightMats: THREE.MeshBasicMaterial[] = [];
  private elevatedSmokeEmitters: Array<{ x: number; y: number; z: number; seed: number }> = [];

  private textureStudio: VoxelTextureStudio;
  private streetLampCones: THREE.Mesh[] = [];
  private bloodStainInst!: THREE.InstancedMesh;
  private bloodStainCursor = 0;
  private bloodStainCount = 0;
  private maxBloodStains = 240;
  private stampedBloodEvents = new Set<string>();
  private shatterGlassMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    transparent: true,
    opacity: 0.44,
    roughness: 0.55
  });
  private shatterWoodMat = new THREE.MeshStandardMaterial({ color: 0x29201c, roughness: 0.9 });
  private emberMat = new THREE.MeshBasicMaterial({ color: 0xfb923c });
  private emberGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);

  // Holographic placement preview sub-meshes
  private previewRing!: THREE.Mesh;
  private previewBarricade!: THREE.Group;
  private previewBeam!: THREE.Mesh;

  // Shared pooled geometries & materials for zero-leak per-frame VFX
  private ringUnitGeo = new THREE.RingGeometry(0.75, 1.0, 24);
  private voxelUnitGeo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
  private dropletGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);
  private beamUnitGeo = new THREE.BoxGeometry(0.065, 0.065, 1.0);
  private barUnitGeo = new THREE.BoxGeometry(1.0, 0.24, 0.24);

  private gunBeamMat = new THREE.MeshBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.92 });
  private gunFlashMat = new THREE.MeshBasicMaterial({ color: 0xfde047 });
  private impactDustMat = new THREE.MeshBasicMaterial({ color: 0xc4b9a8, transparent: true, opacity: 0.72 });
  private reportRingMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.72
  });
  private trainHornMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.75
  });
  private cureRingMat = new THREE.MeshBasicMaterial({
    color: 0x10b981,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.75
  });
  private bloodDropletDarkMat = new THREE.MeshBasicMaterial({ color: 0x5c0a0d });
  private bloodDropletMidMat = new THREE.MeshBasicMaterial({ color: 0x881318 });
  private lureRingMat = new THREE.MeshBasicMaterial({
    color: 0xf43f5e,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.7
  });
  private explosionMat = new THREE.MeshBasicMaterial({
    color: 0xf97316,
    transparent: true,
    opacity: 0.88
  });
  private explosionCoreMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0.92
  });
  private explosionRingMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.82
  });
  private smokeMat = new THREE.MeshBasicMaterial({
    color: 0x1e222b,
    transparent: true,
    opacity: 0.72
  });
  private fireYellowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xfef08a).multiplyScalar(1.6),
    transparent: true,
    opacity: 0.95,
    toneMapped: false
  });
  private fireMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xf97316).multiplyScalar(1.55),
    transparent: true,
    opacity: 0.9,
    toneMapped: false
  });
  private barBgMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
  private barGreenMat = new THREE.MeshBasicMaterial({ color: 0x4ade80 });
  private barOrangeMat = new THREE.MeshBasicMaterial({ color: 0xf97316 });
  private barRedMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  private barPurpleMat = new THREE.MeshBasicMaterial({ color: 0xa855f7 });

  private fxFireOrangeInst!: THREE.InstancedMesh;
  private fxFireYellowInst!: THREE.InstancedMesh;
  private fxSmokeInst!: THREE.InstancedMesh;
  private fxEmberInst!: THREE.InstancedMesh;
  private fxBloodDarkInst!: THREE.InstancedMesh;
  private fxBloodMidInst!: THREE.InstancedMesh;
  private fxShatterGlassInst!: THREE.InstancedMesh;
  private fxShatterWoodInst!: THREE.InstancedMesh;
  private fxGunBeamInst!: THREE.InstancedMesh;
  private fxGunFlashInst!: THREE.InstancedMesh;
  private fxImpactDustInst!: THREE.InstancedMesh;
  private barBgInst!: THREE.InstancedMesh;
  private barGreenInst!: THREE.InstancedMesh;
  private barOrangeInst!: THREE.InstancedMesh;
  private barRedInst!: THREE.InstancedMesh;
  private barPurpleInst!: THREE.InstancedMesh;

  private tmpPos = new THREE.Vector3();
  private tmpVecA = new THREE.Vector3();
  private tmpVecB = new THREE.Vector3();
  private tmpMatrix = new THREE.Matrix4();
  private tmpQuat = new THREE.Quaternion();
  private tmpEuler = new THREE.Euler();
  private tmpScale = new THREE.Vector3();

  constructor(scene: THREE.Scene, layout: CityLayout, textures?: VoxelTextureStudio) {
    this.textureStudio = textures ?? new VoxelTextureStudio();
    this.scene = scene;
    this.cityGroup = new THREE.Group();
    this.tacticalGroup = new THREE.Group();
    this.effectsGroup = new THREE.Group();
    this.worldBarsGroup = new THREE.Group();
    this.previewGroup = new THREE.Group();
    this.horizonGroup = new THREE.Group();

    this.scene.add(this.horizonGroup);
    this.scene.add(this.cityGroup);
    this.scene.add(this.tacticalGroup);
    this.scene.add(this.effectsGroup);
    this.scene.add(this.worldBarsGroup);
    this.scene.add(this.previewGroup);

    this.ringUnitGeo.rotateX(-Math.PI / 2);

    const stainGeo = new THREE.PlaneGeometry(0.95, 0.95);
    stainGeo.rotateX(-Math.PI / 2);
    const stainMat = new THREE.MeshBasicMaterial({
      map: this.textureStudio.getBloodStainTexture(),
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.08,
      opacity: 0.92,
      depthWrite: false
    });
    this.bloodStainInst = new THREE.InstancedMesh(stainGeo, stainMat, this.maxBloodStains);
    this.bloodStainInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bloodStainInst.frustumCulled = false;
    this.bloodStainInst.count = 0;
    this.scene.add(this.bloodStainInst);

    this.initFxInstancedPools();
    this.buildSkyAndHorizon();
    this.setupLighting();
    this.initPlacementPreview();
    this.rebuildCity(layout);
  }

  private createFxPool(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    maxCount: number
  ): THREE.InstancedMesh {
    const inst = new THREE.InstancedMesh(geo, mat, maxCount);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.frustumCulled = false;
    inst.castShadow = false;
    inst.receiveShadow = false;
    inst.count = 0;
    this.scene.add(inst);
    return inst;
  }

  private initFxInstancedPools(): void {
    this.fxFireOrangeInst = this.createFxPool(this.voxelUnitGeo, this.fireMat, 320);
    this.fxFireYellowInst = this.createFxPool(this.voxelUnitGeo, this.fireYellowMat, 240);
    this.fxSmokeInst = this.createFxPool(this.voxelUnitGeo, this.smokeMat, 420);
    this.fxEmberInst = this.createFxPool(this.emberGeo, this.emberMat, 240);
    this.fxBloodDarkInst = this.createFxPool(this.dropletGeo, this.bloodDropletDarkMat, 600);
    this.fxBloodMidInst = this.createFxPool(this.dropletGeo, this.bloodDropletMidMat, 600);
    this.fxShatterGlassInst = this.createFxPool(this.dropletGeo, this.shatterGlassMat, 240);
    this.fxShatterWoodInst = this.createFxPool(this.dropletGeo, this.shatterWoodMat, 160);
    this.fxGunBeamInst = this.createFxPool(this.beamUnitGeo, this.gunBeamMat, 160);
    this.fxGunFlashInst = this.createFxPool(this.voxelUnitGeo, this.gunFlashMat, 160);
    this.fxImpactDustInst = this.createFxPool(this.voxelUnitGeo, this.impactDustMat, 120);
    this.barBgInst = this.createFxPool(this.barUnitGeo, this.barBgMat, 160);
    this.barGreenInst = this.createFxPool(this.barUnitGeo, this.barGreenMat, 32);
    this.barOrangeInst = this.createFxPool(this.barUnitGeo, this.barOrangeMat, 160);
    this.barRedInst = this.createFxPool(this.barUnitGeo, this.barRedMat, 160);
    this.barPurpleInst = this.createFxPool(this.barUnitGeo, this.barPurpleMat, 160);
  }

  private writeFxInstance(
    inst: THREE.InstancedMesh,
    idx: number,
    px: number,
    py: number,
    pz: number,
    sx: number,
    sy: number,
    sz: number,
    rx = 0,
    ry = 0,
    rz = 0
  ): void {
    this.tmpPos.set(px, py, pz);
    this.tmpEuler.set(rx, ry, rz);
    this.tmpQuat.setFromEuler(this.tmpEuler);
    this.tmpScale.set(sx, sy, sz);
    this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
    inst.setMatrixAt(idx, this.tmpMatrix);
  }

  private writeBeamInstance(
    inst: THREE.InstancedMesh,
    idx: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    thickness = 1
  ): void {
    this.tmpVecA.set(ax, ay, az);
    this.tmpVecB.set(bx, by, bz);
    const len = this.tmpVecA.distanceTo(this.tmpVecB);
    if (len <= 0.05) {
      this.tmpMatrix.makeScale(0, 0, 0);
      inst.setMatrixAt(idx, this.tmpMatrix);
      return;
    }
    this.tmpPos.copy(this.tmpVecA).add(this.tmpVecB).multiplyScalar(0.5);
    this.tmpMatrix.lookAt(this.tmpVecA, this.tmpVecB, THREE.Object3D.DEFAULT_UP);
    this.tmpQuat.setFromRotationMatrix(this.tmpMatrix);
    this.tmpScale.set(thickness, thickness, len);
    this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
    inst.setMatrixAt(idx, this.tmpMatrix);
  }

  private createSkyTexture(stage: AtmosphereStage): THREE.CanvasTexture {
    const cached = this.skyTextures[stage];
    if (cached) return cached;
    const tex = this.textureStudio.getPixelSkyTexture(stage);
    this.skyTextures[stage] = tex;
    return tex;
  }

  private buildSkyAndHorizon(): void {
    this.skyMat = new THREE.MeshBasicMaterial({
      map: this.createSkyTexture('dusk'),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false
    });
    this.skyDomeMesh = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 20), this.skyMat);
    this.scene.add(this.skyDomeMesh);

    // Seamless dark metropolitan base extending outward from the active district so zero floating edge shows
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400),
      new THREE.MeshStandardMaterial({ color: 0x1b202e, roughness: 0.95, metalness: 0.04 })
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.05;
    apron.receiveShadow = false;
    this.horizonGroup.add(apron);

    // 110 Instanced stepped voxel skyline silhouette towers on an elliptical horizon (2 draw calls total, ZERO camera occlusion on South Terminal!)
    const horizonFacade = this.textureStudio.getBuildingFacadeBundle('skyscraper', 0x26213c, 84);
    const silMat = new THREE.MeshStandardMaterial({
      map: horizonFacade.map,
      color: 0x3b3358,
      emissive: 0xffb469,
      emissiveMap: horizonFacade.emissiveMap,
      emissiveIntensity: 0.24,
      roughness: 0.9
    });
    const spireMat = new THREE.MeshBasicMaterial({ color: 0x52396a });

    const towerCount = 110;
    const crownCount = 37;
    const towerInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), silMat, towerCount);
    const crownInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), silMat, crownCount);
    const spireInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), spireMat, crownCount);

    let crIdx = 0;
    const mat4 = new THREE.Matrix4();
    const posV = new THREE.Vector3();
    const quatV = new THREE.Quaternion();
    const scaleV = new THREE.Vector3();
    const eulerV = new THREE.Euler();

    for (let i = 0; i < towerCount; i++) {
      const angle = (i / towerCount) * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      // Push all South-side horizon silhouettes well behind the camera orbit radius (z > +440m) so South Station never occludes!
      const inSouthCameraSector = sinA > -0.15;
      const rx = (inSouthCameraSector ? 320 : 215) + ((i * 29) % 115);
      const rz = (inSouthCameraSector ? 455 : 315) + ((i * 37) % 125);
      const sx = cosA * rx;
      const sz = sinA * rz;

      const w = 15 + ((i * 7) % 16);
      const d = 15 + ((i * 11) % 15);
      const h = inSouthCameraSector
        ? 18 + ((i * 13) % 22)
        : 38 + ((i * 23) % 72);

      eulerV.set(0, -angle, 0);
      quatV.setFromEuler(eulerV);
      posV.set(sx, h * 0.5 - 0.08, sz);
      scaleV.set(w, h, d);
      mat4.compose(posV, quatV, scaleV);
      towerInst.setMatrixAt(i, mat4);

      if (i % 3 === 0 && crIdx < crownCount && !inSouthCameraSector) {
        posV.set(sx, h + 4.5, sz);
        scaleV.set(w * 0.6, 9, d * 0.6);
        mat4.compose(posV, quatV, scaleV);
        crownInst.setMatrixAt(crIdx, mat4);

        posV.set(sx, h + 15.0, sz);
        scaleV.set(1.1, 13, 1.1);
        mat4.compose(posV, quatV, scaleV);
        spireInst.setMatrixAt(crIdx, mat4);
        crIdx++;
      }
    }
    crownInst.count = crIdx;
    spireInst.count = crIdx;
    towerInst.instanceMatrix.needsUpdate = true;
    crownInst.instanceMatrix.needsUpdate = true;
    spireInst.instanceMatrix.needsUpdate = true;
    this.horizonGroup.add(towerInst, crownInst, spireInst);
  }

  public initEnvironment(renderer: THREE.WebGLRenderer): void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();

    const envMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = normalize(wp.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPos;
        void main() {
          float y = vWorldPos.y;
          vec3 zenith = vec3(0.18, 0.09, 0.30);
          vec3 horizon = vec3(0.95, 0.42, 0.22);
          vec3 nadir = vec3(0.06, 0.08, 0.14);
          vec3 col = y >= 0.0
            ? mix(horizon, zenith, pow(clamp(y, 0.0, 1.0), 0.55))
            : mix(horizon * 0.45, nadir, pow(clamp(-y, 0.0, 1.0), 0.45));
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    const envSphere = new THREE.Mesh(new THREE.SphereGeometry(20, 24, 16), envMat);
    envScene.add(envSphere);

    const rt = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = rt.texture;
    (this.scene as THREE.Scene & { environmentIntensity?: number }).environmentIntensity = 0.65;

    envSphere.geometry.dispose();
    envMat.dispose();
    pmrem.dispose();
  }

  private setupLighting(): void {
    this.ambientLight = new THREE.AmbientLight(0x526491, 0.48);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0xd47d78, 0x161d2e, 0.78);
    this.hemiLight.position.set(0, 90, 0);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xff9a52, 2.85);
    this.sunLight.position.set(-140, 68, -120);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 360;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    this.interiorPointLight = new THREE.PointLight(0xd8e8ff, 0, 18, 1.3);
    this.interiorPointLight.castShadow = false;
    this.scene.add(this.interiorPointLight);

    this.trainRedPointLight = new THREE.PointLight(0xff1e33, 0, 12, 1.4);
    this.trainRedPointLight.castShadow = false;
    this.scene.add(this.trainRedPointLight);

    this.applyAtmosphere('dusk');
  }

  public applyAtmosphere(stage: AtmosphereStage): void {
    this.atmosphereStage = stage;
    this.skyMat.map = this.createSkyTexture(stage);
    this.skyMat.needsUpdate = true;

    const showLampCones = stage !== 'day';
    for (let i = 0; i < this.streetLampCones.length; i++) {
      this.streetLampCones[i].visible = showLampCones;
    }

    if (stage === 'dusk') {
      this.scene.background = new THREE.Color(0x1f142e);
      this.scene.fog = new THREE.FogExp2(0x2a1836, 0.00195);
      this.baseAmbientIntensity = 0.48;
      this.baseHemiIntensity = 0.78;
      this.baseSunIntensity = 2.85;
      this.ambientLight.intensity = this.baseAmbientIntensity;
      this.hemiLight.color.setHex(0xd47d78);
      this.hemiLight.groundColor.setHex(0x161d2e);
      this.hemiLight.intensity = this.baseHemiIntensity;
      this.sunLight.intensity = this.baseSunIntensity;
      this.sunLight.color.setHex(0xff9a52);
      this.sunLight.position.set(-140, 68, -120);
    } else if (stage === 'night') {
      this.scene.background = new THREE.Color(0x040711);
      this.scene.fog = new THREE.FogExp2(0x050914, 0.0034);
      this.baseAmbientIntensity = 0.24;
      this.baseHemiIntensity = 0.36;
      this.baseSunIntensity = 0.55;
      this.ambientLight.intensity = this.baseAmbientIntensity;
      this.hemiLight.color.setHex(0x60a5fa);
      this.hemiLight.groundColor.setHex(0x090d16);
      this.hemiLight.intensity = this.baseHemiIntensity;
      this.sunLight.intensity = this.baseSunIntensity;
      this.sunLight.color.setHex(0x93c5fd);
      this.sunLight.position.set(60, 95, 55);
    } else {
      this.scene.background = new THREE.Color(0x38bdf8);
      this.scene.fog = new THREE.FogExp2(0x476b8c, 0.0018);
      this.baseAmbientIntensity = 0.65;
      this.baseHemiIntensity = 0.85;
      this.baseSunIntensity = 1.65;
      this.ambientLight.intensity = this.baseAmbientIntensity;
      this.hemiLight.color.setHex(0xe0f2fe);
      this.hemiLight.groundColor.setHex(0x334155);
      this.hemiLight.intensity = this.baseHemiIntensity;
      this.sunLight.intensity = this.baseSunIntensity;
      this.sunLight.color.setHex(0xfff7ed);
      this.sunLight.position.set(70, 110, 60);
    }
  }

  public cycleAtmosphere(): AtmosphereStage {
    const next: AtmosphereStage =
      this.atmosphereStage === 'dusk'
        ? 'night'
        : this.atmosphereStage === 'night'
        ? 'day'
        : 'dusk';
    this.applyAtmosphere(next);
    return next;
  }

  public rebuildCity(layout: CityLayout): void {
    this.currentLayout = layout;

    this.cityGroup.clear();
    this.tacticalGroup.clear();
    this.effectsGroup.clear();
    this.worldBarsGroup.clear();
    this.roadblockMeshes.clear();
    this.evacMeshes.clear();
    this.holdMeshes.clear();
    this.lureMeshes.clear();
    this.pickupMeshes.clear();
    this.gateVisuals.clear();
    this.interiorDoorVisuals.clear();
    this.interiorFixtures = [];
    this.alarmBeaconMeshes.clear();
    this.brokenWindowCount = 0;
    this.streetLampCones = [];
    this.priorityMesh = null;
    this.expressTrainGroup = null;
    this.ktxShutters.clear();
    this.stationBeaconMat = null;
    this.trainDoorVisuals.clear();
    this.trainConsoleLightMat = null;
    this.trainEmergencyLightMats = [];
    this.elevatedSmokeEmitters = [];
    if (this.interiorPointLight) this.interiorPointLight.intensity = 0;

    this.bloodStainCursor = 0;
    this.bloodStainCount = 0;
    this.bloodStainInst.count = 0;
    this.stampedBloodEvents.clear();

    const dx = layout.cityHalfX + 40;
    const dz = layout.cityHalfZ + 40;
    this.sunLight.shadow.camera.left = -dx;
    this.sunLight.shadow.camera.right = dx;
    this.sunLight.shadow.camera.top = dz;
    this.sunLight.shadow.camera.bottom = -dz;
    this.sunLight.shadow.camera.far = layout.cityHalfSize * 3.8;
    this.sunLight.shadow.camera.updateProjectionMatrix();

    this.buildBaseAndRoads(layout);
    this.buildRiversAndBridges(layout);
    this.buildSidewalksAndPark(layout);
    this.buildBuildings(layout.buildings);
    this.buildInteriorDoors(layout);
    this.buildDefenseWallsAndGates(layout);
    this.buildOverpassesAndSkybridges(layout);
    this.buildExpressRailAndTrain(layout);
    this.buildTreesAndFurniture(layout);
    this.buildStaticObstacles(layout);
  }

  private initPlacementPreview(): void {
    this.previewRing = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1.0, 32),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.75
      })
    );
    this.previewRing.rotation.x = -Math.PI / 2;
    this.previewRing.position.y = 0.25;

    this.previewBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 8, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide
      })
    );
    this.previewBeam.position.y = 4.2;

    this.previewBarricade = new THREE.Group();
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.55
    });
    for (const ox of [-2.3, 0, 2.3]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.2, 0.8), ghostMat);
      box.position.set(ox, 0.7, 0);
      this.previewBarricade.add(box);
    }

    this.previewGroup.add(this.previewRing, this.previewBeam, this.previewBarricade);
    this.previewGroup.visible = false;
  }

  public updatePlacementPreview(tool: TacticalTool, wx: number, wz: number, visible: boolean): void {
    if (!visible || tool === 'inspect' || !this.currentLayout) {
      this.previewGroup.visible = false;
      return;
    }

    this.previewGroup.visible = true;
    const ringMat = this.previewRing.material as THREE.MeshBasicMaterial;
    const beamMat = this.previewBeam.material as THREE.MeshBasicMaterial;

    if (tool === 'roadblock') {
      let minDx = Infinity;
      let minDz = Infinity;
      let nearestRx = wx;
      let nearestRz = wz;
      for (const rc of this.currentLayout.roadCoords) {
        if (Math.abs(wx - rc) < minDx) {
          minDx = Math.abs(wx - rc);
          nearestRx = rc;
        }
        if (Math.abs(wz - rc) < minDz) {
          minDz = Math.abs(wz - rc);
          nearestRz = rc;
        }
      }
      const snapVertical = minDx < minDz;
      const rx = snapVertical ? nearestRx : wx;
      const rz = snapVertical ? wz : nearestRz;

      this.previewGroup.position.set(rx, 0, rz);
      this.previewBarricade.visible = true;
      this.previewBarricade.rotation.y = snapVertical ? 0 : Math.PI / 2;
      this.previewBeam.visible = false;
      this.previewRing.scale.setScalar(3.6);
      ringMat.color.setHex(0xf97316);
      return;
    }

    this.previewBarricade.visible = false;
    this.previewBeam.visible = true;
    this.previewGroup.position.set(wx, 0, wz);

    let radius = 3.5;
    let color = 0x38bdf8;
    if (tool === 'deploy_police') {
      radius = 3.2;
      color = 0x3b82f6;
    } else if (tool === 'deploy_swat' || tool === 'deploy_hunters') {
      radius = 3.6;
      color = 0x06b6d4;
    } else if (tool === 'deploy_medic') {
      radius = 3.5;
      color = 0x10b981;
    } else if (tool === 'lure_flare') {
      radius = 16.0;
      color = 0xf43f5e;
    } else if (tool === 'frag_bomb') {
      radius = 12.0;
      color = 0xf97316;
    } else if (tool === 'defend_zone') {
      radius = 6.5;
      color = 0x3b82f6;
    } else if (tool === 'evac_zone') {
      radius = 7.0;
      color = 0x22c55e;
    } else if (tool === 'priority_sector') {
      radius = 14.0;
      color = 0x38bdf8;
    }

    this.previewRing.scale.setScalar(radius);
    ringMat.color.setHex(color);
    beamMat.color.setHex(color);
  }

  private buildBaseAndRoads(layout: CityLayout): void {
    const baseW = layout.cityHalfX * 2 + 28;
    const baseD = layout.cityHalfZ * 2 + 28;
    const groundGeo = new THREE.BoxGeometry(baseW, 2.0, baseD);
    const groundMat = new THREE.MeshStandardMaterial({
      map: this.textureStudio.getAsphaltTexture(28),
      color: 0x8c97ad,
      roughness: 0.44,
      metalness: 0.24,
      envMapIntensity: 1.35
    });
    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.position.y = -1.0;
    this.groundMesh.receiveShadow = true;
    this.cityGroup.add(this.groundMesh);

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });
    const borderThick = 2.0;
    const NorthBorder = new THREE.Mesh(
      new THREE.BoxGeometry(baseW + 4, 2.4, borderThick),
      frameMat
    );
    NorthBorder.position.set(0, -0.9, -baseD / 2 - 1);
    const SouthBorder = NorthBorder.clone();
    SouthBorder.position.z = baseD / 2 + 1;
    const WestBorder = new THREE.Mesh(
      new THREE.BoxGeometry(borderThick, 2.4, baseD),
      frameMat
    );
    WestBorder.position.set(-baseW / 2 - 1, -0.9, 0);
    const EastBorder = WestBorder.clone();
    EastBorder.position.x = baseW / 2 + 1;
    this.cityGroup.add(NorthBorder, SouthBorder, WestBorder, EastBorder);

    const yellowLineMat = new THREE.MeshBasicMaterial({ color: 0xd97706 });
    const whiteDashMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
    const crosswalkMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
    const dashHGeo = new THREE.PlaneGeometry(2.0, 0.18);
    const dashVGeo = new THREE.PlaneGeometry(0.18, 2.0);

    const inHighway = (x: number, z: number) =>
      !!layout.highwayZone &&
      x > layout.highwayZone.minX + 2 &&
      x < layout.highwayZone.maxX - 2 &&
      z < layout.highwayZone.maxZ - 2;
    const inTerminal = (x: number, z: number) =>
      !!layout.terminalPlaza &&
      x > layout.terminalPlaza.minX + 4 &&
      x < layout.terminalPlaza.maxX - 4 &&
      z > layout.terminalPlaza.minZ + 4;

    // Horizontal roads along roadZs
    for (let r = 0; r < layout.roadZs.length; r++) {
      const rz = layout.roadZs[r];
      const isRailCorridor =
        layout.railTracksZ.some((trZ) => Math.abs(rz - trZ) < 6) ||
        (layout.hasExpressRail && Math.abs(rz - layout.railZ) < 6);
      if (isRailCorridor) continue;

      for (let rx = -layout.cityHalfX + 4; rx <= layout.cityHalfX - 4; rx += 5.5) {
        if (inHighway(rx, rz) || inTerminal(rx, rz)) continue;
        if (!layout.isPointInOpenWater(rx, rz, 0.5)) {
          const dashH = new THREE.Mesh(dashHGeo, yellowLineMat);
          dashH.rotation.x = -Math.PI / 2;
          dashH.position.set(rx, 0.02, rz);
          this.cityGroup.add(dashH);
        }
      }
    }

    // Vertical avenues along roadXs
    for (let c = 0; c < layout.roadXs.length; c++) {
      const rx = layout.roadXs[c];
      for (let rz = -layout.cityHalfZ + 4; rz <= layout.cityHalfZ - 4; rz += 5.5) {
        if (inHighway(rx, rz) || inTerminal(rx, rz)) continue;
        if (!layout.isPointInOpenWater(rx, rz, 0.5)) {
          const onBridge = layout.bridges.some(
            (br) => Math.abs(rx - br.x) < br.width * 0.5 && Math.abs(rz - br.z) < br.length * 0.5
          );
          const dashV = new THREE.Mesh(dashVGeo, yellowLineMat);
          dashV.rotation.x = -Math.PI / 2;
          dashV.position.set(rx, onBridge ? 0.21 : 0.02, rz);
          this.cityGroup.add(dashV);
        }
      }
    }

    // Multi-lane North Highway longitudinal divider dashes
    if (layout.highwayZone) {
      const hz = layout.highwayZone;
      for (const lx of [-6, 12, 50, 68]) {
        for (let z = hz.minZ + 6; z <= hz.maxZ - 6; z += 5.2) {
          const dash = new THREE.Mesh(dashVGeo, whiteDashMat);
          dash.rotation.x = -Math.PI / 2;
          dash.position.set(lx, 0.022, z);
          this.cityGroup.add(dash);
        }
      }
    }

    const cwGeomH = new THREE.PlaneGeometry(0.45, 2.2);
    const cwGeomV = new THREE.PlaneGeometry(2.2, 0.45);
    for (let r = 0; r < layout.roadZs.length; r++) {
      for (let c = 0; c < layout.roadXs.length; c++) {
        const rx = layout.roadXs[c];
        const rz = layout.roadZs[r];
        if (inHighway(rx, rz) || inTerminal(rx, rz)) continue;
        if (layout.isPointInOpenWater(rx, rz, 0.5)) continue;
        if (layout.hasExpressRail && Math.abs(rz - layout.railZ) < 6) continue;
        for (let s = -2.4; s <= 2.4; s += 0.95) {
          for (const oz of [-4.8, 4.8]) {
            if (layout.isPointInOpenWater(rx + s, rz + oz, 0.5)) continue;
            const stripe = new THREE.Mesh(cwGeomH, crosswalkMat);
            stripe.rotation.x = -Math.PI / 2;
            stripe.position.set(rx + s, 0.025, rz + oz);
            this.cityGroup.add(stripe);
          }
          for (const ox of [-4.8, 4.8]) {
            if (layout.isPointInOpenWater(rx + ox, rz + s, 0.5)) continue;
            const stripe = new THREE.Mesh(cwGeomV, crosswalkMat);
            stripe.rotation.x = -Math.PI / 2;
            stripe.position.set(rx + ox, 0.025, rz + s);
            this.cityGroup.add(stripe);
          }
        }
      }
    }
  }

  private buildDefenseWallsAndGates(layout: CityLayout): void {
    if (layout.wallDefs.length === 0) return;

    const buttressMat = new THREE.MeshStandardMaterial({ color: 0x262d38, roughness: 0.85 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.65 });
    const edgePaintMat = new THREE.MeshStandardMaterial({ color: 0xd4a33d, emissive: 0x52370d, emissiveIntensity: 0.32 });
    const steelMat = new THREE.MeshStandardMaterial({
      map: this.textureStudio.getBlastGateTexture(),
      color: 0xffffff,
      metalness: 0.45,
      roughness: 0.48
    });
    const wireMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      metalness: 0.65,
      roughness: 0.35
    });
    const wirePostMat = new THREE.MeshStandardMaterial({ color: 0x1e2530, roughness: 0.8 });
    const gateConeMat = this.textureStudio.createVolumetricConeMaterial(0xffe0a3, 0.24);
    const gateConeGeo = new THREE.ConeGeometry(4.4, 7.8, 16, 1, true);
    const coilGeo = new THREE.TorusGeometry(0.54, 0.068, 5, 10);

    const wallSpanMin = -layout.cityHalfX - 10;
    const wallSpanMax = layout.cityHalfX + 10;
    const gateWidth = BLAST_GATE_WIDTH;

    for (const wd of layout.wallDefs) {
      const sortedGates = [...wd.gateXs].sort((a, b) => a - b);
      let cursorX = wallSpanMin;
      const wallSegs: Array<{ start: number; end: number }> = [];

      for (const gx of sortedGates) {
        const gStart = gx - gateWidth * 0.5;
        const gEnd = gx + gateWidth * 0.5;
        if (gStart > cursorX) {
          wallSegs.push({ start: cursorX, end: gStart });
        }
        cursorX = Math.max(cursorX, gEnd);
      }
      if (cursorX < wallSpanMax) {
        wallSegs.push({ start: cursorX, end: wallSpanMax });
      }

      // Solid concrete wall segments + 3D Barbed Wire razor coils
      for (const seg of wallSegs) {
        const segW = seg.end - seg.start;
        const segCx = (seg.start + seg.end) * 0.5;
        const wallTex = this.textureStudio.getConcreteWallTexture(
          Math.max(1, Math.round(segW / 12))
        );
        const concreteMat = new THREE.MeshStandardMaterial({
          map: wallTex,
          color: 0xffffff,
          roughness: 0.88
        });

        const wallMesh = new THREE.Mesh(
          new THREE.BoxGeometry(segW, wd.height, wd.thickness),
          concreteMat
        );
        wallMesh.position.set(segCx, wd.height * 0.5, wd.z);
        wallMesh.castShadow = true;
        wallMesh.receiveShadow = true;

        const parapet = new THREE.Mesh(
          new THREE.BoxGeometry(segW, WALL_DECK_RISE, wd.thickness + WALL_DECK_OVERHANG + WALL_DECK_REAR_TRIM),
          trimMat
        );
        parapet.position.set(segCx, wd.height + WALL_DECK_RISE / 2, wd.z + (WALL_DECK_REAR_TRIM - WALL_DECK_OVERHANG) / 2);
        const edgePaint = new THREE.Mesh(new THREE.BoxGeometry(segW, 0.012, 0.11), edgePaintMat);
        edgePaint.position.set(segCx, wd.height + WALL_DECK_RISE + 0.006, wd.z - wd.thickness / 2 - WALL_DECK_OVERHANG + 0.12);
        this.cityGroup.add(wallMesh, parapet, edgePaint);

        // Mount the wire on the outer face below the deck sightline.
        const wireStrandGeo = new THREE.BoxGeometry(segW, 0.06, 0.06);
        const strand1 = new THREE.Mesh(wireStrandGeo, wireMat);
        const wireZ = wd.z - wd.thickness / 2 - 0.12;
        strand1.position.set(segCx, wd.height - 0.62, wireZ);
        const strand2 = new THREE.Mesh(wireStrandGeo, wireMat);
        strand2.position.set(segCx, wd.height - 0.27, wireZ);
        this.cityGroup.add(strand1, strand2);

        const postCount = Math.max(3, Math.floor(segW / 5));
        for (let p = 0; p <= postCount; p++) {
          const px = seg.start + (p / postCount) * segW;
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.14), wirePostMat);
          post.position.set(px, wd.height - 0.57, wireZ);
          this.cityGroup.add(post);
        }

        for (let rx = seg.start + 1.0; rx <= seg.end - 1.0; rx += 1.65) {
          const coil = new THREE.Mesh(coilGeo, wireMat);
          coil.position.set(rx, wd.height - 0.57, wireZ);
          coil.rotation.y = Math.PI * 0.35;
          coil.rotation.x = 0.15;
          this.cityGroup.add(coil);
        }

        // Buttress pillars along concrete wall
        const pillarCount = Math.max(2, Math.floor(segW / 16));
        for (let p = 0; p < pillarCount; p++) {
          const px = seg.start + ((p + 0.5) / pillarCount) * segW;
          const pillar = new THREE.Mesh(
            new THREE.BoxGeometry(1.4, wd.height + 0.65, wd.thickness + 1.0),
            buttressMat
          );
          pillar.position.set(px, (wd.height + 0.65) * 0.5, wd.z);
          pillar.castShadow = true;
          this.cityGroup.add(pillar);
        }
      }

      // Checkpoint sandbags and striped boom barriers
      const sandbagMat = new THREE.MeshStandardMaterial({ color: 0xa1885d, roughness: 0.94 });
      const boomRedMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
      const boomWhiteMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
      const towerConeMat = this.textureStudio.createVolumetricConeMaterial(0xfff1bf, 0.26);
      const towerConeGeo = new THREE.ConeGeometry(4.8, 13.5, 14, 1, true);
      towerConeGeo.translate(0, -6.75, 0);
      towerConeGeo.rotateX(Math.PI * 0.38);

      // Steel Blast Gate archways, hazard-striped sliding doors, watchtowers & boom gates
      const ladderHeight = wd.height + WALL_DECK_RISE;
      const ladderRail = new THREE.BoxGeometry(0.09, ladderHeight + 0.4, 0.09);
      const ladderRung = new THREE.BoxGeometry(0.66, 0.075, 0.09);
      const rungCount = Math.ceil(ladderHeight / 0.42) - 1;
      const gateLadders = sortedGates.flatMap(wallLadderXs);
      const retreatLadders = wallRetreatLadderXs(wallSpanMin, wallSpanMax, sortedGates);
      const ladders = [...gateLadders, ...retreatLadders];
      const ladderCount = ladders.length;
      const rails = new THREE.InstancedMesh(ladderRail, trimMat, ladderCount * 2);
      const rungs = new THREE.InstancedMesh(ladderRung, trimMat, ladderCount * rungCount);
      const marker = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const markers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.65, 0.12, 0.12), marker, ladderCount * 2);
      const transform = new THREE.Matrix4();
      const gateMarker = new THREE.Color(0xeab65e);
      const retreatMarker = new THREE.Color(0x67e8f9);
      this.cityGroup.add(rails, rungs, markers);
      for (const [ladderIndex, x] of ladders.entries()) {
        const z = ladderZ(wd) - 0.2;
        for (let side = 0; side < 2; side++) {
          const dx = side === 0 ? -0.33 : 0.33;
          rails.setMatrixAt(ladderIndex * 2 + side, transform.makeTranslation(x + dx, (ladderHeight + 0.4) / 2, z));
          markers.setMatrixAt(ladderIndex * 2 + side, transform.makeTranslation(x, side === 0 ? 1.22 : ladderHeight + 0.12, z));
          markers.setColorAt(ladderIndex * 2 + side, ladderIndex < gateLadders.length ? gateMarker : retreatMarker);
        }
        for (let rung = 0; rung < rungCount; rung++) {
          rungs.setMatrixAt(ladderIndex * rungCount + rung, transform.makeTranslation(x, (rung + 1) * 0.42, z));
        }
      }
      for (const gx of sortedGates) {
        const gGroup = new THREE.Group();
        gGroup.position.set(gx, 0, wd.z);

        const postGeo = new THREE.BoxGeometry(1.45, wd.height + 1.6, wd.thickness + 1.4);
        const postL = new THREE.Mesh(postGeo, buttressMat);
        postL.position.set(-gateWidth * 0.5 - 0.5, (wd.height + 1.6) * 0.5, 0);
        const postR = new THREE.Mesh(postGeo, buttressMat);
        postR.position.set(gateWidth * 0.5 + 0.5, (wd.height + 1.6) * 0.5, 0);

        const lintel = new THREE.Mesh(
          new THREE.BoxGeometry(gateWidth + 2.6, 1.45, wd.thickness + 1.4),
          buttressMat
        );
        lintel.position.set(0, wd.height + 0.85, 0);

        // Top barbed wire strands & coils over gate lintel
        const gateWire = new THREE.Mesh(
          new THREE.BoxGeometry(gateWidth + 2.4, 0.09, 0.09),
          wireMat
        );
        gateWire.position.set(0, wd.height + 2.0, 0);
        for (let grx = -gateWidth * 0.45; grx <= gateWidth * 0.45; grx += 1.6) {
          const coil = new THREE.Mesh(coilGeo, wireMat);
          coil.position.set(grx, wd.height + 1.92, 0);
          coil.rotation.y = Math.PI * 0.35;
          gGroup.add(coil);
        }

        const beaconMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
        const beacon = new THREE.Mesh(
          new THREE.BoxGeometry(1.5, 0.36, wd.thickness + 1.5),
          beaconMat
        );
        beacon.position.set(0, wd.height + 0.85, 0);

        const amberCrown = new THREE.Mesh(
          new THREE.BoxGeometry(0.55, 0.55, 0.55),
          new THREE.MeshBasicMaterial({ color: 0xf59e0b })
        );
        amberCrown.position.set(0, wd.height + 1.85, 0);

        // Left & Right sliding steel blast doors (hazard stripe painted in texture)
        const doorGeo = new THREE.BoxGeometry(gateWidth * 0.5 - 0.08, wd.height - 0.2, 0.92);
        const leftDoor = new THREE.Mesh(doorGeo, steelMat);
        leftDoor.position.set(-gateWidth * 0.55, (wd.height - 0.2) * 0.5, 0);
        leftDoor.castShadow = true;

        const rightDoor = new THREE.Mesh(doorGeo, steelMat);
        rightDoor.position.set(gateWidth * 0.55, (wd.height - 0.2) * 0.5, 0);
        rightDoor.castShadow = true;

        // Red & white striped boom barrier arm in front of threshold
        const boomArmPivot = new THREE.Group();
        boomArmPivot.position.set(-gateWidth * 0.46, 1.15, -wd.thickness * 0.5 - 0.75);
        for (let bi = 0; bi < 8; bi++) {
          const segBar = new THREE.Mesh(
            new THREE.BoxGeometry(1.42, 0.14, 0.14),
            bi % 2 === 0 ? boomRedMat : boomWhiteMat
          );
          segBar.position.set(0.75 + bi * 1.42, 0, 0);
          boomArmPivot.add(segBar);
        }

        // Flanking Sandbag Watchtower (left side) + Searchlight cone sweeping avenue
        const towerX = Math.sign(gx || 1) * (gateWidth * 0.5 + 3.0);
        for (const lx of [-1.05, 1.05]) {
          for (const lz of [-1.05, 1.05]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 9.2, 0.28), wirePostMat);
            leg.position.set(towerX + lx, 4.6, lz);
            leg.castShadow = true;
            gGroup.add(leg);
          }
        }
        const deck = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.32, 2.8), buttressMat);
        deck.position.set(towerX, 7.6, 0);
        const sandbagWall = new THREE.Mesh(new THREE.BoxGeometry(2.95, 1.05, 2.95), sandbagMat);
        sandbagWall.position.set(towerX, 8.2, 0);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.22, 3.1), trimMat);
        roof.position.set(towerX, 9.45, 0);
        const searchHead = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 0.45, 0.55),
          new THREE.MeshBasicMaterial({ color: 0xfef9c3 })
        );
        searchHead.position.set(towerX + 0.3, 8.9, -1.2);
        const searchCone = new THREE.Mesh(towerConeGeo, towerConeMat);
        searchCone.position.set(towerX + 0.3, 8.85, -1.35);
        searchCone.visible = this.atmosphereStage !== 'day';
        this.streetLampCones.push(searchCone);
        gGroup.add(deck, sandbagWall, roof, searchHead, searchCone);

        // Gate floodlight cones
        for (const fx of [-4.0, 4.0]) {
          for (const fz of [-1.4, 1.4]) {
            const bulb = new THREE.Mesh(
              new THREE.BoxGeometry(0.4, 0.2, 0.3),
              new THREE.MeshBasicMaterial({ color: 0xfef08a })
            );
            bulb.position.set(fx, wd.height + 0.1, fz);
            const cone = new THREE.Mesh(gateConeGeo, gateConeMat);
            cone.position.set(fx, wd.height - 3.6, fz);
            this.streetLampCones.push(cone);
            gGroup.add(bulb, cone);
          }
        }

        gGroup.add(postL, postR, lintel, gateWire, beacon, amberCrown, leftDoor, rightDoor, boomArmPivot);
        this.cityGroup.add(gGroup);

        const key = `${wd.layerIndex}:${Math.round(gx)}`;
        this.gateVisuals.set(key, {
          group: gGroup,
          leftDoor,
          rightDoor,
          boomArmPivot,
          beaconMat
        });
      }
    }
  }

  private buildOverpassesAndSkybridges(layout: CityLayout): void {
    const concreteDeckMat = new THREE.MeshStandardMaterial({
      map: this.textureStudio.getConcreteWallTexture(4),
      color: 0xb8c0cc,
      roughness: 0.88
    });
    const roadTopMat = new THREE.MeshStandardMaterial({ color: 0x1e2430, roughness: 0.9 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.4 });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85 });
    const lampBulbMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const coneMat = this.textureStudio.createVolumetricConeMaterial(0xffde99, 0.18);
    const coneGeo = new THREE.ConeGeometry(2.6, 3.8, 12, 1, true);
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.32,
      roughness: 0.25,
      metalness: 0.35
    });

    for (const op of layout.overpasses) {
      const opGroup = new THREE.Group();
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(op.length, 0.85, op.width),
        concreteDeckMat
      );
      slab.position.set(op.x, op.deckY - 0.42, op.z);
      slab.castShadow = true;
      slab.receiveShadow = true;

      const asphalt = new THREE.Mesh(
        new THREE.BoxGeometry(op.length - 0.4, 0.08, op.width - 1.1),
        roadTopMat
      );
      asphalt.position.set(op.x, op.deckY + 0.03, op.z);
      asphalt.receiveShadow = true;

      const paraN = new THREE.Mesh(new THREE.BoxGeometry(op.length, 0.95, 0.46), concreteDeckMat);
      paraN.position.set(op.x, op.deckY + 0.47, op.z - op.width * 0.5 + 0.24);
      const paraS = paraN.clone();
      paraS.position.z = op.z + op.width * 0.5 - 0.24;

      const steelN = new THREE.Mesh(new THREE.BoxGeometry(op.length, 0.14, 0.22), railMat);
      steelN.position.set(op.x, op.deckY + 1.05, op.z - op.width * 0.5 + 0.24);
      const steelS = steelN.clone();
      steelS.position.z = op.z + op.width * 0.5 - 0.24;

      // Dashed highway center line on overpass deck
      for (let dx = -op.length * 0.46; dx <= op.length * 0.46; dx += 6.2) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.04, 0.22), stripeMat);
        dash.position.set(op.x + dx, op.deckY + 0.08, op.z);
        opGroup.add(dash);
      }

      opGroup.add(slab, asphalt, paraN, paraS, steelN, steelS);

      // Tapered T-pillars reaching cleanly down into street center median
      for (const p of op.pillarPositions) {
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.75, op.deckY - 1.2, 1.75), pillarMat);
        shaft.position.set(p.x, (op.deckY - 1.2) * 0.5, p.z);
        shaft.castShadow = true;
        const cap = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, op.width * 0.82), pillarMat);
        cap.position.set(p.x, op.deckY - 1.05, p.z);
        cap.castShadow = true;
        opGroup.add(shaft, cap);
      }

      // Highway Green Directional Sign Gantries
      const signTex1 = this.textureStudio.getHighwayGantrySignTexture('NORTH EXPWY', 'CITADEL EXIT');
      const signTex2 = this.textureStudio.getHighwayGantrySignTexture('KTX TERMINAL', '3.2 KM SOUTH');
      for (const [gi, gx] of [-52, 26].entries()) {
        const postL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 4.6, 0.28), railMat);
        postL.position.set(gx, op.deckY + 2.3, op.z - op.width * 0.5 + 0.35);
        const postR = postL.clone();
        postR.position.z = op.z + op.width * 0.5 - 0.35;
        const span = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, op.width - 0.5), railMat);
        span.position.set(gx, op.deckY + 4.45, op.z);

        const board = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 2.25, 6.4),
          new THREE.MeshBasicMaterial({ map: gi === 0 ? signTex1 : signTex2 })
        );
        board.position.set(gx, op.deckY + 3.7, op.z);
        opGroup.add(postL, postR, span, board);
      }

      // High overpass streetlamps along parapets
      for (let lx = -op.length * 0.44; lx <= op.length * 0.44; lx += 22) {
        const lSide = Math.round(lx / 22) % 2 === 0 ? -1 : 1;
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.0, 0.16), railMat);
        pole.position.set(op.x + lx, op.deckY + 2.0, op.z + lSide * (op.width * 0.5 - 0.45));
        const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.55), lampBulbMat);
        bulb.position.set(op.x + lx, op.deckY + 3.95, op.z + lSide * (op.width * 0.5 - 0.95));
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.set(op.x + lx, op.deckY + 2.0, op.z + lSide * (op.width * 0.5 - 0.95));
        cone.visible = this.atmosphereStage !== 'day';
        this.streetLampCones.push(cone);
        opGroup.add(pole, bulb, cone);
      }

      // Crashed rush-hour vehicles & 2 smoking box trucks ON TOP of overpass deck
      const paintTex = this.textureStudio.getVehiclePaintTexture();
      const bodyColors = [0xeab308, 0x3b82f6, 0x991b1b, 0x64748b, 0xe2e8f0, 0x1e293b];
      const deckVehicles: Array<[number, number, number, boolean]> = [
        [-94, -2.2, 0.15, false],
        [-78, 2.1, -0.2, false],
        [-62, -1.9, 0.3, false],
        [-48, 2.2, -0.35, true],
        [-22, -2.0, 0.18, false],
        [-4, 1.9, -0.1, false],
        [14, -2.1, 0.28, false],
        [28, 2.0, -0.25, true],
        [52, -1.8, 0.12, false],
        [72, 2.1, -0.2, false],
        [96, -2.2, 0.08, false]
      ];
      for (let vi = 0; vi < deckVehicles.length; vi++) {
        const [vx, vzOff, rot, isTruck] = deckVehicles[vi];
        const col = isTruck ? 0xd6d3d1 : bodyColors[vi % bodyColors.length];
        const vGrp = new THREE.Group();
        vGrp.position.set(vx, op.deckY + 0.08, op.z + vzOff);
        vGrp.rotation.y = Math.PI * 0.5 + rot;
        const vw = isTruck ? 2.15 : 1.75;
        const vd = isTruck ? 5.6 : 3.5;
        const vh = isTruck ? 2.15 : 1.18;
        const lower = new THREE.Mesh(
          new THREE.BoxGeometry(vw, vh * 0.55, vd),
          new THREE.MeshStandardMaterial({ map: paintTex, color: col, roughness: 0.65 })
        );
        lower.position.y = 0.25 + vh * 0.275;
        lower.castShadow = true;
        const cab = new THREE.Mesh(
          new THREE.BoxGeometry(vw * 0.88, vh * 0.45, vd * (isTruck ? 0.28 : 0.52)),
          new THREE.MeshStandardMaterial({ map: paintTex, color: isTruck ? 0x292524 : col, roughness: 0.68 })
        );
        cab.position.set(0, 0.25 + vh * 0.72, isTruck ? vd * 0.34 : -0.15);
        vGrp.add(lower, cab);
        if (isTruck) {
          this.elevatedSmokeEmitters.push({
            x: vx + Math.cos(rot) * 1.4,
            y: op.deckY + 2.2,
            z: op.z + vzOff,
            seed: vi * 1.7 + 3
          });
        }
        opGroup.add(vGrp);
      }

      this.cityGroup.add(opGroup);
    }

    // Glass-railed Pedestrian Skybridges across downtown avenues
    for (const sb of layout.skybridges) {
      const sbGroup = new THREE.Group();
      sbGroup.position.set(sb.x, sb.deckY, sb.z);

      const deck = new THREE.Mesh(new THREE.BoxGeometry(sb.length, 0.36, sb.width), concreteDeckMat);
      deck.castShadow = true;
      deck.receiveShadow = true;
      const gN = new THREE.Mesh(new THREE.BoxGeometry(sb.length, 1.15, 0.12), glassMat);
      gN.position.set(0, 0.75, -sb.width * 0.5 + 0.08);
      const gS = gN.clone();
      gS.position.z = sb.width * 0.5 - 0.08;
      const railTopN = new THREE.Mesh(new THREE.BoxGeometry(sb.length, 0.1, 0.16), railMat);
      railTopN.position.set(0, 1.34, -sb.width * 0.5 + 0.08);
      const railTopS = railTopN.clone();
      railTopS.position.z = sb.width * 0.5 - 0.08;
      const stripGlow = new THREE.Mesh(
        new THREE.BoxGeometry(sb.length - 1.0, 0.08, 0.26),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
      );
      stripGlow.position.y = -0.2;

      // Support piers resting on sidewalks outside road lanes
      for (const sx of [-sb.length * 0.44, sb.length * 0.44]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.45, sb.deckY, 0.45), pillarMat);
        col.position.set(sx, -sb.deckY * 0.5, 0);
        col.castShadow = true;
        sbGroup.add(col);
      }

      sbGroup.add(deck, gN, gS, railTopN, railTopS, stripGlow);
      this.cityGroup.add(sbGroup);
    }
  }

  private buildExpressRailAndTrain(layout: CityLayout): void {
    if (!layout.hasExpressRail) return;

    const elevated = layout.mapId === 'citadel_express';
    const extension = elevated ? KTX_RAIL_EXTENSION + getTrainLayout(true).carPitch * getTrainLayout(true).carCount : 0;
    const railCenterX = extension * 0.5;
    const railSpan = layout.cityHalfX * 2 + 40 + extension;
    const tracks = layout.railTracksZ.length > 0 ? layout.railTracksZ : [layout.railZ];
    const rz = layout.railZ;
    const trackY = elevated ? KTX_PLATFORM_Y - 0.52 : 0;

    // Gravel ballast bed & sleepers for single or dual parallel tracks
    const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.9 });
    const sleeperGeo = new THREE.BoxGeometry(0.45, 0.14, 3.6);
    const railMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.75, roughness: 0.25 });
    const railGeo = new THREE.BoxGeometry(railSpan, 0.18, 0.2);

    for (const tz of tracks) {
      const ballast = new THREE.Mesh(
        new THREE.BoxGeometry(railSpan, 0.16, 6.2),
        new THREE.MeshStandardMaterial({ color: 0x242933, roughness: 0.95 })
      );
      ballast.position.set(railCenterX, trackY + 0.08, tz);
      this.cityGroup.add(ballast);

      for (let sx = -layout.cityHalfX - 12; sx <= layout.cityHalfX + 12 + extension; sx += 2.2) {
        const sleeper = new THREE.Mesh(sleeperGeo, sleeperMat);
        sleeper.position.set(sx, trackY + 0.16, tz);
        this.cityGroup.add(sleeper);
      }

      const railN = new THREE.Mesh(railGeo, railMat);
      railN.position.set(railCenterX, trackY + 0.24, tz - 1.15);
      const railS = new THREE.Mesh(railGeo, railMat);
      railS.position.set(railCenterX, trackY + 0.24, tz + 1.15);
      this.cityGroup.add(railN, railS);
    }

    this.stationBeaconMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    const canopyGlowMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide
    });
    const canopyConeMat = this.textureStudio.createVolumetricConeMaterial(0x22d3ee, 0.22);
    const canopyConeGeo = new THREE.ConeGeometry(4.2, 4.4, 14, 1, true);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.5 });
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.7 });

    const buildPlatformCanopy = (px: number, pz: number, width: number, isNorthSide: boolean) => {
      const platGroup = new THREE.Group();
      platGroup.position.set(px, 0, pz);

      const platDeck = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.55, 5.4),
        new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 })
      );
      platDeck.position.y = 0.27;
      platDeck.receiveShadow = true;

      const safetyStrip = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.58, 0.45),
        new THREE.MeshBasicMaterial({ color: 0xfacc15 })
      );
      safetyStrip.position.set(0, 0.27, isNorthSide ? 2.45 : -2.45);

      const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(width - 2.0, 0.35, 5.2),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.4 })
      );
      canopy.position.y = 4.6;
      canopy.castShadow = true;

      const trimFront = new THREE.Mesh(
        new THREE.BoxGeometry(width - 1.5, 0.32, 0.34),
        this.stationBeaconMat!
      );
      trimFront.position.set(0, 4.72, 2.65);
      const trimBack = trimFront.clone();
      trimBack.position.z = -2.65;
      const trimL = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 5.64), this.stationBeaconMat!);
      trimL.position.set(-(width - 1.5) * 0.5, 4.72, 0);
      const trimR = trimL.clone();
      trimR.position.x = (width - 1.5) * 0.5;

      const underGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(width - 2.6, 4.4),
        canopyGlowMat
      );
      underGlow.rotation.x = Math.PI / 2;
      underGlow.position.y = 4.38;

      for (const ox of [-width * 0.36, 0, width * 0.36]) {
        const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 4.5, 8), pillarMat);
        pil.position.set(ox, 2.25, 0);
        platGroup.add(pil);
      }
      for (const cxOff of [-width * 0.25, width * 0.25]) {
        const cone = new THREE.Mesh(canopyConeGeo, canopyConeMat);
        cone.position.set(cxOff, 2.2, 0);
        platGroup.add(cone);
      }
      for (const bx of [-width * 0.22, width * 0.22]) {
        const bench = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.45, 0.8), benchMat);
        bench.position.set(bx, 0.75, isNorthSide ? -0.8 : 0.8);
        platGroup.add(bench);
      }

      platGroup.add(platDeck, safetyStrip, canopy, trimFront, trimBack, trimL, trimR, underGlow);
      this.cityGroup.add(platGroup);
    };

    if (elevated) {
      this.buildKtxBase(railSpan, railCenterX, layout.cityHalfX + 20 + extension);
    } else {
      buildPlatformCanopy(layout.stationPos.x, rz - 6.0, 34, true);
    }

    // Walkable KTX train with inter-car doors and passenger seating.
    const trainGroup = new THREE.Group();
    const hullTex = this.textureStudio.getTrainHullTexture();
    const hullSideMat = new THREE.MeshStandardMaterial({
      map: hullTex,
      color: 0xffffff,
      roughness: 0.34,
      metalness: 0.22
    });
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textureStudio.getTrainFloorTexture(),
      roughness: 0.72
    });
    const seatBlueMat = new THREE.MeshStandardMaterial({ color: 0x0c1b36, roughness: 0.78 });
    const seatTrimMat = new THREE.MeshStandardMaterial({ color: 0x162f59, roughness: 0.62 });
    const innerWallMat = new THREE.MeshStandardMaterial({ color: 0x141b26, roughness: 0.86 });
    const hullTopMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.42 });
    const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.45 });
    const bogieMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85 });
    const rackMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.65 });
    const suitcaseCols = [0x1e3a8a, 0x991b1b, 0x78350f, 0x0f766e, 0x475569];
    const windowGlassMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      transparent: true,
      opacity: 0.24,
      roughness: 0.2,
      metalness: 0.4,
      depthWrite: false
    });
    const warmLightMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xfef3c7).multiplyScalar(1.35),
      toneMapped: false
    });
    const doorGlassTex0 = this.textureStudio.getDoorGlassTexture(0);

    const trainConeGeo = new THREE.ConeGeometry(2.0, 12.0, 10, 1, true);
    trainConeGeo.translate(0, -6.0, 0);
    trainConeGeo.rotateZ(Math.PI / 2);
    const trainConeMat = this.textureStudio.createVolumetricConeMaterial(0xfef08a, 0.24);

    const trainLayout = getTrainLayout(layout.mapId === 'citadel_express');
    const { centers, carLength, seatRows, rearX, frontX } = trainLayout;
    const carWidth = TRAIN_WIDTH;
    const wallH = 2.95;
    const seatBases = new THREE.InstancedMesh(new THREE.BoxGeometry(0.66, 0.38, 0.49), seatBlueMat, trainLayout.capacity);
    const seatBacks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.92, 0.49), seatTrimMat, trainLayout.capacity);
    const seatMatrix = new THREE.Matrix4();
    let seatIndex = 0;

    for (const [ci, cx] of centers.entries()) {
      const isRearCar = ci === 0;
      const isFrontCar = ci === centers.length - 1;

      const floor = new THREE.Mesh(new THREE.BoxGeometry(carLength, 0.22, carWidth), floorMat);
      floor.position.set(cx, 0.12, 0);
      floor.receiveShadow = true;

      const chassis = new THREE.Mesh(new THREE.BoxGeometry(carLength - 0.8, 0.3, 2.6), bogieMat);
      chassis.position.set(cx, -0.08, 0);

      const ceilLiner = new THREE.Mesh(new THREE.BoxGeometry(carLength, 0.1, carWidth - 0.1), ceilingMat);
      ceilLiner.position.set(cx, 3.0, 0);

      const roofShell = new THREE.Mesh(new THREE.BoxGeometry(carLength + 0.35, 0.18, carWidth + 0.1), hullTopMat);
      roofShell.position.set(cx, 3.14, 0);
      roofShell.castShadow = true;

      // Dual warm overhead aisle light strips + double crimson emergency strip lights per car
      for (const lz of [-0.95, 0.95]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(carLength - 1.6, 0.05, 0.2), warmLightMat);
        strip.position.set(cx, 2.94, lz);
        trainGroup.add(strip);
      }
      for (const exOff of [-3.6, carLength * 0.5 - 1.1]) {
        const emergMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
        this.trainEmergencyLightMats.push(emergMat);
        const emergStrip = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.07, 0.36), emergMat);
        emergStrip.position.set(cx + exOff, 2.94, 0);
        trainGroup.add(emergStrip);
      }
      trainGroup.add(floor, chassis, ceilLiner, roofShell);

      // Leave the platform-side doorway open in the rear car.
      const buildSideWall = (zSide: number, isNorth: boolean) => {
        if (isNorth && isRearCar) {
          for (const [segStart, segEnd] of [
            [cx - carLength * 0.5, cx - 1.8],
            [cx + 1.8, cx + carLength * 0.5]
          ]) {
            const sw = segEnd - segStart;
            const scx = (segStart + segEnd) * 0.5;
            const knee = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.95, 0.18), hullSideMat);
            knee.position.set(scx, 0.65, zSide);
            const hdr = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.65, 0.18), innerWallMat);
            hdr.position.set(scx, 2.66, zSide);
            const pane = new THREE.Mesh(new THREE.BoxGeometry(sw, 1.38, 0.06), windowGlassMat);
            pane.position.set(scx, 1.82, zSide);
            trainGroup.add(knee, hdr, pane);
          }
          // Glowing cyan boarding doorway frame + step threshold plate on the rear car
          const thresh = new THREE.Mesh(
            new THREE.BoxGeometry(3.6, 0.14, 1.35),
            new THREE.MeshBasicMaterial({ color: 0x22d3ee })
          );
          thresh.position.set(cx, 0.14, zSide - 0.55);
          trainGroup.add(thresh);
        } else {
          const knee = new THREE.Mesh(new THREE.BoxGeometry(carLength, 0.95, 0.18), hullSideMat);
          knee.position.set(cx, 0.65, zSide);
          const hdr = new THREE.Mesh(new THREE.BoxGeometry(carLength, 0.65, 0.18), innerWallMat);
          hdr.position.set(cx, 2.66, zSide);
          for (let px = -carLength * 0.48; px <= carLength * 0.48; px += 2.8) {
            const pil = new THREE.Mesh(new THREE.BoxGeometry(0.32, wallH, 0.2), innerWallMat);
            pil.position.set(cx + px, wallH * 0.5 + 0.15, zSide);
            trainGroup.add(pil);
          }
          const glass = new THREE.Mesh(new THREE.BoxGeometry(carLength - 0.4, 1.4, 0.06), windowGlassMat);
          glass.position.set(cx, 1.82, zSide);
          trainGroup.add(knee, hdr, glass);
        }
      };
      buildSideWall(-carWidth * 0.5 + 0.09, true);
      buildSideWall(carWidth * 0.5 - 0.09, false);

      // Overhead luggage racks & blocky suitcases on both walls
      for (const rz of [-carWidth * 0.5 + 0.52, carWidth * 0.5 - 0.52]) {
        const rack = new THREE.Mesh(new THREE.BoxGeometry(carLength - 1.4, 0.08, 0.72), rackMat);
        rack.position.set(cx, 2.38, rz);
        trainGroup.add(rack);
        for (let si = 0; si < 3; si++) {
          const sx = cx - 4.4 + si * 4.2 + (rz < 0 ? 0.4 : -0.4);
          if (isRearCar && rz < 0 && Math.abs(sx - cx) < 2.2) continue;
          const sc = new THREE.Mesh(
            new THREE.BoxGeometry(1.1, 0.34, 0.52),
            new THREE.MeshStandardMaterial({
              color: suitcaseCols[(ci * 3 + si) % suitcaseCols.length],
              roughness: 0.75
            })
          );
          sc.position.set(sx, 2.58, rz);
          trainGroup.add(sc);
        }
      }

      for (const row of seatRows) {
        const sx = cx + row;
        for (const sz of TRAIN_SEAT_SIDES) {
          seatBases.setMatrixAt(seatIndex, seatMatrix.makeTranslation(sx, 0.42, sz));
          seatBacks.setMatrixAt(seatIndex, seatMatrix.makeTranslation(sx - 0.24, 0.94, sz));
          seatIndex++;
        }
      }

      if (isRearCar) {
        const rearWall = new THREE.Mesh(new THREE.BoxGeometry(0.25, wallH, carWidth), innerWallMat);
        rearWall.position.set(cx - carLength * 0.5, wallH * 0.5 + 0.12, 0);
        trainGroup.add(rearWall);
      }

      // Car 1 Front Conductor Safe Cabin Wall + Green Departure Console!
      if (isFrontCar) {
        const cabX = cx + carLength * 0.5 - 0.15;
        const cabWall = new THREE.Mesh(new THREE.BoxGeometry(0.32, wallH, carWidth), noseMat);
        cabWall.position.set(cabX, wallH * 0.5 + 0.12, 0);
        this.trainConsoleLightMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
        const safeBeacon = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.34, 1.15), this.trainConsoleLightMat);
        safeBeacon.position.set(cabX - 0.22, 2.55, 0);
        const panelBox = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.72, 0.85),
          new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 })
        );
        panelBox.position.set(cabX - 0.22, 1.32, 0);
        const switchButton = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, 0.36), this.trainConsoleLightMat);
        switchButton.position.set(cabX - 0.24, 1.38, 0);
        trainGroup.add(cabWall, safeBeacon, panelBox, switchButton);
      }
    }

    trainGroup.add(seatBases, seatBacks);

    for (const [di, doorX] of trainLayout.bulkheads.entries()) {
      const doorId = di + 1;
      const gangwayFloor = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, carWidth), floorMat);
      gangwayFloor.position.set(doorX, 0.12, 0);
      const gangwayRoof = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.18, carWidth), noseMat);
      gangwayRoof.position.set(doorX, 3.06, 0);

      // Left & Right solid bulkhead wall wings leaving a 1.8m central sliding glass doorway
      const wingW = (carWidth - 1.8) * 0.5;
      const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.22, wallH, wingW), innerWallMat);
      wingL.position.set(doorX, wallH * 0.5 + 0.12, -carWidth * 0.5 + wingW * 0.5);
      const wingR = wingL.clone();
      wingR.position.z = carWidth * 0.5 - wingW * 0.5;
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.62, 1.9), innerWallMat);
      lintel.position.set(doorX, 2.75, 0);
      const topWarnBar = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.18, 1.75),
        new THREE.MeshBasicMaterial({ color: 0xef4444 })
      );
      topWarnBar.position.set(doorX, 2.52, 0);

      const doorGroup = new THREE.Group();
      doorGroup.position.set(doorX, 0.23, 0);
      const glassMat = new THREE.MeshBasicMaterial({
        map: doorGlassTex0,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const slidingLeaf = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 2.2), glassMat);
      slidingLeaf.rotation.y = Math.PI / 2;
      slidingLeaf.position.set(0, 1.1, 0);
      const stileL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, 0.08), noseMat);
      stileL.position.set(0, 1.1, -0.84);
      const stileR = stileL.clone();
      stileR.position.z = 0.84;
      const steelBar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 1.68), rackMat);
      steelBar.position.set(0, 0.96, 0);
      const lockBadge = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.18, 0.12),
        new THREE.MeshBasicMaterial({ color: 0xf59e0b })
      );
      lockBadge.position.set(0, 1.0, 0.74);
      lockBadge.visible = false;
      doorGroup.add(slidingLeaf, stileL, stileR, steelBar, lockBadge);

      trainGroup.add(gangwayFloor, gangwayRoof, wingL, wingR, lintel, topWarnBar, doorGroup);
      this.trainDoorVisuals.set(doorId, {
        doorGroup,
        slidingLeaf,
        glassMat,
        lockBadge,
        baseX: doorX,
        lastDamageStage: 0
      });
    }

    // Streamlined KTX Aerodynamic Head (+X) & Tail (-X) Noses with Dual Headlights
    for (const dir of [-1, 1]) {
      const endX = dir < 0 ? rearX : frontX;
      const nose1 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.3, 3.6), noseMat);
      nose1.position.set(endX + dir * 1.1, 1.38, 0);
      const nose2 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.45, 2.8), noseMat);
      nose2.position.set(endX + dir * 2.8, 1.0, 0);
      trainGroup.add(nose1, nose2);
      if (dir === 1) {
        for (const hz of [-0.75, 0.75]) {
          const hl = new THREE.Mesh(
            new THREE.BoxGeometry(0.25, 0.28, 0.36),
            new THREE.MeshBasicMaterial({ color: 0xfef08a })
          );
          hl.position.set(endX + 3.65, 1.0, hz);
          const cone = new THREE.Mesh(trainConeGeo, trainConeMat);
          cone.position.set(endX + 3.7, 1.0, hz);
          trainGroup.add(hl, cone);
        }
      }
    }

    trainGroup.position.set(-220, 0.25, rz);
    trainGroup.visible = false;
    this.cityGroup.add(trainGroup);
    this.expressTrainGroup = trainGroup;
  }

  private ktxShutters = new Map<KtxGateId, THREE.Mesh>();

  private buildKtxBase(railSpan: number, railCenterX: number, railEndX: number): void {
    const group = new THREE.Group();
    const concrete = new THREE.MeshStandardMaterial({ color: 0x5b6370, roughness: 0.87 });
    const tile = new THREE.MeshStandardMaterial({ color: 0x777986, roughness: 0.85 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x253546, roughness: 0.66 });
    const gatePanel = new THREE.MeshStandardMaterial({ map: this.textureStudio.getBlastGateTexture(), metalness: 0.44, roughness: 0.65 });
    const amber = new THREE.MeshBasicMaterial({ color: 0xf6b761 });
    const cyan = new THREE.MeshBasicMaterial({ color: 0x5bd6e8 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x177082, roughness: 0.72 });
    const cabinet = new THREE.MeshStandardMaterial({ color: 0x65746c, roughness: 0.77 });
    const red = new THREE.MeshBasicMaterial({ color: 0xf05c54 });
    const block = (x: number, y: number, z: number, width: number, height: number, depth: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      mesh.position.set(x, y, z);
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    const railing = (ax: number, az: number, bx: number, bz: number, y: number, endY = y) => {
      const dx = bx - ax, dz = bz - az, dy = endY - y;
      const length = Math.hypot(dx, dz, dy);
      for (const h of [0.5, 1.02]) {
        const bar = block((ax + bx) / 2, (y + endY) / 2 + h, (az + bz) / 2, 0.075, 0.06, length, steel);
        bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dx, dy, dz).normalize());
      }
      const posts = Math.max(1, Math.ceil(length / 3));
      for (let i = 0; i <= posts; i++) {
        const t = i / posts;
        block(ax + dx * t, y + dy * t + 0.51, az + dz * t, 0.085, 1.03, 0.085, steel);
      }
    };
    const sign = (x: number, y: number, z: number, width: number, name: string, detail: string, color = '#66dfed') => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#101d28';
      ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 512, 7);
      ctx.font = 'bold 48px "Microsoft YaHei", sans-serif';
      ctx.fillText(name, 20, 61, 472);
      ctx.font = '24px sans-serif';
      ctx.fillStyle = '#e7f2f5';
      ctx.fillText(detail, 20, 103, 472);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const height = width / 4;
      block(x, y, z, width + 0.11, height + 0.08, 0.12, steel);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
      panel.position.set(x, y, z - 0.065);
      panel.rotation.y = Math.PI;
      group.add(panel);
    };
    // The continuous deck sits on discrete piers. The service road stays open below it.
    block(railCenterX, KTX_PLATFORM_Y - 0.91, 200, railSpan, 0.86, 13.8, concrete);
    block(railCenterX, 0.04, 199, railSpan, 0.07, 4.9, steel);
    const crossing = KTX_FORECOURT_CROSSING;
    block(crossing.x, 2.94, crossing.z, 0.61, 0.32, crossing.width + 0.24, steel);
    for (const z of [crossing.z - crossing.width / 2 + 0.53, crossing.z + crossing.width / 2 - 0.53]) {
      block(crossing.x, 0.055, z, 4, 0.02, 0.095, cyan);
      block(crossing.x, 2.69, z, 0.52, 0.08, 0.16, cyan);
    }
    for (let x = 140; x < railEndX - 3; x += 28) {
      block(x, 2.75, 199, 2.3, 5.5, 3.2, concrete);
    }
    const checkpointX = railEndX - 5;
    for (const z of [193.3, 206.7]) {
      block(checkpointX, 8.55, z, 0.6, 5.1, 0.6, steel);
      block(checkpointX, 9.8, z, 0.69, 0.45, 0.69, amber);
    }
    block(checkpointX, 11, 200, 0.68, 0.7, 14, steel);
    sign(checkpointX - 3, 10.3, 193.24, 5.7, '隔离终点', 'KTX QUARANTINE CHECKPOINT', '#f6b761');
    for (let x = -116; x < 118; x += 8) block(x, 0.082, 199, 3, 0.014, 0.08, amber);
    for (const box of KTX_BOXES) {
      const y = box.y ?? 0;
      if (box.kind === 'bench') {
        const alongZ = box.depth > box.width;
        block(box.x, y + 0.43, box.z, box.width, 0.13, box.depth, seat);
        block(box.x - (alongZ ? box.width * 0.38 : 0), y + 0.71, box.z + (alongZ ? 0 : box.depth * 0.37),
          alongZ ? 0.12 : box.width, 0.45, alongZ ? box.depth : 0.12, seat);
        for (const offset of [-0.32, 0.32]) {
          block(box.x + (alongZ ? 0 : box.width * offset), y + 0.18, box.z + (alongZ ? box.depth * offset : 0),
            0.18, 0.36, 0.18, steel);
        }
        continue;
      }
      if (box.kind === 'locker') {
        block(box.x, y + box.height / 2, box.z, box.width, box.height, box.depth, cabinet);
        const alongZ = box.depth > box.width;
        for (let slot = -1; slot <= 1; slot++) {
          const x = box.x + (alongZ ? -box.width / 2 - 0.013 : slot * box.width / 3);
          const z = box.z + (alongZ ? slot * box.depth / 3 : -box.depth / 2 - 0.013);
          block(x, y + box.height * 0.52, z, alongZ ? 0.043 : 0.19, 0.07, alongZ ? 0.19 : 0.043, amber);
        }
        continue;
      }
      block(box.x, y + box.height / 2, box.z, box.width, box.height, box.depth, box.kind === 'supply' ? steel : concrete);
      block(box.x, y + Math.min(box.height - 0.17, 2.2), box.z - box.depth / 2 - 0.018,
        Math.min(box.width * 0.56, 1.6), 0.13, 0.05, box.kind === 'wall' ? cyan : amber);
    }
    for (const surface of KTX_SURFACES) {
      const { minX, maxX, minZ, maxZ, fromY, toY, id } = surface;
      const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
      const width = maxX - minX, length = maxZ - minZ;
      if (fromY !== toY) {
        const steps = Math.ceil((toY - fromY) / 0.19);
        for (let step = 0; step < steps; step++) {
          const sz = minZ + (step + 0.5) * length / steps;
          const y = ktxSurfaceHeight(surface, x, sz);
          block(x, y - 0.16, sz, width, 0.34, length / steps + 0.015, tile);
          block(x, y + 0.008, sz - length / steps * 0.3, width - 0.24, 0.021, 0.055, amber);
        }
        railing(minX, minZ, minX, maxZ, fromY, toY);
        railing(maxX, minZ, maxX, maxZ, fromY, toY);
      } else {
        block(x, fromY - 0.28, z, width, 0.56, length, tile);
        if (id === 'tower' || id.endsWith('landing')) {
          railing(minX, minZ, minX, maxZ, fromY);
          railing(maxX, minZ, maxX, maxZ, fromY);
          block(x, fromY / 2 - 0.12, z, 0.58, fromY - 0.24, 0.65, steel);
        }
      }
    }
    // Rails leave deliberate apertures at both stairheads and the actual boarding door.
    for (const [a, b] of [[-61, -57], [-50, 8], [24.5, 39], [49, 56]]) railing(a, 189, b, 189, KTX_PLATFORM_Y);
    railing(8, 157.5, 24.5, 157.5, KTX_PLATFORM_Y);
    for (const x of [8, 24.5]) railing(x, 157.5, x, 189, KTX_PLATFORM_Y);
    const door = KTX_SURFACES[KTX_SURFACES.length - 1];
    railing(-61, 194, door.minX, 194, KTX_PLATFORM_Y);
    railing(door.maxX, 194, 56, 194, KTX_PLATFORM_Y);
    railing(-61, 189, -61, 194, KTX_PLATFORM_Y);
    railing(56, 189, 56, 194, KTX_PLATFORM_Y);
    block(0, KTX_PLATFORM_Y + 0.015, 193.4, 113, 0.03, 0.12, amber);
    for (const z of [189.35, 193.78]) block(-2.5, 6.008, z, 115, 0.012, 0.17, steel);
    for (let x = -59; x < 55; x += 3) {
      block(x, 6.007, 191.5, 0.025, 0.012, 3.7, steel);
    }
    for (const x of [-43, -23, -4, 17, 37, 53]) {
      block(x, 7.85, 189.5, 0.26, 3.7, 0.26, steel);
      block(x, 9.45, 191.1, 5.4, 0.17, 0.13, cyan);
    }
    block(5, 9.75, 191.15, 99, 0.28, 4.4, steel);
    sign(-15, 8.55, 193.75, 4.2, '01 登车口', 'BOARDING  ·  TRACK 1');
    sign(14, 8.65, 188.93, 5, '候车区', 'OPEN-AIR WAITING DECK');
    sign(-44, 8.62, 191.1, 4.7, '西侧勤务通道', 'SERVICE ACCESS', '#f6b761');
    sign(29, 3.14, 155.36, 5.3, '疏散入口  →', 'EVACUATION INTAKE');
    for (const x of [24.45, 32.95]) {
      block(x, 1.43, 155.37, 0.16, 2.86, 0.19, steel);
      block(x, 2.66, 155.24, 0.29, 0.18, 0.14, cyan);
    }

    for (const id of KTX_GATE_IDS) {
      const g = KTX_GATES[id];
      const box = ktxGateBox(id);
      const light = id === 'public' ? cyan : amber;
      this.ktxShutters.set(id, block(g.x, g.y + box.height / 2, g.z, box.width, box.height, box.depth, gatePanel));
      const alongX = g.axis === 'x';
      for (const side of [-1, 1]) {
        const offset = side * g.width / 2;
        block(g.x + (alongX ? offset : 0), g.y + 1.53, g.z + (alongX ? 0 : offset), 0.47, 3.06, 0.47, steel);
      }
      block(g.x, g.y + 2.98, g.z, alongX ? g.width + 0.45 : 0.6, 0.34, alongX ? 0.6 : g.width + 0.45, steel);
      if (alongX) {
        block(g.x, g.y + 2.98, g.z - 0.31, g.width * 0.62, 0.115, 0.04, light);
      } else {
        for (const side of [-1, 1]) {
          block(g.x + side * 0.31, g.y + 2.98, g.z, 0.04, 0.115, g.width * 0.64, light);
        }
      }
    }

    for (const x of [15.5, 46.4]) {
      block(x, 2.6, 160.0, 9.4, 0.24, 5.6, steel);
      for (const dx of [-4.4, 4.4]) for (const dz of [-2.5, 2.5]) block(x + dx, 1.25, 160.0 + dz, 0.17, 2.5, 0.17, steel);
      for (const dz of [-1.25, 0.9]) {
        block(x, 0.31, 160.0 + dz, 6.7, 0.33, 0.56, concrete);
        block(x, 0.62, 160.28 + dz, 6.7, 0.43, 0.10, steel);
      }
      block(x, 2.43, 158.1, 5, 0.06, 0.11, cyan);
    }
    for (const x of [29.5, 34.5]) for (let z = 151.8; z < 166; z += 2.2) {
      block(x, 0.05, z, 0.095, 0.025, 0.98, cyan);
    }
    for (let z = 154; z < 165.5; z += 2.2) block(-43, 0.05, z, 0.105, 0.025, 0.95, amber);
    for (const x of [-62, -56]) for (const z of [161.4, 164.6]) {
      block(x, 3.25, z, 0.28, 6.5, 0.28, steel);
    }
    railing(-64, 165, -54, 165, 4);
    railing(-64, 161, -64, 165, 4);
    railing(-54, 161, -54, 165, 4);
    block(-59, 6.55, 163, 10.3, 0.26, 4.6, steel);
    block(-59, 6.94, 161.85, 1.1, 0.54, 0.69, steel);
    block(-59, 6.94, 161.48, 0.65, 0.28, 0.06, cyan);
    const beamGeometry = new THREE.ConeGeometry(3.4, 15.5, 12, 1, true);
    beamGeometry.translate(0, -7.75, 0);
    const beam = new THREE.Mesh(beamGeometry, this.textureStudio.createVolumetricConeMaterial(0xa7dcff, 0.17));
    beam.position.set(-59, 6.9, 161.5);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0.27, -0.41, -0.87).normalize());
    group.add(beam);
    block(47, 3.57, 176.18, 3.5, 1.14, 0.28, concrete);
    block(47, 4.02, 176.02, 2.4, 0.095, 0.05, cyan);
    block(53, 2.62, 157.5, 5.1, 0.23, 4.35, steel);
    sign(53, 2.92, 155.65, 3.45, '医疗分诊', 'FIRST AID / TRIAGE', '#ff8377');
    block(50.75, 1.67, 157.5, 0.06, 0.75, 0.22, red);
    block(50.75, 1.67, 157.5, 0.06, 0.22, 0.75, red);
    block(4, 2.56, 176, 8, 0.26, 5, steel);
    sign(4, 1.84, 173.95, 3.8, '勤务仓库', 'SUPPLY / MAINTENANCE', '#f6b761');
    this.cityGroup.add(group);
  }

  private buildRiversAndBridges(layout: CityLayout): void {
    if (layout.rivers.length === 0) return;

    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x103c58,
      emissive: 0x0a2538,
      emissiveIntensity: 0.48,
      roughness: 0.14,
      metalness: 0.58
    });
    const bankWallMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.75 });

    for (const r of layout.rivers) {
      const w = r.maxX - r.minX;
      const d = r.maxZ - r.minZ;
      const cx = (r.minX + r.maxX) * 0.5;
      const cz = (r.minZ + r.maxZ) * 0.5;

      const water = new THREE.Mesh(new THREE.PlaneGeometry(w, d), waterMat);
      water.rotation.x = -Math.PI / 2;
      water.position.set(cx, 0.04, cz);
      water.receiveShadow = true;
      this.cityGroup.add(water);

      const shimmer = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d * 0.35),
        new THREE.MeshBasicMaterial({ color: 0xd49a7a, transparent: true, opacity: 0.11 })
      );
      shimmer.rotation.x = -Math.PI / 2;
      shimmer.position.set(cx, 0.05, cz);
      this.cityGroup.add(shimmer);

      const sortedBridges = [...layout.bridges].sort((a, b) => a.x - b.x);
      let cursorX = r.minX;
      const wallSegments: Array<{ start: number; end: number }> = [];
      for (const br of sortedBridges) {
        const bStart = br.x - br.width * 0.5;
        const bEnd = br.x + br.width * 0.5;
        if (bStart > cursorX) {
          wallSegments.push({ start: cursorX, end: bStart });
        }
        cursorX = Math.max(cursorX, bEnd);
      }
      if (cursorX < r.maxX) {
        wallSegments.push({ start: cursorX, end: r.maxX });
      }

      for (const seg of wallSegments) {
        const segW = seg.end - seg.start;
        const segCx = (seg.start + seg.end) * 0.5;
        const wallGeo = new THREE.BoxGeometry(segW, 0.52, 0.7);
        const wallN = new THREE.Mesh(wallGeo, bankWallMat);
        wallN.position.set(segCx, 0.26, r.minZ - 0.35);
        const wallS = new THREE.Mesh(wallGeo, bankWallMat);
        wallS.position.set(segCx, 0.26, r.maxZ + 0.35);
        this.cityGroup.add(wallN, wallS);
      }
    }

    const deckMat = new THREE.MeshStandardMaterial({ color: 0x262f3d, roughness: 0.85 });
    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8 });
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.45, metalness: 0.3 });
    const cableMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.5 });
    const girderMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.78 });
    const lampPostMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.5 });
    const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const brConeGeo = new THREE.ConeGeometry(3.2, 4.2, 14, 1, true);
    const brConeMat = this.textureStudio.createVolumetricConeMaterial(0xffde99, 0.24);

    for (const br of layout.bridges) {
      const brGroup = new THREE.Group();
      brGroup.position.set(br.x, 0, br.z);

      const deck = new THREE.Mesh(new THREE.BoxGeometry(br.width, 0.22, br.length), deckMat);
      deck.position.y = 0.08;
      deck.receiveShadow = true;
      brGroup.add(deck);

      const swGeo = new THREE.BoxGeometry(2.4, 0.2, br.length);
      const swW = new THREE.Mesh(swGeo, sidewalkMat);
      swW.position.set(-br.width * 0.5 + 1.2, 0.14, 0);
      const swE = new THREE.Mesh(swGeo, sidewalkMat);
      swE.position.set(br.width * 0.5 - 1.2, 0.14, 0);
      brGroup.add(swW, swE);

      const railGeo = new THREE.BoxGeometry(0.32, 1.05, br.length);
      const railW = new THREE.Mesh(railGeo, layout.mapId === 'citadel_express' ? girderMat : railMat);
      railW.position.set(-br.width * 0.5 + 0.18, 0.62, 0);
      const railE = new THREE.Mesh(railGeo, layout.mapId === 'citadel_express' ? girderMat : railMat);
      railE.position.set(br.width * 0.5 - 0.18, 0.62, 0);
      brGroup.add(railW, railE);

      if (layout.mapId === 'citadel_express') {
        // Concrete urban girder parapet + 4 warm dusk bridge streetlights (unobstructed containers & canal)
        const curbCapGeo = new THREE.BoxGeometry(0.48, 0.22, br.length);
        const capW = new THREE.Mesh(curbCapGeo, railMat);
        capW.position.set(-br.width * 0.5 + 0.18, 1.18, 0);
        const capE = new THREE.Mesh(curbCapGeo, railMat);
        capE.position.set(br.width * 0.5 - 0.18, 1.18, 0);
        brGroup.add(capW, capE);

        for (const lx of [-br.width * 0.5 + 0.5, br.width * 0.5 - 0.5]) {
          for (const lz of [-6.5, 6.5]) {
            const pole = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.4, 0.18), lampPostMat);
            pole.position.set(lx, 2.2, lz);
            const armX = lx < 0 ? 0.55 : -0.55;
            const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 0.16), lampPostMat);
            arm.position.set(lx + armX, 4.35, lz);
            const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.12, 0.28), lampHeadMat);
            bulb.position.set(lx + armX * 1.4, 4.24, lz);
            const cone = new THREE.Mesh(brConeGeo, brConeMat);
            cone.position.set(lx + armX * 1.4, 2.15, lz);
            cone.visible = this.atmosphereStage !== 'day';
            this.streetLampCones.push(cone);
            brGroup.add(pole, arm, bulb, cone);
          }
        }
      } else {
        for (const pz of [-7.5, 7.5]) {
          const legGeo = new THREE.BoxGeometry(0.95, 13.5, 0.95);
          const legW = new THREE.Mesh(legGeo, pylonMat);
          legW.position.set(-br.width * 0.5 + 0.45, 6.75, pz);
          legW.castShadow = true;
          const legE = new THREE.Mesh(legGeo, pylonMat);
          legE.position.set(br.width * 0.5 - 0.45, 6.75, pz);
          legE.castShadow = true;

          const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(br.width, 0.95, 0.95), pylonMat);
          crossBeam.position.set(0, 12.6, pz);

          const beaconW = new THREE.Mesh(
            new THREE.SphereGeometry(0.28, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xf97316 })
          );
          beaconW.position.set(-br.width * 0.5 + 0.45, 13.7, pz);
          const beaconE = beaconW.clone();
          beaconE.position.x = br.width * 0.5 - 0.45;

          brGroup.add(legW, legE, crossBeam, beaconW, beaconE);

          for (const sideX of [-br.width * 0.5 + 0.45, br.width * 0.5 - 0.45]) {
            for (const targetZ of [pz - 6.5, pz + 6.5]) {
              const pTop = new THREE.Vector3(sideX, 12.8, pz);
              const pDeck = new THREE.Vector3(sideX, 0.55, targetZ);
              const len = pTop.distanceTo(pDeck);
              const cable = new THREE.Mesh(
                new THREE.CylinderGeometry(0.06, 0.06, len, 5),
                cableMat
              );
              cable.position.copy(pTop).add(pDeck).multiplyScalar(0.5);
              cable.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                pDeck.clone().sub(pTop).normalize()
              );
              brGroup.add(cable);
            }
          }
        }
      }

      this.cityGroup.add(brGroup);
    }
  }

  private buildSidewalksAndPark(layout: CityLayout): void {
    const swTex = this.textureStudio.getSidewalkTexture(4);
    const sidewalkMat = new THREE.MeshStandardMaterial({
      map: swTex,
      color: 0xffffff,
      roughness: 0.88
    });
    const innerLotMat = new THREE.MeshStandardMaterial({
      map: swTex,
      color: 0x94a3b8,
      roughness: 0.92
    });
    const isOrganic = layout.mapId === 'citadel_express';

    for (let row = 0; row < layout.roadZs.length - 1; row++) {
      if (layout.mapId === 'twin_bridges' && row === 3) continue;

      const z0 = layout.roadZs[row];
      const z1 = layout.roadZs[row + 1];
      const cz = (z0 + z1) * 0.5;
      const cellD = z1 - z0 - ROAD_WIDTH;

      for (let col = 0; col < layout.roadXs.length - 1; col++) {
        const x0 = layout.roadXs[col];
        const x1 = layout.roadXs[col + 1];
        const cx = (x0 + x1) * 0.5;
        const cellW = x1 - x0 - ROAD_WIDTH;
        if (cellW < 4 || cellD < 4) continue;

        if (isOrganic && !layout.occupiedBlockKeys.has(`${row}:${col}`)) {
          continue;
        }

        const sw = new THREE.Mesh(new THREE.BoxGeometry(cellW, 0.24, cellD), sidewalkMat);
        sw.position.set(cx, 0.12, cz);
        sw.receiveShadow = true;
        this.cityGroup.add(sw);

        const isPark =
          Math.abs(cx - layout.centralPark.x) < 1 && Math.abs(cz - layout.centralPark.z) < 1;
        const isPlaza = layout.plazas.some(
          (pl) => Math.abs(cx - pl.x) < 1 && Math.abs(cz - pl.z) < 1
        );

        if (isPark) {
          const grassW = Math.max(6, cellW - 2.6);
          const grassD = Math.max(6, cellD - 2.6);
          const grass = new THREE.Mesh(
            new THREE.BoxGeometry(grassW, 0.3, grassD),
            new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.9 })
          );
          grass.position.set(cx, 0.15, cz);
          grass.receiveShadow = true;
          this.cityGroup.add(grass);

          const pathMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.8 });
          const pathNS = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.32, grassD + 0.2), pathMat);
          pathNS.position.set(cx, 0.16, cz);
          const pathEW = new THREE.Mesh(new THREE.BoxGeometry(grassW + 0.2, 0.32, 2.6), pathMat);
          pathEW.position.set(cx, 0.16, cz);
          this.cityGroup.add(pathNS, pathEW);

          const basin = new THREE.Mesh(
            new THREE.CylinderGeometry(3.4, 3.6, 0.55, 20),
            new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6 })
          );
          basin.position.set(cx, 0.35, cz);
          const water = new THREE.Mesh(
            new THREE.CylinderGeometry(2.9, 2.9, 0.6, 20),
            new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.2, metalness: 0.1 })
          );
          water.position.set(cx, 0.36, cz);
          const obelisk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.35, 0.85, 4.2, 8),
            new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 })
          );
          obelisk.position.set(cx, 2.4, cz);
          obelisk.castShadow = true;
          this.cityGroup.add(basin, water, obelisk);
        } else if (isPlaza) {
          const plazaFloor = new THREE.Mesh(
            new THREE.BoxGeometry(cellW - 2.2, 0.3, cellD - 2.2),
            new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 })
          );
          plazaFloor.position.set(cx, 0.15, cz);
          plazaFloor.receiveShadow = true;

          const outerRing = new THREE.Mesh(
            new THREE.RingGeometry(6.8, 9.2, 28),
            new THREE.MeshStandardMaterial({ color: 0x475569, side: THREE.DoubleSide })
          );
          outerRing.rotation.x = -Math.PI / 2;
          outerRing.position.set(cx, 0.32, cz);

          const neonRing = new THREE.Mesh(
            new THREE.RingGeometry(4.2, 4.6, 28),
            new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide })
          );
          neonRing.rotation.x = -Math.PI / 2;
          neonRing.position.set(cx, 0.33, cz);

          const monolith = new THREE.Mesh(
            new THREE.OctahedronGeometry(1.5, 0),
            new THREE.MeshStandardMaterial({
              color: 0x38bdf8,
              emissive: 0x0284c7,
              emissiveIntensity: 0.6,
              metalness: 0.5
            })
          );
          monolith.position.set(cx, 2.5, cz);
          monolith.castShadow = true;
          this.cityGroup.add(plazaFloor, outerRing, neonRing, monolith);
        } else {
          const lot = new THREE.Mesh(
            new THREE.BoxGeometry(Math.max(4, cellW - 3.6), 0.28, Math.max(4, cellD - 3.6)),
            innerLotMat
          );
          lot.position.set(cx, 0.14, cz);
          lot.receiveShadow = true;
          this.cityGroup.add(lot);
        }
      }
    }

    // Surface Parking Lots with painted stalls, low perimeter curbs & warm dusk floodlight poles
    const curbWallMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.85 });
    const lotPoleMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.5 });
    const lotLampMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const lotConeGeo = new THREE.ConeGeometry(4.4, 5.6, 14, 1, true);
    const lotConeMat = this.textureStudio.createVolumetricConeMaterial(0xffde99, 0.24);
    for (const lot of layout.parkingLots) {
      const lotMat = new THREE.MeshStandardMaterial({
        map: this.textureStudio.getParkingLotTexture(
          Math.max(2, Math.round(lot.width / 8)),
          Math.max(2, Math.round(lot.depth / 10))
        ),
        color: 0xffffff,
        roughness: 0.92
      });
      const pad = new THREE.Mesh(new THREE.BoxGeometry(lot.width, 0.12, lot.depth), lotMat);
      pad.position.set(lot.x, 0.20, lot.z);
      pad.receiveShadow = true;
      this.cityGroup.add(pad);

      // Low perimeter curbs
      const wallN = new THREE.Mesh(new THREE.BoxGeometry(lot.width, 0.65, 0.4), curbWallMat);
      wallN.position.set(lot.x, 0.45, lot.z - lot.depth * 0.5 + 0.2);
      const wallS = wallN.clone();
      wallS.position.z = lot.z + lot.depth * 0.5 - 0.2;
      this.cityGroup.add(wallN, wallS);

      // 2 tall warm dusk floodlight poles illuminating parked vehicles
      const poleOffsets: Array<[number, number]> = [
        [lot.x - lot.width * 0.28, lot.z - lot.depth * 0.22],
        [lot.x + lot.width * 0.28, lot.z + lot.depth * 0.22]
      ];
      for (const [lx, lz] of poleOffsets) {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.24, 5.8, 0.24), lotPoleMat);
        pole.position.set(lx, 3.1, lz);
        const lampHead = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.22, 0.55), lotLampMat);
        lampHead.position.set(lx, 5.95, lz);
        const cone = new THREE.Mesh(lotConeGeo, lotConeMat);
        cone.position.set(lx, 3.1, lz);
        cone.visible = this.atmosphereStage !== 'day';
        this.streetLampCones.push(cone);
        this.cityGroup.add(pole, lampHead, cone);
      }
    }

    // Grand KTX South Terminal Concourse Apron
    if (layout.terminalPlaza) {
      const tp = layout.terminalPlaza;
      const plaza = new THREE.Mesh(
        new THREE.BoxGeometry(tp.maxX - tp.minX, 0.18, tp.maxZ - tp.minZ),
        swTex ? new THREE.MeshStandardMaterial({ map: swTex, color: 0x94a3b8, roughness: 0.88 }) : sidewalkMat
      );
      plaza.position.set((tp.minX + tp.maxX) * 0.5, 0.08, (tp.minZ + tp.maxZ) * 0.5);
      plaza.receiveShadow = true;
      this.cityGroup.add(plaza);
    }
  }

  private buildBuildings(buildings: BuildingData[]): void {
    const roofDarkMat = new THREE.MeshStandardMaterial({ color: 0x161d29, roughness: 0.85 });
    const parapetMat = new THREE.MeshStandardMaterial({ color: 0x2a3342, roughness: 0.8 });
    const hvacMat = new THREE.MeshStandardMaterial({
      map: this.textureStudio.getHvacTexture(),
      color: 0xffffff,
      roughness: 0.7
    });
    const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x0b0f18, roughness: 0.8 });
    const awningMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65 });
    const entryLampMat = new THREE.MeshBasicMaterial({ color: 0xfde68a });

    const signLabels: NeonSignLabel[] = ['24H MART', 'CLINIC', 'MART', 'HOTEL', 'PHARMACY', 'METRO'];
    const signCasingMat = new THREE.MeshStandardMaterial({ color: 0x0b101b, roughness: 0.6 });
    const fireIronMat = new THREE.MeshStandardMaterial({
      color: 0x11151d,
      roughness: 0.72,
      metalness: 0.38
    });
    const balconyDeckGeo = new THREE.BoxGeometry(2.3, 0.12, 0.92);
    const balconyRailGeo = new THREE.BoxGeometry(2.3, 0.08, 0.08);
    const balconyPostGeo = new THREE.BoxGeometry(0.08, 0.82, 0.08);
    const ladderRailGeo = new THREE.BoxGeometry(0.07, 1.9, 0.07);

    for (let bi = 0; bi < buildings.length; bi++) {
      const b = buildings[bi];
      const bGroup = new THREE.Group();
      bGroup.position.set(b.x, 0.25, b.z);

      let style: 'brick' | 'concrete' | 'skyscraper' | 'warehouse' = 'concrete';
      if (b.roofType === 'skyscraper') style = 'skyscraper';
      else if (b.roofType === 'warehouse') style = 'warehouse';
      else if (
        b.roofType === 'pitched' ||
        b.name.includes('Brick') ||
        b.name.includes('Mart') ||
        b.name.includes('Tenement') ||
        bi % 2 === 0
      ) {
        style = 'brick';
      }

      const facadeBundle = this.textureStudio.getBuildingFacadeBundle(style, b.color, b.height);
      const sideMat = new THREE.MeshStandardMaterial({
        map: facadeBundle.map,
        emissive: 0xffffff,
        emissiveMap: facadeBundle.emissiveMap,
        emissiveIntensity: 0.78,
        roughness: 0.78,
        metalness: 0.08
      });
      const topMat = new THREE.MeshStandardMaterial({
        color: style === 'brick' ? 0x3d2e2b : bi % 2 === 0 ? 0x353f52 : 0x444e61,
        roughness: 0.86
      });

      const bodyMatArray = [sideMat, sideMat, topMat, topMat, sideMat, sideMat];
      if (!b.interior) {
        const bodyGeo = new THREE.BoxGeometry(b.width, b.height, b.depth);
        const bodyMesh = new THREE.Mesh(bodyGeo, bodyMatArray);
        bodyMesh.position.y = b.height / 2;
        bodyMesh.castShadow = true;
        bodyMesh.receiveShadow = true;
        bodyMesh.userData = { buildingId: b.id };
        bGroup.add(bodyMesh);
      } else {
        const floorH = b.interior.floorHeight;
        const upperH = Math.max(0.8, b.height - floorH);
        const upperMesh = new THREE.Mesh(
          new THREE.BoxGeometry(b.width, upperH, b.depth),
          bodyMatArray
        );
        upperMesh.position.y = floorH + upperH * 0.5;
        upperMesh.castShadow = true;
        upperMesh.receiveShadow = true;
        upperMesh.userData = { buildingId: b.id };
        bGroup.add(upperMesh);

        // 1st-floor tiled floor slab flush with sidewalk + ceiling liner
        const intFloorTex = this.textureStudio.getInteriorFloorTexture(
          b.interior.theme,
          Math.max(2, Math.round(b.width / 4)),
          Math.max(2, Math.round(b.depth / 4))
        );
        const intFloorMesh = new THREE.Mesh(
          new THREE.BoxGeometry(b.width - 0.14, 0.06, b.depth - 0.14),
          new THREE.MeshStandardMaterial({ map: intFloorTex, roughness: 0.85 })
        );
        intFloorMesh.position.y = 0.01;
        intFloorMesh.receiveShadow = true;

        const intCeilMesh = new THREE.Mesh(
          new THREE.BoxGeometry(b.width - 0.22, 0.08, b.depth - 0.22),
          new THREE.MeshStandardMaterial({ color: 0x1b222e, roughness: 0.9 })
        );
        intCeilMesh.position.y = floorH - 0.04;
        bGroup.add(intFloorMesh, intCeilMesh);

        const beamMat = new THREE.MeshStandardMaterial({ color: 0x111722, roughness: 0.85 });
        for (const bxOffset of [-b.width * 0.24, b.width * 0.24]) {
          const beam = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, b.depth - 0.3), beamMat);
          beam.position.set(bxOffset, floorH - 0.13, 0);
          bGroup.add(beam);
        }

        // Matte drywall interior surface so fake yellow exterior windows never shine inside
        const interiorWallColor =
          b.interior.theme === 'mart'
            ? 0x262f3d
            : b.interior.theme === 'clinic'
            ? 0x334155
            : b.interior.theme === 'hospital'
            ? 0x475569
            : 0x1e293b;
        const intWallMat = new THREE.MeshStandardMaterial({
          color: interiorWallColor,
          roughness: 0.92,
          metalness: 0.04
        });

        // 1st-floor perimeter wall bays (storefront glass bays on street sides, solid walls elsewhere)
        const glassPaneMat = new THREE.MeshStandardMaterial({
          color: 0x334155,
          transparent: true,
          opacity: 0.22,
          roughness: 0.2,
          metalness: 0.45,
          depthWrite: false
        });

        for (const w of b.interior.walls) {
          const ww = w.maxX - w.minX;
          const wd = w.maxZ - w.minZ;
          const lx = (w.minX + w.maxX) * 0.5 - b.x;
          const lz = (w.minZ + w.maxZ) * 0.5 - b.z;

          const wallMats: THREE.Material[] = [
            w.maxX >= b.maxX - 0.7 ? sideMat : intWallMat,
            w.minX <= b.minX + 0.7 ? sideMat : intWallMat,
            roofDarkMat,
            roofDarkMat,
            w.maxZ >= b.maxZ - 0.7 ? sideMat : intWallMat,
            w.minZ <= b.minZ + 0.7 ? sideMat : intWallMat
          ];

          const isWestGlassBay =
            b.interior.theme !== 'terminal' &&
            w.maxX <= b.minX + 0.7 &&
            wd >= 2.2;
          const isSouthHospBay =
            b.interior.theme === 'hospital' &&
            w.minZ >= b.maxZ - 0.7 &&
            ww >= 2.2;
          const isTerminalBay =
            b.interior.theme === 'terminal' &&
            (w.maxZ <= b.minZ + 0.7 || w.minZ >= b.maxZ - 0.7) &&
            ww >= 2.2;

          if (isWestGlassBay || isSouthHospBay || isTerminalBay) {
            const knee = new THREE.Mesh(new THREE.BoxGeometry(ww, 0.9, wd), wallMats);
            knee.position.set(lx, 0.45, lz);
            knee.castShadow = true;
            knee.receiveShadow = true;

            const transom = new THREE.Mesh(new THREE.BoxGeometry(ww, 0.65, wd), wallMats);
            transom.position.set(lx, floorH - 0.325, lz);
            transom.castShadow = true;

            const glassW = ww > wd ? ww : 0.1;
            const glassD = wd > ww ? wd : 0.1;
            const pane = new THREE.Mesh(new THREE.BoxGeometry(glassW, 2.45, glassD), glassPaneMat);
            pane.position.set(lx, 2.12, lz);
            bGroup.add(knee, transom, pane);
          } else {
            const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(ww, floorH, wd), wallMats);
            wallMesh.position.set(lx, floorH * 0.5, lz);
            wallMesh.castShadow = true;
            wallMesh.receiveShadow = true;
            bGroup.add(wallMesh);
          }
        }

        // Interior Props
        const propSlateMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.78 });
        const shelfRackMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 });
        const shelfStockMat = new THREE.MeshStandardMaterial({
          map: this.textureStudio.getShelfStockTexture(),
          roughness: 0.72
        });
        const coolerBodyMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.65 });
        const coolerTex = this.textureStudio.getBeverageCoolerTexture();
        const coolerGlowMat = new THREE.MeshStandardMaterial({
          map: coolerTex.map,
          emissive: 0xffffff,
          emissiveMap: coolerTex.emissiveMap,
          emissiveIntensity: 0.42,
          roughness: 0.62,
          metalness: 0.12
        });
        const linenMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.85 });
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x78553a, roughness: 0.82 });
        const ticketGlowMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });

        for (const p of b.interior.props) {
          const pw = p.maxX - p.minX;
          const pd = p.maxZ - p.minZ;
          const px = (p.minX + p.maxX) * 0.5 - b.x;
          const pz = (p.minZ + p.maxZ) * 0.5 - b.z;

          if (p.kind === 'shelf') {
            const rack = new THREE.Mesh(new THREE.BoxGeometry(pw, p.height, pd), [
              shelfRackMat,
              shelfRackMat,
              shelfRackMat,
              shelfRackMat,
              shelfStockMat,
              shelfStockMat
            ]);
            rack.position.set(px, p.height * 0.5, pz);
            rack.castShadow = true;
            bGroup.add(rack);
          } else if (p.kind === 'cooler') {
            const box = new THREE.Mesh(new THREE.BoxGeometry(pw, p.height, pd), [
              coolerBodyMat,
              coolerGlowMat,
              coolerBodyMat,
              coolerBodyMat,
              coolerBodyMat,
              coolerBodyMat
            ]);
            box.position.set(px, p.height * 0.5, pz);
            box.castShadow = true;
            bGroup.add(box);
          } else if (p.kind === 'counter') {
            const desk = new THREE.Mesh(new THREE.BoxGeometry(pw, p.height, pd), propSlateMat);
            desk.position.set(px, p.height * 0.5, pz);
            desk.castShadow = true;
            bGroup.add(desk);
            if (b.interior.theme === 'mart') {
              const reg = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.36, 0.48), coolerBodyMat);
              reg.position.set(px, p.height + 0.18, pz);
              const screen = new THREE.Mesh(
                new THREE.BoxGeometry(0.32, 0.2, 0.08),
                new THREE.MeshBasicMaterial({ color: 0x4ade80 })
              );
              screen.position.set(px, p.height + 0.42, pz);
              bGroup.add(reg, screen);
            }
          } else if (p.kind === 'bed') {
            const frameB = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.45, pd), propSlateMat);
            frameB.position.set(px, 0.225, pz);
            const mattress = new THREE.Mesh(new THREE.BoxGeometry(pw - 0.14, 0.28, pd - 0.14), linenMat);
            mattress.position.set(px, 0.58, pz);
            bGroup.add(frameB, mattress);
          } else if (p.kind === 'bench') {
            const bench = new THREE.Mesh(new THREE.BoxGeometry(pw, p.height, pd), woodMat);
            bench.position.set(px, p.height * 0.5, pz);
            bGroup.add(bench);
          } else if (p.kind === 'ticket_booth') {
            const booth = new THREE.Mesh(new THREE.BoxGeometry(pw, p.height, pd), propSlateMat);
            booth.position.set(px, p.height * 0.5, pz);
            const hdr = new THREE.Mesh(new THREE.BoxGeometry(pw * 0.85, 0.35, pd * 0.85), ticketGlowMat);
            hdr.position.set(px, p.height + 0.18, pz);
            bGroup.add(booth, hdr);
          } else if (p.kind === 'departure_board') {
            const pillar = new THREE.Mesh(new THREE.BoxGeometry(pw, p.height, pd), coolerBodyMat);
            pillar.position.set(px, p.height * 0.5, pz);
            const boardMat = new THREE.MeshBasicMaterial({ map: this.textureStudio.getKtxBoardTexture() });
            const faceN = new THREE.Mesh(new THREE.PlaneGeometry(pw - 0.3, 1.65), boardMat);
            faceN.position.set(px, 2.35, pz - pd * 0.5 - 0.02);
            faceN.rotation.y = Math.PI;
            const faceS = faceN.clone();
            faceS.position.z = pz + pd * 0.5 + 0.02;
            faceS.rotation.y = 0;
            bGroup.add(pillar, faceN, faceS);
          } else if (p.kind === 'turnstile') {
            const gates = Math.max(2, Math.round(pw / 1.15));
            for (let gi = 0; gi < gates; gi++) {
              const gx = p.minX + ((gi + 0.5) / gates) * pw - b.x;
              const unit = new THREE.Mesh(new THREE.BoxGeometry(0.28, p.height, pd), shelfRackMat);
              unit.position.set(gx, p.height * 0.5, pz);
              const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.2), ticketGlowMat);
              lamp.position.set(gx, p.height + 0.05, pz);
              bGroup.add(unit, lamp);
            }
          } else if (p.kind === 'escalator') {
            const escRamp = new THREE.Mesh(new THREE.BoxGeometry(pw, p.height * 0.68, pd), coolerBodyMat);
            escRamp.position.set(px, p.height * 0.34, pz);
            const railL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, pd), ticketGlowMat);
            railL.position.set(px - pw * 0.44, p.height * 0.68 + 0.25, pz);
            const railR = railL.clone();
            railR.position.x = px + pw * 0.44;
            bGroup.add(escRamp, railL, railR);
          } else {
            const pil = new THREE.Mesh(new THREE.BoxGeometry(pw, p.height, pd), propSlateMat);
            pil.position.set(px, p.height * 0.5, pz);
            pil.castShadow = true;
            bGroup.add(pil);
          }
        }

        if (b.interior.theme === 'mart') {
          const boxMat = new THREE.MeshStandardMaterial({
            map: this.textureStudio.getCardboardBoxTexture(),
            roughness: 0.88
          });
          for (const [bx, bz, br, bw, bh] of [
            [-4.1, -2.5, 0.24, 0.54, 0.42],
            [-3.9, 2.3, -0.32, 0.48, 0.36]
          ]) {
            const clutter = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bw), boxMat);
            clutter.position.set(bx, bh * 0.5 + 0.02, bz);
            clutter.rotation.y = br;
            clutter.castShadow = true;
            bGroup.add(clutter);
          }
          const topCrate = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.3, 0.38), boxMat);
          topCrate.position.set(-4.08, 0.59, -2.48);
          topCrate.rotation.y = -0.18;
          topCrate.castShadow = true;
          bGroup.add(topCrate);
        }

        // Overhead cool-white fluorescent ceiling fixtures + soft indoor glow cones
        const tubeConeGeo = new THREE.ConeGeometry(2.6, 3.6, 12, 1, true);
        const tubeConeMat = this.textureStudio.createVolumetricConeMaterial(0xe0f2fe, 0.14);
        for (const fx of b.interior.lightFixtures) {
          const flGroup = new THREE.Group();
          flGroup.position.set(fx.x - b.x, floorH - 0.14, fx.z - b.z);
          const housing = new THREE.Mesh(
            new THREE.BoxGeometry(0.28, 0.08, 1.85),
            coolerBodyMat
          );
          const bulbMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe });
          const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 1.7), bulbMat);
          bulb.position.y = -0.05;
          const cone = new THREE.Mesh(tubeConeGeo, tubeConeMat);
          cone.position.y = -1.85;
          flGroup.add(housing, bulb, cone);
          bGroup.add(flGroup);

          this.interiorFixtures.push({
            bulbMat,
            coneMesh: cone,
            buildingId: b.id,
            flickerSeed: fx.flickerSeed
          });
        }
      }

      // Rooftop parapet trim
      if (b.roofType !== 'pitched') {
        const para = new THREE.Mesh(
          new THREE.BoxGeometry(b.width + 0.35, 0.38, b.depth + 0.35),
          parapetMat
        );
        para.position.y = b.height + 0.19;
        bGroup.add(para);
      }
      if (b.id === 'BLD-KTX-HALL') {
        const ktxRoofMat = new THREE.MeshStandardMaterial({ color: 0x1b2333, roughness: 0.78 });
        const ktxDeck = new THREE.Mesh(
          new THREE.BoxGeometry(b.width + 0.16, 0.18, b.depth + 0.16),
          ktxRoofMat
        );
        ktxDeck.position.y = b.height + 0.34;
        const ktxTrimMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
        const trimN = new THREE.Mesh(new THREE.BoxGeometry(b.width + 0.48, 0.16, 0.22), ktxTrimMat);
        trimN.position.set(0, b.height + 0.42, -(b.depth * 0.5 + 0.14));
        const trimS = trimN.clone();
        trimS.position.z = b.depth * 0.5 + 0.14;
        const trimW = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, b.depth + 0.48), ktxTrimMat);
        trimW.position.set(-(b.width * 0.5 + 0.14), b.height + 0.42, 0);
        const trimE = trimW.clone();
        trimE.position.x = b.width * 0.5 + 0.14;
        bGroup.add(ktxDeck, trimN, trimS, trimW, trimE);
      }

      if (b.roofType === 'helipad') {
        const pad = new THREE.Mesh(
          new THREE.BoxGeometry(8.5, 0.35, 8.5),
          new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.75 })
        );
        pad.position.y = b.height + 0.35;
        const mast = new THREE.Mesh(new THREE.BoxGeometry(0.32, 5.2, 0.32), parapetMat);
        mast.position.set(b.width * 0.32, b.height + 2.8, -b.depth * 0.32);
        const beacon = new THREE.Mesh(
          new THREE.BoxGeometry(0.45, 0.45, 0.45),
          new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
        );
        beacon.position.set(b.width * 0.32, b.height + 5.6, -b.depth * 0.32);
        bGroup.add(pad, mast, beacon);
      } else if (b.roofType === 'hospital') {
        const crossMat = new THREE.MeshBasicMaterial({ color: 0xdc2626 });
        const cross1 = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.0, 1.2), crossMat);
        const cross2 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 4.2), crossMat);
        cross1.position.y = b.height + 0.6;
        cross2.position.y = b.height + 0.6;
        bGroup.add(cross1, cross2);
      } else if (b.roofType === 'skyscraper') {
        const tier1 = new THREE.Mesh(
          new THREE.BoxGeometry(b.width * 0.72, 4.2, b.depth * 0.72),
          sideMat
        );
        tier1.position.y = b.height + 2.1;
        tier1.castShadow = true;

        const neonCrown = new THREE.Mesh(
          new THREE.BoxGeometry(b.width * 0.76, 0.32, b.depth * 0.76),
          new THREE.MeshBasicMaterial({ color: b.accentColor })
        );
        neonCrown.position.y = b.height + 4.35;

        const tier2 = new THREE.Mesh(
          new THREE.BoxGeometry(b.width * 0.42, 3.0, b.depth * 0.42),
          roofDarkMat
        );
        tier2.position.y = b.height + 5.8;

        const spire = new THREE.Mesh(new THREE.BoxGeometry(0.28, 7.2, 0.28), parapetMat);
        spire.position.y = b.height + 10.4;

        const aviationBeacon = new THREE.Mesh(
          new THREE.BoxGeometry(0.42, 0.42, 0.42),
          new THREE.MeshBasicMaterial({ color: 0xef4444 })
        );
        aviationBeacon.position.y = b.height + 14.2;

        bGroup.add(tier1, neonCrown, tier2, spire, aviationBeacon);
      } else if (b.roofType === 'warehouse') {
        const mutedRoof = new THREE.Color(b.accentColor).lerp(new THREE.Color(0x28303e), 0.82);
        const trim = new THREE.Mesh(
          new THREE.BoxGeometry(b.width + 0.2, 0.4, b.depth + 0.2),
          new THREE.MeshStandardMaterial({ color: mutedRoof, roughness: 0.78 })
        );
        trim.position.y = b.height + 0.2;
        const vent1 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 2.2), hvacMat);
        vent1.position.set(-b.width * 0.22, b.height + 0.85, 0);
        const vent2 = vent1.clone();
        vent2.position.x = b.width * 0.22;
        bGroup.add(trim, vent1, vent2);
      } else if (b.roofType === 'pitched') {
        const roofGeo = new THREE.ConeGeometry(Math.max(b.width, b.depth) * 0.68, 2.6, 4);
        const mutedRoof = new THREE.Color(b.accentColor).lerp(new THREE.Color(0x252d3a), 0.75);
        const roofMat = new THREE.MeshStandardMaterial({ color: mutedRoof, roughness: 0.85 });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.rotation.y = Math.PI / 4;
        roof.position.y = b.height + 1.3;
        roof.castShadow = true;
        bGroup.add(roof);
      } else if (b.roofType === 'tower') {
        const pent = new THREE.Mesh(
          new THREE.BoxGeometry(b.width * 0.55, 2.4, b.depth * 0.55),
          roofDarkMat
        );
        pent.position.y = b.height + 1.2;
        const spire = new THREE.Mesh(new THREE.BoxGeometry(0.24, 4.4, 0.24), parapetMat);
        spire.position.y = b.height + 4.4;
        bGroup.add(pent, spire);
      } else if (b.id !== 'BLD-KTX-HALL') {
        const hvac = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 1.6), hvacMat);
        hvac.position.set(1.2, b.height + 0.75, -1.0);
        const hvac2 = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.85, 1.3), hvacMat);
        hvac2.position.set(-1.3, b.height + 0.65, 1.1);
        bGroup.add(hvac, hvac2);
      }

      // Grounded doorway vestibule + awning (replaces glowing cyan door box!)
      const relDx = b.doorX - b.x;
      const relDz = b.doorZ - b.z;
      const faceNS = Math.abs(relDz) >= Math.abs(relDx);
      const faceSign = faceNS ? (relDz >= 0 ? 1 : -1) : relDx >= 0 ? 1 : -1;

      const entryGroup = new THREE.Group();
      if (faceNS) {
        entryGroup.position.set(relDx * 0.5, 0, faceSign * (b.depth * 0.5 + 0.08));
        entryGroup.rotation.y = faceSign > 0 ? 0 : Math.PI;
      } else {
        entryGroup.position.set(faceSign * (b.width * 0.5 + 0.08), 0, relDz * 0.5);
        entryGroup.rotation.y = faceSign > 0 ? Math.PI / 2 : -Math.PI / 2;
      }

      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.35, 0.2), doorFrameMat);
      frame.position.set(0, 1.18, 0);
      const awning = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 0.75), awningMat);
      awning.position.set(0, 2.48, 0.32);
      const entryBulb = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.1, 0.16), entryLampMat);
      entryBulb.position.set(0, 2.34, 0.25);

      if (!b.interior) {
        entryGroup.add(frame, awning, entryBulb);
      }

      if (b.name === '24H Avenue Mart') {
        const stripeLightMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6 });
        const stripeDarkMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 });
        for (let si = -3; si <= 3; si++) {
          const rib = new THREE.Mesh(
            new THREE.BoxGeometry(0.76, 0.22, 1.38),
            (si + 3) % 2 === 0 ? stripeLightMat : stripeDarkMat
          );
          rib.position.set(si * 0.76, b.interior ? 3.22 : 2.66, 0.62);
          rib.rotation.x = 0.18;
          rib.castShadow = true;
          entryGroup.add(rib);
        }
      }
      bGroup.add(entryGroup);

      // Glowing pixel neon storefront signs lining commercial streets & avenues
      const shouldAddSign =
        b.id === 'BLD-HOSP' ||
        b.roofType === 'flat' ||
        b.roofType === 'skyscraper' ||
        bi % 2 === 0;
      if (shouldAddSign && b.height >= 6) {
        const nUpper = b.name.toUpperCase();
        const chosenLabel: NeonSignLabel =
          b.id === 'BLD-HOSP' || nUpper.includes('CLINIC') || nUpper.includes('MEDICAL')
            ? 'CLINIC'
            : nUpper.includes('PHARMACY')
            ? 'PHARMACY'
            : nUpper.includes('24H')
            ? '24H MART'
            : nUpper.includes('MART') || nUpper.includes('MARKET')
            ? 'MART'
            : nUpper.includes('HOTEL') || nUpper.includes('PLAZA')
            ? 'HOTEL'
            : b.district.includes('Station') ||
              nUpper.includes('STATION') ||
              nUpper.includes('PRECINCT')
            ? 'METRO'
            : b.z > 60
            ? bi % 2 === 0
              ? 'METRO'
              : '24H MART'
            : signLabels[bi % signLabels.length];

        const mountNeonSign = (
          lx: number,
          lz: number,
          rotY: number,
          label: NeonSignLabel,
          yOverride?: number
        ) => {
          const signTex = this.textureStudio.getNeonSignTexture(label);
          const signFaceMat = new THREE.MeshBasicMaterial({
            map: signTex,
            color: new THREE.Color(0xffffff).multiplyScalar(1.35),
            toneMapped: false
          });
          const sg = new THREE.Group();
          sg.position.set(lx, yOverride ?? (b.interior ? 4.45 : 3.85), lz);
          sg.rotation.y = rotY;
          const casing = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.32, 0.24), signCasingMat);
          const face = new THREE.Mesh(new THREE.PlaneGeometry(4.42, 1.18), signFaceMat);
          face.position.z = 0.13;
          sg.add(casing, face);
          bGroup.add(sg);
        };

        if (b.name === '24H Avenue Mart') {
          const revTex = this.textureStudio.getNeonSignTexture('24H MART');
          const revPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(4.1, 1.05),
            new THREE.MeshBasicMaterial({ map: revTex, transparent: true, opacity: 0.92 })
          );
          revPlane.position.set(-b.width * 0.5 + 0.65, 3.35, 0);
          revPlane.rotation.y = Math.PI / 2;
          revPlane.scale.x = -1;
          bGroup.add(revPlane);
        }

        // Mount sign on street-facing side near door
        if (faceNS) {
          mountNeonSign(0, faceSign * (b.depth * 0.5 + 0.14), faceSign > 0 ? 0 : Math.PI, chosenLabel);
        } else {
          mountNeonSign(
            faceSign * (b.width * 0.5 + 0.14),
            b.name === '24H Avenue Mart' ? 2.6 : 0,
            faceSign > 0 ? Math.PI / 2 : -Math.PI / 2,
            chosenLabel
          );
        }

        // Extra road-facing sign, perpendicular vertical neon signs & ground commercial awnings
        const vLabels: NeonSignLabel[] = ['PHARMACY', 'RAMEN', 'CAFE', '24H MART', 'SUBWAY', 'HOTEL'];
        const awningPalette = [0x0ea5e9, 0xdc2626, 0x16a34a, 0xd97706, 0x9333ea];
        if (b.name === 'Northgate Brick Clinic') {
          const clinicTex = this.textureStudio.getVerticalBannerTexture(0);
          const clinicBanner = new THREE.Mesh(
            new THREE.PlaneGeometry(1.05, 3.4),
            new THREE.MeshBasicMaterial({ map: clinicTex, side: THREE.DoubleSide })
          );
          clinicBanner.position.set(-b.width * 0.5 - 0.52, 6.2, -b.depth * 0.35);
          clinicBanner.rotation.y = -Math.PI / 2;
          bGroup.add(clinicBanner);
        } else if (b.width > 9 && bi % 2 === 0) {
          const aveSignX = b.x < 0 ? b.width * 0.5 + 0.14 : -(b.width * 0.5 + 0.14);
          const aveRot = b.x < 0 ? Math.PI / 2 : -Math.PI / 2;
          if (faceNS) {
            mountNeonSign(aveSignX, 0, aveRot, signLabels[(bi + 2) % signLabels.length]);
          }
          if (b.height >= 9.5) {
            const vLabel = vLabels[(bi + Math.round(Math.abs(b.x + b.z))) % vLabels.length];
            const vTex = this.textureStudio.getVerticalNeonSignTexture(vLabel);
            const vSign = new THREE.Mesh(
              new THREE.PlaneGeometry(1.15, 4.15),
              new THREE.MeshBasicMaterial({
                map: vTex,
                color: new THREE.Color(0xffffff).multiplyScalar(1.45),
                side: THREE.DoubleSide,
                toneMapped: false
              })
            );
            const dirOut = b.x < 0 ? 1 : -1;
            vSign.position.set(aveSignX + dirOut * 0.72, 6.4, faceSign * (b.depth * 0.32));
            vSign.rotation.y = faceNS ? 0 : Math.PI / 2;
            const bracket = new THREE.Mesh(
              new THREE.BoxGeometry(0.75, 0.14, 0.14),
              signCasingMat
            );
            bracket.position.set(aveSignX + dirOut * 0.34, 7.2, faceSign * (b.depth * 0.32));
            bGroup.add(vSign, bracket);
          }
          // Ground-floor colorful commercial storefront awnings on non-interior avenue buildings
          if (!b.interior && b.roofType !== 'warehouse') {
            const awnMat = new THREE.MeshStandardMaterial({
              color: awningPalette[bi % awningPalette.length],
              roughness: 0.7
            });
            const dirOut = b.x < 0 ? 1 : -1;
            const awnLen = Math.min(7.5, Math.max(3.6, b.depth * 0.58));
            const awn = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.24, awnLen), awnMat);
            awn.position.set(aveSignX + dirOut * 0.45, 3.05, 0);
            awn.rotation.z = dirOut * -0.22;
            awn.castShadow = true;
            bGroup.add(awn);
          }
        }
      }

      // Exterior black cast-iron fire-escape balconies & ladders on street-facing brick buildings
      if (style === 'brick' && b.height >= 8.5) {
        const fireEsc = new THREE.Group();
        const sideSign = faceNS ? (relDx >= 0 ? -1 : 1) : relDz >= 0 ? -1 : 1;
        const span = faceNS ? b.width : b.depth;
        const offsetAlongWall = Math.min(2.4, Math.max(0.8, span * 0.22)) * sideSign;

        if (faceNS) {
          fireEsc.position.set(offsetAlongWall, 0, faceSign * (b.depth * 0.5 + 0.44));
          fireEsc.rotation.y = faceSign > 0 ? 0 : Math.PI;
        } else {
          fireEsc.position.set(faceSign * (b.width * 0.5 + 0.44), 0, offsetAlongWall);
          fireEsc.rotation.y = faceSign > 0 ? Math.PI / 2 : -Math.PI / 2;
        }

        const dropRailL = new THREE.Mesh(ladderRailGeo, fireIronMat);
        dropRailL.position.set(-0.78, 4.35, 0.28);
        const dropRailR = new THREE.Mesh(ladderRailGeo, fireIronMat);
        dropRailR.position.set(-0.42, 4.35, 0.28);
        fireEsc.add(dropRailL, dropRailR);

        for (let fy = 5.4; fy <= b.height - 1.5; fy += 3.4) {
          const deck = new THREE.Mesh(balconyDeckGeo, fireIronMat);
          deck.position.set(0, fy, 0);
          deck.castShadow = true;
          const topRail = new THREE.Mesh(balconyRailGeo, fireIronMat);
          topRail.position.set(0, fy + 0.82, 0.42);
          const midRail = new THREE.Mesh(balconyRailGeo, fireIronMat);
          midRail.position.set(0, fy + 0.42, 0.42);
          fireEsc.add(deck, topRail, midRail);

          for (const px of [-1.05, 0, 1.05]) {
            const post = new THREE.Mesh(balconyPostGeo, fireIronMat);
            post.position.set(px, fy + 0.41, 0.42);
            fireEsc.add(post);
          }

          if (fy + 3.4 <= b.height - 1.2) {
            const stair = new THREE.Mesh(
              new THREE.BoxGeometry(0.14, 3.7, 0.36),
              fireIronMat
            );
            stair.position.set(0.35, fy + 1.75, 0.05);
            stair.rotation.z = 0.42;
            fireEsc.add(stair);
          }
        }
        bGroup.add(fireEsc);
      }

      this.cityGroup.add(bGroup);
    }
  }

  private buildInteriorDoors(layout: CityLayout): void {
    const doors = layout.interiorDoors ?? [];
    if (doors.length === 0) return;

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65, metalness: 0.4 });
    const steelLeafMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6, metalness: 0.45 });
    const pushBarMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.7 });
    const lockMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const exitTex = this.textureStudio.getExitSignTexture();
    const exitMat = new THREE.MeshBasicMaterial({ map: exitTex });
    const exitCaseMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });
    const doorGlassStage0 = this.textureStudio.getDoorGlassTexture(0);

    for (const door of doors) {
      const grp = new THREE.Group();
      grp.position.set(door.x, 0.25, door.z);
      grp.rotation.y = door.side === 'W' || door.side === 'E' ? Math.PI / 2 : 0;

      const doorH = 2.65;
      const halfW = door.width * 0.5;
      const postL = new THREE.Mesh(new THREE.BoxGeometry(0.14, doorH + 0.15, 0.58), frameMat);
      postL.position.set(-halfW, (doorH + 0.15) * 0.5, 0);
      const postR = new THREE.Mesh(new THREE.BoxGeometry(0.14, doorH + 0.15, 0.58), frameMat);
      postR.position.set(halfW, (doorH + 0.15) * 0.5, 0);
      const transomFill = new THREE.Mesh(
        new THREE.BoxGeometry(door.width + 0.18, 4.0 - doorH, 0.54),
        frameMat
      );
      transomFill.position.set(0, doorH + (4.0 - doorH) * 0.5, 0);
      grp.add(postL, postR, transomFill);

      // Glowing green EXIT sign above steel exit doors & terminal platform gates
      if (!door.isGlass || door.buildingId === 'BLD-KTX-HALL') {
        for (const sz of [-0.31, 0.31]) {
          const exCase = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.42, 0.08), exitCaseMat);
          exCase.position.set(0, doorH + 0.42, sz);
          const exFace = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.36), exitMat);
          exFace.position.set(0, doorH + 0.42, sz + (sz > 0 ? 0.045 : -0.045));
          if (sz < 0) exFace.rotation.y = Math.PI;
          grp.add(exCase, exFace);
        }
      }

      const leafW = halfW - 0.06;
      const pivotLeft = new THREE.Group();
      pivotLeft.position.set(-halfW + 0.06, 0, 0);
      const pivotRight = new THREE.Group();
      pivotRight.position.set(halfW - 0.06, 0, 0);

      let glassMat: THREE.MeshBasicMaterial | undefined;
      if (door.isGlass) {
        glassMat = new THREE.MeshBasicMaterial({
          map: doorGlassStage0,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        const leftPane = new THREE.Mesh(new THREE.PlaneGeometry(leafW, doorH - 0.08), glassMat);
        leftPane.position.set(leafW * 0.5, doorH * 0.5, 0);
        const leftBar = new THREE.Mesh(new THREE.BoxGeometry(leafW, 0.1, 0.1), frameMat);
        leftBar.position.set(leafW * 0.5, 1.05, 0);
        pivotLeft.add(leftPane, leftBar);

        const rightPane = new THREE.Mesh(new THREE.PlaneGeometry(leafW, doorH - 0.08), glassMat);
        rightPane.position.set(-leafW * 0.5, doorH * 0.5, 0);
        const rightBar = new THREE.Mesh(new THREE.BoxGeometry(leafW, 0.1, 0.1), frameMat);
        rightBar.position.set(-leafW * 0.5, 1.05, 0);
        pivotRight.add(rightPane, rightBar);
      } else {
        const leftLeaf = new THREE.Mesh(
          new THREE.BoxGeometry(leafW, doorH - 0.06, 0.1),
          steelLeafMat
        );
        leftLeaf.position.set(leafW * 0.5, doorH * 0.5, 0);
        const barL = new THREE.Mesh(new THREE.BoxGeometry(leafW * 0.72, 0.12, 0.14), pushBarMat);
        barL.position.set(leafW * 0.5, 1.05, 0);
        pivotLeft.add(leftLeaf, barL);

        const rightLeaf = new THREE.Mesh(
          new THREE.BoxGeometry(leafW, doorH - 0.06, 0.1),
          steelLeafMat
        );
        rightLeaf.position.set(-leafW * 0.5, doorH * 0.5, 0);
        const barR = new THREE.Mesh(new THREE.BoxGeometry(leafW * 0.72, 0.12, 0.14), pushBarMat);
        barR.position.set(-leafW * 0.5, 1.05, 0);
        pivotRight.add(rightLeaf, barR);
      }

      // Default unlocked open swing angle (78 deg)
      pivotLeft.rotation.y = -1.32;
      pivotRight.rotation.y = 1.32;

      const lockBadge = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.18), lockMat);
      lockBadge.position.set(0, 1.08, 0);
      lockBadge.visible = false;

      grp.add(pivotLeft, pivotRight, lockBadge);
      this.cityGroup.add(grp);

      this.interiorDoorVisuals.set(door.id, {
        group: grp,
        pivotLeft,
        pivotRight,
        lockBadge,
        glassMat,
        frameMat,
        baseX: door.x,
        baseZ: door.z,
        isGlass: door.isGlass,
        lastDamageStage: 0
      });
    }
  }

  private buildTreesAndFurniture(layout: CityLayout): void {
    // 1. Blocky Minecraft-style Voxel Trees
    const trunkGeo = new THREE.BoxGeometry(0.46, 1.75, 0.46);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.92 });
    const foliageColors = [0x1f4e37, 0x286144, 0x1a432f];
    const crownBaseGeo = new THREE.BoxGeometry(2.1, 1.35, 2.1);
    const crownTopGeo = new THREE.BoxGeometry(1.35, 1.0, 1.35);

    for (const t of layout.trees) {
      const treeGroup = new THREE.Group();
      treeGroup.position.set(t.x, 0.25, t.z);
      treeGroup.scale.setScalar(t.scale);

      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.85;
      trunk.castShadow = true;

      const fMat = new THREE.MeshStandardMaterial({
        color: foliageColors[t.variant % foliageColors.length],
        roughness: 0.88
      });
      const canopy1 = new THREE.Mesh(crownBaseGeo, fMat);
      canopy1.position.y = 2.2;
      canopy1.castShadow = true;
      const canopy2 = new THREE.Mesh(crownTopGeo, fMat);
      canopy2.position.set(0.08, 3.25, -0.06);
      canopy2.castShadow = true;

      treeGroup.add(trunk, canopy1, canopy2);
      this.cityGroup.add(treeGroup);
    }

    // 2. L-Shaped Voxel Streetlamps with Warm Hazy Light Cones
    const poleGeo = new THREE.BoxGeometry(0.18, 4.4, 0.18);
    const armGeo = new THREE.BoxGeometry(1.15, 0.16, 0.18);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2d3748, metalness: 0.5, roughness: 0.6 });
    const bulbGeo = new THREE.BoxGeometry(0.46, 0.16, 0.28);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const lampConeGeo = new THREE.ConeGeometry(3.4, 4.4, 16, 1, true);
    const lampConeMat = this.textureStudio.createVolumetricConeMaterial(0xffde99, 0.22);
    const showCones = this.atmosphereStage !== 'day';

    for (let li = 0; li < layout.lamps.length; li++) {
      const l = layout.lamps[li];
      const lampGroup = new THREE.Group();
      lampGroup.position.set(l.x, 0.25, l.z);

      // Orient overhang slightly toward nearest road centerline
      const roadXs = layout.roadXs.length > 0 ? layout.roadXs : layout.roadCoords;
      let nearestRx = roadXs[0] ?? 0;
      for (const rc of roadXs) {
        if (Math.abs(l.x - rc) < Math.abs(l.x - nearestRx)) nearestRx = rc;
      }
      const dirX = nearestRx >= l.x ? 1 : -1;

      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 2.2;
      const arm = new THREE.Mesh(armGeo, poleMat);
      arm.position.set(dirX * 0.55, 4.35, 0);
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(dirX * 0.95, 4.24, 0);

      lampGroup.add(pole, arm, bulb);

      // Add atmospheric downward light cone on alternating lamps for clean FPS & zero washout
      if (li % 2 === 0) {
        const cone = new THREE.Mesh(lampConeGeo, lampConeMat);
        cone.position.set(dirX * 0.95, 2.05, 0);
        cone.visible = showCones;
        this.streetLampCones.push(cone);
        lampGroup.add(cone);
      }

      this.cityGroup.add(lampGroup);
    }

    // 3. Curbside Dumpsters & Orange Traffic Cones for lived-in apocalypse detail
    const dumpMat = new THREE.MeshStandardMaterial({ color: 0x1e4631, roughness: 0.85 });
    const dumpLidMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 });
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.6 });
    const coneWhiteMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });

    for (let bi = 0; bi < layout.buildings.length; bi++) {
      const b = layout.buildings[bi];
      if (bi % 3 === 0) {
        const dump = new THREE.Group();
        dump.position.set(b.x + (bi % 2 === 0 ? -1 : 1) * (b.width * 0.5 + 0.8), 0.25, b.z);
        const bin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 1.7), dumpMat);
        bin.position.y = 0.5;
        bin.castShadow = true;
        const lid = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.14, 1.75), dumpLidMat);
        lid.position.y = 1.04;
        lid.rotation.z = 0.14;
        dump.add(bin, lid);
        this.cityGroup.add(dump);
      }
      if (bi % 4 === 1) {
        const cone = new THREE.Group();
        cone.position.set(b.doorX, 0.25, b.doorZ + (b.doorZ > b.z ? 1.4 : -1.4));
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.42), coneMat);
        base.position.y = 0.04;
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.44, 0.24), coneMat);
        body.position.y = 0.28;
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.11, 0.26), coneWhiteMat);
        band.position.y = 0.34;
        cone.add(base, body, band);
        this.cityGroup.add(cone);
      }
    }

    if (layout.mapId === 'citadel_express') {
      for (const dz of [-148.5, -146.2]) {
        const dump = new THREE.Group();
        dump.position.set(-43.0, 0.25, dz);
        const bin = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.05, 1.75), dumpMat);
        bin.position.y = 0.52;
        bin.castShadow = true;
        const lid = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.14, 1.8), dumpLidMat);
        lid.position.y = 1.08;
        lid.rotation.z = dz < -147 ? 0.16 : -0.1;
        dump.add(bin, lid);
        this.cityGroup.add(dump);
      }

      // Cantilevered Traffic Signal Gantries at primary city intersections
      const redSigMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xef4444).multiplyScalar(1.8),
        toneMapped: false
      });
      const amberSigMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xf59e0b).multiplyScalar(1.8),
        toneMapped: false
      });
      const greenSigMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x22c55e).multiplyScalar(1.8),
        toneMapped: false
      });
      const boxSigMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.7 });
      for (const rx of [-52, -16, 26, 68]) {
        for (const rz of [-80, -42, -8, 88, 128]) {
          const g = new THREE.Group();
          g.position.set(rx - 4.8, 0.25, rz + 4.8);
          const mast = new THREE.Mesh(new THREE.BoxGeometry(0.24, 5.5, 0.24), poleMat);
          mast.position.y = 2.75;
          const arm = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.18, 0.2), poleMat);
          arm.position.set(2.1, 5.4, 0);
          const head = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.36, 0.26), boxSigMat);
          head.position.set(3.2, 5.2, 0);
          const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.3), redSigMat);
          l1.position.set(2.9, 5.2, 0);
          const l2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.3), amberSigMat);
          l2.position.set(3.2, 5.2, 0);
          const l3 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.3), greenSigMat);
          l3.position.set(3.5, 5.2, 0);
          g.add(mast, arm, head, l1, l2, l3);
          this.cityGroup.add(g);
        }
      }

      // Lit Curbside Bus Stop Shelters along West Boulevard & Midtown Avenue
      const shelterGlassMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.28,
        roughness: 0.25
      });
      const shelterSignMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      const busStops: Array<[number, number, number]> = [
        [-47.2, -155.0, -Math.PI / 2],
        [-47.2, -62.0, -Math.PI / 2],
        [-56.8, -28.0, Math.PI / 2],
        [30.8, -48.0, -Math.PI / 2],
        [-47.2, 68.0, -Math.PI / 2],
        [21.2, 102.0, Math.PI / 2]
      ];
      for (const [bx, bz, rot] of busStops) {
        const bs = new THREE.Group();
        bs.position.set(bx, 0.25, bz);
        bs.rotation.y = rot;
        const back = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.4, 0.12), shelterGlassMat);
        back.position.set(0, 1.2, -0.65);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.14, 1.55), poleMat);
        roof.position.set(0, 2.48, 0);
        roof.castShadow = true;
        const glowPanel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.1, 1.1), shelterSignMat);
        glowPanel.position.set(1.88, 1.25, 0);
        const bench = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.42, 0.55), dumpMat);
        bench.position.set(-0.2, 0.45, -0.15);
        bs.add(back, roof, glowPanel, bench);
        this.cityGroup.add(bs);
      }
    }
  }

  private buildStaticObstacles(layout: CityLayout): void {
    const obstacles: StaticObstacleData[] = layout.staticObstacles ?? [];
    if (obstacles.length === 0) return;

    const paintTex = this.textureStudio.getVehiclePaintTexture();
    const concreteMat = new THREE.MeshStandardMaterial({
      map: this.textureStudio.getConcreteWallTexture(1),
      color: 0xd4d4d8,
      roughness: 0.9
    });
    const barrierStripeMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const containerTex = this.textureStudio.getShippingContainerTexture();

    const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.92 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.55 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.25,
      metalness: 0.55
    });
    const burntGlassMat = new THREE.MeshBasicMaterial({ color: 0x7c2d12 });
    const taxiSignMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const hazardMat = new THREE.MeshBasicMaterial({ color: 0xf97316 });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xdc2626 });
    const headLightMat = new THREE.MeshBasicMaterial({ color: 0xfffbeb });
    const headConeGeo = new THREE.ConeGeometry(1.65, 9.5, 12, 1, true);
    headConeGeo.translate(0, -4.75, 0);
    headConeGeo.rotateX(-Math.PI / 2);
    const headConeMat = this.textureStudio.createVolumetricConeMaterial(0xfff1bf, 0.22);

    const tireGeo = new THREE.BoxGeometry(0.3, 0.54, 0.54);
    const hubGeo = new THREE.BoxGeometry(0.33, 0.22, 0.22);

    const addVehicleWheels = (grp: THREE.Group, halfTrack: number, zPositions: number[]) => {
      for (const wz of zPositions) {
        for (const side of [-1, 1]) {
          const tire = new THREE.Mesh(tireGeo, tireMat);
          tire.position.set(side * halfTrack, 0.27, wz);
          const hub = new THREE.Mesh(hubGeo, hubMat);
          hub.position.set(side * halfTrack, 0.27, wz);
          grp.add(tire, hub);
        }
      }
    };

    for (const obs of obstacles) {
      let baseY = 0.02;
      for (const lot of layout.parkingLots) {
        if (
          Math.abs(obs.x - lot.x) <= lot.width * 0.5 &&
          Math.abs(obs.z - lot.z) <= lot.depth * 0.5
        ) {
          baseY = 0.26;
          break;
        }
      }

      const grp = new THREE.Group();
      grp.position.set(obs.x, baseY, obs.z);
      grp.rotation.y = obs.rotationY;

      if (obs.kind === 'jersey_barrier') {
        const foot = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width, 0.34, obs.depth),
          concreteMat
        );
        foot.position.y = 0.17;
        foot.castShadow = true;
        foot.receiveShadow = true;

        const stemW = obs.width >= obs.depth ? obs.width * 0.94 : obs.width * 0.58;
        const stemD = obs.depth > obs.width ? obs.depth * 0.94 : obs.depth * 0.58;
        const stem = new THREE.Mesh(
          new THREE.BoxGeometry(stemW, Math.max(0.45, obs.height - 0.34), stemD),
          concreteMat
        );
        stem.position.y = 0.34 + Math.max(0.45, obs.height - 0.34) * 0.5;
        stem.castShadow = true;

        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(stemW * 1.01, 0.14, stemD * 1.01),
          barrierStripeMat
        );
        stripe.position.y = obs.height - 0.16;
        grp.add(foot, stem, stripe);
      } else if (obs.kind === 'bus') {
        const busBodyMat = new THREE.MeshStandardMaterial({
          map: paintTex,
          color: obs.color,
          roughness: 0.58,
          metalness: 0.22
        });
        const busStripeMat = new THREE.MeshBasicMaterial({ color: 0x2563eb });
        const lower = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.96, obs.height * 0.56, obs.depth * 0.98),
          busBodyMat
        );
        lower.position.y = 0.36 + obs.height * 0.28;
        lower.castShadow = true;
        lower.receiveShadow = true;
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.99, 0.26, obs.depth * 0.98),
          busStripeMat
        );
        stripe.position.y = 0.36 + obs.height * 0.48;
        const winDeck = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.92, obs.height * 0.34, obs.depth * 0.94),
          glassMat
        );
        winDeck.position.y = 0.36 + obs.height * 0.72;
        const roofCap = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.96, 0.24, obs.depth * 0.98),
          busBodyMat
        );
        roofCap.position.y = 0.36 + obs.height * 0.92;
        const headSign = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.64, 0.24, 0.14),
          hazardMat
        );
        headSign.position.set(0, 0.36 + obs.height * 0.86, obs.depth * 0.48);
        addVehicleWheels(grp, obs.width * 0.46, [-obs.depth * 0.34, obs.depth * 0.33]);
        grp.add(lower, stripe, winDeck, roofCap, headSign);
      } else if (obs.kind === 'parkour_fence') {
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.65, metalness: 0.45 });
        const wireMat = new THREE.MeshStandardMaterial({
          color: 0x475569,
          transparent: true,
          opacity: 0.52,
          roughness: 0.7
        });
        const railMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
        const spanW = Math.max(obs.width, obs.depth);
        const rotateQuarter = obs.depth > obs.width;
        const fenceGroup = new THREE.Group();
        if (rotateQuarter) fenceGroup.rotation.y = Math.PI * 0.5;

        for (const px of [-spanW * 0.48, 0, spanW * 0.48]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, obs.height, 0.12), frameMat);
          post.position.set(px, obs.height * 0.5, 0);
          post.castShadow = true;
          fenceGroup.add(post);
        }
        const meshPanel = new THREE.Mesh(
          new THREE.BoxGeometry(spanW * 0.96, obs.height - 0.22, 0.08),
          wireMat
        );
        meshPanel.position.set(0, obs.height * 0.5, 0);
        const topRail = new THREE.Mesh(
          new THREE.BoxGeometry(spanW, 0.11, 0.16),
          railMat
        );
        topRail.position.set(0, obs.height + 0.02, 0);
        fenceGroup.add(meshPanel, topRail);
        grp.add(fenceGroup);
      } else if (obs.kind === 'dumpster') {
        const binMat = new THREE.MeshStandardMaterial({ color: obs.color, roughness: 0.78, metalness: 0.25 });
        const lidMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85 });
        const bumpMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
        const bin = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width, obs.height - 0.14, obs.depth),
          binMat
        );
        bin.position.y = (obs.height - 0.14) * 0.5;
        bin.castShadow = true;
        bin.receiveShadow = true;
        const lid = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width + 0.08, 0.16, obs.depth + 0.08),
          lidMat
        );
        lid.position.y = obs.height - 0.04;
        lid.rotation.x = 0.06;
        const stripeF = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.85, 0.1, obs.depth + 0.04),
          bumpMat
        );
        stripeF.position.y = obs.height * 0.55;
        grp.add(bin, lid, stripeF);
      } else if (obs.kind === 'container') {
        const isStacked = obs.height >= 4.2;
        const tiers = isStacked ? 2 : 1;
        const unitH = obs.height / tiers;
        for (let t = 0; t < tiers; t++) {
          const tint = t === 0 ? obs.color : obs.color === 0x164e63 ? 0x7c2d12 : 0x1e3a5f;
          const contMat = new THREE.MeshStandardMaterial({
            map: containerTex,
            color: tint,
            roughness: 0.76,
            metalness: 0.22
          });
          const box = new THREE.Mesh(
            new THREE.BoxGeometry(obs.width, unitH - 0.04, obs.depth),
            contMat
          );
          box.position.y = unitH * (t + 0.5);
          if (t === 1) box.rotation.y = 0.025;
          box.castShadow = true;
          box.receiveShadow = true;
          grp.add(box);
        }
      } else if (obs.kind === 'truck_burning') {
        const cargoLen = obs.depth * 0.64;
        const cabLen = obs.depth * 0.24;
        const cargoH = Math.max(2.05, obs.height - 0.55);

        const chassis = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.9, 0.38, obs.depth * 0.94),
          tireMat
        );
        chassis.position.y = 0.50;

        const trailerMat = new THREE.MeshStandardMaterial({
          map: paintTex,
          color: obs.color,
          roughness: 0.78,
          metalness: 0.14
        });
        const trailer = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.96, cargoH, cargoLen),
          trailerMat
        );
        trailer.position.set(0, 0.72 + cargoH * 0.5, -obs.depth * 0.16);
        trailer.castShadow = true;
        trailer.receiveShadow = true;

        // Soot-scorched roof patch & rib framing over front cargo edge
        const sootMat = new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.92 });
        const roofSoot = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.88, 0.12, cargoLen * 0.45),
          sootMat
        );
        roofSoot.position.set(0, 0.72 + cargoH + 0.04, -obs.depth * 0.02);

        const cabMat = new THREE.MeshStandardMaterial({
          map: paintTex,
          color: 0x292524,
          roughness: 0.84
        });
        const cabH = cargoH * 0.66;
        const cab = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.86, cabH, cabLen),
          cabMat
        );
        cab.position.set(0, 0.72 + cabH * 0.5, obs.depth * 0.30);
        cab.castShadow = true;

        // Stepped forward engine hood & heavy steel bumper
        const hood = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.82, cabH * 0.52, obs.depth * 0.12),
          cabMat
        );
        hood.position.set(0, 0.72 + cabH * 0.26, obs.depth * 0.45);
        hood.castShadow = true;

        const bumper = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.92, 0.26, 0.2),
          hubMat
        );
        bumper.position.set(0, 0.54, obs.depth * 0.51);

        const win = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.76, cabH * 0.36, 0.16),
          burntGlassMat
        );
        win.position.set(0, 0.72 + cabH * 0.66, obs.depth * 0.415);

        const grillGlow = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.62, 0.34, 0.12),
          hazardMat
        );
        grillGlow.position.set(0, 0.86, obs.depth * 0.50);

        addVehicleWheels(grp, obs.width * 0.46, [
          -obs.depth * 0.36,
          -obs.depth * 0.08,
          obs.depth * 0.36
        ]);
        grp.add(chassis, trailer, roofSoot, cab, hood, bumper, win, grillGlow);
      } else {
        const isVan = obs.kind === 'van';
        const isTaxi = obs.kind === 'taxi';
        const bodyMat = new THREE.MeshStandardMaterial({
          map: paintTex,
          color: obs.color,
          roughness: 0.6,
          metalness: 0.25
        });

        const lowerH = isVan ? obs.height * 0.62 : obs.height * 0.5;
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.94, lowerH, obs.depth * 0.96),
          bodyMat
        );
        body.position.y = 0.34 + lowerH * 0.5;
        body.castShadow = true;
        body.receiveShadow = true;

        const cabD = isVan ? obs.depth * 0.74 : obs.depth * 0.54;
        const cabH = isVan ? obs.height * 0.32 : obs.height * 0.38;
        const cab = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.84, cabH, cabD),
          bodyMat
        );
        cab.position.set(0, 0.34 + lowerH + cabH * 0.44, isVan ? -0.1 : -0.18);
        cab.castShadow = true;

        const win = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.78, cabH * 0.78, cabD * 1.03),
          glassMat
        );
        win.position.copy(cab.position);

        addVehicleWheels(grp, obs.width * 0.44, [-obs.depth * 0.32, obs.depth * 0.31]);
        grp.add(body, cab, win);

        if (isTaxi) {
          const sign = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.22, 0.28), taxiSignMat);
          sign.position.set(0, 0.34 + lowerH + cabH + 0.04, -0.1);
          grp.add(sign);
        }

        const hz = obs.depth * 0.48;
        const onRoadWithLights =
          baseY < 0.1 && (isTaxi || obs.id % 4 === 1) && !obs.isBurning;
        for (const side of [-1, 1]) {
          const tail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.08), tailMat);
          tail.position.set(side * (obs.width * 0.33), 0.34 + lowerH * 0.62, -hz);
          const front = new THREE.Mesh(
            new THREE.BoxGeometry(0.28, 0.15, 0.08),
            onRoadWithLights ? headLightMat : hazardMat
          );
          front.position.set(side * (obs.width * 0.33), 0.34 + lowerH * 0.56, hz);
          grp.add(tail, front);

          if (onRoadWithLights) {
            const cone = new THREE.Mesh(headConeGeo, headConeMat);
            cone.position.set(side * (obs.width * 0.33), 0.58, hz + 0.05);
            cone.visible = this.atmosphereStage !== 'day';
            this.streetLampCones.push(cone);
            grp.add(cone);
          }
        }

        // Hidden alarm strobe overlay activated when fallen zombie/horde triggers car alarm
        const alarmGrp = new THREE.Group();
        const strobeMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
        for (const side of [-1, 1]) {
          const flF = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.14), strobeMat);
          flF.position.set(side * (obs.width * 0.34), 0.34 + lowerH * 0.58, hz + 0.04);
          const flB = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.14), strobeMat);
          flB.position.set(side * (obs.width * 0.34), 0.34 + lowerH * 0.62, -hz - 0.04);
          alarmGrp.add(flF, flB);
        }
        const roofHalo = new THREE.Mesh(
          new THREE.BoxGeometry(obs.width * 0.48, 0.12, 0.24),
          strobeMat
        );
        roofHalo.position.set(0, 0.34 + lowerH + cabH + 0.12, -0.1);
        alarmGrp.add(roofHalo);
        alarmGrp.visible = false;
        // Attach whole alarmGrp as beacon parent target
        alarmGrp.name = `alarm-${obs.id}`;
        this.alarmBeaconMeshes.set(obs.id, alarmGrp);
        grp.add(alarmGrp);
      }

      this.cityGroup.add(grp);
    }
  }

  public syncDefenseAndTrain(
    walls: DefenseWallData[],
    gates: BlastGateData[],
    train: ExpressTrainData,
    time: number,
    layeredTerminal = false,
    stationGates?: KtxGates
  ): void {
    // 1. Animate Blast Gates (sliding doors, checkpoint boom barrier arms & beacons)
    for (let i = 0; i < gates.length; i++) {
      const g = gates[i];
      const wall = walls.find((w) => w.id === g.wallId);
      if (!wall) continue;
      const key = `${wall.layerIndex}:${Math.round(g.x)}`;
      const vis = this.gateVisuals.get(key);
      if (!vis) continue;

      if (g.breached) {
        vis.leftDoor.position.x = -g.width * 0.58;
        vis.leftDoor.rotation.z = 0.28;
        vis.rightDoor.position.x = g.width * 0.58;
        vis.rightDoor.rotation.z = -0.32;
        vis.boomArmPivot.rotation.z = -0.22;
        vis.beaconMat.color.setHex(0xef4444);
      } else {
        const doorOffset = g.width * (0.25 + g.openFraction * 0.25);
        vis.leftDoor.position.x = -doorOffset;
        vis.rightDoor.position.x = doorOffset;
        vis.leftDoor.rotation.z = 0;
        vis.rightDoor.rotation.z = 0;
        vis.boomArmPivot.rotation.z = g.openFraction * 1.18;
        vis.beaconMat.color.setHex(g.openFraction === 1 ? 0x22c55e : 0xf59e0b);
      }
    }

    // 2. Sync Walkable KTX Express Train + Dynamic Inter-Car Sliding Glass Bulkhead Doors
    if (this.expressTrainGroup) {
      this.expressTrainGroup.visible = train.active && train.state !== 'COOLDOWN';
      this.expressTrainGroup.position.set(train.x, layeredTerminal ? KTX_PLATFORM_Y - 0.23 : 0.25, train.z);
    }
    for (const [id, mesh] of this.ktxShutters) {
      const gate = stationGates?.[id];
      mesh.visible = !!gate && !gate.open && gate.integrity > 0;
    }
    if (this.trainConsoleLightMat) {
      const pulse = Math.sin(time * 7) > 0;
      this.trainConsoleLightMat.color.setHex(
        train.state === 'DOCKED' ? (pulse ? 0x4ade80 : 0x16a34a) : 0x38bdf8
      );
    }
    for (let i = 0; i < this.trainEmergencyLightMats.length; i++) {
      const hot = Math.sin(time * 9.5 + i * 1.4) > -0.15;
      if (hot) {
        this.trainEmergencyLightMats[i].color.setRGB(2.0, 0.2, 0.25);
      } else {
        this.trainEmergencyLightMats[i].color.setHex(0x7f1d1d);
      }
      this.trainEmergencyLightMats[i].toneMapped = false;
    }
    if (train.doors) {
      for (let i = 0; i < train.doors.length; i++) {
        const td = train.doors[i];
        const vis = this.trainDoorVisuals.get(td.id);
        if (!vis) continue;
        if (td.isBroken) {
          vis.slidingLeaf.visible = false;
          vis.lockBadge.visible = false;
          vis.doorGroup.position.set(vis.baseX, 0.23, 0);
        } else {
          vis.slidingLeaf.visible = true;
          const targetZ = td.isLocked ? 0 : 1.18;
          vis.slidingLeaf.position.z += (targetZ - vis.slidingLeaf.position.z) * 0.28;
          vis.lockBadge.visible = td.isLocked;
          if (td.isLocked && time - td.lastHitTime < 0.28) {
            vis.doorGroup.position.set(
              vis.baseX + Math.sin(time * 54) * 0.04,
              0.23,
              Math.cos(time * 49) * 0.04
            );
          } else {
            vis.doorGroup.position.set(vis.baseX, 0.23, 0);
          }
          const pct = td.integrity / td.maxIntegrity;
          const stage: 0 | 1 | 2 = pct > 0.66 ? 0 : pct > 0.33 ? 1 : 2;
          if (stage !== vis.lastDamageStage) {
            vis.lastDamageStage = stage;
            vis.glassMat.map = this.textureStudio.getDoorGlassTexture(stage);
            vis.glassMat.needsUpdate = true;
          }
        }
      }
    }
    if (this.stationBeaconMat) {
      if (train.state === 'DOCKED') {
        const blink = Math.sin(time * 8) > 0;
        this.stationBeaconMat.color.setHex(blink ? 0x22d3ee : 0x67e8f9);
      } else if (train.state === 'APPROACHING') {
        this.stationBeaconMat.color.setHex(0xfacc15);
      } else {
        this.stationBeaconMat.color.setHex(0x38bdf8);
      }
    }
  }

  private stampBloodStain(wx: number, wz: number): void {
    let onRoad = false;
    if (this.currentLayout) {
      const roadXs =
        this.currentLayout.roadXs.length > 0
          ? this.currentLayout.roadXs
          : this.currentLayout.roadCoords;
      const roadZs =
        this.currentLayout.roadZs.length > 0
          ? this.currentLayout.roadZs
          : this.currentLayout.roadCoords;
      onRoad =
        roadXs.some((rx) => Math.abs(wx - rx) < ROAD_WIDTH * 0.54) ||
        roadZs.some((rz) => Math.abs(wz - rz) < ROAD_WIDTH * 0.54);
    }
    const y = onRoad ? 0.032 : 0.255;

    for (let s = 0; s < 2; s++) {
      const slot = this.bloodStainCursor % this.maxBloodStains;
      this.bloodStainCursor++;
      this.bloodStainCount = Math.min(this.maxBloodStains, Math.max(this.bloodStainCount, slot + 1));

      const ox = (Math.sin(this.bloodStainCursor * 3.1 + s) * 0.45);
      const oz = (Math.cos(this.bloodStainCursor * 2.7 + s) * 0.45);
      const scale = 0.44 + ((this.bloodStainCursor * 17) % 8) * 0.05;
      this.tmpEuler.set(0, (this.bloodStainCursor * 1.3) % (Math.PI * 2), 0);
      this.tmpQuat.setFromEuler(this.tmpEuler);
      this.tmpVecA.set(wx + ox, y, wz + oz);
      this.tmpScale.set(scale, 1, scale * 0.85);
      this.tmpMatrix.compose(this.tmpVecA, this.tmpQuat, this.tmpScale);
      this.bloodStainInst.setMatrixAt(slot, this.tmpMatrix);
    }
    this.bloodStainInst.count = this.bloodStainCount;
    this.bloodStainInst.instanceMatrix.needsUpdate = true;
  }

  public syncTacticalAndEffects(
    buildings: BuildingData[],
    roadblocks: RoadblockData[],
    gates: BlastGateData[],
    evacZones: EvacZoneData[],
    holdZones: HoldZoneData[],
    lureFlares: LureFlareData[],
    vehicles: VehicleData[],
    prioritySector: PrioritySectorData | null,
    effects: VisualEffectEvent[],
    time: number,
    isFirstPerson = false,
    fpCamX = 0,
    fpCamZ = 0,
    interiorDoors: InteriorDoorData[] = [],
    brokenWindows: BrokenWindowData[] = [],
    activeAlarmIds: Set<number> = new Set(),
    insideBuildingId: string | null = null,
    gridFlickerTimer = 0,
    blackoutMaxZ = -999,
    supplyPickups: SupplyPickupData[] = [],
    insideTrainCar = 0,
    ammoCaches: AmmoCacheData[] = [],
    fpCamY = 1.68,
    stationGates?: KtxGates
  ): void {
    // 0a. Walkable Interior Doors (open swing, locked padlock/rattle, cracked glass stages, broken leaves)
    for (let di = 0; di < interiorDoors.length; di++) {
      const door = interiorDoors[di];
      const vis = this.interiorDoorVisuals.get(door.id);
      if (!vis) continue;

      if (door.isBroken) {
        vis.pivotLeft.visible = false;
        vis.pivotRight.visible = false;
        vis.lockBadge.visible = false;
        vis.group.position.set(vis.baseX, 0.25, vis.baseZ);
      } else if (door.isLocked) {
        vis.pivotLeft.visible = true;
        vis.pivotRight.visible = true;
        vis.pivotLeft.rotation.y = 0;
        vis.pivotRight.rotation.y = 0;
        vis.lockBadge.visible = true;

        if (time - door.lastHitTime < 0.28) {
          vis.group.position.set(
            vis.baseX + Math.sin(time * 52) * 0.04,
            0.25,
            vis.baseZ + Math.cos(time * 47) * 0.04
          );
        } else {
          vis.group.position.set(vis.baseX, 0.25, vis.baseZ);
        }

        if (vis.isGlass && vis.glassMat) {
          const pct = door.integrity / door.maxIntegrity;
          const stage: 0 | 1 | 2 = pct > 0.66 ? 0 : pct > 0.33 ? 1 : 2;
          if (stage !== vis.lastDamageStage) {
            vis.lastDamageStage = stage;
            vis.glassMat.map = this.textureStudio.getDoorGlassTexture(stage);
            vis.glassMat.needsUpdate = true;
          }
        }
      } else {
        vis.pivotLeft.visible = true;
        vis.pivotRight.visible = true;
        vis.pivotLeft.rotation.y = -1.32;
        vis.pivotRight.rotation.y = 1.32;
        vis.lockBadge.visible = false;
        vis.group.position.set(vis.baseX, 0.25, vis.baseZ);
      }
    }

    // 0b. Horror Fluorescent Fixture Flicker + Zero-Shadow Interior Fill PointLight
    let anyActiveDip = false;
    for (let fi = 0; fi < this.interiorFixtures.length; fi++) {
      const fx = this.interiorFixtures[fi];
      const dip =
        Math.sin(time * 9.5 + fx.flickerSeed * 7.0) *
          Math.sin(time * 23.0 + fx.flickerSeed * 3.0) >
        0.72;
      if (dip) {
        fx.bulbMat.color.setHex(0x475569);
        fx.coneMesh.visible = false;
        if (insideBuildingId === fx.buildingId) anyActiveDip = true;
      } else {
        fx.bulbMat.color.setHex(0xe0f2fe);
        fx.coneMesh.visible = true;
      }
    }
    if (isFirstPerson && (insideTrainCar > 0 || insideBuildingId)) {
      this.ambientLight.intensity = this.baseAmbientIntensity * 0.26;
      this.hemiLight.intensity = this.baseHemiIntensity * 0.24;
      this.sunLight.intensity = this.baseSunIntensity * 0.20;
    } else {
      this.ambientLight.intensity = this.baseAmbientIntensity;
      this.hemiLight.intensity = this.baseHemiIntensity;
      this.sunLight.intensity = this.baseSunIntensity;
    }

    if (isFirstPerson && insideBuildingId) {
      const b = buildings.find((bld) => bld.id === insideBuildingId);
      if (b) {
        this.interiorPointLight.color.setHex(0xd8e8ff);
        this.interiorPointLight.distance = 18;
        this.interiorPointLight.position.set(b.x, 3.7, b.z);
        this.interiorPointLight.intensity = anyActiveDip ? 2.1 : 5.2;
      } else {
        this.interiorPointLight.intensity = 0;
      }
      this.trainRedPointLight.intensity = 0;
    } else if (isFirstPerson && insideTrainCar > 0) {
      this.interiorPointLight.color.setHex(0xffb570);
      this.interiorPointLight.distance = 16;
      this.interiorPointLight.position.set(fpCamX, fpCamY + 0.35, 196.0);
      this.interiorPointLight.intensity = 2.05;
      const bulkheadX = fpCamX < 0 ? -7.5 : 7.5;
      this.trainRedPointLight.position.set(bulkheadX, fpCamY + 0.15, 196.0);
      this.trainRedPointLight.intensity = 3.4;
    } else {
      this.interiorPointLight.intensity = 0;
      this.trainRedPointLight.intensity = 0;
    }

    // 0c. Permanent Dark Broken Upper-Floor Windows (zero bright blue panes)
    if (this.brokenWindowCount < brokenWindows.length) {
      const holeMat = new THREE.MeshBasicMaterial({ color: 0x040508 });
      const holeFrameMat = new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.92 });
      while (this.brokenWindowCount < brokenWindows.length) {
        const bw = brokenWindows[this.brokenWindowCount++];
        const holeGrp = new THREE.Group();
        holeGrp.position.set(bw.x, bw.y, bw.z);
        holeGrp.rotation.y = bw.rotY;
        const recess = new THREE.Mesh(new THREE.BoxGeometry(1.32, 1.68, 0.14), holeMat);
        const frmTop = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.12, 0.2), holeFrameMat);
        frmTop.position.y = 0.86;
        const frmBot = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.14, 0.22), holeFrameMat);
        frmBot.position.y = -0.86;
        holeGrp.add(recess, frmTop, frmBot);
        this.cityGroup.add(holeGrp);
      }
    }

    // 0d. Car Alarm Hazard Strobes & Breached-Sector Power Grid Blackout
    for (const [obsId, alarmGrp] of this.alarmBeaconMeshes.entries()) {
      alarmGrp.visible = activeAlarmIds.has(obsId) && Math.sin(time * 18 + obsId) > 0;
    }

    const baseShowCones = this.atmosphereStage !== 'day';
    for (let ci = 0; ci < this.streetLampCones.length; ci++) {
      const cone = this.streetLampCones[ci];
      if (!baseShowCones) {
        cone.visible = false;
        continue;
      }
      const wz = cone.parent && cone.parent !== this.cityGroup ? cone.parent.position.z : cone.position.z;
      if (wz < blackoutMaxZ) {
        cone.visible = gridFlickerTimer > 0 && Math.sin(time * 36 + ci * 2.1) > 0.25;
      } else {
        cone.visible = true;
      }
    }

    // 1. Roadblocks
    const activeRbIds = new Set<number>();
    for (const rb of roadblocks) {
      if (!rb.active) continue;
      activeRbIds.add(rb.id);
      let mesh = this.roadblockMeshes.get(rb.id);
      if (!mesh) {
        mesh = this.createRoadblockMesh();
        this.tacticalGroup.add(mesh);
        this.roadblockMeshes.set(rb.id, mesh);
      }
      mesh.position.set(rb.x, 0.15, rb.z);
      mesh.rotation.y = rb.rotationY;
    }
    for (const [id, mesh] of this.roadblockMeshes.entries()) {
      if (!activeRbIds.has(id)) {
        this.tacticalGroup.remove(mesh);
        this.roadblockMeshes.delete(id);
      }
    }

    // 2. Evacuation Zones
    const activeEvacIds = new Set<number>();
    for (const ez of evacZones) {
      if (!ez.active) continue;
      activeEvacIds.add(ez.id);
      let mesh = this.evacMeshes.get(ez.id);
      if (!mesh) {
        mesh = this.createEvacZoneMesh(ez.radius);
        this.tacticalGroup.add(mesh);
        this.evacMeshes.set(ez.id, mesh);
      }
      mesh.position.set(ez.x, 0.12, ez.z);
      mesh.rotation.y = time * 0.8;
    }
    for (const [id, mesh] of this.evacMeshes.entries()) {
      if (!activeEvacIds.has(id)) {
        this.tacticalGroup.remove(mesh);
        this.evacMeshes.delete(id);
      }
    }

    // 3. Hold / Defend Zones (muted/hidden in first-person immersion)
    const activeHoldIds = new Set<number>();
    for (const hz of holdZones) {
      if (!hz.active) continue;
      activeHoldIds.add(hz.id);
      let mesh = this.holdMeshes.get(hz.id);
      if (!mesh) {
        mesh = this.createHoldZoneMesh(hz.radius);
        this.tacticalGroup.add(mesh);
        this.holdMeshes.set(hz.id, mesh);
      }
      mesh.position.set(hz.x, 0.1, hz.z);
      mesh.visible = !isFirstPerson;
    }
    for (const [id, mesh] of this.holdMeshes.entries()) {
      if (!activeHoldIds.has(id)) {
        this.tacticalGroup.remove(mesh);
        this.holdMeshes.delete(id);
      }
    }

    // 4. Acoustic Lure Flares
    const activeLureIds = new Set<number>();
    for (const lf of lureFlares) {
      if (!lf.active) continue;
      activeLureIds.add(lf.id);
      let mesh = this.lureMeshes.get(lf.id);
      if (!mesh) {
        mesh = this.createLureFlareMesh();
        this.tacticalGroup.add(mesh);
        this.lureMeshes.set(lf.id, mesh);
      }
      mesh.position.set(lf.x, 0.18, lf.z);
      const pulseScale = 1 + Math.sin(time * 10 + lf.id) * 0.12;
      mesh.children[1].scale.set(pulseScale, 1, pulseScale);
    }
    for (const [id, mesh] of this.lureMeshes.entries()) {
      if (!activeLureIds.has(id)) {
        this.tacticalGroup.remove(mesh);
        this.lureMeshes.delete(id);
      }
    }

    // 5. Priority Sector (hidden in first-person immersion)
    if (prioritySector && prioritySector.active) {
      if (!this.priorityMesh) {
        this.priorityMesh = this.createPrioritySectorMesh(prioritySector.radius);
        this.tacticalGroup.add(this.priorityMesh);
      }
      this.priorityMesh.position.set(prioritySector.x, 0.2, prioritySector.z);
      this.priorityMesh.visible = !isFirstPerson;
    } else if (this.priorityMesh) {
      this.priorityMesh.visible = false;
    }

    // 6. World-Space 3D Health & Durability Bars (InstancedMesh, hidden in FP immersion)
    this.worldBarsGroup.clear();
    let cBarBg = 0;
    let cBarGreen = 0;
    let cBarOrange = 0;
    let cBarRed = 0;
    let cBarPurple = 0;
    const writeBar = (
      bx: number,
      by: number,
      bz: number,
      width: number,
      pct: number,
      kind: 'green' | 'orange' | 'red' | 'purple'
    ) => {
      if (cBarBg < 160) {
        this.writeFxInstance(this.barBgInst, cBarBg++, bx, by, bz, width, 1, 1);
      }
      if (pct <= 0) return;
      const fillW = width * pct;
      const fx = bx - (width - fillW) * 0.5;
      if (kind === 'green' && cBarGreen < 32) {
        this.writeFxInstance(this.barGreenInst, cBarGreen++, fx, by, bz, fillW, 1.15, 1.15);
      } else if (kind === 'orange' && cBarOrange < 160) {
        this.writeFxInstance(this.barOrangeInst, cBarOrange++, fx, by, bz, fillW, 1.15, 1.15);
      } else if (kind === 'red' && cBarRed < 160) {
        this.writeFxInstance(this.barRedInst, cBarRed++, fx, by, bz, fillW, 1.15, 1.15);
      } else if (kind === 'purple' && cBarPurple < 160) {
        this.writeFxInstance(this.barPurpleInst, cBarPurple++, fx, by, bz, fillW, 1.15, 1.15);
      }
    };

    if (!isFirstPerson) {
      const gateColor = (pct: number, damagedAt: number) =>
        pct <= 0.3 ? 'red' : pct <= 0.6 || time - damagedAt < 0.9 ? 'orange' : 'green';
      for (const g of gates) {
        const pct = g.breached ? 0 : g.integrity / g.maxIntegrity;
        writeBar(g.x, 10.2, g.z, 8, pct, gateColor(pct, g.lastDamagedAt));
      }
      if (stationGates) {
        for (const id of KTX_GATE_IDS) {
          const { x, y, z, width } = KTX_GATES[id];
          const gate = stationGates[id];
          const pct = gate.integrity / gate.maxIntegrity;
          writeBar(x, y + 3.65, z, Math.max(4, width * 0.82), pct, gateColor(pct, gate.lastDamagedAt));
        }
      }
      for (const rb of roadblocks) {
        if (!rb.active) continue;
        const pct = Math.max(0.05, rb.integrity / rb.maxIntegrity);
        writeBar(rb.x, 2.3, rb.z, 2.6, pct, pct > 0.5 ? 'orange' : 'red');
      }

      for (const b of buildings) {
        if (b.shelteredAgentIds.length > 0 && b.doorIntegrity > 0) {
          const doorPct = Math.max(0.05, b.doorIntegrity / b.maxDoorIntegrity);
          writeBar(b.doorX, 3.2, b.doorZ, 2.2, doorPct, doorPct > 0.45 ? 'purple' : 'red');
        }
      }
    }

    // 7. Voxel Blocky Fire/Smoke, Tracers & Blood Droplet Splatter (Zero-Alloc InstancedMesh Pools!)
    this.effectsGroup.clear();
    let cFireO = 0;
    let cFireY = 0;
    let cSmoke = 0;
    let cEmber = 0;
    let cBloodD = 0;
    let cBloodM = 0;
    let cGlass = 0;
    let cWood = 0;
    let cImpactDust = 0;
    let cGunBeam = 0;
    let cGunFlash = 0;

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (!v.isBurning) continue;

      for (let f = 0; f < 4; f++) {
        const flicker = 0.7 + Math.sin(time * 18 + v.id * 3 + f * 1.9) * 0.35;
        const fx = v.x + Math.sin(f * 2.1 + v.id) * 0.55;
        const fz = v.z + Math.cos(f * 1.7 + v.id) * 0.75;
        const fy = 1.35 + (f % 2) * 0.35;
        if (f % 2 === 0) {
          if (cFireO < 320) {
            this.writeFxInstance(this.fxFireOrangeInst, cFireO++, fx, fy, fz, 0.72 * flicker, 0.95 * flicker, 0.72 * flicker);
          }
        } else if (cFireY < 240) {
          this.writeFxInstance(this.fxFireYellowInst, cFireY++, fx, fy, fz, 0.72 * flicker, 0.95 * flicker, 0.72 * flicker);
        }
      }

      for (let p = 0; p < 5; p++) {
        if (cSmoke >= 420) break;
        const phase = (time * 0.95 + p * 0.2 + v.id * 0.17) % 1;
        const s = 0.62 + phase * 1.35;
        this.writeFxInstance(
          this.fxSmokeInst,
          cSmoke++,
          v.x + Math.sin(time * 2.2 + p * 1.7) * (0.4 + phase * 0.7),
          1.9 + phase * 6.2,
          v.z + Math.cos(time * 1.8 + p * 1.3) * (0.4 + phase * 0.6),
          s,
          s,
          s,
          0,
          phase * 1.5,
          0
        );
      }

      for (let e = 0; e < 4; e++) {
        if (cEmber >= 240) break;
        const ep = (time * 1.1 + e * 0.25 + v.id * 0.31) % 1;
        this.writeFxInstance(
          this.fxEmberInst,
          cEmber++,
          v.x + ep * 1.4 + Math.sin(time * 4 + e) * 0.35,
          1.8 + ep * 5.2,
          v.z + ep * 0.8 + Math.cos(time * 3.5 + e) * 0.35,
          1,
          1,
          1
        );
      }
    }

    const staticObs = this.currentLayout?.staticObstacles ?? [];
    for (let oi = 0; oi < staticObs.length; oi++) {
      const obs = staticObs[oi];
      if (!obs.isBurning) continue;

      const sinR = obs.sinR ?? Math.sin(obs.rotationY);
      const cosR = obs.cosR ?? Math.cos(obs.rotationY);
      const cabX = obs.x + sinR * (obs.depth * 0.28);
      const cabZ = obs.z + cosR * (obs.depth * 0.28);
      const fireBaseY = obs.kind === 'truck_burning' || obs.kind === 'bus' ? 2.15 : 1.35;

      for (let f = 0; f < 8; f++) {
        const flicker = 0.72 + Math.sin(time * 16 + obs.id * 2.7 + f * 1.8) * 0.36;
        const fx = cabX + Math.sin(f * 2.3 + obs.id) * 0.85;
        const fz = cabZ + Math.cos(f * 1.9 + obs.id) * 0.95;
        const fy = fireBaseY + 0.1 + (f % 4) * 0.45;
        const sy = (1.15 + (f % 2) * 0.35) * flicker;
        if (f % 3 === 0) {
          if (cFireY < 240) {
            this.writeFxInstance(this.fxFireYellowInst, cFireY++, fx, fy, fz, 0.82 * flicker, sy, 0.82 * flicker);
          }
        } else if (cFireO < 320) {
          this.writeFxInstance(this.fxFireOrangeInst, cFireO++, fx, fy, fz, 0.82 * flicker, sy, 0.82 * flicker);
        }
      }

      for (let p = 0; p < 10; p++) {
        if (cSmoke >= 420) break;
        const phase = (time * 0.78 + p * 0.1 + obs.id * 0.13) % 1;
        const s = 0.8 + phase * 1.75;
        this.writeFxInstance(
          this.fxSmokeInst,
          cSmoke++,
          cabX + Math.sin(time * 1.9 + p * 1.6) * (0.5 + phase * 1.15),
          fireBaseY + 1.1 + phase * 10.2,
          cabZ + Math.cos(time * 1.6 + p * 1.4) * (0.5 + phase * 0.95),
          s,
          s,
          s,
          0,
          phase * 1.6,
          0
        );
      }

      for (let e = 0; e < 6; e++) {
        if (cEmber >= 240) break;
        const ep = (time * 0.95 + e * 0.17 + obs.id * 0.23) % 1;
        this.writeFxInstance(
          this.fxEmberInst,
          cEmber++,
          cabX + ep * 1.8 + Math.sin(time * 4.5 + e * 2.1) * 0.45,
          fireBaseY + 0.9 + ep * 7.2,
          cabZ + ep * 1.1 + Math.cos(time * 3.8 + e * 1.7) * 0.45,
          1,
          1,
          1
        );
      }
    }

    // Elevated overpass crashed delivery truck smoke plumes
    for (let ei = 0; ei < this.elevatedSmokeEmitters.length; ei++) {
      const em = this.elevatedSmokeEmitters[ei];
      for (let p = 0; p < 7; p++) {
        if (cSmoke >= 420) break;
        const phase = (time * 0.72 + p * 0.14 + em.seed * 0.21) % 1;
        const s = 0.85 + phase * 1.85;
        this.writeFxInstance(
          this.fxSmokeInst,
          cSmoke++,
          em.x + Math.sin(time * 1.8 + p * 1.7) * (0.4 + phase * 1.1),
          em.y + phase * 9.5,
          em.z + Math.cos(time * 1.5 + p * 1.3) * (0.4 + phase * 0.9),
          s,
          s,
          s,
          0,
          phase * 1.4,
          0
        );
      }
    }

    for (let ei = 0; ei < effects.length; ei++) {
      const ev = effects[ei];
      const t = Math.min(1, ev.age / ev.duration);
      if (ev.type === 'player_shot' && ev.targetX !== undefined && ev.targetY !== undefined && ev.targetZ !== undefined) {
        const y = ev.y ?? 1.68;
        const dx = ev.targetX - ev.x;
        const dy = ev.targetY - y;
        const dz = ev.targetZ - ev.z;
        const distance = Math.hypot(dx, dy, dz);
        const travelTime = distance / 380;
        const front = Math.min(distance, (ev.age + 0.006) * 380);
        const rear = Math.max(0, (ev.age - 0.013) * 380);
        if (distance > 0.06 && front > rear && cGunBeam < 160) {
          const a = rear / distance;
          const b = front / distance;
          this.writeBeamInstance(this.fxGunBeamInst, cGunBeam++,
            ev.x + dx * a, y + dy * a, ev.z + dz * a,
            ev.x + dx * b, y + dy * b, ev.z + dz * b, 0.45);
        }
        const impactAge = ev.age - travelTime + 0.006;
        if (ev.impact && impactAge >= 0 && impactAge < 0.21) {
          const fade = 1 - impactAge / 0.21;
          const offset = distance > 0.05 ? 0.055 / distance : 0;
          for (let particle = 0; particle < 4; particle++) {
            const angle = particle * 2.39 + ev.targetX * 0.17;
            const spread = impactAge * (ev.impact === 'metal' ? 2.8 : 1.45);
            const px = ev.targetX - dx * offset + Math.cos(angle) * spread;
            const py = Math.max(0.24, ev.targetY - dy * offset + impactAge * (1.4 + particle * 0.45) - impactAge ** 2 * 5);
            const pz = ev.targetZ - dz * offset + Math.sin(angle) * spread;
            if (ev.impact === 'metal' && cGunFlash < 160) {
              const size = 0.065 * fade;
              this.writeFxInstance(this.fxGunFlashInst, cGunFlash++, px, py, pz, size, size * 1.7, size);
            } else if (ev.impact === 'infected' && cBloodM < 600) {
              this.writeFxInstance(this.fxBloodMidInst, cBloodM++, px, py, pz, fade * 0.72, fade * 0.85, fade * 0.72);
            } else if (ev.impact === 'dust' && cImpactDust < 120) {
              const size = (0.065 + impactAge * 0.35) * fade;
              this.writeFxInstance(this.fxImpactDustInst, cImpactDust++, px, py, pz, size, size, size);
            }
          }
        }
      } else if (ev.type === 'gunshot' && ev.targetX !== undefined && ev.targetZ !== undefined) {
        if (cGunBeam < 160) {
          this.writeBeamInstance(
            this.fxGunBeamInst,
            cGunBeam++,
            ev.x,
            ev.y ?? 1.35,
            ev.z,
            ev.targetX,
            ev.targetY ?? 1.15,
            ev.targetZ
          );
        }
        if (cGunFlash < 160) {
          const fs = (1 - t * 0.5) * 0.28;
          this.writeFxInstance(this.fxGunFlashInst, cGunFlash++, ev.x, ev.y ?? 1.35, ev.z, fs, fs, fs);
        }
      } else if (ev.type === 'explosion') {
        const ballScale = 1.6 + Math.sin(t * Math.PI) * 5.2;
        const fireball = new THREE.Mesh(this.voxelUnitGeo, this.explosionMat);
        fireball.position.set(ev.x, 1.8 + t * 2.5, ev.z);
        fireball.scale.set(ballScale, ballScale * 0.85, ballScale);
        fireball.rotation.y = t * 2.2;
        this.effectsGroup.add(fireball);

        const core = new THREE.Mesh(this.voxelUnitGeo, this.explosionCoreMat);
        core.position.set(ev.x, 2.0 + t * 2.8, ev.z);
        core.scale.setScalar(ballScale * 0.55);
        core.rotation.y = -t * 1.8;
        this.effectsGroup.add(core);

        const ringR = 1.5 + t * 12.5;
        const ring = new THREE.Mesh(this.ringUnitGeo, this.explosionRingMat);
        ring.position.set(ev.x, 0.35, ev.z);
        ring.scale.set(ringR, 1, ringR);
        this.effectsGroup.add(ring);
      } else if (ev.type === 'train_horn') {
        if (!isFirstPerson) {
          const radius = 2.0 + t * 26.0;
          const ring = new THREE.Mesh(this.ringUnitGeo, this.trainHornMat);
          ring.position.set(ev.x, 1.2 + t * 2.0, ev.z);
          ring.scale.set(radius, 1, radius);
          this.effectsGroup.add(ring);
        }
      } else if (ev.type === 'car_alarm_pulse') {
        if (!isFirstPerson) {
          const radius = 1.4 + t * 18.0;
          const ring = new THREE.Mesh(this.ringUnitGeo, this.reportRingMat);
          ring.position.set(ev.x, 0.5 + t * 0.8, ev.z);
          ring.scale.set(radius, 1, radius);
          this.effectsGroup.add(ring);
        }
      } else if (ev.type === 'window_shatter') {
        const baseY = ev.y ?? 8.5;
        const outX = ev.dirX ?? 0;
        const outZ = ev.dirZ ?? 0;
        const seed = Math.abs(Math.round(ev.x * 13 + ev.z * 29));
        for (let b = 0; b < 14; b++) {
          const spread = ((b * 17 + seed) % 100) * 0.01 - 0.5;
          const outSpeed = 2.6 + ((b * 7) % 5) * 0.75;
          const vx = outX * outSpeed + (outZ !== 0 ? spread * 3.2 : spread * 0.9);
          const vz = outZ * outSpeed + (outX !== 0 ? spread * 3.2 : spread * 0.9);
          const vy = 0.8 + ((b * 11) % 4) * 0.55;
          const ageSec = ev.age;
          const py = Math.max(0.12, baseY + vy * ageSec - 9.8 * ageSec * ageSec);
          if (b < 10) {
            if (cGlass < 240) {
              this.writeFxInstance(
                this.fxShatterGlassInst,
                cGlass++,
                ev.x + vx * ageSec,
                py,
                ev.z + vz * ageSec,
                1.1,
                0.9,
                1.3,
                ageSec * 8 + b,
                ageSec * 6,
                b
              );
            }
          } else if (cWood < 160) {
            this.writeFxInstance(
              this.fxShatterWoodInst,
              cWood++,
              ev.x + vx * ageSec,
              py,
              ev.z + vz * ageSec,
              1.1,
              0.9,
              1.3,
              ageSec * 8 + b,
              ageSec * 6,
              b
            );
          }
        }
      } else if (ev.type === 'door_pound') {
        for (let d = 0; d < 4; d++) {
          if (cWood >= 160) break;
          this.writeFxInstance(
            this.fxShatterWoodInst,
            cWood++,
            ev.x + Math.sin(d * 2.1 + ev.age * 14) * (0.25 + t * 0.6),
            Math.max(0.2, 1.35 + d * 0.12 - t * 0.9),
            ev.z + Math.cos(d * 1.9 + ev.age * 11) * (0.25 + t * 0.6),
            1,
            1,
            1
          );
        }
      } else if (ev.type === 'report_ring') {
        if (!isFirstPerson) {
          const radius = 0.8 + t * 9.5;
          const ring = new THREE.Mesh(this.ringUnitGeo, this.reportRingMat);
          ring.position.set(ev.x, 0.4 + t * 1.5, ev.z);
          ring.scale.set(radius, 1, radius);
          this.effectsGroup.add(ring);
        }
      } else if (ev.type === 'lure_pulse') {
        if (!isFirstPerson) {
          const radius = 1.2 + t * 16.0;
          const ring = new THREE.Mesh(this.ringUnitGeo, this.lureRingMat);
          ring.position.set(ev.x, 0.35 + t * 0.6, ev.z);
          ring.scale.set(radius, 1, radius);
          this.effectsGroup.add(ring);
        }
      } else if (ev.type === 'cure') {
        if (!isFirstPerson) {
          const radius = 0.4 + t * 3.0;
          const ring = new THREE.Mesh(this.ringUnitGeo, this.cureRingMat);
          ring.position.set(ev.x, 0.8 + t * 1.0, ev.z);
          ring.scale.set(radius, 1, radius);
          this.effectsGroup.add(ring);
        }
      } else if (ev.type === 'bite' || ev.type === 'convert') {
        const evSeed = Math.abs(Math.round(ev.x * 17 + ev.z * 31));
        const evKey = `${Math.round(ev.x * 4)}:${Math.round(ev.z * 4)}:${Math.floor((time - ev.age) * 2)}`;
        if ((ev.y ?? 0) < 0.2 && !this.stampedBloodEvents.has(evKey)) {
          this.stampedBloodEvents.add(evKey);
          if (this.stampedBloodEvents.size > 400) this.stampedBloodEvents.clear();
          this.stampBloodStain(ev.x, ev.z);
        }
        const ageSec = ev.age;
        for (let b = 0; b < 10; b++) {
          const angle = ((evSeed * 13 + b * 37) % 628) * 0.01;
          const speed = 1.6 + ((b * 7 + evSeed) % 5) * 0.55;
          const vy = 2.4 + ((b * 11 + evSeed) % 4) * 0.75;
          const px = ev.x + Math.cos(angle) * speed * ageSec;
          const pz = ev.z + Math.sin(angle) * speed * ageSec;
          if (isFirstPerson && Math.hypot(px - fpCamX, pz - fpCamZ) < 1.15) {
            continue;
          }
          const py = Math.max(0.08, (ev.y ?? 0) + 1.15 + vy * ageSec - 5.4 * ageSec * ageSec);
          const s = Math.max(0.45, 1.25 - t * 0.65);
          if (b % 2 === 0) {
            if (cBloodD < 600) {
              this.writeFxInstance(this.fxBloodDarkInst, cBloodD++, px, py, pz, s, s, s);
            }
          } else if (cBloodM < 600) {
            this.writeFxInstance(this.fxBloodMidInst, cBloodM++, px, py, pz, s, s, s);
          }
        }
      }
    }

    const syncPool = (inst: THREE.InstancedMesh, count: number) => {
      inst.count = count;
      if (count > 0) inst.instanceMatrix.needsUpdate = true;
    };
    syncPool(this.barBgInst, cBarBg);
    syncPool(this.barGreenInst, cBarGreen);
    syncPool(this.barOrangeInst, cBarOrange);
    syncPool(this.barRedInst, cBarRed);
    syncPool(this.barPurpleInst, cBarPurple);
    syncPool(this.fxFireOrangeInst, cFireO);
    syncPool(this.fxFireYellowInst, cFireY);
    syncPool(this.fxSmokeInst, cSmoke);
    syncPool(this.fxEmberInst, cEmber);
    syncPool(this.fxBloodDarkInst, cBloodD);
    syncPool(this.fxBloodMidInst, cBloodM);
    syncPool(this.fxShatterGlassInst, cGlass);
    syncPool(this.fxShatterWoodInst, cWood);
    syncPool(this.fxGunBeamInst, cGunBeam);
    syncPool(this.fxGunFlashInst, cGunFlash);
    syncPool(this.fxImpactDustInst, cImpactDust);

    // 8. Interactive Urban Supply Pickups (hidden in Commander overview? Shown cleanly in both views!)
    const activePickupIds = new Set<number>();
    for (let pi = 0; pi < supplyPickups.length; pi++) {
      const p = supplyPickups[pi];
      if (p.collected) continue;
      activePickupIds.add(p.id);
      let mesh = this.pickupMeshes.get(p.id);
      if (!mesh) {
        mesh = this.createSupplyPickupMesh(p.kind);
        this.tacticalGroup.add(mesh);
        this.pickupMeshes.set(p.id, mesh);
      }
      mesh.position.set(p.x, 0.72 + Math.sin(time * 3.4 + p.id) * 0.1, p.z);
      mesh.rotation.y = time * 1.6 + p.id;
    }
    for (const cache of ammoCaches) {
      activePickupIds.add(cache.id);
      let mesh = this.pickupMeshes.get(cache.id);
      if (!mesh) {
        mesh = this.createAmmoCacheMesh();
        this.pickupMeshes.set(cache.id, mesh);
        this.tacticalGroup.add(mesh);
      }
      mesh.position.set(cache.x, cache.y + 0.25, cache.z);
      const indicator = mesh.getObjectByName('ammo-ready');
      if (indicator) indicator.visible = cache.readyAt <= time;
    }
    for (const [id, mesh] of this.pickupMeshes.entries()) {
      if (!activePickupIds.has(id)) {
        this.tacticalGroup.remove(mesh);
        this.pickupMeshes.delete(id);
      }
    }
  }

  private createAmmoCacheMesh(): THREE.Group {
    const group = new THREE.Group();
    const casing = new THREE.MeshStandardMaterial({ color: 0x354447, roughness: 0.72 });
    const paint = new THREE.MeshBasicMaterial({ color: 0xf8cd7a });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.45, 0.66), casing);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.09, 0.7), casing);
    lid.position.y = 0.24;
    crate.castShadow = true;
    const indicator = new THREE.Group();
    indicator.name = 'ammo-ready';
    for (const x of [-0.22, 0, 0.22]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.035, 0.3), paint);
      stripe.position.set(x, 0.30, 0);
      indicator.add(stripe);
    }
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.018), paint);
    face.position.set(0, 0.08, 0.34);
    group.add(crate, lid, face, indicator);
    return group;
  }

  private createSupplyPickupMesh(kind: SupplyPickupData['kind']): THREE.Group {
    const grp = new THREE.Group();
    const baseColor =
      kind === 'antiviral_kit' ? 0xe2e8f0 : kind === 'energy_drink' ? 0x0f172a : 0x334155;
    const glowColor =
      kind === 'antiviral_kit' ? 0x22c55e : kind === 'energy_drink' ? 0x38bdf8 : 0xf59e0b;

    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.34, 0.46),
      new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.45, metalness: 0.2 })
    );
    crate.castShadow = true;
    const bandMat = new THREE.MeshBasicMaterial({ color: glowColor });
    if (kind === 'antiviral_kit') {
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.1), bandMat);
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.28), bandMat);
      c1.position.y = 0.19;
      c2.position.y = 0.19;
      grp.add(crate, c1, c2);
    } else {
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), bandMat);
      belt.position.y = 0.04;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.22), bandMat);
      cap.position.y = 0.22;
      grp.add(crate, belt, cap);
    }
    return grp;
  }

  private createRoadblockMesh(): THREE.Group {
    const group = new THREE.Group();
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.7 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.5 });
    const redBeaconMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    const blueBeaconMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });

    for (const ox of [-2.3, 0, 2.3]) {
      const barrier = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 0.75), concreteMat);
      barrier.position.set(ox, 0.55, 0);
      barrier.castShadow = true;
      const topBar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.28, 0.82), stripeMat);
      topBar.position.set(ox, 1.15, 0);
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 8, 8),
        ox === 0 ? blueBeaconMat : redBeaconMat
      );
      beacon.position.set(ox, 1.45, 0);
      group.add(barrier, topBar, beacon);
    }
    return group;
  }

  private createEvacZoneMesh(radius: number): THREE.Group {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.45, radius, 32),
      new THREE.MeshBasicMaterial({
        color: 0x22c55e,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85
      })
    );
    ring.rotation.x = -Math.PI / 2;

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 1.2, 12, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x4ade80,
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide
      })
    );
    beam.position.y = 6.0;
    group.add(ring, beam);
    return group;
  }

  private createHoldZoneMesh(radius: number): THREE.Group {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.35, radius, 28),
      new THREE.MeshBasicMaterial({
        color: 0x3b82f6,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.75
      })
    );
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    return group;
  }

  private createLureFlareMesh(): THREE.Group {
    const group = new THREE.Group();
    const canister = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.34, 0.9, 10),
      new THREE.MeshBasicMaterial({ color: 0xf43f5e })
    );
    canister.position.y = 0.45;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.5, 4.1, 24),
      new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.5, 7, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xfb7185,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide
      })
    );
    beam.position.y = 3.5;

    group.add(canister, ring, beam);
    return group;
  }

  private createPrioritySectorMesh(radius: number): THREE.Group {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.5, radius, 36),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.55
      })
    );
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    return group;
  }
}
