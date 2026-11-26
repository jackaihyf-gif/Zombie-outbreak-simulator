import test from 'node:test';
import assert from 'node:assert/strict';
import { LAB_APC_START_Z, LAB_APC_WARMUP_SECONDS, LAB_EXIT_Z, LAB_TUNNEL_GATE_Z, getBsl4DistrictAtPos } from '../src/bsl4Lab';
import { PLAYER_WEAPONS } from '../src/playerLoadouts';
import { OutbreakSimulation } from '../src/simulation';
import { resolveWorldCollisions } from '../src/spatial';
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

test('BSL-4 Lab: 8 compact zones, 3 bulkheads, 6 gates, 2 catwalks, 8 pods, 7 multi-door rooms & pod breaches', () => {
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
  assert.equal(sim.defenseWalls.length, 3);
  assert.equal(sim.blastGates.length, 6);
  assert.equal(sim.city.skybridges.length, 2);
  assert.equal(sim.labPods.length, 8);

  const interiorRooms = sim.city.buildings.filter((b) => Boolean(b.interior));
  assert.equal(interiorRooms.length, 7);
  for (const room of interiorRooms) {
    const doorCount = room.interior?.doorIds.length ?? 0;
    assert.ok(doorCount >= 3, `Expected >= 3 doors for ${room.name}, got ${doorCount}`);
    const probe = { x: room.x, z: room.z };
    resolveWorldCollisions(probe, 0.55, sim.city, sim.defenseWalls, sim.blastGates, 0, sim.interiorDoors);
    assert.ok(
      Math.hypot(probe.x - room.x, probe.z - room.z) < 0.6,
      `Expected walkable center for ${room.name}, displaced to (${probe.x}, ${probe.z})`
    );
  }

  const securityAgents = sim.agents.filter((a) => a.role === 'police' && a.isAlive);
  assert.ok(securityAgents.length <= 30, `Expected lean security garrison <= 30, got ${securityAgents.length}`);

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
  assert.ok(sim.defenseWalls.length === 3);

  for (let i = 0; i < 300; i++) {
    sim.step(0.1);
  }

  assert.ok(sim.simTime >= 29.9);
  for (const agent of sim.agents) {
    assert.ok(Number.isFinite(agent.x) && Number.isFinite(agent.z), 'Agent coordinate became non-finite');
    assert.ok(Number.isFinite(agent.vx) && Number.isFinite(agent.vz), 'Agent velocity became non-finite');
  }
});
