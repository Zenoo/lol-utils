import type { z } from 'zod';
import type * as schemas from './schema.js';
import type { BuildSource } from './builds.js';

export type Raw = Record<string, unknown>;
export type Champion = z.infer<typeof schemas.championSchema>;
export type ChampionKit = Pick<Champion, 'alias' | 'spells' | 'partype'>;
export type HudLayout = z.infer<typeof schemas.hudLayoutSchema>;
export type Spell = z.infer<typeof schemas.spellSchema>;
export type Item = z.infer<typeof schemas.itemSchema>;
export type Perk = z.infer<typeof schemas.perkSchema>;
export type RuneStyle = z.infer<typeof schemas.runeStyleSchema>;
export type SummonerSpell = z.infer<typeof schemas.summonerSchema>;
export type Catalog = z.infer<typeof schemas.catalogSchema>;
export type Manifest = z.infer<typeof schemas.manifestSchema>;
export type Player = z.infer<typeof schemas.playerSchema>;
export type LiveGame = z.infer<typeof schemas.liveGameSchema>;
export type Session = z.infer<typeof schemas.sessionSchema>;
export type SummonerAccount = z.infer<typeof schemas.summonerAccountSchema>;

export interface Settings {
  flashSlot: 'D' | 'F';
  autoImport: boolean;
  autoImportSource?: BuildSource;
  overlayEnabled: boolean;
  shopHotkey: string;
  leaguePath: string;
  role: string;
  skillOffsetX?: number;
  skillOffsetY?: number;
  skillSize?: number;
}
export interface Recommendation {
  item: Item;
  score: number;
  cost: number;
  affordable: boolean;
  reasons: string[];
  targetId?: number;
}
export interface SkillSuggestion {
  key: string | null;
  reason: string;
  label?: string;
}
export interface BuyOption {
  id: number;
  name: string;
  cost: number;
  affordable: boolean;
  reasons: string[];
  icon?: string;
}
export interface OverlayState {
  champion: string;
  skill: SkillSuggestion;
  buys: BuyOption[];
}
export interface ServiceState {
  autoImportStatus?: string;
  draftKey?: string;
  patchWarning?: string;
  connection: string;
  selectedId: number | null;
  selectionPreview?: boolean;
  live: (OverlayState & { level: number; gold: number }) | null;
  imports: Record<string, string>;
  clientVersion?: string;
  patchCompatible?: boolean;
  role?: string;
}
export interface Plan {
  questRewards: Item[];
  starters: Item[];
  build: (Item & { reasons: string[] })[];
  ranked: {
    item: Pick<Item, 'id' | 'name'>;
    reasons: string[];
    score: number;
    cost: number;
    affordable: boolean;
  }[];
  runes: {
    selectedPerkIds: number[];
    primaryStyleId: number;
    subStyleId: number;
    name: string;
    current: boolean;
  };
  summoners: { spell1Id: number; spell2Id: number };
}
export interface AppData {
  settings: Settings;
  manifest: Manifest;
  state: ServiceState;
  hotkeyAvailable: boolean;
  champions: Pick<Champion, 'id' | 'name' | 'title' | 'tags' | 'image'>[];
  items: (Pick<Item, 'id' | 'name' | 'gold' | 'tags' | 'image' | 'maps'> & {
    tier?: number;
    available: boolean;
    variant: boolean;
    champion: string;
  })[];
  runes: { id: number; name: string; slots: { runes: Perk[] }[] }[];
  shards: Perk[];
  shardSlots: number[][];
  summoners: SummonerSpell[];
}
export interface CompanionBridge {
  sourceBuilds(id: number, role: string, refresh?: boolean): Promise<SourceBuilds>;
  importSourceBuild(id: string, parts: ImportPart[]): Promise<ServiceState>;
  init(): Promise<AppData>;
  detail(kind: string, id: number): Promise<Champion | Item | Perk | SummonerSpell | undefined>;
  plan(id: number, role?: string): Promise<Plan>;
  saveSettings(value: unknown): Promise<Settings>;
  importSelected(): Promise<ServiceState>;
  pickLeague(): Promise<string | undefined>;
  onState(callback: (state: ServiceState) => void): () => void;
}
export type ImportPart = 'items' | 'summoners' | 'runes';
export interface SourceBuild {
  mainItems?: number[];
  population?: string;
  itemOrder?: 'purchase' | 'inventory';
  id: string;
  championId: number;
  role: string;
  provider: string;
  url: string;
  patch: string;
  label: string;
  stats: string;
  items: number[];
  runes?: Plan['runes'];
  summoners?: Plan['summoners'];
}
export interface SourceBuilds {
  builds: SourceBuild[];
  errors: string[];
  fetchedAt: string;
}
export interface OverlayBridge {
  onUpdate(callback: (value: OverlayState) => void): () => void;
}
