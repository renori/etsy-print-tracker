import { useState } from "react";
import { partsApi, useStock } from "../api/resources";

import { inputClass } from "../components/ui";
export function PrintedStock() {
  const { data, isLoading } = useStock();
  const { mutate: update } = partsApi.useUpdate();
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Printed Stock</h1>
      <p className="mb-4 text-sm text-neutral-500">On hand is what you count by hand — everything else is computed live.</p>

      {isLoading ? (
        <p className="text-neutral-400">Loading…</p>
      ) : (
        <>
        <ul className="space-y-2 md:hidden">
          {data?.map((row) => (
            <li key={row.part.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <div className="font-medium">{row.part.name}</div>
              <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs text-neutral-500">
                <label className="flex flex-col gap-1">
                  On hand
                  <input
                    type="number"
                    inputMode="numeric"
                    defaultValue={row.onHand}
                    key={row.onHand}
                    onBlur={(e) => Number(e.target.value) !== row.onHand && update({ id: row.part.id, data: { onHand: Number(e.target.value) } })}
                    className="min-h-10 w-full rounded border border-neutral-300 text-center text-base font-semibold text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                </label>
                <div className="flex flex-col gap-1">Needed<span className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{row.needed}</span></div>
                <div className="flex flex-col gap-1">Printing<span className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{row.printingNow}</span></div>
                <div className="flex flex-col gap-1">To print<span className={`text-base font-semibold ${row.stillToPrint > 0 ? "text-amber-700" : "text-neutral-400"}`}>{row.stillToPrint}</span></div>
              </div>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto rounded border border-neutral-200 md:block dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2">Part</th>
                <th className="px-3 py-2">On hand</th>
                <th className="px-3 py-2">Needed for unpacked orders</th>
                <th className="px-3 py-2">Printing now</th>
                <th className="px-3 py-2">Still to print</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((row) => (
                <tr key={row.part.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2">{row.part.name}</td>
                  <td className="px-3 py-2">
                    {editingId === row.part.id ? (
                      <input
                        type="number"
                        autoFocus
                        defaultValue={row.onHand}
                        className={`${inputClass} !w-20 text-center`}
                        onBlur={(e) => {
                          update({ id: row.part.id, data: { onHand: Number(e.target.value) } });
                          setEditingId(null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      />
                    ) : (
                      <button onClick={() => setEditingId(row.part.id)} className="rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        {row.onHand}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2">{row.needed}</td>
                  <td className="px-3 py-2">{row.printingNow}</td>
                  <td className={`px-3 py-2 font-medium ${row.stillToPrint > 0 ? "text-amber-600" : "text-neutral-400"}`}>{row.stillToPrint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
