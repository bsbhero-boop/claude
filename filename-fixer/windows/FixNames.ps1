# FixNames.ps1 — 맥에서 온 깨진(자모 분리, NFD) 한글 파일명을 NFC(완성형)로 고친다.
#
#   맥은 파일명을 유니코드 NFD(자모 분리형)로 저장한다. 이 파일들을 윈도우로
#   옮기면 NTFS/exFAT 는 NFD 와 NFC 를 서로 다른 이름으로 취급하기 때문에
#   "ㅍㅏㅇㅣㄹ.txt" 처럼 깨져 보이거나 정렬이 어긋난다. 이 스크립트는 파일·폴더
#   이름을 NFC 로 바꿔서(사본을 만들지 않고 제자리에서) 문제를 해결한다.
#   폴더는 재귀적으로 처리한다.
#
# 사용법:
#   - FixNames.bat 아이콘 위로 파일/폴더를 드래그해서 놓기 (권장)
#   - 또는:  powershell -ExecutionPolicy Bypass -File FixNames.ps1 <경로> [<경로> ...]
#
# 윈도우에 기본 포함된 PowerShell 과 .NET 만 사용하므로 인터넷 연결이 필요 없다.

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Paths
)

# 콘솔에 한글이 깨지지 않도록 UTF-8 출력 (실패해도 동작에는 지장 없음)
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$script:fixed   = 0
$script:skipped = 0
$script:report  = New-Object System.Collections.Generic.List[string]
$MaxReport      = 60

function Add-Report([string]$line) {
    if ($script:report.Count -lt $MaxReport) { [void]$script:report.Add($line) }
}

# 문자열을 NFC(완성형)로 정규화. .NET FormC == 유니코드 표준 NFC.
function ConvertTo-NFC([string]$s) {
    return $s.Normalize([System.Text.NormalizationForm]::FormC)
}

# 항목 하나(파일 또는 폴더)의 이름을 NFC 로 변경
function Rename-One([string]$fullPath) {
    $name    = Split-Path -LiteralPath $fullPath -Leaf
    $newName = ConvertTo-NFC $name

    # 이미 NFC 면 아무것도 하지 않음 (-cne: 코드포인트까지 비교)
    if ($name -ceq $newName) { return }

    $parent = Split-Path -LiteralPath $fullPath -Parent
    $target = Join-Path $parent $newName

    # 대상 이름이 다른 파일로 이미 존재하면 덮어쓰지 않고 건너뜀
    if (Test-Path -LiteralPath $target) {
        Add-Report "건너뜀(이미 존재): $name"
        $script:skipped++
        return
    }

    try {
        Rename-Item -LiteralPath $fullPath -NewName $newName -ErrorAction Stop
        Add-Report "수정: $name  ->  $newName"
        $script:fixed++
    }
    catch {
        Add-Report "실패: $name"
        $script:skipped++
    }
}

# 인자 하나 처리: 폴더면 하위 전부를 '깊은 것부터' 재귀 처리
function Invoke-Target([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) {
        Add-Report "없음: $path"
        $script:skipped++
        return
    }

    $item = Get-Item -LiteralPath $path -Force
    if ($item.PSIsContainer) {
        # 하위 항목을 모두 모은 뒤, 경로 구분자 개수(깊이) 내림차순으로 정렬한다.
        # → 자식이 항상 부모보다 먼저 처리되므로, 상위 폴더 이름을 바꿔도
        #   이미 처리한 하위 경로가 깨지지 않는다.
        $children = @(Get-ChildItem -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue)
        $children = $children | Sort-Object { $_.FullName.Split([char]92).Length } -Descending
        foreach ($c in $children) { Rename-One $c.FullName }
        # 마지막으로 폴더 자신
        Rename-One $item.FullName
    }
    else {
        Rename-One $item.FullName
    }
}

if (-not $Paths -or $Paths.Count -eq 0) {
    Write-Host "사용법: 파일이나 폴더를 FixNames.bat 위로 드래그해서 놓으세요."
    Write-Host "또는:  powershell -ExecutionPolicy Bypass -File FixNames.ps1 <경로> [<경로> ...]"
    exit 1
}

foreach ($p in $Paths) { Invoke-Target $p }

# ── 요약 출력 ───────────────────────────────────────────────
foreach ($line in $script:report) { Write-Host $line }

$total = $script:fixed + $script:skipped
if ($total -eq 0) {
    Write-Host "고칠 파일명이 없습니다. (모두 정상입니다)"
}
else {
    if ($script:report.Count -ge $MaxReport) {
        Write-Host "... (상세 목록은 처음 $MaxReport 개만 표시)"
    }
    Write-Host "-----------------------------"
    Write-Host ("완료:  수정 {0}개, 건너뜀 {1}개" -f $script:fixed, $script:skipped)
}
