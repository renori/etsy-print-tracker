import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ResourceTablePage } from "../components/ResourceTablePage";
import { expensesApi } from "../api/resources";
import { api } from "../api/client";
import type { Expense } from "../api/types";
import type { Column } from "../components/DataTable";
import { localDateInput, type FieldConfig, type Suggestion } from "../components/FieldForm";
import { fmtDate, fmtMoney } from "../lib/format";
import { ExpenseImport } from "./ExpenseImport";
import { Button, Icon, btn } from "../components/ui";
import { ExpenseMonth } from "./ExpenseMonth";

const columns: Column<Expense>[] = [
  { key: "date", label: "Date", render: (e) => fmtDate(e.date) },
  { key: "item", label: "Item" },
  { key: "vendor", label: "Vendor" },
  { key: "category", label: "Category" },
  { key: "cost", label: "Cost", render: (e) => fmtMoney(e.cost) },
  { key: "scheduleCLine", label: "Schedule C line" },
  { key: "deductible", label: "Deductible", render: (e) => (e.deductible ? "Yes" : "No") },
];

type Key = "item" | "vendor" | "category" | "scheduleCLine" | "paidWith";

/** Values most used first (ties: most recent), each with the latest expense that used it. Expects rows newest-first. */
function history(rows: Expense[], key: Key) {
  const seen = new Map<string, { count: number; latest: Expense }>();
  for (const e of rows) {
    const v = e[key]?.trim();
    if (!v) continue;
    const cur = seen.get(v);
    if (cur) cur.count++;
    else seen.set(v, { count: 1, latest: e });
  }
  return [...seen.entries()].sort((a, b) => b[1].count - a[1].count).map(([value, { latest }]) => ({ value, latest }));
}

function buildFields(rows: Expense[]): FieldConfig[] {
  const plain = (key: Key): Suggestion[] => history(rows, key).map(({ value }) => ({ value }));
  // Picking a value fills the related blanks from the last time you used it.
  const vendors: Suggestion[] = history(rows, "vendor").map(({ value, latest }) => ({
    value,
    fills: { category: latest.category, scheduleCLine: latest.scheduleCLine, paidWith: latest.paidWith, deductible: latest.deductible },
  }));
  const categories: Suggestion[] = history(rows, "category").map(({ value, latest }) => ({
    value,
    fills: { scheduleCLine: latest.scheduleCLine, deductible: latest.deductible },
  }));
  const items: Suggestion[] = history(rows, "item").map(({ value, latest }) => ({
    value,
    hint: fmtMoney(latest.cost),
    fills: { vendor: latest.vendor, category: latest.category, scheduleCLine: latest.scheduleCLine, paidWith: latest.paidWith, cost: latest.cost },
  }));
  return [
    { key: "date", label: "Date", type: "date", required: true, defaultValue: localDateInput(new Date()) },
    { key: "item", label: "Item", type: "text", required: true, suggestions: items },
    { key: "vendor", label: "Vendor", type: "text", suggestions: vendors },
    { key: "category", label: "Category", type: "text", suggestions: categories },
    { key: "cost", label: "Cost", type: "number", required: true },
    { key: "scheduleCLine", label: "Schedule C line", type: "text", suggestions: plain("scheduleCLine") },
    { key: "deductible", label: "Deductible", type: "boolean", defaultValue: true },
    { key: "paidWith", label: "Paid with", type: "text", suggestions: plain("paidWith") },
    { key: "invoiceRef", label: "Invoice / order #", type: "text" },
    { key: "taxYear", label: "Tax year (blank = year of the date)", type: "number" },
    { key: "notes", label: "Notes", type: "text" },
  ];
}

export function Expenses() {
  const { data: rows } = expensesApi.useList();
  const fields = useMemo(() => buildFields(rows ?? []), [rows]);
  const [params, setParams] = useSearchParams();
  const [importing, setImporting] = useState(params.get("receipt") === "1");
  const { data: totals } = useQuery({
    queryKey: ["expenses", "totals-by-schedule-c"],
    queryFn: () => api.get<Record<string, number>>("/expenses/totals-by-schedule-c"),
  });

  return (
    <div>
      <ExpenseMonth rows={rows ?? []} />
      <ResourceTablePage
        title="Expenses"
        itemLabel="expense"
        hooks={expensesApi}
        columns={columns}
        fields={fields}
        actions={
          <>
            <Link to="/taxes" className={btn("secondary", "md")}>
              <Icon name="download" className="h-4 w-4" />
              Export for taxes
            </Link>
            <Button icon="receipt" onClick={() => setImporting(true)}>
              Add from receipt
            </Button>
          </>
        }
      />
      {importing && (
        <ExpenseImport
          history={rows ?? []}
          onClose={() => {
            setImporting(false);
            if (params.has("receipt")) setParams({}, { replace: true });
          }}
        />
      )}
      {totals && Object.keys(totals).length > 0 && (
        <div className="mt-6 rounded border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-2 font-medium text-neutral-700 dark:text-neutral-300">Deductible totals by Schedule C line</h2>
          <ul className="space-y-1 text-sm">
            {Object.entries(totals).map(([line, total]) => (
              <li key={line} className="flex justify-between gap-3">
                <span>{line}</span>
                <span className="font-medium">{fmtMoney(total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
