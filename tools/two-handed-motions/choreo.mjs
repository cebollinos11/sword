/**
 * Two-handed choreography, turned into Motion override files by gen.mjs (see there). Fighter-local: x right, y up, z forward.
 *
 * A Weapon lists `motions` (written whole) and `patches` (a default Motion with only its hands replaced, keyed by the
 * times of its Pose Keys that set them). A Pose Key: t (s), ease, path, idle (channels linked to the guard), and
 *   c: grip centre, midway between the hands    d: Weapon direction, hands → tip (any length)
 *   rear: the off (rear) hand instead of c, for a Weapon levered about it
 *   e: where the edge should face (squared to the Weapon; default down)
 *   near: Euler components to stay near, e.g. { y: 150 } to bring a cut round the right rather than the left
 *   torso: [twist, lean]    hip: [x, y, z]    lf / rf: foot plants [x, z]
 */
const FEET = { lf: [-0.12, 0.12], rf: [0.14, -0.12] };
const ALL = ['rightHand', 'leftHand', 'torso', 'hip', 'leftFoot', 'rightFoot'];
const UPPER = ['rightHand', 'leftHand', 'torso', 'hip'];

const longsword = {
  motions: [
    {
      name: 'Idle', duration: 2, loop: true,
      keys: [
        { t: 0, c: [0.06, 1.04, 0.28], d: [-0.1, 0.55, 0.83], torso: [10, 2], hip: [0, 0.9, 0], ...FEET },
        { t: 1, c: [0.06, 1.025, 0.275], d: [-0.1, 0.53, 0.84], hip: [0, 0.885, 0] },
        { t: 2, c: [0.06, 1.04, 0.28], d: [-0.1, 0.55, 0.83], hip: [0, 0.9, 0] },
      ],
    },
    {
      name: 'Overhead', duration: 1.1, markers: { windUpEnd: 0.35, releaseEnd: 0.6 },
      keys: [
        { t: 0, ease: 'linear', idle: ALL },
        { t: 0.35, ease: 'easeOut', c: [0.03, 1.78, 0.02], d: [0, 0.5, -0.87], e: [0, 1, 0.5], torso: [5, -8], hip: [0, 0.92, -0.05] },
        { t: 0.48, ease: 'easeIn', path: 'arc', c: [0.03, 1.48, 0.48], d: [0, 0.1, 1], torso: [-3, 12], hip: [0, 0.88, 0.06] },
        { t: 0.6, ease: 'easeOut', path: 'arc', c: [0.02, 1.12, 0.5], d: [0, -0.55, 0.83], torso: [-5, 22], hip: [0, 0.84, 0.1] },
        { t: 0.75, ease: 'easeOut', path: 'arc', c: [0.0, 0.98, 0.38], d: [-0.25, -0.8, 0.5], torso: [-10, 24], hip: [0, 0.83, 0.08] },
        { t: 1.1, ease: 'easeInOut', idle: UPPER },
      ],
    },
    {
      name: 'Right', duration: 1.1, markers: { windUpEnd: 0.35, releaseEnd: 0.6 },
      keys: [
        { t: 0, ease: 'linear', idle: ALL },
        { t: 0.17, ease: 'easeIn', c: [0.16, 1.3, 0.26], d: [0.15, 0.95, 0.1], e: [0.6, 0, -0.8], torso: [25, 0] },
        { t: 0.35, ease: 'easeOut', c: [0.3, 1.5, -0.02], d: [0.35, 0.5, -0.8], e: [0.8, -0.3, 0.3], near: { x: -30, y: 150 }, torso: [40, -5], hip: [0.03, 0.91, -0.05] },
        { t: 0.42, ease: 'easeIn', path: 'arc', c: [0.28, 1.45, 0.22], d: [0.95, 0.15, 0.2], e: [0.3, 0, 1], torso: [25, 4], hip: [0.02, 0.9, 0] },
        { t: 0.5, ease: 'linear', path: 'arc', c: [0.1, 1.32, 0.45], d: [0, -0.1, 1], e: [-1, -0.2, 0], torso: [0, 10], hip: [0, 0.88, 0.06] },
        { t: 0.6, ease: 'easeOut', path: 'arc', c: [-0.12, 1.15, 0.42], d: [-0.85, -0.3, 0.45], e: [-0.4, -0.3, -0.9], torso: [-30, 14], hip: [-0.02, 0.86, 0.07] },
        { t: 0.75, ease: 'easeOut', path: 'arc', c: [-0.22, 1.0, 0.25], d: [-0.75, -0.45, -0.2], e: [-0.2, -0.3, -1], torso: [-40, 16], hip: [-0.03, 0.85, 0.05] },
        { t: 1.1, ease: 'easeInOut', idle: UPPER },
      ],
    },
    {
      name: 'Left', duration: 1.1, markers: { windUpEnd: 0.35, releaseEnd: 0.6 },
      keys: [
        { t: 0, ease: 'linear', idle: ALL },
        { t: 0.17, ease: 'easeIn', c: [-0.12, 1.32, 0.18], d: [-0.15, 0.95, 0.1], e: [-0.6, 0, -0.8], torso: [-25, 0] },
        { t: 0.35, ease: 'easeOut', c: [-0.24, 1.5, 0.0], d: [-0.35, 0.5, -0.8], e: [-0.8, -0.3, 0.3], near: { x: -30, y: -150 }, torso: [-40, -5], hip: [-0.03, 0.91, -0.05] },
        { t: 0.42, ease: 'easeIn', path: 'arc', c: [-0.2, 1.45, 0.25], d: [-0.95, 0.15, 0.2], e: [-0.3, 0, 1], torso: [-25, 4], hip: [-0.02, 0.9, 0] },
        { t: 0.5, ease: 'linear', path: 'arc', c: [0.0, 1.32, 0.45], d: [0.05, -0.1, 1], e: [1, -0.2, 0], torso: [0, 10], hip: [0, 0.88, 0.06] },
        { t: 0.6, ease: 'easeOut', path: 'arc', c: [0.2, 1.15, 0.42], d: [0.85, -0.3, 0.45], e: [0.4, -0.3, -0.9], torso: [30, 14], hip: [0.02, 0.86, 0.07] },
        { t: 0.75, ease: 'easeOut', path: 'arc', c: [0.28, 1.0, 0.22], d: [0.75, -0.45, -0.25], e: [0.2, -0.3, -1], torso: [40, 16], hip: [0.03, 0.85, 0.05] },
        { t: 1.1, ease: 'easeInOut', idle: UPPER },
      ],
    },
    {
      name: 'Thrust', duration: 1, markers: { windUpEnd: 0.35, releaseEnd: 0.45 },
      keys: [
        { t: 0, ease: 'linear', idle: ALL },
        { t: 0.35, ease: 'easeOut', c: [0.22, 1.25, 0.05], d: [-0.12, 0.08, 1], torso: [30, -6], hip: [0, 0.87, -0.06] },
        { t: 0.45, ease: 'easeIn', c: [0.06, 1.3, 0.7], d: [-0.03, 0, 1], torso: [-12, 14], hip: [0, 0.86, 0.18] },
        { t: 0.57, ease: 'easeOut', c: [0.05, 1.28, 0.74], d: [-0.03, -0.02, 1], torso: [-15, 18], hip: [0, 0.84, 0.2] },
        { t: 1, ease: 'easeInOut', idle: UPPER },
      ],
    },
    {
      name: 'BlockOverhead', duration: 0.15,
      keys: [
        { t: 0, ease: 'linear', idle: ALL },
        { t: 0.15, ease: 'easeOut', c: [0.04, 1.72, 0.3], d: [1, 0.15, 0.12], e: [0, 1, 0], torso: [0, -5], hip: [0, 0.88, 0] },
      ],
    },
    {
      name: 'BlockRight', duration: 0.15,
      keys: [
        { t: 0, ease: 'linear', idle: ALL },
        { t: 0.15, ease: 'easeOut', c: [0.26, 1.2, 0.35], d: [0.15, 0.95, 0.2], e: [1, 0, 0], torso: [20, 0], hip: [0, 0.88, 0] },
      ],
    },
    {
      name: 'BlockLeft', duration: 0.15,
      keys: [
        { t: 0, ease: 'linear', idle: ALL },
        { t: 0.15, ease: 'easeOut', c: [-0.2, 1.2, 0.35], d: [-0.15, 0.95, 0.2], e: [-1, 0, 0], torso: [-20, 0], hip: [0, 0.88, 0] },
      ],
    },
    {
      name: 'BlockThrust', duration: 0.15,
      keys: [
        { t: 0, ease: 'linear', idle: ALL },
        { t: 0.15, ease: 'easeOut', c: [0.05, 1.15, 0.4], d: [-0.35, 0.75, 0.55], e: [-1, 0, 0], torso: [5, 5], hip: [0, 0.88, 0] },
      ],
    },
  ],
};


// The Halberd: hands 0.6 m apart, the sword (front) hand nearer the head. The rear (off) hand stays near the belly as the
// pivot and the shaft levers about it; the body turns the front hand round.
const halberd = {
  motions: [
    {
      name: 'Idle', duration: 2, loop: true,
      keys: [
        { t: 0, c: [0.07, 1.05, 0.37], d: [0.2, 0.3, 0.93], e: [0, -1, 0], torso: [-25, 8], hip: [0, 0.88, 0.04], ...FEET },
        { t: 1, c: [0.07, 1.035, 0.365], d: [0.2, 0.28, 0.94], hip: [0, 0.865, 0.04] },
        { t: 2, c: [0.07, 1.05, 0.37], d: [0.2, 0.3, 0.93], hip: [0, 0.88, 0.04] },
      ],
    },
    {
      name: 'Overhead', duration: 1.1, markers: { windUpEnd: 0.35, releaseEnd: 0.6 },
      keys: [
        { t: 0, ease: 'linear', idle: ALL },
        { t: 0.35, ease: 'easeOut', c: [0.02, 1.6, 0.13], d: [0, 0.82, -0.57], e: [0, 1, 0.5], torso: [-5, -8], hip: [0, 0.91, -0.04] },
        { t: 0.48, ease: 'easeIn', path: 'arc', c: [0.03, 1.12, 0.42], d: [0, 0.15, 0.99], torso: [-12, 15], hip: [0, 0.86, 0.08] },
        { t: 0.6, ease: 'easeOut', path: 'arc', c: [0.02, 0.98, 0.4], d: [0, -0.35, 0.94], torso: [-15, 22], hip: [0, 0.83, 0.1] },
        { t: 0.75, ease: 'easeOut', c: [0.0, 0.95, 0.35], d: [-0.05, -0.45, 0.89], torso: [-18, 24], hip: [0, 0.82, 0.1] },
        { t: 1.1, ease: 'easeInOut', idle: UPPER },
      ],
    },
    {
      name: 'Right', duration: 1.1, markers: { windUpEnd: 0.35, releaseEnd: 0.6 },
      keys: [
        { t: 0, ease: 'linear', idle: ALL },
        { t: 0.17, ease: 'easeIn', c: [0.12, 1.3, 0.3], d: [0.35, 0.85, 0.1], e: [0.6, 0, -0.8], torso: [10, 2] },
        { t: 0.35, ease: 'easeOut', c: [0.07, 1.2, 0.3], d: [0.45, 0.4, -0.8], e: [0.8, -0.3, 0.3], near: { x: -30, y: 150 }, torso: [40, -5], hip: [0.03, 0.9, -0.04] },
        { t: 0.42, ease: 'easeIn', path: 'arc', c: [0.2, 1.3, 0.33], d: [0.95, 0.2, 0.25], e: [0.3, 0, 1], torso: [25, 5], hip: [0.02, 0.89, 0.02] },
        { t: 0.5, ease: 'linear', path: 'arc', c: [0.06, 1.2, 0.38], d: [0.1, 0, 1], e: [-1, -0.2, 0], torso: [0, 10], hip: [0, 0.87, 0.06] },
        { t: 0.6, ease: 'easeOut', path: 'arc', c: [0.04, 1.04, 0.38], d: [-0.7, -0.2, 0.68], e: [-0.4, -0.3, -0.9], torso: [-35, 14], hip: [-0.02, 0.85, 0.07] },
        { t: 0.75, ease: 'easeOut', path: 'arc', c: [-0.04, 1.02, 0.35], d: [-0.85, -0.3, 0.3], e: [-0.2, -0.3, -1], torso: [-45, 16], hip: [-0.03, 0.84, 0.05] },
        // Recovering, the shaft is lifted in front so the rear hand comes back round the body to the guard, not through it.
        { t: 0.9, ease: 'easeInOut', c: [0.04, 1.26, 0.45], d: [-0.12, 0.5, 0.86], e: [-1, 0, 0], torso: [-30, 12] },
        { t: 1.1, ease: 'easeInOut', idle: UPPER },
      ],
    },
    {
      name: 'Left', duration: 1.1, markers: { windUpEnd: 0.35, releaseEnd: 0.6 },
      keys: [
        { t: 0, ease: 'linear', idle: ALL },
{ t: 0.17, ease: 'easeIn', rear: [0.08, 1.1, 0.32], d: [-0.2, 0.9, 0.1], e: [-0.6, 0, -0.8], torso: [-30, 2] },
        { t: 0.35, ease: 'easeOut', rear: [0.1, 1.18, 0.32], d: [-0.45, 0.55, -0.7], e: [-0.8, -0.3, 0.3], near: { x: -30, y: -150 }, torso: [-40, -5], hip: [-0.03, 0.9, -0.04] },
        { t: 0.42, ease: 'easeIn', path: 'arc', rear: [0.1, 1.16, 0.36], d: [-0.6, 0.45, 0.65], e: [-0.3, 0, 1], torso: [-40, 5], hip: [-0.02, 0.89, 0.02] },
        { t: 0.5, ease: 'linear', path: 'arc', rear: [-0.2, 1.12, 0.28], d: [0.55, 0.05, 0.83], e: [1, -0.2, 0], torso: [-10, 15], hip: [0, 0.87, 0.08] },
        { t: 0.6, ease: 'easeOut', path: 'arc', rear: [-0.22, 1.08, 0.24], d: [0.85, -0.15, 0.5], e: [0.4, -0.3, -0.9], torso: [15, 14], hip: [0.02, 0.85, 0.07] },
        { t: 0.75, ease: 'easeOut', path: 'arc', rear: [-0.2, 1.05, 0.2], d: [0.95, -0.25, 0.15], e: [0.2, -0.3, -1], torso: [25, 16], hip: [0.03, 0.84, 0.05] },
        { t: 1.1, ease: 'easeInOut', idle: UPPER },
      ],
    },
    {
      name: 'Thrust', duration: 1, markers: { windUpEnd: 0.35, releaseEnd: 0.45 },
      keys: [
        { t: 0, ease: 'linear', idle: ALL },
        { t: 0.35, ease: 'easeOut', c: [0.05, 1.12, 0.42], d: [0.12, 0.45, 0.88], torso: [-15, -6], hip: [0, 0.87, -0.08] },
        { t: 0.45, ease: 'easeIn', c: [0.04, 1.16, 0.55], d: [0.02, 0.12, 0.99], torso: [-30, 16], hip: [0, 0.85, 0.18] },
        { t: 0.57, ease: 'easeOut', c: [0.03, 1.15, 0.58], d: [0.02, 0.1, 0.99], torso: [-32, 18], hip: [0, 0.83, 0.2] },
        { t: 1, ease: 'easeInOut', idle: UPPER },
      ],
    },
    {
      name: 'BlockOverhead', duration: 0.15,
      keys: [
        { t: 0, ease: 'linear', idle: ALL },
        { t: 0.15, ease: 'easeOut', c: [0.02, 1.68, 0.3], d: [1, 0.2, 0.1], e: [0, 1, 0], torso: [-5, -5], hip: [0, 0.88, 0] },
      ],
    },
    {
      name: 'BlockRight', duration: 0.15,
      keys: [
        { t: 0, ease: 'linear', idle: ALL },
        { t: 0.15, ease: 'easeOut', c: [0.2, 1.3, 0.36], d: [0.2, 0.95, 0.25], e: [1, 0, 0], torso: [15, 0], hip: [0, 0.88, 0] },
      ],
    },
    {
      name: 'BlockLeft', duration: 0.15,
      keys: [
        { t: 0, ease: 'linear', idle: ALL },
        { t: 0.15, ease: 'easeOut', c: [-0.16, 1.3, 0.36], d: [-0.2, 0.95, 0.25], e: [-1, 0, 0], torso: [-20, 0], hip: [0, 0.88, 0] },
      ],
    },
    {
      name: 'BlockThrust', duration: 0.15,
      keys: [
        { t: 0, ease: 'linear', idle: ALL },
        { t: 0.15, ease: 'easeOut', c: [0.04, 1.25, 0.42], d: [-0.45, 0.7, 0.55], e: [-1, 0, 0], torso: [-5, 5], hip: [0, 0.88, 0] },
      ],
    },
  ],
};


// The Sledge Hammer: the Longsword's lines with the hands 0.41 m apart, a heavier, bigger wind-up and a lower finish.
const clone = (o) => JSON.parse(JSON.stringify(o));
const hammer = clone(longsword);
const hm = Object.fromEntries(hammer.motions.map((m) => [m.name, m]));
const key = (m, t) => hm[m].keys.find((k) => k.t === t);
Object.assign(key('Idle', 0), { c: [0.03, 1.06, 0.3], d: [-0.12, 0.62, 0.78], torso: [12, 4], hip: [0, 0.89, 0] });
Object.assign(key('Idle', 1), { c: [0.03, 1.045, 0.295], d: [-0.12, 0.61, 0.79], hip: [0, 0.875, 0] });
Object.assign(key('Idle', 2), { c: [0.03, 1.06, 0.3], d: [-0.12, 0.62, 0.78], hip: [0, 0.89, 0] });
// Overhead: the head dropped right down the back, then brought over to the ground in front.
Object.assign(key('Overhead', 0.35), { c: [0.04, 1.68, -0.02], d: [0, 0.1, -1], e: [0, 1, 0], torso: [5, -12], hip: [0, 0.92, -0.07] });
Object.assign(key('Overhead', 0.48), { c: [0.03, 1.52, 0.35], d: [0, 0.6, 0.8] });
Object.assign(key('Overhead', 0.6), { c: [0.02, 1.1, 0.48], d: [0, -0.35, 0.94], torso: [-5, 26], hip: [0, 0.82, 0.12] });
Object.assign(key('Overhead', 0.75), { c: [0.0, 0.92, 0.4], d: [-0.1, -0.75, 0.65], torso: [-8, 30], hip: [0, 0.8, 0.1] });
// Side swings: chambered further round, the head trailing low behind the shoulder.
Object.assign(key('Right', 0.35), { c: [0.26, 1.42, -0.02], d: [0.45, 0.3, -0.85], torso: [50, -5] });
Object.assign(key('Left', 0.35), { c: [-0.2, 1.42, 0.02], d: [-0.45, 0.3, -0.85], torso: [-50, -5] });
Object.assign(key('Right', 0.75), { c: [-0.12, 0.97, 0.28], d: [-0.7, -0.6, -0.1] });
Object.assign(key('BlockRight', 0.15), { c: [0.22, 1.2, 0.35] });
Object.assign(key('Right', 0.42), { c: [0.25, 1.38, 0.4], d: [0.75, 0.25, -0.45] });
Object.assign(key('Left', 0.42), { c: [-0.15, 1.38, 0.4], d: [-0.75, 0.25, -0.45] });
// Through the middle of a swing or thrust the long handle runs across the body, its butt passing the side of the torso.
Object.assign(key('Right', 0.5), { c: [0.12, 1.2, 0.48], d: [-0.35, -0.1, 0.93] });
Object.assign(key('Left', 0.5), { c: [0.0, 1.2, 0.48], d: [0.35, -0.1, 0.93] });
Object.assign(key('Thrust', 0.45), { c: [0.1, 1.25, 0.64], d: [-0.25, 0, 0.97] });
Object.assign(key('Thrust', 0.57), { c: [0.09, 1.23, 0.68], d: [-0.25, -0.02, 0.97] });
// Recovering, the head is lifted in front so the long handle comes back round the body to the guard.
for (const side of ['Right', 'Left']) {
  const keys = hm[side].keys;
  keys.splice(keys.length - 1, 0, { t: 0.92, ease: 'easeInOut', c: [0.04, 1.2, 0.42], d: [side === 'Right' ? -0.25 : 0.25, 0.7, 0.67], e: [side === 'Right' ? -1 : 1, 0, 0] });
}
Object.assign(key('Left', 0.17), { c: [-0.12, 1.32, 0.28] });
Object.assign(key('Left', 0.75), { c: [0.24, 0.95, 0.24], d: [0.7, -0.6, -0.1] });

export const CHOREO = { Longsword: longsword, Halberd: halberd, 'Sledge Hammer': hammer };

// Reactions: the default Motions with both hands kept on the Weapon. `fwd` pushes the grip forward for a longer Weapon.
const reactions = (fwd = 0, up = 0) => [
  { name: 'Stagger', hands: { 0.12: { c: [0.2, 1.3 + up, 0.12 + fwd], d: [0.2, 0.9, 0.3], e: [0, 0, 1] } } },
  { name: 'StaggerLeft', hands: {
    0.12: { c: [0.28, 1.22 + up, 0.1 + fwd], d: [0.55, 0.75, 0.35], e: [1, 0, 0] },
    0.26: { c: [0.22, 1.16 + up, 0.18 + fwd], d: [0.4, 0.75, 0.5], e: [1, 0, 0] },
  } },
  { name: 'StaggerRight', hands: {
    0.12: { c: [-0.05, 1.2 + up, 0.22 + fwd], d: [-0.5, 0.75, 0.4], e: [-1, 0, 0] },
    0.26: { c: [0.0, 1.14 + up, 0.26 + fwd], d: [-0.35, 0.75, 0.55], e: [-1, 0, 0] },
  } },
  { name: 'StaggerOverhead', hands: { 0.12: { c: [0.08, 0.98 + up, 0.32 + fwd], d: [0.1, 0.15, 1] } } },
  { name: 'StaggerThrust', hands: { 0.12: { c: [0.06, 0.95 + up, 0.26 + fwd], d: [0.1, -0.05, 1] } } },
  { name: 'Recoil', hands: { 0.07: { c: [0.16, 1.26 + up, 0.18 + fwd], d: [0.25, 0.85, 0.35], e: [0, 0, 1] } } },
  { name: 'Kick', hands: {
    0.3: { c: [0.06, 1.12 + up, 0.24 + fwd], d: [-0.05, 0.75, 0.65] },
    0.4: { c: [0.07, 1.14 + up, 0.2 + fwd], d: [-0.05, 0.85, 0.5] },
    0.7: { c: [0.06, 1.1 + up, 0.26 + fwd], d: [-0.05, 0.72, 0.68] },
  } },
];
longsword.patches = reactions();
hammer.patches = reactions(0.04, 0.08);
/**
 * A long grip turned far about the hands swings its butt into the body, so the Sledge Hammer and Halberd stay nearer their
 * guard's angle when knocked about: each reaction's Weapon direction taken `k` of the way back toward the guard's.
 */
const nearGuard = (patches, guard, k) => {
  const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const g = unit(guard);
  for (const p of patches) for (const h of Object.values(p.hands)) h.d = unit(unit(h.d).map((x, i) => x + (g[i] - x) * k));
};
nearGuard(hammer.patches, key('Idle', 0).d, 0.5);
halberd.patches = reactions(0.08);
nearGuard(halberd.patches, halberd.motions[0].keys[0].d, 0.5);
// The Halberd kicks with its shaft held forward as on guard, clear of the rising knee.
Object.assign(halberd.patches.find((p) => p.name === 'Kick').hands, {
  0.3: { c: [0.06, 1.12, 0.42], d: [0.18, 0.4, 0.9] },
  0.4: { c: [0.06, 1.16, 0.4], d: [0.18, 0.5, 0.85] },
  0.7: { c: [0.06, 1.1, 0.42], d: [0.18, 0.38, 0.9] },
});
