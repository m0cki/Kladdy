-- 0002: Standarddaten für eine neue Datenbank (läuft genau einmal, wie jede Migration).
-- NIE ÄNDERN, sobald sie ausgeliefert ist (Prüfsumme, siehe 0001). Spätere Korrekturen als neue Migration.

-- Kategorien: bewusst wenige (ANLEITUNG §2.8). Eine Einnahmeart, drei Kostenarten.
-- Farbe/Icon wie im Prototyp (referenz/prototyp/js/data.js), Icon = lucide-Name. Stichworte kommagetrennt.
INSERT INTO kategorien
  (id, name, typ, euer_bereich, abziehbar_prozent, zaehlt_ku_umsatz, wareneingang, farbe, icon, stichworte, sortierung)
VALUES
  (1, 'Dienstleistungen', 'einnahme', 'Betriebseinnahmen als Kleinunternehmer', 100, 1, 0, '#6366f1', 'wrench',
   'rasen,hecke,garten,montage,reparatur,winterdienst,quittung,rechnung', 1),
  (2, 'Produkte & Material', 'ausgabe', 'Waren, Roh- und Hilfsstoffe', 100, 0, 1, '#f59e0b', 'box',
   'bauhaus,obi,hornbach,toom,gartencenter,erde,mulch,dünger,pflanzen,saatgut,rasensamen,ersatzteil,schrauben,dübel,material,müllsäcke,handschuhe', 2),
  (3, 'Sprit & Fahrzeug', 'ausgabe', 'Kraftfahrzeugkosten', 100, 0, 0, '#0ea5e9', 'fuel',
   'tankstelle,aral,shell,esso,jet,total,diesel,benzin,super,kraftstoff,liter,werkstatt,reifen,kfz,inspektion', 3),
  (4, 'Sonstige Kosten', 'ausgabe', 'Übrige Betriebsausgaben', 100, 0, 0, '#a855f7', 'ellipsis',
   'telekom,vodafone,o2,versicherung,gebühr,porto,werbung,flyer,software,werkzeug,paypal,wertstoffhof', 4);

-- Steuer-Kennwerte 2026 (ANLEITUNG §2.6). Werte als JSON-Zahl im Text, Geld in Cent, Anteile in Prozent.
-- Weitere Jahre legt die App bzw. der Nutzer an (editierbare Tabelle pro Jahr).
INSERT INTO steuer_parameter (jahr, schluessel, wert) VALUES
  (2026, 'ku_grenze_vorjahr_cent',           '2500000'),    -- Kleinunternehmer: Vorjahr 25.000 €
  (2026, 'ku_grenze_laufend_cent',           '10000000'),   -- Kleinunternehmer: laufendes Jahr 100.000 €
  (2026, 'kleinbetragsrechnung_cent',        '25000'),      -- bis 250 € brutto
  (2026, 'gwg_grenze_netto_cent',            '80000'),      -- GWG-Sofortabzug bis 800 € netto
  (2026, 'gewst_freibetrag_cent',            '2450000'),    -- Gewerbesteuer-Freibetrag 24.500 € Gewinn
  (2026, 'bewirtung_abziehbar_prozent',      '70'),         -- Bewirtung 70 % abziehbar
  (2026, 'geschenke_grenze_cent',            '5000'),       -- bis 50 € pro Empfänger und Jahr
  (2026, 'homeoffice_tag_cent',              '600'),        -- 6 € pro Tag
  (2026, 'homeoffice_max_jahr_cent',         '126000'),     -- max. 1.260 € pro Jahr
  (2026, 'km_pauschale_cent',                '30'),         -- 0,30 € pro km (Dienstreise, Privat-Pkw)
  (2026, 'verpflegung_8h_cent',              '1400'),       -- 14 € über 8 Std.
  (2026, 'verpflegung_24h_cent',             '2800'),       -- 28 € bei 24 Std.
  (2026, 'ihk_beitragsfrei_bis_cent',        '520000'),     -- IHK beitragsfrei bis 5.200 € Gewerbeertrag
  (2026, 'buchfuehrungspflicht_umsatz_cent', '80000000'),   -- ab 800.000 € Umsatz …
  (2026, 'buchfuehrungspflicht_gewinn_cent', '8000000');    -- … oder 80.000 € Gewinn

-- Nummernkreise (ANLEITUNG §5, §6). jahr = 0: noch nie benutzt bzw. jahresunabhängig (Kunde).
-- Beim ersten Vergeben in einem neuen Jahr wird jahr gesetzt und naechste auf 1 zurückgestellt (src/lib/numbering.ts).
INSERT INTO nummernkreise (id, muster, jahr, naechste) VALUES
  ('buchung',    '{JJJJ}-{NNNN}',    0, 1),
  ('rechnung',   'RE-{JJJJ}-{NNN}',  0, 1),
  ('quittung',   'QU-{JJJJ}-{NNN}',  0, 1),
  ('angebot',    'AN-{JJJJ}-{NNN}',  0, 1),
  ('eigenbeleg', 'EB-{JJJJ}-{NNN}',  0, 1),
  ('kunde',      'K-{NNNN}',         0, 1);
