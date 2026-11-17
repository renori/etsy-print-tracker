export interface RecipePart {
  partId: string;
  maxCount: number;
}

export interface Recipe {
  id: string;
  name?: string | null;
  printerId: string | null; // null = any active printer
  plateMinutes: number | null; // null = sum of part print times
  parts: RecipePart[];
}

export interface PartInfo {
  id: string;
  name: string;
  printMinutes: number;
}

export interface PendingPlate {
  label: string;
  printerId: string | null;
  recipeId: string | null;
  minutes: number;
  parts: { partId: string; quantity: number }[];
}

/**
 * Packs outstanding per-part demand into plates using the configured Plate Recipes.
 * Mirrors the sheet's rule: a recipe plate may be any mix of its parts up to each
 * part's Max; a part with no recipe at all prints one unit per plate.
 */
export function packPlates(
  demand: Map<string, number>,
  recipes: Recipe[],
  parts: Map<string, PartInfo>
): PendingPlate[] {
  const remaining = new Map(demand);
  const covered = new Set<string>();
  for (const r of recipes) for (const p of r.parts) covered.add(p.partId);

  const plates: PendingPlate[] = [];

  for (const recipe of recipes) {
    if (recipe.parts.length === 0) continue;
    // Keep building plates from this recipe while it still has anything to take.
    while (true) {
      const taken: { partId: string; quantity: number }[] = [];
      for (const rp of recipe.parts) {
        const have = remaining.get(rp.partId) ?? 0;
        const take = Math.min(have, rp.maxCount);
        if (take > 0) taken.push({ partId: rp.partId, quantity: take });
      }
      if (taken.length === 0) break;
      for (const t of taken) remaining.set(t.partId, (remaining.get(t.partId) ?? 0) - t.quantity);

      const totalTaken = taken.reduce((s, t) => s + t.quantity, 0);
      const totalMax = recipe.parts.reduce((s, p) => s + p.maxCount, 0);
      const fullness = totalMax > 0 ? totalTaken / totalMax : 1;

      const minutes =
        recipe.plateMinutes != null
          ? recipe.plateMinutes * fullness
          : taken.reduce((s, t) => s + (parts.get(t.partId)?.printMinutes ?? 0) * t.quantity, 0);

      plates.push({
        label: taken.map((t) => `${t.quantity}× ${parts.get(t.partId)?.name ?? t.partId}`).join(" + "),
        printerId: recipe.printerId,
        recipeId: recipe.id,
        minutes,
        parts: taken,
      });
    }
  }

  // Anything left over either isn't covered by any recipe, or exceeded what the
  // matching recipes could take (shouldn't happen since recipes loop to exhaustion,
  // but we still drain it defensively) — one plate per unit.
  for (const [partId, qty] of remaining) {
    if (qty <= 0) continue;
    const info = parts.get(partId);
    for (let i = 0; i < qty; i++) {
      plates.push({
        label: `1× ${info?.name ?? partId}`,
        printerId: null,
        recipeId: null,
        minutes: info?.printMinutes ?? 0,
        parts: [{ partId, quantity: 1 }],
      });
    }
  }

  return plates;
}
