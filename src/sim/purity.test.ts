import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ADR 0001: the Simulation must not touch wall-clock time, Math.random,
 * the DOM or rendering. This scans every non-test source file under src/sim.
 */
const SIM_DIR = fileURLToPath(new URL('.', import.meta.url));

const FORBIDDEN: [RegExp, string][] = [
  [/Math\.random/, 'Math.random'],
  [/\bDate\b/, 'Date (wall-clock)'],
  [/\bperformance\b/, 'performance (wall-clock)'],
  [/\brequestAnimationFrame\b/, 'requestAnimationFrame'],
  [/\bset(?:Timeout|Interval)\b/, 'timers'],
  [/\b(?:window|document|navigator)\b/, 'DOM globals'],
  [/from\s+['"]three(?:\/[^'"]*)?['"]/, 'three.js import'],
  [/from\s+['"][./]*(?:render|editor)\//, 'render/editor import'],
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

describe('Simulation purity', () => {
  const files = sourceFiles(SIM_DIR);

  it('finds the Simulation sources', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.slice(SIM_DIR.length)]))('%s has no wall-clock, Math.random, DOM or rendering access', (rel) => {
    const src = readFileSync(join(SIM_DIR, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const hits = FORBIDDEN.filter(([re]) => re.test(src)).map(([, what]) => what);
    expect(hits).toEqual([]);
  });
});
