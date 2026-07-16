#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""xlsx.full.min.js를 index.html에 인라인하여 단일 배포 파일을 생성한다.

사용법: python3 build.py
출력:  dist/2026_2차교육비_입금대사도구.html  (오프라인 단일 HTML)
"""
import pathlib, re

HERE = pathlib.Path(__file__).parent
src = (HERE / "index.html").read_text(encoding="utf-8")
lib = (HERE / "xlsx.full.min.js").read_text(encoding="utf-8")

marker = re.compile(r"<!-- BUILD:XLSX_LIB -->.*?<!-- /BUILD:XLSX_LIB -->", re.S)
if not marker.search(src):
    raise SystemExit("빌드 마커를 찾지 못했습니다.")
# </script> 문자열이 lib 안에 없어야 안전 — SheetJS 배포본에는 없음(확인됨)
assert "</script" not in lib.lower(), "라이브러리에 </script>가 포함되어 인라인 불가"
out = marker.sub(lambda m: "<script>\n" + lib + "\n</script>", src, count=1)

dist = HERE / "dist"
dist.mkdir(exist_ok=True)
target = dist / "2026_2차교육비_입금대사도구.html"
target.write_text(out, encoding="utf-8")
print(f"OK → {target} ({target.stat().st_size:,} bytes)")
