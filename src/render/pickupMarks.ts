import * as THREE from 'three';
import { JOINT_NAMES, type SkeletonPose, type Vec3 } from '../sim';
import { weaponByName, type Rarity, type TuningData } from '../tuning';
import { iconTexture, itemIconId, relicIcon } from '../play/icons';
import { RARITY_COLOUR } from './rarityColours';
import { FighterView } from './fighterView';
import { CRATE_HEIGHT, ITEM_HEIGHT, PEDESTAL_HEIGHT, type PickupView } from './pickupView';

const PEDESTAL_COLOR = 0x8d8a84;
const BASE_COLOR = 0x6a645c;
/** The Relic icon's sprite: its size (m) and texture resolution (px). */
const ICON_SIZE = 0.5;
const ICON_PX = 128;
/** A Relic's small base when it lies on the bare ground (m), and how high its icon floats over what it stands on. */
const BASE_HEIGHT = 0.05;
const ICON_FLOAT = 0.35;
/** A Weapon lies this high (m) over what it lies on, and turns this fast (rad/s). Its longest side is drawn at most WEAPON_SIZE. */
const WEAPON_LIFT = 0.1;
const WEAPON_SIZE = 0.6;
const TURN = 0.8;
/** The glowing pickups' ring on the ground: its inner and outer radius (m), its lift over the ground (m, against z-fighting), its opacity. */
const RING_INNER = 0.3;
const RING_OUTER = 0.45;
const RING_LIFT = 0.02;
const RING_OPACITY = 0.8;
/** The fixed pool of lights the nearest glowing pickups share (never more or fewer in the scene: no shader recompiles), and each one's intensity and reach (m). */
export const GLOW_LIGHTS = 4;
const GLOW_INTENSITY = 6;
const GLOW_DISTANCE = 4;

/** One pickup's drawing: the parts it may be drawn with, shown as its view says. Pooled, so a pickup coming and going costs no allocation. */
interface Slot {
  readonly root: THREE.Group;
  readonly pedestal: THREE.Mesh;
  readonly base: THREE.Mesh;
  readonly sprite: THREE.Sprite;
  /** The flat ring under a glowing pickup, in its own material (its colour is the Rarity's). */
  readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  /** The Weapon's model, made on first need and kept (null: none yet) with the Weapon it shows. */
  weapon: { readonly view: FighterView; name: string } | null;
}

/** A Weapon lying along x, its hilt at one end and its edge up, as the Renderer's `FighterView` draws it. The joints are unused (the body is hidden). */
function lyingPose(length: number): SkeletonPose {
  const origin: Vec3 = { x: 0, y: 0, z: 0 };
  const joints = Object.fromEntries(JOINT_NAMES.map((j) => [j, origin])) as SkeletonPose['joints'];
  return { joints, blade: { hilt: { x: -length / 2, y: 0, z: 0 }, tip: { x: length / 2, y: 0, z: 0 }, edge: { x: 0, y: 1, z: 0 } } };
}

/**
 * The pickups lying in a Run's Hall (docs/plans/dungeon.md, Stage 3): a Weapon as its model, small and turning slowly (the Renderer's
 * own Weapon meshes, through a body-less `FighterView`: no new model is loaded), a Relic as its icon on a sprite over a small base, and
 * a pedestal under each of a Treasure Hall's. A Rare or Legendary pickup also glows: a ring of its Rarity colour on the ground, a lying Weapon tinted, and the nearest `GLOW_LIGHTS` such pickups lit by a pooled `PointLight` each. Render only; the caller passes `pickupViews` and draws the shown ones, so a taken pickup is
 * simply gone. The turn follows the frames drawn, never the Simulation.
 *
 * `kit` is the seam for a Kit's pedestal (#62): a node it returns is cloned in place of the fallback cylinder. The marks dispose only
 * what they made (their pedestal, base and sprite materials, and their pooled Weapon `FighterView`s); the icon textures are
 * `iconTexture`'s cache.
 */
export class PickupMarks {
  readonly root = new THREE.Group();
  private readonly pedestalGeometry = new THREE.CylinderGeometry(0.28, 0.32, PEDESTAL_HEIGHT, 12);
  private readonly baseGeometry = new THREE.CylinderGeometry(0.2, 0.22, BASE_HEIGHT, 12);
  private readonly pedestalMaterial = new THREE.MeshLambertMaterial({ color: PEDESTAL_COLOR, flatShading: true });
  private readonly baseMaterial = new THREE.MeshLambertMaterial({ color: BASE_COLOR, flatShading: true });
  private readonly spriteMaterials: THREE.SpriteMaterial[] = [];
  private readonly ringGeometry = new THREE.RingGeometry(RING_INNER, RING_OUTER, 32).rotateX(-Math.PI / 2);
  private readonly lights = Array.from({ length: GLOW_LIGHTS }, () => new THREE.PointLight(0xffffff, 0, GLOW_DISTANCE));
  private readonly slots: Slot[] = [];
  private turn = 0;

  constructor(
    private readonly tuning: TuningData,
    private readonly kit: { readonly pedestal?: () => THREE.Object3D | undefined } = {},
  ) {
    this.root.add(...this.lights);
  }

  /** Draw each shown view, `seconds` of wall time after the last call. */
  update(views: readonly PickupView[], seconds: number): void {
    this.turn += seconds * TURN;
    const shown = views.filter((v) => v.shown);
    while (this.slots.length < shown.length) this.slots.push(this.makeSlot());
    this.slots.forEach((slot, i) => {
      const v = shown[i];
      slot.root.visible = v !== undefined;
      slot.ring.visible = false;
      if (!v) return;
      const glow = v.glow === null ? null : RARITY_COLOUR[v.glow];
      if (glow !== null) {
        slot.ring.visible = true;
        slot.ring.material.color.setHex(glow);
      }
      slot.root.position.set(v.at.x, v.at.y, v.at.z);
      // A Delver Floor's pedestal is a crate prop of the map: the item stands on its top and no cylinder is drawn.
      const floor = v.crate ? (v.crateTop ?? CRATE_HEIGHT) : v.pedestal ? PEDESTAL_HEIGHT : 0;
      slot.pedestal.visible = v.pedestal && !v.crate;
      slot.base.visible = !v.pedestal && v.form.kind === 'relic';
      slot.sprite.visible = v.form.kind === 'relic';
      if (slot.weapon) slot.weapon.view.root.visible = v.form.kind === 'weapon';
      if (v.form.kind === 'relic') {
        const icon = itemIconId(this.tuning, v.form.relic);
        slot.sprite.material.map = iconTexture(relicIcon(icon), ICON_PX);
        slot.sprite.position.y = floor + (v.pedestal ? 0 : BASE_HEIGHT) + ICON_FLOAT;
      } else {
        this.showWeapon(slot, v.form.weapon, floor, v.rarity);
      }
      slot.ring.position.y = floor + RING_LIFT;
    });
    this.lightUp(shown);
  }

  /** Give the pool's lights to the nearest glowing pickups, in their Rarity colours; the rest go dark. */
  private lightUp(shown: readonly PickupView[]): void {
    const glowing = shown.filter((v) => v.glow !== null).sort((a, b) => a.distance - b.distance);
    this.lights.forEach((light, i) => {
      const v = glowing[i];
      const colour = v?.glow ? RARITY_COLOUR[v.glow] : null;
      light.intensity = colour === null ? 0 : GLOW_INTENSITY;
      if (!v || colour === null) return;
      light.color.setHex(colour);
      light.position.set(v.at.x, v.at.y + ITEM_HEIGHT, v.at.z);
    });
  }

  private makeSlot(): Slot {
    const root = new THREE.Group();
    const pedestalNode = this.kit.pedestal?.();
    const pedestal = pedestalNode ? (pedestalNode.clone() as unknown as THREE.Mesh) : new THREE.Mesh(this.pedestalGeometry, this.pedestalMaterial);
    pedestal.position.y = PEDESTAL_HEIGHT / 2;
    const base = new THREE.Mesh(this.baseGeometry, this.baseMaterial);
    base.position.y = BASE_HEIGHT / 2;
    const material = new THREE.SpriteMaterial({ transparent: true });
    this.spriteMaterials.push(material);
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(ICON_SIZE);
    const ring = new THREE.Mesh(this.ringGeometry, new THREE.MeshBasicMaterial({ transparent: true, opacity: RING_OPACITY, blending: THREE.AdditiveBlending, depthWrite: false }));
    root.add(pedestal, base, sprite, ring);
    this.root.add(root);
    return { root, pedestal, base, sprite, ring, weapon: null };
  }

  /** Lie the Weapon `name` `floor` m over the slot's ground, turning. */
  private showWeapon(slot: Slot, name: string, floor: number, rarity: Rarity): void {
    if (!slot.weapon || slot.weapon.name !== name) {
      const weapon = weaponByName(this.tuning, name);
      const view = slot.weapon?.view ?? new FighterView(0xffffff, this.tuning, 'skeleton');
      if (!slot.weapon) {
        view.bodyVisible = false;
        slot.root.add(view.root);
      }
      view.update(lyingPose(weapon.length), weapon);
      view.root.scale.setScalar(Math.min(0.5, WEAPON_SIZE / (weapon.length + weapon.gripLength)));
      slot.weapon = { view, name };
    }
    const { view } = slot.weapon;
    view.setRarity(rarity);
    view.root.visible = true;
    view.root.position.y = floor + WEAPON_LIFT;
    view.root.rotation.y = this.turn;
  }

  /** Free what the marks made. */
  dispose(): void {
    this.pedestalGeometry.dispose();
    this.baseGeometry.dispose();
    this.pedestalMaterial.dispose();
    this.baseMaterial.dispose();
    this.ringGeometry.dispose();
    for (const slot of this.slots) slot.ring.material.dispose();
    for (const light of this.lights) light.dispose();
    for (const m of this.spriteMaterials) m.dispose();
    for (const slot of this.slots) slot.weapon?.view.dispose();
  }
}
