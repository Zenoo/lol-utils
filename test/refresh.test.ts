import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkDataVersion, latestDataVersion } from '../scripts/check-data-version.js';
import { git, pushDataBranch } from '../scripts/push-data-branch.js';

test('version check requests only the version index and never rewrites unchanged data', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lol-version-'));
  try {
    const manifest = path.join(directory, 'manifest.json');
    const bytes = '{"version":"16.21.1","fetchedAt":"unchanged"}\n';
    await writeFile(manifest, bytes);
    const urls: string[] = [];
    const fetcher: typeof fetch = async (url) => {
      urls.push(String(url));

      return Response.json(['16.21.1']);
    };
    assert.deepEqual(await checkDataVersion(manifest, fetcher), {
      version: '16.21.1',
      currentVersion: '16.21.1',
      changed: false,
    });
    assert.deepEqual(urls, ['https://ddragon.leagueoflegends.com/api/versions.json']);
    assert.equal(await readFile(manifest, 'utf8'), bytes);
    assert.equal(
      (await checkDataVersion(manifest, async () => Response.json(['16.22.1']))).changed,
      true,
    );
    assert.equal(await readFile(manifest, 'utf8'), bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('version checks retry upstream failures and reject invalid branch-unsafe versions', async () => {
  let attempts = 0;
  assert.equal(
    await latestDataVersion(async () => {
      attempts++;

      return attempts === 1 ? new Response('', { status: 503 }) : Response.json(['16.22.1']);
    }),
    '16.22.1',
  );
  assert.equal(attempts, 2);
  await assert.rejects(
    latestDataVersion(async () => Response.json(['../../bad\nchanged=true'])),
    /Invalid upstream/,
  );
});

test('refresh creates and replaces an existing remote patch branch without a tracking ref, and rejects a racing writer', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lol-refresh-'));
  try {
    const remote = path.join(directory, 'remote.git');
    const work = path.join(directory, 'work');
    const rival = path.join(directory, 'rival');
    await git(['init', '--bare', remote], directory);
    await git(['clone', remote, work], directory);
    await git(['config', 'user.email', 'test@example.test'], work);
    await git(['config', 'user.name', 'Refresh test'], work);
    const commit = async (cwd: string, value: string) => {
      await writeFile(path.join(cwd, 'data.txt'), value);
      await git(['add', 'data.txt'], cwd);
      await git(['commit', '-m', value], cwd);
    };
    const branch = 'data/patch-16.22.1';
    await commit(work, 'initial');
    await pushDataBranch(work, branch);
    await git(['clone', '--branch', branch, remote, rival], directory);
    await git(['config', 'user.email', 'test@example.test'], rival);
    await git(['config', 'user.name', 'Refresh rival'], rival);
    await commit(work, 'refresh');
    // Reproduce checkout@v4: no origin/data/patch-* tracking reference.
    await git(['update-ref', '-d', `refs/remotes/origin/${branch}`], work);
    await pushDataBranch(work, branch);
    const head = await git(['rev-parse', 'HEAD'], work);
    assert.ok((await git(['ls-remote', 'origin', `refs/heads/${branch}`], work)).startsWith(head));
    await commit(work, 'next-refresh');
    await commit(rival, 'concurrent-edit');
    await assert.rejects(
      pushDataBranch(work, branch, async (args, cwd) => {
        const result = await git(args, cwd);
        if (args[0] === 'ls-remote') {
          await git(['push', '--force', 'origin', `HEAD:refs/heads/${branch}`], rival);
        }

        return result;
      }),
      /stale info|rejected/,
    );
    const rivalHead = await git(['rev-parse', 'HEAD'], rival);
    assert.ok(
      (await git(['ls-remote', 'origin', `refs/heads/${branch}`], work)).startsWith(rivalHead),
    );
    await assert.rejects(pushDataBranch(work, 'main'), /Invalid data branch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
