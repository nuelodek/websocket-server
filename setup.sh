#!/bin/bash

# Gegeto WebSocket Server - Deployment Setup Script
# This script sets up the WebSocket server for production deployment

set -e

echo "🚀 Gegeto WebSocket Server - Setup Script"
echo "=========================================="

# Check Node.js installation
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+"
    exit 1
fi

echo "✅ Node.js $(node --version) detected"

# Check npm installation
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed"
    exit 1
fi

echo "✅ npm $(npm --version) detected"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Create logs directory
echo ""
echo "📁 Creating logs directory..."
mkdir -p logs
chmod 755 logs

# Check if .env exists
echo ""
if [ -f .env ]; then
    echo "✅ .env file exists"
    echo "⚠️  Please verify .env has correct configuration:"
    echo "   - DB_HOST, DB_USERNAME, DB_PASSWORD, DB_DATABASE"
    echo "   - JWT_SECRET (strong random value)"
    echo "   - NODE_ENV=production"
else
    echo "⚠️  .env file not found"
    echo "📋 Creating .env from template..."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "✅ Created .env from .env.example"
        echo "⚠️  Please edit .env with your configuration!"
    else
        echo "❌ .env.example not found"
        exit 1
    fi
fi

# Check if PM2 is installed globally
echo ""
if command -v pm2 &> /dev/null; then
    echo "✅ PM2 is installed"
    read -p "🔧 Setup PM2 for auto-start? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        pm2 start server.js --name gegeto-ws --instances max --exec-mode cluster
        pm2 save
        pm2 startup
        echo "✅ PM2 configured for auto-start"
    fi
else
    echo "⚠️  PM2 not installed globally"
    echo "   Install with: npm install -g pm2"
    echo "   Then run: pm2 start server.js --name gegeto-ws --instances max"
fi

# Create systemd service (optional)
echo ""
read -p "📝 Create systemd service? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    SERVICE_FILE="/etc/systemd/system/gegeto-websocket.service"
    if [ ! -f "$SERVICE_FILE" ]; then
        echo "Creating systemd service..."
        sudo tee $SERVICE_FILE > /dev/null <<EOF
[Unit]
Description=Gegeto WebSocket Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=$(which node) server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
        sudo systemctl daemon-reload
        sudo systemctl enable gegeto-websocket
        echo "✅ Systemd service created"
        echo "   Start with: sudo systemctl start gegeto-websocket"
        echo "   View logs: journalctl -u gegeto-websocket -f"
    else
        echo "⚠️  Systemd service already exists"
    fi
fi

# Setup log rotation
echo ""
read -p "📊 Setup log rotation? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    LOGROTATE_FILE="/etc/logrotate.d/gegeto-websocket"
    if [ ! -f "$LOGROTATE_FILE" ]; then
        echo "Creating logrotate config..."
        sudo tee $LOGROTATE_FILE > /dev/null <<EOF
$(pwd)/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    create 0644 $USER $USER
    sharedscripts
    postrotate
        systemctl reload gegeto-websocket > /dev/null 2>&1 || true
    endscript
}
EOF
        echo "✅ Log rotation configured"
    else
        echo "⚠️  Log rotation already configured"
    fi
fi

# Database connectivity test
echo ""
echo "🔍 Testing database connectivity..."
if command -v mysql &> /dev/null; then
    read -p "   Test database connection? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "   Enter DB host (default: localhost): " DB_HOST
        DB_HOST=${DB_HOST:-localhost}
        read -p "   Enter DB user: " DB_USER
        read -sp "   Enter DB password: " DB_PASS
        echo
        
        if mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" -e "SELECT 1" > /dev/null 2>&1; then
            echo "✅ Database connection successful"
        else
            echo "❌ Database connection failed"
        fi
    fi
else
    echo "⚠️  MySQL client not installed (optional for testing)"
fi

# Summary
echo ""
echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo "📋 Next Steps:"
echo "   1. Edit .env with your configuration"
echo "   2. Run: npm start (development)"
echo "   3. Or:  pm2 start server.js (production)"
echo ""
echo "🔗 Verify Server:"
echo "   Health: curl http://localhost:10000/health"
echo "   Stats:  curl http://localhost:10000/stats"
echo ""
echo "📚 Documentation:"
echo "   - README.md"
echo "   - WEBSOCKET_SECURITY_GUIDE.md"
echo "   - SECURITY_FIXES_SUMMARY.md"
echo ""
