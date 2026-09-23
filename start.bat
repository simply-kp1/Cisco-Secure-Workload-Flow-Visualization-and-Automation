@echo off
setlocal EnableDelayedExpansion

rem ============================================================
rem  Secure Workload Policy Visualiser - start
rem
rem    start.bat        build if needed, then serve on port 15455
rem    start.bat dev    development server with hot reload
rem    start.bat clean  force a fresh rebuild, then serve
rem ============================================================

set "PORT=15455"
set "URL=http://localhost:%PORT%"
cd /d "%~dp0"

title Secure Workload Policy Visualiser

echo.
echo  ============================================================
echo   Secure Workload Policy Visualiser
echo   %URL%
echo  ============================================================
echo.

rem ---------- Node present? ----------
where node >nul 2>&1
if errorlevel 1 (
  echo  [ERROR] Node.js was not found on PATH.
  echo          Install Node.js 20 or newer from https://nodejs.org
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do set "NODEVER=%%v"
echo  Node.js !NODEVER!

rem ---------- Port free? ----------
rem See stop.bat for why "-p TCP" is avoided and the match is two-stage.
set "BUSYPID="
for /f "tokens=5" %%p in ('netstat -a -n -o ^| findstr /r /c:":%PORT% " ^| findstr /i /c:"LISTENING"') do (
  if not defined BUSYPID set "BUSYPID=%%p"
)
if defined BUSYPID (
  echo.
  echo  [ERROR] Port %PORT% is already in use by process !BUSYPID!.
  echo          Run stop.bat first, then try again.
  echo.
  pause
  exit /b 1
)

rem ---------- Dependencies ----------
if not exist "node_modules\vite\package.json" (
  echo  Installing dependencies. This happens once and takes a minute...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  [ERROR] npm install failed. See the messages above.
    echo.
    pause
    exit /b 1
  )
  echo.
)

rem ---------- Mode ----------
set "MODE=%~1"

if /i "%MODE%"=="dev" (
  echo  Starting the development server with hot reload.
  echo.
  echo  Open %URL%
  echo  Press Ctrl+C to stop, or run stop.bat from another window.
  echo  ------------------------------------------------------------
  echo.
  call npm run dev
  goto :finished
)

if /i "%MODE%"=="clean" (
  if exist "dist" (
    echo  Removing the previous build...
    rmdir /s /q "dist"
  )
)

rem ---------- Build when there is nothing to serve ----------
if not exist "dist\index.html" (
  echo  Building the application...
  echo.
  call npm run build
  if errorlevel 1 (
    echo.
    echo  [ERROR] The build failed. See the messages above.
    echo.
    pause
    exit /b 1
  )
  echo.
) else (
  echo  Using the existing build in dist\  ^(run "start.bat clean" to rebuild^)
)

echo.
echo  Serving %URL%
echo  A browser window will open automatically.
echo.
echo  Press Ctrl+C to stop, or run stop.bat from another window.
echo  ------------------------------------------------------------
echo.
call npm run start

:finished
echo.
echo  Server stopped.
endlocal
