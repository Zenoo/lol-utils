import type { Champion, Spell } from './types.js';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const numeric = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const format = (value: number) => String(Number(value.toPrecision(6)));
interface Expression {
  text: string;
  value?: number;
}
const number = (value: number): Expression => ({ text: format(value), value });
function series(values: number[]): Expression | undefined {
  if (!values.length || !values.every(numeric)) {
    return undefined;
  }

  return values.every((value) => Math.abs(value - values[0]) < 1e-6)
    ? number(values[0])
    : { text: values.map(format).join('/') };
}
function sum(parts: (Expression | undefined)[]): Expression | undefined {
  if (!parts.length || parts.some((part) => !part)) {
    return undefined;
  }
  const resolved = parts.filter((part): part is Expression => Boolean(part));

  return resolved.every((part) => part.value !== undefined)
    ? number(resolved.reduce((total, part) => total + (part.value ?? 0), 0))
    : { text: resolved.map((part) => part.text).join(' + ') };
}
function product(a?: Expression, b?: Expression): Expression | undefined {
  if (!a || !b) {
    return undefined;
  }
  if (a.value === 1) {
    return b;
  }
  if (b.value === 1) {
    return a;
  }

  return a.value !== undefined && b.value !== undefined
    ? number(a.value * b.value)
    : { text: `${a.text} * (${b.text})` };
}
function hash(value: string) {
  let result = 0x811c9dc5;
  for (const character of value.toLowerCase()) {
    result = Math.imul(result ^ character.charCodeAt(0), 0x01000193) >>> 0;
  }

  return `{${result.toString(16).padStart(8, '0')}}`;
}
function lookup(values: Record<string, unknown>, name: string): unknown {
  const key = Object.keys(values).find((key) => key.toLowerCase() === name.toLowerCase());

  return key === undefined ? values[hash(name)] : values[key];
}

/** Display published rank values and symbolic scalings, without inventing a combat context.
 * Format reference: https://hextechdocs.dev/resolving-variables-in-spell-textsa/
 */
export function spellTooltip(champion: Champion, spell: Spell, raw: unknown): string {
  const game = record(raw);
  const root = record(game[`Characters/${champion.alias}/CharacterRecords/Root`]);
  const index = champion.spells.indexOf(spell);
  const rootName = list(root.spellNames)[index];
  const exact = record(
    Object.values(game).find((value) => {
      const entry = record(value);

      return (
        entry.__type === 'SpellObject' &&
        (entry.mScriptName === spell.id || entry.ObjectName === spell.id)
      );
    }),
  );
  const object = exact.mSpell
    ? exact
    : record(game[`Characters/${champion.alias}/Spells/${String(rootName)}`]);
  const source = record(object.mSpell);
  const data: Record<string, unknown> = {};
  for (const value of list(source.DataValues)) {
    const entry = record(value);
    if (typeof entry.name === 'string') {
      data[entry.name] = entry.values;
    }
  }
  const calculations = record(source.mSpellCalculations);
  const ranks = (value: unknown) => {
    const values = list(value).slice(1, spell.maxrank + 1);
    if (values.length !== spell.maxrank || !values.every(numeric)) {
      return undefined;
    }

    return series(values);
  };
  const effect = (index: number) => {
    const values = record(list(source.mEffectAmount)[index - 1]).value;

    return values ? ranks(values) : series(spell.effect?.[index] ?? []);
  };
  const named = (name: string) => ranks(lookup(data, name));
  function part(input: unknown, seen: Set<string>): Expression | undefined {
    const node = record(input);
    switch (node.__type) {
      case 'NumberCalculationPart':
        return number(numeric(node.mNumber) ? node.mNumber : 0);
      case 'NamedDataValueCalculationPart':
        return named(String(node.mDataValue));
      case 'EffectValueCalculationPart':
        return effect(Number(node.mEffectIndex));
      case 'StatByNamedDataValueCalculationPart':
      case 'StatByCoefficientCalculationPart': {
        const stat = Number(node.mStat ?? 0);
        const label = stat === 0 ? 'AP' : stat === 2 ? 'AD' : undefined;
        if (!label) {
          return undefined;
        }
        const coefficient =
          node.__type === 'StatByNamedDataValueCalculationPart'
            ? named(String(node.mDataValue))
            : number(Number(node.mCoefficient ?? 0));
        const percent = product(number(100), coefficient);
        if (!percent) {
          return undefined;
        }
        // In archived game data, e.g. Zed's BonusADRatio uses formula 2; omitted/0 is total.
        const qualifier =
          stat === 2
            ? node.mStatFormula === 2
              ? 'bonus '
              : node.mStatFormula === 1
                ? 'base '
                : 'total '
            : '';

        return { text: `${percent.text}% ${qualifier}${label}` };
      }
      case 'SumOfSubPartsCalculationPart':
        return sum(list(node.mSubparts).map((entry) => part(entry, seen)));
      case 'ProductOfSubPartsCalculationPart':
        return product(part(node.mPart1, seen), part(node.mPart2, seen));
      case 'ByCharLevelInterpolationCalculationPart': {
        if (!numeric(node.mStartValue) || !numeric(node.mEndValue)) {
          return undefined;
        }

        return {
          text: `${format(node.mStartValue)}-${format(node.mEndValue)} (champion levels 1-18)`,
        };
      }
      case 'ByCharLevelBreakpointsCalculationPart': {
        let value = Number(node.mLevel1Value ?? 0),
          rate = Number(node.mInitialBonusPerLevel ?? 0);
        const changes = [{ level: 1, value }];
        for (let level = 2; level <= 18; level++) {
          const before = value;
          for (const entry of list(node.mBreakpoints)
            .map(record)
            .filter((entry) => entry.mLevel === level)) {
            if (numeric(entry.mBonusPerLevelAtAndAfter)) {
              rate = entry.mBonusPerLevelAtAndAfter;
            }
            value += Number(entry.mAdditionalBonusAtThisLevel ?? 0);
          }
          value += rate;
          if (value !== before) {
            changes.push({ level, value });
          }
        }

        return {
          text: `${changes.map((entry) => format(entry.value)).join('/')} (champion levels ${changes.map((entry) => entry.level).join('/')})`,
        };
      }
      default:
        return undefined;
    }
  }
  function calculation(name: string, seen = new Set<string>()): Expression | undefined {
    const key = name.toLowerCase();
    if (seen.has(key) || seen.size > 20) {
      return undefined;
    }
    const next = new Set(seen).add(key);
    const node = record(lookup(calculations, name));
    const base =
      node.__type === 'GameCalculation'
        ? sum(list(node.mFormulaParts).map((entry) => part(entry, next)))
        : node.__type === 'GameCalculationModified' &&
            typeof node.mModifiedGameCalculation === 'string'
          ? calculation(node.mModifiedGameCalculation, next)
          : undefined;
    let multiplier = node.mMultiplier ? part(node.mMultiplier, next) : number(1);
    if (node.mDisplayAsPercent) {
      multiplier = product(number(100), multiplier);
    }
    const result = product(multiplier, base);

    return result && node.mDisplayAsPercent ? { text: `(${result.text})%` } : result;
  }

  return spell.tooltip.replace(/\{\{\s*(.*?)\s*\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    if (key === 'spellmodifierdescriptionappend') {
      return '';
    }
    if (key === 'abilityresourcename') {
      return champion.partype;
    }
    const staticValue =
      key === 'cost'
        ? series(spell.cost)
        : key === 'cooldown'
          ? series(spell.cooldown)
          : key === 'range'
            ? series(spell.range)
            : undefined;
    const effectIndex = key.match(/^e(\d+)(?:tooltip)?$/)?.[1];
    const resolved =
      staticValue ??
      named(key) ??
      calculation(key) ??
      (effectIndex ? effect(Number(effectIndex)) : undefined);

    return resolved?.text ?? `[${rawKey}: unresolved formula]`;
  });
}

export function championTooltips(champion: Champion, raw: unknown): Champion {
  return {
    ...champion,
    spells: champion.spells.map((spell) => ({
      ...spell,
      tooltip: spellTooltip(champion, spell, raw),
    })),
  };
}
