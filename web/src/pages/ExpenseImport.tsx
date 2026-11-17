import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Modal } from "../components/Modal";
import type { Expense } from "../api/types";

import { IconButton, btn, fileInputClass, inputClass } from "../components/ui";
export interface Draft {
  include: boolean;
  date: string; // YYYY-MM-DD
  item: string;
  vendor: string;
  category: string;
  cost: string;
  scheduleCLine: string;
  paidWith: string;
  invoiceRef: string;
  notes: string;
}

interface Attached {
  name: string;
  mediaType: string;
  data: string; // base64
  preview?: string;
}

const s = (v: unknown) => (v == null ? "" : String(v));

function toDraft(e: Partial<Record<keyof Draft, unknown>>): Draft {
  return {
    include: true,
    date: s(e.date).slice(0, 10),
    item: s(e.item),
    vendor: s(e.vendor),
    category: s(e.category),
    cost: s(e.cost),
    scheduleCLine: s(e.scheduleCLine),
    paidWith: s(e.paidWith),
    invoiceRef: s(e.invoiceRef),
    notes: s(e.notes),
  };
}

/** "9/3/26", "09/03/2026", "2026-09-03", "Sep 3, 2026" → "2026-09-03" (or "" if unreadable). */
function normDate(raw: string): string {
  const t = raw.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(t);
  return isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Rows copied from a spreadsheet (tab-separated) or CSV with a header row
 * that has at least a date and a cost/amount column. Returns null if the
 * text doesn't look like a table.
 */
export function parseTable(text: string): Draft[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : null;
  if (!sep) return null;
  const split = (l: string) =>
    sep === "\t" ? l.split("\t") : (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
  const header = split(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const c = {
    date: col("date", "order date"),
    item: col("item", "description", "title", "product"),
    vendor: col("vendor", "seller", "merchant", "store"),
    category: col("category"),
    cost: col("cost", "amount", "total", "price"),
    line: col("schedule c", "schedule"),
    paid: col("paid with", "payment"),
    inv: col("invoice", "order id", "order number", "order #"),
    notes: col("notes", "memo"),
  };
  if (c.date === -1 || c.cost === -1) return null;
  const get = (cells: string[], i: number) => (i === -1 ? "" : (cells[i] ?? "").trim());
  return lines.slice(1).flatMap((l) => {
    const cells = split(l);
    const cost = get(cells, c.cost).replace(/[$,\s]/g, "");
    const date = normDate(get(cells, c.date));
    if (!date || cost === "" || isNaN(Number(cost))) return [];
    return [
      toDraft({
        date,
        item: get(cells, c.item) || "(no description)",
        vendor: get(cells, c.vendor),
        category: get(cells, c.category),
        cost,
        scheduleCLine: get(cells, c.line),
        paidWith: get(cells, c.paid),
        invoiceRef: get(cells, c.inv),
        notes: get(cells, c.notes),
      }),
    ];
  });
}

function readFile(file: File): Promise<Attached> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      resolve({ name: file.name || "pasted image", mediaType: file.type, data: url.slice(url.indexOf(",") + 1), preview: file.type.startsWith("image/") ? url : undefined });
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Fills each draft's blanks from the most recent existing expense with the same vendor. */
function fillFromHistory(drafts: Draft[], history: Expense[]): Draft[] {
  return drafts.map((d) => {
    const prev = history.find((e) => e.vendor && d.vendor && e.vendor.toLowerCase() === d.vendor.toLowerCase());
    if (!prev) return d;
    return {
      ...d,
      vendor: prev.vendor ?? d.vendor,
      category: d.category || s(prev.category),
      scheduleCLine: d.scheduleCLine || s(prev.scheduleCLine),
      paidWith: d.paidWith || s(prev.paidWith),
    };
  });
}

const cell = "w-full min-w-0 min-h-11 md:min-h-9 rounded-lg border border-neutral-300 bg-white px-2 text-base md:text-sm dark:border-neutral-700 dark:bg-neutral-800";

export function ExpenseImport({ history, onClose }: { history: Expense[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: ai } = useQuery({ queryKey: ["expenses", "ai-status"], queryFn: () => api.get<{ enabled: boolean }>("/expenses/ai-status") });
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"table" | "free" | "ai" | null>(null);
  const [reader, setReader] = useState<"free" | "ai">("free");
  const [warnings, setWarnings] = useState<string[]>([]);

  const read = useMutation({
    mutationFn: async () => {
      setError(null);
      const table = files.length === 0 ? parseTable(text) : null;
      if (table && table.length > 0) {
        setSource("table");
        return table;
      }
      const use = ai?.enabled ? reader : "free";
      const res = await api.post<{ reader: "free" | "ai"; expenses: Partial<Record<keyof Draft, unknown>>[]; warnings: string[] }>("/expenses/extract", {
        text: text || undefined,
        files: files.map(({ mediaType, data }) => ({ mediaType, data })),
        reader: use,
      });
      setSource(res.reader);
      setWarnings(res.warnings ?? []);
      return res.expenses.map(toDraft);
    },
    onSuccess: (d) => {
      if (d.length === 0) setError("Didn't find any expenses in that.");
      setDrafts(fillFromHistory(d, history));
    },
    onError: (e) => setError((e as Error).message),
  });

  const save = useMutation({
    mutationFn: (rows: Draft[]) =>
      api.post<{ created: number }>("/expenses/bulk", {
        expenses: rows.map((d) => ({
          date: d.date,
          item: d.item,
          vendor: d.vendor || null,
          category: d.category || null,
          cost: Number(d.cost),
          scheduleCLine: d.scheduleCLine || null,
          paidWith: d.paidWith || null,
          invoiceRef: d.invoiceRef || null,
          notes: d.notes || null,
        })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });

  async function addFiles(list: FileList | File[]) {
    const accepted = [...list].filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    const read = await Promise.all(accepted.map(readFile));
    setFiles((prev) => [...prev, ...read]);
  }

  function update(i: number, patch: Partial<Draft>) {
    setDrafts((prev) => prev!.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }

  const chosen = (drafts ?? []).filter((d) => d.include);
  const invalid = chosen.filter((d) => !d.date || !d.item.trim() || d.cost === "" || isNaN(Number(d.cost)));
  const total = chosen.reduce((sum, d) => sum + (Number(d.cost) || 0), 0);

  return (
    <Modal title="Add expenses from a receipt" onClose={onClose}>
      {!drafts ? (
        <div className="space-y-3">
          <label htmlFor="exp-paste" className="block text-sm font-medium">
            Paste an order email, receipt text, or rows copied from a spreadsheet
          </label>
          <textarea
            id="exp-paste"
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
              if (imgs.length) {
                e.preventDefault();
                addFiles(imgs);
              }
            }}
            placeholder="Tip: you can also paste a screenshot straight into this box."
            className={`${inputClass} py-2 font-mono`}
          />
          <div>
            <label htmlFor="exp-files" className="block text-sm font-medium">
              …or add screenshots / PDF invoices
            </label>
            <input
              id="exp-files"
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
              className={fileInputClass}
            />
          </div>
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-2 rounded border border-neutral-200 p-1 pr-2 text-xs dark:border-neutral-700">
                  {f.preview ? <img src={f.preview} alt="" className="h-10 w-10 rounded object-cover" /> : <span className="px-1">PDF</span>}
                  <span className="max-w-32 truncate">{f.name}</span>
                  <IconButton icon="x" label={`Remove ${f.name}`} variant="danger" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} className="!h-9 !w-9" />
                </li>
              ))}
            </ul>
          )}
          {ai?.enabled && (
            <fieldset className="flex flex-wrap gap-3 text-sm">
              <legend className="mb-1 font-medium">Reader</legend>
              <label className="flex min-h-9 items-center gap-1.5">
                <input type="radio" name="reader" checked={reader === "free"} onChange={() => setReader("free")} /> Free (on your NAS)
              </label>
              <label className="flex min-h-9 items-center gap-1.5">
                <input type="radio" name="reader" checked={reader === "ai"} onChange={() => setReader("ai")} /> AI (~1¢, better on unusual receipts)
              </label>
            </fieldset>
          )}
          {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <button
            type="button"
            disabled={read.isPending || (!text.trim() && files.length === 0)}
            onClick={() => read.mutate()}
            className={btn("primary", "lg", "w-full")}
          >
            {read.isPending ? (files.length ? "Reading… (screenshots take a few seconds)" : "Reading…") : "Read"}
          </button>
          <p className="text-xs text-neutral-500">
            Works best with Amazon order emails, the "Your Orders" page, Amazon invoices, and ordinary store receipts. You review every row
            before anything is saved.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {source === "table" ? "Read from the pasted table." : "Read automatically — check every row before saving."} Untick anything you don't want.
          </p>
          <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
            {drafts.map((d, i) => (
              <li key={i} className={`rounded border p-2 ${d.include ? "border-neutral-300 dark:border-neutral-700" : "border-dashed border-neutral-300 opacity-60"}`}>
                <label className="mb-1 flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={d.include} onChange={(e) => update(i, { include: e.target.checked })} />
                  Include
                </label>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  <label className="col-span-2 text-xs text-neutral-500 sm:col-span-3">
                    Item
                    <input className={cell} value={d.item} onChange={(e) => update(i, { item: e.target.value })} />
                  </label>
                  <label className="text-xs text-neutral-500">
                    Cost
                    <input className={cell} inputMode="decimal" value={d.cost} onChange={(e) => update(i, { cost: e.target.value })} />
                  </label>
                  <label className="text-xs text-neutral-500">
                    Date
                    <input type="date" className={cell} value={d.date} onChange={(e) => update(i, { date: e.target.value })} />
                  </label>
                  <label className="text-xs text-neutral-500">
                    Vendor
                    <input className={cell} value={d.vendor} onChange={(e) => update(i, { vendor: e.target.value })} />
                  </label>
                  <label className="text-xs text-neutral-500">
                    Category
                    <input className={cell} value={d.category} onChange={(e) => update(i, { category: e.target.value })} />
                  </label>
                  <label className="text-xs text-neutral-500">
                    Paid with
                    <input className={cell} value={d.paidWith} onChange={(e) => update(i, { paidWith: e.target.value })} />
                  </label>
                  <label className="col-span-2 text-xs text-neutral-500 sm:col-span-3">
                    Schedule C line
                    <input className={cell} value={d.scheduleCLine} onChange={(e) => update(i, { scheduleCLine: e.target.value })} />
                  </label>
                  <label className="text-xs text-neutral-500">
                    Order / invoice #
                    <input className={cell} value={d.invoiceRef} onChange={(e) => update(i, { invoiceRef: e.target.value })} />
                  </label>
                </div>
              </li>
            ))}
          </ul>
          {warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 rounded border border-amber-200 bg-amber-50 p-2 pl-6 text-sm text-amber-800">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {invalid.length > 0 && <p className="text-sm text-amber-700">{invalid.length} included row(s) need a date, item and cost.</p>}
          {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setDrafts(null)} className={btn("secondary", "lg", "flex-1")}>
              Back
            </button>
            <button
              type="button"
              disabled={chosen.length === 0 || invalid.length > 0 || save.isPending}
              onClick={() => save.mutate(chosen)}
              className={btn("primary", "lg", "flex-[2]")}
            >
              {save.isPending ? "Saving…" : `Save ${chosen.length} expense${chosen.length === 1 ? "" : "s"} · $${total.toFixed(2)}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
