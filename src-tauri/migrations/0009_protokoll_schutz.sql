-- 0009: GoBD-Schutz für Protokoll und Festschreibungen. NIE ÄNDERN, sobald sie ausgeliefert ist (Prüfsumme, siehe 0001).
-- Die Trigger aus 0004/0005/0007 schützen Buchungen, Belege und ausgestellte Belege – bisher aber nicht das
-- Änderungsprotokoll selbst und nicht die Festschreibungen, auf denen die Buchungs-Trigger aufbauen
-- (max(bis_datum)). Ein DELETE FROM festschreibungen hätte alle Buchungen eines festgeschriebenen Zeitraums wieder
-- änderbar gemacht. Beide Tabellen werden im Code nur eingefügt, nie geändert oder gelöscht.

-- Festschreibungen sind endgültig (ANLEITUNG §2.5).
CREATE TRIGGER festschreibungen_nie_loeschen BEFORE DELETE ON festschreibungen
BEGIN
  SELECT RAISE(ABORT, 'Festschreibungen werden nie aufgehoben (GoBD).');
END;

CREATE TRIGGER festschreibungen_unveraenderlich BEFORE UPDATE ON festschreibungen
BEGIN
  SELECT RAISE(ABORT, 'Festschreibungen werden nie geändert (GoBD).');
END;

-- Protokollzeilen werden nie gelöscht. Geändert werden dürfen nur alt_json/neu_json, damit die Anonymisierung
-- nach Fristablauf (§2.10, Phase 5) personenbezogene Daten aus alten Einträgen entfernen kann; Zeitpunkt,
-- Tabelle, Datensatz und Aktion bleiben. IS vergleicht NULL-sicher.
CREATE TRIGGER protokoll_nie_loeschen BEFORE DELETE ON protokoll
BEGIN
  SELECT RAISE(ABORT, 'Das Protokoll wird nie gelöscht (GoBD).');
END;

CREATE TRIGGER protokoll_unveraenderlich BEFORE UPDATE ON protokoll
WHEN NOT (
  NEW.id IS OLD.id
  AND NEW.zeitpunkt IS OLD.zeitpunkt
  AND NEW.tabelle IS OLD.tabelle
  AND NEW.datensatz_id IS OLD.datensatz_id
  AND NEW.schluessel IS OLD.schluessel
  AND NEW.aktion IS OLD.aktion
)
BEGIN
  SELECT RAISE(ABORT, 'Protokolleinträge werden nie geändert (GoBD). Nur alt_json/neu_json dürfen anonymisiert werden.');
END;
