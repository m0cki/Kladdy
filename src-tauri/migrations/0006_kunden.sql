-- 0006: Kunden (Phase 1): Indizes für Kundenliste, Verlauf und Löschprüfung; Protokoll-Aktion 'geloescht'.
-- NIE ÄNDERN, sobald sie ausgeliefert ist (Prüfsumme, siehe 0001).

-- Verlauf eines Kunden (§6.8) und „hängt etwas am Kunden?“ (src-tauri/src/kunden.rs). buchungen.kunde_id hat schon 0004.
CREATE INDEX rechnungen_kunde_id ON rechnungen (kunde_id);
CREATE INDEX termine_kunde_id ON termine (kunde_id);
CREATE INDEX fahrten_kunde_id ON fahrten (kunde_id);
-- Zahlung zu einem Beleg (Zahlungsweg im Verlauf, später Rechnung bezahlt/offen)
CREATE INDEX buchungen_rechnung_id ON buchungen (rechnung_id);

-- Protokoll: Kunden ohne Buchungen, Belege, Termine und Fahrten dürfen gelöscht werden (§2.10). Das braucht die Aktion
-- 'geloescht' (alt_json = ganze Zeile). SQLite kann einen CHECK nicht ändern, deshalb wird die Tabelle neu aufgebaut:
-- gleiche Spalten in gleicher Reihenfolge (inkl. schluessel aus 0003), alle Einträge mit ihrer ID übernommen.
-- Auf protokoll verweist kein Fremdschlüssel, Trigger oder Index. Vor der Migration legt die App eine Sicherung an.
CREATE TABLE protokoll_neu (
  id INTEGER PRIMARY KEY, zeitpunkt TEXT NOT NULL, tabelle TEXT NOT NULL, datensatz_id INTEGER NOT NULL,
  aktion TEXT NOT NULL CHECK (aktion IN ('neu','geaendert','storniert','geloescht_entwurf','geloescht')),
  alt_json TEXT, neu_json TEXT, schluessel TEXT
);
INSERT INTO protokoll_neu (id, zeitpunkt, tabelle, datensatz_id, aktion, alt_json, neu_json, schluessel)
  SELECT id, zeitpunkt, tabelle, datensatz_id, aktion, alt_json, neu_json, schluessel FROM protokoll ORDER BY id;
DROP TABLE protokoll;
ALTER TABLE protokoll_neu RENAME TO protokoll;
