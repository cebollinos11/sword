# Sword

A web-based 3D melee duelling game with Mount & Blade–style directional attacks and blocks, where combat motion is generated procedurally and tuned in an in-game editor.

## Participants

**Fighter**:
A combatant in a Duel: its body (Skeleton + Weapon) and its combat state (HP, current Action). Its Weapon is chosen before the Match and kept across Duels; in a Run it changes only by equipping another from its Inventory. In a Run it also carries its own `mods` (its equipped Relics folded into one record), which every combat number it deals or takes is read through: the Hit's damage, its Throwing Daggers' count and damage, a Kick's knockdown damage, a Block Impact, its max HP, what it heals on a kill and on a clear, and its ground walk and Attack Wind-up (the pace Mods, the Slow Quirk's). A Player's Fighter holds an Inventory; an Elite enemy's `mods` come from the Relics its Encounter names.
_Avoid_: Player, character, unit

**Controller**:
The source of a Fighter's intents each tick — a human (Local Controller), the AI (AI Controller), or a remote peer (Remote Controller). The Fighter never knows which kind drives it. A Local Controller is fed by mouse/keyboard, on-screen touch pads, or a Gamepad (Standard mapping); those bindings live outside the Simulation and only call into the Local Controller.
_Avoid_: Input, brain, agent

**Player**:
A human taking part in a Match: Player 1 (in Player vs AI, or the host online) or Players 2 to 4 (the guests online, in the order they joined). A Match has at most four. Each drives one Fighter and picks its own Weapon. A guest who leaves mid-Match is replaced by an AI (an AI Takeover); the host leaving ends the Match.
_Avoid_: User; and Player for the Fighter itself

**Team**:
One of the two sides of a Match (team 0, team 1), each fielding 1 to 4 Fighters. Teammates' blades Stagger each other but deal no damage.
_Avoid_: Side (in code), faction, squad

**Lineup**:
Who fights a Match: per Fighter, its Team and what drives it (a Player, or the AI at a difficulty and Style with a Weapon). Online, the host chooses it.
_Avoid_: Roster (that is the Weapon roster), loadout

**Skeleton**:
The Fighter's hierarchy of bones, built from primitives and fully owned by the game so procedural motion can drive it directly.
_Avoid_: Rig, armature, model

**Body**:
How a Fighter is drawn: the bare Skeleton from primitives, or a skinned model (female, monk, prince, brawler, librarian, duelist, snake, wraith, asturian, templar, uruk, croc, tinman, goblin) whose bones are placed on the Skeleton's joints every frame. Each player picks theirs in the menu, and online the Lobby tells every peer what each Member picked; the AIs wear random ones. Render-only: it never changes what the Skeleton does, and it is not part of the Match.
_Avoid_: Skin, character model, avatar

**Size**:
How tall and thick a Fighter is: a height and a thickness, each a multiple of the standard body from 0.6 to 1.4 in steps of 0.05 (1 is standard). Height stretches the Skeleton's bones, the Weapon (its length, grip and head) and the Fighter's collision height; thickness widens the body and its Hit Zones fully, and its collision radius by half as much (so a wide Fighter is not held out of its own Weapon's reach). A Motion's targets are scaled to fit, so a taller Fighter reaches further and a wider one is easier to hit and takes more room. Stats (max HP, walk speed, Jump, damage, Block rules) do not change. Part of the Match, fixed for it and kept across Duels: a Player picks theirs in the menu, the host sets an AI Seat's, a Delver Soldier's follows its final HP (every scale and Relic applied; `delver.sizeHp`: the smallest body at 20 HP or less, the biggest at 150 or more, height and thickness alike, in a line between: docs/plans/delver-troops.md), and online the Lobby tells every peer. In a Battle each Soldier has its own (`CrowdState.sizeHeight`, `sizeThick`), height and thickness drawn apart on a bell curve round the standard body from the Battle's seed (`battle.soldier.sizeSpread`, cut to the range), the same for both armies place for place; a promoted Soldier's Fighter has it, its impostor is stretched to it about its feet, and a Player who takes a Soldier over keeps their own Size (the Soldier takes it on). Absent from a Fighter that is the standard body. Ceilings and Walls judge the real, scaled height; the AI's navmesh is still built for the standard body.
_Avoid_: Scale, build (in code), stature

**Intent**:
What a Controller asks its Fighter to do on a given Tick (move, aim Direction, attack, block). The only thing that crosses the Controller–Fighter boundary, and the only thing sent between peers.
_Avoid_: Command, input (when meaning the abstract request)

**Reaction Time**:
The delay before an AI Controller may act on what it sees of the other Fighters. Together with mistake rate and how much of its repertoire it uses (circling and spacing, pressure, disengaging, punishing openings, punishing a Sheathed enemy (one Sheathed, Sheathing or Drawing cannot Block, so it closes in and swings without Feints), Chains, jumping Attacks, Crouching under swings, Chambers, following jump Links up to a hold (and shortcut ones at any hold), meeting an enemy's Landing, Jumping away from an enemy), it defines AI difficulty (Tuning Data `ai.difficulties`): Easy, Normal or Hard, or their newer counterparts Beginner, Skilled and Expert, the same strength ladder with the exploit fixes on (it reads a low swing's look and Blocks rather than Duck it, breaks a held Wind-up rather than turtle, holds or Feints rather than swing at a target backing out of reach, punishes only an opening its own Wind-up Releases inside, and swings on rather than Feint into a Block when its own Wind-up clearly lands before an enemy's) and teamwork (it flanks an enemy its allies share, takes turns with them, swings at a back turned on an ally, never swings through an ally, and spreads out over the enemies), and with a human feel (it swings on a rhythm rather than a coin flip, now and then notices an Attack a little late, makes human mistakes: a late Block, or one beside the right Direction, varies its spacing and pauses, and hops out of a pincer or round to its flank when the walk is blocked), each a little more often up the ladder. With the Flail the newer tiers also spin up and read a spin, each more up the ladder and only where a Flail is in play: spinning it, it holds the Wind-up toward a share of full charge (`spinHold`) while it has room (its target out of the ball's reach, Staggered, knocked down, Sheathed or facing an ally), lets go early when an enemy Wind-up it sees would land inside the spin it has left or the target steps into the ball's reach open, never stands spinning where only the shaft lands, and lets the spin go into a Block rather than chase forever; facing one, once the charge it sees (Reaction Time ago, from the state, never the drawing) reaches `ai.spinThreat` of full, it reads it (`spinRespect`, rolled once per Attack) and hits first if its own blow lands sooner, Chambers a spin Feinted into a Wind-up it can time, or else steps out of the ball's reach under its Block, rather than stand and Block a Heavy Blow; a tap it meets as any Attack. Skilled and Expert also use and answer a Whirlwind (`whirlwindRate`, `whirlwindRead`; never Beginner or the legacy tiers, except that a Style's minimum gives a Beginner Showoff its Whirlwinds): seeing a hold (Reaction Time ago, from the state), it hits before it can arm if its blow lands in time, or else steps out of reach; seeing a Spin, it interrupts it with a Thrust or a dagger that lands first, or else Blocks its mirrored side, or steps away, never Jumping or Crouching under it. A late notice is only ever later than its Reaction Time, never sooner. Easy, Normal and Hard stay exactly as they were until they are phased out. An AI never Sheathes; taking over a Sheathed Fighter, it Draws once an enemy is near. The one exception is an Ally AI on a Delver Floor: with no enemy (a Team 1 Fighter or Crowd Soldier) within 16 m it Sheathes to run with the party, and Draws once one comes within 12 m or is promoted near it. With several enemies, the AI fights the nearest (or, playing as a team, the one its allies leave free) and defends against the nearest enemy Attack that can reach it. It plays as a team by what it sees of its allies, as of everyone, Reaction Time ago: AIs share no plans. Every Jump it makes is checked against the Simulation's own arc first: it never Jumps where a slightly-off version of the Jump would land somewhere deadly or hurt it.

**Style**:
How an AI fights, chosen apart from its difficulty (which says how well): Balanced (the default, which changes nothing), Aggressive, Counter, Tricky, Defensive, Chambermaster (waits for an Attack and Chambers it), Reckless (swings at once and keeps swinging, Chains, never backs off), Showoff (Whirlwinds often, even at a lone enemy, and Feints), Skirmisher (keeps out of reach and throws its daggers, at a target standing too, and closes in once it has none) or Pack Hunter (joins the enemy its allies fight, as it sees them face it, and stays on it), or Random (picked from the Match seed, or in a Run from the Run seed, so every peer picks the same). Tuning Data `ai.styles`: a multiplier on each of the difficulty's chances it names, optionally with a minimum (`{ mul, min }`: the chance is at least `min`, so a Style's signature move is in use at every tier), never its Reaction Time or mistake rate. A Lobby AI Seat and an Encounter's enemy each name one. A Quirk goes on top of it.
_Avoid_: Personality, behaviour (for the setting), AI type

**Quirk**:
A hard rule on an AI, on top of its difficulty (how well) and its Style (what it prefers): Dumb (never defends: no Block, Duck, Chamber, Outpace or stepping back against a blade Attack, and no answer to a dagger, a Kick or a Whirlwind; it carries on with its own plan) Hopper (leaps in with jumping Attacks, hops round, jumps away and meets Landings more, and follows jump Links held up to 10 Ticks at least, so a Beginner Hopper follows them too) or Slow (walks 0.7× and winds its Attacks up 1.35× as long, its `body` Mods `walkSpeed` and `windUp`; its Release, Recovery, Jumps and flight are anyone's, so it makes every jump a normal Fighter does, and the AIs fighting it read its slower Wind-up). Tuning Data `ai.quirks`: an `ai` part, applied after the Style so a Quirk always wins (a number sets a setting, `{ mul, min }` adjusts a chance as a Style entry does, and on `jumpNav` only `{ min }`; never Reaction Time or the mistake rate), and a `body` part, Mods folded in after a promoted Soldier's Relics (a Duel Troop's too; a plain Duel AI Seat's `body` parts are its Fighter's own Mods, `MatchConfig.fighterMods`). Only a promoted Fighter has them: a Slow Soldier in the Crowd walks with its Warband. A Variant names zero or more (its own list replaces its Prefab's); in dev mode a Lobby AI Seat may too. Not a mistake: Dumb's miss (`defendRate`) is its own roll, and an AI without a Quirk plays exactly as before. A walk-only AI (the Delver pilot online) still follows no jump Link whatever its Quirks.
_Avoid_: Trait, modifier, handicap (for the setting)

## Motion

**Pose Key**:
A timed target for part of the Skeleton (hand position/rotation, torso twist, hip, foot plant, and for a Kick the kicking foot and a whole-body tilt) with an easing curve and a hand path: straight (a Thrust) or an arc round the chest (a swing), so a swing's hands sweep round the body between keys instead of cutting the chord; IK solves the bones to reach it.
_Avoid_: Keyframe, frame

**Guard**:
The pose a Fighter holds when Idle: the first Pose Key of the Idle Motion its Weapon plays (the Weapon's Idle override, or the default). A Pose Key can link any channel to the Guard (written `"idle"` in the Motion file) instead of holding a value of its own; it then takes that channel from the Guard of whichever Weapon plays it, so changing an Idle moves every Motion that starts or ends on guard with it, for that Weapon alone if it is an override. Every Motion that starts or ends on guard links those channels; an Idle links nothing, and every Weapon's Guard must set each channel a Motion it plays links.
_Avoid_: Idle pose, rest pose

**Motion**:
A named sequence of Pose Keys that animates one Action, e.g. the Overhead Attack.
_Avoid_: Animation, clip

**Motion override**:
A Weapon's own version of a default Motion, with the same name (Tuning Data `data/motions/<Weapon file>/`). A Fighter plays its Weapon's override where there is one, the default otherwise. An override keeps the markers its Action needs.
_Avoid_: Variant, weapon animation

**Tempo**:
A Weapon's pace through the Attack Motions: one multiplier each for Wind-up, Release and Recovery (Tuning Data `tempo` in the Weapon file), stretching that phase's playback time without moving any Pose Key, so the pose at each phase boundary stays the authored one (ADR 0016). 1 plays the Motion as authored; 2 takes twice as long. The Longsword is the reference Weapon, at 1 throughout (so is the Quarterstaff). The Arming Sword is a little quicker, the Halberd a little slower and the Sledge Hammer slower still: they change only Wind-up and Recovery, so Release (and with it Blade Speed, damage and the Heavy Blow) plays as authored. Their Wind-up multipliers are a whole number of Ticks over the authored 21-Tick Wind-up (19/21, 23/21 and 25/21), so the held pose and the end of Release fall on a Tick. The Dagger is 0.75 throughout and the Flail 1.1, 1 and 1.2. A Fighter's `windUp` Mod (the Slow Quirk's) lengthens its own Wind-ups on top of its Weapon's Tempo, by whole Ticks, and moves its Release and Recovery along unchanged; every read of an Attack's phases (the Simulation, the drawing, the AI's reads of it) takes it in.
_Avoid_: Motion speed, animation speed

**Motion Blend**:
The short crossfade (Tuning Data `fighter.motionBlend`) from the pose a Fighter was in to a Motion that takes over, so the Skeleton never snaps between Motions (e.g. letting go of a Block). Part of the simulation, so the blade it moves is the blade that hits.
_Avoid_: Transition, tween

**Gait**:
The procedural stepping of a Fighter's legs whenever its body moves over the floor (walking, turning in place, being pushed). It owns the feet while the body moves, so feet never slide, and settles them back where the current Motion puts them when the body stops. A faster walk takes longer strides: up to full walk speed it also steps more often, and beyond it its stride keeps lengthening and its cadence rises only a little, so the hips do not sink into a lunge. From the run speed (`gait.runSpeed`, which only a Sheathed Fighter reaches under its own steam) it runs instead: quick footfalls a fixed time apart, left and right in turn, each foot on the ground only briefly, so both feet are in the air between footfalls and the hips keep their height, up and down a ramp too. A body a Slide carries never runs. It is not a Motion: it runs alongside whatever Action is current.
_Avoid_: Walk animation, walk cycle, locomotion

**Tuning Data**:
All editor-authored data — the Weapon roster, Motions and Motion overrides — stored as files in the repo. Both peers must hold identical Tuning Data to play.
_Avoid_: Config, settings

**Editor**:
The in-game tool for authoring Tuning Data, with live preview and frame-stepping of a Duel.

## Simulation

**Tick**:
One fixed step of the combat simulation. All combat outcomes are decided per Tick; rendering only interpolates between Ticks.
_Avoid_: Frame (frame means a rendered frame)

**Rollback**:
Rewinding the simulation to an earlier Tick when a remote peer's real Intent differs from the predicted one, then re-simulating forward.

**Rollback session**:
One peer's side of a Player vs Player Match: it runs the Match (AI Fighters included, on every peer: ADR 0005), exchanges Intents (a guest with the host only; the host relays each guest's to the others: ADR 0010), predicts and corrects the other Players' Fighters' Intents by Rollback, and compares state checksums with the host's. Not the Room (which only gets the peers connected).

**Input Delay**:
The Ticks between a Player making an Intent and the Tick that plays it, in a Rollback session: online it adapts to the link a Tick at a time (ADR 0030): in a Duel from none on a LAN up to `DUEL_MAX_INPUT_DELAY` (4, 67 ms), in a Battle or a Run from `BATTLE_INPUT_DELAY` (3, 50 ms; ADR 0025) up to `BATTLE_MAX_INPUT_DELAY` (6, 100 ms). The HUD's corner counter shows it. The Intent is sent at once, so it has those Ticks to reach the other peers before they need it, and one that arrives in time is never rolled back; a Battle's Tick (the Crowd and a whole Fighter Pool) is too dear to re-simulate several times a frame. The camera still follows the mouse at once. Each peer's own: peers need not agree on it.
_Avoid_: Input lag, frame delay, buffer

**AI Takeover**:
A guest leaving mid-Match (its link closed, it went silent, or it was refused): from the Tick after the last of its Intents the host holds, an AI Controller (Normal; in a Run an Ally AI) drives its Fighter on every peer, and the Match goes on (ADR 0010). In a Run the Fighter is also marked away at the Takeover Tick on every peer (a Simulation step, so it rolls back and resyncs): it keeps its Inventory and `mods`, but no longer counts at the Stairs and takes no pickup, fire or Reveal; a traitor who leaves leaves its Soldier an ordinary promoted enemy. In a Battle the Player's record is marked away the same way (`BattlePlayer.away`): its Fighter fights on as an ally of its Team with no Bubble, takes over no Soldier when it falls, and counts no more kills. The host announces the Tick; the others roll back to it. The guest stays out of the Match until the next start.
_Avoid_: Bot fill, substitute
_Avoid_: Session (on its own), netcode, connection

## Combat

**Action**:
What a Fighter is doing right now: Idle, Attack, Block, Kick, Whirlwind, Throw, Sheathe, Draw, Stagger, Knockdown, or Fall. A Fighter has exactly one Action at a time.
_Avoid_: State, move, animation

**Wind-up**:
The first phase of an Attack, held for as long as the attack button is held; it reveals the Direction to the opponent.

**Release**:
The phase of an Attack after the button is let go; the only phase in which the Blade Sweep is live.
_Avoid_: Swing phase, active frames

**Recovery**:
The committed phase after Release, before the Fighter can act again. Its Motion first carries the swing on past its line (the follow-through: the blade overshoots, the torso over-rotates, the hips settle) and then eases back to guard. The Blade Sweep is live only up to the pose at the end of Release, so the follow-through can never hit.

**Chain**:
Holding attack during Recovery: the pose blends straight from where it is to the next Attack's held Wind-up pose instead of back to guard, and that Attack starts when Recovery ends. Pose only: Recovery, the Idle Tick after it and the Wind-up last as long as ever. Letting go during Recovery drops the Chain. With a Flail, a Chain held in Thrust is an Overhead, and the Chained Attack starts its Spin-up from no charge.
_Avoid_: Combo, cancel, buffer

**Whiff Chain**:
Pressing attack again during Release, and still holding it as Release ends, with an Attack that has landed nothing (a Blocked one Staggers instead): the Recovery is skipped. After one Tick of Recovery (the last Blade Sweep segment, into the end-of-Release pose, still belongs to the old swing), the next Attack starts in the Direction held as Release ended, its pose blending from the end of the swing straight to its held Wind-up pose, which it reaches on the usual Wind-up Tick. It then holds and Releases like any Attack, and may Whiff Chain again. With a Flail, one held in Thrust is an Overhead, and it starts its Spin-up from no charge. Letting go on that Tick, or a press only in Recovery, gives the ordinary Recovery (or Chain). The AI does not use it yet: it never presses attack during Release.

**Wheel Attack**:
A quick Attack queued by a mouse wheel notch: up for Overhead, down for Thrust. The Local Controller holds attack in that Direction until the Attack starts (at once from Idle, as a Whiff Chain or Chain from a swing's Release or Recovery, or as soon as a Stagger, Kick, Block or the like is over, if within `WHEEL_QUEUE_SECONDS`), then lets go so its Wind-up Releases as soon as it reaches its held pose. Only Intents: the Simulation knows nothing of it. With a Flail, down is an Overhead (it has no Thrust). A newer notch replaces one still waiting; it ignores (and leaves) the aim of mouse gestures, and does nothing while left mouse is held (pressing left mouse drops it).
_Avoid_: Scroll attack, buffered attack

**Stagger**:
A short forced Action in which the Fighter cannot act. Its cause: Hit (being hit, interrupting the victim's Action), Blocked (having an Attack blocked, or its blade stopped by a Wall: the attacker recoils), Chambered (having an Attack Chambered), or Landed (a hard Landing: a crouch the Fighter is open in). A blade Hit's Stagger plays the hit reaction for the side the blow came from, from the Fighter's own view (the Attack's Direction mirrored for Left and Right, as for a Block: a Left swing lands on the right): `StaggerLeft`, `StaggerRight`, `StaggerOverhead` or `StaggerThrust`, the body moving away from the blow. Each lasts as long as `Stagger`, so the Stagger's length never depends on the Direction. A Weapon without that Motion, and a Throwing Dagger Hit, play `Stagger`.
_Avoid_: Stun, flinch, hitstun

**Trade**:
Both Fighters' Attacks landing on the same Tick; both take damage.

**Hit Zone**:
A coarse region of the Skeleton (head, torso, limbs (arms), legs (thigh, shin and foot, thicker than the arms)) with its own damage multiplier and radius. A Fighter in Knockdown has them `fighter.lyingHitFactor` times as thick to blades and Throwing Daggers, as a body lying flat is a low target.
_Avoid_: Hitbox, body part

**Direction**:
One of four attack/block directions: Overhead, Left, Right, Thrust. Chosen by the most recent mouse movement before the attack/block button is pressed; it is read from the Fighter's pose, never from a HUD indicator. A Weapon may lack an Attack Direction (the Flail has no Thrust): an Attack asked for in it is an Overhead, so no press is dead. Every Weapon Blocks in all four.
_Avoid_: Stance, angle

**Attack**:
A directional swing or thrust of the Weapon; it can only hit through the Blade Sweep.
_Avoid_: Strike, swing (as a noun for the whole thing)

**Block**:
A directional defensive Action that stops an Attack when its Direction meets the Attack's (the same for Overhead and Thrust; mirrored for Left and Right, since a swing from the attacker's right arrives on the defender's left) and the defender roughly faces the attacker. Decided by rule, not by blade-on-blade geometry; but a Block lands where the Blade Sweep first reaches the defender's Weapon (anywhere from pommel or butt to tip) or body, so the blades meet (ADR 0002).
_Avoid_: Parry, guard

**Block Impact**:
The give and bounce of a Blocked blow on the defender: the sword hand is knocked back along the Attack, springs forward past the Block and rings down to it (Tuning Data `block.impact*`, scaled by Blade Speed, by the attacker's Weapon's Block Impact dealt and by the defender's Weapon's Block Impact taken). It changes the pose, never the outcome (the Block already decided it), with one exception: a Weapon with a Block Break (see **Block Break**).
_Avoid_: Knockback, recoil (Recoil is the attacker's Stagger)

**Block Break**:
A Weapon's weak Block (Tuning Data `blockImpact.breakAt`, with `breakSlide` and `breakSlideTicks`; the Dagger's only, 0 meaning never for every other Weapon): when a Blocked blow's Block Impact strength on it reaches `breakAt`, the Block still stops the blade (no damage, and the attacker Staggers as from any Block), but its wielder is knocked down, with a Slide of `breakSlide` away from the attacker. The strength compared is the one the Block Impact is given: Blade Speed over the attacker's reference speed (clamped), scaled by the attacker's `dealt`, the defender's `taken` and its Relics' `blockImpactTaken`. So a light or slow blow never breaks it, and the fastest contacts of a Halberd, Sledge Hammer, Quarterstaff or spun Flail swing can (a Longsword and the swords never do). It rides the `Block` event as `broken`. A Throwing Dagger's Block (scaled by `dagger.blockImpact`) never breaks one.
_Avoid_: Guard break (Guard is the Idle pose), Knockback

**Kick**:
An Action in which the Fighter swings its right leg (F). It follows an Attack's phases (Wind-up, Release, Recovery) and is committed: no moving, Blocking, Attacking or Feinting while it lasts, only turning. It lands through a physical leg sweep during Release, at most once, and ignores Blocks and Weapons (ADR 0007). A Kick that misses adds a long extra Recovery. It cannot start while crouched.
_Avoid_: Strike, boot

**Shove**:
The outcome of a Kick on a Fighter who gave no movement input on the contact Tick (Idle, Attacking and Blocking all count), or who is already in Knockdown: 1 damage and a short Slide. It does not interrupt the victim's Action.

**Throwing Dagger**:
Not the Dagger Weapon (`data/weapons/dagger.json`). A small blade each Fighter carries 3 of per Duel (no pickups; a thrown one is gone, but each kill gives its killer one back, never above its full count), thrown with the off (left) hand by a Throw. Once thrown it is a simulated projectile with its own flight, so it can be Blocked, can Stagger, wound and Slow what it hits, and can fell a Fighter (ADR 0008). It passes through its thrower and the thrower's teammates. In flight it homes a little: it turns toward the nearest enemy within 25° of its heading and 20 m, by at most 60° a second, so a near miss becomes a Hit but a Fighter beside or behind it is never chased.
_Avoid_: Knife, projectile, shuriken

**Throw**:
An Action (E key) in which the Fighter takes a Throwing Dagger by its point in its off hand, draws it back behind its head and throws it, the dagger spinning end over end. It follows an Attack's phases (Wind-up, Release, Recovery): the Wind-up takes 0.8 s to reach its held pose and, like an Attack's, holds there while E is held, for up to 2 s, after which the dagger goes by itself. The dagger shows in the hand from the start of the Wind-up, so the opponent can see a throw coming, and leaves it on the first Tick of Release; the whole Throw lasts about 1.25 s unheld. The Fighter can still walk, turn and crouch, but cannot Attack, Block, Kick, Feint or cancel. It starts from Idle, with a dagger left, on the ground or in a Jump. With a two-handed Weapon the off hand lets go of the Off-hand Grip during the Throw.
_Avoid_: Shot, toss

**Whirlwind** (`docs/plans/whirlwind.md`; not yet for the Flail):
An Action (G key) in which the Fighter spins its Weapon round its body: a move every Fighter has in every mode, with no cooldown. Hold G to coil to Left or Right (the last horizontal mouse movement), walking slowly; once held 1 s it is armed, and letting go spins (letting go earlier cancels). The spin is five full turns, each a real Blade Sweep that can hit each Fighter once, driving forward and steered gently by the mouse; crouching lowers the blade, and it can Jump while spinning. A Hit deals half damage and knocks down; a Block of its mirrored side stops that turn and pushes the defender back without Staggering the spinner; an ally is Staggered and pushed aside. Its blade passes through Walls and hits what is beyond (ADR 0029). Any damaging Hit or Kick on the spinner ends it. It meets full Fighters only, never Crowd Soldiers. Everyone sees and hears it: an armed hold glints and flashes, each turn leaves a whirl trail and a rising whoosh. Skilled and Expert AIs use it (standing, toward two or more enemies or one down, or for a Showoff a lone one standing, never along a drop or through a teammate) and answer it; Beginner and the legacy tiers do neither, except a Beginner Showoff, which uses it.
_Avoid_: Spin (the Flail's Spin-up), spin attack, AOE, cleave

**Sheathe**:
An Action (R key, or the Sheathe pad) in which the Fighter puts its Weapon away in its Weapon's slot, on the hip or on the back, leaving it Sheathed. It starts from Idle, on the ground, on the run or in a Jump, and is committed: the Fighter walks (at its drawn speed), turns and crouches, but cannot Jump, Kick, Throw, Attack or Block until it ends. The Weapon changes from hand to slot at the Motion's `swap` marker, and that is the moment the Fighter becomes Sheathed: a Stagger or Knockdown before it leaves the Weapon drawn, one after it leaves it Sheathed. It lasts 0.7 s for a hip slot and 1.0 s for a back slot, and carries on through a ledge Fall and a soft Landing. Its Motion (`SheatheHip` or `SheatheBack`, which a Weapon can override, as the Halberd, the Quarterstaff and the Sledge Hammer do to stand their heads up) brings the sword hand to the slot at `swap`, so the Weapon is drawn in the slot from that Tick without a jump, and it sounds there (steel sliding into the slot). While Sheathed the Fighter stands in the Sheathed Idle (`SheathedIdle`): relaxed, hands empty.
_Avoid_: Holster, stow

**Draw**:
The Action that takes a Sheathed Weapon back into the hand, the reverse of a Sheathe, with the same timing, rules and `swap` marker (the Fighter stops being Sheathed there). R starts it, as does the Sheathe pad (which reads Draw while Sheathed), and so does pressing Attack or Block while Sheathed: there is no quick-draw Attack, the Draw plays in full first. At `swap` it sounds brighter than a Sheathe: steel sliding out, and a ring. It ends on the Guard.
_Avoid_: Unsheathe

**Sheathed**:
A Fighter whose Weapon is put away in its slot (Fighter state `sheathed`). It walks faster (`fighter.sheathedWalkFactor`, multiplying with Crouch, Slow and a Throw's walk), fast enough that its Gait runs, except during a Sheathe or Draw, and a Jump takes off and steers at its drawn walk speed (ADR 0017). It can still Jump, Crouch, Kick and Throw, but cannot Attack or Block, so it has no Blade Sweep, Block or Chamber, and a Knockdown holds no guard. Its sheathed Weapon is render-only: nothing in the Simulation touches it (ADR 0017). While it is Idle and runs forward (the way it faces, at the Gait's run speed or more) it plays the `SheathedRun` Motion in place of its Sheathed Idle: leaning far forward, both arms trailing straight back; sideways, backward, crouched slow or standing it stays upright. Every Duel starts drawn.
_Avoid_: Holstered, stowed

**Slow**:
The effect of a Throwing Dagger Hit: for 3 s the Fighter walks (and steers in the air) at 0.6× speed. A new dagger Hit restarts the timer at the same strength; it does not stack. It multiplies with crouch and recoil, and does not slow turning, Jumps, Slides or Motions.
_Avoid_: Debuff, snare, root

**Knockdown**:
The outcome of a Kick on a Fighter who gave any movement input on the contact Tick, of a Heavy Blow that Hits, of a Block Break, or of any damaging Hit (blade, Throwing Dagger or Kick) on a Fighter in the air, and also the Action that follows: a push away (a long Slide on the ground; in the air, as much speed added to its flight), then the Fighter buckles, sits back and rolls flat onto its back, stays down for a fixed time and gets up (the Get-up). A Kick's Knockdown deals 5 damage. Knocked down in the air, it lies in the air and its time down only starts once it lands: it never gets up before it has landed. Its Landing deals double fall damage, counted from the real top of its arc even after a Jump (ADR 0012). It can Block only from halfway through the Get-up (and not at all while Sheathed: it then holds no guard); throughout it cannot turn, move, Attack, Kick or Jump, and it can be hit normally (a Hit pushes it again but does not restart it). It interrupts whatever the Fighter was doing. While its push lasts, any other Fighter it runs into is knocked down too (a Chain Knockdown).
_Avoid_: Knockback (reserved: see Block Impact), stun

**Chain Knockdown**:
A Fighter in Knockdown that is still being pushed by the blow that knocked it down (a Kick's Knockdown, a Heavy Blow, a Hit in the air, or a Chain Knockdown itself), along the floor in its Slide or through the air in its flight, knocks down any other Fighter it runs into: heights overlapping as body collision has them, the bodies touching, the push driving toward it. The Fighter struck takes a Kick's Knockdown in full (its damage, by the `mods` of the Fighter whose blow started the chain, and its long Slide away from the body that struck it; in the air, as much speed added to its flight) and carries the chain on in turn, so a chain runs through a crowd like dominoes, each Fighter pushed as hard as the first. It never knocks down the Fighter whose blow started the chain (`FighterState.knockedBy`), nor one already down. The starter's teammates go down too, for no damage. A Shove starts none, and a Fighter lying down and Shoved stops carrying one. A kill by a Chain Knockdown is the starter's (`healOnKill`, a Battle's kill count). Event `ChainKnockdown` (ADR 0027). Soldiers in a Battle's Crowd are not Fighters: only promoted ones are struck.
_Avoid_: Domino, bowling, chain reaction (in code)

**Get-up**:
The last phase of a Knockdown: the Fighter sits up, draws its feet in and rises through a crouch to Idle.

**Slide**:
A push the simulation gives a Fighter over a few Ticks, decelerating, along the floor away from the Kicker (or from the attacker of a Heavy Blow). Subject to body collision and arena edges, so a Slide can carry a Fighter off a ledge (ADR 0006). Not Knockback, which names nothing in the game.
_Avoid_: Knockback, pushback

**Feint**:
Cancelling an Attack's wind-up into a different Action: an Attack in another Direction, or a Block. The Direction is the one the Weapon would Attack in: with a Flail, holding Thrust through an Overhead's Wind-up is no Feint. A Flail's Feint into another Direction keeps its Spin-up's charge; a Feint into a Block drops it.

**Chamber**:
Countering an incoming Attack by starting an Attack in the Direction a Block would need (mirrored for Left and Right) early in its Release (within the Chamber window, Tuning Data), roughly facing the attacker. That only makes the Chamber pending: it lands where the blades meet, when the incoming Blade Sweep reaches the chamberer's Weapon (or, failing that, its body) while the chamberer is still in that Attack (ADR 0018). The incoming Attack is then cancelled (its attacker Staggers) and the chamberer's own Attack continues. An Attack that reaches nothing (the chamberer out of its reach) is no Chamber: it whiffs. A Flail cannot Chamber a Thrust (it has no Thrust to answer with: its press is an Overhead), so it Blocks it; the AI does not try.

**Blade Sweep**:
The volume the Weapon's blade traces between ticks; whatever it intersects is hit, unless a Wall stops it first. Hits are physical, never abstract.
_Avoid_: Hitbox, hit check

**Blade Speed**:
The speed of the blade at the point of contact; it scales damage. A Flail's is multiplied by its Spin-up.

**Spin-up**:
The Flail's one rule (Tuning Data `spinUp: { seconds, from, to }` in its Weapon file; no other Weapon has one): holding the Wind-up builds a charge, a count of Ticks in the Attack (`AttackAction.charge`): none as the Attack starts, one more each Wind-up Tick (a Feint's included), full after `spinUp.seconds`, then holding there for as long as the Wind-up is held. It is frozen through Release and Recovery. At contact it multiplies the Blade Speed, from `from` (no charge) rising evenly to `to` (full); a tapped Attack, whose Wind-up already builds about a quarter of full, swings at about 0.88×, weaker than the Motion alone. Damage and the Heavy Blow follow through their usual rules: a quick Release is never a Heavy Blow; a full one is whenever the ball lands on a body (on a Block, only where the ball meets the blade). An Attack Feint keeps it; a Block Feint, a Stagger, a Knockdown and anything else that ends the Attack drop it; a Chain and a Whiff Chain start from none. Simulated only as that count: the whirl the opponent reads it from is drawn and heard (ADR 0026). While the Wind-up builds it the drawn ball whirls on a cone round the shaft's end, faster as the charge builds and on at the top rate while held at full, turning the way its Direction swings, with a whoosh each turn that rises in pitch and level with the charge; it moves onto the simulated ball as Release begins (the ball that is seen is the ball that hits) and hangs from the shaft's end otherwise. The whirl's angle is a closed form of the Tick and the charge (`whirlTurns`), so a scrub, a Rollback or a replay draws and sounds the same whirl. The AI reads a spin from the charge it sees, Reaction Time ago (see **Reaction Time**).
_Avoid_: Charge attack, power-up

**Weapon**:
A data definition of a held weapon: its Grip, length (sword hand to tip), grip or shaft behind the sword hand, damage, reference Blade Speed, Head, how hard its Block Impact hits and is taken, its Heavy Blow (if any), its Tempo, its Spin-up (`spinUp`, the Flail's only) and its sheathe slot (`sheathe.slot`: the left hip for the Arming Sword and the Dagger, the back for the others) where it rides while Sheathed, placed by `sheathe.offset` and `sheathe.rotation` from the pelvis (hip, turning with the hips) or the chest (back, turning with the shoulders). Only the Renderer draws it there. Whether its Head cuts (`cuts`, Dismemberment): every Weapon but the Quarterstaff and the Sledge Hammer (the Flail's spiked ball cuts). The Directions it Attacks in (`attacks`, all four unless it lists fewer, Overhead always among them: the Flail lists Overhead, Left and Right). Its chain (`chain`, metres between the shaft's end and the Head, render-only: only the Flail's look draws it). No shields. In a Run a Player's Fighter may carry several (its Inventory) and wields one: it changes by equipping, in a fight too, but never mid-Action, so a Weapon is never swapped mid-swing. Its effects (`loot.effects`, from the Relic vocabulary: the Arming Sword's less Block Impact taken, the Dagger's dagger damage and one more Throwing Dagger, and so on) fold into a Player's `mods` only while it is wielded, scaled by its Rarity, and its Rarity also multiplies its own Hit's damage (`weaponDamage`). An enemy's Weapon gives it nothing.

**Weapon roster**:
Every Weapon in Tuning Data, one file each (`data/weapons/`): today the Arming Sword (the default), the Dagger, the Flail, the Longsword, the Halberd, the Quarterstaff and the Sledge Hammer. The Dagger is a short (0.45 m) one-handed blade with a curved look that plays the default Motions at a Tempo of 0.75 on every phase, hits for 30 and rides on the left hip; its trade-off is a weak Block that can be broken (Block Break: its Block Impact is dealt 0.7 and taken 1.3, `breakAt` 2.1). It is a different thing from the Throwing Dagger. The Quarterstaff is a plain wooden two-handed staff for crowd control: its whole length is its Head (a contact anywhere forward of the sword hand can be a Heavy Blow), it deals 30 and does not cut, it plays copies of the Halberd's Motion overrides at the unit Tempo (the Halberd's is slower), and its Heavy Blow bar is set low (`heavyBlow.speed` 0.39 of its reference Blade Speed), so most clean swings knock down while a slow or near-hand contact and a Thrust only Stagger. The Flail is a two-handed shaft with a chain and a spiked ball on its end (its Head): rigid in the Simulation, so it sweeps, Blocks and reaches like any Weapon, its chain only drawn (`chain`, render-only). Every Weapon of the roster is loot in a Run (`dungeon.leftOutWeapons` is retired, docs/plans/loot-rarity.md); a Delver enemy's Weapon comes from its Prefab.
_Avoid_: Loadout, inventory

**Grip**:
How a Weapon is held: one-handed (the off hand follows its own Pose Keys) or two-handed (the off hand holds the Off-hand Grip).

**Off-hand Grip**:
The spot on a two-handed Weapon's grip or shaft where the off hand holds it, in the Weapon's own frame (distance back from the sword hand, angle around the axis, distance off it). When the off hand cannot reach it, the Weapon moves toward the off shoulder until it can (ADR 0004).

**Head**:
The striking part of a Weapon, measured back from the tip (the Halberd's axe and spike; the Sledge Hammer's block; all of a sword). A Hit from the Head deals full damage; one from the shaft behind it deals less. Blocks meet anywhere along the Weapon.

**Heavy Blow**:
A contact of a Weapon's Head at or above its Heavy Blow speed (Tuning Data `heavyBlow.speed`, a multiple of the Weapon's reference Blade Speed): today the Halberd's, the Quarterstaff's (a low bar, so it knocks down often), the Sledge Hammer's and a spun-up Flail's (its Spin-up's Blade Speed). A Heavy Blow that Hits an enemy deals its damage and knocks it down, pushing it away (`heavyBlow.knockdownSlide`); one that is Blocked still recoils the attacker, and pushes the defender back a little (`heavyBlow.blockSlide`), its Block holding. A shaft contact is never one, however fast. Weapons without `heavyBlow` have none.
_Avoid_: Knockback

## Match

**Duel**:
One round between two Teams, ending when the last Fighter of a Team falls; the other Team wins it. In a Run, each Duel is a Floor's, and it ends only when Team 0 is wiped out, or when the party takes the last Floor's Stairs.
_Avoid_: Fight, round (as a synonym), match

**Death**:
How a Fighter fell: the Duel Tick its HP reached zero, and its cause: a Hit (and the Hit that did it: a blade, or a Throwing Dagger), a Fall (a Knockdown Landing whose fall damage took its last HP, or a Landing on an Abyss), Lava or Water, even while its Team fights on. From then on the Fighter is no longer simulated, hits and is hit by nothing, and no longer blocks other bodies; its state stays as it fell. In a Run, a fallen Team 0 Fighter sits out the rest of its Hall and is back on the next Hall at `dungeon.revive` of its max HP (at full HP when that Hall is the next Floor's entrance). A blade's felling Hit may also leave the cut (Dismemberment).
_Avoid_: KO, kill

**Dismemberment**:
A killing Overhead, Left or Right that lands with the Head of a Weapon that `cuts` records the cut in the Death: the blade at the moment it struck (between last Tick's blade and this Tick's) and the way it was going. No cut for a Thrust, a Hit with the shaft, the Sledge Hammer, a Throwing Dagger, a Kick, a Fall, Lava or Water. The Simulation only records it (ADR 0024); which parts come off is drawn outside it, a pure function of the Death and the pose it fell in. A bone is severed where the plane the blade was moving in crosses it, within reach of the blade carried on along its travel (Tuning Data `fighter.dismember`: `carry` metres at a Blade Speed of `speed`, at most `maxCuts` bones, the nearest to the contact first): the spine, the neck, an upper arm, a forearm, a thigh or a shin. A bone the blade runs along is not severed, and a cut that crosses none leaves the body whole. The severed bones part the body into pieces; a stump is a cut end. Drawn from the Death's own Tick on (whole on any frame before it), on the bare Skeleton and on every Body model: the model's mesh is cut once along the plane, as it stood on the Death's Tick, each piece follows its own part of the Death Ragdoll, and each cut end is closed with flesh. On the Death's Tick each stump spurts blood out of the cut (silently: the wound's own splatter is the one heard), and for `STUMP_BLEED_SECONDS` (2 s of Duel time) after it the stumps drip as the pieces fall, fewer drops as time goes on; the drops depend only on the time since the Death, so a pause or a scrub back sheds none. A thumbnail and a Soldier's impostor clip always fall whole. The player's **Blood & Gore** setting (title screen and in-game menu, on by default, remembered) turns all of it off, with every other blood effect: no sprays, stains, bloody Weapons or bodies, a Hit bursts in pale chips, and every body falls whole. Render-only: the Death still records its cut, so peers may differ.
_Avoid_: Gore, slice, decapitation (in code)

**Death Ragdoll**:
A fallen Fighter's body going limp and dropping to the floor, knocked away by the blow that felled it, as its hand lets go of the Weapon (a Sheathed Weapon stays in its slot, held to the torso, and falls with it). Drawn outside the Simulation from the Death and the pose it fell in, never changing an outcome, and always the same fall for the same Death (scrubbing, replays and Rollback agree). With severed bones (Dismemberment) it falls in pieces: nothing holds one piece to another, a piece with neither pelvis nor chest (a head, an arm, a leg) keeps its shape and is sent flying, tumbling, along the blade's travel and out from the body, tossed up as it goes and landing a few metres off, faster for a faster blade; the chest's half of a body cut in two is only carried on a little along the travel.
_Avoid_: Death animation, death Motion

**Final Blow Shot**:
When the last Fighter of a Team falls, the view cuts to a camera close to the fallen Fighter (and its killer, if near) that replays the Duel from a moment before the blow (`camera.finalBlowLead`) to a moment after (`camera.finalBlowTail`) in slow motion (`camera.finalBlowSpeed`), spinning slowly around it, letterboxed. Render only: it replays Ticks the game already showed while the Match runs on into the pause before the next Duel (`match.interDuelSeconds`, long enough to hold it), and never changes an outcome. In a Run it plays on the party's wipe (a Defeat).
_Avoid_: Kill cam

**Damage Numbers**:
The damage a Fighter takes, floated up over where it landed for about a second and fading: red when the hurt Fighter is the local Player's, gold for anyone else. Every blow that deals damage counts (Hit, Dagger Hit, Kick, Chain Knockdown, a hurting Landing); a blow that deals none (a Block, a teammate) shows nothing. The player's **Damage Numbers** setting (in-game and title menu, on by default, remembered) turns them off. Render-only, read from each Tick's events: peers may differ.
_Avoid_: Damage popups, floating text

**Camera Shake**:
A short jolt of the player's own camera (third-person, or the orbit camera once fallen): hard when its Fighter is Hit, lightly when it lands a Hit, harder still for a Heavy Blow either way, and hard when it is knocked down by a Kick or hurt by a Landing. It dies away in well under a second, scaled by `camera.shake` (0 turns it off), and never shakes the Final Blow Shot. Render only, like the bursts of red where a Hit lands (bigger and brighter for a Heavy Blow): it follows the Simulation's events, never changes an outcome, and always shakes the same way for the same events.
_Avoid_: Screen shake, hit shake

**Match**:
A best-of-N sequence of Duels between two Teams; the score counts Duels won per Team. In the Gauntlet Format, a Match is a Run instead.

**Format**:
How a Match is played, a Lobby setting: Duels (best-of-N, as it always was), Gauntlet (a Run) or Battle. The Lobby offers Battle in a Skirmish and online alike (`lobbyFormats`); the wire's session list (`SESSION_FORMATS`) and the Lobby's message check (`isLobbyFormatOnMap`: a Battle on any Map the Lobby holds, as it sets the Map aside) both accept it, and a Rollback session plays it (`docs/plans/big-battle.md` Stages 6 and 7). Not the Match Mode, which says which Controllers fight.
_Avoid_: Mode (that is the Match Mode), game type

**Run**:
A Match in the Gauntlet Format (`docs/plans/delver.md`): Team 0, the **party** (one to four Fighters, the Players and any AI allies), goes down the Dungeon Floor by Floor from Floor 1's Entrance, until it is wiped out (a Defeat) or takes the last Floor's Stairs (a Victory). Each Floor is one Duel on its own generated Arena, with its Warbands in the Crowd and the Fighter Pool past the party. HP carries from Floor to Floor as it is: it heals at a fire, in full after each Boss, and the Stairs bring back the fallen. Its Fighters are fixed for the whole Run, and so is the number of humans it started with, which sizes every Warband (`delver.perPlayerSoldiers`, so an AI Takeover never changes a Floor). Only the Players still in the Run (not taken over) count at the Stairs and take a fire, a pickup or the Reveal; the AI allies follow the nearest Player and fight what the Bubble promotes. Players on Team 1 are its **traitors** (online, or a lone Player offline against an all-AI party, for testing). A Run is a pure function of its options, the Lineup and Tuning Data (`data/delver.json`, `data/dungeon.json`): every peer builds each Floor itself. There is no Rematch: a results screen shows the Floor reached, the Warbands and Bosses beaten and each Build. The Lobby offers it in a Skirmish and online. Online it takes a Battle's Input Delay (`BATTLE_INPUT_DELAY`), and each peer sees a **name tag** over the party's other present, living Players (`partyMarkers`), as in a Battle. Its progress is `MatchState.delver` (`RunState`), mirrored on its Duel for the Controllers (`SimState.delver`).
Until docs/plans/delver.md Stage 9 a Run was a walk through a graph of Halls joined by Doors (`docs/plans/dungeon.md`, ADR 0019); that Run is retired.
_Avoid_: Gauntlet (for one playthrough), campaign

**Dungeon**:
The seeded depth a Run goes down: `delver.tiers` tiers of `delver.floorsPerTier` Floors (three of three), a Boss at the end of each tier that names one. Each Floor is a pure function of the Run seed, the Floor number and Tuning Data, generated and judged when it is needed and never stored, so every peer builds the same one with nothing sent.

**Floor**:
One depth of a Dungeon: one generated dungeon of Halls and Passages (`docs/plans/delver.md`), from its Entrance to its Stairs, as many Halls as its tier names (`delver.tierRooms`: 7 on the first tier's three Floors, 10 on the second's, 20 on the last's; without it every Floor has `delver.floor.rooms`), so a Run's Floors grow longer as it goes deeper. It is one Arena (`battle:delver<F>s<S>`), one Duel and one Crowd. Taking its Stairs starts the next after a short fade (`dungeon.fadeSeconds`).
_Avoid_: Level, act, stage, room (Room is the online connection)

**Hall**:
One room of a Floor, an Enclosure the generator placed, with a kind: Entrance, Fight (a post for a Warband), Rest (a fire), Treasure (pedestals on crates), Stairs, Boss or Empty. A Hall may be a great hall, have a Gallery, a split level, a pit or a dais, or be shaped (an L, T, cross or ring) with pillars. Its roof stands 6 m over its floor (`HALL_STOREY`), 8 m with a Gallery, so a full Jump has room; a Passage's 4 m over its higher door. A **fire** is drawn as crossed logs under a flickering flame, which turns to embers once the local Player has taken its heal: each present Player's living Fighter within `delver.fireRadius` heals `dungeon.restHeal` of its max HP, once a fire, and the first to reach it brings back every Player fallen at that moment (once a fire, at `dungeon.restRevive` of max HP, 75%; a Player it brings back takes no heal at that fire).
_Avoid_: Room (the online connection), chamber (a combat term), cell (the generator's grid), node

**Door**:
Retired (docs/plans/delver.md, Stage 9): the exit of a Hall-graph Run's Hall, taken by walking (ADR 0019). A Floor's way down is its Stairs. A Kit still holds its `door` Piece, which no generator places. The doorway in an Enclosure's side (the Map Editor's `doors`) is not one.
_Avoid_: portal, gate

**Encounter**:
A Run's Warband template (`delver.warbands`, per tier): a guard pool, a patrol pool, an elite pool whose templates name Relics, and the tier's Boss Encounter (its Boss Variant and its guard); see Warband. Each template row names a skill (an AI difficulty) and a count, filled from the Floor's Prefabs. The Hall-graph Run's hand-written Encounters of 1 to 4 enemies went with it (docs/plans/delver.md, Stage 9).
_Avoid_: Wave, squad, spawn group

**Relic**:
A passive modifier a Player finds and equips, one of Tuning Data's (`data/relics.json`: a name, an icon and effects from a fixed vocabulary: `damage`, `heavyDamage`, `damageTaken`, `blockImpactTaken`, `daggerDamage`, `kickDamage`, `walkSpeed` and `windUp` as factors, `maxHp` and `healOnClear` as shares, `daggers` and `healOnKill` as counts). The two pace Mods: `walkSpeed` multiplies its Fighter's ground walk (not a Jump's take-off or its flight), and `windUp` its Attack Wind-ups' Ticks on top of its Weapon's Tempo (rounded to whole Ticks; its Release and Recovery play as ever, later), what the Slow Quirk sets. `windUp` is good below 1 (a Rarity scales it further down), `walkSpeed` above. No Relic uses them yet, and a Fighter stores each only while it is not 1, so `mods` without them are as they always were. An equipped Relic's effects fold into its Fighter's `mods` (`foldMods`: factors multiply, the rest add), recomputed at each Floor's start and on each equip; a Relic changes only its own Fighter's numbers. An elite Warband's promoted Soldiers wear the Relics its template names. (`healOnClear` healed on a Hall's clear; a Run has no clear, so it does nothing now.) A Player's equipped Relic folds scaled by its Rarity (`scaleEffects`); an enemy wears its Relics unscaled, as Common. An item is a Weapon, a Relic or a Consumable, held and dropped as an Item.
_Avoid_: Perk, buff, boon

**Consumable**:
An item a Player finds and **uses** once instead of equipping (`docs/plans/delver.md`, Stage 10; Tuning Data `data/consumables.json`: a name, an icon and one effect from a fixed vocabulary): the **Health Potion** (`healFull`: its user to full HP), the **Map** (`revealFloor`: the whole Floor into the Reveal, for the party, this Floor only) and the **Resurrection Stone** (`reviveFallen`: every fallen Team 0 Fighter, AI allies too, back round its user at `dungeon.revive` of max HP, as a fire brings them back (but at the Stairs' share, not the fire's), each kept inside the Hall or Passage piece its user stands in). It takes a Relic slot, never stacks and is never equipped. It is dropped, taken and picked as loot like a Relic (`dungeon.loot.weights.Consumable`). It is used by the Intent's `use`, sent only from the inventory screen's Use control (no key), while Exploring, by a Player's Fighter that still fights and lives, in any Action and in the air: the effect is instant and the item is gone (`ItemUsed`). A use that would do nothing (a Potion at full HP, a Map on a Floor all revealed, a Stone with nobody fallen) is refused and keeps it.
_Avoid_: Potion (for the kind), charge, one-shot

**Item**:
One thing a Player holds or finds in a Run: the Tuning Data name of a Weapon, a Relic or a Consumable, and its Rarity (`Item { name, rarity }`). An Inventory's slots, a pickup, a drop and the `ItemDropped`, `ItemTaken` and `ItemUsed` events all carry Items, so two copies of one Relic at different Rarities are two Items (and stack when both are equipped). A Consumable's Item is always Common. The dev `relics` option and the Lineup's Weapon are names, held as Common Items.
_Avoid_: Loot (the drops as a whole), drop (a Pickup lying on the Floor)

**Rarity** (`docs/plans/loot-rarity.md`):
How good a found Weapon or Relic is: Common (×1), Rare (×1.5) or Legendary (×2), a multiplier on how far each of its effects moves its holder for the better (never a downside), and for a Weapon also on its own Hit's damage (Rare +15%, Legendary +30%). It is rolled with the item from the Run seed (`rollRarity`, by the tier's odds row in `dungeon.loot.rarity.odds`): better deeper, an elite's drops on the next tier's odds, and at least Rare from a Boss or a Treasure pedestal; an elite's or Boss's carried Relic drops at its tier's Rarity (`carriedRarity`, a Boss's one higher), while the Relics it wears stay Common. A Consumable has none (always Common). Every Weapon in the roster is loot. It is shown in its colour (Rare blue, Legendary orange; Common as before): the name, slot and label ("Whetstone · Rare") on the inventory screen with the scaled numbers, the pickup labels and the results Build, a ring and a light under a Rare or Legendary pickup, and an emissive tint on a Player's wielded Weapon (render only, from the simulated inventory, so every peer sees it).
_Avoid_: Tier (a Dungeon tier), quality, level, grade

**Inventory**:
What a Player's Fighter holds in a Run, as Items: up to `dungeon.inventory.weapons` Weapons (one wielded, and a Fighter always keeps one) and `relics` Relics and Consumables together (at most `equippedRelics` Relics equipped, the rest carried; a Consumable is never equipped). It starts as the Weapon the Lineup chose. Items come from pickups lying on the Floor: a wiped Warband's drops for each Player where its last Soldier fell (a pure pick of Run seed, Floor, Warband and Player, weighted by `loot.weights`), a Treasure Hall's `loot.pedestals` for each Player (one of three: taking one closes the other two for that Player), and an item a Player dropped, which any Player may take. A Player sees and takes its own pickups and the shared ones by standing on them, with room to hold them; before that, the one it aims the camera at (else the nearest within reach) is labelled with its name, kind (a Weapon's base damage too) and effects in words, as the inventory screen reads them; a dropper may not take its drop back until it steps off. AI allies take nothing. It changes through the Intent's `equip` and `drop` anywhere on a Floor (not while Descending), but only while the Fighter is Idle, on the ground and alive, so it rolls back like a position; and through `use`, a Consumable's, in any Action. The Local Controller's number keys equip (1 to 3 the Weapons, 4 to 9 the Relics), Shift and a number key only selects (so a carried Weapon can be dropped), X drops the one selected last, and I (or a touch button) opens the inventory screen: slots, what is wielded and equipped, each Relic's and Consumable's effects in words, and equip, use and drop buttons that send the same Intent fields (greyed, with the reason, when the Fighter may not change it now). The screen never takes the Fighter's keys: a Warband may be near.
_Avoid_: Bag, loadout

**Floor Map**:
The screen on `M` (a touch button on phones), open at any time in a Run while the Simulation runs on (`docs/plans/delver.md`, Stage 5): a fog-of-war plan of the Floor, only the Halls and Passages in the **Reveal**, drawn from above as rects scaled to fit (never a Floor's whole plan: unexplored space is empty), each unexplored doorway of a revealed Hall (one whose Passage is not in the Reveal) as a short stub of that Passage fading into the dark (`delverDoorStubs`, `DOOR_STUB_LENGTH` m), the revealed Halls' markers written as names, not icons (`markLabel`: Exit, sealed while the Boss gate is shut; Campfire, faded once its revive is spent; Treasure Room, faded once nothing lies there for the local Player; Boss Room) and a big arrow for each living party Fighter, the local Player's red (a traitor's shows the whole Floor). Both maps are low-resolution pixel art like the rest of the game, a plan inked on dithered parchment with a bitmap font (`render/parchment.ts`). The minimap in the corner of the screen draws the same, in a window round the local Fighter, with the promoted enemies near. Only the maps are fogged: the 3D view draws the whole Floor. Render only: it never changes an outcome.

**Build**:
What a Player's Fighter carries at the end of a Run, listed on the results screen with each item's icon and name: the wielded Weapon and the equipped Relics, the carried Relics and Consumables smaller.

**Benched**:
A Fighter Pool slot bound to no Soldier (a Battle's, or a Run's past the party): out of the Duel. It has 0 HP but no Death, stands at its spawn, is not simulated, hits and is hit by nothing, blocks no bodies, is no AI's target, and counts for neither Team when the Duel ends.
_Avoid_: Empty, disabled, dead (it never fell)

**Battle**:
A Match in the Battle Format: two armies of `battle.armySize` Soldiers each (Tuning Data `data/battle.json`) deployed in Squads (Formations in ranks) facing each other on a Battlefield, fought over five Objectives, ending in a Rout (a Team out of Tickets whose Soldiers have fallen, or the Team behind at the 15-minute limit); the Team that did not rout wins. Its Fighters are its Fighter Pool: the Players' (none in an AI-vs-AI war), then slots its Bubbles bind to Soldiers. Its Duel never ends by its Fighters, only with the Battle. The Battlefield is its Arena, of one of two kinds (ADR 0022): the **open field**, built from its name alone (`battle:<seed>`), an open square field of gentle hills, a heightfield whose grid cells are two flat triangles each (its Walk Surfaces), with no Walls, Kit, Jump Links or Abyss; or a hand-built **Battle map** (`battle:<map>`, Tuning Data `data/battlemaps/<map>.json` from its Blender generator), an Arena of its own on the same 200 m square: its floor's Walk Surfaces, the solid blocks of its walls and towers (a Wall on every side; the Squads' destination fields go round them, and Soldiers walk round them to their places, sliding along one they walk into), its Objectives, Bases and deployment, its own army size (a standard and a most), and no Jump Links. A Battle map may have several levels (raised decks, ramps, a bridge over a tunnel): its Soldiers stand on Walk Surfaces and cross between them only by walking and dropping, and a map whose Walk Surfaces are not every one walked (or dropped) to from every other is refused when it is built. The first is the **Fort**: a ruined fort in the middle of the field, its curtain wall broken by a gatehouse toward each army (Objectives D and E, spawns), a breach on either flank and a smaller one beside each gate, and A and C on the flanks outside. In its courtyard stands the **keep**: a 28 m square block with a deck 4 m up, B on top of it, reached by a ramp up its west face and one up its east face (each 11 m wide), and a 6 m **tunnel** under it from the courtyard's south side to its north, so a Squad crossing between the gatehouses (D and E) may go through it where the field says that is the shorter way. The deck and ramps are Walk Surfaces over no ground and the tunnel is the ground under the deck, so the Fort is a map of several levels: B counts only the Soldiers on the keep, not those in the tunnel under it. Like the open field it is its own half turn, in its Walk Surfaces and Walls too, so neither army is nearer anything. It starts each Team with fewer Tickets a Soldier than the open field (its map file's `ticketsPerSoldier`, 2.4 against 3.5), since its walls, keep and tunnel slow the killing. There is no Rematch: banners for the Rout and the Player's fall, then a results screen (the winner, each army's Tickets left and Objectives held, the Player's kills, the Soldiers taken over, each army left standing, the time) and back to the Lobby. Its HUD shows each army's Tickets (a bar, with a thin strip of its Soldiers under it that carries the Rout mark), a line for what the Player's army is doing ("Your army is attacking B", from its Squads' Orders), the Objectives in the world (a ring in the Owner's colour, a capture arc, a pole with a flag and its letter) and on the minimap (rings, letters, each Squad as an arrow, the Player's own army's with a line to its Objective). In a Skirmish the one Player chooses its Body and Weapon in the Lobby as for a Duel, with a Map row (the open field or the Fort; picking one sets the army size to its standard, and the army size row offers no more than its most) and the army size and fighting speed, and no Seats or Match length. Online, the host picks the Format and each Player picks their Team by their Seat (the Seats say only the Team: an AI Seat fields nobody, and the Map and Match length are set aside); a Rollback session then plays it for up to four Players (its Lineup names only them, slots 0 to 3 of the Pool, at most MAX_TEAM_SIZE a Team, the Players of one Team or of both), and every other Pool slot's Pool AI runs on every peer. Each peer draws from its own Fighter (`session.localFighter`: the camera, the HUD, the minimap turned so its army stands at the bottom) and sees every other Player's Body (the Lobby's, which every peer holds: Bodies need no protocol of their own, only the Weapon travels in the hello) and a **name tag** over their Fighter in their army's colour, with an arrow on the minimap; a Player who has fallen and waits to take over has neither until their new Fighter stands, and one who left has none (its Fighter is an AI's ally now). A Battle's results wait on a guest until the host's Lobby message returns everyone to the Lobby, 8 s after the end.

A Player whose Fighter falls **takes over** an ally. Until `battle.takeover.pickSeconds` (5) after the fall it may choose the Troop it comes back as (cards over the HUD, number keys 1 to the Troops' count, 0 for whichever is nearest; Intent `troop`, kept from one fall to the next in `BattlePlayer.troop`, so its Weapon is the one it picked; to begin with, the Troop that wields the Weapon it chose in the Lobby). Then the Soldier it will take over is chosen: the living ally Soldier of that Troop (of any Troop when none of it is left, or none was chosen) nearest one of its Team's spawns (the spawn Objectives it owns with no enemy on them, and its Base), one in the Crowd or a promoted ally Fighter (`BattlePlayer.next`); `battle.takeover.seconds` (10) after the fall it becomes that Soldier (or, should it be gone, the one nearest a spawn then; a promoted ally as it stands), with that Soldier's Troop's Body and Weapon and `battle.takeover.hp` HP (100, also its max HP, whatever the Soldier had), in the Player's own Pool slot, and plays on. The Player's chosen Fighter lies where it fell to the Battle's end (kept in a free Pool slot, never reused); a taken-over Soldier that falls dies at once (the Rout counts it) and lies in the Crowd. A Player whose army has no living Soldier left is out, and watches from above. Each Player's record (the Soldier it is, the takeovers, its kills: enemy full Fighters whose last blow was its) is plain Battle state (`CrowdState.players`).
_Avoid_: War, siege, skirmish (that is the Lobby's offline mode)

**Soldier**:
A member of a Battle's army that is not a full Fighter: plain data in the Crowd (position, heading, velocity, HP in a Fighter's units, Team, the enemy Soldier it is engaged with, and on a Battle map the Walk Surface it stands on, `CrowdState.surface`), fighting other Soldiers by rule and standing on the Battlefield's ground: on the open field the heightfield, on a Battle map its own Walk Surface, so one in a tunnel stands on the tunnel's floor and not on the bridge over it. Its height is never stored; it follows its Walk Surface. It has no Skeleton and no Blade Sweep, and never targets or damages a full Fighter: it holds outside sword reach of an enemy one (`battle.bubble.hold`). Near a Player it may be promoted to a full Fighter (Promotion), and while promoted it is out of the Crowd. At 0 HP it dies and stops counting. It has a Size of its own (a Fighter's Size), which the Crowd's rules ignore. It is of a Troop, and drawn as an impostor: a billboard of its look (its Troop's Body and Weapon), in its Team's colour (a Delver Soldier: its skill's tint, `delver.skillTints`, grey for Beginner, red for Skilled, black for Expert, on its impostor and its promoted model alike) in a shade of its own (render-only, from its index), baked from that look's own Motions when the Battle is drawn (one atlas per look), stretched about its feet to its Size: up by its height, across from its thickness seen face on to its height seen side on.
_Avoid_: Unit, NPC, Fighter (for a Soldier)

**Troop**:
A kind of Soldier a Battle's armies field (Tuning Data `battle.troops`, at most eight): a name, a weight, one or more Bodies (optionally a different list for each Team, `teamBodies: [team 0's, team 1's]`, a `null` entry meaning the Troop's `bodies`; the same Troop, look and Weapon, only another model), a Weapon, an AI difficulty, and its own Crowd stats (HP, blow damage and hit chance, engage reach) and Mods, each it leaves out the generic soldier's (`battle.soldier`, `battle.crowd`). Each Soldier's Troop, and which of its Bodies it wears (its look), is drawn by weight from the Battle's seed (`CrowdState.troop`, `look`), the same for both armies place for place, and kept when its Squad respawns it. A promoted Soldier fights with its Troop's Weapon, Mods and difficulty; every Troop plays the Battle's one Style. A Player who takes a Soldier over takes its Troop's Body and Weapon. A Battle that names none fields one Troop, the generic soldier. A Delver Floor never fields `battle.troops`: its Troops are the Delver's own, every Variant of every Prefab (`floorTroops`), and the Battles keep their four.
_Avoid_: Unit type, class

**Prefab**:
A kind of Delver enemy (Tuning Data `delver.troops`; docs/plans/delver-troops.md): one Body and one Weapon, so one impostor atlas, and its Variants. No two Prefabs share a Body and Weapon. Each Floor fields `delver.prefabsPerFloor` of them (4), all different, picked from the Run seed and the Floor (`floorPrefabs`) among those whose `minTier` its tier has reached; a Boss Floor's Boss's Prefab comes on top (`floorLooks`). The next Floor picks afresh, so a Prefab may come back. Only a Floor's Prefabs are baked, the next Floor's in the background while it is played.
_Avoid_: Unit, archetype, class

**Variant**:
One version of a Prefab: everything about a Delver Soldier that is not drawn (its HP, its AI difficulty, which is its skill, its Style, Quirks, Relics, Mods and Crowd stats). A Warband template names skills, not Variants: each of its Soldiers is a Variant of that skill of one of the Floor's Prefabs, picked by its Warband and place. A Boss Variant (`boss`) is only ever its tier's Boss, named by the tier. Its Size follows its HP and its tint its skill, so neither is its own.
_Avoid_: Level, rank (rank is a Warband's)


**Crowd**:
All of a Battle's Soldiers (`SimState.crowd`, struct-of-arrays) and the low-rate step that moves and fights them, inside the Tick after the Fighters. Each Soldier steps once every `battle.crowd.stagger` Ticks, 1/stagger of them each Tick, each on the same Tick as its opposite number in the other army. A step pushes it apart from neighbours closer than `separation`, then: an enemy within `engageReach` is engaged (it stands and rolls its blows from the Crowd's own seeded generator; a Tick's blows land together after its steps), and otherwise a Soldier of a Squad steers to its place in the Squad's Formation (only the front rank of a Squad in line walks at an enemy in sight, up to `battle.squad.catchUp` times its pace when out of place). On a Battle map of several levels a Soldier steps by the **walk rule** (ADR 0022): onto the highest ground within `battle.levels.stepUp` of its feet past its Walk Surface's edge, else off an open ledge onto ground at most `battle.levels.drop` below, never through a Wall and never up anything higher (it never jumps), sliding along what stops it; and it sees, pushes apart from and fights only Soldiers of its own level (feet less than `battle.levels.height` apart). Hashed, snapshotted and rolled back like the rest of the state (ADR 0020).
_Avoid_: Horde, mob

**Squad**:
A fixed group of a Battle's Soldiers (`battle.squad.size`, 12; an army fields `floor(armySize / size)` Squads, the remainder folded one each into the last), set at deployment, that moves in a Formation round an anchor. Its state is plain data beside the Crowd (`CrowdState.squads`: anchor, heading, Formation, living count, falling back; and each Soldier's `squad` and `place`), hashed, snapshotted and rolled back with it (ADR 0021). Its brain steps every `battle.squad.brainSeconds` (2 Hz), each Squad on its own Tick by its place in its army: it follows its **Order** from its Team's Commander: it marches to an Objective by that Objective's destination field, to its own place in the circle, and stands there facing the enemy's end, turning to any enemy Soldier within `battle.squad.engage` and standing in line to fight. A Squad down to `battle.squad.moraleThreshold` of its strength falls back, its Soldiers breaking off their fights, toward its **rally point**: the nearest spawn Objective its Team owns with no enemy in its circle (its Home Objective, usually), else its Base. Once there it merges into the nearest other Squad of its Team within `battle.squad.mergeRange` with room (at most `battle.squad.mergeMax` living Soldiers, so a merged Squad may grow past `size`); merged remnants back at half strength rally and march out again, and a remnant that finds nobody to join waits there. A Soldier a Player takes over leaves its Squad; a promoted one keeps its Squad and place (the Squad does not wait for it) and walks back to its place once demoted. A Squad with no living Soldier is empty: `battle.tickets.respawnSeconds` after its brain first sees it so, while its Team has Tickets, it respawns whole at the spawn its Order names (up to `battle.squad.size` of its Team's dead Soldiers, not promoted ones, given back at full HP in column round it). Its Order, destination, the Tick the Order was given and its respawn Tick are plain Squad state (`SquadState.order`, `target`, `since`, `respawnAt`).
_Avoid_: Unit, platoon, group

**Formation**:
The shape of a Squad's places round its anchor, chosen by the situation and never by order: **column** (3 wide) on the march, **line** (6 wide, the first rank the front rank that fights) once an enemy Soldier is within `battle.squad.engage`, **loose** (a spiral) when the Squad is down to `battle.squad.looseBelow` of its strength or falling back. Places are `battle.squad.spacing` apart; the anchor turns at most `battle.squad.turnRate` so the Squad wheels and does not flip, and a Soldier out of place catches up. The rear rank steps up into the gaps the front leaves. In a narrow pass on a Battle map (a gate, a breach) a Formation **narrows** to as many files as the clearance ahead of its anchor holds, keeping `battle.squad.narrow.room` from the walls each side, so a line becomes a column through a gate and opens out beyond it; a place left inside a wall moves in toward the anchor, and a Squad's place at an Objective is one with room for a column (outside a gatehouse's passage). Nothing narrows on the open field.
_Avoid_: Stance, shape (on its own)

**Objective**:
A place on a Battle's map the armies fight over: a circle (`battle.objectives.radius`; a spawn's is wider, `battle.objectives.spawnRadius`, as a Team's respawning Squads gather there) with a weight a Commander values it by, a progress from -1 (Team 1's) to +1 (Team 0's) and an Owner. Every `battle.objectives.captureSeconds` the living Soldiers and full Fighters of each Team inside it are counted (a Player's Fighter counts `battle.objectives.playerCount`, 3), and the progress moves toward the Team with more inside, `battle.objectives.rate` a second for each more, at most `battle.objectives.maxRate`; at ±1 it is owned. While both Teams are inside the Owner keeps it until outnumbered: it is nobody's once the progress crosses 0 against the Owner. The open field has five, from Tuning Data `battle.objectives.openField` (a Battle map places its own): a **Home Objective** for each army between its deployment and the centre, and three across the centre line (left, centre on the highest ground within its `hill` of the middle along the line across the armies, so neither army is nearer it; right). The map places them (`Battlefield.objectives`, static); their progress and Owners are plain Battle state (`CrowdState.objectives`), hashed and rolled back. A map marks some as **spawns**. _Avoid_: Zone (a Door has one), flag, point, control point

**Owner**:
The Team that holds an Objective, or none (-1).

**Home Objective**:
An Objective its map gives a Team at the start (owned by that Team, progress at its end). On the open field each also marks a spawn.

**Ticket**:
One unit of a Team's reserve (`CrowdState.tickets`): `battle.tickets.perSoldier` for each Soldier of its army at the start (3.5 a Soldier, 700 at 200 v 200: tuned so an AI-v-AI Battle lasts about 6 to 8 minutes). A death of a Soldier or full Fighter costs its Team 1, and every second a Team that owns more Objectives than the enemy drains the enemy by `battle.tickets.drain` for each Objective more (linear: owning all five is worth no more per Objective). A Team with none left respawns no Squads, and routs once its living Soldiers fall below `battle.rout.threshold`. At `battle.tickets.limitSeconds` (15 minutes) the Battle is decided: the Team with fewer Tickets routs, on a tie the one that owns fewer Objectives, then a coin from the Crowd's generator. _Avoid_: Reinforcement, life. (An Attack Slot already avoids "ticket" for itself.)

**Commander**:
The simulated AI that gives a Team's Squads their Orders: one per Team, the same rules on every peer, seeing the whole Battle and blind to Players as people (they count only as Soldiers near an Objective). Every `battle.commander.planSeconds` it values each Objective (its weight times `attack`, `retake`, `garrison` or, with a threat of enemy Soldiers near, up to `defend`), then gives free Squads the best Squad-and-Objective pair greedily, less `falloff` for each Squad already sent, `distance` for each metre of the destination field's path, `danger` for enemy Soldiers outnumbering the Team there, plus `stick` for the Objective it is already ordered to. An Order holds at least `battle.commander.holdSeconds` unless the Squad breaks. An empty Squad is ordered to respawn at the spawn nearest what the Commander wants. Its memory is the Squads' Orders (plain state); nothing about it crosses the wire. _Avoid_: General, director, tactician

**Order**:
What a Squad is doing for its Commander: **attack** an Objective its Team does not own, **defend** one it does, or **respawn** (an empty Squad waits to respawn at the spawn it names; one just respawned awaits Orders). A Squad down to its morale threshold falls back whatever its Order. _Avoid_: Task, command

**Base**:
A Team's own end of the map (on the open field `battle.squad.baseDistance` behind the centre along z; a Battle map places its own), where a broken Squad falls back and merges and where its Squads respawn when no spawn Objective suits. It cannot be captured. _Avoid_: HQ, camp

**Destination field**:
A distance field to one place a Squad may head for (an Objective, or a Team's Base) over a coarse grid, built once per map and Tuning Data and kept outside the state (like the navmesh): the Commander reads path lengths from it, and a Squad's anchor steers by it (straight at the point when nothing blocks the line, down the field when something does). Static, so a Rollback never rebuilds it. The open field has no Walls, so no cell is blocked; on a Battle map a cell whose centre a wall or tower covers is blocked, and the anchor walks straight only along a line that keeps clear of them. Each cell also stores its **clearance**, its centre's distance to the nearest wall (none on the open field), which a Formation narrows to. A Soldier that cannot walk straight to its place walks to the furthest point it can reach of the line from its anchor out to its place, and otherwise down the field that leads past its anchor. On a Battle map of several levels a cell where levels overlap holds a node for each (the tunnel's floor and the bridge over it), joined to a neighbouring cell's only where a Soldier walks there by the walk rule (or drops, one way), so each level is led its own way; a node's clearance counts the edges of its level a Soldier cannot step off (a ledge, the foot of higher ground) as walls, so a Formation narrows on a bridge or in a tunnel as in a gate. A Squad's anchor stands on a Walk Surface too, and its places and its spot at an Objective are on its level. Where a thin Wall (a ramp's rail) stands across the field's way from a body's actual place to the next node's centre, the body takes the node of the cells round it that it can walk to with the least way left, and an enemy over such a Wall is not in sight, so it is not contact (a Squad does not walk at one it cannot reach).

**Bubble**:
The region round a Player's Fighter in a Battle where Soldiers become full Fighters: an enemy Soldier within `battle.bubble.promote` of it is promoted into a free Attack Slot, nearest first, and while an enemy holds one, up to `battle.slots.allies` of the Player's allied Soldiers within that distance are promoted too, nearest the slot-holders first, to fight beside them. A promoted Fighter further than `battle.bubble.demote` from every Player's Fighter is demoted. Enemies in it that hold no Attack Slot wait as Soldiers on the waiting ring round the Player. The distance is across the ground, but on a Battle map a Soldier more than `battle.levels.promote` above or below the Player's Fighter is never promoted (nobody is promoted through a floor), and on one of several levels it does not wait on the ring either. It is decided from Simulation positions only, never the camera, so every peer agrees. It moves with the Player; a Player who has fallen, or who has left (an AI Takeover), has none. Overlapping Bubbles share the Fighter Pool: an enemy counts in its nearest enemy Player's Bubble, an ally in its nearest Team-mate's, and while several Bubbles are in use each holds fewer Attack Slots and ally slots (`battle.slots.shared`), so their Players and slots fit the Pool. Past its share, a Bubble's slot-holders farthest from its Player let their slots go, and its farthest allies demote as soon as they may.
_Avoid_: LOD zone, radius

**Attack Slot**:
One of the `battle.slots.enemies` places (fewer while several Bubbles are in use, `battle.slots.shared`) in a Bubble an enemy may hold to fight its Player as a full Fighter (`FighterState.soldier.role` `Attack`). The other enemies in the Bubble wait, the `battle.ring.waiting` nearest at most (the rest fight on in the Crowd): as Soldiers, they steer to spots on the waiting ring just outside sword reach of the Player (`battle.ring`), spaced apart and filled from straight ahead of the Player's way of travel, so the ring closes in front of them; Soldiers of the Player's own Team step out of the path of a full Fighter walking through them (steering only, never collision). A slot frees when its holder falls, demotes, or is engaged by a promoted ally (one within `battle.slots.engaged`, nearer it than the Player; an ally engages one enemy at most): then it is `Waiting`, fights only promoted allies, never a Player, and with none on it goes back to the Crowd as soon as its Action allows. A free slot goes to the nearest waiting enemy, a promoted one first on a tie. A slot-holder's AI chases without giving up.
_Avoid_: Token, ticket

**Promotion / Demotion**:
A Soldier becoming a full Fighter in a Fighter Pool slot, and back: a Simulation step at the start of a Battle's Tick, rolled back like any other (ADR 0020). Promoted, it stands at guard where the Soldier stood, facing its heading, with its Team and HP, its Troop's Weapon and Mods (Relic effects), and a fresh AI of its Troop's difficulty and the Battle-only `battle.soldier.style` started on its first Tick (the slot's Pool AI). It demotes only Idle on the ground (standing or walking, never mid-Attack, Block, Stagger, Knockdown or Fall) and no sooner than `battle.bubble.minPromotedSeconds` after its Promotion, writing its position, heading and HP back to its Soldier (on a Battle map, and the Walk Surface under its feet). One that falls kills its Soldier where it fell, and `battle.bubble.corpseSeconds` later its slot frees, the Soldier lying in the Crowd. Drawn as a short dithered crossfade between the impostor and the full model, with a dust puff.
_Avoid_: Spawn, despawn, LOD switch

**Fighter Pool**:
A Battle's full Fighters (`SimState.fighters`): a fixed `battle.bubble.poolSize` slots, so the state's shape never changes. The Players' Fighters hold the first, for good; every other slot is Benched while unbound, bound to the Soldier it was promoted from (`FighterState.soldier`), or holds a Player's fallen chosen Fighter after a takeover (to the Battle's end). MAX_TEAM_SIZE limits only the Players.
_Avoid_: Active list

**Rout**:
A Team breaking once its Tickets are gone and its living Soldiers fall below `battle.rout.threshold` of the army (the one with fewer left, if both fall on one Tick), or the Team behind when the Battle reaches `battle.tickets.limitSeconds`: its Soldiers stop fighting and flee toward their own edge of the field, and `battle.rout.seconds` later the Battle ends with the other Team's win. There is no hunt for the last stragglers.
_Avoid_: Retreat, surrender

**Rematch**:
A fresh Match (same options, score 0–0) that starts on its own a few seconds after a Match ends; on a Random Map it is fought on the next seed's Generated Arena. Online play always rematches, so the Players stay in the Match until the host restarts it or ends it from the in-game menu (or someone leaves); a Skirmish goes back to its Lobby instead.

**Match Mode**:
Which Controllers fight: Player vs AI (one Player, any AI allies and enemies), Player vs Player (online: two to four Players, as allies or enemies, plus any AIs), or AI vs AI. Each Fighter's Weapon is picked with it (each Player picks their own).

**Arena**:
The space a Duel takes place in, as Tuning Data (`data/arenas/<name>.json`): its Walk Surfaces, Walls and spawns, simulated in the Tick (ADR 0006). A Match is fought in the Arena picked as the Lobby's Map (the host's pick online): the library (three levels, `art/build_library.py`) by default, the carbon-freezing chamber (a ring-shaped platform over Lava, `art/build_chamber.py`), the pirate ship (a deck with a raised quarterdeck and a plank, over Water, `art/build_ship.py`), the snowy summit (a shelf and a plateau holding a crashed starship, on a cliff edge over a valley that is an Abyss, `art/build_summit.py`) or the wasteland train (the roofs of four wagons of a maglev train, each roof bevelled down to its edges, gangways across the gaps between them, the ground far below an Abyss, while the wasteland scrolls past outside the Simulation, `art/build_train.py`), each modelled in Blender, each Fighter starting at its Team's spawn; the Editor keeps a flat circle with no obstacles, where Duels start with the two Teams in facing lines across its centre.

**Walk Surface**:
A floor or ramp of an Arena (or a Battle map) that Fighters, and on a Battle map Soldiers, stand on: a flat (or evenly sloping) convex polygon. A Fighter walks onto a neighbouring one within a step up or down; higher ground is a wall, lower ground a ledge it walks off, and it is solid from below: a Jump under one bumps its head on it. The Walk Surfaces are also the AI's navmesh: shared edges join them, open ledges drop from one to the one below, and jump Links Jump up onto (or across to) one that cannot be walked or dropped to, or up onto one that can only by a longer way round (a shortcut: up onto a mezzanine the ramps also reach), where the Simulation's own arc lands there even when the Jump is made a little off (ADR 0011, ADR 0013). A Battle map's Walk Surface may be a **roof** (`roof: true`, an Enclosure's): Soldiers need never reach it, so the walk check leaves it out, and no Soldier is put down on it nor any Objective or Base stood on it; a Player's Jump gets onto it, and a Fighter standing there stands on it.
_Avoid_: Floor (for the data), navmesh polygon

**Lava**:
A Walk Surface marked deadly: a Fighter that comes to stand on it dies there (a Death by Lava), whatever its HP. Falling into it is the danger of the chamber's open edges.
_Avoid_: Kill zone, hazard

**Water**:
A Walk Surface marked deadly like Lava: a Fighter that comes to stand on it drowns (a Death by Water), whatever its HP. The pirate ship's sea: walking off the plank or jumping over the rail ends there. The AI never paths onto Lava or Water.
_Avoid_: Sea (for the data), kill zone

**Abyss**:
A Walk Surface marked deadly like Lava: ground so far below the fight that a Fighter landing on it dies (a Death by Fall), whatever its HP and however it got there, a Jump included. The summit's valley floor and the ground under the train. The AI never paths onto it or Jumps where it could land on it.
_Avoid_: Void, kill zone, pit

**Wall**:
A vertical stretch of an Arena (a bookcase, a pillar, a balustrade) that no Fighter passes where its height overlaps theirs. A Blade Sweep that reaches one before any Fighter stops there (a Wall Strike): nothing behind it is hit, and the attacker recoils (Stagger, Blocked). A blade already through a Wall when its Release begins strikes it at once: there is no room to swing.

**Generated Arena**:
An Arena built at run time from a Kit, a seed and generator settings, rather than read from `data/arenas/`: a Layout assembled into ordinary Walk Surfaces, Walls and spawns, with an Abyss under it all, and judged with the real navmesh (every spawn reaches every enemy spawn by walking and dropping alone, no deadly ground near a spawn), rerolled until it passes (ADR 0014). Its name records how it was made (`gen:greybox:1234`), so the same name always builds the same Arena. To the Simulation, the AI and the camera it is just another Arena. The Lobby's **Random** Map is one: the host picks the first Match's seed, the Map setting carries the name, each new Match (and Rematch) moves on to the next seed by a fixed step while every Duel of a Match keeps its Arena, and every peer builds the Arena from the name alone (with the default generator settings); the generator's version is part of the Tuning Data hash. (The Hall-graph Run's Hall Arenas, named with their Doors as `gen:<kit>:<seed>:d<n>`, are retired: such a name is refused.)
_Avoid_: Random map, procedural level (for the data)

**Kit**:
A set of Pieces sharing one grid size and set of floor heights, with one look (a theme). Tuning Data (`data/kits/<name>.json`, hashed), built in Blender with its model (`public/models/kits/<name>.glb`) by `art/build_kit_<name>.py`. The first is the grey placeholder `greybox` (3 m cells, floors at 0, 3 and 6 m, 0.8 m crates), plain grey Pieces with no theme.
_Avoid_: Tileset, theme (for the data)

**Piece**:
One placeable part of a Kit (a floor, a ramp, a crate, a pillar, a rail, a bridge, a void with no floor; a `door` too, which no generator places since the Hall Arenas went): its look plus its own Walk Surfaces and Walls, its connectors (where walking crosses its sides, and at what height) and its skirts (how high its ground stands along each side, so a Wall goes under a floor that stands above its neighbour), all relative to its grid cells. Placed on whole cells, turned by quarter turns only.
_Avoid_: Tile, prefab, module

**Layout**:
The Pieces a seed places on the grid (each with its cell, level and quarter turn), before they are assembled into an Arena. The same Kit, seed and settings always give the same Layout.
_Avoid_: Map (the Lobby's pick of Arena), level

**Map Source**:
The editable description of a Battle map (docs/plans/map-editor.md): its Brushes in paint order on a grid (every coordinate a whole number of `grid.step`), the heights they stand at (`levels`), its Objectives, Bases, `front`, army size and Tickets, and a Lobby card (`lobby`: label, where, blurb, art; the compiled map carries it, and the Lobby's map picker shows it, falling back part by part to its own entry for the map), saved as `data/battlemaps/<map>.source.json` beside the map it compiles to (`src/mapEditor/source.ts`). Not Tuning Data: never loaded by `loadTuningData` nor hashed; only the compiled map ships.
_Avoid_: Level file, project

**Brush**:
One shape of a Map Source: a **Floor** (floor at a height), a **Deck** (a raised floor; the floor under it stays), a **Platform** (a solid box: its top is floor, the floor under it is cut out, Walls face it), a **Ramp** (sloped from `lo` to `hi`, the floor under its wedge cut out, a rail or a stepped skirt on each long side), a **Hole** (takes away what the Brushes before it laid at one level; at a Platform's top, the Platform there), a **Hazard** (lava, water or abyss at a height), a **Rail** or **Wall** (a segment), a **Block** (the one-level box of a map's `blocks`, never under a Deck) or an **Enclosure** (a room). A later Brush paints over an earlier one, but a Ramp's wedge and a Block cut out the floor under them whatever the order. Its id (letters, digits and `-`) names what it compiles to.
_Avoid_: Piece (that is a Kit's), prefab

**Enclosure**:
The Brush that is a room (`kind: 'enclosure'`): a rectangle of floor at its level, a roof at the next level up (its ceiling; a Walk Surface tagged `roof`, which Soldiers need never reach and a Player can Jump onto), and a Wall on each side from under its floor to its roof. Each side it names in `doors` has a doorway centred along it, as wide as it says, open `DOOR_HEIGHT` (3 m) over the floor with a lintel above; a side it leaves out is solid. Two doorways opposite and the other sides solid make a corridor. Where two Enclosures meet edge to edge one Wall stands (the earlier Brush's), and a doorway in either opens through it. Its ceiling may name a higher level (`top`), for a tall room. Drawn on the top level it is refused: it has no ceiling.
_Avoid_: Room (that is the online link), Chamber (that is a combat term), Hall (that is a Dungeon's)

**Passage**:
A corridor between two Halls of a generated Delver Floor (`docs/plans/delver.md`), 3 m wide (`delver.floor.passage`), leaving each Hall by a slot (a side's centre; a great hall also has one on each of its two cells' lines along its long sides), both its ends open. It runs **straight** to the facing slot of a Hall on the same lattice line, or **turns** at right angles: an **L** (one corner, round an empty lattice cell to a Hall beside it) or an **S** or **Z** (two corners, its ends parallel and offset, across the gap between lattice lines). Each straight stretch (a **leg**) and each 3 m square **corner** is its own Enclosure, joined to the next by a full-width doorway; together they are its **pieces**, and whatever asks where a Passage is (the Reveal, the maps, drops) asks its pieces. Seen from above no piece comes within 1 m of a Hall or Passage it does not join. A slot holds at most one Passage. The spanning tree's Passages join every Hall; a few more (loops) make the cycles patrols walk. Halls stand at whole levels (2 m each), and a Passage joining doors a level apart is **sloped**: a Ramp along one leg (a straight Passage's only leg, an L's leg at its lower end, an S or Z's middle leg), railed both sides, every corner level. A Passage through a Gallery's wall or a great hall's long side is always flat (the first leaves at the Deck's height).

**Great hall**:
A Hall of a Delver Floor over two neighbouring lattice cells (`docs/plans/delver.md`, Stage 7a): one rect, centred between the two cells, 36 to 44 m long (`delver.floor.great`), 1 or 2 a Floor. A Boss Floor's Boss Hall is always one; the others are Treasure Halls or Fight posts (or Empty when in line with the Entrance), never the Entrance. It has no Gallery.
_Avoid_: big room, double Hall
_Avoid_: corridor (in code), hallway

**Gallery**:
A raised walkway along one wall of its own Hall on a Delver Floor: a Deck 2 m over the Hall's floor, the whole length of the wall but for the Ramp that climbs to it from the floor inside the Hall and a short approach. Its front edge is open: a drop down, and the Floor's only Jump shortcut up (the AI takes it by a shortcut jump Link, `shortcuts: true` on the Floor's map). A **balcony** when nothing leaves through its wall; a **stairwell** when a Passage does, at the Deck's height. A Fight Hall with a long enough Gallery posts its Warband on the Deck. A Gallery Hall's roof is 6 m over its floor, a plain Hall's 4 m. Seen from above it lies inside its Hall, so nothing of a Floor overlaps anything else.
_Avoid_: balcony or stairwell for both, mezzanine, landing

**Stairs**:
The way down from a Delver Floor (`docs/plans/delver.md`, Stage 2): a 4 m square zone at the centre of the Floor's Stairs Hall, the Hall furthest from the Entrance by walking. When every living Player still in the Run (with none alive, every living AI ally) has stood in it for `dungeon.stairsSeconds`, the party goes down: a fade, then the next Floor, everyone at the Entrance and the fallen back at `dungeon.revive` of max HP. The last Floor's Stairs win the Run (a last Boss's wipe does not: the party must still take them). It needs no key and no kill, except on a **Boss Floor** (each tier's last, `delver.floorsPerTier`, when its tier names a Boss): there the Stairs stand in the **Boss Hall** (the Stairs Hall, grown to its largest) and count only once the Boss Warband is wiped, a rule of the Run drawn as a gate of bars round the zone that sinks when it opens (render only). That wipe heals the living party in full and stands the fallen up at the Stairs at full HP; the last tier's Boss wipe does the same, and the Run is won when the party takes that Floor's Stairs.
_Avoid_: exit, portal, door

**Reveal**:
The shared fog of war of a Delver Floor (`docs/plans/delver.md`, Stage 5): which Halls and Passages the party has entered. A place is revealed by entering it: once any present Player's living Fighter stands inside its rect (an AI ally, a Player an AI Takeover has taken and a fallen Fighter reveal nothing; there is no looking into a room from a doorway). It stays revealed for the Floor, and starts as the Entrance Hall alone on each new Floor. A Map (a Consumable) reveals the whole Floor at once. It is a bitset in the Run's state (`RunState.revealed`: bit h Hall h, then a bit a Passage, in 32-bit words), hashed and snapshotted so every peer's map is the same and a resync keeps it; nothing in the Simulation reads it, so it never changes an outcome.
_Avoid_: explored, discovered, fog (the map's look)

**Warband**:
One Squad of a Delver Floor's enemies (`docs/plans/delver.md`, Stage 3): 3 to 12 Team 1 Soldiers of the Crowd, from a tier's guard or patrol template (its skills, how many of each, its HP scale; each Soldier a Variant of that skill of one of the Floor's Prefabs), at a post (a Fight Hall's centre) or on a patrol loop. Each human after the first adds `delver.perPlayerSoldiers` to every Warband; its Soldiers' max HP is scaled by the tier only. Its brain thinks twice a second: **Guard** holds its post facing the way the party comes; **Patrol** walks its loop's points; **Chase**, once one of its Soldiers sees a party Fighter (in sight past the Walls, on its level, within `delver.sight`), follows that Fighter's destination field; **Return** walks home, deaf, when the Leash or `delver.forgetSeconds` unseen ends a Chase, or when it breaks below its morale. A Warband whose Soldiers lag regroups on them. Warbands walk through one another. The Bubble promotes its Soldiers within walking reach of a party Fighter (never through a Wall) into the Fighter Pool; a Soldier never hurts a full Fighter. A wiped Warband stays dead for its Floor, and drops for each present Player, where its last Soldier fell (a Soldier's place, or a promoted one's where its Fighter fell), `dungeon.loot.drops` items picked by (Run seed, Floor, Warband, Player): each Player sees and takes only its own, and the AI allies take none. Its **rank** is plain, **elite** (the deepest filled posts, `delver.elitePosts`, from its tier's elite pool: its promoted Soldiers wear the template's Relics on top of their Variant's, and it drops its first Relic too) or **Boss** (a Boss Floor's, at the Boss Hall: its first Soldier the Boss, of its tier's Boss Variant with its Prefab's Weapon and Body and its own difficulty, Style, Relics and HP (its Size the biggest), no Mods; the Bubble gives it the first free Attack Slot and never demotes it while a Player stands in the Boss Hall). A Treasure Hall holds `loot.pedestals` items for each present Player from the Floor's start, on its three crates, one to take of three. Pickups go with the Floor.
_Avoid_: wave, mob, group, pack

**Traitor**:
A Player on Team 1 of a Delver Run, online or (alone, against an all-AI party) offline (`docs/plans/delver.md`, Stage 8a; `MatchConfig.traitors`), who plays the Warbands against the party. It has no Fighter of its own, only a Pool slot of its own right after the party's, which no Promotion takes. It waits `delver.traitor.respawnSeconds` (plus `respawnStep` per earlier death, at most `respawnMax`), then **takes over** a living Warband Soldier in the Crowd that no party Fighter sees and that is at least `delver.traitor.minDistance` from each of them by walking, picked by (Run seed, Floor, traitor, takeovers so far); never the Boss. The Soldier leaves its Warband (whose wipe still waits on it) and is the traitor's Fighter, with its Troop's Body, Weapon, Mods and HP (the half damage of promoted Soldiers too) and the Soldier's own Size (height and thickness; the traitor's picked Size is unused), until it falls; then it dies at once, back in its Warband, and the traitor waits again, longer. A traitor has no Bubble and no win: it takes no pickup, pedestal or fire, counts at no Stairs, adds no Soldier, and on the Stairs its Soldier stays with the old Floor. It sees the whole Floor on its maps (no Reveal) with an arrow and a name tag for each party Fighter; the party sees it as any promoted Soldier. One who leaves (an AI Takeover) leaves its Soldier an ordinary promoted enemy, a Pool AI's. Its record (the Soldier, deaths, takeovers, next takeover Tick, kills) is Run state (`RunState.traitors`), and the results screen shows its kills and deaths.
_Avoid_: spy, invader, enemy player

**Leash**:
How far (`delver.leash`, m, by walking) a chasing Warband follows from its home (its post, or its loop's nearest point) before it Returns.
_Avoid_: tether, range

**Map Compiler**:
The pure function from a Map Source to an ordinary Battle map (`compileMap`, `src/mapEditor/compile.ts`): it paints the Brushes on the fine grid one level at a time, merges each Brush's floor into rectangles (`WALK_<brush>_<n>`), stands the Walls the generators would (the field's edges, a face wherever the ground beside a floor is higher than a step, owned by the higher Brush, `WALL_<brush>_<side><n>`, each Ramp's rails or skirt, each Enclosure's Walls with their doorways, `WALL_<brush>_<side>d<n>`), and passes the result through the game's own `parseBattleMap` and `walkCheck`, so it never gives a map the game refuses; an error names the Brushes it concerns. The same source always compiles to the same bytes.
_Avoid_: Exporter, baker

**Map Editor**:
The dev route (`#/mapeditor?dev=1`, docs/plans/map-editor.md) that edits a Map Source: a top view of the field where Brushes are drawn, picked, moved and resized on the grid level by level, a panel of their numbers, undo, and Save, which writes the source and the map it compiles to and refuses a source the game would refuse. Its state and operations are `MapEditorSession` (`src/mapEditor/session.ts`). On every edit it compiles and checks the source (`checkMap`, `src/mapEditor/checks.ts`: the game's own walk check, walk rule, destination fields and marker placement run on the compiled draft) and lists what the Simulation will do that the author likely did not mean (an unreachable floor, a drop into lava, a Wall through a destination field's cell centre, an Objective with no floor), each naming its Brushes; overlays show the same in the top view and a 3D view. The Battle's markers are edited there too: Objectives placed and dragged (one dragged on a map of several levels takes the level being edited as its `y`), the Bases, and each Team's front line, with the map's settings and Lobby card; a map saved from it into `data/battlemaps/` is offered by the Lobby with no code change. For speed it has a toolbar (the tools, undo, the levels, mirror mode, the view, Play-test), a right-click menu of what lies under the pointer (a Brush's copy, turn, paint order, level, kind and material; an Objective's spawn, Owner and weight; a prop's kind and turn; on any ground, paste or place a cell, an Objective or a prop), one-click levels (+ adds one a step over the top; a level's chip offers below, between or at a height; a Platform, Ramp or Enclosure drawn where it needs a level above adds it), a side panel that can be hidden, and keys for the rest (`?` lists them). Not the Editor (the Motion Editor).
_Avoid_: Level editor

**Play-test**:
Running the Map Editor's draft as it is now, in memory (no save, no reload), in the Battle routes that already exist, in the same page over the editor: **Spectate** (AI v AI at a chosen speed, with each Objective's Owner and progress and a **stuck heat map** drawn over it), **Play** (the Player's Fighter among the armies) or **Walk** (the Player alone on the map, starting at its middle Objective, no armies). The draft is compiled into a copy of the Tuning Data (`draftTuning`, `src/mapEditor/playtest.ts`), so the Battlefield, destination fields and navmesh are built afresh for it; Back returns to the editor with its session, undo history and cameras as they were. The draft is drawn from its own map model, exported and read back as the game reads a saved one (`setDraftBattleModel`); a map with no model at all is drawn from its Walk Surfaces and Walls (`battleGreybox`).
_Avoid_: preview, test run.

**Map look** (docs/plans/map-editor.md, Stage 5):
How a map made in the Map Editor is drawn, all render-only (never in the compiled map, nor the Tuning Data hash): a **material** per Brush from a small palette (stone, brick, basalt, dungeon, cobble, plaster, tile, wood, grass, dirt, sand, metal, glow; absent, its kind's own: the ground grass, a Deck or Rail wood, the rest stone), its **props** (trees, rubble, banners, crates, torches, each standing on the floor nearest under the level it was placed at; the first eight torches carry a light) and its **sky** (one of the Stage's existing looks: dusk, mystic, sunset, fog, snow, ember), in the Map Source's optional `look` block and each Brush's `material`. The **map model** is generated from the compiled draft and the look (`mapModel`, `src/render/mapModel.ts`): one mesh per material, each named `Map_<Part>` so the game's triplanar texturing reads it (`surfaceOf`); Save exports it as `public/models/arenas/battle_<map>.glb` beside the two JSON files, and the game loads it as any shipped map's. A map whose `data/battlemaps/<map>.source.json` ships has its model (`EDITOR_BATTLE_MAPS`).
_Avoid_: skin, theme

**Quick check**:
The Map Editor's headless run of whole AI-v-AI Battles on a draft (`quickCheck`, `src/mapEditor/quickCheck.ts`; `npm run quick-check -- <map>.source.json`), each on a fixed seed so a rerun gives the same numbers: how long a Battle lasts and how it ends, how often each Objective changes hands, each Team's Tickets every 30 s, and the stall time. Not a Play-test (which is watched or played).

**Mirror mode** (docs/plans/map-editor.md, Stage 6):
The Map Editor's way of building a map that is its own half turn (ADR 0022, x, z → -x, -z), marked `mirror: true` in the Map Source (`src/mapEditor/mirror.ts`). A Brush, Objective or prop placed in it gets its **twin**, its half turn (a Ramp's `up` and rails turned, an Objective's starting Owner and a banner's Team swapped, a prop facing the other way), linked both ways by `twin` (the other's id; its own on one placed on the centre's half turn, which stays centred); twins are edited together, each edit one undo step, and keep side by side in the paint order; `unlink` turns a pair back into two free parts. The two Bases of a mirrored map are twins. The Map Compiler lists a mirrored map's Objectives and Blocks so that k and n - 1 - k are twins and merges its Walk Surfaces so the half turn keeps them, and the checks warn where it is not its own half turn, naming the parts.
_Avoid_: symmetry mode, mirror (alone: the half turn is not a reflection)

**Stuck** (the stuck measure, `StuckMeter`, `src/mapEditor/stuck.ts`):
A Soldier steering to its place, more than two places from it, that has not closed on it by 0.5 m in the last second; counted once it has been so for 3 s. The stuck heat map is the Soldier-seconds by 2 m cell; a measure read from the Match, never state.

**Jump**:
A Fighter standing on the ground, Idle or Blocking, leaping up (Space, or the Jump pad), carrying its walk with it, at its drawn walk speed even when Sheathed (ADR 0017). It Falls until it lands. A tap is a small hop; holding Jump past `fall.jumpBoostDelay` keeps boosting it upward (`fall.jumpBoost`) for up to `fall.jumpBoostTime`, and letting go ends the boost for that Jump. A Jump's Landing deals no fall damage and never Staggers, however deep the drop (only deadly ground, such as an Abyss, kills it), unless the Fighter was knocked down in the air (ADR 0012). How high and far a Jump reaches: `docs/jump-reach.md`.

**Crouch**:
Holding C (not Ctrl, which browsers keep for Ctrl+W) lowers the Fighter's hips and hands by `fighter.crouchDepth`, easing at `fighter.crouchSpeed`, with its feet planted. Not an Action: it combines with Attack, Block and Jump, and while crouched a Fighter walks at `fighter.crouchWalkFactor` of its speed.  Walking backwards (relative to facing) is slower: `fighter.backwardWalkFactor`, blended by how backward the move is. Lowered hips and hands mean lowered Hit Zones and blows.
_Avoid_: Duck, stance (a Crouch is not a Direction)

**Fall**:
The Action of a Fighter in the air, after a Jump or once it has been off the ground for a moment (walked or been pushed off a ledge): arms out, it cannot Attack or Block, but can be hit. It steers a little in the air.
_Avoid_: Airborne (for the Action)

**Landing**:
A Fighter reaching the ground again. After a Jump it is always soft: no fall damage, and a Fall ends in Idle. After walking, sliding or being pushed off a ledge, it is unhurt too: a drop (from the top of its arc) within the safe height is soft, and a deeper one Staggers it (Landed). Only a Fighter in Knockdown takes fall damage: double (`fall.knockdownDamageFactor`) the damage by the metre beyond the safe height, from the real top of its arc, Jump or not, and it stays down. Fall damage can fell the Fighter (a Death by Fall), as can landing on an Abyss (ADR 0012, ADR 0015). A soft Landing that ends a Fall plays `LandSoft` (0.25 s): the hips dip and the torso leans as the legs take the weight. The Fighter is Idle throughout, so it can act at once, and the Idle then carries on as if it had started on the Landing. Its Hit Zones dip with the body, so a blow in that moment can land a little differently. A Sheathed Fighter goes straight to its Sheathed Idle.

**Room**:
A shareable code/link through which Players connect for online play. It stays open as long as its host is in it: guests join (and rejoin), and the Lobby and every Match, restarts included, run over the same connection (the Room link), so a restart never reconnects anyone (ADR 0009).
_Avoid_: session, server

**Lobby**:
Who is in a Room (or a Skirmish) and where they sit, plus the Match settings (Map, Match length), before and between Matches, and in the in-game menu's Match setup. The host owns it and sends it to every guest. Holds up to four Players: a new Room opens three Seats for guests, who join the team fielding fewer Fighters (opposite the host on a tie). A start or a restart is a new generation of the Lobby's Match, played by whoever is seated.
_Avoid_: Room (the connection), Lineup (what a start reads off it)

**Seat**:
A place on a Team in the Lobby (four a Team): Open (a Player may take it), Closed (shown as Empty), an AI (difficulty, Style and Weapon), or a Player. In dev mode an AI Seat may be set to a Delver Prefab's Variant (its **Troop**, with a Floor tier for its HP, `resolveTroop`): in Duels it then fights as that enemy would on a Floor, with its Body, Weapon, HP, Size, Mods, Relics, difficulty and Style, its own settings set aside (docs/plans/enemy-behaviours.md, Stage 0). A Seat with a Troop plays it on every peer, dev mode or not. Moving to another Seat swaps with whatever is there. The Lineup reads the Seats Team by Team.
_Avoid_: Slot (that is the Lineup's)

**Skirmish**:
Player vs AI, set up in its own offline Lobby: you and any AI allies and enemies. Its in-game menu pauses the Match.
_Avoid_: Single player, practice
