-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "etsyOrderId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "orderedAt" DATETIME NOT NULL,
    "shipTarget" DATETIME,
    "etsyShipBy" DATETIME,
    "itemsRaw" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEEDS_PRINTING',
    "readyBy" DATETIME,
    "packed" BOOLEAN NOT NULL DEFAULT false,
    "labelBought" BOOLEAN NOT NULL DEFAULT false,
    "labelBoughtAt" DATETIME,
    "packageType" TEXT,
    "shippedAt" DATETIME,
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "orderTotal" REAL,
    "etsyGross" REAL,
    "salesTax" REAL,
    "etsyFees" REAL,
    "etsyEarnings" REAL,
    "labelCost" REAL,
    "productionCost" REAL,
    "laborMinutes" REAL,
    "netProfit" REAL,
    "margin" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Order" ("buyerName", "carrier", "createdAt", "etsyEarnings", "etsyFees", "etsyGross", "etsyOrderId", "etsyShipBy", "id", "itemsRaw", "labelCost", "laborMinutes", "margin", "netProfit", "orderTotal", "orderedAt", "packageType", "packed", "productionCost", "readyBy", "salesTax", "shipTarget", "shippedAt", "status", "trackingNumber", "updatedAt") SELECT "buyerName", "carrier", "createdAt", "etsyEarnings", "etsyFees", "etsyGross", "etsyOrderId", "etsyShipBy", "id", "itemsRaw", "labelCost", "laborMinutes", "margin", "netProfit", "orderTotal", "orderedAt", "packageType", "packed", "productionCost", "readyBy", "salesTax", "shipTarget", "shippedAt", "status", "trackingNumber", "updatedAt" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_etsyOrderId_key" ON "Order"("etsyOrderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
