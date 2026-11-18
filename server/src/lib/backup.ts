import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import cron from "node-cron";
import { db } from "./db.js";

/**
 * Nightly backups of the whole tracker database into BACKUP_DIR, which the
 * compose file maps to a NAS shared folder; TOS's CloudSync app then copies
 * that folder to Google Drive.
 *
 * Each backup is a complete, consistent SQLite file made with VACUUM INTO
 * (safe while the app is running), named tracker-YYYY-MM-DD_HHMM.db.
 * Kept: every backup from the last KEEP_DAYS days, plus the first backup of
 * each month for a year.
 */

export const BACKUP_DIR = process.env.BACKUP_DIR || "/app/backups";
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 30);
const KEEP_MONTHS = 12;
/** Local time, "HH:MM". */
const BACKUP_TIME = /^\d{1,2}:\d{2}$/.test(process.env.BACKUP_TIME ?? "") ? process.env.BACKUP_TIME! : "03:15";
const NAME = /^tracker-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(?:-\d+)?\.db$/;

let last: { at: string; ok: boolean; file?: string; bytes?: number; error?: string; reason: string } | null = null;

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;

/** True when BACKUP_DIR is its own mount (i.e. a NAS folder), not just a directory inside the container. */
export function backupDirIsMounted(): boolean | null {
  try {
    const target = path.resolve(BACKUP_DIR);
    return readFileSync("/proc/self/mountinfo", "utf8")
      .split("\n")
      .some((l) => l.split(" ")[4] === target);
  } catch {
    return null; // not Linux / can't tell
  }
}

export interface BackupFile {
  name: string;
  bytes: number;
  at: string;
}

export async function listBackups(): Promise<BackupFile[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(BACKUP_DIR);
  } catch {
    return [];
  }
  const out: (BackupFile & { mtime: number })[] = [];
  for (const name of names) {
    const m = name.match(NAME);
    if (!m) continue;
    const st = await fs.stat(path.join(BACKUP_DIR, name));
    out.push({ name, bytes: st.size, at: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).toISOString(), mtime: st.mtimeMs });
  }
  // Newest first; two in the same minute go by when the file was written.
  return out.sort((a, b) => b.at.localeCompare(a.at) || b.mtime - a.mtime).map(({ mtime: _m, ...f }) => f);
}

/** Which backups to delete: older than KEEP_DAYS, except the first of each month for KEEP_MONTHS. */
export function toPrune(files: BackupFile[], now = new Date()): string[] {
  const dayCutoff = now.getTime() - KEEP_DAYS * 86_400_000;
  const monthCutoff = new Date(now.getFullYear(), now.getMonth() - KEEP_MONTHS, 1).getTime();
  const firstOfMonth = new Set<string>();
  const seen = new Set<string>();
  for (const f of [...files].sort((a, b) => a.at.localeCompare(b.at))) {
    const key = f.at.slice(0, 7);
    if (!seen.has(key)) {
      seen.add(key);
      firstOfMonth.add(f.name);
    }
  }
  return files
    .filter((f) => {
      const t = new Date(f.at).getTime();
      if (t >= dayCutoff) return false;
      if (firstOfMonth.has(f.name) && t >= monthCutoff) return false;
      return true;
    })
    .map((f) => f.name);
}

/** Makes a backup now and prunes old ones. Never throws; the result says what happened. */
export async function runBackup(reason: "nightly" | "manual" | "startup") {
  const now = new Date();
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    let name = `tracker-${stamp(now)}.db`;
    for (let i = 2; await fs.stat(path.join(BACKUP_DIR, name)).then(() => true, () => false); i++) name = `tracker-${stamp(now)}-${i}.db`;
    const file = path.join(BACKUP_DIR, name);
    // VACUUM INTO writes a consistent copy even while the app is writing. Path is ours, but quote it anyway.
    await db.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const { size } = await fs.stat(file);
    for (const old of toPrune(await listBackups(), now)) await fs.rm(path.join(BACKUP_DIR, old), { force: true });
    last = { at: now.toISOString(), ok: true, file: name, bytes: size, reason };
    console.log(`[backup] ${reason}: wrote ${name} (${Math.round(size / 1024)} KB)`);
  } catch (err) {
    last = { at: now.toISOString(), ok: false, error: err instanceof Error ? err.message : String(err), reason };
    console.error(`[backup] ${reason} backup failed:`, err);
  }
  return last;
}

export async function backupStatus() {
  const files = await listBackups();
  return {
    dir: BACKUP_DIR,
    mounted: backupDirIsMounted(),
    schedule: BACKUP_TIME,
    keepDays: KEEP_DAYS,
    keepMonths: KEEP_MONTHS,
    last,
    files,
  };
}

/** Nightly at BACKUP_TIME, plus one at startup if the newest backup is over a day old. */
export async function startBackupJob() {
  const [h, m] = BACKUP_TIME.split(":").map(Number);
  cron.schedule(`${m} ${h} * * *`, () => void runBackup("nightly"));
  const newest = (await listBackups())[0];
  if (!newest || Date.now() - new Date(newest.at).getTime() > 86_400_000) await runBackup("startup");
}
