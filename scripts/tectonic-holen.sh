#!/bin/bash
# Tectonic als mitgeliefertes Sidecar holen (ANLEITUNG §3.1 „Tectonic finden“, §3.2 „Tectonic mitliefern“).
#
#   npm run tectonic          (läuft automatisch vor `tauri dev` und `tauri build`)
#
# Lädt das offizielle, eigenständige Release von github.com/tectonic-typesetting/tectonic (nur System-Bibliotheken,
# mit `otool -L` geprüft), vergleicht die SHA-256 des Archivs mit dem festen Wert unten und legt das Programm unter
# src-tauri/binaries/tectonic-<target-triple> ab (Namensschema von Tauri für `bundle.externalBin`). Tauri kopiert es
# beim Bauen als `tectonic` neben die App-Datei (target/debug bzw. Kladdy.app/Contents/MacOS).
# Liegt die Datei schon mit der richtigen Prüfsumme da, passiert nichts. Die Datei ist nicht im Repository (.gitignore).
#
# Ziel: TAURI_ENV_TARGET_TRIPLE (setzt die Tauri-CLI) oder erstes Argument, sonst der Prozessor dieses Macs.
# Neue Version: VERSION und die Prüfsummen (Archiv und entpacktes Programm) anpassen, vorher selbst nachrechnen.

set -euo pipefail

VERSION="0.17.0"

fehler() { printf 'tectonic-holen: %s\n' "$1" >&2; exit 1; }

ZIEL_TRIPLE="${1:-${TAURI_ENV_TARGET_TRIPLE:-}}"
if [ -z "$ZIEL_TRIPLE" ]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) ZIEL_TRIPLE="aarch64-apple-darwin" ;;
    Darwin-x86_64) ZIEL_TRIPLE="x86_64-apple-darwin" ;;
    *) fehler "Kladdy wird nur für macOS gebaut (hier: $(uname -s) $(uname -m))." ;;
  esac
fi

# SHA-256 von Archiv und entpacktem Programm (selbst nachgerechnet, Archiv-Werte = Digest auf GitHub)
case "$ZIEL_TRIPLE" in
  aarch64-apple-darwin)
    ARCHIV_SHA="a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667"
    PROGRAMM_SHA="b52b5a730e2b0b33087304f7720f649603953f270a6b1c88bb031e1ae01f7f9c" ;;
  x86_64-apple-darwin)
    ARCHIV_SHA="7c90ef5b6ddb1eb1937e4337add5237b79338e4b9676459fa91187d24d6cdf80"
    PROGRAMM_SHA="0d888b4cb5607830f33e4ede37e613c1d0b9251644c209ce78ae807c976637e4" ;;
  *) fehler "Für $ZIEL_TRIPLE ist kein Tectonic hinterlegt." ;;
esac

ORDNER="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/binaries"
ZIEL="$ORDNER/tectonic-$ZIEL_TRIPLE"

sha() { shasum -a 256 "$1" | cut -d ' ' -f 1; }

if [ -f "$ZIEL" ] && [ "$(sha "$ZIEL")" = "$PROGRAMM_SHA" ]; then
  [ -x "$ZIEL" ] || chmod 755 "$ZIEL"
  exit 0
fi

ARCHIV="tectonic-$VERSION-$ZIEL_TRIPLE.tar.gz"
URL="https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40$VERSION/$ARCHIV"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT

printf 'Lade Tectonic %s (%s) …\n' "$VERSION" "$ZIEL_TRIPLE"
curl -fsSL --retry 3 -o "$TEMP/$ARCHIV" "$URL" || fehler "Download fehlgeschlagen: $URL"
[ "$(sha "$TEMP/$ARCHIV")" = "$ARCHIV_SHA" ] || fehler "Prüfsumme von $ARCHIV stimmt nicht. Nichts abgelegt."

mkdir "$TEMP/x"
tar -xzf "$TEMP/$ARCHIV" -C "$TEMP/x" tectonic || fehler "$ARCHIV enthält kein Programm „tectonic“."
[ "$(sha "$TEMP/x/tectonic")" = "$PROGRAMM_SHA" ] || fehler "Prüfsumme des entpackten Programms stimmt nicht."

mkdir -p "$ORDNER"
chmod 755 "$TEMP/x/tectonic"
mv -f "$TEMP/x/tectonic" "$ZIEL"
printf 'Tectonic %s liegt in %s\n' "$VERSION" "$ZIEL"
