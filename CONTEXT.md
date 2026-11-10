# Sword

A web-based 3D melee duelling game with Mount & Blade–style directional attacks and blocks, where combat motion is generated procedurally and tuned in an in-game editor.

## Participants

**Fighter**:
A combatant in a Duel: its body (Skeleton + Weapon) and its combat state (HP, current Action). Its Weapon is chosen before the Match and kept across Duels; in a Run it changes only by equipping another from its Inventory. In a Run it also carries its own `mods` (its equipped Relics folded into one record), which every combat number it deals or takes is read through: the Hit's damage, its Throwing Daggers' count and damage, a Kick's knockdown damage, a Block Impact, its max HP, what it heals on a kill and on a clear. A Player's Fighter holds an Inventory; an Elite enemy's `mods` come from the Relics its Encounter names.
_Avoid_: Player, character, unit

**Controller**:
The source of a Fighter's intents each tick — a human (Local Controller), the AI (AI Controller), or a remote peer (Remote Controller). The Fighter never knows which kind drives it.
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
How a Fighter is drawn: the bare Skeleton from primitives, or a skinned model (female, monk, prince, brawler, librarian, duelist, snake, wraith, asturian, templar, uruk) whose bones are placed on the Skeleton's joints every frame. Each player picks theirs in the menu, and online the Lobby tells every peer what each Member picked; the AIs wear random ones. Render-only: it never changes what the Skeleton does, and it is not part of the Match.
_Avoid_: Skin, character model, avatar

**Size**:
How tall and thick a Fighter is: a height and a thickness, each a multiple of the standard body from 0.6 to 1.4 in steps of 0.05 (1 is standard). Height stretches the Skeleton's bones, the Weapon (its length, grip and head) and the Fighter's collision height; thickness widens the body and its Hit Zones fully, and its collision radius by half as much (so a wide Fighter is not held out of its own Weapon's reach). A Motion's targets are scaled to fit, so a taller Fighter reaches further and a wider one is easier to hit and takes more room. Stats (max HP, walk speed, Jump, damage, Block rules) do not change. Part of the Match, fixed for it and kept across Duels: a Player picks theirs in the menu, the host sets an AI Seat's, a Run's Encounter enemy names its own (Tuning Data `dungeon` Encounters' `enemies[].size`), and online the Lobby tells every peer. In a Battle each Soldier has its own (`CrowdState.sizeHeight`, `sizeThick`), height and thickness drawn apart on a bell curve round the standard body from the Battle's seed (`battle.soldier.sizeSpread`, cut to the range), the same for both armies place for place; a promoted Soldier's Fighter has it, its impostor is stretched to it about its feet, and a Player who takes a Soldier over keeps their own Size (the Soldier takes it on). Absent from a Fighter that is the standard body. Ceilings and Walls judge the real, scaled height; the AI's navmesh is still built for the standard body.
_Avoid_: Scale, build (in code), stature

**Intent**:
What a Controller asks its Fighter to do on a given Tick (move, aim Direction, attack, block). The only thing that crosses the Controller–Fighter boundary, and the only thing sent between peers.
_Avoid_: Command, input (when meaning the abstract request)

**Reaction Time**:
The delay before an AI Controller may act on what it sees of the other Fighters. Together with mistake rate and how much of its repertoire it uses (circling and spacing, pressure, disengaging, punishing openings, punishing a Sheathed enemy (one Sheathed, Sheathing or Drawing cannot Block, so it closes in and swings without Feints), Chains, jumping Attacks, Crouching under swings, Chambers, following jump Links up to a hold (and shortcut ones at any hold), meeting an enemy's Landing, Jumping away from an enemy), it defines AI difficulty (Tuning Data `ai.difficulties`): Easy, Normal or Hard, or their newer counterparts Beginner, Skilled and Expert, the same strength ladder with the exploit fixes on (it reads a low swing's look and Blocks rather than Duck it, breaks a held Wind-up rather than turtle, holds or Feints rather than swing at a target backing out of reach, punishes only an opening its own Wind-up Releases inside, and swings on rather than Feint into a Block when its own Wind-up clearly lands before an enemy's) and teamwork (it flanks an enemy its allies share, takes turns with them, swings at a back turned on an ally, never swings through an ally, and spreads out over the enemies), and with a human feel (it swings on a rhythm rather than a coin flip, now and then notices an Attack a little late, makes human mistakes: a late Block, or one beside the right Direction, varies its spacing and pauses, and hops out of a pincer or round to its flank when the walk is blocked), each a little more often up the ladder. A late notice is only ever later than its Reaction Time, never sooner. Easy, Normal and Hard stay exactly as they were until they are phased out. An AI never Sheathes; taking over a Sheathed Fighter, it Draws once an enemy is near. With several enemies, the AI fights the nearest (or, playing as a team, the one its allies leave free) and defends against the nearest enemy Attack that can reach it. It plays as a team by what it sees of its allies, as of everyone, Reaction Time ago: AIs share no plans. Every Jump it makes is checked against the Simulation's own arc first: it never Jumps where a slightly-off version of the Jump would land somewhere deadly or hurt it.

**Style**:
How an AI fights, chosen apart from its difficulty (which says how well): Balanced (the default, which changes nothing), Aggressive, Counter, Tricky or Defensive, or Random (picked from the Match seed, or in a Run from the Run seed, so every peer picks the same). Tuning Data `ai.styles`: a multiplier on each of the difficulty's chances it names, never its Reaction Time or mistake rate. A Lobby AI Seat and an Encounter's enemy each name one.
_Avoid_: Personality, behaviour (for the setting), AI type

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
A guest leaving mid-Match (its link closed, it went silent, or it was refused): from the Tick after the last of its Intents the host holds, an AI Controller (Normal; in a Run an Ally AI) drives its Fighter on every peer, and the Match goes on (ADR 0010). In a Run the Fighter is also marked away at the Takeover Tick on every peer (a Simulation step, so it rolls back and resyncs): it keeps its Inventory and `mods`, but no longer counts at Doors and takes no pickup or Rest fire (ADR 0019). In a Battle the Player's record is marked away the same way (`BattlePlayer.away`): its Fighter fights on as an ally of its Team with no Bubble, takes over no Soldier when it falls, and counts no more kills. The host announces the Tick; the others roll back to it. The guest stays out of the Match until the next start.
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

**Whiff Chain**:
Pressing attack again during Release, and still holding it as Release ends, with an Attack that has landed nothing (a Blocked one Staggers instead): the Recovery is skipped. After one Tick of Recovery (the last Blade Sweep segment, into the end-of-Release pose, still belongs to the old swing), the next Attack starts in the Direction held as Release ended, its pose blending from the end of the swing straight to its held Wind-up pose, which it reaches on the usual Wind-up Tick. It then holds and Releases like any Attack, and may Whiff Chain again. Letting go on that Tick, or a press only in Recovery, gives the ordinary Recovery (or Chain). The AI does not use it yet: it never presses attack during Release.

**Wheel Attack**:
A quick Attack queued by a mouse wheel notch: up for Overhead, down for Thrust. The Local Controller holds attack in that Direction until the Attack starts (at once from Idle, as a Whiff Chain or Chain from a swing's Release or Recovery, or as soon as a Stagger, Kick, Block or the like is over, if within `WHEEL_QUEUE_SECONDS`), then lets go so its Wind-up Releases as soon as it reaches its held pose. Only Intents: the Simulation knows nothing of it. A newer notch replaces one still waiting; it ignores (and leaves) the aim of mouse gestures, and does nothing while left mouse is held (pressing left mouse drops it).
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
A small blade each Fighter carries 3 of per Duel (no pickups; a thrown one is gone), thrown with the off (left) hand by a Throw. Once thrown it is a simulated projectile with its own flight, so it can be Blocked, can Stagger, wound and Slow what it hits, and can fell a Fighter (ADR 0008). It passes through its thrower and the thrower's teammates. In flight it homes a little: it turns toward the nearest enemy within 25° of its heading and 20 m, by at most 60° a second, so a near miss becomes a Hit but a Fighter beside or behind it is never chased.
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
The outcome of a Kick on a Fighter who gave any movement input on the contact Tick, of a Heavy Blow that Hits, or of any damaging Hit (blade, Throwing Dagger or Kick) on a Fighter in the air, and also the Action that follows: a push away (a long Slide on the ground; in the air, as much speed added to its flight), then the Fighter buckles, sits back and rolls flat onto its back, stays down for a fixed time and gets up (the Get-up). A Kick's Knockdown deals 5 damage. Knocked down in the air, it lies in the air and its time down only starts once it lands: it never gets up before it has landed. Its Landing deals double fall damage, counted from the real top of its arc even after a Jump (ADR 0012). It can Block only from halfway through the Get-up (and not at all while Sheathed: it then holds no guard); throughout it cannot turn, move, Attack, Kick or Jump, and it can be hit normally (a Hit pushes it again but does not restart it). It interrupts whatever the Fighter was doing.
_Avoid_: Knockback (reserved: see Block Impact), stun

**Get-up**:
The last phase of a Knockdown: the Fighter sits up, draws its feet in and rises through a crouch to Idle.

**Slide**:
A push the simulation gives a Fighter over a few Ticks, decelerating, along the floor away from the Kicker (or from the attacker of a Heavy Blow). Subject to body collision and arena edges, so a Slide can carry a Fighter off a ledge (ADR 0006). Not Knockback, which names nothing in the game.
_Avoid_: Knockback, pushback

**Feint**:
Cancelling an Attack's wind-up into a different Action: an Attack in another Direction, or a Block.

**Chamber**:
Countering an incoming Attack by starting an Attack in the Direction a Block would need (mirrored for Left and Right) early in its Release (within the Chamber window, Tuning Data), roughly facing the attacker. That only makes the Chamber pending: it lands where the blades meet, when the incoming Blade Sweep reaches the chamberer's Weapon (or, failing that, its body) while the chamberer is still in that Attack (ADR 0018). The incoming Attack is then cancelled (its attacker Staggers) and the chamberer's own Attack continues. An Attack that reaches nothing (the chamberer out of its reach) is no Chamber: it whiffs.

**Blade Sweep**:
The volume the Weapon's blade traces between ticks; whatever it intersects is hit, unless a Wall stops it first. Hits are physical, never abstract.
_Avoid_: Hitbox, hit check

**Blade Speed**:
The speed of the blade at the point of contact; it scales damage.

**Weapon**:
A data definition of a held weapon: its Grip, length (sword hand to tip), grip or shaft behind the sword hand, damage, reference Blade Speed, Head, how hard its Block Impact hits and is taken, its Heavy Blow (if any), its Tempo and its sheathe slot (`sheathe.slot`: the left hip for the Arming Sword, the back for the others) where it rides while Sheathed, placed by `sheathe.offset` and `sheathe.rotation` from the pelvis (hip, turning with the hips) or the chest (back, turning with the shoulders). Only the Renderer draws it there. No shields. In a Run a Player's Fighter may carry several (its Inventory) and wields one: it changes by equipping, only in a Cleared Hall and never mid-Action, so a Weapon is never swapped in a fight.

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
One round between two Teams, ending when the last Fighter of a Team falls; the other Team wins it. In a Run, each Duel is a Hall's, and it goes on once the Hall is Cleared (its enemies fallen, the party walking to a Door): it ends only when Team 0 is wiped out, or when the last Floor's Boss falls.
_Avoid_: Fight, round (as a synonym), match

**Death**:
How a Fighter fell: the Duel Tick its HP reached zero, and its cause: a Hit (and the Hit that did it: a blade, or a Throwing Dagger), a Fall (a Knockdown Landing whose fall damage took its last HP, or a Landing on an Abyss), Lava or Water, even while its Team fights on. From then on the Fighter is no longer simulated, hits and is hit by nothing, and no longer blocks other bodies; its state stays as it fell. In a Run, a fallen Team 0 Fighter sits out the rest of its Hall and is back on the next Hall at `dungeon.revive` of its max HP (at full HP when that Hall is the next Floor's entrance).
_Avoid_: KO, kill

**Death Ragdoll**:
A fallen Fighter's body going limp and dropping to the floor, knocked away by the blow that felled it, as its hand lets go of the Weapon (a Sheathed Weapon stays in its slot, held to the torso, and falls with it). Drawn outside the Simulation from the Death and the pose it fell in, never changing an outcome, and always the same fall for the same Death (scrubbing, replays and Rollback agree).
_Avoid_: Death animation, death Motion

**Final Blow Shot**:
When the last Fighter of a Team falls, the view cuts to a camera close to the fallen Fighter (and its killer, if near) that replays the Duel from a moment before the blow (`camera.finalBlowLead`) to a moment after (`camera.finalBlowTail`) in slow motion (`camera.finalBlowSpeed`), spinning slowly around it, letterboxed. Render only: it replays Ticks the game already showed while the Match runs on into the pause before the next Duel (`match.interDuelSeconds`, long enough to hold it), and never changes an outcome. In a Run it plays when a Hall is Cleared, on the last enemy to fall, while the Hall's Duel goes on (none for a Treasure or Rest Hall, which have no enemies). While a Hall's shot plays the local Player's Controller sends `IDLE_INTENT` (the Hall runs on, the Player stands still), and the shot is cut a moment before a Door could be taken.
_Avoid_: Kill cam

**Camera Shake**:
A short jolt of the player's own camera (third-person, or the orbit camera once fallen): hard when its Fighter is Hit, lightly when it lands a Hit, harder still for a Heavy Blow either way, and hard when it is knocked down by a Kick or hurt by a Landing. It dies away in well under a second, scaled by `camera.shake` (0 turns it off), and never shakes the Final Blow Shot. Render only, like the bursts of red where a Hit lands (bigger and brighter for a Heavy Blow): it follows the Simulation's events, never changes an outcome, and always shakes the same way for the same events.
_Avoid_: Screen shake, hit shake

**Match**:
A best-of-N sequence of Duels between two Teams; the score counts Duels won per Team. In the Gauntlet Format, a Match is a Run instead.

**Format**:
How a Match is played, a Lobby setting: Duels (best-of-N, as it always was), Gauntlet (a Run) or Battle. The Lobby offers Battle in a Skirmish and online alike (`lobbyFormats`); the wire's session list (`SESSION_FORMATS`) and the Lobby's message check (`isLobbyFormatOnMap`: a Battle on any Map the Lobby holds, as it sets the Map aside) both accept it, and a Rollback session plays it (`docs/plans/big-battle.md` Stages 6 and 7). Not the Match Mode, which says which Controllers fight.
_Avoid_: Mode (that is the Match Mode), game type

**Run**:
A Match in the Gauntlet Format: Team 0 (one to four Fighters, the Players and any AI allies) walks a Dungeon Hall by Hall, from Floor 1's entrance, until it is wiped out (a Defeat, in any Hall and any phase; a draw counts as lost) or beats the last Floor's Boss (a Victory). HP carries from Hall to Hall as it is: it heals only at a Rest Hall's fire and in full after each Boss. Its Fighters are fixed for the whole Run, and so is the number of humans it started with, which scales every enemy's max HP (`dungeon.perPlayerHp`, so an AI Takeover never changes a Hall). Only the Players still in the Run (not taken over) count at a Door and take a Rest Hall's fire or a pickup; once a Hall is Cleared the AI allies walk to the exit Door with the most living Players in its zone, else follow the nearest Player. A Run is a pure function of its options, the Lineup and Tuning Data (`data/dungeon.json`): every peer builds each Hall itself. There is no Rematch: a results screen shows the Floors and Halls cleared. The Lobby offers it in a Skirmish and online, where every Player is on Team 0.
_Avoid_: Gauntlet (for one playthrough), campaign

**Dungeon**:
The seeded map a Run walks: its Floors (three, Tuning Data `data/dungeon.json`), each a graph of Halls. A pure function of the Run seed and Tuning Data (`floorGraph`), rebuilt whenever it is needed and never stored, so every peer builds the same one with nothing sent.

**Floor**:
One depth of a Dungeon: a layered graph of Halls in five rows, from one entrance Fight Hall through three rows of 2 or 3 Halls each (their widths Tuning Data) to one Boss Hall. Each Hall has 1 to 3 exit Doors to Halls of the next row; paths may cross and every Hall is reachable, so a Run walks five of a Floor's Halls. The kinds of rows 2 to 4 are picked by the Floor's weights (Fight, Elite, Treasure; never an Elite in row 2), and row 4 always holds one Rest Hall. The Boss Hall's exit leads to the next Floor's entrance; beating the last Floor's Boss wins the Run. Later Floors' Encounters are harder.
_Avoid_: Level, act, stage, room (Room is the online connection)

**Hall**:
One node of a Floor, fought or visited on its own Generated Arena (with Doors), with a kind: Fight, Elite, Treasure, Rest or Boss. A Hall with enemies is one Duel: Team 0 starts at its entrance Door, every Fighter drawn with its Throwing Daggers back, and Team 1's slots hold its Encounter's enemies (Benched otherwise), each enemy's max HP also scaled by the Hall's row (`dungeon.depthHp`, so the Halls before the Boss are the hardest). Team 1's AIs take their difficulty and Style from the Encounter. Once no Team 1 Fighter is left in its Duel the Hall is Cleared (at once for a Treasure or Rest Hall, which have no Encounter), its Duel goes on and its exit Doors open; once the party takes one, a short fade (`dungeon.hallFadeSeconds`) and the Hall behind it starts. A Rest Hall's fire burns at the middle of its Arena's Team 1 spawns, drawn as crossed logs under a flickering flame, which turns to embers once the local Player has rested: each Player's Fighter that stands at it heals `dungeon.restHeal` of its max HP, once in that Hall. A Treasure Hall stands its pedestals from the start (below), each pedestal an item drawn on a stand. A Fight, Elite or Boss Hall drops loot for each Player once Cleared (`loot.drops`: one item in a Fight Hall, one in an Elite Hall besides the Relic its Elite carried, two in a Boss Hall); a Hall's pickups lie on Team 1's spawn cells and are gone when the party leaves. A pickup is drawn as its Weapon (lying, turning slowly) or its Relic's icon, and shows the name of one only at a time: the one aimed at, else the nearest.
_Avoid_: Room (the online connection), chamber (a combat term), cell (the generator's grid), node

**Door**:
A Piece of the Kit on a Hall's edge, at ground level: a doorway in a Wall with a zone on the ground before it. Nobody walks through it. Door 0 is the entrance: Team 0 starts at its four spawns, and it leads nowhere. Every other Door is an exit Door, drawn with the icon of the Hall behind it above its lintel (its kind; after a Boss also "Floor N+1") and a gate across the doorway: closed while the Hall is Fought, open once it is Cleared. Once the Hall is Cleared, every living Player's Fighter standing in its zone for `dungeon.doorSeconds` takes the party to that Hall (one stepping out starts the count again; a fallen Player need not stand there, a Player who left and was taken over does not count, and the AI allies count only once no Player lives), and while the party gathers the Door reads "2 / 3" (those in its zone out of those who count). The gate and the texts are drawn from the Run, render only: the Door's geometry and zone never change. A choice made by walking, so it rolls back like any position (ADR 0019).
_Avoid_: portal, gate

**Encounter**:
One hand-written group of 1 to 4 enemies in Tuning Data, each with its difficulty, Style, Weapon and Body (each may be `random`), max HP scale and `minTeam` (it fights only when Team 0 fields at least so many Fighters, its slot Benched otherwise). Each Floor has a pool of Encounters for its Fight Halls, one for its Elite Halls (harder) and its Boss's own. A pure hash of the Run seed, Floor and Hall picks a Hall's from its pool, repeating one within a Floor only once the pool has run out; its `random` picks are made the same way. An Elite's enemy may name Relics (from `data/relics.json`, 1 or 2): it starts its Hall with their `mods` (max HP and Throwing Daggers follow), and the first Relic of the lowest-slot Elite that fights and names any is what the Hall drops for each Player, ahead of the Elite's `loot.drops` picks.
_Avoid_: Wave, squad, spawn group

**Relic**:
A passive modifier a Player finds and equips, one of Tuning Data's (`data/relics.json`: a name, an icon and effects from a fixed vocabulary: `damage`, `heavyDamage`, `damageTaken`, `blockImpactTaken`, `daggerDamage`, `kickDamage` as factors, `maxHp` and `healOnClear` as shares, `daggers` and `healOnKill` as counts). An equipped Relic's effects fold into its Fighter's `mods` (`foldMods`: factors multiply, the rest add), recomputed at each Hall's start and on each equip; a Relic changes only its own Fighter's numbers. An Elite enemy wears the Relics its Encounter names. An item is a Weapon or a Relic.
_Avoid_: Perk, buff, boon

**Inventory**:
What a Player's Fighter holds in a Run: up to `dungeon.inventory.weapons` Weapons (one wielded, and a Fighter always keeps one) and `relics` Relics (at most `equippedRelics` equipped, the rest carried). It starts as the Weapon the Lineup chose. Items come from pickups lying in a Hall: a Fight, Elite or Boss Hall's drops for each Player (a pure pick of Run seed, Floor, Hall and Player, weighted by `loot.weights`), a Treasure Hall's `loot.pedestals` for each Player (one of three: taking one closes the other two for that Player), and an item a Player dropped, which any Player may take. A Player sees and takes its own pickups and the shared ones by standing on them, with room to hold them; a dropper may not take its drop back until it steps off. AI allies take nothing. It changes through the Intent's `equip` and `drop`, only in a Cleared Hall (or one with no Encounter) and only while the Fighter is Idle, on the ground and alive, so it rolls back like a position. The Local Controller's number keys equip (1 to 3 the Weapons, 4 to 9 the Relics), Shift and a number key only selects (so a carried Weapon can be dropped), X drops the one selected last, and I (or a touch button) opens the inventory screen: slots, what is wielded and equipped, each Relic's effects in words, and equip and drop buttons that send the same Intent fields (greyed, with the reason, when the Hall is not Cleared).
_Avoid_: Bag, loadout

**Floor Map**:
The screen on `M` (a touch button on phones), open at any time in a Run, even mid-Hall while the Simulation runs on: the current Floor's graph, each Hall's kind as an icon, the path the party took and where it stands. Render only: it reads the Run and the Floor graph and never changes an outcome.

**Build**:
What a Player's Fighter carries at the end of a Run, listed on the results screen with each item's icon and name: the wielded Weapon and the equipped Relics, the carried ones smaller.

**Benched**:
A Team 1 slot a Hall has no enemy for (its Encounter lists fewer than four, or an enemy's `minTeam` is not met; every slot of a Treasure or Rest Hall), or a Battle's Fighter Pool slot bound to no Soldier: out of that Hall's Duel. It has 0 HP but no Death, stands at its spawn, is not simulated, hits and is hit by nothing, blocks no bodies, is no AI's target, and counts for neither Team when the Duel ends.
_Avoid_: Empty, disabled, dead (it never fell)

**Battle**:
A Match in the Battle Format: two armies of `battle.armySize` Soldiers each (Tuning Data `data/battle.json`) deployed in Squads (Formations in ranks) facing each other on a Battlefield, fought over five Objectives, ending in a Rout (a Team out of Tickets whose Soldiers have fallen, or the Team behind at the 15-minute limit); the Team that did not rout wins. Its Fighters are its Fighter Pool: the Players' (none in an AI-vs-AI war), then slots its Bubbles bind to Soldiers. Its Duel never ends by its Fighters, only with the Battle. The Battlefield is its Arena, of one of two kinds (ADR 0022): the **open field**, built from its name alone (`battle:<seed>`), an open square field of gentle hills, a heightfield whose grid cells are two flat triangles each (its Walk Surfaces), with no Walls, Kit, Jump Links or Abyss; or a hand-built **Battle map** (`battle:<map>`, Tuning Data `data/battlemaps/<map>.json` from its Blender generator), an Arena of its own on the same 200 m square: its floor's Walk Surfaces, the solid blocks of its walls and towers (a Wall on every side; the Squads' destination fields go round them, and Soldiers walk round them to their places, sliding along one they walk into), its Objectives, Bases and deployment, its own army size (a standard and a most), and no Jump Links. A Battle map may have several levels (raised decks, ramps, a bridge over a tunnel): its Soldiers stand on Walk Surfaces and cross between them only by walking and dropping, and a map whose Walk Surfaces are not every one walked (or dropped) to from every other is refused when it is built. The first is the **Fort**: a ruined fort in the middle of the field, its curtain wall broken by a gatehouse toward each army (Objectives D and E, spawns), a breach on either flank and a smaller one beside each gate, and A and C on the flanks outside. In its courtyard stands the **keep**: a 28 m square block with a deck 4 m up, B on top of it, reached by a ramp up its west face and one up its east face (each 11 m wide), and a 6 m **tunnel** under it from the courtyard's south side to its north, so a Squad crossing between the gatehouses (D and E) may go through it where the field says that is the shorter way. The deck and ramps are Walk Surfaces over no ground and the tunnel is the ground under the deck, so the Fort is a map of several levels: B counts only the Soldiers on the keep, not those in the tunnel under it. Like the open field it is its own half turn, in its Walk Surfaces and Walls too, so neither army is nearer anything. It starts each Team with fewer Tickets a Soldier than the open field (its map file's `ticketsPerSoldier`, 2.4 against 3.5), since its walls, keep and tunnel slow the killing. There is no Rematch: banners for the Rout and the Player's fall, then a results screen (the winner, each army's Tickets left and Objectives held, the Player's kills, the Soldiers taken over, each army left standing, the time) and back to the Lobby. Its HUD shows each army's Tickets (a bar, with a thin strip of its Soldiers under it that carries the Rout mark), a line for what the Player's army is doing ("Your army is attacking B", from its Squads' Orders), the Objectives in the world (a ring in the Owner's colour, a capture arc, a pole with a flag and its letter) and on the minimap (rings, letters, each Squad as an arrow, the Player's own army's with a line to its Objective). In a Skirmish the one Player chooses its Body and Weapon in the Lobby as for a Duel, with a Map row (the open field or the Fort; picking one sets the army size to its standard, and the army size row offers no more than its most) and the army size and fighting speed, and no Seats or Match length. Online, the host picks the Format and each Player picks their Team by their Seat (the Seats say only the Team: an AI Seat fields nobody, and the Map and Match length are set aside); a Rollback session then plays it for up to four Players (its Lineup names only them, slots 0 to 3 of the Pool, at most MAX_TEAM_SIZE a Team, the Players of one Team or of both), and every other Pool slot's Pool AI runs on every peer. Each peer draws from its own Fighter (`session.localFighter`: the camera, the HUD, the minimap turned so its army stands at the bottom) and sees every other Player's Body (the Lobby's, which every peer holds: Bodies need no protocol of their own, only the Weapon travels in the hello) and a **name tag** over their Fighter in their army's colour, with an arrow on the minimap; a Player who has fallen and waits to take over has neither until their new Fighter stands, and one who left has none (its Fighter is an AI's ally now). A Battle's results wait on a guest until the host's Lobby message returns everyone to the Lobby, 8 s after the end.

A Player whose Fighter falls **takes over** an ally. Until `battle.takeover.pickSeconds` (5) after the fall it may choose the Troop it comes back as (cards over the HUD, number keys 1 to the Troops' count, 0 for whichever is nearest; Intent `troop`, kept from one fall to the next in `BattlePlayer.troop`, so its Weapon is the one it picked; to begin with, the Troop that wields the Weapon it chose in the Lobby). Then the Soldier it will take over is chosen: the living ally Soldier of that Troop (of any Troop when none of it is left, or none was chosen) nearest one of its Team's spawns (the spawn Objectives it owns with no enemy on them, and its Base), one in the Crowd or a promoted ally Fighter (`BattlePlayer.next`); `battle.takeover.seconds` (10) after the fall it becomes that Soldier (or, should it be gone, the one nearest a spawn then; a promoted ally as it stands), with that Soldier's Troop's Body and Weapon and `battle.takeover.hp` HP (100, also its max HP, whatever the Soldier had), in the Player's own Pool slot, and plays on. The Player's chosen Fighter lies where it fell to the Battle's end (kept in a free Pool slot, never reused); a taken-over Soldier that falls dies at once (the Rout counts it) and lies in the Crowd. A Player whose army has no living Soldier left is out, and watches from above. Each Player's record (the Soldier it is, the takeovers, its kills: enemy full Fighters whose last blow was its) is plain Battle state (`CrowdState.players`).
_Avoid_: War, siege, skirmish (that is the Lobby's offline mode)

**Soldier**:
A member of a Battle's army that is not a full Fighter: plain data in the Crowd (position, heading, velocity, HP in a Fighter's units, Team, the enemy Soldier it is engaged with, and on a Battle map the Walk Surface it stands on, `CrowdState.surface`), fighting other Soldiers by rule and standing on the Battlefield's ground: on the open field the heightfield, on a Battle map its own Walk Surface, so one in a tunnel stands on the tunnel's floor and not on the bridge over it. Its height is never stored; it follows its Walk Surface. It has no Skeleton and no Blade Sweep, and never targets or damages a full Fighter: it holds outside sword reach of an enemy one (`battle.bubble.hold`). Near a Player it may be promoted to a full Fighter (Promotion), and while promoted it is out of the Crowd. At 0 HP it dies and stops counting. It has a Size of its own (a Fighter's Size), which the Crowd's rules ignore. It is of a Troop, and drawn as an impostor: a billboard of its look (its Troop's Body and Weapon), in its Team's colour in a shade of its own (render-only, from its index), baked from that look's own Motions when the Battle is drawn (one atlas per look), stretched about its feet to its Size: up by its height, across from its thickness seen face on to its height seen side on.
_Avoid_: Unit, NPC, Fighter (for a Soldier)

**Troop**:
A kind of Soldier a Battle's armies field (Tuning Data `battle.troops`, at most eight): a name, a weight, one or more Bodies (optionally a different list for each Team, `teamBodies: [team 0's, team 1's]`, a `null` entry meaning the Troop's `bodies`; the same Troop, look and Weapon, only another model), a Weapon, an AI difficulty, and its own Crowd stats (HP, blow damage and hit chance, engage reach) and Mods, each it leaves out the generic soldier's (`battle.soldier`, `battle.crowd`). Each Soldier's Troop, and which of its Bodies it wears (its look), is drawn by weight from the Battle's seed (`CrowdState.troop`, `look`), the same for both armies place for place, and kept when its Squad respawns it. A promoted Soldier fights with its Troop's Weapon, Mods and difficulty; every Troop plays the Battle's one Style. A Player who takes a Soldier over takes its Troop's Body and Weapon. A Battle that names none fields one Troop, the generic soldier.
_Avoid_: Unit type, class

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
A floor or ramp of an Arena (or a Battle map) that Fighters, and on a Battle map Soldiers, stand on: a flat (or evenly sloping) convex polygon. A Fighter walks onto a neighbouring one within a step up or down; higher ground is a wall, lower ground a ledge it walks off, and it is solid from below: a Jump under one bumps its head on it. The Walk Surfaces are also the AI's navmesh: shared edges join them, open ledges drop from one to the one below, and jump Links Jump up onto (or across to) one that cannot be walked or dropped to, or up onto one that can only by a longer way round (a shortcut: up onto a mezzanine the ramps also reach), where the Simulation's own arc lands there even when the Jump is made a little off (ADR 0011, ADR 0013).
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
An Arena built at run time from a Kit, a seed and generator settings, rather than read from `data/arenas/`: a Layout assembled into ordinary Walk Surfaces, Walls and spawns, with an Abyss under it all, and judged with the real navmesh (every spawn reaches every enemy spawn by walking and dropping alone, no deadly ground near a spawn), rerolled until it passes (ADR 0014). Its name records how it was made (`gen:greybox:1234`), so the same name always builds the same Arena. To the Simulation, the AI and the camera it is just another Arena. The Lobby's **Random** Map is one: the host picks the first Match's seed, the Map setting carries the name, each new Match (and Rematch) moves on to the next seed by a fixed step while every Duel of a Match keeps its Arena, and every peer builds the Arena from the name alone (with the default generator settings); the generator's version is part of the Tuning Data hash. A Hall's Arena also names its Doors (`gen:greybox:1234:d3`: 1 to 4 Doors, the entrance and its exits), placed on edge cells at ground level: Team 0's spawns are the entrance Door's, Team 1's in the cell furthest from it by walking, and the judge also requires every Door's zone and spawns to reach every enemy spawn by walking and dropping alone, with no zone over deadly ground. A name without `:d` builds the Arena it always did.
_Avoid_: Random map, procedural level (for the data)

**Kit**:
A set of Pieces sharing one grid size and set of floor heights, with one look (a theme). Tuning Data (`data/kits/<name>.json`, hashed), built in Blender with its model (`public/models/kits/<name>.glb`) by `art/build_kit_<name>.py`. The first is the grey placeholder `greybox` (3 m cells, floors at 0, 3 and 6 m, 0.8 m crates), plain grey Pieces with no theme.
_Avoid_: Tileset, theme (for the data)

**Piece**:
One placeable part of a Kit (a floor, a ramp, a crate, a pillar, a rail, a bridge, a void with no floor, a Door): its look plus its own Walk Surfaces and Walls, its connectors (where walking crosses its sides, and at what height) and its skirts (how high its ground stands along each side, so a Wall goes under a floor that stands above its neighbour), all relative to its grid cells. Placed on whole cells, turned by quarter turns only.
_Avoid_: Tile, prefab, module

**Layout**:
The Pieces a seed places on the grid (each with its cell, level and quarter turn), before they are assembled into an Arena. The same Kit, seed and settings always give the same Layout.
_Avoid_: Map (the Lobby's pick of Arena), level

**Map Source**:
The editable description of a Battle map (docs/plans/map-editor.md): its Brushes in paint order on a grid (every coordinate a whole number of `grid.step`), the heights they stand at (`levels`), its Objectives, Bases, `front`, army size and Tickets, and a Lobby card (`lobby`: label, where, blurb, art; the compiled map carries it, and the Lobby's map picker shows it, falling back part by part to its own entry for the map), saved as `data/battlemaps/<map>.source.json` beside the map it compiles to (`src/mapEditor/source.ts`). Not Tuning Data: never loaded by `loadTuningData` nor hashed; only the compiled map ships.
_Avoid_: Level file, project

**Brush**:
One shape of a Map Source: a **Floor** (floor at a height), a **Deck** (a raised floor; the floor under it stays), a **Platform** (a solid box: its top is floor, the floor under it is cut out, Walls face it), a **Ramp** (sloped from `lo` to `hi`, the floor under its wedge cut out, a rail or a stepped skirt on each long side), a **Hole** (takes away what the Brushes before it laid at one level; at a Platform's top, the Platform there), a **Hazard** (lava, water or abyss at a height), a **Rail** or **Wall** (a segment) or a **Block** (the one-level box of a map's `blocks`, never under a Deck). A later Brush paints over an earlier one, but a Ramp's wedge and a Block cut out the floor under them whatever the order. Its id (letters, digits and `-`) names what it compiles to.
_Avoid_: Piece (that is a Kit's), prefab

**Map Compiler**:
The pure function from a Map Source to an ordinary Battle map (`compileMap`, `src/mapEditor/compile.ts`): it paints the Brushes on the fine grid one level at a time, merges each Brush's floor into rectangles (`WALK_<brush>_<n>`), stands the Walls the generators would (the field's edges, a face wherever the ground beside a floor is higher than a step, owned by the higher Brush, `WALL_<brush>_<side><n>`, each Ramp's rails or skirt), and passes the result through the game's own `parseBattleMap` and `walkCheck`, so it never gives a map the game refuses; an error names the Brushes it concerns. The same source always compiles to the same bytes.
_Avoid_: Exporter, baker

**Map Editor**:
The dev route (`#/mapeditor?dev=1`, docs/plans/map-editor.md) that edits a Map Source: a top view of the field where Brushes are drawn, picked, moved and resized on the grid level by level, a panel of their numbers, undo, and Save, which writes the source and the map it compiles to and refuses a source the game would refuse. Its state and operations are `MapEditorSession` (`src/mapEditor/session.ts`). On every edit it compiles and checks the source (`checkMap`, `src/mapEditor/checks.ts`: the game's own walk check, walk rule, destination fields and marker placement run on the compiled draft) and lists what the Simulation will do that the author likely did not mean (an unreachable floor, a drop into lava, a Wall through a destination field's cell centre, an Objective with no floor), each naming its Brushes; overlays show the same in the top view and a 3D view. The Battle's markers are edited there too: Objectives placed and dragged (one dragged on a map of several levels takes the level being edited as its `y`), the Bases, and each Team's front line, with the map's settings and Lobby card; a map saved from it into `data/battlemaps/` is offered by the Lobby with no code change. Not the Editor (the Motion Editor).
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
A place on a Team in the Lobby (four a Team): Open (a Player may take it), Closed (shown as Empty), an AI (difficulty, Style and Weapon), or a Player. Moving to another Seat swaps with whatever is there. The Lineup reads the Seats Team by Team.
_Avoid_: Slot (that is the Lineup's)

**Skirmish**:
Player vs AI, set up in its own offline Lobby: you and any AI allies and enemies. Its in-game menu pauses the Match.
_Avoid_: Single player, practice
