import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CompanionService } from '../src/desktop/service.js';
import { defaults, loadSettings, validateSettings } from '../src/desktop/settings.js';
import type { Settings } from '../src/core/types.js';
import { catalog, completeSession } from './fixtures.js';
import { required } from '../src/core/assert.js';

const opgg = await readFile('test/fixtures/opgg-gragas.html', 'utf8');
async function until(condition: () => boolean) {
  const deadline = Date.now() + 6500;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for auto-import state');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function setup(
  source: Settings['autoImportSource'],
  fetcher: typeof fetch = async (url) =>
    String(url).includes('op.gg') ? new Response(opgg) : new Response('', { status: 503 }),
) {
  const session = completeSession();
  const me = required(session.myTeam.find((entry) => entry.cellId === session.localPlayerCellId));
  me.championId = 79;
  me.assignedPosition = 'top';
  const settings: Settings = { ...defaults, autoImport: true, autoImportSource: source };
  const writes: { endpoint: string; body: unknown }[] = [];
  let reads = 0;
  let flowGate: Promise<void> | undefined;
  let flowReads = 0;
  const service = new CompanionService(
    catalog,
    () => settings,
    () => {},
    () => {},
    {
      live: {
        close: () => {},
        request: async () => {
          throw new Error('No game');
        },
      },
      sourceFetch: fetcher,
      connect: async () => ({
        close: () => {},
        request: async (method, endpoint, body) => {
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
            reads++;

            return structuredClone(session);
          }
          if (endpoint === '/lol-summoner/v1/current-summoner') {
            return { summonerId: 1, summonerLevel: 30 };
          }
          if (endpoint === '/lol-gameflow/v1/session') {
            flowReads++;
            await flowGate;

            return { gameData: { queue: { gameMode: 'CLASSIC', mapId: 11 } } };
          }
          if (endpoint === '/lol-perks/v1/pages') {
            return [];
          }
          if (endpoint === '/lol-collections/v1/inventories/1/spells') {
            return { spells: catalog.summoners.map((spell) => spell.id) };
          }
          if (endpoint === '/lol-item-sets/v1/item-sets/1/sets') {
            return { itemSets: [{ uid: 'personal' }] };
          }
          throw new Error(endpoint);
        },
      }),
    },
  );

  return {
    service,
    session,
    me,
    settings,
    writes,
    reads: () => reads,
    flowReads: () => flowReads,
    holdFlow: (gate: Promise<void>) => {
      flowGate = gate;
    },
  };
}

test('automatic import uses the first selected provider build exactly once without waiting for other providers', async () => {
  let releaseOthers: ((response: Response) => void) | undefined;
  const other = new Promise<Response>((resolve) => {
    releaseOthers = resolve;
  });
  const run = setup('OP.GG', async (url) =>
    String(url).includes('op.gg') ? new Response(opgg) : other,
  );
  try {
    run.service.start();
    await until(() => run.service.state().autoImportStatus === 'First OP.GG build imported.');
    assert.equal(run.writes.length, 3);
    const saved = run.writes.find((entry) => entry.endpoint.includes('item-sets'))?.body as {
      itemSets: { blocks?: { items: { id: string }[] }[] }[];
    };
    assert.deepEqual(
      saved.itemSets[1]?.blocks?.[0]?.items.map((item) => Number(item.id)),
      [3070, 6657, 3121, 4629],
    );
    const before = run.reads();
    await until(() => run.reads() > before);
    assert.equal(run.writes.length, 3);
  } finally {
    run.service.stop();
    releaseOthers?.(new Response('', { status: 503 }));
  }
});

test('local automatic imports wait for a selected champion and use all three generated parts', async () => {
  const run = setup('Local');
  run.me.championId = 0;
  run.me.championPickIntent = 79;
  try {
    run.service.start();
    await until(() => run.service.state().selectionPreview === true);
    assert.equal(run.writes.length, 0);
    run.me.championId = 79;
    await until(() => run.service.state().autoImportStatus === 'First Local build imported.');
    assert.equal(run.writes.length, 3);
    const saved = run.writes.find((entry) => entry.endpoint.includes('item-sets'))?.body as {
      itemSets: { blocks?: { type: string; items: { id: string }[] }[] }[];
    };
    const items = saved.itemSets[1]?.blocks
      ?.filter((block) => !block.type.startsWith('Starter alternative:'))
      .flatMap((block) => block.items.map((item) => Number(item.id)));
    assert.deepEqual(
      items,
      run.service.engine.build(
        required(catalog.champions.find((champion) => champion.id === 79)),
        11,
        'TOP',
        run.service.planningGame(79),
      ),
    );
  } finally {
    run.service.stop();
  }
});

test('an unavailable preferred source does not fall back to local or another provider', async () => {
  const run = setup('MetaBot');
  try {
    run.service.start();
    await until(() => Boolean(run.service.state().autoImportStatus?.includes('No MetaBot build')));
    assert.equal(run.writes.length, 0);
    assert.equal(run.service.state().connection, 'Champion select');
  } finally {
    run.service.stop();
  }
});

test('a delayed automatic import cannot overwrite a manual local choice or a settings change', async () => {
  for (const manual of [true, false]) {
    let release: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const run = setup('OP.GG', async (url) =>
      String(url).includes('op.gg') ? pending : new Response('', { status: 503 }),
    );
    try {
      run.service.start();
      await until(() => run.service.state().autoImportStatus === 'Loading first OP.GG build…');
      if (manual) {
        await run.service.importSourceBuild('local-79-TOP', ['items']);
      } else {
        run.settings.autoImport = false;
        run.service.settingsChanged();
      }
      release?.(new Response(opgg));
      await run.service.sourceBuilds.load(79, 'TOP');
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(run.writes.length, manual ? 1 : 0);
    } finally {
      run.service.stop();
      release?.(new Response(opgg));
    }
  }
});

test('selection is checked again before a delayed source is written', async () => {
  let release: ((response: Response) => void) | undefined;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const run = setup('OP.GG', async (url) =>
    String(url).includes('op.gg') ? pending : new Response('', { status: 503 }),
  );
  try {
    run.service.start();
    await until(() => run.service.state().autoImportStatus === 'Loading first OP.GG build…');
    run.me.championId = 1;
    release?.(new Response(opgg));
    await until(() => Boolean(run.service.state().autoImportStatus?.includes('selection changed')));
    assert.equal(run.writes.length, 0);
    assert.equal(run.service.state().connection, 'Champion select');
  } finally {
    run.service.stop();
    release?.(new Response(opgg));
  }
});

test('source settings validate allowed providers and migrate legacy automation to manual mode', () => {
  assert.throws(() => validateSettings({ ...defaults, autoImportSource: 'Unknown' }));
  assert.equal(
    loadSettings({ ...defaults, autoImport: true, autoImportSource: undefined }).autoImport,
    false,
  );
  assert.equal(
    loadSettings({ ...defaults, autoImport: true, autoImportSource: 'OP.GG' }).autoImportSource,
    'OP.GG',
  );
});

test('disabling automation during client validation cancels remaining writes', async () => {
  const run = setup('Local');
  let release: (() => void) | undefined;
  run.holdFlow(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  try {
    run.service.start();
    await until(() => run.flowReads() === 1);
    run.settings.autoImport = false;
    run.service.settingsChanged();
    const reads = run.reads();
    release?.();
    await until(() => run.reads() > reads);
    assert.equal(run.writes.length, 0);
  } finally {
    run.service.stop();
    release?.();
  }
});
