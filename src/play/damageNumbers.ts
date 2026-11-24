/**
 * Damage Numbers: the damage a Fighter takes floats up over where it landed, red when it is the local Player's Fighter that
 * was hurt and gold for anyone else. Render only: it listens to each Tick's events (like `CameraShake`) and never touches the
 * Simulation. Every blow that deals damage counts (Hit, Dagger Hit, Kick, Chain Knockdown, a hurting Landing); one dealing
 * none (a Block, a teammate) shows nothing. A Tick is read once however often rollback re-simulates it; `seek` when the loop jumps.
 */
import type { SimEvent, SimState } from '../sim';
import { damageNumbersEnabled } from '../render/damageNumbers';

type Point = { readonly x: number; readonly y: number; readonly z: number };

/** Seconds a number floats, metres it rises meanwhile, and the most on screen at once. */
const LIFE = 1;
const RISE = 0.9;
const MAX_LIVE = 24;

export const DAMAGE_NUMBERS_CSS = `
.damage-numbers { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.damage-number { position: absolute; left: 0; top: 0; font-family: var(--font-body); font-size: 2.6rem; line-height: 1; color: #ffd24a; text-shadow: var(--px) var(--px) 0 #000, calc(var(--px) * -1) var(--px) 0 #000; will-change: transform, opacity; }
.damage-number.mine { color: #ff4a3d; }
`;

export interface DamageNumber {
  readonly point: Point;
  readonly amount: number;
  /** The hurt Fighter is the local Player's. */
  readonly mine: boolean;
}

/** The numbers this Tick's events call for, in event order: damage above zero only. */
export function damageNumbersFor(events: readonly SimEvent[], fighters: SimState['fighters'], me: number): DamageNumber[] {
  const out: DamageNumber[] = [];
  const add = (fighter: number, amount: number, point: Point | undefined): void => {
    if (!(amount > 0)) return;
    const f = fighters[fighter];
    const at = point ?? (f && { x: f.position.x, y: f.y + (f.size?.height ?? 1.8) * 0.8, z: f.position.z });
    if (at) out.push({ point: at, amount, mine: fighter === me });
  };
  for (const e of events) {
    if (e.type === 'Hit' || e.type === 'KickLanded') add(e.defender, e.damage, e.point);
    else if (e.type === 'DaggerHit') add(e.defender, e.damage, e.point);
    else if (e.type === 'ChainKnockdown') add(e.fighter, e.damage, e.point);
    else if (e.type === 'Land') add(e.fighter, e.damage, undefined);
  }
  return out;
}

interface Live {
  readonly el: HTMLElement;
  readonly point: Point;
  age: number;
}

export class DamageNumbers {
  readonly root = document.createElement('div');
  private live: Live[] = [];
  private lastTick = -Infinity;

  constructor(container: HTMLElement) {
    this.root.className = 'damage-numbers';
    container.append(this.root);
  }

  /** After each Tick's step: spawns that Tick's numbers (once per Tick). */
  onTick(tick: number, duel: Pick<SimState, 'events' | 'fighters'>, me: number): void {
    if (tick <= this.lastTick) return;
    this.lastTick = tick;
    if (!damageNumbersEnabled()) return;
    for (const n of damageNumbersFor(duel.events, duel.fighters, me)) {
      const el = document.createElement('div');
      el.className = n.mine ? 'damage-number mine' : 'damage-number';
      el.textContent = String(Math.max(1, Math.round(n.amount)));
      el.hidden = true;
      this.root.append(el);
      this.live.push({ el, point: n.point, age: 0 });
    }
    while (this.live.length > MAX_LIVE) this.live.shift()!.el.remove();
  }

  /** The loop jumped (a new Match, a Final Blow Shot): drop what floats and read from `tick` on. */
  seek(tick: number): void {
    this.lastTick = tick;
    this.clear();
  }

  /** Each frame, `seconds` of play (0 while paused): ages and places the numbers; `project` is `Renderer.toScreen`. */
  update(seconds: number, project: (p: Point) => { x: number; y: number } | null): void {
    const show = damageNumbersEnabled();
    this.live = this.live.filter((n) => {
      n.age += seconds;
      if (n.age >= LIFE || !show) {
        n.el.remove();
        return false;
      }
      const t = n.age / LIFE;
      const at = project({ x: n.point.x, y: n.point.y + RISE * (1 - (1 - t) * (1 - t)), z: n.point.z });
      n.el.hidden = !at;
      if (at) {
        n.el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -100%)`;
        n.el.style.opacity = String(t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
      }
      return true;
    });
  }

  clear(): void {
    for (const n of this.live) n.el.remove();
    this.live = [];
  }

  dispose(): void {
    this.root.remove();
  }
}
