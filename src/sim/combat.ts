/**
 * Combat resolution for one Tick, after every Fighter has moved and been
 * re-solved:
 *   1. findContacts: each live Blade Sweep (last Tick's blade → this Tick's)
 *      is tested against every other Fighter's Hit Zones.
 *   2. resolveContacts: every contact is resolved against the same
 *      pre-resolution state, so two Attacks landing on one Tick both count.
 * Later tickets hook in at resolveContact (Blocks by rule, Stagger on hit).
 */
import type { HitZone, TuningData } from '../tuning';
import { attackSweepLive } from './actions';
import type { Emit } from './events';
import { hitZoneCapsules } from './hitZones';
import type { Direction } from './intent';
import { motionPose } from './pose';
import type { AttackAction, FighterState } from './state';
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
      const pose = motionPose(tuning, defender.motion.name, defender.motion.tick, defender);
      const c = sweepContact(before.blade, attacker.blade, hitZoneCapsules(pose, tuning));
      if (c) contacts.push({ attacker: i, defender: j, direction, zone: c.capsule.zone, point: c.point, bladeSpeed: c.bladeSpeed });
    });
  });
  return contacts;
}

/** Apply this Tick's contacts. Each Attack lands at most once. */
export function resolveContacts(
  fighters: readonly FighterState[],
  contacts: readonly Contact[],
  tuning: TuningData,
  emit: Emit,
): FighterState[] {
  const out = fighters.slice();
  for (const c of contacts) resolveContact(out, c, tuning, emit);
  return out;
}

/** One contact: a hit that damages the defender and marks the Attack as landed. */
function resolveContact(fighters: FighterState[], c: Contact, tuning: TuningData, emit: Emit): void {
  const attacker = fighters[c.attacker]!;
  const defender = fighters[c.defender]!;
  const action = attacker.action as AttackAction;
  if (action.landed) return;
  const damage = hitDamage(tuning, c.zone, c.bladeSpeed);
  fighters[c.attacker] = { ...attacker, action: { ...action, landed: true } };
  fighters[c.defender] = { ...defender, hp: Math.max(0, defender.hp - damage) };
  emit({ type: 'Hit', ...c, damage });
}
