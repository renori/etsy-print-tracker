import { createReadStream } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { BACKUP_DIR, backupStatus, listBackups, runBackup } from "../lib/backup.js";

export default async function backupRoutes(app: FastifyInstance) {
  app.get("/backups", async () => backupStatus());

  app.post("/backups/run", async () => {
    const result = await runBackup("manual");
    return { result, ...(await backupStatus()) };
  });

  /** Download one backup (only names the backup list knows, so no path tricks). */
  app.get("/backups/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!(await listBackups()).some((f) => f.name === name)) return reply.code(404).send({ error: "No such backup" });
    return reply
      .header("Content-Type", "application/vnd.sqlite3")
      .header("Content-Disposition", `attachment; filename="${name}"`)
      .send(createReadStream(path.join(BACKUP_DIR, name)));
  });
}
