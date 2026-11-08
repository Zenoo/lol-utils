import { z } from 'zod';

export const runeReferencesSchema = z.array(
  z.object({
    champion: z.string(),
    role: z.string(),
    provider: z.string(),
    url: z.url(),
    patch: z.string(),
    observedAt: z.string(),
    population: z.string(),
    sourceSha256: z.string(),
    selectedPerkIds: z.array(z.number().int().positive()).length(9),
  }),
);

/** Only the first displayed page, excluding dimmed alternatives and duplicate responsive layouts. */
export function parseOpggRunes(html: string): number[] {
  const images = [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0]);
  const selected = images.filter((tag) => /\bopacity-100\b/.test(tag));
  const perks = selected
    .flatMap((tag) => {
      const id = tag.match(/\/perk\/(\d+)\.png/);

      return id ? [Number(id[1])] : [];
    })
    .slice(0, 6);
  const shards = selected
    .flatMap((tag) => {
      const id = tag.match(/\/perkShard\/(\d+)\.png/);

      return id ? [Number(id[1])] : [];
    })
    .slice(0, 3);
  if (perks.length !== 6 || shards.length !== 3 || new Set(perks).size !== 6) {
    throw new Error('OP.GG selected rune page missing; review the source manually');
  }

  return [...perks, ...shards];
}

export function compareRunes(actual: number[], expected: number[]) {
  return {
    keystone: actual[0] === expected[0],
    primary: expected.slice(0, 4).filter((id) => actual.slice(0, 4).includes(id)).length / 4,
    secondary: expected.slice(4, 6).filter((id) => actual.slice(4, 6).includes(id)).length / 2,
    shards: expected.slice(6).filter((id, index) => actual[index + 6] === id).length / 3,
  };
}

export function parseLolalyticsRunes(html: string): number[] {
  const section = html.slice(html.indexOf('Primary Runes'), html.indexOf('Starting Items'));
  const ids = [...section.matchAll(/<img\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => !/grayscale|opacity-/.test(tag))
    .flatMap((tag) => {
      const id = tag.match(/src="[^" ]*\/(?:rune68|statmod32)\/(\d+)\.webp/);

      return id ? [Number(id[1])] : [];
    });
  if (ids.length !== 9 || new Set(ids.slice(0, 6)).size !== 6) {
    throw new Error('LoLalytics selected rune page missing; review source manually');
  }

  return ids;
}
