import * as THREE from 'three';
import { AgentData } from './types';

export class CameraController {
  public camera: THREE.PerspectiveCamera;
  public target = new THREE.Vector3(0, 0, 0);
  public desiredTarget = new THREE.Vector3(0, 0, 0);

  public worldHalfSize = 112;
  public worldHalfX = 112;
  public worldHalfZ = 112;
  public theta = Math.PI * 0.22;
  public phi = 0.82;
  public distance = 104;

  private desiredTheta = Math.PI * 0.22;
  private desiredPhi = 0.82;
  private desiredDistance = 104;

  public followAgentMode = false;
  public autoDirectorMode = false;
  private directorTimer = 0;

  private isOrbiting = false;
  private isPanning = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private keysPressed: Set<string> = new Set();
  private pendingKeyPresses: Set<string> = new Set();

  public isFirstPerson = false;
  public fpYaw = Math.PI;
  public fpPitch = -0.02;
  public fpMouseSensitivity = 1.0;
  public fpBaseFov = 68;
  public enableCameraShake = true;
  private fpIsAds = false;
  private fpDragButton = 0;
  private fpAllowLeftDrag = true;
  private fpIgnoreLockedMotionUntil = 0;
  private fpBob = 0;
  private fpRoll = 0;
  private fpRecoilPitch = 0;
  private fpRecoilYaw = 0;
  private fpShake = 0;
  private fpShakePhase = 0;
  private domElement: HTMLElement;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.bindEvents(domElement);
    this.updateCameraTransform(1);
  }

  public setWorldSize(halfSize: number): void {
    this.setWorldBounds(halfSize, halfSize);
  }

  public setWorldBounds(halfX: number, halfZ: number): void {
    this.worldHalfX = halfX;
    this.worldHalfZ = halfZ;
    this.worldHalfSize = Math.max(halfX, halfZ);
    this.clampTarget();
  }

  public setAerialAngle(theta: number, phi: number): void {
    this.theta = theta;
    this.desiredTheta = theta;
    this.phi = phi;
    this.desiredPhi = phi;
    this.updateCameraTransform(1);
  }

  private getMaxDistance(): number {
    return Math.max(210, Math.max(this.worldHalfX, this.worldHalfZ) * 2.1);
  }

  private requestMouseLock(): void {
    if (document.pointerLockElement === this.domElement) return;
    try {
      void Promise.resolve(this.domElement.requestPointerLock?.()).catch(() => {});
    } catch {
      // Locked mouse input may be unavailable in an embedded browser. Drag-to-look still works.
    }
  }

  private resetInput(): void {
    this.keysPressed.clear();
    this.pendingKeyPresses.clear();
    this.isOrbiting = false;
    this.isPanning = false;
    this.fpDragButton = 0;
    this.fpIgnoreLockedMotionUntil = performance.now() + 75;
  }

  private bindEvents(el: HTMLElement): void {
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    el.addEventListener('mousedown', (e) => {
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      if (this.isFirstPerson) {
        if (document.pointerLockElement !== el && (e.button === 2 || (e.button === 0 && this.fpAllowLeftDrag))) {
          this.fpDragButton = e.button === 2 ? 2 : 1;
        }
        return;
      }
      if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
        this.isOrbiting = true;
      } else if (e.button === 1 || (e.button === 0 && e.altKey)) {
        this.isPanning = true;
        this.followAgentMode = false;
        this.autoDirectorMode = false;
      }
    });

    el.addEventListener('dblclick', () => {
      if (this.isFirstPerson && this.fpAllowLeftDrag && document.pointerLockElement !== el) {
        this.requestMouseLock();
      }
    });

    window.addEventListener('mousemove', (e) => {
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      if (this.isFirstPerson) {
        const locked = document.pointerLockElement === el;
        if (locked && performance.now() < this.fpIgnoreLockedMotionUntil) return;
        if (!locked && (this.fpDragButton === 0 || (e.buttons & this.fpDragButton) === 0)) {
          this.fpDragButton = 0;
          return;
        }
        const moveX = locked ? e.movementX : dx;
        const moveY = locked ? e.movementY : dy;
        if (!Number.isFinite(moveX) || !Number.isFinite(moveY) || Math.hypot(moveX, moveY) > 320) return;
        const limit = locked ? 100 : 54;
        const sens = this.fpMouseSensitivity * (this.fpIsAds ? 0.62 : 1.0);
        this.fpYaw -= Math.max(-limit, Math.min(limit, moveX)) * (locked ? 0.0024 : 0.0042) * sens;
        this.fpPitch = Math.max(-1.52, Math.min(1.15,
          this.fpPitch - Math.max(-limit, Math.min(limit, moveY)) * (locked ? 0.0022 : 0.0038) * sens));
        return;
      }

      if (this.isOrbiting) {
        this.desiredTheta -= dx * 0.0065;
        this.desiredPhi = Math.max(0.22, Math.min(1.38, this.desiredPhi - dy * 0.006));
      } else if (this.isPanning) {
        this.panScreenDelta(-dx, -dy);
      }
    });

    window.addEventListener('mouseup', () => {
      this.isOrbiting = false;
      this.isPanning = false;
      this.fpDragButton = 0;
    });

    el.addEventListener(
      'wheel',
      (e) => {
        if (this.isFirstPerson) return;
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.11 : 0.9;
        this.desiredDistance = Math.max(
          14,
          Math.min(this.getMaxDistance(), this.desiredDistance * factor)
        );
      },
      { passive: false }
    );

    window.addEventListener('keydown', (e) => {
      if (document.activeElement?.matches('input, select, textarea, [contenteditable]')) return;
      const k = e.code === 'Space' ? ' ' : e.key.toLowerCase();
      if (this.isFirstPerson && k === 'l' && !e.repeat) {
        this.requestMouseLock();
        return;
      }
      if (this.isFirstPerson && k === ' ') {
        e.preventDefault();
      }
      this.keysPressed.add(k);
      if (!e.repeat) {
        this.pendingKeyPresses.add(k);
      }
    });

    window.addEventListener('keyup', (e) => {
      const k = e.code === 'Space' ? ' ' : e.key.toLowerCase();
      this.keysPressed.delete(k);
    });

    window.addEventListener('blur', () => this.resetInput());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.resetInput();
    });
    document.addEventListener('pointerlockchange', () => {
      if (this.isFirstPerson) this.resetInput();
    });
  }

  private panScreenDelta(dx: number, dy: number): void {
    const panScale = this.distance * 0.0016;
    const forwardX = -Math.sin(this.theta);
    const forwardZ = -Math.cos(this.theta);
    const rightX = Math.cos(this.theta);
    const rightZ = -Math.sin(this.theta);

    this.desiredTarget.x += (rightX * dx - forwardX * dy) * panScale;
    this.desiredTarget.z += (rightZ * dx - forwardZ * dy) * panScale;
    this.clampTarget();
  }

  private clampTarget(): void {
    const limitX = this.worldHalfX + 18;
    const limitZ = this.worldHalfZ + 18;
    this.desiredTarget.x = Math.max(-limitX, Math.min(limitX, this.desiredTarget.x));
    this.desiredTarget.z = Math.max(-limitZ, Math.min(limitZ, this.desiredTarget.z));
  }

  public focusOn(x: number, z: number, zoomDistance?: number): void {
    this.desiredTarget.set(x, 0, z);
    if (zoomDistance !== undefined) {
      this.desiredDistance = Math.max(14, Math.min(this.getMaxDistance(), zoomDistance));
      if (zoomDistance < 45) {
        this.desiredPhi = 0.62;
      }
    }
    this.clampTarget();
  }

  public snapToDesired(): void {
    this.target.copy(this.desiredTarget);
    this.theta = this.desiredTheta;
    this.phi = this.desiredPhi;
    this.distance = this.desiredDistance;
    this.updateCameraTransform(1);
  }

  public toggleAutoDirector(): boolean {
    this.autoDirectorMode = !this.autoDirectorMode;
    if (this.autoDirectorMode) {
      this.followAgentMode = false;
      this.directorTimer = 0;
    }
    return this.autoDirectorMode;
  }

  public setFirstPersonMode(active: boolean, initialYaw = Math.PI, armed = false): void {
    this.isFirstPerson = active;
    this.resetInput();
    this.fpAllowLeftDrag = !armed;
    this.fpBob = 0;
    this.fpRoll = 0;
    this.fpRecoilPitch = 0;
    this.fpRecoilYaw = 0;
    this.fpShake = 0;
    if (active) {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      this.fpYaw = initialYaw;
      this.fpPitch = -0.02;
      this.fpIsAds = false;
      this.followAgentMode = false;
      this.autoDirectorMode = false;
      this.camera.fov = this.fpBaseFov;
      this.camera.updateProjectionMatrix();
    } else {
      if (document.pointerLockElement === this.domElement) {
        document.exitPointerLock?.();
      }
      this.camera.fov = 46;
      this.camera.updateProjectionMatrix();
      this.camera.rotation.set(0, 0, 0);
      this.updateCameraTransform(1);
    }
  }

  public addFirstPersonRecoil(pitchKick: number, yawKick: number): void {
    const scale = this.enableCameraShake ? 1 : 0.35;
    this.fpRecoilPitch = Math.min(0.14, this.fpRecoilPitch + pitchKick * scale);
    this.fpRecoilYaw = Math.max(-0.08, Math.min(0.08, this.fpRecoilYaw + yawKick * scale));
  }

  public addFirstPersonShake(intensity: number): void {
    if (!this.enableCameraShake) return;
    this.fpShake = Math.min(0.12, Math.max(this.fpShake, intensity));
  }

  public isKeyDown(key: string): boolean {
    return this.keysPressed.has(key.toLowerCase());
  }

  public consumeKeyPress(key: string): boolean {
    const k = key.toLowerCase();
    if (this.pendingKeyPresses.has(k)) {
      this.pendingKeyPresses.delete(k);
      return true;
    }
    return false;
  }

  public updateFirstPersonAim(dt: number): void {
    if (this.keysPressed.has('arrowleft')) this.fpYaw += 1.9 * dt;
    if (this.keysPressed.has('arrowright')) this.fpYaw -= 1.9 * dt;
  }

  public updateFirstPerson(
    x: number,
    z: number,
    dt: number,
    isMoving: boolean,
    sprinting: boolean,
    time: number,
    vaultY = 0,
    vaultRoll = 0,
    ads = false
  ): void {
    this.fpIsAds = ads;
    const bobScale = this.enableCameraShake ? 1 : 0.25;
    const rollScale = this.enableCameraShake ? 1 : 0.2;
    const bob = isMoving
      ? Math.sin(time * (sprinting ? 14 : 9)) * (sprinting ? 0.045 : 0.026) * bobScale
      : 0;
    const roll = isMoving
      ? Math.cos(time * (sprinting ? 7 : 4.5)) * (sprinting ? 0.007 : 0.003) * rollScale
      : 0;
    const blend = 1 - Math.exp(-16 * dt);
    this.fpBob += (bob - this.fpBob) * blend;
    this.fpRoll += (roll + vaultRoll * 0.5 - this.fpRoll) * blend;

    const recoilDecay = Math.exp(-16 * dt);
    this.fpRecoilPitch *= recoilDecay;
    this.fpRecoilYaw *= recoilDecay;
    if (this.fpShake > 0.0002) {
      this.fpShakePhase += dt * 42;
      this.fpShake *= Math.exp(-11 * dt);
    } else {
      this.fpShake = 0;
    }
    const shakeX = this.fpShake * Math.sin(this.fpShakePhase);
    const shakeY = this.fpShake * Math.cos(this.fpShakePhase * 1.37) * 0.85;
    const shakeRoll = this.fpShake * Math.sin(this.fpShakePhase * 1.7) * 0.7;

    const targetFov = ads
      ? Math.max(46, this.fpBaseFov - 14)
      : sprinting && isMoving
      ? this.fpBaseFov + 5
      : this.fpBaseFov;
    const nextFov = this.camera.fov + (targetFov - this.camera.fov) * (1 - Math.exp(-8 * dt));
    if (Math.abs(nextFov - this.camera.fov) > 0.02) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.position.set(x, 1.68 + this.fpBob + vaultY, z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(
      this.fpPitch + this.fpRecoilPitch + shakeX,
      this.fpYaw + this.fpRecoilYaw + shakeY,
      this.fpRoll + shakeRoll
    );
  }

  public update(
    dt: number,
    followedAgent: AgentData | null,
    hotspotPos?: { x: number; z: number } | null
  ): void {
    if (this.isFirstPerson) return;
    const moveSpeed = Math.max(25, this.distance * 0.75) * dt;
    let moveForward = 0;
    let moveRight = 0;
    if (this.keysPressed.has('w') || this.keysPressed.has('arrowup')) moveForward += 1;
    if (this.keysPressed.has('s') || this.keysPressed.has('arrowdown')) moveForward -= 1;
    if (this.keysPressed.has('d') || this.keysPressed.has('arrowright')) moveRight += 1;
    if (this.keysPressed.has('a') || this.keysPressed.has('arrowleft')) moveRight -= 1;

    if (moveForward !== 0 || moveRight !== 0) {
      this.followAgentMode = false;
      this.autoDirectorMode = false;
      const forwardX = -Math.sin(this.theta);
      const forwardZ = -Math.cos(this.theta);
      const rightX = Math.cos(this.theta);
      const rightZ = -Math.sin(this.theta);

      this.desiredTarget.x += (forwardX * moveForward + rightX * moveRight) * moveSpeed;
      this.desiredTarget.z += (forwardZ * moveForward + rightZ * moveRight) * moveSpeed;
      this.clampTarget();
    }

    if (this.keysPressed.has('q')) this.desiredTheta += 1.6 * dt;
    if (this.keysPressed.has('e')) this.desiredTheta -= 1.6 * dt;

    if (this.followAgentMode && followedAgent && followedAgent.isAlive && !followedAgent.isEvacuated) {
      this.autoDirectorMode = false;
      this.desiredTarget.set(followedAgent.x, 0, followedAgent.z);
    } else if (this.autoDirectorMode) {
      this.desiredTheta += dt * 0.14;
      this.directorTimer -= dt;
      if (this.directorTimer <= 0) {
        this.directorTimer = 7.0;
        if (hotspotPos) {
          this.focusOn(hotspotPos.x, hotspotPos.z, Math.min(82, Math.max(46, this.worldHalfSize * 0.55)));
          this.desiredPhi = 0.72;
        }
      }
    }

    const lerpFactor = Math.min(1, dt * 8);
    this.updateCameraTransform(lerpFactor);
  }

  private updateCameraTransform(lerpFactor: number): void {
    this.theta += (this.desiredTheta - this.theta) * lerpFactor;
    this.phi += (this.desiredPhi - this.phi) * lerpFactor;
    this.distance += (this.desiredDistance - this.distance) * lerpFactor;
    this.target.lerp(this.desiredTarget, lerpFactor);

    const sinPhi = Math.sin(this.phi);
    const cosPhi = Math.cos(this.phi);
    const sinTheta = Math.sin(this.theta);
    const cosTheta = Math.cos(this.theta);

    this.camera.position.set(
      this.target.x + this.distance * sinPhi * sinTheta,
      this.target.y + this.distance * cosPhi,
      this.target.z + this.distance * sinPhi * cosTheta
    );
    this.camera.lookAt(this.target.x, 0.8, this.target.z);
  }
}
