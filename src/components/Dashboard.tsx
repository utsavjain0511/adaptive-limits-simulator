import { RollingChart } from './RollingChart';
import { GRAY, SLA_COLOR } from '../lessons/defaults';
import type { TickMetrics } from '../sim/types';

export interface RunView { label: string; color: string; history: TickMetrics[]; }
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function Dashboard({ runs, slaMs }: { runs: RunView[]; slaMs: number }) {
  const base = runs[0].history;
  const pick = (h: TickMetrics[], f: (m: TickMetrics) => number | null) => h.map(f);
  const maxCapacity = base.reduce((a, m) => Math.max(a, m.capacity), 1);
  return (
    <div className="dashboard">
      <div className="stats">
        {runs.map((r) => {
          const m = r.history[r.history.length - 1];
          return (
            <div key={r.label} className="stat" style={{ borderLeftColor: r.color }}>
              <div className="stat-label">{r.label}</div>
              <div className="stat-row"><span>availability</span><b>{m ? pct(m.availability) : '–'}</b></div>
              <div className="stat-row"><span>goodput</span><b>{m ? `${Math.round(m.goodputRps)} rps` : '–'}</b></div>
              <div className="stat-row"><span>p99 latency</span><b>{m ? `${Math.round(m.p99LatencyMs)} ms` : '–'}</b></div>
            </div>
          );
        })}
      </div>
      <div className="charts">
        <RollingChart title="Requests / sec" unit=" rps" series={[
          { label: 'offered', color: GRAY, data: pick(base, (m) => m.offeredRps) },
          ...runs.map((r) => ({ label: `${r.label} admitted`, color: r.color, data: pick(r.history, (m) => m.admittedRps) })),
        ]} />
        <RollingChart title="Concurrency (in-flight)" unit="" yMax={maxCapacity * 4} series={[
          { label: 'capacity', color: GRAY, dashed: true, data: pick(base, (m) => m.capacity) },
          ...runs.flatMap((r) => [
            { label: `${r.label} in-flight`, color: r.color, data: pick(r.history, (m) => m.inflight) },
            { label: `${r.label} limit`, color: r.color, dashed: true, data: pick(r.history, (m) => m.limit) },
          ]),
        ]} />
        <RollingChart title="Latency (p99)" unit=" ms" yMax={slaMs * 4}
          thresholds={[{ value: slaMs, label: 'SLA', color: SLA_COLOR }]}
          series={runs.map((r) => ({ label: r.label, color: r.color, data: pick(r.history, (m) => m.p99LatencyMs) }))} />
        <RollingChart title="Goodput (successful / sec)" unit=" rps"
          series={runs.map((r) => ({ label: r.label, color: r.color, data: pick(r.history, (m) => m.goodputRps) }))} />
      </div>
    </div>
  );
}
