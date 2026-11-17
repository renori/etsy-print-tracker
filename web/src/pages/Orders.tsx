import { useMemo, useState } from "react";
import { boxesApi, ordersApi, usePackOrders, useShipOrders } from "../api/resources";
import type { Box, Order, OrderStatus } from "../api/types";
import { fmtDate } from "../lib/format";
import { Button, EtsyOrderLink, Icon, PageHeader, inputClass } from "../components/ui";
import { ExportQuote } from "../components/ExportQuote";
import { OrderPartsEditor } from "../components/OrderPartsEditor";

const STATUS_LABEL: Record<OrderStatus, string> = {
  NEEDS_PRINTING: "Needs printing",
  PRINTING: "Printing",
  READY_FROM_STOCK: "Ready (from stock)",
  READY_LABEL_BOUGHT: "Ready · label bought",
  PACKED: "Packed",
  SHIPPED: "Shipped",
};

const STATUS_OPTIONS = Object.keys(STATUS_LABEL) as OrderStatus[];

const normBox = (s: string) => s.toLowerCase().replace(/×/g, "x").replace(/\s+/g, "");

interface BoxLine {
  name: string;
  needed: number;
  onHand: number | null; // null = this size isn't on the Shipping Boxes page
}

function summarize(selected: Order[], boxes: Box[]): { lines: BoxLine[]; noBox: number } {
  const counts = new Map<string, { name: string; needed: number }>();
  let noBox = 0;
  for (const o of selected) {
    if (o.packed) continue; // its box is already off the shelf
    if (!o.boxName) {
      noBox++;
      continue;
    }
    const key = normBox(o.boxName);
    const cur = counts.get(key) ?? { name: o.boxName, needed: 0 };
    cur.needed++;
    counts.set(key, cur);
  }
  const lines = [...counts.entries()]
    .map(([key, { name, needed }]) => {
      const box = boxes.find((b) => normBox(b.name) === key);
      return { name: box?.name ?? name, needed, onHand: box ? box.onHand : null };
    })
    .sort((a, b) => b.needed - a.needed);
  return { lines, noBox };
}

export function Orders() {
  // New Etsy orders arrive via the server's 15-minute sync; re-check every minute so they show up without a reload.
  const { data, isLoading } = ordersApi.useList({ refetchInterval: 60_000 });
  const { mutate: pack, isPending: packing } = usePackOrders();
  const { mutate: ship, isPending: shipping } = useShipOrders();
  const { data: boxes } = boxesApi.useList();
  const { mutate: update } = ordersApi.useUpdate();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const open = (data ?? []).filter((o) => o.status !== "SHIPPED").sort((a, b) => new Date(a.orderedAt).getTime() - new Date(b.orderedAt).getTime());
  const unpacked = open.filter((o) => !o.packed);
  // Packed + label bought = nothing left to do but drop it off.
  const handled = open.filter((o) => o.packed && o.labelBought);
  const todo = open.filter((o) => !(o.packed && o.labelBought));
  const selectedOrders = open.filter((o) => selected.has(o.id));
  const summary = useMemo(() => summarize(selectedOrders, boxes ?? []), [selectedOrders, boxes]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <PageHeader
        title="Active Orders"
        subtitle={`${todo.length} to handle · ${unpacked.length} to pack${handled.length ? ` · ${handled.length} ready to drop off` : ""}`}
        actions={
          <>
            {selected.size > 0 && (
              <Button variant="ghost" icon="x" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            )}
            <Button icon="check" onClick={() => setSelected(new Set(unpacked.map((o) => o.id)))} disabled={unpacked.length === 0}>
              Select all unpacked
            </Button>
          </>
        }
      />

      {selected.size > 0 && (
        <BoxSummary
          count={selected.size}
          lines={summary.lines}
          noBox={summary.noBox}
          toPack={selectedOrders.filter((o) => !o.packed).length}
          toUnpack={selectedOrders.filter((o) => o.packed).length}
          busy={packing}
          onPack={(packed) =>
            pack(
              { ids: selectedOrders.filter((o) => o.packed !== packed).map((o) => o.id), packed },
              { onSuccess: () => setSelected(new Set()) }
            )
          }
        />
      )}

      {isLoading ? (
        <p className="py-10 text-center text-neutral-500">Loading…</p>
      ) : (
        <div className="space-y-3">
          {todo.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              boxes={boxes ?? []}
              selected={selected.has(order.id)}
              onToggleSelect={() => toggle(order.id)}
              onUpdate={(patch) => update({ id: order.id, data: patch })}
            />
          ))}
          {todo.length === 0 && (
            <p className="rounded-xl border border-dashed border-neutral-300 py-10 text-center text-neutral-500 dark:border-neutral-700">
              {open.length ? "Everything is packed and labelled." : "No open orders."}
            </p>
          )}

          {handled.length > 0 && (
            <section aria-label="Handled orders" className="space-y-3 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-semibold">
                    <Icon name="check" className="h-5 w-5 text-emerald-600" />
                    Handled · {handled.length}
                  </h2>
                  <p className="text-sm text-neutral-500">Packed and label bought — ready to drop off.</p>
                </div>
                <Button
                  variant="success"
                  icon="check"
                  disabled={shipping}
                  onClick={() => confirm(`Mark ${handled.length} handled order${handled.length === 1 ? "" : "s"} as shipped? They'll move to Completed Orders.`) && ship(handled.map((o) => o.id))}
                >
                  {shipping ? "Saving…" : `Dropped off · mark ${handled.length} shipped`}
                </Button>
              </div>
              {handled.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  boxes={boxes ?? []}
                  selected={selected.has(order.id)}
                  onToggleSelect={() => toggle(order.id)}
                  onUpdate={(patch) => update({ id: order.id, data: patch })}
                />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function BoxSummary({
  count,
  lines,
  noBox,
  toPack,
  toUnpack,
  busy,
  onPack,
}: {
  count: number;
  lines: BoxLine[];
  noBox: number;
  toPack: number;
  toUnpack: number;
  busy: boolean;
  onPack: (packed: boolean) => void;
}) {
  return (
    <section
      aria-label="Boxes to pull"
      aria-live="polite"
      className="sticky top-14 z-20 mb-4 rounded-xl border border-indigo-200 bg-indigo-50/95 p-3.5 shadow-md backdrop-blur md:top-2 dark:border-indigo-800 dark:bg-indigo-950/90"
    >
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-indigo-900 dark:text-indigo-200">
        <Icon name="box" className="h-4.5 w-4.5" />
        Boxes to pull · {count} order{count === 1 ? "" : "s"}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {lines.map((l) => {
          const short = l.onHand != null && l.onHand < l.needed;
          return (
            <li
              key={l.name}
              className={`flex items-baseline gap-1.5 rounded-lg border px-3 py-2 text-sm ${
                short ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200" : "border-indigo-200 bg-white text-neutral-800 dark:border-indigo-800 dark:bg-neutral-900 dark:text-neutral-200"
              }`}
            >
              <span className="text-lg font-bold tabular-nums">{l.needed}×</span>
              <span className="font-medium">{l.name}</span>
              <span className="text-xs">
                {l.onHand == null ? "· not tracked" : short ? `· only ${l.onHand} on hand` : `· ${l.onHand} on hand`}
              </span>
              {short && <Icon name="alert" className="h-4 w-4 self-center" aria-label="Not enough" />}
            </li>
          );
        })}
        {noBox > 0 && (
          <li className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {noBox} order{noBox === 1 ? "" : "s"} with no box set
          </li>
        )}
        {lines.length === 0 && noBox === 0 && <li className="text-sm text-indigo-900 dark:text-indigo-200">All selected orders are already packed.</li>}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {toPack > 0 && (
          <Button variant="primary" icon="check" disabled={busy} onClick={() => onPack(true)} className="flex-1 sm:flex-none">
            {busy ? "Packing…" : `Mark ${toPack} packed`}
          </Button>
        )}
        {toUnpack > 0 && (
          <Button icon="refresh" disabled={busy} onClick={() => onPack(false)} className="flex-1 sm:flex-none">
            Un-pack {toUnpack}
          </Button>
        )}
      </div>
    </section>
  );
}

const PILL: Record<OrderStatus, string> = {
  NEEDS_PRINTING: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  PRINTING: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  READY_FROM_STOCK: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  READY_LABEL_BOUGHT: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  PACKED: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200",
  SHIPPED: "bg-neutral-200 text-neutral-800",
};

function OrderCard({
  order,
  boxes,
  selected,
  onToggleSelect,
  onUpdate,
}: {
  order: Order;
  boxes: Box[];
  selected: boolean;
  onToggleSelect: () => void;
  onUpdate: (data: Partial<Order>) => void;
}) {
  // Keep the order's current box in the list even if it isn't tracked yet.
  const boxNames = [...new Set([...boxes.map((b) => b.name), ...(order.boxName ? [order.boxName] : [])])];
  const handled = order.packed && order.labelBought;
  const tracking = order.trackingNumber ? `${order.carrier ? order.carrier + " " : ""}···${order.trackingNumber.slice(-4)}` : null;

  return (
    <article
      className={`rounded-xl border shadow-sm transition-colors ${
        handled ? "border-neutral-200 bg-neutral-100 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/50" : "bg-white dark:bg-neutral-900"
      } ${selected ? "border-indigo-400 ring-2 ring-indigo-200 dark:ring-indigo-900" : handled ? "" : "border-neutral-200 dark:border-neutral-800"}`}
    >
      <label className="flex cursor-pointer gap-3 p-4 pb-3">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} className="mt-0.5 shrink-0" aria-label={`Select order ${order.etsyOrderId}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className={`text-base font-semibold ${handled ? "text-neutral-600 dark:text-neutral-400" : ""}`}>{order.buyerName}</span>
            {handled ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-neutral-200 px-2.5 py-0.5 text-xs font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                <Icon name="check" className="h-3.5 w-3.5" />
                Handled
              </span>
            ) : (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[order.status]}`}>{STATUS_LABEL[order.status]}</span>
            )}
          </div>
          <div className="text-xs text-neutral-500">
            <EtsyOrderLink id={order.etsyOrderId} />
          </div>
          {handled ? (
            <div className="mt-1 text-sm">
              {order.itemsRaw.split("\n")[0]}
              {order.boxName && ` · ${order.boxName}`}
              {tracking && ` · ${tracking}`}
            </div>
          ) : (
            <>
              <div className="mt-1.5 text-sm whitespace-pre-line text-neutral-700 dark:text-neutral-300">{order.itemsRaw}</div>
              {order.parts.length > 0 ? (
                <div className="mt-1 text-xs text-neutral-500">Needs {order.parts.map((p) => `${p.quantity}× ${p.part?.name ?? p.partId}`).join(", ")}</div>
              ) : (
                !order.packed && (
                  <div className="mt-1.5 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-amber-100 px-2.5 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    <Icon name="alert" className="h-3.5 w-3.5" />
                    Not linked to stock: pick its parts below
                  </div>
                )
              )}
              <div className="mt-1.5 text-xs text-neutral-500">
                Ordered {fmtDate(order.orderedAt)} · ship by {fmtDate(order.etsyShipBy)}
                {order.labelBought && tracking && ` · ${tracking}`}
              </div>
            </>
          )}
        </div>
      </label>
      {!handled && <OrderPartsEditor order={order} />}
      {!order.labelBought && <ExportQuote order={order} onUpdate={onUpdate} />}
      <div
        className={`grid grid-cols-2 gap-2 border-t p-3 ${handled ? "border-neutral-200 sm:grid-cols-2 dark:border-neutral-800" : "border-neutral-100 sm:grid-cols-[1fr_1fr_auto_auto] dark:border-neutral-800"}`}
      >
        {!handled && (
          <>
            <select value={order.status} onChange={(e) => onUpdate({ status: e.target.value as OrderStatus })} aria-label="Status" className={`${inputClass} col-span-2 sm:col-span-1`}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <select value={order.boxName ?? ""} onChange={(e) => onUpdate({ packageType: e.target.value || null })} aria-label="Box" className={`${inputClass} col-span-2 sm:col-span-1`}>
              <option value="">No box set</option>
              {boxNames.map((n) => (
                <option key={n} value={n}>
                  Box: {n}
                </option>
              ))}
            </select>
          </>
        )}
        <Button
          variant={order.labelBought ? (handled ? "ghost" : "success") : "secondary"}
          icon={order.labelBought ? "check" : "receipt"}
          aria-pressed={order.labelBought}
          title={order.labelBought ? "Label bought — tap to undo" : "Mark the shipping label as bought"}
          onClick={() => onUpdate({ labelBought: !order.labelBought })}
        >
          {order.labelBought ? "Label bought" : "Label bought?"}
        </Button>
        <Button
          variant={order.packed ? (handled ? "ghost" : "success") : "secondary"}
          icon={order.packed ? "check" : "box"}
          aria-pressed={order.packed}
          title={order.packed ? "Packed — tap to un-pack" : "Mark packed"}
          onClick={() => onUpdate({ packed: !order.packed })}
        >
          {order.packed ? "Packed" : "Mark packed"}
        </Button>
      </div>
    </article>
  );
}
