import { useCallback, useEffect, useRef, useState } from 'react';
import { Simulation, DT_MS } from '../sim/engine';
import { WINDOW_POINTS } from '../components/RollingChart';
import type { AdmissionController, BackendConfig, LoadPattern, SimEvent, TickMetrics } from '../sim/types';

export interface RunSpec { label: string; color: string; makeController: () => AdmissionController; }
export interface LabSpec { backend: BackendConfig; load: LoadPattern; runs: RunSpec[]; seed?: number; }
export interface Lab {
  histories: TickMetrics[][]; running: boolean; speed: number; load: LoadPattern;
  start(): void; pause(): void; reset(): void; setSpeed(s: number): void; setLoad(p: LoadPattern): void;
  triggerEvent(e: SimEvent): void; setController(runIndex: number, c: AdmissionController): void;
}

const STEPS_PER_SAMPLE = 100 / DT_MS; // one history point per 100ms of simulated time

export function useLab(spec: LabSpec): Lab {
  const specRef = useRef(spec);
  specRef.current = spec;
  const simsRef = useRef<Simulation[]>([]);
  const loadRef = useRef(spec.load);
  const [load, setLoadState] = useState(spec.load);
  const [histories, setHistories] = useState<TickMetrics[][]>(() => spec.runs.map(() => []));
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);

  const ensureSims = useCallback(() => {
    if (simsRef.current.length === 0) {
      const s = specRef.current;
      simsRef.current = s.runs.map((r) => new Simulation({ backend: s.backend, load: loadRef.current, controller: r.makeController(), seed: s.seed ?? 42 }));
    }
    return simsRef.current;
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const sims = ensureSims();
      const points = sims.map(() => [] as TickMetrics[]);
      for (let k = 0; k < speed; k++) {
        sims.forEach((sim, i) => {
          let m!: TickMetrics;
          for (let s = 0; s < STEPS_PER_SAMPLE; s++) m = sim.step();
          points[i].push(m);
        });
      }
      setHistories((prev) => prev.map((h, i) => {
        const next = h.concat(points[i]);
        return next.length > WINDOW_POINTS ? next.slice(next.length - WINDOW_POINTS) : next;
      }));
    }, 100);
    return () => clearInterval(id);
  }, [running, speed, ensureSims]);

  const reset = useCallback(() => {
    setRunning(false);
    simsRef.current = [];
    setHistories(specRef.current.runs.map(() => []));
  }, []);
  const setLoad = useCallback((p: LoadPattern) => {
    loadRef.current = p;
    setLoadState(p);
    simsRef.current.forEach((s) => s.setLoad(p));
  }, []);
  const triggerEvent = useCallback((e: SimEvent) => {
    ensureSims().forEach((s) => s.triggerEvent(e));
    setRunning(true);
  }, [ensureSims]);
  const setController = useCallback((i: number, c: AdmissionController) => { simsRef.current[i]?.setController(c); }, []);

  return {
    histories, running, speed, load,
    start: () => setRunning(true), pause: () => setRunning(false),
    reset, setSpeed, setLoad, triggerEvent, setController,
  };
}
