/**
 * Tuning panels for the Duel sandbox: Weapon (length, speed, damage), Hit Zone
 * multipliers, AI difficulty (Reaction Time, mistake rate per preset) and the
 * Gait (every `gait` value, bound from GAIT_FIELDS so new fields appear here) and
 * Block (the facing rule and the Block Impact's give and bounce).
 *
 * Fields edit `EditorSession` drafts; every change is validated with
 * `commitSection` and, if valid, made live (`onApplied` re-runs the sandbox).
 * Save writes the validated section to `data/<section>.json`.
 */
import type { FolderApi, Pane } from 'tweakpane';
import { GAIT_FIELDS, HIT_ZONES } from '../tuning';
import { saveJsonFile } from './save';
import type { EditorSession, TuningSection } from './session';

const TITLES: Record<TuningSection, string> = { weapon: 'Weapon', hitZones: 'Hit Zones', ai: 'AI difficulty', gait: 'Gait', block: 'Block' };

export function addTuningPanels(pane: Pane, session: EditorSession, onApplied: () => void): void {
  const ui = { status: 'Edit a value: the sandbox re-runs with it. Save writes data/<section>.json.' };
  const root = pane.addFolder({ title: 'Tuning Data', expanded: true });

  const apply = (section: TuningSection) => {
    try {
      session.commitSection(section);
      ui.status = `${TITLES[section]}: applied (unsaved)`;
      onApplied();
    } catch (e) {
      ui.status = e instanceof Error ? e.message : String(e);
    }
    pane.refresh();
  };

  const save = async (section: TuningSection) => {
    let file: ReturnType<EditorSession['sectionFile']>;
    try {
      file = session.sectionFile(section);
    } catch (e) {
      ui.status = `Not saved: ${e instanceof Error ? e.message : String(e)}`;
      pane.refresh();
      return;
    }
    try {
      const result = await saveJsonFile(file.fileName, file.text);
      ui.status =
        result === 'written'
          ? `Saved ${file.fileName}`
          : result === 'downloaded'
            ? `Downloaded ${file.fileName}: move it into data/`
            : 'Save cancelled';
    } catch (e) {
      ui.status = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    pane.refresh();
  };

  const folder = (section: TuningSection, build: (f: FolderApi) => void) => {
    const f = root.addFolder({ title: TITLES[section], expanded: false });
    build(f);
    f.addButton({ title: `Save ${section}.json` }).on('click', () => void save(section));
  };

  folder('weapon', (f) => {
    const w = session.draftSection('weapon');
    f.addBinding(w, 'length', { min: 0.3, max: 2, step: 0.01, label: 'length (m)' }).on('change', () => apply('weapon'));
    f.addBinding(w, 'speed', { min: 1, max: 60, step: 0.5, label: 'speed (m/s)' }).on('change', () => apply('weapon'));
    f.addBinding(w, 'damage', { min: 1, max: 200, step: 1 }).on('change', () => apply('weapon'));
  });

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
