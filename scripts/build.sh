#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
TEMP="$DIST/_build"

rm -rf "$DIST"
mkdir -p "$TEMP"

cp "$ROOT/manifest.json" "$TEMP/"
cp -r "$ROOT/src" "$TEMP/src"

cd "$TEMP"
zip -r "$DIST/local-totp-autofill.zip" .

rm -rf "$TEMP"

echo "✓ dist/local-totp-autofill.zip"
