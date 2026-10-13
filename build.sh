#!/bin/bash
# Build ZIP for Chrome Web Store / Firefox Add-ons
set -e

FILES=(
  manifest.json
  content.js
  popup.html
  popup.js
  _locales/en/messages.json
  _locales/zh_CN/messages.json
  LICENSE
  icons/icon16.png
  icons/icon48.png
  icons/icon128.png
)

# 版本号取自 manifest，避免 zip 名字和包内容对不上
VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' manifest.json | head -1)
DIST="light-or-night-v${VERSION}.zip"
rm -f "$DIST"

# Git Bash 不带 zip，Windows 上退到 7-Zip
if command -v zip >/dev/null 2>&1; then
  zip -r "$DIST" "${FILES[@]}" -x ".*"
elif command -v 7z >/dev/null 2>&1; then
  7z a -tzip "$DIST" "${FILES[@]}" >/dev/null
elif [ -x "/c/Program Files/7-Zip/7z.exe" ]; then
  "/c/Program Files/7-Zip/7z.exe" a -tzip "$DIST" "${FILES[@]}" >/dev/null
else
  echo "需要 zip 或 7z（本机可装 7-Zip，或用 PowerShell Compress-Archive）" >&2
  exit 1
fi

echo "Built: $DIST ($(du -h "$DIST" | cut -f1))"
