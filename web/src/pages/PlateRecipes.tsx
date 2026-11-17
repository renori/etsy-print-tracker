import { useState } from "react";
import { plateRecipesApi, printersApi } from "../api/resources";
import { Modal } from "../components/Modal";
import { PartsPicker, type PartQtyRow } from "../components/PartsPicker";
import { Button, IconButton, inputClass } from "../components/ui";

export function PlateRecipes() {
  const { data, isLoading } = plateRecipesApi.useList();
  const { data: printers } = printersApi.useList();
  const { mutate: create } = plateRecipesApi.useCreate();
  const { mutate: remove } = plateRecipesApi.useDelete();
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Plate Recipes</h1>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          Add Recipe
        </Button>
      </div>
      <p className="mb-4 text-sm text-neutral-500">
        Which parts can share a plate, each up to its max. Printer blank = any. Plate time blank = sum of each part's catalog print time.
      </p>

      {isLoading ? (
        <p className="text-neutral-400">Loading…</p>
      ) : (
        <div className="space-y-2">
          {data?.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <div>
                <div className="font-medium">{r.name || r.parts.map((p) => p.part?.name).join(" + ")}</div>
                <div className="text-sm text-neutral-500">
                  {r.parts.map((p) => `${p.part?.name ?? p.partId}${p.part && !p.part.active ? " [inactive]" : ""} (max ${p.maxCount})`).join(", ")} · Printer: {r.printer?.name ?? "any"} · Plate time:{" "}
                  {r.plateMinutes ?? "sum of parts"}
                </div>
              </div>
              <IconButton icon="trash" label="Delete" variant="danger" onClick={() => confirm("Delete this recipe?") && remove(r.id)} />
            </div>
          ))}
          {(data ?? []).length === 0 && <p className="text-neutral-400">No recipes yet — parts without one print one-per-plate.</p>}
        </div>
      )}

      {creating && (
        <NewRecipeModal
          printers={printers ?? []}
          onClose={() => setCreating(false)}
          onSave={(data) => create(data, { onSuccess: () => setCreating(false) })}
        />
      )}
    </div>
  );
}

function NewRecipeModal({
  printers,
  onClose,
  onSave,
}: {
  printers: { id: string; name: string }[];
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState("");
  const [printerId, setPrinterId] = useState("");
  const [plateMinutes, setPlateMinutes] = useState("");
  const [parts, setParts] = useState<PartQtyRow[]>([{ partId: "", quantity: 1 }]);

  return (
    <Modal title="Add Plate Recipe" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            name: name || null,
            printerId: printerId || null,
            plateMinutes: plateMinutes ? Number(plateMinutes) : null,
            parts: parts.filter((p) => p.partId).map((p) => ({ partId: p.partId, maxCount: p.quantity })),
          });
        }}
      >
        <div>
          <label className="mb-1 block text-sm font-medium">Name (optional)</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Printer (blank = any)</label>
          <select className={inputClass} value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
            <option value="">Any</option>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Plate time, minutes (blank = sum of parts)</label>
          <input type="number" className={inputClass} value={plateMinutes} onChange={(e) => setPlateMinutes(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Parts (quantity = Max per plate)</label>
          <PartsPicker rows={parts} onChange={setParts} quantityLabel="Max" />
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full">
          Save
        </Button>
      </form>
    </Modal>
  );
}
