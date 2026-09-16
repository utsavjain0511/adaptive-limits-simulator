import { mulberry32, poisson, hashUnit } from './rng';
import { offeredRps } from './load';
import type { AdmissionController, BackendConfig, LoadPattern, SimEvent, TickMetrics } from './types';

export const DT_MS = 20;
const RATE_WINDOW_TICKS = 1000 / DT_MS;      // 1s window for rates
const LATENCY_WINDOW_TICKS = 3000 / DT_MS;   // 3s window for percentiles

export interface SimConfig { backend: BackendConfig; load: LoadPattern; controller: AdmissionController; seed?: number; }

interface Inflight { id: number; arrivedAt: number; servedAt?: number; remainingMs?: number; } // servedAt/remainingMs are set when the request first holds a worker
interface TickLog { offered: number; admitted: number; rejected: number; good: number; timedOut: number; latencies: number[]; waits: number[]; services: number[]; }

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
    return { capacity: Math.round(capacity), serviceTimeMs }; // whole workers; 0 means nothing is served
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
        this.inflight.push({ id, arrivedAt: this.nowMs });
      } else rejected++;
    }

    // FIFO worker pool: in-flight order is arrival order, so the first `capacity` requests hold a worker and
    // progress; the rest wait without progressing. Service time is bound when a request first gets a worker,
    // so it reflects the backend's speed at that moment, not at admission. If capacity drops below the number
    // already being served, the youngest of them pause (like a CPU stall) and resume when a worker frees up.
    const serving = Math.min(capacity, this.inflight.length);
    for (let i = 0; i < serving; i++) {
      const r = this.inflight[i];
      if (r.remainingMs == null) {
        r.servedAt = this.nowMs;
        r.remainingMs = serviceTimeMs * (0.7 + 0.6 * hashUnit(r.id));
      }
      r.remainingMs -= DT_MS;
    }

    this.nowMs += DT_MS;
    const latencies: number[] = [], waits: number[] = [], services: number[] = [];
    let good = 0, timedOut = 0;
    const remaining: Inflight[] = [];
    for (const r of this.inflight) {
      const finished = r.remainingMs != null && r.remainingMs <= 0;
      const latency = this.nowMs - r.arrivedAt;
      // A client that has waited clientTimeoutMs gives up; its request leaves the backend unfinished.
      if (!finished && latency < this.config.backend.clientTimeoutMs) { remaining.push(r); continue; }
      latencies.push(latency);
      if (latency <= this.config.backend.slaMs) good++; else timedOut++;
      // Only a request served to completion has a known service time; queue wait is the rest of its latency.
      const serviceMs = finished ? this.nowMs - r.servedAt! : null;
      if (serviceMs != null) { services.push(serviceMs); waits.push(latency - serviceMs); }
      ctrl.onComplete(latency, this.nowMs, serviceMs);
    }
    this.inflight = remaining;
    this.active = this.active.filter((a) => a.endsAt > this.nowMs);

    this.log.push({ offered: arrivals, admitted, rejected, good, timedOut, latencies, waits, services });
    if (this.log.length > LATENCY_WINDOW_TICKS) this.log.shift();
    return this.metrics(capacity, ctrl.currentLimit());
  }

  private metrics(capacity: number, limit: number | null): TickMetrics {
    const recent = this.log.slice(-RATE_WINDOW_TICKS);
    const secs = (recent.length * DT_MS) / 1000;
    const sum = (k: 'offered' | 'admitted' | 'rejected' | 'good' | 'timedOut') => recent.reduce((a, t) => a + t[k], 0);
    const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const offered = sum('offered'), good = sum('good');
    // Availability = good / (good + failed). Pending requests are not failures, but an in-flight request
    // already older than the SLA can no longer succeed, so it counts as failed before it completes.
    const lateInflight = this.inflight.filter((r) => this.nowMs - r.arrivedAt > this.config.backend.slaMs).length;
    const failed = sum('timedOut') + sum('rejected') + lateInflight;
    const lat = this.log.flatMap((t) => t.latencies).sort((a, b) => a - b);
    // A stalled backend completes nothing; the oldest in-flight age is a lower bound on its latency.
    const oldestAge = this.inflight.length ? this.nowMs - this.inflight[0].arrivedAt : 0;
    const mean = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : oldestAge;
    const completedP99 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.99))] : 0;
    const p99 = Math.max(completedP99, oldestAge);
    return {
      tMs: this.nowMs,
      offeredRps: offered / secs, admittedRps: sum('admitted') / secs, rejectedRps: sum('rejected') / secs,
      inflight: this.inflight.length, limit, capacity,
      meanLatencyMs: mean, p99LatencyMs: p99,
      meanWaitMs: meanOf(this.log.flatMap((t) => t.waits)), meanServiceMs: meanOf(this.log.flatMap((t) => t.services)),
      goodputRps: good / secs, timedOutRps: sum('timedOut') / secs,
      availability: good + failed > 0 ? good / (good + failed) : 1,
    };
  }
}
