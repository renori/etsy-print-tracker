/**
 * IRS business standard mileage rates ($/mile), by the date each took effect.
 * The IRS occasionally changes the rate mid-year (Jul 2022, Jul 2026), so
 * rates are looked up by trip date, not just year. Add a row when the IRS
 * announces a new rate (usually each December).
 */
export const IRS_BUSINESS_RATES: { from: string; rate: number; source: string }[] = [
  { from: "2022-01-01", rate: 0.585, source: "IR-2021-251" },
  { from: "2022-07-01", rate: 0.625, source: "IR-2022-124" },
  { from: "2023-01-01", rate: 0.655, source: "IR-2022-234" },
  { from: "2024-01-01", rate: 0.67, source: "IR-2023-239" },
  { from: "2025-01-01", rate: 0.7, source: "IR-2024-312" },
  { from: "2026-01-01", rate: 0.725, source: "IR-2025-128 / Notice 2026-10" },
  { from: "2026-07-01", rate: 0.76, source: "Announcement 2026-11" },
];

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The rate in effect on the trip date (the latest known rate for dates past the table). */
export function irsRateFor(date: Date): number {
  const key = dayKey(date);
  let rate = IRS_BUSINESS_RATES[0].rate;
  for (const r of IRS_BUSINESS_RATES) if (r.from <= key) rate = r.rate;
  return rate;
}
