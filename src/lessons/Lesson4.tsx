import { useMemo, useState } from 'react';
import { useLab, type LabSpec } from '../app/useLab';
import { LessonLayout } from '../components/LessonLayout';
import { ConcurrencyLimiter } from '../sim/controllers';
import {
  AimdLimiter, GradientLimiter, AIMD_PRESETS, GRADIENT_PRESETS,
  type AimdConfig, type GradientConfig, type PresetName,
} from '../sim/adaptive';
import { CAPACITY_DROP, DEFAULT_BACKEND, RUN_A, RUN_B, SEED } from './defaults';
import type { AdmissionController } from '../sim/types';

type Algo = 'aimd' | 'gradient';
const PRESETS: PresetName[] = ['stable', 'aggressive', 'sluggish'];

function make(algo: Algo, aimd: AimdConfig, grad: GradientConfig): AdmissionController {
  return algo === 'aimd' ? new AimdLimiter(aimd) : new GradientLimiter(grad);
}

export function Lesson4() {
  const [algo, setAlgo] = useState<Algo>('aimd');
  const [aimd, setAimd] = useState<AimdConfig>(AIMD_PRESETS.stable);
  const [grad, setGrad] = useState<GradientConfig>(GRADIENT_PRESETS.stable);
  const spec = useMemo<LabSpec>(() => ({
    backend: DEFAULT_BACKEND, seed: SEED,
    load: { kind: 'sustained', baseRps: 300, peakRps: 300 },
    runs: [
      { label: 'Static 50', color: RUN_A, makeController: () => new ConcurrencyLimiter(50) },
      { label: algo === 'aimd' ? 'AIMD' : 'Gradient', color: RUN_B, makeController: () => make(algo, aimd, grad) },
    ],
  }), [algo, aimd, grad]);
  const lab = useLab(spec);

  const apply = (nextAlgo: Algo, nextAimd: AimdConfig, nextGrad: GradientConfig) => {
    setAlgo(nextAlgo); setAimd(nextAimd); setGrad(nextGrad);
    lab.setController(1, make(nextAlgo, nextAimd, nextGrad));
  };
  const preset = (p: PresetName) => apply(algo, AIMD_PRESETS[p], GRADIENT_PRESETS[p]);
  const knob = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void) => (
    <label key={label}>
      {label}: {value}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
    </label>
  );

  return (
    <LessonLayout spec={spec} lab={lab}
      title="Adaptive concurrency limits"
      intro="Instead of guessing a limit, measure it. Both algorithms watch request latency: when it rises above the no-load baseline the backend is queueing, so the limit shrinks; when latency is healthy the limit probes upward. Same capacity drop as before."
      watch={[
        'AIMD (TCP-style): +step per healthy window, ×backoff when latency exceeds threshold × baseline. Simple and robust; it always probes above capacity until latency says stop, so it draws a saw-tooth.',
        'Gradient (Netflix concurrency-limits style): limit ← limit × (tolerance × baseline / latency) + headroom, smoothed. Proportional, smoother, tunable.',
        'Presets: Stable tracks the drop and recovers in seconds. Aggressive over-reacts and oscillates. Sluggish reacts late and takes a long time to grow back. Move the sliders to feel the stability-vs-responsiveness trade-off.',
      ]}
      events={[{ label: 'Capacity drop (50 → 8 slots, 10 s)', event: CAPACITY_DROP }]}
    >
      <div className="panel">
        <div className="presets">
          <label><input type="radio" checked={algo === 'aimd'} onChange={() => apply('aimd', aimd, grad)} /> AIMD</label>
          <label><input type="radio" checked={algo === 'gradient'} onChange={() => apply('gradient', aimd, grad)} /> Gradient</label>
          <span style={{ marginLeft: 12 }}>presets:</span>
          {PRESETS.map((p) => <button key={p} onClick={() => preset(p)}>{p}</button>)}
        </div>
        <div className="knobs">
          {algo === 'aimd' ? (
            <>
              {knob('latency threshold (× baseline)', aimd.latencyThresholdFactor, 1.1, 4, 0.1, (v) => apply(algo, { ...aimd, latencyThresholdFactor: v }, grad))}
              {knob('increase step', aimd.increaseStep, 1, 20, 1, (v) => apply(algo, { ...aimd, increaseStep: v }, grad))}
              {knob('backoff ratio', aimd.backoffRatio, 0.3, 0.95, 0.05, (v) => apply(algo, { ...aimd, backoffRatio: v }, grad))}
            </>
          ) : (
            <>
              {knob('tolerance', grad.tolerance, 1, 3, 0.05, (v) => apply(algo, aimd, { ...grad, tolerance: v }))}
              {knob('smoothing', grad.smoothing, 0.05, 1, 0.05, (v) => apply(algo, aimd, { ...grad, smoothing: v }))}
              {knob('headroom', grad.headroom, 0, 30, 1, (v) => apply(algo, aimd, { ...grad, headroom: v }))}
            </>
          )}
          {knob('min limit', aimd.minLimit, 1, 50, 1, (v) => apply(algo, { ...aimd, minLimit: v }, { ...grad, minLimit: v }))}
          {knob('max limit', aimd.maxLimit, 50, 400, 10, (v) => apply(algo, { ...aimd, maxLimit: v }, { ...grad, maxLimit: v }))}
        </div>
      </div>
    </LessonLayout>
  );
}
