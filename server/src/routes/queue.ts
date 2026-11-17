import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getQueue, logPrint, markDone, markStarted, rebuildQueue } from "../scheduler/queue.js";

const logPrintSchema = z.object({
  startedAt: z.coerce.date().optional(),
  printerId: z.string().nullable().optional(),
  printMinutes: z.number().optional(),
  forOrders: z.string().optional(),
  parts: z.array(z.object({ partId: z.string(), quantity: z.number().int().positive() })).min(1),
});

export default async function queueRoutes(app: FastifyInstance) {
  app.get("/queue", async () => getQueue());

  app.post("/queue/rebuild", async () => rebuildQueue());

  app.post("/queue/:id/start", async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ startedAt: z.coerce.date().optional() }).parse(req.body ?? {});
    return markStarted(id, body.startedAt);
  });

  app.post("/queue/:id/done", async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ doneAt: z.coerce.date().optional() }).parse(req.body ?? {});
    return markDone(id, body.doneAt);
  });

  app.post("/queue/log-print", async (req, reply) => {
    const data = logPrintSchema.parse(req.body);
    const result = await logPrint(data);
    reply.code(201);
    return result;
  });
}
