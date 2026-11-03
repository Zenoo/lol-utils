import type { Item, Player } from './types.js';

export type QuestKind = 'jungle' | 'support';
export interface ItemEligibility {
  role?: string;
  owned?: number[];
  spells?: string[];
  planning?: boolean;
}

/** Tags alone are insufficient: ordinary items can also grant incidental gold. */
export function questKind(item: Item): QuestKind | undefined {
  if (
    item.tags.includes('Jungle') &&
    item.rules?.requiredSpell === 'SummonerSmite' &&
    (item.rules.values.TotalCounters ?? 0) > 0
  ) {
    return 'jungle';
  }
  if (
    item.rules?.groups.includes('Items/ItemGroups/GoldItems') &&
    ((item.rules.values.QuestGoldRequirement ?? 0) > 0 ||
      (item.tags.includes('GoldPer') && item.rules.groups.includes('Items/ItemGroups/WardItems')))
  ) {
    return 'support';
  }

  return undefined;
}

export function playerSpellNames(player: Player): string[] | undefined {
  if (!player.summonerSpells) {
    return undefined;
  }

  return Object.values(player.summonerSpells).map((spell) =>
    (spell.rawDisplayName ?? spell.displayName ?? '')
      .replace(/^GeneratedTip_SummonerSpell_/, '')
      .replace(/_DisplayName$/, ''),
  );
}

export function roleItemAllowed(item: Item, context: ItemEligibility): boolean {
  const role = context.role?.toUpperCase();
  const kind = questKind(item);
  if (kind === 'jungle' && role !== 'JUNGLE') {
    return false;
  }
  if (kind === 'support' && role !== 'UTILITY') {
    return false;
  }
  if (item.tags.includes('Jungle') && kind !== 'jungle' && !item.tags.includes('Consumable')) {
    return false;
  }
  const requiredSpell = item.rules?.requiredSpell;
  if (requiredSpell) {
    if (context.spells) {
      return context.spells.some((spell) => spell.includes(requiredSpell));
    }
    if (!(kind === 'jungle' && role === 'JUNGLE')) {
      return false;
    }
  }
  if (item.source?.requiredBuffCurrencyName) {
    if (kind !== 'support') {
      return false;
    }
    // The assigned support receives the initial purchase permission. Reward choices require
    // the actual completed parent item in live games; pregame plans label them as conditional.
    if (
      item.rules?.tier !== 1 &&
      !context.planning &&
      !item.from?.some((id) => context.owned?.includes(Number(id)))
    ) {
      return false;
    }
  }

  return true;
}
