export const ORDER_STATUS = {
  NEEDS_PRINTING: "NEEDS_PRINTING",
  PRINTING: "PRINTING",
  READY_FROM_STOCK: "READY_FROM_STOCK",
  READY_LABEL_BOUGHT: "READY_LABEL_BOUGHT",
  PACKED: "PACKED",
  SHIPPED: "SHIPPED",
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const ORDER_STATUSES = Object.values(ORDER_STATUS) as OrderStatus[];
