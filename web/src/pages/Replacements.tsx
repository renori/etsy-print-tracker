import { useState } from "react";
import { replacementsApi, useShipReplacement } from "../api/resources";
import { fmtDate, fmtMoney } from "../lib/format";
import { Modal } from "../components/Modal";
import { PartsPicker, type PartQtyRow } from "../components/PartsPicker";
import { Button, EtsyOrderLink, btn, inputClass } from "../components/ui";

export function Replacements() {
  const { data, isLoading } = replacementsApi.useList();
  const { mutate: create } = replacementsApi.useCreate();
  const { mutate: ship } = useShipReplacement();
  const [labelCostDraft, setLabelCostDraft] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Replacements</h1>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          New Replacement
        </Button>
      </div>
      <p className="mb-4 text-sm text-neutral-500">Shipping logs a COGS expense automatically, plus a shipping line if you give it a label cost.</p>
      {isLoading ? (
        <p className="text-neutral-400">Loading…</p>
      ) : (
        <div className="space-y-3">
          {data?.map((r) => (
            <div key={r.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium">
                    {r.code} — {r.buyerName}
                  </div>
                  <div className="text-sm text-neutral-500">
                    Needs: {r.parts.map((p) => `${p.quantity}× ${p.part?.name ?? p.partId}`).join(", ")}
                  </div>
                  {r.order && (
                    <div className="mt-0.5 text-sm">
                      Ships as Etsy order <EtsyOrderLink id={r.order.etsyOrderId} />
                      {r.order.status !== "SHIPPED" && <span className="text-neutral-500"> · marked shipped when that order ships</span>}
                    </div>
                  )}
                  <div className="text-xs text-neutral-400">
                    Requested {fmtDate(r.requestedAt)} · COGS logged {fmtDate(r.cogsLoggedAt)} · Label logged {fmtDate(r.labelLoggedAt)}
                  </div>
                </div>
                {r.shipped ? (
                  <span className="rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                    Shipped · label {fmtMoney(r.labelCost)}
                    {r.order && " (on the Etsy order)"}
                  </span>
                ) : r.order ? (
                  <span className="rounded bg-sky-100 px-2 py-1 text-xs font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300">Linked to Etsy order</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="Label cost"
                      className={`${inputClass} !w-28`}
                      value={labelCostDraft[r.id] ?? ""}
                      onChange={(e) => setLabelCostDraft((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    />
                    <button
                      onClick={() => ship({ id: r.id, labelCost: labelCostDraft[r.id] ? Number(labelCostDraft[r.id]) : undefined })}
                      className={btn("success")}
                    >
                      Ship
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {(data ?? []).length === 0 && <p className="text-neutral-400">No replacements logged.</p>}
        </div>
      )}

      {creating && <NewReplacementModal onClose={() => setCreating(false)} onSave={(data) => create(data, { onSuccess: () => setCreating(false) })} />}
    </div>
  );
}

function NewReplacementModal({ onClose, onSave }: { onClose: () => void; onSave: (data: Record<string, unknown>) => void }) {
  const [code, setCode] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [originalOrderId, setOriginalOrderId] = useState("");
  const [parts, setParts] = useState<PartQtyRow[]>([{ partId: "", quantity: 1 }]);

  return (
    <Modal title="New Replacement" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            code,
            buyerName,
            originalOrderId: originalOrderId || null,
            requestedAt: new Date().toISOString(),
            parts: parts.filter((p) => p.partId),
          });
        }}
      >
        <div>
          <label className="mb-1 block text-sm font-medium">Code (e.g. R-1101-3)</label>
          <input required className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Buyer</label>
          <input required className={inputClass} value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Original order # (optional)</label>
          <input className={inputClass} value={originalOrderId} onChange={(e) => setOriginalOrderId(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Parts</label>
          <PartsPicker rows={parts} onChange={setParts} />
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full">
          Save
        </Button>
      </form>
    </Modal>
  );
}
