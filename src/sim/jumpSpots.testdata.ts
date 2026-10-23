/** Test data shared by the jump Link and AI tests: the held-Jump spots of docs/jump-reach.md. */

/** Ticks of Jump held: a tap, held 0.25 s, and a full Jump (0.5 s or more). */
const TAP = 0;
const HELD = 15;
const FULL = 30;

/**
 * Every spot docs/jump-reach.md lists as reached only by a held Jump (or a tap): the Arena, where the Jump
 * takes off (on the ground there), which way and how long Jump is held, and the height of the lid it lands on.
 */
export const JUMP_SPOTS: readonly { arena: string; spot: string; x: number; z: number; y: number; move: { x: number; z: number }; hold: number; lid: number }[] = [
  { arena: 'summit', spot: 'the hull', x: -5.4, z: -27.2, y: 2, move: { x: 0, z: -1 }, hold: HELD, lid: 3.45 },
  { arena: 'summit', spot: 'the containers', x: 9.0, z: -15.6, y: 2, move: { x: 0, z: 1 }, hold: TAP, lid: 2.5 },
  { arena: 'summit', spot: 'the nacelle', x: -14.3, z: 11.1, y: 0, move: { x: -1, z: 0 }, hold: HELD, lid: 1.3 },
  { arena: 'summit', spot: 'the dish', x: 11.4, z: 15.2, y: 0, move: { x: 0, z: 1 }, hold: HELD, lid: 1.1 },
  { arena: 'summit', spot: 'the crate by the back crag', x: -7.8, z: 19.2, y: 0, move: { x: 0, z: 1 }, hold: TAP, lid: 0.9 },
  { arena: 'summit', spot: 'the crate in the nook', x: -10.2, z: -13.2, y: 0, move: { x: 0, z: -1 }, hold: TAP, lid: 0.8 },
  { arena: 'train', spot: "the locomotive's roof", x: -2.1, z: 57.0, y: -1.2, move: { x: 0, z: 1 }, hold: FULL, lid: 0.5 },
  { arena: 'train', spot: 'the crate stack', x: 2.25, z: 40.9, y: -1.2, move: { x: 0, z: 1 }, hold: HELD, lid: 0.6 },
  { arena: 'train', spot: 'the power cell', x: 2.1, z: 51.5, y: -1.2, move: { x: 0, z: 1 }, hold: HELD, lid: 0.25 },
  { arena: 'train', spot: 'the waste drums', x: -2.4, z: 47.4, y: -1.2, move: { x: 0, z: 1 }, hold: TAP, lid: -0.3 },
  { arena: 'ship', spot: 'the big crate', x: -5.65, z: 17.2, y: 0, move: { x: 0, z: 1 }, hold: TAP, lid: 1.0 },
  { arena: 'library', spot: 'the reading tables', x: -5, z: 8.6, y: 0, move: { x: 0, z: 1 }, hold: TAP, lid: 0.8 },
  { arena: 'chamber', spot: 'the catwalk at +z', x: 0, z: 7.2, y: 0, move: { x: 0, z: 1 }, hold: FULL, lid: 0 },
  { arena: 'chamber', spot: 'the catwalk at -z', x: 0, z: -7.2, y: 0, move: { x: 0, z: -1 }, hold: FULL, lid: 0 },
];
