ALTER TABLE "Box" ADD COLUMN "quoteWeightOz" REAL;

-- The shop's standard quote weights: 13x10x3 → 1 lb, 9x6x2 → 8 oz, 8x4x1 → 4 oz.
-- Matched like the app matches box names (case, spaces and "×" ignored).
UPDATE "Box" SET "quoteWeightOz" = 16 WHERE "quoteWeightOz" IS NULL AND replace(replace(lower("name"), ' ', ''), '×', 'x') LIKE '13x10x3%';
UPDATE "Box" SET "quoteWeightOz" = 8  WHERE "quoteWeightOz" IS NULL AND replace(replace(lower("name"), ' ', ''), '×', 'x') LIKE '9x6x2%';
UPDATE "Box" SET "quoteWeightOz" = 4  WHERE "quoteWeightOz" IS NULL AND replace(replace(lower("name"), ' ', ''), '×', 'x') LIKE '8x4x1%';
