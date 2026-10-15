/**
 * Tuning panels for the Duel sandbox: Weapons (pick one from the roster; every field,
 * the Off-hand Grip included), Hit Zone
 * multipliers, AI difficulty (Reaction Time, mistake rate per preset) and the
 * Gait (every `gait` value, bound from GAIT_FIELDS so new fields appear here) and
 * Block (the facing rule and the Block Impact's give and bounce).
 *
 * Fields edit `EditorSession` drafts; every change is validated with
 * `commitSection` (or `commitWeapon`) and, if valid, made live (`onApplied` re-runs the sandbox).
 * Save writes the validated section to `data/<section>.json`, a Weapon to `data/weapons/<file>`.
 */
import type { FolderApi, Pane } from 'tweakpane';
import { GAIT_FIELDS, HIT_ZONES, WEAPON_GRIPS, WEAPON_LOOKS } from '../tuning';
import { saveJsonFile } from './save';
import type { EditorSession, RepoFile, TuningSection } from './session';

const TITLES: Record<TuningSection, string> = { hitZones: 'Hit Zones', ai: 'AI difficulty', gait: 'Gait', block: 'Block' };

export function addTuningPanels(pane: Pane, session: EditorSession, onApplied: () => void): void {
  const ui = { status: 'Edit a value: the sandbox re-runs with it. Save writes data/<section>.json.', weapon: session.weaponNames()[0]! };
  const root = pane.addFolder({ title: 'Tuning Data', expanded: true });

  const commit = (title: string, make: () => unknown) => {
    try {
      make();
      ui.status = `${title}: applied (unsaved)`;
      onApplied();
    } catch (e) {
      ui.status = e instanceof Error ? e.message : String(e);
    }
    pane.refresh();
  };
  const apply = (section: TuningSection) => commit(TITLES[section], () => session.commitSection(section));
  const applyWeapon = () => commit(ui.weapon, () => session.commitWeapon(ui.weapon));

  const save = async (toFile: () => RepoFile) => {
    let file: RepoFile;
    try {
      file = toFile();
    } catch (e) {
      ui.status = `Not saved: ${e instanceof Error ? e.message : String(e)}`;
      pane.refresh();
      return;
    }
    try {
      const result = await saveJsonFile(file.fileName, file.text);
      ui.status =
        result === 'written'
          ? `Saved ${file.fileName} (${file.path})`
          : result === 'downloaded'
            ? `Downloaded ${file.fileName}: move it to ${file.path}`
            : 'Save cancelled';
    } catch (e) {
      ui.status = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    pane.refresh();
  };

  const folder = (section: TuningSection, build: (f: FolderApi) => void) => {
    const f = root.addFolder({ title: TITLES[section], expanded: false });
    build(f);
    f.addButton({ title: `Save ${section}.json` }).on('click', () => void save(() => session.sectionFile(section)));
  };

  // Weapons: pick one from the roster; its fields are rebuilt for the picked Weapon.
  const weapons = root.addFolder({ title: 'Weapons', expanded: false });
  weapons
    .addBinding(ui, 'weapon', { label: 'Weapon', options: Object.fromEntries(session.weaponNames().map((n) => [n, n])) })
    .on('change', () => buildWeapon());
  let weaponFields: FolderApi | undefined;
  const buildWeapon = () => {
    if (weaponFields) weapons.remove(weaponFields);
    const f = weapons.addFolder({ title: ui.weapon });
    weaponFields = f;
    const w = session.draftWeapon(ui.weapon);
    const on = (b: { on(ev: 'change', h: () => void): unknown }) => b.on('change', applyWeapon);
    on(f.addBinding(w, 'grip', { options: Object.fromEntries(WEAPON_GRIPS.map((g) => [g, g])) }));
    on(f.addBinding(w, 'look', { options: Object.fromEntries(WEAPON_LOOKS.map((l) => [l, l])) }));
    on(f.addBinding(w, 'length', { min: 0.3, max: 2.5, step: 0.01, label: 'length (m)' }));
    on(f.addBinding(w, 'speed', { min: 1, max: 60, step: 0.5, label: 'speed (m/s)' }));
    on(f.addBinding(w, 'damage', { min: 1, max: 200, step: 1 }));
    on(f.addBinding(w, 'gripLength', { min: 0.01, max: 1.5, step: 0.01, label: 'grip length (m)' }));
    on(f.addBinding(w, 'head', { min: 0.01, max: 2.5, step: 0.01, label: 'head (m)' }));
    on(f.addBinding(w, 'shaftDamage', { min: 0, max: 1, step: 0.05, label: 'shaft damage ×' }));
    const grip = f.addFolder({ title: 'Off-hand Grip (two-handed)' });
    on(grip.addBinding(w.offHandGrip, 'along', { min: 0, max: 1.5, step: 0.01, label: 'along (m)' }));
    on(grip.addBinding(w.offHandGrip, 'around', { min: -180, max: 180, step: 1, label: 'around (°)' }));
    on(grip.addBinding(w.offHandGrip, 'radial', { min: 0, max: 0.2, step: 0.005, label: 'radial (m)' }));
    const impact = f.addFolder({ title: 'Block Impact' });
    on(impact.addBinding(w.blockImpact, 'dealt', { min: 0.1, max: 3, step: 0.05, label: 'dealt ×' }));
    on(impact.addBinding(w.blockImpact, 'taken', { min: 0.1, max: 3, step: 0.05, label: 'taken ×' }));
    f.addButton({ title: 'Save to data/weapons/' }).on('click', () => void save(() => session.weaponFile(ui.weapon)));
  };
  buildWeapon();

  folder('hitZones', (f) => {
    const z = session.draftSection('hitZones');
    for (const zone of HIT_ZONES) {
      f.addBinding(z[zone], 'multiplier', { min: 0.05, max: 5, step: 0.05, label: `${zone} ×` }).on('change', () => apply('hitZones'));
    }
  });

  folder('ai', (f) => {
    const ai = session.draftSection('ai');
    for (const [name, d] of Object.entries(ai.difficulties)) {
      const g = f.addFolder({ title: name });
      g.addBinding(d, 'reactionTime', { min: 0, max: 1, step: 0.01, label: 'Reaction Time (s)' }).on('change', () => apply('ai'));
      g.addBinding(d, 'mistakeRate', { min: 0, max: 1, step: 0.01, label: 'mistake rate' }).on('change', () => apply('ai'));
      g.addBinding(d, 'feintRate', { min: 0, max: 1, step: 0.01, label: 'feint rate' }).on('change', () => apply('ai'));
    }
  });

  folder('gait', (f) => {
    const gait: Record<string, number> = session.draftSection('gait');
    for (const [key, { min, max, step }] of Object.entries(GAIT_FIELDS)) {
      const label = key.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
      f.addBinding(gait, key, { min, max, step, label }).on('change', () => apply('gait'));
    }
  });

  folder('block', (f) => {
    const b = session.draftSection('block');
    f.addBinding(b, 'facingHalfAngle', { min: 1, max: 180, step: 1, label: 'facing half-angle (°)' }).on('change', () => apply('block'));
    f.addBinding(b, 'bladeRadius', { min: 0.01, max: 0.2, step: 0.005, label: 'blade radius (m)' }).on('change', () => apply('block'));
    f.addBinding(b, 'impactDistance', { min: 0.01, max: 0.4, step: 0.01, label: 'impact give (m)' }).on('change', () => apply('block'));
    f.addBinding(b, 'impactTilt', { min: 0.5, max: 60, step: 0.5, label: 'impact tilt (°)' }).on('change', () => apply('block'));
    f.addBinding(b, 'impactLean', { min: 0.5, max: 30, step: 0.5, label: 'impact lean (°)' }).on('change', () => apply('block'));
    f.addBinding(b, 'impactFrequency', { min: 1, max: 15, step: 0.5, label: 'bounce (Hz)' }).on('change', () => apply('block'));
    f.addBinding(b, 'impactDuration', { min: 0.05, max: 1.5, step: 0.05, label: 'settle (s)' }).on('change', () => apply('block'));
  });

  root.addBinding(ui, 'status', { readonly: true, label: 'status', multiline: true, rows: 2 });
}
