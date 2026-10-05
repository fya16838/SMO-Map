@echo off
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
if not defined SMO_PORT set "SMO_PORT=8791"

REM ---- 找一个可用的 python ----
set "PY="
for %%P in (
  "D:\Hermes\app\hermes-agent\venv\Scripts\python.exe"
  "D:\Hermes\runtime\hermes-tools-venv\Scripts\python.exe"
) do (
  if not defined PY if exist %%P set "PY=%%~P"
)
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  where py >nul 2>nul && set "PY=py"
)
if not defined PY (
  echo [ERROR] 没有找到 Python，请安装 Python 3 或修改本脚本里的 PY 路径。
  pause
  exit /b 1
)

title SMO Map - Local Server (:%SMO_PORT%)
echo.
echo   ================================================
echo     SMO Map  本地服务
echo   ================================================
echo     地址:  http://127.0.0.1:%SMO_PORT%/
echo     关闭此窗口即停止服务
echo   ================================================
echo.

"%PY%" "%ROOT%\server.py"
echo.
echo 服务已退出。
pause >nul
