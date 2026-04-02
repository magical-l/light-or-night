#!/bin/bash
# Build ZIP for Chrome Web Store / Firefox Add-ons
set -e

DIST="dont-paint-it-black-v1.0.0.zip"
rm -f "$DIST"

zip -r "$DIST" \
  manifest.json \
  content.js \
  popup.html \
  popup.js \
  LICENSE \
  icons/icon16.png \
  icons/icon48.png \
  icons/icon128.png \
  -x ".*"

echo "Built: $DIST ($(du -h "$DIST" | cut -f1))"
