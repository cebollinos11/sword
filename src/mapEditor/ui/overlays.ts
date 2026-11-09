/**
 * The Map Editor's overlays (docs/plans/map-editor.md, Stage 2), shared by the top view and the 3D view: which are on, and their colours.
 */
import type { ClearanceNode, EdgeKind, SurfaceReach } from '../checks';

export interface Overlays {
  /** Walk Surfaces by whether the walk check reaches them (unreached ones flash). */
  reach: boolean;
  /** Walk Surface edges by how a Soldier crosses them, each kind on its own. */
  edges: boolean;
  edgeKinds: Record<EdgeKind, boolean>;
  /** The destination fields' clearance: the files a Formation fits at each node. */
  clearance: boolean;
  /** The destination fields' cell centres, red where a Wall cuts one off. */
  centres: boolean;
}

export const REACH_COLOURS: Readonly<Record<SurfaceReach, string>> = { reached: '#3fbf5f', unreached: '#ff3b3b', stranded: '#ff9a2f', deadly: '#ff5a1f' };
export const EDGE_COLOURS: Readonly<Record<EdgeKind, string>> = { walk: '#5fd07a', drop: '#ffd23f', wall: '#e8e8e8', ledge: '#ff3b8a' };
export const EDGE_LABELS: Readonly<Record<EdgeKind, string>> = { walk: 'walk (a step)', drop: 'drop (one way)', wall: 'Wall', ledge: 'ledge (no way off)' };

/** A clearance node's colour: red where a Formation goes in one file, through amber, to green where it keeps a full line (blue: nothing near). */
export function clearanceColour(n: ClearanceNode): string {
  if (!Number.isFinite(n.clearance)) return '#4a78c8';
  const COLOURS = ['#ff3b3b', '#ff7a2f', '#ffb03f', '#e0d040', '#a8d040', '#5fc050'];
  return COLOURS[Math.min(COLOURS.length - 1, n.files - 1)]!;
}
