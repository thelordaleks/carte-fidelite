@echo off
echo ===============================
echo   PUSH CARTE FIDELITE vers GITHUB
echo ===============================
echo.

cd /d "%~dp0"

echo [1/6] Configuration Git...
git config --global --add safe.directory "*"
git config core.autocrlf false

echo.
echo [2/6] Verification du .gitignore...
if not exist ".gitignore" (
  (
    echo node_modules/
    echo .env
    echo data/
    echo *.log
  )> .gitignore
  echo   .gitignore cree.
) else (
  echo   .gitignore deja present.
)

echo.
echo [3/6] Retrait de node_modules du suivi Git (si besoin)...
git rm -r --cached node_modules >nul 2>&1
if %errorlevel%==0 (echo   node_modules retire du suivi.) else (echo   node_modules deja hors suivi.)

echo.
echo [4/6] Ajout des fichiers...
git add .

echo.
echo [5/6] Commit...
git commit -m "Update carte fidelite"
if %errorlevel% neq 0 echo   (Rien a committer ou commit ignore - on continue.)

echo.
echo [6/6] Push vers GitHub...
git push origin main

echo.
echo ===============================
echo   TERMINE
echo ===============================
pause
