/**
 * The Big Battle bench (/sword/#/editor/bench, dev server only): docs/plans/big-battle.md Stage 0. Three scenes, each
 * run for a fixed time, reporting the mean and 99th-percentile ms per Tick or per frame as a Markdown table:
 *  - Fighters: N full AI Fighters in a melee through `stepMatch`, plus a 15-Tick Rollback at each N (benchCore.ts);
 *  - Crowd: the throwaway Crowd step prototype for 400 Soldiers at three staggers, plus hash and snapshot costs;
 *  - Render: 400 instanced billboards (one draw per Team, placeholder texture) around N skinned Bodies posed from a
 *    recorded melee, seen through the third-person camera in the middle of the crowd.
 * Nothing here ships: the Editor only imports it in dev.
 */
import * as THREE from 'three';
import { type MatchState, stepMatch } from '../sim';
import { weaponByName, type TuningData } from '../tuning';
import { defaultBody, preloadBody } from '../render/bodyModel';
import { drawnPose, fighterColours, FighterView } from '../render/fighterView';
import { Stage } from '../render/stage';
import { placeThirdPersonCamera } from '../render/thirdPersonCamera';
import { benchCrowd, benchFighters, DEFAULT_CROWD, meleeMatch, stats, type Stats } from './benchCore';

const FIGHTER_COUNTS = [8, 16, 24, 32, 40];
const FIGHTER_TICKS = 600;
const CROWD_STAGGERS = [6, 3, 1];
const CROWD_TICKS = 3600;
const SOLDIERS = 400;
const RENDER_WARMUP_MS = 1000;
const RENDER_MEASURE_MS = 4000;
/** Ticks of melee recorded for the render scene to loop through. */
const RENDER_TICKS = 240;

const ms = (s: Stats) => `${s.mean.toFixed(2)} / ${s.p99.toFixed(2)}`;
const pause = () => new Promise<void>((r) => setTimeout(r, 0));

export function startBench(container: HTMLElement, tuning: TuningData): void {
  const stage = new Stage(container, tuning);
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:absolute;top:8px;left:8px;max-width:min(760px,calc(100% - 32px));max-height:calc(100% - 32px);overflow:auto;padding:10px 12px;background:rgba(15,15,20,.85);color:#eee;font:12px/1.4 ui-monospace,monospace;border-radius:6px;z-index:10';
  const buttons = document.createElement('div');
  const out = document.createElement('pre');
  out.style.cssText = 'white-space:pre-wrap;margin:8px 0 0';
  panel.append(buttons, out);
  container.style.position = 'relative';
  container.appendChild(panel);

  const lines: string[] = [`# Big Battle bench\n\n${machine(stage)}\n`];
  const show = (status = '') => (out.textContent = lines.join('\n') + (status ? `\n… ${status}` : ''));
  show('pick a scene');
  let busy = false;
  const button = (label: string, run: () => Promise<void>) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.marginRight = '6px';
    b.onclick = async () => {
      if (busy) return;
      busy = true;
      try {
        await run();
      } catch (e) {
        lines.push(`ERROR: ${String(e)}`);
        console.error(e);
      }
      busy = false;
      show();
      console.log(lines.join('\n'));
    };
    buttons.appendChild(b);
  };

  const fighters = async () => {
    lines.push('## Fighters (Beginner AI melee, flat Arena; ms per Tick, mean / p99)\n', '| N | AI intents | Tick (AI + stepMatch) | Online Tick (+ snapshot, save) | 15-Tick Rollback | hashValue(Match) | alive at end |', '|---|---|---|---|---|---|---|');
    for (const n of FIGHTER_COUNTS) {
      show(`Fighters N=${n}`);
      await pause();
      const r = benchFighters(tuning, n, FIGHTER_TICKS);
      lines.push(`| ${n} | ${ms(r.ai)} | ${ms(r.tick)} | ${ms(r.onlineTick)} | ${ms(r.rollback)}${r.deterministic ? '' : ' (DIVERGED)'} | ${ms(r.hash)} | ${r.alive} |`);
    }
    lines.push('');
  };

  const crowd = async () => {
    lines.push(`## Crowd prototype (${SOLDIERS} Soldiers, ${CROWD_TICKS} Ticks; ms, mean / p99)\n`, '| stagger (rate) | step per Tick | hashValue (plain arrays) | FNV over bytes | snapshot (typed) | snapshot (plain) | alive at end |', '|---|---|---|---|---|---|---|');
    for (const stagger of CROWD_STAGGERS) {
      show(`Crowd stagger ${stagger}`);
      await pause();
      const r = benchCrowd({ ...DEFAULT_CROWD, perTeam: SOLDIERS / 2, stagger }, CROWD_TICKS);
      lines.push(`| ${stagger} (${60 / stagger} Hz) | ${ms(r.step)} | ${ms(r.hashPlain)} | ${ms(r.hashBytes)} | ${ms(r.snapshotTyped)} | ${ms(r.snapshotPlain)} | ${r.alive.join(' v ')}${r.deterministic ? '' : ' (DIVERGED)'} |`);
    }
    lines.push('');
  };

  const render = async () => {
    const max = FIGHTER_COUNTS[FIGHTER_COUNTS.length - 1]!;
    show(`recording a ${max}-Fighter melee to pose`);
    await pause();
    const body = defaultBody();
    if (body !== 'skeleton') await preloadBody(body);
    const states = recordMelee(tuning, max);
    const teams = states[0]!.config.teams;
    const colours = fighterColours(teams);
    const views = teams.map((_, i) => new FighterView(colours[i]!, tuning, body));
    views.forEach((v) => stage.scene.add(v.root));
    const crowds = billboards(stage.scene);
    lines.push(`## Render (${SOLDIERS} instanced billboards + N ${body} Bodies, third-person camera; ms per frame, mean / p99)\n`, '| N | CPU (update + draw) | frame interval | draw calls | pixel ratio |', '|---|---|---|---|---|');

    for (const n of [0, ...FIGHTER_COUNTS]) {
      views.forEach((v, i) => (v.root.visible = i < n));
      show(`Render N=${n}`);
      const cpu: number[] = [];
      const frame: number[] = [];
      let calls = 0;
      await new Promise<void>((done) => {
        const start = performance.now();
        let last = start;
        let k = 0;
        const loop = (now: number) => {
          const t0 = performance.now();
          const tick = k++ % (states.length - 1);
          const from = states[tick]!.duel;
          const to = states[tick + 1]!.duel;
          for (let i = 0; i < n; i++) views[i]!.update(drawnPose(from, to, i, 0.5, tuning), weaponByName(tuning, to.fighters[i]!.weapon));
          const f0 = to.fighters[0]!;
          // Behind Fighter 0, looking across the melee and out over the crowd.
          placeThirdPersonCamera(stage.camera, tuning.camera, { x: f0.position.x, y: f0.y, z: f0.position.z }, f0.facing + Math.PI, 0.1, stage.collider);
          crowds.update(stage.camera, now / 1000);
          stage.draw();
          calls = stage.renderer.info.render.calls;
          if (now - start > RENDER_WARMUP_MS) {
            cpu.push(performance.now() - t0);
            frame.push(now - last);
          }
          last = now;
          if (now - start < RENDER_WARMUP_MS + RENDER_MEASURE_MS) requestAnimationFrame(loop);
          else done();
        };
        requestAnimationFrame(loop);
      });
      lines.push(`| ${n} | ${ms(stats(cpu))} | ${ms(stats(frame))} | ${calls} | ${stage.renderer.getPixelRatio().toFixed(2)} |`);
    }
    lines.push('');
    views.forEach((v) => stage.scene.remove(v.root));
    crowds.dispose();
  };

  button('Fighters', fighters);
  button('Crowd', crowd);
  button('Render', render);
  button('All', async () => {
    await fighters();
    await crowd();
    await render();
  });
  stage.draw();
}

/** What the numbers came from: the browser, its cores, and the GPU WebGL reports. */
function machine(stage: Stage): string {
  const gl = stage.renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  return `- ${navigator.userAgent}\n- ${navigator.hardwareConcurrency} logical cores\n- GPU: ${gpu}\n- canvas ${stage.canvas.width}×${stage.canvas.height}`;
}

/** `ticks` Ticks of an n-Fighter melee, every Match state kept (for posing the Bodies frame by frame). */
function recordMelee(tuning: TuningData, n: number): MatchState[] {
  let { match, ais } = meleeMatch(tuning, n);
  const states = [match];
  // Let the lines close first, so the Bodies are mid-fight.
  for (let t = 0; t < 120 + RENDER_TICKS; t++) {
    match = stepMatch(match, ais.map((c, i) => c.intent(match.duel, i)), tuning);
    if (t >= 120) states.push(match);
  }
  return states;
}

/** One InstancedMesh per Team of SOLDIERS / 2 upright quads, turned to face the camera every frame, walking in place. */
function billboards(scene: THREE.Scene): { update(camera: THREE.Camera, seconds: number): void; dispose(): void } {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(32, 18, 12, 0, Math.PI * 2);
  g.fill();
  g.fillRect(16, 32, 32, 56);
  g.fillRect(18, 88, 11, 40);
  g.fillRect(35, 88, 11, 40);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(0.8, 1.8).translate(0, 0.9, 0);
  const perTeam = SOLDIERS / 2;
  const meshes = [0xc0392b, 0x2e86c1].map((color) => new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ map: texture, color, alphaTest: 0.5 }), perTeam));
  // A ring of each army round the melee, 8 to 40 m out (a fixed pattern, not the Simulation's generator: render only).
  const base = meshes.map((_, team) =>
    Array.from({ length: perTeam }, (_, k) => {
      const a = (k * 2.399963 + team * Math.PI) % (Math.PI * 2);
      const r = 8 + 32 * Math.sqrt(((k * 0.618034) % 1 + 0.01) / 1.01);
      return { x: Math.sin(a) * r, z: Math.cos(a) * r, phase: k * 0.37 };
    }),
  );
  meshes.forEach((m) => {
    m.frustumCulled = false;
    scene.add(m);
  });
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const at = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  return {
    update(camera, seconds) {
      meshes.forEach((m, team) => {
        base[team]!.forEach((s, k) => {
          at.set(s.x + Math.sin(seconds * 0.5 + s.phase) * 0.5, 0, s.z);
          q.setFromAxisAngle(up, Math.atan2(camera.position.x - at.x, camera.position.z - at.z));
          m.setMatrixAt(k, matrix.compose(at, q, one));
        });
        m.instanceMatrix.needsUpdate = true;
      });
    },
    dispose() {
      meshes.forEach((m) => {
        scene.remove(m);
        m.dispose();
        (m.material as THREE.Material).dispose();
      });
      geometry.dispose();
      texture.dispose();
    },
  };
}
