import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { registerCrud } from "../lib/crud.js";

const create = z.object({
  name: z.string().min(1),
  onHand: z.number().int().default(0),
  reorderAt: z.number().int().nullable().optional(),
  costEach: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});
const update = create.partial();

export default async function boxRoutes(app: FastifyInstance) {
  registerCrud(app, "/boxes", db.box, { create, update }, { orderBy: { name: "asc" } });
}
