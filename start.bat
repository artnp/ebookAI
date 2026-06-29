@echo off
cd /d "%~dp0"
if "%~1"=="" (
    start "" /B node_modules\electron\dist\electron.exe . 2>nul
) else (
    start "" /B node_modules\electron\dist\electron.exe . "%~1" 2>nul
)
