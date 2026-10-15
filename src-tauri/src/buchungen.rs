//! Buchungen (ANLEITUNG §5, §6.3, §6.4): Anlegen, Ändern und Stornieren als Rust-Commands.
//! Jeder Vorgang läuft in EINER Transaktion (CLAUDE.md „Mehrschritt-Vorgänge als Rust-Command mit Transaktion“):
//! Nummer vergeben, ggf. neuen Kunden anlegen, Buchung schreiben, GoBD-Protokoll schreiben, alles oder nichts.
//!
//! VORZEICHEN-REGEL (gilt überall, auch später in Summen, EÜR, Auswertung, Export):
//! `betrag_cent` ist IMMER positiv (Endbetrag brutto). Eine Zeile mit `storno_von_id IS NOT NULL` (Storno-Buchung)
//! zählt in allen Summen NEGATIV, z. B.
//! `SUM(CASE WHEN storno_von_id IS NULL THEN betrag_cent ELSE -betrag_cent END)`.
//!
//! Festgeschriebene Zeiträume (zahlungsdatum <= max(festschreibungen.bis_datum)) sind schreibgeschützt: hier geprüft
//! (verständliche Meldung) und zusätzlich per Trigger (Migration 0004).
//!
//! Die Kernfunktionen (`anlegen`, `aendern`, `stornieren`) nehmen eine Verbindung und öffnen selbst die Transaktion,
//! damit die Tests sie ohne Tauri gegen eine migrierte Datenbank im Arbeitsspeicher prüfen können.
//! Die `#[tauri::command]`-Funktionen holen nur die Verbindung aus dem Pool des SQL-Plugins.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{Connection, SqliteConnection};
use tauri_plugin_sql::DbInstances;

use crate::datenbank::{self, db_fehler};
use crate::nummern;

/// Eingabe aus der Erfassen-Schublade (src/lib/…). Feldnamen exakt so (snake_case).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuchungEingabe {
    /// 'einnahme' | 'ausgabe'
    pub typ: String,
    /// 'YYYY-MM-DD', maßgeblich für die EÜR
    pub zahlungsdatum: String,
    pub belegdatum: Option<String>,
    /// > 0, immer positiv (brutto)
    pub betrag_cent: i64,
    /// 0 bis 100
    pub privatanteil_prozent: i64,
    pub kategorie_id: i64,
    /// nur bei Einnahmen
    pub kunde_id: Option<i64>,
    /// nur bei Einnahmen: Name eines neuen Kunden (wird in derselben Transaktion angelegt), schließt kunde_id aus
    pub neuer_kunde: Option<String>,
    /// nur bei Ausgaben: Geschäft als Freitext
    pub lieferant: Option<String>,
    /// 'bar' | 'bank' | 'paypal'
    pub zahlungsart: String,
    pub belegnummer: Option<String>,
    pub beschreibung: String,
    /// heutiges lokales Datum 'YYYY-MM-DD' (Jahr für die Buchungsnummer, siehe nummern::vergeben_fortlaufend)
    pub heute: String,
}

/// Antwort an das Frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BuchungErgebnis {
    /// ID der angelegten bzw. geänderten Buchung (beim Stornieren: der Storno-Buchung)
    pub id: i64,
    /// ihre Nummer, z. B. 2026-0001
    pub nummer: String,
    /// Kunde der Buchung (falls vorhanden)
    pub kunde_id: Option<i64>,
    /// dessen Kundennummer, z. B. K-0012
    pub kunde_nummer: Option<String>,
    /// true, wenn der Kunde in diesem Vorgang neu angelegt wurde (`neuer_kunde`)
    pub kunde_neu: bool,
}

/* ---------- Prüfen ohne Datenbank ---------- */

/// Geprüfte und bereinigte Eingabe.
#[derive(Debug, Clone)]
struct Geprueft {
    typ: String,
    zahlungsdatum: String,
    belegdatum: Option<String>,
    betrag_cent: i64,
    privatanteil_prozent: i64,
    kategorie_id: i64,
    kunde_id: Option<i64>,
    neuer_kunde: Option<String>,
    lieferant: Option<String>,
    zahlungsart: String,
    belegnummer: Option<String>,
    beschreibung: String,
    jahr_heute: i64,
}

/// Getrimmter Text, leer ⇒ None.
fn text_oder_nichts(t: &Option<String>) -> Option<String> {
    t.as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

/// Liest ein Datum 'YYYY-MM-DD' und prüft, ob es den Tag im Kalender gibt. Liefert (Jahr, Monat, Tag).
pub fn datum_lesen(feld: &str, text: &str) -> Result<(i64, u32, u32), String> {
    let fehler = || format!("{feld} „{text}“ ist kein gültiges Datum.");
    let b = text.as_bytes();
    let form_ok = b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
    if !form_ok {
        return Err(fehler());
    }
    let jahr: i64 = text[0..4].parse().map_err(|_| fehler())?;
    let monat: u32 = text[5..7].parse().map_err(|_| fehler())?;
    let tag: u32 = text[8..10].parse().map_err(|_| fehler())?;
    let schalt = (jahr % 4 == 0 && jahr % 100 != 0) || jahr % 400 == 0;
    let tage = match monat {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if schalt => 29,
        2 => 28,
        _ => return Err(fehler()),
    };
    if jahr < 1000 || tag < 1 || tag > tage {
        return Err(fehler());
    }
    Ok((jahr, monat, tag))
}

/// 'YYYY-MM-DD' ⇒ 'TT.MM.JJJJ' für Meldungen.
fn datum_de(iso: &str) -> String {
    match datum_lesen("Datum", iso) {
        Ok((j, m, t)) => format!("{t:02}.{m:02}.{j:04}"),
        Err(_) => iso.to_string(),
    }
}

fn pruefen(d: &BuchungEingabe) -> Result<Geprueft, String> {
    if d.typ != "einnahme" && d.typ != "ausgabe" {
        return Err(format!("Unbekannter Typ „{}“.", d.typ));
    }
    let einnahme = d.typ == "einnahme";
    datum_lesen("Zahlungsdatum", &d.zahlungsdatum)?;
    let belegdatum = text_oder_nichts(&d.belegdatum);
    if let Some(b) = &belegdatum {
        datum_lesen("Belegdatum", b)?;
    }
    let (jahr_heute, _, _) = datum_lesen("Heutiges Datum", &d.heute)?;
    if d.betrag_cent <= 0 {
        return Err("Der Betrag muss größer als 0 sein.".into());
    }
    if !(0..=100).contains(&d.privatanteil_prozent) {
        return Err("Der Privatanteil muss zwischen 0 und 100 % liegen.".into());
    }
    if !matches!(d.zahlungsart.as_str(), "bar" | "bank" | "paypal") {
        return Err(format!("Unbekannter Zahlungsweg „{}“.", d.zahlungsart));
    }
    let beschreibung = d.beschreibung.trim().to_string();
    if beschreibung.is_empty() {
        return Err("Bitte eine Beschreibung eingeben.".into());
    }
    let neuer_kunde = text_oder_nichts(&d.neuer_kunde);
    let lieferant = text_oder_nichts(&d.lieferant);
    if einnahme {
        if lieferant.is_some() {
            return Err("Ein Geschäft gibt es nur bei Ausgaben.".into());
        }
        if neuer_kunde.is_some() && d.kunde_id.is_some() {
            return Err(
                "Entweder einen vorhandenen Kunden wählen oder einen neuen anlegen.".into(),
            );
        }
    } else if d.kunde_id.is_some() || neuer_kunde.is_some() {
        return Err("Einen Kunden gibt es nur bei Einnahmen.".into());
    }
    Ok(Geprueft {
        typ: d.typ.clone(),
        zahlungsdatum: d.zahlungsdatum.clone(),
        belegdatum,
        betrag_cent: d.betrag_cent,
        privatanteil_prozent: d.privatanteil_prozent,
        kategorie_id: d.kategorie_id,
        kunde_id: d.kunde_id,
        neuer_kunde,
        lieferant,
        zahlungsart: d.zahlungsart.clone(),
        belegnummer: text_oder_nichts(&d.belegnummer),
        beschreibung,
        jahr_heute,
    })
}

/* ---------- Prüfen mit Datenbank ---------- */

/// Ende des festgeschriebenen Zeitraums (None = nichts festgeschrieben).
async fn festgeschrieben_bis(conn: &mut SqliteConnection) -> Result<Option<String>, String> {
    sqlx::query_scalar("SELECT max(bis_datum) FROM festschreibungen")
        .fetch_one(conn)
        .await
        .map_err(db_fehler)
}

fn ist_festgeschrieben(bis: &Option<String>, datum: &str) -> bool {
    bis.as_deref().is_some_and(|b| datum <= b)
}

fn festgeschrieben_meldung(bis: &Option<String>) -> String {
    format!(
        "Der Zeitraum bis {} ist festgeschrieben.",
        datum_de(bis.as_deref().unwrap_or_default())
    )
}

/// Kategorie muss existieren, zum Typ passen und darf nicht archiviert sein
/// (außer sie ist schon die Kategorie der Buchung, die geändert wird: `bisher`).
async fn kategorie_pruefen(
    conn: &mut SqliteConnection,
    id: i64,
    typ: &str,
    bisher: Option<i64>,
) -> Result<(), String> {
    let zeile: Option<(String, String, i64)> =
        sqlx::query_as("SELECT name, typ, archiviert FROM kategorien WHERE id = ?")
            .bind(id)
            .fetch_optional(conn)
            .await
            .map_err(db_fehler)?;
    let Some((name, kat_typ, archiviert)) = zeile else {
        return Err("Die gewählte Kategorie gibt es nicht.".into());
    };
    if kat_typ != typ {
        let art = if typ == "einnahme" {
            "Einnahmen"
        } else {
            "Ausgaben"
        };
        return Err(format!("Die Kategorie „{name}“ passt nicht zu {art}."));
    }
    if archiviert != 0 && bisher != Some(id) {
        return Err(format!("Die Kategorie „{name}“ ist archiviert."));
    }
    Ok(())
}

async fn kunden_nummer(conn: &mut SqliteConnection, id: i64) -> Result<Option<String>, String> {
    sqlx::query_scalar("SELECT nummer FROM kunden WHERE id = ?")
        .bind(id)
        .fetch_optional(conn)
        .await
        .map_err(db_fehler)
}

/* ---------- Protokoll und Hilfen ---------- */

/// Ganze Zeile als JSON-Objekt (Spaltennamen als Schlüssel). Die Spalten kommen aus dem Schema selbst, so sind
/// auch Spalten späterer Migrationen im Protokoll. `tabelle` ist immer ein fester Name aus diesem Modul.
async fn zeile_json(
    conn: &mut SqliteConnection,
    tabelle: &str,
    id: i64,
) -> Result<Option<Map<String, Value>>, String> {
    let spalten: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info(?) ORDER BY cid")
            .bind(tabelle)
            .fetch_all(&mut *conn)
            .await
            .map_err(db_fehler)?;
    let felder: Vec<String> = spalten.iter().map(|s| format!("'{s}', \"{s}\"")).collect();
    let sql = format!(
        "SELECT json_object({}) FROM \"{tabelle}\" WHERE id = ?",
        felder.join(", ")
    );
    let text: Option<String> = sqlx::query_scalar(&sql)
        .bind(id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(db_fehler)?;
    match text {
        None => Ok(None),
        Some(t) => match serde_json::from_str(&t) {
            Ok(Value::Object(m)) => Ok(Some(m)),
            _ => Err(format!("{tabelle} {id}: Zeile nicht lesbar.")),
        },
    }
}

/// Eintrag ins GoBD-Protokoll (wie protokollSql in src/lib/queries/protokoll.ts, schluessel NULL).
async fn protokollieren(
    conn: &mut SqliteConnection,
    zeitpunkt: &str,
    tabelle: &str,
    datensatz_id: i64,
    aktion: &str,
    alt: Option<&Map<String, Value>>,
    neu: Option<&Map<String, Value>>,
) -> Result<(), String> {
    let json = |m: Option<&Map<String, Value>>| m.map(|m| Value::Object(m.clone()).to_string());
    sqlx::query(
        "INSERT INTO protokoll (zeitpunkt, tabelle, datensatz_id, aktion, alt_json, neu_json, schluessel)
         VALUES (?, ?, ?, ?, ?, ?, NULL)",
    )
    .bind(zeitpunkt)
    .bind(tabelle)
    .bind(datensatz_id)
    .bind(aktion)
    .bind(json(alt))
    .bind(json(neu))
    .execute(conn)
    .await
    .map_err(db_fehler)?;
    Ok(())
}

/// Legt einen Kunden mit Namen an (Nummer aus dem Kreis 'kunde') und protokolliert ihn. Gibt (id, nummer) zurück.
async fn kunde_anlegen(
    conn: &mut SqliteConnection,
    name: &str,
    jahr_heute: i64,
    zeitpunkt: &str,
) -> Result<(i64, String), String> {
    let nummer = nummern::vergeben(conn, "kunde", jahr_heute).await?;
    let id = sqlx::query("INSERT INTO kunden (nummer, name, erstellt_am) VALUES (?, ?, ?)")
        .bind(&nummer)
        .bind(name)
        .bind(zeitpunkt)
        .execute(&mut *conn)
        .await
        .map_err(db_fehler)?
        .last_insert_rowid();
    let neu = zeile_json(conn, "kunden", id).await?;
    protokollieren(conn, zeitpunkt, "kunden", id, "neu", None, neu.as_ref()).await?;
    Ok((id, nummer))
}

/// Kunde der Buchung: vorhandener (muss existieren) oder neu angelegter. (id, nummer, neu?)
async fn kunde_bestimmen(
    conn: &mut SqliteConnection,
    g: &Geprueft,
    zeitpunkt: &str,
) -> Result<(Option<i64>, Option<String>, bool), String> {
    if let Some(name) = &g.neuer_kunde {
        let (id, nummer) = kunde_anlegen(conn, name, g.jahr_heute, zeitpunkt).await?;
        return Ok((Some(id), Some(nummer), true));
    }
    match g.kunde_id {
        None => Ok((None, None, false)),
        Some(id) => match kunden_nummer(conn, id).await? {
            Some(nummer) => Ok((Some(id), Some(nummer), false)),
            None => Err("Den gewählten Kunden gibt es nicht.".into()),
        },
    }
}

fn feld_i64(m: &Map<String, Value>, k: &str) -> Option<i64> {
    m.get(k).and_then(Value::as_i64)
}

fn feld_text(m: &Map<String, Value>, k: &str) -> Option<String> {
    m.get(k).and_then(Value::as_str).map(String::from)
}

/// Führt `arbeit` in einer Transaktion aus: Erfolg ⇒ COMMIT, Fehler ⇒ ROLLBACK (nichts bleibt zurück).
/// BEGIN IMMEDIATE: Die Schreibsperre wird sofort geholt, so kann zwischen dem Lesen des Nummernkreises und dem
/// UPDATE niemand dazwischenschreiben.
async fn in_transaktion<T>(
    conn: &mut SqliteConnection,
    arbeit: impl AsyncFnOnce(&mut SqliteConnection) -> Result<T, String>,
) -> Result<T, String> {
    let mut tx = conn
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(db_fehler)?;
    match arbeit(&mut tx).await {
        Ok(wert) => {
            tx.commit().await.map_err(db_fehler)?;
            Ok(wert)
        }
        Err(e) => {
            let _ = tx.rollback().await;
            Err(e)
        }
    }
}

/* ---------- Anlegen ---------- */

/// Legt eine Buchung an (art 'zahlung'), ggf. mit neuem Kunden, und protokolliert beides.
pub async fn anlegen(
    conn: &mut SqliteConnection,
    daten: &BuchungEingabe,
    zeitpunkt: &str,
) -> Result<BuchungErgebnis, String> {
    let g = pruefen(daten)?;
    in_transaktion(conn, async |tx| anlegen_in(tx, &g, zeitpunkt).await).await
}

async fn anlegen_in(
    tx: &mut SqliteConnection,
    g: &Geprueft,
    zeitpunkt: &str,
) -> Result<BuchungErgebnis, String> {
    let bis = festgeschrieben_bis(tx).await?;
    if ist_festgeschrieben(&bis, &g.zahlungsdatum) {
        return Err(festgeschrieben_meldung(&bis));
    }
    kategorie_pruefen(tx, g.kategorie_id, &g.typ, None).await?;
    let (kunde_id, kunde_nummer, kunde_neu) = kunde_bestimmen(tx, g, zeitpunkt).await?;
    let nummer = nummern::vergeben_fortlaufend(tx, "buchung", g.jahr_heute).await?;
    let id = sqlx::query(
        "INSERT INTO buchungen (nummer, typ, zahlungsdatum, belegdatum, betrag_cent, privatanteil_prozent,
           kategorie_id, kunde_id, lieferant, art, zahlungsart, belegnummer, beschreibung, erstellt_am, geaendert_am)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'zahlung', ?, ?, ?, ?, ?)",
    )
    .bind(&nummer)
    .bind(&g.typ)
    .bind(&g.zahlungsdatum)
    .bind(&g.belegdatum)
    .bind(g.betrag_cent)
    .bind(g.privatanteil_prozent)
    .bind(g.kategorie_id)
    .bind(kunde_id)
    .bind(&g.lieferant)
    .bind(&g.zahlungsart)
    .bind(&g.belegnummer)
    .bind(&g.beschreibung)
    .bind(zeitpunkt)
    .bind(zeitpunkt)
    .execute(&mut *tx)
    .await
    .map_err(db_fehler)?
    .last_insert_rowid();
    let neu = zeile_json(tx, "buchungen", id).await?;
    protokollieren(tx, zeitpunkt, "buchungen", id, "neu", None, neu.as_ref()).await?;
    Ok(BuchungErgebnis {
        id,
        nummer,
        kunde_id,
        kunde_nummer,
        kunde_neu,
    })
}

/* ---------- Ändern ---------- */

/// Liest eine Buchung und prüft, ob sie als freie Zahlung geändert bzw. storniert werden darf.
async fn aenderbare_buchung(
    tx: &mut SqliteConnection,
    id: i64,
    vorgang: &str,
) -> Result<Map<String, Value>, String> {
    let Some(alt) = zeile_json(tx, "buchungen", id).await? else {
        return Err("Die Buchung gibt es nicht.".into());
    };
    let nummer = feld_text(&alt, "nummer").unwrap_or_default();
    if feld_text(&alt, "art").as_deref() != Some("zahlung") {
        return Err(format!(
            "Die Buchung {nummer} ist eine Abschreibung oder Pauschale und kann nur über ihr Modul {vorgang} werden."
        ));
    }
    if feld_i64(&alt, "storno_von_id").is_some() {
        return Err(format!(
            "Die Buchung {nummer} ist selbst ein Storno und kann nicht {vorgang} werden."
        ));
    }
    if feld_i64(&alt, "rechnung_id").is_some() {
        return Err(format!(
            "Die Buchung {nummer} gehört zu einem Beleg, nur per Storno des Belegs änderbar."
        ));
    }
    let storno: Option<String> =
        sqlx::query_scalar("SELECT nummer FROM buchungen WHERE storno_von_id = ? LIMIT 1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_fehler)?;
    if let Some(s) = storno {
        return Err(format!(
            "Die Buchung {nummer} ist bereits storniert ({s}) und kann nicht {vorgang} werden."
        ));
    }
    Ok(alt)
}

/// Ändert eine freie Zahlung. Die Nummer bleibt. Protokolliert nur die geänderten Felder;
/// hat sich nichts geändert, wird weder geschrieben noch protokolliert.
pub async fn aendern(
    conn: &mut SqliteConnection,
    id: i64,
    daten: &BuchungEingabe,
    zeitpunkt: &str,
) -> Result<BuchungErgebnis, String> {
    let g = pruefen(daten)?;
    in_transaktion(conn, async |tx| aendern_in(tx, id, &g, zeitpunkt).await).await
}

async fn aendern_in(
    tx: &mut SqliteConnection,
    id: i64,
    g: &Geprueft,
    zeitpunkt: &str,
) -> Result<BuchungErgebnis, String> {
    let alt = aenderbare_buchung(tx, id, "geändert").await?;
    let nummer = feld_text(&alt, "nummer").unwrap_or_default();
    let bis = festgeschrieben_bis(tx).await?;
    let alt_datum = feld_text(&alt, "zahlungsdatum").unwrap_or_default();
    if ist_festgeschrieben(&bis, &alt_datum) || ist_festgeschrieben(&bis, &g.zahlungsdatum) {
        return Err(festgeschrieben_meldung(&bis));
    }
    kategorie_pruefen(tx, g.kategorie_id, &g.typ, feld_i64(&alt, "kategorie_id")).await?;
    let (kunde_id, kunde_nummer, kunde_neu) = kunde_bestimmen(tx, g, zeitpunkt).await?;

    let mut neu = Map::new();
    neu.insert("typ".into(), g.typ.clone().into());
    neu.insert("zahlungsdatum".into(), g.zahlungsdatum.clone().into());
    neu.insert("belegdatum".into(), g.belegdatum.clone().into());
    neu.insert("betrag_cent".into(), g.betrag_cent.into());
    neu.insert("privatanteil_prozent".into(), g.privatanteil_prozent.into());
    neu.insert("kategorie_id".into(), g.kategorie_id.into());
    neu.insert("kunde_id".into(), kunde_id.into());
    neu.insert("lieferant".into(), g.lieferant.clone().into());
    neu.insert("zahlungsart".into(), g.zahlungsart.clone().into());
    neu.insert("belegnummer".into(), g.belegnummer.clone().into());
    neu.insert("beschreibung".into(), g.beschreibung.clone().into());

    // wie aenderungen() in protokoll.ts: nur Felder, die sich wirklich geändert haben
    let mut diff_alt = Map::new();
    let mut diff_neu = Map::new();
    for (k, v) in &neu {
        let vorher = alt.get(k).cloned().unwrap_or(Value::Null);
        if &vorher != v {
            diff_alt.insert(k.clone(), vorher);
            diff_neu.insert(k.clone(), v.clone());
        }
    }
    if !diff_neu.is_empty() {
        sqlx::query(
            "UPDATE buchungen SET typ = ?, zahlungsdatum = ?, belegdatum = ?, betrag_cent = ?,
               privatanteil_prozent = ?, kategorie_id = ?, kunde_id = ?, lieferant = ?, zahlungsart = ?,
               belegnummer = ?, beschreibung = ?, geaendert_am = ?
             WHERE id = ?",
        )
        .bind(&g.typ)
        .bind(&g.zahlungsdatum)
        .bind(&g.belegdatum)
        .bind(g.betrag_cent)
        .bind(g.privatanteil_prozent)
        .bind(g.kategorie_id)
        .bind(kunde_id)
        .bind(&g.lieferant)
        .bind(&g.zahlungsart)
        .bind(&g.belegnummer)
        .bind(&g.beschreibung)
        .bind(zeitpunkt)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_fehler)?;
        protokollieren(
            tx,
            zeitpunkt,
            "buchungen",
            id,
            "geaendert",
            Some(&diff_alt),
            Some(&diff_neu),
        )
        .await?;
    }
    Ok(BuchungErgebnis {
        id,
        nummer,
        kunde_id,
        kunde_nummer,
        kunde_neu,
    })
}

/* ---------- Stornieren ---------- */

/// Storniert eine freie Zahlung per Gegenbuchung (GoBD: nie löschen). Die Storno-Buchung bekommt eine neue Nummer,
/// denselben (positiven!) Betrag und `storno_von_id`; sie zählt in Summen negativ (siehe Vorzeichen-Regel oben).
/// Zahlungsdatum = das der ursprünglichen Buchung; liegt es im festgeschriebenen Zeitraum, `heute`
/// (Korrektur im offenen Zeitraum).
pub async fn stornieren(
    conn: &mut SqliteConnection,
    id: i64,
    heute: &str,
    zeitpunkt: &str,
) -> Result<BuchungErgebnis, String> {
    let (jahr_heute, _, _) = datum_lesen("Heutiges Datum", heute)?;
    in_transaktion(conn, async |tx| {
        stornieren_in(tx, id, heute, jahr_heute, zeitpunkt).await
    })
    .await
}

async fn stornieren_in(
    tx: &mut SqliteConnection,
    id: i64,
    heute: &str,
    jahr_heute: i64,
    zeitpunkt: &str,
) -> Result<BuchungErgebnis, String> {
    let alt = aenderbare_buchung(tx, id, "storniert").await?;
    let alt_datum = feld_text(&alt, "zahlungsdatum").unwrap_or_default();
    let bis = festgeschrieben_bis(tx).await?;
    let datum = if ist_festgeschrieben(&bis, &alt_datum) {
        heute
    } else {
        alt_datum.as_str()
    };
    if ist_festgeschrieben(&bis, datum) {
        return Err(festgeschrieben_meldung(&bis));
    }
    let nummer = nummern::vergeben_fortlaufend(tx, "buchung", jahr_heute).await?;
    // Übernommen wird alles, was die Wirkung der Buchung bestimmt (auch USt und Anlage), damit sich beide aufheben.
    let storno_id = sqlx::query(
        "INSERT INTO buchungen (nummer, typ, zahlungsdatum, betrag_cent, ust_satz, ust_cent, privatanteil_prozent,
           kategorie_id, kunde_id, lieferant, art, zahlungsart, belegnummer, beschreibung, anlage_id, storno_von_id,
           erstellt_am, geaendert_am)
         SELECT ?, typ, ?, betrag_cent, ust_satz, ust_cent, privatanteil_prozent,
           kategorie_id, kunde_id, lieferant, art, zahlungsart, nummer, 'Storno von ' || nummer || ': ' || beschreibung,
           anlage_id, id, ?, ?
         FROM buchungen WHERE id = ?",
    )
    .bind(&nummer)
    .bind(datum)
    .bind(zeitpunkt)
    .bind(zeitpunkt)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_fehler)?
    .last_insert_rowid();
    let neu = zeile_json(tx, "buchungen", storno_id).await?;
    protokollieren(
        tx,
        zeitpunkt,
        "buchungen",
        storno_id,
        "neu",
        None,
        neu.as_ref(),
    )
    .await?;
    let mut vermerk = Map::new();
    vermerk.insert("storniert_durch".into(), storno_id.into());
    vermerk.insert("storno_nummer".into(), nummer.clone().into());
    protokollieren(
        tx,
        zeitpunkt,
        "buchungen",
        id,
        "storniert",
        None,
        Some(&vermerk),
    )
    .await?;
    let kunde_id = feld_i64(&alt, "kunde_id");
    let kunde_nummer = match kunde_id {
        Some(k) => kunden_nummer(tx, k).await?,
        None => None,
    };
    Ok(BuchungErgebnis {
        id: storno_id,
        nummer,
        kunde_id,
        kunde_nummer,
        kunde_neu: false,
    })
}

/* ---------- Tauri-Commands (dünne Hüllen) ---------- */

async fn verbindung(
    instanzen: &DbInstances,
) -> Result<sqlx::pool::PoolConnection<sqlx::Sqlite>, String> {
    datenbank::pool(instanzen)
        .await?
        .acquire()
        .await
        .map_err(db_fehler)
}

/// Frontend: `invoke('buchung_anlegen', { daten })`.
#[tauri::command]
pub async fn buchung_anlegen(
    instanzen: tauri::State<'_, DbInstances>,
    daten: BuchungEingabe,
) -> Result<BuchungErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    anlegen(&mut c, &daten, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('buchung_aendern', { id, daten })`.
#[tauri::command]
pub async fn buchung_aendern(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    daten: BuchungEingabe,
) -> Result<BuchungErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    aendern(&mut c, id, &daten, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('buchung_stornieren', { id, heute })`.
#[tauri::command]
pub async fn buchung_stornieren(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    heute: String,
) -> Result<BuchungErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    stornieren(&mut c, id, &heute, &datenbank::zeitstempel()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::datenbank::testhilfe::test_db;

    const JETZT: &str = "2026-10-15T08:00:00Z";
    const SPAETER: &str = "2026-10-16T09:30:00Z";

    fn einnahme() -> BuchungEingabe {
        BuchungEingabe {
            typ: "einnahme".into(),
            zahlungsdatum: "2026-10-14".into(),
            belegdatum: None,
            betrag_cent: 12_000,
            privatanteil_prozent: 0,
            kategorie_id: 1,
            kunde_id: None,
            neuer_kunde: None,
            lieferant: None,
            zahlungsart: "bar".into(),
            belegnummer: None,
            beschreibung: " Rasen mähen ".into(),
            heute: "2026-10-15".into(),
        }
    }

    fn ausgabe() -> BuchungEingabe {
        BuchungEingabe {
            typ: "ausgabe".into(),
            kategorie_id: 3,
            lieferant: Some(" Aral Tankstelle ".into()),
            belegnummer: Some("  ".into()),
            zahlungsart: "bank".into(),
            beschreibung: "Diesel".into(),
            betrag_cent: 6_543,
            ..einnahme()
        }
    }

    async fn anzahl(c: &mut SqliteConnection, sql: &str) -> i64 {
        sqlx::query_scalar(sql).fetch_one(c).await.unwrap()
    }

    async fn kreis(c: &mut SqliteConnection, id: &str) -> (i64, i64) {
        sqlx::query_as("SELECT jahr, naechste FROM nummernkreise WHERE id = ?")
            .bind(id)
            .fetch_one(c)
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

    fn lauf<F: std::future::Future<Output = ()>>(f: F) {
        tauri::async_runtime::block_on(f);
    }

    #[test]
    fn datum_pruefen() {
        assert_eq!(datum_lesen("D", "2026-02-28"), Ok((2026, 2, 28)));
        assert_eq!(datum_lesen("D", "2024-02-29"), Ok((2024, 2, 29)));
        assert_eq!(datum_lesen("D", "2000-02-29"), Ok((2000, 2, 29)));
        for falsch in [
            "2026-02-29",
            "1900-02-29",
            "2026-13-01",
            "2026-00-10",
            "2026-04-31",
            "2026-1-01",
            "26-01-01",
            "2026/01/01",
            "",
            "2026-01-01 ",
            "0999-01-01",
            "２０２６-01-01",
        ] {
            assert!(datum_lesen("Zahlungsdatum", falsch).is_err(), "{falsch}");
        }
        assert_eq!(
            datum_lesen("Zahlungsdatum", "2026-02-30").unwrap_err(),
            "Zahlungsdatum „2026-02-30“ ist kein gültiges Datum."
        );
        assert_eq!(datum_de("2025-12-31"), "31.12.2025");
    }

    #[test]
    fn anlegen_mit_und_ohne_neuen_kunden() {
        lauf(async {
            let mut c = test_db().await;
            let e1 = anlegen(
                &mut c,
                &BuchungEingabe {
                    neuer_kunde: Some("  Anna Schmidt ".into()),
                    ..einnahme()
                },
                JETZT,
            )
            .await
            .unwrap();
            assert_eq!(e1.nummer, "2026-0001");
            assert_eq!(e1.kunde_nummer.as_deref(), Some("K-0001"));
            assert!(e1.kunde_neu);
            let kunde_id = e1.kunde_id.unwrap();

            let e2 = anlegen(&mut c, &ausgabe(), JETZT).await.unwrap();
            assert_eq!(
                e2,
                BuchungErgebnis {
                    id: e2.id,
                    nummer: "2026-0002".into(),
                    kunde_id: None,
                    kunde_nummer: None,
                    kunde_neu: false
                }
            );

            // vorhandener Kunde
            let e3 = anlegen(
                &mut c,
                &BuchungEingabe {
                    kunde_id: Some(kunde_id),
                    ..einnahme()
                },
                JETZT,
            )
            .await
            .unwrap();
            assert_eq!(e3.nummer, "2026-0003");
            assert_eq!(e3.kunde_nummer.as_deref(), Some("K-0001"));
            assert!(!e3.kunde_neu);

            let (name, nummer, erstellt): (String, String, String) =
                sqlx::query_as("SELECT name, nummer, erstellt_am FROM kunden WHERE id = ?")
                    .bind(kunde_id)
                    .fetch_one(&mut c)
                    .await
                    .unwrap();
            assert_eq!(
                (name.as_str(), nummer.as_str(), erstellt.as_str()),
                ("Anna Schmidt", "K-0001", JETZT)
            );

            let zeile: (String, String, i64, Option<String>, Option<String>, String, String, String, String) =
                sqlx::query_as(
                    "SELECT typ, art, betrag_cent, lieferant, belegnummer, beschreibung, zahlungsart, erstellt_am, geaendert_am
                     FROM buchungen WHERE id = ?",
                )
                .bind(e2.id)
                .fetch_one(&mut c)
                .await
                .unwrap();
            assert_eq!(
                zeile,
                (
                    "ausgabe".into(),
                    "zahlung".into(),
                    6_543,
                    Some("Aral Tankstelle".into()),
                    None,
                    "Diesel".into(),
                    "bank".into(),
                    JETZT.into(),
                    JETZT.into()
                )
            );

            let p = protokoll(&mut c).await;
            assert_eq!(p.len(), 4);
            assert_eq!(
                (p[0].0.as_str(), p[0].1, p[0].2.as_str()),
                ("kunden", kunde_id, "neu")
            );
            assert_eq!(
                (p[1].0.as_str(), p[1].1, p[1].2.as_str()),
                ("buchungen", e1.id, "neu")
            );
            assert!(p[1].3.is_none());
            let neu = json(&p[1].4);
            assert_eq!(neu["nummer"], "2026-0001");
            assert_eq!(neu["betrag_cent"], 12_000);
            assert_eq!(neu["kunde_id"], kunde_id);
            assert_eq!(neu["beschreibung"], "Rasen mähen");
            assert_eq!(neu["storno_von_id"], Value::Null);
            assert!(neu.as_object().unwrap().contains_key("geaendert_am"));
            assert_eq!(kreis(&mut c, "buchung").await, (2026, 4));
            assert_eq!(kreis(&mut c, "kunde").await, (0, 2));
        });
    }

    #[test]
    fn buchungsnummer_im_januar_fuer_dezember() {
        lauf(async {
            let mut c = test_db().await;
            let alt = anlegen(&mut c, &einnahme(), JETZT).await.unwrap();
            assert_eq!(alt.nummer, "2026-0001");
            // Zahlung vom Dezember, erfasst im Januar: Nummer des neuen Jahres
            let jan = BuchungEingabe {
                zahlungsdatum: "2026-12-30".into(),
                heute: "2027-01-05".into(),
                ..einnahme()
            };
            assert_eq!(
                anlegen(&mut c, &jan, JETZT).await.unwrap().nummer,
                "2027-0001"
            );
            // falsche Rechneruhr (zurück in 2026): Nummern laufen trotzdem nicht zurück
            assert_eq!(
                anlegen(&mut c, &einnahme(), JETZT).await.unwrap().nummer,
                "2027-0002"
            );
        });
    }

    #[test]
    fn pruefungen() {
        lauf(async {
            let mut c = test_db().await;
            let faelle: Vec<(BuchungEingabe, &str)> = vec![
                (
                    BuchungEingabe {
                        kategorie_id: 2,
                        ..einnahme()
                    },
                    "passt nicht zu Einnahmen",
                ),
                (
                    BuchungEingabe {
                        kategorie_id: 1,
                        ..ausgabe()
                    },
                    "passt nicht zu Ausgaben",
                ),
                (
                    BuchungEingabe {
                        kategorie_id: 99,
                        ..einnahme()
                    },
                    "gibt es nicht",
                ),
                (
                    BuchungEingabe {
                        kunde_id: Some(1),
                        ..ausgabe()
                    },
                    "nur bei Einnahmen",
                ),
                (
                    BuchungEingabe {
                        neuer_kunde: Some("Bob".into()),
                        ..ausgabe()
                    },
                    "nur bei Einnahmen",
                ),
                (
                    BuchungEingabe {
                        lieferant: Some("Aral".into()),
                        ..einnahme()
                    },
                    "nur bei Ausgaben",
                ),
                (
                    BuchungEingabe {
                        kunde_id: Some(1),
                        neuer_kunde: Some("Bob".into()),
                        ..einnahme()
                    },
                    "Entweder",
                ),
                (
                    BuchungEingabe {
                        kunde_id: Some(42),
                        ..einnahme()
                    },
                    "Kunden gibt es nicht",
                ),
                (
                    BuchungEingabe {
                        betrag_cent: 0,
                        ..einnahme()
                    },
                    "größer als 0",
                ),
                (
                    BuchungEingabe {
                        betrag_cent: -5,
                        ..einnahme()
                    },
                    "größer als 0",
                ),
                (
                    BuchungEingabe {
                        privatanteil_prozent: 101,
                        ..einnahme()
                    },
                    "Privatanteil",
                ),
                (
                    BuchungEingabe {
                        zahlungsdatum: "2026-02-30".into(),
                        ..einnahme()
                    },
                    "kein gültiges Datum",
                ),
                (
                    BuchungEingabe {
                        belegdatum: Some("gestern".into()),
                        ..einnahme()
                    },
                    "Belegdatum",
                ),
                (
                    BuchungEingabe {
                        heute: "".into(),
                        ..einnahme()
                    },
                    "Heutiges Datum",
                ),
                (
                    BuchungEingabe {
                        zahlungsart: "karte".into(),
                        ..einnahme()
                    },
                    "Zahlungsweg",
                ),
                (
                    BuchungEingabe {
                        typ: "umbuchung".into(),
                        ..einnahme()
                    },
                    "Typ",
                ),
                (
                    BuchungEingabe {
                        beschreibung: "   ".into(),
                        ..einnahme()
                    },
                    "Beschreibung",
                ),
            ];
            for (d, teil) in faelle {
                let f = anlegen(&mut c, &d, JETZT).await.unwrap_err();
                assert!(f.contains(teil), "„{f}“ enthält nicht „{teil}“");
            }
            // archivierte Kategorie
            sqlx::query("UPDATE kategorien SET archiviert = 1 WHERE id = 4")
                .execute(&mut c)
                .await
                .unwrap();
            let f = anlegen(
                &mut c,
                &BuchungEingabe {
                    kategorie_id: 4,
                    ..ausgabe()
                },
                JETZT,
            )
            .await
            .unwrap_err();
            assert!(f.contains("archiviert"));
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM buchungen").await, 0);
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM protokoll").await, 0);
            assert_eq!(kreis(&mut c, "buchung").await, (0, 1));
        });
    }

    #[test]
    fn fehler_mitten_in_der_transaktion_hinterlaesst_nichts() {
        lauf(async {
            let mut c = test_db().await;
            // Kaputtes Muster: Die Buchungsnummer scheitert, NACHDEM der neue Kunde schon angelegt ist.
            sqlx::query("UPDATE nummernkreise SET muster = 'X' WHERE id = 'buchung'")
                .execute(&mut c)
                .await
                .unwrap();
            let d = BuchungEingabe {
                neuer_kunde: Some("Anna Schmidt".into()),
                ..einnahme()
            };
            let f = anlegen(&mut c, &d, JETZT).await.unwrap_err();
            assert!(f.contains("Ungültiges Muster"), "{f}");
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM kunden").await, 0);
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM buchungen").await, 0);
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM protokoll").await, 0);
            assert_eq!(
                kreis(&mut c, "kunde").await,
                (0, 1),
                "Kundenkreis nicht weitergezählt"
            );
            // danach geht es normal weiter, ohne Lücke
            sqlx::query("UPDATE nummernkreise SET muster = '{JJJJ}-{NNNN}' WHERE id = 'buchung'")
                .execute(&mut c)
                .await
                .unwrap();
            let e = anlegen(&mut c, &d, JETZT).await.unwrap();
            assert_eq!(
                (e.nummer.as_str(), e.kunde_nummer.as_deref()),
                ("2026-0001", Some("K-0001"))
            );
        });
    }

    #[test]
    fn festgeschriebener_zeitraum() {
        lauf(async {
            let mut c = test_db().await;
            let alt = anlegen(
                &mut c,
                &BuchungEingabe {
                    zahlungsdatum: "2025-12-20".into(),
                    ..einnahme()
                },
                JETZT,
            )
            .await
            .unwrap();
            let offen = anlegen(&mut c, &einnahme(), JETZT).await.unwrap();
            sqlx::query("INSERT INTO festschreibungen (bis_datum, am) VALUES ('2025-12-31', ?)")
                .bind(JETZT)
                .execute(&mut c)
                .await
                .unwrap();
            let f = anlegen(
                &mut c,
                &BuchungEingabe {
                    zahlungsdatum: "2025-12-31".into(),
                    ..einnahme()
                },
                JETZT,
            )
            .await
            .unwrap_err();
            assert_eq!(f, "Der Zeitraum bis 31.12.2025 ist festgeschrieben.");
            // alte Buchung ändern: nein
            let f = aendern(
                &mut c,
                alt.id,
                &BuchungEingabe {
                    betrag_cent: 1,
                    ..einnahme()
                },
                SPAETER,
            )
            .await
            .unwrap_err();
            assert!(f.contains("festgeschrieben"), "{f}");
            // offene Buchung in den festgeschriebenen Zeitraum verschieben: nein
            let f = aendern(
                &mut c,
                offen.id,
                &BuchungEingabe {
                    zahlungsdatum: "2025-06-01".into(),
                    ..einnahme()
                },
                SPAETER,
            )
            .await
            .unwrap_err();
            assert!(f.contains("festgeschrieben"), "{f}");
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM buchungen").await, 2);
            assert_eq!(kreis(&mut c, "buchung").await, (2026, 3));
        });
    }

    #[test]
    fn aendern_protokolliert_nur_geaenderte_felder() {
        lauf(async {
            let mut c = test_db().await;
            let e = anlegen(&mut c, &ausgabe(), JETZT).await.unwrap();
            // nichts geändert (nur Leerraum): kein UPDATE, kein Protokoll
            let gleich = BuchungEingabe {
                beschreibung: " Diesel ".into(),
                ..ausgabe()
            };
            let r = aendern(&mut c, e.id, &gleich, SPAETER).await.unwrap();
            assert_eq!((r.id, r.nummer.as_str()), (e.id, "2026-0001"));
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM protokoll").await, 1);
            let geaendert_am: String = sqlx::query_scalar("SELECT geaendert_am FROM buchungen")
                .fetch_one(&mut c)
                .await
                .unwrap();
            assert_eq!(geaendert_am, JETZT);

            let neu = BuchungEingabe {
                betrag_cent: 7_000,
                lieferant: None,
                belegnummer: Some("R-77".into()),
                ..ausgabe()
            };
            let r = aendern(&mut c, e.id, &neu, SPAETER).await.unwrap();
            assert_eq!(r.nummer, "2026-0001", "Nummer bleibt");
            let p = protokoll(&mut c).await;
            assert_eq!(p.len(), 2);
            assert_eq!(
                (p[1].0.as_str(), p[1].1, p[1].2.as_str()),
                ("buchungen", e.id, "geaendert")
            );
            assert_eq!(
                json(&p[1].3),
                serde_json::json!({"betrag_cent": 6543, "lieferant": "Aral Tankstelle", "belegnummer": null})
            );
            assert_eq!(
                json(&p[1].4),
                serde_json::json!({"betrag_cent": 7000, "lieferant": null, "belegnummer": "R-77"})
            );
            let (betrag, geaendert_am, erstellt_am): (i64, String, String) =
                sqlx::query_as("SELECT betrag_cent, geaendert_am, erstellt_am FROM buchungen")
                    .fetch_one(&mut c)
                    .await
                    .unwrap();
            assert_eq!(
                (betrag, geaendert_am.as_str(), erstellt_am.as_str()),
                (7_000, SPAETER, JETZT)
            );

            // Umwandeln in eine Einnahme mit neuem Kunden
            let r = aendern(
                &mut c,
                e.id,
                &BuchungEingabe {
                    neuer_kunde: Some("Bob Bauer".into()),
                    ..einnahme()
                },
                SPAETER,
            )
            .await
            .unwrap();
            assert_eq!(r.kunde_nummer.as_deref(), Some("K-0001"));
            assert!(r.kunde_neu);
            let p = protokoll(&mut c).await;
            assert_eq!(p.len(), 4);
            assert_eq!((p[2].0.as_str(), p[2].2.as_str()), ("kunden", "neu"));
            assert_eq!(json(&p[3].4)["typ"], "einnahme");
            assert_eq!(json(&p[3].4)["kunde_id"], r.kunde_id.unwrap());

            assert!(
                aendern(&mut c, 999, &einnahme(), SPAETER)
                    .await
                    .unwrap_err()
                    .contains("gibt es nicht")
            );
        });
    }

    #[test]
    fn archivierte_kategorie_bleibt_beim_aendern_erlaubt() {
        lauf(async {
            let mut c = test_db().await;
            let e = anlegen(
                &mut c,
                &BuchungEingabe {
                    kategorie_id: 4,
                    ..ausgabe()
                },
                JETZT,
            )
            .await
            .unwrap();
            sqlx::query("UPDATE kategorien SET archiviert = 1 WHERE id = 4")
                .execute(&mut c)
                .await
                .unwrap();
            aendern(
                &mut c,
                e.id,
                &BuchungEingabe {
                    kategorie_id: 4,
                    betrag_cent: 1,
                    ..ausgabe()
                },
                SPAETER,
            )
            .await
            .unwrap();
        });
    }

    #[test]
    fn aendern_verweigert_storno_storniert_und_beleg() {
        lauf(async {
            let mut c = test_db().await;
            let e = anlegen(&mut c, &einnahme(), JETZT).await.unwrap();
            let s = stornieren(&mut c, e.id, "2026-10-16", SPAETER)
                .await
                .unwrap();
            let f = aendern(&mut c, e.id, &einnahme(), SPAETER)
                .await
                .unwrap_err();
            assert!(f.contains("bereits storniert (2026-0002)"), "{f}");
            let f = aendern(&mut c, s.id, &einnahme(), SPAETER)
                .await
                .unwrap_err();
            assert!(f.contains("selbst ein Storno"), "{f}");

            let b = anlegen(&mut c, &einnahme(), JETZT).await.unwrap();
            sqlx::query(
                "INSERT INTO rechnungen (id, art, nummer, status, erstellt_am, geaendert_am)
                 VALUES (1, 'quittung', 'QU-2026-001', 'bezahlt', ?, ?)",
            )
            .bind(JETZT)
            .bind(JETZT)
            .execute(&mut c)
            .await
            .unwrap();
            sqlx::query("UPDATE buchungen SET rechnung_id = 1 WHERE id = ?")
                .bind(b.id)
                .execute(&mut c)
                .await
                .unwrap();
            let f = aendern(&mut c, b.id, &einnahme(), SPAETER)
                .await
                .unwrap_err();
            assert!(f.contains("nur per Storno des Belegs änderbar"), "{f}");
            let f = stornieren(&mut c, b.id, "2026-10-16", SPAETER)
                .await
                .unwrap_err();
            assert!(f.contains("nur per Storno des Belegs änderbar"), "{f}");

            sqlx::query("UPDATE buchungen SET art = 'afa', zahlungsart = NULL, rechnung_id = NULL WHERE id = ?")
                .bind(b.id)
                .execute(&mut c)
                .await
                .unwrap();
            let f = aendern(&mut c, b.id, &einnahme(), SPAETER)
                .await
                .unwrap_err();
            assert!(f.contains("Abschreibung oder Pauschale"), "{f}");
        });
    }

    #[test]
    fn stornieren_legt_gegenbuchung_an() {
        lauf(async {
            let mut c = test_db().await;
            let e = anlegen(
                &mut c,
                &BuchungEingabe {
                    neuer_kunde: Some("Anna".into()),
                    privatanteil_prozent: 10,
                    ..einnahme()
                },
                JETZT,
            )
            .await
            .unwrap();
            let s = stornieren(&mut c, e.id, "2026-10-16", SPAETER)
                .await
                .unwrap();
            assert_eq!(s.nummer, "2026-0002");
            assert_eq!(
                (s.kunde_id, s.kunde_nummer.as_deref(), s.kunde_neu),
                (e.kunde_id, Some("K-0001"), false)
            );
            let zeile = Value::Object(
                zeile_json(&mut c, "buchungen", s.id)
                    .await
                    .unwrap()
                    .unwrap(),
            );
            for (feld, wert) in [
                ("typ", serde_json::json!("einnahme")),
                ("zahlungsdatum", serde_json::json!("2026-10-14")),
                ("betrag_cent", serde_json::json!(12_000)),
                ("privatanteil_prozent", serde_json::json!(10)),
                ("kategorie_id", serde_json::json!(1)),
                ("kunde_id", serde_json::json!(e.kunde_id)),
                ("zahlungsart", serde_json::json!("bar")),
                ("art", serde_json::json!("zahlung")),
                ("belegnummer", serde_json::json!("2026-0001")),
                (
                    "beschreibung",
                    serde_json::json!("Storno von 2026-0001: Rasen mähen"),
                ),
                ("storno_von_id", serde_json::json!(e.id)),
                ("erstellt_am", serde_json::json!(SPAETER)),
            ] {
                assert_eq!(zeile[feld], wert, "{feld}");
            }
            // Summe nach der Vorzeichen-Regel: hebt sich auf
            let summe = anzahl(
                &mut c,
                "SELECT SUM(CASE WHEN storno_von_id IS NULL THEN betrag_cent ELSE -betrag_cent END) FROM buchungen",
            )
            .await;
            assert_eq!(summe, 0);

            let p = protokoll(&mut c).await;
            assert_eq!(p.len(), 4); // kunde neu, buchung neu, storno neu, original storniert
            assert_eq!((p[2].1, p[2].2.as_str()), (s.id, "neu"));
            assert_eq!(json(&p[2].4)["storno_von_id"], e.id);
            assert_eq!(
                (p[3].0.as_str(), p[3].1, p[3].2.as_str()),
                ("buchungen", e.id, "storniert")
            );
            assert!(p[3].3.is_none());
            assert_eq!(
                json(&p[3].4),
                serde_json::json!({"storniert_durch": s.id, "storno_nummer": "2026-0002"})
            );

            // doppelt stornieren, Storno stornieren: nein
            let f = stornieren(&mut c, e.id, "2026-10-16", SPAETER)
                .await
                .unwrap_err();
            assert!(f.contains("bereits storniert"), "{f}");
            let f = stornieren(&mut c, s.id, "2026-10-16", SPAETER)
                .await
                .unwrap_err();
            assert!(f.contains("selbst ein Storno"), "{f}");
            assert!(
                stornieren(&mut c, 999, "2026-10-16", SPAETER)
                    .await
                    .unwrap_err()
                    .contains("gibt es nicht")
            );
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM buchungen").await, 2);
            assert_eq!(kreis(&mut c, "buchung").await, (2026, 3));
        });
    }

    #[test]
    fn storno_im_festgeschriebenen_zeitraum_mit_heutigem_datum() {
        lauf(async {
            let mut c = test_db().await;
            let e = anlegen(
                &mut c,
                &BuchungEingabe {
                    zahlungsdatum: "2025-12-20".into(),
                    ..ausgabe()
                },
                JETZT,
            )
            .await
            .unwrap();
            sqlx::query("INSERT INTO festschreibungen (bis_datum, am) VALUES ('2025-12-31', ?)")
                .bind(JETZT)
                .execute(&mut c)
                .await
                .unwrap();
            let s = stornieren(&mut c, e.id, "2026-10-16", SPAETER)
                .await
                .unwrap();
            let datum: String =
                sqlx::query_scalar("SELECT zahlungsdatum FROM buchungen WHERE id = ?")
                    .bind(s.id)
                    .fetch_one(&mut c)
                    .await
                    .unwrap();
            assert_eq!(datum, "2026-10-16");
            // heute selbst festgeschrieben (sollte nie vorkommen): abgelehnt
            let e2 = anlegen(&mut c, &ausgabe(), JETZT).await.unwrap();
            sqlx::query("INSERT INTO festschreibungen (bis_datum, am) VALUES ('2026-12-31', ?)")
                .bind(JETZT)
                .execute(&mut c)
                .await
                .unwrap();
            assert!(
                stornieren(&mut c, e2.id, "2026-10-16", SPAETER)
                    .await
                    .unwrap_err()
                    .contains("festgeschrieben")
            );
            assert!(
                stornieren(&mut c, e2.id, "16.10.2026", SPAETER)
                    .await
                    .unwrap_err()
                    .contains("kein gültiges Datum")
            );
        });
    }

    #[test]
    fn eingabe_aus_json() {
        // so schickt das Frontend die Daten (fehlende Option-Felder ⇒ None, unbekannte Felder ⇒ Fehler)
        let d: BuchungEingabe = serde_json::from_value(serde_json::json!({
            "typ": "ausgabe", "zahlungsdatum": "2026-10-14", "betrag_cent": 4783, "privatanteil_prozent": 0,
            "kategorie_id": 2, "lieferant": "Bauhaus", "zahlungsart": "bank", "beschreibung": "Erde", "heute": "2026-10-15"
        }))
        .unwrap();
        assert_eq!(d.lieferant.as_deref(), Some("Bauhaus"));
        assert!(d.kunde_id.is_none() && d.belegdatum.is_none());
        let falsch = serde_json::from_value::<BuchungEingabe>(serde_json::json!({
            "typ": "ausgabe", "zahlungsdatum": "2026-10-14", "betrag_cent": 1, "privatanteil_prozent": 0,
            "kategorie_id": 2, "zahlungsart": "bank", "beschreibung": "x", "heute": "2026-10-15", "betrag": 1
        }));
        assert!(falsch.is_err());
        let aus = serde_json::to_value(BuchungErgebnis {
            id: 3,
            nummer: "2026-0003".into(),
            kunde_id: Some(1),
            kunde_nummer: Some("K-0001".into()),
            kunde_neu: true,
        })
        .unwrap();
        assert_eq!(
            aus,
            serde_json::json!({"id": 3, "nummer": "2026-0003", "kunde_id": 1, "kunde_nummer": "K-0001", "kunde_neu": true})
        );
    }
}
