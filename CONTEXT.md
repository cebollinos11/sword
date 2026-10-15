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

**Intent**:
What a Controller asks its Fighter to do on a given Tick (move, aim Direction, attack, block). The only thing that crosses the Controller–Fighter boundary, and the only thing sent between peers.
_Avoid_: Command, input (when meaning the abstract request)

**Reaction Time**:
The delay before an AI Controller may act on what it sees of the other Fighters; together with mistake rate it defines AI difficulty. With several enemies, the AI fights the nearest and Blocks the nearest enemy Attack that can reach it.

## Motion

**Pose Key**:
A timed target for part of the Skeleton (hand position/rotation, torso twist, hip, foot plant) with an easing curve; IK solves the bones to reach it.
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
What a Fighter is doing right now: Idle, Attack, Block, or Stagger. A Fighter has exactly one Action at a time.
_Avoid_: State, move, animation

**Wind-up**:
The first phase of an Attack, held for as long as the attack button is held; it reveals the Direction to the opponent.

**Release**:
The phase of an Attack after the button is let go; the only phase in which the Blade Sweep is live.
_Avoid_: Swing phase, active frames

**Recovery**:
The committed phase after Release, before the Fighter can act again.

**Stagger**:
A short forced Action in which the Fighter cannot act; caused by being hit (interrupting the victim's Action) or by having an Attack blocked (the attacker recoils).
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

**Feint**:
Cancelling an Attack's wind-up into a different Action: an Attack in another Direction, or a Block.

**Chamber**:
Countering an incoming Attack by starting an Attack in the Direction a Block would need (mirrored for Left and Right) early in its Release (within the Chamber window, Tuning Data), roughly facing the attacker. The incoming Attack is cancelled (its attacker Staggers) and the chamberer's own Attack continues.

**Blade Sweep**:
The volume the Weapon's blade traces between ticks; whatever it intersects is hit. Hits are physical, never abstract.
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
How a Fighter fell: the Duel Tick its HP reached zero and the Hit that did it, even while its Team fights on. From then on the Fighter is no longer simulated, hits and is hit by nothing, and no longer blocks other bodies; its state stays as it fell.
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
The space a Duel takes place in. v1 has one: a flat circle with no obstacles. Each Duel starts with the two Teams in facing lines across its centre.

**Room**:
A shareable code/link through which two peers (the two Players) connect for a Player vs Player Match.
_Avoid_: Lobby, session, server
