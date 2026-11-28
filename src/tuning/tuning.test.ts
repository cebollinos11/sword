import { describe, expect, it } from 'vitest';
import { DEFAULT_DISMEMBER, loadTuningData, motionFileName, parseMotion, parseTuningData, serializeMotion, styleEntry, styleParts, TuningDataError } from './index';

/** A minimal valid raw Tuning Data set (independent of the repo files). */
function goodRaw() {
  return {
    fighter: { maxHp: 100, walkSpeed: 2, radius: 0.3, height: 1.8, turnSpeed: 360, motionBlend: 0.15, lookPitchMax: 50, lookLean: 0.45, lookHipShift: 0.3, crouchDepth: 0.4, crouchSpeed: 6, crouchWalkFactor: 0.5, sheathedWalkFactor: 1.6, backwardWalkFactor: 0.6, lyingHitFactor: 2 },
    arena: { match: 'flat', editor: 'flat' },
    arenas: [{ name: 'flat', radius: 8, walk: [{ id: 'WALK_floor', points: [[-8, 0, -8], [8, 0, -8], [8, 0, 8], [-8, 0, 8]] }] }],
    fall: { gravity: 14, jumpSpeed: 4.8, jumpBoost: 20, jumpBoostDelay: 0.12, jumpBoostTime: 0.35, airControl: 4, fallDelay: 0.2, safeHeight: 1.6, damagePerMetre: 22, knockdownDamageFactor: 2, stepUp: 0.35, snapDown: 0.4 },
    weapons: [{ name: 'Sword', grip: 'oneHanded', length: 0.9, damage: 30, speed: 10, gripLength: 0.12, sheathe: { slot: 'hip', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } }],
    hitZones: {
      head: { multiplier: 1.5, radius: 0.11 },
      torso: { multiplier: 1, radius: 0.15 },
      limbs: { multiplier: 0.6, radius: 0.06 },
      legs: { multiplier: 0.6, radius: 0.09 },
    },
    chamber: { windowSeconds: 0.15 },
    kick: { knockdownDamage: 5, shoveDamage: 1, knockdownSlide: 2.5, shoveSlide: 0.3, knockdownSlideTicks: 24, shoveSlideTicks: 6, knockdownTicks: 60, whiffRecovery: 24, legRadius: 0.08 },
    whirlwind: { armSeconds: 1, holdWalkFactor: 0.4, turns: 5, turnSeconds: 0.3, driveSpeed: 3, steerSpeed: 90, damageFactor: 0.5, knockdownSlide: 1.5, knockdownSlideTicks: 24, blockSlide: 0.4, blockSlideTicks: 8, allySlide: 0.5, allySlideTicks: 12, recoverySeconds: 0.5, unavailableWeapons: [] as string[] },
    dagger: { count: 3, speed: 18, gravity: 9.8, loft: 4, homingCone: 25, homingRange: 20, homingTurn: 60, radius: 0.04, maxTicks: 90, damage: 5, slowFactor: 0.6, slowTicks: 180, throwWalkFactor: 1, maxHoldTicks: 120, blockImpact: 0.3 },
    block: { facingHalfAngle: 60, bladeRadius: 0.05, impactDistance: 0.12, impactTilt: 15, impactLean: 5, impactFrequency: 4, impactDuration: 0.2, correctionWindow: 0.15 },
    match: { duelDistance: 2, interDuelSeconds: 2, lineSpacing: 1.5 },
    dungeon: {
      stairsSeconds: 1.5,
      fadeSeconds: 1,
      revive: 0.25,
      restHeal: 0.5,
      perPlayerHp: 0.5,
      depthHp: 0.1,
      inventory: { weapons: 3, relics: 6, equippedRelics: 3 },
      loot: { weights: { Relic: 4, Weapon: 1 }, drops: { Fight: 1, Elite: 0, Boss: 2 }, pedestals: 3, rarity: { multipliers: { Common: 1, Rare: 1.5, Legendary: 2 }, weaponDamage: { Common: 1, Rare: 1.15, Legendary: 1.3 }, odds: [[80, 18, 2]], eliteTierStep: 1, bossMin: 'Rare', pedestalMin: 'Rare', carried: ['Common'], bossCarriedStep: 1 } },
      floors: [{ rows: [2, 2, 2], weights: { Fight: 1 }, encounters: { Fight: [{ enemies: [{ difficulty: 'Normal', weapon: 'random' }] }] }, boss: { enemies: [{ difficulty: 'Normal', weapon: 'random' }] } }],
    },
    delver: { tiers: 1, floorsPerTier: 1, flowCell: 2, fireRadius: 3, descendSeconds: 4, sight: 16, leash: 45, forgetSeconds: 8, chaseSpeed: 1, closeIn: 4, arrive: 3, postFill: 75, patrolFill: 100, perPlayerSoldiers: 1.5, attackSlots: [4, 3, 3, 3], tierHp: [1], prefabsPerFloor: 1, sizeHp: [30, 150], skillTints: {}, troops: [{ name: 'Soldier', body: 'female', weapon: 'Sword', variants: [{ difficulty: 'Normal', hp: 50 }] }], warbands: [{ guard: [{ troops: [{ skill: 'Normal', count: 3 }], hpScale: 1 }], patrol: [{ troops: [{ skill: 'Normal', count: 3 }], hpScale: 1 }] }], floor: { cols: 2, rows: 2, rooms: 2, gaps: [20], halfSize: [4, 6], minPassage: 4, passage: 3, farPercent: 25, loops: [0, 1], rests: [1, 1], treasures: 0, emptyPercent: 30, patrols: 0, follow: 1.5, maxAttempts: 3, levels: { max: 4, min: 2, changePercent: 35, galleryPercent: 40 }, galleries: { wrapPercent: 0, uPercent: 30, stairPercent: 0 }, features: { percent: 0, weights: { split: 1, pit: 1 }, threePercent: 40, deepPercent: [25, 40, 55], daisPercent: 0 }, turnPercent: 0, great: { count: [0, 0], half: [8, 12] }, shapes: { percent: 0, weights: { L: 3, T: 2, cross: 2, ring: 2 } }, pillars: { percent: 0, weights: { colonnade: 1, grid: 1 } }, lava: { percent: [0, 0, 0], weights: { pit: 2, river: 2, trough: 3 }, twoPercent: 40 }, setPieces: { percent: [0, 0, 0], weights: { cross: 1, uphill: 1, spiral: 1, room: 0 } } } },
    relics: [],
    battle: {
      armySize: 20,
      field: { size: 100, cell: 10, hillHeight: 1, hillLength: 50 },
      deploy: { front: 10, perRank: 10 },
      crowd: { stagger: 6, walkSpeed: 2.5, hp: 100, damage: [8, 20], hitChance: 0.35, engageReach: 1.6, separation: 0.9, sight: 12, flowCell: 4 },
      squad: { size: 12, spacing: 1.5, turnRate: 1.2, catchUp: 1.2, speed: 0.8, lag: 6, brainSeconds: 0.5, moraleThreshold: 0.3, looseBelow: 0.5, engage: 15, mergeRange: 6, mergeMax: 16, baseDistance: 45, column: { wide: 3 }, line: { wide: 6 }, loose: { spread: 0.8 }, narrow: { room: 3, ahead: 6 } },
      objectives: { radius: 8, spawnRadius: 12, playerCount: 3, captureSeconds: 0.5, rate: 0.01, maxRate: 0.08, openField: [{ id: 'A', x: 0, z: 0, weight: 1, owner: -1, spawn: false }] },
      tickets: { perSoldier: 2, drain: 0.3, limitSeconds: 900, respawnSeconds: 10 },
      commander: { planSeconds: 2.5, holdSeconds: 15, stick: 0.25, falloff: 0.8, distance: 0.003, threatRadius: 30, danger: 0.15, attack: 1, retake: 1.2, garrison: 0.3, garrisonSquads: 1, defend: 1.5 },
      rout: { threshold: 0.2, seconds: 5 },
      soldier: { body: 'female', weapon: 'Sword', colours: ['#f1c40f', '#2e86c1'], difficulty: 'Normal', style: {}, mods: {} },
      bubble: { poolSize: 16, promote: 10, demote: 16, minPromotedSeconds: 1, corpseSeconds: 3, hold: 3 },
      slots: { enemies: 4, allies: 3, engaged: 2.5, shared: [] },
      ring: { radius: 3.5, spacing: 1.2, pathAhead: 3, pathWidth: 0.8, waiting: 8 },
      takeover: { seconds: 1.5, pickSeconds: 0.5, hp: 100 },
      levels: { stepUp: 0.35, drop: 3, height: 1.8, promote: 2.5 },
    },
    gait: { strideThreshold: 0.2, strideLength: 0.6, squareUp: 0.8, maxLead: 0.3, stepDuration: 0.1, stepHeight: 0.08, hipBob: 0.02, hipSway: 0.02, hipTwist: 8, toeRoll: 25, runSpeed: 3.2, runStepDuration: 0.2, runContact: 0.65, runStepHeight: 0.3, runBob: 0.04 },
    camera: { back: 3, shoulder: 0.7, eyeHeight: 2, ahead: 2.5, lookHeight: 1.2, orbitDistance: 7, orbitHeight: 5, finalBlowLead: 0.35, finalBlowTail: 0.55, finalBlowSpeed: 0.3, finalBlowDistance: 3.4, finalBlowHeight: 1.6, finalBlowSpin: 0.35, shake: 1 },
    skeleton: {
      pelvisHeight: 0.95,
      hipWidth: 0.2,
      thigh: 0.46,
      shin: 0.46,
      ankleHeight: 0.06,
      spine: 0.5,
      shoulderWidth: 0.4,
      neck: 0.1,
      headRadius: 0.11,
      upperArm: 0.3,
      forearm: 0.28,
    },
    ai: {
      attackRange: 1.4,
      retreatRange: 0.9,
      kickRange: 1,
      kickRate: 0.1,
      throwRange: 12,
      throwRate: 0.04,
      aggression: 0.05,
      duckMaxPitch: -1,
      difficulties: { Normal: { reactionTime: 0.25, mistakeRate: 0.2, feintRate: 0.1 } },
      styles: { Balanced: {} },
    },
    motions: [
      {
        name: 'Idle',
        duration: 1,
        loop: true,
        poseKeys: [{ time: 0, ease: 'linear', hip: { x: 0, y: 0.9, z: 0 } }],
      },
    ],
  };
}

describe('Tuning Data', () => {
  it('refuses a Relic whose damage taken Legendary would take to 0 or below, and accepts one that stays above', () => {
    const good = goodRaw();
    const withRelic = (effects: object) => ({ ...good, relics: [{ name: 'Test Plate', icon: 'plate', effects }] });
    expect(() => parseTuningData(withRelic({ damageTaken: 0.5 }))).toThrow(/Test Plate.*damageTaken 0\.5 at Legendary/);
    expect(() => parseTuningData(withRelic({ blockImpactTaken: 0.5 }))).toThrow(/blockImpactTaken/);
    expect(parseTuningData(withRelic({ damageTaken: 0.51 })).relics[0]!.effects).toEqual({ damageTaken: 0.51 });
    expect(loadTuningData().relics.length).toBeGreaterThan(0);
  });

  it('refuses a Rarity odds or carried table whose length is not delver.tiers', () => {
    const good = goodRaw();
    const withRarity = (patch: object) => ({ ...good, dungeon: { ...good.dungeon, loot: { ...good.dungeon.loot, rarity: { ...good.dungeon.loot.rarity, ...patch } } } });
    expect(parseTuningData(good).dungeon.loot.rarity.odds).toHaveLength(1);
    expect(() => parseTuningData(withRarity({ odds: [[80, 18, 2], [60, 32, 8]] }))).toThrow(/dungeon\.loot\.rarity\.odds must have 1 rows .*got 2/);
    expect(() => parseTuningData(withRarity({ odds: [] }))).toThrow(/rarity\.odds must have 1 rows/);
    expect(() => parseTuningData(withRarity({ carried: ['Common', 'Rare'] }))).toThrow(/dungeon\.loot\.rarity\.carried must have 1 Rarities .*got 2/);
    expect(() => parseTuningData(withRarity({ carried: [] }))).toThrow(/rarity\.carried must have 1 Rarities/);
  });

  it('loads the repo data/ files', () => {
    const t = loadTuningData();
    expect(t.fighter.walkSpeed).toBe(2.5);
    expect(t.arenas.circle!.radius).toBe(8);
    expect(t.arenas[t.arena.match]).toBeDefined();
    expect(t.weapons['Arming Sword']!.length).toBeGreaterThan(0);
    expect(t.hitZones.head.multiplier).toBeGreaterThan(t.hitZones.limbs.multiplier);
    expect(t.chamber.windowSeconds).toBe(0.15);
    expect(Object.keys(t.motions)).toEqual(expect.arrayContaining(['Idle', 'Overhead']));
  });

  it('accepts a minimal valid set', () => {
    const t = parseTuningData(goodRaw());
    expect(t.motions.Idle?.poseKeys[0]?.hip).toEqual({ x: 0, y: 0.9, z: 0 });
  });

  it('loads how far a cut reaches (Dismemberment) from data/fighter.json, with a default when absent', () => {
    expect(loadTuningData().fighter.dismember).toEqual({ carry: 0.25, speed: 22, maxCuts: 3 });
    expect(parseTuningData(goodRaw()).fighter.dismember).toEqual(DEFAULT_DISMEMBER);
    const withCut = (dismember: unknown) => ({ ...goodRaw(), fighter: { ...goodRaw().fighter, dismember } });
    expect(parseTuningData(withCut({ carry: 0.4, speed: 30, maxCuts: 1 })).fighter.dismember).toEqual({ carry: 0.4, speed: 30, maxCuts: 1 });
    expect(() => parseTuningData(withCut({ carry: 0, speed: 30, maxCuts: 1 }))).toThrow(/fighter\.dismember/);
    expect(() => parseTuningData(withCut({ carry: 0.4, speed: 30 }))).toThrow(/maxCuts/);
    expect(() => parseTuningData(withCut({ carry: 0.4, speed: 30, maxCuts: 1.5 }))).toThrow(/whole number/);
  });

  it('rejects invalid data on load', () => {
    const good = goodRaw();
    expect(() => parseTuningData({ ...good, arena: { match: 'nowhere', editor: 'flat' } })).toThrow(TuningDataError);
    expect(() => parseTuningData({ ...good, fighter: { ...good.fighter, walkSpeed: '2' } })).toThrow(/walkSpeed/);
    expect(() => parseTuningData({ ...good, fighter: { ...good.fighter, sheathedWalkFactor: 0 } })).toThrow(/fighter\.sheathedWalkFactor/);
    expect(() => parseTuningData({ ...good, fighter: { ...good.fighter, sheathedWalkFactor: undefined } })).toThrow(/fighter\.sheathedWalkFactor/);
    expect(() => parseTuningData({ ...good, fighter: undefined })).toThrow(/fighter/);
    const sword = good.weapons[0]!;
    expect(() => parseTuningData({ ...good, weapons: [{ ...sword, length: 0 }] })).toThrow(/^weapons\/Sword\.length/);
    expect(() => parseTuningData({ ...good, weapons: [{ ...sword, speed: undefined }] })).toThrow(/^weapons\/Sword\.speed/);
    expect(() => parseTuningData({ ...good, hitZones: { ...good.hitZones, head: { multiplier: 0, radius: 0.1 } } })).toThrow(
      /hitZones\.head\.multiplier/,
    );
    expect(() => parseTuningData({ ...good, hitZones: { head: good.hitZones.head, torso: good.hitZones.torso } })).toThrow(
      /hitZones\.limbs/,
    );
    expect(() => parseTuningData({ ...good, chamber: { windowSeconds: 0 } })).toThrow(/chamber\.windowSeconds/);
    expect(() => parseTuningData({ ...good, chamber: undefined })).toThrow(/chamber/);
    expect(() => parseTuningData({ ...good, skeleton: { ...good.skeleton, forearm: -1 } })).toThrow(/skeleton\.forearm/);
    expect(() => parseTuningData({ ...good, block: undefined })).toThrow(/block/);
    expect(() => parseTuningData({ ...good, block: { ...good.block, facingHalfAngle: 0 } })).toThrow(/block\.facingHalfAngle/);
    expect(() => parseTuningData({ ...good, block: { ...good.block, facingHalfAngle: 181 } })).toThrow(/block\.facingHalfAngle/);
    expect(() => parseTuningData({ ...good, match: undefined })).toThrow(/match/);
    expect(() => parseTuningData({ ...good, match: { duelDistance: 0, interDuelSeconds: 2, lineSpacing: 1.5 } })).toThrow(/match\.duelDistance/);
    expect(() => parseTuningData({ ...good, match: { duelDistance: 2, interDuelSeconds: 0, lineSpacing: 1.5 } })).toThrow(/match\.interDuelSeconds/);
  });

  it('loads the Dagger Tuning Data and its Throw Motion, and rejects bad Dagger data', () => {
    const t = loadTuningData();
    expect(t.dagger).toEqual({ count: 3, speed: 18, gravity: 9.8, loft: 4, homingCone: 25, homingRange: 20, homingTurn: 60, radius: 0.04, maxTicks: 90, damage: 5, slowFactor: 0.05, slowTicks: 180, throwWalkFactor: 1, maxHoldTicks: 120, blockImpact: 0.3 });
    expect(t.motions.Throw!.markers.windUpEnd).toBeLessThan(t.motions.Throw!.markers.releaseEnd!);
    const good = goodRaw();
    expect(() => parseTuningData({ ...good, dagger: undefined })).toThrow(/dagger/);
    expect(() => parseTuningData({ ...good, dagger: { ...good.dagger, slowTicks: 2.5 } })).toThrow(/dagger\.slowTicks/);
    expect(() => parseTuningData({ ...good, dagger: { ...good.dagger, maxTicks: 0 } })).toThrow(/dagger\.maxTicks/);
    expect(() => parseTuningData({ ...good, dagger: { ...good.dagger, count: 1.5 } })).toThrow(/dagger\.count/);
    expect(() => parseTuningData({ ...good, dagger: { ...good.dagger, speed: 0 } })).toThrow(/dagger\.speed/);
  });

  it('loads the Kick Tuning Data and its Motion, and rejects bad Kick data', () => {
    const t = loadTuningData();
    expect(t.kick).toEqual({ knockdownDamage: 5, shoveDamage: 1, knockdownSlide: 1.5, shoveSlide: 0.3, knockdownSlideTicks: 24, shoveSlideTicks: 6, knockdownTicks: 60, whiffRecovery: 24, legRadius: 0.08 });
    expect(t.motions.Kick!.markers.windUpEnd).toBeLessThan(t.motions.Kick!.markers.releaseEnd!);
    const good = goodRaw();
    expect(() => parseTuningData({ ...good, kick: undefined })).toThrow(/kick/);
    expect(() => parseTuningData({ ...good, kick: { ...good.kick, whiffRecovery: 2.5 } })).toThrow(/kick\.whiffRecovery/);
    expect(() => parseTuningData({ ...good, kick: { ...good.kick, legRadius: 0 } })).toThrow(/kick\.legRadius/);
  });

  it('loads the Whirlwind Tuning Data and its hold Motions, and rejects bad Whirlwind data', () => {
    const t = loadTuningData();
    expect(t.whirlwind).toEqual({ armSeconds: 1, holdWalkFactor: 0.4, turns: 5, turnSeconds: 0.3, driveSpeed: 3, steerSpeed: 90, damageFactor: 0.5, knockdownSlide: 1.5, knockdownSlideTicks: 24, blockSlide: 0.4, blockSlideTicks: 8, allySlide: 0.5, allySlideTicks: 12, recoverySeconds: 0.5, unavailableWeapons: ['Flail'] });
    expect(t.motions.WhirlwindHoldLeft).toBeDefined();
    expect(t.motions.WhirlwindHoldRight).toBeDefined();
    const good = goodRaw();
    expect(() => parseTuningData({ ...good, whirlwind: undefined })).toThrow(/whirlwind/);
    expect(() => parseTuningData({ ...good, whirlwind: { ...good.whirlwind, turns: 2.5 } })).toThrow(/whirlwind\.turns/);
    expect(() => parseTuningData({ ...good, whirlwind: { ...good.whirlwind, unavailableWeapons: ['Spear'] } })).toThrow(/whirlwind\.unavailableWeapons/);
    expect(() => parseTuningData({ ...good, whirlwind: { ...good.whirlwind, armSeconds: 0 } })).toThrow(/whirlwind\.armSeconds/);
    expect(() => parseTuningData({ ...good, whirlwind: { ...good.whirlwind, holdWalkFactor: 1.5 } })).toThrow(/whirlwind\.holdWalkFactor/);
    expect(() => parseTuningData({ ...good, whirlwind: { ...good.whirlwind, blockSlideTicks: 1.5 } })).toThrow(/whirlwind\.blockSlideTicks/);
    for (const key of ['knockdownSlideTicks', 'blockSlideTicks', 'allySlideTicks']) {
      expect(() => parseTuningData({ ...good, whirlwind: { ...good.whirlwind, [key]: 0 } }), key).toThrow(new RegExp(`whirlwind\\.${key}`));
    }
    for (const key of ['armSeconds', 'turnSeconds', 'recoverySeconds']) {
      expect(() => parseTuningData({ ...good, whirlwind: { ...good.whirlwind, [key]: 0.001 } }), key).toThrow(new RegExp(`whirlwind\\.${key}`));
    }
    expect(parseTuningData({ ...good, whirlwind: { ...good.whirlwind, unavailableWeapons: ['Sword'] } }).whirlwind.unavailableWeapons).toEqual(['Sword']);
  });

  it('loads the Block facing rule and the Match pacing from data/block.json and data/match.json', () => {
    const t = loadTuningData();
    expect(t.block.facingHalfAngle).toBe(60);
    expect(t.match).toEqual({ duelDistance: 2, interDuelSeconds: 3.5, lineSpacing: 1.5 });
  });

  it('loads AI difficulty presets (Reaction Time, mistake rate) from data/ai.json', () => {
    const t = loadTuningData();
    expect(Object.keys(t.ai.difficulties)).toEqual(['Easy', 'Normal', 'Hard', 'Beginner', 'Skilled', 'Expert']);
    const { Easy, Hard } = t.ai.difficulties;
    expect(Hard!.reactionTime).toBeLessThan(Easy!.reactionTime);
    expect(Hard!.mistakeRate).toBeLessThan(Easy!.mistakeRate);
  });

  it('rejects invalid AI Tuning Data', () => {
    const good = goodRaw();
    const withDifficulty = (d: object) => ({ ...good, ai: { ...good.ai, difficulties: { Normal: d } } });
    expect(() => parseTuningData(withDifficulty({ reactionTime: 0.2, mistakeRate: 1.5, feintRate: 0 }))).toThrow(/ai\.difficulties\.Normal\.mistakeRate/);
    expect(() => parseTuningData(withDifficulty({ reactionTime: -0.1, mistakeRate: 0, feintRate: 0 }))).toThrow(/ai\.difficulties\.Normal\.reactionTime/);
    expect(() => parseTuningData(withDifficulty({ reactionTime: 0.2, mistakeRate: 0 }))).toThrow(/ai\.difficulties\.Normal\.feintRate/);
    expect(() => parseTuningData(withDifficulty({ reactionTime: 0.2, mistakeRate: 0, feintRate: -0.1 }))).toThrow(/ai\.difficulties\.Normal\.feintRate/);
    expect(() => parseTuningData({ ...good, ai: { ...good.ai, difficulties: {} } })).toThrow(/ai\.difficulties/);
    expect(() => parseTuningData({ ...good, ai: { ...good.ai, aggression: 2 } })).toThrow(/ai\.aggression/);
    expect(() => parseTuningData({ ...good, ai: { ...good.ai, kickRate: 2 } })).toThrow(/ai\.kickRate/);
    expect(() => parseTuningData({ ...good, ai: { ...good.ai, kickRange: 0 } })).toThrow(/ai\.kickRange/);
    expect(() => parseTuningData({ ...good, ai: { ...good.ai, throwRate: 2 } })).toThrow(/ai.throwRate/);
    expect(() => parseTuningData({ ...good, ai: { ...good.ai, throwRange: 0 } })).toThrow(/ai.throwRange/);
    expect(parseTuningData(good).ai).toMatchObject({ kickRange: 1, kickRate: 0.1, throwRange: 12, throwRate: 0.04 });
    expect(parseTuningData(withDifficulty({ reactionTime: 0, mistakeRate: 0, feintRate: 1 })).ai.difficulties.Normal).toEqual({ reactionTime: 0, mistakeRate: 0, feintRate: 1 });
    expect(() => parseTuningData(withDifficulty({ reactionTime: 0.2, mistakeRate: 0, feintRate: 0, holdBreak: 1.5 }))).toThrow(/ai\.difficulties\.Normal\.holdBreak/);
    expect(() => parseTuningData({ ...good, ai: { ...good.ai, duckMaxPitch: 'low' } })).toThrow(/ai\.duckMaxPitch/);
  });

  it('loads the AI Styles from data/ai.json: Balanced (the default, empty) first, then Aggressive, Counter, Tricky, Defensive, Chambermaster, Reckless, Showoff, Skirmisher and Pack Hunter', () => {
    const t = loadTuningData();
    expect(Object.keys(t.ai.styles)).toEqual(['Balanced', 'Aggressive', 'Counter', 'Tricky', 'Defensive', 'Chambermaster', 'Reckless', 'Showoff', 'Skirmisher', 'Pack Hunter']);
    expect(t.ai.styles.Balanced).toEqual({});
  });

  it('reads a Style entry in either form as { mul, min } (styleParts) and writes the short form back (styleEntry)', () => {
    expect(styleParts(1.6)).toEqual({ mul: 1.6, min: 0 });
    expect(styleParts({ mul: 3, min: 0.06 })).toEqual({ mul: 3, min: 0.06 });
    expect(styleParts({ min: 0.5 })).toEqual({ mul: 1, min: 0.5 });
    expect(styleEntry(1.6, 0)).toBe(1.6);
    expect(styleEntry(3, 0.06)).toEqual({ mul: 3, min: 0.06 });
    for (const e of [0, 2, { mul: 3, min: 0.06 }, { mul: 0, min: 1 }]) expect(styleEntry(styleParts(e).mul, styleParts(e).min)).toEqual(e);
  });

  it('rejects invalid AI Styles', () => {
    const good = goodRaw();
    const withStyles = (styles: object) => ({ ...good, ai: { ...good.ai, styles } });
    expect(parseTuningData(withStyles({ Balanced: {}, Wary: { caution: 2, whiffCheck: 0.5 } })).ai.styles.Wary).toEqual({ caution: 2, whiffCheck: 0.5 });
    expect(() => parseTuningData(withStyles({}))).toThrow(/ai\.styles\.Balanced/);
    expect(() => parseTuningData(withStyles({ Balanced: { aggression: 2 } }))).toThrow(/ai\.styles\.Balanced/);
    expect(() => parseTuningData(withStyles({ Balanced: {}, Wary: { caution: -1 } }))).toThrow(/ai\.styles\.Wary\.caution/);
    // A Style changes how it fights, never how well: no Reaction Time, mistake rate or jumpNav.
    for (const key of ['reactionTime', 'mistakeRate', 'jumpNav', 'nonsense']) expect(() => parseTuningData(withStyles({ Balanced: {}, Wary: { [key]: 1 } })), key).toThrow(/ai\.styles\.Wary/);
    expect(() => parseTuningData(withStyles({ Balanced: {}, random: {} }))).toThrow(/ai\.styles\.random/);
    // An entry may be a multiplier with a minimum, { mul, min } or { min } alone; each form is kept as written.
    const withMin = parseTuningData(withStyles({ Balanced: {}, Wary: { caution: 2, chamberRate: { mul: 3, min: 0.06 }, whirlwindRate: { min: 0.5 } } })).ai.styles.Wary;
    expect(withMin).toEqual({ caution: 2, chamberRate: { mul: 3, min: 0.06 }, whirlwindRate: { min: 0.5 } });
    expect(parseTuningData(withStyles({ Balanced: {}, Wary: { caution: { mul: 0, min: 1 } } })).ai.styles.Wary).toEqual({ caution: { mul: 0, min: 1 } });
    const refused: [unknown, RegExp][] = [
      [{ mul: 2, min: 1.1 }, /ai\.styles\.Wary\.caution\.min must be between 0 and 1/],
      [{ mul: 2, min: -0.1 }, /ai\.styles\.Wary\.caution\.min must be between 0 and 1/],
      [{ mul: -1, min: 0.1 }, /ai\.styles\.Wary\.caution\.mul must be a number >= 0/],
      [{ mul: 2 }, /ai\.styles\.Wary\.caution: an object entry needs a min/],
      [{}, /ai\.styles\.Wary\.caution: an object entry needs a min/],
      [{ mul: 2, min: 0.1, max: 1 }, /ai\.styles\.Wary\.caution\.max: a Style entry is a multiplier or \{ mul, min \}/],
      [{ min: '0.1' }, /ai\.styles\.Wary\.caution\.min/],
      ['2', /ai\.styles\.Wary\.caution must be a multiplier \(a number\) or \{ mul, min \}/],
      [null, /ai\.styles\.Wary\.caution must be a multiplier/],
      [[2, 0.1], /ai\.styles\.Wary\.caution must be a multiplier/],
    ];
    for (const [entry, error] of refused) expect(() => parseTuningData(withStyles({ Balanced: {}, Wary: { caution: entry } })), JSON.stringify(entry)).toThrow(error);
    // A minimum is still a Style entry: Balanced stays empty, and no minimum reaches a setting a Style may not name.
    expect(() => parseTuningData(withStyles({ Balanced: { caution: { min: 0.1 } } }))).toThrow(/ai\.styles\.Balanced/);
    expect(() => parseTuningData(withStyles({ Balanced: {}, Wary: { jumpNav: { min: 10 } } }))).toThrow(/ai\.styles\.Wary\.jumpNav: a Style scales only/);
    expect(() => parseTuningData({ ...good, ai: { ...good.ai, styles: undefined } })).toThrow(/ai\.styles/);
  });

  it('loads the Quirks from data/ai.json: Dumb (defendRate 0), Hopper (its jump chances, and jumpNav at least 10), Slow (walk 0.7, Wind-up 1.35) and NoDaggers (throwRate and kite 0)', () => {
    const { quirks } = loadTuningData().ai;
    expect(Object.keys(quirks)).toEqual(['Dumb', 'Hopper', 'Slow', 'NoDaggers']);
    expect(quirks.NoDaggers).toEqual({ ai: { throwRate: 0, kite: 0 } });
    expect(quirks.Slow).toEqual({ body: { walkSpeed: 0.7, windUp: 1.35 } });
    expect(quirks.Dumb).toEqual({ ai: { defendRate: 0 } });
    expect(quirks.Hopper).toEqual({ ai: { jumpAttackRate: { mul: 4, min: 0.002 }, jumpStep: { mul: 3, min: 0.3 }, jumpEscapeRate: { mul: 2, min: 0.1 }, landingPunish: { mul: 1.5, min: 0.2 }, jumpNav: { min: 10 } } });
  });

  it('parses ai.quirks: an ai part (any difficulty extra, defendRate and jumpNav; a number sets, { mul?, min } adjusts) and a body part (Mods), and refuses the rest', () => {
    const good = goodRaw();
    const withQuirks = (quirks: unknown) => ({ ...good, ai: { ...good.ai, quirks } });
    expect(parseTuningData(good).ai.quirks).toEqual({});
    const q = parseTuningData(withQuirks({ Clumsy: { ai: { defendRate: 0.5, chamberRate: { min: 0.1 }, caution: { mul: 2, min: 0 }, jumpNav: 4 } }, Heavy: { body: { damage: 1.2, maxHp: 0.5 } }, Plain: {} })).ai.quirks;
    expect(q).toEqual({ Clumsy: { ai: { defendRate: 0.5, chamberRate: { min: 0.1 }, caution: { mul: 2, min: 0 }, jumpNav: 4 } }, Heavy: { body: { damage: 1.2, maxHp: 0.5 } }, Plain: {} });
    expect(parseTuningData(withQuirks({ Up: { ai: { jumpNav: { min: 10 } } } })).ai.quirks.Up).toEqual({ ai: { jumpNav: { min: 10 } } });
    const refused: [unknown, RegExp][] = [
      [{ ai: { reactionTime: 0.1 } }, /ai\.quirks\.Q\.ai\.reactionTime: a Quirk changes only .*defendRate, jumpNav/],
      [{ ai: { mistakeRate: 0 } }, /ai\.quirks\.Q\.ai\.mistakeRate: a Quirk changes only/],
      [{ ai: { feintRate: 0 } }, /ai\.quirks\.Q\.ai\.feintRate: a Quirk changes only/],
      [{ ai: { defendRate: 1.5 } }, /ai\.quirks\.Q\.ai\.defendRate must be between 0 and 1/],
      [{ ai: { caution: { mul: 2 } } }, /ai\.quirks\.Q\.ai\.caution: an object entry needs a min/],
      [{ ai: { caution: { min: 2 } } }, /ai\.quirks\.Q\.ai\.caution\.min must be between 0 and 1/],
      [{ ai: { jumpNav: -2 } }, /ai\.quirks\.Q\.ai\.jumpNav must be a whole number of Ticks, -1 or more/],
      [{ ai: { jumpNav: 2.5 } }, /ai\.quirks\.Q\.ai\.jumpNav must be a whole number/],
      [{ ai: { jumpNav: { mul: 2, min: 10 } } }, /ai\.quirks\.Q\.ai\.jumpNav must be a whole number of Ticks or \{ min \}/],
      [{ ai: { jumpNav: { min: -1 } } }, /ai\.quirks\.Q\.ai\.jumpNav\.min must be a whole number of Ticks, 0 or more/],
      [{ ai: { jumpNav: { min: 1.5 } } }, /ai\.quirks\.Q\.ai\.jumpNav\.min/],
      [{ body: { luck: 2 } }, /ai\.quirks\.Q\.body: unknown effect "luck"/],
      [{ mind: {} }, /ai\.quirks\.Q\.mind: a Quirk has only an ai part and a body part/],
    ];
    for (const [entry, error] of refused) expect(() => parseTuningData(withQuirks({ Q: entry })), JSON.stringify(entry)).toThrow(error);
    expect(() => parseTuningData(withQuirks({ random: {} }))).toThrow(/ai\.quirks\.random/);
  });

  it('loads the Gait (stride threshold, step duration, step height, hip bob, hip sway) from data/gait.json', () => {
    const { gait } = loadTuningData();
    expect(gait.strideThreshold).toBeGreaterThan(0);
    expect(gait.stepDuration).toBeGreaterThan(0);
    expect(gait.stepHeight).toBeGreaterThan(0);
    // Small, non-zero hip movement by default.
    expect(gait.hipBob).toBeGreaterThan(0);
    expect(gait.hipBob).toBeLessThan(0.1);
    expect(gait.hipSway).toBeGreaterThan(0);
    expect(gait.hipSway).toBeLessThan(0.1);
  });

  it('rejects invalid Gait Tuning Data, naming the full path', () => {
    const good = goodRaw();
    const withGait = (g: object) => ({ ...good, gait: { ...good.gait, ...g } });
    expect(() => parseTuningData({ ...good, gait: undefined })).toThrow(/gait/);
    expect(() => parseTuningData(withGait({ strideThreshold: 'far' }))).toThrow(/gait\.strideThreshold/);
    expect(() => parseTuningData(withGait({ strideThreshold: -0.1 }))).toThrow(/gait\.strideThreshold/);
    expect(() => parseTuningData(withGait({ strideThreshold: 5 }))).toThrow(/gait\.strideThreshold/);
    expect(() => parseTuningData(withGait({ stepDuration: 0 }))).toThrow(/gait\.stepDuration/);
    expect(() => parseTuningData(withGait({ stepDuration: 10 }))).toThrow(/gait\.stepDuration/);
    expect(() => parseTuningData(withGait({ stepHeight: -0.01 }))).toThrow(/gait\.stepHeight/);
    expect(() => parseTuningData(withGait({ stepHeight: 2 }))).toThrow(/gait\.stepHeight/);
    expect(parseTuningData(withGait({ stepHeight: 0 })).gait.stepHeight).toBe(0);
    expect(() => parseTuningData(withGait({ runSpeed: 0 }))).toThrow(/gait\.runSpeed/);
    expect(() => parseTuningData(withGait({ runStepDuration: 0 }))).toThrow(/gait\.runStepDuration/);
    expect(() => parseTuningData(withGait({ runContact: undefined }))).toThrow(/gait\.runContact/);
    expect(parseTuningData(withGait({ runBob: 0 })).gait.runBob).toBe(0);
    expect(() => parseTuningData(withGait({ hipBob: undefined }))).toThrow(/gait\.hipBob/);
    expect(() => parseTuningData(withGait({ hipBob: -0.01 }))).toThrow(/gait\.hipBob/);
    expect(() => parseTuningData(withGait({ hipBob: 1 }))).toThrow(/gait\.hipBob/);
    expect(() => parseTuningData(withGait({ maxLead: -0.1 }))).toThrow(/gait\.maxLead/);
    expect(() => parseTuningData(withGait({ strideLength: 0 }))).toThrow(/gait\.strideLength/);
    expect(() => parseTuningData(withGait({ squareUp: 1.5 }))).toThrow(/gait\.squareUp/);
    expect(() => parseTuningData(withGait({ hipTwist: -1 }))).toThrow(/gait\.hipTwist/);
    expect(() => parseTuningData(withGait({ toeRoll: 90 }))).toThrow(/gait\.toeRoll/);
    expect(() => parseTuningData(withGait({ hipSway: 'lots' }))).toThrow(/gait\.hipSway/);
    expect(() => parseTuningData(withGait({ hipSway: -0.01 }))).toThrow(/gait\.hipSway/);
    expect(() => parseTuningData(withGait({ hipSway: 1 }))).toThrow(/gait\.hipSway/);
    expect(parseTuningData(withGait({ hipBob: 0, hipSway: 0, hipTwist: 0, toeRoll: 0, squareUp: 0 })).gait).toMatchObject({ hipBob: 0, hipSway: 0, hipTwist: 0, toeRoll: 0, squareUp: 0 });
  });

  it('requires an Idle Motion and unique Motion names', () => {
    const good = goodRaw();
    const overhead = { ...good.motions[0]!, name: 'Overhead' };
    expect(() => parseTuningData({ ...good, motions: [overhead] })).toThrow(/Idle/);
    expect(() => parseTuningData({ ...good, motions: [good.motions[0], good.motions[0]] })).toThrow(/duplicate/i);
  });
});

describe('Motion validation', () => {
  const key = (time: number, extra: object = {}) => ({ time, ease: 'easeInOut', ...extra });
  const motion = (poseKeys: unknown[], extra: object = {}) => ({ name: 'Overhead', duration: 1, poseKeys, ...extra });

  it('keeps every Pose Key channel and named markers', () => {
    const m = parseMotion(
      motion(
        [
          key(0, {
            rightHand: { position: { x: 0.2, y: 1, z: 0.3 }, rotation: { x: -60, y: 0, z: 0 } },
            leftHand: { position: { x: -0.2, y: 0.9, z: 0 } },
            torso: { twist: 10, lean: -5 },
            hip: { x: 0, y: 0.9, z: 0 },
            leftFoot: { x: -0.1, z: 0.1 },
            rightFoot: { x: 0.1, z: -0.1 },
          }),
          key(1),
        ],
        { markers: { windUpEnd: 0.3, releaseEnd: 0.6 } },
      ),
    );
    expect(m.loop).toBe(false);
    expect(m.markers).toEqual({ windUpEnd: 0.3, releaseEnd: 0.6 });
    expect(m.poseKeys[0]?.torso).toEqual({ twist: 10, lean: -5 });
    expect(m.poseKeys[0]?.rightFoot).toEqual({ x: 0.1, z: -0.1 });
  });

  it('keeps the kickFoot and body channels, and serializes them back', () => {
    const m = parseMotion(motion([key(0, { kickFoot: { x: 0.1, y: 0.6, z: 0.5 }, body: { tilt: 90, drop: 0.1 } }), key(1)]));
    expect(m.poseKeys[0]?.kickFoot).toEqual({ x: 0.1, y: 0.6, z: 0.5 });
    expect(m.poseKeys[0]?.body).toEqual({ tilt: 90, drop: 0.1 });
    expect(m.poseKeys[1]).not.toHaveProperty('kickFoot');
    expect(parseMotion(JSON.parse(serializeMotion(m)))).toEqual(m);
    const pivoted = parseMotion(motion([key(0, { body: { tilt: 40, drop: 0.2, pivot: 0.5 } }), key(1)]));
    expect(pivoted.poseKeys[0]?.body).toEqual({ tilt: 40, drop: 0.2, pivot: 0.5 });
    expect(parseMotion(JSON.parse(serializeMotion(pivoted)))).toEqual(pivoted);
  });

  it('rejects a malformed kickFoot or body with the full path', () => {
    expect(() => parseMotion(motion([key(0, { kickFoot: { x: 0, y: 'up', z: 0 } })]))).toThrow(/poseKeys\[0\]\.kickFoot\.y/);
    expect(() => parseMotion(motion([key(0, { body: { tilt: 90 } })]))).toThrow(/poseKeys\[0\]\.body/);
    expect(() => parseMotion(motion([key(0, { body: { tilt: 90, drop: 0, pivot: 'hips' } })]))).toThrow(/poseKeys\[0\]\.body/);
  });

  it('rejects an unknown easing curve, naming the Pose Key', () => {
    expect(() => parseMotion(motion([key(0, { ease: 'bouncy' })]))).toThrow(/Overhead\.poseKeys\[0\]\.ease/);
  });

  it('keeps an arc hand path, drops a linear one, and rejects an unknown one', () => {
    const m = parseMotion(motion([key(0, { path: 'linear' }), key(1, { path: 'arc' })]));
    expect(m.poseKeys[0]).not.toHaveProperty('path');
    expect(m.poseKeys[1]?.path).toBe('arc');
    expect(parseMotion(JSON.parse(serializeMotion(m)))).toEqual(m);
    expect(() => parseMotion(motion([key(0, { path: 'zigzag' })]))).toThrow(/Overhead\.poseKeys\[0\]\.path/);
  });

  it('rejects Pose Keys out of time order or past the duration', () => {
    expect(() => parseMotion(motion([key(0.5), key(0.2)]))).toThrow(/time order/);
    expect(() => parseMotion(motion([key(0), key(1.5)]))).toThrow(/duration/);
    expect(() => parseMotion(motion([key(-0.1)]))).toThrow(/time/);
  });

  it('rejects non-numeric targets with the full path', () => {
    const bad = key(0, { rightHand: { position: { x: 0, y: 'high', z: 0 }, rotation: { x: 0, y: 0, z: 0 } } });
    expect(() => parseMotion(motion([bad]))).toThrow(/poseKeys\[0\]\.rightHand\.position\.y/);
  });

  it('rejects an empty Motion and markers outside the duration', () => {
    expect(() => parseMotion(motion([]))).toThrow(/at least one Pose Key/);
    expect(() => parseMotion(motion([key(0)], { markers: { windUpEnd: 2 } }))).toThrow(/markers\.windUpEnd/);
  });

  it('round-trips through its JSON file form', () => {
    const t = loadTuningData();
    const overhead = t.motions.Overhead!;
    expect(parseMotion(JSON.parse(serializeMotion(overhead)))).toEqual(overhead);
    expect(motionFileName('Overhead')).toBe('overhead.json');
  });
});
