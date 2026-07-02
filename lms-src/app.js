/* =============================================================================
 *  배움터 LMS 직무교육 통계 - UI (app.js)
 *  전역 XLSX(SheetJS), LMS(compute.js)를 사용. 모든 처리는 브라우저 로컬에서만 수행.
 * ========================================================================== */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var el = function (t, a, h) { var e = document.createElement(t); if (a) for (var k in a) { if (k === 'class') e.className = a[k]; else if (k === 'html') e.innerHTML = a[k]; else e.setAttribute(k, a[k]); } if (h != null) e.textContent = h; return e; };
  var fmt = function (n) { return (n == null ? 0 : n).toLocaleString('ko-KR'); };
  var pct = function (n) { return (n == null ? 0 : n).toFixed(1) + '%'; };
  var tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

  // 필요한 학생 컬럼만 보관(메모리 절약)
  var SCOLS = ['카테고리', '과정명', '교육차시', '교육신청일', '진도율', '점수', '수료여부', '수료일', '상태', 'ID', '성명', '기관코드', '기관명', '시도', '시군구', '사용자유형', '자격번호', '연도/차수'];
  // 모든 열이 완전히 동일한 행 제거(같은 파일 중복 업로드/원본 중복행 방지)
  function dedupeRows(rows) {
    var seen = new Set(), out = []; var SEP = String.fromCharCode(1);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], s = '';
      for (var c = 0; c < SCOLS.length; c++) { var v = r[SCOLS[c]]; s += (v == null ? '' : v) + SEP; }
      if (!seen.has(s)) { seen.add(s); out.push(r); }
    }
    return out;
  }
  var MCOLS = ['No', '시도', '시군구', '읍면동', '기관코드', '기관명', '성명', 'ID', '사용자유형', '권한관리자', '일반', '중점', '특화', '퇴원', '고도화', '선임여부', '교육대상여부', '교육구분', '상태'];

  var state = {
    members: null, memberMeta: null,
    students: [], studentFiles: [],
    studentByID: null, result: null, coverage: null,
    config: JSON.parse(JSON.stringify(LMS.DEFAULT_CONFIG)),
    decisions: {}, // 직군변경 보류 검토 결정 { ID: 'approve'|'reject' }
    activeTab: 'summary'
  };

  /* ---------- IndexedDB (회원정보/설정 영구 저장) ----------------------- */
  var DB;
  function idb() {
    return new Promise(function (res, rej) {
      if (DB) return res(DB);
      var rq = indexedDB.open('lms-stats', 1);
      rq.onupgradeneeded = function (e) { var db = e.target.result; if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); };
      rq.onsuccess = function () { DB = rq.result; res(DB); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function idbSet(k, v) { return idb().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); }); }
  function idbGet(k) { return idb().then(function (db) { return new Promise(function (res) { var tx = db.transaction('kv', 'readonly'); var rq = tx.objectStore('kv').get(k); rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { res(null); }; }); }); }

  /* ---------- 오버레이 ------------------------------------------------- */
  var ov = { box: null, msg: null, sub: null, bar: null };
  function showOv(msg, sub) { ov.box.classList.add('on'); ov.msg.textContent = msg || '처리 중...'; ov.sub.textContent = sub || ''; ov.bar.style.width = '0%'; }
  function setOv(msg, sub, p) { if (msg != null) ov.msg.textContent = msg; if (sub != null) ov.sub.textContent = sub; if (p != null) ov.bar.style.width = p + '%'; }
  function hideOv() { ov.box.classList.remove('on'); }

  /* ---------- 파일 파싱 ------------------------------------------------ */
  // 헤더행 자동탐지: 'ID' 셀을 포함하는 첫 행
  function findHeaderRow(aoa) {
    for (var i = 0; i < Math.min(aoa.length, 12); i++) {
      var row = aoa[i] || [];
      for (var c = 0; c < row.length; c++) { if (String(row[c]).trim() === 'ID') return i; }
    }
    return 0;
  }
  function aoaToObjects(aoa, keepCols) {
    var h = findHeaderRow(aoa);
    var header = (aoa[h] || []).map(function (x) { return String(x == null ? '' : x).trim(); });
    var keep = keepCols ? {} : null; if (keepCols) keepCols.forEach(function (k) { keep[k] = 1; });
    var idxs = []; for (var c = 0; c < header.length; c++) { if (!keep || keep[header[c]]) idxs.push(c); }
    var out = [];
    for (var i = h + 1; i < aoa.length; i++) {
      var r = aoa[i]; if (!r) continue;
      var has = false, o = {};
      for (var k = 0; k < idxs.length; k++) { var ci = idxs[k]; var v = r[ci]; if (v !== '' && v != null) has = true; o[header[ci]] = (v == null ? '' : v); }
      if (has) out.push(o);
    }
    return out;
  }
  // SheetJS(Blob) 로드 완료 대기
  function whenXLSX() { return new Promise(function (res, rej) { if (typeof XLSX !== 'undefined' || window.__XLSX_READY) return res(); if (window.__XLSX_ERR) return rej(new Error('SheetJS 로드 실패 — 파일이 손상되지 않았는지 확인하세요')); var to = setTimeout(function () { rej(new Error('SheetJS 로드 시간 초과')); }, 15000); document.addEventListener('xlsx-ready', function () { clearTimeout(to); res(); }, { once: true }); }); }
  function parseWorkbook(buf, keepCols) {
    var wb = XLSX.read(buf, { type: 'array', cellDates: false, cellNF: false, raw: false, dense: true });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
    return aoaToObjects(aoa, keepCols);
  }

  /* ---------- 회원정보 로드 ------------------------------------------- */
  function loadMemberFiles(files) {
    files = Array.prototype.slice.call(files).filter(Boolean);
    if (!files.length) return;
    showOv('회원정보 읽는 중...', files[0].name);
    var all = [];
    var chain = whenXLSX();
    files.forEach(function (f, i) {
      chain = chain.then(function () { setOv('회원정보 읽는 중...', '(' + (i + 1) + '/' + files.length + ') ' + f.name, 10 + 70 * i / files.length); return f.arrayBuffer(); })
        .then(function (buf) { return tick().then(function () { all = all.concat(parseWorkbook(buf, MCOLS)); }); });
    });
    return chain.then(function () {
      if (all.length && !('교육대상여부' in all[0]) && !('교육구분' in all[0])) { hideOv(); alert('이 파일은 회원정보가 아닌 것 같습니다.\n‘교육대상여부/교육구분’ 열을 찾지 못했습니다. 올바른 회원정보 파일인지 확인해 주세요.'); }
      state.members = all;
      state.memberMeta = { count: all.length, filename: files.map(function (f) { return f.name; }).join(', '), loadedAt: new Date().toISOString() };
      setOv('회원정보 저장 중...', '', 90);
      return idbSet('members', all).then(function () { return idbSet('memberMeta', state.memberMeta); });
    }).then(function () { renderStatus(); return recompute(); }).then(hideOv)
      .catch(function (e) { hideOv(); alert('회원정보 읽기 오류: ' + e.message); });
  }

  /* ---------- 수강생목록 로드 ---------------------------------------- */
  function loadStudentFiles(files, append) {
    files = Array.prototype.slice.call(files).filter(Boolean);
    if (!files.length) return;
    if (!append) { state.students = []; state.studentFiles = []; }
    showOv('수강생목록 읽는 중...', files[0].name);
    var chain = whenXLSX();
    files.forEach(function (f, i) {
      chain = chain.then(function () { setOv('수강생목록 파싱 중...', '(' + (i + 1) + '/' + files.length + ') ' + f.name + ' — 잠시만 기다려 주세요', 5 + 80 * i / files.length); return f.arrayBuffer(); })
        .then(function (buf) {
          return tick().then(function () {
            var rows = parseWorkbook(buf, SCOLS);
            state.students = state.students.concat(rows);
            state.studentFiles.push({ name: f.name, rows: rows.length });
          });
        });
    });
    return chain.then(function () {
      if (state.students.length && !('과정명' in state.students[0])) { hideOv(); alert('이 파일은 수강생목록(온라인통합수강생목록)이 아닌 것 같습니다.\n‘과정명’ 열을 찾지 못했습니다. 올바른 원데이터 파일인지 확인해 주세요.'); }
      setOv('중복 행 정리 중...', '', 88);
      var before = state.students.length;
      state.students = dedupeRows(state.students);        // 완전 동일 행 제거(중복 업로드/원본 중복행)
      state.dupRemoved = before - state.students.length;
      state.coverage = state.students.length ? LMS.coverage(state.students) : null;
      setOv('통계 집계 중...', state.students.length.toLocaleString() + '행', 92); return tick();
    })
      .then(function () { renderStatus(); return recompute(); }).then(hideOv)
      .catch(function (e) { hideOv(); alert('수강생목록 읽기 오류: ' + e.message); });
  }

  /* ---------- 집계 ---------------------------------------------------- */
  function recompute() {
    return Promise.resolve().then(function () {
      if (!state.members || !state.students.length) { state.result = null; renderTab(); return; }
      // ID 인덱스(개인조회용)
      state.studentByID = new Map();
      for (var i = 0; i < state.students.length; i++) { var id = String(state.students[i].ID || '').trim(); if (!id) continue; var a = state.studentByID.get(id); if (!a) { a = []; state.studentByID.set(id, a); } a.push(state.students[i]); }
      var cfg = Object.assign({}, state.config, { decisions: state.decisions });
      state.result = LMS.analyze(state.members, state.students, cfg);
      renderTab();
    });
  }

  /* ---------- 상태바 -------------------------------------------------- */
  function renderStatus() {
    var sb = $('#statusbar'); sb.innerHTML = '';
    if (state.memberMeta) {
      var d = new Date(state.memberMeta.loadedAt);
      sb.appendChild(el('div', { class: 'stat' }, '')).innerHTML = '회원정보 <b>' + fmt(state.memberMeta.count) + '명</b> · ' + d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
    } else sb.appendChild(el('div', { class: 'stat empty' }, '회원정보 미등록'));
    if (state.studentFiles.length) {
      sb.appendChild(el('div', { class: 'stat' })).innerHTML = '수강데이터 <b>' + fmt(state.students.length) + '행</b> · ' + state.studentFiles.length + '개 파일';
      if (state.coverage) sb.appendChild(el('div', { class: 'stat' })).innerHTML = '데이터 ' + (state.coverage.summary.연도.join('·') || '') + '년 <b>최신 ' + state.coverage.summary.최신차수 + '차</b>';
      if (state.dupRemoved) sb.appendChild(el('div', { class: 'stat' })).innerHTML = '중복행 <b>' + fmt(state.dupRemoved) + '건</b> 자동제거';
    } else sb.appendChild(el('div', { class: 'stat empty' }, '수강데이터 미등록'));
    if (state.result) sb.appendChild(el('div', { class: 'stat' })).innerHTML = '전체 이수율 <b>' + pct(state.result.kpi.이수율) + '</b>';
  }

  /* ---------- 공통: 정렬 가능한 페이지네이션 테이블 ------------------- */
  function dataTable(container, columns, rows, opts) {
    opts = opts || {}; var pageSize = opts.pageSize || 50; var page = { i: 0 }; var sort = { key: opts.sortKey || null, dir: opts.sortDir || -1 };
    var wrap = el('div'); var tw = el('div', { class: 'tablewrap' }); var table = el('table');
    var thead = el('thead'); var tbody = el('tbody'); table.appendChild(thead); table.appendChild(tbody); tw.appendChild(table); wrap.appendChild(tw);
    var pager = el('div', { class: 'pager' }); wrap.appendChild(pager);
    function render() {
      var data = rows;
      if (sort.key) { data = rows.slice().sort(function (a, b) { var x = a[sort.key], y = b[sort.key]; if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir; return String(x).localeCompare(String(y), 'ko') * sort.dir; }); }
      var pages = Math.max(1, Math.ceil(data.length / pageSize)); if (page.i >= pages) page.i = pages - 1;
      thead.innerHTML = ''; var htr = el('tr');
      columns.forEach(function (c) { var th = el('th', { class: (c.num ? 'num ' : '') + (c.sortable === false ? 'no' : '') }, c.label + (sort.key === c.key ? (sort.dir < 0 ? ' ▾' : ' ▴') : '')); if (c.sortable !== false) th.onclick = function () { if (sort.key === c.key) sort.dir = -sort.dir; else { sort.key = c.key; sort.dir = c.num ? -1 : 1; } render(); }; htr.appendChild(th); });
      thead.appendChild(htr);
      tbody.innerHTML = '';
      var slice = data.slice(page.i * pageSize, page.i * pageSize + pageSize);
      slice.forEach(function (r) { var tr = el('tr'); columns.forEach(function (c) { var td = el('td', { class: c.num ? 'num' : '' }); if (c.render) { var o = c.render(r[c.key], r); if (o instanceof Node) td.appendChild(o); else td.innerHTML = o; } else td.textContent = (r[c.key] == null ? '' : r[c.key]); tr.appendChild(td); }); tbody.appendChild(tr); });
      pager.innerHTML = '';
      pager.appendChild(el('span', {}, '총 ' + fmt(data.length) + '건'));
      var prev = el('button', {}, '이전'); prev.disabled = page.i === 0; prev.onclick = function () { page.i--; render(); };
      var info = el('span', {}, (page.i + 1) + ' / ' + pages);
      var next = el('button', {}, '다음'); next.disabled = page.i >= pages - 1; next.onclick = function () { page.i++; render(); };
      pager.appendChild(prev); pager.appendChild(info); pager.appendChild(next);
    }
    render(); container.appendChild(wrap); return { rerender: render };
  }
  function barCell(p) { var cls = p >= 80 ? 'g' : (p >= 50 ? '' : (p >= 30 ? 'w' : 'r')); return '<div style="display:flex;align-items:center"><div class="bar ' + cls + '"><span style="width:' + Math.min(100, p) + '%"></span></div><span class="barlab">' + p.toFixed(1) + '%</span></div>'; }
  function yn(v) { return v ? '<span class="pill y">이수</span>' : '<span class="pill n">미이수</span>'; }

  /* ---------- 내보내기 (엑셀/CSV) ------------------------------------ */
  function exportRows(rows, columns, filename, sheetName) {
    var aoa = [columns.map(function (c) { return c.label; })];
    rows.forEach(function (r) { aoa.push(columns.map(function (c) { var v = r[c.key]; if (c.exp) v = c.exp(r[c.key], r); return v == null ? '' : v; })); });
    var ws = XLSX.utils.aoa_to_sheet(aoa); var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet1');
    XLSX.writeFile(wb, filename);
  }
  function expBtn(rows, columns, filename, label) { var b = el('button', { class: 'btn sec sm' }, label || '엑셀 다운로드'); b.onclick = function () { if (!rows.length) { alert('내보낼 데이터가 없습니다.'); return; } exportRows(rows, columns, filename); }; return b; }

  // 한 사람(ID)의 이수 판정 진단 데이터(작은 JSON) 내보내기 — 원인 파악용 공유
  function exportPersonDiag(p, recs, mask) {
    var mem = null, mid = p.ID;
    if (state.members) { for (var i = 0; i < state.members.length; i++) { if (String(state.members[i].ID).trim() === mid) { mem = state.members[i]; break; } } }
    mem = mem || {};
    function mk(v) { return mask ? '***' : (v == null ? '' : v); }
    var relChasi = {};
    recs.forEach(function (r) { if (String(r['카테고리']) === '직무교육(선택)') { var b = LMS.selBase(r['과정명']); relChasi[b] = (state.config.chasi && state.config.chasi[b] != null) ? state.config.chasi[b] : '(미매핑=0)'; } });
    var out = {
      도구버전: 'ver4', 생성시각: new Date().toISOString(), 개인정보가림: !!mask,
      판정결과: {
        이수: p.이수, 미이수사유: p.사유 || '', 필수수료: p.필수수료,
        선택차시합계: p.선택차시, 필요선택차시: p.필요차시,
        직군_현재: p.직군, 직군_정규화: p.직군정규화, 경력구분: p.경력, 기준정의: p.기준정의,
        보류후보: p.보류후보, 보류상태: p.보류상태, 당시직군: p.당시직군 || '', 승인시이수: p.승인시이수
      },
      회원정보: {
        ID: mask ? 'MASKED-ID' : mid, 성명: mk(p.성명),
        시도: p.시도, 시군구: p.시군구, 기관코드: mask ? '***' : (mem['기관코드'] || ''), 기관명: mk(mem['기관명']),
        사용자유형: mem['사용자유형'] || '', 교육구분: mem['교육구분'] || '', 교육대상여부: mem['교육대상여부'] || '', 회원상태: mem['상태'] || '', 선임여부: mem['선임여부'] || ''
      },
      적용규칙: { 경력자_선택차시기준: state.config.thresholds, 대상시도: state.config.allowedSido, 이_사람_선택과목_차시: relChasi },
      수강이력: recs.map(function (r) {
        return { 카테고리: r['카테고리'], 과정명: r['과정명'], 연도차수: r['연도/차수'] || '', 교육차시: r['교육차시'], 진도율: r['진도율'], 점수: r['점수'], 수료여부: r['수료여부'], 수료일: r['수료일'], 상태: r['상태'], 당시사용자유형: r['사용자유형'] };
      })
    };
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = '진단_' + (mask ? 'masked' : mid) + '.json'; document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- 탭 렌더 ------------------------------------------------- */
  var TABS = [
    ['summary', '요약'], ['coverage', '데이터 현황'], ['rates', '이수율 현황'], ['notdone', '이수자·미이수자 명단'],
    ['noexam', '미응시·재응시'], ['pending', '보류·직군변경'], ['dup', '중복자 확인'], ['courses', '과목별 현황'], ['person', '개인 조회'], ['settings', '설정·도움말']
  ];
  function renderTabsBar() {
    var t = $('#tabs'); t.innerHTML = '';
    TABS.forEach(function (x) { var b = el('button', { class: 'tab' + (state.activeTab === x[0] ? ' on' : '') }, x[1]); b.onclick = function () { state.activeTab = x[0]; renderTabsBar(); renderTab(); }; t.appendChild(b); });
  }
  function renderTab() {
    renderStatus();
    var c = $('#content'); c.innerHTML = '';
    if (state.activeTab === 'settings') return renderSettings(c);
    if (state.activeTab === 'person') return renderPerson(c);
    if (state.activeTab === 'coverage') return renderCoverage(c);
    if (!state.result) { c.appendChild(emptyState()); return; }
    if (state.activeTab === 'summary') return renderSummary(c);
    if (state.activeTab === 'rates') return renderRates(c);
    if (state.activeTab === 'notdone') return renderNotDone(c);
    if (state.activeTab === 'noexam') return renderNoExam(c);
    if (state.activeTab === 'pending') return renderPending(c);
    if (state.activeTab === 'dup') return renderDuplicates(c);
    if (state.activeTab === 'courses') return renderCourses(c);
  }
  function emptyState() {
    var d = el('div', { class: 'empty-state' });
    d.innerHTML = '<div class="big">📂</div><div><b>회원정보</b>와 <b>수강생목록</b>을 올리면 통계가 자동으로 계산됩니다.</div><div class="muted" style="margin-top:6px">위의 업로드 영역에 파일을 끌어다 놓거나 “파일 선택”을 누르세요.</div>';
    return d;
  }

  function kpiCard(lab, val, cls, sub) { var d = el('div', { class: 'kpi ' + (cls || '') }); d.appendChild(el('div', { class: 'lab' }, lab)); var v = el('div', { class: 'val' }); v.innerHTML = val + (sub ? ' <small>' + sub + '</small>' : ''); d.appendChild(v); return d; }

  function renderSummary(c) {
    var k = state.result.kpi;
    var kp = el('div', { class: 'kpis' });
    kp.appendChild(kpiCard('교육대상자', fmt(k.대상자) + '<small>명</small>', 'accent'));
    kp.appendChild(kpiCard('이수자', fmt(k.이수자) + '<small>명</small>', 'good'));
    kp.appendChild(kpiCard('미이수자', fmt(k.미이수자) + '<small>명</small>', 'bad'));
    kp.appendChild(kpiCard('전체 이수율', pct(k.이수율), 'accent'));
    kp.appendChild(kpiCard('재응시 필요(미응시)', fmt(k.재응시필요인원) + '<small>명</small>', 'warn', '진도100·점수0'));
    c.appendChild(kp);

    var note = el('div', { class: 'note info' });
    note.innerHTML = '집계 기준: <b>16개 시도</b>(중앙·미상 제외) · 교육대상여부 <b>Y</b> · 회원상태 <b>정상</b>인 <b>생활지원사·전담사회복지사</b> 대상. ' +
      '신규자=필수 수료 / 경력자=필수 수료+선택 차시(생활 13·전담 10) 충족 시 <b>이수</b>. 수강취소 ' + fmt(k.수강취소제외) + '건 제외. ' +
      (k.기준미정의대상 ? '이수기준 미정의(중간관리자/기타 등) ' + fmt(k.기준미정의대상) + '명은 별도(설정·도움말 참고).' : '');
    c.appendChild(note);
    if (k.지역외제외) { var nr = el('div', { class: 'note' }); nr.innerHTML = '16개 시도 외(중앙·미상 등)라서 통계에서 제외된 교육대상 인원: <b>' + fmt(k.지역외제외) + '명</b> (대상 시도는 설정에서 변경 가능).'; c.appendChild(nr); }
    if (k.보류미검토) { var np = el('div', { class: 'note' }); np.innerHTML = '직군 변경(전직) 가능성으로 <b>검토 대기</b> 중인 건: <b>' + fmt(k.보류미검토) + '명</b> — <b>보류·직군변경</b> 탭에서 승인/반려해 주세요. (현재 미이수로 집계됨)'; c.appendChild(np); }
    if (k.대상자중수강기록없음) {
      var n2 = el('div', { class: 'note' }); n2.innerHTML = '교육대상자 중 수강 기록이 전혀 없는 인원: <b>' + fmt(k.대상자중수강기록없음) + '명</b> (전원 미이수로 집계됨 — 미수강 독려 대상).'; c.appendChild(n2);
    }
    var uk = Object.keys(state.result.unknownChasi || {});
    if (uk.length) { var n3 = el('div', { class: 'note' }); n3.innerHTML = '차시 매핑이 없는 선택과목 ' + uk.length + '건(테스트/신규 과목일 수 있음): ' + uk.slice(0, 6).join(', ') + '. <b>설정</b>에서 차시를 추가하면 경력자 이수 계산에 반영됩니다.'; c.appendChild(n3); }

    // 이수율 현황표 (배정·채용 인원 대비)
    c.appendChild(renderRateTable());

    // 직군/경력별 요약 카드
    var card = el('div', { class: 'card' });
    card.appendChild(el('h2', {}, '직군·경력별 이수 현황'));
    card.appendChild(el('p', { class: 'desc' }, '헤드라인 이수율 대상(생활지원사·전담사회복지사)'));
    var cols = [
      { key: 'key', label: '구분' },
      { key: '대상자', label: '대상자', num: true, render: function (v) { return fmt(v); } },
      { key: '이수자', label: '이수자', num: true, render: function (v) { return fmt(v); } },
      { key: '미이수자', label: '미이수자', num: true, render: function (v) { return fmt(v); } },
      { key: '이수율', label: '이수율', num: true, render: function (v) { return barCell(v); }, exp: function (v) { return v.toFixed(1); } }
    ];
    dataTable(card, cols, state.result.byGroup, { pageSize: 10, sortKey: '대상자' });
    c.appendChild(card);
  }

  function getAlloc() { if (!state.config.alloc) state.config.alloc = {}; return state.config.alloc; }
  function saveAllocAndRender() { idbSet('config', state.config); renderTab(); }
  function renderRateTable() {
    var bg = {}; state.result.byGroup.forEach(function (g) { bg[g.key] = g; });
    function cell(dir, car) { var g = bg[dir + ' / ' + car]; return g ? g : { 이수자: 0, 대상자: 0 }; }
    var DIRS = [['전담사회복지사', '전담사회복지사'], ['생활지원사', '생활지원사']];
    var alloc = getAlloc();
    var rows = DIRS.map(function (d) {
      var nv = cell(d[0], '신규자'), ex = cell(d[0], '경력자');
      var a = nv.이수자 + ex.이수자; var target = nv.대상자 + ex.대상자;
      var al = alloc[d[0]] || {}; var B = parseInt(al.배정) || 0, C = parseInt(al.채용) || 0;
      return { dir: d[0], 신규: nv.이수자, 경력: ex.이수자, 소계: a, 교육대상: target, 배정: B, 채용: C };
    });
    var tot = rows.reduce(function (o, r) { return { 신규: o.신규 + r.신규, 경력: o.경력 + r.경력, 소계: o.소계 + r.소계, 교육대상: o.교육대상 + r.교육대상, 배정: o.배정 + r.배정, 채용: o.채용 + r.채용 }; }, { 신규: 0, 경력: 0, 소계: 0, 교육대상: 0, 배정: 0, 채용: 0 });

    var card = el('div', { class: 'card' });
    var head = el('div', { class: 'head' });
    head.appendChild(el('div', { html: '<h2>이수율 현황표</h2><p class="desc">교육대상·배정인원(B)·채용인원(C) 대비 이수율. 배정/채용 인원은 직접 입력하세요.</p>' }));
    var expBtnRows = rows.concat([{ dir: '총계', 신규: tot.신규, 경력: tot.경력, 소계: tot.소계, 교육대상: tot.교육대상, 배정: tot.배정, 채용: tot.채용 }]).map(function (r) {
      return { 직군: r.dir, 신규자: r.신규, 경력자: r.경력, 이수소계: r.소계, 교육대상: r.교육대상, 배정인원: r.배정, 채용인원: r.채용,
        대상대비: r.교육대상 ? (100 * r.소계 / r.교육대상).toFixed(1) : '', 배정대비: r.배정 ? (100 * r.소계 / r.배정).toFixed(1) : '', 채용대비: r.채용 ? (100 * r.소계 / r.채용).toFixed(1) : '' };
    });
    head.appendChild(expBtn(expBtnRows, [
      { key: '직군', label: '직군' }, { key: '신규자', label: '신규자' }, { key: '경력자', label: '경력자' }, { key: '이수소계', label: '이수인원(A)' },
      { key: '교육대상', label: '교육대상' }, { key: '배정인원', label: '배정인원(B)' }, { key: '채용인원', label: '채용인원(C)' },
      { key: '대상대비', label: '대상대비(%)' }, { key: '배정대비', label: 'A/B(%)' }, { key: '채용대비', label: 'A/C(%)' }
    ], '이수율_현황표.xlsx'));
    card.appendChild(head);

    var hd = el('div', { class: 'note info' });
    hd.innerHTML = '(이수인원) 총 <b>' + fmt(tot.소계) + '명</b> (전담사회복지사 ' + fmt(rows[0].소계) + '명, 생활지원사 ' + fmt(rows[1].소계) + '명)';
    card.appendChild(hd);

    var tw = el('div', { class: 'tablewrap' }); var table = el('table');
    table.innerHTML = '<thead>' +
      '<tr><th rowspan="2">직군</th><th colspan="3" style="text-align:center">이수인원(A)</th><th rowspan="2" class="num">교육대상</th><th rowspan="2" class="num">배정인원(B)</th><th rowspan="2" class="num">채용인원(C)</th><th rowspan="2" class="num">대상대비</th><th rowspan="2" class="num">A/B</th><th rowspan="2" class="num">A/C</th></tr>' +
      '<tr><th class="num">신규자</th><th class="num">경력자</th><th class="num">소계</th></tr></thead>';
    var tb = el('tbody'); table.appendChild(tb);
    function ratio(a, b) { return b ? (100 * a / b).toFixed(1) : '-'; }
    function dataRow(r, isTotal) {
      var tr = el('tr'); if (isTotal) { tr.style.fontWeight = '700'; tr.style.background = '#f7f9fc'; }
      tr.appendChild(el('td', isTotal ? { style: 'font-weight:700' } : {}, r.dir));
      tr.appendChild(el('td', { class: 'num' }, fmt(r.신규)));
      tr.appendChild(el('td', { class: 'num' }, fmt(r.경력)));
      tr.appendChild(el('td', { class: 'num' }, fmt(r.소계)));
      tr.appendChild(el('td', { class: 'num' }, fmt(r.교육대상)));
      // 배정/채용 입력 (총계 행은 합계 표시만)
      if (isTotal) { tr.appendChild(el('td', { class: 'num' }, fmt(r.배정))); tr.appendChild(el('td', { class: 'num' }, fmt(r.채용))); }
      else {
        ['배정', '채용'].forEach(function (kk) {
          var td = el('td', { class: 'num' });
          var inp = el('input', { type: 'number', value: (alloc[r.dir] && alloc[r.dir][kk]) || '', style: 'width:84px;text-align:right' });
          inp.placeholder = '0';
          inp.onchange = function () { if (!alloc[r.dir]) alloc[r.dir] = {}; alloc[r.dir][kk] = parseInt(inp.value) || 0; saveAllocAndRender(); };
          td.appendChild(inp); tr.appendChild(td);
        });
      }
      tr.appendChild(el('td', { class: 'num' }, ratio(r.소계, r.교육대상)));
      tr.appendChild(el('td', { class: 'num' }, ratio(r.소계, r.배정)));
      tr.appendChild(el('td', { class: 'num' }, ratio(r.소계, r.채용)));
      return tr;
    }
    rows.forEach(function (r) { tb.appendChild(dataRow(r, false)); });
    tb.appendChild(dataRow({ dir: '총계', 신규: tot.신규, 경력: tot.경력, 소계: tot.소계, 교육대상: tot.교육대상, 배정: tot.배정, 채용: tot.채용 }, true));
    tw.appendChild(table); card.appendChild(tw);
    var noteWrap = el('div', { class: 'toolbar', style: 'margin-top:8px' });
    noteWrap.appendChild(el('span', { class: 'hint' }, '※ 배정·채용인원 기준일/메모:'));
    var noteInp = el('input', { type: 'text', value: state.config.allocNote || '', placeholder: "예: 모인우리 '26.3.31. 기준", style: 'min-width:280px' });
    noteInp.onchange = function () { state.config.allocNote = noteInp.value; idbSet('config', state.config); };
    noteWrap.appendChild(noteInp); card.appendChild(noteWrap);
    return card;
  }

  function renderRates(c) {
    // 시도별
    var card = el('div', { class: 'card' });
    var head = el('div', { class: 'head' });
    head.appendChild(el('div', { html: '<h2>시도별 이수 현황</h2><p class="desc">행을 클릭하면 시군구 → 기관으로 펼쳐집니다</p>' }));
    head.appendChild(expBtn(state.result.bySido, [
      { key: 'key', label: '시도' }, { key: '대상자', label: '대상자' }, { key: '이수자', label: '이수자' }, { key: '미이수자', label: '미이수자' }, { key: '이수율', label: '이수율(%)', exp: function (v) { return v.toFixed(1); } }
    ], '시도별_이수현황.xlsx'));
    card.appendChild(head);
    // 트리 테이블 (시도 → 시군구 → 기관, 펼치기/접기)
    var tw = el('div', { class: 'tablewrap' }); var table = el('table', { class: 'tree' });
    table.innerHTML = '<thead><tr><th>지역 / 기관</th><th class="num">대상자</th><th class="num">이수자</th><th class="num">미이수</th><th class="num" style="min-width:160px">이수율</th></tr></thead>';
    var tb = el('tbody'); table.appendChild(tb);
    var tree = state.result.sidoTree; // Map
    function sortedEntries(map) { var a = []; map.forEach(function (v, k) { a.push([k, v]); }); a.sort(function (x, y) { return y[1].tot - x[1].tot; }); return a; }
    function treeRow(label, node, depth, foldable) {
      var tr = el('tr'); if (depth === 0) tr.className = 'foldhead';
      var td = el('td', { style: 'padding-left:' + (10 + depth * 16) + 'px' + (foldable ? ';cursor:pointer' : '') + (depth === 0 ? ';font-weight:700' : '') });
      if (foldable) { var ar = el('span', {}, '▸'); ar.style.marginRight = '5px'; ar.style.color = '#8a97ab'; td.appendChild(ar); tr._arrow = ar; }
      td.appendChild(document.createTextNode(label));
      tr.appendChild(td);
      tr.appendChild(el('td', { class: 'num' }, fmt(node.tot)));
      tr.appendChild(el('td', { class: 'num' }, fmt(node.done)));
      tr.appendChild(el('td', { class: 'num' }, fmt(node.tot - node.done)));
      var b = el('td'); b.innerHTML = barCell(node.tot ? 100 * node.done / node.tot : 0); tr.appendChild(b);
      tr._kids = []; tr._open = false;
      return tr;
    }
    function collapse(tr) { tr._kids.forEach(function (k) { if (k._open) collapse(k); k.remove(); }); tr._kids = []; tr._open = false; if (tr._arrow) tr._arrow.textContent = '▸'; }
    function makeNode(key, node, depth) {
      var foldable = depth < 2 && node.child && node.child.size > 0;
      var tr = treeRow(key, node, depth, foldable);
      if (foldable) tr.onclick = function (e) {
        e.stopPropagation();
        if (tr._open) { collapse(tr); return; }
        var after = tr;
        sortedEntries(node.child).forEach(function (it) { var ctr = makeNode(it[0], it[1], depth + 1); after.after(ctr); after = ctr; tr._kids.push(ctr); });
        tr._open = true; if (tr._arrow) tr._arrow.textContent = '▾';
      };
      return tr;
    }
    sortedEntries(tree).forEach(function (sd) { tb.appendChild(makeNode(sd[0], sd[1], 0)); });
    tw.appendChild(table); card.appendChild(tw);
    c.appendChild(card);

    // 직군×경력 별(상세)
    var card2 = el('div', { class: 'card' });
    card2.appendChild(el('div', { class: 'head', html: '<div><h2>직군·경력별 이수율</h2></div>' }));
    dataTable(card2, [
      { key: 'key', label: '구분' }, { key: '대상자', label: '대상자', num: true, render: fmt }, { key: '이수자', label: '이수자', num: true, render: fmt },
      { key: '미이수자', label: '미이수자', num: true, render: fmt }, { key: '이수율', label: '이수율', num: true, render: function (v) { return barCell(v); } }
    ], state.result.byGroup, { pageSize: 10, sortKey: '대상자' });
    c.appendChild(card2);
  }

  function filterBar(c, fields, onChange) {
    var tb = el('div', { class: 'toolbar' });
    var sels = {};
    fields.forEach(function (f) {
      var lab = el('label', { class: 'fld' }, f.label);
      var s = el('select'); s.appendChild(el('option', { value: '' }, '전체'));
      f.options.forEach(function (o) { s.appendChild(el('option', { value: o }, o)); });
      s.onchange = onChange; lab.appendChild(s); sels[f.key] = s; tb.appendChild(lab);
    });
    if (c.searchKey) {
      var lab2 = el('label', { class: 'fld' }, c.searchLabel || '검색');
      var inp = el('input', { type: 'text', placeholder: c.searchPlaceholder || '' }); inp.oninput = onChange; lab2.appendChild(inp); tb.appendChild(lab2); sels.__search = inp;
    }
    return { node: tb, sels: sels };
  }
  function uniq(rows, key) { var s = {}; rows.forEach(function (r) { if (r[key] != null && r[key] !== '') s[r[key]] = 1; }); return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'ko'); }); }

  // 종사자 명단(이수자·미이수자) 공용 컬럼 — 시도·시군구·수행기관명·기관코드·직군(직급) 모두 포함
  function personListCols() {
    return [
      { key: 'ID', label: 'ID' }, { key: '성명', label: '성명' },
      { key: '시도', label: '시도' }, { key: '시군구', label: '시군구' },
      { key: '기관명', label: '수행기관명' }, { key: '기관코드', label: '기관코드' },
      { key: '직군', label: '직급' }, { key: '경력', label: '경력' },
      { key: '이수', label: '이수여부', render: function (v) { return v ? '<span class="pill y">이수</span>' : '<span class="pill n">미이수</span>'; }, exp: function (v) { return v ? '이수' : '미이수'; } },
      { key: '필수수료', label: '필수', render: function (v) { return v ? '<span class="pill y">수료</span>' : '<span class="pill n">미수료</span>'; }, exp: function (v) { return v ? '수료' : '미수료'; } },
      { key: '선택차시', label: '선택차시', num: true, render: function (v, r) { return r.경력 === '경력자' ? v + ' / ' + r.필요차시 : '-'; }, exp: function (v, r) { return r.경력 === '경력자' ? v : ''; } },
      { key: '사유', label: '미이수 사유' }
    ];
  }
  function renderNotDone(c) {
    var rows = (state.result.persons || []).filter(function (p) { return p.기준정의 && !(p.보류후보 && p.보류상태 === 'pending'); });
    var card = el('div', { class: 'card' });
    var cols = personListCols();
    var fb = filterBar({ searchKey: 1, searchLabel: '검색(ID·성명·기관)', searchPlaceholder: '예: 홍길동' }, [
      { key: '이수여부', label: '이수여부', options: ['이수자만', '미이수자만'] },
      { key: '시도', label: '시도', options: uniq(rows, '시도') },
      { key: '직군', label: '직군', options: uniq(rows, '직군') },
      { key: '경력', label: '경력', options: uniq(rows, '경력') }
    ], apply);
    // 기본값: 미이수자만(기존 동작 유지)
    fb.sels['이수여부'].value = '미이수자만';
    var head = el('div', { class: 'head' });
    head.appendChild(el('div', { html: '<h2>이수자·미이수자 명단</h2><p class="desc">대상자의 이수/미이수 현황. 이수여부 필터로 이수자 명단만 골라 다운로드할 수 있습니다.</p>' }));
    var expHolder = el('div'); head.appendChild(expHolder);
    card.appendChild(head); card.appendChild(fb.node);
    var tableHolder = el('div'); card.appendChild(tableHolder); c.appendChild(card);
    var filtered = rows;
    function apply() {
      var q = (fb.sels.__search.value || '').trim().toLowerCase();
      var iv = fb.sels['이수여부'].value;
      filtered = rows.filter(function (r) {
        if (iv === '이수자만' && !r.이수) return false;
        if (iv === '미이수자만' && r.이수) return false;
        if (fb.sels['시도'].value && r.시도 !== fb.sels['시도'].value) return false;
        if (fb.sels['직군'].value && r.직군 !== fb.sels['직군'].value) return false;
        if (fb.sels['경력'].value && r.경력 !== fb.sels['경력'].value) return false;
        if (q && (String(r.ID).toLowerCase().indexOf(q) < 0 && String(r.성명).toLowerCase().indexOf(q) < 0 && String(r.기관명).toLowerCase().indexOf(q) < 0)) return false;
        return true;
      });
      var fname = iv === '이수자만' ? '이수자명단.xlsx' : (iv === '미이수자만' ? '미이수자명단.xlsx' : '이수_미이수자명단.xlsx');
      tableHolder.innerHTML = ''; dataTable(tableHolder, cols, filtered, { pageSize: 50, sortKey: '시도', sortDir: 1 });
      expHolder.innerHTML = ''; expHolder.appendChild(expBtn(filtered, cols, fname, '엑셀 다운로드(' + fmt(filtered.length) + ')'));
    }
    apply();
  }

  function renderNoExam(c) {
    var rows = state.result.examNoShowRows;
    var card = el('div', { class: 'card' });
    var note = el('div', { class: 'note' });
    note.innerHTML = '<b>진도율 100% · 점수 0점</b> = 강의는 끝냈으나 <b>최종평가 미응시(또는 0점)</b>. ' +
      '“해당과목 완료”가 <b>아니오</b>면 재응시 안내가 필요합니다.';
    card.appendChild(note);
    var cols = [
      { key: 'ID', label: 'ID' }, { key: '성명', label: '성명' }, { key: '시도', label: '시도' }, { key: '시군구', label: '시군구' },
      { key: '기관명', label: '수행기관명' }, { key: '기관코드', label: '기관코드' }, { key: '직군', label: '직급' },
      { key: '차수', label: '차수', num: true, render: function (v) { return v == null ? '-' : v + '차'; }, exp: function (v) { return v; } },
      { key: '카테고리', label: '구분' }, { key: '과정명', label: '미응시 과목/과정' },
      { key: '진도율', label: '진도율', num: true, exp: function (v) { return v; } }, { key: '점수', label: '점수', num: true },
      { key: '해당과목완료', label: '해당과목 완료', render: function (v) { return v ? '<span class="pill y">예</span>' : '<span class="pill n">아니오</span>'; }, exp: function (v) { return v ? '예' : '아니오'; } },
      { key: '전체이수', label: '직무교육 이수', render: function (v) { return yn(v); }, exp: function (v) { return v ? '이수' : '미이수'; } },
      { key: '재응시필요', label: '재응시 필요', render: function (v) { return v ? '<span class="pill g">필요</span>' : '<span class="muted">-</span>'; }, exp: function (v) { return v ? '필요' : ''; } }
    ];
    var chasuOpts = uniq(rows, '차수').filter(function (x) { return x !== ''; }).sort(function (a, b) { return (+a) - (+b); }).map(function (x) { return x + '차'; });
    var fb = filterBar({ searchKey: 1, searchLabel: '검색(ID·성명·기관)' }, [
      { key: '차수', label: '차수', options: chasuOpts },
      { key: '이수여부', label: '직무교육 이수여부', options: ['이수자만', '미이수자만'] },
      { key: '재응시', label: '재응시 필요만', options: ['필요만'] },
      { key: '시도', label: '시도', options: uniq(rows, '시도') }
    ], apply);
    var head = el('div', { class: 'head' });
    head.appendChild(el('div', { html: '<h2>미응시자 / 재응시 안내 대상</h2><p class="desc">진도 100%·점수 0 (연 ' + fmt(rows.length) + '건). <b>차수</b>로 거른 뒤, <b>직무교육 이수</b>가 “미이수”인 사람만 재응시 대상입니다(이수자는 자동 제외).</p>' }));
    var expHolder = el('div'); head.appendChild(expHolder);
    card.appendChild(head); card.appendChild(fb.node);
    var tableHolder = el('div'); card.appendChild(tableHolder); c.appendChild(card);
    function apply() {
      var q = (fb.sels.__search.value || '').trim().toLowerCase();
      var cha = fb.sels['차수'].value ? parseInt(fb.sels['차수'].value) : null;
      var filtered = rows.filter(function (r) {
        if (cha != null && r.차수 !== cha) return false;
        if (fb.sels['이수여부'].value === '이수자만' && !r.전체이수) return false;
        if (fb.sels['이수여부'].value === '미이수자만' && r.전체이수) return false;
        if (fb.sels['시도'].value && r.시도 !== fb.sels['시도'].value) return false;
        if (fb.sels['재응시'].value && !r.재응시필요) return false;
        if (q && (String(r.ID).toLowerCase().indexOf(q) < 0 && String(r.성명).toLowerCase().indexOf(q) < 0 && String(r.기관명).toLowerCase().indexOf(q) < 0)) return false;
        return true;
      });
      tableHolder.innerHTML = ''; dataTable(tableHolder, cols, filtered, { pageSize: 50, sortKey: '재응시필요' });
      expHolder.innerHTML = ''; expHolder.appendChild(expBtn(filtered, cols, '미응시_재응시대상.xlsx', '엑셀 다운로드(' + fmt(filtered.length) + ')'));
    }
    apply();
  }

  function renderDuplicates(c) {
    var rows = state.result.duplicateRows || [];
    var k = state.result.kpi;
    var card = el('div', { class: 'card' });
    var note = el('div', { class: 'note' });
    note.innerHTML = '<b>하나의 ID</b>가 <b>같은 교육과정을 2회 이상 수료</b>한 건입니다(예: 같은 필수 과정을 서로 다른 차수에서 중복 수료). ' +
      'ID는 본인인증 기반 고유값이므로 동명이인·중복계정 문제는 없으며, 여기서는 <b>같은 과정의 중복 이수</b>만 점검합니다. ' +
      '<b>완전히 동일한 행(같은 파일 중복 업로드·원본 중복행)은 자동 제거</b>되므로, 여기 표시되는 건은 실제로 서로 다른 이수 기록입니다.';
    card.appendChild(note);
    var sum = el('div', { class: 'toolbar' });
    sum.innerHTML = '<span class="filechip">중복 수료 건수 <b>' + fmt(k.중복수료건수) + '</b></span><span class="filechip">해당 인원(ID) <b>' + fmt(k.중복수료인원) + '</b></span><span class="filechip">필수 <b>' + fmt(k.중복수료필수) + '</b></span><span class="filechip">선택 <b>' + fmt(k.중복수료선택) + '</b></span>';
    card.appendChild(sum);
    if (!rows.length) { card.appendChild(el('div', { class: 'empty-state', html: '<div class="big">✅</div>같은 과정을 2회 이상 수료한 중복 건이 없습니다.' })); c.appendChild(card); return; }
    var cols = [
      { key: 'ID', label: 'ID' }, { key: '성명', label: '성명' }, { key: '시도', label: '시도' }, { key: '시군구', label: '시군구' },
      { key: '기관명', label: '수행기관명' }, { key: '기관코드', label: '기관코드' }, { key: '직군', label: '직급' },
      { key: '카테고리', label: '구분' }, { key: '과정명', label: '중복 수료 과정' },
      { key: '수료횟수', label: '수료횟수', num: true, render: function (v) { return '<span class="pill g">' + v + '회</span>'; }, exp: function (v) { return v; } },
      { key: '차수', label: '수료 차수' }, { key: '수료일', label: '수료일' },
      { key: '직무교육이수', label: '직무교육 이수', render: function (v) { return yn(v); }, exp: function (v) { return v ? '이수' : '미이수'; } }
    ];
    var fb = filterBar({ searchKey: 1, searchLabel: '검색(ID·성명·기관·과정)' }, [
      { key: '카테고리', label: '구분', options: uniq(rows, '카테고리') },
      { key: '시도', label: '시도', options: uniq(rows, '시도') }
    ], apply);
    var head = el('div', { class: 'head' });
    head.appendChild(el('div', { html: '<h2>중복자 확인 (같은 과정 중복 이수)</h2><p class="desc">하나의 ID가 동일 과정을 2회 이상 수료한 건</p>' }));
    var expHolder = el('div'); head.appendChild(expHolder);
    card.appendChild(head); card.appendChild(fb.node);
    var holder = el('div'); card.appendChild(holder); c.appendChild(card);
    function apply() {
      var q = (fb.sels.__search.value || '').trim().toLowerCase();
      var filtered = rows.filter(function (r) {
        if (fb.sels['카테고리'].value && r.카테고리 !== fb.sels['카테고리'].value) return false;
        if (fb.sels['시도'].value && r.시도 !== fb.sels['시도'].value) return false;
        if (q && (String(r.ID).toLowerCase().indexOf(q) < 0 && String(r.성명).toLowerCase().indexOf(q) < 0 && String(r.기관명).toLowerCase().indexOf(q) < 0 && String(r.과정명).toLowerCase().indexOf(q) < 0)) return false;
        return true;
      });
      holder.innerHTML = ''; dataTable(holder, cols, filtered, { pageSize: 50, sortKey: '수료횟수' });
      expHolder.innerHTML = ''; expHolder.appendChild(expBtn(filtered, cols, '중복이수_확인.xlsx', '엑셀 다운로드(' + fmt(filtered.length) + ')'));
    }
    apply();
  }

  function setDecision(id, val) {
    if (val === 'pending') delete state.decisions[id]; else state.decisions[id] = val;
    idbSet('decisions', state.decisions); recompute();
  }
  function statusControl(p) {
    var box = el('div'); box.style.whiteSpace = 'nowrap';
    [['pending', '미검토'], ['approve', '승인'], ['reject', '반려']].forEach(function (o) {
      var cur = (p.보류상태 || 'pending') === o[0];
      var b = el('button', { class: 'btn sm' + (cur ? '' : ' sec') }, o[1]);
      b.style.padding = '3px 8px'; b.style.marginRight = '4px';
      if (cur) { if (o[0] === 'approve') b.style.background = 'var(--good)'; else if (o[0] === 'reject') b.style.background = 'var(--bad)'; }
      b.onclick = function (e) { e.stopPropagation(); setDecision(p.ID, o[0]); };
      box.appendChild(b);
    });
    return box;
  }
  function renderPending(c) {
    var rows = state.result.pendingRows || [];
    var card = el('div', { class: 'card' });
    var note = el('div', { class: 'note' });
    note.innerHTML = '교육 수료 <b>당시 직군</b>(수강목록)과 <b>현재 직군</b>(회원정보)이 달라 <b>직군 변경(전직)</b> 가능성이 있는 건입니다. ' +
      '기본은 미이수로 두고, 검토 후 <b>승인</b>하면 이수로 반영됩니다(통계 즉시 갱신). 결정은 브라우저에 저장됩니다.';
    card.appendChild(note);
    var k = state.result.kpi;
    var sum = el('div', { class: 'toolbar' });
    sum.innerHTML = '<span class="filechip">미검토 <b>' + fmt(k.보류미검토) + '</b></span><span class="filechip">승인 <b>' + fmt(k.보류승인) + '</b></span><span class="filechip">전체 <b>' + fmt(rows.length) + '</b></span>';
    card.appendChild(sum);
    if (!rows.length) {
      card.appendChild(el('div', { class: 'empty-state', html: '<div class="big">✅</div>현재 직군 변경으로 검토가 필요한 건이 없습니다.<div class="muted" style="margin-top:6px">전직 등으로 현재 직군과 수료 당시 직군이 다른 건이 생기면 여기에 표시됩니다.</div>' }));
      c.appendChild(card); return;
    }
    var cols = [
      { key: 'ID', label: 'ID' }, { key: '성명', label: '성명' }, { key: '시도', label: '시도' }, { key: '시군구', label: '시군구' },
      { key: '기관명', label: '수행기관명' }, { key: '기관코드', label: '기관코드' },
      { key: '직군', label: '현재 직급' }, { key: '경력', label: '경력' },
      { key: '당시직군', label: '당시 직군(수료시)', render: function (v) { return '<b>' + (v || '-') + '</b>'; } },
      { key: '변경완료과정', label: '수료한 필수과정' },
      { key: '선택차시', label: '선택차시', num: true, render: function (v, r) { return r.경력 === '경력자' ? v + ' / ' + r.필요차시 : '-'; }, exp: function (v, r) { return r.경력 === '경력자' ? v : ''; } },
      { key: '승인시이수', label: '승인 시', render: function (v) { return v ? '<span class="pill y">이수</span>' : '<span class="pill g">선택부족</span>'; }, exp: function (v) { return v ? '이수' : '승인해도 선택부족'; } },
      { key: '보류상태', label: '검토', sortable: false, render: function (v, r) { return statusControl(r); }, exp: function (v) { return v === 'approve' ? '승인' : (v === 'reject' ? '반려' : '미검토'); } }
    ];
    var fb = filterBar({ searchKey: 1, searchLabel: '검색(ID·성명·기관)' }, [
      { key: '상태', label: '검토상태', options: ['미검토', '승인', '반려'] },
      { key: '시도', label: '시도', options: uniq(rows, '시도') }
    ], apply);
    var head = el('div', { class: 'head' });
    head.appendChild(el('div', { html: '<h2>보류 · 직군변경 검토</h2><p class="desc">건별로 승인/반려하면 이수율 등 통계에 즉시 반영됩니다</p>' }));
    var expHolder = el('div'); head.appendChild(expHolder);
    card.appendChild(head); card.appendChild(fb.node);
    var holder = el('div'); card.appendChild(holder); c.appendChild(card);
    function statusKo(s) { return s === 'approve' ? '승인' : (s === 'reject' ? '반려' : '미검토'); }
    function apply() {
      var q = (fb.sels.__search.value || '').trim().toLowerCase();
      var filtered = rows.filter(function (r) {
        if (fb.sels['상태'].value && statusKo(r.보류상태) !== fb.sels['상태'].value) return false;
        if (fb.sels['시도'].value && r.시도 !== fb.sels['시도'].value) return false;
        if (q && (String(r.ID).toLowerCase().indexOf(q) < 0 && String(r.성명).toLowerCase().indexOf(q) < 0 && String(r.기관명).toLowerCase().indexOf(q) < 0)) return false;
        return true;
      });
      holder.innerHTML = ''; dataTable(holder, cols, filtered, { pageSize: 50, sortKey: '보류상태', sortDir: 1 });
      expHolder.innerHTML = ''; expHolder.appendChild(expBtn(filtered, cols, '직군변경_보류검토.xlsx', '엑셀 다운로드(' + fmt(filtered.length) + ')'));
    }
    apply();
  }

  function renderCourses(c) {
    var rows = state.result.courseRows;
    var card = el('div', { class: 'card' });
    var head = el('div', { class: 'head' });
    head.appendChild(el('div', { html: '<h2>과목별 수강·수료 현황</h2><p class="desc">과정(과목) 단위 신청자/수료자/수료율</p>' }));
    head.appendChild(expBtn(rows, [
      { key: '과정명', label: '과정명' }, { key: '카테고리', label: '카테고리' }, { key: '신청자', label: '신청자' }, { key: '수료자', label: '수료자' }, { key: '수료율', label: '수료율(%)', exp: function (v) { return v.toFixed(1); } }
    ], '과목별_현황.xlsx'));
    card.appendChild(head);
    var fb = filterBar({}, [{ key: '카테고리', label: '카테고리', options: uniq(rows, '카테고리') }], apply);
    card.appendChild(fb.node);
    var holder = el('div'); card.appendChild(holder); c.appendChild(card);
    var cols = [
      { key: '과정명', label: '과정명' }, { key: '카테고리', label: '카테고리' },
      { key: '신청자', label: '신청자', num: true, render: fmt }, { key: '수료자', label: '수료자', num: true, render: fmt },
      { key: '수료율', label: '수료율', num: true, render: function (v) { return barCell(v); } }
    ];
    function apply() { var f = fb.sels['카테고리'].value; var data = f ? rows.filter(function (r) { return r.카테고리 === f; }) : rows; holder.innerHTML = ''; dataTable(holder, cols, data, { pageSize: 30, sortKey: '신청자' }); }
    apply();
  }

  function renderCoverage(c) {
    if (!state.students.length) {
      var card0 = el('div', { class: 'card' });
      card0.appendChild(el('h2', {}, '데이터 업데이트 현황'));
      card0.appendChild(el('div', { class: 'muted', style: 'padding:30px 0' }, '수강생목록(원데이터)을 올리면 연도·차수 기준으로 어디까지 데이터가 들어왔는지 표시됩니다.'));
      c.appendChild(card0); return;
    }
    var cov = state.coverage || LMS.coverage(state.students);
    var s = cov.summary;
    // 요약 카드
    var kp = el('div', { class: 'kpis' });
    kp.appendChild(kpiCard('연도', s.연도.join(', ') || '-', 'accent'));
    kp.appendChild(kpiCard('최신 차수', s.최신차수 + '<small>차</small>', 'accent'));
    kp.appendChild(kpiCard('총 수강건수', fmt(s.행수) + '<small>건</small>'));
    kp.appendChild(kpiCard('교육신청일', (s.최근신청일 || '-'), 'good', '최근'));
    kp.appendChild(kpiCard('수료일', (s.최근수료일 || '-'), 'good', '최근'));
    c.appendChild(kp);
    var note = el('div', { class: 'note info' });
    note.innerHTML = '현재 업로드된 데이터는 <b>' + (s.연도.join(', ') || '-') + '년 · 최신 ' + s.최신차수 + '차</b>까지 반영되어 있습니다. ' +
      '교육신청일 <b>' + (s.최초신청일 || '-') + ' ~ ' + (s.최근신청일 || '-') + '</b>. ' +
      '(과정 유형별로 진행 차수가 달라, 아래 표에서 과정별 최신 차수를 확인하세요.)';
    c.appendChild(note);
    if (state.dupRemoved) { var nd = el('div', { class: 'note' }); nd.innerHTML = '완전히 동일한 <b>중복 행 ' + fmt(state.dupRemoved) + '건</b>이 자동 제거되었습니다(같은 파일 중복 업로드 또는 원본 중복행). 위 행수는 제거 후 기준입니다.'; c.appendChild(nd); }
    // 업로드 파일
    if (state.studentFiles.length) {
      var fc = el('div', { class: 'card' });
      fc.appendChild(el('h2', {}, '업로드한 수강 데이터 파일'));
      var fl = el('div'); state.studentFiles.forEach(function (f) { var chip = el('span', { class: 'filechip' }); chip.innerHTML = '<b>' + f.name + '</b> · ' + fmt(f.rows) + '행'; fl.appendChild(chip); }); fc.appendChild(fl);
      c.appendChild(fc);
    }
    // 연도/차수별 건수
    var card1 = el('div', { class: 'card' });
    var head1 = el('div', { class: 'head' });
    head1.appendChild(el('div', { html: '<h2>연도 · 차수별 수강 건수</h2><p class="desc">차수가 높을수록 최근 개강분입니다 (필수 경력자는 2주 단위, 신규자는 월 단위)</p>' }));
    head1.appendChild(expBtn(cov.byYearRound, [
      { key: '연도', label: '연도' }, { key: '차수', label: '차수' }, { key: '건수', label: '건수' }, { key: '최초신청일', label: '최초신청일' }, { key: '최근신청일', label: '최근신청일' }
    ], '연도차수별_현황.xlsx'));
    card1.appendChild(head1);
    dataTable(card1, [
      { key: '연도', label: '연도' },
      { key: '차수', label: '차수', num: true, render: function (v, r) { return v + '차' + (v === s.최신차수 ? ' <span class="pill g">최신</span>' : ''); }, exp: function (v) { return v; } },
      { key: '건수', label: '수강건수', num: true, render: fmt },
      { key: '최초신청일', label: '최초 교육신청일' }, { key: '최근신청일', label: '최근 교육신청일' }
    ], cov.byYearRound, { pageSize: 30, sortKey: '차수', sortDir: 1 });
    c.appendChild(card1);
    // 과정별 최신 차수
    var card2 = el('div', { class: 'card' });
    var head2 = el('div', { class: 'head' });
    head2.appendChild(el('div', { html: '<h2>과정별 최신 차수 (어디까지 들어왔나)</h2><p class="desc">과정마다 보유한 차수와 최신 차수</p>' }));
    head2.appendChild(expBtn(cov.byCourse, [
      { key: '과정명', label: '과정명' }, { key: '카테고리', label: '카테고리' }, { key: '최신차수', label: '최신차수' }, { key: '보유차수', label: '보유차수' }, { key: '건수', label: '건수' }, { key: '최근신청일', label: '최근신청일' }, { key: '최근수료일', label: '최근수료일' }
    ], '과정별_차수현황.xlsx'));
    card2.appendChild(head2);
    var fb = filterBar({ searchKey: 1, searchLabel: '과정 검색' }, [{ key: '카테고리', label: '카테고리', options: uniq(cov.byCourse, '카테고리') }], apply2);
    card2.appendChild(fb.node);
    var holder2 = el('div'); card2.appendChild(holder2); c.appendChild(card2);
    function apply2() {
      var q = (fb.sels.__search.value || '').trim().toLowerCase();
      var data = cov.byCourse.filter(function (r) {
        if (fb.sels['카테고리'].value && r.카테고리 !== fb.sels['카테고리'].value) return false;
        if (q && String(r.과정명).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      holder2.innerHTML = '';
      dataTable(holder2, [
        { key: '과정명', label: '과정명' }, { key: '카테고리', label: '카테고리' },
        { key: '최신차수', label: '최신차수', num: true, render: function (v) { return v + '차'; }, exp: function (v) { return v; } },
        { key: '보유차수', label: '보유 차수' },
        { key: '건수', label: '건수', num: true, render: fmt }, { key: '최근신청일', label: '최근 신청일' }, { key: '최근수료일', label: '최근 수료일' }
      ], data, { pageSize: 30, sortKey: '건수' });
    }
    apply2();
  }

  function renderPerson(c) {
    var card = el('div', { class: 'card' });
    card.appendChild(el('h2', {}, '개인별 이수 조회'));
    card.appendChild(el('p', { class: 'desc' }, 'ID 또는 성명으로 검색하면 필수/선택 진행 상황과 이수 판정을 보여줍니다.'));
    if (!state.result) { card.appendChild(el('div', { class: 'muted' }, '먼저 데이터를 올려주세요.')); c.appendChild(card); return; }
    var tb = el('div', { class: 'toolbar' });
    var inp = el('input', { type: 'text', placeholder: 'ID 또는 성명 입력 후 Enter' }); inp.style.minWidth = '240px';
    var btn = el('button', { class: 'btn' }, '조회');
    tb.appendChild(inp); tb.appendChild(btn); card.appendChild(tb);
    var res = el('div'); card.appendChild(res); c.appendChild(card);
    var persons = state.result.persons;
    var byId = new Map(); persons.forEach(function (p) { byId.set(p.ID, p); });
    function go() {
      var q = inp.value.trim(); res.innerHTML = ''; if (!q) return;
      var matches = persons.filter(function (p) { return p.ID === q || p.성명 === q || p.ID.toLowerCase() === q.toLowerCase(); });
      if (!matches.length) matches = persons.filter(function (p) { return p.성명.indexOf(q) >= 0 || p.ID.toLowerCase().indexOf(q.toLowerCase()) >= 0; }).slice(0, 20);
      if (!matches.length) { res.appendChild(el('div', { class: 'muted' }, '검색 결과가 없습니다. (대상자 모수에 없는 ID일 수 있습니다)')); return; }
      if (matches.length > 1) { var pick = el('div', { class: 'note info' }); pick.innerHTML = matches.length + '명 검색됨 — 한 명을 선택하세요.'; res.appendChild(pick); matches.forEach(function (p) { var b = el('button', { class: 'filechip' }, p.성명 + ' (' + p.ID + ' · ' + p.기관명 + ')'); b.style.cursor = 'pointer'; b.onclick = function () { showPerson(p); }; res.appendChild(b); }); return; }
      showPerson(matches[0]);
    }
    function showPerson(p) {
      res.innerHTML = '';
      var recs = (state.studentByID && state.studentByID.get(p.ID)) || [];
      var kp = el('div', { class: 'kpis' });
      kp.appendChild(kpiCard('이수 여부', p.이수 ? '이수' : '미이수', p.이수 ? 'good' : 'bad'));
      kp.appendChild(kpiCard('필수', p.필수수료 ? '수료' : '미수료', p.필수수료 ? 'good' : 'warn'));
      kp.appendChild(kpiCard('선택 차시', p.경력 === '경력자' ? (p.선택차시 + ' / ' + p.필요차시) : '해당없음', 'accent'));
      kp.appendChild(kpiCard('직군·경력', p.직군 + ' · ' + p.경력));
      res.appendChild(kp);
      var info = el('div', { class: 'note info' });
      info.innerHTML = '<b>' + p.성명 + '</b> (' + p.ID + ') · ' + p.시도 + ' ' + p.시군구 + ' · ' + p.기관명 + (p.사유 ? ' · <b>미이수 사유:</b> ' + p.사유 : '');
      res.appendChild(info);
      var cols = [
        { key: '카테고리', label: '구분' }, { key: '과정명', label: '과정/과목' }, { key: '교육차시', label: '차수' },
        { key: '진도율', label: '진도율', num: true }, { key: '점수', label: '점수', num: true },
        { key: '수료여부', label: '수료', render: function (v) { return v === '수료' ? '<span class="pill y">수료</span>' : '<span class="pill n">' + (v || '-') + '</span>'; } },
        { key: '수료일', label: '수료일' }, { key: '상태', label: '상태' }
      ];
      var h = el('div', { class: 'head' });
      h.appendChild(el('h2', {}, '수강 이력 (' + recs.length + '건)'));
      var btns = el('div');
      btns.appendChild(expBtn(recs, cols, p.ID + '_수강이력.xlsx'));
      var db = el('button', { class: 'btn sm', style: 'margin-left:6px' }, '진단 데이터 내보내기'); db.onclick = function () { exportPersonDiag(p, recs, false); };
      var dbm = el('button', { class: 'btn sec sm', style: 'margin-left:6px' }, '진단(개인정보 가림)'); dbm.onclick = function () { exportPersonDiag(p, recs, true); };
      btns.appendChild(db); btns.appendChild(dbm);
      h.appendChild(btns); res.appendChild(h);
      res.appendChild(el('p', { class: 'hint', style: 'margin:4px 0 8px' }, '※ 판정이 이상한 인원은 “진단 데이터 내보내기”로 저장한 작은 파일(JSON)을 전달해 주시면 원인을 확인할 수 있습니다. 개인정보가 걱정되면 “진단(개인정보 가림)”을 사용하세요 — 이름·ID·기관명이 가려지고 판정에 필요한 정보만 담깁니다.'));
      var holder = el('div'); res.appendChild(holder); dataTable(holder, cols, recs, { pageSize: 50, sortKey: '카테고리', sortDir: 1 });
    }
    btn.onclick = go; inp.onkeydown = function (e) { if (e.key === 'Enter') go(); };
    setTimeout(function () { inp.focus(); }, 30);
  }

  function renderSettings(c) {
    var card = el('div', { class: 'card' });
    card.appendChild(el('h2', {}, '이수 기준 설정'));
    card.appendChild(el('p', { class: 'desc' }, '값을 바꾸면 즉시 재집계됩니다. 설정은 브라우저에 저장됩니다.'));
    var grid = el('div', { class: 'settings-grid' });
    // thresholds
    var box1 = el('div');
    box1.appendChild(el('h3', { style: 'font-size:13px;margin:0 0 8px' }, '경력자 선택교육 이수 기준(차시)'));
    var t = state.config.thresholds;
    ['생활지원사', '전담사회복지사'].forEach(function (g) {
      var lab = el('label', { class: 'fld', style: 'display:inline-flex;margin-right:14px' }, g);
      var inp = el('input', { type: 'number', value: t[g], style: 'width:90px' }); inp.onchange = function () { t[g] = parseInt(inp.value) || 0; saveAndRecompute(); };
      lab.appendChild(inp); box1.appendChild(lab);
    });
    // exam no-show
    box1.appendChild(el('h3', { style: 'font-size:13px;margin:16px 0 8px' }, '미응시자 판정'));
    var ens = state.config.examNoShow;
    var l1 = el('label', { class: 'fld', style: 'display:inline-flex;margin-right:14px' }, '진도율 ≥');
    var i1 = el('input', { type: 'number', value: ens.progressGte, style: 'width:90px' }); i1.onchange = function () { ens.progressGte = parseFloat(i1.value) || 0; saveAndRecompute(); }; l1.appendChild(i1); box1.appendChild(l1);
    var l2 = el('label', { class: 'fld', style: 'display:inline-flex' }, '점수 ≤');
    var i2 = el('input', { type: 'number', value: ens.scoreLte, style: 'width:90px' }); i2.onchange = function () { ens.scoreLte = parseFloat(i2.value) || 0; saveAndRecompute(); }; l2.appendChild(i2); box1.appendChild(l2);
    // 대상 시도
    box1.appendChild(el('h3', { style: 'font-size:13px;margin:16px 0 8px' }, '통계 대상 시도 (이 목록 외는 제외)'));
    box1.appendChild(el('p', { class: 'hint', style: 'margin:0 0 6px' }, '쉼표(,)로 구분. 중앙·미상 등 목록에 없는 시도는 모든 통계에서 제외됩니다.'));
    var sidoInp = el('input', { type: 'text', value: (state.config.allowedSido || []).join(', '), style: 'width:100%' });
    sidoInp.onchange = function () { state.config.allowedSido = sidoInp.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean); saveAndRecompute(); };
    box1.appendChild(sidoInp);
    grid.appendChild(box1);
    // chasi map
    var box2 = el('div');
    box2.appendChild(el('h3', { style: 'font-size:13px;margin:0 0 8px' }, '선택 과목별 차시 (경력자 합산용)'));
    var tw = el('div', { class: 'tablewrap', style: 'max-height:280px' }); var table = el('table');
    table.innerHTML = '<thead><tr><th>과목</th><th class="num">차시</th></tr></thead>'; var tbo = el('tbody'); table.appendChild(tbo);
    Object.keys(state.config.chasi).sort(function (a, b) { return a.localeCompare(b, 'ko'); }).forEach(function (name) {
      var tr = el('tr'); tr.appendChild(el('td', {}, name));
      var td = el('td', { class: 'num' }); var inp = el('input', { type: 'number', value: state.config.chasi[name], style: 'width:64px' }); inp.onchange = function () { state.config.chasi[name] = parseInt(inp.value) || 0; saveAndRecompute(); }; td.appendChild(inp); tr.appendChild(td); tbo.appendChild(tr);
    });
    tw.appendChild(table); box2.appendChild(tw);
    var addrow = el('div', { class: 'toolbar', style: 'margin-top:8px' });
    var an = el('input', { type: 'text', placeholder: '새 과목명' }); var av = el('input', { type: 'number', placeholder: '차시', style: 'width:80px' });
    var ab = el('button', { class: 'btn sm' }, '추가'); ab.onclick = function () { if (an.value.trim()) { state.config.chasi[an.value.trim()] = parseInt(av.value) || 0; saveAndRecompute(); renderTab(); } };
    addrow.appendChild(an); addrow.appendChild(av); addrow.appendChild(ab); box2.appendChild(addrow);
    grid.appendChild(box2);
    card.appendChild(grid);
    var rb = el('button', { class: 'btn sec sm', style: 'margin-top:12px' }, '기본값으로 초기화'); rb.onclick = function () { state.config = JSON.parse(JSON.stringify(LMS.DEFAULT_CONFIG)); saveAndRecompute(); renderTab(); };
    card.appendChild(rb);
    c.appendChild(card);

    // help / data mgmt
    var help = el('div', { class: 'card' });
    help.innerHTML = '<h2>도움말 · 데이터 관리</h2>' +
      '<p class="desc">사용 순서와 동작 방식</p>' +
      '<ol style="margin:0 0 10px 18px;padding:0;font-size:13px;line-height:1.7">' +
      '<li><b>회원정보</b> 엑셀을 한 번 올립니다 (ID·직군·신규/경력·교육대상여부 등). 브라우저에 저장되어 다음에 다시 안 올려도 됩니다. 갱신 시에만 다시 올리세요.</li>' +
      '<li><b>수강생목록</b>(온라인통합수강생목록) .xls/.xlsx 파일들을 올립니다. 여러 개를 한꺼번에 올려도 됩니다.</li>' +
      '<li>각 탭에서 통계를 확인하고, 표 오른쪽 <b>엑셀 다운로드</b>로 내보낼 수 있습니다.</li></ol>' +
      '<div class="note info" style="margin:0">모든 처리는 이 PC의 브라우저 안에서만 이루어지며, 어떤 데이터도 외부로 전송되지 않습니다.</div>';
    var dm = el('div', { class: 'toolbar', style: 'margin-top:12px' });
    var clr = el('button', { class: 'btn sec sm' }, '저장된 회원정보 삭제'); clr.onclick = function () { idbSet('members', null); idbSet('memberMeta', null); state.members = null; state.memberMeta = null; state.result = null; renderTab(); };
    var clrS = el('button', { class: 'btn sec sm' }, '수강데이터 비우기'); clrS.onclick = function () { state.students = []; state.studentFiles = []; state.result = null; state.coverage = null; state.dupRemoved = 0; renderTab(); };
    var clrD = el('button', { class: 'btn sec sm' }, '직군변경 검토결정 초기화'); clrD.onclick = function () { if (confirm('직군변경 보류 건의 승인/반려 결정을 모두 초기화할까요?')) { state.decisions = {}; idbSet('decisions', {}); recompute(); } };
    dm.appendChild(clr); dm.appendChild(clrS); dm.appendChild(clrD); help.appendChild(dm);
    c.appendChild(help);
  }
  function saveAndRecompute() { idbSet('config', state.config); recompute(); }

  /* ---------- 드롭존 연결 -------------------------------------------- */
  function wireDrop(zoneId, inputId, handler) {
    var zone = $('#' + zoneId), input = $('#' + inputId);
    input.onchange = function () { handler(input.files); input.value = ''; };
    ['dragenter', 'dragover'].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('hl'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('hl'); }); });
    zone.addEventListener('drop', function (e) { var files = e.dataTransfer.files; if (files && files.length) handler(files); });
  }

  /* ---------- 초기화 -------------------------------------------------- */
  function init() {
    ov.box = $('#overlay'); ov.msg = $('.spin .msg'); ov.sub = $('.spin .sub'); ov.bar = $('.prog>span');
    renderTabsBar();
    wireDrop('dropMember', 'fileMember', loadMemberFiles);
    wireDrop('dropStudent', 'fileStudent', function (f) { loadStudentFiles(f, true); });
    $('#btnMember').onclick = function () { $('#fileMember').click(); };
    $('#btnStudent').onclick = function () { $('#fileStudent').click(); };
    // 저장된 회원정보/설정/검토결정 복원
    Promise.all([idbGet('members'), idbGet('memberMeta'), idbGet('config'), idbGet('decisions')]).then(function (r) {
      if (r[0] && r[0].length) { state.members = r[0]; state.memberMeta = r[1]; }
      if (r[2]) state.config = Object.assign(JSON.parse(JSON.stringify(LMS.DEFAULT_CONFIG)), r[2]);
      if (r[3]) state.decisions = r[3];
      renderStatus(); renderTab();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.__LMS_APP = state;
})();
