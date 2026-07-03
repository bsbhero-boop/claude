/**
 * 병원동행 실습 시뮬레이션 — 이수 기록 저장용 Google Apps Script
 *
 * [배포 방법]
 * 1. 이수 기록을 저장할 Google Sheet를 새로 만들거나 기존 시트를 엽니다.
 * 2. 상단 메뉴 확장 프로그램 > Apps Script를 클릭합니다.
 * 3. 기본으로 생성된 Code.gs 내용을 모두 지우고 이 파일 내용을 붙여넣습니다.
 * 4. 우측 상단 배포 > 새 배포를 클릭합니다.
 *    - 유형: 웹 앱
 *    - 실행할 사용자: 나
 *    - 액세스 권한이 있는 사용자: 모든 사용자 (Anyone)
 * 5. 배포 후 발급되는 웹 앱 URL을 복사합니다.
 * 6. 프로젝트 루트의 .env 파일에 VITE_APPS_SCRIPT_URL=발급받은URL 형태로 저장합니다. (.env.example 참고)
 * 7. 이후 코드를 수정할 때는 "새 배포"를 다시 만들지 말고, 배포 > 배포 관리 > 편집(연필 아이콘) >
 *    버전: 새 버전으로 업데이트해야 웹 앱 URL이 바뀌지 않습니다.
 *
 * 시트에는 "이수기록" 탭이 자동으로 생성되고, 각 이수 건마다 한 행씩 기록됩니다.
 */

const SHEET_NAME = '이수기록';
const HEADERS = ['서버 기록 시각', '이름', '소속기관', '완료일시', '정답률', '완료코드'];

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ result: 'error', message: '요청 본문이 없습니다.' });
    }

    const data = JSON.parse(e.postData.contents);
    const sheet = getOrCreateSheet();

    sheet.appendRow([
      new Date(),
      data.name || '',
      data.org || '',
      data.completedAt || '',
      data.score || '',
      data.completionCode || '',
    ]);

    return jsonResponse({ result: 'success' });
  } catch (err) {
    return jsonResponse({ result: 'error', message: String(err) });
  }
}

// 배포 URL을 브라우저로 직접 열어 정상 배포되었는지 확인할 때 사용합니다.
function doGet() {
  return ContentService.createTextOutput('병원동행 실습 시뮬레이션 이수 기록 API — 정상 작동 중입니다.');
}

function getOrCreateSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
