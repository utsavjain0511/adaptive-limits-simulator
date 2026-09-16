interface Props { titles: string[]; index: number; collapsed: boolean; onChange(i: number): void; onToggle(): void; }

export function Sidebar({ titles, index, collapsed, onChange, onToggle }: Props) {
  return (
    <nav className="sidebar" aria-label="Lessons">
      <div className="brand">{collapsed ? 'AL' : 'Adaptive Limits Lab'}</div>
      <ol className="lessons">
        {titles.map((t, i) => (
          <li key={t}>
            <button className={i === index ? 'active' : ''} onClick={() => onChange(i)} title={t} aria-current={i === index ? 'page' : undefined}>
              <span className="num">{i + 1}</span>
              <span className="name">{t}</span>
            </button>
          </li>
        ))}
      </ol>
      <a className="transcripts" href="/transcripts/" title="Build transcripts">
        <span className="num">✎</span>
        <span className="name">Build transcripts</span>
      </a>
      <button className="collapse" onClick={onToggle} aria-label={collapsed ? 'Expand lesson list' : 'Collapse lesson list'}>
        {collapsed ? '›' : '‹'}
      </button>
    </nav>
  );
}
