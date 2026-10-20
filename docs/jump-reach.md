# Jump reach

How high and how far a Fighter can get with a Jump, so level design and the AI know which places are reachable.
Measured in the Simulation with `data/fall.json` as of this note (`jumpBoost` 25, `jumpBoostDelay` 0.12, `jumpBoostTime` 0.35, `gravity` 14, `jumpSpeed` 4.8, `stepUp` 0.35) and `walkSpeed` 2.5.

## The short version

- **Highest jump:** about **4.0 m** (feet at 3.97 m above takeoff), holding Jump for 0.5 s or more.
- **Highest ledge you can land on:** about **4.3 m** above takeoff. A Fighter stands on ground up to `fall.stepUp` (0.35 m) above its feet, so a ledge counts as reached once its feet get within 0.35 m of the top.
- **Farthest jump on level ground:** about **4.3 m**, in 1.7 s.
- **A tap** is the old hop: 0.78 m high, 1.7 m long.
- **No Landing damage** from any Jump, however deep the drop (ADR 0012): only deadly ground (Lava, Water, an Abyss) kills a jumper. Walking off a ledge still hurts once the drop passes `safeHeight` (1.6 m), and a Fighter knocked down in the air takes double fall damage from the real top of its arc. So the AI may leap down at an enemy from any height that lands on safe ground.
- **A floor overhead caps the jump:** a Walk Surface is solid from below, so under one (the library's bridge or mezzanines) the feet rise no higher than its height minus `fighter.height` (1.8 m). The head bumps it, the rise stops, and any boost left is lost.
- **Standing and running jumps reach the same.** A Jump starts at full walk speed in whatever direction the Fighter is walking, and air speed never goes above walk speed. A Slowed Fighter (dagger Hit) moves at 0.6× speed, so it jumps the same height but only about 0.6× as far.

Anything within 4.3 m up and the distances below is reachable for a player. A spot meant to be out of bounds needs to be taller than that, or walled off.

## Height and distance by how long Jump is held

Holding Jump starts boosting after 0.12 s and stops boosting 0.35 s later, so anything held beyond about 0.5 s is a full jump.

| Jump held | Top of the jump | Reached after | Time in the air | Distance on level ground |
|---|---|---|---|---|
| tap | 0.78 m | 0.32 s | 0.67 s | 1.71 m |
| 0.17 s | 1.09 m | 0.40 s | 0.82 s | 2.08 m |
| 0.25 s | 1.71 m | 0.55 s | 1.07 s | 2.71 m |
| 0.33 s | 2.47 m | 0.70 s | 1.30 s | 3.29 m |
| 0.42 s | 3.36 m | 0.85 s | 1.55 s | 3.92 m |
| 0.50 s (full) | 3.97 m | 0.95 s | 1.70 s | 4.29 m |

## Which ledges a full jump lands on

For a ledge of a given height (above the takeoff ground), the farthest its near edge can be from where the Fighter leaves the ground (its centre) and still be landed on. Any closer also works.

| Ledge height | Farthest near edge |
|---|---|
| 0.50 m | 4.20 m |
| 1.00 m | 4.05 m |
| 1.50 m | 3.95 m |
| 2.00 m | 3.80 m |
| 2.50 m | 3.65 m |
| 3.00 m | 3.45 m |
| 3.50 m | 3.25 m |
| 4.00 m | 2.90 m |
| 4.25 m | 2.60 m |
| 4.50 m | out of reach |

The higher the ledge, the earlier on the way down the Fighter must already be over it, so the reach shrinks.

## Places a held Jump reaches, by Arena

The spots only a Jump gets to. Each prop is a lid: a Walk Surface over its Walls at its drawn top, so a Jump that clears the Walls lands on top and the Fighter can walk about up there and walk (or jump) off. Heights are the lid's `y`; "held 0.25 s" is 15 Ticks of Jump, "full" 0.5 s or more. Each is checked by a Simulation test in the Arena's test file.

**The AI follows onto every one of them.** The navmesh has a jump Link onto each (and back, where dropping off is deadly): found by running Jumps through the Simulation's own flight (`jumpArc`) and kept only if the Jump still lands there when taken off 0.2 m off, held a Tick shorter or longer, or aimed 5° off. A Normal AI follows jump Links held up to 20 Ticks, so it follows onto all but the full Jumps (the locomotive's roof and the chamber's catwalks); a Hard one onto all; an Easy one only taps. Each is checked in `src/sim/jumpLinks.test.ts` (a jump Link) and `src/controllers/ai.test.ts` (an AI follows an enemy onto it). The `?dev=1` collider view draws every jump Link's arc, cyan for a tap to magenta for a full Jump.

- **Summit** (`summit.test.ts`; shelf y 0, plateau y 2)
  - the hull, 3.45: a held (0.25 s) Jump from the plateau at (-1.8, -7.0), along −z
  - the containers, 2.5: a tap from the plateau at (3.0, -5.6), along +z
  - the nacelle, 1.3: held 0.25 s from the shelf at (-3.5, 3.7), along −x
  - the dish (lying face-up), 1.1: held 0.25 s from the shelf at (3.8, 4.0), along +z
  - the crate by the back crag, 0.9: a tap from the shelf at (-2.6, 5.2), along +z
  - the crate in the nook, 0.8: a tap from the shelf at (-3.4, -3.2), along −z
- **Train** (`train.test.ts`; flatcar deck y −1.2)
  - the locomotive's roof, 0.5: a full Jump from the deck at (-0.6, 19.0), along +z over the bulkhead and the 2.5 m gap. A full Jump back along −z lands on the deck. Its nose and sides are a Death by Fall.
  - the crate stack, 0.6: held 0.25 s from the deck at (0.75, 13.6), along +z
  - the power cell, 0.25: held 0.25 s from the deck at (0.7, 16.8), along +z
  - the waste drums, −0.3: a tap from the deck at (-0.8, 15.9), along +z
- **Ship** (`water.test.ts`; main deck y 0)
  - the big crate, 1.0: a tap from the deck at (-1.95, 4.9), along +z. The small crate (0.7) beside it is a step down. Walking off the big crate's outboard side carries you over the bulwark into the sea, as a tap over the rail does.
- **Library** (`library.test.ts`; ground floor y 0)
  - the two reading tables, 0.8 (the tabletop; the 3.2 × 1.7 lid covers the chairs too): a tap from the floor at (-5, 8.6), along +z
  - Not the bridge or the mezzanines from below: their undersides stop the Jump (a floor overhead caps it, above).
- **Chamber** (`lava.test.ts`; ring y 0)
  - the two catwalks, 0: a full Jump from the ring's edge at (0, ±7.2), along ±z, crosses the 3.5 m gap and lands at about r 12. Side rails keep you on. The open end facing the ring is unrailed, so walking off it drops you into the lava. A full Jump from the end back along ∓z lands on the ring.

## Updating this note

After changing `data/fall.json` or the walk speed, re-measure:

```bash
MEASURE_JUMP=1 npx vitest run src/sim/jumpReach.measure.test.ts --silent=false
```

It prints both tables (with every 0.25 m of ledge height); paste them in and update the short version.
