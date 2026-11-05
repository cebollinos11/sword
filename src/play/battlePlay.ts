/**
 * Playing a Battle (docs/plans/big-battle.md, Stage 3): the local Player's Fighter (slot 0 of the Fighter Pool) behind
 * Team 0's army, with Skirmish controls (the Local Controller, mouse and keyboard) and the third-person camera; every
 * other Pool slot driven by a Pool AI. Soldiers near the Player promote to full Fighters and demote again as the Player
 * moves on, the swap crossfaded (`BubbleSwap`) with a dust puff. Dev only for now (`#/battle/<seed>/play?dev=1`, from the
 * title screen with `?dev=1`): no HUD, Lobby or result screen yet (Stage 5), just a panel with the Player's HP, the armies,
 * the Pool and the frame's cost. Esc frees the mouse; a click takes it again.
 */
import { battlefieldHeight, battlefieldOf, createMatch, crowdAlive, inDuel, soldierBody, stepMatch, TICK_SECONDS, type Heightfield, type Intent, type MatchState, type SimState, type SoldierRole } from '../sim';
import { defaultWeaponName, type TuningData } from '../tuning';
import { LocalController, poolControllers, type Controller } from '../controllers';
import { blobTexture } from '../render/blobShadow';
import { BubbleSwap } from '../render/bubbleSwap';
import { CrowdView } from '../render/crowdView';
import { defaultBody, isBody } from '../render/bodyModel';
import { bakeImpostorAtlases } from '../render/impostorAtlas';
import { Renderer } from '../render/renderer';
import { cameraForHeight, placeOrbitCamera, placeThirdPersonCamera } from '../render/thirdPersonCamera';
import { battleBodies } from './battleScreen';
import { bindLocalInput } from './input';

/** Ticks stepped at most per frame, so a slow frame never spirals. */
const MAX_TICKS_PER_FRAME = 8;
/** Frames before the costs are measured (the bake and the first draws are over), and how many the panel averages. */
const WARMUP_FRAMES = 120;
const PANEL_FRAMES = 60;

function stats(ms: readonly number[]): { mean: number; p99: number } {
  if (ms.length === 0) return { mean: 0, p99: 0 };
  const sorted = [...ms].sort((a, b) => a - b);
  return { mean: ms.reduce((s, v) => s + v, 0) / ms.length, p99: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]! };
}

/** The promoted Fighters still standing by what they hold in their Bubble (Attack Slots, Waiting, allies). */
function roles(duel: SimState): Record<SoldierRole, number> {
  const out: Record<SoldierRole, number> = { Attack: 0, Waiting: 0, Ally: 0 };
  for (const f of duel.fighters) if (f.soldier && inDuel(f)) out[f.soldier.role]++;
  return out;
}

const rolesText = (duel: SimState): string => {
  const r = roles(duel);
  return `${r.Attack} attacking, ${r.Waiting} waiting, ${r.Ally} allies`;
};

function storedBody(): string {
  try {
    const b = localStorage.getItem('sword.body');
    return b && isBody(b) ? b : defaultBody();
  } catch {
    return defaultBody();
  }
}

export async function startBattlePlay(container: HTMLElement, tuning: TuningData): Promise<void> {
  container.style.position = 'relative';
  const renderer = new Renderer(container, tuning);
  const panel = document.createElement('pre');
  panel.style.cssText = 'position:absolute;top:8px;left:8px;margin:0;padding:8px 10px;background:rgba(15,15,20,.8);color:#eee;font:12px/1.5 ui-monospace,monospace;border-radius:6px;z-index:10;pointer-events:none';
  container.appendChild(panel);
  panel.textContent = 'baking the soldier…';

  const atlas = await bakeImpostorAtlases(renderer.gl, tuning);
  const crowdView = new CrowdView(atlas, tuning.battle, blobTexture());
  renderer.scene.add(crowdView.root);
  const swap = new BubbleSwap();

  const local = new LocalController();
  const input = bindLocalInput(local, renderer.canvas);
  input.enabled = true;
  let pending: Intent | null = null;
  const player: Controller = { intent: () => pending! };

  const seedOf = Number(location.hash.split(/[/?]/)[2]);
  const seed = Number.isInteger(seedOf) && seedOf >= 0 ? seedOf : 1;
  let match: MatchState = createMatch(tuning, { format: 'Battle', bestOf: 1, seed, teams: [0], weapons: [defaultWeaponName(tuning)] });
  const controllers = poolControllers(tuning, [player]);
  const hf: Heightfield = battlefieldOf(tuning.battle, match.arena)!.heights;
  local.setYaw(match.duel.fighters[0]!.facing);
  const body = storedBody();

  let prev: SimState = match.duel;
  const tickMs: number[] = [];
  /** One Tick: every Controller decides, the Match steps. */
  const tick = () => {
    pending = local.sample();
    const t0 = performance.now();
    const intents = controllers.map((c, i) => c.intent(match.duel, i));
    prev = match.duel;
    match = stepMatch(match, intents, tuning);
    tickMs.push(performance.now() - t0);
    renderer.impacts.onTick(match.tick, match.duel);
  };

  const fades = new Float32Array(match.duel.crowd!.x.length);
  const draw = (alpha: number, seconds: number) => {
    const duel = match.duel;
    for (const s of swap.update(duel, seconds)) {
      renderer.impacts.dust({ kind: 'Swap', point: { x: s.at.x, y: battlefieldHeight(hf, s.at.x, s.at.z), z: s.at.z }, strength: 1 });
    }
    const bodies = battleBodies(duel, 0, [body], tuning.battle.soldier.body, (s) => (duel.crowd ? soldierBody(tuning.battle, duel.crowd, s) : tuning.battle.soldier.body));
    const corpse = duel.crowd!.players[0]?.corpse ?? -1;
    renderer.setPlayer(0, bodies.player as Parameters<Renderer['setPlayer']>[1]);
    renderer.setChosenBodies(bodies.others);
    renderer.setFades((k) => (k === 0 || k === corpse ? 1 : swap.modelFade(k)));
    const me = duel.fighters[0]!;
    const l = (a: number, b: number) => a + (b - a) * alpha;
    const was = prev.fighters[0] ?? me;
    const at = { x: l(was.position.x, me.position.x), y: l(was.y, me.y), z: l(was.position.z, me.position.z) };
    if (inDuel(me)) placeThirdPersonCamera(renderer.camera, cameraForHeight(tuning.camera, me.size?.height ?? 1), at, local.yaw, local.pitch, renderer.collider);
    else placeOrbitCamera(renderer.camera, tuning.camera, at, local.yaw, renderer.collider);
    crowdView.update(duel.crowd!, duel.tick, alpha, hf, renderer.camera, swap.impostorFades(duel.crowd!, fades));
    renderer.render(prev, duel, alpha);
  };

  const cpu: number[] = [];
  const intervals: number[] = [];
  let frames = 0;
  let last = performance.now();
  let carry = 0;
  const report = () => ({ tick: stats(tickMs.slice(-600)), render: stats(cpu), interval: stats(intervals), frames: cpu.length, calls: renderer.gl.info.render.calls });
  // For reading the measurements from the console (dev only).
  (window as unknown as { battleStats: () => unknown }).battleStats = report;
  // For measuring where frames are not being drawn (a hidden page): `count` frames one after another, each a Tick on (the
  // Player walking at the enemy and swinging once among them, or walking along `toward`, pressing Sheathe on the first Tick
  // with `sheathe`), drawn, and the GPU waited for.
  (window as unknown as { battleBench: (count: number, toward?: { x: number; z: number; sheathe?: boolean }) => unknown }).battleBench = (count, toward) => {
    const gl = renderer.gl.getContext();
    const tickCost: number[] = [];
    const frameCost: number[] = [];
    const bound: number[] = [];
    const most = { Attack: 0, Waiting: 0, Ally: 0 };
    let hurt = 0;
    for (let k = 0; k < count && match.status.status === 'InProgress'; k++) {
      const t0 = performance.now();
      const me = match.duel.fighters[0]!;
      const mine: Intent = toward
        ? { ...local.sample(), move: { x: toward.x, z: toward.z }, face: Math.atan2(toward.x, toward.z), sheathe: k === 0 && toward.sheathe === true }
        : { ...local.sample(), move: { x: 0, z: me.position.z < 6 ? 1 : 0 }, face: 0, attack: k % 80 < 30, direction: 'Right' };
      const intents = controllers.map((c, i) => (i === 0 ? mine : c.intent(match.duel, i)));
      prev = match.duel;
      match = stepMatch(match, intents, tuning);
      const t1 = performance.now();
      draw(1, TICK_SECONDS);
      gl.finish();
      tickCost.push(t1 - t0);
      frameCost.push(performance.now() - t1);
      bound.push(match.duel.fighters.filter((f) => f.soldier).length);
      const r = roles(match.duel);
      for (const k of ['Attack', 'Waiting', 'Ally'] as const) most[k] = Math.max(most[k], r[k]);
      hurt += Math.max(0, prev.fighters[0]!.hp - match.duel.fighters[0]!.hp);
    }
    return { tick: stats(tickCost), frame: stats(frameCost), bound: { mean: bound.reduce((s, v) => s + v, 0) / (bound.length || 1), max: Math.max(0, ...bound), ...most }, hurt, hp: match.duel.fighters[0]!.hp, roles: roles(match.duel), calls: renderer.gl.info.render.calls, at: match.duel.fighters[0]!.position, tickNo: match.tick };
  };
  // Likewise: step on `seconds` of Battle time at once with the Player standing.
  (window as unknown as { battleSeek: (seconds: number) => unknown }).battleSeek = (seconds: number) => {
    while (match.duel.tick * TICK_SECONDS < seconds && match.status.status === 'InProgress') {
      pending = { ...local.sample(), move: { x: 0, z: 0 } };
      const intents = controllers.map((c, i) => c.intent(match.duel, i));
      prev = match.duel;
      match = stepMatch(match, intents, tuning);
    }
    return { tick: match.tick, at: match.duel.fighters[0]!.position };
  };

  const frame = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    if (frames > WARMUP_FRAMES) intervals.push(now - last);
    last = now;
    carry += dt;
    let steps = 0;
    while (carry >= TICK_SECONDS && steps < MAX_TICKS_PER_FRAME && match.status.status === 'InProgress') {
      tick();
      carry -= TICK_SECONDS;
      steps++;
    }
    if (match.status.status === 'Over' || steps === MAX_TICKS_PER_FRAME) carry = Math.min(carry, TICK_SECONDS);
    const t0 = performance.now();
    draw(match.status.status === 'Over' ? 1 : Math.min(1, carry / TICK_SECONDS), dt);
    if (++frames > WARMUP_FRAMES) cpu.push(performance.now() - t0);

    const me = match.duel.fighters[0]!;
    const [a, b] = crowdAlive(match.duel.crowd!);
    const bound = match.duel.fighters.filter((f) => f.soldier);
    const r = report();
    const recent = (list: number[]) => stats(list.slice(-PANEL_FRAMES));
    const over = match.status.status === 'Over' ? `\nTeam ${match.status.winner} wins` : '';
    panel.textContent =
      `${match.arena}  ${(match.duel.tick * TICK_SECONDS).toFixed(1)} s   ${inDuel(me) ? `HP ${me.hp.toFixed(0)} / ${me.maxHp}` : 'You fell'}\n` +
      `Team 0 (red)  ${a} / ${tuning.battle.armySize}\nTeam 1 (blue) ${b} / ${tuning.battle.armySize}${over}\n` +
      `Pool ${bound.length + 1} / ${match.duel.fighters.length} bound (${bound.filter((f) => f.death).length} fallen): ${rolesText(match.duel)}\n` +
      `tick ${recent(tickMs).mean.toFixed(2)} ms (p99 ${recent(tickMs).p99.toFixed(1)}), render ${recent(cpu).mean.toFixed(2)} ms, frame ${recent(intervals).mean.toFixed(1)} ms, ${r.calls} draws\n` +
      `click: take the mouse · Esc: free it`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
