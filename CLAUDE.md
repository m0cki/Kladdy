# Kladdy – Projektregeln

- Spezifikation: ANLEITUNG.md (immer die passende Sektion lesen, bevor du etwas baust).
- Visuelle/funktionale Referenz: referenz/prototyp (HTML-Prototyp). Neue Ansichten so aussehen und verhalten lassen wie dort.
- Sprache der UI: Deutsch. Datums-/Zahlenformat de-DE. Echtes Minuszeichen (−) in Anzeigen.
- Geld IMMER als Integer-Cent speichern und rechnen. Nie Floats für Beträge.
- Datum als 'YYYY-MM-DD'. EÜR-Zuordnung über zahlungsdatum (Zufluss/Abfluss).
- Design: ausschließlich Tokens/Komponenten aus ANLEITUNG §9 (CSS-Variablen). Keine Inline-Farben, kein Tailwind.
  Jede Aktion genau einmal: Erfassen NUR über „+ Erfassen“ im Kopf von Ein- & Ausgänge
  (⌘N von überall) bzw. Datei-Drop – kein Erfassen-Knopf in der Kopfzeile; andere Stellen öffnen höchstens
  dieselbe Schublade vorbelegt. Statistik (KPI-Kacheln, Summen, Diagramme) NUR in der Auswertung, nie in Listen.
  Menü: genau fünf Punkte (Ein- & Ausgänge · Termine · Rechnungen & Quittungen · Kunden · Auswertung). Keine Konten/Kontostände,
  nur Zahlungsweg (bar/bank/paypal). Logo = Startseite; Einstellungen nur über ⚙.
- Diagramme: eigene SVG-Komponenten nach §9.6. Plus/Minus nie nur über Farbe.
- Formeln: eigener Parser, niemals eval/new Function.
- LaTeX: Nutzerwerte immer über lib/latex/escape.ts. Tectonic nur mit --untrusted aufrufen.
- Kunden immer per ID verknüpfen, nie per Name. Kundenfelder: Vorschläge „Name · K-0012“, bei gleichem Namen nachfragen.
- GoBD: Festgeschriebene/finalisierte Daten nie ändern oder löschen → Storno. Jede Änderung ins Protokoll.
  Nummern atomar und erst beim Ausstellen vergeben (Entwürfe, auch für Termine vorbereitete, haben keine Nummer), nie
  wiederverwenden. Kundendaten beim Ausstellen als Schnappschuss in den Beleg. Belege nie überschreiben.
- Quittung = Zahlungsbestätigung, immer bezahlt (Standard bei Einnahmen); Rechnung = Zahlungsaufforderung, offen oder bezahlt.
- Mehrschritt-Vorgänge (finalisieren, stornieren, festschreiben, backup) als Rust-Command mit Transaktion.
- Datenbank nur in appDataDir, nie in iCloud Drive. Schema nur per nummerierter Migration ändern (Updates!), vorher Backup.
- Updates: Update-Schlüssel nie ins Repository; Version in tauri.conf.json und package.json gleich halten.
- Datenschutz: kein Tracking, keine Telemetrie, keine externen Schriften. Netz nur für Update-Prüfung und Tectonic-Pakete.
  Kunden mit Buchungen/Belegen erst nach Fristablauf anonymisieren (§2.10), nie vorher löschen.
- Tests: Vitest für lib/*, cargo test für Rust. Vor jedem Commit: npm run typecheck && npm test.
- Nach jeder Phase: App mit `npm run tauri dev` starten und Prüfpunkte nennen.
