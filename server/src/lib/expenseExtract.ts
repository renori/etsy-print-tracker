import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { db } from "./db.js";

export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;

const ExpenseDraft = z.object({
  date: z.string().describe("Purchase/order date as YYYY-MM-DD"),
  item: z.string().describe("Short description of what was bought"),
  vendor: z.string().nullable(),
  category: z.string().nullable(),
  cost: z.number().describe("Amount paid in dollars, including tax and shipping for that line or order"),
  scheduleCLine: z.string().nullable(),
  paidWith: z.string().nullable(),
  invoiceRef: z.string().nullable().describe("Order number / invoice id if shown"),
  notes: z.string().nullable(),
});
const Extraction = z.object({ expenses: z.array(ExpenseDraft) });
export type ExpenseDraft = z.infer<typeof ExpenseDraft>;

export interface ExtractInput {
  text?: string;
  files?: { mediaType: string; data: string }[]; // base64
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

async function knownValues() {
  const rows = await db.expense.findMany({ orderBy: { date: "desc" }, take: 500 });
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const byCategory = new Map<string, string>();
  for (const r of rows) if (r.category && r.scheduleCLine && !byCategory.has(r.category)) byCategory.set(r.category, r.scheduleCLine);
  return {
    categories: [...byCategory.entries()].map(([c, l]) => `${c} → ${l}`),
    vendors: uniq(rows.map((r) => r.vendor)).slice(0, 40),
    paidWith: uniq(rows.map((r) => r.paidWith)).slice(0, 10),
  };
}

/** Reads receipts, order emails, invoices or screenshots into expense drafts for the user to review. Nothing is saved. */
export async function extractExpenses(input: ExtractInput): Promise<ExpenseDraft[]> {
  const known = await knownValues();
  const today = new Date().toISOString().slice(0, 10);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const f of input.files ?? []) {
    if (f.mediaType === "application/pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } });
    } else if ((IMAGE_TYPES as readonly string[]).includes(f.mediaType)) {
      content.push({ type: "image", source: { type: "base64", media_type: f.mediaType as (typeof IMAGE_TYPES)[number], data: f.data } });
    } else {
      throw new Error(`Unsupported file type ${f.mediaType} — use a PNG, JPEG, WebP, GIF or PDF.`);
    }
  }
  if (input.text?.trim()) content.push({ type: "text", text: `<pasted>\n${input.text.trim()}\n</pasted>` });
  if (content.length === 0) throw new Error("Nothing to read — paste some text or add a screenshot/PDF.");

  content.push({
    type: "text",
    text: [
      "Extract every business purchase in the material above as expense rows for a small 3D-printing Etsy shop's bookkeeping.",
      `Today is ${today}; if a date has no year, use the most recent past date that fits.`,
      "One row per order (or per line item when items clearly belong in different categories, e.g. filament vs shipping supplies; split tax/shipping proportionally in that case).",
      "Use the amount actually charged. Skip refunds' original charges only if a refund is shown for the same order, and skip anything that is clearly not a purchase.",
      known.categories.length
        ? `Prefer these existing categories and their Schedule C lines:\n${known.categories.join("\n")}`
        : "Use short categories like Filament, Parts, Shipping, Tools, Software, with the matching IRS Schedule C line.",
      known.vendors.length ? `Known vendors (reuse exact spelling when it matches): ${known.vendors.join(", ")}` : "",
      known.paidWith.length ? `Known payment methods (reuse exact text when it matches): ${known.paidWith.join(" | ")}` : "",
      "Leave a field null when the material doesn't show it. Never invent order numbers or amounts.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: zodOutputFormat(Extraction) },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") throw new Error("The model declined to read this content.");
  if (response.stop_reason === "max_tokens") throw new Error("Too many items to read at once — split it into smaller batches.");
  if (!response.parsed_output) throw new Error("Couldn't read any expenses from that.");
  return response.parsed_output.expenses;
}
