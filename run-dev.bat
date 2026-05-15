@echo off
REM 直接运行 electron-vite 开发服务器的批处理文件
cd /d "%~dp0"
echo 启动 Term Manager 开发服务器...
echo.
npx electron-vite dev
pause
