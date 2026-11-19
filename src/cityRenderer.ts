import * as THREE from 'three';
import { BLOCK_PITCH, CityLayout, ROAD_WIDTH } from './cityData';
import {
  BlastGateData,
  BuildingData,
  DefenseWallData,
  EvacZoneData,
  ExpressTrainData,
  HoldZoneData,
  LureFlareData,
  PrioritySectorData,
  RoadblockData,
  StaticObstacleData,
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
  beaconMat: THREE.MeshBasicMaterial;
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

  private skyDomeMesh!: THREE.Mesh;
  private skyMat!: THREE.MeshBasicMaterial;
  private skyTextures: Partial<Record<AtmosphereStage, THREE.CanvasTexture>> = {};

  private roadblockMeshes: Map<number, THREE.Group> = new Map();
  private evacMeshes: Map<number, THREE.Group> = new Map();
  private holdMeshes: Map<number, THREE.Group> = new Map();
  private lureMeshes: Map<number, THREE.Group> = new Map();
  private gateVisuals: Map<string, BlastGateVisual> = new Map();
  private priorityMesh: THREE.Group | null = null;

  private expressTrainGroup: THREE.Group | null = null;
  private stationBeaconMat: THREE.MeshBasicMaterial | null = null;

  private textureStudio: VoxelTextureStudio;
  private streetLampCones: THREE.Mesh[] = [];
  private bloodStainInst!: THREE.InstancedMesh;
  private bloodStainCursor = 0;
  private bloodStainCount = 0;
  private maxBloodStains = 240;
  private stampedBloodEvents = new Set<string>();

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
    color: 0xfef08a,
    transparent: true,
    opacity: 0.95
  });
  private fireMat = new THREE.MeshBasicMaterial({
    color: 0xf97316,
    transparent: true,
    opacity: 0.9
  });
  private barBgMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
  private barOrangeMat = new THREE.MeshBasicMaterial({ color: 0xf97316 });
  private barRedMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  private barPurpleMat = new THREE.MeshBasicMaterial({ color: 0xa855f7 });

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

    this.buildSkyAndHorizon();
    this.setupLighting();
    this.initPlacementPreview();
    this.rebuildCity(layout);
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

    const apron = new THREE.Mesh(
      new THREE.CircleGeometry(1300, 48),
      new THREE.MeshBasicMaterial({ color: 0x201830 })
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -1.6;
    this.horizonGroup.add(apron);

    // 68 stepped voxel skyline silhouette skyscrapers placed outside the 456m corridor (r = 305..425)
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
    for (let i = 0; i < 68; i++) {
      const angle = (i / 68) * Math.PI * 2;
      const radius = 305 + ((i * 37) % 120);
      const w = 16 + ((i * 7) % 18);
      const d = 16 + ((i * 11) % 16);
      const h = 52 + ((i * 23) % 86);
      const sx = Math.cos(angle) * radius;
      const sz = Math.sin(angle) * radius;

      const sil = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), silMat);
      sil.position.set(sx, h * 0.5 - 1.6, sz);
      sil.rotation.y = -angle;
      this.horizonGroup.add(sil);

      if (i % 3 === 0) {
        const crown = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 11, d * 0.6), silMat);
        crown.position.set(sx, h + 3.8, sz);
        crown.rotation.y = -angle;
        const spire = new THREE.Mesh(new THREE.BoxGeometry(1.1, 14, 1.1), spireMat);
        spire.position.set(sx, h + 14.5, sz);
        this.horizonGroup.add(crown, spire);
      }
    }
  }

  private setupLighting(): void {
    this.ambientLight = new THREE.AmbientLight(0xd2ddf2, 1.02);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0xc7b9ff, 0x323b4f, 1.38);
    this.hemiLight.position.set(0, 90, 0);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xffb469, 2.45);
    this.sunLight.position.set(-125, 86, -110);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 360;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

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
      this.scene.background = new THREE.Color(0x211933);
      this.scene.fog = new THREE.FogExp2(0x2b1e3b, 0.00105);
      this.ambientLight.intensity = 1.02;
      this.hemiLight.color.setHex(0xc7b9ff);
      this.hemiLight.groundColor.setHex(0x323b4f);
      this.hemiLight.intensity = 1.38;
      this.sunLight.intensity = 2.45;
      this.sunLight.color.setHex(0xffb469);
      this.sunLight.position.set(-125, 86, -110);
    } else if (stage === 'night') {
      this.scene.background = new THREE.Color(0x040711);
      this.scene.fog = new THREE.FogExp2(0x050914, 0.0034);
      this.ambientLight.intensity = 0.28;
      this.hemiLight.color.setHex(0x60a5fa);
      this.hemiLight.groundColor.setHex(0x090d16);
      this.hemiLight.intensity = 0.42;
      this.sunLight.intensity = 0.58;
      this.sunLight.color.setHex(0x93c5fd);
      this.sunLight.position.set(60, 95, 55);
    } else {
      this.scene.background = new THREE.Color(0x38bdf8);
      this.scene.fog = new THREE.FogExp2(0x476b8c, 0.0018);
      this.ambientLight.intensity = 0.72;
      this.hemiLight.color.setHex(0xe0f2fe);
      this.hemiLight.groundColor.setHex(0x334155);
      this.hemiLight.intensity = 0.92;
      this.sunLight.intensity = 1.62;
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
    this.gateVisuals.clear();
    this.streetLampCones = [];
    this.priorityMesh = null;
    this.expressTrainGroup = null;
    this.stationBeaconMat = null;

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
    this.buildDefenseWallsAndGates(layout);
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
    } else if (tool === 'deploy_swat') {
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
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.04
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
    const gateWidth = 13.0;

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
          new THREE.BoxGeometry(segW, 0.42, wd.thickness + 0.5),
          trimMat
        );
        parapet.position.set(segCx, wd.height + 0.21, wd.z);
        this.cityGroup.add(wallMesh, parapet);

        // Barbed wire horizontal rails + razor coils on parapet
        const wireStrandGeo = new THREE.BoxGeometry(segW, 0.06, 0.06);
        const strand1 = new THREE.Mesh(wireStrandGeo, wireMat);
        strand1.position.set(segCx, wd.height + 0.95, wd.z);
        const strand2 = new THREE.Mesh(wireStrandGeo, wireMat);
        strand2.position.set(segCx, wd.height + 1.25, wd.z);
        this.cityGroup.add(strand1, strand2);

        const postCount = Math.max(3, Math.floor(segW / 5));
        for (let p = 0; p <= postCount; p++) {
          const px = seg.start + (p / postCount) * segW;
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.14), wirePostMat);
          post.position.set(px, wd.height + 0.92, wd.z);
          this.cityGroup.add(post);
        }

        for (let rx = seg.start + 1.0; rx <= seg.end - 1.0; rx += 1.65) {
          const coil = new THREE.Mesh(coilGeo, wireMat);
          coil.position.set(rx, wd.height + 0.92, wd.z);
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

      // Steel Blast Gate archways & hazard-striped sliding doors
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

        gGroup.add(postL, postR, lintel, gateWire, beacon, amberCrown, leftDoor, rightDoor);
        this.cityGroup.add(gGroup);

        const key = `${wd.layerIndex}:${Math.round(gx)}`;
        this.gateVisuals.set(key, {
          group: gGroup,
          leftDoor,
          rightDoor,
          beaconMat
        });
      }
    }
  }

  private buildExpressRailAndTrain(layout: CityLayout): void {
    if (!layout.hasExpressRail) return;

    const railSpan = layout.cityHalfX * 2 + 40;
    const tracks = layout.railTracksZ.length > 0 ? layout.railTracksZ : [layout.railZ];
    const rz = layout.railZ;

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
      ballast.position.set(0, 0.08, tz);
      this.cityGroup.add(ballast);

      for (let sx = -layout.cityHalfX - 12; sx <= layout.cityHalfX + 12; sx += 2.2) {
        const sleeper = new THREE.Mesh(sleeperGeo, sleeperMat);
        sleeper.position.set(sx, 0.16, tz);
        this.cityGroup.add(sleeper);
      }

      const railN = new THREE.Mesh(railGeo, railMat);
      railN.position.set(0, 0.24, tz - 1.15);
      const railS = new THREE.Mesh(railGeo, railMat);
      railS.position.set(0, 0.24, tz + 1.15);
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

    if (tracks.length > 1) {
      // Multi-canopy KTX Terminal matching Organic Aerial Concept
      for (const cx of [-42, 0, 42]) {
        buildPlatformCanopy(cx, tracks[0] - 6.0, 32, true);
      }
      for (const cx of [-26, 26]) {
        buildPlatformCanopy(cx, tracks[1] + 6.0, 34, false);
      }
    } else {
      buildPlatformCanopy(layout.stationPos.x, rz - 6.0, 34, true);
    }

    // 5-Car High-Speed Voxel Express Train
    const trainGroup = new THREE.Group();
    const hullTex = this.textureStudio.getTrainHullTexture();
    const hullSideMat = new THREE.MeshStandardMaterial({
      map: hullTex,
      color: 0xffffff,
      roughness: 0.32,
      metalness: 0.25
    });
    const hullTopMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.4 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.45 });
    const bogieMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85 });

    const trainConeGeo = new THREE.ConeGeometry(2.0, 12.0, 10, 1, true);
    trainConeGeo.translate(0, -6.0, 0);
    trainConeGeo.rotateZ(Math.PI / 2); // Points toward +X
    const trainConeMat = this.textureStudio.createVolumetricConeMaterial(0xfef08a, 0.24);

    const carLength = 9.2;
    const carGap = 10.0;
    for (let c = -2; c <= 2; c++) {
      const cx = c * carGap;
      const carBody = new THREE.Mesh(
        new THREE.BoxGeometry(carLength, 2.35, 2.7),
        [hullTopMat, hullTopMat, hullTopMat, bogieMat, hullSideMat, hullSideMat]
      );
      carBody.position.set(cx, 1.55, 0);
      carBody.castShadow = true;

      const bogie = new THREE.Mesh(new THREE.BoxGeometry(carLength - 1.0, 0.38, 2.2), bogieMat);
      bogie.position.set(cx, 0.28, 0);
      trainGroup.add(carBody, bogie);

      if (c === 2 || c === -2) {
        const dir = c === 2 ? 1 : -1;
        const noseStep1 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.75, 2.4), noseMat);
        noseStep1.position.set(cx + dir * (carLength * 0.5 + 0.9), 1.35, 0);
        const noseStep2 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.05, 1.9), noseMat);
        noseStep2.position.set(cx + dir * (carLength * 0.5 + 2.3), 1.0, 0);
        trainGroup.add(noseStep1, noseStep2);

        if (c === 2) {
          const hlL = new THREE.Mesh(
            new THREE.BoxGeometry(0.25, 0.28, 0.32),
            new THREE.MeshBasicMaterial({ color: 0xfef08a })
          );
          hlL.position.set(cx + carLength * 0.5 + 2.9, 1.05, -0.58);
          const hlR = hlL.clone();
          hlR.position.z = 0.58;
          const coneL = new THREE.Mesh(trainConeGeo, trainConeMat);
          coneL.position.set(cx + carLength * 0.5 + 3.0, 1.05, -0.58);
          const coneR = new THREE.Mesh(trainConeGeo, trainConeMat);
          coneR.position.set(cx + carLength * 0.5 + 3.0, 1.05, 0.58);
          trainGroup.add(hlL, hlR, coneL, coneR);
        }
      }
    }

    trainGroup.position.set(-220, 0.25, rz);
    trainGroup.visible = false;
    this.cityGroup.add(trainGroup);
    this.expressTrainGroup = trainGroup;
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

      const bodyGeo = new THREE.BoxGeometry(b.width, b.height, b.depth);
      const bodyMesh = new THREE.Mesh(bodyGeo, [
        sideMat,
        sideMat,
        topMat,
        topMat,
        sideMat,
        sideMat
      ]);
      bodyMesh.position.y = b.height / 2;
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      bodyMesh.userData = { buildingId: b.id };
      bGroup.add(bodyMesh);

      // Rooftop parapet trim
      if (b.roofType !== 'pitched') {
        const para = new THREE.Mesh(
          new THREE.BoxGeometry(b.width + 0.35, 0.38, b.depth + 0.35),
          parapetMat
        );
        para.position.y = b.height + 0.19;
        bGroup.add(para);
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
      } else {
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
      entryGroup.add(frame, awning, entryBulb);

      if (b.name === '24H Avenue Mart') {
        const stripeLightMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6 });
        const stripeDarkMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 });
        for (let si = -3; si <= 3; si++) {
          const rib = new THREE.Mesh(
            new THREE.BoxGeometry(0.76, 0.22, 1.38),
            (si + 3) % 2 === 0 ? stripeLightMat : stripeDarkMat
          );
          rib.position.set(si * 0.76, 2.66, 0.62);
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
          label: NeonSignLabel
        ) => {
          const signTex = this.textureStudio.getNeonSignTexture(label);
          const signFaceMat = new THREE.MeshBasicMaterial({ map: signTex });
          const sg = new THREE.Group();
          sg.position.set(lx, 3.85, lz);
          sg.rotation.y = rotY;
          const casing = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.32, 0.24), signCasingMat);
          const face = new THREE.Mesh(new THREE.PlaneGeometry(4.42, 1.18), signFaceMat);
          face.position.z = 0.13;
          sg.add(casing, face);
          bGroup.add(sg);
        };

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

        // Extra road-facing sign + vertical corner neon banner along avenues
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
          if (b.height >= 10) {
            const vbTex = this.textureStudio.getVerticalBannerTexture((bi % 2) as 0 | 1);
            const vbMesh = new THREE.Mesh(
              new THREE.PlaneGeometry(0.95, 2.85),
              new THREE.MeshBasicMaterial({ map: vbTex, side: THREE.DoubleSide })
            );
            vbMesh.position.set(
              aveSignX + (b.x < 0 ? 0.45 : -0.45),
              6.2,
              faceSign * (b.depth * 0.42)
            );
            vbMesh.rotation.y = aveRot;
            bGroup.add(vbMesh);
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
      }

      this.cityGroup.add(grp);
    }
  }

  public syncDefenseAndTrain(
    walls: DefenseWallData[],
    gates: BlastGateData[],
    train: ExpressTrainData,
    time: number
  ): void {
    // 1. Animate Blast Gates (sliding doors & status beacons)
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
        vis.beaconMat.color.setHex(0xef4444);
      } else {
        const targetOffset = g.isOpen ? g.width * 0.62 : g.width * 0.25;
        vis.leftDoor.position.x += (-targetOffset - vis.leftDoor.position.x) * 0.22;
        vis.rightDoor.position.x += (targetOffset - vis.rightDoor.position.x) * 0.22;
        vis.leftDoor.rotation.z = 0;
        vis.rightDoor.rotation.z = 0;
        vis.beaconMat.color.setHex(g.isOpen ? 0x22c55e : 0xf59e0b);
      }
    }

    // 2. Sync High-Speed Express Train
    if (this.expressTrainGroup) {
      this.expressTrainGroup.visible = train.active && train.state !== 'COOLDOWN';
      this.expressTrainGroup.position.set(train.x, 0.25, train.z);
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
    fpCamZ = 0
  ): void {
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

    // 6. World-Space 3D Health & Durability Bars (hidden in first-person immersion)
    this.worldBarsGroup.clear();
    if (!isFirstPerson) {
      for (const rb of roadblocks) {
        if (!rb.active) continue;
        const pct = Math.max(0.05, rb.integrity / rb.maxIntegrity);
        this.addWorldBar(
          rb.x,
          2.3,
          rb.z,
          2.6,
          pct,
          pct > 0.5 ? this.barOrangeMat : this.barRedMat
        );
      }

      for (const g of gates) {
        if (g.breached || g.isOpen) continue;
        const pct = Math.max(0.05, g.integrity / g.maxIntegrity);
        if (pct < 0.99) {
          this.addWorldBar(
            g.x,
            10.2,
            g.z,
            8.0,
            pct,
            pct > 0.45 ? this.barOrangeMat : this.barRedMat
          );
        }
      }

      for (const b of buildings) {
        if (b.shelteredAgentIds.length > 0 && b.doorIntegrity > 0) {
          const doorPct = Math.max(0.05, b.doorIntegrity / b.maxDoorIntegrity);
          this.addWorldBar(
            b.doorX,
            3.2,
            b.doorZ,
            2.2,
            doorPct,
            doorPct > 0.45 ? this.barPurpleMat : this.barRedMat
          );
        }
      }
    }

    // 7. Voxel Blocky Fire/Smoke, Tracers & Blood Droplet Splatter (NO red glow rings!)
    this.effectsGroup.clear();

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (!v.isBurning) continue;

      // Multi-layered blocky voxel flames
      for (let f = 0; f < 4; f++) {
        const flicker = 0.7 + Math.sin(time * 18 + v.id * 3 + f * 1.9) * 0.35;
        const fx = v.x + Math.sin(f * 2.1 + v.id) * 0.55;
        const fz = v.z + Math.cos(f * 1.7 + v.id) * 0.75;
        const flame = new THREE.Mesh(
          this.voxelUnitGeo,
          f % 2 === 0 ? this.fireMat : this.fireYellowMat
        );
        flame.position.set(fx, 1.35 + (f % 2) * 0.35, fz);
        flame.scale.set(0.72 * flicker, 0.95 * flicker, 0.72 * flicker);
        this.effectsGroup.add(flame);
      }

      // Rising dark charcoal voxel smoke cubes
      for (let p = 0; p < 5; p++) {
        const phase = (time * 0.95 + p * 0.2 + v.id * 0.17) % 1;
        const puff = new THREE.Mesh(this.voxelUnitGeo, this.smokeMat);
        puff.position.set(
          v.x + Math.sin(time * 2.2 + p * 1.7) * (0.4 + phase * 0.7),
          1.9 + phase * 6.2,
          v.z + Math.cos(time * 1.8 + p * 1.3) * (0.4 + phase * 0.6)
        );
        const s = 0.62 + phase * 1.35;
        puff.scale.set(s, s, s);
        puff.rotation.y = phase * 1.5;
        this.effectsGroup.add(puff);
      }
    }

    const staticObs = this.currentLayout?.staticObstacles ?? [];
    for (let oi = 0; oi < staticObs.length; oi++) {
      const obs = staticObs[oi];
      if (!obs.isBurning) continue;

      const cabX = obs.x + Math.sin(obs.rotationY) * (obs.depth * 0.28);
      const cabZ = obs.z + Math.cos(obs.rotationY) * (obs.depth * 0.28);
      const fireBaseY = obs.kind === 'truck_burning' ? 2.15 : 1.35;

      for (let f = 0; f < 8; f++) {
        const flicker = 0.72 + Math.sin(time * 16 + obs.id * 2.7 + f * 1.8) * 0.36;
        const fx = cabX + Math.sin(f * 2.3 + obs.id) * 0.85;
        const fz = cabZ + Math.cos(f * 1.9 + obs.id) * 0.95;
        const flame = new THREE.Mesh(
          this.voxelUnitGeo,
          f % 3 === 0 ? this.fireYellowMat : this.fireMat
        );
        flame.position.set(fx, fireBaseY + 0.1 + (f % 4) * 0.45, fz);
        flame.scale.set(0.82 * flicker, (1.15 + (f % 2) * 0.35) * flicker, 0.82 * flicker);
        this.effectsGroup.add(flame);
      }

      for (let p = 0; p < 10; p++) {
        const phase = (time * 0.78 + p * 0.1 + obs.id * 0.13) % 1;
        const puff = new THREE.Mesh(this.voxelUnitGeo, this.smokeMat);
        puff.position.set(
          cabX + Math.sin(time * 1.9 + p * 1.6) * (0.5 + phase * 1.15),
          fireBaseY + 1.1 + phase * 10.2,
          cabZ + Math.cos(time * 1.6 + p * 1.4) * (0.5 + phase * 0.95)
        );
        const s = 0.8 + phase * 1.75;
        puff.scale.set(s, s, s);
        puff.rotation.y = phase * 1.6;
        this.effectsGroup.add(puff);
      }
    }

    for (let ei = 0; ei < effects.length; ei++) {
      const ev = effects[ei];
      const t = Math.min(1, ev.age / ev.duration);
      if (ev.type === 'gunshot' && ev.targetX !== undefined && ev.targetZ !== undefined) {
        this.tmpVecA.set(ev.x, 1.35, ev.z);
        this.tmpVecB.set(ev.targetX, 1.15, ev.targetZ);
        const len = this.tmpVecA.distanceTo(this.tmpVecB);
        if (len > 0.05) {
          const beam = new THREE.Mesh(this.beamUnitGeo, this.gunBeamMat);
          beam.position.copy(this.tmpVecA).add(this.tmpVecB).multiplyScalar(0.5);
          beam.scale.set(1, 1, len);
          beam.lookAt(this.tmpVecB);
          this.effectsGroup.add(beam);
        }

        const flash = new THREE.Mesh(this.voxelUnitGeo, this.gunFlashMat);
        flash.position.set(ev.x, 1.35, ev.z);
        flash.scale.setScalar((1 - t * 0.5) * 0.28);
        this.effectsGroup.add(flash);
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
        if (!this.stampedBloodEvents.has(evKey)) {
          this.stampedBloodEvents.add(evKey);
          if (this.stampedBloodEvents.size > 400) this.stampedBloodEvents.clear();
          this.stampBloodStain(ev.x, ev.z);
        }
        // 10 dark-crimson ballistic voxel blood droplets bursting on impact (ZERO neon red rings!)
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
          const py = Math.max(0.08, 1.15 + vy * ageSec - 5.4 * ageSec * ageSec);
          const drop = new THREE.Mesh(
            this.dropletGeo,
            b % 2 === 0 ? this.bloodDropletDarkMat : this.bloodDropletMidMat
          );
          drop.position.set(px, py, pz);
          const s = Math.max(0.45, 1.25 - t * 0.65);
          drop.scale.setScalar(s);
          this.effectsGroup.add(drop);
        }
      }
    }
  }

  private addWorldBar(
    x: number,
    y: number,
    z: number,
    width: number,
    pct: number,
    fillMat: THREE.MeshBasicMaterial
  ): void {
    const bg = new THREE.Mesh(this.barUnitGeo, this.barBgMat);
    bg.position.set(x, y, z);
    bg.scale.set(width, 1, 1);

    const fillW = Math.max(0.05, width * pct);
    const fill = new THREE.Mesh(this.barUnitGeo, fillMat);
    fill.position.set(x - (width - fillW) * 0.5, y, z);
    fill.scale.set(fillW, 1.15, 1.15);
    this.worldBarsGroup.add(bg, fill);
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
