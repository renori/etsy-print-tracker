ALTER TABLE "Part" ADD COLUMN "shipWeightOz" REAL;
ALTER TABLE "Box" ADD COLUMN "weightOz" REAL;
ALTER TABLE "Order" ADD COLUMN "shipWeightOz" REAL;
CREATE TABLE "ExportRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "maxOz" REAL NOT NULL,
    "canada" REAL,
    "world" REAL
);
CREATE UNIQUE INDEX "ExportRate_maxOz_key" ON "ExportRate"("maxOz");
