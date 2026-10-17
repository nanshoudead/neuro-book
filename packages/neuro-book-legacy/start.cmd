@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem 环境只走 data\.env。不要在这里用 set 写 NEURO_BOOK_* 或端口。
rem 监听地址以 data\config.yaml 的 server.host / server.port 为准，有合法端口时会盖过 .env 里的 PORT。

where bun >nul 2>&1
if errorlevel 1 (
    echo 找不到 bun。请先安装 Bun，并确认它在 PATH 里。
    exit /b 1
)

if not exist "data\.env" (
    echo 缺少 data\.env，启动已停止。
    exit /b 1
)

if not exist ".nuxt\product-raw\server\index.mjs" (
    echo 缺少打包产物 .nuxt\product-raw\server\index.mjs。
    echo 请先在这个目录执行：bun run nuxt:build:raw
    exit /b 1
)

set "PORT=3001"
if exist "data\config.yaml" (
    for /f "tokens=2" %%P in ('findstr /R /C:"^  port: [0-9][0-9]*$" "data\config.yaml"') do set "PORT=%%P"
)

netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
    echo 端口 %PORT% 已有进程在监听。请先停掉旧的 NeuroBook，再运行这个脚本。
    netstat -ano | findstr /R /C:":%PORT% .*LISTENING"
    exit /b 1
)

echo 启动 NeuroBook：http://127.0.0.1:%PORT%/
bun --env-file=data/.env --no-install .nuxt\product-raw\server\index.mjs
exit /b %ERRORLEVEL%
