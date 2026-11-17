import type { FastifyInstance } from "fastify";
import type { z } from "zod";

interface Delegate {
  findMany: (args?: any) => Promise<any[]>;
  findUniqueOrThrow: (args: any) => Promise<any>;
  create: (args: any) => Promise<any>;
  update: (args: any) => Promise<any>;
  delete: (args: any) => Promise<any>;
}

/** Registers plain list/get/create/update/delete routes for a Prisma delegate with no nested relations. */
export function registerCrud(
  app: FastifyInstance,
  path: string,
  delegate: Delegate,
  schemas: { create: z.ZodType; update: z.ZodType },
  opts: { orderBy?: any } = {}
) {
  app.get(path, async () => delegate.findMany({ orderBy: opts.orderBy }));

  app.get(`${path}/:id`, async (req) => {
    const { id } = req.params as { id: string };
    return delegate.findUniqueOrThrow({ where: { id } });
  });

  app.post(path, async (req, reply) => {
    const data = schemas.create.parse(req.body);
    const created = await delegate.create({ data });
    reply.code(201);
    return created;
  });

  app.put(`${path}/:id`, async (req) => {
    const { id } = req.params as { id: string };
    const data = schemas.update.parse(req.body);
    return delegate.update({ where: { id }, data });
  });

  app.delete(`${path}/:id`, async (req, reply) => {
    const { id } = req.params as { id: string };
    await delegate.delete({ where: { id } });
    reply.code(204);
  });
}
