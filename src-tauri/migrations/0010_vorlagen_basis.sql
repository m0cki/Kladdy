-- 0010: Vorlagen-Galerie (ANLEITUNG §7.0). NIE ÄNDERN, sobald sie ausgeliefert ist (Prüfsumme, siehe 0001).
-- Je Belegart gibt es jetzt mehrere mitgelieferte Designs im Code (src/lib/vorlagen/standard.ts: 'klassisch', bei der
-- Quittung auch 'formular'). Die Tabelle `vorlagen` hält wie bisher nur eigene Kopien, ab jetzt je (Art, Design) eine;
-- `basis` = Schlüssel des Designs, von dem die Kopie stammt. Alle vorhandenen Kopien stammen vom bisher einzigen
-- Design ⇒ 'klassisch'. `ist_standard` gilt je Zeile („diese Kopie gilt statt des Designs“); welches Design neue Belege
-- nehmen, steht in der Einstellung 'vorlagen_design' (src/lib/queries/vorlagen.ts). Ausgestellte Belege sind nicht
-- betroffen: Ihre Bausteine stehen eingefroren im snapshot_json.
ALTER TABLE vorlagen ADD COLUMN basis TEXT NOT NULL DEFAULT 'klassisch';
