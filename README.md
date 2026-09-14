# Adaptive Limits Lab

An interactive, progressive lab on keeping a service available under overload. Four lessons, each a
side-by-side real-time simulation of one backend under identical load with two admission-control policies:

1. **Load shedding** — no shedding drives availability to 0; shedding stabilises goodput near capacity.
2. **RPS vs concurrency limits** — an RPS limit can't see latency; a concurrency limit protects the resource.
3. **Static limits** — capacity moves, so no fixed number is right in every regime.
4. **Adaptive limits** — AIMD and Gradient limiters track capacity; tune them and watch stability vs responsiveness.

Live: <VERCEL_URL>

## Run locally

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # simulation + scenario tests (vitest)
npm run build    # static build in dist/
```

## How the simulation works

Discrete 20 ms ticks. Arrivals are Poisson from a seeded RNG (identical for both runs). The backend serves
`capacity` requests at nominal speed; beyond that, requests share the budget and pay a thrashing penalty, so
latency and throughput both degrade. Completions slower than the client deadline (1 s) count as failures even
though the server did the work, and a client that has waited 10 s gives up and abandons its request. The only
thing that differs between the two runs is the admission controller.

- `src/sim/engine.ts` — tick loop, arrivals, backend physics, metrics
- `src/sim/controllers.ts` — `NoLimit`, `ConcurrencyLimiter`, `RpsLimiter`
- `src/sim/adaptive.ts` — `AimdLimiter`, `GradientLimiter`, presets
- `src/sim/*.test.ts` — unit tests plus scenario tests that assert each lesson's expected outcome
- `src/app/useLab.ts` — runs the A/B simulations in lockstep with a 60 s rolling history
- `src/anim/flowModel.ts` — particle model for the request-flow animation (dots ∝ rps, admitted/rejected split, dwell = latency)
- `src/components/` — flow animation, canvas charts, dashboard, controls, sidebar
- `src/lessons/` — one file per lesson: config, controllers, event buttons, copy

See `docs/RATIONALE.md` for design decisions and trade-offs.
