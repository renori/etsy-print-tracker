import { partsApi } from "../api/resources";
import { Button, IconButton, inputClass } from "./ui";

export interface PartQtyRow {
  partId: string;
  quantity: number;
}

/** Add/remove rows of {part, quantity} — used anywhere a resource needs a list of parts (orders, recipes, replacements, listings). */
export function PartsPicker({
  rows,
  onChange,
  quantityLabel = "Qty",
}: {
  rows: PartQtyRow[];
  onChange: (rows: PartQtyRow[]) => void;
  quantityLabel?: string;
}) {
  const { data: parts } = partsApi.useList();

  function update(i: number, patch: Partial<PartQtyRow>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <select aria-label="Part" className={`${inputClass} flex-1`} value={row.partId} onChange={(e) => update(i, { partId: e.target.value })}>
            <option value="">Choose a part…</option>
            {parts
              ?.filter((p) => p.active || p.id === row.partId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            aria-label={quantityLabel}
            title={quantityLabel}
            className={`${inputClass} !w-20 text-center`}
            value={row.quantity}
            onChange={(e) => update(i, { quantity: Number(e.target.value) })}
          />
          <IconButton icon="x" label="Remove part" variant="danger" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} />
        </div>
      ))}
      <Button icon="plus" size="sm" onClick={() => onChange([...rows, { partId: "", quantity: 1 }])}>
        Add part
      </Button>
    </div>
  );
}
