import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
export async function git(args: string[], cwd: string): Promise<string> {
  const result = await execute('git', ['-c', `safe.directory=${cwd}`, ...args], { cwd });

  return result.stdout.trim();
}

/** Use an explicit remote SHA: shallow Actions checkouts have no patch tracking ref. */
export async function pushDataBranch(cwd: string, branch: string, run = git) {
  if (!/^data\/patch-\d+\.\d+\.\d+$/.test(branch)) {
    throw new Error('Invalid data branch');
  }
  const ref = `refs/heads/${branch}`;
  const remote = await run(['ls-remote', '--refs', 'origin', ref], cwd);
  const expected = remote ? remote.split(/\s+/)[0] : '';
  if (expected && !/^[a-f0-9]{40,64}$/.test(expected)) {
    throw new Error('Invalid remote commit');
  }
  // Empty expected SHA also protects against a branch created after the lookup.
  await run(['push', `--force-with-lease=${ref}:${expected}`, 'origin', `HEAD:${ref}`], cwd);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void pushDataBranch(process.cwd(), process.argv[2] ?? '').catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
