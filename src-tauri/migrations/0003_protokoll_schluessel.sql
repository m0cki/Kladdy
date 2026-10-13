-- 0003: Protokoll auch für Stammdaten ohne INTEGER-ID (einstellungen, steuer_parameter, nummernkreise; ANLEITUNG §6.10).
-- NIE ÄNDERN, sobald sie ausgeliefert ist (Prüfsumme, siehe 0001).
-- Für diese Tabellen ist protokoll.datensatz_id = 0 und der Schlüssel steht als Text in `schluessel`,
-- z. B. 'firma' (einstellungen), '2026' (steuer_parameter: Jahr), 'rechnung' (nummernkreise).
-- Bei Tabellen mit INTEGER-ID bleibt `schluessel` NULL.
ALTER TABLE protokoll ADD COLUMN schluessel TEXT;
