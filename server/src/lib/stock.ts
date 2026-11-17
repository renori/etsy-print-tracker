import { db } from "./db.js";
import { boxForOrder, normBoxName } from "./boxes.js";

export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * Packing is when stock actually leaves the shelf: the order's parts and one
 * of its box come off (sign -1), or go back on when un-packing (sign +1).
 */
export async function moveStock(tx: Tx, orderId: string, sign: 1 | -1) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { parts: { include: { part: true } } } });
  for (const p of order.parts) {
    await tx.part.update({ where: { id: p.partId }, data: { onHand: { increment: sign * p.quantity } } });
  }
  const boxName = boxForOrder(order);
  if (boxName) {
    const box = (await tx.box.findMany()).find((b) => normBoxName(b.name) === normBoxName(boxName));
    if (box) await tx.box.update({ where: { id: box.id }, data: { onHand: { increment: sign } } });
  }
}

