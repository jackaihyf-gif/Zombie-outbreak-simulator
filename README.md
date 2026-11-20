# PROJECT OUTBREAK

> **3D Dark Voxel Zombie Outbreak & Unarmed First-Person Escape Simulator**  
> **3D 暗黑体素丧尸爆发推演与手无寸铁第一人称逃生模拟器**

**PROJECT OUTBREAK** builds a browser-based 3D metropolis contagion & survival sandbox with **Three.js**, **TypeScript**, and **Vite**. Watch an unscripted outbreak spread across a layered **`252m × 456m` 3-line metropolis** inspired by *World War Z* and *Train to Busan*, command quarantine checkpoints from above, or drop straight onto street level / KTX Platform 1 as an unarmed civilian with only a flashlight to vault obstacles, throw noise decoys, dodge falling overpass infected, and fight your way through the **walkable 3-car KTX-101 Express**.

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

### 🌆 Layered 456m Real-City Metropolis (`citadel_express`)
- **Elevated Highway Overpass & Sky-Falling Infected**: A `6.6m` concrete expressway overpass spans Midtown on median T-pillars with green highway gantry signs, crashed vehicles, smoking box trucks, and dynamic infected tumbling off the edge onto the jammed avenue below.
- **Street-Level Urban Fabric**:
  - Two **glass-railed Pedestrian Skybridges** spanning commercial avenues (`West Commercial` & `Midtown Plaza`).
  - Continuous ground-floor **storefront awnings**, **perpendicular vertical neon brackets** (`PHARMACY`, `RAMEN`, `CAFE`, `24H MART`, `SUBWAY`, `HOTEL`), cantilevered **red/amber/green traffic light gantries**, **6 lit bus stop shelters**, rush-hour gridlock cars, and crashed smoking **transit buses**.
  - **110 instanced 360° horizon skyline silhouettes** resting seamlessly on an extended metropolitan dusk plain (`InstancedMesh` batched).
- **Military Quarantine Checkpoints (3 Progressive Lines)**: `Defense Line 1` (`z = -118`), `Defense Line 2` (`z = +48`, behind the Midtown Concrete Canal & girder bridges), and `Defense Line 3` (`z = +168`) fortified with stacked corrugated shipping containers, barbed wire coils, **sandbag watchtowers with volumetric searchlights**, white quarantine relief tents, queued evac cars, and animated red/white gate boom arms.
- **Walkable 1st-Floor Interiors & Window Breaches**: Enter **`24H Avenue Mart`**, **`Northgate Brick Clinic`**, **`St. Jude Medical Center`**, and **`KTX Central Station Hall`** (with glowing `KTX-101 BUSAN` departure board, turnstiles, ticket booths & escalators). Lock/unlock swinging glass or steel doors (`E`), trigger parked car alarms (`E`), and watch infected rattle, crack, shatter glass doors, or smash through upper-floor windows (`>11m`).

### 🚄 *Train to Busan* Walkable 3-Car KTX-101 Express Climax (`🚄 KTX` Quick-Jump)
- **Periodic KTX Schedule (40s Docked Boarding Window)**: Approaching express plows track zombies and docks at Platform 1 with hollow walkable interiors (`Car 3 → Car 2 → Car 1`).
- **Sliding Glass Bulkhead Survival Loop**: Step aboard **Car 3's open cyan platform doorway**, sprint past blue passenger seats and overhead luggage racks down the tiled aisle, press **`E`** to seal sliding glass bulkhead doors between `Car 3 ↔ Car 2` and `Car 2 ↔ Car 1` while zombies bang outside windows and shatter locked glass, and hit the **Car 1 Safe Cabin Departure Console (`E`)** (or hold inside until departure) to evacuate to Busan. Miss the train and you must survive in the concourse until the next arrival!

### 🏃 First-Person Unarmed Parkour Escape (`F` Key / `🏃 Escape` Button)
- **Crowd-Aware Dynamic Safe Spawns**: Picks clear urban vantages (Expressway approach, Commercial Canyon, Canal Bridgehead, or possessed Commander civilian) with an `18m` spawn buffer and live **8-direction compass objective HUD**.
- **Parkour, Counterplay & Supplies**:
  - **`Space`**: Vault cleanly over **`14` alley shortcuts** (`parkour_fence` & `dumpster`), street concrete barriers, vehicles, and indoor counters (landing with a `1.2s` sprint surge) — or trigger **Emergency Shove** (knocks back up to 3 nearby infected `3.6m`, breaks grapples, adds brief recovery grace).
  - **`Q`**: Toss an acoustic **Noise Decoy** (`15m` ahead, `24m` lure radius, `8s` cooldown).
  - **`E`**: Context interact — pick up glowing supply crates (**Antiviral Medkit**, **Energy Drink**, **Emergency Pack**), lock/unlock KTX & building doors, trigger Car 1 KTX departure, toggle Blast Gates, or smash **Car Alarms**.

### 🧟 4-Mode Contagion Engine & 2,200+ Swarm Optimization
- **4 Zombie Attack Modes**: Continuous **`tackle_pin`** mauling (with 3D prone victim poses & police/SWAT rescue counterplay), **`neck_grapple`**, **`claw_swipe`**, and **Alpha Brute `brute_slam`** ground knockbacks; `18s` FP severe-maul incubation curable by Paramedics or Antiviral Medkits.
- **2,200-Pop `InstancedMesh` Architecture**: Supports **300**, **600 (Default)**, **1,200**, and **2,200 Apocalypse Swarm** via zero-alloc `SpatialGrid`, spatial building/obstacle cells, `InstancedMesh` VFX/world-bars/horizon rings, squared-distance perception culling, and adaptive DPR.

### 🗺️ 4 Maps & 7 Outbreak Scenarios (`⚙ Lab`)
- **Maps**: `Citadel Wall & Express (456m Layered)`, `Grand Metropolis`, `Twin River Bridges`, `Neon Downtown`
- **Scenarios**: `WWZ × 釜山狂潮`, `Patient Zero`, `Multi-Epicenter`, `Crimson Tide Siege`, `Delayed Response`, `Fast Strain`, `No Intervention`

---

## 3. Controls / 操作指南

### Commander View (指挥官视角)
- **Camera**: Drag / `WASD` pan, Right-drag orbit, Scroll zoom, click **Radar Minimap** to jump directly to any sector or toggle **Blast Gates**
- **Mode Buttons**: `🏃 Escape` (Dynamic Street Escape) · `🚄 KTX` (KTX Platform 1 Endgame) · `🌆 / 🌙 / ☀` (Atmosphere) · `🎬 Auto` (Director Camera)
- **Tactical Dock (`1`–`9`, `0`)**:
  `[1] Inspect/Gate` · `[2] Patrol (20)` · `[3] SWAT (35)` · `[4] Medic (25)` · `[5] Lure Flare (15)` · `[6] Frag Strike (20)` · `[7] Roadblock (15)` · `[8] Defend (15)` · `[9] Evac (20)` · `[0] Priority (10)`

### First-Person Survivor Mode (第一人称逃生视角)
- **`F` / `Exit (F)`**: Toggle First-Person Mode (or press `F` on a selected civilian in Commander View to possess them)
- **`WASD` + `Shift`**: Move (`5.2 m/s` jog / `8.5 m/s` sprint)
- **Mouse Drag / Pointer Lock (double-click) or `←` / `→`**: Look around
- **`Space`**: Parkour Vault over obstacles/cars/counters, or Emergency Shove when surrounded
- **`Q`**: Throw Noise Decoy flare
- **`E`**: Lock/Unlock Train & Building Doors · Trigger Car 1 KTX Departure · Grab Supplies · Seal Blast Gates · Set Off Car Alarms
