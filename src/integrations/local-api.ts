import https from 'node:https';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function parseLockfile(text: string) {
  const [name, pid, port, password, protocol, ...extra] = text.trim().split(':');
  if (
    !name ||
    !/^\d+$/.test(pid) ||
    !/^\d+$/.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535 ||
    !password ||
    protocol !== 'https' ||
    extra.length
  ) {
    throw new Error('Invalid League lockfile');
  }

  return { port: Number(port), password };
}
/** TLS exception is confined to hardcoded loopback clients, never global or renderer-side. */
export class LocalApi {
  private readonly agent = new https.Agent({
    keepAlive: true,
    maxSockets: 2,
    rejectUnauthorized: false,
  });
  constructor(
    readonly port: number,
    private password?: string,
  ) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Invalid local port');
    }
  }
  request(method: string, endpoint: string, body?: unknown): Promise<unknown> {
    if (
      !endpoint.startsWith('/') ||
      endpoint.startsWith('//') ||
      endpoint.includes('://') ||
      /[\r\n]/.test(endpoint)
    ) {
      throw new Error('Invalid API path');
    }
    const bytes = body === undefined ? undefined : JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: '127.0.0.1',
          port: this.port,
          path: endpoint,
          method,
          agent: this.agent,
          headers: {
            Accept: 'application/json',
            ...(this.password
              ? {
                  Authorization: `Basic ${Buffer.from(`riot:${this.password}`).toString('base64')}`,
                }
              : {}),
            ...(bytes
              ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) }
              : {}),
          },
        },
        (res) => {
          let size = 0;
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 8 * 1024 * 1024) {
              req.destroy(new Error('Oversized API response'));
            } else {
              chunks.push(chunk);
            }
          });
          res.on('error', reject);
          res.on('end', () => {
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
              return reject(
                new ApiError(
                  res.statusCode ?? 0,
                  `Local API ${method} ${endpoint} returned ${res.statusCode}`,
                ),
              );
            }
            try {
              const text = Buffer.concat(chunks).toString('utf8');
              resolve(text ? JSON.parse(text) : undefined);
            } catch {
              reject(new Error('Invalid local API JSON'));
            }
          });
        },
      );
      const deadline = setTimeout(() => req.destroy(new Error('Local API timed out')), 2000);
      req.once('close', () => clearTimeout(deadline));
      req.on('error', reject);
      if (bytes) {
        req.write(bytes);
      }
      req.end();
    });
  }
  close() {
    this.agent.destroy();
    this.password = undefined;
  }
}
export async function findLockfile(configured = ''): Promise<string | undefined> {
  const candidates = [
    configured &&
      (path.basename(configured) === 'lockfile' ? configured : path.join(configured, 'lockfile')),
    ...['C:', 'D:', 'E:'].map((drive) => `${drive}\\Riot Games\\League of Legends\\lockfile`),
    path.join(
      process.env['ProgramFiles'] ?? 'C:\\Program Files',
      'Riot Games',
      'League of Legends',
      'lockfile',
    ),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      await access(file);

      return file;
    } catch {
      /* Client not here. */
    }
  }
}
export async function connectClient(file: string) {
  const { port, password } = parseLockfile(await readFile(file, 'utf8'));

  return new LocalApi(port, password);
}
