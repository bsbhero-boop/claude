#!/bin/bash
#
# build.sh — macOS에서 실행. "파일명 고치기.app" 드롭 앱을 만든다.
#
#   macOS에 기본 포함된 osacompile 로 AppleScript 드롭 앱을 만들고,
#   실제 이름 변경 엔진(fixnames.sh)을 앱 번들 안에 넣는다.
#   Xcode 나 인터넷 연결이 필요 없다.
#
# 사용법:  ./build.sh
# 결과물:  같은 폴더에 "파일명 고치기.app" 생성 → 응용 프로그램 폴더 등으로 옮겨 사용
#
set -euo pipefail

# 이 스크립트가 있는 폴더 기준으로 동작
cd "$(dirname "$0")"

APP_NAME="파일명 고치기.app"
SRC="FixFilename.applescript"
ENGINE="fixnames.sh"

if ! command -v osacompile >/dev/null 2>&1; then
  echo "오류: osacompile 을 찾을 수 없습니다. 이 스크립트는 macOS에서 실행해야 합니다." >&2
  exit 1
fi
for f in "$SRC" "$ENGINE"; do
  [ -f "$f" ] || { echo "오류: $f 파일이 필요합니다." >&2; exit 1; }
done

echo "▸ 이전 빌드 정리..."
rm -rf "$APP_NAME"

echo "▸ AppleScript 앱 컴파일: $APP_NAME"
osacompile -o "$APP_NAME" "$SRC"

echo "▸ 엔진 스크립트를 앱 번들에 포함..."
mkdir -p "$APP_NAME/Contents/Resources"
cp "$ENGINE" "$APP_NAME/Contents/Resources/fixnames.sh"
chmod +x "$APP_NAME/Contents/Resources/fixnames.sh"

# 혹시 붙어 있을 수 있는 격리 속성 제거(다운로드 경고 방지). 실패해도 무시.
xattr -dr com.apple.quarantine "$APP_NAME" 2>/dev/null || true

echo ""
echo "✅ 완료:  $(pwd)/$APP_NAME"
echo ""
echo "사용법:"
echo "  1) \"$APP_NAME\" 을 응용 프로그램 폴더나 Dock 으로 옮기세요(선택)."
echo "  2) 깨진 파일명을 가진 파일이나 폴더를 앱 아이콘 위로 드래그해서 놓으세요."
echo "  3) 같은 자리에서 파일명이 완성형(NFC)으로 바뀝니다."
echo ""
echo "  ※ 처음 실행 시 데스크탑/문서/다운로드 폴더 접근 권한을 물으면 [허용] 하세요."
