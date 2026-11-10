/**
 * The Quick check over a Map Source (docs/plans/map-editor.md, Stage 4): `npm run quick-check -- <map>.source.json [--seeds 1,2,3] [--army 40] [--json]`.
 * Runs whole AI-v-AI Battles on the draft (no Players, fixed seeds) and prints each Battle's length and end, the captures per Objective, the Ticket
 * curve and the stall time. A rerun with the same seeds prints the same numbers. The game's code is TypeScript read through Vite (the Tuning Data is
 * bundled by its glob), so this starts Vite's module loader, not a dev server.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^[\d,]+$/.test(a));
const value = (flag) => {
  const k = args.indexOf(flag);
  return k >= 0 ? args[k + 1] : undefined;
};
if (!file) {
  console.error('usage: npm run quick-check -- <map>.source.json [--seeds 1,2,3] [--army 40] [--json]');
  process.exit(2);
}
const seeds = value('--seeds')?.split(',').map(Number);
const armySize = value('--army') === undefined ? undefined : Number(value('--army'));
if ((seeds && seeds.some((s) => !Number.isInteger(s) || s < 0)) || (armySize !== undefined && !(armySize >= 1))) {
  console.error('--seeds takes whole numbers (1,2,3); --army a number of Soldiers, at least 1');
  process.exit(2);
}

const server = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false, watch: null } });
let code = 0;
try {
  const { quickCheckSource } = await server.ssrLoadModule('/src/mapEditor/quickCheckCli.ts');
  const { report, text } = quickCheckSource(readFileSync(file, 'utf8'), { seeds, armySize });
  console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : text);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  code = 1;
} finally {
  await server.close();
}
process.exit(code);
