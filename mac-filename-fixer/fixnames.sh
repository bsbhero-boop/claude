#!/bin/bash
#
# fixnames.sh — macOS에서 깨진(자모 분리, NFD) 한글 파일명을 NFC(완성형)로 고칩니다.
#
#   맥은 파일명을 유니코드 NFD(자모가 분리된 형태)로 저장하는데, 윈도우·리눅스·
#   웹 업로드·압축 등 다른 환경에서는 NFC(완성형)를 기대하기 때문에 "ㅍㅏㅇㅣㄹ.txt"
#   처럼 깨져 보입니다. 이 스크립트는 파일/폴더 이름을 NFC로 정규화해 "제자리에서"
#   이름을 바꿉니다(사본을 만들지 않습니다). 폴더는 재귀적으로 처리합니다.
#
# 사용법:
#   ./fixnames.sh <파일 또는 폴더> [<파일 또는 폴더> ...]
#
# 정규화는 perl(Unicode::Normalize)을 우선 사용하고 없으면 python3로 대체합니다.
# 둘 다 macOS에 기본 포함/설치되어 있어 인터넷 연결이 필요 없습니다(오프라인 동작).

set -u

# ── NFC 정규화 도구 선택 (한 번만 결정) ──────────────────────────────
NORMALIZER=""
if perl -MUnicode::Normalize -e '1' >/dev/null 2>&1; then
  NORMALIZER="perl"
elif command -v python3 >/dev/null 2>&1; then
  NORMALIZER="python3"
else
  echo "오류: perl(Unicode::Normalize) 또는 python3 가 필요합니다." >&2
  exit 1
fi

# 문자열을 NFC로 정규화하여 (개행 없이) 출력
nfc() {
  if [ "$NORMALIZER" = "perl" ]; then
    perl -CSA -MUnicode::Normalize -e 'print NFC($ARGV[0])' -- "$1"
  else
    python3 -c 'import sys,unicodedata; sys.stdout.write(unicodedata.normalize("NFC", sys.argv[1]))' "$1"
  fi
}

fixed=0
skipped=0
declare -a REPORT=()
MAX_REPORT_LINES=60

add_report() {
  # 상세 목록은 일정 개수까지만 저장 (요약 대화상자가 지나치게 길어지지 않도록)
  if [ "${#REPORT[@]}" -lt "$MAX_REPORT_LINES" ]; then
    REPORT+=("$1")
  fi
}

# 항목 하나(파일 또는 폴더)의 이름을 NFC로 바꿈
rename_one() {
  local path="$1"
  local dir base newbase src dst tmp
  dir=$(dirname -- "$path")
  base=$(basename -- "$path")
  newbase=$(nfc "$base")

  # 이미 NFC면 아무것도 하지 않음
  [ "$base" = "$newbase" ] && return

  src="$dir/$base"
  dst="$dir/$newbase"

  # 대상 이름이 "다른 파일"로 이미 존재하면 덮어쓰지 않고 건너뜀.
  # APFS는 NFD/NFC를 같은 파일로 취급하므로 -ef 로 동일 파일 여부를 확인한다.
  # (동일 파일이면 그냥 이름 표기만 NFC로 바꾸는 것이므로 진행해도 안전)
  if [ -e "$dst" ] && ! [ "$src" -ef "$dst" ]; then
    add_report "건너뜀(이미 존재): $base"
    skipped=$((skipped + 1))
    return
  fi

  # ASCII 임시 이름을 거쳐 두 단계로 이동한다.
  # 이렇게 해야 파일시스템(APFS 등)에 저장되는 바이트가 확실히 NFC가 된다.
  tmp="$dir/.nfcfix.$$.$RANDOM.tmp"
  while [ -e "$tmp" ]; do tmp="$dir/.nfcfix.$$.$RANDOM.tmp"; done

  if mv -f -- "$src" "$tmp" 2>/dev/null && mv -f -- "$tmp" "$dst" 2>/dev/null; then
    add_report "수정: $base  →  $newbase"
    fixed=$((fixed + 1))
  else
    # 실패하면 원상 복구 시도
    [ -e "$tmp" ] && mv -f -- "$tmp" "$src" 2>/dev/null
    add_report "실패: $base"
    skipped=$((skipped + 1))
  fi
}

# 인자 하나 처리: 폴더면 가장 깊은 항목부터 재귀 처리
process_arg() {
  local target="$1"
  if [ ! -e "$target" ]; then
    add_report "없음: $target"
    skipped=$((skipped + 1))
    return
  fi

  if [ -d "$target" ]; then
    # -depth: 하위 항목을 상위 폴더보다 먼저 처리 → 상위 폴더 이름을 바꿔도
    #         이미 처리한 하위 경로가 깨지지 않는다. 목록을 먼저 모두 읽어 둔다.
    local -a items=()
    while IFS= read -r -d '' p; do
      items+=("$p")
    done < <(find "$target" -depth -print0)
    local p
    for p in "${items[@]}"; do
      rename_one "$p"
    done
  else
    rename_one "$target"
  fi
}

if [ "$#" -eq 0 ]; then
  echo "사용법: $0 <파일 또는 폴더> [<파일 또는 폴더> ...]" >&2
  exit 1
fi

for arg in "$@"; do
  process_arg "$arg"
done

# ── 요약 출력 ───────────────────────────────────────────────────────
for line in "${REPORT[@]}"; do
  printf '%s\n' "$line"
done

total=$((fixed + skipped))
if [ "$total" -eq 0 ]; then
  echo "고칠 파일명이 없습니다. (모두 정상입니다 ✓)"
else
  if [ "${#REPORT[@]}" -ge "$MAX_REPORT_LINES" ]; then
    echo "… (상세 목록은 처음 ${MAX_REPORT_LINES}개만 표시)"
  fi
  echo "─────────────────────────────"
  echo "완료:  수정 ${fixed}개, 건너뜀 ${skipped}개"
fi
