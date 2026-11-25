import test from 'node:test';
import assert from 'node:assert/strict';
import { OutbreakSimulation } from '../src/simulation';
import { ktxSurfaceAt } from '../src/ktxTerminal';
import type { AgentData, ScenarioConfig } from '../src/types';

test('Line 3 + KTX 90s siege: all zones fire, defenses hold, and civilians evacuate', () => {
  const cfg: ScenarioConfig = {
    id: 'wwz_busan',
    mapId: 'citadel_express',
    seed: 'line3-siege-test',
    population: 600,
    incubationSeconds: 18,
    initialPolice: 40,
    initialInfected: 3,
    dispatchDelaySeconds: 1,
    allowPlayerIntervention: true,
    enableWaves: false,
    fastStrain: true
  };

  const sim = new OutbreakSimulation(cfg);
  const s: any = sim;
  s.civilianEvacuationStage = 2;

  const spawnZombie = (x: number, z: number, variant: 'standard' | 'runner' | 'brute', climbY = 0) => {
    const zmb: AgentData = s.createAgent('infected', x, z, false, variant);
    zmb.climbY = climbY;
    zmb.onTerminalFloor = climbY > 0;
    s.pushAgent(zmb);
  };

  for (let i = 0; i < 60; i++) {
    const variant = i % 10 === 0 ? 'brute' : i % 3 === 0 ? 'runner' : 'standard';
    spawnZombie(-58 + (i % 12) * 1.15, 132 + Math.floor(i / 12) * 2.4, variant);
  }
  for (let i = 0; i < 60; i++) {
    const variant = i % 10 === 0 ? 'brute' : i % 3 === 0 ? 'runner' : 'standard';
    spawnZombie(18 + (i % 12) * 1.25, 132 + Math.floor(i / 12) * 2.4, variant);
  }

  function classifyZone(p: AgentData): string {
    const wallPost = s.wallAssignments.get(p.id);
    if (wallPost?.wall?.layerIndex === 3) return 'line3_wall';
    if (p.z >= 145 && p.z < 155 && p.climbY < 0.5) return 'line3_ground';
    const surf = ktxSurfaceAt(p.x, p.z, p.climbY)?.id;
    if (surf === 'tower' || (p.x < -50 && p.climbY > 3.2)) return 'tower_4m';
    if (surf === 'east-landing') return 'mezzanine_3m';
    if (surf === 'terrace') return 'terrace_6m';
    if (surf === 'platform') return 'platform_6m';
    if (p.z >= 155 && p.climbY < 0.5) return 'forecourt_0m';
    return 'other';
  }

  const shotsByZone: Record<string, number> = {
    line3_wall: 0,
    line3_ground: 0,
    tower_4m: 0,
    forecourt_0m: 0,
    mezzanine_3m: 0,
    terrace_6m: 0,
    platform_6m: 0
  };
  const prevAmmo = new Map<number, number>();
  for (const a of sim.agents) {
    if (a.role === 'police') prevAmmo.set(a.id, a.ammo);
  }

  for (let step = 0; step < 1800; step++) {
    if (step === 600) {
      for (let i = 0; i < 12; i++) {
        spawnZombie(-46 + (i % 6) * 1.4, 158 + Math.floor(i / 6) * 2.5, i % 3 === 0 ? 'runner' : 'standard');
        spawnZombie(27 + (i % 6) * 1.6, 157 + Math.floor(i / 6) * 2.5, i % 4 === 0 ? 'brute' : 'standard');
      }
      for (let i = 0; i < 10; i++) {
        spawnZombie(28 + (i % 5) * 1.8, 168 + Math.floor(i / 5) * 2.5, 'runner');
      }
      for (let i = 0; i < 6; i++) {
        spawnZombie(-29.5, 190.2 + (i % 3) * 0.9, i === 0 ? 'brute' : 'standard', 6);
      }
    }

    sim.step(0.05);

    for (const p of sim.agents) {
      if (!p.isAlive || p.role !== 'police') continue;
      const zone = classifyZone(p);
      const oldAmmo = prevAmmo.get(p.id) ?? p.ammo;
      const fired = p.ammo < oldAmmo;
      prevAmmo.set(p.id, p.ammo);
      if (fired && zone in shotsByZone) {
        shotsByZone[zone]++;
      }
    }
  }

  const stats = sim.getStats();
  assert.equal(stats.line1Status, 'HOLDING');
  assert.equal(stats.line2Status, 'HOLDING');
  assert.equal(stats.line3Status, 'HOLDING');
  assert.ok(stats.evacuated > 0, `Expected evacuated > 0, got ${stats.evacuated}`);
  assert.ok(shotsByZone.line3_wall > 100, `Expected line3_wall active fire, got ${shotsByZone.line3_wall}`);
  assert.ok(shotsByZone.forecourt_0m > 0, `Expected forecourt_0m active fire`);
  assert.ok(shotsByZone.platform_6m > 0, `Expected platform_6m active fire`);
  assert.ok(shotsByZone.terrace_6m > 0, `Expected terrace_6m active fire`);
  assert.ok(shotsByZone.tower_4m > 0, `Expected tower_4m active fire`);
});
