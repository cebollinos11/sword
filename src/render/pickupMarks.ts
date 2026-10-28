import * as THREE from 'three';
import { JOINT_NAMES, type SkeletonPose, type Vec3 } from '../sim';
import { weaponByName, type TuningData } from '../tuning';
import { iconTexture, relicIcon } from '../play/icons';
import { FighterView } from './fighterView';
import { PEDESTAL_HEIGHT, type PickupView } from './pickupView';

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

/** One pickup's drawing: the parts it may be drawn with, shown as its view says. Pooled, so a pickup coming and going costs no allocation. */
interface Slot {
  readonly root: THREE.Group;
  readonly pedestal: THREE.Mesh;
  readonly base: THREE.Mesh;
  readonly sprite: THREE.Sprite;
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
 * a pedestal under each of a Treasure Hall's. Render only; the caller passes `pickupViews` and draws the shown ones, so a taken pickup is
 * simply gone. The turn follows the frames drawn, never the Simulation.
 *
 * `kit` is the seam for a Kit's pedestal (#62): a node it returns is cloned in place of the fallback cylinder. The marks dispose only
 * what they made (their pedestal, base and sprite materials); the Weapon meshes are the `FighterView`'s, and the icon textures are
 * `iconTexture`'s cache.
 */
export class PickupMarks {
  readonly root = new THREE.Group();
  private readonly pedestalGeometry = new THREE.CylinderGeometry(0.28, 0.32, PEDESTAL_HEIGHT, 12);
  private readonly baseGeometry = new THREE.CylinderGeometry(0.2, 0.22, BASE_HEIGHT, 12);
  private readonly pedestalMaterial = new THREE.MeshLambertMaterial({ color: PEDESTAL_COLOR, flatShading: true });
  private readonly baseMaterial = new THREE.MeshLambertMaterial({ color: BASE_COLOR, flatShading: true });
  private readonly spriteMaterials: THREE.SpriteMaterial[] = [];
  private readonly slots: Slot[] = [];
  private turn = 0;

  constructor(
    private readonly tuning: TuningData,
    private readonly kit: { readonly pedestal?: () => THREE.Object3D | undefined } = {},
  ) {}

  /** Draw each shown view, `seconds` of wall time after the last call. */
  update(views: readonly PickupView[], seconds: number): void {
    this.turn += seconds * TURN;
    const shown = views.filter((v) => v.shown);
    while (this.slots.length < shown.length) this.slots.push(this.makeSlot());
    this.slots.forEach((slot, i) => {
      const v = shown[i];
      slot.root.visible = v !== undefined;
      if (!v) return;
      slot.root.position.set(v.at.x, v.at.y, v.at.z);
      const floor = v.pedestal ? PEDESTAL_HEIGHT : 0;
      slot.pedestal.visible = v.pedestal;
      slot.base.visible = !v.pedestal && v.form.kind === 'relic';
      slot.sprite.visible = v.form.kind === 'relic';
      if (slot.weapon) slot.weapon.view.root.visible = v.form.kind === 'weapon';
      if (v.form.kind === 'relic') {
        const icon = this.tuning.relics.find((r) => r.name === (v.form as { relic: string }).relic)?.icon ?? '';
        slot.sprite.material.map = iconTexture(relicIcon(icon), ICON_PX);
        slot.sprite.position.y = floor + (v.pedestal ? 0 : BASE_HEIGHT) + ICON_FLOAT;
      } else {
        this.showWeapon(slot, v.form.weapon, floor);
      }
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
    root.add(pedestal, base, sprite);
    this.root.add(root);
    return { root, pedestal, base, sprite, weapon: null };
  }

  /** Lie the Weapon `name` `floor` m over the slot's ground, turning. */
  private showWeapon(slot: Slot, name: string, floor: number): void {
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
    for (const m of this.spriteMaterials) m.dispose();
  }
}
