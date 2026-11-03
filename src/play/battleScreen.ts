/**
 * Playing a Battle in the game (docs/plans/big-battle.md, Stage 5): what the game loop draws and announces while a Battle
 * from the Skirmish Lobby is on. The loop still owns the clock, the Local Controller and the menus; this owns the Crowd's
 * impostors (`CrowdView`, from an atlas baked when the Battle starts), the Promotion swaps (`BubbleSwap`), the camera, the
 * Battle's HUD and minimap, the banners and the results screen.
 *
 * The camera follows the Player's slot: their own Fighter, then each Soldier they take over (it turns to face the way that
 * Soldier faces). While they lie fallen it orbits where they fell; once they are out it watches the battle from above.
 */
import { battlefieldHeight, battlefieldOf, type Heightfield, type MatchState, type SimState } from '../sim';
import type { TuningData } from '../tuning';
import type { LocalController } from '../controllers';
import { blobTexture } from '../render/blobShadow';
import { BubbleSwap } from '../render/bubbleSwap';
import { CrowdView } from '../render/crowdView';
import { bakeImpostorAtlas } from '../render/impostorAtlas';
import type { Body } from '../render/bodyModel';
import type { Renderer } from '../render/renderer';
import { placeOrbitCamera, placeThirdPersonCamera } from '../render/thirdPersonCamera';
import { battleFocus } from './battleSpectator';
import { BattleHud, battleResult, battleResultLine, playerRecord, playerStatus, ARMY_NAMES, type BattleResult } from './battleHud';

/** The spectator camera, once the Player is out: this far back and up from the battle's middle. */
const SPECTATOR = { orbitDistance: 34, orbitHeight: 22, lookHeight: 0 };
/** How fast (per second) the spectator camera's aim eases toward the battle's middle. */
const FOLLOW_RATE = 1.5;

/** The slot's Body for each Fighter: the Player's own while it is theirs (and its corpse), the generic soldier's otherwise. */
export function battleBodies(state: SimState, me: number, playerBody: string, soldierBody: string): { player: string; others: (string | undefined)[] } {
  const record = state.crowd?.players[me];
  return {
    player: record && record.soldier >= 0 ? soldierBody : playerBody,
    others: state.fighters.map((_, k) => (k === me ? undefined : k === record?.corpse ? playerBody : soldierBody)),
  };
}

export class BattleScreen {
  /** The impostors are baked and in the scene: the Battle may start. */
  ready = false;
  private crowdView: CrowdView | null = null;
  private readonly swap = new BubbleSwap();
  private readonly hud: BattleHud;
  private readonly hf: Heightfield;
  private fades = new Float32Array(0);
  private readonly focus = { x: 0, z: 0 };
  private disposed = false;
  /** What has been announced: the Rout, the fall, the takeovers so far, being out, the result. */
  private routSeen = false;
  private fellSeen = false;
  private takenSeen = 0;
  private outSeen = false;
  private result: BattleResult | null = null;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyN' && !e.repeat) this.hud.toggleMap();
  };

  constructor(
    container: HTMLElement,
    private readonly renderer: Renderer,
    private readonly tuning: TuningData,
    private readonly local: LocalController,
    private readonly playerBody: string,
    arena: string,
  ) {
    this.hud = new BattleHud(container, tuning.battle);
    this.hf = battlefieldOf(tuning.battle, arena)!.heights;
    addEventListener('keydown', this.onKey);
    this.hud.announce('Mustering the armies…', 30);
    void bakeImpostorAtlas(renderer.gl, tuning, tuning.battle.soldier).then((atlas) => {
      if (this.disposed) return;
      this.crowdView = new CrowdView(atlas, tuning.battle, blobTexture());
      renderer.scene.add(this.crowdView.root);
      this.ready = true;
      this.hud.announce(`Battle · ${tuning.battle.armySize} v ${tuning.battle.armySize}`, 2.5);
    });
  }

  /**
   * A new Tick was presented: announce what it shows that is new (read from the state, so a Tick seen twice says nothing
   * twice). Returns the Battle's result the first time it is over.
   */
  present(match: MatchState, me: number): BattleResult | null {
    const duel = match.duel;
    const crowd = duel.crowd;
    if (!crowd) return null;
    const myTeam = match.config.teams[me] ?? 0;
    const record = playerRecord(duel, me);
    if (record && record.taken > this.takenSeen) {
      this.takenSeen = record.taken;
      this.fellSeen = false;
      const f = duel.fighters[me];
      if (f) this.local.setYaw(f.facing);
      this.hud.announce('You fight on as a soldier', 2);
    }
    const status = playerStatus(duel, me);
    if (status === 'Fallen' && !this.fellSeen) {
      this.fellSeen = true;
      this.hud.announce('You fell', 1.5);
    }
    if (status === 'Out' && !this.outSeen) {
      this.outSeen = true;
      this.hud.announce('You are out: your army has no soldiers left', 3);
    }
    if (crowd.rout && !this.routSeen) {
      this.routSeen = true;
      this.hud.announce(crowd.rout.team === myTeam ? 'Your army breaks and flees!' : `The ${ARMY_NAMES[crowd.rout.team]} army breaks and flees!`, this.tuning.battle.rout.seconds);
    }
    if (!this.result) {
      this.result = battleResult(match, me);
      if (this.result) return this.result;
    }
    return null;
  }

  /** The results screen, saying what follows; and the line for the Lobby. */
  showResults(r: BattleResult, note: string): string {
    this.hud.showResults(r, note);
    return battleResultLine(r);
  }

  /** Draw the frame between Ticks `prev` and `curr` (`alpha` of the way), `seconds` of wall time after the last. */
  draw(prev: MatchState, curr: MatchState, me: number, alpha: number, seconds: number): void {
    const duel = curr.duel;
    const crowd = duel.crowd;
    if (!crowd || !this.crowdView) return;
    const record = playerRecord(duel, me);
    const was = playerRecord(prev.duel, me);
    // A takeover moves Fighters between slots: draw that Tick as it stands, not from where the slots were.
    const tookOver = record !== null && was !== null && record.taken !== was.taken;
    const before = tookOver ? duel : prev.duel;
    if (tookOver) this.swap.forget(record.soldier);
    for (const s of this.swap.update(duel, seconds)) {
      if (record && s.soldier === record.soldier) continue;
      this.renderer.impacts.dust({ kind: 'Swap', point: { x: s.at.x, y: battlefieldHeight(this.hf, s.at.x, s.at.z), z: s.at.z }, strength: 1 });
    }
    const bodies = battleBodies(duel, me, this.playerBody, this.tuning.battle.soldier.body);
    this.renderer.setPlayer(me, bodies.player as Body);
    this.renderer.setChosenBodies(bodies.others);
    const corpse = record?.corpse ?? -1;
    this.renderer.setFades((k) => (k === me || k === corpse ? 1 : this.swap.modelFade(k)));

    const camera = this.renderer.camera;
    const f = duel.fighters[me]!;
    const g = before.fighters[me] ?? f;
    const l = (a: number, b: number) => a + (b - a) * alpha;
    const at = { x: l(g.position.x, f.position.x), y: l(g.y, f.y), z: l(g.position.z, f.position.z) };
    const status = playerStatus(duel, me);
    if (status === 'Fighting') placeThirdPersonCamera(camera, this.tuning.camera, at, this.local.yaw, this.local.pitch, this.renderer.collider);
    else if (status === 'Fallen' || curr.status.status === 'Over') placeOrbitCamera(camera, this.tuning.camera, at, this.local.yaw, this.renderer.collider);
    else {
      // Out: watch the battle from above, the aim easing toward its middle, turned with the mouse.
      const aim = battleFocus(crowd, { x: 0, z: 0 }) ?? this.focus;
      const k = 1 - Math.exp(-FOLLOW_RATE * seconds);
      this.focus.x += (aim.x - this.focus.x) * k;
      this.focus.z += (aim.z - this.focus.z) * k;
      const y = battlefieldHeight(this.hf, this.focus.x, this.focus.z);
      placeOrbitCamera(camera, { ...this.tuning.camera, ...SPECTATOR }, { x: this.focus.x, y, z: this.focus.z }, this.local.yaw, this.renderer.collider);
    }
    if (status !== 'Out') [this.focus.x, this.focus.z] = [f.position.x, f.position.z];

    if (this.fades.length !== crowd.x.length) this.fades = new Float32Array(crowd.x.length);
    const fades = this.swap.impostorFades(crowd, this.fades);
    if (record && record.soldier >= 0) fades[record.soldier] = 0;
    this.crowdView.update(crowd, duel.tick, alpha, this.hf, camera, fades);
    this.renderer.render(before, duel, alpha);
    this.hud.update(curr, me);
  }

  /** The Battle is over or abandoned: take the impostors and the HUD away, and give the Renderer its defaults back. */
  dispose(): void {
    this.disposed = true;
    removeEventListener('keydown', this.onKey);
    if (this.crowdView) this.renderer.scene.remove(this.crowdView.root);
    this.renderer.setFades(null);
    this.renderer.setChosenBodies([]);
    this.hud.dispose();
  }
}
