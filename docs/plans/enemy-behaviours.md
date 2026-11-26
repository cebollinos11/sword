# Enemy Behaviours: More Styles, and Quirks

> Status: planned (2026-11-26). Scope agreed with the user the same day: five new Styles (Showoff, Chambermaster, Skirmisher, Pack Hunter, Reckless), three Quirks (Dumb, Slow, Hopper; Hopper moved from the Styles on 2026-11-26), and any Delver Troop playable as a Duel opponent in dev mode. Builds on the AI Controller (`src/controllers/ai.ts`, `docs/plans/ai-behaviour.md`), its Styles (`ai.styles`), the Delver Troops (`docs/plans/delver-troops.md`) and the Mods (`src/sim/mods.ts`, `docs/plans/dungeon.md`). Each Stage ends with a `### Result`, as in the other plans.

## Context
A Delver enemy is a Prefab (its Body, Weapon, Style and Mods) with one Variant per skill (`data/delver.json`, `delver.troops`). Its Variant sets its HP, its AI difficulty (Beginner, Skilled or Expert) and optionally its Relics or another Style. A Warband names only skills and counts, and each Floor fills them from its own Prefabs.

Two settings shape how an enemy fights:
- **Its difficulty says how well.** Reaction Time, mistake rate, and a chance for each part of the repertoire.
- **Its Style says what it likes to do.** Each Style multiplies some of the difficulty's chances and clamps the result to 0..1 (`skillOf`). There are five today: Balanced, Aggressive, Counter, Tricky and Defensive.

The enemies don't feel different enough. There are three reasons:
- **Few Styles.** The five existing Styles are broad blends, not distinctive habits.
- **A multiplier on zero is zero.** Beginner has `chamberRate` 0, and `whirlwindRate`, `landingPunish`, `jumpEscapeRate` and `jumpNav` at their defaults (0 or below), so a Style that leans on those moves changes nothing at Beginner. A multiplier also can't lift a chance that is already 1: Expert `punish` 1 × 1.3 is 1.
- **No hard rules.** Nothing can make an enemy never Block, or walk and swing slowly. A Style only re-weights choices the AI already makes. Walk speed and Tempo aren't AI settings at all: walk speed is the global `fighter.walkSpeed` and Tempo is per Weapon.

## Decisions (the user's answers, 2026-11-26)
- **Three layers per enemy:**
  - **Tier** (its difficulty) is how well it executes.
  - **Style** is what it prefers.
  - **Quirk** is a hard rule on top of both.

  A Troop names one tier and one Style, and zero or more Quirks.
- **Five new Styles:** Showoff, Chambermaster, Skirmisher, Pack Hunter and Reckless.
- **Three Quirks:** Dumb, Slow and Hopper. Hopper was a Style until 2026-11-26 (the user's call, after Stage 1): it needs a minimum on `jumpNav`, which a Style may not touch, and as a Quirk it goes with any Style (a Defensive Hopper, an Aggressive one).
- **Out of scope:** Sneaky, Coward, Berserker, Grudge, Warband `role`s and every other idea from the brainstorm. They can be planned later on this groundwork.
- **The five old Styles stay as they are,** and so does every Troop that uses them. A Balanced Beginner with no Quirks plays bit for bit as today.
- **Every Troop can be fought in Duels.** With `?dev=1`, a Duel AI Seat can be set to any Delver Prefab and Variant, Boss Variants included. It then fights as that enemy would on a Floor: its Body, Weapon, HP, tier, Style, Quirks, Mods and Relics. This is how the new behaviours get tested by hand, and it's built first (Stage 0) so every later Stage can use it.

## How a Troop reads in the end
`data/delver.json`. A Prefab may name `quirks`, and a Variant may replace its Prefab's Style and Quirks:

```json
{ "name": "Uruk", "body": "uruk", "weapon": "Sledge Hammer", "minTier": 2,
  "style": "Reckless", "quirks": ["Slow"], "mods": { "damage": 0.6 },
  "variants": [
    { "difficulty": "Beginner", "hp": 80, "quirks": ["Slow", "Dumb"] },
    { "difficulty": "Skilled",  "hp": 95 },
    { "difficulty": "Expert",   "hp": 110 },
    { "name": "Warden", "boss": true, "difficulty": "Skilled", "hp": 250 } ] }
```

`data/ai.json` defines the Styles and Quirks:

```json
"styles": {
  "Chambermaster": { "chamberRate": { "mul": 3, "min": 0.06 }, "aggression": 0.6, "preempt": 1.3, "punish": 1.3 }
},
"quirks": {
  "Dumb": { "ai": { "defendRate": 0 } },
  "Slow": { "body": { "walkSpeed": 0.7, "windUp": 1.35 } },
  "Hopper": { "ai": { "jumpAttackRate": { "mul": 4, "min": 0.002 }, "jumpNav": { "min": 10 } } }
}
```

- **A Style entry** is a multiplier (a number, as today) or `{ "mul", "min" }`. The result is `clamp(max(min, value × mul), 0, 1)`, so a Style's signature move is in use at every tier.
- **A Quirk** has an `ai` part and a `body` part. Both are optional.
  - **The `ai` part** changes AI settings after the Style is applied, so a Quirk always wins. An entry is either:
    - a number, which **sets** the setting (Dumb's `defendRate` 0); or
    - `{ "mul", "min" }`, which **adjusts** it as a Style entry does (`clamp(max(min, value × mul), 0, 1)`; `mul` defaults to 1). On `jumpNav`, which is Ticks, not a chance, only `{ "min" }` is allowed: at least that many Ticks, never lower than the tier's own (an Expert Hopper keeps its 30).
  - **The `body` part** uses absolute values (Mods), not multipliers.
  - **The `body` part** is Mods, folded in with the Fighter's Relics (`foldMods`), so it reaches the Simulation the same way a Relic does.

Size still follows HP and tint still follows skill (`delver.skillTints`).

## The Styles
The numbers below are starting values, to be tuned in the Editor's Tuning panel. Settings marked **new** don't exist yet. Each new one defaults to "as today", so the old Styles and difficulties don't change.

| Style | What it does | Settings |
|---|---|---|
| **Showoff** | Whirlwinds often, even at a lone enemy, and adds flourishes (Feints). It cares less about safety. | `whirlwindRate` ×3, min 0.03; **new** `whirlwindAlone` min 0.5; `feintRate` ×1.5; `caution` ×0.6 |
| **Chambermaster** | Waits for your swing and Chambers it. Starts fewer Attacks itself. | `chamberRate` ×3, min 0.06; `aggression` ×0.6; `preempt` ×1.3; `punish` ×1.3 |
| **Skirmisher** | Keeps out of reach and throws daggers, whether you stand or walk off. It closes in when it runs out of daggers. | `throwRate` ×4, min 0.04; **new** `throwStanding` min 0.6; **new** `kite` min 0.7; `caution` ×1.5; `pressure` ×0.4 |
| **Pack Hunter** | Joins the enemy its allies already fight, flanks it and takes turns. It rarely fights alone if it can help it. | `teamwork` ×2, min 0.8; **new** `gangUp` min 0.8 |
| **Reckless** | Swings at once and keeps swinging. It chains, ignores whiffs and doesn't back off. | `aggression` ×1.6; `pressure` ×2; `chainRate` ×1.8; `caution` ×0; `whiffCheck` ×0.2; `holdBreak` ×0.5 |

What the new settings do:
- **`whirlwindAlone`.** A Whirlwind needs two or more enemies in range, or its focus down (`spinMoment`). Showoff may spin at one standing enemy too, rolled once per moment at this chance. All the other rules still apply: a clear drive, no ally in the way, and safe ground.
- **`throwStanding`.** A throw is only taken at a target walking away (`toss`, `FLEEING`). Skirmisher may throw at a target that isn't fleeing, rolled once per throw at this chance. Everything else still applies: `throwRange`, line of sight, outside its own reach and the aim error.
- **`kite`.** With daggers left and its target within that target's reach plus `DISENGAGE_MARGIN`, its tactic draw leans toward Disengage at this chance. It backs off to throwing range, using its jump escapes if it has any. With no daggers it plays Neutral.
- **`gangUp`.** When it picks an enemy (`Focus`), at this chance it takes the one most of its allies already fight, as seen Reaction Time ago, within `SPREAD_RANGE` of its nearest. It does that instead of spreading out (`spreadPick`). Flanking and turn-taking stay with `teamwork`.

Reckless needs no new code. `caution` 0 already stops the backing off after a swing. Styles never touch Reaction Time or the mistake rate (`ai.styles` rule), and that stays so: a Reckless Beginner is as sloppy as any Beginner.

## The Quirks

| Quirk | What it does | How |
|---|---|---|
| **Dumb** | Doesn't defend. It never Blocks, Ducks, Chambers, Outpaces or steps back against a blade Attack. | **new** AI setting `defendRate` (default 1), rolled once per enemy Attack in `planDefence`: on a miss it plans nothing and carries on with its own plan. Daggers, Kicks and Whirlwinds go through `defendRate` too. |
| **Slow** | Walks slower, and its Wind-ups take longer. | Two **new** Mods: `walkSpeed` (a walk multiplier, default 1) and `windUp` (an Attack Wind-up Tempo multiplier, default 1). |
| **Hopper** | Leaps in with jumping Attacks, hops round you, jumps away when pressed, meets your Landings, and follows you up jumps. | `ai` only: `jumpAttackRate` ×4, min 0.002; `jumpStep` ×3, min 0.3; `jumpEscapeRate` ×2, min 0.1; `landingPunish` ×1.5, min 0.2; `jumpNav` min 10 |

**Dumb** has only an `ai` part, at `defendRate` 0. It isn't a mistake: a miss doesn't use the mistake rate or `humanMistakes`, and the mistake roll still runs as before when it does defend. A future "Clumsy" Quirk could set `defendRate` to 0.5 with no new code.

**Hopper** has only an `ai` part, with the numbers it had as a Style. It is a Quirk because of `jumpNav`: a Beginner's is 0 (taps only), so a Beginner Hopper couldn't follow you up a jump, and a Style may not touch `jumpNav` ("how well", Stage 1's Design). A Quirk may, and its `{ "min": 10 }` only raises it: a Beginner Hopper follows jump Links held up to 10 Ticks, and Skilled (20) and Expert (30) are unchanged. Its jump escapes (`jumpEscapeRate`) use the same limit, so a Beginner Hopper also escapes over those. Every jump is still checked with `jumpIsSafe`.

**Slow** has only a `body` part, so it's a change to the Simulation, not to the AI:
- **Walk.** `walkSpeed` multiplies the ground walk (`step.ts`, the `speed` product), as `slowFactor` does for a dagger's slow.
- **Jumping is unchanged.** Air control (`flyBody`'s speed) and the walk a Jump takes off with (`drawnPace`) keep the full `fighter.walkSpeed`, because the Floors' jump Links (`nav.ts`) and every `jumpIsSafe` check are worked out at that speed. A Slow Fighter still makes every jump Link a normal one does.
- **Wind-up.** `windUp` multiplies the Attack Wind-up phase of the Weapon's Tempo (`playedSeconds`), for that Fighter only, and multiplies with the Weapon's own `tempo.windUp`. It slows only the Wind-up, so Release (the blade's speed, and its Hits) and Recovery are unchanged. A Feint, a Chamber or a Throw isn't an Attack Motion and doesn't change.
- **Relics.** Both Mods join the Relic vocabulary (`RELIC_EFFECTS`):
  - `walkSpeed` is good above 1, so it scales with Rarity like `damage`.
  - `windUp` is good below 1, so it joins `RELIC_GOOD_LOW`.

  No Relic uses them in this plan. They're there so a later "Boots of Haste" needs only data.
- **The Crowd is unchanged.** A Slow Soldier walks with its Warband at the Crowd's speed, and only its promoted Fighter is slow. Its Warband walks together anyway.

## How Styles and Quirks play across the tiers
- **A Style's signature minimum is why it works at Beginner.** A Beginner Chambermaster does try to Chamber. With 0.4 s Reaction Time and its mistake rate, it should often get the timing wrong. That shows a new player the move and how to beat it.

  **Settled with the user (2026-11-26), after Stage 1:** a Beginner can't Chamber at all today (its 0.4 s Reaction Time outlasts every Weapon's Wind-up, so the Chamber is never planned; see Stage 1's Result). That's fine: a Beginner is bad at Chambers even as a Chambermaster. Nothing is added to make it try. Its minimum still counts once its Reaction Time allows, and in later tuning.

  Today a Chamber is pressed exactly when it fires (`pressAt`), since a mistake turns into a wrong Block before the Chamber check. So Stage 2 adds a **Chamber timing error**: `pressAt` moves by up to ±`CHAMBER_SLOP` Ticks × `mistakeRate`, rolled with the Chamber. An Expert's error is about 0, and a Beginner's often misses the window.
- **Showoff at Beginner.** CONTEXT.md says Beginner never Whirlwinds. A Style's minimum now overrides that for Showoff only, and the Glossary changes to match. A Beginner Showoff's hold is just as long and as visible as anyone's, and with its slow reactions it rarely lets go at the right moment. It's an easy one to punish.
- **Quirks are fixed handicaps, so their weight changes with the tier:**
  - **Beginner + Dumb** is fodder.
  - **Expert + Dumb** is a glass cannon: an Expert's offence with no defence.
  - **Expert + Slow** is a heavy duelist. It's slow to start a swing but reads and punishes well.

  Since a Variant may replace its Prefab's Quirks, a Prefab can drop a Quirk up the ladder ("dumb only at Beginner").

## Stages

### Stage 0: Fight a Troop in Duels (dev mode)
> Done (2026-11-26).

The test bench for the rest of the plan: fight any Delver enemy one on one, without generating a Floor or finding it in a Run.

**Today**, a Duel AI Seat (`Seat` in `src/lobby/lobby.ts`, `LineupSlot` in `src/controllers/lineup.ts`) has a difficulty, a Style, a Weapon and a Size, and nothing else. A Duel Fighter has the standard HP, no Mods and no Relics, and the Seat chooses no Body.

**The change:**
- **Seat and Lineup.** An AI Seat and its Lineup slot gain an optional `troop`, naming a Prefab and one of its Variants (`{ prefab: "Uruk", variant: "Beginner" }`). A Variant is named by its difficulty, or for a Boss Variant by its name ("Warden").
- **Resolving a Troop.** Every peer resolves the Troop from Tuning Data at the Match's start, the same way a promoted Soldier is built (`src/sim/delver/troops.ts`, `bubble.ts`):
  - its Prefab's Body and Weapon;
  - its Variant's difficulty, Style and (from Stage 4) Quirks;
  - its Mods, folded with its Relics (`foldMods`);
  - its HP;
  - its Size from that HP (`delver.sizeHp`).

  The Seat's own difficulty, Style, Weapon and Size are ignored while a Troop is set.
- **HP.** By default the Variant's HP is scaled as on a tier 2 Floor (`delver.tierHp`). A **Floor tier** select (1 to 3) beside the Troop picks another tier. A Boss Variant's HP is its whole HP, as on its Floor.
- **The Match.** It gains a per-Fighter HP, Mods and Body for its Duels. Each is absent for every Fighter without a Troop, so a normal Duel's config and hash are unchanged. HP is restored to the Troop's HP at each Duel's start, as for every Fighter.
- **Lobby, in dev mode only** (`devMode()`, `?dev=1`):
  - Each AI Seat's "More options" gets a **Troop** select listing "(none)" and then every Prefab's Variants ("Uruk · Beginner", "Uruk · Warden (Boss)").
  - With a Troop chosen, the Seat's difficulty, Style, Weapon and Size controls give way to a read-only line: Body, Weapon, HP, tier, Style, Quirks and Relics.
  - With `dev=1` absent, the select isn't shown. A Seat that already has a Troop still plays it, so a guest without `dev=1` plays what its host set.
- **Plain Styles and Quirks.** The Style select already lists every `ai.styles` entry, so each new Style is playable on a plain AI Seat as soon as it exists. In dev mode, a **Quirks** select on a plain AI Seat (from Stage 4) adds Quirks without a Troop.
- **Online.** `troop` is plain data in the Lobby state and the Lineup, so it syncs like `style`. The Lobby and Lineup message validators (`src/net/messages.ts`) accept it. A name a peer's Tuning Data doesn't know is refused, the same way an unknown Style is.
- **Done:**
  - In `?dev=1`, a Duel against "Uruk · Beginner" fights a Fighter drawn as the Uruk Body. It has the Sledge Hammer, the Variant's HP at tier 2, its Mods (`damage` 0.6) and a Beginner Aggressive AI.
  - A Duel against a Boss Variant ("Wraith Lord") wears its Relics, and has its HP and its Size.
  - The Troop select is absent without `dev=1`.
  - A Duel with no Troop on any Seat has the same config and hash as before (the existing Match and Lobby tests).
  - An online Lobby with a Troop Seat starts the same Match on both peers (the Lobby sync tests).

#### Design
Settled 2026-11-26, before any code. The two open choices first:
- **A Variant is named by its `name`**, the one `parseDelver` gives every Variant: "Uruk (Beginner)" for a plain one (its Prefab and its difficulty), "Warden" for a Boss. It is firmer than the difficulty, because a Prefab may have two Variants of one skill (`troopFor` picks among them), and it is already unique over every Prefab's Variants. The Lobby shows it shorter ("Uruk · Beginner", "Uruk · Warden (Boss)").
- **The Floor tier lives on the ref** (`troop.tier`), absent for the default (`DUEL_TROOP_TIER`, 2, or `delver.tiers` if there are fewer). It is part of which enemy you fight, so it goes where the Troop goes: the Seat, the Lineup and the wire, with nothing else to keep in step. A Boss Variant ignores it (its HP is whole), but a tier it names must still be one of `delver.tiers`.

**The ref.** `TroopRef` (in `src/sim/delver/troops.ts`, exported from `sim`):

```ts
interface TroopRef { readonly prefab: string; readonly variant: string; readonly tier?: number }
```

- The AI Seat gains `troop?: TroopRef`, absent on a plain AI Seat, so a Lobby without one is as it was.
- `LineupSlot` gains `troop?: TroopRef`, only on an AI slot, only in Duels. `lobbyLineup` copies it from the Seat in Duels; a Gauntlet's or a Battle's Lineup never names one (their AI Seats are allies or set aside).
- The Seat keeps its own difficulty, Style, Weapon and Size underneath, ignored while `troop` is set, so clearing the Troop gives the Seat back as it was.

**Resolving it.** One pure function, `resolveTroop(tuning, ref)` in `src/sim/delver/troops.ts`, returns `ResolvedTroop`: the Prefab and Variant indices, the Floor's own `TroopTuning` for it, and `body`, `weapon`, `difficulty`, `style`, `relics`, `mods`, `maxHp`, `size` and `tier`. It throws a `RangeError` naming the known ones for an unknown Prefab, a Variant that is not that Prefab's, or a tier out of range. It shares the Delver's own code rather than copying it:
- **The Troop** is `floorTroops(delver).plain[prefab][variant]`: the same `TroopTuning` a Floor's Crowd indexes (`troopOf` in `build`), so its Body, Weapon, difficulty, Style, Relics and Mods are the Floor's by construction.
- **The Mods** are `troopMods(tuning, troop)`, new in `troops.ts`: the fold of the Troop's `mods` and its Relics (`foldMods`). `bubble.ts`'s `troopModsOf` now calls it, so a promoted Soldier and a Duel Troop fold the same way.
- **The HP** is `soldierHp(tuning, troop, scale)`, new in `troops.ts`: a Boss's whole HP, or the Troop's HP times `scale` (template `hpScale` × the tier's `tierHp`), with its Relics' `maxHp` share on top. `deployWarbands` now calls it with the same factors in the same order, so its numbers are bit for bit as before. A Duel passes `scale` = `tierHp[tier - 1]` (a template's `hpScale` is a Warband's, and a Duel has none: 1).
- **The Size** is `sizeOfHp(delver, maxHp)`, as on a Floor.
- **Quirks (Stage 4).** `resolveTroop` is where they go: the Variant's Quirks returned beside the Style (applied by `lineupAis`), and their `body` parts folded into `mods` with the Relics, inside `troopMods`, so the Floor gets them at the same seam. A comment marks the place; nothing is added now.

**The Match.** `MatchConfig` gains one per-Fighter field, as `sizes` is:

```ts
readonly troops?: readonly (DuelTroop | null)[];
interface DuelTroop { readonly body: string; readonly maxHp: number; readonly mods?: Mods }
```

- An entry is null for a Fighter without a Troop. `mods` is absent when the fold is `NO_MODS`.
- The field is absent unless some Fighter has a Troop (`troopsOf`, as `sizesOf`), so a Match with no Troop Seat has the same config, state and hash as before.
- Only Duels take it: `createMatch` refuses it in a Gauntlet or a Battle, and refuses a bad entry (length, HP, Mods).
- The Weapon and Size need no new field: `lineupMatch` puts the Troop's in `weapons` and `sizes`.
- `lineupMatch` (`src/controllers/lineup.ts`) fills it from each slot's `resolveTroop`, and `lineupAis` builds that slot's AI at the Troop's difficulty and Style. Every peer builds the Match from the same Lineup and Tuning Data, so they agree.

**HP and Mods at each Duel's start.** `initialDuel` (`src/sim/match.ts`), which every Duel and Rematch starts from (`freshDuel` calls it), lays each Troop on its Fighter after `createInitialState`: `hp` and `maxHp` the Troop's `maxHp`, and its `mods`. That is what `promotedFighter` does on a Floor: the HP already holds the Relics' `maxHp` share, and the daggers are not moved by Mods.

**The Body.** It is render-only, but it rides in `config.troops` so both peers draw the same one. `fighterBodies` (`src/game.ts`) reads `match.config.troops[i].body` for a Fighter with a Troop, where an AI otherwise gets none and is drawn as a random Body.

**The validators.**
- `src/lobby/messages.ts` (`isSeat`) and `src/net/messages.ts` (`isLineupSlot`) accept an optional `troop`: an object of exactly `prefab` and `variant` (short strings) and an optional whole `tier` from 1 to 9. Anything else is refused.
- `isMatchState` (the resync validator) accepts an optional `config.troops`: one entry per Fighter, each null or `{ body, maxHp > 0, mods? }`, the Mods checked as a Fighter's are.
- Whether the names exist is Tuning Data's to say, as for a Style:
  - `checkLineup` resolves every slot's Troop (`resolveTroop` throws, naming the known ones), and refuses a Troop on a Player slot or outside Duels.
  - The guest's Lobby (`sync.ts`, `valid`) refuses a host state whose Troop does not resolve.

**The Lobby, in dev mode.**
- `LobbyViewContext` gains `dev` (the menu passes `devMode()`; `src/sim` never reads it).
- For the host, with `dev`, each AI Seat row gets a **Troop** select ("(none)", then every Prefab's Variants, from `troopChoices`) and, with a plain Variant, a **Floor tier** select.
- With a Troop set, the row shows a read-only line (`troopLine`: Body, Weapon, HP, tier, Style, Relics) in place of the Style, Weapon and Size selects, whether `dev` is on or not. A guest sees the same line.

**Tests.**
- `troops.test.ts`:
  - `resolveTroop` for "Uruk (Beginner)" at the default, first and last tiers, and for "Wraith Lord" (its Relics, whole HP, Size).
  - It refuses an unknown Prefab, Variant or tier, naming the known ones.
  - `soldierHp` and `troopMods` match what a Floor's Crowd and promotion give the same Troop.
- `match.test.ts`:
  - A Troop's HP, max HP and Mods on Duel 1 and again on Duel 2.
  - A Match with no Troop (and one given `troops: [null, null]`) has no `troops` key and the same hash as before.
  - Refused outside Duels, and for a bad entry.
- `lineup.test.ts`:
  - `lineupMatch` takes the Troop's Weapon, Size, HP, Mods and Body.
  - `lineupAis` takes its difficulty and Style.
  - `checkLineup` refuses an unknown Troop, a Troop on a Player, and one outside Duels.
- `lobby.test.ts`: `lobbyLineup` carries a Seat's Troop in Duels and drops it in a Gauntlet.
- `sync.test.ts`:
  - An online Lobby with a Troop Seat starts the same Match (hash) on both peers.
  - A guest refuses a host's Troop its Tuning Data does not know.
- `messages.test.ts`: the Seat, Lineup and Match validators accept a good `troop` / `troops` and refuse bad shapes.
- `lobbyView.test.ts`: `troopChoices` lists "(none)", "Uruk · Beginner" and "Uruk · Warden (Boss)", and `troopLine` reads the Troop.

### Result
Built 2026-11-26, as the Design above, with these additions and differences.

**Where it lives.**
- `src/sim/delver/troops.ts`:
  - `TroopRef`, `DUEL_TROOP_TIER` and `duelTroopTier`.
  - `resolveTroop`, returning `ResolvedTroop`.
  - `troopLabel`, the Lobby's short name for a Variant.
  - The two shared pieces, `soldierHp` and `troopMods`. `deployWarbands` and `bubble.ts` now call them in place of their own copies; `soldierHp` multiplies in the old order, so every Floor's numbers, goldens and hashes are unchanged.
- `src/sim/match.ts`: `MatchConfig.troops` and `DuelTroop`. `troopsOf` keeps the field absent when no Fighter has a Troop and refuses a bad entry. `initialDuel` lays each Troop's HP and Mods on its Fighter at every Duel's and Rematch's start. Only Duels accept the field: a Gauntlet or a Battle refuses it.
- `src/controllers/lineup.ts`:
  - `LineupSlot.troop` and `slotTroop`.
  - `checkLineup` refuses a Troop that doesn't resolve, one on a Player slot, and one outside Duels.
  - `lineupMatch` fills `weapons`, `sizes` and `troops` from the Troop, and `lineupAis` builds the slot's AI at the Troop's difficulty and Style.
- `src/lobby/lobby.ts`: the AI Seat's `troop`. `lobbyLineup` copies it in Duels only.
- Validators:
  - `src/net/messages.ts`: `isTroopRef`, also used by `src/lobby/messages.ts`; the Lineup slot; the resync's `config.troops`.
  - `src/lobby/sync.ts`: a guest refuses a host Troop its Tuning Data lacks.
  - `PROTOCOL_VERSION` 37 → 38, since the wire format grew.
- The Body: `fighterBodies` in `src/game.ts` reads `config.troops[i].body`.
- The Lobby:
  - `src/play/lobbyView.ts`: `troopChoices`, `troopName`, `troopLine`, the dev-only Troop and Floor tier selects, and `LobbyViewContext.dev`. `src/play/menu.ts` passes `devMode()` for `dev`.

**Not in the plan.**
- **Names.** The Lobby's side list shows the Troop's name ("Uruk · Beginner AI"). In a Duel, the HUD names a Troop Fighter by its Variant ("Uruk (Beginner)", "Wraith Lord") (`src/play/hud.ts`). The first hand check showed "Skilled AI" there: the Seat's own difficulty, which a Troop ignores.

**Differs from the plan.**
- **The Variant is named by its own `name`**, not its difficulty (see the Design). The Lobby still shows "Uruk · Beginner".
- **No Quirks in the Seat's read-only line yet.** They don't exist until Stage 4.
- **No skill tint.** A Duel Troop wears its Team's colour, not `delver.skillTints`. Settled with the user (2026-11-26): a Duel Troop doesn't need it.
- **The Seat's difficulty doesn't apply while a Troop is set.** The host's "AI level" row still sets it, but it only counts again once the Troop is cleared. Settled with the user (2026-11-26): it stays so.

**Checked by hand** (`?dev=1`, a Skirmish on the Library):
- **"Uruk · Beginner".** It is drawn as the Uruk Body with the Sledge Hammer. Its row reads "uruk · Sledge Hammer · 80 HP (Floor tier 2) · Beginner Aggressive · no Relics".
- **"Revenant · Wraith Lord (Boss)".** It is drawn as the Wraith, visibly taller, with the Longsword. Its row reads "300 HP (Boss) · Expert Aggressive · Heavy Gauntlet".
- **Without `dev=1`.** The Lobby has no Troop select.
- **What the tests cover.** The HP, Mods and Size themselves are checked by the tests, since the HUD shows only the Player's HP number.

**For Stage 4 (Quirks).**
- **Data.** `resolveTroop` is the one place a Duel Troop is read from Tuning Data. Add `quirks` to `ResolvedTroop`, from the Variant (or its Prefab) through `floorTroops`' `TroopTuning` once it gains `quirks`.
- **The AI.** `lineupAis` builds a Troop slot's Controller; pass the Quirks there, next to the difficulty and Style, as the Pool AI will take them.
- **The Mods.** Fold the Quirks' `body` parts into `troopMods` (after the Relics). Both the Floor's promotion (`bubble.ts`) and a Duel Troop read it, so they get them at once.
- **What needs no change.** `DuelTroop.mods` and `config.troops` already carry the result. Nothing in the Match, the validators or the Lobby wire needs to change for `body` Quirks. A plain AI Seat's dev-mode Quirks select would be a new optional Seat and slot field, validated like `style`.

### Stage 1: Style minimums
> Done (2026-11-26).

- **Format.** `ai.styles` entries take a number or `{ mul, min }`, both non-negative; `min` is at most 1. The parser (`src/tuning/index.ts`, around `ai.styles`) and the `AiStyle` type follow. `skillOf` applies `clamp(max(min, v × mul), 0, 1)`.
- **Default Style.** Balanced must still be present and empty.
- **Tuning panel.** `tuningPanel.ts` edits both forms.
- **Done:**
  - Every existing Style and difficulty gives the same `Skill` as before (a test over all pairs).
  - A `min` lifts a 0 chance at Beginner.
  - The parser refuses a `min` above 1 or a negative value.

#### Design
Settled 2026-11-26, before any code. The open choice first:
- **A `min` applies only to the settings a Style may name today, `AI_STYLE_KEYS`, and every one of those is a 0..1 chance.** `feintRate` and each of `AI_DIFFICULTY_EXTRAS` is parsed with `fraction` on a difficulty, so a `min` is always a chance in 0..1, and the result is clamped to 0..1 as today. There is no meaning to give a `min` on a setting that isn't a chance, because none is a Style key.
- **`jumpNav` stays out of Styles.** It is the longest jump Link hold (Ticks) the AI will follow, -1 for none: how far it can go, so it is "how well", and `AI_STYLE_KEYS` leaves it out on purpose (with Reaction Time and the mistake rate). A multiplier on it would mean nothing (-1 × 3), and the Delver's Floors and `delverPilot`'s walk mode rely on it as the tier sets it. So a Style can't give the Hopper its `jumpNav` min 10. (Afterwards, the user made Hopper a Quirk, Stage 4, which may.)

**The type.** An entry keeps the form it was written in; a plain number is not normalised:

```ts
/** One Style entry: a multiplier (0 or more), or a multiplier with a minimum: the result is at least `min` (0..1). */
export type AiStyleEntry = number | { readonly mul?: number; readonly min: number };
export type AiStyle = Readonly<Partial<Record<AiStyleKey, AiStyleEntry>>>;
```

- **Why not normalise to `{ mul, min: 0 }`:** the Tuning Data hash is taken over the parsed data (`tuningDataHash`), so normalising would change it although `data/ai.json` doesn't change. The Tuning panel's Save would also rewrite every Style into the long form. Kept as written, every existing Style parses to exactly the object it did.
- **`mul` may be left out** (default 1), so a Style can name a minimum alone, as Stage 3's new settings want (`whirlwindAlone` min 0.5). **`min` may not**: `{ "mul": 2 }` is written `2`, so each meaning has one spelling.
- `styleParts(entry)` (`src/tuning/index.ts`) reads either form as `{ mul, min }` (a number `m` is `{ mul: m, min: 0 }`), and `styleEntry(mul, min)` writes the short form back: the number when `min` is 0, else `{ mul, min }`. `skillOf` and the Tuning panel use them; nothing else reads an entry.

**`skillOf`.** For each Style key with an entry, `skill[k] = min(1, max(0, minOf, skill[k] × mul))`. For a plain number this is `min(1, max(0, 0, v × m))`, the same value as today's `min(1, max(0, v × m))`, bit for bit (`max` with 0 twice is `max` once). Reaction Time, the mistake rate and `jumpNav` are not Style keys, so a Style still never touches them. The `min` applies after the difficulty's defaults are filled in, so it lifts a setting the difficulty leaves out (Beginner's `whirlwindRate`) as well as one it sets to 0 (`chamberRate`).

**The parser** (`parseAi`, `ai.styles.<Style>.<key>`):
- **Accepts** a number 0 or more (as today), or an object with `min` (a number 0..1) and optionally `mul` (a number 0 or more), and no other keys.
- **Refuses**, with these messages:
  - a key outside `AI_STYLE_KEYS`: as today, "`ai.styles.Wary.jumpNav`: a Style scales only feintRate, aggression, ...";
  - a negative number, or a negative `mul`: the existing `nonNegativeNumber` message, "`ai.styles.Wary.caution` must be a number >= 0, got -1" / "`ai.styles.Wary.caution.mul` must be a number >= 0, got -1";
  - a `min` outside 0..1, or not a number: `fraction`'s messages, "`ai.styles.Wary.caution.min` must be between 0 and 1, got 1.1";
  - an object without `min`: "`ai.styles.Wary.caution`: an object entry needs a min (0..1); write a plain multiplier as a number";
  - an object with any other key: "`ai.styles.Wary.caution.max`: a Style entry is a multiplier or { mul, min }";
  - anything else (a string, null, an array): "`ai.styles.Wary.caution` must be a multiplier (a number) or { mul, min }".
- **Balanced** must still be present and empty, as today.
- `battle.soldier.style` (the Battle-only Style) stays multipliers only: it is "as `ai.styles`" for the old form, and nothing needs a minimum there yet.

**The Tuning panel.** Under "Styles", each key a Style names gets two bindings on one row's worth: "<key> ×" (0..3, as today) and "<key> min" (0..1, step 0.005). They edit a proxy `{ mul, min }` from `styleParts`; every change writes `styleEntry(mul, min)` back into the draft, so setting a `min` turns a number into `{ mul, min }`, and setting it back to 0 turns it back into the number. Save writes that form to `data/ai.json`. The panel still can't add a key a Style doesn't name, as today.

**Tests.**
- `tuning.test.ts`: the parser accepts `{ mul, min }` and `{ min }`, keeps a plain number a number, and refuses a `min` above 1 or below 0, a negative `mul`, an object without `min`, an extra key, and a non-number non-object, each by its path; `styleParts` and `styleEntry` round-trip.
- `ai.test.ts`:
  - **Bit for bit:** every bundled Style × every bundled difficulty, `skillOf` equals the old formula (`min(1, max(0, v × m))` over the filled-in preset), compared with `toBe` per key, and the bundled Styles contain no object entry.
  - A `min` lifts Beginner's `chamberRate` 0 to the `min`; with a `mul` it is `max(min, v × mul)` (Expert); `{ min }` alone lifts a setting the difficulty leaves out (Beginner `whirlwindRate`); a `min` never lifts above 1; Reaction Time, the mistake rate and `jumpNav` are untouched by a Style with mins on every key.
- `tuningSections.test.ts`: a `{ mul, min }` entry edited in the draft commits, and the saved `ai.json` reloads to the same Tuning Data.
- `lineup.test.ts`: a Troop Seat (Stage 0) whose Variant plays a Style with a minimum gets that Style's Controller.
- The existing hash, golden, AI memory sweep and Delver tests are left as they are and must pass unchanged.

### Result
Built 2026-11-26, as the Design above.

**Where it lives.**
- `src/tuning/index.ts`: `AiStyleEntry` (`number | { mul?, min }`), `AiStyle` over it, `styleParts` and `styleEntry`, and `parseStyleEntry` inside `parseAi`. A plain multiplier is still parsed to the same number, so the Tuning Data hash and every golden are unchanged.
- `src/controllers/ai.ts`: `skillOf` applies `min(1, max(0, min, v × mul))`. Its doc comment states the contract and that a plain multiplier is the old formula bit for bit.
- `src/editor/tuningPanel.ts`: each Style key now has a "×" and a "min" slider, written back with `styleEntry`.
- `CONTEXT.md`: Style mentions the optional minimum. No new term: "minimum" is used throughout, not "floor", which is the Delver's word.
- Tests: `tuning.test.ts` (parser and `styleParts`/`styleEntry`), `ai.test.ts` (every bundled Style × difficulty against the old formula with `Object.is` per key; what a `min` does), `tuningSections.test.ts` (the panel's draft round trip), `lineup.test.ts` (a Troop Seat whose Variant plays Counter gets the Counter with a minimum).

**Differs from the plan.**
- **No `jumpNav` minimum** (see the Design): a Style still names only chances. So Hopper moved to the Quirks (Stage 4), settled with the user the same day.
- **`{ min }` alone is allowed** (`mul` 1), and `{ mul }` alone is refused.

**Checked by hand** (`?dev=1`, the Editor's Duel sandbox, AI vs AI, yellow Beginner Counter against blue Expert Aggressive, best of 5):
- The Tuning panel's Styles → Counter shows "chamber rate ×" 2.00 and "chamber rate min", set to 0.06; the status reads "AI difficulty: applied (unsaved)".
- **A Beginner Counter still doesn't Chamber, even with min 1, and this is not Stage 1's doing.** Without a minimum, and again with min 1, it made 0 Chambers over the whole Match (a 0–3 loss). Its `chamberRate` is the minimum (the tests show it), but `planDefence` only plans a Chamber when it can still press before the Release: `pressAt = tick − reactionTicks + windUpEnd + CHAMBER_AT − 1 − seen.motionTick > tick`. A Beginner's Reaction Time is 24 Ticks and every Weapon's Wind-up is 16 to 25 Ticks, so by the time it sees a Wind-up begin, the Release has (nearly) come and the check fails before `chamberRate` is rolled. At Skilled (16 Ticks) the minimum does change play (the `lineup.test.ts` Troop test).
- A Troop Seat (Lorekeeper, Counter) takes the Style's minimum through `lineupAis` (`lineup.test.ts`): its Controller is the one `createAiController` builds from the Counter with the minimum, and it plays differently from the bundled Counter. It wasn't checked in the Lobby by hand: the Lobby reads the bundled `data/ai.json`, not the Editor's unsaved edit, and has no event log to count Chambers in.

**For Stage 2.**
- **A Beginner Chambermaster won't Chamber, and that's settled as fine** (the user, 2026-11-26). A Chamber the AI sees too late to time is not planned at all (`pressAt > state.tick`), and a Beginner sees every Wind-up too late. Don't add a "late" Chamber to make it try. The Chamber timing error still applies to the tiers that can Chamber.
- Write the Styles' entries as `{ "mul": 3, "min": 0.06 }`; a minimum alone is `{ "min": 0.5 }`. The bit-for-bit test in `ai.test.ts` names the five old Styles, so adding Styles needs no change to it.

### Stage 2: The data-only Styles, and the Chamber timing error
> Done (2026-11-26).

- **Styles.** Add Chambermaster and Reckless to `data/ai.json` with the starting values above. (Hopper is a Quirk now: Stage 4.)
- **Chamber timing error.** Add it (`CHAMBER_SLOP`, starting at 4 Ticks), rolled only when a Chamber is planned. An AI that never Chambers draws no extra random numbers.
- **Done:**
  - Duels of each new Style against a Balanced AI of the same tier, on the Editor's flat Arena, count the signature move. Chambers and Chains each come out at least 2× Balanced, at every tier, except Chambers at Beginner (none, by Reaction Time; settled with the user).
  - A Skilled Chambermaster lands fewer of its Chambers than an Expert one, which lands most of them. (A Beginner makes none.)
  - The AI memory sweep and the golden tests pass unchanged for the old Styles.

### Result
Built 2026-11-26.

**Where it lives.**
- `data/ai.json`: Chambermaster and Reckless, with the starting values above (Chambermaster's `chamberRate` as `{ "mul": 3, "min": 0.06 }`).
- `src/controllers/ai.ts`: `CHAMBER_SLOP` (4 Ticks) and `chamberSlop()`. `planDefence` moves a planned Chamber's `pressAt` by `round((2u − 1) × CHAMBER_SLOP × mistakeRate)`, never onto or before the Tick it is planned on. The roll is one draw, after the `chamberRate` roll succeeds, and only when the error can round to a whole Tick (`CHAMBER_SLOP × mistakeRate` > 0.5). The spin read's Chamber (`readSpin`) has no error: it isn't rolled with `chamberRate`.
- `CONTEXT.md`: the Style entry names the two new Styles.
- Tests: `src/controllers/aiStyles.slow.test.ts` (new, about 40 s, so in the slow tier): each new Style against Balanced of the same tier on the Editor's flat Arena, 16 seeds × 60 s, nobody dying. `tuning.test.ts` and `tuningSections.test.ts` list the two new Styles.

**Differs from the plan.**
- **The timing error is part of the human feel.** It applies only with `humanMistakes` > 0, so only Beginner, Skilled and Expert have it. Normal (`chamberRate` 0.08, `mistakeRate` 0.18) Chambers too, and without the gate its AI goldens broke; Easy, Normal and Hard stay exactly as they were (CONTEXT.md). An Expert (`mistakeRate` 0.04, at most 0.16 Ticks) draws nothing for it, so Expert play is unchanged. Skilled Counter and Defensive do change: a Skilled AI's Chamber is now off by a Tick about a third of the time.
- **Reckless doesn't double its Chains at Expert.** An Expert Balanced already Chains on about half its Recoveries, and a Blocked Attack recoils with no Recovery, so there aren't twice as many to take. The test asks instead that an Expert Reckless Chains on more than 85% of its Recoveries, and over 1.4× Balanced's share.

**Measured** (16 seeds × 60 s each, against Balanced of the same tier):

| | Beginner | Skilled | Expert |
|---|---|---|---|
| Chambers, Balanced | 1 (none planned) | 11 | 10 |
| Chambers, Chambermaster | 2 (none planned) | 26 of 36 planned (72%) | 25 of 31 planned (81%) |
| Chains, Balanced | 7 | 27 | 86 of 154 Recoveries |
| Chains, Reckless | 17 | 71 | 133 of 147 Recoveries |

- **The timing error is weak at 4 Ticks.** A Skilled AI's error is at most ±0.72 Ticks, so ±1 at most, and a late press still lands in the 9-Tick Chamber window. Skilled lands 72% with it and 75% without; most of the gap to Expert comes from elsewhere. At 12 Ticks a Skilled Chambermaster lands 64% (21 of 33), with Expert unchanged. That's a tuning call for the hand check; it stays at the plan's 4.
- **A Beginner Chambermaster plans no Chamber**, as settled. Its stray Chambers are Attacks that happen to meet a Release.

**Not checked by hand yet.** Play Chambermaster and Reckless on a plain AI Seat at each tier (`?dev=1`) to see that they feel as intended, and whether `CHAMBER_SLOP` should rise.

### Stage 3: Showoff, Skirmisher and Pack Hunter (new AI settings)
- **Settings.** Add `whirlwindAlone`, `throwStanding`, `kite` and `gangUp` to `AiDifficulty`'s extras. Each defaults to 0, so nothing changes. Each is rolled only where its move is possible, so the existing random draws stay the same.
- **Styles.** Add Showoff, Skirmisher and Pack Hunter.
- **Glossary.** Update CONTEXT.md (AI difficulty, Whirlwind): a Style may give Beginner a Whirlwind.
- **Done:**
  - A Showoff spins at a lone standing enemy, and still never toward a drop or through a teammate (the Whirlwind safety tests, run over Showoff).
  - A Skirmisher with daggers throws at a target standing still and keeps out of reach. With none left it closes in.
  - Three Pack Hunters against two enemies put at least two on one target most of the time, where Balanced Expert spreads out.

### Stage 4: Quirks, Dumb and Hopper
- **Data.** Add `ai.quirks` (name → `{ ai?, body? }`). The `body` part may set any Mods key. The `ai` part may name any `AiDifficulty` extra, `defendRate` and `jumpNav`, never Reaction Time or the mistake rate:
  - a number sets it (a chance 0..1; `jumpNav` a whole number of Ticks, -1 or more);
  - `{ mul?, min }` adjusts a chance as a Style entry does, reusing Stage 1's `parseStyleEntry`, `styleParts` and the `skillOf` formula;
  - on `jumpNav`, only `{ min }` (a whole number of Ticks, 0 or more): the result is `max(min, jumpNav)`.
- **Troops.**
  - `delver.troops`: a Prefab and a Variant may name `quirks`, a list of `ai.quirks` names. A Variant's list replaces its Prefab's, and defaults to it.
  - `parseDelver` takes the Quirk names in `DelverNames` and refuses unknown ones.
  - `TroopTuning` gains `quirks`.
- **Controller.**
  - `createAiController` takes the Quirks and applies their `ai` parts after `skillOf`.
  - The Pool AI keys its Controllers by (difficulty, Style, Quirks), not (difficulty, Style).
- **Mods.** A Quirk's `body` part folds into the promoted Fighter's Mods with its Relics, at the same seam: promotion, in `src/sim/bubble.ts` (`foldMods` over the Troop's `mods` and Relics).
- **Dumb.** Add `defendRate` (default 1) and gate `planDefence` and the Kick, dagger and Whirlwind answers on it.
- **Hopper.** Add it to `ai.quirks` with the starting values above. No new AI code: it only changes existing settings.
- **Walk-only AIs.** `delverPilot` and `traitorPilot` force `jumpNav` -1 for their walk mode. That must still win over a Hopper's minimum: apply the Quirks before those overrides, not after.
- **Done:**
  - A Dumb Expert takes every blade Hit from a scripted attacker, and still attacks as an Expert.
  - Duels of a Hopper against the same AI without it, on the Editor's flat Arena, at every tier: jumping Attacks and hops come out at least 2× as often. A Beginner Hopper's `jumpNav` is 10 and an Expert's stays 30.
  - The Map Editor's AI check (`aiwalk=1`) on a few Floors, with a Beginner Hopper, shows no new stuck or fallen legs.
  - A Troop with no Quirks hashes and plays exactly as before.
  - A Quirk the parser doesn't know is refused, with the list of known ones.
  - A Duel Troop Seat (Stage 0) plays its Variant's Quirks. In dev mode, a plain AI Seat's Quirks select adds them.

### Stage 5: Slow (Simulation)
- **Mods.** Add `walkSpeed` and `windUp` to the Relic vocabulary (`RELIC_EFFECTS`, `RELIC_GOOD_LOW` for `windUp`, `NO_MODS`).
- **Walk and Tempo.** `walkSpeed` goes into the ground walk in `step.ts`. `windUp` goes into the Attack Tempo wherever a Fighter's own Motion is timed: the Simulation's Attack phases, `attackTimings` and the drawing.
- **AI reads.** Every AI read of an enemy's Wind-up (`attackTimings` on an Observation) uses that enemy's `windUp`, so it's added to the Observation. An AI facing a Slow enemy then times its Blocks, Chambers and "who lands first" reads correctly, and Ally AIs fighting it do too.
- **Quirk.** Add the Slow Quirk.
- **Done:**
  - A Slow Fighter walks 0.7× and its Wind-up lasts 1.35× (measured in Ticks). Its Release and Recovery are unchanged.
  - Every jump Link a normal Fighter makes, a Slow one makes too (the `jumpLinks` tests, run Slow).
  - An Expert AI Chambers a Slow enemy's Overhead at the right Tick.
  - Rollback, the resync validator and the hash cover the new Mods. A Fighter with `NO_MODS` hashes as before.

### Stage 6: The roster pass
Give the new behaviours to the Delver's Prefabs in `data/delver.json`, then test in the Map Editor and with the AI check (CLAUDE.md). Suggested assignments, to be confirmed with the user:

| Prefab | Style now | Suggested |
|---|---|---|
| Lorekeeper | Counter | Chambermaster |
| Cutthroat | Tricky | Skirmisher |
| Flagellant | Aggressive | Showoff |
| Bruiser | Aggressive | Reckless; Beginner + Dumb |
| Uruk | Aggressive | Reckless + Slow |
| Revenant | Aggressive | Pack Hunter |
| Squire | Defensive | Defensive + Hopper Quirk (at Skilled and Expert) |

**Readability.** Tint shows a Soldier's tier, and nothing yet shows its Style or Quirks. A visible tell (a name shown on promotion, such as "Slow Uruk", or an accessory) is a follow-up, not part of this plan.

## Testing notes
- **Duels.** The AI tests (`src/controllers/ai.test.ts`, `aiWhirlwind.test.ts`) drive Duels on the Editor's flat Arena. The Style counts in Stages 2 and 3 belong there, seeded, as counts over a few thousand Ticks, not exact sequences.
- **Determinism.** Every new roll must draw nothing for an AI whose settings leave that move off. The AI memory sweep (`src/net/aiMemorySweep.test.ts`) and the Delver golden tests then show that old Troops are unchanged.
- **By hand.** Play each new Style and Quirk in a Duel with `?dev=1` (Stage 0): on a plain AI Seat at each tier, then on the Troops of the roster pass. That's the check that it feels as intended, which counts in tests can't show.
- **Delver.** Test the roster pass in the Map Editor and with the AI check, not by playing a Run (`docs/plans/delver.md`, "Testing the generator").
