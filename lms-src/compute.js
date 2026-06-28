/* =============================================================================
 *  배움터 LMS 직무교육 통계 - 계산 엔진 (compute.js)
 *  순수 함수 모듈. 브라우저(window.LMS)와 Node(module.exports) 양쪽에서 동작.
 *  입력: memberRows[], studentRows[]  (각 행은 한글 컬럼명을 key로 갖는 객체)
 * ========================================================================== */
(function (root) {
  'use strict';

  // 선택 과목별 차시 (계획서 '교육과목' 기준). 키는 정규화된 과목명.
  var DEFAULT_CHASI = {
    '노인 신체건강': 3, '노인 정신건강': 3, '노년기 영양관리': 2, '노년기 보건관리': 2,
    '치매예방': 2, '이용자 상담의 실제': 2,
    '노인 상담기법 이해와 활용(내러티브상담)': 5, '노인 상담기법 이해와 활용(동기강화상담)': 5,
    '노인 상담기법 이해와 활용(인지치료상담)': 4, '노인 상담기법 이해와 활용(강점관점상담)': 4,
    '고위험 노인 상담 및 사례관리': 4, '집단프로그램 이해와 실제': 2, '개별프로그램 이해와 실제': 2,
    '종사자 인권과 안전관리': 3, '종사자의 자기돌봄': 2, '사회복지 실천윤리': 2,
    '지역사회 자원개발과 관리': 2, '스마트 돌봄': 2, '종사자가 알아야 할 기초노무지식': 4,
    '노인맞춤 퇴원환자 단기집중 서비스의 이해': 2, '영양지원서비스의 이해 및 실제': 2,
    '가사지원서비스의 이해 및 실제': 2, '동행지원서비스의 이해 및 실제': 2,
    '선임생활지원사 직무 및 역할': 3, '사례관리 이해와 실제': 2, '관계형성 및 조직관리': 2
  };

  // 통계 대상 시도(16개). 이 목록 외(중앙·미상 등)는 모든 통계에서 제외.
  var DEFAULT_SIDO = ['서울', '경기', '인천', '부산', '대전', '대구', '울산', '광주', '강원', '경남', '경북', '전남', '전북', '충남', '충북', '제주'];

  var DEFAULT_CONFIG = {
    // 학생 데이터에서 제외할 상태값
    excludeStudentStatus: ['수강취소'],
    // 모수(교육대상자) 필터: 회원정보에서 이 조건을 만족하는 사람만 대상자로 집계
    universeFilter: { '교육대상여부': 'Y', '상태': '정상' },
    // 통계 대상 시도. 회원정보 시도가 이 목록에 없으면(중앙·미상 등) 모든 통계에서 제외.
    allowedSido: DEFAULT_SIDO.slice(),
    // 경력자 선택교육 이수 기준(차시). 직군(정규화) 기준.
    thresholds: { '생활지원사': 13, '전담사회복지사': 10 },
    chasi: DEFAULT_CHASI,
    // 미응시자 판정: 진도율 이 값 이상 & 점수 이 값 이하
    examNoShow: { progressGte: 100, scoreLte: 0 }
  };

  function parseNum(x) {
    if (x === null || x === undefined || x === '') return 0;
    if (typeof x === 'number') return x;
    var n = parseFloat(String(x).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  function S(x) { return (x === null || x === undefined) ? '' : String(x).trim(); }

  // 직군 정규화: 이수기준이 정의된 두 직군으로 통일(광역전담 → 전담)
  function normDirect(ut) {
    ut = S(ut);
    if (ut === '전담사회복지사' || ut === '광역전담사회복지사') return '전담사회복지사';
    if (ut === '생활지원사') return '생활지원사';
    return ut; // 그 외(중간관리자/기타수행기관종사자 등) — 이수기준 미정의
  }

  // 선택 과정명 → 정규화 과목명 ("[2026년 선택] " 접두/ "_재응시"·"_열람전용" 접미 제거)
  function selBase(name) {
    var n = S(name).replace(/_재응시$/, '').replace(/_열람전용$/, '');
    n = n.replace(/^\[[^\]]*\]\s*/, ''); // 대괄호 토큰 제거
    return n.trim();
  }

  // 필수 과정명에서 (경력, 직군) 추출. 예: "[2026년 경력자 필수] 생활지원사"
  function pilMeta(name) {
    name = S(name);
    var 경력 = name.indexOf('신규자') >= 0 ? '신규자' : (name.indexOf('경력자') >= 0 ? '경력자' : '');
    var 직군 = name.indexOf('생활지원사') >= 0 ? '생활지원사'
             : (name.indexOf('전담사회복지사') >= 0 ? '전담사회복지사' : '');
    return { 경력: 경력, 직군: 직군 };
  }

  function isDone(rec) { return S(rec['수료여부']) === '수료'; }

  /* ---- 메인 분석 함수 ---------------------------------------------------- */
  function analyze(memberRows, studentRows, cfg) {
    cfg = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    var chasi = cfg.chasi || DEFAULT_CHASI;
    var excl = {}; (cfg.excludeStudentStatus || []).forEach(function (s) { excl[s] = 1; });

    // 시도 필터: 회원정보 ID→시도 매핑 후, 허용 시도(16개) 밖이면 모든 통계에서 제외
    var allowed = (cfg.allowedSido && cfg.allowedSido.length) ? new Set(cfg.allowedSido.map(S)) : null;
    var memberSido = new Map();
    for (var msi = 0; msi < memberRows.length; msi++) { memberSido.set(S(memberRows[msi]['ID']), S(memberRows[msi]['시도'])); }
    function regionOK(id) { return !allowed || allowed.has(memberSido.get(id)); }
    var skippedRegion = 0;

    // ---- 1) 학생 데이터 1-pass 집계 -------------------------------------
    // perID: { pil:Set("경력|직군"), sel:Set(subject), selRetake, examNoShow:[], subjAny:Set, subjDone:Set }
    var perID = new Map();
    var courseAgg = new Map(); // 과정명 → {enroll:Set(id), done:Set(id), cat}
    var unknownChasi = {};     // 매핑 안된 선택 과목명 집계
    var skippedCancel = 0;

    function pid(id) {
      var o = perID.get(id);
      if (!o) { o = { pil: new Set(), selDone: new Set(), examNoShow: [], subjAny: new Set(), subjDone: new Set() }; perID.set(id, o); }
      return o;
    }

    for (var i = 0; i < studentRows.length; i++) {
      var r = studentRows[i];
      var status = S(r['상태']);
      if (excl[status]) { skippedCancel++; continue; }
      var id = S(r['ID']);
      if (!id) continue;
      if (!regionOK(id)) { skippedRegion++; continue; } // 16개 시도 외(중앙·미상) 제외
      var cat = S(r['카테고리']);
      var name = S(r['과정명']);
      var done = isDone(r);
      var o = pid(id);

      // 과목별 현황(취소 제외 신청 기준)
      var ca = courseAgg.get(name);
      if (!ca) { ca = { enroll: new Set(), done: new Set(), cat: cat }; courseAgg.set(name, ca); }
      ca.enroll.add(id); if (done) ca.done.add(id);

      if (cat === '직무교육(필수)') {
        var pm = pilMeta(name);
        if (done && pm.경력 && pm.직군) o.pil.add(pm.경력 + '|' + pm.직군);
      } else if (cat === '직무교육(선택)') {
        var sub = selBase(name);
        o.subjAny.add(sub);
        if (done) { o.selDone.add(sub); o.subjDone.add(sub); if (!(sub in chasi)) unknownChasi[sub] = (unknownChasi[sub] || 0) + 1; }
      }

      // 미응시자(진도율 100% & 점수 0, 미수료) 후보 기록
      var prog = parseNum(r['진도율']);
      var score = parseNum(r['점수']);
      if (prog >= cfg.examNoShow.progressGte && score <= cfg.examNoShow.scoreLte && !done) {
        o.examNoShow.push({ 과정명: name, 카테고리: cat, 진도율: prog, 점수: score, 교육차시: S(r['교육차시']),
          기관명: S(r['기관명']), 시도: S(r['시도']), 시군구: S(r['시군구']), 성명: S(r['성명']) });
      }
    }

    // ---- 2) 모수(교육대상자) 결정 + 1인 1행 이수 판정 -------------------
    var uf = cfg.universeFilter || {};
    var ufKeys = Object.keys(uf);
    function passBase(m) { for (var k = 0; k < ufKeys.length; k++) { if (S(m[ufKeys[k]]) !== S(uf[ufKeys[k]])) return false; } return true; }

    var persons = [];           // 대상자별 판정 결과
    var notFoundInStudent = 0;  // 대상자인데 수강기록 전혀 없음
    var regionExcluded = 0;     // 교육대상이나 시도가 16개 외라서 제외된 인원

    for (var j = 0; j < memberRows.length; j++) {
      var m = memberRows[j];
      if (!passBase(m)) continue;
      if (allowed && !allowed.has(S(m['시도']))) { regionExcluded++; continue; } // 16개 시도 외 제외
      var mid = S(m['ID']);
      var ut = S(m['사용자유형']);
      var dir = normDirect(ut);
      var career = S(m['교육구분']); // 신규자/경력자
      var o2 = perID.get(mid);
      var hasRule = (dir === '생활지원사' || dir === '전담사회복지사') && (career === '신규자' || career === '경력자');

      var pilDone = false, selSum = 0, need = 0, 이수 = false, reason = '';
      if (o2) {
        pilDone = o2.pil.has(career + '|' + dir);
        o2.selDone.forEach(function (sub) { selSum += (chasi[sub] || 0); });
      }
      if (!hasRule) {
        reason = '이수기준 미정의(' + (ut || '미상') + ')';
      } else if (career === '신규자') {
        이수 = pilDone;
        if (!이수) reason = '필수 미수료';
      } else { // 경력자
        need = cfg.thresholds[dir] || 0;
        이수 = pilDone && (selSum >= need);
        if (!pilDone && selSum < need) reason = '필수 미수료 + 선택 ' + selSum + '/' + need + '차시';
        else if (!pilDone) reason = '필수 미수료';
        else if (selSum < need) reason = '선택 ' + selSum + '/' + need + '차시';
      }

      persons.push({
        ID: mid, 성명: S(m['성명']), 시도: S(m['시도']), 시군구: S(m['시군구']),
        기관코드: S(m['기관코드']), 기관명: S(m['기관명']), 직군: ut, 직군정규화: dir,
        경력: career, 선임여부: S(m['선임여부']),
        필수수료: pilDone, 선택차시: selSum, 필요차시: need, 이수: 이수,
        기준정의: hasRule, 사유: 이수 ? '' : reason,
        미응시건수: o2 ? o2.examNoShow.length : 0,
        수강기록: o2 ? 1 : 0
      });
      if (!o2) notFoundInStudent++;
    }

    // ---- 3) 집계표 생성 -------------------------------------------------
    function rate(done, tot) { return tot ? (100 * done / tot) : 0; }

    // (직군정규화, 경력)별
    var byGroupMap = new Map();
    // 시도별 / 시도×(직군,경력) — 기준정의 대상만 헤드라인에 집계
    var bySidoMap = new Map();
    var sidoTreeMap = new Map(); // 시도 → 시군구 → 기관 집계

    persons.forEach(function (p) {
      if (!p.기준정의) return; // 헤드라인 이수율은 생활지원사/전담만
      var gk = p.직군정규화 + ' / ' + p.경력;
      agg(byGroupMap, gk, p.이수);
      agg(bySidoMap, p.시도 || '(미상)', p.이수);

      var st = sidoTreeMap.get(p.시도 || '(미상)');
      if (!st) { st = { tot: 0, done: 0, child: new Map() }; sidoTreeMap.set(p.시도 || '(미상)', st); }
      st.tot++; if (p.이수) st.done++;
      var sgKey = p.시군구 || '(미상)';
      var sg = st.child.get(sgKey);
      if (!sg) { sg = { tot: 0, done: 0, child: new Map() }; st.child.set(sgKey, sg); }
      sg.tot++; if (p.이수) sg.done++;
      var orgKey = (p.기관명 || '(미상)') + ' [' + (p.기관코드 || '') + ']';
      var og = sg.child.get(orgKey);
      if (!og) { og = { tot: 0, done: 0 }; sg.child.set(orgKey, og); }
      og.tot++; if (p.이수) og.done++;
    });

    function agg(map, key, done) { var o = map.get(key); if (!o) { o = { tot: 0, done: 0 }; map.set(key, o); } o.tot++; if (done) o.done++; }
    function mapToRows(map, label) {
      var arr = []; map.forEach(function (v, k) { arr.push({ key: k, 대상자: v.tot, 이수자: v.done, 미이수자: v.tot - v.done, 이수율: rate(v.done, v.tot) }); });
      arr.sort(function (a, b) { return b.대상자 - a.대상자; });
      return arr;
    }

    // 과목별 현황
    var courseRows = [];
    courseAgg.forEach(function (v, k) {
      courseRows.push({ 과정명: k, 카테고리: v.cat, 신청자: v.enroll.size, 수료자: v.done.size, 수료율: rate(v.done.size, v.enroll.size) });
    });
    courseRows.sort(function (a, b) { return b.신청자 - a.신청자; });

    // 미응시자(진도율100·점수0) — 1인 1과목, 해당 과목 최종 미완료만 '재응시 필요'
    var personByID = new Map(); persons.forEach(function (p) { personByID.set(p.ID, p); });
    var examNoShowRows = [];
    perID.forEach(function (o, id) {
      if (!o.examNoShow.length) return;
      var seen = {};
      o.examNoShow.forEach(function (e) {
        var base = e.카테고리 === '직무교육(선택)' ? selBase(e.과정명) : e.과정명.replace(/_재응시$/, '');
        if (seen[base]) return; seen[base] = 1;
        var subjectDone = o.subjDone.has(base) || (e.카테고리 === '직무교육(필수)' && false);
        // 필수 과목 완료 여부는 pil Set으로 별도 확인
        if (e.카테고리 === '직무교육(필수)') { var pm2 = pilMeta(e.과정명); subjectDone = o.pil.has(pm2.경력 + '|' + pm2.직군); }
        var per = personByID.get(id) || {};
        examNoShowRows.push({
          ID: id, 성명: e.성명 || per.성명 || '', 기관명: e.기관명 || per.기관명 || '', 시도: per.시도 || memberSido.get(id) || e.시도 || '',
          시군구: e.시군구 || per.시군구 || '', 카테고리: e.카테고리, 과정명: e.과정명, 진도율: e.진도율, 점수: e.점수,
          해당과목완료: subjectDone, 전체이수: !!per.이수, 직군: per.직군 || '', 경력: per.경력 || '',
          재응시필요: !subjectDone
        });
      });
    });
    examNoShowRows.sort(function (a, b) { return (a.재응시필요 === b.재응시필요) ? 0 : (a.재응시필요 ? -1 : 1); });

    // 미이수자 명단(대상자 중 미이수, 기준정의자)
    var notCompleted = persons.filter(function (p) { return p.기준정의 && !p.이수; });

    // KPI
    var ruleP = persons.filter(function (p) { return p.기준정의; });
    var kpi = {
      대상자: ruleP.length,
      이수자: ruleP.filter(function (p) { return p.이수; }).length,
      미이수자: ruleP.filter(function (p) { return !p.이수; }).length,
      이수율: rate(ruleP.filter(function (p) { return p.이수; }).length, ruleP.length),
      기준미정의대상: persons.length - ruleP.length,
      미응시연인원: examNoShowRows.length,
      재응시필요인원: examNoShowRows.filter(function (e) { return e.재응시필요; }).length,
      수강취소제외: skippedCancel,
      대상자중수강기록없음: notFoundInStudent,
      지역외제외: regionExcluded
    };

    return {
      config: cfg,
      kpi: kpi,
      byGroup: mapToRows(byGroupMap),
      bySido: mapToRows(bySidoMap),
      sidoTree: sidoTreeMap,
      courseRows: courseRows,
      persons: persons,
      notCompleted: notCompleted,
      examNoShowRows: examNoShowRows,
      unknownChasi: unknownChasi,
      perID: perID,
      counts: { memberRows: memberRows.length, studentRows: studentRows.length, universe: persons.length }
    };
  }

  var API = { analyze: analyze, DEFAULT_CONFIG: DEFAULT_CONFIG, DEFAULT_CHASI: DEFAULT_CHASI, normDirect: normDirect, selBase: selBase, pilMeta: pilMeta };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.LMS = API;
})(typeof window !== 'undefined' ? window : this);
