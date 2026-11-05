import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const versionPattern = /^\d+\.\d+\.\d+$/;

/** Dependency-free so CI can decide whether to install and build anything. */
export async function latestDataVersion(fetcher = fetch): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetcher('https://ddragon.leagueoflegends.com/api/versions.json', {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`Version check returned HTTP ${response.status}`);
      }
      const versions: unknown = await response.json();
      if (
        !Array.isArray(versions) ||
        typeof versions[0] !== 'string' ||
        !versionPattern.test(versions[0])
      ) {
        throw new Error('Invalid upstream version list');
      }

      return versions[0];
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

export async function checkDataVersion(manifestFile: string, fetcher = fetch) {
  const manifest: unknown = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !('version' in manifest) ||
    typeof manifest.version !== 'string' ||
    !versionPattern.test(manifest.version)
  ) {
    throw new Error('Invalid local data manifest version');
  }
  const version = await latestDataVersion(fetcher);

  return { version, currentVersion: manifest.version, changed: version !== manifest.version };
}

async function main() {
  const result = await checkDataVersion(path.resolve('data/manifest.json'));
  console.log(
    result.changed
      ? `New data available: ${result.currentVersion} -> ${result.version}`
      : `Already on ${result.version}; skipping dataset rebuild and validation.`,
  );
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `version=${result.version}\nchanged=${result.changed}\n`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
