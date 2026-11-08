import type { Champion, Spell } from './types.js';
import { nestedTooltipBindings, scriptTooltipBindings } from './spell-tooltip-bindings.js';

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
  values?: number[];
}
const number = (value: number): Expression => ({ text: format(value), value });
function series(values: number[]): Expression | undefined {
  if (!values.length || !values.every(numeric)) {
    return undefined;
  }

  return values.every((value) => Math.abs(value - values[0]) < 1e-6)
    ? number(values[0])
    : { text: values.map(format).join('/'), values };
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
  if (a.value !== undefined && b.values) {
    const multiplier = a.value;

    return series(b.values.map((value) => value * multiplier));
  }
  if (b.value !== undefined && a.values) {
    const multiplier = b.value;

    return series(a.values.map((value) => value * multiplier));
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
export function spellTooltip(
  champion: Pick<Champion, 'alias' | 'spells' | 'partype'>,
  spell: Spell,
  raw: unknown,
  trail = new Set<string>(),
): string {
  const game = record(raw);
  const root = record(game[`Characters/${champion.alias}/CharacterRecords/Root`]);
  const index = champion.spells.indexOf(spell);
  const rootName = list(root.spellNames)[index];
  const exact = record(
    Object.values(game).find((value) => {
      const entry = record(value);

      return (
        entry.__type === 'SpellObject' &&
        [entry.mScriptName, entry.ObjectName].some(
          (name) => typeof name === 'string' && name.toLowerCase() === spell.id.toLowerCase(),
        )
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
      // Omitted BIN fields have the type's zero default; an absent named entry
      // is still unknown and must never be treated as zero.
      data[entry.name] = entry.values ?? Array(7).fill(0);
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
  function crossSpell(objectName: string, key: string): Expression | undefined {
    const entry = record(
      game[objectName] ??
        Object.values(game).find((value) => {
          const entry = record(value);

          return [entry.ObjectName, entry.mScriptName].some(
            (name) => typeof name === 'string' && name.toLowerCase() === objectName.toLowerCase(),
          );
        }),
    );
    const id = String(entry.ObjectName ?? entry.mScriptName ?? '');
    if (!id || trail.has(`${id.toLowerCase()}:${key.toLowerCase()}`)) {
      return undefined;
    }
    const target = champion.spells.find((entry) => entry.id.toLowerCase() === id.toLowerCase());
    const result = spellTooltip(
      champion,
      { ...(target ?? spell), id, tooltip: `{{ ${key} }}` },
      game,
      new Set(trail).add(`${id.toLowerCase()}:${key.toLowerCase()}`),
    );
    if (result.includes('unresolved formula')) {
      return undefined;
    }

    return /^-?\d+(?:\.\d+)?$/.test(result)
      ? number(Number(result))
      : { text: result + (target && target.id !== spell.id ? ` (${target.name} ranks)` : '') };
  }
  function statLabel(node: Record<string, unknown>) {
    const labels: Record<number, string> = {
      0: 'AP',
      1: 'armor',
      2: 'AD',
      4: 'attack speed',
      6: 'magic resistance',
      7: 'movement speed',
      8: 'critical strike chance',
      9: 'critical strike damage',
      10: 'cooldown modifier',
      12: 'maximum health',
      13: 'current health',
      14: 'health fraction',
      15: 'missing health',
      16: 'missing health fraction',
      18: 'life steal',
      29: 'lethality',
      31: 'ability haste',
    };
    const label = labels[Number(node.mStat ?? 0)];
    if (!label) {
      return undefined;
    }

    return `${node.mStatFormula === 2 ? 'bonus ' : node.mStatFormula === 1 ? 'base ' : Number(node.mStat ?? 0) === 2 ? 'total ' : ''}${label}`;
  }
  function part(input: unknown, seen: Set<string>): Expression | undefined {
    const node = record(input);
    if (typeof node.StartDataValue === 'string' && typeof node.EndDataValue === 'string') {
      const start = named(node.StartDataValue),
        end = named(node.EndDataValue);

      return start && end
        ? { text: `${start.text}-${end.text} (champion levels 1-18)` }
        : undefined;
    }
    if (typeof node.SourceObject === 'string' && typeof node['{3de6ce2d}'] === 'string') {
      return crossSpell(node.SourceObject, node['{3de6ce2d}']);
    }
    if (typeof node.mSpellCalculationKey === 'string') {
      return calculation(node.mSpellCalculationKey, seen);
    }
    switch (node.__type) {
      case 'NumberCalculationPart':
        return number(numeric(node.mNumber) ? node.mNumber : 0);
      case 'NamedDataValueCalculationPart':
        return named(String(node.mDataValue));
      case 'EffectValueCalculationPart':
        return effect(Number(node.mEffectIndex));
      case 'StatByNamedDataValueCalculationPart':
      case 'StatByCoefficientCalculationPart': {
        const label = statLabel(node);
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

        return { text: `${percent.text}% ${label}` };
      }
      case 'StatBySubPartCalculationPart': {
        const label = statLabel(node);

        return label ? product(part(node.mSubpart, seen), { text: label }) : undefined;
      }
      case 'CooldownMultiplierCalculationPart':
        return { text: '(100 / (100 + ability haste))' };
      case 'AbilityResourceByCoefficientCalculationPart':
        return {
          text: `${format(Number(node.mCoefficient ?? 0) * 100)}% ${node.mStatFormula === 2 ? 'bonus ' : 'maximum '}${champion.partype.toLowerCase()}`,
        };
      case 'BuffCounterByCoefficientCalculationPart':
        return { text: `${format(Number(node.mCoefficient ?? 0))} per current stack` };
      case 'BuffCounterByNamedDataValueCalculationPart': {
        const value = named(String(node.mDataValue));

        return value ? { text: `${value.text} per current stack` } : undefined;
      }
      case 'ByCharLevelFormulaCalculationPart': {
        const values = list(node.values).slice(1, 19);

        return values.length === 18 && values.every(numeric)
          ? { text: `${values.map(format).join('/')} (champion levels 1-18)` }
          : undefined;
      }
      case 'ClampSubPartsCalculationPart': {
        const value = sum(list(node.mSubparts).map((entry) => part(entry, seen)));
        if (!value) {
          return undefined;
        }
        const floor = numeric(node.mFloor) ? node.mFloor : -Infinity;
        const ceiling = numeric(node.mCeiling) ? node.mCeiling : Infinity;

        return value.value !== undefined
          ? number(Math.max(floor, Math.min(ceiling, value.value)))
          : { text: `clamp(${value.text}, ${floor}, ${ceiling})` };
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
    if (node.__type === 'GameCalculationConditional') {
      const normal = calculation(String(node.mDefaultGameCalculation), next);
      const conditional = calculation(String(node.mConditionalGameCalculation), next);

      return normal && conditional
        ? { text: `${normal.text} (normal); ${conditional.text} (conditional form)` }
        : undefined;
    }
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

  const template =
    spell.tooltip.includes('{{') && /\{\{\s*Spell_/i.test(spell.tooltip)
      ? (nestedTooltipBindings[spell.id] ?? spell.tooltip)
      : spell.tooltip;

  return template.replace(/\{\{\s*(.*?)\s*\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    const arithmetic = key.match(/^(.*?)([*/])(-?\d+(?:\.\d+)?)$/);
    if (arithmetic) {
      const inner = spellTooltip(
        champion,
        { ...spell, tooltip: `{{ ${arithmetic[1]} }}` },
        game,
        trail,
      );
      if (!inner.includes('unresolved formula')) {
        const multiplier =
          arithmetic[2] === '*' ? Number(arithmetic[3]) : 1 / Number(arithmetic[3]);
        const numbers = inner.split('/').map(Number);

        return numbers.every(Number.isFinite)
          ? (series(numbers.map((value) => value * multiplier))?.text ?? inner)
          : `${format(multiplier)} * (${inner})`;
      }
    }
    const reference = key.match(/^spell\.([^:]+):(.+)$/);
    if (reference) {
      const value = crossSpell(reference[1], reference[2]);
      if (value) {
        return value.text;
      }
    }
    if (key === 'spellmodifierdescriptionappend') {
      return '';
    }
    if (key === 'abilityresourcename') {
      return champion.partype;
    }
    // Precision suffixes control in-client rounding, not the parameter name.
    const unformatted = key.replace(/\.\d+$/, '');
    if (unformatted !== key) {
      return spellTooltip(champion, { ...spell, tooltip: `{{ ${unformatted} }}` }, game, trail);
    }
    const binding = scriptTooltipBindings[spell.id]?.[key];
    if (binding) {
      return spellTooltip(champion, { ...spell, tooltip: binding }, game, trail);
    }
    const staticValue =
      key === 'cost'
        ? series(spell.cost)
        : key === 'cooldown'
          ? series(spell.cooldown)
          : key === 'range'
            ? series(spell.range)
            : key === 'ammorechargetime'
              ? ranks(source.mAmmoRechargeTime)
              : key === 'maxammo'
                ? ranks(source.mMaxAmmo)
                : undefined;
    const effectIndex = key.match(/^(?:e(\d+)(?:tooltip)?|effect(\d+)amount)$/);
    const resolved =
      staticValue ??
      named(key) ??
      calculation(key) ??
      (effectIndex ? effect(Number(effectIndex[1] ?? effectIndex[2])) : undefined);

    return resolved?.text ?? `[${rawKey}: unresolved formula]`;
  });
}

export function championTooltips<T extends Pick<Champion, 'alias' | 'spells' | 'partype'>>(
  champion: T,
  raw: unknown,
): T {
  return {
    ...champion,
    spells: champion.spells.map((spell) => ({
      ...spell,
      tooltip: spellTooltip(champion, spell, raw),
    })),
  };
}
