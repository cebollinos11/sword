/**
 * Walking a Battle map alone (docs/plans/map-editor.md, Stage 4): the Player's Fighter on a hand-built map with no armies, to see its
 * heights, ramps, bridges and sightlines at once. A Duel on the map's Battlefield (`battle:<map>`, so its floor, Walls and spawns are the
 * Battle's) against a Fighter that stands still at Team 1's Base, the Player starting at the map's middle Objective. Nothing but the Player moves, and the Duel ends only if they fell it.
 * Skirmish controls (the Local Controller, mouse and keyboard) and the third-person camera, as `battlePlay`. Esc frees the mouse; a click
 * takes it again. Dev only (the Map Editor's play-test starts it in the page and stops it to come back).
 */
import { battleNameFor, battlefieldOf, createMatch, groundHeight, groundOf, IDLE_INTENT, soldierHeight, inDuel, stepMatch, TICK_SECONDS, type Intent, type MatchState, type SimState } from '../sim';
import { defaultWeaponName, type ArenaGeometry, type TuningData } from '../tuning';
import { LocalController } from '../controllers';
import { Renderer } from '../render/renderer';
import { cameraForHeight, placeThirdPersonCamera } from '../render/thirdPersonCamera';
import type { BattleHandle } from './battleSpectator';
import { storedBody } from './battlePlay';
import { bindLocalInput } from './input';

/** Ticks stepped at most per frame, so a slow frame never spirals. */
const MAX_TICKS_PER_FRAME = 8;

export interface WalkOptions {
  /** The hand-built map of `battle.maps` to walk. */
  readonly map: string;
  readonly seed?: number;
}

/**
 * A copy of `tuning` whose Battlefield `battle:<map>` has the Player's spawn at the map's middle Objective (on the floor it stands on, facing north)
 * and the other Fighter's at Team 1's Base, in place of the Battle's spawns behind the armies' deployment, so a walk starts on the map itself, not
 * 80 m from it. The floor and Walls are the Battlefield's own.
 */
function walkTuning(tuning: TuningData, map: string): TuningData {
  const name = battleNameFor(map, 0);
  const field = battlefieldOf(tuning.battle, name);
  if (!field) throw new Error(`Walk: no Battle map "${map}"`);
  // The middle one in the Battle's order (the centre of a map that is its own half turn: Objective k mirrors n - 1 - k).
  const k = Math.floor((field.objectives.length - 1) / 2);
  const o = field.objectives[k]!;
  const base = field.bases[1];
  const spawns = [
    { team: 0, slot: 0, position: { x: o.x, y: soldierHeight(field, field.objectiveSurfaces[k]!, o.x, o.z), z: o.z }, facing: 0 },
    { team: 1, slot: 0, position: { x: base.x, y: groundHeight(field.heights, groundOf(tuning.battle, field, base.x, base.z), base.x, base.z), z: base.z }, facing: Math.PI },
  ];
  const arena: ArenaGeometry = { ...field.arena, spawns };
  return { ...tuning, arenas: { ...tuning.arenas, [name]: arena } };
}

export function startMapWalk(container: HTMLElement, battleTuning: TuningData, options: WalkOptions): BattleHandle {
  const tuning = walkTuning(battleTuning, options.map);
  container.style.position = 'relative';
  const renderer = new Renderer(container, tuning);
  const panel = document.createElement('pre');
  panel.style.cssText = 'position:absolute;top:8px;left:8px;margin:0;padding:8px 10px;background:rgba(15,15,20,.8);color:#eee;font:12px/1.5 ui-monospace,monospace;border-radius:6px;z-index:10;pointer-events:none';
  container.appendChild(panel);

  const local = new LocalController();
  const input = bindLocalInput(local, renderer.canvas);
  input.enabled = true;
  const weapon = defaultWeaponName(tuning);
  let match: MatchState = createMatch(tuning, { format: 'Duels', bestOf: 1, seed: options.seed ?? 1, arena: battleNameFor(options.map, 0), teams: [0, 1], weapons: [weapon, weapon] });
  local.setYaw(match.duel.fighters[0]!.facing);
  renderer.setPlayer(0, storedBody() as Parameters<Renderer['setPlayer']>[1]);

  let prev: SimState = match.duel;
  let carry = 0;
  let last = performance.now();
  let stopped = false;
  // For checking the walk without a keyboard (dev only): the Player's Fighter, where it stands.
  (window as unknown as { walkAt: () => unknown }).walkAt = () => ({ tick: match.tick, at: match.duel.fighters[0]!.position, y: match.duel.fighters[0]!.y });
  (window as unknown as { walkSeek: (seconds: number, move: { x: number; z: number }) => unknown }).walkSeek = (seconds, move) => {
    for (let i = 0; i < seconds / TICK_SECONDS && match.status.status === 'InProgress'; i++) {
      prev = match.duel;
      match = stepMatch(match, [{ ...local.sample(), move, face: Math.atan2(move.x, move.z) }, IDLE_INTENT], tuning);
    }
    return { tick: match.tick, at: match.duel.fighters[0]!.position, y: match.duel.fighters[0]!.y };
  };

  const frame = (now: number) => {
    if (stopped) return;
    carry += Math.min(0.25, (now - last) / 1000);
    last = now;
    let steps = 0;
    while (carry >= TICK_SECONDS && steps < MAX_TICKS_PER_FRAME && match.status.status === 'InProgress') {
      const mine: Intent = local.sample();
      prev = match.duel;
      match = stepMatch(match, [mine, IDLE_INTENT], tuning);
      carry -= TICK_SECONDS;
      steps++;
    }
    if (match.status.status === 'Over' || steps === MAX_TICKS_PER_FRAME) carry = Math.min(carry, TICK_SECONDS);
    const alpha = match.status.status === 'Over' ? 1 : Math.min(1, carry / TICK_SECONDS);
    const me = match.duel.fighters[0]!;
    const was = prev.fighters[0] ?? me;
    const l = (a: number, b: number) => a + (b - a) * alpha;
    const at = { x: l(was.position.x, me.position.x), y: l(was.y, me.y), z: l(was.position.z, me.position.z) };
    if (inDuel(me)) placeThirdPersonCamera(renderer.camera, cameraForHeight(tuning.camera, me.size?.height ?? 1), at, local.yaw, local.pitch, renderer.collider);
    renderer.render(prev, match.duel, alpha);
    panel.textContent =
      `${options.map} · Walk   x ${me.position.x.toFixed(1)}  z ${me.position.z.toFixed(1)}  height ${me.y.toFixed(2)} m\n` +
      `${match.status.status === 'Over' ? 'The other Fighter fell' : 'WASD walk · Space jump · click: take the mouse · Esc: free it'}`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    stop() {
      stopped = true;
      input.dispose();
      if (document.pointerLockElement) document.exitPointerLock();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      panel.remove();
      renderer.dispose();
    },
  };
}
