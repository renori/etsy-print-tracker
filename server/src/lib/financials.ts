import { db } from "./db.js";
import { isDigitalOrder, loadMappings, parseLines } from "./orderLines.js";
import { boxForOrder, normBoxName } from "./boxes.js";

/**
 * Order money, worked out the way the old sheet did (checked against its
 * Completed Orders rows):
 *   gross     = the PAYMENT_GROSS ledger entry (what the buyer paid)
 *   tax       = sales_tax entries for the receipt
 *   fees      = every other fee/credit tied to the sale: transaction,
 *               shipping_transaction, PAYMENT_PROCESSING_FEE, offsite ads,
 *               renew_sold(_auto) for the sold listing, minus credits
 *   earnings  = gross − tax − fees
 *   net       = earnings − label − production
 *   margin    = net ÷ (earnings − label)
 */

export interface SaleRefs {
  receiptId: string;
  transactionIds: string[];
  paymentIds: string[];
  shipmentIds: string[];
  listingIds: string[];
  /** Receipt total in dollars, used to find the payment when the payments API isn't available. */
  grandTotal?: number;
}

const round = (n: number) => Math.round(n * 100) / 100;
const minutes = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 60_000;

export async function productionFor(orderId: string) {
  const parts = await db.orderPart.findMany({ where: { orderId }, include: { part: true } });
  return {
    productionCost: round(parts.reduce((s, p) => s + p.part.cost * p.quantity, 0)),
    laborMinutes: parts.reduce((s, p) => s + p.part.touchTimeMinutes * p.quantity, 0),
  };
}

export function profit(o: { etsyEarnings: number | null; labelCost: number | null; productionCost: number | null }) {
  if (o.etsyEarnings == null) return { netProfit: null, margin: null };
  const label = o.labelCost ?? 0;
  const net = round(o.etsyEarnings - label - (o.productionCost ?? 0));
  const base = o.etsyEarnings - label;
  return { netProfit: net, margin: base > 0 ? Math.round((net / base) * 1000) / 1000 : null };
}

/** Works out and stores one order's money from the synced Etsy ledger. Returns false if the ledger has nothing for it yet. */
export async function applyFinancials(orderId: string, refs: SaleRefs): Promise<boolean> {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });

  const byReceipt = await db.etsyLedgerEntry.findMany({ where: { referenceId: refs.receiptId } });
  let payments = refs.paymentIds.length ? await db.etsyLedgerEntry.findMany({ where: { referenceId: { in: refs.paymentIds } } }) : [];

  // No payment id from Etsy? The PAYMENT_GROSS for this sale posts in the same minute as the receipt's own entries.
  if (!payments.some((e) => e.ledgerType === "PAYMENT_GROSS") && byReceipt.length) {
    const t = byReceipt[0].createdAt;
    const gross = (await db.etsyLedgerEntry.findMany({ where: { ledgerType: "PAYMENT_GROSS", createdAt: { gte: new Date(t.getTime() - 180_000), lte: new Date(t.getTime() + 180_000) } } }))
      .filter((e) => refs.grandTotal == null || Math.abs(e.amount - refs.grandTotal) < 0.01);
    if (gross.length === 1 && gross[0].referenceId) {
      payments = await db.etsyLedgerEntry.findMany({ where: { referenceId: gross[0].referenceId } });
    }
  }
  const grossEntry = payments.find((e) => e.ledgerType === "PAYMENT_GROSS");
  if (!grossEntry && !byReceipt.length) return false;
  const saleTime = grossEntry?.createdAt ?? byReceipt[0].createdAt;

  const transactions = refs.transactionIds.length
    ? await db.etsyLedgerEntry.findMany({ where: { referenceId: { in: refs.transactionIds }, ledgerType: { startsWith: "transaction" } } })
    : [];
  const renewals = refs.listingIds.length
    ? (await db.etsyLedgerEntry.findMany({ where: { referenceId: { in: refs.listingIds }, ledgerType: { startsWith: "renew_sold" } } })).filter(
        (e) => minutes(e.createdAt, saleTime) <= 3
      )
    : [];

  const all = [...new Map([...byReceipt, ...payments, ...transactions, ...renewals].map((e) => [e.etsyEntryId, e])).values()];
  const gross = grossEntry?.amount ?? order.orderTotal ?? 0;
  const tax = -all.filter((e) => e.ledgerType === "sales_tax").reduce((s, e) => s + e.amount, 0);
  const fees = -all
    .filter((e) => !["PAYMENT_GROSS", "sales_tax", "shipping_labels"].includes(e.ledgerType) && !e.ledgerType.startsWith("DISBURSE"))
    .reduce((s, e) => s + e.amount, 0);
  const earnings = round(gross - tax - fees);

  const label = await labelFor(order, refs);
  const labelCost = label?.cost ?? order.labelCost;
  const labelCostSource = label?.source ?? order.labelCostSource;

  const prod = await productionFor(orderId);
  const data = {
    etsyGross: round(gross),
    salesTax: round(tax),
    etsyFees: round(fees),
    etsyEarnings: earnings,
    labelCost,
    labelCostSource,
    ...prod,
  };
  await db.order.update({ where: { id: orderId }, data: { ...data, ...profit(data) } });
  return true;
}

/** Refs we can build without calling Etsy (used when the API call fails). */
export function refsFromStoredLines(o: { etsyOrderId: string; etsyLines: string | null; orderTotal: number | null }): SaleRefs {
  const lines = parseLines(o.etsyLines);
  return {
    receiptId: o.etsyOrderId,
    transactionIds: lines.map((l) => l.transactionId).filter((x): x is string => !!x),
    paymentIds: [],
    shipmentIds: [],
    listingIds: [...new Set(lines.map((l) => l.listingId))],
    grandTotal: o.orderTotal ?? undefined,
  };
}

// ---------- label cost ----------

type OrderRow = Awaited<ReturnType<typeof db.order.findUniqueOrThrow>>;
const WINDOW = 15 * 60_000;
const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? round(v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
};

/**
 * Typical label cost per box size, from orders whose label cost is known
 * (ledger-matched, typed in, or imported from the sheet). "*" = all boxes.
 */
export async function labelCostByBox(): Promise<Map<string, { cost: number; n: number }>> {
  const known = await db.order.findMany({
    where: { digital: false, labelCost: { not: null, gt: 0 }, OR: [{ labelCostSource: null }, { labelCostSource: { in: ["etsy", "manual", "batch"] } }] },
    include: { parts: { include: { part: true } } },
    orderBy: { orderedAt: "desc" },
    take: 500,
  });
  const groups = new Map<string, number[]>();
  for (const o of known) {
    const box = boxForOrder(o);
    for (const k of [box ? normBoxName(box) : null, "*"]) {
      if (!k) continue;
      groups.set(k, [...(groups.get(k) ?? []), o.labelCost!]);
    }
  }
  return new Map([...groups].map(([k, xs]) => [k, { cost: median(xs)!, n: xs.length }]));
}

async function estimateFor(orderId: string, byBox?: Map<string, { cost: number; n: number }>) {
  const table = byBox ?? (await labelCostByBox());
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { parts: { include: { part: true } } } });
  const box = boxForOrder(o);
  return (box && table.get(normBoxName(box))) || table.get("*") || null;
}

/**
 * Best available label cost for an order, most exact first:
 *  1. "etsy"     the ledger label whose id is the receipt's shipment id
 *  2. "batch"    labels bought together: if a batch of N label entries lines up with N
 *                orders whose tracking appeared in the same 15-minute window, pair them
 *                cheapest-expected to cheapest (the batch total is exact)
 *  3. "estimate" the median label cost of past orders in the same box size
 * A cost typed by hand ("manual") is never replaced.
 */
async function labelFor(order: OrderRow, refs: SaleRefs): Promise<{ cost: number; source: string } | null> {
  if (order.labelCostSource === "manual") return null;
  if (order.labelCostSource == null && order.labelCost != null) return null; // imported from the sheet
  if (order.digital) return { cost: 0, source: "digital" }; // downloads have no label

  if (refs.shipmentIds.length) {
    const direct = await db.etsyLedgerEntry.findMany({ where: { ledgerType: "shipping_labels", referenceId: { in: refs.shipmentIds } } });
    if (direct.length) return { cost: round(-direct.reduce((s, e) => s + e.amount, 0)), source: "etsy" };
  }

  if (order.labelBoughtAt) {
    const t = order.labelBoughtAt.getTime();
    const window = { gte: new Date(t - WINDOW), lte: new Date(t + WINDOW) };
    const labels = await db.etsyLedgerEntry.findMany({ where: { ledgerType: "shipping_labels", createdAt: window }, orderBy: [{ amount: "desc" }, { etsyEntryId: "asc" }] });
    const batch = await db.order.findMany({ where: { labelBoughtAt: window, digital: false }, orderBy: { id: "asc" } });
    if (labels.length && labels.length === batch.length) {
      const table = await labelCostByBox();
      const expected = await Promise.all(batch.map(async (o) => ({ id: o.id, est: (await estimateFor(o.id, table))?.cost ?? 0 })));
      expected.sort((a, b) => a.est - b.est || a.id.localeCompare(b.id));
      const costs = labels.map((e) => round(-e.amount)).sort((a, b) => a - b);
      const i = expected.findIndex((x) => x.id === order.id);
      if (i >= 0) return { cost: costs[i], source: costs.every((c) => c === costs[0]) ? "etsy" : "batch" };
    }
    // Counts don't line up (e.g. another label in the window), but if every label then cost the same, so did this one.
    const costs = labels.map((e) => round(-e.amount));
    if (costs.length && costs.every((c) => c === costs[0])) return { cost: costs[0], source: "batch" };
  }

  const est = await estimateFor(order.id);
  return est ? { cost: est.cost, source: "estimate" } : null;
}

/** Fills in an estimate for shipped orders that have no label cost at all (no ledger data needed). */
export async function estimateMissingLabels(): Promise<number> {
  const missing = await db.order.findMany({ where: { status: "SHIPPED", labelCost: null, digital: false } });
  if (!missing.length) return 0;
  const table = await labelCostByBox();
  let n = 0;
  for (const o of missing) {
    const est = await estimateFor(o.id, table);
    if (!est) continue;
    const data = { labelCost: est.cost, labelCostSource: "estimate" };
    await db.order.update({ where: { id: o.id }, data: { ...data, ...profit({ ...o, ...data }) } });
    n++;
  }
  return n;
}

/**
 * Flags orders whose items are all digital downloads: label cost $0 (unless
 * typed in or imported), and an open one is completed, since Etsy delivers it.
 */
export async function markDigitalOrders(): Promise<number> {
  const mappings = await loadMappings();
  const orders = await db.order.findMany({ where: { digital: false, etsyLines: { not: null } } });
  let n = 0;
  for (const o of orders) {
    if (!isDigitalOrder(parseLines(o.etsyLines), mappings, o.trackingNumber)) continue;
    const keepLabel = o.labelCostSource === "manual" || (o.labelCostSource == null && o.labelCost != null);
    const label = keepLabel ? {} : { labelCost: 0, labelCostSource: "digital" };
    const done = o.status === "SHIPPED" ? {} : { status: "SHIPPED", packed: true, shippedAt: o.orderedAt };
    const next = { ...o, ...label };
    await db.order.update({
      where: { id: o.id },
      data: { digital: true, labelBought: false, labelBoughtAt: null, ...label, ...done, ...profit(next) },
    });
    n++;
  }
  return n;
}
