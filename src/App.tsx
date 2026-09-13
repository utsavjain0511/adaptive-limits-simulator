import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { LESSONS } from './lessons';

export default function App() {
  const [index, setIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const { Component } = LESSONS[index];
  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}`}>
      <Sidebar
        titles={LESSONS.map((l) => l.title)} index={index} collapsed={collapsed}
        onChange={setIndex} onToggle={() => setCollapsed((c) => !c)}
      />
      <Component key={index} />
    </div>
  );
}
