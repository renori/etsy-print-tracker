import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { rebuildQueue } from "../scheduler/queue.js";

const partSchema = z.object({ partId: z.string(), maxCount: z.number().int().positive() });
const create = z.object({
  name: z.string().nullable().optional(),
  printerId: z.string().nullable().optional(),
  plateMinutes: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  parts: z.array(partSchema).min(1),
});
const update = create.partial().extend({ parts: z.array(partSchema).optional() });

export default async function plateRecipeRoutes(app: FastifyInstance) {
  app.get("/plate-recipes", async () => db.plateRecipe.findMany({ include: { parts: { include: { part: true } }, printer: true } }));

  app.post("/plate-recipes", async (req, reply) => {
    const { parts, ...rest } = create.parse(req.body);
    const row = await db.plateRecipe.create({ data: { ...rest, parts: { create: parts } }, include: { parts: true } });
    await rebuildQueue();
    reply.code(201);
    return row;
  });

  app.put("/plate-recipes/:id", async (req) => {
    const { id } = req.params as { id: string };
    const { parts, ...rest } = update.parse(req.body);
    const row = await db.$transaction(async (tx) => {
      if (parts) {
        await tx.plateRecipePart.deleteMany({ where: { recipeId: id } });
      }
      return tx.plateRecipe.update({
        where: { id },
        data: { ...rest, ...(parts ? { parts: { create: parts } } : {}) },
        include: { parts: true },
      });
    });
    await rebuildQueue();
    return row;
  });

  app.delete("/plate-recipes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.plateRecipe.delete({ where: { id } });
    await rebuildQueue();
    reply.code(204);
  });
}
