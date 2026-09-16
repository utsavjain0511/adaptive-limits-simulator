import { describe, it, expect } from 'vitest';
import { Simulation, DT_MS } from './engine';
import { ConcurrencyLimiter } from './controllers';
import type { AdmissionController, BackendConfig, TickMetrics } from './types';

// Explains what each field of TickMetrics means and how it is computed.
const BACKEND: BackendConfig = { capacity: 50, serviceTimeMs: 200, slaMs: 1000, clientTimeoutMs: 10_000 };
const admitAll: AdmissionController = { name: 'all', shouldAdmit: () => true, onComplete() {}, onTick() {}, currentLimit: () => null };
const admitNone: AdmissionController = { ...admitAll, name: 'none', shouldAdmit: () => false };
const sustained = (rps: number) => ({ kind: 'sustained' as const, baseRps: rps, peakRps: rps });
const sim = (rps: number, controller = admitAll, backend = BACKEND) =>
  new Simulation({ backend, load: sustained(rps), controller, seed: 5 });

function run(s: Simulation, seconds: number): TickMetrics {
  let m!: TickMetrics;
  for (let i = 0; i < (seconds * 1000) / DT_MS; i++) m = s.step();
  return m;
}

describe('time and rates', () => {
  it('tMs advances by one tick per step', () => {
    const s = sim(10);
    expect(s.step().tMs).toBe(DT_MS);
    expect(s.step().tMs).toBe(2 * DT_MS);
  });

  it('rates are per-second averages over a rolling 1 s window', () => {
    const m = run(sim(100), 10);
    expect(m.offeredRps).toBeGreaterThan(75);
    expect(m.offeredRps).toBeLessThan(125);
  });

  it('rates are already per-second during the first second (a shorter window is scaled, not padded)', () => {
    const m = run(sim(100), 0.2); // 10 ticks in the window
    expect(m.offeredRps).toBeGreaterThan(40);
    expect(m.offeredRps).toBeLessThan(180);
  });

  it('every offered request is either admitted or rejected', () => {
    const m = run(sim(300, new ConcurrencyLimiter(20)), 5);
    expect(m.admittedRps + m.rejectedRps).toBeCloseTo(m.offeredRps, 6);
    expect(m.rejectedRps).toBeGreaterThan(0);
  });
});

describe('inflight, capacity and limit', () => {
  it("inflight follows Little's law below capacity: rps × service time", () => {
    const m = run(sim(100), 10); // 100 rps × 0.2 s ≈ 20, well under capacity 50
    expect(m.inflight).toBeGreaterThan(10);
    expect(m.inflight).toBeLessThan(35);
  });

  it('inflight is 0 when nothing is admitted', () => {
    expect(run(sim(100, admitNone), 3).inflight).toBe(0);
  });

  it('capacity reports the effective value, including active events', () => {
    const s = sim(10);
    expect(s.step().capacity).toBe(50);
    s.triggerEvent({ kind: 'capacity', multiplier: 0.5, durationMs: 500 });
    expect(s.step().capacity).toBe(25);
  });

  it('limit mirrors the controller: null without one, the number with one', () => {
    expect(run(sim(10), 1).limit).toBeNull();
    expect(run(sim(10, new ConcurrencyLimiter(7)), 1).limit).toBe(7);
  });
});

describe('latency', () => {
  it('mean latency ≈ service time when the backend is not oversubscribed', () => {
    const m = run(sim(100), 10);
    expect(m.meanLatencyMs).toBeGreaterThan(180); // jitter 0.7–1.3 averages to 1.0; 20 ms tick quantisation rounds up
    expect(m.meanLatencyMs).toBeLessThan(260);
  });

  it('p99 is never below the mean and reflects the slowest completions', () => {
    const m = run(sim(100), 10);
    expect(m.p99LatencyMs).toBeGreaterThanOrEqual(m.meanLatencyMs);
    expect(m.p99LatencyMs).toBeLessThanOrEqual(BACKEND.serviceTimeMs * 1.3 + DT_MS);
  });

  it('a serviceTime event scales latency by its multiplier', () => {
    const s = sim(50); // 50 rps × 0.6 s = 30 in flight after the event: still under capacity, so no queueing on top
    run(s, 5);
    s.triggerEvent({ kind: 'serviceTime', multiplier: 3, durationMs: 10_000 });
    const m = run(s, 5);
    expect(m.meanLatencyMs).toBeGreaterThan(500);
    expect(m.meanLatencyMs).toBeLessThan(750);
  });

  it('splits mean latency into queue wait and service time', () => {
    const idle = run(sim(100), 10); // under capacity: no queue
    expect(idle.meanWaitMs).toBeLessThan(15);
    expect(idle.meanServiceMs).toBeGreaterThan(190);
    expect(idle.meanServiceMs).toBeLessThan(230);
    const queued = run(sim(10, admitAll, { ...BACKEND, capacity: 1 }), 10); // one worker: everything waits
    expect(queued.meanWaitMs).toBeGreaterThan(300);
    expect(queued.meanServiceMs).toBeLessThan(230);
    expect(queued.meanWaitMs + queued.meanServiceMs).toBeCloseTo(queued.meanLatencyMs, 6);
  });

  it('when nothing completes, mean and p99 report the age of the oldest in-flight request instead of 0', () => {
    // A single slot with a 100 s service time: requests pile up and none finish within the 3 s window.
    const stalled: BackendConfig = { ...BACKEND, capacity: 1, serviceTimeMs: 100_000 };
    const m = run(sim(10, admitAll, stalled), 2);
    expect(m.inflight).toBeGreaterThan(0);
    expect(m.p99LatencyMs).toBeGreaterThan(1500);
    expect(m.p99LatencyMs).toBeLessThanOrEqual(2000);
    expect(m.meanLatencyMs).toBe(m.p99LatencyMs);
  });
});

describe('goodput, timeouts and availability', () => {
  it('goodput ≈ offered and availability ≈ 1 when every request meets the SLA', () => {
    const m = run(sim(100), 10);
    expect(m.goodputRps).toBeGreaterThan(75);
    expect(m.goodputRps).toBeLessThan(125);
    expect(m.timedOutRps).toBe(0);
    expect(m.availability).toBeGreaterThan(0.9);
  });

  it('a completion slower than the SLA counts as timed out, not good, even though the server did the work', () => {
    const strict: BackendConfig = { ...BACKEND, slaMs: 100 }; // below the 200 ms service time
    const m = run(sim(100, admitAll, strict), 10);
    expect(m.goodputRps).toBe(0);
    expect(m.timedOutRps).toBeGreaterThan(75);
    expect(m.availability).toBe(0);
  });

  it('rejections are failures: availability = good ÷ (good + rejected + timed out)', () => {
    const m = run(sim(300, new ConcurrencyLimiter(20)), 10);
    expect(m.availability).toBeCloseTo(m.goodputRps / (m.goodputRps + m.rejectedRps + m.timedOutRps), 6);
    expect(m.availability).toBeLessThan(0.6);
    expect(run(sim(100, admitNone), 3).availability).toBe(0);
  });

  it('pending requests are not failures: availability stays 1 while everything is still in flight within the SLA', () => {
    const slow: BackendConfig = { ...BACKEND, serviceTimeMs: 2500, slaMs: 3000 }; // fastest completion is 0.7 × 2.5 s = 1.75 s
    const m = run(sim(10, admitAll, slow), 1.5); // nothing can have completed yet
    expect(m.inflight).toBeGreaterThan(0);
    expect(m.goodputRps).toBe(0);
    expect(m.availability).toBe(1);
  });

  it('an in-flight request already older than the SLA counts as failed before it completes', () => {
    const stalled: BackendConfig = { ...BACKEND, capacity: 1, serviceTimeMs: 100_000 };
    const m = run(sim(10, admitAll, stalled), 3); // nothing completes; most of the backlog is past the 1 s SLA
    expect(m.goodputRps).toBe(0);
    expect(m.timedOutRps).toBe(0);
    expect(m.availability).toBe(0);
  });

  it('availability never exceeds 1', () => {
    const s = sim(100);
    for (let i = 0; i < 500; i++) expect(s.step().availability).toBeLessThanOrEqual(1);
  });

  it('availability is 1 when nothing is offered (no traffic means nothing failed)', () => {
    expect(run(sim(0), 2).availability).toBe(1);
    expect(run(sim(0), 2).offeredRps).toBe(0);
  });
});
