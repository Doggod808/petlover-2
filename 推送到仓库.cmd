@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Push Pixel Petshed

where git >nul 2>nul
if not %errorlevel%==0 goto nogit

set "REPO=%~1"
git remote get-url origin >nul 2>nul
if %errorlevel%==0 goto hasremote

if not "%REPO%"=="" goto addremote
echo.
echo   No remote configured yet. Paste the repository URL and press Enter.
echo   Example: https://github.com/yourname/petlover-2.git
echo.
set /p REPO=URL: 
if "%REPO%"=="" goto nourl
goto addremote

:addremote
echo   Adding remote origin: %REPO%
git remote add origin "%REPO%"
goto push

:hasremote
echo.
echo   Remote already configured:
git remote get-url origin
if "%REPO%"=="" goto push
echo   Updating it to: %REPO%
git remote set-url origin "%REPO%"
goto push

:push
echo.
echo   Committing local changes (if any)...
git add -A
git -c user.name="Doggod808" -c user.email="Doggod808@users.noreply.github.com" commit -q -m "更新像素宠舍" 2>nul
echo   Pushing branch main...
echo.
echo   A browser window may pop up asking you to sign in to your Git host.
echo.
git push -u origin main
if not %errorlevel%==0 goto pushfailed

echo.
echo   Done. If this repo is connected to Vercel, the deployment starts by itself.
echo.
pause
exit /b 0

:pushfailed
echo.
echo   Push was rejected. Most likely the remote has commits you do not have locally.
echo   Run one of these in this folder:
echo.
echo     A) keep remote history:
echo        git pull --rebase origin main
echo        git push -u origin main
echo.
echo     B) overwrite remote history with this local version:
echo        git push -u origin main --force
echo.
echo   Run either of those in this folder. Option B erases the remote history.
echo.
pause
exit /b 1

:nourl
echo   No URL given. Nothing to do.
pause
exit /b 1

:nogit
echo.
echo   [x] git not found. Install Git for Windows first: https://git-scm.com/download/win
echo.
pause
exit /b 1
