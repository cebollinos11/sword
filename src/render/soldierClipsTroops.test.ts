import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { soldierClips } from './soldierClips';

const tuning = loadTuningData();

describe("Every Troop's soldier clips", () => {
  it.each(tuning.battle.troops.map((t) => [t.name, t.weapon]))('records %s (%s)', (_, weapon) => {
    const clips = soldierClips(tuning, weapon);
    for (const s of Object.values(clips.seconds)) expect(s).toBeGreaterThan(0);
  });
});
