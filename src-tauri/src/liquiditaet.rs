//! Liquidität (ANLEITUNG §6.9.2): Planposten und wiederkehrende Kosten anlegen, ändern und löschen als Rust-Commands.
//! Jeder Vorgang läuft in EINER Transaktion zusammen mit seinem Protokolleintrag (wie kunden.rs).
//!
//! - Beides sind Planungsdaten für die Vorschau, keine GoBD-Aufzeichnungen: Löschen ist erlaubt (Protokoll-Aktion
//!   'geloescht' aus Migration 0006, alt_json = ganze Zeile). Wiederkehrende Posten, auf die schon eine Buchung verweist
//!   (buchungen.wiederkehrend_id, ab Phase 7), werden nicht gelöscht, sondern pausiert.
//! - Planposten: datum nach heute, text 1–80 Zeichen, betrag_cent ≠ 0 (negativ = Ausgabe).
//! - Wiederkehrend: rhythmus 'monatlich' | 'vierteljaehrlich' | 'jaehrlich', naechstes_datum = Anker (erster Termin),
//!   aktiv 0/1, vorlage_json Version 1 (dokumentiert in src/lib/liquiditaet.ts → WiederkehrendVorlage):
//!   `{"name": …, "betrag_cent": > 0, "typ": "einnahme"|"ausgabe", "kategorie_id": null|ID, "tag": 1–31}`.
//!   Beim Ändern bleiben unbekannte Felder der alten Vorlage erhalten (Phase 7 darf ergänzen).
//!   Es werden KEINE Buchungen erzeugt – das ist nur die Liste für die Vorschau.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::SqliteConnection;
use tauri_plugin_sql::DbInstances;

use crate::buchungen::{datum_lesen, in_transaktion, protokollieren, verbindung, zeile_json};
use crate::datenbank::{self, db_fehler};

/// Höchstbetrag je Posten (1 Mio. €) – schützt vor Tippfehlern mit vielen Nullen.
const BETRAG_MAX: i64 = 100_000_000;
const TEXT_MAX: usize = 80;
pub const RHYTHMEN: &[&str] = &["monatlich", "vierteljaehrlich", "jaehrlich"];

/// Antwort an das Frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PostenErgebnis {
    pub id: i64,
    /// false, wenn sich nichts geändert hat (dann wurde weder geschrieben noch protokolliert)
    pub geaendert: bool,
}

fn text_pruefen(feld: &str, t: &str) -> Result<String, String> {
    let t = t.trim();
    if t.is_empty() {
        return Err(format!("Bitte {feld} eingeben."));
    }
    if t.chars().count() > TEXT_MAX {
        return Err(format!(
            "{feld} ist zu lang (höchstens {TEXT_MAX} Zeichen)."
        ));
    }
    Ok(t.to_string())
}

fn tage_im_monat(jahr: i64, monat: u32) -> u32 {
    let schalt = (jahr % 4 == 0 && jahr % 100 != 0) || jahr % 400 == 0;
    match monat {
        2 if schalt => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/* ---------- Planposten ---------- */

/// Eingabe aus der Liquidität (src/lib/queries/liquiditaet.ts → PlanpostenDaten).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanpostenEingabe {
    pub datum: String,
    pub text: String,
    /// negativ = Ausgabe
    pub betrag_cent: i64,
}

/// Geprüft: (datum, text, betrag_cent).
pub fn planposten_pruefen(
    d: &PlanpostenEingabe,
    heute: &str,
) -> Result<(String, String, i64), String> {
    datum_lesen("Datum", &d.datum)?;
    datum_lesen("Heutiges Datum", heute)?;
    if d.datum.as_str() <= heute {
        return Err("Planposten liegen in der Zukunft: bitte ein Datum nach heute wählen.".into());
    }
    let text = text_pruefen("eine Beschreibung", &d.text)?;
    if d.betrag_cent == 0 || d.betrag_cent.abs() > BETRAG_MAX {
        return Err("Bitte einen Betrag zwischen 0,01 € und 1.000.000 € eingeben.".into());
    }
    Ok((d.datum.clone(), text, d.betrag_cent))
}

fn planposten_felder(g: &(String, String, i64)) -> Vec<(&'static str, Value)> {
    vec![
        ("datum", Value::from(g.0.clone())),
        ("text", Value::from(g.1.clone())),
        ("betrag_cent", Value::from(g.2)),
    ]
}

pub async fn plan_anlegen(
    conn: &mut SqliteConnection,
    d: &PlanpostenEingabe,
    heute: &str,
    zeitpunkt: &str,
) -> Result<PostenErgebnis, String> {
    let g = planposten_pruefen(d, heute)?;
    in_transaktion(conn, async |tx| {
        let id = sqlx::query("INSERT INTO planposten (datum, text, betrag_cent) VALUES (?, ?, ?)")
            .bind(&g.0)
            .bind(&g.1)
            .bind(g.2)
            .execute(&mut *tx)
            .await
            .map_err(db_fehler)?
            .last_insert_rowid();
        neu_protokollieren(tx, "planposten", id, zeitpunkt).await
    })
    .await
}

pub async fn plan_aendern(
    conn: &mut SqliteConnection,
    id: i64,
    d: &PlanpostenEingabe,
    heute: &str,
    zeitpunkt: &str,
) -> Result<PostenErgebnis, String> {
    let neu = planposten_felder(&planposten_pruefen(d, heute)?);
    in_transaktion(conn, async |tx| {
        felder_aendern(tx, "planposten", id, &neu, zeitpunkt, PLAN_FEHLT).await
    })
    .await
}

const PLAN_FEHLT: &str = "Den Planposten gibt es nicht (mehr).";
const WK_FEHLT: &str = "Den wiederkehrenden Posten gibt es nicht (mehr).";

pub async fn plan_loeschen(
    conn: &mut SqliteConnection,
    id: i64,
    zeitpunkt: &str,
) -> Result<PostenErgebnis, String> {
    in_transaktion(conn, async |tx| {
        loeschen_in(tx, "planposten", id, zeitpunkt, PLAN_FEHLT).await
    })
    .await
}

/* ---------- Wiederkehrende Kosten ---------- */

/// Eingabe aus der Liquidität (src/lib/queries/liquiditaet.ts → WiederkehrendDaten).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WiederkehrendEingabe {
    pub name: String,
    /// > 0, Richtung über `typ`
    pub betrag_cent: i64,
    /// 'einnahme' | 'ausgabe'
    pub typ: String,
    pub kategorie_id: Option<i64>,
    pub rhythmus: String,
    /// Anker: erster (nächster) Termin
    pub naechstes_datum: String,
    /// Tag im Monat (1–31); fehlt er, der Tag von `naechstes_datum`
    #[serde(default)]
    pub tag: Option<u32>,
    pub aktiv: bool,
}

/// Geprüfte Eingabe: Vorlage (nur die Felder von Version 1), rhythmus, naechstes_datum, aktiv.
#[derive(Debug, Clone, PartialEq)]
pub struct WiederkehrendGeprueft {
    pub vorlage: Map<String, Value>,
    pub rhythmus: String,
    pub naechstes_datum: String,
    pub aktiv: bool,
}

/// Prüft ohne Datenbank (Kategorie prüft `kategorie_pruefen` in der Transaktion).
pub fn wiederkehrend_pruefen(d: &WiederkehrendEingabe) -> Result<WiederkehrendGeprueft, String> {
    let name = text_pruefen("einen Namen", &d.name)?;
    if d.betrag_cent <= 0 || d.betrag_cent > BETRAG_MAX {
        return Err("Bitte einen Betrag zwischen 0,01 € und 1.000.000 € eingeben.".into());
    }
    if d.typ != "einnahme" && d.typ != "ausgabe" {
        return Err(format!("Unbekannter Typ „{}“.", d.typ));
    }
    if !RHYTHMEN.contains(&d.rhythmus.as_str()) {
        return Err(format!("Unbekannter Rhythmus „{}“.", d.rhythmus));
    }
    let (jahr, monat, tag_datum) = datum_lesen("Nächste Zahlung", &d.naechstes_datum)?;
    let tag = d.tag.unwrap_or(tag_datum);
    // Der Anker muss zum Tag passen: 31. ⇒ im Februar der 28./29., sonst genau der Tag
    if !(1..=31).contains(&tag) || tag.min(tage_im_monat(jahr, monat)) != tag_datum {
        return Err("Tag und Datum der nächsten Zahlung passen nicht zusammen.".into());
    }
    if let Some(k) = d.kategorie_id
        && k < 1
    {
        return Err("Unbekannte Kategorie.".into());
    }
    let mut vorlage = Map::new();
    vorlage.insert("name".into(), Value::from(name));
    vorlage.insert("betrag_cent".into(), Value::from(d.betrag_cent));
    vorlage.insert("typ".into(), Value::from(d.typ.clone()));
    vorlage.insert(
        "kategorie_id".into(),
        d.kategorie_id.map_or(Value::Null, Value::from),
    );
    vorlage.insert("tag".into(), Value::from(tag));
    Ok(WiederkehrendGeprueft {
        vorlage,
        rhythmus: d.rhythmus.clone(),
        naechstes_datum: d.naechstes_datum.clone(),
        aktiv: d.aktiv,
    })
}

/// Kategorie muss es geben und zum Typ passen.
pub async fn kategorie_pruefen(
    tx: &mut SqliteConnection,
    vorlage: &Map<String, Value>,
) -> Result<(), String> {
    let Some(k) = vorlage.get("kategorie_id").and_then(Value::as_i64) else {
        return Ok(());
    };
    let typ: Option<String> = sqlx::query_scalar("SELECT typ FROM kategorien WHERE id = ?")
        .bind(k)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_fehler)?;
    match typ {
        Some(t) if vorlage.get("typ").and_then(Value::as_str) == Some(t.as_str()) => Ok(()),
        Some(_) => Err("Die Kategorie passt nicht zu Einnahme/Ausgabe.".into()),
        None => Err("Unbekannte Kategorie.".into()),
    }
}

fn als_json(m: &Map<String, Value>) -> String {
    Value::Object(m.clone()).to_string()
}

pub async fn wk_anlegen(
    conn: &mut SqliteConnection,
    d: &WiederkehrendEingabe,
    zeitpunkt: &str,
) -> Result<PostenErgebnis, String> {
    let g = wiederkehrend_pruefen(d)?;
    in_transaktion(conn, async |tx| {
        kategorie_pruefen(tx, &g.vorlage).await?;
        let id = sqlx::query(
            "INSERT INTO wiederkehrend (vorlage_json, rhythmus, naechstes_datum, aktiv) VALUES (?, ?, ?, ?)",
        )
        .bind(als_json(&g.vorlage))
        .bind(&g.rhythmus)
        .bind(&g.naechstes_datum)
        .bind(i64::from(g.aktiv))
        .execute(&mut *tx)
        .await
        .map_err(db_fehler)?
        .last_insert_rowid();
        neu_protokollieren(tx, "wiederkehrend", id, zeitpunkt).await
    })
    .await
}

pub async fn wk_aendern(
    conn: &mut SqliteConnection,
    id: i64,
    d: &WiederkehrendEingabe,
    zeitpunkt: &str,
) -> Result<PostenErgebnis, String> {
    let g = wiederkehrend_pruefen(d)?;
    in_transaktion(conn, async |tx| {
        kategorie_pruefen(tx, &g.vorlage).await?;
        let Some(alt) = zeile_json(tx, "wiederkehrend", id).await? else {
            return Err(WK_FEHLT.into());
        };
        // Zusatzfelder späterer Versionen behalten, die bekannten überschreiben
        let mut vorlage = alt
            .get("vorlage_json")
            .and_then(Value::as_str)
            .and_then(|t| serde_json::from_str::<Map<String, Value>>(t).ok())
            .unwrap_or_default();
        vorlage.extend(g.vorlage.clone());
        let neu = [
            ("vorlage_json", Value::from(als_json(&vorlage))),
            ("rhythmus", Value::from(g.rhythmus.clone())),
            ("naechstes_datum", Value::from(g.naechstes_datum.clone())),
            ("aktiv", Value::from(i64::from(g.aktiv))),
        ];
        felder_aendern(tx, "wiederkehrend", id, &neu, zeitpunkt, WK_FEHLT).await
    })
    .await
}

/// Nur ein-/ausschalten (Schalter in der Liste).
pub async fn wk_aktiv(
    conn: &mut SqliteConnection,
    id: i64,
    aktiv: bool,
    zeitpunkt: &str,
) -> Result<PostenErgebnis, String> {
    let neu = [("aktiv", Value::from(i64::from(aktiv)))];
    in_transaktion(conn, async |tx| {
        felder_aendern(tx, "wiederkehrend", id, &neu, zeitpunkt, WK_FEHLT).await
    })
    .await
}

pub async fn wk_loeschen(
    conn: &mut SqliteConnection,
    id: i64,
    zeitpunkt: &str,
) -> Result<PostenErgebnis, String> {
    in_transaktion(conn, async |tx| {
        let gebucht: i64 =
            sqlx::query_scalar("SELECT count(*) FROM buchungen WHERE wiederkehrend_id = ?")
                .bind(id)
                .fetch_one(&mut *tx)
                .await
                .map_err(db_fehler)?;
        if gebucht > 0 {
            return Err(
                "Auf diesen Posten verweisen schon Buchungen. Bitte pausieren statt löschen."
                    .into(),
            );
        }
        loeschen_in(tx, "wiederkehrend", id, zeitpunkt, WK_FEHLT).await
    })
    .await
}

/* ---------- Gemeinsam: Protokoll, Ändern, Löschen ---------- */

async fn neu_protokollieren(
    tx: &mut SqliteConnection,
    tabelle: &'static str,
    id: i64,
    zeitpunkt: &str,
) -> Result<PostenErgebnis, String> {
    let neu = zeile_json(tx, tabelle, id).await?;
    protokollieren(tx, zeitpunkt, tabelle, id, "neu", None, neu.as_ref()).await?;
    Ok(PostenErgebnis {
        id,
        geaendert: true,
    })
}

/// Übernimmt `neu` (Spalte ⇒ Wert) und protokolliert nur die wirklich geänderten Felder (wie kunden.rs).
/// Spalten- und Tabellennamen sind feste Texte, nie Eingaben.
async fn felder_aendern(
    tx: &mut SqliteConnection,
    tabelle: &'static str,
    id: i64,
    neu: &[(&'static str, Value)],
    zeitpunkt: &str,
    fehlt: &str,
) -> Result<PostenErgebnis, String> {
    let Some(alt) = zeile_json(tx, tabelle, id).await? else {
        return Err(fehlt.into());
    };
    let mut diff_alt = Map::new();
    let mut diff_neu = Map::new();
    for (k, v) in neu {
        let vorher = alt.get(*k).cloned().unwrap_or(Value::Null);
        if &vorher != v {
            diff_alt.insert((*k).into(), vorher);
            diff_neu.insert((*k).into(), v.clone());
        }
    }
    if diff_neu.is_empty() {
        return Ok(PostenErgebnis {
            id,
            geaendert: false,
        });
    }
    let sql = format!(
        "UPDATE {tabelle} SET {} WHERE id = ?",
        diff_neu
            .keys()
            .map(|k| format!("{k} = ?"))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let mut q = sqlx::query(&sql);
    for v in diff_neu.values() {
        q = match v {
            Value::String(s) => q.bind(s.clone()),
            Value::Number(n) if n.is_i64() => q.bind(n.as_i64()),
            Value::Null => q.bind(None::<i64>),
            _ => {
                return Err(format!(
                    "{tabelle}: Wert {v} kann nicht gespeichert werden."
                ));
            }
        };
    }
    q.bind(id).execute(&mut *tx).await.map_err(db_fehler)?;
    protokollieren(
        tx,
        zeitpunkt,
        tabelle,
        id,
        "geaendert",
        Some(&diff_alt),
        Some(&diff_neu),
    )
    .await?;
    Ok(PostenErgebnis {
        id,
        geaendert: true,
    })
}

async fn loeschen_in(
    tx: &mut SqliteConnection,
    tabelle: &'static str,
    id: i64,
    zeitpunkt: &str,
    fehlt: &str,
) -> Result<PostenErgebnis, String> {
    let Some(alt) = zeile_json(tx, tabelle, id).await? else {
        return Err(fehlt.into());
    };
    sqlx::query(&format!("DELETE FROM {tabelle} WHERE id = ?"))
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_fehler)?;
    protokollieren(tx, zeitpunkt, tabelle, id, "geloescht", Some(&alt), None).await?;
    Ok(PostenErgebnis {
        id,
        geaendert: true,
    })
}

/* ---------- Tauri-Commands (dünne Hüllen) ---------- */

/// Frontend: `invoke('planposten_anlegen', { daten, heute })`.
#[tauri::command]
pub async fn planposten_anlegen(
    instanzen: tauri::State<'_, DbInstances>,
    daten: PlanpostenEingabe,
    heute: String,
) -> Result<PostenErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    plan_anlegen(&mut c, &daten, &heute, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('planposten_aendern', { id, daten, heute })`.
#[tauri::command]
pub async fn planposten_aendern(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    daten: PlanpostenEingabe,
    heute: String,
) -> Result<PostenErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    plan_aendern(&mut c, id, &daten, &heute, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('planposten_loeschen', { id })`.
#[tauri::command]
pub async fn planposten_loeschen(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
) -> Result<PostenErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    plan_loeschen(&mut c, id, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('wiederkehrend_anlegen', { daten })`.
#[tauri::command]
pub async fn wiederkehrend_anlegen(
    instanzen: tauri::State<'_, DbInstances>,
    daten: WiederkehrendEingabe,
) -> Result<PostenErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    wk_anlegen(&mut c, &daten, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('wiederkehrend_aendern', { id, daten })`.
#[tauri::command]
pub async fn wiederkehrend_aendern(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    daten: WiederkehrendEingabe,
) -> Result<PostenErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    wk_aendern(&mut c, id, &daten, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('wiederkehrend_aktiv', { id, aktiv })`.
#[tauri::command]
pub async fn wiederkehrend_aktiv(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    aktiv: bool,
) -> Result<PostenErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    wk_aktiv(&mut c, id, aktiv, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('wiederkehrend_loeschen', { id })`.
#[tauri::command]
pub async fn wiederkehrend_loeschen(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
) -> Result<PostenErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    wk_loeschen(&mut c, id, &datenbank::zeitstempel()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::datenbank::testhilfe::test_db;

    const HEUTE: &str = "2026-10-18";
    const JETZT: &str = "2026-10-18T08:00:00Z";
    const SPAETER: &str = "2026-10-19T09:30:00Z";

    fn lauf<F: std::future::Future<Output = ()>>(f: F) {
        tauri::async_runtime::block_on(f);
    }

    fn maeher() -> PlanpostenEingabe {
        PlanpostenEingabe {
            datum: "2026-11-14".into(),
            text: "  Aufsitzmäher (gebraucht) ".into(),
            betrag_cent: -149_000,
        }
    }

    fn handy() -> WiederkehrendEingabe {
        WiederkehrendEingabe {
            name: " Handyvertrag ".into(),
            betrag_cent: 2_999,
            typ: "ausgabe".into(),
            kategorie_id: Some(4),
            rhythmus: "monatlich".into(),
            naechstes_datum: "2026-10-20".into(),
            tag: None,
            aktiv: true,
        }
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

    #[test]
    fn planposten_anlegen_aendern_loeschen_mit_protokoll() {
        lauf(async {
            let mut c = test_db().await;
            let e = plan_anlegen(&mut c, &maeher(), HEUTE, JETZT).await.unwrap();
            assert!(e.geaendert);
            let z: (String, String, i64) =
                sqlx::query_as("SELECT datum, text, betrag_cent FROM planposten WHERE id = ?")
                    .bind(e.id)
                    .fetch_one(&mut c)
                    .await
                    .unwrap();
            assert_eq!(
                z,
                (
                    "2026-11-14".into(),
                    "Aufsitzmäher (gebraucht)".into(),
                    -149_000
                )
            );

            // nur das Datum ändern: nur das Datum im Protokoll
            let spaeter = PlanpostenEingabe {
                datum: "2026-12-14".into(),
                ..maeher()
            };
            assert!(
                plan_aendern(&mut c, e.id, &spaeter, HEUTE, SPAETER)
                    .await
                    .unwrap()
                    .geaendert
            );
            // gleiche Daten: nichts
            assert!(
                !plan_aendern(&mut c, e.id, &spaeter, HEUTE, SPAETER)
                    .await
                    .unwrap()
                    .geaendert
            );
            plan_loeschen(&mut c, e.id, SPAETER).await.unwrap();
            let anzahl: i64 = sqlx::query_scalar("SELECT count(*) FROM planposten")
                .fetch_one(&mut c)
                .await
                .unwrap();
            assert_eq!(anzahl, 0);

            let p = protokoll(&mut c).await;
            assert_eq!(p.len(), 3);
            assert_eq!(
                (p[0].0.as_str(), p[0].1, p[0].2.as_str()),
                ("planposten", e.id, "neu")
            );
            assert_eq!(json(&p[0].4)["betrag_cent"], -149_000);
            assert_eq!(p[1].2, "geaendert");
            assert_eq!(json(&p[1].3), serde_json::json!({ "datum": "2026-11-14" }));
            assert_eq!(json(&p[1].4), serde_json::json!({ "datum": "2026-12-14" }));
            assert_eq!(p[2].2, "geloescht");
            assert_eq!(json(&p[2].3)["text"], "Aufsitzmäher (gebraucht)");
            assert!(p[2].4.is_none());

            assert_eq!(
                plan_loeschen(&mut c, e.id, SPAETER).await.unwrap_err(),
                PLAN_FEHLT
            );
            assert_eq!(
                plan_aendern(&mut c, 99, &maeher(), HEUTE, SPAETER)
                    .await
                    .unwrap_err(),
                PLAN_FEHLT
            );
        });
    }

    #[test]
    fn planposten_pruefen_lehnt_ungueltiges_ab() {
        let p = |datum: &str, text: &str, betrag_cent| PlanpostenEingabe {
            datum: datum.into(),
            text: text.into(),
            betrag_cent,
        };
        assert!(planposten_pruefen(&p("2026-10-19", "x", 1), HEUTE).is_ok());
        assert!(planposten_pruefen(&p("2026-10-18", "x", 1), HEUTE).is_err());
        assert!(planposten_pruefen(&p("2026-02-30", "x", 1), HEUTE).is_err());
        assert!(planposten_pruefen(&p("2026-11-01", "  ", 1), HEUTE).is_err());
        assert!(planposten_pruefen(&p("2026-11-01", &"x".repeat(81), 1), HEUTE).is_err());
        assert!(planposten_pruefen(&p("2026-11-01", "x", 0), HEUTE).is_err());
        assert!(planposten_pruefen(&p("2026-11-01", "x", -100_000_001), HEUTE).is_err());
        assert!(planposten_pruefen(&p("2026-11-01", "x", -100_000_000), HEUTE).is_ok());
    }

    #[test]
    fn wiederkehrend_pruefen_tag_und_datum() {
        let g = wiederkehrend_pruefen(&handy()).unwrap();
        assert_eq!(
            Value::Object(g.vorlage),
            serde_json::json!({ "name": "Handyvertrag", "betrag_cent": 2999, "typ": "ausgabe", "kategorie_id": 4, "tag": 20 })
        );
        // der 31. mit Anker im Februar
        let ende = WiederkehrendEingabe {
            naechstes_datum: "2027-02-28".into(),
            tag: Some(31),
            ..handy()
        };
        assert_eq!(wiederkehrend_pruefen(&ende).unwrap().vorlage["tag"], 31);
        for kaputt in [
            WiederkehrendEingabe {
                tag: Some(21),
                ..handy()
            },
            WiederkehrendEingabe {
                naechstes_datum: "2027-02-27".into(),
                tag: Some(31),
                ..handy()
            },
            WiederkehrendEingabe {
                tag: Some(0),
                naechstes_datum: "2026-10-01".into(),
                ..handy()
            },
            WiederkehrendEingabe {
                rhythmus: "woechentlich".into(),
                ..handy()
            },
            WiederkehrendEingabe {
                typ: "privat".into(),
                ..handy()
            },
            WiederkehrendEingabe {
                betrag_cent: 0,
                ..handy()
            },
            WiederkehrendEingabe {
                betrag_cent: -2_999,
                ..handy()
            },
            WiederkehrendEingabe {
                name: " ".into(),
                ..handy()
            },
            WiederkehrendEingabe {
                naechstes_datum: "20.10.2026".into(),
                ..handy()
            },
        ] {
            assert!(wiederkehrend_pruefen(&kaputt).is_err(), "{kaputt:?}");
        }
    }

    #[test]
    fn wiederkehrend_anlegen_aendern_pausieren_loeschen() {
        lauf(async {
            let mut c = test_db().await;
            let e = wk_anlegen(&mut c, &handy(), JETZT).await.unwrap();
            let (vorlage, rhythmus, naechstes, aktiv): (String, String, String, i64) =
                sqlx::query_as(
                    "SELECT vorlage_json, rhythmus, naechstes_datum, aktiv FROM wiederkehrend WHERE id = ?",
                )
                .bind(e.id)
                .fetch_one(&mut c)
                .await
                .unwrap();
            let v: Value = serde_json::from_str(&vorlage).unwrap();
            assert_eq!(v["name"], "Handyvertrag");
            assert_eq!(v["tag"], 20);
            assert_eq!(
                (rhythmus.as_str(), naechstes.as_str(), aktiv),
                ("monatlich", "2026-10-20", 1)
            );

            // Zusatzfeld einer späteren Version bleibt beim Ändern erhalten
            sqlx::query("UPDATE wiederkehrend SET vorlage_json = json_set(vorlage_json, '$.zahlungsart', 'bank') WHERE id = ?")
                .bind(e.id)
                .execute(&mut c)
                .await
                .unwrap();
            let teurer = WiederkehrendEingabe {
                betrag_cent: 3_499,
                ..handy()
            };
            assert!(
                wk_aendern(&mut c, e.id, &teurer, SPAETER)
                    .await
                    .unwrap()
                    .geaendert
            );
            let vorlage: String =
                sqlx::query_scalar("SELECT vorlage_json FROM wiederkehrend WHERE id = ?")
                    .bind(e.id)
                    .fetch_one(&mut c)
                    .await
                    .unwrap();
            let v: Value = serde_json::from_str(&vorlage).unwrap();
            assert_eq!(v["betrag_cent"], 3_499);
            assert_eq!(v["zahlungsart"], "bank");
            assert!(
                !wk_aendern(&mut c, e.id, &teurer, SPAETER)
                    .await
                    .unwrap()
                    .geaendert
            );

            // pausieren
            assert!(
                wk_aktiv(&mut c, e.id, false, SPAETER)
                    .await
                    .unwrap()
                    .geaendert
            );
            assert!(
                !wk_aktiv(&mut c, e.id, false, SPAETER)
                    .await
                    .unwrap()
                    .geaendert
            );

            let p = protokoll(&mut c).await;
            assert_eq!(
                p.iter().map(|x| x.2.as_str()).collect::<Vec<_>>(),
                ["neu", "geaendert", "geaendert"]
            );
            assert!(p.iter().all(|x| x.0 == "wiederkehrend" && x.1 == e.id));
            assert_eq!(json(&p[2].3), serde_json::json!({ "aktiv": 1 }));
            assert_eq!(json(&p[2].4), serde_json::json!({ "aktiv": 0 }));

            // Löschen geht nicht, sobald eine Buchung darauf verweist (Phase 7)
            sqlx::query(
                "INSERT INTO buchungen (nummer, typ, zahlungsdatum, betrag_cent, kategorie_id, zahlungsart, beschreibung,
                   wiederkehrend_id, erstellt_am, geaendert_am)
                 VALUES ('2026-0001', 'ausgabe', '2026-09-20', 2999, 4, 'bank', 'Handy', ?, 'x', 'x')",
            )
            .bind(e.id)
            .execute(&mut c)
            .await
            .unwrap();
            assert!(
                wk_loeschen(&mut c, e.id, SPAETER)
                    .await
                    .unwrap_err()
                    .contains("pausieren")
            );
            sqlx::query("DELETE FROM buchungen")
                .execute(&mut c)
                .await
                .unwrap();
            wk_loeschen(&mut c, e.id, SPAETER).await.unwrap();
            let p = protokoll(&mut c).await;
            assert_eq!(p.last().unwrap().2, "geloescht");
            assert_eq!(
                wk_loeschen(&mut c, e.id, SPAETER).await.unwrap_err(),
                WK_FEHLT
            );
        });
    }

    #[test]
    fn wiederkehrend_kategorie_muss_passen() {
        lauf(async {
            let mut c = test_db().await;
            // 1 = Dienstleistungen (Einnahme), 4 = Sonstiges (Ausgabe) aus 0002
            let falsch = WiederkehrendEingabe {
                kategorie_id: Some(1),
                ..handy()
            };
            assert!(
                wk_anlegen(&mut c, &falsch, JETZT)
                    .await
                    .unwrap_err()
                    .contains("passt nicht")
            );
            let unbekannt = WiederkehrendEingabe {
                kategorie_id: Some(999),
                ..handy()
            };
            assert_eq!(
                wk_anlegen(&mut c, &unbekannt, JETZT).await.unwrap_err(),
                "Unbekannte Kategorie."
            );
            let ohne = WiederkehrendEingabe {
                kategorie_id: None,
                ..handy()
            };
            assert!(wk_anlegen(&mut c, &ohne, JETZT).await.is_ok());
            assert_eq!(protokoll(&mut c).await.len(), 1);
        });
    }
}
