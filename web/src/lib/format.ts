export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const otherYear = d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(otherYear ? { year: "numeric" } : {}) });
}

export function fmtMoney(n?: number | null): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

export function fmtHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)} h`;
}
