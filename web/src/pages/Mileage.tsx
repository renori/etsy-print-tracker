import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ResourceTablePage } from "../components/ResourceTablePage";
import { mileageApi } from "../api/resources";
import { api } from "../api/client";
import type { MileageEntry } from "../api/types";
import type { Column } from "../components/DataTable";
import { localDateInput, type FieldConfig, type Suggestion } from "../components/FieldForm";
import { fmtDate, fmtMoney } from "../lib/format";

import { btn } from "../components/ui";
interface Summary {
  totalMiles: number;
  totalDeduction: number;
  byYear: { year: number; miles: number; deduction: number }[];
}

interface IrsRate {
  from: string;
  rate: number;
  source: string;
}

const cents = (r: number) => `${(r * 100).toFixed(1).replace(/\.0$/, "")}¢`;

const columns: Column<MileageEntry>[] = [
  { key: "date", label: "Date", render: (m) => fmtDate(m.date) },
  { key: "destination", label: "Destination" },
  { key: "purpose", label: "Purpose" },
  { key: "miles", label: "Miles" },
  { key: "ratePerMile", label: "Rate", render: (m) => `${cents(m.ratePerMile)}/mi` },
  { key: "deduction", label: "Deduction", render: (m) => fmtMoney(m.miles * m.ratePerMile) },
];

/** Most-used values first, ties broken by most recent; each remembers its latest trip. */
function history(trips: MileageEntry[], key: "destination" | "purpose") {
  const seen = new Map<string, { count: number; latest: MileageEntry }>();
  for (const t of trips) {
    const v = t[key]?.trim();
    if (!v) continue;
    const cur = seen.get(v);
    if (!cur) seen.set(v, { count: 1, latest: t });
    else {
      cur.count++;
      if (new Date(t.date) > new Date(cur.latest.date)) cur.latest = t;
    }
  }
  return [...seen.entries()]
    .sort((a, b) => b[1].count - a[1].count || new Date(b[1].latest.date).getTime() - new Date(a[1].latest.date).getTime())
    .map(([value, { latest }]) => ({ value, latest }));
}

function buildFields(trips: MileageEntry[]): FieldConfig[] {
  const destinations: Suggestion[] = history(trips, "destination").map(({ value, latest }) => ({
    value,
    hint: `${latest.miles} mi`,
    fills: { miles: latest.miles, purpose: latest.purpose ?? "" },
  }));
  const purposes: Suggestion[] = history(trips, "purpose").map(({ value }) => ({ value }));
  return [
    { key: "date", label: "Date", type: "date", required: true, defaultValue: localDateInput(new Date()) },
    { key: "destination", label: "Destination", type: "text", required: true, suggestions: destinations },
    { key: "purpose", label: "Purpose", type: "text", suggestions: purposes },
    { key: "miles", label: "Miles", type: "number", required: true },
    { key: "ratePerMile", label: "Rate per mile ($) — leave blank for the IRS rate on that date", type: "number" },
  ];
}

export function Mileage() {
  const qc = useQueryClient();
  const { data: summary } = useQuery({ queryKey: ["mileage", "summary"], queryFn: () => api.get<Summary>("/mileage/summary") });
  const { data: rates } = useQuery({ queryKey: ["mileage", "irs-rates"], queryFn: () => api.get<IrsRate[]>("/mileage/irs-rates") });
  const applyIrs = useMutation({
    mutationFn: () => api.post<{ changed: number; total: number }>("/mileage/apply-irs-rates"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mileage"] }),
  });

  const [params] = useSearchParams();
  const { data: trips } = mileageApi.useList();
  const fields = useMemo(() => buildFields(trips ?? []), [trips]);
  const current = rates?.[rates.length - 1];

  return (
    <div className="space-y-6">
      <ResourceTablePage
        title="Mileage Log"
        itemLabel="trip"
        startAdding={params.get("add") === "1"}
        description={
          current
            ? `New trips use the IRS business rate for their date (currently ${cents(current.rate)}/mi since ${fmtDate(current.from + "T00:00:00")}).`
            : undefined
        }
        hooks={mileageApi}
        columns={columns}
        fields={fields}
      />

      {summary && summary.byYear.length > 0 && (
        <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-2 font-medium">Deduction by tax year</h2>
          <ul className="space-y-1 text-sm">
            {summary.byYear.map((y) => (
              <li key={y.year} className="flex justify-between gap-3">
                <span>{y.year}</span>
                <span>
                  {y.miles.toFixed(1)} mi · <span className="font-semibold">{fmtMoney(y.deduction)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">IRS business mileage rates</h2>
          <button
            onClick={() => confirm("Set every trip's rate to the IRS rate for its date? Any rates you typed by hand will be overwritten.") && applyIrs.mutate()}
            disabled={applyIrs.isPending}
            className={btn("secondary")}
          >
            {applyIrs.isPending ? "Applying…" : "Apply IRS rates to all trips"}
          </button>
        </div>
        {applyIrs.data && (
          <p className="mt-2 text-sm text-emerald-700">
            Updated {applyIrs.data.changed} of {applyIrs.data.total} trips.
          </p>
        )}
        <ul className="mt-3 space-y-1 text-sm">
          {[...(rates ?? [])].reverse().map((r) => (
            <li key={r.from} className="flex flex-wrap justify-between gap-x-3">
              <span>From {fmtDate(r.from + "T00:00:00")}</span>
              <span>
                <span className="font-semibold">{cents(r.rate)}/mi</span> <span className="text-neutral-500">· {r.source}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
