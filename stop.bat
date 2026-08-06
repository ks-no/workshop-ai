@echo off

echo.
echo Stopping workshop-ai...
echo.
docker compose down -t 0
if errorlevel 1 (
echo.
echo Failed to stop services.
pause
exit /b 1
)
echo.
echo Services stopped.
echo.

pause