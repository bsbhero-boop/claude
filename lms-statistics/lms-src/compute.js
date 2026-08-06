/* =============================================================================
 *  배움터 LMS 직무교육 통계 - 계산 엔진 (compute.js)  ver9
 *  순수 함수 모듈. 브라우저(window.LMS)·Web Worker·Node 모두에서 동작.
 *  입력: memberRows[], studentRows[]  (각 행은 한글 컬럼명을 key로 갖는 객체)
 *  UI 의존 없음 — 이 파일은 Worker에 그대로 실려 백그라운드에서 실행된다.
 * ========================================================================== */
(function (root) {
  'use strict';

  var VERSION = 'ver9';

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
    // [ver9] 선임생활지원사 전용 기준차시. null이면 생활지원사 기준을 그대로 적용.
    seniorThreshold: null,
    chasi: DEFAULT_CHASI,
    // 미응시자 판정: 진도율 이 값 이상 & 점수 이 값 이하
    examNoShow: { progressGte: 100, scoreLte: 0 },
    // [ver9] 점수 칸이 비어 있는 행을 0점으로 볼 것인지. false = 미기재는 미응시에서 제외(기본).
    blankScoreAsZero: false
  };

  /* ---- 값 처리 유틸 ------------------------------------------------------ */

  function S(x) { return (x === null || x === undefined) ? '' : String(x).trim(); }

  // [ver9] '값이 비어 있는가' — 0과 미기재를 구분하기 위해 parseNum과 분리한다.
  function hasVal(x) { return !(x === null || x === undefined || S(x) === ''); }

  function parseNum(x) {
    if (x === null || x === undefined || x === '') return 0;
    if (typeof x === 'number') return x;
    var n = parseFloat(String(x).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  // [ver9] 날짜 정규화 → 'YYYY-MM-DD'. 인식 실패 시 '' 반환(호출부에서 이상 건수로 집계).
  //  · Date 객체, '2026-03-10', '2026.3.10', '2026/03/10', '20260310' 모두 수용
  //  · '3/10/26' 같은 두 자리 연도 앞머리 형식은 연/월/일 순서를 확정할 수 없어 거부한다.
  //    (ver8에서 이수일자 비교가 깨진 원인 — 조용히 통과시키지 않고 이상 값으로 드러낸다.)
  function normDate(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date && !isNaN(v.getTime())) return isoDate(v);
    var s = S(v);
    if (!s) return '';
    var m = s.match(/^(\d{4})[-.\/년\s]+(\d{1,2})[-.\/월\s]+(\d{1,2})/);
    if (m) return pad4(m[1]) + '-' + pad2(m[2]) + '-' + pad2(m[3]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    return '';
  }
  function pad2(x) { x = String(x); return x.length < 2 ? '0' + x : x; }
  function pad4(x) { return String(x); }
  function isoDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  // '연도/차수'(예: "2026 / 14")에서 차수 숫자만 추출. 인식 실패 시 null.
  function parseRound(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? Math.trunc(v) : null;
    var s = S(v);
    if (!s) return null;
    var i = s.indexOf('/');
    var tail = i < 0 ? s : s.slice(i + 1);
    var m = String(tail).match(/-?\d+/);
    if (!m) return null;
    var n = parseInt(m[0], 10);
    return isNaN(n) ? null : n;
  }

  // '연도/차수'에서 연도 추출
  function parseYear(v) {
    var s = S(v); var i = s.indexOf('/');
    var head = i < 0 ? '' : s.slice(0, i);
    var m = String(head).match(/\d{4}/);
    return m ? m[0] : '';
  }

  // 직군 정규화: 이수기준이 정의된 두 직군으로 통일(광역전담 → 전담)
  function normDirect(ut) {
    ut = S(ut);
    if (ut === '전담사회복지사' || ut === '광역전담사회복지사') return '전담사회복지사';
    if (ut === '생활지원사') return '생활지원사';
    return ut; // 그 외(중간관리자/기타수행기관종사자 등) — 이수기준 미정의
  }

  // 과정명 앞의 대괄호 토큰 제거 ("[2026년 선택] 치매예방" → "치매예방")
  function stripBracket(name) { return S(name).replace(/^\s*(\[[^\]]*\]\s*)+/, '').trim(); }

  // 선택 과정명 → 정규화 과목명. 접미사(_재응시·_열람전용)는 중첩될 수 있어 반복 제거한다.
  function selBase(name) {
    var n = stripBracket(name), prev;
    do { prev = n; n = n.replace(/_(재응시|열람전용)$/, ''); } while (n !== prev);
    return n.trim();
  }

  // 필수 과정명에서 (경력, 직군) 추출. 예: "[2026년 경력자 필수] 생활지원사"
  //  직군은 대괄호를 걷어낸 '과목 부분'에서 먼저 찾는다 — 대괄호 안의 문구가 직군명을
  //  포함하는 경우(겸직 표기 등)에 오판하지 않기 위함.
  function pilMeta(name) {
    var full = S(name);
    var 경력 = full.indexOf('신규자') >= 0 ? '신규자' : (full.indexOf('경력자') >= 0 ? '경력자' : '');
    var 직군 = pickDirect(stripBracket(full)) || pickDirect(full);
    return { 경력: 경력, 직군: 직군 };
  }
  function pickDirect(s) {
    var a = s.indexOf('전담사회복지사'), b = s.indexOf('생활지원사');
    if (a < 0 && b < 0) return '';
    if (a < 0) return '생활지원사';
    if (b < 0) return '전담사회복지사';
    return a < b ? '전담사회복지사' : '생활지원사'; // 둘 다 있으면 먼저 나오는 쪽
  }

  // 과정 유형/구분 분류. 유형: 필수·신규/필수·경력/선택/기타, 구분: 원과정/재응시/열람전용.
  function courseType(name, cat) {
    name = S(name);
    var 구분 = /_재응시$/.test(name) ? '재응시' : (/_열람전용$/.test(name) ? '열람전용' : '원과정');
    var 유형;
    if (cat === '직무교육(선택)') 유형 = '선택';
    else { var pm = pilMeta(name); 유형 = pm.경력 === '신규자' ? '필수·신규' : (pm.경력 === '경력자' ? '필수·경력' : '기타'); }
    return { 유형: 유형, 구분: 구분, 원과정: 구분 === '원과정' ? '' : selBase(name) || name.replace(/_(재응시|열람전용)$/, '') };
  }

  function isDone(rec) { return S(rec['수료여부']) === '수료'; }
  function isSenior(v) { var s = S(v).toUpperCase(); return s === 'Y' || s === '예' || s === '선임'; }

  /* ---- 메인 분석 함수 ---------------------------------------------------- */
  function analyze(memberRows, studentRows, cfg) {
    cfg = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    var chasi = cfg.chasi || DEFAULT_CHASI;
    var excl = {}; (cfg.excludeStudentStatus || []).forEach(function (s) { excl[s] = 1; });
    var blankScoreAsZero = !!cfg.blankScoreAsZero;

    // 시도 필터: 회원정보 ID→시도 매핑 후, 허용 시도(16개) 밖이면 모든 통계에서 제외
    var allowed = (cfg.allowedSido && cfg.allowedSido.length) ? new Set(cfg.allowedSido.map(S)) : null;
    var memberSido = new Map(), memberName = new Map();
    for (var msi = 0; msi < memberRows.length; msi++) {
      var mid0 = S(memberRows[msi]['ID']);
      memberSido.set(mid0, S(memberRows[msi]['시도']));
      memberName.set(mid0, S(memberRows[msi]['성명']));
    }
    // 직군변경 보류 검토 결정: { ID: 'approve' | 'reject' }
    var decisions = cfg.decisions || {};

    // ---- 1) 학생 데이터 1-pass 집계 -------------------------------------
    var perID = new Map();
    var courseAgg = new Map(); // 과정명 → {enroll:Set(id), done:Set(id), cat}
    var dupComp = new Map();   // (ID§과정명) → 수료 기록들
    var unknownChasi = {};     // 매핑 안된 선택 과목명 집계
    var skippedCancel = 0;
    // [ver9] 조용히 버려지던 값들을 전부 센다(D-19)
    var skippedNoMember = 0, skippedOutRegion = 0, blankScoreSkipped = 0;
    var unknownIDMap = new Map();   // 회원정보에 없는 ID → {ID,성명,기관명,시도,건수}

    function pid(id) {
      var o = perID.get(id);
      if (!o) { o = { pil: new Set(), pilDetail: [], selDone: new Set(), examNoShow: [], subjAny: new Set(), subjDone: new Set(), rows: 0 }; perID.set(id, o); }
      return o;
    }

    for (var i = 0; i < studentRows.length; i++) {
      var r = studentRows[i];
      var status = S(r['상태']);
      if (excl[status]) { skippedCancel++; continue; }
      var id = S(r['ID']);
      if (!id) continue;

      // 지역 필터 — '회원정보에 없음'과 '시도가 목록 밖'을 구분해 집계한다.
      if (!memberSido.has(id)) {
        skippedNoMember++;
        var uk = unknownIDMap.get(id);
        if (!uk) { uk = { ID: id, 성명: S(r['성명']), 기관명: S(r['기관명']), 기관코드: S(r['기관코드']), 시도: S(r['시도']), 시군구: S(r['시군구']), 직군: S(r['사용자유형']), 건수: 0 }; unknownIDMap.set(id, uk); }
        uk.건수++;
        continue;
      }
      if (allowed && !allowed.has(memberSido.get(id))) { skippedOutRegion++; continue; }

      var cat = S(r['카테고리']);
      var name = S(r['과정명']);
      var done = isDone(r);
      var o = pid(id);
      o.rows++;

      // 과목별 현황(취소 제외 신청 기준)
      var ca = courseAgg.get(name);
      if (!ca) { ca = { enroll: new Set(), done: new Set(), cat: cat }; courseAgg.set(name, ca); }
      ca.enroll.add(id); if (done) ca.done.add(id);

      // 중복 이수: 같은 ID가 같은 과정을 2회 이상 '수료'했는지
      if (done) {
        var dk = id + '§' + name;
        var gg = dupComp.get(dk);
        if (!gg) { gg = { ID: id, 성명: S(r['성명']), 기관명: S(r['기관명']), 시도: S(r['시도']), 직군: S(r['사용자유형']), 과정명: name, 카테고리: cat, recs: [] }; dupComp.set(dk, gg); }
        gg.recs.push({ 연도차수: S(r['연도/차수']), 차수: parseRound(r['연도/차수']), 수료일: normDate(r['수료일']) });
      }

      if (cat === '직무교육(필수)') {
        var pm = pilMeta(name);
        if (done && pm.경력 && pm.직군) {
          o.pil.add(pm.경력 + '|' + pm.직군);
          o.pilDetail.push({
            경력: pm.경력, 과정직군: pm.직군, 당시직군: normDirect(S(r['사용자유형'])), 당시직군원본: S(r['사용자유형']),
            과정명: name, 수료일: normDate(r['수료일']), 차수: parseRound(r['연도/차수'])
          });
        }
      } else if (cat === '직무교육(선택)') {
        var sub = selBase(name);
        o.subjAny.add(sub);
        if (done) { o.selDone.add(sub); o.subjDone.add(sub); if (!(sub in chasi)) unknownChasi[sub] = (unknownChasi[sub] || 0) + 1; }
      }

      // 미응시자(진도율 100% & 점수 0, 미수료) 후보 기록
      var prog = parseNum(r['진도율']);
      var scoreBlank = !hasVal(r['점수']);
      var score = parseNum(r['점수']);
      if (prog >= cfg.examNoShow.progressGte && score <= cfg.examNoShow.scoreLte && !done) {
        if (scoreBlank && !blankScoreAsZero) {
          blankScoreSkipped++;  // [ver9] 점수 미기재는 0점과 구분(D-10)
        } else {
          o.examNoShow.push({
            과정명: name, 카테고리: cat, 진도율: prog, 점수: scoreBlank ? '' : score, 점수미기재: scoreBlank,
            교육차시: S(r['교육차시']), 연도차수: S(r['연도/차수']), 차수: parseRound(r['연도/차수']),
            기관명: S(r['기관명']), 시도: S(r['시도']), 시군구: S(r['시군구']), 성명: S(r['성명'])
          });
        }
      }
    }

    // ---- 2) 모수(교육대상자) 결정 + 1인 1행 이수 판정 -------------------
    var uf = cfg.universeFilter || {};
    var ufKeys = Object.keys(uf);
    function passBase(m) { for (var k = 0; k < ufKeys.length; k++) { if (S(m[ufKeys[k]]) !== S(uf[ufKeys[k]])) return false; } return true; }

    var persons = [];
    var notFoundInStudent = 0;  // 대상자인데 수강기록 전혀 없음
    var regionExcluded = 0;     // 교육대상이나 시도가 16개 외라서 제외된 인원
    var doneWithoutRound = 0;   // [ver9] 이수자인데 차수를 확인할 수 없는 인원(D-06)

    for (var j = 0; j < memberRows.length; j++) {
      var m = memberRows[j];
      if (!passBase(m)) continue;
      if (allowed && !allowed.has(S(m['시도']))) { regionExcluded++; continue; }
      var mid = S(m['ID']);
      var ut = S(m['사용자유형']);
      var dir = normDirect(ut);
      var career = S(m['교육구분']); // 신규자/경력자
      var senior = isSenior(m['선임여부']);
      var o2 = perID.get(mid);
      var hasRule = (dir === '생활지원사' || dir === '전담사회복지사') && (career === '신규자' || career === '경력자');

      // [ver9] 선임생활지원사 전용 기준차시(F-10). 미설정 시 생활지원사 기준을 그대로 쓴다.
      var need = 0;
      if (hasRule) {
        need = cfg.thresholds[dir] || 0;
        if (senior && dir === '생활지원사' && cfg.seniorThreshold != null && cfg.seniorThreshold !== '') need = +cfg.seniorThreshold || 0;
      }

      var pilDoneStrict = false, selSum = 0, 이수 = false, reason = '';
      if (o2) {
        pilDoneStrict = o2.pil.has(career + '|' + dir);
        o2.selDone.forEach(function (sub) { selSum += (chasi[sub] || 0); });
      }

      // 직군변경 보류 후보: 현재 직군 필수는 미수료지만, 다른 직군 필수를 수료한 경우.
      // [ver9] 채택 우선순위를 명시한다(D-08): 당시직군 일치 > 경력 일치 > 최신 차수 > 최신 수료일.
      var crossDone = null;
      if (hasRule && !pilDoneStrict && o2) {
        o2.pilDetail.forEach(function (d) {
          if (!d.과정직군 || d.과정직군 === dir) return;
          if (!crossDone || crossBetter(d, crossDone, dir, career)) crossDone = d;
        });
      }
      var isPending = !!crossDone;
      var decision = isPending ? (decisions[mid] || 'pending') : null; // pending/approve/reject
      var pilDone = pilDoneStrict || (isPending && decision === 'approve');
      // [ver9] 보류 건의 경력구분 일치 여부를 판정 결과로 노출한다(D-07).
      var crossCareerMatch = isPending ? (crossDone.경력 === career) : true;

      if (!hasRule) {
        reason = '이수기준 미정의(' + (ut || '미상') + ')';
      } else if (career === '신규자') {
        이수 = pilDone;
        if (!이수) reason = isPending ? '직군변경 검토 필요(당시 ' + crossDone.당시직군 + ')' : '필수 미수료';
      } else { // 경력자
        이수 = pilDone && (selSum >= need);
        if (isPending && decision !== 'approve' && !pilDoneStrict) reason = '직군변경 검토 필요(당시 ' + crossDone.당시직군 + ')' + (selSum < need ? ' · 선택 ' + selSum + '/' + need + '차시' : '');
        else if (!pilDone && selSum < need) reason = '필수 미수료 + 선택 ' + selSum + '/' + need + '차시';
        else if (!pilDone) reason = '필수 미수료';
        else if (selSum < need) reason = '선택 ' + selSum + '/' + need + '차시';
      }
      var approveWould = hasRule && (career === '신규자' ? true : (selSum >= need));

      // 필수과정 수료 차수/이수일자.
      // [ver9] 차수가 비어 있는 수료 기록도 채택한다(D-06). 우선순위는 차수 있는 기록 →
      //        높은 차수 → 늦은 수료일. 전부 차수가 없으면 차수는 null, 이수일자만 채운다.
      var pilPick = null;
      if (o2) {
        o2.pilDetail.forEach(function (d) {
          if (d.경력 !== career || d.과정직군 !== dir) return;
          if (!pilPick || roundBetter(d, pilPick)) pilPick = d;
        });
      }
      if (!pilPick && isPending && decision === 'approve' && crossDone) pilPick = crossDone;
      var pilRound = pilPick ? pilPick.차수 : null;
      var pilDate = pilPick ? (pilPick.수료일 || '') : '';
      if (이수 && pilRound == null) doneWithoutRound++;

      // [ver9] 선택차시가 부족한 경력자에게 '무엇을 더 들으면 되는지' 제시(F-06)
      var 추천과목 = (hasRule && career === '경력자' && selSum < need && o2)
        ? recommend(chasi, o2.selDone, need - selSum) : [];

      persons.push({
        ID: mid, 성명: S(m['성명']), 시도: S(m['시도']), 시군구: S(m['시군구']),
        기관코드: S(m['기관코드']), 기관명: S(m['기관명']), 직군: ut, 직군정규화: dir,
        경력: career, 선임여부: S(m['선임여부']), 선임: senior,
        필수수료: pilDone, 선택차시: selSum, 필요차시: need, 이수: 이수, 차수: pilRound, 이수일자: pilDate,
        기준정의: hasRule, 사유: 이수 ? '' : reason,
        미응시건수: o2 ? o2.examNoShow.length : 0,
        수강기록: o2 ? o2.rows : 0,
        보류후보: isPending, 보류상태: decision,
        당시직군: crossDone ? (crossDone.당시직군원본 || crossDone.당시직군) : '',
        당시경력: crossDone ? crossDone.경력 : '',
        경력일치: crossCareerMatch,
        변경완료과정: crossDone ? crossDone.과정명 : '', 변경완료경력: crossDone ? crossDone.경력 : '',
        변경완료수료일: crossDone ? crossDone.수료일 : '', 승인시이수: isPending ? approveWould : false,
        추천과목: 추천과목.map(function (x) { return x.과목 + '(' + x.차시 + ')'; }).join(' + ')
      });
      if (!o2) notFoundInStudent++;
    }

    // ---- 3) 집계표 생성 -------------------------------------------------
    function rate(done, tot) { return tot ? (100 * done / tot) : 0; }

    var byGroupMap = new Map();
    var bySidoMap = new Map();
    var sidoTreeMap = new Map(); // 시도 → 시군구 → 기관 집계

    persons.forEach(function (p) {
      if (!p.기준정의) return; // 헤드라인 이수율은 생활지원사/전담만
      agg(byGroupMap, p.직군정규화 + ' / ' + p.경력, p.이수);
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
    function mapToRows(map) {
      var arr = []; map.forEach(function (v, k) { arr.push({ key: k, 대상자: v.tot, 이수자: v.done, 미이수자: v.tot - v.done, 이수율: rate(v.done, v.tot) }); });
      arr.sort(function (a, b) { return b.대상자 - a.대상자; });
      return arr;
    }

    // 과목별 현황
    var courseRows = [];
    courseAgg.forEach(function (v, k) {
      var ct = courseType(k, v.cat);
      courseRows.push({ 과정명: k, 카테고리: v.cat, 유형: ct.유형, 구분: ct.구분, 원과정: ct.원과정, 신청자: v.enroll.size, 수료자: v.done.size, 수료율: rate(v.done.size, v.enroll.size) });
    });
    courseRows.sort(function (a, b) { return b.신청자 - a.신청자; });

    // 미응시자(진도율100·점수0) — 1인 1과목, 해당 과목 최종 미완료만 '재응시 필요'
    var personByID = new Map(); persons.forEach(function (p) { personByID.set(p.ID, p); });
    var examNoShowRows = [];
    perID.forEach(function (o, id) {
      if (!o.examNoShow.length) return;
      var seen = {};
      o.examNoShow.forEach(function (e) {
        // [ver9] 필수 과정도 _열람전용 접미사를 벗긴다(D-21)
        var base = e.카테고리 === '직무교육(선택)' ? selBase(e.과정명) : S(e.과정명).replace(/_(재응시|열람전용)$/, '');
        if (seen[base]) return; seen[base] = 1;
        var subjectDone;
        if (e.카테고리 === '직무교육(필수)') { var pm2 = pilMeta(e.과정명); subjectDone = o.pil.has(pm2.경력 + '|' + pm2.직군); }
        else subjectDone = o.subjDone.has(base);
        var per = personByID.get(id) || {};
        examNoShowRows.push({
          ID: id, 성명: e.성명 || per.성명 || '', 기관명: e.기관명 || per.기관명 || '', 기관코드: per.기관코드 || '',
          시도: per.시도 || memberSido.get(id) || e.시도 || '', 시군구: e.시군구 || per.시군구 || '',
          카테고리: e.카테고리, 과정명: e.과정명, 연도차수: e.연도차수, 차수: e.차수,
          진도율: e.진도율, 점수: e.점수, 점수미기재: !!e.점수미기재,
          해당과목완료: subjectDone, 전체이수: !!per.이수, 직군: per.직군 || '', 경력: per.경력 || '',
          // 재응시 필요 = 해당 과목 미완료 AND 본인이 아직 직무교육 미이수(이미 이수자는 제외)
          재응시필요: !subjectDone && !per.이수
        });
      });
    });
    examNoShowRows.sort(function (a, b) { return (a.재응시필요 === b.재응시필요) ? 0 : (a.재응시필요 ? -1 : 1); });

    // 미이수자 명단 — 미검토 보류건은 제외(보류 탭에서 검토)
    var notCompleted = persons.filter(function (p) { return p.기준정의 && !p.이수 && !(p.보류후보 && p.보류상태 === 'pending'); });
    var pendingRows = persons.filter(function (p) { return p.기준정의 && p.보류후보; });

    // 중복 이수 확인
    var duplicateRows = []; var dupIDs = {}; var dupReq = 0, dupSel = 0, dupSameRound = 0;
    dupComp.forEach(function (g) {
      if (g.recs.length < 2) return;
      var per = personByID.get(g.ID) || {};
      dupIDs[g.ID] = 1;
      if (g.카테고리 === '직무교육(필수)') dupReq++; else if (g.카테고리 === '직무교육(선택)') dupSel++;
      var roundSet = {}; g.recs.forEach(function (x) { roundSet[x.차수 == null ? '?' : x.차수] = 1; });
      var 중복유형 = Object.keys(roundSet).length >= 2 ? '재수강(다차수)' : '동일차수 중복';
      if (중복유형 === '동일차수 중복') dupSameRound++;
      duplicateRows.push({
        ID: g.ID, 성명: per.성명 || g.성명, 시도: per.시도 || g.시도, 시군구: per.시군구 || '', 기관명: per.기관명 || g.기관명, 기관코드: per.기관코드 || '',
        직군: per.직군 || g.직군, 과정명: g.과정명, 카테고리: g.카테고리, 중복유형: 중복유형, 수료횟수: g.recs.length,
        차수: g.recs.map(function (x) { return x.연도차수; }).join(', '),
        수료일: g.recs.map(function (x) { return x.수료일; }).filter(Boolean).join(', '),
        직무교육이수: !!per.이수, 교육대상: !!per.기준정의
      });
    });
    duplicateRows.sort(function (a, b) { return b.수료횟수 - a.수료횟수 || (a.ID < b.ID ? -1 : 1); });

    // [ver9] 차수별 이수 추이(F-08) — 이수자를 이수 차수 기준으로 묶어 누적한다.
    var ruleP = persons.filter(function (p) { return p.기준정의; });
    var roundMap = new Map();
    ruleP.forEach(function (p) { if (!p.이수 || p.차수 == null) return; roundMap.set(p.차수, (roundMap.get(p.차수) || 0) + 1); });
    var byRound = []; var rkeys = []; roundMap.forEach(function (v, k) { rkeys.push(k); });
    rkeys.sort(function (a, b) { return a - b; });
    var cum = 0;
    rkeys.forEach(function (k) { cum += roundMap.get(k); byRound.push({ 차수: k, 이수자: roundMap.get(k), 누적이수자: cum, 누적이수율: rate(cum, ruleP.length) }); });

    var unknownIDs = []; unknownIDMap.forEach(function (v) { unknownIDs.push(v); });
    unknownIDs.sort(function (a, b) { return b.건수 - a.건수; });

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
      지역외제외: regionExcluded,
      보류미검토: pendingRows.filter(function (p) { return p.보류상태 === 'pending'; }).length,
      보류승인: pendingRows.filter(function (p) { return p.보류상태 === 'approve'; }).length,
      보류경력불일치: pendingRows.filter(function (p) { return !p.경력일치; }).length,
      중복수료건수: duplicateRows.length, 중복수료인원: Object.keys(dupIDs).length, 중복수료필수: dupReq, 중복수료선택: dupSel, 중복동일차수: dupSameRound,
      // [ver9] 지금까지 화면에 없던 지표들
      회원정보없는ID행: skippedNoMember,
      회원정보없는ID수: unknownIDs.length,
      지역외수강행: skippedOutRegion,
      차수없는이수자: doneWithoutRound,
      점수미기재제외: blankScoreSkipped
    };

    return {
      version: VERSION,
      config: cfg,
      kpi: kpi,
      byGroup: mapToRows(byGroupMap),
      bySido: mapToRows(bySidoMap),
      sidoTree: sidoTreeMap,
      byRound: byRound,
      courseRows: courseRows,
      persons: persons,
      notCompleted: notCompleted,
      pendingRows: pendingRows,
      duplicateRows: duplicateRows,
      examNoShowRows: examNoShowRows,
      unknownChasi: unknownChasi,
      unknownIDs: unknownIDs,
      counts: { memberRows: memberRows.length, studentRows: studentRows.length, universe: persons.length }
    };
  }

  // 보류 후보 기록 비교 — 새 기록 d가 기존 c보다 나은가
  function crossBetter(d, c, dir, career) {
    var dm = (d.당시직군 === d.과정직군) ? 1 : 0, cm = (c.당시직군 === c.과정직군) ? 1 : 0;
    if (dm !== cm) return dm > cm;
    var dc = (d.경력 === career) ? 1 : 0, cc = (c.경력 === career) ? 1 : 0;
    if (dc !== cc) return dc > cc;
    return roundBetter(d, c);
  }
  // 수료 기록 비교 — 차수 있는 쪽 > 높은 차수 > 늦은 수료일
  function roundBetter(d, c) {
    var dh = d.차수 != null ? 1 : 0, ch = c.차수 != null ? 1 : 0;
    if (dh !== ch) return dh > ch;
    if (dh && d.차수 !== c.차수) return d.차수 > c.차수;
    return (d.수료일 || '') > (c.수료일 || '');
  }

  // 부족 차시를 채우는 미수료 과목 조합. 차시가 큰 과목부터 담아 '과목 수 최소'를 노린다.
  function recommend(chasi, doneSet, needMore) {
    var cand = Object.keys(chasi)
      .filter(function (k) { return !doneSet.has(k) && (chasi[k] || 0) > 0; })
      .map(function (k) { return { 과목: k, 차시: chasi[k] }; })
      .sort(function (a, b) { return b.차시 - a.차시 || a.과목.localeCompare(b.과목, 'ko'); });
    var out = [], sum = 0;
    for (var i = 0; i < cand.length && sum < needMore; i++) { out.push(cand[i]); sum += cand[i].차시; }
    // 마지막 과목을 더 작은 것으로 바꿔도 충족되면 교체(과잉 추천 줄이기)
    if (out.length) {
      var base = sum - out[out.length - 1].차시;
      for (var j = cand.length - 1; j >= 0; j--) {
        if (out.indexOf(cand[j]) >= 0) continue;
        if (base + cand[j].차시 >= needMore) { out[out.length - 1] = cand[j]; break; }
      }
    }
    return out;
  }

  /* ---- [ver9] 업로드 진단(F-01) -------------------------------------------
   * 원데이터가 '기대한 대로 읽혔는지'를 사람이 볼 수 있게 요약한다.
   * 인식되지 않은 값은 조용히 넘어가지 않고 전부 여기서 드러난다. */
  function diagnose(memberRows, studentRows, cfg) {
    cfg = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    var allowed = new Set((cfg.allowedSido || []).map(S));
    var chasi = cfg.chasi || DEFAULT_CHASI;
    var out = { member: null, student: null, issues: [] };

    function tally(rows, col) { var m = new Map(); rows.forEach(function (r) { var v = S(r[col]); m.set(v, (m.get(v) || 0) + 1); }); return m; }
    function toArr(m) { var a = []; m.forEach(function (v, k) { a.push({ 값: k === '' ? '(빈칸)' : k, 건수: v }); }); a.sort(function (x, y) { return y.건수 - x.건수; }); return a; }
    function split(m, okFn) {
      var ok = [], bad = [];
      m.forEach(function (v, k) { (okFn(k) ? ok : bad).push({ 값: k === '' ? '(빈칸)' : k, 건수: v }); });
      ok.sort(function (x, y) { return y.건수 - x.건수; }); bad.sort(function (x, y) { return y.건수 - x.건수; });
      return { 인식: ok, 미인식: bad, 인식건수: ok.reduce(function (s, x) { return s + x.건수; }, 0), 미인식건수: bad.reduce(function (s, x) { return s + x.건수; }, 0) };
    }
    function add(level, 항목, 내용) { out.issues.push({ level: level, 항목: 항목, 내용: 내용 }); }

    if (memberRows && memberRows.length) {
      var idCnt = new Map();
      memberRows.forEach(function (r) { var v = S(r['ID']); if (v) idCnt.set(v, (idCnt.get(v) || 0) + 1); });
      var dupID = []; idCnt.forEach(function (v, k) { if (v > 1) dupID.push({ ID: k, 행수: v }); });
      dupID.sort(function (a, b) { return b.행수 - a.행수; });
      var noID = memberRows.filter(function (r) { return !S(r['ID']); }).length;

      var f = {
        시도: split(tally(memberRows, '시도'), function (k) { return allowed.has(k); }),
        사용자유형: split(tally(memberRows, '사용자유형'), function (k) { var d = normDirect(k); return d === '생활지원사' || d === '전담사회복지사'; }),
        교육구분: split(tally(memberRows, '교육구분'), function (k) { return k === '신규자' || k === '경력자'; }),
        교육대상여부: split(tally(memberRows, '교육대상여부'), function (k) { return k === S(cfg.universeFilter['교육대상여부']); }),
        상태: split(tally(memberRows, '상태'), function (k) { return k === S(cfg.universeFilter['상태']); })
      };
      out.member = { 행수: memberRows.length, 중복ID: dupID, ID없는행: noID, 열: f };

      if (dupID.length) add('warn', '회원정보 중복 ID', dupID.length + '명의 ID가 2행 이상 있습니다. 최신 행만 사용하고 나머지는 제외했습니다.');
      if (noID) add('warn', '회원정보 ID 없음', noID + '행에 ID가 없어 집계에서 빠집니다.');
      if (f.시도.미인식건수) add('err', '대상 시도 밖', f.시도.미인식.slice(0, 6).map(function (x) { return x.값 + '(' + x.건수 + ')'; }).join(', ') + ' — 이 인원은 모든 통계에서 제외됩니다. 표기가 다른 것뿐이라면 설정에서 대상 시도를 맞춰 주세요.');
      if (f.교육구분.미인식건수) add('warn', '교육구분 미인식', f.교육구분.미인식.slice(0, 6).map(function (x) { return x.값 + '(' + x.건수 + ')'; }).join(', ') + ' — 신규자/경력자가 아니면 이수 판정을 할 수 없습니다.');
      if (f.교육대상여부.미인식건수 && !f.교육대상여부.인식건수) add('err', '교육대상여부 전부 미인식', '기대값 "' + S(cfg.universeFilter['교육대상여부']) + '"과 일치하는 행이 없습니다. 대상자가 0명이 됩니다.');
    }

    if (studentRows && studentRows.length) {
      var catT = split(tally(studentRows, '카테고리'), function (k) { return k === '직무교육(필수)' || k === '직무교육(선택)'; });

      // 날짜/차수 형식 점검
      var dateStat = {}, roundOK = 0, roundBad = new Map(), yearSet = new Map();
      ['수료일', '교육신청일'].forEach(function (c) { dateStat[c] = { 정상: 0, 빈칸: 0, 이상: new Map() }; });
      var pilNoMeta = new Map(), selNoChasi = new Map();
      var memberIDs = new Set(); (memberRows || []).forEach(function (r) { var v = S(r['ID']); if (v) memberIDs.add(v); });
      var unknownID = new Set();

      studentRows.forEach(function (r) {
        ['수료일', '교육신청일'].forEach(function (c) {
          var raw = r[c];
          if (!hasVal(raw)) { dateStat[c].빈칸++; return; }
          if (normDate(raw)) dateStat[c].정상++;
          else { var k = S(raw); dateStat[c].이상.set(k, (dateStat[c].이상.get(k) || 0) + 1); }
        });
        var yc = r['연도/차수'];
        if (parseRound(yc) == null) { var kk = S(yc) || '(빈칸)'; roundBad.set(kk, (roundBad.get(kk) || 0) + 1); }
        else { roundOK++; var y = parseYear(yc); if (y) yearSet.set(y, (yearSet.get(y) || 0) + 1); }

        var cat = S(r['카테고리']), nm = S(r['과정명']);
        if (cat === '직무교육(필수)') { var pm = pilMeta(nm); if (!pm.경력 || !pm.직군) pilNoMeta.set(nm, (pilNoMeta.get(nm) || 0) + 1); }
        else if (cat === '직무교육(선택)') { var sb = selBase(nm); if (!(sb in chasi)) selNoChasi.set(sb, (selNoChasi.get(sb) || 0) + 1); }

        var sid = S(r['ID']); if (sid && !memberIDs.has(sid)) unknownID.add(sid);
      });

      out.student = {
        행수: studentRows.length,
        카테고리: catT,
        날짜: { 수료일: fmtDate(dateStat['수료일']), 교육신청일: fmtDate(dateStat['교육신청일']) },
        차수: { 정상: roundOK, 이상: toArr(roundBad), 연도: toArr(yearSet) },
        과정명: { 필수_직군경력_미추출: toArr(pilNoMeta), 선택_차시미매핑: toArr(selNoChasi) },
        회원정보없는ID수: unknownID.size
      };

      if (catT.미인식건수) add('err', '카테고리 미인식', catT.미인식.slice(0, 6).map(function (x) { return x.값 + '(' + x.건수 + ')'; }).join(', ') + ' — 이 행들은 이수 판정에 전혀 반영되지 않습니다.');
      ['수료일', '교육신청일'].forEach(function (c) {
        var d = dateStat[c]; if (!d.이상.size) return;
        var s = []; d.이상.forEach(function (v, k) { s.push(k + '(' + v + ')'); });
        add('err', c + ' 형식 이상', s.slice(0, 5).join(', ') + ' — YYYY-MM-DD로 읽히지 않아 이수일자·산출기간 계산에서 빠집니다.');
      });
      if (roundBad.size) {
        var rs = []; roundBad.forEach(function (v, k) { rs.push(k + '(' + v + ')'); });
        add('warn', '연도/차수 인식 실패', rs.slice(0, 5).join(', ') + ' — 해당 수료 기록은 차수 없이 집계되어 산출기간(차수 기준)에서 빠집니다.');
      }
      if (pilNoMeta.size) {
        var ps = []; pilNoMeta.forEach(function (v, k) { ps.push(k + '(' + v + ')'); });
        add('err', '필수 과정명에서 직군·경력 추출 실패', ps.slice(0, 4).join(', ') + ' — 이 수료는 이수로 인정되지 않습니다.');
      }
      if (selNoChasi.size) {
        var ss = []; selNoChasi.forEach(function (v, k) { ss.push(k + '(' + v + ')'); });
        add('warn', '차시 매핑 없는 선택과목', ss.slice(0, 6).join(', ') + ' — 0차시로 계산됩니다. 설정에서 차시를 추가하세요.');
      }
      if (unknownID.size) add('warn', '회원정보에 없는 ID', unknownID.size + '명의 수강기록이 전량 제외됩니다. 회원정보를 최신본으로 갱신하세요.');
    }

    var order = { err: 0, warn: 1, info: 2 };
    out.issues.sort(function (a, b) { return order[a.level] - order[b.level]; });
    return out;

    function fmtDate(d) { var a = []; d.이상.forEach(function (v, k) { a.push({ 값: k, 건수: v }); }); a.sort(function (x, y) { return y.건수 - x.건수; }); return { 정상: d.정상, 빈칸: d.빈칸, 이상: a }; }
  }

  /* ---- 데이터 업데이트 현황(연도/차수 기준) ------------------------------- */
  function coverage(studentRows) {
    var yrMap = new Map();
    var courseMap = new Map();
    var minApply = '', maxApply = '', maxDone = '', maxRound = 0, years = {};
    for (var i = 0; i < studentRows.length; i++) {
      var r = studentRows[i];
      var round = parseRound(r['연도/차수']);
      var year = parseYear(r['연도/차수']);
      var apply = normDate(r['교육신청일']), done = normDate(r['수료일']);
      if (apply) { if (!minApply || apply < minApply) minApply = apply; if (apply > maxApply) maxApply = apply; }
      if (done && done > maxDone) maxDone = done;
      if (round == null || !year) continue;
      years[year] = 1; if (round > maxRound) maxRound = round;
      var yk = year + '|' + round;
      var ye = yrMap.get(yk);
      if (!ye) { ye = { 연도: year, 차수: round, 건수: 0, 최초신청일: '', 최근신청일: '' }; yrMap.set(yk, ye); }
      ye.건수++; if (apply) { if (!ye.최초신청일 || apply < ye.최초신청일) ye.최초신청일 = apply; if (apply > ye.최근신청일) ye.최근신청일 = apply; }
      var nm = S(r['과정명']);
      var ce = courseMap.get(nm);
      if (!ce) { ce = { 과정명: nm, 카테고리: S(r['카테고리']), 연도: year, _set: {}, 최신차수: 0, 건수: 0, 최근신청일: '', 최근수료일: '' }; courseMap.set(nm, ce); }
      ce._set[round] = 1; if (round > ce.최신차수) ce.최신차수 = round; ce.건수++;
      if (apply > ce.최근신청일) ce.최근신청일 = apply; if (done > ce.최근수료일) ce.최근수료일 = done;
    }
    var byYearRound = []; yrMap.forEach(function (v) { byYearRound.push(v); });
    byYearRound.sort(function (a, b) { return a.연도 === b.연도 ? a.차수 - b.차수 : (a.연도 < b.연도 ? -1 : 1); });
    var byCourse = []; courseMap.forEach(function (v) { var ks = Object.keys(v._set).map(Number).sort(function (a, b) { return a - b; }); v.보유차수 = compactRanges(ks); v.차수수 = ks.length; delete v._set; byCourse.push(v); });
    byCourse.sort(function (a, b) { return b.건수 - a.건수; });
    return { byYearRound: byYearRound, byCourse: byCourse, summary: { 연도: Object.keys(years).sort(), 최신차수: maxRound, 행수: studentRows.length, 최초신청일: minApply, 최근신청일: maxApply, 최근수료일: maxDone } };
  }

  // 연속 차수를 "1~6, 9, 11~13" 형태로 압축
  function compactRanges(arr) {
    if (!arr.length) return '';
    var out = [], s = arr[0], p = arr[0];
    for (var i = 1; i < arr.length; i++) { if (arr[i] === p + 1) { p = arr[i]; continue; } out.push(s === p ? '' + s : s + '~' + p); s = p = arr[i]; }
    out.push(s === p ? '' + s : s + '~' + p); return out.join(', ');
  }

  var API = {
    VERSION: VERSION,
    analyze: analyze, coverage: coverage, diagnose: diagnose,
    DEFAULT_CONFIG: DEFAULT_CONFIG, DEFAULT_CHASI: DEFAULT_CHASI, DEFAULT_SIDO: DEFAULT_SIDO,
    normDirect: normDirect, selBase: selBase, pilMeta: pilMeta, courseType: courseType,
    normDate: normDate, parseRound: parseRound, parseYear: parseYear, hasVal: hasVal, isSenior: isSenior
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.LMS = API;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
