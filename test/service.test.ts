import test from 'node:test';
import assert from 'node:assert/strict';
import { CompanionService } from '../src/desktop/service.js';
import { defaults } from '../src/desktop/settings.js';
import { windowsForeground } from '../src/desktop/windows.js';
import type { LocalApi } from '../src/integrations/local-api.js';
import type { OverlayState } from '../src/core/types.js';
import { catalog, game, completeSession } from './fixtures.js';
import { draftGame } from '../src/core/draft.js';
import { required } from '../src/core/assert.js';

type ApiClient = Pick<LocalApi, 'request' | 'close'>;
test('champion intent previews a plan without importing and follows hover, lock and cancellation', async () => {
  const session = completeSession();
  const local = required(session.myTeam[0]);
  const shen = local.championId;
  const annie = required(catalog.champions.find((c) => c.alias === 'Annie')).id;
  local.championId = 0;
  local.championPickIntent = shen;
  let autoImport = true;
  const requests: string[] = [];
  const client: ApiClient = {
    request: async (_method, endpoint) => {
      requests.push(endpoint);
      if (endpoint === '/lol-patch/v1/game-version') {
        return catalog.version;
      }
      if (endpoint === '/lol-gameflow/v1/gameflow-phase') {
        return 'ChampSelect';
      }
      if (endpoint === '/lol-champ-select/v1/session') {
        return structuredClone(session);
      }
      throw new Error(`Unexpected import request during preview: ${endpoint}`);
    },
    close: () => {},
  };
  const service = new CompanionService(
    catalog,
    () => ({ ...defaults, autoImport }),
    () => {},
    () => {},
    {
      sourceFetch: async () => new Response('Unavailable in tests', { status: 503 }),
      live: {
        request: async () => {
          throw new Error('No game');
        },
        close: () => {},
      },
      connect: async () => client,
    },
  );
  try {
    service.start();
    await until(() => service.state().selectedId === shen);
    assert.equal(service.state().selectionPreview, true);
    assert.ok(
      service.engine.buildPlan(required(catalog.champions.find((c) => c.id === shen))).length,
    );
    await assert.rejects(service.importSelected(), /No known champion selected/);
    assert.ok(!requests.includes('/lol-summoner/v1/current-summoner'));
    local.championPickIntent = annie;
    await until(() => service.state().selectedId === annie);
    assert.equal(service.state().selectionPreview, true);
    autoImport = false;
    local.championId = shen;
    await until(() => service.state().selectedId === shen && !service.state().selectionPreview);
    local.championId = 0;
    local.championPickIntent = 0;
    await until(() => service.state().selectedId === null);
  } finally {
    service.stop();
  }
});

async function until(condition: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for service state');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
test('an unexpected discovery failure clears an already visible overlay and stale live state', async () => {
  const overlays: (OverlayState | null)[] = [];
  let connects = 0;
  const client: ApiClient = { request: async () => catalog.version, close: () => {} };
  const service = new CompanionService(
    catalog,
    () => defaults,
    () => {},
    (value) => overlays.push(value),
    {
      sourceFetch: async () => new Response('Unavailable in tests', { status: 503 }),
      live: { request: async () => game(), close: () => {} },
      connect: async () => {
        if (++connects > 1) {
          throw new Error('Lockfile vanished');
        }

        return client;
      },
    },
  );
  try {
    service.start();
    await until(() => service.state().connection === 'In game');
    assert.ok(overlays.at(-1));
    await until(() => service.state().connection === 'Local API unavailable');
    assert.equal(overlays.at(-1), null);
    assert.equal(service.state().live, null);
  } finally {
    service.stop();
  }
});
test('a mismatched patch warns the app while live skill and item guidance continues', async () => {
  const overlays: (OverlayState | null)[] = [];
  const client: ApiClient = { request: async () => '0.0.1', close: () => {} };
  const service = new CompanionService(
    catalog,
    () => defaults,
    () => {},
    (value) => overlays.push(value),
    {
      sourceFetch: async () => new Response('Unavailable in tests', { status: 503 }),
      live: { request: async () => game(), close: () => {} },
      connect: async () => client,
    },
  );
  try {
    service.start();
    await until(() => service.state().connection === 'In game');
    assert.ok(service.state().patchWarning?.includes('0.0.1'));
    assert.equal(service.state().patchCompatible, false);
    assert.ok(service.state().live?.buys.length);
    const overlay = overlays.at(-1);
    assert.ok(overlay?.skill.key);
    assert.ok(overlay.buys.length);
    assert.equal('patchWarning' in overlay, false);
  } finally {
    service.stop();
  }
});
test('an unknown patch with no League client still provides live guidance and an app warning', async () => {
  const service = new CompanionService(
    catalog,
    () => defaults,
    () => {},
    () => {},
    {
      sourceFetch: async () => new Response('Unavailable in tests', { status: 503 }),
      live: { request: async () => game(), close: () => {} },
      connect: async () => undefined,
    },
  );
  try {
    service.start();
    await until(() => service.state().connection === 'In game');
    assert.ok(service.state().live?.buys.length);
    assert.match(service.state().patchWarning ?? '', /could not be verified/);
  } finally {
    service.stop();
  }
});
test('both mismatched and unknown patches allow runes, summoners and item-set imports', async () => {
  for (const version of ['0.0.1', undefined]) {
    const writes: string[] = [];
    const client: ApiClient = {
      request: async (method, endpoint) => {
        if (method !== 'GET') {
          writes.push(`${method} ${endpoint}`);

          return undefined;
        }
        if (endpoint === '/lol-patch/v1/game-version') {
          if (!version) {
            throw new Error('Version endpoint unavailable');
          }

          return version;
        }
        if (endpoint === '/lol-gameflow/v1/gameflow-phase') {
          return 'ChampSelect';
        }
        if (endpoint === '/lol-champ-select/v1/session') {
          return {
            gameId: 1,
            localPlayerCellId: 0,
            myTeam: [{ cellId: 0, championId: 1, assignedPosition: 'middle' }],
          };
        }
        if (endpoint === '/lol-summoner/v1/current-summoner') {
          return { summonerId: 1, summonerLevel: 30 };
        }
        if (endpoint === '/lol-gameflow/v1/session') {
          return { gameData: { queue: { gameMode: 'CLASSIC', mapId: 11 } } };
        }
        if (endpoint === '/lol-perks/v1/pages') {
          return [];
        }
        if (endpoint === '/lol-collections/v1/inventories/1/spells') {
          return { spells: catalog.summoners.map((spell) => spell.id) };
        }
        if (endpoint === '/lol-item-sets/v1/item-sets/1/sets') {
          return { itemSets: [] };
        }
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      },
      close: () => {},
    };
    const service = new CompanionService(
      catalog,
      () => ({ ...defaults, autoImport: false }),
      () => {},
      () => {},
      {
        sourceFetch: async () => new Response('Unavailable in tests', { status: 503 }),
        live: {
          request: async () => {
            throw new Error('No game');
          },
          close: () => {},
        },
        connect: async () => client,
      },
    );
    try {
      service.start();
      await until(() => service.state().selectedId === 1);
      assert.ok(service.state().patchWarning);
      await service.importSelected();
      assert.deepEqual(writes, [
        'POST /lol-perks/v1/pages',
        'PATCH /lol-champ-select/v1/session/my-selection',
        'PUT /lol-item-sets/v1/item-sets/1/sets',
      ]);
      assert.deepEqual(service.state().imports, {
        runes: 'Imported',
        summoners: 'Imported',
        items: 'Imported',
      });
    } finally {
      service.stop();
    }
  }
});
test('a champion switch immediately before import cancels all writes', async () => {
  const writes: string[] = [];
  let sessions = 0;
  const client: ApiClient = {
    request: async (method, endpoint) => {
      if (method !== 'GET') {
        writes.push(endpoint);
      }
      if (endpoint === '/lol-patch/v1/game-version') {
        return catalog.version;
      }
      if (endpoint === '/lol-gameflow/v1/gameflow-phase') {
        return 'ChampSelect';
      }
      if (endpoint === '/lol-summoner/v1/current-summoner') {
        return { summonerId: 1, summonerLevel: 30 };
      }
      if (endpoint === '/lol-gameflow/v1/session') {
        return { gameData: { queue: { gameMode: 'CLASSIC', mapId: 11 } } };
      }
      if (endpoint === '/lol-champ-select/v1/session') {
        return {
          gameId: 1,
          localPlayerCellId: 0,
          myTeam: [{ cellId: 0, championId: ++sessions === 1 ? 1 : 2, assignedPosition: 'middle' }],
        };
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    },
    close: () => {},
  };
  const service = new CompanionService(
    catalog,
    () => ({ ...defaults, autoImport: false }),
    () => {},
    () => {},
    {
      sourceFetch: async () => new Response('Unavailable in tests', { status: 503 }),
      live: {
        request: async () => {
          throw new Error('No game');
        },
        close: () => {},
      },
      connect: async () => client,
    },
  );
  try {
    service.start();
    await until(() => service.state().selectedId === 1);
    await assert.rejects(service.importSelected(), /selection changed/);
    assert.deepEqual(writes, []);
  } finally {
    service.stop();
  }
});
test(
  'the Windows foreground bridge queries the current process without modifying it',
  { skip: process.platform !== 'win32' },
  () => {
    const result = windowsForeground()();
    assert.ok(result === null || (result.width >= 300 && result.height >= 300));
  },
);

test('draft changes do not import generated builds; explicit imports still use both teams', async () => {
  const full = completeSession();
  const session = structuredClone(full);
  session.theirTeam[3].championId = 0;
  session.theirTeam[4].championId = 0;
  const writes: { endpoint: string; body: unknown }[] = [];
  let reads = 0;
  const client: ApiClient = {
    close: () => {},
    request: async (method, endpoint, body) => {
      if (method !== 'GET') {
        writes.push({ endpoint, body });

        return undefined;
      }
      if (endpoint === '/lol-patch/v1/game-version') {
        return catalog.version;
      }
      if (endpoint === '/lol-gameflow/v1/gameflow-phase') {
        return 'ChampSelect';
      }
      if (endpoint === '/lol-champ-select/v1/session') {
        reads++;

        return structuredClone(session);
      }
      if (endpoint === '/lol-summoner/v1/current-summoner') {
        return { summonerId: 1, summonerLevel: 30 };
      }
      if (endpoint === '/lol-gameflow/v1/session') {
        return { gameData: { queue: { gameMode: 'CLASSIC', mapId: 11 } } };
      }
      if (endpoint === '/lol-perks/v1/pages') {
        return [];
      }
      if (endpoint === '/lol-collections/v1/inventories/1/spells') {
        return { spells: catalog.summoners.map((s) => s.id) };
      }
      if (endpoint === '/lol-item-sets/v1/item-sets/1/sets') {
        return { itemSets: [] };
      }
      throw new Error(endpoint);
    },
  };
  const service = new CompanionService(
    catalog,
    () => defaults,
    () => {},
    () => {},
    {
      sourceFetch: async () => new Response('Unavailable in tests', { status: 503 }),
      live: {
        close: () => {},
        request: async () => {
          throw new Error('No match');
        },
      },
      connect: async () => client,
    },
  );
  const itemWrites = () => writes.filter((w) => w.endpoint.includes('/lol-item-sets/'));
  try {
    service.start();
    await until(() => service.state().selectedId === session.myTeam[0]?.championId);
    assert.equal(writes.length, 0, 'champion selection waits for a source choice');
    session.theirTeam[3].championId = full.theirTeam[3].championId;
    const previousReads = reads;
    await until(() => reads > previousReads);
    assert.equal(writes.length, 0, 'no import for an intermediate pick');
    session.theirTeam[4].championId = full.theirTeam[4].championId;
    await until(() => Boolean(service.state().draftKey));
    assert.equal(writes.length, 0, 'complete draft still waits for user choice');
    await service.importSelected();
    assert.equal(writes.length, 3, 'explicit import applies the plan');
    const saved = itemWrites()[0].body as {
      itemSets: { blocks: { type: string; items: { id: string }[] }[] }[];
    };
    const ids = saved.itemSets[0].blocks
      .filter((block) => !block.type.startsWith('Starter alternative:'))
      .map((b) => Number(b.items[0].id));
    const shen = required(catalog.champions.find((c) => c.alias === 'Shen'));
    assert.deepEqual(ids, service.engine.build(shen, 11, 'TOP', draftGame(catalog, full)));
    assert.deepEqual(ids.slice(0, 2), [3075, 3047]);
    assert.ok(service.state().draftKey);
    const finalReads = reads;
    await until(() => reads > finalReads);
    assert.equal(itemWrites().length, 1, 'unchanged complete roster is not imported again');
  } finally {
    service.stop();
  }
});

test('a closed League client still warns about outdated bundled data using the public patch check', async () => {
  let requests = 0;
  const service = new CompanionService(
    catalog,
    () => defaults,
    () => {},
    () => {},
    {
      sourceFetch: async () => new Response('Unavailable in tests', { status: 503 }),
      live: {
        request: async () => {
          throw new Error('No game');
        },
        close: () => {},
      },
      connect: async () => undefined,
      versions: async () => {
        requests++;

        return ['99.1.2'];
      },
    },
  );
  try {
    service.start();
    await until(() => Boolean(service.state().patchWarning?.includes('99.1.2')));
    assert.match(service.state().patchWarning ?? '', /outdated/);
    assert.equal(service.state().live, null);
    assert.equal(requests, 1);
  } finally {
    service.stop();
  }
});
