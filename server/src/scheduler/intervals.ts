export type Interval = [Date, Date];

function byStart(a: Interval, b: Interval) {
  return a[0].getTime() - b[0].getTime();
}

/** Merges overlapping/touching intervals. Input need not be sorted. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort(byStart);
  const out: Interval[] = [sorted[0]];
  for (const cur of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (cur[0].getTime() <= last[1].getTime()) {
      if (cur[1].getTime() > last[1].getTime()) last[1] = cur[1];
    } else {
      out.push(cur);
    }
  }
  return out;
}

/** A minus B, where both are pre-merged, sorted interval lists. */
export function subtractIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [aStart, aEnd] of a) {
    let curStart = aStart;
    const overlapping = b.filter(([bs, be]) => be.getTime() > aStart.getTime() && bs.getTime() < aEnd.getTime());
    overlapping.sort(byStart);
    for (const [bs, be] of overlapping) {
      if (bs.getTime() > curStart.getTime()) {
        out.push([curStart, new Date(Math.min(bs.getTime(), aEnd.getTime()))]);
      }
      if (be.getTime() > curStart.getTime()) {
        curStart = new Date(Math.max(curStart.getTime(), be.getTime()));
      }
    }
    if (curStart.getTime() < aEnd.getTime()) {
      out.push([curStart, aEnd]);
    }
  }
  return out;
}

/** First point at or after `from` that lies within one of the (sorted, merged) intervals. */
export function nextPointInIntervals(intervals: Interval[], from: Date): Date | null {
  for (const [start, end] of intervals) {
    if (end.getTime() <= from.getTime()) continue;
    return start.getTime() >= from.getTime() ? start : from;
  }
  return null;
}
