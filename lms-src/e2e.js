const { chromium } = require('playwright');
const path = require('path');
const UP = '/root/.claude/uploads/cd57ac93-8f4d-5823-bb34-c33379307f24/';
const HTML = 'file://' + path.resolve(__dirname, '..', 'lms-statistics-v8.html');
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
  // blob: 다운로드는 Playwright에서 suggestedFilename을 못 읽으므로(헤드리스 환경 한계),
  // 앱이 XLSX.writeFile에 실제로 넘기는 파일명을 가로채 검증한다.
  await page.evaluate(() => {
    window.__writeFileCalls = [];
    const orig = XLSX.writeFile;
    XLSX.writeFile = function (wb, filename) { window.__writeFileCalls.push(filename); return orig.apply(XLSX, arguments); };
  });

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

  // v8: 과정 유형/구분(원과정·재응시) 분리 + 중복유형(재수강 다차수/동일차수) 검증
  const v8 = await page.evaluate(() => {
    const R = window.__LMS_APP.result;
    const cr = R.courseRows;
    const retake = cr.filter(r => r.구분 === '재응시');
    return {
      courseTotal: cr.length,
      retakeCnt: retake.length,
      retakeAllHaveBase: retake.every(r => r.원과정 && !/_재응시$/.test(r.원과정)),
      typesOk: cr.every(r => ['필수·신규', '필수·경력', '선택', '기타'].includes(r.유형)),
      origNoSuffix: cr.filter(r => r.구분 === '원과정').every(r => !/_재응시$|_열람전용$/.test(r.과정명)),
      dupSame: R.kpi.중복동일차수,
      dupSameRows: R.duplicateRows.filter(d => d.중복유형 === '동일차수 중복').length,
      dupMulti: R.duplicateRows.filter(d => d.중복유형 === '재수강(다차수)').length
    };
  });
  console.log('과정 분류: 전체', v8.courseTotal, '| 재응시', v8.retakeCnt, '| 재응시 원과정명 보유:', v8.retakeAllHaveBase ? '✅' : '❌',
    '| 유형값 유효:', v8.typesOk ? '✅' : '❌', '| 원과정에 접미사 없음:', v8.origNoSuffix ? '✅' : '❌');
  console.log('중복유형: 동일차수', v8.dupSame, '| 재수강(다차수)', v8.dupMulti, '| 합계=중복건수:',
    (v8.dupSame === v8.dupSameRows && v8.dupSame + v8.dupMulti === v3.중복건수) ? '✅' : '❌');
  if (!v8.retakeAllHaveBase || !v8.typesOk || !v8.origNoSuffix || v8.retakeCnt === 0 || v8.dupSame !== v8.dupSameRows || v8.dupSame + v8.dupMulti !== v3.중복건수) ok = false;
  // 과목별 현황 탭: 구분=재응시 필터 → 재응시 과정 수와 일치
  await page.click('button.tab:has-text("과목별 현황")'); await page.waitForTimeout(200);
  await page.selectOption('#content select >> nth=1', { label: '재응시' }); await page.waitForTimeout(250);
  const cTotal = await page.$eval('#content .pager span', s => s.textContent).catch(() => '');
  console.log('과목별 구분=재응시 필터 건수:', cTotal, '(기대 총 ' + v8.retakeCnt + '건)', cTotal.includes(String(v8.retakeCnt)) ? '✅' : '❌');
  if (!cTotal.includes(String(v8.retakeCnt))) ok = false;

  for (const label of ['데이터 현황', '이수율 현황', '이수자·미이수자 명단', '미응시·재응시', '보류·직군변경', '중복자 확인', '과목별 현황', '개인 조회', '설정·도움말', '요약']) {
    await page.click(`button.tab:has-text("${label}")`);
    await page.waitForTimeout(120);
    const cells = await page.$$eval('#content table tbody tr', rs => rs.length).catch(() => 0);
    console.log(`tab [${label}] rendered, table rows on screen: ${cells}`);
  }

  // 이수자·미이수자 명단: 이수자만 필터 → 엑셀 다운로드 → 컬럼(연번·시도·시군구·기관코드·수행기관·ID·성명·직급·경력·차수·이수일자·이수여부) 검증
  await page.click('button.tab:has-text("이수자·미이수자 명단")'); await page.waitForTimeout(150);
  const rosterCols = await page.$$eval('#content thead th', ths => ths.map(t => t.textContent.trim()));
  const needOrdered = ['연번', '시도', '시군구', '기관코드', '수행기관', 'ID', '성명', '직급', '경력', '차수', '이수일자', '이수여부'];
  const colsNoArrow = rosterCols.map(c => c.replace(/\s*[▴▾]$/, ''));
  const orderMatches = JSON.stringify(colsNoArrow) === JSON.stringify(needOrdered);
  console.log('종사자 명단 컬럼:', JSON.stringify(rosterCols), '| 요청 순서와 일치:', orderMatches ? '✅' : '❌');
  if (!orderMatches) ok = false;
  // 이수자만으로 전환
  await page.selectOption('#content select >> nth=0', { label: '이수자만' });
  await page.waitForTimeout(200);
  const rosterCount = await page.$eval('#content .pager span', s => s.textContent).catch(() => '');
  console.log('이수자만 필터 적용 후 표시 건수:', rosterCount);
  const [dlRoster] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#content .head button.btn.sec')
  ]);
  const rosterPath = path.join(require('os').tmpdir(), 'roster.xlsx');
  await dlRoster.saveAs(rosterPath);
  const actualFilename = await page.evaluate(() => window.__writeFileCalls[window.__writeFileCalls.length - 1]);
  console.log('이수자 명단 다운로드 파일명(앱이 실제로 지정한 이름):', actualFilename);
  const rosterIsCompleters = /이수자명단/.test(actualFilename || '');
  if (!rosterIsCompleters) ok = false;
  // 실제 엑셀 내용 검증(재파싱): 헤더 순서 + 연번 1..N 연속 + 전원 이수여부=이수 + 기관코드/차수 채움
  const XLSXNODE = require('./node_modules/xlsx');
  const rwb = XLSXNODE.readFile(rosterPath); const rws = rwb.Sheets[rwb.SheetNames[0]];
  const raoa = XLSXNODE.utils.sheet_to_json(rws, { header: 1 });
  const rHeader = raoa[0]; const rRows = raoa.slice(1);
  const headerMatches = JSON.stringify(rHeader) === JSON.stringify(needOrdered);
  const idxNo = rHeader.indexOf('연번'); const idxOrgCode = rHeader.indexOf('기관코드');
  const idxDone = rHeader.indexOf('이수여부'); const idxRound = rHeader.indexOf('차수'); const idxDate = rHeader.indexOf('이수일자');
  const allDone = rRows.every(r => r[idxDone] === '이수');
  const orgCodeFilled = rRows.every(r => r[idxOrgCode] && String(r[idxOrgCode]).trim() !== '');
  const roundFilled = rRows.every(r => r[idxRound] !== '' && r[idxRound] != null); // 이수자는 전원 필수과정 수료했으므로 차수 있어야 함
  const dateFilled = rRows.every(r => r[idxDate] && String(r[idxDate]).trim() !== '');
  const noSequential = rRows.every((r, i) => Number(r[idxNo]) === i + 1);
  // 정렬 검증: 차수 오름차순, 동일 차수 내에서는 이수일자 오름차순
  let sortOk = true;
  for (let i = 1; i < rRows.length; i++) {
    const pr = Number(rRows[i - 1][idxRound]), cr = Number(rRows[i][idxRound]);
    if (cr < pr) { sortOk = false; break; }
    if (cr === pr && String(rRows[i][idxDate]) < String(rRows[i - 1][idxDate])) { sortOk = false; break; }
  }
  console.log('다운로드 엑셀 검증: 행수', rRows.length, '| 헤더순서=', headerMatches ? '✅' : '❌', '| 연번 1..N 연속=', noSequential ? '✅' : '❌',
    '| 전원 이수=', allDone ? '✅' : '❌', '| 기관코드 전원 채움=', orgCodeFilled ? '✅' : '❌', '| 차수 전원 채움=', roundFilled ? '✅' : '❌',
    '| 이수일자 전원 채움=', dateFilled ? '✅' : '❌', '| 차수→이수일자 오름차순 정렬=', sortOk ? '✅' : '❌');
  if (!headerMatches || !noSequential || !allDone || !orgCodeFilled || !roundFilled || !dateFilled || !sortOk || rRows.length === 0) ok = false;

  // 미이수자만 다운로드: 차수가 없는(빈) 행이 '연속된 꼬리'로만 나오는지(중간 삽입 금지) + 비어있지 않은 구간은 차수 오름차순
  await page.selectOption('#content select >> nth=0', { label: '미이수자만' });
  await page.waitForTimeout(200);
  const [dlNd] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#content .head button.btn.sec')
  ]);
  const ndPath = path.join(require('os').tmpdir(), 'roster_nd.xlsx');
  await dlNd.saveAs(ndPath);
  const nwb = XLSXNODE.readFile(ndPath); const nws = nwb.Sheets[nwb.SheetNames[0]];
  const naoa = XLSXNODE.utils.sheet_to_json(nws, { header: 1 });
  const nHeader = naoa[0]; const nRows = naoa.slice(1);
  const nIdxRound = nHeader.indexOf('차수');
  let sawNull = false, nullTailOk = true, ndSortOk = true, nullCnt = 0;
  for (let i = 0; i < nRows.length; i++) {
    const raw = nRows[i][nIdxRound];
    const isNull = raw === '' || raw == null;
    if (isNull) { sawNull = true; nullCnt++; continue; }
    if (sawNull) { nullTailOk = false; break; } // 빈 차수 뒤에 다시 차수가 나오면 실패
    if (i > 0 && !sawNull) {
      const prevRaw = nRows[i - 1][nIdxRound];
      if (prevRaw !== '' && prevRaw != null && Number(raw) < Number(prevRaw)) { ndSortOk = false; break; }
    }
  }
  console.log('미이수자 다운로드 검증: 행수', nRows.length, '| 차수없음(null)', nullCnt, '건 | null은 맨뒤 연속=', nullTailOk ? '✅' : '❌', '| 비어있지 않은 구간 차수 오름차순=', ndSortOk ? '✅' : '❌');
  if (!nullTailOk || !ndSortOk || nRows.length === 0) ok = false;
  // 다음 검증들을 위해 필터를 이수자만으로 되돌릴 필요는 없음(이후 검증은 다른 탭 사용)

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

  // 이수율 현황표 산출기간 검증: 차수 범위 / 이수일자 범위 / 전체 복귀
  async function rateNoteTotal() {
    return page.$$eval('#content .note.info', ns => {
      const n = ns.find(x => x.textContent.includes('(이수인원)'));
      const m = n && n.textContent.match(/총\s*([\d,]+)\s*명/);
      return m ? Number(m[1].replace(/,/g, '')) : -1;
    });
  }
  const perExp = await page.evaluate(() => {
    const ppl = window.__LMS_APP.result.persons.filter(p => p.기준정의);
    return {
      round15: ppl.filter(p => p.이수 && p.차수 != null && p.차수 >= 1 && p.차수 <= 5).length,
      date: ppl.filter(p => p.이수 && p.이수일자 && p.이수일자 >= '2026-01-01' && p.이수일자 <= '2026-02-06').length,
      all: ppl.filter(p => p.이수).length
    };
  });
  await page.selectOption('#ratePeriodMode', 'round'); await page.waitForTimeout(250);
  await page.fill('#ratePeriodFrom', '1'); await page.dispatchEvent('#ratePeriodFrom', 'change'); await page.waitForTimeout(250);
  await page.fill('#ratePeriodTo', '5'); await page.dispatchEvent('#ratePeriodTo', 'change'); await page.waitForTimeout(300);
  const noteRound = await rateNoteTotal();
  const roundOk = noteRound === perExp.round15 && perExp.round15 > 0 && perExp.round15 < perExp.all;
  console.log('산출기간(차수 1~5차): 표 이수인원', noteRound, '| 기대', perExp.round15, '| 전체', perExp.all, roundOk ? '✅' : '❌');
  if (!roundOk) ok = false;
  await page.selectOption('#ratePeriodMode', 'date'); await page.waitForTimeout(250);
  await page.fill('#ratePeriodFrom', '2026-01-01'); await page.dispatchEvent('#ratePeriodFrom', 'change'); await page.waitForTimeout(250);
  await page.fill('#ratePeriodTo', '2026-02-06'); await page.dispatchEvent('#ratePeriodTo', 'change'); await page.waitForTimeout(300);
  const noteDate = await rateNoteTotal();
  const dateOk = noteDate === perExp.date && perExp.date > 0 && perExp.date < perExp.all;
  console.log('산출기간(이수일자 2026-01-01~02-06): 표 이수인원', noteDate, '| 기대', perExp.date, dateOk ? '✅' : '❌');
  if (!dateOk) ok = false;
  // 산출기간 라벨이 화면에 표기되는지
  const labelShown = await page.$$eval('#content .note.info', ns => ns.some(x => /산출기간:/.test(x.textContent)));
  console.log('산출기간 라벨 표기:', labelShown ? '✅' : '❌');
  if (!labelShown) ok = false;
  await page.selectOption('#ratePeriodMode', 'all'); await page.waitForTimeout(300);
  const noteAll = await rateNoteTotal();
  const allOk = noteAll === perExp.all && perExp.all === kpi.이수자;
  console.log('산출기간(전체 복귀): 표 이수인원', noteAll, '| KPI 이수자', kpi.이수자, allOk ? '✅' : '❌');
  if (!allOk) ok = false;

  console.log('\nconsole errors:', errors.length, errors.slice(0, 5));
  console.log('\nRESULT:', ok && errors.length === 0 ? 'PASS ✅' : 'CHECK ⚠️');
  await browser.close();
})().catch(e => { console.error('E2E FAIL:', e); process.exit(1); });
