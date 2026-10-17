/**
 * Combat resolution for one Tick, after every Fighter has moved and been
 * re-solved:
 *   1. findContacts: each live Blade Sweep (last Tick's blade → this Tick's)
 *      is tested against every other Fighter's Hit Zones, and against its
 *      whole Weapon (pommel or butt to tip) when it Blocks that Attack by rule,
 *      so a Block lands where the blades meet rather than when the Attack
 *      reaches the body. A Hit behind the attacker's Head deals less damage.
 *   2. resolveContacts: every contact is resolved against the same
 *      pre-resolution state, so two Attacks landing on one Tick both count.
 *   3. resolveContact: a Block, or a hit that Staggers the victim.
 */
import { weaponByName, type HitZone, type TuningData, type WeaponTuning } from '../tuning';
import { LODGE_TICKS } from './actions/attack';
import { attackSweepLive, blocksAttack, stagger, startBlockImpact } from './actions';
import type { Emit } from './events';
import { hitZoneCapsules, type HitCapsule } from './hitZones';
import type { Direction } from './intent';
import { followMotion, playbackTargets, upperBody } from './motion';
import { bladeAndLeg, fighterPose } from './pose';
import type { AttackAction, BlockAction, FighterState, StaggerCause } from './state';
import { bladeSamples, sweepContact, type Capsule } from './sweep';
import { normalize, scale, sub, type Vec3 } from './vec';

/**
 * A live Blade Sweep touching another Fighter this Tick: a Hit Zone, or (only
 * when the Attack is Blocked by rule) the defender's blade. `blocked` is the
 * Block rule's verdict (ADR 0002); the geometry only decides when it lands.
 */
export type Contact = {
  readonly attacker: number;
  readonly defender: number;
  readonly direction: Direction;
  readonly point: Vec3;
  readonly bladeSpeed: number;
} & ({ readonly blocked: true } | { readonly blocked: false; readonly zone: HitZone; readonly onHead: boolean });

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

export function findContacts(prev: readonly FighterState[], next: readonly FighterState[], tuning: TuningData): Contact[] {
  const contacts: Contact[] = [];
  next.forEach((attacker, i) => {
    const before = prev[i];
    if (!before || attacker.death || !attackSweepLive(before.action, attacker.action)) return;
    const direction = attacker.action.direction;
    const weapon = weaponByName(tuning, attacker.weapon);
    const samples = bladeSamples(weapon.length);
    next.forEach((defender, j) => {
      if (j === i || defender.death) return;
      const zones: Capsule[] = hitZoneCapsules(fighterPose(defender, tuning), tuning);
      const blocked = blocksAttack(defender, attacker, direction, tuning);
      // Whichever the sweep reaches first lands: a Blocking blade stops the Attack where the blades meet.
      const c = sweepContact(before.blade, attacker.blade, blocked ? [weaponCapsule(defender, tuning), ...zones] : zones, samples);
      if (!c) return;
      const at = { attacker: i, defender: j, direction, point: c.point, bladeSpeed: c.bladeSpeed };
      contacts.push(blocked ? { ...at, blocked } : { ...at, blocked, zone: (c.capsule as HitCapsule).zone, onHead: onHead(weapon, c.along) });
    });
  });
  return contacts;
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
  tuning: TuningData,
  emit: Emit,
): FighterState[] {
  const out = fighters.slice();
  for (const c of contacts) resolveContact(fighters, out, c, tuning, emit);
  return out;
}

/** Put a Fighter into Stagger, interrupting its Action (and re-solving its blade for the new Motion). */
export function staggerFighter(f: FighterState, index: number, cause: StaggerCause, tuning: TuningData, emit: Emit): FighterState {
  // A blocked attacker keeps the upper body it was blocked in (the Recoil holds it) rather than recoiling through its Motion.
  const hold = cause === 'Blocked' ? upperBody(playbackTargets(tuning, f.weapon, f.motion)) : undefined;
  const { action, motion } = stagger(cause, hold);
  emit({ type: 'Stagger', fighter: index, cause });
  const staggered = { ...f, action, motion: followMotion(tuning, f.weapon, f.motion, motion) };
  return { ...staggered, ...bladeAndLeg(fighterPose(staggered, tuning)) };
}

/**
 * One contact. Blocked (by rule, ADR 0002): no damage, the attacker recoils
 * into Stagger and the defender's sword hand absorbs the blow (Block Impact). Otherwise a hit: the defender takes damage and Staggers.
 * A hit on a teammate Staggers it all the same but deals no damage.
 */
function resolveContact(before: readonly FighterState[], out: FighterState[], c: Contact, tuning: TuningData, emit: Emit): void {
  const attacker = before[c.attacker]!;
  const defender = before[c.defender]!;
  const action = attacker.action as AttackAction;
  if (action.landed) return;
  if (c.blocked) {
    emit({ type: 'Block', attacker: c.attacker, defender: c.defender, direction: c.direction, point: c.point, bladeSpeed: c.bladeSpeed });
    out[c.attacker] = staggerFighter(out[c.attacker]!, c.attacker, 'Blocked', tuning, emit);
    // The blow still lands on the blade: the defender's hand gives and bounces back (Block Impact). Its first Tick moves nothing, so the blade stands.
    const blocking = defender as FighterState & { readonly action: BlockAction };
    out[c.defender] = { ...out[c.defender]!, blockImpact: startBlockImpact(attacker, blocking, c.bladeSpeed, tuning) };
    return;
  }
  const damage = attacker.team === defender.team ? 0 : hitDamage(tuning, weaponByName(tuning, attacker.weapon), c.zone, c.bladeSpeed, c.onHead);
  const current = out[c.attacker]!;
  // A Trade: the attacker may already be Staggered by the other hit this Tick; leave that be.
  if (current.action.kind === 'Attack') out[c.attacker] = { ...current, action: { ...current.action, landed: true, lodge: LODGE_TICKS } };
  const hurt = out[c.defender]!;
  const { attacker: a, defender: d, direction, zone, point, bladeSpeed, onHead: head } = c;
  emit({ type: 'Hit', attacker: a, defender: d, direction, zone, point, bladeSpeed, head, damage });
  out[c.defender] = staggerFighter({ ...hurt, hp: Math.max(0, hurt.hp - damage) }, c.defender, 'Hit', tuning, emit);
}
