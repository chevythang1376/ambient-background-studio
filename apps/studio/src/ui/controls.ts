/**
 * Tiny DOM helpers and labelled form controls for the studio panel. Everything
 * is a native input (range, radio, checkbox, textarea), so keyboard support and
 * screen-reader semantics come for free; CSS only restyles them.
 *
 * Each control reads its value through `get()` and exposes `sync()`, so the
 * studio can refresh every control after a reset or a type change.
 */
let uid = 0;
export const uidFor = (prefix: string): string => `${prefix}-${++uid}`;

export type Child = Node | string | null | undefined | false;
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) if (c != null && c !== false) el.append(c);
  return el;
}

export function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`studio: missing ${selector}`);
  return el;
}

export interface Control {
  root: HTMLElement;
  sync(): void;
}

export function section(title: string, ...children: Child[]): HTMLElement {
  const id = uidFor('sec');
  return h('section', { class: 'section', 'aria-labelledby': id }, h('h2', { id }, title), ...children);
}

export function hint(text: string, id?: string): HTMLParagraphElement {
  return h('p', { class: 'hint', id }, text);
}

// ── Slider ──────────────────────────────────────────────────────────────────

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  get(): number;
  format(v: number): string;
  onInput(v: number): void;
  hint?: string;
  /** Labels under the two ends of the track. */
  ends?: [string, string];
}

export interface Slider extends Control {
  input: HTMLInputElement;
  hintEl: HTMLParagraphElement | null;
}

export function slider(o: SliderOptions): Slider {
  const id = uidFor('s');
  const hintId = o.hint ? `${id}-hint` : null;
  const input = h('input', { type: 'range', id, min: o.min, max: o.max, step: o.step, 'aria-describedby': hintId });
  const out = h('output', { for: id, 'aria-hidden': 'true' });
  const paint = (v: number) => {
    const text = o.format(v);
    out.textContent = text;
    input.setAttribute('aria-valuetext', text);
    input.style.setProperty('--p', `${((v - o.min) / (o.max - o.min)) * 100}%`);
  };
  input.addEventListener('input', () => {
    paint(input.valueAsNumber);
    o.onInput(input.valueAsNumber);
  });
  const hintEl = o.hint ? hint(o.hint, hintId!) : null;
  const root = h(
    'div',
    { class: 'field' },
    h('div', { class: 'field__row' }, h('label', { for: id }, o.label), out),
    input,
    o.ends ? h('div', { class: 'field__ends', 'aria-hidden': 'true' }, h('span', null, o.ends[0]), h('span', null, o.ends[1])) : null,
    hintEl,
  );
  const sync = () => {
    input.value = String(o.get());
    paint(input.valueAsNumber);
  };
  sync();
  return { root, input, hintEl, sync };
}

// ── Radio group (segmented or cards) ────────────────────────────────────────

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  detail?: string;
}

export interface ChoiceOptions<T extends string> {
  legend: string;
  options: readonly ChoiceOption<T>[];
  get(): T | null;
  onChange(v: T): void;
  variant?: 'seg' | 'cards';
  hint?: string;
  hideLegend?: boolean;
}

export interface Choice<T extends string> extends Control {
  setLabel(value: T, label: string): void;
  setDisabled(disabled: boolean): void;
  hintEl: HTMLParagraphElement | null;
}

export function choice<T extends string>(o: ChoiceOptions<T>): Choice<T> {
  const name = uidFor('c');
  const hintId = o.hint ? `${name}-hint` : null;
  const inputs: HTMLInputElement[] = [];
  const labels = new Map<T, HTMLElement>();
  const opts = o.options.map((opt) => {
    const input = h('input', { type: 'radio', name, value: opt.value });
    input.addEventListener('change', () => input.checked && o.onChange(opt.value));
    inputs.push(input);
    const label = h('span', { class: 'choice__label' }, opt.label);
    labels.set(opt.value, label);
    return h(
      'label',
      { class: 'choice__opt' },
      input,
      h('span', { class: 'choice__body' }, label, opt.detail ? h('span', { class: 'choice__detail' }, opt.detail) : null),
    );
  });
  const hintEl = o.hint ? hint(o.hint, hintId!) : null;
  const root = h(
    'fieldset',
    { class: `choice choice--${o.variant ?? 'seg'}`, 'aria-describedby': hintId },
    h('legend', { class: o.hideLegend ? 'sr-only' : null }, o.legend),
    h('div', { class: 'choice__opts' }, ...opts),
    hintEl,
  );
  const sync = () => {
    const v = o.get();
    for (const input of inputs) input.checked = input.value === v;
  };
  sync();
  return {
    root,
    hintEl,
    sync,
    setLabel(value, text) {
      const el = labels.get(value);
      if (el) el.textContent = text;
    },
    setDisabled(disabled) {
      root.toggleAttribute('disabled', disabled);
    },
  };
}

// ── Switch ──────────────────────────────────────────────────────────────────

export function toggle(o: { label: string; get(): boolean; onChange(v: boolean): void; hint?: string }): Control {
  const id = uidFor('t');
  const hintId = o.hint ? `${id}-hint` : null;
  const input = h('input', { type: 'checkbox', role: 'switch', id, 'aria-describedby': hintId });
  input.addEventListener('change', () => o.onChange(input.checked));
  const root = h(
    'div',
    { class: 'field' },
    h('label', { class: 'switch', for: id }, input, h('span', { class: 'switch__track', 'aria-hidden': 'true' }), h('span', null, o.label)),
    o.hint ? hint(o.hint, hintId!) : null,
  );
  const sync = () => {
    input.checked = o.get();
  };
  sync();
  return { root, sync };
}

/** Wire an existing `<button aria-pressed>` as a toggle chip. */
export function pressable(button: HTMLButtonElement, get: () => boolean, onChange: (v: boolean) => void): Control {
  button.addEventListener('click', () => onChange(!get()));
  const sync = () => button.setAttribute('aria-pressed', String(get()));
  sync();
  return { root: button, sync };
}
