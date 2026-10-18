#!/bin/bash
# Kladdy – Installation per Terminal
#
#   curl -fsSL https://raw.githubusercontent.com/m0cki/Kladdy/main/scripts/installieren.sh | bash
#
# Lädt die .dmg des neuesten Releases von GitHub, kopiert Kladdy.app nach /Applications und startet die App.
# Mit curl geladene Dateien bekommen keine Quarantäne-Markierung, darum entfällt „Dennoch öffnen“.
# Deine Daten (Datenbank, Belege) liegen nicht in der App und bleiben bei einer Neuinstallation erhalten.
# Anderer Zielordner: KLADDY_ZIEL=~/Applications bash installieren.sh

set -euo pipefail

REPO="m0cki/Kladdy"
ZIEL_ORDNER="${KLADDY_ZIEL:-/Applications}"
ZIEL="$ZIEL_ORDNER/Kladdy.app"

fehler() { printf 'Fehler: %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fehler "Kladdy gibt es nur für macOS."
[ "$(uname -m)" = "arm64" ] || fehler "Kladdy braucht einen Mac mit Apple-Chip (M1 oder neuer)."
MACOS="$(sw_vers -productVersion)"
[ "${MACOS%%.*}" -ge 14 ] || fehler "Kladdy braucht macOS 14 oder neuer (installiert: $MACOS)."

if [ -d "$ZIEL" ] && pgrep -xq Kladdy; then
  fehler "Kladdy läuft gerade. Bitte zuerst beenden (⌘Q) und den Befehl erneut ausführen."
fi

# Neuestes Release (ohne Vorabversionen) über die Weiterleitung von /releases/latest ermitteln
LETZTES="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")"
TAG="${LETZTES##*/tag/}"
[ "$TAG" != "$LETZTES" ] || fehler "Kein Release auf github.com/$REPO gefunden."
VERSION="${TAG#v}"
DATEI="Kladdy_${VERSION}_aarch64.dmg"

ARBEIT="$(mktemp -d)"
MOUNT="$ARBEIT/volume"
aufraeumen() {
  hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  rm -rf "$ARBEIT"
}
trap aufraeumen EXIT

printf 'Lade Kladdy %s …\n' "$VERSION"
curl -fL --progress-bar -o "$ARBEIT/$DATEI" "https://github.com/$REPO/releases/download/$TAG/$DATEI"

hdiutil attach "$ARBEIT/$DATEI" -nobrowse -readonly -quiet -mountpoint "$MOUNT"
[ -d "$MOUNT/Kladdy.app" ] || fehler "Kladdy.app nicht in $DATEI gefunden."
codesign --verify --deep --strict "$MOUNT/Kladdy.app" || fehler "Signaturprüfung von Kladdy.app fehlgeschlagen."

mkdir -p "$ZIEL_ORDNER"
SUDO=""
[ -w "$ZIEL_ORDNER" ] || SUDO="sudo"
[ -z "$SUDO" ] || printf 'Für %s wird dein Passwort benötigt.\n' "$ZIEL_ORDNER"
$SUDO rm -rf "$ZIEL"
$SUDO ditto "$MOUNT/Kladdy.app" "$ZIEL"

printf 'Kladdy %s ist installiert: %s\n' "$VERSION" "$ZIEL"
open "$ZIEL"
