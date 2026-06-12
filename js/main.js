/* =========================================================
 * 앱 컨트롤러 — 화면 전환, 탐색/절차 모드, 키오스크, 퀴즈
 * ========================================================= */
import { STATIONS, PROCEDURE, RULES, QUIZ } from './data.js';
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
  const step = PROCEDURE[procIdx];
  const panel = $('#procPanel');
  panel.classList.remove('show');

  const render = () => {
    panel.innerHTML = `
      <div class="panel-grip"></div>
      <div class="proc-progress">
        ${PROCEDURE.map((_, i) =>
          `<span class="dot ${i < procIdx ? 'dot-done' : ''} ${i === procIdx ? 'dot-now' : ''}"></span>`).join('')}
      </div>
      <h3>${step.title}</h3>
      <ul class="panel-list">${step.desc.map((d) => `<li>${d}</li>`).join('')}</ul>
      <div class="check-grid">
        ${step.checklist.map((c, i) => `
          <label class="check-item"><input type="checkbox" data-chk="${i}"><span>${c}</span></label>`).join('')}
      </div>
      <div class="caution-box">⚠️ ${step.caution}</div>
      ${step.kioskFlow ? `<button class="btn btn-primary btn-block" id="procKiosk">🖥️ 키오스크로 직접 해보기</button>` : ''}
      <div class="proc-nav">
        <button class="btn btn-ghost" id="procPrev" ${procIdx === 0 ? 'disabled' : ''}>← 이전</button>
        <span class="proc-count">${procIdx + 1} / ${PROCEDURE.length}</span>
        <button class="btn btn-primary" id="procNext">${procIdx === PROCEDURE.length - 1 ? '완료 🎉' : '다음 →'}</button>
      </div>`;
    $('#procPrev').addEventListener('click', () => { if (procIdx > 0) { procIdx--; showProcStep(); } });
    $('#procNext').addEventListener('click', () => {
      if (procIdx === PROCEDURE.length - 1) { finishProcedure(); return; }
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

function finishProcedure() {
  markDone('procedure');
  $('#procPanel').innerHTML = `
    <div class="panel-grip"></div>
    <div class="finish-box">
      <div class="finish-icon">🎉</div>
      <h3>진료 동행 절차 학습 완료!</h3>
      <p>사전 준비부터 귀가 동행·결과 전달까지 9단계를 모두 살펴보았습니다.<br>
      실제 동행 전에 <b>핵심 수칙</b>과 <b>학습 점검 퀴즈</b>도 꼭 확인해 보세요.</p>
      <div class="proc-nav">
        <button class="btn btn-ghost" id="procAgain">처음부터 다시</button>
        <button class="btn btn-primary" id="procToMenu">메뉴로</button>
      </div>
    </div>`;
  $('#procAgain').addEventListener('click', startProcedure);
  $('#procToMenu').addEventListener('click', () => showScreen('screen-menu'));
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

/* ---------- 이벤트 바인딩 ---------- */
$('#btnStart').addEventListener('click', () => { showScreen('screen-menu'); renderMenuBadges(); });

$$('.menu-card').forEach((card) =>
  card.addEventListener('click', () => {
    const m = card.dataset.module;
    if (m === 'explore') startExplore();
    else if (m === 'procedure') startProcedure();
    else if (m === 'kiosk') openKiosk(null);
    else if (m === 'quiz') startLearn();
  })
);

$('#btnSimBack').addEventListener('click', () => {
  $('#infoPanel').classList.remove('show');
  $('#procPanel').classList.remove('show');
  showScreen('screen-menu');
});
$('#btnLearnBack').addEventListener('click', () => showScreen('screen-menu'));
$('#btnKioskClose').addEventListener('click', closeKiosk);
$('#btnMenuHome').addEventListener('click', () => showScreen('screen-start'));

renderMenuBadges();
showScreen('screen-start');
