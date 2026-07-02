-- 파일명 고치기 (Fix Mac Filename)
-- macOS에서 자모가 분리되어(NFD) 깨져 보이는 한글 파일명을 완성형(NFC)으로 고치는 드롭 앱.
-- 이 앱 아이콘 위로 파일이나 폴더를 드래그해서 놓으면, 실제 이름 변경은 번들 안의
-- Resources/fixnames.sh 가 담당한다. (폴더는 재귀적으로 처리)

property appTitle : "파일명 고치기"

-- 앱을 그냥 실행(더블클릭)했을 때: 사용법 안내
on run
	display dialog "맥에서 깨진 한글 파일명(자모 분리)을 고쳐 줍니다." & return & return & ¬
		"고치고 싶은 파일이나 폴더를 이 앱 아이콘 위로 드래그해서 놓으세요." & return & ¬
		"같은 자리에서 파일명이 완성형(NFC)으로 바뀝니다." ¬
		buttons {"확인"} default button "확인" with title appTitle
end run

-- 파일/폴더를 앱 위로 드롭했을 때
on open dropped_items
	-- 번들에 포함된 엔진 스크립트 경로
	set enginePath to POSIX path of (path to resource "fixnames.sh")

	-- 드롭된 항목들을 셸 인자로 조립
	set argString to ""
	repeat with anItem in dropped_items
		set argString to argString & " " & quoted form of (POSIX path of anItem)
	end repeat

	set shellCommand to "/bin/bash " & quoted form of enginePath & argString

	try
		set reportText to do shell script shellCommand
	on error errText number errNum
		display dialog "처리 중 오류가 발생했습니다." & return & return & errText ¬
			buttons {"확인"} default button "확인" with title appTitle with icon stop
		return
	end try

	if reportText is "" then set reportText to "고칠 파일명이 없습니다. (모두 정상입니다 ✓)"

	display dialog reportText buttons {"확인"} default button "확인" with title (appTitle & " — 결과")
end open
