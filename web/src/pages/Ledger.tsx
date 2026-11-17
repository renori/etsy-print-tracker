import { ResourceTablePage } from "../components/ResourceTablePage";
import { ledgerApi } from "../api/resources";
import type { EtsyLedgerEntry } from "../api/types";
import type { Column } from "../components/DataTable";
import { fmtDateTime, fmtMoney } from "../lib/format";

const columns: Column<EtsyLedgerEntry>[] = [
  { key: "createdAt", label: "Created", render: (e) => fmtDateTime(e.createdAt) },
  { key: "ledgerType", label: "Type" },
  { key: "description", label: "Description" },
  { key: "amount", label: "Amount", render: (e) => fmtMoney(e.amount) },
  { key: "balance", label: "Balance", render: (e) => fmtMoney(e.balance) },
];

export function Ledger() {
  return (
    <ResourceTablePage title="Etsy Ledger" description="Populated by the Etsy sync — read only." hooks={ledgerApi} columns={columns} fields={[]} readOnly />
  );
}
