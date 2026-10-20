# Teach the AI to use the held Jump, for navigating and fighting, on any Arena

## Context

The held Jump (`fall.jumpBoost`) reaches about 4.3 m up and 4.2 m out (`docs/jump-reach.md`), and every Arena now has
lids and floors only a Jump gets to. The AI can't follow onto any of them: it only taps Jump (to leap into an Overhead
or hop back while disengaging), its `safeLanding` (`src/controllers/ai.ts`) assumes a tap's distance on level ground,
and the navmesh (`src/sim/nav.ts`) has walk Links and drop Links but none that go up or across a gap.

Goal: the AI uses Jumps through **one system that works on any Arena**, with no rules written per Arena and no
hand-placed data. Everything derives from the Walk Surfaces, Walls and `data/fall.json`, like the navmesh already does.

### Design in one paragraph
One pure function, `jumpArc`, predicts a Jump: from a takeoff point, heading and how many Ticks Jump is held, it
returns where and when the Fighter lands, on which Walk Surface, how far it drops and whether it ends somewhere deadly.
It is built from **the same code the Simulation runs** (the in-air step, head bump, wall push-out, landing), so it can't
drift from the real thing. The navmesh uses it to find **jump Links** (only jumps that still land on target when the
takeoff, hold and heading are a little off). The AI uses it to follow those Links, to pick how long to hold a jump Attack,
to check every Jump it makes, and to predict where an airborne opponent will come down.

### Constraints
- **Deterministic** (ADR 0001, ADR 0005): the AI runs on every peer. `jumpArc`, the navmesh and the AI's choices must be
  pure functions of Tuning Data, state and the AI's seeded generator, with ties broken by index. No `Math.random`, no
  wall clock, no iteration over unordered maps.
- **Fairness** (header of `ai.ts`): predicting an *opponent's* arc uses only what the AI sees (position, velocity, `y`,
  airborne or not, delayed by its Reaction Time), never their Intent or their `air.boost`. Assume they hold no more
  boost from what is seen: treat the rest of their flight as unboosted.
- Don't change `data/fall.json` or how a Jump behaves. Stage 1 must not change the outcome of any existing test.
- Follow `CONTEXT.md` vocabulary (Jump, Fall, Landing, Walk Surface, Wall, Link). Update `CONTEXT.md` (the Reaction Time
  and Walk Surface entries) and the "AI can't follow" lines in `docs/jump-reach.md` as behaviour lands.
- Each stage is its own commit (or a few), with `npm test` and `npx tsc --noEmit` (or the repo's lint/typecheck script)
  green. Build test-first (`tdd` skill).

---

## Stage 1 — `jumpArc`: one jump predictor, shared with the Simulation

**Where:** new `src/sim/jumpArc.ts` (exported from `src/sim/index.ts`); refactor in `src/sim/step.ts`.

- Pull the airborne part of a Fighter's Tick out of `step.ts` into exported pure helpers both callers use: `fly` (air
  steering, gravity, boost), `bumpHead`, the wall push-out a body gets in the air (find it in `collision.ts` /
  `pushOutOfWalls`), and the landing check in `settleGround` (feet reach `groundBelow`) plus the drop height from `land`
  (the `launchY` cap). Don't copy the code: move it and call it from both places.
- API (roughly):
  ```ts
  interface JumpPlan { at: Vec2; y: number; heading: Vec2 /* unit, walk direction */; holdTicks: number; speed?: number /* default walkSpeed */ }
  interface JumpResult {
    lands: { x: number; z: number; y: number } | null; // null: still airborne after MAX_TICKS, or off the Arena
    surface: number;          // index into arena.walk, -1 if none
    ticks: number;            // Ticks from takeoff to landing
    drop: number;             // height for fall damage, as `land` computes it
    damage: number;
    deadly: boolean;          // landed on Lava/Water, or a drop that would fell a Fighter at full HP
    path: { x: number; z: number; y: number }[]; // one point per Tick, for the AI's use and for debug drawing
  }
  function jumpArc(arena: ArenaGeometry, tuning: TuningData, plan: JumpPlan): JumpResult
  ```
  The Fighter takes off with horizontal velocity `heading × speed` (a Jump keeps its walk), keeps walking along `heading`
  in the air, holds `jumpHeld` for `holdTicks` (0 = a tap). Also export a variant that starts **mid-flight** from a seen
  position, velocity and `y` (for predicting opponents in Stage 5).
- **Tests** (`src/sim/jumpArc.test.ts`):
  - On a flat test Arena (see `arena()` in `src/sim/jumpReach.measure.test.ts`), for each hold in that file's table
    (0, 10, 15, 20, 25, 30 Ticks), `jumpArc` matches `runScript` exactly: landing Tick, landing position (within 1e-9)
    and apex.
  - It lands on a ledge exactly when the Simulation does (a few heights and distances from the reach table), and
    stops under a ceiling (`src/sim/ceiling.test.ts` fixtures), and is stopped by a Wall.
  - Every existing test still passes, unchanged.

## Stage 2 — Jump Links in the navmesh

**Where:** `src/sim/nav.ts`, `src/sim/nav.test.ts`.

- Extend `NavLink` with `kind: 'walk' | 'drop' | 'jump'` (`drop > 0` keeps meaning the same) and, for jump Links,
  `takeoff: Vec2`, `heading: Vec2`, `holdTicks: number`, `airTicks: number`.
- **Find candidates:** walk each edge of each non-deadly Walk Surface at `PROBE_STEP`. At each point, aim along the edge
  normal (and ±20°, so jumps onto something diagonal are found). A candidate is a target surface `j ≠ i` that isn't
  deadly, isn't already reachable from this point by a walk Link, and has ground within the reach envelope: at most
  `MAX_JUMP_UP` (derived: the apex of a full hold from `jumpArc` + `stepUp`, not a hard-coded 4.3) above, and within
  a full jump's level distance horizontally. Cover both kinds: **up** (lids, ledges) and **across** (gaps at the same
  or a lower height, such as the chamber's catwalks and the train's wagon gaps).
- **Check with `jumpArc`:** take off from `MARGIN` (the Fighter's radius + 0.1) inside the edge. Try holds
  `[0, 10, 15, 20, 25, 30]` and keep the **shortest** that lands on `j`. Then the **error check**: re-run with takeoff
  ±`JITTER_POS` (0.2 m, along and across the heading), hold ±1 Tick, heading ±5°. Keep the Link only if **every**
  variant lands on `j`, none is `deadly`, and none deals damage beyond `DROP_DAMAGE_LIMIT`. Constants go at the top of
  `nav.ts` with a doc comment each, like the existing ones.
- **Merge** neighbouring takeoff points that jump to the same target with the same hold into one Link (like drop runs),
  with its takeoff at the run's middle and a portal along the run so `corners` can still pull a path through it.
- **Cost** in `findPath`: the distance to the takeoff + `airTicks × TICK_SECONDS × walkSpeed` + `JUMP_COST` (about 1.5 m,
  a penalty so walking wins over jumping when both are close). Jump Links must be **excludable**: give `findPath` an
  option `{ maxJumpHold?: number; jumps?: boolean }` so the AI's difficulty can limit them (Stage 3).
- Keep building once per Arena and Tuning Data (it's cached). Measure build time for the biggest Arena in a test or a
  log, and keep it under about 200 ms. If it's slower: prune candidates by the reach envelope first, and cache
  `jumpArc` results per (takeoff, heading, hold).
- **Tests** (`nav.test.ts`, plus one generic test):
  - Synthetic Arenas: a floor with a 1 m block → a jump Link up, hold 0 or small; a 3.5 m block → a Link with a long
    hold; a 4.6 m block → none; two floors with a 3 m gap → a Link across both ways; a gap over Lava where only the
    exact best jump makes it → **no** Link (the error check rejects it); a block under a ceiling too low → none.
  - **Generic reach test** (new `src/sim/jumpLinks.test.ts`): a table of every spot in `docs/jump-reach.md` (Arena,
    from-surface point, lid point). For each, `findPath` from the floor point to a point on the lid uses a jump Link.
    This replaces the "the AI can't follow" note with a checked list. If a spot fails only the error check, write
    that down in the doc instead of loosening the check.
  - Determinism: building twice gives identical Links (deep equal), in the same order.

## Stage 3 — The AI follows jump Links

**Where:** `src/controllers/ai.ts` (`approach`, its route memory, `save`/`load`), `data/ai.json`, `src/tuning`
types for `AiDifficulty`, `src/controllers/ai.test.ts`.

- New difficulty field `jumpNav`: the longest hold (in Ticks) the AI may use on a jump Link; `-1` = no jump Links.
  Suggested: Easy `0` (taps only), Normal `20`, Hard `30`. Pass it to `findPath`. Without the field (the plain test AI),
  jump Links are off, so existing AI tests keep their behaviour.
- When the next Link on its route is a jump Link, `approach` runs a small state machine, kept in the AI's memory
  (it must survive `save`/`load` for Rollback and scrubbing):
  1. **Line up:** walk to `takeoff − heading × RUNUP` (about 0.6 m), then
  2. **Run in:** walk along `heading`; when within `REACHED` of `takeoff` (or past it along the heading), press `jump`,
  3. **Fly:** hold `jumpHeld` for `holdTicks`, keep `move = heading` until landed,
  4. **Done:** on landing, re-plan (the route is re-planned when the AI changes surface anyway). If it landed somewhere
     else, nothing special happens: it re-plans from there.
  - Give up and re-plan if it isn't airborne within `JUMP_PATIENCE` Ticks of starting the line-up (it got shoved, or an
    opponent stands on the takeoff). Make sure re-planning can't ping-pong: if the same Link failed within the last
    second, leave it out of the next `findPath`.
  - While it carries out a jump Link it doesn't start Attacks (but still Blocks if threatened on the ground), so the
    press isn't swallowed by an Action that can't jump.
- **Tests** (`ai.test.ts`, with the Simulation and real Arenas): a Normal AI on the summit plateau with an idle enemy on
  the containers lid ends up on the lid within N seconds; on the chamber, an AI on the ring reaches an enemy on a
  catwalk; an Easy AI doesn't use a held jump Link; the same seed gives the same Ticks (determinism); `save`/`load`
  mid-run-up gives identical Intents afterwards.

## Stage 4 — Every Jump the AI makes is checked, and jump Attacks pick their hold

**Where:** `ai.ts` (`safeLanding`, the jump Attack and the Disengage hop-back), `data/ai.json`.

- Replace `safeLanding` with `jumpArc` plus the same error check as Stage 2 (a shared helper exported from
  `nav.ts` or `jumpArc.ts`, so both agree): a Jump is safe if every variant lands somewhere not deadly with no fall
  damage.
- **Jump Attack:** instead of a fixed `JUMP_FROM`/`JUMP_TO` band at tap height, pick the shortest hold (from the list
  the difficulty allows) whose arc brings it within its reach of where the target will be (target position + seen
  velocity × flight time) at its Release. This also covers jumping **down** onto an enemy on lower ground. The
  Overhead and `swingIn` logic stay as they are. Keep `jumpAttackRate` as the chance.
- **Tests:** the existing jump Attack tests still pass. A new one: from a raised ledge, a Hard AI jump-Attacks an enemy
  below. The AI never jumps off the ship's rail or the train's nose (run it near those edges for a few hundred Ticks
  with jumpy settings and assert it never dies by Water or Fall).

## Stage 5 — Combat: punishing landings, and escaping by jumping

**Where:** `ai.ts`, `data/ai.json`, `CONTEXT.md` (the Reaction Time entry lists the repertoire).

- **Punishing landings** (`landingPunish`; Easy 0, Normal 0.3, Hard 0.7, rolled once per opponent Jump): when the
  target is seen airborne, predict its landing with the mid-flight `jumpArc` from what is seen (unboosted from here on).
  If the landing is within reach of a spot it can get to before then, walk to stand `myReach − 0.1` from the landing
  point, facing it, and start an Attack timed so its Release lands on the landing Tick (use `attackTimings`, as the
  Chamber timing does). The landing is an opening like a hard Landing.
- **Escaping by jumping** (`jumpEscapeRate`; Easy 0, Normal 0.1, Hard 0.25): in Disengage, when the AI is close to a jump
  Link whose target is a different Walk Surface from its opponent's, and the takeoff is on the far side from them,
  take it (through the Stage 3 state machine). Anyone following has to jump after it, and `landingPunish` takes over.
- **Fighting up/down a level:** today it only fights on the same level (`LEVEL`). Leave that rule as it is. Jump Links
  get it onto their level, and landing punishes cover an enemy jumping down onto it.
- **Tests:** a Hard AI facing a scripted opponent that jumps toward it lands a hit within a few Ticks of the landing
  far more often than a Normal one over the same seeds (or deterministically on a chosen seed); an AI in Disengage
  next to a lid jumps onto it; Easy does neither.

## Stage 6 — Debug view and docs

- In the `?dev=1` collider view (`src/render/colliderView.ts`), draw jump Links as arcs (the `path` from `jumpArc`),
  coloured by hold length, so a level designer sees where the AI can jump. A toggle next to "Show Colliders" or as part
  of it.
- Update `docs/jump-reach.md` (the AI can now follow; list any spot it still can't, and why), `CONTEXT.md` (Walk
  Surface: "jump Links"; Reaction Time: the new parts of the repertoire), and the `ai.ts` header comment.
- If a decision here is worth recording (for example "jump Links are derived from simulated arcs with an error
  check, not hand-placed"), add an ADR in `docs/adr/`.

## Done when
- Every held-Jump spot in `docs/jump-reach.md` has a jump Link and a Normal/Hard AI follows a player onto it, on every
  Arena, with no code mentioning an Arena by name.
- No AI dies by jumping, in the Stage 4 soak test.
- `npm test` green, deterministic replays unchanged except where the AI now jumps.
