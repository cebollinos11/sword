import type * as THREE from 'three';
import type { CameraCollider } from './cameraCollider';
import { arenaOf, type Layout, type SimState } from '../sim';
import { weaponByName, type TuningData } from '../tuning';
import { BlobShadows } from './blobShadow';
import { forcedBody, isBody, randomBody, type Body } from './bodyModel';
import { DaggerViews } from './daggerView';
import { drawnPose, fighterColours, FighterView } from './fighterView';
import { ImpactEffects } from './impacts';
import { Stage } from './stage';

/** The Tuning Data a Match on Arena `name` is played with (it holds the Arena), and the Arena's Layout if it is generated. */
export type ArenaWorld = (name: string) => { readonly tuning: TuningData; readonly layout?: Layout };

/**
 * Three.js view of the Simulation. Reads Simulation state, interpolates the
 * solved Skeletons between the previous and current Tick (or draws a fallen
 * Fighter's Death Ragdoll), and never writes back.
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
  /** Hit and Block bursts: the game loop feeds it each new Tick's events, like audio. */
  readonly impacts: ImpactEffects;
  private readonly daggers: DaggerViews;
  private readonly shadows = new BlobShadows();

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
    this.impacts = new ImpactEffects(this.stage.scene, tuning);
    this.daggers = new DaggerViews(this.stage.scene);
    this.stage.scene.add(this.shadows.root);
  }

  /** The game camera (the game loop places it, e.g. behind the local Fighter). */
  get camera(): THREE.PerspectiveCamera {
    return this.stage.camera;
  }

  get canvas(): HTMLCanvasElement {
    return this.stage.canvas;
  }

  /** Draw at PlayStation resolution (the screen's aspect ratio kept), or the usual one. */
  setPs1(on: boolean): void {
    this.stage.setPs1(on);
  }

  /** Draw the Arena's collision geometry over a see-through model (a developer view), or not. */
  setColliders(on: boolean): void {
    this.stage.setColliders(on);
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
    for (const slot of this.views) if (slot) this.stage.scene.remove(slot.view.root);
    this.views.length = 0;
  }

  /**
   * Draw a frame between Tick `prev` and Tick `curr`; `alpha` in [0, 1]. Each Fighter wears its team's colour.
   * `timeScale` slows the effects that run on wall time (sparks, spinning daggers) to match a slowed-down replay.
   */
  render(prev: SimState, curr: SimState, alpha: number, timeScale = 1): void {
    const world = this.world(curr.arena);
    this.stage.setArena(curr.arena, world.tuning, world.layout);
    const colours = fighterColours(curr.fighters.map((f) => f.team));
    const poses = curr.fighters.map((_, i) => drawnPose(prev, curr, i, alpha, world.tuning));
    curr.fighters.forEach((f, i) => {
      let slot = this.views[i];
      const other = this.others[i];
      const picked = i === this.player.fighter ? this.player.body : other !== undefined && isBody(other) ? other : undefined;
      const chosen = picked !== undefined;
      const body = this.forced ?? picked ?? (slot && !slot.chosen ? slot.body : randomBody());
      if (!slot || slot.colour !== colours[i] || slot.body !== body) {
        // First sight of this Fighter, a new Match put another team in its slot, or it changed Body.
        if (slot) this.stage.scene.remove(slot.view.root);
        slot = { view: new FighterView(colours[i]!, this.tuning, body), colour: colours[i]!, body, chosen };
        this.views[i] = slot;
        this.stage.scene.add(slot.view.root);
      }
      slot.view.root.visible = true;
      slot.view.update(poses[i]!, weaponByName(this.tuning, f.weapon));
    });
    // A smaller Match than the last one: hide the Fighters it does not have.
    for (let i = curr.fighters.length; i < this.views.length; i++) if (this.views[i]) this.views[i]!.view.root.visible = false;
    this.shadows.update(poses, arenaOf(world.tuning, curr.arena));
    const now = performance.now();
    const seconds = ((now - this.lastDraw) / 1000) * timeScale;
    this.daggers.update(prev, curr, alpha, seconds, poses);
    this.impacts.update(seconds);
    this.lastDraw = now;
    this.stage.draw();
  }
}
