/** Fixed Simulation Tick rate (a constant, not Tuning Data). */
export const TICK_RATE = 60;
/** Duration of one Tick in seconds. */
export const TICK_SECONDS = 1 / TICK_RATE;

/** A duration in seconds (Tuning Data) as a whole number of Ticks, rounded to the nearest Tick. */
export const secondsToTicks = (seconds: number): number => Math.round(seconds * TICK_RATE);
