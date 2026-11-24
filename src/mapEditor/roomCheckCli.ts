/**
 * Check room from the command line (`npm run room-check -- <name>` or `--all`, tools/room-check/room-check.mjs; docs/plans/delver.md, Stage 7g):
 * each bundled room file (`data/delver/rooms/<name>.json`) checked as the Map Editor's Check room does (`checkRoom`), one report a room, with the
 * editor link that opens it and checks it again. Pure of the DOM and of clocks.
 */
import { loadTuningData } from '../tuning';
import { checkRoom, roomCheckText } from './roomCheck';

/** The room files bundled from `data/delver/rooms/`, keyed by name. */
const files = import.meta.glob<unknown>('../../data/delver/rooms/*.json', { eager: true, import: 'default' });
const byName = Object.fromEntries(Object.entries(files).map(([p, raw]) => [p.slice(p.lastIndexOf('/') + 1, -'.json'.length), raw]));

/** Check rooms `names` (all of them with `all`): the report's text and how many rooms have an error. */
export function roomCheckRooms(names: readonly string[], all: boolean): { text: string; problems: number } {
  const tuning = loadTuningData();
  const wanted = all ? Object.keys(byName).sort() : [...names];
  const lines: string[] = [];
  let problems = 0;
  for (const name of wanted) {
    const raw = byName[name];
    if (raw === undefined) {
      lines.push(`✗ room ${name}: no data/delver/rooms/${name}.json`);
      problems++;
      continue;
    }
    const c = checkRoom(raw, tuning);
    if (!c.ok) problems++;
    lines.push(roomCheckText(name, c));
  }
  lines.push('', `${wanted.length} rooms, ${problems} with errors.`);
  return { text: lines.join('\n'), problems };
}
