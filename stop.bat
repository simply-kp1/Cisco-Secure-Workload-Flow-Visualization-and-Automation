@echo off
setlocal EnableDelayedExpansion

rem ============================================================
rem  Secure Workload Policy Visualiser - stop
rem
rem  Stops whatever is listening on port 15455.
rem ============================================================

set "PORT=15455"
cd /d "%~dp0"

title Stop Secure Workload Policy Visualiser

echo.
echo  ============================================================
echo   Stopping Secure Workload Policy Visualiser ^(port %PORT%^)
echo  ============================================================
echo.

call :findpids
if not defined PIDS (
  echo  Nothing is listening on port %PORT%.
  echo  The application is already stopped.
  echo.
  call :hold
  endlocal
  exit /b 0
)

for %%p in (%PIDS%) do (
  set "PNAME=unknown"
  for /f "tokens=1 delims=," %%n in ('tasklist /fi "PID eq %%p" /fo csv /nh 2^>nul') do set "PNAME=%%~n"
  echo  Stopping PID %%p  ^(!PNAME!^)
  taskkill /F /T /PID %%p >nul 2>&1
  if errorlevel 1 (
    echo    [WARN] Could not stop PID %%p. Try running this file as Administrator.
  ) else (
    echo    Stopped.
  )
)

rem Give the socket a moment to be released, then confirm.
ping -n 2 127.0.0.1 >nul 2>&1
call :findpids

echo.
if defined PIDS (
  echo  [WARN] Port %PORT% is still held by:%PIDS%
) else (
  echo  Port %PORT% is now free.
)
echo.
call :hold
endlocal
exit /b 0

rem ------------------------------------------------------------
rem  Collect the distinct PIDs listening on %PORT% into %PIDS%.
rem
rem  Notes on the netstat call:
rem   - "-p TCP" is deliberately NOT used. On some Windows builds it
rem     returns nothing at all when combined with -a -n -o.
rem   - The listening address may be IPv4 (0.0.0.0:15455) or IPv6
rem     ([::1]:15455), so the match is on ":<port>" followed by a
rem     space, and a second pass narrows it to LISTENING sockets.
rem   - A server can hold more than one socket, so PIDs are de-duplicated.
rem ------------------------------------------------------------
:findpids
set "PIDS="
for /f "tokens=5" %%p in ('netstat -a -n -o ^| findstr /r /c:":%PORT% " ^| findstr /i /c:"LISTENING"') do (
  echo !PIDS! | findstr /c:" %%p " >nul
  if errorlevel 1 set "PIDS=!PIDS! %%p "
)
exit /b 0

rem ------------------------------------------------------------
rem  Brief pause so a double-clicked window stays readable. ping is
rem  used rather than timeout, which aborts when stdin is redirected.
rem ------------------------------------------------------------
:hold
ping -n 4 127.0.0.1 >nul 2>&1
exit /b 0
