import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { makeResourceHooks } from "./hooks";
import type {
  BlackoutWindow,
  Box,
  Expense,
  EtsyLedgerEntry,
  ListingMapping,
  MileageEntry,
  Order,
  Part,
  PlateRecipe,
  Printer,
  QueueEntry,
  Replacement,
  ScheduleSettings,
  StockRow,
} from "./types";

export const partsApi = makeResourceHooks<Part>("parts", "/parts");
export const printersApi = makeResourceHooks<Printer>("printers", "/printers");
export const plateRecipesApi = makeResourceHooks<PlateRecipe>("plate-recipes", "/plate-recipes");
export const blackoutApi = makeResourceHooks<BlackoutWindow>("blackout-windows", "/blackout-windows");
export const listingMappingsApi = makeResourceHooks<ListingMapping>("listing-mappings", "/listing-mappings");
export const ordersApi = makeResourceHooks<Order>("orders", "/orders");
export const replacementsApi = makeResourceHooks<Replacement>("replacements", "/replacements");
export const expensesApi = makeResourceHooks<Expense>("expenses", "/expenses");
export const mileageApi = makeResourceHooks<MileageEntry>("mileage", "/mileage");
export const boxesApi = makeResourceHooks<Box>("boxes", "/boxes");
export const ledgerApi =makeResourceHooks<EtsyLedgerEntry>("ledger", "/ledger");

export function useOrdersOpenCount() {
  const { data } = ordersApi.useList();
  return (data ?? []).filter((o) => o.status !== "SHIPPED").length;
}

export function useStock() {
  return useQuery({ queryKey: ["parts", "stock"], queryFn: () => api.get<StockRow[]>("/parts/stock") });
}

export function useQueue() {
  return useQuery({ queryKey: ["queue"], queryFn: () => api.get<QueueEntry[]>("/queue"), refetchInterval: 30_000 });
}

export function useRebuildQueue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<QueueEntry[]>("/queue/rebuild"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["parts", "stock"] });
    },
  });
}

export function useStartPlate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<QueueEntry[]>(`/queue/${id}/start`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["parts", "stock"] });
    },
  });
}

export function useFinishPlate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<QueueEntry[]>(`/queue/${id}/done`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["parts", "stock"] });
      qc.invalidateQueries({ queryKey: ["parts"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function useLogPrint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { printerId?: string | null; printMinutes?: number; forOrders?: string; parts: { partId: string; quantity: number }[] }) =>
      api.post<QueueEntry[]>("/queue/log-print", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["parts", "stock"] });
    },
  });
}

export function useScheduleSettings() {
  return useQuery({ queryKey: ["schedule-settings"], queryFn: () => api.get<ScheduleSettings>("/schedule-settings") });
}

export function useUpdateScheduleSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ScheduleSettings) => api.put<ScheduleSettings>("/schedule-settings", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule-settings"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });
}

export function useShipReplacement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, labelCost }: { id: string; labelCost?: number }) =>
      api.post<Replacement>(`/replacements/${id}/ship`, { labelCost }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["replacements"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });
}

export function useEtsyStatus() {
  return useQuery({ queryKey: ["etsy-status"], queryFn: () => api.get<{ connected: boolean }>("/etsy/status") });
}

export interface SyncResult {
  receipts: { fetched: number };
  openOrders: { checked: number; labelsFound: number; autoCompleted: number; canceled: number; relinked: number };
  shippedOnEtsy: { added: number };
  digital?: number;
  ledger: { fetched: number };
  financials: { filled: number; labelsEstimated: number; shipInfoFilled?: number };
}

/** One line for the user: what the sync changed. */
export function describeSync(r: SyncResult, newOrders: number): string {
  const parts = [
    newOrders && `${newOrders} new order${newOrders === 1 ? "" : "s"}`,
    r.openOrders.labelsFound && `${r.openOrders.labelsFound} label${r.openOrders.labelsFound === 1 ? "" : "s"} bought`,
    r.openOrders.autoCompleted + r.shippedOnEtsy.added &&
      `${r.openOrders.autoCompleted + r.shippedOnEtsy.added} completed on Etsy`,
    r.openOrders.canceled && `${r.openOrders.canceled} canceled`,
    r.digital && `${r.digital} digital download${r.digital === 1 ? "" : "s"} (no label)`,
    r.financials.filled && `profit filled for ${r.financials.filled}`,
    r.financials.labelsEstimated && `${r.financials.labelsEstimated} label estimate${r.financials.labelsEstimated === 1 ? "" : "s"} updated`,
  ].filter(Boolean);
  return parts.length ? `Synced · ${parts.join(" · ")}` : "Synced · nothing new";
}

export function useEtsySyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const before = (await api.get<{ id: string }[]>("/orders")).length;
      const result = await api.post<SyncResult>("/etsy/sync-now");
      const after = (await api.get<{ id: string }[]>("/orders")).length;
      // Orders added by the sync, minus ones it removed as canceled, minus ones it added already shipped.
      const newOrders = Math.max(0, after - before + result.openOrders.canceled - result.shippedOnEtsy.added);
      return { result, message: describeSync(result, newOrders) };
    },
    onSuccess: () => {
      for (const k of ["orders", "ledger", "queue", "parts", "boxes", "summary", "listing-mappings"]) qc.invalidateQueries({ queryKey: [k] });
    },
  });
}

export interface Summary {
  generatedAt: string;
  printers: {
    printing: { id: string; label: string; printer: string | null; finishAt: string; minutesLeft: number }[];
    upNext: { id: string; label: string; printer: string | null; startAt: string; minutes: number }[];
    queuedMinutes: number;
  };
  orders: {
    open: number;
    needsPrinting: number;
    readyToPack: number;
    packed: number;
    handled: number;
    replacementsOpen: number;
    unlinked: number;
    shipSoon: { id: string; etsyOrderId: string; buyerName: string; dueAt: string; urgency: "overdue" | "today" | "tomorrow" | "soon"; ready: boolean }[];
  };
  stock: {
    toPrint: { name: string; count: number }[];
    boxAlerts: { name: string; onHand: number; need: number; reorderAt: number | null; short: boolean; low: boolean }[];
  };
  money: Record<"thisMonth" | "lastMonth", { count: number; gross: number; net: number; expenses: number }> & {
    yearToDate: { count: number; gross: number; net: number; expenses: number; miles: number; mileageDeduction: number };
  };
  recentShipped: { id: string; etsyOrderId: string; buyerName: string; shippedAt: string; net: number | null; items: string }[];
  etsy: { connected: boolean; lastLedgerAt: string | null };
}

export function useSummary() {
  return useQuery({ queryKey: ["summary"], queryFn: () => api.get<Summary>("/summary"), refetchInterval: 60_000 });
}

export function usePackOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, packed }: { ids: string[]; packed: boolean }) => api.post<{ changed: number; skipped: number }>("/orders/pack", { ids, packed }),
    onSuccess: () => {
      for (const key of ["orders", "boxes", "parts", "queue"]) qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export function useShipOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.post<{ shipped: number }>("/orders/ship", { ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["replacements"] }); // a linked replacement ships with its order
    },
  });
}
