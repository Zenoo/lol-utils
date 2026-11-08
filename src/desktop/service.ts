import { required } from '../core/assert.js';
import { readFile } from 'node:fs/promises';
import { Engine, activePlayer, championFor } from '../core/engine.js';
import type {
  Catalog,
  LiveGame,
  ServiceState,
  OverlayState,
  Session,
  SummonerAccount,
  Settings,
  SourceBuild,
  ImportPart,
} from '../core/types.js';
import {
  liveGameSchema,
  sessionSchema,
  summonerAccountSchema,
  flowSchema,
} from '../core/schema.js';
import { Poller } from '../core/poller.js';
import { ApiError, LocalApi, findLockfile, parseLockfile } from '../integrations/local-api.js';
import { importItems, importRunes, importSummoners } from '../integrations/imports.js';
import { questKind } from '../core/role-items.js';
import { completedDraftKey, draftGame } from '../core/draft.js';
import { SourceBuildProvider } from '../integrations/source-builds.js';
import { importableParts, roles } from '../core/builds.js';

import { samePatch, patchWarning, publishedVersions } from '../core/versions.js';
export { samePatch } from '../core/versions.js';

type ApiClient = Pick<LocalApi, 'request' | 'close'>;
interface Transports {
  live: ApiClient;
  connect: () => Promise<ApiClient | undefined>;
  versions?: () => Promise<string[]>;
  sourceFetch?: typeof fetch;
}
export class CompanionService {
  readonly engine: Engine;
  readonly sourceBuilds: SourceBuildProvider;
  private client?: ApiClient;
  private identity = '';
  private readonly live: ApiClient;
  private readonly poller: Poller;
  private disconnected = 0;
  private stopped = false;
  private imported = new Set<string>();
  private sessionKey = '';
  private draftKey = '';
  private clientVersion = '';
  private lastVersionCheck = 0;
  private versions: string[] = [];
  private nextPublishedCheck = 0;
  private checkingPublished = false;
  private publishedCheckFailed = false;
  private hasGame = false;
  private currentSession?: Session;
  private summoner?: SummonerAccount;
  private importing = false;
  private importEpoch = 0;
  private automaticPending = '';
  private automaticDone = '';
  private manualSelection = '';
  private nextAutomaticAttempt = 0;
  private roleQuestPurchased = false;
  private lastGameTime = Infinity;
  private latest: ServiceState = {
    connection: 'Waiting for League client',
    selectedId: null,
    live: null,
    imports: {},
  };
  private lastPayload = '';
  private lastOverlay = '';
  constructor(
    readonly catalog: Catalog,
    private settings: () => Settings,
    private emit: (state: ServiceState) => void,
    private overlay: (state: OverlayState | null) => void,
    private transports?: Transports,
  ) {
    this.engine = new Engine(catalog);
    this.sourceBuilds = new SourceBuildProvider(catalog, transports?.sourceFetch);
    this.live = transports?.live ?? new LocalApi(2999);
    this.poller = new Poller(
      () => this.tick(),
      () => {
        // Any failure, including discovery or schema errors, invalidates the last overlay.
        this.showOverlay(null);
        this.currentSession = undefined;
        this.publish({ connection: 'Local API unavailable', selectedId: null, live: null });
      },
    );
  }
  start() {
    this.poller.start();
  }
  stop() {
    this.stopped = true;
    this.poller.stop();
    this.client?.close();
    this.live.close();
  }
  state() {
    return this.latest;
  }
  planningGame(championId: number) {
    const session = this.currentSession;

    return session?.myTeam.find((p) => p.cellId === session.localPlayerCellId)?.championId ===
      championId
      ? draftGame(this.catalog, session)
      : undefined;
  }
  settingsChanged() {
    this.importEpoch++;
    this.automaticDone = '';
    this.manualSelection = '';
    this.nextAutomaticAttempt = 0;
    this.imported.clear();
    this.publish({ imports: {}, autoImportStatus: '' });
  }
  private publish(patch: Partial<ServiceState>) {
    if (this.stopped) {
      return;
    }
    this.latest = {
      ...this.latest,
      ...patch,
      ...(patch.selectedId === null ? { selectionPreview: false } : {}),
    };
    const encoded = JSON.stringify(this.latest);
    if (encoded !== this.lastPayload) {
      this.lastPayload = encoded;
      this.emit(this.latest);
    }
  }
  private showOverlay(value: OverlayState | null) {
    if (this.stopped) {
      return;
    }
    const encoded = JSON.stringify(value);
    if (encoded !== this.lastOverlay) {
      this.lastOverlay = encoded;
      this.overlay(value);
    }
  }
  private async clientConnection() {
    if (this.transports) {
      const next = await this.transports.connect();
      if (next !== this.client) {
        this.client?.close();
        this.client = next;
        this.clientVersion = '';
        this.lastVersionCheck = 0;
      }

      return;
    }
    const file = await findLockfile(this.settings().leaguePath);
    if (!file) {
      this.client?.close();
      this.client = undefined;
      this.identity = '';
      this.clientVersion = '';

      return;
    }
    const text = await readFile(file, 'utf8');
    if (text !== this.identity) {
      const { port, password } = parseLockfile(text);
      this.client?.close();
      this.client = new LocalApi(port, password);
      this.identity = text;
      this.clientVersion = '';
      this.lastVersionCheck = 0;
      this.imported.clear();
      this.sessionKey = '';
    }
  }
  private async checkVersion() {
    if (!this.client || Date.now() - this.lastVersionCheck < 30_000) {
      return;
    }
    this.lastVersionCheck = Date.now();
    try {
      const version = await this.client.request('GET', '/lol-patch/v1/game-version');
      this.clientVersion = typeof version === 'string' ? version : '';
    } catch {
      this.clientVersion = '';
    }
  }
  private publishVersionWarning() {
    this.publish({
      patchWarning: patchWarning(
        this.catalog.version,
        this.latest.clientVersion ?? '',
        this.versions,
        this.hasGame || Boolean(this.client),
        this.publishedCheckFailed,
      ),
    });
  }
  private async checkPublishedVersion() {
    if (this.checkingPublished || Date.now() < this.nextPublishedCheck) {
      return;
    }
    this.checkingPublished = true;
    this.nextPublishedCheck = Date.now() + 6 * 60 * 60 * 1000;
    try {
      // Tests inject their transport; no external network traffic during local-API tests.
      const load = this.transports ? this.transports.versions : publishedVersions;
      if (!load) {
        return;
      }
      this.versions = await load();
      this.publishedCheckFailed = false;
    } catch {
      this.publishedCheckFailed = true;
      this.nextPublishedCheck = Date.now() + 60_000;
    } finally {
      this.checkingPublished = false;
      this.publishVersionWarning();
    }
  }
  private async tick() {
    void this.checkPublishedVersion();
    let game: LiveGame | undefined;
    try {
      const value = liveGameSchema.parse(
        await this.live.request('GET', '/liveclientdata/allgamedata'),
      );
      if (!value?.activePlayer?.abilities || !Array.isArray(value.allPlayers) || !value.gameData) {
        throw new Error('Unsupported live schema');
      }
      game = value;
    } catch {
      this.showOverlay(null);
    }
    if (this.stopped) {
      return 15_000;
    }
    await this.clientConnection();
    await this.checkVersion();
    const gameVersion = game?.gameData.gameVersion || this.clientVersion;
    const compatible = samePatch(gameVersion, this.catalog.version);
    this.hasGame = Boolean(game);
    this.publish({ clientVersion: gameVersion, patchCompatible: compatible });
    this.publishVersionWarning();
    if (game) {
      this.disconnected = 0;
      this.currentSession = undefined;
      this.imported.clear();
      this.sessionKey = '';
      const me = activePlayer(game),
        champ = me && championFor(this.catalog, me);
      if (game.gameData.gameTime < this.lastGameTime) {
        this.roleQuestPurchased = false;
      }
      this.lastGameTime = game.gameData.gameTime;
      if (
        me?.items.some((entry) => {
          const item = this.engine.items.get(entry.itemID);

          return item && questKind(item);
        })
      ) {
        this.roleQuestPurchased = true;
      }
      const supported = game.gameData.mapNumber === 11 && game.gameData.gameMode === 'CLASSIC';
      if (champ && supported) {
        const ranks = Object.fromEntries(
          ['Q', 'W', 'E', 'R'].map((k) => [
            k,
            required(game).activePlayer.abilities[k]?.abilityLevel ?? 0,
          ]),
        );
        const skill = this.engine.skill(champ, game.activePlayer.level, ranks, game);
        const buys = this.engine
          .nextBuys(champ, game, {
            role: this.latest.role?.toUpperCase() || this.settings().role,
            roleQuestPurchased: this.roleQuestPurchased,
          })
          .map((r) => ({
            id: r.item.id,
            name: r.item.name,
            cost: r.cost,
            affordable: r.affordable,
            reasons: r.reasons,
          }));
        this.showOverlay({ champion: champ.name, skill, buys });
        this.publish({
          connection: 'In game',
          selectedId: champ.id,
          selectionPreview: false,
          live: {
            champion: champ.name,
            level: game.activePlayer.level,
            gold: Math.floor(game.activePlayer.currentGold),
            skill,
            buys,
          },
          patchCompatible: compatible,
        });
      } else {
        this.showOverlay(null);
        this.publish({
          connection: 'Live mode or champion unsupported',
          live: null,
        });
      }

      return 1000;
    }
    this.publish({ live: null });
    this.showOverlay(null);
    if (!this.client) {
      this.publish({ connection: 'Waiting for League client', selectedId: null });
      this.currentSession = undefined;
      this.summoner = undefined;

      return Math.min(15_000, 2000 * 2 ** Math.min(this.disconnected++, 3));
    }
    try {
      const phase = await this.client.request('GET', '/lol-gameflow/v1/gameflow-phase');
      if (phase !== 'ChampSelect') {
        this.currentSession = undefined;
        this.imported.clear();
        this.sessionKey = '';
        this.publish({ connection: `Client: ${phase}`, selectedId: null });

        return phase === 'InProgress' ? 2000 : 3000;
      }
      const session = sessionSchema.parse(
        await this.client.request('GET', '/lol-champ-select/v1/session'),
      );
      this.currentSession = session;
      const selection = session.myTeam?.find((p) => p.cellId === session.localPlayerCellId);
      const championId = selection?.championId || selection?.championPickIntent;
      const key = `${session.gameId}:${championId}:${selection?.assignedPosition}`;
      if (key !== this.sessionKey) {
        this.importEpoch++;
        this.automaticDone = '';
        this.manualSelection = '';
        this.nextAutomaticAttempt = 0;
        this.sessionKey = key;
        this.imported.clear();
        this.publish({ imports: {}, autoImportStatus: '' });
      }
      const draftKey = completedDraftKey(session);
      if (draftKey !== this.draftKey) {
        this.draftKey = draftKey;
      }
      this.publish({
        draftKey,
        connection: 'Champion select',
        selectedId: championId || null,
        selectionPreview: Boolean(championId && !selection?.championId),
        role: selection?.assignedPosition || this.settings().role,
      });
      if (championId && key !== this.sourceFetchKey) {
        this.sourceFetchKey = key;
        // Fetch in the main process without delaying the client poll or overlay.
        void this.sourceBuilds.load(
          championId,
          selection?.assignedPosition || this.settings().role,
        );
      }
      this.scheduleAutomaticImport();
      this.disconnected = 0;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        this.publish({ connection: 'Waiting for champion select', selectedId: null });
      } else {
        this.publish({ connection: 'Client disconnected; retrying', selectedId: null });
      }
      this.currentSession = undefined;
    }

    return 2000;
  }
  private sourceFetchKey = '';
  private localBuild(championId: number, role: string): SourceBuild {
    const champ = this.catalog.champions.find((entry) => entry.id === championId);
    if (!champ || !roles.includes(role as (typeof roles)[number])) {
      throw new Error('Unknown local champion or role');
    }
    const items = this.engine.build(champ, 11, role, this.planningGame(champ.id));

    return {
      id: `local-${champ.id}-${role}`,
      championId: champ.id,
      role,
      provider: 'Local',
      url: '',
      patch: this.catalog.patch,
      label: 'Generated plan',
      stats: 'Official data · current draft',
      items,
      mainItems: items,
      runes: this.engine.runes(champ, role),
      summoners: this.engine.summoners(champ, role, this.settings().flashSlot),
    };
  }
  private scheduleAutomaticImport() {
    const settings = this.settings();
    const selection = this.currentSession?.myTeam.find(
      (entry) => entry.cellId === this.currentSession?.localPlayerCellId,
    );
    if (
      !settings.autoImport ||
      !settings.autoImportSource ||
      !selection?.championId ||
      this.importing ||
      this.manualSelection === this.sessionKey ||
      Date.now() < this.nextAutomaticAttempt
    ) {
      return;
    }
    const source = settings.autoImportSource;
    const key = `${this.sessionKey}:${source}`;
    if (this.automaticDone === key || this.automaticPending === key) {
      return;
    }
    const epoch = this.importEpoch;
    const championId = selection.championId;
    const role = selection.assignedPosition?.toUpperCase() || settings.role;
    this.automaticPending = key;
    this.nextAutomaticAttempt = Date.now() + 30_000;
    this.publish({ autoImportStatus: `Loading first ${source} build…` });
    void (async () => {
      const build =
        source === 'Local'
          ? this.localBuild(championId, role)
          : (await this.sourceBuilds.load(championId, role, false, source)).builds.find(
              (entry) => entry.provider === source,
            );
      // A slow provider must never apply a previous pick or overwrite an explicit user choice.
      if (
        this.stopped ||
        epoch !== this.importEpoch ||
        !this.currentSession ||
        !this.settings().autoImport ||
        this.settings().autoImportSource !== source
      ) {
        return;
      }
      if (!build) {
        throw new Error(`No ${source} build available for this role. Choose a build or retry.`);
      }
      const parts = importableParts(build);
      await this.importSelected(
        build,
        parts.filter((part) => this.latest.imports[part] !== 'Imported'),
      );
      if (epoch !== this.importEpoch || this.stopped) {
        return;
      }
      const done = parts.every((part) => this.latest.imports[part] === 'Imported');
      if (done) {
        this.automaticDone = key;
      }
      this.publish({
        autoImportStatus: done
          ? `First ${source} build imported.`
          : `Some ${source} imports failed. See import status.`,
      });
    })()
      .catch((error: unknown) => {
        if (epoch === this.importEpoch) {
          this.publish({
            autoImportStatus: error instanceof Error ? error.message : 'Automatic import failed',
          });
        }
      })
      .finally(() => {
        if (this.automaticPending === key) {
          this.automaticPending = '';
        }
      });
  }
  async importSourceBuild(id: string, parts: ImportPart[]) {
    const local =
      typeof id === 'string'
        ? id.match(/^local-(\d+)-(TOP|JUNGLE|MIDDLE|BOTTOM|UTILITY)$/)
        : undefined;
    const build = local ? this.localBuild(Number(local[1]), local[2]) : this.sourceBuilds.get(id);
    if (
      !build ||
      !Array.isArray(parts) ||
      !parts.length ||
      parts.some((part) => !['items', 'summoners', 'runes'].includes(part))
    ) {
      throw new Error('Choose an available build and at least one part to import');
    }
    this.importEpoch++;
    this.manualSelection = this.sessionKey;
    this.publish({ autoImportStatus: '' });
    await this.importSelected(build, [...new Set(parts)]);
  }
  async importSelected(
    source?: SourceBuild,
    parts: ImportPart[] = ['items', 'summoners', 'runes'],
  ) {
    if (this.importing) {
      throw new Error('An import is already in progress');
    }
    const api = this.client;
    if (!api || !this.currentSession) {
      throw new Error('Select a champion in the League client first');
    }
    const selection = this.currentSession.myTeam.find(
      (p) => p.cellId === required(this.currentSession).localPlayerCellId,
    );
    const champ = this.catalog.champions.find((c) => c.id === selection?.championId);
    if (!champ) {
      throw new Error('No known champion selected');
    }
    const role = selection?.assignedPosition?.toUpperCase() || this.settings().role;
    if (source && (source.championId !== champ.id || source.role !== role)) {
      throw new Error('Build does not match the current client champion and role');
    }
    if (
      source &&
      ((parts.includes('runes') && !source.runes) ||
        (parts.includes('summoners') && !source.summoners))
    ) {
      throw new Error('The source does not provide the selected import part');
    }
    if (source) {
      // Explicit imports can replace any earlier source or retry a failed part.
      for (const part of parts) {
        this.imported.delete(part);
      }
    }
    this.importing = true;
    const key = this.sessionKey;
    const epoch = this.importEpoch;
    try {
      this.summoner = summonerAccountSchema.parse(
        await api.request('GET', '/lol-summoner/v1/current-summoner'),
      );
      const flow = flowSchema.parse(await api.request('GET', '/lol-gameflow/v1/session'));
      const mode = flow.gameData?.queue?.gameMode,
        map = flow.gameData?.queue?.mapId;
      if (mode !== 'CLASSIC' || map !== 11) {
        throw new Error('Imports currently support Summoner’s Rift Classic only');
      }
      const actions: [string, () => Promise<void>][] = [
        [
          'runes',
          () =>
            importRunes(
              api,
              this.engine,
              champ,
              selection?.assignedPosition?.toUpperCase() || this.settings().role,
              source?.runes,
            ),
        ],
        [
          'summoners',
          () =>
            importSummoners(
              api,
              this.engine,
              champ,
              this.settings(),
              selection?.assignedPosition?.toUpperCase() || this.settings().role,
              mode,
              required(this.summoner).summonerLevel,
              required(this.summoner).summonerId,
              source?.summoners,
            ),
        ],
        [
          'items',
          () =>
            importItems(
              api,
              this.engine,
              champ,
              required(this.summoner).summonerId,
              map,
              selection?.assignedPosition?.toUpperCase() || this.settings().role,
              this.planningGame(champ.id),
              source && source.provider !== 'Local'
                ? {
                    items: source.items,
                    label: `${source.provider} · ${source.label}`,
                    patch: source.patch,
                    itemOrder: source.itemOrder,
                  }
                : undefined,
            ),
        ],
      ];
      for (const [name, action] of actions) {
        if (!parts.includes(name as ImportPart)) {
          continue;
        }
        if (this.imported.has(name)) {
          continue;
        }
        // Revalidate the selection immediately before each write sequence.
        const fresh = sessionSchema.parse(await api.request('GET', '/lol-champ-select/v1/session'));
        if (
          this.stopped ||
          epoch !== this.importEpoch ||
          fresh.myTeam?.find((p) => p.cellId === fresh.localPlayerCellId)?.championId !==
            champ.id ||
          this.sessionKey !== key ||
          (source &&
            (fresh.gameId !== this.currentSession?.gameId ||
              (fresh.myTeam
                .find((p) => p.cellId === fresh.localPlayerCellId)
                ?.assignedPosition?.toUpperCase() || this.settings().role) !== source.role)) ||
          (!source &&
            name === 'items' &&
            completedDraftKey(fresh) !== completedDraftKey(required(this.currentSession)))
        ) {
          throw new Error(
            'Champion selection changed or import preferences changed; import cancelled',
          );
        }
        try {
          this.publish({ imports: { ...this.latest.imports, [name]: 'Importing' } });
          await action();
          if (this.stopped || epoch !== this.importEpoch) {
            return;
          }
          this.imported.add(name);
          this.publish({ imports: { ...this.latest.imports, [name]: 'Imported' } });
        } catch (e) {
          if (this.stopped || epoch !== this.importEpoch) {
            return;
          }
          this.publish({
            imports: {
              ...this.latest.imports,
              [name]: e instanceof Error ? e.message : 'Import failed',
            },
          });
        }
      }
    } finally {
      this.importing = false;
    }
  }
}
