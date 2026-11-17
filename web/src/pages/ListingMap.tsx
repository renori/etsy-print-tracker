import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ListingMapping } from "../api/types";
import { Modal } from "../components/Modal";
import { PartsPicker, type PartQtyRow } from "../components/PartsPicker";
import { Button, Card, Field, Icon, IconButton, PageHeader, inputClass } from "../components/ui";

interface UnmappedGroup {
  listingId: string;
  title: string;
  variations: { name: string; value: string }[];
  orders: { id: string; etsyOrderId: string; buyerName: string; packed: boolean; linked: boolean }[];
}

type Draft = Partial<ListingMapping> & { etsyListingId: string; listingTitle: string };

/** Everything a mapping change can move: the map, which orders are linked, stock "needed", the queue. */
const AFFECTED = ["listing-mappings", "orders", "parts", "queue", "summary"];

export function ListingMap() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["listing-mappings"], queryFn: () => api.get<ListingMapping[]>("/listing-mappings") });
  const { data: unmapped } = useQuery({
    queryKey: ["listing-mappings", "unmapped"],
    queryFn: () => api.get<UnmappedGroup[]>("/listing-mappings/unmapped"),
    refetchInterval: 60_000,
  });
  const [editing, setEditing] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: ({ id, ...body }: Draft) =>
      id ? api.put<ListingMapping & { relinked: number }>(`/listing-mappings/${id}`, body) : api.post<ListingMapping & { relinked: number }>("/listing-mappings", body),
    onSuccess: (row) => {
      for (const k of AFFECTED) qc.invalidateQueries({ queryKey: [k] });
      setEditing(null);
      setNotice(row.relinked ? `Saved — re-linked ${row.relinked} open order${row.relinked === 1 ? "" : "s"} to stock.` : "Saved.");
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/listing-mappings/${id}`),
    onSuccess: () => {
      for (const k of AFFECTED) qc.invalidateQueries({ queryKey: [k] });
    },
  });

  const rows = [...(data ?? [])].sort(
    (a, b) => a.listingTitle.localeCompare(b.listingTitle) || (a.variationContains ?? "").localeCompare(b.variationContains ?? "")
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Listing Map"
        subtitle="Which parts each Etsy listing (and variation) uses. Changes re-link open, unpacked orders right away."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing({ etsyListingId: "", listingTitle: "", parts: [] })}>
            Add mapping
          </Button>
        }
      />

      {notice && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <span className="flex items-center gap-2">
            <Icon name="check" className="h-4 w-4" />
            {notice}
          </span>
          <IconButton icon="x" label="Dismiss" onClick={() => setNotice(null)} className="!h-9 !w-9" />
        </div>
      )}

      {(unmapped ?? []).length > 0 && (
        <section aria-label="Unlinked sales" className="space-y-2.5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-amber-800 dark:text-amber-300">
            <Icon name="alert" className="h-5 w-5" />
            Sales not linked to stock
          </h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            These open orders match nothing below — usually a listing or variation renamed on Etsy. Map them and the orders link up immediately.
          </p>
          {unmapped!.map((g) => {
            const variation = g.variations.map((v) => `${v.name}: ${v.value}`).join(", ");
            return (
              <Card key={g.listingId + variation} className="border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[14rem] flex-1">
                    <div className="font-semibold">{g.title}</div>
                    <div className="text-sm">
                      {variation ? (
                        <>
                          Variation <span className="font-medium">{variation}</span>
                        </>
                      ) : (
                        "No variation"
                      )}{" "}
                      <span className="text-neutral-500">· #{g.listingId}</span>
                    </div>
                    <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                      {g.orders.length} order{g.orders.length === 1 ? "" : "s"}: {g.orders.map((o) => o.buyerName + (o.packed ? " (packed)" : !o.linked ? " (no parts)" : "")).join(", ")}
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    icon="plus"
                    onClick={() =>
                      setEditing({
                        etsyListingId: g.listingId,
                        listingTitle: g.title,
                        // The first chosen value (e.g. "Low Profile") is usually the one that decides the parts.
                        variationContains: g.variations[0]?.value ?? null,
                        parts: [],
                      })
                    }
                  >
                    Map it
                  </Button>
                </div>
              </Card>
            );
          })}
        </section>
      )}

      {isLoading ? (
        <p className="py-10 text-center text-neutral-500">Loading…</p>
      ) : (
        <section aria-label="Mappings" className="space-y-2.5">
          {rows.map((m) => (
            <Card key={m.id} className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-[14rem] flex-1">
                <div className="font-medium">
                  {m.listingTitle} <span className="text-sm font-normal text-neutral-500">#{m.etsyListingId}</span>
                </div>
                <div className="text-sm text-neutral-600 dark:text-neutral-400">
                  {m.variationContains ? (
                    <>
                      When variation contains <span className="font-medium text-neutral-900 dark:text-neutral-100">“{m.variationContains}”</span>
                    </>
                  ) : (
                    "Any variation"
                  )}{" "}
                  →{" "}
                  {m.parts.map((p) => `${p.quantity}× ${p.part?.name ?? p.partId}${p.part && !p.part.active ? " [inactive]" : ""}`).join(", ") ||
                    "(digital / nothing to print)"}
                </div>
                {m.autoGuessed && <div className="text-xs text-amber-700 dark:text-amber-400">Auto-guessed — please check</div>}
              </div>
              <div className="flex gap-2">
                <Button icon="edit" onClick={() => setEditing({ ...m })}>
                  Edit
                </Button>
                <IconButton icon="trash" label="Delete mapping" variant="danger" onClick={() => confirm("Delete this mapping?") && remove.mutate(m.id)} />
              </div>
            </Card>
          ))}
          {rows.length === 0 && <p className="rounded-xl border border-dashed border-neutral-300 py-10 text-center text-neutral-500">No listings mapped yet.</p>}
        </section>
      )}

      {editing && (
        <MappingModal
          initial={editing}
          saving={save.isPending}
          error={save.error ? (save.error as Error).message : null}
          onClose={() => setEditing(null)}
          onSave={(d) => save.mutate(d)}
        />
      )}
    </div>
  );
}

function MappingModal({
  initial,
  saving,
  error,
  onClose,
  onSave,
}: {
  initial: Draft;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (d: Draft) => void;
}) {
  const [etsyListingId, setEtsyListingId] = useState(initial.etsyListingId);
  const [listingTitle, setListingTitle] = useState(initial.listingTitle);
  const [variationContains, setVariationContains] = useState(initial.variationContains ?? "");
  const [parts, setParts] = useState<PartQtyRow[]>(
    initial.parts?.length ? initial.parts.map((p) => ({ partId: p.partId, quantity: p.quantity })) : [{ partId: "", quantity: 1 }]
  );

  return (
    <Modal title={initial.id ? "Edit mapping" : "Add mapping"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            id: initial.id,
            etsyListingId,
            listingTitle,
            variationContains: variationContains.trim() || null,
            autoGuessed: false,
            parts: parts.filter((p) => p.partId).map((p) => ({ partId: p.partId, quantity: p.quantity })),
          });
        }}
      >
        <Field label="Etsy listing ID">
          <input required inputMode="numeric" className={inputClass} value={etsyListingId} onChange={(e) => setEtsyListingId(e.target.value)} />
        </Field>
        <Field label="Listing title">
          <input required className={inputClass} value={listingTitle} onChange={(e) => setListingTitle(e.target.value)} />
        </Field>
        <Field label="Variation contains" hint='Matches when the buyer’s chosen option includes this text, e.g. "Low Profile". Leave blank to match any variation.'>
          <input className={inputClass} value={variationContains} onChange={(e) => setVariationContains(e.target.value)} />
        </Field>
        <div>
          <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">Parts each sale uses</span>
          <PartsPicker rows={parts} onChange={setParts} />
          <p className="mt-1 text-xs text-neutral-500">No parts = digital / nothing to print.</p>
        </div>
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" variant="primary" size="lg" disabled={saving} className="w-full">
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </Modal>
  );
}
