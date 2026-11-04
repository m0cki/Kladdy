-- 0011: Mehrere eigene Vorlagen je Art (ANLEITUNG §7.0 „Eigene Vorlagen“). NIE ÄNDERN, sobald sie ausgeliefert ist
-- (Prüfsumme, siehe 0001).
-- Bisher: je (Art, Design) höchstens eine eigene Kopie; `ist_standard` = 1 hieß „gilt statt des Designs“, 0 =
-- abgeschaltet („Zurücksetzen“). Ab jetzt sind eigene Vorlagen eigenständig (Name, `basis` = Design, von dem sie
-- stammen), beliebig viele je Art; die Designs im Code bleiben unverändert wählbar. Welche Vorlage neue Belege nehmen,
-- steht in der Einstellung 'vorlagen_design' als Design-Schlüssel oder 'eigen:<id>' (src/lib/vorlagen/eigene.ts).
-- `ist_standard` hat danach keine Bedeutung mehr (neue Zeilen 0).
-- Damit nichts anders aussieht als vorher:
--   1. `archiviert`: entfernte Vorlagen (nie gelöscht, Belege und Entwürfe verweisen weiter auf sie). Abgeschaltete
--      Kopien waren unsichtbar ⇒ archiviert.
--   2. War für eine Art das aktive Design (fehlt ⇒ 'klassisch') durch eine eingeschaltete Kopie ersetzt, zeigt die
--      Einstellung jetzt auf diese Kopie. Kaputte Einstellungen bleiben, wie sie sind (gelten wie bisher als 'klassisch').
--   3. Entwürfe (nummer IS NULL) zeigten die Kopie ihres Designs (entwurf_json.vorlage_design, fehlt ⇒ 'klassisch'),
--      wenn es eine eingeschaltete gab, sonst das Design: `vorlage_id` wird genau darauf gesetzt (die Maske wählt jetzt
--      über die ID). Ausgestellte Belege bleiben unberührt (Bausteine im snapshot_json, Schutz-Trigger aus 0007).
ALTER TABLE vorlagen ADD COLUMN archiviert INTEGER NOT NULL DEFAULT 0 CHECK (archiviert IN (0, 1));

UPDATE vorlagen SET archiviert = 1 WHERE ist_standard = 0;

-- 2. Einstellung anlegen, wenn sie fehlt und eine klassische Kopie gilt (fehlt ⇒ alle Arten 'klassisch')
INSERT INTO einstellungen (schluessel, wert)
SELECT 'vorlagen_design', '{}'
 WHERE NOT EXISTS (SELECT 1 FROM einstellungen WHERE schluessel = 'vorlagen_design')
   AND EXISTS (SELECT 1 FROM vorlagen WHERE ist_standard = 1 AND archiviert = 0 AND basis = 'klassisch');

UPDATE einstellungen
   SET wert = json_set(wert, '$.rechnung', 'eigen:' || (SELECT v.id FROM vorlagen v
          WHERE v.art = 'rechnung' AND v.ist_standard = 1 AND v.archiviert = 0
            AND v.basis = COALESCE(CASE WHEN json_valid(einstellungen.wert) THEN json_extract(einstellungen.wert, '$.rechnung') END, 'klassisch')
          ORDER BY v.geaendert_am DESC, v.id DESC LIMIT 1))
 WHERE schluessel = 'vorlagen_design'
   AND (CASE WHEN json_valid(wert) THEN json_type(wert) END) = 'object'
   AND (SELECT v.id FROM vorlagen v
          WHERE v.art = 'rechnung' AND v.ist_standard = 1 AND v.archiviert = 0
            AND v.basis = COALESCE(CASE WHEN json_valid(einstellungen.wert) THEN json_extract(einstellungen.wert, '$.rechnung') END, 'klassisch')
          ORDER BY v.geaendert_am DESC, v.id DESC LIMIT 1) IS NOT NULL;

UPDATE einstellungen
   SET wert = json_set(wert, '$.angebot', 'eigen:' || (SELECT v.id FROM vorlagen v
          WHERE v.art = 'angebot' AND v.ist_standard = 1 AND v.archiviert = 0
            AND v.basis = COALESCE(CASE WHEN json_valid(einstellungen.wert) THEN json_extract(einstellungen.wert, '$.angebot') END, 'klassisch')
          ORDER BY v.geaendert_am DESC, v.id DESC LIMIT 1))
 WHERE schluessel = 'vorlagen_design'
   AND (CASE WHEN json_valid(wert) THEN json_type(wert) END) = 'object'
   AND (SELECT v.id FROM vorlagen v
          WHERE v.art = 'angebot' AND v.ist_standard = 1 AND v.archiviert = 0
            AND v.basis = COALESCE(CASE WHEN json_valid(einstellungen.wert) THEN json_extract(einstellungen.wert, '$.angebot') END, 'klassisch')
          ORDER BY v.geaendert_am DESC, v.id DESC LIMIT 1) IS NOT NULL;

UPDATE einstellungen
   SET wert = json_set(wert, '$.quittung', 'eigen:' || (SELECT v.id FROM vorlagen v
          WHERE v.art = 'quittung' AND v.ist_standard = 1 AND v.archiviert = 0
            AND v.basis = COALESCE(CASE WHEN json_valid(einstellungen.wert) THEN json_extract(einstellungen.wert, '$.quittung') END, 'klassisch')
          ORDER BY v.geaendert_am DESC, v.id DESC LIMIT 1))
 WHERE schluessel = 'vorlagen_design'
   AND (CASE WHEN json_valid(wert) THEN json_type(wert) END) = 'object'
   AND (SELECT v.id FROM vorlagen v
          WHERE v.art = 'quittung' AND v.ist_standard = 1 AND v.archiviert = 0
            AND v.basis = COALESCE(CASE WHEN json_valid(einstellungen.wert) THEN json_extract(einstellungen.wert, '$.quittung') END, 'klassisch')
          ORDER BY v.geaendert_am DESC, v.id DESC LIMIT 1) IS NOT NULL;

UPDATE einstellungen
   SET wert = json_set(wert, '$.eigenbeleg', 'eigen:' || (SELECT v.id FROM vorlagen v
          WHERE v.art = 'eigenbeleg' AND v.ist_standard = 1 AND v.archiviert = 0
            AND v.basis = COALESCE(CASE WHEN json_valid(einstellungen.wert) THEN json_extract(einstellungen.wert, '$.eigenbeleg') END, 'klassisch')
          ORDER BY v.geaendert_am DESC, v.id DESC LIMIT 1))
 WHERE schluessel = 'vorlagen_design'
   AND (CASE WHEN json_valid(wert) THEN json_type(wert) END) = 'object'
   AND (SELECT v.id FROM vorlagen v
          WHERE v.art = 'eigenbeleg' AND v.ist_standard = 1 AND v.archiviert = 0
            AND v.basis = COALESCE(CASE WHEN json_valid(einstellungen.wert) THEN json_extract(einstellungen.wert, '$.eigenbeleg') END, 'klassisch')
          ORDER BY v.geaendert_am DESC, v.id DESC LIMIT 1) IS NOT NULL;

-- 3. Entwürfe
UPDATE rechnungen
   SET vorlage_id = (SELECT v.id FROM vorlagen v
                      WHERE v.art = rechnungen.art AND v.ist_standard = 1 AND v.archiviert = 0
                        AND v.basis = COALESCE(CASE WHEN json_valid(rechnungen.entwurf_json) THEN json_extract(rechnungen.entwurf_json, '$.vorlage_design') END, 'klassisch')
                      ORDER BY v.geaendert_am DESC, v.id DESC LIMIT 1)
 WHERE nummer IS NULL;
