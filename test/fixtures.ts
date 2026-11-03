import type { LiveGame, Player } from '../src/core/types.js';
import { loadCatalog } from '../src/core/data.js';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { sessionSchema } from '../src/core/schema.js';
import { required } from '../src/core/assert.js';

const loadStarted = performance.now();
export const { catalog } = await loadCatalog(fileURLToPath(new URL('../data/', import.meta.url)));
export const catalogLoadMs = performance.now() - loadStarted;
export function completeSession() {
  const team = (aliases: string[], offset: number) =>
    aliases.map((alias, i) => ({
      cellId: offset + i,
      championId: required(catalog.champions.find((c) => c.alias === alias)).id,
      assignedPosition: ['top', 'jungle', 'middle', 'bottom', 'utility'][i],
    }));

  return sessionSchema.parse({
    gameId: 1,
    localPlayerCellId: 0,
    myTeam: team(['Shen', 'LeeSin', 'Annie', 'Jinx', 'Soraka'], 0),
    theirTeam: team(['Zaahen', 'Diana', 'Veigar', 'KogMaw', 'Lux'], 5),
  });
}
export function player(alias: string, team: string, overrides: Partial<Player> = {}): Player {
  return {
    championName: alias,
    rawChampionName: `game_character_displayname_${alias}`,
    team,
    level: 11,
    riotId: alias === 'Annie' ? 'Test#EUW' : `${alias}#EUW`,
    items: [],
    scores: { kills: 0, deaths: 0, assists: 0, creepScore: 100 },
    ...overrides,
  };
}
export function game(enemies: Player[] = []): LiveGame {
  return {
    activePlayer: {
      riotId: 'Test#EUW',
      level: 11,
      currentGold: 1800,
      abilities: {
        Q: { abilityLevel: 5 },
        W: { abilityLevel: 3 },
        E: { abilityLevel: 1 },
        R: { abilityLevel: 1 },
      },
      championStats: { abilityPower: 180, attackDamage: 65, abilityHaste: 20, critChance: 0 },
    },
    allPlayers: [player('Annie', 'ORDER'), ...enemies],
    gameData: { gameMode: 'CLASSIC', mapNumber: 11, gameTime: 900 },
  };
}
