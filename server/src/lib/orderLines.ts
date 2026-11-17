import { db } from "./db.js";

export interface OrderLine {
  listingId: string;
  transactionId?: string;
  title: string;
  quantity: number;
  variations: { name: string; value: string }[];
  /** Etsy's is_digital for the line (absent on lines stored before this was kept). */
  digital?: boolean;
}

export function parseLines(json: string | null | undefined): OrderLine[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export const variationText = (l: OrderLine) => l.variations.map((v) => `${v.name}: ${v.value}`).join(" ");

type Mapping = { etsyListingId: string; variationContains: string | null; parts: { partId: string; quantity: number }[] };

/**
 * The Listing Map row for one line: first a row whose "variation contains"
 * text appears in the buyer's chosen variation, else the listing's "any
 * variation" row. null = unmapped.
 */
export function matchMapping(line: OrderLine, mappings: Mapping[]): Mapping | null {
  const rows = mappings.filter((m) => m.etsyListingId === line.listingId);
  const haystack = variationText(line).toLowerCase();
  return (
    rows.find((r) => r.variationContains && haystack.includes(r.variationContains.toLowerCase())) ?? rows.find((r) => !r.variationContains) ?? null
  );
}

export async function loadMappings(): Promise<Mapping[]> {
  return db.listingMapping.findMany({ include: { parts: true } });
}

/**
 * True when every line is a digital download. Etsy's own flag wins; for lines
 * stored without it, a line counts as digital when its Listing Map row has no
 * parts ("digital / nothing to print"). An order with tracking never is.
 */
export function isDigitalOrder(lines: OrderLine[], mappings: Mapping[], trackingNumber?: string | null): boolean {
  if (!lines.length || trackingNumber) return false;
  return lines.every((l) => l.digital ?? matchMapping(l, mappings)?.parts.length === 0);
}

/** Parts an order needs, plus the lines that matched nothing in the Listing Map. */
export function resolveLines(lines: OrderLine[], mappings: Mapping[]) {
  const totals = new Map<string, number>();
  const unmatched: OrderLine[] = [];
  for (const line of lines) {
    const m = matchMapping(line, mappings);
    if (!m) {
      unmatched.push(line);
      continue;
    }
    for (const p of m.parts) totals.set(p.partId, (totals.get(p.partId) ?? 0) + p.quantity * line.quantity);
  }
  return { parts: [...totals.entries()].map(([partId, quantity]) => ({ partId, quantity })), unmatched };
}

const same = (a: { partId: string; quantity: number }[], b: { partId: string; quantity: number }[]) => {
  const key = (x: typeof a) => x.map((p) => `${p.partId}:${p.quantity}`).sort().join(",");
  return key(a) === key(b);
};

/**
 * Re-links open, unpacked orders to parts using the current Listing Map —
 * run after any mapping change, so renaming a variation on Etsy and fixing
 * the map also fixes orders that already came in. Packed orders are left
 * alone: their parts already came off the shelf.
 */
export async function relinkOpenOrders(): Promise<number> {
  const mappings = await loadMappings();
  const orders = await db.order.findMany({
    where: { status: { not: "SHIPPED" }, packed: false, etsyLines: { not: null } },
    include: { parts: true },
  });
  let changed = 0;
  for (const o of orders) {
    const lines = parseLines(o.etsyLines);
    if (lines.length === 0) continue;
    const { parts, unmatched } = resolveLines(lines, mappings);
    // Partly unmapped: keep whatever is linked now rather than dropping parts.
    if (unmatched.length && o.parts.length) continue;
    if (same(parts, o.parts)) continue;
    await db.$transaction([db.orderPart.deleteMany({ where: { orderId: o.id } }), ...parts.map((p) => db.orderPart.create({ data: { orderId: o.id, ...p } }))]);
    changed++;
  }
  return changed;
}

/** Open-order lines the Listing Map doesn't cover, grouped by listing + variation. */
export async function unmappedSales() {
  const mappings = await loadMappings();
  const orders = await db.order.findMany({
    where: { status: { not: "SHIPPED" }, etsyLines: { not: null } },
    include: { _count: { select: { parts: true } } },
    orderBy: { orderedAt: "asc" },
  });
  const groups = new Map<
    string,
    { listingId: string; title: string; variations: OrderLine["variations"]; orders: { id: string; etsyOrderId: string; buyerName: string; packed: boolean; linked: boolean }[] }
  >();
  for (const o of orders) {
    for (const line of resolveLines(parseLines(o.etsyLines), mappings).unmatched) {
      const k = `${line.listingId}|${variationText(line)}`;
      const g = groups.get(k) ?? { listingId: line.listingId, title: line.title, variations: line.variations, orders: [] };
      if (!g.orders.some((x) => x.id === o.id)) g.orders.push({ id: o.id, etsyOrderId: o.etsyOrderId, buyerName: o.buyerName, packed: o.packed, linked: o._count.parts > 0 });
      groups.set(k, g);
    }
  }
  return [...groups.values()];
}
