import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { rebuildQueue } from "../scheduler/queue.js";
import { printedStockReport } from "../scheduler/queue.js";

const create = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  printMinutes: z.number(),
  filamentGrams: z.number(),
  filamentPricePerKg: z.number(),
  filamentCost: z.number(),
  electricityCost: z.number().default(0),
  depreciation: z.number().default(0),
  shippingBoxCost: z.number().default(0),
  bagCost: z.number().default(0),
  wrappingCost: z.number().default(0),
  hardwareCost: z.number().default(0),
  laborCost: z.number().default(0),
  touchTimeMinutes: z.number().default(0),
  cost: z.number(),
  listPrice: z.number().nullable().optional(),
  margin: z.number().nullable().optional(),
  packageType: z.string().nullable().optional(),
  shipWeightOz: z.number().positive().nullable().optional(),
  onHand: z.number().int().default(0),
  active: z.boolean().default(true),
});
const update = create.partial();

export default async function partRoutes(app: FastifyInstance) {
  app.get("/parts", async () => db.part.findMany({ orderBy: { name: "asc" } }));

  app.get("/parts/stock", async () => printedStockReport());

  app.get("/parts/:id", async (req) => {
    const { id } = req.params as { id: string };
    return db.part.findUniqueOrThrow({ where: { id } });
  });

  app.post("/parts", async (req, reply) => {
    const data = create.parse(req.body);
    const row = await db.part.create({ data });
    reply.code(201);
    return row;
  });

  app.put("/parts/:id", async (req) => {
    const { id } = req.params as { id: string };
    const data = update.parse(req.body);
    const row = await db.part.update({ where: { id }, data });
    // onHand or active changes affect what the queue needs to print.
    await rebuildQueue();
    return row;
  });

  app.delete("/parts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.part.delete({ where: { id } });
    await rebuildQueue();
    reply.code(204);
  });
}
