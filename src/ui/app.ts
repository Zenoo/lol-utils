import { required } from '../core/assert.js';
import { publicPatch } from '../core/versions.js';
import { buildSources, groupBuilds } from '../core/builds.js';
import { buildRow, rolePicker, sourceIcon } from './build-list.js';
import { autocomplete, byName } from './autocomplete.js';
import { championStatLabel } from './champion-stats.js';
import { itemCategories } from './item-categories.js';
import type {
  AppData,
  Champion,
  Item,
  Perk,
  Raw,
  Settings,
  CompanionBridge,
  OverlayBridge,
  SummonerSpell,
  ImportPart,
  SourceBuild,
  Plan,
} from '../core/types.js';

declare global {
  interface Window {
    companion: CompanionBridge;
    overlay: OverlayBridge;
  }
}
const api = window.companion;
const content = required(document.querySelector<HTMLElement>('#content'));
const message = required(document.querySelector<HTMLElement>('#message'));
const modal = required(document.querySelector<HTMLDialogElement>('#detail'));
let initial: AppData;
let currentView = 'companion';
let selectedId: number | undefined;
let planGeneration = 0;
let sourceGeneration = 0;
let browsingRole: string | undefined;
let buildSelection: { context: string; id: string; manual: boolean } | undefined;
const chosenParts = new Set<ImportPart>(['items', 'runes', 'summoners']);
let itemMap = '11';
let itemCategory = '';
let itemFilters: (() => void) | undefined;
const escape = (value: unknown = '') =>
  String(value).replace(/[&<>"']/g, (c) =>
    required({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
const text = (value = '') =>
  escape(value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/\n/g, '<br>');
const pretty = (value: unknown) => escape(JSON.stringify(value, null, 2));
function notify(value: string) {
  message.textContent = value;
  message.hidden = false;
}
function icon(item: Pick<Item, 'image'>, group: string) {
  return `https://ddragon.leagueoflegends.com/cdn/${initial.manifest.version}/img/${group}/${encodeURIComponent(item.image.full)}`;
}
function imageFile(value: unknown): string {
  if (value && typeof value === 'object' && 'full' in value && typeof value.full === 'string') {
    return value.full;
  }

  return '';
}
function runeIcon(perk: Perk) {
  const asset = typeof perk.iconPath === 'string' ? perk.iconPath : '';

  return asset.startsWith('/lol-game-data/assets/')
    ? `https://raw.communitydragon.org/${initial.manifest.patch}/plugins/rcp-be-lol-game-data/global/default/${asset.slice('/lol-game-data/assets/'.length).toLowerCase()}`
    : '';
}
function iconButton(
  kind: string,
  id: number,
  name: string,
  url: string,
  badge = '',
  slot?: number,
) {
  return /* HTML */ `<button
    class="icon-button"
    data-kind="${kind}"
    data-id="${id}"
    ${slot !== undefined ? `data-slot="${slot}"` : ''}
    aria-label="${escape(
      name
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )}"
  >
    <span class="icon-fallback" aria-hidden="true">${escape(name.slice(0, 2))}</span>
    ${url ? `<img src="${escape(url)}" alt="" loading="lazy" />` : ''}
    ${badge ? `<span class="keycap" aria-hidden="true">${escape(badge)}</span>` : ''}
  </button>`;
}
function itemButton(id: number, badge = '') {
  const item = initial.items.find((item) => item.id === id);

  return item ? iconButton('items', id, item.name, icon(item, 'item'), badge) : '';
}
function itemAlternatives(ids: readonly number[]) {
  return byName(
    ids.flatMap((id) => {
      const item = initial.items.find((item) => item.id === id);

      return item ? [item] : [];
    }),
  );
}
function perkFor(id: number) {
  return (
    initial.runes.flatMap((s) => s.slots.flatMap((slot) => slot.runes)).find((p) => p.id === id) ??
    initial.shards.find((p) => p.id === id)
  );
}
function perkButton(id: number) {
  const perk = perkFor(id);

  return perk ? iconButton('runes', id, perk.name, runeIcon(perk)) : '';
}
function summonerButton(id: number, badge = '') {
  const spell = initial.summoners.find((s) => s.id === id);

  return spell ? iconButton('summoners', id, spell.name, icon(spell, 'spell'), badge) : '';
}
function skillButton(champ: Champion, slot: number) {
  const skill = slot < 0 ? champ.passive : champ.spells[slot];
  const file = imageFile(skill.image);
  const url = file ? icon({ image: { full: file } }, slot < 0 ? 'passive' : 'spell') : '';

  return iconButton('champions', champ.id, skill.name, url, slot < 0 ? 'P' : 'QWER'[slot], slot);
}

const details = new Map<string, ReturnType<CompanionBridge['detail']>>();
function cachedDetail(kind: string, id: number) {
  const key = `${kind}:${id}`;
  let result = details.get(key);
  if (!result) {
    result = api.detail(kind, id).catch((error: unknown) => {
      details.delete(key);
      throw error;
    });
    details.set(key, result);
    if (details.size > 64) {
      details.delete(required(details.keys().next().value));
    }
  }

  return result;
}
const hover = document.createElement('div');
hover.id = 'game-tooltip';
hover.role = 'tooltip';
hover.hidden = true;
let hoverTarget: HTMLElement | null = null;
let hoverGeneration = 0;
function hideTooltip() {
  hoverGeneration++;
  hover.hidden = true;
  hoverTarget?.removeAttribute('aria-describedby');
  hoverTarget = null;
}
function displayTooltip(target: HTMLElement, name: string, description: string, meta = '') {
  const img = target.querySelector<HTMLImageElement>('img');
  hover.innerHTML = `<div class="tooltip-heading">${img ? `<img src="${escape(img.src)}" alt="" />` : ''}<strong>${text(name)}</strong></div><p class="tooltip-meta">${escape(meta)}</p><div class="tooltip-description">${text(description)}</div>`;
  (modal.open ? modal : document.body).append(hover);
  hover.hidden = false;
  target.setAttribute('aria-describedby', hover.id);
  const rect = target.getBoundingClientRect();
  const size = hover.getBoundingClientRect();
  const x = Math.max(12, Math.min(innerWidth - size.width - 12, rect.right + 12));
  const y = Math.max(12, Math.min(innerHeight - size.height - 12, rect.top));
  hover.style.left = `${x}px`;
  hover.style.top = `${y}px`;
}
async function showTooltip(target: HTMLElement) {
  if (hoverTarget === target) {
    return;
  }
  hideTooltip();
  hoverTarget = target;
  const generation = hoverGeneration;
  if (target.dataset.tooltipTitle) {
    displayTooltip(target, target.dataset.tooltipTitle, target.dataset.tooltipDescription ?? '');

    return;
  }
  try {
    const value = await cachedDetail(required(target.dataset.kind), Number(target.dataset.id));
    if (!value || generation !== hoverGeneration || !target.isConnected) {
      return;
    }
    let name = value.name,
      description = '',
      meta = '';
    const kind = target.dataset.kind;
    if (kind === 'items') {
      const item = value as Item;
      description = item.description;
      meta = `${item.gold.total} gold · Sells for ${item.gold.sell}`;
    } else if (kind === 'runes') {
      description = (value as Perk).longDesc;
    } else if (kind === 'summoners') {
      const spell = value as SummonerSpell;
      description = spell.description;
      meta = `${spell.cooldown.join(' / ')}s cooldown`;
    } else {
      const champ = value as Champion;
      if (target.dataset.slot !== undefined) {
        const slot = Number(target.dataset.slot);
        const skill = slot < 0 ? champ.passive : champ.spells[slot];
        name = skill.name;
        description = slot < 0 ? skill.description : champ.spells[slot].tooltip;
        if (slot >= 0) {
          meta = `${champ.spells[slot].cooldown.join(' / ')}s cooldown · ${champ.spells[slot].cost.join(' / ')} ${champ.partype}`;
        }
      } else {
        description = champ.passive.description;
        meta = champ.title;
      }
    }
    description = description.replace(/\{\{\s*(.*?)\s*\}\}/g, '[$1]');
    displayTooltip(target, name, description, meta);
  } catch {
    if (generation === hoverGeneration) {
      hideTooltip();
    }
  }
}
function stats(values: Raw) {
  return /* HTML */ `<div class="stats">
    ${Object.entries(values)
      .map(
        ([key, value]) =>
          /* HTML */ `<div class="stat">
            <span>${escape(key)}</span
            ><strong>${escape(Array.isArray(value) ? value.join(' / ') : value)}</strong>
          </div>`,
      )
      .join('')}
  </div>`;
}
async function detail(kind: string, id: number) {
  try {
    const value = await cachedDetail(kind, id);
    if (!value) {
      return;
    }
    const target = required(document.querySelector('#detail-content'));
    if (kind === 'champions') {
      const c = value as Champion;
      target.innerHTML = /* HTML */ `<h2 class="entry-heading">
          <img src="${icon(c, 'champion')}" alt="" />${escape(c.name)}
        </h2>
        <p>${escape(c.title)}</p>
        <p>${text(c.lore)}</p>
        <div>
          ${c.tags.map((t) => /* HTML */ `<span class="badge">${escape(t)}</span>`).join('')}
        </div>
        <h3>Champion statistics</h3>
        <label>Level <input id="champ-level" type="number" min="1" max="18" value="1" /></label>
        <div id="champ-stats"></div>
        <p class="muted">
          Ability values separated by / follow skill rank. AP and AD scalings remain formulas;
          champion-level values are labelled.
        </p>
        <h3 class="entry-heading">${skillButton(c, -1)}${escape(c.passive.name)}</h3>
        <p>${text(c.passive.description)}</p>
        ${c.spells
          .map(
            (s, i) =>
              /* HTML */ `<div class="ability">
                <h3 class="entry-heading">${skillButton(c, i)}${escape(s.name)}</h3>
                <p>${text(s.description)}</p>
                <p>${text(s.tooltip)}</p>
                ${stats({ 'Max rank': s.maxrank, Cooldown: s.cooldown, Cost: s.cost, Range: s.range })}
                <details>
                  <summary>Published scaling and effect data</summary>
                  <pre>
${pretty({ variables: s.vars, effects: s.effect, client: c.source.spells[i] })}</pre>
                </details>
              </div>`,
          )
          .join('')}`;
      const levelInput = required(document.querySelector<HTMLInputElement>('#champ-level'));
      const update = () => {
        const level = Math.max(1, Math.min(18, Number(levelInput.value) || 1)),
          n = level - 1;
        const values: Raw = {};
        for (const [key, base] of Object.entries(c.stats)) {
          if (key.endsWith('perlevel')) {
            continue;
          }
          const growthKey = key === 'attackspeed' ? 'attackspeedperlevel' : `${key}perlevel`;
          const growth = c.stats[growthKey] ?? 0;
          const result =
            key === 'attackspeed'
              ? base * (1 + (growth * (0.7025 * n + 0.0175 * n * n)) / 100)
              : base + growth * (0.7025 * n + 0.0175 * n * n);
          values[championStatLabel(key, c.partype)] =
            key === 'crit' ? `${Number((result * 100).toFixed(2))}%` : Number(result.toFixed(3));
        }
        required(document.querySelector('#champ-stats')).innerHTML = stats(values);
      };
      levelInput.addEventListener('input', update);
      update();
    } else if (kind === 'items') {
      const i = value as Item;
      target.innerHTML = /* HTML */ `<h2 class="entry-heading">
          <img src="${icon(i, 'item')}" alt="" />${text(i.name)}
        </h2>
        <p>${text(i.description)}</p>
        ${stats({ 'Total price': i.gold.total, ...(i.from?.length ? { 'Finishing cost': i.gold.base } : {}), 'Sell value': i.gold.sell })}
        ${i.from?.length ? '<p class="muted">Finishing cost is the extra gold paid once you own all recipe components. It is included in the total price.</p>' : ''}
        <div class="category-tags" aria-label="Item categories">
          ${itemCategories(i.tags)
            .map(
              (category) =>
                `<button class="badge category-tag" data-category="${escape(category)}">${escape(category)}</button>`,
            )
            .join('')}
        </div>
        <h3>Recipe</h3>
        <div class="row">
          ${
            itemAlternatives((i.from ?? []).map(Number))
              .map((item) => itemButton(item.id))
              .join('') || 'No components'
          }
        </div>
        <h3>Builds into</h3>
        <div class="row" id="item-upgrades">
          ${
            itemAlternatives((i.into ?? []).map(Number))
              .filter((item) => !itemMap || item.maps[itemMap])
              .map((item) => itemButton(item.id))
              .join('') || 'No upgrades in the selected game mode'
          }
        </div>
        <details>
          <summary>All published item fields</summary>
          <pre>${pretty(i)}</pre>
        </details>`;
    } else if (kind === 'summoners') {
      const spell = value as SummonerSpell;
      target.innerHTML = `<h2 class="entry-heading"><img src="${icon(spell, 'spell')}" alt="" />${escape(spell.name)}</h2><p>${text(spell.description)}</p>${stats({ Cooldown: spell.cooldown, 'Unlock level': spell.summonerLevel })}`;
    } else {
      target.innerHTML = /* HTML */ `<h2>${escape(value.name)}</h2>
        <p>${text((value as Perk).longDesc)}</p>
        <details>
          <summary>Official tooltip and metadata</summary>
          <pre>${pretty(value)}</pre>
        </details>`;
    }
    if (!modal.open) {
      modal.showModal();
    }
  } catch {
    notify('Unable to open this entry.');
  }
}
function runeTree(selected: number[] = [], styles = initial.runes) {
  const chosen = new Set(selected);

  return `<div class="rune-trees ${selected.length ? 'rune-page' : ''}">${styles
    .map(
      (style) =>
        `<section class="panel rune-tree"><h3>${escape(style.name)}</h3>${style.slots
          .map(
            (slot, index) =>
              `<div class="rune-slot ${index === 0 ? 'keystones' : ''}">${slot.runes
                .map(
                  (perk) =>
                    `<div class="rune-choice ${chosen.has(perk.id) ? 'selected' : selected.length ? 'unselected' : ''}">${perkButton(perk.id)}<small>${escape(perk.name)}</small></div>`,
                )
                .join('')}</div>`,
          )
          .join('')}</section>`,
    )
    .join('')}</div>`;
}
function renderRunes() {
  content.innerHTML = `${runeTree()}<section class="panel"><h3>Stat shards</h3>${initial.shardSlots.map((slot) => `<div class="rune-slot">${slot.map((id) => `<div class="rune-choice">${perkButton(id)}<small>${escape(perkFor(id)?.name)}</small></div>`).join('')}</div>`).join('')}</section>`;
}
function renderList(kind: 'champions' | 'items' | 'runes' | 'summoners') {
  if (kind === 'runes') {
    renderRunes();

    return;
  }
  content.innerHTML = `<input type="search" id="search" placeholder="Search ${escape(kind)}..." aria-label="Search ${escape(kind)}" />
    ${
      kind === 'items'
        ? `<div class="item-filters row">
      <label>Game mode<select id="item-map"><option value="11">Summoner&#39;s Rift</option><option value="12">ARAM</option><option value="30">Arena</option><option value="">All modes</option></select></label>
      <label>Item tier<select id="item-tier"><option value="">All tiers</option><option value="1">Starter</option><option value="0">Basic</option><option value="4">Epic</option><option value="5">Legendary</option><option value="boots">Boots</option></select></label>
      <label>Stat / purpose<select id="item-tag"><option value="">All stats</option>${[
        ...itemCategories(initial.items.flatMap((item) => item.tags)),
      ]
        .sort()
        .map((tag) => `<option value="${escape(tag)}">${escape(tag)}</option>`)
        .join('')}</select></label>
      <label><input type="checkbox" id="item-variants" />Show hidden variants</label>
      <label><input type="checkbox" id="item-unavailable" />Show unavailable items</label>
      <label>Max gold<input type="number" id="item-gold" min="0" placeholder="Any" /></label>
    </div>`
        : ''
    }
    <p id="result-count" class="muted" aria-live="polite"></p><div class="grid" id="results"></div>`;
  const update = () => {
    const q = required(document.querySelector<HTMLInputElement>('#search')).value.toLowerCase();
    const field = (id: string) => required(document.querySelector<HTMLInputElement>(`#item-${id}`));
    if (kind === 'items') {
      itemMap = field('map').value;
      itemCategory = field('tag').value;
    }
    const canonical = new Set<string>();
    const items =
      kind === 'items'
        ? [...initial.items]
            .sort((a, b) => a.id - b.id)
            .filter(
              (item) =>
                (!field('map').value || item.maps[field('map').value]) &&
                (field('variants').checked || !item.variant) &&
                (field('unavailable').checked || item.available),
            )
            .filter((item) => {
              if (field('variants').checked) {
                return true;
              }
              const key = item.name.replace(/<[^>]+>/g, '').toLowerCase();
              if (canonical.has(key)) {
                return false;
              }
              canonical.add(key);

              return true;
            })
            .filter(
              (item) =>
                (!field('tier').value ||
                  (field('tier').value === 'boots'
                    ? item.tags.includes('Boots')
                    : item.tier === Number(field('tier').value))) &&
                (!field('tag').value || itemCategories(item.tags).includes(field('tag').value)) &&
                (!field('gold').value || item.gold.total <= Number(field('gold').value)),
            )
        : [];
    const list = byName<{
      id: number;
      name: string;
      subtitle: string;
      url: string;
      tags: string[];
    }>(
      kind === 'champions'
        ? initial.champions.map((champ) => ({
            ...champ,
            subtitle: champ.title,
            url: icon(champ, 'champion'),
          }))
        : kind === 'items'
          ? items.map((item) => ({
              ...item,
              subtitle: `${item.gold.total} gold${item.champion ? ` / ${item.champion} only` : ''}`,
              url: icon(item, 'item'),
            }))
          : initial.summoners.map((spell) => ({
              ...spell,
              tags: [],
              subtitle: spell.description,
              url: icon(spell, 'spell'),
            })),
    ).filter((entry) =>
      `${entry.name} ${itemCategories(entry.tags).join(' ')}`.toLowerCase().includes(q),
    );
    required(document.querySelector('#result-count')).textContent = `${list.length} results`;
    required(document.querySelector('#results')).innerHTML = list
      .map(
        (entry) =>
          `<button class="card" data-kind="${kind}" data-id="${entry.id}"><img loading="lazy" src="${entry.url}" alt="" /><span><strong>${text(entry.name)}</strong><small>${text(entry.subtitle)}</small></span></button>`,
      )
      .join('');
  };
  if (kind === 'items') {
    required(document.querySelector<HTMLSelectElement>('#item-map')).value = itemMap;
    required(document.querySelector<HTMLSelectElement>('#item-tag')).value = itemCategory;
    itemFilters = update;
  }
  content
    .querySelectorAll('input, select')
    .forEach((input) => input.addEventListener('input', update));
  update();
}
function companion() {
  content.innerHTML = /* HTML */ `<section class="panel build-hero">
      <div>
        <p class="eyebrow">BUILD LIBRARY</p>
        <h2>Choose your build</h2>
        <p class="muted">Click a row, then import the parts you want.</p>
      </div>
      <div>
        <div id="champion-picker"></div>
        <p class="muted">
          Flash on ${initial.settings.flashSlot} · Patch ${publicPatch(initial.manifest.version)}
        </p>
      </div>
    </section>
    <section id="source-builds" class="panel"></section>
    <div id="imports" class="panel"></div>
    <details class="panel">
      <summary>How the local plan was generated</summary>
      <div id="plan"></div>
    </details>
    <section class="panel">
      <h3>During your game</h3>
      <p>
        Skill guidance appears while a supported skill point is unspent. Press
        <strong>${escape(initial.settings.shopHotkey)}</strong> to show or hide purchase options
        when you open or close the shop.
      </p>
      <p class="muted">
        ${escape(initial.settings.shopHotkey)} toggles the purchase panel, and Escape hides it.
        Closing the shop with the mouse can leave the panel out of sync; use the shop key again to
        toggle it. The overlay requires a focused, borderless or windowed League game; it hides on
        focus loss.
      </p>
      <p class="muted">
        Recommendations are estimates from official stats, descriptions, and observed inventories.
        Missing mechanics can change which choice is best.
      </p>
    </section>`;
  autocomplete(
    required(document.querySelector('#champion-picker')),
    initial.champions.map((champion) => ({
      value: String(champion.id),
      name: champion.name,
      image: icon(champion, 'champion'),
      keywords: champion.tags.join(' '),
    })),
    {
      id: 'champion',
      label: 'Champion',
      value: selectedId ? String(selectedId) : '',
      placeholder: 'Search champions…',
      onChange: (value) => {
        selectedId = Number(value) || undefined;
        browsingRole = undefined;
        void showSourceBuilds();
      },
    },
  );
  updateStatus();
  browsingRole = undefined;
  void showSourceBuilds();
}
async function showSourceBuilds(chosenRole?: string, refresh = false) {
  const generation = ++sourceGeneration;
  const target = document.querySelector('#source-builds');
  const championId = selectedId;
  if (!target) {
    return;
  }
  if (!championId) {
    target.innerHTML = '<h3>Builds</h3><p>Pick a champion to compare builds.</p>';
    void showPlan();

    return;
  }
  browsingRole =
    chosenRole ??
    browsingRole ??
    (championId === initial.state.selectedId || initial.state.connection === 'Champion select'
      ? initial.state.role?.toUpperCase()
      : undefined) ??
    initial.settings.role;
  const role = browsingRole;
  const context = `${championId}-${role}`;
  target.innerHTML = `<div class="build-toolbar"><h3>Builds</h3>${rolePicker(role)}<button id="retry-source" type="button">Refresh</button></div>
    <div id="source-preview"></div>
    <div class="build-list-head" aria-hidden="true"><span>Source / variant</span><span>Main items</span><span>Main runes</span><span>Spells</span></div>
    <div id="build-choices" class="build-choices" aria-label="Build choices"></div>
    <p id="build-loading" class="muted">Fetching source builds…</p><div id="build-errors"></div>`;
  target
    .querySelectorAll<HTMLButtonElement>('[data-role]')
    .forEach((button) =>
      button.addEventListener('click', () => void showSourceBuilds(button.dataset.role)),
    );
  target
    .querySelector('#retry-source')
    ?.addEventListener('click', () => void showSourceBuilds(role, true));
  const planRequest = api.plan(championId, role);
  void showPlan(role, planRequest);
  const externalRequest = api.sourceBuilds(championId, role, refresh).then(
    (result) => result,
    (error: unknown) => ({
      builds: [],
      errors: [error instanceof Error ? error.message : 'Sources unavailable'],
    }),
  );
  const current = () => generation === sourceGeneration && target.isConnected;
  const renderChoices = (builds: SourceBuild[]) => {
    if (!current()) {
      return;
    }
    const previous = buildSelection?.context === context ? buildSelection : undefined;
    const selected =
      (previous?.manual ? builds.find((entry) => entry.id === previous.id) : undefined) ??
      (initial.settings.autoImport
        ? builds.find((entry) => entry.provider === initial.settings.autoImportSource)
        : undefined) ??
      builds[0];
    if (!selected) {
      return;
    }
    buildSelection = { context, id: selected.id, manual: previous?.manual ?? false };
    const groups = groupBuilds(builds);
    const rows = groups.map((members) => ({
      members,
      build:
        members.find((entry) => entry.id === selected.id) ??
        members.find(
          (entry) =>
            initial.settings.autoImport && entry.provider === initial.settings.autoImportSource,
        ) ??
        required(members[0]),
    }));
    const choices = required(target.querySelector('#build-choices'));
    hideTooltip();
    choices.innerHTML = rows
      .map(({ build, members }) =>
        buildRow(
          build,
          initial,
          members.some((entry) => entry.id === selected.id),
          members,
        ),
      )
      .join('');
    const select = (build: SourceBuild) => {
      choices.querySelectorAll<HTMLElement>('[data-build-id]').forEach((row) => {
        const active = row.dataset.buildId === build.id;
        row.dataset.selected = String(active);
        row.querySelector('.build-select')?.setAttribute('aria-pressed', String(active));
      });
      const members = rows.find((entry) => entry.build.id === build.id)?.members ?? [build];
      renderSourcePreview(required(target.querySelector('#source-preview')), build, members);
    };
    choices.querySelectorAll<HTMLElement>('[data-build-id]').forEach((button) =>
      button.addEventListener('click', (event) => {
        if ((event.target as Element).closest('[data-kind], [data-tooltip-title]')) {
          return;
        }
        const build = rows.find((entry) => entry.build.id === button.dataset.buildId)?.build;
        if (build) {
          buildSelection = { context, id: build.id, manual: true };
          select(build);
        }
      }),
    );
    select(selected);
  };
  let local: SourceBuild | undefined;
  try {
    const plan = await planRequest;
    local = {
      id: `local-${championId}-${role}`,
      championId,
      role,
      provider: 'Local',
      url: '',
      patch: initial.manifest.patch,
      label: 'Generated plan',
      stats: 'Official data · current draft',
      items: plan.build.map((item) => item.id),
      mainItems: plan.build.map((item) => item.id),
      runes: plan.runes,
      summoners: plan.summoners,
    };
    renderChoices([local]);
  } catch {
    /* External sources remain available if the local model cannot make a plan. */
  }
  const result = await externalRequest;
  if (!current()) {
    return;
  }
  renderChoices([...(local ? [local] : []), ...result.builds]);
  required(target.querySelector('#build-loading')).textContent =
    'Six item slots per build. Empty slots mean the source only supplied a core.';
  required(target.querySelector('#build-errors')).innerHTML = result.errors.length
    ? `<details class="source-errors"><summary>${result.errors.length} source issue${result.errors.length === 1 ? '' : 's'}</summary>${result.errors.map((error) => `<p class="import-error">${escape(error)}</p>`).join('')}</details>`
    : '';
}
function renderSourcePreview(
  target: Element,
  build: SourceBuild,
  members: readonly SourceBuild[] = [build],
) {
  const compatible =
    initial.state.selectedId === build.championId &&
    !initial.state.selectionPreview &&
    (initial.state.role?.toUpperCase() || initial.settings.role) === build.role;
  const busy = Object.values(initial.state.imports).includes('Importing');
  const others = [
    ...new Set(
      members.filter((entry) => entry.provider !== build.provider).map((entry) => entry.provider),
    ),
  ];
  target.innerHTML = `<div class="selected-build-meta"><strong>${escape(build.provider)} · ${escape(build.label)}</strong><span>Patch ${escape(publicPatch(build.patch))}</span><span>${escape(build.stats)}</span></div>
    <div class="build-import-bar"><fieldset id="source-parts"><legend>Import parts</legend>
      ${(['items', 'runes', 'summoners'] as const)
        .map((part) => {
          const available = part === 'items' || Boolean(build[part]);

          return `<label><input type="checkbox" value="${part}" ${chosenParts.has(part) && available ? 'checked' : ''} ${available ? '' : 'disabled'} />${{ items: 'Items', runes: 'Runes', summoners: 'Summoners' }[part]}${available ? '' : ' (unavailable)'}</label>`;
        })
        .join('')}
    </fieldset><button id="import-source" data-champion="${build.championId}" data-role="${build.role}" class="primary" ${compatible && !busy ? '' : 'disabled'}>Import selected build</button></div>
    <p class="build-note">${build.provider === 'Local' ? 'Generated from official data and the current draft.' : `${escape(build.population ?? 'Source default population')}. Rune and spell defaults may be shared across variants.`}
      ${others.length ? `Same build also listed by ${escape(others.join(', '))}.` : ''}
      ${build.itemOrder === 'inventory' ? 'Observed inventory core; purchase order is not known.' : ''}
      ${compatible ? '' : 'Pick this champion and role in League to import.'}
      ${build.patch !== initial.manifest.patch ? 'Source patch differs from the local catalog.' : ''}</p>`;
  target.querySelectorAll<HTMLInputElement>('#source-parts input').forEach((input) =>
    input.addEventListener('change', () => {
      const part = input.value as ImportPart;
      if (input.checked) {
        chosenParts.add(part);
      } else {
        chosenParts.delete(part);
      }
    }),
  );
  target.querySelector('#import-source')?.addEventListener('click', async (event) => {
    const button = event.target as HTMLButtonElement;
    const parts = [...target.querySelectorAll<HTMLInputElement>('#source-parts input:checked')].map(
      (input) => input.value as ImportPart,
    );
    if (!parts.length) {
      notify('Choose at least one part to import.');

      return;
    }
    button.disabled = true;
    try {
      initial.state = await api.importSourceBuild(build.id, parts);
      updateStatus();
      const failed = parts.filter((part) => initial.state.imports[part] !== 'Imported');
      notify(
        failed.length
          ? `Import needs attention: ${failed.join(', ')}. See import status.`
          : 'Chosen build parts imported.',
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Import failed');
    } finally {
      if (button.isConnected) {
        button.disabled = false;
      }
    }
  });
}
async function showPlan(role?: string, planRequest?: Promise<Plan>) {
  const generation = ++planGeneration;
  const target = document.querySelector('#plan');
  if (!target) {
    return;
  }
  if (!selectedId) {
    target.innerHTML = '<div class="empty">Choose a champion to inspect a generated plan.</div>';

    return;
  }
  target.innerHTML = '<div class="empty">Generating champion plan...</div>';
  try {
    const [plan, championEntry] = await Promise.all([
      planRequest ?? api.plan(selectedId, role),
      cachedDetail('champions', selectedId),
    ]);
    const champion = championEntry as Champion | undefined;
    if (generation !== planGeneration || currentView !== 'companion') {
      return;
    }
    target.innerHTML = /* HTML */ `<div class="columns">
        <section class="panel">
          <h3>Starter alternatives</h3>
          <div class="row">
            ${byName(plan.starters)
              .map(
                (item) =>
                  `<div class="item-option">${itemButton(item.id)}<small>${item.gold.total}g</small></div>`,
              )
              .join('')}
          </div>
          <h3>Completed item progression</h3>
          ${
            plan.questRewards.length
              ? /* HTML */ `<details>
                  <summary>Support quest reward alternatives</summary>
                  <p class="muted">
                    These become available after quest completion. Automatic quest upgrades provide
                    income, regeneration, and vision before you choose a reward.
                  </p>
                  <div class="row">
                    ${byName(plan.questRewards)
                      .map((item) => itemButton(item.id))
                      .join('')}
                  </div>
                </details>`
              : ''
          }
          <div class="build-progression">
            ${plan.build
              .map(
                (item, index) =>
                  /* HTML */ `<div class="build-item" data-step="${index + 1}">
                    ${itemButton(item.id, String(index + 1))}
                    <div>
                      <strong>${text(item.name)}</strong><small>${item.gold.total}g</small>
                      <p class="build-reason">${item.reasons.map(escape).join(' / ')}</p>
                    </div>
                  </div>`,
              )
              .join('')}
          </div>
        </section>
        <section class="panel">
          <h3>Rune page</h3>
          ${runeTree(
            plan.runes.selectedPerkIds,
            [plan.runes.primaryStyleId, plan.runes.subStyleId].flatMap((id) =>
              initial.runes.filter((style) => style.id === id),
            ),
          )}
          <div class="rune-shards">
            ${plan.runes.selectedPerkIds.slice(6).map(perkButton).join('')}
          </div>
          <h3>Summoner spells</h3>
          <div class="icon-row">
            ${summonerButton(plan.summoners.spell1Id, 'D')}${summonerButton(plan.summoners.spell2Id, 'F')}
          </div>
          <h3>Champion skills</h3>
          <div class="icon-row">
            ${champion ? [-1, 0, 1, 2, 3].map((slot) => skillButton(champion, slot)).join('') : ''}
          </div>
          <p class="muted">Hover or focus an icon for details. Click to open its full entry.</p>
          <p class="muted">
            Preview uses the role selected above. Role icons follow new assignments from the League
            client. Local builds consider both teams once all champions are selected.
          </p>
        </section>
      </div>
      <section class="panel">
        <h3>Why these options score well</h3>
        ${byName(plan.ranked.slice(0, 3).map((result) => ({ ...result, name: result.item.name })))
          .map(
            (r) =>
              /* HTML */ `<div class="recommendation-row">
                ${itemButton(r.item.id)}
                <p>${r.reasons.map(escape).join(' · ')}</p>
              </div>`,
          )
          .join('')}
        <p class="muted">
          Scoring uses a general model, not a simulated guarantee. Item passives, transformation
          gates, and some scalings are incomplete in public data. Enemy defenses are estimates from
          base stats, level, and inventory.
        </p>
      </section>`;
  } catch {
    if (generation !== planGeneration || !target.isConnected) {
      return;
    }
    target.innerHTML = '<div class="empty">Unable to generate this champion plan.</div>';
    notify('This champion’s plan could not be generated.');
  }
}
function updateStatus() {
  const patchWarning = required(document.querySelector<HTMLElement>('#patch-warning'));
  patchWarning.textContent = initial.state.patchWarning ?? '';
  patchWarning.hidden = !initial.state.patchWarning;
  required(document.querySelector('#connection')).textContent = initial.state.connection;
  const importButton = document.querySelector<HTMLButtonElement>('#import-source');
  if (importButton) {
    importButton.disabled =
      initial.state.selectedId !== Number(importButton.dataset.champion) ||
      Boolean(initial.state.selectionPreview) ||
      (initial.state.role?.toUpperCase() || initial.settings.role) !== importButton.dataset.role ||
      Object.values(initial.state.imports).includes('Importing');
  }
  const imports = document.querySelector('#imports');
  if (imports) {
    const champion = initial.champions.find((c) => c.id === initial.state.selectedId);
    const statuses = champion ? initial.state.imports : {};
    const count = ['runes', 'summoners', 'items'].filter(
      (key) => statuses[key] === 'Imported',
    ).length;
    imports.innerHTML = /* HTML */ `<div class="import-summary">
        <div class="selection-portrait">
          ${champion ? `<img src="${icon(champion, 'champion')}" alt="" />` : '<span aria-hidden="true">?</span>'}
        </div>
        <div>
          <h3>${escape(champion?.name ?? 'Waiting for your champion')}</h3>
          <small
            >${escape(initial.state.role?.toUpperCase() ?? 'Select a champion in League')}</small
          >
        </div>
        <span class="import-count"
          >${initial.state.selectionPreview ? 'Preselection preview' : `${count}/3 imported`}</span
        >
      </div>
      <div class="import-checklist" role="list" aria-label="Import status">
        ${[
          ['runes', 'Rune page'],
          ['summoners', 'Summoner spells'],
          ['items', 'Item build'],
        ]
          .map(([key, label]) => {
            const status = statuses[key];
            const done = status === 'Imported';
            const pending = status === 'Importing';
            const failed = Boolean(status && !done && !pending);
            const state = done ? 'success' : pending ? 'pending' : failed ? 'error' : 'waiting';
            const caption = done
              ? 'Imported'
              : pending
                ? 'Importing…'
                : failed
                  ? 'Needs attention'
                  : initial.state.selectionPreview
                    ? 'Waiting for champion selection'
                    : champion
                      ? 'Ready to import'
                      : 'Waiting for selection';

            return `<div class="import-status ${state}" data-import="${key}" role="listitem">
          <input type="checkbox" disabled ${done ? 'checked' : ''} aria-label="${label} imported" />
          <div><strong>${label}</strong><small>${caption}</small>${failed ? `<p class="import-error">${escape(status)}</p>` : ''}</div>
          <span class="status-symbol" aria-hidden="true">${done ? '✓' : pending ? '…' : failed ? '!' : '–'}</span>
        </div>`;
          })
          .join('')}
      </div>
      <p class="muted draft-status">
        ${escape(initial.state.autoImportStatus || (initial.settings.autoImport ? `Automatic import: first ${initial.settings.autoImportSource} build` : 'Automatic import is off.'))}
      </p>`;
  }
}
function renderSettings() {
  const s = initial.settings as Settings;
  content.innerHTML = /* HTML */ `<form class="panel" id="settings-form">
      <h2>Your preferences</h2>
      <div class="setting">
        <label for="flash-slot">Preferred Flash side</label>
        <div id="flash-picker"></div>
      </div>
      <fieldset class="auto-import-setting">
        <legend>Automatic build import</legend>
        <label
          ><input type="checkbox" name="autoImport" ${s.autoImport ? 'checked' : ''} />Import the
          first build from my preferred source after champion selection</label
        >
        <input
          type="hidden"
          name="autoImportSource"
          value="${escape(s.autoImportSource ?? 'Local')}"
        />
        <div
          id="auto-import-sources"
          class="source-picker"
          role="group"
          aria-label="Preferred build source"
        >
          ${buildSources.map((source) => `<button type="button" data-source="${source}" aria-pressed="${source === (s.autoImportSource ?? 'Local')}">${sourceIcon(source)}<span>${source}</span></button>`).join('')}
        </div>
        <p class="muted">
          Imports available items, runes, and summoners. A manual import takes precedence. If the
          source is unavailable, no other source is substituted.
        </p>
      </fieldset>
      <label class="setting"
        ><input type="checkbox" name="overlayEnabled" ${s.overlayEnabled ? 'checked' : ''} />Enable
        overlay</label
      ><label class="setting"
        >Shop panel shortcut<input
          type="text"
          name="shopHotkey"
          value="${escape(s.shopHotkey)}"
        /><small
          >Default: P, matching League’s shop key. Single keys pass through to the game. You can
          also use a combination such as Alt+Shift+S.</small
        ></label
      >
      <div class="setting">
        <span>Fallback role</span>
        <div id="role-picker">
          ${rolePicker(s.role)}<input
            type="hidden"
            id="fallback-role"
            name="role"
            value="${s.role}"
          />
        </div>
      </div>
      <fieldset class="setting">
        <legend>Skill marker calibration</legend>
        <p>
          Offsets use pixels at 1080p. Negative vertical values move up. Size changes keep the
          marker centred on the skill.
        </p>
        <label
          >Horizontal offset
          <input
            type="number"
            name="skillOffsetX"
            min="-500"
            max="500"
            value="${s.skillOffsetX ?? 0}"
        /></label>
        <label
          >Vertical offset
          <input
            type="number"
            name="skillOffsetY"
            min="-500"
            max="500"
            value="${s.skillOffsetY ?? 0}"
        /></label>
        <label
          >Size multiplier
          <input
            type="number"
            name="skillSize"
            min="0.5"
            max="3"
            step="0.05"
            value="${s.skillSize ?? 1}"
        /></label>
      </fieldset>
      <label class="setting"
        >League installation folder<input
          type="text"
          id="league-path"
          name="leaguePath"
          value="${escape(s.leaguePath)}"
        /><small>Leave empty for standard install locations.</small></label
      ><button type="button" id="browse">Browse…</button>
      <button class="primary" type="submit">Save preferences</button>
    </form>
    <section class="panel">
      <h3>Data provenance</h3>
      <p>
        Patch ${publicPatch(initial.manifest.version)} · Data Dragon ${initial.manifest.version},
        fetched ${escape(initial.manifest.fetchedAt)}. English official descriptions are preserved.
        Dynamic values that the published data cannot resolve are labelled explicitly.
      </p>
      <p class="muted">
        The local engine works offline. External build sources are optional; no Riot API key is
        required.
      </p>
    </section>`;
  autocomplete(
    required(document.querySelector('#flash-picker')),
    ['D', 'F'].map((key) => ({ value: key, name: key })),
    {
      id: 'flash-slot',
      label: 'Preferred Flash side',
      name: 'flashSlot',
      value: s.flashSlot,
      required: true,
    },
  );
  const roleTarget = required(document.querySelector('#role-picker'));
  roleTarget.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((button) =>
    button.addEventListener('click', () => {
      required(document.querySelector<HTMLInputElement>('#fallback-role')).value =
        button.dataset.role ?? '';
      roleTarget
        .querySelectorAll('[data-role]')
        .forEach((entry) => entry.setAttribute('aria-pressed', String(entry === button)));
    }),
  );
  document
    .querySelectorAll<HTMLButtonElement>('#auto-import-sources [data-source]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        required(document.querySelector<HTMLInputElement>('[name=autoImportSource]')).value =
          button.dataset.source ?? 'Local';
        document
          .querySelectorAll('#auto-import-sources [data-source]')
          .forEach((entry) => entry.setAttribute('aria-pressed', String(entry === button)));
      }),
    );
  required(document.querySelector('#browse')).addEventListener('click', async () => {
    const folder = await api.pickLeague();
    if (folder) {
      required(document.querySelector<HTMLInputElement>('#league-path')).value = folder;
    }
  });
  required(document.querySelector('#settings-form')).addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    try {
      initial.settings = await api.saveSettings({
        flashSlot: form.get('flashSlot'),
        autoImport: form.has('autoImport'),
        autoImportSource: form.get('autoImportSource'),
        overlayEnabled: form.has('overlayEnabled'),
        shopHotkey: form.get('shopHotkey'),
        leaguePath: form.get('leaguePath'),
        role: form.get('role'),
        skillOffsetX: Number(form.get('skillOffsetX')),
        skillOffsetY: Number(form.get('skillOffsetY')),
        skillSize: Number(form.get('skillSize')),
      });
      buildSelection = undefined;
      notify('Preferences saved.');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Unable to save settings.');
    }
  });
}
function render() {
  hideTooltip();
  itemFilters = undefined;
  message.hidden = true;
  planGeneration++;
  required(document.querySelector('#title')).textContent =
    {
      companion: 'Companion',
      champions: 'Champions',
      items: 'Items',
      runes: 'Runes',
      summoners: 'Summoner spells',
      settings: 'Settings',
    }[currentView] ?? currentView;
  if (currentView === 'companion') {
    companion();
  } else if (
    currentView === 'champions' ||
    currentView === 'items' ||
    currentView === 'runes' ||
    currentView === 'summoners'
  ) {
    renderList(currentView);
  } else if (currentView === 'settings') {
    renderSettings();
  }
}
required(document.querySelector('nav')).addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-view]');
  if (!button) {
    return;
  }
  if (button.dataset.view === 'items' && currentView !== 'items') {
    itemMap = '11';
    itemCategory = '';
  }
  currentView = required(button.dataset.view);
  document
    .querySelectorAll('nav button')
    .forEach((b) => b.classList.toggle('active', b === button));
  render();
});
document.body.addEventListener('click', (event) => {
  hideTooltip();
  const category = (event.target as Element).closest<HTMLElement>('[data-category]');
  if (category) {
    const selectedCategory = required(category.dataset.category);
    modal.close();
    if (currentView !== 'items') {
      currentView = 'items';
      render();
      document
        .querySelectorAll<HTMLElement>('nav button')
        .forEach((button) => button.classList.toggle('active', button.dataset.view === 'items'));
    }
    required(document.querySelector<HTMLInputElement>('#search')).value = '';
    required(document.querySelector<HTMLSelectElement>('#item-tier')).value = '';
    required(document.querySelector<HTMLInputElement>('#item-gold')).value = '';
    required(document.querySelector<HTMLSelectElement>('#item-tag')).value = selectedCategory;
    itemFilters?.();

    return;
  }
  const button = (event.target as Element).closest<HTMLElement>('[data-kind]');
  if (button) {
    void detail(required(button.dataset.kind), Number(button.dataset.id));
  }
});
document.body.addEventListener('pointerover', (event) => {
  const target = (event.target as Element).closest<HTMLElement>(
    '[data-kind][data-id], [data-tooltip-title]',
  );
  if (target) {
    void showTooltip(target);
  }
});
document.body.addEventListener('pointerout', (event) => {
  if (
    hoverTarget &&
    event.target instanceof Node &&
    hoverTarget.contains(event.target) &&
    document.activeElement !== hoverTarget &&
    !(event.relatedTarget instanceof Node && hoverTarget.contains(event.relatedTarget))
  ) {
    hideTooltip();
  }
});
document.body.addEventListener('focusin', (event) => {
  const target = (event.target as Element).closest<HTMLElement>(
    '[data-kind][data-id], [data-tooltip-title]',
  );
  if (target) {
    void showTooltip(target);
  }
});
document.body.addEventListener('focusout', hideTooltip);
document.addEventListener(
  'scroll',
  () => {
    const focused = hoverTarget && hoverTarget === document.activeElement ? hoverTarget : null;
    hideTooltip();
    if (focused) {
      void showTooltip(focused);
    }
  },
  true,
);
window.addEventListener('resize', hideTooltip);
window.addEventListener('blur', hideTooltip);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideTooltip();
  }
});
document.body.addEventListener(
  'error',
  (event) => {
    if (event.target instanceof HTMLImageElement) {
      event.target.hidden = true;
    }
  },
  true,
);
// A backdrop click targets the dialog, but padding clicks also do: test its bounds.
let backdropPointer = false;
const outsideModal = (event: MouseEvent) => {
  const bounds = modal.getBoundingClientRect();

  return (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  );
};
modal.addEventListener('pointerdown', (event) => {
  backdropPointer = outsideModal(event);
});
modal.addEventListener('click', (event) => {
  if (backdropPointer && outsideModal(event)) {
    modal.close();
  }
  backdropPointer = false;
});
modal.addEventListener('close', hideTooltip);
required(document.querySelector('#close-detail')).addEventListener('click', () => modal.close());
try {
  initial = await api.init();
  selectedId = initial.state.selectedId ?? undefined;
  required(document.querySelector('#patch')).textContent =
    `PATCH ${publicPatch(initial.manifest.version)}`;
  api.onState((state) => {
    const championChanged = state.selectedId !== initial.state.selectedId;
    const roleChanged = state.role !== initial.state.role;
    const previewChanged = state.selectionPreview !== initial.state.selectionPreview;
    const clearedPreview =
      !state.selectedId &&
      initial.state.selectionPreview &&
      selectedId === initial.state.selectedId;
    const draftChanged = state.draftKey !== initial.state.draftKey;
    initial.state = state;
    updateStatus();
    if ((championChanged && state.selectedId) || clearedPreview) {
      selectedId = state.selectedId ?? undefined;
      if (currentView === 'companion') {
        companion();
      }
    } else if ((draftChanged || roleChanged || previewChanged) && currentView === 'companion') {
      void showSourceBuilds(roleChanged ? state.role?.toUpperCase() : undefined);
    }
  });
  render();
  if (!initial.hotkeyAvailable) {
    notify(
      'Shop-key detection is unavailable. Restart the app or choose a different shortcut in Settings.',
    );
  }
} catch {
  notify('Unable to initialize the app. Validate game data and restart.');
}
