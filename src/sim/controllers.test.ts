import { describe, it, expect } from 'vitest';
import { NoLimit, ConcurrencyLimiter, RpsLimiter } from './controllers';
import { Simulation, DT_MS } from './engine';
import type { AdmissionController, BackendConfig, TickMetrics } from './types';

const BACKEND: BackendConfig = { capacity: 50, serviceTimeMs: 200, overloadPenalty: 1.0, slaMs: 1000, clientTimeoutMs: 10000 };
const load = (rps: number) => ({ kind: 'sustained' as const, baseRps: rps, peakRps: rps });
function run(sim: Simulation, seconds: number): TickMetrics {
  let m!: TickMetrics;
  for (let i = 0; i < (seconds * 1000) / DT_MS; i++) m = sim.step();
  return m;
}

describe('NoLimit', () => {
  it('admits everything and reports no limit', () => {
    const c: AdmissionController = new NoLimit();
    expect(c.shouldAdmit(10_000, 0)).toBe(true);
    expect(c.currentLimit()).toBeNull();
  });
});

describe('ConcurrencyLimiter', () => {
  it('admits only while inflight is below the limit', () => {
    const c: AdmissionController = new ConcurrencyLimiter(3);
    expect(c.shouldAdmit(2, 0)).toBe(true);
    expect(c.shouldAdmit(3, 0)).toBe(false);
    expect(c.currentLimit()).toBe(3);
  });

  it('keeps goodput near capacity under 2.4x overload (lesson 1)', () => {
    const sim = new Simulation({ backend: BACKEND, load: load(600), controller: new ConcurrencyLimiter(60), seed: 1 });
    const m = run(sim, 30);
    expect(m.inflight).toBeLessThanOrEqual(60);
    expect(m.p99LatencyMs).toBeLessThan(BACKEND.slaMs);
    expect(m.goodputRps).toBeGreaterThan(180);
  });
});

describe('RpsLimiter', () => {
  it('admits roughly its configured rate', () => {
    const sim = new Simulation({ backend: BACKEND, load: load(300), controller: new RpsLimiter(200), seed: 1 });
    const m = run(sim, 10);
    expect(m.admittedRps).toBeGreaterThan(180);
    expect(m.admittedRps).toBeLessThan(215);
  });

  it('melts during a service-time spike where a concurrency limiter survives (lesson 2)', () => {
    const mk = (c: RpsLimiter | ConcurrencyLimiter) => new Simulation({ backend: BACKEND, load: load(300), controller: c, seed: 1 });
    const a = mk(new RpsLimiter(200)), b = mk(new ConcurrencyLimiter(40));
    run(a, 5); run(b, 5);
    const spike = { kind: 'serviceTime' as const, multiplier: 3, durationMs: 10_000 };
    a.triggerEvent(spike); b.triggerEvent(spike);
    const ma = run(a, 8), mb = run(b, 8);
    expect(ma.inflight).toBeGreaterThan(100);
    expect(ma.availability).toBeLessThan(0.1);
    expect(mb.inflight).toBeLessThanOrEqual(40);
    expect(mb.p99LatencyMs).toBeLessThan(BACKEND.slaMs);
    expect(mb.goodputRps).toBeGreaterThan(40);
  });
});
