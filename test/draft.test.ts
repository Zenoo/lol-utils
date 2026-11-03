import test from 'node:test';
import assert from 'node:assert/strict';
import { completedDraftKey, draftGame } from '../src/core/draft.js';
import { Engine } from '../src/core/engine.js';
import { catalog, completeSession } from './fixtures.js';
import { required } from '../src/core/assert.js';

test('draft context waits for ten selected champions and ignores API ordering', () => {
  const session = completeSession();
  const key = completedDraftKey(session);
  const game = required(draftGame(catalog, session));
  assert.equal(game.allPlayers.length, 10);
  assert.equal(game.allPlayers.find((p) => p.championName === 'Zaahen')?.position, 'TOP');
  session.theirTeam.reverse();
  assert.equal(completedDraftKey(session), key);
  session.theirTeam[0].championId = 0;
  assert.equal(completedDraftKey(session), '');
  assert.equal(draftGame(catalog, session), undefined);
});

test('both ally and enemy picks influence the completed draft model', () => {
  const engine = new Engine(catalog);
  const session = completeSession();
  const shen = required(catalog.champions.find((c) => c.alias === 'Shen'));
  const before = engine.context(shen, draftGame(catalog, session), 'TOP');
  const key = completedDraftKey(session);
  session.myTeam[1].championId = required(catalog.champions.find((c) => c.alias === 'Karthus')).id;
  const after = engine.context(shen, draftGame(catalog, session), 'TOP');
  assert.notEqual(completedDraftKey(session), key);
  assert.notEqual(before.teamMagic, after.teamMagic);
  const item = required(engine.items.get(2510));
  assert.notEqual(
    engine.scoreItem(item, shen, undefined, before).score,
    engine.scoreItem(item, shen, undefined, after).score,
  );
  session.theirTeam[0].championId = required(
    catalog.champions.find((c) => c.alias === 'Malphite'),
  ).id;
  assert.notEqual(engine.context(shen, draftGame(catalog, session), 'TOP').healing, before.healing);
});
