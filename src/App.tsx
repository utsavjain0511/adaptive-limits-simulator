import { useState } from 'react';
import { Stepper } from './components/Stepper';
import { LESSONS } from './lessons';

export default function App() {
  const [index, setIndex] = useState(0);
  const { Component } = LESSONS[index];
  return (
    <main className="app">
      <h1>Adaptive Limits Lab</h1>
      <p className="intro">
        A progressive lab on keeping a service available under overload: load shedding → concurrency vs. RPS limits → why static limits fail → adaptive limiters.
      </p>
      <Stepper titles={LESSONS.map((l) => l.title)} index={index} onChange={setIndex} />
      <Component key={index} />
    </main>
  );
}
