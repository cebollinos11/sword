import type * as THREE from 'three';
import type { SimState } from '../sim';
import { weaponByName, type TuningData } from '../tuning';
import { drawnPose, FIGHTER_COLOURS, FighterView } from './fighterView';
import { ImpactEffects } from './impacts';
import { Stage } from './stage';

/**
 * Three.js view of the Simulation. Reads Simulation state, interpolates the
 * solved Skeletons between the previous and current Tick (or draws a fallen
 * Fighter's Death Ragdoll), and never writes back.
 */
export class Renderer {
  private readonly stage: Stage;
  private readonly views: FighterView[] = [];
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

  /** Draw a frame between Tick `prev` and Tick `curr`; `alpha` in [0, 1]. */
  render(prev: SimState, curr: SimState, alpha: number): void {
    curr.fighters.forEach((f, i) => {
      let view = this.views[i];
      if (!view) {
        view = new FighterView(FIGHTER_COLOURS[i % FIGHTER_COLOURS.length]!, this.tuning);
        this.views[i] = view;
        this.stage.scene.add(view.root);
      }
      view.update(drawnPose(prev, curr, i, alpha, this.tuning), weaponByName(this.tuning, f.weapon));
    });
    const now = performance.now();
    this.impacts.update((now - this.lastDraw) / 1000);
    this.lastDraw = now;
    this.stage.draw();
  }
}
