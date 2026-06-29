const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const XLSX = require('./node_modules/xlsx');
const HTML = 'file://' + path.resolve(__dirname, '..', 'lms-statistics.html');
const SCR = path.join(require('os').tmpdir(), 'lms-pending-test');
fs.mkdirSync(SCR, { recursive: true });

// 합성 테스트 파일 생성 (T1·T3 = 전직 의심, T2 = 정상)
(function genFiles() {
  const M = [['No', '시도', '시군구', '기관코드', '기관명', '성명', 'ID', '사용자유형', '교육대상여부', '교육구분', '상태'],
    [1, '서울', '강남구', 'X1', '테스트기관', '전직신규', 'T1', '전담사회복지사', 'Y', '신규자', '정상'],
    [2, '서울', '강남구', 'X1', '테스트기관', '정상생활', 'T2', '생활지원사', 'Y', '신규자', '정상'],
    [3, '서울', '강남구', 'X1', '테스트기관', '전직경력', 'T3', '전담사회복지사', 'Y', '경력자', '정상']];
  const wbM = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbM, XLSX.utils.aoa_to_sheet(M), 'Sheet1'); XLSX.writeFile(wbM, SCR + '/member_syn.xlsx');
  const S = [['통합수강생목록_(합성)'], [],
    ['No', '카테고리', '과정명', '교육차시', '교육신청일', '시도', '시군구', '기관코드', '기관명', '성명', 'ID', '사용자유형', '진도율', '점수', '수료여부', '수료일', '상태'],
    [1, '직무교육(필수)', '[2026년 신규자 필수] 생활지원사', '01', '2026-01-01', '서울', '강남구', 'X1', '테스트기관', '전직신규', 'T1', '생활지원사', '100', '100', '수료', '2026-02-01', '정상'],
    [2, '직무교육(필수)', '[2026년 신규자 필수] 생활지원사', '01', '2026-01-01', '서울', '강남구', 'X1', '테스트기관', '정상생활', 'T2', '생활지원사', '100', '100', '수료', '2026-02-01', '정상'],
    [3, '직무교육(필수)', '[2026년 경력자 필수] 생활지원사', '01', '2026-01-01', '서울', '강남구', 'X1', '테스트기관', '전직경력', 'T3', '생활지원사', '100', '100', '수료', '2026-02-01', '정상'],
    [4, '직무교육(선택)', '[2026년 선택] 치매예방', '01', '2026-01-01', '서울', '강남구', 'X1', '테스트기관', '전직경력', 'T3', '생활지원사', '100', '100', '수료', '2026-02-01', '정상']];
  const wbS = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbS, XLSX.utils.aoa_to_sheet(S), 'Sheet1'); XLSX.writeFile(wbS, SCR + '/student_syn.xlsx');
})();

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage(); const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGEERR:' + e.message));
  await p.goto(HTML); await p.waitForFunction(() => typeof XLSX !== 'undefined', null, { timeout: 15000 });
  await p.setInputFiles('#fileMember', SCR + '/member_syn.xlsx');
  await p.waitForFunction(() => window.__LMS_APP && window.__LMS_APP.members, null, { timeout: 30000 });
  await p.setInputFiles('#fileStudent', SCR + '/student_syn.xlsx');
  await p.waitForFunction(() => window.__LMS_APP && window.__LMS_APP.result, null, { timeout: 30000 });

  let ok = true;
  const k0 = await p.evaluate(() => window.__LMS_APP.result.kpi);
  console.log('초기: 대상자', k0.대상자, '이수자', k0.이수자, '보류미검토', k0.보류미검토);
  if (!(k0.대상자 === 3 && k0.이수자 === 1 && k0.보류미검토 === 2)) { ok = false; console.log('❌ 초기 KPI 불일치'); }

  // 보류 탭으로 이동
  await p.click('button.tab:has-text("보류·직군변경")'); await p.waitForTimeout(200);
  const candRows = await p.$$eval('#content table tbody tr', r => r.length);
  console.log('보류 탭 표시 건수:', candRows, candRows === 2 ? '✅' : '❌');
  if (candRows !== 2) ok = false;

  // T1 행에서 '승인' 클릭 (T1 텍스트가 있는 행의 승인 버튼)
  await p.click('#content table tbody tr:has-text("T1") button:has-text("승인")');
  await p.waitForTimeout(300);
  const k1 = await p.evaluate(() => window.__LMS_APP.result.kpi);
  console.log('T1 승인 후: 이수자', k1.이수자, '보류미검토', k1.보류미검토, '보류승인', k1.보류승인);
  if (!(k1.이수자 === 2 && k1.보류미검토 === 1 && k1.보류승인 === 1)) { ok = false; console.log('❌ 승인 후 KPI 불일치'); }

  // 새로고침 후 결정이 유지되는지 (IndexedDB 영구저장) — 같은 컨텍스트라 IDB 유지
  await p.reload(); await p.waitForTimeout(800);
  const dec = await p.evaluate(() => window.__LMS_APP.decisions);
  console.log('새로고침 후 저장된 결정:', JSON.stringify(dec), dec && dec.T1 === 'approve' ? '✅ 유지' : '❌ 유실');
  if (!(dec && dec.T1 === 'approve')) ok = false;

  // T1 반려로 변경 → 이수자 원복
  await p.setInputFiles('#fileMember', SCR + '/member_syn.xlsx');
  await p.waitForFunction(() => window.__LMS_APP && window.__LMS_APP.members, null, { timeout: 30000 });
  await p.setInputFiles('#fileStudent', SCR + '/student_syn.xlsx');
  await p.waitForFunction(() => window.__LMS_APP && window.__LMS_APP.result, null, { timeout: 30000 });
  await p.click('button.tab:has-text("보류·직군변경")'); await p.waitForTimeout(200);
  await p.click('#content table tbody tr:has-text("T1") button:has-text("반려")');
  await p.waitForTimeout(300);
  const k2 = await p.evaluate(() => window.__LMS_APP.result.kpi);
  console.log('T1 반려 후: 이수자', k2.이수자, '보류미검토', k2.보류미검토, k2.이수자 === 1 ? '✅' : '❌');
  if (k2.이수자 !== 1) ok = false;

  console.log('\nconsole errors:', errs.length, errs.slice(0, 3));
  console.log('PENDING-UI RESULT:', (ok && errs.length === 0) ? 'PASS ✅' : 'CHECK ⚠️');
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
