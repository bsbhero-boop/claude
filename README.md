# 병원동행 실습 시뮬레이션

노인맞춤돌봄서비스·퇴원환자단기집중서비스 초단기근로자(돌봄제공인력)를 위한
모바일 웹 기반 병원동행 실습 교육 시뮬레이션입니다. 로드뷰처럼 장면을 탭으로
이동하며, 각 장소에서 상황 판단 퀴즈를 풀어보는 방식으로 구성되어 있습니다.

필수 경로(7단계 8장면)를 순서대로 밟아야 하지만, 병원 로비·대기실에서는
안내데스크·편의점·화장실·휴게 라운지 같은 선택(둘러보기) 장소에 자유롭게
다녀올 수 있어 실제 병원을 도는 느낌을 살렸습니다. 검사 이후 수납·약국은
순서 상관없이 둘 다 방문해야 귀가 단계로 넘어갈 수 있습니다.

## 기술 스택

- React + Vite + TypeScript
- Tailwind CSS (모바일 퍼스트)
- 상태관리: `useReducer` (`src/state/useSimulation.ts`) — 별도 라이브러리 없음
- 콘텐츠 데이터: `src/data/content.ts` 정적 데이터
- 이수 기록: Google Apps Script Web App으로 POST (`apps-script/Code.gs`)

## 폴더 구조

```
src/
  types.ts                  # Location/Exit/퀴즈/이수기록 타입 정의
  data/content.ts           # 전체 콘텐츠 (필수 8장소 + 선택 4장소 + 긴급상황 카드 + O/X 퀴즈)
  state/useSimulation.ts    # 진행 상태 관리 (오리엔테이션 → 장소 그래프 이동 → O/X 퀴즈 → 완료)
  components/
    OrientationScreen.tsx   # Stage 0: 이름/소속기관 입력
    LocationScreen.tsx      # 장소 공통 화면 (장면 + 출구 핫스팟 + 퀴즈/둘러보기)
    ExitHotspots.tsx        # 한 장소의 exits 배열을 순회하며 Hotspot을 렌더링, 게이트 판정
    Hotspot.tsx             # 장면 위 탭 이동 아이콘 (forward/optional/return)
    MapSheet.tsx             # 하단 "전체지도" — 현재 위치·진행 확인용 (탭 이동 없음)
    QuizCard.tsx            # 상황 판단 퀴즈 (오답 시 감점 없이 재선택)
    LearningPointsCard.tsx  # 핵심 학습 포인트 카드
    EmergencyOverlay.tsx    # 보너스: 저확률 긴급상황 카드
    OXQuizScreen.tsx        # 마무리 O/X 스피드 퀴즈 (수행 불가 업무 총정리)
    CompletionScreen.tsx    # 완료 코드/점수 표시 + 서버 전송
  lib/
    completionCode.ts       # 완료 코드 생성 (HV-YYYYMMDD-XXXX)
    submitCompletion.ts     # Apps Script Web App으로 POST
public/images/               # 장면 이미지 (현재 플레이스홀더 SVG)
apps-script/Code.gs          # 이수 기록용 Google Apps Script 초안
legacy-3d-simulation/        # 이전 3D(Three.js) 구현 — 참고용 보관, 더 이상 사용하지 않음
```

### 필수 경로와 선택(둘러보기) 장소

`src/data/content.ts`의 `LOCATIONS` 배열은 각 장소(`Location`)가 `exits` 배열로
다른 장소를 가리키는 그래프 구조입니다. `role: 'mandatory'`인 8개 장소가
`mapOrder`(1~7) 순서의 필수 경로이며, `role: 'optional'`인 4개 장소(안내데스크·
편의점·화장실·휴게 라운지)는 `parentId`로 연결된 필수 장소에서 언제든
다녀올 수 있는 둘러보기 장소로 퀴즈가 없고 진행률에 영향을 주지 않습니다.

exit의 `style`은 네 가지입니다:
- `forward` / `return`: 해당 장소에 `quiz`가 있으면 정답을 맞혀야 탭이 활성화됩니다.
- `optional`: 퀴즈 상태와 무관하게 항상 탭할 수 있습니다.
- `gated`: `requires`에 적힌 장소 id들이 모두 풀려야 렌더링됩니다 (예: 수납·약국을
  순서 상관없이 둘 다 완료해야 귀가 장소로 가는 출구가 나타납니다).

## 시작하기

```bash
npm install
npm run dev       # 개발 서버
npm run build     # 프로덕션 빌드 (dist/)
npm run preview   # 빌드 결과 미리보기
```

모바일 화면 확인은 브라우저 개발자 도구의 반응형 모드(세로 화면)를 사용하세요.

## 콘텐츠 수정하기

모든 장소/학습 포인트/퀴즈 문항은 `src/data/content.ts` 한 파일에 있습니다.
새로운 장소를 추가하거나 문항을 바꿀 때 이 파일만 수정하면 됩니다. 각 exit은
`hotspot: { x, y }` 값(퍼센트 좌표)으로 이미지 위 이동 아이콘 위치를 지정합니다.

## 이미지 교체하기 (플레이스홀더 → 실제 일러스트)

`public/images/scene_XX.svg`, `scene_opt_*.svg`는 현재 단색 배경 + 장소명
텍스트로 된 임시 플레이스홀더입니다 (`scripts/generate-placeholders.mjs`로 생성).
실제 반실사 일러스트가 준비되면:

1. `public/images/` 아래에 같은 파일명 규칙으로 이미지를 넣습니다 (예: `scene_01.jpg`).
2. `src/data/content.ts`의 각 장소 `image` 경로를 새 파일명으로 바꿉니다.

아트 디렉션 기준: 반실사 스타일, 디테일 절제, 저채도(슬레이트그레이 `#5e7480`·
세이지그린 `#5f9683` 톤), 핫스팟 위치만 은은하게 강조, 전경 인물 표정은
또렷하게·배경은 흐릿하게, 4:3 비율, 이미지 내 텍스트/로고 없음. 각 장소의
`imageAlt` 텍스트를 그대로 생성 프롬프트로 사용할 수 있습니다.

## 이수 기록 자동 저장 (Google Apps Script)

1. `apps-script/Code.gs` 상단 주석의 배포 방법대로 Google Sheet에 Apps Script를
   배포하고 웹 앱 URL을 발급받습니다.
2. 프로젝트 루트에 `.env` 파일을 만들고 아래처럼 설정합니다 (`.env.example` 참고).

   ```
   VITE_APPS_SCRIPT_URL=발급받은_웹앱_URL
   ```

3. GitHub Actions로 배포한다면 저장소 Settings > Secrets and variables > Actions에
   `VITE_APPS_SCRIPT_URL` 시크릿을 등록해야 빌드에 반영됩니다.

URL이 설정되지 않은 상태에서도 앱은 정상 동작합니다 — 완료 화면에 코드/점수를
표시하고, 서버 전송만 건너뜁니다 (콘솔에 안내 로그 출력).

## 배포

### GitHub Pages
`.github/workflows/deploy.yml`이 `main` 브랜치 푸시 시 자동 빌드·배포합니다.
저장소 Settings > Pages에서 Source를 "GitHub Actions"로 한 번 설정해두면 됩니다.

### Vercel
저장소를 Vercel에 연결하고 Framework Preset을 Vite로 지정하면 별도 설정 없이
빌드됩니다. `VITE_APPS_SCRIPT_URL` 환경변수를 Vercel 프로젝트 설정에 추가하세요.

## 참고 출처
- 「병원동행 서비스 교육 매뉴얼 v2」(독거노인종합지원센터)
- 「2026년 노인맞춤돌봄서비스 사업안내」Ⅵ. 퇴원환자 단기집중 서비스 (보건복지부/독거노인종합지원센터)
