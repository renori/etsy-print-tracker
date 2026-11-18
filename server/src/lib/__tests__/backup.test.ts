import test from "node:test";
import assert from "node:assert/strict";
import { toPrune } from "../backup.js";

test("keeps the last 30 days, plus the first backup of each month for a year", () => {
  const now = new Date(2026, 10, 18, 4, 0);
  const f = (y: number, m: number, d: number) => ({ name: `tracker-${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}_0315.db`, bytes: 1, at: new Date(y, m - 1, d, 3, 15).toISOString() });
  const files = [f(2026, 11, 17), f(2026, 10, 20), f(2026, 10, 15), f(2026, 10, 1), f(2026, 9, 2), f(2026, 9, 9), f(2025, 10, 1), f(2025, 12, 5)];
  assert.deepEqual(toPrune(files, now).sort(), [f(2026, 10, 15).name, f(2026, 9, 9).name, f(2025, 10, 1).name].sort());
});
