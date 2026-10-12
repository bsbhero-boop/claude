import type { Action, Input } from '../game/input';
import { h } from './dom';

/** 터치 기기용 가상 스틱 + 버튼 */
export class TouchControls {
  root: HTMLElement;
  private input: Input;
  private stickId: number | null = null;
  private knob: HTMLElement;
  private stick: HTMLElement;

  constructor(parent: HTMLElement, input: Input, onPause: () => void) {
    this.input = input;
    this.knob = h('div', { class: 'knob' });
    this.stick = h('div', { class: 'stick', 'aria-label': '이동 스틱' }, this.knob);
    const btn = (label: string, action: Action, cls = '') => {
      const b = h('button', { type: 'button', class: cls, 'aria-label': label }, label);
      const on = (e: Event) => {
        e.preventDefault();
        b.classList.add('on');
        input.setVirtual(action, true);
      };
      const off = (e: Event) => {
        e.preventDefault();
        b.classList.remove('on');
        input.setVirtual(action, false);
      };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
      return b;
    };
    const pad = h(
      'div',
      { class: 'pad' },
      btn('개인기', 'skill'),
      btn('로빙', 'lob'),
      btn('필살', 'special', 'sp'),
      btn('스루', 'through'),
      btn('패스', 'pass'),
      btn('슛', 'shoot'),
      btn('감아', 'finesse'),
      btn('질주', 'sprint'),
      btn('칩슛', 'chip'),
    );
    const pause = h('button', { type: 'button', class: 'pause-btn', 'aria-label': '일시정지', onclick: onPause }, 'II');
    this.root = h('div', { id: 'touch' }, this.stick, pad, pause);
    parent.appendChild(this.root);

    this.stick.addEventListener('pointerdown', (e) => {
      this.stickId = e.pointerId;
      this.stick.setPointerCapture(e.pointerId);
      this.move(e);
    });
    this.stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.move(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.knob.style.transform = '';
      input.setVirtualAxis(0, 0);
    };
    this.stick.addEventListener('pointerup', end);
    this.stick.addEventListener('pointercancel', end);
  }

  private move(e: PointerEvent) {
    const r = this.stick.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > 1) {
      dx /= l;
      dy /= l;
    }
    this.knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
    this.input.setVirtualAxis(Math.abs(dx) < 0.15 ? 0 : dx, Math.abs(dy) < 0.15 ? 0 : dy);
  }

  show(on: boolean) {
    this.root.classList.toggle('on', on);
    if (!on) this.input.setVirtualAxis(0, 0);
  }
}

export const isTouch = () => {
  try {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  } catch {
    return false;
  }
};
