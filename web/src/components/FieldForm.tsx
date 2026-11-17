import { useId, useState } from "react";
import { inputClass as baseInput } from "./ui";

export interface Suggestion {
  value: string;
  /** Other fields to fill in when this value is picked — only fields that are still empty. */
  fills?: Record<string, unknown>;
  /** Shown after the value on the chip, e.g. "6 mi". */
  hint?: string;
}

export interface FieldConfig {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean" | "select";
  options?: { label: string; value: string }[];
  required?: boolean;
  /** Used when creating (no `initial` value for this field yet). */
  defaultValue?: unknown;
  /** Previously used values, most relevant first. Offered as autocomplete and as one-tap chips. */
  suggestions?: Suggestion[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar date as the user sees it, "YYYY-MM-DD". */
export function localDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * "YYYY-MM-DD" → ISO at local noon. A bare date string is parsed as UTC
 * midnight, which is the previous evening in US timezones; noon can't
 * slip to another day.
 */
function dateInputToIso(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}

function toInputValue(type: FieldConfig["type"], v: unknown): string | boolean {
  if (type === "boolean") return !!v;
  if (type === "date") {
    if (!v) return "";
    const s = String(v);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : localDateInput(new Date(s));
  }
  return v == null ? "" : String(v);
}

const inputClass = baseInput;

export function FieldForm({
  fields,
  initial,
  onSubmit,
  submitLabel = "Save",
}: {
  fields: FieldConfig[];
  initial?: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => void;
  submitLabel?: string;
}) {
  const formId = useId();
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = initial ? initial[f.key] : f.defaultValue;
      v[f.key] = toInputValue(f.type, raw);
    }
    return v;
  });

  function set(key: string, val: unknown) {
    setValues((prev) => {
      const next = { ...prev, [key]: val };
      const match = fields.find((f) => f.key === key)?.suggestions?.find((s) => s.value === val);
      for (const [k, fill] of Object.entries(match?.fills ?? {})) {
        if (next[k] === "" || next[k] == null) {
          const target = fields.find((f) => f.key === k);
          next[k] = target ? toInputValue(target.type, fill) : fill;
        }
      }
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = values[f.key];
      if (f.type === "number") out[f.key] = raw === "" ? null : Number(raw);
      else if (f.type === "boolean") out[f.key] = !!raw;
      else if (f.type === "date") out[f.key] = raw === "" ? null : dateInputToIso(raw as string);
      else out[f.key] = raw === "" ? null : raw;
    }
    onSubmit(out);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {fields.map((f) => {
        const id = `${formId}-${f.key}`;
        const listId = f.suggestions?.length ? `${id}-list` : undefined;
        return (
          <div key={f.key}>
            <label htmlFor={id} className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {f.label}
            </label>
            {f.type === "boolean" ? (
              <span className="flex min-h-11 items-center">
                <input id={id} type="checkbox" checked={!!values[f.key]} onChange={(e) => set(f.key, e.target.checked)} />
              </span>
            ) : f.type === "select" ? (
              <select id={id} className={inputClass} value={values[f.key] as string} onChange={(e) => set(f.key, e.target.value)} required={f.required}>
                <option value="" />
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                step={f.type === "number" ? "any" : undefined}
                inputMode={f.type === "number" ? "decimal" : undefined}
                list={listId}
                autoComplete="off"
                className={inputClass}
                value={values[f.key] as string}
                onChange={(e) => set(f.key, e.target.value)}
                required={f.required}
              />
            )}
            {listId && (
              <>
                <datalist id={listId}>
                  {f.suggestions!.map((s) => (
                    <option key={s.value} value={s.value} />
                  ))}
                </datalist>
                <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Recent ${f.label.toLowerCase()}`}>
                  {f.suggestions!.slice(0, 6).map((s) => {
                    const on = values[f.key] === s.value;
                    return (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => set(f.key, s.value)}
                        aria-pressed={on}
                        className={`min-h-10 rounded-full border px-3.5 text-sm ${
                          on
                            ? "border-indigo-600 bg-indigo-600 text-white"
                            : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                        }`}
                      >
                        {s.value}
                        {s.hint && <span className={on ? "ml-1 text-indigo-100" : "ml-1 text-neutral-500"}>· {s.hint}</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })}
      <div className="sticky bottom-0 -mx-4 bg-white/95 px-4 pt-2 pb-1 backdrop-blur md:static md:mx-0 md:bg-transparent md:p-0 dark:bg-neutral-900/95">
        <button type="submit" className="min-h-12 w-full rounded-lg bg-indigo-600 px-4 font-semibold text-white shadow-sm hover:bg-indigo-700 active:bg-indigo-800">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
