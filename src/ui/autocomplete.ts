import { required } from '../core/assert.js';

const names = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
export function byName<T extends { name: string }>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => names.compare(a.name, b.name));
}
export interface Choice {
  value: string;
  name: string;
  image?: string;
  keywords?: string;
}
const normalize = (text: string) =>
  text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
export function matchingChoices(choices: readonly Choice[], query: string): Choice[] {
  const text = normalize(query);

  return byName(choices).filter((choice) =>
    normalize(`${choice.name} ${choice.keywords ?? ''}`).includes(text),
  );
}

/** Editable, keyboard-accessible combobox; submitted values always come from real options. */
export function autocomplete(
  host: HTMLElement,
  choices: readonly Choice[],
  options: {
    id: string;
    label: string;
    name?: string;
    value?: string;
    placeholder?: string;
    required?: boolean;
    onChange?: (value: string) => void;
  },
) {
  host.classList.add('autocomplete');
  const input = document.createElement('input');
  input.id = options.id;
  input.type = 'text';
  input.autocomplete = 'off';
  input.placeholder = options.placeholder ?? `Search ${options.label.toLowerCase()}…`;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', options.label);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.required = Boolean(options.required);
  const stored = document.createElement('input');
  stored.type = 'hidden';
  if (options.name) {
    stored.name = options.name;
  }
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'autocomplete-toggle';
  toggle.textContent = '⌄';
  toggle.setAttribute('aria-label', `Show ${options.label.toLowerCase()} choices`);
  toggle.tabIndex = -1;
  const list = document.createElement('div');
  list.className = 'autocomplete-list';
  list.id = `${options.id}-options`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', options.label);
  list.hidden = true;
  input.setAttribute('aria-controls', list.id);
  const status = document.createElement('div');
  status.className = 'sr-only';
  status.setAttribute('role', 'status');
  let selected = choices.find((choice) => choice.value === options.value);
  let matches: Choice[] = [];
  let active = -1;
  input.value = selected?.name ?? '';
  stored.value = selected?.value ?? '';
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const commit = (choice?: Choice) => {
    const changed = selected?.value !== choice?.value;
    selected = choice;
    input.value = choice?.name ?? '';
    stored.value = choice?.value ?? '';
    input.setCustomValidity('');
    close();
    if (changed) {
      options.onChange?.(stored.value);
    }
  };
  const highlight = (index: number) => {
    active = index;
    Array.from(list.querySelectorAll<HTMLElement>('[role=option]')).forEach((row, i) => {
      row.classList.toggle('highlighted', i === active);
    });
    if (active >= 0) {
      const row = required(list.children.item(active));
      input.setAttribute('aria-activedescendant', row.id);
      row.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };
  const show = (query: string) => {
    matches = matchingChoices(choices, query);
    list.replaceChildren(
      ...matches.map((choice, i) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.tabIndex = -1;
        row.id = `${list.id}-${i}`;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(choice.value === selected?.value));
        if (choice.image) {
          const img = document.createElement('img');
          img.src = choice.image;
          img.alt = '';
          img.loading = 'lazy';
          row.append(img);
        }
        const label = document.createElement('span');
        label.textContent = choice.name;
        row.append(label);
        row.addEventListener('mousedown', (event) => event.preventDefault());
        row.addEventListener('click', () => {
          commit(choice);
          input.focus({ preventScroll: true });
          close();
        });

        return row;
      }),
    );
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'autocomplete-empty';
      empty.textContent = 'No matching options';
      list.append(empty);
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    status.textContent = `${matches.length} matching options`;
    const selectedIndex = matches.findIndex((choice) => choice.value === selected?.value);
    highlight(matches.length ? Math.max(0, selectedIndex) : -1);
  };
  const query = () => (input.value === selected?.name ? '' : input.value);
  input.addEventListener('focus', () => show(query()));
  input.addEventListener('click', () => {
    if (list.hidden) {
      show(query());
    }
  });
  input.addEventListener('input', () => {
    stored.value = '';
    input.setCustomValidity(input.value ? 'Choose an option from the list.' : '');
    if (!input.value) {
      commit();
    }
    show(input.value);
  });
  input.addEventListener('blur', () => {
    const exact = choices.find((choice) => normalize(choice.name) === normalize(input.value));
    if (exact) {
      commit(exact);
    } else if (!input.value) {
      commit();
    }
    close();
  });
  input.addEventListener('keydown', (event) => {
    if (
      ['ArrowDown', 'ArrowUp'].includes(event.key) ||
      (!list.hidden && ['Home', 'End'].includes(event.key))
    ) {
      event.preventDefault();
      if (list.hidden) {
        show(query());
        if (event.key === 'ArrowUp' && matches.length) {
          highlight(matches.length - 1);
        }

        return;
      }
      if (!matches.length) {
        return;
      }
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? matches.length - 1
            : event.key === 'ArrowDown'
              ? (active + 1) % matches.length
              : (active - 1 + matches.length) % matches.length;
      highlight(next);
    } else if (event.key === 'Enter' && !list.hidden) {
      event.preventDefault();
      if (active >= 0) {
        commit(matches[active]);
      }
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      input.value = selected?.name ?? '';
      stored.value = selected?.value ?? '';
      input.setCustomValidity('');
      close();
    }
  });
  toggle.addEventListener('mousedown', (event) => event.preventDefault());
  toggle.addEventListener('click', () => {
    if (list.hidden) {
      input.focus({ preventScroll: true });
      if (list.hidden) {
        show(query());
      }
    } else {
      close();
    }
  });
  host.replaceChildren(input, stored, toggle, list, status);

  return { input, value: () => stored.value };
}
