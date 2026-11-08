import { buildArchetype, sourceRunePage, sourceRows } from './source-build-utils.js';
import { required } from '../core/assert.js';
import type { Catalog, SourceBuild, SourceBuilds } from '../core/types.js';
import { parseLolvalueBuilds, parseMetabotBuilds } from './additional-builds.js';
export { buildArchetype } from './source-build-utils.js';

export const sourceRoles: Record<string, string> = {
  TOP: 'top',
  JUNGLE: 'jungle',
  MIDDLE: 'mid',
  BOTTOM: 'adc',
  UTILITY: 'support',
};

const imageIds = (html: string, kind: string) =>
  [...html.matchAll(new RegExp(`<img\\b[^>]*src="[^"]*/${kind}/(\\d+)\\.png`, 'g'))].map((m) =>
    Number(m[1]),
  );

/** Keep every displayed core row, including early components such as Tear. */
export function parseSourceBuilds(
  html: string,
  catalog: Catalog,
  championId: number,
  role: string,
  url: string,
): SourceBuild[] {
  const patch = html.match(/<title>[^<]*Build Patch (\d+\.\d+)/)?.[1];
  if (!patch) {
    throw new Error('OP.GG patch metadata missing; source layout may have changed');
  }
  const selected = [...html.matchAll(/<img\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => /\bopacity-100\b/.test(tag));
  const perks = selected.flatMap((tag) => imageIds(tag, 'perk')).slice(0, 6);
  const shards = selected.flatMap((tag) => imageIds(tag, 'perkShard')).slice(0, 3);
  const runePage = sourceRunePage(perks, shards, catalog, 'OP.GG');
  const spellRow =
    sourceRows(html, 'SummonerSpells Table').find((row) => row.includes('/spell/')) ?? '';
  const spells = [...spellRow.matchAll(/\/spell\/([A-Za-z]+)\.png/g)].flatMap(
    (m) => catalog.summoners.find((s) => s.alias === m[1])?.id ?? [],
  );
  const summoners =
    spells.length === 2 && spells[0] !== spells[1]
      ? { spell1Id: required(spells[0]), spell2Id: required(spells[1]) }
      : undefined;
  const seen = new Set<string>();
  const builds = sourceRows(html, 'Builds Table').flatMap((row) => {
    const items = imageIds(row, 'item');
    if (
      items.length < 2 ||
      items.some((id) => !catalog.items.some((item) => item.id === id && item.maps['11']))
    ) {
      return [];
    }
    const key = items.join('-');
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    const stats = row
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return [
      {
        id: `opgg-${championId}-${role}-${patch}-${key}`,
        championId,
        role,
        provider: 'OP.GG',
        population: 'Global Emerald+ · ranked solo/duo',
        url,
        patch,
        label: `${buildArchetype(items, catalog)} · option ${seen.size}`,
        stats,
        items,
        runes: runePage,
        summoners,
      },
    ];
  });
  if (!builds.length) {
    throw new Error('OP.GG has no compatible core builds for this champion and role');
  }

  return builds;
}

/** LoLalytics exposes one recommended core; never combine its independent item tables into invented paths. */
export function parseLolalyticsBuilds(
  html: string,
  catalog: Catalog,
  championId: number,
  role: string,
  url: string,
): SourceBuild[] {
  const patch = html.match(/Patch (\d+\.\d+)\b/)?.[1];
  const section = (from: string, to: string) => {
    const start = html.indexOf(from),
      end = html.indexOf(to, start + from.length);

    return start >= 0 && end > start ? html.slice(start, end) : '';
  };
  const ids = (body: string, kind: string) =>
    [...body.matchAll(new RegExp(`<img\\b[^>]*src="[^"]*/${kind}/(\\d+)\\.webp`, 'g'))].map((m) =>
      Number(m[1]),
    );
  const core = section('Core Build', 'Item 4');
  const items = ids(core, 'item64');
  if (
    !patch ||
    items.length < 2 ||
    items.length > 4 ||
    items.some((id) => !catalog.items.some((item) => item.id === id && item.maps['11']))
  ) {
    throw new Error(
      'LoLalytics compatible core or patch metadata missing; source layout may have changed',
    );
  }
  const selected = [...section('Primary Runes', 'Starting Items').matchAll(/<img\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => !/grayscale|opacity-/.test(tag))
    .join('');
  const runes = sourceRunePage(
    ids(selected, 'rune68'),
    ids(selected, 'statmod32'),
    catalog,
    'LoLalytics',
  );
  const spellIds = ids(section('Summoner Spells', 'Primary Runes'), 'spell64');
  const summoners =
    spellIds.length === 2 &&
    spellIds[0] !== spellIds[1] &&
    spellIds.every((id) => catalog.summoners.some((s) => s.id === id))
      ? { spell1Id: required(spellIds[0]), spell2Id: required(spellIds[1]) }
      : undefined;

  return [
    {
      id: `lolalytics-${championId}-${role}-${patch}-${items.join('-')}`,
      championId,
      role,
      provider: 'LoLalytics',
      population: 'Global Emerald+ · ranked solo/duo',
      url,
      patch,
      label: `${buildArchetype(items, catalog)} · recommended core`,
      stats: core
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/Loading\.\.\./g, '')
        .replace(/^Core Build\s*/, '')
        .trim(),
      items,
      runes,
      summoners,
    },
  ];
}

export class SourceBuildProvider {
  private cache = new Map<string, { expires: number; result: Promise<SourceBuilds> }>();
  private sourceCache = new Map<string, { expires: number; result: Promise<SourceBuild[]> }>();
  private choices = new Map<string, SourceBuild>();
  constructor(
    private catalog: Catalog,
    private request: typeof fetch = fetch,
  ) {}
  get(id: string) {
    return this.choices.get(id);
  }
  async load(
    championId: number,
    role: string,
    refresh = false,
    provider?: string,
  ): Promise<SourceBuilds> {
    role = role.toUpperCase();
    const champion = this.catalog.champions.find((c) => c.id === championId);
    if (!champion || !sourceRoles[role]) {
      throw new Error('Unknown champion or role');
    }
    const key = `${championId}-${role}-${provider ?? 'all'}`;
    const cached = this.cache.get(key);
    if (!refresh && cached && cached.expires > Date.now()) {
      return cached.result;
    }
    const slug = champion.alias === 'MonkeyKing' ? 'wukong' : champion.alias.toLowerCase();
    const sources = [
      {
        provider: 'OP.GG',
        url: `https://op.gg/lol/champions/${slug}/build/${sourceRoles[role]}?region=global&tier=emerald_plus&type=ranked`,
        parse: parseSourceBuilds,
      },
      {
        provider: 'LoLalytics',
        url: `https://lolalytics.com/lol/${slug}/build/?lane=${role === 'BOTTOM' ? 'bottom' : role === 'MIDDLE' ? 'middle' : sourceRoles[role]}&tier=emerald_plus`,
        parse: parseLolalyticsBuilds,
      },
      {
        provider: 'LOLValue',
        url: `https://lolvalue.com/lol-item-builder/${slug}`,
        parse: parseLolvalueBuilds,
      },
      {
        provider: 'MetaBot',
        url: `https://metabot.gg/en/league/champion/${champion.alias}/build`,
        parse: parseMetabotBuilds,
      },
    ].filter((source) => !provider || source.provider === provider);
    if (!sources.length) {
      throw new Error('Unknown build provider');
    }
    const result = (async () => {
      const outcomes = await Promise.allSettled(
        sources.map(({ url, parse, provider }) => {
          const sourceKey = `${championId}-${role}:${url}`;
          const previous = this.sourceCache.get(sourceKey);
          if (!refresh && previous && previous.expires > Date.now()) {
            return previous.result;
          }
          const pending = (async () => {
            const response = await this.request(url, { signal: AbortSignal.timeout(15_000) });
            if (!response.ok) {
              throw new Error(`${provider} HTTP ${response.status}`);
            }
            const html = await response.text();
            if (html.length > 5_000_000) {
              throw new Error(`${provider} response too large`);
            }

            return parse(html, this.catalog, championId, role, url);
          })().catch((error: unknown) => {
            if (this.sourceCache.get(sourceKey)?.result === pending) {
              this.sourceCache.delete(sourceKey);
            }
            throw error;
          });
          this.sourceCache.set(sourceKey, { expires: Date.now() + 10 * 60_000, result: pending });
          while (this.sourceCache.size > 200) {
            this.sourceCache.delete(required(this.sourceCache.keys().next().value));
          }

          return pending;
        }),
      );
      const builds = outcomes.flatMap((outcome) =>
        outcome.status === 'fulfilled' ? outcome.value : [],
      );
      const errors = outcomes.flatMap((outcome) =>
        outcome.status === 'rejected'
          ? [String(outcome.reason instanceof Error ? outcome.reason.message : outcome.reason)]
          : [],
      );
      for (const build of builds) {
        this.choices.set(build.id, build);
      }
      while (this.choices.size > 500) {
        this.choices.delete(required(this.choices.keys().next().value));
      }
      if (errors.length) {
        this.cache.delete(key);
      }

      return { builds, errors, fetchedAt: new Date().toISOString() };
    })();
    this.cache.set(key, { result, expires: Date.now() + 10 * 60_000 });
    while (this.cache.size > 50) {
      this.cache.delete(required(this.cache.keys().next().value));
    }

    return result;
  }
}
