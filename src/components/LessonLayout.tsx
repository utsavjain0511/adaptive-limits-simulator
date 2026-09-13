import type { ReactNode } from 'react';
import { ControlBar, type EventButton } from './ControlBar';
import { Dashboard } from './Dashboard';
import type { Lab, LabSpec } from '../app/useLab';

interface Props { title: string; intro: string; watch: string[]; spec: LabSpec; lab: Lab; events?: EventButton[]; children?: ReactNode; }

export function LessonLayout({ title, intro, watch, spec, lab, events = [], children }: Props) {
  return (
    <section className="lesson">
      <h2>{title}</h2>
      <p className="intro">{intro}</p>
      <ul className="watch">{watch.map((w) => <li key={w}>{w}</li>)}</ul>
      {children}
      <ControlBar
        running={lab.running} speed={lab.speed} load={lab.load} events={events}
        onStart={lab.start} onPause={lab.pause} onReset={lab.reset}
        onSpeed={lab.setSpeed} onLoad={lab.setLoad} onEvent={lab.triggerEvent}
      />
      <Dashboard slaMs={spec.backend.slaMs} runs={spec.runs.map((r, i) => ({ label: r.label, color: r.color, history: lab.histories[i] }))} />
    </section>
  );
}
