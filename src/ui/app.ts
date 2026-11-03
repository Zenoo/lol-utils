import { required } from '../core/assert.js';
import { autocomplete, byName } from './autocomplete.js';
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
    aria-label="${escape(name)}"
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
async function showTooltip(target: HTMLElement) {
  if (hoverTarget === target) {
    return;
  }
  hideTooltip();
  hoverTarget = target;
  const generation = hoverGeneration;
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
    const img = target.querySelector<HTMLImageElement>('img');
    hover.innerHTML = `<div class="tooltip-heading">${img ? `<img src="${escape(img.src)}" alt="" />` : ''}<strong>${escape(name)}</strong></div><p class="tooltip-meta">${escape(meta)}</p><div class="tooltip-description">${text(description)}</div>`;
    (modal.open ? modal : document.body).append(hover);
    hover.hidden = false;
    target.setAttribute('aria-describedby', hover.id);
    const rect = target.getBoundingClientRect();
    const size = hover.getBoundingClientRect();
    const x = Math.max(12, Math.min(innerWidth - size.width - 12, rect.right + 12));
    const y = Math.max(12, Math.min(innerHeight - size.height - 12, rect.top));
    hover.style.left = `${x}px`;
    hover.style.top = `${y}px`;
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
        <h3 class="entry-heading">${skillButton(c, -1)}${escape(c.passive.name)}</h3>
        <p>${text(c.passive.description)}</p>
        ${c.spells
          .map(
            (s, i) =>
              /* HTML */ `<div class="ability">
                <h3 class="entry-heading">${skillButton(c, i)}${escape(s.name)}</h3>
                <p>${text(s.description)}</p>
                <p>
                  ${text(s.tooltip.replace(/\{\{\s*(.*?)\s*\}\}/g, '[$1: dynamic value unavailable]'))}
                </p>
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
          values[key] = Number(result.toFixed(3));
        }
        required(document.querySelector('#champ-stats')).innerHTML = stats(values);
      };
      levelInput.addEventListener('input', update);
      update();
    } else if (kind === 'items') {
      const i = value as Item;
      target.innerHTML = /* HTML */ `<h2 class="entry-heading">
          <img src="${icon(i, 'item')}" alt="" />${escape(i.name)}
        </h2>
        <p>${text(i.description)}</p>
        ${stats({ 'Total gold': i.gold.total, 'Combine gold': i.gold.base, 'Sell gold': i.gold.sell, ...i.stats })}
        <p>Categories: ${escape(i.tags.join(', '))}</p>
        <h3>Recipe</h3>
        <div class="row">
          ${
            itemAlternatives((i.from ?? []).map(Number))
              .map((item) => itemButton(item.id))
              .join('') || 'No components'
          }
        </div>
        <h3>Builds into</h3>
        <div class="row">
          ${
            itemAlternatives((i.into ?? []).map(Number))
              .map((item) => itemButton(item.id))
              .join('') || 'No further upgrades'
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
function renderList(kind: 'champions' | 'items' | 'runes' | 'summoners') {
  const perks = Array.from(
    new Map(
      [
        ...initial.runes.flatMap((style) => style.slots.flatMap((slot) => slot.runes)),
        ...initial.shards,
      ].map((perk) => [perk.id, perk]),
    ).values(),
  );
  const list = byName<{ id: number; name: string; subtitle: string; url: string; tags: string[] }>(
    kind === 'champions'
      ? initial.champions.map((champ) => ({
          ...champ,
          subtitle: champ.title,
          url: icon(champ, 'champion'),
        }))
      : kind === 'items'
        ? initial.items.map((item) => ({
            ...item,
            subtitle: `${item.gold.total} gold · ${item.maps['11'] ? 'Rift' : 'Other modes'}`,
            url: icon(item, 'item'),
          }))
        : kind === 'runes'
          ? perks.map((perk) => ({
              ...perk,
              tags: [],
              subtitle: perk.shortDesc.replace(/<[^>]*>/g, ' '),
              url: runeIcon(perk),
            }))
          : initial.summoners.map((spell) => ({
              ...spell,
              tags: [],
              subtitle: spell.description,
              url: icon(spell, 'spell'),
            })),
  );
  content.innerHTML = /* HTML */ `<input
      type="search"
      id="search"
      placeholder="Search ${escape(kind)}…"
      aria-label="Search ${escape(kind)}"
    />
    <div class="grid" id="results"></div>`;
  const update = () => {
    const q = required(document.querySelector<HTMLInputElement>('#search')).value.toLowerCase();
    required(document.querySelector('#results')).innerHTML = list
      .filter((x) => `${x.name} ${(x.tags ?? []).join(' ')}`.toLowerCase().includes(q))
      .map(
        (x) =>
          /* HTML */ `<button class="card" data-kind="${kind}" data-id="${x.id}">
            <img loading="lazy" src="${x.url}" alt="" /><span
              ><strong>${escape(x.name)}</strong><small>${escape(x.subtitle)}</small></span
            >
          </button>`,
      )
      .join('');
  };
  required(document.querySelector('#search')).addEventListener('input', update);
  update();
}
function companion() {
  content.innerHTML = /* HTML */ `<section class="panel hero">
      <p class="eyebrow">BUILT FROM THE PATCH, EXPLAINED TO YOU</p>
      <h2>A plan for your champion.</h2>
      <p>
        Explore a champion’s options here. Imports follow your actual selection in the League
        client.
      </p>
      <div class="row">
        <div id="champion-picker"></div>
        <button id="import" class="primary">Import client selection</button>
      </div>
      <p class="muted">
        Flash on ${initial.settings.flashSlot} · Automatic import
        ${initial.settings.autoImport ? 'on' : 'off'} · Patch ${initial.manifest.version}
      </p>
    </section>
    <div id="imports" class="panel"></div>
    <div id="plan"></div>
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
        void showPlan();
      },
    },
  );
  required(document.querySelector('#import')).addEventListener('click', async (event) => {
    const button = event.target as HTMLButtonElement;
    button.disabled = true;
    try {
      initial.state = await api.importSelected();
      updateStatus();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Import failed');
    } finally {
      button.disabled = false;
    }
  });
  updateStatus();
  void showPlan();
}
async function showPlan() {
  const generation = ++planGeneration;
  const target = document.querySelector('#plan');
  if (!target) {
    return;
  }
  if (!selectedId) {
    target.innerHTML = '<div class="empty">Choose a champion to inspect a generated plan.</div>';

    return;
  }
  try {
    const [plan, championEntry] = await Promise.all([
      api.plan(selectedId),
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
                    ${itemButton(item.id, String(index + 1))}<small>${item.gold.total}g</small>
                  </div>`,
              )
              .join('')}
          </div>
        </section>
        <section class="panel">
          <h3>Rune page</h3>
          <div class="icon-row rune-page">
            ${plan.runes.selectedPerkIds.map(perkButton).join('')}
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
            Preview uses your assigned role for the client selection, otherwise the fallback role in
            Settings. Builds refresh against both teams once all champions are selected.
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
    notify('This champion’s plan could not be generated.');
  }
}
function updateStatus() {
  const patchWarning = required(document.querySelector<HTMLElement>('#patch-warning'));
  patchWarning.textContent = initial.state.patchWarning ?? '';
  patchWarning.hidden = !initial.state.patchWarning;
  required(document.querySelector('#connection')).textContent = initial.state.connection;
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
        <span class="import-count">${count}/3 imported</span>
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
      ${champion ? `<p class="muted draft-status">${initial.state.draftKey ? 'Build considers both complete teams.' : 'Item build refreshes once the final champion is selected.'}</p>` : ''}`;
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
      <label class="setting"
        ><input type="checkbox" name="autoImport" ${s.autoImport ? 'checked' : ''} />Import runes,
        summoners, and item set after client champion selection</label
      ><label class="setting"
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
        <label for="fallback-role">Fallback role</label>
        <div id="role-picker"></div>
      </div>
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
        Patch ${initial.manifest.version}, fetched ${escape(initial.manifest.fetchedAt)}. English
        official descriptions are preserved. Dynamic values that the published data cannot resolve
        are labelled explicitly.
      </p>
      <p class="muted">No third-party builds, analytics, advertising, or API key required.</p>
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
  autocomplete(
    required(document.querySelector('#role-picker')),
    ['BOTTOM', 'JUNGLE', 'MIDDLE', 'TOP', 'UTILITY'].map((role) => ({
      value: role,
      name: role.charAt(0) + role.slice(1).toLowerCase(),
    })),
    { id: 'fallback-role', label: 'Fallback role', name: 'role', value: s.role, required: true },
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
        overlayEnabled: form.has('overlayEnabled'),
        shopHotkey: form.get('shopHotkey'),
        leaguePath: form.get('leaguePath'),
        role: form.get('role'),
      });
      notify('Preferences saved.');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Unable to save settings.');
    }
  });
}
function render() {
  hideTooltip();
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
  currentView = required(button.dataset.view);
  document
    .querySelectorAll('nav button')
    .forEach((b) => b.classList.toggle('active', b === button));
  render();
});
document.body.addEventListener('click', (event) => {
  hideTooltip();
  const button = (event.target as Element).closest<HTMLElement>('[data-kind]');
  if (button) {
    void detail(required(button.dataset.kind), Number(button.dataset.id));
  }
});
document.body.addEventListener('pointerover', (event) => {
  const target = (event.target as Element).closest<HTMLElement>('[data-kind][data-id]');
  if (target) {
    void showTooltip(target);
  }
});
document.body.addEventListener('pointerout', (event) => {
  if (
    hoverTarget &&
    !(event.relatedTarget instanceof Node && hoverTarget.contains(event.relatedTarget))
  ) {
    hideTooltip();
  }
});
document.body.addEventListener('focusin', (event) => {
  const target = (event.target as Element).closest<HTMLElement>('[data-kind][data-id]');
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
required(document.querySelector('#close-detail')).addEventListener('click', () => modal.close());
try {
  initial = await api.init();
  required(document.querySelector('#patch')).textContent = `PATCH ${initial.manifest.version}`;
  api.onState((state) => {
    const draftChanged = state.draftKey !== initial.state.draftKey;
    initial.state = state;
    updateStatus();
    if (draftChanged && currentView === 'companion') {
      void showPlan();
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
