import { loadTuningData, TuningDataError, type TuningData } from './tuning';

/**
 * App entry and router. Routes are hash-based so they work on GitHub Pages:
 *   /sword/            the game
 *   /sword/#/editor    the Editor (loaded on demand, so the game never ships Tweakpane up front)
 */
const container = document.getElementById('app')!;

function showError(title: string, message: string): void {
  const box = document.createElement('div');
  box.className = 'fatal-error';
  const h = document.createElement('h1');
  h.textContent = title;
  const pre = document.createElement('pre');
  pre.textContent = message;
  box.append(h, pre);
  container.replaceChildren(box);
}

function load(): TuningData | undefined {
  try {
    return loadTuningData();
  } catch (e) {
    if (e instanceof TuningDataError) {
      showError('Invalid Tuning Data', `${e.message}\n\nFix the JSON under data/ and reload.`);
      return undefined;
    }
    throw e;
  }
}

window.addEventListener('hashchange', () => location.reload());

const tuning = load();
if (tuning) {
  if (location.hash.startsWith('#/editor')) {
    void import('./editor').then((m) => m.startEditor(container, tuning));
  } else {
    void import('./game').then((m) => m.startGame(container, tuning));
  }
}
