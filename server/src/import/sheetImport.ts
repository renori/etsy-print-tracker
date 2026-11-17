import ExcelJS from "exceljs";
import { db } from "../lib/db.js";
import { ORDER_STATUS, type OrderStatus } from "../lib/constants.js";
import { rebuildQueue } from "../scheduler/queue.js";
import { normBoxName } from "../lib/boxes.js";
import { irsRateFor } from "../lib/irsMileage.js";
import { bool, clock, colOf, date, findHeaderRow, num, pct, sheetRows, str, type Cell } from "./cells.js";

export interface ImportSummary {
  counts: Record<string, number>;
  warnings: string[];
}

interface PartRow {
  name: string;
  description: string | null;
  printMinutes: number;
  filamentGrams: number;
  filamentPricePerKg: number;
  filamentCost: number;
  electricityCost: number;
  depreciation: number;
  shippingBoxCost: number;
  bagCost: number;
  wrappingCost: number;
  hardwareCost: number;
  laborCost: number;
  touchTimeMinutes: number;
  cost: number;
  listPrice: number | null;
  margin: number | null;
  packageType: string | null;
  onHand: number;
}

/** Short labels in the sheet ("Grip Case (Full Back)") vs full part names ("Grip Case for OneXPlayer 3 (Full Back)"). */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\bfor onexplayer 3\b/g, " ")
    .replace(/\bonexplayer 3\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

class PartResolver {
  private byNorm = new Map<string, string>();
  constructor(names: string[]) {
    for (const n of names) this.byNorm.set(norm(n), n);
  }
  resolve(label: string): string | null {
    const n = norm(label);
    if (!n) return null;
    const exact = this.byNorm.get(n);
    if (exact) return exact;
    const hits = [...this.byNorm.entries()].filter(([k]) => k.includes(n) || n.includes(k));
    return hits.length === 1 ? hits[0][1] : null;
  }
}

/** "1× Grip Case (Full Back)\n2× Rail Covers" → [{label, qty}]; lines without a leading quantity are ignored. */
function qtyLines(text: string): { label: string; qty: number }[] {
  const out: { label: string; qty: number }[] = [];
  for (const line of text.split(/\n/)) {
    const m = line.match(/^\s*(\d+)\s*[×xX]\s*(.+?)\s*$/);
    if (m) out.push({ qty: +m[1], label: m[2] });
  }
  return out;
}

function orderStatus(text: string, packed: boolean): OrderStatus {
  const s = text.toLowerCase();
  if (s.includes("shipped")) return ORDER_STATUS.SHIPPED;
  if (packed || s.includes("packed")) return ORDER_STATUS.PACKED;
  if (s.includes("label bought")) return ORDER_STATUS.READY_LABEL_BOUGHT;
  if (s.includes("ready")) return ORDER_STATUS.READY_FROM_STOCK;
  if (s.includes("printing")) return ORDER_STATUS.PRINTING;
  return ORDER_STATUS.NEEDS_PRINTING;
}

function tab(wb: ExcelJS.Workbook, name: string): Cell[][] | null {
  const ws = wb.worksheets.find((w) => w.name.trim().toLowerCase() === name.toLowerCase());
  return ws ? sheetRows(ws) : null;
}

/**
 * Replaces the tracker's contents with an .xlsx export of the Google Sheet.
 * Keeps the Etsy connection; ledger entries are merged by entry id.
 */
export async function importSheet(buffer: Buffer): Promise<ImportSummary> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const now = new Date();

  // ---- Parts (Sheet1) + on-hand (Printed Stock) ----
  const parts = new Map<string, PartRow>();
  const sheet1 = tab(wb, "Sheet1");
  if (!sheet1) throw new Error('No "Sheet1" tab found — is this an export of the tracker sheet?');
  {
    const h = findHeaderRow(sheet1, ["Description", "Print time"]);
    if (h === -1) throw new Error('Sheet1 has no "Description" / "Print time" header row');
    const hdr = sheet1[h];
    const c = (l: string) => colOf(hdr, l);
    const [cName, cPrint, cFil, cFilPrice, cFilCost, cElec, cDep, cBox, cBag, cWrap, cHw, cLabor, cTouch, cCost, cList, cMargin, cPkg] = [
      "Description", "Print time", "Filament", "Filament Price", "filament cost", "electricity cost", "depreciation", "shipping box", "bag",
      "wrapping", "hardware", "labor cost", "touch time", "COST", "list price", "margin", "Package",
    ].map(c);
    for (const r of sheet1.slice(h + 1)) {
      const name = str(r[cName]);
      if (!name) continue;
      const n = (i: number) => (i === -1 ? 0 : num(r[i]) ?? 0);
      parts.set(name, {
        name,
        description: null,
        printMinutes: n(cPrint),
        filamentGrams: n(cFil),
        filamentPricePerKg: n(cFilPrice),
        filamentCost: n(cFilCost),
        electricityCost: n(cElec),
        depreciation: n(cDep),
        shippingBoxCost: n(cBox),
        bagCost: n(cBag),
        wrappingCost: n(cWrap),
        hardwareCost: n(cHw),
        laborCost: n(cLabor),
        touchTimeMinutes: n(cTouch),
        cost: n(cCost),
        listPrice: cList === -1 ? null : num(r[cList]),
        margin: cMargin === -1 ? null : pct(r[cMargin]),
        packageType: cPkg === -1 ? null : str(r[cPkg]) || null,
        onHand: 0,
      });
    }
  }

  const blankPart = (name: string): PartRow => ({
    name, description: null, printMinutes: 0, filamentGrams: 0, filamentPricePerKg: 0, filamentCost: 0, electricityCost: 0,
    depreciation: 0, shippingBoxCost: 0, bagCost: 0, wrappingCost: 0, hardwareCost: 0, laborCost: 0, touchTimeMinutes: 0,
    cost: 0, listPrice: null, margin: null, packageType: null, onHand: 0,
  });

  const stock = tab(wb, "Printed Stock");
  if (stock) {
    const h = findHeaderRow(stock, ["Part", "On hand"]);
    if (h !== -1) {
      const cPart = colOf(stock[h], "Part");
      const cOn = colOf(stock[h], "On hand");
      for (const r of stock.slice(h + 1)) {
        const name = str(r[cPart]);
        if (!name) continue;
        if (!parts.has(name)) {
          parts.set(name, blankPart(name));
          warnings.push(`"${name}" is in Printed Stock but not Sheet1 — added with zero costs/print time; fill those in under Parts Catalog.`);
        }
        parts.get(name)!.onHand = Math.max(0, Math.round(num(r[cOn]) ?? 0));
      }
    }
  }
  const resolver = new PartResolver([...parts.keys()]);

  // ---- Printers ----
  const printerRows: { name: string; active: boolean; notes: string | null }[] = [];
  const printersTab = tab(wb, "Printers");
  if (printersTab) {
    const h = findHeaderRow(printersTab, ["Printer", "Active"]);
    if (h !== -1) {
      const [cName, cActive, cNotes] = ["Printer", "Active", "Notes"].map((l) => colOf(printersTab[h], l));
      for (const r of printersTab.slice(h + 1)) {
        const name = str(r[cName]);
        if (name) printerRows.push({ name, active: bool(r[cActive]), notes: cNotes === -1 ? null : str(r[cNotes]) || null });
      }
    }
  }

  // ---- Blackout windows + schedule settings ----
  const blackouts: { daysPattern: string; fromTime: string | null; toTime: string | null; note: string | null }[] = [];
  const settings: Record<string, Cell> = {};
  const bt = tab(wb, "Blackout Times");
  if (bt) {
    const h = findHeaderRow(bt, ["Days", "From", "To"]);
    if (h !== -1) {
      const [cDays, cFrom, cTo, cNote] = ["Days", "From", "To", "Note"].map((l) => colOf(bt[h], l));
      for (const r of bt.slice(h + 1)) {
        const days = str(r[cDays]);
        if (!days) continue;
        blackouts.push({ daysPattern: days, fromTime: clock(r[cFrom]), toTime: clock(r[cTo]), note: cNote === -1 ? null : str(r[cNote]) || null });
      }
    }
    // The settings side-panel is "label | value" pairs anywhere on the tab.
    for (const r of bt) {
      r.forEach((cell, i) => {
        const label = str(cell).toLowerCase();
        if (label) settings[label] = r[i + 1] ?? null;
      });
    }
  }
  const setting = (label: string) => settings[label.toLowerCase()];
  const settingClock = (label: string, fallback: string) => clock(setting(label) ?? null) ?? fallback;
  const scheduleSettings = {
    morningStart: settingClock("Morning start", "7:30 AM"),
    morningWindowMinutes: Math.round(num(setting("Morning window (min)")) ?? 15),
    homeTime: settingClock("Home time", "6:00 PM"),
    lastStart: settingClock("Last start", "12:30 AM"),
    changeoverMinutes: Math.round(num(setting("Changeover (min)")) ?? 5),
    homeOnWeekends: setting("Home on weekends") == null ? true : bool(setting("Home on weekends")),
    weekendStart: settingClock("Weekend start", "9:00 AM"),
    postOfficeDays: str(setting("Post office days")) || "Mon, Wed, Fri",
    postOfficeTime: settingClock("Post office time", "12:00 PM"),
    shipWithinDays: Math.round(num(setting("Ship within (days)")) ?? 3),
  };

  // ---- Plate recipes ----
  const recipes: { name: string | null; printer: string | null; plateMinutes: number | null; notes: string | null; parts: { part: string; max: number }[] }[] = [];
  const pr = tab(wb, "Plate Recipes");
  if (pr) {
    const h = findHeaderRow(pr, ["Recipe", "Part 1"]);
    if (h !== -1) {
      const hdr = pr[h];
      const cPrinter = colOf(hdr, "Printer");
      const cRecipe = colOf(hdr, "Recipe");
      const cTime = colOf(hdr, "Plate time");
      const cNotes = colOf(hdr, "Notes");
      const slots = [1, 2, 3, 4, 5, 6].map((i) => [colOf(hdr, `Part ${i}`), colOf(hdr, `Max ${i}`)]).filter(([p]) => p !== -1);
      for (const r of pr.slice(h + 1)) {
        const recipeParts: { part: string; max: number }[] = [];
        for (const [cp, cm] of slots) {
          const label = str(r[cp]);
          if (!label) continue;
          const part = resolver.resolve(label);
          if (!part) {
            warnings.push(`Plate recipe part "${label}" doesn't match any part — skipped.`);
            continue;
          }
          recipeParts.push({ part, max: Math.max(1, Math.round(num(r[cm]) ?? 1)) });
        }
        if (recipeParts.length === 0) continue;
        recipes.push({
          name: str(r[cRecipe]) || null,
          printer: str(r[cPrinter]) || null,
          plateMinutes: cTime === -1 ? null : num(r[cTime]),
          notes: cNotes === -1 ? null : str(r[cNotes]) || null,
          parts: recipeParts,
        });
      }
    }
  }

  // ---- Listing map ----
  const listings: { id: string; title: string; variation: string | null; notes: string | null; autoGuessed: boolean; parts: { part: string; qty: number }[] }[] = [];
  const lm = tab(wb, "Listing Map");
  if (lm) {
    const h = findHeaderRow(lm, ["Listing ID", "Listing title"]);
    if (h !== -1) {
      const hdr = lm[h];
      const cId = colOf(hdr, "Listing ID");
      const cTitle = colOf(hdr, "Listing title");
      const cVar = colOf(hdr, "Variation contains");
      const cNotes = colOf(hdr, "Notes");
      const partCols: [number, string][] = [];
      hdr.forEach((cell, i) => {
        if ([cId, cTitle, cVar, cNotes].includes(i)) return;
        const label = str(cell);
        if (!label) return;
        const part = resolver.resolve(label);
        if (part) partCols.push([i, part]);
        else warnings.push(`Listing Map column "${label}" doesn't match any part — ignored.`);
      });
      for (const r of lm.slice(h + 1)) {
        const id = str(r[cId]);
        if (!id) continue;
        const notes = cNotes === -1 ? null : str(r[cNotes]) || null;
        listings.push({
          id,
          title: str(r[cTitle]) || id,
          variation: cVar === -1 ? null : str(r[cVar]) || null,
          notes,
          autoGuessed: !!notes && /auto-guessed/i.test(notes),
          parts: partCols.map(([i, part]) => ({ part, qty: Math.round(num(r[i]) ?? 0) })).filter((p) => p.qty > 0),
        });
      }
    }
  }

  // ---- Orders: active, then completed (completed wins on duplicate ids) ----
  type OrderRow = {
    etsyOrderId: string; buyerName: string; orderedAt: Date; shipTarget: Date | null; etsyShipBy: Date | null; itemsRaw: string;
    status: OrderStatus; readyBy: Date | null; packed: boolean; labelBought?: boolean; packageType: string | null; shippedAt: Date | null; carrier: string | null;
    trackingNumber: string | null; orderTotal: number | null; etsyGross: number | null; salesTax: number | null; etsyFees: number | null;
    etsyEarnings: number | null; labelCost: number | null; productionCost: number | null; laborMinutes: number | null; netProfit: number | null;
    margin: number | null; parts: { part: string; qty: number }[];
  };
  const orders = new Map<string, OrderRow>();
  let unmatchedOrderParts = 0;
  const partsFrom = (text: string) => {
    const out: { part: string; qty: number }[] = [];
    for (const { label, qty } of qtyLines(text)) {
      const part = resolver.resolve(label);
      if (part) out.push({ part, qty });
      else unmatchedOrderParts++;
    }
    return out;
  };

  const ao = tab(wb, "Active Orders");
  if (ao) {
    const h = findHeaderRow(ao, ["Order", "Buyer", "Status"]);
    if (h !== -1) {
      const c = (l: string) => colOf(ao[h], l);
      const [cId, cBuyer, cOrdered, cTarget, cShipBy, cItems, cParts, cStatus, cReady, cPacked, cPkg] = [
        "Order", "Buyer", "Ordered", "Ship target", "Etsy ship by", "Items", "Parts to print", "Status", "Ready by", "Packed", "Package",
      ].map(c);
      for (const r of ao.slice(h + 1)) {
        const id = str(r[cId]);
        if (!id || /^R-/i.test(id)) continue; // replacements live on their own tab
        const packed = bool(r[cPacked]);
        orders.set(id, {
          etsyOrderId: id,
          buyerName: str(r[cBuyer]) || "(unknown)",
          orderedAt: date(r[cOrdered], now) ?? now,
          shipTarget: date(r[cTarget], now),
          etsyShipBy: date(r[cShipBy], now),
          itemsRaw: str(r[cItems]),
          status: orderStatus(str(r[cStatus]), packed),
          readyBy: date(r[cReady], now),
          packed,
          labelBought: /label bought/i.test(str(r[cStatus])),
          packageType: cPkg === -1 ? null : str(r[cPkg]) || null,
          shippedAt: null, carrier: null, trackingNumber: null, orderTotal: null, etsyGross: null, salesTax: null, etsyFees: null,
          etsyEarnings: null, labelCost: null, productionCost: null, laborMinutes: null, netProfit: null, margin: null,
          parts: partsFrom(str(r[cParts]) || str(r[cItems])),
        });
      }
    }
  }

  const co = tab(wb, "Completed Orders");
  if (co) {
    const h = findHeaderRow(co, ["Order", "Buyer", "Shipped"]);
    if (h !== -1) {
      const c = (l: string) => colOf(co[h], l);
      const [cId, cBuyer, cOrdered, cShipBy, cShipped, cItems, cTotal, cCarrier, cTracking, cGross, cTax, cFees, cEarn, cLabel, cProd, cLabor, cNet, cMargin] = [
        "Order", "Buyer", "Ordered", "Ship by", "Shipped", "Items", "Order total", "Carrier", "Tracking", "Etsy gross", "Sales tax", "Etsy fees",
        "Etsy earnings", "Label cost", "Production cost", "Labor time", "Net profit", "Margin",
      ].map(c);
      const n = (r: Cell[], i: number) => (i === -1 ? null : num(r[i]));
      for (const r of co.slice(h + 1)) {
        const id = str(r[cId]);
        if (!id) continue;
        const shippedAt = date(r[cShipped], now);
        orders.set(id, {
          etsyOrderId: id,
          buyerName: str(r[cBuyer]) || "(unknown)",
          orderedAt: date(r[cOrdered], now) ?? shippedAt ?? now,
          shipTarget: null,
          etsyShipBy: date(r[cShipBy], now),
          itemsRaw: str(r[cItems]),
          status: ORDER_STATUS.SHIPPED,
          readyBy: null,
          packed: true,
          packageType: null,
          shippedAt,
          carrier: str(r[cCarrier]) || null,
          trackingNumber: str(r[cTracking]) || null,
          orderTotal: n(r, cTotal),
          etsyGross: n(r, cGross),
          salesTax: n(r, cTax),
          etsyFees: n(r, cFees),
          etsyEarnings: n(r, cEarn),
          labelCost: n(r, cLabel),
          productionCost: n(r, cProd),
          laborMinutes: n(r, cLabor),
          netProfit: n(r, cNet),
          margin: cMargin === -1 ? null : pct(r[cMargin]),
          parts: partsFrom(str(r[cItems])),
        });
      }
    }
  }
  if (unmatchedOrderParts > 0) {
    warnings.push(`${unmatchedOrderParts} order line(s) didn't match a part name and were kept as text only (they won't count toward stock).`);
  }

  // ---- Replacements ----
  const replacements: {
    code: string; originalOrderId: string | null; buyerName: string; requestedAt: Date; shipByTarget: Date | null; notes: string | null;
    shipped: boolean; labelCost: number | null; cogsLoggedAt: Date | null; labelLoggedAt: Date | null; labelNote: string | null; parts: { part: string; qty: number }[];
  }[] = [];
  const rp = tab(wb, "Replacements");
  if (rp) {
    const h = findHeaderRow(rp, ["ID", "Buyer", "Part"]);
    if (h !== -1) {
      const c = (l: string) => colOf(rp[h], l);
      const [cId, cOrig, cBuyer, cReq, cPart, cQty, cPart2, cQty2, cShipBy, cNotes, cShipped, cLabel, cCogs, cLabelLogged] = [
        "ID", "Original order", "Buyer", "Requested", "Part", "Qty", "Part 2", "Qty 2", "Ship by", "Notes", "Shipped", "Label cost", "COGS logged", "Label logged",
      ].map(c);
      for (const r of rp.slice(h + 1)) {
        const code = str(r[cId]);
        if (!code) continue;
        const ps: { part: string; qty: number }[] = [];
        for (const [cp, cq] of [[cPart, cQty], [cPart2, cQty2]]) {
          const label = str(r[cp]);
          if (!label) continue;
          const part = resolver.resolve(label);
          if (part) ps.push({ part, qty: Math.max(1, Math.round(num(r[cq]) ?? 1)) });
          else warnings.push(`Replacement ${code}: part "${label}" doesn't match any part — skipped.`);
        }
        const labelLoggedRaw = r[cLabelLogged];
        const labelLoggedAt = date(labelLoggedRaw, now);
        replacements.push({
          code,
          originalOrderId: str(r[cOrig]) || null,
          buyerName: str(r[cBuyer]) || "(unknown)",
          requestedAt: date(r[cReq], now) ?? now,
          shipByTarget: date(r[cShipBy], now),
          notes: str(r[cNotes]) || null,
          shipped: bool(r[cShipped]),
          labelCost: num(r[cLabel]),
          cogsLoggedAt: date(r[cCogs], now),
          labelLoggedAt,
          // e.g. "n/a – ships with 4227201631": not a date, but worth keeping.
          labelNote: !labelLoggedAt && str(labelLoggedRaw) ? str(labelLoggedRaw) : null,
          parts: ps,
        });
      }
    }
  }

  // ---- Expenses (only the main table; the right-hand summary is recomputed by the app) ----
  const expenses: { date: Date; item: string; vendor: string | null; category: string | null; cost: number; taxYear: number; scheduleCLine: string | null; deductible: boolean; paidWith: string | null; invoiceRef: string | null; notes: string | null }[] = [];
  const ex = tab(wb, "Expenses");
  if (ex) {
    const h = findHeaderRow(ex, ["Date", "Item", "Cost"]);
    if (h !== -1) {
      const c = (l: string) => colOf(ex[h], l);
      const [cDate, cItem, cVendor, cCat, cCost, cYear, cLine, cDed, cPaid, cInv, cNotes] = [
        "Date", "Item", "Vendor", "Category", "Cost", "Tax year", "Schedule C line", "Deductible", "Paid with", "Invoice", "Notes",
      ].map(c);
      let skipped = 0;
      for (const r of ex.slice(h + 1)) {
        const item = str(r[cItem]);
        const cost = num(r[cCost]);
        if (!item && cost == null) continue;
        const d = date(r[cDate], now);
        if (!d || cost == null) {
          skipped++;
          continue;
        }
        expenses.push({
          date: d,
          item: item || "(no description)",
          vendor: str(r[cVendor]) || null,
          category: str(r[cCat]) || null,
          cost,
          taxYear: Math.round(num(r[cYear]) ?? d.getFullYear()),
          scheduleCLine: str(r[cLine]) || null,
          deductible: cDed === -1 ? true : str(r[cDed]) === "" ? true : bool(r[cDed]),
          paidWith: str(r[cPaid]) || null,
          invoiceRef: str(r[cInv]) || null,
          notes: str(r[cNotes]) || null,
        });
      }
      if (skipped) warnings.push(`${skipped} expense row(s) had no readable date or cost and were skipped.`);
    }
  }

  // ---- Mileage ----
  const mileage: { date: Date; destination: string; purpose: string | null; miles: number; ratePerMile: number }[] = [];
  const ml = tab(wb, "Mileage Log");
  if (ml) {
    const h = findHeaderRow(ml, ["Date", "Destination", "Miles"]);
    if (h !== -1) {
      const c = (l: string) => colOf(ml[h], l);
      const [cDate, cDest, cPurpose, cMiles] = ["Date", "Destination", "Purpose", "Miles"].map(c);
      for (const r of ml.slice(h + 1)) {
        const d = date(r[cDate], now);
        const miles = num(r[cMiles]);
        if (!d || miles == null) continue;
        mileage.push({
          date: d,
          destination: str(r[cDest]) || "(unspecified)",
          purpose: str(r[cPurpose]) || null,
          miles,
          ratePerMile: irsRateFor(d),
        });
      }
    }
  }

  // ---- Etsy ledger (amounts are in cents, as Etsy's API reports them) ----
  const ledger: { etsyEntryId: string; createdAt: Date; ledgerType: string; referenceType: string | null; referenceId: string | null; description: string | null; amount: number; currency: string; balance: number | null; parentEntryId: string | null }[] = [];
  const lg = tab(wb, "Etsy Ledger");
  if (lg) {
    const h = findHeaderRow(lg, ["Created", "Ledger type", "Amount"]);
    if (h !== -1) {
      const c = (l: string) => colOf(lg[h], l);
      const [cCreated, cType, cRefType, cRefId, cDesc, cAmount, cCur, cBal, cEntry, cParent] = [
        "Created", "Ledger type", "Reference type", "Reference ID", "Description", "Amount", "Currency", "Balance", "Entry ID", "Parent entry",
      ].map(c);
      for (const r of lg.slice(h + 1)) {
        const entryId = str(r[cEntry]);
        const created = date(r[cCreated], now);
        const amount = num(r[cAmount]);
        if (!entryId || !created || amount == null) continue;
        const bal = num(r[cBal]);
        ledger.push({
          etsyEntryId: entryId,
          createdAt: created,
          ledgerType: str(r[cType]),
          referenceType: str(r[cRefType]) || null,
          referenceId: str(r[cRefId]) || null,
          description: str(r[cDesc]) || null,
          amount: amount / 100,
          currency: str(r[cCur]) || "USD",
          balance: bal == null ? null : bal / 100,
          parentEntryId: cParent === -1 ? null : str(r[cParent]) || null,
        });
      }
    }
  }

  // ---- Plates physically on a printer right now (Print Queue rows started but not done) ----
  const inFlight: { printer: string | null; label: string; start: Date; minutes: number; forOrders: string | null; parts: { part: string; qty: number }[] }[] = [];
  const pq = tab(wb, "Print Queue");
  if (pq) {
    const h = findHeaderRow(pq, ["Plate contents", "Started"]);
    if (h !== -1) {
      const cData = colOf(pq[h], "_data");
      for (const r of pq.slice(h + 1)) {
        const raw = str(r[cData]);
        if (!raw.startsWith("{")) continue;
        try {
          const d = JSON.parse(raw) as { start: number; minutes: number; label: string; orders?: string; printer?: string; started: boolean; done: boolean; parts: Record<string, number> };
          if (!d.started || d.done) continue;
          const ps = Object.entries(d.parts ?? {})
            .map(([label, qty]) => ({ part: resolver.resolve(label), qty }))
            .filter((p): p is { part: string; qty: number } => !!p.part);
          inFlight.push({ printer: d.printer ?? null, label: d.label, start: new Date(d.start), minutes: d.minutes, forOrders: d.orders ?? null, parts: ps });
        } catch {
          warnings.push("A Print Queue row had unreadable plate data — skipped.");
        }
      }
    }
  }

  let newBoxSizes = 0;

  // ---- Write everything in one transaction ----
  await db.$transaction(
    async (tx) => {
      await tx.plateQueuePart.deleteMany();
      await tx.plateQueueEntry.deleteMany();
      await tx.orderPart.deleteMany();
      await tx.order.deleteMany();
      await tx.replacementPart.deleteMany();
      await tx.replacement.deleteMany();
      await tx.listingPart.deleteMany();
      await tx.listingMapping.deleteMany();
      await tx.plateRecipePart.deleteMany();
      await tx.plateRecipe.deleteMany();
      await tx.blackoutWindow.deleteMany();
      await tx.printer.deleteMany();
      await tx.part.deleteMany();
      await tx.expense.deleteMany();
      await tx.mileageEntry.deleteMany();

      const partIds = new Map<string, string>();
      for (const p of parts.values()) {
        const row = await tx.part.create({ data: p });
        partIds.set(p.name, row.id);
      }
      const printerIds = new Map<string, string>();
      for (const p of printerRows) {
        const row = await tx.printer.create({ data: p });
        printerIds.set(p.name.toLowerCase(), row.id);
      }
      const printerId = (name: string | null) => {
        if (!name) return null;
        const id = printerIds.get(name.toLowerCase());
        if (!id) warnings.push(`Printer "${name}" isn't on the Printers tab — treated as "any printer".`);
        return id ?? null;
      };

      await tx.scheduleSettings.upsert({ where: { id: 1 }, create: { id: 1, ...scheduleSettings }, update: scheduleSettings });
      for (const b of blackouts) await tx.blackoutWindow.create({ data: b });

      for (const r of recipes) {
        await tx.plateRecipe.create({
          data: {
            name: r.name,
            printerId: printerId(r.printer),
            plateMinutes: r.plateMinutes,
            notes: r.notes,
            parts: { create: r.parts.map((p) => ({ partId: partIds.get(p.part)!, maxCount: p.max })) },
          },
        });
      }

      for (const l of listings) {
        await tx.listingMapping.create({
          data: {
            etsyListingId: l.id,
            listingTitle: l.title,
            variationContains: l.variation,
            notes: l.notes,
            autoGuessed: l.autoGuessed,
            parts: { create: l.parts.map((p) => ({ partId: partIds.get(p.part)!, quantity: p.qty })) },
          },
        });
      }

      for (const o of orders.values()) {
        const { parts: ps, ...data } = o;
        await tx.order.create({ data: { ...data, parts: { create: ps.map((p) => ({ partId: partIds.get(p.part)!, quantity: p.qty })) } } });
      }

      for (const r of replacements) {
        const { parts: ps, labelNote, ...data } = r;
        await tx.replacement.create({
          data: {
            ...data,
            notes: [data.notes, labelNote ? `Label: ${labelNote}` : null].filter(Boolean).join(" · ") || null,
            parts: { create: ps.map((p) => ({ partId: partIds.get(p.part)!, quantity: p.qty })) },
          },
        });
      }

      // Box stock isn't in the sheet: keep existing counts, just add any new sizes.
      const known = new Set((await tx.box.findMany()).map((b) => normBoxName(b.name)));
      const sizes = [...parts.values()].map((p) => p.packageType).concat([...orders.values()].map((o) => o.packageType));
      for (const size of sizes) {
        if (!size || known.has(normBoxName(size))) continue;
        known.add(normBoxName(size));
        await tx.box.create({ data: { name: size, onHand: 0 } });
        newBoxSizes++;
      }

      for (const e of expenses) await tx.expense.create({ data: e });
      for (const m of mileage) await tx.mileageEntry.create({ data: m });

      for (const l of ledger) {
        await tx.etsyLedgerEntry.upsert({ where: { etsyEntryId: l.etsyEntryId }, create: l, update: l });
      }

      for (const f of inFlight) {
        await tx.plateQueueEntry.create({
          data: {
            printerId: printerId(f.printer),
            label: f.label,
            plannedStart: f.start,
            plannedFinish: new Date(f.start.getTime() + f.minutes * 60_000),
            printMinutes: f.minutes,
            forOrders: f.forOrders,
            started: true,
            startedAt: f.start,
            manualEntry: true,
            parts: { create: f.parts.map((p) => ({ partId: partIds.get(p.part)!, quantity: p.qty })) },
          },
        });
      }
    },
    { timeout: 120_000 }
  );

  await rebuildQueue();

  Object.assign(counts, {
    parts: parts.size,
    printers: printerRows.length,
    plateRecipes: recipes.length,
    blackoutWindows: blackouts.length,
    listingMappings: listings.length,
    activeOrders: [...orders.values()].filter((o) => o.status !== ORDER_STATUS.SHIPPED).length,
    completedOrders: [...orders.values()].filter((o) => o.status === ORDER_STATUS.SHIPPED).length,
    replacements: replacements.length,
    expenses: expenses.length,
    mileageEntries: mileage.length,
    ledgerEntries: ledger.length,
    platesPrintingNow: inFlight.length,
    newBoxSizes,
  });
  if (newBoxSizes > 0) warnings.push(`Added ${newBoxSizes} box size(s) with a count of 0 — set how many you have on the Shipping Boxes page.`);
  return { counts, warnings: [...new Set(warnings)] };
}
