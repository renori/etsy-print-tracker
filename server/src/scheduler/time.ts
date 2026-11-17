/** Parses "7:30 AM" / "12:30 AM" / "18:00" into minutes-since-midnight (0-1439). */
export function parseClockTime(input: string): number {
  const s = input.trim();
  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10) % 12;
    const m = parseInt(ampm[2], 10);
    if (ampm[3].toUpperCase() === "PM") h += 12;
    return h * 60 + m;
  }
  const bare = s.match(/^(\d{1,2}):(\d{2})$/);
  if (bare) {
    return parseInt(bare[1], 10) * 60 + parseInt(bare[2], 10);
  }
  throw new Error(`Unrecognized time "${input}"`);
}

export function minutesToClock(mins: number): string {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? "AM" : "PM";
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Midnight (local) of the given date, as minutes offset from a fixed epoch day. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addMinutes(d: Date, mins: number): Date {
  return new Date(d.getTime() + mins * 60_000);
}

export function dateAtClockTime(day: Date, clockMinutes: number): Date {
  return addMinutes(startOfDay(day), clockMinutes);
}
