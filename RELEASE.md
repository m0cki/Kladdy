# Releases & Updates

Kladdy wird ohne App Store verteilt: als `.dmg` über **GitHub Releases**. Die App sucht dort selbst nach Updates
(ANLEITUNG §3.2). Ein Release entsteht **nur von Hand** über den Workflow „Release“ – Pull Requests und Pushes auf
`main` laufen nur durch die Prüfungen (`.github/workflows/ci.yml`) und veröffentlichen nichts.

## Einmalig einrichten

### 1. Update-Schlüssel erzeugen

Updates werden mit einem eigenen Schlüsselpaar signiert (unabhängig von Apple, auch ohne Entwicklerkonto Pflicht).

```sh
npm run tauri signer generate -- -w ~/.tauri/kladdy.key
```

Der Befehl fragt nach einem Passwort und legt zwei Dateien an:

- `~/.tauri/kladdy.key` – **privater** Schlüssel. Bleibt geheim: in den Passwort-Manager und zusätzlich sichern.
  Geht er verloren, können bestehende Installationen **keine Updates mehr annehmen**.
- `~/.tauri/kladdy.key.pub` – **öffentlicher** Schlüssel. Der kommt in die App.

**Der private Schlüssel kommt nie ins Repository** (auch nicht als `.env`). `.gitignore` schließt `*.key` und `.env*` aus.

### 2. Öffentlichen Schlüssel eintragen

In `src-tauri/tauri.conf.json` steht unter `plugins.updater.pubkey` vorerst der Platzhalter
`KLADDY_UPDATER_PUBKEY_PLATZHALTER__SIEHE_RELEASE_MD`. Ersetzen durch den **kompletten Inhalt** von
`~/.tauri/kladdy.key.pub` (eine lange Base64-Zeile) und committen:

```json
"plugins": {
  "updater": {
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IC4uLg==",
    "endpoints": ["https://github.com/m0cki/Kladdy/releases/latest/download/latest.json"]
  }
}
```

Warum der Platzhalter nichts kaputt macht: Das Updater-Plugin liest den Schlüssel erst, wenn ein heruntergeladenes
Update geprüft wird. `npm run tauri dev`, die CI und `tauri build --no-bundle` laufen deshalb auch mit Platzhalter.
Ein echtes Update würde mit Platzhalter an der Signaturprüfung scheitern – darum bricht der Release-Workflow vorher
mit einer klaren Meldung ab, solange der Platzhalter drinsteht.

### 3. Secrets bei GitHub hinterlegen

Repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Inhalt |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | kompletter Inhalt von `~/.tauri/kladdy.key` (z. B. `pbcopy < ~/.tauri/kladdy.key`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | das Passwort aus Schritt 1 (leer lassen bzw. weglassen, wenn keins vergeben wurde) |

`GITHUB_TOKEN` stellt GitHub selbst bereit. Fehlt `TAURI_SIGNING_PRIVATE_KEY`, bricht der Workflow sofort ab.

### 4. Repository-Einstellungen

- Das Repository muss **öffentlich** sein, damit die App `latest.json` und das Update ohne Anmeldung laden kann
  (der Code enthält keine Nutzerdaten – die bleiben auf dem Mac).
- Settings → Actions → General → Workflow permissions: „Read and write permissions“ ist **nicht** nötig; der
  Release-Job fordert `contents: write` selbst an.
- Ruleset für `main` (Settings → Rules → Rulesets): Änderungen nur per Pull Request (0 Freigaben, eigene PRs
  dürfen gemergt werden), Pflicht-Checks `Detect changes`, `Frontend (Linux)` und `Rust (macOS)`, kein Force-Push,
  kein Löschen. Die Checks laufen deshalb bei **jedem** PR, auch bei reinen Doku-Änderungen. Der Release-Workflow
  pusht nichts nach `main`, nur den Tag; eine Ausnahme im Ruleset ist nicht nötig.

## Ein Release erstellen

GitHub → **Actions → Release → Run workflow** (Branch: `main`). Eingaben:

| Eingabe | Bedeutung |
|---|---|
| `bump` | Wie die Versionsnummer steigt (SemVer): **patch** `1.2.3 → 1.2.4` für Fehlerbehebungen, **minor** `1.2.3 → 1.3.0` für neue Funktionen, **major** `1.2.3 → 2.0.0` für große Umbrüche (z. B. inkompatible Datensicherungen). Standard: patch. |
| `prerelease` | Markiert das Release als **Vorabversion (Beta)**. Es ist auf der Release-Seite zum Testen herunterladbar, wird aber **nicht** als Update verteilt: Die App fragt `releases/latest/…` ab, und GitHub zählt Vorabversionen nicht als „latest“. |
| `notes` | „Was ist neu?“ – erscheint auf der Release-Seite und in der App beim Update-Hinweis. Leer lassen = automatisch erzeugt (GitHub-Release-Notes seit dem letzten Tag, notfalls die Commit-Liste). |

Was der Workflow (`.github/workflows/release.yml`) tut:

1. **Vorprüfung:** läuft nur von `main`, Secret `TAURI_SIGNING_PRIVATE_KEY` vorhanden, `pubkey` kein Platzhalter, und
   **die CI für diesen `main`-Commit ist grün**. Die Prüfungen (`ci.yml`) laufen bei jedem Push auf `main` ohnehin:
   Versionen gleich, Typecheck, Vitest und Frontend-Build auf Linux; `cargo fmt`, `clippy` und `cargo test` auf macOS,
   aber nur wenn sich `src-tauri/` geändert hat (Mac-Runner warten oft lange; ein übersprungener Job zählt als grün);
   der Release-Workflow wiederholt sie nicht, sondern fragt ihr Ergebnis ab. Laufen die Checks noch oder sind sie rot,
   bricht er ab, ohne etwas zu veröffentlichen. Reine Doku-Änderungen auf `main` (`*.md`, `referenz/`, `docs/`,
   `LICENSE`) lösen keinen Lauf aus, für sie zählt der Vorgänger-Commit. Der Build in Schritt 4 kompiliert die App
   ohnehin noch einmal.
2. **Version erhöhen:** Ausgangspunkt ist die höhere von zwei Versionen: die in den Versionsdateien auf `main` und die
   des höchsten Tags `vX.Y.Z`. `node scripts/version.mjs bump <bump>` schreibt dann dieselbe neue Version in
   `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` und `src-tauri/Cargo.lock`.
   Existiert der Tag schon, bricht der Workflow ab.
3. **Commit „Release vX.Y.Z“** direkt auf dem geprüften `main`-Commit (`github.sha`) und Tag `vX.Y.Z`; gepusht wird
   **nur der Tag**. `main` ist per Ruleset geschützt, deshalb landet der Release-Commit nicht dort, und die
   Versionsdateien auf `main` bleiben auf dem alten Stand (in Entwicklungs-Builds zeigt die App diese Version). Die
   veröffentlichte Version steht im Tag. Für einen Sprung, den `bump` nicht abbildet, per PR auf `main`
   `node scripts/version.mjs set X.Y.Z` setzen; ist sie höher als der letzte Tag, zählt sie als Ausgangspunkt.
4. **Bauen & veröffentlichen** mit `tauri-apps/tauri-action@v1` für `aarch64-apple-darwin` (Apple Silicon), signiert mit
   dem Update-Schlüssel. Das Release enthält:
   - `Kladdy_X.Y.Z_aarch64.dmg` – zum Herunterladen und Installieren,
   - `Kladdy_X.Y.Z_aarch64.app.tar.gz` + `.sig` – das Update-Paket mit Signatur
     (seit tauri-action v1 steht die Version im Dateinamen),
   - `latest.json` – die Versionsdatei, die die App abfragt.

Versionen lokal prüfen: `npm run version:check`. Von Hand setzen (nur im Notfall): `node scripts/version.mjs set X.Y.Z`.

### Wenn etwas schiefgeht

- **Abbruch vor Schritt 3:** nichts ist passiert, Fehler beheben und neu starten.
- **Abbruch in Schritt 4** (der Tag ist schon gepusht, das Release fehlt oder ist unvollständig): Den Fehler
  beheben und ein neues Release starten (empfohlen; es bekommt die nächste Nummer, Versionsnummern werden nie
  wiederverwendet). „Re-run failed jobs“ hilft nicht: Er baut wieder vom alten Commit, kommt auf dieselbe Nummer und
  bricht ab, weil der Tag schon existiert. Nur wenn noch niemand die Version bekommen hat, darf man stattdessen das
  unvollständige Release und den Tag auf GitHub löschen und neu starten.

## In der App

- Beim Start sucht Kladdy höchstens **einmal täglich** nach Updates (abschaltbar unter ⚙ → Updates & Über Kladdy →
  „Automatisch nach Updates suchen“), von Hand über das Menü „Ablage → Nach Updates suchen …“ oder den Knopf in den
  Einstellungen.
- Gibt es eine neue Version: Hinweis „Version X ist da“ mit „Was ist neu?“ und „Jetzt aktualisieren“ → Download mit
  Fortschritt → Neustart. Ab Phase 5 legt die App vorher automatisch eine Datensicherung an.
  Geplant (ANLEITUNG §3.2 Punkt 5): Laden und Neustart trennen („Jetzt neu starten“ / „Später“ ⇒ beim nächsten
  Start aktiv).
- **Nie in der Dev-App (`npm run tauri dev`) auf „Jetzt aktualisieren“ klicken**, solange das noch nicht gesperrt ist:
  Der Updater ersetzt dann `src-tauri/target/debug` durch die Release-App und die Dev-App startet nicht mehr neu.
  Behebung: `rm -rf src-tauri/target/debug` und `npm run tauri dev` neu starten (baut alles neu, Daten bleiben).
- Ins Internet geht die App dafür nur mit einer Anfrage an `latest.json` bei GitHub.

## Erster Start auf einem anderen Mac („Dennoch öffnen“)

Kladdy ist nur **ad-hoc signiert** (`bundle.macOS.signingIdentity: "-"`, kein Apple-Entwicklerkonto). Beim ersten
Start blockiert macOS die App deshalb einmal:

1. `.dmg` öffnen, Kladdy in „Programme“ ziehen, Kladdy starten → Meldung, dass die App nicht geöffnet werden kann.
2. **Systemeinstellungen → Datenschutz & Sicherheit**, nach unten scrollen → bei „Kladdy“ auf **„Dennoch öffnen“**
   klicken und mit dem Passwort bestätigen. (Rechtsklick → Öffnen reicht seit macOS 15 nicht mehr.)
3. Danach startet Kladdy normal. Nach dem ersten Update einmal prüfen, dass die App ohne erneute Freigabe startet.

Gatekeeper nie komplett abschalten (`spctl --master-disable`). `xattr -dr com.apple.quarantine` nur als Notlösung für
die eigene App.

Mit Apple Developer Program (99 $/Jahr) ließe sich die App zusätzlich notarisieren; dann entfällt der Schritt
(ANLEITUNG §3.2, Secrets `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`).
