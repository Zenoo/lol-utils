import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Catalog, Manifest } from './types.js';
import { catalogSchema, manifestSchema } from './schema.js';
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function validateCatalog(input: unknown): Catalog {
  const c = catalogSchema.parse(input);
  if (!/^\d+\.\d+\.\d+$/.test(c.version) || c.locale !== 'en_US') {
    throw new Error('Unsupported data version or locale');
  }
  if (!Array.isArray(c.champions) || c.champions.length < 100) {
    throw new Error('Incomplete champions');
  }
  if (!Array.isArray(c.items) || c.items.length < 100) {
    throw new Error('Incomplete items');
  }
  if (!Array.isArray(c.runeStyles) || c.runeStyles.length < 5 || !Array.isArray(c.perks)) {
    throw new Error('Incomplete runes');
  }
  if (!Array.isArray(c.summoners) || c.summoners.length < 10) {
    throw new Error('Incomplete summoner spells');
  }
  for (const list of [c.champions, c.items, c.perks, c.summoners]) {
    const ids = new Set();
    for (const entry of list) {
      if (!Number.isInteger(entry.id) || typeof entry.name !== 'string' || ids.has(entry.id)) {
        throw new Error(`Invalid or duplicate data entry: ${JSON.stringify(entry).slice(0, 250)}`);
      }
      ids.add(entry.id);
    }
  }
  for (const champ of c.champions) {
    if (!champ.stats || champ.spells?.length !== 4 || !champ.source?.tacticalInfo) {
      throw new Error(`Incomplete champion ${champ.name}`);
    }
    for (const value of Object.values(champ.stats)) {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error('Invalid stats');
      }
    }
  }
  const perks = new Set(c.perks.map((p) => p.id));
  for (const style of c.runeStyles) {
    for (const slot of style.slots) {
      if (!slot.perks.length || slot.perks.some((id) => !perks.has(id))) {
        throw new Error('Broken rune slot');
      }
    }
  }

  return c;
}

async function readCatalog(root: string): Promise<{ catalog: Catalog; manifest: Manifest }> {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')),
  );
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error('Invalid manifest version');
  }
  const file = await readFile(path.join(root, 'catalog.json'));
  if (digest(file) !== manifest.catalogSha256) {
    throw new Error('Data checksum mismatch');
  }
  const catalog = validateCatalog(JSON.parse(file.toString('utf8')));
  if (catalog.version !== manifest.version) {
    throw new Error('Version mismatch');
  }

  return { catalog, manifest };
}

export async function loadCatalog(root: string): Promise<{ catalog: Catalog; manifest: Manifest }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await readCatalog(root);
    } catch (error) {
      const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
      const swapped =
        error instanceof Error &&
        ['Data checksum mismatch', 'Version mismatch'].includes(error.message);
      if (attempt >= 2 || (!missing && !swapped)) {
        throw error;
      }
      // A directory swap can briefly hide data or straddle two manifest/catalog reads.
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
