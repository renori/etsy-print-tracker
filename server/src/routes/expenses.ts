import type { FastifyInstance } from "fastify";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../lib/db.js";
import { dateOnly } from "../lib/dates.js";
import { aiEnabled, extractExpenses } from "../lib/expenseExtract.js";
import { readReceiptsFree } from "../lib/receiptReader.js";

const fields = {
  date: dateOnly,
  item: z.string().min(1),
  vendor: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  cost: z.number(),
  // Blank = the year of the expense date.
  taxYear: z.number().int().nullable().optional(),
  scheduleCLine: z.string().nullable().optional(),
  deductible: z.boolean().default(true),
  paidWith: z.string().nullable().optional(),
  invoiceRef: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
};
const create = z.object(fields);
const update = create.partial();

const withYear = <T extends { date: Date; taxYear?: number | null }>(e: T) => ({ ...e, taxYear: e.taxYear ?? e.date.getFullYear() });

export default async function expenseRoutes(app: FastifyInstance) {
  app.get("/expenses", async () => db.expense.findMany({ orderBy: { date: "desc" } }));

  app.post("/expenses", async (req, reply) => {
    const row = await db.expense.create({ data: withYear(create.parse(req.body)) });
    reply.code(201);
    return row;
  });

  app.post("/expenses/bulk", async (req, reply) => {
    const { expenses } = z.object({ expenses: z.array(create).min(1).max(500) }).parse(req.body);
    const rows = await db.$transaction(expenses.map((e) => db.expense.create({ data: withYear(e) })));
    reply.code(201);
    return { created: rows.length };
  });

  app.put("/expenses/:id", async (req) => {
    const { id } = req.params as { id: string };
    const data = update.parse(req.body);
    const existing = await db.expense.findUniqueOrThrow({ where: { id } });
    const date = data.date ?? existing.date;
    return db.expense.update({ where: { id }, data: { ...data, taxYear: data.taxYear ?? date.getFullYear() } });
  });

  app.delete("/expenses/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.expense.delete({ where: { id } });
    reply.code(204);
  });

  app.get("/expenses/totals-by-schedule-c", async () => {
    const rows = await db.expense.findMany({ where: { deductible: true } });
    const totals = new Map<string, number>();
    for (const r of rows) {
      const key = r.scheduleCLine ?? "Unassigned";
      totals.set(key, (totals.get(key) ?? 0) + r.cost);
    }
    return Object.fromEntries(totals);
  });

  app.get("/expenses/ai-status", async () => ({ enabled: aiEnabled() }));

  app.post(
    "/expenses/extract",
    { bodyLimit: 40 * 1024 * 1024 },
    async (req, reply) => {
      const body = z
        .object({
          text: z.string().max(200_000).optional(),
          files: z.array(z.object({ mediaType: z.string(), data: z.string() })).max(20).optional(),
          // "ai" needs ANTHROPIC_API_KEY; default is AI when a key is set, else the free reader.
          reader: z.enum(["free", "ai"]).optional(),
        })
        .parse(req.body);
      const reader = body.reader ?? (aiEnabled() ? "ai" : "free");
      try {
        if (reader === "free") {
          return { reader, ...(await readReceiptsFree(body)) };
        }
        if (!aiEnabled()) {
          reply.code(400);
          return { error: "The AI reader needs ANTHROPIC_API_KEY set in docker-compose.yml." };
        }
        return { reader, expenses: await extractExpenses(body), warnings: [] };
      } catch (err) {
        req.log.error(err);
        if (err instanceof Anthropic.AuthenticationError) {
          reply.code(502);
          return { error: "The Anthropic API key was rejected — check ANTHROPIC_API_KEY." };
        }
        if (err instanceof Anthropic.RateLimitError) {
          reply.code(429);
          return { error: "Rate limited by the Anthropic API — try again in a minute." };
        }
        if (err instanceof Anthropic.APIError) {
          reply.code(502);
          return { error: `Anthropic API error ${err.status}: ${err.message}` };
        }
        reply.code(400);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }
  );
}
