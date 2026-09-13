import type { LoadKind, LoadPattern, SimEvent } from '../sim/types';

export interface EventButton { label: string; event: SimEvent; }
interface Props {
  running: boolean; speed: number; load: LoadPattern; events: EventButton[];
  onStart(): void; onPause(): void; onReset(): void; onSpeed(s: number): void; onLoad(p: LoadPattern): void; onEvent(e: SimEvent): void;
}
const KINDS: { value: LoadKind; label: string }[] = [
  { value: 'ramp', label: 'Ramp up' },
  { value: 'sustained', label: 'Sustained' },
  { value: 'spike', label: 'Spike' },
  { value: 'oscillating', label: 'Oscillating' },
];

export function ControlBar({ running, speed, load, events, onStart, onPause, onReset, onSpeed, onLoad, onEvent }: Props) {
  return (
    <div className="panel controls">
      {running ? <button onClick={onPause}>Pause</button> : <button className="primary" onClick={onStart}>Start</button>}
      <button onClick={onReset}>Reset</button>
      <label>speed
        <select value={speed} onChange={(e) => onSpeed(Number(e.target.value))}>
          {[1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </label>
      <label>load
        <select value={load.kind} onChange={(e) => onLoad({ ...load, kind: e.target.value as LoadKind })}>
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </label>
      <label>peak {load.peakRps} rps
        <input type="range" min={50} max={800} step={10} value={load.peakRps} onChange={(e) => onLoad({ ...load, peakRps: Number(e.target.value) })} />
      </label>
      {events.map((ev) => <button key={ev.label} className="event" onClick={() => onEvent(ev.event)}>{ev.label}</button>)}
    </div>
  );
}
