@echo off
chcp 65001 >nul
title GitHub Uploader - artnp/ebookAI
echo.
echo ========================================
echo   Uploading to artnp/ebookAI (main)
echo ========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "D:\Github\github_upload.ps1" "%~dp0." "artnp/ebookAI"

if %ERRORLEVEL% equ 0 (
    echo.
    echo Upload complete!
) else (
    echo.
    echo Upload had errors.
)
echo.
pause
exit /b
