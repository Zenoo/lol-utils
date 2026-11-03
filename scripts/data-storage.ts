import { access, rename, rm, readdir } from 'node:fs/promises';
import path from 'node:path';

export const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

function managedSibling(root: string, target: string, prefix: string) {
  const parent = path.dirname(path.resolve(root));
  const resolved = path.resolve(target);
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith(prefix)) {
    throw new Error('Data staging and backup paths must remain beside the data directory');
  }

  return resolved;
}

export function dataBackup(root: string) {
  return path.join(path.dirname(root), `.${path.basename(root)}-backup`);
}

export async function removeDataStage(root: string, stage: string) {
  const target = managedSibling(root, stage, `.${path.basename(root)}-staging-`);
  await rm(target, { recursive: true, force: true, maxRetries: 3 });
}

/** Restore a previous interrupted swap before another update starts. */
export async function recoverData(root: string) {
  const backup = managedSibling(root, dataBackup(root), `.${path.basename(root)}-backup`);
  if (await exists(backup)) {
    if (!(await exists(root))) {
      await rename(backup, root);
    } else {
      await rm(backup, { recursive: true, force: true, maxRetries: 3 });
    }
  }
  const parent = path.dirname(path.resolve(root));
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(`.${path.basename(root)}-staging-`)) {
      await removeDataStage(root, path.join(parent, entry.name));
    }
  }
}

/** One canonical directory; the prior copy only exists for the duration of publication. */
export async function publishData(root: string, stage: string, move: typeof rename = rename) {
  const staged = managedSibling(root, stage, `.${path.basename(root)}-staging-`);
  const backup = managedSibling(root, dataBackup(root), `.${path.basename(root)}-backup`);
  const hadData = await exists(root);
  if (await exists(backup)) {
    throw new Error('Recover the previous data update before publishing');
  }
  if (hadData) {
    await move(root, backup);
  }
  try {
    await move(staged, root);
  } catch (error) {
    if (hadData) {
      await rename(backup, root);
    }
    throw error;
  }
  if (hadData) {
    await rm(backup, { recursive: true, force: true, maxRetries: 3 });
  }
}
