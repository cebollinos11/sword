/**
 * Combat resolution for one Tick, after every Fighter has moved and been
 * re-solved:
 *   1. findContacts: each live Blade Sweep (last Tick's blade → this Tick's)
 *      is tested against every other Fighter's Hit Zones.
 *   2. resolveContacts: every contact is resolved against the same
 *      pre-resolution state, so two Attacks landing on one Tick both count.
 *   3. resolveContact: a Block by rule, or a hit that Staggers the victim.
 */
import type { HitZone, TuningData } from '../tuning';
import { attackSweepLive, blocksAttack, stagger } from './actions';
import type { Emit } from './events';
import { hitZoneCapsules } from './hitZones';
import type { Direction } from './intent';
import { fighterPose } from './pose';
import type { AttackAction, FighterState, StaggerCause } from './state';
import { sweepContact } from './sweep';
import type { Vec3 } from './vec';

/** A live Blade Sweep touching a Hit Zone of another Fighter this Tick. */
export interface Contact {
  readonly attacker: number;
  readonly defender: number;
  readonly direction: Direction;
  readonly zone: HitZone;
  readonly point: Vec3;
  readonly bladeSpeed: number;
}

/** Damage = Weapon damage × (Blade Speed / Weapon reference speed) × Hit Zone multiplier. */
export function hitDamage(tuning: TuningData, zone: HitZone, bladeSpeed: number): number {
  return tuning.weapon.damage * (bladeSpeed / tuning.weapon.speed) * tuning.hitZones[zone].multiplier;
}

export function findContacts(prev: readonly FighterState[], next: readonly FighterState[], tuning: TuningData): Contact[] {
  const contacts: Contact[] = [];
  next.forEach((attacker, i) => {
    const before = prev[i];
    if (!before || !attackSweepLive(before.action, attacker.action)) return;
    const direction = attacker.action.direction;
    next.forEach((defender, j) => {
      if (j === i) return;
      const pose = fighterPose(defender, tuning);
      const c = sweepContact(before.blade, attacker.blade, hitZoneCapsules(pose, tuning));
      if (c) contacts.push({ attacker: i, defender: j, direction, zone: c.capsule.zone, point: c.point, bladeSpeed: c.bladeSpeed });
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
  const { action, motion } = stagger(cause);
  emit({ type: 'Stagger', fighter: index, cause });
  const staggered = { ...f, action, motion };
  return { ...staggered, blade: fighterPose(staggered, tuning).blade };
}

/**
 * One contact. Blocked by rule (ADR 0002): no damage, the attacker recoils
 * into Stagger. Otherwise a hit: the defender takes damage and Staggers.
 */
function resolveContact(before: readonly FighterState[], out: FighterState[], c: Contact, tuning: TuningData, emit: Emit): void {
  const attacker = before[c.attacker]!;
  const defender = before[c.defender]!;
  const action = attacker.action as AttackAction;
  if (action.landed) return;
  if (blocksAttack(defender, attacker, c.direction, tuning)) {
    emit({ type: 'Block', attacker: c.attacker, defender: c.defender, direction: c.direction });
    out[c.attacker] = staggerFighter(out[c.attacker]!, c.attacker, 'Blocked', tuning, emit);
    return;
  }
  const damage = hitDamage(tuning, c.zone, c.bladeSpeed);
  const current = out[c.attacker]!;
  // A Trade: the attacker may already be Staggered by the other hit this Tick; leave that be.
  if (current.action.kind === 'Attack') out[c.attacker] = { ...current, action: { ...current.action, landed: true } };
  const hurt = out[c.defender]!;
  emit({ type: 'Hit', ...c, damage });
  out[c.defender] = staggerFighter({ ...hurt, hp: Math.max(0, hurt.hp - damage) }, c.defender, 'Hit', tuning, emit);
}
