import { required } from '../src/core/assert.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Engine,
  activePlayer,
  eligible,
  growth,
  purchase,
  profile,
  passiveKeys,
} from '../src/core/engine.js';
import type { Item } from '../src/core/types.js';
import { catalog, game, player } from './fixtures.js';

const engine = new Engine(catalog);
const annie = required(catalog.champions.find((c) => c.alias === 'Annie'));
const makeItem = (id: number, cost: number, from: number[] = []): Item => ({
  id,
  name: `Test ${id}`,
  gold: { total: cost, base: from.length ? 100 : cost, sell: 0, purchasable: true },
  from: from.map(String),
  description: '',
  stats: {},
  tags: [],
  maps: { '11': true },
  source: { id, inStore: true },
  image: { full: `${id}.png` },
  rules: { tier: 5, groups: [], stats: {}, limits: {}, values: {}, calculations: {} },
});

test('recipe expansion credits each owned copy once, including repeated nested components', () => {
  const a = makeItem(1, 300),
    b = makeItem(2, 700, [1, 1]),
    c = makeItem(3, 1100, [2, 1]);
  const map = new Map([a, b, c].map((i) => [i.id, i]));
  assert.equal(purchase(c, [1], map).cost, 800);
  assert.equal(purchase(c, [1, 1], map).cost, 500);
  assert.equal(purchase(c, [2], map).cost, 400);
  assert.equal(purchase(c, [2, 1], map).cost, 100);
  assert.equal(purchase(c, [1, 1, 1, 1], map).consumed.length, 3);
});
test('cycles fail rather than recurse indefinitely', () => {
  const a = makeItem(1, 100, [2]),
    b = makeItem(2, 100, [1]);
  assert.throws(
    () =>
      purchase(
        a,
        [],
        new Map([
          [1, a],
          [2, b],
        ]),
      ),
    /cycle/,
  );
});
test('legality excludes map-restricted, transformed, champion-locked, consumable and jungle items', () => {
  const base = makeItem(1, 300);
  assert.equal(eligible(base, annie), true);
  for (const patch of [
    { maps: { '11': false } },
    { source: { inStore: true, requiredChampion: 'Other' } },
    { source: { inStore: true, requiredBuffCurrencyName: 'Quest' } },
    { tags: ['Consumable'] },
    { tags: ['Jungle'] },
    { gold: { ...base.gold, purchasable: false } },
  ]) {
    assert.equal(eligible({ ...base, ...patch } as Item, annie), false);
  }
});
test('every champion gets a valid nine-perk page with distinct secondary slots and current shards', () => {
  for (const champ of catalog.champions) {
    const page = engine.runes(champ);
    assert.equal(page.selectedPerkIds.length, 9, champ.name);
    assert.notEqual(page.primaryStyleId, page.subStyleId);
    const primary = required(catalog.runeStyles.find((s) => s.id === page.primaryStyleId));
    primary.slots.forEach((slot, index) =>
      assert.ok(slot.perks.includes(page.selectedPerkIds[index]), champ.name),
    );
    const secondary = required(catalog.runeStyles.find((s) => s.id === page.subStyleId));
    const slots = page.selectedPerkIds
      .slice(4, 6)
      .map((id) => secondary.slots.findIndex((s) => s.perks.includes(id)));
    assert.ok(slots.every((s) => s > 0));
    assert.notEqual(slots[0], slots[1]);
    const shards = required(
      catalog.perkStyles.styles.find((s) => s.id === page.primaryStyleId),
    ).slots.filter((s) => s.type === 'kStatMod');
    shards.forEach((s, i) => assert.ok(s.perks.includes(page.selectedPerkIds[6 + i])));
  }
});
test('builds for the complete roster contain six distinct purchasable Rift items and exactly one pair of boots', () => {
  for (const champ of catalog.champions) {
    const build = engine.build(champ);
    assert.equal(build.length, 6, champ.name);
    assert.equal(new Set(build).size, build.length, champ.name);
    assert.ok(
      build.every((id) => eligible(required(engine.items.get(id)), champ)),
      champ.name,
    );
    assert.ok(
      build.filter((id) => required(engine.items.get(id)).tags.includes('Boots')).length === 1,
      champ.name,
    );
  }
});
test('finished builds respect game-defined group limits across the complete roster', () => {
  for (const champ of catalog.champions) {
    const build = engine.build(champ);
    const counts = new Map<string, number>();
    for (const id of build) {
      const item = required(engine.items.get(id));
      assert.ok(item.rules?.tier === 5 || (item.tags.includes('Boots') && item.rules?.tier === 4));
      for (const group of item.rules?.groups ?? []) {
        counts.set(group, (counts.get(group) ?? 0) + 1);
      }
    }
    for (const id of build) {
      for (const [group, limit] of Object.entries(engine.items.get(id)?.rules?.limits ?? {})) {
        assert.ok((counts.get(group) ?? 0) <= limit, `${champ.name}: ${group}`);
      }
    }
  }
});
test('misleading Rift map flags do not admit prismatic variants or ARAM starter items', () => {
  for (const id of [3112, 664644]) {
    const item = required(engine.items.get(id));
    assert.equal(item.maps['11'], true);
    assert.equal(eligible(item, annie), false);
  }
  assert.ok(engine.starters(annie).every((result) => result.item.rules?.tier === 1));
  assert.ok(engine.build(annie).every((id) => engine.items.get(id)?.rules?.tier !== 1));
});
test('support utility changes with the strength of observed allied carries', () => {
  const support = required(catalog.champions.find((champ) => champ.alias === 'Soraka'));
  const item = required(engine.items.get(3107));
  const neutral = game(),
    ahead = game();
  neutral.allPlayers.push(player('Jinx', 'ORDER'));
  ahead.allPlayers.push(
    player('Jinx', 'ORDER', { scores: { kills: 15, assists: 10, deaths: 0, creepScore: 200 } }),
  );
  assert.ok(
    engine.scoreItem(item, support, ahead).score > engine.scoreItem(item, support, neutral).score,
  );
});
test('physical and magical fed opponents change defensive priorities', () => {
  const champ = required(catalog.champions.find((c) => c.alias === 'Malphite'));
  const fed = { scores: { kills: 15, deaths: 0, assists: 6, creepScore: 200 } };
  const ad = game([player('Jinx', 'CHAOS', fed)]),
    ap = game([player('Veigar', 'CHAOS', fed)]);
  const armor = required(catalog.items.find((i) => i.id === 1031)),
    mr = required(catalog.items.find((i) => i.id === 1057));
  assert.ok(engine.scoreItem(armor, champ, ad).score > engine.scoreItem(armor, champ, ap).score);
  assert.ok(engine.scoreItem(mr, champ, ap).score > engine.scoreItem(mr, champ, ad).score);
});
test('recommendations are deterministic and finite, respect affordability, and withhold unsupported modes', () => {
  const live = game([player('Jinx', 'CHAOS')]);
  const buys = engine.nextBuys(annie, live);
  assert.ok(buys.length >= 2 && buys.length <= 3);
  assert.deepEqual(engine.nextBuys(annie, live), buys);
  assert.ok(
    buys.every(
      (r) =>
        Number.isFinite(r.score) &&
        r.cost >= 0 &&
        r.affordable === r.cost <= live.activePlayer.currentGold,
    ),
  );
  assert.equal(new Set(buys.map((r) => r.item.id)).size, buys.length);
  live.gameData.mapNumber = 12;
  assert.deepEqual(engine.nextBuys(annie, live), []);
});
test('a full inventory only permits an upgrade that consumes owned components', () => {
  const owned = [1058, 1058, 3089, 3020, 3157, 3135];
  for (const result of engine.rank(annie, { owned, limit: 100, completed: false })) {
    assert.ok(purchase(result.item, owned, engine.items).consumed.length > 0);
  }
});
test('Flash preference swaps exactly the summoner slots; unavailable spells and jungle rules are respected', () => {
  const d = engine.summoners(annie, 'MIDDLE', 'D'),
    f = engine.summoners(annie, 'MIDDLE', 'F');
  assert.equal(d.spell1Id, f.spell2Id);
  assert.equal(d.spell2Id, f.spell1Id);
  const flash = required(catalog.summoners.find((s) => s.alias === 'SummonerFlash'));
  assert.equal(d.spell1Id, flash.id);
  assert.throws(() => engine.summoners(annie, 'MIDDLE', 'D', 'CLASSIC', 1), /No legal/);
  const jungle = engine.summoners(annie, 'JUNGLE', 'F');
  assert.equal(
    jungle.spell1Id,
    required(catalog.summoners.find((s) => s.alias === 'SummonerSmite')).id,
  );
});
test('standard skill progression remains legal for all 18 levels, taking R at its unlocks', () => {
  const ranks: Record<string, number> = { Q: 0, W: 0, E: 0, R: 0 };
  for (let level = 1; level <= 18; level++) {
    const suggestion = engine.skill(annie, level, ranks);
    assert.ok(suggestion.key);
    if ([6, 11, 16].includes(level)) {
      assert.equal(suggestion.key, 'R');
    }
    ranks[required(suggestion.key)]++;
    assert.equal(engine.skill(annie, level, ranks).key, null);
  }
  assert.deepEqual(ranks, { Q: 5, W: 5, E: 5, R: 3 });
});
test('identity uses Riot ID rather than player order', () => {
  const live = game();
  live.allPlayers.unshift(player('Jinx', 'CHAOS'));
  assert.equal(activePlayer(live)?.championName, 'Annie');
});
test('champion growth reaches the documented endpoints and scales nonlinearly', () => {
  assert.equal(growth(100, 10, 1), 100);
  assert.equal(growth(100, 10, 18), 270);
  assert.ok(growth(100, 10, 2) < 110);
});

test('hidden item-set variants cannot leave gaps in the imported progression', () => {
  const variant = required(engine.items.get(323050));
  assert.equal(variant.source?.displayInItemSets, false);
  assert.equal(eligible(variant, annie), false);
  for (const champ of catalog.champions) {
    assert.ok(
      engine.build(champ).every((id) => engine.items.get(id)?.source?.displayInItemSets !== false),
    );
  }
});

test('Shen values empowered attacks, health-scaling cleave and repeated Spellblade on-hits', () => {
  const shen = required(catalog.champions.find((c) => c.alias === 'Shen'));
  assert.equal(profile(shen).empoweredAttacks, true);
  assert.equal(profile(shen).sustain, 0, 'health and shields are not healing');
  const build = engine.build(shen, 11, 'TOP');
  assert.ok(build.includes(3748), 'Titanic Hydra');
  assert.ok(build.includes(2510), 'Dusk and Dawn');
  assert.equal(build.filter((id) => engine.items.get(id)?.tags.includes('Boots')).length, 1);
});

test('Shen counters his sustaining physical laner first, then accounts for the remaining enemy team', () => {
  const shen = required(catalog.champions.find((c) => c.alias === 'Shen'));
  const live = game([
    player('Zaahen', 'CHAOS', { position: 'TOP' }),
    ...['Veigar', 'Lux', 'Diana', 'KogMaw'].map((alias) => player(alias, 'CHAOS')),
  ]);
  live.allPlayers[0] = player('Shen', 'ORDER', { riotId: 'Test#EUW', position: 'TOP' });
  const build = engine.build(shen, 11, 'TOP', live);
  assert.deepEqual(build.slice(0, 2), [3075, 3047]);
  assert.ok(build.includes(3748));
  assert.ok(build.includes(2510));
  assert.ok(build.slice(2).some((id) => (engine.stats.get(id)?.FlatSpellBlockMod ?? 0) > 0));
  const noHealing = structuredClone(live);
  noHealing.allPlayers[1] = player('Malphite', 'CHAOS', { position: 'TOP' });
  assert.ok(
    engine.scoreItem(required(engine.items.get(3075)), shen, live).score >
      engine.scoreItem(required(engine.items.get(3075)), shen, noHealing).score,
  );
});

test('zero gold keeps final targets, credits components and explains the same choices', () => {
  const live = game([player('Jinx', 'CHAOS')]);
  live.activePlayer.currentGold = 0;
  live.allPlayers[0].items = [{ itemID: 1058, count: 1, slot: 0 }];
  const saving = engine.nextBuys(annie, live);
  assert.equal(saving.length, 3);
  for (const result of saving) {
    assert.ok(
      result.item.rules?.tier === 5 ||
        (result.item.tags.includes('Boots') && result.item.rules?.tier === 4),
    );
    assert.equal(result.cost, purchase(result.item, [1058], engine.items).cost);
    assert.ok(result.reasons.length > 0);
    assert.equal(result.affordable, false);
  }
  live.activePlayer.currentGold = 10000;
  const rich = engine.nextBuys(annie, live);
  assert.deepEqual(
    rich.map((result) => result.item.id),
    saving.map((result) => result.item.id),
  );
  assert.ok(rich.every((result) => result.affordable));
});

test('healing reduction cannot stack under different passive names or bypass conflicts by consuming an unrelated ingredient', () => {
  const shen = required(catalog.champions.find((champ) => champ.alias === 'Shen'));
  const live = game([player('Zaahen', 'CHAOS', { position: 'TOP' })]);
  live.allPlayers[0] = player('Shen', 'ORDER', { riotId: 'Test#EUW', position: 'TOP' });
  for (const first of [3075, 6609, 3165]) {
    const ranked = engine.rank(shen, {
      game: live,
      role: 'TOP',
      owned: [first, 1028],
      limit: 1000,
    });
    assert.ok(
      ranked.every((result) => !passiveKeys(result.item).includes('effect:healing-reduction')),
    );
  }
  const upgrade = engine.rank(shen, { owned: [3076], limit: 1000 });
  assert.ok(
    upgrade.some((result) => result.item.id === 3075),
    'Bramble Vest may upgrade to Thornmail',
  );
  const build = engine.build(shen, 11, 'TOP', live);
  assert.equal(
    build.filter((id) =>
      passiveKeys(required(engine.items.get(id))).includes('effect:healing-reduction'),
    ).length,
    1,
  );
  assert.ok(build.includes(3075));
  const suggestions = engine.nextBuys(shen, live);
  assert.ok(
    suggestions.filter((result) => passiveKeys(result.item).includes('effect:healing-reduction'))
      .length <= 1,
  );
});

test('global ally travel reduces Teleport priority without a champion-specific spell list', () => {
  const shen = required(catalog.champions.find((champ) => champ.alias === 'Shen'));
  const teleport = required(catalog.summoners.find((spell) => spell.alias === 'SummonerTeleport'));
  assert.equal(profile(shen).globalTravel, true);
  const pair = engine.summoners(shen, 'TOP', 'F');
  assert.ok(![pair.spell1Id, pair.spell2Id].includes(teleport.id));
  assert.ok(Object.values(engine.summoners(annie, 'TOP', 'F')).includes(teleport.id));
});

test('Shen builds retain magic resistance against mixed enemy teams after excluding duplicate Wounds', () => {
  const shen = required(catalog.champions.find((champion) => champion.alias === 'Shen'));
  for (const enemies of [
    ['Zaahen', 'Veigar', 'Lux', 'Diana', 'KogMaw'],
    ['Garen', 'LeeSin', 'Ahri', 'Jinx', 'Nautilus'],
    ['Darius', 'JarvanIV', 'Syndra', 'Caitlyn', 'Lux'],
  ]) {
    const live = game(
      enemies.map((alias, index) =>
        player(alias, 'CHAOS', { position: index === 0 ? 'TOP' : undefined }),
      ),
    );
    live.allPlayers[0] = player('Shen', 'ORDER', { riotId: 'Test#EUW', position: 'TOP' });
    const build = engine.buildPlan(shen, 11, 'TOP', live);
    assert.equal(build.length, 6);
    assert.ok(
      build.some((entry) => (engine.stats.get(entry.item.id)?.FlatSpellBlockMod ?? 0) > 0),
      enemies.join(', '),
    );
    assert.ok(
      build.filter((entry) => passiveKeys(entry.item).includes('effect:healing-reduction'))
        .length <= 1,
    );
    assert.ok(build.every((entry) => entry.reasons.length > 0));
    assert.deepEqual(
      build.map((entry) => entry.item.id),
      engine.build(shen, 11, 'TOP', live),
    );
  }
});
