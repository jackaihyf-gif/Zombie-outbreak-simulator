import { LAB_TUNNEL_GATE_Z } from './bsl4Lab';
import { KTX_GATES, KTX_GATE_IDS } from './ktxTerminal';
import { SoundEngine } from './audio';
import { CameraController } from './camera';
import { AtmosphereStage } from './cityRenderer';
import { OutbreakSimulation, SIEGE_WAVE_SIZES } from './simulation';
import { GameLanguage, collectLocalizedLabels, PLAYER_ROLE_NAMES, translateCommanderOrder, translateGameplayAlert, translateWorldLabel, WEAPON_NAMES } from './localization';
import { PLAYER_KILL_REWARD, PLAYER_LOADOUTS, PLAYER_WEAPONS } from './playerLoadouts';
import { KTX_EMERGENCY_INFECTED } from './trainLayout';
import { describeRadio } from './policeRadio';
import type { RadioTransmission } from './policeRadio';
import { DEFAULT_SETTINGS, GameSettings } from './settings';
import { AgentData, GraphicsQuality, MapId, PlayerRole, PlayerSpawnPoint, PlayerWeapon, ScenarioConfig, ScenarioId, TacticalTool } from './types';

interface GateStatus {
  integrity: number;
  maxIntegrity: number;
  lastDamagedAt: number;
  open: boolean;
  breached?: boolean;
  openFraction?: number;
}

export class UIController {
  public activeTool: TacticalTool = 'inspect';
  public isPaused = false;
  public simSpeed = 1;

  private sim: OutbreakSimulation;
  private cam: CameraController;
  private sound: SoundEngine;
  private onCycleAtmosphere: () => AtmosphereStage;
  private onResetScenario: (cfg: ScenarioConfig) => void;
  private onCycleQuality: () => GraphicsQuality;
  private getSettings: () => GameSettings;
  private onUpdateSettings: (partial: Partial<GameSettings>, isManualQuality?: boolean) => void;
  private quality: GraphicsQuality = 'high';

  // Top Bar Elements
  private clockEl = document.getElementById('sim-clock')!;
  private statusBadgeEl = document.getElementById('outbreak-status-badge')!;
  private alertToastEl = document.getElementById('alert-toast')!;
  private lastShownAlertTime = 0;
  private crisisBannerEl = document.getElementById('crisis-banner');
  private crisisBannerTitleEl = document.getElementById('crisis-banner-title');
  private crisisBannerSubEl = document.getElementById('crisis-banner-sub');
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
  private btnQuality = document.getElementById('btn-quality')!;
  private btnFpsMode = document.getElementById('btn-fps-mode')!;

  // First-Person Survivor HUD
  private hudLayerEl = document.getElementById('hud-layer')!;
  private fpsHudEl = document.getElementById('fps-hud')!;
  private fpsDangerVignetteEl = document.getElementById('fps-danger-vignette')!;
  private fpsHitIndicatorEl = document.getElementById('fps-hit-indicator')!;
  private fpsObjectiveEl = document.getElementById('fps-objective')!;
  private fpsTrainStatusEl = document.getElementById('fps-train-status')!;
  private fpsCommanderStatusEl = document.getElementById('fps-commander-status')!;
  private fpsMissionDetailEl = document.getElementById('fps-mission-detail')!;
  private fpsKillRewardEl = document.getElementById('fps-kill-reward')!;
  private fpsWeaponStatusEl = document.getElementById('fps-weapon-status')!;
  private fpsCrosshairEl = document.getElementById('fps-crosshair')!;
  private fpsReloadRingEl = document.getElementById('fps-reload-ring');
  private fpsReloadSweetEl = document.getElementById('fps-reload-sweet');
  private fpsReloadBadgeEl = document.getElementById('fps-reload-badge');
  private fpsCompassTicksEl = document.getElementById('fps-compass-ticks');
  private fpsCompassPipsEl = document.getElementById('fps-compass-pips');
  private fpsKillCalloutEl = document.getElementById('fps-kill-callout');
  private fpsOutcomeStatsEl = document.getElementById('fps-outcome-stats');
  private lastCompassTickKey = '';
  private lastCompassPipKey = '';
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
  private defenseGateBarsEl = document.getElementById('defense-gate-bars')!;
  private fpsGateBarEl = document.getElementById('fps-gate-bar')!;

  // After-Action Report Modal Elements
  private aarModalEl = document.getElementById('aar-modal');
  private aarSubtitleEl = document.getElementById('aar-subtitle');
  private aarSeedBadgeEl = document.getElementById('aar-seed-badge');
  private aarStatsGridEl = document.getElementById('aar-stats-grid');
  private aarChartCanvas = document.getElementById('aar-chart') as HTMLCanvasElement | null;
  private aarAutoShownForRun = false;

  // Tabbed Drawer Elements
  private drawerBodyEl = document.getElementById('drawer-body')!;
  private chartCanvas = document.getElementById('chart-canvas') as HTMLCanvasElement;
  private chartCtx = this.chartCanvas.getContext('2d')!;
  private chartTimeLabel = document.getElementById('chart-time-label')!;

  private minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
  private minimapCtx = this.minimapCanvas.getContext('2d')!;
  private prioritySectorLabel = document.getElementById('priority-sector-label')!;

  private eventLogListEl = document.getElementById('event-log-list')!;
  private radioPanel = document.querySelector<HTMLDetailsElement>('#police-radio')!;
  private radioTitle = document.getElementById('police-radio-title')!;
  private radioLog = document.getElementById('police-radio-log')!;
  private radioRows = new Map<
    RadioTransmission,
    { row: HTMLLIElement; time: HTMLElement; body: HTMLElement; lastTime: number; lastCount?: number }
  >();
  private lastRadioSignature = '';
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
  private settingsModalEl = document.getElementById('settings-modal');
  private setQualityEl = document.getElementById('set-quality') as HTMLSelectElement | null;
  private setAutoQualityEl = document.getElementById('set-auto-quality') as HTMLInputElement | null;
  private setSensEl = document.getElementById('set-sens') as HTMLInputElement | null;
  private setSensValEl = document.getElementById('set-sens-val');
  private setFovEl = document.getElementById('set-fov') as HTMLInputElement | null;
  private setFovValEl = document.getElementById('set-fov-val');
  private setShakeEl = document.getElementById('set-shake') as HTMLInputElement | null;
  private setAutoPauseEl = document.getElementById('set-autopause') as HTMLInputElement | null;
  private setVolMasterEl = document.getElementById('set-vol-master') as HTMLInputElement | null;
  private setVolMasterValEl = document.getElementById('set-vol-master-val');
  private setVolSfxEl = document.getElementById('set-vol-sfx') as HTMLInputElement | null;
  private setVolSfxValEl = document.getElementById('set-vol-sfx-val');
  private setVolAmbientEl = document.getElementById('set-vol-ambient') as HTMLInputElement | null;
  private setVolAmbientValEl = document.getElementById('set-vol-ambient-val');
  private setVolRadioEl = document.getElementById('set-vol-radio') as HTMLInputElement | null;
  private setVolRadioValEl = document.getElementById('set-vol-radio-val');
  private roleModalEl = document.getElementById('player-modal')!;
  private roleForm = document.getElementById('player-form') as HTMLFormElement;
  private loadoutRow = document.getElementById('player-loadout-row')!;
  private loadoutSelect = document.getElementById('player-loadout') as HTMLSelectElement;
  private loadoutInfo = document.getElementById('player-loadout-info')!;
  private wasPausedBeforeRoles = false;
  private roleOpener: HTMLElement | null = null;
  private spawnPickerEl = document.getElementById('spawn-picker')!;
  private spawnStatusEl = document.getElementById('spawn-picker-status')!;
  private spawnConfirmBtn = document.getElementById('btn-confirm-spawn') as HTMLButtonElement;
  private spawnSelection: { role: PlayerRole; weapon?: PlayerWeapon; point: PlayerSpawnPoint | null;
    follow: boolean; director: boolean; invalid: boolean } | null = null;

  public get isPickingSpawn(): boolean { return this.spawnSelection !== null; }
  public get selectedSpawnPoint(): PlayerSpawnPoint | null { return this.spawnSelection?.point ?? null; }
  private localizedLabels = collectLocalizedLabels();
  private language: GameLanguage = 'zh';
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
    onResetScenario: (cfg: ScenarioConfig) => void,
    onCycleQuality: () => GraphicsQuality = () => 'high',
    initialQuality: GraphicsQuality = 'high',
    getSettings: () => GameSettings = () => DEFAULT_SETTINGS,
    onUpdateSettings: (partial: Partial<GameSettings>, isManualQuality?: boolean) => void = () => {}
  ) {
    this.sim = sim;
    this.cam = cam;
    this.sound = sound;
    this.onCycleAtmosphere = onCycleAtmosphere;
    this.onResetScenario = onResetScenario;
    this.onCycleQuality = onCycleQuality;
    this.quality = initialQuality;
    this.getSettings = getSettings;
    this.onUpdateSettings = onUpdateSettings;

    this.bindEvents();
    this.language = this.getSettings().language;
    this.syncLabConfigControls();
    this.syncSettingsControls();
    this.applyLanguage();
  }

  private bindEvents(): void {
    this.radioPanel.addEventListener('toggle', () => {
      if (this.radioPanel.open) this.radioLog.scrollTop = this.radioLog.scrollHeight;
    });
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
      this.openRolePicker();
    });

    this.roleForm.addEventListener('change', (event) => {
      if (event.target === this.loadoutSelect) this.refreshLoadoutInfo();
      else this.refreshLoadoutOptions();
    });
    this.roleForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const role = this.selectedPlayerRole();
      const weapon = this.loadoutSelect.value as PlayerWeapon | '';
      this.closeRolePicker(false);
      if (this.sim.firstPerson.active) this.exitFirstPersonMode();
      this.enterFirstPersonMode('city', role, weapon || undefined);
    });
    document.getElementById('btn-cancel-player')!.addEventListener('click', () => this.closeRolePicker(true));
    document.getElementById('btn-pick-spawn')!.addEventListener('click', () => this.beginSpawnSelection());
    document.getElementById('btn-cancel-spawn')!.addEventListener('click', () => this.closeSpawnSelection(true));
    this.spawnConfirmBtn.addEventListener('click', () => {
      const selection = this.spawnSelection;
      if (!selection?.point) return;
      if (!this.sim.canSpawnPlayerAt(selection.point)) {
        this.selectSpawnPoint(null);
        return;
      }
      this.closeSpawnSelection(false);
      this.enterFirstPersonMode('city', selection.role, selection.weapon, selection.point);
    });
    this.roleModalEl.addEventListener('click', (event) => {
      if (event.target === this.roleModalEl) this.closeRolePicker(true);
    });
    for (const toggle of document.querySelectorAll<HTMLButtonElement>('[data-language-toggle]')) {
      toggle.addEventListener('click', () => {
        this.language = this.language === 'zh' ? 'en' : 'zh';
        this.onUpdateSettings({ language: this.language });
        this.applyLanguage();
      });
    }

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

    this.btnQuality.addEventListener('click', () => {
      this.quality = this.onCycleQuality();
      this.syncQualityButton(this.quality);
    });

    this.bindSettingsModal();
    this.bindAarModal();
    this.crisisBannerEl?.addEventListener('click', () => {
      if (this.sim.firstPerson.active) return;
      const b = this.sim.crisisBanner;
      if (b && b.x !== undefined && b.z !== undefined) {
        this.cam.followAgentMode = false;
        this.cam.autoDirectorMode = false;
        this.cam.focusOn(b.x, b.z, 54);
      }
    });

    document.getElementById('btn-reset')!.addEventListener('click', () => {
      if (this.sim.firstPerson.active) this.exitFirstPersonMode();
      this.aarAutoShownForRun = false;
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
      if (this.isPickingSpawn) {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.closeSpawnSelection(true);
        }
        return;
      }
      if (!this.roleModalEl.classList.contains('hidden')) {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.closeRolePicker(true);
        }
        return;
      }
      if (this.settingsModalEl && !this.settingsModalEl.classList.contains('hidden')) {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.settingsModalEl.classList.add('hidden');
        }
        return;
      }
      if (this.aarModalEl && !this.aarModalEl.classList.contains('hidden')) {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.aarModalEl.classList.add('hidden');
        }
        return;
      }
      if (document.activeElement?.matches('input, select, textarea')) return;
      if (e.key.toLowerCase() === 'f') {
        if (e.repeat) return;
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
        if (this.selectedModalScenario === 'breach_siege' && !this.isSiegeMap(card.dataset.map)) return;
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
        const siege = this.selectedModalScenario === 'breach_siege';
        if (siege && !this.isSiegeMap(this.selectedModalMap)) this.selectedModalMap = 'citadel_express';
        mapCards.forEach((map) => {
          map.classList.toggle('selected', map.dataset.map === this.selectedModalMap);
          map.setAttribute('aria-disabled', String(siege && !this.isSiegeMap(map.dataset.map)));
        });
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

      const siege = id === 'breach_siege';
      const isFastStrain = id === 'super_spreader' || id === 'wwz_busan' || siege;
      const newConfig: ScenarioConfig = {
        id,
        mapId,
        seed,
        population,
        incubationSeconds:
          id === 'super_spreader'
            ? 2.5
            : id === 'wwz_busan' || siege
            ? Math.min(selectedIncub, 2.8)
            : selectedIncub,
        initialPolice:
          id === 'horde_invasion' || siege
            ? 24
            : id === 'wwz_busan'
            ? 22
            : id === 'super_spreader'
            ? 20
            : 18,
        initialInfected:
          siege
            ? SIEGE_WAVE_SIZES[0]
            : id === 'horde_invasion'
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
          id === 'delayed_response' ? 35 : id === 'horde_invasion' || id === 'wwz_busan' || siege ? 2 : 3,
        allowPlayerIntervention: id !== 'no_intervention',
        enableWaves: id === 'horde_invasion' || id === 'wwz_busan' || siege,
        fastStrain: isFastStrain
      };

      this.modalEl.classList.add('hidden');
      this.aarAutoShownForRun = false;
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
      this.openRolePicker();
    }
  }

  private bindSettingsModal(): void {
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      this.syncSettingsControls();
      this.settingsModalEl?.classList.remove('hidden');
    });
    document.getElementById('btn-settings-close')?.addEventListener('click', () => {
      this.settingsModalEl?.classList.add('hidden');
    });
    this.settingsModalEl?.addEventListener('click', (e) => {
      if (e.target === this.settingsModalEl) {
        this.settingsModalEl?.classList.add('hidden');
      }
    });
    document.getElementById('btn-settings-reset')?.addEventListener('click', () => {
      const preservedLang = this.language;
      this.onUpdateSettings({ ...DEFAULT_SETTINGS, language: preservedLang }, true);
      this.syncQualityButton(DEFAULT_SETTINGS.quality);
      this.syncSettingsControls();
    });
    this.setQualityEl?.addEventListener('change', () => {
      const q = this.setQualityEl!.value as GraphicsQuality;
      this.onUpdateSettings({ quality: q }, true);
      this.syncQualityButton(q);
    });
    this.setAutoQualityEl?.addEventListener('change', () => {
      this.onUpdateSettings({ autoQuality: this.setAutoQualityEl!.checked });
    });
    this.setSensEl?.addEventListener('input', () => {
      const v = Number(this.setSensEl!.value);
      if (this.setSensValEl) this.setSensValEl.textContent = `${v.toFixed(2)}x`;
      this.onUpdateSettings({ mouseSensitivity: v });
    });
    this.setFovEl?.addEventListener('input', () => {
      const v = Number(this.setFovEl!.value);
      if (this.setFovValEl) this.setFovValEl.textContent = `${Math.round(v)}°`;
      this.onUpdateSettings({ fpFov: v });
    });
    this.setShakeEl?.addEventListener('change', () => {
      this.onUpdateSettings({ cameraShake: this.setShakeEl!.checked });
    });
    this.setAutoPauseEl?.addEventListener('change', () => {
      this.onUpdateSettings({ autoPauseOnBlur: this.setAutoPauseEl!.checked });
    });

    const bindVol = (
      input: HTMLInputElement | null,
      valEl: HTMLElement | null,
      key: 'masterVolume' | 'sfxVolume' | 'ambientVolume' | 'radioVolume'
    ) => {
      input?.addEventListener('input', () => {
        const pct = Number(input.value);
        if (valEl) valEl.textContent = `${pct}%`;
        this.onUpdateSettings({ [key]: pct / 100 });
      });
    };
    bindVol(this.setVolMasterEl, this.setVolMasterValEl, 'masterVolume');
    bindVol(this.setVolSfxEl, this.setVolSfxValEl, 'sfxVolume');
    bindVol(this.setVolAmbientEl, this.setVolAmbientValEl, 'ambientVolume');
    bindVol(this.setVolRadioEl, this.setVolRadioValEl, 'radioVolume');
  }

  private syncSettingsControls(): void {
    const s = this.getSettings();
    if (this.setQualityEl) this.setQualityEl.value = s.quality;
    if (this.setAutoQualityEl) this.setAutoQualityEl.checked = s.autoQuality;
    if (this.setSensEl) this.setSensEl.value = String(s.mouseSensitivity);
    if (this.setSensValEl) this.setSensValEl.textContent = `${s.mouseSensitivity.toFixed(2)}x`;
    if (this.setFovEl) this.setFovEl.value = String(s.fpFov);
    if (this.setFovValEl) this.setFovValEl.textContent = `${Math.round(s.fpFov)}°`;
    if (this.setShakeEl) this.setShakeEl.checked = s.cameraShake;
    if (this.setAutoPauseEl) this.setAutoPauseEl.checked = s.autoPauseOnBlur;
    const syncVol = (input: HTMLInputElement | null, valEl: HTMLElement | null, ratio: number) => {
      const pct = Math.round(ratio * 100);
      if (input) input.value = String(pct);
      if (valEl) valEl.textContent = `${pct}%`;
    };
    syncVol(this.setVolMasterEl, this.setVolMasterValEl, s.masterVolume);
    syncVol(this.setVolSfxEl, this.setVolSfxValEl, s.sfxVolume);
    syncVol(this.setVolAmbientEl, this.setVolAmbientValEl, s.ambientVolume);
    syncVol(this.setVolRadioEl, this.setVolRadioValEl, s.radioVolume);
  }

  public syncQualityButton(quality: GraphicsQuality): void {
    this.quality = quality;
    this.refreshQualityLabel();
    if (this.setQualityEl) this.setQualityEl.value = quality;
  }

  private syncLabConfigControls(): void {
    const cfg = this.sim.config;
    this.selectedModalMap = cfg.mapId;
    this.selectedModalScenario = cfg.id;
    this.inputSeedEl.value = cfg.seed;

    const popVal = String(cfg.population);
    const hasPop = Array.from(this.selectPopEl.options).some((o) => o.value === popVal);
    if (!hasPop) {
      this.selectPopEl.add(new Option(popVal, popVal));
    }
    this.selectPopEl.value = popVal;

    const siege = cfg.id === 'breach_siege';
    document.querySelectorAll<HTMLElement>('.map-card').forEach((card) => {
      card.classList.toggle('selected', card.dataset.map === cfg.mapId);
      card.setAttribute('aria-disabled', String(siege && !this.isSiegeMap(card.dataset.map)));
    });
    document.querySelectorAll<HTMLElement>('.scenario-card').forEach((card) => {
      card.classList.toggle('selected', card.dataset.scenario === cfg.id);
    });
  }

  private bindAarModal(): void {
    document.getElementById('btn-aar')?.addEventListener('click', () => {
      this.openAarModal();
    });
    document.getElementById('btn-aar-close')?.addEventListener('click', () => {
      this.closeAarModal();
    });
    this.aarModalEl?.addEventListener('click', (e) => {
      if (e.target === this.aarModalEl) this.closeAarModal();
    });
    document.getElementById('btn-aar-replay')?.addEventListener('click', () => {
      this.replaySameSeed();
    });
    document.getElementById('btn-aar-copy')?.addEventListener('click', () => {
      this.copyChallengeLink();
    });
    document.getElementById('btn-fps-replay-seed')?.addEventListener('click', () => {
      this.replaySameSeed();
    });
    document.getElementById('btn-fps-open-aar')?.addEventListener('click', () => {
      this.openAarModal();
    });
  }

  public openAarModal(): void {
    if (!this.aarModalEl) return;
    const stats = this.sim.getStats();
    const fp = this.sim.firstPerson;
    const totalSurvivors = stats.healthy + stats.panicking + stats.sheltered + stats.evacuated;
    const pop = Math.max(1, this.sim.config.population);
    const survivalRate = Math.min(100, Math.round((totalSurvivors / pop) * 100));

    if (this.aarSubtitleEl) {
      this.aarSubtitleEl.textContent = `${this.worldLabel(stats.outbreakStatus)} · ${this.t('Time', '耗时')} ${this.sim.formatClock(stats.simTime)}`;
    }
    if (this.aarSeedBadgeEl) {
      this.aarSeedBadgeEl.textContent = `${this.sim.config.mapId} · ${this.sim.config.id} · ${this.sim.config.seed}`;
    }

    if (this.aarStatsGridEl) {
      const cells: Array<[string, string]> = [
        [this.t('Evacuated', '安全撤离'), `${stats.evacuated}`],
        [this.t('Survival Rate', '生还率'), `${survivalRate}%`],
        [this.t('Casualties', '死亡 / 击毙'), `${stats.deceased}`],
        [this.t('Line 1 / 2 / 3', '一 / 二 / 三防线'),
          `${this.worldLabel(stats.line1Status)} / ${this.worldLabel(stats.line2Status)} / ${stats.line3Status === 'NONE' ? '-' : this.worldLabel(stats.line3Status)}`]
      ];
      const shotsFired = fp.shotsFired ?? 0;
      const shotsHit = fp.shotsHit ?? 0;
      const acc = shotsFired > 0 ? Math.round((shotsHit / shotsFired) * 100) : 0;
      if ((fp.kills ?? 0) > 0 || shotsFired > 0 || fp.active) {
        cells.push(
          [this.t('FP Kills / HS', '个人击杀 / 爆头'), `${fp.kills ?? 0} / ${fp.headshots ?? 0}`],
          [this.t('Accuracy / Streak / Brute', '命中 / 连杀 / Brute'), `${acc}% / ${fp.maxKillStreak ?? 0}x / ${fp.bruteKills ?? 0}`]
        );
      } else {
        cells.push(
          [this.t('Cured / Train', '治愈 / 乘车撤离'), `${stats.cured} / ${stats.trainBoarded}`],
          [this.t('Police / Infected', '警员 / 感染者'), `${stats.police} / ${stats.infected}`]
        );
      }
      this.aarStatsGridEl.replaceChildren(
        ...cells.map(([lbl, val]) => {
          const box = document.createElement('div');
          box.className = 'aar-stat-box';
          const l = document.createElement('div');
          l.className = 'aar-stat-lbl';
          l.textContent = lbl;
          const v = document.createElement('div');
          v.className = 'aar-stat-val';
          v.textContent = val;
          box.append(l, v);
          return box;
        })
      );
    }

    if (this.aarChartCanvas) {
      const ctx = this.aarChartCanvas.getContext('2d');
      if (ctx) {
        this.plotHistorySeries(ctx, this.aarChartCanvas.width, this.aarChartCanvas.height);
      }
    }
    this.aarModalEl.classList.remove('hidden');
  }

  public closeAarModal(): void {
    this.aarModalEl?.classList.add('hidden');
  }

  private replaySameSeed(): void {
    this.closeAarModal();
    if (this.sim.firstPerson.active) this.exitFirstPersonMode();
    this.aarAutoShownForRun = false;
    this.onResetScenario({ ...this.sim.config });
    this.lastRenderedEventId = -1;
    this.eventLogListEl.innerHTML = '';
    this.refreshUI();
  }

  private copyChallengeLink(): void {
    const btn = document.getElementById('btn-aar-copy');
    const cfg = this.sim.config;
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('map', cfg.mapId);
    url.searchParams.set('scenario', cfg.id);
    url.searchParams.set('seed', cfg.seed);
    url.searchParams.set('pop', String(cfg.population));
    const link = url.toString();
    const showCopied = () => {
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = this.t('✅ Copied Link!', '✅ 已复制链接');
      window.setTimeout(() => {
        if (btn.textContent === this.t('✅ Copied Link!', '✅ 已复制链接')) {
          btn.textContent = orig;
        }
      }, 1800);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(showCopied).catch(showCopied);
    } else {
      showCopied();
    }
  }

  private isSiegeMap(mapId?: string): boolean {
    return mapId === 'citadel_express' || mapId === 'twin_bridges' || mapId === 'bsl4_lab';
  }

  public t(english: string, chinese: string): string {
    return this.language === 'zh' ? chinese : english;
  }

  private worldLabel(label: string): string {
    return this.language === 'zh' ? translateWorldLabel(label) : label;
  }

  private siegeWaveStatus(): string {
    const wave = this.sim.hordeWave;
    const total = SIEGE_WAVE_SIZES.length;
    const seconds = Math.max(0, Math.ceil(this.sim.nextWaveTimer));
    return this.t(
      `SIEGE ${wave}/${total}${seconds > 0 ? ` · Next in ${seconds}s` : ''}`,
      `尸潮 ${wave}/${total}${seconds > 0 ? ` · 下一波 ${seconds} 秒` : ''}`
    );
  }

  private applyLanguage(): void {
    document.documentElement.lang = this.language === 'zh' ? 'zh-CN' : 'en';
    for (const { element, english, chinese } of this.localizedLabels) element.textContent = this.t(english, chinese);
    for (const button of document.querySelectorAll('[data-language-toggle]')) button.textContent = this.t('中文', 'English');
    if (this.sim.lastAlert) {
      const alert = this.sim.lastAlert.text;
      this.alertToastEl.textContent = this.t(alert, translateGameplayAlert(alert));
    }
    this.refreshLoadoutOptions();
    this.refreshSpawnSelection();
    this.refreshQualityLabel();
    this.radioTitle.textContent = this.t('Police Radio', '警务频道');
    this.lastRadioSignature = '';
    this.radioRows.clear();
    this.radioLog.replaceChildren();
    this.refreshUI();
  }

  private refreshQualityLabel(): void {
    const label =
      this.quality === 'high'
        ? this.t('✨ High', '✨ 高')
        : this.quality === 'medium'
        ? this.t('✨ Med', '✨ 中')
        : this.t('✨ Low', '✨ 低');
    this.btnQuality.textContent = label;
    this.btnQuality.title = this.t(
      `Graphics Quality: ${this.quality.toUpperCase()}`,
      `画质档位：${this.quality === 'high' ? '高' : this.quality === 'medium' ? '中' : '低'}`
    );
  }

  private selectedPlayerRole(): PlayerRole {
    return this.roleForm.querySelector<HTMLInputElement>('input[name="player-role"]:checked')!.value as PlayerRole;
  }

  private refreshLoadoutOptions(): void {
    const weapons = PLAYER_LOADOUTS[this.selectedPlayerRole()];
    const selected = this.loadoutSelect.value;
    this.loadoutRow.hidden = weapons.length === 0;
    this.loadoutSelect.replaceChildren(...weapons.map((id) => new Option(this.t(...WEAPON_NAMES[id]), id)));
    if (weapons.includes(selected as PlayerWeapon)) this.loadoutSelect.value = selected;
    this.refreshLoadoutInfo();
  }

  private refreshLoadoutInfo(): void {
    const id = this.loadoutSelect.value as PlayerWeapon;
    const weapon = PLAYER_WEAPONS[id];
    this.loadoutInfo.textContent = weapon
      ? this.t(`${weapon.capacity} loaded · ${weapon.reserve} in reserve`, `弹匣 ${weapon.capacity} 发 · 备弹 ${weapon.reserve} 发`)
      : '';
  }

  private openRolePicker(): void {
    this.roleOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.wasPausedBeforeRoles = this.isPaused;
    if (!this.isPaused) this.togglePause();
    this.modalEl.classList.add('hidden');
    this.roleModalEl.classList.remove('hidden');
    this.hudLayerEl.inert = true;
    this.fpsHudEl.inert = true;
    this.refreshLoadoutOptions();
    this.roleForm.querySelector<HTMLInputElement>('input:checked')?.focus();
  }

  private closeRolePicker(cancelled: boolean): void {
    this.roleModalEl.classList.add('hidden');
    this.hudLayerEl.inert = false;
    this.fpsHudEl.inert = false;
    if (cancelled && !this.wasPausedBeforeRoles && this.isPaused) this.togglePause();
    if (cancelled) this.roleOpener?.focus();
  }

  private beginSpawnSelection(): void {
    const role = this.selectedPlayerRole();
    const weapon = this.loadoutSelect.value as PlayerWeapon | '';
    this.spawnSelection = { role, weapon: weapon || undefined, point: null,
      follow: this.cam.followAgentMode, director: this.cam.autoDirectorMode, invalid: false };
    this.closeRolePicker(false);
    this.cam.followAgentMode = false;
    this.cam.autoDirectorMode = false;
    if (this.sim.firstPerson.active) {
      const player = this.sim.getAgentById(this.sim.firstPerson.playerId);
      this.cam.setFirstPersonMode(false);
      if (player) this.cam.focusOn(player.x, player.z, 56);
    }
    this.fpsHudEl.classList.remove('active');
    this.hudLayerEl.classList.add('hidden');
    this.spawnPickerEl.hidden = false;
    this.refreshSpawnSelection();
    document.getElementById('btn-cancel-spawn')?.focus();
  }

  public selectSpawnPoint(point: PlayerSpawnPoint | null): void {
    if (!this.spawnSelection) return;
    this.spawnSelection.point = point;
    this.spawnSelection.invalid = point === null;
    this.refreshSpawnSelection();
  }

  private refreshSpawnSelection(): void {
    if (!this.spawnSelection) return;
    const { point, invalid } = this.spawnSelection;
    this.spawnConfirmBtn.disabled = !point;
    if (!point) {
      this.spawnStatusEl.textContent = invalid
        ? this.t('This location is blocked. Choose a walkable surface.', '该位置无法站立，请选择可通行的位置。')
        : this.t('No location selected', '尚未选点');
      return;
    }
    const district = this.worldLabel(this.sim.city.getDistrictAtPos(point.x, point.z));
    this.spawnStatusEl.textContent = `${district} · X ${Math.round(point.x)} / Z ${Math.round(point.z)}${point.y > 0.05 ? ` · +${point.y.toFixed(1)} m` : ''}`;
  }

  private closeSpawnSelection(cancelled: boolean): void {
    const selection = this.spawnSelection;
    if (!selection) return;
    this.spawnSelection = null;
    this.spawnPickerEl.hidden = true;
    if (!cancelled) return;
    if (this.sim.firstPerson.active) {
      this.cam.setFirstPersonMode(true, this.sim.firstPerson.yaw, Boolean(this.sim.firstPerson.weapon));
      this.cam.fpPitch = this.sim.firstPerson.pitch;
      this.fpsHudEl.classList.add('active');
    } else {
      this.cam.followAgentMode = selection.follow;
      this.cam.autoDirectorMode = selection.director;
      this.hudLayerEl.classList.remove('hidden');
    }
    if (!this.wasPausedBeforeRoles && this.isPaused) this.togglePause();
    this.roleOpener?.focus();
  }

  public enterFirstPersonMode(preset: 'city' | 'ktx_terminal' = 'city', role: PlayerRole = 'civilian',
    weapon?: PlayerWeapon, point?: PlayerSpawnPoint): void {
    this.modalEl.classList.add('hidden');
    if (this.isPaused) {
      this.togglePause();
    }
    this.simSpeed = 1;
    document.getElementById('btn-speed-1')?.classList.add('active');
    document.getElementById('btn-speed-2')?.classList.remove('active');
    document.getElementById('btn-speed-5')?.classList.remove('active');

    this.sim.enterFirstPerson(preset, role, weapon, point);
    this.cam.setFirstPersonMode(true, this.sim.firstPerson.yaw, Boolean(this.sim.firstPerson.weapon));
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

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
    const btn = document.getElementById('btn-play-pause')!;
    btn.textContent = this.isPaused ? '▶' : '⏸';
    btn.classList.toggle('active', !this.isPaused);
  }

  public togglePause(): void {
    this.setPaused(!this.isPaused);
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
    this.refreshPoliceRadio();

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
      ? this.t(`⚡ ${stats.commandPoints} CP`, `⚡ ${stats.commandPoints} 指挥点`)
      : this.t('🔒 LOCKED', '🔒 已锁定');

    const outbreakStatus = this.worldLabel(stats.outbreakStatus);
    this.statusBadgeEl.textContent = this.sim.config.id === 'breach_siege'
      ? this.siegeWaveStatus()
      : stats.hordeWave > 0
      ? this.t(`WAVE ${stats.hordeWave}`, `第 ${stats.hordeWave} 波`) + ` • ${outbreakStatus}`
      : outbreakStatus;
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
      ? this.worldLabel(this.sim.prioritySector.district)
      : this.t('All Sectors', '全部区域');

    if (this.sim.defenseWalls.length > 0) {
      const lineColor = (status: string) =>
        status === 'BREACHED' ? '#ef4444' : status === 'WITHDRAWN' ? '#fbbf24' : '#22c55e';
      const l1Color = lineColor(stats.line1Status);
      const l2Color = lineColor(stats.line2Status);
      const l3Color = lineColor(stats.line3Status);
      const l3Tag =
        stats.line3Status !== 'NONE'
          ? ` • <span style="color:${l3Color};font-weight:700;">${this.t('L3', '防线 3')} · ${this.worldLabel(stats.line3Status)}</span>`
          : '';
      const train = this.sim.expressTrain;
      const load = `${train.currentLoad}/${train.layout.capacity}`;
      const quarantineTag = train.state === 'QUARANTINE'
        ? ` • ${this.t('Quarantine', '隔离中')} ${Math.ceil(train.timer)}s · ${this.t('Infected', '感染者')} ${this.sim.countTrainInfected()}` : '';
      const boardingThreat = this.sim.layeredKtx && train.state === 'DOCKED' ? this.trainInfectedStatus() : '';
      const trainTag = this.sim.city.hasExpressRail ? ` • 🚄 ${this.t('Train load', '本班载客')} ${load} · ${this.t('Total boarded', '累计登车')} ${stats.trainBoarded}${boardingThreat}${quarantineTag}` : '';
      const apc = this.sim.extractionApc;
      const apcPhase = !apc.active
        ? ''
        : apc.state === 'STANDBY'
        ? this.t('Standby', '待命')
        : apc.state === 'WARMING_UP'
        ? this.t(`Warming ${Math.max(0, Math.ceil(apc.timer))}s`, `预热 ${Math.max(0, Math.ceil(apc.timer))} 秒`)
        : apc.state === 'BOARDING'
        ? this.t('Boarding', '登车中')
        : apc.state === 'DEPARTING'
        ? this.t('Departing', '突围中')
        : this.t('Escaped', '已撤离');
      const apcTag = apc.active
        ? ` • 🚐 ${this.t('APC-01', 'APC-01 装甲车')} ${apcPhase} · ${this.t('Aboard', '载客')} ${apc.boardedCount}`
        : '';
      this.defenseLinesStatusEl.innerHTML =
        `<span style="color:${l1Color};font-weight:700;">${this.t('L1', '防线 1')} · ${this.worldLabel(stats.line1Status)}</span> • ` +
        `<span style="color:${l2Color};font-weight:700;">${this.t('L2', '防线 2')} · ${this.worldLabel(stats.line2Status)}</span>${l3Tag}${trainTag}${apcTag}`;
    } else {
      this.defenseLinesStatusEl.textContent = '';
    }
    this.refreshDefenseGateBars();

    if (this.sim.firstPerson.active) {
      this.refreshFirstPersonHud(stats.line1Status, stats.line2Status, stats.line3Status);
    }

    // Update non-blocking Crisis Alert Toast
    if (this.sim.lastAlert) {
      const ageMs = performance.now() - this.sim.lastAlert.timestamp;
      if (this.sim.lastAlert.timestamp !== this.lastShownAlertTime) {
        this.lastShownAlertTime = this.sim.lastAlert.timestamp;
        const alert = this.sim.lastAlert.text;
        this.alertToastEl.textContent = this.t(alert, translateGameplayAlert(alert));
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

    const banner = this.sim.crisisBanner;
    if (this.crisisBannerEl && banner && this.sim.simTime - banner.timestamp < banner.duration) {
      if (this.crisisBannerTitleEl) {
        this.crisisBannerTitleEl.textContent = this.t(banner.titleEn, banner.titleZh);
      }
      if (this.crisisBannerSubEl) {
        const sub = this.t(banner.subtitleEn, banner.subtitleZh);
        this.crisisBannerSubEl.textContent = this.language === 'zh' ? translateWorldLabel(sub) : sub;
      }
      this.crisisBannerEl.className = banner.severity === 'warn'
        ? 'sev-warn'
        : banner.severity === 'info'
        ? 'sev-info'
        : '';
    } else if (this.crisisBannerEl) {
      this.crisisBannerEl.className = 'hidden';
    }

    if (
      !this.sim.firstPerson.active &&
      !this.aarAutoShownForRun &&
      (stats.outbreakStatus === 'CONTAINED' || stats.outbreakStatus === 'CRITICAL COLLAPSE') &&
      stats.simTime >= 15
    ) {
      this.aarAutoShownForRun = true;
      this.openAarModal();
    }

    this.drawOutbreakChart();
    this.drawMinimap();
    this.refreshEventLog();
    this.refreshInspector();
  }

  public updateAimFeedback(
    feedback: boolean | {
      hit: boolean;
      headshot: boolean;
      reloadProgress: number;
      spread: number;
      damageFlash: number;
      damageRelAngle: number;
      ads?: boolean;
      activeReloadState?: 'none' | 'perfect' | 'jammed';
      activeReloadAttempted?: boolean;
    }
  ): void {
    const state = typeof feedback === 'boolean'
      ? {
          hit: feedback,
          headshot: false,
          reloadProgress: 0,
          spread: 0,
          damageFlash: 0,
          damageRelAngle: 0,
          ads: false,
          activeReloadState: 'none' as const,
          activeReloadAttempted: false
        }
      : feedback;
    const reloading = state.reloadProgress > 0;
    const activeFeedback = state.activeReloadState ?? 'none';
    const showRing = reloading || activeFeedback !== 'none';
    this.fpsCrosshairEl.classList.toggle('hit', state.hit);
    this.fpsCrosshairEl.classList.toggle('headshot', state.headshot);
    this.fpsCrosshairEl.classList.toggle('reloading', reloading);
    this.fpsCrosshairEl.classList.toggle('ads', Boolean(state.ads));
    this.fpsCrosshairEl.style.setProperty('--spread', state.spread.toFixed(4));
    if (this.fpsReloadRingEl) {
      this.fpsReloadRingEl.classList.toggle('active', showRing);
      this.fpsReloadRingEl.classList.toggle('perfect', activeFeedback === 'perfect');
      this.fpsReloadRingEl.classList.toggle('jammed', activeFeedback === 'jammed');
      const deg = activeFeedback === 'perfect' ? 360 : Math.max(0, Math.min(1, state.reloadProgress)) * 360;
      this.fpsReloadRingEl.style.setProperty('--reload-deg', `${deg.toFixed(1)}deg`);
    }
    if (this.fpsReloadSweetEl) {
      this.fpsReloadSweetEl.classList.toggle('active', reloading && !state.activeReloadAttempted);
    }
    if (this.fpsReloadBadgeEl) {
      const inSweetSpot = reloading && !state.activeReloadAttempted &&
        state.reloadProgress >= 0.55 && state.reloadProgress <= 0.74;
      const showBadge = activeFeedback !== 'none' || inSweetSpot;
      this.fpsReloadBadgeEl.classList.toggle('active', showBadge);
      this.fpsReloadBadgeEl.classList.toggle('perfect', activeFeedback === 'perfect');
      this.fpsReloadBadgeEl.classList.toggle('jammed', activeFeedback === 'jammed');
      this.fpsReloadBadgeEl.textContent =
        activeFeedback === 'perfect'
          ? this.t('⚡ PERFECT', '⚡ 完美换弹')
          : activeFeedback === 'jammed'
          ? this.t('⚠ JAMMED', '⚠ 卡壳')
          : inSweetSpot
          ? this.t('[R] FAST!', '[R] 完美时机')
          : '';
    }
    if (state.damageFlash > 0) {
      this.fpsHitIndicatorEl.style.setProperty('--hit-angle', `${state.damageRelAngle.toFixed(1)}deg`);
      this.fpsHitIndicatorEl.style.opacity = `${Math.min(0.95, state.damageFlash * 1.75).toFixed(2)}`;
    } else {
      this.fpsHitIndicatorEl.style.opacity = '0';
    }
  }

  public updateFirstPersonTacticalOverlays(): void {
    const fp = this.sim.firstPerson;
    const player = this.sim.getAgentById(fp.playerId);
    if (!fp.active || fp.outcome !== 'PLAYING' || !player) {
      this.fpsKillCalloutEl?.classList.remove('active');
      return;
    }

    if (this.fpsKillCalloutEl) {
      const callout = fp.lastCallout;
      const active = Boolean(callout && this.sim.simTime - callout.timestamp < 1.65);
      this.fpsKillCalloutEl.className = active && callout ? `active ${callout.kind}` : '';
      if (active && callout) {
        this.fpsKillCalloutEl.textContent = this.t(callout.textEn, callout.textZh);
      }
    }

    if (!this.fpsCompassTicksEl || !this.fpsCompassPipsEl) return;
    const yaw = this.cam.isFirstPerson ? this.cam.fpYaw : fp.yaw;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const relDegForDir = (dx: number, dz: number): number => {
      const right = dx * cosY - dz * sinY;
      const forward = -dx * sinY - dz * cosY;
      return (Math.atan2(right, forward) * 180) / Math.PI;
    };
    const toPercent = (deg: number) => 50 + (deg / 85) * 46;

    const cardinals: Array<[string, string, number, number, boolean]> = [
      ['N', '北', 0, -1, true],
      ['NE', '东北', 0.707, -0.707, false],
      ['E', '东', 1, 0, true],
      ['SE', '东南', 0.707, 0.707, false],
      ['S', '南', 0, 1, true],
      ['SW', '西南', -0.707, 0.707, false],
      ['W', '西', -1, 0, true],
      ['NW', '西北', -0.707, -0.707, false]
    ];
    const tickEntries: Array<{ text: string; pct: number; cardinal: boolean }> = [];
    for (const [en, zh, dx, dz, major] of cardinals) {
      const deg = relDegForDir(dx, dz);
      if (Math.abs(deg) > 85) continue;
      tickEntries.push({ text: this.t(en, zh), pct: toPercent(deg), cardinal: major });
    }
    const tickKey = tickEntries.map((t) => `${t.text}:${t.pct.toFixed(1)}`).join('|');
    if (tickKey !== this.lastCompassTickKey) {
      this.lastCompassTickKey = tickKey;
      this.fpsCompassTicksEl.replaceChildren(
        ...tickEntries.map((entry) => {
          const el = document.createElement('span');
          el.className = entry.cardinal ? 'compass-tick cardinal' : 'compass-tick';
          el.style.left = `${entry.pct.toFixed(1)}%`;
          el.textContent = entry.text;
          return el;
        })
      );
    }

    const pips: Array<{ icon: string; cls: string; pct: number; edge: boolean }> = [];
    const addPip = (icon: string, cls: string, tx: number, tz: number, clampEdge = false) => {
      const deg = relDegForDir(tx - player.x, tz - player.z);
      if (!clampEdge && Math.abs(deg) > 85) return;
      const clampedDeg = Math.max(-85, Math.min(85, deg));
      pips.push({ icon, cls, pct: toPercent(clampedDeg), edge: Math.abs(deg) > 85 });
    };

    if (this.sim.city.hasExpressRail) {
      addPip('🚄', 'ktx', this.sim.city.stationPos.x, this.sim.city.stationPos.z, true);
    } else if (this.sim.extractionApc.active) {
      addPip('🚐', 'ktx', this.sim.extractionApc.x, this.sim.extractionApc.z, true);
    } else if (this.sim.evacZones[0]) {
      addPip('★', 'ktx', this.sim.evacZones[0].x, this.sim.evacZones[0].z, true);
    }

    if (fp.mission && !fp.mission.complete) {
      addPip('◆', 'mission', fp.mission.x, fp.mission.z, true);
    }

    for (const gate of this.sim.blastGates) {
      if (gate.breached) continue;
      const critical = gate.integrity / gate.maxIntegrity < 0.35;
      const underAttack = this.sim.simTime - gate.lastDamagedAt < 4.0;
      if (critical || underAttack) {
        addPip('⚠', 'gate', gate.x, gate.z, critical);
      }
    }

    if (fp.weapon && fp.weapon.reserve < PLAYER_WEAPONS[fp.weapon.id].capacity * 2) {
      const stash = this.sim.findNearestAmmoCache(player, true);
      if (stash) {
        addPip('▣', 'ammo', stash.x, stash.z, false);
      }
    }

    const pipKey = pips.map((p) => `${p.icon}:${p.cls}:${p.pct.toFixed(1)}:${p.edge ? 1 : 0}`).join('|');
    if (pipKey !== this.lastCompassPipKey) {
      this.lastCompassPipKey = pipKey;
      this.fpsCompassPipsEl.replaceChildren(
        ...pips.map((p) => {
          const el = document.createElement('span');
          el.className = `compass-pip ${p.cls}`;
          el.style.left = `${p.pct.toFixed(1)}%`;
          if (p.edge) el.style.opacity = '0.72';
          el.textContent = p.icon;
          return el;
        })
      );
    }
  }

  private refreshFirstPersonHud(
    line1Status: string,
    line2Status: string,
    line3Status: string
  ): void {
    const fp = this.sim.firstPerson;
    const order = this.sim.commanderOrder;
    const waveSummary = this.sim.config.id === 'breach_siege' ? ` • ${this.siegeWaveStatus()}` : '';
    this.fpsCommanderStatusEl.textContent = `${this.t('AI Commander', 'AI 指挥官')} · ${this.t(order, translateCommanderOrder(order))}${waveSummary}`;
    const player = this.sim.getAgentById(fp.playerId);
    this.refreshNearbyGateBar(player);
    const weapon = fp.weapon;
    const mission = fp.mission;
    const activeMission = mission && !mission.complete ? mission : null;

    const station = this.sim.city.stationPos;
    const targetZ = activeMission?.z ?? fp.waypointZ;
    const targetX = activeMission?.x ?? fp.waypointX;
    const distToGoal = player ? Math.round(Math.hypot(player.x - targetX, player.z - targetZ)) : 0;

    const compassArrow = player ? this.compassArrow(targetX - player.x, targetZ - player.z, fp.yaw) : '⬆';

    const insideBld = fp.insideBuildingId
      ? this.sim.city.buildingById.get(fp.insideBuildingId)
      : undefined;
    const locTag =
      fp.insideExtractionApc
        ? this.t(' • Inside APC-01', ' · APC-01 装甲车内')
        : fp.insideTrainCar > 0
        ? this.t(` • Inside KTX Car ${fp.insideTrainCar}`, ` · KTX ${fp.insideTrainCar} 号车厢`)
        : insideBld
        ? ` • ${this.t('Inside', '室内')} · ${this.worldLabel(insideBld.name)}`
        : '';
    const chaseTag = fp.pursuers > 0
      ? this.t(` • ⚠ ${fp.pursuers} CHASING`, ` · ⚠ ${fp.pursuers} 名感染者追击中`)
      : this.t(' • ✓ CLEAR', ' · ✓ 暂时安全');
    const wpLabel = this.worldLabel(
      fp.waypointLabel ||
        (this.sim.city.hasExpressRail
          ? 'South Express Station'
          : this.sim.extractionApc.active
          ? 'APC-01 Extraction Garage'
          : 'Evac Zone')
    );
    const distance = this.t(`${distToGoal}m`, `${distToGoal} 米`);
    const roleName = this.t(...PLAYER_ROLE_NAMES[fp.role]);
    this.fpsObjectiveEl.textContent = weapon
      ? activeMission
        ? `${compassArrow} ${activeMission.kind === 'hold' ? this.t('Hold', '守住') : this.t('Clear', '清剿')} · ${this.worldLabel(activeMission.district)} (${distance})${chaseTag}`
        : `${roleName}${chaseTag}`
      : `${compassArrow} ${wpLabel} (${distance})${locTag}${chaseTag}`;

    const seconds = Math.ceil(activeMission?.remaining ?? 0);
    const levelHint = activeMission && player && Math.abs(activeMission.y - player.climbY) > 1.5
      ? activeMission.y > player.climbY ? this.t(' · Wall top', ' · 目标在墙顶') : this.t(' · Ground level', ' · 目标在地面')
      : '';
    this.fpsMissionDetailEl.textContent = !weapon ? ''
      : activeMission
      ? (activeMission.kind === 'hold'
        ? this.t(`Hold within 10m for ${seconds}s`, `在目标 10 米内坚守 ${seconds} 秒`)
        : activeMission.hostiles > 0
        ? this.t(
          `Marked infected ${activeMission.hostiles}/${activeMission.totalTargets} · eliminate or drive out`,
          `标记目标剩余 ${activeMission.hostiles}/${activeMission.totalTargets} · 击杀或赶出目标区`
        )
        : this.t(`Area clear · verify from within 16m for ${seconds}s`, `区域已清理 · 在目标 16 米内确认 ${seconds} 秒`))
        + levelHint + this.t(' · M Replace', ' · M 换任务')
      : !this.sim.config.allowPlayerIntervention
        ? this.t('Commander assignments disabled in this scenario', '这个场景关闭了指挥官任务')
        : mission?.complete
        ? this.t('Mission complete · ammunition resupplied · M for next assignment', '任务完成 · 已补充备弹 · M 接下一项任务')
        : this.t('Press M to request an assignment', '按 M 向指挥官接取任务');

    this.fpsKillRewardEl.hidden = !weapon;
    this.fpsWeaponStatusEl.hidden = !weapon;
    if (weapon) {
      const progress = `${fp.killRewardProgress}/${PLAYER_KILL_REWARD.kills}`;
      const reward = PLAYER_WEAPONS[weapon.id].capacity * PLAYER_KILL_REWARD.magazines;
      const pending = fp.killRewardAmmo > 0
        ? this.t(` · ${fp.killRewardAmmo} rounds banked`, ` · 已存 ${fp.killRewardAmmo} 发`)
        : '';
      this.fpsKillRewardEl.textContent = this.t(`Kill reward ${progress} · +${reward} rounds`, `击杀奖励 ${progress} · +${reward} 发`) + pending;
      const ammo = `${weapon.ammo} / ${weapon.reserve}`;
      const action = weapon.reloadTimer > 0
        ? this.t(' · Reloading', ' · 换弹中')
        : weapon.ammo === 0 && weapon.reserve === 0 ? this.t(' · Out of ammo', ' · 弹药耗尽') : '';
      const stash = player && weapon.reserve < PLAYER_WEAPONS[weapon.id].capacity * 2
        ? this.sim.findNearestAmmoCache(player, true)
        : null;
      let supply = '';
      if (player && stash) {
        const dx = stash.x - player.x;
        const dz = stash.z - player.z;
        const arrow = this.compassArrow(dx, dz, fp.yaw);
        const meters = Math.round(Math.hypot(dx, dz));
        supply = this.t(` · ${arrow} Ammo ${meters}m`, ` · ${arrow} 弹药箱 ${meters} 米`);
      }
      this.fpsWeaponStatusEl.textContent = `${roleName} · ${this.t(...WEAPON_NAMES[weapon.id])} · ${ammo}${action}${supply}`;
    }

    if (this.sim.city.hasExpressRail && station) {
      const train = this.sim.expressTrain;
      const trainSeconds = Math.max(0, Math.ceil(train.timer));
      const phaseLabel =
        train.state === 'DOCKED'
          ? this.t(`BOARDING AT STATION (${trainSeconds}s)`, `站台登车（${trainSeconds} 秒）`)
          : train.state === 'APPROACHING'
          ? this.t('INBOUND TO PLATFORM', '正在进站')
          : train.state === 'DEPARTING'
          ? this.t(`IN TRANSIT (${trainSeconds}s)`, `行驶中（${trainSeconds} 秒）`)
          : train.state === 'QUARANTINE'
          ? this.t(`QUARANTINE (${trainSeconds}s)`, `终点隔离（${trainSeconds} 秒）`)
          : this.t(`NEXT TRAIN IN ${trainSeconds}s`, `下一班 ${trainSeconds} 秒后到达`);
      const linesSummary =
        line3Status !== 'NONE'
          ? `1 ${this.worldLabel(line1Status)} / 2 ${this.worldLabel(line2Status)} / 3 ${this.worldLabel(line3Status)}`
          : `1 ${this.worldLabel(line1Status)} / 2 ${this.worldLabel(line2Status)}`;
      const load = `${train.currentLoad}/${train.layout.capacity}`;
      const threat = this.trainInfectedStatus();
      this.fpsTrainStatusEl.textContent = `${this.t('KTX Express', 'KTX 特快')} · ${phaseLabel} • ${this.t("Passengers", "载客")} ${load}${threat} • ${linesSummary}`;
    } else if (this.sim.extractionApc.active) {
      const apc = this.sim.extractionApc;
      const apcSecs = Math.max(0, Math.ceil(apc.timer));
      const apcPhase =
        apc.state === 'STANDBY'
          ? this.t('STANDBY — Reach Garage & Press [E]', '待命 · 抵达车库按 E 启动引擎')
          : apc.state === 'WARMING_UP'
          ? this.t(`WARMING UP (${apcSecs}s) — Hold Garage`, `引擎预热中（${apcSecs} 秒）· 守住车库`)
          : apc.state === 'BOARDING'
          ? this.t('BOARDING — Rear Ramp Open [E]', '尾门已开启 · 按 E 登车撤离')
          : apc.state === 'DEPARTING'
          ? this.t('ESCAPING TUNNEL', '正在冲破撤离隧道')
          : this.t('ESCAPED', '已成功撤离');
      const linesSummary =
        line3Status !== 'NONE'
          ? `1 ${this.worldLabel(line1Status)} / 2 ${this.worldLabel(line2Status)} / 3 ${this.worldLabel(line3Status)}`
          : `1 ${this.worldLabel(line1Status)} / 2 ${this.worldLabel(line2Status)}`;
      this.fpsTrainStatusEl.textContent = `${this.t('APC-01', 'APC-01 装甲撤离车')} · ${apcPhase} • ${this.t('Aboard', '车载')} ${apc.boardedCount} • ${linesSummary}`;
    } else {
      this.fpsTrainStatusEl.textContent = weapon ? '' : this.t('Reach evacuation safely', '安全抵达撤离区');
    }

    const hpPct = player ? Math.max(0, Math.min(100, (player.health / player.maxHealth) * 100)) : 0;
    this.fpsHpTextEl.textContent = player?.isIncubating
      ? `${Math.ceil(hpPct)} ${this.t('(INF)', '（感染）')}`
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
    this.fpsStamTextEl.textContent = fp.adrenalineTimer > 0 ? this.t('⚡MAX', '⚡满') : `${Math.round(stamPct)}`;
    this.fpsStamFillEl.style.width = `${stamPct}%`;
    this.fpsStamFillEl.style.background = fp.adrenalineTimer > 0 ? '#22d3ee' : '#38bdf8';

    const distDanger =
      fp.nearestZombieDist < 8.5
        ? ((8.5 - fp.nearestZombieDist) / 7.5) * 0.50
        : 0;
    const hpDanger = hpPct < 35 ? ((35 - hpPct) / 35) * 0.45 : 0;
    const danger = Math.min(0.68, Math.max(distDanger, hpDanger));
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
    const ammoCache = weapon ? this.sim.ammoCaches.find((cache) => cache.id === fp.nearbyAmmoId) : undefined;

    if (fp.wallLadder) {
      const message = fp.wallLadder === 'up'
        ? this.t('Press [E] to climb onto the wall', '按 E 登上城墙')
        : fp.wallLadder === 'down'
        ? this.t('Press [E] to climb down', '按 E 沿梯子下墙')
        : this.t('Climbing…', '正在攀爬…');
      this.fpsInteractPromptEl.textContent = message;
      this.fpsInteractPromptEl.style.borderColor = '#f59e0b';
      this.fpsInteractPromptEl.style.color = '#fde68a';
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (fp.skybridgeLadder) {
      const message = fp.skybridgeLadder === 'up'
        ? this.t('Press [E] to climb onto skybridge', '按 E 登上人行天桥')
        : fp.skybridgeLadder === 'down'
        ? this.t('Press [E] to climb down from skybridge', '按 E 离开人行天桥')
        : this.t('Climbing skybridge…', '正在攀爬天桥…');
      this.fpsInteractPromptEl.textContent = message;
      this.fpsInteractPromptEl.style.borderColor = '#38bdf8';
      this.fpsInteractPromptEl.style.color = '#bae6fd';
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (ammoCache && weapon) {
      const cooldown = Math.max(0, Math.ceil(ammoCache.readyAt - this.sim.simTime));
      const full = weapon.ammo === PLAYER_WEAPONS[weapon.id].capacity && weapon.reserve === PLAYER_WEAPONS[weapon.id].reserve;
      this.fpsInteractPromptEl.textContent = cooldown > 0
        ? this.t(`Ammo cache ready in ${cooldown}s`, `弹药箱 ${cooldown} 秒后恢复`)
        : full
          ? this.t('Ammo full', '弹药已满')
          : this.t('Press [E] to refill ammo', '按 E 补满弹药');
      this.fpsInteractPromptEl.style.borderColor = '#eab65e';
      this.fpsInteractPromptEl.style.color = '#fde68a';
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (fp.nearbyKtxGate) {
      const name = this.worldLabel(KTX_GATES[fp.nearbyKtxGate].label);
      this.fpsInteractPromptEl.textContent = this.sim.ktxGates[fp.nearbyKtxGate].open
        ? this.t('Press [E] to close ' + name, '按 E 关闭' + name)
        : this.t('Press [E] to open ' + name, '按 E 打开' + name);
      this.fpsInteractPromptEl.style.borderColor = '#f59e0b';
      this.fpsInteractPromptEl.style.color = '#fde68a';
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (fp.nearTrainCabinConsole) {
      this.fpsInteractPromptEl.textContent = this.t('Press [E] for emergency KTX departure', '按 E 启动 KTX 紧急发车');
      this.fpsInteractPromptEl.style.borderColor = '#22c55e';
      this.fpsInteractPromptEl.style.color = '#bbf7d0';
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (fp.nearExtractionApc) {
      if (fp.nearExtractionApc === 'ignite') {
        this.fpsInteractPromptEl.textContent = this.t(
          'Press [E] to ignite APC-01 & unseal escape tunnel',
          '按 E 启动 APC-01 并开启撤离通道'
        );
        this.fpsInteractPromptEl.style.borderColor = '#22c55e';
        this.fpsInteractPromptEl.style.color = '#bbf7d0';
      } else if (fp.nearExtractionApc === 'warming') {
        const secs = Math.max(0, Math.ceil(this.sim.extractionApc.timer));
        this.fpsInteractPromptEl.textContent = this.t(
          `APC-01 warming up (${secs}s) — defend the garage!`,
          `APC-01 预热中（${secs} 秒）— 守住撤离车库！`
        );
        this.fpsInteractPromptEl.style.borderColor = '#f59e0b';
        this.fpsInteractPromptEl.style.color = '#fde68a';
      } else {
        this.fpsInteractPromptEl.textContent = this.t('Press [E] to board APC-01', '按 E 登上 APC-01 装甲撤离车');
        this.fpsInteractPromptEl.style.borderColor = '#22c55e';
        this.fpsInteractPromptEl.style.color = '#bbf7d0';
      }
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (trainDoor) {
      const pct = Math.max(1, Math.ceil((trainDoor.integrity / trainDoor.maxIntegrity) * 100));
      this.fpsInteractPromptEl.textContent = this.t(
        `Press [E] to ${trainDoor.isLocked ? 'UNLOCK' : 'LOCK'} ${trainDoor.label} (${pct}%)`,
        `按 E ${trainDoor.isLocked ? '解锁' : '锁上'} ${this.worldLabel(trainDoor.label)}（${pct}%）`
      );
      this.fpsInteractPromptEl.style.borderColor = '#f59e0b';
      this.fpsInteractPromptEl.style.color = '#fde68a';
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (pickup) {
      this.fpsInteractPromptEl.textContent = this.t(`Press [E] to grab ${pickup.label}`, `按 E 拾取 ${this.worldLabel(pickup.label)}`);
      this.fpsInteractPromptEl.style.borderColor = '#22c55e';
      this.fpsInteractPromptEl.style.color = '#bbf7d0';
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (door) {
      const pct = Math.max(1, Math.ceil((door.integrity / door.maxIntegrity) * 100));
      this.fpsInteractPromptEl.textContent = this.t(
        `Press [E] to ${door.isLocked ? 'UNLOCK' : 'LOCK'} ${door.label} (${pct}%)`,
        `按 E ${door.isLocked ? '解锁' : '锁上'} ${this.worldLabel(door.label)}（${pct}%）`
      );
      this.fpsInteractPromptEl.style.borderColor = '#f59e0b';
      this.fpsInteractPromptEl.style.color = '#fde68a';
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (gate) {
      const closing = !gate.isOpen && gate.openFraction > 0;
      this.fpsInteractPromptEl.textContent = this.t(
        `${closing ? 'CLOSING · ' : ''}Press [E] to ${gate.isOpen ? 'SEAL' : 'OPEN'} ${gate.label}`,
        `${closing ? '关闭中 · ' : ''}按 E ${gate.isOpen ? '关闭' : '开启'}${this.worldLabel(gate.label)}`
      );
      this.fpsInteractPromptEl.style.borderColor = '#f59e0b';
      this.fpsInteractPromptEl.style.color = '#fde68a';
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (fp.nearbyCarId !== null) {
      this.fpsInteractPromptEl.textContent = this.t('Press [E] to trigger car alarm', '按 E 触发汽车警报，引开尸群');
      this.fpsInteractPromptEl.style.borderColor = '#f59e0b';
      this.fpsInteractPromptEl.style.color = '#fde68a';
      this.fpsInteractPromptEl.style.display = 'block';
    } else if (fp.nearbyVaultLabel) {
      this.fpsInteractPromptEl.textContent = this.t(`Press [Space] to vault over ${fp.nearbyVaultLabel}`, `按空格翻越 ${this.worldLabel(fp.nearbyVaultLabel)}`);
      this.fpsInteractPromptEl.style.borderColor = '#38bdf8';
      this.fpsInteractPromptEl.style.color = '#bae6fd';
      this.fpsInteractPromptEl.style.display = 'block';
    } else {
      this.fpsInteractPromptEl.style.display = 'none';
    }

    const spaceTag =
      fp.nearbyVaultLabel !== null
        ? this.t('Space Vault', '空格翻越')
        : fp.shoveCooldown > 0
        ? this.t(`Shove ${fp.shoveCooldown.toFixed(1)}s`, `推搡冷却 ${fp.shoveCooldown.toFixed(1)} 秒`)
        : this.t('Space Vault/Shove', '空格翻越／推搡');
    const decoyTag =
      fp.decoyCooldown > 0
        ? this.t(`Decoy ${Math.ceil(fp.decoyCooldown)}s`, `诱饵冷却 ${Math.ceil(fp.decoyCooldown)} 秒`)
        : this.t('Q Decoy', 'Q 诱饵');
    const lightTag = this.t(' • T Light', ' · T 手电');
    const fireTag = weapon
      ? this.t(' • LMB/J Fire • RMB/V Aim • R Active Reload • M Orders', ' · 左键/J 开火 · 右键/V 瞄准 · R 完美换弹 · M 接任务')
      : '';
    const lookTag = document.pointerLockElement
      ? ''
      : this.t(' • L Lock Mouse / Right-drag Look', ' · L 锁定鼠标／右键拖动看向');
    this.fpsControlsHintEl.textContent = player?.onWallDeck || fp.wallLadder === 'climbing' ? this.t(
      `WASD Move along wall • Look down from the marked edge • E Ladder${lightTag}${fireTag}${lookTag}`,
      `WASD 沿墙移动 · 到黄线处俯瞰墙脚 · E 梯子${lightTag}${fireTag}${lookTag}`
    ) : fp.skybridgeLadder === 'down' || fp.skybridgeLadder === 'climbing' ? this.t(
      `WASD Move along skybridge • Aim over railing at street below • E Ladder${lightTag}${fireTag}${lookTag}`,
      `WASD 在天桥上移动 · 越过护栏向下射击 · E 离开天桥${lightTag}${fireTag}${lookTag}`
    ) : this.t(
      `WASD Move • Shift Sprint • ${spaceTag} • ${decoyTag} • E Interact${lightTag}${fireTag}${lookTag}`,
      `WASD 移动 · Shift 冲刺 · ${spaceTag} · ${decoyTag} · E 互动${lightTag}${fireTag}${lookTag}`
    );

    if (fp.outcome && fp.outcome !== 'PLAYING') {
      this.fpsOutcomeCardEl.classList.add('active');
      if (this.fpsOutcomeStatsEl) {
        const shotsFired = fp.shotsFired ?? 0;
        const acc = shotsFired > 0 ? Math.round(((fp.shotsHit ?? 0) / shotsFired) * 100) : 0;
        const combatLine = weapon || shotsFired > 0 || (fp.kills ?? 0) > 0
          ? this.t(
              ` · Kills ${fp.kills ?? 0} (HS ${fp.headshots ?? 0}) · Acc ${acc}% · Max Streak ${fp.maxKillStreak ?? 0}`,
              ` · 击杀 ${fp.kills ?? 0}（爆头 ${fp.headshots ?? 0}）· 命中率 ${acc}% · 最高连杀 ${fp.maxKillStreak ?? 0}`
            )
          : '';
        this.fpsOutcomeStatsEl.textContent = this.t(
          `Survived ${Math.round(fp.survivalTime)}s${combatLine}`,
          `存活 ${Math.round(fp.survivalTime)} 秒${combatLine}`
        );
      }
      if (fp.outcome === 'ESCAPED') {
        this.fpsOutcomeTitleEl.textContent = this.t('SURVIVED — ESCAPED!', '成功撤离');
        this.fpsOutcomeTitleEl.style.color = '#22c55e';
        this.fpsOutcomeDescEl.textContent =
          this.t(
            `You made it out safely. Evacuated this round: ${this.sim.totalEvacuated}.`,
            `你已安全离开封锁区。本局已有 ${this.sim.totalEvacuated} 人成功撤离。`
          );
      } else if (fp.outcome === 'QUARANTINED') {
        this.fpsOutcomeTitleEl.textContent = this.t('TRAIN QUARANTINED', '列车隔离 · 撤离失败');
        this.fpsOutcomeTitleEl.style.color = '#ef4444';
        this.fpsOutcomeDescEl.textContent = this.t(
          'Infected remained aboard when the quarantine timer expired.',
          '隔离时间结束时车上仍有感染者，这班列车未计入成功撤离。');
      } else {
        this.fpsOutcomeTitleEl.textContent = this.t('INFECTED / OVERRUN', '已感染／被尸群攻陷');
        this.fpsOutcomeTitleEl.style.color = '#ef4444';
        this.fpsOutcomeDescEl.textContent =
          this.t('Choose another role or return to Commander View.', '选择另一个角色，或返回指挥官视角。');
      }
    } else {
      this.fpsOutcomeCardEl.classList.remove('active');
    }
  }

  private trainInfectedStatus(): string {
    const infected = this.sim.countTrainInfected();
    if (infected === 0) return '';
    const threshold = this.sim.expressTrain.state === 'DOCKED' ? `/${KTX_EMERGENCY_INFECTED}` : '';
    return this.t(` · Infected aboard ${infected}${threshold}`, ` · 车内感染者 ${infected}${threshold}`);
  }

  private compassArrow(dx: number, dz: number, yaw: number): string {
    const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const forward = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
    const octant = (Math.round(Math.atan2(right, forward) / (Math.PI / 4)) + 8) % 8;
    return ['⬆', '↗', '➡', '↘', '⬇', '↙', '⬅', '↖'][octant];
  }

  private drawOutbreakChart(): void {
    this.chartTimeLabel.textContent = `${Math.floor(this.sim.simTime)}s`;
    this.plotHistorySeries(this.chartCtx, this.chartCanvas.width, this.chartCanvas.height);
  }

  private plotHistorySeries(ctx: CanvasRenderingContext2D, w: number, h: number): void {
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
        const tail = toMapX(train.x + train.layout.rearX);
        const nose = toMapX(train.x + train.layout.frontX);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(tail, ry - 2.5, nose - tail, 5);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(nose - 5, ry - 1.5, 4, 3);
      }
    }

    if (this.sim.extractionApc.active) {
      const apc = this.sim.extractionApc;
      const gateY = toMapY(LAB_TUNNEL_GATE_Z);
      ctx.strokeStyle = apc.shutterOpenFraction > 0.7 ? '#22c55e' : '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(toMapX(-12), gateY);
      ctx.lineTo(toMapX(12), gateY);
      ctx.stroke();

      const ax = toMapX(apc.x);
      const ay = toMapY(apc.z);
      ctx.fillStyle = apc.state === 'BOARDING' || apc.state === 'DEPARTING' || apc.state === 'ESCAPED' ? '#22c55e' : '#38bdf8';
      ctx.fillRect(ax - 3.5, ay - 5.5, 7, 11);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(ax - 3.5, ay - 5.5, 7, 11);
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

    const pulsePhase = 0.5 + 0.5 * Math.sin(performance.now() * 0.01);
    for (const gate of this.sim.blastGates) {
      const gx = toMapX(gate.x);
      const gy = toMapY(gate.z);
      ctx.fillStyle = gate.breached ? '#ef4444' : gate.openFraction === 1 ? '#22c55e' : gate.openFraction === 0 ? '#38bdf8' : '#f59e0b';
      ctx.fillRect(gx - 3, gy - 2, 6, 4);
      if (!gate.breached && this.sim.simTime - gate.lastDamagedAt < 1.5) {
        ctx.strokeStyle = `rgba(239, 68, 68, ${(0.55 + pulsePhase * 0.45).toFixed(2)})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(gx, gy, 5 + pulsePhase * 4.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (this.sim.layeredKtx) {
      for (const id of KTX_GATE_IDS) {
        const kGate = this.sim.ktxGates[id];
        if (kGate.integrity > 0 && this.sim.simTime - kGate.lastDamagedAt < 1.5) {
          const pt = KTX_GATES[id];
          ctx.strokeStyle = `rgba(239, 68, 68, ${(0.55 + pulsePhase * 0.45).toFixed(2)})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(toMapX(pt.x), toMapY(pt.z), 4.5 + pulsePhase * 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
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

    for (const cache of this.sim.ammoCaches) {
      ctx.fillStyle = cache.readyAt <= this.sim.simTime ? '#f7ce79' : '#79674c';
      ctx.fillRect(toMapX(cache.x) - 1.8, toMapY(cache.z) - 1.8, 3.6, 3.6);
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
        ctx.fillStyle = a.isHunter ? '#c084fc' : a.isSwat ? '#06b6d4' : '#3b82f6';
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

  private refreshPoliceRadio(): void {
    this.radioPanel.classList.toggle('in-first-person', this.sim.firstPerson.active);
    const messages = this.sim.policeRadio;
    const latest = messages[messages.length - 1];
    const latestCount = latest && 'count' in latest.call ? latest.call.count : 0;
    const sig = latest
      ? `${messages.length}:${latest.call.kind}:${latestCount}:${latest.time.toFixed(2)}`
      : 'empty';
    if (sig === this.lastRadioSignature) return;
    this.lastRadioSignature = sig;

    const follow = this.radioLog.scrollHeight - this.radioLog.clientHeight - this.radioLog.scrollTop <= 8;
    for (const [message, entry] of this.radioRows) {
      if (!messages.includes(message)) {
        entry.row.remove();
        this.radioRows.delete(message);
      }
    }
    for (const message of messages) {
      const msgCount = 'count' in message.call ? message.call.count : undefined;
      const existing = this.radioRows.get(message);
      if (existing) {
        if (existing.lastTime !== message.time || existing.lastCount !== msgCount) {
          const { text } = describeRadio(message, this.language);
          existing.time.textContent = this.sim.formatClock(message.time);
          existing.body.textContent = text;
          existing.lastTime = message.time;
          existing.lastCount = msgCount;
        }
        continue;
      }
      const { speaker, text } = describeRadio(message, this.language);
      const row = document.createElement('li');
      const { kind } = message.call;
      row.classList.toggle('radio-priority', kind === 'warning' || kind === 'support' || kind === 'fallback');
      const name = document.createElement('strong');
      name.textContent = speaker;
      const time = document.createElement('time');
      time.textContent = this.sim.formatClock(message.time);
      const body = document.createElement('div');
      body.textContent = text;
      row.append(name, time, body);
      this.radioLog.append(row);
      this.radioRows.set(message, { row, time, body, lastTime: message.time, lastCount: msgCount });
    }
    if (follow) this.radioLog.scrollTop = this.radioLog.scrollHeight;
  }

  private refreshDefenseGateBars(): void {
    const bars = this.sim.blastGates.map((gate) => {
      const compact = gate.label.match(/^Line (\d+) (West|East) Gate$/);
      const name = compact
        ? this.t(`L${compact[1]} ${compact[2]}`, `${compact[1]} 线${compact[2] === 'West' ? '西闸' : '东闸'}`)
        : this.worldLabel(gate.label);
      return this.gateBar(name, { ...gate, open: gate.isOpen });
    });
    if (this.sim.layeredKtx) {
      bars.push(this.gateBar(this.t('KTX East Gate', '车站东闸'), this.sim.ktxGates.public));
      bars.push(this.gateBar(this.t('KTX West Gate', '车站西闸'), this.sim.ktxGates.crew));
      bars.push(this.gateBar(this.t('KTX Mezzanine', '夹层咽喉闸'), this.sim.ktxGates.mezzanine));
      bars.push(this.gateBar(this.t('KTX Partition', '站台隔门'), this.sim.ktxGates.transfer));
    }
    this.defenseGateBarsEl.hidden = bars.length === 0;
    this.defenseGateBarsEl.innerHTML = bars.join('');
  }

  private refreshNearbyGateBar(player: AgentData | null): void {
    let closest: { name: string; gate: GateStatus } | undefined;
    let distance = Infinity;
    const consider = (label: string, gate: GateStatus, x: number, z: number, range: number) => {
      if (!player) return;
      const d = Math.hypot(x - player.x, z - player.z);
      if (d <= range && d < distance) {
        closest = { name: this.worldLabel(label), gate };
        distance = d;
      }
    };
    if (player) {
      for (const gate of this.sim.blastGates) {
        consider(gate.label, { ...gate, open: gate.isOpen }, gate.x, gate.z, 15);
      }
      if (this.sim.layeredKtx) {
        for (const id of KTX_GATE_IDS) {
          const point = KTX_GATES[id];
          if (Math.abs(player.climbY - point.y) <= 1.5) {
            consider(point.label, this.sim.ktxGates[id], point.x, point.z, 11);
          }
        }
      }
      const train = this.sim.expressTrain;
      if (this.sim.firstPerson.insideTrainCar > 0) {
        for (const door of train.doors) {
          consider(door.label, { ...door, open: !door.isLocked, breached: door.isBroken, lastDamagedAt: door.lastHitTime },
            train.x + door.localX, train.z, 7);
        }
      }
    }
    this.fpsGateBarEl.hidden = !closest;
    this.fpsGateBarEl.innerHTML = closest ? this.gateBar(closest.name, closest.gate) : '';
  }

  private gateBar(name: string, gate: GateStatus): string {
    const breached = gate.breached || gate.integrity <= 0;
    const ratio = breached ? 0 : Math.min(1, gate.integrity / gate.maxIntegrity);
    const percent = Math.ceil(ratio * 100);
    const attacked = !breached && this.sim.simTime - gate.lastDamagedAt < 0.9;
    const color = ratio <= 0.3 ? '#f87171' : ratio <= 0.6 || attacked ? '#fbbf24' : '#4ade80';
    const state = breached ? this.t('Breached', '已失守')
      : gate.open ? (gate.openFraction ?? 1) < 1 ? this.t('Opening', '开启中') : this.t('Open', '已开启')
      : (gate.openFraction ?? 0) > 0 ? this.t('Closing', '关闭中') : this.t('Closed', '已关闭');
    const status = attacked ? `${state} · ${this.t('Under attack', '受击')}` : state;
    return `<div class="gate-status-bar" data-attacked="${attacked}" style="--gate-color:${color}">
      <div class="gate-status-head"><span class="gate-status-name">${name}</span><b class="gate-status-value">${percent}%</b></div>
      <div class="gate-status-track" role="progressbar" aria-label="${name}" aria-valuenow="${percent}"><div class="gate-status-fill" style="width:${ratio * 100}%"></div></div>
      <div class="gate-status-state">${status}</div>
    </div>`;
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
      const time = document.createElement('span');
      time.className = 'event-time';
      time.textContent = `[${item.formattedTime}]`;
      div.append(time, this.t(item.message, translateGameplayAlert(item.message)));
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
      stateStr = `${agent.isHunter ? this.t('HUNTER TEAM', '机动清剿队') : agent.isSwat ? 'SWAT' : 'POLICE'} • ${agent.policeState}`;
      barColor = agent.isHunter ? '#c084fc' : agent.isSwat ? '#06b6d4' : '#3b82f6';
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
