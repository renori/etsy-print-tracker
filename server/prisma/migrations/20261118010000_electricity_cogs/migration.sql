CREATE TABLE "ElectricitySettings" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "kwhRate" REAL,
    "idleWattsPerPrinter" REAL NOT NULL DEFAULT 10,
    "printersOn" INTEGER,
    "bufferPct" REAL NOT NULL DEFAULT 10
);
CREATE TABLE "ElectricityMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "partId" TEXT
);
CREATE UNIQUE INDEX "ElectricityMatch_text_key" ON "ElectricityMatch"("text");
