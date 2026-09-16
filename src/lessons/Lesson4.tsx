import { useMemo, useState } from 'react';
import { useLab, type LabSpec } from '../app/useLab';
import { LessonLayout } from '../components/LessonLayout';
import { ConcurrencyLimiter } from '../sim/controllers';
import {
  AimdLimiter, GradientLimiter, AIMD_PRESETS, GRADIENT_PRESETS,
  type AimdConfig, type GradientConfig, type PresetName,
} from '../sim/adaptive';
import { CAPACITY_DROP, CAPACITY_DROP_LABEL, DEFAULT_BACKEND, RUN_A, RUN_B, SEED } from './defaults';
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
  // A preset is "selected" while the active algorithm's config still equals it; moving any slider deselects.
  const activePreset = PRESETS.find((p) => (algo === 'aimd' ? aimd === AIMD_PRESETS[p] : grad === GRADIENT_PRESETS[p]));
  const knob = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void) => (
    <label key={label}>
      {label}: {value}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
    </label>
  );

  return (
    <LessonLayout spec={spec} lab={lab}
      title="Adaptive concurrency limits"
      intro={<>
        <p>Instead of guessing a limit, measure it. Three insights make that possible:</p>
        <ul>
          <li><b>Little's law.</b> In steady state, <code>concurrency = average latency × average RPS</code>. The relation holds until in-flight requests reach the service's concurrency limit and queueing begins.</li>
          <li><b>Measuring load with latency.</b> When concurrency spikes beyond the limit, latency spikes too, because requests wait for a worker. Latency in excess of the backend's own processing time is the queue.</li>
          <li><b>Feedback-based concurrency limits.</b> Using the latency gradient or the window's average latency as a feedback signal, the limiter adjusts the admitted concurrency to the capacity it can measure. Same capacity drop as before.</li>
        </ul>
      </>}
      watch={[
        <><b>AIMD</b> — additive increase, multiplicative decrease, the same idea as TCP congestion control. Each window: if the average latency is above <code>threshold × baseline</code>, <code>limit = limit × backoff</code>; otherwise <code>limit = limit + step</code>. It always probes above capacity until latency says stop, so it draws a saw-tooth. Simple and robust.</>,
        <><b>Gradient</b> — the crux of Netflix's algorithm is the latency gradient, <code>gradient = clamp(tolerance × baselineLatency / windowAvgLatency, 0.5, 1)</code>, and the update step:
          <pre>{'target = oldThreshold × gradient + headroom\nconcurrencyThreshold = clamp(oldThreshold × (1 − smoothing) + target × smoothing, minLimit, maxLimit)'}</pre>
          Gradient adjusts the limit gradually based on how much requests slow down. AIMD raises it by a fixed amount, then cuts it by a fixed percentage when requests slow down, creating an up-and-down pattern.
        </>,
        <><b>Presets</b> — move the sliders to feel the stability-vs-responsiveness trade-off.
          <ul>
            <li><b>Stable</b> tracks the drop and recovers in seconds.</li>
            <li><b>Aggressive</b> over-reacts: AIMD swings between a handful and ~70 in flight; Gradient over-shrinks and parks at its floor.</li>
            <li><b>Sluggish</b> reacts late and takes a long time to grow back.</li>
          </ul>
        </>,
      ]}
      events={[{ label: CAPACITY_DROP_LABEL, event: CAPACITY_DROP }]}
    >
      <div className="panel">
        <div className="presets">
          <label><input type="radio" checked={algo === 'aimd'} onChange={() => apply('aimd', aimd, grad)} /> AIMD</label>
          <label><input type="radio" checked={algo === 'gradient'} onChange={() => apply('gradient', aimd, grad)} /> Gradient</label>
          <span style={{ marginLeft: 12 }}>presets:</span>
          {PRESETS.map((p) => (
            <button key={p} className={p === activePreset ? 'active' : ''} aria-pressed={p === activePreset} onClick={() => preset(p)}>{p}</button>
          ))}
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
