import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { parseRateTable } from "../lib/exportRate.js";
import { refreshLabelEstimates } from "../lib/financials.js";

const row = z.object({ maxOz: z.number().positive(), canada: z.number().nonnegative().nullable(), world: z.number().nonnegative().nullable() });

export default async function exportRateRoutes(app: FastifyInstance) {
  app.get("/export-rates", async () => db.exportRate.findMany({ orderBy: { maxOz: "asc" } }));

  /** Replaces the whole price list, from rows or from pasted text. */
  app.put("/export-rates", async (req, reply) => {
    const body = z.union([z.object({ text: z.string() }), z.object({ rows: z.array(row) })]).parse(req.body);
    const rows = "text" in body ? parseRateTable(body.text) : body.rows;
    if ("text" in body && !rows.length && body.text.trim()) {
      reply.code(400);
      return { error: "No rows found. Paste one tier per line: weight, Canada price, rest-of-world price (e.g. “8 oz  $9.50  $12.75”)." };
    }
    await db.$transaction([db.exportRate.deleteMany(), ...rows.map((r) => db.exportRate.create({ data: r }))]);
    const relabeled = await refreshLabelEstimates();
    return { rows: await db.exportRate.findMany({ orderBy: { maxOz: "asc" } }), relabeled };
  });
}
