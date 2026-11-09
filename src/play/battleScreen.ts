/**
 * Playing a Battle in the game (docs/plans/big-battle.md, Stage 5): what the game loop draws and announces while a Battle
 * from the Skirmish Lobby is on. The loop still owns the clock, the Local Controller and the menus; this owns the Crowd's
 * impostors (`CrowdView`, from an atlas baked when the Battle starts), the Promotion swaps (`BubbleSwap`), the camera, the
 * Battle's HUD and minimap, the banners and the results screen.
 *
 * The camera follows the Player's slot: their own Fighter, then each Soldier they take over (it turns to face the way that
 * Soldier faces). While they lie fallen it first orbits where they fell (turned with the mouse), the screen dimmed to grey and
 * a countdown up; then (`takeover.pickSeconds` after the fall) the ally Soldier they will take over is marked (`TakeoverMark`)
 * and the camera flies by, up over the field to behind that Soldier (`flybyCamera`), with a rush of air (the `Takeover` sound),
 * the grey clearing, landing as the takeover happens, and the HP bar fills. Once they are out it watches the battle from above.
 *
 * Online (Stage 7) the local Player's slot is whatever the session says (`me`, from the Lineup), not 0, and every Player's
 * slot is a Player's: it is never faded like a Promotion's slot, shows that Player's own Body (until they take over a Soldier,
 * then the generic soldier's; their fallen Fighter lies on in the Body they chose), and carries a name tag (`PlayerTags`).
 * Nothing here is part of the Simulation: each peer draws its own view of the same state.
 */
import * as THREE from 'three';
import { battlefieldHeight, battlefieldOf, groundHeight, soldierBody, takeoverTarget, type Heightfield, type MatchState, type SimState, type Vec3 } from '../sim';
import type { SoundCue } from '../audio';
import { PlayerTags } from './playerTags';
import type { TuningData } from '../tuning';
import type { LocalController } from '../controllers';
import { blobTexture } from '../render/blobShadow';
import { BubbleSwap } from '../render/bubbleSwap';
import { CrowdView } from '../render/crowdView';
import { ObjectiveMarks } from '../render/objectiveMarks';
import { bakeImpostorAtlases, type ImpostorAtlases } from '../render/impostorAtlas';
import type { Body } from '../render/bodyModel';
import type { Renderer } from '../render/renderer';
import { cameraForHeight, placeOrbitCamera, placeThirdPersonCamera } from '../render/thirdPersonCamera';
import { soldierAt } from '../render/impostor';
import { deathTint, flightCamera, flybyCamera, FLIGHT_SECONDS, TakeoverMark } from '../render/takeoverView';
import { LoadingBar, nextPaint } from './loadingBar';
import { battleFocus } from './battleSpectator';
import { BattleHud, battleResult, battleResultLine, playerRecord, playerStatus, takeoverCountdown, troopCards, troopKey, ARMY_NAMES, type BattleResult } from './battleHud';

/** The spectator camera, once the Player is out: this far back and up from the battle's middle. */
const SPECTATOR = { orbitDistance: 34, orbitHeight: 22, lookHeight: 0 };
/** How fast (per second) the spectator camera's aim eases toward the battle's middle. */
const FOLLOW_RATE = 1.5;
/** How fast (per second) the screen greys once the Player is down. */
const GREY_RATE = 2.5;
/** Where the flyby looks at the Soldier: this far (m) above its feet. */
const FOCUS_HEIGHT = 1.2;

/**
 * The Body each Fighter slot wears. `chosen[k]` is the Body Player slot k picked in the Lobby (every peer has the Lobby's, so
 * Bodies need no protocol of their own): a Player's slot wears it while the Fighter is theirs, and the Soldier's once they
 * have taken over a Soldier; their fallen Fighter lies on in the slot `record.corpse` in the Body they chose. Every other slot
 * is a Soldier promoted to a Fighter: that Soldier's. A Soldier's Body is `bodyOf(soldier)` (its Troop's look, `soldierBody`),
 * or the generic soldier's `soldierBody` without it. `player` is slot `me`'s (the Renderer's local Player).
 */
export function battleBodies(
  state: SimState,
  me: number,
  chosen: readonly (string | undefined)[],
  soldierBody: string,
  bodyOf: (soldier: number) => string = () => soldierBody,
): { player: string; others: (string | undefined)[] } {
  const players = state.crowd?.players ?? [];
  const bodies = state.fighters.map((f, k) => {
    const own = chosen[k] ?? soldierBody;
    const record = players[k];
    if (record) return record.soldier >= 0 ? bodyOf(record.soldier) : own;
    const owner = players.findIndex((r) => r.corpse === k);
    if (owner >= 0) return chosen[owner] ?? soldierBody;
    return f.soldier ? bodyOf(f.soldier.index) : soldierBody;
  });
  return { player: bodies[me] ?? soldierBody, others: bodies.map((b, k) => (k === me ? undefined : b)) };
}

export class BattleScreen {
  /** The impostors are baked and in the scene: the Battle may start. */
  ready = false;
  private crowdView: CrowdView | null = null;
  /** The soldiers' baked impostors (GPU textures), freed with the screen. */
  private atlas: ImpostorAtlases | null = null;
  private readonly swap = new BubbleSwap();
  private readonly hud: BattleHud;
  /** The Battlefield's heights: known once the first state is (online, the Match starts when the peers have met). */
  private hf: Heightfield | null = null;
  private readonly tags: PlayerTags;
  /** The Objectives drawn on the field: made with the Battlefield, once the first state is known. */
  private marks: ObjectiveMarks | null = null;
  private fades = new Float32Array(0);
  private readonly focus = { x: 0, z: 0 };
  private disposed = false;
  private loading: LoadingBar | null = null;
  /** What has been announced: the Rout, the fall, the takeovers so far, being out, the result. */
  private routSeen = false;
  private fellSeen = false;
  private started = false;
  private takenSeen = 0;
  private outSeen = false;
  private result: BattleResult | null = null;
  /** The marker over the Soldier a fallen Player will take over. */
  private readonly mark = new TakeoverMark();
  /** The camera's flight to a taken-over Soldier: where it set off from and how long it has flown; null when not flying. */
  private flight: { from: THREE.Vector3; fromQuat: THREE.Quaternion; elapsed: number } | null = null;
  /** The takeovers the camera has flown to. */
  private flownTo = 0;
  /** The flyby to the Soldier a fallen Player will take over: where the camera set off from; null when not flying by. */
  private flyby: { from: THREE.Vector3; fromQuat: THREE.Quaternion } | null = null;
  /** How far the screen is greyed (0 to 1), and the wall time drawn (s), which beats the marker's pulse. */
  private down = 0;
  private time = 0;
  private tint = '';
  /** The latest Tick presented and the Player's slot in it: what a Troop key chooses against. */
  private shown: { duel: SimState; me: number } | null = null;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === 'KeyN') this.hud.toggleMap();
    const troop = troopKey(e.code, this.tuning.battle.troops.length);
    // A number key while the Player lies fallen and may still choose: the Troop it comes back as.
    if (troop !== undefined && this.shown && troopCards(this.shown.duel, this.shown.me, this.tuning.battle)) this.local.askTroop(troop);
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
    /** The loading bar already up while the Battle was built (else one is made here). */
    existing?: LoadingBar,
    /** Plays a sound from the view (the takeover's rush of air). */
    private readonly onCue: (cue: SoundCue) => void = () => {},
  ) {
    renderer.scene.add(this.mark.root);
    this.hud = new BattleHud(container, tuning.battle);
    this.hud.onTroop = (troop) => this.local.askTroop(troop);
    this.tags = new PlayerTags(container, tuning.battle.soldier.colours, names);
    addEventListener('keydown', this.onKey);
    const loading = existing ?? new LoadingBar(container, 'Mustering the armies');
    this.loading = loading;
    const progress = async (done: number, total: number) => {
      if (this.disposed) return;
      loading.set(total === 0 ? 1 : done / total, done < total ? `Drawing soldier ${done + 1} of ${total}…` : 'Ready');
      await nextPaint();
    };
    void bakeImpostorAtlases(renderer.gl, tuning, tuning.battle, progress).then((atlas) => {
      if (this.disposed) {
        atlas.dispose();
        return;
      }
      loading.finish();
      this.atlas = atlas;
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
    this.shown = { duel, me };
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
      this.hud.refill();
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
  draw(prev: MatchState, curr: MatchState, me: number, alpha: number, seconds: number, ping: number | null = null): void {
    const duel = curr.duel;
    const crowd = duel.crowd;
    if (!crowd || !this.crowdView || !duel.fighters[me]) return;
    if (!this.marks) {
      const field = battlefieldOf(this.tuning.battle, curr.arena)!;
      this.hf = field.heights;
      this.marks = new ObjectiveMarks(field.objectives, field.heights, this.tuning.battle.soldier.colours);
      this.renderer.scene.add(this.marks.root);
    }
    this.marks.update(crowd.objectives);
    const hf = this.hf!;
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
    const bodies = battleBodies(duel, me, this.chosen, this.tuning.battle.soldier.body, (s) => soldierBody(this.tuning.battle, crowd, s));
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
    this.time += seconds;
    // Fallen: a countdown; once the Soldier the Player will take over is chosen, it is marked where it stands.
    const countdown = takeoverCountdown(duel, me, this.tuning.battle, alpha);
    const flying = countdown?.phase === 'Fly';
    const target = flying ? this.takeoverAt(duel, before, me, alpha, hf) : null;
    if (countdown) this.hud.announce(flying ? 'Joining a soldier near your spawn…' : `You fell · back in the fight in ${Math.ceil(countdown.seconds)}`, 0.3);
    if (target && countdown) this.mark.show(target, this.tuning.battle.soldier.colours[f.team] ?? 0xffffff, countdown.progress, this.time);
    else this.mark.hide();
    // The flyby sets off from wherever the camera is when the Soldier is chosen.
    if (target && countdown && !this.flyby) {
      this.flyby = { from: camera.position.clone(), fromQuat: camera.quaternion.clone() };
      this.onCue({ sound: 'Takeover', seconds: (1 - countdown.progress) * (this.tuning.battle.takeover.seconds - this.tuning.battle.takeover.pickSeconds) });
    }
    if (!flying) this.flyby = null;
    // A new takeover: the camera flies from where it is now to behind the Soldier.
    const record = playerRecord(duel, me);
    if (record && record.taken > this.flownTo) {
      this.flownTo = record.taken;
      this.flight = { from: camera.position.clone(), fromQuat: camera.quaternion.clone(), elapsed: 0 };
    }
    if (status === 'Fighting') {
      placeThirdPersonCamera(camera, cameraForHeight(this.tuning.camera, f.size?.height ?? 1), at, this.local.yaw, this.local.pitch, this.renderer.collider);
      if (this.flight) {
        const to = camera.position.clone();
        const toQuat = camera.quaternion.clone();
        if (flightCamera(this.flight.from, this.flight.fromQuat, to, toQuat, this.flight.elapsed, camera)) this.flight = null;
        else this.flight.elapsed += seconds;
      }
    } else if (status === 'Fallen' && target && countdown && this.flyby && curr.status.status !== 'Over') {
      // The flyby: from where the camera was, up over the field, to behind the Soldier's shoulder as the Player will see it.
      placeThirdPersonCamera(camera, cameraForHeight(this.tuning.camera, f.size?.height ?? 1), target, target.yaw, 0, this.renderer.collider);
      const to = camera.position.clone();
      const toQuat = camera.quaternion.clone();
      flybyCamera(this.flyby.from, this.flyby.fromQuat, to, toQuat, new THREE.Vector3(target.x, target.y + FOCUS_HEIGHT, target.z), countdown.progress, camera);
    } else if (status === 'Fallen' || curr.status.status === 'Over') placeOrbitCamera(camera, this.tuning.camera, at, this.local.yaw, this.renderer.collider);
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
    // Grey while down; clearing as the camera flies to the Soldier.
    if (flying && countdown) this.down = Math.min(this.down, 1 - countdown.progress);
    else if (status === 'Fallen') this.down = Math.min(1, this.down + GREY_RATE * seconds);
    else this.down = Math.max(0, this.down - seconds / FLIGHT_SECONDS);
    const tint = deathTint(this.down);
    if (tint !== this.tint) this.renderer.canvas.style.filter = this.tint = tint;

    if (this.fades.length !== crowd.x.length) this.fades = new Float32Array(crowd.x.length);
    const fades = this.swap.impostorFades(crowd, this.fades);
    for (const soldier of taken) fades[soldier] = 0;
    this.crowdView.update(crowd, duel.tick, alpha, hf, camera, fades);
    this.renderer.render(before, duel, alpha);
    this.hud.update(curr, me, ping);
    this.tags.update(duel, before, me, alpha, (p) => this.renderer.toScreen(p));
  }

  /** Where the feet of the Soldier fallen Player `me` will take over are drawn (`takeoverTarget`), and the way it faces; null if there is none. */
  private takeoverAt(duel: SimState, before: SimState, me: number, alpha: number, hf: Heightfield): (Vec3 & { yaw: number }) | null {
    const crowd = duel.crowd!;
    const s = takeoverTarget(duel, me, this.tuning);
    if (s < 0) return null;
    const k = crowd.slot[s]!;
    const f = k >= 0 ? duel.fighters[k] : undefined;
    if (f) {
      // A promoted ally: where its Fighter stands, between this Tick and the last.
      const g = before.fighters[k]?.soldier?.index === s ? before.fighters[k]! : f;
      const l = (a: number, b: number) => a + (b - a) * alpha;
      return { x: l(g.position.x, f.position.x), y: l(g.y, f.y), z: l(g.position.z, f.position.z), yaw: f.facing };
    }
    const [x, z] = soldierAt(crowd, s, duel.tick, duel.tick + alpha, this.tuning.battle.crowd.stagger, this.tuning.battle.armySize, [0, 0]);
    return { x, y: groundHeight(hf, crowd.surface[s]!, x, z), z, yaw: crowd.heading[s]! };
  }

  /** The Battle is over or abandoned: take the impostors and the HUD away, and give the Renderer its defaults back. */
  dispose(): void {
    this.disposed = true;
    this.renderer.scene.remove(this.mark.root);
    this.mark.dispose();
    this.renderer.canvas.style.filter = '';
    this.loading?.dispose();
    removeEventListener('keydown', this.onKey);
    if (this.crowdView) {
      this.renderer.scene.remove(this.crowdView.root);
      this.crowdView.dispose();
    }
    this.atlas?.dispose();
    this.atlas = null;
    this.marks?.dispose();
    this.renderer.setFades(null);
    this.renderer.setChosenBodies([]);
    this.tags.dispose();
    this.hud.dispose();
  }
}
