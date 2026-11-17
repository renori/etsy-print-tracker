import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { ORDER_STATUS, ORDER_STATUSES } from "../lib/constants.js";
import { rebuildQueue } from "../scheduler/queue.js";
import { boxForOrder } from "../lib/boxes.js";
import { moveStock } from "../lib/stock.js";
import { profit } from "../lib/financials.js";

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
  productionCost: z.number().nullable().optional(),
  laborMinutes: z.number().nullable().optional(),
  netProfit: z.number().nullable().optional(),
  margin: z.number().nullable().optional(),
});

function withBox<T extends Parameters<typeof boxForOrder>[0]>(order: T) {
  return { ...order, boxName: boxForOrder(order) };
}

export default async function orderRoutes(app: FastifyInstance) {
  app.get("/orders", async (req) => {
    const q = z.object({ status: z.string().optional() }).parse(req.query);
    const rows = await db.order.findMany({
      where: q.status ? { status: q.status } : undefined,
      include: { parts: { include: { part: true } } },
      orderBy: { orderedAt: "desc" },
    });
    return rows.map(withBox);
  });

  app.get("/orders/:id", async (req) => {
    const { id } = req.params as { id: string };
    return withBox(await db.order.findUniqueOrThrow({ where: { id }, include: { parts: { include: { part: true } } } }));
  });

  app.post("/orders", async (req, reply) => {
    const { parts, ...rest } = create.parse(req.body);
    const row = await db.order.create({ data: { ...rest, parts: { create: parts } }, include: { parts: true } });
    await rebuildQueue();
    reply.code(201);
    return row;
  });

  app.put("/orders/:id", async (req) => {
    const { id } = req.params as { id: string };
    const { parts, packed, labelBought, ...rest } = update.parse(req.body);
    const existing = await db.order.findUniqueOrThrow({ where: { id }, include: { parts: true } });

    await db.$transaction(async (tx) => {
      if (parts) {
        await tx.orderPart.deleteMany({ where: { orderId: id } });
      }
      await tx.order.update({
        where: { id },
        data: {
          ...rest,
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
    await rebuildQueue();
    return withBox(await db.order.findUniqueOrThrow({ where: { id }, include: { parts: { include: { part: true } } } }));
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
