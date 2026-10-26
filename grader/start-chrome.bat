@echo off
setlocal

rem 自動偵測 Chrome 路徑
set CHROME=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe

if "%CHROME%"=="" (
  echo [ERROR] 找不到 chrome.exe，請手動修改此檔案中的路徑。
  pause
  exit /b 1
)

set PROFILE=%~dp0.chrome-profile
if not exist "%PROFILE%" mkdir "%PROFILE%"

echo.
echo ════════════════════════════════════════════════
echo   啟動專用 Chrome
echo   Profile:  %PROFILE%
echo   Debug:    http://localhost:9222
echo ════════════════════════════════════════════════
echo.
echo 請在這個 Chrome 視窗裡:
echo   1. 手動登入 DeepSeek
echo   2. 完成人機驗證
echo   3. 保持在 chat.deepseek.com
echo.
echo 完成後回到另一個終端機啟動 bridge.js
echo.

start "" "%CHROME%" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%PROFILE%" ^
  --no-first-run ^
  --no-default-browser-check ^
  --disable-blink-features=AutomationControlled ^
  "https://chat.deepseek.com"

endlocal