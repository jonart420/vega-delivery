import assert from "node:assert/strict";
import { test } from "node:test";
import { routeCost, scheduleCost, solveOrder } from "../lib/optimize";

/** Points on a line: optimal order is sorted by position. */
function lineMatrix(pos: number[]) {
  return pos.map((a) => pos.map((b) => Math.abs(a - b) * 10));
}

test("exact solver orders points on a line", () => {
  const pos = [0, 5, 1, 4, 2, 3, 6]; // start 0, end 6
  const order = solveOrder(lineMatrix(pos), new Array(5).fill(-1));
  assert.deepEqual(order.map((i) => pos[i]), [1, 2, 3, 4, 5]);
});

test("heuristic handles many stops and respects fixed positions", () => {
  const n = 40;
  const stops = Array.from({ length: n }, (_, i) => ((i * 17) % n) + 1);
  const pos = [0, ...stops, n + 1];
  const fixedAt = new Array(n).fill(-1);
  fixedAt[0] = stops.indexOf(n) + 1; // the farthest stop first
  const order = solveOrder(lineMatrix(pos), fixedAt);
  assert.equal(pos[order[0]], n);
  assert.equal(new Set(order).size, n);
  const naive = Array.from({ length: n }, (_, i) => i + 1);
  assert.ok(routeCost(lineMatrix(pos), order) <= routeCost(lineMatrix(pos), naive));
});

test("time windows are respected softly", () => {
  // Round trip from 0: stops left (-1) and right (+1) cost the same in either order,
  // but the left one must be reached within 10 s.
  const pos = [0, 1, -1, 0];
  const cost = lineMatrix(pos);
  const windows = [null, null, { from: null, to: 10 }, null];
  const order = solveOrder(cost, [-1, -1], { windows, dwell: [0, 0, 0, 0] });
  assert.equal(order[0], 2, "stop with early deadline first");
  assert.ok(scheduleCost(cost, order, { windows }) < scheduleCost(cost, [1, 2], { windows }));
});
