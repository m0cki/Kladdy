-- 0008: Kategorien bearbeiten (ANLEITUNG §2.8, offen aus Phase 1): optionale Kategorien im Katalog, EÜR-Zuordnung pro
-- Jahr, Schutz-Trigger. NIE ÄNDERN, sobald sie ausgeliefert ist (Prüfsumme, siehe 0001).
-- Geschrieben wird aus Einstellungen › Steuern (src/lib/queries/kategorien.ts, jede Änderung ins Protokoll).

-- Optionale Kategorien (§2.8: Spezialfälle bleiben im Katalog, sind aber standardmäßig ausgeblendet).
-- Ausgeblendet = archiviert = 1, dieselbe Spalte wie beim Ausblenden durch den Nutzer: beim Erfassen nicht angeboten, auf
-- bestehenden Buchungen weiter gültig (src-tauri/src/buchungen.rs → kategorie_pruefen). Ein eigenes Katalog-Kennzeichen
-- gibt es bewusst nicht: Einstellungen › Steuern blendet sie ein und aus wie jede andere Kategorie, und alle Abfragen
-- bleiben bei `archiviert = 0`. IDs vergibt SQLite (nächste freie), Farbe/Icon wie in 0002 (Icon = lucide-Name,
-- src/components/buchungen/Symbole.tsx). Bewirtung 70 % abziehbar (§2.6), Geschenke nur bis 50 € je Empfänger und Jahr
-- (Empfänger in buchungen.extra_json, Summe je Empfänger kommt mit der EÜR in Phase 5).
-- AfA und Homeoffice sind eigentlich Buchungen ohne Geldfluss (buchungen.art 'afa' bzw. 'pauschale'); die legen später das
-- Anlagen- bzw. Pauschalen-Modul an. Zeilennummern der Anlage EÜR stehen nicht hier, sondern in euer_zuordnung (unten).
INSERT INTO kategorien
  (name, typ, euer_bereich, abziehbar_prozent, zaehlt_ku_umsatz, wareneingang, farbe, icon, stichworte, sortierung, archiviert)
VALUES
  ('Abschreibungen (AfA)', 'ausgabe', 'AfA auf bewegliche Wirtschaftsgüter', 100, 0, 0, '#64748b', 'trending-down',
   'abschreibung', 5, 1),
  ('Bewirtung', 'ausgabe', 'Bewirtungsaufwendungen', 70, 0, 0, '#ec4899', 'utensils',
   'bewirtung,restaurant,gaststätte,gasthaus,geschäftsessen,bistro,pizzeria', 6, 1),
  ('Geschenke', 'ausgabe', 'Geschenke', 100, 0, 0, '#10b981', 'gift',
   'geschenk,präsentkorb,pralinen', 7, 1),
  ('Homeoffice', 'ausgabe', 'Häusliches Arbeitszimmer / Tagespauschale', 100, 0, 0, '#f97316', 'house',
   'homeoffice,arbeitszimmer,tagespauschale', 8, 1);

-- EÜR-Zuordnung pro Jahr (§2.8: „Die genaue Zeilennummer der Anlage EÜR ändert sich manchmal von Jahr zu Jahr“).
-- Je Jahr und Kategorie die Zeile der Anlage EÜR und, nur wenn nötig, ein eigener EÜR-Bereich für genau dieses Jahr:
--   euer_bereich NULL = der Bereich der Kategorie (kategorien.euer_bereich, in Einstellungen › Steuern bearbeitbar),
--   euer_zeile   NULL = Zeile (noch) nicht eingetragen.
-- Ein Jahr ohne eigene Zeilen übernimmt die des nächstälteren Jahres (wie die Steuer-Kennwerte); „Jahr anlegen“ kopiert
-- das Vorjahr. Gelesen über src/lib/queries/kategorien.ts → ladeEuerZuordnung(jahr) (EÜR-Auswertung, Phase 5).
-- Protokoll wie steuer_parameter: datensatz_id = 0, schluessel = Jahr, alt/neu mit kategorie_id.
CREATE TABLE euer_zuordnung (
  jahr INTEGER NOT NULL CHECK (jahr BETWEEN 2000 AND 2100),
  kategorie_id INTEGER NOT NULL REFERENCES kategorien(id),
  euer_bereich TEXT CHECK (euer_bereich IS NULL OR length(trim(euer_bereich)) > 0),
  euer_zeile INTEGER CHECK (euer_zeile IS NULL OR euer_zeile BETWEEN 1 AND 999),
  PRIMARY KEY (jahr, kategorie_id)
);

-- Startwerte 2026 für alle Kategorien: Bereich wie die Kategorie, Zeilen leer. Die Zeilennummern ändern sich mit dem
-- Formular und werden erst nach einem Blick in die aktuelle Anlage EÜR eingetragen.
INSERT INTO euer_zuordnung (jahr, kategorie_id, euer_bereich, euer_zeile)
  SELECT 2026, id, NULL, NULL FROM kategorien ORDER BY id;

-- „Hat die Kategorie Buchungen?“ (Einstellungen › Steuern, Filter in Ein- & Ausgänge, Trigger unten)
CREATE INDEX buchungen_kategorie_id ON buchungen (kategorie_id);

-- Letzte Sicherung neben der Prüfung in der Oberfläche: Je Art (Einnahme, Ausgabe) bleibt mindestens eine Kategorie
-- sichtbar, sonst ließe sich nichts mehr erfassen.
CREATE TRIGGER kategorien_letzte_sichtbare BEFORE UPDATE OF archiviert ON kategorien
WHEN NEW.archiviert <> 0 AND OLD.archiviert = 0
  AND NOT EXISTS (SELECT 1 FROM kategorien k WHERE k.typ = OLD.typ AND k.archiviert = 0 AND k.id <> OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'Mindestens eine Kategorie je Art (Einnahme, Ausgabe) muss sichtbar bleiben.');
END;

-- Buchungen müssen zur Art ihrer Kategorie passen: Die Art einer benutzten Kategorie steht fest. Löschen bietet die App
-- gar nicht an (nur Ausblenden); benutzte Kategorien schützt zusätzlich der Fremdschlüssel aus buchungen.
CREATE TRIGGER kategorien_typ_fest BEFORE UPDATE OF typ ON kategorien
WHEN NEW.typ <> OLD.typ AND EXISTS (SELECT 1 FROM buchungen b WHERE b.kategorie_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'Die Art einer Kategorie mit Buchungen lässt sich nicht ändern.');
END;
