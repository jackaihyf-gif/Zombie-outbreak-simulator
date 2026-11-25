import test from 'node:test';
import assert from 'node:assert/strict';
import { OutbreakSimulation } from '../src/simulation';
import type { ScenarioConfig } from '../src/types';

function makeSiegeConfig(seed = 'wave2-siege-test'): ScenarioConfig {
  return {
    id: 'breach_siege',
    mapId: 'citadel_express',
    seed,
    population: 300,
    incubationSeconds: 2.8,
    initialPolice: 24,
    initialInfected: 40,
    dispatchDelaySeconds: 2,
    allowPlayerIntervention: true,
    enableWaves: true,
    fastStrain: true
  };
}

test('Wave 2: 5s wave crisis banner, gate < 25% warning, and KTX 12s countdown warning', () => {
  const sim = new OutbreakSimulation(makeSiegeConfig());
  const s: any = sim;
  const sounds: string[] = [];
  sim.onSound = (t) => sounds.push(t);

  // 1. 5s pre-wave crisis banner
  sim.hordeWave = 1;
  sim.nextWaveTimer = 5.1;
  sim.step(0.2);
  assert.ok(sim.crisisBanner);
  assert.match(sim.crisisBanner.titleEn, /WAVE 2\/6 INCOMING/i);
  assert.ok(sounds.includes('crisis_danger'));

  // 2. Blast gate < 25% warning
  const gate = sim.blastGates[0];
  gate.isOpen = false;
  gate.openFraction = 0;
  gate.integrity = gate.maxIntegrity * 0.24;
  s.nextWallGateCheck = 99;
  for (let i = 0; i < 2; i++) {
    const brute = s.createAgent('infected', gate.x + (i - 0.5), gate.z - 1.5, false, 'brute');
    brute.climbY = 0;
    brute.targetAgentId = null;
    brute.perceptionCooldown = 5;
    s.pushAgent(brute);
  }
  s.rebuildAgentSpatialGrid();
  sim.step(0.1);
  assert.ok(sim.crisisBanner);
  assert.equal(sim.crisisBanner.titleEn, 'GATE CRITICAL');
  assert.ok(sounds.includes('crisis_warn'));

  // 3. KTX final 12s boarding warning
  sim.expressTrain.state = 'DOCKED';
  sim.expressTrain.timer = 12.1;
  sim.step(0.2);
  assert.ok(sim.crisisBanner);
  assert.match(sim.crisisBanner.titleEn, /FINAL BOARDING/i);
});

test('Wave 2: FP kill streaks, headshots, Brute down callout/sound, and accuracy telemetry', () => {
  const sim = new OutbreakSimulation({
    id: 'wwz_busan',
    mapId: 'citadel_express',
    seed: 'wave2-telemetry',
    population: 20,
    incubationSeconds: 18,
    initialPolice: 0,
    initialInfected: 0,
    dispatchDelaySeconds: 1,
    allowPlayerIntervention: true,
    enableWaves: false,
    fastStrain: true
  });
  const s: any = sim;
  const sounds: string[] = [];
  sim.onSound = (t) => sounds.push(t);

  const player = sim.enterFirstPerson('city', 'swat', 'carbine');
  assert.ok(player);

  const victims = [
    { x: player.x - 1.2, z: player.z - 7, variant: 'standard' as const, hp: 20, head: false },
    { x: player.x - 0.4, z: player.z - 8, variant: 'standard' as const, hp: 20, head: false },
    { x: player.x + 0.4, z: player.z - 9, variant: 'standard' as const, hp: 45, head: true },
    { x: player.x + 1.2, z: player.z - 10, variant: 'brute' as const, hp: 30, head: false }
  ];
  for (const v of victims) {
    const zmb = s.createAgent('infected', v.x, v.z, false, v.variant);
    zmb.climbY = 0;
    zmb.health = v.hp;
    s.pushAgent(zmb);
  }
  s.rebuildAgentSpatialGrid();

  for (const v of victims) {
    const dx = v.x - player.x;
    const dz = v.z - player.z;
    const yaw = Math.atan2(-dx, -dz);
    const targetY = v.head ? 1.85 : 1.05;
    const pitch = Math.atan2(targetY - 1.68, Math.hypot(dx, dz));
    if (sim.firstPerson.weapon) sim.firstPerson.weapon.spread = 0;
    sim.updateFirstPersonPlayer(0.25, 0, 0, false, false, false, false, yaw, pitch, {
      fire: true,
      reload: false,
      requestMission: false,
      aim: true
    });
  }

  assert.equal(sim.firstPerson.kills, 4);
  assert.ok((sim.firstPerson.headshots ?? 0) >= 1);
  assert.equal(sim.firstPerson.bruteKills, 1);
  assert.equal(sim.firstPerson.killStreak, 4);
  assert.equal(sim.firstPerson.maxKillStreak, 4);
  assert.equal(sim.firstPerson.shotsFired, 4);
  assert.equal(sim.firstPerson.shotsHit, 4);
  assert.equal(sim.firstPerson.lastCallout?.kind, 'brute');
  assert.ok(sounds.includes('brute_down'));
});

test('Wave 2: deterministic same-seed replay produces identical initial state and evolution', () => {
  const cfg = makeSiegeConfig('deterministic-seed-42');
  const simA = new OutbreakSimulation(cfg);
  const simB = new OutbreakSimulation(cfg);
  assert.equal(simA.patientZeroId, simB.patientZeroId);
  assert.equal(simA.agents.length, simB.agents.length);
  for (let i = 0; i < 10; i++) {
    simA.step(0.05);
    simB.step(0.05);
  }
  assert.deepEqual(simA.getStats(), simB.getStats());
});
