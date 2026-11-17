import { useState } from "react";
import { useFinishPlate, useLogPrint, useOrdersOpenCount, useQueue, useRebuildQueue, useStartPlate } from "../api/resources";
import { partsApi, printersApi } from "../api/resources";
import type { QueueEntry } from "../api/types";
import { fmtDateTime, fmtHours } from "../lib/format";
import { Modal } from "../components/Modal";
import { Button, Field, PageHeader, Stepper, inputClass } from "../components/ui";

function PlateCard({ entry, onStart, onDone, busy }: { entry: QueueEntry; onStart: () => void; onDone: () => void; busy: boolean }) {
  const now = Date.now();
  const finish = new Date(entry.plannedFinish).getTime();
  const start = new Date(entry.startedAt ?? entry.plannedStart).getTime();
  const finished = entry.started && finish <= now;
  const pct = entry.started ? Math.min(100, Math.max(0, ((now - start) / (finish - start)) * 100)) : 0;

  return (
    <div
      className={`rounded-xl border p-4 shadow-sm ${
        finished
          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
          : entry.started
            ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
            : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[12rem] flex-1">
          <div className="font-semibold">{entry.label}</div>
          <div className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">
            {fmtDateTime(entry.plannedStart)} → {fmtDateTime(entry.plannedFinish)}
          </div>
          <div className="text-xs text-neutral-500">
            {Math.round(entry.printMinutes)} min{entry.forOrders && ` · ${entry.forOrders}`}
            {entry.manualEntry && !/logged by hand/i.test(entry.forOrders ?? "") && " · logged by hand"}
          </div>
        </div>
        {!entry.started ? (
          <Button icon="play" onClick={onStart} disabled={busy} className="w-full sm:w-auto">
            Start
          </Button>
        ) : (
          <Button variant="success" icon="check" onClick={onDone} disabled={busy} className="w-full sm:w-auto">
            {finished ? "Take off · Done" : "Done"}
          </Button>
        )}
      </div>
      {entry.started && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Print progress">
          <div className={`h-full rounded-full ${finished ? "bg-emerald-600" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function Dashboard() {
  const { data: queue, isLoading } = useQueue();
  const { data: printers } = printersApi.useList();
  const { data: parts } = partsApi.useList();
  const { mutate: rebuild, isPending: rebuilding } = useRebuildQueue();
  const { mutate: start, isPending: starting } = useStartPlate();
  const { mutate: finish, isPending: finishing } = useFinishPlate();
  const openOrders = useOrdersOpenCount();
  const [loggingPrint, setLoggingPrint] = useState(false);

  const printing = (queue ?? []).filter((q) => q.started && !q.done);
  const plannedMinutes = (queue ?? []).reduce((s, q) => s + q.printMinutes, 0);
  const activePrinters = (printers ?? []).filter((p) => p.active);

  const byPrinter = new Map<string, QueueEntry[]>();
  for (const p of activePrinters) byPrinter.set(p.id, []);
  for (const entry of queue ?? []) {
    const key = entry.printerId ?? "unassigned";
    if (!byPrinter.has(key)) byPrinter.set(key, []);
    byPrinter.get(key)!.push(entry);
  }

  return (
    <div>
      <PageHeader
        title="Print Queue"
        subtitle={`${openOrders} open order${openOrders === 1 ? "" : "s"} · ${printing.length} printing · ${fmtHours(plannedMinutes)} queued`}
        actions={
          <>
            <Button icon="plus" onClick={() => setLoggingPrint(true)}>
              Log a print
            </Button>
            <Button variant="primary" icon="refresh" onClick={() => rebuild()} disabled={rebuilding}>
              {rebuilding ? "Rebuilding…" : "Rebuild"}
            </Button>
          </>
        }
      />

      {isLoading ? (
        <p className="py-10 text-center text-neutral-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          {[...byPrinter.entries()].map(([printerId, entries]) => {
            const printer = activePrinters.find((p) => p.id === printerId);
            const sorted = [...entries].sort((a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime());
            return (
              <section key={printerId} className="space-y-2.5">
                <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-neutral-600 uppercase dark:text-neutral-400">
                  {printer?.name ?? "Any printer"}
                  <span className="font-normal normal-case text-neutral-500">· {sorted.length ? `${sorted.length} plate${sorted.length > 1 ? "s" : ""}` : "idle"}</span>
                </h2>
                {sorted.map((entry) => (
                  <PlateCard key={entry.id} entry={entry} busy={starting || finishing} onStart={() => start(entry.id)} onDone={() => finish(entry.id)} />
                ))}
                {sorted.length === 0 && (
                  <p className="rounded-xl border border-dashed border-neutral-300 p-4 text-sm text-neutral-500 dark:border-neutral-700">Nothing queued for this printer.</p>
                )}
              </section>
            );
          })}
          {(queue ?? []).length === 0 && activePrinters.length === 0 && (
            <p className="py-10 text-center text-neutral-500">Nothing queued — all caught up.</p>
          )}
        </div>
      )}

      {loggingPrint && <LogPrintModal parts={(parts ?? []).filter((p) => p.active)} printers={printers ?? []} onClose={() => setLoggingPrint(false)} />}
    </div>
  );
}

export function LogPrintModal({
  parts,
  printers,
  onClose,
}: {
  parts: { id: string; name: string }[];
  printers: { id: string; name: string; active: boolean }[];
  onClose: () => void;
}) {
  const { mutate: logPrint, isPending } = useLogPrint();
  const active = printers.filter((p) => p.active);
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState(1);
  const [printerId, setPrinterId] = useState(active.length === 1 ? active[0].id : "");
  const [printMinutes, setPrintMinutes] = useState<string>("");

  return (
    <Modal title="Log a print" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!partId) return;
          logPrint(
            { printerId: printerId || null, printMinutes: printMinutes ? Number(printMinutes) : undefined, parts: [{ partId, quantity: qty }] },
            { onSuccess: onClose }
          );
        }}
      >
        <p className="text-sm text-neutral-600 dark:text-neutral-400">For a plate you already started without tapping Start. It's logged as started now.</p>
        <Field label="Part">
          <select className={inputClass} value={partId} onChange={(e) => setPartId(e.target.value)} required>
            <option value="">Choose a part…</option>
            {parts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">How many on the plate</span>
          <Stepper value={qty} min={1} onChange={setQty} label="Quantity" />
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-neutral-700 dark:text-neutral-300">Printer</legend>
          <div className="flex flex-wrap gap-2">
            {[{ id: "", name: "Any" }, ...active].map((p) => (
              <button
                key={p.id || "any"}
                type="button"
                aria-pressed={printerId === p.id}
                onClick={() => setPrinterId(p.id)}
                className={`min-h-11 min-w-16 rounded-lg border px-4 text-sm font-medium ${
                  printerId === p.id ? "border-indigo-600 bg-indigo-600 text-white" : "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-800"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </fieldset>
        <Field label="Print minutes" hint="Leave blank to use the catalog time.">
          <input type="number" inputMode="numeric" className={inputClass} value={printMinutes} onChange={(e) => setPrintMinutes(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" size="lg" disabled={isPending || !partId} className="w-full">
          {isPending ? "Adding…" : "Add — started now"}
        </Button>
      </form>
    </Modal>
  );
}
