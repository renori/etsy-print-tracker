import type ExcelJS from "exceljs";

export type Cell = string | number | boolean | Date | null;

/**
 * Flattens an exceljs cell value (formula results, rich text, hyperlinks, dates)
 * to a plain value. Excel dates come back as UTC instants of the wall-clock
 * time in the sheet, so they're rebuilt as local-time Dates here.
 */
export function plain(v: ExcelJS.CellValue): Cell {
  if (v == null) return null;
  if (v instanceof Date) {
    return new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate(), v.getUTCHours(), v.getUTCMinutes(), v.getUTCSeconds());
  }
  if (typeof v === "object") {
    if ("result" in v) return plain((v as { result: ExcelJS.CellValue }).result);
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    if ("text" in v) return String((v as { text: unknown }).text);
    if ("error" in v) return null;
    return null;
  }
  return v as Cell;
}

export function sheetRows(ws: ExcelJS.Worksheet): Cell[][] {
  const rows: Cell[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const out: Cell[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      out[colNumber - 1] = plain(cell.value);
    });
    rows[rowNumber - 1] = out;
  });
  return Array.from(rows, (r) => r ?? []);
}

export function str(v: Cell | undefined): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

export function num(v: Cell | undefined): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean" || v instanceof Date) return null;
  const n = parseFloat(String(v).replace(/[$,%\s]|USD|min/gi, ""));
  return Number.isFinite(n) ? n : null;
}

/** "85%" → 0.85, 0.85 → 0.85, 85 → 0.85 */
export function pct(v: Cell | undefined): number | null {
  const n = num(v);
  if (n == null) return null;
  if (typeof v === "string" && v.includes("%")) return n / 100;
  return n > 1 ? n / 100 : n;
}

export function bool(v: Cell | undefined): boolean {
  if (typeof v === "boolean") return v;
  const s = str(v).toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1";
}

/**
 * Accepts real dates and the sheet's text formats: "Thu 11/12/26 9:00 AM",
 * "11/1/26", "Thu 11/12" (no year), "09/12/2026", "2026-11-13 00:01".
 */
export function date(v: Cell | undefined, now = new Date()): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    // Excel serial day number.
    const ms = Math.round((v - 25569) * 86_400_000);
    const d = new Date(ms);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3], +(iso[4] ?? 0), +(iso[5] ?? 0));

  const m = s.replace(/^[A-Za-z]{3,9},?\s+/, "").match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
  if (!m) return null;
  let year: number;
  if (m[3]) {
    year = +m[3] < 100 ? 2000 + +m[3] : +m[3];
  } else {
    // No year shown: assume the closest one that isn't months in the future.
    year = now.getFullYear();
    if (new Date(year, +m[1] - 1, +m[2]).getTime() > now.getTime() + 60 * 86_400_000) year -= 1;
  }
  let hour = m[4] ? +m[4] : 0;
  if (m[6]) hour = (hour % 12) + (m[6].toUpperCase() === "PM" ? 12 : 0);
  return new Date(year, +m[1] - 1, +m[2], hour, m[5] ? +m[5] : 0);
}

/** A time-of-day cell (Date or text) as "h:mm AM", or null if blank. */
export function clock(v: Cell | undefined): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    const h = v.getHours();
    return `${h % 12 === 0 ? 12 : h % 12}:${String(v.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }
  if (typeof v === "number") {
    const mins = Math.round((v % 1) * 1440);
    const h = Math.floor(mins / 60);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(mins % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }
  return String(v).trim() || null;
}

/** Index of the first row containing every label (case-insensitive), or -1. */
export function findHeaderRow(rows: Cell[][], labels: string[]): number {
  const want = labels.map((l) => l.toLowerCase());
  return rows.findIndex((r) => {
    const have = r.map((c) => str(c).toLowerCase());
    return want.every((w) => have.some((h) => h === w || h.startsWith(w)));
  });
}

/** Column index of the FIRST header matching label (exact, else prefix), or -1. */
export function colOf(header: Cell[], label: string): number {
  const l = label.toLowerCase();
  const cells = header.map((c) => str(c).toLowerCase());
  const exact = cells.indexOf(l);
  return exact !== -1 ? exact : cells.findIndex((h) => h.startsWith(l));
}
