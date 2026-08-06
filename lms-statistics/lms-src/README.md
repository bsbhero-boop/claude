# lms-src — 소스 구성과 빌드

`lms-statistics-v9.html` 은 이 폴더의 파일들을 합쳐 만든 **단일 파일 산출물**입니다.
직접 HTML을 고치지 말고 여기서 고친 뒤 다시 빌드하세요.

## 파일

| 파일 | 역할 |
|---|---|
| `compute.js` | **계산 엔진**(순수 함수). `analyze()` · `coverage()` · `diagnose()`. UI 의존 없음 |
| `app.js` | 화면 로직. 업로드·파싱·탭·표·필터·내보내기·설정 |
| `app.css` | 스타일 |
| `page.html` | HTML 골격 (빌드 시 `/*@@마커@@*/` 치환) |
| `build.js` | 위 파일들을 합쳐 `../lms-statistics-v9.html` 생성 |
| `vendor/xlsx.full.min.js.b64` | SheetJS 원본을 base64로 보관 |
| `test/unit.js` | 계산 엔진 단위 검증 (Node, 86건) |
| `test/e2e.js` | 빌드 결과물 브라우저 검증 (Playwright, 56건) |

## 빌드

```bash
node lms-src/build.js
```

`page.html` 의 마커 4개(`CSS` · `XLSX_B64` · `COMPUTE` · `APP`)를 각각의 내용으로 치환합니다.
치환되지 않은 마커가 남으면 빌드가 실패합니다. 버전 문자열은 `build.js` 의 `VERSION` 하나로
관리되며, `app.js` 의 `@@VERSION@@` 자리에 주입되어 화면 표시·진단 JSON·엑셀 머리말에 함께 쓰입니다.

## 검증

```bash
node lms-src/test/unit.js                     # 계산 엔진
npm i -D playwright && node lms-src/test/e2e.js  # 브라우저 (빌드 후 실행)
# 시스템 크로미움을 쓰려면: CHROME=/path/to/chrome node lms-src/test/e2e.js
```

## 실행 구조 (ver9)

```
lms-statistics-v9.html
├── <script type="text/plain" id="xlsx-b64">   SheetJS 원본(base64)
│     └─ 부트스트랩이 blob: URL 스크립트로 로드  → window.XLSX
├── <script type="text/plain" id="compute-src"> compute.js 원본(텍스트 한 벌)
│     ├─ 부트스트랩이 <script> 로 실행          → window.LMS   (메인 스레드)
│     └─ app.js 가 같은 텍스트로 Blob Worker 생성 → 백그라운드 집계
└── <script> app.js
```

**계산 엔진 소스는 한 벌만 담기고 메인 스레드와 Worker가 함께 씁니다.**
Worker가 대용량 원데이터를 보관하므로, 설정 변경·보류 승인 때마다 데이터를 다시 넘기지 않고
집계만 다시 돌립니다. Worker를 만들 수 없는 환경에서는 같은 API의 동기 방식으로 자동 대체됩니다
(`window.__LMS_ENGINE.mode()` 로 확인 — `worker` 또는 `inline`).

## 고칠 때 주의

- **날짜·차수는 파싱 단계에서 한 번만 정규화합니다.** `app.js` 의 `cellValue()` 와
  `compute.js` 의 `normDate()` · `parseRound()` 가 그 지점입니다. 다른 곳에서 날짜 문자열을
  직접 비교하지 마세요.
- **엑셀 파서 옵션 `raw:true` 를 되돌리지 마세요.** `raw:false` 는 서식이 적용된 텍스트를 주므로
  `2026 / 3` 이 날짜로 오인되어 차수가 무너집니다(ver8 결함 D-01).
- **원데이터에서 온 값을 `innerHTML` 에 직접 넣지 마세요.** `esc()` 를 거치거나 `textContent` 를 쓰세요.
- `compute.js` 는 UI에 의존하지 않아야 합니다 — Worker에서 그대로 실행되기 때문입니다.
  `document` · `window` 를 참조하는 순간 Worker 모드가 깨집니다.
- 파일 검증에 실패하면 **기존 상태를 바꾸지 말고 중단**해야 합니다(ver8 결함 D-04).
