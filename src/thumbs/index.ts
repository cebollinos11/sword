/**
 * The thumbnail page (`#/thumbs`, dev server only): draws the menu's pictures with the game's own
 * renderer and saves them under public/thumbs/ (through the dev server's `/__thumbs/` endpoint):
 *
 * - arenas/<Arena>.webp: each Arena with two Fighters squaring up at their spawns;
 * - bodies/<model>.webp: each Body model, full length, on a transparent background;
 * - weapons/<file>.webp: each Weapon on its own, on a transparent background.
 *
 * Rerun it after adding or changing an Arena, a Body model or a Weapon.
 */
import * as THREE from 'three';
import { createMatch, type SimState } from '../sim';
import { weaponByName, type TuningData, type WeaponTuning } from '../tuning';
import { Stage } from '../render/stage';
import { drawnPose, FighterView, teamColour } from '../render/fighterView';
import { BODY_MODELS, preloadBody, type BodyModelName } from '../render/bodyModel';
import { weaponThumb } from '../play/dom';

const ARENA_SIZE = { w: 640, h: 360 };
const BODY_SIZE = { w: 320, h: 420 };
const WEAPON_SIZE = { w: 480, h: 160 };
/** How steeply each Weapon is shown rising, left to right (radians). */
const WEAPON_TILT = 0.2;
/** Rendered this many times larger, then scaled down: cheap anti-aliasing. */
const SUPERSAMPLE = 2;
/** The Bodies the Arena pictures show squaring up. */
const ARENA_BODIES: readonly [BodyModelName, BodyModelName] = ['female', 'brawler'];
/** A neutral colour for the Bodies' Team-coloured parts in their own pictures. */
const NEUTRAL = 0x8a8f99;

/**
 * Where the camera stands for an Arena's picture, relative to the middle of the two Fighters: off to the side of
 * the line between them, up, and back along it, each in metres per metre between them (with a floor).
 */
const ARENA_SHOT = { side: 0.95, minSide: 4.5, up: 0.35, minUp: 2.2, along: -0.35 };
/** Arenas walled in beside the Fighters' line: shot from behind the first Fighter instead, high, looking down the line. */
const FROM_BEHIND: ReadonlySet<string> = new Set(['library']);

export async function startThumbs(container: HTMLElement, tuning: TuningData): Promise<void> {
  const log = document.createElement('pre');
  log.style.cssText = 'position:fixed;left:0;bottom:0;margin:0;padding:8px;font:12px monospace;color:#fff;background:#000a;z-index:9;max-height:40%;overflow:auto';
  const gallery = document.createElement('div');
  gallery.style.cssText = 'position:fixed;inset:0;overflow:auto;padding:12px;display:flex;flex-wrap:wrap;gap:8px;align-content:flex-start;background:#223';
  document.body.append(gallery, log);
  const say = (line: string) => (log.textContent += `${line}\n`);

  const save = async (path: string, canvas: HTMLCanvasElement) => {
    const blob = await new Promise<Blob>((ok) => canvas.toBlob((b) => ok(b!), 'image/webp', 0.86));
    const res = await fetch(`/__thumbs/${path}`, { method: 'POST', body: blob });
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    img.title = path;
    img.style.cssText = 'max-height:180px;background:repeating-conic-gradient(#334 0 25%,#445 0 50%) 0/16px 16px';
    gallery.append(img);
    say(`${res.ok ? 'saved' : 'FAILED'} ${path} (${Math.round(blob.size / 1024)} kB)`);
  };

  for (const arena of Object.keys(tuning.arenas)) await save(`arenas/${arena}.webp`, await arenaShot(container, tuning, arena));
  for (const body of BODY_MODELS) await save(`bodies/${body}.webp`, await bodyShot(tuning, body));
  for (const [file, weapon] of weaponFiles(tuning)) await save(`weapons/${file}.webp`, weaponShot(tuning, weapon));
  say('done');
  document.title = 'Thumbnails done';
}

function weaponFiles(tuning: TuningData): [string, WeaponTuning][] {
  return Object.values(tuning.weapons).map((w) => [weaponThumb(w.name), w]);
}

/** Let pending loads settle (timers, not animation frames: those stop in a hidden tab). */
const frames = (n = 2) => new Promise<void>((ok) => setTimeout(ok, n * 50));

/** Copy a WebGL canvas into a 2D canvas of the final size (call right after rendering). */
function shrink(from: HTMLCanvasElement, size: { w: number; h: number }): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = size.w;
  out.height = size.h;
  const g = out.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(from, 0, 0, size.w, size.h);
  return out;
}

/** Two Fighters at the Duel's start, posed and dressed. */
async function duellists(tuning: TuningData, arena: string, bodies: readonly BodyModelName[], colours: readonly number[]): Promise<{ state: SimState; views: FighterView[] }> {
  const weapons = Object.keys(tuning.weapons);
  const state = createMatch(tuning, { bestOf: 1, arena, weapons: [weapons[0]!, weapons[weapons.length - 1]!] }).duel;
  await Promise.all(bodies.map(preloadBody));
  const views = state.fighters.map((f, i) => {
    const v = new FighterView(colours[i]!, tuning, bodies[i]);
    v.update(drawnPose(state, state, i, 1, tuning), weaponByName(tuning, f.weapon));
    return v;
  });
  await frames(3); // the Bodies' own copies are made a moment after the models are in
  state.fighters.forEach((f, i) => views[i]!.update(drawnPose(state, state, i, 1, tuning), weaponByName(tuning, f.weapon)));
  return { state, views };
}

async function arenaShot(container: HTMLElement, tuning: TuningData, arena: string): Promise<HTMLCanvasElement> {
  const box = document.createElement('div');
  box.style.cssText = `position:fixed;left:0;top:0;width:${ARENA_SIZE.w}px;height:${ARENA_SIZE.h}px;visibility:hidden`;
  container.append(box);
  const stage = new Stage(box, tuning);
  stage.renderer.setPixelRatio(SUPERSAMPLE);
  stage.resize();
  stage.setArena(arena);
  await stage.ready();
  const { state, views } = await duellists(tuning, arena, ARENA_BODIES, [teamColour(0, 0), teamColour(1, 0)]);
  for (const v of views) stage.scene.add(v.root);

  const [a, b] = state.fighters as [SimState['fighters'][number], SimState['fighters'][number]];
  const mid = new THREE.Vector3((a.position.x + b.position.x) / 2, (a.y + b.y) / 2, (a.position.z + b.position.z) / 2);
  const line = new THREE.Vector3(b.position.x - a.position.x, 0, b.position.z - a.position.z).normalize();
  const side = new THREE.Vector3(-line.z, 0, line.x);
  const apart = Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z);
  const s = ARENA_SHOT;
  const cam = stage.camera;
  if (FROM_BEHIND.has(arena)) {
    cam.position.set(a.position.x, a.y + 3.2, a.position.z).addScaledVector(line, -3.5).addScaledVector(side, 1.2);
  } else {
    cam.position.copy(mid).addScaledVector(side, Math.max(s.minSide, apart * s.side)).addScaledVector(line, apart * s.along);
    cam.position.y += Math.max(s.minUp, apart * s.up);
  }
  cam.lookAt(mid.x, mid.y + 0.8, mid.z);
  await frames(2);
  stage.renderer.render(stage.scene, cam);
  const out = shrink(stage.canvas, ARENA_SIZE);
  stage.renderer.dispose();
  box.remove();
  return out;
}

/** A small studio: transparent background, soft fill, a warm key light and a cool rim. */
function studio(size: { w: number; h: number }): { renderer: THREE.WebGLRenderer; scene: THREE.Scene } {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(SUPERSAMPLE);
  renderer.setSize(size.w, size.h);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdde6ff, 0x3a3226, 1.4));
  const key = new THREE.DirectionalLight(0xffe8cc, 2.2);
  key.position.set(3, 5, 4);
  const rim = new THREE.DirectionalLight(0x9fc0ff, 1.6);
  rim.position.set(-4, 3, -5);
  scene.add(key, rim);
  return { renderer, scene };
}

async function bodyShot(tuning: TuningData, body: BodyModelName): Promise<HTMLCanvasElement> {
  const { renderer, scene } = studio(BODY_SIZE);
  const { state, views } = await duellists(tuning, tuning.arena.editor, [body, body], [NEUTRAL, NEUTRAL]);
  const f = state.fighters[0]!;
  const view = views[0]!;
  scene.add(view.root);
  const camera = new THREE.PerspectiveCamera(26, BODY_SIZE.w / BODY_SIZE.h, 0.1, 50);
  // From the front, a little to the Fighter's right: a three-quarter view.
  const yaw = f.facing + 0.45;
  const target = new THREE.Vector3(f.position.x, f.y + 0.92, f.position.z);
  camera.position.set(target.x + Math.sin(yaw) * 4.6, target.y + 0.35, target.z + Math.cos(yaw) * 4.6);
  camera.lookAt(target);
  renderer.render(scene, camera);
  const out = shrink(renderer.domElement, BODY_SIZE);
  renderer.dispose();
  return out;
}

function weaponShot(tuning: TuningData, weapon: WeaponTuning): HTMLCanvasElement {
  const { renderer, scene } = studio(WEAPON_SIZE);
  const state = createMatch(tuning, { bestOf: 1, weapons: [weapon.name, weapon.name] }).duel;
  const view = new FighterView(NEUTRAL, tuning, 'skeleton');
  const pose = drawnPose(state, state, 0, 1, tuning);
  // Lying almost level, rising a little to the right, its flat facing the camera.
  const up = new THREE.Vector3(Math.cos(WEAPON_TILT), Math.sin(WEAPON_TILT), 0);
  const length = weapon.length;
  view.update({ ...pose, blade: { hilt: { x: 0, y: 0, z: 0 }, tip: { x: up.x * length, y: up.y * length, z: 0 }, edge: { x: -up.y, y: up.x, z: 0 } } }, weapon);
  view.bodyVisible = false;
  scene.add(view.root);
  // Fit an orthographic camera round what shows.
  const bounds = new THREE.Box3();
  view.root.updateMatrixWorld(true);
  view.root.traverseVisible((o) => {
    if (o instanceof THREE.Mesh) bounds.expandByObject(o);
  });
  const centre = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  // Every Weapon fills the width, so a short one shows as large as a long one.
  const aspect = WEAPON_SIZE.w / WEAPON_SIZE.h;
  const halfW = Math.max(size.x, size.y * aspect) * 0.53;
  const halfH = halfW / aspect;
  const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 50);
  camera.position.set(centre.x, centre.y, centre.z + 10);
  camera.lookAt(centre);
  renderer.render(scene, camera);
  const out = shrink(renderer.domElement, WEAPON_SIZE);
  renderer.dispose();
  return out;
}
