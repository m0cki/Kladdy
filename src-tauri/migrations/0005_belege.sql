-- 0005: Belege ablegen (Phase 1): Indizes für „Belege einer Buchung“ und die Dublettenprüfung per SHA-256;
-- GoBD-Schutz der Belegzeilen. NIE ÄNDERN, sobald sie ausgeliefert ist (Prüfsumme, siehe 0001).

CREATE INDEX belege_buchung_id ON belege (buchung_id);
CREATE INDEX belege_sha256 ON belege (sha256);

-- Belege werden unverändert aufbewahrt (ANLEITUNG §2.5): Zeilen nie löschen, nie ändern. Einzige Ausnahme ist die
-- Aufbewahrungsfrist, und auch die nur nach hinten (z. B. wenn sich das Zahlungsdatum der Buchung ins Folgejahr
-- verschiebt, src-tauri/src/belege.rs). IS vergleicht NULL-sicher; coalesce(…, 0): eine NULL-Frist zählt als Kürzung.
CREATE TRIGGER belege_nie_loeschen BEFORE DELETE ON belege
BEGIN
  SELECT RAISE(ABORT, 'Belege werden nie gelöscht (GoBD).');
END;

CREATE TRIGGER belege_unveraenderlich BEFORE UPDATE ON belege
WHEN NOT (
  NEW.id IS OLD.id
  AND NEW.buchung_id IS OLD.buchung_id
  AND NEW.rechnung_id IS OLD.rechnung_id
  AND NEW.pfad IS OLD.pfad
  AND NEW.originalname IS OLD.originalname
  AND NEW.mime IS OLD.mime
  AND NEW.sha256 IS OLD.sha256
  AND NEW.groesse IS OLD.groesse
  AND NEW.art IS OLD.art
  AND NEW.erstellt_am IS OLD.erstellt_am
  AND coalesce(NEW.aufbewahren_bis >= OLD.aufbewahren_bis, 0)
)
BEGIN
  SELECT RAISE(ABORT, 'Belege werden nie geändert (GoBD). Nur die Aufbewahrungsfrist kann verlängert werden.');
END;
