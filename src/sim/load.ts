import type { LoadPattern } from './types';

export function offeredRps(p: LoadPattern, tMs: number): number {
  const t = tMs / 1000;
  switch (p.kind) {
    case 'sustained': return p.peakRps;
    case 'ramp': return t >= 20 ? p.peakRps : p.baseRps + (p.peakRps - p.baseRps) * (t / 20);
    case 'spike': return t >= 10 && t < 25 ? p.peakRps : p.baseRps;
    case 'oscillating': {
      const mid = (p.baseRps + p.peakRps) / 2, amp = (p.peakRps - p.baseRps) / 2;
      return mid + amp * Math.sin((2 * Math.PI * t) / 20);
    }
  }
}
