import * as THREE from 'three';

export type AgentArchetype =
  | 'civilian'
  | 'police'
  | 'swat'
  | 'medic'
  | 'zombie_normal'
  | 'zombie_runner'
  | 'zombie_brute';

export interface AgentMaterialBundle {
  headMats: THREE.MeshStandardMaterial[];
  torsoMats: THREE.MeshStandardMaterial[];
  armMat: THREE.MeshStandardMaterial;
  legMat: THREE.MeshStandardMaterial;
}

export interface BuildingFacadeBundle {
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
}

export type NeonSignLabel =
  | 'CLINIC'
  | '24H MART'
  | 'MART'
  | 'HOTEL'
  | 'PHARMACY'
  | 'METRO'
  | 'RAMEN'
  | 'CAFE'
  | 'SUBWAY';

const PIXEL_FONT_5X5: Record<string, string[]> = {
  A: ['01110', '10001', '11111', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '11111'],
  F: ['11111', '10000', '11110', '10000', '10000'],
  G: ['01111', '10000', '10111', '10001', '01111'],
  H: ['10001', '10001', '11111', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '11100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001'],
  O: ['01110', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '11110', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10010', '01101'],
  R: ['11110', '10001', '11110', '10100', '10010'],
  S: ['01111', '10000', '01110', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10101', '11011', '10001'],
  X: ['10001', '01010', '00100', '01010', '10001'],
  Y: ['10001', '10001', '01110', '00100', '00100'],
  Z: ['11111', '00010', '00100', '01000', '11111'],
  '0': ['01110', '10011', '10101', '11001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '01110'],
  '2': ['11110', '00001', '01110', '10000', '11111'],
  '3': ['11110', '00001', '01110', '00001', '11110'],
  '4': ['10010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '11110'],
  '6': ['01111', '10000', '11110', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '00100'],
  '8': ['01110', '10001', '01110', '10001', '01110'],
  '9': ['01110', '10001', '01111', '00001', '11110'],
  '-': ['00000', '00000', '11111', '00000', '00000'],
  ':': ['00000', '00100', '00000', '00100', '00000'],
  '/': ['00001', '00010', '00100', '01000', '10000'],
  ' ': ['00000', '00000', '00000', '00000', '00000']
};

export class VoxelTextureStudio {
  private texCache = new Map<string, THREE.CanvasTexture>();
  private facadeCache = new Map<string, BuildingFacadeBundle>();
  private agentMatCache = new Map<AgentArchetype, AgentMaterialBundle>();

  private makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    return [canvas, ctx];
  }

  private finalizeTexture(
    canvas: HTMLCanvasElement,
    options: {
      repeatX?: number;
      repeatY?: number;
      nearestMin?: boolean;
      srgb?: boolean;
    } = {}
  ): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = options.nearestMin ? THREE.NearestFilter : THREE.NearestMipmapLinearFilter;
    tex.colorSpace = options.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    if (options.repeatX || options.repeatY) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(options.repeatX ?? 1, options.repeatY ?? 1);
    } else {
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
    }
    tex.needsUpdate = true;
    return tex;
  }

  private hash(x: number, y: number, seed = 17): number {
    let n = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
    n = ((n ^ (n >> 13)) * 1274126177) | 0;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
  }

  private createAgentFaceTexture(archetype: AgentArchetype, face: 'front' | 'back' | 'side' | 'top' | 'bot'): THREE.CanvasTexture {
    const key = `head-${archetype}-${face}`;
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(16, 16);

    const fillMottled = (palette: string[], seed: number) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const r = this.hash(x, y, seed);
          ctx.fillStyle = palette[Math.floor(r * palette.length)];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    };

    if (archetype === 'civilian') {
      // White/light skin base so instanceColor cleanly tints varied skin tones
      const hairCol = '#1c1815';
      const hairHi = '#2d2622';
      if (face === 'top' || face === 'back') {
        fillMottled([hairCol, hairCol, hairHi], 101);
        if (face === 'back') {
          ctx.fillStyle = '#e5e7eb';
          ctx.fillRect(0, 12, 16, 4);
        }
      } else if (face === 'bot') {
        ctx.fillStyle = '#d4d4d8';
        ctx.fillRect(0, 0, 16, 16);
      } else if (face === 'side') {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, 16, 16);
        fillMottled([hairCol, hairHi], 102);
        // Expose ear/cheek area
        ctx.fillStyle = '#f4f4f5';
        ctx.fillRect(2, 6, 10, 10);
        ctx.fillStyle = hairCol;
        ctx.fillRect(0, 0, 16, 5);
        ctx.fillRect(10, 5, 6, 6);
      } else {
        // Front face
        fillMottled(['#ffffff', '#fafafa', '#f3f4f6'], 103);
        // Hair fringe
        ctx.fillStyle = hairCol;
        ctx.fillRect(0, 0, 16, 4);
        ctx.fillRect(0, 4, 2, 2);
        ctx.fillRect(14, 4, 2, 2);
        ctx.fillRect(5, 4, 3, 1);
        // Crisp 2x2 eyes
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(3, 7, 3, 2);
        ctx.fillRect(10, 7, 3, 2);
        ctx.fillStyle = '#111827';
        ctx.fillRect(4, 7, 2, 2);
        ctx.fillRect(10, 7, 2, 2);
        // Subtle nose & concerned mouth
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(7, 9, 2, 2);
        ctx.fillStyle = '#64748b';
        ctx.fillRect(6, 12, 4, 1);
      }
    } else if (archetype === 'police' || archetype === 'medic') {
      const isMedic = archetype === 'medic';
      const capMain = isMedic ? '#f8fafc' : '#172554';
      const capShade = isMedic ? '#cbd5e1' : '#1e3a8a';
      const skinPal = ['#efc3a0', '#e3b38d', '#f5ccb0'];
      if (face === 'top') {
        fillMottled([capMain, capShade], 201);
      } else if (face === 'back') {
        fillMottled(skinPal, 202);
        ctx.fillStyle = '#29201b';
        ctx.fillRect(0, 5, 16, 6);
        ctx.fillStyle = capMain;
        ctx.fillRect(0, 0, 16, 5);
      } else if (face === 'side') {
        fillMottled(skinPal, 203);
        ctx.fillStyle = '#29201b';
        ctx.fillRect(4, 5, 12, 5);
        ctx.fillStyle = capMain;
        ctx.fillRect(0, 0, 16, 5);
      } else if (face === 'bot') {
        ctx.fillStyle = '#c89670';
        ctx.fillRect(0, 0, 16, 16);
      } else {
        fillMottled(skinPal, 204);
        // Peaked cap + visor brim
        ctx.fillStyle = capMain;
        ctx.fillRect(0, 0, 16, 4);
        ctx.fillStyle = isMedic ? '#dc2626' : '#facc15'; // Cross or badge
        if (isMedic) {
          ctx.fillRect(7, 1, 2, 3);
          ctx.fillRect(6, 2, 4, 1);
        } else {
          ctx.fillRect(7, 1, 2, 2);
        }
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(1, 4, 14, 1); // Brim
        // Eyes & determined mouth
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(3, 7, 3, 2);
        ctx.fillRect(10, 7, 3, 2);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(4, 7, 2, 2);
        ctx.fillRect(10, 7, 2, 2);
        ctx.fillStyle = '#8c5a3c';
        ctx.fillRect(6, 12, 4, 1);
      }
    } else if (archetype === 'swat') {
      fillMottled(['#18181b', '#27272a', '#09090b'], 301);
      if (face === 'front') {
        // Helmet rim
        ctx.fillStyle = '#27272a';
        ctx.fillRect(0, 0, 16, 5);
        ctx.fillStyle = '#09090b';
        ctx.fillRect(1, 5, 14, 1);
        // Tactical glowing pale-cyan goggles
        ctx.fillStyle = '#0c4a6e';
        ctx.fillRect(2, 6, 12, 3);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(3, 7, 4, 2);
        ctx.fillRect(9, 7, 4, 2);
        // Dual respirator filter canisters
        ctx.fillStyle = '#3f3f46';
        ctx.fillRect(2, 11, 4, 4);
        ctx.fillRect(10, 11, 4, 4);
        ctx.fillStyle = '#09090b';
        ctx.fillRect(3, 12, 2, 2);
        ctx.fillRect(11, 12, 2, 2);
        ctx.fillRect(6, 11, 4, 3);
      }
    } else {
      // Zombie faces: normal / runner / brute
      const isRunner = archetype === 'zombie_runner';
      const isBrute = archetype === 'zombie_brute';
      const skinPal = isBrute
        ? ['#584e5c', '#473e4b', '#6b6070', '#3a323e']
        : isRunner
        ? ['#c8c3b8', '#b0aba0', '#969288', '#837f75']
        : ['#b8b49e', '#a19d87', '#898b76', '#727563'];

      fillMottled(skinPal, isBrute ? 401 : isRunner ? 402 : 403);

      // Patchy scalp rot & ragged hair on top/back/sides
      if (face === 'top' || face === 'back' || face === 'side') {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const thresh = face === 'side' ? (y < 6 ? 0.55 : 0.9) : 0.45;
            if (this.hash(x + 30, y, 410) > thresh) {
              ctx.fillStyle = isBrute ? '#27202b' : '#24211e';
              ctx.fillRect(x, y, 1, 1);
            }
            if (this.hash(x, y + 50, 411) > 0.87) {
              ctx.fillStyle = '#6b0f12';
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
      }

      if (face === 'front') {
        // Patchy forehead hair & grime
        ctx.fillStyle = isBrute ? '#231c26' : '#23201c';
        ctx.fillRect(0, 0, 16, 2);
        ctx.fillRect(2, 2, 4, 1);
        ctx.fillRect(10, 2, 4, 2);

        // Deep sunken dark brow & 3x3 eye sockets
        ctx.fillStyle = '#3f3d37';
        ctx.fillRect(2, 4, 4, 1);
        ctx.fillRect(10, 4, 4, 1);

        ctx.fillStyle = '#070709';
        ctx.fillRect(2, 5, 4, 3);
        ctx.fillRect(10, 5, 4, 3);

        // Eerie asymmetrical pinpoint pupils
        ctx.fillStyle = isBrute ? '#f97316' : isRunner ? '#ef4444' : '#eab308';
        ctx.fillRect(3, 6, 1, 1);
        ctx.fillRect(12, 6, 1, 1);

        // Blood tears / sunken cheek shadow
        ctx.fillStyle = isRunner ? '#7f1d1d' : '#4a473f';
        ctx.fillRect(3, 8, 2, 2);
        ctx.fillRect(11, 8, 2, 2);

        // Nose cavity
        ctx.fillStyle = '#18181b';
        ctx.fillRect(7, 8, 2, 2);

        // Gaping bloodied mouth + jagged teeth
        ctx.fillStyle = '#450a0a';
        ctx.fillRect(4, 10, 8, 4);
        ctx.fillStyle = '#7f1d1d';
        ctx.fillRect(3, 11, 10, 2);
        // Jagged pale teeth
        ctx.fillStyle = '#d6d3c4';
        ctx.fillRect(4, 10, 1, 1);
        ctx.fillRect(6, 10, 1, 1);
        ctx.fillRect(9, 10, 1, 1);
        ctx.fillRect(11, 10, 1, 1);
        ctx.fillRect(5, 13, 1, 1);
        ctx.fillRect(8, 13, 1, 1);
        ctx.fillRect(10, 13, 1, 1);
        // Blood streaks dripping down chin
        ctx.fillStyle = '#991b1b';
        ctx.fillRect(4, 14, 2, 2);
        ctx.fillRect(7, 14, 1, 2);
        ctx.fillRect(10, 14, 2, 1);
        ctx.fillStyle = '#5c0d11';
        ctx.fillRect(5, 15, 1, 1);
        ctx.fillRect(11, 14, 1, 2);
      }
    }

    const tex = this.finalizeTexture(canvas, { nearestMin: true });
    this.texCache.set(key, tex);
    return tex;
  }

  private createAgentBodyTexture(
    archetype: AgentArchetype,
    part: 'torso_front' | 'torso_back' | 'torso_side' | 'arm' | 'leg'
  ): THREE.CanvasTexture {
    const key = `body-${archetype}-${part}`;
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(16, 16);
    const fillNoise = (palette: string[], seed: number) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          ctx.fillStyle = palette[Math.floor(this.hash(x, y, seed) * palette.length)];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    };

    if (archetype === 'civilian') {
      if (part === 'leg') {
        fillNoise(['#d4d4d8', '#c4c4cc', '#e4e4e7'], 501);
        ctx.fillStyle = '#a1a1aa';
        ctx.fillRect(7, 0, 2, 16); // Inner seam
        ctx.fillStyle = '#27272a';
        ctx.fillRect(0, 13, 16, 3); // Dark shoes
      } else if (part === 'arm') {
        fillNoise(['#f4f4f5', '#e4e4e7'], 502);
        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(0, 11, 16, 5); // Hand cuff
      } else {
        fillNoise(['#f4f4f5', '#ffffff', '#e4e4e7'], 503);
        if (part === 'torso_front') {
          // Shirt collar & jacket zipper / pocket lines
          ctx.fillStyle = '#cbd5e1';
          ctx.fillRect(5, 0, 6, 3);
          ctx.fillRect(7, 3, 2, 13);
          ctx.fillStyle = '#a1a1aa';
          ctx.fillRect(2, 8, 4, 4);
          ctx.fillRect(10, 8, 4, 4);
        }
      }
    } else if (archetype === 'police') {
      if (part === 'leg') {
        fillNoise(['#0f172a', '#1e293b'], 511);
        ctx.fillStyle = '#09090b';
        ctx.fillRect(0, 13, 16, 3);
      } else if (part === 'arm') {
        fillNoise(['#1e3a5f', '#172554'], 512);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(2, 3, 4, 3); // Shoulder patch
        ctx.fillStyle = '#e3b38d';
        ctx.fillRect(0, 12, 16, 4);
      } else {
        fillNoise(['#1e3a5f', '#172554'], 513);
        ctx.fillStyle = '#09090b';
        ctx.fillRect(0, 12, 16, 3); // Duty belt
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(7, 12, 2, 2); // Buckle
        if (part === 'torso_front') {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(7, 1, 2, 10); // Tie
          ctx.fillStyle = '#facc15';
          ctx.fillRect(10, 3, 3, 3); // Badge
        }
      }
    } else if (archetype === 'swat') {
      if (part === 'leg') {
        fillNoise(['#18181b', '#27272a'], 521);
        ctx.fillStyle = '#09090b';
        ctx.fillRect(0, 12, 16, 4);
      } else if (part === 'arm') {
        fillNoise(['#1f2937', '#18181b'], 522);
        ctx.fillStyle = '#09090b';
        ctx.fillRect(0, 12, 16, 4);
      } else {
        fillNoise(['#1f2937', '#111827'], 523);
        ctx.fillStyle = '#374151';
        ctx.fillRect(2, 2, 12, 10); // Plate carrier
        ctx.fillStyle = '#09090b';
        ctx.fillRect(2, 5, 12, 1);
        ctx.fillRect(2, 8, 12, 1);
        if (part === 'torso_front' || part === 'torso_back') {
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(4, 3, 8, 2); // Tactical ID band
        }
      }
    } else if (archetype === 'medic') {
      if (part === 'leg') {
        fillNoise(['#065f46', '#064e3b'], 531);
        ctx.fillStyle = '#09090b';
        ctx.fillRect(0, 13, 16, 3);
      } else if (part === 'arm') {
        fillNoise(['#f8fafc', '#e2e8f0'], 532);
        ctx.fillStyle = '#e3b38d';
        ctx.fillRect(0, 12, 16, 4);
      } else {
        fillNoise(['#f8fafc', '#e2e8f0'], 533);
        ctx.fillStyle = '#0f766e';
        ctx.fillRect(0, 12, 16, 3);
        if (part === 'torso_front' || part === 'torso_back') {
          ctx.fillStyle = '#dc2626';
          ctx.fillRect(7, 3, 2, 6);
          ctx.fillRect(5, 5, 6, 2);
        }
      }
    } else {
      // Zombie torn blood-soaked clothes
      const isBrute = archetype === 'zombie_brute';
      const isRunner = archetype === 'zombie_runner';
      if (part === 'leg') {
        const pantPal = isBrute ? ['#1e1b24', '#2d2635'] : ['#2b313a', '#39414d', '#22272f'];
        fillNoise(pantPal, 541);
        // Blood streaks & dirt
        for (let i = 0; i < 18; i++) {
          const bx = Math.floor(this.hash(i, 1, 542) * 14);
          const by = Math.floor(this.hash(i, 2, 542) * 14);
          ctx.fillStyle = '#5c0d11';
          ctx.fillRect(bx, by, 2, 2);
        }
      } else {
        const clothPal = isBrute
          ? ['#332936', '#261f29', '#413445']
          : isRunner
          ? ['#7c786e', '#656159', '#908b80']
          : ['#5f6659', '#4d5348', '#747a6c'];
        fillNoise(clothPal, 543);
        // Exposed necrotic skin tears
        ctx.fillStyle = isBrute ? '#584e5c' : '#9c9a85';
        ctx.fillRect(3, 5, 4, 3);
        ctx.fillRect(9, 8, 5, 4);
        // Heavy crimson gore & blood stains across chest/arms
        const bloodCols = ['#7f1d1d', '#991b1b', '#5c0d11', '#450a0a'];
        for (let i = 0; i < 26; i++) {
          const bx = Math.floor(this.hash(i, 3, 544) * 14);
          const by = Math.floor(this.hash(i, 4, 544) * 14);
          const bw = 1 + Math.floor(this.hash(i, 5, 544) * 3);
          const bh = 1 + Math.floor(this.hash(i, 6, 544) * 3);
          ctx.fillStyle = bloodCols[i % bloodCols.length];
          ctx.fillRect(bx, by, bw, bh);
        }
        if (part === 'arm') {
          ctx.fillStyle = isBrute ? '#473e4b' : '#9c9a85';
          ctx.fillRect(0, 11, 16, 5); // Bloody zombie hands
          ctx.fillStyle = '#7f1d1d';
          ctx.fillRect(2, 12, 12, 4);
        }
      }
    }

    const tex = this.finalizeTexture(canvas, { nearestMin: true });
    this.texCache.set(key, tex);
    return tex;
  }

  private createZombieEyeEmissive(archetype: AgentArchetype): THREE.CanvasTexture {
    const key = `head-eye-em-${archetype}`;
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(16, 16);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = archetype === 'zombie_brute' ? '#ff6a00' : '#ff1e2d';
    ctx.fillRect(3, 6, 2, 1);
    ctx.fillRect(11, 6, 2, 1);

    const tex = this.finalizeTexture(canvas, { nearestMin: true });
    this.texCache.set(key, tex);
    return tex;
  }

  public getAgentMaterials(archetype: AgentArchetype): AgentMaterialBundle {
    const cached = this.agentMatCache.get(archetype);
    if (cached) return cached;

    const makeStd = (tex: THREE.CanvasTexture) =>
      new THREE.MeshStandardMaterial({
        map: tex,
        color: 0xffffff,
        roughness: 0.72,
        metalness: 0.04
      });

    const isZombie = archetype.startsWith('zombie');
    const headSide = makeStd(this.createAgentFaceTexture(archetype, 'side'));
    const headTop = makeStd(this.createAgentFaceTexture(archetype, 'top'));
    const headBot = makeStd(this.createAgentFaceTexture(archetype, 'bot'));
    const frontTex = this.createAgentFaceTexture(archetype, 'front');
    const headFront = isZombie
      ? new THREE.MeshStandardMaterial({
          map: frontTex,
          color: 0xffffff,
          emissive: archetype === 'zombie_brute' ? 0xff6a00 : 0xff1e2d,
          emissiveMap: this.createZombieEyeEmissive(archetype),
          emissiveIntensity: 2.3,
          roughness: 0.72,
          metalness: 0.04,
          toneMapped: false
        })
      : makeStd(frontTex);
    const headBack = makeStd(this.createAgentFaceTexture(archetype, 'back'));

    const torsoSide = makeStd(this.createAgentBodyTexture(archetype, 'torso_side'));
    const torsoFront = makeStd(this.createAgentBodyTexture(archetype, 'torso_front'));
    const torsoBack = makeStd(this.createAgentBodyTexture(archetype, 'torso_back'));

    const bundle: AgentMaterialBundle = {
      headMats: [headSide, headSide, headTop, headBot, headFront, headBack],
      torsoMats: [torsoSide, torsoSide, torsoSide, torsoSide, torsoFront, torsoBack],
      armMat: makeStd(this.createAgentBodyTexture(archetype, 'arm')),
      legMat: makeStd(this.createAgentBodyTexture(archetype, 'leg'))
    };

    this.agentMatCache.set(archetype, bundle);
    return bundle;
  }

  public getAsphaltTexture(repeat = 28): THREE.CanvasTexture {
    const key = `asphalt-${repeat}`;
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(128, 128);
    for (let y = 0; y < 128; y += 2) {
      for (let x = 0; x < 128; x += 2) {
        const r = this.hash(x, y, 601);
        ctx.fillStyle = r < 0.28 ? '#272d39' : r < 0.70 ? '#2e3543' : '#353d4d';
        ctx.fillRect(x, y, 2, 2);
      }
    }
    // Cracked asphalt lines & dark oil grit
    ctx.fillStyle = '#0d1016';
    for (let c = 0; c < 8; c++) {
      let cx = Math.floor(this.hash(c, 1, 602) * 110) + 8;
      let cy = Math.floor(this.hash(c, 2, 602) * 110) + 8;
      for (let step = 0; step < 22; step++) {
        ctx.fillRect(cx, cy, 2, 2);
        cx += Math.floor(this.hash(cx, step, 603) * 5) - 2;
        cy += Math.floor(this.hash(step, cy, 604) * 5) - 2;
      }
    }

    const tex = this.finalizeTexture(canvas, { repeatX: repeat, repeatY: repeat });
    this.texCache.set(key, tex);
    return tex;
  }

  public getSidewalkTexture(repeat = 4): THREE.CanvasTexture {
    const key = `sidewalk-${repeat}`;
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(64, 64);
    for (let y = 0; y < 64; y += 2) {
      for (let x = 0; x < 64; x += 2) {
        const r = this.hash(x, y, 611);
        ctx.fillStyle = r < 0.35 ? '#353e4d' : r < 0.75 ? '#3e4859' : '#465164';
        ctx.fillRect(x, y, 2, 2);
      }
    }
    // Paving grid joints
    ctx.fillStyle = '#1e232c';
    for (let i = 0; i < 64; i += 16) {
      ctx.fillRect(i, 0, 2, 64);
      ctx.fillRect(0, i, 64, 2);
    }

    const tex = this.finalizeTexture(canvas, { repeatX: repeat, repeatY: repeat });
    this.texCache.set(key, tex);
    return tex;
  }

  public getBuildingFacadeBundle(
    style: 'brick' | 'concrete' | 'skyscraper' | 'warehouse',
    colorHex: number,
    height: number
  ): BuildingFacadeBundle {
    const key = `facade-${style}-${colorHex}-${Math.round(height)}`;
    const cached = this.facadeCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(128, 256);
    const [emCanvas, emCtx] = this.makeCanvas(128, 256);
    emCtx.fillStyle = '#000000';
    emCtx.fillRect(0, 0, 128, 256);

    const col = new THREE.Color(colorHex);
    const baseHex = '#' + col.getHexString();
    const darkCol = col.clone().multiplyScalar(0.68);
    const lightCol = col.clone().offsetHSL(0, -0.05, 0.08);
    const darkHex = '#' + darkCol.getHexString();
    const lightHex = '#' + lightCol.getHexString();

    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 128, 256);

    if (style === 'brick') {
      for (let y = 0; y < 256; y += 8) {
        ctx.fillStyle = darkHex;
        ctx.fillRect(0, y, 128, 2);
        const offset = ((y / 8) % 2) * 8;
        for (let x = offset; x < 128; x += 16) {
          ctx.fillStyle = this.hash(x, y, 701) > 0.5 ? lightHex : darkHex;
          ctx.fillRect(x, y + 2, 2, 6);
        }
      }
    } else if (style === 'concrete') {
      for (let y = 0; y < 256; y += 16) {
        ctx.fillStyle = darkHex;
        ctx.fillRect(0, y, 128, 2);
        for (let x = 0; x < 128; x += 32) {
          ctx.fillStyle = this.hash(x, y, 702) > 0.55 ? lightHex : baseHex;
          ctx.fillRect(x + 2, y + 2, 28, 12);
          ctx.fillStyle = darkHex;
          ctx.fillRect(x, y, 2, 16);
        }
      }
    } else if (style === 'skyscraper') {
      ctx.fillStyle = '#18202c';
      ctx.fillRect(0, 0, 128, 256);
      for (let x = 0; x < 128; x += 16) {
        ctx.fillStyle = '#2a3444';
        ctx.fillRect(x, 0, 3, 256);
      }
      for (let y = 0; y < 256; y += 12) {
        ctx.fillStyle = '#252f3e';
        ctx.fillRect(0, y, 128, 3);
      }
    } else {
      for (let x = 0; x < 128; x += 6) {
        ctx.fillStyle = x % 12 === 0 ? darkHex : lightHex;
        ctx.fillRect(x, 0, 3, 256);
      }
    }

    const floors = Math.max(2, Math.floor(height / 2.6));
    const floorH = Math.floor(216 / floors);

    for (let f = 0; f < floors; f++) {
      const y = 10 + f * floorH;
      // Floor trim ledge
      ctx.fillStyle = 'rgba(10, 14, 22, 0.55)';
      ctx.fillRect(0, y, 128, 3);

      const cols = style === 'warehouse' ? 2 : 4;
      const strideX = Math.floor(120 / cols);
      const winW = style === 'warehouse' ? 32 : 18;
      const winH = Math.max(6, Math.floor(floorH * 0.56));

      for (let c = 0; c < cols; c++) {
        const wx = 8 + c * strideX;
        const wy = y + 4;

        // Dark outer window frame & stone sill
        ctx.fillStyle = '#090d16';
        ctx.fillRect(wx - 2, wy - 2, winW + 4, winH + 4);
        ctx.fillStyle = '#475569';
        ctx.fillRect(wx - 2, wy + winH + 1, winW + 4, 2);

        const seedVal = this.hash(c + 1, f + 1, colorHex & 0xfff);
        if (seedVal > 0.44) {
          // Warm glowing amber apartment / occasional cool cyan office
          const isWarm = seedVal < 0.88;
          const paneBase = isWarm ? '#f59e0b' : '#7dd3fc';
          const paneBright = isWarm ? '#fde047' : '#bae6fd';
          ctx.fillStyle = paneBase;
          ctx.fillRect(wx, wy, winW, winH);
          ctx.fillStyle = paneBright;
          ctx.fillRect(wx + 2, wy + 2, winW - 4, Math.max(2, winH - 5));
          // Dark window mullion & blinds detail
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(wx + Math.floor(winW / 2), wy, 2, winH);
          ctx.fillRect(wx, wy, winW, 2);

          emCtx.fillStyle = paneBase;
          emCtx.fillRect(wx, wy, winW, winH);
          emCtx.fillStyle = paneBright;
          emCtx.fillRect(wx + 2, wy + 2, winW - 4, Math.max(2, winH - 5));
          emCtx.fillStyle = '#000000';
          emCtx.fillRect(wx + Math.floor(winW / 2), wy, 2, winH);
        } else {
          // Dark unlit / boarded window glass
          ctx.fillStyle = '#0d1320';
          ctx.fillRect(wx, wy, winW, winH);
          ctx.fillStyle = '#1d283a';
          ctx.fillRect(wx + 2, wy + 2, 4, 4);
        }
      }
    }

    // Ground floor dark concrete base trim
    ctx.fillStyle = '#121721';
    ctx.fillRect(0, 232, 128, 24);
    ctx.fillStyle = '#252e3d';
    ctx.fillRect(0, 232, 128, 3);

    const bundle: BuildingFacadeBundle = {
      map: this.finalizeTexture(canvas, { nearestMin: false }),
      emissiveMap: this.finalizeTexture(emCanvas, { nearestMin: false })
    };
    this.facadeCache.set(key, bundle);
    return bundle;
  }

  public getConcreteWallTexture(repeatX = 3): THREE.CanvasTexture {
    const key = `wall-v2-${repeatX}`;
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(128, 128);
    // Weathered concrete blocks with crisp proportion
    for (let y = 0; y < 128; y += 2) {
      for (let x = 0; x < 128; x += 2) {
        const r = this.hash(x, y, 720);
        ctx.fillStyle = r < 0.3 ? '#464f5c' : r < 0.7 ? '#525c6b' : '#5e697a';
        ctx.fillRect(x, y, 2, 2);
      }
    }
    // Panel seams & tie-rod bolt holes
    ctx.fillStyle = '#252b34';
    for (let x = 0; x < 128; x += 32) {
      ctx.fillRect(x, 0, 2, 128);
      ctx.fillRect(x + 6, 36, 2, 3);
      ctx.fillRect(x + 24, 36, 2, 3);
      ctx.fillRect(x + 6, 98, 2, 3);
      ctx.fillRect(x + 24, 98, 2, 3);
    }
    ctx.fillRect(0, 68, 128, 3);

    // Crisp slim top yellow-black diagonal hazard band
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 128, 14);
    ctx.fillStyle = '#eab308';
    for (let sx = -16; sx < 144; sx += 12) {
      ctx.beginPath();
      ctx.moveTo(sx, 14);
      ctx.lineTo(sx + 6, 14);
      ctx.lineTo(sx + 13, 0);
      ctx.lineTo(sx + 7, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 14, 128, 2);

    const tex = this.finalizeTexture(canvas, { repeatX, repeatY: 1 });
    this.texCache.set(key, tex);
    return tex;
  }

  public getBlastGateTexture(): THREE.CanvasTexture {
    const key = 'blast-gate-v2';
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(64, 64);
    for (let y = 0; y < 64; y += 2) {
      for (let x = 0; x < 64; x += 2) {
        const r = this.hash(x, y, 730);
        ctx.fillStyle = r < 0.35 ? '#3b4454' : r < 0.75 ? '#475264' : '#536074';
        ctx.fillRect(x, y, 2, 2);
      }
    }
    // Vertical steel reinforcement ribs & rivets
    for (let x = 0; x < 64; x += 16) {
      ctx.fillStyle = '#1e242e';
      ctx.fillRect(x, 0, 2, 64);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(x + 3, 6, 2, 2);
      ctx.fillRect(x + 3, 56, 2, 2);
    }
    // Heavy center yellow-black hazard stripe
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 25, 64, 14);
    ctx.fillStyle = '#facc15';
    for (let sx = -16; sx < 80; sx += 10) {
      ctx.beginPath();
      ctx.moveTo(sx, 39);
      ctx.lineTo(sx + 5, 39);
      ctx.lineTo(sx + 13, 25);
      ctx.lineTo(sx + 8, 25);
      ctx.closePath();
      ctx.fill();
    }

    const tex = this.finalizeTexture(canvas, { nearestMin: false });
    this.texCache.set(key, tex);
    return tex;
  }

  private drawPixelText(
    ctx: CanvasRenderingContext2D,
    text: string,
    startX: number,
    startY: number,
    px: number,
    color: string,
    vertical = false
  ): void {
    const chars = text.split('');
    ctx.fillStyle = color;
    for (let ci = 0; ci < chars.length; ci++) {
      const glyph = PIXEL_FONT_5X5[chars[ci]] ?? PIXEL_FONT_5X5[' '];
      const gx = vertical ? startX : startX + ci * 6 * px;
      const gy = vertical ? startY + ci * 6 * px : startY;
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          if (glyph[r][c] === '1') {
            ctx.fillRect(gx + c * px, gy + r * px, px, px);
          }
        }
      }
    }
  }

  private getSignColors(label: NeonSignLabel): [string, string] {
    if (label === 'CLINIC') return ['#22d3ee', '#f87171'];
    if (label === '24H MART') return ['#22d3ee', '#fb7185'];
    if (label === 'HOTEL') return ['#ec4899', '#fbcfe8'];
    if (label === 'PHARMACY') return ['#10b981', '#d1fae5'];
    if (label === 'METRO') return ['#f59e0b', '#fef08a'];
    if (label === 'RAMEN') return ['#f97316', '#fde68a'];
    if (label === 'CAFE') return ['#fb7185', '#fef3c7'];
    if (label === 'SUBWAY') return ['#84cc16', '#ecfccb'];
    return ['#38bdf8', '#e0f2fe'];
  }

  public getNeonSignTexture(label: NeonSignLabel): THREE.CanvasTexture {
    const key = `sign-${label}`;
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(128, 36);
    ctx.fillStyle = '#0b101b';
    ctx.fillRect(0, 0, 128, 36);

    const [borderHex, textHex] = this.getSignColors(label);
    ctx.fillStyle = borderHex;
    ctx.fillRect(0, 0, 128, 3);
    ctx.fillRect(0, 33, 128, 3);
    ctx.fillRect(0, 0, 3, 36);
    ctx.fillRect(125, 0, 3, 36);

    const px = label.length >= 7 ? 2 : 3;
    const totalW = label.length * (6 * px) - px;
    const startX = Math.floor((128 - totalW) / 2);
    const startY = Math.floor((36 - 5 * px) / 2);
    this.drawPixelText(ctx, label, startX, startY, px, textHex, false);

    const tex = this.finalizeTexture(canvas, { nearestMin: true });
    this.texCache.set(key, tex);
    return tex;
  }

  public getVerticalNeonSignTexture(label: NeonSignLabel): THREE.CanvasTexture {
    const key = `vsign-${label}`;
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const chars = label.replace(/\s+/g, '').slice(0, 8);
    const [canvas, ctx] = this.makeCanvas(36, 144);
    const [borderHex, textHex] = this.getSignColors(label);

    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, 36, 144);
    ctx.fillStyle = borderHex;
    ctx.fillRect(0, 0, 36, 3);
    ctx.fillRect(0, 141, 36, 3);
    ctx.fillRect(0, 0, 3, 144);
    ctx.fillRect(33, 0, 3, 144);

    const px = chars.length > 6 ? 2 : 3;
    const totalH = chars.length * (6 * px) - px;
    const startX = Math.floor((36 - 5 * px) / 2);
    const startY = Math.max(6, Math.floor((144 - totalH) / 2));
    this.drawPixelText(ctx, chars, startX, startY, px, textHex, true);

    const tex = this.finalizeTexture(canvas, { nearestMin: true });
    this.texCache.set(key, tex);
    return tex;
  }

  public getHighwayGantrySignTexture(line1 = 'NORTH EXPWY', line2 = 'CITADEL EXIT'): THREE.CanvasTexture {
    const key = `hwy-sign-${line1}-${line2}`;
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(192, 64);
    ctx.fillStyle = '#0f5132';
    ctx.fillRect(0, 0, 192, 64);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(3, 3, 186, 2);
    ctx.fillRect(3, 59, 186, 2);
    ctx.fillRect(3, 3, 2, 58);
    ctx.fillRect(187, 3, 2, 58);

    const px = 2;
    const w1 = line1.length * 6 * px - px;
    const w2 = line2.length * 6 * px - px;
    this.drawPixelText(ctx, line1, Math.floor((192 - w1) / 2), 10, px, '#f8fafc', false);
    this.drawPixelText(ctx, line2, Math.floor((192 - w2) / 2), 26, px, '#fde047', false);

    // Downward lane arrows
    for (const ax of [52, 136]) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(ax, 42, 4, 8);
      ctx.fillRect(ax - 3, 47, 10, 3);
      ctx.fillRect(ax - 1, 50, 6, 3);
    }

    const tex = this.finalizeTexture(canvas, { nearestMin: true });
    this.texCache.set(key, tex);
    return tex;
  }

  public getKtxBoardTexture(): THREE.CanvasTexture {
    const key = 'ktx-board';
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(192, 64);
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, 192, 64);
    ctx.fillStyle = '#22d3ee';
    ctx.fillRect(0, 0, 192, 3);
    ctx.fillRect(0, 61, 192, 3);

    this.drawPixelText(ctx, 'KTX-101 BUSAN', 16, 12, 2, '#38bdf8', false);
    this.drawPixelText(ctx, 'PLATFORM 1', 16, 28, 2, '#f8fafc', false);
    this.drawPixelText(ctx, 'BOARDING', 16, 44, 2, '#4ade80', false);

    const tex = this.finalizeTexture(canvas, { nearestMin: true });
    this.texCache.set(key, tex);
    return tex;
  }

  public getTrainFloorTexture(): THREE.CanvasTexture {
    const key = 'ktx-floor';
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(64, 64);
    ctx.fillStyle = '#202836';
    ctx.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 64; y += 8) {
      for (let x = 0; x < 64; x += 8) {
        const alt = ((x / 8 + y / 8) | 0) % 2 === 0;
        ctx.fillStyle = alt ? '#2a3446' : '#222b3a';
        ctx.fillRect(x + 1, y + 1, 7, 7);
      }
    }
    // Crisp central aisle pale edge trim matching concept artwork
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(0, 18, 64, 2);
    ctx.fillRect(0, 44, 64, 2);

    const tex = this.finalizeTexture(canvas, { repeatX: 5, repeatY: 1 });
    this.texCache.set(key, tex);
    return tex;
  }

  public getHvacTexture(): THREE.CanvasTexture {
    const key = 'hvac';
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(32, 32);
    ctx.fillStyle = '#475569';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#334155';
    ctx.fillRect(2, 2, 28, 28);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(6, 6, 20, 20);
    ctx.fillStyle = '#64748b';
    for (let y = 8; y < 24; y += 4) {
      ctx.fillRect(7, y, 18, 2);
    }

    const tex = this.finalizeTexture(canvas, { nearestMin: true });
    this.texCache.set(key, tex);
    return tex;
  }

  public getTrainHullTexture(): THREE.CanvasTexture {
    const key = 'ktx-hull';
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(128, 64);
    ctx.fillStyle = '#dce4ee';
    ctx.fillRect(0, 0, 128, 64);
    // Dark steel roof edge & undercarriage trim
    ctx.fillStyle = '#475569';
    ctx.fillRect(0, 0, 128, 8);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 56, 128, 8);
    // Royal blue stripe
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(0, 38, 128, 12);
    // Passenger doors & dark framed glowing windows
    for (let x = 6; x < 120; x += 22) {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x, 14, 16, 18);
      ctx.fillStyle = x % 44 === 6 ? '#7dd3fc' : '#fde047';
      ctx.fillRect(x + 2, 16, 12, 14);
    }
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(62, 10, 4, 46);

    const tex = this.finalizeTexture(canvas, { nearestMin: false });
    this.texCache.set(key, tex);
    return tex;
  }

  public getLightConeTexture(): THREE.CanvasTexture {
    const key = 'light-cone';
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(32, 64);
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0.0, 'rgba(255, 245, 205, 0.92)');
    grad.addColorStop(0.35, 'rgba(255, 230, 165, 0.45)');
    grad.addColorStop(1.0, 'rgba(255, 220, 150, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 64);

    const tex = this.finalizeTexture(canvas, { nearestMin: false });
    this.texCache.set(key, tex);
    return tex;
  }

  public getPixelSkyTexture(stage: 'dusk' | 'night' | 'day'): THREE.CanvasTexture {
    const key = `sky-${stage}`;
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(512, 256);
    const grad = ctx.createLinearGradient(0, 0, 0, 256);

    if (stage === 'dusk') {
      grad.addColorStop(0.0, '#0a0c1e');
      grad.addColorStop(0.18, '#1e1940');
      grad.addColorStop(0.31, '#522950');
      grad.addColorStop(0.40, '#a3444b');
      grad.addColorStop(0.45, '#e27d46');
      grad.addColorStop(0.485, '#f2a159');
      grad.addColorStop(0.515, '#59304d');
      grad.addColorStop(0.555, '#2b1e3b');
      grad.addColorStop(1.0, '#1e1930');
    } else if (stage === 'night') {
      grad.addColorStop(0.0, '#020409');
      grad.addColorStop(0.42, '#081022');
      grad.addColorStop(0.56, '#1a1529');
      grad.addColorStop(1.0, '#040710');
    } else {
      grad.addColorStop(0.0, '#0369a1');
      grad.addColorStop(0.45, '#38bdf8');
      grad.addColorStop(0.60, '#bae6fd');
      grad.addColorStop(1.0, '#0f172a');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);

    // Subtle stepped pixel-art twilight cloud wisps (soft alpha, zero opaque horizon slabs)
    const cloudPalette =
      stage === 'dusk'
        ? ['#7c3f58', '#b85c54', '#e08b60', '#4c2c4d']
        : stage === 'night'
        ? ['#1e293b', '#172033']
        : ['#ffffff', '#e0f2fe'];

    for (let i = 0; i < 34; i++) {
      const cx = Math.floor(this.hash(i, 1, 801) * 470);
      const cy = 66 + Math.floor(this.hash(i, 2, 801) * 52);
      const cw = 22 + Math.floor(this.hash(i, 3, 801) * 44);
      const ch = 2 + (i % 2 === 0 ? 2 : 0);
      ctx.globalAlpha = stage === 'dusk' ? 0.30 + (i % 3) * 0.06 : 0.45;
      ctx.fillStyle = cloudPalette[i % cloudPalette.length];
      ctx.fillRect(cx, cy, cw, ch);
      ctx.fillRect(cx + 8, cy - 2, Math.max(8, cw - 16), 2);
    }
    ctx.globalAlpha = 1.0;

    // Crisp pixel stars in upper hemisphere
    if (stage !== 'day') {
      for (let s = 0; s < 140; s++) {
        const sx = Math.floor(this.hash(s, 7, 802) * 512);
        const sy = Math.floor(this.hash(s, 8, 802) * 80);
        ctx.fillStyle = s % 5 === 0 ? '#fde68a' : '#e2e8f0';
        ctx.fillRect(sx, sy, 2, 2);
      }
    }

    const tex = this.finalizeTexture(canvas, { nearestMin: true });
    this.texCache.set(key, tex);
    return tex;
  }

  public getBloodStainTexture(): THREE.CanvasTexture {
    const key = 'blood-stain-v2';
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(32, 32);
    ctx.clearRect(0, 0, 32, 32);
    const blobs = [
      { x: 16, y: 16, r: 6, c: '#3b0507' },
      { x: 12, y: 14, r: 4, c: '#54080b' },
      { x: 20, y: 18, r: 4, c: '#480609' },
      { x: 15, y: 21, r: 3, c: '#660b10' },
      { x: 9, y: 22, r: 2, c: '#54080b' },
      { x: 24, y: 11, r: 2, c: '#660b10' },
      { x: 7, y: 9, r: 1, c: '#700f14' },
      { x: 25, y: 24, r: 1, c: '#700f14' }
    ];
    for (const b of blobs) {
      ctx.fillStyle = b.c;
      for (let dy = -b.r; dy <= b.r; dy++) {
        for (let dx = -b.r; dx <= b.r; dx++) {
          if (dx * dx + dy * dy <= b.r * b.r) {
            ctx.fillRect(b.x + dx, b.y + dy, 1, 1);
          }
        }
      }
    }

    const tex = this.finalizeTexture(canvas, { nearestMin: true });
    this.texCache.set(key, tex);
    return tex;
  }

  public getVehiclePaintTexture(): THREE.CanvasTexture {
    const key = 'vehicle-paint';
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(32, 32);
    for (let y = 0; y < 32; y += 2) {
      for (let x = 0; x < 32; x += 2) {
        const r = this.hash(x, y, 790);
        ctx.fillStyle = r < 0.25 ? '#d4d4d8' : r < 0.72 ? '#e4e4e7' : '#f4f4f5';
        ctx.fillRect(x, y, 2, 2);
      }
    }
    ctx.fillStyle = '#a1a1aa';
    ctx.fillRect(0, 14, 32, 1);
    ctx.fillRect(15, 0, 1, 32);

    const tex = this.finalizeTexture(canvas, { nearestMin: true });
    this.texCache.set(key, tex);
    return tex;
  }

  public getVerticalBannerTexture(variant: 0 | 1): THREE.CanvasTexture {
    const key = `vbanner-${variant}`;
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(24, 72);
    ctx.fillStyle = variant === 0 ? '#7f1d1d' : '#14532d';
    ctx.fillRect(0, 0, 24, 72);
    ctx.fillStyle = variant === 0 ? '#f87171' : '#86efac';
    ctx.fillRect(0, 0, 24, 2);
    ctx.fillRect(0, 70, 24, 2);
    ctx.fillRect(0, 0, 2, 72);
    ctx.fillRect(22, 0, 2, 72);

    ctx.fillStyle = variant === 0 ? '#fecaca' : '#dcfce7';
    for (let gy = 8; gy < 62; gy += 14) {
      ctx.fillRect(6, gy, 12, 2);
      ctx.fillRect(8, gy + 4, 8, 2);
      ctx.fillRect(5, gy + 8, 14, 2);
    }

    const tex = this.finalizeTexture(canvas, { nearestMin: true });
    this.texCache.set(key, tex);
    return tex;
  }

  public getParkingLotTexture(repeatX = 4, repeatY = 3): THREE.CanvasTexture {
    const key = `parking-${repeatX}-${repeatY}`;
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(64, 64);
    for (let y = 0; y < 64; y += 2) {
      for (let x = 0; x < 64; x += 2) {
        const r = this.hash(x, y, 791);
        ctx.fillStyle = r < 0.3 ? '#1f2530' : r < 0.75 ? '#262d3a' : '#2c3442';
        ctx.fillRect(x, y, 2, 2);
      }
    }
    ctx.fillStyle = '#cbd5e1';
    for (let x = 0; x < 64; x += 16) {
      ctx.fillRect(x, 0, 2, 22);
      ctx.fillRect(x, 42, 2, 22);
    }

    const tex = this.finalizeTexture(canvas, { repeatX, repeatY });
    this.texCache.set(key, tex);
    return tex;
  }

  public getShippingContainerTexture(): THREE.CanvasTexture {
    const key = 'shipping-container';
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(64, 32);
    ctx.fillStyle = '#d4d4d8';
    ctx.fillRect(0, 0, 64, 32);
    for (let x = 2; x < 62; x += 4) {
      ctx.fillStyle = '#a1a1aa';
      ctx.fillRect(x, 2, 2, 28);
      ctx.fillStyle = '#f4f4f5';
      ctx.fillRect(x + 2, 2, 2, 28);
    }
    ctx.fillStyle = '#71717a';
    ctx.fillRect(0, 0, 64, 3);
    ctx.fillRect(0, 29, 64, 3);
    ctx.fillRect(0, 0, 3, 32);
    ctx.fillRect(61, 0, 3, 32);

    const tex = this.finalizeTexture(canvas, { nearestMin: true });
    this.texCache.set(key, tex);
    return tex;
  }

  public getInteriorFloorTexture(
    theme: 'mart' | 'clinic' | 'hospital' | 'terminal',
    repeatX = 4,
    repeatY = 3
  ): THREE.CanvasTexture {
    const key = `int-floor-${theme}-${repeatX}-${repeatY}`;
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(64, 64);
    for (let y = 0; y < 64; y += 8) {
      for (let x = 0; x < 64; x += 8) {
        const isDarkCell = (x / 8 + y / 8) % 2 === 0;
        const n = this.hash(x, y, 911);
        if (theme === 'mart') {
          ctx.fillStyle = isDarkCell
            ? n < 0.4
              ? '#232833'
              : '#2b313e'
            : n < 0.4
            ? '#b7c0cc'
            : '#cbd5e1';
        } else if (theme === 'clinic') {
          ctx.fillStyle = isDarkCell ? '#3d4c5c' : '#4a5a6b';
        } else if (theme === 'hospital') {
          ctx.fillStyle = isDarkCell ? '#8b99ab' : '#9aa8b8';
        } else {
          ctx.fillStyle = isDarkCell ? '#202632' : '#2a3242';
        }
        ctx.fillRect(x, y, 8, 8);
        ctx.fillStyle = 'rgba(10, 12, 18, 0.28)';
        ctx.fillRect(x, y, 8, 1);
        ctx.fillRect(x, y, 1, 8);
      }
    }
    if (theme === 'terminal') {
      ctx.fillStyle = '#0ea5e9';
      ctx.fillRect(0, 29, 64, 4);
    }

    const tex = this.finalizeTexture(canvas, { repeatX, repeatY });
    this.texCache.set(key, tex);
    return tex;
  }

  public getShelfStockTexture(): THREE.CanvasTexture {
    const key = 'shelf-stock';
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(64, 64);
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, 0, 64, 64);

    const itemColors = ['#dc2626', '#eab308', '#2563eb', '#16a34a', '#ea580c', '#cbd5e1', '#d97706'];
    for (let row = 0; row < 4; row++) {
      const sy = row * 16;
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, sy + 12, 64, 4);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, sy, 64, 2);
      for (let bx = 2; bx < 62; bx += 7) {
        const idx = Math.floor(this.hash(bx, row, 933) * itemColors.length);
        const h = 7 + (idx % 3);
        ctx.fillStyle = itemColors[idx];
        ctx.fillRect(bx, sy + 12 - h, 5, h);
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(bx + 1, sy + 14 - h, 3, 2);
      }
    }

    const tex = this.finalizeTexture(canvas, { repeatX: 2, repeatY: 1 });
    this.texCache.set(key, tex);
    return tex;
  }

  public getBeverageCoolerTexture(): {
    map: THREE.CanvasTexture;
    emissiveMap: THREE.CanvasTexture;
  } {
    const key = 'beverage-cooler';
    const eKey = 'beverage-cooler-emissive';
    const cachedMap = this.texCache.get(key);
    const cachedEmissive = this.texCache.get(eKey);
    if (cachedMap && cachedEmissive) {
      return { map: cachedMap, emissiveMap: cachedEmissive };
    }

    const [canvas, ctx] = this.makeCanvas(64, 64);
    const [eCanvas, eCtx] = this.makeCanvas(64, 64);

    ctx.fillStyle = '#0b111c';
    ctx.fillRect(0, 0, 64, 64);
    eCtx.fillStyle = '#000000';
    eCtx.fillRect(0, 0, 64, 64);

    const doorCols = [
      [3, 18],
      [23, 39],
      [44, 60]
    ];
    const drinkColors = ['#38bdf8', '#ef4444', '#f59e0b', '#22c55e', '#e2e8f0'];

    for (const [x0, x1] of doorCols) {
      const w = x1 - x0;
      ctx.fillStyle = '#0c2735';
      ctx.fillRect(x0, 5, w, 53);
      eCtx.fillStyle = '#14495c';
      eCtx.fillRect(x0, 5, w, 53);

      for (let row = 0; row < 4; row++) {
        const sy = 14 + row * 12;
        ctx.fillStyle = '#111827';
        ctx.fillRect(x0, sy, w, 2);
        eCtx.fillStyle = '#000000';
        eCtx.fillRect(x0, sy, w, 2);

        for (let bx = x0 + 1; bx <= x1 - 3; bx += 3) {
          const ci = Math.floor(this.hash(bx, row, 409) * drinkColors.length);
          ctx.fillStyle = drinkColors[ci];
          ctx.fillRect(bx, sy - 7, 2, 7);
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(bx, sy - 8, 2, 1);
        }
      }

      // Vertical door mullion handle
      ctx.fillStyle = '#64748b';
      ctx.fillRect(x1 - 2, 24, 1, 13);
      eCtx.fillStyle = '#000000';
      eCtx.fillRect(x1 - 2, 24, 1, 13);
    }

    const map = this.finalizeTexture(canvas, { nearestMin: true });
    const emissiveMap = this.finalizeTexture(eCanvas, { nearestMin: true, srgb: false });
    this.texCache.set(key, map);
    this.texCache.set(eKey, emissiveMap);
    return { map, emissiveMap };
  }

  public getCardboardBoxTexture(): THREE.CanvasTexture {
    const key = 'cardboard-box';
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(32, 32);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const n = this.hash(x, y, 701);
        ctx.fillStyle = n < 0.35 ? '#784d2c' : n < 0.8 ? '#855834' : '#91623d';
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // Outer seam edges
    ctx.fillStyle = '#4e321c';
    ctx.fillRect(0, 0, 32, 1);
    ctx.fillRect(0, 31, 32, 1);
    ctx.fillRect(0, 0, 1, 32);
    ctx.fillRect(31, 0, 1, 32);
    // Packing tape band
    ctx.fillStyle = '#b89164';
    ctx.fillRect(1, 14, 30, 4);
    // Shipping label
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(5, 5, 8, 6);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(6, 7, 6, 1);
    ctx.fillRect(6, 9, 4, 1);

    const tex = this.finalizeTexture(canvas, { nearestMin: true });
    this.texCache.set(key, tex);
    return tex;
  }

  public getExitSignTexture(): THREE.CanvasTexture {
    const key = 'exit-sign';
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(64, 24);
    ctx.fillStyle = '#09110d';
    ctx.fillRect(0, 0, 64, 24);
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(0, 0, 64, 2);
    ctx.fillRect(0, 22, 64, 2);
    ctx.fillRect(0, 0, 2, 24);
    ctx.fillRect(62, 0, 2, 24);

    const label = 'EXIT';
    const px = 2;
    const startX = 11;
    const startY = 7;
    ctx.fillStyle = '#4ade80';
    for (let ci = 0; ci < label.length; ci++) {
      const glyph = PIXEL_FONT_5X5[label[ci]];
      if (!glyph) continue;
      const gx = startX + ci * 12;
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          if (glyph[r][c] === '1') {
            ctx.fillRect(gx + c * px, startY + r * px, px, px);
          }
        }
      }
    }

    const tex = this.finalizeTexture(canvas, { nearestMin: true });
    this.texCache.set(key, tex);
    return tex;
  }

  public getDoorGlassTexture(damageStage: 0 | 1 | 2): THREE.CanvasTexture {
    const key = `door-glass-${damageStage}`;
    const cached = this.texCache.get(key);
    if (cached) return cached;

    const [canvas, ctx] = this.makeCanvas(64, 96);
    ctx.fillStyle = 'rgba(34, 46, 62, 0.30)';
    ctx.fillRect(0, 0, 64, 96);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fillRect(0, 0, 64, 4);
    ctx.fillRect(0, 92, 64, 4);
    ctx.fillRect(0, 0, 3, 96);
    ctx.fillRect(61, 0, 3, 96);
    ctx.fillRect(0, 52, 64, 3);

    if (damageStage >= 1) {
      ctx.fillStyle = 'rgba(17, 24, 39, 0.85)';
      const cracks = [
        [32, 40, 18, 22],
        [32, 40, 48, 24],
        [32, 40, 20, 58],
        [32, 40, 50, 62]
      ];
      for (const [x0, y0, x1, y1] of cracks) {
        const steps = 10;
        for (let s = 0; s <= steps; s++) {
          const px = Math.round(x0 + ((x1 - x0) * s) / steps);
          const py = Math.round(y0 + ((y1 - y0) * s) / steps + (s % 2 === 0 ? 1 : -1));
          ctx.fillRect(px, py, 2, 2);
        }
      }
    }
    if (damageStage >= 2) {
      ctx.fillStyle = 'rgba(9, 12, 18, 0.92)';
      const extra = [
        [24, 34, 6, 12],
        [40, 46, 58, 78],
        [30, 52, 10, 84],
        [36, 30, 56, 14]
      ];
      for (const [x0, y0, x1, y1] of extra) {
        const steps = 12;
        for (let s = 0; s <= steps; s++) {
          const px = Math.round(x0 + ((x1 - x0) * s) / steps);
          const py = Math.round(y0 + ((y1 - y0) * s) / steps + ((s % 3) - 1));
          ctx.fillRect(px, py, 2, 2);
        }
      }
      ctx.fillStyle = 'rgba(110, 14, 18, 0.72)';
      ctx.fillRect(20, 46, 10, 8);
      ctx.fillRect(36, 56, 8, 12);
    }

    const tex = this.finalizeTexture(canvas, { nearestMin: true });
    this.texCache.set(key, tex);
    return tex;
  }

  public createVolumetricConeMaterial(colorHex: number, opacity: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(colorHex) },
        uOpacity: { value: opacity }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewPos;
        void main() {
          vUv = uv;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mvPos.xyz;
          vNormalView = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewPos;
        void main() {
          float fresnel = abs(dot(normalize(vNormalView), normalize(vViewPos)));
          float edgeFade = pow(clamp(fresnel, 0.0, 1.0), 1.65);
          float lenFade = pow(clamp(vUv.y, 0.0, 1.0), 1.25) * smoothstep(0.0, 0.14, 1.0 - vUv.y);
          float alpha = uOpacity * edgeFade * lenFade;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
  }
}
