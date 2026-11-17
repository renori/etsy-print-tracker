import { useEtsyStatus, useEtsySyncNow } from "../api/resources";

import { btn } from "../components/ui";
export function EtsyConnection() {
  const { data, isLoading } = useEtsyStatus();
  const { mutate: syncNow, isPending, data: syncResult, error } = useEtsySyncNow();

  return (
    <div className="max-w-lg">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Etsy Connection</h1>

      {isLoading ? (
        <p className="text-neutral-400">Checking…</p>
      ) : data?.connected ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/30">
          <p className="font-medium text-emerald-700 dark:text-emerald-300">Connected</p>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            New orders, bought labels (tracking) and ledger entries sync automatically every 15 minutes.
          </p>
          <button
            onClick={() => syncNow()}
            disabled={isPending}
            className="mt-3 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isPending ? "Syncing…" : "Sync now"}
          </button>
          {syncResult != null && <p role="status" className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">{syncResult.message}</p>}
          {error && <p className="mt-2 text-sm text-red-600">{(error as Error).message}</p>}
        </div>
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="font-medium text-amber-700 dark:text-amber-300">Not connected</p>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Set <code>ETSY_API_KEYSTRING</code>, <code>ETSY_SHOP_ID</code> and <code>ETSY_REDIRECT_URI</code> in the server's
            environment, then connect your shop.
          </p>
          <a href="/api/etsy/connect" className={btn("primary", "md", "mt-3")}>
            Connect Etsy Shop
          </a>
        </div>
      )}
    </div>
  );
}
