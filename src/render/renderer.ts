import type * as THREE from 'three';
import type { SimState } from '../sim';
import { weaponByName, type TuningData } from '../tuning';
import { drawnPose, fighterColours, FighterView } from './fighterView';
import { ImpactEffects } from './impacts';
import { Stage } from './stage';

/**
 * Three.js view of the Simulation. Reads Simulation state, interpolates the
 * solved Skeletons between the previous and current Tick (or draws a fallen
 * Fighter's Death Ragdoll), and never writes back.
 */
export class Renderer {
  private readonly stage: Stage;
  private readonly views: { view: FighterView; colour: number }[] = [];
  private lastDraw = performance.now();
  /** Hit and Block bursts: the game loop feeds it each new Tick's events, like audio. */
  readonly impacts: ImpactEffects;

  constructor(
    container: HTMLElement,
    private readonly tuning: TuningData,
  ) {
    this.stage = new Stage(container, tuning);
    this.impacts = new ImpactEffects(this.stage.scene, tuning);
  }

  /** The game camera (the game loop places it, e.g. behind the local Fighter). */
  get camera(): THREE.PerspectiveCamera {
    return this.stage.camera;
  }

  get canvas(): HTMLCanvasElement {
    return this.stage.canvas;
  }

  /** Draw a frame between Tick `prev` and Tick `curr`; `alpha` in [0, 1]. Each Fighter wears its team's colour. */
  render(prev: SimState, curr: SimState, alpha: number): void {
    const colours = fighterColours(curr.fighters.map((f) => f.team));
    curr.fighters.forEach((f, i) => {
      let slot = this.views[i];
      if (!slot || slot.colour !== colours[i]) {
        // First sight of this Fighter, or a new Match put another team in its slot.
        if (slot) this.stage.scene.remove(slot.view.root);
        slot = { view: new FighterView(colours[i]!, this.tuning), colour: colours[i]! };
        this.views[i] = slot;
        this.stage.scene.add(slot.view.root);
      }
      slot.view.root.visible = true;
      slot.view.update(drawnPose(prev, curr, i, alpha, this.tuning), weaponByName(this.tuning, f.weapon));
    });
    // A smaller Match than the last one: hide the Fighters it does not have.
    for (let i = curr.fighters.length; i < this.views.length; i++) this.views[i]!.view.root.visible = false;
    const now = performance.now();
    this.impacts.update((now - this.lastDraw) / 1000);
    this.lastDraw = now;
    this.stage.draw();
  }
}
