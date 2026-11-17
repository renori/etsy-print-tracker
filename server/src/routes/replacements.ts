import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { shipReplacement } from "../lib/replacements.js";
import { rebuildQueue } from "../scheduler/queue.js";

const partSchema = z.object({ partId: z.string(), quantity: z.number().int().positive() });
const create = z.object({
  code: z.string().min(1),
  originalOrderId: z.string().nullable().optional(),
  buyerName: z.string().min(1),
  requestedAt: z.coerce.date(),
  shipByTarget: z.coerce.date().nullable().optional(),
  notes: z.string().nullable().optional(),
  labelCost: z.number().nullable().optional(),
  parts: z.array(partSchema).min(1),
});
const update = create.partial().extend({ parts: z.array(partSchema).optional() });

export default async function replacementRoutes(app: FastifyInstance) {
  app.get("/replacements", async () => db.replacement.findMany({ include: { parts: { include: { part: true } }, order: { select: { id: true, etsyOrderId: true, status: true } } } }));

  app.post("/replacements", async (req, reply) => {
    const { parts, ...rest } = create.parse(req.body);
    const row = await db.replacement.create({ data: { ...rest, parts: { create: parts } }, include: { parts: true } });
    await rebuildQueue();
    reply.code(201);
    return row;
  });

  app.put("/replacements/:id", async (req) => {
    const { id } = req.params as { id: string };
    const { parts, ...rest } = update.parse(req.body);
    const row = await db.$transaction(async (tx) => {
      if (parts) await tx.replacementPart.deleteMany({ where: { replacementId: id } });
      return tx.replacement.update({
        where: { id },
        data: { ...rest, ...(parts ? { parts: { create: parts } } : {}) },
        include: { parts: true },
      });
    });
    await rebuildQueue();
    return row;
  });

  /**
   * Marks a replacement shipped and logs its expenses exactly as the sheet's
   * Replacements tab describes: a COGS line (part cost minus filament cost,
   * × qty) per part, and a shipping line for the label cost — each logged
   * only once (clear *LoggedAt to let it log again).
   */
  app.post("/replacements/:id/ship", async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ shippedAt: z.coerce.date().optional(), labelCost: z.number().optional() }).parse(req.body ?? {});
    const shippedAt = body.shippedAt ?? new Date();

    await shipReplacement(id, { shippedAt, labelCost: body.labelCost });

    await rebuildQueue();
    return db.replacement.findUniqueOrThrow({ where: { id }, include: { parts: { include: { part: true } }, order: { select: { id: true, etsyOrderId: true, status: true } } } });
  });

  app.delete("/replacements/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.replacement.delete({ where: { id } });
    await rebuildQueue();
    reply.code(204);
  });
}
