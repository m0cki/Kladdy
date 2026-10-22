//! Termine (ANLEITUNG §6.5): eintragen und ändern (samt vorbereitetem Beleg), abhaken, „Doch nicht erledigt“,
//! „Ohne Beleg abschließen“, absagen, wieder einplanen, Rückgängig und Löschen abgesagter Termine.
//! Jeder Vorgang läuft in EINER Transaktion samt GoBD-Protokoll (CLAUDE.md, wie rechnungen.rs).
//!
//! - Vorbereiteter Beleg = Entwurf ohne Nummer mit `rechnungen.termin_id` (rechnungen::vorbereitung_schreiben_in).
//!   Die Nummer kommt erst beim Ausstellen über die Erfassen-Schublade (`beleg_ausstellen` mit der Entwurfs-ID hakt
//!   den Termin ab, `mit_beleg_erledigen_in`). Absagen bzw. „Ohne Beleg“ verwerfen den Entwurf – kein Storno nötig,
//!   er hatte noch keine Nummer (Protokoll 'geloescht_entwurf'). Für „Rückgängig“ geht er im Ergebnis mit
//!   (`verworfen`) und kommt über `termin_zuruecksetzen` neu angelegt zurück.
//! - Abhaken und Beleg sind zwei Schritte: `termin_erledigt` (nur heute und Vergangenes) markiert nur den Termin.
//! - Die anderen Wege der Erfassen-Schublade schließen den Termin in ihrer Transaktion ab (`abschliessen_in`):
//!   „Ohne eigenen Beleg“ (buchungen.rs: Einnahme mit `termin_id`, `ohne_beleg` = 1) und „Offene Rechnung zuordnen“
//!   (rechnungen::bezahlt: die Einnahme verweist auf den Termin, die ausgestellte Rechnung bleibt unverändert).
//! - Ein Besuch zählt nur einmal: Zu einem Termin gibt es höchstens einen gültigen Beleg bzw. eine Einnahme
//!   (`abschluss_pruefen`). Ausgestellte Belege werden hier nie angefasst (GoBD).
//!
//! Die Kernfunktionen nehmen eine Verbindung (Tests gegen eine migrierte Datenbank im Arbeitsspeicher), die
//! `#[tauri::command]`-Funktionen sind dünne Hüllen.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::SqliteConnection;
use tauri_plugin_sql::DbInstances;

use crate::buchungen::{
    datum_de, datum_lesen, in_transaktion, protokollieren, verbindung, zeile_json,
};
use crate::datenbank::{self, db_fehler};
use crate::kunden;
use crate::rechnungen::{self, Anschrift, EntwurfEingabe};

/// Höchstbetrag (100 Mio. €), wie MAX_CENT im Frontend.
const MAX_CENT: i64 = 10_000_000_000;

const FEHLT_KUNDE: &str = "Bitte einen Kunden angeben.";
const KUNDE_DOPPELT: &str = "Entweder einen vorhandenen Kunden wählen oder einen neuen anlegen.";
const FEHLT_LEISTUNG: &str = "Bitte die Leistung angeben – was wird gemacht?";
const ENTWURF_FEHLT: &str = "Der vorbereitete Beleg fehlt.";
const ENTWURF_UNPASSEND: &str = "Der Entwurf passt nicht zur Wahl beim Beleg.";
const ABGESAGT_OHNE_BELEG: &str = "Ein abgesagter Termin bekommt keinen Beleg.";
const NUR_ABGESAGTE: &str = "Wieder einplanen lassen sich nur abgesagte Termine.";
const ERST_AM_TAG: &str = "Abhaken geht erst am Tag des Termins.";
const RUECKGAENGIG_ZU_SPAET: &str = "Rückgängig geht nicht mehr – es gibt schon einen Beleg.";
const BELEG_WAHL: &[&str] = &["quittung", "rechnung", "keinen", "behalten"];
const STATUS: &[&str] = &["geplant", "erledigt", "abgesagt"];

/* ---------- Eingaben und Antworten ---------- */

/// Eingabe aus der Termin-Schublade (src/lib/termine.ts → TerminDaten). Feldnamen exakt so (snake_case).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerminEingabe {
    /// gewählter Kunde
    #[serde(default)]
    pub kunde_id: Option<i64>,
    /// Name eines neuen Kunden (wird mit der Adresse des Termins angelegt), schließt kunde_id aus
    #[serde(default)]
    pub neuer_kunde: Option<String>,
    /// 'YYYY-MM-DD'
    pub datum: String,
    /// 'HH:MM'
    #[serde(default)]
    pub von: Option<String>,
    #[serde(default)]
    pub bis: Option<String>,
    /// Zeilen mit \n („Straße 1\n12345 Ort“)
    #[serde(default)]
    pub adresse: Option<String>,
    pub leistung: String,
    /// geschätzter Betrag in Cent (leer bzw. 0 = keiner)
    #[serde(default)]
    pub betrag_geschaetzt_cent: Option<i64>,
    #[serde(default)]
    pub notiz: Option<String>,
    /// „Beleg vorbereiten“: 'quittung' | 'rechnung' (mit Entwurf) · 'keinen' (verwerfen) · 'behalten'
    pub beleg: String,
    /// abgesagten Termin wieder einplanen
    #[serde(default)]
    pub wieder_einplanen: bool,
    /// heutiges lokales Datum 'YYYY-MM-DD' (Jahr für die Kundennummer)
    pub heute: String,
}

/// Stand eines Termins vor einem Vorgang (für „Rückgängig“ über `termin_zuruecksetzen`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerminStand {
    /// 'geplant' | 'erledigt' | 'abgesagt'
    pub status: String,
    pub ohne_beleg: bool,
    #[serde(default)]
    pub notiz: Option<String>,
}

/// Antwort an das Frontend.
#[derive(Debug, Clone, Default, Serialize)]
pub struct TerminErgebnis {
    pub id: i64,
    pub status: String,
    pub ohne_beleg: bool,
    pub kunde_id: Option<i64>,
    pub kunde_nummer: Option<String>,
    /// Kunde in diesem Vorgang neu angelegt
    pub kunde_neu: bool,
    /// vorbereiteter Entwurf nach dem Vorgang
    pub entwurf_id: Option<i64>,
    /// 'neu' | 'geaendert' (Entwurf angelegt bzw. angeglichen)
    pub entwurf_aktion: Option<String>,
    /// verworfene Entwürfe (für „Rückgängig“)
    pub verworfen: Vec<EntwurfEingabe>,
    /// Stand vor dem Vorgang (für „Rückgängig“)
    pub vorher: Option<TerminStand>,
}

/* ---------- Prüfen ohne Datenbank ---------- */

/// Geprüfte und bereinigte Eingabe.
#[derive(Debug, Clone)]
struct Termin {
    kunde_id: Option<i64>,
    neuer_kunde: Option<String>,
    datum: String,
    von: Option<String>,
    bis: Option<String>,
    adresse: Option<String>,
    leistung: String,
    betrag: Option<i64>,
    notiz: Option<String>,
    beleg: String,
    wieder_einplanen: bool,
    jahr_heute: i64,
}

/// 'HH:MM' ⇒ Minuten seit Mitternacht.
fn uhrzeit_lesen(feld: &str, text: &str) -> Result<i64, String> {
    let fehler = || format!("{feld} „{text}“ ist keine gültige Uhrzeit.");
    let b = text.as_bytes();
    if b.len() != 5 || b[2] != b':' {
        return Err(fehler());
    }
    let zweistellig = |x: u8, y: u8| -> Option<i64> {
        let z = char::from(x).to_digit(10)? * 10 + char::from(y).to_digit(10)?;
        Some(i64::from(z))
    };
    match (zweistellig(b[0], b[1]), zweistellig(b[3], b[4])) {
        (Some(h), Some(m)) if h < 24 && m < 60 => Ok(h * 60 + m),
        _ => Err(fehler()),
    }
}

/// Text getrimmt (Zeilenumbrüche bleiben), leer ⇒ None.
fn getrimmt(t: &Option<String>) -> Option<String> {
    t.as_deref()
        .map(|s| s.replace("\r\n", "\n").trim().to_string())
        .filter(|s| !s.is_empty())
}

fn pruefen(d: &TerminEingabe) -> Result<Termin, String> {
    let neuer_kunde = getrimmt(&d.neuer_kunde);
    if d.kunde_id.is_none() && neuer_kunde.is_none() {
        return Err(FEHLT_KUNDE.into());
    }
    if d.kunde_id.is_some() && neuer_kunde.is_some() {
        return Err(KUNDE_DOPPELT.into());
    }
    datum_lesen("Datum", &d.datum)?;
    let (jahr_heute, _, _) = datum_lesen("Heutiges Datum", &d.heute)?;
    let von = getrimmt(&d.von);
    let bis = getrimmt(&d.bis);
    let beginn = match &von {
        Some(v) => Some(uhrzeit_lesen("Beginn", v)?),
        None => None,
    };
    if let Some(b) = &bis {
        let ende = uhrzeit_lesen("Ende", b)?;
        match beginn {
            None => return Err("Bitte auch den Beginn angeben.".into()),
            Some(a) if ende <= a => return Err("Das Ende liegt vor dem Beginn.".into()),
            Some(_) => {}
        }
    }
    let leistung = d.leistung.trim().to_string();
    if leistung.is_empty() {
        return Err(FEHLT_LEISTUNG.into());
    }
    if let Some(c) = d.betrag_geschaetzt_cent
        && !(0..MAX_CENT).contains(&c)
    {
        return Err("Der geschätzte Betrag ist ungültig.".into());
    }
    if !BELEG_WAHL.contains(&d.beleg.as_str()) {
        return Err(format!("Unbekannte Wahl „{}“ beim Beleg.", d.beleg));
    }
    Ok(Termin {
        kunde_id: d.kunde_id,
        neuer_kunde,
        datum: d.datum.clone(),
        von,
        bis,
        adresse: getrimmt(&d.adresse),
        leistung,
        betrag: d.betrag_geschaetzt_cent.filter(|c| *c > 0),
        notiz: getrimmt(&d.notiz),
        beleg: d.beleg.clone(),
        wieder_einplanen: d.wieder_einplanen,
        jahr_heute,
    })
}

/// Notiz nach dem Absagen: der Grund wird angehängt („Abgesagt am 15.10.2026: Regen“).
fn notiz_mit_grund(notiz: Option<&str>, grund: Option<&str>, heute: &str) -> Option<String> {
    let grund = grund.map(str::trim).filter(|g| !g.is_empty());
    let Some(g) = grund else {
        return notiz.map(String::from);
    };
    let zeile = format!("Abgesagt am {}: {g}", datum_de(heute));
    let bisher = notiz.map(str::trim).filter(|n| !n.is_empty());
    let text = match bisher {
        Some(n) => format!("{n}\n{zeile}"),
        None => zeile,
    };
    Some(text)
}

/* ---------- Lesen und Hilfen ---------- */

fn text(m: &Map<String, Value>, k: &str) -> Option<String> {
    m.get(k).and_then(Value::as_str).map(String::from)
}

fn zahl(m: &Map<String, Value>, k: &str) -> Option<i64> {
    m.get(k).and_then(Value::as_i64)
}

/// Stand aus der ganzen Zeile.
fn stand(z: &Map<String, Value>) -> TerminStand {
    TerminStand {
        status: text(z, "status").unwrap_or_default(),
        ohne_beleg: zahl(z, "ohne_beleg").unwrap_or_default() != 0,
        notiz: text(z, "notiz"),
    }
}

/// Ganze Zeile eines Termins; Fehler, wenn es ihn nicht gibt.
async fn termin_lesen(tx: &mut SqliteConnection, id: i64) -> Result<Map<String, Value>, String> {
    let Some(z) = zeile_json(tx, "termine", id).await? else {
        return Err("Diesen Termin gibt es nicht (mehr).".into());
    };
    Ok(z)
}

/// Gültiger Beleg zum Termin (ausgestellt, nicht storniert): am Termin selbst oder die bezahlte Rechnung, deren
/// Einnahme auf den Termin verweist („Offene Rechnung zuordnen“). Gibt die Nummer zurück.
async fn beleg_nummer(tx: &mut SqliteConnection, id: i64) -> Result<Option<String>, String> {
    sqlx::query_scalar(
        "SELECT r.nummer FROM rechnungen r
          WHERE r.nummer IS NOT NULL AND r.status <> 'storniert'
            AND r.art IN ('quittung', 'rechnung')
            AND (r.termin_id = ?
                 OR r.id IN (SELECT b.rechnung_id FROM buchungen b WHERE b.termin_id = ?))
          ORDER BY r.id DESC LIMIT 1",
    )
    .bind(id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_fehler)
}

/// Gültige Einnahme zum Termin (nicht storniert, keine Gegenbuchung). Gibt die Buchungsnummer zurück.
async fn einnahme_nummer(tx: &mut SqliteConnection, id: i64) -> Result<Option<String>, String> {
    sqlx::query_scalar(
        "SELECT b.nummer FROM buchungen b
          WHERE b.termin_id = ? AND b.storno_von_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM buchungen s WHERE s.storno_von_id = b.id)
          ORDER BY b.id DESC LIMIT 1",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_fehler)
}

/// Vorbereiteter Entwurf (ohne Nummer) des Termins.
async fn entwurf_id(tx: &mut SqliteConnection, id: i64) -> Result<Option<i64>, String> {
    sqlx::query_scalar(
        "SELECT id FROM rechnungen WHERE termin_id = ? AND nummer IS NULL ORDER BY id LIMIT 1",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_fehler)
}

async fn kunden_nummer(tx: &mut SqliteConnection, id: i64) -> Result<Option<String>, String> {
    sqlx::query_scalar("SELECT nummer FROM kunden WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_fehler)
}

/// Verwirft die vorbereiteten Entwürfe (ohne Nummer) eines Termins; gibt sie für „Rückgängig“ zurück.
async fn verwerfen_in(
    tx: &mut SqliteConnection,
    id: i64,
    zeitpunkt: &str,
) -> Result<Vec<EntwurfEingabe>, String> {
    let ids: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM rechnungen WHERE termin_id = ? AND nummer IS NULL ORDER BY id",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_fehler)?;
    let mut verworfen = Vec::with_capacity(ids.len());
    for r in ids {
        verworfen.push(rechnungen::entwurf_eingabe_lesen(tx, r).await?);
        rechnungen::entwurf_loeschen_in(tx, r, zeitpunkt).await?;
    }
    Ok(verworfen)
}

/// Status, „ohne Beleg“ und Notiz setzen; protokolliert nur, was sich ändert.
async fn stand_setzen(
    tx: &mut SqliteConnection,
    id: i64,
    alt: &Map<String, Value>,
    neu: &TerminStand,
    zeitpunkt: &str,
) -> Result<(), String> {
    let vorher = stand(alt);
    if &vorher == neu {
        return Ok(());
    }
    sqlx::query(
        "UPDATE termine SET status = ?, ohne_beleg = ?, notiz = ?, geaendert_am = ?
         WHERE id = ?",
    )
    .bind(&neu.status)
    .bind(i64::from(neu.ohne_beleg))
    .bind(&neu.notiz)
    .bind(zeitpunkt)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_fehler)?;
    let mut diff_alt = Map::new();
    let mut diff_neu = Map::new();
    if vorher.status != neu.status {
        diff_alt.insert("status".into(), vorher.status.into());
        diff_neu.insert("status".into(), neu.status.clone().into());
    }
    if vorher.ohne_beleg != neu.ohne_beleg {
        diff_alt.insert("ohne_beleg".into(), i64::from(vorher.ohne_beleg).into());
        diff_neu.insert("ohne_beleg".into(), i64::from(neu.ohne_beleg).into());
    }
    if vorher.notiz != neu.notiz {
        diff_alt.insert("notiz".into(), vorher.notiz.into());
        diff_neu.insert("notiz".into(), neu.notiz.clone().into());
    }
    protokollieren(
        tx,
        zeitpunkt,
        "termine",
        id,
        "geaendert",
        Some(&diff_alt),
        Some(&diff_neu),
    )
    .await
}

/// Ergebnis mit dem aktuellen Stand des Termins.
async fn ergebnis(tx: &mut SqliteConnection, id: i64) -> Result<TerminErgebnis, String> {
    let z = termin_lesen(tx, id).await?;
    let s = stand(&z);
    let kunde_id = zahl(&z, "kunde_id");
    let kunde_nummer = match kunde_id {
        Some(k) => kunden_nummer(tx, k).await?,
        None => None,
    };
    Ok(TerminErgebnis {
        id,
        status: s.status,
        ohne_beleg: s.ohne_beleg,
        kunde_id,
        kunde_nummer,
        entwurf_id: entwurf_id(tx, id).await?,
        ..TerminErgebnis::default()
    })
}

/* ---------- Abschluss aus der Erfassen-Schublade und beim Ausstellen ---------- */

/// Darf eine Einnahme bzw. ein Beleg den Termin abschließen? Er muss existieren, darf nicht abgesagt sein und noch
/// keinen gültigen Beleg und keine Einnahme haben (ein Besuch zählt nur einmal).
pub(crate) async fn abschluss_pruefen(tx: &mut SqliteConnection, id: i64) -> Result<(), String> {
    let z = termin_lesen(tx, id).await?;
    let wann = datum_de(&text(&z, "datum").unwrap_or_default());
    if text(&z, "status").as_deref() == Some("abgesagt") {
        return Err(format!("Der Termin am {wann} ist abgesagt."));
    }
    if let Some(nr) = beleg_nummer(tx, id).await? {
        return Err(format!(
            "Zum Termin am {wann} gibt es schon den Beleg {nr}."
        ));
    }
    if let Some(nr) = einnahme_nummer(tx, id).await? {
        return Err(format!(
            "Zum Termin am {wann} ist schon eine Einnahme gebucht ({nr})."
        ));
    }
    Ok(())
}

/// Schließt den Termin mit einer Einnahme ab (in der Transaktion des Aufrufers, nach `abschluss_pruefen`): erledigt,
/// `ohne_beleg` je nach Weg, der vorbereitete Entwurf wird verworfen.
pub(crate) async fn abschliessen_in(
    tx: &mut SqliteConnection,
    id: i64,
    ohne_beleg: bool,
    zeitpunkt: &str,
) -> Result<Vec<EntwurfEingabe>, String> {
    let alt = termin_lesen(tx, id).await?;
    let verworfen = verwerfen_in(tx, id, zeitpunkt).await?;
    let neu = TerminStand {
        status: "erledigt".into(),
        ohne_beleg,
        notiz: text(&alt, "notiz"),
    };
    stand_setzen(tx, id, &alt, &neu, zeitpunkt).await?;
    Ok(verworfen)
}

/// Beleg zum Termin ausgestellt (rechnungen::ausstellen_in): Termin erledigt, ein „ohne Beleg“ ist hinfällig, weitere
/// Entwürfe ohne Nummer werden verworfen. Ein abgesagter Termin bleibt abgesagt.
pub(crate) async fn mit_beleg_erledigen_in(
    tx: &mut SqliteConnection,
    id: i64,
    zeitpunkt: &str,
) -> Result<(), String> {
    let alt = termin_lesen(tx, id).await?;
    if text(&alt, "status").as_deref() == Some("abgesagt") {
        return Ok(());
    }
    verwerfen_in(tx, id, zeitpunkt).await?;
    let neu = TerminStand {
        status: "erledigt".into(),
        ohne_beleg: false,
        notiz: text(&alt, "notiz"),
    };
    stand_setzen(tx, id, &alt, &neu, zeitpunkt).await
}

/* ---------- Eintragen und ändern ---------- */

/// Kunde des Termins: vorhandener (fehlt ihm die Anschrift, wird sie aus der Adresse des Termins ergänzt) oder neu
/// angelegt (mit dieser Adresse). Gibt (ID, neu?) zurück.
async fn kunde_festhalten(
    tx: &mut SqliteConnection,
    t: &Termin,
    zeitpunkt: &str,
) -> Result<(i64, bool), String> {
    let anschrift = Anschrift::lesen(t.adresse.as_deref().unwrap_or(""));
    if let Some(name) = &t.neuer_kunde {
        let stamm = kunden::Stammdaten {
            name: name.clone(),
            zusatz: anschrift.zusatz.clone(),
            strasse: anschrift.strasse.clone(),
            plz: anschrift.plz.clone(),
            ort: anschrift.ort.clone(),
            email: None,
            telefon: None,
            notiz: None,
        };
        let (id, _) = kunden::anlegen_in(tx, &stamm, t.jahr_heute, zeitpunkt).await?;
        return Ok((id, true));
    }
    let id = t.kunde_id.unwrap_or_default();
    let zeile: Option<(Option<String>, Option<String>)> =
        sqlx::query_as("SELECT strasse, ort FROM kunden WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_fehler)?;
    let Some((strasse, ort)) = zeile else {
        return Err("Den gewählten Kunden gibt es nicht.".into());
    };
    if strasse.is_none() && ort.is_none() && !anschrift.ist_leer() {
        rechnungen::anschrift_ergaenzen(tx, id, &anschrift, zeitpunkt).await?;
    }
    Ok((id, false))
}

/// Felder eines Termins ⇒ Werte (Protokoll und Vergleich). Feste Spaltennamen, nie Eingaben.
fn felder(t: &Termin, kunde_id: i64, status: &str) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("kunde_id".into(), kunde_id.into());
    m.insert("datum".into(), t.datum.clone().into());
    m.insert("von".into(), t.von.clone().into());
    m.insert("bis".into(), t.bis.clone().into());
    m.insert("adresse".into(), t.adresse.clone().into());
    m.insert("leistung".into(), t.leistung.clone().into());
    m.insert("betrag_geschaetzt_cent".into(), t.betrag.into());
    m.insert("notiz".into(), t.notiz.clone().into());
    m.insert("status".into(), status.into());
    m
}

/// Termin eintragen (`id` None) oder ändern, mit dem vorbereiteten Beleg (`entwurf` bei Quittung/Rechnung).
pub async fn speichern(
    conn: &mut SqliteConnection,
    id: Option<i64>,
    daten: &TerminEingabe,
    entwurf: Option<&EntwurfEingabe>,
    zeitpunkt: &str,
) -> Result<TerminErgebnis, String> {
    let t = pruefen(daten)?;
    let vorbereiten = t.beleg == "quittung" || t.beleg == "rechnung";
    match entwurf {
        None if vorbereiten => return Err(ENTWURF_FEHLT.into()),
        Some(_) if !vorbereiten => return Err(ENTWURF_UNPASSEND.into()),
        Some(e) if e.art != t.beleg => return Err("Die Belegart passt nicht.".into()),
        _ => {}
    }
    in_transaktion(conn, async |tx| {
        speichern_in(tx, id, &t, entwurf, zeitpunkt).await
    })
    .await
}

async fn speichern_in(
    tx: &mut SqliteConnection,
    id: Option<i64>,
    t: &Termin,
    entwurf: Option<&EntwurfEingabe>,
    zeitpunkt: &str,
) -> Result<TerminErgebnis, String> {
    let (kunde_id, kunde_neu) = kunde_festhalten(tx, t, zeitpunkt).await?;
    let (id, vorher) = match id {
        None => {
            let id = sqlx::query(
                "INSERT INTO termine (kunde_id, datum, von, bis, adresse, leistung,
                   betrag_geschaetzt_cent, notiz, status, ohne_beleg, erstellt_am, geaendert_am)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'geplant', 0, ?, ?)",
            )
            .bind(kunde_id)
            .bind(&t.datum)
            .bind(&t.von)
            .bind(&t.bis)
            .bind(&t.adresse)
            .bind(&t.leistung)
            .bind(t.betrag)
            .bind(&t.notiz)
            .bind(zeitpunkt)
            .bind(zeitpunkt)
            .execute(&mut *tx)
            .await
            .map_err(db_fehler)?
            .last_insert_rowid();
            let neu = zeile_json(tx, "termine", id).await?;
            protokollieren(tx, zeitpunkt, "termine", id, "neu", None, neu.as_ref()).await?;
            (id, None)
        }
        Some(id) => {
            let alt = termin_lesen(tx, id).await?;
            let vorher = stand(&alt);
            let status = match (t.wieder_einplanen, vorher.status.as_str()) {
                (true, "abgesagt") => "geplant",
                (true, _) => return Err(NUR_ABGESAGTE.into()),
                (false, s) => s,
            };
            aendern_in(tx, id, &alt, &felder(t, kunde_id, status), zeitpunkt).await?;
            (id, Some(vorher))
        }
    };

    let mut e = ergebnis(tx, id).await?;
    e.kunde_neu = kunde_neu;
    e.vorher = vorher;
    match (t.beleg.as_str(), entwurf) {
        ("quittung" | "rechnung", Some(d)) => {
            if e.status == "abgesagt" {
                return Err(ABGESAGT_OHNE_BELEG.into());
            }
            if let Some(nr) = beleg_nummer(tx, id).await? {
                return Err(format!(
                    "Zum Termin ist schon {nr} ausgestellt – er bleibt unverändert (GoBD)."
                ));
            }
            let k = Some(kunde_id);
            let r = rechnungen::vorbereitung_schreiben_in(tx, id, k, d, zeitpunkt).await?;
            let aktion = if r.1 { "neu" } else { "geaendert" };
            e.entwurf_id = Some(r.0);
            e.entwurf_aktion = Some(aktion.into());
        }
        ("keinen", _) => {
            e.verworfen = verwerfen_in(tx, id, zeitpunkt).await?;
            e.entwurf_id = None;
        }
        _ => {}
    }
    Ok(e)
}

/// Felder eines bestehenden Termins übernehmen; protokolliert nur, was sich geändert hat.
async fn aendern_in(
    tx: &mut SqliteConnection,
    id: i64,
    alt: &Map<String, Value>,
    neu: &Map<String, Value>,
    zeitpunkt: &str,
) -> Result<(), String> {
    let mut diff_alt = Map::new();
    let mut diff_neu = Map::new();
    for (k, v) in neu {
        let vorher = alt.get(k).cloned().unwrap_or(Value::Null);
        if &vorher != v {
            diff_alt.insert(k.clone(), vorher);
            diff_neu.insert(k.clone(), v.clone());
        }
    }
    if diff_neu.is_empty() {
        return Ok(());
    }
    sqlx::query(
        "UPDATE termine SET kunde_id = ?, datum = ?, von = ?, bis = ?, adresse = ?,
           leistung = ?, betrag_geschaetzt_cent = ?, notiz = ?, status = ?, geaendert_am = ?
         WHERE id = ?",
    )
    .bind(zahl(neu, "kunde_id"))
    .bind(text(neu, "datum"))
    .bind(text(neu, "von"))
    .bind(text(neu, "bis"))
    .bind(text(neu, "adresse"))
    .bind(text(neu, "leistung"))
    .bind(zahl(neu, "betrag_geschaetzt_cent"))
    .bind(text(neu, "notiz"))
    .bind(text(neu, "status"))
    .bind(zeitpunkt)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_fehler)?;
    protokollieren(
        tx,
        zeitpunkt,
        "termine",
        id,
        "geaendert",
        Some(&diff_alt),
        Some(&diff_neu),
    )
    .await
}

/* ---------- Abhaken, Ohne Beleg, Absagen, Rückgängig, Löschen ---------- */

/// „✓ Erledigt“: nur den Termin abhaken (nur heute und Vergangenes). Den Beleg stellt danach die Erfassen-Schublade aus.
pub async fn erledigt(
    conn: &mut SqliteConnection,
    id: i64,
    heute: &str,
    zeitpunkt: &str,
) -> Result<TerminErgebnis, String> {
    datum_lesen("Heutiges Datum", heute)?;
    in_transaktion(conn, async |tx| {
        let alt = termin_lesen(tx, id).await?;
        let vorher = stand(&alt);
        if vorher.status != "geplant" {
            return Err("Nur geplante Termine lassen sich abhaken.".into());
        }
        if text(&alt, "datum").unwrap_or_default().as_str() > heute {
            return Err(ERST_AM_TAG.into());
        }
        let neu = TerminStand {
            status: "erledigt".into(),
            ohne_beleg: false,
            notiz: vorher.notiz.clone(),
        };
        stand_setzen(tx, id, &alt, &neu, zeitpunkt).await?;
        let mut e = ergebnis(tx, id).await?;
        e.vorher = Some(vorher);
        Ok(e)
    })
    .await
}

/// „Doch nicht erledigt“: zurück auf geplant – nicht mehr, wenn es schon einen Beleg oder eine Einnahme gibt.
pub async fn nicht_erledigt(
    conn: &mut SqliteConnection,
    id: i64,
    zeitpunkt: &str,
) -> Result<TerminErgebnis, String> {
    in_transaktion(conn, async |tx| {
        let alt = termin_lesen(tx, id).await?;
        let vorher = stand(&alt);
        if vorher.status != "erledigt" {
            return Err("Der Termin ist nicht erledigt.".into());
        }
        if let Some(nr) = beleg_nummer(tx, id).await? {
            return Err(format!("Zum Termin gibt es schon den Beleg {nr}."));
        }
        if let Some(nr) = einnahme_nummer(tx, id).await? {
            return Err(format!("Zum Termin ist schon die Einnahme {nr} gebucht."));
        }
        let neu = TerminStand {
            status: "geplant".into(),
            ohne_beleg: false,
            notiz: vorher.notiz.clone(),
        };
        stand_setzen(tx, id, &alt, &neu, zeitpunkt).await?;
        let mut e = ergebnis(tx, id).await?;
        e.vorher = Some(vorher);
        Ok(e)
    })
    .await
}

/// „Ohne Beleg abschließen“ (z. B. Nachbesserung): erledigt ohne Beleg, der vorbereitete Entwurf wird verworfen.
pub async fn ohne_beleg(
    conn: &mut SqliteConnection,
    id: i64,
    zeitpunkt: &str,
) -> Result<TerminErgebnis, String> {
    in_transaktion(conn, async |tx| {
        let alt = termin_lesen(tx, id).await?;
        let vorher = stand(&alt);
        if vorher.status != "erledigt" {
            return Err("Erst den Termin abhaken, dann ohne Beleg abschließen.".into());
        }
        if let Some(nr) = beleg_nummer(tx, id).await? {
            return Err(format!("Zum Termin gibt es schon den Beleg {nr}."));
        }
        let verworfen = verwerfen_in(tx, id, zeitpunkt).await?;
        let neu = TerminStand {
            status: "erledigt".into(),
            ohne_beleg: true,
            notiz: vorher.notiz.clone(),
        };
        stand_setzen(tx, id, &alt, &neu, zeitpunkt).await?;
        let mut e = ergebnis(tx, id).await?;
        e.vorher = Some(vorher);
        e.verworfen = verworfen;
        Ok(e)
    })
    .await
}

/// „Absagen“: abgesagt, der Grund (optional) wird an die Notiz gehängt, der Entwurf verworfen – kein Storno nötig.
pub async fn absagen(
    conn: &mut SqliteConnection,
    id: i64,
    grund: Option<&str>,
    heute: &str,
    zeitpunkt: &str,
) -> Result<TerminErgebnis, String> {
    datum_lesen("Heutiges Datum", heute)?;
    in_transaktion(conn, async |tx| {
        let alt = termin_lesen(tx, id).await?;
        let vorher = stand(&alt);
        if vorher.status != "geplant" {
            return Err("Absagen lassen sich nur geplante Termine.".into());
        }
        if let Some(nr) = beleg_nummer(tx, id).await? {
            return Err(format!("Zum Termin gibt es schon den Beleg {nr}."));
        }
        let verworfen = verwerfen_in(tx, id, zeitpunkt).await?;
        let neu = TerminStand {
            status: "abgesagt".into(),
            ohne_beleg: false,
            notiz: notiz_mit_grund(vorher.notiz.as_deref(), grund, heute),
        };
        stand_setzen(tx, id, &alt, &neu, zeitpunkt).await?;
        let mut e = ergebnis(tx, id).await?;
        e.vorher = Some(vorher);
        e.verworfen = verworfen;
        Ok(e)
    })
    .await
}

/// „Rückgängig“ zu Abhaken, „Doch nicht erledigt“, „Ohne Beleg“ und Absagen: setzt Status, „ohne Beleg“ und Notiz
/// zurück und legt verworfene Entwürfe wieder an. Geht nicht mehr, sobald es einen Beleg oder eine Einnahme gibt.
pub async fn zuruecksetzen(
    conn: &mut SqliteConnection,
    id: i64,
    ziel: &TerminStand,
    entwuerfe: &[EntwurfEingabe],
    zeitpunkt: &str,
) -> Result<TerminErgebnis, String> {
    if !STATUS.contains(&ziel.status.as_str()) {
        return Err(format!("Unbekannter Status „{}“.", ziel.status));
    }
    if ziel.ohne_beleg && ziel.status != "erledigt" {
        return Err("„Ohne Beleg“ gibt es nur bei erledigten Terminen.".into());
    }
    in_transaktion(conn, async |tx| {
        let alt = termin_lesen(tx, id).await?;
        let belegt = beleg_nummer(tx, id).await?.is_some();
        if belegt || einnahme_nummer(tx, id).await?.is_some() {
            return Err(RUECKGAENGIG_ZU_SPAET.into());
        }
        let vorher = stand(&alt);
        let neu = TerminStand {
            notiz: getrimmt(&ziel.notiz),
            ..ziel.clone()
        };
        stand_setzen(tx, id, &alt, &neu, zeitpunkt).await?;
        if neu.status != "abgesagt" {
            let kunde_id = zahl(&alt, "kunde_id");
            for d in entwuerfe {
                rechnungen::vorbereitung_schreiben_in(tx, id, kunde_id, d, zeitpunkt).await?;
            }
        }
        let mut e = ergebnis(tx, id).await?;
        e.vorher = Some(vorher);
        Ok(e)
    })
    .await
}

/// Abgesagten Termin löschen (Protokoll 'geloescht' mit der ganzen Zeile) – nur ohne Belege und Einnahmen.
pub async fn loeschen(
    conn: &mut SqliteConnection,
    id: i64,
    zeitpunkt: &str,
) -> Result<TerminErgebnis, String> {
    in_transaktion(conn, async |tx| {
        let alt = termin_lesen(tx, id).await?;
        if text(&alt, "status").as_deref() != Some("abgesagt") {
            return Err("Löschen lassen sich nur abgesagte Termine.".into());
        }
        let n: i64 = sqlx::query_scalar(
            "SELECT (SELECT count(*) FROM rechnungen WHERE termin_id = ?)
                  + (SELECT count(*) FROM buchungen WHERE termin_id = ?)",
        )
        .bind(id)
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_fehler)?;
        if n > 0 {
            return Err("An diesem Termin hängen Belege oder Einnahmen.".into());
        }
        sqlx::query("DELETE FROM termine WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_fehler)?;
        protokollieren(tx, zeitpunkt, "termine", id, "geloescht", Some(&alt), None).await?;
        Ok(TerminErgebnis {
            id,
            status: "geloescht".into(),
            kunde_id: zahl(&alt, "kunde_id"),
            vorher: Some(stand(&alt)),
            ..TerminErgebnis::default()
        })
    })
    .await
}

/* ---------- Tauri-Commands (dünne Hüllen) ---------- */

/// Frontend: `invoke('termin_speichern', { id, daten, entwurf })` (id null = neu, entwurf null = ohne).
#[tauri::command]
pub async fn termin_speichern(
    instanzen: tauri::State<'_, DbInstances>,
    id: Option<i64>,
    daten: TerminEingabe,
    entwurf: Option<EntwurfEingabe>,
) -> Result<TerminErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    let zeitpunkt = datenbank::zeitstempel();
    speichern(&mut c, id, &daten, entwurf.as_ref(), &zeitpunkt).await
}

/// Frontend: `invoke('termin_erledigt', { id, heute })`.
#[tauri::command]
pub async fn termin_erledigt(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    heute: String,
) -> Result<TerminErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    erledigt(&mut c, id, &heute, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('termin_nicht_erledigt', { id })`.
#[tauri::command]
pub async fn termin_nicht_erledigt(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
) -> Result<TerminErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    nicht_erledigt(&mut c, id, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('termin_ohne_beleg', { id })`.
#[tauri::command]
pub async fn termin_ohne_beleg(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
) -> Result<TerminErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    ohne_beleg(&mut c, id, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('termin_absagen', { id, grund, heute })`.
#[tauri::command]
pub async fn termin_absagen(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    grund: Option<String>,
    heute: String,
) -> Result<TerminErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    let zeitpunkt = datenbank::zeitstempel();
    absagen(&mut c, id, grund.as_deref(), &heute, &zeitpunkt).await
}

/// Frontend: `invoke('termin_zuruecksetzen', { id, stand, entwuerfe })`.
#[tauri::command]
pub async fn termin_zuruecksetzen(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    stand: TerminStand,
    entwuerfe: Vec<EntwurfEingabe>,
) -> Result<TerminErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    let zeitpunkt = datenbank::zeitstempel();
    zuruecksetzen(&mut c, id, &stand, &entwuerfe, &zeitpunkt).await
}

/// Frontend: `invoke('termin_loeschen', { id })`.
#[tauri::command]
pub async fn termin_loeschen(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
) -> Result<TerminErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    loeschen(&mut c, id, &datenbank::zeitstempel()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buchungen::{self, BuchungEingabe};
    use crate::datenbank::testhilfe::test_db;
    use crate::rechnungen::{AusstellenEingabe, PositionEingabe};
    use std::path::Path;

    const JETZT: &str = "2026-10-15T08:00:00Z";
    const SPAETER: &str = "2026-10-16T09:30:00Z";
    const HEUTE: &str = "2026-10-15";

    fn lauf<F: std::future::Future<Output = ()>>(f: F) {
        tauri::async_runtime::block_on(f);
    }

    /// Wie aus der Termin-Schublade: neuer Kunde mit Adresse, Quittung vorbereiten.
    fn eingabe() -> TerminEingabe {
        TerminEingabe {
            kunde_id: None,
            neuer_kunde: Some(" Anna Schmidt ".into()),
            datum: "2026-10-14".into(),
            von: Some("08:00".into()),
            bis: Some("10:00".into()),
            adresse: Some("Gartenweg 3\n12390 Seehausen".into()),
            leistung: " Rasen mähen ".into(),
            betrag_geschaetzt_cent: Some(6_500),
            notiz: Some("Tor schließen".into()),
            beleg: "quittung".into(),
            wieder_einplanen: false,
            heute: HEUTE.into(),
        }
    }

    /// Vorbereiteter Beleg, wie ihn das Frontend baut (vorbereitungFormular ⇒ formularZuDaten).
    fn entwurf(art: &str, preis: i64) -> EntwurfEingabe {
        EntwurfEingabe {
            art: art.into(),
            kunde_id: None,
            kunde_name: None,
            kunde_adresse: None,
            datum: "2026-10-14".into(),
            leistung_von: Some("2026-10-14".into()),
            leistung_bis: None,
            faellig_am: (art == "rechnung").then(|| "2026-10-28".to_string()),
            betreff: Some("Rasen mähen".into()),
            einleitung: None,
            schlusstext: Some("Vielen Dank!".into()),
            zahlungsart: (art == "quittung").then(|| "bar".to_string()),
            bezahlt_am: None,
            vorlage_id: None,
            termin_id: None,
            positionen: vec![PositionEingabe {
                beschreibung: "Rasen mähen".into(),
                menge: 1.0,
                einheit: Some("pausch.".into()),
                einzelpreis_cent: preis,
                kategorie_id: None,
            }],
            zusatz: Map::new(),
        }
    }

    fn ausstellen_eingabe() -> AusstellenEingabe {
        AusstellenEingabe {
            dokument: serde_json::json!({ "art": "quittung", "nummer": null }),
            bausteine: serde_json::json!([{ "typ": "titel" }]),
            kategorie_id: None,
            heute: HEUTE.into(),
        }
    }

    fn einnahme(termin: i64, kunde: i64) -> BuchungEingabe {
        BuchungEingabe {
            typ: "einnahme".into(),
            zahlungsdatum: "2026-10-14".into(),
            belegdatum: None,
            betrag_cent: 6_500,
            privatanteil_prozent: 0,
            kategorie_id: 1,
            kunde_id: Some(kunde),
            neuer_kunde: None,
            lieferant: None,
            zahlungsart: "bar".into(),
            belegnummer: None,
            beschreibung: "Rasen mähen".into(),
            heute: HEUTE.into(),
            belege: vec![],
            termin_id: Some(termin),
        }
    }

    /// Ablageordner für Buchungen ohne Belegdateien (wird nie angefasst).
    fn ohne() -> &'static Path {
        Path::new("/kladdy-test-ohne-belegablage")
    }

    /// Termin mit neuem Kunden und vorbereiteter Quittung.
    async fn mit_quittung(c: &mut SqliteConnection) -> TerminErgebnis {
        let q = entwurf("quittung", 6_500);
        let r = speichern(c, None, &eingabe(), Some(&q), JETZT).await;
        r.unwrap()
    }

    /// Eingabe mit einer Änderung ⇒ Fehlermeldung beim Eintragen.
    async fn fehler(c: &mut SqliteConnection, aendern: impl Fn(&mut TerminEingabe)) -> String {
        let mut d = eingabe();
        aendern(&mut d);
        let q = entwurf("quittung", 6_500);
        let e = (d.beleg == "quittung").then_some(&q);
        let r = speichern(c, None, &d, e, JETZT).await;
        r.unwrap_err()
    }

    async fn anzahl(c: &mut SqliteConnection, sql: &str) -> i64 {
        sqlx::query_scalar(sql).fetch_one(c).await.unwrap()
    }

    /// Eine Spalte einer Zeile als Text.
    async fn spalte(c: &mut SqliteConnection, tabelle: &str, sp: &str, id: i64) -> Option<String> {
        let sql = format!("SELECT CAST({sp} AS TEXT) FROM {tabelle} WHERE id = ?");
        sqlx::query_scalar(&sql)
            .bind(id)
            .fetch_one(c)
            .await
            .unwrap()
    }

    async fn protokoll(c: &mut SqliteConnection) -> Vec<(String, i64, String)> {
        sqlx::query_as("SELECT tabelle, datensatz_id, aktion FROM protokoll ORDER BY id")
            .fetch_all(c)
            .await
            .unwrap()
    }

    const ENTWUERFE: &str = "SELECT count(*) FROM rechnungen WHERE nummer IS NULL";
    const KREIS_QU: &str = "SELECT naechste FROM nummernkreise WHERE id = 'quittung'";

    #[test]
    fn uhrzeit_und_absagegrund() {
        assert_eq!(uhrzeit_lesen("Beginn", "08:30"), Ok(510));
        assert_eq!(uhrzeit_lesen("Beginn", "23:59"), Ok(1439));
        for falsch in ["8:30", "24:00", "12:60", "12-30", "", "ab:cd"] {
            assert!(uhrzeit_lesen("Beginn", falsch).is_err(), "{falsch}");
        }
        let n = notiz_mit_grund(Some("Tor zu"), Some(" Regen "), HEUTE);
        let erwartet = "Tor zu\nAbgesagt am 15.10.2026: Regen";
        assert_eq!(n.as_deref(), Some(erwartet));
        let n = notiz_mit_grund(None, Some("krank"), HEUTE);
        assert_eq!(n.as_deref(), Some("Abgesagt am 15.10.2026: krank"));
        let n = notiz_mit_grund(Some("Tor zu"), Some("  "), HEUTE);
        assert_eq!(n.as_deref(), Some("Tor zu"));
    }

    #[test]
    fn eintragen_mit_neuem_kunden_und_vorbereiteter_quittung() {
        lauf(async {
            let mut c = test_db().await;
            let t = mit_quittung(&mut c).await;
            assert_eq!((t.status.as_str(), t.ohne_beleg), ("geplant", false));
            assert!(t.kunde_neu);
            assert_eq!(t.kunde_nummer.as_deref(), Some("K-0001"));
            assert_eq!(t.entwurf_aktion.as_deref(), Some("neu"));
            let k = t.kunde_id.unwrap();
            // Kunde mit der Adresse des Termins, Termin getrimmt
            let strasse = spalte(&mut c, "kunden", "strasse", k).await;
            assert_eq!(strasse.as_deref(), Some("Gartenweg 3"));
            let leistung = spalte(&mut c, "termine", "leistung", t.id).await;
            assert_eq!(leistung.as_deref(), Some("Rasen mähen"));
            // Entwurf ohne Nummer, Termin und Kunde vom Termin
            let e = t.entwurf_id.unwrap();
            assert_eq!(spalte(&mut c, "rechnungen", "nummer", e).await, None);
            let termin = spalte(&mut c, "rechnungen", "termin_id", e).await;
            assert_eq!(termin, Some(t.id.to_string()));
            let kunde = spalte(&mut c, "rechnungen", "kunde_id", e).await;
            assert_eq!(kunde, Some(k.to_string()));
            let status = spalte(&mut c, "rechnungen", "status", e).await;
            assert_eq!(status.as_deref(), Some("entwurf"));
            // alles im Protokoll, keine Nummer verbraucht
            let p = protokoll(&mut c).await;
            let tabellen: Vec<&str> = p.iter().map(|x| x.0.as_str()).collect();
            assert_eq!(tabellen, vec!["kunden", "termine", "rechnungen"]);
            assert!(p.iter().all(|x| x.2 == "neu"));
            assert_eq!(anzahl(&mut c, KREIS_QU).await, 1);
        });
    }

    #[test]
    fn aendern_gleicht_entwurf_an_und_keinen_verwirft() {
        lauf(async {
            let mut c = test_db().await;
            let t = mit_quittung(&mut c).await;
            let k = t.kunde_id.unwrap();
            let rechnung = TerminEingabe {
                kunde_id: Some(k),
                neuer_kunde: None,
                leistung: "Hecke schneiden".into(),
                beleg: "rechnung".into(),
                ..eingabe()
            };
            let r = entwurf("rechnung", 9_000);
            let a = speichern(&mut c, Some(t.id), &rechnung, Some(&r), SPAETER)
                .await
                .unwrap();
            assert_eq!(a.entwurf_aktion.as_deref(), Some("geaendert"));
            assert_eq!(a.entwurf_id, t.entwurf_id);
            assert!(!a.kunde_neu);
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM kunden").await, 1);
            let e = a.entwurf_id.unwrap();
            let art = spalte(&mut c, "rechnungen", "art", e).await;
            assert_eq!(art.as_deref(), Some("rechnung"));
            let summe = spalte(&mut c, "rechnungen", "summe_cent", e).await;
            assert_eq!(summe.as_deref(), Some("9000"));
            let leistung = spalte(&mut c, "termine", "leistung", t.id).await;
            assert_eq!(leistung.as_deref(), Some("Hecke schneiden"));
            // unverändert mit „behalten“: kein weiterer Protokolleintrag
            let n = protokoll(&mut c).await.len();
            let gleich = TerminEingabe {
                beleg: "behalten".into(),
                ..rechnung.clone()
            };
            let g = speichern(&mut c, Some(t.id), &gleich, None, SPAETER).await;
            assert_eq!(g.unwrap().entwurf_id, Some(e));
            assert_eq!(protokoll(&mut c).await.len(), n);
            // „Keinen“: Entwurf verworfen (ohne Storno), für Rückgängig zurückgegeben
            let keinen = TerminEingabe {
                beleg: "keinen".into(),
                ..rechnung
            };
            let v = speichern(&mut c, Some(t.id), &keinen, None, SPAETER)
                .await
                .unwrap();
            assert_eq!(v.entwurf_id, None);
            assert_eq!(v.verworfen.len(), 1);
            assert_eq!(v.verworfen[0].art, "rechnung");
            assert_eq!(v.verworfen[0].positionen[0].einzelpreis_cent, 9_000);
            assert_eq!(anzahl(&mut c, ENTWUERFE).await, 0);
            let letzte = protokoll(&mut c).await.pop().unwrap();
            assert_eq!(letzte.2, "geloescht_entwurf");
            assert_eq!((letzte.0.as_str(), letzte.1), ("rechnungen", e));
        });
    }

    #[test]
    fn abhaken_ohne_beleg_und_rueckgaengig() {
        lauf(async {
            let mut c = test_db().await;
            let t = mit_quittung(&mut c).await;
            // künftige Termine erst an ihrem Tag
            let spaeter = TerminEingabe {
                kunde_id: t.kunde_id,
                neuer_kunde: None,
                datum: "2026-10-20".into(),
                beleg: "keinen".into(),
                ..eingabe()
            };
            let s = speichern(&mut c, None, &spaeter, None, JETZT).await;
            let f = erledigt(&mut c, s.unwrap().id, HEUTE, JETZT).await;
            assert!(f.unwrap_err().contains("erst am Tag"));
            // abhaken, doch nicht, wieder abhaken
            let e = erledigt(&mut c, t.id, HEUTE, JETZT).await.unwrap();
            assert_eq!(e.status, "erledigt");
            assert_eq!(e.vorher.unwrap().status, "geplant");
            assert!(erledigt(&mut c, t.id, HEUTE, JETZT).await.is_err());
            let g = nicht_erledigt(&mut c, t.id, JETZT).await.unwrap();
            assert_eq!(g.status, "geplant");
            erledigt(&mut c, t.id, HEUTE, JETZT).await.unwrap();
            // ohne Beleg abschließen: Entwurf verworfen
            let o = ohne_beleg(&mut c, t.id, SPAETER).await.unwrap();
            assert!(o.ohne_beleg);
            assert_eq!(o.verworfen.len(), 1);
            assert_eq!(anzahl(&mut c, ENTWUERFE).await, 0);
            // Rückgängig: wieder „Beleg fehlt“, der Entwurf neu angelegt
            let vorher = o.vorher.unwrap();
            assert!(!vorher.ohne_beleg);
            let z = zuruecksetzen(&mut c, t.id, &vorher, &o.verworfen, SPAETER)
                .await
                .unwrap();
            assert_eq!((z.status.as_str(), z.ohne_beleg), ("erledigt", false));
            assert!(z.entwurf_id.is_some());
            assert_eq!(anzahl(&mut c, ENTWUERFE).await, 1);
            assert_eq!(anzahl(&mut c, KREIS_QU).await, 1);
        });
    }

    #[test]
    fn absagen_rueckgaengig_wieder_einplanen_und_loeschen() {
        lauf(async {
            let mut c = test_db().await;
            let t = mit_quittung(&mut c).await;
            let f = loeschen(&mut c, t.id, JETZT).await.unwrap_err();
            assert!(f.contains("nur abgesagte"), "{f}");
            let a = absagen(&mut c, t.id, Some(" Regen "), HEUTE, JETZT)
                .await
                .unwrap();
            assert_eq!(a.status, "abgesagt");
            assert_eq!(a.verworfen.len(), 1);
            let notiz = spalte(&mut c, "termine", "notiz", t.id).await;
            let erwartet = "Tor schließen\nAbgesagt am 15.10.2026: Regen";
            assert_eq!(notiz.as_deref(), Some(erwartet));
            assert_eq!(anzahl(&mut c, ENTWUERFE).await, 0);
            // Rückgängig: geplant, Notiz wie vorher, Entwurf wieder da
            let vorher = a.vorher.unwrap();
            let z = zuruecksetzen(&mut c, t.id, &vorher, &a.verworfen, JETZT)
                .await
                .unwrap();
            assert_eq!(z.status, "geplant");
            let notiz = spalte(&mut c, "termine", "notiz", t.id).await;
            assert_eq!(notiz.as_deref(), Some("Tor schließen"));
            assert_eq!(anzahl(&mut c, ENTWUERFE).await, 1);
            // ohne Grund bleibt die Notiz
            absagen(&mut c, t.id, None, HEUTE, JETZT).await.unwrap();
            let notiz = spalte(&mut c, "termine", "notiz", t.id).await;
            assert_eq!(notiz.as_deref(), Some("Tor schließen"));
            // abgesagt: kein Beleg; wieder einplanen geht nur von abgesagt aus
            let mit = TerminEingabe {
                kunde_id: t.kunde_id,
                neuer_kunde: None,
                ..eingabe()
            };
            let q = entwurf("quittung", 6_500);
            let f = speichern(&mut c, Some(t.id), &mit, Some(&q), JETZT).await;
            assert!(f.unwrap_err().contains("abgesagter Termin"));
            let wieder = TerminEingabe {
                wieder_einplanen: true,
                datum: "2026-10-22".into(),
                ..mit
            };
            let w = speichern(&mut c, Some(t.id), &wieder, Some(&q), JETZT)
                .await
                .unwrap();
            assert_eq!(w.status, "geplant");
            assert_eq!(w.entwurf_aktion.as_deref(), Some("neu"));
            let f = speichern(&mut c, Some(t.id), &wieder, Some(&q), JETZT).await;
            assert!(f.unwrap_err().contains("nur abgesagte"));
            // abgesagt löschen: ganz weg, im Protokoll
            absagen(&mut c, t.id, None, HEUTE, JETZT).await.unwrap();
            loeschen(&mut c, t.id, SPAETER).await.unwrap();
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM termine").await, 0);
            let letzte = protokoll(&mut c).await.pop().unwrap();
            assert_eq!(letzte, ("termine".into(), t.id, "geloescht".into()));
        });
    }

    #[test]
    fn ausstellen_hakt_den_termin_ab() {
        lauf(async {
            let mut c = test_db().await;
            let t = mit_quittung(&mut c).await;
            let k = t.kunde_id.unwrap();
            // vorbereitete Quittung ausstellen (wie die Erfassen-Schublade mit `entwurf`)
            let d = EntwurfEingabe {
                kunde_id: Some(k),
                termin_id: Some(t.id),
                datum: HEUTE.into(),
                ..entwurf("quittung", 7_000)
            };
            let a = ausstellen_eingabe();
            let r = rechnungen::ausstellen(&mut c, t.entwurf_id, &d, &a, SPAETER)
                .await
                .unwrap();
            assert_eq!(r.nummer.as_deref(), Some("QU-2026-001"));
            assert_eq!(Some(r.id), t.entwurf_id);
            let status = spalte(&mut c, "termine", "status", t.id).await;
            assert_eq!(status.as_deref(), Some("erledigt"));
            // mit Beleg: nicht mehr zurück, nicht ohne Beleg, nicht absagen, kein Rückgängig
            let f = nicht_erledigt(&mut c, t.id, SPAETER).await.unwrap_err();
            assert!(f.contains("QU-2026-001"), "{f}");
            assert!(ohne_beleg(&mut c, t.id, SPAETER).await.is_err());
            let f = absagen(&mut c, t.id, None, HEUTE, SPAETER).await;
            assert!(f.is_err());
            let stand = TerminStand {
                status: "geplant".into(),
                ..TerminStand::default()
            };
            let v = zuruecksetzen(&mut c, t.id, &stand, &[], SPAETER).await;
            assert!(v.unwrap_err().contains("Rückgängig"));
            // „Ohne Beleg“ abgeschlossen, dann doch eine Quittung: „ohne Beleg“ fällt weg
            let zweiter = TerminEingabe {
                kunde_id: Some(k),
                neuer_kunde: None,
                beleg: "keinen".into(),
                ..eingabe()
            };
            let t2 = speichern(&mut c, None, &zweiter, None, JETZT).await;
            let t2 = t2.unwrap().id;
            erledigt(&mut c, t2, HEUTE, JETZT).await.unwrap();
            ohne_beleg(&mut c, t2, JETZT).await.unwrap();
            let neu = EntwurfEingabe {
                termin_id: Some(t2),
                ..d
            };
            let r2 = rechnungen::ausstellen(&mut c, None, &neu, &a, SPAETER).await;
            assert_eq!(r2.unwrap().nummer.as_deref(), Some("QU-2026-002"));
            let ohne_b = spalte(&mut c, "termine", "ohne_beleg", t2).await;
            assert_eq!(ohne_b.as_deref(), Some("0"));
        });
    }

    #[test]
    fn ohne_eigenen_beleg_schliesst_den_termin_ab() {
        lauf(async {
            let mut c = test_db().await;
            let t = mit_quittung(&mut c).await;
            let k = t.kunde_id.unwrap();
            let b = buchungen::anlegen(&mut c, ohne(), &einnahme(t.id, k), JETZT)
                .await
                .unwrap();
            let verweis = spalte(&mut c, "buchungen", "termin_id", b.id).await;
            assert_eq!(verweis, Some(t.id.to_string()));
            let status = spalte(&mut c, "termine", "status", t.id).await;
            assert_eq!(status.as_deref(), Some("erledigt"));
            let ohne_b = spalte(&mut c, "termine", "ohne_beleg", t.id).await;
            assert_eq!(ohne_b.as_deref(), Some("1"));
            assert_eq!(anzahl(&mut c, ENTWUERFE).await, 0);
            // ein Besuch zählt nur einmal
            let e = einnahme(t.id, k);
            let zweite = buchungen::anlegen(&mut c, ohne(), &e, JETZT).await;
            assert!(zweite.unwrap_err().contains("schon eine Einnahme"));
            let f = nicht_erledigt(&mut c, t.id, JETZT).await.unwrap_err();
            assert!(f.contains(&b.nummer), "{f}");
            // nur bei neuen Einnahmen
            let ausgabe = BuchungEingabe {
                typ: "ausgabe".into(),
                kategorie_id: 2,
                kunde_id: None,
                ..einnahme(t.id, k)
            };
            let f = buchungen::anlegen(&mut c, ohne(), &ausgabe, JETZT).await;
            assert!(f.unwrap_err().contains("nur zu einer Einnahme"));
            let f = buchungen::aendern(&mut c, ohne(), b.id, &e, JETZT).await;
            assert!(f.unwrap_err().contains("neuen Einnahme"));
            // abgesagt: keine Einnahme zum Termin
            let spaeter = TerminEingabe {
                kunde_id: Some(k),
                neuer_kunde: None,
                beleg: "keinen".into(),
                ..eingabe()
            };
            let t2 = speichern(&mut c, None, &spaeter, None, JETZT).await;
            let t2 = t2.unwrap().id;
            absagen(&mut c, t2, None, HEUTE, JETZT).await.unwrap();
            let e2 = einnahme(t2, k);
            let f = buchungen::anlegen(&mut c, ohne(), &e2, JETZT).await;
            assert!(f.unwrap_err().contains("abgesagt"));
        });
    }

    #[test]
    fn offene_rechnung_zuordnen_wird_beleg_des_termins() {
        lauf(async {
            let mut c = test_db().await;
            let t = mit_quittung(&mut c).await;
            let k = t.kunde_id.unwrap();
            // zwei schon ausgestellte, offene Rechnungen (ohne Termin)
            let d = EntwurfEingabe {
                kunde_id: Some(k),
                ..entwurf("rechnung", 6_500)
            };
            let a = ausstellen_eingabe();
            let re = rechnungen::ausstellen(&mut c, None, &d, &a, JETZT)
                .await
                .unwrap();
            assert_eq!(re.status, "offen");
            let zweite = rechnungen::ausstellen(&mut c, None, &d, &a, JETZT)
                .await
                .unwrap();
            let tid = Some(t.id);
            let b = rechnungen::bezahlt(&mut c, re.id, HEUTE, "bank", HEUTE, tid, SPAETER)
                .await
                .unwrap();
            let buchung = b.buchung_id.unwrap();
            let verweis = spalte(&mut c, "buchungen", "termin_id", buchung).await;
            assert_eq!(verweis, Some(t.id.to_string()));
            let status = spalte(&mut c, "termine", "status", t.id).await;
            assert_eq!(status.as_deref(), Some("erledigt"));
            let ohne_b = spalte(&mut c, "termine", "ohne_beleg", t.id).await;
            assert_eq!(ohne_b.as_deref(), Some("0"));
            assert_eq!(anzahl(&mut c, ENTWUERFE).await, 0);
            // die Rechnung ist jetzt der Beleg des Termins
            let f = nicht_erledigt(&mut c, t.id, SPAETER).await.unwrap_err();
            assert!(f.contains("RE-2026-001"), "{f}");
            let nr = zweite.id;
            let f = rechnungen::bezahlt(&mut c, nr, HEUTE, "bar", HEUTE, tid, SPAETER).await;
            assert!(f.unwrap_err().contains("RE-2026-001"));
            // beim Fehlversuch bleibt alles, wie es war
            let offen = spalte(&mut c, "rechnungen", "status", nr).await;
            assert_eq!(offen.as_deref(), Some("offen"));
        });
    }

    #[test]
    fn pruefungen() {
        lauf(async {
            let mut c = test_db().await;
            let f = fehler(&mut c, |d| d.neuer_kunde = None).await;
            assert!(f.contains("Kunden angeben"), "{f}");
            let f = fehler(&mut c, |d| d.kunde_id = Some(1)).await;
            assert!(f.contains("Entweder"), "{f}");
            let f = fehler(&mut c, |d| d.leistung = "  ".into()).await;
            assert!(f.contains("Leistung"), "{f}");
            let f = fehler(&mut c, |d| d.bis = Some("07:00".into())).await;
            assert!(f.contains("Ende liegt vor"), "{f}");
            let f = fehler(&mut c, |d| d.von = None).await;
            assert!(f.contains("Beginn angeben"), "{f}");
            let f = fehler(&mut c, |d| d.von = Some("25:00".into())).await;
            assert!(f.contains("keine gültige Uhrzeit"), "{f}");
            let f = fehler(&mut c, |d| d.datum = "2026-02-30".into()).await;
            assert!(f.contains("kein gültiges Datum"), "{f}");
            let f = fehler(&mut c, |d| d.betrag_geschaetzt_cent = Some(-1)).await;
            assert!(f.contains("Betrag"), "{f}");
            let f = fehler(&mut c, |d| d.beleg = "irgendwas".into()).await;
            assert!(f.contains("Unbekannte Wahl"), "{f}");
            let f = fehler(&mut c, |d| {
                d.neuer_kunde = None;
                d.kunde_id = Some(42);
            })
            .await;
            assert!(f.contains("gibt es nicht"), "{f}");
            // Entwurf und Wahl beim Beleg müssen zusammenpassen
            let d = eingabe();
            let r = entwurf("rechnung", 6_500);
            let f = speichern(&mut c, None, &d, Some(&r), JETZT).await;
            assert!(f.unwrap_err().contains("Belegart"));
            let f = speichern(&mut c, None, &d, None, JETZT).await;
            assert!(f.unwrap_err().contains("Beleg fehlt"));
            let keinen = TerminEingabe {
                beleg: "keinen".into(),
                ..eingabe()
            };
            let f = speichern(&mut c, None, &keinen, Some(&r), JETZT).await;
            assert!(f.unwrap_err().contains("passt nicht zur Wahl"));
            // nichts geschrieben
            for sql in [
                "SELECT count(*) FROM termine",
                "SELECT count(*) FROM kunden",
                "SELECT count(*) FROM rechnungen",
                "SELECT count(*) FROM protokoll",
            ] {
                assert_eq!(anzahl(&mut c, sql).await, 0, "{sql}");
            }
        });
    }

    #[test]
    fn eingabe_aus_json() {
        // so schickt das Frontend die Daten (fehlende Option-Felder ⇒ None, unbekannte ⇒ Fehler)
        let d: TerminEingabe = serde_json::from_value(serde_json::json!({
            "kunde_id": 3, "datum": "2026-10-20", "leistung": "Hecke", "beleg": "keinen", "heute": HEUTE
        }))
        .unwrap();
        assert_eq!(d.kunde_id, Some(3));
        assert!(d.von.is_none() && d.notiz.is_none() && !d.wieder_einplanen);
        let falsch = serde_json::from_value::<TerminEingabe>(serde_json::json!({
            "kunde_id": 3, "datum": "2026-10-20", "leistung": "Hecke", "beleg": "keinen", "heute": HEUTE,
            "betrag": 1
        }));
        assert!(falsch.is_err());
        let s: TerminStand = serde_json::from_value(serde_json::json!({
            "status": "geplant", "ohne_beleg": false, "notiz": null
        }))
        .unwrap();
        assert_eq!(s.status, "geplant");
    }
}
