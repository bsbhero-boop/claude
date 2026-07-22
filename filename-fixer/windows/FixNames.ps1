# FixNames.ps1 - Fix broken macOS (NFD) Korean filenames by normalizing to NFC.
#
# macOS stores Hangul filenames in Unicode NFD (decomposed) form. Moved to Windows
# they can look broken. This script renames files/folders to NFC (composed) IN PLACE
# (no copies). Folders are processed recursively, deepest item first.
#
# This file is intentionally PURE ASCII so Korean Windows PowerShell 5.1 cannot
# mis-decode it, and it is Constrained-Language-Mode safe so it also runs with
# Smart App Control turned on (uses no New-Object / no [Type]:: references).
#
# Usage:
#   - Drag files/folders onto FixNames.bat, or
#   - powershell -ExecutionPolicy Bypass -File FixNames.ps1 <path> [<path> ...]

$script:fixed = 0
$script:skipped = 0

function Rename-One([string]$fullPath) {
    $name = Split-Path -LiteralPath $fullPath -Leaf
    $newName = $name.Normalize()               # no-arg Normalize() = NFC (FormC)
    if ($name -ceq $newName) { return }        # already NFC -> nothing to do

    $parent = Split-Path -LiteralPath $fullPath -Parent
    $target = Join-Path $parent $newName
    if (Test-Path -LiteralPath $target) {      # a different file already has that name
        Write-Host ("SKIP (name exists): " + $name)
        $script:skipped = $script:skipped + 1
        return
    }
    try {
        Rename-Item -LiteralPath $fullPath -NewName $newName -ErrorAction Stop
        Write-Host ("FIXED: " + $name + "  ->  " + $newName)
        $script:fixed = $script:fixed + 1
    }
    catch {
        Write-Host ("FAILED: " + $name)
        $script:skipped = $script:skipped + 1
    }
}

function Invoke-Target([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Host ("NOT FOUND: " + $path)
        $script:skipped = $script:skipped + 1
        return
    }
    $item = Get-Item -LiteralPath $path -Force
    if ($item.PSIsContainer) {
        # Collect all descendants, then sort deepest-first (by number of path
        # separators) so renaming a parent never breaks a child path already handled.
        $children = @(Get-ChildItem -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue)
        $children = $children | Sort-Object { ($_.FullName -split '\\').Count } -Descending
        foreach ($c in $children) { Rename-One $c.FullName }
        Rename-One $item.FullName            # finally the top folder itself
    }
    else {
        Rename-One $item.FullName
    }
}

if (-not $args -or $args.Count -eq 0) {
    Write-Host "Drag files or folders onto FixNames.bat."
    Write-Host "Or run: powershell -ExecutionPolicy Bypass -File FixNames.ps1 <path> [<path> ...]"
    exit 1
}

foreach ($p in $args) { Invoke-Target $p }

Write-Host "-----------------------------"
Write-Host ("Done.  Fixed: " + $script:fixed + "   Skipped: " + $script:skipped)
