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
/** Shared effects can have different display names (Thorns, Hackshorn, Wounds). */
export function passiveKeys(item: Item): string[] {
  const names = [...item.description.matchAll(/<passive>(.*?)<\/passive>/gi)].map((match) =>
    plain(match[1]).toLowerCase(),
  );
  if (item.rules?.values.GrievousAmount || /\bwounds\b/i.test(plain(item.description))) {
    names.push('effect:healing-reduction');
  }

  return names;
}
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
  const tags = Object.values(c.source.championTagInfo ?? {}).join(' ');
  const marksman = c.source.roles[0] === 'marksman' || /Hypercarry|Auto-attack/.test(tags);
  const assassin = c.source.roles[0] === 'assassin';
  const defender = c.source.roles[0] === 'tank';
  const repeatedAttacks = c.spells.some((spell) => {
    const ability = plain(spell.tooltip + ' ' + spell.description);

    return (
      /next[^.]*attacks|enhancedattacks/i.test(ability) &&
      /gains?[^.]*attack speed|increas[^.]*attack speed/i.test(ability)
    );
  });
  // An empowered attack is a proc opportunity, not proof of marksman attack frequency.
  const attacks = marksman
    ? 0.95
    : assassin
      ? 0.25
      : repeatedAttacks
        ? 0.65
        : Math.min(0.55, 1 - clamp((tactical.style ?? 5) / 10));
  const allyProtection = c.spells.some((spell) =>
    /(?:heal|shield|restor)[^.]{0,100}(?:allied|ally)|(?:allied|ally)[^.]{0,100}(?:heal|shield|restor)/i.test(
      plain(spell.description + ' ' + spell.tooltip),
    ),
  );
  // A secondary support tag must not turn every mid-lane mage into an enchanter.
  let support = c.source.roles[0] === 'support' ? play.utility / 3 : 0;
  if (role) {
    support = role.toUpperCase() === 'UTILITY' ? 1 : 0;
  }

  return {
    magic,
    attacks,
    empoweredAttacks,
    repeatedAttacks,
    marksman,
    assassin,
    defender,
    critScaling:
      marksman || c.mechanics?.criticalScaling || /critical strike|critically strike/.test(text),
    abilityAttackSpeed: c.mechanics?.attackSpeedScaling ?? false,
    innateArmorPenetration:
      1 -
      (1 - (c.mechanics?.innateArmorPenetration ?? 0)) * (1 - (c.mechanics?.innateArmorShred ?? 0)),
    melee: tactical.attackType === 'melee',
    taunt: /taunt/.test(text),
    globalTravel: c.spells.some(
      (spell) =>
        /teleport/i.test(spell.description + spell.tooltip) &&
        /anywhere|allied champion|ally.s location/i.test(spell.description + spell.tooltip),
    ),
    sustain: /\bheal(?:s|ing|ed)?\b|restor[^.]*health/.test(text) ? 1 : 0,
    tank: (play.durability ?? 1) / 3,
    support,
    cc: (play.crowdControl ?? 1) / 3,
    mobility: (play.mobility ?? 1) / 3,
    mana: c.partype.toLowerCase() === 'mana',
    heal: allyProtection ? 1 : 0,
    burst: /Burst/.test(tags) || assassin ? 1 : 1 - attacks,
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
    PercentHealingAmountMod: 'HealShieldPower',
    PercentBaseMPRegenMod: 'ManaRegen',
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
      stats = { ...required(this.stats.get(item.id)) };
    const effects = item.rules?.values ?? {};
    const level = game?.activePlayer.level ?? 11;
    if (effects.ADtoAD) {
      stats.FlatPhysicalDamageMod =
        (stats.FlatPhysicalDamageMod ?? 0) +
        growth(champ.stats.attackdamage, champ.stats.attackdamageperlevel, level) * effects.ADtoAD;
    }
    const ownStats = { ...projectedStats, ...game?.activePlayer.championStats };
    const offense =
      (p.support > 0 && (p.defender || (p.heal && !p.marksman))
        ? 0.25
        : p.defender && !p.repeatedAttacks
          ? 0.35
          : 1) * (p.defender && Number(ownStats.offensiveItems ?? 0) >= 2 ? 0.45 : 1);
    const attackDamage = Number(ownStats.attackDamage ?? champ.stats.attackdamage);
    const crit = clamp(Number(ownStats.critChance ?? 0));
    const attackFrequency = Math.max(p.attacks, p.abilityAttackSpeed ? 0.75 : 0);
    const critDamagePrice = this.prices.get('FlatCritDamageMod') ?? 25;
    const healthRatio =
      Number(ownStats.bonusHealth ?? 0) /
      Math.max(1, growth(champ.stats.hp, champ.stats.hpperlevel, level));
    const weights: Record<string, number> = {
      FlatMagicDamageMod: p.magic * (1.2 - p.attacks * 0.3) * offense * (1.25 - p.teamMagic * 0.5),
      FlatPhysicalDamageMod:
        (1 - p.magic) * (0.7 + p.attacks) * offense * (0.75 + p.teamMagic * 0.5),
      PercentAttackSpeedMod:
        ((attackFrequency *
          offense *
          (1.2 - p.magic * 0.3) *
          (p.critScaling || p.repeatedAttacks || p.abilityAttackSpeed ? 1 : 0.5)) /
          (1 + Number(ownStats.attackSpeedBonus ?? 0))) *
        Math.max(
          1,
          Number(ownStats.attackDamage ?? champ.stats.attackdamage) /
            Math.max(1, champ.stats.attackdamage),
        ),
      FlatCritChanceMod:
        (p.critScaling ? 1 : 0.12) *
        attackFrequency *
        offense *
        (1 - p.magic) *
        Math.min(3, attackDamage / champ.stats.attackdamage),
      // Marginal expected attack damage from extra crit damage, priced against attack damage.
      FlatCritDamageMod:
        ((p.critScaling ? 1 : 0) *
          attackFrequency *
          offense *
          crit *
          attackDamage *
          (this.prices.get('FlatPhysicalDamageMod') ?? 35)) /
        ((1 + crit * 0.75) * critDamagePrice),
      PercentArmorPenetrationMod:
        (1 - p.magic) * offense * clamp((p.enemyArmor * (1 - p.innateArmorPenetration)) / 100),
      FlatHPPoolMod: (0.12 + p.tank * (p.marksman ? 0.15 : 0.7)) / (1 + healthRatio),
      FlatArmorMod:
        (((0.3 + p.tank) * p.physical * (1 + healthRatio)) /
          (1 + Number(ownStats.bonusArmor ?? 0) / 100)) *
        (p.defender && /armor/.test(p.text) ? 1.35 : 1),
      FlatSpellBlockMod:
        ((0.3 + p.tank) * p.magical * (1 + healthRatio)) /
        (1 + Number(ownStats.bonusMr ?? 0) / 100),
      FlatMPPoolMod: p.mana
        ? (0.4 + p.magic * 0.3) /
          (1 + Number(ownStats.resourceMax ?? champ.stats.mp) / Math.max(1, champ.stats.mp))
        : 0,
      PercentLifeStealMod: p.attacks * offense * 0.8,
      FlatMovementSpeedMod:
        0.6 + (p.melee && !p.defender && !p.assassin && !p.support ? (1 - p.mobility) * 1.5 : 0),
      PercentMovementSpeedMod:
        0.6 + (p.melee && !p.defender && !p.assassin && !p.support ? (1 - p.mobility) * 1.5 : 0),
      AbilityHaste:
        (1 - p.attacks * 0.6) *
        (p.marksman ? 0.35 : 1) *
        (1 - Number(ownStats.abilityHaste ?? 0) / (100 + Number(ownStats.abilityHaste ?? 0))),
      Lethality: (1 - p.magic) * offense * (p.assassin ? 2 : 1 - p.attacks * 0.5),
      MagicPen: p.magic * offense * (p.burst > 0.7 ? 1.5 : 1),
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
        (key === 'PercentMovementSpeedMod'
          ? champ.stats.movespeed * (this.prices.get('FlatMovementSpeedMod') ?? 12)
          : key === 'MagicPen'
            ? 50
            : key.includes('Percent') || key === 'HealShieldPower' || key === 'ManaRegen'
              ? 1000
              : 25);
      contributions.push([key, Math.max(0, value) * reference * (weights[key] ?? 0)]);
    }
    let value = sum(contributions.map(([, n]) => n));
    const text = plain(item.description).toLowerCase();
    const statReasons: Record<string, string> = {
      FlatHPPoolMod: 'Health supports durability and health-scaling effects',
      FlatArmorMod: 'Armor reduces incoming physical damage',
      FlatSpellBlockMod: 'Magic resistance reduces incoming magic damage',
      FlatMagicDamageMod: 'Ability power fits the magic-damage ability profile',
      FlatPhysicalDamageMod: 'Attack damage fits physical damage and basic attacks',
      PercentAttackSpeedMod: 'Attack speed supports frequent and empowered attacks',
      FlatCritChanceMod: 'Critical strikes improve physical basic attacks',
      AbilityHaste: 'Ability haste gives more frequent ability casts',
      FlatMovementSpeedMod: 'Movement speed helps positioning and reaching targets',
      PercentMovementSpeedMod: 'Movement speed helps positioning and reaching targets',
      FlatMPPoolMod: 'Mana supports repeated ability use',
      PercentLifeStealMod: 'Life steal restores health through basic attacks',
      HealShieldPower: 'Heal and shield power strengthens ally protection',
      MagicPen: 'Magic penetration improves damage against magic resistance',
      Lethality: 'Lethality improves physical damage against armor',
      ManaRegen: 'Mana regeneration sustains repeated support casts',
    };
    const reasons = contributions
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(
        ([key]) =>
          statReasons[key] ??
          `${key.replace(/Mod$|Flat|Percent/g, '')} supports ${champ.name}'s stat profile`,
      );
    const kind = questKind(item);
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
      // Match the application mechanism rather than rewarding every anti-heal equally.
      const fit = reactive
        ? p.tank * (p.taunt ? 1.3 : 1)
        : /physical damage/.test(text)
          ? (1 - p.magic) * (0.5 + p.attacks * 0.5)
          : p.magic * (1 - p.tank * 0.55);
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
    if (/spellblade/.test(text) && p.empoweredAttacks && !p.assassin && !p.support) {
      value +=
        item.gold.total *
        Math.max(0.3, p.attacks) *
        (stats.FlatMagicDamageMod ? p.magic : 1 - p.magic) *
        (p.marksman ? 0.25 : 0.5) *
        (p.defender && !p.repeatedAttacks ? 0.25 : 1);
      reasons.push('Spellblade follows abilities that empower attacks');
      if (/on.hit effects an additional time/.test(text)) {
        value +=
          item.gold.total *
          p.attacks *
          p.magic *
          (0.15 + Number(ownStats.onHitItems ?? 0) * 0.3) *
          (p.defender && !p.repeatedAttacks ? 0.25 : 1);
        reasons.push('Repeats on-hit effects from empowered attacks');
      }
    }
    if (effects.PrimaryTargetHPRatio && p.melee && !p.support && !p.assassin) {
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
      value += item.gold.total * Math.max(0.3, p.attacks) * p.tank * 0.4;
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
      value += item.gold.total * p.attacks * offense * 0.15;
      reasons.push('On-hit effect fits attack frequency');
    }
    if (effects.NashorsBaseValue && effects.NashorsAPValue) {
      const damage =
        effects.NashorsBaseValue +
        effects.NashorsAPValue *
          (Number(ownStats.abilityPower ?? 0) + (stats.FlatMagicDamageMod ?? 0));
      value +=
        damage *
        p.attacks *
        offense *
        (p.defender ? 0.35 : 1) *
        (this.prices.get('FlatPhysicalDamageMod') ?? 35);
      reasons.push('Every attack adds magic damage that scales with ability power');
    }
    if (
      effects.UltimateHaste &&
      /damag[^.]*ultimate|ultimate[^.]*burn/i.test(text) &&
      /damage/.test(plain(champ.spells[3]?.tooltip)) &&
      !p.marksman
    ) {
      value +=
        (effects.UltimateHaste * (this.prices.get('AbilityHaste') ?? 30) +
          (effects.BaseDamage ?? 0) * 3) *
        p.magic *
        offense;
      reasons.push('Ultimate damage benefits from ultimate haste and the damage zone');
    }
    if (effects.SpellItemDamageAmp) {
      value += item.gold.total * effects.SpellItemDamageAmp * p.magic * offense;
      reasons.push('Low-health damage amplification supports magic burst');
    }
    if (/dash in target direction/.test(text)) {
      value += item.gold.total * p.magic * offense * (1 - p.mobility) * 0.3;
      reasons.push('Active dash helps reach ability range');
    }
    if (effects.BaseDamagePerTickTOOLTIPONLY && p.melee) {
      value +=
        item.gold.total *
        (p.defender ? (p.repeatedAttacks ? 0.25 : 0.7) : 0.15) *
        (1 - p.support * 0.6);
      reasons.push('Nearby burn adds sustained damage and melee waveclear');
    }
    if (effects.ActiveMS && effects.MSSlow && p.melee) {
      value += item.gold.total * (1 - p.mobility * 0.5) * (1 - p.magic) * offense * 0.5;
      reasons.push('Cleave and an active slow help a melee fighter stick to targets');
    }
    if (effects.BoltMinPercent && p.marksman && !p.melee) {
      value += item.gold.total * p.attacks * 0.35;
      reasons.push('Additional bolts spread ranged attacks and on-hit effects');
    }
    if (effects.MaxDamageAmp && effects.MaxRange && p.marksman && !p.melee) {
      // Maximum reach is not sustained combat distance. With no target-position feed,
      // use conservative spacing and price the extra attack damage, not the item's cost.
      // The range buff after a takedown is conditional and is not assumed active.
      const reach = Math.max(0, Number(ownStats.attackRange ?? champ.stats.attackrange));
      const distance = reach * 0.65;
      const damageAmp = effects.MaxDamageAmp * clamp(distance / effects.MaxRange);
      value +=
        (attackDamage + (stats.FlatPhysicalDamageMod ?? 0)) *
        damageAmp *
        (this.prices.get('FlatPhysicalDamageMod') ?? 35) *
        weights.FlatPhysicalDamageMod *
        attackFrequency;
      reasons.push(
        `Distance-based attack damage estimated at ${Math.round(distance)} range; maximum needs ${effects.MaxRange}. Spacing is not observed`,
      );
    }
    if (effects.MeleeBaseShield && p.melee && !p.support) {
      value +=
        (effects.MeleeBaseShield +
          Math.max(0, attackDamage - champ.stats.attackdamage) *
            (effects.MeleeBonusADShieldRatio ?? 0)) *
        (this.prices.get('FlatHPPoolMod') ?? 2.67) *
        1.5;
      reasons.push('Repeated attack and ability trades trigger a protective shield');
    }
    if (effects.HealBaseADRatio && p.melee && !p.assassin && !p.support) {
      value += item.gold.total * p.tank * Math.min(1, p.attacks * 2) * (p.defender ? 0.15 : 0.65);
      reasons.push('First-hit healing supports extended melee trades');
    }
    if (effects.ShredPerStack && !p.support) {
      value +=
        item.gold.total *
        (1 - p.magic) *
        effects.ShredPerStack *
        (effects.MaxStacks ?? 1) *
        (0.8 + p.sustain * 0.5) *
        (1 - p.innateArmorPenetration);
      reasons.push('Repeated physical damage stacks armor reduction');
    }
    if (effects.PercentCurrentHPMelee && /energized/.test(text) && p.melee && !p.support) {
      value += ((item.gold.total * effects.PercentCurrentHPMelee) / 100) * p.burst * 3;
      value += (effects.LethalityBonusModMelee ?? 0) * 25 * (1 - p.magic) * (p.assassin ? 1 : 0.5);
      reasons.push(
        'Ability-triggered energized damage and temporary lethality support short trades',
      );
    }
    if (p.assassin && /stealth wards|unseen by enemies/.test(text)) {
      value += item.gold.total * 0.3;
      reasons.push('Out-of-vision attacks and ward clearing support an assassin approach');
    }
    if (effects.BaseOOCMS && !p.support) {
      value +=
        effects.BaseOOCMS *
        (this.prices.get('FlatMovementSpeedMod') ?? 12) *
        (1 - p.mobility) *
        (p.melee ? 3 : 1);
      reasons.push('Out-of-combat movement speed supports roaming and reaching fights');
    }
    if (effects.MaxMovementSpeed && effects.DurationToMaxStack && p.melee && !p.support) {
      value +=
        effects.MaxMovementSpeed *
        (this.prices.get('FlatMovementSpeedMod') ?? 12) *
        (1 - p.mobility) *
        (p.defender ? 1 : 3);
      reasons.push('Movement builds speed between attacks to reach targets and resist kiting');
    }
    if (effects.SlowResistTooltip && p.melee && !p.support) {
      // Published tooltips mix percentages (boots: 25) and fractions (plate: .15).
      const resistance =
        effects.SlowResistTooltip > 1 ? effects.SlowResistTooltip / 100 : effects.SlowResistTooltip;
      value += item.gold.total * clamp(resistance) * (1 - p.mobility) * 0.25;
      reasons.push('Published slow resistance helps a melee champion stay in attack range');
    }
    if (effects.BonusADRatio && effects.HealDuration && /cleanse.*remaining damage/.test(text)) {
      // Defy healing is conditional on a takedown; discount its nominal value.
      const bonusAD =
        Math.max(
          0,
          attackDamage - growth(champ.stats.attackdamage, champ.stats.attackdamageperlevel, level),
        ) + (stats.FlatPhysicalDamageMod ?? 0);
      value += bonusAD * effects.BonusADRatio * (this.prices.get('FlatHPPoolMod') ?? 2.67) * 0.5;
      reasons.push('Bonus attack damage scales the conditional takedown heal');
    }
    if (effects.BaseShieldRatio && effects.ADtoAD && p.melee) {
      value +=
        (Number(ownStats.bonusHealth ?? 0) + (stats.FlatHPPoolMod ?? 0)) *
        effects.BaseShieldRatio *
        (this.prices.get('FlatHPPoolMod') ?? 2.67) *
        0.5;
      reasons.push('Bonus health increases the low-health survival shield');
    }
    if (effects.MeleeAuraAttackSpeed && p.support && p.cc > 0) {
      value += item.gold.total * effects.MeleeAuraAttackSpeed * p.cc * 1.5;
      reasons.push('Crowd control grants nearby allies attack speed');
    }
    if (effects.ChainHeal && p.support && p.heal) {
      value += item.gold.total * (effects.ChainHeal + (effects.ChainShield ?? 0)) * 1.5;
      reasons.push('Ally healing and shielding chain to additional teammates');
    }
    if (effects.ShieldMinTOOLTIP && p.support) {
      value += item.gold.total * p.support * (0.4 + p.tank * 0.7);
      reasons.push('Team shield protects allies during an engage');
    }
    if (effects.DamageRedirection && p.support) {
      value += item.gold.total * p.support * p.tank * effects.DamageRedirection * 7;
      reasons.push('Durability lets you redirect damage away from an allied carry');
    }
    if (effects.HealMin && effects.HealMax && p.support) {
      value += item.gold.total * p.support * (0.2 + p.heal * 0.5);
      reasons.push('Area healing supports team protection');
    }
    if (effects.APPerManaRegen && p.support && p.heal) {
      value +=
        item.gold.total *
        p.support *
        (Number(ownStats.manaRegen ?? 0) + (stats.ManaRegen ?? 0)) *
        0.25;
      reasons.push('Owned mana regeneration scales healing power and ability power');
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
    if (stats.FlatCritChanceMod && !p.critScaling) {
      value -= stats.FlatCritChanceMod * (this.prices.get('FlatCritChanceMod') ?? 4000) * 0.65;
      reasons.push('Critical strike budget is discounted for a kit without sustained crit attacks');
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
      onHitItems: own.filter(
        (item) =>
          /on.hit/i.test(plain(item.description)) && !/spellblade/i.test(plain(item.description)),
      ).length,
      offensiveItems: own.filter(
        (item) =>
          item.rules?.tier === 5 &&
          ((this.stats.get(item.id)?.FlatPhysicalDamageMod ?? 0) > 0 ||
            (this.stats.get(item.id)?.FlatMagicDamageMod ?? 0) > 0 ||
            (this.stats.get(item.id)?.PercentAttackSpeedMod ?? 0) > 0),
      ).length,
      resourceMax: champ.stats.mp,
      attackDamage: champ.stats.attackdamage,
    };
    const projectionKeys: Record<string, string> = {
      FlatMagicDamageMod: 'abilityPower',
      FlatPhysicalDamageMod: 'attackDamage',
      AbilityHaste: 'abilityHaste',
      FlatCritChanceMod: 'critChance',
      FlatMPPoolMod: 'resourceMax',
      ManaRegen: 'manaRegen',
      PercentAttackSpeedMod: 'attackSpeedBonus',
      FlatHPPoolMod: 'bonusHealth',
      FlatArmorMod: 'bonusArmor',
      FlatSpellBlockMod: 'bonusMr',
    };
    for (const item of own) {
      for (const [key, target] of Object.entries(projectionKeys)) {
        projectedStats[target] =
          (projectedStats[target] ?? 0) + (this.stats.get(item.id)?.[key] ?? 0);
      }
    }
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
        const remainingPassives = new Set(
          remaining.flatMap((id) => {
            const item = this.items.get(id);

            return item ? passiveKeys(item) : [];
          }),
        );
        if (passiveKeys(i).some((name) => remainingPassives.has(name))) {
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
    // Gold changes the displayed remaining cost, never the completed target.
    const effects = new Set<string>();

    return this.rank(champ, { ...opts, completed: true, limit: this.catalog.items.length })
      .filter((result) => {
        const keys = passiveKeys(result.item);
        if (keys.some((key) => effects.has(key))) {
          return false;
        }
        keys.forEach((key) => effects.add(key));

        return true;
      })
      .slice(0, 3);
  }

  build(champ: Champion, map = 11, role = '', game?: LiveGame) {
    return this.buildPlan(champ, map, role, game).map((entry) => entry.item.id);
  }
  buildPlan(champ: Champion, map = 11, role = '', game?: LiveGame) {
    const reward = role.toUpperCase() === 'UTILITY' ? this.roleRewards(champ, role)[0] : undefined;
    const result: Recommendation[] = reward ? [reward] : [];
    const owned: number[] = result.map((entry) => entry.item.id);
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
      result.push(next);
    }

    return result;
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
    role = role.toUpperCase();
    const hardCC =
      /stun|root|snare|knock(?:s|ed)? (?:up|back)|airborne|taunt|fear|charm|suppress/.test(p.text);
    // Equipment named "shield" and armour-granting abilities are not shields.
    const shield =
      champ.spells.some((spell) => /<shield>/i.test(spell.tooltip)) ||
      /shield(?:s|ed)? (?:himself|herself|itself)|gains? (?:a |an? [\w-]+ )?shield/i.test(
        champ.passive.description,
      );
    const dash = /dash|leap|blink|teleport|stealth|invisib/.test(p.text);
    const sustained = p.melee && !p.marksman && !p.assassin && !p.defender && !p.support;
    const lane = role !== 'JUNGLE' && role !== 'UTILITY';
    const energy = /energy/i.test(champ.partype);
    const ultimate = plain(champ.spells[3]?.description ?? '').toLowerCase();
    const damagingUltimate = /damage/.test(ultimate);
    const weights: Record<string, number> = {
      kBurstDamage: p.burst,
      kDamagePerSecond: p.attacks,
      kUtility: p.support,
      kDurability: p.tank,
      kMoveSpeed: 0.4 + (1 - p.mobility) * 0.3,
      kGold: 0.2,
      kHealing: p.heal * p.support,
      kMana: p.mana ? (1 - p.attacks) * 0.65 : energy ? 0.2 : 0,
      kCooldown: (1 - p.attacks) * 0.7,
    };
    const score = (perk: Perk) => {
      let n = sum(
        Object.entries(perk.recommendationDescriptorAttributes ?? {}).map(
          ([key, value]) => Number(value) * (weights[key] ?? 0),
        ),
      );
      const text = plain(perk.longDesc).toLowerCase();
      // Descriptor metadata is incomplete and sometimes stale (e.g. biscuits no
      // longer restore mana). Only penalise a resource that the current text uses.
      if (/\bmana\b/.test(text) && !p.mana && !(/energy/.test(text) && energy)) {
        return -100;
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
      // Mechanic-specific eligibility and uptime, shared by every champion.
      // IDs identify rune mechanics, never champion builds or provider preferences.
      switch (perk.id) {
        case 8437: // Grasp: repeated melee lane trades, health scaling.
          return p.melee && lane ? 8 + p.tank * 5 + (p.empoweredAttacks ? 5 : 0) : 1;
        case 8439: // Aftershock must be triggered by immobilisation.
          return hardCC && p.melee ? 5 + p.tank * 4 + p.support * 12 : -100;
        case 8465: // Guardian is an ally-protection keystone.
          return p.support && p.heal ? 13 + p.tank * 2 : -20;
        case 8214: // Aery repeatedly shields protected allies; also supports poke.
          return p.heal && p.support ? 23 : !p.melee && !p.marksman ? 11 : 2;
        case 8112: // Electrocute rewards a short three-hit spell/attack combo.
          return p.assassin || (!p.melee && !p.marksman && !p.support) ? 19 : 5;
        case 8005: // Press the Attack: repeated attacks amplify hybrid/on-hit damage.
          return p.marksman && p.magic > 0.5 ? 24 : p.marksman ? 20 : p.repeatedAttacks ? 17 : 5;
        case 8008: // Lethal Tempo needs sustained basic attacks, not a single proc.
          return p.marksman ? 22 : p.repeatedAttacks ? 16 : p.attacks * 8;
        case 8010: // Conqueror can stack from abilities as well as attacks.
          return sustained ? 23 : p.marksman ? 13 : 4;
        case 8021: // Fleet trades damage for sustain and movement.
          return p.marksman ? 14 : p.melee && lane ? 9 : 3;
        case 9923: // Three attacks favour attack burst over extended combat.
          return p.empoweredAttacks && p.assassin ? 17 : p.attacks * 9;
        case 8351: // Glacial needs hard CC and protects nearby allies.
          return hardCC && p.support ? 15 : -20;
        case 8230: // Movement after a burst; no generic health-text bonus.
          return sustained && p.mobility < 0.5 ? 15 : 5;
        case 8992: // Persistent ability burn suits spell damage.
          return !p.marksman && !p.melee && !p.heal ? 14 : 3;
        case 8128: // Harvest requires low-health takedown opportunities.
          return p.assassin ? 15 : 4;
        case 8369:
          return p.assassin || (!p.melee && !p.marksman) ? 12 : 3;
        case 8401: // Shield Bash is unusable without a kit shield.
          return shield ? 12 + (p.melee ? 5 : 0) : -100;
        case 8143:
          return dash ? 10 + p.burst * 3 : -100;
        case 8232:
          return role === 'JUNGLE' ? 12 : 1;
        case 8224:
          return damagingUltimate || /heal|shield/.test(ultimate) ? 7 + p.heal * 3 : 0;
        case 8444:
          return lane && p.melee ? 14 : 4;
        case 8473:
          return p.melee ? 10 + p.support * 3 : 5;
        case 8453:
          return p.heal * (p.support ? 18 : 3) + (shield ? 3 : 0) + p.sustain * 2;
        case 8446: // Tower attacks are a lane pushing benefit, not general support utility.
          return lane && p.melee ? 9 + p.tank * 3 : 2;
        case 8463:
          return /slow|stun|root|taunt|knock/.test(p.text) ? (p.support ? 14 : 5) : -100;
        case 8316: // Diverse item stats are not guaranteed by a utility role alone.
          return 3;
        case 9101:
          return lane ? 6 : 1;
        case 9111:
          return p.melee && !p.defender ? 12 : 5;
        case 9105:
          return sustained ? 13 : (1 - p.attacks) * 9;
        case 9103:
          return p.marksman ? 13 : 3;
        case 8299:
          return sustained ? 14 : 4;
        case 8306:
          return p.support && hardCC && p.melee ? 14 : 0;
        case 8410:
          return p.melee && /slow|taunt/.test(p.text) ? 12 : 2;
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
    // A strong minor-rune tree must not outweigh a keystone the kit cannot use.
    const treeScore = (s: (typeof styles)[number]) =>
      score(s.selected[0]) * 4 + sum(s.selected.slice(1).map(score)) / 3;
    styles.sort((a, b) => treeScore(b) - treeScore(a) || a.id - b.id);
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
    const p = profile(champ, role);
    role = role.toUpperCase();
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
        n += ['TOP', 'MIDDLE'].includes(role) ? (p.globalTravel ? 0.5 : 4) : 0;
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
