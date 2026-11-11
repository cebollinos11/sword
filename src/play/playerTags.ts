/**
 * The Players' name tags in an online Battle (docs/plans/big-battle.md, Stage 7): a tag floating over each other Player's
 * Fighter in their army's colour, since a Player who took over a Soldier looks like every other soldier. Render only: it
 * reads the Match state each frame (`playerMarkers`, the same marks as the minimap's) and never moves anything. The local
 * Player has no tag, and neither has one who left (its Fighter is an AI's now) or one who has fallen and waits to take over.
 */
import type { SimState } from '../sim';
import { playerMarkers } from '../render/minimap';

/** Metres above a Fighter's feet that its tag floats. */
const TAG_HEIGHT = 2.35;

export const PLAYER_TAGS_CSS = `
.player-tags { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.player-tag { position: absolute; left: 0; top: 0; padding: 0.05rem 0.4rem; font-size: 1.15rem; line-height: 1.1rem; white-space: nowrap; background: #0d0a14; color: #fff; border-bottom: calc(var(--px) * 2) solid var(--army); font-family: var(--font-body); text-shadow: var(--px) var(--px) 0 #000; will-change: transform; }
`;

const css = (colour: number): string => `#${colour.toString(16).padStart(6, '0')}`;

export class PlayerTags {
  readonly root = document.createElement('div');
  private readonly tags: HTMLElement[] = [];

  constructor(
    container: HTMLElement,
    /** Each army's colour, by team. */
    private readonly colours: readonly number[],
    /** Each Player's name by their Fighter slot (a Player's slot is its number's place in the Lineup). */
    private readonly names: readonly (string | undefined)[],
  ) {
    this.root.className = 'player-tags';
    container.append(this.root);
  }

  /** `previous`: the Tick before `state`, `alpha` of the way between them (the tags move as the Fighters are drawn). */
  update(state: SimState, previous: SimState, me: number, alpha: number, project: (p: { x: number; y: number; z: number }) => { x: number; y: number } | null): void {
    const marks = playerMarkers(state, me);
    while (this.tags.length < marks.length) {
      const tag = document.createElement('div');
      tag.className = 'player-tag';
      this.root.append(tag);
      this.tags.push(tag);
    }
    this.tags.forEach((tag, i) => {
      const mark = marks[i];
      const was = mark && previous.fighters[mark.fighter];
      const lerp = (a: number, b: number) => a + (b - a) * alpha;
      const at =
        mark &&
        project({
          x: was ? lerp(was.position.x, mark.position.x) : mark.position.x,
          y: (was ? lerp(was.y, mark.position.y) : mark.position.y) + TAG_HEIGHT,
          z: was ? lerp(was.position.z, mark.position.z) : mark.position.z,
        });
      tag.hidden = !at;
      if (!mark || !at) return;
      const name = this.names[mark.fighter] ?? `Player ${mark.fighter + 1}`;
      if (tag.textContent !== name) tag.textContent = name;
      tag.style.setProperty('--army', css(this.colours[mark.team]!));
      tag.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -100%)`;
    });
  }

  dispose(): void {
    this.root.remove();
  }
}
