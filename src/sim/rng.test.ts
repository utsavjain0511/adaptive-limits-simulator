import { describe, it, expect } from 'vitest';
import { mulberry32, poisson, hashUnit } from './rng';

const draws = (seed: number, n: number) => { const r = mulberry32(seed); return Array.from({ length: n }, () => r()); };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const variance = (xs: number[]) => { const m = mean(xs); return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1); };

describe('mulberry32 — the seedable uniform source behind arrivals', () => {
  it('reproduces the same sequence for the same seed (what makes A/B runs and tests replayable)', () => {
    expect(draws(42, 1000)).toEqual(draws(42, 1000));
  });

  it('produces a different sequence for a different seed', () => {
    expect(draws(42, 100)).not.toEqual(draws(43, 100));
  });

  it('yields finite numbers in [0, 1)', () => {
    for (const x of draws(7, 10_000)) {
      expect(Number.isFinite(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('is roughly uniform: mean near 0.5 and each decile holds about 10% of draws', () => {
    const xs = draws(1, 100_000);
    expect(mean(xs)).toBeCloseTo(0.5, 2);
    const bins = Array(10).fill(0);
    for (const x of xs) bins[Math.floor(x * 10)]++;
    for (const count of bins) expect(Math.abs(count - 10_000)).toBeLessThan(300); // ±3%, > 3 standard deviations
  });
});

describe('poisson — arrivals per tick', () => {
  it('returns 0 for zero or negative rates', () => {
    const r = mulberry32(1);
    expect(poisson(0, r)).toBe(0);
    expect(poisson(-5, r)).toBe(0);
  });

  it('returns non-negative integers for any positive rate', () => {
    const r = mulberry32(2);
    for (const lambda of [0.01, 0.5, 3, 40, 199, 200, 201, 1000]) {
      for (let i = 0; i < 500; i++) {
        const k = poisson(lambda, r);
        expect(Number.isInteger(k)).toBe(true);
        expect(k).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is deterministic given a seeded generator', () => {
    const a = mulberry32(9), b = mulberry32(9);
    const sa = Array.from({ length: 200 }, () => poisson(12, a));
    const sb = Array.from({ length: 200 }, () => poisson(12, b));
    expect(sa).toEqual(sb);
  });

  it('has sampled mean and variance close to lambda (the defining Poisson property)', () => {
    const r = mulberry32(3);
    for (const lambda of [0.5, 5, 50]) {
      const ks = Array.from({ length: 20_000 }, () => poisson(lambda, r));
      expect(Math.abs(mean(ks) - lambda) / lambda).toBeLessThan(0.05);
      expect(Math.abs(variance(ks) - lambda) / lambda).toBeLessThan(0.1);
    }
  });

  // Knuth's multiplication method needs exp(-lambda), which underflows to 0 for large lambda and
  // would loop forever, so the implementation switches to a normal approximation above 200.
  it('stays Poisson-shaped below, at, and above the lambda = 200 algorithm switch', () => {
    const r = mulberry32(4);
    for (const lambda of [199, 200, 201, 1000]) {
      const ks = Array.from({ length: 20_000 }, () => poisson(lambda, r));
      expect(Math.abs(mean(ks) - lambda) / lambda).toBeLessThan(0.02);
      expect(Math.abs(variance(ks) - lambda) / lambda).toBeLessThan(0.1);
    }
  });
});

describe('hashUnit — per-request jitter keyed by request id', () => {
  it('gives the same value for the same id (so both A/B runs see identical service times)', () => {
    for (const id of [0, 1, 4132, 999_999]) expect(hashUnit(id)).toBe(hashUnit(id));
  });

  it('gives different values for neighbouring ids', () => {
    expect(hashUnit(1)).not.toBe(hashUnit(2));
    expect(hashUnit(1000)).not.toBe(hashUnit(1001));
  });

  it('stays in [0, 1) for small, 32-bit-boundary and very large ids', () => {
    for (const id of [0, 1, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 40, Number.MAX_SAFE_INTEGER]) {
      const v = hashUnit(id);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('spreads consecutive ids across the unit interval without a trend', () => {
    const vs = Array.from({ length: 10_000 }, (_, i) => hashUnit(i));
    expect(mean(vs)).toBeCloseTo(0.5, 1);
    expect(Math.min(...vs)).toBeLessThan(0.01);
    expect(Math.max(...vs)).toBeGreaterThan(0.99);
    const firstHalf = mean(vs.slice(0, 5000)), secondHalf = mean(vs.slice(5000));
    expect(Math.abs(firstHalf - secondHalf)).toBeLessThan(0.02);
  });
});
