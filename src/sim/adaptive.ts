import type { AdmissionController } from './types';

export interface AdaptiveBounds { initialLimit: number; minLimit: number; maxLimit: number; windowMs: number; }
export interface AimdConfig extends AdaptiveBounds { latencyThresholdFactor: number; increaseStep: number; backoffRatio: number; }
export interface GradientConfig extends AdaptiveBounds { tolerance: number; smoothing: number; headroom: number; }
export type PresetName = 'stable' | 'aggressive' | 'sluggish';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// "No-load" latency baseline = min of recent window averages: bounded memory, so a long
// overload cannot drag the baseline up and hide congestion.
class BaselineTracker {
  private hist: number[] = [];
  constructor(private readonly windows = 30) {}
  push(v: number): number {
    this.hist.push(v);
    if (this.hist.length > this.windows) this.hist.shift();
    return Math.min(...this.hist);
  }
}

abstract class WindowedLimiter implements AdmissionController {
  abstract readonly name: string;
  protected limit: number;
  private samples: number[] = [];
  private peakInflight = 0;
  private windowEndsAt: number;
  private readonly baseline = new BaselineTracker();

  constructor(private readonly bounds: AdaptiveBounds) {
    this.limit = bounds.initialLimit;
    this.windowEndsAt = bounds.windowMs;
  }
  shouldAdmit(inflight: number): boolean {
    this.peakInflight = Math.max(this.peakInflight, inflight);
    return inflight < this.limit;
  }
  onComplete(latencyMs: number): void { this.samples.push(latencyMs); }
  onTick(nowMs: number): void {
    if (nowMs < this.windowEndsAt) return;
    this.windowEndsAt = nowMs + this.bounds.windowMs;
    // Healthy latency only justifies a higher limit if the current one was actually being used; a lightly
    // loaded service must not ratchet its limit up to the maximum and then have no headroom to shed with.
    const utilised = this.peakInflight * 2 >= this.limit;
    this.peakInflight = 0;
    if (this.samples.length === 0) return;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.samples = [];
    const next = clamp(this.update(avg, this.baseline.push(avg)), this.bounds.minLimit, this.bounds.maxLimit);
    if (next < this.limit || utilised) this.limit = next;
  }
  currentLimit(): number { return Math.floor(this.limit); }
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
