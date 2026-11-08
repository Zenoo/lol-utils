import type { ImportPart, SourceBuild } from './types.js';

export const buildSources = ['Local', 'OP.GG', 'LoLalytics', 'LOLValue', 'MetaBot'] as const;
export type BuildSource = (typeof buildSources)[number];
export const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;
export const roleLabels: Record<string, string> = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'Bot',
  UTILITY: 'Support',
};

export function importableParts(build: SourceBuild): ImportPart[] {
  return [
    'items' as const,
    ...(build.runes ? ['runes' as const] : []),
    ...(build.summoners ? ['summoners' as const] : []),
  ];
}

/** Group identical loadouts, retaining every source record for attribution/imports.
 * Inventory order and Flash's D/F position do not make a different loadout.
 * Shard slots and early components remain significant even when not shown in a row.
 */
export function groupBuilds(builds: readonly SourceBuild[]): SourceBuild[][] {
  const groups = new Map<string, SourceBuild[]>();
  for (const build of builds) {
    const runes = build.runes;
    const key = JSON.stringify({
      champion: build.championId,
      role: build.role,
      patch: build.patch,
      items: [...build.items].sort((a, b) => a - b),
      mainItems: [...(build.mainItems ?? build.items)].sort((a, b) => a - b),
      runes: runes
        ? [
            runes.primaryStyleId,
            runes.subStyleId,
            ...runes.selectedPerkIds.slice(0, 4),
            ...runes.selectedPerkIds.slice(4, 6).sort((a, b) => a - b),
            ...runes.selectedPerkIds.slice(6),
          ]
        : null,
      summoners: build.summoners
        ? [build.summoners.spell1Id, build.summoners.spell2Id].sort((a, b) => a - b)
        : null,
    });
    const group = groups.get(key);
    if (group) {
      group.push(build);
    } else {
      groups.set(key, [build]);
    }
  }

  return [...groups.values()];
}
