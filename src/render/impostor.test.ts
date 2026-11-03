import { describe, expect, it } from 'vitest';
import { createMatch, crowdDue, stepMatch, type CrowdState } from '../sim';
import { loadTuningData } from '../tuning';
import { atlasCell, atlasLayout, CLIP_FRAMES, directionCell, IMPOSTOR_CLIPS, IMPOSTOR_DIRECTIONS, lastStepTick, soldierAt, soldierFrame, WALK_SPEED_MIN, yawTo, type ClipSeconds, type SoldierLook } from './impostor';

const tuning = loadTuningData();

describe('directionCell', () => {
  it('is 0 when the camera stands in front of the Soldier, counting round the way yaw turns', () => {
    // A Soldier at the origin facing +z (heading 0).
    expect(directionCell(0, yawTo(0, 0, 0, 10))).toBe(0);
    expect(directionCell(0, yawTo(0, 0, 10, 10))).toBe(1);
    expect(directionCell(0, yawTo(0, 0, 10, 0))).toBe(2);
    expect(directionCell(0, yawTo(0, 0, 0, -10))).toBe(4);
    expect(directionCell(0, yawTo(0, 0, -10, 0))).toBe(6);
  });

  it('goes by the bearing relative to the heading: turning the Soldier and the camera together keeps the cell', () => {
    for (let h = -7; h < 7; h += 0.37)
      for (let v = -7; v < 7; v += 0.41) {
        const cell = directionCell(h, v);
        expect(cell).toBeGreaterThanOrEqual(0);
        expect(cell).toBeLessThan(IMPOSTOR_DIRECTIONS);
        expect(directionCell(h + 1.3, v + 1.3)).toBe(cell);
        expect(directionCell(h + 2 * Math.PI, v - 4 * Math.PI)).toBe(cell);
      }
  });

  it('rounds to the nearest direction, changing halfway between two', () => {
    const step = (2 * Math.PI) / IMPOSTOR_DIRECTIONS;
    expect(directionCell(0, step * 0.49)).toBe(0);
    expect(directionCell(0, step * 0.51)).toBe(1);
    expect(directionCell(0, -step * 0.49)).toBe(0);
    expect(directionCell(0, -step * 0.51)).toBe(IMPOSTOR_DIRECTIONS - 1);
    // A Soldier walking away from the camera shows its back, one walking toward it its front.
    expect(directionCell(Math.PI / 2, yawTo(0, 0, -20, 0))).toBe(4);
    expect(directionCell(Math.PI / 2, yawTo(0, 0, 20, 0))).toBe(0);
  });
});

describe('the atlas layout', () => {
  const layout = atlasLayout(128, 4096);
  const frames = IMPOSTOR_CLIPS.reduce((n, c) => n + CLIP_FRAMES[c], 0);

  it('has a cell for every clip, frame and direction, each its own and inside the atlas', () => {
    const seen = new Set<string>();
    for (const clip of IMPOSTOR_CLIPS)
      for (let f = 0; f < CLIP_FRAMES[clip]; f++)
        for (let d = 0; d < IMPOSTOR_DIRECTIONS; d++) {
          const { column, row } = atlasCell(layout, clip, f, d);
          expect(column).toBeGreaterThanOrEqual(0);
          expect(column).toBeLessThan(layout.columns);
          expect(row).toBeGreaterThanOrEqual(0);
          expect(row).toBeLessThan(layout.rows);
          seen.add(`${column},${row}`);
        }
    expect(seen.size).toBe(frames * IMPOSTOR_DIRECTIONS);
    expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(frames * IMPOSTOR_DIRECTIONS);
  });

  it('is about square, its size the cells it holds', () => {
    expect(Math.abs(layout.columns - layout.rows)).toBeLessThanOrEqual(1);
    expect(layout.width).toBe(layout.columns * 128);
    expect(layout.height).toBe(layout.rows * 128);
    expect(layout.first.idle).toBe(0);
    expect(layout.first.walk).toBe(CLIP_FRAMES.idle);
    expect(layout.first.death).toBe(frames - CLIP_FRAMES.death);
  });

  it('halves its cells until it fits the largest texture allowed', () => {
    const small = atlasLayout(128, 1024);
    expect(small.cell).toBe(32);
    expect(Math.max(small.width, small.height)).toBeLessThanOrEqual(1024);
    expect(small.columns).toBe(layout.columns);
  });
});

describe('soldierFrame', () => {
  const seconds: ClipSeconds = { idle: 2, walk: 1, swing: 1.1, stagger: 0.5, death: 1.4 };
  const standing: SoldierLook = { alive: true, engaged: false, speed: 0, sinceHit: null, sinceDeath: null };

  it('picks the clip from the state: fallen, struck, engaged, walking, else Idle', () => {
    expect(soldierFrame(standing, 3, 0, seconds).clip).toBe('idle');
    expect(soldierFrame({ ...standing, speed: WALK_SPEED_MIN }, 3, 0, seconds).clip).toBe('walk');
    expect(soldierFrame({ ...standing, speed: WALK_SPEED_MIN * 0.9 }, 3, 0, seconds).clip).toBe('idle');
    expect(soldierFrame({ ...standing, speed: 2.5, engaged: true }, 3, 0, seconds).clip).toBe('swing');
    expect(soldierFrame({ ...standing, engaged: true, sinceHit: 0.2 }, 3, 0, seconds).clip).toBe('stagger');
    // A Stagger's length after the blow, it is back to fighting.
    expect(soldierFrame({ ...standing, engaged: true, sinceHit: 0.5 }, 3, 0, seconds).clip).toBe('swing');
    expect(soldierFrame({ ...standing, alive: false, sinceHit: 0.1, sinceDeath: 0.1 }, 3, 0, seconds).clip).toBe('death');
  });

  it('plays a fall once and then holds its last frame; one already down when first seen lies at rest', () => {
    const fallen = (sinceDeath: number | null) => soldierFrame({ ...standing, alive: false, sinceDeath }, 0, 0, seconds).frame;
    expect(fallen(0)).toBe(0);
    expect(fallen(0.7)).toBe(CLIP_FRAMES.death / 2);
    expect(fallen(1.39)).toBe(CLIP_FRAMES.death - 1);
    expect(fallen(60)).toBe(CLIP_FRAMES.death - 1);
    expect(fallen(null)).toBe(CLIP_FRAMES.death - 1);
    const struck = (sinceHit: number) => soldierFrame({ ...standing, sinceHit }, 0, 0, seconds).frame;
    expect(struck(0)).toBe(0);
    expect(struck(0.49)).toBe(CLIP_FRAMES.stagger - 1);
  });

  it('loops on Battle time, each Soldier from its own offset, so neighbours are not in step', () => {
    const walking = { ...standing, speed: 2.5 };
    const at = (time: number, index: number) => soldierFrame(walking, time, index, seconds).frame;
    // One loop on, the same frame.
    for (const t of [0, 0.3, 7.77]) expect(at(t + seconds.walk, 3)).toBe(at(t, 3));
    // Every frame shows over a loop.
    const shown = new Set(Array.from({ length: 80 }, (_, k) => at((k / 80) * seconds.walk, 0)));
    expect(shown.size).toBe(CLIP_FRAMES.walk);
    // Neighbours mostly differ.
    const differ = Array.from({ length: 20 }, (_, i) => at(1, i) !== at(1, i + 1)).filter(Boolean).length;
    expect(differ).toBeGreaterThanOrEqual(15);
  });
});

describe('render-side interpolation between Crowd steps', () => {
  const { stagger } = tuning.battle.crowd;
  const army = tuning.battle.armySize;

  it('lastStepTick is the latest Tick at or before this one on which the Soldier is due', () => {
    for (const i of [0, 1, 5, 6, 199, 200, 205, 399])
      for (let tick = 0; tick < 40; tick++) {
        const s = lastStepTick(i, tick, stagger, army);
        expect(s).toBeLessThanOrEqual(tick);
        expect(tick - s).toBeLessThan(stagger);
        if (s >= 0) expect(crowdDue(i, s, stagger, army)).toBe(true);
        for (let t = s + 1; t <= tick; t++) expect(crowdDue(i, t, stagger, army)).toBe(false);
      }
  });

  it('glides from where the last step began to where it ended, then holds until the next', () => {
    const crowd: CrowdState = { ...createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1 }).duel.crowd!, x: [10], z: [20], vx: [2], vz: [-1] };
    const dt = stagger * (1 / 60);
    const out: [number, number] = [0, 0];
    // Soldier 0 is due on Ticks 0, 6, 12...: at Tick 12 it has just stepped.
    expect(soldierAt(crowd, 0, 12, 12, stagger, army, out)).toEqual([10 - 2 * dt, 20 + dt]);
    const half = soldierAt(crowd, 0, 12, 12 + stagger / 2, stagger, army, [0, 0]);
    expect(half[0]).toBeCloseTo(10 - dt, 12);
    expect(half[1]).toBeCloseTo(20 + dt / 2, 12);
    expect(soldierAt(crowd, 0, 17, 17.99, stagger, army, out)[0]).toBeCloseTo(10 - 2 * dt * (0.01 / stagger), 12);
    expect(soldierAt(crowd, 0, 17, 18, stagger, army, out)).toEqual([10, 20]);
  });

  it('never jumps when a new Tick arrives, through the march and the fighting, respawns apart', () => {
    let match = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 4 });
    const a: [number, number] = [0, 0];
    const b: [number, number] = [0, 0];
    let worst = 0;
    let moving = 0;
    while (match.status.status === 'InProgress' && match.tick < 6000) {
      const before = match.duel;
      match = stepMatch(match, [], tuning);
      const after = match.duel;
      const c0 = before.crowd!;
      const c1 = after.crowd!;
      for (let i = 0; i < c0.x.length; i++) {
        // A Soldier's velocity is zeroed when it falls: it settles where it fell. A Soldier a Squad respawned this Tick appears at its spawn.
        if (!c1.alive[i] || !c0.alive[i]) continue;
        soldierAt(c0, i, before.tick, after.tick, stagger, army, a);
        soldierAt(c1, i, after.tick, after.tick, stagger, army, b);
        worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]));
        if (c1.vx[i] !== 0 || c1.vz[i] !== 0) moving++;
      }
    }
    expect(moving).toBeGreaterThan(100_000);
    expect(worst).toBeLessThan(1e-9);
  });
});
