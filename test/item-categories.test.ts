import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryLabel, itemCategories } from '../src/ui/item-categories.js';

test('item categories use readable labels and collapse aliases into one filter', () => {
  assert.equal(categoryLabel('ArmorPenetration'), 'Armor Penetration');
  assert.deepEqual(itemCategories(['SpellDamage', 'CooldownReduction', 'AbilityHaste']), [
    'Ability haste',
    'Ability power',
  ]);
  assert.deepEqual(itemCategories(['SpellBlock', 'MagicResist']), ['Magic resistance']);
});
