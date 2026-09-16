import { LESSONS } from './index';

export function Introduction({ onStart }: { onStart(): void }) {
  return (
    <section className="introduction">
      <h1>Adaptive Limits Lab</h1>
      <p>
        The Adaptive Limits Lab is an interactive experience that shows how a software service reacts under high load
        and how to maintain availability. It consists of four lessons, each building on the previous one. In each
        lesson, a single backend runs under identical traffic conditions, with two admission policies displayed side
        by side so that you can observe the impact of each technique. The lab begins with basic load shedding and
        progresses to adaptive concurrency limits, a method outlined by Netflix in its{' '}
        <a href="https://netflixtechblog.medium.com/performance-under-load-3e6fa9a60581" target="_blank" rel="noreferrer">
          Performance Under Load
        </a>{' '}
        post. Any software engineer can use this lab to understand these concepts, observe each technique's real-time
        behavior, and adjust settings to see how tuning affects results.
      </p>
      <ol className="outline">
        {LESSONS.map((l) => <li key={l.title}>{l.title}</li>)}
      </ol>
      <button className="primary" onClick={onStart}>Start lesson 1</button>
    </section>
  );
}
