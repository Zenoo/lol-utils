import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { digest, loadCatalog } from '../src/core/data.js';
const root = fileURLToPath(new URL('../data/', import.meta.url));
if ((await readdir(root)).some((name) => /^\d+\.\d+\.\d+(?:-[a-f0-9]{12})?$/.test(name))) {
  throw new Error('Remove obsolete versioned data directories; data must use the canonical paths');
}
const { catalog, manifest } = await loadCatalog(root);
for (const source of manifest.sources) {
  if (!/^raw\/[a-zA-Z0-9/.-]+\.json$/.test(source.file) || source.file.includes('..')) {
    throw new Error('Invalid source path');
  }
  const bytes = await readFile(path.join(root, source.file));
  if (digest(bytes) !== source.sha256) {
    throw new Error(`Corrupted source: ${source.file}`);
  }
}
console.log(
  `Verified ${catalog.version}, ${manifest.sources.length} source checksums; ${JSON.stringify(manifest.counts)}`,
);
