/**
 * The AI check of generated Delver Floors: `npm run ai-walk -- [--seeds 1-20] [--floors 1,5,9] [--drawn] [--walk-only] [--difficulty Hard] [--quirks Hopper] [--piece spiral] [--notes] [--json]`.
 * `--piece cross|uphill|spiral|room` deals each Floor with every Hall rolled for that set piece (docs/plans/delver.md, Stage 7f; `room`, Stage 7g: every bundled drawn room), as the Map Editor's Set piece choice does.
 * For each (seed, Floor) it probes the Fighters' navmesh and walks one AI Fighter through the real Simulation to every Hall centre and marker,
 * printing what got stuck, fell, was slow or had no route, with a Map Editor link (on `npm run dev`) that opens the Floor and walks it again.
 * Exits 1 if any Floor has a problem (an error or a warning). The game's code is TypeScript read through Vite, so this starts Vite's module
 * loader, not a dev server (as tools/quick-check does).
 */
import { createServer } from 'vite';

const args = process.argv.slice(2);
const value = (flag) => {
  const k = args.indexOf(flag);
  return k >= 0 ? args[k + 1] : undefined;
};
/** "1-5,9" → [1, 2, 3, 4, 5, 9]. */
const list = (text) =>
  text.split(',').flatMap((part) => {
    const [a, b] = part.split('-').map(Number);
    return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, k) => a + k);
  });
const seeds = list(value('--seeds') ?? '1-10');
const floors = list(value('--floors') ?? '1-9');
const piece = value('--piece');
if ([...seeds, ...floors].some((n) => !Number.isInteger(n) || n < 0) || (piece !== undefined && !['cross', 'uphill', 'spiral', 'room'].includes(piece))) {
  console.error('usage: npm run ai-walk -- [--seeds 1-20] [--floors 1,5,9] [--drawn] [--walk-only] [--difficulty Hard] [--quirks Hopper] [--piece cross|uphill|spiral|room] [--notes] [--json]');
  process.exit(2);
}

const server = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false, watch: null } });
let code = 0;
try {
  const { aiWalkFloors } = await server.ssrLoadModule('/src/mapEditor/aiWalkCli.ts');
  const { reports, text, problems } = aiWalkFloors({
    seeds,
    floors,
    sheathed: !args.includes('--drawn'),
    walkOnly: args.includes('--walk-only'),
    difficulty: value('--difficulty'),
    ...(value('--quirks') ? { quirks: value('--quirks').split(',') } : {}),
    notes: args.includes('--notes'),
    ...(piece ? { piece } : {}),
  });
  console.log(args.includes('--json') ? JSON.stringify(reports, null, 2) : text);
  if (problems) code = 1;
} catch (e) {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  code = 2;
} finally {
  await server.close();
}
process.exit(code);
