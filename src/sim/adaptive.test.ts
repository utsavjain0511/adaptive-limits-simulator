import { describe, it, expect } from 'vitest';
import { AimdLimiter, GradientLimiter, AIMD_PRESETS, GRADIENT_PRESETS } from './adaptive';
import { ConcurrencyLimiter } from './controllers';
import { Simulation, DT_MS } from './engine';
import type { AdmissionController, BackendConfig, TickMetrics } from './types';

const BACKEND: BackendConfig = { capacity: 50, serviceTimeMs: 200, overloadPenalty: 1.0, slaMs: 1000 };
const load = { kind: 'sustained' as const, baseRps: 300, peakRps: 300 };
const DROP = { kind: 'capacity' as const, multiplier: 0.3, durationMs: 10_000 };
function run(sim: Simulation, seconds: number): TickMetrics {
  let m!: TickMetrics;
  for (let i = 0; i < (seconds * 1000) / DT_MS; i++) m = sim.step();
  return m;
}
const mk = (c: AdmissionController) => new Simulation({ backend: BACKEND, load, controller: c, seed: 1 });

describe('AimdLimiter', () => {
  it('grows additively while latency is healthy and backs off multiplicatively when not', () => {
    const c: AdmissionController = new AimdLimiter({ ...AIMD_PRESETS.stable, initialLimit: 10, windowMs: 100 });
    for (let i = 0; i < 20; i++) c.onComplete(200, i * 5);
    c.onTick(100, 20);
    expect(c.currentLimit()).toBe(10 + AIMD_PRESETS.stable.increaseStep);
    for (let i = 0; i < 20; i++) c.onComplete(2000, 100 + i * 5);
    c.onTick(200, 20);
    expect(c.currentLimit()).toBe(Math.floor((10 + AIMD_PRESETS.stable.increaseStep) * AIMD_PRESETS.stable.backoffRatio));
  });
});

describe('GradientLimiter', () => {
  it('adds headroom when uncongested and shrinks when latency exceeds tolerance', () => {
    const c: AdmissionController = new GradientLimiter({ ...GRADIENT_PRESETS.stable, initialLimit: 20, smoothing: 1, windowMs: 100 });
    for (let i = 0; i < 20; i++) c.onComplete(200, i * 5);
    c.onTick(100, 20);
    expect(c.currentLimit()).toBe(20 + GRADIENT_PRESETS.stable.headroom);
    for (let i = 0; i < 20; i++) c.onComplete(2000, 100 + i * 5);
    c.onTick(200, 20);
    expect(c.currentLimit()).toBeLessThan(20 + GRADIENT_PRESETS.stable.headroom);
  });
});

describe('lesson 4 scenario: capacity drop', () => {
  for (const [name, make] of [
    ['AIMD', () => new AimdLimiter(AIMD_PRESETS.stable)],
    ['Gradient', () => new GradientLimiter(GRADIENT_PRESETS.stable)],
  ] as const) {
    it(`${name} keeps goodput > 0 and latency under SLA during the drop where static 50 does not`, () => {
      const a = mk(new ConcurrencyLimiter(50)), b = mk(make());
      run(a, 10); run(b, 10);
      a.triggerEvent(DROP); b.triggerEvent(DROP);
      const ma = run(a, 8), mb = run(b, 8);
      expect(ma.availability).toBeLessThan(0.05);
      expect(mb.limit!).toBeLessThan(35);
      expect(mb.p99LatencyMs).toBeLessThan(BACKEND.slaMs);
      expect(mb.goodputRps).toBeGreaterThan(30);
      const after = run(b, 15);
      expect(after.limit!).toBeGreaterThan(40); // recovers toward capacity
    });
  }
});
