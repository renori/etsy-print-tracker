import { useState } from "react";
import { ordersApi, useEtsyStatus, useEtsySyncNow } from "../api/resources";
import type { Order } from "../api/types";
import { fmtDate, fmtMoney } from "../lib/format";
import { Button, EtsyOrderLink, PageHeader } from "../components/ui";

const pct = (m: number | null | undefined) => (m != null ? `${Math.round(m * 100)}%` : "—");

/** Country code for orders shipped abroad (blank for domestic / unknown). */
function Dest({ order }: { order: Order }) {
  const c = order.shipCountry;
  if (!c || c === "US") return null;
  return (
    <span className="ml-1.5 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300" title={`Shipped to ${c}`}>
      {c}
    </span>
  );
}

/** Label cost: shows the amount; tap to type one (net and margin recalculate). */
function LabelCost({ order }: { order: Order }) {
  const { mutate: update, isPending } = ordersApi.useUpdate();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const missing = order.labelCost == null;
  const start = () => {
    setValue(order.labelCost == null ? "" : String(order.labelCost));
    setEditing(true);
  };
  const commit = () => {
    if (isPending) return; // Enter and blur both commit; only the first one counts.
    const next = value.trim() === "" ? null : Number(value);
    if (next === order.labelCost || (next != null && Number.isNaN(next))) return setEditing(false);
    update({ id: order.id, data: { labelCost: next } }, { onSettled: () => setEditing(false) });
  };

  const est = order.labelCostSource === "estimate";
  const digital = order.digital && order.labelCostSource === "digital";
  const batch = order.labelCostSource === "batch";
  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        title={
          est
            ? `Estimate: ${order.labelCostNote ?? "from past labels"}. Tap to enter the real cost.`
            : digital
              ? "Digital download — no shipping label"
            : batch
              ? "From a batch of labels bought together; the batch total is exact — tap to correct"
              : undefined
        }
        className={`min-h-10 rounded-lg px-2 text-left tabular-nums md:min-h-8 ${
          missing ? "border border-dashed border-amber-400 text-amber-800 dark:text-amber-300" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
        }`}
        aria-label={missing ? `Add label cost for ${order.buyerName}` : `Edit label cost for ${order.buyerName}${est ? " (estimated)" : digital ? " (digital, no label)" : ""}`}
      >
        {missing ? (
          "+ label"
        ) : digital ? (
          <span className="text-neutral-500">Digital</span>
        ) : est ? (
          <span className="text-neutral-500 italic">≈ {fmtMoney(order.labelCost)}</span>
        ) : (
          <>
            {fmtMoney(order.labelCost)}
            {batch && <span className="ml-0.5 text-neutral-400">*</span>}
          </>
        )}
      </button>
    );
  }
  return (
    <form
      className="inline-flex"
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <input
        type="number"
        step="0.01"
        inputMode="decimal"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        readOnly={isPending}
        onBlur={commit}
        aria-label="Label cost"
        className="h-10 w-24 rounded-lg border border-neutral-300 bg-white px-2 tabular-nums md:h-8 dark:border-neutral-700 dark:bg-neutral-800"
      />
    </form>
  );
}

export function CompletedOrders() {
  const { data, isLoading } = ordersApi.useList();
  const { data: etsy } = useEtsyStatus();
  const sync = useEtsySyncNow();
  const shipped = (data ?? [])
    .filter((o) => o.status === "SHIPPED")
    .sort((a, b) => new Date(b.shippedAt ?? 0).getTime() - new Date(a.shippedAt ?? 0).getTime());

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const thisMonth = shipped.filter((o) => o.shippedAt && new Date(o.shippedAt) >= monthStart);
  const sum = (xs: Order[], k: "netProfit" | "etsyGross") => xs.reduce((s, o) => s + (o[k] ?? 0), 0);
  const pending = shipped.filter((o) => o.etsyEarnings == null).length;
  const noLabel = shipped.filter((o) => o.etsyEarnings != null && o.labelCost == null).length;
  const estimated = shipped.filter((o) => o.labelCostSource === "estimate").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Completed Orders"
        subtitle={`This month: ${thisMonth.length} shipped · ${fmtMoney(sum(thisMonth, "etsyGross"))} gross · ${fmtMoney(sum(thisMonth, "netProfit"))} net · all time ${fmtMoney(sum(shipped, "netProfit"))} net`}
        actions={
          etsy?.connected && (
            <Button icon="refresh" onClick={() => sync.mutate()} disabled={sync.isPending}>
              {sync.isPending ? "Syncing…" : "Sync Etsy"}
            </Button>
          )
        }
      />
      {(sync.data || sync.error) && (
        <p role="status" className={`text-sm ${sync.error ? "text-red-700" : "text-emerald-700 dark:text-emerald-400"}`}>
          {sync.error ? `Sync failed: ${(sync.error as Error).message}` : sync.data!.message}
        </p>
      )}
      {estimated > 0 && (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <span className="italic">≈</span> {estimated} label cost{estimated === 1 ? " is an estimate" : "s are estimates"}, based mostly on the shipping the
          buyer paid, then destination and box size (hover one to see how). They update automatically if Etsy's ledger gives an exact match, or tap
          one to enter the real cost.{" "}
          <span className="text-neutral-400">*</span> = from a batch of labels bought together (batch total exact).
        </p>
      )}
      {(pending > 0 || noLabel > 0) && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {pending > 0 && `${pending} order${pending === 1 ? "" : "s"} waiting on Etsy's ledger — numbers fill in on the next sync. `}
          {noLabel > 0 && `${noLabel} need${noLabel === 1 ? "s" : ""} a label cost — tap “+ label” to add it.`}
        </p>
      )}

      {isLoading ? (
        <p className="py-10 text-center text-neutral-500">Loading…</p>
      ) : (
        <>
          <ul className="space-y-2.5 md:hidden">
            {shipped.map((o) => (
              <li key={o.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">
                    {o.buyerName}
                    <Dest order={o} />
                  </span>
                  <span className="font-semibold tabular-nums">{fmtMoney(o.netProfit)}</span>
                </div>
                <div className="text-xs text-neutral-500">
                  <EtsyOrderLink id={o.etsyOrderId} /> · shipped {fmtDate(o.shippedAt)} · {pct(o.margin)} margin
                </div>
                {o.labelCostSource === "estimate" && o.labelCostNote && (
                  <p className="mt-1 text-xs text-neutral-500 italic">≈ label: {o.labelCostNote}</p>
                )}
                <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <dt className="text-neutral-500">Gross</dt>
                    <dd className="tabular-nums">{fmtMoney(o.etsyGross)}</dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Fees</dt>
                    <dd className="tabular-nums">{fmtMoney(o.etsyFees)}</dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Label</dt>
                    <dd>
                      <LabelCost order={o} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Production</dt>
                    <dd className="tabular-nums">{fmtMoney(o.productionCost)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm md:block dark:border-neutral-800 dark:bg-neutral-900">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-900">
                <tr>
                  {["Order", "Buyer", "Shipped", "Gross", "Tax", "Fees", "Ship paid", "Label", "Production", "Net profit", "Margin"].map((h) => (
                    <th key={h} className="px-3 py-2.5 font-medium text-neutral-600 dark:text-neutral-400">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shipped.map((o) => (
                  <tr key={o.id} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-3 py-2">
                      <EtsyOrderLink id={o.etsyOrderId} hash={false} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {o.buyerName}
                      <Dest order={o} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(o.shippedAt)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtMoney(o.etsyGross)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtMoney(o.salesTax)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtMoney(o.etsyFees)}</td>
                    <td className="px-3 py-2 tabular-nums text-neutral-500">{o.shippingPaid != null ? fmtMoney(o.shippingPaid) : "—"}</td>
                    <td className="px-1 py-1">
                      <LabelCost order={o} />
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmtMoney(o.productionCost)}</td>
                    <td className="px-3 py-2 font-semibold tabular-nums">{fmtMoney(o.netProfit)}</td>
                    <td className="px-3 py-2 tabular-nums">{pct(o.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
