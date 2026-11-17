export function normBoxName(name: string): string {
  return name.toLowerCase().replace(/×/g, "x").replace(/\s+/g, "");
}

/** "13x10x3" → 390; "8x4x1 mailer" → 32; unparseable → 0. */
function volume(name: string): number {
  const dims = name.match(/\d+(\.\d+)?/g);
  return dims && dims.length >= 3 ? dims.slice(0, 3).reduce((a, d) => a * parseFloat(d), 1) : 0;
}

/**
 * The box an order ships in: its own package if set, otherwise the biggest
 * package any of its parts calls for.
 */
export function boxForOrder(order: {
  packageType: string | null;
  parts: { part?: { packageType: string | null } | null }[];
}): string | null {
  if (order.packageType?.trim()) return order.packageType.trim();
  const pkgs = order.parts.map((p) => p.part?.packageType?.trim()).filter((p): p is string => !!p);
  if (pkgs.length === 0) return null;
  return pkgs.sort((a, b) => volume(b) - volume(a))[0];
}
