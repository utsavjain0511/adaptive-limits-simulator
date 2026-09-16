import type { ReactNode } from 'react';
import { ControlBar, type EventButton } from './ControlBar';
import { Dashboard } from './Dashboard';
import { FlowCanvas } from './FlowCanvas';
import type { Lab, LabSpec } from '../app/useLab';

interface Props { title: string; intro: ReactNode; watch: ReactNode[]; spec: LabSpec; lab: Lab; events?: EventButton[]; children?: ReactNode; }

export function LessonLayout({ title, intro, watch, spec, lab, events = [], children }: Props) {
  const runs = spec.runs.map((r, i) => ({ label: r.label, color: r.color, history: lab.histories[i] }));
  return (
    <>
      <section className="main">
        <ControlBar
          running={lab.running} speed={lab.speed} load={lab.load} events={events}
          onStart={lab.start} onPause={lab.pause} onReset={lab.reset}
          onSpeed={lab.setSpeed} onLoad={lab.setLoad} onEvent={lab.triggerEvent}
        />
        <FlowCanvas
          running={lab.running} slaMs={spec.backend.slaMs}
          lanes={runs.map((r) => ({ label: r.label, color: r.color, latest: r.history[r.history.length - 1] }))}
        />
        <Dashboard slaMs={spec.backend.slaMs} runs={runs} />
      </section>
      <aside className="notes">
        <h2>{title}</h2>
        <div className="intro">{intro}</div>
        <h3>What to watch</h3>
        <ul>{watch.map((w, i) => <li key={i}>{w}</li>)}</ul>
        {children && <><h3>Try it</h3>{children}</>}
      </aside>
    </>
  );
}
