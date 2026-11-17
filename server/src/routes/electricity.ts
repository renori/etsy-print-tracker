import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { electricityReport, normText, syncElectricityExpenses } from "../lib/electricity.js";

export default async function electricityRoutes(app: FastifyInstance) {
  app.get("/electricity/report", async () => electricityReport());

  app.put("/electricity/settings", async (req) => {
    const data = z
      .object({
        kwhRate: z.number().positive().max(5).nullable().optional(),
        idleWattsPerPrinter: z.number().min(0).max(500).optional(),
        printersOn: z.number().int().min(0).max(100).nullable().optional(),
        bufferPct: z.number().min(0).max(200).optional(),
      })
      .parse(req.body);
    await db.electricitySettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await syncElectricityExpenses();
    return electricityReport();
  });

  /** Fix how a sold-item description is matched: a part, or null for "not printed". Omit partId to go back to automatic. */
  app.put("/electricity/matches", async (req) => {
    const { text, partId } = z.object({ text: z.string().min(1), partId: z.string().nullable().optional() }).parse(req.body);
    const key = normText(text);
    if (partId === undefined) await db.electricityMatch.deleteMany({ where: { text: key } });
    else await db.electricityMatch.upsert({ where: { text: key }, create: { text: key, partId }, update: { partId } });
    await syncElectricityExpenses();
    return electricityReport();
  });
}
