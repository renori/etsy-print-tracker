import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { fmtMoney } from "../lib/format";
import { Icon, PageHeader, btn } from "../components/ui";

interface YearSummary {
  year: number;
  expenses: number;
  deductibleTotal: number;
  trips: number;
  miles: number;
  mileageDeduction: number;
  orders: number;
  gross: number;
  fees: number;
}

/** Downloads for tax time, one tax year per card. */
export function TaxExport() {
  const { data: years, isLoading } = useQuery({ queryKey: ["tax-export", "years"], queryFn: () => api.get<YearSummary[]>("/tax-export/years") });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tax Export"
        subtitle="Everything for one tax year: deductible expenses by Schedule C line, the mileage log, and Etsy sales, fees and label costs."
      />
      {isLoading ? (
        <p className="py-10 text-center text-neutral-500">Loading…</p>
      ) : !years?.length ? (
        <p className="py-10 text-center text-neutral-500">Nothing to export yet: add expenses or mileage first.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {years.map((y) => (
            <section key={y.year} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="text-xl font-semibold">{y.year}</h2>
              <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-neutral-500">Deductible expenses</dt>
                  <dd className="font-semibold tabular-nums">{fmtMoney(y.deductibleTotal)}</dd>
                  <dd className="text-xs text-neutral-500">{y.expenses} expense{y.expenses === 1 ? "" : "s"} logged</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Mileage deduction</dt>
                  <dd className="font-semibold tabular-nums">{fmtMoney(y.mileageDeduction)}</dd>
                  <dd className="text-xs text-neutral-500">
                    {Math.round(y.miles)} mi · {y.trips} trips
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Etsy sales</dt>
                  <dd className="font-semibold tabular-nums">{fmtMoney(y.gross)}</dd>
                  <dd className="text-xs text-neutral-500">
                    {y.orders} orders · {fmtMoney(y.fees)} fees
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={`/api/tax-export/${y.year}/workbook.xlsx`} download className={btn("primary", "md", "gap-2")}>
                  <Icon name="download" className="h-4 w-4" />
                  Excel workbook
                </a>
                <a href={`/api/tax-export/${y.year}/expenses.csv`} download className={btn("secondary", "md")}>
                  Expenses CSV
                </a>
                <a href={`/api/tax-export/${y.year}/mileage.csv`} download className={btn("secondary", "md")}>
                  Mileage CSV
                </a>
              </div>
            </section>
          ))}
        </div>
      )}
      <div className="max-w-3xl space-y-1.5 text-sm text-neutral-600 dark:text-neutral-400">
        <p>
          <b>Excel workbook:</b> a Summary tab (Etsy sales and fees, deductible expenses totalled by Schedule C line, mileage deduction), then
          the full Expenses list, Mileage log and Sales by month. <b>CSVs</b> are the plain lists, for tax software or an accountant.
        </p>
        <p>
          Expenses go by their <i>Tax year</i> (blank = the year of the date), so amortization booked for later years lands in those years.
          Etsy fees and order label costs come from your orders and aren't in the Expenses list, so nothing is counted twice. Labels marked
          estimated should be checked against Pirate Ship or Etsy before filing.
        </p>
      </div>
    </div>
  );
}
