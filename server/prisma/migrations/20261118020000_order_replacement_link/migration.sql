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
    "etsyLines" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEEDS_PRINTING',
    "readyBy" DATETIME,
    "packed" BOOLEAN NOT NULL DEFAULT false,
    "labelBought" BOOLEAN NOT NULL DEFAULT false,
    "labelBoughtAt" DATETIME,
    "packageType" TEXT,
    "digital" BOOLEAN NOT NULL DEFAULT false,
    "shippedAt" DATETIME,
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "orderTotal" REAL,
    "etsyGross" REAL,
    "salesTax" REAL,
    "etsyFees" REAL,
    "etsyEarnings" REAL,
    "labelCost" REAL,
    "labelCostSource" TEXT,
    "labelCostNote" TEXT,
    "shipCountry" TEXT,
    "shippingPaid" REAL,
    "shipWeightOz" REAL,
    "productionCost" REAL,
    "laborMinutes" REAL,
    "netProfit" REAL,
    "margin" REAL,
    "partsManual" BOOLEAN NOT NULL DEFAULT false,
    "replacementId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_replacementId_fkey" FOREIGN KEY ("replacementId") REFERENCES "Replacement" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("buyerName", "carrier", "createdAt", "digital", "etsyEarnings", "etsyFees", "etsyGross", "etsyLines", "etsyOrderId", "etsyShipBy", "id", "itemsRaw", "labelBought", "labelBoughtAt", "labelCost", "labelCostNote", "labelCostSource", "laborMinutes", "margin", "netProfit", "orderTotal", "orderedAt", "packageType", "packed", "productionCost", "readyBy", "salesTax", "shipCountry", "shipTarget", "shipWeightOz", "shippedAt", "shippingPaid", "status", "trackingNumber", "updatedAt") SELECT "buyerName", "carrier", "createdAt", "digital", "etsyEarnings", "etsyFees", "etsyGross", "etsyLines", "etsyOrderId", "etsyShipBy", "id", "itemsRaw", "labelBought", "labelBoughtAt", "labelCost", "labelCostNote", "labelCostSource", "laborMinutes", "margin", "netProfit", "orderTotal", "orderedAt", "packageType", "packed", "productionCost", "readyBy", "salesTax", "shipCountry", "shipTarget", "shipWeightOz", "shippedAt", "shippingPaid", "status", "trackingNumber", "updatedAt" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_etsyOrderId_key" ON "Order"("etsyOrderId");
CREATE UNIQUE INDEX "Order_replacementId_key" ON "Order"("replacementId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

