# Whirlwind (spinning AOE move): feature definition

> Status: **design interview in progress**. Not staged for implementation yet. Name agreed: **Whirlwind**.
> Before staging, read: this file, `CONTEXT.md`, `docs/adr/` (0001, 0002, 0007, 0012, 0020), `docs/plans/kick-mechanic.md` (the template for a new committed Action).

## Why
Players want a move that hits many enemies at once. The goal is **spectacle**: feeling powerful, not fixing a balance problem. It is a **core move**, available to every Fighter in every mode (Duel/Match, Run, Battle), with **no cooldown or cost**. Balance comes from the move itself: a long, readable telegraph and low damage per Hit.

## Agreed design (from the design interview)

### Input and Action
- **G key, own Action** (`Whirlwind`, built like the Kick), not an Attack Direction.
- **Weapons in v1:** every Weapon **except the Flail**, sharing one default Motion (per-Weapon Motion overrides as needed). The Flail comes in a later stage.
- **Wind-up (charge):** hold the key. The spin is armed once **1.0 s** has passed (Tuning Data). **Letting go after that spins; letting go earlier cancels** with no spin. Holding longer keeps it armed.
- **During the hold:** the Fighter can **walk slowly** and turn.
- **Direction:** **Left or Right only**, taken from the most recent horizontal mouse movement, the same way an Attack Direction is read. The opponent reads it from the pose.

### The spin
- **5 full turns**, each a real **360° Blade Sweep** (ADR 0002: still physical, no hit by radius).
- **Moves forward on its own** while spinning. The Player **steers** by moving the mouse left/right (it turns the heading).
- **Hits:** every turn can hit every Fighter in reach, **including one it already hit** (normal Hit rules).
- **Damage:** **half** a normal blade Hit (Hit Zone multipliers still apply).
- **A Hit knocks down** (the full Knockdown: push away, down, Get-up). A Fighter already down can be hit by later turns and pushed again, as with any Hit on a Knockdown.
- **Walls:** the spinning blade **passes through Walls** and is not stopped. This differs from today's rule, where a Wall Staggers the attacker; it needs a short ADR. It is still assumed **not to hit through** a Wall (a Fighter behind a Wall is safe). Confirm this.
- **Teammates:** same as today: the blade Staggers an ally and deals no damage.

### Defending
- **Clashes:** normal contact rules. Whichever blade reaches a body first Hits; an enemy Hit on the spinner cancels the spin (below). The Whirlwind has no special parry.
- **Block:** a **normal directional Block** of the spin's side, mirrored as for any Left/Right swing. A Blocked turn deals no damage, **pushes the defender back**, and **does not Stagger the spinner**: the spin carries on to other targets and to later turns.
- **Interrupting:** any **damaging Hit or Kick** landing on the spinner (a Thrust inside the arc, a Throwing Dagger, a Kick) Staggers it and **cancels the remaining turns**.
- **Punish windows:** the 1.0 s hold, interrupting the spin as above, and the short Recovery.

### Ledges
- The forward drive **can carry the spinner off an Abyss edge**. That is the Player's risk; the AI must still check its own path (its usual "never Jump somewhere deadly" care applies to its Whirlwind path too).

### After
- **Short Recovery** (normal length) after the 5th turn, with no extra dizziness.

### Crowds (Run and Battle)
- The spin hits **full Fighters only**. Crowd Soldiers are untouched unless promoted.
- **Known limit:** in a crowd it reaches only the Bubble's Attack Slots: `battle.slots.enemies` 4 in a Battle, `delver.attackSlots` 4/3/3/3 in a Run. Waiting enemies hold outside sword reach, so it hits about 4 enemies at most.

### AI
- AI Controllers **use** the spin and **answer** it (Block its side, interrupt it, keep out of reach of the hold). This is gated by difficulty and Style: Aggressive spins more, Defensive less.
- **Beginner neither uses nor answers it**, so it is a "free" move against Beginners. The legacy Easy/Normal/Hard tiers stay frozen: they neither use nor answer it.

## Balance notes (to check in playtests)
- The most a single victim can take is **5 × 0.5 = 2.5× a normal Hit**, plus repeated Knockdowns, if the spinner steers after a Fighter being knocked away. The forward speed against the Knockdown Slide (`heavyBlow.knockdownSlide`-like) decides whether this clears space or kills. Tune the forward speed below the Knockdown Slide speed if it should mostly clear space.
- With no cooldown, the move's strength in a Duel depends entirely on the 1.0 s hold being readable and the spin being interruptible.

## Open questions
1. **Spin timing:** seconds per turn (e.g. 0.4 s → 2 s for 5 turns), forward speed, and how fast the mouse can steer.
2. **Hold details:** can the hold be Feinted with Q, Blocked out of, or cancelled into a Block? Can it start in a Jump, while crouched, or while Sheathed (presumably not)?
3. **Hit through Walls:** confirm that a Fighter behind a Wall is safe even though the blade passes through it.
4. **Allies:** does Staggering an ally do anything to the spinner (today: nothing)? Does the spin pass through allies' bodies?
5. **Feedback:** sound, a whirl trail, Camera Shake on hits, and how the hold is shown on the Fighter's pose so it reads clearly (the move's "spectacle" goal).
