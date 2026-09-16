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
const STABLE = [
  ['AIMD', () => new AimdLimiter(AIMD_PRESETS.stable)],
  ['Gradient', () => new GradientLimiter(GRADIENT_PRESETS.stable)],
] as const;

// A window with one admission attempt and 20 completions at one latency. `inflight` is the count the engine
// reports at the attempt, i.e. before that request is added — so the limiter sees `inflight + 1` in flight.
// `serviceMs` is the time each completion spent holding a worker; the difference from `latencyMs` is queue wait.
function window(c: AdmissionController, inflight: number, latencyMs: number, fromMs: number, serviceMs = 200): void {
  c.shouldAdmit(inflight, fromMs);
  for (let i = 0; i < 20; i++) c.onComplete(latencyMs, fromMs + i * 5, serviceMs);
  c.onTick(fromMs + 100, 20);
}

describe('AimdLimiter', () => {
  it('grows additively while latency is healthy and the limit is in use, and backs off multiplicatively when not healthy', () => {
    const c: AdmissionController = new AimdLimiter({ ...AIMD_PRESETS.stable, initialLimit: 10, windowMs: 100 });
    window(c, 4, 200, 0); // 5 in flight once admitted = half of 10: utilised
    expect(c.currentLimit()).toBe(10 + AIMD_PRESETS.stable.increaseStep);
    window(c, 12, 2000, 100);
    expect(c.currentLimit()).toBe(Math.floor((10 + AIMD_PRESETS.stable.increaseStep) * AIMD_PRESETS.stable.backoffRatio));
  });
});

describe('GradientLimiter', () => {
  it('adds headroom when uncongested and the limit is in use, and shrinks when latency exceeds tolerance', () => {
    const c: AdmissionController = new GradientLimiter({ ...GRADIENT_PRESETS.stable, initialLimit: 20, smoothing: 1, windowMs: 100 });
    window(c, 9, 200, 0); // 10 in flight once admitted = half of 20: utilised
    expect(c.currentLimit()).toBe(20 + GRADIENT_PRESETS.stable.headroom);
    window(c, 24, 2000, 100);
    expect(c.currentLimit()).toBeLessThan(20 + GRADIENT_PRESETS.stable.headroom);
  });
});

describe('utilisation guard: the limit only grows when at least half of it was in use', () => {
  it('AIMD holds its limit through a healthy but under-used window', () => {
    const c: AdmissionController = new AimdLimiter({ ...AIMD_PRESETS.stable, initialLimit: 10, windowMs: 100 });
    window(c, 3, 200, 0); // 4 in flight < 10 / 2
    expect(c.currentLimit()).toBe(10);
    window(c, 4, 200, 100); // 5 in flight = 10 / 2
    expect(c.currentLimit()).toBe(10 + AIMD_PRESETS.stable.increaseStep);
  });

  it('Gradient holds its limit through a healthy but under-used window', () => {
    const c: AdmissionController = new GradientLimiter({ ...GRADIENT_PRESETS.stable, initialLimit: 20, smoothing: 1, windowMs: 100 });
    window(c, 8, 200, 0); // 9 in flight < 20 / 2
    expect(c.currentLimit()).toBe(20);
  });

  it('counts the request being admitted, so an attempt at exactly limit/2 − 1 in flight is utilised', () => {
    const c: AdmissionController = new AimdLimiter({ ...AIMD_PRESETS.stable, initialLimit: 10, windowMs: 100 });
    window(c, 4, 200, 0); // engine reports 4 before admission; 5 after
    expect(c.currentLimit()).toBe(10 + AIMD_PRESETS.stable.increaseStep);
  });

  it('still backs off under congestion when under-used (the guard gates growth only)', () => {
    const c: AdmissionController = new AimdLimiter({ ...AIMD_PRESETS.stable, initialLimit: 10, windowMs: 100 });
    window(c, 1, 200, 0);  // establishes the 200 ms baseline; under-used, so no growth
    expect(c.currentLimit()).toBe(10);
    window(c, 1, 2000, 100); // congested and still under-used: backoff applies regardless
    expect(c.currentLimit()).toBe(Math.floor(10 * AIMD_PRESETS.stable.backoffRatio));
  });

  it('uses the mean in-flight across the window, so one burst inside a quiet window does not unlock growth', () => {
    const c: AdmissionController = new AimdLimiter({ ...AIMD_PRESETS.stable, initialLimit: 10, windowMs: 100 });
    c.shouldAdmit(1, 0);
    c.shouldAdmit(8, 10); // a single attempt at 9 in flight
    c.shouldAdmit(1, 20);
    for (let i = 0; i < 20; i++) c.onComplete(200, i * 5, 200);
    c.onTick(100, 20);
    expect(c.currentLimit()).toBe(10); // mean (2 + 9 + 2) / 3 ≈ 4.3 < 5
  });

  for (const [name, make] of STABLE) {
    it(`${name} Stable holds its initial limit on a lightly loaded backend, but still probes upward when saturated`, () => {
      // 60 rps on a 50-worker backend keeps ~12 in flight: under half the initial limit of 50 on average, so
      // nothing justifies raising it. Before the guard the limit climbed to maxLimit and sat there; with a
      // peak-based guard it still crept up one step per burst.
      for (const seed of [1, 4]) {
        const light = new Simulation({ backend: BACKEND, load: { kind: 'sustained', baseRps: 60, peakRps: 60 }, controller: make(), seed });
        expect(run(light, 120).limit).toBe(AIMD_PRESETS.stable.initialLimit);
      }
      const saturated = mk(make()); // 300 rps > capacity: in flight sits at the limit, so it may grow
      expect(run(saturated, 10).limit).toBeGreaterThan(AIMD_PRESETS.stable.initialLimit);
    });
  }
});

describe('processing-time baseline: congestion is latency in excess of the time a request spends being served', () => {
  it('AIMD keeps backing off under sustained queueing instead of absorbing the queue wait into its baseline', () => {
    const c: AdmissionController = new AimdLimiter({ ...AIMD_PRESETS.stable, initialLimit: 50, windowMs: 100 });
    // 40 windows in which every request waited 600 ms for a worker and was then served in 200 ms.
    for (let w = 0; w < 40; w++) window(c, 49, 800, w * 100, 200);
    expect(c.currentLimit()).toBe(AIMD_PRESETS.stable.minLimit);
  });

  it('Gradient shrinks toward its floor under sustained queueing for the same reason', () => {
    const c: AdmissionController = new GradientLimiter({ ...GRADIENT_PRESETS.stable, initialLimit: 50, windowMs: 100 });
    for (let w = 0; w < 40; w++) window(c, 49, 800, w * 100, 200);
    expect(c.currentLimit()).toBeLessThan(10); // fixed point of 0.5 × limit + headroom
  });

  it('a window in which every completion was abandoned keeps the previous baseline and still backs off', () => {
    const c: AdmissionController = new AimdLimiter({ ...AIMD_PRESETS.stable, initialLimit: 10, windowMs: 100 });
    window(c, 9, 200, 0, 200);
    expect(c.currentLimit()).toBe(12);
    c.shouldAdmit(11, 100);
    for (let i = 0; i < 20; i++) c.onComplete(10_000, 100 + i * 5, null); // clients gave up; no service time known
    c.onTick(200, 20);
    expect(c.currentLimit()).toBe(Math.floor(12 * AIMD_PRESETS.stable.backoffRatio));
    window(c, 8, 200, 200, 200); // healthy again: judged against the 200 ms baseline, not the 10 s window
    expect(c.currentLimit()).toBe(Math.floor(12 * AIMD_PRESETS.stable.backoffRatio) + AIMD_PRESETS.stable.increaseStep);
  });

  it('holds its limit until it has seen at least one request served to completion', () => {
    const c: AdmissionController = new AimdLimiter({ ...AIMD_PRESETS.stable, initialLimit: 10, windowMs: 100 });
    c.shouldAdmit(9, 0);
    for (let i = 0; i < 20; i++) c.onComplete(10_000, i * 5, null);
    c.onTick(100, 20);
    expect(c.currentLimit()).toBe(10); // nothing to compare 10 s against yet
  });

  it('follows a slower backend within a few windows, so a slowdown with no queueing is not congestion', () => {
    const c: AdmissionController = new AimdLimiter({ ...AIMD_PRESETS.stable, initialLimit: 10, windowMs: 100 });
    for (let w = 0; w < 5; w++) window(c, 9, 200, w * 100, 200);
    const before = c.currentLimit()!;
    // The dependency gets 3× slower: latency and processing time triple together, nothing waits for a worker.
    for (let w = 5; w < 10; w++) window(c, 9, 600, w * 100, 600);
    expect(c.currentLimit()).toBeGreaterThanOrEqual(before); // never backed off
    // Real queueing on top of the slow backend still reads as congestion.
    window(c, 9, 1800, 1000, 600);
    expect(c.currentLimit()).toBeLessThan(before);
  });

  for (const [name, make] of STABLE) {
    it(`${name} Stable does not shrink through a downstream slowdown that leaves workers to spare`, () => {
      // 60 rps at 3× service time needs ~36 of the 50 workers: latency triples but nobody queues, so the
      // limit must not collapse. (100 rps would need 60 workers and genuinely queue.)
      const sim = new Simulation({ backend: BACKEND, load: { kind: 'sustained', baseRps: 60, peakRps: 60 }, controller: make(), seed: 1 });
      const before = run(sim, 10).limit!;
      sim.triggerEvent({ kind: 'serviceTime', multiplier: 3, durationMs: 10_000 });
      let lowest = Infinity;
      for (let s = 0; s < 10; s++) lowest = Math.min(lowest, run(sim, 1).limit!);
      expect(lowest).toBeGreaterThanOrEqual(before * 0.8); // at most one spurious backoff step while the baseline catches up
    });
  }

  for (const [name, make] of STABLE) {
    it(`${name} Stable stays near capacity under three minutes of saturating load (no baseline drift)`, () => {
      // 300 rps on 50 workers: in flight sits at the limit, so growth is allowed; only the baseline can
      // stop it. With a latency baseline the queue wait leaked into it and the limit drifted to 100–200.
      const sim = mk(make());
      for (let minute = 1; minute <= 3; minute++) {
        const m = run(sim, 60);
        expect(m.limit!).toBeGreaterThan(45);
        expect(m.limit!).toBeLessThan(80);
        expect(m.p99LatencyMs).toBeLessThan(500);
      }
    });
  }
});

describe('lesson 4 scenario: capacity drop', () => {
  for (const [name, make] of STABLE) {
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
