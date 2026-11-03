import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const version = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/);
const packageSchema = z.object({
  version,
  build: z.object({ win: z.object({ artifactName: z.string() }) }),
});
const lockSchema = z.object({
  version,
  packages: z.object({ '': z.object({ version }) }),
});

export function releaseInfo(packageJson: unknown, lockJson: unknown, tag?: string) {
  const pkg = packageSchema.parse(packageJson);
  const lock = lockSchema.parse(lockJson);
  if (pkg.version !== lock.version || pkg.version !== lock.packages[''].version) {
    throw new Error('package.json and package-lock.json versions must match');
  }
  const expectedTag = `v${pkg.version}`;
  if (tag !== undefined && tag !== expectedTag) {
    throw new Error(`Release tag must be ${expectedTag}; received ${tag}`);
  }
  const filename = pkg.build.win.artifactName
    .replaceAll('${version}', pkg.version)
    .replaceAll('${arch}', 'x64')
    .replaceAll('${ext}', 'exe');
  if (!/^[\w.-]+\.exe$/.test(filename) || filename.includes('..')) {
    throw new Error('Release artifact must be a plain executable filename');
  }

  return { version: pkg.version, tag: expectedTag, filename };
}

export async function projectRelease(tag?: string) {
  const [pkg, lock] = await Promise.all([
    readFile('package.json', 'utf8'),
    readFile('package-lock.json', 'utf8'),
  ]);

  return releaseInfo(JSON.parse(pkg), JSON.parse(lock), tag);
}

export async function checksumExecutable(file: string): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const signature = Buffer.alloc(2);
    await handle.read(signature, 0, 2, 0);
    if (signature.toString('ascii') !== 'MZ') {
      throw new Error('Release artifact is not a Windows executable');
    }
  } finally {
    await handle.close();
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }

  return `${hash.digest('hex')}  ${path.basename(file)}\n`;
}

async function main() {
  const command = process.argv[2];
  const tag = process.argv[3] ?? process.env.RELEASE_TAG;
  if (command !== 'verify' && command !== 'assets') {
    throw new Error('Usage: npm run release:verify -- vX.Y.Z, or npm run release:assets');
  }
  if (command === 'verify' && !tag) {
    throw new Error('Provide a version tag or set RELEASE_TAG');
  }
  const info = await projectRelease(tag);
  if (command === 'assets') {
    const checksum = await checksumExecutable(path.resolve('dist', info.filename));
    await writeFile('dist/SHA256SUMS.txt', checksum);
    console.log(checksum.trim());
  } else {
    console.log(`Verified ${info.tag}: ${info.filename}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
