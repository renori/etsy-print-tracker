import { useMemo, useState } from "react";
import type { Expense } from "../api/types";
import { fmtDate, fmtMoney } from "../lib/format";
import { IconButton } from "../components/ui";

const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
const isAuto = (e: Expense) => /^Auto-logged/.test(e.notes ?? "");

/**
 * One month's expenses, added up the same way as the Home page's
 * "Expenses" figure: every expense dated in that month, whatever its
 * category or deductible setting. Mileage, label costs and production costs
 * on orders are not in it.
 */
export function ExpenseMonth({ rows }: { rows: Expense[] }) {
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const month = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + offset, 1);
  }, [offset]);

  const inMonth = rows.filter((e) => monthKey(new Date(e.date)) === monthKey(month));
  const total = inMonth.reduce((s, e) => s + e.cost, 0);
  const nonDeductible = inMonth.filter((e) => !e.deductible).reduce((s, e) => s + e.cost, 0);
  const auto = inMonth.filter(isAuto).reduce((s, e) => s + e.cost, 0);

  const byCategory = new Map<string, Expense[]>();
  for (const e of inMonth) {
    const k = e.category?.trim() || "Uncategorized";
    byCategory.set(k, [...(byCategory.get(k) ?? []), e]);
  }
  const groups = [...byCategory]
    .map(([category, items]) => ({ category, items: items.sort((a, b) => b.cost - a.cost), sum: items.reduce((s, e) => s + e.cost, 0) }))
    .sort((a, b) => b.sum - a.sum);

  const label = month.toLocaleString(undefined, { month: "long", year: "numeric" });

  return (
    <section className="mb-5 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between gap-3">
        <IconButton icon="chevronLeft" label="Previous month" onClick={() => setOffset((o) => o - 1)} />
        <div className="text-center">
          <div className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">{label}</div>
          <div className="text-2xl font-semibold tabular-nums">{fmtMoney(total)}</div>
          <div className="text-xs text-neutral-500">
            {inMonth.length} expense{inMonth.length === 1 ? "" : "s"}
            {nonDeductible > 0 && ` · ${fmtMoney(nonDeductible)} not deductible`}
            {auto > 0 && ` · ${fmtMoney(auto)} auto-logged for replacements`}
          </div>
        </div>
        <IconButton icon="chevron" label="Next month" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset === 0} />
      </div>

      {groups.length > 0 && (
        <ul className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
          {groups.map((g) => (
            <li key={g.category}>
              <button
                type="button"
                onClick={() => setOpen(open === g.category ? null : g.category)}
                aria-expanded={open === g.category}
                className="flex min-h-11 w-full items-center gap-3 py-1 text-left"
              >
                <span className="flex-1 font-medium">
                  {g.category} <span className="font-normal text-neutral-500">· {g.items.length}</span>
                </span>
                <span className="w-24 text-right tabular-nums">{fmtMoney(g.sum)}</span>
                <span className="w-10 text-right text-xs text-neutral-500 tabular-nums">{total ? Math.round((g.sum / total) * 100) : 0}%</span>
              </button>
              {open === g.category && (
                <ul className="mb-2 space-y-1 rounded-lg bg-neutral-50 p-2 text-sm dark:bg-neutral-800/50">
                  {g.items.map((e) => (
                    <li key={e.id} className="flex gap-3">
                      <span className="w-20 shrink-0 text-neutral-500">{fmtDate(e.date)}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {e.item}
                        {e.vendor && <span className="text-neutral-500"> · {e.vendor}</span>}
                        {!e.deductible && <span className="text-amber-700 dark:text-amber-400"> · not deductible</span>}
                        {isAuto(e) && <span className="text-neutral-500"> · auto</span>}
                      </span>
                      <span className="tabular-nums">{fmtMoney(e.cost)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-neutral-500">
        Same total as Home: every expense dated in the month, deductible or not. Not included: mileage (tracked separately as a deduction) and each
        order's label and production costs (already taken out of that order's net profit).
      </p>
    </section>
  );
}
