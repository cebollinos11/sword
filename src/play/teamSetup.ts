import { MAX_TEAM_SIZE } from '../sim';
import type { TuningData } from '../tuning';
import type { Lineup, LineupSlot } from '../controllers';

/** One AI Fighter's settings in the menu. */
interface AiChoice {
  difficulty: string;
  weapon: string;
}

/** Where the second human Player stands, online: against you, or beside you. */
export type OtherPlayerSide = 'Enemy' | 'Ally';

/**
 * The menu block that sets up who fights: how many AI allies and AI enemies
 * (up to MAX_TEAM_SIZE a side), each AI's difficulty and Weapon, and, online,
 * whether the other player is your ally or your enemy. Its `lineup()` puts
 * Player 0 (you) first on team 0, then any ally Player, then the ally AIs;
 * team 1 holds any enemy Player, then the enemy AIs.
 */
export class TeamSetup {
  readonly root = document.createElement('div');
  private other: OtherPlayerSide = 'Enemy';
  private allies = 0;
  private enemies: number;
  /** Settings kept for every AI slot, so lowering a count and raising it again keeps them. */
  private readonly allyAis: AiChoice[];
  private readonly enemyAis: AiChoice[];

  constructor(
    private readonly tuning: TuningData,
    /** Online: a second human Player takes a slot. */
    private readonly online: boolean,
    private readonly choiceRow: (label: string, options: readonly string[], initial: string, onPick: (v: string) => void) => HTMLElement,
  ) {
    const difficulties = Object.keys(tuning.ai.difficulties);
    const difficulty = difficulties.includes('Normal') ? 'Normal' : difficulties[0]!;
    const weapon = Object.keys(tuning.weapons)[0]!;
    const fresh = () => Array.from({ length: MAX_TEAM_SIZE }, () => ({ difficulty, weapon }));
    this.allyAis = fresh();
    this.enemyAis = fresh();
    this.enemies = online ? 0 : 1;
    this.root.className = 'team-setup';
    this.render();
  }

  /** Who fights, as chosen. */
  lineup(): Lineup {
    const ai = (team: number) => (c: AiChoice): LineupSlot => ({ team, pilot: { kind: 'AI', difficulty: c.difficulty }, weapon: c.weapon });
    const other: LineupSlot[] = this.online ? [{ team: this.other === 'Ally' ? 0 : 1, pilot: { kind: 'Player', player: 1 } }] : [];
    return [
      { team: 0, pilot: { kind: 'Player', player: 0 } },
      ...other.filter((s) => s.team === 0),
      ...this.allyAis.slice(0, this.allies).map(ai(0)),
      ...other.filter((s) => s.team === 1),
      ...this.enemyAis.slice(0, this.enemies).map(ai(1)),
    ];
  }

  /** Humans already on each team (you, and online the other player). */
  private humans(team: number): number {
    if (team === 0) return this.online && this.other === 'Ally' ? 2 : 1;
    return this.online && this.other === 'Enemy' ? 1 : 0;
  }

  private render(): void {
    // Keep each team between 1 and MAX_TEAM_SIZE Fighters.
    const maxAllies = MAX_TEAM_SIZE - this.humans(0);
    const minEnemies = this.humans(1) > 0 ? 0 : 1;
    const maxEnemies = MAX_TEAM_SIZE - this.humans(1);
    this.allies = Math.min(this.allies, maxAllies);
    this.enemies = Math.min(Math.max(this.enemies, minEnemies), maxEnemies);
    const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, k) => String(lo + k));

    const rows: HTMLElement[] = [];
    if (this.online) {
      rows.push(
        this.choiceRow('Other player', ['Enemy', 'Ally'], this.other, (v) => {
          this.other = v as OtherPlayerSide;
          this.render();
        }),
      );
    }
    if (maxAllies > 0) rows.push(this.choiceRow('AI allies', range(0, maxAllies), String(this.allies), (v) => this.setCount('allies', Number(v))));
    rows.push(this.choiceRow('AI enemies', range(minEnemies, maxEnemies), String(this.enemies), (v) => this.setCount('enemies', Number(v))));

    const format = document.createElement('p');
    format.className = 'team-format';
    const size = (team: number) => this.humans(team) + (team === 0 ? this.allies : this.enemies);
    format.textContent = `${size(0)} v ${size(1)}`;
    rows.push(format);

    const list = document.createElement('div');
    list.className = 'team-ais';
    this.allyAis.slice(0, this.allies).forEach((c, k) => list.append(this.aiRow(`Ally ${k + 1}`, c)));
    this.enemyAis.slice(0, this.enemies).forEach((c, k) => list.append(this.aiRow(`Enemy ${k + 1}`, c)));
    rows.push(list);
    this.root.replaceChildren(...rows);
  }

  private setCount(which: 'allies' | 'enemies', n: number): void {
    this[which] = n;
    this.render();
  }

  /** One AI's difficulty and Weapon. */
  private aiRow(name: string, choice: AiChoice): HTMLElement {
    const row = document.createElement('div');
    row.className = 'menu-row team-ai';
    const label = document.createElement('span');
    label.className = 'menu-label';
    label.textContent = name;
    row.append(
      label,
      this.select(`${name} difficulty`, Object.keys(this.tuning.ai.difficulties), choice.difficulty, (v) => (choice.difficulty = v)),
      this.select(`${name} Weapon`, Object.keys(this.tuning.weapons), choice.weapon, (v) => (choice.weapon = v)),
    );
    return row;
  }

  private select(label: string, options: readonly string[], initial: string, onPick: (v: string) => void): HTMLSelectElement {
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    for (const o of options) select.append(new Option(o, o, false, o === initial));
    select.addEventListener('change', () => onPick(select.value));
    return select;
  }
}
