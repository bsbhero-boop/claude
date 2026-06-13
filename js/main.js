/* =========================================================
 * 앱 컨트롤러 — 화면 전환, 탐색/절차 모드, 키오스크, 퀴즈
 * ========================================================= */
import { STATIONS, PROCEDURE, RULES, QUIZ, SCENARIOS, RECORD_FORM } from './data.js';
import { KioskSim } from './kiosk.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ---------- 학습 진행 저장 ---------- */
const PROGRESS_KEY = 'hdc-progress-v1';
const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
function markDone(key) {
  progress[key] = true;
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  renderMenuBadges();
}
function renderMenuBadges() {
  $$('.menu-card').forEach((card) => {
    const badge = card.querySelector('.done-badge');
    if (badge) badge.style.display = progress[card.dataset.module] ? 'inline-flex' : 'none';
  });
}

/* ---------- 화면 전환 ---------- */
function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

/* ---------- 3D 씬 (지연 로드) ---------- */
let hospital = null;
let scene3dFailed = false;
async function ensureScene() {
  if (hospital || scene3dFailed) return hospital;
  try {
    const { HospitalScene } = await import('./hospital.js');
    hospital = new HospitalScene($('#canvas3d'));
    hospital.onStationTap = (id) => openStationInfo(id);
    window.__hospital = hospital; // 디버깅용
  } catch (err) {
    console.error('3D 씬 초기화 실패:', err);
    scene3dFailed = true;
    $('#canvas3d').style.display = 'none';
    $('#webglFallback').style.display = 'flex';
  }
  return hospital;
}

/* ---------- 탐색 모드 ---------- */
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
  if (h) {
    h.setMode('explore');
    h.setMarkersVisible(true);
    h.resetActors();
    h.resize();
  }
}

function renderChips() {
  const wrap = $('#stationChips');
  wrap.innerHTML = STATIONS.map(
    (s) => `<button class="chip ${visitedStations.has(s.id) ? 'chip-done' : ''}" data-st="${s.id}">${s.icon} ${s.short}</button>`
  ).join('');
  wrap.querySelectorAll('[data-st]').forEach((b) =>
    b.addEventListener('click', () => openStationInfo(b.dataset.st))
  );
}

function openStationInfo(id) {
  const st = STATIONS.find((s) => s.id === id);
  if (!st) return;
  $('#exploreHint').style.display = 'none';
  visitedStations.add(id);
  localStorage.setItem('hdc-visited', JSON.stringify([...visitedStations]));
  if (visitedStations.size >= STATIONS.length) markDone('explore');
  renderChips();

  if (hospital) {
    hospital.highlightStation(id);
    hospital.walkTo(id, null, { follow: false });
  }

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
  };
  panel.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => renderTab(b.dataset.tab))
  );
  renderTab('tasks');
  $('#infoClose').addEventListener('click', () => panel.classList.remove('show'));
  const kioskBtn = $('#infoKiosk');
  if (kioskBtn) kioskBtn.addEventListener('click', () => openKiosk(null));
  panel.classList.add('show');
}

/* ---------- 절차 모드 ---------- */
let procIdx = 0;

async function startProcedure() {
  showScreen('screen-sim');
  $('#simTitle').textContent = '🚶 진료 동행 절차 시뮬레이션';
  $('#infoPanel').classList.remove('show');
  $('#stationChips').style.display = 'none';
  $('#exploreHint').style.display = 'none';
  procIdx = 0;
  const h = await ensureScene();
  if (h) {
    h.setMode('procedure');
    h.setMarkersVisible(false);
    h.resetActors();
    h.resize();
  }
  showProcStep();
}

function showProcStep() {
  if (procIdx < 0 || procIdx >= PROCEDURE.length) return;
  const step = PROCEDURE[procIdx];
  const panel = $('#procPanel');
  panel.classList.remove('show');
  // 이동(걷기) 중에는 이전 단계의 버튼이 DOM에 남아 중복 클릭되지 않도록 패널을 비운다.
  panel.innerHTML = '<div class="panel-grip"></div>';

  const isLast = procIdx === PROCEDURE.length - 1;
  const render = () => {
    panel.innerHTML = `
      <div class="panel-grip"></div>
      <div class="proc-progress">
        ${PROCEDURE.map((_, i) =>
          `<span class="dot ${i < procIdx ? 'dot-done' : ''} ${i === procIdx ? 'dot-now' : ''}"></span>`).join('')}
      </div>
      <h3>${step.title}</h3>
      <ul class="panel-list">${step.desc.map((d) => `<li>${d}</li>`).join('')}</ul>
      ${step.branch ? `<div class="branch-note">${step.branch}</div>` : ''}
      <p class="check-label">✅ 이 단계에서 직접 수행할 행동입니다. 하나씩 확인하세요.</p>
      <div class="check-grid">
        ${step.checklist.map((c, i) => `
          <label class="check-item"><input type="checkbox" data-chk="${i}"><span>${c}</span></label>`).join('')}
      </div>
      <div class="caution-box">⚠️ ${step.caution}</div>
      ${step.kioskFlow ? `<button class="btn btn-primary btn-block" id="procKiosk">🖥️ 키오스크로 직접 해보기</button>` : ''}
      <p class="check-hint" id="procCheckHint"></p>
      <div class="proc-nav">
        <button class="btn btn-ghost" id="procPrev" ${procIdx === 0 ? 'disabled' : ''}>← 이전</button>
        <span class="proc-count">${procIdx + 1} / ${PROCEDURE.length}</span>
        <button class="btn btn-primary" id="procNext" disabled>${isLast ? '📋 기록지 작성' : '다음 →'}</button>
      </div>`;

    const total = step.checklist.length;
    const nextBtn = $('#procNext');
    const hint = $('#procCheckHint');
    const refresh = () => {
      const done = panel.querySelectorAll('[data-chk]:checked').length;
      const ok = done === total;
      nextBtn.disabled = !ok;
      hint.classList.toggle('check-hint-ok', ok);
      hint.textContent = ok
        ? '모든 행동을 확인했습니다. 다음으로 진행하세요.'
        : `체크리스트를 모두 확인하면 다음으로 진행할 수 있어요 (${done}/${total})`;
    };
    panel.querySelectorAll('[data-chk]').forEach((cb) => cb.addEventListener('change', refresh));
    refresh();

    $('#procPrev').addEventListener('click', () => { if (procIdx > 0) { procIdx--; showProcStep(); } });
    nextBtn.addEventListener('click', () => {
      if (nextBtn.disabled) return;
      if (isLast) { openRecord(); return; }
      procIdx++;
      showProcStep();
    });
    const kioskBtn = $('#procKiosk');
    if (kioskBtn) kioskBtn.addEventListener('click', () => openKiosk(step.kioskFlow, true));
    panel.classList.add('show');
  };

  if (hospital) hospital.walkTo(step.station, render, { follow: true });
  else render();
}

/* ---------- 서비스 제공 기록지 작성 (절차 마지막 산출물) ---------- */
function openRecord() {
  $('#procPanel').classList.remove('show');
  showScreen('screen-record');
  renderRecordForm();
}

function renderRecordForm() {
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
      <div class="record-reminders">
        ${RECORD_FORM.reminders.map((r) => `<div>📌 ${r}</div>`).join('')}
      </div>
      <p class="check-hint" id="recordHint">필수(*) 항목을 모두 채우면 제출할 수 있어요.</p>
      <button class="btn btn-primary btn-block" id="recordSubmit" disabled>기록지 제출하고 보고하기</button>
    </div>`;

  const fieldEls = [...area.querySelectorAll('[data-key]')];
  const submit = $('#recordSubmit');
  const hint = $('#recordHint');
  const refresh = () => {
    const ok = RECORD_FORM.fields
      .filter((f) => f.required)
      .every((f) => area.querySelector(`[data-key="${f.key}"]`).value.trim() !== '');
    submit.disabled = !ok;
    hint.classList.toggle('check-hint-ok', ok);
    hint.textContent = ok ? '작성이 완료되었습니다. 제출하세요.' : '필수(*) 항목을 모두 채우면 제출할 수 있어요.';
  };
  fieldEls.forEach((el) => el.addEventListener('input', refresh));

  $('#recordSample').addEventListener('click', () => {
    RECORD_FORM.fields.forEach((f) => {
      area.querySelector(`[data-key="${f.key}"]`).value = f.sample;
    });
    refresh();
  });
  submit.addEventListener('click', () => {
    if (submit.disabled) return;
    const values = {};
    RECORD_FORM.fields.forEach((f) => {
      values[f.key] = area.querySelector(`[data-key="${f.key}"]`).value.trim();
    });
    finishProcedure(values);
  });
  refresh();
  area.scrollIntoView({ behavior: 'smooth' });
}

function finishProcedure(values) {
  markDone('procedure');
  const labelOf = (k) => RECORD_FORM.fields.find((f) => f.key === k).label;
  $('#recordArea').innerHTML = `
    <div class="record-card record-done">
      <div class="finish-icon">🎉</div>
      <h3>동행 절차 학습을 모두 마쳤습니다!</h3>
      <p class="record-done-sub">사전 준비부터 진료·수납·약국·귀가, 그리고 <b>서비스 기록지 작성·보고</b>까지
      실제 병원 동행의 전 과정을 완수했습니다.</p>
      <div class="record-receipt">
        <div class="record-receipt-head">📋 작성한 서비스 제공 기록지</div>
        ${RECORD_FORM.fields.map((f) => `
          <div class="record-row"><span>${labelOf(f.key)}</span><b>${values[f.key] || '-'}</b></div>`).join('')}
      </div>
      <p class="record-next">이어서 <b>실전 상황 대처(4)</b>와 <b>핵심 수칙·점검(5)</b>으로 판단력을 다져 보세요.</p>
      <div class="proc-nav">
        <button class="btn btn-ghost" id="procAgain">절차 다시 하기</button>
        <button class="btn btn-primary" id="recordToScenario">실전 상황 대처 →</button>
      </div>
      <button class="btn btn-ghost btn-block" id="procToMenu">메뉴로 돌아가기</button>
    </div>`;
  $('#procAgain').addEventListener('click', startProcedure);
  $('#recordToScenario').addEventListener('click', startScenario);
  $('#procToMenu').addEventListener('click', () => showScreen('screen-menu'));
  $('#recordArea').scrollIntoView({ behavior: 'smooth' });
}

/* ---------- 키오스크 ---------- */
const kioskSim = new KioskSim($('#kioskScreen'), $('#kioskTip'));
let kioskReturnToProc = false;

function openKiosk(flowId, fromProcedure = false) {
  kioskReturnToProc = fromProcedure;
  $('#kioskOverlay').classList.add('show');
  kioskSim.onComplete = (completedFlow) => {
    markDone('kiosk');
    if (kioskReturnToProc) closeKiosk();
    else kioskSim.start(null);
  };
  kioskSim.start(flowId);
}
function closeKiosk() {
  $('#kioskOverlay').classList.remove('show');
}

/* ---------- 핵심 수칙 + 퀴즈 ---------- */
function startLearn() {
  showScreen('screen-learn');
  $('#rulesGrid').innerHTML = RULES.map(
    (r) => `<div class="rule-card"><div class="rule-icon">${r.icon}</div><h4>${r.title}</h4><p>${r.body}</p></div>`
  ).join('');
  $('#quizArea').innerHTML = `
    <button class="btn btn-primary btn-block" id="quizStart">✅ 학습 점검 퀴즈 시작 (${QUIZ.length}문항)</button>`;
  $('#quizStart').addEventListener('click', () => runQuiz(0, 0));
}

function runQuiz(idx, score) {
  const area = $('#quizArea');
  if (idx >= QUIZ.length) {
    const pass = score >= Math.ceil(QUIZ.length * 0.7);
    if (pass) markDone('quiz');
    area.innerHTML = `
      <div class="quiz-card quiz-result">
        <div class="finish-icon">${pass ? '🏅' : '📖'}</div>
        <h3>${score} / ${QUIZ.length} 문항 정답</h3>
        <p>${pass ? '훌륭합니다! 동행 업무의 핵심을 잘 이해하고 계십니다.' : '조금 더 학습이 필요해요. 핵심 수칙을 다시 읽고 도전해 보세요.'}</p>
        <button class="btn btn-primary" id="quizRetry">다시 풀기</button>
      </div>`;
    $('#quizRetry').addEventListener('click', () => runQuiz(0, 0));
    area.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const q = QUIZ[idx];
  area.innerHTML = `
    <div class="quiz-card">
      <div class="quiz-no">문제 ${idx + 1} / ${QUIZ.length}</div>
      <h3>${q.q}</h3>
      <div class="quiz-options">
        ${q.options.map((o, i) => `<button class="quiz-opt" data-i="${i}">${o}</button>`).join('')}
      </div>
      <div class="quiz-explain" id="quizExplain" style="display:none"></div>
    </div>`;
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
      $('#quizNext').addEventListener('click', () => runQuiz(idx + 1, score + (correct ? 1 : 0)));
    })
  );
  area.scrollIntoView({ behavior: 'smooth' });
}

/* ---------- 실전 상황 대처 시나리오 ---------- */
function startScenario() {
  showScreen('screen-scenario');
  $('#scnArea').innerHTML = `
    <div class="quiz-card scn-intro">
      <div class="finish-icon">🧭</div>
      <h3>실전 상황 대처 훈련</h3>
      <p>동행 과정에서 실제로 마주치는 <b>${SCENARIOS.length}가지 상황</b>이 순서대로 제시됩니다.
      가장 올바른 대응을 선택하면 <b>왜 그런지</b> 바로 확인할 수 있습니다.</p>
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
        <p>${pass
          ? '훌륭합니다! 실제 동행 상황에서의 판단력을 잘 갖추셨습니다.'
          : '아직 헷갈리는 상황이 있어요. 핵심 수칙을 다시 보고 한 번 더 도전해 보세요.'}</p>
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
      <div class="quiz-options">
        ${s.options.map((o, i) => `<button class="quiz-opt" data-i="${i}">${o.text}</button>`).join('')}
      </div>
      <div class="quiz-explain" id="scnExplain" style="display:none"></div>
    </div>`;
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
      $('#scnNext').addEventListener('click', () => runScenario(idx + 1, score + (correct ? 1 : 0)));
      ex.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    })
  );
  area.scrollIntoView({ behavior: 'smooth' });
}

/* ---------- 이벤트 바인딩 ---------- */
$('#btnStart').addEventListener('click', () => { showScreen('screen-menu'); renderMenuBadges(); });

$$('.menu-card').forEach((card) =>
  card.addEventListener('click', () => {
    const m = card.dataset.module;
    if (m === 'explore') startExplore();
    else if (m === 'procedure') startProcedure();
    else if (m === 'kiosk') openKiosk(null);
    else if (m === 'scenario') startScenario();
    else if (m === 'quiz') startLearn();
  })
);

$('#btnSimBack').addEventListener('click', () => {
  $('#infoPanel').classList.remove('show');
  $('#procPanel').classList.remove('show');
  showScreen('screen-menu');
});
$('#btnLearnBack').addEventListener('click', () => showScreen('screen-menu'));
$('#btnScnBack').addEventListener('click', () => showScreen('screen-menu'));
$('#btnRecordBack').addEventListener('click', () => showScreen('screen-menu'));
$('#btnKioskClose').addEventListener('click', closeKiosk);
$('#btnMenuHome').addEventListener('click', () => showScreen('screen-start'));

renderMenuBadges();
showScreen('screen-start');
