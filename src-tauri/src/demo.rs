//! Demo-Daten (ANLEITUNG §10 Phase 1 Teil 6, §6.10 Einstellungen › Daten). NUR in Debug-Builds (`npm run tauri dev`):
//! Das Modul wird im Release-Build gar nicht übersetzt (`#[cfg(debug_assertions)] mod demo;` in lib.rs), die
//! installierte App kennt weder die Demo-Datei noch die Commands.
//!
//! - Eigene Datei: Die Demo-Daten liegen in `DEMO_DB_DATEI` neben der Entwicklungsdatenbank (`DB_DATEI`), Belege, die
//!   im Demo-Modus angehängt werden, in `DEMO_BELEGE_ORDNER`. Die echte Datei wird dabei nie beschrieben.
//! - Welche Datei aktiv ist, steht in einer Markierungsdatei (`MARKER`) im App-Verzeichnis und für die laufende App in
//!   `AKTIV`. `datenbank::db_url()` und `belege::ablage_ordner()` richten sich danach; das Frontend lädt nach dem
//!   Umschalten neu und öffnet so die andere Datei.
//! - `demo_laden` legt die Datei selbst an, migriert sie (gleiche Migrationen und Prüfsummen wie das SQL-Plugin, das
//!   seine Migrationen je URL nur einmal pro Programmlauf anwendet) und füllt sie in EINER Transaktion. Erst danach
//!   wird umgeschaltet; schlägt etwas fehl, wird die halbe Datei wieder gelöscht und nichts umgeschaltet.
//! - Die Daten erzeugt das Frontend (src/lib/seed/demo-daten.ts, deterministisch); hier wird alles geprüft (Cent ganz,
//!   Datum gültig, Verweise, Beträge) und eingefügt. Nummern vergibt der echte Nummernkreis (`nummern::vergeben`), sie
//!   müssen mit den mitgeschickten übereinstimmen; danach zählen die Kreise lückenlos weiter.
//! - Kein Protokoll je Zeile (es sind Beispieldaten), nichts festgeschrieben. Rechner-Einstellungen (Tectonic-Pfad)
//!   werden aus der echten Datenbank übernommen.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::migrate::Migrator;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection, SqliteConnection};
use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{Manager, Runtime};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::buchungen::{datum_lesen, in_transaktion};
use crate::datenbank::{self, MIGRATIONEN, MigrationsQuelle, db_fehler, url_zu};
use crate::nummern;

/// Datei der Demo-Datenbank (im selben Ordner wie `DB_DATEI`).
pub const DEMO_DB_DATEI: &str = "kladdy-dev-demo.db";
/// Ablageordner für Belege im Demo-Modus (wie `belege::BELEGE_ORDNER`).
pub const DEMO_BELEGE_ORDNER: &str = "belege-dev-demo";
/// Markierungsdatei im App-Verzeichnis: vorhanden = Demo-Modus an.
pub const MARKER: &str = "demo-aktiv-dev";
/// Einstellungen, die zum Rechner gehören und in die Demo-Datenbank übernommen werden.
const RECHNER_EINSTELLUNGEN: &[&str] = &["tectonic_pfad"];

static AKTIV: AtomicBool = AtomicBool::new(false);

/// Ist der Demo-Modus an (diese App-Sitzung)?
pub fn aktiv() -> bool {
    AKTIV.load(Ordering::SeqCst)
}

fn umschalten(an: bool) {
    AKTIV.store(an, Ordering::SeqCst);
}

/* ---------- Dateien und Markierung ---------- */

/// Datenbankdatei samt Nebendateien von SQLite (WAL, Journal).
fn db_dateien(ordner: &Path) -> Vec<PathBuf> {
    ["", "-wal", "-shm", "-journal"]
        .iter()
        .map(|s| ordner.join(format!("{DEMO_DB_DATEI}{s}")))
        .collect()
}

fn entfernen_falls_da(pfad: &Path) -> Result<(), String> {
    match std::fs::remove_file(pfad) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            Err(format!("{}: {e}", pfad.display()))
        }
        _ => Ok(()),
    }
}

fn db_loeschen(ordner: &Path) -> Result<(), String> {
    db_dateien(ordner)
        .iter()
        .try_for_each(|p| entfernen_falls_da(p))
}

/// Liest die Markierung beim Start. Markierung ohne Demo-Datei (z. B. von Hand gelöscht) ⇒ aus, Markierung weg.
pub fn modus_lesen(ordner: &Path) -> bool {
    let marker = ordner.join(MARKER);
    if !marker.exists() {
        return false;
    }
    if ordner.join(DEMO_DB_DATEI).is_file() {
        return true;
    }
    let _ = std::fs::remove_file(marker);
    false
}

/// Stellt beim Start den Demo-Modus wieder her. Vor `sicherungs_plugin` und `sql_plugin` registrieren.
pub fn modus_plugin<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("demo-modus")
        .setup(|app, _api| {
            let ordner = app.path().app_config_dir()?;
            umschalten(modus_lesen(&ordner));
            Ok(())
        })
        .build()
}

/* ---------- Daten aus dem Frontend (src/lib/seed/demo-daten.ts) ---------- */

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DemoKunde {
    pub nummer: String,
    pub name: String,
    pub zusatz: Option<String>,
    pub strasse: Option<String>,
    pub plz: Option<String>,
    pub ort: Option<String>,
    pub email: Option<String>,
    pub telefon: Option<String>,
    pub notiz: Option<String>,
    pub erstellt_am: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DemoPosition {
    pub beschreibung: String,
    pub menge: f64,
    pub einheit: String,
    pub einzelpreis_cent: i64,
}

/// Quittung, Rechnung oder Angebot (Tabelle rechnungen). Verweise als Index in die Listen von `DemoDaten`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DemoBeleg {
    pub art: String,
    pub nummer: Option<String>,
    pub status: String,
    pub kunde: usize,
    pub datum: String,
    pub faellig_am: Option<String>,
    pub betreff: String,
    pub bezahlt_am: Option<String>,
    pub termin: Option<usize>,
    pub positionen: Vec<DemoPosition>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DemoTermin {
    pub kunde: usize,
    pub datum: String,
    pub von: String,
    pub bis: String,
    pub adresse: Option<String>,
    pub leistung: String,
    pub betrag_geschaetzt_cent: Option<i64>,
    pub notiz: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DemoBuchung {
    pub nummer: String,
    pub typ: String,
    pub zahlungsdatum: String,
    pub betrag_cent: i64,
    pub kategorie_id: i64,
    pub kunde: Option<usize>,
    pub lieferant: Option<String>,
    pub zahlungsart: String,
    pub belegnummer: Option<String>,
    pub beschreibung: String,
    pub beleg: Option<usize>,
    pub storno_von: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DemoDaten {
    pub heute: String,
    pub firma: Map<String, Value>,
    pub kunden: Vec<DemoKunde>,
    pub belege: Vec<DemoBeleg>,
    pub termine: Vec<DemoTermin>,
    pub buchungen: Vec<DemoBuchung>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DemoErgebnis {
    pub kunden: usize,
    pub buchungen: usize,
    pub belege: usize,
    pub termine: usize,
}

/// Summe der Positionen in Cent, je Zeile gerundet (wie `positionenSumme` in demo-daten.ts).
fn summe(pos: &[DemoPosition]) -> i64 {
    pos.iter()
        .map(|p| (p.menge * p.einzelpreis_cent as f64).round() as i64)
        .sum()
}

fn uhrzeit_ok(t: &str) -> bool {
    let b = t.as_bytes();
    b.len() == 5
        && b[2] == b':'
        && t[0..2].parse::<u32>().is_ok_and(|h| h < 24)
        && t[3..5].parse::<u32>().is_ok_and(|m| m < 60)
}

fn jahr(datum: &str) -> i64 {
    datum[0..4].parse().unwrap_or(0)
}

/// Prüft die Daten vollständig, bevor etwas geschrieben wird. Fehlertexte nennen die Stelle (für die Entwicklung).
pub fn pruefen(d: &DemoDaten) -> Result<(), String> {
    datum_lesen("heute", &d.heute)?;
    let heute = d.heute.as_str();
    let datum_bis_heute = |feld: &str, wert: &str| -> Result<(), String> {
        datum_lesen(feld, wert)?;
        if wert > heute {
            return Err(format!("{feld} {wert} liegt in der Zukunft."));
        }
        Ok(())
    };
    let index = |feld: &str, i: usize, n: usize| -> Result<(), String> {
        if i < n {
            Ok(())
        } else {
            Err(format!("{feld}: Verweis {i} zeigt ins Leere."))
        }
    };
    let leer = |t: &str| t.trim().is_empty();
    if d.firma.get("name").and_then(Value::as_str).is_none_or(leer) {
        return Err("Firma ohne Namen.".into());
    }

    for (i, k) in d.kunden.iter().enumerate() {
        if leer(&k.nummer) || leer(&k.name) {
            return Err(format!("Kunde {i}: Nummer und Name fehlen."));
        }
        datum_bis_heute(&format!("Kunde {i} erstellt_am"), &k.erstellt_am)?;
    }

    for (i, t) in d.termine.iter().enumerate() {
        let feld = format!("Termin {i}");
        index(&feld, t.kunde, d.kunden.len())?;
        datum_lesen(&feld, &t.datum)?;
        match t.status.as_str() {
            "geplant" => {}
            "erledigt" | "abgesagt" => datum_bis_heute(&feld, &t.datum)?,
            s => return Err(format!("{feld}: unbekannter Status „{s}“.")),
        }
        if !uhrzeit_ok(&t.von) || !uhrzeit_ok(&t.bis) || t.von >= t.bis || leer(&t.leistung) {
            return Err(format!("{feld}: Uhrzeit oder Leistung ungültig."));
        }
        if t.betrag_geschaetzt_cent.is_some_and(|c| c < 0) {
            return Err(format!("{feld}: negativer Betrag."));
        }
    }

    for (i, r) in d.belege.iter().enumerate() {
        let feld = format!("Beleg {i}");
        index(&feld, r.kunde, d.kunden.len())?;
        if let Some(t) = r.termin {
            index(&feld, t, d.termine.len())?;
        }
        datum_lesen(&feld, &r.datum)?;
        if let Some(f) = &r.faellig_am {
            datum_lesen(&feld, f)?;
        }
        let erlaubt = match r.art.as_str() {
            "quittung" => ["entwurf", "bezahlt"].as_slice(),
            "rechnung" => ["entwurf", "offen", "bezahlt"].as_slice(),
            "angebot" => ["entwurf", "offen"].as_slice(),
            a => return Err(format!("{feld}: unbekannte Art „{a}“.")),
        };
        if !erlaubt.contains(&r.status.as_str()) {
            return Err(format!(
                "{feld}: Status „{}“ passt nicht zu „{}“.",
                r.status, r.art
            ));
        }
        let entwurf = r.status == "entwurf";
        if entwurf == r.nummer.is_some() {
            return Err(format!(
                "{feld}: Entwürfe haben keine Nummer, ausgestellte Belege immer."
            ));
        }
        if !entwurf {
            datum_bis_heute(&feld, &r.datum)?;
        }
        match (&r.bezahlt_am, r.status == "bezahlt") {
            (Some(b), true) => {
                datum_bis_heute(&feld, b)?;
                if b.as_str() < r.datum.as_str() {
                    return Err(format!("{feld}: bezahlt vor dem Belegdatum."));
                }
            }
            (None, false) => {}
            _ => return Err(format!("{feld}: bezahlt_am passt nicht zum Status.")),
        }
        if leer(&r.betreff) || r.positionen.is_empty() {
            return Err(format!("{feld}: Betreff oder Positionen fehlen."));
        }
        for p in &r.positionen {
            if leer(&p.beschreibung)
                || !p.menge.is_finite()
                || p.menge <= 0.0
                || p.einzelpreis_cent < 0
            {
                return Err(format!("{feld}: Position ungültig."));
            }
        }
    }

    let mut bezahlt_gebucht = HashSet::new();
    let mut storniert = HashSet::new();
    for (i, b) in d.buchungen.iter().enumerate() {
        let feld = format!("Buchung {i}");
        datum_bis_heute(&feld, &b.zahlungsdatum)?;
        if leer(&b.nummer) || leer(&b.beschreibung) || b.betrag_cent <= 0 {
            return Err(format!(
                "{feld}: Nummer, Beschreibung oder Betrag ungültig."
            ));
        }
        if !["bar", "bank", "paypal"].contains(&b.zahlungsart.as_str()) {
            return Err(format!(
                "{feld}: unbekannter Zahlungsweg „{}“.",
                b.zahlungsart
            ));
        }
        match b.typ.as_str() {
            "einnahme" => {
                if b.lieferant.is_some() {
                    return Err(format!("{feld}: Einnahmen haben kein Geschäft."));
                }
            }
            "ausgabe" => {
                if b.kunde.is_some() || b.beleg.is_some() {
                    return Err(format!(
                        "{feld}: Ausgaben haben keinen Kunden und keinen Beleg."
                    ));
                }
            }
            t => return Err(format!("{feld}: unbekannter Typ „{t}“.")),
        }
        if let Some(k) = b.kunde {
            index(&feld, k, d.kunden.len())?;
        }
        if let Some(o) = b.storno_von {
            if o >= i {
                return Err(format!(
                    "{feld}: Storno muss nach der Originalbuchung kommen."
                ));
            }
            let orig = &d.buchungen[o];
            if orig.storno_von.is_some() || !storniert.insert(o) {
                return Err(format!(
                    "{feld}: Buchung {o} kann nicht (noch einmal) storniert werden."
                ));
            }
            if (orig.typ.as_str(), orig.betrag_cent, orig.kategorie_id)
                != (b.typ.as_str(), b.betrag_cent, b.kategorie_id)
                || b.zahlungsdatum < orig.zahlungsdatum
                || b.beleg.is_some()
            {
                return Err(format!("{feld}: Storno passt nicht zur Originalbuchung."));
            }
        }
        if let Some(r) = b.beleg {
            index(&feld, r, d.belege.len())?;
            let beleg = &d.belege[r];
            let passt = beleg.status == "bezahlt"
                && beleg.art != "angebot"
                && b.typ == "einnahme"
                && b.betrag_cent == summe(&beleg.positionen)
                && beleg.bezahlt_am.as_deref() == Some(b.zahlungsdatum.as_str())
                && b.kunde == Some(beleg.kunde)
                && b.belegnummer == beleg.nummer;
            if !passt || !bezahlt_gebucht.insert(r) {
                return Err(format!("{feld}: Zahlung passt nicht zu Beleg {r}."));
            }
        }
    }
    if let Some(r) = (0..d.belege.len())
        .find(|r| d.belege[*r].status == "bezahlt" && !bezahlt_gebucht.contains(r))
    {
        return Err(format!("Beleg {r} ist bezahlt, aber ohne Buchung."));
    }
    Ok(())
}

/* ---------- Einfügen ---------- */

/// Zeitstempel für erstellt_am/geaendert_am: vergangene Tage am Morgen, heute und künftige Termine „jetzt“.
fn stempel(datum: &str, heute: &str, jetzt: &str) -> String {
    if datum < heute {
        format!("{datum}T09:00:00Z")
    } else {
        jetzt.to_string()
    }
}

async fn nummer_vergeben(
    conn: &mut SqliteConnection,
    kreis: &str,
    jahr: i64,
    erwartet: &str,
) -> Result<(), String> {
    let nummer = nummern::vergeben(conn, kreis, jahr).await?;
    if nummer != erwartet {
        return Err(format!(
            "Nummernkreis „{kreis}“ vergibt {nummer}, erwartet war {erwartet}."
        ));
    }
    Ok(())
}

/// Füllt eine frisch migrierte, leere Datenbank in EINER Transaktion. `einstellungen`: (schluessel, JSON-Text).
pub async fn fuellen(
    conn: &mut SqliteConnection,
    d: &DemoDaten,
    einstellungen: &[(String, String)],
    jetzt: &str,
) -> Result<DemoErgebnis, String> {
    pruefen(d)?;
    let heute = d.heute.as_str();
    let jahr_heute = jahr(heute);
    in_transaktion(conn, async |tx| {
        let vorhanden: i64 = sqlx::query_scalar(
            "SELECT (SELECT count(*) FROM kunden) + (SELECT count(*) FROM buchungen)
                  + (SELECT count(*) FROM rechnungen) + (SELECT count(*) FROM termine)",
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(db_fehler)?;
        if vorhanden > 0 {
            return Err("Die Datenbank ist nicht leer, Demo-Daten nur in eine frische Datei.".into());
        }

        let mut kunden_ids = Vec::with_capacity(d.kunden.len());
        for k in &d.kunden {
            nummer_vergeben(tx, "kunde", jahr_heute, &k.nummer).await?;
            let id = sqlx::query(
                "INSERT INTO kunden (nummer, name, zusatz, strasse, plz, ort, email, telefon, notiz, erstellt_am)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&k.nummer)
            .bind(&k.name)
            .bind(&k.zusatz)
            .bind(&k.strasse)
            .bind(&k.plz)
            .bind(&k.ort)
            .bind(&k.email)
            .bind(&k.telefon)
            .bind(&k.notiz)
            .bind(stempel(&k.erstellt_am, heute, jetzt))
            .execute(&mut *tx)
            .await
            .map_err(db_fehler)?
            .last_insert_rowid();
            kunden_ids.push(id);
        }

        // Erledigt ohne Beleg = bewusst „Ohne Beleg abschließen“ (z. B. Nachbesserung)
        let mit_beleg: HashSet<usize> = d.belege.iter().filter_map(|r| r.termin).collect();
        let mut termin_ids = Vec::with_capacity(d.termine.len());
        for (i, t) in d.termine.iter().enumerate() {
            let ohne_beleg = t.status == "erledigt" && !mit_beleg.contains(&i);
            let zeit = stempel(&t.datum, heute, jetzt);
            let id = sqlx::query(
                "INSERT INTO termine (kunde_id, datum, von, bis, adresse, leistung, betrag_geschaetzt_cent, notiz,
                   status, ohne_beleg, erstellt_am, geaendert_am)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(kunden_ids[t.kunde])
            .bind(&t.datum)
            .bind(&t.von)
            .bind(&t.bis)
            .bind(&t.adresse)
            .bind(&t.leistung)
            .bind(t.betrag_geschaetzt_cent)
            .bind(&t.notiz)
            .bind(&t.status)
            .bind(i64::from(ohne_beleg))
            .bind(&zeit)
            .bind(&zeit)
            .execute(&mut *tx)
            .await
            .map_err(db_fehler)?
            .last_insert_rowid();
            termin_ids.push(id);
        }

        let mut beleg_ids = Vec::with_capacity(d.belege.len());
        for r in &d.belege {
            // Ausgestellt: Nummer aus dem Kreis und Kundendaten als Schnappschuss (wie beim Finalisieren)
            let (name, adresse, kundennummer) = match &r.nummer {
                Some(nr) => {
                    nummer_vergeben(tx, &r.art, jahr(&r.datum), nr).await?;
                    let k = &d.kunden[r.kunde];
                    let adresse = match (&k.strasse, &k.plz, &k.ort) {
                        (Some(s), Some(p), Some(o)) => Some(format!("{s}\n{p} {o}")),
                        _ => None,
                    };
                    (Some(k.name.clone()), adresse, Some(k.nummer.clone()))
                }
                None => (None, None, None),
            };
            let erstellt = stempel(&r.datum, heute, jetzt);
            let geaendert = stempel(r.bezahlt_am.as_deref().unwrap_or(&r.datum), heute, jetzt);
            let id = sqlx::query(
                "INSERT INTO rechnungen (art, nummer, status, kunde_id, kunde_name, kunde_adresse, kunde_nummer, datum,
                   faellig_am, betreff, summe_cent, termin_id, bezahlt_am, erstellt_am, geaendert_am)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&r.art)
            .bind(&r.nummer)
            .bind(&r.status)
            .bind(kunden_ids[r.kunde])
            .bind(name)
            .bind(adresse)
            .bind(kundennummer)
            .bind(&r.datum)
            .bind(&r.faellig_am)
            .bind(&r.betreff)
            .bind(summe(&r.positionen))
            .bind(r.termin.map(|t| termin_ids[t]))
            .bind(&r.bezahlt_am)
            .bind(erstellt)
            .bind(geaendert)
            .execute(&mut *tx)
            .await
            .map_err(db_fehler)?
            .last_insert_rowid();
            for (pos, p) in r.positionen.iter().enumerate() {
                sqlx::query(
                    "INSERT INTO rechnungspositionen (rechnung_id, pos, beschreibung, menge, einheit, einzelpreis_cent,
                       kategorie_id)
                     VALUES (?, ?, ?, ?, ?, ?, 1)",
                )
                .bind(id)
                .bind(pos as i64 + 1)
                .bind(&p.beschreibung)
                .bind(p.menge)
                .bind(&p.einheit)
                .bind(p.einzelpreis_cent)
                .execute(&mut *tx)
                .await
                .map_err(db_fehler)?;
            }
            beleg_ids.push(id);
        }

        let mut buchung_ids: Vec<i64> = Vec::with_capacity(d.buchungen.len());
        for b in &d.buchungen {
            let typ: Option<String> = sqlx::query_scalar("SELECT typ FROM kategorien WHERE id = ?")
                .bind(b.kategorie_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db_fehler)?;
            if typ.as_deref() != Some(b.typ.as_str()) {
                return Err(format!("Buchung {}: Kategorie passt nicht.", b.nummer));
            }
            nummer_vergeben(tx, "buchung", jahr(&b.zahlungsdatum), &b.nummer).await?;
            let belegdatum = b.beleg.map_or(b.zahlungsdatum.as_str(), |r| d.belege[r].datum.as_str());
            let zeit = stempel(&b.zahlungsdatum, heute, jetzt);
            let id = sqlx::query(
                "INSERT INTO buchungen (nummer, typ, zahlungsdatum, belegdatum, betrag_cent, kategorie_id, kunde_id,
                   lieferant, art, zahlungsart, belegnummer, beschreibung, rechnung_id, storno_von_id, erstellt_am,
                   geaendert_am)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'zahlung', ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&b.nummer)
            .bind(&b.typ)
            .bind(&b.zahlungsdatum)
            .bind(belegdatum)
            .bind(b.betrag_cent)
            .bind(b.kategorie_id)
            .bind(b.kunde.map(|k| kunden_ids[k]))
            .bind(&b.lieferant)
            .bind(&b.zahlungsart)
            .bind(&b.belegnummer)
            .bind(&b.beschreibung)
            .bind(b.beleg.map(|r| beleg_ids[r]))
            .bind(b.storno_von.map(|o| buchung_ids[o]))
            .bind(&zeit)
            .bind(&zeit)
            .execute(&mut *tx)
            .await
            .map_err(db_fehler)?
            .last_insert_rowid();
            buchung_ids.push(id);
        }

        let mut werte = vec![("firma".to_string(), Value::Object(d.firma.clone()).to_string())];
        werte.extend(einstellungen.iter().cloned());
        for (schluessel, wert) in werte {
            sqlx::query("INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?)")
                .bind(schluessel)
                .bind(wert)
                .execute(&mut *tx)
                .await
                .map_err(db_fehler)?;
        }

        // Steuer-Kennwerte für Vorjahr und laufendes Jahr, falls die Migrationen sie (noch) nicht mitbringen:
        // Werte des nächstgelegenen vorhandenen Jahres (nur für die Demo, echte Werte pflegt der Nutzer).
        for j in [jahr_heute - 1, jahr_heute] {
            sqlx::query(
                "INSERT INTO steuer_parameter (jahr, schluessel, wert)
                 SELECT ?, schluessel, wert FROM steuer_parameter
                 WHERE jahr = (SELECT jahr FROM steuer_parameter ORDER BY abs(jahr - ?), jahr DESC LIMIT 1)
                   AND NOT EXISTS (SELECT 1 FROM steuer_parameter WHERE jahr = ?)",
            )
            .bind(j)
            .bind(j)
            .bind(j)
            .execute(&mut *tx)
            .await
            .map_err(db_fehler)?;
        }

        Ok(DemoErgebnis {
            kunden: d.kunden.len(),
            buchungen: d.buchungen.len(),
            belege: d.belege.len(),
            termine: d.termine.len(),
        })
    })
    .await
}

/// Legt die Demo-Datenbank in `ordner` neu an (alte Dateien weg), migriert und füllt sie und setzt die Markierung.
/// Fehler ⇒ Dateien wieder weg, keine Markierung. Berührt nur `DEMO_DB_DATEI`, nie die echte Datenbank.
pub async fn anlegen_in_ordner(
    ordner: &Path,
    d: &DemoDaten,
    einstellungen: &[(String, String)],
    jetzt: &str,
) -> Result<DemoErgebnis, String> {
    pruefen(d)?;
    db_loeschen(ordner)?;
    std::fs::create_dir_all(ordner).map_err(|e| format!("{}: {e}", ordner.display()))?;
    let ergebnis: Result<DemoErgebnis, String> = async {
        let mut c = SqliteConnectOptions::new()
            .filename(ordner.join(DEMO_DB_DATEI))
            .create_if_missing(true)
            .connect()
            .await
            .map_err(db_fehler)?;
        let gefuellt: Result<DemoErgebnis, String> = async {
            let migrator = Migrator::new(MigrationsQuelle(MIGRATIONEN.iter().collect()))
                .await
                .map_err(|e| format!("Migrationen: {e}"))?;
            migrator
                .run_direct(&mut c)
                .await
                .map_err(|e| format!("Migrationen: {e}"))?;
            fuellen(&mut c, d, einstellungen, jetzt).await
        }
        .await;
        let _ = c.close().await;
        let zahlen = gefuellt?;
        std::fs::write(ordner.join(MARKER), "Demo-Daten aktiv (nur Entwicklung)\n")
            .map_err(|e| format!("Markierung: {e}"))?;
        Ok(zahlen)
    }
    .await;
    if ergebnis.is_err() {
        let _ = db_loeschen(ordner);
    }
    ergebnis
}

/// Entfernt Markierung, Demo-Datenbank und Demo-Belege. Ohne Demo-Daten passiert nichts (kein Fehler).
pub fn entfernen_in_ordner(ordner: &Path, daten_ordner: &Path) -> Result<(), String> {
    entfernen_falls_da(&ordner.join(MARKER))?;
    db_loeschen(ordner)?;
    let belege = daten_ordner.join(DEMO_BELEGE_ORDNER);
    match std::fs::remove_dir_all(&belege) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            Err(format!("{}: {e}", belege.display()))
        }
        _ => Ok(()),
    }
}

/* ---------- Commands (nur Debug-Build registriert) ---------- */

/// Schließt einen offenen Pool der Demo-Datei und nimmt ihn aus dem SQL-Plugin, bevor die Datei gelöscht wird.
async fn pool_schliessen(instanzen: &DbInstances) {
    let alt = instanzen.0.write().await.remove(&url_zu(DEMO_DB_DATEI));
    if let Some(DbPool::Sqlite(pool)) = alt {
        pool.close().await;
    }
}

/// Rechner-Einstellungen aus der echten Datenbank (falls sie schon geöffnet ist), roh als JSON-Text.
async fn rechner_einstellungen(instanzen: &DbInstances) -> Vec<(String, String)> {
    let Ok(pool) = datenbank::pool(instanzen).await else {
        return Vec::new();
    };
    let mut werte = Vec::new();
    for schluessel in RECHNER_EINSTELLUNGEN {
        let wert: Option<String> =
            sqlx::query_scalar("SELECT wert FROM einstellungen WHERE schluessel = ?")
                .bind(schluessel)
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten();
        if let Some(w) = wert {
            werte.push((schluessel.to_string(), w));
        }
    }
    werte
}

fn app_ordner<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(PathBuf, PathBuf), String> {
    let p = app.path();
    match (p.app_config_dir(), p.app_data_dir()) {
        (Ok(c), Ok(d)) => Ok((c, d)),
        _ => Err("App-Verzeichnis nicht gefunden.".into()),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DemoStatus {
    pub aktiv: bool,
    pub datei: &'static str,
}

/// Frontend: `invoke('demo_status')`.
#[tauri::command]
pub fn demo_status() -> DemoStatus {
    DemoStatus {
        aktiv: aktiv(),
        datei: DEMO_DB_DATEI,
    }
}

/// Frontend: `invoke('demo_laden', { daten })`, danach `window.location.reload()`.
#[tauri::command]
pub async fn demo_laden(
    app: tauri::AppHandle,
    instanzen: tauri::State<'_, DbInstances>,
    daten: DemoDaten,
) -> Result<DemoErgebnis, String> {
    if aktiv() {
        return Err("Die Demo-Daten sind schon geladen.".into());
    }
    let (ordner, daten_ordner) = app_ordner(&app)?;
    let einstellungen = rechner_einstellungen(&instanzen).await;
    pool_schliessen(&instanzen).await;
    entfernen_in_ordner(&ordner, &daten_ordner)?;
    let zahlen =
        anlegen_in_ordner(&ordner, &daten, &einstellungen, &datenbank::zeitstempel()).await?;
    umschalten(true);
    Ok(zahlen)
}

/// Frontend: `invoke('demo_entfernen')`, danach `window.location.reload()` (öffnet wieder die echte Datenbank).
#[tauri::command]
pub async fn demo_entfernen(
    app: tauri::AppHandle,
    instanzen: tauri::State<'_, DbInstances>,
) -> Result<(), String> {
    let (ordner, daten_ordner) = app_ordner(&app)?;
    umschalten(false);
    pool_schliessen(&instanzen).await;
    entfernen_in_ordner(&ordner, &daten_ordner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::belege::BELEGE_ORDNER;
    use crate::datenbank::DB_DATEI;
    use crate::datenbank::testhilfe::test_db;

    const JETZT: &str = "2026-10-17T10:00:00Z";

    /// nummer, kunde_name, kunde_adresse, summe_cent
    type Schnappschuss = (Option<String>, Option<String>, Option<String>, i64);
    type Aenderung = Box<dyn Fn(&mut DemoDaten)>;

    fn testordner(name: &str) -> PathBuf {
        let p =
            std::env::temp_dir().join(format!("kladdy-test-{}-demo-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn kunde(nummer: &str, name: &str) -> DemoKunde {
        DemoKunde {
            nummer: nummer.into(),
            name: name.into(),
            zusatz: None,
            strasse: Some("Lindenallee 3".into()),
            plz: Some("12345".into()),
            ort: Some("Musterstadt".into()),
            email: None,
            telefon: None,
            notiz: None,
            erstellt_am: "2025-12-30".into(),
        }
    }

    fn pos(preis: i64, menge: f64) -> Vec<DemoPosition> {
        vec![DemoPosition {
            beschreibung: "Heckenschnitt".into(),
            menge,
            einheit: "Std.".into(),
            einzelpreis_cent: preis,
        }]
    }

    fn buchung(nummer: &str, typ: &str, datum: &str, betrag: i64) -> DemoBuchung {
        let einnahme = typ == "einnahme";
        DemoBuchung {
            nummer: nummer.into(),
            typ: typ.into(),
            zahlungsdatum: datum.into(),
            betrag_cent: betrag,
            kategorie_id: if einnahme { 1 } else { 3 },
            kunde: None,
            lieferant: (!einnahme).then(|| "Aral Tankstelle".into()),
            zahlungsart: "bank".into(),
            belegnummer: None,
            beschreibung: "Tanken".into(),
            beleg: None,
            storno_von: None,
        }
    }

    /// Kleiner, vollständiger Datensatz über den Jahreswechsel: Quittung bezahlt (2025), Rechnung offen und ein
    /// vorbereiteter Entwurf zu einem künftigen Termin (2026), drei Buchungen, eine davon storniert.
    fn beispiel() -> DemoDaten {
        let mut firma = Map::new();
        firma.insert(
            "name".into(),
            Value::from("Mustermann Haus- & Gartenservice"),
        );
        let quittung = DemoBeleg {
            art: "quittung".into(),
            nummer: Some("QU-2025-001".into()),
            status: "bezahlt".into(),
            kunde: 0,
            datum: "2025-12-30".into(),
            faellig_am: None,
            betreff: "Heckenschnitt".into(),
            bezahlt_am: Some("2025-12-30".into()),
            termin: Some(0),
            positionen: pos(3800, 2.5),
        };
        let rechnung = DemoBeleg {
            art: "rechnung".into(),
            nummer: Some("RE-2026-001".into()),
            status: "offen".into(),
            kunde: 1,
            datum: "2026-10-10".into(),
            faellig_am: Some("2026-10-24".into()),
            betreff: "Grünanlagenpflege".into(),
            bezahlt_am: None,
            termin: None,
            positionen: pos(3800, 12.0),
        };
        let entwurf = DemoBeleg {
            art: "quittung".into(),
            nummer: None,
            status: "entwurf".into(),
            kunde: 1,
            datum: "2026-10-20".into(),
            faellig_am: None,
            betreff: "Laub entfernen".into(),
            bezahlt_am: None,
            termin: Some(1),
            positionen: pos(9000, 1.0),
        };
        let termin = |kunde, datum: &str, status: &str| DemoTermin {
            kunde,
            datum: datum.into(),
            von: "10:00".into(),
            bis: "12:00".into(),
            adresse: None,
            leistung: "Heckenschnitt".into(),
            betrag_geschaetzt_cent: Some(9500),
            notiz: None,
            status: status.into(),
        };
        let mut einnahme = buchung("2025-0001", "einnahme", "2025-12-30", 9500);
        einnahme.kunde = Some(0);
        einnahme.beleg = Some(0);
        einnahme.belegnummer = Some("QU-2025-001".into());
        einnahme.beschreibung = "Heckenschnitt".into();
        let mut storno = buchung("2026-0002", "ausgabe", "2026-01-07", 6123);
        storno.storno_von = Some(1);
        storno.belegnummer = Some("2026-0001".into());
        storno.beschreibung = "Storno von 2026-0001: Tanken".into();
        DemoDaten {
            heute: "2026-10-17".into(),
            firma,
            kunden: vec![
                kunde("K-0001", "Anna Schmidt"),
                kunde("K-0002", "Hausverwaltung Kaiser"),
            ],
            belege: vec![quittung, rechnung, entwurf],
            termine: vec![
                termin(0, "2025-12-30", "erledigt"),
                termin(1, "2026-10-20", "geplant"),
                termin(0, "2026-03-02", "erledigt"),
            ],
            buchungen: vec![
                einnahme,
                buchung("2026-0001", "ausgabe", "2026-01-05", 6123),
                storno,
            ],
        }
    }

    async fn zahl(c: &mut SqliteConnection, sql: &str) -> i64 {
        sqlx::query_scalar(sql).fetch_one(&mut *c).await.unwrap()
    }

    #[test]
    fn eigene_dateien_nur_fuer_die_entwicklung() {
        assert_ne!(DEMO_DB_DATEI, DB_DATEI);
        assert_ne!(DEMO_BELEGE_ORDNER, BELEGE_ORDNER);
        assert!(
            DEMO_DB_DATEI.contains("-dev-")
                && DEMO_BELEGE_ORDNER.contains("-dev-")
                && MARKER.ends_with("-dev")
        );
        assert_ne!(url_zu(DEMO_DB_DATEI), url_zu(DB_DATEI));
        // ohne Markierung bleibt die echte Datei aktiv
        assert!(!aktiv());
        assert_eq!(datenbank::db_url(), url_zu(DB_DATEI));
    }

    #[test]
    fn markierung_schaltet_nur_mit_demo_datei() {
        let ordner = testordner("marker");
        assert!(!modus_lesen(&ordner));
        std::fs::write(ordner.join(MARKER), "x").unwrap();
        // Markierung ohne Datei: aus und aufgeräumt
        assert!(!modus_lesen(&ordner));
        assert!(!ordner.join(MARKER).exists());
        std::fs::write(ordner.join(MARKER), "x").unwrap();
        std::fs::write(ordner.join(DEMO_DB_DATEI), "").unwrap();
        assert!(modus_lesen(&ordner));
        let _ = std::fs::remove_dir_all(&ordner);
    }

    #[test]
    fn anlegen_fuellt_und_entfernen_raeumt_auf() {
        let ordner = testordner("anlegen");
        let daten_ordner = ordner.join("daten");
        // echte Datenbank daneben: bleibt Byte für Byte unberührt
        std::fs::write(ordner.join(DB_DATEI), b"echt").unwrap();
        std::fs::create_dir_all(daten_ordner.join(DEMO_BELEGE_ORDNER).join("2026")).unwrap();
        std::fs::write(
            daten_ordner
                .join(DEMO_BELEGE_ORDNER)
                .join("2026")
                .join("a.pdf"),
            b"%PDF",
        )
        .unwrap();
        std::fs::create_dir_all(daten_ordner.join(BELEGE_ORDNER)).unwrap();

        let einstellungen = vec![("tectonic_pfad".to_string(), "\"/opt/tectonic\"".to_string())];
        let zahlen = tauri::async_runtime::block_on(anlegen_in_ordner(
            &ordner,
            &beispiel(),
            &einstellungen,
            JETZT,
        ))
        .unwrap();
        assert_eq!(
            zahlen,
            DemoErgebnis {
                kunden: 2,
                buchungen: 3,
                belege: 3,
                termine: 3
            }
        );
        assert!(ordner.join(MARKER).exists());
        assert!(modus_lesen(&ordner));

        tauri::async_runtime::block_on(async {
            let mut c = SqliteConnectOptions::new()
                .filename(ordner.join(DEMO_DB_DATEI))
                .connect()
                .await
                .unwrap();
            // Nummernkreise zählen lückenlos weiter
            let kreise: Vec<(String, i64, i64)> =
                sqlx::query_as("SELECT id, jahr, naechste FROM nummernkreise WHERE id IN ('buchung','kunde','quittung','rechnung') ORDER BY id")
                    .fetch_all(&mut c)
                    .await
                    .unwrap();
            assert_eq!(
                kreise,
                vec![
                    ("buchung".into(), 2026, 3),
                    ("kunde".into(), 0, 3),
                    ("quittung".into(), 2025, 2),
                    ("rechnung".into(), 2026, 2),
                ]
            );
            // Schnappschuss nur bei ausgestellten Belegen; Entwurf ohne Nummer am Termin
            let snap: Vec<Schnappschuss> = sqlx::query_as(
                "SELECT nummer, kunde_name, kunde_adresse, summe_cent FROM rechnungen ORDER BY id",
            )
            .fetch_all(&mut c)
            .await
            .unwrap();
            assert_eq!(
                snap[0],
                (
                    Some("QU-2025-001".into()),
                    Some("Anna Schmidt".into()),
                    Some("Lindenallee 3\n12345 Musterstadt".into()),
                    9500
                )
            );
            assert_eq!(snap[2], (None, None, None, 9000));
            assert_eq!(
                zahl(
                    &mut c,
                    "SELECT count(*) FROM rechnungen WHERE termin_id IS NOT NULL"
                )
                .await,
                2
            );
            assert_eq!(
                zahl(&mut c, "SELECT count(*) FROM rechnungspositionen").await,
                3
            );
            // Zahlung hängt am Beleg, Storno an der Originalbuchung
            assert_eq!(zahl(&mut c, "SELECT count(*) FROM buchungen WHERE rechnung_id = 1 AND kunde_id = 1 AND belegdatum = '2025-12-30'").await, 1);
            assert_eq!(
                zahl(
                    &mut c,
                    "SELECT storno_von_id FROM buchungen WHERE nummer = '2026-0002'"
                )
                .await,
                2
            );
            // erledigt ohne Beleg ⇒ ohne_beleg
            let ohne: Vec<i64> = sqlx::query_scalar("SELECT ohne_beleg FROM termine ORDER BY id")
                .fetch_all(&mut c)
                .await
                .unwrap();
            assert_eq!(ohne, vec![0, 0, 1]);
            // Einstellungen: Firma und Tectonic-Pfad; kein Protokoll, Kennwerte fürs Vorjahr
            let werte: Vec<(String, String)> =
                sqlx::query_as("SELECT schluessel, wert FROM einstellungen ORDER BY schluessel")
                    .fetch_all(&mut c)
                    .await
                    .unwrap();
            assert_eq!(werte[0].0, "firma");
            assert!(werte[0].1.contains("Mustermann"));
            assert_eq!(
                werte[1],
                ("tectonic_pfad".into(), "\"/opt/tectonic\"".into())
            );
            assert_eq!(zahl(&mut c, "SELECT count(*) FROM protokoll").await, 0);
            assert_eq!(
                zahl(
                    &mut c,
                    "SELECT count(*) FROM steuer_parameter WHERE jahr = 2025"
                )
                .await,
                zahl(
                    &mut c,
                    "SELECT count(*) FROM steuer_parameter WHERE jahr = 2026"
                )
                .await
            );
            assert!(
                sqlx::query("PRAGMA foreign_key_check")
                    .fetch_all(&mut c)
                    .await
                    .unwrap()
                    .is_empty()
            );
            c.close().await.unwrap();
        });
        assert_eq!(std::fs::read(ordner.join(DB_DATEI)).unwrap(), b"echt");

        entfernen_in_ordner(&ordner, &daten_ordner).unwrap();
        assert!(!ordner.join(MARKER).exists());
        assert!(db_dateien(&ordner).iter().all(|p| !p.exists()));
        assert!(!daten_ordner.join(DEMO_BELEGE_ORDNER).exists());
        assert!(daten_ordner.join(BELEGE_ORDNER).exists());
        assert_eq!(std::fs::read(ordner.join(DB_DATEI)).unwrap(), b"echt");
        // zweimal entfernen ist kein Fehler
        entfernen_in_ordner(&ordner, &daten_ordner).unwrap();
        let _ = std::fs::remove_dir_all(&ordner);
    }

    #[test]
    fn fehler_hinterlassen_keine_demo_datei() {
        let ordner = testordner("fehler");
        let mut d = beispiel();
        d.buchungen[2].nummer = "2026-0007".into(); // passt nicht zum Nummernkreis
        let f =
            tauri::async_runtime::block_on(anlegen_in_ordner(&ordner, &d, &[], JETZT)).unwrap_err();
        assert!(f.contains("2026-0002"), "{f}");
        assert!(!ordner.join(DEMO_DB_DATEI).exists());
        assert!(!ordner.join(MARKER).exists());
        let _ = std::fs::remove_dir_all(&ordner);
    }

    #[test]
    fn fuellen_nur_leer_und_alles_oder_nichts() {
        tauri::async_runtime::block_on(async {
            // Fehler mitten im Einfügen (letzte Buchung): nichts bleibt, auch die Nummernkreise nicht
            let mut c = test_db().await;
            let mut d = beispiel();
            d.buchungen[2].nummer = "2026-0099".into();
            assert!(fuellen(&mut c, &d, &[], JETZT).await.is_err());
            assert_eq!(zahl(&mut c, "SELECT count(*) FROM kunden").await, 0);
            assert_eq!(zahl(&mut c, "SELECT count(*) FROM buchungen").await, 0);
            assert_eq!(
                zahl(&mut c, "SELECT sum(naechste) FROM nummernkreise").await,
                6
            );

            fuellen(&mut c, &beispiel(), &[], JETZT).await.unwrap();
            let f = fuellen(&mut c, &beispiel(), &[], JETZT).await.unwrap_err();
            assert!(f.contains("nicht leer"), "{f}");
            assert_eq!(zahl(&mut c, "SELECT count(*) FROM kunden").await, 2);
        });
    }

    #[test]
    fn pruefen_lehnt_ungueltiges_ab() {
        assert_eq!(pruefen(&beispiel()), Ok(()));
        let faelle: Vec<(&str, Aenderung)> = vec![
            (
                "Zukunft",
                Box::new(|d| d.buchungen[1].zahlungsdatum = "2026-10-18".into()),
            ),
            (
                "gültiges Datum",
                Box::new(|d| d.kunden[0].erstellt_am = "2026-02-30".into()),
            ),
            ("Verweis", Box::new(|d| d.buchungen[0].kunde = Some(9))),
            ("Beleg 0", Box::new(|d| d.buchungen[0].betrag_cent = 9600)),
            ("Status", Box::new(|d| d.belege[0].status = "offen".into())),
            (
                "Nummer",
                Box::new(|d| d.belege[2].nummer = Some("QU-2026-001".into())),
            ),
            (
                "ohne Buchung",
                Box::new(|d| {
                    d.buchungen.remove(0);
                    d.buchungen[1].storno_von = Some(0);
                }),
            ),
            ("Storno", Box::new(|d| d.buchungen[2].betrag_cent = 1)),
            ("Uhrzeit", Box::new(|d| d.termine[0].bis = "09:00".into())),
            (
                "Zukunft",
                Box::new(|d| d.termine[1].status = "erledigt".into()),
            ),
            (
                "Position",
                Box::new(|d| d.belege[1].positionen[0].menge = f64::NAN),
            ),
        ];
        for (erwartet, aendern) in faelle {
            let mut d = beispiel();
            aendern(&mut d);
            let f = pruefen(&d).unwrap_err();
            assert!(f.contains(erwartet), "{erwartet}: {f}");
        }
    }

    #[test]
    fn nur_ganze_cent_und_bekannte_felder() {
        let gut = r#"{"heute":"2026-10-17","firma":{"name":"X"},"kunden":[],"belege":[],"termine":[],
            "buchungen":[{"nummer":"2026-0001","typ":"ausgabe","zahlungsdatum":"2026-10-01","betrag_cent":1250,
            "kategorie_id":2,"kunde":null,"lieferant":"OBI","zahlungsart":"bar","belegnummer":null,
            "beschreibung":"Schrauben","beleg":null,"storno_von":null}]}"#;
        let d: DemoDaten = serde_json::from_str(gut).unwrap();
        assert_eq!(pruefen(&d), Ok(()));
        assert!(serde_json::from_str::<DemoDaten>(&gut.replace("1250", "12.5")).is_err());
        assert!(
            serde_json::from_str::<DemoDaten>(
                &gut.replace("\"beleg\":null", "\"beleg\":null,\"x\":1")
            )
            .is_err()
        );
    }
}
