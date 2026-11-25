import test from 'node:test';
import assert from 'node:assert/strict';
import { OutbreakSimulation } from '../src/simulation';
import { PLAYER_WEAPONS } from '../src/playerLoadouts';
import type { ScenarioConfig } from '../src/types';

function makeConfig(overrides: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return {
    id: 'wwz_busan',
    mapId: 'citadel_express',
    seed: 'combat-wave1-test',
    population: 20,
    incubationSeconds: 18,
    initialPolice: 0,
    initialInfected: 0,
    dispatchDelaySeconds: 1,
    allowPlayerIntervention: true,
    enableWaves: false,
    fastStrain: true,
    ...overrides
  };
}

test('headshot 1.9x damage, flinch/slow/flash, corpse 7.5s lifecycle, and 4s radio coalescing', () => {
  const sim = new OutbreakSimulation(makeConfig({ population: 600, initialPolice: 22 }));
  const s: any = sim;
  const sounds: string[] = [];
  sim.onSound = (t) => sounds.push(t);

  const player = sim.enterFirstPerson('city', 'swat', 'carbine');
  assert.ok(player);

  const zHead = s.createAgent('infected', player.x, player.z - 8, false, 'standard');
  zHead.climbY = 0;
  s.pushAgent(zHead);

  const zBody = s.createAgent('infected', player.x + 1.4, player.z - 8, false, 'standard');
  zBody.climbY = 0;
  s.pushAgent(zBody);
  s.rebuildAgentSpatialGrid();

  const yawH = Math.atan2(-(zHead.x - player.x), -(zHead.z - player.z));
  const pitchHead = Math.atan2(1.85 - 1.68, Math.hypot(zHead.x - player.x, zHead.z - player.z));
  const startHp = zHead.health;

  sim.updateFirstPersonPlayer(0.05, 0, 0, false, false, false, false, yawH, pitchHead, {
    fire: true,
    reload: false,
    requestMission: false
  });

  const hsDamage = startHp - zHead.health;
  assert.ok(hsDamage > 55, `Expected headshot damage > 55, got ${hsDamage}`);
  assert.equal(sim.firstPerson.weapon?.lastHeadshot, true);
  assert.ok((zHead.hitFlinchTimer ?? 0) > 0);
  assert.ok((zHead.hitFlashTimer ?? 0) > 0);
  assert.ok((zHead.hitSlowTimer ?? 0) > 0);
  assert.ok(sim.effects.some((e) => e.type === 'blood_burst'));
  assert.ok(sounds.includes('headshot'));

  const yawB = Math.atan2(-(zBody.x - player.x), -(zBody.z - player.z));
  const pitchBody = Math.atan2(1.05 - 1.68, Math.hypot(zBody.x - player.x, zBody.z - player.z));
  zBody.health = 25;
  sim.updateFirstPersonPlayer(0.2, 0, 0, false, false, false, false, yawB, pitchBody, {
    fire: true,
    reload: false,
    requestMission: false
  });
  assert.equal(zBody.isAlive, false);
  assert.ok((zBody.deathTimer ?? 0) > 7.0);
  assert.equal(typeof zBody.deathDirX, 'number');

  for (let i = 0; i < 160; i++) sim.step(0.05);
  assert.equal(zBody.deathTimer, 0);

  const beforeLen = sim.policeRadio.length;
  s.transmitRadio({ kind: 'dispatch', place: 'Midtown', count: 2 });
  s.transmitRadio({ kind: 'dispatch', place: 'Midtown', count: 2 });
  s.transmitRadio({ kind: 'dispatch', place: 'Midtown', count: 1 });
  assert.equal(sim.policeRadio.length, beforeLen + 1);
  const latest = sim.policeRadio[sim.policeRadio.length - 1];
  const coalescedCount = 'count' in latest.call ? latest.call.count : -1;
  assert.equal(coalescedCount, 5);
});

test('Wave 1: active reload perfect/jam, dry fire, ADS spread tightening, flashlight stealth, and adrenaline clutch', () => {
  const sim = new OutbreakSimulation(makeConfig());
  const s: any = sim;
  const sounds: string[] = [];
  sim.onSound = (t) => sounds.push(t);

  const player = sim.enterFirstPerson('city', 'swat', 'carbine');
  assert.ok(player && sim.firstPerson.weapon);
  assert.equal(sim.firstPerson.flashlightOn, true);
  assert.equal(sim.firstPerson.aiming, false);

  const yaw = sim.firstPerson.yaw;
  for (let i = 0; i < 3; i++) {
    sim.updateFirstPersonPlayer(0.2, 0, 0, false, false, false, false, yaw, 0, {
      fire: true,
      reload: false,
      requestMission: false
    });
  }
  assert.equal(sim.firstPerson.weapon.ammo, 21);

  // Active reload: hit sweet spot [0.55, 0.74]
  sim.updateFirstPersonPlayer(0.05, 0, 0, false, false, false, false, yaw, 0, {
    fire: false,
    reload: true,
    requestMission: false
  });
  for (let i = 0; i < 19; i++) {
    sim.updateFirstPersonPlayer(0.05, 0, 0, false, false, false, false, yaw, 0, {
      fire: false,
      reload: false,
      requestMission: false
    });
  }
  sim.updateFirstPersonPlayer(0.05, 0, 0, false, false, false, false, yaw, 0, {
    fire: false,
    reload: true,
    requestMission: false
  });
  assert.equal(sim.firstPerson.weapon.reloadTimer, 0);
  assert.equal(sim.firstPerson.weapon.ammo, 24);
  assert.equal(sim.firstPerson.weapon.activeReloadFeedback, 'perfect');
  assert.ok((sim.firstPerson.weapon.steadyTimer ?? 0) > 1.0);
  assert.ok(sounds.includes('active_reload_ok'));

  // Active reload: missed timing -> jam (+0.35s) and duplicate press ignored
  sim.updateFirstPersonPlayer(0.2, 0, 0, false, false, false, false, yaw, 0, {
    fire: true,
    reload: false,
    requestMission: false
  });
  sim.updateFirstPersonPlayer(0.05, 0, 0, false, false, false, false, yaw, 0, {
    fire: false,
    reload: true,
    requestMission: false
  });
  for (let i = 0; i < 4; i++) {
    sim.updateFirstPersonPlayer(0.05, 0, 0, false, false, false, false, yaw, 0, {
      fire: false,
      reload: false,
      requestMission: false
    });
  }
  sim.updateFirstPersonPlayer(0.05, 0, 0, false, false, false, false, yaw, 0, {
    fire: false,
    reload: true,
    requestMission: false
  });
  const durAfterJam = sim.firstPerson.weapon.reloadDuration ?? 0;
  assert.equal(sim.firstPerson.weapon.activeReloadFeedback, 'jammed');
  assert.ok(durAfterJam > PLAYER_WEAPONS.carbine.reload + 0.3);
  assert.ok(sounds.includes('active_reload_jam'));
  sim.updateFirstPersonPlayer(0.05, 0, 0, false, false, false, false, yaw, 0, {
    fire: false,
    reload: true,
    requestMission: false
  });
  assert.equal(sim.firstPerson.weapon.reloadDuration, durAfterJam);

  // Dry fire sound
  sim.firstPerson.weapon.reloadTimer = 0;
  sim.firstPerson.weapon.cooldown = 0;
  sim.firstPerson.weapon.ammo = 0;
  sim.firstPerson.weapon.reserve = 0;
  sim.updateFirstPersonPlayer(0.05, 0, 0, false, false, false, false, yaw, 0, {
    fire: true,
    reload: false,
    requestMission: false
  });
  assert.ok(sounds.includes('player_dry_fire'));

  // ADS reduced spread
  sim.firstPerson.weapon.ammo = 24;
  sim.firstPerson.weapon.reserve = 96;
  sim.firstPerson.weapon.steadyTimer = 0;
  sim.firstPerson.weapon.spread = 0;
  sim.updateFirstPersonPlayer(0.2, 0, 0, false, false, false, false, yaw, 0, {
    fire: true,
    reload: false,
    requestMission: false,
    aim: false
  });
  const hipSpread = sim.firstPerson.weapon.spread ?? 0;
  sim.firstPerson.weapon.spread = 0;
  sim.firstPerson.weapon.cooldown = 0;
  sim.updateFirstPersonPlayer(0.2, 0, 0, false, false, false, false, yaw, 0, {
    fire: true,
    reload: false,
    requestMission: false,
    aim: true
  });
  const adsSpread = sim.firstPerson.weapon.spread ?? 0;
  assert.equal(sim.firstPerson.aiming, true);
  assert.ok(adsSpread < hipSpread * 0.5);

  // Flashlight toggle stealth
  sim.updateFirstPersonPlayer(0.05, 0, 0, false, false, false, false, yaw, 0, {
    fire: false,
    reload: false,
    requestMission: false,
    toggleFlashlight: true
  });
  assert.equal(sim.firstPerson.flashlightOn, false);
  assert.ok(sounds.includes('flashlight_click'));
  for (const a of sim.agents) {
    if (a.id !== player.id) a.isAlive = false;
  }
  const zStealth = s.createAgent('infected', player.x, player.z - 11.5, false, 'standard');
  zStealth.climbY = 0;
  zStealth.awarenessRadius = 15;
  zStealth.perceptionCooldown = 0;
  zStealth.targetAgentId = null;
  s.pushAgent(zStealth);
  s.rebuildAgentSpatialGrid();
  s.step(0.05);
  assert.notEqual(zStealth.targetAgentId, player.id);

  sim.updateFirstPersonPlayer(0.05, 0, 0, false, false, false, false, yaw, 0, {
    fire: false,
    reload: false,
    requestMission: false,
    toggleFlashlight: true
  });
  zStealth.perceptionCooldown = 0;
  s.step(0.05);
  assert.equal(zStealth.targetAgentId, player.id);

  // Near-death adrenaline clutch
  s.fpGraceTimer = 0;
  player.health = 35;
  const zAttack = s.createAgent('infected', player.x, player.z - 0.8, false, 'standard');
  s.pushAgent(zAttack);
  s.performZombieAttack(zAttack, player);
  assert.ok(player.health > 0 && player.health <= 28);
  assert.ok(sim.firstPerson.adrenalineTimer >= 2.5);
  assert.ok((sim.firstPerson.flashlightFlickerTimer ?? 0) > 0);
  assert.ok(sounds.includes('adrenaline_surge'));
});
