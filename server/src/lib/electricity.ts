import { db } from "./db.js";
import { parseLines, resolveLines } from "./orderLines.js";

/**
 * Printer electricity as cost of goods sold, one expense per month (dated the
 * month's last day), kept up to date as orders are completed:
 *
 *   print electricity = Σ units shipped that month × the part's electricity cost
 *   + buffer          = print electricity × buffer % (failed prints, preheat, purges)
 *   + always-on       = printers on × idle watts × hours in the month ÷ 1000 × $/kWh
 *
 * Which part a sold item was: the order's linked parts; else its Etsy lines
 * through the Listing Map; else the closest-named part or listing (fuzzy
 * match, reviewable and overridable on the Electricity page). A part with no
 * electricity cost borrows one from its print time, or from the closest-named
 * part that has one.
 */

const STOP = new Set(["the", "a", "an", "and", "or", "for", "with", "of", "to", "in", "on", "by", "x", "pcs", "pc", "set", "pack", "style", "color", "colour", "size", "option", "custom", "3d", "printed", "print"]);
export const normText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => new Set(normText(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t)));

/** 0..1: how much of the shorter name's words appear in the other (partial words count half), lightly favouring similar length. */
export function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  let hit = 0;
  for (const t of small) {
    if (big.has(t)) hit += 1;
    else if (t.length >= 4 && [...big].some((u) => u.length >= 4 && (u.startsWith(t) || t.startsWith(u)))) hit += 0.5;
  }
  const overlap = hit / small.size;
  const balance = small.size / big.size;
  return Math.round((overlap * 0.8 + overlap * balance * 0.2) * 1000) / 1000;
}

export const MATCH_THRESHOLD = 0.5;

type PartRow = { id: string; name: string; electricityCost: number; printMinutes: number; active: boolean };

/** Sold-item lines from an order with no linked parts: Etsy lines if stored, else the items text ("2× Title" + variation lines). */
export function itemLines(o: { etsyLines: string | null; itemsRaw: string }): { text: string; quantity: number; listingId?: string; variations?: { name: string; value: string }[] }[] {
  const lines = parseLines(o.etsyLines);
  if (lines.length)
    return lines.map((l) => ({ text: [l.title, ...l.variations.map((v) => `${v.name}: ${v.value}`)].join(" "), quantity: l.quantity, listingId: l.listingId, variations: l.variations }));
  const out: { text: string; quantity: number }[] = [];
  for (const raw of o.itemsRaw.split(/\r?\n|;\s*(?=\d+\s*[x×])/)) {
    const line = raw.trim();
    if (!line) continue;
    const q = line.match(/^(\d+)\s*[x×]\s*(.+)$/i);
    if (q) out.push({ text: q[2], quantity: Number(q[1]) });
    else if (out.length && (/^\s/.test(raw) || /:/.test(line))) out[out.length - 1].text += " " + line; // variation line
    else out.push({ text: line, quantity: 1 });
  }
  return out;
}

export interface Resolved {
  partId: string | null;
  via: "override" | "listing" | "name" | "none";
  score: number;
  /** For a listing match, the parts (and per-item quantity) that listing uses. */
  parts?: { partId: string; quantity: number }[];
}

async function context() {
  const [parts, mappings, overrides, printersActive, settings] = await Promise.all([
    db.part.findMany({ select: { id: true, name: true, electricityCost: true, printMinutes: true, active: true } }),
    db.listingMapping.findMany({ include: { parts: true } }),
    db.electricityMatch.findMany(),
    db.printer.count({ where: { active: true } }),
    db.electricitySettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
  ]);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const withCost = parts.filter((p) => p.electricityCost > 0);
  const perMinute = median(parts.filter((p) => p.electricityCost > 0 && p.printMinutes > 0).map((p) => p.electricityCost / p.printMinutes));

  /** Electricity for one unit of a part, borrowing when the catalog has none. */
  const unitCost = (p: PartRow): { cost: number; from: string } => {
    if (p.electricityCost > 0) return { cost: p.electricityCost, from: "catalog" };
    if (p.printMinutes > 0 && perMinute) return { cost: round4(p.printMinutes * perMinute), from: "print time" };
    const best = withCost.map((q) => ({ q, s: similarity(p.name, q.name) })).sort((a, b) => b.s - a.s)[0];
    return best && best.s >= MATCH_THRESHOLD ? { cost: best.q.electricityCost, from: `like ${best.q.name}` } : { cost: 0, from: "unknown" };
  };

  const overrideBy = new Map(overrides.map((o) => [o.text, o.partId]));
  /** Which part(s) an item description was. */
  const resolve = (text: string): Resolved => {
    const key = normText(text);
    if (overrideBy.has(key)) return { partId: overrideBy.get(key) ?? null, via: "override", score: 1 };
    let best: Resolved = { partId: null, via: "none", score: 0 };
    for (const m of mappings) {
      if (!m.parts.length) continue;
      const s = similarity(text, m.variationContains ? `${m.listingTitle} ${m.variationContains}` : m.listingTitle);
      if (s > best.score) best = { partId: m.parts[0].partId, via: "listing", score: s, parts: m.parts };
    }
    for (const p of parts) {
      const s = similarity(text, p.name) + 0.001; // a part name beats a listing on a tie
      if (s > best.score) best = { partId: p.id, via: "name", score: Math.min(1, s) };
    }
    return best.score >= MATCH_THRESHOLD ? best : { partId: null, via: "none", score: best.score };
  };

  return { parts, byId, mappings, settings, printersActive, unitCost, resolve };
}

const round = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
function median(xs: number[]): number | null {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
}
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export interface MonthTotal {
  month: string; // "2026-11"
  orders: number;
  units: number;
  unmatchedUnits: number;
  print: number;
  buffer: number;
  overhead: number;
  total: number;
}

export interface ItemMatch {
  text: string;
  units: number;
  partId: string | null;
  partName: string | null;
  via: Resolved["via"];
  score: number;
  unitCost: number;
  costFrom: string;
}

/** Everything the Electricity page shows, plus what the monthly expenses are built from. */
export async function electricityReport() {
  const ctx = await context();
  const { settings } = ctx;
  const orders = await db.order.findMany({
    where: { status: "SHIPPED", digital: false },
    select: { id: true, orderedAt: true, shippedAt: true, itemsRaw: true, etsyLines: true, parts: { select: { partId: true, quantity: true } } },
  });

  const months = new Map<string, MonthTotal>();
  const items = new Map<string, ItemMatch>();
  const partUnits = new Map<string, number>();
  const add = (key: string) => {
    if (!months.has(key)) months.set(key, { month: key, orders: 0, units: 0, unmatchedUnits: 0, print: 0, buffer: 0, overhead: 0, total: 0 });
    return months.get(key)!;
  };
  const charge = (m: MonthTotal, partId: string, qty: number) => {
    const p = ctx.byId.get(partId);
    if (!p) return;
    m.units += qty;
    m.print += ctx.unitCost(p).cost * qty;
    partUnits.set(partId, (partUnits.get(partId) ?? 0) + qty);
  };

  for (const o of orders) {
    const m = add(monthKey(o.shippedAt ?? o.orderedAt));
    m.orders++;
    if (o.parts.length) {
      for (const p of o.parts) charge(m, p.partId, p.quantity);
      continue;
    }
    for (const line of itemLines(o)) {
      // Etsy lines first go through the Listing Map exactly.
      if (line.listingId) {
        const { parts } = resolveLines([{ listingId: line.listingId, title: line.text, quantity: line.quantity, variations: line.variations ?? [] }], ctx.mappings);
        if (parts.length) {
          for (const p of parts) charge(m, p.partId, p.quantity);
          continue;
        }
      }
      const r = ctx.resolve(line.text);
      const key = normText(line.text);
      const part = r.partId ? ctx.byId.get(r.partId) : undefined;
      const unit = r.parts ? r.parts.reduce((s, p) => s + (ctx.byId.get(p.partId) ? ctx.unitCost(ctx.byId.get(p.partId)!).cost * p.quantity : 0), 0) : part ? ctx.unitCost(part).cost : 0;
      const prev = items.get(key);
      items.set(key, {
        text: prev?.text ?? line.text,
        units: (prev?.units ?? 0) + line.quantity,
        partId: r.partId,
        partName: r.via === "listing" ? `${part?.name ?? "?"}${r.parts && r.parts.length > 1 ? ` + ${r.parts.length - 1} more` : ""} (via listing)` : (part?.name ?? null),
        via: r.via,
        score: r.score,
        unitCost: round4(unit),
        costFrom: r.parts ? "listing parts" : part ? ctx.unitCost(part).from : "",
      });
      if (r.parts) for (const p of r.parts) charge(m, p.partId, p.quantity * line.quantity);
      else if (r.partId) charge(m, r.partId, line.quantity);
      else if (r.via !== "override") m.unmatchedUnits += line.quantity; // "not a printed item" set by hand isn't a gap
    }
  }

  // Always-on overhead for every month from the first sale to now (the current month so far).
  const printers = settings.printersOn ?? ctx.printersActive;
  const now = new Date();
  const keys = [...months.keys()].sort();
  if (keys.length) {
    const [y0, m0] = keys[0].split("-").map(Number);
    for (let d = new Date(y0, m0 - 1, 1); d <= now; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) add(monthKey(d));
  }
  for (const m of months.values()) {
    const [y, mo] = m.month.split("-").map(Number);
    const start = new Date(y, mo - 1, 1);
    const end = new Date(y, mo, 1);
    const hours = (Math.min(end.getTime(), now.getTime()) - start.getTime()) / 3_600_000;
    m.overhead = settings.kwhRate && hours > 0 ? round((printers * settings.idleWattsPerPrinter * hours * settings.kwhRate) / 1000) : 0;
    m.print = round(m.print);
    m.buffer = round((m.print * settings.bufferPct) / 100);
    m.total = round(m.print + m.buffer + m.overhead);
  }

  const partCosts = [...partUnits].map(([id, units]) => {
    const p = ctx.byId.get(id)!;
    const c = ctx.unitCost(p);
    return { partId: id, name: p.name, units, unitCost: round4(c.cost), from: c.from };
  });

  return {
    settings: { ...settings, printers, printersActive: ctx.printersActive },
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    items: [...items.values()].sort((a, b) => Number(a.via !== "none") - Number(b.via !== "none") || a.score - b.score || b.units - a.units),
    partCosts: partCosts.sort((a, b) => Number(a.from === "catalog") - Number(b.from === "catalog") || b.units - a.units),
    parts: ctx.parts.map((p) => ({ id: p.id, name: p.name, active: p.active })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const REF = (month: string) => `electricity-${month}`;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Writes one expense per month (dated the month's last day) and keeps it in
 * step: amounts are rewritten when they change, months with nothing are
 * removed. Your own edits to category, Schedule C line or notes are kept.
 */
export async function syncElectricityExpenses(): Promise<{ months: number; changed: number }> {
  const { months } = await electricityReport();
  const existing = new Map((await db.expense.findMany({ where: { invoiceRef: { startsWith: "electricity-" } } })).map((e) => [e.invoiceRef!, e]));
  let changed = 0;
  for (const m of months) {
    const ref = REF(m.month);
    const prev = existing.get(ref);
    existing.delete(ref);
    if (m.total <= 0) {
      if (prev) {
        await db.expense.delete({ where: { id: prev.id } });
        changed++;
      }
      continue;
    }
    const [y, mo] = m.month.split("-").map(Number);
    const item = `Printer electricity, ${MONTH_NAMES[mo - 1]} ${y} (${m.units} item${m.units === 1 ? "" : "s"} printed)`;
    const breakdown = `Auto-calculated: print ${money(m.print)} + ${money(m.buffer)} buffer + ${money(m.overhead)} always-on overhead${m.unmatchedUnits ? `; ${m.unmatchedUnits} item(s) not matched to a part` : ""}. Updates as orders are completed.`;
    if (prev) {
      if (prev.cost !== m.total || prev.item !== item || prev.notes !== breakdown) {
        await db.expense.update({ where: { id: prev.id }, data: { cost: m.total, item, notes: breakdown } });
        changed++;
      }
    } else {
      await db.expense.create({
        data: {
          date: new Date(y, mo, 0, 12), // last day of the month, local noon
          item,
          vendor: "Utility (electricity)",
          category: "Electricity",
          cost: m.total,
          taxYear: y,
          scheduleCLine: "Part III COGS – other costs",
          deductible: true,
          invoiceRef: ref,
          notes: breakdown,
        },
      });
      changed++;
    }
  }
  for (const stale of existing.values()) {
    await db.expense.delete({ where: { id: stale.id } });
    changed++;
  }
  return { months: months.length, changed };
}

const money = (n: number) => `$${n.toFixed(2)}`;

let running: Promise<void> | null = null;
let again = false;
/**
 * Refresh after something changed (an order completed, a part's cost edited,
 * settings saved). Calls while one is running fold into a single re-run.
 * Never throws.
 */
export function refreshElectricitySoon(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      try {
        await syncElectricityExpenses();
      } catch (err) {
        console.error("[electricity] couldn't update monthly expenses:", err);
      }
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}
