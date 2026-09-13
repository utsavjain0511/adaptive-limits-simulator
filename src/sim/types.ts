export interface BackendConfig {
  capacity: number;        // concurrent requests served at nominal speed
  serviceTimeMs: number;   // nominal per-request service time
  overloadPenalty: number; // extra slowdown per unit of oversubscription (thrashing)
  slaMs: number;           // client deadline; slower completions count as failures
}

export type LoadKind = 'ramp' | 'spike' | 'sustained' | 'oscillating';
export interface LoadPattern { kind: LoadKind; baseRps: number; peakRps: number; }

export interface SimEvent { kind: 'capacity' | 'serviceTime'; multiplier: number; durationMs: number; }

export interface AdmissionController {
  readonly name: string;
  shouldAdmit(inflight: number, nowMs: number): boolean;
  onComplete(latencyMs: number, nowMs: number): void;
  onTick(nowMs: number, dtMs: number): void;
  currentLimit(): number | null;
}

export interface TickMetrics {
  tMs: number;
  offeredRps: number; admittedRps: number; rejectedRps: number;
  inflight: number; limit: number | null; capacity: number;
  meanLatencyMs: number; p99LatencyMs: number;
  goodputRps: number; timedOutRps: number; availability: number; // 0..1
}
