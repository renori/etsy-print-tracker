import type { FastifyInstance, FastifyReply } from "fastify";
import ExcelJS from "exceljs";
import { db } from "../lib/db.js";

/**
 * Tax-time exports for one tax year: an Excel workbook (Summary, Expenses,
 * Mileage, Sales by month) and plain CSVs for tax software or an accountant.
 *
 * Which year a row belongs to:
 *  - expenses: their Tax year field (blank = the year of the date), so
 *    amortization booked for later years lands in those years;
 *  - mileage: the trip date;
 *  - Etsy sales: the order date (when the buyer paid, as on Etsy's 1099-K).
 */

const EXACT_LABEL = new Set(["etsy", "batch", "manual"]);
const isExactLabel = (source: string | null) => source == null || EXACT_LABEL.has(source);
const round = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function yearData(year: number) {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const [expenses, trips, orders] = await Promise.all([
    db.expense.findMany({ where: { taxYear: year }, orderBy: [{ date: "asc" }, { item: "asc" }] }),
    db.mileageEntry.findMany({ where: { date: { gte: start, lt: end } }, orderBy: { date: "asc" } }),
    db.order.findMany({ where: { orderedAt: { gte: start, lt: end }, etsyGross: { not: null } }, orderBy: { orderedAt: "asc" } }),
  ]);

  const deductible = expenses.filter((e) => e.deductible);
  const byLine = new Map<string, { total: number; count: number }>();
  for (const e of deductible) {
    const k = e.scheduleCLine?.trim() || "Unassigned (set a Schedule C line)";
    const g = byLine.get(k) ?? { total: 0, count: 0 };
    byLine.set(k, { total: g.total + e.cost, count: g.count + 1 });
  }

  const months = MONTHS.map((name) => ({ name, orders: 0, gross: 0, tax: 0, fees: 0, labelExact: 0, labelEstimated: 0, earnings: 0 }));
  for (const o of orders) {
    const m = months[o.orderedAt.getMonth()];
    m.orders++;
    m.gross += o.etsyGross ?? 0;
    m.tax += o.salesTax ?? 0;
    m.fees += o.etsyFees ?? 0;
    m.earnings += o.etsyEarnings ?? 0;
    if (o.labelCost && !o.digital) {
      if (isExactLabel(o.labelCostSource)) m.labelExact += o.labelCost;
      else m.labelEstimated += o.labelCost;
    }
  }
  const sum = <K extends keyof (typeof months)[number]>(k: K) => round(months.reduce((s, m) => s + (m[k] as number), 0));

  return {
    year,
    expenses,
    trips,
    lines: [...byLine].map(([line, g]) => ({ line, total: round(g.total), count: g.count })).sort((a, b) => a.line.localeCompare(b.line)),
    deductibleTotal: round(deductible.reduce((s, e) => s + e.cost, 0)),
    nonDeductibleTotal: round(expenses.filter((e) => !e.deductible).reduce((s, e) => s + e.cost, 0)),
    miles: round(trips.reduce((s, t) => s + t.miles, 0)),
    mileageDeduction: round(trips.reduce((s, t) => s + t.miles * t.ratePerMile, 0)),
    months,
    sales: {
      orders: orders.length,
      gross: sum("gross"),
      tax: sum("tax"),
      fees: sum("fees"),
      earnings: sum("earnings"),
      labelExact: sum("labelExact"),
      labelEstimated: sum("labelEstimated"),
    },
  };
}

type YearData = Awaited<ReturnType<typeof yearData>>;

// ---------- CSV ----------

const cell = (v: unknown) => {
  if (v == null) return "";
  const s = typeof v === "number" ? String(round(v)) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header: string[], rows: unknown[][]) => "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

function sendFile(reply: FastifyReply, name: string, type: string, body: string | Buffer) {
  return reply.header("Content-Type", type).header("Content-Disposition", `attachment; filename="${name}"`).send(body);
}

const expenseCsv = (d: YearData) =>
  csv(
    ["Date", "Item", "Vendor", "Category", "Schedule C line", "Amount", "Deductible", "Paid with", "Order / invoice #", "Notes"],
    d.expenses.map((e) => [ymd(e.date), e.item, e.vendor, e.category, e.scheduleCLine, e.cost, e.deductible ? "Yes" : "No", e.paidWith, e.invoiceRef, e.notes]),
  );

const mileageCsv = (d: YearData) =>
  csv(
    ["Date", "Destination", "Business purpose", "Miles", "Rate per mile", "Deduction"],
    d.trips.map((t) => [ymd(t.date), t.destination, t.purpose, t.miles, t.ratePerMile, t.miles * t.ratePerMile]),
  );

// ---------- Excel ----------

const MONEY = '"$"#,##0.00';
const BOLD = { bold: true };

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width: number; money?: boolean }[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.money ? { numFmt: MONEY } : {} }));
  ws.getRow(1).font = BOLD;
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };
  return ws;
}

function totalRow(ws: ExcelJS.Worksheet, label: string, values: Record<string, number>) {
  const r = ws.addRow({ ...values });
  r.getCell(1).value = label;
  r.font = BOLD;
  r.border = { top: { style: "thin" } };
}

async function workbook(d: YearData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Print Tracker";
  wb.created = new Date();

  // Summary
  const s = wb.addWorksheet("Summary");
  s.columns = [{ width: 58 }, { width: 16 }, { width: 12 }];
  const title = s.addRow([`Tax year ${d.year}: business summary`]);
  title.font = { bold: true, size: 14 };
  s.addRow([`Exported ${new Date().toLocaleString()} from Print Tracker. Check against Etsy's 1099-K and your receipts before filing.`]).font = {
    italic: true,
    color: { argb: "FF666666" },
  };
  const section = (name: string) => {
    s.addRow([]);
    s.addRow([name]).font = { bold: true, size: 12 };
  };
  const line = (label: string, amount: number | null, extra?: string | number, opts: { bold?: boolean } = {}) => {
    const r = s.addRow([label, amount, extra ?? null]);
    r.getCell(2).numFmt = MONEY;
    if (opts.bold) r.font = BOLD;
  };

  section("Etsy sales (orders placed this year)");
  line("Orders", null, d.sales.orders);
  line("Gross sales (what buyers paid, incl. shipping and tax)", d.sales.gross);
  line("Sales tax (collected and paid over by Etsy)", d.sales.tax);
  line("Etsy fees (transaction, processing, ads, listing)", d.sales.fees);
  line("Shipping labels on orders: exact", d.sales.labelExact);
  if (d.sales.labelEstimated) line("Shipping labels on orders: estimated, check against Pirate Ship / Etsy", d.sales.labelEstimated);
  line("Etsy earnings after fees and tax", d.sales.earnings, undefined, { bold: true });
  s.addRow(["Etsy fees and order labels aren't in the Expenses tab, so they aren't counted twice."]).font = { italic: true, color: { argb: "FF666666" } };

  section("Deductible expenses by Schedule C line");
  s.addRow(["Line", "Amount", "Items"]).font = BOLD;
  for (const l of d.lines) line(l.line, l.total, l.count);
  line("Total deductible expenses", d.deductibleTotal, d.lines.reduce((n, l) => n + l.count, 0), { bold: true });
  if (d.nonDeductibleTotal) line("Not deductible (listed in Expenses, not in the total above)", d.nonDeductibleTotal);

  section("Vehicle: standard mileage");
  line("Business miles", null, d.miles);
  line("Mileage deduction (IRS standard rate for each trip's date)", d.mileageDeduction, undefined, { bold: true });

  // Expenses
  const e = sheet(wb, "Expenses", [
    { header: "Date", key: "date", width: 12 },
    { header: "Item", key: "item", width: 48 },
    { header: "Vendor", key: "vendor", width: 18 },
    { header: "Category", key: "category", width: 16 },
    { header: "Schedule C line", key: "line", width: 40 },
    { header: "Amount", key: "cost", width: 12, money: true },
    { header: "Deductible", key: "deductible", width: 11 },
    { header: "Paid with", key: "paidWith", width: 22 },
    { header: "Order / invoice #", key: "ref", width: 22 },
    { header: "Notes", key: "notes", width: 40 },
  ]);
  for (const x of d.expenses)
    e.addRow({
      date: ymd(x.date),
      item: x.item,
      vendor: x.vendor,
      category: x.category,
      line: x.scheduleCLine,
      cost: x.cost,
      deductible: x.deductible ? "Yes" : "No",
      paidWith: x.paidWith,
      ref: x.invoiceRef,
      notes: x.notes,
    });
  if (d.expenses.length) e.autoFilter = { from: "A1", to: `J${d.expenses.length + 1}` };
  totalRow(e, "Total (all)", { cost: round(d.expenses.reduce((n, x) => n + x.cost, 0)) });

  // Mileage
  const m = sheet(wb, "Mileage", [
    { header: "Date", key: "date", width: 12 },
    { header: "Destination", key: "destination", width: 34 },
    { header: "Business purpose", key: "purpose", width: 40 },
    { header: "Miles", key: "miles", width: 9 },
    { header: "Rate per mile", key: "rate", width: 13, money: true },
    { header: "Deduction", key: "deduction", width: 12, money: true },
  ]);
  for (const t of d.trips)
    m.addRow({ date: ymd(t.date), destination: t.destination, purpose: t.purpose, miles: t.miles, rate: t.ratePerMile, deduction: round(t.miles * t.ratePerMile) });
  totalRow(m, "Total", { miles: d.miles, deduction: d.mileageDeduction });

  // Sales by month
  const sm = sheet(wb, "Sales by month", [
    { header: "Month", key: "name", width: 10 },
    { header: "Orders", key: "orders", width: 9 },
    { header: "Gross sales", key: "gross", width: 13, money: true },
    { header: "Sales tax", key: "tax", width: 12, money: true },
    { header: "Etsy fees", key: "fees", width: 12, money: true },
    { header: "Labels (exact)", key: "labelExact", width: 14, money: true },
    { header: "Labels (estimated)", key: "labelEstimated", width: 17, money: true },
    { header: "Earnings", key: "earnings", width: 12, money: true },
  ]);
  for (const x of d.months) sm.addRow({ ...x, gross: round(x.gross), tax: round(x.tax), fees: round(x.fees), labelExact: round(x.labelExact), labelEstimated: round(x.labelEstimated), earnings: round(x.earnings) });
  totalRow(sm, "Total", {
    orders: d.sales.orders,
    gross: d.sales.gross,
    tax: d.sales.tax,
    fees: d.sales.fees,
    labelExact: d.sales.labelExact,
    labelEstimated: d.sales.labelEstimated,
    earnings: d.sales.earnings,
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- routes ----------

const yearParam = (raw: string) => {
  const y = Number(raw);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw Object.assign(new Error("Pick a tax year like 2026"), { statusCode: 400 });
  return y;
};

export default async function taxExportRoutes(app: FastifyInstance) {
  /** Years that have anything to export, newest first, with a summary for each. */
  app.get("/tax-export/years", async () => {
    const [exp, trips, orders] = await Promise.all([
      db.expense.findMany({ select: { taxYear: true } }),
      db.mileageEntry.findMany({ select: { date: true } }),
      db.order.findMany({ where: { etsyGross: { not: null } }, select: { orderedAt: true } }),
    ]);
    const years = [...new Set([...exp.map((e) => e.taxYear), ...trips.map((t) => t.date.getFullYear()), ...orders.map((o) => o.orderedAt.getFullYear())])]
      .filter((y) => y >= 2000 && y <= 2100)
      .sort((a, b) => b - a);
    return Promise.all(
      years.map(async (y) => {
        const d = await yearData(y);
        return {
          year: y,
          expenses: d.expenses.length,
          deductibleTotal: d.deductibleTotal,
          trips: d.trips.length,
          miles: d.miles,
          mileageDeduction: d.mileageDeduction,
          orders: d.sales.orders,
          gross: d.sales.gross,
          fees: d.sales.fees,
        };
      }),
    );
  });

  app.get("/tax-export/:year/workbook.xlsx", async (req, reply) => {
    const d = await yearData(yearParam((req.params as { year: string }).year));
    return sendFile(reply, `print-shop-taxes-${d.year}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", await workbook(d));
  });

  app.get("/tax-export/:year/expenses.csv", async (req, reply) => {
    const d = await yearData(yearParam((req.params as { year: string }).year));
    return sendFile(reply, `expenses-${d.year}.csv`, "text/csv; charset=utf-8", expenseCsv(d));
  });

  app.get("/tax-export/:year/mileage.csv", async (req, reply) => {
    const d = await yearData(yearParam((req.params as { year: string }).year));
    return sendFile(reply, `mileage-${d.year}.csv`, "text/csv; charset=utf-8", mileageCsv(d));
  });
}
