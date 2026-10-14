# Sword

A web-based 3D melee duelling game with Mount & Blade–style directional attacks and blocks, where combat motion is generated procedurally and tuned in an in-game editor.

## Participants

**Fighter**:
A combatant in a Duel: its body (Skeleton + Weapon) and its combat state (HP, current Action).
_Avoid_: Player, character, unit

**Controller**:
The source of a Fighter's intents each tick — a human (Local Controller), the AI (AI Controller), or a remote peer (Remote Controller). The Fighter never knows which kind drives it.
_Avoid_: Input, brain, agent

**Skeleton**:
The Fighter's hierarchy of bones, built from primitives and fully owned by the game so procedural motion can drive it directly.
_Avoid_: Rig, armature, model

**Intent**:
What a Controller asks its Fighter to do on a given Tick (move, aim Direction, attack, block). The only thing that crosses the Controller–Fighter boundary, and the only thing sent between peers.
_Avoid_: Command, input (when meaning the abstract request)

**Reaction Time**:
The delay before an AI Controller may act on what it sees of the opponent; together with mistake rate it defines AI difficulty.

## Motion

**Pose Key**:
A timed target for part of the Skeleton (hand position/rotation, torso twist, hip, foot plant) with an easing curve; IK solves the bones to reach it.
_Avoid_: Keyframe, frame

**Motion**:
A named sequence of Pose Keys that animates one Action, e.g. the Overhead Attack.
_Avoid_: Animation, clip

**Tuning Data**:
All editor-authored data — Weapons and Motions — stored as files in the repo. Both peers must hold identical Tuning Data to play.
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
One peer's side of a Player vs Player Match: it runs the Match, exchanges Intents with the other peer, predicts and corrects the remote Fighter's Intents by Rollback, and compares state checksums. Not the Room (which only gets the peers connected).
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
A directional defensive Action that stops an Attack when its Direction matches the Attack's Direction and the defender roughly faces the attacker. Decided by rule, not by blade-on-blade geometry.
_Avoid_: Parry, guard

**Feint**:
Cancelling an Attack's wind-up into a different Action: an Attack in another Direction, or a Block.

**Chamber**:
Countering an incoming Attack by starting an Attack in the same Direction early in its Release (within the Chamber window, Tuning Data), roughly facing the attacker. The incoming Attack is cancelled (its attacker Staggers) and the chamberer's own Attack continues.

**Blade Sweep**:
The volume the Weapon's blade traces between ticks; whatever it intersects is hit. Hits are physical, never abstract.
_Avoid_: Hitbox, hit check

**Blade Speed**:
The speed of the blade at the point of contact; it scales damage.

**Weapon**:
A data definition of a held weapon (length, speed, damage, swing arcs). v1 has one one-handed sword, no shield.

## Match

**Duel**:
One round between two Fighters, ending when one Fighter's HP reaches zero.
_Avoid_: Fight, round (as a synonym), match

**Match**:
A best-of-N sequence of Duels.

**Match Mode**:
Which Controllers face each other: Player vs AI, Player vs Player (online), or AI vs AI.

**Arena**:
The space a Duel takes place in. v1 has one: a flat circle with no obstacles.

**Room**:
A shareable code/link through which two peers connect for a Player vs Player Match.
_Avoid_: Lobby, session, server
