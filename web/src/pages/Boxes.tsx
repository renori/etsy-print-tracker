import { ResourceTablePage } from "../components/ResourceTablePage";
import { boxesApi } from "../api/resources";
import type { Box } from "../api/types";
import type { Column } from "../components/DataTable";
import type { FieldConfig } from "../components/FieldForm";
import { fmtMoney } from "../lib/format";
import { ExportRatesCard } from "../components/ExportRatesCard";

const isLow = (b: Box) => b.reorderAt != null && b.onHand <= b.reorderAt;

const columns: Column<Box>[] = [
  { key: "name", label: "Box / mailer" },
  {
    key: "onHand",
    label: "On hand",
    render: (b) => <span className={isLow(b) ? "font-semibold text-red-700" : "font-semibold"}>{b.onHand}</span>,
  },
  { key: "reorderAt", label: "Reorder at", render: (b) => (b.reorderAt ?? "—") as React.ReactNode },
  { key: "status", label: "", render: (b) => (isLow(b) ? <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Reorder</span> : null) },
  { key: "costEach", label: "Cost each", render: (b) => fmtMoney(b.costEach) },
  { key: "weightOz", label: "Weight", render: (b) => (b.weightOz != null ? `${b.weightOz} oz` : "—") },
  { key: "notes", label: "Notes" },
];

const fields: FieldConfig[] = [
  { key: "name", label: 'Name (match the sheet\'s "Package", e.g. 13x10x3)', type: "text", required: true },
  { key: "onHand", label: "On hand", type: "number", defaultValue: 0 },
  { key: "reorderAt", label: "Reorder when at or below", type: "number" },
  { key: "costEach", label: "Cost each", type: "number" },
  { key: "weightOz", label: "Empty weight (oz), added to shipping weight", type: "number" },
  { key: "notes", label: "Notes (supplier, link…)", type: "text" },
];

export function Boxes() {
  return (
    <>
    <ResourceTablePage
      title="Shipping Boxes"
      description="Ticking Packed on an order takes one of its box off this count (unticking puts it back)."
      hooks={boxesApi}
      columns={columns}
      fields={fields}
    />
    <ExportRatesCard />
    </>
  );
}
