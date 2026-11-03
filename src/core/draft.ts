import type { Catalog, LiveGame, Player, Session } from './types.js';

/** Stable across API ordering and unrelated timer/action changes. Hovers (ID zero) do not count. */
export function completedDraftKey(session: Session): string {
  if (
    session.myTeam.length !== 5 ||
    session.theirTeam.length !== 5 ||
    [...session.myTeam, ...session.theirTeam].some((p) => !p.championId)
  ) {
    return '';
  }
  const team = (players: Session['myTeam']) =>
    [...players]
      .sort((a, b) => a.cellId - b.cellId)
      .map((p) => [p.cellId, p.championId, p.assignedPosition ?? '']);

  return JSON.stringify([session.gameId, team(session.myTeam), team(session.theirTeam)]);
}

/** Draft observations have no invented kills or inventories; lane roles are used only if known. */
export function draftGame(catalog: Catalog, session: Session): LiveGame | undefined {
  if (!completedDraftKey(session)) {
    return undefined;
  }
  const players: Player[] = [];
  for (const [team, selections] of [
    ['ORDER', session.myTeam],
    ['CHAOS', session.theirTeam],
  ] as const) {
    for (const selection of selections) {
      const champ = catalog.champions.find((c) => c.id === selection.championId);
      if (!champ) {
        return undefined;
      }
      players.push({
        championName: champ.alias,
        team,
        riotId: `cell-${selection.cellId}`,
        position: selection.assignedPosition?.toUpperCase(),
        level: 1,
        items: [],
        scores: { kills: 0, deaths: 0, assists: 0, creepScore: 0 },
      });
    }
  }

  return {
    activePlayer: {
      riotId: `cell-${session.localPlayerCellId}`,
      level: 1,
      currentGold: 0,
      abilities: {},
      championStats: {},
    },
    allPlayers: players,
    gameData: { mapNumber: 11, gameMode: 'CLASSIC', gameTime: 0 },
  };
}
