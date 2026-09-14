import type { BackendConfig, SimEvent } from './types';

// The backend and events the lessons run against. They live in the sim layer so the scenario tests can
// use exactly what the lessons use without importing upward.
export const DEFAULT_BACKEND: BackendConfig = { capacity: 50, serviceTimeMs: 200, slaMs: 1000, clientTimeoutMs: 10_000 };

export const CAPACITY_DROP: SimEvent = { kind: 'capacity', multiplier: 0.16, durationMs: 10_000 };
export const DOWNSTREAM_SLOWDOWN: SimEvent = { kind: 'serviceTime', multiplier: 3, durationMs: 10_000 };

export const CAPACITY_DROP_WORKERS = Math.round(DEFAULT_BACKEND.capacity * CAPACITY_DROP.multiplier);
