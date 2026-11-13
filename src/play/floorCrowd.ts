/**
 * A Delver Run's Crowd on screen (docs/plans/delver.md, Stage 3): the Floor's Warbands drawn as a Battle draws its armies, each
 * Soldier an impostor (`CrowdView`) until the Bubble promotes it into the Fighter Pool, when `BubbleSwap` crossfades it with its
 * full model. One `FloorCrowd` lives for the whole Run: the atlases are baked once from the Troops (every Floor shares them, so the
 * base Tuning Data's Battle serves as well as a Floor's `arenaTuning`) and each Floor's new Crowd is just a Crowd of another length.
 * The atlases bake in the background, with no loading bar: the Floor plays on with Soldiers undrawn until they are ready (a
 * promoted Soldier is a Fighter, drawn by the Renderer as ever). Render only: it reads the state and never changes an outcome.
 */
import type * as THREE from 'three';
import { battlefieldHeight, battlefieldOf, type Heightfield, type SimState } from '../sim';
import { arenaTuning } from '../sim/delver';
import type { TuningData } from '../tuning';
import { blobTexture } from '../render/blobShadow';
import { BubbleSwap } from '../render/bubbleSwap';
import { CrowdView } from '../render/crowdView';
import { bakeImpostorAtlases, type ImpostorAtlases } from '../render/impostorAtlas';
import type { Renderer } from '../render/renderer';

/** The part of the Renderer a Floor's Crowd draws through. */
export type CrowdStage = Pick<Renderer, 'scene' | 'setFades' | 'impacts' | 'gl'>;

/** The part of `CrowdView` a Floor's Crowd uses (so a test can stand one in). */
export interface CrowdDraw {
  readonly root: THREE.Object3D;
  update(crowd: NonNullable<SimState['crowd']>, tick: number, alpha: number, hf: Heightfield, camera: THREE.Camera, fades?: Float32Array): void;
  dispose(): void;
}

/** How a `FloorCrowd` makes its parts: the real ones by default, stubs in a test. */
export interface FloorCrowdParts {
  bake(): Promise<ImpostorAtlases>;
  view(atlases: ImpostorAtlases): CrowdDraw;
}

/** A Delver Run's Crowd view: owns the atlases, the `CrowdView` and the `BubbleSwap` from the Run's start to its end. */
export class FloorCrowd {
  private readonly swap = new BubbleSwap();
  private view: CrowdDraw | null = null;
  private atlases: ImpostorAtlases | null = null;
  private fades = new Float32Array(0);
  private disposed = false;
  private warned = -1;
  private readonly parts: FloorCrowdParts;

  /** `party`: how many Fighters are the party (Pool slots from there are the Bubble's, drawn only while bound). */
  constructor(
    private readonly stage: CrowdStage,
    private readonly tuning: TuningData,
    private readonly party: number,
    parts?: FloorCrowdParts,
  ) {
    this.parts = parts ?? {
      bake: () => bakeImpostorAtlases(stage.gl, tuning, tuning.battle),
      view: (atlases) => new CrowdView(atlases, tuning.battle, blobTexture()),
    };
    void this.parts.bake().then((atlases) => {
      if (this.disposed) {
        atlases.dispose();
        return;
      }
      this.atlases = atlases;
      this.view = this.parts.view(atlases);
      stage.scene.add(this.view.root);
    });
  }

  /** Whether the impostors are baked and drawn. */
  get ready(): boolean {
    return this.view !== null;
  }

  /**
   * Draw the Floor's Crowd of `state` (`alpha` of the way to the next Tick), `seconds` of wall time after the last call, as
   * `camera` sees it: the Promotion swaps (a dust puff, the model fading in as the impostor fades out) and every Soldier's impostor.
   * Call it just before the Renderer draws the Fighters, which it also tells how much of each Pool slot's model to show.
   */
  update(state: SimState, alpha: number, seconds: number, camera: THREE.Camera): void {
    const crowd = state.crowd;
    if (!crowd || this.disposed) return;
    const floor = arenaTuning(this.tuning, state.arena);
    const field = battlefieldOf(floor.battle, state.arena);
    for (const s of this.swap.update(state, seconds)) {
      const y = field ? battlefieldHeight(field.heights, s.at.x, s.at.z) : 0;
      this.stage.impacts.dust({ kind: 'Swap', point: { x: s.at.x, y, z: s.at.z }, strength: 1 });
    }
    // The party is always whole; a Pool slot shows its model only while a Soldier is bound to it (or fading).
    this.stage.setFades((k) => (k < this.party ? 1 : this.swap.modelFade(k)));
    // A new Floor's Crowd is another length.
    if (this.fades.length !== crowd.x.length) this.fades = new Float32Array(crowd.x.length);
    const army = this.tuning.battle.armySize;
    if (crowd.x.length > army && this.warned !== crowd.x.length) {
      this.warned = crowd.x.length;
      console.warn(`Floor Crowd of ${crowd.x.length} Soldiers is longer than the army size ${army}: impostor draws will overlap.`);
    }
    const fades = this.swap.impostorFades(crowd, this.fades);
    if (this.view && field) this.view.update(crowd, state.tick, alpha, field.heights, camera, fades);
  }

  /** Take the view out of the scene and free the atlases (the Run is over, or the player left). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.view) {
      this.stage.scene.remove(this.view.root);
      this.view.dispose();
    }
    this.atlases?.dispose();
    this.view = null;
    this.atlases = null;
    this.stage.setFades(null);
  }
}
