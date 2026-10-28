import { describe, expect, it } from 'vitest';
import { GENERATOR_VERSION } from '../sim/arenaGen/version';
import { loadTuningData, tuningDataHash, withWeapon, type TuningData } from './index';

const tuning = loadTuningData();

describe('Tuning Data content hash', () => {
  it('is a stable 8-hex digest of the whole Tuning Data set', () => {
    expect(tuningDataHash(tuning)).toMatch(/^[0-9a-f]{8}$/);
    expect(tuningDataHash(loadTuningData())).toBe(tuningDataHash(tuning));
  });

  it('ignores key order (content only)', () => {
    const reordered: TuningData = { motions: tuning.motions, skeleton: tuning.skeleton, hitZones: tuning.hitZones, weapons: tuning.weapons, motionOverrides: tuning.motionOverrides, arena: tuning.arena, arenas: tuning.arenas, kits: tuning.kits, fall: tuning.fall, fighter: tuning.fighter, chamber: tuning.chamber, kick: tuning.kick, dagger: tuning.dagger, ai: tuning.ai, match: tuning.match, dungeon: tuning.dungeon, relics: tuning.relics, block: tuning.block, gait: tuning.gait, camera: tuning.camera };
    expect(tuningDataHash(reordered)).toBe(tuningDataHash(tuning));
  });

  it('changes when any value changes, including inside a Motion', () => {
    const weapon: TuningData = withWeapon(tuning, { damage: tuning.weapons['Arming Sword']!.damage + 1 });
    const idle = tuning.motions.Idle!;
    const motion: TuningData = { ...tuning, motions: { ...tuning.motions, Idle: { ...idle, duration: idle.duration + 0.01 } } };
    const gait: TuningData = { ...tuning, gait: { ...tuning.gait, stepHeight: tuning.gait.stepHeight + 0.01 } };
    const hipBob: TuningData = { ...tuning, gait: { ...tuning.gait, hipBob: tuning.gait.hipBob + 0.01 } };
    const hipSway: TuningData = { ...tuning, gait: { ...tuning.gait, hipSway: tuning.gait.hipSway + 0.01 } };
    const kick: TuningData = { ...tuning, kick: { ...tuning.kick, shoveDamage: tuning.kick.shoveDamage + 1 } };
    expect(tuningDataHash(kick)).not.toBe(tuningDataHash(tuning));
    const dagger: TuningData = { ...tuning, dagger: { ...tuning.dagger, damage: tuning.dagger.damage + 1 } };
    expect(tuningDataHash(dagger)).not.toBe(tuningDataHash(tuning));
    expect(tuningDataHash(weapon)).not.toBe(tuningDataHash(tuning));
    expect(tuningDataHash(motion)).not.toBe(tuningDataHash(tuning));
    expect(tuningDataHash(gait)).not.toBe(tuningDataHash(tuning));
    expect(tuningDataHash(hipBob)).not.toBe(tuningDataHash(tuning));
    expect(tuningDataHash(hipSway)).not.toBe(tuningDataHash(tuning));
  });

  it('covers the AI Styles, their knobs and ai.duckMaxPitch', () => {
    const base = tuningDataHash(tuning);
    const styles: TuningData = { ...tuning, ai: { ...tuning.ai, styles: { ...tuning.ai.styles, Counter: { ...tuning.ai.styles.Counter, whiffCheck: 2 } } } };
    const knob: TuningData = { ...tuning, ai: { ...tuning.ai, difficulties: { ...tuning.ai.difficulties, Expert: { ...tuning.ai.difficulties.Expert!, holdBreak: 0.5 } } } };
    const pitch: TuningData = { ...tuning, ai: { ...tuning.ai, duckMaxPitch: tuning.ai.duckMaxPitch - 1 } };
    for (const changed of [styles, knob, pitch]) expect(tuningDataHash(changed)).not.toBe(base);
  });

  it('covers Sheathe and Draw: the five Motions, the back-slot overrides, each Weapon’s sheathe slot and fighter.sheathedWalkFactor', () => {
    const base = tuningDataHash(tuning);
    for (const name of ['SheatheHip', 'DrawHip', 'SheatheBack', 'DrawBack', 'SheathedIdle']) {
      const m = tuning.motions[name]!;
      expect(m, name).toBeDefined();
      expect(tuningDataHash({ ...tuning, motions: { ...tuning.motions, [name]: { ...m, duration: m.duration + 0.01 } } }), name).not.toBe(base);
    }
    for (const weapon of ['Halberd', 'Sledge Hammer']) {
      const own = tuning.motionOverrides[weapon]!;
      for (const name of ['SheatheBack', 'DrawBack']) {
        const m = own[name]!;
        expect(m, `${weapon}/${name}`).toBeDefined();
        const changed = { ...tuning.motionOverrides, [weapon]: { ...own, [name]: { ...m, duration: m.duration + 0.01 } } };
        expect(tuningDataHash({ ...tuning, motionOverrides: changed }), `${weapon}/${name}`).not.toBe(base);
      }
    }
    for (const [name, weapon] of Object.entries(tuning.weapons)) {
      const { slot, offset, rotation } = weapon.sheathe;
      const moved = (sheathe: typeof weapon.sheathe) => tuningDataHash(withWeapon(tuning, { sheathe }, name));
      expect(moved({ slot: slot === 'hip' ? 'back' : 'hip', offset, rotation }), name).not.toBe(base);
      expect(moved({ slot, offset: { ...offset, x: offset.x + 0.01 }, rotation }), name).not.toBe(base);
      expect(moved({ slot, offset, rotation: { ...rotation, y: rotation.y + 0.01 } }), name).not.toBe(base);
    }
    const faster: TuningData = { ...tuning, fighter: { ...tuning.fighter, sheathedWalkFactor: tuning.fighter.sheathedWalkFactor + 0.1 } };
    expect(tuningDataHash(faster)).not.toBe(base);
  });

  it('covers the Dungeon (dungeon.json): its Doors, an Encounter, a Boss, the loot and the inventory sizes', () => {
    const base = tuningDataHash(tuning);
    const d = tuning.dungeon;
    const [first, ...rest] = d.floors;
    const fight = first!.encounters.Fight;
    const enemy = fight[0]!.enemies[0]!;
    const encounter = { ...first!, encounters: { ...first!.encounters, Fight: [{ enemies: [{ ...enemy, hpScale: enemy.hpScale + 0.1 }, ...fight[0]!.enemies.slice(1)] }, ...fight.slice(1)] } };
    for (const [name, dungeon] of Object.entries({
      doorSeconds: { ...d, doorSeconds: d.doorSeconds + 0.1 },
      hallFadeSeconds: { ...d, hallFadeSeconds: d.hallFadeSeconds + 0.1 },
      encounter: { ...d, floors: [encounter, ...rest] },
      boss: { ...d, floors: [{ ...first!, boss: { enemies: [{ ...first!.boss.enemies[0]!, hpScale: first!.boss.enemies[0]!.hpScale + 0.1 }] } }, ...rest] },
      loot: { ...d, loot: { ...d.loot, pedestals: d.loot.pedestals === 1 ? 2 : 1 } },
      inventory: { ...d, inventory: { ...d.inventory, relics: d.inventory.relics + 1 } },
      revive: { ...d, revive: d.revive + 0.05 },
    })) expect(tuningDataHash({ ...tuning, dungeon }), name).not.toBe(base);
    expect(tuningDataHash({ ...tuning, dungeon: { ...d } })).toBe(base);
  });

  it('covers the Relics (relics.json): an effect, a name, a new Relic, and their order', () => {
    const base = tuningDataHash(tuning);
    const [first, ...rest] = tuning.relics;
    const key = Object.keys(first!.effects)[0] as keyof NonNullable<typeof first>['effects'];
    const changed: Record<string, TuningData['relics']> = {
      effect: [{ ...first!, effects: { ...first!.effects, [key]: first!.effects[key]! + 0.1 } }, ...rest],
      name: [{ ...first!, name: `${first!.name} II` }, ...rest],
      added: [...tuning.relics, { ...first!, name: 'Extra' }],
      removed: rest,
      reordered: [...rest, first!],
    };
    for (const [name, relics] of Object.entries(changed)) expect(tuningDataHash({ ...tuning, relics }), name).not.toBe(base);
    expect(tuningDataHash({ ...tuning, relics: [...tuning.relics] })).toBe(base);
  });

  it('changes with GENERATOR_VERSION, so peers whose generators could build different Layouts refuse each other', () => {
    expect(tuningDataHash(tuning, GENERATOR_VERSION)).toBe(tuningDataHash(tuning));
    expect(tuningDataHash(tuning, GENERATOR_VERSION + 1)).not.toBe(tuningDataHash(tuning));
  });

  it('ignores the camera (presentation only)', () => {
    const camera: TuningData = { ...tuning, camera: { ...tuning.camera, back: tuning.camera.back + 1 } };
    expect(tuningDataHash(camera)).toBe(tuningDataHash(tuning));
  });
});
