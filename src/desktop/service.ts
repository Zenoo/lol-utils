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

import { samePatch, patchWarning, publishedVersions } from '../core/versions.js';
export { samePatch } from '../core/versions.js';

type ApiClient = Pick<LocalApi, 'request' | 'close'>;
interface Transports {
  live: ApiClient;
  connect: () => Promise<ApiClient | undefined>;
  versions?: () => Promise<string[]>;
}
export class CompanionService {
  readonly engine: Engine;
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
  private nextImport = 0;
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
    this.imported.clear();
    this.nextImport = 0;
    this.publish({ imports: {} });
  }
  private publish(patch: Partial<ServiceState>) {
    if (this.stopped) {
      return;
    }
    this.latest = { ...this.latest, ...patch };
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
      const championId = selection?.championId;
      const key = `${session.gameId}:${championId}:${selection?.assignedPosition}`;
      if (key !== this.sessionKey) {
        this.sessionKey = key;
        this.imported.clear();
        this.nextImport = 0;
        this.publish({ imports: {} });
      }
      const draftKey = completedDraftKey(session);
      if (draftKey !== this.draftKey) {
        this.draftKey = draftKey;
        this.imported.delete('items');
        this.nextImport = 0;
        const imports = { ...this.latest.imports };
        delete imports.items;
        this.publish({ imports });
      }
      this.publish({
        draftKey,
        connection: 'Champion select',
        selectedId: championId || null,
        role: selection?.assignedPosition || this.settings().role,
      });
      if (championId && this.settings().autoImport && Date.now() >= this.nextImport) {
        await this.importSelected();
      }
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
  async importSelected() {
    if (this.importing) {
      return;
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
    this.importing = true;
    const key = this.sessionKey;
    this.nextImport = Date.now() + 30_000;
    try {
      this.summoner = summonerAccountSchema.parse(
        await api.request('GET', '/lol-summoner/v1/current-summoner'),
      );
      const flow = flowSchema.parse(await api.request('GET', '/lol-gameflow/v1/session'));
      const mode = flow.gameData?.queue?.gameMode,
        map = flow.gameData?.queue?.mapId;
      if (mode !== 'CLASSIC' || map !== 11) {
        throw new Error('Automatic imports currently support Summoner’s Rift Classic only');
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
            ),
        ],
      ];
      for (const [name, action] of actions) {
        if (this.imported.has(name)) {
          continue;
        }
        // Revalidate the selection immediately before each write sequence.
        const fresh = sessionSchema.parse(await api.request('GET', '/lol-champ-select/v1/session'));
        if (
          fresh.myTeam?.find((p) => p.cellId === fresh.localPlayerCellId)?.championId !==
            champ.id ||
          this.sessionKey !== key ||
          (name === 'items' &&
            completedDraftKey(fresh) !== completedDraftKey(required(this.currentSession)))
        ) {
          throw new Error('Champion selection changed; import cancelled');
        }
        try {
          this.publish({ imports: { ...this.latest.imports, [name]: 'Importing' } });
          await action();
          this.imported.add(name);
          this.publish({ imports: { ...this.latest.imports, [name]: 'Imported' } });
        } catch (e) {
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
