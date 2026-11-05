import { mkdir, writeFile, readFile, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, validateCatalog } from '../src/core/data.js';
import { extractItemRules } from '../src/core/item-rules.js';
import { extractSkillProgression } from '../src/core/skill-progression.js';
import { z } from 'zod';
import { required } from '../src/core/assert.js';
import type { Champion } from '../src/core/types.js';
import { publishData, recoverData, removeDataStage } from './data-storage.js';
import { latestDataVersion } from './check-data-version.js';
import {
  championIndexSchema,
  championDetailSchema,
  championSourceSchema,
  itemsFileSchema,
  summonersFileSchema,
  runesFileSchema,
  itemSourceSchema,
  perkSchema,
  perkStylesSchema,
  manifestSchema,
} from '../src/core/schema.js';

const root = path.resolve(fileURLToPath(new URL('../data/', import.meta.url)));
export async function fetchJson(url: string, fetcher = fetch): Promise<unknown> {
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        throw new Error(`Upstream returned ${response.status}: ${url}`);
      }

      return await response.json();
    } catch (e) {
      error = e;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  }
  throw error;
}
export async function pool<T>(
  values: T[],
  concurrency: number,
  fn: (value: T, index: number) => Promise<void>,
) {
  let next = 0;
  await all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const i = next++;
        await fn(values[i], i);
      }
    }),
  );
}
async function all<const T extends readonly unknown[]>(
  promises: T,
): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  const results = await Promise.allSettled(promises);
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) {
    throw failed.reason;
  }

  return Promise.all(promises);
}
export async function updateData({ force = false } = {}) {
  const parent = path.dirname(root);
  const lock = path.join(parent, '.data-update-lock');
  await mkdir(lock); // A second updater must not publish over the first.
  const stage = path.join(parent, `.data-staging-${process.pid}`);
  try {
    await recoverData(root);
    const version = await latestDataVersion();
    const old = await readFile(path.join(root, 'manifest.json'), 'utf8')
      .then((text) => manifestSchema.parse(JSON.parse(text)))
      .catch(() => null);
    if (!force && old?.version === version) {
      console.log(`Already on ${version}`);

      return;
    }
    const patch = version.split('.').slice(0, 2).join('.');
    const dd = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US`;
    // en_US is named "default" in CommunityDragon. Never silently mix in /latest.
    const cd = `https://raw.communitydragon.org/${patch}/plugins/rcp-be-lol-game-data/global/default/v1`;
    await mkdir(path.join(stage, 'raw', 'champions'), { recursive: true });
    const sources: { url: string; file: string; sha256: string }[] = [];
    async function get<T>(url: string, name: string, schema: z.ZodType<T>): Promise<T> {
      const value = await fetchJson(url);
      const bytes = JSON.stringify(value);
      await writeFile(path.join(stage, 'raw', name), bytes);
      sources.push({ url, file: `raw/${name}`, sha256: digest(bytes) });

      return schema.parse(value);
    }
    const [
      index,
      ddItems,
      summoners,
      runes,
      maps,
      languages,
      cdItems,
      perks,
      perkStyles,
      gameItems,
    ] = await all([
      get(`${dd}/champion.json`, 'champions.json', championIndexSchema),
      get(`${dd}/item.json`, 'items.json', itemsFileSchema),
      get(`${dd}/summoner.json`, 'summoners.json', summonersFileSchema),
      get(`${dd}/runesReforged.json`, 'runes.json', runesFileSchema),
      get(`${dd}/map.json`, 'maps.json', z.object({ data: z.record(z.string(), z.unknown()) })),
      get(
        'https://ddragon.leagueoflegends.com/cdn/languages.json',
        'languages.json',
        z.array(z.string()),
      ),
      get(`${cd}/items.json`, 'client-items.json', z.array(itemSourceSchema)),
      get(`${cd}/perks.json`, 'perks.json', z.array(perkSchema)),
      get(`${cd}/perkstyles.json`, 'perkstyles.json', perkStylesSchema),
      get(
        `https://raw.communitydragon.org/${patch}/game/items.cdtb.bin.json`,
        'game-items.json',
        z.record(z.string(), z.unknown()),
      ),
    ]);
    const champions: Champion[] = [];
    await pool(Object.values(index.data), 6, async (c) => {
      const [detail, source, gameData] = await all([
        get(`${dd}/champion/${c.id}.json`, `champions/${c.id}.json`, championDetailSchema),
        get(`${cd}/champions/${c.key}.json`, `champions/${c.id}.client.json`, championSourceSchema),
        get(
          `https://raw.communitydragon.org/${patch}/game/data/characters/${c.id.toLowerCase()}/${c.id.toLowerCase()}.bin.json`,
          `champions/${c.id}.game.json`,
          z.record(z.string(), z.unknown()),
        ),
      ]);
      const d = required(detail.data[c.id]);
      if (source.id !== Number(c.key)) {
        throw new Error(`Champion source mismatch: ${c.id}`);
      }
      champions.push({
        ...d,
        alias: d.id,
        id: Number(d.key),
        source,
        progression: extractSkillProgression(d.spells, gameData),
      });
    });
    champions.sort((a, b) => a.id - b.id);
    const cdIndex = new Map(cdItems.map((i) => [i.id, i]));
    const itemRules = extractItemRules(gameItems);
    const catalog = validateCatalog({
      version,
      patch,
      locale: 'en_US',
      champions,
      items: Object.entries(ddItems.data).map(([id, item]) => ({
        ...item,
        id: Number(id),
        source: cdIndex.get(Number(id)) ?? null,
        rules: itemRules.get(Number(id)) ?? null,
      })),
      summoners: Object.values(summoners.data).map((s) => ({
        ...s,
        alias: s.id,
        id: Number(s.key),
      })),
      runeStyles: runes.map((style) => ({
        ...style,
        slots: style.slots.map((slot) => ({ perks: slot.runes.map((r) => r.id) })),
      })),
      perks,
      perkStyles,
      maps: maps.data,
      languages,
    });
    const bytes = JSON.stringify(catalog);
    await writeFile(path.join(stage, 'catalog.json'), bytes);
    sources.sort((a, b) => a.file.localeCompare(b.file));
    const manifest = {
      version,
      patch,
      locale: 'en_US',
      fetchedAt: new Date().toISOString(),
      catalogSha256: digest(bytes),
      sources,
      counts: {
        champions: champions.length,
        items: catalog.items.length,
        perks: perks.length,
        summoners: catalog.summoners.length,
      },
    };
    await writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await publishData(root, stage);
    console.log(`Published ${version}: ${JSON.stringify(manifest.counts)}`);
  } finally {
    try {
      await removeDataStage(root, stage);
    } finally {
      await rmdir(lock);
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await updateData({ force: process.argv.includes('--force') });
}
