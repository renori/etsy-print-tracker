import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { ORDER_STATUS, ORDER_STATUSES } from "../lib/constants.js";
import { rebuildQueue } from "../scheduler/queue.js";
import { boxForOrder } from "../lib/boxes.js";
import { moveStock } from "../lib/stock.js";
import { profit, refreshLabelEstimates } from "../lib/financials.js";
import { quoteContext } from "../lib/exportRate.js";
import { relinkOpenOrders } from "../lib/orderLines.js";

const partSchema = z.object({ partId: z.string(), quantity: z.number().int().positive() });
const create = z.object({
  etsyOrderId: z.string().min(1),
  buyerName: z.string().min(1),
  orderedAt: z.coerce.date(),
  shipTarget: z.coerce.date().nullable().optional(),
  etsyShipBy: z.coerce.date().nullable().optional(),
  itemsRaw: z.string(),
  status: z.enum(ORDER_STATUSES as [string, ...string[]]).default("NEEDS_PRINTING"),
  packageType: z.string().nullable().optional(),
  parts: z.array(partSchema).default([]),
});
const update = create.partial().extend({
  parts: z.array(partSchema).optional(),
  /** Link this order to a replacement it ships (null = unlink). */
  replacementId: z.string().nullable().optional(),
  packed: z.boolean().optional(),
  labelBought: z.boolean().optional(),
  readyBy: z.coerce.date().nullable().optional(),
  shippedAt: z.coerce.date().nullable().optional(),
  carrier: z.string().nullable().optional(),
  trackingNumber: z.string().nullable().optional(),
  orderTotal: z.number().nullable().optional(),
  etsyGross: z.number().nullable().optional(),
  salesTax: z.number().nullable().optional(),
  etsyFees: z.number().nullable().optional(),
  etsyEarnings: z.number().nullable().optional(),
  labelCost: z.number().nullable().optional(),
  shipWeightOz: z.number().positive().nullable().optional(),
  productionCost: z.number().nullable().optional(),
  laborMinutes: z.number().nullable().optional(),
  netProfit: z.number().nullable().optional(),
  margin: z.number().nullable().optional(),
});

type Quoter = Awaited<ReturnType<typeof quoteContext>>;
/** Adds the order's box, packed weight and (going abroad) its Simple Export Rate quote. */
const ORDER_INCLUDE = { parts: { include: { part: true } }, replacement: { select: { id: true, code: true, buyerName: true, shipped: true } } } as const;

function withBox<T extends Parameters<Quoter["quote"]>[0]>(order: T, ctx: Quoter) {
  return { ...order, boxName: boxForOrder(order), ...ctx.quote(order) };
}

export default async function orderRoutes(app: FastifyInstance) {
  app.get("/orders", async (req) => {
    const q = z.object({ status: z.string().optional() }).parse(req.query);
    const rows = await db.order.findMany({
      where: q.status ? { status: q.status } : undefined,
      include: ORDER_INCLUDE,
      orderBy: { orderedAt: "desc" },
    });
    const ctx = await quoteContext();
    return rows.map((o) => withBox(o, ctx));
  });

  app.get("/orders/:id", async (req) => {
    const { id } = req.params as { id: string };
    return withBox(await db.order.findUniqueOrThrow({ where: { id }, include: ORDER_INCLUDE }), await quoteContext());
  });

  app.post("/orders", async (req, reply) => {
    const { parts, ...rest } = create.parse(req.body);
    const row = await db.order.create({ data: { ...rest, parts: { create: parts } }, include: { parts: true } });
    await rebuildQueue();
    reply.code(201);
    return row;
  });

  app.put("/orders/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { parts: pickedParts, packed, labelBought, replacementId, ...rest } = update.parse(req.body);
    const existing = await db.order.findUniqueOrThrow({ where: { id }, include: { parts: true } });
    let parts = pickedParts;
    let link: { replacementId?: string | null; partsManual?: boolean } = {};

    if (replacementId !== undefined && replacementId !== existing.replacementId) {
      if (replacementId) {
        const r = await db.replacement.findUnique({ where: { id: replacementId }, include: { parts: true, order: { select: { id: true, etsyOrderId: true } } } });
        if (!r) return reply.code(404).send({ error: "That replacement no longer exists." });
        if (r.order && r.order.id !== id) return reply.code(409).send({ error: `${r.code} is already linked to Etsy order #${r.order.etsyOrderId}.` });
        // The order ships the replacement's parts (unless they're already off the shelf).
        if (!existing.packed && !parts) parts = r.parts.map((p) => ({ partId: p.partId, quantity: p.quantity }));
      }
      link = { replacementId };
    }
    if (parts && existing.packed) return reply.code(409).send({ error: "This order is already packed: un-pack it first to change its parts." });
    if (parts) link.partsManual = true;

    await db.$transaction(async (tx) => {
      if (parts) {
        await tx.orderPart.deleteMany({ where: { orderId: id } });
      }
      await tx.order.update({
        where: { id },
        data: {
          ...rest,
          ...link,
          ...(packed !== undefined ? { packed } : {}),
          ...(labelBought !== undefined && labelBought !== existing.labelBought ? { labelBought, labelBoughtAt: labelBought ? new Date() : null } : {}),
          ...(parts ? { parts: { create: parts } } : {}),
        },
      });

      if (packed !== undefined && packed !== existing.packed) await moveStock(tx, id, packed ? -1 : 1);
    });

    if (rest.labelCost !== undefined) {
      // Typed in = always kept; cleared = the next sync estimates it again.
      const o = await db.order.update({ where: { id }, data: { labelCostSource: rest.labelCost == null ? null : "manual", labelCostNote: null } });
      await db.order.update({ where: { id }, data: profit(o) });
    }
    if (rest.shipWeightOz !== undefined) await refreshLabelEstimates();
    await rebuildQueue();
    return withBox(await db.order.findUniqueOrThrow({ where: { id }, include: ORDER_INCLUDE }), await quoteContext());
  });

  /** Drop hand-picked parts and go back to whatever the Listing Map links. */
  app.post("/orders/:id/auto-parts", async (req, reply) => {
    const { id } = req.params as { id: string };
    const o = await db.order.findUniqueOrThrow({ where: { id } });
    if (o.packed) return reply.code(409).send({ error: "This order is already packed: un-pack it first to change its parts." });
    await db.$transaction([db.orderPart.deleteMany({ where: { orderId: id } }), db.order.update({ where: { id }, data: { partsManual: false } })]);
    await relinkOpenOrders();
    await rebuildQueue();
    return withBox(await db.order.findUniqueOrThrow({ where: { id }, include: ORDER_INCLUDE }), await quoteContext());
  });

  /** Pack (or un-pack) several orders at once; orders already in that state are skipped. */
  app.post("/orders/pack", async (req) => {
    const { ids, packed } = z.object({ ids: z.array(z.string()).min(1).max(500), packed: z.boolean().default(true) }).parse(req.body);
    const targets = await db.order.findMany({ where: { id: { in: ids }, packed: !packed, status: { not: ORDER_STATUS.SHIPPED } } });
    await db.$transaction(async (tx) => {
      for (const o of targets) {
        await tx.order.update({ where: { id: o.id }, data: { packed } });
        await moveStock(tx, o.id, packed ? -1 : 1);
      }
    });
    await rebuildQueue();
    return { changed: targets.length, skipped: ids.length - targets.length };
  });

  /** After a drop-off: mark orders shipped so they move to Completed Orders. */
  app.post("/orders/ship", async (req) => {
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(500) }).parse(req.body);
    const now = new Date();
    const { count } = await db.order.updateMany({
      where: { id: { in: ids }, status: { not: ORDER_STATUS.SHIPPED } },
      data: { status: ORDER_STATUS.SHIPPED },
    });
    await db.order.updateMany({ where: { id: { in: ids }, shippedAt: null }, data: { shippedAt: now } });
    await rebuildQueue();
    return { shipped: count };
  });

  app.delete("/orders/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.order.delete({ where: { id } });
    await rebuildQueue();
    reply.code(204);
  });
}
