#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""xlsx.full.min.js를 index.html에 인라인하여 단일 배포 파일을 생성한다.

사용법: python3 build.py
출력:  dist/2026_2차교육비_입금대사도구_v{버전}.html  (오프라인 단일 HTML)
버전은 index.html의 APP_VERSION 상수에서 읽어 파일명에 반영하고,
dist 안의 이전 버전 산출물은 정리한다(이력은 git에 남음).
"""
import pathlib, re

HERE = pathlib.Path(__file__).parent
BASENAME = "2026_2차교육비_입금대사도구"

src = (HERE / "index.html").read_text(encoding="utf-8")
lib = (HERE / "xlsx.full.min.js").read_text(encoding="utf-8")

ver_m = re.search(r"const APP_VERSION\s*=\s*'([^']+)'", src)
if not ver_m:
    raise SystemExit("index.html에서 APP_VERSION을 찾지 못했습니다.")
version = ver_m.group(1)

marker = re.compile(r"<!-- BUILD:XLSX_LIB -->.*?<!-- /BUILD:XLSX_LIB -->", re.S)
if not marker.search(src):
    raise SystemExit("빌드 마커를 찾지 못했습니다.")
# </script> 문자열이 lib 안에 없어야 안전 — SheetJS 배포본에는 없음(확인됨)
assert "</script" not in lib.lower(), "라이브러리에 </script>가 포함되어 인라인 불가"
out = marker.sub(lambda m: "<script>\n" + lib + "\n</script>", src, count=1)

dist = HERE / "dist"
dist.mkdir(exist_ok=True)
target = dist / f"{BASENAME}_v{version}.html"
for stale in dist.glob(f"{BASENAME}*.html"):
    if stale != target:
        stale.unlink()
        print(f"이전 산출물 삭제 → {stale.name}")
target.write_text(out, encoding="utf-8")
print(f"OK → {target} ({target.stat().st_size:,} bytes)")
