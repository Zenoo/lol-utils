import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Engine, profile } from '../src/core/engine.js';
import { catalog } from './fixtures.js';
import {
  compareRunes,
  parseOpggRunes,
  parseLolalyticsRunes,
  runeReferencesSchema,
} from '../scripts/build-comparison/runes.js';

const engine = new Engine(catalog);
test('an armour ability mentioning equipment does not qualify as a self shield', () => {
  const champion = catalog.champions.find((c) => c.alias === 'Leona');
  assert.ok(champion);
  assert.ok(!engine.runes(champion, 'UTILITY').selectedPerkIds.includes(8401));
});

test('rune trigger requirements exclude immobilisation and self-shield effects on incompatible kits', () => {
  for (const champion of catalog.champions) {
    const synthetic = {
      ...champion,
      passive: { ...champion.passive, description: 'Deals damage.' },
      spells: champion.spells.map((spell) => ({
        ...spell,
        tooltip: 'Deals damage.',
        description: 'Deals damage.',
      })),
    };
    const page = engine.runes(synthetic, 'UTILITY');
    assert.notEqual(page.selectedPerkIds[0], 8439, champion.name);
    assert.notEqual(page.selectedPerkIds[0], 8351, champion.name);
    assert.ok(!page.selectedPerkIds.includes(8401), champion.name);
  }
});

test('resource runes respect mana, energy and resourceless kits in every role', () => {
  for (const champion of catalog.champions) {
    for (const role of ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']) {
      const page = engine.runes(champion, role);
      assert.equal(page.selectedPerkIds.length, 9);
      if (!profile(champion).mana) {
        assert.ok(!page.selectedPerkIds.includes(8226), champion.name);
      }
      if (!/mana|energy/i.test(champion.partype)) {
        assert.ok(!page.selectedPerkIds.includes(8009), champion.name);
      }
    }
  }
});

test('public rune parsing preserves repeated shards and ignores dimmed alternatives', () => {
  const ids = [8437, 8401, 8444, 8451, 8345, 8410, 5005, 5001, 5001];
  const opgg = ids
    .map(
      (id, index) =>
        `<img class="opacity-100" src="https://example.test/${index < 6 ? 'perk' : 'perkShard'}/${id}.png"/>`,
    )
    .join('');
  assert.deepEqual(
    parseOpggRunes(`<img class="opacity-50" src="/perk/8439.png">${opgg}${opgg}`),
    ids,
  );
  const lolalytics = ids
    .map(
      (id, index) =>
        `<img class="cursor-help" src="https://example.test/${index < 6 ? 'rune68' : 'statmod32'}/${id}.webp">`,
    )
    .join('');
  assert.deepEqual(
    parseLolalyticsRunes(
      `Primary Runes<img class="grayscale" src="/rune68/8439.webp">${lolalytics}Starting Items`,
    ),
    ids,
  );
  assert.throws(() => parseOpggRunes('<html>Challenge</html>'));
  assert.throws(() => parseLolalyticsRunes('<html>Challenge</html>'));
  assert.equal(compareRunes(ids, ids).shards, 1);
  assert.equal(compareRunes([...ids.slice(0, 6), 5001, 5005, 5001], ids).shards, 1 / 3);
});

test('rune source snapshots retain patch provenance and legal primary, secondary and shard slots', async () => {
  const references = runeReferencesSchema.parse(
    JSON.parse(await readFile('scripts/build-comparison/rune-references.json', 'utf8')),
  );
  for (const reference of references) {
    assert.ok(new URL(reference.url).hostname.endsWith(reference.provider));
    assert.match(reference.sourceSha256, /^[a-f0-9]{64}$/);
    const ids = reference.selectedPerkIds;
    const primary = catalog.runeStyles.find((s) => s.slots[0].perks.includes(ids[0]));
    assert.ok(primary);
    primary.slots.forEach((slot, index) => assert.ok(slot.perks.includes(ids[index])));
    const secondary = catalog.runeStyles.find(
      (s) => s.id !== primary.id && s.slots.slice(1).some((slot) => slot.perks.includes(ids[4])),
    );
    assert.ok(secondary);
    const slots = ids
      .slice(4, 6)
      .map((id) => secondary.slots.findIndex((slot) => slot.perks.includes(id)));
    assert.ok(slots.every((index) => index > 0));
    assert.notEqual(slots[0], slots[1]);
    const shards = catalog.perkStyles.styles
      .find((s) => s.id === primary.id)
      ?.slots.filter((s) => s.type === 'kStatMod');
    assert.ok(shards);
    shards.forEach((slot, index) => assert.ok(slot.perks.includes(ids[index + 6])));
  }
});
