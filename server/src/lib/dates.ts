import { z } from "zod";
import { db } from "./db.js";

/**
 * A calendar date. A bare "YYYY-MM-DD" becomes local noon instead of UTC
 * midnight (which is the previous evening in US timezones).
 */
export const dateOnly = z.preprocess((v) => {
  if (typeof v === "string") {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12);
  }
  return v;
}, z.coerce.date());

const isUtcMidnight = (d: Date) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;

/**
 * Earlier versions saved form dates as UTC midnight, which displays a day
 * early in US timezones. Move those to noon UTC on the same calendar day.
 * Imported rows sit at local midnight, never exactly 00:00 UTC in the US,
 * and fixed rows land at 12:00, so this is safe to run on every start.
 */
export async function repairUtcMidnightDates() {
  let fixed = 0;
  for (const m of await db.mileageEntry.findMany()) {
    if (isUtcMidnight(m.date)) {
      await db.mileageEntry.update({ where: { id: m.id }, data: { date: new Date(m.date.getTime() + 12 * 3_600_000) } });
      fixed++;
    }
  }
  for (const e of await db.expense.findMany()) {
    if (isUtcMidnight(e.date)) {
      await db.expense.update({ where: { id: e.id }, data: { date: new Date(e.date.getTime() + 12 * 3_600_000) } });
      fixed++;
    }
  }
  return fixed;
}
