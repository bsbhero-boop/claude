const { chromium } = require('playwright');
const path = require('path');
const UP = '/root/.claude/uploads/cd57ac93-8f4d-5823-bb34-c33379307f24/';
const HTML = 'file://' + path.resolve(__dirname, '..', 'lms-statistics-v4.html');
const MEMBER = UP + 'd7a572fb-____.xlsx';
const S1 = UP + '4ecf5ad8-__________20260626.____2.xls';
const ALL = ['4ecf5ad8-__________20260626.____2.xls', '186cd960-__________20260626.____3.xls', '835ae5a9-__________20260626.____4.xls'].map(f => UP + f);

function newCtx() { return chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }); }
function wire(page, errs) {
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE:' + m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR:' + e.message));
  page.on('dialog', d => { errs.push('DIALOG:' + d.message().slice(0, 60)); d.accept(); });
}

(async () => {
  let pass = true;

  // ---- CASE 1: 수강생 먼저, 그 다음 회원정보 (업로드 순서 반대) ----
  {
    const b = await newCtx(); const p = await b.newPage(); const errs = [];
    wire(p, errs);
    await p.goto(HTML); await p.waitForFunction(() => typeof XLSX !== 'undefined', null, { timeout: 15000 });
    // 수강생 먼저 (3개 파일 모두 로드 완료까지 대기)
    await p.setInputFiles('#fileStudent', ALL);
    await p.waitForFunction(() => window.__LMS_APP && window.__LMS_APP.studentFiles.length === 3, null, { timeout: 120000 });
    const r1 = await p.evaluate(() => window.__LMS_APP.result); // 회원정보 없으니 null이어야
    const empty = await p.$eval('#content', n => n.textContent.includes('통계가 자동으로 계산')).catch(() => false);
    console.log('CASE1 수강생 먼저: result=', r1, '| 안내문구표시=', empty, (r1 === null && empty) ? '✅' : '❌');
    if (!(r1 === null && empty)) pass = false;
    // 이제 회원정보
    await p.setInputFiles('#fileMember', MEMBER);
    await p.waitForFunction(() => window.__LMS_APP && window.__LMS_APP.result, null, { timeout: 60000 });
    const k = await p.evaluate(() => window.__LMS_APP.result.kpi);
    const ok = k.대상자 === 36424 && k.이수자 === 16374;
    console.log('CASE1 회원정보 추가 후: 대상자', k.대상자, '이수자', k.이수자, ok ? '✅' : '❌', '| dialog/err:', errs.length);
    if (!ok || errs.length) { pass = false; console.log('  errs:', errs.slice(0, 3)); }
    await b.close();
  }

  // ---- CASE 2: 같은 수강생 파일 2번 드롭 → KPI 동일 (중복 방지) ----
  {
    const b = await newCtx(); const p = await b.newPage(); const errs = []; wire(p, errs);
    await p.goto(HTML); await p.waitForFunction(() => typeof XLSX !== 'undefined', null, { timeout: 15000 });
    await p.setInputFiles('#fileMember', MEMBER);
    await p.waitForFunction(() => window.__LMS_APP && window.__LMS_APP.members, null, { timeout: 60000 });
    await p.setInputFiles('#fileStudent', S1);
    await p.waitForFunction(() => window.__LMS_APP && window.__LMS_APP.result, null, { timeout: 60000 });
    const a = await p.evaluate(() => ({ rows: window.__LMS_APP.students.length, files: window.__LMS_APP.studentFiles.length, kpi: window.__LMS_APP.result.kpi }));
    // 같은 파일 다시 드롭 → 완전동일 행이라 자동 제거되어 행수/통계 그대로여야
    await p.setInputFiles('#fileStudent', S1);
    await p.waitForFunction((f) => window.__LMS_APP.studentFiles.length > f, a.files, { timeout: 60000 });
    await p.waitForTimeout(400);
    const c = await p.evaluate(() => ({ rows: window.__LMS_APP.students.length, dup: window.__LMS_APP.dupRemoved, kpi: window.__LMS_APP.result.kpi }));
    const rowsSame = a.rows === c.rows;
    const sameKpi = a.kpi.이수자 === c.kpi.이수자 && a.kpi.중복수료건수 === c.kpi.중복수료건수 && a.kpi.대상자 === c.kpi.대상자;
    console.log('CASE2 같은파일 재업로드: 행수', a.rows, '→', c.rows, rowsSame ? '(동일=중복제거됨)' : '⚠️증가', '| 이수자', a.kpi.이수자, '→', c.kpi.이수자, '| 중복이수', a.kpi.중복수료건수, '→', c.kpi.중복수료건수, (sameKpi && rowsSame) ? '✅' : '❌');
    if (!sameKpi || !rowsSame || errs.length) { pass = false; console.log('  errs:', errs.slice(0, 3)); }
    await b.close();
  }

  // ---- CASE 3: 잘못된 파일(회원칸에 수강생 파일) → 경고 + 미충돌 ----
  {
    const b = await newCtx(); const p = await b.newPage(); const errs = []; wire(p, errs);
    await p.goto(HTML); await p.waitForFunction(() => typeof XLSX !== 'undefined', null, { timeout: 15000 });
    await p.setInputFiles('#fileMember', S1); // 일부러 수강생 파일을 회원칸에
    await p.waitForTimeout(8000);
    const warned = errs.some(e => e.startsWith('DIALOG:') && e.includes('회원정보가 아닌'));
    const crashed = errs.some(e => e.startsWith('PAGEERROR:'));
    console.log('CASE3 잘못된 회원파일: 경고표시=', warned, '| 페이지오류=', crashed, (warned && !crashed) ? '✅' : '❌');
    if (!warned || crashed) pass = false;
    await b.close();
  }

  // ---- CASE 4: 모든 탭 클릭 + 정렬 + 필터 무오류 ----
  {
    const b = await newCtx(); const p = await b.newPage(); const errs = []; wire(p, errs);
    await p.goto(HTML); await p.waitForFunction(() => typeof XLSX !== 'undefined', null, { timeout: 15000 });
    await p.setInputFiles('#fileMember', MEMBER);
    await p.waitForFunction(() => window.__LMS_APP && window.__LMS_APP.members, null, { timeout: 60000 });
    await p.setInputFiles('#fileStudent', ALL);
    await p.waitForFunction(() => window.__LMS_APP && window.__LMS_APP.result, null, { timeout: 180000 });
    for (const t of ['요약', '이수율 현황', '이수자·미이수자 명단', '미응시·재응시', '보류·직군변경', '중복자 확인', '과목별 현황', '개인 조회', '설정·도움말']) {
      await p.click(`button.tab:has-text("${t}")`); await p.waitForTimeout(100);
    }
    // 미이수자: 필터 + 정렬 + 검색
    await p.click('button.tab:has-text("이수자·미이수자 명단")'); await p.waitForTimeout(150);
    await p.selectOption('#content select >> nth=0', { index: 1 }).catch(() => {});
    await p.waitForTimeout(120);
    await p.fill('#content input[type=text]', '김'); await p.waitForTimeout(150);
    await p.click('#content thead th >> nth=1').catch(() => {}); await p.waitForTimeout(120);
    // 설정에서 차시 변경 → 재집계
    await p.click('button.tab:has-text("설정")'); await p.waitForTimeout(150);
    const before = await p.evaluate(() => window.__LMS_APP.result.kpi.이수자);
    await p.fill('#content input[type=number] >> nth=0', '99'); // 생활지원사 기준 13→99 (이수 어려워짐)
    await p.dispatchEvent('#content input[type=number] >> nth=0', 'change'); await p.waitForTimeout(300);
    const after = await p.evaluate(() => window.__LMS_APP.result.kpi.이수자);
    console.log('CASE4 설정변경(생활 13→99차시): 이수자', before, '→', after, after < before ? '✅ 재집계 반영' : '⚠️');
    console.log('CASE4 탭/정렬/필터/검색/설정 오류수:', errs.length, errs.length === 0 ? '✅' : '❌');
    if (errs.length || !(after < before)) { pass = false; console.log('  errs:', errs.slice(0, 4)); }
    await b.close();
  }

  console.log('\n=== EDGE RESULT:', pass ? 'ALL PASS ✅' : 'CHECK ⚠️', '===');
})().catch(e => { console.error('EDGE FAIL', e); process.exit(1); });
