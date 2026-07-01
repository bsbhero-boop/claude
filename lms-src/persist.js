const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const UP = '/root/.claude/uploads/cd57ac93-8f4d-5823-bb34-c33379307f24/';
const HTML = 'file://' + path.resolve(__dirname, '..', 'lms-statistics-v4.html');
const userDataDir = '/tmp/claude-0/-home-user-claude/cd57ac93-8f4d-5823-bb34-c33379307f24/scratchpad/pw-profile';
const DL = '/tmp/claude-0/-home-user-claude/cd57ac93-8f4d-5823-bb34-c33379307f24/scratchpad/dl';
fs.mkdirSync(DL, { recursive: true });

(async () => {
  const ctx = await chromium.launchPersistentContext(userDataDir, { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', acceptDownloads: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(HTML);
  await page.waitForFunction(() => typeof XLSX !== 'undefined', null, { timeout: 15000 });

  // 회원정보 업로드 → IndexedDB 저장
  await page.setInputFiles('#fileMember', UP + 'd7a572fb-____.xlsx');
  await page.waitForFunction(() => window.__LMS_APP && window.__LMS_APP.members, null, { timeout: 60000 });
  console.log('1차 로드 회원수:', await page.evaluate(() => window.__LMS_APP.members.length));

  // 페이지 새로고침 → IndexedDB 복원 확인
  await page.reload();
  await page.waitForTimeout(1500);
  const restored = await page.evaluate(() => window.__LMS_APP && window.__LMS_APP.members ? window.__LMS_APP.members.length : 0);
  console.log('새로고침 후 복원 회원수:', restored, restored === 59148 ? '✅ 영구저장 OK' : '⚠️ 복원 실패');
  const statusText = await page.$eval('#statusbar', n => n.textContent).catch(() => '');
  console.log('상태바:', statusText.replace(/\s+/g, ' ').trim().slice(0, 80));

  // 수강데이터 올리고 미이수자 엑셀 다운로드 시도
  await page.setInputFiles('#fileStudent', [UP + '835ae5a9-__________20260626.____4.xls']);
  await page.waitForFunction(() => window.__LMS_APP && window.__LMS_APP.result, null, { timeout: 120000 });
  await page.click('button.tab:has-text("이수자·미이수자 명단")');
  await page.waitForTimeout(300);
  const [ download ] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#content .head button.btn.sec')
  ]);
  const dest = path.join(DL, download.suggestedFilename());
  await download.saveAs(dest);
  const sz = fs.statSync(dest).size;
  console.log('엑셀 다운로드:', download.suggestedFilename(), sz, 'bytes', sz > 1000 ? '✅' : '⚠️');

  // 다운로드한 엑셀이 유효한지 재파싱
  const XLSX = require('xlsx');
  try {
    const wb = XLSX.readFile(dest); const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    console.log('다운로드 엑셀 헤더:', JSON.stringify(rows[0]), '| 데이터행:', rows.length - 1, '✅');
  } catch (e) { console.log('엑셀 재파싱 실패 ⚠️', e.message); }

  await ctx.close();
  console.log('DONE');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
