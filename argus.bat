@echo off
rem ARGUS server control: double-click for a menu, or run "argus start" / "argus stop" / "argus status".
rem Starts the already-built stack in WSL. After changing code, use infra\wsl\setup-outpost-wsl.sh to rebuild.
setlocal
set "DISTRO=Ubuntu-24.04"
set "COMPOSE=cd /home/jakie/argus/infra && docker compose --profile sim"

if /i "%~1"=="start"  goto start
if /i "%~1"=="stop"   goto stop
if /i "%~1"=="status" goto status

:menu
echo.
echo   ARGUS server
echo   [1] Start
echo   [2] Stop
echo   [3] Status
echo   [4] Quit
choice /c 1234 /n /m "  Choose: "
if errorlevel 4 exit /b 0
if errorlevel 3 (call :status & goto menu)
if errorlevel 2 (call :stop & goto menu)
call :start
goto menu

:start
echo Starting ARGUS...
wsl.exe -d %DISTRO% -u root --exec bash -c "%COMPOSE% up -d"
if errorlevel 1 (echo Start failed. & exit /b 1)
echo Waiting for the API to become healthy...
wsl.exe -d %DISTRO% -u root --exec bash -c "for i in $(seq 1 60); do docker inspect -f {{.State.Health.Status}} argus-api-1 | grep -qx healthy && exit 0; sleep 2; done; exit 1"
if errorlevel 1 (echo The API did not become healthy in 2 minutes. Run "argus status" to check. & exit /b 1)
echo ARGUS is up: https://localhost
start "" https://localhost
exit /b 0

:stop
echo Stopping ARGUS...
wsl.exe -d %DISTRO% -u root --exec bash -c "%COMPOSE% stop"
rem shut the WSL VM down too, to give the RAM back to Windows
wsl.exe --terminate %DISTRO% >nul
echo ARGUS is stopped.
exit /b 0

:status
wsl.exe -d %DISTRO% -u root --exec bash -c "%COMPOSE% ps"
exit /b 0
