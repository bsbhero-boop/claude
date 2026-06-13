/* =========================================================
 * 키오스크 터치 시뮬레이션 (DOM 기반)
 * 실제 병원 키오스크 화면 흐름을 재현하고,
 * 각 단계마다 동행인력용 안내 팁을 보여준다.
 * ========================================================= */
import { KIOSK_FLOWS } from './data.js';

export class KioskSim {
  /**
   * @param {HTMLElement} root  키오스크 화면이 그려질 컨테이너
   * @param {HTMLElement} tipEl 동행 도우미 팁 영역
   */
  constructor(root, tipEl) {
    this.root = root;
    this.tipEl = tipEl;
    this.onComplete = null;
  }

  /** flowId: 'register' | 'payment' | 'certificate' | null(메뉴) */
  start(flowId = null) {
    if (flowId) this._runFlow(flowId);
    else this._home();
  }

  _home() {
    this._setTip('어르신이 직접 누르시도록 화면 옆에서 안내하세요. 오늘 할 일(접수/수납/서류)을 먼저 함께 확인합니다.');
    this.root.innerHTML = `
      <div class="kiosk-header">○○병원 무인 수납기</div>
      <div class="kiosk-title">원하시는 업무를 선택하세요</div>
      <div class="kiosk-options">
        <button class="kiosk-btn" data-flow="register">🏥<span>진료 접수</span></button>
        <button class="kiosk-btn" data-flow="payment">💳<span>수납 (진료비 결제)</span></button>
        <button class="kiosk-btn" data-flow="certificate">📄<span>증명서 발급</span></button>
      </div>`;
    this.root.querySelectorAll('[data-flow]').forEach((b) =>
      b.addEventListener('click', () => this._runFlow(b.dataset.flow))
    );
  }

  _runFlow(flowId) {
    this.flow = KIOSK_FLOWS[flowId];
    this.flowId = flowId;
    this.stepIdx = 0;
    this._renderStep();
  }

  _renderStep() {
    const step = this.flow.steps[this.stepIdx];
    this._setTip(step.tip || '');
    const header = `<div class="kiosk-header">${this.flow.name} <span class="kiosk-step-no">${this.stepIdx + 1}/${this.flow.steps.length}</span></div>`;

    if (step.type === 'choice') {
      this.root.innerHTML = `${header}
        <div class="kiosk-title">${step.title}</div>
        <div class="kiosk-options">
          ${step.options.map((o, i) => `<button class="kiosk-btn" data-i="${i}">${o.label}</button>`).join('')}
        </div>
        ${this._backBtn()}`;
      this.root.querySelectorAll('[data-i]').forEach((b) =>
        b.addEventListener('click', () => this._go(step.options[+b.dataset.i].next))
      );
    } else if (step.type === 'keypad') {
      this.root.innerHTML = `${header}
        <div class="kiosk-title">${step.title}</div>
        <div class="kiosk-display" id="kioskDisplay">______</div>
        <div class="kiosk-keypad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9, '지움', 0, '확인'].map((k) =>
            `<button class="kiosk-key ${typeof k === 'string' ? 'kiosk-key-fn' : ''}" data-k="${k}">${k}</button>`).join('')}
        </div>
        ${this._backBtn()}`;
      let value = '';
      const display = this.root.querySelector('#kioskDisplay');
      const update = () => {
        display.textContent = ('●'.repeat(value.length) + '______').slice(0, step.digits);
      };
      this.root.querySelectorAll('[data-k]').forEach((b) =>
        b.addEventListener('click', () => {
          const k = b.dataset.k;
          if (k === '지움') value = value.slice(0, -1);
          else if (k === '확인') {
            if (value.length < step.digits) { this._flash(display); return; }
            this._go(this.stepIdx + 1);
            return;
          } else if (value.length < step.digits) value += k;
          update();
        })
      );
      update();
    } else if (step.type === 'confirm') {
      this.root.innerHTML = `${header}
        <div class="kiosk-title">${step.title}</div>
        <div class="kiosk-paper">${step.lines.map((l) => `<div>${l}</div>`).join('')}</div>
        <button class="kiosk-btn kiosk-btn-primary" id="kioskConfirm">${step.confirmLabel || '확인'}</button>
        ${this._backBtn()}`;
      this.root.querySelector('#kioskConfirm').addEventListener('click', () => this._go(this.stepIdx + 1));
    } else if (step.type === 'done') {
      this.root.innerHTML = `${header}
        <div class="kiosk-done-icon">✅</div>
        <div class="kiosk-title">${step.title}</div>
        <div class="kiosk-paper kiosk-paper-print">${step.lines.map((l) => `<div>${l}</div>`).join('')}</div>
        <button class="kiosk-btn kiosk-btn-primary" id="kioskDone">완료</button>`;
      this.root.querySelector('#kioskDone').addEventListener('click', () => {
        if (this.onComplete) this.onComplete(this.flowId);
        else this._home();
      });
    }
    this._afterRender();
  }

  _go(idx) {
    this.stepIdx = idx;
    this._renderStep();
  }

  _afterRender() {
    const back = this.root.querySelector('#kioskBack');
    if (back) back.addEventListener('click', () => this._home());
  }

  _backBtn() {
    return `<button class="kiosk-back" id="kioskBack">⟵ 처음으로</button>`;
  }

  _setTip(text) {
    this.tipEl.innerHTML = text
      ? `<span class="tip-badge">🦺 동행 도우미</span> ${text}`
      : '';
    this.tipEl.style.display = text ? 'block' : 'none';
  }

  _flash(el) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
}
