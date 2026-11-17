import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { relinkOpenOrders, unmappedSales } from "../lib/orderLines.js";
import { rebuildQueue } from "../scheduler/queue.js";

/** After any Listing Map change, re-link open orders and replan the queue. */
async function relink() {
  const relinked = await relinkOpenOrders();
  if (relinked) await rebuildQueue();
  return relinked;
}

const partSchema = z.object({ partId: z.string(), quantity: z.number().int().positive() });
const create = z.object({
  etsyListingId: z.string().min(1),
  listingTitle: z.string().min(1),
  variationContains: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  autoGuessed: z.boolean().default(false),
  parts: z.array(partSchema).default([]),
});
const update = create.partial().extend({ parts: z.array(partSchema).optional() });

/**
 * Picks which mapping row applies for a given listing + the buyer's chosen
 * variation text: first a row whose `variationContains` is found in the
 * variation text, else a row with a blank/any `variationContains`.
 */
export async function resolveListingParts(etsyListingId: string, variationText: string) {
  const rows = await db.listingMapping.findMany({ where: { etsyListingId }, include: { parts: true } });
  const haystack = variationText.toLowerCase();
  const specific = rows.find((r) => r.variationContains && haystack.includes(r.variationContains.toLowerCase()));
  const fallback = rows.find((r) => !r.variationContains);
  return specific ?? fallback ?? null;
}

export default async function listingMappingRoutes(app: FastifyInstance) {
  app.get("/listing-mappings", async () => db.listingMapping.findMany({ include: { parts: { include: { part: true } } } }));

  app.get("/listing-mappings/unmapped", async () => unmappedSales());

  app.get("/listing-mappings/resolve", async (req) => {
    const q = z.object({ etsyListingId: z.string(), variationText: z.string().default("") }).parse(req.query);
    return resolveListingParts(q.etsyListingId, q.variationText);
  });

  app.post("/listing-mappings", async (req, reply) => {
    const { parts, ...rest } = create.parse(req.body);
    const row = await db.listingMapping.create({ data: { ...rest, parts: { create: parts } }, include: { parts: true } });
    const relinked = await relink();
    reply.code(201);
    return { ...row, relinked };
  });

  app.put("/listing-mappings/:id", async (req) => {
    const { id } = req.params as { id: string };
    const { parts, ...rest } = update.parse(req.body);
    const row = await db.$transaction(async (tx) => {
      if (parts) await tx.listingPart.deleteMany({ where: { mappingId: id } });
      return tx.listingMapping.update({
        where: { id },
        data: { ...rest, ...(parts ? { parts: { create: parts } } : {}) },
        include: { parts: true },
      });
    });
    return { ...row, relinked: await relink() };
  });

  app.delete("/listing-mappings/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.listingMapping.delete({ where: { id } });
    await relink();
    reply.code(204);
  });
}
