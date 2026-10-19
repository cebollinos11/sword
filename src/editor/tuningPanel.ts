/**
 * Tuning panels for the Duel sandbox: Weapons (pick one from the roster; every field,
 * the Off-hand Grip included), Hit Zone
 * multipliers, AI difficulty (Reaction Time, mistake rate and the rest of each preset's repertoire) and the
 * Gait (every `gait` value, bound from GAIT_FIELDS so new fields appear here) and
 * Block (the facing rule and the Block Impact's give and bounce) and Fall (gravity, the Jump, Landing damage, steps) and Camera (where the
 * third-person and orbit cameras sit; seen in a Player vs AI run, applied without a re-run).
 *
 * Fields edit `EditorSession` drafts; every change is validated with
 * `commitSection` (or `commitWeapon`) and, if valid, made live (`onApplied` re-runs the sandbox).
 * Save writes the validated section to `data/<section>.json`, a Weapon to `data/weapons/<file>`.
 */
import type { FolderApi, Pane } from 'tweakpane';
import { AI_DIFFICULTY_EXTRAS, GAIT_FIELDS, HIT_ZONES, WEAPON_GRIPS, WEAPON_LOOKS } from '../tuning';
import { saveJsonFile } from './save';
import type { EditorSession, RepoFile, TuningSection } from './session';

const TITLES: Record<TuningSection, string> = { hitZones: 'Hit Zones', ai: 'AI difficulty', gait: 'Gait', block: 'Block', fall: 'Fall', camera: 'Camera' };

export function addTuningPanels(pane: Pane, session: EditorSession, onApplied: () => void): void {
  const ui = { status: 'Edit a value: the sandbox re-runs with it. Save writes data/<section>.json.', weapon: session.weaponNames()[0]! };
  const root = pane.addFolder({ title: 'Tuning Data', expanded: true });

  const commit = (title: string, make: () => unknown, rerun = true) => {
    try {
      make();
      ui.status = `${title}: applied (unsaved)`;
      if (rerun) onApplied();
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
      // The optional parts of its repertoire this preset sets (a missing one keeps its default).
      for (const key of AI_DIFFICULTY_EXTRAS) {
        if (d[key] === undefined) continue;
        const label = key.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
        g.addBinding(d, key, { min: 0, max: key === 'aggression' || key === 'kickRate' || key === 'throwRate' || key === 'jumpAttackRate' ? 0.2 : 1, step: 0.001, label }).on('change', () => apply('ai'));
      }
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
    f.addBinding(b, 'correctionWindow', { min: 0.02, max: 0.5, step: 0.01, label: 'direction correction (s)' }).on('change', () => apply('block'));
  });

  folder('fall', (f) => {
    const fl = session.draftSection('fall');
    const on = (b: { on(ev: 'change', h: () => void): unknown }) => b.on('change', () => apply('fall'));
    on(f.addBinding(fl, 'gravity', { min: 1, max: 40, step: 0.5, label: 'gravity (m/s²)' }));
    on(f.addBinding(fl, 'jumpSpeed', { min: 0, max: 12, step: 0.1, label: 'jump speed (m/s)' }));
    on(f.addBinding(fl, 'airControl', { min: 0, max: 20, step: 0.5, label: 'air control (m/s²)' }));
    on(f.addBinding(fl, 'fallDelay', { min: 0, max: 1, step: 0.01, label: 'fall delay (s)' }));
    on(f.addBinding(fl, 'safeHeight', { min: 0, max: 10, step: 0.1, label: 'safe height (m)' }));
    on(f.addBinding(fl, 'damagePerMetre', { min: 0, max: 100, step: 1, label: 'damage per metre' }));
    on(f.addBinding(fl, 'stepUp', { min: 0, max: 1, step: 0.01, label: 'step up (m)' }));
    on(f.addBinding(fl, 'snapDown', { min: 0, max: 1, step: 0.01, label: 'snap down (m)' }));
  });

  // The camera is read live every frame, so an edit needs no re-run (which would restart a live run).
  folder('camera', (f) => {
    const c = session.draftSection('camera');
    const on = (b: { on(ev: 'change', h: () => void): unknown }) => b.on('change', () => commit(TITLES.camera, () => session.commitSection('camera'), false));
    const third = f.addFolder({ title: 'Third-person (over the shoulder)' });
    on(third.addBinding(c, 'back', { min: -2, max: 12, step: 0.05, label: 'back (m)' }));
    on(third.addBinding(c, 'shoulder', { min: -3, max: 3, step: 0.05, label: 'shoulder (m, + right)' }));
    on(third.addBinding(c, 'eyeHeight', { min: 0.2, max: 10, step: 0.05, label: 'height (m)' }));
    on(third.addBinding(c, 'ahead', { min: -2, max: 10, step: 0.05, label: 'look ahead (m)' }));
    on(third.addBinding(c, 'lookHeight', { min: 0, max: 5, step: 0.05, label: 'look height (m)' }));
    const orbit = f.addFolder({ title: 'Orbit (after a fall)' });
    on(orbit.addBinding(c, 'orbitDistance', { min: 1, max: 20, step: 0.1, label: 'distance (m)' }));
    on(orbit.addBinding(c, 'orbitHeight', { min: 0.5, max: 15, step: 0.1, label: 'height (m)' }));
  });

  root.addBinding(ui, 'status', { readonly: true, label: 'status', multiline: true, rows: 2 });
}
