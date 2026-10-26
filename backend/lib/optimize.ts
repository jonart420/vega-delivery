/**
 * Optimizes the order of stops between a fixed start and end.
 *
 * cost[i][j]: driving time (seconds) from location i to j. Index 0 = start, 1..n = stops,
 * n+1 = end. fixedAt[p] = stop index (1..n) that must be at position p (0-based), else -1.
 *
 * - Up to EXACT_LIMIT stops without time windows: exact (Held-Karp).
 * - Otherwise: nearest neighbour (or Held-Karp seed), then local search with 2-opt, Or-opt and
 *   swaps on the free positions. With time windows the objective is the simulated finish time plus
 *   a penalty for every second of lateness (soft windows: early arrival waits).
 *
 * Returns stop indices (1..n) in visiting order.
 */

export const EXACT_LIMIT = 13;
/** One second late costs as much as LATE_WEIGHT seconds of driving. */
const LATE_WEIGHT = 10;

/** Seconds after tour start. */
export type TimeWindow = { from: number | null; to: number | null };

export type SolveOptions = {
  /** dwell time per location index (0..n+1) */
  dwell?: number[];
  /** time window per location index (0..n+1) */
  windows?: (TimeWindow | null)[];
};

export function solveOrder(cost: number[][], fixedAt: number[], opts: SolveOptions = {}): number[] {
  const n = fixedAt.length;
  if (n === 0) return [];
  const hasWindows = !!opts.windows?.some((w) => w && (w.from != null || w.to != null));
  if (n <= EXACT_LIMIT) {
    const exact = heldKarp(cost, fixedAt);
    return hasWindows ? localSearch(cost, fixedAt, exact, opts) : exact;
  }
  return localSearch(cost, fixedAt, nearestNeighbour(cost, fixedAt), opts);
}

/** Pure driving time of an order. */
export function routeCost(cost: number[][], order: number[]): number {
  const n = order.length;
  let sum = 0;
  let prev = 0;
  for (const s of order) {
    sum += cost[prev][s];
    prev = s;
  }
  return sum + cost[prev][n + 1];
}

/** Simulated objective: finish time incl. dwell and waiting + lateness penalty. */
export function scheduleCost(cost: number[][], order: number[], opts: SolveOptions): number {
  const n = order.length;
  const dwell = opts.dwell;
  const windows = opts.windows;
  if (!dwell && !windows) return routeCost(cost, order);
  let t = 0;
  let penalty = 0;
  let prev = 0;
  for (const s of order) {
    t += cost[prev][s];
    const w = windows?.[s];
    if (w?.from != null && t < w.from) t = w.from;
    if (w?.to != null && t > w.to) penalty += (t - w.to) * LATE_WEIGHT;
    t += dwell?.[s] ?? 0;
    prev = s;
  }
  t += cost[prev][n + 1];
  return t + penalty;
}

function heldKarp(cost: number[][], fixedAt: number[]): number[] {
  const n = fixedAt.length;
  const full = (1 << n) - 1;
  const fixedPosOf = new Array<number>(n + 1).fill(-1);
  fixedAt.forEach((s, p) => s > 0 && (fixedPosOf[s] = p));

  // dp[mask * n + j]: minimal cost start → … → stop j+1, visited = mask
  const size = (1 << n) * n;
  const dp = new Float64Array(size).fill(Infinity);
  const parent = new Int8Array(size).fill(-1);

  const allowed = (stop: number, pos: number) =>
    (fixedAt[pos] < 0 || fixedAt[pos] === stop) && (fixedPosOf[stop] < 0 || fixedPosOf[stop] === pos);

  for (let j = 0; j < n; j++) {
    if (allowed(j + 1, 0)) dp[(1 << j) * n + j] = cost[0][j + 1];
  }
  for (let mask = 1; mask <= full; mask++) {
    const pos = popcount(mask);
    if (pos >= n) continue;
    for (let j = 0; j < n; j++) {
      const cur = dp[mask * n + j];
      if (!(mask & (1 << j)) || cur === Infinity) continue;
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k) || !allowed(k + 1, pos)) continue;
        const nm = mask | (1 << k);
        const v = cur + cost[j + 1][k + 1];
        if (v < dp[nm * n + k]) {
          dp[nm * n + k] = v;
          parent[nm * n + k] = j;
        }
      }
    }
  }

  let best = Infinity;
  let last = -1;
  for (let j = 0; j < n; j++) {
    const v = dp[full * n + j] + cost[j + 1][n + 1];
    if (v < best) {
      best = v;
      last = j;
    }
  }
  if (last < 0) throw new Error("No valid order (contradicting fixed positions?)");

  const order: number[] = [];
  let mask = full;
  let j = last;
  while (j >= 0) {
    order.push(j + 1);
    const p = parent[mask * n + j];
    mask &= ~(1 << j);
    j = p;
  }
  return order.reverse();
}

function nearestNeighbour(cost: number[][], fixedAt: number[]): number[] {
  const n = fixedAt.length;
  const order = new Array<number>(n).fill(-1);
  const used = new Set<number>();
  fixedAt.forEach((s, p) => {
    if (s > 0) {
      order[p] = s;
      used.add(s);
    }
  });
  let prev = 0;
  for (let p = 0; p < n; p++) {
    if (order[p] > 0) {
      prev = order[p];
      continue;
    }
    let best = -1;
    for (let s = 1; s <= n; s++) {
      if (!used.has(s) && (best < 0 || cost[prev][s] < cost[prev][best])) best = s;
    }
    order[p] = best;
    used.add(best);
    prev = best;
  }
  return order;
}

/**
 * Local search on the free positions only (fixed stops never move):
 * 2-opt (reverse a segment), Or-opt (move a segment of 1–3 stops) and pairwise swaps,
 * first improvement, until no move helps or the time budget is used up.
 */
function localSearch(cost: number[][], fixedAt: number[], start: number[], opts: SolveOptions, budgetMs = 4000): number[] {
  const freePos = fixedAt.map((s, p) => (s > 0 ? -1 : p)).filter((p) => p >= 0);
  const m = freePos.length;
  if (m < 2) return start;

  const order = start.slice();
  let seq = freePos.map((p) => order[p]); // stops at free positions, in order
  const build = (s: number[]) => {
    const o = order.slice();
    freePos.forEach((p, i) => (o[p] = s[i]));
    return o;
  };
  let best = scheduleCost(cost, build(seq), opts);
  const deadline = Date.now() + budgetMs;

  const tryCandidate = (cand: number[]) => {
    const v = scheduleCost(cost, build(cand), opts);
    if (v + 1e-6 < best) {
      best = v;
      seq = cand;
      return true;
    }
    return false;
  };

  let improved = true;
  while (improved && Date.now() < deadline) {
    improved = false;
    // 2-opt
    for (let i = 0; i < m - 1 && !improved; i++) {
      for (let k = i + 1; k < m; k++) {
        const cand = seq.slice(0, i).concat(seq.slice(i, k + 1).reverse(), seq.slice(k + 1));
        if (tryCandidate(cand)) {
          improved = true;
          break;
        }
      }
    }
    if (improved) continue;
    // Or-opt: move segments of length 1..3
    for (let len = 1; len <= 3 && !improved; len++) {
      for (let i = 0; i + len <= m && !improved; i++) {
        const seg = seq.slice(i, i + len);
        const rest = seq.slice(0, i).concat(seq.slice(i + len));
        for (let j = 0; j <= rest.length; j++) {
          if (j === i) continue;
          const cand = rest.slice(0, j).concat(seg, rest.slice(j));
          if (tryCandidate(cand)) {
            improved = true;
            break;
          }
        }
      }
    }
    if (improved) continue;
    // Swaps
    for (let i = 0; i < m - 1 && !improved; i++) {
      for (let k = i + 1; k < m; k++) {
        const cand = seq.slice();
        [cand[i], cand[k]] = [cand[k], cand[i]];
        if (tryCandidate(cand)) {
          improved = true;
          break;
        }
      }
    }
  }
  return build(seq);
}

function popcount(x: number) {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}
