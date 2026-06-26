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
  var SCOLS = ['카테고리', '과정명', '교육차시', '진도율', '점수', '수료여부', '수료일', '상태', 'ID', '성명', '기관코드', '기관명', '시도', '시군구', '사용자유형', '자격번호', '연도/차수'];
  var MCOLS = ['No', '시도', '시군구', '읍면동', '기관코드', '기관명', '성명', 'ID', '사용자유형', '권한관리자', '일반', '중점', '특화', '퇴원', '고도화', '선임여부', '교육대상여부', '교육구분', '상태'];

  var state = {
    members: null, memberMeta: null,
    students: [], studentFiles: [],
    studentByID: null, result: null,
    config: JSON.parse(JSON.stringify(LMS.DEFAULT_CONFIG)),
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
      state.result = LMS.analyze(state.members, state.students, state.config);
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

  /* ---------- 탭 렌더 ------------------------------------------------- */
  var TABS = [
    ['summary', '요약'], ['rates', '이수율 현황'], ['notdone', '미이수자 명단'],
    ['noexam', '미응시·재응시'], ['courses', '과목별 현황'], ['person', '개인 조회'], ['settings', '설정·도움말']
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
    if (!state.result) { c.appendChild(emptyState()); return; }
    if (state.activeTab === 'summary') return renderSummary(c);
    if (state.activeTab === 'rates') return renderRates(c);
    if (state.activeTab === 'notdone') return renderNotDone(c);
    if (state.activeTab === 'noexam') return renderNoExam(c);
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
    note.innerHTML = '집계 기준: 교육대상여부 <b>Y</b> · 회원상태 <b>정상</b>인 <b>생활지원사·전담사회복지사</b> 대상. ' +
      '신규자=필수 수료 / 경력자=필수 수료+선택 차시(생활 13·전담 10) 충족 시 <b>이수</b>. 수강취소 ' + fmt(k.수강취소제외) + '건 제외. ' +
      (k.기준미정의대상 ? '이수기준 미정의(중간관리자/기타 등) ' + fmt(k.기준미정의대상) + '명은 별도(설정·도움말 참고).' : '');
    c.appendChild(note);
    if (k.대상자중수강기록없음) {
      var n2 = el('div', { class: 'note' }); n2.innerHTML = '교육대상자 중 수강 기록이 전혀 없는 인원: <b>' + fmt(k.대상자중수강기록없음) + '명</b> (전원 미이수로 집계됨 — 미수강 독려 대상).'; c.appendChild(n2);
    }
    var uk = Object.keys(state.result.unknownChasi || {});
    if (uk.length) { var n3 = el('div', { class: 'note' }); n3.innerHTML = '차시 매핑이 없는 선택과목 ' + uk.length + '건(테스트/신규 과목일 수 있음): ' + uk.slice(0, 6).join(', ') + '. <b>설정</b>에서 차시를 추가하면 경력자 이수 계산에 반영됩니다.'; c.appendChild(n3); }

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

  function renderNotDone(c) {
    var rows = state.result.notCompleted;
    var card = el('div', { class: 'card' });
    var cols = [
      { key: 'ID', label: 'ID' }, { key: '성명', label: '성명' }, { key: '시도', label: '시도' }, { key: '시군구', label: '시군구' },
      { key: '기관명', label: '기관명' }, { key: '직군', label: '직군' }, { key: '경력', label: '경력' },
      { key: '필수수료', label: '필수', render: function (v) { return v ? '<span class="pill y">수료</span>' : '<span class="pill n">미수료</span>'; }, exp: function (v) { return v ? '수료' : '미수료'; } },
      { key: '선택차시', label: '선택차시', num: true, render: function (v, r) { return r.경력 === '경력자' ? v + ' / ' + r.필요차시 : '-'; }, exp: function (v, r) { return r.경력 === '경력자' ? v : ''; } },
      { key: '사유', label: '미이수 사유' }
    ];
    var fb = filterBar({ searchKey: 1, searchLabel: '검색(ID·성명·기관)', searchPlaceholder: '예: 홍길동' }, [
      { key: '시도', label: '시도', options: uniq(rows, '시도') },
      { key: '직군', label: '직군', options: uniq(rows, '직군') },
      { key: '경력', label: '경력', options: uniq(rows, '경력') }
    ], apply);
    var head = el('div', { class: 'head' });
    head.appendChild(el('div', { html: '<h2>미이수자 명단 (독려용)</h2><p class="desc">대상자 중 이수 기준을 충족하지 못한 인원</p>' }));
    var expHolder = el('div'); head.appendChild(expHolder);
    card.appendChild(head); card.appendChild(fb.node);
    var tableHolder = el('div'); card.appendChild(tableHolder); c.appendChild(card);
    var filtered = rows;
    function apply() {
      var q = (fb.sels.__search.value || '').trim().toLowerCase();
      filtered = rows.filter(function (r) {
        if (fb.sels['시도'].value && r.시도 !== fb.sels['시도'].value) return false;
        if (fb.sels['직군'].value && r.직군 !== fb.sels['직군'].value) return false;
        if (fb.sels['경력'].value && r.경력 !== fb.sels['경력'].value) return false;
        if (q && (String(r.ID).toLowerCase().indexOf(q) < 0 && String(r.성명).toLowerCase().indexOf(q) < 0 && String(r.기관명).toLowerCase().indexOf(q) < 0)) return false;
        return true;
      });
      tableHolder.innerHTML = ''; dataTable(tableHolder, cols, filtered, { pageSize: 50, sortKey: '시도', sortDir: 1 });
      expHolder.innerHTML = ''; expHolder.appendChild(expBtn(filtered, cols, '미이수자명단.xlsx', '엑셀 다운로드(' + fmt(filtered.length) + ')'));
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
      { key: 'ID', label: 'ID' }, { key: '성명', label: '성명' }, { key: '시도', label: '시도' }, { key: '기관명', label: '기관명' },
      { key: '카테고리', label: '구분' }, { key: '과정명', label: '미응시 과목/과정' },
      { key: '진도율', label: '진도율', num: true, exp: function (v) { return v; } }, { key: '점수', label: '점수', num: true },
      { key: '해당과목완료', label: '해당과목 완료', render: function (v) { return v ? '<span class="pill y">예</span>' : '<span class="pill n">아니오</span>'; }, exp: function (v) { return v ? '예' : '아니오'; } },
      { key: '재응시필요', label: '재응시 필요', render: function (v) { return v ? '<span class="pill g">필요</span>' : '<span class="muted">-</span>'; }, exp: function (v) { return v ? '필요' : ''; } },
      { key: '전체이수', label: '전체 이수', render: function (v) { return yn(v); }, exp: function (v) { return v ? '이수' : '미이수'; } }
    ];
    var fb = filterBar({ searchKey: 1, searchLabel: '검색(ID·성명·기관)' }, [
      { key: '시도', label: '시도', options: uniq(rows, '시도') },
      { key: '재응시', label: '재응시 필요만', options: ['필요만'] }
    ], apply);
    var head = el('div', { class: 'head' });
    head.appendChild(el('div', { html: '<h2>미응시자 / 재응시 안내 대상</h2><p class="desc">진도 100%·점수 0 (연 ' + fmt(rows.length) + '건 · 재응시필요 ' + fmt(state.result.kpi.재응시필요인원) + '건)</p>' }));
    var expHolder = el('div'); head.appendChild(expHolder);
    card.appendChild(head); card.appendChild(fb.node);
    var tableHolder = el('div'); card.appendChild(tableHolder); c.appendChild(card);
    function apply() {
      var q = (fb.sels.__search.value || '').trim().toLowerCase();
      var filtered = rows.filter(function (r) {
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
      var h = el('div', { class: 'head' }); h.appendChild(el('h2', {}, '수강 이력 (' + recs.length + '건)')); h.appendChild(expBtn(recs, cols, p.ID + '_수강이력.xlsx')); res.appendChild(h);
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
    var clrS = el('button', { class: 'btn sec sm' }, '수강데이터 비우기'); clrS.onclick = function () { state.students = []; state.studentFiles = []; state.result = null; renderTab(); };
    dm.appendChild(clr); dm.appendChild(clrS); help.appendChild(dm);
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
    // 저장된 회원정보/설정 복원
    Promise.all([idbGet('members'), idbGet('memberMeta'), idbGet('config')]).then(function (r) {
      if (r[0] && r[0].length) { state.members = r[0]; state.memberMeta = r[1]; }
      if (r[2]) state.config = Object.assign(JSON.parse(JSON.stringify(LMS.DEFAULT_CONFIG)), r[2]);
      renderStatus(); renderTab();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.__LMS_APP = state;
})();
