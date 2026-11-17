import { db } from "./db.js";
import { boxForOrder, normBoxName } from "./boxes.js";

/**
 * Pirate Ship's Simple Export Rate (shipped through Asendia) is priced only by
 * weight tier and by zone: Canada, or the rest of the world. Pirate Ship has
 * no API for it, so the price list is pasted into the app (Shipping Boxes
 * page) and quotes are looked up here.
 */

const GRAMS_PER_OZ = 28.3495;
const HOME = (process.env.HOME_COUNTRY || "US").toUpperCase();

export type Zone = "canada" | "world";
export const zoneFor = (country: string | null | undefined): Zone | null => {
  const c = country?.toUpperCase();
  if (!c || c === HOME) return null;
  return c === "CA" ? "canada" : "world";
};

type WeighableOrder = {
  shipWeightOz: number | null;
  packageType: string | null;
  parts: { quantity: number; part?: { shipWeightOz: number | null; filamentGrams: number; packageType: string | null } | null }[];
};

export interface OrderWeight {
  oz: number;
  /** "typed" = entered on the order; "box" = the box's quote weight; "parts" = every part (and the box) has a ship weight; "estimated" = some fell back to filament weight. */
  basis: "typed" | "box" | "parts" | "estimated";
  box: string | null;
}

/** Packed weight: typed in on the order, else the box's quote weight, else parts' ship weights (or filament weight) + the empty box. */
export function orderWeight(o: WeighableOrder, boxes: { name: string; weightOz: number | null; quoteWeightOz: number | null }[]): OrderWeight | null {
  const box = boxForOrder(o);
  if (o.shipWeightOz != null && o.shipWeightOz > 0) return { oz: o.shipWeightOz, basis: "typed", box };
  const boxRow = box ? boxes.find((b) => normBoxName(b.name) === normBoxName(box)) : null;
  if (boxRow?.quoteWeightOz != null && boxRow.quoteWeightOz > 0) return { oz: boxRow.quoteWeightOz, basis: "box", box };
  if (!o.parts.length) return null;
  let oz = 0;
  let exact = true;
  for (const p of o.parts) {
    if (!p.part) return null;
    if (p.part.shipWeightOz != null) oz += p.part.shipWeightOz * p.quantity;
    else {
      oz += (p.part.filamentGrams / GRAMS_PER_OZ) * p.quantity;
      exact = false;
    }
  }
  if (boxRow?.weightOz != null) oz += boxRow.weightOz;
  else exact = false;
  return { oz: Math.round(oz * 10) / 10, basis: exact ? "parts" : "estimated", box };
}

export interface ExportQuote {
  price: number;
  zone: Zone;
  /** The tier the weight fell into ("up to N oz"). */
  tierOz: number;
  weight: OrderWeight;
}

/** Simple Export Rate for this weight and destination, or null (domestic, no price list, or over the top tier). */
export function quoteExport(weight: OrderWeight | null, country: string | null | undefined, rates: { maxOz: number; canada: number | null; world: number | null }[]): ExportQuote | null {
  const zone = zoneFor(country);
  if (!zone || !weight) return null;
  const tier = [...rates].sort((a, b) => a.maxOz - b.maxOz).find((r) => weight.oz <= r.maxOz + 1e-9 && r[zone] != null);
  return tier ? { price: tier[zone]!, zone, tierOz: tier.maxOz, weight } : null;
}

/** Everything a quote needs, loaded once for a batch of orders. */
export async function quoteContext() {
  const [boxes, rates] = await Promise.all([db.box.findMany({ select: { name: true, weightOz: true, quoteWeightOz: true } }), db.exportRate.findMany()]);
  return {
    boxes,
    rates,
    quote: (o: WeighableOrder & { shipCountry: string | null }) => {
      const weight = orderWeight(o, boxes);
      return { weight, exportQuote: quoteExport(weight, o.shipCountry, rates) };
    },
  };
}

/**
 * Reads a pasted price list: per tier, a weight then the Canada price then
 * the rest-of-world price. They can share a line ("8 oz  $9.50  $12.75") or
 * sit on separate lines, as Pirate Ship's rate chart copies. Weight may be
 * "4 oz", "0.5 lb", "1 lbs" or a bare number (ounces); prices may carry "$".
 * Header lines ("Weight Not Over", "Canada", …) are skipped.
 */
export function parseRateTable(text: string): { maxOz: number; canada: number | null; world: number | null }[] {
  const out = new Map<number, { maxOz: number; canada: number | null; world: number | null }>();
  let current: { maxOz: number; prices: number[] } | null = null;
  const flush = () => {
    if (current && current.prices.length && current.maxOz > 0)
      out.set(current.maxOz, { maxOz: current.maxOz, canada: current.prices[0] ?? null, world: current.prices[1] ?? null });
    current = null;
  };
  const pricesIn = (s: string) => [...s.matchAll(/\$?\s*(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1]));
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/,(?=\d{3}\b)/g, "").trim();
    if (!line) continue;
    // A price-only line ("$12.99") belongs to the tier above.
    if (/^\$\s*\d/.test(line) && current) {
      current.prices.push(...pricesIn(line));
      continue;
    }
    const w = line.match(/^(?:up\s*to\s*)?(\d+(?:\.\d+)?)\s*(oz|ounces?|lbs?|pounds?)?(?![\d.])/i);
    if (!w) continue; // header text
    flush();
    const n = Number(w[1]);
    current = { maxOz: /^(lb|pound)/i.test(w[2] ?? "") ? n * 16 : n, prices: pricesIn(line.slice(w[0].length)) };
  }
  flush();
  return [...out.values()].sort((a, b) => a.maxOz - b.maxOz);
}
