/* =============================================================================
 *  ver9 브라우저 E2E 검증 — 빌드 결과물(lms-statistics-v9.html)을 실제로 띄워
 *  ver8에서 발견된 결함이 재발하지 않는지 확인한다.
 *
 *  준비: npm i -D playwright   (또는 시스템 Chromium 경로를 CHROME 환경변수로 지정)
 *  실행: node lms-src/test/e2e.js
 * ========================================================================== */
'use strict';
const path = require('path');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('playwright 가 필요합니다:  npm i -D playwright'); process.exit(2); }

// 빌드 버전을 build.js 에서 읽어, 버전을 올릴 때 테스트를 따로 고치지 않아도 되게 한다.
const VER = fs.readFileSync(path.join(__dirname, '..', 'build.js'), 'utf8').match(/const VERSION = '(ver\d+)'/)[1];
const APP = 'file://' + path.resolve(__dirname, '..', '..', 'lms-statistics-v' + VER.slice(3) + '.html');
const EXEC = process.env.CHROME || undefined;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log(''); console.log(t); }

const csv = (h, rs) => '﻿' + [h.join(',')].concat(rs.map(r => r.map(v => {
  v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}).join(','))).join('\n');
const MH = ['No', '시도', '시군구', '읍면동', '기관코드', '기관명', '성명', 'ID', '사용자유형', '권한관리자', '일반', '중점', '특화', '퇴원', '고도화', '선임여부', '교육대상여부', '교육구분', '상태'];
const SH = ['카테고리', '과정명', '교육차시', '교육신청일', '진도율', '점수', '수료여부', '수료일', '상태', 'ID', '성명', '기관코드', '기관명', '시도', '시군구', '사용자유형', '자격번호', '연도/차수'];

const upload = (page, id, name, text) => page.evaluate(async ([i, n, t]) => {
  const f = new File([new TextEncoder().encode(t)], n, { type: 'text/csv' });
  const dt = new DataTransfer(); dt.items.add(f);
  const e = document.getElementById(i); e.files = dt.files; e.dispatchEvent(new Event('change'));
}, [id, name, text]);
const uploadMulti = (page, id, list) => page.evaluate(async ([i, l]) => {
  const dt = new DataTransfer();
  l.forEach(x => dt.items.add(new File([new TextEncoder().encode(x[1])], x[0], { type: 'text/csv' })));
  const e = document.getElementById(i); e.files = dt.files; e.dispatchEvent(new Event('change'));
}, [id, list]);
const tab = (page, label) => page.evaluate(l => {
  [...document.querySelectorAll('.tab')].find(b => b.textContent.includes(l)).click();
}, label);

(async () => {
  if (!fs.existsSync(APP.replace('file://', ''))) { console.error('빌드 결과물이 없습니다. 먼저 node lms-src/build.js 를 실행하세요.'); process.exit(2); }
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  const errors = [], dialogs = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', async d => { dialogs.push(d.message().split('\n')[0]); await d.accept(); });

  await page.goto(APP);
  await page.waitForFunction(() => window.__LMS_APP);

  group('환경');
  const mode = await page.evaluate(() => window.__LMS_ENGINE.mode());
  ok('집계 엔진 기동 (' + mode + ')', mode === 'worker' || mode === 'inline');
  ok('SheetJS 로드', await page.evaluate(() => typeof XLSX !== 'undefined'));
  ok('계산 엔진 로드', await page.evaluate(() => typeof window.LMS === 'object'));

  /* ── D-01 차수 파싱 ─────────────────────────────────────────────── */
  group('D-01  CSV 업로드 시 차수가 보존되는가');
  const mem20 = csv(MH, Array.from({ length: 20 }, (_, i) =>
    [i + 1, '서울', '강남구', '역삼동', 'O1', '기관A', '사람' + i, 'U' + i, '생활지원사', '', '', '', '', '', '', 'N', 'Y', '신규자', '정상']));
  const stu20 = csv(SH, Array.from({ length: 20 }, (_, i) =>
    ['직무교육(필수)', '[2026년 신규자 필수] 생활지원사', '8', '2026-02-01', '100', '90', '수료', '2026-03-10', '정상', 'U' + i, '사람' + i, 'O1', '기관A', '서울', '강남구', '생활지원사', '', '2026 / ' + (i + 1)]));
  await upload(page, 'fileMember', 'm.csv', mem20);
  await page.waitForFunction(() => window.__LMS_APP.members);
  await upload(page, 'fileStudent', 's.csv', stu20);
  await page.waitForFunction(() => window.__LMS_APP.result);
  const rounds = await page.evaluate(() => window.__LMS_APP.result.persons.map(p => p.차수));
  ok('1~20차 모두 정확', rounds.every((r, i) => r === i + 1), rounds.join(','));
  ok('데이터 현황 최신차수 20', await page.evaluate(() => window.__LMS_APP.coverage.summary.최신차수) === 20);

  /* ── D-02 날짜 정규화 ───────────────────────────────────────────── */
  group('D-02  날짜 형식이 달라도 이수일자가 비교 가능한가');
  const dates = await page.evaluate(() => window.__LMS_APP.result.persons.map(p => p.이수일자));
  ok('이수일자 YYYY-MM-DD', dates.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d)), dates[0]);
  ok('산출기간(이수일자) 필터 성립',
    await page.evaluate(() => window.__LMS_APP.result.persons.filter(p => p.이수 && p.이수일자 >= '2026-01-01' && p.이수일자 <= '2026-12-31').length) ===
    await page.evaluate(() => window.__LMS_APP.result.kpi.이수자));

  /* ── D-03 회원정보 중복 ─────────────────────────────────────────── */
  group('D-03  회원정보를 두 번 올려도 대상자가 늘지 않는가');
  const before = await page.evaluate(() => window.__LMS_APP.result.kpi.대상자);
  await uploadMulti(page, 'fileMember', [['m.csv', mem20], ['m사본.csv', mem20]]);
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => window.__LMS_APP.result.kpi.대상자);
  ok('대상자 불변 (' + before + ' → ' + after + ')', before === after);
  ok('중복 ID 정리 건수 노출', await page.evaluate(() => window.__LMS_APP.memberDupRemoved) === 20);

  /* ── D-04 잘못된 파일 ───────────────────────────────────────────── */
  group('D-04  잘못된 파일을 올려도 기존 데이터가 보존되는가');
  const snap = await page.evaluate(() => ({ n: window.__LMS_APP.members.length, k: window.__LMS_APP.result.kpi.대상자, s: window.__LMS_APP.studentCount }));
  dialogs.length = 0;
  await upload(page, 'fileMember', '잘못.csv', stu20);      // 수강생목록을 회원정보 칸에
  await page.waitForTimeout(2200);
  await upload(page, 'fileStudent', '잘못2.csv', mem20);    // 회원정보를 수강생목록 칸에
  await page.waitForTimeout(2200);
  const after2 = await page.evaluate(() => ({ n: window.__LMS_APP.members.length, k: window.__LMS_APP.result.kpi.대상자, s: window.__LMS_APP.studentCount }));
  ok('경고 표시', dialogs.length >= 2, dialogs.join(' / '));
  ok('회원정보 보존', snap.n === after2.n && snap.k === after2.k);
  ok('수강데이터 보존', snap.s === after2.s);
  const savedMeta = await page.evaluate(() => new Promise(r => {
    const q = indexedDB.open('lms-stats', 1);
    q.onsuccess = () => { const g = q.result.transaction('kv', 'readonly').objectStore('kv').get('memberMeta'); g.onsuccess = () => r(g.result); };
  }));
  ok('저장소도 덮어쓰이지 않음', savedMeta && savedMeta.filename.indexOf('잘못') < 0, savedMeta && savedMeta.filename);

  /* ── 문제 데이터로 전환 ─────────────────────────────────────────── */
  group('D-05 · F-01  이상 값이 화면에 드러나는가');
  await tab(page, '설정'); await page.waitForTimeout(300);
  await page.evaluate(() => { [...document.querySelectorAll('#content .btn')].find(b => b.textContent === '수강데이터 비우기').click(); });
  await page.waitForTimeout(800);
  const memBad = csv(MH, [
    [1, '서울', '강남구', '동', 'O1', '기관A', '정상인', 'V1', '생활지원사', '', '', '', '', '', '', 'N', 'Y', '신규자', '정상'],
    [2, '서울특별시', '강남구', '동', 'O1', '기관A', '시도이상', 'V2', '생활지원사', '', '', '', '', '', '', 'N', 'Y', '신규자', '정상'],
    [3, '서울', '강남구', '동', 'O1', '기관A', '차수없음', 'V3', '생활지원사', '', '', '', '', '', '', 'N', 'Y', '신규자', '정상'],
    [4, '서울', '강남구', '동', 'O1', '기관A', '선임씨', 'V4', '생활지원사', '', '', '', '', '', '', 'Y', 'Y', '경력자', '정상'],
    [5, '서울', '강남구', '동', 'O1', '기관A', '전직씨', 'V5', '생활지원사', '', '', '', '', '', '', 'N', 'Y', '신규자', '정상']
  ]);
  const stuBad = csv(SH, [
    ['직무교육(필수)', '[2026년 신규자 필수] 생활지원사', '8', '2026-02-01', '100', '90', '수료', '2026-03-10', '정상', 'V1', '정상인', 'O1', '기관A', '서울', '강남구', '생활지원사', '', '2026 / 3'],
    ['직무교육（필수）', '[2026년 신규자 필수] 생활지원사', '8', '2026-02-01', '100', '90', '수료', '2026-03-10', '정상', 'V1', '정상인', 'O1', '기관A', '서울', '강남구', '생활지원사', '', '2026 / 3'],
    ['직무교육(필수)', '[2026년 신규자 필수] 생활지원사', '8', '2026-02-01', '100', '90', '수료', '2026-03-12', '정상', 'V3', '차수없음', 'O1', '기관A', '서울', '강남구', '생활지원사', '', ''],
    ['직무교육(선택)', '[2026년 선택] 신규개설과목', '2', '2026-02-01', '100', '90', '수료', '2026-03-01', '정상', 'V4', '선임씨', 'O1', '기관A', '서울', '강남구', '생활지원사', '', '2026 / 3'],
    ['직무교육(선택)', '[2026년 선택] 치매예방', '2', '2026-02-01', '100', '', '미수료', '', '정상', 'V1', '정상인', 'O1', '기관A', '서울', '강남구', '생활지원사', '', '2026 / 3'],
    ['직무교육(필수)', '[2026년 경력자 필수] 전담사회복지사', '8', '2026-01-05', '100', '92', '수료', '2026-02-01', '정상', 'V5', '전직씨', 'O2', '기관B', '서울', '강남구', '전담사회복지사', '', '2026 / 2'],
    ['직무교육(필수)', '[2026년 신규자 필수] 생활지원사', '8', '2026-02-01', '100', '90', '수료', '2026-03-10', '정상', 'ZZ9', '외부인', 'O9', '기관Z', '부산', '해운대구', '생활지원사', '', '2026 / 3']
  ]);
  await upload(page, 'fileMember', 'mb.csv', memBad);
  await page.waitForFunction(() => window.__LMS_APP.members.length === 5);
  await upload(page, 'fileStudent', 'sb.csv', stuBad);
  await page.waitForFunction(() => window.__LMS_APP.result && window.__LMS_APP.studentCount === 7);
  const diag = await page.evaluate(() => window.__LMS_APP.diag);
  const items = diag.issues.map(i => i.항목).join(' | ');
  ok('대상 시도 밖 감지', /대상 시도 밖/.test(items));
  ok('카테고리 미인식 감지', /카테고리 미인식/.test(items));
  ok('차수 인식 실패 감지', /연도\/차수 인식 실패/.test(items));
  ok('차시 미매핑 감지', /차시 매핑 없는 선택과목/.test(items));
  ok('회원정보에 없는 ID 감지', /회원정보에 없는 ID/.test(items));
  await tab(page, '데이터 점검'); await page.waitForTimeout(500);
  ok('점검 탭 렌더', await page.evaluate(() => document.querySelectorAll('#content .issue').length) === diag.issues.length);
  ok('탭 뱃지 표시', await page.evaluate(() => !!document.querySelector('.tab .tabbadge')));

  const kpi = await page.evaluate(() => window.__LMS_APP.result.kpi);
  group('D-06 · D-10 · D-19  지금까지 숨어 있던 지표');
  ok('차수 없는 이수자 집계', kpi.차수없는이수자 === 1);
  ok('차수 없어도 이수일자는 확보', await page.evaluate(() => window.__LMS_APP.result.persons.find(p => p.ID === 'V3').이수일자) === '2026-03-12');
  ok('점수 미기재는 미응시에서 제외', kpi.점수미기재제외 === 1 && kpi.미응시연인원 === 0);
  ok('회원정보 없는 ID 집계', kpi.회원정보없는ID수 === 1 && kpi.회원정보없는ID행 === 1);
  ok('제외 ID 명단 확보', await page.evaluate(() => window.__LMS_APP.result.unknownIDs[0].ID) === 'ZZ9');

  group('D-07 · D-08  직군변경 보류');
  const v5 = await page.evaluate(() => window.__LMS_APP.result.persons.find(p => p.ID === 'V5'));
  ok('보류 후보 인식', v5.보류후보 === true);
  ok('당시 경력 노출', v5.당시경력 === '경력자');
  ok('경력 불일치 표시', v5.경력일치 === false);
  ok('경력 불일치 KPI', kpi.보류경력불일치 === 1);
  await tab(page, '보류'); await page.waitForTimeout(500);
  const pcols = await page.evaluate(() => [...document.querySelectorAll('#content table th')].map(t => t.textContent.replace(/[▾▴]/g, '').trim()));
  ok('보류 탭에 "당시 경력" 열', pcols.indexOf('당시 경력(수료시)') >= 0, pcols.join(','));
  const doneBefore = await page.evaluate(() => window.__LMS_APP.result.kpi.이수자);
  await page.evaluate(() => { const tr = document.querySelector('#content tbody tr'); [...tr.querySelectorAll('button')].find(b => b.textContent === '승인').click(); });
  await page.waitForFunction(() => window.__LMS_APP.result.kpi.보류승인 === 1);
  ok('승인 시 통계 즉시 반영', await page.evaluate(() => window.__LMS_APP.result.kpi.이수자) === doneBefore + 1);

  group('D-09 · D-15 · D-16 · D-18 · F-03 · F-07  화면');
  await tab(page, '이수자·미이수자'); await page.waitForTimeout(600);
  const lcols = await page.evaluate(() => [...document.querySelectorAll('#content table th')].map(t => t.textContent.replace(/[▾▴]/g, '').trim()));
  ok('명단에 미이수 사유 열', lcols.indexOf('미이수 사유') >= 0);
  ok('명단에 권장과목 열', lcols.indexOf('남은 선택과목(권장)') >= 0);
  ok('수강기록 없음 필터', await page.evaluate(() => [...document.querySelectorAll('#content select')].some(s => [...s.options].some(o => o.text === '수강기록 없음'))));
  await page.evaluate(() => { const th = [...document.querySelectorAll('#content th')].find(t => t.textContent.replace(/[▾▴]/g, '').trim() === '차수'); th.click(); });
  await page.waitForTimeout(300);
  const order1 = await page.evaluate(() => [...document.querySelectorAll('#content tbody tr')].map(tr => tr.querySelectorAll('td')[9].textContent.trim()));
  await page.evaluate(() => { const th = [...document.querySelectorAll('#content th')].find(t => t.textContent.replace(/[▾▴]/g, '').trim() === '차수'); th.click(); });
  await page.waitForTimeout(300);
  const order2 = await page.evaluate(() => [...document.querySelectorAll('#content tbody tr')].map(tr => tr.querySelectorAll('td')[9].textContent.trim()));
  const emptyLast = a => { const i = a.indexOf('-'); return i < 0 || a.slice(i).every(x => x === '-'); };
  ok('차수 정렬 시 빈값은 양방향 모두 뒤로', emptyLast(order1) && emptyLast(order2), order1.join(',') + ' / ' + order2.join(','));

  await tab(page, '개인 조회'); await page.waitForTimeout(300);
  await page.evaluate(() => { const i = document.querySelector('#content input[type=text]'); i.value = 'V1'; [...document.querySelectorAll('#content .btn')].find(b => b.textContent === '조회').click(); });
  await page.waitForTimeout(900);
  const hcols = await page.evaluate(() => [...document.querySelectorAll('#content table th')].map(t => t.textContent.replace(/[▾▴]/g, '').trim()));
  ok('수강이력에 연도/차수 열', hcols.indexOf('연도/차수') >= 0, hcols.join(','));
  ok('교육차시는 "차시"로 표기', hcols.indexOf('차시') >= 0 && hcols.indexOf('차수') < 0);

  group('D-11 · D-12 · D-13  설정');
  await tab(page, '설정'); await page.waitForTimeout(400);
  const focusRes = await page.evaluate(async () => {
    const t = [...document.querySelectorAll('#content input[type=number]')][0];
    t.focus(); t.value = '15'; t.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 900));
    return { kept: document.activeElement === t, val: window.__LMS_APP.config.thresholds['생활지원사'] };
  });
  ok('설정 입력 중 포커스 유지', focusRes.kept);
  ok('설정 변경이 재집계에 반영', focusRes.val === 15);
  await tab(page, '요약'); await page.waitForTimeout(400);
  const noteTxt = await page.evaluate(() => document.querySelector('#content .note.info').textContent.replace(/\s+/g, ' '));
  ok('안내문이 설정값을 반영', /생활지원사 15/.test(noteTxt), noteTxt.slice(0, 120));
  await page.evaluate(() => { const c = window.__LMS_APP.config; c.alloc = { '생활지원사': { 배정: 100 } }; c.allocNote = '메모'; c.period = { mode: 'round', from: '1', to: '5' }; });
  await tab(page, '설정'); await page.waitForTimeout(400);
  await page.evaluate(() => { [...document.querySelectorAll('#content .btn')].find(b => b.textContent.includes('기본값으로 초기화')).click(); });
  await page.waitForTimeout(900);
  const afterReset = await page.evaluate(() => window.__LMS_APP.config);
  ok('초기화가 기준값만 되돌림', afterReset.thresholds['생활지원사'] === 13);
  ok('초기화가 배정·메모·산출기간은 보존', !!afterReset.alloc && !!afterReset.allocNote && !!afterReset.period);

  group('D-17  진단 JSON 버전');
  await tab(page, '개인 조회'); await page.waitForTimeout(300);
  await page.evaluate(() => { const i = document.querySelector('#content input[type=text]'); i.value = 'V1'; [...document.querySelectorAll('#content .btn')].find(b => b.textContent === '조회').click(); });
  await page.waitForTimeout(900);
  const dl = page.waitForEvent('download');
  await page.evaluate(() => { [...document.querySelectorAll('#content .btn')].find(b => b.textContent === '진단 데이터 내보내기').click(); });
  const d = await dl;
  const js = JSON.parse(fs.readFileSync(await d.path(), 'utf8'));
  ok('도구버전 ' + VER, js.도구버전 === VER, js.도구버전);

  /* ── F-12 차수별 이수현황표 (ver10) ─────────────────────────────── */
  group('F-12  차수별 이수현황표 — 차수 지정');
  // 단위 검증(unit.js F-12)과 같은 구성: 기대값을 손으로 정해 둔 합성 데이터
  const M12 = [['n1', '생활지원사', '신규자'], ['n2', '생활지원사', '신규자'], ['n3', '생활지원사', '신규자'], ['n4', '생활지원사', '신규자'],
    ['d1', '전담사회복지사', '신규자'], ['d2', '광역전담사회복지사', '신규자'], ['e1', '생활지원사', '경력자'], ['e2', '생활지원사', '경력자'],
    ['e3', '생활지원사', '경력자'], ['f1', '전담사회복지사', '경력자'], ['x1', '중간관리자', '신규자'], ['z1', '생활지원사', '신규자']];
  const mem12 = csv(MH, M12.map((m, i) => [i + 1, '서울', '강남구', '역삼동', 'O1', '기관A', '사람' + m[0], m[0], m[1], '', '', '', '', '', '', 'N', 'Y', m[2], '정상']));
  const NP = '[2026년 신규자 필수] ', KP = '[2026년 경력자 필수] ', SLP = '[2026년 선택] ';
  const pr = (id, ut, name, rd) => ['직무교육(필수)', name, '8', '2026-02-01', '100', '90', '수료', '2026-03-10', '정상', id, '사람' + id, 'O1', '기관A', '서울', '강남구', ut, '', rd === '' ? '' : '2026 / ' + rd];
  const sr = (id, ut, subj) => ['직무교육(선택)', SLP + subj, '3', '2026-02-01', '100', '90', '수료', '2026-03-10', '정상', id, '사람' + id, 'O1', '기관A', '서울', '강남구', ut, '', '2026 / 5'];
  const NA = '노인 상담기법 이해와 활용(내러티브상담)', MO = '노인 상담기법 이해와 활용(동기강화상담)', BO = '노인 신체건강';
  const stu12 = csv(SH, [
    pr('n1', '생활지원사', NP + '생활지원사', 7), pr('n2', '생활지원사', NP + '생활지원사', 7), pr('n3', '생활지원사', NP + '생활지원사', 8), pr('n4', '생활지원사', NP + '생활지원사', 9),
    pr('d1', '전담사회복지사', NP + '전담사회복지사', 9), pr('d2', '광역전담사회복지사', NP + '전담사회복지사', 9),
    pr('e1', '생활지원사', KP + '생활지원사', 15), sr('e1', '생활지원사', NA), sr('e1', '생활지원사', MO), sr('e1', '생활지원사', BO),
    pr('e2', '생활지원사', KP + '생활지원사', 16), sr('e2', '생활지원사', BO),
    pr('e3', '생활지원사', KP + '생활지원사', 7), sr('e3', '생활지원사', NA), sr('e3', '생활지원사', MO), sr('e3', '생활지원사', BO),
    pr('f1', '전담사회복지사', KP + '전담사회복지사', 21), sr('f1', '전담사회복지사', NA), sr('f1', '전담사회복지사', MO),
    pr('x1', '중간관리자', NP + '생활지원사', 7), pr('z1', '생활지원사', NP + '생활지원사', '')
  ]);
  const readRT = () => page.evaluate(() => {
    const c = document.getElementById('roundTableCard'); if (!c) return null;
    return {
      rows: [...c.querySelectorAll('table.rtable tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()).join('|')),
      inputs: [...c.querySelectorAll('input[data-scope]')].map(i => i.dataset.scope + '=' + i.value),
      on: [...c.querySelectorAll('.rchip.on')].map(b => b.dataset.round).join(','),
      notes: [...c.querySelectorAll('.note')].map(n => n.textContent.replace(/\s+/g, ' ')).join(' / ')
    };
  });
  const setSpec = (scope, v) => page.evaluate(([s, v]) => {
    const i = document.querySelector('#roundTableCard input[data-scope="' + s + '"]'); i.value = v;
    [...i.parentNode.querySelectorAll('button')].find(b => b.textContent === '적용').click();
  }, [scope, v]);
  await tab(page, '설정'); await page.waitForTimeout(300);
  await page.evaluate(() => { [...document.querySelectorAll('#content .btn')].find(b => b.textContent === '수강데이터 비우기').click(); });
  await page.waitForTimeout(700);
  await upload(page, 'fileMember', 'm12.csv', mem12); await page.waitForFunction(() => window.__LMS_APP.members && window.__LMS_APP.members.length === 12);
  await upload(page, 'fileStudent', 's12.csv', stu12);
  await page.waitForFunction(() => window.__LMS_APP.result && window.__LMS_APP.studentCount === 21 && window.__LMS_APP.result.kpi.대상자 === 11);
  await tab(page, '요약'); await page.waitForTimeout(400);
  let rt = await readRT();
  ok('요약 탭에 차수별 이수현황표', !!rt);
  ok('기본값 = 이수자가 있는 차수 전부', rt.rows.map(r => r.split('|')[0]).join(',') === '7차,8차,9차,15차,21차,합계', rt.rows.join(' / '));
  ok('기본 합계 행 (신규 생활·전담, 경력 생활·전담, 합계)', rt.rows[rt.rows.length - 1] === '합계|4|2|2|1|9', rt.rows[rt.rows.length - 1]);

  await setSpec('same', '7-9, 15-21'); await page.waitForTimeout(300);
  rt = await readRT();
  ok('"7-9, 15-21" → 10개 차수 + 합계 행', rt.rows.length === 11 && rt.rows[0].startsWith('7차|') && rt.rows[9].startsWith('21차|'), rt.rows.length);
  ok('7차 행 = 신규생활 2 · 경력생활 1', rt.rows[0] === '7차|2|0|1|0|3', rt.rows[0]);
  ok('9차 행 = 광역전담 포함 신규전담 2', rt.rows[2] === '9차|1|2|0|0|3', rt.rows[2]);
  ok('이수자 없는 16차는 0', rt.rows[4] === '16차|0|0|0|0|0', rt.rows[4]);
  ok('입력칸이 정리된 표기로 바뀜', rt.inputs[0] === 'same=7~9, 15~21', rt.inputs[0]);
  ok('번호 버튼에 선택 상태 반영', rt.on === '7,8,9,15,16,17,18,19,20,21', rt.on);
  ok('지정 차수가 설정에 저장', JSON.stringify(await page.evaluate(() => window.__LMS_APP.config.roundTable.same)) === '[7,8,9,15,16,17,18,19,20,21]');
  ok('선택 차시가 부족한 경력자(16차) 안내', /경력자 1명/.test(rt.notes), rt.notes.slice(0, 160));

  await page.evaluate(() => document.querySelector('#roundTableCard .rchip[data-round="16"]').click()); await page.waitForTimeout(250);
  rt = await readRT();
  ok('번호 버튼으로 빼기', rt.rows.length === 10 && !rt.rows.some(r => r.startsWith('16차|')));
  await page.evaluate(() => document.querySelector('#roundTableCard .rchip[data-round="16"]').click()); await page.waitForTimeout(250);
  rt = await readRT();
  ok('번호 버튼으로 다시 넣기', rt.rows.some(r => r.startsWith('16차|')));

  await setSpec('same', 'abc, 7'); await page.waitForTimeout(250);
  rt = await readRT();
  ok('잘못된 입력은 알리고 나머지만 반영', /반영하지 못한 입력: abc/.test(rt.notes) && rt.rows.join(' / ') === '7차|2|0|1|0|3 / 합계|2|0|1|0|3', rt.rows.join(' / '));

  group('F-12  엑셀 다운로드 (이미지와 같은 2단 머리글)');
  await setSpec('same', '7-9, 15-21'); await page.waitForTimeout(250);
  await page.evaluate(() => {
    const o = XLSX.writeFile;
    XLSX.writeFile = function (wb, fn) { const ws = wb.Sheets[wb.SheetNames[0]]; window.__lastX = { fn: fn, aoa: XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }), merges: ws['!merges'] || [] }; return o.apply(XLSX, arguments); };
  });
  const dlRT = page.waitForEvent('download');
  await page.evaluate(() => [...document.querySelectorAll('#roundTableCard .head button')].find(b => b.textContent === '엑셀 다운로드').click());
  await dlRT;
  const X = await page.evaluate(() => window.__lastX);
  ok('파일명', X.fn === '차수별_이수현황표.xlsx', X.fn);
  ok('머리말에 지정 차수 명시', X.aoa[1][0] === '지정 차수: 7~9, 15~21차', X.aoa[1][0]);
  ok('머리글 2단 + 병합 4곳', X.merges.length === 4 && X.aoa[5].join('|') === '차수|신규자||경력자||합계' && X.aoa[6].join('|') === '|생활지원사|전담사회복지사|생활지원사|전담사회복지사|', X.aoa[5].join('|') + ' / ' + X.aoa[6].join('|'));
  const lastRow = X.aoa[X.aoa.length - 1];
  ok('본문 10행 + 합계 행이 숫자로', X.aoa.length === 7 + 11 && lastRow.join('|') === '합계|4|2|2|1|9' && typeof lastRow[5] === 'number', lastRow.join('|'));

  group('F-12  신규자·경력자 차수 따로 지정');
  await page.evaluate(() => { const s = document.querySelector('#roundTableCard select'); s.value = 'split'; s.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(300);
  rt = await readRT();
  ok('입력칸이 신규자·경력자 2개로', rt.inputs.map(x => x.split('=')[0]).join(',') === '신규자,경력자', rt.inputs.join(','));
  ok('기본값 = 각자 이수자가 있는 차수', rt.inputs.join(',') === '신규자=7~9,경력자=7, 15, 21', rt.inputs.join(','));
  await setSpec('신규자', '7-9'); await page.waitForTimeout(250);
  await setSpec('경력자', '15~'); await page.waitForTimeout(250);
  rt = await readRT();
  ok('열린 범위 "15~" → 최신 21차까지', rt.inputs[1] === '경력자=15~21', rt.inputs[1]);
  ok('7차 행: 경력자 칸은 해당 없음(-)', rt.rows[0] === '7차|2|0|-|-|2', rt.rows[0]);
  ok('15차 행: 신규자 칸은 해당 없음(-)', rt.rows[3] === '15차|-|-|1|0|1', rt.rows[3]);
  ok('합계에서 경력자 7차 이수자 제외', rt.rows[rt.rows.length - 1] === '합계|4|2|1|1|8', rt.rows[rt.rows.length - 1]);

  group('F-12  저장·일관성·인쇄');
  await page.reload();
  await page.waitForFunction(() => window.__LMS_APP && window.__LMS_APP.members && window.__LMS_APP.members.length === 12);
  await upload(page, 'fileStudent', 's12.csv', stu12);
  await page.waitForFunction(() => window.__LMS_APP.result && window.__LMS_APP.studentCount === 21);
  await tab(page, '요약'); await page.waitForTimeout(400);
  rt = await readRT();
  ok('새로고침 후에도 지정 방식·차수 유지', rt.inputs.join(',') === '신규자=7~9,경력자=15~21' && rt.rows[rt.rows.length - 1] === '합계|4|2|1|1|8', rt.inputs.join(','));
  const cross = await page.evaluate(async () => {
    const A = window.__LMS_APP; A.config.period = { mode: 'round', from: '7', to: '9' };
    [...document.querySelectorAll('.tab')].find(b => b.textContent.includes('요약')).click();
    await new Promise(r => setTimeout(r, 300));
    const card = [...document.querySelectorAll('#content .card')].find(c => c.querySelector('h2') && c.querySelector('h2').textContent === '이수율 현황표');
    const trs = [...card.querySelectorAll('tbody tr')], num = td => +td.textContent.replace(/,/g, '');
    const t = LMS.roundTable(A.result.byRound, [7, 8, 9]).total;
    return {
      현황표: [num(trs[0].children[1]), num(trs[0].children[2]), num(trs[1].children[1]), num(trs[1].children[2])],
      차수표: [t['신규자|전담사회복지사'], t['경력자|전담사회복지사'], t['신규자|생활지원사'], t['경력자|생활지원사']]
    };
  });
  ok('이수율 현황표(산출기간 7~9차)와 같은 숫자', cross.현황표.join() === cross.차수표.join(), JSON.stringify(cross));
  await page.emulateMedia({ media: 'print' });
  const pv = await page.evaluate(() => {
    const c = document.getElementById('roundTableCard'), vis = e => !!e && getComputedStyle(e).display !== 'none';
    return { 번호: vis(c.querySelector('.rchips')), 입력: vis(c.querySelector('.rspec')), 표: vis(c.querySelector('table.rtable')), 지정차수: vis(c.querySelector('.note.info')) };
  });
  await page.emulateMedia({ media: 'screen' });
  ok('인쇄 시 입력·번호는 숨기고 표·지정 차수는 출력', !pv.번호 && !pv.입력 && pv.표 && pv.지정차수, JSON.stringify(pv));
  await tab(page, '설정'); await page.waitForTimeout(300);
  await page.evaluate(() => { [...document.querySelectorAll('#content .btn')].find(b => b.textContent.includes('기본값으로 초기화')).click(); });
  await page.waitForTimeout(900);
  const rtCfg = await page.evaluate(() => window.__LMS_APP.config.roundTable);
  ok('이수 기준 초기화해도 지정 차수 보존', !!rtCfg && rtCfg.mode === 'split' && (rtCfg.경력자 || []).join(',') === '15,16,17,18,19,20,21', JSON.stringify(rtCfg));

  group('D-15  원데이터 HTML 주입 방어');
  const memX = csv(MH, [[1, '서울', '강남구', '동', 'O1', '<img src=x onerror="window.__X1=1">', '<img src=x onerror="window.__X2=1">', 'W1', '생활지원사', '', '', '', '', '', '', 'N', 'Y', '신규자', '정상']]);
  const stuX = csv(SH, [['직무교육(필수)', '[2026년 신규자 필수] 생활지원사', '8', '2026-02-01', '100', '90', '수료', '2026-03-10', '정상', 'W1', '<img src=x onerror="window.__X2=1">', 'O1', '<img src=x onerror="window.__X1=1">', '서울', '강남구', '<b onmouseover="window.__X3=1">전담사회복지사</b>', '', '2026 / 3']]);
  await tab(page, '설정'); await page.waitForTimeout(300);
  await page.evaluate(() => { [...document.querySelectorAll('#content .btn')].find(b => b.textContent === '수강데이터 비우기').click(); });
  await page.waitForTimeout(700);
  await upload(page, 'fileMember', 'mx.csv', memX); await page.waitForFunction(() => window.__LMS_APP.members.length === 1);
  await upload(page, 'fileStudent', 'sx.csv', stuX); await page.waitForFunction(() => window.__LMS_APP.result && window.__LMS_APP.studentCount === 1);
  for (const t of ['요약', '데이터 점검', '이수자·미이수자', '보류', '중복자', '과목별', '데이터 현황']) { await tab(page, t); await page.waitForTimeout(250); }
  await tab(page, '개인 조회'); await page.waitForTimeout(250);
  await page.evaluate(() => { const i = document.querySelector('#content input[type=text]'); i.value = 'W1'; [...document.querySelectorAll('#content .btn')].find(b => b.textContent === '조회').click(); });
  await page.waitForTimeout(900);
  const xss = await page.evaluate(() => ({ fired: !!window.__X1 || !!window.__X2 || !!window.__X3, imgs: document.querySelectorAll('#content img').length }));
  ok('데이터 속 태그가 실행되지 않음', !xss.fired && xss.imgs === 0);

  group('전 탭 렌더 · 콘솔 오류');
  for (const t of ['요약', '데이터 점검', '데이터 현황', '이수율 현황', '이수자·미이수자', '미응시', '보류', '중복자', '과목별', '개인 조회', '설정']) {
    await tab(page, t); await page.waitForTimeout(200);
    const n = await page.evaluate(() => document.querySelectorAll('#content .card').length);
    ok('[' + t + '] 렌더', n > 0);
  }
  ok('콘솔 오류 0건', errors.length === 0, errors.slice(0, 3).join(' / '));

  await browser.close();
  console.log('');
  console.log('─'.repeat(58));
  console.log(' 통과 ' + pass + '건 / 실패 ' + fail + '건');
  console.log('─'.repeat(58));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실행 실패:', e); process.exit(1); });
