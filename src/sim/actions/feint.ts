/**
 * Feints: cancelling an Attack's Wind-up into a different Action. Decided
 * purely from the Intent, so every Controller (Local, AI, Remote) gets
 * Feints for free:
 *
 * - Attack Feint: keep attack held and change `direction` during Wind-up. The
 *   Wind-up is cancelled and a fresh Wind-up starts in the new Direction.
 * - Block Feint: press block during Wind-up. The Wind-up is cancelled and a
 *   Block is raised in the Intent's `direction`.
 *
 * An Attack Feint carries the Spin-up's charge into the new Wind-up; a Block Feint drops it.
 *
 * Only Wind-up can be cancelled: Release and Recovery are committed. An Attack Feint compares the Direction the
 * Weapon would Attack in (`attackDirectionOf`): with a Flail, Thrust held through an Overhead is no Feint.
 */
import type { AttackAction } from '../state';
import { attackDirectionOf, startAttack, windUpCharge } from './attack';
import { startBlock } from './block';
import type { ActionHandler, ActionUpdate } from './types';

/** Cancels a Wind-up when the Intent asks for a Feint; null when it doesn't (the Attack carries on). */
export const feint: (...args: Parameters<ActionHandler<AttackAction>>) => ActionUpdate | null = (f, intent, ctx) => {
  const a = f.action;
  if (a.phase !== 'Wind-up') return null;
  const attackIn = attackDirectionOf(f, intent.direction, ctx.tuning);
  const toBlock = intent.block;
  if (!toBlock && !(intent.attack && attackIn !== a.direction)) return null;
  ctx.emit({
    type: 'Feint',
    fighter: ctx.fighter,
    from: a.direction,
    into: toBlock ? { kind: 'Block', direction: intent.direction } : { kind: 'Attack', direction: attackIn },
  });
  if (toBlock) return startBlock(f, intent, ctx);
  // An Attack Feint keeps the Spin-up's charge (the ball keeps turning into the new Direction), and its Tick is a Wind-up Tick
  // like any other: one more. A Block Feint drops it with the Attack.
  return startAttack(f, intent, ctx, a.charge === undefined ? undefined : windUpCharge(f, a.charge, ctx.tuning));
};
