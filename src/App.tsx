import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Introduction } from './lessons/Introduction';
import { LESSONS } from './lessons';

// index 0 is the introduction; lessons follow at 1..LESSONS.length.
export default function App() {
  const [index, setIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const lesson = LESSONS[index - 1];
  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}${lesson ? '' : ' intro'}`}>
      <Sidebar
        titles={['Introduction', ...LESSONS.map((l) => l.title)]} index={index} collapsed={collapsed}
        onChange={setIndex} onToggle={() => setCollapsed((c) => !c)}
      />
      {lesson ? <lesson.Component key={index} /> : <Introduction onStart={() => setIndex(1)} />}
    </div>
  );
}
