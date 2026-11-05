const labels: Record<string, string> = {
  SpellDamage: 'Ability power',
  Damage: 'Attack damage',
  CooldownReduction: 'Ability haste',
  AbilityHaste: 'Ability haste',
  SpellBlock: 'Magic resistance',
  MagicResist: 'Magic resistance',
  CriticalStrike: 'Critical strike chance',
  GoldPer: 'Gold generation',
  NonbootsMovement: 'Movement speed',
  HealthRegen: 'Health regeneration',
  ManaRegen: 'Mana regeneration',
  SpellVamp: 'Spell vamp',
  LifeSteal: 'Life steal',
  OnHit: 'On-hit effects',
  Lane: 'Lane starter',
};

export function categoryLabel(key: string): string {
  return labels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Some catalog tags are aliases for the same player-facing category. */
export function itemCategories(keys: readonly string[]): string[] {
  return [...new Set(keys.map(categoryLabel))].sort((a, b) => a.localeCompare(b));
}
