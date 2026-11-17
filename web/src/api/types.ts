export interface Part {
  id: string;
  name: string;
  description?: string | null;
  printMinutes: number;
  filamentGrams: number;
  filamentPricePerKg: number;
  filamentCost: number;
  electricityCost: number;
  depreciation: number;
  shippingBoxCost: number;
  bagCost: number;
  wrappingCost: number;
  hardwareCost: number;
  laborCost: number;
  touchTimeMinutes: number;
  cost: number;
  listPrice?: number | null;
  margin?: number | null;
  packageType?: string | null;
  /** One finished unit as shipped, in ounces. */
  shipWeightOz?: number | null;
  onHand: number;
  active: boolean;
}

export interface StockRow {
  part: Part;
  onHand: number;
  needed: number;
  printingNow: number;
  stillToPrint: number;
}

export interface Printer {
  id: string;
  name: string;
  active: boolean;
  notes?: string | null;
}

export interface PlateRecipePart {
  partId: string;
  maxCount: number;
  part?: Part;
}

export interface PlateRecipe {
  id: string;
  name?: string | null;
  printerId?: string | null;
  printer?: Printer | null;
  plateMinutes?: number | null;
  notes?: string | null;
  parts: PlateRecipePart[];
}

export interface BlackoutWindow {
  id: string;
  daysPattern: string;
  fromTime?: string | null;
  toTime?: string | null;
  note?: string | null;
}

export interface ScheduleSettings {
  morningStart: string;
  morningWindowMinutes: number;
  homeTime: string;
  lastStart: string;
  changeoverMinutes: number;
  homeOnWeekends: boolean;
  weekendStart: string;
  postOfficeDays: string;
  postOfficeTime: string;
  shipWithinDays: number;
}

export interface QueuePart {
  partId: string;
  quantity: number;
  part?: Part;
}

export interface QueueEntry {
  id: string;
  printerId?: string | null;
  printer?: Printer | null;
  label: string;
  plannedStart: string;
  plannedFinish: string;
  printMinutes: number;
  forOrders?: string | null;
  started: boolean;
  startedAt?: string | null;
  done: boolean;
  doneAt?: string | null;
  manualEntry: boolean;
  parts: QueuePart[];
}

export type OrderStatus = "NEEDS_PRINTING" | "PRINTING" | "READY_FROM_STOCK" | "READY_LABEL_BOUGHT" | "PACKED" | "SHIPPED";

export interface OrderPart {
  partId: string;
  quantity: number;
  part?: Part;
}

export interface Order {
  id: string;
  etsyOrderId: string;
  buyerName: string;
  orderedAt: string;
  shipTarget?: string | null;
  etsyShipBy?: string | null;
  itemsRaw: string;
  status: OrderStatus;
  readyBy?: string | null;
  packed: boolean;
  labelBought: boolean;
  labelBoughtAt?: string | null;
  packageType?: string | null;
  /** All items are digital downloads: no label, nothing to pack. */
  digital?: boolean;
  shippedAt?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  orderTotal?: number | null;
  etsyGross?: number | null;
  salesTax?: number | null;
  etsyFees?: number | null;
  etsyEarnings?: number | null;
  labelCost?: number | null;
  /** "etsy" | "batch" | "estimate" | "quote" | "manual" | "digital" | null (imported) */
  labelCostSource?: string | null;
  /** How an estimate was worked out. */
  labelCostNote?: string | null;
  /** Destination country (ISO code); "" = unknown. */
  shipCountry?: string | null;
  /** Shipping the buyer paid on Etsy. */
  shippingPaid?: number | null;
  /** Packed weight typed in on the order (oz). */
  shipWeightOz?: number | null;
  /** Packed weight the server worked out (or the typed one). */
  weight?: { oz: number; basis: "typed" | "parts" | "estimated"; box: string | null } | null;
  /** Pirate Ship Simple Export Rate for orders going abroad. */
  exportQuote?: { price: number; zone: "canada" | "world"; tierOz: number } | null;
  productionCost?: number | null;
  laborMinutes?: number | null;
  netProfit?: number | null;
  margin?: number | null;
  parts: OrderPart[];
  /** Resolved by the server: the order's package, else the biggest one its parts need. */
  boxName?: string | null;
}

export interface Box {
  id: string;
  name: string;
  onHand: number;
  reorderAt?: number | null;
  costEach?: number | null;
  /** Empty box weight (oz). */
  weightOz?: number | null;
  notes?: string | null;
}

export interface ListingMappingPart {
  partId: string;
  quantity: number;
  part?: Part;
}

export interface ListingMapping {
  id: string;
  etsyListingId: string;
  listingTitle: string;
  variationContains?: string | null;
  notes?: string | null;
  autoGuessed: boolean;
  parts: ListingMappingPart[];
}

export interface Replacement {
  id: string;
  code: string;
  originalOrderId?: string | null;
  buyerName: string;
  requestedAt: string;
  shipByTarget?: string | null;
  notes?: string | null;
  shipped: boolean;
  shippedAt?: string | null;
  labelCost?: number | null;
  cogsLoggedAt?: string | null;
  labelLoggedAt?: string | null;
  parts: ListingMappingPart[];
}

export interface Expense {
  id: string;
  date: string;
  item: string;
  vendor?: string | null;
  category?: string | null;
  cost: number;
  taxYear: number;
  scheduleCLine?: string | null;
  deductible: boolean;
  paidWith?: string | null;
  invoiceRef?: string | null;
  notes?: string | null;
}

export interface MileageEntry {
  id: string;
  date: string;
  destination: string;
  purpose?: string | null;
  miles: number;
  ratePerMile: number;
}

export interface EtsyLedgerEntry {
  id: string;
  etsyEntryId: string;
  createdAt: string;
  ledgerType: string;
  referenceType?: string | null;
  referenceId?: string | null;
  description?: string | null;
  amount: number;
  currency: string;
  balance?: number | null;
}
