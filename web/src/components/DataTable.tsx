import type { ReactNode } from "react";
import { Button, IconButton } from "./ui";

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
}

function cell<T>(c: Column<T>, row: T): ReactNode {
  return c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "");
}

function isBlank(v: ReactNode) {
  return v == null || v === "" || v === "—" || v === false;
}

/** A table on wider screens; a stack of cards on phones (first column is the card's title). */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  onEdit,
  onDelete,
}: {
  columns: Column<T>[];
  rows: T[];
  onEdit?: (row: T) => void;
  onDelete?: (row: T) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-neutral-300 px-3 py-10 text-center text-neutral-500 dark:border-neutral-700">Nothing here yet</p>
    );
  }

  const [titleCol, ...rest] = columns;

  return (
    <>
      <ul className="space-y-2.5 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="text-base font-semibold break-words">{cell(titleCol, row)}</div>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
              {rest.map((c) => {
                const v = cell(c, row);
                if (isBlank(v)) return null;
                return (
                  <div key={c.key} className="contents">
                    <dt className="text-neutral-500">{c.label || " "}</dt>
                    <dd className="break-words">{v}</dd>
                  </div>
                );
              })}
            </dl>
            {(onEdit || onDelete) && (
              <div className="mt-3 flex gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                {onEdit && (
                  <Button icon="edit" onClick={() => onEdit(row)} className="flex-1">
                    Edit
                  </Button>
                )}
                {onDelete && <IconButton icon="trash" label="Delete" variant="danger" onClick={() => onDelete(row)} />}
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm md:block dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 dark:bg-neutral-900">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="px-3 py-2.5 font-medium text-neutral-600 dark:text-neutral-400">
                  {c.label}
                </th>
              ))}
              {(onEdit || onDelete) && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/40">
                {columns.map((c) => (
                  <td key={c.key} className="px-3 py-2">
                    {cell(c, row)}
                  </td>
                ))}
                {(onEdit || onDelete) && (
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    <div className="inline-flex gap-1.5">
                      {onEdit && (
                        <Button size="sm" icon="edit" onClick={() => onEdit(row)}>
                          Edit
                        </Button>
                      )}
                      {onDelete && <IconButton icon="trash" label="Delete" variant="danger" onClick={() => onDelete(row)} className="!h-9 !w-9" />}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
