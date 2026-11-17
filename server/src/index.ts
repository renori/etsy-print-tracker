import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";

import printerRoutes from "./routes/printers.js";
import partRoutes from "./routes/parts.js";
import plateRecipeRoutes from "./routes/plateRecipes.js";
import blackoutRoutes from "./routes/blackout.js";
import queueRoutes from "./routes/queue.js";
import listingMappingRoutes from "./routes/listingMappings.js";
import orderRoutes from "./routes/orders.js";
import replacementRoutes from "./routes/replacements.js";
import expenseRoutes from "./routes/expenses.js";
import mileageRoutes from "./routes/mileage.js";
import ledgerRoutes from "./routes/ledger.js";
import etsyRoutes from "./etsy/routes.js";
import importRoutes from "./routes/importSheet.js";
import boxRoutes from "./routes/boxes.js";
import exportRateRoutes from "./routes/exportRates.js";
import taxExportRoutes from "./routes/taxExport.js";
import electricityRoutes from "./routes/electricity.js";
import { refreshElectricitySoon } from "./lib/electricity.js";
import { shipLinkedReplacementsSoon } from "./lib/replacements.js";
import summaryRoutes from "./routes/summary.js";
import { startEtsySyncJob } from "./etsy/sync.js";
import { repairUtcMidnightDates } from "./lib/dates.js";
import { markDigitalOrders, refreshLabelEstimates } from "./lib/financials.js";

/** Which build is running: stamped into the image by the GitHub workflow. */
const VERSION = {
  version: (process.env.APP_VERSION || "dev").slice(0, 7),
  builtAt: process.env.APP_BUILT_AT || null,
  change: process.env.APP_CHANGE || null,
  startedAt: new Date().toISOString(),
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// Any change made in the app (an order completed, a part's cost edited, a
// listing mapped, an import...) can move a month's electricity COGS, so the
// monthly electricity expenses are refreshed after every successful change.
app.addHook("onResponse", async (req, reply) => {
  if (req.method !== "GET" && req.url.startsWith("/api/") && !req.url.startsWith("/api/electricity") && reply.statusCode < 400) {
    void shipLinkedReplacementsSoon(); // an order shipping a replacement marks it shipped
    void refreshElectricitySoon();
  }
});

// Everything the frontend calls lives under /api — in dev the Vite proxy
// forwards /api/* here untouched; in the packaged Docker image this same
// server also serves the built frontend, so no path games are needed there.
await app.register(
  async (api) => {
    api.get("/health", async () => ({ ok: true, ...VERSION }));
    await api.register(printerRoutes);
    await api.register(partRoutes);
    await api.register(plateRecipeRoutes);
    await api.register(blackoutRoutes);
    await api.register(queueRoutes);
    await api.register(listingMappingRoutes);
    await api.register(orderRoutes);
    await api.register(replacementRoutes);
    await api.register(expenseRoutes);
    await api.register(mileageRoutes);
    await api.register(ledgerRoutes);
    await api.register(etsyRoutes);
    await api.register(importRoutes);
    await api.register(boxRoutes);
    await api.register(exportRateRoutes);
    await api.register(taxExportRoutes);
    await api.register(electricityRoutes);
    await api.register(summaryRoutes);
  },
  { prefix: "/api" }
);

// In the Docker image, the frontend's built assets are copied next to the
// server (see Dockerfile) — serve them, with an SPA fallback for client-side routes.
const publicDir = path.join(__dirname, "public");
if (fs.existsSync(publicDir)) {
  await app.register(fastifyStatic, { root: publicDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api")) {
      reply.code(404).send({ error: "Not found" });
      return;
    }
    reply.sendFile("index.html");
  });
}

const repaired = await repairUtcMidnightDates();
if (repaired) app.log.info(`Moved ${repaired} date(s) saved as UTC midnight to the correct day`);
const digital = await markDigitalOrders();
if (digital) app.log.info(`Marked ${digital} digital-download order(s): no shipping label`);
await shipLinkedReplacementsSoon();
await refreshElectricitySoon();
const reestimated = await refreshLabelEstimates();
if (reestimated) app.log.info(`Updated ${reestimated} label cost estimate(s)`);

const port = Number(process.env.PORT ?? 9999);
await app.listen({ port, host: "0.0.0.0" });

startEtsySyncJob();
