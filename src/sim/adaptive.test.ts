import { describe, it, expect } from 'vitest';
import { AimdLimiter, GradientLimiter, AIMD_PRESETS, GRADIENT_PRESETS } from './adaptive';
import { ConcurrencyLimiter } from './controllers';
import { Simulation, DT_MS } from './engine';
import { CAPACITY_DROP, DEFAULT_BACKEND } from './scenario';
import type { AdmissionController, TickMetrics } from './types';

// The lesson's own backend and event, so the scenario follows the lesson if either is retuned.
const BACKEND = DEFAULT_BACKEND;
const DROP = CAPACITY_DROP;
const load = { kind: 'sustained' as const, baseRps: 300, peakRps: 300 };
function run(sim: Simulation, seconds: number): TickMetrics {
  let m!: TickMetrics;
  for (let i = 0; i < (seconds * 1000) / DT_MS; i++) m = sim.step();
  return m;
}
const mk = (c: AdmissionController) => new Simulation({ backend: BACKEND, load, controller: c, seed: 1 });

// A window's completions, all at one latency; `inflight` is what the limiter saw in flight during it.
function window(c: AdmissionController, inflight: number, latencyMs: number, fromMs: number): void {
  c.shouldAdmit(inflight, fromMs);
  for (let i = 0; i < 20; i++) c.onComplete(latencyMs, fromMs + i * 5);
  c.onTick(fromMs + 100, 20);
}

describe('AimdLimiter', () => {
  it('grows additively while latency is healthy and the limit is in use, and backs off multiplicatively when not healthy', () => {
    const c: AdmissionController = new AimdLimiter({ ...AIMD_PRESETS.stable, initialLimit: 10, windowMs: 100 });
    window(c, 5, 200, 0); // 5 in flight = half of 10: utilised
    expect(c.currentLimit()).toBe(10 + AIMD_PRESETS.stable.increaseStep);
    window(c, 12, 2000, 100);
    expect(c.currentLimit()).toBe(Math.floor((10 + AIMD_PRESETS.stable.increaseStep) * AIMD_PRESETS.stable.backoffRatio));
  });
});

describe('GradientLimiter', () => {
  it('adds headroom when uncongested and the limit is in use, and shrinks when latency exceeds tolerance', () => {
    const c: AdmissionController = new GradientLimiter({ ...GRADIENT_PRESETS.stable, initialLimit: 20, smoothing: 1, windowMs: 100 });
    window(c, 10, 200, 0); // 10 in flight = half of 20: utilised
    expect(c.currentLimit()).toBe(20 + GRADIENT_PRESETS.stable.headroom);
    window(c, 24, 2000, 100);
    expect(c.currentLimit()).toBeLessThan(20 + GRADIENT_PRESETS.stable.headroom);
  });
});

describe('utilisation guard: the limit only grows when at least half of it was in use', () => {
  it('AIMD holds its limit through a healthy but under-used window', () => {
    const c: AdmissionController = new AimdLimiter({ ...AIMD_PRESETS.stable, initialLimit: 10, windowMs: 100 });
    window(c, 4, 200, 0); // 4 < 10 / 2
    expect(c.currentLimit()).toBe(10);
    window(c, 5, 200, 100);
    expect(c.currentLimit()).toBe(10 + AIMD_PRESETS.stable.increaseStep);
  });

  it('Gradient holds its limit through a healthy but under-used window', () => {
    const c: AdmissionController = new GradientLimiter({ ...GRADIENT_PRESETS.stable, initialLimit: 20, smoothing: 1, windowMs: 100 });
    window(c, 9, 200, 0); // 9 < 20 / 2
    expect(c.currentLimit()).toBe(20);
  });

  it('still backs off under congestion when under-used (the guard gates growth only)', () => {
    const c: AdmissionController = new AimdLimiter({ ...AIMD_PRESETS.stable, initialLimit: 10, windowMs: 100 });
    window(c, 1, 200, 0);  // establishes the 200 ms baseline; under-used, so no growth
    expect(c.currentLimit()).toBe(10);
    window(c, 1, 2000, 100); // congested and still under-used: backoff applies regardless
    expect(c.currentLimit()).toBe(Math.floor(10 * AIMD_PRESETS.stable.backoffRatio));
  });

  it('uses the peak in-flight seen during the window, so a burst inside an otherwise quiet window counts', () => {
    const c: AdmissionController = new AimdLimiter({ ...AIMD_PRESETS.stable, initialLimit: 10, windowMs: 100 });
    c.shouldAdmit(1, 0);
    c.shouldAdmit(7, 10);
    c.shouldAdmit(2, 20);
    for (let i = 0; i < 20; i++) c.onComplete(200, i * 5);
    c.onTick(100, 20);
    expect(c.currentLimit()).toBe(10 + AIMD_PRESETS.stable.increaseStep);
  });

  for (const [name, make] of [
    ['AIMD', () => new AimdLimiter(AIMD_PRESETS.stable)],
    ['Gradient', () => new GradientLimiter(GRADIENT_PRESETS.stable)],
  ] as const) {
    it(`${name} Stable does not ratchet toward maxLimit on a lightly loaded backend, but still probes upward when saturated`, () => {
      // 60 rps on a 50-worker backend keeps ~12 in flight: under half the initial limit of 50, so nothing
      // justifies raising it. Before the guard the limit climbed to maxLimit and sat there.
      const light = new Simulation({ backend: BACKEND, load: { kind: 'sustained', baseRps: 60, peakRps: 60 }, controller: make(), seed: 1 });
      expect(run(light, 60).limit).toBeLessThanOrEqual(AIMD_PRESETS.stable.initialLimit);
      const saturated = mk(make()); // 300 rps > capacity: in flight sits at the limit, so it may grow
      expect(run(saturated, 10).limit).toBeGreaterThan(AIMD_PRESETS.stable.initialLimit);
    });
  }
});

describe('lesson 4 scenario: capacity drop', () => {
  for (const [name, make] of [
    ['AIMD', () => new AimdLimiter(AIMD_PRESETS.stable)],
    ['Gradient', () => new GradientLimiter(GRADIENT_PRESETS.stable)],
  ] as const) {
    it(`${name} backs off within seconds of the drop and is under the SLA with goodput by its end, where static 50 is not`, () => {
      const a = mk(new ConcurrencyLimiter(50)), b = mk(make());
      run(a, 10); run(b, 10);
      a.triggerEvent(DROP); b.triggerEvent(DROP);
      // Backing off from ~60 to ~12 in flight takes a few windows, so the first seconds of the drop are over
      // the SLA for the adaptive run too; from t+5 s on it must be delivering every second.
      run(a, 5); run(b, 5);
      for (let s = 0; s < 3; s++) {
        const ma = run(a, 1), mb = run(b, 1);
        expect(ma.availability).toBeLessThan(0.05);
        expect(mb.goodputRps).toBeGreaterThan(20);
      }
      const mb = run(b, 0.02); // one tick: the state at the end of the 8 s sampled window
      expect(mb.limit!).toBeLessThan(35);
      expect(mb.p99LatencyMs).toBeLessThan(BACKEND.slaMs);
      expect(mb.goodputRps).toBeGreaterThan(30);
      const after = run(b, 15);
      expect(after.limit!).toBeGreaterThan(40); // recovers toward capacity
    });
  }
});
