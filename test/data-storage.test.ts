import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  dataBackup,
  exists,
  publishData,
  recoverData,
  removeDataStage,
} from '../scripts/data-storage.js';
import { digest, loadCatalog } from '../src/core/data.js';
import { catalog } from './fixtures.js';

async function temporary(t: TestContext) {
  const parent = await mkdtemp(path.join(tmpdir(), 'lol-utils-data-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(parent)), path.resolve(tmpdir()));
    assert.ok(path.basename(parent).startsWith('lol-utils-data-'));
    await rm(parent, { recursive: true, force: true, maxRetries: 3 });
  });

  return { parent, root: path.join(parent, 'data') };
}
async function stageData(parent: string, suffix: string, contents: string) {
  const stage = path.join(parent, `.data-staging-${suffix}`);
  await mkdir(path.join(stage, 'raw'), { recursive: true });
  await writeFile(path.join(stage, 'catalog.json'), contents);
  await writeFile(path.join(stage, 'raw', `${suffix}.json`), contents);
  await writeFile(path.join(stage, 'manifest.json'), JSON.stringify({ version: '1.0.0' }));

  return stage;
}

test('updates replace the canonical data directory, including same-version refreshes, without retaining old files', async (t) => {
  const { parent, root } = await temporary(t);
  await publishData(root, await stageData(parent, 'first', 'first catalog'));
  await publishData(root, await stageData(parent, 'second', 'second catalog'));
  assert.equal(await readFile(path.join(root, 'catalog.json'), 'utf8'), 'second catalog');
  assert.deepEqual(await readdir(path.join(root, 'raw')), ['second.json']);
  assert.deepEqual(await readdir(parent), ['data']);
});

test('failed publication restores the previous catalog and rejects unmanaged paths', async (t) => {
  const { parent, root } = await temporary(t);
  await publishData(root, await stageData(parent, 'first', 'working catalog'));
  const stage = await stageData(parent, 'second', 'replacement');
  await assert.rejects(
    publishData(root, stage, async (source, target) => {
      if (target === root) {
        throw new Error('Swap failed');
      }
      await rename(source, target);
    }),
    /Swap failed/,
  );
  assert.equal(await readFile(path.join(root, 'catalog.json'), 'utf8'), 'working catalog');
  assert.equal(await exists(dataBackup(root)), false);
  await removeDataStage(root, stage);
  await assert.rejects(publishData(root, path.join(parent, 'unmanaged')), /must remain/);
  assert.deepEqual(await readdir(parent), ['data']);
});

test('interrupted directory swaps recover the prior catalog or discard the temporary prior copy', async (t) => {
  const { parent, root } = await temporary(t);
  await publishData(root, await stageData(parent, 'first', 'previous'));
  await rename(root, dataBackup(root));
  await stageData(parent, 'abandoned', 'incomplete download');
  await recoverData(root);
  assert.equal(await readFile(path.join(root, 'catalog.json'), 'utf8'), 'previous');
  const newer = await stageData(parent, 'next', 'new');
  await rename(root, dataBackup(root));
  await rename(newer, root);
  await recoverData(root);
  assert.equal(await readFile(path.join(root, 'catalog.json'), 'utf8'), 'new');
  assert.deepEqual(await readdir(parent), ['data']);
});

test('catalog loading uses the fixed path and validates the version and checksum', async (t) => {
  const { root } = await temporary(t);
  await mkdir(root);
  const bytes = JSON.stringify(catalog);
  const manifest = {
    version: catalog.version,
    patch: catalog.patch,
    locale: catalog.locale,
    fetchedAt: new Date().toISOString(),
    catalogSha256: digest(bytes),
    sources: [],
    counts: {
      champions: catalog.champions.length,
      items: catalog.items.length,
      perks: catalog.perks.length,
      summoners: catalog.summoners.length,
    },
  };
  await writeFile(path.join(root, 'catalog.json'), bytes);
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  assert.equal((await loadCatalog(root)).catalog.version, catalog.version);
  await writeFile(path.join(root, 'catalog.json'), 'corrupted');
  await assert.rejects(loadCatalog(root), /checksum mismatch/);
});
