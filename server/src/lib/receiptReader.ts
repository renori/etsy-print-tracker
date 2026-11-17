/**
 * Free, offline receipt reading: OCR (Tesseract) for images, the text layer
 * for PDFs, then rules for Amazon order emails/invoices and a general
 * "store receipt" fallback. Every result is a draft the user reviews.
 */
import { createRequire } from "node:module";
import { createWorker } from "tesseract.js";
import { extractText, getDocumentProxy } from "unpdf";
import { db } from "./db.js";
import type { ExpenseDraft } from "./expenseExtract.js";

const require = createRequire(import.meta.url);
const engData = require("@tesseract.js-data/eng") as { langPath: string; gzip: boolean };

export interface FileInput {
  mediaType: string;
  data: string; // base64
}

// ---------- getting text ----------

async function ocr(images: Buffer[]): Promise<string[]> {
  if (images.length === 0) return [];
  // Language data ships in node_modules, so nothing is downloaded at runtime.
  const worker = await createWorker("eng", 1, { langPath: engData.langPath, gzip: engData.gzip, cacheMethod: "none" });
  try {
    const out: string[] = [];
    for (const img of images) out.push((await worker.recognize(img)).data.text);
    return out;
  } finally {
    await worker.terminate();
  }
}

async function pdfText(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export async function textFrom(input: { text?: string; files?: FileInput[] }): Promise<{ texts: string[]; warnings: string[] }> {
  const texts: string[] = [];
  const warnings: string[] = [];
  const images: Buffer[] = [];
  for (const f of input.files ?? []) {
    const buf = Buffer.from(f.data, "base64");
    if (f.mediaType === "application/pdf") {
      const t = await pdfText(buf);
      if (t.replace(/\s/g, "").length < 20) warnings.push("A PDF had no readable text (it's probably a scan) — take a screenshot of it instead.");
      else texts.push(t);
    } else if (f.mediaType.startsWith("image/")) {
      images.push(buf);
    } else {
      throw new Error(`Unsupported file type ${f.mediaType} — use a PNG, JPEG, WebP, GIF or PDF.`);
    }
  }
  texts.push(...(await ocr(images)));
  if (input.text?.trim()) texts.push(input.text);
  return { texts, warnings };
}

// ---------- shared helpers ----------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** First date in the text, as YYYY-MM-DD. Handles "November 2, 2026", "Nov 2 2026", "2 Nov 2026", "11/02/2026", "2026-11-02". */
export function findDate(text: string, today = new Date()): string | null {
  const candidates: { at: number; value: string }[] = [];
  const push = (at: number, y: number, m: number, d: number) => {
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 2000 && y < 2100) candidates.push({ at, value: iso(y, m, d) });
  };
  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) push(m.index!, +m[1], +m[2], +m[3]);
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)) push(m.index!, +m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi))
    push(m.index!, +m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  for (const m of text.matchAll(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/gi))
    push(m.index!, +m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  // Month + day with no year (e.g. "Ordered on Nov 2"): the most recent such date that isn't in the future.
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b(?!,?\s*\d{4})/gi)) {
    const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    let y = today.getFullYear();
    if (new Date(y, mo - 1, +m[2]) > today) y--;
    push(m.index!, y, mo, +m[2]);
  }
  candidates.sort((a, b) => a.at - b.at);
  return candidates[0]?.value ?? null;
}

const MONEY = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/g;
const money = (s: string) => parseFloat(s.replace(/[,\s$]/g, ""));

function amountsIn(line: string): number[] {
  return [...line.matchAll(MONEY)].map((m) => money(m[1]));
}

/** The amount on the best "total" line: grand/order total beats total; subtotals, savings and item totals are ignored. */
export function findTotal(text: string): number | null {
  const lines = text.split(/\r?\n/);
  const ranked: { score: number; amount: number }[] = [];
  lines.forEach((line, i) => {
    const l = line.toLowerCase();
    if (/sub\s*-?total|before tax|savings|you saved|discount|item\(s\) total|items:|refund/.test(l)) return;
    let score = 0;
    if (/grand total|order total|amount charged|total charged|amount paid|total paid|payment total|charged to/.test(l)) score = 3;
    else if (/\btotal\b|balance due|amount due/.test(l)) score = 2;
    if (!score) return;
    // OCR often splits "Total" and its amount onto adjacent lines.
    const amounts = amountsIn(line).length ? amountsIn(line) : amountsIn(lines[i + 1] ?? "");
    if (amounts.length) ranked.push({ score: score + i / 1e6, amount: amounts[amounts.length - 1] });
  });
  if (ranked.length) return ranked.sort((a, b) => b.score - a.score)[0].amount;
  const all = amountsIn(text);
  return all.length ? Math.max(...all) : null;
}

function lastFour(text: string): string | null {
  const m =
    text.match(/(?:ending in|ending|ends in|x{2,}|\*{2,}|•{2,})\s*(\d{4})\b/i) ??
    // OCR turns masked digits ("************7794") into junk, so allow anything non-numeric after the card name.
    text.match(/\b(?:visa|mastercard|master card|amex|american express|discover|debit|credit)\b[^\d\n]{0,30}(\d{4})\b/i);
  return m ? m[1] : null;
}

// ---------- Amazon ----------

const AMAZON_ORDER = /\b(\d{3}-\d{7}-\d{7})\b/g;

/** Product-looking lines: long enough, mostly letters, not boilerplate. */
function productLines(text: string): string[] {
  const skip =
    /order|ship|deliver|arriv|track|total|subtotal|tax|payment|visa|mastercard|amex|card|ending|address|return|refund|qty|quantity|sold by|condition|price|hello|thank|view|manage|account|prime|amazon\.com|invoice|page \d|gift|estimated|seller|buy it again|write a review|business/i;
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(MONEY, "").replace(/^\d+\s+of:\s*/i, "").replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 12 && l.length <= 200 && !skip.test(l) && (l.match(/[a-z]/gi)?.length ?? 0) / l.length > 0.55);
}

function amazonDrafts(text: string): ExpenseDraft[] | null {
  if (!/amazon/i.test(text) && !AMAZON_ORDER.test(text)) return null;
  AMAZON_ORDER.lastIndex = 0;
  const orders = [...text.matchAll(AMAZON_ORDER)];
  const unique = [...new Map(orders.map((m) => [m[1], m])).values()];
  if (unique.length === 0) return null;

  // Copying the "Your Orders" page gives several orders in one paste. There each order's date and
  // total come *before* its number, so split at "Order placed" headers when there's one per order;
  // otherwise (emails, invoices) split at each new order number.
  const headers = [...text.matchAll(/^\s*order placed\b/gim)];
  const starts = headers.length === unique.length ? headers.map((h) => h.index!) : unique.map((m) => m.index!);
  starts[0] = 0;
  const segments = starts.map((at, i) => text.slice(at, starts[i + 1] ?? text.length));
  return unique.map((m, i) => {
    const seg = segments[i];
    const items = productLines(seg).slice(0, 3);
    const placed = seg.match(/(?:order placed|ordered on|order date|placed on)[:\s]*([^\n]{6,40}|\n\s*[^\n]{6,40})/i);
    const card = lastFour(seg);
    return {
      date: findDate(placed?.[1] ?? "") ?? findDate(seg) ?? "",
      item: items.length ? items.map((t) => t.slice(0, 80)).join("; ") : "Amazon order",
      vendor: "Amazon",
      category: null,
      cost: findTotal(seg) ?? 0,
      scheduleCLine: null,
      paidWith: card ? `ending ${card}` : null,
      invoiceRef: m[1],
      notes: items.length > 1 ? `${productLines(seg).length} item lines found — split if they belong in different categories` : null,
    };
  });
}

// ---------- any other receipt ----------

function genericDraft(text: string, knownVendors: string[]): ExpenseDraft | null {
  const total = findTotal(text);
  if (total == null) return null;
  const lower = text.toLowerCase();
  const vendor =
    knownVendors.find((v) => v.length > 2 && lower.includes(v.toLowerCase())) ??
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length >= 3 && /[a-z]{3}/i.test(l) && !/receipt|invoice|order|date|thank/i.test(l)) ??
    null;
  const items = productLines(text).filter((l) => l !== vendor).slice(0, 3);
  const ref = text.match(/(?:order|invoice|receipt|transaction)\s*(?:#|no\.?|number|id)[:\s]*([A-Z0-9-]{4,})/i);
  const card = lastFour(text);
  return {
    date: findDate(text) ?? "",
    item: items.length ? items.map((t) => t.slice(0, 80)).join("; ") : vendor ? `${vendor} purchase` : "Purchase",
    vendor,
    category: null,
    cost: total,
    scheduleCLine: null,
    paidWith: card ? `ending ${card}` : null,
    invoiceRef: ref?.[1] ?? null,
    notes: null,
  };
}

// ---------- categories ----------

const KEYWORDS: [RegExp, string][] = [
  [/filament|pla\b|pla\+|petg|abs\b|asa\b|tpu\b|spool/i, "Filament"],
  [/mailer|box(es)?\b|shipping label|label|tape|bubble|packing|envelope|postage|usps|ups\b|fedex|pirate ship/i, "Shipping"],
  [/nozzle|hotend|hot end|build plate|bed|extruder|ptfe|belt|bearing|screw|magnet|insert|hardware/i, "Parts"],
  [/file|plier|tweezer|deburr|scraper|caliper|knife|tool/i, "Tools"],
  [/license|subscription|software|solidworks|fusion|adobe/i, "Software"],
];

async function categorize(drafts: ExpenseDraft[]): Promise<ExpenseDraft[]> {
  const history = await db.expense.findMany({ orderBy: { date: "desc" }, take: 1000 });
  const lineFor = new Map<string, string>();
  for (const e of history) if (e.category && e.scheduleCLine && !lineFor.has(e.category)) lineFor.set(e.category, e.scheduleCLine);
  const paidWith = [...new Set(history.map((e) => e.paidWith).filter((p): p is string => !!p))];

  return drafts.map((d) => {
    const category = d.category ?? KEYWORDS.find(([re]) => re.test(d.item))?.[1] ?? null;
    // "ending 7794" → the card text you already use, e.g. "Ink Business Unlimited ••7794".
    const digits = d.paidWith?.match(/\d{4}/)?.[0];
    const knownCard = digits ? paidWith.find((p) => p.includes(digits)) : undefined;
    return {
      ...d,
      category,
      scheduleCLine: d.scheduleCLine ?? (category ? lineFor.get(category) ?? null : null),
      paidWith: knownCard ?? d.paidWith,
    };
  });
}

// ---------- entry point ----------

export async function readReceiptsFree(input: { text?: string; files?: FileInput[] }): Promise<{ expenses: ExpenseDraft[]; warnings: string[] }> {
  const { texts, warnings } = await textFrom(input);
  if (texts.length === 0) throw new Error(warnings[0] ?? "Nothing to read — paste some text or add a screenshot/PDF.");
  const knownVendors = [...new Set((await db.expense.findMany({ select: { vendor: true } })).map((e) => e.vendor).filter((v): v is string => !!v))];

  const drafts: ExpenseDraft[] = [];
  for (const t of texts) {
    const found = amazonDrafts(t) ?? (genericDraft(t, knownVendors) ? [genericDraft(t, knownVendors)!] : []);
    if (found.length === 0) warnings.push("Couldn't find a total in one of the inputs — add it by hand.");
    drafts.push(...found);
  }
  for (const d of drafts) {
    if (!d.date) warnings.push(`No date found for "${d.item.slice(0, 40)}" — set it before saving.`);
    if (!d.cost) warnings.push(`No total found for "${d.item.slice(0, 40)}" — check the cost.`);
  }
  return { expenses: await categorize(drafts), warnings: [...new Set(warnings)] };
}
