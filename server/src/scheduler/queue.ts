import { db } from "../lib/db.js";
import { ORDER_STATUS } from "../lib/constants.js";
import { packPlates, PartInfo, Recipe } from "./plates.js";
import { FixedPlate, schedulePlates } from "./schedule.js";
import { addMinutes } from "./time.js";

/**
 * Parts still needed across every unpacked open order + unshipped replacement,
 * keyed by partId. Packed orders are excluded: packing already took their parts
 * off the shelf count, so counting them again would schedule reprints.
 */
async function neededQuantities(): Promise<Map<string, number>> {
  const need = new Map<string, number>();
  const orders = await db.order.findMany({
    where: { status: { not: ORDER_STATUS.SHIPPED }, packed: false },
    include: { parts: true },
  });
  for (const o of orders) for (const p of o.parts) need.set(p.partId, (need.get(p.partId) ?? 0) + p.quantity);

  const replacements = await db.replacement.findMany({ where: { shipped: false }, include: { parts: true } });
  for (const r of replacements) for (const p of r.parts) need.set(p.partId, (need.get(p.partId) ?? 0) + p.quantity);

  return need;
}

/** On hand + needed + printing-now + still-to-print, per part — what the "Printed Stock" tab showed. */
export async function printedStockReport() {
  const parts = await db.part.findMany({ orderBy: { name: "asc" } });
  const needed = await neededQuantities();
  const printingNow = new Map<string, number>();
  const inFlight = await db.plateQueueEntry.findMany({ where: { started: true, done: false }, include: { parts: true } });
  for (const e of inFlight) for (const p of e.parts) printingNow.set(p.partId, (printingNow.get(p.partId) ?? 0) + p.quantity);

  return (
    parts
      .map((part) => {
        const need = needed.get(part.id) ?? 0;
        const printing = printingNow.get(part.id) ?? 0;
        const stillToPrint = Math.max(0, need - part.onHand - printing);
        return { part, onHand: part.onHand, needed: need, printingNow: printing, stillToPrint };
      })
      // An inactive part stays listed (and keeps printing) while an open order or plate still involves it.
      .filter((row) => row.part.active || row.needed > 0 || row.printingNow > 0)
  );
}

async function loadRecipes(): Promise<{ recipes: Recipe[]; parts: Map<string, PartInfo> }> {
  const recipeRows = await db.plateRecipe.findMany({ include: { parts: true } });
  // All parts, so an inactive part an order still needs gets its real print time.
  const partRows = await db.part.findMany();
  const parts = new Map(partRows.map((p) => [p.id, { id: p.id, name: p.name, printMinutes: p.printMinutes }]));
  const recipes: Recipe[] = recipeRows.map((r) => ({
    id: r.id,
    name: r.name,
    printerId: r.printerId,
    plateMinutes: r.plateMinutes,
    parts: r.parts.map((p) => ({ partId: p.partId, maxCount: p.maxCount })),
  }));
  return { recipes, parts };
}

/**
 * Recomputes the planned (not-yet-started) portion of the print queue from
 * scratch, leaving started/done plates untouched, and persists it.
 */
export async function rebuildQueue(now: Date = new Date()) {
  const stock = await printedStockReport();
  const demand = new Map<string, number>();
  for (const row of stock) if (row.stillToPrint > 0) demand.set(row.part.id, row.stillToPrint);

  const { recipes, parts } = await loadRecipes();
  const pending = packPlates(demand, recipes, parts);

  const printers = await db.printer.findMany({ where: { active: true } });
  const inFlight = await db.plateQueueEntry.findMany({ where: { started: true, done: false } });
  const fixed: FixedPlate[] = inFlight
    .filter((e) => e.printerId)
    .map((e) => ({
      id: e.id,
      printerId: e.printerId!,
      plannedFinish: addMinutes(e.startedAt ?? e.plannedStart, e.printMinutes),
    }));

  const settingsRow = await db.scheduleSettings.findUnique({ where: { id: 1 } });
  const settings = settingsRow ?? { morningStart: "07:30", morningWindowMinutes: 15, homeTime: "18:00", lastStart: "00:30" };
  const blackouts = await db.blackoutWindow.findMany();

  const scheduled = schedulePlates(
    pending,
    printers.map((p) => p.id),
    fixed,
    settings,
    blackouts,
    now
  );

  await db.$transaction(async (tx) => {
    await tx.plateQueueEntry.deleteMany({ where: { started: false } });
    for (const plate of scheduled) {
      await tx.plateQueueEntry.create({
        data: {
          printerId: plate.printerId,
          label: plate.label,
          plannedStart: plate.plannedStart,
          plannedFinish: plate.plannedFinish,
          printMinutes: plate.minutes,
          started: false,
          done: false,
          manualEntry: false,
          parts: { create: plate.parts.map((p) => ({ partId: p.partId, quantity: p.quantity })) },
        },
      });
    }
  });

  await recomputeOrderReadiness();

  return getQueue();
}

export async function getQueue() {
  return db.plateQueueEntry.findMany({
    where: { done: false },
    include: { parts: { include: { part: true } }, printer: true },
    orderBy: { plannedStart: "asc" },
  });
}

export async function markStarted(entryId: string, startedAt: Date = new Date()) {
  const entry = await db.plateQueueEntry.findUniqueOrThrow({ where: { id: entryId } });
  await db.plateQueueEntry.update({
    where: { id: entryId },
    data: {
      started: true,
      startedAt,
      plannedStart: startedAt,
      plannedFinish: addMinutes(startedAt, entry.printMinutes),
    },
  });
  return rebuildQueue();
}

export async function markDone(entryId: string, doneAt: Date = new Date()) {
  const entry = await db.plateQueueEntry.findUniqueOrThrow({ where: { id: entryId }, include: { parts: true } });
  await db.$transaction(async (tx) => {
    for (const p of entry.parts) {
      await tx.part.update({ where: { id: p.partId }, data: { onHand: { increment: p.quantity } } });
    }
    await tx.plateQueueEntry.update({ where: { id: entryId }, data: { done: true, doneAt } });
  });
  return rebuildQueue();
}

export interface LogPrintInput {
  startedAt?: Date;
  printerId?: string | null;
  printMinutes?: number;
  parts: { partId: string; quantity: number }[];
  forOrders?: string;
}

/** "Log a Print" — you already started a plate by hand; record it as started and replan around it. */
export async function logPrint(input: LogPrintInput) {
  const startedAt = input.startedAt ?? new Date();
  let printMinutes = input.printMinutes;
  if (printMinutes == null) {
    const parts = await db.part.findMany({ where: { id: { in: input.parts.map((p) => p.partId) } } });
    const byId = new Map(parts.map((p) => [p.id, p.printMinutes]));
    printMinutes = input.parts.reduce((s, p) => s + (byId.get(p.partId) ?? 0) * p.quantity, 0);
  }
  const label = input.parts.map((p) => `${p.quantity}×`).join(" + ");
  await db.plateQueueEntry.create({
    data: {
      printerId: input.printerId ?? null,
      label,
      plannedStart: startedAt,
      plannedFinish: addMinutes(startedAt, printMinutes),
      printMinutes,
      forOrders: input.forOrders,
      started: true,
      startedAt,
      manualEntry: true,
      parts: { create: input.parts },
    },
  });
  return rebuildQueue();
}

/**
 * Walks open orders oldest-first, reserving stock FIFO, flipping
 * NEEDS_PRINTING -> READY_FROM_STOCK as soon as enough is on hand. Never
 * moves an order backward or past READY_FROM_STOCK automatically.
 */
export async function recomputeOrderReadiness() {
  const parts = await db.part.findMany();
  const pool = new Map(parts.map((p) => [p.id, p.onHand]));
  const READY = [ORDER_STATUS.READY_FROM_STOCK, ORDER_STATUS.READY_LABEL_BOUGHT] as string[];

  // Packed orders already have their parts in the box (not in the pool), so they're left alone.
  const orders = await db.order.findMany({
    where: { packed: false, status: { in: [ORDER_STATUS.NEEDS_PRINTING, ...READY] } },
    include: { parts: true },
    orderBy: { orderedAt: "asc" },
  });

  for (const order of orders) {
    const canFulfill = order.parts.every((p) => (pool.get(p.partId) ?? 0) >= p.quantity);
    let next = order.status;
    if (canFulfill) {
      for (const p of order.parts) pool.set(p.partId, (pool.get(p.partId) ?? 0) - p.quantity);
      next = order.labelBought ? ORDER_STATUS.READY_LABEL_BOUGHT : ORDER_STATUS.READY_FROM_STOCK;
    } else if (READY.includes(order.status)) {
      next = ORDER_STATUS.NEEDS_PRINTING;
    }
    if (next !== order.status) await db.order.update({ where: { id: order.id }, data: { status: next } });
  }

  // Keep "Ready · label bought" / "Ready (from stock)" in step with the label flag on packed orders too.
  await db.order.updateMany({ where: { status: ORDER_STATUS.READY_FROM_STOCK, labelBought: true }, data: { status: ORDER_STATUS.READY_LABEL_BOUGHT } });
  await db.order.updateMany({ where: { status: ORDER_STATUS.READY_LABEL_BOUGHT, labelBought: false }, data: { status: ORDER_STATUS.READY_FROM_STOCK } });
}
