import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { fmtDateTime } from "../lib/format";
import { Button, Icon, PageHeader } from "../components/ui";

interface Status {
  dir: string;
  mounted: boolean | null;
  schedule: string;
  keepDays: number;
  keepMonths: number;
  last: { at: string; ok: boolean; file?: string; bytes?: number; error?: string; reason: string } | null;
  files: { name: string; bytes: number; at: string }[];
}

const size = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

export function Backups() {
  const qc = useQueryClient();
  const { data: s, isLoading } = useQuery({ queryKey: ["backups"], queryFn: () => api.get<Status>("/backups") });
  const run = useMutation({ mutationFn: () => api.post<Status & { result: Status["last"] }>("/backups/run", {}), onSuccess: (d) => qc.setQueryData(["backups"], d) });
  const newest = s?.files[0];
  const stale = newest && Date.now() - new Date(newest.at).getTime() > 2 * 86_400_000;

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="Backups"
        subtitle="A full copy of the tracker's data every night. Sync the backup folder to Google Drive with TOS's CloudSync app."
        actions={
          <Button icon="download" variant="primary" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? "Backing up…" : "Back up now"}
          </Button>
        }
      />
      {isLoading || !s ? (
        <p className="py-10 text-center text-neutral-500">Loading…</p>
      ) : (
        <>
          {s.mounted === false && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              <div className="flex items-center gap-2 font-semibold">
                <Icon name="alert" className="h-4 w-4" />
                Backups are only inside the container
              </div>
              <p className="mt-1">
                No NAS folder is mapped to <code>{s.dir}</code>, so backups would be lost when the container is replaced and can't reach Google Drive.
                Add the <code>/Volume1/Backups/print-tracker:/app/backups</code> line to the compose file (steps below) and redeploy.
              </p>
            </div>
          )}
          {(s.last && !s.last.ok) || stale ? (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {s.last && !s.last.ok ? `The last backup failed (${fmtDateTime(s.last.at)}): ${s.last.error}` : `The newest backup is from ${fmtDateTime(newest!.at)}: over two days old.`}
            </div>
          ) : null}

          <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-neutral-500">Latest backup</dt>
                <dd className="font-semibold">{newest ? fmtDateTime(newest.at) : "None yet"}</dd>
                {newest && <dd className="text-xs text-neutral-500">{size(newest.bytes)}</dd>}
              </div>
              <div>
                <dt className="text-neutral-500">Schedule</dt>
                <dd className="font-semibold">Every night at {clock(s.schedule)}</dd>
                <dd className="text-xs text-neutral-500">
                  Keeps {s.keepDays} days, plus one a month for {s.keepMonths} months
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">Saved to</dt>
                <dd className="font-semibold">{s.mounted ? "NAS backup folder" : s.mounted === false ? "Inside the container only" : s.dir}</dd>
                <dd className="text-xs text-neutral-500">{s.files.length} backups</dd>
              </div>
            </dl>
            {run.data?.result?.ok && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">Backed up: {run.data.result.file}</p>}
          </section>

          {s.files.length > 0 && (
            <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="font-semibold">Backups</h2>
              <ul className="mt-2 divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
                {s.files.map((f) => (
                  <li key={f.name} className="flex items-center gap-3 py-1.5">
                    <span className="flex-1">{fmtDateTime(f.at)}</span>
                    <span className="text-neutral-500 tabular-nums">{size(f.bytes)}</span>
                    <a href={`/api/backups/${encodeURIComponent(f.name)}`} download className="inline-flex min-h-9 items-center gap-1 text-indigo-700 underline dark:text-indigo-400">
                      <Icon name="download" className="h-4 w-4" />
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2 text-sm text-neutral-700 dark:text-neutral-300">
            <h2 className="font-semibold">Sending backups to Google Drive</h2>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                In TOS <b>Control Panel → Shared Folders</b>, create a folder (e.g. <code>Backups</code>) if you don't have one.
              </li>
              <li>
                In the tracker's compose file, under <code>print-tracker</code> → <code>volumes</code>, add <code>- /Volume1/Backups/print-tracker:/app/backups</code>{" "}
                and redeploy. This page then shows "NAS backup folder".
              </li>
              <li>
                Install <b>CloudSync</b> from the TOS App Center, add a Google Drive connection (sign in with Google), and create a task syncing{" "}
                <code>Backups/print-tracker</code> to a Google Drive folder. Pick the one-way <b>upload</b> (local → cloud) mode, so
                nothing on Drive can change the NAS copy.
              </li>
            </ol>
            <h2 className="pt-2 font-semibold">Restoring</h2>
            <p>
              Each backup is the complete database. To restore: stop the tracker in Docker Manager, copy the backup over <code>tracker.db</code> in the{" "}
              <code>tracker-data</code> volume (rename the backup to <code>tracker.db</code>), and start it again.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
