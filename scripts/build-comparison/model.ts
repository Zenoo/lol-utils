import { z } from 'zod';
import { questKind } from '../../src/core/role-items.js';
import type { Item } from '../../src/core/types.js';

export const casesSchema = z.array(
  z.object({
    champion: z.string(),
    role: z.string(),
    group: z.enum(['development', 'validation']),
  }),
);
export const referencesSchema = z.array(
  z.object({
    champion: z.string(),
    role: z.string(),
    provider: z.string(),
    url: z.url(),
    observedAt: z.string(),
    patch: z.string(),
    population: z.string(),
    kind: z.enum(['statistics', 'guide']),
    coreBuilds: z.array(z.array(z.number().int().positive()).min(2).max(3)).min(1),
    boots: z.array(z.number().int().positive()),
    sourceSha256: z.string().optional(),
    note: z.string().optional(),
  }),
);
export type Reference = z.infer<typeof referencesSchema>[number];

/** Boots and quest rewards have separate slots; compare the first three purchased combat items. */
export function combatItems(ids: readonly number[], items: Map<number, Item>): number[] {
  return ids.filter((id) => {
    const item = items.get(id);

    return item && !item.tags.includes('Boots') && !questKind(item);
  });
}
export function compareBuild(ids: number[], reference: Reference, items: Map<number, Item>) {
  const combat = combatItems(ids, items);
  const core = combat.slice(0, 3);
  const candidates = reference.coreBuilds.map((expected) => ({
    expected,
    coreRecall: expected.filter((id) => core.includes(id)).length / expected.length,
    buildRecall: expected.filter((id) => combat.includes(id)).length / expected.length,
    orderedRecall: expected.filter((id, index) => core[index] === id).length / expected.length,
  }));
  candidates.sort(
    (a, b) =>
      b.coreRecall - a.coreRecall ||
      b.buildRecall - a.buildRecall ||
      b.orderedRecall - a.orderedRecall,
  );
  const best = candidates[0];
  const boot = ids.find((id) => items.get(id)?.tags.includes('Boots'));

  return {
    ...best,
    firstItem: reference.coreBuilds.some((build) => build[0] === core[0]),
    boots: boot !== undefined && reference.boots.includes(boot),
    core,
  };
}

/** Parse only the public, rendered English item tables. Layout changes fail closed. */
export function parseOpgg(html: string) {
  const patch = html.match(/<title>[^<]*Build Patch (\d+\.\d+)/)?.[1];
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)].map((match) => match[1]);
  const table = (caption: string) =>
    tables.find((table) => table.includes(`<caption>${caption}</caption>`));
  const ids = (row: string) =>
    [...row.matchAll(/<img\b[^>]*src="[^"]*\/item\/(\d+)\.png/g)].map((match) => Number(match[1]));
  const rows = (body = '') =>
    [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((match) => ids(match[1]))
      .filter((row) => row.length);
  const coreBuilds = rows(table('Builds Table'))
    .filter((row) => row.length === 3)
    .slice(0, 3);
  const boots = rows(table('Boots Table')).slice(0, 2).flat();
  if (!patch || !coreBuilds.length || !boots.length) {
    throw new Error('OP.GG item tables or patch metadata missing; review the source manually');
  }

  return { patch, coreBuilds, boots };
}
