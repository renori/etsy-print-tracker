-- DropIndex
DROP INDEX "ListingMapping_etsyListingId_key";

-- CreateIndex
CREATE INDEX "ListingMapping_etsyListingId_idx" ON "ListingMapping"("etsyListingId");
