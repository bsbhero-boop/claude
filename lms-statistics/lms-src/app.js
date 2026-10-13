/* =============================================================================
 *  배움터 LMS 직무교육 통계 - UI (app.js)  ver9
 *  전역 XLSX(SheetJS), LMS(compute.js)를 사용. 모든 처리는 브라우저 로컬에서만 수행.
 *
 *  ver9 구조 변경
 *   · 대용량 원데이터는 Web Worker가 보관하고 집계도 Worker에서 수행한다.
 *     설정 변경·보류 승인 때마다 화면이 멈추던 문제(ver8)를 없애기 위함이며,
 *     Worker를 만들 수 없는 환경에서는 동일 API의 동기 방식으로 자동 대체된다.
 * ========================================================================== */
(function () {
  'use strict';

  var VERSION = '@@VERSION@@';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var el = function (t, a, h) { var e = document.createElement(t); if (a) for (var k in a) { if (k === 'class') e.className = a[k]; else if (k === 'html') e.innerHTML = a[k]; else e.setAttribute(k, a[k]); } if (h != null) e.textContent = h; return e; };
  var fmt = function (n) { return (n == null ? 0 : n).toLocaleString('ko-KR'); };
  var pct = function (n) { return (n == null ? 0 : n).toFixed(1) + '%'; };
  var tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
  var paint = function () { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); };

  // [ver9] 원데이터에서 온 문자열은 반드시 이 함수를 거쳐 innerHTML에 넣는다.
  //  엑셀 셀 값에 태그가 섞여 있어도 그대로 실행되지 않도록 한다.
  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 필요한 컬럼만 보관(메모리 절약)
  var SCOLS = ['카테고리', '과정명', '교육차시', '교육신청일', '진도율', '점수', '수료여부', '수료일', '상태', 'ID', '성명', '기관코드', '기관명', '시도', '시군구', '사용자유형', '자격번호', '연도/차수'];
  var MCOLS = ['No', '시도', '시군구', '읍면동', '기관코드', '기관명', '성명', 'ID', '사용자유형', '권한관리자', '일반', '중점', '특화', '퇴원', '고도화', '선임여부', '교육대상여부', '교육구분', '상태'];
  var DATE_COLS = { '수료일': 1, '교육신청일': 1 };

  var state = {
    members: null, memberMeta: null, memberDupRemoved: 0,
    studentCount: 0, studentFiles: [], dupRemoved: 0,
    result: null, coverage: null, diag: null,
    config: JSON.parse(JSON.stringify(LMS.DEFAULT_CONFIG)),
    decisions: {},
    snapshots: [],
    activeTab: 'summary',
    busy: false
  };

  /* ══════════════════════════════════════════════════════════════════════
   *  집계 엔진 — Worker 우선, 실패 시 동기 방식으로 자동 대체
   * ══════════════════════════════════════════════════════════════════════ */
  var Engine = (function () {
    var wk = null, seq = 0, waiting = {};
    var mem = [], stu = [];              // 동기 대체 모드에서 쓰는 보관소
    var mode = 'inline';

    function dedupeRows(rows) {
      var seen = new Set(), out = [], SEP = String.fromCharCode(1);
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i], s = '';
        for (var c = 0; c < SCOLS.length; c++) { var v = r[SCOLS[c]]; s += (v == null ? '' : v) + SEP; }
        if (!seen.has(s)) { seen.add(s); out.push(r); }
      }
      return out;
    }

    function bootWorker() {
      try {
        var src = document.getElementById('compute-src');
        if (!src || typeof Worker === 'undefined') return false;
        var glue = '\n(' + String(workerMain) + ')();\n';
        var url = URL.createObjectURL(new Blob([src.textContent, glue], { type: 'text/javascript' }));
        wk = new Worker(url);
        wk.onmessage = function (e) {
          var d = e.data, w = waiting[d.id];
          if (!w) return;
          delete waiting[d.id];
          if (d.ok) w.res(d.result); else w.rej(new Error(d.error || '집계 오류'));
        };
        wk.onerror = function () { /* 개별 호출의 reject 는 타임아웃 없이 두고, 이후 호출은 대체 모드로 */ };
        mode = 'worker';
        return true;
      } catch (e) { wk = null; return false; }
    }

    // Worker 안에서 실행될 본문. compute.js 소스 뒤에 이어 붙는다.
    function workerMain() {
      var M = [], S = [];
      var SEPCOLS = ['카테고리', '과정명', '교육차시', '교육신청일', '진도율', '점수', '수료여부', '수료일', '상태', 'ID', '성명', '기관코드', '기관명', '시도', '시군구', '사용자유형', '자격번호', '연도/차수'];
      function dedupe(rows) {
        var seen = new Set(), out = [], SEP = String.fromCharCode(1);
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i], s = '';
          for (var c = 0; c < SEPCOLS.length; c++) { var v = r[SEPCOLS[c]]; s += (v == null ? '' : v) + SEP; }
          if (!seen.has(s)) { seen.add(s); out.push(r); }
        }
        return out;
      }
      self.onmessage = function (e) {
        var d = e.data, id = d.id;
        try {
          var out = null;
          switch (d.type) {
            case 'setMembers': M = d.rows || []; out = { count: M.length }; break;
            case 'addStudents': {
              var before = S.length + (d.rows || []).length;
              S = dedupe(S.concat(d.rows || []));
              out = { total: S.length, removed: before - S.length };
              break;
            }
            case 'clearStudents': S = []; out = { total: 0 }; break;
            case 'analyze': out = self.LMS.analyze(M, S, d.cfg); break;
            case 'coverage': out = S.length ? self.LMS.coverage(S) : null; break;
            case 'diagnose': out = self.LMS.diagnose(M, S, d.cfg); break;
            case 'records': {
              var want = String(d.id2 == null ? '' : d.id2).trim(), acc = [];
              for (var i = 0; i < S.length; i++) { if (String(S[i].ID == null ? '' : S[i].ID).trim() === want) acc.push(S[i]); }
              out = acc; break;
            }
            default: throw new Error('알 수 없는 요청: ' + d.type);
          }
          self.postMessage({ id: id, ok: true, result: out });
        } catch (err) {
          self.postMessage({ id: id, ok: false, error: (err && err.message) || String(err) });
        }
      };
    }

    function call(type, payload) {
      if (wk) {
        return new Promise(function (res, rej) {
          var id = ++seq;
          waiting[id] = { res: res, rej: rej };
          var msg = Object.assign({ id: id, type: type }, payload || {});
          try { wk.postMessage(msg); }
          catch (e) { delete waiting[id]; wk = null; mode = 'inline'; res(runInline(type, payload)); }
        }).catch(function (e) {
          // Worker 가 죽으면 이후에는 동기 방식으로 계속 동작시킨다.
          wk = null; mode = 'inline';
          return runInline(type, payload);
        });
      }
      return Promise.resolve().then(function () { return runInline(type, payload); });
    }

    function runInline(type, d) {
      d = d || {};
      switch (type) {
        case 'setMembers': mem = d.rows || []; return { count: mem.length };
        case 'addStudents': {
          var before = stu.length + (d.rows || []).length;
          stu = dedupeRows(stu.concat(d.rows || []));
          return { total: stu.length, removed: before - stu.length };
        }
        case 'clearStudents': stu = []; return { total: 0 };
        case 'analyze': return LMS.analyze(mem, stu, d.cfg);
        case 'coverage': return stu.length ? LMS.coverage(stu) : null;
        case 'diagnose': return LMS.diagnose(mem, stu, d.cfg);
        case 'records': {
          var want = String(d.id2 == null ? '' : d.id2).trim();
          return stu.filter(function (r) { return String(r.ID == null ? '' : r.ID).trim() === want; });
        }
      }
      throw new Error('알 수 없는 요청: ' + type);
    }

    bootWorker();
    return {
      mode: function () { return mode; },
      setMembers: function (rows) { return call('setMembers', { rows: rows }); },
      addStudents: function (rows) { return call('addStudents', { rows: rows }); },
      clearStudents: function () { return call('clearStudents'); },
      analyze: function (cfg) { return call('analyze', { cfg: cfg }); },
      coverage: function () { return call('coverage'); },
      diagnose: function (cfg) { return call('diagnose', { cfg: cfg }); },
      records: function (id) { return call('records', { id2: id }); }
    };
  })();

  /* ---------- IndexedDB (회원정보/설정 영구 저장) ----------------------- */
  var DB;
  function idb() {
    return new Promise(function (res, rej) {
      if (DB) return res(DB);
      if (typeof indexedDB === 'undefined') return rej(new Error('이 브라우저에서는 저장 기능을 쓸 수 없습니다'));
      var rq = indexedDB.open('lms-stats', 1);
      rq.onupgradeneeded = function (e) { var db = e.target.result; if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); };
      rq.onsuccess = function () { DB = rq.result; res(DB); };
      rq.onerror = function () { rej(rq.error || new Error('저장소를 열 수 없습니다')); };
    });
  }
  function idbSet(k, v) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) { var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; });
    }).catch(function (e) { console.warn('저장 실패(' + k + '):', e && e.message); });
  }
  function idbGet(k) {
    return idb().then(function (db) {
      return new Promise(function (res) { var tx = db.transaction('kv', 'readonly'); var rq = tx.objectStore('kv').get(k); rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { res(null); }; });
    }).catch(function () { return null; });
  }

  /* ---------- 오버레이 ------------------------------------------------- */
  var ov = { box: null, msg: null, sub: null, bar: null };
  function showOv(msg, sub) { ov.box.classList.add('on'); ov.msg.textContent = msg || '처리 중...'; ov.sub.textContent = sub || ''; ov.bar.style.width = '0%'; }
  function setOv(msg, sub, p) { if (msg != null) ov.msg.textContent = msg; if (sub != null) ov.sub.textContent = sub; if (p != null) ov.bar.style.width = p + '%'; }
  function hideOv() { ov.box.classList.remove('on'); }

  /* ---------- 파일 파싱 ------------------------------------------------ */
  // 헤더행 자동탐지: 식별 컬럼을 포함하는 첫 행
  var HEADER_HINTS = ['ID', 'Id', 'id', '아이디', '회원ID', '사용자ID'];
  function findHeaderRow(aoa) {
    for (var i = 0; i < Math.min(aoa.length, 12); i++) {
      var row = aoa[i] || [];
      for (var c = 0; c < row.length; c++) {
        var v = String(row[c] == null ? '' : row[c]).trim();
        if (HEADER_HINTS.indexOf(v) >= 0) return i;
      }
    }
    return 0;
  }

  // [ver9] 셀 값 정규화 — 날짜 컬럼은 YYYY-MM-DD 로, 나머지는 문자열로 통일.
  //  파서를 raw:true 로 바꿨기 때문에(D-01·D-02) 여기서 한 번만 손보면 된다.
  function cellValue(col, v) {
    if (v === null || v === undefined) return '';
    if (DATE_COLS[col]) { var d = LMS.normDate(v); return d || (v instanceof Date ? '' : String(v).trim()); }
    if (v instanceof Date) return LMS.normDate(v);
    if (typeof v === 'number') return String(v);
    return String(v).trim();
  }

  function aoaToObjects(aoa, keepCols) {
    var h = findHeaderRow(aoa);
    var header = (aoa[h] || []).map(function (x) { return String(x == null ? '' : x).trim(); });
    var keep = {}; keepCols.forEach(function (k) { keep[k] = 1; });
    var idxs = []; var used = {};
    for (var c = 0; c < header.length; c++) { if (keep[header[c]] && !used[header[c]]) { used[header[c]] = 1; idxs.push(c); } }
    var out = [];
    for (var i = h + 1; i < aoa.length; i++) {
      var r = aoa[i]; if (!r) continue;
      var has = false, o = {};
      for (var k = 0; k < idxs.length; k++) {
        var ci = idxs[k], name = header[ci];
        var v = cellValue(name, r[ci]);
        if (v !== '') has = true;
        o[name] = v;
      }
      if (has) out.push(o);
    }
    return { rows: out, header: header };
  }

  function whenXLSX() {
    return new Promise(function (res, rej) {
      if (typeof XLSX !== 'undefined' || window.__XLSX_READY) return res();
      if (window.__XLSX_ERR) return rej(new Error('엑셀 처리 모듈을 불러오지 못했습니다 — 파일이 손상되지 않았는지 확인하세요'));
      var to = setTimeout(function () { rej(new Error('엑셀 처리 모듈 로드 시간 초과')); }, 15000);
      document.addEventListener('xlsx-ready', function () { clearTimeout(to); res(); }, { once: true });
    });
  }

  // [ver9] raw:true + cellDates:true — 원본 값을 그대로 읽고 날짜만 Date 객체로 받는다.
  //        시트가 여러 개면 필요한 헤더를 가진 시트를 모두 읽는다(D-21).
  function parseWorkbook(buf, keepCols, requiredCol) {
    var wb = XLSX.read(buf, { type: 'array', raw: true, cellDates: true, cellNF: false, dense: true });
    var rows = [], sheetsUsed = [], sheetsSkipped = [];
    wb.SheetNames.forEach(function (nm) {
      var ws = wb.Sheets[nm]; if (!ws) return;
      var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: false });
      if (!aoa.length) return;
      var parsed = aoaToObjects(aoa, keepCols);
      if (requiredCol && parsed.header.indexOf(requiredCol) < 0) { sheetsSkipped.push(nm); return; }
      if (!parsed.rows.length) { return; }
      sheetsUsed.push(nm); rows = rows.concat(parsed.rows);
    });
    return { rows: rows, sheetsUsed: sheetsUsed, sheetsSkipped: sheetsSkipped };
  }

  /* ---------- 회원정보 로드 ------------------------------------------- */
  // [ver9] 검증 실패 시 기존 데이터를 그대로 두고 중단한다(D-04).
  //        ID 기준 중복 제거로 대상자 이중 계상을 막는다(D-03).
  function dedupeMembers(rows) {
    var idx = new Map(), out = [];
    rows.forEach(function (r) {
      var id = String(r['ID'] == null ? '' : r['ID']).trim();
      if (!id) { out.push(r); return; }             // ID 없는 행은 그대로 두고 진단에서 알린다
      if (idx.has(id)) out[idx.get(id)] = r;         // 뒤에 온 행(최신본)으로 교체
      else { idx.set(id, out.length); out.push(r); }
    });
    return out;
  }

  function loadMemberFiles(files) {
    files = Array.prototype.slice.call(files).filter(Boolean);
    if (!files.length) return Promise.resolve();
    showOv('회원정보 읽는 중...', files[0].name);
    var all = [], skipped = [];
    var chain = whenXLSX();
    files.forEach(function (f, i) {
      chain = chain.then(function () { setOv('회원정보 읽는 중...', '(' + (i + 1) + '/' + files.length + ') ' + f.name, 10 + 60 * i / files.length); return f.arrayBuffer(); })
        .then(function (buf) {
          return tick().then(function () {
            var p = parseWorkbook(buf, MCOLS, null);
            all = all.concat(p.rows);
            if (p.sheetsUsed.length > 1) skipped.push(f.name + ': ' + p.sheetsUsed.length + '개 시트 읽음');
          });
        });
    });
    return chain.then(function () {
      // 검증 — 실패하면 아무것도 바꾸지 않고 되돌아간다.
      if (!all.length) { throw new Error('읽을 수 있는 데이터 행이 없습니다. 헤더 행에 ‘ID’ 열이 있는지 확인해 주세요.'); }
      if (!('교육대상여부' in all[0]) && !('교육구분' in all[0])) {
        throw new Error('이 파일은 회원정보가 아닌 것 같습니다.\n‘교육대상여부/교육구분’ 열을 찾지 못했습니다.\n\n기존에 저장된 회원정보는 그대로 두었습니다.');
      }
      setOv('중복 ID 정리 중...', '', 75);
      var before = all.length;
      all = dedupeMembers(all);
      state.memberDupRemoved = before - all.length;
      state.members = all;
      state.memberMeta = { count: all.length, filename: files.map(function (f) { return f.name; }).join(', '), loadedAt: new Date().toISOString(), dupRemoved: state.memberDupRemoved };
      setOv('회원정보 저장 중...', '', 88);
      return idbSet('members', all).then(function () { return idbSet('memberMeta', state.memberMeta); });
    }).then(function () {
      setOv('집계 중...', '', 94);
      return Engine.setMembers(state.members);
    }).then(function () { renderStatus(); return recompute(); }).then(hideOv)
      .catch(function (e) { hideOv(); alert(e && e.message ? e.message : String(e)); });
  }

  /* ---------- 수강생목록 로드 ---------------------------------------- */
  function loadStudentFiles(files) {
    files = Array.prototype.slice.call(files).filter(Boolean);
    if (!files.length) return Promise.resolve();
    showOv('수강생목록 읽는 중...', files[0].name);
    var batch = [], meta = [];
    var chain = whenXLSX();
    files.forEach(function (f, i) {
      chain = chain.then(function () { setOv('수강생목록 파싱 중...', '(' + (i + 1) + '/' + files.length + ') ' + f.name + ' — 잠시만 기다려 주세요', 5 + 70 * i / files.length); return f.arrayBuffer(); })
        .then(function (buf) {
          return tick().then(function () {
            var p = parseWorkbook(buf, SCOLS, null);
            if (!p.rows.length) throw new Error('‘' + f.name + '’에서 읽을 수 있는 데이터 행이 없습니다.\n헤더 행에 ‘ID’ 열이 있는지 확인해 주세요.\n\n기존 수강데이터는 그대로 두었습니다.');
            if (!('과정명' in p.rows[0])) throw new Error('‘' + f.name + '’은 수강생목록(온라인통합수강생목록)이 아닌 것 같습니다.\n‘과정명’ 열을 찾지 못했습니다.\n\n기존 수강데이터는 그대로 두었습니다.');
            batch = batch.concat(p.rows);
            meta.push({ name: f.name, rows: p.rows.length, sheets: p.sheetsUsed.length });
          });
        });
    });
    return chain.then(function () {
      setOv('중복 행 정리 중...', '', 80);
      return Engine.addStudents(batch);
    }).then(function (r) {
      state.studentCount = r.total;
      state.dupRemoved += r.removed;
      meta.forEach(function (m) { state.studentFiles.push(m); });
      setOv('데이터 범위 확인 중...', fmt(r.total) + '행', 88);
      return Engine.coverage();
    }).then(function (cov) {
      state.coverage = cov;
      setOv('통계 집계 중...', '', 93);
      renderStatus(); return recompute();
    }).then(hideOv)
      .catch(function (e) { hideOv(); alert(e && e.message ? e.message : String(e)); });
  }

  /* ---------- 집계 ---------------------------------------------------- */
  // [ver9] Worker 로 넘기므로 화면이 멈추지 않는다. 대체 모드일 때만 오버레이를 띄운다.
  function recompute(opts) {
    opts = opts || {};
    if (!state.members || !state.studentCount) { state.result = null; state.diag = null; if (!opts.silent) renderTab(); return Promise.resolve(); }
    var cfg = Object.assign({}, state.config, { decisions: state.decisions });
    var heavy = Engine.mode() === 'inline' && state.studentCount > 30000;
    state.busy = true;
    var p = Promise.resolve();
    if (heavy && !ov.box.classList.contains('on')) { showOv('통계 집계 중...', fmt(state.studentCount) + '행'); p = paint(); }
    return p.then(function () { return Engine.analyze(cfg); })
      .then(function (res) {
        state.result = res;
        return Engine.diagnose(cfg);
      })
      .then(function (dg) {
        state.diag = dg;
        state.busy = false;
        if (heavy) hideOv();
        if (!opts.silent) renderTab(); else renderStatus();
      })
      .catch(function (e) {
        state.busy = false; if (heavy) hideOv();
        console.error(e); alert('집계 중 오류가 발생했습니다: ' + (e && e.message ? e.message : e));
      });
  }

  /* ---------- 상태바 -------------------------------------------------- */
  function addStat(sb, html, cls) { var d = el('div', { class: 'stat' + (cls ? ' ' + cls : '') }); d.innerHTML = html; sb.appendChild(d); return d; }
  function renderStatus() {
    var sb = $('#statusbar'); sb.innerHTML = '';
    if (state.memberMeta) {
      var d = new Date(state.memberMeta.loadedAt);
      addStat(sb, '회원정보 <b>' + fmt(state.memberMeta.count) + '명</b> · ' + esc(d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })));
    } else addStat(sb, '회원정보 미등록', 'empty');
    if (state.studentCount) {
      addStat(sb, '수강데이터 <b>' + fmt(state.studentCount) + '행</b> · ' + state.studentFiles.length + '개 파일');
      if (state.coverage) addStat(sb, '데이터 ' + esc(state.coverage.summary.연도.join('·') || '') + '년 <b>최신 ' + state.coverage.summary.최신차수 + '차</b>');
      if (state.dupRemoved) addStat(sb, '중복행 <b>' + fmt(state.dupRemoved) + '건</b> 자동제거');
    } else addStat(sb, '수강데이터 미등록', 'empty');
    if (state.memberDupRemoved) addStat(sb, '회원 중복ID <b>' + fmt(state.memberDupRemoved) + '건</b> 정리');
    if (state.result) addStat(sb, '전체 이수율 <b>' + pct(state.result.kpi.이수율) + '</b>');
    var errs = state.diag ? state.diag.issues.filter(function (x) { return x.level === 'err'; }).length : 0;
    var warns = state.diag ? state.diag.issues.filter(function (x) { return x.level === 'warn'; }).length : 0;
    if (errs || warns) {
      var s = addStat(sb, '데이터 점검 ' + (errs ? '<b>오류 ' + errs + '</b>' : '') + (errs && warns ? ' · ' : '') + (warns ? '주의 ' + warns : ''), errs ? 'alert' : 'warnstat');
      s.style.cursor = 'pointer'; s.onclick = function () { state.activeTab = 'check'; renderTabsBar(); renderTab(); };
    }
  }

  /* ---------- 공통: 정렬 가능한 페이지네이션 테이블 ------------------- */
  // [ver9] 값이 비어 있는 행(null/'')은 정렬 방향과 무관하게 항상 뒤로 보낸다(D-18).
  function cmpValues(x, y, dir) {
    var xe = (x === null || x === undefined || x === '');
    var ye = (y === null || y === undefined || y === '');
    if (xe || ye) { if (xe && ye) return 0; return xe ? 1 : -1; }
    if (typeof x === 'boolean' || typeof y === 'boolean') return ((x ? 1 : 0) - (y ? 1 : 0)) * dir;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y), 'ko') * dir;
  }
  function dataTable(container, columns, rows, opts) {
    opts = opts || {}; var pageSize = opts.pageSize || 50; var page = { i: 0 }; var sort = { key: opts.sortKey || null, dir: opts.sortDir || -1 };
    var wrap = el('div'); var tw = el('div', { class: 'tablewrap' }); var table = el('table');
    var thead = el('thead'); var tbody = el('tbody'); table.appendChild(thead); table.appendChild(tbody); tw.appendChild(table); wrap.appendChild(tw);
    var pager = el('div', { class: 'pager' }); wrap.appendChild(pager);
    function render() {
      var data = rows;
      if (sort.key) { data = rows.slice().sort(function (a, b) { return cmpValues(a[sort.key], b[sort.key], sort.dir); }); }
      var pages = Math.max(1, Math.ceil(data.length / pageSize)); if (page.i >= pages) page.i = pages - 1;
      thead.innerHTML = ''; var htr = el('tr');
      columns.forEach(function (c) {
        var th = el('th', { class: (c.num ? 'num ' : '') + (c.sortable === false ? 'no' : '') }, c.label + (sort.key === c.key ? (sort.dir < 0 ? ' ▾' : ' ▴') : ''));
        if (c.sortable !== false) th.onclick = function () { if (sort.key === c.key) sort.dir = -sort.dir; else { sort.key = c.key; sort.dir = c.num ? -1 : 1; } render(); };
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      tbody.innerHTML = '';
      var slice = data.slice(page.i * pageSize, page.i * pageSize + pageSize);
      slice.forEach(function (r) {
        var tr = el('tr');
        columns.forEach(function (c) {
          var td = el('td', { class: c.num ? 'num' : '' });
          if (c.render) { var o = c.render(r[c.key], r); if (o instanceof Node) td.appendChild(o); else td.innerHTML = o; }
          else td.textContent = (r[c.key] == null ? '' : r[c.key]);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      pager.innerHTML = '';
      pager.appendChild(el('span', {}, '총 ' + fmt(data.length) + '건'));
      var prev = el('button', {}, '이전'); prev.disabled = page.i === 0; prev.onclick = function () { page.i--; render(); };
      var info = el('span', {}, (page.i + 1) + ' / ' + pages);
      var next = el('button', {}, '다음'); next.disabled = page.i >= pages - 1; next.onclick = function () { page.i++; render(); };
      pager.appendChild(prev); pager.appendChild(info); pager.appendChild(next);
    }
    render(); container.appendChild(wrap); return { rerender: render };
  }
  function barCell(p) { p = p || 0; var cls = p >= 80 ? 'g' : (p >= 50 ? '' : (p >= 30 ? 'w' : 'r')); return '<div style="display:flex;align-items:center"><div class="bar ' + cls + '"><span style="width:' + Math.min(100, p) + '%"></span></div><span class="barlab">' + p.toFixed(1) + '%</span></div>'; }
  function yn(v) { return v ? '<span class="pill y">이수</span>' : '<span class="pill n">미이수</span>'; }
  function txt(v) { return esc(v == null ? '' : v); }

  /* ---------- 내보내기 (엑셀) ---------------------------------------- */
  function rowsToAoa(rows, columns) {
    var aoa = [columns.map(function (c) { return c.label; })];
    rows.forEach(function (r) { aoa.push(columns.map(function (c) { var v = r[c.key]; if (c.exp) v = c.exp(r[c.key], r); return v == null ? '' : v; })); });
    return aoa;
  }
  function exportRows(rows, columns, filename, sheetName) {
    var ws = XLSX.utils.aoa_to_sheet(rowsToAoa(rows, columns));
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet1');
    XLSX.writeFile(wb, filename);
  }
  function expBtn(rows, columns, filename, label) {
    var b = el('button', { class: 'btn sec sm' }, label || '엑셀 다운로드');
    b.onclick = function () { if (!rows.length) { alert('내보낼 데이터가 없습니다.'); return; } exportRows(rows, columns, filename); };
    return b;
  }
  function downloadBlob(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  // 엑셀 시트명 제약(31자, 특수문자 불가) 처리
  function safeSheetName(s, used) {
    var n = String(s || 'Sheet').replace(/[\\\/\?\*\[\]:]/g, '_').slice(0, 28) || 'Sheet';
    var base = n, i = 2; while (used[n]) { n = base.slice(0, 26) + '_' + (i++); }
    used[n] = 1; return n;
  }

  /* ---------- 개인 진단 데이터 --------------------------------------- */
  function exportPersonDiag(p, recs, mask) {
    var mem = null, mid = p.ID;
    if (state.members) { for (var i = 0; i < state.members.length; i++) { if (String(state.members[i].ID).trim() === mid) { mem = state.members[i]; break; } } }
    mem = mem || {};
    function mk(v) { return mask ? '***' : (v == null ? '' : v); }
    var relChasi = {};
    recs.forEach(function (r) { if (String(r['카테고리']) === '직무교육(선택)') { var b = LMS.selBase(r['과정명']); relChasi[b] = (state.config.chasi && state.config.chasi[b] != null) ? state.config.chasi[b] : '(미매핑=0)'; } });
    var out = {
      도구버전: VERSION, 생성시각: new Date().toISOString(), 개인정보가림: !!mask,
      판정결과: {
        이수: p.이수, 미이수사유: p.사유 || '', 필수수료: p.필수수료,
        선택차시합계: p.선택차시, 필요선택차시: p.필요차시, 남은과목추천: p.추천과목 || '',
        차수: p.차수, 이수일자: p.이수일자,
        직군_현재: p.직군, 직군_정규화: p.직군정규화, 경력구분: p.경력, 선임: p.선임, 기준정의: p.기준정의,
        보류후보: p.보류후보, 보류상태: p.보류상태, 당시직군: p.당시직군 || '', 당시경력: p.당시경력 || '', 경력일치: p.경력일치, 승인시이수: p.승인시이수
      },
      회원정보: {
        ID: mask ? 'MASKED-ID' : mid, 성명: mk(p.성명),
        시도: p.시도, 시군구: p.시군구, 기관코드: mask ? '***' : (mem['기관코드'] || ''), 기관명: mk(mem['기관명']),
        사용자유형: mem['사용자유형'] || '', 교육구분: mem['교육구분'] || '', 교육대상여부: mem['교육대상여부'] || '', 회원상태: mem['상태'] || '', 선임여부: mem['선임여부'] || ''
      },
      적용규칙: { 경력자_선택차시기준: state.config.thresholds, 선임전용기준: state.config.seniorThreshold, 대상시도: state.config.allowedSido, 이_사람_선택과목_차시: relChasi },
      수강이력: recs.map(function (r) {
        return { 카테고리: r['카테고리'], 과정명: r['과정명'], 연도차수: r['연도/차수'] || '', 교육차시: r['교육차시'], 진도율: r['진도율'], 점수: r['점수'], 수료여부: r['수료여부'], 수료일: r['수료일'], 상태: r['상태'], 당시사용자유형: r['사용자유형'] };
      })
    };
    downloadBlob(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), '진단_' + (mask ? 'masked' : mid) + '.json');
  }

  /* ---------- 탭 렌더 ------------------------------------------------- */
  var TABS = [
    ['summary', '요약'], ['check', '데이터 점검'], ['coverage', '데이터 현황'], ['rates', '이수율 현황'],
    ['notdone', '이수자·미이수자 명단'], ['noexam', '미응시·재응시'], ['pending', '보류·직군변경'],
    ['dup', '중복자 확인'], ['courses', '과목별 현황'], ['person', '개인 조회'], ['settings', '설정·도움말']
  ];
  function renderTabsBar() {
    var t = $('#tabs'); t.innerHTML = '';
    TABS.forEach(function (x) {
      var b = el('button', { class: 'tab' + (state.activeTab === x[0] ? ' on' : '') }, x[1]);
      if (x[0] === 'check' && state.diag) {
        var e = state.diag.issues.filter(function (i) { return i.level === 'err'; }).length;
        var w = state.diag.issues.filter(function (i) { return i.level === 'warn'; }).length;
        if (e) b.appendChild(el('span', { class: 'tabbadge err' }, String(e)));
        else if (w) b.appendChild(el('span', { class: 'tabbadge warn' }, String(w)));
      }
      b.onclick = function () { state.activeTab = x[0]; renderTabsBar(); renderTab(); };
      t.appendChild(b);
    });
  }
  function renderTab() {
    renderStatus(); renderTabsBar();
    var c = $('#content'); c.innerHTML = '';
    if (state.activeTab === 'settings') return renderSettings(c);
    if (state.activeTab === 'person') return renderPerson(c);
    if (state.activeTab === 'coverage') return renderCoverage(c);
    if (state.activeTab === 'check') return renderCheck(c);
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
  function note(c, html, cls) { var n = el('div', { class: 'note' + (cls ? ' ' + cls : '') }); n.innerHTML = html; c.appendChild(n); return n; }

  /* ══════════════════════════════════════════════════════════════════════
   *  요약
   * ══════════════════════════════════════════════════════════════════════ */
  function renderSummary(c) {
    var k = state.result.kpi, cfg = state.config;
    var kp = el('div', { class: 'kpis' });
    kp.appendChild(kpiCard('교육대상자', fmt(k.대상자) + '<small>명</small>', 'accent'));
    kp.appendChild(kpiCard('이수자', fmt(k.이수자) + '<small>명</small>', 'good'));
    kp.appendChild(kpiCard('미이수자', fmt(k.미이수자) + '<small>명</small>', 'bad'));
    kp.appendChild(kpiCard('전체 이수율', pct(k.이수율), 'accent'));
    kp.appendChild(kpiCard('재응시 필요(미응시)', fmt(k.재응시필요인원) + '<small>명</small>', 'warn', '진도' + cfg.examNoShow.progressGte + '·점수' + cfg.examNoShow.scoreLte));
    c.appendChild(kp);

    // [ver9] 직전 저장분 대비 증감(F-09)
    var prev = state.snapshots.length ? state.snapshots[state.snapshots.length - 1] : null;
    if (prev) {
      var dP = k.이수자 - prev.kpi.이수자, dR = k.이수율 - prev.kpi.이수율, dT = k.대상자 - prev.kpi.대상자;
      var sign = function (n, unit, digits) { var s = n > 0 ? '+' : (n < 0 ? '−' : '±'); return s + Math.abs(digits ? +n.toFixed(digits) : n).toLocaleString('ko-KR') + unit; };
      note(c, '<b>직전 저장분(' + esc(prev.일시.slice(0, 16).replace('T', ' ')) + ') 대비</b> — 이수자 <b class="' + (dP >= 0 ? 'up' : 'down') + '">' + sign(dP, '명') + '</b> · ' +
        '이수율 <b class="' + (dR >= 0 ? 'up' : 'down') + '">' + sign(dR, '%p', 2) + '</b> · 대상자 ' + sign(dT, '명') + ' <span class="muted">(설정 탭에서 현재 집계를 저장하면 다음 비교 기준이 됩니다)</span>', 'info');
    }

    // [ver9] 안내문을 설정값에서 직접 만든다(D-11)
    var thr = ['생활지원사', '전담사회복지사'].map(function (g) { return g + ' ' + (cfg.thresholds[g] || 0); }).join(' · ');
    if (cfg.seniorThreshold != null && cfg.seniorThreshold !== '') thr += ' · 선임생활지원사 ' + cfg.seniorThreshold;
    var changed = JSON.stringify(cfg.thresholds) !== JSON.stringify(LMS.DEFAULT_CONFIG.thresholds) ||
      (cfg.allowedSido || []).join() !== LMS.DEFAULT_SIDO.join() || (cfg.seniorThreshold != null && cfg.seniorThreshold !== '');
    note(c, '집계 기준: <b>' + (cfg.allowedSido || []).length + '개 시도</b>(' + esc((cfg.allowedSido || []).join(', ')) + ') · 교육대상여부 <b>' + esc(cfg.universeFilter['교육대상여부']) + '</b> · 회원상태 <b>' + esc(cfg.universeFilter['상태']) + '</b>인 <b>생활지원사·전담사회복지사</b> 대상. ' +
      '신규자=필수 수료 / 경력자=필수 수료+선택 차시(' + esc(thr) + '차시) 충족 시 <b>이수</b>. 수강취소 ' + fmt(k.수강취소제외) + '건 제외. ' +
      (k.기준미정의대상 ? '이수기준 미정의(중간관리자/기타 등) ' + fmt(k.기준미정의대상) + '명은 별도 분류. ' : '') +
      (changed ? '<b class="warntxt">※ 기본값에서 변경된 설정이 적용 중입니다.</b>' : ''), 'info');

    // 예외 인원 안내
    if (k.지역외제외) note(c, '대상 시도 밖(중앙·미상 등)이라 통계에서 제외된 교육대상 인원: <b>' + fmt(k.지역외제외) + '명</b>' + (k.지역외수강행 ? ' · 관련 수강 행 ' + fmt(k.지역외수강행) + '건' : '') + ' (대상 시도는 설정에서 변경 가능).');
    if (k.회원정보없는ID수) note(c, '회원정보에 없는 ID의 수강기록 <b>' + fmt(k.회원정보없는ID행) + '행</b>(<b>' + fmt(k.회원정보없는ID수) + '명</b>)이 전량 제외되었습니다. <b>데이터 점검</b> 탭에서 명단을 내려받아 회원정보를 갱신하세요.', 'warnnote');
    if (k.보류미검토) note(c, '직군 변경(전직) 가능성으로 <b>검토 대기</b> 중인 건: <b>' + fmt(k.보류미검토) + '명</b> — <b>보류·직군변경</b> 탭에서 승인/반려해 주세요. (현재 미이수로 집계되며, 이수자·미이수자 명단에는 나타나지 않습니다)');
    if (k.대상자중수강기록없음) note(c, '교육대상자 중 수강 기록이 전혀 없는 인원: <b>' + fmt(k.대상자중수강기록없음) + '명</b> (전원 미이수 — 명단 탭에서 “수강기록 없음”으로 걸러 내려받을 수 있습니다).');
    if (k.차수없는이수자) note(c, '이수자 중 <b>차수를 확인할 수 없는 인원 ' + fmt(k.차수없는이수자) + '명</b> — 수료 기록의 <code>연도/차수</code>가 비어 있어 <b>산출기간(차수·이수일자 기준) 집계에서 빠집니다.</b> 데이터 점검 탭을 확인하세요.', 'warnnote');
    if (k.점수미기재제외) note(c, '점수가 비어 있어 미응시 판정에서 제외한 행: <b>' + fmt(k.점수미기재제외) + '건</b> (설정에서 “점수 미기재를 0점으로 간주”를 켜면 포함됩니다).');
    var uk = Object.keys(state.result.unknownChasi || {});
    if (uk.length) note(c, '차시 매핑이 없는 선택과목 ' + uk.length + '건: ' + esc(uk.slice(0, 6).join(', ')) + '. <b>설정</b>에서 차시를 추가하면 경력자 이수 계산에 반영됩니다.');

    c.appendChild(renderRateTable());
    if (state.result.byRound && state.result.byRound.length > 1) c.appendChild(renderTrend());

    var card = el('div', { class: 'card' });
    card.appendChild(el('h2', {}, '직군·경력별 이수 현황'));
    card.appendChild(el('p', { class: 'desc' }, '헤드라인 이수율 대상(생활지원사·전담사회복지사)'));
    dataTable(card, [
      { key: 'key', label: '구분' },
      { key: '대상자', label: '대상자', num: true, render: fmt },
      { key: '이수자', label: '이수자', num: true, render: fmt },
      { key: '미이수자', label: '미이수자', num: true, render: fmt },
      { key: '이수율', label: '이수율', num: true, render: barCell, exp: function (v) { return v.toFixed(1); } }
    ], state.result.byGroup, { pageSize: 10, sortKey: '대상자' });
    c.appendChild(card);
  }

  /* ---------- 차수별 이수 추이 (F-08) --------------------------------- */
  function renderTrend() {
    var rows = state.result.byRound;
    var card = el('div', { class: 'card' });
    var head = el('div', { class: 'head' });
    head.appendChild(el('div', { html: '<h2>차수별 이수 추이</h2><p class="desc">이수자를 필수과정 수료 차수 기준으로 묶은 누적 곡선입니다. 차수를 확인할 수 없는 이수자는 제외됩니다.</p>' }));
    head.appendChild(expBtn(rows, [
      { key: '차수', label: '차수' }, { key: '이수자', label: '해당 차수 이수자' }, { key: '누적이수자', label: '누적 이수자' },
      { key: '누적이수율', label: '누적 이수율(%)', exp: function (v) { return v.toFixed(1); } }
    ], '차수별_이수추이.xlsx'));
    card.appendChild(head);

    var W = 900, H = 220, PL = 52, PR = 16, PT = 14, PB = 30;
    var maxY = Math.max.apply(null, rows.map(function (r) { return r.누적이수자; })) || 1;
    var xs = function (i) { return PL + (W - PL - PR) * (rows.length === 1 ? 0.5 : i / (rows.length - 1)); };
    var ys = function (v) { return PT + (H - PT - PB) * (1 - v / maxY); };
    var pts = rows.map(function (r, i) { return xs(i) + ',' + ys(r.누적이수자); });
    var area = 'M' + xs(0) + ',' + (H - PB) + ' L' + pts.join(' L') + ' L' + xs(rows.length - 1) + ',' + (H - PB) + ' Z';
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" class="trend" role="img" aria-label="차수별 누적 이수자 추이">'];
    for (var g = 0; g <= 4; g++) {
      var yv = maxY * g / 4, y = ys(yv);
      svg.push('<line x1="' + PL + '" y1="' + y + '" x2="' + (W - PR) + '" y2="' + y + '" class="grid"/>');
      svg.push('<text x="' + (PL - 8) + '" y="' + (y + 4) + '" class="axis" text-anchor="end">' + Math.round(yv).toLocaleString('ko-KR') + '</text>');
    }
    svg.push('<path d="' + area + '" class="tarea"/>');
    svg.push('<polyline points="' + pts.join(' ') + '" class="tline"/>');
    rows.forEach(function (r, i) {
      var last = i === rows.length - 1;
      svg.push('<circle cx="' + xs(i) + '" cy="' + ys(r.누적이수자) + '" r="' + (last ? 5 : 3) + '" class="tdot' + (last ? ' last' : '') + '"><title>' + r.차수 + '차 · 누적 ' + r.누적이수자.toLocaleString('ko-KR') + '명 (' + r.누적이수율.toFixed(1) + '%)</title></circle>');
      if (rows.length <= 20 || i % Math.ceil(rows.length / 14) === 0 || last)
        svg.push('<text x="' + xs(i) + '" y="' + (H - PB + 18) + '" class="axis" text-anchor="middle">' + r.차수 + '</text>');
    });
    // 누적 곡선은 왼쪽 아래에서 시작해 올라가므로, 요약 라벨은 항상 비어 있는 좌측 상단에 둔다.
    var lastRow = rows[rows.length - 1];
    svg.push('<text x="' + (PL + 8) + '" y="' + (PT + 14) + '" class="tlab" text-anchor="start">누적 ' + lastRow.누적이수자.toLocaleString('ko-KR') + '명 · ' + lastRow.누적이수율.toFixed(1) + '% (' + lastRow.차수 + '차까지)</text>');
    svg.push('</svg>');
    var box = el('div', { class: 'trendwrap' }); box.innerHTML = svg.join('');
    card.appendChild(box);
    return card;
  }

  /* ---------- 이수율 현황표 ------------------------------------------- */
  function getAlloc() { if (!state.config.alloc) state.config.alloc = {}; return state.config.alloc; }
  function renderRateTable() {
    var DIRS = ['전담사회복지사', '생활지원사'];
    var alloc = getAlloc();
    if (!state.config.period) state.config.period = { mode: 'all', from: '', to: '' };
    var period = state.config.period;

    function inPeriod(p) {
      if (period.mode === 'round') {
        var f = (period.from !== '' && period.from != null) ? +period.from : null;
        var t = (period.to !== '' && period.to != null) ? +period.to : null;
        if (f == null && t == null) return true;
        if (p.차수 == null) return false;
        if (f != null && p.차수 < f) return false;
        if (t != null && p.차수 > t) return false;
        return true;
      }
      if (period.mode === 'date') {
        var f2 = period.from || '', t2 = period.to || '';
        if (!f2 && !t2) return true;
        if (!p.이수일자) return false;
        if (f2 && p.이수일자 < f2) return false;
        if (t2 && p.이수일자 > t2) return false;
        return true;
      }
      return true;
    }
    function periodLabel() {
      if (period.mode === 'round') {
        if (!period.from && !period.to) return '전체 (차수 미지정)';
        return (period.from ? period.from + '차' : '처음') + ' ~ ' + (period.to ? period.to + '차' : '최신') + ' (차수 기준)';
      }
      if (period.mode === 'date') {
        if (!period.from && !period.to) return '전체 (기간 미지정)';
        return (period.from || '처음') + ' ~ ' + (period.to || '최신') + ' (이수일자 기준)';
      }
      return '전체';
    }
    var plabel = periodLabel();

    var ppl = (state.result.persons || []).filter(function (p) { return p.기준정의; });
    var excluded = 0;
    var rows = DIRS.map(function (d) {
      var nvA = 0, exA = 0, target = 0;
      ppl.forEach(function (p) {
        if (p.직군정규화 !== d) return;
        target++;
        if (!p.이수) return;
        if (!inPeriod(p)) { excluded++; return; }
        if (p.경력 === '신규자') nvA++; else if (p.경력 === '경력자') exA++;
      });
      var al = alloc[d] || {}; var B = parseInt(al.배정) || 0, C = parseInt(al.채용) || 0;
      return { dir: d, 신규: nvA, 경력: exA, 소계: nvA + exA, 교육대상: target, 배정: B, 채용: C };
    });
    var tot = rows.reduce(function (o, r) { return { 신규: o.신규 + r.신규, 경력: o.경력 + r.경력, 소계: o.소계 + r.소계, 교육대상: o.교육대상 + r.교육대상, 배정: o.배정 + r.배정, 채용: o.채용 + r.채용 }; }, { 신규: 0, 경력: 0, 소계: 0, 교육대상: 0, 배정: 0, 채용: 0 });

    var card = el('div', { class: 'card' });
    var head = el('div', { class: 'head' });
    head.appendChild(el('div', { html: '<h2>이수율 현황표</h2><p class="desc">교육대상·배정인원(B)·채용인원(C) 대비 이수율. 산출기간은 이수인원(A)에만 적용되고, 교육대상·배정·채용은 전체 기준입니다.</p>' }));
    var expRows = rows.concat([{ dir: '총계', 신규: tot.신규, 경력: tot.경력, 소계: tot.소계, 교육대상: tot.교육대상, 배정: tot.배정, 채용: tot.채용 }]);
    var eb = el('button', { class: 'btn sec sm' }, '엑셀 다운로드');
    eb.onclick = function () {
      var aoa = [['이수율 현황표'], ['산출기간: ' + plabel], ['배정·채용 기준: ' + (state.config.allocNote || '-')],
        ['도구 버전: ' + VERSION + ' · 생성: ' + new Date().toLocaleString('ko-KR')], [],
        ['직군', '신규자', '경력자', '이수인원(A)', '교육대상', '배정인원(B)', '채용인원(C)', '대상대비(%)', 'A/B(%)', 'A/C(%)']];
      expRows.forEach(function (r) {
        aoa.push([r.dir, r.신규, r.경력, r.소계, r.교육대상, r.배정, r.채용,
          r.교육대상 ? +(100 * r.소계 / r.교육대상).toFixed(1) : '', r.배정 ? +(100 * r.소계 / r.배정).toFixed(1) : '', r.채용 ? +(100 * r.소계 / r.채용).toFixed(1) : '']);
      });
      var ws = XLSX.utils.aoa_to_sheet(aoa); var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '이수율현황표'); XLSX.writeFile(wb, '이수율_현황표.xlsx');
    };
    head.appendChild(eb);
    card.appendChild(head);

    // 산출기간 설정
    var pbar = el('div', { class: 'toolbar' });
    pbar.appendChild(el('span', { class: 'hint' }, '산출기간:'));
    var modeSel = el('select');
    [['all', '전체'], ['round', '차수 기준'], ['date', '이수일자 기준']].forEach(function (o) { modeSel.appendChild(el('option', { value: o[0] }, o[1])); });
    modeSel.value = period.mode;
    modeSel.onchange = function () { period.mode = modeSel.value; period.from = ''; period.to = ''; saveConfig(); renderTab(); };
    pbar.appendChild(modeSel);
    if (period.mode === 'round') {
      var maxR = (state.coverage && state.coverage.summary && state.coverage.summary.최신차수) || '';
      var rf = el('input', { type: 'number', placeholder: '시작차수', style: 'width:100px' }); rf.value = period.from || '';
      var rt = el('input', { type: 'number', placeholder: '끝차수', style: 'width:100px' }); rt.value = period.to || '';
      rf.onchange = function () { period.from = rf.value; saveConfig(); renderTab(); };
      rt.onchange = function () { period.to = rt.value; saveConfig(); renderTab(); };
      pbar.appendChild(rf); pbar.appendChild(el('span', { class: 'hint' }, '~')); pbar.appendChild(rt);
      if (maxR) pbar.appendChild(el('span', { class: 'hint' }, '(데이터 보유: 1~' + maxR + '차)'));
    } else if (period.mode === 'date') {
      var df = el('input', { type: 'date' }); df.value = period.from || '';
      var dt = el('input', { type: 'date' }); dt.value = period.to || '';
      df.onchange = function () { period.from = df.value; saveConfig(); renderTab(); };
      dt.onchange = function () { period.to = dt.value; saveConfig(); renderTab(); };
      pbar.appendChild(df); pbar.appendChild(el('span', { class: 'hint' }, '~')); pbar.appendChild(dt);
      pbar.appendChild(el('span', { class: 'hint' }, '(이수일자 = 필수과정 수료 확정일)'));
    }
    card.appendChild(pbar);

    var hd = el('div', { class: 'note info' });
    hd.innerHTML = '(이수인원) 총 <b>' + fmt(tot.소계) + '명</b> (전담사회복지사 ' + fmt(rows[0].소계) + '명, 생활지원사 ' + fmt(rows[1].소계) + '명) · 산출기간: <b>' + esc(plabel) + '</b>' +
      (excluded ? ' <span class="warntxt">· 산출기간 밖으로 빠진 이수자 ' + fmt(excluded) + '명</span>' : '');
    card.appendChild(hd);
    if (period.mode !== 'all' && state.result.kpi.차수없는이수자)
      note(card, '산출기간을 적용하면 <b>차수·이수일자를 확인할 수 없는 이수자 ' + fmt(state.result.kpi.차수없는이수자) + '명</b>은 집계에서 빠집니다. 전체 기준과 합계가 다를 수 있습니다.', 'warnnote');

    var tw = el('div', { class: 'tablewrap' }); var table = el('table');
    table.innerHTML = '<thead>' +
      '<tr><th rowspan="2">직군</th><th colspan="3" style="text-align:center">이수인원(A)</th><th rowspan="2" class="num">교육대상</th><th rowspan="2" class="num">배정인원(B)</th><th rowspan="2" class="num">채용인원(C)</th><th rowspan="2" class="num">대상대비</th><th rowspan="2" class="num">A/B</th><th rowspan="2" class="num">A/C</th></tr>' +
      '<tr><th class="num">신규자</th><th class="num">경력자</th><th class="num">소계</th></tr></thead>';
    var tb = el('tbody'); table.appendChild(tb);
    function ratio(a, b) { return b ? (100 * a / b).toFixed(1) : '-'; }

    // [ver9] 배정·채용 입력은 표 전체를 다시 그리지 않고 해당 칸만 갱신한다(D-13).
    var cellRefs = [];
    function refreshRatios() {
      var t = { 배정: 0, 채용: 0 };
      cellRefs.forEach(function (ref) {
        var al = alloc[ref.row.dir] || {};
        ref.row.배정 = parseInt(al.배정) || 0; ref.row.채용 = parseInt(al.채용) || 0;
        t.배정 += ref.row.배정; t.채용 += ref.row.채용;
        ref.ab.textContent = ratio(ref.row.소계, ref.row.배정);
        ref.ac.textContent = ratio(ref.row.소계, ref.row.채용);
      });
      totRefs.배정.textContent = fmt(t.배정); totRefs.채용.textContent = fmt(t.채용);
      totRefs.ab.textContent = ratio(tot.소계, t.배정); totRefs.ac.textContent = ratio(tot.소계, t.채용);
      expRows[expRows.length - 1].배정 = t.배정; expRows[expRows.length - 1].채용 = t.채용;
    }
    var totRefs = {};

    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', {}, r.dir));
      tr.appendChild(el('td', { class: 'num' }, fmt(r.신규)));
      tr.appendChild(el('td', { class: 'num' }, fmt(r.경력)));
      tr.appendChild(el('td', { class: 'num' }, fmt(r.소계)));
      tr.appendChild(el('td', { class: 'num' }, fmt(r.교육대상)));
      ['배정', '채용'].forEach(function (kk) {
        var td = el('td', { class: 'num' });
        var inp = el('input', { type: 'number', min: '0', value: (alloc[r.dir] && alloc[r.dir][kk]) || '', style: 'width:84px;text-align:right' });
        inp.placeholder = '0';
        // 인쇄 시에는 입력칸이 숨겨지므로 같은 값을 텍스트로도 함께 둔다(F-11).
        var ptxt = el('span', { class: 'printonly' }, fmt(parseInt(inp.value) || 0));
        inp.oninput = function () {
          if (!alloc[r.dir]) alloc[r.dir] = {};
          alloc[r.dir][kk] = parseInt(inp.value) || 0;
          ptxt.textContent = fmt(alloc[r.dir][kk]); refreshRatios();
        };
        inp.onchange = function () { saveConfig(); };
        td.appendChild(inp); td.appendChild(ptxt); tr.appendChild(td);
      });
      var tdTarget = el('td', { class: 'num' }, ratio(r.소계, r.교육대상));
      var tdAB = el('td', { class: 'num' }, ratio(r.소계, r.배정));
      var tdAC = el('td', { class: 'num' }, ratio(r.소계, r.채용));
      tr.appendChild(tdTarget); tr.appendChild(tdAB); tr.appendChild(tdAC);
      cellRefs.push({ row: r, ab: tdAB, ac: tdAC });
      tb.appendChild(tr);
    });
    var ttr = el('tr', { class: 'totalrow' });
    ttr.appendChild(el('td', {}, '총계'));
    ttr.appendChild(el('td', { class: 'num' }, fmt(tot.신규)));
    ttr.appendChild(el('td', { class: 'num' }, fmt(tot.경력)));
    ttr.appendChild(el('td', { class: 'num' }, fmt(tot.소계)));
    ttr.appendChild(el('td', { class: 'num' }, fmt(tot.교육대상)));
    totRefs.배정 = el('td', { class: 'num' }, fmt(tot.배정)); ttr.appendChild(totRefs.배정);
    totRefs.채용 = el('td', { class: 'num' }, fmt(tot.채용)); ttr.appendChild(totRefs.채용);
    ttr.appendChild(el('td', { class: 'num' }, ratio(tot.소계, tot.교육대상)));
    totRefs.ab = el('td', { class: 'num' }, ratio(tot.소계, tot.배정)); ttr.appendChild(totRefs.ab);
    totRefs.ac = el('td', { class: 'num' }, ratio(tot.소계, tot.채용)); ttr.appendChild(totRefs.ac);
    tb.appendChild(ttr);
    tw.appendChild(table); card.appendChild(tw);

    var noteWrap = el('div', { class: 'toolbar', style: 'margin-top:8px' });
    noteWrap.appendChild(el('span', { class: 'hint' }, '※ 배정·채용인원 기준일/메모:'));
    var noteInp = el('input', { type: 'text', value: state.config.allocNote || '', placeholder: "예: 모인우리 '26.3.31. 기준", style: 'min-width:280px' });
    noteInp.onchange = function () { state.config.allocNote = noteInp.value; saveConfig(); };
    noteWrap.appendChild(noteInp);
    var pb = el('button', { class: 'btn sec sm' }, '인쇄 / PDF 저장');
    pb.onclick = function () { window.print(); };
    noteWrap.appendChild(pb);
    card.appendChild(noteWrap);
    return card;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  데이터 점검 (F-01 · F-02)
   * ══════════════════════════════════════════════════════════════════════ */
  function renderCheck(c) {
    var card0 = el('div', { class: 'card' });
    card0.appendChild(el('h2', {}, '데이터 점검'));
    card0.appendChild(el('p', { class: 'desc' }, '올린 원데이터가 기대한 대로 읽혔는지 확인합니다. 집계 숫자가 이상할 때 가장 먼저 볼 화면입니다.'));
    if (!state.diag) {
      card0.appendChild(el('div', { class: 'muted', style: 'padding:26px 0' }, '회원정보와 수강생목록을 올리면 점검 결과가 표시됩니다.'));
      c.appendChild(card0); return;
    }
    var dg = state.diag;
    var errs = dg.issues.filter(function (x) { return x.level === 'err'; });
    var warns = dg.issues.filter(function (x) { return x.level === 'warn'; });
    if (!dg.issues.length) {
      card0.appendChild(el('div', { class: 'empty-state', html: '<div class="big">✅</div>모든 값이 정상적으로 인식되었습니다.<div class="muted" style="margin-top:6px">카테고리·시도·직군·날짜·차수 형식에서 이상이 발견되지 않았습니다.</div>' }));
      c.appendChild(card0);
    } else {
      var sum = el('div', { class: 'toolbar' });
      sum.innerHTML = '<span class="filechip ' + (errs.length ? 'bad' : '') + '">오류 <b>' + errs.length + '</b></span><span class="filechip ' + (warns.length ? 'warn' : '') + '">주의 <b>' + warns.length + '</b></span>';
      card0.appendChild(sum);
      var list = el('div', { class: 'issues' });
      dg.issues.forEach(function (it) {
        var d = el('div', { class: 'issue ' + it.level });
        d.innerHTML = '<div class="ihead"><span class="ibadge">' + (it.level === 'err' ? '오류' : '주의') + '</span><b>' + esc(it.항목) + '</b></div><div class="ibody">' + esc(it.내용) + '</div>';
        list.appendChild(d);
      });
      card0.appendChild(list);
      c.appendChild(card0);
    }

    // 회원정보 값 분포
    if (dg.member) {
      var c1 = el('div', { class: 'card' });
      c1.appendChild(el('h2', {}, '회원정보 열별 값 분포'));
      c1.appendChild(el('p', { class: 'desc' }, '총 ' + fmt(dg.member.행수) + '행 · 인식된 값과 인식되지 않은 값을 나눠 표시합니다. 인식되지 않은 값은 집계에서 빠집니다.'));
      var rows = [];
      Object.keys(dg.member.열).forEach(function (col) {
        var f = dg.member.열[col];
        f.인식.forEach(function (x) { rows.push({ 열: col, 값: x.값, 건수: x.건수, 판정: '인식' }); });
        f.미인식.forEach(function (x) { rows.push({ 열: col, 값: x.값, 건수: x.건수, 판정: '미인식' }); });
      });
      dataTable(c1, [
        { key: '열', label: '열' }, { key: '값', label: '값', render: txt },
        { key: '건수', label: '행수', num: true, render: fmt },
        { key: '판정', label: '판정', render: function (v) { return v === '인식' ? '<span class="pill y">인식</span>' : '<span class="pill n">미인식</span>'; }, exp: function (v) { return v; } }
      ], rows, { pageSize: 20, sortKey: '건수' });
      if (dg.member.중복ID.length) {
        var h = el('div', { class: 'head', style: 'margin-top:14px' });
        h.appendChild(el('div', { html: '<h2 style="font-size:14px">중복 ID (' + dg.member.중복ID.length + '명)</h2><p class="desc">같은 ID가 여러 행에 있어 마지막 행만 사용했습니다.</p>' }));
        h.appendChild(expBtn(dg.member.중복ID, [{ key: 'ID', label: 'ID' }, { key: '행수', label: '행수' }], '회원정보_중복ID.xlsx'));
        c1.appendChild(h);
        dataTable(c1, [{ key: 'ID', label: 'ID', render: txt }, { key: '행수', label: '행수', num: true }], dg.member.중복ID, { pageSize: 10, sortKey: '행수' });
      }
      c.appendChild(c1);
    }

    // 수강생목록 형식 점검
    if (dg.student) {
      var c2 = el('div', { class: 'card' });
      c2.appendChild(el('h2', {}, '수강생목록 형식 점검'));
      c2.appendChild(el('p', { class: 'desc' }, '총 ' + fmt(dg.student.행수) + '행'));
      var g = el('div', { class: 'checkgrid' });
      function box(title, okN, badN, detail) {
        var d = el('div', { class: 'checkbox ' + (badN ? 'bad' : 'ok') });
        d.innerHTML = '<div class="ct">' + esc(title) + '</div><div class="cn">' + fmt(okN) + ' <span class="cu">정상</span>' + (badN ? ' · <b>' + fmt(badN) + ' 이상</b>' : '') + '</div>' + (detail ? '<div class="cd">' + esc(detail) + '</div>' : '');
        return d;
      }
      var cat = dg.student.카테고리;
      g.appendChild(box('카테고리', cat.인식건수, cat.미인식건수, cat.미인식.slice(0, 3).map(function (x) { return x.값 + '(' + x.건수 + ')'; }).join(', ')));
      ['수료일', '교육신청일'].forEach(function (k) {
        var d = dg.student.날짜[k];
        var bad = d.이상.reduce(function (s, x) { return s + x.건수; }, 0);
        g.appendChild(box(k, d.정상, bad, (bad ? d.이상.slice(0, 3).map(function (x) { return x.값 + '(' + x.건수 + ')'; }).join(', ') + ' · ' : '') + '빈칸 ' + fmt(d.빈칸)));
      });
      var rbad = dg.student.차수.이상.reduce(function (s, x) { return s + x.건수; }, 0);
      g.appendChild(box('연도/차수', dg.student.차수.정상, rbad, dg.student.차수.이상.slice(0, 3).map(function (x) { return x.값 + '(' + x.건수 + ')'; }).join(', ')));
      var pbad = dg.student.과정명.필수_직군경력_미추출.reduce(function (s, x) { return s + x.건수; }, 0);
      g.appendChild(box('필수 과정명 인식', dg.student.행수 - pbad, pbad, dg.student.과정명.필수_직군경력_미추출.slice(0, 2).map(function (x) { return x.값; }).join(', ')));
      var sbad = dg.student.과정명.선택_차시미매핑.reduce(function (s, x) { return s + x.건수; }, 0);
      g.appendChild(box('선택과목 차시 매핑', dg.student.행수 - sbad, sbad, dg.student.과정명.선택_차시미매핑.slice(0, 3).map(function (x) { return x.값; }).join(', ')));
      c2.appendChild(g);
      c.appendChild(c2);
    }

    // 회원정보에 없는 ID (F-02)
    var unk = (state.result && state.result.unknownIDs) || [];
    var c3 = el('div', { class: 'card' });
    var h3 = el('div', { class: 'head' });
    h3.appendChild(el('div', { html: '<h2>회원정보에 없는 ID</h2><p class="desc">수강기록은 있으나 회원정보에 없어 <b>전량 제외된</b> 인원입니다. 그대로 회원정보 갱신 요청 명단으로 쓸 수 있습니다.</p>' }));
    var unkCols = [
      { key: 'ID', label: 'ID', render: txt }, { key: '성명', label: '성명', render: txt },
      { key: '시도', label: '시도', render: txt }, { key: '시군구', label: '시군구', render: txt },
      { key: '기관코드', label: '기관코드', render: txt }, { key: '기관명', label: '수행기관', render: txt },
      { key: '직군', label: '직급(수강기록 기준)', render: txt }, { key: '건수', label: '수강 행수', num: true, render: fmt }
    ];
    h3.appendChild(expBtn(unk, unkCols, '회원정보없는ID.xlsx', '엑셀 다운로드(' + fmt(unk.length) + ')'));
    c3.appendChild(h3);
    if (!unk.length) c3.appendChild(el('div', { class: 'empty-state', html: '<div class="big">✅</div>모든 수강기록의 ID가 회원정보에 있습니다.' }));
    else dataTable(c3, unkCols, unk, { pageSize: 30, sortKey: '건수' });
    c.appendChild(c3);
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  이수율 현황 (시도 트리)
   * ══════════════════════════════════════════════════════════════════════ */
  function renderRates(c) {
    var card = el('div', { class: 'card' });
    var head = el('div', { class: 'head' });
    head.appendChild(el('div', { html: '<h2>시도별 이수 현황</h2><p class="desc">행을 클릭하면 시군구 → 기관으로 펼쳐집니다</p>' }));
    head.appendChild(expBtn(state.result.bySido, [
      { key: 'key', label: '시도' }, { key: '대상자', label: '대상자' }, { key: '이수자', label: '이수자' },
      { key: '미이수자', label: '미이수자' }, { key: '이수율', label: '이수율(%)', exp: function (v) { return +v.toFixed(1); } }
    ], '시도별_이수현황.xlsx'));
    card.appendChild(head);
    var tw = el('div', { class: 'tablewrap' }); var table = el('table', { class: 'tree' });
    table.innerHTML = '<thead><tr><th>지역 / 기관</th><th class="num">대상자</th><th class="num">이수자</th><th class="num">미이수</th><th class="num" style="min-width:160px">이수율</th></tr></thead>';
    var tb = el('tbody'); table.appendChild(tb);
    var tree = state.result.sidoTree;
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

    var card2 = el('div', { class: 'card' });
    card2.appendChild(el('div', { class: 'head', html: '<div><h2>직군·경력별 이수율</h2></div>' }));
    dataTable(card2, [
      { key: 'key', label: '구분' }, { key: '대상자', label: '대상자', num: true, render: fmt }, { key: '이수자', label: '이수자', num: true, render: fmt },
      { key: '미이수자', label: '미이수자', num: true, render: fmt }, { key: '이수율', label: '이수율', num: true, render: barCell }
    ], state.result.byGroup, { pageSize: 10, sortKey: '대상자' });
    c.appendChild(card2);
  }

  /* ---------- 필터 바 -------------------------------------------------- */
  function filterBar(opts, fields, onChange) {
    var tb = el('div', { class: 'toolbar' });
    var sels = {};
    fields.forEach(function (f) {
      var lab = el('label', { class: 'fld' }, f.label);
      var s = el('select'); s.appendChild(el('option', { value: '' }, '전체'));
      f.options.forEach(function (o) { s.appendChild(el('option', { value: o }, o)); });
      s.onchange = onChange; lab.appendChild(s); sels[f.key] = s; tb.appendChild(lab);
    });
    if (opts.searchKey) {
      var lab2 = el('label', { class: 'fld' }, opts.searchLabel || '검색');
      var inp = el('input', { type: 'text', placeholder: opts.searchPlaceholder || '' }); inp.oninput = onChange; lab2.appendChild(inp); tb.appendChild(lab2); sels.__search = inp;
    }
    return { node: tb, sels: sels };
  }
  function uniq(rows, key) { var s = {}; rows.forEach(function (r) { if (r[key] != null && r[key] !== '') s[r[key]] = 1; }); return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'ko'); }); }
  function matches(q, r, keys) {
    if (!q) return true;
    for (var i = 0; i < keys.length; i++) { if (String(r[keys[i]] == null ? '' : r[keys[i]]).toLowerCase().indexOf(q) >= 0) return true; }
    return false;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  이수자·미이수자 명단
   * ══════════════════════════════════════════════════════════════════════ */
  function personListCols() {
    return [
      { key: '_no', label: '연번', num: true },
      { key: '시도', label: '시도', render: txt }, { key: '시군구', label: '시군구', render: txt },
      { key: '기관코드', label: '기관코드', render: txt }, { key: '기관명', label: '수행기관', render: txt },
      { key: 'ID', label: 'ID', render: txt }, { key: '성명', label: '성명', render: txt },
      { key: '직군', label: '직급', render: txt }, { key: '경력', label: '경력', render: txt },
      { key: '차수', label: '차수', num: true, render: function (v) { return v == null ? '-' : v + '차'; }, exp: function (v) { return v == null ? '' : v; } },
      { key: '이수일자', label: '이수일자', render: function (v) { return v || '-'; }, exp: function (v) { return v || ''; } },
      { key: '이수', label: '이수여부', render: yn, exp: function (v) { return v ? '이수' : '미이수'; } },
      // [ver9] 미이수 사유를 명단·엑셀에 함께 내보낸다(F-03)
      { key: '사유', label: '미이수 사유', render: txt },
      { key: '추천과목', label: '남은 선택과목(권장)', render: txt }
    ];
  }
  function renderNotDone(c) {
    var rows = (state.result.persons || []).filter(function (p) { return p.기준정의 && !(p.보류후보 && p.보류상태 === 'pending'); });
    var k = state.result.kpi;
    var card = el('div', { class: 'card' });
    var cols = personListCols();
    var fb = filterBar({ searchKey: 1, searchLabel: '검색(ID·성명·기관)', searchPlaceholder: '예: 홍길동' }, [
      { key: '이수여부', label: '이수여부', options: ['이수자만', '미이수자만'] },
      { key: '시도', label: '시도', options: uniq(rows, '시도') },
      { key: '직군', label: '직군', options: uniq(rows, '직군') },
      { key: '경력', label: '경력', options: uniq(rows, '경력') },
      { key: '수강', label: '수강기록', options: ['수강기록 없음', '수강기록 있음'] },
      { key: '선임', label: '선임', options: ['선임만', '비선임만'] }
    ], apply);
    fb.sels['이수여부'].value = '미이수자만';
    var head = el('div', { class: 'head' });
    head.appendChild(el('div', { html: '<h2>이수자·미이수자 명단</h2><p class="desc">대상자의 이수/미이수 현황. 연번·정렬은 차수 → 이수일자 순입니다. <b>이수일자는 필수과정을 수료 확정한 날짜</b>이며, 경력자는 이후 선택과목을 채워 최종 이수가 확정될 수 있어 실제 이수 확정일과 다를 수 있습니다.</p>' }));
    var expHolder = el('div', { class: 'btnrow' }); head.appendChild(expHolder);
    card.appendChild(head);
    // [ver9] 요약 KPI와 명단 건수가 다른 이유를 화면에 명시한다(D-09)
    if (k.보류미검토) note(card, '요약의 <b>미이수자 ' + fmt(k.미이수자) + '명</b>에는 <b>보류 미검토 ' + fmt(k.보류미검토) + '명</b>이 포함되어 있습니다. 이 명단에는 나타나지 않으므로 <b>이수자 명단 + 미이수자 명단 = 대상자</b>가 되지 않습니다. 보류 건을 모두 검토하면 일치합니다.', 'warnnote');
    card.appendChild(fb.node);
    var tableHolder = el('div'); card.appendChild(tableHolder); c.appendChild(card);

    function apply() {
      var q = (fb.sels.__search.value || '').trim().toLowerCase();
      var iv = fb.sels['이수여부'].value, sv = fb.sels['수강'].value, se = fb.sels['선임'].value;
      var filtered = rows.filter(function (r) {
        if (iv === '이수자만' && !r.이수) return false;
        if (iv === '미이수자만' && r.이수) return false;
        if (sv === '수강기록 없음' && r.수강기록) return false;
        if (sv === '수강기록 있음' && !r.수강기록) return false;
        if (se === '선임만' && !r.선임) return false;
        if (se === '비선임만' && r.선임) return false;
        if (fb.sels['시도'].value && r.시도 !== fb.sels['시도'].value) return false;
        if (fb.sels['직군'].value && r.직군 !== fb.sels['직군'].value) return false;
        if (fb.sels['경력'].value && r.경력 !== fb.sels['경력'].value) return false;
        return matches(q, r, ['ID', '성명', '기관명']);
      });
      // 연번: 차수 → 이수일자 → 성명 (값 없는 사람은 맨 뒤)
      filtered = filtered.slice().sort(function (a, b) {
        var ar = a.차수 == null ? Infinity : a.차수, br = b.차수 == null ? Infinity : b.차수;
        if (ar !== br) return ar - br;
        var ad = a.이수일자 || '￿', bd = b.이수일자 || '￿';
        return ad !== bd ? (ad < bd ? -1 : 1) : (a.성명 || '').localeCompare(b.성명 || '', 'ko');
      });
      filtered.forEach(function (r, i) { r._no = i + 1; });
      var fname = iv === '이수자만' ? '이수자명단.xlsx' : (iv === '미이수자만' ? '미이수자명단.xlsx' : '이수_미이수자명단.xlsx');
      if (sv === '수강기록 없음') fname = '수강기록없음_명단.xlsx';
      tableHolder.innerHTML = ''; dataTable(tableHolder, cols, filtered, { pageSize: 50, sortKey: '_no', sortDir: 1 });
      expHolder.innerHTML = '';
      expHolder.appendChild(expBtn(filtered, cols, fname, '엑셀 다운로드(' + fmt(filtered.length) + ')'));
      // [ver9] 기관별 시트 분리 내보내기(F-05)
      var ob = el('button', { class: 'btn sec sm' }, '기관별 분리 다운로드');
      ob.onclick = function () { exportByOrg(filtered, cols); };
      expHolder.appendChild(ob);
    }
    apply();
  }

  // 기관코드별로 시트를 나눈 엑셀 한 파일 (F-05)
  function exportByOrg(rows, cols) {
    if (!rows.length) { alert('내보낼 데이터가 없습니다.'); return; }
    var groups = new Map();
    rows.forEach(function (r) {
      var key = (r.기관코드 || '(코드없음)') + '§' + (r.기관명 || '(기관미상)');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    if (groups.size > 250 && !confirm('기관이 ' + groups.size + '곳입니다. 시트가 그만큼 만들어져 파일이 커지고 시간이 걸릴 수 있습니다. 계속할까요?')) return;
    var wb = XLSX.utils.book_new(), used = {};
    // 요약 시트 먼저
    var summary = [['기관코드', '수행기관', '건수']];
    var entries = []; groups.forEach(function (v, k) { entries.push([k, v]); });
    entries.sort(function (a, b) { return b[1].length - a[1].length; });
    entries.forEach(function (e) { var p = e[0].split('§'); summary.push([p[0], p[1], e[1].length]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), safeSheetName('00_요약', used));
    entries.forEach(function (e) {
      var p = e[0].split('§');
      var list = e[1].slice(); list.forEach(function (r, i) { r._no = i + 1; });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rowsToAoa(list, cols)), safeSheetName(p[0] + '_' + p[1], used));
    });
    XLSX.writeFile(wb, '기관별_명단.xlsx');
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  미응시 · 재응시
   * ══════════════════════════════════════════════════════════════════════ */
  function renderNoExam(c) {
    var rows = state.result.examNoShowRows;
    var k = state.result.kpi;
    var card = el('div', { class: 'card' });
    note(card, '<b>진도율 ' + state.config.examNoShow.progressGte + '% 이상 · 점수 ' + state.config.examNoShow.scoreLte + '점 이하</b> = 강의는 끝냈으나 <b>최종평가 미응시(또는 과락)</b>. ' +
      '“해당과목 완료”가 <b>아니오</b>면 재응시 안내가 필요합니다.' +
      (k.점수미기재제외 ? ' <span class="warntxt">점수가 비어 있는 ' + fmt(k.점수미기재제외) + '건은 제외했습니다(설정에서 포함 가능).</span>' : ''));
    var cols = [
      { key: 'ID', label: 'ID', render: txt }, { key: '성명', label: '성명', render: txt },
      { key: '시도', label: '시도', render: txt }, { key: '시군구', label: '시군구', render: txt },
      { key: '기관명', label: '수행기관명', render: txt }, { key: '기관코드', label: '기관코드', render: txt },
      { key: '직군', label: '직급', render: txt },
      { key: '차수', label: '차수', num: true, render: function (v) { return v == null ? '-' : v + '차'; }, exp: function (v) { return v == null ? '' : v; } },
      { key: '카테고리', label: '구분', render: txt }, { key: '과정명', label: '미응시 과목/과정', render: txt },
      { key: '진도율', label: '진도율', num: true }, { key: '점수', label: '점수', num: true, render: function (v, r) { return r.점수미기재 ? '<span class="muted">미기재</span>' : v; }, exp: function (v, r) { return r.점수미기재 ? '' : v; } },
      { key: '해당과목완료', label: '해당과목 완료', render: function (v) { return v ? '<span class="pill y">예</span>' : '<span class="pill n">아니오</span>'; }, exp: function (v) { return v ? '예' : '아니오'; } },
      { key: '전체이수', label: '직무교육 이수', render: yn, exp: function (v) { return v ? '이수' : '미이수'; } },
      { key: '재응시필요', label: '재응시 필요', render: function (v) { return v ? '<span class="pill g">필요</span>' : '<span class="muted">-</span>'; }, exp: function (v) { return v ? '필요' : ''; } }
    ];
    var chasuOpts = uniq(rows, '차수').sort(function (a, b) { return (+a) - (+b); }).map(function (x) { return x + '차'; });
    var fb = filterBar({ searchKey: 1, searchLabel: '검색(ID·성명·기관)' }, [
      { key: '차수', label: '차수', options: chasuOpts },
      { key: '이수여부', label: '직무교육 이수여부', options: ['이수자만', '미이수자만'] },
      { key: '재응시', label: '재응시 필요만', options: ['필요만'] },
      { key: '시도', label: '시도', options: uniq(rows, '시도') }
    ], apply);
    var head = el('div', { class: 'head' });
    head.appendChild(el('div', { html: '<h2>미응시자 / 재응시 안내 대상</h2><p class="desc">연 ' + fmt(rows.length) + '건. <b>차수</b>로 거른 뒤, <b>직무교육 이수</b>가 “미이수”인 사람만 재응시 대상입니다(이수자는 자동 제외). 수강기록 기준이라 교육대상 모수 밖 인원도 포함될 수 있습니다.</p>' }));
    var expHolder = el('div'); head.appendChild(expHolder);
    card.appendChild(head); card.appendChild(fb.node);
    var tableHolder = el('div'); card.appendChild(tableHolder); c.appendChild(card);
    function apply() {
      var q = (fb.sels.__search.value || '').trim().toLowerCase();
      var cha = fb.sels['차수'].value ? parseInt(fb.sels['차수'].value, 10) : null;
      var filtered = rows.filter(function (r) {
        if (cha != null && r.차수 !== cha) return false;
        if (fb.sels['이수여부'].value === '이수자만' && !r.전체이수) return false;
        if (fb.sels['이수여부'].value === '미이수자만' && r.전체이수) return false;
        if (fb.sels['시도'].value && r.시도 !== fb.sels['시도'].value) return false;
        if (fb.sels['재응시'].value && !r.재응시필요) return false;
        return matches(q, r, ['ID', '성명', '기관명']);
      });
      tableHolder.innerHTML = ''; dataTable(tableHolder, cols, filtered, { pageSize: 50, sortKey: '재응시필요' });
      expHolder.innerHTML = ''; expHolder.appendChild(expBtn(filtered, cols, '미응시_재응시대상.xlsx', '엑셀 다운로드(' + fmt(filtered.length) + ')'));
    }
    apply();
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  중복자 확인
   * ══════════════════════════════════════════════════════════════════════ */
  function renderDuplicates(c) {
    var rows = state.result.duplicateRows || [];
    var k = state.result.kpi;
    var card = el('div', { class: 'card' });
    note(card, '<b>하나의 ID</b>가 <b>같은 교육과정을 2회 이상 수료</b>한 건입니다. ' +
      'ID는 본인인증 기반 고유값이므로 동명이인·중복계정 문제는 없으며, 여기서는 <b>같은 과정의 중복 이수</b>만 점검합니다. ' +
      '<b>재수강(다차수)</b>은 최종평가 과락자가 다른 차수에 재수강하는 정상 흐름일 수 있고, <b>동일차수 중복</b>만 데이터 이상이 의심되는 실제 점검 대상입니다. ' +
      '(완전히 동일한 행은 업로드 시 자동 제거되므로, 여기 표시되는 건은 서로 다른 이수 기록)');
    var sum = el('div', { class: 'toolbar' });
    sum.innerHTML = '<span class="filechip">중복 수료 건수 <b>' + fmt(k.중복수료건수) + '</b></span><span class="filechip">해당 인원(ID) <b>' + fmt(k.중복수료인원) + '</b></span><span class="filechip">재수강(다차수) <b>' + fmt(k.중복수료건수 - (k.중복동일차수 || 0)) + '</b></span><span class="filechip ' + (k.중복동일차수 ? 'warn' : '') + '">동일차수 중복(점검 대상) <b>' + fmt(k.중복동일차수 || 0) + '</b></span>';
    card.appendChild(sum);
    if (!rows.length) { card.appendChild(el('div', { class: 'empty-state', html: '<div class="big">✅</div>같은 과정을 2회 이상 수료한 중복 건이 없습니다.' })); c.appendChild(card); return; }
    var cols = [
      { key: 'ID', label: 'ID', render: txt }, { key: '성명', label: '성명', render: txt },
      { key: '시도', label: '시도', render: txt }, { key: '시군구', label: '시군구', render: txt },
      { key: '기관명', label: '수행기관명', render: txt }, { key: '기관코드', label: '기관코드', render: txt },
      { key: '직군', label: '직급', render: txt },
      { key: '카테고리', label: '구분', render: txt }, { key: '과정명', label: '중복 수료 과정', render: txt },
      { key: '중복유형', label: '중복유형', render: function (v) { return v === '동일차수 중복' ? '<span class="pill n">동일차수 중복</span>' : '<span class="pill y">재수강(다차수)</span>'; }, exp: function (v) { return v; } },
      { key: '수료횟수', label: '수료횟수', num: true, render: function (v) { return '<span class="pill g">' + v + '회</span>'; }, exp: function (v) { return v; } },
      { key: '차수', label: '수료 차수', render: txt }, { key: '수료일', label: '수료일', render: txt },
      { key: '직무교육이수', label: '직무교육 이수', render: yn, exp: function (v) { return v ? '이수' : '미이수'; } }
    ];
    var fb = filterBar({ searchKey: 1, searchLabel: '검색(ID·성명·기관·과정)' }, [
      { key: '중복유형', label: '중복유형', options: uniq(rows, '중복유형') },
      { key: '카테고리', label: '구분', options: uniq(rows, '카테고리') },
      { key: '시도', label: '시도', options: uniq(rows, '시도') }
    ], apply);
    var head = el('div', { class: 'head' });
    head.appendChild(el('div', { html: '<h2>중복자 확인 (같은 과정 중복 이수)</h2><p class="desc">하나의 ID가 동일 과정을 2회 이상 수료한 건 · 재수강(다차수)/동일차수 중복 구분</p>' }));
    var expHolder = el('div'); head.appendChild(expHolder);
    card.appendChild(head); card.appendChild(fb.node);
    var holder = el('div'); card.appendChild(holder); c.appendChild(card);
    function apply() {
      var q = (fb.sels.__search.value || '').trim().toLowerCase();
      var filtered = rows.filter(function (r) {
        if (fb.sels['중복유형'].value && r.중복유형 !== fb.sels['중복유형'].value) return false;
        if (fb.sels['카테고리'].value && r.카테고리 !== fb.sels['카테고리'].value) return false;
        if (fb.sels['시도'].value && r.시도 !== fb.sels['시도'].value) return false;
        return matches(q, r, ['ID', '성명', '기관명', '과정명']);
      });
      holder.innerHTML = ''; dataTable(holder, cols, filtered, { pageSize: 50, sortKey: '수료횟수' });
      expHolder.innerHTML = ''; expHolder.appendChild(expBtn(filtered, cols, '중복이수_확인.xlsx', '엑셀 다운로드(' + fmt(filtered.length) + ')'));
    }
    apply();
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  보류 · 직군변경
   * ══════════════════════════════════════════════════════════════════════ */
  function setDecision(id, val) {
    if (val === 'pending') delete state.decisions[id]; else state.decisions[id] = val;
    idbSet('decisions', state.decisions);
    return recompute();
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
    var k = state.result.kpi;
    var card = el('div', { class: 'card' });
    note(card, '교육 수료 <b>당시 직군</b>(수강목록)과 <b>현재 직군</b>(회원정보)이 달라 <b>직군 변경(전직)</b> 가능성이 있는 건입니다. ' +
      '기본은 미이수로 두고, 검토 후 <b>승인</b>하면 이수로 반영됩니다(통계 즉시 갱신). 결정은 브라우저에 저장됩니다.');
    if (k.보류경력불일치) note(card, '이 중 <b>' + fmt(k.보류경력불일치) + '건</b>은 <b>수료 당시 경력구분이 현재와 다릅니다</b>(예: 현재 신규자인데 “경력자 필수” 과정을 수료). ' +
      '승인하면 그 과정 수료가 필수 이수로 인정되므로, <b>당시 경력</b> 열을 반드시 확인하고 판단해 주세요.', 'warnnote');
    var sum = el('div', { class: 'toolbar' });
    sum.innerHTML = '<span class="filechip">미검토 <b>' + fmt(k.보류미검토) + '</b></span><span class="filechip">승인 <b>' + fmt(k.보류승인) + '</b></span>' +
      (k.보류경력불일치 ? '<span class="filechip warn">경력 불일치 <b>' + fmt(k.보류경력불일치) + '</b></span>' : '') +
      '<span class="filechip">전체 <b>' + fmt(rows.length) + '</b></span>';
    card.appendChild(sum);
    if (!rows.length) {
      card.appendChild(el('div', { class: 'empty-state', html: '<div class="big">✅</div>현재 직군 변경으로 검토가 필요한 건이 없습니다.<div class="muted" style="margin-top:6px">전직 등으로 현재 직군과 수료 당시 직군이 다른 건이 생기면 여기에 표시됩니다.</div>' }));
      c.appendChild(card); return;
    }
    var cols = [
      { key: 'ID', label: 'ID', render: txt }, { key: '성명', label: '성명', render: txt },
      { key: '시도', label: '시도', render: txt }, { key: '시군구', label: '시군구', render: txt },
      { key: '기관명', label: '수행기관명', render: txt }, { key: '기관코드', label: '기관코드', render: txt },
      { key: '직군', label: '현재 직급', render: txt }, { key: '경력', label: '현재 경력', render: txt },
      { key: '당시직군', label: '당시 직군(수료시)', render: function (v) { return '<b>' + esc(v || '-') + '</b>'; }, exp: function (v) { return v; } },
      // [ver9] 당시 경력을 노출하고 불일치를 눈에 띄게 표시한다(D-07)
      { key: '당시경력', label: '당시 경력(수료시)', render: function (v, r) { return r.경력일치 ? esc(v || '-') : '<span class="pill n">' + esc(v || '-') + ' · 불일치</span>'; }, exp: function (v, r) { return (v || '') + (r.경력일치 ? '' : ' (불일치)'); } },
      { key: '변경완료과정', label: '수료한 필수과정', render: txt },
      { key: '선택차시', label: '선택차시', num: true, render: function (v, r) { return r.경력 === '경력자' ? v + ' / ' + r.필요차시 : '-'; }, exp: function (v, r) { return r.경력 === '경력자' ? v : ''; } },
      { key: '승인시이수', label: '승인 시', render: function (v, r) { return (v ? '<span class="pill y">이수</span>' : '<span class="pill g">선택부족</span>') + (r.경력일치 ? '' : ' <span class="warntxt">⚠</span>'); }, exp: function (v) { return v ? '이수' : '승인해도 선택부족'; } },
      { key: '보류상태', label: '검토', sortable: false, render: function (v, r) { return statusControl(r); }, exp: function (v) { return v === 'approve' ? '승인' : (v === 'reject' ? '반려' : '미검토'); } }
    ];
    var fb = filterBar({ searchKey: 1, searchLabel: '검색(ID·성명·기관)' }, [
      { key: '상태', label: '검토상태', options: ['미검토', '승인', '반려'] },
      { key: '경력', label: '경력구분', options: ['불일치만', '일치만'] },
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
        if (fb.sels['경력'].value === '불일치만' && r.경력일치) return false;
        if (fb.sels['경력'].value === '일치만' && !r.경력일치) return false;
        if (fb.sels['시도'].value && r.시도 !== fb.sels['시도'].value) return false;
        return matches(q, r, ['ID', '성명', '기관명']);
      });
      holder.innerHTML = ''; dataTable(holder, cols, filtered, { pageSize: 50, sortKey: '보류상태', sortDir: 1 });
      expHolder.innerHTML = ''; expHolder.appendChild(expBtn(filtered, cols, '직군변경_보류검토.xlsx', '엑셀 다운로드(' + fmt(filtered.length) + ')'));
    }
    apply();
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  과목별 현황
   * ══════════════════════════════════════════════════════════════════════ */
  function renderCourses(c) {
    var rows = state.result.courseRows;
    var card = el('div', { class: 'card' });
    var retakeCnt = rows.filter(function (r) { return r.구분 === '재응시'; }).length;
    note(card, '재응시 과정(과정명 끝 <b>_재응시</b>)은 <b>구분</b> 컬럼으로 원과정과 분리됩니다. ' +
      '재응시 신청자의 상당수는 원과정에도 신청되어 있으므로, 과정별 인원을 합산할 때는 <b>구분=원과정</b>만 선택하면 인원 중복 없는 통계가 됩니다.' +
      (retakeCnt ? ' (현재 재응시 과정 ' + retakeCnt + '개)' : ''), 'info');
    var head = el('div', { class: 'head' });
    head.appendChild(el('div', { html: '<h2>과목별 수강·수료 현황</h2><p class="desc">과정(과목) 단위 신청자/수료자/수료율 · 유형(필수·신규/필수·경력/선택)과 구분(원과정/재응시)으로 분류</p>' }));
    var expHolder = el('div'); head.appendChild(expHolder);
    card.appendChild(head);
    var fb = filterBar({ searchKey: 1, searchLabel: '과정 검색' }, [
      { key: '유형', label: '유형', options: uniq(rows, '유형') },
      { key: '구분', label: '구분', options: uniq(rows, '구분') }
    ], apply);
    card.appendChild(fb.node);
    var holder = el('div'); card.appendChild(holder); c.appendChild(card);
    var cols = [
      { key: '과정명', label: '과정명', render: txt },
      { key: '유형', label: '유형', render: txt },
      { key: '구분', label: '구분', render: function (v) { return v === '재응시' ? '<span class="pill g">재응시</span>' : (v === '열람전용' ? '<span class="muted">열람전용</span>' : esc(v)); }, exp: function (v) { return v; } },
      { key: '원과정', label: '원과정(재응시인 경우)', render: txt },
      { key: '신청자', label: '신청자', num: true, render: fmt }, { key: '수료자', label: '수료자', num: true, render: fmt },
      { key: '수료율', label: '수료율', num: true, render: barCell, exp: function (v) { return +v.toFixed(1); } }
    ];
    function apply() {
      var q = (fb.sels.__search.value || '').trim().toLowerCase();
      var data = rows.filter(function (r) {
        if (fb.sels['유형'].value && r.유형 !== fb.sels['유형'].value) return false;
        if (fb.sels['구분'].value && r.구분 !== fb.sels['구분'].value) return false;
        return matches(q, r, ['과정명']);
      });
      holder.innerHTML = ''; dataTable(holder, cols, data, { pageSize: 30, sortKey: '신청자' });
      expHolder.innerHTML = ''; expHolder.appendChild(expBtn(data, cols, '과목별_현황.xlsx', '엑셀 다운로드(' + fmt(data.length) + ')'));
    }
    apply();
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  데이터 현황
   * ══════════════════════════════════════════════════════════════════════ */
  function renderCoverage(c) {
    if (!state.studentCount || !state.coverage) {
      var card0 = el('div', { class: 'card' });
      card0.appendChild(el('h2', {}, '데이터 업데이트 현황'));
      card0.appendChild(el('div', { class: 'muted', style: 'padding:30px 0' }, '수강생목록(원데이터)을 올리면 연도·차수 기준으로 어디까지 데이터가 들어왔는지 표시됩니다.'));
      c.appendChild(card0); return;
    }
    var cov = state.coverage, s = cov.summary;
    var kp = el('div', { class: 'kpis' });
    kp.appendChild(kpiCard('연도', esc(s.연도.join(', ') || '-'), 'accent'));
    kp.appendChild(kpiCard('최신 차수', s.최신차수 + '<small>차</small>', 'accent'));
    kp.appendChild(kpiCard('총 수강건수', fmt(s.행수) + '<small>건</small>'));
    kp.appendChild(kpiCard('교육신청일', esc(s.최근신청일 || '-'), 'good', '최근'));
    kp.appendChild(kpiCard('수료일', esc(s.최근수료일 || '-'), 'good', '최근'));
    c.appendChild(kp);
    note(c, '현재 업로드된 데이터는 <b>' + esc(s.연도.join(', ') || '-') + '년 · 최신 ' + s.최신차수 + '차</b>까지 반영되어 있습니다. ' +
      '교육신청일 <b>' + esc(s.최초신청일 || '-') + ' ~ ' + esc(s.최근신청일 || '-') + '</b>. ' +
      '(과정 유형별로 진행 차수가 달라, 아래 표에서 과정별 최신 차수를 확인하세요.)', 'info');
    if (state.dupRemoved) note(c, '완전히 동일한 <b>중복 행 ' + fmt(state.dupRemoved) + '건</b>이 자동 제거되었습니다(같은 파일 중복 업로드 또는 원본 중복행). 위 행수는 제거 후 기준입니다.');
    var k = state.result && state.result.kpi;
    if (k && (k.회원정보없는ID행 || k.지역외수강행)) {
      note(c, '집계에서 제외된 수강 행: ' +
        (k.회원정보없는ID행 ? '회원정보에 없는 ID <b>' + fmt(k.회원정보없는ID행) + '행</b>(' + fmt(k.회원정보없는ID수) + '명)' : '') +
        (k.회원정보없는ID행 && k.지역외수강행 ? ' · ' : '') +
        (k.지역외수강행 ? '대상 시도 밖 <b>' + fmt(k.지역외수강행) + '행</b>' : '') +
        ' · 수강취소 <b>' + fmt(k.수강취소제외) + '행</b>. <b>데이터 점검</b> 탭에서 상세 명단을 볼 수 있습니다.', 'warnnote');
    }
    if (state.studentFiles.length) {
      var fc = el('div', { class: 'card' });
      fc.appendChild(el('h2', {}, '업로드한 수강 데이터 파일'));
      fc.appendChild(el('p', { class: 'desc' }, '파일별 행수는 중복 제거 전 기준입니다.'));
      var fl = el('div');
      state.studentFiles.forEach(function (f) { var chip = el('span', { class: 'filechip' }); chip.innerHTML = '<b>' + esc(f.name) + '</b> · ' + fmt(f.rows) + '행' + (f.sheets > 1 ? ' · ' + f.sheets + '시트' : ''); fl.appendChild(chip); });
      fc.appendChild(fl);
      c.appendChild(fc);
    }
    var card1 = el('div', { class: 'card' });
    var head1 = el('div', { class: 'head' });
    head1.appendChild(el('div', { html: '<h2>연도 · 차수별 수강 건수</h2><p class="desc">차수가 높을수록 최근 개강분입니다 (필수 경력자는 2주 단위, 신규자는 월 단위)</p>' }));
    head1.appendChild(expBtn(cov.byYearRound, [
      { key: '연도', label: '연도' }, { key: '차수', label: '차수' }, { key: '건수', label: '건수' }, { key: '최초신청일', label: '최초신청일' }, { key: '최근신청일', label: '최근신청일' }
    ], '연도차수별_현황.xlsx'));
    card1.appendChild(head1);
    dataTable(card1, [
      { key: '연도', label: '연도', render: txt },
      { key: '차수', label: '차수', num: true, render: function (v) { return v + '차' + (v === s.최신차수 ? ' <span class="pill g">최신</span>' : ''); }, exp: function (v) { return v; } },
      { key: '건수', label: '수강건수', num: true, render: fmt },
      { key: '최초신청일', label: '최초 교육신청일', render: txt }, { key: '최근신청일', label: '최근 교육신청일', render: txt }
    ], cov.byYearRound, { pageSize: 30, sortKey: '차수', sortDir: 1 });
    c.appendChild(card1);

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
        return matches(q, r, ['과정명']);
      });
      holder2.innerHTML = '';
      dataTable(holder2, [
        { key: '과정명', label: '과정명', render: txt }, { key: '카테고리', label: '카테고리', render: txt },
        { key: '최신차수', label: '최신차수', num: true, render: function (v) { return v + '차'; }, exp: function (v) { return v; } },
        { key: '보유차수', label: '보유 차수', render: txt },
        { key: '건수', label: '건수', num: true, render: fmt }, { key: '최근신청일', label: '최근 신청일', render: txt }, { key: '최근수료일', label: '최근 수료일', render: txt }
      ], data, { pageSize: 30, sortKey: '건수' });
    }
    apply2();
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  개인 조회
   * ══════════════════════════════════════════════════════════════════════ */
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

    function go() {
      var q = inp.value.trim(); res.innerHTML = ''; if (!q) return;
      var lower = q.toLowerCase();
      var m = persons.filter(function (p) { return p.ID === q || p.성명 === q || p.ID.toLowerCase() === lower; });
      if (!m.length) m = persons.filter(function (p) { return p.성명.indexOf(q) >= 0 || p.ID.toLowerCase().indexOf(lower) >= 0; }).slice(0, 20);
      if (!m.length) {
        var d = el('div', { class: 'note' });
        d.innerHTML = '검색 결과가 없습니다. 교육대상 모수(교육대상여부 Y · 상태 정상 · 대상 시도)에 없는 ID일 수 있습니다. ' +
          '<b>데이터 점검</b> 탭에서 “회원정보에 없는 ID” 목록도 확인해 보세요.';
        res.appendChild(d); return;
      }
      if (m.length > 1) {
        var pick = el('div', { class: 'note info' }); pick.textContent = m.length + '명 검색됨 — 한 명을 선택하세요.'; res.appendChild(pick);
        m.forEach(function (p) {
          var b = el('button', { class: 'filechip' }, p.성명 + ' (' + p.ID + ' · ' + p.기관명 + ')');
          b.style.cursor = 'pointer'; b.onclick = function () { showPerson(p); }; res.appendChild(b);
        });
        return;
      }
      showPerson(m[0]);
    }

    function showPerson(p) {
      res.innerHTML = '';
      var kp = el('div', { class: 'kpis' });
      kp.appendChild(kpiCard('이수 여부', p.이수 ? '이수' : '미이수', p.이수 ? 'good' : 'bad'));
      kp.appendChild(kpiCard('필수', p.필수수료 ? '수료' : '미수료', p.필수수료 ? 'good' : 'warn'));
      kp.appendChild(kpiCard('선택 차시', p.경력 === '경력자' ? (p.선택차시 + ' / ' + p.필요차시) : '해당없음', 'accent'));
      kp.appendChild(kpiCard('차수 · 이수일자', (p.차수 == null ? '-' : p.차수 + '차') + ' · ' + esc(p.이수일자 || '-')));
      res.appendChild(kp);
      var info = el('div', { class: 'note info' });
      info.innerHTML = '<b>' + esc(p.성명) + '</b> (' + esc(p.ID) + ') · ' + esc(p.시도) + ' ' + esc(p.시군구) + ' · ' + esc(p.기관명) +
        ' · ' + esc(p.직군) + (p.선임 ? ' <span class="pill g">선임</span>' : '') + ' · ' + esc(p.경력) +
        (p.사유 ? ' · <b>미이수 사유:</b> ' + esc(p.사유) : '');
      res.appendChild(info);
      if (p.추천과목) note(res, '남은 선택차시를 채우려면: <b>' + esc(p.추천과목) + '</b> <span class="muted">(차시가 큰 과목부터 고른 예시이며, 다른 조합도 가능합니다)</span>');
      if (p.보류후보) note(res, '직군변경 보류 후보 — 당시 직군 <b>' + esc(p.당시직군) + '</b> · 당시 경력 <b>' + esc(p.당시경력) + '</b>' +
        (p.경력일치 ? '' : ' <span class="warntxt">(현재 경력구분과 불일치)</span>') + ' · 수료 과정 ' + esc(p.변경완료과정), 'warnnote');

      var cols = [
        { key: '카테고리', label: '구분', render: txt }, { key: '과정명', label: '과정/과목', render: txt },
        // [ver9] '교육차시'를 차수로 잘못 표기하던 것을 바로잡고, 실제 차수 열을 추가한다(D-16)
        { key: '연도/차수', label: '연도/차수', render: txt },
        { key: '교육차시', label: '차시', render: txt },
        { key: '진도율', label: '진도율', num: true }, { key: '점수', label: '점수', num: true },
        { key: '수료여부', label: '수료', render: function (v) { return v === '수료' ? '<span class="pill y">수료</span>' : '<span class="pill n">' + esc(v || '-') + '</span>'; }, exp: function (v) { return v; } },
        { key: '수료일', label: '수료일', render: txt }, { key: '상태', label: '상태', render: txt }
      ];
      var holder = el('div');
      var h = el('div', { class: 'head' });
      h.appendChild(el('h2', {}, '수강 이력'));
      var btns = el('div', { class: 'btnrow' }); h.appendChild(btns);
      res.appendChild(h);
      res.appendChild(el('p', { class: 'hint', style: 'margin:4px 0 8px' }, '※ 판정이 이상한 인원은 “진단 데이터 내보내기”로 저장한 작은 파일(JSON)을 전달해 주시면 원인을 확인할 수 있습니다. 개인정보가 걱정되면 “진단(개인정보 가림)”을 사용하세요 — 이름·ID·기관명이 가려지고 판정에 필요한 정보만 담깁니다.'));
      res.appendChild(holder);
      holder.appendChild(el('div', { class: 'muted', style: 'padding:14px 0' }, '수강 이력을 불러오는 중...'));
      Engine.records(p.ID).then(function (recs) {
        recs = recs || [];
        h.querySelector('h2').textContent = '수강 이력 (' + recs.length + '건)';
        btns.innerHTML = '';
        btns.appendChild(expBtn(recs, cols, p.ID + '_수강이력.xlsx'));
        var db = el('button', { class: 'btn sm' }, '진단 데이터 내보내기'); db.onclick = function () { exportPersonDiag(p, recs, false); };
        var dbm = el('button', { class: 'btn sec sm' }, '진단(개인정보 가림)'); dbm.onclick = function () { exportPersonDiag(p, recs, true); };
        btns.appendChild(db); btns.appendChild(dbm);
        holder.innerHTML = '';
        if (!recs.length) holder.appendChild(el('div', { class: 'muted', style: 'padding:14px 0' }, '수강 기록이 없습니다.'));
        else dataTable(holder, cols, recs, { pageSize: 50, sortKey: '카테고리', sortDir: 1 });
      });
    }
    btn.onclick = go; inp.onkeydown = function (e) { if (e.key === 'Enter') go(); };
    setTimeout(function () { inp.focus(); }, 30);
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  설정 · 도움말
   * ══════════════════════════════════════════════════════════════════════ */
  function saveConfig() { return idbSet('config', state.config); }
  // [ver9] 설정 탭에서는 화면을 다시 그리지 않는다 — 입력 포커스를 잃지 않기 위함(D-13).
  function saveAndRecompute() { saveConfig(); return recompute({ silent: state.activeTab === 'settings' }); }

  function renderSettings(c) {
    var card = el('div', { class: 'card' });
    card.appendChild(el('h2', {}, '이수 기준 설정'));
    card.appendChild(el('p', { class: 'desc' }, '값을 바꾸면 즉시 재집계됩니다(화면은 그대로 두므로 여러 항목을 연달아 수정할 수 있습니다). 설정은 브라우저에 저장됩니다.'));
    var grid = el('div', { class: 'settings-grid' });

    var box1 = el('div');
    box1.appendChild(el('h3', { class: 'sh' }, '경력자 선택교육 이수 기준(차시)'));
    var t = state.config.thresholds;
    ['생활지원사', '전담사회복지사'].forEach(function (g) {
      var lab = el('label', { class: 'fld', style: 'display:inline-flex;margin-right:14px' }, g);
      var inp = el('input', { type: 'number', min: '0', value: t[g], style: 'width:90px' });
      inp.onchange = function () { t[g] = parseInt(inp.value) || 0; saveAndRecompute(); };
      lab.appendChild(inp); box1.appendChild(lab);
    });
    // 선임 전용 기준 (F-10)
    box1.appendChild(el('h3', { class: 'sh' }, '선임생활지원사 전용 기준(차시)'));
    box1.appendChild(el('p', { class: 'hint', style: 'margin:0 0 6px' }, '회원정보 ‘선임여부’가 Y인 생활지원사에게만 적용됩니다. 비워 두면 생활지원사 기준을 그대로 씁니다.'));
    var sInp = el('input', { type: 'number', min: '0', placeholder: '미적용', style: 'width:120px' });
    sInp.value = (state.config.seniorThreshold == null ? '' : state.config.seniorThreshold);
    sInp.onchange = function () { state.config.seniorThreshold = sInp.value === '' ? null : (parseInt(sInp.value) || 0); saveAndRecompute(); };
    box1.appendChild(sInp);

    box1.appendChild(el('h3', { class: 'sh' }, '미응시자 판정'));
    var ens = state.config.examNoShow;
    var l1 = el('label', { class: 'fld', style: 'display:inline-flex;margin-right:14px' }, '진도율 ≥');
    var i1 = el('input', { type: 'number', value: ens.progressGte, style: 'width:90px' }); i1.onchange = function () { ens.progressGte = parseFloat(i1.value) || 0; saveAndRecompute(); }; l1.appendChild(i1); box1.appendChild(l1);
    var l2 = el('label', { class: 'fld', style: 'display:inline-flex' }, '점수 ≤');
    var i2 = el('input', { type: 'number', value: ens.scoreLte, style: 'width:90px' }); i2.onchange = function () { ens.scoreLte = parseFloat(i2.value) || 0; saveAndRecompute(); }; l2.appendChild(i2); box1.appendChild(l2);
    var l3 = el('label', { class: 'chk', style: 'margin-top:8px' });
    var cb = el('input', { type: 'checkbox' }); cb.checked = !!state.config.blankScoreAsZero;
    cb.onchange = function () { state.config.blankScoreAsZero = cb.checked; saveAndRecompute(); };
    l3.appendChild(cb); l3.appendChild(document.createTextNode(' 점수 칸이 비어 있는 행을 0점으로 간주'));
    box1.appendChild(l3);

    box1.appendChild(el('h3', { class: 'sh' }, '통계 대상 시도 (이 목록 외는 제외)'));
    box1.appendChild(el('p', { class: 'hint', style: 'margin:0 0 6px' }, '쉼표(,)로 구분. 목록에 없는 시도는 모든 통계에서 제외됩니다. 데이터 점검 탭에서 실제로 어떤 시도 값이 들어 있는지 확인할 수 있습니다.'));
    var sidoInp = el('input', { type: 'text', value: (state.config.allowedSido || []).join(', '), style: 'width:100%' });
    sidoInp.onchange = function () { state.config.allowedSido = sidoInp.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean); saveAndRecompute(); };
    box1.appendChild(sidoInp);
    grid.appendChild(box1);

    var box2 = el('div');
    box2.appendChild(el('h3', { class: 'sh' }, '선택 과목별 차시 (경력자 합산용)'));
    var unknown = (state.result && state.result.unknownChasi) || {};
    var ukKeys = Object.keys(unknown);
    if (ukKeys.length) {
      var un = el('div', { class: 'note warnnote', style: 'margin:0 0 8px' });
      un.innerHTML = '데이터에는 있으나 차시표에 없는 과목 <b>' + ukKeys.length + '개</b>(0차시로 계산 중): ' + esc(ukKeys.slice(0, 8).join(', '));
      var ab2 = el('button', { class: 'btn sm', style: 'margin-top:6px' }, '전부 2차시로 추가');
      ab2.onclick = function () { ukKeys.forEach(function (k) { if (!(k in state.config.chasi)) state.config.chasi[k] = 2; }); saveAndRecompute().then(function () { renderTab(); }); };
      un.appendChild(document.createElement('br')); un.appendChild(ab2);
      box2.appendChild(un);
    }
    var tw = el('div', { class: 'tablewrap', style: 'max-height:280px' }); var table = el('table');
    table.innerHTML = '<thead><tr><th>과목</th><th class="num">차시</th><th class="num">삭제</th></tr></thead>';
    var tbo = el('tbody'); table.appendChild(tbo);
    Object.keys(state.config.chasi).sort(function (a, b) { return a.localeCompare(b, 'ko'); }).forEach(function (name) {
      var tr = el('tr'); tr.appendChild(el('td', {}, name));
      var td = el('td', { class: 'num' });
      var inp = el('input', { type: 'number', min: '0', value: state.config.chasi[name], style: 'width:64px' });
      inp.onchange = function () { state.config.chasi[name] = parseInt(inp.value) || 0; saveAndRecompute(); };
      td.appendChild(inp); tr.appendChild(td);
      var td2 = el('td', { class: 'num' });
      var del = el('button', { class: 'btn sec sm' }, '×');
      del.onclick = function () { delete state.config.chasi[name]; saveAndRecompute().then(function () { renderTab(); }); };
      td2.appendChild(del); tr.appendChild(td2);
      tbo.appendChild(tr);
    });
    tw.appendChild(table); box2.appendChild(tw);
    var addrow = el('div', { class: 'toolbar', style: 'margin-top:8px' });
    var an = el('input', { type: 'text', placeholder: '새 과목명' }); var av = el('input', { type: 'number', min: '0', placeholder: '차시', style: 'width:80px' });
    var ab = el('button', { class: 'btn sm' }, '추가');
    ab.onclick = function () { if (an.value.trim()) { state.config.chasi[an.value.trim()] = parseInt(av.value) || 0; saveAndRecompute().then(function () { renderTab(); }); } };
    addrow.appendChild(an); addrow.appendChild(av); addrow.appendChild(ab); box2.appendChild(addrow);
    grid.appendChild(box2);
    card.appendChild(grid);

    // [ver9] 초기화는 확인을 받고, 배정·채용·산출기간은 보존한다(D-12)
    var rb = el('button', { class: 'btn sec sm', style: 'margin-top:12px' }, '이수 기준 기본값으로 초기화');
    rb.onclick = function () {
      if (!confirm('이수 기준·차시표·대상 시도·미응시 임계값을 기본값으로 되돌립니다.\n\n배정·채용인원, 기준일 메모, 산출기간 설정, 직군변경 검토 결정은 그대로 유지됩니다.\n\n계속할까요?')) return;
      var keep = { alloc: state.config.alloc, allocNote: state.config.allocNote, period: state.config.period };
      state.config = JSON.parse(JSON.stringify(LMS.DEFAULT_CONFIG));
      state.config.alloc = keep.alloc; state.config.allocNote = keep.allocNote; state.config.period = keep.period;
      saveAndRecompute().then(function () { renderTab(); });
    };
    card.appendChild(rb);
    c.appendChild(card);

    /* 설정·결정 내보내기 / 가져오기 (F-04) */
    var share = el('div', { class: 'card' });
    share.appendChild(el('h2', {}, '설정 · 검토결정 주고받기'));
    share.appendChild(el('p', { class: 'desc' }, '이수 기준·차시표·배정인원과 직군변경 검토 결정을 파일 하나로 내보내고 다른 PC에서 가져올 수 있습니다. 담당자 변경·다중 PC 운영 시 같은 기준으로 집계됩니다. (개인 수강데이터는 포함되지 않습니다)'));
    var sbar = el('div', { class: 'toolbar' });
    var eb2 = el('button', { class: 'btn sm' }, '설정·결정 내보내기');
    eb2.onclick = function () {
      var out = { 도구버전: VERSION, 내보낸시각: new Date().toISOString(), config: state.config, decisions: state.decisions, snapshots: state.snapshots };
      downloadBlob(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), 'LMS통계_설정_' + new Date().toISOString().slice(0, 10) + '.json');
    };
    var imp = el('input', { type: 'file', accept: '.json', style: 'display:none' });
    var ib = el('button', { class: 'btn sec sm' }, '설정·결정 가져오기');
    ib.onclick = function () { imp.click(); };
    imp.onchange = function () {
      var f = imp.files && imp.files[0]; imp.value = '';
      if (!f) return;
      f.text().then(function (t) {
        var o = JSON.parse(t);
        if (!o || !o.config) throw new Error('설정 파일 형식이 아닙니다.');
        var n = Object.keys(o.decisions || {}).length;
        if (!confirm('가져오기를 진행하면 현재 설정과 검토 결정(' + Object.keys(state.decisions).length + '건)이 파일의 내용(' + n + '건)으로 교체됩니다.\n계속할까요?')) return;
        state.config = Object.assign(JSON.parse(JSON.stringify(LMS.DEFAULT_CONFIG)), o.config);
        state.config.chasi = Object.assign({}, LMS.DEFAULT_CHASI, o.config.chasi || {});
        state.decisions = o.decisions || {};
        if (Array.isArray(o.snapshots)) state.snapshots = o.snapshots;
        Promise.all([idbSet('config', state.config), idbSet('decisions', state.decisions), idbSet('snapshots', state.snapshots)])
          .then(function () { return recompute(); }).then(function () { renderTab(); alert('가져오기를 완료했습니다.'); });
      }).catch(function (e) { alert('가져오기 실패: ' + (e && e.message ? e.message : e)); });
    };
    sbar.appendChild(eb2); sbar.appendChild(ib); sbar.appendChild(imp);
    share.appendChild(sbar);

    /* 스냅샷 (F-09) */
    share.appendChild(el('h3', { class: 'sh', style: 'margin-top:18px' }, '집계 스냅샷 (기간 대비 증감)'));
    share.appendChild(el('p', { class: 'hint', style: 'margin:0 0 8px' }, '현재 집계 결과를 저장해 두면, 다음에 새 데이터를 올렸을 때 요약 탭에 직전 대비 증감이 표시됩니다. 최근 12개까지 보관합니다.'));
    var snapbar = el('div', { class: 'toolbar' });
    var snb = el('button', { class: 'btn sm' }, '현재 집계 저장');
    snb.disabled = !state.result;
    snb.onclick = function () {
      var k = state.result.kpi;
      state.snapshots.push({ 일시: new Date().toISOString(), kpi: { 대상자: k.대상자, 이수자: k.이수자, 미이수자: k.미이수자, 이수율: k.이수율 }, bySido: state.result.bySido.map(function (r) { return { 시도: r.key, 대상자: r.대상자, 이수자: r.이수자, 이수율: r.이수율 }; }) });
      if (state.snapshots.length > 12) state.snapshots = state.snapshots.slice(-12);
      idbSet('snapshots', state.snapshots).then(function () { renderTab(); });
    };
    snapbar.appendChild(snb);
    if (state.snapshots.length) {
      var clr2 = el('button', { class: 'btn sec sm' }, '스냅샷 전체 삭제');
      clr2.onclick = function () { if (confirm('저장된 스냅샷 ' + state.snapshots.length + '개를 모두 삭제할까요?')) { state.snapshots = []; idbSet('snapshots', []).then(function () { renderTab(); }); } };
      snapbar.appendChild(clr2);
    }
    share.appendChild(snapbar);
    if (state.snapshots.length) {
      dataTable(share, [
        { key: '일시', label: '저장 시각', render: function (v) { return esc(v.slice(0, 16).replace('T', ' ')); } },
        { key: '대상자', label: '대상자', num: true, render: fmt },
        { key: '이수자', label: '이수자', num: true, render: fmt },
        { key: '이수율', label: '이수율', num: true, render: function (v) { return pct(v); }, exp: function (v) { return +v.toFixed(2); } }
      ], state.snapshots.slice().reverse().map(function (s) { return { 일시: s.일시, 대상자: s.kpi.대상자, 이수자: s.kpi.이수자, 이수율: s.kpi.이수율 }; }), { pageSize: 12, sortKey: null });
    }
    c.appendChild(share);

    /* 도움말 · 데이터 관리 */
    var help = el('div', { class: 'card' });
    help.innerHTML = '<h2>도움말 · 데이터 관리</h2>' +
      '<p class="desc">사용 순서와 동작 방식</p>' +
      '<ol class="steps">' +
      '<li><b>회원정보</b> 엑셀을 한 번 올립니다 (ID·직군·신규/경력·교육대상여부 등). 브라우저에 저장되어 다음에 다시 안 올려도 됩니다. 갱신 시에만 다시 올리세요.</li>' +
      '<li><b>수강생목록</b>(온라인통합수강생목록) 파일들을 올립니다. 여러 개를 한꺼번에 올려도 되고, 올릴 때마다 누적됩니다.</li>' +
      '<li><b>데이터 점검</b> 탭에서 값이 제대로 읽혔는지 먼저 확인합니다. 오류·주의가 있으면 숫자가 실제와 다를 수 있습니다.</li>' +
      '<li>각 탭에서 통계를 확인하고, 표 오른쪽 <b>엑셀 다운로드</b>로 내보냅니다. 화면에 적용한 필터가 그대로 반영됩니다.</li></ol>' +
      '<div class="note info" style="margin:0">모든 처리는 이 PC의 브라우저 안에서만 이루어지며, 어떤 데이터도 외부로 전송되지 않습니다. ' +
      '집계 엔진 실행 방식: <b>' + (Engine.mode() === 'worker' ? '백그라운드(Web Worker)' : '동기 처리') + '</b> · 도구 버전 <b>' + VERSION + '</b></div>';
    var dm = el('div', { class: 'toolbar', style: 'margin-top:12px' });
    var clr = el('button', { class: 'btn sec sm' }, '저장된 회원정보 삭제');
    clr.onclick = function () {
      if (!confirm('브라우저에 저장된 회원정보를 삭제합니다. 다음 사용 시 다시 올려야 합니다.\n계속할까요?')) return;
      Promise.all([idbSet('members', null), idbSet('memberMeta', null)]).then(function () {
        state.members = null; state.memberMeta = null; state.memberDupRemoved = 0; state.result = null; state.diag = null;
        return Engine.setMembers([]);
      }).then(function () { renderTab(); });
    };
    var clrS = el('button', { class: 'btn sec sm' }, '수강데이터 비우기');
    clrS.onclick = function () {
      if (!confirm('올려둔 수강데이터를 비웁니다(회원정보·설정·검토결정은 유지).\n계속할까요?')) return;
      Engine.clearStudents().then(function () {
        state.studentCount = 0; state.studentFiles = []; state.result = null; state.coverage = null; state.diag = null; state.dupRemoved = 0;
        renderTab();
      });
    };
    var clrD = el('button', { class: 'btn sec sm' }, '직군변경 검토결정 초기화');
    clrD.onclick = function () {
      if (!confirm('직군변경 보류 건의 승인/반려 결정 ' + Object.keys(state.decisions).length + '건을 모두 초기화할까요?')) return;
      state.decisions = {}; idbSet('decisions', {}).then(function () { return recompute(); });
    };
    dm.appendChild(clr); dm.appendChild(clrS); dm.appendChild(clrD);
    help.appendChild(dm);
    c.appendChild(help);
  }

  /* ---------- 드롭존 ---------------------------------------------------- */
  function wireDrop(zoneId, inputId, handler) {
    var zone = $('#' + zoneId), input = $('#' + inputId);
    input.onchange = function () { var files = Array.prototype.slice.call(input.files); input.value = ''; handler(files); };
    ['dragenter', 'dragover'].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('hl'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('hl'); }); });
    zone.addEventListener('drop', function (e) { var files = e.dataTransfer && e.dataTransfer.files; if (files && files.length) handler(Array.prototype.slice.call(files)); });
  }

  /* ---------- 초기화 ---------------------------------------------------- */
  function init() {
    ov.box = $('#overlay'); ov.msg = $('.spin .msg'); ov.sub = $('.spin .sub'); ov.bar = $('.prog>span');
    var vt = $('#verTag'); if (vt) vt.textContent = VERSION;
    renderTabsBar(); renderTab();
    wireDrop('dropMember', 'fileMember', loadMemberFiles);
    wireDrop('dropStudent', 'fileStudent', loadStudentFiles);
    $('#btnMember').onclick = function () { $('#fileMember').click(); };
    $('#btnStudent').onclick = function () { $('#fileStudent').click(); };

    // 저장된 회원정보/설정/검토결정 복원 — 저장소를 못 쓰는 환경에서도 화면은 반드시 뜨게 한다.
    Promise.all([idbGet('members'), idbGet('memberMeta'), idbGet('config'), idbGet('decisions'), idbGet('snapshots')])
      .catch(function () { return [null, null, null, null, null]; })
      .then(function (r) {
        r = r || [];
        if (r[2]) {
          state.config = Object.assign(JSON.parse(JSON.stringify(LMS.DEFAULT_CONFIG)), r[2]);
          // [ver9] 차시표는 통째로 덮어쓰지 않고 기본값 위에 사용자 수정분만 얹는다(D-20)
          state.config.chasi = Object.assign({}, LMS.DEFAULT_CHASI, r[2].chasi || {});
        }
        if (r[3]) state.decisions = r[3];
        if (Array.isArray(r[4])) state.snapshots = r[4];
        if (r[0] && r[0].length) {
          state.members = r[0]; state.memberMeta = r[1] || { count: r[0].length, filename: '(저장본)', loadedAt: new Date().toISOString() };
          state.memberDupRemoved = (r[1] && r[1].dupRemoved) || 0;
          return Engine.setMembers(state.members);
        }
      })
      .then(function () { renderStatus(); renderTab(); })
      .catch(function (e) { console.error(e); renderStatus(); renderTab(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.__LMS_APP = state;
  window.__LMS_ENGINE = Engine;
})();
