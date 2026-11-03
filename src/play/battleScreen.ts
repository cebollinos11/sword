/**
 * Playing a Battle in the game (docs/plans/big-battle.md, Stage 5): what the game loop draws and announces while a Battle
 * from the Skirmish Lobby is on. The loop still owns the clock, the Local Controller and the menus; this owns the Crowd's
 * impostors (`CrowdView`, from an atlas baked when the Battle starts), the Promotion swaps (`BubbleSwap`), the camera, the
 * Battle's HUD and minimap, the banners and the results screen.
 *
 * The camera follows the Player's slot: their own Fighter, then each Soldier they take over (it turns to face the way that
 * Soldier faces). While they lie fallen it orbits where they fell; once they are out it watches the battle from above.
 *
 * Online (Stage 7) the local Player's slot is whatever the session says (`me`, from the Lineup), not 0, and every Player's
 * slot is a Player's: it is never faded like a Promotion's slot, shows that Player's own Body (until they take over a Soldier,
 * then the generic soldier's; their fallen Fighter lies on in the Body they chose), and carries a name tag (`PlayerTags`).
 * Nothing here is part of the Simulation: each peer draws its own view of the same state.
 */
import { battlefieldHeight, battlefieldOf, type Heightfield, type MatchState, type SimState } from '../sim';
import { PlayerTags } from './playerTags';
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

/**
 * The Body each Fighter slot wears. `chosen[k]` is the Body Player slot k picked in the Lobby (every peer has the Lobby's, so
 * Bodies need no protocol of their own): a Player's slot wears it while the Fighter is theirs, and the generic soldier's once they
 * have taken over a Soldier; their fallen Fighter lies on in the slot `record.corpse` in the Body they chose. Every other slot
 * is a Soldier promoted to a Fighter: the generic soldier's. `player` is slot `me`'s (the Renderer's local Player).
 */
export function battleBodies(state: SimState, me: number, chosen: readonly (string | undefined)[], soldierBody: string): { player: string; others: (string | undefined)[] } {
  const players = state.crowd?.players ?? [];
  const bodies = state.fighters.map((_, k) => {
    const own = chosen[k] ?? soldierBody;
    const record = players[k];
    if (record) return record.soldier >= 0 ? soldierBody : own;
    const owner = players.findIndex((r) => r.corpse === k);
    return owner >= 0 ? (chosen[owner] ?? soldierBody) : soldierBody;
  });
  return { player: bodies[me] ?? soldierBody, others: bodies.map((b, k) => (k === me ? undefined : b)) };
}

export class BattleScreen {
  /** The impostors are baked and in the scene: the Battle may start. */
  ready = false;
  private crowdView: CrowdView | null = null;
  private readonly swap = new BubbleSwap();
  private readonly hud: BattleHud;
  /** The Battlefield's heights: known once the first state is (online, the Match starts when the peers have met). */
  private hf: Heightfield | null = null;
  private readonly tags: PlayerTags;
  private fades = new Float32Array(0);
  private readonly focus = { x: 0, z: 0 };
  private disposed = false;
  /** What has been announced: the Rout, the fall, the takeovers so far, being out, the result. */
  private routSeen = false;
  private fellSeen = false;
  private started = false;
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
    /** The Body each Player slot chose, by Fighter slot (`battleBodies`'s `chosen`). */
    private readonly chosen: readonly (string | undefined)[],
    /** Each Player's name by Fighter slot (for the tags). */
    names: readonly (string | undefined)[],
  ) {
    this.hud = new BattleHud(container, tuning.battle);
    this.tags = new PlayerTags(container, tuning.battle.soldier.colours, names);
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
    if (!crowd || !duel.fighters[me]) return null;
    // Turned the way its Fighter faces to begin with: a Team 1 Player starts looking along -z.
    if (!this.started) {
      this.started = true;
      this.local.setYaw(duel.fighters[me]!.facing);
    }
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
    if (!crowd || !this.crowdView || !duel.fighters[me]) return;
    const hf = (this.hf ??= battlefieldOf(this.tuning.battle, curr.arena)!.heights);
    // A takeover (anyone's) moves Fighters between slots: draw that Tick as it stands, not from where the slots were.
    const tookOver = crowd.players.some((r, k) => r.taken !== (prev.duel.crowd?.players[k]?.taken ?? r.taken));
    const before = tookOver ? duel : prev.duel;
    // A Soldier a Player took over is drawn in that Player's slot: no crossfade, no dust, no impostor.
    const taken = new Set(crowd.players.flatMap((r) => (r.soldier >= 0 ? [r.soldier] : [])));
    for (const soldier of taken) this.swap.forget(soldier);
    for (const s of this.swap.update(duel, seconds)) {
      if (taken.has(s.soldier)) continue;
      this.renderer.impacts.dust({ kind: 'Swap', point: { x: s.at.x, y: battlefieldHeight(hf, s.at.x, s.at.z), z: s.at.z }, strength: 1 });
    }
    const bodies = battleBodies(duel, me, this.chosen, this.tuning.battle.soldier.body);
    this.renderer.setPlayer(me, bodies.player as Body);
    this.renderer.setChosenBodies(bodies.others);
    // Every Player's slot, and where a Player's fallen Fighter lies, is drawn whole: only a Promotion's slot fades.
    const whole = new Set([...crowd.players.keys(), ...crowd.players.map((r) => r.corpse)]);
    this.renderer.setFades((k) => (whole.has(k) ? 1 : this.swap.modelFade(k)));

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
      const y = battlefieldHeight(hf, this.focus.x, this.focus.z);
      placeOrbitCamera(camera, { ...this.tuning.camera, ...SPECTATOR }, { x: this.focus.x, y, z: this.focus.z }, this.local.yaw, this.renderer.collider);
    }
    if (status !== 'Out') [this.focus.x, this.focus.z] = [f.position.x, f.position.z];

    if (this.fades.length !== crowd.x.length) this.fades = new Float32Array(crowd.x.length);
    const fades = this.swap.impostorFades(crowd, this.fades);
    for (const soldier of taken) fades[soldier] = 0;
    this.crowdView.update(crowd, duel.tick, alpha, hf, camera, fades);
    this.renderer.render(before, duel, alpha);
    this.hud.update(curr, me);
    this.tags.update(duel, before, me, alpha, (p) => this.renderer.toScreen(p));
  }

  /** The Battle is over or abandoned: take the impostors and the HUD away, and give the Renderer its defaults back. */
  dispose(): void {
    this.disposed = true;
    removeEventListener('keydown', this.onKey);
    if (this.crowdView) this.renderer.scene.remove(this.crowdView.root);
    this.renderer.setFades(null);
    this.renderer.setChosenBodies([]);
    this.tags.dispose();
    this.hud.dispose();
  }
}
