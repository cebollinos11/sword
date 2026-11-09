/**
 * The Map Editor's play-test (docs/plans/map-editor.md, Stage 4): the draft, as it is in the editor now (no save, no reload), in the Battle routes
 * that already exist, run in this page over the editor. Three modes: **Spectate** (an AI-v-AI Battle at a chosen speed, with the Objectives'
 * Owners and a stuck heat map drawn over it), **Play** (the Player's Fighter among the armies) and **Walk** (the Player alone on the map, no armies).
 * The draft is compiled into a copy of the Tuning Data (`draftTuning`), so every cache is built afresh for it. The editor is left as it was under
 * the layer (its session, undo history and cameras untouched); Back removes the layer and the Battle's renderer.
 */
import { startBattlePlay } from '../../play/battlePlay';
import { startBattleSpectator, type BattleHandle } from '../../play/battleSpectator';
import { startMapWalk } from '../../play/mapWalk';
import type { Draft } from '../playtest';
import { SpectateOverlays } from './spectateOverlays';

export type PlaytestMode = 'spectate' | 'play' | 'walk';
export const PLAYTEST_MODES: Record<PlaytestMode, string> = { spectate: 'Spectate (AI v AI)', play: 'Play (you among the armies)', walk: 'Walk (you alone)' };

export interface PlaytestOptions {
  readonly mode: PlaytestMode;
  readonly seed: number;
  /** Spectate's speed: 1, 2 or 4. */
  readonly speed: number;
  /** Called once the layer is gone (Back, or Quit in the spectator). */
  readonly onBack: () => void;
}

/**
 * Start the play-test of `draft` in a layer over the page. Returns a function that ends it (Back to the editor). `onStarted` is called with the
 * ms from now until the Battle is drawing (its atlas baked), the part of the cycle that is not the editor's.
 */
export function startPlaytest(draft: Draft, options: PlaytestOptions, onStarted?: (ms: number) => void): () => void {
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#10131a';
  const box = document.createElement('div');
  // The Battle routes make their container `position: relative`, so it is sized outright.
  box.style.cssText = 'position:relative;width:100%;height:100%';
  const bar = document.createElement('div');
  bar.style.cssText = 'position:absolute;top:8px;right:8px;z-index:20;display:flex;gap:8px;align-items:center;font:12px system-ui,sans-serif;color:#eee';
  const label = document.createElement('span');
  label.textContent = `Play-test · ${draft.map} · ${PLAYTEST_MODES[options.mode]}`;
  label.style.cssText = 'background:rgba(15,15,20,.8);padding:5px 8px;border-radius:6px';
  const back = document.createElement('button');
  back.textContent = 'Back to the editor';
  back.style.cssText = 'padding:5px 10px;cursor:pointer';
  bar.append(label, back);
  layer.append(box, bar);
  document.body.appendChild(layer);

  const t0 = performance.now();
  let handle: BattleHandle | null = null;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    layer.style.display = 'none';
    // A Battle still baking its soldiers is stopped when it is ready (it cannot be stopped half-way through).
    void ready.then((h) => {
      h?.stop();
      layer.remove();
    });
    options.onBack();
  };
  back.onclick = end;
  const ready: Promise<BattleHandle | null> = (async () => {
    try {
      if (options.mode === 'walk') handle = startMapWalk(box, draft.tuning, { map: draft.map, seed: options.seed });
      else if (options.mode === 'play') handle = await startBattlePlay(box, draft.tuning, { map: draft.map, seed: options.seed });
      else handle = await startBattleSpectator(box, draft.tuning, { map: draft.map, seed: options.seed, speed: options.speed, overlay: new SpectateOverlays(layer, draft.tuning.battle), onExit: end });
      onStarted?.(performance.now() - t0);
    } catch (e) {
      console.error('Play-test failed', e);
      label.textContent = `Play-test failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    return handle;
  })();
  return end;
}
