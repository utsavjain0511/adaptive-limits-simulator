interface Props { titles: string[]; index: number; onChange(i: number): void; }

export function Stepper({ titles, index, onChange }: Props) {
  return (
    <nav className="stepper">
      {titles.map((t, i) => (
        <button key={t} className={i === index ? 'active' : ''} onClick={() => onChange(i)}>{i + 1}. {t}</button>
      ))}
      <span className="nav">
        <button disabled={index === 0} onClick={() => onChange(index - 1)}>← Prev</button>
        <button disabled={index === titles.length - 1} onClick={() => onChange(index + 1)}>Next →</button>
      </span>
    </nav>
  );
}
