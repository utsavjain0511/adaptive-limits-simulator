import type { AdmissionController } from './types';

export class NoLimit implements AdmissionController {
  readonly name = 'No admission control';
  shouldAdmit(): boolean { return true; }
  onComplete(): void {}
  onTick(): void {}
  currentLimit(): null { return null; }
}

export class ConcurrencyLimiter implements AdmissionController {
  readonly name = 'Concurrency limit';
  constructor(public limit: number) {}
  shouldAdmit(inflight: number): boolean { return inflight < this.limit; }
  onComplete(): void {}
  onTick(): void {}
  currentLimit(): number { return this.limit; }
}

export class RpsLimiter implements AdmissionController {
  readonly name = 'RPS limit (token bucket)';
  private tokens: number;
  constructor(public rps: number, public burst = Math.max(1, rps / 10)) { this.tokens = burst; }
  shouldAdmit(): boolean {
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  onComplete(): void {}
  onTick(_nowMs: number, dtMs: number): void { this.tokens = Math.min(this.burst, this.tokens + (this.rps * dtMs) / 1000); }
  currentLimit(): null { return null; }
}
