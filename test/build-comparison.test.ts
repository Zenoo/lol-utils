import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  combatItems,
  compareBuild,
  parseOpgg,
  referencesSchema,
} from '../scripts/build-comparison/model.js';
import { Engine, profile } from '../src/core/engine.js';
import { catalog } from './fixtures.js';
import { required } from '../src/core/assert.js';

const engine = new Engine(catalog);
test('comparison measures order separately and excludes boots and quest rewards, not ordinary gold-generating items', () => {
  const reference = referencesSchema.parse([
    {
      champion: 'Annie',
      role: 'MIDDLE',
      provider: 'example.test',
      url: 'https://example.test/build',
      observedAt: '2026-11-05',
      patch: '16.21',
      population: 'fixture',
      kind: 'statistics',
      coreBuilds: [[3118, 4645, 3089]],
      boots: [3020],
    },
  ])[0];
  const comparison = compareBuild([3870, 3020, 4645, 3118, 3157, 3089], reference, engine.items);
  assert.equal(comparison.coreRecall, 2 / 3);
  assert.equal(comparison.buildRecall, 1);
  assert.equal(comparison.orderedRecall, 0);
  assert.equal(comparison.boots, true);
  assert.equal(comparison.firstItem, false);
  assert.deepEqual(comparison.core, [4645, 3118, 3157]);
  const ordinaryGoldItem = { ...required(engine.items.get(4646)), id: -2, tags: ['GoldPer'] };
  const items = new Map(engine.items).set(-2, ordinaryGoldItem);
  assert.deepEqual(combatItems([-2, 3870, 3020], items), [-2]);
});

test('public reference parser reads rendered tables even when script tags precede the body, and fails on missing item facts', () => {
  const images = (ids: number[]) =>
    ids.map((id) => `<img src="https://example.test/16.21.1/item/${id}.png" />`).join('');
  const html = `<title>Shen Build Patch 16.21: items</title><script src="bundle.js"></script>
    <table><caption>Builds Table</caption><tbody><tr><td>${images([3748, 2510, 3075])}</td></tr></tbody></table>
    <table><caption>Boots Table</caption><tbody><tr><td>${images([3047])}</td></tr></tbody></table>`;
  assert.deepEqual(parseOpgg(html), {
    patch: '16.21',
    coreBuilds: [[3748, 2510, 3075]],
    boots: [3047],
  });
  assert.throws(() => parseOpgg('<html>Client-side loading or blocked</html>'), /missing/);
});

test('empowered attacks and enemy attack-speed reduction do not classify tanks or assassins as attack carries', () => {
  const get = (alias: string) =>
    profile(required(catalog.champions.find((champion) => champion.alias === alias)));
  assert.equal(get('Shen').repeatedAttacks, true);
  assert.equal(get('Malphite').repeatedAttacks, false);
  assert.ok(get('Khazix').attacks < 0.4);
  assert.ok(get('Jinx').attacks > 0.9);
  assert.equal(get('Leona').heal, 0, 'raising her own shield is not ally healing');
});

test('normalized stats do not price mana regeneration or healing power twice, and crit damage has marginal value', () => {
  const mana = required(engine.stats.get(3107));
  assert.ok(mana.ManaRegen > 0 && mana.HealShieldPower > 0);
  assert.equal(mana.PercentBaseMPRegenMod, undefined);
  assert.equal(mana.PercentHealingAmountMod, undefined);
  const jinx = required(catalog.champions.find((champion) => champion.alias === 'Jinx'));
  const edge = required(engine.items.get(3031));
  const withoutCritDamage = {
    ...edge,
    id: -1,
    stats: { ...edge.stats },
    rules: edge.rules && { ...edge.rules, stats: { ...edge.rules.stats, FlatCritDamageMod: 0 } },
  };
  engine.stats.set(-1, { ...required(engine.stats.get(edge.id)), FlatCritDamageMod: 0 });
  const context = engine.context(jinx, undefined, 'BOTTOM');
  const own = { attackDamage: 200, critChance: 0.5 };
  assert.ok(
    engine.scoreItem(edge, jinx, undefined, context, own).score >
      engine.scoreItem(withoutCritDamage, jinx, undefined, context, own).score,
  );
  engine.stats.delete(-1);
});

test('reference snapshots only contain known completed items and retain provider and patch provenance', async () => {
  const references = referencesSchema.parse(
    JSON.parse(await readFile('scripts/build-comparison/references.json', 'utf8')),
  );
  assert.ok(new Set(references.map((reference) => reference.provider)).size >= 3);
  for (const reference of references) {
    assert.ok(new URL(reference.url).hostname.endsWith(reference.provider));
    if (reference.patch !== catalog.version.split('.').slice(0, 2).join('.')) {
      continue;
    }
    for (const id of reference.coreBuilds.flat()) {
      assert.equal(engine.items.get(id)?.rules?.tier, 5, `${reference.champion}: ${id}`);
    }
    assert.ok(reference.boots.every((id) => engine.items.get(id)?.tags.includes('Boots')));
  }
});

test('development comparisons and third-party snapshots stay outside production imports and package files', async () => {
  const files = await readdir('src', { recursive: true });
  for (const file of files.filter((file) => /\.(?:ts|cts)$/.test(file))) {
    const source = await readFile(`src/${file}`, 'utf8');
    assert.doesNotMatch(source, /build-comparison|references\.json/, file);
  }
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { build: { files: string[] } };
  assert.ok(pkg.build.files.includes('build/src/**/*'));
  assert.ok(
    pkg.build.files.every(
      (pattern) => !pattern.includes('scripts') && !pattern.includes('build-comparison'),
    ),
  );
});

test('archived ability scalings affect marginal item value without treating a spell as a basic attack', () => {
  const garen = required(catalog.champions.find((champion) => champion.alias === 'Garen'));
  assert.equal(garen.mechanics?.attackSpeedScaling, true);
  assert.equal(garen.mechanics?.criticalScaling, true);
  assert.equal(garen.mechanics?.innateArmorShred, 0.25);
  assert.ok(profile(garen).attacks < 0.4);
  const dancer = required(engine.items.get(3046));
  const noScaling = {
    ...garen,
    mechanics: { ...required(garen.mechanics), attackSpeedScaling: false, criticalScaling: false },
  };
  assert.ok(engine.scoreItem(dancer, garen).score > engine.scoreItem(dancer, noScaling).score);
  const cleaver = required(engine.items.get(3071));
  const noShred = { ...garen, mechanics: { ...required(garen.mechanics), innateArmorShred: 0 } };
  assert.ok(engine.scoreItem(cleaver, garen).score < engine.scoreItem(cleaver, noShred).score);
});

test('persistent on-hit damage scales with owned AP and repeat procs value existing on-hit effects', () => {
  const kayle = required(catalog.champions.find((champion) => champion.alias === 'Kayle'));
  const context = engine.context(kayle, undefined, 'TOP');
  const tooth = required(engine.items.get(3115));
  assert.ok(
    engine.scoreItem(tooth, kayle, undefined, context, { abilityPower: 200 }).score >
      engine.scoreItem(tooth, kayle, undefined, context, { abilityPower: 0 }).score,
  );
  const repeat = required(engine.items.get(2510));
  assert.ok(
    engine.scoreItem(repeat, kayle, undefined, context, { onHitItems: 1 }).score >
      engine.scoreItem(repeat, kayle, undefined, context, { onHitItems: 0 }).score,
  );
});
