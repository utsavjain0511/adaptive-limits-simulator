import { useMemo, useState } from 'react';
import { useLab, type LabSpec } from '../app/useLab';
import { LessonLayout } from '../components/LessonLayout';
import { ConcurrencyLimiter } from '../sim/controllers';
import { CAPACITY_DROP, CAPACITY_DROP_LABEL, CAPACITY_DROP_WORKERS, DEFAULT_BACKEND, RUN_A, RUN_B, SEED } from './defaults';

const CAPACITY = DEFAULT_BACKEND.capacity;
const DROPPED = CAPACITY_DROP_WORKERS;
const CONSERVATIVE = 25;
const droppedRps = Math.round((DROPPED * 1000) / DEFAULT_BACKEND.serviceTimeMs);

export function Lesson3() {
  const [limitA, setLimitA] = useState(CAPACITY);
  const spec = useMemo<LabSpec>(() => ({
    backend: DEFAULT_BACKEND, seed: SEED,
    load: { kind: 'sustained', baseRps: 300, peakRps: 300 },
    runs: [
      { label: `Static ${limitA}`, color: RUN_A, makeController: () => new ConcurrencyLimiter(limitA) },
      { label: `Static ${CONSERVATIVE}`, color: RUN_B, makeController: () => new ConcurrencyLimiter(CONSERVATIVE) },
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
      intro={`A concurrency limit protects the backend — but which number? Capacity is not constant: GC pauses, noisy neighbours, slow dependencies and deploys all move it. Press the event button and the backend temporarily drops from ${CAPACITY} worker slots to ${DROPPED}.`}
      watch={[
        `Before the drop, the limit tuned for normal capacity (${CAPACITY}) delivers ~250 rps while the conservative limit (${CONSERVATIVE}) leaves half the workers idle.`,
        `During the drop, limit ${CAPACITY} is ${Math.round(CAPACITY / DROPPED)}× too high: ${CAPACITY - DROPPED} admitted requests queue behind ${DROPPED} workers, every one of them waits past the SLA, and goodput collapses. Limit ${CONSERVATIVE} queues ${CONSERVATIVE - DROPPED} deep, stays under the SLA, and keeps ~${droppedRps} rps flowing.`,
        'Use the slider to hunt for a value that is right in both regimes — there isn\'t one. The right limit is a function of current capacity, which is exactly what the next lesson measures.',
      ]}
      events={[{ label: CAPACITY_DROP_LABEL, event: CAPACITY_DROP }]}
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
