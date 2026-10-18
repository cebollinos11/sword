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
A human taking part in a Match: Player 1 (in Player vs AI, or the host online) or Player 2 (the guest online). A Match has at most two. Each drives one Fighter and picks its own Weapon.
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
How a Fighter is drawn: the bare Skeleton from primitives, or a skinned model (female, monk, prince, brawler, librarian, duelist, snake) whose bones are placed on the Skeleton's joints every frame. The player picks theirs in the menu; every other Fighter wears a random one. Render-only: it never changes what the Skeleton does, and it is not part of the Match (online, each peer draws the others at random).
_Avoid_: Skin, character model, avatar

**Intent**:
What a Controller asks its Fighter to do on a given Tick (move, aim Direction, attack, block). The only thing that crosses the Controller–Fighter boundary, and the only thing sent between peers.
_Avoid_: Command, input (when meaning the abstract request)

**Reaction Time**:
The delay before an AI Controller may act on what it sees of the other Fighters. Together with mistake rate and how much of its repertoire it uses (circling and spacing, pressure, disengaging, punishing openings, Chains, jumping Attacks, Crouching under swings, Chambers), it defines AI difficulty: Easy, Normal or Hard (Tuning Data `ai.difficulties`). With several enemies, the AI fights the nearest and defends against the nearest enemy Attack that can reach it.

## Motion

**Pose Key**:
A timed target for part of the Skeleton (hand position/rotation, torso twist, hip, foot plant, and for a Kick the kicking foot and a whole-body tilt) with an easing curve; IK solves the bones to reach it.
_Avoid_: Keyframe, frame

**Motion**:
A named sequence of Pose Keys that animates one Action, e.g. the Overhead Attack.
_Avoid_: Animation, clip

**Motion override**:
A Weapon's own version of a default Motion, with the same name (Tuning Data `data/motions/<Weapon file>/`). A Fighter plays its Weapon's override where there is one, the default otherwise. An override keeps the markers its Action needs.
_Avoid_: Variant, weapon animation

**Motion Blend**:
The short crossfade (Tuning Data `fighter.motionBlend`) from the pose a Fighter was in to a Motion that takes over, so the Skeleton never snaps between Motions (e.g. letting go of a Block). Part of the simulation, so the blade it moves is the blade that hits.
_Avoid_: Transition, tween

**Gait**:
The procedural stepping of a Fighter's legs whenever its body moves over the floor (walking, turning in place, being pushed). It owns the feet while the body moves, so feet never slide, and settles them back where the current Motion puts them when the body stops. It is not a Motion: it runs alongside whatever Action is current.
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
One peer's side of a Player vs Player Match: it runs the Match (AI Fighters included, on both peers: ADR 0005), exchanges Intents with the other peer, predicts and corrects the other Player's Fighter's Intents by Rollback, and compares state checksums. Not the Room (which only gets the peers connected).
_Avoid_: Session (on its own), netcode, connection

## Combat

**Action**:
What a Fighter is doing right now: Idle, Attack, Block, Kick, Throw, Stagger, Knockdown, or Fall. A Fighter has exactly one Action at a time.
_Avoid_: State, move, animation

**Wind-up**:
The first phase of an Attack, held for as long as the attack button is held; it reveals the Direction to the opponent.

**Release**:
The phase of an Attack after the button is let go; the only phase in which the Blade Sweep is live.
_Avoid_: Swing phase, active frames

**Recovery**:
The committed phase after Release, before the Fighter can act again.

**Chain**:
Holding attack during Recovery: the pose blends straight from where it is to the next Attack's held Wind-up pose instead of back to guard, and that Attack starts when Recovery ends. Pose only: Recovery, the Idle Tick after it and the Wind-up last as long as ever. Letting go during Recovery drops the Chain.
_Avoid_: Combo, cancel, buffer

**Stagger**:
A short forced Action in which the Fighter cannot act. Its cause: Hit (being hit, interrupting the victim's Action), Blocked (having an Attack blocked, or its blade stopped by a Wall: the attacker recoils), Chambered (having an Attack Chambered), or Landed (a hard Landing: a crouch the Fighter is open in).
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
An Action (E key) in which the Fighter throws a Throwing Dagger with its off hand. It follows an Attack's phases (Wind-up, Release, Recovery) and lasts about 0.5 s; the dagger leaves the hand on the first Tick of Release. The Fighter can still walk, turn and crouch, but cannot Attack, Block, Kick, Feint or cancel. It starts from Idle, with a dagger left, on the ground or in a Jump. With a two-handed Weapon the off hand lets go of the Off-hand Grip during the Throw.
_Avoid_: Shot, toss

**Slow**:
The effect of a Throwing Dagger Hit: for 3 s the Fighter walks (and steers in the air) at 0.6× speed. A new dagger Hit restarts the timer at the same strength; it does not stack. It multiplies with crouch and recoil, and does not slow turning, Jumps, Slides or Motions.
_Avoid_: Debuff, snare, root

**Knockdown**:
The outcome of a Kick on a Fighter who gave any movement input on the contact Tick, and also the Action that follows: 5 damage, a long Slide, then the Fighter falls flat on its back, stays down for a fixed time and gets up (the Get-up). Throughout it can turn and Block but cannot move, Attack, Kick or Jump, and it can be hit normally. It interrupts whatever the Fighter was doing.
_Avoid_: Knockback (reserved: see Block Impact), stun

**Get-up**:
The last phase of a Knockdown: the Fighter rises from lying back to Idle.

**Slide**:
A push the simulation gives a Fighter over a few Ticks, decelerating, along the floor away from the Kicker. Subject to body collision and arena edges, so a Slide can carry a Fighter off a ledge (ADR 0006). Not Knockback, which names nothing in the game.
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
A data definition of a held weapon: its Grip, length (sword hand to tip), grip or shaft behind the sword hand, damage, reference Blade Speed, Head, and how hard its Block Impact hits and is taken. No shields.

**Weapon roster**:
Every Weapon in Tuning Data, one file each (`data/weapons/`): today the Arming Sword (the default), the Longsword and the Halberd.
_Avoid_: Loadout, inventory

**Grip**:
How a Weapon is held: one-handed (the off hand follows its own Pose Keys) or two-handed (the off hand holds the Off-hand Grip).

**Off-hand Grip**:
The spot on a two-handed Weapon's grip or shaft where the off hand holds it, in the Weapon's own frame (distance back from the sword hand, angle around the axis, distance off it). When the off hand cannot reach it, the Weapon moves toward the off shoulder until it can (ADR 0004).

**Head**:
The striking part of a Weapon, measured back from the tip (the Halberd's axe and spike; all of a sword). A Hit from the Head deals full damage; one from the shaft behind it deals less. Blocks meet anywhere along the Weapon.

## Match

**Duel**:
One round between two Teams, ending when the last Fighter of a Team falls; the other Team wins it.
_Avoid_: Fight, round (as a synonym), match

**Death**:
How a Fighter fell: the Duel Tick its HP reached zero, and its cause: a Hit (and the Hit that did it: a blade, or a Throwing Dagger), a Fall (a hard Landing that took its last HP), Lava or Water, even while its Team fights on. From then on the Fighter is no longer simulated, hits and is hit by nothing, and no longer blocks other bodies; its state stays as it fell.
_Avoid_: KO, kill

**Death Ragdoll**:
A fallen Fighter's body going limp and dropping to the floor, knocked away by the blow that felled it, as its hand lets go of the Weapon. Drawn outside the Simulation from the Death and the pose it fell in, never changing an outcome, and always the same fall for the same Death (scrubbing, replays and Rollback agree).
_Avoid_: Death animation, death Motion

**Match**:
A best-of-N sequence of Duels between two Teams; the score counts Duels won per Team.

**Rematch**:
A fresh Match (same options, score 0–0) that starts on its own a few seconds after a Match ends. Online play always rematches, so the Players stay in the Room until one of them leaves; Player vs AI goes back to the menu instead.

**Match Mode**:
Which Controllers fight: Player vs AI (one Player, any AI allies and enemies), Player vs Player (online: two Players, as allies or enemies, plus any AIs), or AI vs AI. Each Fighter's Weapon is picked with it (each Player picks their own).

**Arena**:
The space a Duel takes place in, as Tuning Data (`data/arenas/<name>.json`): its Walk Surfaces, Walls and spawns, simulated in the Tick (ADR 0006). A Match is fought in the Arena picked from the menu's Map dropdown (the host's pick online): the library (three levels, `art/build_library.py`) by default, the carbon-freezing chamber (a ring-shaped platform over Lava, `art/build_chamber.py`) or the pirate ship (a deck with a raised quarterdeck and a plank, over Water, `art/build_ship.py`), each modelled in Blender, each Fighter starting at its Team's spawn; the Editor keeps a flat circle with no obstacles, where Duels start with the two Teams in facing lines across its centre.

**Walk Surface**:
A floor or ramp of an Arena that Fighters stand on: a flat (or evenly sloping) convex polygon. A Fighter walks onto a neighbouring one within a step up or down; higher ground is a wall, lower ground a ledge it walks off. The Walk Surfaces are also the AI's navmesh: shared edges join them, and open ledges drop from one to the one below.
_Avoid_: Floor (for the data), navmesh polygon

**Lava**:
A Walk Surface marked deadly: a Fighter that comes to stand on it dies there (a Death by Lava), whatever its HP. Falling into it is the danger of the chamber's open edges.
_Avoid_: Kill zone, hazard

**Water**:
A Walk Surface marked deadly like Lava: a Fighter that comes to stand on it drowns (a Death by Water), whatever its HP. The pirate ship's sea: walking off the plank or jumping over the rail ends there. The AI never paths onto Lava or Water.
_Avoid_: Sea (for the data), kill zone

**Wall**:
A vertical stretch of an Arena (a bookcase, a pillar, a balustrade) that no Fighter passes where its height overlaps theirs. A Blade Sweep that reaches one before any Fighter stops there (a Wall Strike): nothing behind it is hit, and the attacker recoils (Stagger, Blocked). A blade already through a Wall when its Release begins strikes it at once: there is no room to swing.

**Jump**:
A Fighter standing on the ground, Idle or Blocking, leaping up (Space, or the Jump pad), carrying its walk with it. It Falls until it lands.

**Crouch**:
Holding C (not Ctrl, which browsers keep for Ctrl+W) lowers the Fighter's hips and hands by `fighter.crouchDepth`, easing at `fighter.crouchSpeed`, with its feet planted. Not an Action: it combines with Attack, Block and Jump, and while crouched a Fighter walks at `fighter.crouchWalkFactor` of its speed. Lowered hips and hands mean lowered Hit Zones and blows.
_Avoid_: Duck, stance (a Crouch is not a Direction)

**Fall**:
The Action of a Fighter in the air, after a Jump or once it has been off the ground for a moment (walked or been pushed off a ledge): arms out, it cannot Attack or Block, but can be hit. It steers a little in the air.
_Avoid_: Airborne (for the Action)

**Landing**:
A Fighter reaching the ground again. A drop (from the top of its arc) within the safe height is soft: a Fall ends in Idle. A deeper one deals fall damage by the metre beyond it and Staggers it (Landed); it can fell the Fighter (a Death by Fall).

**Room**:
A shareable code/link through which two peers (the two Players) connect for a Player vs Player Match.
_Avoid_: Lobby, session, server
