import { describe, it, expect } from 'vitest';
import { Simulation, DT_MS } from './engine';
import type { AdmissionController, BackendConfig, TickMetrics } from './types';

const BACKEND: BackendConfig = { capacity: 50, serviceTimeMs: 200, slaMs: 1000, clientTimeoutMs: 10000 };
const admitAll: AdmissionController = { name: 'all', shouldAdmit: () => true, onComplete() {}, onTick() {}, currentLimit: () => null };
const admitNone: AdmissionController = { ...admitAll, name: 'none', shouldAdmit: () => false };

function run(sim: Simulation, seconds: number): TickMetrics {
  let m!: TickMetrics;
  for (let i = 0; i < (seconds * 1000) / DT_MS; i++) m = sim.step();
  return m;
}

describe('Simulation', () => {
  it('is deterministic for a seed', () => {
    const mk = () => new Simulation({ backend: BACKEND, load: { kind: 'sustained', baseRps: 100, peakRps: 100 }, controller: admitAll, seed: 7 });
    expect(run(mk(), 5)).toEqual(run(mk(), 5));
  });

  it('serves below-capacity load at nominal latency with full availability', () => {
    const sim = new Simulation({ backend: BACKEND, load: { kind: 'sustained', baseRps: 100, peakRps: 100 }, controller: admitAll, seed: 1 });
    const m = run(sim, 10);
    expect(m.goodputRps).toBeGreaterThan(70);
    expect(m.goodputRps).toBeLessThan(130);
    expect(m.meanLatencyMs).toBeGreaterThan(150);
    expect(m.meanLatencyMs).toBeLessThan(300);
    expect(m.availability).toBeGreaterThan(0.95);
    expect(m.inflight).toBeLessThan(50);
  });

  it('rejects everything when the controller refuses', () => {
    const sim = new Simulation({ backend: BACKEND, load: { kind: 'sustained', baseRps: 100, peakRps: 100 }, controller: admitNone, seed: 1 });
    const m = run(sim, 3);
    expect(m.admittedRps).toBe(0);
    expect(m.rejectedRps).toBeGreaterThan(60);
    expect(m.inflight).toBe(0);
  });

  it('queues under sustained overload: latency past SLA and goodput collapses', () => {
    const sim = new Simulation({ backend: BACKEND, load: { kind: 'sustained', baseRps: 600, peakRps: 600 }, controller: admitAll, seed: 1 });
    const m = run(sim, 30);
    expect(m.inflight).toBeGreaterThan(1000);
    expect(m.p99LatencyMs).toBeGreaterThan(BACKEND.slaMs);
    expect(m.availability).toBeLessThan(0.05);
  });

  it('abandons requests older than clientTimeoutMs so in-flight stays bounded under overload', () => {
    const backend = { ...BACKEND, clientTimeoutMs: 2000 };
    const sim = new Simulation({ backend, load: { kind: 'sustained', baseRps: 600, peakRps: 600 }, controller: admitAll, seed: 1 });
    const m = run(sim, 60);
    // Little's law: at most offered × timeout in flight (600 rps × 2 s = 1200), plus Poisson noise.
    expect(m.inflight).toBeGreaterThan(900);
    expect(m.inflight).toBeLessThan(1500);
    expect(m.p99LatencyMs).toBeLessThanOrEqual(backend.clientTimeoutMs);
    expect(m.timedOutRps).toBeGreaterThan(500);
    expect(m.availability).toBeLessThan(0.05);
  });

  it('reports abandoned requests to the controller as completions at the timeout latency', () => {
    const seen: number[] = [];
    const recording: AdmissionController = { ...admitAll, onComplete: (latencyMs) => { seen.push(latencyMs); } };
    const backend = { ...BACKEND, clientTimeoutMs: 2000 };
    const sim = new Simulation({ backend, load: { kind: 'sustained', baseRps: 600, peakRps: 600 }, controller: recording, seed: 1 });
    run(sim, 10);
    expect(seen.some((l) => l < backend.clientTimeoutMs)).toBe(true);   // normal completions still reported
    expect(seen.filter((l) => l === backend.clientTimeoutMs).length).toBeGreaterThan(1000); // abandoned ones too
  });

  it('applies a capacity event for its duration only, one per kind', () => {
    const sim = new Simulation({ backend: BACKEND, load: { kind: 'sustained', baseRps: 10, peakRps: 10 }, controller: admitAll, seed: 1 });
    sim.triggerEvent({ kind: 'capacity', multiplier: 0.5, durationMs: 1000 });
    sim.triggerEvent({ kind: 'capacity', multiplier: 0.5, durationMs: 1000 }); // ignored while one is active
    expect(sim.step().capacity).toBe(25);
    run(sim, 1);
    expect(sim.step().capacity).toBe(50);
  });
});
