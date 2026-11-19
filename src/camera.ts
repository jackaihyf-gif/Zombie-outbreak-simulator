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

  public isFirstPerson = false;
  public fpYaw = Math.PI;
  public fpPitch = -0.02;
  private fpLooking = false;
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

  private bindEvents(el: HTMLElement): void {
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    el.addEventListener('mousedown', (e) => {
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      if (this.isFirstPerson) {
        if (e.button === 0 || e.button === 2) {
          this.fpLooking = true;
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
      if (this.isFirstPerson && document.pointerLockElement !== el) {
        el.requestPointerLock?.();
      }
    });

    window.addEventListener('mousemove', (e) => {
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      if (this.isFirstPerson) {
        if (document.pointerLockElement === el) {
          this.fpYaw -= e.movementX * 0.0024;
          this.fpPitch = Math.max(-1.15, Math.min(1.15, this.fpPitch - e.movementY * 0.0022));
        } else if (this.fpLooking) {
          this.fpYaw -= dx * 0.0055;
          this.fpPitch = Math.max(-1.15, Math.min(1.15, this.fpPitch - dy * 0.0045));
        }
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
      this.fpLooking = false;
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
      if (document.activeElement?.tagName === 'INPUT') return;
      this.keysPressed.add(e.key.toLowerCase());
    });

    window.addEventListener('keyup', (e) => {
      this.keysPressed.delete(e.key.toLowerCase());
    });

    window.addEventListener('blur', () => {
      this.keysPressed.clear();
      this.isOrbiting = false;
      this.isPanning = false;
      this.fpLooking = false;
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

  public setFirstPersonMode(active: boolean, initialYaw = Math.PI): void {
    this.isFirstPerson = active;
    this.isOrbiting = false;
    this.isPanning = false;
    this.fpLooking = false;
    if (active) {
      this.fpYaw = initialYaw;
      this.fpPitch = -0.02;
      this.followAgentMode = false;
      this.autoDirectorMode = false;
    } else {
      if (document.pointerLockElement === this.domElement) {
        document.exitPointerLock?.();
      }
      this.camera.rotation.set(0, 0, 0);
      this.updateCameraTransform(1);
    }
  }

  public isKeyDown(key: string): boolean {
    return this.keysPressed.has(key.toLowerCase());
  }

  public updateFirstPerson(
    x: number,
    z: number,
    dt: number,
    isMoving: boolean,
    sprinting: boolean,
    time: number
  ): void {
    if (this.keysPressed.has('arrowleft')) this.fpYaw += 1.9 * dt;
    if (this.keysPressed.has('arrowright')) this.fpYaw -= 1.9 * dt;
    const bob = isMoving
      ? Math.sin(time * (sprinting ? 14 : 9)) * (sprinting ? 0.075 : 0.04)
      : Math.sin(time * 1.8) * 0.008;
    const roll = isMoving
      ? Math.cos(time * (sprinting ? 7 : 4.5)) * (sprinting ? 0.012 : 0.005)
      : 0;
    this.camera.position.set(x, 1.68 + bob, z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.fpPitch, this.fpYaw, roll);
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
