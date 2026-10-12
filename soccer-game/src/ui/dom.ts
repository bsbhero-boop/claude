import type { TeamDef } from '../game/types';
import { stars } from '../data/teams';

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined | null>;

/** 간단한 DOM 생성 헬퍼 */
export function h(tag: string, attrs: Attrs | null = null, ...children: (Child | Child[])[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'style' && typeof v === 'string') {
        el.setAttribute('style', v);
      } else if (k === 'class') {
        el.className = String(v);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  const add = (c: Child | Child[]) => {
    if (Array.isArray(c)) {
      c.forEach(add);
      return;
    }
    if (c === null || c === undefined || c === false) return;
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

export function crest(t: TeamDef, size: '' | 'lg' | 'sm' = '') {
  const c1 = t.home.shirt;
  const c2 = t.home.stripes ? '#ffffff' : t.home.shorts === t.home.shirt ? t.home.accent : t.home.shorts;
  return h('div', { class: `crest ${size}`, style: `--c1:${c1};--c2:${c2}`, 'aria-hidden': 'true' }, t.short);
}

export function starText(t: TeamDef) {
  const s = stars(t);
  const full = Math.floor(s);
  return '★'.repeat(full) + (s % 1 ? '☆' : '') + '·'.repeat(5 - Math.ceil(s));
}

export function bar(label: string, v: number) {
  return h(
    'div',
    { class: 'bar' },
    h('span', null, label),
    h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${Math.max(0, Math.min(100, ((v - 60) / 35) * 100))}%` })),
    h('b', null, v),
  );
}

export function seg<T extends string | number>(options: { v: T; label: string }[], value: T, onChange: (v: T) => void, id?: string) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup', id });
  const render = (cur: T) => {
    wrap.innerHTML = '';
    for (const o of options) {
      wrap.appendChild(
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': o.v === cur ? 'true' : 'false',
            class: o.v === cur ? 'on' : '',
            onclick: () => {
              onChange(o.v);
              render(o.v);
            },
          },
          o.label,
        ),
      );
    }
  };
  render(value);
  return wrap;
}

export function moraleBar(m: number) {
  const pct = ((m + 3) / 6) * 100;
  const col = m >= 1.5 ? '#45e08a' : m >= 0.3 ? '#9be15d' : m > -0.5 ? '#ffd34d' : m > -1.5 ? '#ff9a4d' : '#ff5d6c';
  return h('div', { class: 'morale', title: `사기 ${m.toFixed(1)}` }, h('i', { style: `width:${pct}%;background:${col}` }));
}

export function deltaTag(d: number) {
  const cls = d > 0.15 ? 'up' : d < -0.15 ? 'down' : 'flat';
  const sym = d > 0.15 ? '▲' : d < -0.15 ? '▼' : '–';
  return h('span', { class: `delta ${cls}` }, `${sym} ${Math.abs(d).toFixed(1)}`);
}

export function overallOf(p: { role: string; pac: number; sho: number; pas: number; dri: number; def: number; gk: number }) {
  if (p.role === 'GK') return p.gk;
  if (p.role === 'DF') return Math.round(p.def * 0.5 + p.pac * 0.2 + p.pas * 0.2 + p.dri * 0.1);
  if (p.role === 'MF') return Math.round(p.pas * 0.35 + p.dri * 0.3 + p.sho * 0.15 + p.pac * 0.1 + p.def * 0.1);
  return Math.round(p.sho * 0.4 + p.pac * 0.25 + p.dri * 0.25 + p.pas * 0.1);
}
