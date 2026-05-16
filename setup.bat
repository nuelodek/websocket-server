@echo off
REM Gegeto WebSocket Server - Windows Deployment Setup Script

echo.
echo 🚀 Gegeto WebSocket Server - Windows Setup
echo ==========================================
echo.

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js is not installed. Please install Node.js 16+
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo ✅ Node.js %NODE_VERSION% detected

REM Check npm
where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ npm is not installed
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo ✅ npm %NPM_VERSION% detected

REM Install dependencies
echo.
echo 📦 Installing dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Failed to install dependencies
    pause
    exit /b 1
)

REM Create logs directory
echo.
echo 📁 Creating logs directory...
if not exist logs mkdir logs
echo ✅ Logs directory ready

REM Check .env
echo.
if exist .env (
    echo ✅ .env file exists
    echo ⚠️  Please verify .env has correct configuration:
    echo    - DB_HOST, DB_USERNAME, DB_PASSWORD, DB_DATABASE
    echo    - JWT_SECRET (strong random value)
    echo    - NODE_ENV=production
) else (
    echo ⚠️  .env file not found
    if exist .env.example (
        echo 📋 Creating .env from template...
        copy .env.example .env
        echo ✅ Created .env from .env.example
        echo ⚠️  Please edit .env with your configuration!
    ) else (
        echo ❌ .env.example not found
        pause
        exit /b 1
    )
)

REM Check PM2
echo.
where pm2 >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo ✅ PM2 is installed
    echo.
    echo You can start the server with PM2:
    echo   pm2 start server.js --name gegeto-ws --instances max --exec-mode cluster
) else (
    echo ⚠️  PM2 not installed globally
    echo   Install with: npm install -g pm2
)

REM Summary
echo.
echo ==========================================
echo ✅ Setup Complete!
echo ==========================================
echo.
echo 📋 Next Steps:
echo    1. Edit .env with your configuration
echo    2. Run: npm start (development)
echo    3. Or:  pm2 start server.js (production)
echo.
echo 🔗 Verify Server:
echo    Health: http://localhost:10000/health
echo    Stats:  http://localhost:10000/stats
echo.
echo 📚 Documentation:
echo    - README.md
echo    - WEBSOCKET_SECURITY_GUIDE.md
echo    - SECURITY_FIXES_SUMMARY.md
echo.

pause
