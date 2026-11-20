import { SoundEngine } from './audio';
import { CameraController } from './camera';
import { AtmosphereStage } from './cityRenderer';
import { OutbreakSimulation } from './simulation';
import { MapId, ScenarioConfig, ScenarioId, TacticalTool } from './types';

export class UIController {
  public activeTool: TacticalTool = 'inspect';
  public isPaused = false;
  public simSpeed = 1;

  private sim: OutbreakSimulation;
  private cam: CameraController;
  private sound: SoundEngine;
  private onCycleAtmosphere: () => AtmosphereStage;
  private onResetScenario: (cfg: ScenarioConfig) => void;

  // Top Bar Elements
  private clockEl = document.getElementById('sim-clock')!;
  private statusBadgeEl = document.getElementById('outbreak-status-badge')!;
  private statHealthyEl = document.getElementById('stat-healthy')!;
  private statInfectedEl = document.getElementById('stat-infected')!;
  private statPoliceEl = document.getElementById('stat-police')!;
  private statCuredEl = document.getElementById('stat-cured')!;
  private statShelteredEl = document.getElementById('stat-sheltered')!;
  private statEvacuatedEl = document.getElementById('stat-evacuated')!;
  private statDeceasedEl = document.getElementById('stat-deceased')!;
  private cpDisplayEl = document.getElementById('cp-display')!;
  private btnAutoCam = document.getElementById('btn-auto-cam')!;
  private btnLighting = document.getElementById('btn-lighting')!;
  private btnFpsMode = document.getElementById('btn-fps-mode')!;

  // First-Person Survivor HUD
  private hudLayerEl = document.getElementById('hud-layer')!;
  private fpsHudEl = document.getElementById('fps-hud')!;
  private fpsDangerVignetteEl = document.getElementById('fps-danger-vignette')!;
  private fpsObjectiveEl = document.getElementById('fps-objective')!;
  private fpsTrainStatusEl = document.getElementById('fps-train-status')!;
  private fpsInteractPromptEl = document.getElementById('fps-interact-prompt')!;
  private fpsControlsHintEl = document.getElementById('fps-controls-hint')!;
  private fpsHpTextEl = document.getElementById('fps-hp-text')!;
  private fpsHpFillEl = document.getElementById('fps-hp-fill')!;
  private fpsStamTextEl = document.getElementById('fps-stam-text')!;
  private fpsStamFillEl = document.getElementById('fps-stam-fill')!;
  private fpsOutcomeCardEl = document.getElementById('fps-outcome-card')!;
  private fpsOutcomeTitleEl = document.getElementById('fps-outcome-title')!;
  private fpsOutcomeDescEl = document.getElementById('fps-outcome-desc')!;
  private defenseLinesStatusEl = document.getElementById('defense-lines-status')!;

  // Alert Toast
  private alertToastEl = document.getElementById('alert-toast')!;
  private lastShownAlertTime = 0;

  // Tabbed Drawer Elements
  private drawerBodyEl = document.getElementById('drawer-body')!;
  private chartCanvas = document.getElementById('chart-canvas') as HTMLCanvasElement;
  private chartCtx = this.chartCanvas.getContext('2d')!;
  private chartTimeLabel = document.getElementById('chart-time-label')!;

  private minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
  private minimapCtx = this.minimapCanvas.getContext('2d')!;
  private prioritySectorLabel = document.getElementById('priority-sector-label')!;

  private eventLogListEl = document.getElementById('event-log-list')!;
  private activeReportsCountEl = document.getElementById('active-reports-count')!;
  private lastRenderedEventId = -1;

  // Contextual Inspector Popup
  private inspectorPanelEl = document.getElementById('inspector-panel')!;
  private inspNameEl = document.getElementById('insp-name')!;
  private inspStateEl = document.getElementById('insp-state')!;
  private inspDistrictEl = document.getElementById('insp-district')!;
  private inspTaskEl = document.getElementById('insp-task')!;
  private inspHealthBarEl = document.getElementById('insp-health-bar')!;
  private inspStoryEl = document.getElementById('insp-story')!;
  private btnFollowAgent = document.getElementById('btn-follow-agent')!;

  // Modal Elements
  private modalEl = document.getElementById('scenario-modal')!;
  private inputSeedEl = document.getElementById('input-seed') as HTMLInputElement;
  private selectPopEl = document.getElementById('select-population') as HTMLSelectElement;
  private selectIncubEl = document.getElementById('select-incubation') as HTMLSelectElement;
  private selectedModalMap: MapId = 'citadel_express';
  private selectedModalScenario: ScenarioId = 'wwz_busan';

  private infectedCycleIndex = 0;

  constructor(
    sim: OutbreakSimulation,
    cam: CameraController,
    sound: SoundEngine,
    onCycleAtmosphere: () => AtmosphereStage,
    onResetScenario: (cfg: ScenarioConfig) => void
  ) {
    this.sim = sim;
    this.cam = cam;
    this.sound = sound;
    this.onCycleAtmosphere = onCycleAtmosphere;
    this.onResetScenario = onResetScenario;

    this.bindEvents();
    this.refreshUI();
  }

  private bindEvents(): void {
    const btnPlayPause = document.getElementById('btn-play-pause')!;
    const btnSpeed1 = document.getElementById('btn-speed-1')!;
    const btnSpeed2 = document.getElementById('btn-speed-2')!;
    const btnSpeed5 = document.getElementById('btn-speed-5')!;

    btnPlayPause.addEventListener('click', () => {
      this.togglePause();
    });

    const setSpeed = (spd: number) => {
      this.simSpeed = spd;
      btnSpeed1.classList.toggle('active', spd === 1);
      btnSpeed2.classList.toggle('active', spd === 2);
      btnSpeed5.classList.toggle('active', spd === 5);
    };

    btnSpeed1.addEventListener('click', () => setSpeed(1));
    btnSpeed2.addEventListener('click', () => setSpeed(2));
    btnSpeed5.addEventListener('click', () => setSpeed(5));

    this.btnFpsMode.addEventListener('click', () => {
      this.toggleFirstPersonMode();
    });
    document.getElementById('btn-fps-ktx')?.addEventListener('click', () => {
      this.sim.selectedAgentId = null;
      this.enterFirstPersonMode('ktx_terminal');
    });
    document.getElementById('btn-exit-fps')!.addEventListener('click', () => {
      this.exitFirstPersonMode();
    });
    document.getElementById('btn-fps-commander')!.addEventListener('click', () => {
      this.exitFirstPersonMode();
    });
    document.getElementById('btn-fps-respawn')!.addEventListener('click', () => {
      this.enterFirstPersonMode();
    });

    this.btnAutoCam.addEventListener('click', () => {
      const on = this.cam.toggleAutoDirector();
      this.btnAutoCam.classList.toggle('active', on);
    });

    const btnAudio = document.getElementById('btn-audio')!;
    btnAudio.addEventListener('click', () => {
      const on = this.sound.toggle();
      btnAudio.textContent = on ? '🔊' : '🔇';
      btnAudio.classList.toggle('active', on);
    });

    this.btnLighting.addEventListener('click', () => {
      const stage = this.onCycleAtmosphere();
      this.btnLighting.textContent = stage === 'dusk' ? '🌆' : stage === 'night' ? '🌙' : '☀';
    });

    document.getElementById('btn-reset')!.addEventListener('click', () => {
      if (this.sim.firstPerson.active) this.exitFirstPersonMode();
      this.onResetScenario(this.sim.config);
      this.lastRenderedEventId = -1;
      this.eventLogListEl.innerHTML = '';
      this.refreshUI();
    });

    document.getElementById('btn-open-scenarios')!.addEventListener('click', () => {
      this.modalEl.classList.remove('hidden');
    });

    document.getElementById('btn-close-modal')!.addEventListener('click', () => {
      this.modalEl.classList.add('hidden');
    });

    // Drawer Tabs & Collapse
    const tabBtns = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab!;
        tabBtns.forEach((b) => b.classList.toggle('active', b === btn));
        document.getElementById('tab-radar')!.classList.toggle('active', tab === 'radar');
        document.getElementById('tab-trend')!.classList.toggle('active', tab === 'trend');
        document.getElementById('tab-log')!.classList.toggle('active', tab === 'log');
        this.drawerBodyEl.classList.remove('collapsed');
      });
    });

    const btnCollapse = document.getElementById('btn-collapse-drawer')!;
    btnCollapse.addEventListener('click', () => {
      const collapsed = this.drawerBodyEl.classList.toggle('collapsed');
      btnCollapse.textContent = collapsed ? '▸' : '▾';
    });

    // Tactical Tool Buttons
    const toolButtons = document.querySelectorAll<HTMLButtonElement>('.tool-btn');
    toolButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool as TacticalTool;
        this.selectTool(tool);
      });
    });

    // Keyboard shortcuts (1-9,0 for tools, F for Escape POV, Space for pause)
    window.addEventListener('keydown', (e) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        this.toggleFirstPersonMode();
        return;
      }
      if (e.key === 'Escape' && this.sim.firstPerson.active) {
        this.exitFirstPersonMode();
        return;
      }
      if (this.sim.firstPerson.active) return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePause();
      } else if (e.key === '1') this.selectTool('inspect');
      else if (e.key === '2') this.selectTool('deploy_police');
      else if (e.key === '3') this.selectTool('deploy_swat');
      else if (e.key === '4') this.selectTool('deploy_medic');
      else if (e.key === '5') this.selectTool('lure_flare');
      else if (e.key === '6') this.selectTool('frag_bomb');
      else if (e.key === '7') this.selectTool('roadblock');
      else if (e.key === '8') this.selectTool('defend_zone');
      else if (e.key === '9') this.selectTool('evac_zone');
      else if (e.key === '0') this.selectTool('priority_sector');
      else if (e.key === 'Escape') {
        this.sim.selectedAgentId = null;
        this.cam.followAgentMode = false;
        this.selectTool('inspect');
        this.refreshInspector();
      }
    });

    // Inspector Buttons
    this.btnFollowAgent.addEventListener('click', () => {
      if (this.sim.selectedAgentId !== null) {
        this.cam.followAgentMode = !this.cam.followAgentMode;
        this.btnFollowAgent.classList.toggle('active', this.cam.followAgentMode);
      }
    });

    document.getElementById('btn-close-inspector')!.addEventListener('click', () => {
      this.sim.selectedAgentId = null;
      this.cam.followAgentMode = false;
      this.refreshInspector();
    });

    document.getElementById('btn-find-infected')!.addEventListener('click', () => {
      const infectedList = this.sim.agents.filter(
        (a) => a.isAlive && (a.role === 'infected' || a.isIncubating)
      );
      if (infectedList.length > 0) {
        const target = infectedList[this.infectedCycleIndex % infectedList.length];
        this.infectedCycleIndex++;
        this.sim.selectedAgentId = target.id;
        this.cam.autoDirectorMode = false;
        this.cam.focusOn(target.x, target.z, 36);
        this.refreshInspector();
      }
    });

    // Minimap Click-to-Pan (dynamic map span)
    let isDraggingMinimap = false;
    const panFromMinimap = (e: MouseEvent) => {
      const rect = this.minimapCanvas.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const nz = (e.clientY - rect.top) / rect.height;
      const maxHalf = Math.max(this.sim.city.cityHalfX, this.sim.city.cityHalfZ);
      const span = maxHalf * 2.15;
      const worldX = (nx - 0.5) * span;
      const worldZ = (nz - 0.5) * span;
      this.cam.followAgentMode = false;
      this.cam.autoDirectorMode = false;
      this.cam.focusOn(worldX, worldZ);
    };

    this.minimapCanvas.addEventListener('mousedown', (e) => {
      isDraggingMinimap = true;
      panFromMinimap(e);
    });
    window.addEventListener('mousemove', (e) => {
      if (isDraggingMinimap) panFromMinimap(e);
    });
    window.addEventListener('mouseup', () => {
      isDraggingMinimap = false;
    });

    // Modal Map Cards
    const mapCards = document.querySelectorAll<HTMLElement>('.map-card');
    mapCards.forEach((card) => {
      card.addEventListener('click', () => {
        mapCards.forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedModalMap = card.dataset.map as MapId;
      });
    });

    // Modal Scenario Cards
    const cards = document.querySelectorAll<HTMLElement>('.scenario-card');
    cards.forEach((card) => {
      card.addEventListener('click', () => {
        cards.forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedModalScenario = card.dataset.scenario as ScenarioId;
      });
    });

    document.getElementById('btn-random-seed')!.addEventListener('click', () => {
      const prefixes = ['METRO', 'OUTBREAK', 'APEX', 'CRIMSON', 'OMEGA', 'VANGUARD'];
      const p = prefixes[Math.floor(Math.random() * prefixes.length)];
      const num = Math.floor(1000 + Math.random() * 9000);
      this.inputSeedEl.value = `${p}-${num}`;
    });

    document.getElementById('btn-launch-scenario')!.addEventListener('click', () => {
      if (this.sim.firstPerson.active) this.exitFirstPersonMode();
      const id = this.selectedModalScenario;
      const mapId = this.selectedModalMap;
      const seed = this.inputSeedEl.value.trim() || 'CITADEL-2026';
      const population = parseInt(this.selectPopEl.value, 10) || 600;
      const selectedIncub = parseInt(this.selectIncubEl.value, 10) || 7;

      const isFastStrain = id === 'super_spreader' || id === 'wwz_busan';
      const newConfig: ScenarioConfig = {
        id,
        mapId,
        seed,
        population,
        incubationSeconds:
          id === 'super_spreader'
            ? 2.5
            : id === 'wwz_busan'
            ? Math.min(selectedIncub, 2.8)
            : selectedIncub,
        initialPolice:
          id === 'horde_invasion'
            ? 24
            : id === 'wwz_busan'
            ? 22
            : id === 'super_spreader'
            ? 20
            : 18,
        initialInfected:
          id === 'horde_invasion'
            ? 55
            : id === 'wwz_busan'
            ? 18
            : id === 'multi_epicenter'
            ? 5
            : id === 'super_spreader'
            ? 3
            : id === 'delayed_response'
            ? 2
            : 1,
        dispatchDelaySeconds:
          id === 'delayed_response' ? 35 : id === 'horde_invasion' || id === 'wwz_busan' ? 2 : 3,
        allowPlayerIntervention: id !== 'no_intervention',
        enableWaves: id === 'horde_invasion' || id === 'wwz_busan',
        fastStrain: isFastStrain
      };

      this.modalEl.classList.add('hidden');
      this.lastRenderedEventId = -1;
      this.eventLogListEl.innerHTML = '';
      this.selectTool('inspect');
      this.onResetScenario(newConfig);
      this.refreshUI();
    });
  }

  public toggleFirstPersonMode(): void {
    if (this.sim.firstPerson.active) {
      this.exitFirstPersonMode();
    } else {
      this.enterFirstPersonMode();
    }
  }

  public enterFirstPersonMode(preset: 'city' | 'ktx_terminal' = 'city'): void {
    this.modalEl.classList.add('hidden');
    if (this.isPaused) {
      this.togglePause();
    }
    this.simSpeed = 1;
    document.getElementById('btn-speed-1')?.classList.add('active');
    document.getElementById('btn-speed-2')?.classList.remove('active');
    document.getElementById('btn-speed-5')?.classList.remove('active');

    this.sim.enterFirstPerson(preset);
    this.cam.setFirstPersonMode(true, this.sim.firstPerson.yaw);
    this.hudLayerEl.classList.add('hidden');
    this.fpsHudEl.classList.add('active');
    this.btnFpsMode.classList.add('active');
    this.refreshUI();
  }

  public exitFirstPersonMode(): void {
    if (!this.sim.firstPerson.active) return;
    this.sim.exitFirstPerson();
    this.cam.setFirstPersonMode(false);
    this.fpsHudEl.classList.remove('active');
    this.hudLayerEl.classList.remove('hidden');
    this.btnFpsMode.classList.remove('active');
    this.refreshUI();
  }

  public togglePause(): void {
    this.isPaused = !this.isPaused;
    const btn = document.getElementById('btn-play-pause')!;
    btn.textContent = this.isPaused ? '▶' : '⏸';
    btn.classList.toggle('active', !this.isPaused);
  }

  public selectTool(tool: TacticalTool): void {
    if (!this.sim.config.allowPlayerIntervention && tool !== 'inspect') {
      return;
    }

    this.activeTool = tool;
    document.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
  }

  public refreshUI(): void {
    const stats = this.sim.getStats();

    this.clockEl.textContent = this.sim.formatClock(stats.simTime);
    this.statHealthyEl.textContent = stats.healthy.toString();
    this.statInfectedEl.textContent = stats.infected.toString();
    this.statPoliceEl.textContent = stats.police.toString();
    this.statCuredEl.textContent = stats.cured.toString();
    this.statShelteredEl.textContent = stats.sheltered.toString();
    this.statEvacuatedEl.textContent = stats.evacuated.toString();
    this.statDeceasedEl.textContent = stats.deceased.toString();

    this.btnAutoCam.classList.toggle('active', this.cam.autoDirectorMode);

    this.cpDisplayEl.textContent = this.sim.config.allowPlayerIntervention
      ? `⚡ ${stats.commandPoints} CP`
      : '🔒 LOCKED';

    this.statusBadgeEl.textContent =
      stats.hordeWave > 0 ? `WAVE ${stats.hordeWave} • ${stats.outbreakStatus}` : stats.outbreakStatus;
    this.statusBadgeEl.className = 'status-badge ';
    if (stats.outbreakStatus === 'CITY NORMAL') {
      this.statusBadgeEl.classList.add('status-normal');
    } else if (stats.outbreakStatus === 'LOCAL INCIDENT') {
      this.statusBadgeEl.classList.add('status-incident');
    } else if (stats.outbreakStatus === 'CONTAINED') {
      this.statusBadgeEl.classList.add('status-contained');
    } else {
      this.statusBadgeEl.classList.add('status-outbreak');
    }

    this.activeReportsCountEl.textContent =
      stats.activeReports > 0 ? `(${stats.activeReports})` : '';
    this.prioritySectorLabel.textContent = this.sim.prioritySector
      ? this.sim.prioritySector.district
      : 'All Sectors';

    if (this.sim.defenseWalls.length > 0) {
      const l1Color = stats.line1Status === 'HOLDING' ? '#22c55e' : '#ef4444';
      const l2Color = stats.line2Status === 'HOLDING' ? '#22c55e' : '#ef4444';
      const l3Color = stats.line3Status === 'HOLDING' ? '#22c55e' : '#ef4444';
      const l3Tag =
        stats.line3Status !== 'NONE'
          ? ` • <span style="color:${l3Color};font-weight:700;">L3: ${stats.line3Status}</span>`
          : '';
      const trainTag = this.sim.city.hasExpressRail ? ` • 🚄 Boarded: ${stats.trainBoarded}` : '';
      this.defenseLinesStatusEl.innerHTML =
        `<span style="color:${l1Color};font-weight:700;">L1: ${stats.line1Status}</span> • ` +
        `<span style="color:${l2Color};font-weight:700;">L2: ${stats.line2Status}</span>${l3Tag}${trainTag}`;
    } else {
      this.defenseLinesStatusEl.textContent = '';
    }

    if (this.sim.firstPerson.active) {
      this.refreshFirstPersonHud(stats.line1Status, stats.line2Status, stats.line3Status);
    }

    // Update non-blocking Crisis Alert Toast
    if (this.sim.lastAlert) {
      const ageMs = performance.now() - this.sim.lastAlert.timestamp;
      if (this.sim.lastAlert.timestamp !== this.lastShownAlertTime) {
        this.lastShownAlertTime = this.sim.lastAlert.timestamp;
        this.alertToastEl.textContent = this.sim.lastAlert.text;
        this.alertToastEl.className = `alert-toast visible ${
          this.sim.lastAlert.severity === 'warn'
            ? 'sev-warn'
            : this.sim.lastAlert.severity === 'info'
            ? 'sev-info'
            : ''
        }`;
      } else if (ageMs > 3800) {
        this.alertToastEl.classList.remove('visible');
      }
    } else {
      this.alertToastEl.classList.remove('visible');
    }

    this.drawOutbreakChart();
    this.drawMinimap();
    this.refreshEventLog();
    this.refreshInspector();
  }

  private refreshFirstPersonHud(
    line1Status: string,
    line2Status: string,
    line3Status: string
  ): void {
    const fp = this.sim.firstPerson;
    const player = this.sim.getAgentById(fp.playerId);

    const station = this.sim.city.stationPos;
    const targetZ = fp.waypointZ || (station ? station.z : this.sim.city.cityHalfZ - 10);
    const targetX = fp.waypointX ?? (station ? station.x : 0);
    const distToGoal = player ? Math.round(Math.hypot(player.x - targetX, player.z - targetZ)) : 0;

    let compassArrow = '⬆';
    if (player) {
      const dx = targetX - player.x;
      const dz = targetZ - player.z;
      const fX = -Math.sin(fp.yaw);
      const fZ = -Math.cos(fp.yaw);
      const rX = Math.cos(fp.yaw);
      const rZ = -Math.sin(fp.yaw);
      const ang = Math.atan2(dx * rX + dz * rZ, dx * fX + dz * fZ);
      if (Math.abs(ang) < 0.35) compassArrow = '⬆';
      else if (ang >= 0.35 && ang < 1.15) compassArrow = '↗';
      else if (ang >= 1.15 && ang < 2.0) compassArrow = '➡';
      else if (ang >= 2.0 && ang < 2.65) compassArrow = '↘';
      else if (ang <= -0.35 && ang > -1.15) compassArrow = '↖';
      else if (ang <= -1.15 && ang > -2.0) compassArrow = '⬅';
      else if (ang <= -2.0 && ang > -2.65) compassArrow = '↙';
      else compassArrow = '⬇';
    }

    const insideBld = fp.insideBuildingId
      ? this.sim.city.buildingById.get(fp.insideBuildingId)
      : undefined;
    const locTag =
      fp.insideTrainCar > 0
        ? ` • Inside: KTX Car ${fp.insideTrainCar}`
        : insideBld
        ? ` • Inside: ${insideBld.name}`
        : '';
    const chaseTag = fp.pursuers > 0 ? ` • ⚠ ${fp.pursuers} CHASING` : ' • ✓ CLEAR';
    const wpLabel = fp.waypointLabel || (this.sim.city.hasExpressRail ? 'South Express Station' : 'Evac Zone');

    if (this.sim.city.hasExpressRail && station) {
      const train = this.sim.expressTrain;
      const phaseLabel =
        train.state === 'DOCKED'
          ? `BOARDING AT STATION (${Math.max(0, Math.ceil(train.timer))}s)`
          : train.state === 'APPROACHING'
          ? `INBOUND TO PLATFORM`
          : train.state === 'DEPARTING'
          ? `DEPARTING SOUTH`
          : `NEXT TRAIN IN ${Math.max(0, Math.ceil(train.timer))}s`;
      const linesSummary =
        line3Status !== 'NONE'
          ? `L1 ${line1Status} / L2 ${line2Status} / L3 ${line3Status}`
          : `L1 ${line1Status} / L2 ${line2Status}`;
      this.fpsObjectiveEl.textContent = `${compassArrow} ${wpLabel} (${distToGoal}m)${locTag}${chaseTag}`;
      this.fpsTrainStatusEl.textContent = `KTX Express: ${phaseLabel} • ${linesSummary}`;
    } else {
      this.fpsObjectiveEl.textContent = `${compassArrow} ${wpLabel} (${distToGoal}m)${locTag}${chaseTag}`;
      this.fpsTrainStatusEl.textContent = `Parkour Civilian Escape • Reach Evacuation Safely`;
    }

    const hpPct = player ? Math.max(0, Math.min(100, (player.health / player.maxHealth) * 100)) : 0;
    this.fpsHpTextEl.textContent = player?.isIncubating
      ? `${Math.ceil(hpPct)} (INF)`
      : `${Math.ceil(hpPct)}`;
    this.fpsHpFillEl.style.width = `${hpPct}%`;
    this.fpsHpFillEl.style.background = player?.isIncubating
      ? '#f97316'
      : hpPct > 55
      ? '#22c55e'
      : hpPct > 25
      ? '#f59e0b'
      : '#ef4444';

    const stamPct = Math.max(0, Math.min(100, (fp.stamina / fp.maxStamina) * 100));
    this.fpsStamTextEl.textContent = fp.adrenalineTimer > 0 ? '⚡MAX' : `${Math.round(stamPct)}`;
    this.fpsStamFillEl.style.width = `${stamPct}%`;
    this.fpsStamFillEl.style.background = fp.adrenalineTimer > 0 ? '#22d3ee' : '#38bdf8';

    const danger =
      fp.nearestZombieDist < 8.5
        ? Math.min(0.50, ((8.5 - fp.nearestZombieDist) / 7.5) * 0.50)
        : 0;
    this.fpsDangerVignetteEl.style.opacity = `${danger.toFixed(2)}`;

    const trainDoor =
      fp.nearbyTrainDoorId !== null
        ? this.sim.expressTrain.doors.find((d) => d.id === fp.nearbyTrainDoorId && !d.isBroken)
        : undefined;
    const pickup =
      fp.nearbyPickupId !== null
        ? this.sim.supplyPickups.find((p) => p.id === fp.nearbyPickupId && !p.collected)
        : undefined;
    const door =
      fp.nearbyDoorId !== null
        ? this.sim.interiorDoors.find((d) => d.id === fp.nearbyDoorId && !d.isBroken)
        : undefined;
    const gate =
      fp.nearbyGateId !== null
        ? this.sim.blastGates.find((g) => g.id === fp.nearbyGateId && !g.breached)
        : undefined;

    if (fp.nearTrainCabinConsole) {
      this.fpsInteractPromptEl.textContent = 'Press [E] to TRIGGER KTX-101 EMERGENCY DEPARTURE (CAR 1)';
      this.fpsInteractPromptEl.style.borderColor = '#22c55e';
      this.fpsInteractPromptEl.style.color = '#bbf7d0';
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (trainDoor) {
      const pct = Math.max(1, Math.ceil((trainDoor.integrity / trainDoor.maxIntegrity) * 100));
      this.fpsInteractPromptEl.textContent = trainDoor.isLocked
        ? `Press [E] to UNLOCK ${trainDoor.label} (${pct}%)`
        : `Press [E] to LOCK ${trainDoor.label} (${pct}%)`;
      this.fpsInteractPromptEl.style.borderColor = '#f59e0b';
      this.fpsInteractPromptEl.style.color = '#fde68a';
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (pickup) {
      this.fpsInteractPromptEl.textContent = `Press [E] to Grab ${pickup.label}`;
      this.fpsInteractPromptEl.style.borderColor = '#22c55e';
      this.fpsInteractPromptEl.style.color = '#bbf7d0';
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (door) {
      const pct = Math.max(1, Math.ceil((door.integrity / door.maxIntegrity) * 100));
      this.fpsInteractPromptEl.textContent = door.isLocked
        ? `Press [E] to UNLOCK ${door.label} (${pct}%)`
        : `Press [E] to LOCK ${door.label} (${pct}%)`;
      this.fpsInteractPromptEl.style.borderColor = '#f59e0b';
      this.fpsInteractPromptEl.style.color = '#fde68a';
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (gate) {
      this.fpsInteractPromptEl.textContent = gate.isOpen
        ? `Press [E] to SEAL ${gate.label}`
        : `Press [E] to OPEN ${gate.label}`;
      this.fpsInteractPromptEl.style.borderColor = '#f59e0b';
      this.fpsInteractPromptEl.style.color = '#fde68a';
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (fp.nearbyCarId !== null) {
      this.fpsInteractPromptEl.textContent = `Press [E] to Trigger Car Alarm (Distract Horde)`;
      this.fpsInteractPromptEl.style.borderColor = '#f59e0b';
      this.fpsInteractPromptEl.style.color = '#fde68a';
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (fp.nearbyVaultLabel) {
      this.fpsInteractPromptEl.textContent = `Press [Space] to VAULT OVER ${fp.nearbyVaultLabel}`;
      this.fpsInteractPromptEl.style.borderColor = '#38bdf8';
      this.fpsInteractPromptEl.style.color = '#bae6fd';
      this.fpsInteractPromptEl.style.display = 'block';
    } else {
      this.fpsInteractPromptEl.style.display = 'none';
    }

    const spaceTag =
      fp.nearbyVaultLabel !== null
        ? 'Space Vault'
        : fp.shoveCooldown > 0
        ? `Shove ${fp.shoveCooldown.toFixed(1)}s`
        : 'Space Vault/Shove Ready';
    const decoyTag =
      fp.decoyCooldown > 0 ? `Q Decoy ${Math.ceil(fp.decoyCooldown)}s` : 'Q Decoy Ready';
    const rushTag = fp.adrenalineTimer > 0 ? ` • ⚡ Surge ${fp.adrenalineTimer.toFixed(1)}s` : '';
    this.fpsControlsHintEl.textContent = `WASD Move • Shift Sprint • ${spaceTag} • ${decoyTag} • E Door/Car/Loot • F Exit${rushTag}`;

    if (fp.outcome && fp.outcome !== 'PLAYING') {
      this.fpsOutcomeCardEl.classList.add('active');
      if (fp.outcome === 'ESCAPED') {
        this.fpsOutcomeTitleEl.textContent = 'SURVIVED — ESCAPED!';
        this.fpsOutcomeTitleEl.style.color = '#22c55e';
        this.fpsOutcomeDescEl.textContent =
          'You made it past the falling defense lines and evacuated safely!';
      } else {
        this.fpsOutcomeTitleEl.textContent = 'INFECTED / OVERRUN';
        this.fpsOutcomeTitleEl.style.color = '#ef4444';
        this.fpsOutcomeDescEl.textContent =
          'The horde caught up with you. Respawn as another civilian or return to Commander View.';
      }
    } else {
      this.fpsOutcomeCardEl.classList.remove('active');
    }
  }

  private drawOutbreakChart(): void {
    const ctx = this.chartCtx;
    const w = this.chartCanvas.width;
    const h = this.chartCanvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
    ctx.lineWidth = 1;
    for (let y = 25; y < h; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const hist = this.sim.history;
    if (hist.length < 2) return;

    this.chartTimeLabel.textContent = `${Math.floor(this.sim.simTime)}s`;
    const maxPop = Math.max(100, this.sim.config.population);

    const plotLine = (selector: (pt: (typeof hist)[0]) => number, color: string, lineWidth = 2) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (let i = 0; i < hist.length; i++) {
        const x = (i / (hist.length - 1)) * (w - 10) + 5;
        const val = selector(hist[i]);
        const y = h - 6 - (val / maxPop) * (h - 14);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    plotLine((p) => p.healthy, '#38bdf8', 2);
    plotLine((p) => p.panicking, '#f59e0b', 1.6);
    plotLine((p) => p.evacuated, '#22c55e', 1.6);
    plotLine((p) => p.infected, '#ef4444', 2.2);
  }

  private drawMinimap(): void {
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const maxHalf = Math.max(this.sim.city.cityHalfX, this.sim.city.cityHalfZ);
    const worldSpan = maxHalf * 2.15;
    const toMapX = (wx: number) => (wx / worldSpan + 0.5) * w;
    const toMapY = (wz: number) => (wz / worldSpan + 0.5) * h;
    const scaleX = w / worldSpan;
    const scaleY = h / worldSpan;

    // 0. True Organic City Bounds Footprint + Highway + Parking Lots + Terminal Plaza
    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    ctx.fillRect(
      toMapX(-this.sim.city.cityHalfX),
      toMapY(-this.sim.city.cityHalfZ),
      this.sim.city.cityHalfX * 2 * scaleX,
      this.sim.city.cityHalfZ * 2 * scaleY
    );
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      toMapX(-this.sim.city.cityHalfX),
      toMapY(-this.sim.city.cityHalfZ),
      this.sim.city.cityHalfX * 2 * scaleX,
      this.sim.city.cityHalfZ * 2 * scaleY
    );

    if (this.sim.city.highwayZone) {
      const hz = this.sim.city.highwayZone;
      ctx.fillStyle = 'rgba(51, 65, 85, 0.65)';
      ctx.fillRect(
        toMapX(hz.minX),
        toMapY(hz.minZ),
        (hz.maxX - hz.minX) * scaleX,
        (hz.maxZ - hz.minZ) * scaleY
      );
    }
    for (const lot of this.sim.city.parkingLots) {
      ctx.fillStyle = 'rgba(100, 116, 139, 0.45)';
      ctx.fillRect(
        toMapX(lot.x - lot.width * 0.5),
        toMapY(lot.z - lot.depth * 0.5),
        lot.width * scaleX,
        lot.depth * scaleY
      );
    }
    if (this.sim.city.terminalPlaza) {
      const tp = this.sim.city.terminalPlaza;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
      ctx.fillRect(
        toMapX(tp.minX),
        toMapY(tp.minZ),
        (tp.maxX - tp.minX) * scaleX,
        (tp.maxZ - tp.minZ) * scaleY
      );
    }

    // 1. Rivers & Twin Bridges
    for (const r of this.sim.city.rivers) {
      ctx.fillStyle = 'rgba(3, 105, 161, 0.72)';
      ctx.fillRect(
        toMapX(r.minX),
        toMapY(r.minZ),
        (r.maxX - r.minX) * scaleX,
        (r.maxZ - r.minZ) * scaleY
      );
    }
    for (const br of this.sim.city.bridges) {
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(
        toMapX(br.x - br.width * 0.5),
        toMapY(br.z - br.length * 0.5),
        br.width * scaleX,
        br.length * scaleY
      );
    }

    // 1b. Express Rail, Defense Walls & Blast Gates
    if (this.sim.city.hasExpressRail) {
      const railTracks =
        this.sim.city.railTracksZ.length > 0
          ? this.sim.city.railTracksZ
          : [this.sim.city.railZ];
      const bx0 = toMapX(-this.sim.city.cityHalfX);
      const bw = this.sim.city.cityHalfX * 2 * scaleX;
      for (const rz of railTracks) {
        const ry = toMapY(rz);
        ctx.fillStyle = '#334155';
        ctx.fillRect(bx0, ry - 2.2, bw, 4.4);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx0, ry - 1.2);
        ctx.lineTo(bx0 + bw, ry - 1.2);
        ctx.moveTo(bx0, ry + 1.2);
        ctx.lineTo(bx0 + bw, ry + 1.2);
        ctx.stroke();
      }

      const ry = toMapY(this.sim.city.railZ);
      const train = this.sim.expressTrain;
      if (train.state !== 'COOLDOWN') {
        const tx = toMapX(train.x);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(tx - 16, ry - 2.5, 32, 5);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(tx - 15, ry - 1.5, 4, 3);
      }
    }

    for (const wall of this.sim.defenseWalls) {
      ctx.fillStyle = wall.breachedNotified ? '#f59e0b' : '#cbd5e1';
      ctx.fillRect(
        toMapX(wall.minX),
        toMapY(wall.z - wall.thickness * 0.5) - 1,
        Math.max(2, (wall.maxX - wall.minX) * scaleX),
        Math.max(2.5, wall.thickness * scaleY)
      );
    }

    for (const gate of this.sim.blastGates) {
      ctx.fillStyle = gate.breached ? '#ef4444' : gate.isOpen ? '#22c55e' : '#38bdf8';
      ctx.fillRect(toMapX(gate.x) - 3, toMapY(gate.z) - 2, 6, 4);
    }

    // 2. Central Park & Civic Plazas
    const cp = this.sim.city.centralPark;
    ctx.fillStyle = 'rgba(45, 106, 79, 0.5)';
    ctx.fillRect(
      toMapX(cp.x - cp.width / 2),
      toMapY(cp.z - cp.depth / 2),
      cp.width * scaleX,
      cp.depth * scaleY
    );
    for (const pl of this.sim.city.plazas) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.fillRect(
        toMapX(pl.x - pl.width / 2),
        toMapY(pl.z - pl.depth / 2),
        pl.width * scaleX,
        pl.depth * scaleY
      );
    }

    // 3. Buildings
    for (let i = 0; i < this.sim.city.buildings.length; i++) {
      const b = this.sim.city.buildings[i];
      if (b.id === 'BLD-HQ') ctx.fillStyle = '#1e40af';
      else if (b.id === 'BLD-HOSP') ctx.fillStyle = '#991b1b';
      else if (b.shelteredAgentIds.length > 0) ctx.fillStyle = '#6b21a8';
      else ctx.fillStyle = '#1e293b';

      ctx.fillRect(toMapX(b.minX), toMapY(b.minZ), b.width * scaleX, b.depth * scaleY);
    }

    // 4. Evacuation Zones, Acoustic Lure Flares & Roadblocks
    for (const ez of this.sim.evacZones) {
      if (!ez.active) continue;
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(toMapX(ez.x), toMapY(ez.z), ez.radius * scaleX, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const lf of this.sim.lureFlares) {
      if (!lf.active) continue;
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(toMapX(lf.x), toMapY(lf.z), 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const rb of this.sim.roadblocks) {
      if (!rb.active) continue;
      ctx.fillStyle = '#f97316';
      ctx.fillRect(toMapX(rb.x) - 2.5, toMapY(rb.z) - 2.5, 5, 5);
    }

    // 5. Burning Vehicles & Static Fires
    for (let i = 0; i < this.sim.vehicles.length; i++) {
      const v = this.sim.vehicles[i];
      if (!v.isBurning) continue;
      ctx.fillStyle = '#fb923c';
      ctx.fillRect(toMapX(v.x) - 2, toMapY(v.z) - 2, 4, 4);
    }
    for (let i = 0; i < this.sim.city.staticObstacles.length; i++) {
      const obs = this.sim.city.staticObstacles[i];
      if (!obs.isBurning) continue;
      ctx.fillStyle = '#fb923c';
      ctx.fillRect(toMapX(obs.x) - 2.2, toMapY(obs.z) - 2.2, 4.4, 4.4);
    }

    // 6. Agents (including bright magenta Alpha Brutes)
    for (let i = 0; i < this.sim.agents.length; i++) {
      const a = this.sim.agents[i];
      if (!a.isAlive || a.isEvacuated || a.civState === 'SHELTERED') continue;

      const mx = toMapX(a.x);
      const my = toMapY(a.z);

      if (a.role === 'infected') {
        if (a.zombieVariant === 'brute') {
          ctx.fillStyle = '#d946ef';
          ctx.fillRect(mx - 2.4, my - 2.4, 4.8, 4.8);
        } else {
          ctx.fillStyle = a.zombieVariant === 'runner' ? '#fb923c' : '#ef4444';
          ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
        }
      } else if (a.role === 'police') {
        ctx.fillStyle = a.isSwat ? '#06b6d4' : '#3b82f6';
        ctx.fillRect(mx - 1.4, my - 1.4, 2.8, 2.8);
      } else if (a.role === 'medic') {
        ctx.fillStyle = '#10b981';
        ctx.fillRect(mx - 1.4, my - 1.4, 2.8, 2.8);
      } else if (a.isIncubating) {
        ctx.fillStyle = '#f97316';
        ctx.fillRect(mx - 1.3, my - 1.3, 2.6, 2.6);
      } else if (
        a.civState === 'FLEEING' ||
        a.civState === 'FRIGHTENED' ||
        a.civState === 'SEEKING_SHELTER'
      ) {
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(mx - 1.0, my - 1.0, 2.0, 2.0);
      } else {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(mx - 0.85, my - 0.85, 1.7, 1.7);
      }
    }

    // 7. Camera Reticle & First-Person Survivor Marker
    if (this.sim.firstPerson.active) {
      const fpPlayer = this.sim.getAgentById(this.sim.firstPerson.playerId);
      if (fpPlayer && fpPlayer.isAlive) {
        const px = toMapX(fpPlayer.x);
        const py = toMapY(fpPlayer.z);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(px, py, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    } else {
      const camX = toMapX(this.cam.target.x);
      const camY = toMapY(this.cam.target.z);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(camX - 9, camY - 6, 18, 12);
    }
  }

  private refreshEventLog(): void {
    const logs = this.sim.eventLog;
    if (logs.length === 0) return;
    if (logs[0].id === this.lastRenderedEventId) return;

    this.lastRenderedEventId = logs[0].id;
    this.eventLogListEl.innerHTML = '';

    const count = Math.min(18, logs.length);
    for (let i = 0; i < count; i++) {
      const item = logs[i];
      const div = document.createElement('div');
      div.className = `event-item type-${item.category}`;
      div.innerHTML = `<span class="event-time">[${item.formattedTime}]</span>${item.message}`;
      div.addEventListener('click', () => {
        this.cam.followAgentMode = false;
        this.cam.autoDirectorMode = false;
        this.cam.focusOn(item.x, item.z, 38);
      });
      this.eventLogListEl.appendChild(div);
    }
  }

  public refreshInspector(): void {
    this.btnFollowAgent.classList.toggle('active', this.cam.followAgentMode);

    if (this.sim.selectedAgentId === null) {
      this.inspectorPanelEl.classList.add('hidden');
      return;
    }

    const agent = this.sim.getAgentById(this.sim.selectedAgentId);
    if (!agent) {
      this.inspectorPanelEl.classList.add('hidden');
      return;
    }

    this.inspectorPanelEl.classList.remove('hidden');
    this.inspNameEl.textContent = agent.name;

    let stateStr = '';
    let barColor = '#22c55e';
    if (!agent.isAlive) {
      stateStr = 'DECEASED';
      barColor = '#64748b';
    } else if (agent.isEvacuated) {
      stateStr = 'EVACUATED';
      barColor = '#22c55e';
    } else if (agent.role === 'infected') {
      const vLabel =
        agent.zombieVariant === 'brute'
          ? 'BRUTE'
          : agent.zombieVariant === 'runner'
          ? 'RUNNER'
          : 'INFECTED';
      const actionTag =
        agent.zombieState === 'FEEDING'
          ? agent.attackMode === 'tackle_pin'
            ? 'PINNING & MAULING'
            : 'NECK GRAPPLE'
          : agent.zombieState === 'ATTACKING' && agent.attackMode === 'brute_slam'
          ? 'BRUTE SLAM'
          : agent.zombieState === 'ATTACKING' && agent.attackMode === 'claw_swipe'
          ? 'CLAW SWIPE'
          : agent.zombieState;
      stateStr = `${vLabel} • ${actionTag}`;
      barColor = agent.zombieVariant === 'brute' ? '#d946ef' : '#ef4444';
    } else if (agent.pinnedById !== null) {
      stateStr = agent.attackMode === 'tackle_pin' ? 'PINNED ON GROUND!' : 'GRAPPLED!';
      barColor = '#ef4444';
    } else if (agent.role === 'police') {
      stateStr = `${agent.isSwat ? 'SWAT' : 'POLICE'} • ${agent.policeState}`;
      barColor = agent.isSwat ? '#06b6d4' : '#3b82f6';
    } else if (agent.role === 'medic') {
      stateStr = `MEDIC • ${agent.medicState} (Cures: ${agent.cures})`;
      barColor = '#10b981';
    } else if (agent.isIncubating) {
      stateStr = `INCUBATING (${agent.incubationTimer.toFixed(1)}s)`;
      barColor = '#f97316';
    } else {
      stateStr = `CIVILIAN • ${agent.civState}`;
      barColor =
        agent.civState === 'FLEEING' || agent.civState === 'FRIGHTENED' ? '#f59e0b' : '#38bdf8';
    }

    this.inspStateEl.textContent = stateStr;
    this.inspDistrictEl.textContent = this.sim.city.getDistrictAtPos(agent.x, agent.z);
    this.inspTaskEl.textContent = agent.destinationLabel;

    const pct = Math.max(0, Math.min(100, (agent.health / agent.maxHealth) * 100));
    this.inspHealthBarEl.style.width = `${pct}%`;
    this.inspHealthBarEl.style.background = barColor;

    this.inspStoryEl.innerHTML = agent.recentLogs
      .slice(0, 4)
      .map((l) => `<div>• ${l}</div>`)
      .join('');
  }
}
