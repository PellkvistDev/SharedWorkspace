@echo off
REM WorkspaceOS one-click launcher (Windows)
REM Assumes `pnpm install && pnpm build` has been run at least once.

setlocal
cd /d "%~dp0"

if not exist ".env" (
  echo .env not found. Copy .env.example to .env and run `pnpm hash-password` first.
  pause
  exit /b 1
)

if not exist "server\dist\index.js" (
  echo Server is not built. Running `pnpm install && pnpm build`...
  call pnpm install
  if errorlevel 1 goto :err
  call pnpm build
  if errorlevel 1 goto :err
)

echo Starting WorkspaceOS...
call pnpm start
goto :eof

:err
echo Build failed. See errors above.
pause
exit /b 1
