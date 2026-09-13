import { describe, it, expect } from 'vitest';
import { createFlow, stepFlow, DOTS_PER_RPS, MAX_DOTS_PER_SEC, MAX_PARTICLES_PER_LANE, type LaneMetrics } from './flowModel';

const lane = (offeredRps: number, admittedRps = offeredRps, meanLatencyMs = 200): LaneMetrics =>
  ({ offeredRps, admittedRps, meanLatencyMs, slaMs: 1000 });

function run(state: ReturnType<typeof createFlow>, lanes: LaneMetrics[], ms: number, rand: () => number) {
  for (let t = 0; t < ms; t += 20) stepFlow(state, lanes, 20, rand);
}

describe('flowModel', () => {
  it('spawns dots proportional to offered rps', () => {
    const state = createFlow(1);
    run(state, [lane(300)], 1000, () => 0.5);
    expect(state.stats[0].spawned).toBeGreaterThanOrEqual(Math.floor(300 * DOTS_PER_RPS) - 1);
    expect(state.stats[0].spawned).toBeLessThanOrEqual(Math.ceil(300 * DOTS_PER_RPS) + 1);
  });

  it('splits dots into admitted and rejected in proportion to admitted/offered', () => {
    const state = createFlow(1);
    let i = 0;
    const rand = () => ((i++ % 10) + 0.5) / 10; // uniform 0.05..0.95 cycle
    run(state, [lane(1000, 250)], 5000, rand);
    const { admitted, rejected } = state.stats[0];
    expect(admitted + rejected).toBeGreaterThan(50);
    expect(admitted / (admitted + rejected)).toBeGreaterThan(0.15);
    expect(admitted / (admitted + rejected)).toBeLessThan(0.35);
  });

  it('caps the spawn rate and the number of live particles per lane', () => {
    const state = createFlow(2);
    run(state, [lane(100_000, 100_000, 3000), lane(0)], 1000, () => 0.5);
    expect(state.stats[0].spawned).toBeLessThanOrEqual(MAX_DOTS_PER_SEC + 1);
    run(state, [lane(100_000, 100_000, 3000), lane(0)], 10_000, () => 0.5);
    expect(state.particles.filter((p) => p.lane === 0).length).toBeLessThanOrEqual(MAX_PARTICLES_PER_LANE);
    expect(state.particles.filter((p) => p.lane === 1).length).toBe(0);
  });

  it('drains all particles once traffic stops', () => {
    const state = createFlow(1);
    run(state, [lane(300)], 1000, () => 0.5);
    expect(state.particles.length).toBeGreaterThan(0);
    run(state, [lane(0)], 8000, () => 0.5);
    expect(state.particles.length).toBe(0);
  });

  it('marks exiting dots good only when latency is within the SLA', () => {
    const good = createFlow(1);
    run(good, [lane(300, 300, 200)], 2500, () => 0.5);
    expect(good.particles.some((p) => p.stage === 'exiting' && p.good)).toBe(true);
    const bad = createFlow(1);
    run(bad, [lane(300, 300, 5000)], 5000, () => 0.5);
    expect(bad.particles.some((p) => p.stage === 'exiting' && !p.good)).toBe(true);
    expect(bad.particles.some((p) => p.stage === 'exiting' && p.good)).toBe(false);
  });
});
