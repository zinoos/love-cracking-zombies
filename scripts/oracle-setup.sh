#!/usr/bin/env bash
set -euo pipefail

echo "=== LCZ Oracle Cloud Setup ==="
echo ""

# --- Node.js 22 ---
if ! command -v node &>/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  echo ">>> Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "Node: $(node -v)"

# --- npm ---
if ! command -v npm &>/dev/null; then
  sudo apt-get install -y npm
fi

# --- firebase-tools ---
if ! command -v firebase &>/dev/null; then
  echo ">>> Installing firebase-tools..."
  sudo npm install -g firebase-tools
fi

# --- Clone repo ---
REPO_DIR="$HOME/love-cracking-zombies"
if [ ! -d "$REPO_DIR" ]; then
  echo ">>> Cloning repo..."
  git clone https://github.com/zinoos/love-cracking-zombies.git "$REPO_DIR"
fi

cd "$REPO_DIR"
echo ">>> Pulling latest..."
git pull origin main

# --- Install dependencies ---
echo ">>> Installing npm dependencies..."
npm ci

# --- Install cloudflared ---
if [ ! -f cloudflared ]; then
  echo ">>> Downloading cloudflared..."
  curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
  chmod +x cloudflared
fi

# --- .env file ---
if [ ! -f .env ]; then
  echo ">>> Creating .env from template..."
  cat > .env << 'ENVEOF'
PORT=3000
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
FIREBASE_SERVICE_ACCOUNT_JSON=
ENVEOF
  echo "    Edit .env and fill in your Supabase + Firebase keys."
  echo "    Then rerun this script."
  echo ""
  echo "    For FIREBASE_SERVICE_ACCOUNT_JSON:"
  echo "    cat firebase-service-account.json | jq -c | base64 -w0"
  echo "    ...or paste the full JSON as a single line."
  exit 1
fi

# --- systemd service ---
SERVICE_FILE="/etc/systemd/system/lcz-watchdog.service"
if [ ! -f "$SERVICE_FILE" ]; then
  echo ">>> Installing systemd service..."
  sudo tee "$SERVICE_FILE" > /dev/null << SYSTEMDEOF
[Unit]
Description=LCZ Watchdog
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$REPO_DIR
ExecStart=/usr/bin/node $REPO_DIR/scripts/watchdog.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SYSTEMDEOF

  sudo systemctl daemon-reload
  sudo systemctl enable lcz-watchdog
fi

# --- Firewall ---
echo ">>> Opening port 3000..."
sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT 2>/dev/null || true

# --- Firebase login reminder ---
echo ""
echo "=== NEXT STEP ==="
echo "Firebase CLI needs authentication for watchdog deploys:"
echo ""
echo "  firebase login:ci"
echo ""
echo "Copy the token. Then start the watchdog:"
echo ""
echo "  sudo systemctl start lcz-watchdog"
echo ""
echo "Check status:"
echo ""
echo "  sudo systemctl status lcz-watchdog"
echo "  curl http://localhost:3000/health"
echo "  cat .watchdog.json"
echo ""
echo "Once running, build the client with the tunnel URL:"
echo ""
echo "  npm run build:hosting -- --server=<tunnel-url>"
echo "  npx firebase deploy --only hosting"
