import type { Catalog } from '../core/types.js';

export function sourceRows(html: string, caption: string): string[] {
  return [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)]
    .filter(
      (match) => match[1]?.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/)?.[1]?.trim() === caption,
    )
    .flatMap((match) =>
      [...(match[1] ?? '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) => row[1] ?? ''),
    );
}
/** Describe source item paths without assigning a fixed archetype to the champion. */
export function buildArchetype(ids: number[], catalog: Catalog): string {
  const items = ids.flatMap((id) => catalog.items.find((item) => item.id === id) ?? []);
  const count = (tag: string) => items.filter((item) => item.tags.includes(tag)).length;
  const defense = items.filter(
    (item) => item.tags.includes('Armor') || item.tags.includes('SpellBlock'),
  ).length;
  const ap = count('SpellDamage'),
    ad = count('Damage');
  if (defense >= 2 && defense > ap && defense > ad) {
    return 'Tank';
  }
  if (ap >= 1 && count('Health') >= 2) {
    return 'AP / durability';
  }
  if (ap >= 2) {
    return defense >= 2 ? 'AP / durability' : 'AP';
  }
  if (count('CriticalStrike') >= 2) {
    return 'Critical strike';
  }
  if (ad >= 2) {
    return defense >= 2 || count('Health') >= 2 ? 'AD / durability' : 'AD';
  }

  return defense >= 2 ? 'Tank / utility' : 'Mixed / utility';
}

export function sourceRunePage(
  perks: number[],
  shards: number[],
  catalog: Catalog,
  provider: string,
) {
  const primary = catalog.runeStyles.find((s) => s.slots[0]?.perks.includes(perks[0] ?? 0));
  const secondary = catalog.runeStyles.find(
    (s) => s.id !== primary?.id && s.slots.some((slot) => slot.perks.includes(perks[4] ?? 0)),
  );
  const validRunes =
    primary &&
    secondary &&
    perks.length === 6 &&
    shards.length === 3 &&
    new Set(perks).size === 6 &&
    primary.slots.slice(0, 4).every((slot, i) => slot.perks.includes(perks[i] ?? 0)) &&
    perks
      .slice(4)
      .every((id) => secondary.slots.slice(1).some((slot) => slot.perks.includes(id))) &&
    secondary.slots.slice(1).filter((slot) => slot.perks.some((id) => perks.slice(4).includes(id)))
      .length === 2 &&
    catalog.perkStyles.styles
      .find((s) => s.id === primary.id)
      ?.allowedSubStyles.includes(secondary.id) &&
    shards.every((id, i) =>
      catalog.perkStyles.styles
        .find((s) => s.id === primary.id)
        ?.slots.filter((s) => s.type === 'kStatMod')
        [i]?.perks.includes(id),
    );

  return validRunes
    ? {
        name: `LoL Utils · ${provider}`,
        current: true,
        primaryStyleId: primary.id,
        subStyleId: secondary.id,
        selectedPerkIds: [...perks, ...shards],
      }
    : undefined;
}
