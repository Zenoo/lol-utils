import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { championTooltips, spellTooltip } from '../src/core/spell-tooltips.js';
import { championStatLabel } from '../src/ui/champion-stats.js';
import { catalog } from './fixtures.js';
import { required } from '../src/core/assert.js';

test('damage tooltips resolve rank values, stat ratios, effects and modified calculations from archived data', async () => {
  for (const alias of ['Karthus', 'Fizz', 'Aatrox', 'Yone', 'Mordekaiser']) {
    const champion = required(catalog.champions.find((entry) => entry.alias === alias));
    const raw: unknown = JSON.parse(
      await readFile(`data/raw/champions/${alias}.game.json`, 'utf8'),
    );
    const resolved = championTooltips(champion, raw);
    const q = resolved.spells[0].tooltip;
    assert.ok(!q.includes('qdamage:'), `${alias}: ${q}`);
    assert.ok(!q.includes('{{'), alias);
    assert.match(q, /\d+(?:\.\d+)?\/\d/, alias);
    assert.match(q, /% (?:total |bonus )?(?:AP|AD)/, alias);
    assert.ok(champion.spells[0].tooltip.includes('{{'), 'catalog objects stay unchanged');
    if (alias === 'Karthus') {
      assert.match(q, /40\/59\/78\/97\/116 \+ 35% AP/);
      assert.match(q, /2 \* \(40\/59/);
    }
  }
});

test('Shen descriptions resolve level breakpoints and percent calculations without guessing live stats', async () => {
  const champion = required(catalog.champions.find((entry) => entry.alias === 'Shen'));
  const raw: unknown = JSON.parse(await readFile('data/raw/champions/Shen.game.json', 'utf8'));
  const resolved = championTooltips(champion, raw).spells[0].tooltip;
  assert.match(resolved, /10\/16\/22\/28\/34\/40 \(champion levels 1\/4\/7\/10\/13\/16\)/);
  assert.match(resolved, /25\/30\/35\/40\/45/);
  assert.match(resolved, /1.5% AP/);
  assert.ok(!resolved.includes('spellmodifierdescriptionappend'));
});

test('unsupported and recursive calculations stay labelled instead of becoming invented zeros', () => {
  const champion = required(catalog.champions.find((entry) => entry.alias === 'Karthus'));
  const spell = champion.spells[0];
  const raw = {
    spell: {
      __type: 'SpellObject',
      mScriptName: spell.id,
      mSpell: {
        mSpellCalculations: {
          QDamage: { __type: 'GameCalculationModified', mModifiedGameCalculation: 'QDamage' },
          QSingleTargetDamage: { __type: 'UnimplementedCalculation' },
        },
      },
    },
  };
  const resolved = spellTooltip(champion, spell, raw);
  assert.match(resolved, /qdamage: unresolved formula/);
  assert.match(resolved, /qsingletargetdamage: unresolved formula/);
});

test('champion stat labels use player-facing names and the actual resource type', () => {
  assert.equal(championStatLabel('hp', 'Energy'), 'Health');
  assert.equal(championStatLabel('mp', 'Energy'), 'Energy');
  assert.equal(championStatLabel('mpregen', 'Energy'), 'Energy regeneration per 5 seconds');
  assert.equal(championStatLabel('spellblock', 'Mana'), 'Magic resistance');
  assert.equal(championStatLabel('attackdamage', 'Mana'), 'Attack damage');
  assert.equal(championStatLabel('attackspeed', 'Mana'), 'Attack speed');
});

test('bonus attack damage keeps its meaning instead of being presented as total attack damage', async () => {
  const champion = required(catalog.champions.find((entry) => entry.alias === 'Zed'));
  const raw: unknown = JSON.parse(await readFile('data/raw/champions/Zed.game.json', 'utf8'));
  const tooltip = championTooltips(champion, raw).spells[0].tooltip;
  assert.match(tooltip, /% bonus AD/);
  assert.ok(!tooltip.includes('% total AD'));
});

test('every archived champion ability resolves its tokens and nested localization branches', async () => {
  for (const champion of catalog.champions) {
    const raw: unknown = JSON.parse(
      await readFile(`data/raw/champions/${champion.alias}.game.json`, 'utf8'),
    );
    for (const spell of championTooltips(champion, raw).spells) {
      assert.doesNotMatch(
        spell.tooltip,
        /unresolved formula|\{\{|\}\}|\bNaN\b|\bInfinity\b/,
        `${champion.alias} ${spell.name}`,
      );
    }
  }
});

test('health scaling, ammo, precision and conditional forms preserve their source values', async () => {
  const tooltip = async (alias: string, slot: number) => {
    const champion = required(catalog.champions.find((entry) => entry.alias === alias));
    const raw: unknown = JSON.parse(
      await readFile(`data/raw/champions/${alias}.game.json`, 'utf8'),
    );

    return championTooltips(champion, raw).spells[slot].tooltip;
  };
  assert.match(await tooltip('Aatrox', 2), /1.3% bonus maximum health/);
  assert.match(await tooltip('Teemo', 3), /35\/30\/25/);
  assert.match(await tooltip('Rumble', 1), /1.5/);
  assert.match(await tooltip('Kaisa', 0), /normal.*conditional form/);
  assert.match(await tooltip('Gangplank', 0), /3\/4\/5\/6\/7 bonus gold/);
  assert.match(await tooltip('Bard', 1), /current active shrines \/ 3/);
});
