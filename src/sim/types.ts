export interface BackendConfig {
  capacity: number;        // worker slots; requests beyond this wait in a FIFO queue
  serviceTimeMs: number;   // nominal per-request service time (each request varies ×0.7–1.3)
  slaMs: number;           // client deadline; slower completions count as failures
  clientTimeoutMs: number; // client gives up and abandons the request; bounds in-flight under overload
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
