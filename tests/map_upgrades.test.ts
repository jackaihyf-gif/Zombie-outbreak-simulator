import test from 'node:test';
import assert from 'node:assert/strict';
import { OutbreakSimulation } from '../src/simulation';
import { resolveWorldCollisions } from '../src/spatial';
import type { ScenarioConfig } from '../src/types';

function makeConfig(overrides: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return {
    id: 'wwz_busan',
    mapId: 'citadel_express',
    seed: 'map-upgrades-test',
    population: 60,
    incubationSeconds: 18,
    initialPolice: 0,
    initialInfected: 0,
    dispatchDelaySeconds: 99,
    allowPlayerIntervention: true,
    enableWaves: false,
    fastStrain: false,
    ...overrides
  };
}

test('Map Upgrades: explosive hazards detonate from FP gunfire, chain-react, credit FP kills, and trigger on Frag Bomb', () => {
  const sim = new OutbreakSimulation(makeConfig({ seed: 'hazard-test' }));
  const s: any = sim;
  sim.commandPoints = 100;

  const tanker = sim.explosiveHazards.find((h) => h.kind === 'fuel_truck' && h.x < 0 && h.z < -140);
  assert.ok(tanker, 'Expected West Blvd fuel tanker');
  const nearbyDrums = sim.explosiveHazards.find(
    (h) => h.id !== tanker.id && Math.hypot(h.x - tanker.x, h.z - tanker.z) <= tanker.blastRadius + 2.5
  );
  assert.ok(nearbyDrums, 'Expected adjacent fuel barrel cluster within chain-reaction radius');

  // Place FP SWAT carbine operator 7m south of tanker with clear line of fire
  const player = sim.enterFirstPerson('city', 'swat', 'carbine');
  assert.ok(player);
  player.x = tanker.x;
  player.z = tanker.z + 7.5;
  player.climbY = 0;

  // Spawn 2 infected within 4.5m beside/behind tanker (so bullets hit tanker first)
  const z1 = s.createAgent('infected', tanker.x - 3.2, tanker.z - 2.0, false, 'standard');
  const z2 = s.createAgent('infected', tanker.x + 3.2, tanker.z - 2.0, false, 'standard');
  z1.targetAgentId = null;
  z2.targetAgentId = null;
  z1.perceptionCooldown = 10;
  z2.perceptionCooldown = 10;
  s.pushAgent(z1);
  s.pushAgent(z2);
  s.rebuildAgentSpatialGrid();

  const eyeY = 1.68;
  const dx = tanker.x - player.x;
  const dy = 1.4 - eyeY;
  const dz = tanker.z - player.z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));

  for (let i = 0; i < 40 && !tanker.detonated; i++) {
    sim.updateFirstPersonPlayer(0.14, 0, 0, false, false, false, false, yaw, pitch, {
      fire: true,
      reload: false,
      requestMission: false,
      aim: true
    });
  }

  assert.equal(tanker.detonated, true, 'Tanker should detonate under gunfire');
  assert.ok(tanker.burningTimer > 0, 'Detonated tanker should burn cleanly afterward');
  assert.equal(nearbyDrums.detonated, true, 'Nearby hazard drums should chain-detonate');
  assert.equal(z1.isAlive, false, 'Zombie 1 within blast radius should be eliminated');
  assert.equal(z2.isAlive, false, 'Zombie 2 within blast radius should be eliminated');
  assert.ok((sim.firstPerson.kills ?? 0) >= 2, `Expected >= 2 credited FP kills, got ${sim.firstPerson.kills}`);
  assert.equal(sim.firstPerson.lastCallout?.kind, 'hazard');

  // Verify Commander Frag Bomb also detonates intact hazards within 12.5m
  const otherHazard = sim.explosiveHazards.find((h) => !h.detonated);
  assert.ok(otherHazard);
  const bomOk = sim.deployFragBomb(otherHazard.x + 2.0, otherHazard.z);
  assert.equal(bomOk, true);
  assert.equal(otherHazard.detonated, true);
});

test('Map Upgrades: walkable tactical skybridge allows climbing, walking across, firing down, and descending', () => {
  const sim = new OutbreakSimulation(makeConfig({ seed: 'skybridge-test' }));
  const s: any = sim;
  const sb = sim.city.skybridges[0];
  assert.ok(sb && sb.ladderXs && sb.ladderXs.length === 2, 'Expected skybridge with ladderXs');

  const player = sim.enterFirstPerson('city', 'police', 'carbine');
  assert.ok(player);

  // Move to west ladder base
  const ladderX = sb.ladderXs[0];
  player.x = ladderX;
  player.z = sb.z + sb.width * 0.5 + 0.55;
  player.climbY = 0;

  sim.updateFirstPersonPlayer(0.05, 0, 0, false, false, false, false, Math.PI, 0, {
    fire: false,
    reload: false,
    requestMission: false
  });
  assert.equal(sim.firstPerson.skybridgeLadder, 'up');

  // Trigger climb up
  sim.updateFirstPersonPlayer(0.05, 0, 0, false, true, false, false, Math.PI, 0, {
    fire: false,
    reload: false,
    requestMission: false
  });
  for (let i = 0; i < 45; i++) {
    sim.updateFirstPersonPlayer(0.05, 0, 0, false, false, false, false, Math.PI, 0, {
      fire: false,
      reload: false,
      requestMission: false
    });
  }
  assert.ok(player.climbY >= sb.deckY, `Expected climbY >= ${sb.deckY}, got ${player.climbY}`);
  assert.equal(sim.firstPerson.skybridgeLadder, 'down');

  // Walk to center of skybridge & fire down at infected on the avenue below
  player.x = sb.x;
  player.z = sb.z;
  const zombie = s.createAgent('infected', sb.x, sb.z + 5.5, false, 'standard');
  zombie.climbY = 0;
  zombie.perceptionCooldown = 10;
  s.pushAgent(zombie);
  s.rebuildAgentSpatialGrid();

  const eyeY = 1.68 + player.climbY;
  const dx = zombie.x - player.x;
  const dy = 1.0 - eyeY;
  const dz = zombie.z - player.z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));

  const initialHp = zombie.health;
  for (let i = 0; i < 12 && zombie.health === initialHp; i++) {
    sim.updateFirstPersonPlayer(0.15, 0, 0, false, false, false, false, yaw, pitch, {
      fire: true,
      reload: false,
      requestMission: false,
      aim: true
    });
  }
  assert.ok(zombie.health < initialHp, 'Player on skybridge should damage infected on the street below');

  // Move back to ladder mount and climb down
  player.x = ladderX;
  player.z = sb.z + sb.width * 0.5 - 0.55;
  sim.updateFirstPersonPlayer(0.05, 0, 0, false, true, false, false, 0, 0, {
    fire: false,
    reload: false,
    requestMission: false
  });
  for (let i = 0; i < 45; i++) {
    sim.updateFirstPersonPlayer(0.05, 0, 0, false, false, false, false, 0, 0, {
      fire: false,
      reload: false,
      requestMission: false
    });
  }
  assert.equal(player.climbY, 0, 'Player should climb back down to ground level cleanly');
});

test('Map Upgrades: Sector 2 and Sector 3 dual-door through-shops are walkable interiors', () => {
  const sim = new OutbreakSimulation(makeConfig({ seed: 'shops-test' }));
  for (const id of ['BLD-ARCADE', 'BLD-PHARM-S3']) {
    const bld = sim.city.buildingById.get(id);
    assert.ok(bld, `Missing through-shop ${id}`);
    assert.ok(bld.interior && bld.interior.doorIds.length >= 2, `${id} should have >= 2 interior doors`);
    const probe = { x: bld.x, z: bld.z };
    resolveWorldCollisions(probe, 0.55, sim.city, sim.defenseWalls, sim.blastGates, 0, sim.interiorDoors);
    assert.ok(
      Math.hypot(probe.x - bld.x, probe.z - bld.z) < 0.5,
      `${id} center (${bld.x}, ${bld.z}) should be unobstructed interior space, got (${probe.x}, ${probe.z})`
    );
  }
});

test('Map Upgrades: twin_bridges fortified bridgehead breach_siege initializes cleanly and simulates without NaN', () => {
  const sim = new OutbreakSimulation({
    id: 'breach_siege',
    mapId: 'twin_bridges',
    seed: 'TWIN-SIEGE',
    population: 300,
    incubationSeconds: 2.8,
    initialPolice: 24,
    initialInfected: 40,
    dispatchDelaySeconds: 2,
    allowPlayerIntervention: true,
    enableWaves: true,
    fastStrain: true
  });

  assert.equal(sim.defenseWalls.length, 2, 'twin_bridges should have 2 bridgehead defense walls');
  assert.equal(sim.blastGates.length, 4, 'twin_bridges should have 4 bridgehead blast gates');
  assert.ok(sim.explosiveHazards.length >= 6, 'twin_bridges should have >= 6 explosive hazards');
  assert.ok(sim.city.wayfindingSigns.length >= 4, 'twin_bridges should have >= 4 wayfinding gantries');

  // Verify no wall clips open river channel or buildings
  for (const wall of sim.defenseWalls) {
    for (const r of sim.city.rivers) {
      assert.ok(
        wall.z + wall.thickness * 0.5 < r.minZ || wall.z - wall.thickness * 0.5 > r.maxZ,
        `Bridgehead wall at z=${wall.z} must not clip river channel [${r.minZ}, ${r.maxZ}]`
      );
    }
    for (const b of sim.city.buildings) {
      assert.ok(
        wall.z + wall.thickness * 0.5 < b.minZ || wall.z - wall.thickness * 0.5 > b.maxZ,
        `Bridgehead wall at z=${wall.z} must not clip building ${b.name} [${b.minZ}, ${b.maxZ}]`
      );
    }
  }

  // Step 30s at 20Hz and verify stability
  for (let tick = 0; tick < 600; tick++) {
    sim.step(0.05);
  }
  assert.ok(sim.agents.length > 0);
  for (const agent of sim.agents) {
    assert.ok(Number.isFinite(agent.x) && Number.isFinite(agent.z) && Number.isFinite(agent.climbY), `Agent ${agent.id} has non-finite coordinates`);
  }
});
