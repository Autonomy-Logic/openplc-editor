#!/bin/bash

# Script to create branded DMG files for macOS distribution
# Usage: ./create_dmg.sh [version]
# If version is not provided, it will be read from package.json

set -e

# Get version from argument or package.json
if [ -n "$1" ]; then
    VERSION="$1"
else
    VERSION=$(node -p "require('./package.json').version")
fi

echo "Creating DMG files for version $VERSION..."

# Check if create-dmg is installed
if ! command -v create-dmg &> /dev/null; then
    echo "Error: create-dmg is not installed."
    echo "Install it with: brew install create-dmg"
    exit 1
fi

DMG_CREATED=0

# Create Intel (x64) DMG
if [ -d "./release/build/mac/OpenPLC Editor.app" ]; then
    echo "Creating Intel (x64) DMG..."
    if create-dmg \
        --volname "OpenPLC Editor v${VERSION%%.*}" \
        --volicon "./assets/icon.icns" \
        --background "./assets/dmg_background.png" \
        --window-pos 200 120 \
        --window-size 771 395 \
        --icon-size 160 \
        --icon "OpenPLC Editor.app" 200 170 \
        --app-drop-link 580 170 \
        "OpenPLC_Editor_${VERSION}.dmg" \
        "./release/build/mac/OpenPLC Editor.app"; then
        echo "Created OpenPLC_Editor_${VERSION}.dmg"
        DMG_CREATED=$((DMG_CREATED + 1))
    else
        echo "Error: Failed to create Intel (x64) DMG"
        exit 1
    fi
else
    echo "Warning: Intel (x64) app not found at ./release/build/mac/OpenPLC Editor.app"
fi

# Create Apple Silicon (ARM64) DMG
if [ -d "./release/build/mac-arm64/OpenPLC Editor.app" ]; then
    echo "Creating Apple Silicon (ARM64) DMG..."
    if create-dmg \
        --volname "OpenPLC Editor v${VERSION%%.*}" \
        --volicon "./assets/icon.icns" \
        --background "./assets/dmg_background.png" \
        --window-pos 200 120 \
        --window-size 771 395 \
        --icon-size 160 \
        --icon "OpenPLC Editor.app" 200 170 \
        --app-drop-link 580 170 \
        "OpenPLC_Editor_${VERSION}-ARM.dmg" \
        "./release/build/mac-arm64/OpenPLC Editor.app"; then
        echo "Created OpenPLC_Editor_${VERSION}-ARM.dmg"
        DMG_CREATED=$((DMG_CREATED + 1))
    else
        echo "Error: Failed to create ARM64 DMG"
        exit 1
    fi
else
    echo "Warning: ARM64 app not found at ./release/build/mac-arm64/OpenPLC Editor.app"
fi

if [ $DMG_CREATED -eq 0 ]; then
    echo "Error: No DMG files were created"
    exit 1
fi

echo "DMG creation complete! Created $DMG_CREATED DMG file(s)."
