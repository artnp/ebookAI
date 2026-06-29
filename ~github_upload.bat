@echo off
chcp 65001 >nul
title GitHub Uploader - artnp/ebookAI
echo.
echo ========================================
echo   Uploading to artnp/ebookAI (main)
echo ========================================
echo.

set "PS_FILE=%TEMP%\gu_%RANDOM%.ps1"
set "ADDON_ROOT=%~dp0"
set "ADDON_ROOT=%ADDON_ROOT:~0,-1%"

powershell -NoProfile -Command "&{$f='%~f0'; $m=$false; $c=switch -File $f { '###PS###' { $m=$true } default { if($m) { $_ } } }; Set-Content -Path '%PS_FILE%' -Value $c}"

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_FILE%" "%ADDON_ROOT%"

del "%PS_FILE%" 2>nul

if %ERRORLEVEL% equ 0 (
    echo.
    echo Upload complete!
) else (
    echo.
    echo Upload had errors.
)
echo.
exit /b

###PS###
param($root)
$root = $root.TrimEnd('\')
$ErrorActionPreference = 'Stop'

$token     = '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'
$apiRoot   = 'https://api.github.com/repos/artnp/ebookAI/contents'
$branch    = 'main'
$headers   = @{
    Authorization = "token $token"
    Accept        = 'application/vnd.github.v3+json'
}

function Get-FileSha($path) {
    try {
        $url = "$apiRoot/$([uri]::EscapeDataString($path))?ref=$branch"
        return (Invoke-RestMethod -Uri $url -Headers $headers -Method Get -ErrorAction SilentlyContinue).sha
    } catch { return $null }
}

function Get-GitHubFiles {
    $treeUrl = "https://api.github.com/repos/artnp/ebookAI/git/trees/$branch`?recursive=1"
    $tree = Invoke-RestMethod -Uri $treeUrl -Headers $headers -Method Get
    return $tree.tree | Where-Object { $_.type -eq 'blob' } | Select-Object @{N='path';E={$_.path}}, @{N='sha';E={$_.sha}}
}

function Delete-File($repoPath, $sha) {
    try {
        $body = @{
            message = "Delete $repoPath"
            sha     = $sha
            branch  = $branch
        }
        $url = "$apiRoot/$([uri]::EscapeDataString($repoPath))"
        Invoke-RestMethod -Uri $url -Headers $headers -Method Delete -Body ($body | ConvertTo-Json) -ContentType 'application/json' | Out-Null
        Write-Host "  [DEL] $repoPath" -ForegroundColor DarkYellow
        return $true
    } catch {
        Write-Host "  [DEL FAIL] $repoPath - $_" -ForegroundColor Red
        return $false
    }
}

function Upload-File($localPath, $repoPath) {
    try {
        $bytes = [IO.File]::ReadAllBytes($localPath)

        if ($localPath -like '*For Chrome Addon*contentScript*') {
            $text = [Text.Encoding]::UTF8.GetString($bytes)
            $text = $text -replace "const token = '.*?';", "const token = 'YOUR_GITHUB_TOKEN';"
            $bytes = [Text.Encoding]::UTF8.GetBytes($text)
            Write-Host "  [SANITIZED] Stripped token from $repoPath" -ForegroundColor Yellow
        }

        $b64 = [Convert]::ToBase64String($bytes)
        $sha = Get-FileSha $repoPath

        $body = @{
            message = if ($sha) { "Update $repoPath" } else { "Create $repoPath" }
            content = $b64
            branch  = $branch
        }
        if ($sha) { $body.sha = $sha }

        $url = "$apiRoot/$([uri]::EscapeDataString($repoPath))"
        Invoke-RestMethod -Uri $url -Headers $headers -Method Put -Body ($body | ConvertTo-Json) -ContentType 'application/json' | Out-Null
        Write-Host "  [OK] $repoPath" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "  [FAIL] $repoPath - $_" -ForegroundColor Red
        return $false
    }
}

Write-Host 'Scanning files...' -ForegroundColor Cyan

$localPaths = [System.Collections.Generic.HashSet[string]]::new()

Get-ChildItem -Path $root -File -Recurse | ForEach-Object {
    $localPath = $_.FullName
    $repoPath  = $localPath.Substring($root.Length + 1) -replace '\\', '/'
    if ($repoPath -eq 'github_upload.ps1' -or $repoPath -eq 'github_upload.bat' -or $repoPath -eq 'app.js') {
        return
    }
    $null = $localPaths.Add($repoPath)
    $null = Upload-File $localPath $repoPath
}

Write-Host 'Checking for orphaned files on GitHub...' -ForegroundColor Cyan

$ghFiles = Get-GitHubFiles
$deleted = 0
foreach ($f in $ghFiles) {
    if ($f.path -eq 'github_upload.ps1' -or $f.path -eq 'github_upload.bat' -or $f.path -eq 'app.js') {
        continue
    }
    if (-not $localPaths.Contains($f.path)) {
        $null = Delete-File $f.path $f.sha
        $deleted++
    }
}
if ($deleted -eq 0) { Write-Host '  No orphaned files found.' -ForegroundColor Gray }

Write-Host 'Done!' -ForegroundColor Cyan
