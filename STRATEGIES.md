# Strategy Log

This file tracks the Team strategies we experimented with, plus rough results (avg survival across multiple seeds; 120s cap). The test harness lives in `test.mjs` and `search.mjs`.

1. Greedy Single Defender (baseline)
   - Pick the current vacancy; send the closest seated defender if they beat the Mouse.
   - Avg ≈ 5–7s.

2. Lookahead Relay (depth-2)
   - Choose first defender D for vacancy; evaluate second defender E to D.origin; require margins.
   - Avg ≈ 5–6s.

3. Ring-Order Relay
   - Order chairs by angle; always defend from predecessor to enforce rotation.
   - Avg ≈ 4–6s.

4. Planning (depth-N)
   - Simulate several seat swaps and choose D maximizing projected survival.
   - Avg ≈ 5–6s.

5. Chain Dispatch (MAX_CHAIN)
   - When idle, dispatch a short chain (defender to vacancy; next to previous seat, etc.).
   - Tends to shorten survival without strict guards.

6. Chain + Guards (no-closer, margins)
   - Require margins on first hops; forbid new vacancy much closer to Mouse.
   - Avg typically ≈ 1–3s with current geometry.

7. Cordon Mode (v1)
   - When Mouse is within R of vacancy, dispatch K defenders to surround vacancy by occupying K nearest seats to that chair, plus the vacancy itself.
   - Configurable via `tuning.cordonR`, `tuning.cordonK`.
   - In progress; see `simulation.mjs`.

Next candidates:
- Persistent Cordon (reserve K seats for a hold duration, reassign as needed).
- Geometry-aware no-closer on every hop & guard seats.
- Speed/geometry co-tuning (N, r, teamSpeed/mouseSpeed ratios). 