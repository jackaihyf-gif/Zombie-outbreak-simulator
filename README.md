# PROJECT OUTBREAK

> **3D Dark Voxel Zombie Outbreak & Unarmed First-Person Escape Simulator**  
> **3D 暗黑体素丧尸爆发推演与手无寸铁第一人称逃生模拟器**

**PROJECT OUTBREAK** builds a browser-based 3D metropolis contagion & survival sandbox with **Three.js**, **TypeScript**, and **Vite**. Watch an unscripted outbreak spread across an **organic `252m × 456m` 3-line metropolis corridor** inspired by *World War Z* and *Train to Busan*, command defense lines from above, or drop straight onto street level as an unarmed civilian with only a flashlight to weave through burning pileups, dark brick alleys, and falling perimeters toward the **KTX South Express Terminal**.

---

## 1. Quick Start / 快速启动

```bash
npm install
npm run dev
```

Open **`http://localhost:5173/`** in your browser.

```bash
npm run build
npm run preview
```

---

## 2. Highlights / 核心特性

### 🌆 456m Organic Non-Grid 3-Line Metropolis (`citadel_express`)
- **3 Layered Concrete Defense Lines**: `Defense Line 1` (`z = -118`), `Defense Line 2` (`z = +48`), and `Defense Line 3` (`z = +168`) spaced `166m` and `120m` apart — turning escape into a tense, multi-minute cross-city run (`~372m` from West Boulevard to the KTX South Terminal).
- **Non-Grid Real-City Topology**:
  - **North Multi-Lane Highway Zone**: Burned-out semi trucks, concrete jersey medians, abandoned sedans, and chaotic zig-zag wrecks.
  - **West Boulevard**: Flanked by weathered red-brown brick buildings (`24H Avenue Mart` with striped awning & neon sign, `Northgate Brick Clinic` with fire escapes & vertical neon), walkable dumpster alleyways, sideways burning box truck pileup, and floodlit surface parking lots.
  - **Midtown Concrete Canal & Containers**: Deep dusk canal spanned by two urban girder bridges and fortified along Defense Line 2 by 2-tier stacked corrugated shipping containers.
  - **KTX Dual-Track South Terminal**: Five electric-cyan-trimmed platform canopies with an approaching, docking, and departing 5-car Express Evacuation Train.

### 🏃 First-Person Unarmed Civilian Escape (`F` Key / `Escape` Button)
- **Zero Weapons, Pure Survival**: Move at realistic human pace (`3.3 m/s` jog, `6.3 m/s` stamina-limited sprint) weaving through jammed vehicles, diagonal jersey barriers, and brick back alleys with a lighting-only handheld tactical voxel flashlight (`SpotLight` + volumetric cone).
- **Dynamic Audio & Hazard Feedback**: Proximity zombie snarls, accelerating civilian heartbeat, gunshot cracks, blast gate slams, and KTX horn blasts synthesized procedurally via Web Audio API ([`src/audio.ts`](src/audio.ts)).
- **Interactive Blast Gates (`E`)**: Seal open blast gates behind fleeing crowds—or reopen them to escape a collapsing sector.

### 🧟 WWZ × Train to Busan Contagion Engine
- **3D Zombie Wall Pyramids**: Infected crowding sealed concrete walls stack vertically into writhing 3D pyramids and spill over the barbed wire unless dispersed with **Frag Strikes**.
- **Dark Voxel Overhaul & Joint Animation**: Blocky `InstancedMesh` characters with crooked-neck runner dashes, outstretched lunges, rapid convulsion transformations, and dark crimson voxel blood droplet impacts (zero arcade glow rings).
- **2,200+ Agent Capacity**: Supports **300**, **600 (Default)**, **1,200**, and **2,200 Apocalypse Swarm** scales smoothly with spatial hashing ([`src/spatial.ts`](src/spatial.ts)), block-indexed LOS, and rectangular/organic A* road navigation ([`src/cityData.ts`](src/cityData.ts)).

### 🗺️ 4 Maps & 7 Outbreak Scenarios (`⚙ Lab`)
- **Maps**: `Citadel Wall & Express (456m Organic)`, `Grand Metropolis`, `Twin River Bridges`, `Neon Downtown`
- **Scenarios**: `WWZ × 釜山狂潮`, `Patient Zero`, `Multi-Epicenter`, `Crimson Tide Siege`, `Delayed Response`, `Fast Strain`, `No Intervention`

---

## 3. Controls / 操作指南

### Commander View (指挥官视角)
- **Camera**: Drag/WASD pan, Right-drag orbit, Scroll zoom, click **Radar Minimap** to jump directly to any sector or toggle clicked **Blast Gates** (`Inspect` tool)
- **Atmosphere**: `🌆 / 🌙 / ☀` cycle Dusk / Night / Day • **🎬 Auto** cinematic director camera
- **Tactical Dock (`1`–`9`, `0`)**:
  `[1] Inspect/Gate` · `[2] Patrol (20)` · `[3] SWAT (35)` · `[4] Medic (25)` · `[5] Lure Flare (15)` · `[6] Frag Strike (20)` · `[7] Roadblock (15)` · `[8] Defend (15)` · `[9] Evac (20)` · `[0] Priority (10)`

### First-Person Survivor Mode (第一人称逃生视角)
- **`F` / HUD Button**: Enter or exit First-Person Unarmed Survivor Mode
- **`WASD`**: Move (`Shift` Sprint)
- **Mouse / Drag (or `←` / `→`)**: Look around (double-click canvas for Pointer Lock)
- **`E`**: Seal / Open nearby Blast Gate
