const { chromium } = require('playwright');
const path = require('path');
const UP = '/root/.claude/uploads/cd57ac93-8f4d-5823-bb34-c33379307f24/';
const HTML = 'file://' + path.resolve(__dirname, '..', 'lms-statistics-v4.html');
const MEMBER = UP + 'd7a572fb-____.xlsx';
const STUDENTS = ['4ecf5ad8-__________20260626.____2.xls', '186cd960-__________20260626.____3.xls', '835ae5a9-__________20260626.____4.xls'].map(f => UP + f);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(HTML);
  await page.waitForTimeout(800);
  console.log('XLSX loaded:', await page.evaluate(() => typeof XLSX));
  console.log('LMS loaded:', await page.evaluate(() => typeof LMS));

  // 회원정보 업로드
  let t = Date.now();
  await page.setInputFiles('#fileMember', MEMBER);
  await page.waitForFunction(() => window.__LMS_APP && window.__LMS_APP.members, null, { timeout: 120000 });
  console.log('member loaded:', await page.evaluate(() => window.__LMS_APP.members.length), 'in', Date.now() - t, 'ms');

  // 수강생목록 업로드
  t = Date.now();
  await page.setInputFiles('#fileStudent', STUDENTS);
  await page.waitForFunction(() => window.__LMS_APP && window.__LMS_APP.result, null, { timeout: 180000 });
  console.log('students+analyze in', Date.now() - t, 'ms');

  const kpi = await page.evaluate(() => window.__LMS_APP.result.kpi);
  console.log('\n=== KPI (browser) ===');
  console.log(JSON.stringify(kpi, null, 2));

  // 검증 (16개 시도 필터 적용 후)
  const expect = { 대상자: 36424, 이수자: 16374, 기준미정의대상: 659, 지역외제외: 351 };
  let ok = true;
  for (const k in expect) { if (kpi[k] !== expect[k]) { ok = false; console.log('MISMATCH', k, 'got', kpi[k], 'want', expect[k]); } }
  console.log('이수율:', kpi.이수율.toFixed(4) + '% (기대 44.9539%)');
  // 시도별에 16개 외(미상/중앙)가 없는지 확인
  const sidoKeys = await page.evaluate(() => window.__LMS_APP.result.bySido.map(r => r.key));
  const SIDO16 = ['서울','경기','인천','부산','대전','대구','울산','광주','강원','경남','경북','전남','전북','충남','충북','제주'];
  const badSido = sidoKeys.filter(k => !SIDO16.includes(k));
  console.log('시도별 키:', sidoKeys.length, '개 | 16개 외 잔존:', badSido.length, badSido.length === 0 ? '✅' : ('❌ ' + JSON.stringify(badSido)));
  if (badSido.length) ok = false;

  // 탭 클릭 점검
  // 데이터 현황(연도/차수) 검증
  const cov = await page.evaluate(() => window.__LMS_APP.coverage && window.__LMS_APP.coverage.summary);
  console.log('데이터 현황: 연도', cov && cov.연도, '최신차수', cov && cov.최신차수, '신청일', (cov && cov.최초신청일) + '~' + (cov && cov.최근신청일),
    (cov && cov.최신차수 === 14 && cov.연도.join() === '2026' && cov.최근신청일 === '2026-06-26') ? '✅' : '❌');
  if (!(cov && cov.최신차수 === 14 && cov.연도.join() === '2026' && cov.최근신청일 === '2026-06-26')) ok = false;

  // v3: 재응시(이수자 제외), 중복자, 이수율 현황표 검증
  const v3 = await page.evaluate(() => {
    const R = window.__LMS_APP.result;
    const exam = R.examNoShowRows;
    return {
      재응시필요: R.kpi.재응시필요인원,
      이수자중재응시: exam.filter(e => e.전체이수 && e.재응시필요).length, // 0이어야
      차수있음: exam.filter(e => e.차수 != null).length,
      중복건수: R.kpi.중복수료건수, 중복인원: R.kpi.중복수료인원, 중복필수: R.kpi.중복수료필수,
      dupRows: R.duplicateRows.length,
      dupBad: R.duplicateRows.filter(d => d.수료횟수 < 2).length // 0이어야 (모두 2회+)
    };
  });
  console.log('재응시필요(이수자 제외):', v3.재응시필요, '| 이수자인데 재응시필요:', v3.이수자중재응시, v3.이수자중재응시 === 0 ? '✅' : '❌',
    '| 차수부여:', v3.차수있음 > 0 ? '✅' : '❌');
  console.log('중복이수: 건수', v3.중복건수, '인원', v3.중복인원, '필수', v3.중복필수, (v3.중복건수 > 0 && v3.dupRows === v3.중복건수 && v3.dupBad === 0) ? '✅' : '❌');
  if (v3.이수자중재응시 !== 0 || !(v3.차수있음 > 0) || !(v3.중복건수 > 0) || v3.dupBad !== 0) ok = false;

  for (const label of ['데이터 현황', '이수율 현황', '미이수자 명단', '미응시·재응시', '보류·직군변경', '중복자 확인', '과목별 현황', '개인 조회', '설정·도움말', '요약']) {
    await page.click(`button.tab:has-text("${label}")`);
    await page.waitForTimeout(120);
    const cells = await page.$$eval('#content table tbody tr', rs => rs.length).catch(() => 0);
    console.log(`tab [${label}] rendered, table rows on screen: ${cells}`);
  }

  // 미응시·재응시 탭에서 '재응시 필요만' 필터 + 행 수 확인
  await page.click('button.tab:has-text("미응시·재응시")');
  await page.waitForTimeout(150);
  const noexamTotal = await page.$eval('#content .pager span', s => s.textContent).catch(() => '?');
  console.log('미응시 탭 총건수 표기:', noexamTotal);

  // 이수율 현황 트리 펼치기/접기 확인
  await page.click('button.tab:has-text("이수율 현황")');
  await page.waitForTimeout(150);
  const before = await page.$$eval('#content table.tree tbody tr', r => r.length);
  await page.click('#content table.tree tbody tr.foldhead'); // 첫 시도 펼치기
  await page.waitForTimeout(120);
  const afterOpen = await page.$$eval('#content table.tree tbody tr', r => r.length);
  await page.click('#content table.tree tbody tr.foldhead'); // 접기
  await page.waitForTimeout(120);
  const afterClose = await page.$$eval('#content table.tree tbody tr', r => r.length);
  console.log(`트리 펼치기/접기: 시도 ${before}행 → 펼침 ${afterOpen}행 → 접음 ${afterClose}행`, (afterOpen > before && afterClose === before) ? '✅' : '⚠️');

  // 개인 조회 동작 확인 (알려진 ID)
  await page.click('button.tab:has-text("개인 조회")');
  await page.waitForTimeout(120);
  await page.fill('#content input[type=text]', 'k80love');
  await page.click('#content button.btn');
  await page.waitForTimeout(200);
  const personOK = await page.$eval('#content', n => n.textContent.includes('수강 이력')).catch(() => false);
  console.log('개인조회(k80love) 이력표시:', personOK);

  // 진단 데이터 내보내기 검증 (원인 파악용 공유 파일)
  const fs = require('fs'); const os = require('os');
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#content button:has-text("진단 데이터 내보내기")')
  ]);
  const dp = path.join(os.tmpdir(), dl.suggestedFilename()); await dl.saveAs(dp);
  const diag = JSON.parse(fs.readFileSync(dp, 'utf8'));
  const diagOK = !!(diag.판정결과 && diag.회원정보 && Array.isArray(diag.수강이력) && diag.적용규칙);
  console.log('진단 내보내기:', dl.suggestedFilename(), '| 구조', diagOK ? '✅' : '❌', '| 이력', diag.수강이력.length + '건', '| 사유:', diag.판정결과.미이수사유 || '(이수)');
  if (!diagOK) ok = false;
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#content button:has-text("진단(개인정보 가림)")')
  ]);
  const dp2 = path.join(os.tmpdir(), dl2.suggestedFilename()); await dl2.saveAs(dp2);
  const diag2 = JSON.parse(fs.readFileSync(dp2, 'utf8'));
  const masked = diag2.회원정보.ID === 'MASKED-ID' && diag2.회원정보.성명 === '***' && !!diag2.판정결과.직군_정규화;
  console.log('진단 마스킹:', masked ? '✅ 이름·ID·기관 가림, 판정정보 유지' : '❌');
  if (!masked) ok = false;

  // 요약 탭 이수율 현황표: 전담 배정인원 입력 → A/B 계산 + 저장 확인
  await page.click('button.tab:has-text("요약")'); await page.waitForTimeout(150);
  // 첫 번째 number input = 전담 배정인원
  await page.fill('#content input[type=number] >> nth=0', '2716');
  await page.dispatchEvent('#content input[type=number] >> nth=0', 'change'); await page.waitForTimeout(200);
  const alloc = await page.evaluate(() => window.__LMS_APP.config.alloc && window.__LMS_APP.config.alloc['전담사회복지사']);
  const tableTxt = await page.$eval('#content', n => n.textContent);
  const hasRatio = /이수인원/.test(tableTxt) && tableTxt.includes('A/B');
  console.log('이수율 현황표: 배정입력 저장=', JSON.stringify(alloc), '| 표 구조=', hasRatio ? '✅' : '❌');
  if (!(alloc && alloc.배정 === 2716) || !hasRatio) ok = false;

  console.log('\nconsole errors:', errors.length, errors.slice(0, 5));
  console.log('\nRESULT:', ok && errors.length === 0 ? 'PASS ✅' : 'CHECK ⚠️');
  await browser.close();
})().catch(e => { console.error('E2E FAIL:', e); process.exit(1); });
