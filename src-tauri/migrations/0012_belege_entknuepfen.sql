-- 0012: Buchungen löschen (ANLEITUNG §2.5, §6.4): angehängte Dateien bleiben, nur ihre Verknüpfung wird gelöst.
-- NIE ÄNDERN, sobald sie ausgeliefert ist (Prüfsumme, siehe 0001).
-- Eine Buchung, die noch nicht festgeschrieben ist und zu der kein ausgestellter Beleg gehört, lässt sich löschen
-- (src-tauri/src/buchungen.rs → loeschen). Die Zeilen in `belege` und die Dateien in der Ablage bleiben (GoBD-
-- Aufbewahrung); vor dem Löschen setzt der Command `belege.buchung_id` auf NULL (Fremdschlüssel) und protokolliert das.
-- Bisher verbot belege_unveraenderlich (0005) jede Änderung außer dem Verlängern der Frist. Neu erlaubt ist GENAU
-- buchung_id von einem Wert auf NULL; NULL ⇒ Wert und Wert ⇒ anderer Wert bleiben verboten, alles andere wie bisher.
-- Zusätzlich: Belege einer festgeschriebenen Buchung bleiben verknüpft (die Buchung kann ohnehin nicht gelöscht werden,
-- Trigger aus 0004).
DROP TRIGGER belege_unveraenderlich;

CREATE TRIGGER belege_unveraenderlich BEFORE UPDATE ON belege
WHEN NOT (
  NEW.id IS OLD.id
  AND (NEW.buchung_id IS OLD.buchung_id OR (OLD.buchung_id IS NOT NULL AND NEW.buchung_id IS NULL))
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
  SELECT RAISE(ABORT, 'Belege werden nie geändert (GoBD). Nur die Aufbewahrungsfrist kann verlängert und die Verknüpfung zu einer gelöschten Buchung gelöst werden.');
END;

CREATE TRIGGER belege_entknuepfen_festgeschrieben BEFORE UPDATE OF buchung_id ON belege
WHEN OLD.buchung_id IS NOT NULL AND NEW.buchung_id IS NULL
  AND EXISTS (
    SELECT 1 FROM buchungen b
     WHERE b.id = OLD.buchung_id
       AND (b.festgeschrieben <> 0 OR b.zahlungsdatum <= (SELECT max(bis_datum) FROM festschreibungen))
  )
BEGIN
  SELECT RAISE(ABORT, 'Die Buchung liegt im festgeschriebenen Zeitraum, ihre Belege bleiben verknüpft (GoBD).');
END;
