import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, eligible } from '../src/core/engine.js';
import { extractItemRules } from '../src/core/item-rules.js';
import { questKind } from '../src/core/role-items.js';
import { required } from '../src/core/assert.js';
import { catalog, game, player } from './fixtures.js';

const engine = new Engine(catalog);
const champion = required(catalog.champions.find((champion) => champion.alias === 'Annie'));
test('omitted binary numeric values decode as zero without dropping a complete item definition', () => {
  const rules = extractItemRules({
    test: { __type: 'ItemData', itemID: 1, mDataValues: [{ mName: 'Zero' }] },
  });
  assert.equal(rules.get(1)?.values.Zero, 0);
});
test('jungle pets require the jungle role and Smite, and are valued for their distinct quest rewards', () => {
  const starters = engine.starters(champion, 500, 'JUNGLE');
  assert.equal(starters.length, 3);
  assert.ok(
    starters.every(
      (result) =>
        questKind(result.item) === 'jungle' &&
        result.score > 0 &&
        result.reasons.some((reason) => reason.includes('quest completion')),
    ),
  );
  assert.equal(new Set(starters.map((result) => result.score)).size > 1, true);
  for (const result of starters) {
    assert.equal(
      eligible(result.item, champion, 11, { role: 'MIDDLE', spells: ['SummonerSmite'] }),
      false,
    );
    assert.equal(
      eligible(result.item, champion, 11, {
        role: 'JUNGLE',
        spells: ['SummonerFlash', 'SummonerHeal'],
      }),
      false,
    );
    assert.equal(
      eligible(result.item, champion, 11, { role: 'JUNGLE', spells: ['SummonerSmite'] }),
      true,
    );
  }
});
test('support starter, automatic transformations, and completed reward choices have separate purchase gates', () => {
  const atlas = required(engine.items.get(3865));
  const rewards = engine.roleRewards(champion, 'UTILITY');
  assert.equal(engine.starters(champion, 500, 'UTILITY')[0]?.item.id, atlas.id);
  assert.equal(rewards.length, 5);
  assert.equal(eligible(atlas, champion, 11, { role: 'MIDDLE' }), false);
  for (const reward of rewards) {
    assert.equal(eligible(reward.item, champion, 11, { role: 'UTILITY', owned: [3865] }), false);
    assert.equal(eligible(reward.item, champion, 11, { role: 'UTILITY', owned: [3867] }), true);
    assert.equal(eligible(reward.item, champion, 11, { role: 'MIDDLE', owned: [3867] }), false);
  }
  for (const id of [3866, 3867]) {
    assert.equal(
      eligible(required(engine.items.get(id)), champion, 11, { role: 'UTILITY' }),
      false,
    );
  }
  const build = engine.build(champion, 11, 'UTILITY');
  assert.equal(build.length, 6);
  assert.equal(
    build.filter((id) => questKind(required(engine.items.get(id))) === 'support').length,
    1,
  );
});
test('support rewards account for proc conditions and ordinary gold-generating combat items remain available', () => {
  const soraka = required(catalog.champions.find((champion) => champion.alias === 'Soraka'));
  const brand = required(catalog.champions.find((champion) => champion.alias === 'Brand'));
  const dreamMaker = required(engine.items.get(3870));
  assert.ok(
    engine.scoreItem(dreamMaker, soraka, undefined, engine.context(soraka, undefined, 'UTILITY'))
      .score >
      engine.scoreItem(dreamMaker, brand, undefined, engine.context(brand, undefined, 'UTILITY'))
        .score,
  );
  assert.equal(questKind(required(engine.items.get(4646))), undefined);
  assert.equal(eligible(required(engine.items.get(4646)), champion), true);
});
test('live shop keeps completed targets and offers the zero-gold reward at the correct stage without duplicate quest items', () => {
  const live = game();
  live.allPlayers[0] = player('Annie', 'ORDER', { position: 'UTILITY' });
  live.activePlayer.currentGold = 500;
  assert.ok(
    engine
      .nextBuys(champion, live)
      .every((result) => result.item.rules?.tier === 5 || result.item.tags.includes('Boots')),
  );
  live.allPlayers[0].items = [{ itemID: 3867, count: 1, slot: 0 }];
  live.activePlayer.currentGold = 0;
  const rewards = engine.nextBuys(champion, live);
  assert.ok(
    rewards.some(
      (result) => questKind(result.item) === 'support' && result.cost === 0 && result.affordable,
    ),
  );
  live.allPlayers[0].items = [1058, 3089, 3157, 3135, 3020, 3118].map((itemID, slot) => ({
    itemID,
    count: 1,
    slot,
  }));
  live.allPlayers[0].items.push({ itemID: 3867, count: 1, slot: 8 });
  assert.ok(
    engine
      .nextBuys(champion, live)
      .some((result) => questKind(result.item) === 'support' && result.cost === 0),
  );
  live.allPlayers[0].items = [{ itemID: 3870, count: 1, slot: 0 }];
  assert.ok(engine.nextBuys(champion, live).every((result) => !questKind(result.item)));
});
test('consumed jungle pets are not suggested again after their quest has progressed', () => {
  const live = game();
  live.allPlayers[0].position = 'JUNGLE';
  live.activePlayer.currentGold = 500;
  assert.ok(engine.nextBuys(champion, live).every((result) => questKind(result.item) !== 'jungle'));
  assert.ok(
    engine
      .nextBuys(champion, live, { roleQuestPurchased: true })
      .every((result) => questKind(result.item) !== 'jungle'),
  );
});
