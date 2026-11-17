import test from "node:test";
import assert from "node:assert/strict";
import { parseRateTable, quoteExport } from "../exportRate.js";

// Pirate Ship's Simple Export Rate chart as it copies from the page: weight and each price on its own line.
const CHART = "Rates\nWeight Not Over\nCanada\nCanada\nAll other countries\nRest of World\n0.5 lb\n$12.99\n$14.99\n1 lb\n$14.99\n$18.99\n2 lb\n$18.99\n$22.99\n3 lb\n$22.99\n$29.99\n4 lb\n$29.99\n$33.99\n5 lb\n$38.99\n$56.99\n20 lb\n$100.99\n$104.99\n";

test("reads Pirate Ship's chart with one value per line", () => {
  const rows = parseRateTable(CHART);
  assert.deepEqual(rows.slice(0, 3), [
    { maxOz: 8, canada: 12.99, world: 14.99 },
    { maxOz: 16, canada: 14.99, world: 18.99 },
    { maxOz: 32, canada: 18.99, world: 22.99 },
  ]);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.at(-1), { maxOz: 320, canada: 100.99, world: 104.99 });
});

test("still reads one tier per line", () => {
  assert.deepEqual(parseRateTable("Weight Canada World\n4 oz $8.25 $10.90\n1 lb\t12.10\t16.40"), [
    { maxOz: 4, canada: 8.25, world: 10.9 },
    { maxOz: 16, canada: 12.1, world: 16.4 },
  ]);
});

test("box weights land in the right tier", () => {
  const rates = parseRateTable(CHART);
  const q = (oz: number, c: string) => quoteExport({ oz, basis: "box", box: null }, c, rates)?.price;
  assert.equal(q(4, "CA"), 12.99); // 8x4x1
  assert.equal(q(8, "GB"), 14.99); // 9x6x2: "not over" 0.5 lb
  assert.equal(q(16, "CA"), 14.99); // 13x10x3
  assert.equal(q(16, "AU"), 18.99);
  assert.equal(q(8.1, "DE"), 18.99);
  assert.equal(q(8, "US"), undefined);
});
