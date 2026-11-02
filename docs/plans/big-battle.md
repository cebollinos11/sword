# Big Battle: 200 v 200 on an open field, with the duel's combat where the Players are

> Status: planned (2026-11-02), not started. Decisions below came from an interview, one question at a time. Milestone 1 (Stages 0 to 5) is offline with one Player; Milestone 2 (Stages 6 and 7) is online with up to four. Each Stage ends with a `### Result` written by whoever builds it (what was done, what changed from the plan, test counts), as in `docs/plans/dungeon.md`. Next: Stage 0.

## Context
Every Match today is a Duel: at most four Fighters a Team (`MAX_TEAM_SIZE`), each a full Fighter with a Skeleton, Pose-Key IK, a Blade Sweep and an AI Controller run on every peer, all in a 60 Hz deterministic Simulation that rolls back up to 15 Ticks (ADR 0001, 0005, 0010). We want a Mount & Blade–style battle: 200 soldiers a side, up to four human Players, the rest AI. The Players get the full combat against whoever is near them, while the rest of the battle is a cheap simulation drawn as impostor sprites. A Player can fight some soldiers, break away, move and engage others, and soldiers convert between low and high detail as they come near or move away.

400 full Fighters cannot fit: a 15-Tick Rollback would be about 6,000 Fighter-Ticks of IK and AI in one frame. So the design has **two Simulation tiers** (the Crowd and full Fighters) and a deterministic rule for crossing between them.

## Decisions
- **The Crowd is simulated, not cosmetic.** Every soldier that is not a full Fighter is a **Soldier** in `SimState`: plain data (position, heading, HP, Team, target, a few timers), stepped by the Simulation, hashed, snapshotted and rolled back like everything else. Every peer sees the same battle, and its outcome counts. Only the Players' Intents cross the wire, as before (ADR 0001).
- **The Crowd steps at a low rate, staggered.** A Soldier updates every 6th Tick (10 Hz), with 1/6 of them on each Tick, so the cost per Tick is even. The renderer interpolates between a Soldier's updates. Steering uses a per-Team flow field over the open field plus separation from neighbours (spatial hash grid). No navmesh A* for the Crowd.
- **Soldiers fight Soldiers abstractly.** Two adjacent enemy Soldiers engage, and each Crowd step rolls damage from the Simulation's seeded generator, in the same HP units as a Fighter. The fights are slow and noisy, so equal armies are roughly a coin flip without Players.
- **Only full Fighters can hit full Fighters.** A Soldier never damages a Player's Fighter, and a full Fighter never fights a Soldier. Anything that fights a Player has a Skeleton, a Blade Sweep and Blocks. The duel's combat stays physical and blockable, everywhere it touches a human.
- **The Bubble: Soldiers near a Player become full Fighters.** Each human Player's Fighter has a **Bubble**, decided from Simulation positions, never from the camera, so every peer promotes alike. A Soldier inside it may be **promoted**: it takes a free slot of the **Fighter Pool**, a fixed-size array of full Fighters in `SimState`, starting at guard with the Soldier's position, heading, Team and HP. A full Fighter is **demoted** back to a Soldier (writing its position and HP back) when it leaves the Bubble. Distances have hysteresis: promote at ~10 m, demote beyond ~16 m. A Fighter is demoted only when its Action allows it (Idle or walking, never mid-Attack, Stagger, Knockdown or Fall), and not within ~1 s of its promotion.
- **The Fighter Pool is fixed-size.** The Players' Fighters hold permanent slots. The other slots are bound to Soldiers as they promote, so the snapshot's shape never changes. Size is set by profiling (Stage 0), with a starting guess of about 24.
- **Attack slots cap the pressure on a Player.** Each Bubble promotes at most ~4 enemies (the **Attack Slots**) and ~3 allies. Enemy Soldiers in the Bubble beyond the slots stay Soldiers and hold back in a ring outside sword reach, waiting. When a slot frees (a death, a demotion), the nearest waiting enemy promotes. The AI's existing teamwork (flanking, taking turns, spreading out) works within the slots.
- **Allies in the Bubble promote too**, from the budget's ally share, choosing the allies nearest the slot-holding enemies. Promoted allies fight promoted enemies with real combat and pull enemies off the Player. A full enemy whose target is a Soldier ally either waits, or that ally is promoted if the budget allows.
- **No free disengage.** A promoted enemy keeps chasing, and the Bubble moves with the Player. A Player breaks away with Kicks, Knockdowns, kills and allies who take the enemy's attention, not by walking away.
- **The waiting ring closes in front of a Player** (settled 2026-11-02). Soldiers are not solid to full Fighters in Milestone 1, so waiting enemies steer to stand in the Player's way: a waiting Soldier's ring spot is biased toward the Player's direction of travel, and Soldiers within a short distance of a full Fighter steer away from its path rather than letting it overlap them. This is steering only, never collision, so it costs nothing in the full Fighters' Simulation. Walking into a crowd of enemies pushes into a wall of them, which promote as slots free up. Real body-blocking stays Later.
- **Promoted soldiers are Beginner AI.** Elites (marked Skilled/Expert captains) were wanted but are deferred past Milestone 1.
- **All 400 on the field at once.** There is no field cap and there are no reinforcement waves.
- **A Team routs below ~20% strength** (Tuning Data), and the other Team wins. No hunt for the last stragglers. The losing side's Soldiers turn and flee toward their edge for a few seconds before the result screen.
- **A Player who dies takes over an ally Soldier.** It becomes that soldier: the generic soldier's Body and Weapon, and the Soldier's current HP. The Soldier promotes into the Player's permanent slot. The nearest living ally is chosen. A Player is out when its Team has no Soldiers left. This is the Controller model (the Local Controller now drives another Fighter) and is close to an AI Takeover in reverse.
- **No orders in Milestone 1.** The armies charge, and the Crowd picks targets. The Crowd's goal is one field per Team (later per squad), so Charge, Hold, Follow me and Form line can be added later without rework.
- **The battlefield is an open field with gentle terrain**, about 200 × 200 m. It is a deterministic heightfield (a function of the Match seed, ADR 0006), with no walls or ledges. Jump Links, falls and the Abyss stay out of this mode. Ground height is a cheap lookup for Soldiers and full Fighters alike.
- **One generic soldier per Team**, a fixed Body and Weapon with a team colour. The Players keep their chosen Body and Weapon until they die.
- **Two render tiers: the full model and an impostor.** Full Fighters are drawn as today. Soldiers are drawn as impostors: one instanced billboard draw per Team from a sprite atlas (8 directions × idle, walk, swing, hit, die). The atlas is baked in-engine from the generic soldier's own Body and Motions, so it matches what the soldier does when promoted. The swap happens at the promotion distance (~10 m), hidden by a short dithered crossfade and a dust puff.
- **The performance target is 60 fps on a mid-range laptop** (recent integrated GPU). Budgets: the Crowd step about 1 ms per Tick, the Fighter Pool as profiled, and about 2 draws per Team for the Crowd. This also leaves headroom for Rollback when online.
- **A minimap is in Milestone 1**: a top-down view of both armies and the Player, render only, so a Player can choose where to engage.
- **Players tip a fair fight.** The armies are equal, and a good Player's kills and rescues decide close battles.

## Glossary (proposed, for `CONTEXT.md` with the code that makes it true)
- **Battle**: the Format of this mode, a Match of two armies of Soldiers on an open Battlefield, ending in a Rout. _Avoid_: war, siege, skirmish (the Lobby's offline mode).
- **Soldier**: a member of an army that is not a full Fighter right now: plain data in the Crowd, fighting other Soldiers by rule and drawn as an impostor. _Avoid_: unit, NPC, Fighter (for a Soldier).
- **Crowd**: all of a Battle's Soldiers and the low-rate step that moves and fights them. _Avoid_: horde, mob.
- **Bubble**: the region around a Player's Fighter where Soldiers promote to full Fighters. _Avoid_: LOD zone, radius.
- **Promotion / Demotion**: a Soldier becoming a full Fighter in a Fighter Pool slot, and back. A Simulation step, rolled back like any other. _Avoid_: spawn, despawn, LOD switch.
- **Fighter Pool**: the fixed set of full Fighter slots in a Battle's `SimState`. _Avoid_: active list.
- **Attack Slot**: one of the few places in a Bubble an enemy may fill to fight its Player. The others wait as Soldiers. _Avoid_: token, ticket.
- **Rout**: a Team breaking when its strength falls below the threshold, which ends the Battle.

## How it fits the existing code
- **`SimState` gains a Crowd**: Soldiers in flat arrays (struct-of-arrays) so a snapshot is a few typed-array copies (400 × ~12 numbers). It must stay plain, hashable data.
- **`fighters[]` becomes the Fighter Pool for a Battle.** `MAX_TEAM_SIZE` (4) and the Lineup assume a Duel's sizes, so a Battle needs its own Pool size, and every system that iterates `fighters` must tolerate unbound slots (a slot with no Soldier is out of play, not dead).
- **Promotion and Demotion are Simulation steps** at the start of a Tick. They are decided from positions, which follow from Intents, so they roll back and resync without new messages (the Dungeon's "choices by walking" rule, ADR 0019).
- **AI Controllers attach to a slot, not a Soldier.** A promoted slot gets a fresh Beginner AI memory, loaded at its Promotion Tick (as an AI Takeover is), so every peer's AI decides alike. A demoted slot drops its memory.
- **The AI must ignore Soldiers.** It sees, targets and blocks only full Fighters. Two new AI behaviours: hold back at the ring while waiting for an Attack Slot, and chase without giving up.
- **The Battlefield is a new Arena kind** beside the Generated Arenas (ADR 0014): a heightfield and no Kit, with `groundBelow` reading the heightfield. Full Fighters keep their collision against each other.
- **The renderer gains two systems**: an instanced impostor layer (atlas, team tint, crossfade with `fighterView` on Promotion), and the minimap.

## Working rules for every Stage
- **Determinism first** (ADR 0001): nothing in the Crowd, the Bubble or the Fighter Pool may read `Math.random()`, wall-clock time or render state. Every new piece of `SimState` is plain data, in `hashValue`, and survives snapshot and restore. Every Stage that adds Simulation state adds a test that a replay of the same Intents gives the same hash every Tick, and one that a Rollback across the new event re-simulates to the same state.
- **Duels do not change.** Every existing test passes at the end of every Stage, and no Duel or Dungeon number moves. The Battle's code sits behind its Format; shared code (the AI, `fighters[]` iteration, the renderer) only gains tolerance for what a Battle needs.
- **Tuning Data** for the mode lives in `data/battle.json` (parsed in `src/tuning/`), inside `tuningDataHash`. No magic numbers in code for anything this plan marks "~".
- **Vocabulary**: the Glossary above. `CONTEXT.md` changes in the same Stage as the code that makes a term true.
- **Checks before a Stage is done**: `npm run typecheck`, `npm test`, `npm run build`, and the Stage's "Check in `npm run dev`" list.
- **Stop at the end of each Stage** and write its `### Result`. The next Stage starts in a new context from this file.

## Stage 0: profile, then fix the budgets
Nothing here ships to players. It is a bench that answers how big the Fighter Pool, the Attack Slots and the Crowd rate can be on the target laptop.
- **A bench page** in the Editor (beside the sandbox, e.g. `#/editor/bench`), dev only. Its three scenes each run for a fixed time and report the mean and 99th-percentile ms per Tick or per frame:
  - **Fighters**: N full AI Fighters (8, 16, 24, 32, 40) in a melee on a flat Arena, stepping `stepMatch` with their AI Controllers. `MAX_TEAM_SIZE` is 4: the bench may build the state directly, or lift the limit for the bench only. Find out which is smaller and note it for Stage 3. Also measure the cost of a 15-Tick Rollback at each N (snapshot, restore, 15 re-simulated Ticks, AI `save()`/`load()`).
  - **Crowd**: a throwaway prototype of the Stage 1 Crowd step (struct-of-arrays, spatial hash, separation, steering toward the enemy, fake fights) for 400 Soldiers at 10 Hz staggered, plus the cost of `hashValue` and a snapshot copy of that data.
  - **Render**: 400 instanced billboards (placeholder texture) plus N skinned Body models, with the third-person camera in the middle of the crowd.
- **Run it** on whatever hardware is at hand, and write down the machine. If that isn't a mid-range laptop, note the gap and scale the budgets with a stated margin.
- **Output**: the `### Result` of this Stage has a table of the numbers and **fixes** the starting values for Stage 1 to 4: Pool size, enemy and ally slots per Bubble, the Crowd rate and stagger, and the Bubble distances if the numbers argue for a change. If 24 full Fighters don't fit in ~8 ms per Tick of Simulation with headroom for Rollback, say so: the design shrinks the Bubble's budgets, not the target.
- **Tests**: none required beyond the bench running without errors. The prototype Crowd code may be thrown away or kept as Stage 1's start.

## Stage 1: the Battlefield and the Crowd in the Simulation
A Battle with no Players fighting: two armies meet, fight by rule and one routs. Only debug rendering.
- **`data/battle.json`**: army size (200), Battlefield size and terrain parameters, Crowd rate and stagger, Soldier walk speed, HP, damage range and engage reach, separation radius, flow-field cell size, Rout threshold and rout duration. Its parser and its place in `tuningDataHash`.
- **The Battlefield**: a new Arena kind built from its name alone (e.g. `battle:<seed>`) as a deterministic heightfield of gentle hills, about 200 × 200 m, with no Walls, no Kit, no Jump Links and no Abyss. `groundBelow` and whatever the Fighters' movement uses read the heightfield. Each Team's spawn area is on opposite edges.
- **The Crowd in `SimState`**: Soldiers as struct-of-arrays (position, heading, velocity, HP, Team, target index, engage timer, alive, rout flag), stepped inside `stepMatch` for the Battle Format: each Tick updates the Soldiers whose index matches the Tick modulo the stagger.
  - **Steering**: a per-Team flow field on a coarse grid toward the enemy army (recomputed at a low rate, e.g. once a second, itself staggered), plus separation from neighbours through a spatial hash, plus arrival at the nearest enemy Soldier within sight.
  - **Fighting**: an enemy within engage reach becomes the target; each Crowd step rolls damage from the seeded generator; at 0 HP a Soldier dies and stops counting.
  - **Rout**: when a Team's living Soldiers fall below the threshold, its Soldiers flee toward their own edge, and the Battle ends with the other Team's win after the rout duration.
- **The Battle Format**: `MatchState` knows it is a Battle, how it ends and who won. In this Stage the Players' Fighter can be absent (an AI-vs-AI war) or present and ignored by the Crowd.
- **Debug view**: the Editor (or a dev flag in Skirmish) draws Soldiers as coloured dots or boxes on the Battlefield, with a free camera, so the war can be watched.
- **ADR 0020: a Battle simulates its armies in two tiers** (the Crowd and the Fighter Pool, Soldiers never damage Fighters, Promotion decided from positions). Written in this Stage, Accepted when Stage 3 lands.
- **`CONTEXT.md`**: Battle, Soldier, Crowd, Rout.
- **Tests**:
  - Same seed and Intents give an equal `hashValue` every Tick; snapshot and restore mid-battle continue identically.
  - The heightfield is the same for the same name, and `groundBelow` agrees with it.
  - The Crowd step stays within the Stage 0 budget for 400 Soldiers (a timing test with generous slack, or a soak that logs).
  - The staggering updates every Soldier exactly once per stagger period.
  - Separation: no two living Soldiers overlap beyond a tolerance after the armies meet.
  - Rout fires below the threshold and the Battle ends with the right winner.
  - Over many seeds, equal armies win about 50/50 (within a band that Stage 5's tuning may tighten).
- **Check in `npm run dev`**: watch three seeds of a full AI-vs-AI war end in a Rout.

## Stage 2: rendering the Crowd
The war looks like a war: terrain, impostors, team colours.
- **The generic soldier per Team** named in `data/battle.json` (a Body and a Weapon from the roster), with a team colour.
- **Impostor atlas, baked in-engine**: an offscreen pass renders the generic soldier's Body playing its real Motions (Idle, walking under the Gait, one swing, a Stagger, a death) from 8 directions into a sprite atlas. Bake at load or as a dev command that writes the atlas into `public/` (pick the simpler one and say why in the Result). Team tint is applied in the shader, so one atlas serves both Teams.
- **Impostor layer**: one instanced billboard draw per Team, choosing the direction cell from the camera-relative heading and the animation from the Soldier's state, interpolating positions between Crowd updates.
- **Terrain mesh** for the heightfield, and the existing sky. Blob shadows for Soldiers if cheap.
- **Spectator camera** for an AI-vs-AI Battle, and a dev-only Skirmish entry to start one.
- **Tests**: the direction-cell and animation-frame choice (pure functions); the atlas layout; the render-side interpolation. Render frame time with 400 impostors stays inside the Stage 0 budget.
- **Check in `npm run dev`**: a full war from the spectator camera at the target frame rate; impostors face the right way while walking, fighting and dying.

## Stage 3: the Fighter Pool and the Bubble
A Player fights in a Battle. Soldiers near them become full Fighters and go back to the Crowd when the Player moves on.
- **The Fighter Pool**: in a Battle, `fighters[]` is a fixed-size Pool (size from Stage 0). The Player's Fighter holds slot 0. Other slots are unbound or bound to a Soldier. Every system that iterates `fighters` (step, hits, AI perception, the HUD, the renderer, hashing) treats an unbound slot as out of play, not dead. Lift or bypass `MAX_TEAM_SIZE` for the Battle only.
- **Promotion** (a Simulation step at the start of a Tick): a living Soldier within the promote distance of a Player's Fighter takes a free slot, as a full Fighter at guard with the Soldier's position, heading, Team and HP, its generic Body and Weapon, and a fresh Beginner AI Controller loaded at that Tick (as an AI Takeover is). The Soldier is marked as promoted and leaves the Crowd step.
- **Demotion**: a promoted Fighter beyond the demote distance, in an Action that allows it (Idle or walking), at least ~1 s after its Promotion, writes its position, heading and HP back to its Soldier and frees the slot. A promoted Fighter that dies kills its Soldier.
- **A simple cap for now**: promote nearest first while slots are free. Attack Slots and allies come in Stage 4.
- **The AI ignores Soldiers**: AI perception, targeting and Block decisions only see bound slots. A Soldier never targets a full Fighter: Soldiers within the Bubble but not promoted hold position outside sword reach.
- **The swap**: render-side, a short dithered crossfade between the impostor and the full model plus a dust puff at Promotion and Demotion.
- **`CONTEXT.md`**: Bubble, Promotion / Demotion, Fighter Pool. ADR 0020 Accepted.
- **Tests**:
  - Promotion then Demotion round-trips a Soldier's state (position, heading, HP) exactly when nothing happened in between.
  - Hysteresis: a Fighter standing between the promote and demote distances neither promotes nor demotes repeatedly.
  - No Demotion mid-Attack, Stagger, Knockdown or Fall.
  - A Rollback across a Promotion and across a Demotion re-simulates to the same hash, AI memory included.
  - No Soldier ever changes a full Fighter's HP (a soak asserting it every Tick).
  - Unbound slots are never hit, targeted or drawn.
  - Every Duel and Dungeon test still passes.
- **Check in `npm run dev`**: walk a Player into the enemy army, fight, walk away from a quiet area and see Soldiers demote; the swap is masked by the crossfade.

## Stage 4: Attack Slots, the waiting ring and allies
The pressure on a Player is capped and fair, and allies fight beside them.
- **Attack Slots**: each Bubble promotes at most the enemy-slot count of enemies (from Stage 0, ~4). Further enemies in the Bubble stay Soldiers. When a slot frees (death, Demotion, the enemy switching to an ally), the nearest waiting enemy promotes.
- **The waiting ring**: waiting enemy Soldiers steer to spots on a ring just outside sword reach of the Player's Fighter, spaced apart, biased toward the Player's direction of travel so the ring closes in front of them (the settled tension #1). Soldiers near a full Fighter's path step out of it rather than overlap it. Steering only.
- **Allies**: each Bubble promotes up to the ally-slot count (~3) of allied Soldiers, nearest to the slot-holding enemies first. Promoted allies fight promoted enemies with real combat. A full enemy that targets a promoted ally may let its Attack Slot go to the next waiting enemy, which is how allies relieve a Player.
- **Targets across tiers**: a full Fighter never targets a Soldier. A full enemy whose Player-side targets are all gone waits at the ring or demotes when allowed.
- **AI behaviours** (Beginner, for the Battle only, without changing any Duel difficulty): hold at a ring spot while waiting, and chase without giving up while holding a slot.
- **`CONTEXT.md`**: Attack Slot.
- **Tests**:
  - Never more than the enemy-slot count of promoted enemies per Bubble, and never more than the ally-slot count of allies.
  - A freed slot is filled by the nearest waiting enemy.
  - The ring: waiting Soldiers stay outside sword reach; a Player walking into a crowd of waiting enemies finds one in their way within a set time (a scripted test).
  - An ally engaging a slot-holding enemy lets the next one in.
  - Rollback across a slot change re-simulates identically.
- **Check in `npm run dev`**: charge into the enemy line alone (it is hard and you can't walk out), then fight beside allies (it is easier and they take enemies off you).

## Stage 5: a full Battle offline (end of Milestone 1)
- **Taking over an ally**: when the Player's Fighter dies, the nearest living ally Soldier promotes into slot 0 as the Player's Fighter (the generic soldier's Body and Weapon, its HP), the camera moves to it, and the Player plays on. The Player is out (spectator camera) when their Team has no Soldiers.
- **Minimap**: render only, a top-down map of the Battlefield with both armies (density or dots), the Player and their facing, on a key or always in a corner.
- **HUD**: each army's strength and the Rout threshold.
- **Rout presentation**: the losing army flees, a banner, then a results screen (winner, the Player's kills, the soldiers taken over).
- **Lobby**: Battle as a Format in Skirmish (offline), with the Player's Body and Weapon pick as today.
- **Tuning pass**: Bubble distances, Crowd damage and HP, Rout threshold, slot counts, Beginner AI in groups. The target: a Player can hold off four soldiers but not a dozen, and a good Player decides a close Battle.
- **`CONTEXT.md`**: the Battle Format's entry, the takeover rule.
- **Tests**: takeover picks the nearest living ally and keeps its HP; out when the Team has none; the Battle ends exactly once; a 10-minute AI-autopilot soak with no hash divergence on replay and no Tick over budget.
- **Check in `npm run dev`**: three full Battles from the Lobby, one won, one lost, one with several takeovers.

## Stage 6: online Battle, the Simulation side (Milestone 2)
- **Four Bubbles**: one per Player's Fighter. Overlapping Bubbles share the Pool. A rule for shrinking each Bubble's budgets when several Bubbles are in use, so the Pool never overflows (from the Stage 0 numbers).
- **Players' slots**: slots 0 to 3 are the Players. A guest leaving is an AI Takeover of its slot as today (ADR 0010), and that Fighter then counts as an ally, not a Bubble.
- **Resync** carries the Crowd and every bound slot's AI memory. `PROTOCOL_VERSION` + 1. Checksums cover the Crowd.
- **Rollback cost**: a soak with four Bubbles full measures the worst Rollback; if it is over budget, lower the Bubble budgets, not the 15-Tick window.
- **Tests**: loopback tests over the memory transport (two and four Players, a resync mid-battle, a Takeover mid-battle), as the Dungeon's Stage 4 did.

## Stage 7: online Battle, presentation and Lobby
- Battle offered online in the Lobby (the host chooses it; Players pick their Team).
- A marker for each Player (a name tag and a minimap icon), since a Player who took over a soldier looks like every other soldier.
- **Check in `npm run dev`**: two browsers, then four, through a full Battle.

## Later
Elites (captains with Relic-style `mods`); Soldiers solid to full Fighters; orders (Charge, Hold, Follow me, Form line); more troop types and Bodies; ranged soldiers (Throwing Daggers, then bows); obstacles and fortifications (Crowd pathfinding beyond a flow field); a third render tier (render-only full models for nearby Soldiers, posed from Motions, which moves the swap further out without a bigger Pool); adjustable army sizes in the Lobby; reinforcement waves for bigger battles.

## Open questions
1. **A close swap is visible.** With the third-person camera a few metres behind the Player, 10 m is mid-screen. The crossfade hides some of it; the third render tier (Later) is the cheap fix with no new art if playtesters notice.
2. **Beginner AI was tuned for Duels.** Four of them taking turns may feel too passive or too deadly in a crowd. Stage 5 tuning judges it against "a Player can hold off four soldiers but not a dozen".
3. **The Pool size online.** Four Bubbles × (4 + 3) = 28 slots plus the Players. If Stage 0 says the laptop can't Roll back that many, Stage 6's shrinking rule decides it.
