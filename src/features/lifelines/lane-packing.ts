import type { LifespanBar } from "./types";

/**
 * Maximum lanes per group before overflow entries are stacked into existing
 * lanes (causing visual overlap). Keeps layout height bounded.
 */
export const MAX_LANES = 60;

/**
 * Minimum year gap between the end of one bar and the start of the next bar
 * in the same lane. Prevents labels from running into each other at moderate zoom.
 */
export const LANE_GAP_YEARS = 3;

/**
 * Greedy lane-packing algorithm.
 *
 * Sorts bars by startYear, then assigns each to the lowest-indexed lane
 * whose last bar ended at least LANE_GAP_YEARS before the current bar starts.
 * When all lanes are occupied and MAX_LANES is reached, overflows into the
 * lane whose last bar ended earliest (minimal visual collision).
 *
 * Mutates `bar.lane` in place and returns the input array.
 * The original array order is preserved.
 */
export function packLanes(bars: LifespanBar[]): LifespanBar[] {
  if (bars.length === 0) return bars;

  // Work on indices so we can restore original order after sorting.
  const order = bars
    .map((bar, idx) => ({ bar, idx }))
    .sort((a, b) => a.bar.startYear - b.bar.startYear || a.bar.endYear - b.bar.endYear);

  // laneEnd[i] = endYear of the most recent bar assigned to lane i
  const laneEnd: number[] = [];

  for (const { bar } of order) {
    const threshold = bar.startYear - LANE_GAP_YEARS;

    // Find first lane with available space
    let assignedLane = -1;
    for (let l = 0; l < laneEnd.length; l++) {
      if (laneEnd[l] <= threshold) {
        assignedLane = l;
        break;
      }
    }

    if (assignedLane === -1) {
      if (laneEnd.length < MAX_LANES) {
        // Open a new lane
        assignedLane = laneEnd.length;
        laneEnd.push(bar.startYear - 1);
      } else {
        // Overflow: pick the lane whose most recent bar ended earliest
        let earliest = laneEnd[0];
        assignedLane = 0;
        for (let l = 1; l < laneEnd.length; l++) {
          if (laneEnd[l] < earliest) {
            earliest = laneEnd[l];
            assignedLane = l;
          }
        }
      }
    }

    bar.lane = assignedLane;
    laneEnd[assignedLane] = bar.endYear;
  }

  return bars;
}

/** Returns the number of distinct lanes used after packing. */
export function countLanes(bars: LifespanBar[]): number {
  if (bars.length === 0) return 0;
  return Math.max(...bars.map((b) => b.lane)) + 1;
}
