import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { rebuildQueue } from "../scheduler/queue.js";

const create = z.object({ name: z.string().min(1), active: z.boolean().default(true), notes: z.string().nullable().optional() });
const update = create.partial();

export default async function printerRoutes(app: FastifyInstance) {
  app.get("/printers", async () => db.printer.findMany({ orderBy: { name: "asc" } }));

  app.post("/printers", async (req, reply) => {
    const data = create.parse(req.body);
    const row = await db.printer.create({ data });
    await rebuildQueue();
    reply.code(201);
    return row;
  });

  app.put("/printers/:id", async (req) => {
    const { id } = req.params as { id: string };
    const data = update.parse(req.body);
    const row = await db.printer.update({ where: { id }, data });
    await rebuildQueue();
    return row;
  });

  app.delete("/printers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.printer.delete({ where: { id } });
    await rebuildQueue();
    reply.code(204);
  });
}
