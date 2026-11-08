import { required } from '../src/core/assert.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { catalog, completeSession } from './fixtures.js';
import { CompanionService } from '../src/desktop/service.js';
import {
  buildArchetype,
  parseSourceBuilds,
  parseLolalyticsBuilds,
  SourceBuildProvider,
} from '../src/integrations/source-builds.js';
import { parseLolvalueBuilds, parseMetabotBuilds } from '../src/integrations/additional-builds.js';
import { Engine } from '../src/core/engine.js';
import { importItems, importSummoners } from '../src/integrations/imports.js';
import { defaults } from '../src/desktop/settings.js';
import type { LocalApi } from '../src/integrations/local-api.js';

const opgg = await readFile('test/fixtures/opgg-gragas.html', 'utf8');
const lolalytics = await readFile('test/fixtures/lolalytics-gragas.html', 'utf8');
const lolvalue = await readFile('test/fixtures/lolvalue-zeri.html', 'utf8');
const metabot = await readFile('test/fixtures/metabot-zeri.html', 'utf8');
const zeri = required(catalog.champions.find((champion) => champion.alias === 'Zeri'));
const gragas = required(catalog.champions.find((c) => c.alias === 'Gragas'));

test('live-captured OP.GG rows retain every alternative and early components, with valid role defaults', () => {
  const builds = parseSourceBuilds(opgg, catalog, gragas.id, 'TOP', 'https://op.gg/');
  assert.equal(builds.length, 5);
  assert.deepEqual(builds[0]?.items, [3070, 6657, 3121, 4629]);
  assert.match(required(builds[0]).label, /AP \/ durability/);
  assert.match(required(builds[1]).label, /^AP ·/);
  assert.equal(builds[0]?.runes?.selectedPerkIds.length, 9);
  assert.deepEqual(builds[0]?.summoners, { spell1Id: 4, spell2Id: 12 });
  assert.match(required(builds[0]).stats, /485 Games/);
  assert.equal(new Set(builds.map((b) => b.id)).size, 5);
});

test('tank and damage paths are classified from their items for any champion', () => {
  assert.equal(buildArchetype([3068, 6665, 3075], catalog), 'Tank');
  assert.equal(buildArchetype([3100, 4645, 3089], catalog), 'AP');
  // Add to the core table specifically; other tables are intentionally ignored.
  const core =
    '<table><caption>Builds Table</caption><tr><td><img src="https://example.com/item/3068.png"><img src="https://example.com/item/6665.png"><img src="https://example.com/item/3075.png"></td></tr></table>';
  const builds = parseSourceBuilds(opgg + core, catalog, gragas.id, 'TOP', 'https://op.gg/');
  assert.ok(builds.some((b) => b.label.startsWith('Tank')));
});

test('LoLalytics imports its actual core and rune/spell defaults without inventing alternative paths', () => {
  const builds = parseLolalyticsBuilds(
    lolalytics,
    catalog,
    gragas.id,
    'TOP',
    'https://lolalytics.com/',
  );
  assert.equal(builds.length, 1);
  assert.deepEqual(builds[0]?.items, [6657, 3158, 3119]);
  assert.equal(builds[0]?.runes?.selectedPerkIds.length, 9);
  assert.deepEqual(builds[0]?.summoners, { spell1Id: 4, spell2Id: 14 });
});

test('layout changes and unknown items fail closed; missing runes do not discard usable items', () => {
  assert.throws(
    () => parseSourceBuilds('<html/>', catalog, 79, 'TOP', 'https://op.gg/'),
    /metadata missing/,
  );
  assert.throws(
    () =>
      parseSourceBuilds(
        opgg.replace(/\/item\/\d+\.png/g, '/item/999999.png'),
        catalog,
        79,
        'TOP',
        'https://op.gg/',
      ),
    /no compatible/,
  );
  const builds = parseSourceBuilds(
    opgg.replace(/opacity-100/g, 'opacity-50'),
    catalog,
    79,
    'TOP',
    'https://op.gg/',
  );
  assert.equal(builds[0]?.runes, undefined);
  assert.equal(builds.length, 5);
});

test('provider deduplicates requests, isolates source errors, and retries failures', async () => {
  let requests = 0;
  const provider = new SourceBuildProvider(catalog, async (input) => {
    requests++;

    return String(input).includes('op.gg')
      ? new Response(opgg)
      : new Response('down', { status: 503 });
  });
  const [a, b] = await Promise.all([provider.load(79, 'TOP'), provider.load(79, 'TOP')]);
  assert.deepEqual(a, b);
  assert.equal(requests, 4);
  assert.equal(a.builds.length, 5);
  assert.match(required(a.errors[0]), /LoLalytics HTTP 503/);
  assert.equal(provider.get(required(a.builds[0]).id)?.championId, 79);
  await provider.load(79, 'TOP');
  assert.equal(requests, 7, 'successful provider results remain cached while failed sources retry');
  await assert.rejects(provider.load(79, 'INVALID'), /Unknown/);
});

test('LOLValue retains separate inventory cores, resolves Classic spells and runes, and rejects other roles', () => {
  const builds = parseLolvalueBuilds(lolvalue, catalog, zeri.id, 'BOTTOM', 'https://lolvalue.com/');
  assert.equal(builds.length, 3);
  assert.deepEqual(builds[0]?.items, [3031, 3032, 3085]);
  assert.equal(builds[0]?.itemOrder, 'inventory');
  assert.equal(builds[0]?.patch, '16.22');
  assert.deepEqual(builds[0]?.summoners, { spell1Id: 4, spell2Id: 21 });
  assert.equal(builds[0]?.runes?.selectedPerkIds.length, 9);
  assert.match(builds[0]?.population ?? '', /Master/);
  assert.throws(
    () => parseLolvalueBuilds(lolvalue, catalog, zeri.id, 'TOP', ''),
    /no TOP build section/,
  );
  assert.throws(
    () =>
      parseLolvalueBuilds(
        lolvalue
          .replace(/Infinity Edge/g, 'Unknown Item')
          .replace(/Yun Tal Wildarrows/g, 'Unknown Item'),
        catalog,
        zeri.id,
        'BOTTOM',
        '',
      ),
    /compatible core builds missing/,
  );
});

test('MetaBot extracts real core sequences, ignores repeated name links, and validates page role', () => {
  const builds = parseMetabotBuilds(metabot, catalog, zeri.id, 'BOTTOM', 'https://metabot.gg/');
  assert.equal(builds.length, 4);
  assert.deepEqual(builds[0]?.mainItems, [3006, 3036, 3032, 3031, 3026, 3085]);
  assert.equal(builds[0]?.itemOrder, 'inventory');
  assert.deepEqual(builds[1]?.items, [3032, 3085, 3031]);
  assert.equal(builds[1]?.itemOrder, 'purchase');
  assert.equal(builds[0]?.patch, '16.22');
  assert.deepEqual(builds[0]?.summoners, { spell1Id: 21, spell2Id: 4 });
  assert.deepEqual(
    builds[0]?.runes?.selectedPerkIds,
    [8021, 9111, 9104, 8299, 8429, 8451, 5005, 5008, 5001],
  );
  assert.throws(
    () => parseMetabotBuilds(metabot, catalog, zeri.id, 'JUNGLE', ''),
    /does not match JUNGLE/,
  );
  assert.throws(
    () => parseMetabotBuilds('<title>Zeri ADC Build</title>', catalog, zeri.id, 'BOTTOM', ''),
    /patch metadata missing/,
  );
});

test('provider caches do not reuse another role on sources with one shared champion URL', async () => {
  const provider = new SourceBuildProvider(catalog, async (input) => {
    const url = String(input);

    return new Response(
      url.includes('lolvalue.com')
        ? lolvalue
        : url.includes('metabot.gg')
          ? metabot
          : url.includes('op.gg')
            ? opgg
            : lolalytics,
    );
  });
  assert.equal(
    (await provider.load(zeri.id, 'BOTTOM')).builds.some((build) => build.provider === 'MetaBot'),
    true,
  );
  const top = await provider.load(zeri.id, 'TOP');
  assert.equal(
    top.builds.some((build) => build.provider === 'MetaBot' || build.provider === 'LOLValue'),
    false,
  );
  assert.ok(top.builds.every((build) => build.role === 'TOP'));
});

test('all four source results are cached together and force refresh reloads each provider', async () => {
  let requests = 0;
  const provider = new SourceBuildProvider(catalog, async (input) => {
    requests++;
    const url = String(input);

    return new Response(
      url.includes('lolvalue.com')
        ? lolvalue
        : url.includes('metabot.gg')
          ? metabot
          : url.includes('op.gg')
            ? opgg
            : lolalytics,
    );
  });
  const result = await provider.load(zeri.id, 'BOTTOM');
  assert.equal(requests, 4);
  assert.deepEqual(result.errors, []);
  assert.equal(new Set(result.builds.map((build) => build.provider)).size, 4);
  await provider.load(zeri.id, 'BOTTOM');
  assert.equal(requests, 4);
  await provider.load(zeri.id, 'BOTTOM', true);
  assert.equal(requests, 8);
});

test('source item import preserves personal sets and writes only the selected variant in source order', async () => {
  let saved: unknown;
  const api: Pick<LocalApi, 'request'> = {
    request: async (method, _endpoint, body) => {
      if (method === 'GET') {
        return { itemSets: [{ uid: 'personal' }] };
      }
      saved = body;
    },
  };
  await importItems(api, new Engine(catalog), gragas, 1, 11, 'TOP', undefined, {
    items: [3068, 6665, 3075],
    label: 'OP.GG Tank',
    patch: '16.22',
  });
  const sets = (saved as { itemSets: { uid: string; blocks?: { items: { id: string }[] }[] }[] })
    .itemSets;
  assert.equal(sets[0]?.uid, 'personal');
  assert.deepEqual(
    sets[1]?.blocks?.flatMap((b) => b.items.map((i) => i.id)),
    ['3068', '6665', '3075'],
  );
});

test('source summoners preserve the source pair and preferred Flash side; unavailable spells do not fall back', async () => {
  let saved: unknown;
  const api: Pick<LocalApi, 'request'> = {
    request: async (method, _endpoint, body) => {
      if (method === 'GET') {
        return { spells: [4, 12] };
      }
      saved = body;
    },
  };
  await importSummoners(
    api,
    new Engine(catalog),
    gragas,
    { ...defaults, flashSlot: 'F' },
    'TOP',
    'CLASSIC',
    30,
    1,
    { spell1Id: 4, spell2Id: 12 },
  );
  assert.deepEqual(saved, { spell1Id: 12, spell2Id: 4 });
  await assert.rejects(
    importSummoners(api, new Engine(catalog), gragas, defaults, 'TOP', 'CLASSIC', 30, 1, {
      spell1Id: 4,
      spell2Id: 14,
    }),
    /unavailable/,
  );
});

test('service imports only requested source parts, replaces a previous variant, and rejects changed champion/role', async () => {
  const session = completeSession();
  const local = required(session.myTeam.find((p) => p.cellId === session.localPlayerCellId));
  local.championId = gragas.id;
  local.assignedPosition = 'top';
  const writes: { endpoint: string; body: unknown }[] = [];
  const client = {
    close: () => {},
    request: async (method: string, endpoint: string, body?: unknown) => {
      if (method !== 'GET') {
        writes.push({ endpoint, body });

        return;
      }
      if (endpoint === '/lol-patch/v1/game-version') {
        return catalog.version;
      }
      if (endpoint === '/lol-gameflow/v1/gameflow-phase') {
        return 'ChampSelect';
      }
      if (endpoint === '/lol-champ-select/v1/session') {
        return structuredClone(session);
      }
      if (endpoint === '/lol-summoner/v1/current-summoner') {
        return { summonerId: 1, summonerLevel: 30 };
      }
      if (endpoint === '/lol-gameflow/v1/session') {
        return { gameData: { queue: { gameMode: 'CLASSIC', mapId: 11 } } };
      }
      if (endpoint === '/lol-item-sets/v1/item-sets/1/sets') {
        return { itemSets: [] };
      }
      if (endpoint === '/lol-perks/v1/pages') {
        return [];
      }
      throw new Error(`Unexpected request ${endpoint}`);
    },
  };
  const service = new CompanionService(
    catalog,
    () => ({ ...defaults, autoImport: false }),
    () => {},
    () => {},
    {
      live: {
        close: () => {},
        request: async () => {
          throw new Error('No game');
        },
      },
      connect: async () => client,
      sourceFetch: async (url) => new Response(String(url).includes('op.gg') ? opgg : lolalytics),
    },
  );
  try {
    service.start();
    const deadline = Date.now() + 4000;
    while (service.state().selectedId !== gragas.id) {
      if (Date.now() > deadline) {
        throw new Error('Selection timed out');
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(writes.length, 0, 'manual mode cannot write before user chooses');
    const choices = await service.sourceBuilds.load(gragas.id, 'TOP');
    const first = required(choices.builds[0]),
      second = required(choices.builds[1]);
    await service.importSourceBuild(first.id, ['items']);
    assert.equal(writes.length, 1);
    assert.ok(writes[0]?.endpoint.includes('/lol-item-sets/'));
    assert.deepEqual(service.state().imports, { items: 'Imported' });
    await service.importSourceBuild(second.id, ['items']);
    assert.equal(writes.length, 2, 'another variant can replace an imported one');
    const saved = writes[1]?.body as { itemSets: { blocks: { items: { id: string }[] }[] }[] };
    assert.deepEqual(
      saved.itemSets[0]?.blocks[0]?.items.map((i) => Number(i.id)),
      second.items,
    );
    await service.importSourceBuild(second.id, ['runes']);
    assert.equal(writes.length, 3);
    assert.equal(writes[2]?.endpoint, '/lol-perks/v1/pages');
    assert.equal(
      (writes[2]?.body as { primaryStyleId: number }).primaryStyleId,
      second.runes?.primaryStyleId,
    );
    await assert.rejects(service.importSourceBuild(first.id, []), /at least one/);
    const wrongRole = required((await service.sourceBuilds.load(gragas.id, 'JUNGLE')).builds[0]);
    await assert.rejects(service.importSourceBuild(wrongRole.id, ['items']), /does not match/);
    local.championId = 1;
    await assert.rejects(service.importSourceBuild(first.id, ['items']), /selection changed/);
    assert.equal(writes.length, 3);
  } finally {
    service.stop();
  }
});
