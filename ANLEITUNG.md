# Kladdy – Bauanleitung für eine macOS-App zum Kleingewerbe

> **Wofür ist diese Datei?** Sie ist die vollständige Vorlage, um die App in einer **Claude-Code-Session auf dem Mac**
> bauen zu lassen. Claude soll sie zuerst ganz lesen und dann Phase für Phase umsetzen (§10).
> Name: **Kladdy** (bis 12.10.2026 Arbeitstitel „Gewerbebuch“). Der Name spielt auf die *Kladde* an, das Heft, in das
> Kaufleute früher jeden Vorgang zuerst eingetragen haben. Stand: 12.10.2026.
>
> **Klickbarer Prototyp:** Im Ordner `prototyp/` neben dieser Datei liegt ein HTML-Prototyp (wie bei PowerAnalytic).
> `prototyp/index.html` im Browser öffnen. Er ist die **visuelle und funktionale Referenz**. Die echte App soll so aussehen
> und sich so verhalten. Alle Ansichten, Farben, Abstände, Diagramme und Abläufe dort gelten als Vorgabe. Bei Widersprüchen
> gilt diese Anleitung für Fachliches und Technik, der Prototyp für Aussehen und Bedienung.
>
> | Prototyp-Datei | Was Claude daraus übernehmen soll |
> |---|---|
> | `css/styles.css` | Design-Tokens und alle Basis-Bausteine (1:1 nach `src/styles/`) |
> | `js/data.js` | Beispiel für Datenmodell, Zahlungswege, Kategorien mit Stichworten, Kunden, Demo-Daten (für den Demo-Modus) |
> | `js/core.js` | Shell mit 5 Menüpunkten, **ein** Erfassen-Weg, Suche/Befehlspalette, Zeitraum-Logik, Umschalter der Auswertung, **Vorschau-Modell `prognose()`** |
> | `js/charts.js` | Diagramm-Regeln und -Aussehen (Balken, Fläche, Prognose, Donut, Sparkline) |
> | `js/qr.js` | GiroCode/EPC-Payload + QR-Encoder (gegen zwei unabhängige Decoder getestet) |
> | `js/formula.js` | Formel-Sprache: Grammatik, Funktionen, Fehlermeldungen (mit 4.600 Testfällen geprüft) |
> | `js/beleg.js` | Regeln der Belegerkennung (Betrag, Datum, Geschäft, Nummer, Kategorie) |
> | `js/pages/*.js` | jede Ansicht: `buchungen.js` (Ein- & Ausgänge + Erfassen-Schublade), `termine.js` (Termine + Termin-Schublade), `belege.js` (Rechnungen & Quittungen + Maske, enthält die Bausteine `App.sheet.BLOCKS`), `vorlagen.js`, `kunden.js`, Auswertung: `ueberblick.js`, `liquiditaet.js`, `kennzahlen.js`, `steuer.js` |
> | `../beispiel-belege/*.pdf` | Test-PDFs zum Ausprobieren von Drag & Drop |
> | `../download-seite/` | fertige Download-Webseite (GitHub Pages) mit Installationsanleitung, Impressum- und Datenschutz-Muster (§3.2) |
>
> Die Steuerinfos in §2 sind recherchiert, aber **keine Steuerberatung**. Werte ändern sich, deshalb sind sie in der App pro Jahr editierbar.

---

## Inhalt

0. So benutzt du diese Datei
1. Was die App können soll
2. Fachlicher Hintergrund: Was ein Kleingewerbe festhalten muss
3. Technik-Entscheidungen
4. Projektstruktur
5. Datenmodell
6. Seiten & Funktionen
7. Vorlagen-Baukasten & PDF-Export (inkl. erzeugter LaTeX-Beispiele)
8. Formel-Editor für eigene Kennzahlen
9. Design-System (aus PowerAnalytic übernommen)
10. Umsetzung in Phasen (fertige Prompts + Abnahme)
11. Inhalt für `CLAUDE.md`
12. Weitere Ideen (Backlog)
13. Quellen

---

## 0. So benutzt du diese Datei

1. **Den ganzen Ordner mit dieser Anleitung auf den Mac bringen** (AirDrop, iCloud Drive, USB-Stick). Er enthält diese
   Anleitung (`ANLEITUNG.md`), den Prototyp (`prototyp/`), Test-PDFs (`beispiel-belege/`) und die Download-Webseite
   (`download-seite/`). Im neuen Projekt den Prototyp unter `referenz/prototyp/`, die Test-PDFs unter
   `referenz/beispiel-belege/` und die Webseite unter `referenz/download-seite/` ablegen.
   Die wichtigsten Design-Werte stehen zusätzlich vollständig in §9.
2. **Voraussetzungen auf dem Mac installieren** (Terminal):
   ```bash
   xcode-select --install                                   # Apple-Entwicklerwerkzeuge
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   brew install node tectonic                               # Node (LTS ≥ 22) + LaTeX-Engine
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust (für Tauri)
   curl -fsSL https://claude.ai/install.sh | bash           # Claude Code, falls noch nicht installiert
   ```
3. **Projektordner anlegen**, diese Datei als `ANLEITUNG.md` hineinlegen, im Ordner `claude` starten.
4. **Erster Prompt** (danach die Prompts aus §10 der Reihe nach):
   > Lies `ANLEITUNG.md` vollständig und sieh dir den Prototyp in `referenz/prototyp/` an (Code + im Browser).
   > Lege `CLAUDE.md` mit dem Inhalt aus §11 an. Setze dann **Phase 0** um und sag mir am Ende, was ich in der
   > laufenden App prüfen soll.

Tipp: Nach jeder Phase die App selbst ausprobieren und erst dann die nächste Phase starten. Mit Git arbeiten
(`git init` in Phase 0), damit jede Phase ein sauberer Commit ist.

---

## 1. Was die App können soll

**In einem Satz:** Eine schöne, schnelle, rein lokale Mac-App, in der ich alle geschäftlichen Ein- und Ausgänge meines
Kleingewerbes festhalte, Belege per Drag & Drop ablege (Betrag, Datum, Geschäft werden erkannt), Rechnungen und Quittungen
mit laufender Nummer in einer **Eingabemaske** erstelle und direkt als PDF drucke (Vorlagen per **Baukasten**, LaTeX läuft
unsichtbar im Hintergrund), sehe, wann ich bei welchem **Kunden** war, eine **Vorschau der nächsten 90 Tage** habe, mir **eigene
Kennzahlen per Formel** baue und am Jahresende alles für die **EÜR** fertig habe, auch als **Export**.
Also „Excel-Erfassung, nur in schön und mit Hirn“.

**Grundsatz: jede Funktion genau einmal, Statistik nur in der Auswertung.** Erfasst wird ausschließlich über den Button
**„+ Erfassen“** im Kopf von Ein- & Ausgänge (⌘N geht von überall). Listen zeigen Listen, keine Summen-Kacheln. Es gibt **keine Konten/Kontostände**: Als
Kleinunternehmer ist das Geschäftskonto meist das Privatkonto. Erfasst werden nur die geschäftlichen Ein- und Ausgänge,
jeweils mit **Zahlungsweg** (Bar · Überweisung/Karte · PayPal).

Das Menü hat genau fünf Punkte (alle im Prototyp zu sehen):

| Menüpunkt | Inhalt |
|---|---|
| **Ein- & Ausgänge** (Startseite) | ruhige Liste aller geschäftlichen Zahlungen (Datum · Beleg-Nr. · Beschreibung + Kunde/Geschäft · Kategorie · Zahlungsweg · Betrag), Filter, Suche. **Beleg-PDF aufs Fenster ziehen ⇒ Erfassen-Schublade öffnet sich vorausgefüllt** |
| **Termine** | Kundentermine (Agenda), auf Wunsch mit **vorbereiteter Quittung**; nach dem Termin abhaken, dann „Quittung ausstellen“ über die Erfassen-Schublade; bei Absage wird die Vorbereitung verworfen |
| **Rechnungen & Quittungen** | Liste aller Belege nach laufender Nummer (Filter Alle · Offen · Bezahlt, Zeitraum Monat · Jahr · Gesamt, Status per Klick aufs Badge), **Eingabemaske mit Live-Vorschau**, Pflichtangaben-Check, **GiroCode (QR)** auf der Rechnung, **Drucken / PDF**; Button **Vorlagen** führt zum **Baukasten** (Bausteine hinzufügen, entfernen, sortieren, einstellen; LaTeX nur als Experten-Ansicht) |
| **Kunden** | jeder Kunde einer Quittung/Rechnung, mit **Verlauf**: wann man dort war, was gemacht wurde, Betrag, Beleg; Notiz („Hund im Garten“), Kontaktdaten. Keine Lieferanten |
| **Auswertung** | **großer Umschalter** mit vier Reitern: **Überblick** (Status, Kennzahlen des Zeitraums, Diagramme, angeheftete Kennzahlen) · **Liquidität** (was in 30/60/90 Tagen rein- und rausgeht) · **Kennzahlen** (eigene Formeln, z. B. `TEILEN(GEWINN(); EINNAHMEN(); 0)`) · **Steuer & Export** (EÜR, Wareneingangsbuch, Kleinunternehmer-Check, CSV/PDF-Export) |
| ⚙ **Einstellungen** (nur oben rechts) | Beleg bei Einnahmen (Quittung oder Rechnung), Firmendaten, Steuerstatus, Nummernkreise, Steuer-Kennwerte pro Jahr, Darstellung (Hell/Dunkel/System, Themes wie PowerAnalytic), Daten & Backup |

**Verteilung:** als `.dmg` zum Herunterladen für eigene Macs bzw. Bekannte, mit **Updates aus der App heraus**; alle Daten
bleiben lokal in einer SQLite-Datei auf dem Mac (§3.2).

Nicht-Ziele (bewusst weggelassen): keine doppelte Buchführung/Bilanz, kein Kassensystem (TSE), keine Cloud,
keine Mehrbenutzer. Alles bleibt lokal auf dem Mac.

---

## 2. Fachlicher Hintergrund: Was ein Kleingewerbe festhalten muss

### 2.1 Zwei Begriffe, die oft verwechselt werden

- **Kleingewerbe** = Gewerbe ohne Handelsregistereintrag (Gewerberecht). Gewinnermittlung per
  **Einnahmen-Überschuss-Rechnung (EÜR)**, abgegeben als **Anlage EÜR** mit der Einkommensteuererklärung (+ Anlage G).
  Eine Bilanz ist erst ab 800.000 € Umsatz oder 80.000 € Gewinn Pflicht (§ 141 AO).
- **Kleinunternehmer** (§ 19 UStG) = Sonderregel der **Umsatzsteuer**. Seit 2025: Vorjahresumsatz ≤ **25.000 €**
  und laufendes Jahr ≤ **100.000 €**. Wird die 100.000-€-Grenze im laufenden Jahr überschritten, gilt die Regelbesteuerung
  **sofort ab dem Umsatz, der die Grenze überschreitet**, nicht erst im Folgejahr. Kleinunternehmer-Umsätze sind seit 2025
  steuerfrei. Seit dem Steuerjahr 2024 entfällt für Kleinunternehmer grundsätzlich die Umsatzsteuer-Jahreserklärung.

**Die App unterstützt beide Modi** (Einstellung „Umsatzsteuer: Kleinunternehmer | Regelbesteuerung“).
Standard ist Kleinunternehmer. Im Kleinunternehmer-Modus gibt es keine USt-Felder, alle Beträge sind Endbeträge
(Ausgaben brutto, da kein Vorsteuerabzug).

### 2.2 Was festgehalten werden muss und wie die App das abdeckt

| Was | Warum | Umsetzung in der App |
|---|---|---|
| **Jede Betriebseinnahme und -ausgabe einzeln**: Datum, Betrag, Gegenpartei, Zweck, Beleg | Grundlage der EÜR. Es zählt das **Zahlungsdatum** (Zufluss-/Abflussprinzip, § 11 EStG) | Buchungsjournal; Pflichtfelder; Rechnungen werden erst bei Zahlung zur Einnahme |
| **Belege** (Rechnungen, Quittungen, Kontoauszüge) | Aufbewahrungspflicht | Datei je Buchung, unveränderbar abgelegt (SHA-256) |
| **Wareneingang** (§ 143 AO): Datum, Lieferant mit Anschrift, Warenbezeichnung, Preis, Belegverweis | Pflicht für gewerbliche Unternehmer, die Waren einkaufen | Kategorie „Produkte & Material“ + Geschäft (Anschrift steht auf dem Beleg) ⇒ Bericht „Wareneingangsbuch“ |
| **Bargeschäfte einzeln** (§ 146 AO) | Einzelaufzeichnungspflicht | Zahlungsweg „Bar“, jede Bareinnahme einzeln (mit Quittung). Elektronische Kasse bräuchte eine TSE, das ist **nicht** Teil der App |
| **Anlagevermögen** (über 800 € netto): Anschaffungsdatum, Kosten, Nutzungsdauer, AfA | Abschreibung statt Sofortabzug | Modul „Anlagen“ mit AfA-Plan, erzeugt jährliche AfA-Buchungen |
| **Ausgestellte Rechnungen** mit eindeutiger, fortlaufender Nummer | Rechnungspflichtangaben | Rechnungsmodul; Nummer erst beim Ausstellen (Finalisieren), Entwürfe haben keine Nummer ⇒ keine Lücken |
| **Bewirtungen und Geschenke getrennt** von sonstigen Ausgaben (§ 4 Abs. 7 EStG) | Sonst nicht abziehbar | eigene Kategorien; Bewirtung: Anlass, Teilnehmer, Ort; Geschenke: Empfänger (Summe je Empfänger und Jahr) |
| **Privatanteile** (z. B. Handy zu 50 % privat) | Nur der betriebliche Teil zählt | Feld „Privatanteil %“ je Buchung/Kategorie |
| **Fahrten mit Privat-Pkw** | Nachweis für Kilometerpauschale | einfache Fahrtenliste (Datum, Ziel, Zweck, km) ⇒ km × Satz (Phase 7) |
| **Kleinunternehmer-Grenzen** | 25.000 € / 100.000 € | Status unter Auswertung → Überblick, Details unter Auswertung → Steuer & Export, Warnung ab 80 % |
| **Empfangene E-Rechnungen im Originalformat** (XML) | Empfangspflicht (zwischen Unternehmen) seit 1.1.2025 | Import von XRechnung/ZUGFeRD, XML wird mit archiviert (Phase 7) |

### 2.3 Pflichtangaben auf Rechnungen

**Als Kleinunternehmer** (§ 34a UStDV, gilt seit 2025), mindestens:
1. vollständiger Name und Anschrift von dir und vom Kunden
2. Steuernummer **oder** USt-IdNr. **oder** Kleinunternehmer-Identifikationsnummer
3. Ausstellungsdatum
4. Menge und Art der Lieferung bzw. Umfang und Art der Leistung
5. Entgelt als Gesamtsumme **mit Hinweis auf die Steuerbefreiung nach § 19 UStG**
6. bei Gutschriften das Wort „Gutschrift“

Zusätzlich empfohlen (und in der App Standard): **fortlaufende Rechnungsnummer** und **Leistungsdatum/-zeitraum**.
Kleinunternehmer-Rechnungen dürfen laut § 34a UStDV **immer als normales PDF/Papier** verschickt werden.
Eine E-Rechnung ist für sie also nicht nötig.

**Regelbesteuert** (§ 14 Abs. 4 UStG): zusätzlich fortlaufende Nummer, Leistungszeitpunkt, Nettobetrag je Steuersatz,
Steuersatz und Steuerbetrag (die App blendet diese Felder im Regelmodus ein).

**Kleinbetragsrechnung** bis 250 € brutto (§ 33 UStDV): vereinfachte Angaben, Kundenname nicht nötig.
Eine **Quittung** aus der App erfüllt das, wenn sie Absender, Datum, Leistung, Betrag und den § 19-Hinweis enthält.

Hinweistext Kleinunternehmer (Vorschlag): *„Umsatzsteuerfrei aufgrund der Kleinunternehmerregelung gemäß § 19 UStG.“*

**Quittung oder Rechnung – wo ist der Unterschied?**

| | Quittung | Rechnung |
|---|---|---|
| Bedeutung | **Bestätigung, dass bezahlt wurde** (Empfangsbestätigung) | **Zahlungsaufforderung** für eine erbrachte Leistung |
| Typischer Fall | Kunde zahlt sofort vor Ort (bar, PayPal) | Kunde zahlt später, meist per Überweisung (Zahlungsziel, GiroCode) |
| Status in der App | immer „bezahlt“ (sonst wäre es keine Quittung) | „offen“ bis zum Zahlungseingang, dann „bezahlt“ |
| Nummernkreis | QU-JJJJ-NNN | RE-JJJJ-NNN |

Für die EÜR macht es keinen Unterschied: Es zählt der Tag, an dem das Geld kommt. **Die Quittung der App enthält
zugleich alle Rechnungsangaben nach § 34a UStDV** (Name/Anschrift beider Seiten, Steuernummer, Datum, Leistung, Betrag,
§ 19-Hinweis, dazu die Nummer; Leistungstag ist das Quittungsdatum) – sie ist also „Rechnung und Zahlungsbestätigung in
einem“. Darum ist im Alltag die Quittung der Standard (Einstellung „Beleg bei Einnahmen“), die Rechnung die Ausnahme.
Eine **Rechnung** braucht man, wenn
- der Kunde **später** zahlt (Überweisung mit Zahlungsziel),
- eine **Firma** oder Hausverwaltung beauftragt (die braucht eine Rechnung für ihre Buchhaltung; an Unternehmer muss
  ohnehin innerhalb von sechs Monaten eine Rechnung gehen, § 14 Abs. 2 Satz 2 Nr. 1 UStG),
- ein Privatkunde die **Arbeitskosten von der Steuer absetzen** will (§ 35a EStG, haushaltsnahe Dienst- bzw.
  Handwerkerleistungen, z. B. Rasenmähen, Heckenschnitt): Dafür braucht er eine **Rechnung** und muss **unbar auf das
  Konto des Leistenden zahlen** (Überweisung, Karte) – Barzahlung wird nicht anerkannt (§ 35a Abs. 5 Satz 3 EStG).
  Begünstigt sind nur Arbeits-, Maschinen- und Fahrtkosten, nicht Material; diese deshalb auf der Rechnung **getrennt
  ausweisen** (Baustein „Arbeitskosten nach § 35a“, Backlog §12).

**Rechnungspflicht bei Arbeiten am Grundstück:** Für Werklieferungen und sonstige Leistungen im Zusammenhang mit einem
Grundstück (Gartenarbeiten, Grünpflege, Reparaturen am Haus) muss ein Unternehmer **auch Privatkunden innerhalb von sechs
Monaten eine Rechnung** ausstellen (§ 14 Abs. 2 Satz 2 Nr. 3 UStG in der Fassung seit 2025). Nach der Verwaltungsauffassung
(Abschn. 14.1 Abs. 3 UStAE) gilt das auch für Kleinunternehmer. Da der Gesetzestext von „steuerpflichtigen“ Leistungen
spricht und Kleinunternehmer-Umsätze seit 2025 steuerfrei sind, ist das nicht abschließend geklärt – die App geht auf
Nummer sicher: Die Quittung mit allen Rechnungsangaben erfüllt die Pflicht in jedem Fall. Privatkunden müssen solche
Rechnungen zwei Jahre aufbewahren (§ 14b Abs. 1 Satz 5 UStG); ein Hinweis darauf gehört auf den Beleg
(Standard-Schlusstext: *„Hinweis für Privatkunden: Bitte bewahren Sie diesen Beleg zwei Jahre auf (§ 14b UStG).“*).
Möbelmontage in einer Wohnung ist dagegen in der Regel keine Grundstücksleistung. Im Zweifel Steuerberater fragen.

### 2.4 E-Rechnung kurz

- **Empfangen** müssen seit 1.1.2025 alle Unternehmen können, also auch Kleinunternehmer (gilt nur für Rechnungen
  zwischen Unternehmen). Praktisch reicht eine E-Mail-Adresse, aber die XML-Datei muss im Original archiviert werden.
- **Ausstellen:** Kleinunternehmer sind ausgenommen (s. o.), für Privatkunden gibt es ohnehin keine E-Rechnungspflicht. Regelbesteuerte
  im B2B-Geschäft: Pflicht ab 2027 (Vorjahresumsatz über 800.000 €) bzw. ab 2028 für alle.

### 2.5 Aufbewahrung & GoBD (Regeln für die Software)

- **Fristen:** Buchungsbelege (Rechnungen, Quittungen, Kontoauszüge) **8 Jahre** (seit 2025), Bücher/Aufzeichnungen
  und Jahresabschlüsse **10 Jahre**, sonstige Geschäftsbriefe **6 Jahre**. Fristbeginn: Ende des Kalenderjahres.
- **GoBD-Grundsätze, die die App technisch umsetzen soll:**
  - Vollständig, zeitnah, geordnet, **unveränderbar**: Änderungen nur nachvollziehbar (Änderungsprotokoll mit alt/neu).
  - **Festschreiben** abgeschlossener Monate/Jahre: danach nur noch Storno + Neubuchung, kein Bearbeiten/Löschen.
  - Fortlaufende Buchungsnummern, nie wiederverwenden.
  - Belege unverändert speichern (Hash), Rechnungs-PDFs nach dem Finalisieren einfrieren.
  - Daten exportierbar (CSV) für Finanzamt/Steuerberater.

### 2.6 Steuer-Kennwerte (in der App als editierbare Tabelle **pro Jahr**)

| Kennwert | Wert (Stand 2026) |
|---|---|
| Kleinunternehmer: Grenze Vorjahr / laufendes Jahr | 25.000 € / 100.000 € |
| Kleinbetragsrechnung | bis 250 € brutto |
| Geringwertige Wirtschaftsgüter (Sofortabzug) | bis 800 € netto. Für die Grenze zählt auch bei Kleinunternehmern der Nettobetrag, abgesetzt wird der bezahlte Betrag |
| Gewerbesteuer-Freibetrag (Einzelunternehmen) | 24.500 € Gewinn (darunter keine Gewerbesteuer; Erklärung erst darüber Pflicht) |
| Bewirtung | 70 % abziehbar |
| Geschenke an Geschäftspartner | bis 50 € pro Empfänger und Jahr |
| Homeoffice-Tagespauschale | 6 € pro Tag, max. 1.260 € pro Jahr |
| Dienstreise mit Privat-Pkw | 0,30 € pro km |
| Verpflegungspauschale Inland | 14 € (über 8 Std.) / 28 € (24 Std.) |
| IHK-Beitrag | beitragsfrei bis 5.200 € Gewerbeertrag (ohne Handelsregistereintrag) |
| Buchführungspflicht (statt EÜR) | ab 800.000 € Umsatz oder 80.000 € Gewinn |

### 2.7 Fristen (für die Erinnerungsfunktion)

| Was | Wann |
|---|---|
| Einkommensteuererklärung inkl. Anlage EÜR + Anlage G | 31.07. des Folgejahres; mit Steuerberater Ende Februar des übernächsten Jahres (§ 149 AO) |
| ESt-Vorauszahlungen (falls festgesetzt) | 10.03., 10.06., 10.09., 10.12. |
| Gewerbesteuer-Vorauszahlungen (falls festgesetzt) | 15.02., 15.05., 15.08., 15.11. |
| Belege löschen erlaubt | automatisch berechnet je Beleg (Jahresende + 8 J.) |

### 2.8 Kategorien: bewusst wenige

Die App ist für einen **Dienstleister** gedacht: Es gibt im Kern eine Einnahmeart und wenige Kostenarten. **Standardset:**

| Typ | Kategorie | Beispiele | EÜR-Bereich |
|---|---|---|---|
| Einnahme | **Dienstleistungen** | alle Aufträge, egal ob Quittung oder Rechnung | Betriebseinnahmen als Kleinunternehmer |
| Ausgabe | **Produkte & Material** | Pflanzen, Erde, Ersatzteile, Kleinmaterial (⇒ Wareneingangsbuch) | Waren, Roh- und Hilfsstoffe |
| Ausgabe | **Sprit & Fahrzeug** | Tanken, Werkstatt, Kfz-Versicherung (betriebliches Fahrzeug) | Kraftfahrzeugkosten |
| Ausgabe | **Sonstige Kosten** | Telefon, Versicherung, Werkzeug, Gebühren, Werbung | Übrige Betriebsausgaben |

Es gibt **keine neutralen Buchungen** (Privatentnahme, Privateinlage, Umbuchung zwischen Konten): Die App führt keine Konten,
private Zahlungen werden einfach nicht erfasst.

Jede Kategorie hat: Typ, Name, Icon, Farbe, EÜR-Bereich, abziehbarer Anteil in %, „zählt zum Kleinunternehmer-Umsatz“,
„Wareneingangsbuch“ und **Stichworte** (z. B. Sprit: *tankstelle, aral, shell, diesel, liter, werkstatt*). Mit den Stichworten
schlägt die App beim Tippen und bei der Belegerkennung die Kategorie vor.

Kategorien lassen sich in den Einstellungen **hinzufügen, umbenennen, archivieren** (z. B. „Werkzeug (GWG)“ oder „Bewirtung (70 %)“,
wenn man sie braucht). Die genaue **Zeilennummer der Anlage EÜR ändert sich manchmal** von Jahr zu Jahr. Deshalb gibt es eine
editierbare Zuordnungstabelle pro Jahr. Seltene Spezialfälle (AfA, Bewirtung, Geschenke, Homeoffice) bleiben als optionale
Kategorien im Katalog, sind aber standardmäßig ausgeblendet.

**Keine Konten, nur Zahlungswege.** Ein Kleingewerbe braucht kein eigenes Geschäftskonto; oft laufen Geschäft und Privates
über dasselbe Konto. Die App führt deshalb **keine Kontostände**, sondern hält je Ein-/Ausgang nur fest, **wie** bezahlt wurde:
**Bar · Überweisung (auch Karte) · PayPal**. Das genügt für die EÜR (es zählen nur die betrieblichen Zahlungen) und hilft, eine
Zahlung im Kontoauszug oder bei PayPal wiederzufinden. Bareinnahmen werden einzeln mit Quittung erfasst (§ 146 AO).
Wer später doch ein getrenntes Konto möchte, kann das als Backlog-Punkt nachrüsten (§12).

### 2.9 Braucht man DATEV oder eine ELSTER-Anbindung?

**Nein.** Für ein Kleingewerbe ist keine bestimmte oder zertifizierte Software vorgeschrieben. Pflicht ist nur:
ordnungsgemäß aufzeichnen (GoBD) und die **Anlage EÜR elektronisch** mit der Einkommensteuererklärung abgeben. Das geht
kostenlos über **„Mein ELSTER“**, indem man die Werte abtippt.

Was die App deshalb anbietet:
- **ELSTER-Ausfüllhilfe** (fester Teil der App, Phase 5): EÜR-Werte in der Reihenfolge und mit den Bezeichnungen des
  Formulars, je Wert ein Kopier-Knopf, dazu ein Hinweis, die Zeilennummern im aktuellen Formular zu prüfen.
- **DATEV-Export** (optional, Phase 7): erst wichtig, wenn ein Steuerberater dazukommt (die meisten arbeiten mit DATEV).
  CSV im DATEV-Format „Buchungsstapel“ plus Belege als ZIP. Kontenzuordnung (z. B. SKR03/SKR04) pro Kategorie einstellbar.
- **Keine direkte ELSTER-Übermittlung.** Über die ELSTER-Schnittstelle „ERiC“ wäre das technisch möglich, setzt aber eine
  Registrierung als Softwarehersteller voraus und lohnt sich für ein Kleingewerbe nicht.

### 2.10 Datenschutz (DSGVO) bei Kundendaten

Die DSGVO gilt auch dann, wenn alle Daten nur auf dem eigenen Mac liegen. Für ein Kleingewerbe ist das überschaubar, die App
soll es aber leicht machen (keine Rechtsberatung):
- **Rechtsgrundlagen:** Name, Anschrift und Kontakt werden für den Auftrag gebraucht (Art. 6 Abs. 1 lit. b DSGVO) und wegen
  der Aufbewahrungspflichten aufbewahrt (lit. c). Eine Einwilligung ist dafür nicht nötig.
- **Informieren (Art. 13):** Kunden kurz sagen, wofür die Daten gespeichert werden. Die App bietet dafür den optionalen
  Beleg-Baustein **„Datenschutzhinweis“** (§7.0); alternativ ein Satz auf der eigenen Website oder mündlich.
- **Sparsam notieren:** Kunden-Notizen nur sachlich („Hund im Garten – Tor schließen“), keine Angaben zu Gesundheit,
  Religion o. Ä. Die App zeigt den Hinweis direkt unter dem Notizfeld.
- **Löschen vs. Aufbewahren:** Kunden ohne Buchungen und ausgestellte Belege sind jederzeit löschbar. Sonst gehen die Daten
  erst nach Ablauf der Fristen (§2.5: Belege 8, Aufzeichnungen 10 Jahre, Beginn am Ende des Kalenderjahres; es gilt die
  längere): Die App zeigt in der Kunden-Schublade „Löschen ab 2037“ und bietet danach **„Anonymisieren“** (§6.8).
- **Sicherheit (Art. 32):** FileVault an (Festplattenverschlüsselung), Bildschirmsperre, Sicherung außerhalb des Macs
  (§6.10 Datensicherung). Sicherungen in iCloud Drive am besten mit „Erweiterter Datenschutz für iCloud“ (Ende-zu-Ende)
  oder verschlüsselt (Phase 7).
- **Verzeichnis der Verarbeitungstätigkeiten (Art. 30):** Wer regelmäßig Kundendaten verarbeitet, sollte eine kurze
  Übersicht führen (eine Seite: Kundenverwaltung/Rechnungen – Zweck, Datenarten, Fristen, Schutzmaßnahmen). Muster gibt es
  bei den Datenschutz-Aufsichtsbehörden; die App kann es später vorausgefüllt erzeugen (Backlog).
- **Die App selbst** sendet keine Geschäftsdaten und hat kein Tracking. Ins Internet geht sie nur für die Update-Prüfung
  (`latest.json` bei GitHub) und beim ersten PDF für die TeX-Pakete von Tectonic.

---

## 3. Technik-Entscheidungen

| Thema | Entscheidung | Begründung |
|---|---|---|
| App-Hülle | **Tauri 2** (Rust) | Echte Mac-App (.app), klein (~10 MB), nutzt den Systembrowser WKWebView |
| UI | **React + TypeScript + Vite** | Dieselbe Zielarchitektur wie PowerAnalytic ⇒ Design 1:1 übertragbar |
| Styling | **Plain CSS mit CSS-Variablen** (Tokens aus §9), kein Tailwind nötig | So ist PowerAnalytic gebaut |
| Icons | **lucide-react** (`strokeWidth={1.8}`, `size={18}`) | Gleicher Stil wie die Inline-Icons in PowerAnalytic |
| Schrift | **Inter** + **JetBrains Mono** lokal gebündelt (`@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`) | Gleicher Look, offline |
| Diagramme | **Eigene kleine SVG-Komponenten** (Balken, Linie/Fläche, Donut, Sparkline) nach den Regeln aus §9.6 | Wie PowerAnalytic, volle Kontrolle über den Look |
| Daten | **SQLite** über `@tauri-apps/plugin-sql`, Migrationen in Rust. Kritische Mehrschritt-Vorgänge (Rechnung finalisieren, Storno, Festschreiben, Backup) als **Rust-Command mit Transaktion** | Lokal, robust, eine Datei |
| Zustand | Zustand (UI) + TanStack Query (Daten-Cache, Invalidierung) | wie PowerAnalytic-Plan |
| Routing | React Router (HashRouter) | einfach |
| LaTeX | **Tectonic** (selbstständige XeTeX-Engine, lädt Pakete beim 1. Lauf und cacht sie) | Kein 5-GB-TeX-Live nötig |
| Vorlagen | **Block-Baukasten** (eigene Komponenten, Sortieren mit `@dnd-kit/sortable`), LaTeX wird daraus erzeugt | Kein LaTeX-Wissen nötig |
| QR-Code | eigener Encoder wie `prototyp/js/qr.js` (oder `qrcode-generator`), EPC-Inhalt selbst bauen | GiroCode, offline |
| Formel-Editor | **CodeMirror 6** (einzeilig) + eigene Autovervollständigung | Hervorhebung, Fehlerstellen markieren |
| PDF-Vorschau | **pdf.js** (`pdfjs-dist`), Seiten auf Canvas | Zoom, Seitenwechsel, Scrollposition halten |
| Formeln | **Eigener kleiner Parser** (Lexer → Pratt-Parser → AST → Auswertung), **kein `eval`** | Sicher, deutsche Funktionsnamen, gute Fehlermeldungen |
| Tests | Vitest (TS), `cargo test` (Rust) | Formel-Engine, Geldrechnung, Nummernkreise, LaTeX-Escaping |
| Verteilung | **`.app` in einer `.dmg`** (Tauri-Bundler), Apple Silicon (`aarch64`), optional Universal | Das macOS-Gegenstück zu einem AppImage: herunterladen, in „Programme“ ziehen, starten (§3.2) |
| Updates | **`tauri-plugin-updater`** + `tauri-plugin-process`, signierte Update-Pakete, `latest.json` auf GitHub Releases oder eigenem Webspace | Updates aus der App heraus, Daten bleiben unangetastet (§3.2) |

**Geld immer als ganze Cent (Integer)** speichern und rechnen. Anzeige mit `Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })`.
Datumswerte als `YYYY-MM-DD`-Text.

**Ablageorte:** Datenbank und Belege unter `~/Library/Application Support/<identifier>/` (Tauri `appDataDir()`,
z. B. `~/Library/Application Support/de.kladdy.desktop/`; den Identifier nicht auf `.app` enden lassen – die Tauri-CLI
warnt davor, weil das mit der Endung des App-Bundles kollidiert, und später lässt er sich wegen des Datenpfads kaum noch ändern). Dort liegen sie getrennt von der App – ein Update ersetzt nur die `.app`.
Die **Datenbank nicht in iCloud Drive** legen (Sync kann SQLite beschädigen). Backups dürfen in einen iCloud-Ordner.

### 3.1 Mac-Besonderheiten (wichtig für Claude)

- **Fenster:** Titelleiste als Overlay, damit Seitenleiste und Kopfzeile bis ganz oben reichen:
  ```json
  "windows": [{
    "title": "Kladdy", "width": 1360, "height": 860, "minWidth": 1024, "minHeight": 680,
    "titleBarStyle": "Overlay", "hiddenTitle": true,
    "trafficLightPosition": { "x": 18, "y": 27 }
  }]
  ```
  Falls `trafficLightPosition` in der installierten Tauri-Version anders heißt: aktuelle Tauri-Doku prüfen.
  Die Ampel-Knöpfe liegen links oben **in der Marke der Seitenleiste**, deshalb `.sb-head { padding-left: 84px }`.
  Eingeklappt (76 px) die Marke ausblenden, die Ampel nimmt den Platz ein.
- **Fenster verschieben:** `data-tauri-drag-region` auf `.sb-head` und `.topbar`. Die Berechtigung
  `core:window:allow-start-dragging` in `src-tauri/capabilities/default.json` freigeben.
- **Menüleiste:** Ablage (Erfassen ⌘N, Quittung/Rechnung schreiben – öffnen dieselbe Erfassen-Schublade, Beleg importieren ⌘O –
  Dateiauswahl, danach dieselbe Schublade wie beim Datei-Drop, Export …, Nach Updates suchen …), **Bearbeiten-Menü
  unbedingt behalten**, sonst funktionieren ⌘C/⌘V/⌘Z in Eingabefeldern nicht. Darstellung (Hell/Dunkel ⇧⌘L, Seitenleiste ⌘\).
- **Tectonic finden:** Mac-Apps erben den `PATH` der Shell nicht. In dieser Reihenfolge suchen: mitgeliefertes Sidecar
  (sobald gebündelt, §3.2), `/opt/homebrew/bin/tectonic`, `/usr/local/bin/tectonic`, sonst Pfad in den Einstellungen.
- **Browser-Features:** Mindestens macOS 14. `color-mix()` geht. `oklch(from …)` (relative Farben) erst ab Safari 18,
  daher den `color-mix`-Fallback für `--accent-2` behalten. `backdrop-filter` zusätzlich mit `-webkit-`-Präfix.
- **Bauen:** `npm run tauri build` erzeugt `src-tauri/target/release/bundle/macos/Kladdy.app` und eine `.dmg`.
  Auf dem eigenen Mac gebaute Apps starten direkt. Zum **Weitergeben** siehe §3.2.

### 3.2 Verteilen & Updates (privat, ohne App Store)

**Format.** Ein *AppImage* gibt es nur unter Linux. Das macOS-Gegenstück ist eine **`.app`**, verpackt in eine **`.dmg`**:
Datei herunterladen, öffnen, App in „Programme“ ziehen, fertig – keine Installation, keine Admin-Rechte. Tauri erzeugt beides
(`npm run tauri build -- --bundles app,dmg`). Ziel: Apple Silicon (`aarch64-apple-darwin`); für alte Intel-Macs optional ein
Universal-Build (`--target universal-apple-darwin`, vorher `rustup target add aarch64-apple-darwin x86_64-apple-darwin`).
Mindestversion: **macOS 14 Sonoma** (`bundle.macOS.minimumSystemVersion: "14.0"`, wie in §3.1) – die Oberfläche nutzt
aktuelle CSS-Funktionen (`color-mix`, Container-Queries, `:has`), die das WebKit älterer Systeme nicht sicher kann. Die
Download-Seite nennt dieselbe Version (`download-seite/index.html` und `seite.js`).

**Signieren – zwei Wege:**

| | Ohne Apple-Entwicklerkonto (kostenlos) | Mit Apple Developer Program (99 $/Jahr) |
|---|---|---|
| Einstellung | `bundle.macOS.signingIdentity: "-"` (Ad-hoc-Signatur; auf Apple Silicon Pflicht, sonst startet die App gar nicht) | Zertifikat „Developer ID Application“ + **Notarisierung** (`APPLE_ID`, `APPLE_PASSWORD` = app-spezifisches Passwort, `APPLE_TEAM_ID` oder App-Store-Connect-API-Key) |
| Erster Start auf einem anderen Mac | macOS blockiert die App einmal. Dann **Systemeinstellungen → Datenschutz & Sicherheit → „Dennoch öffnen“** und mit Passwort bestätigen. (Rechtsklick → Öffnen reicht seit macOS 15 nicht mehr.) | startet ohne Warnung |
| Geeignet für | dich selbst und ein paar Bekannte, denen man den Schritt einmal zeigt | größeren Kreis |

Empfehlung für „privat“: **ohne Konto starten**, in der Download-Anleitung den einmaligen Freigabe-Schritt mit Screenshot
erklären. Nie Gatekeeper komplett abschalten (`spctl --master-disable`) und `xattr -dr com.apple.quarantine` nur als Notlösung
für die eigene App.

**Updates aus der App heraus** (`tauri-plugin-updater` + `tauri-plugin-process`):
1. Einmalig ein Schlüsselpaar für Updates erzeugen: `npm run tauri signer generate -- -w ~/.tauri/kladdy.key`.
   Der **öffentliche** Schlüssel kommt in `tauri.conf.json`, der **private** bleibt geheim (Passwort-Manager + Backup) –
   geht er verloren, können bestehende Installationen keine Updates mehr annehmen. Diese Update-Signatur ist unabhängig
   von Apple und auch ohne Entwicklerkonto Pflicht.
2. `tauri.conf.json`:
   ```json
   "bundle": { "createUpdaterArtifacts": true, "macOS": { "signingIdentity": "-" } },
   "plugins": { "updater": {
     "pubkey": "<Inhalt des öffentlichen Schlüssels>",
     "endpoints": ["https://github.com/<name>/kladdy/releases/latest/download/latest.json"]
   } }
   ```
   Beim Bauen `TAURI_SIGNING_PRIVATE_KEY` (+ `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) als Umgebungsvariable setzen
   (nicht über `.env`). Der Build erzeugt zusätzlich `Kladdy.app.tar.gz` und `Kladdy.app.tar.gz.sig`.
3. **`latest.json`** neben die Dateien legen:
   ```json
   { "version": "1.2.0", "notes": "Neu: CSV-Export", "pub_date": "2026-11-02T10:00:00Z",
     "platforms": { "darwin-aarch64": { "url": "https://…/Kladdy.app.tar.gz", "signature": "<Inhalt der .sig-Datei>" } } }
   ```
   Bei einem Universal-Build zusätzlich einen Eintrag `darwin-x86_64` (gleiche Datei, gleiche Signatur) anlegen, sonst
   bekommen Intel-Macs keine Updates.
4. Hosten: am einfachsten **GitHub Releases** (das Repository muss dafür öffentlich sein – der Code enthält keine Daten, die
   bleiben auf dem Mac). Alternative: beliebiger HTTPS-Webspace mit denselben drei Dateien. Mit der GitHub-Action
   `tauri-apps/tauri-action` entstehen `.dmg`, Update-Paket und `latest.json` bei jedem Tag `v1.2.0` automatisch.
5. In der App: beim Start (höchstens einmal täglich) und über „Nach Updates suchen …“ `check()` aufrufen; gibt es eine
   neue Version, ein Toast „Version 1.2.0 ist da · Was ist neu? · Jetzt aktualisieren“ → `downloadAndInstall()` mit
   Fortschritt → `relaunch()`. **Vorher automatisch ein Backup** der Datenbank anlegen. Berechtigungen in
   `capabilities/default.json`: `"updater:default"`, `"process:allow-restart"`.
   **Laden und Neustart getrennt (umgesetzt 15.10.2026, `src/lib/updates.ts`):** wie bei Mac-Apps üblich.
   „Jetzt aktualisieren“ lädt und installiert nur (`update.download()` + `update.install()`, Fortschritt im Toast, man
   kann weiterarbeiten). Danach Toast „Update bereit · Jetzt neu starten · Später“. „Später“ (oder Toast wegklicken)
   ⇒ die neue Version ist beim nächsten Start einfach da, ohne weitere Frage. Neustart (`relaunch()`) nie
   automatisch, nur auf Klick; hat die offene Schublade ungespeicherte Eingaben (`useUi.ungespeichert`, setzt die
   Schublade selbst), wird vorher nachgefragt. **In Debug-Builds (`npm run tauri dev`) wird nie installiert**
   (Rust-Command `ist_entwicklerversion`): Dort ist die App keine `.app`, der Updater hielte `src-tauri/target/debug`
   für das Bundle und ersetzte den Ordner durch die Release-App. Im Dev nur „Version X ist da (in der
   Entwicklerversion wird nicht installiert)“. Die Dev-App meldet immer ein Update, weil `main` die Version 0.1.0
   behält (§10 Stand).
6. Versionsnummer nach SemVer in `tauri.conf.json` und `package.json` gleich halten; „Was ist neu“ in `notes`.
   Nach dem ersten Update einmal prüfen, dass die App ohne erneute Freigabe startet.

**Download-Seite** (fertig im Ordner `download-seite/`, gleiche Optik wie die App): `index.html` mit Download-Knopf, Funktionen,
„Deine Daten bleiben auf deinem Mac“, Installationsschritten inkl. „Dennoch öffnen“ (gezeichnete Illustration), „Was ist neu“
und Fragen; `impressum.html` und `datenschutz.html` als **Muster mit Platzhaltern** (gelber Hinweisbalken, solange etwas
fehlt); `seite.js` liest Version, Größe, `.dmg`-Link und Release-Notizen über die GitHub-API (ohne Repository-Eintrag läuft
sie im Beispielmodus). Keine externen Schriften, kein Tracking, keine Cookies. Veröffentlichen mit **GitHub Pages**
(Ordner als `docs/` ins Repository, Settings → Pages); vorher in `seite.js` `KONFIG.github` eintragen und die Platzhalter
in Impressum (§ 5 DDG) und Datenschutz ausfüllen. Details: `download-seite/LIESMICH.md`.

**Lizenz des Repositorys:** **MIT** (Datei `LICENSE` mit „Copyright (c) 2026 <Name>“) – einfach, mit allen Abhängigkeiten
verträglich (Tauri MIT/Apache-2.0, Tectonic MIT, pdf.js Apache-2.0) und mit Gewährleistungsausschluss. Wer verhindern
will, dass jemand eine veränderte Fassung geschlossen weiterverkauft, nimmt **GPL-3.0**. Die App zeigt unter
„Über Kladdy“ → „Lizenzen“ die Lizenztexte der mitgelieferten Bibliotheken (z. B. erzeugt mit `cargo about` und
`license-checker`), denn MIT/Apache verlangen, dass sie mitgeliefert werden.

**Datenbank – ist eine bestimmte nötig?** Nein, es braucht **keinen Datenbank-Server** und nichts, was der Nutzer installieren
muss. Empfohlen ist **SQLite**: eine einzelne Datei in `appDataDir()`, über `tauri-plugin-sql` direkt in die App eingebaut,
mit Transaktionen (Beleg + Einnahme atomar), Triggern (GoBD-Festschreibung) und einfachem Backup (`VACUUM INTO`). Wichtig für
Updates: Schema-Änderungen nur als **nummerierte Migrationen** (0001, 0002, …), die beim Start automatisch und nur vorwärts
laufen – vorher Backup. Nicht empfohlen: Daten nur im `localStorage`/IndexedDB des WebViews (kann verloren gehen, schlecht zu
sichern) oder lose JSON-Dateien (keine Transaktionen). Später ist ein Sync (z. B. zweiter Mac) nachrüstbar, ohne die
lokale Speicherung aufzugeben.

**Tectonic mitliefern.** Auf fremden Macs gibt es kein Homebrew-Tectonic. Für die verteilte App Tectonic als **Sidecar**
bündeln (`"bundle": { "externalBin": ["binaries/tectonic"] }`, Datei `src-tauri/binaries/tectonic-aarch64-apple-darwin`);
Tauri signiert sie mit. **Nicht** einfach die Homebrew-Datei kopieren: Sie lädt Bibliotheken aus `/opt/homebrew`
(harfbuzz, icu4c, freetype …), die es auf anderen Macs nicht gibt. Ein eigenständiges Binary nehmen (z. B. aus den
GitHub-Releases von Tectonic) und mit `otool -L` prüfen, dass nur System-Bibliotheken verlinkt sind. Tectonic lädt beim
ersten PDF einmalig seine TeX-Pakete aus dem Internet und cacht sie (Hinweis in der App: „Erstes PDF dauert etwas länger“).

---

## 4. Projektstruktur

```
kladdy/
├─ ANLEITUNG.md                 ← diese Datei
├─ CLAUDE.md                    ← aus §11
├─ referenz/                    ← prototyp/ + beispiel-belege/ (§0), optional PowerAnalytic styles.css + Screenshots
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs / lib.rs       ← Plugins, Menü, Commands registrieren
│  │  ├─ latex.rs               ← compile_latex (Tectonic aufrufen, Log parsen)
│  │  ├─ belege.rs              ← Beleg kopieren, SHA-256, Pfad zurückgeben
│  │  ├─ buchhaltung.rs         ← finalize_invoice, storno, festschreiben (Transaktionen)
│  │  └─ backup.rs              ← VACUUM INTO + Belege zippen
│  ├─ migrations/               ← 0001_init.sql, …
│  └─ capabilities/default.json
├─ src/
│  ├─ styles/ tokens.css · base.css · components.css · charts.css
│  ├─ components/
│  │  ├─ shell/ AppShell · Sidebar · Topbar · SearchCommand · SettingsDrawer
│  │  ├─ ui/ Card · KpiTile · Seg · Badge · Chip · Button · IconButton · Field · MoneyInput ·
│  │  │      Switch · Drawer · Toast · Skeleton · Dropzone · Progress · Tooltip · EmptyState
│  │  ├─ charts/ BarChart · AreaChart · Donut · Sparkline · ChartTip · Legend
│  │  └─ ErfassenDrawer.tsx     ← der EINE Erfassen-Weg (Knopf bei Ein- & Ausgänge, ⌘N, Datei-Drop)
│  ├─ pages/ EinAusgaenge (Start) · Termine · Belege (Rechnungen & Quittungen) · BelegEditor · Vorlagen ·
│  │         Kunden · auswertung/ Ueberblick · Liquiditaet · Kennzahlen · Steuer
│  ├─ lib/
│  │  ├─ db.ts · queries/*.ts
│  │  ├─ money.ts · format.ts · dates.ts · numbering.ts
│  │  ├─ latex/ escape.ts · daten-tex.ts · zahl-in-worten.ts
│  │  ├─ formula/ lexer.ts · parser.ts · evaluate.ts · functions.ts · complete.ts
│  │  └─ euer.ts · kleinunternehmer.ts · prognose.ts (Liquidität) · export.ts · afa.ts · fristen.ts
│  ├─ templates/ rechnung-kleinunternehmer.tex · quittung.tex
│  └─ seed/ demo-daten.ts
└─ package.json
```

---

## 5. Datenmodell (SQLite, Startmigration)

```sql
-- Geld immer in Cent (INTEGER). Datum als 'YYYY-MM-DD'.
CREATE TABLE einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT NOT NULL);  -- JSON-Werte
-- Firmendaten, ust_modus ('klein'|'regel'), beleg_art ('quittung'|'rechnung' = „Beleg bei Einnahmen“), Darstellung,
-- tectonic_pfad, backup_ordner, firmenlogo (Dateiname in <appDataDir>/assets/, z. B. logo-3f9a…png; leer = App-Symbol) …

CREATE TABLE steuer_parameter (jahr INTEGER, schluessel TEXT, wert TEXT, PRIMARY KEY (jahr, schluessel));

CREATE TABLE kategorien (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, typ TEXT NOT NULL CHECK (typ IN ('einnahme','ausgabe')),
  euer_bereich TEXT, abziehbar_prozent INTEGER NOT NULL DEFAULT 100, zaehlt_ku_umsatz INTEGER NOT NULL DEFAULT 0,
  wareneingang INTEGER NOT NULL DEFAULT 0, privatanteil_standard INTEGER NOT NULL DEFAULT 0,
  farbe TEXT, icon TEXT, stichworte TEXT,       -- Stichworte kommagetrennt (Vorschlag beim Tippen/Erkennen)
  sortierung INTEGER, archiviert INTEGER NOT NULL DEFAULT 0
);

-- Keine Konten-Tabelle: Geschäfts- und Privatkonto sind oft dasselbe. Erfasst wird nur der Zahlungsweg je Buchung.

CREATE TABLE kunden (                          -- nur Kunden; Geschäfte bei Ausgaben sind Freitext (buchungen.lieferant)
  id INTEGER PRIMARY KEY, nummer TEXT NOT NULL UNIQUE,  -- feste Kundennummer K-0001 …, nie neu vergeben
  name TEXT NOT NULL, zusatz TEXT, strasse TEXT, plz TEXT, ort TEXT, land TEXT DEFAULT 'DE',
  email TEXT, telefon TEXT, notiz TEXT,        -- Notiz z. B. „Hund im Garten – Tor schließen“
  erstellt_am TEXT NOT NULL
);
-- Verlauf eines Kunden = seine Belege (rechnungen.kunde_id) + Einnahmen ohne Beleg (buchungen.kunde_id), nach Datum.

CREATE TABLE buchungen (
  id INTEGER PRIMARY KEY,
  nummer TEXT NOT NULL UNIQUE,                 -- fortlaufend, z. B. 2026-0001
  typ TEXT NOT NULL CHECK (typ IN ('einnahme','ausgabe')),
  zahlungsdatum TEXT NOT NULL,                 -- maßgeblich für EÜR (Zufluss/Abfluss)
  belegdatum TEXT,                             -- Datum auf dem Beleg
  betrag_cent INTEGER NOT NULL,                -- Endbetrag (brutto), immer positiv
  ust_satz INTEGER, ust_cent INTEGER,          -- nur Regelmodus
  privatanteil_prozent INTEGER NOT NULL DEFAULT 0,
  kategorie_id INTEGER NOT NULL REFERENCES kategorien(id),
  kunde_id INTEGER REFERENCES kunden(id),      -- bei Einnahmen
  lieferant TEXT,                              -- bei Ausgaben: Geschäft als Freitext, z. B. „Aral Tankstelle“
  art TEXT NOT NULL DEFAULT 'zahlung' CHECK (art IN ('zahlung','afa','pauschale')),  -- afa/pauschale = ohne Geldfluss
  zahlungsart TEXT CHECK (zahlungsart IN ('bar','bank','paypal')),  -- bank = Überweisung/Karte; NULL nur bei art <> 'zahlung'
  belegnummer TEXT,                            -- QU-/RE-Nummer bzw. Nummer auf dem Fremdbeleg
  beschreibung TEXT NOT NULL,
  extra_json TEXT,                             -- z. B. Bewirtung {anlass, teilnehmer, ort}, Geschenk {empfaenger}
  rechnung_id INTEGER REFERENCES rechnungen(id),
  termin_id INTEGER REFERENCES termine(id),    -- Einnahme zu einem Termin ohne eigenen Beleg
  anlage_id INTEGER REFERENCES anlagen(id),
  storno_von_id INTEGER REFERENCES buchungen(id),
  wiederkehrend_id INTEGER REFERENCES wiederkehrend(id),
  festgeschrieben INTEGER NOT NULL DEFAULT 0,
  erstellt_am TEXT NOT NULL, geaendert_am TEXT NOT NULL
);

CREATE TABLE belege (
  id INTEGER PRIMARY KEY, buchung_id INTEGER REFERENCES buchungen(id), rechnung_id INTEGER REFERENCES rechnungen(id),
  pfad TEXT NOT NULL, originalname TEXT, mime TEXT, sha256 TEXT NOT NULL, groesse INTEGER,
  art TEXT NOT NULL DEFAULT 'beleg',           -- 'beleg' | 'erechnung_xml' | 'rechnung_pdf'
  aufbewahren_bis TEXT NOT NULL, erstellt_am TEXT NOT NULL
);

CREATE TABLE nummernkreise (
  id TEXT PRIMARY KEY,                         -- 'buchung' | 'rechnung' | 'quittung' | 'angebot' | 'eigenbeleg' | 'kunde'
  muster TEXT NOT NULL,                        -- z. B. 'RE-{JJJJ}-{NNN}', Kunde 'K-{NNNN}'
  jahr INTEGER NOT NULL, naechste INTEGER NOT NULL  -- jahr = 0 bei jahresunabhängigen Kreisen (Kunde)
);

CREATE TABLE rechnungen (
  id INTEGER PRIMARY KEY,
  art TEXT NOT NULL CHECK (art IN ('rechnung','quittung','angebot','eigenbeleg','gutschrift','storno')),
  nummer TEXT UNIQUE,                          -- NULL solange Entwurf
  status TEXT NOT NULL CHECK (status IN ('entwurf','offen','bezahlt','storniert','angenommen','abgelehnt')),
  kunde_id INTEGER REFERENCES kunden(id),      -- Quittung/Rechnung/Angebot: Kunde (neu angelegt beim Finalisieren);
                                               -- Eigenbeleg: kein Kunde, Empfänger = Geschäft (Freitext in kunde_name)
  kunde_name TEXT, kunde_adresse TEXT, kunde_nummer TEXT,  -- Schnappschuss beim Finalisieren (GoBD: Beleg bleibt unverändert)
  datum TEXT, leistung_von TEXT, leistung_bis TEXT, faellig_am TEXT,
  betreff TEXT, einleitung TEXT, schlusstext TEXT,
  summe_cent INTEGER NOT NULL DEFAULT 0,
  vorlage_id INTEGER REFERENCES vorlagen(id),
  pdf_beleg_id INTEGER REFERENCES belege(id),
  scan_beleg_id INTEGER REFERENCES belege(id), -- optional: unterschriebenes Exemplar (Schritt 2)
  termin_id INTEGER REFERENCES termine(id),    -- vorbereitet für / ausgestellt zu diesem Termin
  snapshot_json TEXT,                          -- eingefrorene Daten beim Finalisieren
  bezahlt_am TEXT, storno_von_id INTEGER REFERENCES rechnungen(id),
  erstellt_am TEXT NOT NULL, geaendert_am TEXT NOT NULL
);

CREATE TABLE termine (                         -- Kundentermine (§6.5)
  id INTEGER PRIMARY KEY, kunde_id INTEGER REFERENCES kunden(id),
  datum TEXT NOT NULL, von TEXT, bis TEXT,     -- 'YYYY-MM-DD', 'HH:MM'
  adresse TEXT, leistung TEXT NOT NULL, betrag_geschaetzt_cent INTEGER, notiz TEXT,
  status TEXT NOT NULL DEFAULT 'geplant' CHECK (status IN ('geplant','erledigt','abgesagt')),
  ohne_beleg INTEGER NOT NULL DEFAULT 0,       -- erledigt und bewusst „Ohne Beleg abschließen“ (z. B. Nachbesserung)
  kalender_id TEXT,                            -- optional: EventKit-ID im Apple Kalender
  erstellt_am TEXT NOT NULL, geaendert_am TEXT NOT NULL
);
-- vorbereiteter Beleg: rechnungen.termin_id gesetzt, status 'entwurf', nummer NULL (Nummer erst beim Ausstellen);
-- Absage verwirft den Entwurf (Protokoll-Aktion 'geloescht_entwurf'), ein Storno ist nicht nötig

CREATE TABLE rechnungspositionen (
  id INTEGER PRIMARY KEY, rechnung_id INTEGER NOT NULL REFERENCES rechnungen(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL, beschreibung TEXT NOT NULL, menge REAL NOT NULL DEFAULT 1, einheit TEXT,
  einzelpreis_cent INTEGER NOT NULL, ust_satz INTEGER, kategorie_id INTEGER REFERENCES kategorien(id)
);

CREATE TABLE vorlagen (                       -- Block-Baukasten (§7)
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, art TEXT NOT NULL,  -- wie rechnungen.art
  bloecke_json TEXT NOT NULL,                  -- [{ "typ": "kopf", "logo": true }, { "typ": "positionen", … }, …]
  ist_standard INTEGER NOT NULL DEFAULT 0, geaendert_am TEXT NOT NULL
);
CREATE TABLE planposten (                      -- geplante Zahlungen für die Vorschau (Auswertung → Liquidität)
  id INTEGER PRIMARY KEY, datum TEXT NOT NULL, text TEXT NOT NULL, betrag_cent INTEGER NOT NULL  -- negativ = Ausgabe
);
CREATE TABLE vorlagen_assets (id INTEGER PRIMARY KEY, vorlage_id INTEGER REFERENCES vorlagen(id),
  dateiname TEXT NOT NULL, pfad TEXT NOT NULL);  -- z. B. logo.png, unterschrift.png

CREATE TABLE anlagen (
  id INTEGER PRIMARY KEY, bezeichnung TEXT NOT NULL, anschaffung_datum TEXT NOT NULL,
  kosten_cent INTEGER NOT NULL, nutzungsdauer_jahre INTEGER NOT NULL, methode TEXT NOT NULL DEFAULT 'linear',
  abgang_datum TEXT, abgang_erloes_cent INTEGER, buchung_id INTEGER REFERENCES buchungen(id)
);

CREATE TABLE fahrten (id INTEGER PRIMARY KEY, datum TEXT NOT NULL, start TEXT, ziel TEXT NOT NULL,
  zweck TEXT NOT NULL, km REAL NOT NULL, kunde_id INTEGER REFERENCES kunden(id));

CREATE TABLE wiederkehrend (id INTEGER PRIMARY KEY, vorlage_json TEXT NOT NULL, rhythmus TEXT NOT NULL,
  naechstes_datum TEXT NOT NULL, aktiv INTEGER NOT NULL DEFAULT 1);

CREATE TABLE variablen (name TEXT PRIMARY KEY, wert TEXT NOT NULL, beschreibung TEXT);  -- für Formeln

CREATE TABLE kennzahlen (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, formel TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'eur' CHECK (format IN ('eur','prozent','zahl','tage')),
  nachkommastellen INTEGER NOT NULL DEFAULT 2, beschreibung TEXT,
  ampel_json TEXT,                             -- z. B. {"gruen":0.3,"gelb":0.1} bzw. mit "richtung":"niedrig" (kleiner = besser)
  vergleich TEXT DEFAULT 'vorperiode',         -- 'keiner' | 'vorperiode' | 'vorjahr'
  zeitraum_fix TEXT,                           -- NULL = globaler Zeitraum, sonst z. B. 'JAHR'
  angeheftet INTEGER NOT NULL DEFAULT 0, sortierung INTEGER  -- angeheftet = im Überblick der Auswertung
);

CREATE TABLE festschreibungen (bis_datum TEXT PRIMARY KEY, am TEXT NOT NULL);

CREATE TABLE protokoll (                         -- GoBD-Änderungsprotokoll
  id INTEGER PRIMARY KEY, zeitpunkt TEXT NOT NULL, tabelle TEXT NOT NULL, datensatz_id INTEGER NOT NULL,
  aktion TEXT NOT NULL CHECK (aktion IN ('neu','geaendert','storniert','geloescht_entwurf')),
  alt_json TEXT, neu_json TEXT
);
```

Regeln:
- Buchungen mit `zahlungsdatum <= festschreibungen.bis_datum` sind schreibgeschützt (UI **und** Trigger in SQLite).
- Rechnungs- und Buchungsnummer werden atomar vergeben:
  `UPDATE nummernkreise SET naechste = naechste + 1 WHERE id = ? RETURNING naechste - 1`.
- Quittung ausstellen ⇒ Beleg **und** Einnahme-Buchung in einer Transaktion (Quittung ist immer bezahlt).
- Rechnung „bezahlt“ ⇒ Einnahme-Buchung mit `zahlungsdatum = bezahlt_am`, `rechnung_id` gesetzt; zurück auf „offen“ ⇒
  Storno-Buchung (`storno_von_id`), die ursprüngliche Buchung bleibt erhalten.
- Jede Änderung an `buchungen`, `rechnungen`, `belege` ⇒ Eintrag in `protokoll`.
- **Buchungen ohne Geldfluss** (`art` = 'afa' bzw. 'pauschale', z. B. jährliche Abschreibung, Kilometer- oder
  Homeoffice-Pauschale) haben keinen Zahlungsweg, zählen in der EÜR, aber **nicht** in der Liquiditätsvorschau und nicht
  in „ohne Beleg“. Sie erscheinen in Ein- & Ausgänge mit eigenem Symbol und sind nur über das Anlagen- bzw.
  Pauschalen-Modul änderbar.
- **Storno einer Buchung:** Gegenbuchung mit `storno_von_id` (höchstens eine je Buchung, eindeutiger Index), gleicher
  Typ, gleiche Kategorie, `betrag_cent` ebenfalls positiv. **Zeilen mit `storno_von_id` zählen in allen Summen negativ.**
  Zahlungsdatum wie das Original, liegt es im festgeschriebenen Zeitraum, dann der Tag des Stornos. Die Liste zeigt das
  Original durchgestrichen mit „storniert“, die Gegenbuchung selbst nicht.
- **Buchungsnummer:** Jahr der Erfassung (nicht das Zahlungsdatum), der Kreis läuft nie rückwärts; Nachträge im Januar
  für Dezember erhalten also eine Nummer des neuen Jahres.
- **Kauf eines Anlageguts** (über der GWG-Grenze): echte Zahlung (`art` 'zahlung', mit Beleg und Zahlungsweg), aber in der
  EÜR nicht sofort abziehbar – sie verweist per `anlage_id` auf die Anlage, abgezogen wird über die AfA-Buchungen.

---

## 6. Seiten & Funktionen

**Grundsätze (gelten für jede Seite):**
- **Jede Funktion genau einmal.** Ein- und Ausgänge werden nur über **„+ Erfassen“** im Kopf von Ein- & Ausgänge (⌘N von
  überall) bzw. per Datei-Drop erfasst. Keine zweiten Erfassen-Knöpfe – auch nicht in der Kopfzeile, wo er z. B. bei Terminen
  fehl am Platz wäre –, keine Schnellerfassungs-Zeilen in Listen. Andere Stellen dürfen die Erfassen-Schublade
  nur *vorbelegt öffnen* (z. B. „Neuen Auftrag erfassen“ beim Kunden), aber keinen eigenen Erfassen-Weg haben.
- **Statistik nur in der Auswertung.** Listen (Ein- & Ausgänge, Rechnungen & Quittungen, Kunden) zeigen keine KPI-Kacheln oder
  Summenzeilen, höchstens die Anzahl der Einträge.
- **Keine Konten.** Statt Kontoständen gibt es je Zahlung den Zahlungsweg (Bar · Überweisung/Karte · PayPal), siehe §2.8.
- **Laufende Nummern** für alles, was man selbst ausstellt (Quittung QU-JJJJ-NNN, Rechnung RE-JJJJ-NNN, Angebot AN-…, Eigenbeleg EB-…).
- Einstellungen **nur** als ⚙ oben rechts; die Marke oben links führt zur Startseite (Ein- & Ausgänge).

### 6.1 Seitenleiste (272 px, einklappbar auf 76 px)
Nur Navigation, genau **fünf Einträge** (Icon + Name, aktiver Eintrag `accent-soft` + 2-px-Akzentkante links):
**Ein- & Ausgänge** (Zähler „3“ = ohne Beleg) · **Termine** (Zähler = heute, rot = nachzutragen bzw. Beleg fehlt) · **Rechnungen & Quittungen** (roter Zähler = überfällig) · **Kunden** · **Auswertung**.
Unterseiten markieren ihren Menüpunkt mit (Beleg-Maske und Vorlagen → Rechnungen & Quittungen; Liquidität, Kennzahlen,
Steuer & Export → Auswertung). Keine Konten, keine Monatsbilanz, keine Liste offener Posten in der Seitenleiste.
**Eingeklappt** nur die Icons, **mittig** (Beschriftung nimmt dann keinen Platz mehr ein: `flex: 0 0 0`), Zähler als kleines
Bläschen oben rechts am Icon, Name als Tooltip.

### 6.2 Kopfzeile (68 px, Glas) und der eine Erfassen-Weg
Links Seitenleisten-Knopf · Mitte **Suche/Befehlspalette** (⌘K): durchsucht Ein- & Ausgänge, Belege, Termine, Kunden,
Kennzahlen und Seiten (auch die Reiter der Auswertung). Mit `>` am Anfang nur Befehle: „Ausgabe erfassen“, „Einnahme
erfassen“, „Quittung schreiben“, „Rechnung schreiben“ (beide öffnen die Erfassen-Schublade mit vorgewähltem Beleg),
„Termin eintragen“, „Angebot schreiben“, „Eigenbeleg erstellen“, „Vorlagen bearbeiten“, „Kunde anlegen“, Hell/Dunkel (⇧⌘L),
Einstellungen.
Rechts nur Hell/Dunkel · ⚙. **Kein Erfassen-Knopf in der Kopfzeile** – der sitzt auf der Seite Ein- & Ausgänge (§6.3);
⌘N öffnet die Erfassen-Schublade trotzdem von jeder Seite aus.

### 6.3 Ein- & Ausgänge (Startseite)
Eine ruhige Liste aller geschäftlichen Zahlungen – kein Kontoauszug, keine Salden, keine Summen-Kacheln.
- **Kopf in drei Teilen:** links Titel „Ein- & Ausgänge“ mit Untertitel „es zählt das Zahlungsdatum“ · **mittig der Zeitraum**
  (Monat · Quartal · Jahr ‹ ›) · rechts der Primärknopf **„+ Erfassen“** (⌘N). Titel- und Knopfspalte wachsen gleich
  (`flex: 1 1 0`), so steht der Zeitraum in der Mitte. Wird der Kopf zu schmal (Container-Query < 960 px), rutscht der
  Zeitraum in eine eigene Zeile unter den Titel; „+ Erfassen“ bleibt rechts oben.
- **Klebrige Filterleiste in einer Zeile:** Tabs Alle/Eingänge/Ausgänge (mit Zählern) · Suche · „Filter“-Knopf (Popover:
  Kategorie, Zahlungsweg Bar/Überweisung/PayPal, nur ohne Beleg). Aktive Filter als entfernbare Chips darunter. Hinweis-Link
  „3 ohne Beleg“ (filtert genau diese).
- **Tabelle** (`table-layout: fixed`, Zeilenhöhe ~46 px, neueste zuerst): Datum · **Beleg-Nr.** (mono; QU/RE als Link auf den
  Beleg, 📎 wenn Datei vorhanden, „fehlt“-Badge) · Beschreibung, darunter Kunde bzw. Geschäft (muted) · Kategorie ·
  Zahlungsweg (Icon + Name) · Betrag (Eingang `--pos` „+“, Ausgang „−“) · beim Hover ✎ Bearbeiten (mit Protokoll) / 🗑 Entfernen.
  Der Prototyp löscht dabei sofort (mit Rückgängig); in der App wird stattdessen **storniert** (Gegenbuchung, GoBD).
  Zahlungen zu einem ausgestellten Beleg zeigen ein Schloss: nur per Storno des Belegs änderbar (GoBD).
- Unter der Tabelle nur die Anzahl („142 Einträge“). Summen und Diagramme stehen in der Auswertung.
- Leerer Zustand: „Noch nichts im Zeitraum – oben rechts **+ Erfassen** oder ein Beleg-PDF aufs Fenster ziehen.“

### 6.4 Erfassen-Schublade (von rechts, 520 px)
Öffnet sich über „+ Erfassen“, ⌘N, Datei-Drop, Befehlspalette oder vorbelegt aus anderen Seiten
(`erfassen({ typ, beleg, kunde, betrag, text, datum, entwurf, termin })`; mit `entwurf` wird ein vorbereiteter Beleg ohne
Nummer ausgestellt statt ein neuer angelegt – im Prototyp heißt der Kunden-Parameter noch `kontakt`).
1. Typ-Umschalter **Ausgabe | Einnahme**
2. **Betrag groß zuerst** (1.6rem, Cent-genau, akzeptiert „12,5“ und „12.50“)
3. **Kategorie als Icon-Kacheln** (3 Kosten-Kategorien bzw. Dienstleistung; beim Tippen über die Stichworte vorgeschlagen, z. B. „Tanken“ ⇒ Sprit)
4. Zahlungsdatum (Standard heute), Beleg-Nr., Beschreibung, **Wer**: bei Einnahmen **Kunde** (Vorschläge „Name · K-0012“, bei gleichem
   Namen Nachfrage, §6.8; ein neuer Name legt einen Kunden an), bei Ausgaben **Geschäft** (Freitext mit Vorschlägen aus bisherigen Ausgaben, z. B. „Aral Tankstelle“).
   „Mehr Optionen“: Privatanteil in %.
5. **Bezahlt per:** drei Kacheln **Bar · Überweisung (auch Karte) · PayPal**.
6. **Beleg** – abhängig vom Typ:
   - **Ausgabe:** Dropzone mit Erkennung (s. u.) oder „Kein Beleg? ⇒ Eigenbeleg erstellen“.
   - **Einnahme:** Abschnitt „Beleg zum Ertrag“ (Beschriftung wie im Prototyp) mit drei Wegen: **Beleg erstellen** (Standard) ·
     **Offene Rechnung zuordnen** · **Ohne eigenen Beleg**. Bei „Beleg erstellen“ wählt man nur die **Art: Quittung | Rechnung**
     (Vorauswahl aus Einstellungen → Belege, Standard Quittung; bei Rechnung zusätzlich „bereits bezahlt | noch offen“),
     dazu eine **Vorlage** (Standard oder eigene aus dem Baukasten §7); angezeigt wird die Nummer, die vergeben wird
     („erhält Nr. QU-2026-105“). Ein dezenter Hinweis bei Quittung + Bar: „Will der Kunde die Arbeitskosten absetzen
     (§ 35a)? Dann Rechnung – absetzbar nur bei Überweisung.“ Speichern legt Beleg **und** Einnahme in einer Transaktion an
     und verknüpft beide (Toast „Einnahme gespeichert · QU-2026-105 erstellt“ mit „Beleg öffnen“). Eine „noch offene“
     Rechnung erscheint unter Rechnungen & Quittungen → Offen; die Einnahme entsteht erst beim Zahlungseingang.
   - **Schritt 2 (optional):** „Unterschriebenes Exemplar anhängen“ – Scan/Foto ergänzt den Beleg (`scan_beleg_id`), ersetzt ihn nicht.
7. Speichern (⌘↩), „Speichern & neu“ (⇧⌘↩). Toast mit Rückgängig.

**Drag & Drop auf das Fenster (auf jeder Seite):** Overlay „Beleg hier ablegen“ ⇒ die Erfassen-Schublade öffnet sich mit dem
Beleg und **vorausgefüllten Feldern**; jedes erkannte Feld ist als Vorschlag markiert („aus PDF“ / „aus Dateiname“), oben eine
Zusammenfassung („Erkannt: 47,83 € · 12.09.2026 · Bauhaus · Material“).
- **Erkennung in der Mac-App:** Text aus PDFs mit pdf.js (`getTextContent`), bei Scans und Fotos Texterkennung mit dem
  **macOS-Vision-Framework** (kleines Swift-Hilfsprogramm als Sidecar, Phase 7). Danach dieselben Regeln wie im Prototyp
  (`prototyp/js/beleg.js`): Betrag neben „Gesamt/Summe/zu zahlen“, Datum neben „Rechnungsdatum“ – bei **Lastschrift** zählt das
  Abbuchungsdatum („wird am … abgebucht“) als Zahlungsdatum (§ 11 EStG, Hinweis „Rechnungsdatum … · abgebucht am …“), Rechnungsnummer, Geschäft
  (Kopfzeilen des Belegs, Abgleich mit bisherigen Geschäften), Kategorie (Historie des Geschäfts, sonst Stichwortliste). Eigene
  Rechnungen (mit eigener Steuernummer) werden als Einnahme erkannt.
- Original-Datei immer unverändert ablegen (Hash), Erkennung nur als Vorschlag.

### 6.5 Termine
Kundentermine planen und dazu auf Wunsch schon die **Quittung (oder Rechnung) vorbereiten**.
- **Kopf:** Titel, rechts der Primärknopf **„+ Termin eintragen“** (wie „+ Erfassen“ eingefärbt; öffnet die eine Termin-Schublade; dieselbe öffnen auch Kundenseite und
  Befehlspalette, ggf. vorbelegt). Filter **Anstehend ·
  Erledigt · Alle**; optional ein schmaler Wochenstreifen (diese/nächste Woche, Punkte je Termin).
- **Agenda nach Tagen** (Heute, Morgen, …). Oben, falls vorhanden, **„Nachtragen“**: geplante Termine in der Vergangenheit
  („War der Termin?“). Je Termin: Uhrzeit, Kunde (Link), Leistung, Adresse (Karten-Link), geschätzter Betrag, Notiz, Beleg-Chip
  („Quittung vorbereitet“ bzw. nach dem Termin „QU-2026-096 ✓“).
- **Termin-Schublade:** Kunde (Vorschläge; neuer Name legt einen Kunden an), Datum, von–bis, Adresse, Leistung, geschätzter
  Betrag, Notiz, **„Beleg vorbereiten: Quittung | Rechnung | Keinen“** (Vorauswahl: Einstellung „Beleg bei Einnahmen“).
- **Vorbereiteter Beleg = Entwurf ohne Nummer** (`rechnungen.termin_id`). Er steht unter Rechnungen & Quittungen → **Offen**
  als „Vorbereitet · Termin 14.10.“ Die **Nummer wird erst beim Ausstellen** vergeben (GoBD: keine Lücken).
- **Abhaken und Beleg sind zwei Schritte** (erledigt ≠ bezahlt; abends mehrere Termine schnell abhaken):
  1. **„✓ Erledigt“** (nur für heute und Vergangenes) markiert nur den Termin – keine Navigation, Toast mit „Quittung
     ausstellen“ und Rückgängig.
  2. **„Quittung ausstellen“** (bzw. „Rechnung schreiben“) öffnet die **eine Erfassen-Schublade**, vorbefüllt aus dem
     vorbereiteten Beleg (Kunde, Betrag, Leistung, Vorlage). Speichern stellt **diesen Entwurf** mit Nummer aus; bei einer
     Quittung wird zugleich die Einnahme gebucht, eine Rechnung ist standardmäßig „noch offen“ (Einnahme erst bei Zahlung).
     Derselbe Knopf steht in der Maske eines vorbereiteten Belegs – es gibt keinen zweiten Ausstell-Weg.
  - Erledigte Termine **ohne Beleg** stehen unter „Nachtragen“ mit Chip „Beleg fehlt“ und zählen im Menü-Zähler, bis ein
    Beleg ausgestellt oder „Ohne Beleg abschließen“ gewählt ist (z. B. Nachbesserung). „Doch nicht erledigt“ setzt zurück.
  - Andere Wege in der Erfassen-Schublade bleiben konsistent: **„Offene Rechnung zuordnen“** macht die bezahlte Rechnung zum
    Beleg des Termins; **„Ohne eigenen Beleg“** schließt den Termin „ohne Beleg“ ab und verknüpft die Einnahme
    (`buchungen.termin_id`). In beiden Fällen wird eine unnummerierte Vorbereitung verworfen; ein Besuch zählt beim Kunden
    immer nur einmal.
- **„Absagen“:** Termin „abgesagt“ (Grund optional, wird an die Notiz angehängt); der vorbereitete Entwurf wird verworfen –
  **kein Storno nötig**, weil er noch keine Nummer hatte. Rückgängig per Toast; „Wieder einplanen“ bei abgesagten Terminen.
- Seitenleisten-Zähler: Termine heute bzw. rot die nachzutragenden und erledigten ohne Beleg. Kundenseite zeigt den nächsten Termin.
- **In der Mac-App zusätzlich:** Termin in den **Apple Kalender** übernehmen (EventKit; im Prototyp als `.ics`-Download) und
  eine Mitteilung am Morgen des Termins (Phase 7).

### 6.6 Rechnungen & Quittungen
- **Kopf:** Titel, rechts der Zeitraum, **„Vorlagen“** (⇒ Baukasten §7) und ein kleines **„Neu“-Menü**, das die nächsten Nummern zeigt:
  Quittung · QU-2026-105 und Rechnung · RE-2026-015 (beide öffnen die **Erfassen-Schublade** mit vorgewähltem Beleg – es gibt
  keinen zweiten Weg), Angebot · AN-… und Eigenbeleg · EB-… (öffnen direkt die Maske). Keine KPI-Kacheln.
- **Liste nach Nummern**, nicht nach Kunden, mit **nur drei Filtern: Alle · Offen · Bezahlt** (mit Anzahl) und der Suche in
  einer ruhigen Zeile. Die Belegart (Quittung, Rechnung, Angebot, Eigenbeleg) steht in der Spalte „Art“ – keine eigenen Reiter
  dafür. „Offen“ = offene Rechnungen plus für geplante Termine vorbereitete Belege; „Bezahlt“ = bezahlte Rechnungen,
  Quittungen und gebuchte Eigenbelege; Entwürfe, Angebote und Stornos nur unter „Alle“. Spalten: Nr. · Art · Kunde · Betreff ·
  Datum · Fällig/Zahlung · Betrag · Status; Kunde als Text; unten nur die Anzahl.
- **Zeitraum** rechts im Seitenkopf (neben „Vorlagen“ und „Neu“): **Monat · Jahr · Gesamt** mit ‹ › (Standard beim Start:
  aktueller Monat), gefiltert nach Belegdatum. Ausnahmen: „Offen“ zeigt immer **alle** offenen Rechnungen (Überfällige
  zuerst, rot); die Suche durchsucht alle Zeiträume.
- Status-Badges: Entwurf (neutral) · Offen (Akzent) · Überfällig (`--neg`) · Bezahlt (`--pos`) · Storniert (durchgestrichen) ·
  Angenommen/Abgelehnt (Angebote).
- **Status selbst festlegen:** Klick aufs Badge (Liste und Maske) öffnet ein kleines Menü mit den erlaubten Wechseln:
  Rechnung **Offen ⇄ Bezahlt** (Bezahlt fragt Datum + Zahlungsweg und bucht die Einnahme; zurück auf Offen nimmt die
  Einnahme wieder heraus – in der App per Storno-Buchung, mit Protokoll), Quittung ist immer bezahlt (nur Stornieren;
  „als Rechnung neu ausstellen“ für Verwechslungen), Angebot Offen · Angenommen · Abgelehnt, Eigenbeleg nur Stornieren.
  Ein versehentlicher Haken ist so jederzeit umkehrbar. Nummer, Datum und Beträge bleiben unverändert; Storniert ist endgültig (GoBD).
- **Eine Maske für alles** (`#/beleg/…`): Art-Umschalter (Rechnung · Quittung · Angebot · Eigenbeleg), Vorlagen-Auswahl, links
  das Formular (Kunde mit Vorschlägen aus den Kunden, Datum, Leistungszeitraum, Zahlungsziel ⇒ Fälligkeit, Betreff, Einleitung,
  **Positionen** mit Ziehen zum Umsortieren, Schlusstext), rechts die **Live-Papiervorschau** (skaliert auf die Spaltenbreite).
  „Drucken / PDF“ druckt **nur** das Blatt in Originalgröße (A4 hochkant bzw. A5 quer); in der Mac-App erzeugt Tectonic das
  PDF, danach der macOS-Druckdialog mit „Als PDF sichern“. ⌘P in der Maske druckt den Beleg.
- **Pflichtangaben-Check** vor dem Finalisieren (§2.3): Fehlendes wird rot markiert.
- **Finalisieren** (= Ausstellen; Knopf in der Maske, bei Quittung „Finalisieren & buchen“): vergibt die Nummer, erzeugt das
  PDF, speichert es als Beleg, friert die Daten ein (`snapshot_json`, Kundendaten als Schnappschuss) und legt einen neuen
  Kunden an, falls der Name noch unbekannt ist. Danach keine Änderung mehr, nur noch **Stornorechnung**.
- Aktionen: PDF öffnen, im Finder zeigen, **per Mail senden** (`mailto:`), als bezahlt markieren (Datum + Zahlungsweg ⇒
  Einnahme), duplizieren, Angebot ⇒ Rechnung umwandeln, unterschriebenes Exemplar anhängen.
- **Quittung** ⇒ A5 quer, „Betrag in Worten“ automatisch; bis 250 € Kleinbetragsrechnung (Hinweis in der Maske).
- **Eigenbeleg (Ersatzbeleg)** für Ausgaben ohne Originalbeleg: Datum, Betrag, Zahlungsempfänger (Geschäft), Zweck, Grund,
  Kategorie, Unterschriftszeile ⇒ PDF **und** direkt als Ausgabe erfasst.
- **GiroCode (EPC-QR) auf der Rechnung**, ein-/ausschaltbar: Inhalt nach EPC069-12 Version 002, UTF-8, `SCT`, BIC,
  Name, IBAN, `EUR<Betrag>`, Verwendungszweck = Rechnungsnummer, max. 331 Byte, Fehlerkorrektur **M**. Darunter
  „Mit der Banking-App scannen und bezahlen“ und die IBAN. Fehler (z. B. IBAN-Prüfsumme) stehen im Formular, nie auf dem Blatt.
  Für das PDF erzeugt die App den Code als PNG (`girocode.png`) neben `main.tex`, mit demselben Encoder wie in der Vorschau
  (Prototyp: `prototyp/js/qr.js`, gegen zwei unabhängige Decoder getestet).

### 6.7 Vorlagen (Baukasten) → siehe §7
Erreichbar über den Button „Vorlagen“ auf Rechnungen & Quittungen (kein eigener Menüpunkt), mit Rücklink.

### 6.8 Kunden
Wofür: sehen, **wie oft und wann** man bei einem Kunden war und **was gemacht wurde**. Keine Lieferanten (Geschäfte bei Ausgaben
sind Freitext), keine Unterteilung, keine Statistik-Kacheln.
- **Liste** (Standard: zuletzt da zuerst): Monogramm (Initialen auf einer aus dem Namen gehashten Farbe) + Name · Adresse kurz ·
  Anzahl Besuche · zuletzt da (Datum + „vor 12 Tagen“) · letzte Leistung · Umsatz gesamt (dezent) · Notiz-Symbol.
  Suche über Name, Straße, Ort, Telefon, Notiz, Leistung; Umschalter Alle · Stammkunden (2+ Besuche) · mit Notiz.
- **Besuch** = jede Quittung/Rechnung des Kunden bis heute (Stornos und für Termine vorbereitete Entwürfe ausgenommen) plus
  Einnahmen ohne eigenen Beleg; Angebote und Termine erscheinen im Verlauf, zählen aber nicht als Besuch. Der nächste Termin
  steht zusätzlich in der Liste (unter „zuletzt da“) und oben in der Schublade.
- **Detail-Schublade:** Name mit fester **Kundennummer** (K-0001 …), Kontaktdaten (Adresse als Karten-Link, Telefon/E-Mail als
  Links), Kennzeile „3 Besuche · zuletzt vor 12 Tagen · Kunde seit März 2025“, Hinweise (nächster Termin, nachzutragende
  Termine, offene Rechnungen), **Notiz** (z. B. „Hund im Garten – Tor schließen“, speichert automatisch), Stammdaten bearbeiten
  (bereits ausgestellte Belege behalten ihre Angaben), **Verlauf** neueste zuerst (Datum · Leistung mit Positionen · Betrag ·
  Beleg-Nr. als Link · Zahlungsweg · Status). Fuß: **„Termin eintragen“** (öffnet die Termin-Schublade) und **„Neuen Auftrag
  erfassen“** (öffnet die Erfassen-Schublade mit diesem Kunden). Löschen (🗑 im Fuß) nur, solange nichts am Kunden hängt.
- **Datenschutz (§2.10):** Unter der Notiz der Hinweis „Nur notieren, was du für den Auftrag brauchst – keine Angaben zu
  Gesundheit, Religion o. Ä.“. Hängen Buchungen oder ausgestellte Belege am Kunden, steht im Fuß statt 🗑 dezent
  **„🔒 Löschen ab 2037“** (Tooltip: aufzubewahren bis 31.12.2036, danach anonymisierbar; Jahr = Jahr der letzten Buchung bzw. des
  letzten Belegs + 10, ab dem 1.1. des Folgejahres). Ist die Frist vorbei, erscheint **„Anonymisieren“** (mit Rückfrage, nicht
  rückgängig zu machen): Name wird „Ehemaliger Kunde K-0012“, Anschrift, Kontakt und Notiz werden geleert – auch in den
  Schnappschüssen seiner Belege, Buchungen und Termine; Nummer, Beträge und Daten bleiben für die Auswertung.
- Kunden entstehen automatisch beim Finalisieren eines Belegs bzw. beim Erfassen einer Einnahme oder eines Termins mit neuem
  Namen; von Hand über den Primärknopf **„+ Kunde anlegen“** rechts im Seitenkopf (neben der Suche, wie „+ Erfassen“ eingefärbt).

- **Kunden immer über ihre Nummer wählen:** Verknüpft wird überall über die ID bzw. Kundennummer, nie über den Namen –
  gleiche Namen sind deshalb kein Problem. Alle Kundenfelder (Erfassen-Schublade, Termin-Schublade, Belegmaske) schlagen
  „Name · K-0012“ mit Adresse vor. Tippt man nur einen Namen, den es mehrfach gibt, erscheint „Mehrere Kunden heißen
  „Anna Schmidt“ – wer ist gemeint?“ mit je einem Knopf pro Treffer (Nummer, Adresse, zuletzt da) und „Neuer Kunde mit
  diesem Namen“; gespeichert wird erst nach der Wahl. Gibt es den Namen nur einmal, wird dieser Kunde vorgeschlagen und
  der Hinweis bietet „Andere Person? Als neuen Kunden anlegen“ – so landet eine neue Person nie still beim Namensvetter.
  Auf Belegen steht der Name ohne Nummer (Schnappschuss).

### 6.9 Auswertung (ein Menüpunkt, großer Umschalter)
Alle Statistik der App an einem Ort. Oben Titel „Auswertung“ + Zeitraum, darunter ein **großer Umschalter** mit vier Reitern
(Icon, Name, Untertitel; aktiver Reiter mit Akzentkante unten): **Überblick · Liquidität · Kennzahlen · Steuer & Export**.
Jeder Reiter hat eine eigene Adresse (Deep-Link, Zurück-Taste funktioniert). Kein Inhalt kommt in zwei Reitern vor.

#### 6.9.1 Überblick
- **Status-Pillen:** Kleinunternehmer (Umsatz von 25.000 € + Hochrechnung) · offene Rechnungen (überfällige pulsierend rot) ·
  ohne Beleg · Nächste 90 Tage (erwarteter Überschuss). Jede Pille springt dorthin, wo man es erledigt.
- **KPI-Reihe** (4 Kacheln, zählen hoch, ▲/▼ ggü. Vorperiode): Eingänge · Ausgaben · Überschuss · Aufträge (Quittungen/Rechnungen).
- **Diagramme:** Eingänge & Ausgaben je Monat (Klick wählt den Monat) · Überschuss kumuliert vs. Vorjahr · Donut „Wofür das
  Geld rausgeht“ (Kategorien) · Donut „Wie Kunden bezahlen“ (Zahlungswege).
- **Meine Kennzahlen:** angeheftete eigene Kennzahlen als Kacheln mit Sparkline der letzten 12 Monate (z. B. Steuerrücklage,
  Gewinnmarge, Hochrechnung Jahresumsatz).

#### 6.9.2 Liquidität (was in 30/60/90 Tagen rein- und rausgeht)
Ohne Kontostand gerechnet: Die Kurve ist der **kumulierte Überschuss ab heute** (Start 0).
- **Erwartete Zahlungen** Tag für Tag:
  - offene Rechnungen am Fälligkeitstag **plus Ø Zahlungsverzug** (aus der Historie, per Regler änderbar); überfällige
    frühestens in 3 Tagen (ein-/ausschaltbar),
  - wiederkehrende Kosten (Handy, Versicherungen …),
  - **Planposten** (z. B. „Aufsitzmäher −1.490 € am 14.11.“, „Winterdienst-Vertrag +600 €“),
  - Ø variable Eingänge/Ausgaben der letzten 90 Tage (wöchentlich gebündelt, als „Ø“ markiert).
- **Anzeige:** Kennzahlen erwartete Eingänge · erwartete Ausgaben · erwarteter Überschuss · **engster Moment** (wenn bis zu
  einem Datum mehr raus- als reingeht: „bis 14.11. gehen 820 € mehr raus als rein – ggf. vorstrecken“), Diagramm (Treppenlinie,
  Punkte für erwartete Zahlungen), Tabelle der erwarteten Zahlungen nach Kalenderwoche.
- Alle Annahmen sind als Schalter/Regler sichtbar und wirken sofort. Modell: `prototyp/js/core.js → prognose()`.

#### 6.9.3 Kennzahlen → siehe §8

#### 6.9.4 Steuer & Export
Unterreiter (wie im Prototyp): **EÜR · Wareneingangsbuch · Kleinunternehmer · Export**, dazu Jahreswahl.
- **EÜR** für ein Jahr: Tabelle nach EÜR-Bereichen (Einnahmen, Ausgaben, nicht abziehbare Anteile, Gewinn), Spalten = Monate,
  letzte Spalte hervorgehoben. Hinweis: „Werte in ELSTER in Anlage EÜR übertragen, Zeilen bitte im aktuellen Formular prüfen.“
  In der App zusätzlich die ELSTER-Ausfüllhilfe mit Kopier-Knöpfen (§2.9; im Prototyp nur der Hinweis).
- **Wareneingangsbuch** (§ 143 AO): Datum, Geschäft, Ware, Betrag, Beleg.
- **Kleinunternehmer:** Vorjahr ≤ 25.000 €, laufendes Jahr ≤ 100.000 € mit Hochrechnung; ab 80 % gelb, ab 100 % rot
  mit klarem Hinweis, was das bedeutet. Dazu Gewerbesteuer- und IHK-Check (Gewinn vs. Freibetrag 24.500 € bzw. 5.200 €), die
  nächste Frist (Steuererklärung mit EÜR, §2.7; im Prototyp noch nicht enthalten) und der **Jahresabschluss-Assistent**:
  Checkliste (alle Buchungen mit Beleg? Privatanteile? Offene Rechnungen geprüft? Wareneingangsbuch vollständig?
  Anschaffungen über 800 € als Anlage?) ⇒ Jahr festschreiben.
- **Export** fürs Finanzamt / den Steuerberater (alle Downloads gebündelt hier): `ein-ausgaenge_JJJJ.csv` (Semikolon, UTF-8
  mit BOM, Dezimalkomma; Datum, Beleg-Nr., Beschreibung, Kunde/Geschäft, Kategorie, EÜR-Bereich, Zahlungsweg, Betrag),
  EÜR als PDF und `euer_JJJJ.csv`, Wareneingangsbuch als PDF, ZIP mit allen Belegen + `beschreibung.txt`; später optional
  DATEV-Format (§2.9).
- **Anlagen & AfA** (Phase 5): Anlagenverzeichnis mit AfA-Plan (§2.2).

### 6.10 Einstellungen (Schublade rechts, wie PowerAnalytic)
Abschnitte: **Belege** (Beleg bei Einnahmen: Quittung | Rechnung, Standard Quittung; gilt auch als Vorauswahl für vorbereitete
Belege bei Terminen) · **Firma** (Name, Inhaber, Adresse, Kontakt, Steuernummer/USt-IdNr./KU-ID, Bankverbindung für Rechnungen/GiroCode,
PayPal-Adresse, **Firmenlogo**, siehe unten) · **Steuern** (Modus KU/Regel, Kennwerte pro Jahr, Kategorien, EÜR-Zuordnung) · **Nummernkreise** (Muster
mit Vorschau) · **Darstellung** (Hell/Dunkel, Theme-Presets, Akzentfarbe, Farbton, Radius, Schriftgröße, Dichte, Bewegung, Glas,
Aurora, Plus/Minus-Farben, Monospace-Zahlen) · **Datensicherung** (siehe unten) · **Daten** (Tectonic-Pfad; Demo-Daten
laden/entfernen nur in der Entwicklerversion `npm run tauri dev`, nie in der installierten App) · **Über Kladdy** (Version, „Nach Updates suchen …“, Haftungs- und Datenhinweis, Lizenzen).

**Datensicherung** (im Prototyp umgesetzt, Ziel dort simuliert): Umschalter **„Sicherung speichern auf: Diesem Mac · USB-Stick ·
iCloud Drive“** (in der App: Ordner wählen), darunter ein Statuskasten, dann „Jetzt sichern“ und „Wiederherstellen …“.
- Die App sichert **täglich automatisch** und **vor jedem Update** (`VACUUM INTO` + Belege als ZIP, die letzten 30 behalten).
- **Warnung, solange die Sicherung auf demselben Datenträger wie die Datenbank liegt** („Geht der Mac kaputt oder wird er
  gestohlen, ist beides weg“). Erkennen in Rust: `std::fs::metadata(..).dev()` von Backup-Ordner und `appDataDir` vergleichen
  (`std::os::unix::fs::MetadataExt`); iCloud Drive (`~/Library/Mobile Documents/com~apple~CloudDocs/…`) gilt als extern.
- **USB-Stick:** Sicherung läuft automatisch, sobald der Stick eingesteckt ist (Ordner erreichbar). **Erinnerung**, wenn die
  letzte Sicherung am externen Ziel älter als **30 Tage** ist.
- Solange eine Warnung besteht: kleiner **gelber Punkt am ⚙** (Tooltip „Datensicherung prüfen“) und höchstens einmal pro Woche
  ein Toast mit „Jetzt sichern“. Keine Banner auf den Seiten.
- „Wiederherstellen …“: Datei wählen ⇒ Vorschau (Datum, Anzahl Buchungen/Belege) ⇒ Rückfrage ⇒ vorher Sicherung des aktuellen
  Stands ⇒ ersetzen ⇒ Neustart. Fremde oder neuere Sicherungen werden mit klarer Meldung abgelehnt.

**Über Kladdy** (auch im macOS-Menü „Kladdy → Über Kladdy“): Version, „Nach Updates suchen …“, und zwei Kästen:
**„Keine Steuerberatung.** Kladdy hilft dir, alles festzuhalten und auszuwerten. Berechnungen, Hinweise und Exporte sind
ohne Gewähr – im Zweifel Steuerberatung oder Finanzamt fragen.“ · **„Deine Daten bleiben auf diesem Mac.** Kein Konto, keine
Cloud, kein Tracking …“. Beim **allerersten Start** (nur in der App, nicht im Prototyp) ein kurzer Willkommens-Dialog mit
diesen beiden Punkten, dem Firmen-Assistenten (Name, Anschrift, Steuernummer, Logo) und der Frage nach dem Sicherungsziel;
der Haftungshinweis wird einmal bestätigt und mit Datum in `einstellungen` gespeichert.

**Firmenlogo** (Abschnitt Firma, im Prototyp umgesetzt): Kachel mit Vorschau, Klick oder Bild daraufziehen ⇒ Upload
(PNG, JPG, SVG, WebP; andere Dateien werden abgelehnt). Das Bild wird auf höchstens 720 × 240 px verkleinert (16 mm Logohöhe im
Druck brauchen ~190 px) und als PNG unter `<appDataDir>/assets/logo-<sha256>.png` abgelegt. Es ersetzt **oben links in der
Seitenleiste das App-Symbol** (auf weißer Kachel, damit es in Hell und Dunkel lesbar ist, und so, wie es auf dem weißen
Beleg steht) und erscheint im Baustein **„Kopf mit Logo“** (Standard bei Rechnung und Angebot; für die Quittung in den
Vorlagen hinzufügbar). **„Zurücksetzen“** ⇒ wieder das App-Symbol; beides mit „Rückgängig“ im Toast. Ein Drop auf die Kachel
öffnet **nicht** die Erfassen-Schublade (Kachel ist eine `.dropzone`).
GoBD: Ausgestellte Belege behalten ihr Logo. In der App steckt es im archivierten PDF; zusätzlich merkt sich der Schnappschuss
(`snapshot_json.logo`) den Dateinamen, alte Logo-Dateien werden nie gelöscht, solange ein Beleg darauf verweist. (Prototyp:
`r.logoId` + `FIRMA.logoArchiv`, vor jedem Logowechsel werden alle ausgestellten Belege eingefroren.)

---

## 7. Vorlagen-Baukasten & PDF-Export

### 7.0 Grundidee: Bausteine statt LaTeX schreiben
Belege (Rechnung, Quittung, Angebot, Eigenbeleg) werden aus **Bausteinen** zusammengesetzt. Niemand muss LaTeX schreiben.
Eine Vorlage ist eine geordnete Liste von Bausteinen mit Einstellungen, gespeichert als JSON (`vorlagen.bloecke_json`):

```json
[{ "typ": "kopf", "logo": true }, { "typ": "absenderzeile" }, { "typ": "anschrift_meta" },
 { "typ": "titel" }, { "typ": "text", "text": "vielen Dank für Ihren Auftrag …" }, { "typ": "positionen" },
 { "typ": "summe" }, { "typ": "steuerhinweis" }, { "typ": "zahlung", "qr": true }, { "typ": "gruss" }, { "typ": "fusszeile" }]
```

**Bausteine** (Katalog im Prototyp: `prototyp/js/pages/belege.js → App.sheet.BLOCKS`): Kopf mit Logo · Absenderzeile ·
Anschrift & Belegdaten · Titel · Betreff · Freitext · Positionen · Gesamtbetrag · Betrag in Worten · Steuerhinweis (§ 19) ·
Zahlung & GiroCode · Quittungsangaben · Eigenbeleg-Angaben · Grußformel · Unterschrift · Trennlinie · Abstand · Fußzeile (unten verankert) ·
Datenschutzhinweis (optional, nicht in den Standardvorlagen; Text mit `{email}`, klein und grau, §2.10).
Jeder Baustein hat einfache Einstellungen (Schalter, Text mit Platzhaltern wie `{kunde}`, `{nr}`, `{summe}`, `{faellig}`, Auswahl).

**Seite „Vorlagen“** (siehe Prototyp `#/vorlagen`):
- Art-Umschalter Rechnung · Quittung · Angebot · Eigenbeleg.
- **Links:** Bausteinliste mit Griff zum Ziehen, Augen-Symbol (ausblenden), × (entfernen) und „+ Baustein hinzufügen“
  (Palette mit allen passenden Bausteinen). Darunter die Einstellungen des gewählten Bausteins mit Platzhalter-Chips zum Einfügen.
  Darunter der **Pflichtangaben-Check** (§ 34a UStDV): Entfernt man z. B. den § 19-Hinweis, wird das sofort rot markiert.
- **Rechts:** Live-Vorschau auf Papier. Klick auf einen Bereich im Blatt wählt den Baustein aus. Vorschau mit Beispieldaten
  oder einem echten Beleg. Knopf „PDF“.
- Die erste Änderung an einer Standardvorlage legt automatisch eine **eigene Kopie** an. „Zurücksetzen“ stellt den Standard
  wieder her (mit Rückgängig). Gespeichert wird automatisch.
- **Experten-Ansicht „LaTeX“** (nur lesen): zeigt den automatisch erzeugten LaTeX-Code.

**Erzeugung des PDFs:** Jeder Baustein hat zwei Darstellungen, die gleich aussehen müssen:
1. **HTML** für die Live-Vorschau (schnell, ohne Kompilieren),
2. **LaTeX-Schnipsel** für das echte PDF.
Die App setzt aus den Schnipseln `main.tex` zusammen. Die Präambel richtet sich nach der Art: A4 hochkant bzw. A5 quer.
Danach geht es wie unten weiter mit `daten.tex` + Tectonic. Beispiel für das Ergebnis: §7.5/§7.6. Vorschau und PDF
regelmäßig vergleichen (Test: dieselbe Rechnung als HTML-Screenshot und als PDF-Rendering nebeneinander).

### 7.1 Prinzip: erzeugte Vorlage + erzeugte Datendatei

Die App schreibt bei jedem Erzeugen in einen temporären Ordner:
- `main.tex` = **aus den Bausteinen erzeugt** (§7.0)
- `daten.tex` = **von der App erzeugt**, definiert alle Werte als LaTeX-Makros (`\Nummer`, `\KundeName`, `\Positionen` …)
- Assets (`logo.png`, `unterschrift.png`, `girocode.png`)

`main.tex` bindet `\input{daten.tex}` ein. **Vorteil:** Werte und Layout bleiben getrennt, und jede Vorlage lässt sich
mit Beispieldaten erzeugen.

**Alle Werte werden LaTeX-escaped** (`lib/latex/escape.ts`):
`\ → \textbackslash{}`, `& % $ # _ { }` → mit `\` davor, `~ → \textasciitilde{}`, `^ → \textasciicircum{}`,
Zeilenumbrüche in Adressen ⇒ `\\`. Beträge werden in der App fertig formatiert (`1.234,50\,€`).
Unbedingt mit Tests absichern (Kundenname „Müller & Söhne 100%“ muss kompilieren).

### 7.2 Kompilieren (Rust-Command `compile_latex`)
- Temp-Ordner anlegen, Dateien schreiben, `tectonic -X compile main.tex --untrusted` ausführen (Timeout 60 s, kein Shell-Escape).
- Rückgabe: PDF-Bytes **oder** Fehlerliste aus dem Log. Muster `main.tex:12:` bzw. `! Undefined control sequence` ⇒ Zeile + Meldung.
- Erster Lauf lädt Pakete aus dem Netz (dauert etwas). Danach offline aus dem Cache. In der UI beim ersten Mal erklären.
- Kompilieren nicht parallel: laufenden Auftrag abbrechen, wenn ein neuer kommt.

### 7.3 Optional später: freier LaTeX-Modus
Für Fortgeschrittene könnte man eine Vorlage in „freies LaTeX“ umwandeln: CodeMirror 6 mit LaTeX-Hervorhebung,
Autovervollständigung der Makros aus `daten.tex`, Fehler an der richtigen Zeile und pdf.js-Vorschau. Das ist **nicht**
Teil des ersten Ausbaus. Im Baukasten schreibt der Nutzer kein LaTeX, darum ist jeder Kompilierfehler ein Fehler der App:
den Baustein und die Meldung anzeigen und protokollieren.

### 7.4 Makros, die `daten.tex` immer definiert (leer, wenn nicht vorhanden)

`\Belegart` `\Nummer` `\Datum` `\Leistungsdatum` `\Faellig` ·
`\Firma` `\FirmaInhaber` `\FirmaStrasse` `\FirmaOrt` `\FirmaEmail` `\FirmaTelefon` `\FirmaWeb` `\Steuernummer` `\Bank` `\IBAN` `\BIC` `\LogoDatei` ·
`\KundeName` `\KundeZusatz` `\KundeStrasse` `\KundeOrt` `\Kundennummer` ·
`\Betreff` `\Einleitung` `\Positionen` `\Gesamt` `\BetragInWorten` `\Zahlungsart` `\Steuerhinweis` `\Zahlungshinweis`
`\Schlusstext` `\Gruss`

`\Positionen` enthält eine Folge von `\Position{Nr}{Beschreibung}{Menge}{Einheit}{Einzelpreis}{Gesamt}`.
**Wie** eine Position aussieht, legt die Vorlage selbst fest.

Beispiel einer erzeugten `daten.tex`:
```latex
% automatisch erzeugt – nicht bearbeiten
\newcommand{\Belegart}{Rechnung}
\newcommand{\Nummer}{RE-2026-014}
\newcommand{\Datum}{09.10.2026}
\newcommand{\Leistungsdatum}{01.10.–07.10.2026}
\newcommand{\Faellig}{23.10.2026}
\newcommand{\Firma}{Mustermann Haus- \& Gartenservice}
\newcommand{\FirmaInhaber}{Max Mustermann}
\newcommand{\FirmaStrasse}{Lindenweg 12}
\newcommand{\FirmaOrt}{12345 Musterstadt}
\newcommand{\FirmaEmail}{hallo@mustermann-service.de}
\newcommand{\FirmaTelefon}{0123 456789}
\newcommand{\FirmaWeb}{mustermann-service.de}
\newcommand{\Steuernummer}{12/345/67890}
\newcommand{\Bank}{Musterbank}
\newcommand{\IBAN}{DE89 3704 0044 0532 0130 00}
\newcommand{\BIC}{COBADEFFXXX}
\newcommand{\LogoDatei}{logo.png}
\newcommand{\KundeName}{Hausverwaltung Kaiser}
\newcommand{\KundeZusatz}{z.\,Hd. Frau Kaiser}
\newcommand{\KundeStrasse}{Seeufer 5}
\newcommand{\KundeOrt}{12390 Seehausen}
\newcommand{\Kundennummer}{K-0007}
\newcommand{\Betreff}{Gartenpflege Oktober}
\newcommand{\Einleitung}{vielen Dank für Ihren Auftrag. Ich berechne Ihnen folgende Leistungen:}
\newcommand{\Positionen}{%
  \Position{1}{Heckenschnitt \& Rasenpflege}{3}{Std.}{45,00\,€}{135,00\,€}%
  \Position{2}{Grünschnitt-Entsorgung}{1}{pausch.}{18,00\,€}{18,00\,€}%
}
\newcommand{\Gesamt}{153,00\,€}
\newcommand{\BetragInWorten}{einhundertdreiundfünfzig Euro}
\newcommand{\Zahlungsart}{Überweisung}
\newcommand{\Steuerhinweis}{Umsatzsteuerfrei aufgrund der Kleinunternehmerregelung gemäß § 19 UStG.}
\newcommand{\Zahlungshinweis}{Bitte überweisen Sie den Betrag bis zum 23.10.2026 unter Angabe der Rechnungsnummer.}
\newcommand{\Schlusstext}{}
\newcommand{\Gruss}{Mit freundlichen Grüßen\\Max Mustermann}
```

### 7.5 Mitgelieferte Vorlage: Rechnung (Kleinunternehmer)

Farben passend zum App-Akzent. Die App ersetzt beim Anlegen `6366F1` durch die aktuelle Akzentfarbe.
(Die Vorlage wurde noch nicht kompiliert. In Phase 3 einmal mit Tectonic testen und Fehler beheben.)

```latex
% Kladdy – Rechnung (Kleinunternehmer)
\documentclass[11pt]{article}
\usepackage[a4paper, top=18mm, bottom=32mm, left=22mm, right=20mm, footskip=14mm]{geometry}
\usepackage{fontspec}
\IfFontExistsTF{Helvetica Neue}{\setmainfont{Helvetica Neue}}{}
\usepackage[ngerman]{babel}
\usepackage{xcolor, graphicx, tabularx, booktabs, array, etoolbox, fancyhdr}
\definecolor{akzent}{HTML}{6366F1}
\definecolor{grau}{HTML}{6B7280}
\setlength{\parindent}{0pt}

\input{daten.tex}

% So sieht eine Position aus (Pos | Beschreibung | Menge | Einzelpreis | Gesamt)
\newcommand{\Position}[6]{#1 & #2 & #3~#4 & #5 & #6 \\}

\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0pt}
\fancyfoot[C]{\footnotesize\color{grau}%
  \begin{tabularx}{\textwidth}{@{}XXX@{}}
    \Firma \newline \FirmaStrasse \newline \FirmaOrt &
    \FirmaEmail \newline \FirmaTelefon \newline Steuernr.: \Steuernummer &
    \Bank \newline IBAN: \IBAN \newline BIC: \BIC
  \end{tabularx}}

\begin{document}

% Kopf
\begin{minipage}[t]{0.6\textwidth}\vspace{0pt}
  {\Large\bfseries\color{akzent}\Firma}\par
  {\small\color{grau}\FirmaInhaber}
\end{minipage}\hfill
\begin{minipage}[t]{0.35\textwidth}\vspace{0pt}\raggedleft
  \ifdefempty{\LogoDatei}{}{\includegraphics[height=16mm]{\LogoDatei}}
\end{minipage}

\vspace{16mm}

% Absenderzeile + Anschrift | Belegdaten
\begin{minipage}[t]{0.55\textwidth}\vspace{0pt}
  {\scriptsize\color{grau}\Firma{} · \FirmaStrasse{} · \FirmaOrt}\par\smallskip
  \KundeName\par
  \ifdefempty{\KundeZusatz}{}{\KundeZusatz\par}
  \KundeStrasse\par
  \KundeOrt
\end{minipage}\hfill
\begin{minipage}[t]{0.38\textwidth}\vspace{0pt}\small
  \begin{tabular}{@{}l r@{}}
    \textcolor{grau}{\Belegart{}-Nr.} & \textbf{\Nummer} \\
    \textcolor{grau}{Datum}           & \Datum \\
    \textcolor{grau}{Leistungsdatum}  & \Leistungsdatum \\
    \textcolor{grau}{Kunden-Nr.}      & \Kundennummer \\
  \end{tabular}
\end{minipage}

\vspace{14mm}
{\LARGE\bfseries \Belegart{} \Nummer}\par\medskip
\ifdefempty{\Betreff}{}{\textbf{\Betreff}\par\medskip}
Guten Tag,\par\smallskip
\Einleitung\par

\vspace{6mm}
{\renewcommand{\arraystretch}{1.35}
\begin{tabularx}{\textwidth}{@{}r X r r r@{}}
  \toprule
  \textcolor{grau}{\small Pos.} & \textcolor{grau}{\small Beschreibung} & \textcolor{grau}{\small Menge} &
  \textcolor{grau}{\small Einzelpreis} & \textcolor{grau}{\small Gesamt} \\
  \midrule
  \Positionen
  \midrule
  \multicolumn{4}{@{}l}{\textbf{Gesamtbetrag}} & \textbf{\textcolor{akzent}{\Gesamt}} \\
  \bottomrule
\end{tabularx}}

\vspace{6mm}
\Steuerhinweis\par\medskip
\Zahlungshinweis\par\medskip
\ifdefempty{\Schlusstext}{}{\Schlusstext\par\medskip}
\bigskip
\Gruss

\end{document}
```

### 7.6 Mitgelieferte Vorlage: Quittung (A5 quer)

```latex
% Kladdy – Quittung
\documentclass[11pt]{article}
\usepackage[a5paper, landscape, margin=14mm]{geometry}
\usepackage{fontspec}
\IfFontExistsTF{Helvetica Neue}{\setmainfont{Helvetica Neue}}{}
\usepackage[ngerman]{babel}
\usepackage{xcolor, tabularx, etoolbox}
\definecolor{akzent}{HTML}{6366F1}
\definecolor{grau}{HTML}{6B7280}
\setlength{\parindent}{0pt}
\pagestyle{empty}

\input{daten.tex}
\newcommand{\Feld}[2]{{\footnotesize\color{grau}#1}\par\smallskip{\large #2}\par\medskip}

\begin{document}
{\Large\bfseries\color{akzent}Quittung}\hfill{\bfseries Nr.~\Nummer}\par\smallskip
{\color{akzent}\rule{\textwidth}{1.2pt}}\par\medskip

\begin{tabularx}{\textwidth}{@{}XXX@{}}
  \Feld{Betrag}{\textbf{\Gesamt}} & \Feld{Datum}{\Datum} & \Feld{Zahlungsart}{\Zahlungsart} \\
\end{tabularx}
\Feld{Betrag in Worten}{\BetragInWorten}
\Feld{Erhalten von}{\KundeName, \KundeStrasse, \KundeOrt}
\Feld{Für}{\Betreff}
{\small \Steuerhinweis}\par
\ifdefempty{\Schlusstext}{}{{\footnotesize\color{grau}\Schlusstext}\par}
{\footnotesize\color{grau}\Firma{} · \FirmaStrasse{} · \FirmaOrt{} · Steuernr.~\Steuernummer}

\vfill
\begin{tabularx}{\textwidth}{@{}XX@{}}
  \rule{0.9\linewidth}{0.4pt} & \rule{0.9\linewidth}{0.4pt} \\
  {\footnotesize\color{grau}Ort, Datum} & {\footnotesize\color{grau}Unterschrift \Firma} \\
\end{tabularx}
\end{document}
```

`\BetragInWorten` erzeugt die App (`lib/latex/zahl-in-worten.ts`, mit Tests: 0, 1, 16, 21, 100, 101, 1.000, 1.001, 153,50 €
⇒ „einhundertdreiundfünfzig Euro und fünfzig Cent“).

---

## 8. Formel-Editor für eigene Kennzahlen

**Ziel:** Kennzahlen wie in Excel selbst definieren, aber lesbar, mit deutschen Funktionsnamen und Autovervollständigung.
Jede Kennzahl wird **im gewählten Zeitraum** ausgewertet. Dadurch gibt es Vergleich und Sparkline (letzte 12 Monate) automatisch.

### 8.1 Syntax

- Zahlen: `1500`, `0,3`, `0.3`, `30 %` (= 0,3), `1.500,50` ist **nicht** erlaubt (eindeutig bleiben: kein Tausenderpunkt)
- Operatoren: `+ - * / ^`, Klammern, Vergleiche `= <> < > <= >=`
- Argumente werden mit **Semikolon** getrennt (wie im deutschen Excel)
- Benannte Filter: `kategorie: "Material"` (ID oder Name, ein Teil des Namens genügt), `kunde: "Hausverwaltung Kaiser"`,
  `zahlungsart: "bar"`, `status: "offen"`, `art: "quittung"`, `zeitraum: JAHR`
- Andere Kennzahlen: `[Gewinnmarge]` (Zyklen werden erkannt und als Fehler gemeldet)
- Eigene Variablen (Tab „Variablen“): `STUNDENSATZ = 38`, `STEUERQUOTE = 25 %`

Grammatik (für den Pratt-Parser):
```
ausdruck  := vergleich
vergleich := summe ( ("=" | "<>" | "<" | ">" | "<=" | ">=") summe )?
summe     := produkt ( ("+" | "-") produkt )*
produkt   := potenz ( ("*" | "/") potenz )*
potenz    := unaer ( "^" unaer )?
unaer     := "-" unaer | primaer ("%")?
primaer   := ZAHL | TEXT | NAME | NAME "(" argumente? ")" | "[" KENNZAHL "]" | "(" ausdruck ")"
argumente := argument ( ";" argument )*
argument  := ausdruck | NAME ":" ausdruck
```

### 8.2 Funktionen

| Gruppe | Funktionen |
|---|---|
| Daten | `EINNAHMEN(filter…)` · `AUSGABEN(filter…)` (abziehbarer Teil, ohne Privatanteil) · `AUSGABEN_BRUTTO(…)` · `GEWINN(…)` · `KU_UMSATZ(…)` · `OFFEN()` (offene Forderungen) · `ANZAHL(BUCHUNGEN \| RECHNUNGEN; filter…)` · `SUMME(BUCHUNGEN \| RECHNUNGEN; filter…)` · `DURCHSCHNITT(RECHNUNGEN; "zahlungsdauer"; filter…)` · später `KM()` (Fahrten) · `AFA()` (Anlagen) – nicht im Prototyp |
| Zeit | `VORPERIODE(ausdruck)` · `VORJAHR(ausdruck)` · `IM(zeitraum; ausdruck)` · `LETZTE_TAGE(n)` · `TAGE()` · `MONATE()` (im Zeitraum) · `MONATE_VERGANGEN()` · `HEUTE()` · Konstanten `MONAT`, `QUARTAL`, `JAHR`, `YTD`, `VORMONAT`, `VORJAHR_GESAMT` |
| Logik | `WENN(bedingung; dann; sonst)` · `UND` · `ODER` · `NICHT` |
| Mathe | `MIN` · `MAX` · `ABS` · `RUNDEN(x; stellen)` · `WURZEL` · `TEILEN(a; b; ersatz)` (Division durch 0 ⇒ Ersatzwert) |
| Parameter | `PARAM("ku_grenze_laufend")` liest Steuer-Kennwerte des Jahres |

Division durch 0 ergibt **„—“** statt eines Fehlers (bzw. den Ersatzwert bei `TEILEN`).

### 8.3 Vorinstallierte Beispiel-Kennzahlen

Wie im Prototyp (`prototyp/js/data.js → KENNZAHLEN`); ★ = im Überblick angeheftet.

| Name | Formel | Format |
|---|---|---|
| Überschuss | `EINNAHMEN() - AUSGABEN()` | € |
| Gewinnmarge ★ | `TEILEN(GEWINN(); EINNAHMEN(); 0)` | % (Ampel: ≥ 30 % grün, ≥ 10 % gelb) |
| Steuerrücklage ★ | `MAX(0; GEWINN(zeitraum: YTD)) * STEUERQUOTE` | € |
| Hochrechnung Jahresumsatz ★ | `TEILEN(KU_UMSATZ(zeitraum: YTD); MONATE_VERGANGEN(); 0) * 12` | € |
| KU-Spielraum bis 25.000 € | `PARAM("ku_grenze_vorjahr") - KU_UMSATZ(zeitraum: JAHR)` | € (Ampel: ≥ 5.000 grün, ≥ 2.000 gelb) – so viel Umsatz geht dieses Jahr noch, damit die Regelung auch nächstes Jahr gilt |
| Ø Auftragswert | `TEILEN(SUMME(RECHNUNGEN; status: "bezahlt"); ANZAHL(RECHNUNGEN; status: "bezahlt"); 0)` | € |
| Anzahl Aufträge | `ANZAHL(RECHNUNGEN)` | Zahl |
| Kosten pro Monat | `TEILEN(AUSGABEN(); MONATE(); 0)` | € |
| Spritkosten pro Monat | `TEILEN(AUSGABEN(kategorie: "Sprit"); MONATE(); 0)` | € |
| Produktkostenquote | `TEILEN(AUSGABEN(kategorie: "Produkte"); EINNAHMEN(); 0)` | % (Ampel umgekehrt: ≤ 15 % grün, ≤ 25 % gelb) |
| Anteil Barumsatz | `TEILEN(EINNAHMEN(zahlungsart: "bar"); EINNAHMEN(); 0)` | % |
| Umsatzwachstum | `TEILEN(EINNAHMEN(); VORJAHR(EINNAHMEN()); 0) - 1` | % |

Weitere fertige Ideen zum Hinzufügen (im Prototyp unter „Ideen“), u. a. Ø Zahlungsdauer
(`DURCHSCHNITT(RECHNUNGEN; "zahlungsdauer"; status: "bezahlt")`, Tage), Effektiver Stundenlohn
(`TEILEN(GEWINN(zeitraum: JAHR); STUNDEN; 0)` mit Variable `STUNDEN`), Gewinn pro Monat, Ausgabenquote, Anteil PayPal.
Vorbelegte Variablen: `STEUERQUOTE = 25 %`, `STUNDENSATZ = 38`, `STUNDEN = 720`.

### 8.4 Oberfläche „Kennzahlen“

- **Links:** Liste aller Kennzahlen als kleine KPI-Kacheln (Wert, Vergleich, Sparkline). Per Drag & Drop sortierbar.
  Stern = „im Überblick anheften“ (Auswertung → Überblick, „Meine Kennzahlen“).
- **Rechts: Editor** für die ausgewählte Kennzahl:
  - Name, Beschreibung (erscheint als (?)-Tooltip an der Kachel, wie die `.q`-Buttons in PowerAnalytic)
  - **Formelfeld** (CodeMirror, einzeilig/mehrzeilig) mit Hervorhebung (Funktionen in Akzentfarbe, Texte, Zahlen),
    **Autovervollständigung** (Funktionen mit Signatur, Kategorien, Kunden, Variablen, Kennzahlen) und Parameterhilfe beim Tippen
  - **Live-Ergebnis** direkt darunter: großer Wert + „im Zeitraum Okt 2026“ + Vergleich + Sparkline
  - **Fehler** verständlich und mit Position: *„Unbekannte Funktion EINAHMEN – meintest du EINNAHMEN?“* (Levenshtein-Vorschlag)
  - Format (€, %, Zahl, Tage), Nachkommastellen, Ampel-Schwellen, Vergleich (keiner/Vorperiode/Vorjahr), fester Zeitraum (optional)
  - **„Erklären“-Ansicht:** zeigt den Rechenweg mit Zwischenwerten (Baumansicht des AST). Sehr hilfreich zum Prüfen
- **Tab „Variablen“:** einfache Tabelle Name/Wert/Beschreibung. **Tab „Funktionen“:** Nachschlagewerk aller Funktionen mit
  Beispiel. Dazu fertige **Ideen** zum Hinzufügen per Klick (§8.3).
- Bearbeitet wird immer ein Entwurf; erst „Speichern“ (⌘S) übernimmt die Änderung.

### 8.5 Technik
- Lexer → Pratt-Parser → AST (zwischengespeichert pro Formel) → Auswerter mit Kontext `{ von, bis, daten, variablen, kennzahlen }`.
- Daten für das gewählte Jahr **plus Vorjahr** einmal in den Speicher laden und dort filtern. Die Datenmengen sind klein, das ist schnell genug für Live-Vorschau und Sparklines.
- **Kein `eval`/`new Function`.**
- Umfangreiche Vitest-Tests: Operator-Rangfolge, Dezimalkomma, Prozent, Filter, Zeitverschiebung, Zyklen, Fehlermeldungen mit Position.

---

## 9. Design-System (aus PowerAnalytic übernommen)

**Stil in einem Satz:** „Ruhiges Glas-Terminal“: dunkle (oder helle), leicht eingefärbte Flächen, feine Linien, viel Luft,
eine einzige Akzentfarbe mit Verlauf, sanfte Glas-Unschärfe und weiche, federnde Animationen.
Die Daten stehen im Vordergrund, Deko bleibt im Hintergrund. Standard: **Dunkel, Theme Indigo**.

### 9.1 Tokens (1:1 übernehmen → `src/styles/tokens.css`)

```css
:root {
  --accent: #6366f1;
  --on-accent: #fff;                                   /* per JS: Luminanz(accent) > 0.45 ? '#111114' : '#fff' */
  --accent-2: color-mix(in oklab, var(--accent), #ec4899 40%);   /* Fallback */
  --accent-2: oklch(from var(--accent) l c calc(h + 50));
  --accent-soft: color-mix(in oklab, var(--accent) 14%, transparent);
  --accent-line: color-mix(in oklab, var(--accent) 45%, transparent);
  --tint-h: 240;
  --tint-s: 14%;
  --radius: 14px;
  --radius-sm: calc(var(--radius) * 0.6);
  --font-scale: 1;
  --gap: 18px;
  --pad: 20px;
  --sb-w: 272px;
  --topbar-h: 68px;
  --tb-pad: clamp(16px, 3vw, 40px);
  --font: "Inter Variable", "Inter", system-ui, -apple-system, sans-serif;
  --mono: "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SF Mono", monospace;
  --num-font: var(--font);
  --ease: cubic-bezier(.2, .8, .2, 1);
  --spring: cubic-bezier(.34, 1.5, .64, 1);
}
:root[data-numfont="mono"] { --num-font: var(--mono); }
:root[data-density="compact"] { --gap: 12px; --pad: 14px; }
:root[data-density="cozy"]    { --gap: 24px; --pad: 26px; }

:root[data-mode="dark"] {
  --bg: hsl(var(--tint-h) var(--tint-s) 5.5%);
  --surface: hsl(var(--tint-h) var(--tint-s) 8.5%);
  --surface-2: hsl(var(--tint-h) var(--tint-s) 11.5%);
  --surface-3: hsl(var(--tint-h) var(--tint-s) 15%);
  --border: hsl(var(--tint-h) var(--tint-s) 15.5%);
  --border-strong: hsl(var(--tint-h) var(--tint-s) 22%);
  --text: hsl(var(--tint-h) 20% 96%);
  --text-2: hsl(var(--tint-h) 10% 74%);
  --muted: hsl(var(--tint-h) 7% 55%);
  --grid: hsl(var(--tint-h) var(--tint-s) 14%);
  --axis: hsl(var(--tint-h) var(--tint-s) 24%);
  --hover: hsl(0 0% 100% / .045);
  --shadow: 0 1px 0 hsl(0 0% 100% / .035) inset, 0 12px 32px -14px rgb(0 0 0 / .65);
  --shadow-lg: 0 24px 60px -18px rgb(0 0 0 / .7), 0 0 0 1px hsl(0 0% 100% / .04);
  --glass: hsl(var(--tint-h) var(--tint-s) 7% / .7);
  --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70;
  --pos: #22c55e; --neg: #f87171; --warn: #fbbf24;     /* --warn neu für Kladdy */
  --aurora-opacity: .22;
}
:root[data-mode="light"] {
  --bg: hsl(var(--tint-h) calc(var(--tint-s) + 8%) 96.5%);
  --surface: hsl(var(--tint-h) 40% 99.6%);
  --surface-2: hsl(var(--tint-h) calc(var(--tint-s) + 6%) 96%);
  --surface-3: hsl(var(--tint-h) calc(var(--tint-s) + 4%) 92.5%);
  --border: hsl(var(--tint-h) calc(var(--tint-s) + 4%) 90%);
  --border-strong: hsl(var(--tint-h) var(--tint-s) 83%);
  --text: hsl(var(--tint-h) 25% 10%);
  --text-2: hsl(var(--tint-h) 10% 32%);
  --muted: hsl(var(--tint-h) 7% 47%);
  --grid: hsl(var(--tint-h) calc(var(--tint-s) + 4%) 92%);
  --axis: hsl(var(--tint-h) var(--tint-s) 78%);
  --hover: hsl(var(--tint-h) 30% 30% / .05);
  --shadow: 0 1px 2px rgb(15 20 40 / .04), 0 10px 28px -16px rgb(15 20 40 / .18);
  --shadow-lg: 0 24px 60px -20px rgb(15 20 40 / .3), 0 0 0 1px rgb(15 20 40 / .05);
  --glass: hsl(var(--tint-h) 40% 99% / .72);
  --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a;
  --pos: #15803d; --neg: #dc2626; --warn: #b45309;
  --aurora-opacity: .16;
}
/* Plus/Minus-Varianten (Rot-Grün-Sehschwäche) */
:root[data-posneg="blueorange"][data-mode="dark"]  { --pos: #60a5fa; --neg: #fb923c; }
:root[data-posneg="blueorange"][data-mode="light"] { --pos: #1d4ed8; --neg: #c2410c; }
:root[data-posneg="tealpink"][data-mode="dark"]    { --pos: #2dd4bf; --neg: #f472b6; }
:root[data-posneg="tealpink"][data-mode="light"]   { --pos: #0f766e; --neg: #be185d; }
```

Schalter am `<html>`: `data-mode` (dark/light), `data-density`, `data-motion` (full/reduced/off), `data-glass` (on/off),
`data-aurora` (on/off), `data-numfont` (sans/mono), `data-posneg` (greenred/blueorange/tealpink).

**Theme-Presets** (Akzent / Hintergrund-Farbton / Sättigung):
Indigo `#6366f1` 240/14 (Standard) · Ozean `#0ea5e9` 210/20 · Smaragd `#10b981` 165/14 · Sonnenuntergang `#f97316` 20/12 ·
Rosé `#ec4899` 330/12 · Gold `#eab308` 45/10 · Graphit `#94a3b8` 220/6 · Terminal `#22c55e` 140/22 + Monospace-Zahlen.
Ändert man Akzent oder Farbton, entsteht automatisch „Eigenes Theme“. Auswahl als 4er-Raster mit Mini-Vorschau (drei Balken in Akzentfarbe auf Theme-Hintergrund).

### 9.2 Typografie
- `html { font-size: calc(15px * var(--font-scale)); line-height: 1.45; -webkit-font-smoothing: antialiased }`, Überschriften `letter-spacing: -.015em`.
- Seitentitel h1: `clamp(1.7rem, 3vw, 2.3rem)`, Gewicht 750, `-.035em` · Hero h1: `clamp(1.8rem, 3.4vw, 2.6rem)`
- KPI-Wert 1.35rem/700/`-.025em` · Kartentitel 1rem/650 · Fließtext .85–.92rem · Labels .72–.76rem/600 in `--muted`
- Abschnittstitel: .72rem, GROSS, `letter-spacing: .08em`, 600, `--muted`
- **Zahlen:** `font-variant-numeric: tabular-nums` in Tabellen/Achsen; echtes Minuszeichen `−`; Beträge rechtsbündig.

### 9.3 Layout
- **App-Grid:** `grid-template-columns: var(--sb-w) minmax(0, 1fr)`, eingeklappt `76px minmax(0, 1fr)`, Übergang `.38s var(--ease)`.
  Immer `minmax(0, 1fr)`, sonst sprengen breite Tabellen das Grid. `box-sizing: border-box` überall.
- **Seitenleiste:** sticky, `100vh`, `padding: 14px 12px`, rechte Linie `--border`, Glas (`background: var(--glass); backdrop-filter: blur(18px) saturate(140%)`).
  Kopf `.sb-head` ist **genau 68 px** hoch mit Unterlinie, so bildet er mit der Topbar eine durchgehende Kopfzeile.
- **Topbar:** sticky, 68 px, Glas, 3 Spalten `minmax(130px,1fr) minmax(0,680px) minmax(130px,1fr)`, damit die Suche exakt mittig steht.
- **Inhalt:** `padding: 26px clamp(16px,3vw,40px) 120px; max-width: 1480px; margin: 0 auto`.
- **Raster:** KPI-Reihe `repeat(4, minmax(0,1fr))` (≤ 1280 px: 2) · `grid-main` `2fr / minmax(300px,1fr)` · `grid-2` 1fr/1fr · Kachelraster `repeat(auto-fill, minmax(250px, 1fr))`.
- **Hauptaktion einer Seite** rechts im Seitenkopf als `.btn-primary.head-add` (38 px hoch, so hoch wie Zeitraum-Umschalter und
  Suche): „+ Erfassen“ (Ein- & Ausgänge), „+ Termin eintragen“ (Termine), „+ Kunde anlegen“ (Kunden). Weitere Knöpfe im Kopf
  bleiben `ghost`/`subtle`, damit pro Seite nur einer leuchtet.
- **Jede Aktion genau einmal** (Erfassen nur im Kopf von Ein- & Ausgänge), Statistik nur in der Auswertung, Logo = Startseite (Ein- & Ausgänge), ⚙ nur oben rechts.
- **Großer Umschalter** der Auswertung (`.ausw-switch`): Raster mit 4 gleich breiten Reitern (≤ 900 px: 2×2), je Icon 22 px,
  Name (.98rem, 650) und Untertitel (.74rem, muted); Hintergrund `--surface-2`, aktiver Reiter `--surface` mit Schatten wie
  `.seg-ind` und 2-px-Akzentkante unten.

### 9.4 Komponenten (Kern-CSS übernehmen)

```css
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: var(--font); background: var(--bg); color: var(--text);
  transition: background-color .4s var(--ease), color .4s var(--ease); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }
::selection { background: var(--accent-soft); }

/* Karte */
.card { position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: var(--pad); box-shadow: var(--shadow); transition: border-color .25s, box-shadow .3s, background-color .4s; }
:root[data-glass="on"] .card { background: color-mix(in srgb, var(--surface) 82%, transparent);
  backdrop-filter: blur(16px) saturate(130%); -webkit-backdrop-filter: blur(16px) saturate(130%); }
.card:hover { border-color: var(--border-strong); }
.card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.card-title { font-size: 1rem; font-weight: 650; display: flex; align-items: center; gap: 6px; }

/* KPI-Kachel */
.kpi { padding: 14px 16px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--border);
  box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 6px; min-width: 0;
  transition: transform .3s var(--spring), border-color .2s; }
.kpi:hover { transform: translateY(-3px); border-color: var(--accent-line); }
.kpi-label { display: flex; align-items: center; gap: 6px; font-size: .76rem; color: var(--muted); font-weight: 600; }
.kpi-label .q { margin-left: auto; }
.kpi-val { font-size: 1.35rem; font-weight: 700; letter-spacing: -.025em; font-family: var(--num-font); white-space: nowrap; }
.kpi-sub { display: flex; gap: 6px; align-items: center; font-size: .74rem; }   /* ▲ +7,6 % ggü. Vorperiode */

/* Veränderung: nie nur Farbe, immer ▲/▼ + Vorzeichen */
.delta { display: inline-flex; align-items: center; gap: 3px; font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
.delta i { font-style: normal; font-size: .62em; }
.delta.pos { color: var(--pos); } .delta.neg { color: var(--neg); } .delta.flat { color: var(--muted); }

/* Seitenleisten-Eintrag */
.sb-title { display: flex; align-items: center; justify-content: space-between; padding: 0 10px 6px; color: var(--muted);
  font-size: .72rem; text-transform: uppercase; letter-spacing: .08em; font-weight: 600; }
.sb-title .count { background: var(--surface-3); color: var(--text-2); border-radius: 99px; padding: 1px 7px; font-size: .7rem; }
.sb-item { position: relative; border-radius: var(--radius-sm); transition: background .2s, transform .2s, opacity .2s; }
.sb-item > a { display: flex; align-items: center; gap: 10px; padding: 7px 8px; min-width: 0; }
.sb-item:hover { background: var(--hover); }
.sb-item.active { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent); }

/* Knöpfe */
.btn { display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 11px; font-weight: 600;
  font-size: .85rem; transition: background .2s, transform .2s var(--spring); }
.btn.ghost { border: 1px solid var(--border-strong); } .btn.ghost:hover { background: var(--hover); }
.btn:active { transform: scale(.96); }
.btn-primary { display: inline-flex; align-items: center; gap: 8px; height: 42px; padding: 0 16px; border-radius: 12px;
  font-weight: 650; font-size: .88rem; background: var(--accent); color: var(--on-accent);
  box-shadow: 0 8px 22px -10px var(--accent); transition: transform .25s var(--spring), filter .2s; }
.btn-primary:hover { filter: brightness(1.08); transform: translateY(-1px); }
.icon-btn { width: 38px; height: 38px; border-radius: 11px; display: inline-grid; place-items: center; color: var(--text-2);
  transition: background .2s, color .2s, transform .2s var(--spring); }
.icon-btn:hover { background: var(--hover); color: var(--text); } .icon-btn:active { transform: scale(.92); }

/* Badges, Chips, Pillen */
.badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; font-size: .7rem; font-weight: 600;
  border-radius: 99px; background: var(--surface-3); color: var(--text-2); white-space: nowrap; }
.badge.accent { background: var(--accent-soft); color: var(--text); box-shadow: inset 0 0 0 1px var(--accent-line); }
.chip { font-size: .75rem; padding: 3px 10px; border-radius: 99px; border: 1px solid var(--border); color: var(--text-2); background: var(--surface-2); }
.chip.strong { font-family: var(--mono); color: var(--text); font-weight: 600; border-color: var(--accent-line); background: var(--accent-soft); }
.pill { font-size: .62rem; font-weight: 700; letter-spacing: .05em; padding: 1px 6px; border-radius: 6px; background: var(--surface-3); color: var(--text-2); }

/* Segment-Umschalter mit gleitender Markierung (Position per JS messen) */
.seg { position: relative; display: inline-flex; padding: 3px; gap: 2px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); }
.seg button { position: relative; z-index: 1; padding: 6px 12px; border-radius: 9px; font-size: .8rem; font-weight: 600; color: var(--muted); transition: color .2s; }
.seg button.active, .seg button:hover { color: var(--text); }
.seg-ind { position: absolute; left: 0; top: 0; border-radius: 9px; background: var(--surface);
  box-shadow: 0 1px 3px rgb(0 0 0 / .18), 0 0 0 1px var(--border-strong); }
.seg.ready .seg-ind { transition: transform .35s var(--ease), width .35s var(--ease); }
.seg.tabs { background: transparent; border: 0; padding: 0; gap: 4px; }
.seg.tabs button { padding: 8px 14px; font-size: .86rem; }
.seg.tabs .seg-ind { background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent-line); }

/* Suchfeld (Vorbild für alle Eingabefelder) */
.search input { width: 100%; height: 44px; padding: 0 92px 0 44px; border-radius: 13px; border: 1px solid var(--border);
  background: var(--surface-2); color: var(--text); font: inherit; font-size: .95rem; outline: none;
  transition: border-color .2s, box-shadow .25s, background .2s; }
.search input:focus { border-color: var(--accent-line); background: var(--surface); box-shadow: 0 0 0 4px var(--accent-soft); }
kbd { font: 600 .7rem var(--font); color: var(--muted); border: 1px solid var(--border-strong); border-bottom-width: 2px;
  border-radius: 7px; padding: 3px 7px; background: var(--surface); }
.sd { /* Dropdown */ background: var(--surface); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow-lg); padding: 6px; }
.sd-item { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 11px; }
.sd-item.active { background: var(--accent-soft); }
.sd mark { background: color-mix(in oklab, var(--accent) 30%, transparent); color: inherit; border-radius: 3px; }

/* Tabelle */
.table-wrap { overflow-x: auto; margin: 0 calc(var(--pad) * -1); padding: 0 var(--pad); }
.fin-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: .85rem; }
.fin-table th, .fin-table td { padding: 9px 12px; text-align: right; white-space: nowrap; border-bottom: 1px solid var(--border); }
.fin-table th { font-size: .74rem; font-weight: 650; color: var(--muted); position: sticky; top: 0; background: var(--surface); }
.fin-table td.num { font-family: var(--num-font); font-variant-numeric: tabular-nums; }
.fin-table td.neg-v { color: var(--neg); }
.fin-table th.latest, .fin-table td.latest { background: color-mix(in oklab, var(--accent) 6%, transparent); }
.fin-table .sticky { position: sticky; left: calc(var(--pad) * -1); z-index: 2; text-align: left; background: var(--surface); min-width: 220px; }
.fin-table tr.row { cursor: pointer; transition: background .15s; }
.fin-table tr.row:hover td { background: var(--hover); }
.fin-table tr.row.selected td { background: var(--accent-soft); }
.fin-table tr.row.selected td.sticky { box-shadow: inset 3px 0 0 var(--accent); }

/* Klebrige Glas-Leiste (Filterleiste) */
.sticky-bar { position: sticky; top: calc(var(--topbar-h) + 8px); z-index: 12; display: flex; align-items: center;
  justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px 12px 10px 18px;
  border-radius: calc(var(--radius) + 2px); border: 1px solid var(--border); background: var(--glass);
  backdrop-filter: blur(18px) saturate(140%); -webkit-backdrop-filter: blur(18px) saturate(140%); box-shadow: var(--shadow); }

/* Schublade (Einstellungen 440 px; Breite je Schublade per Option, Erfassen 520 px) */
.drawer-backdrop { position: absolute; inset: 0; background: rgb(0 0 0 / .35); backdrop-filter: blur(2px); }
.drawer { position: absolute; right: 0; top: 0; bottom: 0; width: min(440px, 100vw); display: flex; flex-direction: column;
  background: var(--surface); border-left: 1px solid var(--border); box-shadow: var(--shadow-lg);
  transform: translateX(104%); transition: transform .45s var(--ease); }
.open > .drawer { transform: none; }
.drawer-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 22px; border-bottom: 1px solid var(--border); }
.drawer-body section { padding: 18px 0; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 14px; }
.drawer-body h3 { font-size: .72rem; text-transform: uppercase; letter-spacing: .09em; color: var(--muted); }

/* Schalter */
.switch { position: relative; width: 44px; height: 26px; }
.switch span { position: absolute; inset: 0; border-radius: 99px; background: var(--surface-3); border: 1px solid var(--border-strong); transition: background .25s; }
.switch span::after { content: ""; position: absolute; left: 3px; top: 3px; width: 18px; height: 18px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 4px rgb(0 0 0 / .3); transition: transform .35s var(--spring); }
.switch input:checked + span { background: var(--accent); border-color: var(--accent); }
.switch input:checked + span::after { transform: translateX(18px); }

/* (?)-Info + Tooltip */
.q { width: 17px; height: 17px; border-radius: 50%; display: inline-grid; place-items: center; font-size: .66rem; font-weight: 700;
  color: var(--muted); border: 1px solid var(--border-strong); cursor: help; transition: all .2s var(--spring); }
.q:hover { color: var(--on-accent); background: var(--accent); border-color: var(--accent); transform: scale(1.12); }
.gtip { position: fixed; z-index: 100; max-width: 300px; padding: 12px 14px; border-radius: 12px; background: var(--surface);
  border: 1px solid var(--border-strong); box-shadow: var(--shadow-lg); font-size: .82rem; }

/* Toast (invertiert, unten mittig) */
.toast { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 12px; font-size: .85rem; font-weight: 550;
  background: var(--text); color: var(--bg); box-shadow: var(--shadow-lg); animation: toastIn .45s var(--spring); }
@keyframes toastIn { from { opacity: 0; transform: translateY(16px) scale(.95); } }

/* Skeleton */
.sk { border-radius: var(--radius); background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%);
  background-size: 300% 100%; animation: shimmer 1.2s linear infinite; }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: -200% 0; } }

/* Status-Pillen (Auswertung → Überblick) */
.status-pill { display: flex; align-items: center; gap: 10px; padding: 9px 14px; border-radius: 12px; font-size: .82rem;
  background: color-mix(in srgb, var(--surface) 70%, transparent); border: 1px solid var(--border); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.status-pill.alarm .status-dot { background: var(--neg); animation: live 2s ease-out infinite; }
@keyframes live { 0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--neg) 60%, transparent); } 100% { box-shadow: 0 0 0 8px transparent; } }

/* Aurora-Hintergrund (3 treibende, unscharfe Farbflächen) */
.aurora { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; opacity: var(--aurora-opacity); }
.aurora span { position: absolute; width: 60vmax; height: 60vmax; border-radius: 50%; filter: blur(90px); }
.aurora span:nth-child(1) { background: var(--accent);   top: -30vmax; left: -10vmax; animation: drift1 38s ease-in-out infinite alternate; }
.aurora span:nth-child(2) { background: var(--accent-2); bottom: -35vmax; right: -15vmax; animation: drift2 46s ease-in-out infinite alternate; }
.aurora span:nth-child(3) { background: var(--series-1); top: 30%; left: 45%; width: 35vmax; height: 35vmax; opacity: .5; animation: drift3 52s ease-in-out infinite alternate; }
@keyframes drift1 { to { transform: translate(18vw, 12vh) scale(1.15); } }
@keyframes drift2 { to { transform: translate(-16vw, -10vh) scale(.9); } }
@keyframes drift3 { to { transform: translate(-22vw, 14vh) scale(1.2); } }

/* Gestaffeltes Hereingleiten der Abschnitte */
.reveal { animation: rise .6s var(--ease) both; animation-delay: calc(var(--i, 0) * 55ms); }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } }
:root[data-motion="off"] *, :root[data-motion="off"] *::before, :root[data-motion="off"] *::after { animation: none !important; transition: none !important; }
```

**Neu für Kladdy, im selben Stil abgeleitet:**

```css
/* Formularfelder: Optik wie das Suchfeld, nur kompakter */
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: .76rem; font-weight: 600; color: var(--muted); }
.input, .select, .textarea { height: 40px; padding: 0 12px; border-radius: 11px; border: 1px solid var(--border);
  background: var(--surface-2); color: var(--text); font: inherit; font-size: .9rem; outline: none;
  transition: border-color .2s, box-shadow .25s, background .2s; }
.input:focus, .select:focus, .textarea:focus { border-color: var(--accent-line); background: var(--surface); box-shadow: 0 0 0 4px var(--accent-soft); }
.input.invalid { border-color: var(--neg); box-shadow: 0 0 0 4px color-mix(in oklab, var(--neg) 15%, transparent); }
.money-input { height: 56px; font-size: 1.6rem; font-weight: 700; letter-spacing: -.02em; text-align: right; font-variant-numeric: tabular-nums; }

/* Fortschritt (Kleinunternehmer-Grenze) */
.progress { height: 8px; border-radius: 99px; background: var(--surface-3); overflow: hidden; }
.progress > i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--accent), var(--accent-2));
  transition: width .9s var(--ease); }
.progress.warn > i { background: var(--warn); } .progress.over > i { background: var(--neg); }

/* Status-Badges für Rechnungen */
.badge.offen     { background: var(--accent-soft); color: var(--text); box-shadow: inset 0 0 0 1px var(--accent-line); }
.badge.bezahlt   { background: color-mix(in oklab, var(--pos) 16%, transparent); color: var(--pos); }
.badge.ueberfaellig { background: color-mix(in oklab, var(--neg) 16%, transparent); color: var(--neg); }
.badge.storniert { text-decoration: line-through; color: var(--muted); }

/* Beleg-Dropzone */
.dropzone { display: grid; place-items: center; gap: 6px; min-height: 120px; padding: 18px; border-radius: var(--radius);
  border: 1.5px dashed var(--border-strong); background: var(--surface-2); color: var(--muted); font-size: .85rem; text-align: center;
  transition: border-color .2s, background .2s, transform .25s var(--spring); }
.dropzone.over { border-color: var(--accent); background: var(--accent-soft); color: var(--text); transform: scale(1.01); }

/* Leerer Zustand */
.empty { display: grid; place-items: center; gap: 10px; padding: 48px 16px; color: var(--muted); text-align: center; }
.empty .ic { width: 32px; height: 32px; color: var(--accent); }
```

### 9.5 Bewegung

| Element | Animation |
|---|---|
| Seitenwechsel | kurz Skeleton → Abschnitte gleiten gestaffelt herein (`.reveal`, 55 ms Versatz) |
| KPI-Werte | zählen von 0 hoch (900 ms, ease-out cubic) |
| Diagramme | Linien zeichnen sich (1,3 s), Balken wachsen federnd aus der Nulllinie (35 ms je Balken), Flächen blenden ein |
| Hell/Dunkel | kreisförmige Enthüllung vom Klickpunkt (View Transitions API, 600 ms) |
| Segment-Umschalter | Markierung gleitet zum aktiven Eintrag |
| Schublade | gleitet von rechts (.45 s), Hintergrund wird abgedunkelt + leicht unscharf |
| Seitenleiste | Breite gleitet, Pfeil im Panel-Symbol dreht sich |
| Überfällig-Punkt | pulsiert |
| Hover | Kacheln heben sich um 3–4 px, Rand in `--accent-line` |
| Hintergrund | Aurora, abschaltbar |

Easing: `--ease cubic-bezier(.2,.8,.2,1)`, federnd `--spring cubic-bezier(.34,1.5,.64,1)`. `prefers-reduced-motion` respektieren.

### 9.6 Diagramm-Regeln
1. **Eine Y-Achse** pro Diagramm. Einnahmen/Ausgaben teilen sich die Einheit, Quoten bekommen ein eigenes Diagramm.
2. Farbe nach Rolle: eine Serie = Akzent; mehrere = `--series-1..3` in fester Reihenfolge (Einnahmen = series-1, Ausgaben = series-2).
3. Ab 2 Serien **immer Legende** (10-px-Quadrate, Radius 3).
4. Linien 2 px, runde Enden; Fläche = Akzentverlauf von 32 % auf 0 % Deckkraft. Balken: 4 px Rundung nur am Datenende, 2 px Abstand, max. 26 px breit.
5. Gitterlinien haarfein in `--grid`, Nulllinie in `--axis`, Achsenbeschriftung 11 px `--muted`, `tabular-nums`.
6. Hover: Fadenkreuz + Tooltip (Linie/Fläche) bzw. Spalten-Hervorhebung + Tooltip (Balken). Tooltip: Fläche, Radius 11, 9-px-Farbquadrate, Werte rechts.
7. Letzter Wert als gefüllte Akzent-Pille am Linienende. Bezugswerte (z. B. Ziel, Vorjahr) **gestrichelt** `3 4` in `--muted`, nie als eigene Serie.
8. Jedes Diagramm hat eine Tabellen-Entsprechung. Werte sind nie nur per Hover erreichbar.
9. Plus/Minus nie nur über Farbe, immer auch ▲/▼ und Vorzeichen.

### 9.7 Icons
`lucide-react`, 18 px, `strokeWidth={1.8}`. Vorschläge: Ein- & Ausgänge `ArrowLeftRight`, Termine `CalendarDays`, Rechnungen & Quittungen `FileText`,
Vorlagen `Blocks`, Kunden `Users`, Auswertung `ChartColumn` (Reiter: Überblick `LayoutDashboard`, Liquidität `Waves`, Kennzahlen
`Sigma`, Steuer & Export `BookOpen`), Beleg `Paperclip`, Bar `Banknote`, Überweisung `Landmark`, PayPal `CircleDollarSign`
(oder eigenes „P“), Festgeschrieben `Lock`, Einstellungen `Settings`, Seitenleiste `PanelLeft`.
Logo der App: abgerundetes Quadrat (Radius 10) mit Verlauf `linear-gradient(140deg, var(--accent), var(--accent-2))` und einem weißen
Beleg-/Buch-Symbol. Der Schatten `drop-shadow(0 6px 14px color-mix(in oklab, var(--accent) 45%, transparent))` ist derselbe wie in PowerAnalytic.
Hat der Nutzer ein **Firmenlogo** hochgeladen (§6.10), steht dort stattdessen sein Logo: 34 × 34 px, weiße Kachel, Radius 9 px,
3 px Innenabstand, `object-fit: contain`, feine Kontur `0 0 0 1px var(--border)`. Das App-Symbol im Dock bleibt immer das Kladdy-Symbol.

---

## 10. Umsetzung in Phasen

Jede Phase: Prompt in Claude Code einfügen → Claude setzt um, testet und nennt die Abnahme-Punkte → du startest die App (`npm run tauri dev`) und prüfst → Commit.

### Stand (17.10.2026)
- **Veröffentlicht:** v1.0.0 (13.10.2026) mit Phase 0, Einstellungs-Seite, Updater, CI und Release-Action
  (Ablauf: `RELEASE.md`; nur von Hand, Release-Commits liegen nur auf den Tags, `main` behält 0.1.0).
- **Phase 1 in Teilen (je ein PR):**
  1. Datenbank-Fundament: SQLite, Migrationen 0001–0003, Sicherung vor Migrationen, `money.ts`, `numbering.ts`,
     Protokoll – **erledigt** (PR #7)
  2. Einstellungen „Firma“, „Steuern“, „Nummernkreise“ – **erledigt** (PR #7, in der App geprüft)
  3. Ein- & Ausgänge (§6.3) + die eine Erfassen-Schublade (§6.4) – **erledigt** (PR #10):
     Rust-Commands `buchung_anlegen`/`buchung_aendern`/`buchung_stornieren` (je eine Transaktion: Nummer, ggf. neuer
     Kunde, Buchung, Protokoll), Migration 0004 (Indizes, Schreibschutz-Trigger). Beleg erstellen/zuordnen folgt in
     Phase 3
  4. Belege ablegen (Rust-Command, SHA-256) + Drag & Drop aufs Fenster – **erledigt** (PR #11):
     `src-tauri/src/belege.rs` (`beleg_pruefen`, `beleg_anhaengen`, `beleg_oeffnen`, `beleg_zeigen`; Ablage
     `<appDataDir>/belege/<JJJJ>/<sha256>.<ext>`, im Dev `belege-dev/`, schreibgeschützt, nie überschrieben),
     Belege in derselben Transaktion wie `buchung_anlegen`/`buchung_aendern`, Frist bis 31.12. (Zahlungsjahr + 8),
     Migration 0005 (Indizes, Trigger: nie löschen, nur Frist verlängern). Dubletten werden angezeigt, nicht blockiert.
     Anhängen geht auch an festgeschriebene Buchungen, nicht an Gegenbuchungen. Erkennung (Betrag/Datum) folgt in Phase 3
  5. Kunden-Seite mit Verlauf (§6.8) – **erledigt** (PR #12): Liste (zuletzt da zuerst, Suche, Alle ·
     Stammkunden · mit Notiz, sortierbar nach Name/Besuche/Zuletzt) und Kunden-Schublade (Kontakt-Links über
     `link_oeffnen`, Kennzeile, Hinweise, Notiz speichert selbst, Stammdaten, Verlauf, „Neuen Auftrag erfassen“ öffnet die
     Erfassen-Schublade vorbelegt). Logik in `src/lib/kunden.ts` (Besuch = Quittung/Rechnung bis heute ohne Storno und
     Entwürfe + Einnahme mit Kunde ohne Beleg; Angebote und Termine nur im Verlauf). `src-tauri/src/kunden.rs`
     (`kunde_anlegen`, `kunde_aendern`, `kunde_notiz`, `kunde_loeschen`; je eine Transaktion mit Protokoll, Nummer über
     denselben Weg wie die Erfassen-Schublade). Löschen nur ohne Buchungen, Belege, Termine und Fahrten, sonst Schloss
     „Löschen ab JJJJ“ (letzte Buchung bzw. letzter Beleg + 10 Jahre); Anonymisieren folgt in Phase 5. Migration 0006
     (Indizes, Protokoll-Aktion `geloescht`). „Termin eintragen“ folgt mit Phase 3, Kunden in der Suche ⌘K später
  6. Demo-Daten + Einstellungs-Bereich „Daten“ (Demo-Daten, Tectonic-Pfad) – **erledigt** (PR #13, nachgereicht in PR #14):
     Demo-Daten **nur in der Entwicklerversion** (Debug-Build: Rust-Modul `src-tauri/src/demo.rs` mit `demo_status`,
     `demo_laden`, `demo_entfernen` nur dort übersetzt und registriert; Oberfläche nur bei `import.meta.env.DEV`, der
     Generator wird dynamisch importiert und fehlt im Release-Bundle). Eigene Datenbankdatei `kladdy-dev-demo.db` neben
     `kladdy-dev.db`, Belege im Demo-Modus in `belege-dev-demo/`, Umschalter = Markierungsdatei `demo-aktiv-dev`; die
     echte Datei wird nie beschrieben, die Sicherung vor Migrationen gilt weiter nur ihr. Generator
     `src/lib/seed/demo-daten.ts` (deterministisch, relativ zu heute: Vorjahr + laufendes Jahr, ca. 450 Buchungen und
     220 Kunden, Quittungen/Rechnungen mit Schnappschuss, Termine, zwei Stornos, KU knapp unter der Grenze); Rust prüft
     alles, vergibt die Nummern über die echten Nummernkreise und füllt die frisch migrierte Datei in einer Transaktion
     (ohne Protokoll je Zeile, nichts festgeschrieben). Tectonic: `src-tauri/src/tectonic.rs` (`tectonic_finden` in der
     Reihenfolge aus §3.1, für `compile_latex` wiederverwendbar; `tectonic_suchen`, `tectonic_pfad_pruefen`,
     `tectonic_pruefen` mit `--version` und Zeitlimit), eigener Pfad in `einstellungen['tectonic_pfad']`
- **Nächste Migration:** `0007` (ausgelieferte Migrationen nie ändern).
- **Phase 1 abgeschlossen.** Weiter mit **Phase 2** in Teilen (je ein PR): 1. Diagramm-Komponenten (§9.6, §9.5) ·
  2. Auswertung mit großem Umschalter + Überblick (§6.9.1) · 3. Liquidität (§6.9.2) · 4. Suche/Befehlspalette ⌘K (§6.2)
- **Phase 2 in Teilen:**
  1. + 2. Diagramm-Komponenten und Auswertung › Überblick – **umgesetzt (Branch `phase-2-ueberblick`)**:
     `src/components/charts/` (`BarChart`, `AreaChart` mit gestricheltem Bezugswert und Endwert-Pille, `Donut` mit
     Werteliste, `Sparkline`, `ChartTip`, `Legend`, `ChartTabelle` = aufklappbare „Werte als Tabelle“ unter jedem
     Diagramm, `useBreite` mit ResizeObserver), Mathematik in `src/lib/charts.ts` (Achsenteilung, Pfade, Donut-Bögen,
     Achsenbeschriftung „12 Tsd.“, Hochzählen), Farben nur als CSS-Variable `--c` (`charts.css`, weniger Bewegung =
     nur Einblenden). Überblick (`src/pages/auswertung/Ueberblick.tsx`): Zeitraum im Kopf und in der Adresse
     (`?modus=…&anker=…`, gilt auch für Ein- & Ausgänge), Status-Pillen Kleinunternehmer (nur bei `ust_modus` 'klein',
     Grenzen aus den Steuer-Kennwerten des Jahres) · offene Rechnungen · ohne Beleg (im Zeitraum, springt in Ein- &
     Ausgänge mit genau diesem Filter), KPI-Reihe mit Hochzählen und ▲/▼ ggü. gleich langer Vorperiode (Kacheln
     springen in die passend gefilterte Liste), Balken je Monat (Klick wählt den Monat), Überschuss kumuliert vs.
     Vorjahr, Donuts Kategorien/Zahlungswege. Rechnen in `src/lib/auswertung.ts` (Storno-Gegenbuchungen negativ an
     ihrem Zahlungsdatum, Ausgaben = abziehbarer Teil, Aufträge = Besuche wie `lib/kunden.ts`), Daten in
     `src/lib/queries/auswertung.ts` (alle Buchungen in einer Abfrage). Ein- & Ausgänge übernimmt Filter und Zeitraum
     aus der Adresse (`listenVorgabe` in `lib/buchungen.ts`). „Nächste 90 Tage“ folgt mit Liquidität, „Meine
     Kennzahlen“ mit Phase 4; die Pillen Kleinunternehmer und offene Rechnungen zeigen bis Phase 5 bzw. 3 auf die
     Platzhalter von Steuer & Export bzw. Rechnungen & Quittungen
- **Offen aus Phase 1 (Teil 1+2):** optionale Kategorien (AfA,
  Bewirtung, Geschenke, Homeoffice), Kategorien bearbeiten und EÜR-Zuordnung pro Jahr (braucht eigene Tabelle),
  Firmenlogo (nach der Dateiablage), sichtbare Fehlermeldung statt stillem Abbruch, wenn die Sicherung vor einer
  Migration fehlschlägt, Regelbesteuerung wirkt noch nicht auf Buchungen/Belege.
- **Updater überarbeitet** (eigener kleiner PR): Laden und Neustart getrennt, „Später“ ⇒ beim nächsten Start aktiv,
  im Dev nie installieren (Details §3.2 Punkt 5). v1.0.1 veröffentlicht (15.10.2026), Update von 1.0.0 aus getestet
  (noch mit dem alten Ablauf der 1.0.0); den neuen Ablauf zeigt erst das nächste Update ab 1.0.1.

### Phase 0 – Grundgerüst & Design
> Setze Phase 0 aus `ANLEITUNG.md` um: `git init`; Tauri-2-Projekt mit React + TypeScript + Vite (`npm create tauri-app@latest`);
> Fenster-Konfiguration für macOS (§3.1); Schriften lokal; Tokens und Komponenten-CSS aus §9; App-Shell (Seitenleiste, Topbar,
> leere Seiten für alle Bereiche, HashRouter); Hell/Dunkel mit Kreis-Übergang; Einstellungs-Schublade nur mit dem Abschnitt „Darstellung“
> (Themes, Akzent, Farbton, Radius, Schriftgröße, Dichte, Bewegung, Glas, Aurora, Plus/Minus, Monospace-Zahlen; in localStorage speichern).
> Native Menüleiste inkl. Bearbeiten-Menü. Starte die App und nenne mir die Prüfpunkte.

**Abnahme:** App startet · Ampel-Knöpfe überdecken nichts, Fenster lässt sich an der Kopfzeile ziehen · Kopfzeile wirkt durchgehend ·
Seitenleiste klappt ein/aus · Theme-Wechsel funktioniert in Hell und Dunkel · ⌘C/⌘V gehen in Textfeldern.

### Phase 1 – Datenbank & Buchungen
> Setze Phase 1 um: SQLite mit `tauri-plugin-sql` und der Migration aus §5; Standardkategorien aus §2.8; Steuer-Kennwerte 2026 aus §2.6;
> Einstellungen-Abschnitte „Firma“, „Steuern“, „Nummernkreise“; Seitenleiste mit den fünf Menüpunkten (§6.1); Seite „Ein- & Ausgänge“
> nach §6.3 (Tabelle, Filterleiste) und die **eine** Erfassen-Schublade nach §6.4 (Knopf im Kopf von Ein- & Ausgänge + ⌘N, Zahlungsweg-Kacheln,
> Beleg-Dropzone mit Rust-Command zum Ablegen + SHA-256, Drag & Drop aufs Fenster, Toasts, Protokoll-Tabelle);
> Kunden-Seite mit Verlauf (§6.8). Geld in Cent. Demo-Daten (ca. 450 Buchungen, 220 Kunden über 22 Monate) per Einstellung ladbar.
> Vitest-Tests für money.ts, numbering.ts.

**Abnahme:** Buchung in < 10 s erfassbar · es gibt genau einen Erfassen-Weg · Beleg wird abgelegt und lässt sich öffnen ·
Filter stimmen · Nummern lückenlos · Änderungen erscheinen im Protokoll · Kunde zeigt alle Besuche.

### Phase 2 – Auswertung: Überblick, Liquidität & Diagramme
> Setze Phase 2 um: SVG-Diagrammkomponenten nach §9.6 (BarChart, AreaChart, Donut, Sparkline, ChartTip, Legend) mit den
> Animationen aus §9.5; Seite „Auswertung“ mit großem Umschalter (§6.9, §9.3) und den Reitern **Überblick** nach §6.9.1
> (Status-Pillen, Zeitraum-Umschalter, KPI-Reihe mit Hochzählen, Diagramme) und **Liquidität** nach §6.9.2
> (Modell `prognose()` wie im Prototyp: kumulierter Überschuss ab heute, Prognosediagramm, Annahmen-Regler, Planposten,
> Tabelle der erwarteten Zahlungen je Kalenderwoche, einfache Pflege der wiederkehrenden Kosten als Liste in den Annahmen –
> Name, Betrag, Rhythmus, Tag); Reiter Kennzahlen und Steuer & Export vorerst als Platzhalter.
> Globale Suche/Befehlspalette (⌘K, §6.2).
> Orientiere dich an `referenz/prototyp` (#/auswertung und #/liquiditaet).

**Abnahme:** Zahlen im Überblick = Summen der gefilterten „Ein- & Ausgänge“ für denselben Zeitraum · Diagramme mit Hover-Tooltip ·
KU-Status springt bei Demo-Daten korrekt um · Liquidität: Regler wirken sofort, erwartete Zahlungen stimmen mit offenen Rechnungen
und Planposten überein · keine Statistik außerhalb der Auswertung.

### Phase 3 – Belege, Baukasten-Vorlagen, PDF, GiroCode
> Setze Phase 3 um: Rust-Command `compile_latex` (§7.2, Tectonic-Suche aus §3.1); `daten.tex`-Erzeugung + LaTeX-Escaping +
> Zahl-in-Worten mit Tests; Bausteine nach §7.0 mit je HTML-Darstellung (Vorschau) und LaTeX-Schnipsel (PDF), Standardvorlagen
> für Rechnung/Quittung/Angebot/Eigenbeleg (Aussehen wie §7.5/§7.6 und Prototyp) – erzeugte Vorlagen **kompilieren und reparieren**;
> Seite „Termine“ nach §6.5 (Agenda, Termin-Schublade, vorbereiteter Beleg als Entwurf ohne Nummer, Abhaken und danach „Quittung ausstellen“ über die Erfassen-Schublade mit `entwurf`,
> Absagen ohne Storno, Seitenleisten-Zähler); Seite „Rechnungen & Quittungen“ nach §6.6 (Liste nach Nummern, Filter Alle · Offen ·
> Bezahlt, Zeitraum Monat · Jahr · Gesamt, Status-Menü am Badge, „Neu“-Menü, Button „Vorlagen“);
> Vorlagen-Seite als Baukasten (§7.0, Prototyp #/vorlagen); Beleg-Maske nach §6.6 (eine Maske für alle Arten, Live-Vorschau,
> Pflichtangaben-Check, Finalisieren als Transaktion in Rust, Stornorechnung, „bezahlt“ ⇒ Einnahme, Quittung, Eigenbeleg mit
> „Buchen“, Drucken/PDF, ⌘P); „Beleg zum Ertrag“ in der Erfassen-Schublade (§6.4: Quittung/Rechnung erstellen mit Vorlage und
> angezeigter Nummer, offene Rechnung zuordnen, unterschriebenes Exemplar als Schritt 2); GiroCode (EPC-QR) nach §6.6 mit Tests
> (Payload + Decodierbarkeit); Badge „überfällig“ in der Seitenleiste; Beleg-Drop auf das Fenster mit Erkennung (pdf.js-Text,
> Regeln wie `prototyp/js/beleg.js`).

**Abnahme:** Rechnung mit Sonderzeichen im Kundennamen (`Müller & Söhne 100%`) kompiliert · PDF sieht aus wie die Vorschau ·
GiroCode lässt sich mit einer Banking-App scannen (Betrag + Verwendungszweck stimmen) · Baustein entfernen ⇒ Pflichtangaben-Check
meldet es · nach dem Finalisieren nicht mehr änderbar · „bezahlt“ erzeugt genau eine Einnahme · PDF aufs Fenster ziehen ⇒ Formular
vorausgefüllt.

### Phase 4 – Kennzahlen mit Formeln
> Setze Phase 4 um: Formel-Engine nach §8.1–8.2 und §8.5 (Lexer, Pratt-Parser, Auswerter, Funktionen, Fehler mit Position und
> „meintest du …?“), umfangreiche Vitest-Tests; Seite „Kennzahlen“ nach §8.4 (CodeMirror mit Autovervollständigung, Live-Ergebnis,
> Erklären-Ansicht, Variablen) als Reiter der Auswertung; Beispiel-Kennzahlen aus §8.3 vorinstallieren; angeheftete Kennzahlen
> im Überblick mit Sparkline.

**Abnahme:** Alle Beispiel-Kennzahlen liefern plausible Werte mit Demo-Daten · Tippfehler zeigen hilfreiche Meldung ·
Zeitraumwechsel aktualisiert alle Kennzahlen.

### Phase 5 – Steuer & Export, Backup, GoBD
> Setze Phase 5 um: Reiter „Steuer & Export“ nach §6.9.4 (EÜR-Tabelle mit Monatsspalten, PDF über eine LaTeX-Vorlage „EÜR-Bericht“,
> CSV; ELSTER-Ausfüllhilfe mit Kopier-Knöpfen nach §2.9; Wareneingangsbuch; Kleinunternehmer-, Gewerbesteuer- und IHK-Check mit
> nächster Frist aus §2.7; ZIP-Export; Anlagen & AfA mit automatischen AfA-Buchungen; Jahresabschluss-Assistent);
> Festschreiben mit SQLite-Triggern; Storno-Buchungen; Backup nach §6.10 (VACUUM INTO + Belege als ZIP, täglich automatisch,
> Ziel wählen, Warnung bei gleichem Datenträger, Erinnerung nach 30 Tagen, Punkt am ⚙, Wiederherstellen mit Vorschau);
> Aufbewahrungsfristen je Beleg; Kunden „Löschen ab JJJJ“ und Anonymisieren nach §6.8/§2.10.

**Abnahme:** EÜR-Summe = Überschuss im Überblick · CSV öffnet sich in Numbers/Excel mit Umlauten und Dezimalkomma ·
festgeschriebene Buchung lässt sich nicht ändern (auch nicht per SQL) ·
Backup lässt sich in eine frische Installation zurückspielen · Backup-Ordner auf dem internen Laufwerk ⇒ Warnung und Punkt
am ⚙, auf einem USB-Stick ⇒ keine Warnung · Kunde mit Buchung von 2014 lässt sich anonymisieren, einer von 2026 nicht.

### Phase 6 – Download & Updates
> Setze Phase 6 nach §3.2 um: Bundle-Identifier festlegen, Ad-hoc-Signatur (`signingIdentity: "-"`), `.dmg` bauen;
> Tectonic als Sidecar bündeln; `tauri-plugin-updater` + `tauri-plugin-process` mit Update-Schlüssel, `createUpdaterArtifacts`,
> Endpoint auf `latest.json`; Update-Prüfung beim Start (max. 1×/Tag) und im Menü „Nach Updates suchen …“, Toast mit
> „Was ist neu“, Backup vor dem Update, Fortschritt, Neustart; GitHub-Action `tauri-action`, die bei einem Versions-Tag
> `.dmg`, Update-Paket und `latest.json` als Release veröffentlicht; `minimumSystemVersion` 14.0; Download-Seite aus
> `referenz/download-seite/` nach `docs/` übernehmen (GitHub Pages, §3.2); „Über Kladdy“ mit Lizenzen und
> Willkommens-Dialog beim ersten Start (§6.10); `LICENSE` (MIT). Prüfe die Schritte gegen die aktuelle Tauri-Doku.

**Abnahme:** `.dmg` auf einem zweiten Mac (oder neuem Benutzerkonto) installierbar und nach einmaliger Freigabe startbar ·
PDF-Erzeugung funktioniert dort ohne Homebrew · Version 1.0.1 veröffentlicht ⇒ 1.0.0 meldet das Update, installiert es und
startet neu · alle Daten sind nach dem Update noch da · ein manipuliertes Update-Paket wird abgelehnt · die Download-Seite
zeigt die neue Version und verlinkt die `.dmg` direkt.

### Phase 7 – Komfort (optional, einzeln beauftragen)
- **DATEV-Export** (§2.9) für den Steuerberater: Buchungsstapel-CSV + Belege als ZIP, Kontenzuordnung je Kategorie
- **Bank-CSV-Import** mit Zuordnungsregeln („Verwendungszweck enthält ‚Telekom‘ ⇒ Sonstige Kosten“) und Dubletten-Erkennung;
  nur die geschäftlichen Zahlungen werden übernommen (das Konto ist meist zugleich das Privatkonto)
- **Wiederkehrende Buchungen** (Handy, Versicherungen) monatlich automatisch als Ausgabe vorschlagen (die Liste selbst
  gibt es seit Phase 2)
- **E-Rechnung empfangen:** XRechnung (XML) und ZUGFeRD (PDF mit eingebettetem XML) importieren ⇒ Ausgabe vorausgefüllt,
  XML im Original archiviert, lesbare Ansicht
- **Texterkennung für Scans/Fotos** über das macOS-Vision-Framework (kleines Swift-Hilfsprogramm als Sidecar), ergänzt die PDF-Text-Erkennung aus Phase 3
- **Apple Kalender & Erinnerungen:** Termine per EventKit in einen eigenen Kalender „Kladdy“ schreiben (und Änderungen
  zurücklesen), Mitteilung am Morgen eines Termins
- **Mahnwesen:** Zahlungserinnerung/Mahnung als Vorlage, Erinnerung bei Überfälligkeit
- **Fahrtenliste** + Homeoffice-Tage-Kalender ⇒ automatische Pauschalen-Buchungen
- **Ziele:** Monatsumsatz-Ziel als Fortschrittsring im Überblick der Auswertung
- **App-Sperre** mit Touch ID / Passwort, verschlüsselte Backups
- **Notarisierung** mit Apple-Entwicklerkonto, damit die App ohne „Dennoch öffnen“ startet (§3.2)

---

## 11. Inhalt für `CLAUDE.md`

```markdown
# Kladdy – Projektregeln

- Spezifikation: ANLEITUNG.md (immer die passende Sektion lesen, bevor du etwas baust).
- Visuelle/funktionale Referenz: referenz/prototyp (HTML-Prototyp). Neue Ansichten so aussehen und verhalten lassen wie dort.
- Sprache der UI: Deutsch. Datums-/Zahlenformat de-DE. Echtes Minuszeichen (−) in Anzeigen.
- Geld IMMER als Integer-Cent speichern und rechnen. Nie Floats für Beträge.
- Datum als 'YYYY-MM-DD'. EÜR-Zuordnung über zahlungsdatum (Zufluss/Abfluss).
- Design: ausschließlich Tokens/Komponenten aus ANLEITUNG §9 (CSS-Variablen). Keine Inline-Farben, kein Tailwind.
  Jede Aktion genau einmal: Erfassen NUR über „+ Erfassen“ im Kopf von Ein- & Ausgänge
  (⌘N von überall) bzw. Datei-Drop – kein Erfassen-Knopf in der Kopfzeile; andere Stellen öffnen höchstens
  dieselbe Schublade vorbelegt. Statistik (KPI-Kacheln, Summen, Diagramme) NUR in der Auswertung, nie in Listen.
  Menü: genau fünf Punkte (Ein- & Ausgänge · Termine · Rechnungen & Quittungen · Kunden · Auswertung). Keine Konten/Kontostände,
  nur Zahlungsweg (bar/bank/paypal). Logo = Startseite; Einstellungen nur über ⚙.
- Diagramme: eigene SVG-Komponenten nach §9.6. Plus/Minus nie nur über Farbe.
- Formeln: eigener Parser, niemals eval/new Function.
- LaTeX: Nutzerwerte immer über lib/latex/escape.ts. Tectonic nur mit --untrusted aufrufen.
- Kunden immer per ID verknüpfen, nie per Name. Kundenfelder: Vorschläge „Name · K-0012“, bei gleichem Namen nachfragen.
- GoBD: Festgeschriebene/finalisierte Daten nie ändern oder löschen → Storno. Jede Änderung ins Protokoll.
  Nummern atomar und erst beim Ausstellen vergeben (Entwürfe, auch für Termine vorbereitete, haben keine Nummer), nie
  wiederverwenden. Kundendaten beim Ausstellen als Schnappschuss in den Beleg. Belege nie überschreiben.
- Quittung = Zahlungsbestätigung, immer bezahlt (Standard bei Einnahmen); Rechnung = Zahlungsaufforderung, offen oder bezahlt.
- Mehrschritt-Vorgänge (finalisieren, stornieren, festschreiben, backup) als Rust-Command mit Transaktion.
- Datenbank nur in appDataDir, nie in iCloud Drive. Schema nur per nummerierter Migration ändern (Updates!), vorher Backup.
- Updates: Update-Schlüssel nie ins Repository; Version in tauri.conf.json und package.json gleich halten.
- Datenschutz: kein Tracking, keine Telemetrie, keine externen Schriften. Netz nur für Update-Prüfung und Tectonic-Pakete.
  Kunden mit Buchungen/Belegen erst nach Fristablauf anonymisieren (§2.10), nie vorher löschen.
- Tests: Vitest für lib/*, cargo test für Rust. Vor jedem Commit: npm run typecheck && npm test.
- Nach jeder Phase: App mit `npm run tauri dev` starten und Prüfpunkte nennen.
```

---

## 12. Weitere Ideen (Backlog)

**Komfort im Alltag**
- **Erfassen aus der Menüleiste** (Tray-Icon): öffnet dieselbe Erfassen-Schublade als Mini-Fenster (kein zweiter Erfassen-Weg)
- **Baustein „Arbeitskosten nach § 35a EStG“:** Positionen als Arbeit/Material markieren, auf der Rechnung „Enthaltene
  Arbeits- und Fahrtkosten: … €“ ausweisen – Mehrwert für Privatkunden bei Garten- und Hausarbeiten (§2.3)
- **Schnellrechner** (aus PowerAnalytic): schwebender Knopf unten rechts ⇒ Rechner-Panel mit Brutto ↔ Netto und
  Stundensatz; Klick auf einen Betrag übernimmt ihn. Nicht im Prototyp – nur bauen, wenn ausdrücklich gewünscht
- **Getrennte Konten (optional):** wer doch ein eigenes Geschäftskonto/Kasse führt, kann später Konten mit Anfangsbestand und Saldo zuschalten
- **Beleg-Postfach:** Ordner überwachen (z. B. `~/Downloads/Belege`), neue PDFs landen als „unzugeordnet“ in einer Inbox
- **„Fehlt noch“ erweitern:** zusätzlich zu „ohne Beleg“ (Ein- & Ausgänge) und „Offen“ (Rechnungen) z. B. Bewirtungen ohne
  Teilnehmer – als weiterer Filter bzw. Status-Pille, nicht als eigene Liste (jede Funktion genau einmal)
- **Tastatur zuerst:** alles per ⌘K erreichbar, Tabellen mit ↑/↓/↩ bedienbar

**Auswertung & Planung**
- **Was-wäre-wenn:** „Wenn ich ab Januar 10 € mehr pro Stunde nehme …“ (Formel mit veränderbaren Variablen)
- **Kunden-Ranking:** Umsatzanteil pro Kunde (Abhängigkeit von einem Großkunden erkennen)
- **Saisonalität:** Heatmap Umsatz nach Monat × Jahr
- **Steuer-Schätzer:** Einkommensteuer grob schätzen (mit Hinweis „unverbindlich“), um die Rücklage besser zu setzen

**Rechnungen**
- Angebote mit Gültigkeit, Annahme per Klick ⇒ Rechnung
- Mehrere Vorlagen-Designs als Galerie (minimal, klassisch, farbig)
- Mehr Bausteine: Bild/Foto, Tabelle frei, Bedingungen („nur zeigen, wenn Betrag > 250 €“)
- Später: ZUGFeRD-Ausgabe, falls die Regelbesteuerung kommt

**Sicherheit & Daten**
- Versionierte Backups (letzte 30 Tage), Integritätsprüfung (Hashes der Belege)
- Verfahrensdokumentation als vorausgefülltes PDF (GoBD empfiehlt eine; die App kann den Großteil selbst beschreiben)
- Verzeichnis der Verarbeitungstätigkeiten (Art. 30 DSGVO) als vorausgefülltes PDF (§2.10)
- „Alte Jahre aufräumen“: nach Ablauf der Fristen Belege, Buchungen und Kunden eines Jahres gesammelt löschen bzw. anonymisieren
- Time Machine erkennen (`tmutil latestbackup`): läuft sie regelmäßig auf ein externes Laufwerk, entfällt die Backup-Warnung

---

## 13. Quellen (Recherche 09.10.2026, nachgeprüft 12.10.2026)

- § 34a UStDV (Rechnungen von Kleinunternehmern): https://www.gesetze-im-internet.de/ustdv_1980/__34a.html
- § 14 UStG (Rechnungspflicht, Grundstücksleistungen jetzt Abs. 2 Satz 2 Nr. 3): https://www.gesetze-im-internet.de/ustg_1980/__14.html
- BMF-Schreiben vom 18.03.2025 zur Kleinunternehmerregelung: https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-03-18-sonderregelung-kleinunternehmer.pdf
- Tauri 2 Konfiguration (`trafficLightPosition`, `createUpdaterArtifacts`, `externalBin`): https://v2.tauri.app/reference/config/
- Tauri 2 Updater (Schlüssel, `latest.json`, Berechtigungen): https://v2.tauri.app/plugin/updater/
- Tauri-CLI 2.6.0 (Warnung bei Identifier mit Endung `.app`): https://v2.tauri.app/release/tauri-cli/v2.6.0/
- Homebrew-Formel Tectonic (Abhängigkeiten): https://formulae.brew.sh/formula/tectonic
- Kleinunternehmerregelung 2026, Grenzen 25.000/100.000 €: https://kostenlose-erechnung.de/ratgeber/kleinunternehmerregelung-2026/
- Kleinunternehmer 2026 Pflichten: https://pandotax.de/gruender/kleinunternehmerregelung-2026-umsatzgrenze-pflichten/
- Kleinunternehmer Steuer, Kleingewerbe vs. Kleinunternehmer: https://selbststaendigkeit.de/buchhaltung-fuer-gruender/kleinunternehmer-steuer/
- Wegfall USt-Erklärung ab 2024, Gewerbesteuer-Freibetrag: https://www.fastlancer.org/fastlancer-blog/kleinunternehmer-umsatzsteuererklaerung-pflicht/
- E-Rechnung für Kleinunternehmer: https://kostenlose-erechnung.de/ratgeber/e-rechnung-kleinunternehmer/
- E-Rechnungspflicht 2027 (800.000 €): https://kostenlose-erechnung.de/ratgeber/e-rechnungspflicht-2027-versandpflicht/
- Aufbewahrungsfristen nach BEG IV (8 Jahre): https://www.haufe.de/steuern/gesetzgebung-politik/viertes-buerokratieentlastungsgesetz_168_613390.html
- Rechnungspflichtangaben (IHK): https://www.frankfurt-main.ihk.de/recht/uebersicht-alle-rechtsthemen/steuerrecht/umsatzsteuer-national/rechnungen-pflichtangaben-in-der-rechnung-5195692
- Design-Vorlage: PowerAnalytic (`prototyp/styles.css`, `docs/DESIGN.md`, `docs/BAUSTEINE.md`), Stand 08.10.2026

Einige Kennwerte in §2.6/§2.7 (GWG-Nettoregel, Bewirtung, Geschenke, Pauschalen, IHK, § 141 AO, Fristen) stammen aus allgemeinem
Steuerwissen und wurden nur auf Plausibilität (Stand Oktober 2026), **nicht** einzeln gegen eine amtliche Quelle geprüft. Vor der ersten Steuererklärung mit der App bitte einmal von
einem Steuerberater oder im aktuellen ELSTER-Formular gegenprüfen.
