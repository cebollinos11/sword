/**
 * A Delver Run's Crowd on screen (docs/plans/delver.md, Stage 3; docs/plans/delver-troops.md): the Floor's Warbands drawn as a Battle draws
 * its armies, each Soldier an impostor (`CrowdView`) until the Bubble promotes it into the Fighter Pool, when `BubbleSwap` crossfades it with
 * its full model. One `FloorCrowd` lives for the whole Run. A Floor's impostors are its Prefabs' atlases (`floorLooks`: a few Prefabs, each one
 * Body and Weapon), so a Run never bakes its whole roster at once:
 * - The first Floor's looks bake on the Run's first frames, reporting each look baked (`onProgress`) so the game can put a loading bar over them;
 *   until they are ready the Soldiers are undrawn (a promoted Soldier is a Fighter, drawn by the Renderer as ever).
 * - Once a Floor is drawn, the next Floor's new looks bake in the background, a few cells a frame (`PACE_MS`), so they are ready at its Stairs.
 * - A look already baked is kept for as long as this Floor or the next draws it, and freed after.
 * If the Party reaches a Floor before its looks are in, they bake at full speed while the last Floor's view draws the Soldiers it can.
 * Render only: it reads the state and never changes an outcome.
 */
import type * as THREE from 'three';
import { battlefieldHeight, battlefieldOf, soldierHeight, type Heightfield, type SimState } from '../sim';
import { arenaTuning, floorArenaName, floorLooks, floorTroops, parseFloorArena } from '../sim/delver';
import { weaponByName, type BattleTuning, type TuningData } from '../tuning';
import { blobTexture } from '../render/blobShadow';
import { BubbleSwap } from '../render/bubbleSwap';
import { CrowdView } from '../render/crowdView';
import { bakeImpostorAtlas, type ImpostorAtlas, type ImpostorAtlases } from '../render/impostorAtlas';
import type { Renderer } from '../render/renderer';
import { soldierClips, type SoldierClips } from '../render/soldierClips';
import { nextPaint } from './loadingBar';

/** The milliseconds a background bake may take of a frame before it waits for the next. */
export const PACE_MS = 4;

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
  /** Bake Prefab `prefab`'s look (an index into `delver.troops`). With `pace`, it may stop between frames whenever `pace` returns a promise. */
  bake(prefab: number, pace?: () => Promise<void> | undefined): Promise<ImpostorAtlas>;
  view(atlases: ImpostorAtlases): CrowdDraw;
  /** Resolves once the next frame has painted. */
  frame(): Promise<void>;
}

/**
 * The Battle Tuning a Delver Run's `CrowdView` indexes: the Battle's, with the Floor Troops (`floorTroops`: every Variant of the Delver's Prefabs,
 * then the elite ones) as its Troops, so each Soldier is drawn as its Prefab, in its skill's tint. Every Floor shares it.
 */
export function floorBattle(tuning: TuningData): BattleTuning {
  return { ...tuning.battle, troops: floorTroops(tuning.delver).troops };
}

/**
 * The atlases of a Floor drawn from Prefabs `looks` (in that order, `atlases[k]` Prefab `looks[k]`'s), indexed for `battle`'s Troops: a Troop
 * draws from its Prefab's atlas, or none (-1) when its Prefab is not among `looks`. It frees nothing: the atlases are the `FloorCrowd`'s.
 */
export function floorAtlases(battle: BattleTuning, looks: readonly number[], atlases: readonly ImpostorAtlas[]): ImpostorAtlases {
  const of = battle.troops.map((t) => [t.prefab === undefined ? -1 : looks.indexOf(t.prefab)]);
  return { atlases, index: [of, of], dispose() {} };
}

/** A Delver Run's Crowd view: owns the atlases, the `CrowdView` and the `BubbleSwap` from the Run's start to its end. */
export class FloorCrowd {
  private readonly swap = new BubbleSwap();
  private view: CrowdDraw | null = null;
  /** Each Prefab's atlas once baked (null: its bake failed, so it is never tried again). */
  private readonly atlases = new Map<number, ImpostorAtlas | null>();
  /** Each Prefab's bake under way. */
  private readonly baking = new Map<number, Promise<ImpostorAtlas | null>>();
  /** The Floor (its Arena name) the view draws, and the one being made ready for it. */
  private shown: string | null = null;
  private wanted: string | null = null;
  /** While true, no bake waits for a frame: a Floor is waiting on it. */
  private hurry = false;
  private fades = new Float32Array(0);
  private disposed = false;
  private warned = -1;
  private readonly parts: FloorCrowdParts;
  private readonly battle: BattleTuning;
  /** Settles once the first Floor's bake is over: the impostors drawn, or (it failed) the Floor plays on without them. */
  readonly settled: Promise<void>;

  /** `party`: how many Fighters are the party (Pool slots from there are the Bubble's, drawn only while bound); `arena`: the Run's first Floor's Arena. */
  constructor(
    private readonly stage: CrowdStage,
    private readonly tuning: TuningData,
    private readonly party: number,
    arena: string,
    parts?: FloorCrowdParts,
    /** Called as the first Floor's looks bake: `done` of `total` are in. */
    onProgress?: (done: number, total: number) => void,
  ) {
    const battle = (this.battle = floorBattle(tuning));
    // A Weapon's clips are the same whatever Body holds it: recorded once for every Prefab that wields it.
    const clips = new Map<string, SoldierClips>();
    this.parts = parts ?? {
      bake: (prefab, pace) => {
        const p = tuning.delver.troops[prefab]!;
        const weapon = weaponByName(tuning, p.weapon).name;
        if (!clips.has(weapon)) clips.set(weapon, soldierClips(tuning, weapon));
        return bakeImpostorAtlas(stage.gl, tuning, { body: p.body, weapon: p.weapon }, clips.get(weapon), pace);
      },
      view: (atlases) => new CrowdView(atlases, battle, blobTexture()),
      frame: nextPaint,
    };
    // A frame between atlases, as a Battle's loading bar gives (`battleScreen.ts`): the Run is already ticking online, and one
    // unbroken bake of every look holds this page's Ticks and Intents for seconds, long enough on a slow machine for the host's
    // `DEFAULT_TIMEOUT_TICKS` to drop a guest and hand its Fighter to the AI.
    const progress = async (done: number, total: number) => {
      if (!this.disposed) onProgress?.(done, total);
      await this.parts.frame();
    };
    this.wanted = arena;
    this.settled = this.ready_(arena, progress).then(
      () => this.show(arena),
      (e: unknown) => console.error('The Floor Crowd’s impostors failed to bake; its Soldiers go undrawn.', e),
    );
  }

  /** Whether the impostors are baked and drawn. */
  get ready(): boolean {
    return this.view !== null;
  }

  /** The Prefabs Floor `arena` draws (none for an Arena that is not a Floor). */
  private looksOf(arena: string): number[] {
    const f = parseFloorArena(arena);
    return f ? floorLooks(this.tuning.delver, f.seed, f.floor) : [];
  }

  /** The Floor after Floor `arena`, or null after a Run's last. */
  private nextOf(arena: string): string | null {
    const f = parseFloorArena(arena);
    const { tiers, floorsPerTier } = this.tuning.delver;
    return f && f.floor < tiers * floorsPerTier ? floorArenaName(f.seed, f.floor + 1) : null;
  }

  /** Prefab `prefab`'s atlas: kept, under way, or baked now (`paced`: a few cells a frame, unless something is in a hurry). */
  private atlasOf(prefab: number, paced: boolean): Promise<ImpostorAtlas | null> {
    if (this.atlases.has(prefab)) return Promise.resolve(this.atlases.get(prefab)!);
    const under = this.baking.get(prefab);
    if (under) return under;
    let since = performance.now();
    const pace = paced
      ? () => {
          if (this.hurry || this.disposed || performance.now() - since < PACE_MS) return undefined;
          return this.parts.frame().then(() => void (since = performance.now()));
        }
      : undefined;
    const made = this.parts.bake(prefab, pace).then(
      (atlas) => {
        this.baking.delete(prefab);
        if (this.disposed) {
          atlas.dispose();
          return null;
        }
        this.atlases.set(prefab, atlas);
        return atlas;
      },
      (e: unknown) => {
        this.baking.delete(prefab);
        console.error(`The impostor of ${this.tuning.delver.troops[prefab]?.name ?? prefab} failed to bake; its Soldiers go undrawn.`, e);
        this.atlases.set(prefab, null);
        return null;
      },
    );
    this.baking.set(prefab, made);
    return made;
  }

  /** Bake every look of Floor `arena` in turn, at full speed (reporting each to `progress`, if given). */
  private async ready_(arena: string, progress?: (done: number, total: number) => Promise<void>): Promise<void> {
    const looks = this.looksOf(arena);
    this.hurry = true;
    try {
      for (const [k, prefab] of looks.entries()) {
        if (this.disposed) return;
        if (progress && !this.atlases.has(prefab)) await progress(k, looks.length);
        await this.atlasOf(prefab, false);
      }
      await progress?.(looks.length, looks.length);
    } finally {
      this.hurry = false;
    }
  }

  /** Draw Floor `arena` from here on: a view of its looks' atlases, the last one's freed, and every atlas neither it nor the next Floor draws freed; then the next Floor's looks bake in the background. */
  private show(arena: string): void {
    if (this.disposed || this.wanted !== arena) return;
    const looks = this.looksOf(arena).filter((p) => this.atlases.get(p));
    if (this.view) {
      this.stage.scene.remove(this.view.root);
      this.view.dispose();
      this.view = null;
    }
    this.shown = arena;
    const next = this.nextOf(arena);
    const keep = new Set([...looks, ...(next ? this.looksOf(next) : [])]);
    for (const [prefab, atlas] of this.atlases)
      if (atlas && !keep.has(prefab)) {
        atlas.dispose();
        this.atlases.delete(prefab);
      }
    if (looks.length > 0) {
      this.view = this.parts.view(floorAtlases(this.battle, looks, looks.map((p) => this.atlases.get(p)!)));
      this.stage.scene.add(this.view.root);
    }
    // The next Floor's new looks, one after another, a few cells a frame.
    if (next) void (async () => {
      for (const prefab of this.looksOf(next)) {
        if (this.disposed || this.shown !== arena) return;
        await this.atlasOf(prefab, true);
      }
    })();
  }

  /** Make Floor `arena` the one drawn: at once if its looks are in, else once they bake (the last Floor's view drawing meanwhile). */
  private follow(arena: string): void {
    if (arena === this.shown || arena === this.wanted) return;
    this.wanted = arena;
    void this.ready_(arena).then(() => this.show(arena));
  }

  /**
   * Draw the Floor's Crowd of `state` (`alpha` of the way to the next Tick), `seconds` of wall time after the last call, as
   * `camera` sees it: the Promotion swaps (a dust puff, the model fading in as the impostor fades out) and every Soldier's impostor.
   * Call it just before the Renderer draws the Fighters, which it also tells how much of each Pool slot's model to show.
   */
  update(state: SimState, alpha: number, seconds: number, camera: THREE.Camera): void {
    const crowd = state.crowd;
    if (!crowd || this.disposed) return;
    // A new Floor (its Stairs taken): its own looks, once they are in.
    this.follow(state.arena);
    const floor = arenaTuning(this.tuning, state.arena);
    const field = battlefieldOf(floor.battle, state.arena);
    for (const s of this.swap.update(state, seconds)) {
      // On the Soldier's own Walk Surface (a gallery's Deck, not the Hall floor under it).
      const surface = crowd.surface[s.soldier];
      const y = field ? (surface === undefined ? battlefieldHeight(field.heights, s.at.x, s.at.z) : soldierHeight(field, surface, s.at.x, s.at.z)) : 0;
      this.stage.impacts.dust({ kind: 'Swap', point: { x: s.at.x, y, z: s.at.z }, strength: 1 });
    }
    // The party is always whole; a Pool slot shows its model only while a Soldier is bound to it (or fading). A traitor's slot
    // (docs/plans/delver.md, Stage 8a) holds its Soldier through the Crowd (`crowd.slot`), with no binding: it is whole while it does.
    const held = traitorSlots(state, this.party);
    this.stage.setFades((k) => (k < this.party || held.has(k) ? 1 : this.swap.modelFade(k)));
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
    for (const atlas of this.atlases.values()) atlas?.dispose();
    this.atlases.clear();
    this.view = null;
    this.stage.setFades(null);
  }
}

/** The Pool slots of a Delver Run's traitors (traitor `j` plays slot `party + j`) that hold a Soldier taken over right now. Pure. */
export function traitorSlots(state: SimState, party: number): Set<number> {
  const held = new Set<number>();
  const crowd = state.crowd;
  state.delver?.traitors?.forEach((r, j) => {
    if (r.soldier >= 0 && crowd?.slot[r.soldier] === party + j) held.add(party + j);
  });
  return held;
}
