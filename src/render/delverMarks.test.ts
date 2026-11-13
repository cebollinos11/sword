import { describe, expect, it } from 'vitest';
import { fireStates } from './delverMarks';

describe('the Delver Floor’s fires as the local Player sees them', () => {
  it('burns each fire until the viewer is among those who took its heal, then embers, in fire order', () => {
    const used = [
      { revived: true, healed: [0, 2] },
      { revived: false, healed: [] },
      { revived: true, healed: [1] },
    ];
    expect(fireStates(used, 0)).toEqual(['embers', 'lit', 'lit']);
    expect(fireStates(used, 1)).toEqual(['lit', 'lit', 'embers']);
    expect(fireStates(used, -1)).toEqual(['lit', 'lit', 'lit']);
    expect(fireStates([], 0)).toEqual([]);
  });
});
