import type { Engine } from '../core/engine.js';
import type { Champion, Raw, Settings, LiveGame } from '../core/types.js';
import type { LocalApi } from './local-api.js';
import { questKind } from '../core/role-items.js';
import { publicPatch } from '../core/versions.js';
import {
  itemSetsSchema,
  itemSetSchema,
  runePagesSchema,
  spellInventorySchema,
} from '../core/schema.js';

export function mergeItemSets(existing: Raw, itemSet: Raw): Raw {
  const parsed = itemSetsSchema.parse(existing);
  const parsedSet = itemSetSchema.parse(itemSet);

  return {
    ...existing,
    itemSets: [...parsed.itemSets.filter((s) => s.uid !== parsedSet.uid), parsedSet],
  };
}
export async function importRunes(
  api: Pick<LocalApi, 'request'>,
  engine: Engine,
  champ: Champion,
  role = '',
  sourcePage?: ReturnType<Engine['runes']>,
) {
  const page = sourcePage ?? engine.runes(champ, role);
  const pages = runePagesSchema.parse(await api.request('GET', '/lol-perks/v1/pages'));
  const owned = pages.find((p) => p.name?.startsWith('LoL Utils · ') && p.isEditable);
  if (owned) {
    await api.request('PUT', `/lol-perks/v1/pages/${owned.id}`, { ...page, id: owned.id });
  } else {
    await api.request('POST', '/lol-perks/v1/pages', page);
  }
}
export async function importSummoners(
  api: Pick<LocalApi, 'request'>,
  engine: Engine,
  champ: Champion,
  settings: Settings,
  role: string,
  mode: string,
  level: number,
  summonerId: number,
  sourcePair?: { spell1Id: number; spell2Id: number },
) {
  const available = spellInventorySchema.parse(
    await api.request('GET', `/lol-collections/v1/inventories/${summonerId}/spells`),
  );
  const ids: number[] = available.spells;
  let pair = sourcePair ?? engine.summoners(champ, role, settings.flashSlot, mode, level, ids);
  if (sourcePair) {
    for (const id of [pair.spell1Id, pair.spell2Id]) {
      const spell = engine.catalog.summoners.find((s) => s.id === id);
      if (
        !spell ||
        !ids.includes(id) ||
        !spell.modes.includes(mode) ||
        spell.summonerLevel > level
      ) {
        throw new Error('Source summoner spell is unavailable for this account or mode');
      }
    }
    const flash = engine.catalog.summoners.find((s) => s.alias === 'SummonerFlash')?.id;
    if (
      (settings.flashSlot === 'D' && pair.spell2Id === flash) ||
      (settings.flashSlot === 'F' && pair.spell1Id === flash)
    ) {
      pair = { spell1Id: pair.spell2Id, spell2Id: pair.spell1Id };
    }
  }
  await api.request('PATCH', '/lol-champ-select/v1/session/my-selection', pair);
}
export async function importItems(
  api: Pick<LocalApi, 'request'>,
  engine: Engine,
  champ: Champion,
  summonerId: number,
  map: number,
  role = '',
  game?: LiveGame,
  source?: { items: number[]; label: string; patch: string; itemOrder?: 'purchase' | 'inventory' },
) {
  if (map !== 11) {
    throw new Error('Item generation currently supports Summoner’s Rift only');
  }
  const endpoint = `/lol-item-sets/v1/item-sets/${summonerId}/sets`;
  const existing = itemSetsSchema.parse(await api.request('GET', endpoint));
  const build = source ? [] : engine.buildPlan(champ, map, role, game);
  const set = {
    uid: `lol-utils-${champ.id}-${map}`,
    title: `LoL Utils · ${champ.name} · ${source ? `${source.label} · ${publicPatch(source.patch)}` : publicPatch(engine.catalog.version)}`,
    type: 'custom',
    map: 'SR',
    mode: 'any',
    sortrank: 0,
    associatedChampions: [champ.id],
    associatedMaps: [map],
    preferredItemSlots: [],
    blocks: [
      ...(source
        ? [
            {
              type: `${source.label} · ${source.itemOrder === 'inventory' ? 'inventory core (purchase order unknown)' : 'source core order (components included)'}`,
              items: source.items.map((id) => ({ id: String(id), count: 1 })),
            },
          ]
        : []),
      ...(source ? [] : engine.starters(champ, Infinity, role)).map(({ item, reasons }) => ({
        type: `Starter alternative: ${item.name} - ${reasons.at(-1) ?? 'Early lane resources'}`,
        items: [{ id: String(item.id), count: 1 }],
      })),
      ...build.map(({ item, reasons }, i) => ({
        type: `${questKind(item) === 'support' ? 'After support quest completion' : i + 1}. ${item.name} - ${reasons.at(-1) ?? 'Fits the champion and enemy team'}`,
        items: [{ id: String(item.id), count: 1 }],
      })),
    ],
  };
  await api.request('PUT', endpoint, mergeItemSets(existing, set));
}
