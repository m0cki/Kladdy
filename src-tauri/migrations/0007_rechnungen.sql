-- 0007: Rechnungen & Quittungen (Phase 3 Teil 2): Spalten für Zahlungsweg und Entwurfsangaben, Indizes für Liste,
-- Status und Termine, GoBD-Schutz ausgestellter Belege. NIE ÄNDERN, sobald sie ausgeliefert ist (Prüfsumme, siehe 0001).

-- Zahlungsweg des Belegs (Quittung, Eigenbeleg, bezahlte Rechnung) – nur Anzeige und Vorbelegung, keine Konten.
-- Die Zahlung selbst steht immer als Buchung in `buchungen` (rechnung_id).
ALTER TABLE rechnungen ADD COLUMN zahlungsart TEXT CHECK (zahlungsart IN ('bar', 'bank', 'paypal'));
-- Angaben, die ein Entwurf braucht (JSON-Objekt, z. B. Eigenbeleg-Grund, verknüpfte Zahlung, Herkunft aus einem
-- Angebot). Bleibt nach dem Ausstellen unverändert stehen (Herkunft); alles Gedruckte steht im snapshot_json.
ALTER TABLE rechnungen ADD COLUMN entwurf_json TEXT;

CREATE INDEX rechnungen_datum ON rechnungen (datum);
CREATE INDEX rechnungen_status ON rechnungen (status, art);
CREATE INDEX rechnungen_termin_id ON rechnungen (termin_id);
-- Ein Beleg wird höchstens einmal storniert (Stornobeleg mit storno_von_id; NULL zählt nicht als Dublette).
CREATE UNIQUE INDEX rechnungen_storno_von_id ON rechnungen (storno_von_id);
CREATE INDEX rechnungspositionen_rechnung_id ON rechnungspositionen (rechnung_id, pos);
CREATE INDEX belege_rechnung_id ON belege (rechnung_id);

-- GoBD (ANLEITUNG §2.5, §6.6): Ausgestellte Belege (nummer gesetzt) werden nie gelöscht und nie geändert, Korrektur nur
-- per Storno. Geprüft in den Rust-Commands (src-tauri/src/rechnungen.rs) und hier als letzte Sicherung.
-- Erlaubt bleibt: der Status (Rechnung offen ⇄ bezahlt mit bezahlt_am und zahlungsart, Angebot, storniert) samt
-- geaendert_am sowie das einmalige Setzen von PDF, unterschriebenem Exemplar und Schnappschuss (alte Belege ohne).
-- Entwürfe (nummer NULL) sind frei; die Nummer wird nur einmal gesetzt (OLD.nummer NULL ⇒ der Trigger greift nicht).
CREATE TRIGGER rechnungen_ausgestellt_loeschen BEFORE DELETE ON rechnungen
WHEN OLD.nummer IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Ausgestellte Belege werden nie gelöscht (GoBD). Korrektur nur per Storno.');
END;

CREATE TRIGGER rechnungen_ausgestellt_aendern BEFORE UPDATE ON rechnungen
WHEN OLD.nummer IS NOT NULL AND NOT (
  NEW.id IS OLD.id
  AND NEW.art IS OLD.art
  AND NEW.nummer IS OLD.nummer
  AND NEW.kunde_id IS OLD.kunde_id
  AND NEW.kunde_name IS OLD.kunde_name
  AND NEW.kunde_adresse IS OLD.kunde_adresse
  AND NEW.kunde_nummer IS OLD.kunde_nummer
  AND NEW.datum IS OLD.datum
  AND NEW.leistung_von IS OLD.leistung_von
  AND NEW.leistung_bis IS OLD.leistung_bis
  AND NEW.faellig_am IS OLD.faellig_am
  AND NEW.betreff IS OLD.betreff
  AND NEW.einleitung IS OLD.einleitung
  AND NEW.schlusstext IS OLD.schlusstext
  AND NEW.summe_cent IS OLD.summe_cent
  AND NEW.vorlage_id IS OLD.vorlage_id
  AND (NEW.pdf_beleg_id IS OLD.pdf_beleg_id OR OLD.pdf_beleg_id IS NULL)
  AND (NEW.scan_beleg_id IS OLD.scan_beleg_id OR OLD.scan_beleg_id IS NULL)
  AND NEW.termin_id IS OLD.termin_id
  AND (NEW.snapshot_json IS OLD.snapshot_json OR OLD.snapshot_json IS NULL)
  AND NEW.storno_von_id IS OLD.storno_von_id
  AND NEW.erstellt_am IS OLD.erstellt_am
  AND NEW.entwurf_json IS OLD.entwurf_json
)
BEGIN
  SELECT RAISE(ABORT, 'Der Beleg ist ausgestellt und kann nicht mehr geändert werden (GoBD). Korrektur nur per Storno.');
END;

-- Storniert ist endgültig.
CREATE TRIGGER rechnungen_storniert_endgueltig BEFORE UPDATE OF status ON rechnungen
WHEN OLD.status = 'storniert' AND NEW.status IS NOT 'storniert'
BEGIN
  SELECT RAISE(ABORT, 'Der Beleg ist storniert. Das ist endgültig (GoBD).');
END;

-- Positionen ausgestellter Belege: kein Hinzufügen, Ändern oder Löschen. Wer einen Beleg ausstellt, schreibt erst die
-- Positionen und setzt danach die Nummer (so auch die Demo-Daten und der Stornobeleg).
CREATE TRIGGER rechnungspositionen_ausgestellt_neu BEFORE INSERT ON rechnungspositionen
WHEN (SELECT nummer FROM rechnungen WHERE id = NEW.rechnung_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Positionen ausgestellter Belege sind festgeschrieben (GoBD).');
END;

CREATE TRIGGER rechnungspositionen_ausgestellt_aendern BEFORE UPDATE ON rechnungspositionen
WHEN (SELECT nummer FROM rechnungen WHERE id = OLD.rechnung_id) IS NOT NULL
  OR (SELECT nummer FROM rechnungen WHERE id = NEW.rechnung_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Positionen ausgestellter Belege sind festgeschrieben (GoBD).');
END;

CREATE TRIGGER rechnungspositionen_ausgestellt_loeschen BEFORE DELETE ON rechnungspositionen
WHEN (SELECT nummer FROM rechnungen WHERE id = OLD.rechnung_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Positionen ausgestellter Belege sind festgeschrieben (GoBD).');
END;
