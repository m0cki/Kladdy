# Kladdy – Download-Seite

Statische Webseite zum Herunterladen der Mac-App **Kladdy**: reines HTML/CSS/JavaScript, kein Build-Schritt,
keine externen Ressourcen (keine Webfonts, kein CDN, keine Statistik, keine Cookies). Sie funktioniert per Doppelklick
auf `index.html` und auf GitHub Pages; alle Pfade sind relativ.

| Datei | Inhalt |
|---|---|
| `index.html` | Startseite: Download, Funktionen, Deine Daten, Installieren, Was ist neu, Fragen |
| `impressum.html`, `datenschutz.html` | Muster mit Platzhaltern (ohne Gewähr, keine Rechtsberatung) |
| `style.css` | Optik wie die App (Tokens, Hell/Dunkel, Aurora, Glas) |
| `seite.js` | Repository-Eintrag (`KONFIG`), Download-Link und „Was ist neu“ aus GitHub, Hell/Dunkel, Galerie |
| `bilder/` | App-Screenshots (WebP, 2560 × 1600, je `-hell` und `-dunkel`) und `logo.svg` (Favicon) |

## Vor dem Veröffentlichen ausfüllen

1. **`seite.js`, ganz oben:** `const KONFIG = { github: 'DEIN-GITHUB-NAME/kladdy' };` → dein Benutzername und
   Repository, z. B. `'maxmuster/kladdy'`. Solange dort `DEIN-GITHUB-NAME` steht, läuft die Seite im **Beispielmodus**
   (Download-Knopf springt zur Anleitung, „Was ist neu“ zeigt ein Beispiel, unter dem Knopf steht ein Hinweis).
2. **`impressum.html`:** Name, optional Name des Gewerbes, Anschrift, E-Mail, optional Telefon. Hast du eine
   Umsatzsteuer-Identifikationsnummer, musst du sie angeben (Absatz „Umsatzsteuer“ anpassen).
3. **`datenschutz.html`:** Verantwortlicher (Name, Anschrift, E-Mail), optional die zuständige Aufsichtsbehörde,
   „Stand“ prüfen.
4. Platzhalter stehen in eckigen Klammern und sind gelb markiert (`<span class="platzhalter">[…]</span>`). Text
   ersetzen **und** die `span`-Hülle entfernen. Solange noch einer da ist, zeigt die Seite oben einen gelben Balken;
   auf GitHub Pages erscheint zusätzlich im Footer der Startseite ein Hinweis.
5. **Angaben prüfen:** Mindestversion „macOS 14“ (in `index.html` und in `seite.js`) muss zur
   `minimumSystemVersion` der App passen. „Kostet das etwas? – Nein“ in den Fragen nur stehen lassen, wenn es stimmt.

## Veröffentlichen mit GitHub Pages

**Variante A – im Repository der App** (empfohlen; das Repository ist für die Releases ohnehin öffentlich):

1. Den Inhalt dieses Ordners als `docs/` ins Repository legen (`docs/index.html`, `docs/style.css`, …), committen, pushen.
2. Auf GitHub: **Settings → Pages → Build and deployment → Source: „Deploy from a branch“**, Branch `main`,
   Ordner `/docs`, **Save**.
3. Nach ein bis zwei Minuten ist die Seite unter `https://<name>.github.io/kladdy/` erreichbar.

**Variante B – eigenes Repository `<name>.github.io`:** Dateien ins Hauptverzeichnis legen, unter
**Settings → Pages** Branch `main` und Ordner `/ (root)` wählen. Adresse: `https://<name>.github.io/`.

## Wie der Download-Knopf funktioniert

- Ohne Antwort von GitHub (offline, Zeitüberschreitung nach 5 s, Limit der GitHub-API von 60 Abrufen pro Stunde
  und IP-Adresse) zeigt der Knopf auf `https://github.com/<name>/kladdy/releases/latest` – das funktioniert immer.
- Mit Antwort nimmt die Seite das neueste Release, das weder Entwurf noch Vorabversion ist, und verlinkt direkt auf die
  `.dmg` (bevorzugt eine Datei mit `universal` im Namen, sonst `aarch64`). Unter dem Knopf erscheinen Version, Datum
  und Größe; bei `universal` zusätzlich „auch für Intel-Macs“.
- „Was ist neu“ zeigt die letzten drei Releases mit ihrem Text. Verstanden werden `### Überschriften`, `- Listen`,
  Absätze, `**fett**` und `` `code` `` – alles andere erscheint als normaler Text (kein HTML aus GitHub).

## Lokal ansehen und testen

- `index.html` doppelklicken. Mit `index.html?darstellung=hell` bzw. `?darstellung=dunkel` lässt sich die Darstellung
  erzwingen, ohne etwas zu speichern.
- Der Umschalter im Kopf speichert die Wahl im `localStorage` (Eintrag `kladdy-darstellung`) – nur nach einem Klick,
  kein Cookie. Entspricht die Wahl wieder der Systemeinstellung, wird der Eintrag gelöscht.

## Screenshots erneuern

Die Bilder stammen aus dem klickbaren Prototyp (headless Edge, Fenster 1280 × 800, doppelte Pixeldichte, Parameter
`?motion=off&mode=light|dark`). Dateinamen beibehalten: `ein-ausgaenge`, `beleg-erkennen`, `termine`, `rechnung`,
`auswertung`, jeweils `-hell.webp` und `-dunkel.webp`.
