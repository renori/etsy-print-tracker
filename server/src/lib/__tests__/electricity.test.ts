import test from "node:test";
import assert from "node:assert/strict";
import { itemLines, similarity, MATCH_THRESHOLD } from "../electricity.js";

test("closest name wins; unrelated text doesn't match", () => {
  const parts = ["Kickstand Case", "Full Grip Case Full Back", "Rail Covers"];
  const best = (t: string) => parts.map((p) => ({ p, s: similarity(t, p) })).sort((a, b) => b.s - a.s)[0];
  assert.equal(best("Full Grip Case w/ Kickstand - Full Back").p, "Full Grip Case Full Back");
  assert.equal(best("Kickstand case for Odin 3").p, "Kickstand Case");
  assert.equal(best("Switch rail cover pair").p, "Rail Covers"); // "cover" ~ "covers"
  assert.ok(best("Gift wrapping").s < MATCH_THRESHOLD);
});

test("item text from old orders: quantities, ';'-joined items, variation lines", () => {
  assert.deepEqual(itemLines({ etsyLines: null, itemsRaw: "2x Full Grip Case\n     Style: Full Back" }), [{ text: "Full Grip Case Style: Full Back", quantity: 2 }]);
  assert.deepEqual(itemLines({ etsyLines: null, itemsRaw: "1x Kickstand case; 3× Rail Covers" }), [
    { text: "Kickstand case", quantity: 1 },
    { text: "Rail Covers", quantity: 3 },
  ]);
  assert.deepEqual(itemLines({ etsyLines: null, itemsRaw: "Phone stand" }), [{ text: "Phone stand", quantity: 1 }]);
});
