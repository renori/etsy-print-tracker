-- CreateTable
CREATE TABLE "Part" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "printMinutes" REAL NOT NULL,
    "filamentGrams" REAL NOT NULL,
    "filamentPricePerKg" REAL NOT NULL,
    "filamentCost" REAL NOT NULL,
    "electricityCost" REAL NOT NULL,
    "depreciation" REAL NOT NULL,
    "shippingBoxCost" REAL NOT NULL,
    "bagCost" REAL NOT NULL,
    "wrappingCost" REAL NOT NULL,
    "hardwareCost" REAL NOT NULL,
    "laborCost" REAL NOT NULL,
    "touchTimeMinutes" REAL NOT NULL,
    "cost" REAL NOT NULL,
    "listPrice" REAL,
    "margin" REAL,
    "packageType" TEXT,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Printer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "PlateRecipe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "printerId" TEXT,
    "plateMinutes" REAL,
    "notes" TEXT,
    CONSTRAINT "PlateRecipe_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlateRecipePart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipeId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "maxCount" INTEGER NOT NULL,
    CONSTRAINT "PlateRecipePart_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "PlateRecipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlateRecipePart_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BlackoutWindow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "daysPattern" TEXT NOT NULL,
    "fromTime" TEXT,
    "toTime" TEXT,
    "note" TEXT
);

-- CreateTable
CREATE TABLE "ScheduleSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "morningStart" TEXT NOT NULL DEFAULT '07:30',
    "morningWindowMinutes" INTEGER NOT NULL DEFAULT 15,
    "homeTime" TEXT NOT NULL DEFAULT '18:00',
    "lastStart" TEXT NOT NULL DEFAULT '00:30'
);

-- CreateTable
CREATE TABLE "PlateQueueEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "printerId" TEXT,
    "label" TEXT NOT NULL,
    "plannedStart" DATETIME NOT NULL,
    "plannedFinish" DATETIME NOT NULL,
    "printMinutes" REAL NOT NULL,
    "forOrders" TEXT,
    "started" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" DATETIME,
    "manualEntry" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlateQueueEntry_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlateQueuePart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    CONSTRAINT "PlateQueuePart_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "PlateQueueEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlateQueuePart_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListingMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "etsyListingId" TEXT NOT NULL,
    "listingTitle" TEXT NOT NULL,
    "variationContains" TEXT,
    "notes" TEXT,
    "autoGuessed" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "ListingPart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mappingId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ListingPart_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "ListingMapping" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ListingPart_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
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

-- CreateTable
CREATE TABLE "OrderPart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    CONSTRAINT "OrderPart_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderPart_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Replacement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "originalOrderId" TEXT,
    "buyerName" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL,
    "shipByTarget" DATETIME,
    "notes" TEXT,
    "shipped" BOOLEAN NOT NULL DEFAULT false,
    "shippedAt" DATETIME,
    "labelCost" REAL,
    "cogsLoggedAt" DATETIME,
    "labelLoggedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ReplacementPart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "replacementId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    CONSTRAINT "ReplacementPart_replacementId_fkey" FOREIGN KEY ("replacementId") REFERENCES "Replacement" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReplacementPart_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GripReplacement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "etsyOrderId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "orderedAt" DATETIME,
    "originalShippedAt" DATETIME,
    "fabbed" BOOLEAN NOT NULL DEFAULT false,
    "replied" BOOLEAN NOT NULL DEFAULT false,
    "replacementShippedAt" DATETIME,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "item" TEXT NOT NULL,
    "vendor" TEXT,
    "category" TEXT,
    "cost" REAL NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "scheduleCLine" TEXT,
    "deductible" BOOLEAN NOT NULL DEFAULT true,
    "paidWith" TEXT,
    "invoiceRef" TEXT,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "MileageEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "destination" TEXT NOT NULL,
    "purpose" TEXT,
    "miles" REAL NOT NULL,
    "ratePerMile" REAL NOT NULL DEFAULT 0.70
);

-- CreateTable
CREATE TABLE "EtsyLedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "etsyEntryId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "ledgerType" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "description" TEXT,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "balance" REAL,
    "parentEntryId" TEXT
);

-- CreateTable
CREATE TABLE "EtsyCredentials" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "shopId" TEXT,
    "apiKeystring" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "Part_name_key" ON "Part"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Printer_name_key" ON "Printer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ListingMapping_etsyListingId_key" ON "ListingMapping"("etsyListingId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_etsyOrderId_key" ON "Order"("etsyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Replacement_code_key" ON "Replacement"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EtsyLedgerEntry_etsyEntryId_key" ON "EtsyLedgerEntry"("etsyEntryId");
