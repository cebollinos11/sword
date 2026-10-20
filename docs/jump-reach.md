# Jump reach

How high and how far a Fighter can get with a Jump, so level design and the AI know which places are reachable.
Measured in the Simulation with `data/fall.json` as of this note (`jumpBoost` 25, `jumpBoostDelay` 0.12, `jumpBoostTime` 0.35, `gravity` 14, `jumpSpeed` 4.8, `stepUp` 0.35) and `walkSpeed` 2.5.

## The short version

- **Highest jump:** about **4.0 m** (feet at 3.97 m above takeoff), holding Jump for 0.5 s or more.
- **Highest ledge you can land on:** about **4.3 m** above takeoff. A Fighter stands on ground up to `fall.stepUp` (0.35 m) above its feet, so a ledge counts as reached once its feet get within 0.35 m of the top.
- **Farthest jump on level ground:** about **4.3 m**, in 1.7 s.
- **A tap** is the old hop: 0.78 m high, 1.7 m long.
- **No Landing damage** from any Jump onto ground at or above where it took off: a Jump's drop counts from no higher than a tap's top. Jumping *down* off a ledge still hurts by the drop below takeoff (beyond `safeHeight` 1.6 m).
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

## Updating this note

After changing `data/fall.json` or the walk speed, re-measure:

```bash
MEASURE_JUMP=1 npx vitest run src/sim/jumpReach.measure.test.ts --silent=false
```

It prints both tables (with every 0.25 m of ledge height); paste them in and update the short version.
