@echo off
title Dashboard ARCA

echo Iniciando backend...
start "Backend ARCA" cmd /k "cd /d backend && .venv\Scripts\activate && uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

echo Iniciando frontend...
start "Frontend ARCA" cmd /k "cd /d frontend && npm run dev"

echo Esperando a que inicie el frontend...
timeout /t 5 /nobreak > nul

start http://localhost:5173

echo.
echo Dashboard iniciado.
echo Si no abrio automaticamente, entra a:
echo http://localhost:5173
echo.
pause