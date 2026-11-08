import type { ChampionKit } from './types.js';
import { championTooltips } from './spell-tooltips.js';

/** Ability scalings can be absent from the exported prose (e.g. spins that crit).
 * Inspect official calculation nodes, never champion or item IDs.
 */
export function championMechanics(champion: ChampionKit, raw: unknown) {
  let attackSpeedScaling = false,
    criticalScaling = false;
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') {
      return;
    }
    const node = value as Record<string, unknown>;
    if (typeof node.__type === 'string' && /^StatBy/.test(node.__type)) {
      attackSpeedScaling ||= node.mStat === 4;
      criticalScaling ||= node.mStat === 8 || node.mStat === 9;
    }
    // Some script-driven tick counts are parameterized rather than GameCalculations.
    attackSpeedScaling ||= node.name === 'ASPerTick';
    Object.values(node).forEach(visit);
  }
  const game = raw as Record<string, unknown>;
  for (const entry of Object.values(game)) {
    const object = entry as Record<string, unknown>;
    if (
      object &&
      champion.spells.some(
        (spell) => spell.id === object.ObjectName || spell.id === object.mScriptName,
      )
    ) {
      visit(object.mSpell);
    }
  }
  const tooltips = championTooltips(champion, raw).spells;
  function armorFraction(pattern: RegExp) {
    return Math.max(
      0,
      ...tooltips.flatMap((spell) => {
        const match = spell.tooltip.replace(/<[^>]+>/g, '').match(pattern);

        return match
          ? match[1]
              .split('/')
              .map(Number)
              .filter(Number.isFinite)
              .map((n) => n / 100)
          : [];
      }),
    );
  }
  const innateArmorPenetration = armorFraction(/gains?\s+([\d./]+)%\s+Armor Penetration/i);
  const innateArmorShred = armorFraction(/(?:lose|remov\w*)\s+([\d./]+)%\s+Armor/i);

  return { attackSpeedScaling, criticalScaling, innateArmorPenetration, innateArmorShred };
}
