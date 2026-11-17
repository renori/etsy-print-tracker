import { db } from "./db.js";
import { rebuildQueue } from "../scheduler/queue.js";

/**
 * Marks a replacement shipped and logs its expenses exactly as the sheet's
 * Replacements tab describes: a COGS line (part cost minus filament cost,
 * x qty) per part, and a shipping line for the label cost, each logged only
 * once. When it shipped as a linked Etsy order (viaOrder), the label stays
 * with that order instead.
 */
export async function shipReplacement(id: string, opts: { shippedAt?: Date; labelCost?: number; viaOrder?: string } = {}) {
  const shippedAt = opts.shippedAt ?? new Date();
    const replacement = await db.replacement.findUniqueOrThrow({ where: { id }, include: { parts: { include: { part: true } } } });

    await db.$transaction(async (tx) => {
      const data: Record<string, unknown> = { shipped: true, shippedAt };
      if (opts.labelCost !== undefined) data.labelCost = opts.labelCost;

      if (!replacement.cogsLoggedAt) {
        for (const p of replacement.parts) {
          const cogs = (p.part.cost - p.part.filamentCost) * p.quantity;
          await tx.expense.create({
            data: {
              date: shippedAt,
              item: `Replacement ${replacement.code} — ${p.part.name}`,
              category: "Parts",
              cost: cogs,
              taxYear: shippedAt.getFullYear(),
              scheduleCLine: "Part III COGS – materials",
              deductible: true,
              notes: `Auto-logged COGS for replacement ${replacement.code}`,
            },
          });
        }
        data.cogsLoggedAt = shippedAt;
      }

      const labelCost = opts.labelCost ?? replacement.labelCost;
      if (opts.viaOrder) {
        // The label was bought on the Etsy order: its cost already counts with that order
        // (Completed Orders, Tax Export), so it isn't logged again as an expense here.
        data.labelLoggedAt = shippedAt;
      } else if (labelCost && !replacement.labelLoggedAt) {
        await tx.expense.create({
          data: {
            date: shippedAt,
            item: `Replacement ${replacement.code} — label`,
            category: "Shipping",
            cost: labelCost,
            taxYear: shippedAt.getFullYear(),
            scheduleCLine: "Line 27a Other – shipping supplies & postage",
            deductible: true,
            notes: `Auto-logged label cost for replacement ${replacement.code}`,
          },
        });
        data.labelLoggedAt = shippedAt;
      }

      await tx.replacement.update({ where: { id }, data });
    });
}

let chain: Promise<unknown> = Promise.resolve();
/** Runs shipLinkedReplacements after any earlier run finishes (so one is never logged twice). Never throws. */
export function shipLinkedReplacementsSoon() {
  chain = chain.then(shipLinkedReplacements).catch((err) => console.error("[replacements] couldn't ship linked replacements:", err));
  return chain;
}

/**
 * Replacements whose linked Etsy order has shipped (packed here, completed on
 * Etsy, or marked shipped) are marked shipped too. Returns how many.
 */
export async function shipLinkedReplacements(): Promise<number> {
  const orders = await db.order.findMany({
    where: { status: "SHIPPED", replacementId: { not: null }, replacement: { shipped: false } },
    select: { replacementId: true, shippedAt: true, labelCost: true, etsyOrderId: true },
  });
  for (const o of orders) await shipReplacement(o.replacementId!, { shippedAt: o.shippedAt ?? new Date(), labelCost: o.labelCost ?? undefined, viaOrder: o.etsyOrderId });
  if (orders.length) await rebuildQueue();
  return orders.length;
}
