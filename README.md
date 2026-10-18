# Kladdy

Buchhaltung für Kleingewerbe auf dem Mac: Ein- & Ausgänge, Termine, Rechnungen & Quittungen, Kunden und Auswertung.
Alle Daten bleiben lokal auf deinem Mac.

Voraussetzungen: Mac mit Apple-Chip (M1 oder neuer), macOS 14 Sonoma oder neuer.

## Installieren

Im Terminal ausführen:

```sh
curl -fsSL https://raw.githubusercontent.com/m0cki/Kladdy/main/scripts/installieren.sh | bash
```

Der Befehl lädt die `.dmg` des neuesten [Releases](https://github.com/m0cki/Kladdy/releases/latest), prüft die
Signatur, kopiert `Kladdy.app` nach `/Applications` und startet die App. Weil die Datei per Terminal geladen wird,
fragt macOS nicht nach einer Freigabe. Wer das Skript vorher lesen will:
[`scripts/installieren.sh`](scripts/installieren.sh).

Derselbe Befehl installiert eine neuere Version über eine vorhandene. Deine Daten liegen nicht in der App und
bleiben dabei erhalten.

**Ohne Terminal:** Die `.dmg` aus den [Releases](https://github.com/m0cki/Kladdy/releases/latest) laden, Kladdy in
den Programme-Ordner ziehen und einmal öffnen. macOS blockiert den ersten Start, weil die App nicht von Apple
notarisiert ist. Dann **Systemeinstellungen → Datenschutz & Sicherheit → „Dennoch öffnen“** wählen und mit dem
Passwort bestätigen.

## Updates

Kladdy prüft beim Start auf neue Versionen und installiert sie auf Wunsch selbst.

## Lizenz

[MIT](LICENSE)
