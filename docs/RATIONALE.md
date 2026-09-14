# Design rationale — Adaptive Limits Lab

> Skeleton pre-filled with the decisions made during the build. Edit freely; the "Time spent" line is yours to fill in.

## Why this theme and approach
- Themes 1 + 3: overload behaviour is *emergent* — a queue that looks fine at 90% load falls off a cliff at 110% — and that is badly served by static explanation. A live A/B simulation lets a reader see the cliff, then see each mitigation move it.
- Scoped to one backend and one variable (the admission-control policy) so every lesson isolates exactly one idea and the four lessons build on each other: shed → limit the right resource → static limits can't track capacity → measure capacity instead.

## What makes it interesting / non-obvious
- **Same arrivals, same seed, two policies.** Both runs draw arrivals from the same seeded RNG and per-request jitter is derived from the request id, so any difference between the red and teal lines is causal, not noise.
- **The failure mode is the real one.** The backend model includes a thrashing penalty (throughput *collapses* past capacity, it doesn't plateau) and a client deadline (work completed after the client gave up counts as failure). That reproduces the production symptom — a server at 100% CPU with 0% goodput — rather than a tidy textbook queue.
- **Lesson 2 is a Little's-law argument made visible.** Both limiters are tuned to the same 200 rps; only latency changes. The RPS limiter can't see the resource it is supposed to protect.
- **Lesson 3 → 4 argues *why* adaptive limiters exist** (capacity is not a constant) before showing them. AIMD and Gradient are the real algorithm families behind Netflix `concurrency-limits`, gRPC and Envoy adaptive concurrency.
- **The tuning knobs teach the control-theory trade-off.** Presets are deliberately named for their failure modes: Aggressive oscillates, Sluggish reacts late and recovers slowly.

## Key design decisions and trade-offs
- **Tick-based model (20 ms) over discrete-event simulation.** Cheaper to build, deterministic, and its fidelity is sufficient for the lessons; the cost is 20 ms latency quantisation.
- **Clients abandon requests after `clientTimeoutMs` (10 s by default).** Without it the no-limit run's in-flight list grows forever under overload, so a long-running tab gets slower every tick and eventually runs out of memory. A client timeout bounds in-flight at offered rate × timeout (Little's law) inside the engine, deterministically, rather than pausing the UI after some wall-clock interval. It is also what a real meltdown looks like: latency pins at the timeout, goodput stays at zero. Abandoned requests are reported to the controller as completions at the timeout latency, which is the signal a real adaptive limiter gets from a timed-out call. A hard in-flight cap was rejected because dropping arrivals is itself an admission policy and would muddy "no limit".
- **p99 reports the age of the oldest in-flight request when nothing completes.** A fully stalled backend completes nothing in the sampling window, so a naive p99 would read 0 — the opposite of the truth. Found via a failing test.
- **Baseline latency = min of the last 30 window averages** (bounded memory) rather than a long EMA as in Netflix Gradient2: a long overload cannot drag the baseline up and hide congestion.
- **Gradient "Aggressive" preset headroom was cut from 20 to 12.** With `gradient` clamped at 0.5, `headroom` creates a floor of `2 × headroom` on the limit; at 20 the limiter could not shrink below 40 during a capacity drop to 15 and delivered zero goodput. A real pitfall of the algorithm, surfaced by a scratch trajectory run.
- **Custom canvas charts, no chart library.** 10 Hz updates across eight series, threshold lines, and clipped-but-labelled out-of-range values were simpler to own than to coerce out of a library. The categorical palette was checked with a CVD/contrast validator; the neutral reference lines were darkened after it flagged gray↔teal separation.
- **Identical A/B stretches are drawn as two-colour dashes, not one line.** Because both runs are deterministic and identical until demand exceeds capacity, the last-drawn (teal) line hid the red one entirely and the chart looked like only one run existed. Where a later series exactly matches an earlier one, the hidden colour is re-drawn as short dashes on top of that stretch; the lines separate on their own once the runs diverge. Rejected alternatives: a vertical offset (misrepresents the data) and a thinner top line (a halo that reads as a rendering artefact).
- **The flow animation is driven by the same metrics as the charts, not by individual simulated requests.** Dots spawn at `offered / 25` per second, are admitted with probability `admitted / offered`, and dwell in the backend for the mean latency (capped at 3 s, 150 dots per lane) — a stalled backend visibly fills up while its rejected neighbour streams through. Same-seed fairness is preserved because the animation only *reads* the runs. Mean latency needed the same "oldest in-flight age" fallback as p99: a stalled backend reported 0 ms and the dots flew straight through.
- **Layout: sidebar | simulation | notes.** The animation is the one bold element; charts are a flat grid with hairline gutters and stats are inline figures, so nothing competes with it. Lesson copy and knobs live in the right column so tuning reads as part of the lesson.
- **Scenario tests double as the tuning harness.** Each lesson's expected picture (e.g. "static 50 collapses during the drop, AIMD keeps goodput > 30 rps and recovers above 40") is a Vitest assertion, so the presets cannot silently drift.
- **Cut:** hover crosshair/tooltips on the charts (the live legend values cover the streaming use case), client retries, dark mode.

## How I'd extend it
- Client retries and retry budgets — the retry storm that turns a brown-out into an outage.
- Per-request cost classes and priority-aware shedding (drop cheap/low-priority work first).
- A dependency chain (two backends) to show how a concurrency limit at the caller protects the callee.
- Vegas- and CoDel-style limiters using queue delay rather than total latency as the signal.
- Shareable scenario URLs and record/replay.

## Time spent
- ~N hours (fill in). Built with Claude Code; the session transcript is submitted alongside.
