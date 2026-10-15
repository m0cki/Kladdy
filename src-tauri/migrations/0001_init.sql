-- 0001: Startmigration, wörtlich aus ANLEITUNG §5.
-- NIE ÄNDERN, sobald sie ausgeliefert ist: sqlx merkt sich eine Prüfsumme je Migration und verweigert sonst den Start.
-- Schemaänderungen immer als neue, fortlaufend nummerierte Datei (0003_…sql) und in src-tauri/src/datenbank.rs eintragen.

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
