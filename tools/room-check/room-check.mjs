/**
 * Check room from the command line: `npm run room-check -- <name> [<name>...]` or `npm run room-check -- --all` (docs/plans/delver.md, Stage 7g).
 * Each bundled room file is parsed, its stub compiled and walk-checked, its navmesh built and the AI walked between its centre, doorways and
 * Platforms, in two frames, as the Map Editor's Check room does. Prints each problem with the editor link that opens the room and checks it
 * again, and exits 1 if any room has an error. Starts Vite's module loader, not a dev server (as tools/ai-walk does).
 */
import { createServer } from 'vite';

const args = process.argv.slice(2);
const all = args.includes('--all');
const names = args.filter((a) => !a.startsWith('--'));
if (!all && names.length === 0) {
  console.error('usage: npm run room-check -- <name> [<name>...] | --all');
  process.exit(2);
}
const server = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false, watch: null } });
let code = 0;
try {
  const { roomCheckRooms } = await server.ssrLoadModule('/src/mapEditor/roomCheckCli.ts');
  const { text, problems } = roomCheckRooms(names, all);
  console.log(text);
  if (problems) code = 1;
} catch (e) {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  code = 2;
} finally {
  await server.close();
}
process.exit(code);
