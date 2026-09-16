import type { AdmissionController } from './types';

export interface AdaptiveBounds { initialLimit: number; minLimit: number; maxLimit: number; windowMs: number; }
export interface AimdConfig extends AdaptiveBounds { latencyThresholdFactor: number; increaseStep: number; backoffRatio: number; }
export interface GradientConfig extends AdaptiveBounds { tolerance: number; smoothing: number; headroom: number; }
export type PresetName = 'stable' | 'aggressive' | 'sluggish';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Baseline = min of recent window averages of *processing* time (time holding a worker, excluding queue
// wait). Queueing therefore never leaks into the baseline, however long it lasts; the bounded memory only
// lets the baseline follow a change in the backend's own speed after `windows` windows.
class BaselineTracker {
  private hist: number[] = [];
  constructor(private readonly windows = 30) {}
  push(v: number): void {
    this.hist.push(v);
    if (this.hist.length > this.windows) this.hist.shift();
  }
  current(): number | null { return this.hist.length ? Math.min(...this.hist) : null; }
}

abstract class WindowedLimiter implements AdmissionController {
  abstract readonly name: string;
  protected limit: number;
  private latencies: number[] = [];
  private services: number[] = [];
  private inflightSum = 0;
  private inflightSamples = 0;
  private windowEndsAt: number;
  private readonly baseline = new BaselineTracker();

  constructor(private readonly bounds: AdaptiveBounds) {
    this.limit = bounds.initialLimit;
    this.windowEndsAt = bounds.windowMs;
  }
  shouldAdmit(inflight: number): boolean {
    const admit = inflight < this.limit;
    // `inflight` is the count before this request; sample what it will be once admitted.
    this.inflightSum += admit ? inflight + 1 : inflight;
    this.inflightSamples++;
    return admit;
  }
  onComplete(latencyMs: number, _nowMs: number, serviceMs: number | null): void {
    this.latencies.push(latencyMs);
    if (serviceMs != null) this.services.push(serviceMs);
  }
  onTick(nowMs: number): void {
    if (nowMs < this.windowEndsAt) return;
    this.windowEndsAt = nowMs + this.bounds.windowMs;
    // Healthy latency only justifies a higher limit if the current one was actually being used; a lightly
    // loaded service must not ratchet its limit up to the maximum and then have no headroom to shed with.
    // The mean in-flight seen at arrivals is used rather than the peak: Poisson arrivals see time averages,
    // and a single burst must not unlock a one-way growth step.
    const meanInflight = this.inflightSamples ? this.inflightSum / this.inflightSamples : 0;
    const utilised = meanInflight * 2 >= this.limit;
    this.inflightSum = 0;
    this.inflightSamples = 0;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const latencies = this.latencies, services = this.services;
    this.latencies = [];
    this.services = [];
    if (latencies.length === 0) return;
    // A window whose completions were all abandoned has no service samples; it is judged against the last
    // known baseline. Until one request has been served to completion there is nothing to judge against.
    if (services.length > 0) this.baseline.push(mean(services));
    const base = this.baseline.current();
    if (base == null) return;
    const next = clamp(this.update(mean(latencies), base), this.bounds.minLimit, this.bounds.maxLimit);
    if (next < this.limit || utilised) this.limit = next;
  }
  currentLimit(): number { return Math.floor(this.limit); }
  // windowAvgMs is the window's mean latency (wait + service); baselineMs is the backend's processing time.
  protected abstract update(windowAvgMs: number, baselineMs: number): number;
}

export class AimdLimiter extends WindowedLimiter {
  readonly name = 'AIMD';
  constructor(private readonly cfg: AimdConfig) { super(cfg); }
  protected update(avg: number, base: number): number {
    return avg > base * this.cfg.latencyThresholdFactor ? this.limit * this.cfg.backoffRatio : this.limit + this.cfg.increaseStep;
  }
}

export class GradientLimiter extends WindowedLimiter {
  readonly name = 'Gradient';
  constructor(private readonly cfg: GradientConfig) { super(cfg); }
  protected update(avg: number, base: number): number {
    const gradient = clamp((this.cfg.tolerance * base) / avg, 0.5, 1);
    const target = this.limit * gradient + this.cfg.headroom;
    return this.limit * (1 - this.cfg.smoothing) + target * this.cfg.smoothing;
  }
}

const BOUNDS: AdaptiveBounds = { initialLimit: 50, minLimit: 2, maxLimit: 200, windowMs: 500 };

export const AIMD_PRESETS: Record<PresetName, AimdConfig> = {
  stable:     { ...BOUNDS, latencyThresholdFactor: 1.3, increaseStep: 2, backoffRatio: 0.8 },
  aggressive: { ...BOUNDS, latencyThresholdFactor: 1.2, increaseStep: 10, backoffRatio: 0.5 },
  sluggish:   { ...BOUNDS, windowMs: 1000, latencyThresholdFactor: 3.0, increaseStep: 1, backoffRatio: 0.9 },
};

export const GRADIENT_PRESETS: Record<PresetName, GradientConfig> = {
  stable:     { ...BOUNDS, tolerance: 1.2, smoothing: 0.5, headroom: 4 },
  aggressive: { ...BOUNDS, tolerance: 1.05, smoothing: 1.0, headroom: 12 },
  sluggish:   { ...BOUNDS, tolerance: 2.0, smoothing: 0.1, headroom: 1 },
};
