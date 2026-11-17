import { ResourceTablePage } from "../components/ResourceTablePage";
import { printersApi } from "../api/resources";
import type { Printer } from "../api/types";
import type { Column } from "../components/DataTable";
import type { FieldConfig } from "../components/FieldForm";

const columns: Column<Printer>[] = [
  { key: "name", label: "Printer" },
  { key: "active", label: "Active", render: (p) => (p.active ? "Yes" : "No") },
  { key: "notes", label: "Notes" },
];

const fields: FieldConfig[] = [
  { key: "name", label: "Name", type: "text", required: true },
  { key: "active", label: "Active", type: "boolean", defaultValue: true },
  { key: "notes", label: "Notes", type: "text" },
];

export function Printers() {
  return <ResourceTablePage title="Printers" description="Untick Active to take a printer out of the schedule." hooks={printersApi} columns={columns} fields={fields} />;
}
