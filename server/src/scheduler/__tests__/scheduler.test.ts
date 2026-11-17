import test from "node:test";
import assert from "node:assert/strict";
import { parseClockTime, minutesToClock } from "../time.js";
import { parseDaysPattern, startableIntervals } from "../windows.js";
import { packPlates } from "../plates.js";
import { schedulePlates } from "../schedule.js";

test("parseClockTime handles 12h and 24h", () => {
  assert.equal(parseClockTime("7:30 AM"), 7 * 60 + 30);
  assert.equal(parseClockTime("12:30 AM"), 30);
  assert.equal(parseClockTime("6:00 PM"), 18 * 60);
  assert.equal(parseClockTime("18:00"), 18 * 60);
  assert.equal(minutesToClock(7 * 60 + 30), "7:30 AM");
});

test("parseDaysPattern: real Blackout Times row 'Thu, Mon, Tue'", () => {
  const m = parseDaysPattern("Thu, Mon, Tue");
  assert.equal(m.kind, "weekly");
  if (m.kind === "weekly") {
    assert.deepEqual([...m.days].sort(), [1, 2, 4]); // Mon=1, Tue=2, Thu=4
  }
});

test("startableIntervals excludes the Tennis blackout from the evening window", () => {
  const settings = { morningStart: "7:30 AM", morningWindowMinutes: 15, homeTime: "6:00 PM", lastStart: "12:30 AM" };
  const blackouts = [{ daysPattern: "Thu, Mon, Tue", fromTime: "7:20 PM", toTime: "9:20 PM" }];
  // Wed 2026-11-18 is not in the blackout's day set, so evening window should be untouched.
  const wed = new Date(2026, 10, 18);
  const wedIntervals = startableIntervals(settings, blackouts, wed, new Date(wed.getTime() + 24 * 3600_000));
  const eveningStartWed = new Date(2026, 10, 18, 18, 0);
  assert.ok(wedIntervals.some(([s]) => s.getTime() === eveningStartWed.getTime()));

  // Tue 2026-11-17 IS in the blackout days, so 7:20-9:20pm must be carved out.
  const tue = new Date(2026, 10, 17);
  const tueIntervals = startableIntervals(settings, blackouts, tue, new Date(tue.getTime() + 24 * 3600_000));
  const blackoutStart = new Date(2026, 10, 17, 19, 20);
  const blackoutEnd = new Date(2026, 10, 17, 21, 20);
  for (const [s, e] of tueIntervals) {
    const overlaps = s.getTime() < blackoutEnd.getTime() && e.getTime() > blackoutStart.getTime();
    assert.equal(overlaps, false, `interval ${s}-${e} should not overlap the Tennis blackout`);
  }
});

test("packPlates: 'Case (a) + Rail Covers' recipe batches up to its maxes, leftover drains 1-per-plate", () => {
  const parts = new Map([
    ["case-a", { id: "case-a", name: "Kickstand Case (a)", printMinutes: 168 }],
    ["rail", { id: "rail", name: "Rail Covers", printMinutes: 29.5 }],
    ["lonewolf", { id: "lonewolf", name: "No-recipe part", printMinutes: 10 }],
  ]);
  const recipes = [
    {
      id: "r1",
      printerId: null,
      plateMinutes: null,
      parts: [
        { partId: "case-a", maxCount: 1 },
        { partId: "rail", maxCount: 2 },
      ],
    },
  ];
  const demand = new Map([
    ["case-a", 2],
    ["rail", 3],
    ["lonewolf", 2],
  ]);
  const plates = packPlates(demand, recipes, parts);
  // 2 plates from the recipe (case-a:1+rail:2, then case-a:1+rail:1), plus 2 single-part plates for lonewolf.
  const recipePlates = plates.filter((p) => p.recipeId === "r1");
  assert.equal(recipePlates.length, 2);
  assert.equal(recipePlates[0].parts.find((p) => p.partId === "rail")?.quantity, 2);
  assert.equal(recipePlates[1].parts.find((p) => p.partId === "rail")?.quantity, 1);
  const lonewolfPlates = plates.filter((p) => p.parts[0]?.partId === "lonewolf");
  assert.equal(lonewolfPlates.length, 2);
});

test("schedulePlates assigns to the earliest-free active printer and respects fixed in-flight plates", () => {
  const settings = { morningStart: "12:00 AM", morningWindowMinutes: 1440, homeTime: "12:00 AM", lastStart: "11:59 PM" };
  const now = new Date(2026, 10, 18, 10, 0);
  const pending = [
    { label: "A", printerId: null, recipeId: null, minutes: 60, parts: [{ partId: "x", quantity: 1 }] },
    { label: "B", printerId: null, recipeId: null, minutes: 60, parts: [{ partId: "x", quantity: 1 }] },
  ];
  const fixed = [{ id: "f1", printerId: "P1", plannedFinish: new Date(2026, 10, 18, 11, 0) }];
  const scheduled = schedulePlates(pending, ["P1", "P2"], fixed, settings, [], now);
  // P2 is free at `now`, P1 is busy until 11:00 — the first plate should go to P2.
  assert.equal(scheduled[0].printerId, "P2");
  assert.equal(scheduled[0].plannedStart.getTime(), now.getTime());
});
