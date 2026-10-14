/**
 * The sandbox's "Golden replay" folder (opt-in balance tooling, not a CI gate):
 * record the current run to a replay file, and load a replay file to re-run it
 * against the live Tuning Data, showing whether the outcome changed.
 * The logic lives in replay.ts; this is only the UI.
 */
import type { FolderApi, Pane } from 'tweakpane';
import type { TuningData } from '../tuning';
import { compareReplay, describeReport, parseReplay, replayFileName, serializeReplay, type Replay } from './replay';
import { saveJsonFile } from './save';

export interface ReplayPanelHooks {
  /** Record the run as it is now (every computed Tick). */
  record(): Replay;
  /** The live Tuning Data to replay against. */
  tuning(): TuningData;
}

export function addReplayPanel(pane: Pane, hooks: ReplayPanelHooks): FolderApi {
  const ui = { report: 'Record the current run, or load a replay file to compare it with the live Tuning Data.' };
  let loaded: { name: string; replay: Replay } | null = null;
  const folder = pane.addFolder({ title: 'Golden replay', expanded: false });

  const show = (text: string) => {
    ui.report = text;
    pane.refresh();
  };
  const compare = () => {
    if (!loaded) return show('No replay loaded.');
    show(`${loaded.name} (${loaded.replay.setup.kind}, ${loaded.replay.ticks} Ticks)\n${describeReport(compareReplay(loaded.replay, hooks.tuning()))}`);
  };

  folder.addButton({ title: 'Record replay to file' }).on('click', () => {
    const replay = hooks.record();
    void saveJsonFile(replayFileName(replay), serializeReplay(replay)).then(
      (result) => show(result === 'cancelled' ? 'Recording not saved.' : `Recorded ${replay.ticks} Ticks (${result}).`),
      (e: unknown) => show(`Could not save: ${(e as Error).message}`),
    );
  });

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.style.display = 'none';
  document.body.append(input);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    void file.text().then((text) => {
      try {
        loaded = { name: file.name, replay: parseReplay(text) };
        compare();
      } catch (e) {
        loaded = null;
        show(`${file.name}: ${(e as Error).message}`);
      }
    });
  });
  folder.addButton({ title: 'Load replay and compare…' }).on('click', () => input.click());
  folder.addButton({ title: 'Compare again (live Tuning Data)' }).on('click', compare);
  folder.addBinding(ui, 'report', { readonly: true, label: 'result', multiline: true, rows: 8 });
  return folder;
}
