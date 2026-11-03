import { z } from 'zod';
import type { Champion, Spell } from './types.js';
import { progressionSchema } from './schema.js';
import { required } from './assert.js';

const keys = ['Q', 'W', 'E', 'R'] as const;
const ultimateLevels = [6, 11, 16];
const recordSchema = z
  .object({
    __type: z.literal('CharacterRecord'),
    mCharacterPassiveSpell: z.string().optional(),
    SpellLevelUpInfoList: z
      .object({
        List: z.array(
          z
            .object({
              mRequirements: z
                .array(
                  z
                    .object({
                      mRequirements: z
                        .array(
                          z
                            .object({
                              __type: z.string(),
                              mLevel: z.number().optional(),
                            })
                            .passthrough(),
                        )
                        .optional(),
                    })
                    .passthrough(),
                )
                .optional(),
            })
            .passthrough(),
        ),
      })
      .optional(),
  })
  .passthrough();
const passiveDataSchema = z
  .object({
    mSpell: z
      .object({
        DataValues: z.array(z.object({ name: z.string(), values: z.array(z.number()) })).optional(),
      })
      .passthrough(),
  })
  .passthrough();

/** Decode game requirements once during data collection, never inside the overlay. */
export function extractSkillProgression(spells: Spell[], data: Record<string, unknown>) {
  const root = required(
    Object.values(data)
      .map((value) => recordSchema.safeParse(value))
      .find((result) => result.success)?.data,
    'Champion character record is missing',
  );
  const passive = passiveDataSchema.safeParse(data[root.mCharacterPassiveSpell ?? '']);
  const values = new Map(
    passive.success
      ? passive.data.mSpell.DataValues?.map((value) => [value.name, value.values[0]])
      : [],
  );
  const statRanks = values.get('MaxRanksPerStat');
  const isStatUpgrade =
    statRanks !== undefined && values.has('ADPerRank') && values.has('ASPerRank');
  const fourBasicAbilities = spells.every((spell) => spell.maxrank === 6);
  const totalRanks = spells.reduce((total, spell) => total + spell.maxrank, 0);
  const slots = keys.map((key, index) => {
    const spell = required(spells[index]);
    const raw = root.SpellLevelUpInfoList?.List[index]?.mRequirements;
    const levels = Array.from({ length: spell.maxrank }, (_, rank) => {
      const requirements = raw?.[rank]?.mRequirements;
      const defaultLevel =
        index === 3 && spell.maxrank === 3 ? (ultimateLevels[rank] ?? 18) : rank * 2 + 1;
      if (!raw) {
        return defaultLevel;
      }

      return Math.max(
        1,
        ...(requirements ?? [])
          .filter((requirement) => requirement.__type === 'CharacterLevelRequirement')
          .map((requirement) => requirement.mLevel ?? 1),
      );
    });
    let initialRank = 0;
    // Nineteen total ranks include a free starting rank on transformation/attachment kits.
    if (
      totalRanks === 19 &&
      ((index === 3 && [1, 4].includes(spell.maxrank)) || (index < 3 && levels[0] > 1))
    ) {
      initialRank = 1;
    }
    // Four basic stances have a script-controlled final-rank gate, beyond the ordinary basic gate.
    if (fourBasicAbilities) {
      levels[5] = Math.max(levels[5], required(ultimateLevels.at(-1)));
    }
    const slot: z.infer<typeof progressionSchema>['slots'][number] = {
      key,
      levels,
      initialRank,
      maxRank: spell.maxrank,
      automatic: index === 3 && spell.maxrank === 1,
    };
    if (isStatUpgrade) {
      if (index === 3) {
        slot.automatic = true;
      } else {
        const kinds = ['attackDamage', 'attackSpeed', 'armorPenetration'] as const;
        const names = ['ADPerRank', 'ASPerRank', 'APPerRank'];
        slot.maxRank = statRanks;
        slot.levels = Array.from({ length: statRanks }, () => 1);
        slot.stat = {
          kind: required(kinds[index]),
          perRank: required(values.get(required(names[index]))),
        };
      }
    }

    return slot;
  });

  return progressionSchema.parse({ slots });
}

/** Older cached catalogs keep standard progression available while an enriched snapshot is fetched. */
export function progressionFor(champion: Champion) {
  return (
    champion.progression ??
    progressionSchema.parse({
      slots: keys.map((key, index) => ({
        key,
        maxRank: champion.spells[index]?.maxrank ?? 0,
        initialRank: 0,
        automatic: false,
        levels: Array.from({ length: champion.spells[index]?.maxrank ?? 0 }, (_, rank) =>
          index === 3 ? (ultimateLevels[rank] ?? 18) : rank * 2 + 1,
        ),
      })),
    })
  );
}
