@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Pixel Petshed

set "NODE_EXE="
where node >nul 2>nul
if %errorlevel%==0 set "NODE_EXE=node"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%APPDATA%\nvm\node.exe" set "NODE_EXE=%APPDATA%\nvm\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE_EXE goto nonode

echo.
echo   Pixel Petshed is starting...
echo.
echo   Site:  http://127.0.0.1:5173
echo   Data:  data\petshed.json
echo.
echo   Keep this window open while you play.
echo   Closing this window stops the site.
echo.

"%NODE_EXE%" server.js

echo.
echo Server stopped.
pause
exit /b 0

:nonode
echo.
echo   [x] Node.js not found.
echo.
echo   Install the LTS version from https://nodejs.org
echo   then close this window and double-click this file again.
echo.
pause
exit /b 1
