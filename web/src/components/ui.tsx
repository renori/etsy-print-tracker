import type { ButtonHTMLAttributes, ReactNode, SVGProps } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 shadow-sm",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-sm",
  secondary:
    "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 active:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800",
  danger:
    "border border-red-200 bg-white text-red-700 hover:bg-red-50 active:bg-red-100 dark:border-red-900 dark:bg-neutral-900 dark:text-red-400 dark:hover:bg-red-950",
  ghost: "text-neutral-600 hover:bg-neutral-100 active:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800",
};

// Every size keeps a 44px touch target on phones; desktop gets a slightly tighter "sm".
const SIZES: Record<Size, string> = {
  sm: "min-h-11 md:min-h-9 px-3 text-sm gap-1.5",
  md: "min-h-11 px-4 text-sm gap-2",
  lg: "min-h-12 px-5 text-base gap-2",
};

export function btn(variant: Variant = "secondary", size: Size = "md", extra = "") {
  return `inline-flex items-center justify-center rounded-lg font-medium transition-colors select-none disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: IconName }) {
  return (
    <button type="button" className={btn(variant, size, className)} {...rest}>
      {icon && <Icon name={icon} className="h-4.5 w-4.5 shrink-0" />}
      {children}
    </button>
  );
}

/** Square icon-only button; `label` is required for screen readers. */
export function IconButton({
  icon,
  label,
  variant = "ghost",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; variant?: Variant }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-indigo-500 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      <Icon name={icon} className="h-5 w-5" />
    </button>
  );
}

const PATHS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  printer: "M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z",
  orders: "M9 5h10M9 12h10M9 19h10M4.5 5h.01M4.5 12h.01M4.5 19h.01",
  box: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  stock: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  menu: "M4 6h16M4 12h16M4 18h16",
  x: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  play: "M7 4v16l13-8z",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  check: "M5 12.5 10 17l9-10",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  car: "M5 16h14M6 16l1.5-6h9L18 16M6 16v3M18 16v3M7.5 13h.01M16.5 13h.01",
  dollar: "M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  chevron: "M9 6l6 6-6 6",
  chevronLeft: "M15 6l-6 6 6 6",
  refresh: "M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 ${className}`}>{children}</div>;
}

/** Page title row: title + optional subtitle, actions wrap below on phones. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Checkbox with a full-height tap area. */
export function Check({ checked, onChange, label, className = "" }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; className?: string }) {
  return (
    <label className={`inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1 text-sm font-medium select-none ${className}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-indigo-600" />
      {label}
    </label>
  );
}

export const inputClass =
  "w-full min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-base md:min-h-10 md:text-sm dark:border-neutral-700 dark:bg-neutral-800 focus:outline-2 focus:outline-indigo-500";

/** A labeled form control; the label wraps the control so tapping the text focuses it. */
export function Field({ label, hint, children, className = "" }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

/** − value + with big tap targets; easier than a number keyboard for small counts. */
export function Stepper({ value, onChange, min = 0, label }: { value: number; onChange: (v: number) => void; min?: number; label: string }) {
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label={label}>
      <IconButton icon="minus" label={`Less ${label.toLowerCase()}`} variant="secondary" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} />
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        value={value}
        min={min}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
        className="h-11 w-16 rounded-lg border border-neutral-300 bg-white text-center text-base font-semibold tabular-nums dark:border-neutral-700 dark:bg-neutral-800"
      />
      <IconButton icon="plus" label={`More ${label.toLowerCase()}`} variant="secondary" onClick={() => onChange(value + 1)} />
    </div>
  );
}

/** File input whose "Choose file" part is a full-size button. */
export const fileInputClass =
  "block w-full text-sm text-neutral-600 file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border-0 file:bg-indigo-50 file:px-4 file:text-sm file:font-semibold file:text-indigo-700 hover:file:bg-indigo-100 dark:text-neutral-400 dark:file:bg-indigo-950 dark:file:text-indigo-200";

/**
 * An order number that opens the order in Etsy's Shop Manager (new tab).
 * Manual / replacement orders aren't on Etsy, so they stay plain text.
 */
export function EtsyOrderLink({ id, hash = true, className = "" }: { id: string; hash?: boolean; className?: string }) {
  const text = `${hash ? "#" : ""}${id}`;
  if (!/^\d+$/.test(id)) return <span className={className}>{text}</span>;
  return (
    <a
      href={`https://www.etsy.com/your/orders/sold?order_id=${id}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="Open this order on Etsy"
      className={`inline-flex min-h-6 items-center gap-0.5 text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:decoration-indigo-600 dark:text-indigo-400 dark:decoration-indigo-700 ${className}`}
    >
      {text}
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M6 3H3v10h10v-3M9 2h5v5M14 2 7 9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}
