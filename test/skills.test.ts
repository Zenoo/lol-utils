import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/core/engine.js';
import { progressionFor } from '../src/core/skill-progression.js';
import { required } from '../src/core/assert.js';
import { catalog } from './fixtures.js';

const engine = new Engine(catalog);
test('every champion can spend all 18 points without violating extracted gates or levelling automatic slots', () => {
  for (const champion of catalog.champions) {
    assert.ok(champion.progression, champion.name);
    const progression = progressionFor(champion);
    const ranks = Object.fromEntries(progression.slots.map((slot) => [slot.key, slot.initialRank]));
    for (let level = 1; level <= 18; level++) {
      for (const slot of progression.slots.filter((slot) => slot.automatic)) {
        ranks[slot.key] = slot.levels.filter((gate) => gate <= level).length;
      }
      const suggestion = engine.skill(champion, level, ranks);
      const key = required(
        suggestion.key,
        `${champion.name} has no legal suggestion at level ${level}`,
      );
      const slot = required(progression.slots.find((slot) => slot.key === key));
      assert.equal(slot.automatic, false, champion.name);
      assert.ok(ranks[key] < slot.maxRank, champion.name);
      assert.ok(level >= required(slot.levels[ranks[key]]), `${champion.name}: ${key} gate`);
      ranks[key]++;
      assert.equal(engine.skill(champion, level, ranks).key, null, `${champion.name}: spent point`);
    }
  }
});
test('free transformation and attachment ranks do not consume the first earned skill point', () => {
  for (const alias of ['Karma', 'Elise', 'Nidalee', 'Jayce', 'Yuumi']) {
    const champion = required(catalog.champions.find((champion) => champion.alias === alias));
    const progression = progressionFor(champion);
    const ranks = Object.fromEntries(progression.slots.map((slot) => [slot.key, slot.initialRank]));
    assert.equal(
      Object.values(ranks).reduce((a, b) => a + b, 0),
      1,
      alias,
    );
    assert.ok(engine.skill(champion, 1, ranks).key, alias);
  }
});
test('four-stance sixth ranks unlock at 16 and six-rank ordinary basics retain their own gates', () => {
  const udyr = required(catalog.champions.find((champion) => champion.alias === 'Udyr'));
  assert.ok(progressionFor(udyr).slots.every((slot) => slot.levels[5] === 16));
  const ranks = { Q: 5, W: 5, E: 0, R: 0 };
  assert.ok(!['Q', 'W'].includes(required(engine.skill(udyr, 11, ranks).key)));
  const yuumi = required(catalog.champions.find((champion) => champion.alias === 'Yuumi'));
  assert.equal(progressionFor(yuumi).slots[0].levels[5], 11);
});
test('Aphelios suggests labelled stat upgrades and ignores automatically learned R in point accounting', () => {
  const champion = required(catalog.champions.find((champion) => champion.alias === 'Aphelios'));
  const progression = progressionFor(champion);
  assert.equal(progression.slots[3].automatic, true);
  assert.deepEqual(
    progression.slots.slice(0, 3).map((slot) => slot.stat?.kind),
    ['attackDamage', 'attackSpeed', 'armorPenetration'],
  );
  const suggestion = engine.skill(champion, 6, { Q: 2, W: 2, E: 1, R: 1 });
  assert.ok(suggestion.key && suggestion.key !== 'R');
  assert.ok(suggestion.label);
  assert.match(suggestion.reason, /Stat rank/);
});
