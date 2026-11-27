import type { PlayerWeapon } from './types';

const PLAYER_SHOT_SOUND: Record<PlayerWeapon, { length: number; tone: number; bass: number; gain: number }> = {
  pistol: { length: 0.11, tone: 1950, bass: 145, gain: 0.33 },
  carbine: { length: 0.095, tone: 1460, bass: 105, gain: 0.36 },
  shotgun: { length: 0.19, tone: 870, bass: 74, gain: 0.46 }
};

/**
 * Web Audio API Procedural Sound Synthesizer for PROJECT OUTBREAK.
 * Synthesizes gunshots, SWAT shotgun blasts, radio dispatch chirps, medic cure chimes,
 * infection growls, and tactical UI confirmation clicks with zero external audio dependencies.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterOut: AudioNode | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private radioGain: GainNode | null = null;
  private dangerLowpass: BiquadFilterNode | null = null;
  private masterVol = 0.85;
  private sfxVol = 1.0;
  private ambientVol = 0.85;
  private radioVol = 0.85;
  public enabled = true;
  private lastShotTime = 0;
  private lastBiteTime = 0;
  private lastDoorPoundTime = 0;
  private lastHitTime = 0;
  private lastHeadshotTime = 0;
  private lastDryFireTime = 0;
  private lastCrisisChimeTime = 0;
  private lastTyrantStepTime = 0;
  private lastTyrantRoarTime = 0;
  private heartbeatTimer = 0;
  private growlTimer = 0;
  private sharedNoise: AudioBuffer | null = null;

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        const t = this.ctx.currentTime;
        const compressor = this.ctx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-14, t);
        compressor.knee.setValueAtTime(18, t);
        compressor.ratio.setValueAtTime(6, t);
        compressor.attack.setValueAtTime(0.004, t);
        compressor.release.setValueAtTime(0.14, t);
        compressor.connect(this.ctx.destination);

        const lowpass = this.ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.setValueAtTime(18000, t);
        lowpass.Q.setValueAtTime(0.8, t);
        lowpass.connect(compressor);

        const master = this.ctx.createGain();
        master.gain.setValueAtTime(this.masterVol, t);
        master.connect(lowpass);

        const sfx = this.ctx.createGain();
        sfx.gain.setValueAtTime(this.sfxVol, t);
        sfx.connect(master);

        const ambient = this.ctx.createGain();
        ambient.gain.setValueAtTime(this.ambientVol, t);
        ambient.connect(master);

        const radio = this.ctx.createGain();
        radio.gain.setValueAtTime(this.radioVol, t);
        radio.connect(master);

        this.dangerLowpass = lowpass;
        this.masterGain = master;
        this.sfxGain = sfx;
        this.ambientGain = ambient;
        this.radioGain = radio;
        this.masterOut = master;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private getBus(ctx: AudioContext, bus: 'sfx' | 'ambient' | 'radio'): AudioNode {
    if (bus === 'sfx' && this.sfxGain) return this.sfxGain;
    if (bus === 'ambient' && this.ambientGain) return this.ambientGain;
    if (bus === 'radio' && this.radioGain) return this.radioGain;
    return this.masterOut ?? ctx.destination;
  }

  public setVolumes(vols: { master: number; sfx: number; ambient: number; radio: number }): void {
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    this.masterVol = clamp(vols.master);
    this.sfxVol = clamp(vols.sfx);
    this.ambientVol = clamp(vols.ambient);
    this.radioVol = clamp(vols.radio);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.masterGain?.gain.setTargetAtTime(this.masterVol, t, 0.02);
    this.sfxGain?.gain.setTargetAtTime(this.sfxVol, t, 0.02);
    this.ambientGain?.gain.setTargetAtTime(this.ambientVol, t, 0.02);
    this.radioGain?.gain.setTargetAtTime(this.radioVol, t, 0.02);
  }

  public suspend(): void {
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  public resume(): void {
    if (this.enabled && this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public resetDangerFilter(): void {
    if (this.ctx && this.dangerLowpass) {
      this.dangerLowpass.frequency.setTargetAtTime(18000, this.ctx.currentTime, 0.12);
    }
  }

  private getSharedNoise(ctx: AudioContext): AudioBuffer {
    if (!this.sharedNoise) {
      const len = Math.floor(ctx.sampleRate * 0.65);
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) {
        samples[i] = Math.random() * 2 - 1;
      }
      this.sharedNoise = buffer;
    }
    return this.sharedNoise;
  }

  public toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.ensureContext();
      this.playRadioChirp();
    }
    return this.enabled;
  }

  /**
   * Computes volume attenuation based on distance from 3D camera target
   */
  private getSpatialGain(x: number, z: number, camX: number, camZ: number, camDist: number): number {
    const d = Math.hypot(x - camX, z - camZ);
    const maxHear = Math.max(55, camDist * 1.15);
    if (d > maxHear) return 0;
    const falloff = 1 - d / maxHear;
    return Math.max(0.02, Math.min(0.45, falloff * falloff * 0.45));
  }

  public playGunshot(x: number, z: number, camX: number, camZ: number, camDist: number, isSwat = false): void {
    const nowMs = performance.now();
    if (nowMs - this.lastShotTime < 55) return;
    this.lastShotTime = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const gainVal = this.getSpatialGain(x, z, camX, camZ, camDist);
    if (gainVal <= 0.01) return;

    const t = ctx.currentTime;
    const dur = isSwat ? 0.16 : 0.11;

    const noise = ctx.createBufferSource();
    noise.buffer = this.getSharedNoise(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(isSwat ? 750 : 1200, t);
    filter.frequency.exponentialRampToValueAtTime(isSwat ? 280 : 420, t + dur);
    filter.Q.setValueAtTime(1.1, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal * (isSwat ? 1.25 : 0.9), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.getBus(ctx, 'sfx'));
    noise.start(t, Math.random() * 0.25, dur);
    noise.stop(t + dur);
  }

  public playRadioChirp(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1560, t);
    osc.frequency.setValueAtTime(1920, t + 0.045);

    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);

    osc.connect(gain);
    gain.connect(this.getBus(ctx, 'radio'));
    osc.start(t);
    osc.stop(t + 0.11);
  }

  public playPlayerShot(weapon: PlayerWeapon, remainingInMag?: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const out = this.getBus(ctx, 'sfx');
    const profile = PLAYER_SHOT_SOUND[weapon];
    const time = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this.getSharedNoise(ctx);
    const crack = ctx.createBiquadFilter();
    crack.type = 'bandpass';
    crack.frequency.setValueAtTime(profile.tone, time);
    crack.frequency.exponentialRampToValueAtTime(380, time + profile.length);
    crack.Q.value = 0.72;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(profile.gain, time);
    gain.gain.exponentialRampToValueAtTime(0.004, time + profile.length);
    noise.connect(crack).connect(gain).connect(out);
    noise.start(time, Math.random() * 0.25, profile.length);
    noise.stop(time + profile.length);

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(profile.bass, time);
    thump.frequency.exponentialRampToValueAtTime(profile.bass * 0.46, time + 0.075);
    const low = ctx.createGain();
    low.gain.setValueAtTime(profile.gain * 0.36, time);
    low.gain.exponentialRampToValueAtTime(0.002, time + 0.075);
    thump.connect(low).connect(out);
    thump.start(time);
    thump.stop(time + 0.076);

    const lowThreshold = weapon === 'shotgun' ? 1 : 3;
    if (remainingInMag !== undefined && remainingInMag <= lowThreshold) {
      const ping = ctx.createOscillator();
      const pGain = ctx.createGain();
      const empty = remainingInMag === 0;
      ping.type = 'triangle';
      ping.frequency.setValueAtTime(empty ? 2420 : 2200, time + 0.015);
      ping.frequency.exponentialRampToValueAtTime(1480, time + 0.08);
      pGain.gain.setValueAtTime(empty ? 0.14 : 0.075, time + 0.015);
      pGain.gain.exponentialRampToValueAtTime(0.001, time + 0.082);
      ping.connect(pGain).connect(out);
      ping.start(time + 0.015);
      ping.stop(time + 0.085);
    }
  }

  public playDryFire(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastDryFireTime < 220) return;
    this.lastDryFireTime = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.getBus(ctx, 'sfx');

    const noise = ctx.createBufferSource();
    noise.buffer = this.getSharedNoise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(3200, t);
    filter.Q.setValueAtTime(2.4, t);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.14, t);
    nGain.gain.exponentialRampToValueAtTime(0.002, t + 0.032);
    noise.connect(filter).connect(nGain).connect(out);
    noise.start(t, Math.random() * 0.2, 0.035);
    noise.stop(t + 0.035);

    const click = ctx.createOscillator();
    click.type = 'triangle';
    click.frequency.setValueAtTime(1400, t);
    click.frequency.exponentialRampToValueAtTime(680, t + 0.035);
    const cGain = ctx.createGain();
    cGain.gain.setValueAtTime(0.12, t);
    cGain.gain.exponentialRampToValueAtTime(0.002, t + 0.036);
    click.connect(cGain).connect(out);
    click.start(t);
    click.stop(t + 0.038);
  }

  public playActiveReload(success: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.getBus(ctx, 'sfx');
    if (success) {
      const bolt = ctx.createOscillator();
      const bGain = ctx.createGain();
      bolt.type = 'triangle';
      bolt.frequency.setValueAtTime(980, t);
      bolt.frequency.exponentialRampToValueAtTime(1580, t + 0.085);
      bGain.gain.setValueAtTime(0.12, t);
      bGain.gain.exponentialRampToValueAtTime(0.002, t + 0.1);
      bolt.connect(bGain).connect(out);
      bolt.start(t);
      bolt.stop(t + 0.105);

      const chime = ctx.createOscillator();
      const cGain = ctx.createGain();
      chime.type = 'sine';
      chime.frequency.setValueAtTime(1560, t + 0.02);
      cGain.gain.setValueAtTime(0.09, t + 0.02);
      cGain.gain.exponentialRampToValueAtTime(0.002, t + 0.12);
      chime.connect(cGain).connect(out);
      chime.start(t + 0.02);
      chime.stop(t + 0.125);
    } else {
      for (const offset of [0, 0.045]) {
        const start = t + offset;
        const clack = ctx.createOscillator();
        const cGain = ctx.createGain();
        clack.type = 'sawtooth';
        clack.frequency.setValueAtTime(240, start);
        clack.frequency.exponentialRampToValueAtTime(120, start + 0.04);
        cGain.gain.setValueAtTime(0.09, start);
        cGain.gain.exponentialRampToValueAtTime(0.002, start + 0.045);
        clack.connect(cGain).connect(out);
        clack.start(start);
        clack.stop(start + 0.048);
      }
    }
  }

  public playFlashlightClick(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2400, t);
    osc.frequency.exponentialRampToValueAtTime(1150, t + 0.024);
    gain.gain.setValueAtTime(0.085, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
    osc.connect(gain).connect(this.getBus(ctx, 'sfx'));
    osc.start(t);
    osc.stop(t + 0.028);
  }

  public playAdrenalineSurge(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(96, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.34);
    gain.gain.setValueAtTime(0.002, t);
    gain.gain.linearRampToValueAtTime(0.24, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.002, t + 0.36);
    osc.connect(gain).connect(this.getBus(ctx, 'ambient'));
    osc.start(t);
    osc.stop(t + 0.37);
  }

  public playHitFlesh(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastHitTime < 40) return;
    this.lastHitTime = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.getBus(ctx, 'sfx');

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(215, t);
    osc.frequency.exponentialRampToValueAtTime(75, t + 0.065);
    const oGain = ctx.createGain();
    oGain.gain.setValueAtTime(0.18, t);
    oGain.gain.exponentialRampToValueAtTime(0.002, t + 0.065);
    osc.connect(oGain).connect(out);
    osc.start(t);
    osc.stop(t + 0.068);

    const noise = ctx.createBufferSource();
    noise.buffer = this.getSharedNoise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(920, t);
    filter.Q.setValueAtTime(1.1, t);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.13, t);
    nGain.gain.exponentialRampToValueAtTime(0.002, t + 0.055);
    noise.connect(filter).connect(nGain).connect(out);
    noise.start(t, Math.random() * 0.3, 0.055);
    noise.stop(t + 0.056);
  }

  public playHeadshot(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastHeadshotTime < 45) return;
    this.lastHeadshotTime = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.getBus(ctx, 'sfx');

    const crunch = ctx.createOscillator();
    crunch.type = 'sawtooth';
    crunch.frequency.setValueAtTime(1450, t);
    crunch.frequency.exponentialRampToValueAtTime(620, t + 0.075);
    const cGain = ctx.createGain();
    cGain.gain.setValueAtTime(0.16, t);
    cGain.gain.exponentialRampToValueAtTime(0.002, t + 0.078);
    crunch.connect(cGain).connect(out);
    crunch.start(t);
    crunch.stop(t + 0.08);

    const ping = ctx.createOscillator();
    ping.type = 'sine';
    ping.frequency.setValueAtTime(2600, t);
    ping.frequency.exponentialRampToValueAtTime(1900, t + 0.095);
    const pGain = ctx.createGain();
    pGain.gain.setValueAtTime(0.14, t);
    pGain.gain.exponentialRampToValueAtTime(0.002, t + 0.095);
    ping.connect(pGain).connect(out);
    ping.start(t);
    ping.stop(t + 0.098);
  }

  public playReload(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const out = this.getBus(ctx, 'sfx');
    for (const [offset, frequency] of [[0, 620], [0.12, 1050]]) {
      const start = ctx.currentTime + offset;
      const click = ctx.createOscillator();
      click.type = 'triangle';
      click.frequency.setValueAtTime(frequency, start);
      click.frequency.exponentialRampToValueAtTime(frequency * 0.44, start + 0.045);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.055, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.045);
      click.connect(gain);
      gain.connect(out);
      click.start(start);
      click.stop(start + 0.05);
    }
  }

  public playMedicCure(x: number, z: number, camX: number, camZ: number, camDist: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const gainVal = this.getSpatialGain(x, z, camX, camZ, camDist);
    if (gainVal <= 0.01) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(587.33, t); // D5
    osc.frequency.setValueAtTime(880.0, t + 0.08); // A5

    gain.gain.setValueAtTime(gainVal * 0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

    osc.connect(gain);
    gain.connect(this.getBus(ctx, 'sfx'));
    osc.start(t);
    osc.stop(t + 0.24);
  }

  public playInfectionBite(x: number, z: number, camX: number, camZ: number, camDist: number): void {
    const nowMs = performance.now();
    if (nowMs - this.lastBiteTime < 140) return;
    this.lastBiteTime = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;
    const gainVal = this.getSpatialGain(x, z, camX, camZ, camDist);
    if (gainVal <= 0.01) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(65, t + 0.14);

    gain.gain.setValueAtTime(gainVal * 0.45, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(gain);
    gain.connect(this.getBus(ctx, 'sfx'));
    osc.start(t);
    osc.stop(t + 0.15);
  }

  public playAlertSiren(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.linearRampToValueAtTime(780, t + 0.22);
    osc.frequency.linearRampToValueAtTime(520, t + 0.44);

    gain.gain.setValueAtTime(0.09, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.48);

    osc.connect(gain);
    gain.connect(this.getBus(ctx, 'ambient'));
    osc.start(t);
    osc.stop(t + 0.48);
  }

  public playExplosion(x: number, z: number, camX: number, camZ: number, camDist: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dist = Math.hypot(x - camX, z - camZ);
    const vol = Math.max(0.06, Math.min(0.65, 1.0 - dist / (camDist * 1.9 + 80)));
    const t = ctx.currentTime;
    const out = this.getBus(ctx, 'sfx');

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(115, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.55);
    oscGain.gain.setValueAtTime(vol * 0.65, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.62);
    osc.connect(oscGain);
    oscGain.connect(out);
    osc.start(t);
    osc.stop(t + 0.64);

    const noise = ctx.createBufferSource();
    noise.buffer = this.getSharedNoise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, t);
    filter.frequency.exponentialRampToValueAtTime(160, t + 0.48);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(vol * 0.55, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(out);
    noise.start(t, Math.random() * 0.1, 0.5);
    noise.stop(t + 0.5);
  }

  public playTrainHorn(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.getBus(ctx, 'ambient');
    const freqs = [277.18, 349.23, 415.3];
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.linearRampToValueAtTime(f * 0.985, t + 0.85);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(980, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.085, t + 0.08);
      gain.gain.setValueAtTime(0.08, t + 0.6);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.92);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + 0.94);
    }
  }

  public playGateSlam(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.24);
    gain.gain.setValueAtTime(0.28, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    osc.connect(gain);
    gain.connect(this.getBus(ctx, 'ambient'));
    osc.start(t);
    osc.stop(t + 0.28);
  }

  public playWindowShatter(x: number, z: number, camX: number, camZ: number, camDist: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const gainVal = this.getSpatialGain(x, z, camX, camZ, camDist);
    if (gainVal <= 0.01) return;

    const t = ctx.currentTime;
    const out = this.getBus(ctx, 'sfx');
    const noise = ctx.createBufferSource();
    noise.buffer = this.getSharedNoise(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(2200, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal * 1.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    noise.start(t, Math.random() * 0.25, 0.24);
    noise.stop(t + 0.24);

    // Secondary brittle glass tinkle burst
    const osc = ctx.createOscillator();
    const oGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(3400, t + 0.03);
    osc.frequency.exponentialRampToValueAtTime(1600, t + 0.16);
    oGain.gain.setValueAtTime(gainVal * 0.22, t + 0.03);
    oGain.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
    osc.connect(oGain);
    oGain.connect(out);
    osc.start(t + 0.03);
    osc.stop(t + 0.18);
  }

  public playBodyThud(x: number, z: number, camX: number, camZ: number, camDist: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const gainVal = this.getSpatialGain(x, z, camX, camZ, camDist);
    if (gainVal <= 0.01) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(115, t);
    osc.frequency.exponentialRampToValueAtTime(34, t + 0.19);
    gain.gain.setValueAtTime(gainVal * 1.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.21);
    osc.connect(gain);
    gain.connect(this.getBus(ctx, 'sfx'));
    osc.start(t);
    osc.stop(t + 0.22);
  }

  public playDoorPound(x: number, z: number, camX: number, camZ: number, camDist: number): void {
    const nowMs = performance.now();
    if (nowMs - this.lastDoorPoundTime < 320) return;
    this.lastDoorPoundTime = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;
    const gainVal = this.getSpatialGain(x, z, camX, camZ, camDist);
    if (gainVal <= 0.01) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(98, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    gain.gain.setValueAtTime(gainVal * 1.05, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc.connect(gain);
    gain.connect(this.getBus(ctx, 'sfx'));
    osc.start(t);
    osc.stop(t + 0.14);
  }

  public playCarAlarm(x: number, z: number, camX: number, camZ: number, camDist: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const gainVal = this.getSpatialGain(x, z, camX, camZ, camDist);
    if (gainVal <= 0.01) return;

    const t = ctx.currentTime;
    const out = this.getBus(ctx, 'ambient');
    for (const freq of [440, 554.37]) {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1600, t);
      gain.gain.setValueAtTime(gainVal * 0.26, t);
      gain.gain.setValueAtTime(gainVal * 0.24, t + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + 0.26);
    }
  }

  public updateFirstPersonHorrorAudio(dt: number, nearestZombieDist: number, hpRatio = 1, pursuers = 0): void {
    const clampedHp = Math.max(0, Math.min(1, hpRatio));
    const distUrgency = nearestZombieDist < 18 ? Math.max(0, Math.min(1, (18 - nearestZombieDist) / 14)) : 0;
    const hpUrgency = clampedHp < 0.42 ? Math.max(0, Math.min(1, (0.42 - clampedHp) / 0.32)) : 0;
    const crowdUrgency = pursuers >= 3 ? Math.min(1, (pursuers - 2) * 0.25) : 0;
    const urgency = Math.max(distUrgency, hpUrgency, crowdUrgency * 0.75);

    if (!this.enabled) {
      this.heartbeatTimer = 0.15;
      this.growlTimer = 0.6;
      return;
    }
    const ctx = this.ctx;
    if (ctx && this.dangerLowpass) {
      const targetCutoff = clampedHp < 0.32 ? 1150 + (clampedHp / 0.32) * 4500 : 18000;
      this.dangerLowpass.frequency.setTargetAtTime(targetCutoff, ctx.currentTime, 0.12);
    }
    if (urgency <= 0.08 && nearestZombieDist >= 13) {
      this.heartbeatTimer = 0.15;
      this.growlTimer = 0.6;
      return;
    }
    const activeCtx = this.ensureContext();
    if (!activeCtx) return;
    const out = this.getBus(activeCtx, 'ambient');

    if (urgency > 0.08) {
      const beatInterval = Math.max(0.38, 1.05 - urgency * 0.65);
      this.heartbeatTimer -= dt;
      if (this.heartbeatTimer <= 0) {
        this.heartbeatTimer = beatInterval;
        const t = activeCtx.currentTime;
        const vol = 0.08 + urgency * 0.22;

        const triggerThump = (offset: number, peakGain: number) => {
          const osc = activeCtx.createOscillator();
          const gain = activeCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(60 + urgency * 14, t + offset);
          osc.frequency.exponentialRampToValueAtTime(30, t + offset + 0.14);
          gain.gain.setValueAtTime(0.001, t + offset);
          gain.gain.linearRampToValueAtTime(peakGain, t + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.16);
          osc.connect(gain);
          gain.connect(out);
          osc.start(t + offset);
          osc.stop(t + offset + 0.18);
        };

        triggerThump(0, vol);
        triggerThump(0.16, vol * 0.68);
      }
    }

    if (nearestZombieDist < 13) {
      this.growlTimer -= dt;
      if (this.growlTimer <= 0) {
        this.growlTimer = 1.6 + Math.random() * 1.6 - urgency * 0.6;
        const t = activeCtx.currentTime;
        const osc = activeCtx.createOscillator();
        const filter = activeCtx.createBiquadFilter();
        const gain = activeCtx.createGain();

        osc.type = 'sawtooth';
        const baseFreq = 78 + Math.random() * 34;
        osc.frequency.setValueAtTime(baseFreq, t);
        osc.frequency.linearRampToValueAtTime(baseFreq * 0.68, t + 0.42);

        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(240 + urgency * 180, t);
        filter.Q.setValueAtTime(2.6, t);

        const gVol = 0.04 + urgency * 0.12;
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(gVol, t + 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(out);
        osc.start(t);
        osc.stop(t + 0.46);
      }
    }
  }

  public playBruteDown(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.getBus(ctx, 'sfx');

    const sub = ctx.createOscillator();
    const sGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(110, t);
    sub.frequency.exponentialRampToValueAtTime(36, t + 0.28);
    sGain.gain.setValueAtTime(0.26, t);
    sGain.gain.exponentialRampToValueAtTime(0.002, t + 0.29);
    sub.connect(sGain).connect(out);
    sub.start(t);
    sub.stop(t + 0.3);

    const chime = ctx.createOscillator();
    const cGain = ctx.createGain();
    chime.type = 'triangle';
    chime.frequency.setValueAtTime(1760, t);
    chime.frequency.exponentialRampToValueAtTime(1320, t + 0.14);
    cGain.gain.setValueAtTime(0.14, t);
    cGain.gain.exponentialRampToValueAtTime(0.002, t + 0.15);
    chime.connect(cGain).connect(out);
    chime.start(t);
    chime.stop(t + 0.16);
  }

  public playCrisisChime(severity: 'warn' | 'danger' | 'info'): void {
    const nowMs = performance.now();
    if (nowMs - this.lastCrisisChimeTime < 1200) return;
    this.lastCrisisChimeTime = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.getBus(ctx, 'ambient');

    if (severity === 'info') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, t);
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.002, t + 0.14);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.15);
      return;
    }

    const pairs = severity === 'danger' ? [880, 660] : [740, 980];
    const wave: OscillatorType = severity === 'danger' ? 'triangle' : 'sine';
    pairs.forEach((freq, idx) => {
      const start = t + idx * 0.11;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.09, start);
      gain.gain.exponentialRampToValueAtTime(0.002, start + 0.12);
      osc.connect(gain).connect(out);
      osc.start(start);
      osc.stop(start + 0.13);
    });
  }

  public playTyrantRoar(x: number, z: number, camX: number, camZ: number, camDist: number): void {
    const nowMs = performance.now();
    if (nowMs - this.lastTyrantRoarTime < 1400) return;
    this.lastTyrantRoarTime = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;
    const gainVal = Math.max(0.28, this.getSpatialGain(x, z, camX, camZ, Math.min(camDist, 140)));
    const t = ctx.currentTime;
    const out = this.getBus(ctx, 'sfx');

    // Deep guttural bioweapon sub-roar + metallic resonator growl
    for (const [wave, f0, f1, mul] of [
      ['sawtooth', 78, 42, 0.36],
      ['triangle', 118, 56, 0.24],
      ['square', 52, 34, 0.18]
    ] as Array<[OscillatorType, number, number, number]>) {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + 1.05);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(420, t);
      filter.frequency.exponentialRampToValueAtTime(140, t + 1.05);
      filter.Q.setValueAtTime(3.2, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(gainVal * mul, t + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.002, t + 1.12);
      osc.connect(filter).connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 1.15);
    }
  }

  public playTyrantFootstep(x: number, z: number, camX: number, camZ: number, camDist: number): void {
    const nowMs = performance.now();
    if (nowMs - this.lastTyrantStepTime < 220) return;
    this.lastTyrantStepTime = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;
    const gainVal = this.getSpatialGain(x, z, camX, camZ, Math.min(camDist, 45));
    if (gainVal <= 0.02) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(84, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.18);
    gain.gain.setValueAtTime(gainVal * 0.72, t);
    gain.gain.exponentialRampToValueAtTime(0.002, t + 0.19);
    osc.connect(gain).connect(this.getBus(ctx, 'sfx'));
    osc.start(t);
    osc.stop(t + 0.2);
  }

  public playLabDevice(kind: 'cryo_valve' | 'turret_console' | 'backup_generator'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.getBus(ctx, 'sfx');

    if (kind === 'cryo_valve') {
      // Pressurized liquid nitrogen vent hiss
      const buf = this.getSharedNoise(ctx);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2800, t);
      bp.frequency.exponentialRampToValueAtTime(950, t + 0.85);
      bp.Q.setValueAtTime(1.4, t);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.28, t + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.002, t + 0.88);
      src.connect(bp).connect(gain).connect(out);
      src.start(t);
      src.stop(t + 0.9);
      return;
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    if (kind === 'backup_generator') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(62, t);
      osc.frequency.exponentialRampToValueAtTime(210, t + 0.65);
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.002, t + 0.68);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.7);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(720, t);
      osc.frequency.setValueAtTime(1080, t + 0.08);
      osc.frequency.setValueAtTime(1440, t + 0.16);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.002, t + 0.28);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.3);
    }
  }
}
