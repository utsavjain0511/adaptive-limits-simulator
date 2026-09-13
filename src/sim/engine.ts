import { mulberry32, poisson, hashUnit } from './rng';
import { offeredRps } from './load';
import type { AdmissionController, BackendConfig, LoadPattern, SimEvent, TickMetrics } from './types';

export const DT_MS = 20;
const RATE_WINDOW_TICKS = 1000 / DT_MS;      // 1s window for rates
const LATENCY_WINDOW_TICKS = 3000 / DT_MS;   // 3s window for percentiles

export interface SimConfig { backend: BackendConfig; load: LoadPattern; controller: AdmissionController; seed?: number; }

interface Inflight { id: number; arrivedAt: number; remainingMs: number; }
interface TickLog { offered: number; admitted: number; rejected: number; good: number; timedOut: number; latencies: number[]; }

export class Simulation {
  private nowMs = 0;
  private nextId = 0;
  private inflight: Inflight[] = [];
  private active: { event: SimEvent; endsAt: number }[] = [];
  private log: TickLog[] = [];
  private rand: () => number;

  constructor(private config: SimConfig) { this.rand = mulberry32(config.seed ?? 1); }

  get time(): number { return this.nowMs; }
  setController(c: AdmissionController): void { this.config.controller = c; }
  setLoad(p: LoadPattern): void { this.config.load = p; }

  triggerEvent(e: SimEvent): void {
    if (this.active.some((a) => a.event.kind === e.kind)) return;
    this.active.push({ event: e, endsAt: this.nowMs + e.durationMs });
  }

  private effective(): { capacity: number; serviceTimeMs: number } {
    let capacity = this.config.backend.capacity, serviceTimeMs = this.config.backend.serviceTimeMs;
    for (const { event } of this.active) {
      if (event.kind === 'capacity') capacity *= event.multiplier; else serviceTimeMs *= event.multiplier;
    }
    return { capacity, serviceTimeMs };
  }

  step(): TickMetrics {
    const { capacity, serviceTimeMs } = this.effective();
    const ctrl = this.config.controller;
    ctrl.onTick(this.nowMs, DT_MS);

    const arrivals = poisson((offeredRps(this.config.load, this.nowMs) * DT_MS) / 1000, this.rand);
    let admitted = 0, rejected = 0;
    for (let i = 0; i < arrivals; i++) {
      const id = this.nextId++;
      if (ctrl.shouldAdmit(this.inflight.length, this.nowMs)) {
        admitted++;
        this.inflight.push({ id, arrivedAt: this.nowMs, remainingMs: serviceTimeMs * (0.7 + 0.6 * hashUnit(id)) });
      } else rejected++;
    }

    // Beyond capacity, requests share a fixed processing budget and pay a thrashing penalty.
    const n = this.inflight.length;
    const over = Math.max(0, n - capacity);
    const share = n <= capacity ? 1 : capacity / n;
    const penalty = 1 / (1 + (this.config.backend.overloadPenalty * over) / capacity);
    const progress = DT_MS * share * penalty;

    this.nowMs += DT_MS;
    const latencies: number[] = [];
    let good = 0, timedOut = 0;
    const remaining: Inflight[] = [];
    for (const r of this.inflight) {
      r.remainingMs -= progress;
      if (r.remainingMs > 0) { remaining.push(r); continue; }
      const latency = this.nowMs - r.arrivedAt;
      latencies.push(latency);
      if (latency <= this.config.backend.slaMs) good++; else timedOut++;
      ctrl.onComplete(latency, this.nowMs);
    }
    this.inflight = remaining;
    this.active = this.active.filter((a) => a.endsAt > this.nowMs);

    this.log.push({ offered: arrivals, admitted, rejected, good, timedOut, latencies });
    if (this.log.length > LATENCY_WINDOW_TICKS) this.log.shift();
    return this.metrics(capacity, ctrl.currentLimit());
  }

  private metrics(capacity: number, limit: number | null): TickMetrics {
    const recent = this.log.slice(-RATE_WINDOW_TICKS);
    const secs = (recent.length * DT_MS) / 1000;
    const sum = (k: keyof Omit<TickLog, 'latencies'>) => recent.reduce((a, t) => a + t[k], 0);
    const offered = sum('offered'), good = sum('good');
    const lat = this.log.flatMap((t) => t.latencies).sort((a, b) => a - b);
    const mean = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0;
    const completedP99 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.99))] : 0;
    // A stalled backend completes nothing; the oldest in-flight age is a lower bound on its latency.
    const oldestAge = this.inflight.length ? this.nowMs - this.inflight[0].arrivedAt : 0;
    const p99 = Math.max(completedP99, oldestAge);
    return {
      tMs: this.nowMs,
      offeredRps: offered / secs, admittedRps: sum('admitted') / secs, rejectedRps: sum('rejected') / secs,
      inflight: this.inflight.length, limit, capacity,
      meanLatencyMs: mean, p99LatencyMs: p99,
      goodputRps: good / secs, timedOutRps: sum('timedOut') / secs,
      availability: offered ? Math.min(1, good / offered) : 1,
    };
  }
}
