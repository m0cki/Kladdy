//! Kunden (ANLEITUNG §6.8, §2.10): Anlegen, Ändern (Stammdaten und Notiz) und Löschen als Rust-Commands.
//! Jeder Vorgang läuft in EINER Transaktion zusammen mit seinem GoBD-Protokolleintrag (jede Änderung, auch an der Notiz).
//!
//! - Die Kundennummer (Kreis 'kunde', z. B. K-0012) wird beim Anlegen vergeben und nie geändert oder wiederverwendet.
//!   Dieselbe Funktion (`anlegen_in`) legt auch neue Kunden aus der Erfassen-Schublade an (buchungen.rs).
//! - Ausgestellte Belege behalten ihren Schnappschuss (rechnungen.kunde_name …); Änderungen hier gelten nur für Neues.
//! - Löschen nur, solange nichts am Kunden hängt (Buchungen, Belege, Termine, Fahrten); geprüft in der Transaktion.
//!   Sonst bleiben die Daten bis zum Ablauf der Aufbewahrungsfrist und werden dann anonymisiert (Phase 5).
//! - `link_oeffnen`: Karten-, Telefon- und Mail-Links der Kunden-Schublade mit der Standard-App des Macs öffnen.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::SqliteConnection;
use tauri_plugin_sql::DbInstances;

use crate::buchungen::{
    datum_lesen, in_transaktion, protokollieren, text_oder_nichts, verbindung, zeile_json,
};
use crate::datenbank::{self, db_fehler};
use crate::nummern;

/// Eingabe aus der Kunden-Schublade (src/lib/kunden.ts → KundeDaten). Feldnamen exakt so (snake_case).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KundeEingabe {
    pub name: String,
    pub zusatz: Option<String>,
    pub strasse: Option<String>,
    pub plz: Option<String>,
    pub ort: Option<String>,
    pub email: Option<String>,
    pub telefon: Option<String>,
    pub notiz: Option<String>,
}

/// Geprüfte Stammdaten: getrimmt, leere Felder als None (NULL).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stammdaten {
    pub name: String,
    pub zusatz: Option<String>,
    pub strasse: Option<String>,
    pub plz: Option<String>,
    pub ort: Option<String>,
    pub email: Option<String>,
    pub telefon: Option<String>,
    pub notiz: Option<String>,
}

impl Stammdaten {
    /// Nur ein Name (neuer Kunde aus der Erfassen-Schublade). `name` ist dort schon getrimmt und nicht leer.
    pub fn nur_name(name: &str) -> Self {
        Stammdaten {
            name: name.to_string(),
            zusatz: None,
            strasse: None,
            plz: None,
            ort: None,
            email: None,
            telefon: None,
            notiz: None,
        }
    }

    /// Spalte ⇒ Wert, in fester Reihenfolge (UPDATE und Protokoll). Spaltennamen sind feste Texte, nie Eingaben.
    fn felder(&self) -> Vec<(&'static str, Value)> {
        let t = |v: &Option<String>| v.clone().map_or(Value::Null, Value::String);
        vec![
            ("name", Value::String(self.name.clone())),
            ("zusatz", t(&self.zusatz)),
            ("strasse", t(&self.strasse)),
            ("plz", t(&self.plz)),
            ("ort", t(&self.ort)),
            ("email", t(&self.email)),
            ("telefon", t(&self.telefon)),
            ("notiz", t(&self.notiz)),
        ]
    }
}

/// Prüfen und bereinigen: Name Pflicht, alles getrimmt, leer ⇒ NULL.
pub fn pruefen(d: &KundeEingabe) -> Result<Stammdaten, String> {
    let name = d.name.trim();
    if name.is_empty() {
        return Err("Bitte einen Namen eingeben.".into());
    }
    Ok(Stammdaten {
        name: name.to_string(),
        zusatz: text_oder_nichts(&d.zusatz),
        strasse: text_oder_nichts(&d.strasse),
        plz: text_oder_nichts(&d.plz),
        ort: text_oder_nichts(&d.ort),
        email: text_oder_nichts(&d.email),
        telefon: text_oder_nichts(&d.telefon),
        notiz: text_oder_nichts(&d.notiz),
    })
}

/// Antwort an das Frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct KundeErgebnis {
    pub id: i64,
    /// feste Kundennummer, z. B. K-0012
    pub nummer: String,
    /// false, wenn sich nichts geändert hat (dann wurde weder geschrieben noch protokolliert)
    pub geaendert: bool,
}

/* ---------- Anlegen ---------- */

/// Legt einen Kunden an (Nummer aus dem Kreis 'kunde') und protokolliert ihn. Läuft in der Transaktion des Aufrufers
/// (auch `buchung_anlegen` mit neuem Kunden). Gibt (id, nummer) zurück.
pub(crate) async fn anlegen_in(
    conn: &mut SqliteConnection,
    s: &Stammdaten,
    jahr_heute: i64,
    zeitpunkt: &str,
) -> Result<(i64, String), String> {
    let nummer = nummern::vergeben(conn, "kunde", jahr_heute).await?;
    let id = sqlx::query(
        "INSERT INTO kunden (nummer, name, zusatz, strasse, plz, ort, email, telefon, notiz, erstellt_am)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&nummer)
    .bind(&s.name)
    .bind(&s.zusatz)
    .bind(&s.strasse)
    .bind(&s.plz)
    .bind(&s.ort)
    .bind(&s.email)
    .bind(&s.telefon)
    .bind(&s.notiz)
    .bind(zeitpunkt)
    .execute(&mut *conn)
    .await
    .map_err(db_fehler)?
    .last_insert_rowid();
    let neu = zeile_json(conn, "kunden", id).await?;
    protokollieren(conn, zeitpunkt, "kunden", id, "neu", None, neu.as_ref()).await?;
    Ok((id, nummer))
}

/// Kunde von Hand anlegen („+ Kunde anlegen“). `heute` = lokales Datum (Jahr, falls das Muster eins enthält).
pub async fn anlegen(
    conn: &mut SqliteConnection,
    daten: &KundeEingabe,
    heute: &str,
    zeitpunkt: &str,
) -> Result<KundeErgebnis, String> {
    let s = pruefen(daten)?;
    let (jahr_heute, _, _) = datum_lesen("Heutiges Datum", heute)?;
    in_transaktion(conn, async |tx| {
        let (id, nummer) = anlegen_in(tx, &s, jahr_heute, zeitpunkt).await?;
        Ok(KundeErgebnis {
            id,
            nummer,
            geaendert: true,
        })
    })
    .await
}

/* ---------- Ändern ---------- */

fn feld_text(m: &Map<String, Value>, k: &str) -> String {
    m.get(k)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// Übernimmt `neu` (Spalte ⇒ Wert) und protokolliert nur die Felder, die sich wirklich geändert haben
/// (wie buchungen::aendern und aenderungen() in protokoll.ts). Ohne Änderung: nichts schreiben, nichts protokollieren.
async fn felder_aendern(
    tx: &mut SqliteConnection,
    id: i64,
    neu: &[(&'static str, Value)],
    zeitpunkt: &str,
) -> Result<KundeErgebnis, String> {
    let Some(alt) = zeile_json(tx, "kunden", id).await? else {
        return Err("Den Kunden gibt es nicht (mehr).".into());
    };
    let nummer = feld_text(&alt, "nummer");
    let mut diff_alt = Map::new();
    let mut diff_neu = Map::new();
    let mut spalten = Vec::new();
    for (k, v) in neu {
        let vorher = alt.get(*k).cloned().unwrap_or(Value::Null);
        if &vorher != v {
            diff_alt.insert((*k).into(), vorher);
            diff_neu.insert((*k).into(), v.clone());
            spalten.push((*k, v.as_str().map(String::from)));
        }
    }
    if spalten.is_empty() {
        return Ok(KundeErgebnis {
            id,
            nummer,
            geaendert: false,
        });
    }
    let sql = format!(
        "UPDATE kunden SET {} WHERE id = ?",
        spalten
            .iter()
            .map(|(k, _)| format!("{k} = ?"))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let mut q = sqlx::query(&sql);
    for (_, v) in spalten {
        q = q.bind(v);
    }
    q.bind(id).execute(&mut *tx).await.map_err(db_fehler)?;
    protokollieren(
        tx,
        zeitpunkt,
        "kunden",
        id,
        "geaendert",
        Some(&diff_alt),
        Some(&diff_neu),
    )
    .await?;
    Ok(KundeErgebnis {
        id,
        nummer,
        geaendert: true,
    })
}

/// Stammdaten und Notiz ändern. Die Nummer bleibt; ausgestellte Belege behalten ihren Schnappschuss.
pub async fn aendern(
    conn: &mut SqliteConnection,
    id: i64,
    daten: &KundeEingabe,
    zeitpunkt: &str,
) -> Result<KundeErgebnis, String> {
    let s = pruefen(daten)?;
    let neu = s.felder();
    in_transaktion(conn, async |tx| {
        felder_aendern(tx, id, &neu, zeitpunkt).await
    })
    .await
}

/// Nur die Notiz (speichert automatisch aus der Schublade, ohne halb bearbeitete Stammdaten mitzunehmen).
pub async fn notiz(
    conn: &mut SqliteConnection,
    id: i64,
    notiz: &Option<String>,
    zeitpunkt: &str,
) -> Result<KundeErgebnis, String> {
    let wert = text_oder_nichts(notiz).map_or(Value::Null, Value::String);
    let neu = [("notiz", wert)];
    in_transaktion(conn, async |tx| {
        felder_aendern(tx, id, &neu, zeitpunkt).await
    })
    .await
}

/* ---------- Löschen ---------- */

/// Was am Kunden hängt (Anzahl Zeilen je Tabelle). Leer ⇒ löschbar.
async fn bezuege(tx: &mut SqliteConnection, id: i64) -> Result<Vec<&'static str>, String> {
    let (b, r, t, f): (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM buchungen WHERE kunde_id = ?),
                (SELECT count(*) FROM rechnungen WHERE kunde_id = ?),
                (SELECT count(*) FROM termine WHERE kunde_id = ?),
                (SELECT count(*) FROM fahrten WHERE kunde_id = ?)",
    )
    .bind(id)
    .bind(id)
    .bind(id)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_fehler)?;
    Ok([
        (b, "Buchungen"),
        (r, "Belege"),
        (t, "Termine"),
        (f, "Fahrten"),
    ]
    .into_iter()
    .filter(|(n, _)| *n > 0)
    .map(|(_, was)| was)
    .collect())
}

/// Löscht einen Kunden, an dem nichts hängt (§2.10), und protokolliert die ganze Zeile ('geloescht').
/// Die Nummer wird nie wieder vergeben (der Kreis läuft nur vorwärts).
pub async fn loeschen(
    conn: &mut SqliteConnection,
    id: i64,
    zeitpunkt: &str,
) -> Result<KundeErgebnis, String> {
    in_transaktion(conn, async |tx| {
        let Some(alt) = zeile_json(tx, "kunden", id).await? else {
            return Err("Den Kunden gibt es nicht (mehr).".into());
        };
        let nummer = feld_text(&alt, "nummer");
        let haengt = bezuege(tx, id).await?;
        if !haengt.is_empty() {
            return Err(format!(
                "{nummer} kann nicht gelöscht werden: Es hängen noch {} daran. Die Daten bleiben bis zum Ende der Aufbewahrungsfrist.",
                und_liste(&haengt)
            ));
        }
        sqlx::query("DELETE FROM kunden WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_fehler)?;
        protokollieren(tx, zeitpunkt, "kunden", id, "geloescht", Some(&alt), None).await?;
        Ok(KundeErgebnis {
            id,
            nummer,
            geaendert: true,
        })
    })
    .await
}

/// „Buchungen“, „Buchungen und Termine“, „Buchungen, Belege und Termine“.
fn und_liste(teile: &[&str]) -> String {
    match teile {
        [] => String::new(),
        [eins] => (*eins).to_string(),
        [vorne @ .., letztes] => format!("{} und {letztes}", vorne.join(", ")),
    }
}

/* ---------- Links (Karte, Telefon, E-Mail) ---------- */

/// Nur diese Links öffnet die App nach außen: Apple Karten mit Suchanfrage, `tel:` mit Ziffern, `mailto:` mit Adresse.
/// Keine Leer- oder Steuerzeichen; so kann über die Kundendaten nichts anderes gestartet werden.
pub fn link_erlaubt(url: &str) -> bool {
    if url.len() > 2048 || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    if let Some(rest) = url.strip_prefix("https://maps.apple.com/?q=") {
        return !rest.is_empty();
    }
    if let Some(rest) = url.strip_prefix("tel:") {
        let ziffern = rest.trim_start_matches('+');
        return ziffern.len() >= 3 && ziffern.chars().all(|c| c.is_ascii_digit());
    }
    if let Some(rest) = url.strip_prefix("mailto:") {
        let mut teile = rest.splitn(2, '@');
        let (lokal, domain) = (teile.next().unwrap_or(""), teile.next().unwrap_or(""));
        return !lokal.is_empty()
            && domain.contains('.')
            && !domain.contains('@')
            && !rest.contains(['?', '&', '<', '>', '"', '\\']);
    }
    false
}

/* ---------- Tauri-Commands (dünne Hüllen) ---------- */

/// Frontend: `invoke('kunde_anlegen', { daten, heute })`.
#[tauri::command]
pub async fn kunde_anlegen(
    instanzen: tauri::State<'_, DbInstances>,
    daten: KundeEingabe,
    heute: String,
) -> Result<KundeErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    anlegen(&mut c, &daten, &heute, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('kunde_aendern', { id, daten })`.
#[tauri::command]
pub async fn kunde_aendern(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    daten: KundeEingabe,
) -> Result<KundeErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    aendern(&mut c, id, &daten, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('kunde_notiz', { id, notiz })` (null oder leer ⇒ keine Notiz).
#[tauri::command]
pub async fn kunde_notiz(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    notiz: Option<String>,
) -> Result<KundeErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    self::notiz(&mut c, id, &notiz, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('kunde_loeschen', { id })`.
#[tauri::command]
pub async fn kunde_loeschen(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
) -> Result<KundeErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    loeschen(&mut c, id, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('link_oeffnen', { url })` – Karten-, Telefon- oder Mail-Link mit der Standard-App öffnen.
#[tauri::command]
pub fn link_oeffnen(url: String) -> Result<(), String> {
    if !link_erlaubt(&url) {
        return Err("Dieser Link kann nicht geöffnet werden.".into());
    }
    let status = std::process::Command::new("/usr/bin/open")
        .arg(&url)
        .status()
        .map_err(|e| format!("Der Link konnte nicht geöffnet werden: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Der Link konnte nicht geöffnet werden.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buchungen::{self, BuchungEingabe};
    use crate::datenbank::testhilfe::test_db;
    use std::path::Path;

    const JETZT: &str = "2026-10-15T08:00:00Z";
    const SPAETER: &str = "2026-10-16T09:30:00Z";

    fn lauf<F: std::future::Future<Output = ()>>(f: F) {
        tauri::async_runtime::block_on(f);
    }

    fn anna() -> KundeEingabe {
        KundeEingabe {
            name: "  Anna Schmidt ".into(),
            zusatz: Some("".into()),
            strasse: Some(" Gartenweg 3 ".into()),
            plz: Some("12345".into()),
            ort: Some("Musterstadt".into()),
            email: None,
            telefon: Some("  ".into()),
            notiz: Some("Hund im Garten, Tor schließen".into()),
        }
    }

    type KundeZeile = (
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
    );

    async fn kunde(c: &mut SqliteConnection, id: i64) -> Option<KundeZeile> {
        sqlx::query_as(
            "SELECT nummer, name, zusatz, strasse, plz, ort, email, telefon, notiz, erstellt_am FROM kunden WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(c)
        .await
        .unwrap()
    }

    async fn protokoll(
        c: &mut SqliteConnection,
    ) -> Vec<(String, i64, String, Option<String>, Option<String>)> {
        sqlx::query_as(
            "SELECT tabelle, datensatz_id, aktion, alt_json, neu_json FROM protokoll ORDER BY id",
        )
        .fetch_all(c)
        .await
        .unwrap()
    }

    fn json(t: &Option<String>) -> Value {
        serde_json::from_str(t.as_deref().unwrap()).unwrap()
    }

    async fn naechste_kundennummer(c: &mut SqliteConnection) -> i64 {
        sqlx::query_scalar("SELECT naechste FROM nummernkreise WHERE id = 'kunde'")
            .fetch_one(c)
            .await
            .unwrap()
    }

    #[test]
    fn anlegen_bereinigt_und_protokolliert() {
        lauf(async {
            let mut c = test_db().await;
            let e = anlegen(&mut c, &anna(), "2026-10-15", JETZT).await.unwrap();
            assert_eq!(
                e,
                KundeErgebnis {
                    id: e.id,
                    nummer: "K-0001".into(),
                    geaendert: true
                }
            );
            assert_eq!(
                kunde(&mut c, e.id).await.unwrap(),
                (
                    "K-0001".into(),
                    "Anna Schmidt".into(),
                    None,
                    Some("Gartenweg 3".into()),
                    Some("12345".into()),
                    Some("Musterstadt".into()),
                    None,
                    None,
                    Some("Hund im Garten, Tor schließen".into()),
                    JETZT.into()
                )
            );
            let p = protokoll(&mut c).await;
            assert_eq!(p.len(), 1);
            assert_eq!(
                (p[0].0.as_str(), p[0].1, p[0].2.as_str()),
                ("kunden", e.id, "neu")
            );
            let neu = json(&p[0].4);
            assert_eq!(neu["nummer"], "K-0001");
            assert_eq!(neu["telefon"], Value::Null);
            assert_eq!(neu["land"], "DE");

            // Zweiter Kunde mit gleichem Namen: eigene Nummer, kein Problem
            let e2 = anlegen(&mut c, &anna(), "2026-10-15", JETZT).await.unwrap();
            assert_eq!(e2.nummer, "K-0002");

            // ohne Namen: Fehler, keine Nummer verbraucht, nichts geschrieben
            let leer = KundeEingabe {
                name: "   ".into(),
                ..anna()
            };
            assert_eq!(
                anlegen(&mut c, &leer, "2026-10-15", JETZT)
                    .await
                    .unwrap_err(),
                "Bitte einen Namen eingeben."
            );
            assert!(
                anlegen(&mut c, &anna(), "gestern", JETZT)
                    .await
                    .unwrap_err()
                    .contains("kein gültiges Datum")
            );
            assert_eq!(naechste_kundennummer(&mut c).await, 3);
            assert_eq!(protokoll(&mut c).await.len(), 2);
        });
    }

    #[test]
    fn aendern_protokolliert_nur_geaenderte_felder() {
        lauf(async {
            let mut c = test_db().await;
            let id = anlegen(&mut c, &anna(), "2026-10-15", JETZT)
                .await
                .unwrap()
                .id;
            let neu = KundeEingabe {
                ort: Some(" Neustadt ".into()),
                telefon: Some("0171 2345678".into()),
                strasse: Some("Gartenweg 3".into()),
                ..anna()
            };
            let e = aendern(&mut c, id, &neu, SPAETER).await.unwrap();
            assert_eq!(
                e,
                KundeErgebnis {
                    id,
                    nummer: "K-0001".into(),
                    geaendert: true
                }
            );
            let k = kunde(&mut c, id).await.unwrap();
            assert_eq!(k.5.as_deref(), Some("Neustadt"));
            assert_eq!(k.7.as_deref(), Some("0171 2345678"));
            assert_eq!(k.9, JETZT, "erstellt_am bleibt");
            let p = protokoll(&mut c).await;
            assert_eq!(p.len(), 2);
            assert_eq!(
                (p[1].0.as_str(), p[1].1, p[1].2.as_str()),
                ("kunden", id, "geaendert")
            );
            assert_eq!(
                json(&p[1].3),
                serde_json::json!({ "ort": "Musterstadt", "telefon": null })
            );
            assert_eq!(
                json(&p[1].4),
                serde_json::json!({ "ort": "Neustadt", "telefon": "0171 2345678" })
            );

            // nichts geändert: kein Protokoll
            let e = aendern(&mut c, id, &neu, SPAETER).await.unwrap();
            assert!(!e.geaendert);
            assert_eq!(protokoll(&mut c).await.len(), 2);

            // Name leeren geht nicht, unbekannter Kunde auch nicht
            let ohne_name = KundeEingabe {
                name: "".into(),
                ..neu.clone()
            };
            assert!(aendern(&mut c, id, &ohne_name, SPAETER).await.is_err());
            assert_eq!(
                aendern(&mut c, 999, &neu, SPAETER).await.unwrap_err(),
                "Den Kunden gibt es nicht (mehr)."
            );
            assert_eq!(protokoll(&mut c).await.len(), 2);
        });
    }

    #[test]
    fn notiz_speichern_und_leeren() {
        lauf(async {
            let mut c = test_db().await;
            let id = anlegen(
                &mut c,
                &KundeEingabe {
                    name: "Bob".into(),
                    ..Default::default()
                },
                "2026-10-15",
                JETZT,
            )
            .await
            .unwrap()
            .id;
            let e = notiz(
                &mut c,
                id,
                &Some(" Schlüssel beim Nachbarn \n".into()),
                SPAETER,
            )
            .await
            .unwrap();
            assert!(e.geaendert);
            assert_eq!(
                kunde(&mut c, id).await.unwrap().8.as_deref(),
                Some("Schlüssel beim Nachbarn")
            );
            // gleiche Notiz: nichts
            assert!(
                !notiz(&mut c, id, &Some("Schlüssel beim Nachbarn".into()), SPAETER)
                    .await
                    .unwrap()
                    .geaendert
            );
            // leeren ⇒ NULL
            assert!(
                notiz(&mut c, id, &Some("  ".into()), SPAETER)
                    .await
                    .unwrap()
                    .geaendert
            );
            assert_eq!(kunde(&mut c, id).await.unwrap().8, None);
            let p = protokoll(&mut c).await;
            assert_eq!(p.len(), 3);
            assert_eq!(json(&p[1].3), serde_json::json!({ "notiz": null }));
            assert_eq!(
                json(&p[1].4),
                serde_json::json!({ "notiz": "Schlüssel beim Nachbarn" })
            );
            assert_eq!(json(&p[2].4), serde_json::json!({ "notiz": null }));
            // Name und Adresse bleiben unberührt
            assert_eq!(kunde(&mut c, id).await.unwrap().1, "Bob");
        });
    }

    #[test]
    fn loeschen_nur_ohne_bezuege() {
        lauf(async {
            let mut c = test_db().await;
            let frei = anlegen(&mut c, &anna(), "2026-10-15", JETZT).await.unwrap();
            let e = loeschen(&mut c, frei.id, SPAETER).await.unwrap();
            assert_eq!(e.nummer, "K-0001");
            assert!(kunde(&mut c, frei.id).await.is_none());
            let p = protokoll(&mut c).await;
            assert_eq!(
                (p[1].0.as_str(), p[1].1, p[1].2.as_str()),
                ("kunden", frei.id, "geloescht")
            );
            let alt = json(&p[1].3);
            assert_eq!(alt["nummer"], "K-0001");
            assert_eq!(alt["name"], "Anna Schmidt");
            assert!(p[1].4.is_none());
            assert_eq!(
                loeschen(&mut c, frei.id, SPAETER).await.unwrap_err(),
                "Den Kunden gibt es nicht (mehr)."
            );

            // Nummer wird nie wiederverwendet
            let mit_buchung = anlegen(&mut c, &anna(), "2026-10-15", JETZT).await.unwrap();
            assert_eq!(mit_buchung.nummer, "K-0002");
            buchungen::anlegen(
                &mut c,
                Path::new("/kladdy-test-ohne-belegablage"),
                &BuchungEingabe {
                    typ: "einnahme".into(),
                    zahlungsdatum: "2026-10-14".into(),
                    belegdatum: None,
                    betrag_cent: 12_000,
                    privatanteil_prozent: 0,
                    kategorie_id: 1,
                    kunde_id: Some(mit_buchung.id),
                    neuer_kunde: None,
                    lieferant: None,
                    zahlungsart: "bar".into(),
                    belegnummer: None,
                    beschreibung: "Rasen mähen".into(),
                    heute: "2026-10-15".into(),
                    belege: vec![],
                },
                JETZT,
            )
            .await
            .unwrap();
            let f = loeschen(&mut c, mit_buchung.id, SPAETER).await.unwrap_err();
            assert_eq!(
                f,
                "K-0002 kann nicht gelöscht werden: Es hängen noch Buchungen daran. Die Daten bleiben bis zum Ende der Aufbewahrungsfrist."
            );
            assert!(kunde(&mut c, mit_buchung.id).await.is_some());

            // Termine und Fahrten zählen auch
            let mit_termin = anlegen(&mut c, &anna(), "2026-10-15", JETZT).await.unwrap();
            sqlx::query(
                "INSERT INTO termine (kunde_id, datum, leistung, erstellt_am, geaendert_am) VALUES (?, '2026-10-20', 'Hecke', 'x', 'x')",
            )
            .bind(mit_termin.id)
            .execute(&mut c)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO fahrten (datum, ziel, zweck, km, kunde_id) VALUES ('2026-10-20', 'Musterstadt', 'Hecke', 12.5, ?)",
            )
            .bind(mit_termin.id)
            .execute(&mut c)
            .await
            .unwrap();
            let f = loeschen(&mut c, mit_termin.id, SPAETER).await.unwrap_err();
            assert!(f.contains("Termine und Fahrten"), "{f}");
            let anzahl: i64 =
                sqlx::query_scalar("SELECT count(*) FROM protokoll WHERE aktion = 'geloescht'")
                    .fetch_one(&mut c)
                    .await
                    .unwrap();
            assert_eq!(anzahl, 1);
        });
    }

    #[test]
    fn neuer_kunde_aus_der_erfassung_bekommt_die_naechste_nummer() {
        lauf(async {
            let mut c = test_db().await;
            anlegen(&mut c, &anna(), "2026-10-15", JETZT).await.unwrap();
            let id = in_transaktion(&mut c, async |tx| {
                anlegen_in(tx, &Stammdaten::nur_name("Bob"), 2026, JETZT).await
            })
            .await
            .unwrap();
            assert_eq!(id.1, "K-0002");
            let k = kunde(&mut c, id.0).await.unwrap();
            assert_eq!((k.1.as_str(), k.3.clone()), ("Bob", None));
        });
    }

    #[test]
    fn liste_mit_und() {
        assert_eq!(und_liste(&[]), "");
        assert_eq!(und_liste(&["Buchungen"]), "Buchungen");
        assert_eq!(und_liste(&["Buchungen", "Belege"]), "Buchungen und Belege");
        assert_eq!(
            und_liste(&["Buchungen", "Belege", "Termine"]),
            "Buchungen, Belege und Termine"
        );
    }

    #[test]
    fn nur_erlaubte_links() {
        for ok in [
            "https://maps.apple.com/?q=Gartenweg%203%2C%2012345%20Musterstadt",
            "tel:+491712345678",
            "tel:0301234",
            "mailto:anna@example.de",
        ] {
            assert!(link_erlaubt(ok), "{ok}");
        }
        for nein in [
            "",
            "https://maps.apple.com/?q=",
            "https://example.com/?q=x",
            "http://maps.apple.com/?q=x",
            "https://maps.apple.com/?q=a b",
            "file:///etc/passwd",
            "tel:12",
            "tel:0171 234",
            "tel:0171-234",
            "mailto:anna",
            "mailto:@example.de",
            "mailto:anna@example.de?subject=x",
            "mailto:anna@ex@ample.de",
            "mailto:anna@example.de\n",
            "-a /Applications/Calculator.app",
        ] {
            assert!(!link_erlaubt(nein), "{nein}");
        }
    }
}
