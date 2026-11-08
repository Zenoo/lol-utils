export const samePatch = (a: string, b: string) =>
  /^\d+\.\d+\./.test(a) &&
  a.split('.').slice(0, 2).join('.') === b.split('.').slice(0, 2).join('.');

/** Riot's public labels use the year since 2025; game/CDN versions retain season numbers. */
export function publicPatch(dataVersion: string): string {
  const parts = dataVersion.match(/^(\d+)\.(\d+)/);
  if (!parts) {
    return 'unknown';
  }
  const season = Number(parts[1]);

  return `${season >= 15 ? season + 10 : season}.${parts[2]}`;
}

/** Client build numbers are not Data Dragon revisions. Prefer a published patch identifier. */
export function shortVersion(raw: string, published: readonly string[] = []): string {
  const parts = raw.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!parts) {
    return 'unknown';
  }
  if (/^\d+\.\d+\.\d+$/.test(raw) && Number(parts[3]) < 100) {
    return raw;
  }

  return published.find((version) => samePatch(version, raw)) ?? `${parts[1]}.${parts[2]}`;
}

export async function publishedVersions(fetcher = fetch): Promise<string[]> {
  const response = await fetcher('https://ddragon.leagueoflegends.com/api/versions.json', {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`Version check returned HTTP ${response.status}`);
  }
  const values: unknown = await response.json();
  if (
    !Array.isArray(values) ||
    typeof values[0] !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(values[0])
  ) {
    throw new Error('Invalid published version list');
  }

  // Riot retains legacy identifiers such as lolpatch_7.20 at the end of this index.
  return values.filter(
    (value): value is string => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value),
  );
}

export function patchWarning(
  data: string,
  game: string,
  versions: readonly string[],
  hasClient: boolean,
  checkFailed = false,
): string {
  const known = [...versions, data];
  if (game && !samePatch(game, data)) {
    return `Game patch ${publicPatch(game)} (${shortVersion(game, known)}) / data patch ${publicPatch(data)} (Data Dragon ${shortVersion(data)}). Recommendations may be outdated.`;
  }
  const latest = versions[0];
  if (latest && latest !== data) {
    return `Data patch ${publicPatch(data)} (Data Dragon ${shortVersion(data)}) is outdated. Latest patch: ${publicPatch(latest)} (Data Dragon ${shortVersion(latest)}).`;
  }
  if (!game && hasClient) {
    return `Game patch could not be verified. Using patch ${publicPatch(data)} (Data Dragon ${shortVersion(data)}).`;
  }
  if (checkFailed) {
    return `Latest patch could not be checked. Using patch ${publicPatch(data)} (Data Dragon ${shortVersion(data)}).`;
  }

  return '';
}
