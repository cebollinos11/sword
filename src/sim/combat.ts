/**
 * Combat resolution for one Tick, after every Fighter has moved and been
 * re-solved:
 *   1. findContacts: each live Blade Sweep (last Tick's blade → this Tick's)
 *      is tested against every other Fighter's Hit Zones, and against its
 *      whole Weapon (pommel or butt to tip) when it Blocks that Attack by rule,
 *      so a Block lands where the blades meet rather than when the Attack
 *      reaches the body. A Hit behind the attacker's Head deals less damage.
 *      An Arena Wall (a pillar, a wall, a rail) the sweep reaches first stops
 *      it there: nothing behind the Wall is hit.
 *   2. resolveContacts: every contact is resolved against the same
 *      pre-resolution state, so two Attacks landing on one Tick both count.
 *   3. resolveContact: a Block, a hit that Staggers the victim (or, in the air or
 *      from a Heavy Blow, knocks it down and pushes it), or a blade stopped by a Wall, which makes the attacker recoil.
 */
import { isHeavyBlow, weaponByName, type ArenaGeometry, type HitZone, type TuningData, type WeaponTuning } from '../tuning';
import { wallCrossing } from './arena';
import { TICK_SECONDS } from './constants';
import { inDuel } from './duel';
import { LODGE_TICKS } from './actions/attack';
import { attackSweepLive, blocksAttack, guardDirection, kickSweepLive, knockdown, roughlyFaces, stagger, startBlockImpact } from './actions';
import type { Emit } from './events';
import { hitZoneCapsules, type HitCapsule } from './hitZones';
import { IDLE_INTENT, mirrorDirection, type Direction, type Intent } from './intent';
import { followMotion, playbackTargets, upperBody } from './motion';
import { bladeAndLeg, fighterPose } from './pose';
import { startSlide } from './slide';
import type { Airborne, AttackAction, FighterState, StaggerCause } from './state';
import type { BladeTransform } from './skeleton';
import { bladeSamples, closestSegmentSegment, sweepContact, type Capsule } from './sweep';
import type { DaggerSweep } from './dagger';
import { lerp, length, normalize, scale, sub, type Vec3 } from './vec';

/**
 * A live Blade Sweep touching another Fighter this Tick: a Hit Zone, or (only
 * when the Attack is Blocked by rule) the defender's blade. `blocked` is the
 * Block rule's verdict (ADR 0002); the geometry only decides when it lands.
 */
export type BladeContact = {
  readonly attacker: number;
  readonly defender: number;
  readonly direction: Direction;
  readonly point: Vec3;
  readonly bladeSpeed: number;
  /** Whether the contact point is on the attacker's Head (see `onHead`). */
  readonly onHead: boolean;
} & ({ readonly blocked: true } | { readonly blocked: false; readonly zone: HitZone });

/**
 * A Kick's leg sweep touching another Fighter's Hit Zone this Tick (ADR 0007). It ignores Blocks and
 * Weapons; what it does is decided later, by the defender's Intent.
 */
export interface KickContact {
  readonly kick: true;
  readonly attacker: number;
  readonly defender: number;
  readonly zone: HitZone;
  readonly point: Vec3;
}

/** A live Blade Sweep reaching an Arena Wall before any Fighter this Tick: the blade stops there and the attacker recoils. */
export interface WallContact {
  readonly wall: true;
  readonly attacker: number;
  readonly direction: Direction;
  readonly point: Vec3;
  readonly bladeSpeed: number;
}

export type Contact = BladeContact | KickContact | WallContact;

/**
 * The capsule a Blocking defender's Weapon presents to the Blade Sweep: all of it, from the pommel or
 * butt (`gripLength` behind the main hand) to the tip, so a blow can meet a shaft between the hands
 * (radius: Tuning Data `block.bladeRadius`).
 */
function weaponCapsule(f: FighterState, tuning: TuningData): Capsule {
  const { hilt, tip } = f.blade;
  const axis = normalize(sub(tip, hilt));
  return { a: sub(hilt, scale(axis, weaponByName(tuning, f.weapon).gripLength)), b: tip, radius: tuning.block.bladeRadius };
}

/** Whether a point `along` the blade (0 at the main hand, 1 at the tip) lies on the Weapon's Head (within `head` of the tip). */
export function onHead(weapon: WeaponTuning, along: number): boolean {
  return (1 - along) * weapon.length <= weapon.head + 1e-9;
}

/**
 * Damage = Weapon damage × (Blade Speed / Weapon reference speed) × Hit Zone multiplier,
 * × the Weapon's `shaftDamage` for a Hit behind the Head (`head` false).
 */
export function hitDamage(tuning: TuningData, weapon: WeaponTuning, zone: HitZone, bladeSpeed: number, head = true): number {
  return weapon.damage * (bladeSpeed / weapon.speed) * tuning.hitZones[zone].multiplier * (head ? 1 : weapon.shaftDamage);
}

/**
 * The first point the Blade Sweep from `from` to `to` meets an Arena Wall, or null: a blade already through a
 * Wall at last Tick's pose meets it at once (s = 0, no room to swing); otherwise the earliest crossing of any
 * sampled point's path. `s` is when in the Tick, as `SweepContact.s`.
 */
function wallContact(from: BladeTransform, to: BladeTransform, arena: ArenaGeometry, samples: number): { s: number; point: Vec3; bladeSpeed: number } | null {
  if (arena.walls.length === 0) return null;
  const speedAt = (u: number) => length(sub(lerp(to.hilt, to.tip, u), lerp(from.hilt, from.tip, u))) / TICK_SECONDS;
  const through = wallCrossing(from.hilt, from.tip, arena);
  if (through) return { s: 0, point: through.point, bladeSpeed: speedAt(through.t) };
  let best: { s: number; point: Vec3; bladeSpeed: number } | null = null;
  for (let i = 0; i < samples; i++) {
    const u = i / (samples - 1);
    const c = wallCrossing(lerp(from.hilt, from.tip, u), lerp(to.hilt, to.tip, u), arena);
    if (c && (!best || c.t < best.s)) best = { s: c.t, point: c.point, bladeSpeed: speedAt(u) };
  }
  return best;
}

export function findContacts(prev: readonly FighterState[], next: readonly FighterState[], arena: ArenaGeometry, tuning: TuningData): Contact[] {
  const contacts: Contact[] = [];
  next.forEach((attacker, i) => {
    const before = prev[i];
    if (before && inDuel(attacker) && kickSweepLive(before.action, attacker.action)) findKickContacts(before, attacker, i, next, tuning, contacts);
    if (!before || !inDuel(attacker) || !attackSweepLive(before.action, attacker.action)) return;
    const direction = attacker.action.direction;
    const weapon = weaponByName(tuning, attacker.weapon);
    const samples = bladeSamples(weapon.length);
    const found: { s: number; contact: BladeContact }[] = [];
    next.forEach((defender, j) => {
      if (j === i || !inDuel(defender)) return;
      const zones: Capsule[] = hitZoneCapsules(fighterPose(defender, tuning), tuning);
      const blocked = blocksAttack(defender, attacker, direction, tuning);
      // Whichever the sweep reaches first lands: a Blocking blade stops the Attack where the blades meet.
      const c = sweepContact(before.blade, attacker.blade, blocked ? [weaponCapsule(defender, tuning), ...zones] : zones, samples);
      if (!c) return;
      const at = { attacker: i, defender: j, direction, point: c.point, bladeSpeed: c.bladeSpeed, onHead: onHead(weapon, c.along) };
      found.push({ s: c.s, contact: blocked ? { ...at, blocked } : { ...at, blocked, zone: (c.capsule as HitCapsule).zone } });
    });
    // A Wall the blade reaches before any Fighter stops it there; one it reaches after a Fighter does not matter (the Attack has landed).
    const wall = wallContact(before.blade, attacker.blade, arena, samples);
    if (wall && found.every((f) => f.s > wall.s)) contacts.push({ wall: true, attacker: i, direction, point: wall.point, bladeSpeed: wall.bladeSpeed });
    else contacts.push(...found.filter((f) => !wall || f.s <= wall.s).map((f) => f.contact));
  });
  return contacts;
}

/**
 * The first Hit Zone the kicking leg's sweep (last Tick's knee-toe segment to this Tick's, padded by
 * `kick.legRadius`) reaches on any other living Fighter. A Kick lands once, so only the earliest contact counts.
 */
function findKickContacts(before: FighterState, kicker: FighterState, i: number, next: readonly FighterState[], tuning: TuningData, out: Contact[]): void {
  const leg = (l: FighterState['kickLeg']) => ({ hilt: l.knee, tip: l.toe, edge: l.toe });
  const samples = bladeSamples(length(sub(kicker.kickLeg.toe, kicker.kickLeg.knee)));
  let best: { contact: KickContact; travelled: number } | null = null;
  next.forEach((defender, j) => {
    if (j === i || !inDuel(defender)) return;
    const zones = hitZoneCapsules(fighterPose(defender, tuning), tuning).map((z) => ({ ...z, radius: z.radius + tuning.kick.legRadius }));
    const c = sweepContact(leg(before.kickLeg), leg(kicker.kickLeg), zones, samples);
    if (!c) return;
    const travelled = length(sub(c.point, before.kickLeg.toe));
    if (best && travelled >= best.travelled) return;
    best = { travelled, contact: { kick: true, attacker: i, defender: j, zone: (c.capsule as HitCapsule).zone, point: c.point } };
  });
  const found = best as { contact: KickContact } | null;
  if (found) out.push(found.contact);
}

/** A thrown dagger's path this Tick reaching a living enemy's Hit Zone (ADR 0008): `sweep` indexes `advanceDaggers`' sweeps. */
export interface DaggerContact {
  readonly sweep: number;
  readonly defender: number;
  readonly zone: HitZone;
  readonly point: Vec3;
}

/**
 * The first living Fighter each dagger's path reaches this Tick: the earliest point along the segment, so a dagger
 * never passes through one Fighter into another. It passes through its thrower and the thrower's teammates, and
 * ignores Weapons. Hit Zones are padded by `dagger.radius`.
 */
export function findDaggerContacts(sweeps: readonly DaggerSweep[], fighters: readonly FighterState[], tuning: TuningData): DaggerContact[] {
  const zones = fighters.map((f) => (!inDuel(f) || f.hp <= 0 ? null : hitZoneCapsules(fighterPose(f, tuning), tuning)));
  const out: DaggerContact[] = [];
  sweeps.forEach((sweep, k) => {
    let best: { s: number; depth: number; contact: DaggerContact } | null = null;
    fighters.forEach((f, j) => {
      const capsules = zones[j];
      if (!capsules || f.team === sweep.dagger.team || j === sweep.dagger.owner) return;
      for (const z of capsules) {
        const radius = z.radius + tuning.dagger.radius;
        const { s, distance } = closestSegmentSegment(sweep.from, sweep.to, z.a, z.b);
        if (distance > radius) continue;
        const depth = radius - distance;
        if (best && (s > best.s || (s === best.s && depth <= best.depth))) continue;
        best = { s, depth, contact: { sweep: k, defender: j, zone: z.zone, point: lerp(sweep.from, sweep.to, s) } };
      }
    });
    const found = best as { contact: DaggerContact } | null;
    if (found) out.push(found.contact);
  });
  return out;
}

/**
 * Apply this Tick's dagger contacts, all judged against the pre-resolution `fighters` (who was Blocking). Blocked by
 * rule (ADR 0008): the defender is in a Block, roughly faces the thrower, and raised that Block on or after the Tick the
 * throw's Wind-up started (`tick - age >= thrownAt`); nothing else happens but a light Block Impact. Otherwise a Hit:
 * damage x Hit Zone multiplier, a Stagger (not for a Fighter lying in Knockdown; in the air, a Knockdown and a push along the
 * dagger's flight instead: `hitInAir`) and the Slow, restarted if it was already on.
 * Returns the Fighters and the sweeps whose dagger is spent.
 */
export function resolveDaggers(
  fighters: readonly FighterState[],
  contacts: readonly DaggerContact[],
  sweeps: readonly DaggerSweep[],
  tick: number,
  tuning: TuningData,
  emit: Emit,
): { fighters: FighterState[]; spent: Set<number> } {
  const out = fighters.slice();
  const spent = new Set<number>();
  for (const c of contacts) {
    const { dagger: d } = sweeps[c.sweep]!;
    const thrower = fighters[d.owner]!;
    const defender = fighters[c.defender]!;
    spent.add(c.sweep);
    const guard = defender.action;
    if (guard.kind === 'Block' && roughlyFaces(defender, thrower, tuning) && tick - guard.age >= d.thrownAt) {
      emit({ type: 'DaggerBlocked', thrower: d.owner, defender: c.defender, point: c.point });
      const impact = startBlockImpact(thrower, defender, guard.direction, tuning.dagger.speed, tuning);
      out[c.defender] = { ...out[c.defender]!, blockImpact: { ...impact, strength: impact.strength * tuning.dagger.blockImpact } };
      continue;
    }
    const damage = tuning.dagger.damage * tuning.hitZones[c.zone].multiplier;
    emit({ type: 'DaggerHit', thrower: d.owner, defender: c.defender, zone: c.zone, point: c.point, damage });
    const hurt = out[c.defender]!;
    const wounded = { ...hurt, hp: Math.max(0, hurt.hp - damage), slow: { ticks: tuning.dagger.slowTicks } };
    out[c.defender] = hitInAir(wounded, damage, d.velocity.x, d.velocity.z, tuning) ?? (hurt.action.kind === 'Knockdown' ? wounded : staggerFighter(wounded, c.defender, 'Hit', tuning, emit));
  }
  return { fighters: out, spent };
}

/**
 * Apply this Tick's contacts. Each Attack lands at most once. Every contact is
 * judged against the pre-resolution `fighters` (who was Blocking, which Attacks
 * were live), so two Attacks landing on the same Tick are a Trade: both hit,
 * both victims take damage and Stagger.
 */
export function resolveContacts(
  fighters: readonly FighterState[],
  contacts: readonly Contact[],
  intents: readonly Intent[],
  tuning: TuningData,
  emit: Emit,
): FighterState[] {
  const out = fighters.slice();
  for (const c of contacts) {
    if ('kick' in c) resolveKick(fighters, out, c, intents[c.defender] ?? IDLE_INTENT, tuning, emit);
    else if ('wall' in c) resolveWall(out, c, tuning, emit);
    else resolveContact(fighters, out, c, tuning, emit);
  }
  return out;
}

/**
 * Put a Fighter into Stagger, interrupting its Action (and re-solving its blade for the new Motion). `from` (a blade Hit
 * only) is the side the blow came from, from the Fighter's own view.
 */
export function staggerFighter(f: FighterState, index: number, cause: StaggerCause, tuning: TuningData, emit: Emit, from?: Direction): FighterState {
  // A blocked attacker keeps the upper body it was blocked in (the Recoil holds it) rather than recoiling through its Motion.
  const hold = cause === 'Blocked' ? upperBody(playbackTargets(tuning, f.weapon, f.motion)) : undefined;
  const { action, motion } = stagger(tuning, f.weapon, cause, hold, from);
  emit({ type: 'Stagger', fighter: index, cause });
  const staggered = { ...f, action, motion: followMotion(tuning, f.weapon, f.motion, motion) };
  return { ...staggered, ...bladeAndLeg(fighterPose(staggered, tuning)) };
}

/**
 * Knock a Fighter down (ADR 0007): a Knockdown interrupts its Action, its Block Impact is dropped, a Jump's boost
 * left is lost, and its pose is re-solved lying.
 */
function knockDown(f: FighterState, tuning: TuningData): FighterState {
  const { blockImpact: _impact, air, ...rest } = f;
  const { action, motion } = knockdown();
  let flight: Airborne | undefined;
  if (air) {
    const { boost: _boost, ...kept } = air;
    flight = kept;
  }
  const down = { ...rest, ...(flight ? { air: flight } : {}), action, motion: followMotion(tuning, f.weapon, f.motion, motion) };
  return { ...down, ...bladeAndLeg(fighterPose(down, tuning)) };
}

/** An airborne Fighter pushed along (dx, dz) (any length; none at all pushes nothing): its velocity gains `distance` spread over `ticks`, as the mean speed of that Slide. */
function pushInAir(f: FighterState, dx: number, dz: number, distance: number, ticks: number): FighterState {
  const d = Math.hypot(dx, dz);
  if (!f.air || d === 0) return f;
  const speed = distance / (ticks * TICK_SECONDS);
  return { ...f, air: { ...f.air, vx: f.air.vx + (dx / d) * speed, vz: f.air.vz + (dz / d) * speed } };
}

/**
 * A blade or dagger Hit that did `damage` to `wounded` while it is airborne: it is knocked down (unless it already is)
 * and pushed along (dx, dz) as hard as a Kick's Knockdown pushes. Null when it is on the ground or took no damage (a teammate's
 * Hit), so the Hit Staggers as usual.
 */
function hitInAir(wounded: FighterState, damage: number, dx: number, dz: number, tuning: TuningData): FighterState | null {
  if (!wounded.air || damage <= 0) return null;
  return pushDown(wounded, dx, dz, tuning.kick.knockdownSlide, tuning.kick.knockdownSlideTicks, tuning);
}

/** Push `f` along (dx, dz) and knock it down, unless it already is (then it is only pushed again). */
function pushDown(f: FighterState, dx: number, dz: number, distance: number, ticks: number, tuning: TuningData): FighterState {
  const pushed = push(f, dx, dz, distance, ticks);
  return pushed.action.kind === 'Knockdown' ? pushed : knockDown(pushed, tuning);
}

/** Push `f` along the unit direction (dx, dz): a Slide on the ground; in the air, a change of velocity at the Slide's mean speed. */
function push(f: FighterState, dx: number, dz: number, distance: number, ticks: number): FighterState {
  return f.air ? pushInAir(f, dx, dz, distance, ticks) : { ...f, slide: startSlide(dx, dz, distance, ticks) };
}

/** The unit direction along the ground from `attacker` to `defender` (the attacker's facing when they stand on one spot). */
function awayFrom(attacker: FighterState, defender: FighterState): { dx: number; dz: number } {
  const dx = defender.position.x - attacker.position.x;
  const dz = defender.position.z - attacker.position.z;
  const d = Math.hypot(dx, dz);
  return d > 0 ? { dx: dx / d, dz: dz / d } : { dx: Math.sin(attacker.facing), dz: Math.cos(attacker.facing) };
}

/**
 * One contact. Blocked (by rule, ADR 0002): no damage, the attacker recoils
 * into Stagger and the defender's sword hand absorbs the blow (Block Impact); a Heavy Blow also pushes the defender
 * back (its Weapon's `heavyBlow.blockSlide`), the Block holding. Otherwise a hit: the defender takes damage and Staggers,
 * or, in the air, is knocked down and pushed away from the attacker (`hitInAir`). A Heavy Blow knocks it down
 * wherever it is and pushes it away (`heavyBlow.knockdownSlide`).
 * A hit on a teammate Staggers it all the same but deals no damage (and is never a Heavy Blow).
 */
function resolveContact(before: readonly FighterState[], out: FighterState[], c: BladeContact, tuning: TuningData, emit: Emit): void {
  const attacker = before[c.attacker]!;
  const defender = before[c.defender]!;
  const action = attacker.action as AttackAction;
  if (action.landed) return;
  const weapon = weaponByName(tuning, attacker.weapon);
  const { dx, dz } = awayFrom(attacker, defender);
  if (c.blocked) {
    const heavy = isHeavyBlow(weapon, c.bladeSpeed, c.onHead);
    emit({ type: 'Block', attacker: c.attacker, defender: c.defender, direction: c.direction, point: c.point, bladeSpeed: c.bladeSpeed, heavy });
    out[c.attacker] = staggerFighter(out[c.attacker]!, c.attacker, 'Blocked', tuning, emit);
    // The blow still lands on the blade: the defender's hand gives and bounces back (Block Impact). Its first Tick moves nothing, so the blade stands.
    const guarded = { ...out[c.defender]!, blockImpact: startBlockImpact(attacker, defender, guardDirection(defender)!, c.bladeSpeed, tuning) };
    out[c.defender] = heavy ? push(guarded, dx, dz, weapon.heavyBlow.blockSlide, weapon.heavyBlow.blockSlideTicks) : guarded;
    return;
  }
  const damage = attacker.team === defender.team ? 0 : hitDamage(tuning, weapon, c.zone, c.bladeSpeed, c.onHead);
  const heavy = damage > 0 && isHeavyBlow(weapon, c.bladeSpeed, c.onHead);
  const current = out[c.attacker]!;
  // A Trade: the attacker may already be Staggered by the other hit this Tick; leave that be.
  if (current.action.kind === 'Attack') out[c.attacker] = { ...current, action: { ...current.action, landed: true, lodge: LODGE_TICKS } };
  const hurt = out[c.defender]!;
  const { attacker: a, defender: d, direction, zone, point, bladeSpeed, onHead: head } = c;
  emit({ type: 'Hit', attacker: a, defender: d, direction, zone, point, bladeSpeed, head, heavy, damage });
  const wounded = { ...hurt, hp: Math.max(0, hurt.hp - damage) };
  if (heavy) {
    out[c.defender] = pushDown(wounded, dx, dz, weapon.heavyBlow.knockdownSlide, weapon.heavyBlow.knockdownSlideTicks, tuning);
    return;
  }
  const away = hitInAir(wounded, damage, dx, dz, tuning);
  // A Fighter lying down is wounded but not Staggered: it stays down until its Get-up is done.
  // The blow arrives on the defender's side mirrored from the attacker's (a Left swing lands on its right).
  out[c.defender] = away ?? (hurt.action.kind === 'Knockdown' ? wounded : staggerFighter(wounded, c.defender, 'Hit', tuning, emit, mirrorDirection(direction)));
}

/**
 * A blade stopped by a Wall: the attacker recoils as from a Block (Stagger, cause Blocked), unless a Trade this
 * Tick has Staggered it already.
 */
function resolveWall(out: FighterState[], c: WallContact, tuning: TuningData, emit: Emit): void {
  const { attacker, direction, point, bladeSpeed } = c;
  emit({ type: 'WallStrike', attacker, direction, point, bladeSpeed });
  if (out[attacker]!.action.kind === 'Attack') out[attacker] = staggerFighter(out[attacker]!, attacker, 'Blocked', tuning, emit);
}

/**
 * A Kick connects (ADR 0007). The outcome is ruled by the defender's movement Intent on this Tick: any
 * movement input is a Knockdown (more damage, a long Slide), none a Shove (little damage, a short Slide,
 * and the defender's Action is untouched). A teammate is pushed all the same but takes no damage. The
 * push goes along the ground from kicker to defender. A Kick lands once: the kicker's Action is marked `landed`.
 */
function resolveKick(before: readonly FighterState[], out: FighterState[], c: KickContact, defenderIntent: Intent, tuning: TuningData, emit: Emit): void {
  const attacker = before[c.attacker]!;
  const defender = before[c.defender]!;
  if (attacker.action.kind !== 'Kick' || attacker.action.landed) return;
  // A Trade with a blade may have Staggered the kicker already; the Kick still landed, but there is no Action left to mark.
  const kicker = out[c.attacker]!;
  if (kicker.action.kind === 'Kick') out[c.attacker] = { ...kicker, action: { ...kicker.action, landed: true } };

  const { x: mx, z: mz } = defenderIntent.move;
  // An enemy in the air is knocked down whatever it does; a defender already in Knockdown is only Shoved: nobody is knocked down twice.
  const knocked = (mx !== 0 || mz !== 0 || (defender.air !== undefined && attacker.team !== defender.team)) && defender.action.kind !== 'Knockdown';
  const { kick } = tuning;
  const damage = attacker.team === defender.team ? 0 : knocked ? kick.knockdownDamage : kick.shoveDamage;
  const distance = knocked ? kick.knockdownSlide : kick.shoveSlide;
  const ticks = knocked ? kick.knockdownSlideTicks : kick.shoveSlideTicks;

  const { dx, dz } = awayFrom(attacker, defender);
  const hurt = out[c.defender]!;
  const pushed = push(hurt, dx, dz, distance, ticks);
  const wounded = { ...pushed, hp: Math.max(0, hurt.hp - damage) };
  emit({ type: 'KickLanded', attacker: c.attacker, defender: c.defender, outcome: knocked ? 'Knockdown' : 'Shove', zone: c.zone, point: c.point, damage });
  // A Shove never touches the defender's Action. A Knockdown interrupts it: the defender falls (its Block Impact is dropped, and its pose re-solved lying).
  if (!knocked) {
    out[c.defender] = wounded;
    return;
  }
  out[c.defender] = knockDown(wounded, tuning);
}
