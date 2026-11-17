import test from "node:test";
import assert from "node:assert/strict";
import { amazonDrafts, guessCategory } from "../receiptReader.js";

// The layout of Amazon's "Order Summary" page when copied from the browser
// (name and address are made up).
const ORDER_SUMMARY = `Order Summary
Order placed November 17, 2026  Order # 111-0584143-3157019
Print
Ship to
Jordan Example
123 SAMPLE ST APT 4
SPRINGFIELD, IL 62701-1234
United States
Payment method

Ink Business Unlimited •••• 7794

Order Summary
Item(s) Subtotal:
$25.64
Shipping & Handling:
$2.99
Free Shipping:
-$2.99
Total before tax:
$25.64
Estimated tax to be collected:
$1.99
Grand Total:
$27.63
Arriving overnight 3 AM – 6 AM
eSUN PLA+ Filament 1.75mm, 3D Printer Filament(Fire Engine Red+Cold White) | 1kg Cardboard Spool(2.2lbs) PLA Plus Filament, Fits for Most FDM 3D Printers
eSUN PLA+ Filament 1.75mm, 3D Printer Filament(Fire Engine Red+Cold White) | 1kg Cardboard Spool(2.2lbs) PLA Plus Filament, Fits for Most FDM 3D Printers
Sold by: eSUN Bio New Material
Supplied by: Other
$25.64
`;

test("Amazon order summary: product title, not address or seller lines", () => {
  const [d] = amazonDrafts(ORDER_SUMMARY)!;
  assert.match(d.item, /^eSUN PLA\+ Filament 1\.75mm/);
  assert.doesNotMatch(d.item, /United States|Supplied by|Jordan|SAMPLE ST|SPRINGFIELD/i);
  assert.equal(d.cost, 27.63);
  assert.equal(d.date, "2026-11-17");
  assert.equal(d.invoiceRef, "111-0584143-3157019");
  assert.equal(d.paidWith, "ending 7794");
  assert.equal(d.notes, null); // one product, listed twice, is still one item
});

test("category comes from the product, not page boilerplate", () => {
  const [d] = amazonDrafts(ORDER_SUMMARY)!;
  assert.equal(guessCategory(d.item), "Filament");
  assert.equal(guessCategory("Poly mailers 10x13, 100 pack"), "Shipping");
  assert.equal(guessCategory("United States; Supplied by: Other"), null);
});

test("several products: each title once, sold-by lines skipped", () => {
  const text = `Order placed October 2, 2026 Order # 112-1111111-2222222
Grand Total: $41.20
Polymaker PETG Filament 1.75mm Black 1kg Spool for 3D Printers
Sold by: Polymaker
Return or replace items: Eligible through November 1, 2026
Hilitchi 200pcs Brass Heat Set Threaded Inserts M3 Assortment Kit
Sold by: Hilitchi Store
Visa ending in 1234`;
  const [d] = amazonDrafts(text)!;
  assert.equal(d.item, "Polymaker PETG Filament 1.75mm Black 1kg Spool for 3D Printers; Hilitchi 200pcs Brass Heat Set Threaded Inserts M3 Assortment Kit");
  assert.equal(d.cost, 41.2);
  assert.equal(guessCategory(d.item), "Filament");
});
