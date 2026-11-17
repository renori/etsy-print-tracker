import { useMemo, useState } from "react";
import { ResourceTablePage } from "../components/ResourceTablePage";
import { partsApi } from "../api/resources";
import type { Part } from "../api/types";
import type { FieldConfig } from "../components/FieldForm";
import type { Column } from "../components/DataTable";
import { fmtMoney } from "../lib/format";

const fields: FieldConfig[] = [
  { key: "name", label: "Name", type: "text", required: true },
  { key: "description", label: "Description", type: "text" },
  { key: "printMinutes", label: "Print minutes", type: "number", required: true },
  { key: "filamentGrams", label: "Filament (g)", type: "number", required: true },
  { key: "filamentPricePerKg", label: "Filament price/kg", type: "number", required: true },
  { key: "filamentCost", label: "Filament cost", type: "number", required: true },
  { key: "electricityCost", label: "Electricity cost", type: "number" },
  { key: "depreciation", label: "Depreciation", type: "number" },
  { key: "shippingBoxCost", label: "Shipping box cost", type: "number" },
  { key: "bagCost", label: "Bag cost", type: "number" },
  { key: "wrappingCost", label: "Wrapping cost", type: "number" },
  { key: "hardwareCost", label: "Hardware cost", type: "number" },
  { key: "laborCost", label: "Labor cost", type: "number" },
  { key: "touchTimeMinutes", label: "Touch time (min)", type: "number" },
  { key: "cost", label: "Total cost", type: "number", required: true },
  { key: "listPrice", label: "List price", type: "number" },
  { key: "margin", label: "Margin (0-1)", type: "number" },
  { key: "packageType", label: "Package type", type: "text" },
  { key: "shipWeightOz", label: "Ship weight (oz, one unit bagged/wrapped; blank = filament weight)", type: "number" },
  { key: "onHand", label: "On hand", type: "number" },
  { key: "active", label: "Active", type: "boolean", defaultValue: true },
];

export function Parts() {
  const [showInactive, setShowInactive] = useState(false);
  const { data: all } = partsApi.useList();
  const { mutate: update, isPending } = partsApi.useUpdate();
  const inactiveCount = (all ?? []).filter((p) => !p.active).length;

  const hooks = useMemo(
    () => ({
      ...partsApi,
      useList: () => {
        const q = partsApi.useList();
        return { ...q, data: q.data?.filter((p) => showInactive || p.active) };
      },
    }),
    [showInactive]
  );

  const columns: Column<Part>[] = [
    {
      key: "name",
      label: "Part",
      render: (p) => (p.active ? p.name : <span className="text-neutral-500">{p.name} (inactive)</span>),
    },
    { key: "printMinutes", label: "Print min" },
    { key: "cost", label: "Cost", render: (p) => fmtMoney(p.cost) },
    { key: "listPrice", label: "List price", render: (p) => fmtMoney(p.listPrice) },
    { key: "margin", label: "Margin", render: (p) => (p.margin != null ? `${Math.round(p.margin * 100)}%` : "—") },
    { key: "onHand", label: "On hand" },
    {
      key: "active",
      label: "Active",
      render: (p) => (
        <button
          type="button"
          role="switch"
          aria-checked={p.active}
          aria-label={`${p.active ? "Deactivate" : "Activate"} ${p.name}`}
          disabled={isPending}
          onClick={() => update({ id: p.id, data: { active: !p.active } })}
          className={`min-h-11 md:min-h-9 rounded-full px-3 text-xs font-medium ${
            p.active ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200" : "bg-neutral-200 text-neutral-700 hover:bg-neutral-300"
          }`}
        >
          {p.active ? "Active" : "Inactive"}
        </button>
      ),
    },
  ];

  return (
    <div>
      <ResourceTablePage
        title="Parts Catalog"
        description="Inactive parts are hidden from stock, part pickers and new plates — unless an open order still needs them."
        hooks={hooks}
        columns={columns}
        fields={fields}
      />
      {inactiveCount > 0 && (
        <label className="mt-3 flex min-h-10 items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show {inactiveCount} inactive part{inactiveCount === 1 ? "" : "s"}
        </label>
      )}
    </div>
  );
}
