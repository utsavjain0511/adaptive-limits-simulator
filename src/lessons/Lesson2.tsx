import { useLab, type LabSpec } from '../app/useLab';
import { LessonLayout } from '../components/LessonLayout';
import { ConcurrencyLimiter, RpsLimiter } from '../sim/controllers';
import { DEFAULT_BACKEND, DOWNSTREAM_SLOWDOWN, DOWNSTREAM_SLOWDOWN_LABEL, RUN_A, RUN_B, SEED } from './defaults';

const SPEC: LabSpec = {
  backend: DEFAULT_BACKEND, seed: SEED,
  load: { kind: 'sustained', baseRps: 300, peakRps: 300 },
  runs: [
    { label: 'RPS limit 200', color: RUN_A, makeController: () => new RpsLimiter(200) },
    { label: 'Concurrency limit 40', color: RUN_B, makeController: () => new ConcurrencyLimiter(40) },
  ],
};

export function Lesson2() {
  const lab = useLab(SPEC);
  return (
    <LessonLayout spec={SPEC} lab={lab}
      title="RPS limits vs. concurrency limits"
      intro="Both limiters are tuned for the same healthy throughput (200 rps ≈ 40 in-flight × 200 ms, by Little's law). Offered load is 300 rps. Press the event button: a downstream dependency slows down and every request takes 3× longer."
      watch={[
        'The RPS limiter keeps admitting 200 rps because rate is all it can see. Each request now holds a worker 3× longer, so 200 rps needs 120 workers but there are 50: the queue grows without bound, latency crosses the SLA and goodput collapses — and it takes a long time to drain after the slowdown ends.',
        'The concurrency limiter caps in-flight at 40. Admitted rate drops automatically to ~67 rps, latency stays ~600 ms (under SLA), goodput stays positive, and recovery is instant.',
        'Concurrency is the resource you are actually protecting; RPS is only a proxy that assumes latency never changes.',
      ]}
      events={[{ label: DOWNSTREAM_SLOWDOWN_LABEL, event: DOWNSTREAM_SLOWDOWN }]}
    />
  );
}
