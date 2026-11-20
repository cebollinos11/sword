import { describe, expect, it } from 'vitest';
import type { SimEvent, SimState } from '../sim';
import { damageNumbersFor } from './damageNumbers';

const fighters = [{ position: { x: 1, z: 2 }, y: 0, size: { height: 2 } }, { position: { x: 5, z: 6 }, y: 0, size: { height: 2 } }] as unknown as SimState['fighters'];
const point = { x: 3, y: 1, z: 4 };

describe('damageNumbersFor', () => {
  it('numbers damage at the contact point, marking the local Fighter', () => {
    const events = [
      { type: 'Hit', attacker: 0, defender: 1, damage: 12, point },
      { type: 'DaggerHit', thrower: 1, defender: 0, damage: 5, point },
    ] as unknown as SimEvent[];
    expect(damageNumbersFor(events, fighters, 0).map((n) => [n.amount, n.mine])).toEqual([[12, false], [5, true]]);
  });

  it('shows nothing for a blow that deals no damage', () => {
    const events = [{ type: 'Hit', attacker: 0, defender: 1, damage: 0, point }, { type: 'Land', fighter: 0, height: 1, damage: 0 }] as unknown as SimEvent[];
    expect(damageNumbersFor(events, fighters, 0)).toEqual([]);
  });

  it('puts a landing over the Fighter', () => {
    const events = [{ type: 'Land', fighter: 1, height: 9, damage: 20 }] as unknown as SimEvent[];
    expect(damageNumbersFor(events, fighters, 0)[0]!.point).toEqual({ x: 5, y: 1.6, z: 6 });
  });
});
