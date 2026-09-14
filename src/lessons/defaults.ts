import { CAPACITY_DROP, CAPACITY_DROP_WORKERS, DEFAULT_BACKEND, DOWNSTREAM_SLOWDOWN } from '../sim/scenario';

export { CAPACITY_DROP, CAPACITY_DROP_WORKERS, DEFAULT_BACKEND, DOWNSTREAM_SLOWDOWN };

export const RUN_A = '#d1495b';
export const RUN_B = '#2a9d8f';
export const GRAY = '#5b6069';
export const SLA_COLOR = '#1f2328';
export const SEED = 42;

export const CAPACITY_DROP_LABEL = `Capacity drop (${DEFAULT_BACKEND.capacity} → ${CAPACITY_DROP_WORKERS} slots, ${CAPACITY_DROP.durationMs / 1000} s)`;
export const DOWNSTREAM_SLOWDOWN_LABEL = `Downstream slowdown (${DOWNSTREAM_SLOWDOWN.multiplier}× latency, ${DOWNSTREAM_SLOWDOWN.durationMs / 1000} s)`;
