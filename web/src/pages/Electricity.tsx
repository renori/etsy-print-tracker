import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { fmtMoney } from "../lib/format";
import { Button, PageHeader, inputClass } from "../components/ui";

interface Report {
  settings: { kwhRate: number | null; idleWattsPerPrinter: number; printersOn: number | null; bufferPct: number; printers: number; printersActive: number };
  months: { month: string; orders: number; units: number; unmatchedUnits: number; print: number; buffer: number; overhead: number; total: number }[];
  items: { text: string; units: number; partId: string | null; partName: string | null; via: "override" | "listing" | "name" | "none"; score: number; unitCost: number; costFrom: string }[];
  partCosts: { partId: string; name: string; units: number; unitCost: number; from: string }[];
  parts: { id: string; name: string; active: boolean }[];
}

const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" });
};
const cents = (n: number) => (n < 1 ? `${(n * 100).toFixed(1)}¢` : fmtMoney(n));

function Settings({ r, onSaved }: { r: Report; onSaved: (r: Report) => void }) {
  const s = r.settings;
  const [form, setForm] = useState({ kwhRate: "", idle: "", printers: "", buffer: "" });
  useEffect(() => {
    setForm({ kwhRate: s.kwhRate?.toString() ?? "", idle: String(s.idleWattsPerPrinter), printers: s.printersOn?.toString() ?? "", buffer: String(s.bufferPct) });
  }, [s.kwhRate, s.idleWattsPerPrinter, s.printersOn, s.bufferPct]);
  const save = useMutation({
    mutationFn: () =>
      api.put<Report>("/electricity/settings", {
        kwhRate: form.kwhRate.trim() ? Number(form.kwhRate) : null,
        idleWattsPerPrinter: Number(form.idle) || 0,
        printersOn: form.printers.trim() ? Number(form.printers) : null,
        bufferPct: Number(form.buffer) || 0,
      }),
    onSuccess: onSaved,
  });
  const monthlyOverhead = s.kwhRate ? (s.printers * s.idleWattsPerPrinter * 730 * s.kwhRate) / 1000 : null;
  const field = (key: keyof typeof form, label: string, hint: string, step = "any") => (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <input type="number" step={step} min="0" inputMode="decimal" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className={`${inputClass} mt-1`} />
      <span className="mt-0.5 block text-xs text-neutral-500">{hint}</span>
    </label>
  );
  return (
    <form
      className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2 className="font-semibold">Settings</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {field("kwhRate", "Electric rate ($/kWh)", s.kwhRate ? "From your utility bill." : "Needed for the always-on overhead; see your utility bill.")}
        {field("idle", "Idle watts per printer", "Draw while on but not printing (screen, fans, standby heaters).")}
        {field("printers", "Printers left on 24/7", `Blank = your ${s.printersActive} active printer${s.printersActive === 1 ? "" : "s"}.`, "1")}
        {field("buffer", "Buffer (%)", "Added to print electricity for failed prints, preheating and purges.")}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save and recalculate"}
        </Button>
        {monthlyOverhead != null && (
          <span className="text-sm text-neutral-500">
            Always-on overhead ≈ {fmtMoney(monthlyOverhead)}/month ({s.printers} × {s.idleWattsPerPrinter} W × 24 h × 30.4 days)
          </span>
        )}
        {save.error && <span className="text-sm text-red-700">{(save.error as Error).message}</span>}
      </div>
    </form>
  );
}

export function Electricity() {
  const qc = useQueryClient();
  const { data: r, isLoading } = useQuery({ queryKey: ["electricity"], queryFn: () => api.get<Report>("/electricity/report") });
  const set = (next: Report) => {
    qc.setQueryData(["electricity"], next);
    for (const k of ["expenses", "summary", "tax-export"]) qc.invalidateQueries({ queryKey: [k] });
  };
  const match = useMutation({ mutationFn: (b: { text: string; partId?: string | null }) => api.put<Report>("/electricity/matches", b), onSuccess: set });
  const years = [...new Set((r?.months ?? []).map((m) => m.month.slice(0, 4)))].sort().reverse();
  const [year, setYear] = useState<string | null>(null);
  const shownYear = year ?? years[0] ?? String(new Date().getFullYear());
  const months = (r?.months ?? []).filter((m) => m.month.startsWith(shownYear));
  const sum = (k: "units" | "print" | "buffer" | "overhead" | "total") => months.reduce((s, m) => s + m[k], 0);
  const needsLook = (r?.items ?? []).filter((i) => i.via === "none" || (i.via !== "override" && i.score < 0.75));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Electricity COGS"
        subtitle="Printer electricity for what you sold, booked as one cost-of-goods expense per month (dated the last day) and updated automatically as orders are completed."
      />
      {isLoading || !r ? (
        <p className="py-10 text-center text-neutral-500">Working it out…</p>
      ) : (
        <>
          <Settings r={r} onSaved={set} />

          <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">By month</h2>
              {years.length > 1 && (
                <select value={shownYear} onChange={(e) => setYear(e.target.value)} aria-label="Year" className={`${inputClass} w-auto`}>
                  {years.map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-right text-sm tabular-nums">
                <thead className="text-neutral-500">
                  <tr>
                    <th className="py-1.5 text-left font-medium">Month</th>
                    <th className="py-1.5 font-medium">Items</th>
                    <th className="py-1.5 font-medium">Printing</th>
                    <th className="py-1.5 font-medium">Buffer</th>
                    <th className="py-1.5 font-medium">Always on</th>
                    <th className="py-1.5 font-medium">Expense</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.month} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="py-1.5 text-left">{monthLabel(m.month)}</td>
                      <td className="py-1.5">
                        {m.units}
                        {m.unmatchedUnits > 0 && <span className="text-amber-700 dark:text-amber-400" title="Items not matched to a part (no electricity counted)"> +{m.unmatchedUnits}?</span>}
                      </td>
                      <td className="py-1.5">{fmtMoney(m.print)}</td>
                      <td className="py-1.5">{fmtMoney(m.buffer)}</td>
                      <td className="py-1.5">{fmtMoney(m.overhead)}</td>
                      <td className="py-1.5 font-semibold">{fmtMoney(m.total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-neutral-200 font-semibold dark:border-neutral-700">
                    <td className="py-1.5 text-left">{shownYear}</td>
                    <td className="py-1.5">{sum("units")}</td>
                    <td className="py-1.5">{fmtMoney(sum("print"))}</td>
                    <td className="py-1.5">{fmtMoney(sum("buffer"))}</td>
                    <td className="py-1.5">{fmtMoney(sum("overhead"))}</td>
                    <td className="py-1.5">{fmtMoney(sum("total"))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              Each month's total is an Expenses entry (category Electricity, “Part III COGS – other costs”) dated the month's last day, so it shows in the
              monthly breakdown and the Tax Export. Items are counted in the month their order was completed.
            </p>
          </section>

          {r.items.length > 0 && (
            <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="font-semibold">Older items matched by name</h2>
              <p className="mt-0.5 text-sm text-neutral-500">
                Orders with no parts linked are matched to the closest-named part or listing.{" "}
                {needsLook.length ? `${needsLook.length} could use a look (unmatched or a weak match), listed first.` : "All look like confident matches."} Pick a
                part to fix one; every order with that item updates.
              </p>
              <ul className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
                {r.items.map((i) => (
                  <li key={i.text} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2.5">
                    <div className="min-w-0 flex-1 basis-64">
                      <div className="text-sm">{i.text}</div>
                      <div className="text-xs text-neutral-500">
                        {i.units} sold ·{" "}
                        {i.via === "none" ? (
                          <span className="font-medium text-amber-700 dark:text-amber-400">no match, not counted</span>
                        ) : i.via === "override" ? (
                          "set by you"
                        ) : (
                          <span className={i.score < 0.75 ? "font-medium text-amber-700 dark:text-amber-400" : ""}>
                            {Math.round(i.score * 100)}% name match{i.via === "listing" ? " via a listing" : ""}
                          </span>
                        )}
                        {i.partId && ` · ${cents(i.unitCost)} each`}
                      </div>
                    </div>
                    <select
                      value={i.via === "override" ? (i.partId ?? "__none") : i.via === "none" ? "" : `auto:${i.partId}`}
                      disabled={match.isPending}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v.startsWith("auto:") || v === "") match.mutate({ text: i.text });
                        else match.mutate({ text: i.text, partId: v === "__none" ? null : v });
                      }}
                      aria-label={`Part for ${i.text}`}
                      className={`${inputClass} w-full sm:w-72`}
                    >
                      {i.via === "none" ? <option value="">Pick a part…</option> : <option value={`auto:${i.partId}`}>Auto: {i.partName}</option>}
                      <option value="__none">Not a printed item (no electricity)</option>
                      {r.parts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.active ? "" : " (inactive)"}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {r.partCosts.some((p) => p.from !== "catalog") && (
            <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="font-semibold">Parts with no electricity cost in the catalog</h2>
              <p className="mt-0.5 text-sm text-neutral-500">
                Worked out from print time, or borrowed from the closest-named part. Set the real cost in the Parts catalog to replace these.
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {r.partCosts
                  .filter((p) => p.from !== "catalog")
                  .map((p) => (
                    <li key={p.partId} className="flex gap-3">
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="text-neutral-500">{p.from === "unknown" ? "no cost found, counted as $0" : p.from}</span>
                      <span className="w-16 text-right tabular-nums">{cents(p.unitCost)}</span>
                      <span className="w-16 text-right text-neutral-500 tabular-nums">×{p.units}</span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
