@echo off
echo ===============================
echo   PUSH CARTE FIDELITE -> GITHUB
echo ===============================
echo.

cd /d "%~dp0"

echo Ajout des fichiers...
git add .

echo.
echo Commit...
git commit -m "Update carte fidelite"

echo.
echo Push vers GitHub...
git push origin main

echo.
echo ===============================
echo   TERMINE
echo ===============================
pause
