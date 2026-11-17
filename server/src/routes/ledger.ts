import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { registerCrud } from "../lib/crud.js";

const create = z.object({
  etsyEntryId: z.string().min(1),
  createdAt: z.coerce.date(),
  ledgerType: z.string(),
  referenceType: z.string().nullable().optional(),
  referenceId: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  amount: z.number(),
  currency: z.string().default("USD"),
  balance: z.number().nullable().optional(),
  parentEntryId: z.string().nullable().optional(),
});
const update = create.partial();

export default async function ledgerRoutes(app: FastifyInstance) {
  registerCrud(app, "/ledger", db.etsyLedgerEntry, { create, update }, { orderBy: { createdAt: "desc" } });
}
