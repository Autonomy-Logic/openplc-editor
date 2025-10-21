#!/bin/bash
create-dmg --volname "OpenPLC Editor v4" --volicon "./assets/icon.icns" --background "./assets/dmg_background.png" --window-pos 200 120 --window-size 771 395 --icon-size 160 --icon "OpenPLC Editor.app" 200 170 --app-drop-link 580 170 "OpenPLC_Editor_4.0.6-beta.dmg" "./release/build/mac/OpenPLC Editor.app"
create-dmg --volname "OpenPLC Editor v4" --volicon "./assets/icon.icns" --background "./assets/dmg_background.png" --window-pos 200 120 --window-size 771 395 --icon-size 160 --icon "OpenPLC Editor.app" 200 170 --app-drop-link 580 170 "OpenPLC_Editor_4.0.6-beta-ARM.dmg" "./release/build/mac-arm64/OpenPLC Editor.app"

