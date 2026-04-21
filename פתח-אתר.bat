@echo off
cd /d C:\Users\edena\financial-website
start "שרת האתר" cmd /k "npm run dev"
timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"
