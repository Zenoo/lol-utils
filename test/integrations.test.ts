import { required } from '../src/core/assert.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { LocalApi, parseLockfile } from '../src/integrations/local-api.js';
import {
  importItems,
  importRunes,
  importSummoners,
  mergeItemSets,
} from '../src/integrations/imports.js';
import { defaults, validateSettings } from '../src/desktop/settings.js';
import { samePatch } from '../src/desktop/service.js';
import { Engine } from '../src/core/engine.js';
import { Poller } from '../src/core/poller.js';
import { catalog } from './fixtures.js';
import { z } from 'zod';
import { itemSetsSchema } from '../src/core/schema.js';

const engine = new Engine(catalog),
  champ = catalog.champions[0];
test('lockfile validation accepts valid HTTPS credentials and rejects malformed ports or protocols', () => {
  assert.deepEqual(parseLockfile('LeagueClient:1234:51000:secret:https\n'), {
    port: 51000,
    password: 'secret',
  });
  for (const value of [
    '',
    'League:1:0:x:https',
    'League:1:65536:x:https',
    'League:1:3000:x:http',
    'League:1:3000::https',
    'League:1:30x:x:https',
  ]) {
    assert.throws(() => parseLockfile(value));
  }
  assert.throws(() => new LocalApi(0));
});
test('loopback transport rejects absolute URLs and bounds silent TLS handshakes', async () => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const api = new LocalApi(port);
  try {
    assert.throws(() => api.request('GET', 'https://example.com/'));
    assert.throws(() => api.request('GET', '//example.com/'));
    await assert.rejects(api.request('GET', '/test'), /timed out/);
  } finally {
    api.close();
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test('item-set merge preserves unrelated sets and metadata, replacing only the exact app-owned UID', () => {
  const existing = {
    accountId: 1,
    timestamp: 2,
    itemSets: [
      { uid: 'mine', blocks: [1] },
      { uid: 'lol-utils-1-11', blocks: [2] },
    ],
  };
  const updated = mergeItemSets(existing, { uid: 'lol-utils-1-11', blocks: [3] });
  assert.deepEqual(updated.itemSets, [
    { uid: 'mine', blocks: [1] },
    { uid: 'lol-utils-1-11', blocks: [3] },
  ]);
  assert.equal(updated.timestamp, 2);
  assert.equal(existing.itemSets[1].blocks[0], 2);
  assert.throws(() => mergeItemSets({}, {}));
});
test('rune imports reuse only an editable app page and never delete a user page', async () => {
  const calls: { method: string; endpoint: string; body?: unknown }[] = [];
  const api: Pick<LocalApi, 'request'> = {
    request: async (method, endpoint, body) => {
      calls.push({ method, endpoint, body });
      if (method === 'GET') {
        return [
          { id: 10, name: 'Personal', isEditable: true },
          { id: 20, name: 'LoL Utils · Old', isEditable: true },
        ];
      }
    },
  };
  await importRunes(api, engine, champ);
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].endpoint, '/lol-perks/v1/pages/20');
  assert.equal(
    z.object({ selectedPerkIds: z.array(z.number()) }).parse(calls[1].body).selectedPerkIds.length,
    9,
  );
  assert.ok(!calls.some((c) => c.method === 'DELETE'));
});
test('a full rune-page error surfaces without deleting or overwriting personal pages', async () => {
  const calls: string[] = [];
  const api: Pick<LocalApi, 'request'> = {
    request: async (method) => {
      calls.push(method);
      if (method === 'GET') {
        return [{ id: 1, name: 'Personal', isEditable: true }];
      }
      throw new Error('No free rune pages');
    },
  };
  await assert.rejects(importRunes(api, engine, champ), /No free/);
  assert.deepEqual(calls, ['GET', 'POST']);
});
test('summoner import uses inventory spell availability and honors preferred Flash side', async () => {
  let payload: unknown;
  const available = catalog.summoners.filter((s) => s.modes.includes('CLASSIC')).map((s) => s.id);
  const api: Pick<LocalApi, 'request'> = {
    request: async (method, endpoint, body) => {
      if (method === 'GET') {
        assert.equal(endpoint, '/lol-collections/v1/inventories/123/spells');

        return { spells: available };
      }
      payload = body;
    },
  };
  await importSummoners(
    api,
    engine,
    champ,
    { ...defaults, flashSlot: 'D' },
    'MIDDLE',
    'CLASSIC',
    30,
    123,
  );
  assert.equal(
    z.object({ spell1Id: z.number() }).parse(payload).spell1Id,
    required(catalog.summoners.find((s) => s.alias === 'SummonerFlash')).id,
  );
});
test('item import merges the set against a fresh GET before PUT', async () => {
  let saved: unknown;
  const api: Pick<LocalApi, 'request'> = {
    request: async (method, _endpoint, body) => {
      if (method === 'GET') {
        return { itemSets: [{ uid: 'personal' }] };
      }
      saved = body;
    },
  };
  await importItems(api, engine, champ, 1, 11);
  const parsed = itemSetsSchema.parse(saved);
  assert.equal(parsed.itemSets[0].uid, 'personal');
  const starters = engine.starters(champ);
  assert.equal(z.array(z.unknown()).parse(parsed.itemSets[1].blocks).length, starters.length + 6);
  const blocks = z
    .array(z.object({ type: z.string(), items: z.array(z.object({ id: z.string() })) }))
    .parse(parsed.itemSets[1].blocks);
  starters.forEach((entry, index) => {
    assert.ok(blocks[index].type.includes(entry.item.name));
    assert.ok(blocks[index].type.includes(required(entry.reasons.at(-1))));
  });
  const plan = engine.buildPlan(champ, 11);
  for (const [index, entry] of plan.entries()) {
    assert.ok(blocks[index + starters.length].type.includes(entry.item.name));
    assert.ok(blocks[index + starters.length].type.includes(required(entry.reasons.at(-1))));
    assert.equal(blocks[index + starters.length].items[0].id, String(entry.item.id));
  }

  await assert.rejects(importItems(api, engine, champ, 1, 12), /Rift/);
});
test('settings whitelist values and never persist arbitrary renderer properties', () => {
  assert.deepEqual(validateSettings({ ...defaults, token: 'do-not-save' }), defaults);
  for (const patch of [
    { flashSlot: 'X' },
    { autoImport: 'true' },
    { shopHotkey: 'Control+Control+P' },
    { role: 'UNKNOWN' },
  ]) {
    assert.throws(() => validateSettings({ ...defaults, ...patch }));
  }
});
test('patch guard compares major and minor components, not loose string prefixes', () => {
  assert.ok(samePatch('16.21.1234', '16.21.1'));
  assert.ok(!samePatch('16.2.1', '16.21.1'));
  assert.ok(!samePatch('', '16.21.1'));
});
test('poller never overlaps tasks and does not reschedule after stop during a request', async () => {
  let release: (() => void) | undefined,
    count = 0;
  const poller = new Poller(async () => {
    count++;
    await new Promise<void>((r) => {
      release = r;
    });

    return 100;
  });
  poller.start();
  poller.start();
  assert.equal(count, 1);
  poller.stop();
  required(release)();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(count, 1);
});
