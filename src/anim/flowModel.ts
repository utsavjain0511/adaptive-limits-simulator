export interface LaneMetrics { offeredRps: number; admittedRps: number; meanLatencyMs: number; slaMs: number; }
export type Stage = 'toShaper' | 'rejected' | 'toBackend' | 'inBackend' | 'exiting';
export interface Particle { lane: number; stage: Stage; t: number; jx: number; jy: number; good: boolean; dwellMs: number; }
export interface LaneStats { spawned: number; admitted: number; rejected: number; }
export interface FlowState { particles: Particle[]; spawnAcc: number[]; stats: LaneStats[]; }

export const DOTS_PER_RPS = 1 / 25;
export const MAX_DOTS_PER_SEC = 40;
export const MAX_PARTICLES_PER_LANE = 150;
export const STAGE_MS = { toShaper: 600, rejected: 500, toBackend: 500, exiting: 400 } as const;
const MIN_DWELL_MS = 150, MAX_DWELL_MS = 3000;

export function createFlow(lanes: number): FlowState {
  return {
    particles: [],
    spawnAcc: Array.from({ length: lanes }, () => 0),
    stats: Array.from({ length: lanes }, () => ({ spawned: 0, admitted: 0, rejected: 0 })),
  };
}

export function stepFlow(state: FlowState, lanes: LaneMetrics[], dtMs: number, rand: () => number): void {
  const live = lanes.map(() => 0);
  for (const p of state.particles) live[p.lane]++;

  lanes.forEach((m, i) => {
    const rate = Math.min(MAX_DOTS_PER_SEC, m.offeredRps * DOTS_PER_RPS);
    state.spawnAcc[i] += (rate * dtMs) / 1000;
    while (state.spawnAcc[i] >= 1) {
      state.spawnAcc[i] -= 1;
      if (live[i] >= MAX_PARTICLES_PER_LANE) continue;
      live[i]++;
      state.stats[i].spawned++;
      state.particles.push({ lane: i, stage: 'toShaper', t: 0, jx: rand(), jy: rand(), good: true, dwellMs: 0 });
    }
  });

  const next: Particle[] = [];
  for (const p of state.particles) {
    const m = lanes[p.lane];
    const duration = p.stage === 'inBackend' ? p.dwellMs : STAGE_MS[p.stage];
    p.t += dtMs / duration;
    if (p.t < 1) { next.push(p); continue; }
    p.t = 0;
    switch (p.stage) {
      case 'toShaper': {
        const pAdmit = m.offeredRps > 0 ? Math.min(1, m.admittedRps / m.offeredRps) : 1;
        if (rand() < pAdmit) { p.stage = 'toBackend'; state.stats[p.lane].admitted++; }
        else { p.stage = 'rejected'; state.stats[p.lane].rejected++; }
        next.push(p);
        break;
      }
      case 'toBackend':
        p.stage = 'inBackend';
        p.dwellMs = Math.min(MAX_DWELL_MS, Math.max(MIN_DWELL_MS, m.meanLatencyMs));
        next.push(p);
        break;
      case 'inBackend':
        p.stage = 'exiting';
        p.good = m.meanLatencyMs <= m.slaMs;
        next.push(p);
        break;
      default:
        break; // rejected and exiting particles are culled once finished
    }
  }
  state.particles = next;
}
