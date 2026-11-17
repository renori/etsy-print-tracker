import { useState } from "react";
import { Link } from "react-router-dom";
import type { Order } from "../api/types";
import { fmtMoney } from "../lib/format";

const PIRATE_SHIP = "https://ship.pirateship.com/ship";

/**
 * For an order going abroad: Pirate Ship's Simple Export Rate for its packed
 * weight, the weight it was worked out from (tap to correct), and a link to
 * buy the label on Pirate Ship.
 */
export function ExportQuote({ order, onUpdate }: { order: Order; onUpdate: (data: Partial<Order>) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const country = order.shipCountry;
  if (!country || country === "US" || order.digital) return null;

  const q = order.exportQuote;
  const w = order.weight;
  const commit = () => {
    setEditing(false);
    const next = value.trim() === "" ? null : Number(value);
    if (next !== order.shipWeightOz && (next == null || (Number.isFinite(next) && next > 0))) onUpdate({ shipWeightOz: next });
  };

  return (
    <div className="mx-4 mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm dark:border-sky-900 dark:bg-sky-950/40">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <div className="font-medium text-sky-900 dark:text-sky-200">
            Simple Export to {country}:{" "}
            {q ? (
              <span className="tabular-nums">{fmtMoney(q.price)}</span>
            ) : (
              <span className="font-normal text-sky-800 dark:text-sky-300">
                {!w ? "need a weight" : "no price for this weight"}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-sky-800 dark:text-sky-300">
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  commit();
                }}
                className="inline-flex items-center gap-1"
              >
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  inputMode="decimal"
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onBlur={commit}
                  aria-label="Packed weight in ounces"
                  className="h-9 w-20 rounded-md border border-sky-300 bg-white px-2 tabular-nums dark:border-sky-800 dark:bg-neutral-900"
                />
                oz <span className="text-sky-700/70">(blank = work it out)</span>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setValue(order.shipWeightOz != null ? String(order.shipWeightOz) : w ? String(w.oz) : "");
                  setEditing(true);
                }}
                className="min-h-9 underline decoration-sky-300 underline-offset-2"
              >
                {w ? `${w.oz} oz` : "Set weight"}
                {w?.basis === "estimated" && " (estimated)"}
                {w?.basis === "typed" && " (typed)"}
              </button>
            )}
            {q && !editing && <span>· ≤{q.tierOz} oz tier · {q.zone === "canada" ? "Canada" : "rest of world"}</span>}
            {order.shippingPaid != null && !editing && <span>· buyer paid {fmtMoney(order.shippingPaid)}</span>}
          </div>
        </div>
        <a
          href={PIRATE_SHIP}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg bg-sky-700 px-3 text-sm font-medium text-white hover:bg-sky-800"
        >
          Buy on Pirate Ship ↗
        </a>
      </div>
      {w?.basis === "estimated" && !editing && (
        <p className="mt-1 text-xs text-sky-800/80 dark:text-sky-300/80">
          Weight uses filament grams for parts without a ship weight
          {w.box ? " and/or a box with no weight" : ""}. Add them in{" "}
          <Link to="/parts" className="underline">
            Parts
          </Link>{" "}
          and{" "}
          <Link to="/boxes" className="underline">
            Shipping Boxes
          </Link>
          , or weigh it and type it in.
        </p>
      )}
      {!q && w && (
        <p className="mt-1 text-xs text-sky-800/80 dark:text-sky-300/80">
          Paste your Simple Export prices on{" "}
          <Link to="/boxes" className="underline">
            Shipping Boxes
          </Link>{" "}
          to get a quote.
        </p>
      )}
    </div>
  );
}
