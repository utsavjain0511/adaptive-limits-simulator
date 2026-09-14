# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev                                  # Vite dev server on http://localhost:5173
npm test                                     # vitest run (all tests)
npx vitest run src/sim/adaptive.test.ts      # one file
npx vitest run -t "capacity drop"            # tests whose name matches
npm run lint                                 # oxlint (config in .oxlintrc.json)
npm run build                                # tsc -b && vite build — this is the type check; there is no separate tsc script
```

Before claiming a change works, run `npm run lint`, `npm run build`, and `npm test`. `noUnusedLocals` and
`noUnusedParameters` are on, so an unused import fails the build. There is no Prettier; match the style of the
surrounding file (single quotes, semicolons, compact one-line object literals and interfaces).

## Architecture

The app is an A/B lab: one simulated backend, identical load, two admission-control policies, rendered side by
side. Three layers, dependencies flow downward only:

1. **`src/sim/`** — pure TypeScript, no React, fully deterministic. `Simulation` in `engine.ts` advances in
   20 ms ticks (`DT_MS`): Poisson arrivals from a seeded `mulberry32` RNG, each request asks the
   `AdmissionController` (`types.ts`) whether it is admitted, in-flight requests share the backend's budget
   and pay a thrashing penalty past `capacity`, and completions slower than `slaMs` count as failures.
   `controllers.ts` holds the static policies (`NoLimit`, `ConcurrencyLimiter`, `RpsLimiter`);
   `adaptive.ts` holds `AimdLimiter` and `GradientLimiter` plus their `stable`/`aggressive`/`sluggish`
   presets. `SimEvent`s (capacity drop, downstream slowdown) temporarily scale the backend.
2. **`src/app/useLab.ts`** — the runner. Takes a `LabSpec` (backend, load, N `RunSpec`s, seed), creates one
   `Simulation` per run with the *same* seed, steps them in lockstep on a 100 ms interval, and keeps a rolling
   history of `TickMetrics` per run (one point per 100 ms simulated, `WINDOW_POINTS` long).
3. **`src/lessons/` + `src/components/`** — each `LessonN.tsx` is a `LabSpec`, optional event buttons/knobs,
   and copy, handed to `LessonLayout`. `LESSONS` in `lessons/index.ts` is the ordered list the sidebar
   renders. `RollingChart` and `FlowCanvas` are hand-written canvas components; the flow animation
   (`src/anim/flowModel.ts`) is driven from `TickMetrics`, not from individual simulated requests.

### Invariants to preserve

- **Determinism is the whole argument.** Both runs must see identical arrivals, so nothing under `src/sim/`
  may call `Math.random`, `Date.now`, or read anything outside its inputs. Per-request jitter comes from
  `hashUnit(id)`, not the shared RNG, so admitting or rejecting a request does not perturb later arrivals.
- **Controllers only see the interface.** A new policy implements `AdmissionController` and nothing else;
  the engine must not special-case a controller.
- **Latency metrics fall back to the oldest in-flight age** when nothing completes in the window (a stalled
  backend would otherwise report 0 ms). Keep that behaviour if you touch `metrics()` or the flow model.
- **Scenario tests are the tuning harness.** Describe blocks named `lesson N scenario: ...` (today only lesson 4 in `adaptive.test.ts`) assert a lesson's expected
  picture (e.g. AIMD keeps goodput above a floor during a capacity drop where static 50 does not). If a
  change to backend defaults, presets, or the engine makes one fail, the fix is usually the tuning, not the
  assertion; if you do change an assertion, say so in the PR. New lessons should get one too.
- Knob changes re-instantiate the limiter rather than mutating it live; the visible jump is intentional.

`README.md` lists the module map for readers and `docs/RATIONALE.md` records design decisions and
trade-offs. When you make a non-obvious trade-off, add a bullet to RATIONALE rather than a long code comment.

## Workflow: one task, one branch, one PR

- Never commit to `main` and never merge. The user reviews and merges every PR. Do not run `gh pr merge`,
  do not push to `main`, and do not enable auto-merge.
- Each composable task gets its own branch off up-to-date `main`, named `<type>/<short-kebab-summary>`
  (e.g. `feat/retry-budget-lesson`, `fix/p99-stall-fallback`). If a request contains several independent
  changes, split it into several PRs and say which order they should merge in.
- Commit messages use the conventional prefixes already in the history: `feat(sim):`, `feat(ui):`,
  `fix(app):`, `test(sim):`, `docs:`, `chore:`. Scope is the top-level `src/` directory touched.
- Before opening a PR: lint, build, and tests must pass locally; paste the commands you ran into the
  Testing section. Then run the `/code-review` skill on the branch's changes and fix what it flags before
  pushing; re-run lint, build, and tests if a fix touched code. Open the PR with `gh pr create` and fill the
  body from `.github/pull_request_template.md` (Summary, Motivation, Testing). Every section is required; if
  there was no test to run, say why.
- After opening the PR, stop and report the URL. Do not start the next task on the same branch. PRs are
  authored by the user's own GitHub account, so GitHub will not show an Approve button; the merge itself is
  the approval. Branches are deleted on merge; after a merge, `git checkout main && git pull` before branching.

If a repo-specific convention is not covered here, ask rather than assume.
