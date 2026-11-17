import type { FastifyInstance } from "fastify";
import { db } from "../lib/db.js";
import { ORDER_STATUS } from "../lib/constants.js";
import { boxForOrder, normBoxName } from "../lib/boxes.js";
import { printedStockReport } from "../scheduler/queue.js";
import { isEtsyConnected } from "../etsy/client.js";
import { unmappedSales } from "../lib/orderLines.js";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function totals(orders: { etsyGross: number | null; netProfit: number | null }[]) {
  return {
    count: orders.length,
    gross: orders.reduce((s, o) => s + (o.etsyGross ?? 0), 0),
    net: orders.reduce((s, o) => s + (o.netProfit ?? 0), 0),
  };
}

/** Everything the home dashboard shows, in one request. */
export default async function summaryRoutes(app: FastifyInstance) {
  app.get("/summary", async () => {
    const now = new Date();
    const today = startOfDay(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const [queue, orders, boxes, stock, expenses, trips, replacements, etsyConnected, lastLedger, unmapped] = await Promise.all([
      db.plateQueueEntry.findMany({ where: { done: false }, include: { printer: true }, orderBy: { plannedStart: "asc" } }),
      db.order.findMany({ include: { parts: { include: { part: true } } } }),
      db.box.findMany(),
      printedStockReport(),
      db.expense.findMany({ where: { date: { gte: lastMonthStart < yearStart ? lastMonthStart : yearStart } } }),
      db.mileageEntry.findMany({ where: { date: { gte: yearStart } } }),
      db.replacement.count({ where: { shipped: false } }),
      isEtsyConnected(),
      db.etsyLedgerEntry.findFirst({ orderBy: { createdAt: "desc" } }),
      unmappedSales(),
    ]);

    // ---- printers ----
    const printing = queue
      .filter((q) => q.started)
      .map((q) => ({
        id: q.id,
        label: q.label,
        printer: q.printer?.name ?? null,
        finishAt: q.plannedFinish,
        minutesLeft: Math.round((q.plannedFinish.getTime() - now.getTime()) / 60_000),
      }));
    const upNext = queue
      .filter((q) => !q.started)
      .slice(0, 3)
      .map((q) => ({ id: q.id, label: q.label, printer: q.printer?.name ?? null, startAt: q.plannedStart, minutes: q.printMinutes }));
    const queuedMinutes = queue.filter((q) => !q.started).reduce((s, q) => s + q.printMinutes, 0);

    // ---- orders ----
    const open = orders.filter((o) => o.status !== ORDER_STATUS.SHIPPED);
    const unpacked = open.filter((o) => !o.packed);
    const due = (o: (typeof open)[number]) => o.etsyShipBy ?? o.shipTarget;
    const shipSoon = unpacked
      .filter((o) => due(o) && due(o)! < addDays(today, 3))
      .sort((a, b) => due(a)!.getTime() - due(b)!.getTime())
      .slice(0, 6)
      .map((o) => {
        const d = startOfDay(due(o)!);
        return {
          id: o.id,
          etsyOrderId: o.etsyOrderId,
          buyerName: o.buyerName,
          dueAt: d,
          urgency: d < today ? "overdue" : d.getTime() === today.getTime() ? "today" : d.getTime() === addDays(today, 1).getTime() ? "tomorrow" : "soon",
          ready: o.status === ORDER_STATUS.READY_FROM_STOCK || o.status === ORDER_STATUS.READY_LABEL_BOUGHT,
        };
      });

    // ---- boxes: what the unpacked orders need vs what's on the shelf ----
    const needByBox = new Map<string, { name: string; need: number }>();
    for (const o of unpacked) {
      const b = boxForOrder(o);
      if (!b) continue;
      const k = normBoxName(b);
      needByBox.set(k, { name: b, need: (needByBox.get(k)?.need ?? 0) + 1 });
    }
    const boxAlerts = boxes
      .map((b) => {
        const need = needByBox.get(normBoxName(b.name))?.need ?? 0;
        return { name: b.name, onHand: b.onHand, need, reorderAt: b.reorderAt, short: need > b.onHand, low: b.reorderAt != null && b.onHand <= b.reorderAt };
      })
      .filter((b) => b.short || b.low);

    // ---- money ----
    const shipped = orders.filter((o) => o.status === ORDER_STATUS.SHIPPED && o.shippedAt);
    const inRange = (d: Date | null, from: Date, to?: Date) => !!d && d >= from && (!to || d < to);
    const exp = (from: Date, to?: Date) => expenses.filter((e) => inRange(e.date, from, to)).reduce((s, e) => s + e.cost, 0);
    const miles = trips.reduce((s, t) => s + t.miles, 0);

    return {
      generatedAt: now,
      printers: { printing, upNext, queuedMinutes },
      orders: {
        open: open.length,
        needsPrinting: open.filter((o) => o.status === ORDER_STATUS.NEEDS_PRINTING || o.status === ORDER_STATUS.PRINTING).length,
        readyToPack: unpacked.filter((o) => o.status === ORDER_STATUS.READY_FROM_STOCK || o.status === ORDER_STATUS.READY_LABEL_BOUGHT).length,
        packed: open.filter((o) => o.packed).length,
        handled: open.filter((o) => o.packed && o.labelBought).length,
        replacementsOpen: replacements,
        unlinked: new Set(unmapped.flatMap((g) => g.orders.filter((o) => !o.packed && !o.linked).map((o) => o.id))).size,
        shipSoon,
      },
      stock: {
        toPrint: stock.filter((s) => s.stillToPrint > 0).map((s) => ({ name: s.part.name, count: s.stillToPrint })),
        boxAlerts,
      },
      money: {
        thisMonth: { ...totals(shipped.filter((o) => inRange(o.shippedAt, monthStart))), expenses: exp(monthStart) },
        lastMonth: { ...totals(shipped.filter((o) => inRange(o.shippedAt, lastMonthStart, monthStart))), expenses: exp(lastMonthStart, monthStart) },
        yearToDate: {
          ...totals(shipped.filter((o) => inRange(o.shippedAt, yearStart))),
          expenses: exp(yearStart),
          miles,
          mileageDeduction: trips.reduce((s, t) => s + t.miles * t.ratePerMile, 0),
        },
      },
      recentShipped: shipped
        .sort((a, b) => b.shippedAt!.getTime() - a.shippedAt!.getTime())
        .slice(0, 5)
        .map((o) => ({ id: o.id, etsyOrderId: o.etsyOrderId, buyerName: o.buyerName, shippedAt: o.shippedAt, net: o.netProfit, items: o.itemsRaw })),
      etsy: { connected: etsyConnected, lastLedgerAt: lastLedger?.createdAt ?? null },
    };
  });
}
