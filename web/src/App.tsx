import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Home } from "./pages/Home";
import { Orders } from "./pages/Orders";
import { CompletedOrders } from "./pages/CompletedOrders";
import { PrintedStock } from "./pages/PrintedStock";
import { Parts } from "./pages/Parts";
import { ListingMap } from "./pages/ListingMap";
import { PlateRecipes } from "./pages/PlateRecipes";
import { Printers } from "./pages/Printers";
import { BlackoutTimes } from "./pages/BlackoutTimes";
import { Replacements } from "./pages/Replacements";
import { Expenses } from "./pages/Expenses";
import { Mileage } from "./pages/Mileage";
import { TaxExport } from "./pages/TaxExport";
import { Electricity } from "./pages/Electricity";
import { Backups } from "./pages/Backups";
import { Ledger } from "./pages/Ledger";
import { EtsyConnection } from "./pages/EtsyConnection";
import { ImportSheet } from "./pages/ImportSheet";
import { Boxes } from "./pages/Boxes";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="queue" element={<Dashboard />} />
        <Route path="orders" element={<Orders />} />
        <Route path="completed" element={<CompletedOrders />} />
        <Route path="stock" element={<PrintedStock />} />
        <Route path="boxes" element={<Boxes />} />
        <Route path="parts" element={<Parts />} />
        <Route path="listing-map" element={<ListingMap />} />
        <Route path="plate-recipes" element={<PlateRecipes />} />
        <Route path="printers" element={<Printers />} />
        <Route path="blackout" element={<BlackoutTimes />} />
        <Route path="replacements" element={<Replacements />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="mileage" element={<Mileage />} />
        <Route path="taxes" element={<TaxExport />} />
        <Route path="electricity" element={<Electricity />} />
        <Route path="backups" element={<Backups />} />
        <Route path="ledger" element={<Ledger />} />
        <Route path="etsy" element={<EtsyConnection />} />
        <Route path="import" element={<ImportSheet />} />
      </Route>
    </Routes>
  );
}
