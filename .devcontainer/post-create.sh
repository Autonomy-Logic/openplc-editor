#!/bin/bash
set -e

echo "=== OpenPLC Editor devcontainer setup ==="

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  NODE_ARCH="x64" ;;
  aarch64) NODE_ARCH="arm64" ;;
  *)       NODE_ARCH="$ARCH" ;;
esac
BIN_DIR="resources/bin/linux/$NODE_ARCH"

# Start virtual display for Electron
echo "[1/4] Starting Xvfb..."
start-xvfb.sh 99 2>/dev/null

# Install root dependencies (downloads binaries, builds DLL)
echo "[2/4] Installing dependencies..."
npm install

# Install release/app dependencies and rebuild native modules for Electron
echo "[3/4] Installing release/app dependencies..."
cd release/app && npm install && cd ../..

# Verify binaries and Electron sandbox
echo "[4/4] Verifying setup..."

if [ -f "$BIN_DIR/iec2c" ]; then
  echo "  matiec binary ($NODE_ARCH): OK"
else
  echo "  WARNING: matiec binary not found at $BIN_DIR/iec2c"
fi

if [ -f "$BIN_DIR/xml2st" ]; then
  echo "  xml2st binary ($NODE_ARCH): OK"
else
  echo "  WARNING: xml2st binary not found at $BIN_DIR/xml2st"
fi

# Fix Electron sandbox for container (chrome-sandbox needs SUID bit or --no-sandbox)
CHROME_SANDBOX="node_modules/electron/dist/chrome-sandbox"
if [ -f "$CHROME_SANDBOX" ]; then
  echo "  Electron sandbox: using --no-sandbox via ELECTRON_DISABLE_SANDBOX env"
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Available commands:"
echo "  npm run start:dev    - Start development mode (hot reload)"
echo "  npm run build        - Build for production"
echo "  npm test             - Run tests"
echo "  npm run test:src2    - Run src2 migration tests"
echo "  npm run validate:arch - Validate architecture layers"
echo ""
