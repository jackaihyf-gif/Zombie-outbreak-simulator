import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAB_AIRLOCK_ZS,
  LAB_APC_START_Z,
  LAB_APC_WARMUP_SECONDS,
  LAB_CEILING_Y,
  LAB_EXIT_Z,
  LAB_REACTOR_CEILING_Y,
  LAB_SOLID_BULKHEADS,
  LAB_TUNNEL_GATE_Z,
  getBsl4DistrictAtPos
} from '../src/bsl4Lab';
import { PLAYER_WEAPONS } from '../src/playerLoadouts';
import { OutbreakSimulation } from '../src/simulation';
import { resolveWorldCollisions, segmentIntersectsAABB } from '../src/spatial';
import type { ScenarioConfig } from '../src/types';

function makeBsl4Config(id: ScenarioConfig['id'] = 'wwz_busan', seed = 'bsl4-unit-test'): ScenarioConfig {
  const siege = id === 'breach_siege';
  return {
    id,
    mapId: 'bsl4_lab',
    seed,
    population: 260,
    incubationSeconds: siege ? 2.8 : 2.5,
    initialPolice: siege ? 24 : 22,
    initialInfected: siege ? 32 : 4,
    dispatchDelaySeconds: 2,
    allowPlayerIntervention: true,
    enableWaves: siege,
    fastStrain: true
  };
}

test('BSL-4 Lab: 8 compact zones, bedrock bulkheads, 9 airlocks, 18 airlock doors, 2 catwalks, 8 pods, 7 suites & pod breaches', () => {
  const sim = new OutbreakSimulation(makeBsl4Config('wwz_busan'));

  const districts = new Set([
    getBsl4DistrictAtPos(0, -160),
    getBsl4DistrictAtPos(0, -115),
    getBsl4DistrictAtPos(0, -80),
    getBsl4DistrictAtPos(0, -36),
    getBsl4DistrictAtPos(0, 4),
    getBsl4DistrictAtPos(0, 52),
    getBsl4DistrictAtPos(0, 96),
    getBsl4DistrictAtPos(0, 150)
  ]);
  assert.equal(districts.size, 8);
  assert.equal(sim.defenseWalls.length, 0);
  assert.equal(sim.blastGates.length, 0);
  assert.equal(LAB_AIRLOCK_ZS.length, 3);
  assert.ok(LAB_SOLID_BULKHEADS.length >= 20, `Expected solid subterranean bulkheads, got ${LAB_SOLID_BULKHEADS.length}`);
  assert.equal(sim.city.skybridges.length, 2);
  for (const bridge of sim.city.skybridges) {
    assert.ok(
      bridge.deckY + 1.8 < LAB_REACTOR_CEILING_Y,
      `Expected reactor atrium catwalk clearance under vaulted ceiling: deckY=${bridge.deckY}`
    );
  }
  assert.equal(sim.labPods.length, 8);

  const labSuites = sim.city.buildings.filter((b) => Boolean(b.interior) && b.interior!.theme !== 'lab_airlock');
  assert.equal(labSuites.length, 7);
  for (const room of labSuites) {
    const doorCount = room.interior?.doorIds.length ?? 0;
    assert.ok(doorCount >= 3, `Expected >= 3 doors for ${room.name}, got ${doorCount}`);
    const probe = { x: room.x, z: room.z };
    resolveWorldCollisions(probe, 0.55, sim.city, sim.defenseWalls, sim.blastGates, 0, sim.interiorDoors);
    assert.ok(
      Math.hypot(probe.x - room.x, probe.z - room.z) < 0.6,
      `Expected walkable center for ${room.name}, displaced to (${probe.x}, ${probe.z})`
    );
  }

  const airlockRooms = sim.city.buildings.filter((b) => b.interior?.theme === 'lab_airlock');
  assert.equal(airlockRooms.length, 9);
  for (const chamber of airlockRooms) {
    const probe = { x: chamber.x, z: chamber.z };
    resolveWorldCollisions(probe, 0.55, sim.city, sim.defenseWalls, sim.blastGates, 0, sim.interiorDoors);
    assert.ok(
      Math.hypot(probe.x - chamber.x, probe.z - chamber.z) < 0.6,
      `Expected walkable center for ${chamber.name}, displaced to (${probe.x}, ${probe.z})`
    );
  }

  const airlockDoors = sim.interiorDoors.filter((d) => d.isAirlock);
  assert.equal(airlockDoors.length, 18);
  assert.equal(new Set(airlockDoors.map((d) => d.airlockLine)).size, 3);

  const securityAgents = sim.agents.filter((a) => a.role === 'police' && a.isAlive);
  assert.ok(securityAgents.length <= 30, `Expected lean security garrison <= 30, got ${securityAgents.length}`);
  assert.equal(securityAgents.filter((a) => a.onWallDeck).length, 0, 'Expected zero outdoor wall-top guards underground');

  // Staged containment pod breaches should begin by t = 2.0s
  for (let i = 0; i < 25; i++) sim.step(0.1);
  assert.ok(
    sim.labPods.some((p) => p.breached),
    'Expected Sector 0 containment pods to shatter by t = 2.5s'
  );
});

test('BSL-4 Lab: tight FP SWAT reserve ammo and full APC-01 warmup -> boarding -> tunnel escape sequence', () => {
  const outdoorSim = new OutbreakSimulation({
    ...makeBsl4Config('wwz_busan', 'citadel-ammo'),
    mapId: 'citadel_express'
  });
  const outdoorPlayer = outdoorSim.enterFirstPerson('city', 'swat', 'carbine');
  assert.ok(outdoorPlayer.isPlayerControlled);
  assert.equal(outdoorSim.firstPerson.weapon?.reserve, PLAYER_WEAPONS.carbine.capacity * 4);

  const sim = new OutbreakSimulation(makeBsl4Config('wwz_busan', 'apc-sequence'));
  const player = sim.enterFirstPerson('city', 'swat', 'carbine');
  assert.equal(sim.firstPerson.weapon?.reserve, PLAYER_WEAPONS.carbine.capacity * 2);
  assert.equal(sim.extractionApc.active, true);
  assert.equal(sim.extractionApc.state, 'STANDBY');

  // Position player safely behind APC-01 rear ramp and trigger [E] engine ignition
  player.climbY = 0;
  player.onWallDeck = false;
  player.x = sim.extractionApc.x;
  player.z = LAB_APC_START_Z - 2.8;
  player.health = 200;
  player.maxHealth = 200;
  player.isIncubating = false;

  sim.updateFirstPersonPlayer(0.1, 0, 0, false, true, false, false, Math.PI, 0);
  sim.step(0.1);
  assert.equal(sim.extractionApc.state, 'WARMING_UP');
  assert.ok(sim.extractionApc.timer <= LAB_APC_WARMUP_SECONDS);

  // Advance halfway (~21s) -> halfway surge triggers & tunnel shutter partially open
  for (let i = 0; i < 210; i++) {
    player.health = 200;
    player.isIncubating = false;
    sim.updateFirstPersonPlayer(0.1, 0, 0, false, false, false, false, Math.PI, 0);
    sim.step(0.1);
  }
  assert.equal(sim.extractionApc.waveTriggeredHalfway, true);
  assert.ok(sim.extractionApc.shutterOpenFraction > 0.45 && sim.extractionApc.shutterOpenFraction < 0.9);

  // Finish remaining warmup (~20s) -> BOARDING state & full shutter opening
  for (let i = 0; i < 205; i++) {
    player.health = 200;
    player.isIncubating = false;
    sim.updateFirstPersonPlayer(0.1, 0, 0, false, false, false, false, Math.PI, 0);
    sim.step(0.1);
  }
  assert.equal(sim.extractionApc.state, 'BOARDING');
  assert.equal(sim.extractionApc.shutterOpenFraction, 1);

  // Move player to ramp and press [E] to board APC-01
  player.x = sim.extractionApc.x;
  player.z = sim.extractionApc.z - 2.6;
  sim.updateFirstPersonPlayer(0.1, 0, 0, false, true, false, false, Math.PI, 0);
  sim.step(0.1);
  assert.equal(sim.extractionApc.playerAboard, true);
  assert.equal(sim.firstPerson.insideExtractionApc, true);
  assert.equal(sim.extractionApc.state, 'DEPARTING');

  // Spawn an infected blocker in the escape tunnel and confirm APC-01 crushes through to ESCAPED
  const s: any = sim;
  const tunnelBlocker = s.createAgent('infected', sim.extractionApc.x, LAB_TUNNEL_GATE_Z + 3, false, 'standard');
  tunnelBlocker.climbY = 0;
  s.pushAgent(tunnelBlocker);

  for (let i = 0; i < 90 && sim.extractionApc.state !== 'ESCAPED'; i++) {
    sim.updateFirstPersonPlayer(0.1, 0, 0, false, false, false, false, 0, 0);
    sim.step(0.1);
  }
  assert.equal(tunnelBlocker.isAlive, false, 'Expected departing APC-01 to crush infected in tunnel path');
  assert.equal(sim.extractionApc.state, 'ESCAPED');
  assert.ok(sim.extractionApc.z >= LAB_EXIT_Z);
  assert.equal(sim.firstPerson.outcome, 'ESCAPED');
});

test('BSL-4 Lab supports Breach Siege for 30s without NaN coordinates or broken wave flow', () => {
  const sim = new OutbreakSimulation(makeBsl4Config('breach_siege', 'bsl4-siege-30s'));
  assert.equal(sim.hordeWave, 1);
  assert.ok(sim.defenseWalls.length === 0);

  for (let i = 0; i < 300; i++) {
    sim.step(0.1);
  }

  assert.ok(sim.simTime >= 29.9);
  for (const agent of sim.agents) {
    assert.ok(Number.isFinite(agent.x) && Number.isFinite(agent.z), 'Agent coordinate became non-finite');
    assert.ok(Number.isFinite(agent.vx) && Number.isFinite(agent.vz), 'Agent velocity became non-finite');
  }
});

test('BSL-4 Lab: zero civilian traffic, dedicated lab room themes & 3 interactive devices', () => {
  const sim = new OutbreakSimulation(makeBsl4Config('wwz_busan', 'bsl4-polish-test'));
  assert.equal(sim.vehicles.length, 0, 'Expected zero civilian street vehicles inside BSL-4 bunker');
  assert.equal(sim.labDevices.length, 3);

  const interiorRooms = sim.city.buildings.filter((b) => Boolean(b.interior));
  assert.equal(interiorRooms.length, 16);
  for (const room of interiorRooms) {
    assert.ok(
      room.interior!.theme === 'lab_cryo' ||
        room.interior!.theme === 'lab_bio' ||
        room.interior!.theme === 'lab_armory' ||
        room.interior!.theme === 'lab_airlock',
      `Unexpected urban theme ${room.interior!.theme} on ${room.name}`
    );
  }
});

test('BSL-4 Lab: Subject-00 TYRANT boss spawn, chest/skull weakpoint 2.1x, stagger kneel, Phase 2 & gate smash', () => {
  const sim = new OutbreakSimulation(makeBsl4Config('wwz_busan', 'bsl4-tyrant-boss'));
  const player = sim.enterFirstPerson('city', 'swat', 'carbine');

  for (let i = 0; i < 25; i++) sim.step(0.1);
  assert.ok(sim.tyrantAgentId !== null, 'Pod 01 should spawn Subject-00 TYRANT by t=2.5s');
  const tyrant = sim.getAgentById(sim.tyrantAgentId)!;
  assert.equal(tyrant.zombieVariant, 'tyrant');
  assert.equal(tyrant.maxHealth, 1600);
  assert.equal(tyrant.bossPhase, 1);

  // Move Tyrant + player into clear Zone 2 corridor sightline and shoot Tyrant chest bio-heart (y~1.82m)
  player.climbY = 0;
  player.onWallDeck = false;
  player.x = 0;
  player.z = -104;
  player.health = 500;
  tyrant.x = 0;
  tyrant.z = -111;
  tyrant.climbY = 0;
  tyrant.rotationY = 0; // facing south (+Z) toward player so chest bio-heart points straight at SWAT carbine

  const s: any = sim;
  s.rebuildAgentSpatialGrid();

  const eyeY = 1.68;
  const dx = tyrant.x - player.x;
  const dy = 2.75 - eyeY; // Aim cleanly at Tyrant skull weakpoint (2.45..3.22m)
  const dz = tyrant.z - player.z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));

  const hpBefore = tyrant.health;
  sim.updateFirstPersonPlayer(0.16, 0, 0, false, false, false, false, yaw, pitch, {
    fire: true,
    reload: false,
    requestMission: false,
    aim: true
  });
  const shotDmg = hpBefore - tyrant.health;
  assert.ok(shotDmg >= 65, `Expected 2.1x weakpoint damage >= 65, got ${shotDmg}`);

  // Sustain weakpoint fire until 360 stagger threshold triggers kneeling stagger + Phase 2 transition
  for (let i = 0; i < 20 && (tyrant.bossKneelTimer ?? 0) <= 0; i++) {
    sim.updateFirstPersonPlayer(0.16, 0, 0, false, false, false, false, yaw, pitch, {
      fire: true,
      reload: false,
      requestMission: false,
      aim: true
    });
  }
  assert.ok((tyrant.bossKneelTimer ?? 0) > 0, 'Expected >=360 damage to trigger Tyrant stagger kneel');
  assert.equal(sim.firstPerson.bossHud?.state, 'staggered');

  tyrant.bossKneelTimer = 0;
  tyrant.health = tyrant.maxHealth * 0.45;
  sim.step(0.1);
  assert.equal(tyrant.bossPhase, 2, 'Expected Tyrant below 50% HP to enter Phase 2');

  // Verify Tyrant deals heavy DPS against closed Airlock blast-glass door
  const airlockDoor = sim.interiorDoors.find((d) => d.buildingId === 'BLD-LAB-AIRLOCK-1C' && d.side === 'N')!;
  airlockDoor.isOpen = false;
  airlockDoor.openFraction = 0;
  airlockDoor.breached = false;
  const dBefore = airlockDoor.integrity;
  tyrant.x = airlockDoor.x;
  tyrant.z = airlockDoor.z - 1.5;
  tyrant.targetAgentId = null;
  tyrant.perceptionCooldown = 9;
  s.rebuildAgentSpatialGrid();
  for (let i = 0; i < 10; i++) sim.step(0.1);
  assert.ok(
    dBefore - airlockDoor.integrity >= 35,
    `Expected Tyrant airlock smash DPS >= 35, lost ${dBefore - airlockDoor.integrity}`
  );
});

test('BSL-4 Lab: cryo valve slows Zone 3/4 zombies, sentry turrets fire in Zone 6 & generator cuts APC warmup to 25s', () => {
  const sim = new OutbreakSimulation(makeBsl4Config('wwz_busan', 'bsl4-devices'));
  const s: any = sim;
  const player = sim.enterFirstPerson('city', 'swat', 'carbine');
  player.climbY = 0;
  player.onWallDeck = false;
  player.health = 500;

  // 1. Cryo Purge Valve in Zone 3
  const cryoDev = sim.labDevices.find((d) => d.kind === 'cryo_valve')!;
  const cryoZ = s.createAgent('infected', 0, -76, false, 'standard');
  cryoZ.climbY = 0;
  s.pushAgent(cryoZ);
  player.x = cryoDev.x;
  player.z = cryoDev.z;
  sim.updateFirstPersonPlayer(0.1, 0, 0, false, true, false, false, 0, 0);
  sim.step(0.1);
  assert.equal(cryoDev.state, 'active');
  assert.ok((cryoZ.slowedTimer ?? 0) > 0, 'Expected Cryo Purge to chill nearby Zone 3 infected');

  // 2. Security Turret Terminal in Zone 6
  const turretDev = sim.labDevices.find((d) => d.kind === 'turret_console')!;
  const turretZ = s.createAgent('infected', 0, 36, false, 'standard');
  turretZ.climbY = 0;
  const tBeforeHp = turretZ.health;
  s.pushAgent(turretZ);
  s.rebuildAgentSpatialGrid();
  player.x = turretDev.x;
  player.z = turretDev.z;
  sim.updateFirstPersonPlayer(0.1, 0, 0, false, true, false, false, 0, 0);
  for (let i = 0; i < 5; i++) sim.step(0.1);
  assert.equal(turretDev.state, 'active');
  assert.ok(turretZ.health < tBeforeHp, 'Expected Zone 6 sentry turret to fire & damage infected');

  // 3. Backup Power Generator in Zone 7 -> cuts APC-01 warmup from 40s to 25s
  const genDev = sim.labDevices.find((d) => d.kind === 'backup_generator')!;
  player.x = genDev.x;
  player.z = genDev.z;
  sim.updateFirstPersonPlayer(0.1, 0, 0, false, true, false, false, 0, 0);
  assert.equal(genDev.state, 'completed');
  assert.equal(sim.labPowerRestored, true);
  assert.equal(sim.extractionApc.warmupDuration, 25);
  assert.equal(sim.extractionApc.timer, 25);
});

test('BSL-4 Lab AI & Pathfinding: navgraph respects bulkheads/hazards, ceiling clearance, no pyramids, 3D self-locking, garage rally & persona', () => {
  const sim = new OutbreakSimulation(makeBsl4Config('wwz_busan', 'bsl4-ai-overhaul'));
  const s: any = sim;

  // 1. Cross-facility path & navgraph solid-bulkhead + explosive-hazard clearance
  const fullPath = sim.city.findPath(0, -150, 0, 142, [], [], [], false);
  assert.ok(fullPath && fullPath.length >= 4, 'Expected valid cross-facility nav path from Sector 0 to Zone 8');
  for (const node of sim.city.navNodes) {
    for (const nId of node.neighbors) {
      const nb = sim.city.navNodes[nId];
      for (const bh of LAB_SOLID_BULKHEADS) {
        const hitsBulkhead = segmentIntersectsAABB(
          node.x,
          node.z,
          nb.x,
          nb.z,
          bh.x - bh.w * 0.5,
          bh.x + bh.w * 0.5,
          bh.z - bh.d * 0.5,
          bh.z + bh.d * 0.5
        );
        assert.equal(hitsBulkhead, false, `Nav edge (${node.x},${node.z})->(${nb.x},${nb.z}) crossed solid bulkhead ${bh.id}`);
      }
      for (const haz of sim.city.explosiveHazards) {
        const cos = haz.cosR ?? Math.cos(haz.rotationY);
        const sin = haz.sinR ?? Math.sin(haz.rotationY);
        const ax = node.x - haz.x, az = node.z - haz.z;
        const bx = nb.x - haz.x, bz = nb.z - haz.z;
        const hitsHaz = segmentIntersectsAABB(
          ax * cos - az * sin,
          ax * sin + az * cos,
          bx * cos - bz * sin,
          bx * sin + bz * cos,
          -haz.width * 0.5,
          haz.width * 0.5,
          -haz.depth * 0.5,
          haz.depth * 0.5
        );
        assert.equal(hitsHaz, false, `Nav edge crossed explosive hazard ${haz.label}`);
      }
    }
  }

  // 2. Ceiling clearance for indoor security/catwalks, automated airlock sealing & zero indoor pyramid climbing
  const secGuards = sim.agents.filter((a) => a.role === 'police' && a.isAlive);
  assert.ok(secGuards.length > 0, 'Expected BSL-4 subterranean security garrison');
  assert.equal(secGuards.filter((a) => a.onWallDeck).length, 0, 'Expected zero wall-top guards in underground lab');
  for (const g of secGuards) {
    assert.ok(g.climbY + 1.8 < LAB_CEILING_Y, `Security head clipped ceiling: climbY=${g.climbY}`);
  }
  const clumped: any[] = [];
  for (let i = 0; i < 18; i++) {
    const zmb = s.createAgent(
      'infected',
      -2 + (i % 6) * 0.75,
      LAB_AIRLOCK_ZS[0] - 8.0 - Math.floor(i / 6) * 0.9,
      false,
      'standard'
    );
    zmb.climbY = 0;
    s.pushAgent(zmb);
    clumped.push(zmb);
  }
  for (let i = 0; i < 30; i++) sim.step(0.1);
  assert.equal(sim.getLabAirlockLineStatus(1), 'SEALED', 'Expected Airlock Alpha to auto-seal when infected approach');
  for (const zmb of clumped) {
    assert.equal(zmb.climbY, 0, 'Expected zero indoor zombie pyramid climbing over sealed BSL-4 bulkhead');
  }

  // 3. No premature vanishing at (0, 146) while APC-01 is STANDBY + staged evacuation + boarding when BOARDING
  assert.equal(sim.evacZones.length, 0, 'Expected zero instant-vanish evacZones on bsl4_lab');
  const evacBefore = sim.totalEvacuated;
  const standbySci = s.createAgent('civilian', 0, LAB_APC_START_Z, false);
  standbySci.avoidsEvacuation = false;
  s.pushAgent(standbySci);
  for (let i = 0; i < 20; i++) sim.step(0.1);
  assert.equal(sim.totalEvacuated, evacBefore, 'Expected civilians not to vanish while APC-01 is STANDBY');
  assert.ok(sim.civilianEvacuationStage >= 1, 'Expected breached pods to activate staged lab evacuation');

  sim.extractionApc.state = 'BOARDING';
  sim.extractionApc.shutterOpenFraction = 1;
  standbySci.x = sim.extractionApc.x;
  standbySci.z = sim.extractionApc.z - 4.5;
  for (let i = 0; i < 20; i++) sim.step(0.1);
  assert.ok(sim.extractionApc.boardedCount > 0, 'Expected garage civilians to board APC-01 once BOARDING');

  // 4. Real 3D interior room refuge & self-locking doors
  const cryoWest = sim.city.buildings.find((b) => b.id === 'BLD-LAB-CRYO-W')!;
  const eastDoor = sim.interiorDoors.find((d) => d.buildingId === cryoWest.id && d.side === 'E')!;
  eastDoor.isLocked = false;
  eastDoor.isBroken = false;
  const roomSci = s.createAgent('civilian', eastDoor.x - 1.8, eastDoor.z, false);
  roomSci.perceptionCooldown = 0;
  s.pushAgent(roomSci);
  const doorZombie = s.createAgent('infected', eastDoor.x + 2.5, eastDoor.z, false, 'standard');
  s.pushAgent(doorZombie);
  s.rebuildAgentSpatialGrid();
  for (let i = 0; i < 15; i++) sim.step(0.1);
  assert.equal(eastDoor.isLocked, true, 'Expected scientist inside 3D lab room to auto-lock door against outside infected');
  for (const b of sim.city.buildings) {
    assert.equal(b.shelteredAgentIds.length, 0, 'Expected zero invisible shelteredAgentIds on bsl4_lab');
  }

  // 5. Siege & fallback direction toward Airlock Beta Killzone then Zone 8 Extraction Garage
  const siegeSim = new OutbreakSimulation(makeBsl4Config('breach_siege', 'bsl4-siege-zone8'));
  const ss: any = siegeSim;
  assert.ok(
    String(ss.fallbackLabel(null)).includes('Airlock Beta Killzone'),
    'Expected initial lab fallback label to target Airlock Beta Killzone'
  );
  ss.policeFrontZ = 40;
  assert.ok(
    String(ss.fallbackLabel(null)).includes('Extraction Garage'),
    'Expected late lab fallback label to target Extraction Garage'
  );
  const breachedZ = ss.createAgent('infected', 0, 122, false, 'standard');
  breachedZ.perceptionCooldown = 99;
  breachedZ.awarenessRadius = 0;
  ss.pushAgent(breachedZ);
  for (let i = 0; i < 25; i++) siegeSim.step(0.1);
  assert.ok(breachedZ.z > 120.5, `Expected Zone 8 siege infected to advance south into Garage, got z=${breachedZ.z}`);

  // 6. Lab personnel persona (scientist/tech titles + lab-coat/hazmat palette)
  const labColors = new Set([0xf1f5f9, 0xe2e8f0, 0xcffafe, 0xdbeafe, 0x99f6e4]);
  const civs = sim.agents.filter((a) => a.role === 'civilian' && !a.isPlayerControlled);
  assert.ok(civs.length > 0);
  for (const c of civs.slice(0, 20)) {
    assert.ok(/^(Dr\.|Tech|Researcher) /.test(c.name), `Expected lab title for ${c.name}`);
    assert.ok(labColors.has(c.shirtColor), `Expected lab-coat/hazmat outfit color for ${c.name}`);
  }
});
