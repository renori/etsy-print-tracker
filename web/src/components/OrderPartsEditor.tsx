import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { partsApi, replacementsApi } from "../api/resources";
import type { Order } from "../api/types";
import { Button, Icon, inputClass } from "./ui";

type Row = { partId: string; quantity: number };

/**
 * On an Active Orders card: pick the parts an order needs by hand (custom or
 * private-listing orders the Listing Map can't know about), and/or mark the
 * order as the shipment of a replacement.
 */
export function OrderPartsEditor({ order }: { order: Order }) {
  const qc = useQueryClient();
  const refresh = () => {
    for (const k of ["orders", "replacements", "queue", "stock", "summary", "listing-mappings"]) qc.invalidateQueries({ queryKey: [k] });
  };
  const update = useMutation({
    mutationFn: (data: { parts?: Row[]; replacementId?: string | null }) => api.put<Order>(`/orders/${order.id}`, data),
    onSuccess: refresh,
  });
  const onUpdate = (data: { parts?: Row[]; replacementId?: string | null }) => update.mutate(data);
  const { data: parts } = partsApi.useList();
  const { data: replacements } = replacementsApi.useList();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const reset = useMutation({
    mutationFn: () => api.post<Order>(`/orders/${order.id}/auto-parts`, {}),
    onSuccess: refresh,
  });

  const open = (replacements ?? []).filter((r) => !r.shipped && (!r.order || r.order.id === order.id));
  const linked = order.replacement;
  const active = (parts ?? []).filter((p) => p.active || rows.some((r) => r.partId === p.id));

  const start = () => {
    setRows(order.parts.length ? order.parts.map((p) => ({ partId: p.partId, quantity: p.quantity })) : [{ partId: "", quantity: 1 }]);
    setEditing(true);
  };
  const save = () => {
    const clean = rows.filter((r) => r.partId && r.quantity > 0);
    const merged = [...clean.reduce((m, r) => m.set(r.partId, (m.get(r.partId) ?? 0) + r.quantity), new Map<string, number>())].map(([partId, quantity]) => ({ partId, quantity }));
    onUpdate({ parts: merged });
    setEditing(false);
  };

  return (
    <div className="mx-4 mb-3 space-y-2">
      {/* Replacement link */}
      {(linked || open.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Icon name="refresh" className="h-4 w-4 text-neutral-500" />
          <label htmlFor={`repl-${order.id}`} className="text-neutral-600 dark:text-neutral-400">
            Ships replacement
          </label>
          <select
            id={`repl-${order.id}`}
            value={order.replacementId ?? ""}
            onChange={(e) => onUpdate({ replacementId: e.target.value || null })}
            className={`${inputClass} h-10 w-auto min-w-48 py-0`}
          >
            <option value="">No, a normal order</option>
            {linked && !open.some((r) => r.id === linked.id) && <option value={linked.id}>{`${linked.code} · ${linked.buyerName}`}</option>}
            {open.map((r) => (
              <option key={r.id} value={r.id}>{`${r.code} · ${r.buyerName}`}</option>
            ))}
          </select>
          {linked && <span className="text-xs text-neutral-500">Uses its parts; shipping this order marks {linked.code} shipped.</span>}
        </div>
      )}

      {(update.error || reset.error) && <p className="text-sm text-red-700">{((update.error ?? reset.error) as Error).message.replace(/^.*failed \(\d+\): /, "").replace(/^\{"error":"(.*)"\}$/, "$1")}</p>}

      {/* Parts */}
      {editing ? (
        <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
          <div className="mb-2 text-sm font-medium">Parts this order needs</div>
          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <select
                  value={r.partId}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, partId: e.target.value } : x)))}
                  aria-label="Part"
                  className={`${inputClass} min-w-0 flex-1`}
                >
                  <option value="">Pick a part…</option>
                  {active.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={r.quantity}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, quantity: Math.max(0, Math.round(Number(e.target.value))) } : x)))}
                  aria-label="Quantity"
                  className={`${inputClass} !w-20 shrink-0`}
                />
                <button
                  type="button"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  aria-label="Remove part"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <Icon name="x" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button icon="plus" onClick={() => setRows([...rows, { partId: "", quantity: 1 }])}>
              Add part
            </Button>
            <Button variant="primary" onClick={save}>
              Save parts
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        !order.packed && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon="edit" onClick={start}>
              {order.parts.length ? "Edit parts" : "Pick parts"}
            </Button>
            {!order.parts.length && (
              <Link to="/listing-map" className="text-xs text-neutral-500 underline">
                or map the listing
              </Link>
            )}
            {order.partsManual && !order.replacementId && (
              <>
                <span className="text-xs text-neutral-500">Picked by hand.</span>
                <button type="button" onClick={() => reset.mutate()} disabled={reset.isPending} className="min-h-9 text-xs text-indigo-700 underline dark:text-indigo-400">
                  Use Listing Map instead
                </button>
              </>
            )}
          </div>
        )
      )}
    </div>
  );
}
