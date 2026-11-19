import * as THREE from 'three';
import { AgentRenderer } from './agentRenderer';
import { SoundEngine } from './audio';
import { CameraController } from './camera';
import { CityRenderer } from './cityRenderer';
import { OutbreakSimulation } from './simulation';
import { ScenarioConfig } from './types';
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
  private mouseDownPos = { x: 0, y: 0 };
  private textureStudio: VoxelTextureStudio;
  private flashlightRig!: THREE.Group;
  private flashlightSpot!: THREE.SpotLight;
  private wasFirstPerson = false;

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.textureStudio = new VoxelTextureStudio();
    this.sound = new SoundEngine();
    this.sim = new OutbreakSimulation(DEFAULT_CONFIG);
    this.cityRenderer = new CityRenderer(this.scene, this.sim.city, this.textureStudio);
    this.agentRenderer = new AgentRenderer(this.scene, this.textureStudio);
    this.camController = new CameraController(this.camera, this.renderer.domElement);
    this.camController.setWorldBounds(this.sim.city.cityHalfX, this.sim.city.cityHalfZ);
    this.initFirstPersonFlashlight();

    this.sim.onSound = (type, x, z) => {
      const cx = this.camController.isFirstPerson ? this.camera.position.x : this.camController.target.x;
      const cz = this.camController.isFirstPerson ? this.camera.position.z : this.camController.target.z;
      const dist = this.camController.isFirstPerson ? 26 : this.camController.distance;
      if (type === 'gunshot') {
        this.sound.playGunshot(x, z, cx, cz, dist, false);
      } else if (type === 'swat_shot') {
        this.sound.playGunshot(x, z, cx, cz, dist, true);
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

  public resetSimulation(cfg: ScenarioConfig): void {
    this.agentRenderer.clearAll();
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
    const beamMat = this.textureStudio.createVolumetricConeMaterial(0xffe9a6, 0.42);
    const beamCone = new THREE.Mesh(beamGeo, beamMat);
    beamCone.position.set(0, 0, -0.24);

    this.flashlightRig.add(arm, hand, barrel, gripBand, powerBtn, bezel, frontRim, beamCone);
    this.flashlightRig.visible = false;
    this.camera.add(this.flashlightRig);

    this.flashlightSpot = new THREE.SpotLight(0xfff2cc, 78, 76, Math.PI / 4.0, 0.68, 0.95);
    this.flashlightSpot.position.set(0.28, -0.20, -0.66);
    const targetObj = new THREE.Object3D();
    targetObj.position.set(0, -0.22, -20);
    this.camera.add(targetObj);
    this.flashlightSpot.target = targetObj;
    this.flashlightSpot.visible = false;
    this.camera.add(this.flashlightSpot);
  }

  private bindViewportInteractions(): void {
    const dom = this.renderer.domElement;

    dom.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDownPos = { x: e.clientX, y: e.clientY };
      }
    });

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

  private handleViewportHover(clientX: number, clientY: number): void {
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
    if (this.sim.firstPerson.active) return;

    const hit = this.getGroundIntersection(clientX, clientY);
    if (!hit) return;

    const tool = this.ui.activeTool;

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
  }

  private animate(now: number): void {
    requestAnimationFrame((t) => this.animate(t));

    const rawDt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    if (!this.ui.isPaused) {
      const substeps = this.sim.firstPerson.active ? 1 : this.ui.simSpeed;
      for (let s = 0; s < substeps; s++) {
        this.sim.step(rawDt);
      }
    }

    const isFP = this.sim.firstPerson.active;
    if (isFP !== this.wasFirstPerson) {
      this.wasFirstPerson = isFP;
      this.camera.fov = isFP ? 62 : 46;
      this.camera.near = isFP ? 0.15 : 0.25;
      this.camera.updateProjectionMatrix();
      this.flashlightRig.visible = isFP;
      this.flashlightSpot.visible = isFP;
    }

    if (isFP) {
      let moveForward = 0;
      let moveRight = 0;
      if (this.camController.isKeyDown('w') || this.camController.isKeyDown('arrowup')) moveForward += 1;
      if (this.camController.isKeyDown('s') || this.camController.isKeyDown('arrowdown')) moveForward -= 1;
      if (this.camController.isKeyDown('d')) moveRight += 1;
      if (this.camController.isKeyDown('a')) moveRight -= 1;
      const wantSprint = this.camController.isKeyDown('shift');
      const eDown = this.camController.isKeyDown('e');
      const interactPressed = eDown && !this.prevFpInteractDown;
      this.prevFpInteractDown = eDown;

      const player = !this.ui.isPaused
        ? this.sim.updateFirstPersonPlayer(
            rawDt,
            moveForward,
            moveRight,
            wantSprint,
            interactPressed,
            this.camController.fpYaw,
            this.camController.fpPitch
          )
        : this.sim.getAgentById(this.sim.firstPerson.playerId);

      const px = player ? player.x : this.camera.position.x;
      const pz = player ? player.z : this.camera.position.z;
      const isMoving =
        !this.ui.isPaused &&
        !!player &&
        player.isAlive &&
        !player.isEvacuated &&
        (moveForward !== 0 || moveRight !== 0);
      const sprinting = isMoving && wantSprint && this.sim.firstPerson.stamina > 2;
      this.camController.updateFirstPerson(px, pz, rawDt, isMoving, sprinting, this.sim.simTime);

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
      this.prevFpInteractDown = false;
      const followedAgent = this.sim.getAgentById(this.sim.selectedAgentId);
      const hotspot = this.camController.autoDirectorMode ? this.sim.getHotspotPosition() : null;
      this.camController.update(rawDt, followedAgent, hotspot);
    }

    const hiddenId = isFP ? this.sim.firstPerson.playerId : null;
    this.agentRenderer.syncAgents(this.sim.agents, this.sim.selectedAgentId, this.sim.simTime, hiddenId, isFP);
    this.agentRenderer.syncVehicles(this.sim.vehicles, this.sim.simTime);
    this.cityRenderer.syncDefenseAndTrain(
      this.sim.defenseWalls,
      this.sim.blastGates,
      this.sim.expressTrain,
      this.sim.simTime
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
      this.camera.position.z
    );

    this.renderer.render(this.scene, this.camera);

    this.uiUpdateAccumulator += rawDt;
    if (this.uiUpdateAccumulator >= 0.2) {
      this.uiUpdateAccumulator = 0;
      this.ui.refreshUI();
    }
  }
}

const app = new ProjectOutbreakApp();
(window as unknown as { __OUTBREAK__: ProjectOutbreakApp }).__OUTBREAK__ = app;
