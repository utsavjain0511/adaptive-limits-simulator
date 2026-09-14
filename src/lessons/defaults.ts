import type { BackendConfig, SimEvent } from '../sim/types';

export const DEFAULT_BACKEND: BackendConfig = { capacity: 50, serviceTimeMs: 200, overloadPenalty: 1.0, slaMs: 1000, clientTimeoutMs: 10000 };
export const RUN_A = '#d1495b';
export const RUN_B = '#2a9d8f';
export const GRAY = '#5b6069';
export const SLA_COLOR = '#1f2328';
export const SEED = 42;

export const CAPACITY_DROP: SimEvent = { kind: 'capacity', multiplier: 0.3, durationMs: 10_000 };
export const DOWNSTREAM_SLOWDOWN: SimEvent = { kind: 'serviceTime', multiplier: 3, durationMs: 10_000 };
