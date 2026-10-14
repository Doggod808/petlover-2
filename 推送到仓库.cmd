@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Push Pixel Petshed

where git >nul 2>nul
if not %errorlevel%==0 (
  echo.
  echo   [x] git not found. Install Git for Windows first: https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)

set "REPO=%~1"
if "%REPO%"=="" (
  echo.
  echo   Paste the repository URL and press Enter.
  echo   Example: https://github.com/yourname/petlover.git
  echo.
  set /p REPO=URL: 
)
if "%REPO%"=="" (
  echo   No URL given. Nothing to do.
  pause
  exit /b 1
)

echo.
echo   Repository: %REPO%
echo.

git remote get-url origin >nul 2>nul
if %errorlevel%==0 (
  echo   [1/2] origin already exists, updating it...
  git remote set-url origin "%REPO%"
) else (
  echo   [1/2] adding origin...
  git remote add origin "%REPO%"
)

echo   [2/2] pushing branch main...
echo.
echo   A browser window may pop up asking you to sign in to your Git host.
echo   That login is yours, not ours - the password never passes through this script.
echo.
git push -u origin main

if %errorlevel%==0 (
  echo.
  echo   Done. If this repo is connected to Vercel, the deployment starts by itself.
  echo.
  pause
  exit /b 0
)

echo.
echo   Push was rejected. Most likely the remote repo already has commits
echo   (for example a README created by the web UI). Pick one:
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
