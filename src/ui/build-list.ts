import type { AppData, SourceBuild } from '../core/types.js';
import { roles, roleLabels } from '../core/builds.js';

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
const sourceIcons: Record<string, string> = {
  Local: 'local.svg',
  'OP.GG': 'opgg.ico',
  LoLalytics: 'lolalytics.ico',
  LOLValue: 'lolvalue.ico',
  MetaBot: 'metabot.ico',
};
export function sourceIcon(source: string) {
  return `<img class="source-icon" src="assets/sources/${sourceIcons[source] ?? 'local.svg'}" alt="${escape(source)}" width="28" height="28" />`;
}
export function rolePicker(role: string) {
  return `<div class="role-picker" role="group" aria-label="Role">${roles.map((value) => `<button type="button" data-role="${value}" aria-label="${roleLabels[value]}" aria-pressed="${value === role}" title="${roleLabels[value]}"><img src="assets/roles/${value.toLowerCase()}.svg" width="24" height="24" alt="" /><span>${roleLabels[value]}</span></button>`).join('')}</div>`;
}
function asset(id: number | undefined, name: string | undefined, url = '', kind: string) {
  if (!id) {
    return `<span class="build-asset unspecified" data-asset-kind="${kind}" tabindex="0" role="img" aria-label="Not supplied by this source" data-tooltip-title="Not supplied by this source" data-tooltip-description="This source did not provide this slot. It is left empty rather than filled with a local recommendation."><span aria-hidden="true">·</span></span>`;
  }
  const detailKind = { item: 'items', rune: 'runes', summoner: 'summoners' }[kind];

  return `<button type="button" class="build-asset" data-asset-kind="${kind}" data-kind="${detailKind}" data-id="${id}" aria-label="${escape(name ?? id)}"><span aria-hidden="true">${escape(name?.slice(0, 2) ?? '?')}</span>${url ? `<img src="${escape(url)}" alt="" loading="lazy" />` : ''}</button>`;
}
export function buildRow(
  build: SourceBuild,
  data: AppData,
  selected: boolean,
  members: readonly SourceBuild[] = [build],
) {
  const image = (group: string, file?: string) =>
    file
      ? `https://ddragon.leagueoflegends.com/cdn/${data.manifest.version}/img/${group}/${encodeURIComponent(file)}`
      : '';
  const ids = (
    build.mainItems ??
    build.items.filter((id) => {
      const item = data.items.find((entry) => entry.id === id);

      return item?.tier === 5 || item?.tags.includes('Boots');
    })
  ).slice(0, 6);
  const items = Array.from({ length: 6 }, (_, index) => {
    const id = ids[index],
      item = data.items.find((entry) => entry.id === id);

    return asset(id, item?.name, image('item', item?.image.full), 'item');
  }).join('');
  const perks = data.runes.flatMap((style) => style.slots.flatMap((slot) => slot.runes));
  const runes = Array.from({ length: 6 }, (_, index) => {
    const id = build.runes?.selectedPerkIds[index],
      perk = perks.find((entry) => entry.id === id);
    const path = typeof perk?.iconPath === 'string' ? perk.iconPath : '';
    const url = path.startsWith('/lol-game-data/assets/')
      ? `https://raw.communitydragon.org/${data.manifest.patch}/plugins/rcp-be-lol-game-data/global/default/${path.slice('/lol-game-data/assets/'.length).toLowerCase()}`
      : '';

    return asset(id, perk?.name, url, 'rune');
  }).join('');
  const spells = [build.summoners?.spell1Id, build.summoners?.spell2Id]
    .map((id) => {
      const spell = data.summoners.find((entry) => entry.id === id);

      return asset(id, spell?.name, image('spell', spell?.image.full), 'summoner');
    })
    .join('');

  const sources = [...new Set(members.map((entry) => entry.provider))];
  const more = sources.filter((source) => source !== build.provider);
  const attribution = members
    .map(
      (entry) =>
        `${entry.provider}: ${entry.population ?? entry.label}${entry.url ? ` — ${entry.url}` : ''}`,
    )
    .join('\n');

  return `<div class="build-choice" data-build-id="${escape(build.id)}" data-selected="${selected}">
    <button type="button" class="build-select" aria-pressed="${selected}" aria-label="${escape(`${build.provider}: ${build.label}${more.length ? `; also available from ${more.join(', ')}` : ''}`)}"></button>
    <span class="build-source"><span class="build-provider" tabindex="0" role="img" aria-label="${escape(sources.join(', '))}" data-tooltip-title="${escape(sources.join(' / '))}" data-tooltip-description="${escape(attribution)}">${sourceIcon(build.provider)}</span><span><strong>${escape(build.provider)}</strong><small>${escape(build.label)}${more.length ? ` · +${more.length} source${more.length === 1 ? '' : 's'}` : ''}</small></span></span>
    <span class="build-items" aria-label="Six main item slots">${items}</span>
    <span class="build-runes" aria-label="Main runes">${runes}</span>
    <span class="build-summoners" aria-label="Summoner spells">${spells}</span>
  </div>`;
}
