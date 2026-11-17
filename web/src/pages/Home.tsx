import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { partsApi, printersApi, useEtsySyncNow, useFinishPlate, useSummary, type Summary } from "../api/resources";
import { Button, Card, Icon, btn, type IconName } from "../components/ui";
import { LogPrintModal } from "./Dashboard";
import { fmtDate, fmtDateTime } from "../lib/format";

const money = (n: number) =>
  Math.abs(n) >= 10_000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

function timeLeft(min: number) {
  if (min <= 0) return "Finished";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m left` : `${m}m left`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Section({ title, link, children }: { title: string; link?: { to: string; label: string }; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {link && (
          <Link to={link.to} className={btn("ghost", "sm", "-mr-2 text-indigo-700 dark:text-indigo-400")}>
            {link.label}
            <Icon name="chevron" className="h-4 w-4" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** Stat tile: label · value · optional delta vs a named period (arrow + words, never color alone). */
function Stat({ label, value, delta, upIsGood = true, to }: { label: string; value: string; delta?: { now: number; before: number; period: string }; upIsGood?: boolean; to?: string }) {
  let deltaEl: ReactNode = null;
  if (delta && (delta.now !== 0 || delta.before !== 0)) {
    const diff = delta.now - delta.before;
    const up = diff > 0;
    const good = diff === 0 ? null : up === upIsGood;
    deltaEl = (
      <div className={`mt-1 text-xs font-medium ${good == null ? "text-neutral-500" : good ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
        {diff === 0 ? "Same as" : `${up ? "▲" : "▼"} ${money(Math.abs(diff))} vs`} {delta.period}
      </div>
    );
  }
  const body = (
    <>
      <div className="text-xs font-medium text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {deltaEl}
    </>
  );
  const cls = "block rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900";
  return to ? (
    <Link to={to} className={`${cls} hover:border-indigo-300 active:bg-neutral-50 dark:active:bg-neutral-800`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

interface Alert {
  tone: "critical" | "warning" | "info";
  icon: IconName;
  title: string;
  detail: string;
  to: string;
}

const TONE = {
  critical: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
  warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  info: "border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200",
};

function alertsFrom(s: Summary): Alert[] {
  const out: Alert[] = [];
  const overdue = s.orders.shipSoon.filter((o) => o.urgency === "overdue");
  const today = s.orders.shipSoon.filter((o) => o.urgency === "today");
  if (overdue.length) out.push({ tone: "critical", icon: "alert", title: `${overdue.length} order${overdue.length > 1 ? "s" : ""} past ship-by`, detail: overdue.map((o) => o.buyerName).join(", "), to: "/orders" });
  if (today.length) out.push({ tone: "warning", icon: "clock", title: `${today.length} order${today.length > 1 ? "s" : ""} must ship today`, detail: today.map((o) => o.buyerName).join(", "), to: "/orders" });
  for (const b of s.stock.boxAlerts) {
    out.push({
      tone: b.short ? "critical" : "warning",
      icon: "box",
      title: b.short ? `Short on ${b.name} boxes` : `${b.name} boxes running low`,
      detail: b.short ? `${b.need} needed for unpacked orders, ${b.onHand} on hand` : `${b.onHand} left (reorder at ${b.reorderAt})`,
      to: "/boxes",
    });
  }
  if (s.orders.unlinked)
    out.push({
      tone: "warning",
      icon: "alert",
      title: `${s.orders.unlinked} order${s.orders.unlinked > 1 ? "s" : ""} not linked to stock`,
      detail: "A listing or variation isn't in the Listing Map",
      to: "/listing-map",
    });
  const finished = s.printers.printing.filter((p) => p.minutesLeft <= 0);
  if (finished.length) out.push({ tone: "info", icon: "printer", title: `${finished.length} plate${finished.length > 1 ? "s" : ""} ready to take off`, detail: finished.map((p) => p.printer ?? "Printer").join(", "), to: "/queue" });
  if (s.orders.replacementsOpen) out.push({ tone: "info", icon: "refresh", title: `${s.orders.replacementsOpen} replacement${s.orders.replacementsOpen > 1 ? "s" : ""} to send`, detail: "Not shipped yet", to: "/replacements" });
  return out;
}

export function Home() {
  const { data: s, isLoading, error } = useSummary();
  const { mutate: finish, isPending: finishing } = useFinishPlate();
  const { data: parts } = partsApi.useList();
  const { data: printers } = printersApi.useList();
  const [logging, setLogging] = useState(false);
  const sync = useEtsySyncNow();
  const monthName = new Date().toLocaleDateString(undefined, { month: "long" });

  if (isLoading) return <p className="py-16 text-center text-neutral-500">Loading…</p>;
  if (error || !s) return <p className="py-16 text-center text-red-700">Couldn't load the dashboard: {(error as Error)?.message}</p>;

  const alerts = alertsFrom(s);

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{greeting()}</h1>
        <p className="text-sm text-neutral-500">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
      </div>

      {/* Quick actions */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        <Button variant="primary" icon="printer" onClick={() => setLogging(true)} className="shrink-0">
          Log a print
        </Button>
        <Link to="/expenses?receipt=1" className={btn("secondary", "md", "shrink-0")}>
          <Icon name="receipt" className="h-4.5 w-4.5" />
          Add receipt
        </Link>
        <Link to="/mileage?add=1" className={btn("secondary", "md", "shrink-0")}>
          <Icon name="car" className="h-4.5 w-4.5" />
          Log a trip
        </Link>
        <Link to="/orders" className={btn("secondary", "md", "shrink-0")}>
          <Icon name="box" className="h-4.5 w-4.5" />
          Pack orders
        </Link>
        {s.etsy.connected && (
          <Button icon="refresh" onClick={() => sync.mutate()} disabled={sync.isPending} className="shrink-0">
            {sync.isPending ? "Syncing…" : "Sync Etsy"}
          </Button>
        )}
      </div>
      {(sync.data || sync.error) && (
        <p role="status" className={`-mt-4 text-sm ${sync.error ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
          {sync.error ? `Sync failed: ${(sync.error as Error).message}` : sync.data!.message}
        </p>
      )}

      {/* Needs attention */}
      {alerts.length > 0 ? (
        <Section title="Needs attention">
          <div className="grid gap-2 md:grid-cols-2">
            {alerts.map((a, i) => (
              <Link key={i} to={a.to} className={`flex min-h-14 items-center gap-3 rounded-xl border p-3 ${TONE[a.tone]}`}>
                <Icon name={a.icon} className="h-5 w-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{a.title}</div>
                  <div className="truncate text-sm opacity-80">{a.detail}</div>
                </div>
                <Icon name="chevron" className="h-4 w-4 shrink-0 opacity-60" />
              </Link>
            ))}
          </div>
        </Section>
      ) : (
        <Card className="flex items-center gap-3 border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <Icon name="check" className="h-5 w-5" />
          <span className="font-medium">All caught up — nothing urgent.</span>
        </Card>
      )}

      {/* Printers */}
      <Section title="Printers" link={{ to: "/queue", label: "Queue" }}>
        <div className="grid gap-2.5 md:grid-cols-2">
          {s.printers.printing.map((p) => {
            const done = p.minutesLeft <= 0;
            return (
              <Card key={p.id} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">{p.printer ?? "Printer"}</div>
                    <div className="font-medium">{p.label}</div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${done ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" : "bg-indigo-50 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"}`}
                  >
                    {timeLeft(p.minutesLeft)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm text-neutral-500">
                  <span>{done ? "Done printing" : `Done ${fmtDateTime(p.finishAt)}`}</span>
                  {done && (
                    <Button variant="success" size="sm" icon="check" disabled={finishing} onClick={() => finish(p.id)}>
                      Mark done
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
          {s.printers.printing.length === 0 && (
            <Card className="text-sm text-neutral-600 dark:text-neutral-400">Nothing printing right now.</Card>
          )}
        </div>
        {s.printers.upNext.length > 0 && (
          <Card className="divide-y divide-neutral-100 !p-0 dark:divide-neutral-800">
            <div className="px-4 py-2.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              Up next · {(s.printers.queuedMinutes / 60).toFixed(1)} h queued
            </div>
            {s.printers.upNext.map((q) => (
              <div key={q.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">{q.label}</span>
                <span className="shrink-0 text-neutral-500">
                  {q.printer ?? "Any"} · {fmtDateTime(q.startAt)}
                </span>
              </div>
            ))}
          </Card>
        )}
      </Section>

      {/* Orders */}
      <Section title="Orders" link={{ to: "/orders", label: "All orders" }}>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <Stat label="Open orders" value={String(s.orders.open)} to="/orders" />
          <Stat label="Need printing" value={String(s.orders.needsPrinting)} to="/queue" />
          <Stat label="Ready to pack" value={String(s.orders.readyToPack)} to="/orders" />
          <Stat label="Ready to drop off" value={String(s.orders.handled)} to="/orders" />
        </div>
        {s.orders.shipSoon.length > 0 && (
          <Card className="divide-y divide-neutral-100 !p-0 dark:divide-neutral-800">
            <div className="px-4 py-2.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase">Ship-by soon</div>
            {s.orders.shipSoon.map((o) => (
              <Link key={o.id} to="/orders" className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 text-sm active:bg-neutral-50 dark:active:bg-neutral-800">
                <span className="min-w-0 truncate font-medium">{o.buyerName}</span>
                <span className="flex shrink-0 items-center gap-2 text-neutral-500">
                  {o.ready && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">Ready</span>}
                  <span className={o.urgency === "overdue" ? "font-semibold text-red-700 dark:text-red-400" : o.urgency === "today" ? "font-semibold text-amber-700 dark:text-amber-400" : ""}>
                    {o.urgency === "overdue" ? "Overdue · " : o.urgency === "today" ? "Today · " : o.urgency === "tomorrow" ? "Tomorrow · " : ""}
                    {fmtDate(o.dueAt)}
                  </span>
                </span>
              </Link>
            ))}
          </Card>
        )}
      </Section>

      {/* Stock */}
      {s.stock.toPrint.length > 0 && (
        <Section title="Still to print" link={{ to: "/stock", label: "Stock" }}>
          <Card className="divide-y divide-neutral-100 !p-0 dark:divide-neutral-800">
            {s.stock.toPrint.map((p) => (
              <div key={p.name} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">{p.name}</span>
                <span className="shrink-0 font-semibold tabular-nums">{p.count}</span>
              </div>
            ))}
          </Card>
        </Section>
      )}

      {/* Money */}
      <Section title={`Money · ${monthName}`} link={{ to: "/completed", label: "Sales" }}>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <Stat label="Sales (Etsy gross)" value={money(s.money.thisMonth.gross)} delta={{ now: s.money.thisMonth.gross, before: s.money.lastMonth.gross, period: "last month" }} to="/completed" />
          <Stat label="Net profit" value={money(s.money.thisMonth.net)} delta={{ now: s.money.thisMonth.net, before: s.money.lastMonth.net, period: "last month" }} to="/completed" />
          <Stat label="Expenses" value={money(s.money.thisMonth.expenses)} delta={{ now: s.money.thisMonth.expenses, before: s.money.lastMonth.expenses, period: "last month" }} upIsGood={false} to="/expenses" />
          <Stat label="Orders shipped" value={String(s.money.thisMonth.count)} to="/completed" />
        </div>
        <Card>
          <div className="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">{new Date().getFullYear()} so far</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
            <div>
              <dt className="text-neutral-500">Net profit</dt>
              <dd className="text-lg font-semibold tabular-nums">{money(s.money.yearToDate.net)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Sales</dt>
              <dd className="text-lg font-semibold tabular-nums">{money(s.money.yearToDate.gross)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Expenses</dt>
              <dd className="text-lg font-semibold tabular-nums">{money(s.money.yearToDate.expenses)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Mileage deduction</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {money(s.money.yearToDate.mileageDeduction)} <span className="text-sm font-normal text-neutral-500">· {Math.round(s.money.yearToDate.miles)} mi</span>
              </dd>
            </div>
          </dl>
        </Card>
      </Section>

      {/* Recent */}
      {s.recentShipped.length > 0 && (
        <Section title="Recently shipped" link={{ to: "/completed", label: "All" }}>
          <Card className="divide-y divide-neutral-100 !p-0 dark:divide-neutral-800">
            {s.recentShipped.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{o.buyerName}</div>
                  <div className="truncate text-xs text-neutral-500">{o.items.split("\n")[0]}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold tabular-nums">{o.net != null ? money(o.net) : "—"}</div>
                  <div className="text-xs text-neutral-500">{fmtDate(o.shippedAt)}</div>
                </div>
              </div>
            ))}
          </Card>
        </Section>
      )}

      <p className="pb-2 text-center text-xs text-neutral-500">
        Etsy {s.etsy.connected ? `connected${s.etsy.lastLedgerAt ? ` · last activity ${fmtDateTime(s.etsy.lastLedgerAt)}` : ""}` : "not connected"}
        {!s.etsy.connected && (
          <>
            {" · "}
            <Link to="/etsy" className="underline">
              connect
            </Link>
          </>
        )}
      </p>

      {logging && <LogPrintModal parts={(parts ?? []).filter((p) => p.active)} printers={printers ?? []} onClose={() => setLogging(false)} />}
    </div>
  );
}
