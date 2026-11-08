import type { Catalog, SourceBuild } from '../core/types.js';
import { buildArchetype, sourceRows, sourceRunePage } from './source-build-utils.js';

const roleNames: Record<string, string[]> = {
  TOP: ['Top'],
  JUNGLE: ['Jungle'],
  MIDDLE: ['Mid', 'Middle'],
  BOTTOM: ['Bot', 'ADC'],
  UTILITY: ['Support'],
};
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);

      return point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(
      /&(?:amp|quot|apos|nbsp|middot);/g,
      (entity) =>
        ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&middot;': '·' })[entity] ??
        '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}
function cells(row: string) {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((match) => text(match[1] ?? ''));
}
function namedIds(names: string[], entries: { id: number; name: string }[]): number[] {
  return names.flatMap((name) => {
    const matches = entries.filter(
      (entry) => entry.name.toLowerCase() === name.trim().toLowerCase(),
    );

    return matches.length === 1 ? [matches[0].id] : [];
  });
}
function summoners(names: string[], catalog: Catalog) {
  const ids = namedIds(
    names,
    catalog.summoners.filter((spell) => spell.modes.includes('CLASSIC')),
  );

  return ids.length === 2 && ids[0] !== ids[1] ? { spell1Id: ids[0], spell2Id: ids[1] } : undefined;
}
function namedRunes(perkNames: string[], shardNames: string[], catalog: Catalog, provider: string) {
  const perks = namedIds(
    perkNames,
    catalog.perks.filter((perk) => perk.id > 6000),
  );
  const primary = catalog.perkStyles.styles.find((style) =>
    style.slots[0]?.perks.includes(perks[0]),
  );
  const slots = primary?.slots.filter((slot) => slot.type === 'kStatMod') ?? [];
  const shards = shardNames.flatMap((name, index) =>
    namedIds(
      [name],
      catalog.perks.filter((perk) => slots[index]?.perks.includes(perk.id)),
    ),
  );

  return sourceRunePage(perks, shards, catalog, provider);
}
function validItems(ids: number[], catalog: Catalog) {
  return (
    ids.length >= 2 &&
    ids.length <= 6 &&
    new Set(ids).size === ids.length &&
    ids.every((id) =>
      catalog.items.some(
        (item) => item.id === id && item.maps['11'] && item.source?.displayInItemSets !== false,
      ),
    )
  );
}

/** These are observed inventory cores, not a known purchase sequence. Keep that distinction visible. */
export function parseLolvalueBuilds(
  html: string,
  catalog: Catalog,
  championId: number,
  role: string,
  url: string,
): SourceBuild[] {
  const patchMatch = html.match(/<title[^>]*>[^<]*Build (\d+)\.(\d+):/);
  if (!patchMatch) {
    throw new Error('LOLValue patch metadata missing');
  }
  // Since 2025 the public patch label is year-based; Data Dragon retains season numbers.
  const major = Number(patchMatch[1]);
  const patch = `${major >= 25 ? major - 10 : major}.${patchMatch[2]}`;
  const headings = [...html.matchAll(/<h3\b[^>]*>([^<]+) build<\/h3>/g)];
  const heading = headings.find((match) =>
    roleNames[role]?.some((name) => match[1]?.endsWith(` ${name}`)),
  );
  if (!heading || heading.index === undefined) {
    throw new Error(`LOLValue has no ${role} build section`);
  }
  const rest = html.slice(heading.index + heading[0].length);
  const section = rest.split(/<h[23]\b/)[0] ?? '';
  const runeRow =
    cells(sourceRows(section, 'Most used rune page').find((row) => row.includes('<td')) ?? '')[0] ??
    '';
  const [perkText = '', shardText = ''] = runeRow.split(/Shards:\s*/);
  const runes = namedRunes(
    perkText
      .split('·')
      .map((name) => name.trim())
      .filter(Boolean),
    shardText.split(','),
    catalog,
    'LOLValue',
  );
  const spellNames =
    cells(
      sourceRows(section, 'Summoner spells').find((row) => row.includes('<td')) ?? '',
    )[0]?.split(' + ') ?? [];
  const pair = summoners(spellNames, catalog);
  const entries = catalog.items.filter(
    (item) => item.maps['11'] && item.source?.displayInItemSets !== false && item.rules?.tier === 5,
  );
  // Multiple official variants can have the same name; resolve only the canonical lowest-ID entry.
  const namedItems = entries.filter(
    (item) => !entries.some((other) => other.name === item.name && other.id < item.id),
  );
  const builds = sourceRows(section, 'Most built three-item core').flatMap((row) => {
    const [names, pick, win, games] = cells(row);
    if (!names) {
      return [];
    }
    const parts = names.split(' + ');
    const items = namedIds(parts, namedItems);
    if (items.length !== parts.length || !validItems(items, catalog)) {
      return [];
    }

    return [
      {
        id: `lolvalue-${championId}-${role}-${patch}-${items.join('-')}`,
        championId,
        role,
        provider: 'LOLValue',
        url,
        patch,
        population: 'Master+ lobbies · ranked solo/duo · observed inventory cores',
        itemOrder: 'inventory' as const,
        label: `${buildArchetype(items, catalog)} · inventory core`,
        stats: `${pick} pick · ${win} win · ${games} games`,
        items,
        runes,
        summoners: pair,
      },
    ];
  });
  if (!builds.length) {
    throw new Error('LOLValue compatible core builds missing');
  }

  return builds;
}

/** Read the actual three-item sequence tables, rather than constructing a build from item pick rates. */
export function parseMetabotBuilds(
  html: string,
  catalog: Catalog,
  championId: number,
  role: string,
  url: string,
): SourceBuild[] {
  const title = text(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? '');
  if (!roleNames[role]?.some((name) => title.includes(` ${name} Build`))) {
    throw new Error(`MetaBot page does not match ${role}`);
  }
  const patch = html.match(
    /ddragon\.leagueoflegends\.com(?:\/|%2F)cdn(?:\/|%2F)(\d+\.\d+)\.\d+/,
  )?.[1];
  if (!patch) {
    throw new Error('MetaBot game-data patch metadata missing');
  }
  const core =
    [
      ...html.matchAll(/<h3\b[^>]*>Three-item core<\/h3>\s*<table\b[^>]*>([\s\S]*?)<\/table>/g),
    ][0]?.[1] ?? '';
  const runeSection =
    html.match(/<section\b[^>]*aria-label="Best [^"]+ Runes"[^>]*>([\s\S]*?)<\/section>/)?.[1] ??
    '';
  const perks = [...runeSection.matchAll(/href="\/en\/league\/rune\/(\d+)\/overview"/g)].map(
    (match) => Number(match[1]),
  );
  const shardSection = runeSection.match(/<ul\b[^>]*shardList[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? '';
  const shardNames = [...shardSection.matchAll(/<img\b[^>]*alt="([^"]+)"/g)].map((match) =>
    text(match[1]),
  );
  const perkNames = perks.flatMap((id) => catalog.perks.find((perk) => perk.id === id)?.name ?? []);
  const runes = namedRunes(perkNames, shardNames, catalog, 'MetaBot');
  const spellSection = html.slice(html.indexOf('Top Summoner Spells'));
  const spellNames = text(spellSection.match(/aria-label="([^"]+) for [^"]+"/)?.[1] ?? '').split(
    ' + ',
  );
  const pair = summoners(spellNames, catalog);
  const builds: SourceBuild[] = [...core.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].flatMap(
    (match, index) => {
      const row = match[1] ?? '';
      const firstCell = row.match(/<td\b[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? '';
      const items = [
        ...new Set(
          [...firstCell.matchAll(/href="\/en\/league\/item\/(\d+)\/overview"/g)].map((m) =>
            Number(m[1]),
          ),
        ),
      ];
      if (!validItems(items, catalog)) {
        return [];
      }
      const [, win, pick, timing, games] = cells(row);

      return [
        {
          id: `metabot-${championId}-${role}-${patch}-${items.join('-')}`,
          championId,
          role,
          provider: 'MetaBot',
          url,
          patch,
          population: 'Ranked games · source default population',
          itemOrder: 'purchase' as const,
          label: `${buildArchetype(items, catalog)} · core ${index}`,
          stats: `${pick} pick · ${win} win · ${games} games · median completion ${timing}`,
          items,
          runes,
          summoners: pair,
        },
      ];
    },
  );
  if (!builds.length) {
    throw new Error('MetaBot compatible three-item cores missing');
  }
  // The selected source page also publishes one complete inventory. Keep it as
  // its own variant; its rune/spell page must not be attached to invented cores.
  const fullSection = html.match(/<h3\b[^>]*>Full Build<\/h3>([\s\S]*?)(?=<h3\b)/)?.[1] ?? '';
  const fullItems = [
    ...new Set([...fullSection.matchAll(/%2Fitem%2F(\d+)\.png/g)].map((match) => Number(match[1]))),
  ].filter((id) =>
    catalog.items.some(
      (item) => item.id === id && (item.rules?.tier === 5 || item.tags.includes('Boots')),
    ),
  );
  if (fullItems.length === 6 && validItems(fullItems, catalog)) {
    builds.unshift({
      id: `metabot-full-${championId}-${role}-${patch}-${fullItems.join('-')}`,
      championId,
      role,
      provider: 'MetaBot',
      url,
      patch,
      population: 'Ranked games · source default population',
      itemOrder: 'inventory',
      label: `${buildArchetype(fullItems, catalog)} · full build`,
      stats: 'Source full inventory',
      items: fullItems,
      mainItems: fullItems,
      runes,
      summoners: pair,
    });
  }

  return builds;
}
