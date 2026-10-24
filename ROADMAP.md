# Kladdy – Roadmap & Qualitätsbericht

Stand: 23.10.2026 (Branch `roadmap-code-qualitaet`, Basis `main` nach PR #28). Grundlage ist eine vollständige
Durchsicht von `src/`, `src-tauri/`, Migrationen, CI und Skripten – gelesen, nicht ausgeführt (auf diesem Rechner gibt
es keinen Node/Rust-Werkzeugkasten; die Prüfung läuft über die CI).

Das Dokument hat zwei Aufgaben: **(1)** festhalten, was fachlich noch fehlt (Phasen 4–6 aus `ANLEITUNG.md` §10 plus
Reste aus 1–3) und **(2)** die Punkte aus der Code- und Sicherheitsdurchsicht so aufschreiben, dass daraus direkt
GitHub-Issues werden können. Jeder Punkt mit **I-Nummer** ist ein fertiger Issue-Text (Titel, Problem, Vorschlag,
Abnahme). Kleinigkeiten, die sich ohne Risiko erledigen ließen, sind bereits in diesem Branch umgesetzt (Abschnitt 1).

Legende: **Prio** A (bald, Risiko oder Nutzer sichtbar) · B (nächste Wochen) · C (gelegentlich) ·
**Größe** S (< ½ Tag) · M (1–2 Tage) · L (mehr). **Label-Vorschlag** in Klammern.

---

## Inhalt

0. [Gesamtbild](#0-gesamtbild)
1. [In diesem Branch erledigt](#1-in-diesem-branch-erledigt)
2. [Sicherheit](#2-sicherheit)
3. [GoBD & Korrektheit (Rust)](#3-gobd--korrektheit-rust)
4. [Code-Qualität Rust](#4-code-qualität-rust)
5. [Code-Qualität TypeScript (lib)](#5-code-qualität-typescript-lib)
6. [Code-Qualität React & CSS](#6-code-qualität-react--css)
7. [Barrierefreiheit](#7-barrierefreiheit)
8. [Tests, Werkzeuge, CI](#8-tests-werkzeuge-ci)
9. [Fachliche Roadmap (Phasen 4–7)](#9-fachliche-roadmap-phasen-47)
10. [Empfohlene Reihenfolge](#10-empfohlene-reihenfolge)
11. [Prüfpunkte für diesen Branch (Mac)](#11-prüfpunkte-für-diesen-branch-mac)

---

## 0. Gesamtbild

**Was gut ist (und so bleiben soll):**

- Geld konsequent in Integer-Cent, Datum als `YYYY-MM-DD`, keine `eval`/`new Function`, kein `innerHTML`, kein
  `Math.random` – alle Projektregeln aus `CLAUDE.md` wurden eingehalten.
- Jeder schreibende Rust-Command läuft in **einer** `BEGIN IMMEDIATE`-Transaktion, Nummern werden per Compare-and-Set
  vergeben, Kundendaten beim Ausstellen als Schnappschuss gespeichert, jede Änderung landet im Protokoll.
- Belegablage inhaltsadressiert (SHA-256), schreibgeschützt, Pfade gegen `..`/Symlinks geprüft; Tectonic ohne Shell,
  mit `--untrusted` und Zeitlimit; `link_oeffnen` mit fester Präfix-Whitelist.
- Jedes Rust-Modul hat `#[cfg(test)]`, die Kernlogik in `src/lib` ist mit Vitest abgedeckt (≈ 60 Testdateien).
- CI prüft Typen, Tests, Build, `cargo fmt`, `clippy -D warnings`, `cargo test`; Release nur von Hand und nur bei
  grüner CI.

**Die drei größten Baustellen:**

1. **Vertrauensgrenze Webview ↔ Rust.** Die Webview ist voll vertrauenswürdig (`csp: null`, `sql:allow-execute`,
   Rust liest jeden absoluten Pfad, den das Frontend nennt) – und dieselbe Webview parst fremde PDFs mit pdf.js.
   Ein pdf.js-Fehler in einem bösartigen Beleg wäre damit ein voller lokaler Zugriff. → Abschnitt 2.
2. **Dateien, die zu groß geworden sind.** `rechnungen.rs` (2 900 Zeilen), `BelegEditor.tsx` (1 700),
   `ErfassenSchublade.tsx` (1 300) und ein halbes Dutzend Dateien über 800 Zeilen. Dazu fünf eigene Popover-Menüs,
   vier Lade-Gerüste, drei Datums-Helfer-Sammlungen. → Abschnitte 4–6.
3. **Fehlende Werkzeuge.** Kein ESLint/Prettier (obwohl `eslint-disable`-Kommentare im Code stehen), kein
   Dead-Code-Check, keine Abhängigkeits-Überwachung, kein Logging im Release-Build. → Abschnitt 8.

---

## 1. In diesem Branch erledigt

Kleine, risikoarme Dinge, die kein eigenes Issue mehr brauchen:

| Was | Wo | Warum |
|---|---|---|
| **Migration 0009:** Trigger schützen `protokoll` (nie löschen; nur `alt_json`/`neu_json` änderbar – für die spätere Anonymisierung) und `festschreibungen` (nie löschen, nie ändern) | `src-tauri/migrations/0009_protokoll_schutz.sql`, registriert in `datenbank.rs`, Test `trigger_schuetzen_protokoll_und_festschreibungen` | Die Buchungs-Trigger aus 0004 bauen auf `max(bis_datum)` auf; ein `DELETE FROM festschreibungen` hätte alle festgeschriebenen Buchungen wieder änderbar gemacht. Das Protokoll war nicht append-only. |
| Updater: Toast „Sicherung vor dem Update …“ entfernt | `src/lib/updates.ts` | Die Funktion dahinter war leer – der Nutzer bekam eine Sicherung angezeigt, die es nicht gab. Das TODO für Phase 5 steht jetzt an der Stelle, an der die Sicherung hinkommt. |
| Tote Exporte entfernt: `artLabel`, `istErtragsArt`, `ladeTectonicPfad`, `pfadAusWert`, `MAX_BELEG_BYTES` | `src/lib/rechnungen.ts`, `ertrag.ts`, `tectonic.ts`, `belege.ts` | Nirgends referenziert (auch nicht in Tests); `noUnusedLocals` fängt Exporte nicht. |
| Wöchentlicher Abhängigkeits-Audit (`npm audit --audit-level=high`, `cargo audit`) | `.github/workflows/audit.yml` | Läuft montags und von Hand, blockiert keine PRs, legt keine Issues an. Ein roter Lauf heißt: Update einplanen. |
| `.editorconfig` | Repo-Wurzel | Einheitliche Einrückung/Zeilenenden, solange es kein Prettier gibt. |
| `ANLEITUNG.md`: nächste Migration ist `0010` | §10 „Stand“ | |

Bewusst **nicht** hier gemacht (Begründung beim jeweiligen Issue): CSP (I-01, braucht Test am Mac), Trigger auf
`buchungen`-DELETE (I-11, bestehende Tests löschen Buchungen gezielt), Dependabot (I-64, Contributor-Frage).

---

## 2. Sicherheit

### I-01 · Content-Security-Policy setzen (Prio A · S · `sicherheit`)

**Problem:** `src-tauri/tauri.conf.json` → `"security": { "csp": null }`. Ohne CSP darf die Webview beliebige Skripte
und Ressourcen laden. Alle Nutzerwerte werden zwar als React-Textknoten gerendert, aber die Webview parst fremde PDFs
(pdf.js) und hat vollen IPC-Zugriff. Die CSP ist die billigste zweite Verteidigungslinie.

**Vorschlag:**
```json
"csp": "default-src 'self'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob: asset: http://asset.localhost; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost"
```
Dann am Mac prüfen: Schriften (Fontsource, lokal), pdf.js-Worker (`?url`-Import ⇒ `'self'`), Logo-Vorschau (Blob-URLs),
GiroCode-PNG (`data:`), Updater (läuft in Rust, nicht betroffen), Dev-Modus (Vite-HMR braucht `ws://localhost:1421` –
nur in `devCsp` erlauben). `style-src 'unsafe-inline'` ist nötig, weil `Drawer.tsx`/`charts` Inline-Styles setzen; wer das
loswerden will, stellt die `--drawer-w`/`--c`-Variablen über Klassen oder `style`-Attribut mit Nonce um (eigene Aufgabe).

**Abnahme:** App startet ohne CSP-Fehler in der Webview-Konsole; Beleg-Drop mit PDF, Vorlagen-Vorschau mit Logo,
GiroCode, Hell/Dunkel-Wechsel funktionieren; `npm run tauri dev` funktioniert weiter.

### I-02 · Vor dem Kompilieren prüfen, dass der eingestellte Pfad wirklich Tectonic ist (Prio A · S · `sicherheit`)

**Problem:** `einstellungen['tectonic_pfad']` wird vom Frontend per SQL geschrieben (`src/lib/tectonic.ts`) und
`tectonic::pfad_pruefen` prüft nur „absolut, Datei, ausführbar“. `latex::compile_latex` startet dann
`<pfad> -X compile main.tex --untrusted --keep-logs` mit frontend-bestimmtem `main.tex` im Arbeitsordner.
`--untrusted` hilft nur, wenn das Programm Tectonic ist; `/usr/bin/python3 -X compile main.tex` würde `main.tex`
ausführen.

**Vorschlag:** Vor dem ersten Kompilieren je Pfad `tectonic::version()` aufrufen und verlangen, dass die erste Zeile mit
`Tectonic` beginnt (Ergebnis je Pfad + mtime zwischenspeichern). Zusätzlich `tectonic_pfad_pruefen` so erweitern, dass es
dieselbe Prüfung macht, damit die Einstellung gar nicht erst gespeichert wird. Langfristig erledigt sich das mit dem
gebündelten Sidecar (Phase 6).

**Abnahme:** `tectonic_pfad` auf `/bin/ls` ⇒ Fehlermeldung „… ist kein Tectonic“, kein Prozessstart mit `main.tex`;
echter Pfad ⇒ unverändert.

### I-03 · Verbleibende Frontend-Schreibzugriffe nach Rust verlagern, dann `sql:allow-execute` entfernen (Prio B · M · `sicherheit`, `gobd`)

**Problem:** `src-tauri/capabilities/default.json` erlaubt `sql:allow-execute`. Vom Frontend geschrieben werden noch
`einstellungen`, `kategorien`, `steuer_parameter`, `nummernkreise`, `vorlagen` und `protokoll` (15 Aufrufe von
`ausfuehren()` in `src/lib/queries/*`). Jeder dieser Wege ist „Daten-Statement, dann separates Protokoll-INSERT“ ohne
Transaktion (`db.ts` dokumentiert, dass das Plugin keine Transaktion über mehrere Aufrufe kann) – ein Absturz dazwischen
hinterlässt eine Änderung ohne Protokoll. Zudem bleibt roher SQL-Zugriff (z. B. `DROP TRIGGER`) für das Frontend offen.

**Vorschlag:** Rust-Commands `einstellung_schreiben`, `kategorie_anlegen/aendern/archivieren`, `steuer_parameter_schreiben`,
`nummernkreis_muster/zaehler`, `vorlage_speichern/zuruecksetzen` – jeweils Transaktion + Protokoll wie die bestehenden.
Danach `sql:allow-execute` aus den Capabilities streichen (`sql:default` reicht für `select`). Nummernkreis-Trigger
(`naechste` darf nicht sinken, außer `muster` ändert sich) gleich mit.

**Abnahme:** `grep ausfuehren src/lib` liefert nur noch `db.ts`; Capability ohne `allow-execute`; alle Einstellungs-Seiten
funktionieren; Protokoll-Einträge entstehen weiter.

### I-04 · Dateizugriff: nur Pfade annehmen, die der Nutzer gerade gewählt oder fallen gelassen hat (Prio B · M · `sicherheit`)

**Problem:** `beleg_pruefen`, `beleg_anhaengen`, `beleg_pdf_lesen`, `firmenlogo_quelle_lesen`, `beleg_scan_anhaengen`
lesen/hashen/kopieren jeden absoluten Pfad mit erlaubter Endung (PDF ≤ 50 MB, Bilder ≤ 10 MB). Für eine vertrauenswürdige
Webview in Ordnung – zusammen mit I-01 wäre es aber das Werkzeug, um beliebige Dateien des Nutzers auszulesen.

**Vorschlag:** Rust merkt sich in einem `State<Mutex<HashSet<PathBuf>>>` die Pfade aus dem `tauri://drag-drop`-Event
und aus dem Datei-Dialog (Dialog aus Rust öffnen oder das Plugin-Ergebnis in Rust registrieren) und nimmt nur diese an;
nach Verarbeitung austragen. Endungs-/Größen-Whitelist bleibt.

**Abnahme:** `invoke('beleg_pdf_lesen', { pfad: '/etc/hosts.pdf' })` ⇒ Fehler; Drop und ⌘O funktionieren weiter.

### I-05 · Belegablage: vorhandene Zieldatei neu hashen statt vertrauen; Hash vor dem Öffnen prüfen (Prio B · S · `gobd`)

**Problem:** `belege.rs` (`ablegen`): existiert `<sha>.<ext>` schon, wird „gleicher Name = gleicher Inhalt“ angenommen
(`symlink_metadata(..).is_ok()`, trifft auch auf Ordner/hängende Symlinks zu). Ein Test (`belege.rs` ≈ Z. 1010) stellt
sogar sicher, dass eine abweichende Datei behalten wird. `beleg_oeffnen`/`beleg_zeigen` vergleichen nie mit
`belege.sha256` (anders als `firmenlogo::lesen`, das den Hash prüft).

**Vorschlag:** Ziel vorhanden ⇒ `is_file()` verlangen und neu hashen; bei Abweichung Fehler „Belegablage beschädigt:
… – bitte Sicherung prüfen“ statt stillschweigend verknüpfen. In `beleg_datei` vor dem Öffnen Hash prüfen (50 MB sind in
< 1 s gehasht). Den bestehenden Test umdrehen.

### I-06 · Kleine Robustheitspunkte in der Dateibehandlung (Prio C · S · `sicherheit`)

- TOCTOU zwischen Größenprüfung und `fs::read` (`belege.rs` `pdf_lesen`, `firmenlogo.rs` `quelle_lesen`): mit
  `File::open()?.take(MAX + 1)` lesen und abbrechen, wenn mehr als MAX ankam.
- `latex.rs` `ablegen`: Temp-Name `.{name}.tmp` ist nicht eindeutig; zwei gleichzeitige `compile_latex` mit gleichem
  `ablage`-Namen können sich überschreiben ⇒ pid+Zähler wie in `belege.rs` oder `create_new(true)`.
- PDF-Cache `~/Library/Caches/<id>/pdf` sammelt Rechnungen mit Kundendaten und wird nie geleert ⇒ beim Start/Ende
  aufräumen oder unter appDataDir mit klarer Aufbewahrung ablegen.

### I-07 · Installationsskript: Prüfsumme statt nur Ad-hoc-Signatur (Prio C · S · `release`)

**Problem:** `scripts/installieren.sh` prüft `codesign --verify` – bei Ad-hoc-Signatur (`signingIdentity: "-"`)
beweist das nur Unversehrtheit, nicht Herkunft. `curl | bash` von `main` ist dokumentiert und akzeptabel, aber die DMG
sollte gegen einen bekannten Hash geprüft werden.

**Vorschlag:** Release-Workflow legt `Kladdy_<v>_aarch64.dmg.sha256` als Asset ab; das Skript lädt es und prüft mit
`shasum -a 256 -c`. Hinweis im Skript, dass der Updater (minisign-Schlüssel) die eigentliche Herkunftsprüfung ist.
Dauerhafte Lösung bleibt die Notarisierung (Phase 7).

---

## 3. GoBD & Korrektheit (Rust)

### I-10 · Nummernkreis-Jahr nicht aus ungeprüften Frontend-Daten ableiten (Prio A · S · `gobd`)

**Problem:** `rechnungen::ausstellen_in` nutzt das Jahr des Belegdatums, `buchungen` das Jahr von `heute` – beides kommt
vom Frontend. `vergeben_fortlaufend` geht nie zurück: ein Beleg mit Datum 2027-01-05 (Tippfehler) schiebt den Kreis
dauerhaft auf 2027, alle weiteren 2026er Belege bekommen 2027er Nummern.

**Vorschlag:** In `pruefen`/`ausstellen` Datum und `heute` ablehnen, wenn sie mehr als z. B. 7 Tage nach dem
Rust-seitigen UTC-Datum liegen (`datenbank::zeitstempel()`), oder das Nummernjahr serverseitig bestimmen. Test ergänzen.

### I-11 · Trigger-Lücken schließen: Buchungen löschen, Storno-/verknüpfte Buchungen ändern, Beleg-Status (Prio A · M · `gobd`)

**Problem:**
- `0004`: Buchungen außerhalb des festgeschriebenen Zeitraums lassen sich per SQL löschen; Rust löscht nie. Die
  Rust-Regeln „Storno-Zeilen und Buchungen mit `rechnung_id` sind unveränderlich“ haben keinen Trigger.
- `0007`: Bei ausgestellten Belegen sind `status`, `bezahlt_am`, `zahlungsart` frei – `UPDATE rechnungen SET status='entwurf'`
  geht durch; `bezahlt_am` einer Quittung lässt sich auf NULL setzen.
- `0008` `kategorien_typ_fest` prüft nur `buchungen`, nicht `rechnungspositionen.kategorie_id`.

**Vorschlag:** Migration `0010`: `BEFORE DELETE ON buchungen` ⇒ Abbruch (für „Alte Jahre aufräumen“ aus §12 später
gezielt per Migration lockern); `BEFORE UPDATE` abbrechen, wenn `OLD.storno_von_id IS NOT NULL` oder (`OLD.rechnung_id`
gesetzt und mehr als `geaendert_am`/`termin_id` ändert sich); `rechnungen`: `NEW.status <> 'entwurf'` bei
`OLD.nummer IS NOT NULL`, Quittung/Eigenbeleg behalten Status; `kategorien_typ_fest` um `rechnungspositionen` erweitern.
**Achtung:** `datenbank.rs` (≈ Z. 618/649) und `liquiditaet.rs` (≈ Z. 799) löschen Buchungen in Tests – Tests anpassen.

### I-12 · „Doch offen“ setzt den Termin nicht zurück (Prio B · S · `korrektheit`)

**Problem:** `rechnungen::bezahlt(.., termin)` markiert den Termin `erledigt` und verknüpft die Einnahme;
`wieder_offen` bucht nur die Gegenbuchung und setzt den Beleg-Status zurück – der Termin bleibt `erledigt` ohne Beleg
und ohne Einnahme.

**Vorschlag:** In `wieder_offen`: hat die zurückgenommene Buchung eine `termin_id`, Termin auf `geplant` zurücksetzen
(oder dokumentiert anders entscheiden). Test: bezahlt mit Termin → doch offen → Termin-Stand prüfen.

### I-13 · Zahlung verknüpfen: Art und Kunde prüfen (Prio B · S · `korrektheit`)

**Problem:** `zahlung_verknuepfen` (`rechnungen.rs` ≈ Z. 1159) prüft Typ, Storno und `rechnung_id`, aber nicht
`art = 'zahlung'` (eine `afa`/`pauschale`-Zeile mit Typ `ausgabe` kann an einen Eigenbeleg) und nicht, ob `kunde_id`
zum Beleg passt.

### I-14 · Kleine Korrektheitspunkte (Prio C · S · `korrektheit`) – als ein Sammel-Issue

- `i64::abs()` auf Frontend-Werten (`rechnungen.rs` ≈ 298/305, `liquiditaet.rs` ≈ 81): `i64::MIN` panict im Debug,
  wrappt im Release ⇒ `unsigned_abs()` oder Bereichsprüfung wie `termine.rs`.
- Geschützte UPDATEs (`WHERE … AND nummer IS NULL`) prüfen `rows_affected()` nicht ⇒ Protokoll-Eintrag ohne Änderung
  möglich; `nummern.rs` macht es richtig (`== 1` verlangen).
- `storno_schnappschuss` liefert bei JSON-Fehler `None` (Storno ohne Schnappschuss); `zahlung_zuruecknehmen` liefert
  `Ok(None)`, wenn die Buchung verschwindet ⇒ beides `Err`.
- Positionen-Kategorie-UPDATE beim Ausstellen fehlt im Protokoll-Diff.
- `zahlung_buchen` ohne `betrag_cent > 0`-Prüfung; `MAX_CENT` nur in `rechnungen`/`termine`, nicht in `buchungen`;
  Quittung mit verknüpfter Buchung nimmt `e.datum` statt `vorhanden.zahlungsdatum` als `bezahlt_am`.
- `demo.rs` `summe()` rechnet Float statt `rechnungen::position_betrag`.
- Fehlende Indizes: `buchungen.termin_id`, `buchungen.wiederkehrend_id`, `protokoll(tabelle, datensatz_id)`,
  `termine.datum` (in dieselbe Migration wie I-11).

---

## 4. Code-Qualität Rust

### I-20 · Gemeinsame Infrastruktur aus `buchungen.rs` herauslösen (Prio B · M · `refactoring`)

`buchungen.rs` ist de facto das Infrastruktur-Modul: `text_oder_nichts`, `datum_lesen`, `datum_de`, `festgeschrieben_*`,
`kategorie_pruefen`, `zeile_json`, `protokollieren`, `in_transaktion`, `verbindung` werden von `kunden`, `rechnungen`,
`termine`, `liquiditaet`, `demo` importiert. ⇒ `gemeinsam/` (oder `db.rs`, `protokoll.rs`, `datum.rs`, `pruefen.rs`).
Dabei die sechs Kopien der Feld-Diff-Logik (`buchungen` 562, `kunden` 183, `liquiditaet` 358, `termine` 348/615,
`rechnungen::unterschiede` 780) auf **eine** reduzieren, die vier JSON-Zeilen-Zugriffe und die Dubletten
`kunden_nummer`, `MAX_CENT`, `mehrzeilig/getrimmt`, `uhrzeit_ok/uhrzeit_lesen` zusammenführen. Von den zwei generischen
„nur geänderte Spalten“-Updatern (`kunden.rs` 173, `liquiditaet.rs` 347) den typsicheren aus `liquiditaet` behalten.

### I-21 · `rechnungen.rs` (2 933 Zeilen) in ein Modul-Verzeichnis aufteilen (Prio B · L · `refactoring`)

Vorschlag für `src-tauri/src/rechnungen/`: `eingabe.rs` (Typen, `position_betrag`, `pruefen`, `ausstellbar_pruefen`) ·
`anschrift.rs` (`Anschrift`, `Empfaenger`, `kunde_festhalten`; wird auch von `termine` genutzt) · `entwurf.rs` ·
`zahlung.rs` (`zahlung_buchen/_verknuepfen/_zuruecknehmen`) · `ausstellen.rs` (`ausstellen_in` 205 Zeilen ⇒
`zahlung_bestimmen`, `schnappschuss_bauen`, `beleg_festschreiben`) · `status.rs` (`bezahlt`, `wieder_offen`,
`angebot_status`, `umwandeln`) · `storno.rs` · `dateien.rs` (`pdf_ablegen`, `scan_anhaengen`; `verweis_setzen` mit
Enum statt `spalte: &str`) · `mod.rs` (Command-Wrapper). Tests wandern mit. Weitere Kandidaten > 100 Zeilen:
`demo::fuellen` (247), `demo::pruefen` (183), `stornieren_in`, `entwurf_schreiben`.

### I-22 · Datei- und Prozess-Helfer zusammenführen (Prio B · M · `refactoring`)

- `ablage.rs`: inhaltsadressierte Ablage (`belege.rs` 202–264 ≡ `firmenlogo.rs` 123–161: eigener `AtomicU64`, gleiche
  Temp-Namen, gleiche Fehlerbehandlung), `aktiver_ordner`/`app_unterordner`, `dateiendung`.
- `prozess.rs`: Prozess mit Zeitlimit (`tectonic.rs` 103–141 ≡ `latex.rs` 335–410).
- `macos.rs`: **eine** Funktion für `/usr/bin/open` (bisher dreimal: `belege`, `latex`, `kunden`), über
  `spawn_blocking` mit Zeitlimit – `pdf_oeffnen` und `link_oeffnen` sind heute synchrone Commands ohne Timeout.
- Hashen/Kopieren von bis zu 50 MB in `beleg_pruefen`/`ablegen` blockiert den Async-Runtime ⇒ `spawn_blocking`
  (so wie `compile_latex` es schon macht).
- Test-Helfer (`testordner` 5×, `programm()` 2×, `lauf()` 2×) in `datenbank::testhilfe`.

### I-23 · Logging im Release-Build (Prio B · S · `robustheit`)

`eprintln!` ist das einzige Logging; in einer `.app` geht es ins Leere. `aufraeumen` in `belege.rs` schluckt alle
Fehler. ⇒ `log` + `tauri-plugin-log` nach `<appDataDir>/logs/` mit Rotation; Ausgaben ohne Nutzerdaten.
Einstellungen › Daten bekommt „Protokolldatei zeigen“.

### I-24 · Kleinigkeiten Rust (Prio C · S) – Sammel-Issue

`MENU_IDS` in `lib.rs` wird von Hand mit `build_menu` und `src/lib/menu.ts` synchron gehalten ⇒ eine `const`-Tabelle
`(id, text, accelerator)` für beides · `tectonic::mitgeliefert()` liefert immer `None` – als Phase-6-Platzhalter
kennzeichnen · fehlende Doc-Kommentare an `pub(crate)`-Helfern · `#[tauri::command]`-Wrapper (≈ 35, je `verbindung` +
`zeitstempel` + Aufruf) per kleinem Makro, wenn gewünscht · `Cargo.toml`: `overflow-checks = true` im Release erwägen
(Geldbeträge).

---

## 5. Code-Qualität TypeScript (lib)

### I-30 · Ein Datums-Modul statt vier (Prio B · M · `refactoring`)

`utc`/`utcTag` in `kunden.ts`, `liquiditaet.ts`, `termine.ts`, `vorlagen/dokument.ts`; `tageZwischen` in `kunden.ts` und
`dokument.ts`; `pad` 5×; `tageImMonat` 3× (lokal und UTC gemischt); `MONATE`/`WOCHENTAGE` 3×; relativer Tagestext 2×.
Dazu zwei exportierte **`datumKurz` mit verschiedener Ausgabe** (`buchungen.ts` → `TT.MM.JJJJ`, `liquiditaet.ts` →
`TT.MM.`), beide von Komponenten importiert – ein falscher Import ändert still eine Datumsspalte. Cross-Domain-Imports
(`termine` ← `kunden`/`liquiditaet`, `auswertung` ← `kunden`) entstehen nur durch diese Helfer.
⇒ `src/lib/datum.ts` (`utcMs`, `tageZwischen`, `tageImMonat`, `pad`, `datumKurz`, `datumOhneJahr`, `datumLang`,
`datumMitWochentag`, `MONATE`, `WOCHENTAGE`) + `formatZahl` neben `formatBetrag` in `money.ts` (vier identische
`Intl.NumberFormat('de-DE')` in Seiten).

### I-31 · Dubletten und Parallel-Typen zusammenführen (Prio B · S · `refactoring`)

`istZahlungsart` (exportiert in `buchungen.ts`, lokal neu in `rechnungen.ts`), `istGrund`, `istObjekt` (4×), `storage()`
(`store/ui.ts`, `updates.ts`), `betragSuchtext` (3×), `vergleiche`/`heuhaufen`/`STATUS_BADGE`/`ART_NAME` gleichnamig in
`rechnungen.ts` und `kunden.ts`, drei Cent→Eingabe-Formatierer (`betragAlsEingabe`, `preisEingabe`, `betragFeld`),
vier Schreibweisen der Zahlungsweg-Labels. Unions `BelegStatus`/`BelegArt`/`Zahlungsart` existieren mehrfach
(`suche-daten.ts`, `demo-daten.ts`, `queries/einstellungen.ts`) ⇒ aus einer Quelle importieren.

### I-32 · Große lib-Dateien entlang ihrer Abschnitts-Banner teilen (Prio C · M · `refactoring`)

`erkennung/regeln.ts` (969; Banner Datum/Beträge/Nummer/Firma/Geschäft/Kategorie/Positionen/Dateiname sind schon da),
`rechnungen.ts` (839; Liste+Status vs. Formular↔Dokument), `termine.ts` (829; Zustand/Agenda vs. Schublade vs.
Erfassen-Brücke), `kunden.ts` (554).

### I-33 · UI-Aktionsmodule aus `lib/` herausnehmen (Prio C · S · `struktur`)

Zehn `lib/`-Dateien importieren `../store/ui` (`belegablage`, `belegaktionen`, `commands`, `erfassen`,
`kunden-schublade`, `logoablage` – importiert sogar React-Hooks –, `storno`, `termin-aktionen`, `termin-schublade`,
`updates`). Das sind UI-Aktionen, keine Bibliothek, und genau die ungetesteten Module. ⇒ `src/actions/` (oder
`src/features/`), `lib/` bleibt rein und testbar.

### I-34 · Kleinigkeiten TypeScript (Prio C · S) – Sammel-Issue

- `belegpdf.ts` `Math.round(zahl(p.einzelpreis_cent))` rundet ungültige Schnappschuss-Cents still ⇒ `isSafeInteger`
  oder Dokument als ungültig behandeln.
- `seed/demo-daten.ts` rechnet Positionssummen in Float (Kommentar behauptet „Rust rechnet genauso“) ⇒
  `positionBetrag` aus `dokument.ts` nutzen.
- Non-Null-Assertions auf `.find()` (`einstellungen-index.ts` 56, `liquiditaet.ts` 72) ⇒ `Record<…>`-Lookup.
- `fenster.ts`: zwei Promises ohne `.catch`.
- `regeln.ts` `erkenne()` schluckt Ausnahmen komplett ⇒ im DEV `console.warn`.
- `nummernkreise.ts` 38: einzige SQL-Interpolation (`FROM ${nummernTabelle(id)}`) – sicher (geschlossene Union), aber
  per `Record`-Lookup absichern und kommentieren.
- `queries/rechnungen.ts` `AusstellenDaten.dokument: unknown` ⇒ `BelegDokument`/`readonly Baustein[]` typisieren.
- Bytes an Rust als `Array.from(Uint8Array)` (JSON; 300 KB PDF ≈ 1 MB) ⇒ `tauri::ipc::Request` mit Raw-Body in
  `compile_latex`, `beleg_pdf_ablegen`, `firmenlogo_ablegen`.
- `VOLL_SQL` in `queries/rechnungen.ts`: drei identische korrelierte Subqueries ⇒ ein `LEFT JOIN`.
- Zwei Schreibreihenfolgen koexistieren (`nacheinander()` vs. direktes `invoke`) ⇒ in `db.ts` festlegen, dass
  Rust-Commands ohne `nacheinander` laufen dürfen.
- Deutsch/Englisch-Mix (`settings.ts`, `store/ui.ts`, `suche.ts`, `charts.ts`, `menu.ts`): Regel in `CLAUDE.md`
  („Fachcode deutsch, generische Utilities dürfen englisch sein“) und beim Anfassen angleichen.

---

## 6. Code-Qualität React & CSS

### I-40 · Ein Popover-Menü statt fünf (Prio A · M · `refactoring`, `a11y`)

`BelegStatus.tsx`, `BelegClip.tsx`, `Belege.tsx` (NeuMenue), `Termine.tsx` (MehrMenue), `Vorlagen.tsx` (Palette) und das
Filter-Pop in `EinAusgaenge.tsx` implementieren je eigenes Außenklick, Esc mit `stopPropagation`, Fokus auf ersten
Eintrag, Pfeiltasten, Neu-Positionieren bei Scroll/Resize. Dazu liegen Popover-z-Indizes (60/70) **unter** `.overlay`
(80) – ein Status-Menü aus einer Schublade heraus wäre verdeckt. ⇒ `components/ui/PopMenu.tsx` (Portal,
Anker-Positionierung, `role="menu"`, `--z-popover`) + `hooks/useAussenKlick.ts`; `MehrMenue` ist die vollständigste
Vorlage. Gleichzeitig `--z-sticky/--z-popover/--z-overlay/--z-toast/--z-tip` in `tokens.css`.

### I-41 · Lade-Gerüst vereinheitlichen (Prio A · S · `refactoring`)

`useLaden` liegt in `pages/einstellungen/Laden.tsx`, wird aber überall gebraucht; `ErfassenSchublade`, `TerminSchublade`,
`KundeSchublade`, `BelegEditor` bauen ihr eigenes `{laden|ohne-db|fehler|ok}` mit `aktiv`-Flag und
`eslint-disable exhaustive-deps`. Der „Nur in der Mac-App …“-Leerzustand steht 7× als Kopie. Sechs Seiten nutzen
`void datenStand; // neu laden` als Abhängigkeits-Trick. **Race:** `useLaden` setzt `aktiv.current = true` bei jedem
`laden`-Wechsel – eine ältere Antwort kann nach der neueren landen (Zeitraum-Wechsel in Ein- & Ausgänge während ein
Laden läuft). ⇒ `hooks/useLaden.ts` mit Lauf-Token (`++counter.current` vergleichen), optionalem `key`/`reloadOn:
datenStand`, plus `<Ladezustand>`-Komponente für die drei Nicht-ok-Zweige.

### I-42 · `BelegEditor.tsx` (1 679 Zeilen) zerlegen (Prio B · L · `refactoring`)

`Inhalt` (514 Zeilen) hält Zustand, abgeleitete Werte und 7 asynchrone Handler. ⇒ `hooks/useBelegMaske.ts`
(Formularzustand, `dirty`, `arbeit`-Persistenz), `hooks/useBelegAktionen.ts` (speichern/ausstellen/drucken/mailen …),
17 `*Karte`-Komponenten nach `components/beleg-editor/*.tsx` mit `MaskeKontext` als Context statt Prop `m`.
Fachlogik aus der Komponente nach `lib`: Vollständigkeitsprüfung fürs Ausstellen (ergänzt heute `pflichtCheck` um
„Kunde/Betrag/Datum“ inline) und `BelegVoll → BelegZeile`. Kaputte Memoisierung: `doc`/`kunde` werden jeden Render neu
berechnet, die `useMemo`s dahinter greifen nie. `Maske`-Loader ohne Abbruch ⇒ I-41.

### I-43 · `ErfassenSchublade.tsx` (1 299 Zeilen) zerlegen (Prio B · L · `refactoring`)

17 `useState` für **einen** Datensatz, die immer zusammen gesetzt werden; `speichern` ≈ 200 Zeilen mit drei Pfaden
(offene Rechnung, mit Beleg, einfache Buchung); 8× `document.getElementById/querySelector` statt Refs (koppelt an
Drawer-Interna); `FormularInhalt` mit 30+ Props; Festschreibungs-Regel inline statt über `pruefeFormular`.
⇒ `useReducer`/`useErfassenFormular(auftrag)`, `lib/erfassen-speichern.ts` mit drei Funktionen, die Toast-Beschreibungen
zurückgeben (testbar), Blöcke `Betrag/Wer/Zahlung/Beleg` mit Context.

### I-44 · Weitere große Komponenten (Prio C · M · `refactoring`) – ein Issue je Datei oder ein Sammel-Issue

- `Vorlagen.tsx` (908): `Baukasten` 386 Zeilen ⇒ `useBausteinSortierung` (Pointer+Tastatur), `useRueckgaengigToast`,
  `BausteinListe`, `Palette` (via I-40); Schreibwarteschlange nach `lib/vorlagen/`.
- `KundeSchublade.tsx` (896): `useKundeLaden`, `useNotizAutosave` (auch für Termin-Notizen), `StammdatenForm`;
  `Felder` für `NeuerKunde` wiederverwenden; Dirty-Check per `JSON.stringify` jeden Render ⇒ `formularSchluessel`.
- `TerminSchublade.tsx` (805): Toast-Text in `lib/termin-aktionen.ts`, `BelegBereich`/`AbsagenAnsicht` eigene Dateien,
  `useCmdEnter(fn)` (3 Kopien).
- `Kategorien.tsx` (751): zwei unabhängige Karten ⇒ `Kategorien.tsx` + `EuerZuordnung.tsx`.
- `Termine.tsx` (711): Flash/Scroll-Effekte in Hook, `Zeile`/`BelegChip` nach `components/termine/`.

### I-45 · Doppelte Kleinkomponenten und Muster (Prio B · S · `refactoring`)

Identisch mehrfach definiert: `Fehler` (3×), `Hl` (2×), `Skelett` (3×), `KundenHinweis` (2×), `PflichtKarte` (2×),
`zahlParam` (2×, verschiedene Rückgabe), Warn-Toast-Helfer (4×), Zeitraum-Navigation (`ZeitraumWahl` vs. `Belege.tsx`),
Sidebar-Zähler-Hooks (3×), Zeilen-Tastatur (3×), „URL-Parameter → Aktion → löschen“-Effekt (4×, mit Lint-Suppression).
Modul-globale `let gemerkt` in 6 Dateien statt Store-Slice. ⇒ `components/ui/`, `lib/url.ts`, `hooks/`, `listen`-Slice
im Store. Danach verschwinden die meisten der 11 `eslint-disable exhaustive-deps`. Außerdem: Error-Boundary um
`<Outlet/>` in `AppShell` („Neu laden“), `forwardRef` in `Topbar.tsx` entfernen (React 19), `memo(Zeile)` in den drei
Listen, Blob-URLs in `logoablage.ts` beim Logowechsel `revokeObjectURL`.

### I-46 · CSS: Tokens vervollständigen, Dubletten entfernen (Prio C · S · `design`)

- Plus/Minus-Farbfelder in `components.css` 488–490 sind Literal-Hex und stimmen nicht mit den echten Token-Werten
  überein ⇒ `--sw-pos/--sw-neg` je `[data-pn]`.
- `#fff/#888/#000` in `color-mix`/Monogramm/Switch ⇒ Tokens; Hue-Rampe als `--hue-ramp`; Papier-Palette aus
  `blatt.css` und Print-Override (`base.css` 93) nach `tokens.css` unter „Papier“.
- Doppelt deklarierte Selektoren (`.sd`, `.liq-banner`, `.content`, `.bu-drawer .field-label`, `.brand`,
  `.badge.storniert`), zwei vermeidbare `!important` (`.suggested`, `.legend i.dash`), ungenutzte Klassen (`.gtip`,
  `.tb-dot`, `.card-foot`, `.row-act`, `.grid-3`, `.grid-side`, `.section-title`, `.no-anim`, `.c-ref`, `.c-reflabel`,
  `.c-sep`, `.bu-dz-aus`).
- Kein Scroll-Lock hinter offener Schublade ⇒ `overflow:hidden` auf `html` während `Drawer` gemountet ist.

---

## 7. Barrierefreiheit

### I-50 · Drawer: Fokus-Falle, Startfokus, Fokus-Rückgabe, `inert` (Prio A · S · `a11y`)

`Drawer.tsx` hat `role="dialog" aria-modal="true"`, aber Tab verlässt den Dialog, der Startfokus hängt an
seiten-eigenen `setTimeout(…, 260)` (zwei Schubladen haben keinen), der Fokus kehrt beim Schließen nicht zurück, und
`#app` ist nicht `inert`. Esc-Listener auf `window` schließt die Schublade auch bei offenem Popover (reihenfolgeabhängig).
⇒ Beim Öffnen `document.activeElement` merken, erstes fokussierbares Element fokussieren, `inert` auf `#app`; beim
Schließen Fokus zurück; Esc im `<aside onKeyDown>` behandeln bzw. `e.defaultPrevented` prüfen.

### I-51 · `Seg`: Radiogroup statt Tablist (Prio B · S · `a11y`)

`Seg.tsx` setzt `role="tablist"/"tab"` für Wertauswahlen (27 Verwendungen) ohne `aria-controls`-Panels und ohne
Pfeiltasten. ⇒ `role="radiogroup"/"radio"`, `aria-checked`, rovendes `tabIndex`, Pfeil links/rechts.

### I-52 · Klickbare Zeilen und Blöcke (Prio B · S · `a11y`)

`<tr tabIndex={0} onClick>` in `EinAusgaenge.tsx`/`Kunden.tsx` ohne Rolle/Name ⇒ `role="button"` + `aria-label` oder
Primärzelle als `<button>`/`<Link>`; `Blatt.tsx` 464: wählbare Vorschaublöcke nur per Maus ⇒ `role="button" tabIndex={0}
aria-pressed` + Enter/Leertaste; Schloss-Indikator (`EinAusgaenge.tsx` 558) `role="img" aria-label`; Warn-Toasts mit
Aktionen als `role="alert"`.

---

## 8. Tests, Werkzeuge, CI

### I-60 · ESLint + Prettier einführen und in die CI (Prio A · S · `tooling`)

Im Code stehen 11 `eslint-disable-next-line react-hooks/exhaustive-deps`, aber es gibt keine ESLint-Konfiguration.
⇒ `eslint.config.js` (flat) mit `typescript-eslint` (type-checked), `eslint-plugin-react-hooks`,
`eslint-plugin-jsx-a11y`; Prettier mit `printWidth` passend zum bestehenden Stil (die Codebasis nutzt lange Zeilen,
≈ 140 prüfen), `npm run lint`/`format:check` als CI-Schritte. Erster Lauf wird viele Treffer liefern ⇒ erst mit
`--max-warnings` hoch, dann senken. Danach `lint-staged`/Husky optional (Regel aus `CLAUDE.md` „vor jedem Commit
typecheck && test“ automatisieren).

### I-61 · Dead-Code-Prüfung (`knip`) (Prio B · S · `tooling`)

Fünf tote Exporte wurden von Hand gefunden; `noUnusedLocals` sieht Exporte nicht. ⇒ `knip` in der CI (unused exports,
files, dependencies). Ebenso `cargo udeps`/`cargo machete` gelegentlich von Hand.

### I-62 · Testaufbau Frontend (Prio B · M · `tests`)

- `vite.config.ts` hat keinen `test`-Block: kein `environment: 'jsdom'`, keine Setup-Datei ⇒ DOM-nahe Module
  (`settings.ts` `applySettings`, `store/ui.ts`, `logoablage.ts`) sind nicht testbar.
- Nur `queries/firmenlogo.test.ts` mockt `@tauri-apps/api/core`; andere Suites verlassen sich darauf, dass `isTauri()`
  in Node `false` ist ⇒ `vitest.setup.ts` mit globalem Mock.
- Vier Suites bauen je eine eigene `Map`-Fake-DB, die auf `sql.startsWith('INSERT INTO …')` verzweigt – sie prüfen
  Aufrufform, nicht SQL-Semantik. ⇒ gemeinsamer Fake **oder** (besser) echte Migrationen in einem In-Process-SQLite
  (`better-sqlite3`/`sql.js`) hinter einem `db.ts`-Mock, damit `VERLAUF_SQL`, `VOLL_SQL`, Suche, Auswertung,
  Nummernkreise wirklich getestet werden.
- Danach Lücken füllen: alle `queries/*` (bisher 0 Tests für die Lese-Queries), `belegpdf.ts` `dokumentAusZeile`
  (Storno/quittiert/Eigenbeleg-Zweige), `rechnungen.ts` `vergleiche` (nur 2 von 5 Feldern), `updates.ts`-Ablauf mit
  `vi.mock('@tauri-apps/plugin-updater')`, `suche.ts` `bewerte`.

### I-63 · Testlücken Rust (Prio B · S · `tests`)

Compare-and-Set-Fehlerpfad in `nummern.rs` („gleichzeitig verändert“), Beleg-Status-Freiheit (I-11), Buchung löschen
(I-11), Belegdatum im Folgejahr (I-10), `wieder_offen` nach `bezahlt` mit Termin (I-12), `afa`-Zeile verknüpfen
(I-13), `storno_schnappschuss` ohne Schnappschuss, `eingestellter_pfad` mit `null`/`""`/ungültigem JSON,
gleichzeitiges `ablegen` (I-06).

### I-64 · Abhängigkeiten aktuell halten – Entscheidung Dependabot/Renovate (Prio C · S · `tooling`)

Der Audit-Workflow (Abschnitt 1) **meldet** nur. Dependabot/Renovate würden PRs anlegen – deren Commits erscheinen als
`dependabot[bot]` in der Contributor-Liste, was der Regel „nur m0cki“ widerspricht. Optionen: (a) Renovate mit
`platformCommit`/eigenem Konto, (b) Dependabot mit Squash-Merge unter eigenem Namen, (c) monatlich von Hand
`npm outdated`/`cargo update`. Entscheidung dokumentieren.

### I-65 · CI-Feinheiten (Prio C · S · `ci`)

- Der Rust-Job läuft nur bei Änderungen unter `src-tauri/` oder an `ci.yml`. Eine Änderung an `package.json`
  (z. B. `build`-Skript, das `beforeBuildCommand` ist) wird dort nicht geprüft – bewusst so (Mac-Runner knapp), aber
  im Kopf behalten; der Release-Build baut ohnehin alles.
- `actions/checkout@v7`, `setup-node@v7` sind sehr neue Major-Versionen – in der Audit-/Renovate-Entscheidung
  mitdenken.
- Lokale T3-Checkpoint-Refs (`refs/t3/...`, Autor „T3 Code“) liegen nur im lokalen Repo, nicht auf `origin` – nie
  mit `--mirror`/`--all` pushen.

---

## 9. Fachliche Roadmap (Phasen 4–7)

Stand laut `ANLEITUNG.md` §10: Phasen 0–3 fertig, inkl. Nachträge (Firmenlogo, Kategorien/EÜR, Updater, Sicherung
vor Migration). Offen:

### Reste aus Phasen 1–3 (vor Phase 4 erledigen)

| # | Punkt | Quelle | Größe |
|---|---|---|---|
| F-01 | **Regelbesteuerung** wirkt noch nicht auf Buchungen/Belege (USt-Ausweis, Vorsteuer, Pflichtangaben nach §2.3) | §10 „Offen aus Phase 1“ | L |
| F-02 | **Echter Tectonic-Lauf** mit allen vier Standardvorlagen am Mac (war beim Bauen nicht möglich) – Abnahme aus Phase 3: `Müller & Söhne 100%` kompiliert, PDF = Vorschau, GiroCode scannbar | §10 Phase 3 Teil 1 | S (Test) |
| F-03 | Vorlagen-Seite: **Vorschau mit echtem Beleg** statt Beispieldaten – erledigt (#32, „Beispiel · Letzter Beleg“) | §10 Phase 3 Teil 5 | S |
| F-04 | Suche ⌘K: `?k=` auf der Kennzahlen-Seite auswerten, Wert rechts zeigen | §10 Phase 2 Teil 4 | S (mit Phase 4) |
| F-05 | **Sicherung vor dem Update** (Toast in diesem Branch entfernt) – kommt mit dem Backup aus Phase 5 | `updates.ts` TODO | – |
| F-06 | Export-Menüpunkt zeigt „kommt in Phase 5“ | `commands.ts` | – |

### Phase 4 – Kennzahlen mit Formeln (§8) · L

Lexer, Pratt-Parser, Auswerter, Funktionen, Fehler mit Position und „meintest du …?“ (eigener Parser, nie `eval`);
Reiter „Kennzahlen“ mit CodeMirror, Live-Ergebnis, Erklären-Ansicht, Variablen; Beispiel-Kennzahlen aus §8.3;
angeheftete Kennzahlen im Überblick mit Sparkline. Umfangreiche Vitest-Tests. Empfehlung: Parser/Auswerter als eigener
PR vor der UI.

### Phase 5 – Steuer & Export, Backup, GoBD (§6.9.4, §6.10, §2.10) · L, in Teilen

1. **Backup** (Rust-Command `backup_erstellen`: `VACUUM INTO` + Belege als ZIP; täglich automatisch; Ziel wählen;
   Warnung bei gleichem Datenträger; Erinnerung nach 30 Tagen; Punkt am ⚙; Wiederherstellen mit Vorschau) – zuerst,
   weil Updater (F-05) und Festschreiben darauf aufbauen.
2. **Festschreiben** als Rust-Command (Trigger existieren; `festschreibungen` seit 0009 geschützt).
3. **EÜR-Tabelle** mit Monatsspalten, PDF über LaTeX-Vorlage „EÜR-Bericht“, CSV (de-DE, Dezimalkomma, UTF-8-BOM);
   EÜR-Bereich je Buchung beim Festschreiben einfrieren (§10-Hinweis zu Kategorien).
4. **ELSTER-Ausfüllhilfe** mit Kopier-Knöpfen (§2.9), Wareneingangsbuch, Kleinunternehmer-/Gewerbesteuer-/IHK-Check
   mit nächster Frist (§2.7), ZIP-Export, Anlagen & AfA mit automatischen Buchungen, Jahresabschluss-Assistent.
5. **Kunden anonymisieren** nach Fristablauf (§2.10) – Protokoll-Trigger aus 0009 lässt `alt_json`/`neu_json`
   bewusst zu; Aufbewahrungsfristen je Beleg.

### Phase 6 – Download & Updates (§3.2) · M

Weitgehend erledigt (Updater, Release-Action, Installationsbefehl, `minimumSystemVersion`). Offen: **Tectonic als
Sidecar** bündeln (`tectonic::mitgeliefert()` ist der Platzhalter; löst auch I-02), **„Über Kladdy“ mit Lizenzen**,
**Willkommens-Dialog** beim ersten Start, Abnahme „manipuliertes Update-Paket wird abgelehnt“ einmal real testen.

### Phase 7 – Komfort (optional, einzeln beauftragen)

Unverändert aus §10/§12: DATEV-Export, Bank-CSV-Import, wiederkehrende Buchungen vorschlagen, E-Rechnung empfangen,
Vision-OCR-Sidecar, EventKit-Kalender, Mahnwesen, Fahrtenliste, Ziele, App-Sperre/verschlüsselte Backups,
**Notarisierung** (macht I-07 und das „Dennoch öffnen“ überflüssig), Download-Seite, Tray-Erfassen, § 35a-Baustein,
Verfahrensdokumentation/VVT als PDF.

---

## 10. Empfohlene Reihenfolge

**Jetzt (nächste 1–2 PRs, je klein):**
1. Diesen Branch mergen (Abschnitt 1).
2. I-01 CSP + I-02 Tectonic-Prüfung – kleinste Änderungen, größte Risikominderung.
3. I-60 ESLint/Prettier – bevor weiter refaktoriert wird, damit jede folgende Änderung geprüft wird.
4. I-10 Nummernkreis-Jahr, I-11 Trigger-Lücken (eine Migration `0010` inkl. Indizes aus I-14).

**Als Nächstes:**
5. I-41 `useLaden` + I-40 `PopMenu` + I-50 Drawer-Fokus – gemeinsame Bausteine, die jede weitere UI-Arbeit nutzt.
6. I-30/I-31 Datums- und Dubletten-Modul (lib) – Voraussetzung, um die großen Dateien sauber zu teilen.
7. I-03 Frontend-Schreibzugriffe nach Rust, danach `sql:allow-execute` weg.
8. I-20/I-22 Rust-Infrastruktur, dann I-21 `rechnungen.rs`-Split.
9. I-62 Testaufbau mit In-Process-SQLite.

**Dann fachlich weiter:** F-01 Regelbesteuerung → Phase 5 Backup/Festschreiben (schließt F-05) → Phase 4 Kennzahlen →
Rest Phase 5 → Phase 6 Sidecar/Über/Willkommen. Die großen Komponenten-Splits (I-42/I-43/I-44) jeweils dann, wenn die
Datei ohnehin für eine Fachänderung angefasst wird – nicht als Selbstzweck in einem Rutsch.

**Später/gelegentlich:** I-04, I-05, I-06, I-07, I-12–I-14, I-23, I-24, I-32–I-34, I-45, I-46, I-51, I-52, I-61,
I-63–I-65.

---

## 11. Prüfpunkte für diesen Branch (Mac)

- CI grün (Typecheck, Vitest, Build, `cargo fmt/clippy/test` – der Rust-Job läuft, weil `src-tauri/` geändert ist).
- App startet; beim ersten Start wird vor Migration 0009 eine Sicherung angelegt (`sicherungen/vor-migration`).
- Einstellungen › Updates: „Jetzt aktualisieren“ zeigt direkt „Version … wird geladen …“, keine „Sicherung …“-Meldung mehr.
- Von Hand in der Dev-DB (`sqlite3 kladdy-dev.db`): `DELETE FROM protokoll;` ⇒ Fehler „Das Protokoll wird nie
  gelöscht (GoBD).“; `UPDATE festschreibungen SET bis_datum='2000-01-01';` ⇒ Fehler.
- Actions → „Abhängigkeiten prüfen“ einmal von Hand starten; beide Jobs sollten durchlaufen (ein roter `npm audit`
  heißt: ein Paket hat eine bekannte Lücke ≥ high – dann Update einplanen).
