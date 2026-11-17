import { addMinutes, dateAtClockTime, parseClockTime, startOfDay } from "./time.js";
import { Interval, mergeIntervals, subtractIntervals } from "./intervals.js";

const DAY_ABBR: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const DAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface BlackoutRule {
  daysPattern: string;
  fromTime?: string | null;
  toTime?: string | null;
}

export interface ScheduleSettings {
  morningStart: string;
  morningWindowMinutes: number;
  homeTime: string;
  lastStart: string;
}

type DayMatcher = { kind: "date"; date: Date } | { kind: "weekly"; days: Set<number> };

function parseDayToken(token: string): number[] {
  const t = token.trim();
  if (/^daily$/i.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  if (/^weekdays?$/i.test(t)) return [1, 2, 3, 4, 5];
  if (/^weekends?$/i.test(t)) return [0, 6];
  const range = t.match(/^(\w{3})-(\w{3})$/);
  if (range) {
    const start = DAY_ABBR[range[1]];
    const end = DAY_ABBR[range[2]];
    if (start === undefined || end === undefined) throw new Error(`Bad day range "${t}"`);
    const days: number[] = [];
    let i = start;
    while (true) {
      days.push(i);
      if (i === end) break;
      i = (i + 1) % 7;
    }
    return days;
  }
  const single = DAY_ABBR[t];
  if (single === undefined) throw new Error(`Unrecognized day token "${t}"`);
  return [single];
}

export function parseDaysPattern(pattern: string): DayMatcher {
  const p = pattern.trim();
  const dateMatch = p.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dateMatch) {
    const [, m, d, y] = dateMatch;
    return { kind: "date", date: new Date(Number(y), Number(m) - 1, Number(d)) };
  }
  const days = new Set<number>();
  for (const token of p.split(",")) {
    for (const d of parseDayToken(token)) days.add(d);
  }
  return { kind: "weekly", days };
}

function dayMatches(matcher: DayMatcher, day: Date): boolean {
  if (matcher.kind === "date") {
    return (
      matcher.date.getFullYear() === day.getFullYear() &&
      matcher.date.getMonth() === day.getMonth() &&
      matcher.date.getDate() === day.getDate()
    );
  }
  return matcher.days.has(day.getDay());
}

/** Expands a from/to clock-time pair anchored on `day` into one or two absolute intervals (handles midnight wrap). */
function clockIntervalOnDay(day: Date, fromTime: string | null | undefined, toTime: string | null | undefined): Interval[] {
  if (!fromTime && !toTime) {
    return [[startOfDay(day), addMinutes(startOfDay(day), 1440)]];
  }
  const fromMin = parseClockTime(fromTime || "12:00 AM");
  const toMin = parseClockTime(toTime || "11:59 PM");
  if (toMin <= fromMin) {
    return [
      [dateAtClockTime(day, fromMin), addMinutes(startOfDay(day), 1440)],
      [addMinutes(startOfDay(day), 1440), dateAtClockTime(addMinutes(startOfDay(day), 1440), toMin)],
    ];
  }
  return [[dateAtClockTime(day, fromMin), dateAtClockTime(day, toMin)]];
}

/** Blackout intervals (merged) covering [horizonStart, horizonEnd). */
export function blackoutIntervals(rules: BlackoutRule[], horizonStart: Date, horizonEnd: Date): Interval[] {
  const out: Interval[] = [];
  const day = startOfDay(horizonStart);
  for (let d = new Date(day); d.getTime() < horizonEnd.getTime(); d = addMinutes(d, 1440)) {
    for (const rule of rules) {
      const matcher = parseDaysPattern(rule.daysPattern);
      if (!dayMatches(matcher, d)) continue;
      for (const interval of clockIntervalOnDay(d, rule.fromTime, rule.toTime)) {
        out.push(interval);
      }
    }
  }
  return mergeIntervals(out);
}

/** Morning + evening "you're physically there to start a plate" windows, before blackout subtraction. */
export function rawStartWindows(settings: ScheduleSettings, horizonStart: Date, horizonEnd: Date): Interval[] {
  const out: Interval[] = [];
  const morningStartMin = parseClockTime(settings.morningStart);
  const morningEndMin = morningStartMin + settings.morningWindowMinutes;
  const homeMin = parseClockTime(settings.homeTime);
  const lastStartMin = parseClockTime(settings.lastStart);

  const day0 = startOfDay(horizonStart);
  for (let d = new Date(day0); d.getTime() < horizonEnd.getTime(); d = addMinutes(d, 1440)) {
    out.push([dateAtClockTime(d, morningStartMin), dateAtClockTime(d, morningEndMin)]);
    const eveningStart = dateAtClockTime(d, homeMin);
    const eveningEnd =
      lastStartMin <= homeMin ? dateAtClockTime(addMinutes(d, 1440), lastStartMin) : dateAtClockTime(d, lastStartMin);
    out.push([eveningStart, eveningEnd]);
  }
  return mergeIntervals(out);
}

/** Final set of instants at which a NEW plate may be started: start windows minus blackouts. */
export function startableIntervals(
  settings: ScheduleSettings,
  blackouts: BlackoutRule[],
  horizonStart: Date,
  horizonEnd: Date
): Interval[] {
  const allowed = rawStartWindows(settings, horizonStart, horizonEnd);
  const blocked = blackoutIntervals(blackouts, horizonStart, addMinutes(horizonEnd, 1440));
  return subtractIntervals(allowed, blocked);
}
