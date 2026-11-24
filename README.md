# PROJECT OUTBREAK

> **3D Dark Voxel Zombie Outbreak & Unarmed First-Person Escape Simulator**  
> **3D 暗黑体素丧尸爆发推演与手无寸铁第一人称逃生模拟器**

**PROJECT OUTBREAK** builds a browser-based 3D metropolis contagion & survival sandbox with **Three.js**, **TypeScript**, and **Vite**. Watch an unscripted outbreak spread across a layered **`252m × 456m` 3-line metropolis** inspired by *World War Z* and *Train to Busan*, command quarantine checkpoints from above, or drop straight onto street level / KTX forecourt as an unarmed civilian with only a flashlight to vault obstacles, throw noise decoys, dodge falling overpass infected, and fight your way through the **walkable six-car KTX-101 Express**.

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
- **Military Quarantine Checkpoints (3 Progressive Lines)**: `Defense Line 1` (`z = -118`), `Defense Line 2` (`z = +48`, behind the Midtown Concrete Canal & girder bridges), and `Defense Line 3` (`z = +148`). Each gate has four wall guards and two ground officers. Breaches close the lost sector to police reinforcements and order surviving defenders to physically fall back to the next line or the KTX forecourt.
- **Walkable 1st-Floor Interiors & Window Breaches**: Enter **`24H Avenue Mart`**, **`Northgate Brick Clinic`**, and **`St. Jude Medical Center`**. Lock/unlock swinging glass or steel doors (`E`), trigger parked car alarms (`E`), and watch infected rattle, crack, shatter glass doors, or smash through upper-floor windows (`>11m`).

### 🚄 4-Gate Glass-Steel KTX Fortress Terminal & Six-Car Express (`🚄 KTX` Forecourt Shortcut)
- **4 Progressive Chokepoints & Dynamic Fallback**: Enter the wet dusk forecourt (flanked by a glass-curtain Medical Triage Pavilion and Sandbag Watchtower), pass **Gate 1 (`KTX East Gate`)** into the **two-story glass curtain atrium** (with turnstiles, HDR glowing `KTX-101 BUSAN` departure screen, and `3m` tactical sandbag overlook), climb the dogleg stairs past **Gate 3 (`KTX Mezzanine Gate`)** onto the **`6m` elevated 3-bay arched glass platform** spanning all six KTX cars (`-61m .. +104m`), while **Gate 2 (`KTX West Gate`)** and **Gate 4 (`KTX Service Partition`)** protect the separate crew approach.
- **Smooth Animated Shutters & `InstancedMesh` Station Batching**: All four station rolling steel shutters smoothly retract into overhead housings with HDR status beacons, while stairs, glass-panel railings, 3-bay curved steel canopy ribs, sandbags, and 500+ elevated rail sleepers are batched via `InstancedMesh`.
- **Periodic KTX Schedule (60s Docked Boarding Window)**: Civilians physically cross the single Car-6 cyan boarding portal before counting as boarded, and evacuation totals update on departure across **6 cars × 64 seats (384 max capacity)**.
- **Sliding Glass Bulkhead Survival Loop**: Step aboard **the single open cyan doorway on Car 6**, sprint past blue passenger seats and overhead luggage racks down the tiled aisle, press **`E`** to seal any of the **5 sliding glass bulkhead doors** (with dynamic crimson emergency bulkhead light tracking) while zombies bang outside windows and shatter locked glass, and hit the **Car 1 Safe Cabin Departure Console (`E`)** to evacuate to Busan.

### 🏃 First-Person Unarmed Parkour Escape (`F` Key / `🏃 Escape` Button)
- **AI Commander**: While you play as a survivor, the AI can dispatch patrols, reinforce wall posts, or strike a growing zombie pile. Its most recent order appears on the HUD.
- **Crowd-Aware Dynamic Safe Spawns**: Picks clear urban vantages (Expressway approach, Commercial Canyon, Canal Bridgehead, or possessed Commander civilian) with an `18m` spawn buffer and live **8-direction compass objective HUD**.
- **Parkour, Counterplay & Supplies**:
  - **`Space`**: Vault cleanly over **`14` alley shortcuts** (`parkour_fence` & `dumpster`), street concrete barriers, vehicles, and indoor counters (landing with a `1.2s` sprint surge) — or trigger **Emergency Shove** (knocks back up to 3 nearby infected `3.6m`, breaks grapples, adds brief recovery grace).
  - **`Q`**: Toss an acoustic **Noise Decoy** (`15m` ahead, `24m` lure radius, `8s` cooldown).
  - **`E`**: Context interact — pick up glowing supply crates (**Antiviral Medkit**, **Energy Drink**, **Emergency Pack**), lock/unlock KTX & building doors, trigger Car 1 KTX departure, toggle Blast Gates, or smash **Car Alarms**.

### 🧟 4-Mode Contagion Engine & 2,200+ Swarm Optimization
- **Wall Defense**: Four guards staff each gate's wall post. The reinforced blast gates take six simulation seconds to close and withstand sustained pounding while zombies form piles along the adjacent wall. Climbers can fight defenders on the parapet before dropping into the next sector.
- **Zombie Pyramids**: Crowds form a broad base against the wall and climb on top of each other. Once the pile reaches the parapet, climbers scramble across and drop into the next sector.
- **Window and Overpass Drops**: New infected can drop into a sector once every defense line north of the landing area has been breached.
- **4 Zombie Attack Modes**: Continuous **`tackle_pin`** mauling (with 3D prone victim poses & police/SWAT rescue counterplay), **`neck_grapple`**, **`claw_swipe`**, and **Alpha Brute `brute_slam`** ground knockbacks; `18s` FP severe-maul incubation curable by Paramedics or Antiviral Medkits.
- **2,200-Pop `InstancedMesh` Architecture**: Supports **300**, **600 (Default)**, **1,200**, and **2,200 Apocalypse Swarm** via zero-alloc `SpatialGrid`, spatial building/obstacle cells, `InstancedMesh` VFX/world-bars/horizon rings, squared-distance perception culling, and adaptive DPR.

### 🎨 Selective HDR Bloom, PMREM Reflections & Anti-Stuck Pathfinding
- **Cinema-Grade Post-Processing & Mood Lighting**: Half-res selective HDR `UnrealBloomPass` + `OutputPass`, procedural `PMREMGenerator` amber-violet dusk reflections on damp asphalt streets & concrete canals, readable HDR neon brackets (`PHARMACY`, `24H MART`), glowing infected eye emissives, and indoor/KTX exterior-light attenuation with crimson bulkhead point lights.
- **Anti-Stuck Swarm & Interior Navigation**: `0.28m` progress-stall detection, clear-side probing, and `1.35m` proactive OBB tangent feelers steer zombies & survivors smoothly around parked cars, buses, and barricades; smart door-funnel routing guides hordes straight through **the rear KTX boarding door** and walkable storefront entrances instead of rubbing exterior walls.

### 🗺️ 4 Maps & 8 Outbreak Scenarios (`⚙ Lab`)
- **Maps**: `Citadel Wall & Express (456m Layered)`, `Grand Metropolis`, `Twin River Bridges`, `Neon Downtown`
- **Scenarios**: `WWZ × 釜山狂潮`, `Patient Zero`, `Multi-Epicenter`, `Crimson Tide Siege`, `Delayed Response`, `Fast Strain`, `No Intervention`, `Breach Siege / 尸潮破城`
- **Breach Siege** is exclusive to **Citadel Wall & Express**. The blast gates start sealed. Six escalating waves try to batter down the gates and climb the adjacent wall at the same time. Reinforcements advance from ground behind the last breached line, and the HUD counts down to the next wave.

---

## 3. Controls / 操作指南

### Commander View (指挥官视角)
- **Wall Posts**: Select **Defend** and click a wall to assign nearby officers to its nearest post. Use **SWAT** on a wall to fill vacant positions with reinforcements.
- **Camera**: Drag / `WASD` pan, Right-drag orbit, Scroll zoom, click **Radar Minimap** to jump directly to any sector or toggle **Blast Gates**
- **Mode Buttons**: `🏃 Escape` (Dynamic Street Escape) · `🚄 KTX` (KTX Platform 1 Endgame) · `🌆 / 🌙 / ☀` (Atmosphere) · `🎬 Auto` (Director Camera)
- **Tactical Dock (`1`–`9`, `0`)**:
  `[1] Inspect/Gate` · `[2] Patrol (20)` · `[3] SWAT (35)` · `[4] Medic (25)` · `[5] Lure Flare (15)` · `[6] Frag Strike (20)` · `[7] Roadblock (15)` · `[8] Defend (15)` · `[9] Evac (20)` · `[0] Priority (10)`

### First-Person Survivor Mode (第一人称逃生视角)
- **`F` / `Roles`**: Choose Civilian, Police Officer, or SWAT. Select a matching ground-level agent in Commander View to play as them. The **KTX** shortcut starts the civilian train escape.
- **Loadouts**: Police can carry a pistol or shotgun. SWAT can carry a carbine or shotgun and trades movement speed for more health. Left-click (or **`J`**) to shoot and **`R`** to reload.
- **`M`**: Request or replace a hold or clearance assignment as Police or SWAT. Hold a nearby position for eight seconds, or clear the small group marked for the assignment. Later arrivals do not reset the target group.
- **Ammunition**: Find gold-marked ammo crates at the wall posts, along approaches to the outer wall, and near the precinct and terminal. Press **`E`** to refill both the magazine and reserves. Each crate restocks after 20 simulation seconds. Low ammunition adds a compass hint to the nearest available crate.
- **`E` at a wall ladder**: Climb up or down. Walk along the solid wall segment and fire from the parapet as an armed role.
- **`中文` / `English`**: Switch the menus, role picker, and first-person HUD between Chinese and English.
- **`WASD` + `Shift`**: Move (`5.2 m/s` jog / `8.5 m/s` sprint)
- **Look**: Press **`L`** to lock the mouse. Right-drag to look with the mouse unlocked, or use **`←` / `→`**. Civilians can also double-click to lock the mouse.
- **`Space`**: Parkour Vault over obstacles/cars/counters, or Emergency Shove when surrounded
- **`Q`**: Throw Noise Decoy flare
- **`E`**: Lock/Unlock Train & Building Doors · Trigger Car 1 KTX Departure · Grab Supplies · Seal Blast Gates · Set Off Car Alarms
