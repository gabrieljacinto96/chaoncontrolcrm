@echo off
setlocal

cd /d "%~dp0"
echo A iniciar o sistema PYTHON AURA...

start "PYTHON AURA - Servidor" cmd /k "cd /d ""%~dp0"" && npm start"
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"

echo Servidor iniciado. O browser foi aberto em http://localhost:3000
endlocal
