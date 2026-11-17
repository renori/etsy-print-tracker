import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { rebuildQueue } from "../scheduler/queue.js";

const create = z.object({
  daysPattern: z.string().min(1),
  fromTime: z.string().nullable().optional(),
  toTime: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});
const update = create.partial();

const settingsSchema = z.object({
  morningStart: z.string(),
  morningWindowMinutes: z.number().int(),
  homeTime: z.string(),
  lastStart: z.string(),
  changeoverMinutes: z.number().int().optional(),
  homeOnWeekends: z.boolean().optional(),
  weekendStart: z.string().optional(),
  postOfficeDays: z.string().optional(),
  postOfficeTime: z.string().optional(),
  shipWithinDays: z.number().int().optional(),
});

export default async function blackoutRoutes(app: FastifyInstance) {
  app.get("/blackout-windows", async () => db.blackoutWindow.findMany());

  app.post("/blackout-windows", async (req, reply) => {
    const data = create.parse(req.body);
    const row = await db.blackoutWindow.create({ data });
    await rebuildQueue();
    reply.code(201);
    return row;
  });

  app.put("/blackout-windows/:id", async (req) => {
    const { id } = req.params as { id: string };
    const data = update.parse(req.body);
    const row = await db.blackoutWindow.update({ where: { id }, data });
    await rebuildQueue();
    return row;
  });

  app.delete("/blackout-windows/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.blackoutWindow.delete({ where: { id } });
    await rebuildQueue();
    reply.code(204);
  });

  app.get("/schedule-settings", async () => {
    const row = await db.scheduleSettings.findUnique({ where: { id: 1 } });
    return (
      row ??
      db.scheduleSettings.create({
        data: { id: 1, morningStart: "07:30", morningWindowMinutes: 15, homeTime: "18:00", lastStart: "00:30" },
      })
    );
  });

  app.put("/schedule-settings", async (req) => {
    const data = settingsSchema.parse(req.body);
    const row = await db.scheduleSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await rebuildQueue();
    return row;
  });
}
