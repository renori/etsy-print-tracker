import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { btn, fileInputClass } from "../components/ui";
interface Summary {
  counts: Record<string, number>;
  warnings: string[];
}

const LABELS: Record<string, string> = {
  parts: "Parts",
  printers: "Printers",
  plateRecipes: "Plate recipes",
  blackoutWindows: "Blackout windows",
  listingMappings: "Listing mappings",
  activeOrders: "Active orders",
  completedOrders: "Completed orders",
  replacements: "Replacements",
  expenses: "Expenses",
  mileageEntries: "Mileage entries",
  ledgerEntries: "Etsy ledger entries",
  platesPrintingNow: "Plates printing now",
  newBoxSizes: "New box sizes",
};

export function ImportSheet() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!file) return;
    if (!confirm("This replaces everything in the tracker with the spreadsheet's contents (your Etsy connection is kept). Continue?")) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/import/sheet", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: await file.arrayBuffer(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Import failed (${res.status})`);
      setResult(json);
      qc.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Import from Google Sheet</h1>
      <p className="mb-4 text-sm text-neutral-500">Loads your parts, settings, orders and history from the old tracker spreadsheet.</p>

      <ol className="mb-6 list-decimal space-y-1 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
        <li>
          In Google Sheets, open the tracker and choose <strong>File → Download → Microsoft Excel (.xlsx)</strong>.
        </li>
        <li>Pick that file below and click Import.</li>
      </ol>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <label className="flex-1 text-sm">
          <span className="sr-only">Spreadsheet file</span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className={fileInputClass}
          />
        </label>
        <button
          onClick={run}
          disabled={!file || busy}
          className={btn("primary", "md")}
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        Replaces parts, printers, recipes, schedule, listings, orders, replacements, expenses and mileage. Etsy ledger entries are merged. Your Etsy
        connection is kept. You can re-import any time — e.g. right before you stop using the sheet.
      </p>

      {error && <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {result && (
        <div className="mt-6 space-y-4">
          <div className="rounded border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/30">
            <p className="mb-2 font-medium text-emerald-800 dark:text-emerald-300">Imported</p>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {Object.entries(result.counts).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span>{LABELS[k] ?? k}</span>
                  <span className="font-medium">{v}</span>
                </li>
              ))}
            </ul>
          </div>
          {result.warnings.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
              <p className="mb-2 font-medium text-amber-800 dark:text-amber-300">Worth a look</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
