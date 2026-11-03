import { z } from 'zod';
import type { Item } from './types.js';

const definitionSchema = z
  .object({
    __type: z.literal('ItemData'),
    itemID: z.number(),
    epicness: z.number().optional(),
    mItemGroups: z.array(z.string()).optional(),
    mDataValues: z.array(z.object({ mName: z.string(), mValue: z.number().default(0) })).optional(),
    mRequiredSpellName: z.string().optional(),
    mItemCalculations: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const groupSchema = z.object({
  __type: z.literal('ItemGroup'),
  mMaxGroupOwnable: z.number().optional(),
});

/** Decode item tiers, actual shared purchase limits, passive parameters, and extra stats. */
export function extractItemRules(
  raw: Record<string, unknown>,
): Map<number, NonNullable<Item['rules']>> {
  const limits = new Map<string, number>();
  for (const [key, value] of Object.entries(raw)) {
    const group = groupSchema.safeParse(value);
    if (group.success && group.data.mMaxGroupOwnable !== undefined) {
      limits.set(key, group.data.mMaxGroupOwnable);
    }
  }
  const result = new Map<number, NonNullable<Item['rules']>>();
  for (const value of Object.values(raw)) {
    const parsed = definitionSchema.safeParse(value);
    if (!parsed.success) {
      continue;
    }
    const definition = parsed.data;
    const groups = definition.mItemGroups ?? [];
    const stats: Record<string, number> = {};
    for (const [key, amount] of Object.entries(definition)) {
      if (typeof amount !== 'number' || !/^(m)?(?:[Ff]lat|[Pp]ercent|AbilityHaste)/.test(key)) {
        continue;
      }
      const name = key.replace(/^m(?=[A-Z])/, '');
      stats[name.charAt(0).toUpperCase() + name.slice(1)] = amount;
    }
    result.set(definition.itemID, {
      requiredSpell: definition.mRequiredSpellName,
      tier: definition.epicness,
      groups,
      stats,
      limits: Object.fromEntries(
        groups.flatMap((group) => {
          const limit = limits.get(group);

          return limit === undefined ? [] : [[group, limit]];
        }),
      ),
      values: Object.fromEntries(
        (definition.mDataValues ?? []).map((entry) => [entry.mName, entry.mValue]),
      ),
      calculations: definition.mItemCalculations ?? {},
    });
  }

  return result;
}
