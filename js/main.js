/* =========================================================
 * 앱 컨트롤러 — 8개 모듈 '하루 체험', 응급 시뮬레이션, 결과 대시보드,
 * 읽어주기(TTS), 연습/평가 모드, 키오스크·둘러보기·퀴즈(복습)
 * ========================================================= */
import { STATIONS, RULES, QUIZ, SCENARIOS, RECORD_FORM, MODULES, EMERGENCIES, EMERGENCY_PRINCIPLE } from './data.js';
import { KioskSim } from './kiosk.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* =========================================================
 * 저장소 — 완료 여부(복습) + 모듈 점수 결과
 * ========================================================= */
const PROGRESS_KEY = 'hdc-progress-v1';      // 복습 메뉴 완료(explore/kiosk/scenario/quiz)
const RESULTS_KEY = 'hdc-results-v2';        // 모듈·응급·퀴즈 채점 결과
const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
const emptyBucket = () => ({ done: false, correct: 0, total: 0, dangers: 0 });
const results = Object.assign(
  { modules: {}, emergency: emptyBucket(), quiz: { taken: false, score: 0, total: QUIZ.length } },
  JSON.parse(localStorage.getItem(RESULTS_KEY) || '{}')
);
function saveResults() { localStorage.setItem(RESULTS_KEY, JSON.stringify(results)); }
function markDone(key) { progress[key] = true; localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); renderMenuBadges(); }

function bucketOf(id) {
  if (id === 'emergency') return results.emergency;
  if (!results.modules[id]) results.modules[id] = emptyBucket();
  return results.modules[id];
}
function resetBucket(id) { const b = emptyBucket(); if (id === 'emergency') results.emergency = b; else results.modules[id] = b; saveResults(); return b; }
function recordDecision(bucket, correct, danger) {
  bucket.total++; if (correct) bucket.correct++; if (danger && !correct) bucket.dangers++; saveResults();
}

function renderMenuBadges() {
  $$('.mod-card').forEach((card) => {
    const b = bucketOf(card.dataset.mod);
    card.querySelector('.done-badge').style.display = b && b.done ? 'inline-flex' : 'none';
  });
  $$('.menu-card').forEach((card) => {
    const badge = card.querySelector('.done-badge');
    if (badge) badge.style.display = progress[card.dataset.module] ? 'inline-flex' : 'none';
  });
}

/* =========================================================
 * 화면 전환 + 읽어주기(TTS)
 * ========================================================= */
function showScreen(id) {
  stopSpeak();
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

const ttsSupported = 'speechSynthesis' in window;
let ttsOn = localStorage.getItem('hdc-tts') === '1';
function speak(text) {
  if (!ttsSupported || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text).replace(/\s+/g, ' ').trim());
  u.lang = 'ko-KR'; u.rate = 0.95; u.pitch = 1;
  window.speechSynthesis.speak(u);
}
function speakIfOn(text) { if (ttsOn) speak(text); }
function stopSpeak() { if (ttsSupported) window.speechSynthesis.cancel(); }
function updateTtsBtn() {
  const b = $('#btnTtsGlobal');
  if (!b) return;
  b.classList.toggle('on', ttsOn);
  b.setAttribute('aria-pressed', String(ttsOn));
  b.innerHTML = ttsOn ? '🔊 읽어주기 <b>켜짐</b>' : '🔈 읽어주기';
}

/* ---------- 연습 / 평가 모드 ---------- */
let assessMode = localStorage.getItem('hdc-mode') === 'assess';
function updateModeBtn() {
  const b = $('#modeToggle');
  if (!b) return;
  b.classList.toggle('assess', assessMode);
  b.innerHTML = assessMode ? '📝 평가 모드' : '🌱 연습 모드';
  const hint = $('#modeHint');
  if (hint) hint.textContent = assessMode
    ? '평가 모드: 선택 결과가 이수 평가에 반영됩니다.'
    : '연습 모드: 틀려도 부담 없이 반복 연습하세요. (이수 집계 안 함)';
}

/* =========================================================
 * 3D 씬 (지연 로드)
 * ========================================================= */
let hospital = null;
let scene3dFailed = false;
async function ensureScene() {
  if (hospital || scene3dFailed) return hospital;
  try {
    const { HospitalScene } = await import('./hospital.js');
    hospital = new HospitalScene($('#canvas3d'));
    hospital.onStationTap = (id) => openStationInfo(id);
    window.__hospital = hospital;
  } catch (err) {
    console.error('3D 씬 초기화 실패:', err);
    scene3dFailed = true;
    $('#canvas3d').style.display = 'none';
    $('#webglFallback').style.display = 'flex';
  }
  return hospital;
}

/* =========================================================
 * 병원 둘러보기 (복습)
 * ========================================================= */
let visitedStations = new Set(JSON.parse(localStorage.getItem('hdc-visited') || '[]'));

async function startExplore() {
  showScreen('screen-sim');
  $('#simTitle').textContent = '🏥 병원 둘러보기';
  $('#procPanel').classList.remove('show');
  $('#infoPanel').classList.remove('show');
  $('#stationChips').style.display = 'flex';
  $('#exploreHint').style.display = 'block';
  renderChips();
  const h = await ensureScene();
  if (h) { h.setMode('explore'); h.setMarkersVisible(true); h.resetActors(); h.resize(); }
}
function renderChips() {
  const wrap = $('#stationChips');
  wrap.innerHTML = STATIONS.map(
    (s) => `<button class="chip ${visitedStations.has(s.id) ? 'chip-done' : ''}" data-st="${s.id}">${s.icon} ${s.short}</button>`
  ).join('');
  wrap.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => openStationInfo(b.dataset.st)));
}
function openStationInfo(id) {
  const st = STATIONS.find((s) => s.id === id);
  if (!st) return;
  $('#exploreHint').style.display = 'none';
  visitedStations.add(id);
  localStorage.setItem('hdc-visited', JSON.stringify([...visitedStations]));
  if (visitedStations.size >= STATIONS.length) markDone('explore');
  renderChips();
  if (hospital) { hospital.highlightStation(id); hospital.walkTo(id, null, { follow: false }); }

  const panel = $('#infoPanel');
  panel.innerHTML = `
    <div class="panel-grip"></div>
    <div class="panel-head">
      <h3>${st.icon} ${st.name}</h3>
      <button class="panel-close" id="infoClose">✕</button>
    </div>
    <div class="tab-row">
      <button class="tab active" data-tab="tasks">📌 해야 할 업무</button>
      <button class="tab" data-tab="cautions">⚠️ 주의사항</button>
    </div>
    <ul class="panel-list" id="infoList"></ul>
    ${st.action === 'kiosk' ? `<button class="btn btn-primary btn-block" id="infoKiosk">🖥️ 키오스크 직접 실습하기</button>` : ''}
  `;
  const renderTab = (tab) => {
    $('#infoList').innerHTML = st[tab].map((t) => `<li>${t}</li>`).join('');
    panel.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    speakIfOn(st[tab].join('. '));
  };
  panel.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => renderTab(b.dataset.tab)));
  renderTab('tasks');
  $('#infoClose').addEventListener('click', () => panel.classList.remove('show'));
  const kioskBtn = $('#infoKiosk');
  if (kioskBtn) kioskBtn.addEventListener('click', () => openKiosk(null));
  panel.classList.add('show');
}

/* =========================================================
 * 8개 모듈 '하루 체험' 엔진
 * ========================================================= */
let curMod = null;
let beatIdx = 0;

function setPanel(html) { const p = $('#procPanel'); p.innerHTML = html; p.classList.add('show'); }
function modHeader() {
  return `<div class="panel-grip"></div>
    <div class="mod-top">
      <span class="mod-badge">${curMod.icon} 모듈 ${curMod.no}</span>
      <span class="mod-step">${Math.min(beatIdx + 1, curMod.beats.length)} / ${curMod.beats.length}</span>
    </div>`;
}

async function startModule(idx) {
  curMod = MODULES[idx];
  beatIdx = 0;
  resetBucket(curMod.id); // 새 시도 → 이전 점수 초기화(재도전으로 정정 가능)
  showScreen('screen-sim');
  $('#simTitle').textContent = `${curMod.no}. ${curMod.title}`;
  $('#infoPanel').classList.remove('show');
  $('#procPanel').classList.remove('show');
  $('#stationChips').style.display = 'none';
  $('#exploreHint').style.display = 'none';
  const h = await ensureScene();
  if (h) { h.setMode('procedure'); h.setMarkersVisible(false); h.resetActors(); h.resize(); }
  runBeat();
}

function nextBeat() { beatIdx++; runBeat(); }

function runBeat() {
  if (!curMod) return;
  if (beatIdx >= curMod.beats.length) { finishModule(); return; }
  const b = curMod.beats[beatIdx];
  $('#procPanel').classList.remove('show');
  if (b.t === 'scene') renderSceneBeat(b);
  else if (b.t === 'check') renderCheckBeat(b);
  else if (b.t === 'decision') renderDecisionBeat(b);
  else if (b.t === 'kiosk') renderKioskBeat(b);
  else if (b.t === 'record') renderRecordBeat(b);
  else nextBeat();
}

function renderSceneBeat(b) {
  const first = beatIdx === 0;
  setPanel(`${modHeader()}
    ${first && curMod.goal ? `<div class="mod-goal">🎯 <b>오늘의 목표</b> · ${curMod.goal}</div>` : ''}
    ${first && curMod.optional ? `<div class="branch-note">${curMod.optional}</div>` : ''}
    <div class="scene-say">🗣️ ${b.say}</div>
    <div class="proc-nav proc-nav-end">
      <button class="btn btn-primary" id="beatNext">다음 →</button>
    </div>`);
  speakIfOn((first && curMod.goal ? curMod.goal + '. ' : '') + b.say);
  if (hospital) hospital.walkTo(b.station, null, { follow: true });
  $('#beatNext').addEventListener('click', nextBeat);
}

function renderCheckBeat(b) {
  const total = b.items.length;
  setPanel(`${modHeader()}
    <h3>${b.title}</h3>
    <p class="check-label">✅ 이 단계에서 직접 확인·수행할 항목입니다. 하나씩 눌러 확인하세요.</p>
    <div class="check-grid">
      ${b.items.map((c, i) => `<label class="check-item"><input type="checkbox" data-chk="${i}"><span>${c}</span></label>`).join('')}
    </div>
    ${b.caution ? `<div class="caution-box">⚠️ ${b.caution}</div>` : ''}
    <p class="check-hint" id="checkHint"></p>
    <div class="proc-nav proc-nav-end">
      <button class="btn btn-primary" id="beatNext" disabled>다음 →</button>
    </div>`);
  speakIfOn(b.title);
  const panel = $('#procPanel');
  const nextBtn = $('#beatNext');
  const hint = $('#checkHint');
  const refresh = () => {
    const done = panel.querySelectorAll('[data-chk]:checked').length;
    const ok = done === total;
    nextBtn.disabled = !ok;
    hint.classList.toggle('check-hint-ok', ok);
    hint.textContent = ok ? '모든 항목을 확인했습니다. 다음으로 진행하세요.' : `모두 확인하면 다음으로 진행할 수 있어요 (${done}/${total})`;
  };
  panel.querySelectorAll('[data-chk]').forEach((cb) => cb.addEventListener('change', refresh));
  refresh();
  nextBtn.addEventListener('click', () => { if (!nextBtn.disabled) nextBeat(); });
}

function renderDecisionBeat(b) {
  const correctIdx = b.options.findIndex((o) => o.ok);
  setPanel(`${modHeader()}
    <div class="scn-top"><span class="scn-stage">${b.icon || '❓'} ${b.rule || '상황 판단'}</span></div>
    <div class="scn-situation">${b.situation}</div>
    <div class="scn-q">무엇을 해야 할까요?</div>
    <div class="quiz-options">
      ${b.options.map((o, i) => `<button class="quiz-opt" data-i="${i}">${o.text}</button>`).join('')}
    </div>
    <div class="quiz-explain" id="decExplain" style="display:none"></div>`);
  speakIfOn(b.situation + ' 무엇을 해야 할까요?');
  const panel = $('#procPanel');
  panel.querySelectorAll('.quiz-opt').forEach((btn) =>
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i;
      const opt = b.options[i];
      recordDecision(bucketOf(curMod.id), opt.ok, opt.danger);
      panel.querySelectorAll('.quiz-opt').forEach((el, bi) => {
        el.disabled = true;
        if (b.options[bi].ok) el.classList.add('opt-correct');
        else if (bi === i) el.classList.add('opt-wrong');
      });
      const ex = $('#decExplain');
      ex.style.display = 'block';
      ex.innerHTML = `
        <div class="scn-verdict">${opt.ok ? '⭕ 올바른 대응입니다!' : (opt.danger ? '⛔ 위험한 행동이에요!' : '❌ 다시 생각해 볼까요?')}</div>
        <p>${opt.why}</p>
        ${opt.ok ? '' : `<p class="scn-correct">✔ 올바른 대응: ${b.options[correctIdx].text}<br>${b.options[correctIdx].why}</p>`}
        ${b.rule ? `<div class="scn-rule">관련 수칙 · ${b.rule}</div>` : ''}
        <button class="btn btn-primary btn-block" id="beatNext">다음 →</button>`;
      speakIfOn((opt.ok ? '올바른 대응입니다. ' : '다시 생각해 볼까요. ') + opt.why);
      $('#beatNext').addEventListener('click', nextBeat);
      ex.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    })
  );
}

function renderKioskBeat(b) {
  setPanel(`${modHeader()}
    <div class="scene-say">🖥️ 무인 키오스크를 직접 조작해 볼 차례입니다.</div>
    <button class="btn btn-primary btn-block" id="beatKiosk">${b.label || '키오스크 실습 시작'}</button>
    <p class="check-hint">키오스크 화면을 끝까지 완료하면 자동으로 다음으로 넘어갑니다.</p>`);
  speakIfOn('키오스크를 직접 조작해 봅니다.');
  $('#beatKiosk').addEventListener('click', () => openKiosk(b.flow, () => nextBeat()));
}

function renderRecordBeat() {
  showScreen('screen-record');
  renderRecordForm((values) => finishModuleWithRecord(values));
}

function finishModule() {
  if (!curMod) return;
  bucketOf(curMod.id).done = true; saveResults(); renderMenuBadges();
  renderModuleComplete($('#procPanel'), curMod);
  $('#procPanel').classList.add('show');
}
function finishModuleWithRecord(values) {
  const mod = MODULES.find((m) => m.id === 'm7');
  bucketOf('m7').done = true; saveResults(); renderMenuBadges();
  const labelOf = (k) => RECORD_FORM.fields.find((f) => f.key === k).label;
  const receipt = `
    <div class="record-receipt">
      <div class="record-receipt-head">📋 작성한 서비스 제공 기록지</div>
      ${RECORD_FORM.fields.map((f) => `<div class="record-row"><span>${labelOf(f.key)}</span><b>${values[f.key] || '-'}</b></div>`).join('')}
    </div>`;
  renderModuleComplete($('#recordArea'), mod, receipt);
  $('#recordArea').scrollIntoView({ behavior: 'smooth' });
}

function renderModuleComplete(container, mod, receiptHtml = '') {
  const idx = MODULES.indexOf(mod);
  const b = bucketOf(mod.id);
  const scoreLine = b.total > 0
    ? `<div class="mc-score">상황 판단 <b>${b.correct} / ${b.total}</b> 정답${b.dangers > 0 ? ` · <span class="mc-danger">위험 행동 선택 ${b.dangers}회</span>` : ''}</div>`
    : '';
  let nextLabel, nextFn;
  if (idx < MODULES.length - 1) { const nm = MODULES[idx + 1]; nextLabel = `${nm.icon} 모듈 ${nm.no} · ${nm.title} →`; nextFn = () => startModule(idx + 1); }
  else { nextLabel = '🆘 모듈 8 · 응급상황 대응 →'; nextFn = startEmergency; }

  container.innerHTML = `
    <div class="record-card record-done">
      <div class="finish-icon">✅</div>
      <h3>모듈 ${mod.no} · ${mod.title} 완료!</h3>
      <p class="record-done-sub">${mod.goal}</p>
      ${scoreLine}
      ${receiptHtml}
      ${b.dangers > 0 ? `<div class="caution-box">⚠️ 위험 행동을 선택한 항목이 있어요. <b>다시 하기</b>로 한 번 더 연습하면 좋아요.</div>` : ''}
      <div class="proc-nav">
        <button class="btn btn-ghost" id="mcAgain">다시 하기</button>
        <button class="btn btn-primary" id="mcNext">${nextLabel}</button>
      </div>
      <div class="mc-links">
        <button class="btn btn-ghost" id="mcResults">📊 학습 결과 보기</button>
        <button class="btn btn-ghost" id="mcMenu">메뉴로</button>
      </div>
    </div>`;
  container.querySelector('#mcAgain').addEventListener('click', () => startModule(idx));
  container.querySelector('#mcNext').addEventListener('click', nextFn);
  container.querySelector('#mcResults').addEventListener('click', showResults);
  container.querySelector('#mcMenu').addEventListener('click', () => showScreen('screen-menu'));
  speakIfOn(`모듈 ${mod.no} ${mod.title} 완료`);
}

/* =========================================================
 * 서비스 제공 기록지 (모듈 7)
 * ========================================================= */
function renderRecordForm(onDone) {
  const area = $('#recordArea');
  area.innerHTML = `
    <div class="record-card">
      <p class="record-intro">${RECORD_FORM.intro}</p>
      <button class="btn btn-ghost btn-block" id="recordSample">✏️ 예시로 채우기</button>
      <form id="recordForm" class="record-form">
        ${RECORD_FORM.fields.map((f) => `
          <label class="record-field">
            <span class="record-flabel">${f.label}${f.required ? ' <em>*</em>' : ''}</span>
            ${f.type === 'textarea'
              ? `<textarea data-key="${f.key}" rows="2" placeholder="${f.placeholder}"></textarea>`
              : `<input type="text" data-key="${f.key}" placeholder="${f.placeholder}">`}
          </label>`).join('')}
      </form>
      <div class="record-reminders">${RECORD_FORM.reminders.map((r) => `<div>📌 ${r}</div>`).join('')}</div>
      <p class="check-hint" id="recordHint">필수(*) 항목을 모두 채우면 제출할 수 있어요.</p>
      <button class="btn btn-primary btn-block" id="recordSubmit" disabled>기록지 제출하고 보고하기</button>
    </div>`;
  const submit = $('#recordSubmit');
  const hint = $('#recordHint');
  const refresh = () => {
    const ok = RECORD_FORM.fields.filter((f) => f.required)
      .every((f) => area.querySelector(`[data-key="${f.key}"]`).value.trim() !== '');
    submit.disabled = !ok;
    hint.classList.toggle('check-hint-ok', ok);
    hint.textContent = ok ? '작성이 완료되었습니다. 제출하세요.' : '필수(*) 항목을 모두 채우면 제출할 수 있어요.';
  };
  area.querySelectorAll('[data-key]').forEach((el) => el.addEventListener('input', refresh));
  $('#recordSample').addEventListener('click', () => {
    RECORD_FORM.fields.forEach((f) => { area.querySelector(`[data-key="${f.key}"]`).value = f.sample; });
    refresh();
  });
  submit.addEventListener('click', () => {
    if (submit.disabled) return;
    const values = {};
    RECORD_FORM.fields.forEach((f) => { values[f.key] = area.querySelector(`[data-key="${f.key}"]`).value.trim(); });
    onDone(values);
  });
  refresh();
  area.scrollIntoView({ behavior: 'smooth' });
}

/* =========================================================
 * 모듈 8 · 응급상황 대응 시뮬레이션
 * ========================================================= */
let emIdx = 0, emStepIdx = 0;

function startEmergency() {
  resetBucket('emergency');
  showScreen('screen-emergency');
  const area = $('#emArea');
  area.innerHTML = `
    <div class="quiz-card scn-intro">
      <div class="finish-icon">🆘</div>
      <h3>응급상황 대응 시뮬레이션</h3>
      <div class="em-principle">
        <div class="em-principle-title">초기 대응 5원칙</div>
        <ol>${EMERGENCY_PRINCIPLE.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
        <p class="em-place">📍 ${EMERGENCY_PRINCIPLE.place}</p>
        <p class="em-never">🚫 ${EMERGENCY_PRINCIPLE.never}</p>
      </div>
      <p>낙상 · 의식저하/호흡곤란 · 저혈당 · 경련, <b>${EMERGENCIES.length}가지 상황</b>에 직접 대응해 봅니다.</p>
      <button class="btn btn-primary btn-block" id="emStart">시작하기</button>
    </div>`;
  speakIfOn('응급상황 대응 시뮬레이션. 초기 대응 5원칙을 기억하세요.');
  $('#emStart').addEventListener('click', () => runEmergency(0));
}

function runEmergency(i) {
  emIdx = i; emStepIdx = 0;
  if (i >= EMERGENCIES.length) { finishEmergency(); return; }
  renderEmStep();
}

function renderEmStep() {
  const em = EMERGENCIES[emIdx];
  const step = em.steps[emStepIdx];
  const area = $('#emArea');
  const isLastStep = emStepIdx === em.steps.length - 1;
  area.innerHTML = `
    <div class="quiz-card">
      <div class="scn-top">
        <span class="scn-stage">${em.icon} ${em.title}</span>
        <span class="quiz-no">상황 ${emIdx + 1} / ${EMERGENCIES.length}</span>
      </div>
      <div class="em-place-tag ${em.placeType === 'in' ? 'place-in' : 'place-out'}">📍 ${em.place} · ${em.placeType === 'in' ? '병원 안' : '병원 밖·이동 중'}</div>
      <div class="scn-situation">${em.situation}</div>
      <div class="em-steps-dot">${em.steps.map((_, s) => `<span class="dot ${s < emStepIdx ? 'dot-done' : ''} ${s === emStepIdx ? 'dot-now' : ''}"></span>`).join('')}</div>
      <div class="scn-q">${step.q}</div>
      <div class="quiz-options">
        ${step.options.map((o, i) => `<button class="quiz-opt" data-i="${i}">${o.text}</button>`).join('')}
      </div>
      <div class="quiz-explain" id="emExplain" style="display:none"></div>
    </div>`;
  speakIfOn(em.situation + ' ' + step.q);
  const correctIdx = step.options.findIndex((o) => o.ok);
  area.querySelectorAll('.quiz-opt').forEach((btn) =>
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i;
      const opt = step.options[i];
      recordDecision(bucketOf('emergency'), opt.ok, opt.danger);
      area.querySelectorAll('.quiz-opt').forEach((el, bi) => {
        el.disabled = true;
        if (step.options[bi].ok) el.classList.add('opt-correct');
        else if (bi === i) el.classList.add('opt-wrong');
      });
      const ex = $('#emExplain');
      ex.style.display = 'block';
      const goLabel = isLastStep ? (emIdx === EMERGENCIES.length - 1 ? '결과 보기' : '다음 상황 →') : '다음 →';
      ex.innerHTML = `
        <div class="scn-verdict">${opt.ok ? '⭕ 올바른 대응입니다!' : (opt.danger ? '⛔ 위험한 행동이에요!' : '❌ 다시 생각해 볼까요?')}</div>
        <p>${opt.why}</p>
        ${opt.ok ? '' : `<p class="scn-correct">✔ 올바른 대응: ${step.options[correctIdx].text}<br>${step.options[correctIdx].why}</p>`}
        ${isLastStep ? `<div class="scn-rule">🔎 ${em.after}</div>` : ''}
        <button class="btn btn-primary btn-block" id="emNext">${goLabel}</button>`;
      speakIfOn((opt.ok ? '올바른 대응입니다. ' : '다시 생각해 볼까요. ') + opt.why);
      $('#emNext').addEventListener('click', () => {
        if (isLastStep) runEmergency(emIdx + 1);
        else { emStepIdx++; renderEmStep(); }
      });
      ex.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    })
  );
}

function finishEmergency() {
  bucketOf('emergency').done = true; saveResults(); renderMenuBadges();
  const b = bucketOf('emergency');
  const area = $('#emArea');
  area.innerHTML = `
    <div class="quiz-card quiz-result">
      <div class="finish-icon">${b.dangers === 0 ? '🏅' : '📖'}</div>
      <h3>응급 대응 ${b.correct} / ${b.total} 정답</h3>
      <p>${b.dangers === 0
        ? '훌륭합니다! 응급 초기 대응과 장소별 신고 체계를 잘 익히셨습니다.'
        : `위험 행동을 <b>${b.dangers}회</b> 선택했어요. 응급은 생명과 직결되니 <b>다시 도전</b>으로 정정해 주세요.`}</p>
      <p class="em-never">🚫 어떤 응급상황에서도 이용자를 혼자 두지 않습니다.</p>
      <div class="proc-nav">
        <button class="btn btn-ghost" id="emAgain">다시 도전</button>
        <button class="btn btn-primary" id="emToResults">📊 학습 결과 보기</button>
      </div>
      <button class="btn btn-ghost btn-block" id="emMenu">메뉴로</button>
    </div>`;
  speakIfOn('응급 대응 시뮬레이션을 마쳤습니다.');
  $('#emAgain').addEventListener('click', startEmergency);
  $('#emToResults').addEventListener('click', showResults);
  $('#emMenu').addEventListener('click', () => showScreen('screen-menu'));
}

/* =========================================================
 * 학습 결과 · 취약 항목 · 재학습 권장 (수료 평가)
 * ========================================================= */
function showResults() {
  showScreen('screen-results');
  const items = MODULES.map((m) => ({ m, b: bucketOf(m.id) }));
  const em = bucketOf('emergency');
  const doneCount = items.filter((x) => x.b.done).length + (em.done ? 1 : 0);
  const correct = items.reduce((s, x) => s + x.b.correct, 0) + em.correct;
  const total = items.reduce((s, x) => s + x.b.total, 0) + em.total;
  const dangers = items.reduce((s, x) => s + x.b.dangers, 0) + em.dangers;
  const ratio = total ? Math.round((correct / total) * 100) : 0;
  const quizOk = !results.quiz.taken || results.quiz.score >= Math.ceil(QUIZ.length * 0.7);
  const passed = doneCount === 8 && ratio >= 70 && em.done && em.dangers === 0 && quizOk;

  // 취약 모듈: 정답률 70% 미만이거나 위험 행동 선택
  const weak = items.filter((x) => x.b.total > 0 && (x.b.correct / x.b.total < 0.7 || x.b.dangers > 0));
  const emWeak = em.total > 0 && (em.correct / em.total < 0.7 || em.dangers > 0);

  const barRow = (icon, no, title, b, fn) => {
    const r = b.total ? Math.round((b.correct / b.total) * 100) : 0;
    const state = !b.done ? 'todo' : (b.dangers > 0 || (b.total && b.correct / b.total < 0.7) ? 'weak' : 'ok');
    return `<button class="res-row res-${state}" data-fn="${fn}">
      <span class="res-title">${icon} ${no ? `모듈 ${no} · ` : ''}${title}</span>
      <span class="res-meta">${!b.done ? '미완료' : `${b.correct}/${b.total}${b.dangers ? ` ⚠️${b.dangers}` : ''}`}</span>
      <span class="res-bar"><i style="width:${b.done ? r : 0}%"></i></span>
    </button>`;
  };

  const area = $('#resultsArea');
  area.innerHTML = `
    <div class="res-summary ${passed ? 'res-pass' : 'res-progress'}">
      <div class="finish-icon">${passed ? '🎓' : '📈'}</div>
      <h3>${passed ? '수료 기준을 충족했습니다!' : '학습 진행 현황'}</h3>
      <div class="res-stats">
        <div><b>${doneCount}/8</b><span>완료 모듈</span></div>
        <div><b>${ratio}%</b><span>상황 판단 정답률</span></div>
        <div class="${dangers ? 'res-danger' : ''}"><b>${dangers}</b><span>위험 행동</span></div>
      </div>
      <p class="res-mode">${assessMode ? '📝 평가 모드 · 이수 집계 대상' : '🌱 연습 모드 · 부담 없이 반복 학습 중'}</p>
    </div>

    <h4 class="res-h">모듈별 학습 결과</h4>
    <div class="res-list">
      ${items.map((x) => barRow(x.m.icon, x.m.no, x.m.title, x.b, 'mod:' + MODULES.indexOf(x.m))).join('')}
      ${barRow('🆘', 8, '응급상황 대응', em, 'em')}
    </div>

    <h4 class="res-h">이수 기준 점검</h4>
    <ul class="res-criteria">
      <li class="${doneCount === 8 ? 'ok' : 'no'}">${doneCount === 8 ? '✔' : '□'} 8개 모듈 전부 완료 (${doneCount}/8)</li>
      <li class="${ratio >= 70 ? 'ok' : 'no'}">${ratio >= 70 ? '✔' : '□'} 상황 판단 정답률 70% 이상 (현재 ${ratio}%)</li>
      <li class="${em.done && em.dangers === 0 ? 'ok' : 'no'}">${em.done && em.dangers === 0 ? '✔' : '□'} 응급 위험 행동 0건 ${em.done ? `(현재 ${em.dangers}건)` : '(미완료)'}</li>
      <li class="${quizOk && results.quiz.taken ? 'ok' : 'no'}">${quizOk && results.quiz.taken ? '✔' : '□'} 최종 점검 퀴즈 70% 이상 ${results.quiz.taken ? `(${results.quiz.score}/${QUIZ.length})` : '(미응시)'}</li>
    </ul>

    ${(weak.length || emWeak)
      ? `<h4 class="res-h">📌 재학습 권장</h4>
         <p class="res-weak-desc">아래 항목은 정답률이 낮거나 위험 행동을 선택했어요. 눌러서 다시 학습하세요.</p>
         <div class="res-reco">
           ${weak.map((x) => `<button class="btn btn-primary" data-fn="mod:${MODULES.indexOf(x.m)}">${x.m.icon} 모듈 ${x.m.no} · ${x.m.title}</button>`).join('')}
           ${emWeak ? `<button class="btn btn-primary" data-fn="em">🆘 응급상황 대응</button>` : ''}
         </div>`
      : (doneCount === 8 ? `<div class="res-allgood">🎉 모든 모듈을 잘 마쳤습니다! 취약 항목이 없어요.</div>` : '')}

    <div class="res-actions">
      <button class="btn btn-primary btn-block" id="resQuiz">✅ 최종 점검 퀴즈 풀기 (${QUIZ.length}문항)</button>
      <button class="btn btn-ghost btn-block" id="resMenu">메뉴로 돌아가기</button>
    </div>`;

  const runFn = (fn) => {
    if (fn === 'em') startEmergency();
    else if (fn && fn.startsWith('mod:')) startModule(+fn.split(':')[1]);
  };
  area.querySelectorAll('[data-fn]').forEach((b) => b.addEventListener('click', () => runFn(b.dataset.fn)));
  $('#resQuiz').addEventListener('click', startLearn);
  $('#resMenu').addEventListener('click', () => showScreen('screen-menu'));
  speakIfOn(passed ? '수료 기준을 충족했습니다.' : `현재 완료 모듈 ${doneCount}개, 정답률 ${ratio} 퍼센트.`);
}

/* =========================================================
 * 키오스크
 * ========================================================= */
const kioskSim = new KioskSim($('#kioskScreen'), $('#kioskTip'));
function openKiosk(flowId, onDone = null) {
  $('#kioskOverlay').classList.add('show');
  kioskSim.onComplete = () => {
    markDone('kiosk');
    if (onDone) { closeKiosk(); onDone(); }
    else kioskSim.start(null);
  };
  kioskSim.start(flowId);
}
function closeKiosk() { $('#kioskOverlay').classList.remove('show'); }

/* =========================================================
 * 실전 상황 대처 (12문항 복습 뱅크)
 * ========================================================= */
function startScenario() {
  showScreen('screen-scenario');
  $('#scnArea').innerHTML = `
    <div class="quiz-card scn-intro">
      <div class="finish-icon">🧭</div>
      <h3>실전 상황 대처 훈련</h3>
      <p>동행 과정에서 실제로 마주치는 <b>${SCENARIOS.length}가지 상황</b>이 순서대로 제시됩니다. 가장 올바른 대응을 선택하면 <b>왜 그런지</b> 바로 확인할 수 있습니다.</p>
      <button class="btn btn-primary btn-block" id="scnStart">시작하기</button>
    </div>`;
  $('#scnStart').addEventListener('click', () => runScenario(0, 0));
}
function runScenario(idx, score) {
  const area = $('#scnArea');
  if (idx >= SCENARIOS.length) {
    const pass = score >= Math.ceil(SCENARIOS.length * 0.7);
    if (pass) markDone('scenario');
    area.innerHTML = `
      <div class="quiz-card quiz-result">
        <div class="finish-icon">${pass ? '🏅' : '📖'}</div>
        <h3>${score} / ${SCENARIOS.length} 상황 정답</h3>
        <p>${pass ? '훌륭합니다! 실제 동행 상황에서의 판단력을 잘 갖추셨습니다.' : '아직 헷갈리는 상황이 있어요. 핵심 수칙을 다시 보고 한 번 더 도전해 보세요.'}</p>
        <button class="btn btn-primary" id="scnRetry">다시 도전</button>
      </div>`;
    $('#scnRetry').addEventListener('click', () => runScenario(0, 0));
    area.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const s = SCENARIOS[idx];
  area.innerHTML = `
    <div class="quiz-card">
      <div class="scn-top">
        <span class="scn-stage">${s.icon} ${s.stage}</span>
        <span class="quiz-no">상황 ${idx + 1} / ${SCENARIOS.length}</span>
      </div>
      <div class="scn-situation">${s.situation}</div>
      <div class="scn-q">어떻게 하시겠어요?</div>
      <div class="quiz-options">${s.options.map((o, i) => `<button class="quiz-opt" data-i="${i}">${o.text}</button>`).join('')}</div>
      <div class="quiz-explain" id="scnExplain" style="display:none"></div>
    </div>`;
  speakIfOn(s.situation + ' 어떻게 하시겠어요?');
  const correctIdx = s.options.findIndex((o) => o.ok);
  area.querySelectorAll('.quiz-opt').forEach((b) =>
    b.addEventListener('click', () => {
      const i = +b.dataset.i;
      const correct = s.options[i].ok;
      area.querySelectorAll('.quiz-opt').forEach((btn, bi) => {
        btn.disabled = true;
        if (s.options[bi].ok) btn.classList.add('opt-correct');
        else if (bi === i) btn.classList.add('opt-wrong');
      });
      const ex = $('#scnExplain');
      ex.style.display = 'block';
      ex.innerHTML = `
        <div class="scn-verdict">${correct ? '⭕ 올바른 대응입니다!' : '❌ 다시 생각해 볼까요?'}</div>
        <p>${s.options[i].why}</p>
        ${correct ? '' : `<p class="scn-correct">✔ 올바른 대응: ${s.options[correctIdx].text}<br>${s.options[correctIdx].why}</p>`}
        <div class="scn-rule">관련 수칙 · ${s.rule}</div>
        <button class="btn btn-primary btn-block" id="scnNext">${idx === SCENARIOS.length - 1 ? '결과 보기' : '다음 상황 →'}</button>`;
      speakIfOn((correct ? '올바른 대응입니다. ' : '다시 생각해 볼까요. ') + s.options[i].why);
      $('#scnNext').addEventListener('click', () => runScenario(idx + 1, score + (correct ? 1 : 0)));
      ex.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    })
  );
  area.scrollIntoView({ behavior: 'smooth' });
}

/* =========================================================
 * 핵심 수칙 + 최종 점검 퀴즈 (복습)
 * ========================================================= */
function startLearn() {
  showScreen('screen-learn');
  $('#rulesGrid').innerHTML = RULES.map(
    (r) => `<div class="rule-card"><div class="rule-icon">${r.icon}</div><h4>${r.title}</h4><p>${r.body}</p></div>`
  ).join('');
  $('#quizArea').innerHTML = `<button class="btn btn-primary btn-block" id="quizStart">✅ 최종 점검 퀴즈 시작 (${QUIZ.length}문항)</button>`;
  $('#quizStart').addEventListener('click', () => runQuiz(0, 0));
}
function runQuiz(idx, score) {
  const area = $('#quizArea');
  if (idx >= QUIZ.length) {
    const pass = score >= Math.ceil(QUIZ.length * 0.7);
    if (pass) markDone('quiz');
    results.quiz = { taken: true, score, total: QUIZ.length }; saveResults();
    area.innerHTML = `
      <div class="quiz-card quiz-result">
        <div class="finish-icon">${pass ? '🏅' : '📖'}</div>
        <h3>${score} / ${QUIZ.length} 문항 정답</h3>
        <p>${pass ? '훌륭합니다! 동행 업무의 핵심을 잘 이해하고 계십니다.' : '조금 더 학습이 필요해요. 핵심 수칙을 다시 읽고 도전해 보세요.'}</p>
        <div class="proc-nav">
          <button class="btn btn-ghost" id="quizRetry">다시 풀기</button>
          <button class="btn btn-primary" id="quizResults">📊 학습 결과 보기</button>
        </div>
      </div>`;
    $('#quizRetry').addEventListener('click', () => runQuiz(0, 0));
    $('#quizResults').addEventListener('click', showResults);
    area.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const q = QUIZ[idx];
  area.innerHTML = `
    <div class="quiz-card">
      <div class="quiz-no">문제 ${idx + 1} / ${QUIZ.length}</div>
      <h3>${q.q}</h3>
      <div class="quiz-options">${q.options.map((o, i) => `<button class="quiz-opt" data-i="${i}">${o}</button>`).join('')}</div>
      <div class="quiz-explain" id="quizExplain" style="display:none"></div>
    </div>`;
  speakIfOn(q.q);
  area.querySelectorAll('.quiz-opt').forEach((b) =>
    b.addEventListener('click', () => {
      const i = +b.dataset.i;
      const correct = i === q.answer;
      area.querySelectorAll('.quiz-opt').forEach((btn, bi) => {
        btn.disabled = true;
        if (bi === q.answer) btn.classList.add('opt-correct');
        else if (bi === i) btn.classList.add('opt-wrong');
      });
      const ex = $('#quizExplain');
      ex.style.display = 'block';
      ex.innerHTML = `<b>${correct ? '⭕ 정답입니다!' : '❌ 아쉬워요.'}</b> ${q.explain}
        <button class="btn btn-primary btn-block" id="quizNext">${idx === QUIZ.length - 1 ? '결과 보기' : '다음 문제 →'}</button>`;
      speakIfOn((correct ? '정답입니다. ' : '아쉬워요. ') + q.explain);
      $('#quizNext').addEventListener('click', () => runQuiz(idx + 1, score + (correct ? 1 : 0)));
    })
  );
  area.scrollIntoView({ behavior: 'smooth' });
}

/* =========================================================
 * 이벤트 바인딩
 * ========================================================= */
$('#btnStart').addEventListener('click', () => { showScreen('screen-menu'); renderMenuBadges(); });

$$('.mod-card').forEach((card) =>
  card.addEventListener('click', () => {
    const m = card.dataset.mod;
    if (m === 'emergency') startEmergency();
    else startModule(MODULES.findIndex((x) => x.id === m));
  })
);
$$('.menu-card').forEach((card) =>
  card.addEventListener('click', () => {
    const m = card.dataset.module;
    if (m === 'explore') startExplore();
    else if (m === 'kiosk') openKiosk(null);
    else if (m === 'scenario') startScenario();
    else if (m === 'quiz') startLearn();
    else if (m === 'results') showResults();
  })
);

$('#btnSimBack').addEventListener('click', () => {
  $('#infoPanel').classList.remove('show');
  $('#procPanel').classList.remove('show');
  curMod = null;
  showScreen('screen-menu');
});
$('#btnLearnBack').addEventListener('click', () => showScreen('screen-menu'));
$('#btnScnBack').addEventListener('click', () => showScreen('screen-menu'));
$('#btnEmBack').addEventListener('click', () => showScreen('screen-menu'));
$('#btnRecordBack').addEventListener('click', () => { curMod = null; showScreen('screen-menu'); });
$('#btnResultsBack').addEventListener('click', () => showScreen('screen-menu'));
$('#btnKioskClose').addEventListener('click', closeKiosk);
$('#btnMenuHome').addEventListener('click', () => showScreen('screen-start'));

$('#btnTtsGlobal').addEventListener('click', () => {
  ttsOn = !ttsOn;
  localStorage.setItem('hdc-tts', ttsOn ? '1' : '0');
  updateTtsBtn();
  if (ttsOn) speak('읽어주기를 켰습니다. 안내 문구를 소리로 읽어 드릴게요.');
  else stopSpeak();
});
if (!ttsSupported) { const b = $('#btnTtsGlobal'); if (b) b.style.display = 'none'; }

$('#modeToggle').addEventListener('click', () => {
  assessMode = !assessMode;
  localStorage.setItem('hdc-mode', assessMode ? 'assess' : 'practice');
  updateModeBtn();
});

updateTtsBtn();
updateModeBtn();
renderMenuBadges();
showScreen('screen-start');
