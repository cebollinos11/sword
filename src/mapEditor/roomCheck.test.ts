import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { FIXTURE_ROOM_RAW } from '../sim/delver/rooms.testdata';
import { checkRoom, roomCheckText } from './roomCheck';

const tuning = loadTuningData();
const base = FIXTURE_ROOM_RAW as unknown as Record<string, unknown>;
const brushes = FIXTURE_ROOM_RAW.brushes as unknown as Record<string, unknown>[];

describe('Check room (docs/plans/delver.md, Stage 7g)', () => {
  it('passes the fixture: both frames compile, walk-check and every AI leg arrives', () => {
    const c = checkRoom(FIXTURE_ROOM_RAW, tuning);
    expect(c.issues, roomCheckText('fixture', c)).toEqual([]);
    expect(c.ok).toBe(true);
    expect(c.frames.map((f) => f.frame)).toEqual([0, 5]);
    // 3 doorways: 6 legs out and back, 3 between them, a Platform and a Ramp's top: 11 a frame.
    expect(c.frames.map((f) => f.legs.length)).toEqual([11, 11]);
  }, 60_000);

  it('refuses a room file its parse refuses, with the reason', () => {
    const c = checkRoom({ ...base, half: [3, 3] }, tuning);
    expect(c.ok).toBe(false);
    expect(c.issues[0]!.message).toMatch(/halfSize/);
  });

  it('errs on a doorway walled off from the centre, and on a Platform nothing walks up to (the walk check refuses it before the AI walk)', () => {
    // With no ledge, a Block across the room from wall to wall walls the n doorway off (the walk check finds it before the AI does); with no Ramp, nothing walks up onto the ledge.
    const walled = { ...base, doorways: { n: 0, s: 0 }, brushes: [brushes[2], brushes[3], { kind: 'block', id: 'bar', rect: { x0: -11, z0: 5, x1: 11, z1: 7 }, top: 8 }] };
    const c = checkRoom(walled, tuning);
    expect(c.ok).toBe(false);
    expect(c.issues.some((i) => i.severity === 'error' && /(n doorway|walk check)/.test(i.message)), roomCheckText('walled', c)).toBe(true);
    const ledgeOnly = { ...base, doorways: { n: 0, s: 0 }, brushes: [brushes[0], brushes[2], brushes[3], brushes[4]] };
    const w = checkRoom(ledgeOnly, tuning);
    expect(w.ok).toBe(false);
    expect(w.issues.every((i) => i.severity === 'error' && /walk check: Walk Surface WALK_r-ledge/.test(i.message)), roomCheckText('ledge', w)).toBe(true);
  }, 60_000);
});
