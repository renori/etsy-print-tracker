import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { dateOnly } from "../lib/dates.js";
import { IRS_BUSINESS_RATES, irsRateFor } from "../lib/irsMileage.js";

const create = z.object({
  date: dateOnly,
  destination: z.string().min(1),
  purpose: z.string().nullable().optional(),
  miles: z.number(),
  // Blank = the IRS rate for the trip date.
  ratePerMile: z.number().nullable().optional(),
});
const update = create.partial();

export default async function mileageRoutes(app: FastifyInstance) {
  app.get("/mileage", async () => db.mileageEntry.findMany({ orderBy: { date: "desc" } }));

  app.get("/mileage/irs-rates", async () => IRS_BUSINESS_RATES);

  app.post("/mileage", async (req, reply) => {
    const { ratePerMile, ...data } = create.parse(req.body);
    const row = await db.mileageEntry.create({ data: { ...data, ratePerMile: ratePerMile ?? irsRateFor(data.date) } });
    reply.code(201);
    return row;
  });

  app.put("/mileage/:id", async (req) => {
    const { id } = req.params as { id: string };
    const { ratePerMile, ...data } = update.parse(req.body);
    const existing = await db.mileageEntry.findUniqueOrThrow({ where: { id } });
    const date = data.date ?? existing.date;
    return db.mileageEntry.update({ where: { id }, data: { ...data, ratePerMile: ratePerMile ?? irsRateFor(date) } });
  });

  app.delete("/mileage/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.mileageEntry.delete({ where: { id } });
    reply.code(204);
  });

  /** Resets every trip's rate to the IRS rate for its date. */
  app.post("/mileage/apply-irs-rates", async () => {
    const rows = await db.mileageEntry.findMany();
    let changed = 0;
    for (const r of rows) {
      const rate = irsRateFor(r.date);
      if (Math.abs(rate - r.ratePerMile) > 1e-9) {
        await db.mileageEntry.update({ where: { id: r.id }, data: { ratePerMile: rate } });
        changed++;
      }
    }
    return { changed, total: rows.length };
  });

  app.get("/mileage/summary", async () => {
    const rows = await db.mileageEntry.findMany();
    const byYear = new Map<number, { miles: number; deduction: number }>();
    for (const r of rows) {
      const y = r.date.getFullYear();
      const cur = byYear.get(y) ?? { miles: 0, deduction: 0 };
      cur.miles += r.miles;
      cur.deduction += r.miles * r.ratePerMile;
      byYear.set(y, cur);
    }
    return {
      totalMiles: rows.reduce((s, r) => s + r.miles, 0),
      totalDeduction: rows.reduce((s, r) => s + r.miles * r.ratePerMile, 0),
      byYear: [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, v]) => ({ year, ...v })),
    };
  });
}
