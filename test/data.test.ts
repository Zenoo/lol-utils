import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, validateCatalog } from '../src/core/data.js';
import { fetchJson, pool } from '../scripts/update-data.js';
import { catalog } from './fixtures.js';

test('catalog validation rejects incomplete, duplicate, non-finite, and disconnected rune data', () => {
  assert.deepEqual(validateCatalog(catalog), catalog);
  assert.throws(() => validateCatalog({ ...catalog, champions: [] }));
  assert.throws(() =>
    validateCatalog({ ...catalog, champions: [...catalog.champions, catalog.champions[0]] }),
  );
  assert.throws(() =>
    validateCatalog({
      ...catalog,
      champions: [{ ...catalog.champions[0], stats: { hp: NaN } }, ...catalog.champions.slice(1)],
    }),
  );
  assert.throws(() =>
    validateCatalog({
      ...catalog,
      runeStyles: [
        { ...catalog.runeStyles[0], slots: [{ perks: [-1] }] },
        ...catalog.runeStyles.slice(1),
      ],
    }),
  );
  assert.notEqual(digest('good'), digest('corrupt'));
});
test('download pool bounds concurrency and drains workers before reporting failure', async () => {
  let active = 0,
    peak = 0,
    completed = 0;
  await assert.rejects(
    pool([0, 1, 2, 3, 4], 2, async (i) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      completed++;
      if (i === 1) {
        throw new Error('failed');
      }
    }),
    /failed/,
  );
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.equal(completed, 5);
});
test('fetch retries transient failures, rejects non-JSON and does not accept an HTTP error page', async () => {
  let requests = 0;
  const fetcher = async () => {
    requests++;

    return requests === 1 ? new Response('no', { status: 503 }) : Response.json({ ok: true });
  };
  assert.deepEqual(await fetchJson('https://example.test/data', fetcher as typeof fetch), {
    ok: true,
  });
  assert.equal(requests, 2);
});
