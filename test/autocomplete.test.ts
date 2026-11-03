import test from 'node:test';
import assert from 'node:assert/strict';
import { byName, matchingChoices } from '../src/ui/autocomplete.js';

test('browsing and autocomplete sort by name without mutating source ranking', () => {
  const choices = [
    { value: '1', name: 'Zyra' },
    { value: '2', name: 'Annie' },
    { value: '3', name: 'Aatrox' },
  ];
  assert.deepEqual(
    byName(choices).map((choice) => choice.name),
    ['Aatrox', 'Annie', 'Zyra'],
  );
  assert.deepEqual(
    choices.map((choice) => choice.name),
    ['Zyra', 'Annie', 'Aatrox'],
  );
});

test('autocomplete matches case, accents and keywords, returns named choices, and handles no matches', () => {
  const choices = [
    { value: '1', name: 'Zyra', keywords: 'mage' },
    { value: '2', name: 'Ánnie', keywords: 'mage' },
    { value: '3', name: 'Shen', keywords: 'tank' },
  ];
  assert.deepEqual(
    matchingChoices(choices, ' ANN ').map((choice) => choice.value),
    ['2'],
  );
  assert.deepEqual(
    matchingChoices(choices, 'MAGE').map((choice) => choice.value),
    ['2', '1'],
  );
  assert.deepEqual(matchingChoices(choices, 'unmatched'), []);
});
