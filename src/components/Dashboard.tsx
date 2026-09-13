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
            <div key={r.label} className="stat">
              <span className="dot" style={{ background: r.color }} />
              <span className="stat-name">{r.label}</span>
              <span className="fig"><b>{m ? pct(m.availability) : '–'}</b> available</span>
              <span className="fig"><b>{m ? `${Math.round(m.goodputRps).toLocaleString()} rps` : '–'}</b> goodput</span>
              <span className="fig"><b>{m ? `${Math.round(m.p99LatencyMs).toLocaleString()} ms` : '–'}</b> p99</span>
            </div>
          );
        })}
      </div>
      <div className="charts">
        <RollingChart title="Requests / sec" unit=" rps" series={[
          { label: 'offered', color: GRAY, data: pick(base, (m) => m.offeredRps) },
          ...runs.map((r) => ({ label: `${r.label} admitted`, color: r.color, data: pick(r.history, (m) => m.admittedRps) })),
        ]} />
        <RollingChart title="Concurrency (in-flight)" unit="" yCap={maxCapacity * 4} series={[
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
