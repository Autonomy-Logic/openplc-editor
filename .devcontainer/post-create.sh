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

# Fix ownership of volume-mounted node_modules (Docker creates volumes as root)
echo "[2/5] Fixing node_modules permissions..."
sudo chown -R dev:dev node_modules 2>/dev/null || true

# Remove stale src/node_modules symlink (broken symlinks cause EEXIST in link-modules.ts)
rm -f src/node_modules 2>/dev/null || true

# Install root dependencies (downloads binaries, builds DLL)
echo "[3/5] Installing dependencies..."
npm install

# Install release/app dependencies and rebuild native modules for Electron
echo "[4/5] Installing release/app dependencies..."
cd release/app && npm install && cd ../..

# Verify binaries and Electron sandbox
echo "[5/5] Verifying setup..."

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

# Fix Electron sandbox for container (chrome-sandbox needs SUID root + mode 4755)
CHROME_SANDBOX="node_modules/electron/dist/chrome-sandbox"
if [ -f "$CHROME_SANDBOX" ]; then
  sudo chown root:root "$CHROME_SANDBOX"
  sudo chmod 4755 "$CHROME_SANDBOX"
  echo "  Electron sandbox: SUID bit set on chrome-sandbox"
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
