import { useLab, type LabSpec } from '../app/useLab';
import { LessonLayout } from '../components/LessonLayout';
import { NoLimit, ConcurrencyLimiter } from '../sim/controllers';
import { DEFAULT_BACKEND, RUN_A, RUN_B, SEED } from './defaults';

const SPEC: LabSpec = {
  backend: DEFAULT_BACKEND, seed: SEED,
  load: { kind: 'ramp', baseRps: 50, peakRps: 600 },
  runs: [
    { label: 'No shedding', color: RUN_A, makeController: () => new NoLimit() },
    { label: 'Shedding (max 60)', color: RUN_B, makeController: () => new ConcurrencyLimiter(60) },
  ],
};

export function Lesson1() {
  const lab = useLab(SPEC);
  return (
    <LessonLayout spec={SPEC} lab={lab}
      title="Load shedding: fail fast or fail everyone"
      intro="One backend can serve about 250 requests/sec (50 concurrent × 200 ms). Both runs get the identical ramp from 50 to 600 rps. The red run accepts every request; the teal run rejects instantly once 60 requests are in flight."
      watch={[
        'Without shedding, in-flight climbs without bound, every request waits behind the backlog, p99 blows past the 1 s client deadline, and goodput falls to zero — the server is 100% busy doing work nobody is waiting for.',
        'With shedding, rejected requests fail in microseconds, in-flight stays pinned at 60, latency stays under the SLA, and goodput holds near capacity.',
        'Press Reset and try a smaller ramp (peak 200 rps): both runs are identical until demand exceeds capacity.',
      ]}
    />
  );
}
