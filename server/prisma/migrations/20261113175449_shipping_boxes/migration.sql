-- CreateTable
CREATE TABLE "Box" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reorderAt" INTEGER,
    "costEach" REAL,
    "notes" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Box_name_key" ON "Box"("name");
