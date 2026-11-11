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
 * Only Wind-up can be cancelled: Release and Recovery are committed. An Attack Feint compares the Direction the
 * Weapon would Attack in (`attackDirectionOf`): with a Flail, Thrust held through an Overhead is no Feint.
 */
import type { AttackAction } from '../state';
import { attackDirectionOf, startAttack } from './attack';
import { startBlock } from './block';
import type { ActionHandler, ActionUpdate } from './types';

/** Cancels a Wind-up when the Intent asks for a Feint; null when it doesn't (the Attack carries on). */
export const feint: (...args: Parameters<ActionHandler<AttackAction>>) => ActionUpdate | null = (f, intent, ctx) => {
  const a = f.action;
  if (a.phase !== 'Wind-up') return null;
  const attackIn = attackDirectionOf(f, intent.direction, ctx.tuning);
  const into = intent.block ? startBlock : intent.attack && attackIn !== a.direction ? startAttack : null;
  if (!into) return null;
  ctx.emit({
    type: 'Feint',
    fighter: ctx.fighter,
    from: a.direction,
    into: into === startBlock ? { kind: 'Block', direction: intent.direction } : { kind: 'Attack', direction: attackIn },
  });
  return into(f, intent, ctx);
};
