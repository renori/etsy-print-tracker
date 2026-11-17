import cron from "node-cron";
import { db } from "../lib/db.js";
import { etsyGet, isEtsyConnected } from "./client.js";
import { loadMappings, parseLines, relinkOpenOrders, resolveLines, type OrderLine } from "../lib/orderLines.js";
import { applyFinancials, estimateMissingLabels, markDigitalOrders, refsFromStoredLines, type SaleRefs } from "../lib/financials.js";
import { rebuildQueue } from "../scheduler/queue.js";
import { ORDER_STATUS } from "../lib/constants.js";
import { moveStock } from "../lib/stock.js";

// NOTE: field names below follow Etsy's Open API v3 ("Receipts" / "Ledger
// Entries") shape as documented at https://developer.etsy.com/documentation/reference
// at the time this was written. Etsy does revise field names occasionally —
// if a sync run logs "undefined" fields, check a live response against the
// current docs and adjust the mapping here.

interface EtsyMoney {
  amount: number;
  divisor: number;
  currency_code: string;
}

interface EtsyTransaction {
  transaction_id: number;
  listing_id: number;
  title: string;
  quantity: number;
  is_digital?: boolean;
  variations?: { formatted_name: string; formatted_value: string }[];
}

interface EtsyShipment {
  receipt_shipping_id?: number;
  shipment_notification_timestamp?: number;
  carrier_name?: string;
  tracking_code?: string;
}

interface EtsyReceipt {
  receipt_id: number;
  name: string; // buyer name
  create_timestamp: number;
  expected_ship_date?: number;
  is_shipped: boolean;
  /** e.g. "Paid", "Completed", "Canceled", "Fully Refunded" (casing varies). */
  status?: string;
  shipments?: EtsyShipment[];
  grandtotal: EtsyMoney;
  total_tax_cost: EtsyMoney;
  total_shipping_cost: EtsyMoney;
  transactions: EtsyTransaction[];
}

interface EtsyLedgerEntryApi {
  entry_id: number;
  create_date?: number | string;
  created_timestamp?: number;
  ledger_type: string;
  reference_type?: string | null;
  reference_id?: string | number | null;
  description?: string;
  amount: number; // minor units
  currency: string;
  balance?: number;
}

function money(m: EtsyMoney): number {
  return m.amount / m.divisor;
}

// Etsy returns ledger times as Unix seconds; tolerate an ISO string too.
function ledgerDate(entry: EtsyLedgerEntryApi): Date {
  const raw = entry.created_timestamp ?? entry.create_date;
  if (typeof raw === "number") return new Date(raw * 1000);
  return raw ? new Date(raw) : new Date();
}

/**
 * A label counts as bought once the receipt has a shipment with tracking —
 * true for Etsy labels and for outside labels (e.g. Pirate Ship) whose
 * tracking is synced back to Etsy.
 */
function labelInfo(r: EtsyReceipt) {
  const withTracking = (r.shipments ?? []).filter((s) => s.tracking_code);
  const latest = withTracking.sort((a, b) => (b.shipment_notification_timestamp ?? 0) - (a.shipment_notification_timestamp ?? 0))[0];
  if (!latest && !r.is_shipped) return null;
  return {
    labelBought: true,
    labelBoughtAt: latest?.shipment_notification_timestamp ? new Date(latest.shipment_notification_timestamp * 1000) : new Date(),
    carrier: latest?.carrier_name ?? null,
    trackingNumber: latest?.tracking_code ?? null,
  };
}

function linesOf(r: EtsyReceipt): OrderLine[] {
  return (r.transactions ?? []).map((t) => ({
    listingId: String(t.listing_id),
    transactionId: String(t.transaction_id),
    title: t.title,
    quantity: t.quantity,
    variations: (t.variations ?? []).map((v) => ({ name: v.formatted_name, value: v.formatted_value })),
    ...(typeof t.is_digital === "boolean" ? { digital: t.is_digital } : {}),
  }));
}

/** Stored lines from before Etsy's digital flag was kept. */
function linesNeedRefresh(json: string | null) {
  return !json || parseLines(json).some((l) => l.digital === undefined);
}

export async function syncReceipts() {
  const shopId = process.env.ETSY_SHOP_ID;
  if (!shopId) throw new Error("ETSY_SHOP_ID is not set");

  const { results } = await etsyGet<{ results: EtsyReceipt[] }>(`/shops/${shopId}/receipts`, {
    limit: 100,
    was_shipped: "false",
  });

  const mappings = await loadMappings();
  for (const receipt of results) {
    const etsyOrderId = String(receipt.receipt_id);
    const existing = await db.order.findUnique({ where: { etsyOrderId } });
    if (existing) continue; // don't clobber manual status/packing progress on re-sync

    const lines = linesOf(receipt);
    const { parts } = resolveLines(lines, mappings);
    const itemLines = lines.map((l) => `${l.quantity}× ${l.title}${l.variations.length ? "\n     " + l.variations.map((v) => `${v.name}: ${v.value}`).join(", ") : ""}`);

    await db.order.create({
      data: {
        etsyOrderId,
        buyerName: receipt.name,
        orderedAt: new Date(receipt.create_timestamp * 1000),
        etsyShipBy: receipt.expected_ship_date ? new Date(receipt.expected_ship_date * 1000) : null,
        itemsRaw: itemLines.join("\n"),
        etsyLines: JSON.stringify(lines),
        status: ORDER_STATUS.NEEDS_PRINTING,
        orderTotal: money(receipt.grandtotal),
        salesTax: money(receipt.total_tax_cost),
        ...(labelInfo(receipt) ?? {}),
        parts: { create: parts },
      },
    });
  }

  await rebuildQueue();
  return { fetched: results.length };
}

export async function syncLedger() {
  const shopId = process.env.ETSY_SHOP_ID;
  if (!shopId) throw new Error("ETSY_SHOP_ID is not set");

  // Etsy requires a created-time window. Resume a day before the newest entry
  // we already have (overlap is harmless: upsert by entry id), else go back a year.
  const newest = await db.etsyLedgerEntry.findFirst({ orderBy: { createdAt: "desc" } });
  const minCreated = newest
    ? Math.floor(newest.createdAt.getTime() / 1000) - 86_400
    : Math.floor(Date.now() / 1000) - 365 * 86_400;
  const maxCreated = Math.floor(Date.now() / 1000);

  const results: EtsyLedgerEntryApi[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const page = await etsyGet<{ results: EtsyLedgerEntryApi[] }>(`/shops/${shopId}/payment-account/ledger-entries`, {
      min_created: minCreated,
      max_created: maxCreated,
      limit: pageSize,
      offset,
    });
    results.push(...page.results);
    if (page.results.length < pageSize) break;
  }

  for (const entry of results) {
    await db.etsyLedgerEntry.upsert({
      where: { etsyEntryId: String(entry.entry_id) },
      create: {
        etsyEntryId: String(entry.entry_id),
        createdAt: ledgerDate(entry),
        ledgerType: entry.ledger_type,
        referenceType: entry.reference_type != null ? String(entry.reference_type) : null,
        referenceId: entry.reference_id != null ? String(entry.reference_id) : null,
        description: entry.description != null ? String(entry.description) : null,
        amount: entry.amount / 100,
        currency: entry.currency,
        balance: entry.balance != null ? entry.balance / 100 : null,
      },
      update: {},
    });
  }

  return { fetched: results.length };
}

/** Hours after Etsy shows tracking before an order you never packed here is completed automatically. */
const AUTO_COMPLETE_AFTER_HOURS = 12;

const isCanceled = (r: EtsyReceipt) => /cancel|fully refunded/i.test(r.status ?? "");

/**
 * Reconciles every open order with Etsy, one receipt at a time:
 * - label bought (tracking on the receipt) → marked Label bought;
 * - shipped on Etsy but never packed here, 12h after tracking appeared →
 *   packed (stock + box deducted) and marked shipped, so orders you finish on
 *   Etsy alone don't linger;
 * - canceled / fully refunded on Etsy → removed (stock returned if packed);
 * - backfills Etsy line items for orders that predate storing them.
 */
export async function syncOpenOrders() {
  const shopId = process.env.ETSY_SHOP_ID;
  if (!shopId) throw new Error("ETSY_SHOP_ID is not set");
  const open = await db.order.findMany({ where: { status: { not: ORDER_STATUS.SHIPPED } } });
  const result = { checked: 0, labelsFound: 0, linesBackfilled: 0, autoCompleted: 0, canceled: 0, relinked: 0 };

  for (const o of open) {
    if (!/^\d+$/.test(o.etsyOrderId)) continue; // manual / replacement orders aren't on Etsy
    // Already packed + labelled with lines stored: only the drop-off is left, nothing to ask Etsy.
    if (o.packed && o.labelBought && o.etsyLines) continue;
    result.checked++;
    try {
      const receipt = await etsyGet<EtsyReceipt>(`/shops/${shopId}/receipts/${o.etsyOrderId}`);

      if (isCanceled(receipt)) {
        await db.$transaction(async (tx) => {
          if (o.packed) await moveStock(tx, o.id, 1);
          await tx.order.delete({ where: { id: o.id } });
        });
        result.canceled++;
        continue;
      }

      const data: Record<string, unknown> = {};
      const info = labelInfo(receipt);
      if (info && !o.labelBought) {
        Object.assign(data, info);
        result.labelsFound++;
      }
      const hasDigitalFlag = receipt.transactions?.some((t) => typeof t.is_digital === "boolean");
      if ((!o.etsyLines && receipt.transactions?.length) || (linesNeedRefresh(o.etsyLines) && hasDigitalFlag)) {
        data.etsyLines = JSON.stringify(linesOf(receipt));
        result.linesBackfilled++;
      }

      const shippedAt = (info?.labelBoughtAt as Date | undefined) ?? o.labelBoughtAt;
      const finishedOnEtsyOnly =
        !o.packed && receipt.is_shipped && shippedAt && Date.now() - shippedAt.getTime() > AUTO_COMPLETE_AFTER_HOURS * 3_600_000;
      if (finishedOnEtsyOnly) {
        await db.$transaction(async (tx) => {
          await tx.order.update({ where: { id: o.id }, data: { ...data, packed: true, status: ORDER_STATUS.SHIPPED, shippedAt } });
          await moveStock(tx, o.id, -1);
        });
        result.autoCompleted++;
      } else if (Object.keys(data).length) {
        await db.order.update({ where: { id: o.id }, data });
      }
    } catch (err) {
      console.error(`[etsy-sync] couldn't check order ${o.etsyOrderId}:`, err);
    }
  }
  if (result.linesBackfilled) result.relinked = await relinkOpenOrders();
  if (result.labelsFound || result.relinked || result.autoCompleted || result.canceled) await rebuildQueue();
  return result;
}

/**
 * Orders that were shipped on Etsy before the tracker ever saw them (e.g. a
 * label bought minutes after the sale, between syncs). They're added as
 * shipped, with their parts and box taken off the shelf counts.
 */
export async function syncShippedReceipts() {
  const shopId = process.env.ETSY_SHOP_ID;
  if (!shopId) throw new Error("ETSY_SHOP_ID is not set");
  const { results } = await etsyGet<{ results: EtsyReceipt[] }>(`/shops/${shopId}/receipts`, {
    limit: 100,
    was_shipped: "true",
    min_created: Math.floor(Date.now() / 1000) - 30 * 86_400,
  });
  const mappings = await loadMappings();
  let added = 0;
  for (const r of results) {
    const etsyOrderId = String(r.receipt_id);
    if (isCanceled(r) || (await db.order.findUnique({ where: { etsyOrderId } }))) continue;
    const lines = linesOf(r);
    const { parts } = resolveLines(lines, mappings);
    const info = labelInfo(r);
    await db.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          etsyOrderId,
          buyerName: r.name,
          orderedAt: new Date(r.create_timestamp * 1000),
          etsyShipBy: r.expected_ship_date ? new Date(r.expected_ship_date * 1000) : null,
          itemsRaw: lines.map((l) => `${l.quantity}× ${l.title}`).join("\n"),
          etsyLines: JSON.stringify(lines),
          status: ORDER_STATUS.SHIPPED,
          packed: true,
          ...(info ?? { labelBought: true }),
          shippedAt: (info?.labelBoughtAt as Date | undefined) ?? new Date(),
          orderTotal: money(r.grandtotal),
          salesTax: money(r.total_tax_cost),
          parts: { create: parts },
        },
      });
      await moveStock(tx, order.id, -1);
    });
    added++;
  }
  if (added) await rebuildQueue();
  return { fetched: results.length, added };
}

interface EtsyPayment {
  payment_id: number;
  receipt_id: number;
}

/**
 * Fills in gross / tax / fees / earnings / production / net / margin from the
 * synced ledger for recent orders still missing them (or still missing a label
 * cost, which posts later). Runs after the ledger sync.
 */
export async function syncFinancials() {
  const shopId = process.env.ETSY_SHOP_ID;
  if (!shopId) throw new Error("ETSY_SHOP_ID is not set");
  const since = new Date(Date.now() - 90 * 86_400_000);
  const orders = await db.order.findMany({
    where: {
      orderedAt: { gte: since },
      OR: [
        { etsyEarnings: null },
        { labelCost: null, labelBought: true },
        { labelCost: null, status: ORDER_STATUS.SHIPPED },
        // Estimated / batch-paired costs get another chance at an exact ledger match.
        { labelCostSource: { in: ["estimate", "batch"] } },
      ],
    },
  });
  let filled = 0;
  for (const o of orders) {
    if (!/^\d+$/.test(o.etsyOrderId)) continue;
    let refs: SaleRefs = refsFromStoredLines(o);
    try {
      const r = await etsyGet<EtsyReceipt & { shipments?: (EtsyShipment & { receipt_shipping_id?: number })[] }>(`/shops/${shopId}/receipts/${o.etsyOrderId}`);
      if (linesNeedRefresh(o.etsyLines) && r.transactions?.some((t) => typeof t.is_digital === "boolean")) {
        await db.order.update({ where: { id: o.id }, data: { etsyLines: JSON.stringify(linesOf(r)) } });
      }
      refs = {
        receiptId: o.etsyOrderId,
        transactionIds: (r.transactions ?? []).map((t) => String(t.transaction_id)),
        listingIds: [...new Set((r.transactions ?? []).map((t) => String(t.listing_id)))],
        shipmentIds: (r.shipments ?? []).map((s) => s.receipt_shipping_id).filter((x): x is number => x != null).map(String),
        paymentIds: [],
        grandTotal: r.grandtotal ? money(r.grandtotal) : (o.orderTotal ?? undefined),
      };
      try {
        const p = await etsyGet<{ results: EtsyPayment[] }>(`/shops/${shopId}/receipts/${o.etsyOrderId}/payments`);
        refs.paymentIds = p.results.map((x) => String(x.payment_id));
      } catch {
        // Not available on every app/scope — applyFinancials falls back to matching the ledger by time and amount.
      }
    } catch (err) {
      console.error(`[etsy-sync] couldn't read receipt ${o.etsyOrderId} for financials, using stored lines:`, err);
    }
    if ((await applyFinancials(o.id, refs)) && o.etsyEarnings == null) filled++;
  }
  return { checked: orders.length, filled };
}

export async function syncNow() {
  const receipts = await syncReceipts();
  const openOrders = await syncOpenOrders();
  const shippedOnEtsy = await syncShippedReceipts();
  const digital = await markDigitalOrders();
  const ledger = await syncLedger();
  const financials = await syncFinancials();
  const digitalAfter = await markDigitalOrders(); // older orders whose lines the financials pass just refreshed
  if (digital + digitalAfter) await rebuildQueue();
  const labelsEstimated = await estimateMissingLabels();
  return { receipts, openOrders, shippedOnEtsy, digital: digital + digitalAfter, ledger, financials: { ...financials, labelsEstimated } };
}

export function startEtsySyncJob() {
  cron.schedule("*/15 * * * *", async () => {
    try {
      if (!(await isEtsyConnected())) return;
      await syncNow();
    } catch (err) {
      console.error("[etsy-sync] failed:", err);
    }
  });
}
