/**
 * Warbands (docs/plans/delver.md, Stage 3): the Squads of a Delver Run's Floor, which guard a post or patrol a loop, chase a party Fighter they
 * see and return home. This file holds their state and modes; they are deployed by `deployWarbands` (`sim/delver/warbands.ts`).
 */

/** A Warband's mode: holding its post, walking its loop, following a party Fighter it saw, or walking home. */
export const GUARD = 0;
export const PATROL = 1;
export const CHASE = 2;
export const RETURN = 3;

/**
 * The Warbands' brains as struct-of-arrays (plain data, hashed and snapshotted with the Match): entry q is Squad q of the Floor's Crowd
 * (`CrowdState.warbands`). A Warband's home is its post (`plan.markers.posts[post]`) for a guard, its loop's point `leg` for a patrol.
 */
export interface WarbandState {
  /** GUARD, PATROL, CHASE or RETURN. */
  readonly mode: readonly number[];
  /** Its post (an index into `plan.markers.posts`), or -1 for a patrol. */
  readonly post: readonly number[];
  /** Its loop (an index into `plan.markers.patrols`), or -1 for a guard. */
  readonly patrol: readonly number[];
  /** A patrol's waypoint (an index into its loop's points) it walks to or returns to; 0 for a guard. */
  readonly leg: readonly number[];
  /** The party Fighter (Pool slot) it chases, or -1. */
  readonly chased: readonly number[];
  /** The Tick it last saw `chased`, or -1. */
  readonly seen: readonly number[];
  /** The Soldiers it deployed with (its morale counts from this). */
  readonly size: readonly number[];
  /** Its template's index in its tier's guard or patrol pool. */
  readonly encounter: readonly number[];
}
