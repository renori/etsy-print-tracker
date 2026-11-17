import { addMinutes } from "./time.js";
import { Interval, nextPointInIntervals } from "./intervals.js";
import { BlackoutRule, ScheduleSettings, startableIntervals } from "./windows.js";
import { PendingPlate } from "./plates.js";

export interface FixedPlate {
  id: string;
  printerId: string;
  plannedFinish: Date; // already started/in progress — immovable
}

export interface ScheduledPlate extends PendingPlate {
  printerId: string;
  plannedStart: Date;
  plannedFinish: Date;
}

const HORIZON_STEP_DAYS = 14;
const MAX_HORIZON_DAYS = 90;

/**
 * Assigns pending plates onto active printers' timelines, honoring blackout
 * windows and the morning/evening start windows. Already-started plates are
 * fixed and simply block their printer until they finish.
 */
export function schedulePlates(
  pending: PendingPlate[],
  activePrinterIds: string[],
  fixed: FixedPlate[],
  settings: ScheduleSettings,
  blackouts: BlackoutRule[],
  now: Date = new Date()
): ScheduledPlate[] {
  if (activePrinterIds.length === 0) return [];

  const nextAvailable = new Map<string, Date>();
  for (const id of activePrinterIds) nextAvailable.set(id, now);
  for (const f of fixed) {
    if (!nextAvailable.has(f.printerId)) continue;
    const cur = nextAvailable.get(f.printerId)!;
    if (f.plannedFinish.getTime() > cur.getTime()) nextAvailable.set(f.printerId, f.plannedFinish);
  }

  let horizonDays = HORIZON_STEP_DAYS;
  let startable: Interval[] = startableIntervals(settings, blackouts, now, addMinutes(now, horizonDays * 1440));

  function findStart(from: Date): Date {
    let point = nextPointInIntervals(startable, from);
    while (point == null) {
      horizonDays += HORIZON_STEP_DAYS;
      if (horizonDays > MAX_HORIZON_DAYS) {
        throw new Error("Could not find a start window within the scheduling horizon — check Blackout Times settings");
      }
      startable = startableIntervals(settings, blackouts, now, addMinutes(now, horizonDays * 1440));
      point = nextPointInIntervals(startable, from);
    }
    return point;
  }

  const out: ScheduledPlate[] = [];

  for (const plate of pending) {
    const candidates = plate.printerId ? [plate.printerId] : activePrinterIds;
    const eligible = candidates.filter((id) => nextAvailable.has(id));
    if (eligible.length === 0) continue; // its pinned printer isn't active — leave unscheduled

    // Pick whichever eligible printer frees up soonest.
    eligible.sort((a, b) => nextAvailable.get(a)!.getTime() - nextAvailable.get(b)!.getTime());
    const printerId = eligible[0];

    const start = findStart(nextAvailable.get(printerId)!);
    const finish = addMinutes(start, plate.minutes);
    nextAvailable.set(printerId, finish);

    out.push({ ...plate, printerId, plannedStart: start, plannedFinish: finish });
  }

  return out;
}
