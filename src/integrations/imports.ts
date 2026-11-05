import type { Engine } from '../core/engine.js';
import type { Champion, Raw, Settings, LiveGame } from '../core/types.js';
import type { LocalApi } from './local-api.js';
import { questKind } from '../core/role-items.js';
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
) {
  const page = engine.runes(champ, role);
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
) {
  const available = spellInventorySchema.parse(
    await api.request('GET', `/lol-collections/v1/inventories/${summonerId}/spells`),
  );
  const ids: number[] = available.spells;
  const pair = engine.summoners(champ, role, settings.flashSlot, mode, level, ids);
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
) {
  if (map !== 11) {
    throw new Error('Item generation currently supports Summoner’s Rift only');
  }
  const endpoint = `/lol-item-sets/v1/item-sets/${summonerId}/sets`;
  const existing = itemSetsSchema.parse(await api.request('GET', endpoint));
  const build = engine.buildPlan(champ, map, role, game);
  const set = {
    uid: `lol-utils-${champ.id}-${map}`,
    title: `LoL Utils · ${champ.name} · ${engine.catalog.version}`,
    type: 'custom',
    map: 'SR',
    mode: 'any',
    sortrank: 0,
    associatedChampions: [champ.id],
    associatedMaps: [map],
    preferredItemSlots: [],
    blocks: [
      ...engine.starters(champ, Infinity, role).map(({ item, reasons }) => ({
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
