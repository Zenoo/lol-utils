import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../src/ui/', import.meta.url));
const target = fileURLToPath(new URL('../build/src/ui/', import.meta.url));
await mkdir(target, { recursive: true });
await cp(source, target, {
  recursive: true,
  filter: (file) => !file.endsWith('.ts'),
});
