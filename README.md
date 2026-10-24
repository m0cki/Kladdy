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

### Ohne Terminal

1. [Kladdy.dmg](https://github.com/m0cki/Kladdy/releases/latest/download/Kladdy.dmg) laden (immer die neueste
   Version).
2. Die geladene `Kladdy.dmg` doppelklicken. Im Fenster, das sich öffnet, **Kladdy** auf den Ordner **Programme**
   ziehen.
3. Das Fenster schließen und das Laufwerk „Kladdy“ im Finder auswerfen (⏏).
4. Kladdy im Programme-Ordner (oder über Launchpad/Spotlight) doppelklicken. macOS blockiert diesen ersten Start,
   weil die App nicht von Apple notarisiert ist, und zeigt die Meldung „Kladdy“ wurde nicht geöffnet. Mit
   **Fertig** schließen, **nicht** „In den Papierkorb legen“ wählen.
5. **Systemeinstellungen** öffnen (Apple-Menü oben links → Systemeinstellungen …) und links **Datenschutz &
   Sicherheit** wählen.
6. Rechts nach unten bis zum Abschnitt **Sicherheit** scrollen. Dort steht ein Hinweis, dass „Kladdy“ blockiert
   wurde. Daneben auf **Dennoch öffnen** klicken.
7. Im folgenden Dialog erneut **Dennoch öffnen** wählen und mit Passwort oder Touch ID bestätigen.

Kladdy startet. Die Freigabe ist nur einmal nötig, danach öffnet sich die App normal. Der Hinweis in Schritt 6
erscheint nur kurz nach dem Startversuch; fehlt er, Schritt 4 wiederholen.

Unter macOS 14 Sonoma geht es auch kürzer: Kladdy im Programme-Ordner mit **Rechtsklick → Öffnen** starten und im
Dialog **Öffnen** wählen. Ab macOS 15 Sequoia ist nur noch der Weg über die Systemeinstellungen möglich.

## Updates

Kladdy prüft beim Start auf neue Versionen und installiert sie auf Wunsch selbst.

## Lizenz

[MIT](LICENSE)
