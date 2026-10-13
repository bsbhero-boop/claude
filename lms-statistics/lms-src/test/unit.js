/* =============================================================================
 *  compute.js 단위 검증 — ver8에서 발견된 결함이 ver9에서 재발하지 않는지 확인한다.
 *  실행: node lms-src/test/unit.js
 * ========================================================================== */
'use strict';
var L = require('../compute.js');

var pass = 0, fail = 0, log = [];
function ok(name, cond, detail) {
  if (cond) { pass++; log.push('  ✓ ' + name); }
  else { fail++; log.push('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}
function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), '기대 ' + JSON.stringify(expected) + ', 실제 ' + JSON.stringify(actual));
}
function group(t) { log.push(''); log.push(t); }

var M = function (id, ut, gb, o) {
  return Object.assign({ ID: id, 성명: '테스트' + id, 시도: '서울', 시군구: '강남구', 기관코드: 'A1', 기관명: '기관A',
    사용자유형: ut, 교육구분: gb, 교육대상여부: 'Y', 상태: '정상', 선임여부: 'N' }, o || {});
};
var S = function (id, cat, name, ut, o) {
  return Object.assign({ ID: id, 성명: '테스트' + id, 카테고리: cat, 과정명: name, 수료여부: '수료', 상태: '정상',
    진도율: '100', 점수: '80', 수료일: '2026-03-10', '연도/차수': '2026 / 5', 사용자유형: ut || '생활지원사',
    시도: '서울', 시군구: '강남구', 기관명: '기관A', 기관코드: 'A1', 교육차시: '8', 교육신청일: '2026-02-01' }, o || {});
};

/* ── D-02 · 날짜 정규화 ─────────────────────────────────────────────── */
group('D-02  날짜 정규화 (normDate)');
eq('YYYY-MM-DD 그대로', L.normDate('2026-03-10'), '2026-03-10');
eq('점 구분자', L.normDate('2026.03.10'), '2026-03-10');
eq('슬래시 구분자', L.normDate('2026/03/10'), '2026-03-10');
eq('한 자리 월·일', L.normDate('2026-3-1'), '2026-03-01');
eq('연월일 한글', L.normDate('2026년 3월 10일'), '2026-03-10');
eq('구분자 없음', L.normDate('20260310'), '2026-03-10');
eq('Date 객체', L.normDate(new Date(2026, 2, 10)), '2026-03-10');
eq('빈값', L.normDate(''), '');
eq('모호한 M/D/YY 는 거부', L.normDate('3/10/26'), '');

/* ── D-01 · 차수 파싱 ───────────────────────────────────────────────── */
group('D-01  차수 파싱 (parseRound)');
eq('정상 표기', L.parseRound('2026 / 14'), 14);
eq('공백 없음', L.parseRound('2026/3'), 3);
eq('앞자리 0', L.parseRound('2026 / 05'), 5);
eq('차수만', L.parseRound('7'), 7);
eq('숫자형', L.parseRound(9), 9);
eq('빈값', L.parseRound(''), null);
eq('연도 추출', L.parseYear('2026 / 14'), '2026');

/* ── D-03 · 회원정보 중복은 진단에서 드러난다 ────────────────────────── */
group('D-03  회원정보 중복 ID 감지');
var dg = L.diagnose([M('u1', '생활지원사', '신규자'), M('u1', '생활지원사', '신규자'), M('u2', '생활지원사', '신규자')], []);
eq('중복 ID 1건 탐지', dg.member.중복ID.length, 1);
ok('중복 경고 발생', dg.issues.some(function (x) { return /중복 ID/.test(x.항목); }));

/* ── D-05 · 미인식 값 진단 ──────────────────────────────────────────── */
group('D-05  카테고리·시도 미인식 감지');
var dg2 = L.diagnose(
  [M('u1', '생활지원사', '신규자'), M('u2', '생활지원사', '신규자', { 시도: '서울특별시' })],
  [S('u1', '직무교육（필수）', '[2026년 신규자 필수] 생활지원사')]
);
ok('시도 미인식 감지', dg2.member.열.시도.미인식건수 === 1);
ok('카테고리 미인식 감지', dg2.student.카테고리.미인식건수 === 1);
ok('오류 등급으로 보고', dg2.issues.some(function (x) { return x.level === 'err' && /카테고리/.test(x.항목); }));

/* ── D-06 · 차수 없는 필수 수료도 이수일자를 잡는다 ──────────────────── */
group('D-06  차수 결측 수료 기록 처리');
var r6 = L.analyze([M('u1', '생활지원사', '신규자')],
  [S('u1', '직무교육(필수)', '[2026년 신규자 필수] 생활지원사', null, { '연도/차수': '' })], {});
var p6 = r6.persons[0];
ok('이수 판정 유지', p6.이수 === true);
eq('차수는 null', p6.차수, null);
eq('이수일자는 채워짐', p6.이수일자, '2026-03-10');
eq('차수없는 이수자 KPI', r6.kpi.차수없는이수자, 1);

group('D-06b  차수 있는 기록이 있으면 그쪽을 우선');
var r6b = L.analyze([M('u1', '생활지원사', '신규자')], [
  S('u1', '직무교육(필수)', '[2026년 신규자 필수] 생활지원사', null, { '연도/차수': '', 수료일: '2026-09-09' }),
  S('u1', '직무교육(필수)', '[2026년 신규자 필수] 생활지원사', null, { '연도/차수': '2026 / 4', 수료일: '2026-03-10' })
], {});
eq('차수 있는 기록 채택', r6b.persons[0].차수, 4);
eq('차수없는 이수자 0', r6b.kpi.차수없는이수자, 0);

/* ── D-07 · 보류 경력구분 노출 ──────────────────────────────────────── */
group('D-07  보류 건의 경력구분 불일치 노출');
var r7 = L.analyze([M('u1', '생활지원사', '신규자')],
  [S('u1', '직무교육(필수)', '[2026년 경력자 필수] 전담사회복지사', '전담사회복지사')], {});
var p7 = r7.persons[0];
ok('보류 후보로 인식', p7.보류후보 === true);
eq('당시 경력 노출', p7.당시경력, '경력자');
eq('경력 불일치 표시', p7.경력일치, false);
eq('경력불일치 KPI', r7.kpi.보류경력불일치, 1);

group('D-07b  경력이 일치하는 보류 건');
var r7b = L.analyze([M('u1', '생활지원사', '경력자')],
  [S('u1', '직무교육(필수)', '[2026년 경력자 필수] 전담사회복지사', '전담사회복지사')], {});
eq('경력 일치 표시', r7b.persons[0].경력일치, true);
eq('경력불일치 KPI 0', r7b.kpi.보류경력불일치, 0);

/* ── D-08 · 보류 승인 시 최신 기록 채택 ─────────────────────────────── */
group('D-08  보류 승인 시 최신 차수 채택');
var r8 = L.analyze([M('u1', '생활지원사', '경력자')], [
  S('u1', '직무교육(필수)', '[2026년 경력자 필수] 전담사회복지사', '전담사회복지사', { '연도/차수': '2026 / 2', 수료일: '2026-01-10' }),
  S('u1', '직무교육(필수)', '[2026년 경력자 필수] 전담사회복지사', '전담사회복지사', { '연도/차수': '2026 / 12', 수료일: '2026-06-20' })
], { decisions: { u1: 'approve' } });
eq('최신 차수 채택', r8.persons[0].차수, 12);
eq('최신 수료일 채택', r8.persons[0].이수일자, '2026-06-20');

group('D-08b  당시직군 일치가 최신 차수보다 우선');
var r8b = L.analyze([M('u1', '생활지원사', '경력자')], [
  S('u1', '직무교육(필수)', '[2026년 경력자 필수] 전담사회복지사', '생활지원사', { '연도/차수': '2026 / 12' }),
  S('u1', '직무교육(필수)', '[2026년 경력자 필수] 전담사회복지사', '전담사회복지사', { '연도/차수': '2026 / 3' })
], {});
eq('당시직군 일치 기록 채택', r8b.persons[0].당시직군, '전담사회복지사');

/* ── D-10 · 점수 미기재 ─────────────────────────────────────────────── */
group('D-10  점수 미기재와 0점 구분');
var noScore = [S('u1', '직무교육(선택)', '[2026년 선택] 치매예방', null, { 수료여부: '미수료', 점수: '', 수료일: '' })];
var r10 = L.analyze([M('u1', '생활지원사', '신규자')], noScore, {});
eq('기본값: 미기재는 미응시 아님', r10.examNoShowRows.length, 0);
eq('제외 건수 노출', r10.kpi.점수미기재제외, 1);
var r10b = L.analyze([M('u1', '생활지원사', '신규자')], noScore, { blankScoreAsZero: true });
eq('설정으로 포함 가능', r10b.examNoShowRows.length, 1);
var r10c = L.analyze([M('u1', '생활지원사', '신규자')],
  [S('u1', '직무교육(선택)', '[2026년 선택] 치매예방', null, { 수료여부: '미수료', 점수: '0', 수료일: '' })], {});
eq('실제 0점은 미응시', r10c.examNoShowRows.length, 1);

/* ── D-19 · 조용히 버려지던 값 노출 ─────────────────────────────────── */
group('D-19  회원정보에 없는 ID 노출');
var r19 = L.analyze([M('u1', '생활지원사', '신규자')], [
  S('u1', '직무교육(필수)', '[2026년 신규자 필수] 생활지원사'),
  S('zz1', '직무교육(필수)', '[2026년 신규자 필수] 생활지원사'),
  S('zz1', '직무교육(선택)', '[2026년 선택] 치매예방'),
  S('zz2', '직무교육(선택)', '[2026년 선택] 치매예방')
], {});
eq('제외된 행 수', r19.kpi.회원정보없는ID행, 3);
eq('제외된 인원 수', r19.kpi.회원정보없는ID수, 2);
eq('명단 확보', r19.unknownIDs.length, 2);
eq('건수 많은 순 정렬', r19.unknownIDs[0].건수, 2);

group('D-19b  지역외 수강행은 별도 집계');
var r19b = L.analyze([M('u1', '생활지원사', '신규자', { 시도: '세종' })],
  [S('u1', '직무교육(필수)', '[2026년 신규자 필수] 생활지원사')], {});
eq('지역외 수강행', r19b.kpi.지역외수강행, 1);
eq('지역외 제외 인원', r19b.kpi.지역외제외, 1);
eq('회원정보없는ID행 0', r19b.kpi.회원정보없는ID행, 0);

/* ── D-21 · 파싱 경계 ───────────────────────────────────────────────── */
group('D-21  과정명 파싱 경계');
eq('접미사 중첩 제거', L.selBase('[2026년 선택] 치매예방_재응시_열람전용'), '치매예방');
eq('접미사 단일 제거', L.selBase('[2026년 선택] 치매예방_재응시'), '치매예방');
eq('대괄호 없는 과목', L.selBase('치매예방'), '치매예방');
eq('괄호 포함 과목명 보존', L.selBase('[2026년 선택] 노인 상담기법 이해와 활용(내러티브상담)'), '노인 상담기법 이해와 활용(내러티브상담)');
eq('필수 메타 추출', L.pilMeta('[2026년 경력자 필수] 전담사회복지사'), { 경력: '경력자', 직군: '전담사회복지사' });
eq('재응시 접미사 무관', L.pilMeta('[2026년 경력자 필수] 생활지원사_재응시'), { 경력: '경력자', 직군: '생활지원사' });
eq('대괄호 안 직군명에 흔들리지 않음', L.pilMeta('[생활지원사 안내] 경력자 필수 전담사회복지사'), { 경력: '경력자', 직군: '전담사회복지사' });

/* ── 이수 판정 핵심(회귀) ───────────────────────────────────────────── */
group('회귀  이수 판정 핵심 규칙');
var rBase = L.analyze([
  M('a', '생활지원사', '신규자'), M('b', '생활지원사', '경력자'),
  M('c', '전담사회복지사', '경력자'), M('d', '광역전담사회복지사', '신규자'), M('e', '중간관리자', '신규자')
], [
  S('a', '직무교육(필수)', '[2026년 신규자 필수] 생활지원사'),
  S('b', '직무교육(필수)', '[2026년 경력자 필수] 생활지원사'),
  S('b', '직무교육(선택)', '[2026년 선택] 노인 상담기법 이해와 활용(내러티브상담)'),   // 5
  S('b', '직무교육(선택)', '[2026년 선택] 노인 상담기법 이해와 활용(동기강화상담)'),   // 5
  S('b', '직무교육(선택)', '[2026년 선택] 종사자 인권과 안전관리'),                   // 3 → 13
  S('c', '직무교육(필수)', '[2026년 경력자 필수] 전담사회복지사', '전담사회복지사'),
  S('c', '직무교육(선택)', '[2026년 선택] 종사자가 알아야 할 기초노무지식'),          // 4
  S('c', '직무교육(선택)', '[2026년 선택] 고위험 노인 상담 및 사례관리'),             // 4  → 8 (<10)
  S('d', '직무교육(필수)', '[2026년 신규자 필수] 전담사회복지사', '광역전담사회복지사')
], {});
var byId = {}; rBase.persons.forEach(function (p) { byId[p.ID] = p; });
ok('신규자 = 필수만으로 이수', byId.a.이수 === true);
ok('경력자 13차시 충족 이수', byId.b.이수 === true && byId.b.선택차시 === 13);
ok('경력자 8/10차시 미달', byId.c.이수 === false && byId.c.선택차시 === 8);
eq('미이수 사유 표기', byId.c.사유, '선택 8/10차시');
ok('광역전담 → 전담 기준 적용', byId.d.이수 === true && byId.d.직군정규화 === '전담사회복지사');
ok('중간관리자는 기준미정의', byId.e.기준정의 === false);
eq('KPI 대상자', rBase.kpi.대상자, 4);
eq('KPI 이수자', rBase.kpi.이수자, 3);
eq('기준미정의', rBase.kpi.기준미정의대상, 1);
eq('집계표 합계 = 대상자', rBase.byGroup.reduce(function (s, x) { return s + x.대상자; }, 0), rBase.kpi.대상자);
eq('시도별 합계 = 대상자', rBase.bySido.reduce(function (s, x) { return s + x.대상자; }, 0), rBase.kpi.대상자);

group('회귀  선택차시 중복 합산 방지');
var rDup = L.analyze([M('u1', '생활지원사', '경력자')], [
  S('u1', '직무교육(필수)', '[2026년 경력자 필수] 생활지원사'),
  S('u1', '직무교육(선택)', '[2026년 선택] 치매예방'),
  S('u1', '직무교육(선택)', '[2026년 선택] 치매예방_재응시'),
  S('u1', '직무교육(선택)', '[2026년 선택] 치매예방_열람전용')
], {});
eq('같은 과목 3회 수료 = 2차시', rDup.persons[0].선택차시, 2);

group('회귀  재수강 시 나중 차수 채택');
var rRe = L.analyze([M('u1', '생활지원사', '신규자')], [
  S('u1', '직무교육(필수)', '[2026년 신규자 필수] 생활지원사', null, { '연도/차수': '2026 / 3', 수료일: '2026-03-01' }),
  S('u1', '직무교육(필수)', '[2026년 신규자 필수] 생활지원사', null, { '연도/차수': '2026 / 7', 수료일: '2026-07-01' })
], {});
eq('나중 차수', rRe.persons[0].차수, 7);
eq('나중 수료일', rRe.persons[0].이수일자, '2026-07-01');
eq('중복유형', rRe.duplicateRows[0].중복유형, '재수강(다차수)');

/* ── F-06 · 남은 선택과목 추천 ──────────────────────────────────────── */
group('F-06  남은 선택과목 추천');
var rRec = L.analyze([M('u1', '생활지원사', '경력자')], [
  S('u1', '직무교육(필수)', '[2026년 경력자 필수] 생활지원사'),
  S('u1', '직무교육(선택)', '[2026년 선택] 노인 상담기법 이해와 활용(내러티브상담)'), // 5
  S('u1', '직무교육(선택)', '[2026년 선택] 종사자 인권과 안전관리')                  // 3 → 8/13
], {});
var pr = rRec.persons[0];
eq('부족 차시 확인', pr.선택차시, 8);
ok('추천 생성', pr.추천과목.length > 0, '추천: ' + pr.추천과목);
var recSum = (pr.추천과목.match(/\((\d+)\)/g) || []).reduce(function (s, x) { return s + parseInt(x.slice(1), 10); }, 0);
ok('추천 합계가 부족분(5) 이상', recSum >= 5, '합계 ' + recSum);
ok('이미 수료한 과목은 추천 제외', pr.추천과목.indexOf('종사자 인권과 안전관리') < 0);
eq('이수자에게는 추천 없음', rBase.persons[1].추천과목, '');

/* ── F-08 · 차수별 추이 ─────────────────────────────────────────────── */
group('F-08  차수별 이수 추이');
var rTr = L.analyze([M('a', '생활지원사', '신규자'), M('b', '생활지원사', '신규자'), M('c', '생활지원사', '신규자')], [
  S('a', '직무교육(필수)', '[2026년 신규자 필수] 생활지원사', null, { '연도/차수': '2026 / 2' }),
  S('b', '직무교육(필수)', '[2026년 신규자 필수] 생활지원사', null, { '연도/차수': '2026 / 5' }),
  S('c', '직무교육(필수)', '[2026년 신규자 필수] 생활지원사', null, { '연도/차수': '2026 / 5' })
], {});
eq('차수 구간 수', rTr.byRound.length, 2);
eq('2차 누적', rTr.byRound[0].누적이수자, 1);
eq('5차 누적', rTr.byRound[1].누적이수자, 3);
eq('누적 이수율', Math.round(rTr.byRound[1].누적이수율), 100);

/* ── F-10 · 선임 기준 ───────────────────────────────────────────────── */
group('F-10  선임생활지원사 전용 기준차시');
var seniorRows = [
  S('s1', '직무교육(필수)', '[2026년 경력자 필수] 생활지원사'),
  S('s1', '직무교육(선택)', '[2026년 선택] 선임생활지원사 직무 및 역할'),  // 3
  S('s1', '직무교육(선택)', '[2026년 선택] 노인 신체건강'),                // 3
  S('s1', '직무교육(선택)', '[2026년 선택] 노인 정신건강')                 // 3 → 9
];
var rS1 = L.analyze([M('s1', '생활지원사', '경력자', { 선임여부: 'Y' })], seniorRows, {});
ok('기본은 생활지원사 기준(13) 적용', rS1.persons[0].필요차시 === 13 && rS1.persons[0].이수 === false);
var rS2 = L.analyze([M('s1', '생활지원사', '경력자', { 선임여부: 'Y' })], seniorRows, { seniorThreshold: 9 });
ok('선임 기준 9차시 적용 시 이수', rS2.persons[0].필요차시 === 9 && rS2.persons[0].이수 === true);
var rS3 = L.analyze([M('s1', '생활지원사', '경력자', { 선임여부: 'N' })], seniorRows, { seniorThreshold: 9 });
ok('비선임에는 미적용', rS3.persons[0].필요차시 === 13);
ok('선임 플래그 노출', rS2.persons[0].선임 === true);

/* ── coverage 회귀 ──────────────────────────────────────────────────── */
group('회귀  coverage() 날짜·차수');
var cv = L.coverage([
  S('a', '직무교육(필수)', '[2026년 신규자 필수] 생활지원사', null, { '연도/차수': '2026 / 3', 교육신청일: '2026.02.01', 수료일: '2026/03/10' }),
  S('b', '직무교육(필수)', '[2026년 신규자 필수] 생활지원사', null, { '연도/차수': '2026 / 14', 교육신청일: '2026-06-01', 수료일: '2026-06-26' })
]);
eq('최신 차수', cv.summary.최신차수, 14);
eq('최초 신청일 정규화', cv.summary.최초신청일, '2026-02-01');
eq('최근 수료일 정규화', cv.summary.최근수료일, '2026-06-26');
eq('연도차수 구간', cv.byYearRound.length, 2);

/* ── F-12 · 차수별 이수현황표 (ver10) ─────────────────────────────────── */
group('F-12  차수별 이수현황 — byRound 신규·경력 × 직군 분해');
var P = '[2026년 신규자 필수] ', K = '[2026년 경력자 필수] ', SEL = '[2026년 선택] ';
var pil = function (id, name, round, ut) { return S(id, '직무교육(필수)', name, ut, { '연도/차수': round === '' ? '' : '2026 / ' + round }); };
var sel = function (id, subj, ut) { return S(id, '직무교육(선택)', SEL + subj, ut); };
var mem12 = [
  M('n1', '생활지원사', '신규자'), M('n2', '생활지원사', '신규자'), M('n3', '생활지원사', '신규자'), M('n4', '생활지원사', '신규자'),
  M('d1', '전담사회복지사', '신규자'), M('d2', '광역전담사회복지사', '신규자'),
  M('e1', '생활지원사', '경력자'), M('e2', '생활지원사', '경력자'), M('e3', '생활지원사', '경력자'),
  M('f1', '전담사회복지사', '경력자'),
  M('x1', '중간관리자', '신규자'),          // 이수기준 미정의 → 표에서 제외
  M('z1', '생활지원사', '신규자')           // 차수 없는 수료 → 어느 차수에도 없음
];
var stu12 = [
  pil('n1', P + '생활지원사', 7), pil('n2', P + '생활지원사', 7), pil('n3', P + '생활지원사', 8), pil('n4', P + '생활지원사', 9),
  pil('d1', P + '전담사회복지사', 9, '전담사회복지사'), pil('d2', P + '전담사회복지사', 9, '광역전담사회복지사'),
  // e1: 필수 15차 + 선택 5+5+3=13차시 → 이수 / e2: 필수 16차 + 선택 3차시 → 미이수 / e3: 필수 7차 + 13차시 → 이수
  pil('e1', K + '생활지원사', 15), sel('e1', '노인 상담기법 이해와 활용(내러티브상담)'), sel('e1', '노인 상담기법 이해와 활용(동기강화상담)'), sel('e1', '노인 신체건강'),
  pil('e2', K + '생활지원사', 16), sel('e2', '노인 신체건강'),
  pil('e3', K + '생활지원사', 7), sel('e3', '노인 상담기법 이해와 활용(내러티브상담)'), sel('e3', '노인 상담기법 이해와 활용(동기강화상담)'), sel('e3', '노인 신체건강'),
  // f1: 전담 경력 필수 21차 + 선택 10차시 → 이수
  pil('f1', K + '전담사회복지사', 21, '전담사회복지사'), sel('f1', '노인 상담기법 이해와 활용(내러티브상담)', '전담사회복지사'), sel('f1', '노인 상담기법 이해와 활용(동기강화상담)', '전담사회복지사'),
  pil('x1', P + '생활지원사', 7, '중간관리자'),
  pil('z1', P + '생활지원사', '')
];
var r12 = L.analyze(mem12, stu12, {});
var br = {}; r12.byRound.forEach(function (r) { br[r.차수] = r; });
var G = L.ROUND_GROUPS;
var cnt = function (n) { return G.map(function (g) { return br[n] ? br[n][g] : null; }); };
eq('열 순서 = 신규(생활·전담) → 경력(생활·전담)', G, ['신규자|생활지원사', '신규자|전담사회복지사', '경력자|생활지원사', '경력자|전담사회복지사']);
eq('이수자가 있는 차수만 행으로', r12.byRound.map(function (r) { return r.차수; }), [7, 8, 9, 15, 21]);
eq('7차 = 신규생활 2 · 경력생활 1', cnt(7), [2, 0, 1, 0]);
eq('9차 = 신규생활 1 · 신규전담 2(광역 포함)', cnt(9), [1, 2, 0, 0]);
eq('21차 = 경력전담 1', cnt(21), [0, 0, 0, 1]);
ok('선택 차시가 부족한 경력자(16차)는 빠짐', !br[16]);
ok('행마다 네 칸의 합 = 그 차수 이수자', r12.byRound.every(function (r) { return G.reduce(function (s, g) { return s + r[g]; }, 0) === r.이수자; }));
eq('차수 합계 = 이수자 − 차수 없는 이수자', r12.byRound.reduce(function (s, r) { return s + r.이수자; }, 0), r12.kpi.이수자 - r12.kpi.차수없는이수자);
eq('누적 이수자(F-08) 유지', r12.byRound.map(function (r) { return r.누적이수자; }), [3, 4, 7, 8, 9]);

group('F-12  차수 지정 해석 (parseRoundSpec · formatRounds)');
var prs = function (t, m) { var x = L.parseRoundSpec(t, m); return [L.formatRounds(x.rounds), x.ignored]; };
eq('범위 + 범위 (이미지 예시)', prs('7-9, 15-21'), ['7~9, 15~21', []]);
eq('물결표·쉼표 붙여 쓰기', prs('7~9,15~21'), ['7~9, 15~21', []]);
eq('"차" 붙여 쓰기', prs('7차, 8차, 9차'), ['7~9', []]);
eq('"7차~9차 15"', prs('7차~9차 15'), ['7~9, 15', []]);
eq('끝이 열린 범위는 최신 차수까지', prs('15~', 21), ['15~21', []]);
eq('최신 차수를 모르면 열린 범위는 반영 안 함', prs('15~', null), ['', ['15-']]);
eq('최신 차수를 넘는 열린 범위는 반영 안 함', prs('15~', 10), ['', ['15-']]);
eq('앞이 열린 범위는 1차부터', prs('~3'), ['1~3', []]);
eq('역순 범위는 바로잡음', prs('9-7'), ['7~9', []]);
eq('잘못된 값은 따로 알림', prs('abc, 0, 5'), ['5', ['abc', '0']]);
eq('터무니없는 범위는 거부', prs('1-5000'), ['', ['1-5000']]);
eq('중복·공백 정리', prs(' 3 , 3, 4 '), ['3~4', []]);
eq('대시 변형(–) 허용', prs('7–9'), ['7~9', []]);
eq('formatRounds 정렬·압축', L.formatRounds([21, 7, 9, 8, 15, 8]), '7~9, 15, 21');

group('F-12  차수별 이수현황표 (roundTable)');
var picks = [7, 8, 9, 15, 16, 17, 18, 19, 20, 21];   // 사용자 이미지의 차수 구성
var t1 = L.roundTable(r12.byRound, picks);
eq('지정한 차수가 전부 행이 됨(이수자 0명 차수 포함)', t1.rows.map(function (r) { return r.차수; }), picks);
eq('이수자 없는 16차는 0', G.map(function (g) { return t1.rows[3 + 1][g]; }), [0, 0, 0, 0]);
eq('7차 행 합계', t1.rows[0].합계, 3);
eq('합계 행', G.map(function (g) { return t1.total[g]; }).concat([t1.total.합계]), [4, 2, 2, 1, 9]);
var t2 = L.roundTable(r12.byRound, { 신규자: [7, 8, 9], 경력자: [15, 16, 17, 18, 19, 20, 21] });
eq('따로 지정: 7차의 경력자 칸은 해당 없음(null)', G.map(function (g) { return t2.rows[0][g]; }), [2, 0, null, null]);
eq('따로 지정: 7차 행 합계는 신규자만', t2.rows[0].합계, 2);
eq('따로 지정: 합계에서 경력 7차(e3) 제외', G.map(function (g) { return t2.total[g]; }).concat([t2.total.합계]), [4, 2, 1, 1, 8]);
var t3 = L.roundTable(r12.byRound, { 신규자: [7, 8, 9], 경력자: [] });
eq('한쪽을 비우면 그쪽 합계는 해당 없음', [t3.total['경력자|생활지원사'], t3.used.경력자, t3.total.합계], [null, false, 6]);
eq('아무것도 지정 안 하면 빈 표', L.roundTable(r12.byRound, []).rows.length, 0);
// 이수율 현황표의 산출기간(차수 7~9)과 같은 기준인지: 사람 단위로 직접 센 값과 대조
var direct = G.map(function (g) {
  return r12.persons.filter(function (p) { return p.기준정의 && p.이수 && p.차수 >= 7 && p.차수 <= 9 && (p.경력 + '|' + p.직군정규화) === g; }).length;
});
eq('사람 단위 직접 집계와 일치(7~9차)', G.map(function (g) { return L.roundTable(r12.byRound, [7, 8, 9]).total[g]; }), direct);

group('F-12  기본 지정·번호 범위 (roundsWithDone · maxRoundByCareer)');
eq('이수자 있는 차수(전체)', L.roundsWithDone(r12.byRound), [7, 8, 9, 15, 21]);
eq('이수자 있는 차수(신규자)', L.roundsWithDone(r12.byRound, '신규자'), [7, 8, 9]);
eq('이수자 있는 차수(경력자)', L.roundsWithDone(r12.byRound, '경력자'), [7, 15, 21]);
eq('데이터의 최신 차수(신규·경력별)', L.maxRoundByCareer(L.coverage(stu12)), { 신규자: 9, 경력자: 21 });
eq('coverage 없을 때', L.maxRoundByCareer(null), { 신규자: 0, 경력자: 0 });

/* ── F-13 · 회원 명단 구성 — 최신 명단 + 퇴사자 (ver11) ──────────────── */
group('F-13  명단 기준일 추정 (rosterDate · compareRosterDate)');
eq('파일명 8자리 날짜', L.rosterDate('회원명단_20261012.xlsx', null), '2026-10-12');
eq('파일명 점 구분', L.rosterDate('회원명단(2026.10.1).xlsx', null), '2026-10-01');
eq('파일명 한글 날짜', L.rosterDate('2026년 9월 30일 명단.xlsx', null), '2026-09-30');
eq('파일명에 날짜 없으면 파일 수정일', L.rosterDate('명단.xlsx', new Date(2026, 7, 15, 10, 0).getTime()), '2026-08-15');
eq('9자리 숫자는 날짜로 보지 않음', L.rosterDate('코드_202610123.xlsx', null), '');
eq('달이 13이면 날짜 아님 → 수정일', L.rosterDate('명단_20261340.xlsx', new Date(2026, 0, 2).getTime()), '2026-01-02');
eq('더 최신 = 1', L.compareRosterDate('2026-10-01', { 기준일: '2026-09-01' }), 1);
eq('같은 날 = 0', L.compareRosterDate('2026-10-01', { 기준일: '2026-10-01' }), 0);
eq('더 이전 = -1', L.compareRosterDate('2026-08-01', { 기준일: '2026-09-01' }), -1);
eq('예전에 저장된 합친 명단(기준일 모름)보다는 항상 최신', L.compareRosterDate('2026-01-01', { legacy: true, 기준일: '2026-12-31' }), 1);

group('F-13  최신 명단 반영 · 직전 명단 자동 보관 (applyLatestRoster)');
var R = function (id, o) { return M(id, '생활지원사', '신규자', o); };
var sep = [R('A'), R('B'), R('C'), R('D')], oct = [R('A'), R('B'), R('C'), R('E')];
var a1 = L.applyLatestRoster(null, null, [], sep, '2026-09-01');
eq('처음 올린 최신 명단', [a1.action, a1.pool.length, a1.moved], ['first', 0, 0]);
var a2 = L.applyLatestRoster(sep, { 기준일: '2026-09-01', filename: '9월명단.xlsx' }, a1.pool, oct, '2026-10-01');
eq('10월 명단 → 9월 명단에서 빠진 D를 퇴사자로 보관', [a2.action, a2.moved, a2.pool.map(function (r) { return r.ID; }).join()], ['moved', 1, 'D']);
eq('퇴사자 최종확인 = 직전 명단 기준일, 출처 = 직전 명단', [a2.pool[0].최종확인, a2.pool[0].출처], ['2026-09-01', '9월명단.xlsx']);
var nov = [R('A'), R('B'), R('D')];
var a3 = L.applyLatestRoster(oct, { 기준일: '2026-10-01', filename: '10월명단.xlsx' }, a2.pool, nov, '2026-11-01');
eq('11월 명단: D 복귀(퇴사자에서 제외), C·E 새 퇴사자', [a3.returned, a3.moved, a3.pool.map(function (r) { return r.ID; }).sort().join()], [1, 2, 'C,E']);
var a4 = L.applyLatestRoster(oct, { 기준일: '2026-10-01' }, a2.pool, [R('A'), R('B'), R('C')], '2026-10-01');
eq('같은 날 명단(정정본)은 교체만, 옮기지 않음', [a4.action, a4.moved, a4.pool.length], ['replaced', 0, 1]);
var a5 = L.applyLatestRoster(sep, { 기준일: '2026-09-01' }, [], oct, '2026-10-01', { keepPrev: true });
eq('keepPrev 옵션이면 교체만', [a5.action, a5.moved], ['replaced', 0]);
var a6 = L.applyLatestRoster(sep, { legacy: true, filename: '합친명단.xlsx' }, [], oct, '2026-10-01');
eq('예전에 저장된 합친 명단 → 최신에 없는 사람이 퇴사자(기준일 모름)', [a6.action, a6.moved, a6.pool[0].ID, a6.pool[0].최종확인], ['moved', 1, 'D', '']);

group('F-13  이전 명단 추가 (addFormerRoster) · 합치기 (combineRoster)');
var latest = [R('A'), R('B'), R('C')];
var merged = [R('A'), R('B'), R('C'), R('D', { 기관명: '기관D-9월' }), R('F')];
var f1 = L.addFormerRoster([], latest, merged, '2026-09-15', '합친명단.xlsx');
eq('최신 명단에 있는 3명은 건너뛰고 D·F만 퇴사자', [f1.added, f1.inLatest, f1.pool.map(function (r) { return r.ID; }).join()], [2, 3, 'D,F']);
var f2 = L.addFormerRoster(f1.pool, latest, [R('D', { 기관명: '기관D-5월' })], '2026-05-01', '5월명단.xlsx');
eq('더 오래된 명단의 정보는 덮어쓰지 않음', [f2.kept, f2.pool[0].기관명], [1, '기관D-9월']);
var f3 = L.addFormerRoster(f1.pool, latest, [R('D', { 기관명: '기관D-9월말' })], '2026-09-30', '9월말명단.xlsx');
eq('더 최근 명단의 정보로 갱신', [f3.updated, f3.pool[0].기관명, f3.pool[0].최종확인], [1, '기관D-9월말', '2026-09-30']);
var cmb = L.combineRoster(latest, f1.pool.concat([R('A', { 기관명: '오래된A' })]));
eq('합치기: 최신 3 + 퇴사자 2, 최신에 있는 ID는 pool에 있어도 무시', [cmb.length, cmb.filter(L.isFormerRow).map(function (r) { return r.ID; }).join()], [5, 'D,F']);
ok('최신 명단 행에는 재직구분을 붙이지 않음(원본 보존)', cmb.slice(0, 3).every(function (r) { return !L.isFormerRow(r); }) && latest[0].재직구분 === undefined);

group('F-13  집계 범위 — 현원(기본) / 현원+퇴사자');
var mem13 = L.combineRoster([
  M('a', '생활지원사', '신규자'), M('b', '생활지원사', '경력자'), M('c', '전담사회복지사', '신규자'),
  M('n', '생활지원사', '신규자', { 교육대상여부: 'N' })                     // 현원이지만 교육대상 아님
], [
  Object.assign(M('d', '생활지원사', '신규자'), { 최종확인: '2026-07-01' }),  // 퇴사·이수
  Object.assign(M('f', '전담사회복지사', '경력자'), { 최종확인: '2026-08-01' }) // 퇴사·미이수
]);
var stu13 = [
  pil('a', P + '생활지원사', 3), pil('c', P + '전담사회복지사', 4, '전담사회복지사'),
  pil('d', P + '생활지원사', 3),
  S('f', '직무교육(필수)', K + '전담사회복지사', '전담사회복지사', { 수료여부: '미수료', 진도율: '100', 점수: '0', '연도/차수': '2026 / 6' })
];
var cur = L.analyze(mem13, stu13, {}), all13 = L.analyze(mem13, stu13, { basis: 'all' });
eq('현원 기준 KPI (대상자·이수자·미이수자)', [cur.kpi.대상자, cur.kpi.이수자, cur.kpi.미이수자, cur.kpi.집계기준], [3, 2, 1, 'current']);
eq('현원+퇴사자 기준 KPI', [all13.kpi.대상자, all13.kpi.이수자, all13.kpi.미이수자, all13.kpi.집계기준], [5, 3, 2, 'all']);
eq('퇴사 지표는 기준과 무관하게 같음', [cur.kpi.퇴사자, cur.kpi.퇴사대상자, cur.kpi.퇴사이수자, cur.kpi.현원대상자, cur.kpi.현원이수자], [2, 2, 1, 3, 2]);
eq('퇴사 지표(포함 기준)', [all13.kpi.퇴사자, all13.kpi.퇴사대상자, all13.kpi.퇴사이수자, all13.kpi.현원대상자], [2, 2, 1, 3]);
var pd = cur.persons.filter(function (p) { return p.ID === 'd'; })[0];
eq('퇴사자 판정 결과에 재직구분·최종확인', [pd.재직, pd.재직구분, pd.최종확인, pd.이수], [false, '퇴사', '2026-07-01', true]);
ok('퇴사자의 수강기록은 버려지지 않음(회원정보 없는 ID 아님)', cur.kpi.회원정보없는ID수 === 0 && cur.courseRows.some(function (r) { return r.신청자 === 2 && r.과정명 === P + '생활지원사'; }));
eq('차수별 이수(3차): 현원 1명 / 포함 2명', [cur.byRound[0].이수자, all13.byRound[0].이수자], [1, 2]);
eq('미이수자 명단: 현원 기준은 퇴사자 제외', [cur.notCompleted.map(function (p) { return p.ID; }).join(), all13.notCompleted.map(function (p) { return p.ID; }).sort().join()], ['b', 'b,f']);
eq('시도·직군 집계도 범위를 따름', [cur.bySido[0].대상자, all13.bySido[0].대상자, cur.byGroup.length, all13.byGroup.length], [3, 5, 3, 4]);
eq('미응시: 현원 기준은 퇴사자 목록 제외', cur.examNoShowRows.length, 0);
eq('미응시: 포함 기준이어도 퇴사자는 재응시 대상 아님', [all13.examNoShowRows.length, all13.examNoShowRows[0].재응시필요, all13.examNoShowRows[0].재직구분, all13.kpi.재응시필요인원], [1, false, '퇴사', 0]);

group('F-13  대상자 산출 내역 (universeSteps)');
var st = cur.steps;
eq('단계 이름', st.map(function (x) { return x.단계; }), ['명단 인원', '교육대상여부 = Y', '상태 = 정상', '대상 시도(16개)', '이수기준 직군·교육구분(생활·전담 × 신규·경력)']);
eq('현원: 4 → 교육대상 3 → … → 대상자 3', st.map(function (x) { return x.재직; }), [4, 3, 3, 3, 3]);
eq('퇴사: 2 → … → 2', st.map(function (x) { return x.퇴사; }), [2, 2, 2, 2, 2]);
eq('마지막 단계 = 현원 대상자 KPI', st[st.length - 1].재직, cur.kpi.현원대상자);
var r0 = L.analyze([M('x1', '생활지원사', '신규자')], [], {});
eq('퇴사자 없는 명단(이전 버전과 동일)', [r0.kpi.퇴사자, r0.kpi.대상자, r0.persons[0].재직구분], [0, 1, '재직']);

/* ── 결과 ───────────────────────────────────────────────────────────── */
console.log(log.join('\n'));
console.log('');
console.log('─'.repeat(58));
console.log(' 통과 ' + pass + '건 / 실패 ' + fail + '건');
console.log('─'.repeat(58));
process.exit(fail ? 1 : 0);
