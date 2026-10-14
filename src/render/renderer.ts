import { fighterPose, type SimState } from '../sim';
import type { TuningData } from '../tuning';
import { FIGHTER_COLOURS, FighterView, lerpPose } from './fighterView';
import { Stage } from './stage';

/**
 * Three.js view of the Simulation. Reads Simulation state, interpolates the
 * solved Skeletons between the previous and current Tick, and never writes back.
 */
export class Renderer {
  private readonly stage: Stage;
  private readonly views: FighterView[] = [];

  constructor(
    container: HTMLElement,
    private readonly tuning: TuningData,
  ) {
    this.stage = new Stage(container, tuning);
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
      const before = fighterPose(prev.fighters[i] ?? f, this.tuning);
      view.update(lerpPose(before, fighterPose(f, this.tuning), alpha));
    });
    this.stage.draw();
  }
}
