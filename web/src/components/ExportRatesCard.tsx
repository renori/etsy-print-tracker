import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { fmtMoney } from "../lib/format";
import { Button } from "./ui";

interface Rate {
  id: string;
  maxOz: number;
  canada: number | null;
  world: number | null;
}

const fmtWeight = (oz: number) => (oz >= 16 && oz % 16 === 0 ? `${oz / 16} lb` : `${oz} oz`);

/** Pirate Ship's Simple Export Rate price list, pasted in from Pirate Ship. */
export function ExportRatesCard() {
  const qc = useQueryClient();
  const { data: rates } = useQuery({ queryKey: ["export-rates"], queryFn: () => api.get<Rate[]>("/export-rates") });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const save = useMutation({
    mutationFn: (t: string) => api.put<{ rows: Rate[]; relabeled: number }>("/export-rates", { text: t }),
    onSuccess: () => {
      setEditing(false);
      for (const k of ["export-rates", "orders", "summary"]) qc.invalidateQueries({ queryKey: [k] });
    },
  });

  const start = () => {
    setText((rates ?? []).map((r) => `${r.maxOz} oz\t${r.canada ?? ""}\t${r.world ?? ""}`).join("\n"));
    setEditing(true);
  };

  return (
    <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Simple Export Rate prices</h2>
          <p className="mt-0.5 max-w-xl text-sm text-neutral-500">
            Pirate Ship's international rate (shipped via Asendia) depends only on weight and Canada vs. everywhere else. Paste its price list here
            and orders going abroad get a quote, which is also used as their label cost.
          </p>
        </div>
        {!editing && (
          <Button icon="edit" onClick={start}>
            {rates?.length ? "Edit prices" : "Paste prices"}
          </Button>
        )}
      </div>

      {editing ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(text);
          }}
        >
          <label className="block text-sm text-neutral-600 dark:text-neutral-400" htmlFor="export-rates">
            One weight tier per line: <b>weight</b>, <b>Canada price</b>, <b>rest-of-world price</b>. Columns copied from a table or spreadsheet work,
            and weights can be in oz or lb (e.g. <code>8 oz $9.50 $12.75</code> or <code>2 lb 18.40 24.10</code>). Each price covers up to and
            including that weight.
          </label>
          <textarea
            id="export-rates"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"4 oz\t$8.25\t$10.90\n8 oz\t$9.50\t$12.75\n1 lb\t$12.10\t$16.40"}
            className="w-full rounded-lg border border-neutral-300 bg-white p-3 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-800"
          />
          {save.error && <p className="text-sm text-red-700">{(save.error as Error).message}</p>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save prices"}
            </Button>
            <Button type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : rates?.length ? (
        <table className="mt-3 w-full max-w-md text-sm">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="py-1 font-medium">Up to</th>
              <th className="py-1 text-right font-medium">Canada</th>
              <th className="py-1 text-right font-medium">Rest of world</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="py-1.5">{fmtWeight(r.maxOz)}</td>
                <td className="py-1.5 text-right tabular-nums">{r.canada != null ? fmtMoney(r.canada) : "—"}</td>
                <td className="py-1.5 text-right tabular-nums">{r.world != null ? fmtMoney(r.world) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-3 text-sm text-neutral-500">No prices yet.</p>
      )}
      {save.data && !editing && (
        <p role="status" className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
          Saved {save.data.rows.length} tiers{save.data.relabeled ? ` · ${save.data.relabeled} order label cost${save.data.relabeled === 1 ? "" : "s"} updated` : ""}.
        </p>
      )}
    </section>
  );
}
