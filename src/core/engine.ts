import { required } from './assert.js';
import { progressionFor } from './skill-progression.js';
import { questKind, roleItemAllowed, playerSpellNames } from './role-items.js';
import type { ItemEligibility } from './role-items.js';
import type {
  Catalog,
  Champion,
  Item,
  LiveGame,
  Perk,
  Player,
  SummonerSpell,
  Recommendation,
  SkillSuggestion,
} from './types.js';

export const plain = (text = '') =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
export function profile(c: Champion, role = '') {
  const tactical = c.source.tacticalInfo;
  const play = c.source.playstyleInfo;
  const text = plain(
    c.spells.map((s) => s.tooltip + s.description).join(' ') + c.passive.description,
  ).toLowerCase();
  const magic =
    tactical.damageType === 'kMagic' ? 0.9 : tactical.damageType === 'kPhysical' ? 0.1 : 0.5;
  const empoweredAttacks =
    /next\s+(?:\{\{[^}]+\}\}\s+|\w+\s+)?attacks?[^.]*?(?:damage|slashes)|attacks?[^.]*?(?:additional|bonus)[^.]*damage/i.test(
      text,
    );
  const attacks = Math.max(1 - clamp((tactical.style ?? 5) / 10), empoweredAttacks ? 0.85 : 0);
  // A secondary support tag must not turn every mid-lane mage into an enchanter.
  let support = c.source.roles[0] === 'support' ? play.utility / 3 : 0;
  if (role) {
    support = role.toUpperCase() === 'UTILITY' ? play.utility / 3 : 0;
  }

  return {
    magic,
    attacks,
    empoweredAttacks,
    melee: tactical.attackType === 'melee',
    taunt: /taunt/.test(text),
    sustain: /\bheal(?:s|ing|ed)?\b|restor[^.]*health/.test(text) ? 1 : 0,
    tank: (play.durability ?? 1) / 3,
    support,
    cc: (play.crowdControl ?? 1) / 3,
    mobility: (play.mobility ?? 1) / 3,
    mana: c.partype.toLowerCase() === 'mana',
    heal: /heal|shield/.test(text) ? 1 : 0,
    burst: c.source.championTagInfo?.championTagPrimary === 'Burst' ? 1 : 1 - attacks,
    text,
  };
}
export function championFor(catalog: Catalog, player: Player): Champion | undefined {
  const alias = player.rawChampionName?.replace('game_character_displayname_', '');

  return catalog.champions.find(
    (c) => c.alias === alias || c.name === player.championName || c.alias === player.championName,
  );
}
export function activePlayer(game: LiveGame): Player | undefined {
  const id = game.activePlayer.riotId ?? game.activePlayer.summonerName;

  return game.allPlayers.find((p) => (p.riotId ?? p.summonerName) === id);
}
export function growth(base: number, perLevel: number, level: number) {
  const n = clamp(level, 1, 18) - 1;

  return base + perLevel * (0.7025 * n + 0.0175 * n * n);
}
export function itemStats(item: Item): Record<string, number> {
  const stats = { ...item.stats, ...item.rules?.stats };
  const aliases: Record<string, string> = {
    AbilityHasteMod: 'AbilityHaste',
    FlatMagicPenetrationMod: 'MagicPen',
    FlatPhysicalPenetrationMod: 'Lethality',
  };
  for (const [from, to] of Object.entries(aliases)) {
    if (stats[from] !== undefined) {
      stats[to] = stats[from];
      delete stats[from];
    }
  }
  const text = plain(item.description.match(/<stats>([\s\S]*?)<\/stats>/i)?.[1] ?? '');
  // Data Dragon omits newer stats; read their labelled values from the official stat block.
  const labels: Record<string, string> = {
    'Ability Haste': 'AbilityHaste',
    Lethality: 'Lethality',
    'Magic Penetration': 'MagicPen',
    'Heal and Shield Power': 'HealShieldPower',
    'Base Mana Regen': 'ManaRegen',
  };
  for (const [label, key] of Object.entries(labels)) {
    const m = text.match(new RegExp(`([\\d.]+)(%)?\\s+${label}`, 'i'));
    if (m) {
      stats[key] = Number(m[1]) / (m[2] ? 100 : 1);
    }
  }

  return stats;
}
export function eligible(
  item: Item,
  champ: Champion,
  map = 11,
  context: ItemEligibility = {},
): boolean {
  const source = item.source;

  return Boolean(
    item.gold.purchasable &&
    item.rules &&
    (item.rules.tier ?? 0) <= 5 &&
    !item.rules.groups.some((group) =>
      /Arena|Prismatic|GuardianItems|Kiwi|SLIME|Strawberry|Siege|Odyssey/.test(group),
    ) &&
    !Object.values(item.rules.limits).some((limit) => limit === 0) &&
    item.gold.total > 0 &&
    item.maps[String(map)] &&
    source?.inStore &&
    source.displayInItemSets !== false &&
    (!source.requiredChampion || source.requiredChampion === champ.alias) &&
    !source.requiredAlly &&
    roleItemAllowed(item, context) &&
    !source.specialRecipe &&
    !item.consumed &&
    !item.tags.includes('Trinket') &&
    !item.tags.includes('Consumable') &&
    !item.into?.some((id) => Number(id) === item.id),
  );
}
/** Multiset recipe expansion consumes each owned component at most once. */
export function purchase(item: Item, owned: number[], items: Map<number, Item>) {
  const bag = new Map<number, number>();
  for (const id of owned) {
    bag.set(id, (bag.get(id) ?? 0) + 1);
  }
  const consumed: number[] = [];
  function visit(current: Item, seen = new Set<number>()): number {
    if ((bag.get(current.id) ?? 0) > 0) {
      bag.set(current.id, required(bag.get(current.id)) - 1);
      consumed.push(current.id);

      return 0;
    }
    if (seen.has(current.id)) {
      throw new Error('Recipe cycle');
    }
    const next = new Set(seen).add(current.id);
    if (!current.from?.length) {
      return current.gold.total;
    }
    let cost = current.gold.base;
    for (const id of current.from) {
      const component = items.get(Number(id));
      if (!component) {
        return current.gold.total;
      } // Fail conservatively if upstream is incomplete.
      cost += visit(component, next);
    }

    return cost;
  }

  return { cost: Math.max(0, visit(item)), consumed };
}

export class Engine {
  readonly items: Map<number, Item>;
  readonly stats = new Map<number, Record<string, number>>();
  readonly prices = new Map<string, number>();
  constructor(readonly catalog: Catalog) {
    this.items = new Map(catalog.items.map((i) => [i.id, i]));
    for (const i of catalog.items) {
      this.stats.set(i.id, itemStats(i));
    }
    const samples = new Map<string, number[]>();
    for (const i of catalog.items) {
      if (
        !i.maps['11'] ||
        !i.gold.purchasable ||
        i.from?.length ||
        i.gold.total <= 0 ||
        !i.into?.length ||
        i.tags.some((t) => ['Consumable', 'Trinket', 'Jungle', 'GoldPer'].includes(t))
      ) {
        continue;
      }
      const entries = Object.entries(required(this.stats.get(i.id))).filter(([, v]) => v > 0);
      if (entries.length === 1) {
        const [key, value] = entries[0];
        samples.set(key, [...(samples.get(key) ?? []), i.gold.total / value]);
      }
    }
    for (const [key, values] of samples) {
      this.prices.set(key, values.sort((a, b) => a - b)[Math.floor(values.length / 2)]);
    }
  }
  context(champ: Champion, game?: LiveGame, role = '', laneWeight = 1) {
    const me = game && activePlayer(game);
    const p = profile(champ, role || me?.position || '');
    const enemies = game && me ? game.allPlayers.filter((x) => x.team !== me.team) : [];
    const lane = (role || me?.position || '').toUpperCase();
    const laner = ['TOP', 'MIDDLE', 'BOTTOM'].includes(lane)
      ? enemies.find((enemy) => enemy.position?.toUpperCase() === lane)
      : undefined;
    const laneChampion = laner && championFor(this.catalog, laner);
    const laneProfile = laneChampion && profile(laneChampion);
    let physical = 0,
      magical = 0,
      armor = 0,
      mr = 0,
      healing = 0,
      cc = 0,
      total = 0;
    for (const enemy of enemies) {
      const c = championFor(this.catalog, enemy);
      if (!c) {
        continue;
      }
      const ep = profile(c);
      const inventory = enemy.items.flatMap((i) => Array(Math.min(6, i.count || 1)).fill(i.itemID));
      const isLaner =
        ['TOP', 'MIDDLE', 'BOTTOM'].includes(lane) && enemy.position?.toUpperCase() === lane;
      const weight =
        (isLaner ? 1 + laneWeight * 4 : 1) *
        (1 +
          Math.max(
            0,
            enemy.scores.kills + enemy.scores.assists * 0.35 - enemy.scores.deaths * 0.3,
          ) /
            5 +
          sum(inventory.map((id) => this.items.get(id)?.gold.total ?? 0)) / 10000);
      total += weight;
      physical += (1 - ep.magic) * weight;
      magical += ep.magic * weight;
      armor +=
        (growth(c.stats.armor, c.stats.armorperlevel, enemy.level) +
          sum(inventory.map((id) => this.stats.get(id)?.FlatArmorMod ?? 0))) *
        weight;
      mr +=
        (growth(c.stats.spellblock, c.stats.spellblockperlevel, enemy.level) +
          sum(inventory.map((id) => this.stats.get(id)?.FlatSpellBlockMod ?? 0))) *
        weight;
      healing +=
        (ep.sustain +
          Number(
            inventory.some((id) =>
              /LifeSteal|SpellVamp/.test(Object.keys(this.stats.get(id) ?? {}).join(' ')),
            ),
          )) *
        weight;
      cc += ep.cc * weight;
    }
    const allies = game && me ? game.allPlayers.filter((x) => x.team === me.team && x !== me) : [];
    const allyMagic = allies.flatMap((x) => {
      const c = championFor(this.catalog, x);

      return c ? [profile(c).magic] : [];
    });
    const allyCarry = allies.length
      ? Math.max(
          ...allies.map(
            (ally) =>
              1 +
              Math.max(
                0,
                ally.scores.kills + ally.scores.assists * 0.35 - ally.scores.deaths * 0.3,
              ) /
                5 +
              sum(ally.items.map((item) => this.items.get(item.itemID)?.gold.total ?? 0)) / 10000,
          ),
        )
      : 1;
    const allyItems = new Set(allies.flatMap((ally) => ally.items.map((item) => item.itemID)));

    return {
      ...p,
      lanePhysical: laneProfile ? (1 - laneProfile.magic) * laneWeight : 0,
      laneSustain: laneProfile ? laneProfile.sustain * laneWeight : 0,
      laneName: laneChampion?.name,
      physical: total ? physical / total : 0.5,
      magical: total ? magical / total : 0.5,
      enemyArmor: total ? armor / total : 40,
      enemyMr: total ? mr / total : 35,
      healing: total ? healing / total : 0,
      enemyCc: total ? cc / total : 0.5,
      teamMagic: allyMagic.length ? sum(allyMagic) / allyMagic.length : 0.5,
      allyCarry,
      allyItems,
      me,
    };
  }
  scoreItem(
    item: Item,
    champ: Champion,
    game?: LiveGame,
    context = this.context(champ, game),
    projectedStats: Record<string, number | string> = {},
  ): { score: number; reasons: string[] } {
    const p = context,
      stats = required(this.stats.get(item.id));
    const ownStats = game?.activePlayer.championStats ?? projectedStats;
    const weights: Record<string, number> = {
      FlatMagicDamageMod:
        p.magic * (1.2 - p.attacks * 0.3) * (1 - p.tank * 0.55) * (1.25 - p.teamMagic * 0.5),
      FlatPhysicalDamageMod:
        (1 - p.magic) * (0.7 + p.attacks) * (1 - p.tank * 0.4) * (0.75 + p.teamMagic * 0.5),
      PercentAttackSpeedMod:
        p.attacks *
        (1.2 - p.magic * 0.3) *
        Math.max(
          1,
          Number(ownStats.attackDamage ?? champ.stats.attackdamage) /
            Math.max(1, champ.stats.attackdamage),
        ),
      FlatCritChanceMod: p.attacks * (1 - p.magic) * (1 - p.tank * 0.8),
      FlatHPPoolMod: 0.25 + p.tank * 0.65,
      FlatArmorMod: (0.3 + p.tank) * p.physical,
      FlatSpellBlockMod: (0.3 + p.tank) * p.magical,
      FlatMPPoolMod: p.mana
        ? (0.4 + p.magic * 0.3) /
          (1 + Number(ownStats.resourceMax ?? champ.stats.mp) / Math.max(1, champ.stats.mp))
        : 0,
      PercentLifeStealMod: p.attacks * 0.8,
      FlatMovementSpeedMod: 0.6,
      PercentMovementSpeedMod: 0.6,
      AbilityHaste:
        (1 - p.attacks * 0.6) *
        (1 - Number(ownStats.abilityHaste ?? 0) / (100 + Number(ownStats.abilityHaste ?? 0))),
      Lethality: (1 - p.magic) * (1 - p.attacks * 0.5),
      MagicPen: p.magic,
      HealShieldPower: p.heal * p.support * clamp(p.allyCarry, 1, 2),
      ManaRegen: p.mana ? p.support * 0.8 : 0,
      FlatHPRegenMod: 0.15 + p.tank * 0.2,
      PercentBaseHPRegenMod: 0.1 + p.tank * 0.2,
      PercentBaseMPRegenMod: p.mana ? p.support * 0.8 : 0,
    };
    const contributions: [string, number][] = [];
    for (const [key, value] of Object.entries(stats)) {
      // Unpriced stats use labelled magnitude, marked as a model assumption in the UI.
      const reference =
        this.prices.get(key) ??
        (key.includes('Percent') || key === 'HealShieldPower' || key === 'ManaRegen' ? 1000 : 25);
      contributions.push([key, Math.max(0, value) * reference * (weights[key] ?? 0)]);
    }
    let value = sum(contributions.map(([, n]) => n));
    const text = plain(item.description).toLowerCase();
    const reasons = contributions
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([key]) => `${key.replace(/Mod$|Flat|Percent/g, '')} suits champion profile`);
    const kind = questKind(item);
    const effects = item.rules?.values ?? {};
    if (kind === 'jungle') {
      const damage = (effects.AvatarMaxHPBurnTotal ?? 0) * (1 + p.burst);
      const slow = (effects.AvatarSlowAmount ?? 0) * (1 - p.cc * 0.5);
      const speed = (effects.AvatarCampMoveSpeed ?? 0) * (1 - p.mobility * 0.5);
      const shield = /shield/.test(text) ? 0.3 * (1 + (1 - p.tank)) : 0;
      value += item.gold.total * (1 + damage + slow + speed + shield);
      reasons.push('Jungle companion assists clearing and advances the Smite quest');
      if (damage || slow) {
        reasons.push('After quest completion: published burn and slow bonuses');
      }
      if (speed) {
        reasons.push('After quest completion: published movement-speed bonus');
      }
      if (shield) {
        reasons.push('After quest completion: protective shield; amount not exposed in item data');
      }
    }
    if (kind === 'support') {
      // Income is valued over a common two-minute comparison horizon, rather than treated as AP.
      value += (effects.GP10 ?? 0) * 12;
      if (effects.GP10) {
        reasons.push(`${effects.GP10} gold per 10 seconds`);
      }
      if (effects.StealthWardCap) {
        value += item.gold.total * 0.2;
        reasons.push(`Vision: ${effects.StealthWardCap} ward charges`);
      }
      if (/healing or shielding another ally/i.test(text) && p.heal) {
        value += item.gold.total * p.support * 0.8;
      }
      if (/slowing|immobilizing/i.test(text)) {
        value += item.gold.total * p.cc * 0.6;
      }
      if (/ability damage/i.test(text)) {
        value += item.gold.total * (1 - p.attacks) * (0.3 + (effects.APRatio ?? 0));
      }
      if (/spellblade/i.test(text)) {
        value += item.gold.total * p.attacks * (0.3 + (effects.SheenMult ?? 0) * 0.3);
      }
      if (/reduce|reduc|shield/i.test(text)) {
        value += item.gold.total * p.tank * 0.25;
      }
      reasons.push(
        item.rules?.tier === 1
          ? 'Support quest income; automatic upgrades improve regeneration and vision'
          : 'Support quest reward; purchase requires the completed quest item',
      );
    }
    if ((effects.GrievousAmount || /(?:grievous )?wounds/.test(text)) && p.healing > 0.3) {
      const reactive = /when struck by an attack/.test(text);
      const fit = reactive ? p.tank * (p.taunt ? 1.3 : 1) : 0.5 + p.attacks * 0.5;
      value += item.gold.total * p.healing * fit * 0.65;
      reasons.push(
        'Healing reduction against enemy sustain' +
          (reactive && p.taunt ? '; taunt forces attacks to trigger it' : ''),
      );
      if ((stats.FlatArmorMod ?? 0) > 0 && p.lanePhysical > 0.5 && p.laneSustain > 0) {
        value += item.gold.total * p.lanePhysical * p.laneSustain * fit;
        reasons.push(`Early armor and healing reduction against lane opponent ${p.laneName}`);
      }
    }
    if (/reduces incoming damage from attacks/.test(text)) {
      value += item.gold.total * p.physical * (0.5 + p.tank * 0.5);
      reasons.push('Attack damage reduction against physical threats');
    }
    if (/spellblade/.test(text) && p.empoweredAttacks) {
      value += item.gold.total * p.attacks * 0.5;
      reasons.push('Spellblade follows abilities that empower attacks');
      if (/on.hit effects an additional time/.test(text)) {
        value += item.gold.total * p.attacks * 0.45;
        reasons.push('Repeats on-hit effects from empowered attacks');
      }
    }
    if (effects.PrimaryTargetHPRatio && p.melee) {
      const health =
        Number(
          ownStats.maxHealth ??
            growth(champ.stats.hp, champ.stats.hpperlevel, game?.activePlayer.level ?? 11),
        ) + (stats.FlatHPPoolMod ?? 0);
      value +=
        health *
        effects.PrimaryTargetHPRatio *
        p.attacks *
        (this.prices.get('FlatPhysicalDamageMod') ?? 35);
      value += item.gold.total * p.attacks * p.tank * 0.4;
      reasons.push('Health-scaling attack damage and cleave for melee waveclear');
    }
    if (/armor penetration/.test(text)) {
      value += item.gold.total * (1 - p.magic) * clamp(p.enemyArmor / 180) * 0.3;
      reasons.push('Penetration against estimated armor');
    }
    if (/magic penetration/.test(text)) {
      value += item.gold.total * p.magic * clamp(p.enemyMr / 130) * 0.25;
      reasons.push('Penetration against estimated magic resistance');
    }
    if (/tenacity/.test(text)) {
      value += item.gold.total * p.enemyCc * 0.15;
      reasons.push('Tenacity against crowd control in enemy kits');
    }
    if (/on.hit|on hit/.test(text)) {
      value += item.gold.total * p.attacks * 0.15;
      reasons.push('On-hit effect fits attack frequency');
    }
    if (item.rules?.values.APAmp) {
      value +=
        Number(ownStats.abilityPower ?? 0) *
        (this.prices.get('FlatMagicDamageMod') ?? 20) *
        item.rules.values.APAmp *
        p.magic;
    }
    if (/heal|shield/.test(text) && p.support > 0.5) {
      value += item.gold.total * p.support * p.heal * 0.12 * clamp(p.allyCarry, 1, 2);
      reasons.push(
        p.allyCarry > 1.5 ? 'Protect a teammate with a strong observed lead' : 'Utility for allies',
      );
      if (p.allyItems.has(item.id) && /nearby.*allies|allies.*gain/.test(text)) {
        value *= 0.7;
        reasons.push('Overlapping allied aura discounted');
      }
    }
    if (p.physical > 0.65 && (stats.FlatArmorMod ?? 0) > 0) {
      reasons.push('Enemy threats lean physical');
    }
    if (p.magical > 0.65 && (stats.FlatSpellBlockMod ?? 0) > 0) {
      reasons.push('Enemy threats lean magic');
    }
    if (stats.FlatMPPoolMod && !p.mana) {
      value -= stats.FlatMPPoolMod * (this.prices.get('FlatMPPoolMod') ?? 1);
    }
    if (Number(ownStats.critChance ?? 0) >= 1 && stats.FlatCritChanceMod) {
      value -= stats.FlatCritChanceMod * (this.prices.get('FlatCritChanceMod') ?? 1000);
    }

    return { score: Math.max(0, value) / item.gold.total, reasons };
  }
  rank(
    champ: Champion,
    {
      game,
      owned = [],
      gold = Infinity,
      map = 11,
      limit = 3,
      completed = true,
      role = '',
      questOwned = owned,
      spells,
      planning = false,
      laneWeight = 1,
    }: {
      game?: LiveGame;
      owned?: number[];
      gold?: number;
      map?: number;
      limit?: number;
      completed?: boolean;
      role?: string;
      questOwned?: number[];
      spells?: string[];
      planning?: boolean;
      laneWeight?: number;
    } = {},
  ): Recommendation[] {
    const own = owned.map((id) => this.items.get(id)).filter((i): i is Item => Boolean(i));
    // Threat estimates are identical for every candidate in this ranking pass.
    const context = this.context(champ, game, role, laneWeight);
    const eligibility = { role: role || context.me?.position, owned: questOwned, spells, planning };
    const projectedStats: Record<string, number> = {
      resourceMax: champ.stats.mp,
      attackDamage: champ.stats.attackdamage,
    };
    const projectionKeys: Record<string, string> = {
      FlatMagicDamageMod: 'abilityPower',
      FlatPhysicalDamageMod: 'attackDamage',
      AbilityHaste: 'abilityHaste',
      FlatCritChanceMod: 'critChance',
      FlatMPPoolMod: 'resourceMax',
    };
    for (const item of own) {
      for (const [key, target] of Object.entries(projectionKeys)) {
        projectedStats[target] =
          (projectedStats[target] ?? 0) + (this.stats.get(item.id)?.[key] ?? 0);
      }
    }
    const ownPassives = new Set(
      own.flatMap((i) =>
        [...i.description.matchAll(/<passive>(.*?)<\/passive>/g)].map((m) => m[1].toLowerCase()),
      ),
    );
    const occupied = owned.length;
    // Quest currency items can live outside the ordinary six inventory slots. They still
    // contribute recipe credit and mutual-exclusion groups, but not occupied bag capacity.
    const groupOwned = [...owned, ...questOwned.filter((id) => !owned.includes(id))];
    const recipe = (item: Item) => purchase(item, questKind(item) ? groupOwned : owned, this.items);
    const bagConsumed = (consumed: number[]) => {
      const bag = [...owned];
      let count = 0;
      for (const id of consumed) {
        const index = bag.indexOf(id);
        if (index >= 0) {
          bag.splice(index, 1);
          count++;
        }
      }

      return count;
    };
    const extraSlot = (item: Item, consumed: number[]) =>
      questKind(item) === 'support' && consumed.length > 0 && bagConsumed(consumed) === 0 ? 0 : 1;

    return this.catalog.items
      .filter((i) => {
        if (!eligible(i, champ, map, eligibility) || owned.includes(i.id)) {
          return false;
        }
        // Completed progression excludes starter items and intermediate recipe parts.
        if (
          completed &&
          i.rules?.tier !== 5 &&
          !(i.tags.includes('Boots') && i.rules?.tier === 4)
        ) {
          return false;
        }
        const remaining = [...groupOwned];
        for (const id of recipe(i).consumed) {
          const index = remaining.indexOf(id);
          if (index >= 0) {
            remaining.splice(index, 1);
          }
        }
        for (const [group, limit] of Object.entries(i.rules?.limits ?? {})) {
          const count = remaining.filter((id) =>
            this.items.get(id)?.rules?.groups.includes(group),
          ).length;
          if (count >= limit) {
            return false;
          }
        }
        if (
          completed &&
          (i.into ?? []).some((id) => {
            const next = this.items.get(Number(id));

            return next && eligible(next, champ, map, eligibility);
          })
        ) {
          return false;
        }
        if (
          i.tags.includes('Boots') &&
          own.some((o) => o.tags.includes('Boots') && !(i.from ?? []).includes(String(o.id)))
        ) {
          return false;
        }
        const names = [...i.description.matchAll(/<passive>(.*?)<\/passive>/g)].map((m) =>
          m[1].toLowerCase(),
        );
        if (names.some((n) => ownPassives.has(n)) && !recipe(i).consumed.length) {
          return false;
        }

        const consumed = recipe(i).consumed;

        return occupied - bagConsumed(consumed) + extraSlot(i, consumed) <= 6;
      })
      .map((item) => {
        const { cost, consumed } = recipe(item);
        const scored = this.scoreItem(item, champ, game, context, projectedStats);

        return {
          item,
          ...scored,
          cost,
          affordable: cost <= gold,
          score: scored.score * (1 + Math.min(0.25, consumed.length * 0.08)),
        };
      })
      .sort((a, b) => b.score - a.score || a.item.id - b.item.id)
      .slice(0, limit);
  }
  nextBuys(
    champ: Champion,
    game: LiveGame,
    options: { role?: string; roleQuestPurchased?: boolean } = {},
  ): Recommendation[] {
    const me = activePlayer(game);
    if (!me || game.gameData.mapNumber !== 11 || game.gameData.gameMode !== 'CLASSIC') {
      return [];
    }
    const owned = me.items
      .filter((i) => i.slot < 6)
      .flatMap((i) => Array(Math.min(i.count || 1, 6)).fill(i.itemID));
    const questOwned = me.items.map((item) => item.itemID);
    const spells = playerSpellNames(me);
    const role = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].includes(me.position ?? '')
      ? me.position
      : options.role;
    const opts = {
      game,
      owned,
      questOwned,
      spells,
      role,
      gold: game.activePlayer.currentGold,
      map: game.gameData.mapNumber,
    };
    const targets = this.rank(champ, { ...opts, limit: 10 });
    const ownsRoleItem = questOwned.some((id) => {
      const item = this.items.get(id);

      return item && questKind(item);
    });
    const evolvedSmite =
      spells?.some((spell) => spell.includes('Smite') && spell !== 'SummonerSmite') ?? false;
    const result: Recommendation[] =
      ['JUNGLE', 'UTILITY'].includes(role?.toUpperCase() ?? '') &&
      !ownsRoleItem &&
      !options.roleQuestPurchased &&
      !evolvedSmite
        ? this.starters(champ, opts.gold, role, { owned, questOwned, spells, game })
            .filter((result) => questKind(result.item))
            .slice(0, 2)
        : [];
    for (const target of targets) {
      if (result.length === 3) {
        break;
      }
      if (target.affordable) {
        result.push(target);
        continue;
      }
      const missing: Item[] = [];
      const bag = [...owned];
      const walk = (item: Item, seen = new Set<number>()) => {
        if (seen.has(item.id)) {
          return;
        }
        const at = bag.indexOf(item.id);
        if (at !== -1) {
          bag.splice(at, 1);

          return;
        }
        missing.push(item);
        for (const id of item.from ?? []) {
          const i = this.items.get(Number(id));
          if (i) {
            walk(i, new Set(seen).add(item.id));
          }
        }
      };
      walk(target.item);
      const component = missing
        .filter(
          (i) =>
            eligible(i, champ, opts.map, { role, owned: questOwned, spells }) &&
            !result.some((r) => r.item.id === i.id),
        )
        .map((item) => ({ item, ...purchase(item, owned, this.items) }))
        .filter((r) => r.cost <= opts.gold && owned.length - r.consumed.length + 1 <= 6)
        .sort((a, b) => b.item.gold.total - a.item.gold.total)[0];
      if (component) {
        result.push({
          item: component.item,
          cost: component.cost,
          affordable: true,
          score: target.score,
          targetId: target.item.id,
          reasons: [`Builds toward ${target.item.name}`, ...target.reasons],
        });
      } else if (!result.some((r) => r.item.id === target.item.id)) {
        result.push(target);
      }
    }

    return result;
  }
  build(champ: Champion, map = 11, role = '', game?: LiveGame) {
    const reward = role.toUpperCase() === 'UTILITY' ? this.roleRewards(champ, role)[0] : undefined;
    const owned: number[] = reward ? [reward.item.id] : [];
    while (owned.length < 6) {
      const ranked = this.rank(champ, {
        owned,
        map,
        role,
        game,
        laneWeight: owned.length < 2 ? 1 : 0,
        limit: this.catalog.items.length,
      });
      // Reserve an early slot for mobility, except when the champion cannot buy boots.
      const boots = owned.some((id) => this.items.get(id)?.tags.includes('Boots'));
      const next =
        (!boots && owned.length >= 1
          ? ranked.find((r) => r.item.tags.includes('Boots'))
          : undefined) ?? ranked[0];
      if (!next) {
        break;
      }
      owned.push(next.item.id);
    }

    return owned;
  }
  starters(
    champ: Champion,
    gold = Infinity,
    role = '',
    state: { owned?: number[]; questOwned?: number[]; spells?: string[]; game?: LiveGame } = {},
  ): Recommendation[] {
    const kind =
      role.toUpperCase() === 'JUNGLE'
        ? 'jungle'
        : role.toUpperCase() === 'UTILITY'
          ? 'support'
          : undefined;

    return this.rank(champ, {
      ...state,
      role,
      completed: false,
      gold,
      limit: this.catalog.items.length,
    })
      .filter(
        (result) =>
          result.affordable &&
          result.item.rules?.tier === 1 &&
          (kind
            ? questKind(result.item) === kind
            : result.item.tags.includes('Lane') && !questKind(result.item)),
      )
      .slice(0, kind === 'jungle' ? 3 : 2);
  }
  roleRewards(champ: Champion, role: string): Recommendation[] {
    return this.rank(champ, { role, planning: true, limit: this.catalog.items.length }).filter(
      (result) => questKind(result.item) === 'support' && result.item.rules?.tier === 5,
    );
  }
  runes(champ: Champion, role = '') {
    const p = profile(champ, role);
    const weights: Record<string, number> = {
      kBurstDamage: p.burst,
      kDamagePerSecond: p.attacks,
      kUtility: p.support,
      kDurability: p.tank,
      kMoveSpeed: 0.4 + (1 - p.mobility) * 0.3,
      kGold: 0.2,
      kHealing: p.heal * p.support,
    };
    const score = (perk: Perk) => {
      let n = sum(
        Object.entries(perk.recommendationDescriptorAttributes ?? {}).map(
          ([key, value]) => Number(value) * (weights[key] ?? 0),
        ),
      );
      const text = plain(perk.longDesc).toLowerCase();
      if (/mana/.test(text) && !p.mana) {
        n -= 15;
      }
      if (/heal|shield/.test(text)) {
        n += p.heal * p.support * 2;
      }
      if (/attack speed/.test(text)) {
        n += p.attacks * 3;
      }
      if (/ability haste/.test(text)) {
        n += (1 - p.attacks) * 3;
      }
      if (/adaptive force/.test(text)) {
        n += 2;
      }
      if (/health/.test(text)) {
        n += 1 + p.tank;
      }
      if (/immobiliz|impaired/.test(text)) {
        n += p.cc * 2;
      }

      return n;
    };
    const perkMap = new Map(this.catalog.perks.map((p) => [p.id, p]));
    const best = (ids: number[]) =>
      ids
        .map((id) => required(perkMap.get(id)))
        .filter(Boolean)
        .sort((a, b) => score(b) - score(a) || a.id - b.id)[0];
    const styles = this.catalog.runeStyles.map((s) => ({
      ...s,
      selected: s.slots.map((slot) => best(slot.perks)),
    }));
    styles.sort((a, b) => sum(b.selected.map(score)) - sum(a.selected.map(score)) || a.id - b.id);
    const primary = styles[0];
    const allowed =
      this.catalog.perkStyles.styles.find((s) => s.id === primary.id)?.allowedSubStyles ?? [];
    const secondary = styles
      .filter((s) => s.id !== primary.id && allowed.includes(s.id))
      .map((s) => ({
        ...s,
        selected: s.selected
          .slice(1)
          .sort((a, b) => score(b) - score(a) || a.id - b.id)
          .slice(0, 2),
      }))
      .sort((a, b) => sum(b.selected.map(score)) - sum(a.selected.map(score)) || a.id - b.id)[0];
    const shardSlots = required(
      this.catalog.perkStyles.styles.find((s) => s.id === primary.id),
    ).slots.filter((s) => s.type === 'kStatMod');
    const selectedPerkIds = [
      ...primary.selected,
      ...secondary.selected,
      ...shardSlots.map((s) => best(s.perks)),
    ].map((p) => p.id);

    return {
      primaryStyleId: primary.id,
      subStyleId: secondary.id,
      selectedPerkIds,
      name: `LoL Utils · ${champ.name}`,
      current: true,
    };
  }
  summoners(
    champ: Champion,
    role: string,
    flashSlot: 'D' | 'F',
    mode = 'CLASSIC',
    level = 30,
    available?: number[],
  ) {
    const p = profile(champ);
    const spells = this.catalog.summoners.filter(
      (s) =>
        s.modes.includes(mode) &&
        s.summonerLevel <= level &&
        (!available || available.includes(s.id)),
    );
    const flash = spells.find((s) => s.alias === 'SummonerFlash');
    const score = (s: SummonerSpell) => {
      const text = plain(s.description).toLowerCase();
      if (role === 'JUNGLE') {
        return /monster/.test(text) ? 100 : -100;
      }
      if (/monster/.test(text)) {
        return -100;
      }
      let n = 0;
      if (/damage/.test(text)) {
        n += (1 - p.support) * p.burst * 3;
      }
      if (/heal/.test(text)) {
        n += p.support * 2 + p.attacks;
      }
      if (/shield/.test(text)) {
        n += (1 - p.tank) * 2;
      }
      if (/slow|reduces.*damage/.test(text)) {
        n += p.support * 3;
      }
      if (/teleport/.test(text)) {
        n += ['TOP', 'MIDDLE'].includes(role) ? 4 : 0;
      }
      if (/move.*speed|movement speed/.test(text)) {
        n += p.attacks * (1 - p.mobility) * 3;
      }

      return n;
    };
    const other = spells
      .filter((s) => s.id !== flash?.id)
      .sort((a, b) => score(b) - score(a) || a.id - b.id)[0];
    if (!flash || !other || score(other) < 0) {
      throw new Error('No legal summoner pair available');
    }

    return {
      spell1Id: flashSlot === 'D' ? flash.id : other.id,
      spell2Id: flashSlot === 'F' ? flash.id : other.id,
    };
  }
  skill(
    champ: Champion,
    level: number,
    ranks: Record<string, number>,
    game?: LiveGame,
  ): SkillSuggestion {
    const progression = progressionFor(champ);
    const keys = ['Q', 'W', 'E', 'R'];
    const spent = sum(
      progression.slots.map((slot) =>
        slot.automatic ? 0 : Math.max(0, (ranks[slot.key] ?? 0) - slot.initialRank),
      ),
    );
    if (level < 1 || level > 18 || spent >= level) {
      return { key: null, reason: 'No unspent skill point' };
    }
    const p = profile(champ);
    const options = champ.spells
      .map((s, i) => {
        const slot = required(progression.slots[i]);
        const rank = Math.max(ranks[slot.key] ?? 0, slot.initialRank);
        if (slot.automatic || rank >= slot.maxRank || level < (slot.levels[rank] ?? Infinity)) {
          return null;
        }
        const next = Math.min(rank, s.maxrank - 1);
        const current = Math.max(0, rank - 1);
        const cdGain =
          ((s.cooldown[current] ?? 0) - (s.cooldown[next] ?? 0)) /
          Math.max(1, s.cooldown[current] ?? 1);
        const text = plain(s.tooltip + s.description).toLowerCase();
        const numbers =
          s.effect?.filter((a): a is number[] => Array.isArray(a) && a.some((v) => v > 0)) ?? [];
        const rankGain = sum(
          numbers.map((a) => ((a[next] ?? 0) - (a[current] ?? 0)) / Math.max(1, a[current] ?? 1)),
        );
        const value =
          (i === 3 && slot.maxRank <= 4 ? 100 : 0) +
          (rank === 0 ? 10 : 0) +
          cdGain * 3 +
          rankGain +
          (/damage/.test(text) ? 1 + p.magic : 0) +
          (/heal|shield/.test(text) ? p.support * 2 : 0) +
          (/stun|root|knock/.test(text) ? p.cc : 0);

        if (slot.stat) {
          // Compare the marginal basic-attack DPS from each published stat gain.
          const own = game?.activePlayer.championStats;
          const ad = Number(
            own?.attackDamage ??
              growth(champ.stats.attackdamage, champ.stats.attackdamageperlevel, level),
          );
          const attackSpeed = Number(own?.attackSpeed ?? champ.stats.attackspeed);
          const armor = Math.max(
            0,
            this.context(champ, game).enemyArmor - Number(own?.physicalLethality ?? 0),
          );
          const gain = slot.stat.perRank;
          const improvement =
            slot.stat.kind === 'attackDamage'
              ? gain / Math.max(1, ad)
              : slot.stat.kind === 'attackSpeed'
                ? (gain * champ.stats.attackspeed) / Math.max(0.01, attackSpeed)
                : (100 + armor) / (100 + Math.max(0, armor - gain)) - 1;
          const labels = {
            attackDamage: 'Attack damage',
            attackSpeed: 'Attack speed',
            armorPenetration: 'Lethality',
          };

          return {
            key: slot.key,
            value: improvement,
            label: labels[slot.stat.kind],
            reason: `Stat rank ${rank + 1}: compares marginal attack damage, attack speed, and penetration from published passive values`,
          };
        }

        return {
          key: keys[i],
          value,
          reason: `Rank ${rank + 1}: legal level gate; ranked by published cooldown, effects, and kit utility`,
        };
      })
      .filter((x): x is { key: string; value: number; reason: string } => x !== null);
    options.sort((a, b) => b.value - a.value || keys.indexOf(a.key) - keys.indexOf(b.key));

    return options[0] ?? { key: null, reason: 'No supported legal upgrade' };
  }
}
