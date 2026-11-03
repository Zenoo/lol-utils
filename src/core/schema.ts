import { z } from 'zod';

const numeric = z.record(z.string(), z.number());
export const imageSchema = z.object({ full: z.string() }).passthrough();
const passiveSchema = z.object({ name: z.string(), description: z.string() }).passthrough();
export const progressionSchema = z.object({
  slots: z
    .array(
      z.object({
        key: z.enum(['Q', 'W', 'E', 'R']),
        maxRank: z.number().int(),
        levels: z.array(z.number().int()),
        initialRank: z.number().int(),
        automatic: z.boolean(),
        stat: z
          .object({
            kind: z.enum(['attackDamage', 'attackSpeed', 'armorPenetration']),
            perRank: z.number(),
          })
          .optional(),
      }),
    )
    .length(4),
});
export const spellSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    tooltip: z.string(),
    maxrank: z.number(),
    cooldown: z.array(z.number()),
    cost: z.array(z.number()),
    range: z.array(z.number()),
    vars: z.array(z.record(z.string(), z.unknown())),
    effect: z.array(z.array(z.number()).nullable()).optional(),
  })
  .passthrough();
export const championSourceSchema = z
  .object({
    id: z.number(),
    alias: z.string(),
    tacticalInfo: z.object({ damageType: z.string(), style: z.number() }).passthrough(),
    playstyleInfo: z
      .object({
        durability: z.number(),
        utility: z.number(),
        crowdControl: z.number(),
        mobility: z.number(),
      })
      .passthrough(),
    championTagInfo: z.object({ championTagPrimary: z.string() }).passthrough(),
    roles: z.array(z.string()),
    spells: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();
export const championSchema = z
  .object({
    progression: progressionSchema.optional(),
    id: z.number().int(),
    alias: z.string(),
    name: z.string(),
    title: z.string(),
    lore: z.string(),
    stats: numeric,
    spells: z.array(spellSchema),
    source: championSourceSchema,
    tags: z.array(z.string()),
    partype: z.string(),
    passive: passiveSchema,
    image: imageSchema,
  })
  .passthrough();
export const itemSourceSchema = z
  .object({
    id: z.number(),
    inStore: z.boolean(),
    requiredChampion: z.string().optional(),
    requiredAlly: z.string().optional(),
    requiredBuffCurrencyName: z.string().optional(),
    specialRecipe: z.number().optional(),
  })
  .passthrough();
export const itemSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string(),
    stats: numeric,
    gold: z.object({
      total: z.number(),
      base: z.number(),
      purchasable: z.boolean(),
      sell: z.number(),
    }),
    tags: z.array(z.string()),
    maps: z.record(z.string(), z.boolean()),
    source: itemSourceSchema.nullable(),
    from: z.array(z.string()).optional(),
    into: z.array(z.string()).optional(),
    consumed: z.boolean().optional(),
    image: imageSchema,
    rules: z
      .object({
        requiredSpell: z.string().optional(),
        tier: z.number().optional(),
        groups: z.array(z.string()),
        stats: numeric,
        limits: numeric,
        values: numeric,
        calculations: z.record(z.string(), z.unknown()),
      })
      .nullable()
      .optional(),
  })
  .passthrough();
export const perkSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    longDesc: z.string(),
    shortDesc: z.string(),
    recommendationDescriptorAttributes: numeric,
  })
  .passthrough();
export const runeStyleSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    slots: z.array(z.object({ perks: z.array(z.number()) })),
  })
  .passthrough();
export const perkStylesSchema = z
  .object({
    styles: z.array(
      z
        .object({
          id: z.number(),
          allowedSubStyles: z.array(z.number()),
          slots: z.array(z.object({ type: z.string(), perks: z.array(z.number()) }).passthrough()),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export const summonerSchema = z
  .object({
    id: z.number().int(),
    alias: z.string(),
    name: z.string(),
    description: z.string(),
    modes: z.array(z.string()),
    summonerLevel: z.number(),
    cooldown: z.array(z.number()),
    image: imageSchema,
  })
  .passthrough();
export const catalogSchema = z.object({
  version: z.string(),
  patch: z.string(),
  locale: z.string(),
  champions: z.array(championSchema),
  items: z.array(itemSchema),
  perks: z.array(perkSchema),
  runeStyles: z.array(runeStyleSchema),
  perkStyles: perkStylesSchema,
  summoners: z.array(summonerSchema),
  maps: z.record(z.string(), z.unknown()),
  languages: z.array(z.string()),
});
export const manifestSchema = z.object({
  version: z.string(),
  patch: z.string(),
  locale: z.string(),
  fetchedAt: z.string(),
  catalogSha256: z.string(),
  sources: z.array(z.object({ url: z.string(), file: z.string(), sha256: z.string() })),
  counts: z.object({
    champions: z.number(),
    items: z.number(),
    perks: z.number(),
    summoners: z.number(),
  }),
});
export const playerSchema = z
  .object({
    summonerSpells: z
      .object({
        summonerSpellOne: z
          .object({ displayName: z.string().optional(), rawDisplayName: z.string().optional() })
          .passthrough(),
        summonerSpellTwo: z
          .object({ displayName: z.string().optional(), rawDisplayName: z.string().optional() })
          .passthrough(),
      })
      .optional(),
    position: z.string().optional(),
    championName: z.string(),
    rawChampionName: z.string().optional(),
    team: z.string(),
    level: z.number(),
    riotId: z.string().optional(),
    summonerName: z.string().optional(),
    items: z.array(
      z.object({ itemID: z.number(), count: z.number(), slot: z.number() }).passthrough(),
    ),
    scores: z
      .object({
        kills: z.number(),
        deaths: z.number(),
        assists: z.number(),
        creepScore: z.number(),
      })
      .passthrough(),
  })
  .passthrough();
export const liveGameSchema = z.object({
  activePlayer: z
    .object({
      riotId: z.string().optional(),
      summonerName: z.string().optional(),
      level: z.number(),
      currentGold: z.number(),
      abilities: z.record(
        z.string(),
        z.object({ abilityLevel: z.number().optional() }).passthrough(),
      ),
      championStats: z.record(z.string(), z.union([z.number(), z.string()])),
    })
    .passthrough(),
  allPlayers: z.array(playerSchema),
  gameData: z
    .object({
      gameMode: z.string(),
      mapNumber: z.number(),
      gameTime: z.number(),
      gameVersion: z.string().optional(),
    })
    .passthrough(),
});
export const selectionSchema = z
  .object({
    cellId: z.number(),
    championId: z.number(),
    assignedPosition: z.string().optional(),
  })
  .passthrough();
export const sessionSchema = z
  .object({
    localPlayerCellId: z.number(),
    gameId: z.number().optional(),
    myTeam: z.array(selectionSchema),
    theirTeam: z.array(selectionSchema).default([]),
  })
  .passthrough();
export const summonerAccountSchema = z
  .object({ summonerId: z.number().int(), summonerLevel: z.number() })
  .passthrough();
export const flowSchema = z
  .object({
    gameData: z
      .object({ queue: z.object({ gameMode: z.string(), mapId: z.number() }).passthrough() })
      .passthrough(),
  })
  .passthrough();
export const runePagesSchema = z.array(
  z.object({ id: z.number(), name: z.string(), isEditable: z.boolean() }).passthrough(),
);
export const spellInventorySchema = z.object({ spells: z.array(z.number().int()) }).passthrough();
export const itemSetSchema = z.object({ uid: z.string() }).passthrough();
export const itemSetsSchema = z.object({ itemSets: z.array(itemSetSchema) }).passthrough();

// Upstream static files differ from the normalized numeric-ID catalog.
export const championIndexSchema = z.object({
  data: z.record(z.string(), z.object({ id: z.string(), key: z.string() }).passthrough()),
});
export const championDetailSchema = z.object({
  data: z.record(
    z.string(),
    championSchema.omit({ source: true, alias: true }).extend({ id: z.string(), key: z.string() }),
  ),
});
export const itemsFileSchema = z.object({
  data: z.record(z.string(), itemSchema.omit({ id: true, source: true })),
});
export const summonersFileSchema = z.object({
  data: z.record(
    z.string(),
    summonerSchema.omit({ alias: true }).extend({ id: z.string(), key: z.string() }),
  ),
});
export const runesFileSchema = z.array(
  runeStyleSchema.extend({
    slots: z.array(z.object({ runes: z.array(z.object({ id: z.number() }).passthrough()) })),
  }),
);
