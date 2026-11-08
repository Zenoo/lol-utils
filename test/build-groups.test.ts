import { required } from '../src/core/assert.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupBuilds } from '../src/core/builds.js';
import type { SourceBuild } from '../src/core/types.js';

const build: SourceBuild = {
  id: 'opgg',
  championId: 221,
  role: 'BOTTOM',
  provider: 'OP.GG',
  url: 'https://op.gg/',
  patch: '16.22',
  label: 'Core',
  stats: '',
  items: [3032, 3085, 3031],
  runes: {
    name: 'Source runes',
    current: true,
    primaryStyleId: 8200,
    subStyleId: 8300,
    selectedPerkIds: [8230, 8226, 8210, 8237, 8345, 8347, 5008, 5008, 5001],
  },
  summoners: { spell1Id: 4, spell2Id: 21 },
};

test('identical source and local loadouts share one row while preserving all import records', () => {
  const other: SourceBuild = {
    ...build,
    id: 'lolvalue',
    provider: 'LOLValue',
    url: 'https://lolvalue.com/',
    label: 'Inventory core',
    itemOrder: 'inventory',
    items: [3031, 3032, 3085],
    summoners: { spell1Id: 21, spell2Id: 4 },
    runes: {
      ...required(build.runes),
      selectedPerkIds: [8230, 8226, 8210, 8237, 8347, 8345, 5008, 5008, 5001],
    },
  };
  const local = { ...build, id: 'local', provider: 'Local', mainItems: build.items };
  const snapshot = structuredClone([build, other, local]);
  const groups = groupBuilds([build, other, local]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0]?.map((entry) => entry.id),
    ['opgg', 'lolvalue', 'local'],
  );
  assert.deepEqual(
    [build, other, local],
    snapshot,
    'grouping must not mutate purchase orders or source metadata',
  );
});

test('different items, shard slots, spell pairs, completeness and selection context remain separate', () => {
  const variants: SourceBuild[] = [
    build,
    { ...build, id: 'items', items: [3032, 3085, 3036] },
    { ...build, id: 'component', items: [...build.items, 1038] },
    {
      ...build,
      id: 'shards',
      runes: {
        ...required(build.runes),
        selectedPerkIds: [8230, 8226, 8210, 8237, 8345, 8347, 5008, 5001, 5008],
      },
    },
    { ...build, id: 'spells', summoners: { spell1Id: 4, spell2Id: 12 } },
    { ...build, id: 'unknown-runes', runes: undefined },
    { ...build, id: 'unknown-spells', summoners: undefined },
    { ...build, id: 'champion', championId: 79 },
    { ...build, id: 'role', role: 'TOP' },
    { ...build, id: 'patch', patch: '16.21' },
  ];
  assert.equal(groupBuilds(variants).length, variants.length);
  assert.deepEqual(groupBuilds([]), []);
});
