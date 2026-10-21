# Sword

A web-based 3D melee duelling game with Mount & Blade–style directional attacks and blocks, where combat motion is generated procedurally and tuned in an in-game editor.

## Participants

**Fighter**:
A combatant in a Duel: its body (Skeleton + Weapon) and its combat state (HP, current Action). Its Weapon is chosen before the Match and kept across Duels.
_Avoid_: Player, character, unit

**Controller**:
The source of a Fighter's intents each tick — a human (Local Controller), the AI (AI Controller), or a remote peer (Remote Controller). The Fighter never knows which kind drives it.
_Avoid_: Input, brain, agent

**Player**:
A human taking part in a Match: Player 1 (in Player vs AI, or the host online) or Players 2 to 4 (the guests online, in the order they joined). A Match has at most four. Each drives one Fighter and picks its own Weapon. A guest who leaves mid-Match is replaced by an AI (an AI Takeover); the host leaving ends the Match.
_Avoid_: User; and Player for the Fighter itself

**Team**:
One of the two sides of a Match (team 0, team 1), each fielding 1 to 3 Fighters. Teammates' blades Stagger each other but deal no damage.
_Avoid_: Side (in code), faction, squad

**Lineup**:
Who fights a Match: per Fighter, its Team and what drives it (a Player, or the AI at a difficulty with a Weapon). Online, the host chooses it.
_Avoid_: Roster (that is the Weapon roster), loadout

**Skeleton**:
The Fighter's hierarchy of bones, built from primitives and fully owned by the game so procedural motion can drive it directly.
_Avoid_: Rig, armature, model

**Body**:
How a Fighter is drawn: the bare Skeleton from primitives, or a skinned model (female, monk, prince, brawler, librarian, duelist, snake, wraith) whose bones are placed on the Skeleton's joints every frame. Each player picks theirs in the menu, and online the Lobby tells every peer what each Member picked; the AIs wear random ones. Render-only: it never changes what the Skeleton does, and it is not part of the Match.
_Avoid_: Skin, character model, avatar

**Intent**:
What a Controller asks its Fighter to do on a given Tick (move, aim Direction, attack, block). The only thing that crosses the Controller–Fighter boundary, and the only thing sent between peers.
_Avoid_: Command, input (when meaning the abstract request)

**Reaction Time**:
The delay before an AI Controller may act on what it sees of the other Fighters. Together with mistake rate and how much of its repertoire it uses (circling and spacing, pressure, disengaging, punishing openings, punishing a Sheathed enemy (one Sheathed, Sheathing or Drawing cannot Block, so it closes in and swings without Feints), Chains, jumping Attacks, Crouching under swings, Chambers, following jump Links up to a hold (and shortcut ones at any hold), meeting an enemy's Landing, Jumping away from an enemy), it defines AI difficulty: Easy, Normal or Hard (Tuning Data `ai.difficulties`). An AI never Sheathes; taking over a Sheathed Fighter, it Draws once an enemy is near. With several enemies, the AI fights the nearest and defends against the nearest enemy Attack that can reach it. Every Jump it makes is checked against the Simulation's own arc first: it never Jumps where a slightly-off version of the Jump would land somewhere deadly or hurt it.

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
A Weapon's pace through the Attack Motions: one multiplier each for Wind-up, Release and Recovery (Tuning Data `tempo` in the Weapon file), stretching that phase's playback time without moving any Pose Key, so the pose at each phase boundary stays the authored one (ADR 0016). 1 plays the Motion as authored; 2 takes twice as long.
_Avoid_: Motion speed, animation speed

**Motion Blend**:
The short crossfade (Tuning Data `fighter.motionBlend`) from the pose a Fighter was in to a Motion that takes over, so the Skeleton never snaps between Motions (e.g. letting go of a Block). Part of the simulation, so the blade it moves is the blade that hits.
_Avoid_: Transition, tween

**Gait**:
The procedural stepping of a Fighter's legs whenever its body moves over the floor (walking, turning in place, being pushed). It owns the feet while the body moves, so feet never slide, and settles them back where the current Motion puts them when the body stops. A faster walk takes longer strides: up to full walk speed it also steps more often, and beyond it (a Sheathed walk) its stride keeps lengthening and its cadence rises only a little, so the hips do not sink into a lunge. It is not a Motion: it runs alongside whatever Action is current.
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

**AI Takeover**:
A guest leaving mid-Match (its link closed, it went silent, or it was refused): from the Tick after the last of its Intents the host holds, an AI Controller (Normal) drives its Fighter on every peer, and the Match goes on (ADR 0010). The host announces the Tick; the others roll back to it. The guest stays out of the Match until the next start.
_Avoid_: Bot fill, substitute
_Avoid_: Session (on its own), netcode, connection

## Combat

**Action**:
What a Fighter is doing right now: Idle, Attack, Block, Kick, Throw, Sheathe, Draw, Stagger, Knockdown, or Fall. A Fighter has exactly one Action at a time.
_Avoid_: State, move, animation

**Wind-up**:
The first phase of an Attack, held for as long as the attack button is held; it reveals the Direction to the opponent.

**Release**:
The phase of an Attack after the button is let go; the only phase in which the Blade Sweep is live.
_Avoid_: Swing phase, active frames

**Recovery**:
The committed phase after Release, before the Fighter can act again. Its Motion first carries the swing on past its line (the follow-through: the blade overshoots, the torso over-rotates, the hips settle) and then eases back to guard. The Blade Sweep is live only up to the pose at the end of Release, so the follow-through can never hit.

**Chain**:
Holding attack during Recovery: the pose blends straight from where it is to the next Attack's held Wind-up pose instead of back to guard, and that Attack starts when Recovery ends. Pose only: Recovery, the Idle Tick after it and the Wind-up last as long as ever. Letting go during Recovery drops the Chain.
_Avoid_: Combo, cancel, buffer

**Stagger**:
A short forced Action in which the Fighter cannot act. Its cause: Hit (being hit, interrupting the victim's Action), Blocked (having an Attack blocked, or its blade stopped by a Wall: the attacker recoils), Chambered (having an Attack Chambered), or Landed (a hard Landing: a crouch the Fighter is open in). A blade Hit's Stagger plays the hit reaction for the side the blow came from, from the Fighter's own view (the Attack's Direction mirrored for Left and Right, as for a Block: a Left swing lands on the right): `StaggerLeft`, `StaggerRight`, `StaggerOverhead` or `StaggerThrust`, the body moving away from the blow. Each lasts as long as `Stagger`, so the Stagger's length never depends on the Direction. A Weapon without that Motion, and a Throwing Dagger Hit, play `Stagger`.
_Avoid_: Stun, flinch, hitstun

**Trade**:
Both Fighters' Attacks landing on the same Tick; both take damage.

**Hit Zone**:
A coarse region of the Skeleton (head, torso, limbs) with its own damage multiplier.
_Avoid_: Hitbox, body part

**Direction**:
One of four attack/block directions: Overhead, Left, Right, Thrust. Chosen by the most recent mouse movement before the attack/block button is pressed; it is read from the Fighter's pose, never from a HUD indicator.
_Avoid_: Stance, angle

**Attack**:
A directional swing or thrust of the Weapon; it can only hit through the Blade Sweep.
_Avoid_: Strike, swing (as a noun for the whole thing)

**Block**:
A directional defensive Action that stops an Attack when its Direction meets the Attack's (the same for Overhead and Thrust; mirrored for Left and Right, since a swing from the attacker's right arrives on the defender's left) and the defender roughly faces the attacker. Decided by rule, not by blade-on-blade geometry; but a Block lands where the Blade Sweep first reaches the defender's Weapon (anywhere from pommel or butt to tip) or body, so the blades meet (ADR 0002).
_Avoid_: Parry, guard

**Block Impact**:
The give and bounce of a Blocked blow on the defender: the sword hand is knocked back along the Attack, springs forward past the Block and rings down to it (Tuning Data `block.impact*`, scaled by Blade Speed, by the attacker's Weapon's Block Impact dealt and by the defender's Weapon's Block Impact taken). It changes the pose, never the outcome (the Block already decided it).
_Avoid_: Knockback, recoil (Recoil is the attacker's Stagger)

**Kick**:
An Action in which the Fighter swings its right leg (F). It follows an Attack's phases (Wind-up, Release, Recovery) and is committed: no moving, Blocking, Attacking or Feinting while it lasts, only turning. It lands through a physical leg sweep during Release, at most once, and ignores Blocks and Weapons (ADR 0007). A Kick that misses adds a long extra Recovery. It cannot start while crouched.
_Avoid_: Strike, boot

**Shove**:
The outcome of a Kick on a Fighter who gave no movement input on the contact Tick (Idle, Attacking and Blocking all count), or who is already in Knockdown: 1 damage and a short Slide. It does not interrupt the victim's Action.

**Throwing Dagger**:
A small blade each Fighter carries 3 of per Duel (no pickups; a thrown one is gone), thrown with the off (left) hand by a Throw. Once thrown it is a simulated projectile with its own flight, so it can be Blocked, can Stagger, wound and Slow what it hits, and can fell a Fighter (ADR 0008). It passes through its thrower and the thrower's teammates.
_Avoid_: Knife, projectile, shuriken

**Throw**:
An Action (E key) in which the Fighter takes a Throwing Dagger by its point in its off hand, draws it back behind its head and throws it, the dagger spinning end over end. It follows an Attack's phases (Wind-up, Release, Recovery): the Wind-up takes 0.8 s to reach its held pose and, like an Attack's, holds there while E is held, for up to 2 s, after which the dagger goes by itself. The dagger shows in the hand from the start of the Wind-up, so the opponent can see a throw coming, and leaves it on the first Tick of Release; the whole Throw lasts about 1.25 s unheld. The Fighter can still walk, turn and crouch, but cannot Attack, Block, Kick, Feint or cancel. It starts from Idle, with a dagger left, on the ground or in a Jump. With a two-handed Weapon the off hand lets go of the Off-hand Grip during the Throw.
_Avoid_: Shot, toss

**Sheathe**:
An Action (R key, or the Sheathe pad) in which the Fighter puts its Weapon away in its Weapon's slot, on the hip or on the back, leaving it Sheathed. It starts from Idle, on the ground, on the run or in a Jump, and is committed: the Fighter walks (at its drawn speed), turns and crouches, but cannot Jump, Kick, Throw, Attack or Block until it ends. The Weapon changes from hand to slot at the Motion's `swap` marker, and that is the moment the Fighter becomes Sheathed: a Stagger or Knockdown before it leaves the Weapon drawn, one after it leaves it Sheathed. It lasts 0.7 s for a hip slot and 1.0 s for a back slot, and carries on through a ledge Fall and a soft Landing. Its Motion (`SheatheHip` or `SheatheBack`, which a Weapon can override, as the Halberd and Sledge Hammer do to stand their heads up) brings the sword hand to the slot at `swap`, so the Weapon is drawn in the slot from that Tick without a jump, and it sounds there (steel sliding into the slot). While Sheathed the Fighter stands in the Sheathed Idle (`SheathedIdle`): relaxed, hands empty.
_Avoid_: Holster, stow

**Draw**:
The Action that takes a Sheathed Weapon back into the hand, the reverse of a Sheathe, with the same timing, rules and `swap` marker (the Fighter stops being Sheathed there). R starts it, as does the Sheathe pad (which reads Draw while Sheathed), and so does pressing Attack or Block while Sheathed: there is no quick-draw Attack, the Draw plays in full first. At `swap` it sounds brighter than a Sheathe: steel sliding out, and a ring. It ends on the Guard.
_Avoid_: Unsheathe

**Sheathed**:
A Fighter whose Weapon is put away in its slot (Fighter state `sheathed`). It walks faster (`fighter.sheathedWalkFactor`, multiplying with Crouch, Slow and a Throw's walk, with longer strides), except during a Sheathe or Draw, and a Jump takes off and steers at its drawn walk speed (ADR 0017). It can still Jump, Crouch, Kick and Throw, but cannot Attack or Block, so it has no Blade Sweep, Block or Chamber, and a Knockdown holds no guard. Its sheathed Weapon is render-only: nothing in the Simulation touches it (ADR 0017). Every Duel starts drawn.
_Avoid_: Holstered, stowed

**Slow**:
The effect of a Throwing Dagger Hit: for 3 s the Fighter walks (and steers in the air) at 0.6× speed. A new dagger Hit restarts the timer at the same strength; it does not stack. It multiplies with crouch and recoil, and does not slow turning, Jumps, Slides or Motions.
_Avoid_: Debuff, snare, root

**Knockdown**:
The outcome of a Kick on a Fighter who gave any movement input on the contact Tick, of a Heavy Blow that Hits, or of any damaging Hit (blade, Throwing Dagger or Kick) on a Fighter in the air, and also the Action that follows: a push away (a long Slide on the ground; in the air, as much speed added to its flight), then the Fighter buckles, sits back and rolls flat onto its back, stays down for a fixed time and gets up (the Get-up). A Kick's Knockdown deals 5 damage. Knocked down in the air, it lies in the air and its time down only starts once it lands: it never gets up before it has landed. Its Landing deals double fall damage, counted from the real top of its arc even after a Jump (ADR 0012). Throughout it can Block (unless Sheathed: it then holds no guard) but cannot turn, move, Attack, Kick or Jump, and it can be hit normally (a Hit pushes it again but does not restart it). It interrupts whatever the Fighter was doing.
_Avoid_: Knockback (reserved: see Block Impact), stun

**Get-up**:
The last phase of a Knockdown: the Fighter sits up, draws its feet in and rises through a crouch to Idle.

**Slide**:
A push the simulation gives a Fighter over a few Ticks, decelerating, along the floor away from the Kicker (or from the attacker of a Heavy Blow). Subject to body collision and arena edges, so a Slide can carry a Fighter off a ledge (ADR 0006). Not Knockback, which names nothing in the game.
_Avoid_: Knockback, pushback

**Feint**:
Cancelling an Attack's wind-up into a different Action: an Attack in another Direction, or a Block.

**Chamber**:
Countering an incoming Attack by starting an Attack in the Direction a Block would need (mirrored for Left and Right) early in its Release (within the Chamber window, Tuning Data), roughly facing the attacker. The incoming Attack is cancelled (its attacker Staggers) and the chamberer's own Attack continues.

**Blade Sweep**:
The volume the Weapon's blade traces between ticks; whatever it intersects is hit, unless a Wall stops it first. Hits are physical, never abstract.
_Avoid_: Hitbox, hit check

**Blade Speed**:
The speed of the blade at the point of contact; it scales damage.

**Weapon**:
A data definition of a held weapon: its Grip, length (sword hand to tip), grip or shaft behind the sword hand, damage, reference Blade Speed, Head, how hard its Block Impact hits and is taken, its Heavy Blow (if any), its Tempo and its sheathe slot (`sheathe.slot`: the left hip for the Arming Sword, the back for the others) where it rides while Sheathed, placed by `sheathe.offset` and `sheathe.rotation` from the pelvis (hip, turning with the hips) or the chest (back, turning with the shoulders). Only the Renderer draws it there. No shields.

**Weapon roster**:
Every Weapon in Tuning Data, one file each (`data/weapons/`): today the Arming Sword (the default), the Longsword, the Halberd and the Sledge Hammer.
_Avoid_: Loadout, inventory

**Grip**:
How a Weapon is held: one-handed (the off hand follows its own Pose Keys) or two-handed (the off hand holds the Off-hand Grip).

**Off-hand Grip**:
The spot on a two-handed Weapon's grip or shaft where the off hand holds it, in the Weapon's own frame (distance back from the sword hand, angle around the axis, distance off it). When the off hand cannot reach it, the Weapon moves toward the off shoulder until it can (ADR 0004).

**Head**:
The striking part of a Weapon, measured back from the tip (the Halberd's axe and spike; the Sledge Hammer's block; all of a sword). A Hit from the Head deals full damage; one from the shaft behind it deals less. Blocks meet anywhere along the Weapon.

**Heavy Blow**:
A contact of a Weapon's Head at or above its Heavy Blow speed (Tuning Data `heavyBlow.speed`, a multiple of the Weapon's reference Blade Speed): today the Halberd's and the Sledge Hammer's. A Heavy Blow that Hits an enemy deals its damage and knocks it down, pushing it away (`heavyBlow.knockdownSlide`); one that is Blocked still recoils the attacker, and pushes the defender back a little (`heavyBlow.blockSlide`), its Block holding. A shaft contact is never one, however fast. Weapons without `heavyBlow` have none.
_Avoid_: Knockback

## Match

**Duel**:
One round between two Teams, ending when the last Fighter of a Team falls; the other Team wins it.
_Avoid_: Fight, round (as a synonym), match

**Death**:
How a Fighter fell: the Duel Tick its HP reached zero, and its cause: a Hit (and the Hit that did it: a blade, or a Throwing Dagger), a Fall (a Knockdown Landing whose fall damage took its last HP, or a Landing on an Abyss), Lava or Water, even while its Team fights on. From then on the Fighter is no longer simulated, hits and is hit by nothing, and no longer blocks other bodies; its state stays as it fell.
_Avoid_: KO, kill

**Death Ragdoll**:
A fallen Fighter's body going limp and dropping to the floor, knocked away by the blow that felled it, as its hand lets go of the Weapon (a Sheathed Weapon stays in its slot, held to the torso, and falls with it). Drawn outside the Simulation from the Death and the pose it fell in, never changing an outcome, and always the same fall for the same Death (scrubbing, replays and Rollback agree).
_Avoid_: Death animation, death Motion

**Final Blow Shot**:
When the last Fighter of a Team falls, the view cuts to a camera close to the fallen Fighter (and its killer, if near) that replays the Duel from a moment before the blow (`camera.finalBlowLead`) to a moment after (`camera.finalBlowTail`) in slow motion (`camera.finalBlowSpeed`), spinning slowly around it, letterboxed. Render only: it replays Ticks the game already showed while the Match runs on into the pause before the next Duel (`match.interDuelSeconds`, long enough to hold it), and never changes an outcome.
_Avoid_: Kill cam

**Camera Shake**:
A short jolt of the player's own camera (third-person, or the orbit camera once fallen): hard when its Fighter is Hit, lightly when it lands a Hit, harder still for a Heavy Blow either way, and hard when it is knocked down by a Kick or hurt by a Landing. It dies away in well under a second, scaled by `camera.shake` (0 turns it off), and never shakes the Final Blow Shot. Render only, like the bursts of red where a Hit lands (bigger and brighter for a Heavy Blow): it follows the Simulation's events, never changes an outcome, and always shakes the same way for the same events.
_Avoid_: Screen shake, hit shake

**Match**:
A best-of-N sequence of Duels between two Teams; the score counts Duels won per Team.

**Rematch**:
A fresh Match (same options, score 0–0) that starts on its own a few seconds after a Match ends; on a Random Map it is fought on the next seed's Generated Arena. Online play always rematches, so the Players stay in the Match until the host restarts it or ends it from the in-game menu (or someone leaves); a Skirmish goes back to its Lobby instead.

**Match Mode**:
Which Controllers fight: Player vs AI (one Player, any AI allies and enemies), Player vs Player (online: two to four Players, as allies or enemies, plus any AIs), or AI vs AI. Each Fighter's Weapon is picked with it (each Player picks their own).

**Arena**:
The space a Duel takes place in, as Tuning Data (`data/arenas/<name>.json`): its Walk Surfaces, Walls and spawns, simulated in the Tick (ADR 0006). A Match is fought in the Arena picked as the Lobby's Map (the host's pick online): the library (three levels, `art/build_library.py`) by default, the carbon-freezing chamber (a ring-shaped platform over Lava, `art/build_chamber.py`), the pirate ship (a deck with a raised quarterdeck and a plank, over Water, `art/build_ship.py`), the snowy summit (a shelf and a plateau holding a crashed starship, on a cliff edge over a valley that is an Abyss, `art/build_summit.py`) or the wasteland train (the roofs of four wagons of a maglev train, each roof bevelled down to its edges, gangways across the gaps between them, the ground far below an Abyss, while the wasteland scrolls past outside the Simulation, `art/build_train.py`), each modelled in Blender, each Fighter starting at its Team's spawn; the Editor keeps a flat circle with no obstacles, where Duels start with the two Teams in facing lines across its centre.

**Walk Surface**:
A floor or ramp of an Arena that Fighters stand on: a flat (or evenly sloping) convex polygon. A Fighter walks onto a neighbouring one within a step up or down; higher ground is a wall, lower ground a ledge it walks off, and it is solid from below: a Jump under one bumps its head on it. The Walk Surfaces are also the AI's navmesh: shared edges join them, open ledges drop from one to the one below, and jump Links Jump up onto (or across to) one that cannot be walked or dropped to, or up onto one that can only by a longer way round (a shortcut: up onto a mezzanine the ramps also reach), where the Simulation's own arc lands there even when the Jump is made a little off (ADR 0011, ADR 0013).
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
An Arena built at run time from a Kit, a seed and generator settings, rather than read from `data/arenas/`: a Layout assembled into ordinary Walk Surfaces, Walls and spawns, with an Abyss under it all, and judged with the real navmesh (every spawn reaches every enemy spawn by walking and dropping alone, no deadly ground near a spawn), rerolled until it passes (ADR 0014). Its name records how it was made (`gen:greybox:1234`), so the same name always builds the same Arena. To the Simulation, the AI and the camera it is just another Arena. The Lobby's **Random** Map is one: the host picks the first Match's seed, the Map setting carries the name, each new Match (and Rematch) moves on to the next seed by a fixed step while every Duel of a Match keeps its Arena, and every peer builds the Arena from the name alone (with the default generator settings); the generator's version is part of the Tuning Data hash.
_Avoid_: Random map, procedural level (for the data)

**Kit**:
A set of Pieces sharing one grid size and set of floor heights, with one look (a theme). Tuning Data (`data/kits/<name>.json`, hashed), built in Blender with its model (`public/models/kits/<name>.glb`) by `art/build_kit_<name>.py`. The first is the grey placeholder `greybox` (3 m cells, floors at 0, 3 and 6 m, 0.8 m crates), plain grey Pieces with no theme.
_Avoid_: Tileset, theme (for the data)

**Piece**:
One placeable part of a Kit (a floor, a ramp, a crate, a pillar, a rail, a bridge, a void with no floor): its look plus its own Walk Surfaces and Walls, its connectors (where walking crosses its sides, and at what height) and its skirts (how high its ground stands along each side, so a Wall goes under a floor that stands above its neighbour), all relative to its grid cells. Placed on whole cells, turned by quarter turns only.
_Avoid_: Tile, prefab, module

**Layout**:
The Pieces a seed places on the grid (each with its cell, level and quarter turn), before they are assembled into an Arena. The same Kit, seed and settings always give the same Layout.
_Avoid_: Map (the Lobby's pick of Arena), level

**Jump**:
A Fighter standing on the ground, Idle or Blocking, leaping up (Space, or the Jump pad), carrying its walk with it, at its drawn walk speed even when Sheathed (ADR 0017). It Falls until it lands. A tap is a small hop; holding Jump past `fall.jumpBoostDelay` keeps boosting it upward (`fall.jumpBoost`) for up to `fall.jumpBoostTime`, and letting go ends the boost for that Jump. A Jump's Landing deals no fall damage and never Staggers, however deep the drop (only deadly ground, such as an Abyss, kills it), unless the Fighter was knocked down in the air (ADR 0012). How high and far a Jump reaches: `docs/jump-reach.md`.

**Crouch**:
Holding C (not Ctrl, which browsers keep for Ctrl+W) lowers the Fighter's hips and hands by `fighter.crouchDepth`, easing at `fighter.crouchSpeed`, with its feet planted. Not an Action: it combines with Attack, Block and Jump, and while crouched a Fighter walks at `fighter.crouchWalkFactor` of its speed. Lowered hips and hands mean lowered Hit Zones and blows.
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
A place on a Team in the Lobby (three a Team): Open (a Player may take it), Closed (shown as Empty), an AI (difficulty and Weapon), or a Player. Moving to another Seat swaps with whatever is there. The Lineup reads the Seats Team by Team.
_Avoid_: Slot (that is the Lineup's)

**Skirmish**:
Player vs AI, set up in its own offline Lobby: you and any AI allies and enemies. Its in-game menu pauses the Match.
_Avoid_: Single player, practice
