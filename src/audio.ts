/**
 * Web Audio API Procedural Sound Synthesizer for PROJECT OUTBREAK.
 * Synthesizes gunshots, SWAT shotgun blasts, radio dispatch chirps, medic cure chimes,
 * infection growls, and tactical UI confirmation clicks with zero external audio dependencies.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  public enabled = true;
  private lastShotTime = 0;
  private lastBiteTime = 0;
  private heartbeatTimer = 0;
  private growlTimer = 0;

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
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

    // White noise burst for gunshot crack
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * (isSwat ? 0.045 : 0.028)));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(isSwat ? 750 : 1200, t);
    filter.Q.setValueAtTime(1.2, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal * (isSwat ? 1.25 : 0.9), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(t);
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
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.11);
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
    gain.connect(ctx.destination);
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
    gain.connect(ctx.destination);
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
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.48);
  }

  public playExplosion(x: number, z: number, camX: number, camZ: number, camDist: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dist = Math.hypot(x - camX, z - camZ);
    const vol = Math.max(0.06, Math.min(0.65, 1.0 - dist / (camDist * 1.9 + 80)));
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(115, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.55);
    oscGain.gain.setValueAtTime(vol * 0.65, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.62);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.64);

    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.8);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, t);
    filter.frequency.exponentialRampToValueAtTime(160, t + 0.48);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(vol * 0.55, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(t);
  }

  public playTrainHorn(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
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
      gain.connect(ctx.destination);
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
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.28);
  }

  public updateFirstPersonHorrorAudio(dt: number, nearestZombieDist: number): void {
    if (!this.enabled || nearestZombieDist > 18) {
      this.heartbeatTimer = 0.15;
      this.growlTimer = 0.6;
      return;
    }
    const ctx = this.ensureContext();
    if (!ctx) return;

    const urgency = Math.max(0, Math.min(1, (18 - nearestZombieDist) / 14));
    const beatInterval = 1.05 - urgency * 0.66;
    this.heartbeatTimer -= dt;
    if (this.heartbeatTimer <= 0) {
      this.heartbeatTimer = beatInterval;
      const t = ctx.currentTime;
      const vol = 0.08 + urgency * 0.22;

      const triggerThump = (offset: number, peakGain: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(60 + urgency * 14, t + offset);
        osc.frequency.exponentialRampToValueAtTime(30, t + offset + 0.14);
        gain.gain.setValueAtTime(0.001, t + offset);
        gain.gain.linearRampToValueAtTime(peakGain, t + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + offset);
        osc.stop(t + offset + 0.18);
      };

      triggerThump(0, vol);
      triggerThump(0.16, vol * 0.68);
    }

    if (nearestZombieDist < 12) {
      this.growlTimer -= dt;
      if (this.growlTimer <= 0) {
        this.growlTimer = 1.6 + Math.random() * 1.6 - urgency * 0.6;
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

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
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.46);
      }
    }
  }
}
