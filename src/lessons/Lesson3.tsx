import { useMemo, useState } from 'react';
import { useLab, type LabSpec } from '../app/useLab';
import { LessonLayout } from '../components/LessonLayout';
import { ConcurrencyLimiter } from '../sim/controllers';
import { CAPACITY_DROP, DEFAULT_BACKEND, RUN_A, RUN_B, SEED } from './defaults';

export function Lesson3() {
  const [limitA, setLimitA] = useState(50);
  const spec = useMemo<LabSpec>(() => ({
    backend: DEFAULT_BACKEND, seed: SEED,
    load: { kind: 'sustained', baseRps: 300, peakRps: 300 },
    runs: [
      { label: `Static ${limitA}`, color: RUN_A, makeController: () => new ConcurrencyLimiter(limitA) },
      { label: 'Static 25', color: RUN_B, makeController: () => new ConcurrencyLimiter(25) },
    ],
  }), [limitA]);
  const lab = useLab(spec);
  const onLimit = (v: number) => {
    setLimitA(v);
    lab.setController(0, new ConcurrencyLimiter(v));
  };
  return (
    <LessonLayout spec={spec} lab={lab}
      title="The trouble with static limits"
      intro="A concurrency limit protects the backend — but which number? Capacity is not constant: GC pauses, noisy neighbours, slow dependencies and deploys all move it. Press the event button and the backend temporarily loses 70% of its capacity."
      watch={[
        'Before the drop, the limit tuned for normal capacity (50) delivers ~250 rps while the conservative limit (25) leaves half the capacity idle.',
        'During the drop, limit 50 is 3× too high: latency blows past the SLA and goodput collapses. Limit 25 survives.',
        'Use the slider to hunt for a value that is right in both regimes — there isn\'t one. The right limit is a function of current capacity, which is exactly what the next lesson measures.',
      ]}
      events={[{ label: 'Capacity drop (×0.3, 10 s)', event: CAPACITY_DROP }]}
    >
      <div className="panel knobs">
        <label>
          Red run static limit: {limitA}
          <input type="range" min={10} max={100} step={5} value={limitA} onChange={(e) => onLimit(Number(e.target.value))} />
        </label>
      </div>
    </LessonLayout>
  );
}
