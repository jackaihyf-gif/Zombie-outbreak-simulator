import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { AgentRenderer } from './agentRenderer';
import { SoundEngine } from './audio';
import { CameraController } from './camera';
import { CityRenderer } from './cityRenderer';
import { KTX_PLATFORM_Y, KTX_SURFACES } from './ktxTerminal';
import { WALL_DECK_REAR_TRIM, WALL_DECK_RISE, wallDeckFrontZ, wallDeckSpan } from './perimeter';
import { OutbreakSimulation } from './simulation';
import { PlayerSpawnPoint, PlayerWeapon, ScenarioConfig } from './types';
import { TRAIN_WIDTH } from './trainLayout';
import { PLAYER_WEAPONS } from './playerLoadouts';
import { UIController } from './ui';
import { VoxelTextureStudio } from './voxelTextures';

const DEFAULT_CONFIG: ScenarioConfig = {
  id: 'wwz_busan',
  mapId: 'citadel_express',
  seed: 'CITADEL-2026',
  population: 600,
  incubationSeconds: 2.8,
  initialPolice: 22,
  initialInfected: 18,
  dispatchDelaySeconds: 2,
  allowPlayerIntervention: true,
  enableWaves: true,
  fastStrain: true
};

interface WeaponViewModel {
  root: THREE.Group;
  muzzle: THREE.Group;
  flash: THREE.Group;
  action: THREE.Group;
  magazine: THREE.Group;
}

class ProjectOutbreakApp {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public sound: SoundEngine;
  public sim: OutbreakSimulation;
  public cityRenderer: CityRenderer;
  public agentRenderer: AgentRenderer;
  public camController: CameraController;
  public ui: UIController;

  private raycaster = new THREE.Raycaster();
  private mouseNDC = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.2);
  private hoverTooltipEl = document.getElementById('hover-tooltip')!;

  private lastFrameTime = performance.now();
  private uiUpdateAccumulator = 0;
  private fpsCounterEl = document.getElementById('fps-counter');
  private fpsFrames = 0;
  private fpsAccum = 0;
  private mouseDownPos = { x: 0, y: 0 };
  private textureStudio: VoxelTextureStudio;
  private flashlightRig!: THREE.Group;
  private flashlightSpot!: THREE.SpotLight;
  private wasFirstPerson = false;
  private fireHeld = false;
  private firePressed = false;
  private weaponModels = new Map<PlayerWeapon, WeaponViewModel>();
  private muzzleWorld = new THREE.Vector3();
  private missionMarkers: THREE.Mesh[] = [];
  private spawnMarker = new THREE.Group();
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;

  constructor() {
    const container = document.getElementById('canvas-container')!;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      46,
      window.innerWidth / window.innerHeight,
      0.2,
      1500
    );
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.applyOptimalPixelRatio(DEFAULT_CONFIG.population);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.textureStudio = new VoxelTextureStudio();
    this.sound = new SoundEngine();
    this.sim = new OutbreakSimulation(DEFAULT_CONFIG);
    this.cityRenderer = new CityRenderer(this.scene, this.sim.city, this.textureStudio);
    this.cityRenderer.initEnvironment(this.renderer);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2)),
      0.36,
      0.34,
      1.05
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.applyOptimalPixelRatio(DEFAULT_CONFIG.population);
    this.agentRenderer = new AgentRenderer(this.scene, this.textureStudio);
    this.camController = new CameraController(this.camera, this.renderer.domElement);
    this.camController.setWorldBounds(this.sim.city.cityHalfX, this.sim.city.cityHalfZ);
    this.initFirstPersonFlashlight();
    this.initFirstPersonWeapons();
    const spawnMaterial = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
    const spawnRing = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.085, 8, 36), spawnMaterial);
    spawnRing.rotation.x = Math.PI / 2;
    const spawnPointer = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.95, 8), spawnMaterial);
    spawnPointer.position.y = 1.15;
    spawnPointer.rotation.z = Math.PI;
    this.spawnMarker.add(spawnRing, spawnPointer);
    this.spawnMarker.visible = false;
    this.scene.add(this.spawnMarker);
    const markerGeometry = new THREE.OctahedronGeometry(0.18);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffca63 });
    for (let i = 0; i < 3; i++) {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.scale.y = 0.72;
      marker.visible = false;
      this.scene.add(marker);
      this.missionMarkers.push(marker);
    }

    this.sim.onSound = (type, x, z) => {
      const cx = this.camController.isFirstPerson ? this.camera.position.x : this.camController.target.x;
      const cz = this.camController.isFirstPerson ? this.camera.position.z : this.camController.target.z;
      const dist = this.camController.isFirstPerson ? 26 : this.camController.distance;
      if (type === 'gunshot') {
        this.sound.playGunshot(x, z, cx, cz, dist, false);
      } else if (type === 'swat_shot') {
        this.sound.playGunshot(x, z, cx, cz, dist, true);
      } else if (type === 'player_pistol' || type === 'player_shotgun' || type === 'player_carbine') {
        this.sound.playPlayerShot(type.slice(7) as PlayerWeapon);
      } else if (type === 'player_reload') {
        this.sound.playReload();
      } else if (type === 'radio') {
        this.sound.playRadioChirp();
      } else if (type === 'cure') {
        this.sound.playMedicCure(x, z, cx, cz, dist);
      } else if (type === 'bite') {
        this.sound.playInfectionBite(x, z, cx, cz, dist);
      } else if (type === 'siren') {
        this.sound.playAlertSiren();
      } else if (type === 'explosion') {
        this.sound.playExplosion(x, z, cx, cz, dist);
      } else if (type === 'train_horn') {
        this.sound.playTrainHorn();
      } else if (type === 'gate_slam') {
        this.sound.playGateSlam();
      } else if (type === 'window_shatter') {
        this.sound.playWindowShatter(x, z, cx, cz, dist);
      } else if (type === 'body_thud') {
        this.sound.playBodyThud(x, z, cx, cz, dist);
      } else if (type === 'door_pound') {
        this.sound.playDoorPound(x, z, cx, cz, dist);
      } else if (type === 'car_alarm') {
        this.sound.playCarAlarm(x, z, cx, cz, dist);
      }
    };

    const pz = this.sim.getAgentById(this.sim.patientZeroId);
    const overviewDist = Math.max(this.sim.city.cityHalfX, this.sim.city.cityHalfZ) * 0.92;
    if (this.sim.config.mapId === 'citadel_express') {
      this.camController.setAerialAngle(-0.74, 1.06);
      this.camController.focusOn(16, 48, 285);
      this.camController.snapToDesired();
    } else if (pz) {
      this.camController.focusOn(pz.x * 0.45, pz.z * 0.45, overviewDist);
    } else {
      this.camController.focusOn(0, 0, overviewDist);
    }

    this.ui = new UIController(
      this.sim,
      this.camController,
      this.sound,
      () => this.cityRenderer.cycleAtmosphere(),
      (newCfg: ScenarioConfig) => {
        this.resetSimulation(newCfg);
      }
    );

    this.bindViewportInteractions();
    window.addEventListener('resize', () => this.onResize());

    this.agentRenderer.syncAgents(this.sim.agents, this.sim.selectedAgentId, this.sim.simTime);
    this.agentRenderer.syncVehicles(this.sim.vehicles, this.sim.simTime);
    this.ui.refreshUI();

    requestAnimationFrame((t) => this.animate(t));
  }

  private applyOptimalPixelRatio(pop: number): void {
    const maxDpr = pop >= 1500 ? 1.25 : 1.5;
    const dpr = Math.min(window.devicePixelRatio, maxDpr);
    this.renderer.setPixelRatio(dpr);
    if (this.composer) {
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }
    if (this.bloomPass) {
      this.bloomPass.setSize(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2));
    }
  }

  public resetSimulation(cfg: ScenarioConfig): void {
    this.agentRenderer.clearAll();
    this.applyOptimalPixelRatio(cfg.population);
    this.sim.reset(cfg);
    this.cityRenderer.rebuildCity(this.sim.city);
    this.camController.setWorldBounds(this.sim.city.cityHalfX, this.sim.city.cityHalfZ);
    this.camController.followAgentMode = false;

    const overviewDist = Math.max(this.sim.city.cityHalfX, this.sim.city.cityHalfZ) * 0.92;
    const pz = this.sim.getAgentById(this.sim.patientZeroId);
    if (cfg.mapId === 'citadel_express') {
      this.camController.setAerialAngle(-0.74, 1.06);
      this.camController.focusOn(16, 48, 285);
      this.camController.snapToDesired();
    } else if (pz && cfg.mapId !== 'twin_bridges') {
      this.camController.focusOn(pz.x * 0.45, pz.z * 0.45, overviewDist);
    } else {
      this.camController.focusOn(0, 0, overviewDist);
    }

    this.agentRenderer.syncAgents(this.sim.agents, this.sim.selectedAgentId, this.sim.simTime);
    this.agentRenderer.syncVehicles(this.sim.vehicles, this.sim.simTime);
    this.ui.refreshUI();
  }

  private initFirstPersonFlashlight(): void {
    this.flashlightRig = new THREE.Group();
    this.flashlightRig.position.set(0.33, -0.25, -0.52);
    this.flashlightRig.rotation.set(0.04, 0.20, 0);

    const sleeveMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      emissive: 0x1e293b,
      emissiveIntensity: 0.45,
      roughness: 0.78
    });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xe3b38d, roughness: 0.75 });
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x263142,
      emissive: 0x111827,
      emissiveIntensity: 0.45,
      roughness: 0.42,
      metalness: 0.62
    });
    const collarMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      emissive: 0x334155,
      emissiveIntensity: 0.5,
      roughness: 0.35,
      metalness: 0.65
    });
    const switchMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.36), sleeveMat);
    arm.position.set(0.05, -0.05, 0.24);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.115, 0.12), skinMat);
    hand.position.set(0.01, -0.02, 0.04);

    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.28), metalMat);
    barrel.position.set(0, 0, -0.02);
    const gripBand = new THREE.Mesh(new THREE.BoxGeometry(0.106, 0.106, 0.08), collarMat);
    gripBand.position.set(0, 0, -0.06);
    const powerBtn = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.02, 0.045), switchMat);
    powerBtn.position.set(0, 0.056, -0.09);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.145, 0.11), collarMat);
    bezel.position.set(0, 0, -0.19);
    const frontRim = new THREE.Mesh(
      new THREE.BoxGeometry(0.135, 0.135, 0.02),
      new THREE.MeshBasicMaterial({ color: 0xfef08a })
    );
    frontRim.position.set(0, 0, -0.25);

    const beamGeo = new THREE.ConeGeometry(3.4, 18.0, 20, 1, true);
    beamGeo.translate(0, -9.0, 0);
    beamGeo.rotateX(Math.PI / 2); // Points straight forward (-Z) from apex at (0,0,0)
    const beamMat = this.textureStudio.createVolumetricConeMaterial(0xffe9a6, 0.28);
    const beamCone = new THREE.Mesh(beamGeo, beamMat);
    beamCone.position.set(0, 0, -0.24);

    this.flashlightRig.add(arm, hand, barrel, gripBand, powerBtn, bezel, frontRim, beamCone);
    this.flashlightRig.visible = false;
    this.camera.add(this.flashlightRig);

    this.flashlightSpot = new THREE.SpotLight(0xfff0c8, 22, 46, Math.PI / 4.2, 0.72, 1.45);
    this.flashlightSpot.position.set(0.28, -0.20, -0.66);
    const targetObj = new THREE.Object3D();
    targetObj.position.set(0, -0.22, -20);
    this.camera.add(targetObj);
    this.flashlightSpot.target = targetObj;
    this.flashlightSpot.visible = false;
    this.camera.add(this.flashlightSpot);
  }

  private initFirstPersonWeapons(): void {
    const steel = new THREE.MeshStandardMaterial({ color: 0x344055, emissive: 0x1c2a40, emissiveIntensity: 0.55, metalness: 0.55, roughness: 0.44 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x293238, emissive: 0x122027, emissiveIntensity: 0.7, roughness: 0.78 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x745137, emissive: 0x301d16, emissiveIntensity: 0.7, roughness: 0.76 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x405573, emissive: 0x172942, emissiveIntensity: 0.68 });
    const sight = new THREE.MeshBasicMaterial({ color: 0xc1e5d8 });
    const hot = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.6, 1.7, 0.48), toneMapped: false });
    const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 3.6, 1.55), toneMapped: false });
    for (const id of Object.keys(PLAYER_WEAPONS) as PlayerWeapon[]) {
      const root = new THREE.Group();
      const muzzle = new THREE.Group();
      const flash = new THREE.Group();
      const action = new THREE.Group();
      const magazine = new THREE.Group();
      const longGun = id !== 'pistol';
      const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, parent = root) => {
        const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        part.position.set(x, y, z);
        parent.add(part);
        return part;
      };
      const barrelEnd = longGun ? (id === 'shotgun' ? -0.65 : -0.58) : -0.28;
      const surface = id === 'shotgun' ? wood : polymer;
      box(0.14, 0.14, 0.48, 0.1, -0.13, 0.23, sleeve).rotation.y = -0.16;
      box(0.105, 0.115, 0.14, 0.01, -0.075, 0.045, polymer);
      box(0.106, 0.06, longGun ? 0.32 : 0.248, 0, -0.024, -0.068, polymer);
      box(0.047, 0.047, -barrelEnd - 0.1, 0, 0.015, (barrelEnd - 0.1) / 2, steel);
      box(0.061, 0.061, 0.045, 0, 0.015, barrelEnd + 0.018, steel);
      box(0.024, 0.035, 0.034, 0, 0.048, barrelEnd + 0.055, steel);
      box(0.011, 0.012, 0.009, 0, 0.065, barrelEnd + 0.067, sight);
      for (const x of [-0.03, 0.03]) box(0.026, 0.028, 0.034, x, 0.048, 0.035, steel);
      if (longGun) {
        box(0.115, 0.085, 0.3, 0, 0.005, -0.075, steel);
        box(0.10, 0.115, 0.20, 0, -0.05, 0.19, surface);
        box(0.12, 0.095, 0.215, 0, -0.025, -0.31, surface, action);
        box(0.13, 0.13, 0.28, -0.105, -0.115, -0.17, sleeve).rotation.y = -0.22;
        if (id === 'carbine') {
          box(0.070, 0.148, 0.112, 0, -0.089, -0.079, polymer, magazine).rotation.x = -0.21;
          box(0.080, 0.016, 0.25, 0, 0.053, -0.17, polymer);
        }
      } else {
        box(0.105, 0.062, 0.27, 0, 0.023, -0.105, steel, action);
        box(0.078, 0.08, 0.075, 0, -0.10, 0.055, polymer, magazine);
      }
      muzzle.position.set(0, 0.015, barrelEnd - 0.012);
      box(0.095, 0.095, 0.27, 0, 0, -0.105, core, flash);
      for (const angle of [0.3, 1.3, 2.35]) {
        box(0.32, 0.035, 0.22, 0, 0, -0.10, hot, flash).rotation.z = angle;
      }
      flash.visible = false;
      muzzle.add(flash);
      root.add(muzzle, action, magazine);
      root.visible = false;
      this.camera.add(root);
      this.weaponModels.set(id, { root, muzzle, flash, action, magazine });
    }
  }

  private bindViewportInteractions(): void {
    const dom = this.renderer.domElement;

    dom.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        if (!this.ui.isPickingSpawn && this.sim.firstPerson.active && this.sim.firstPerson.weapon) {
          this.fireHeld = true;
          this.firePressed = true;
        }
        this.mouseDownPos = { x: e.clientX, y: e.clientY };
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
    });
    const clearFire = () => {
      this.fireHeld = false;
      this.firePressed = false;
    };
    window.addEventListener('blur', clearFire);
    document.addEventListener('pointerlockchange', clearFire);

    dom.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || e.shiftKey || e.altKey) return;
      const moveDist = Math.hypot(
        e.clientX - this.mouseDownPos.x,
        e.clientY - this.mouseDownPos.y
      );
      if (moveDist < 6) {
        this.handleViewportClick(e.clientX, e.clientY);
      }
    });

    dom.addEventListener('mousemove', (e) => {
      this.handleViewportHover(e.clientX, e.clientY);
    });

    dom.addEventListener('mouseleave', () => {
      this.hoverTooltipEl.style.display = 'none';
      this.cityRenderer.updatePlacementPreview(this.ui.activeTool, 0, 0, false);
    });
  }

  private getGroundIntersection(clientX: number, clientY: number): THREE.Vector3 | null {
    this.mouseNDC.x = (clientX / window.innerWidth) * 2 - 1;
    this.mouseNDC.y = -(clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.mouseNDC, this.camera);
    const hit = new THREE.Vector3();
    const res = this.raycaster.ray.intersectPlane(this.groundPlane, hit);
    return res ? hit : null;
  }

  private getWallIntersection(): THREE.Vector3 | null {
    let closest: THREE.Vector3 | null = null;
    const ray = this.raycaster.ray;
    for (const wall of this.sim.defenseWalls) {
      const half = wall.thickness / 2 + 0.25;
      const hit = ray.intersectBox(
        new THREE.Box3(
          new THREE.Vector3(wall.minX, 0, wall.z - half),
          new THREE.Vector3(wall.maxX, wall.height + WALL_DECK_RISE, wall.z + half)
        ),
        new THREE.Vector3()
      );
      if (hit && (!closest || ray.origin.distanceToSquared(hit) < ray.origin.distanceToSquared(closest))) {
        closest = hit;
      }
    }
    return closest;
  }

  private pickSpawnPoint(clientX: number, clientY: number): PlayerSpawnPoint | null {
    const ground = this.getGroundIntersection(clientX, clientY);
    if (!ground) return null;
    const ray = this.raycaster.ray;
    let best: PlayerSpawnPoint = { x: ground.x, z: ground.z, y: 0 };
    let distance = ground.distanceTo(ray.origin);
    const consider = (minX: number, maxX: number, minZ: number, maxZ: number, fromY: number, toY: number, wallId?: number) => {
      const slope = (toY - fromY) / (maxZ - minZ);
      const dy = ray.direction.y - slope * ray.direction.z;
      if (Math.abs(dy) < 1e-6) return;
      const t = (fromY + slope * (ray.origin.z - minZ) - ray.origin.y) / dy;
      if (t < 0 || t >= distance) return;
      const hit = ray.at(t, new THREE.Vector3());
      if (hit.x < minX || hit.x > maxX || hit.z < minZ || hit.z > maxZ) return;
      const wall = wallId === undefined ? undefined : this.sim.defenseWalls.find((line) => line.id === wallId);
      if (wall && !wallDeckSpan(wall, this.sim.blastGates, hit.x)) return;
      best = { x: hit.x, z: hit.z, y: fromY + (hit.z - minZ) * slope, wallId };
      distance = t;
    };
    for (const wall of this.sim.defenseWalls) {
      const y = wall.height + WALL_DECK_RISE;
      consider(wall.minX, wall.maxX, wallDeckFrontZ(wall), wall.z + wall.thickness / 2 - WALL_DECK_REAR_TRIM, y, y, wall.id);
    }
    if (this.sim.layeredKtx) {
      for (const surface of KTX_SURFACES) {
        if (surface.id === 'boarding' && this.sim.expressTrain.state !== 'DOCKED') continue;
        consider(surface.minX, surface.maxX, surface.minZ, surface.maxZ, surface.fromY, surface.toY);
      }
      const train = this.sim.expressTrain;
      if (train.state === 'DOCKED') {
        consider(train.x + train.layout.rearX, train.x + train.layout.frontX,
          train.z - 1.95, train.z + TRAIN_WIDTH / 2, KTX_PLATFORM_Y, KTX_PLATFORM_Y);
      }
    }
    return this.sim.canSpawnPlayerAt(best) ? best : null;
  }

  private findClosestAgentToWorldPoint(wx: number, wz: number, maxRadius = 3.8) {
    let best = null;
    let bestDist = maxRadius;
    for (let i = 0; i < this.sim.agents.length; i++) {
      const a = this.sim.agents[i];
      if (!a.isAlive || a.isEvacuated || a.civState === 'SHELTERED') continue;
      const d = Math.hypot(a.x - wx, a.z - wz);
      if (d < bestDist) {
        bestDist = d;
        best = a;
      }
    }
    return best;
  }

  private prevFpInteractDown = false;
  private prevFpSpaceDown = false;
  private prevFpDecoyDown = false;

  private handleViewportHover(clientX: number, clientY: number): void {
    if (this.ui.isPickingSpawn) {
      this.hoverTooltipEl.style.display = 'none';
      this.cityRenderer.updatePlacementPreview('inspect', 0, 0, false);
      return;
    }
    if (this.sim.firstPerson.active) {
      this.hoverTooltipEl.style.display = 'none';
      this.cityRenderer.updatePlacementPreview('inspect', 0, 0, false);
      return;
    }

    const hit = this.getGroundIntersection(clientX, clientY);
    if (!hit) {
      this.hoverTooltipEl.style.display = 'none';
      this.cityRenderer.updatePlacementPreview(this.ui.activeTool, 0, 0, false);
      return;
    }

    this.cityRenderer.updatePlacementPreview(this.ui.activeTool, hit.x, hit.z, true);

    const agent = this.findClosestAgentToWorldPoint(hit.x, hit.z, 2.6);
    if (agent) {
      const status =
        agent.role === 'infected'
          ? `${agent.zombieVariant.toUpperCase()} (${agent.zombieState})`
          : agent.role === 'police'
          ? `${agent.isSwat ? 'SWAT' : 'POLICE'} (${agent.policeState})`
          : agent.role === 'medic'
          ? `MEDIC (${agent.medicState})`
          : agent.isIncubating
          ? `INCUBATING (${agent.incubationTimer.toFixed(1)}s)`
          : `CIVILIAN (${agent.civState})`;
      this.hoverTooltipEl.textContent = `${agent.name} • ${status}`;
      this.hoverTooltipEl.style.left = `${clientX + 14}px`;
      this.hoverTooltipEl.style.top = `${clientY + 14}px`;
      this.hoverTooltipEl.style.display = 'block';
      return;
    }

    if (this.ui.activeTool === 'inspect') {
      const gate = this.sim.findGateAtPos(hit.x, hit.z, 8.5);
      if (gate) {
        const stateText = gate.breached
          ? 'BREACHED'
          : gate.openFraction > 0 && !gate.isOpen
          ? 'CLOSING (Click to OPEN)'
          : gate.openFraction < 1 && gate.isOpen
          ? 'OPENING (Click to SEAL)'
          : gate.isOpen
          ? 'OPEN (Click to SEAL)'
          : `SEALED HP ${Math.ceil(gate.integrity)}/${gate.maxIntegrity} (Click to OPEN)`;
        this.hoverTooltipEl.textContent = `${gate.label} • ${stateText}`;
        this.hoverTooltipEl.style.left = `${clientX + 14}px`;
        this.hoverTooltipEl.style.top = `${clientY + 14}px`;
        this.hoverTooltipEl.style.display = 'block';
        return;
      }
    }

    for (const b of this.sim.city.buildings) {
      if (hit.x >= b.minX && hit.x <= b.maxX && hit.z >= b.minZ && hit.z <= b.maxZ) {
        this.hoverTooltipEl.textContent = `${b.name} (${b.district}) • Shelter: ${b.shelteredAgentIds.length}/${b.shelterCapacity}`;
        this.hoverTooltipEl.style.left = `${clientX + 14}px`;
        this.hoverTooltipEl.style.top = `${clientY + 14}px`;
        this.hoverTooltipEl.style.display = 'block';
        return;
      }
    }

    this.hoverTooltipEl.style.display = 'none';
  }

  private handleViewportClick(clientX: number, clientY: number): void {
    if (this.ui.isPickingSpawn) {
      this.ui.selectSpawnPoint(this.pickSpawnPoint(clientX, clientY));
      return;
    }
    if (this.sim.firstPerson.active) return;

    const tool = this.ui.activeTool;
    const ground = this.getGroundIntersection(clientX, clientY);
    const hit = tool === 'defend_zone' || tool === 'deploy_swat'
      ? this.getWallIntersection() ?? ground
      : ground;
    if (!hit) return;

    if (tool === 'inspect') {
      const picked = this.findClosestAgentToWorldPoint(hit.x, hit.z, 3.6);
      if (picked) {
        this.sim.selectedAgentId = picked.id;
        this.ui.refreshInspector();
        return;
      }
      const gate = this.sim.findGateAtPos(hit.x, hit.z, 8.5);
      if (gate) {
        this.sim.toggleBlastGate(gate.id);
        this.ui.refreshUI();
        return;
      }
      this.sim.selectedAgentId = null;
      this.camController.followAgentMode = false;
      this.ui.refreshInspector();
      return;
    }

    if (tool === 'deploy_police') {
      this.sim.deployPoliceSquad(hit.x, hit.z);
    } else if (tool === 'deploy_swat') {
      this.sim.deploySwatSquad(hit.x, hit.z);
    } else if (tool === 'deploy_hunters') {
      this.sim.deployHunterTeam(hit.x, hit.z);
    } else if (tool === 'deploy_medic') {
      this.sim.deployMedicSquad(hit.x, hit.z);
    } else if (tool === 'lure_flare') {
      this.sim.deployLureFlare(hit.x, hit.z);
    } else if (tool === 'frag_bomb') {
      this.sim.deployFragBomb(hit.x, hit.z);
    } else if (tool === 'roadblock') {
      this.sim.establishRoadblock(hit.x, hit.z);
    } else if (tool === 'defend_zone') {
      this.sim.orderDefendZone(hit.x, hit.z);
    } else if (tool === 'evac_zone') {
      this.sim.designateEvacZone(hit.x, hit.z);
    } else if (tool === 'priority_sector') {
      this.sim.prioritizeSector(hit.x, hit.z);
    }

    this.ui.refreshUI();
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.applyOptimalPixelRatio(this.sim.config.population);
  }

  private animate(now: number): void {
    requestAnimationFrame((t) => this.animate(t));

    const elapsedSec = Math.max(0.0001, (now - this.lastFrameTime) / 1000);
    const rawDt = Math.min(0.05, elapsedSec);
    this.lastFrameTime = now;

    this.fpsFrames++;
    this.fpsAccum += elapsedSec;
    if (this.fpsAccum >= 0.45) {
      if (this.fpsCounterEl) {
        const fps = Math.max(1, Math.round(this.fpsFrames / this.fpsAccum));
        this.fpsCounterEl.textContent = `${fps} FPS`;
        this.fpsCounterEl.style.color = fps >= 50 ? '#4ade80' : fps >= 30 ? '#fbbf24' : '#ef4444';
      }
      this.fpsFrames = 0;
      this.fpsAccum = 0;
    }

    if (!this.ui.isPaused) {
      const substeps = this.sim.firstPerson.active ? 1 : this.ui.simSpeed;
      const budgetStart = performance.now();
      for (let s = 0; s < substeps; s++) {
        this.sim.step(rawDt);
        if (performance.now() - budgetStart > 13) break;
      }
    }

    const isFP = this.sim.firstPerson.active && !this.ui.isPickingSpawn;
    if (isFP !== this.wasFirstPerson) {
      this.wasFirstPerson = isFP;
      this.camera.fov = isFP ? 62 : 46;
      this.camera.near = isFP ? 0.15 : 0.25;
      this.camera.updateProjectionMatrix();
      this.flashlightRig.visible = isFP;
      this.flashlightSpot.visible = isFP;
    }

    if (isFP) {
      if (!this.ui.isPaused) this.camController.updateFirstPersonAim(rawDt);
      let moveForward = 0;
      let moveRight = 0;
      if (this.camController.isKeyDown('w') || this.camController.isKeyDown('arrowup')) moveForward += 1;
      if (this.camController.isKeyDown('s') || this.camController.isKeyDown('arrowdown')) moveForward -= 1;
      if (this.camController.isKeyDown('d')) moveRight += 1;
      if (this.camController.isKeyDown('a')) moveRight -= 1;
      const wantSprint = this.camController.isKeyDown('shift');
      const eDown = this.camController.isKeyDown('e');
      const interactPressed = this.camController.consumeKeyPress('e') || (eDown && !this.prevFpInteractDown);
      this.prevFpInteractDown = eDown;
      const spaceDown = this.camController.isKeyDown(' ');
      const spacePressed = this.camController.consumeKeyPress(' ') || (spaceDown && !this.prevFpSpaceDown);
      this.prevFpSpaceDown = spaceDown;
      const qDown = this.camController.isKeyDown('q');
      const decoyPressed = this.camController.consumeKeyPress('q') || (qDown && !this.prevFpDecoyDown);
      this.prevFpDecoyDown = qDown;
      const keyboardFire = this.camController.consumeKeyPress('j') || this.camController.isKeyDown('j');

      const player = !this.ui.isPaused
        ? this.sim.updateFirstPersonPlayer(
            rawDt,
            moveForward,
            moveRight,
            wantSprint,
            interactPressed,
            spacePressed,
            decoyPressed,
            this.camController.fpYaw,
            this.camController.fpPitch,
            {
              fire: this.fireHeld || this.firePressed || keyboardFire,
              reload: this.camController.consumeKeyPress('r'),
              requestMission: this.camController.consumeKeyPress('m')
            }
          )
        : this.sim.getAgentById(this.sim.firstPerson.playerId);
      this.firePressed = false;
      if (this.sim.firstPerson.outcome !== 'PLAYING' && document.pointerLockElement === this.renderer.domElement) {
        document.exitPointerLock();
      }

      const px = player ? player.x : this.camera.position.x;
      const pz = player ? player.z : this.camera.position.z;
      const isMoving =
        !this.ui.isPaused &&
        !!player &&
        player.isAlive &&
        !player.isEvacuated &&
        this.sim.firstPerson.wallLadder !== 'climbing' &&
        (moveForward !== 0 || moveRight !== 0);
      const sprinting = isMoving && wantSprint && (this.sim.firstPerson.adrenalineTimer > 0 || this.sim.firstPerson.stamina > 2);
      this.camController.updateFirstPerson(
        px,
        pz,
        rawDt,
        isMoving,
        sprinting,
        this.sim.simTime,
        (player?.climbY ?? 0) + (player?.fallY ?? 0) + this.sim.firstPerson.vaultY,
        this.sim.firstPerson.vaultRoll
      );

      // Sway handheld voxel flashlight dynamically with sprint/breathing
      const swayRate = sprinting ? 14 : isMoving ? 9 : 2;
      const swayAmp = sprinting ? 0.022 : isMoving ? 0.011 : 0.003;
      this.flashlightRig.position.set(
        0.33 + Math.cos(this.sim.simTime * swayRate * 0.5) * swayAmp,
        -0.25 + Math.sin(this.sim.simTime * swayRate) * swayAmp,
        -0.52
      );
      this.flashlightRig.rotation.set(
        0.05 + Math.sin(this.sim.simTime * swayRate) * swayAmp * 1.4,
        0.22 + Math.cos(this.sim.simTime * swayRate * 0.5) * swayAmp,
        0
      );

      if (!this.ui.isPaused) {
        this.sound.updateFirstPersonHorrorAudio(rawDt, this.sim.firstPerson.nearestZombieDist);
      }
    } else {
      this.fireHeld = false;
      this.firePressed = false;
      this.prevFpInteractDown = false;
      this.prevFpSpaceDown = false;
      this.prevFpDecoyDown = false;
      const followedAgent = this.sim.getAgentById(this.sim.selectedAgentId);
      const hotspot = this.camController.autoDirectorMode ? this.sim.getHotspotPosition() : null;
      this.camController.update(rawDt, followedAgent, hotspot);
    }

    const hiddenId = isFP ? this.sim.firstPerson.playerId : null;
    const weapon = isFP ? this.sim.firstPerson.weapon : null;
    this.flashlightRig.visible = isFP && !weapon;
    this.syncWeaponView();
    this.agentRenderer.syncAgents(this.sim.agents, this.sim.selectedAgentId, this.sim.simTime, hiddenId, isFP);
    this.agentRenderer.syncVehicles(this.sim.vehicles, this.sim.simTime);
    this.cityRenderer.syncDefenseAndTrain(
      this.sim.defenseWalls,
      this.sim.blastGates,
      this.sim.expressTrain,
      this.sim.simTime,
      this.sim.layeredKtx,
      this.sim.ktxGates
    );
    this.cityRenderer.syncTacticalAndEffects(
      this.sim.city.buildings,
      this.sim.roadblocks,
      this.sim.blastGates,
      this.sim.evacZones,
      this.sim.holdZones,
      this.sim.lureFlares,
      this.sim.vehicles,
      this.sim.prioritySector,
      this.sim.effects,
      this.sim.simTime,
      isFP,
      this.camera.position.x,
      this.camera.position.z,
      this.sim.interiorDoors,
      this.sim.brokenWindows,
      this.sim.getActiveAlarmObstacleIds(),
      this.sim.firstPerson.insideBuildingId,
      this.sim.gridFlickerTimer,
      this.sim.blackoutMaxZ,
      this.sim.supplyPickups,
      this.sim.firstPerson.insideTrainCar,
      this.sim.ammoCaches,
      this.camera.position.y,
      this.sim.layeredKtx ? this.sim.ktxGates : undefined
    );

    this.syncMissionMarkers();
    const spawnPoint = this.ui.selectedSpawnPoint;
    this.spawnMarker.visible = !!spawnPoint;
    if (spawnPoint) this.spawnMarker.position.set(spawnPoint.x, spawnPoint.y + 0.14, spawnPoint.z);
    this.composer.render();

    this.uiUpdateAccumulator += rawDt;
    if (this.uiUpdateAccumulator >= 0.2) {
      this.uiUpdateAccumulator = 0;
      this.ui.refreshUI();
    }
  }

  private syncMissionMarkers(): void {
    const fp = this.sim.firstPerson;
    const targets = !this.ui.isPickingSpawn && fp.active && fp.outcome === 'PLAYING' ? fp.mission?.targetIds : null;
    this.missionMarkers.forEach((marker, i) => {
      const target = this.sim.getAgentById(targets?.[i] ?? null);
      marker.visible = Boolean(target?.isAlive);
      if (!target?.isAlive) return;
      marker.position.set(target.x, target.climbY + target.fallY + (target.zombieVariant === 'brute' ? 3.05 : 2.43), target.z);
      marker.rotation.y = this.sim.simTime * 1.6;
    });
  }

  private syncWeaponView(): void {
    const fp = this.sim.firstPerson;
    const weapon = !this.ui.isPickingSpawn && fp.active && fp.outcome === 'PLAYING' ? fp.weapon : null;
    this.ui.updateAimFeedback((weapon?.hitTimer ?? 0) > 0);
    this.flashlightSpot.intensity = 22;
    for (const [id, model] of this.weaponModels) {
      model.root.visible = weapon?.id === id;
      if (!weapon || !model.root.visible) continue;
      const tuning = PLAYER_WEAPONS[id];
      const age = weapon.shots > 0 ? tuning.interval - weapon.cooldown : Infinity;
      const recoil = Math.max(0, 1 - age / (id === 'shotgun' ? 0.22 : 0.105)) ** 2;
      const reload = weapon.reloadTimer > 0 ? 1 - weapon.reloadTimer / tuning.reload : 0;
      const dip = Math.sin(Math.PI * reload);
      const { x, y, z } = this.flashlightRig.position;
      model.root.position.set(x - 0.095, y - 0.025 - dip * 0.20, z - 0.09 + recoil * tuning.kick * 0.65);
      model.root.rotation.set(recoil * tuning.kick - dip * 0.5, 0.15 - dip * 0.3, -dip * 0.28);
      model.action.position.z = id === 'shotgun'
        ? Math.max(0, 1 - Math.abs(age - 0.23) / 0.13) * 0.13
        : recoil * (id === 'pistol' ? 0.065 : 0.028);
      model.magazine.position.y = -Math.max(0, 1 - Math.abs(reload - 0.48) / 0.31) * 0.25;
      model.flash.visible = age < 0.055;
      if (model.flash.visible) {
        const envelope = (1 - age / 0.055) * tuning.flash;
        model.flash.scale.setScalar(0.45 + envelope);
        model.flash.rotation.z = weapon.shots * 2.4;
        model.muzzle.getWorldPosition(this.muzzleWorld);
        this.flashlightSpot.intensity += envelope * 14;
        if (age === 0) {
          for (const shot of this.sim.effects) {
            if (shot.type !== 'player_shot' || shot.age !== 0 ||
                shot.targetX === undefined || shot.targetY === undefined || shot.targetZ === undefined) continue;
            if (Math.hypot(shot.targetX - shot.x, shot.targetY - (shot.y ?? 1.68), shot.targetZ - shot.z) < 1.3) continue;
            shot.x = this.muzzleWorld.x;
            shot.y = this.muzzleWorld.y;
            shot.z = this.muzzleWorld.z;
          }
        }
      }
    }
  }
}

const app = new ProjectOutbreakApp();
(window as unknown as { __OUTBREAK__: ProjectOutbreakApp }).__OUTBREAK__ = app;
