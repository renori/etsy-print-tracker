import type { FastifyInstance } from "fastify";
import { importSheet } from "../import/sheetImport.js";

export default async function importRoutes(app: FastifyInstance) {
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: 30 * 1024 * 1024 }, (_req, body, done) => {
    done(null, body);
  });

  app.post("/import/sheet", async (req, reply) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      reply.code(400);
      return { error: "Upload the .xlsx file as the request body" };
    }
    try {
      return await importSheet(body);
    } catch (err) {
      req.log.error(err);
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
