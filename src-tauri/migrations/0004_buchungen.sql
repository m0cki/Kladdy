-- 0004: Buchungen (Phase 1): Indizes für Liste, Storno und Kundenverlauf; Schreibschutz im festgeschriebenen Zeitraum.
-- NIE ÄNDERN, sobald sie ausgeliefert ist (Prüfsumme, siehe 0001). Spätere Korrekturen als neue Migration.

CREATE INDEX buchungen_zahlungsdatum ON buchungen (zahlungsdatum);
-- Eindeutig: Eine Buchung wird höchstens einmal storniert (NULL zählt in SQLite nicht als Dublette).
CREATE UNIQUE INDEX buchungen_storno_von_id ON buchungen (storno_von_id);
CREATE INDEX buchungen_kunde_id ON buchungen (kunde_id);
CREATE INDEX kunden_name ON kunden (name);

-- Schreibschutz (ANLEITUNG §5 Regeln): Buchungen mit zahlungsdatum <= festschreibungen.bis_datum sind schreibgeschützt,
-- in der UI, in den Rust-Commands (src-tauri/src/buchungen.rs) und hier als letzte Sicherung.
-- max(bis_datum) ist NULL, solange nichts festgeschrieben ist; ein Vergleich mit NULL ist nie wahr, der Trigger greift dann nicht.
-- Hinweis für das Festschreiben (Phase 6): erst buchungen.festgeschrieben setzen, danach die Zeile in festschreibungen
-- anlegen, sonst blockiert der Trigger das eigene UPDATE.
CREATE TRIGGER buchungen_festgeschrieben_neu BEFORE INSERT ON buchungen
WHEN NEW.zahlungsdatum <= (SELECT max(bis_datum) FROM festschreibungen)
BEGIN
  SELECT RAISE(ABORT, 'Der Zeitraum ist festgeschrieben: In ihm können keine Buchungen mehr angelegt werden.');
END;

CREATE TRIGGER buchungen_festgeschrieben_aendern BEFORE UPDATE ON buchungen
WHEN OLD.zahlungsdatum <= (SELECT max(bis_datum) FROM festschreibungen)
  OR NEW.zahlungsdatum <= (SELECT max(bis_datum) FROM festschreibungen)
BEGIN
  SELECT RAISE(ABORT, 'Die Buchung liegt im festgeschriebenen Zeitraum und kann nicht mehr geändert werden. Korrektur nur per Storno.');
END;

CREATE TRIGGER buchungen_festgeschrieben_loeschen BEFORE DELETE ON buchungen
WHEN OLD.zahlungsdatum <= (SELECT max(bis_datum) FROM festschreibungen)
BEGIN
  SELECT RAISE(ABORT, 'Die Buchung liegt im festgeschriebenen Zeitraum und kann nicht gelöscht werden.');
END;
