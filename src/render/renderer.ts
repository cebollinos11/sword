import * as THREE from 'three';
import type { CameraCollider } from './cameraCollider';
import { arenaOf, type Layout, type SimState, type Vec3 } from '../sim';
import { sizedTuning, weaponByName, type TuningData } from '../tuning';
import { BlobShadows } from './blobShadow';
import { forcedBody, isBody, randomBody, type Body } from './bodyModel';
import { DaggerViews } from './daggerView';
import { DelverMarks, type DelverMarksView } from './delverMarks';
import { DoorMarks } from './doorMarks';
import { HallMarks } from './hallMarks';
import type { DoorMarkView } from '../play/doorMarks';
import { PickupMarks } from './pickupMarks';
import type { PickupView } from './pickupView';
import type { FireState } from './restFire';
import { drawnPose, fighterColours, FighterView, type DrawnPose } from './fighterView';
import { FlailSwing } from './flailSwing';
import { ImpactEffects } from './impacts';
import { Stage } from './stage';
import { SwingTrails } from './swingTrail';
import { arenaTuning } from '../sim/delver';

/** The Tuning Data a Match on Arena `name` is played with (it holds the Arena), and the Arena's Layout if it is generated. */
export type ArenaWorld = (name: string) => { readonly tuning: TuningData; readonly layout?: Layout };

/**
 * Three.js view of the Simulation. Reads Simulation state, interpolates the
 * solved Skeletons between the previous and current Tick (or draws a fallen
 * Fighter's Death Ragdoll), and never writes back. A Benched Fighter (a Run's
 * Team 1 slot its Hall leaves empty) is not drawn at all: no model, no shadow,
 * no dagger in hand, no trail. A Run's Hall also draws its Doors and Rest fire (`HallMarks`), a Delver Run's Floor its Stairs and fires (`DelverMarks`).
 *
 * In a Battle (docs/plans/big-battle.md) every Fighter wears its Team's soldier colour (`battle.soldier.colours`), and a
 * Fighter Pool slot can be faded (`setFades`): a slot just freed keeps drawing the pose it last showed while it fades out.
 */
export class Renderer {
  private readonly stage: Stage;
  /** Each Fighter's view, its colour and Body, and whether that Body was a player's choice (rather than random). */
  private readonly views: ({ view: FighterView; colour: number; body: Body; chosen: boolean } | undefined)[] = [];
  /** One Body for everyone, when the page URL asks for it. */
  private readonly forced = forcedBody();
  /** The Fighter the local player drives (-1: none, e.g. behind the menu) and the Body they chose. */
  private player: { fighter: number; body: Body } = { fighter: -1, body: 'female' };
  /** The Bodies the other players chose, by Fighter (undefined: none, so a random one). */
  private others: readonly (string | undefined)[] = [];
  private lastDraw = performance.now();
  /** The Arena last drawn. */
  private arena = '';
  /** Hit and Block bursts: the game loop feeds it each new Tick's events, like audio. */
  readonly impacts: ImpactEffects;
  private readonly daggers: DaggerViews;
  private readonly shadows = new BlobShadows();
  private readonly trails: SwingTrails;
  private readonly hallMarks = new HallMarks();
  private readonly doorMarks = new DoorMarks();
  private readonly delverMarks = new DelverMarks();
  private delver: DelverMarksView | null = null;
  private doors: readonly DoorMarkView[] = [];
  private readonly pickupMarks: PickupMarks;
  private pickups: readonly PickupView[] = [];
  private fire: FireState = 'lit';
  /** Each Fighter's share of its model to show (`setFades`); null: all of every one. */
  private fades: ((fighter: number) => number) | null = null;
  /** The pose each Fighter was last drawn in, held for a slot fading out once it is no longer drawn. */
  private readonly lastPoses: (DrawnPose | undefined)[] = [];
  /** Each Fighter's flail ball swinging on its chain with the Fighter's inertia (drawing only). */
  private readonly swings: FlailSwing[] = [];
  /** Scratch for `toScreen`. */
  private readonly projected = new THREE.Vector3();

  /**
   * `world` gives, for each Arena name a Match is played on, the Tuning Data holding it and its Layout (a Random Map's
   * Generated Arena is drawn from its Kit's model); by default every Arena is one of `tuning`'s own.
   */
  constructor(
    container: HTMLElement,
    private readonly tuning: TuningData,
    private readonly world: ArenaWorld = () => ({ tuning }),
  ) {
    this.stage = new Stage(container, tuning);
    this.pickupMarks = new PickupMarks(tuning);
    this.impacts = new ImpactEffects(this.stage.scene, tuning);
    this.daggers = new DaggerViews(this.stage.scene);
    this.trails = new SwingTrails(this.stage.scene);
    this.stage.scene.add(this.shadows.root);
    this.stage.scene.add(this.hallMarks.root);
    this.stage.scene.add(this.doorMarks.root);
    this.stage.scene.add(this.delverMarks.root);
    this.stage.scene.add(this.pickupMarks.root);
  }

  /**
   * Where the point (Arena metres) was drawn on screen in the last frame, in CSS px from the canvas's top left, or null
   * when it is behind the camera (or off to the side by more than the screen): for labels the HUD floats over the Arena.
   */
  toScreen(p: { readonly x: number; readonly y: number; readonly z: number }): { x: number; y: number } | null {
    const v = this.projected.set(p.x, p.y, p.z).project(this.stage.camera);
    if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return null;
    const rect = this.stage.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /**
   * Called when a Blocked Throwing Dagger, flying off, lands at `point` on Arena `arena` (render-only, so its clatter comes from
   * here, not the Simulation's events).
   */
  set onDaggerClatter(play: ((point: Vec3, arena: string) => void) | null) {
    this.daggers.onClatter = play && ((point) => play(point, this.arena));
  }

  /** Called when a Hit's blood spray first strikes the floor or a Wall of Arena `arena`, at `point`, `strength` 0..1 (render-only, like a clatter). */
  set onSplatter(play: ((point: Vec3, strength: number, arena: string) => void) | null) {
    this.impacts.onSplatter = play && ((point, strength) => play(point, strength, this.arena));
  }

  /** The game camera (the game loop places it, e.g. behind the local Fighter). */
  get camera(): THREE.PerspectiveCamera {
    return this.stage.camera;
  }

  get canvas(): HTMLCanvasElement {
    return this.stage.canvas;
  }

  /** Take the canvas out of the page and let go of the WebGL context (see `Stage.dispose`). */
  dispose(): void {
    this.stage.dispose();
  }

  /** The WebGL renderer drawing it (e.g. to bake a Battle's impostor atlas with). */
  get gl(): THREE.WebGLRenderer {
    return this.stage.renderer;
  }

  /** The scene, for a view drawn alongside the Fighters (a Battle's Crowd). */
  get scene(): THREE.Scene {
    return this.stage.scene;
  }

  /**
   * From the next frame on, how much of each Fighter's model shows (0 to 1, dithered between), or null for all of each.
   * A Benched Fighter with a share above 0 is drawn in the pose it last showed (a Battle's slot fading out after its Demotion).
   */
  setFades(fades: ((fighter: number) => number) | null): void {
    this.fades = fades;
  }

  /** Draw the Arena's collision geometry over a see-through model (a developer view), or not. */
  setColliders(on: boolean): void {
    this.stage.setColliders(on);
  }

  /** How the pickups lying in the Hall are drawn (`pickupViews`) from the next frame on; the hidden ones are skipped (none: none drawn). */
  setPickups(views: readonly PickupView[]): void {
    this.pickups = views;
  }

  /** How the Rest fire burns for the local Player (`fireState`), from the next frame on. */
  setFire(state: FireState): void {
    this.fire = state;
  }

  /** A Delver Run's Floor marks (Stairs, fires and their rings) from the next frame on; null outside a Delver Run. */
  setDelver(view: DelverMarksView | null): void {
    this.delver = view;
  }

  /** The exit Doors' marks (icon, gate, count) to draw from the next frame on (none: none drawn). */
  setDoors(views: readonly DoorMarkView[]): void {
    this.doors = views;
  }

  /** Keeps the camera inside the Arena last drawn. */
  get collider(): CameraCollider {
    return this.stage.collider;
  }

  /**
   * The local player drives Fighter `fighter` (-1: none) and wears `body`; the others wear what
   * their players chose (see setChosenBodies), or a random model (unless the page URL forces one Body on everyone). Takes effect at once.
   */
  setPlayer(fighter: number, body: Body): void {
    this.player = { fighter, body };
  }

  /** The Bodies the other players chose, by Fighter; a Fighter with none (an AI) wears a random one. Takes effect at once. */
  setChosenBodies(byFighter: readonly (string | undefined)[]): void {
    this.others = byFighter;
  }

  /** A new Match: every Fighter no player chose a Body for is dressed afresh in a random model. */
  recast(): void {
    for (const slot of this.views) if (slot) this.drop(slot.view);
    this.views.length = 0;
    for (const swing of this.swings) swing.reset();
  }

  /** Take a Fighter's view out of the scene and free what it made (its materials, and the pieces of a cut Body). */
  private drop(view: FighterView): void {
    this.stage.scene.remove(view.root);
    view.dispose();
  }

  /**
   * Draw a frame between Tick `prev` and Tick `curr`; `alpha` in [0, 1]. Each Fighter wears its team's colour.
   * `timeScale` slows the effects that run on wall time (sparks, spinning daggers) to match a slowed-down replay.
   */
  render(prev: SimState, curr: SimState, alpha: number, timeScale = 1): void {
    const world = this.world(curr.arena);
    this.arena = curr.arena;
    this.stage.setArena(curr.arena, world.tuning, world.layout);
    const colours = curr.crowd ? curr.fighters.map((f) => world.tuning.battle.soldier.colours[f.team] ?? 0xffffff) : fighterColours(curr.fighters.map((f) => f.team));
    const now = performance.now();
    const seconds = ((now - this.lastDraw) / 1000) * timeScale;
    const tick = prev.tick + (curr.tick - prev.tick) * alpha;
    const poses = curr.fighters.map((f, i) => {
      if (f.benched) return undefined;
      const pose = drawnPose(prev, curr, i, alpha, world.tuning, true);
      if (!pose.flail) {
        this.swings[i]?.reset();
        return pose;
      }
      const swing = (this.swings[i] ??= new FlailSwing());
      return { ...pose, flail: swing.step(pose.flail, weaponByName(sizedTuning(world.tuning, f.size), f.weapon), seconds, tick) };
    });
    curr.fighters.forEach((f, i) => {
      let slot = this.views[i];
      const fade = this.fades ? this.fades(i) : 1;
      const pose = poses[i] ?? (fade > 0 ? this.lastPoses[i] : undefined);
      if (poses[i]) this.lastPoses[i] = poses[i];
      if (!pose || fade <= 0) {
        if (slot) slot.view.root.visible = false;
        return;
      }
      const other = this.others[i];
      const picked = i === this.player.fighter ? this.player.body : other !== undefined && isBody(other) ? other : undefined;
      const chosen = picked !== undefined;
      const body = this.forced ?? picked ?? (slot && !slot.chosen ? slot.body : randomBody());
      // A slot fading out keeps the view it was drawn with.
      if (!slot || (poses[i] && (slot.colour !== colours[i] || slot.body !== body))) {
        // First sight of this Fighter, a new Match put another team in its slot, or it changed Body.
        if (slot) this.drop(slot.view);
        slot = { view: new FighterView(colours[i]!, this.tuning, body), colour: colours[i]!, body, chosen };
        this.views[i] = slot;
        this.stage.scene.add(slot.view.root);
      }
      slot.view.root.visible = true;
      slot.view.setFade(fade);
      slot.view.setBlood(this.impacts.blades.marksOf(i));
      slot.view.setWounds(this.impacts.bodies.marksOf(i));
      slot.view.update(pose, weaponByName(sizedTuning(this.tuning, f.size), f.weapon), f.size, pose.pieces);
    });
    // A smaller Match than the last one: hide the Fighters it does not have.
    for (let i = curr.fighters.length; i < this.views.length; i++) if (this.views[i]) this.views[i]!.view.root.visible = false;
    const arena = arenaOf(arenaTuning(world.tuning, curr.arena), curr.arena);
    this.hallMarks.update(arena, curr.hall, this.fire);
    this.doorMarks.update(arena, curr.hall, this.doors);
    this.delverMarks.update(curr.delver ? this.delver : null);
    // A body in pieces casts its shadow from the piece with the pelvis.
    this.shadows.update(poses.map((p) => p?.pieces?.poses[0] ?? p), arena);
    this.hallMarks.animate(seconds);
    this.delverMarks.animate(seconds);
    this.pickupMarks.update(this.pickups, seconds);
    this.daggers.update(prev, curr, alpha, seconds, poses, arena);
    this.impacts.drip(poses, seconds);
    this.impacts.update(seconds);
    // A flail's trail follows its drawn ball (on the simulated one through Release, so it traces what hits).
    this.trails.update(prev, curr, poses.map((p) => p && (p.flail ? { ...p.blade, tip: p.flail.ball } : p.blade)), seconds);
    this.lastDraw = now;
    this.stage.draw();
  }
}
