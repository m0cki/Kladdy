//! Rechnungen & Quittungen (ANLEITUNG §5, §6.6, §2.3, §2.5): Entwürfe speichern und verwerfen, Ausstellen
//! (Finalisieren), Status, Angebot ⇒ Rechnung, Stornieren, PDF und unterschriebenes Exemplar ablegen.
//! Jeder Vorgang läuft in EINER Transaktion samt GoBD-Protokoll (CLAUDE.md, wie buchungen.rs).
//!
//! - Entwurf: `nummer` NULL, frei änderbar (die Positionen werden jedes Mal ersetzt), verwerfen ohne Storno
//!   (Protokoll-Aktion 'geloescht_entwurf').
//! - Ausstellen: Nummer aus dem Kreis der Belegart (Jahr des Belegdatums, nie rückwärts, keine Lücken), Kunde (gewählt
//!   per ID oder neu angelegt), Schnappschuss `snapshot_json` = { version, dokument, bausteine } wie gedruckt – die Werte
//!   aus der Datenbank (Nummer, Kunde, Daten, Texte, Positionen) überschreiben dabei die des Frontends –, Status und bei
//!   Quittung, Eigenbeleg und schon bezahlter Rechnung die Zahlung (Einnahme bzw. Ausgabe mit `rechnung_id`; eine schon
//!   erfasste Zahlung wird stattdessen verknüpft). Das PDF setzt danach das Frontend aus dem Schnappschuss (Tectonic),
//!   `beleg_pdf_ablegen` legt es genau einmal ab.
//! - Danach nur noch Status (Rechnung offen ⇄ bezahlt per Buchung bzw. Gegenbuchung, Angebot offen/abgelehnt,
//!   angenommen = in eine Rechnung umgewandelt) und Storno: Stornobeleg (Art 'storno') mit eigener Nummer aus dem Kreis
//!   des Originals, negativen Positionen und Gegenbuchung der Zahlung. Trigger aus Migration 0007 sichern das ab.
//! - Ein neuer Kundenname legt den Kunden erst beim Ausstellen an (kunden::anlegen_in). Ob es Namensvettern gibt, klärt
//!   das Frontend vorher (wie bei buchung_anlegen).
//! - Termine (termine.rs): für einen Termin vorbereitete Belege sind Entwürfe mit `termin_id`
//!   (`vorbereitung_schreiben_in`); Ausstellen hakt den Termin ab, „Bezahlt“ mit Termin macht die Rechnung zu seinem
//!   Beleg (über die Einnahme, `buchungen.termin_id`).
//!
//! Die Kernfunktionen nehmen eine Verbindung (Tests gegen eine migrierte Datenbank im Arbeitsspeicher), die
//! `#[tauri::command]`-Funktionen sind dünne Hüllen.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::SqliteConnection;
use tauri_plugin_sql::DbInstances;

use std::path::Path;

use crate::belege;
use crate::buchungen::{
    datum_de, datum_lesen, festgeschrieben_bis, festgeschrieben_meldung, gegenbuchung_in,
    in_transaktion, ist_festgeschrieben, kategorie_pruefen, protokollieren, text_oder_nichts,
    verbindung, zeile_json,
};
use crate::datenbank::{self, db_fehler};
use crate::kunden;
use crate::nummern;
use crate::termine;

/// Belegarten, die man selbst anlegt ('storno' entsteht nur beim Stornieren).
const ARTEN: &[&str] = &["rechnung", "quittung", "angebot", "eigenbeleg"];
const MAX_POSITIONEN: usize = 200;
/// Höchstbetrag je Preis und Beleg (100 Mio. €), wie MAX_CENT im Frontend.
const MAX_CENT: i64 = 10_000_000_000;
const MAX_MENGE: f64 = 1_000_000.0;
/// Größte Zusatzangaben eines Entwurfs bzw. größter Schnappschuss (JSON-Text).
const MAX_ZUSATZ: usize = 64 * 1024;
const MAX_SCHNAPPSCHUSS: usize = 2 * 1024 * 1024;

fn art_name(art: &str) -> &'static str {
    match art {
        "rechnung" => "Rechnung",
        "quittung" => "Quittung",
        "angebot" => "Angebot",
        "eigenbeleg" => "Eigenbeleg",
        "storno" => "Stornobeleg",
        _ => "Beleg",
    }
}

/* ---------- Eingaben ---------- */

/// Eine Position aus der Beleg-Maske (src/lib/rechnungen.ts). Feldnamen exakt so (snake_case).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PositionEingabe {
    pub beschreibung: String,
    /// darf Nachkommastellen haben (Spalte REAL), höchstens drei zählen
    pub menge: f64,
    #[serde(default)]
    pub einheit: Option<String>,
    /// darf negativ sein (Rabatt), die Summe des Belegs nicht
    pub einzelpreis_cent: i64,
    /// Eigenbeleg: Kategorie der Ausgabe; Quittung/Rechnung: Einnahme-Kategorie (sonst beim Ausstellen gesetzt)
    #[serde(default)]
    pub kategorie_id: Option<i64>,
}

/// Ein Beleg, wie ihn die Maske bzw. die Erfassen-Schublade speichert. Serialisiert für „Rückgängig“ bei Terminen:
/// ein verworfener Entwurf geht so an das Frontend und kommt unverändert zurück (termine.rs).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EntwurfEingabe {
    /// 'rechnung' | 'quittung' | 'angebot' | 'eigenbeleg'
    pub art: String,
    /// gewählter Kunde (nie beim Eigenbeleg)
    #[serde(default)]
    pub kunde_id: Option<i64>,
    /// neuer Kunde (wird beim Ausstellen angelegt) bzw. beim Eigenbeleg der Zahlungsempfänger; schließt kunde_id aus
    #[serde(default)]
    pub kunde_name: Option<String>,
    /// Anschrift zu kunde_name, Zeilen mit \n („Straße 1\n12345 Ort“)
    #[serde(default)]
    pub kunde_adresse: Option<String>,
    /// Belegdatum 'YYYY-MM-DD'
    pub datum: String,
    #[serde(default)]
    pub leistung_von: Option<String>,
    #[serde(default)]
    pub leistung_bis: Option<String>,
    /// Rechnung: fällig am · Angebot: gültig bis
    #[serde(default)]
    pub faellig_am: Option<String>,
    #[serde(default)]
    pub betreff: Option<String>,
    #[serde(default)]
    pub einleitung: Option<String>,
    #[serde(default)]
    pub schlusstext: Option<String>,
    /// 'bar' | 'bank' | 'paypal' (Quittung, Eigenbeleg, schon bezahlte Rechnung)
    #[serde(default)]
    pub zahlungsart: Option<String>,
    /// nur Rechnung: schon bezahlt am (dann bucht das Ausstellen die Einnahme)
    #[serde(default)]
    pub bezahlt_am: Option<String>,
    #[serde(default)]
    pub vorlage_id: Option<i64>,
    #[serde(default)]
    pub termin_id: Option<i64>,
    pub positionen: Vec<PositionEingabe>,
    /// Angaben nur für den Entwurf (JSON-Objekt aus dem Frontend, z. B. Eigenbeleg-Grund). Ausgewertet wird hier nur
    /// `buchung_id`: eine schon erfasste Zahlung, die beim Ausstellen verknüpft statt neu gebucht wird.
    #[serde(default)]
    pub zusatz: Map<String, Value>,
}

/// Was zum Ausstellen dazukommt.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AusstellenEingabe {
    /// Belegdokument wie in der Vorschau (src/lib/vorlagen/dokument.ts `BelegDokument`)
    pub dokument: Value,
    /// Bausteine der gewählten Vorlage (werden mit eingefroren)
    pub bausteine: Value,
    /// Einnahme-Kategorie (Quittung, Rechnung); sonst die der ersten Position bzw. die erste aktive
    #[serde(default)]
    pub kategorie_id: Option<i64>,
    /// heutiges lokales Datum 'YYYY-MM-DD'
    pub heute: String,
}

/// Angebot ⇒ Rechnung (Texte und Fälligkeit kommen aus dem Frontend, dort stehen die Standardtexte).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UmwandelnEingabe {
    pub heute: String,
    #[serde(default)]
    pub einleitung: Option<String>,
    #[serde(default)]
    pub schlusstext: Option<String>,
    #[serde(default)]
    pub faellig_am: Option<String>,
}

/// Antwort an das Frontend.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct BelegErgebnis {
    /// der Beleg, um den es geht
    pub id: i64,
    /// seine Nummer (None = Entwurf)
    pub nummer: Option<String>,
    pub status: String,
    pub kunde_id: Option<i64>,
    pub kunde_nummer: Option<String>,
    /// Kunde in diesem Vorgang neu angelegt
    pub kunde_neu: bool,
    /// in diesem Vorgang gebuchte bzw. verknüpfte Zahlung
    pub buchung_id: Option<i64>,
    pub buchung_nummer: Option<String>,
    /// Gegenbuchung, mit der eine Zahlung zurückgenommen wurde (Storno, „doch offen“)
    pub gegenbuchung_nummer: Option<String>,
    /// Stornobeleg (beim Stornieren)
    pub storno_id: Option<i64>,
    pub storno_nummer: Option<String>,
    /// neuer Entwurf (Angebot ⇒ Rechnung)
    pub entwurf_id: Option<i64>,
}

/* ---------- Prüfen ohne Datenbank ---------- */

#[derive(Debug, Clone, PartialEq)]
struct Position {
    beschreibung: String,
    menge: f64,
    einheit: Option<String>,
    einzelpreis_cent: i64,
    kategorie_id: Option<i64>,
}

/// Geprüfter und bereinigter Entwurf.
#[derive(Debug, Clone)]
struct Entwurf {
    art: String,
    kunde_id: Option<i64>,
    kunde_name: Option<String>,
    kunde_adresse: Option<String>,
    datum: String,
    leistung_von: Option<String>,
    leistung_bis: Option<String>,
    faellig_am: Option<String>,
    betreff: Option<String>,
    einleitung: Option<String>,
    schlusstext: Option<String>,
    zahlungsart: Option<String>,
    bezahlt_am: Option<String>,
    vorlage_id: Option<i64>,
    termin_id: Option<i64>,
    positionen: Vec<Position>,
    summe_cent: i64,
    /// entwurf_json
    zusatz: Option<String>,
    /// zusatz.buchung_id
    buchung_id: Option<i64>,
}

/// Positionsbetrag in Cent = Menge × Einzelpreis, kaufmännisch gerundet über Tausendstel der Menge – genau wie
/// `positionBetrag` in src/lib/vorlagen/dokument.ts.
pub fn position_betrag(menge: f64, einzelpreis_cent: i64) -> Result<i64, String> {
    if !menge.is_finite() || menge.abs() > MAX_MENGE {
        return Err("Die Menge ist ungültig.".into());
    }
    let tausendstel = (menge * 1000.0).round() as i64;
    let produkt = tausendstel
        .checked_mul(einzelpreis_cent)
        .ok_or("Der Positionsbetrag ist zu groß.")?;
    let ganz = produkt.abs() / 1000;
    let betrag = if produkt.abs() % 1000 >= 500 {
        ganz + 1
    } else {
        ganz
    };
    Ok(if produkt < 0 { -betrag } else { betrag })
}

/// Mehrzeiliger Text: Zeilenumbrüche bleiben, außen getrimmt, leer ⇒ None.
fn mehrzeilig(t: &Option<String>) -> Option<String> {
    t.as_deref()
        .map(|s| s.replace("\r\n", "\n").trim().to_string())
        .filter(|s| !s.is_empty())
}

fn datum_optional(feld: &str, wert: &Option<String>) -> Result<Option<String>, String> {
    let wert = text_oder_nichts(wert);
    if let Some(d) = &wert {
        datum_lesen(feld, d)?;
    }
    Ok(wert)
}

fn zahlungsart_pruefen(z: Option<&str>) -> Result<(), String> {
    match z {
        None | Some("bar" | "bank" | "paypal") => Ok(()),
        Some(z) => Err(format!("Unbekannter Zahlungsweg „{z}“.")),
    }
}

fn pruefen(d: &EntwurfEingabe) -> Result<Entwurf, String> {
    if !ARTEN.contains(&d.art.as_str()) {
        return Err(format!("Unbekannte Belegart „{}“.", d.art));
    }
    datum_lesen("Belegdatum", &d.datum)?;
    let leistung_von = datum_optional("Leistungsdatum", &d.leistung_von)?;
    let leistung_bis = datum_optional("Leistung bis", &d.leistung_bis)?;
    let verdreht = match (&leistung_von, &leistung_bis) {
        (Some(von), Some(bis)) => bis < von,
        _ => false,
    };
    if verdreht {
        return Err("Der Leistungszeitraum endet vor seinem Beginn.".into());
    }
    let faellig_am = datum_optional("Fälligkeit", &d.faellig_am)?;
    let bezahlt_am = datum_optional("Zahlungseingang", &d.bezahlt_am)?;
    if bezahlt_am.is_some() && d.art != "rechnung" {
        return Err("Ein Zahlungseingang gehört nur zu einer Rechnung.".into());
    }
    let zahlungsart = text_oder_nichts(&d.zahlungsart);
    zahlungsart_pruefen(zahlungsart.as_deref())?;
    let kunde_name = text_oder_nichts(&d.kunde_name);
    if d.art == "eigenbeleg" && d.kunde_id.is_some() {
        return Err("Der Empfänger eines Eigenbelegs ist ein Geschäft, kein Kunde.".into());
    }
    if d.kunde_id.is_some() && kunde_name.is_some() {
        return Err("Entweder einen vorhandenen Kunden wählen oder einen neuen anlegen.".into());
    }
    if d.positionen.len() > MAX_POSITIONEN {
        return Err(format!("Höchstens {MAX_POSITIONEN} Positionen je Beleg."));
    }
    let mut positionen = Vec::with_capacity(d.positionen.len());
    let mut summe: i64 = 0;
    for (i, p) in d.positionen.iter().enumerate() {
        let nr = i + 1;
        if !p.menge.is_finite() || p.menge < 0.0 || p.menge > MAX_MENGE {
            return Err(format!("Position {nr}: Die Menge ist ungültig."));
        }
        if p.einzelpreis_cent.abs() >= MAX_CENT {
            return Err(format!("Position {nr}: Der Preis ist unrealistisch hoch."));
        }
        let betrag = position_betrag(p.menge, p.einzelpreis_cent)
            .map_err(|e| format!("Position {nr}: {e}"))?;
        summe = summe
            .checked_add(betrag)
            .filter(|s| s.abs() < MAX_CENT)
            .ok_or("Die Summe des Belegs ist unrealistisch hoch.")?;
        positionen.push(Position {
            beschreibung: p.beschreibung.replace("\r\n", "\n").trim().to_string(),
            menge: p.menge,
            einheit: text_oder_nichts(&p.einheit),
            einzelpreis_cent: p.einzelpreis_cent,
            kategorie_id: p.kategorie_id,
        });
    }
    let zusatz = if d.zusatz.is_empty() {
        None
    } else {
        let text = Value::Object(d.zusatz.clone()).to_string();
        if text.len() > MAX_ZUSATZ {
            return Err("Die Zusatzangaben des Entwurfs sind zu groß.".into());
        }
        Some(text)
    };
    Ok(Entwurf {
        art: d.art.clone(),
        kunde_id: d.kunde_id,
        kunde_name,
        kunde_adresse: mehrzeilig(&d.kunde_adresse),
        datum: d.datum.clone(),
        leistung_von,
        leistung_bis,
        faellig_am,
        betreff: mehrzeilig(&d.betreff),
        einleitung: mehrzeilig(&d.einleitung),
        schlusstext: mehrzeilig(&d.schlusstext),
        zahlungsart,
        bezahlt_am,
        vorlage_id: d.vorlage_id,
        termin_id: d.termin_id,
        positionen,
        summe_cent: summe,
        zusatz,
        buchung_id: d.zusatz.get("buchung_id").and_then(Value::as_i64),
    })
}

/// Was ein Beleg zum Ausstellen mindestens braucht (§2.3; den vollständigen Pflichtangaben-Check macht die Maske).
fn ausstellbar_pruefen(e: &Entwurf) -> Result<(), String> {
    if e.positionen.is_empty() {
        return Err("Der Beleg hat keine Positionen.".into());
    }
    for (i, p) in e.positionen.iter().enumerate() {
        if p.beschreibung.is_empty() {
            return Err(format!(
                "Position {}: Bitte die Leistung beschreiben.",
                i + 1
            ));
        }
        if p.menge <= 0.0 {
            return Err(format!(
                "Position {}: Die Menge muss größer als 0 sein.",
                i + 1
            ));
        }
    }
    if e.summe_cent <= 0 {
        return Err("Der Gesamtbetrag muss größer als 0 sein.".into());
    }
    let art = e.art.as_str();
    let ohne_kunde = e.kunde_id.is_none() && e.kunde_name.is_none();
    if (art == "rechnung" || art == "angebot") && ohne_kunde {
        return Err("Bitte einen Kunden angeben – Name und Anschrift gehören darauf.".into());
    }
    if art == "eigenbeleg" {
        if e.kunde_name.is_none() {
            return Err("Bitte den Zahlungsempfänger angeben.".into());
        }
        if e.betreff.is_none() {
            return Err("Bitte angeben, wofür gezahlt wurde.".into());
        }
        if e.positionen[0].kategorie_id.is_none() {
            return Err("Bitte eine Kategorie für die Ausgabe wählen.".into());
        }
    }
    Ok(())
}

/* ---------- Anschrift und Empfänger ---------- */

/// Anschrift aus freier Eingabe („z. Hd. …\nStraße 1\n12345 Ort“), wie `parseAdresse` im Prototyp.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Anschrift {
    pub zusatz: Option<String>,
    pub strasse: Option<String>,
    pub plz: Option<String>,
    pub ort: Option<String>,
}

/// „12345 Musterstadt“ ⇒ ("12345", "Musterstadt"); PLZ mit 4 oder 5 Ziffern.
fn plz_ort(zeile: &str) -> Option<(String, String)> {
    let (plz, ort) = zeile.split_once(char::is_whitespace)?;
    let ort = ort.trim();
    let ziffern = (4..=5).contains(&plz.len()) && plz.bytes().all(|b| b.is_ascii_digit());
    (ziffern && !ort.is_empty()).then(|| (plz.to_string(), ort.to_string()))
}

impl Anschrift {
    pub fn lesen(text: &str) -> Self {
        let mut zeilen: Vec<&str> = text
            .lines()
            .map(str::trim)
            .filter(|z| !z.is_empty())
            .collect();
        let mut a = Anschrift::default();
        if let Some((plz, ort)) = zeilen.last().copied().and_then(plz_ort) {
            a.plz = Some(plz);
            a.ort = Some(ort);
            zeilen.pop();
        }
        a.strasse = zeilen.pop().map(String::from);
        if !zeilen.is_empty() {
            a.zusatz = Some(zeilen.join(", "));
        }
        a
    }

    pub fn ist_leer(&self) -> bool {
        self.strasse.is_none() && self.ort.is_none()
    }

    /// Zeilen für `rechnungen.kunde_adresse` (wie die Demo-Daten: Straße und „PLZ Ort“, davor ggf. der Zusatz).
    pub fn text(&self) -> Option<String> {
        let ort = format!(
            "{} {}",
            self.plz.as_deref().unwrap_or(""),
            self.ort.as_deref().unwrap_or("")
        );
        let mut zeilen: Vec<&str> = Vec::new();
        zeilen.extend(self.zusatz.as_deref());
        zeilen.extend(self.strasse.as_deref());
        zeilen.push(ort.trim());
        zeilen.retain(|z| !z.is_empty());
        (!zeilen.is_empty()).then(|| zeilen.join("\n"))
    }
}

/// Empfänger, wie er beim Ausstellen festgehalten wird.
#[derive(Debug, Clone, Default)]
struct Empfaenger {
    id: Option<i64>,
    nummer: Option<String>,
    name: String,
    anschrift: Anschrift,
    email: Option<String>,
    neu: bool,
}

impl Empfaenger {
    /// Schnappschuss im Belegdokument (dokument.ts `KundeSchnappschuss`); ohne Namen ⇒ null („Barverkauf“).
    fn json(&self) -> Value {
        if self.id.is_none() && self.name.is_empty() {
            return Value::Null;
        }
        let t = |v: &Option<String>| v.clone().unwrap_or_default();
        serde_json::json!({
            "id": self.id,
            "nummer": t(&self.nummer),
            "name": self.name,
            "zusatz": t(&self.anschrift.zusatz),
            "strasse": t(&self.anschrift.strasse),
            "plz": t(&self.anschrift.plz),
            "ort": t(&self.anschrift.ort),
            "email": t(&self.email),
        })
    }
}

/// nummer, name, zusatz, strasse, plz, ort, email
type KundeZeile = (
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

async fn kunde_lesen(tx: &mut SqliteConnection, id: i64) -> Result<Empfaenger, String> {
    let zeile: Option<KundeZeile> = sqlx::query_as(
        "SELECT nummer, name, zusatz, strasse, plz, ort, email FROM kunden WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_fehler)?;
    let Some((nummer, name, zusatz, strasse, plz, ort, email)) = zeile else {
        return Err("Den gewählten Kunden gibt es nicht.".into());
    };
    Ok(Empfaenger {
        id: Some(id),
        nummer: Some(nummer),
        name,
        anschrift: Anschrift {
            zusatz,
            strasse,
            plz,
            ort,
        },
        email,
        neu: false,
    })
}

/// Fehlt dem gewählten Kunden die Anschrift, wird sie aus dem Beleg ergänzt (nur leere Felder, mit Protokoll).
/// Auch für Termine (termine.rs: Adresse des Termins beim Kunden ohne Anschrift).
pub(crate) async fn anschrift_ergaenzen(
    tx: &mut SqliteConnection,
    id: i64,
    a: &Anschrift,
    zeitpunkt: &str,
) -> Result<(), String> {
    let Some(zeile) = zeile_json(tx, "kunden", id).await? else {
        return Ok(());
    };
    let mut alt = Map::new();
    let mut neu = Map::new();
    for (feld, wert) in [
        ("zusatz", &a.zusatz),
        ("strasse", &a.strasse),
        ("plz", &a.plz),
        ("ort", &a.ort),
    ] {
        if let (None, Some(w)) = (text(&zeile, feld), wert) {
            alt.insert(feld.into(), Value::Null);
            neu.insert(feld.into(), w.clone().into());
        }
    }
    if neu.is_empty() {
        return Ok(());
    }
    sqlx::query(
        "UPDATE kunden SET zusatz = COALESCE(zusatz, ?), strasse = COALESCE(strasse, ?),
           plz = COALESCE(plz, ?), ort = COALESCE(ort, ?)
         WHERE id = ?",
    )
    .bind(&a.zusatz)
    .bind(&a.strasse)
    .bind(&a.plz)
    .bind(&a.ort)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_fehler)?;
    protokollieren(
        tx,
        zeitpunkt,
        "kunden",
        id,
        "geaendert",
        Some(&alt),
        Some(&neu),
    )
    .await
}

/// Empfänger beim Ausstellen: gewählter Kunde (fehlt die Anschrift, aus dem Beleg ergänzt), neuer Kunde oder – beim
/// Eigenbeleg – das Geschäft als Freitext. Quittung ohne Namen: leer („Barverkauf“).
async fn kunde_festhalten(
    tx: &mut SqliteConnection,
    e: &Entwurf,
    jahr_heute: i64,
    zeitpunkt: &str,
) -> Result<Empfaenger, String> {
    let anschrift = Anschrift::lesen(e.kunde_adresse.as_deref().unwrap_or(""));
    if e.art == "eigenbeleg" {
        return Ok(Empfaenger {
            name: e.kunde_name.clone().unwrap_or_default(),
            anschrift,
            ..Empfaenger::default()
        });
    }
    if let Some(id) = e.kunde_id {
        let mut k = kunde_lesen(tx, id).await?;
        if k.anschrift.ist_leer() && !anschrift.ist_leer() {
            anschrift_ergaenzen(tx, id, &anschrift, zeitpunkt).await?;
            k = kunde_lesen(tx, id).await?;
        }
        return Ok(k);
    }
    let Some(name) = &e.kunde_name else {
        return Ok(Empfaenger::default());
    };
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
    let (id, nummer) = kunden::anlegen_in(tx, &stamm, jahr_heute, zeitpunkt).await?;
    Ok(Empfaenger {
        id: Some(id),
        nummer: Some(nummer),
        name: name.clone(),
        anschrift,
        email: None,
        neu: true,
    })
}

/* ---------- Lesen und Hilfen ---------- */

fn text(m: &Map<String, Value>, k: &str) -> Option<String> {
    m.get(k).and_then(Value::as_str).map(String::from)
}

fn zahl(m: &Map<String, Value>, k: &str) -> Option<i64> {
    m.get(k).and_then(Value::as_i64)
}

/// Cent ⇒ „1.234,56 €“ für Meldungen.
fn euro(cent: i64) -> String {
    let betrag = cent.unsigned_abs();
    let ganz = (betrag / 100).to_string();
    let mut gruppiert = String::new();
    for (i, z) in ganz.chars().enumerate() {
        if i > 0 && (ganz.len() - i).is_multiple_of(3) {
            gruppiert.push('.');
        }
        gruppiert.push(z);
    }
    let vorzeichen = if cent < 0 { "−" } else { "" };
    format!("{vorzeichen}{gruppiert},{:02}\u{a0}€", betrag % 100)
}

async fn gibt_es(tx: &mut SqliteConnection, sql: &str, id: i64) -> Result<bool, String> {
    let n: i64 = sqlx::query_scalar(sql)
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_fehler)?;
    Ok(n > 0)
}

/// Liest einen Entwurf (ganze Zeile); Fehler, wenn es ihn nicht gibt oder er schon ausgestellt ist.
async fn entwurf_lesen(tx: &mut SqliteConnection, id: i64) -> Result<Map<String, Value>, String> {
    let Some(zeile) = zeile_json(tx, "rechnungen", id).await? else {
        return Err("Den Beleg gibt es nicht.".into());
    };
    if let Some(nr) = text(&zeile, "nummer") {
        return Err(format!(
            "Der Beleg {nr} ist schon ausgestellt und kann nur noch storniert werden."
        ));
    }
    Ok(zeile)
}

/// Liest einen ausgestellten Beleg (ganze Zeile und Nummer); Fehler bei Entwürfen.
async fn ausgestellt_lesen(
    tx: &mut SqliteConnection,
    id: i64,
) -> Result<(Map<String, Value>, String), String> {
    let Some(zeile) = zeile_json(tx, "rechnungen", id).await? else {
        return Err("Den Beleg gibt es nicht.".into());
    };
    let Some(nummer) = text(&zeile, "nummer") else {
        return Err("Der Beleg ist noch ein Entwurf.".into());
    };
    Ok((zeile, nummer))
}

/// Spalten einer Position: beschreibung, menge, einheit, einzelpreis_cent, kategorie_id.
type PositionRoh = (String, f64, Option<String>, i64, Option<i64>);

async fn positionen_lesen(tx: &mut SqliteConnection, id: i64) -> Result<Vec<Position>, String> {
    let zeilen: Vec<PositionRoh> = sqlx::query_as(
        "SELECT beschreibung, menge, einheit, einzelpreis_cent, kategorie_id
         FROM rechnungspositionen WHERE rechnung_id = ? ORDER BY pos, id",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_fehler)?;
    let mut liste = Vec::with_capacity(zeilen.len());
    for (beschreibung, menge, einheit, einzelpreis_cent, kategorie_id) in zeilen {
        liste.push(Position {
            beschreibung,
            menge,
            einheit,
            einzelpreis_cent,
            kategorie_id,
        });
    }
    Ok(liste)
}

async fn positionen_schreiben(
    tx: &mut SqliteConnection,
    id: i64,
    positionen: &[Position],
) -> Result<(), String> {
    for (i, p) in positionen.iter().enumerate() {
        sqlx::query(
            "INSERT INTO rechnungspositionen (rechnung_id, pos, beschreibung, menge, einheit, einzelpreis_cent,
               kategorie_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(i as i64 + 1)
        .bind(&p.beschreibung)
        .bind(p.menge)
        .bind(&p.einheit)
        .bind(p.einzelpreis_cent)
        .bind(p.kategorie_id)
        .execute(&mut *tx)
        .await
        .map_err(db_fehler)?;
    }
    Ok(())
}

/// Positionen für Protokoll und Vergleich (mit Kategorie).
fn positionen_wert(positionen: &[Position]) -> Value {
    let mut liste = Vec::with_capacity(positionen.len());
    for p in positionen {
        liste.push(serde_json::json!({
            "beschreibung": p.beschreibung,
            "menge": p.menge,
            "einheit": p.einheit,
            "einzelpreis_cent": p.einzelpreis_cent,
            "kategorie_id": p.kategorie_id,
        }));
    }
    Value::Array(liste)
}

/// Positionen im Format des Belegdokuments (dokument.ts `BelegPosition`).
fn positionen_dokument(positionen: &[Position]) -> Value {
    let mut liste = Vec::with_capacity(positionen.len());
    for p in positionen {
        liste.push(serde_json::json!({
            "beschreibung": p.beschreibung,
            "menge": p.menge,
            "einheit": p.einheit.clone().unwrap_or_default(),
            "einzelpreis_cent": p.einzelpreis_cent,
        }));
    }
    Value::Array(liste)
}

/// Spalten eines Entwurfs ⇒ Werte (Protokoll und Vergleich). Feste Spaltennamen, nie Eingaben.
fn entwurf_felder(e: &Entwurf) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("art".into(), e.art.clone().into());
    m.insert("kunde_id".into(), e.kunde_id.into());
    m.insert("kunde_name".into(), e.kunde_name.clone().into());
    m.insert("kunde_adresse".into(), e.kunde_adresse.clone().into());
    m.insert("datum".into(), e.datum.clone().into());
    m.insert("leistung_von".into(), e.leistung_von.clone().into());
    m.insert("leistung_bis".into(), e.leistung_bis.clone().into());
    m.insert("faellig_am".into(), e.faellig_am.clone().into());
    m.insert("betreff".into(), e.betreff.clone().into());
    m.insert("einleitung".into(), e.einleitung.clone().into());
    m.insert("schlusstext".into(), e.schlusstext.clone().into());
    m.insert("summe_cent".into(), e.summe_cent.into());
    m.insert("zahlungsart".into(), e.zahlungsart.clone().into());
    m.insert("bezahlt_am".into(), e.bezahlt_am.clone().into());
    m.insert("vorlage_id".into(), e.vorlage_id.into());
    m.insert("termin_id".into(), e.termin_id.into());
    m.insert("entwurf_json".into(), e.zusatz.clone().into());
    m.insert("positionen".into(), positionen_wert(&e.positionen));
    m
}

/// Nur die Felder, die sich geändert haben (wie aenderungen() in protokoll.ts).
fn unterschiede(
    alt: &Map<String, Value>,
    neu: &Map<String, Value>,
) -> (Map<String, Value>, Map<String, Value>) {
    let mut diff_alt = Map::new();
    let mut diff_neu = Map::new();
    for (k, v) in neu {
        let vorher = alt.get(k).cloned().unwrap_or(Value::Null);
        if &vorher != v {
            diff_alt.insert(k.clone(), vorher);
            diff_neu.insert(k.clone(), v.clone());
        }
    }
    (diff_alt, diff_neu)
}

/// Kunde, Termin und Vorlage eines Entwurfs müssen existieren (die Vorlage zur Belegart passen).
async fn bezuege_pruefen(tx: &mut SqliteConnection, e: &Entwurf) -> Result<(), String> {
    if let Some(k) = e.kunde_id
        && !gibt_es(tx, "SELECT count(*) FROM kunden WHERE id = ?", k).await?
    {
        return Err("Den gewählten Kunden gibt es nicht.".into());
    }
    if let Some(t) = e.termin_id
        && !gibt_es(tx, "SELECT count(*) FROM termine WHERE id = ?", t).await?
    {
        return Err("Den Termin gibt es nicht.".into());
    }
    if let Some(v) = e.vorlage_id {
        let art: Option<String> = sqlx::query_scalar("SELECT art FROM vorlagen WHERE id = ?")
            .bind(v)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_fehler)?;
        match art {
            None => return Err("Die gewählte Vorlage gibt es nicht.".into()),
            Some(a) if a != e.art => return Err("Die Vorlage passt nicht zur Belegart.".into()),
            Some(_) => {}
        }
    }
    Ok(())
}

/* ---------- Entwurf ---------- */

/// Legt einen Entwurf an (`id` None) oder ersetzt ihn; protokolliert nur, was sich geändert hat. Gibt die ID zurück.
async fn entwurf_schreiben(
    tx: &mut SqliteConnection,
    id: Option<i64>,
    e: &Entwurf,
    zeitpunkt: &str,
) -> Result<i64, String> {
    bezuege_pruefen(tx, e).await?;
    let neu = entwurf_felder(e);
    let Some(id) = id else {
        let id = sqlx::query(
            "INSERT INTO rechnungen (art, nummer, status, kunde_id, kunde_name, kunde_adresse, datum, leistung_von,
               leistung_bis, faellig_am, betreff, einleitung, schlusstext, summe_cent, zahlungsart, bezahlt_am,
               vorlage_id, termin_id, entwurf_json, erstellt_am, geaendert_am)
             VALUES (?, NULL, 'entwurf', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&e.art)
        .bind(e.kunde_id)
        .bind(&e.kunde_name)
        .bind(&e.kunde_adresse)
        .bind(&e.datum)
        .bind(&e.leistung_von)
        .bind(&e.leistung_bis)
        .bind(&e.faellig_am)
        .bind(&e.betreff)
        .bind(&e.einleitung)
        .bind(&e.schlusstext)
        .bind(e.summe_cent)
        .bind(&e.zahlungsart)
        .bind(&e.bezahlt_am)
        .bind(e.vorlage_id)
        .bind(e.termin_id)
        .bind(&e.zusatz)
        .bind(zeitpunkt)
        .bind(zeitpunkt)
        .execute(&mut *tx)
        .await
        .map_err(db_fehler)?
        .last_insert_rowid();
        positionen_schreiben(tx, id, &e.positionen).await?;
        let mut zeile = zeile_json(tx, "rechnungen", id).await?.unwrap_or_default();
        zeile.insert("positionen".into(), positionen_wert(&e.positionen));
        protokollieren(tx, zeitpunkt, "rechnungen", id, "neu", None, Some(&zeile)).await?;
        return Ok(id);
    };
    let mut alt = entwurf_lesen(tx, id).await?;
    let alte_positionen = positionen_lesen(tx, id).await?;
    alt.insert("positionen".into(), positionen_wert(&alte_positionen));
    let (diff_alt, diff_neu) = unterschiede(&alt, &neu);
    if diff_neu.is_empty() {
        return Ok(id);
    }
    sqlx::query(
        "UPDATE rechnungen SET art = ?, kunde_id = ?, kunde_name = ?, kunde_adresse = ?, datum = ?,
           leistung_von = ?, leistung_bis = ?, faellig_am = ?, betreff = ?, einleitung = ?, schlusstext = ?,
           summe_cent = ?, zahlungsart = ?, bezahlt_am = ?, vorlage_id = ?, termin_id = ?, entwurf_json = ?,
           geaendert_am = ?
         WHERE id = ? AND nummer IS NULL",
    )
    .bind(&e.art)
    .bind(e.kunde_id)
    .bind(&e.kunde_name)
    .bind(&e.kunde_adresse)
    .bind(&e.datum)
    .bind(&e.leistung_von)
    .bind(&e.leistung_bis)
    .bind(&e.faellig_am)
    .bind(&e.betreff)
    .bind(&e.einleitung)
    .bind(&e.schlusstext)
    .bind(e.summe_cent)
    .bind(&e.zahlungsart)
    .bind(&e.bezahlt_am)
    .bind(e.vorlage_id)
    .bind(e.termin_id)
    .bind(&e.zusatz)
    .bind(zeitpunkt)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_fehler)?;
    if diff_neu.contains_key("positionen") {
        sqlx::query("DELETE FROM rechnungspositionen WHERE rechnung_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_fehler)?;
        positionen_schreiben(tx, id, &e.positionen).await?;
    }
    protokollieren(
        tx,
        zeitpunkt,
        "rechnungen",
        id,
        "geaendert",
        Some(&diff_alt),
        Some(&diff_neu),
    )
    .await?;
    Ok(id)
}

/// Entwurf anlegen (`id` None) oder speichern.
pub async fn entwurf_speichern(
    conn: &mut SqliteConnection,
    id: Option<i64>,
    daten: &EntwurfEingabe,
    zeitpunkt: &str,
) -> Result<BelegErgebnis, String> {
    let e = pruefen(daten)?;
    in_transaktion(conn, async |tx| {
        let id = entwurf_schreiben(tx, id, &e, zeitpunkt).await?;
        Ok(BelegErgebnis {
            id,
            status: "entwurf".into(),
            kunde_id: e.kunde_id,
            ..BelegErgebnis::default()
        })
    })
    .await
}

/// Entwurf verwerfen (noch ohne Nummer, deshalb kein Storno; Protokoll 'geloescht_entwurf' mit der ganzen Zeile).
/// Stammt er aus einem Angebot, gilt das Angebot wieder als offen.
pub async fn entwurf_loeschen(
    conn: &mut SqliteConnection,
    id: i64,
    zeitpunkt: &str,
) -> Result<BelegErgebnis, String> {
    in_transaktion(conn, async |tx| {
        entwurf_loeschen_in(tx, id, zeitpunkt).await?;
        Ok(BelegErgebnis {
            id,
            status: "geloescht".into(),
            ..BelegErgebnis::default()
        })
    })
    .await
}

/// Verwirft einen Entwurf in der Transaktion des Aufrufers (auch termine.rs: Absagen, „Ohne Beleg“).
pub(crate) async fn entwurf_loeschen_in(
    tx: &mut SqliteConnection,
    id: i64,
    zeitpunkt: &str,
) -> Result<(), String> {
    let mut alt = entwurf_lesen(tx, id).await?;
    let positionen = positionen_lesen(tx, id).await?;
    alt.insert("positionen".into(), positionen_wert(&positionen));
    let zusatz: Map<String, Value> = text(&alt, "entwurf_json")
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    if let Some(angebot) = zusatz.get("aus_angebot").and_then(Value::as_i64) {
        let (a, _) = ausgestellt_lesen(tx, angebot).await?;
        if text(&a, "status").as_deref() == Some("angenommen") {
            status_setzen(tx, angebot, &a, "offen", None, None, zeitpunkt).await?;
        }
    }
    sqlx::query("DELETE FROM rechnungspositionen WHERE rechnung_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_fehler)?;
    sqlx::query("DELETE FROM rechnungen WHERE id = ? AND nummer IS NULL")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_fehler)?;
    protokollieren(
        tx,
        zeitpunkt,
        "rechnungen",
        id,
        "geloescht_entwurf",
        Some(&alt),
        None,
    )
    .await
}

/// Ein Entwurf als Eingabe, wie sie `entwurf_speichern` annimmt – zum Wiederherstellen eines verworfenen Entwurfs
/// („Rückgängig“ bei Terminen).
pub(crate) async fn entwurf_eingabe_lesen(
    tx: &mut SqliteConnection,
    id: i64,
) -> Result<EntwurfEingabe, String> {
    let z = entwurf_lesen(tx, id).await?;
    let mut positionen = Vec::new();
    for p in positionen_lesen(tx, id).await? {
        positionen.push(PositionEingabe {
            beschreibung: p.beschreibung,
            menge: p.menge,
            einheit: p.einheit,
            einzelpreis_cent: p.einzelpreis_cent,
            kategorie_id: p.kategorie_id,
        });
    }
    let zusatz: Map<String, Value> = text(&z, "entwurf_json")
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    Ok(EntwurfEingabe {
        art: text(&z, "art").unwrap_or_default(),
        kunde_id: zahl(&z, "kunde_id"),
        kunde_name: text(&z, "kunde_name"),
        kunde_adresse: text(&z, "kunde_adresse"),
        datum: text(&z, "datum").unwrap_or_default(),
        leistung_von: text(&z, "leistung_von"),
        leistung_bis: text(&z, "leistung_bis"),
        faellig_am: text(&z, "faellig_am"),
        betreff: text(&z, "betreff"),
        einleitung: text(&z, "einleitung"),
        schlusstext: text(&z, "schlusstext"),
        zahlungsart: text(&z, "zahlungsart"),
        bezahlt_am: text(&z, "bezahlt_am"),
        vorlage_id: zahl(&z, "vorlage_id"),
        termin_id: zahl(&z, "termin_id"),
        positionen,
        zusatz,
    })
}

/// Für einen Termin vorbereiteter Beleg (Quittung oder Rechnung als Entwurf ohne Nummer, §6.5): legt ihn an bzw.
/// gleicht den vorhandenen an. Termin und Kunde kommen vom Termin, nie aus der Eingabe. Gibt (ID, neu?) zurück.
pub(crate) async fn vorbereitung_schreiben_in(
    tx: &mut SqliteConnection,
    termin_id: i64,
    kunde_id: Option<i64>,
    daten: &EntwurfEingabe,
    zeitpunkt: &str,
) -> Result<(i64, bool), String> {
    if daten.art != "quittung" && daten.art != "rechnung" {
        return Err("Vorbereiten lassen sich nur Quittungen und Rechnungen.".into());
    }
    let mut d = daten.clone();
    d.termin_id = Some(termin_id);
    if kunde_id.is_some() {
        d.kunde_id = kunde_id;
        d.kunde_name = None;
    }
    let e = pruefen(&d)?;
    let vorhanden: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM rechnungen WHERE termin_id = ? AND nummer IS NULL ORDER BY id LIMIT 1",
    )
    .bind(termin_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_fehler)?;
    let id = entwurf_schreiben(tx, vorhanden, &e, zeitpunkt).await?;
    Ok((id, vorhanden.is_none()))
}

/* ---------- Zahlungen zum Beleg ---------- */

/// Eine Zahlung (Buchung) zu einem Beleg.
#[derive(Debug, Clone)]
struct Zahlung {
    id: i64,
    nummer: String,
    zahlungsdatum: String,
}

/// Neue Buchung zu einem Beleg (immer art 'zahlung', mit rechnung_id).
struct NeueZahlung<'a> {
    typ: &'a str,
    zahlungsdatum: &'a str,
    belegdatum: &'a str,
    betrag_cent: i64,
    kategorie_id: i64,
    kunde_id: Option<i64>,
    lieferant: Option<&'a str>,
    zahlungsart: &'a str,
    belegnummer: &'a str,
    beschreibung: &'a str,
    rechnung_id: i64,
    /// Termin, zu dem die Zahlung gehört („Offene Rechnung zuordnen“ aus der Erfassen-Schublade zum Termin)
    termin_id: Option<i64>,
}

async fn zahlung_buchen(
    tx: &mut SqliteConnection,
    z: &NeueZahlung<'_>,
    jahr_heute: i64,
    zeitpunkt: &str,
) -> Result<Zahlung, String> {
    let bis = festgeschrieben_bis(tx).await?;
    if ist_festgeschrieben(&bis, z.zahlungsdatum) {
        return Err(festgeschrieben_meldung(&bis));
    }
    kategorie_pruefen(tx, z.kategorie_id, z.typ, None).await?;
    let nummer = nummern::vergeben_fortlaufend(tx, "buchung", jahr_heute).await?;
    let id = sqlx::query(
        "INSERT INTO buchungen (nummer, typ, zahlungsdatum, belegdatum, betrag_cent, privatanteil_prozent,
           kategorie_id, kunde_id, lieferant, art, zahlungsart, belegnummer, beschreibung, rechnung_id, termin_id,
           erstellt_am, geaendert_am)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'zahlung', ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&nummer)
    .bind(z.typ)
    .bind(z.zahlungsdatum)
    .bind(z.belegdatum)
    .bind(z.betrag_cent)
    .bind(z.kategorie_id)
    .bind(z.kunde_id)
    .bind(z.lieferant)
    .bind(z.zahlungsart)
    .bind(z.belegnummer)
    .bind(z.beschreibung)
    .bind(z.rechnung_id)
    .bind(z.termin_id)
    .bind(zeitpunkt)
    .bind(zeitpunkt)
    .execute(&mut *tx)
    .await
    .map_err(db_fehler)?
    .last_insert_rowid();
    let neu = zeile_json(tx, "buchungen", id).await?;
    protokollieren(tx, zeitpunkt, "buchungen", id, "neu", None, neu.as_ref()).await?;
    Ok(Zahlung {
        id,
        nummer,
        zahlungsdatum: z.zahlungsdatum.to_string(),
    })
}

/// Schon erfasste Zahlung mit dem Beleg verknüpfen: muss zur Belegart passen, frei sein (nicht storniert, noch ohne
/// Beleg) und genau den Betrag haben.
async fn zahlung_verknuepfen(
    tx: &mut SqliteConnection,
    buchung_id: i64,
    e: &Entwurf,
    rechnung_id: i64,
    nummer: &str,
    zeitpunkt: &str,
) -> Result<Zahlung, String> {
    let Some(z) = zeile_json(tx, "buchungen", buchung_id).await? else {
        return Err("Die verknüpfte Zahlung gibt es nicht.".into());
    };
    let nr = text(&z, "nummer").unwrap_or_default();
    let typ = if e.art == "eigenbeleg" {
        "ausgabe"
    } else {
        "einnahme"
    };
    if e.art == "angebot" || text(&z, "typ").as_deref() != Some(typ) {
        return Err(format!("Die Zahlung {nr} passt nicht zu diesem Beleg."));
    }
    let storniert = gibt_es(
        tx,
        "SELECT count(*) FROM buchungen WHERE storno_von_id = ?",
        buchung_id,
    )
    .await?;
    if storniert || zahl(&z, "storno_von_id").is_some() {
        return Err(format!("Die Zahlung {nr} ist storniert."));
    }
    if zahl(&z, "rechnung_id").is_some() {
        return Err(format!("Die Zahlung {nr} gehört schon zu einem Beleg."));
    }
    if zahl(&z, "betrag_cent") != Some(e.summe_cent) {
        return Err(format!(
            "Der Beleg ({}) passt nicht zum Betrag der Zahlung {nr}.",
            euro(e.summe_cent)
        ));
    }
    sqlx::query(
        "UPDATE buchungen SET rechnung_id = ?, belegnummer = ?, geaendert_am = ? WHERE id = ?",
    )
    .bind(rechnung_id)
    .bind(nummer)
    .bind(zeitpunkt)
    .bind(buchung_id)
    .execute(&mut *tx)
    .await
    .map_err(db_fehler)?;
    let mut alt = Map::new();
    alt.insert("rechnung_id".into(), Value::Null);
    alt.insert(
        "belegnummer".into(),
        z.get("belegnummer").cloned().unwrap_or_default(),
    );
    let mut neu = Map::new();
    neu.insert("rechnung_id".into(), rechnung_id.into());
    neu.insert("belegnummer".into(), nummer.into());
    protokollieren(
        tx,
        zeitpunkt,
        "buchungen",
        buchung_id,
        "geaendert",
        Some(&alt),
        Some(&neu),
    )
    .await?;
    Ok(Zahlung {
        id: buchung_id,
        nummer: nr,
        zahlungsdatum: text(&z, "zahlungsdatum").unwrap_or_default(),
    })
}

/// Einnahme-Kategorie: gewählte, sonst die der ersten Position (wenn sie eine Einnahme-Kategorie ist), sonst die erste
/// aktive. Ob sie passt und aktiv ist, prüft `kategorie_pruefen` beim Buchen.
async fn einnahme_kategorie(
    tx: &mut SqliteConnection,
    gewaehlt: Option<i64>,
    positionen: &[Position],
) -> Result<i64, String> {
    if let Some(k) = gewaehlt {
        return Ok(k);
    }
    if let Some(k) = positionen.first().and_then(|p| p.kategorie_id) {
        let typ: Option<String> = sqlx::query_scalar("SELECT typ FROM kategorien WHERE id = ?")
            .bind(k)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_fehler)?;
        if typ.as_deref() == Some("einnahme") {
            return Ok(k);
        }
    }
    let erste: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM kategorien WHERE typ = 'einnahme' AND archiviert = 0 ORDER BY sortierung, id LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_fehler)?;
    erste.ok_or_else(|| "Es gibt keine aktive Einnahme-Kategorie.".to_string())
}

/// Beschreibung der Buchung: Betreff, sonst erste Position, sonst die Belegart.
fn buchungstext(betreff: Option<&str>, positionen: &[Position], art: &str) -> String {
    betreff
        .map(|b| b.lines().next().unwrap_or(b).trim().to_string())
        .filter(|b| !b.is_empty())
        .or_else(|| {
            positionen
                .first()
                .map(|p| p.beschreibung.replace('\n', " "))
        })
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| art_name(art).to_string())
}

/// Aktive Zahlung eines Belegs (nicht storniert, keine Gegenbuchung), die jüngste zuerst.
async fn aktive_zahlung(
    tx: &mut SqliteConnection,
    rechnung_id: i64,
) -> Result<Option<i64>, String> {
    sqlx::query_scalar(
        "SELECT b.id FROM buchungen b
         WHERE b.rechnung_id = ? AND b.storno_von_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM buchungen s WHERE s.storno_von_id = b.id)
         ORDER BY b.id DESC LIMIT 1",
    )
    .bind(rechnung_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_fehler)
}

/// Nimmt die aktive Zahlung eines Belegs per Gegenbuchung zurück; gibt deren Nummer zurück (None = keine Zahlung).
async fn zahlung_zuruecknehmen(
    tx: &mut SqliteConnection,
    rechnung_id: i64,
    heute: &str,
    jahr_heute: i64,
    zeitpunkt: &str,
) -> Result<Option<String>, String> {
    let Some(b) = aktive_zahlung(tx, rechnung_id).await? else {
        return Ok(None);
    };
    let Some(zeile) = zeile_json(tx, "buchungen", b).await? else {
        return Ok(None);
    };
    let (_, nummer) = gegenbuchung_in(tx, b, &zeile, heute, jahr_heute, zeitpunkt).await?;
    Ok(Some(nummer))
}

/* ---------- Ausstellen ---------- */

/// Speichert den Entwurf (`id` None = neu) und stellt ihn in derselben Transaktion aus.
pub async fn ausstellen(
    conn: &mut SqliteConnection,
    id: Option<i64>,
    daten: &EntwurfEingabe,
    a: &AusstellenEingabe,
    zeitpunkt: &str,
) -> Result<BelegErgebnis, String> {
    let e = pruefen(daten)?;
    ausstellbar_pruefen(&e)?;
    let (jahr_heute, _, _) = datum_lesen("Heutiges Datum", &a.heute)?;
    in_transaktion(conn, async |tx| {
        let id = entwurf_schreiben(tx, id, &e, zeitpunkt).await?;
        ausstellen_in(tx, id, &e, a, jahr_heute, zeitpunkt).await
    })
    .await
}

async fn ausstellen_in(
    tx: &mut SqliteConnection,
    id: i64,
    e: &Entwurf,
    a: &AusstellenEingabe,
    jahr_heute: i64,
    zeitpunkt: &str,
) -> Result<BelegErgebnis, String> {
    let alt = entwurf_lesen(tx, id).await?;
    let Value::Object(mut dok) = a.dokument.clone() else {
        return Err("Das Belegdokument fehlt.".into());
    };
    if !a.bausteine.is_array() {
        return Err("Die Bausteine der Vorlage fehlen.".into());
    }
    let art = e.art.as_str();
    let zahlungsart = match (&e.zahlungsart, art) {
        (Some(z), _) => z.clone(),
        (None, "quittung" | "eigenbeleg") => "bar".to_string(),
        (None, _) => "bank".to_string(),
    };
    // Beleg zu einem Termin: ein Besuch bekommt höchstens einen gültigen Beleg bzw. eine Einnahme
    let fuer_termin = art == "quittung" || art == "rechnung";
    let termin = if fuer_termin { e.termin_id } else { None };
    if let Some(t) = termin {
        termine::abschluss_pruefen(tx, t).await?;
    }

    let kunde = kunde_festhalten(tx, e, jahr_heute, zeitpunkt).await?;
    let (jahr_beleg, _, _) = datum_lesen("Belegdatum", &e.datum)?;
    let nummer = nummern::vergeben_fortlaufend(tx, art, jahr_beleg).await?;

    // Einnahme-Kategorie an den Positionen festhalten (für die Zahlung, auch eine spätere) – vor der Nummer, danach
    // sind die Positionen festgeschrieben
    let kategorie = match art {
        "eigenbeleg" => e.positionen[0].kategorie_id.unwrap_or_default(),
        _ => einnahme_kategorie(tx, a.kategorie_id, &e.positionen).await?,
    };
    if art == "quittung" || art == "rechnung" {
        kategorie_pruefen(tx, kategorie, "einnahme", None).await?;
        sqlx::query("UPDATE rechnungspositionen SET kategorie_id = ? WHERE rechnung_id = ?")
            .bind(kategorie)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_fehler)?;
    }

    // Zahlung: schon erfasste verknüpfen oder (Quittung, Eigenbeleg, bezahlte Rechnung) neu buchen
    let vorhanden = match e.buchung_id {
        Some(b) => Some(zahlung_verknuepfen(tx, b, e, id, &nummer, zeitpunkt).await?),
        None => None,
    };
    let bezahlt_am = match art {
        "quittung" | "eigenbeleg" => Some(e.datum.clone()),
        "rechnung" => match &vorhanden {
            Some(v) => Some(v.zahlungsdatum.clone()),
            None => e.bezahlt_am.clone(),
        },
        _ => None,
    };
    let status = match (art, &bezahlt_am) {
        ("angebot", _) | ("rechnung", None) => "offen",
        _ => "bezahlt",
    };
    let zahlung = match (&vorhanden, &bezahlt_am) {
        (Some(v), _) => Some(v.clone()),
        (None, Some(am)) => {
            let eigen = art == "eigenbeleg";
            let beschreibung = buchungstext(e.betreff.as_deref(), &e.positionen, art);
            let neu = NeueZahlung {
                typ: if eigen { "ausgabe" } else { "einnahme" },
                zahlungsdatum: am,
                belegdatum: &e.datum,
                betrag_cent: e.summe_cent,
                kategorie_id: kategorie,
                kunde_id: kunde.id,
                lieferant: eigen.then_some(kunde.name.as_str()),
                zahlungsart: &zahlungsart,
                belegnummer: &nummer,
                beschreibung: &beschreibung,
                rechnung_id: id,
                termin_id: None,
            };
            Some(zahlung_buchen(tx, &neu, jahr_heute, zeitpunkt).await?)
        }
        (None, None) => None,
    };

    // Schnappschuss: das Dokument des Frontends, alles Bekannte aus der Datenbank
    let quittiert = match &bezahlt_am {
        Some(am) if art == "rechnung" && am.as_str() <= e.datum.as_str() => {
            serde_json::json!({ "am": am, "zahlungsweg": zahlungsart })
        }
        _ => Value::Null,
    };
    let zahlungsweg = match art {
        "angebot" => Value::Null,
        "rechnung" if bezahlt_am.is_none() => Value::Null,
        _ => zahlungsart.clone().into(),
    };
    dok.insert("art".into(), art.into());
    dok.insert("nummer".into(), nummer.clone().into());
    dok.insert("storniert".into(), false.into());
    dok.insert("datum".into(), e.datum.clone().into());
    dok.insert("leistung_von".into(), e.leistung_von.clone().into());
    dok.insert("leistung_bis".into(), e.leistung_bis.clone().into());
    dok.insert("faellig_am".into(), e.faellig_am.clone().into());
    dok.insert("kunde".into(), kunde.json());
    let t = |v: &Option<String>| v.clone().unwrap_or_default();
    dok.insert("betreff".into(), t(&e.betreff).into());
    dok.insert("einleitung".into(), t(&e.einleitung).into());
    dok.insert("schlusstext".into(), t(&e.schlusstext).into());
    dok.insert("positionen".into(), positionen_dokument(&e.positionen));
    dok.insert("zahlungsweg".into(), zahlungsweg);
    dok.insert("quittiert".into(), quittiert);
    dok.insert("ausgestellt_am".into(), a.heute.clone().into());
    if art == "eigenbeleg" {
        let kategorie_name: Option<String> =
            sqlx::query_scalar("SELECT name FROM kategorien WHERE id = ?")
                .bind(kategorie)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db_fehler)?;
        let gebucht = match &zahlung {
            Some(z) => serde_json::json!({
                "nummer": z.nummer,
                "kategorie": kategorie_name.unwrap_or_default(),
            }),
            None => Value::Null,
        };
        let mut eigen = match dok.remove("eigenbeleg") {
            Some(Value::Object(m)) => m,
            _ => Map::new(),
        };
        eigen.insert("gebucht".into(), gebucht);
        dok.insert("eigenbeleg".into(), Value::Object(eigen));
    }
    let schnappschuss = serde_json::json!({
        "version": 1,
        "dokument": Value::Object(dok),
        "bausteine": a.bausteine,
    })
    .to_string();
    if schnappschuss.len() > MAX_SCHNAPPSCHUSS {
        return Err("Der Beleg ist zu groß zum Ausstellen.".into());
    }

    let kunde_adresse = if art == "eigenbeleg" {
        e.kunde_adresse.clone()
    } else {
        kunde.anschrift.text()
    };
    let kunde_name = (!kunde.name.is_empty()).then(|| kunde.name.clone());
    let zahlungsart_spalte = (art != "angebot" && status == "bezahlt").then_some(&zahlungsart);
    sqlx::query(
        "UPDATE rechnungen SET nummer = ?, status = ?, kunde_id = ?, kunde_name = ?, kunde_adresse = ?,
           kunde_nummer = ?, bezahlt_am = ?, zahlungsart = ?, snapshot_json = ?, geaendert_am = ?
         WHERE id = ? AND nummer IS NULL",
    )
    .bind(&nummer)
    .bind(status)
    .bind(kunde.id)
    .bind(&kunde_name)
    .bind(&kunde_adresse)
    .bind(&kunde.nummer)
    .bind(&bezahlt_am)
    .bind(zahlungsart_spalte)
    .bind(&schnappschuss)
    .bind(zeitpunkt)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_fehler)?;

    // Termin, zu dem der Beleg vorbereitet war: mit dem Ausstellen erledigt (auch nach „Ohne Beleg“ – dann doch mit)
    if let Some(t) = termin {
        termine::mit_beleg_erledigen_in(tx, t, zeitpunkt).await?;
    }

    let mut neu_zeile = zeile_json(tx, "rechnungen", id).await?.unwrap_or_default();
    neu_zeile.retain(|k, _| k != "erstellt_am");
    let (diff_alt, diff_neu) = unterschiede(&alt, &neu_zeile);
    protokollieren(
        tx,
        zeitpunkt,
        "rechnungen",
        id,
        "geaendert",
        Some(&diff_alt),
        Some(&diff_neu),
    )
    .await?;
    Ok(BelegErgebnis {
        id,
        nummer: Some(nummer),
        status: status.into(),
        kunde_id: kunde.id,
        kunde_nummer: kunde.nummer.clone(),
        kunde_neu: kunde.neu,
        buchung_id: zahlung.as_ref().map(|z| z.id),
        buchung_nummer: zahlung.map(|z| z.nummer),
        ..BelegErgebnis::default()
    })
}

/* ---------- Status ---------- */

/// Status (mit bezahlt_am und zahlungsart) eines ausgestellten Belegs setzen und protokollieren.
async fn status_setzen(
    tx: &mut SqliteConnection,
    id: i64,
    alt: &Map<String, Value>,
    status: &str,
    bezahlt_am: Option<&str>,
    zahlungsart: Option<&str>,
    zeitpunkt: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE rechnungen SET status = ?, bezahlt_am = ?, zahlungsart = ?, geaendert_am = ? WHERE id = ?",
    )
    .bind(status)
    .bind(bezahlt_am)
    .bind(zahlungsart)
    .bind(zeitpunkt)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_fehler)?;
    let mut neu = Map::new();
    neu.insert("status".into(), status.into());
    neu.insert("bezahlt_am".into(), bezahlt_am.into());
    neu.insert("zahlungsart".into(), zahlungsart.into());
    let (diff_alt, diff_neu) = unterschiede(alt, &neu);
    protokollieren(
        tx,
        zeitpunkt,
        "rechnungen",
        id,
        "geaendert",
        Some(&diff_alt),
        Some(&diff_neu),
    )
    .await
}

/// Offene Rechnung als bezahlt markieren: Einnahme am Tag des Zahlungseingangs (mit `rechnung_id`).
/// Mit `termin` („Offene Rechnung zuordnen“ in der Erfassen-Schublade zum Termin) wird die Rechnung zum Beleg des
/// Termins: Die Einnahme verweist auf ihn (die ausgestellte Rechnung selbst bleibt unverändert, GoBD), der Termin ist
/// erledigt und sein vorbereiteter Entwurf wird verworfen.
pub async fn bezahlt(
    conn: &mut SqliteConnection,
    id: i64,
    datum: &str,
    zahlungsart: &str,
    heute: &str,
    termin: Option<i64>,
    zeitpunkt: &str,
) -> Result<BelegErgebnis, String> {
    datum_lesen("Zahlungseingang", datum)?;
    zahlungsart_pruefen(Some(zahlungsart))?;
    let (jahr_heute, _, _) = datum_lesen("Heutiges Datum", heute)?;
    in_transaktion(conn, async |tx| {
        let (alt, nummer) = ausgestellt_lesen(tx, id).await?;
        if text(&alt, "art").as_deref() != Some("rechnung") {
            return Err("Als bezahlt markieren lassen sich nur Rechnungen.".into());
        }
        if text(&alt, "status").as_deref() != Some("offen") {
            return Err(format!("Die Rechnung {nummer} ist nicht offen."));
        }
        // zu genau diesem Termin ausgestellt: der Termin hat seinen Beleg schon
        let termin = termin.filter(|t| zahl(&alt, "termin_id") != Some(*t));
        if let Some(t) = termin {
            termine::abschluss_pruefen(tx, t).await?;
        }
        let positionen = positionen_lesen(tx, id).await?;
        let kategorie = einnahme_kategorie(tx, None, &positionen).await?;
        let belegdatum = text(&alt, "datum").unwrap_or_default();
        let betreff = text(&alt, "betreff");
        let beschreibung = buchungstext(betreff.as_deref(), &positionen, "rechnung");
        let neu = NeueZahlung {
            typ: "einnahme",
            zahlungsdatum: datum,
            belegdatum: &belegdatum,
            betrag_cent: zahl(&alt, "summe_cent").unwrap_or_default(),
            kategorie_id: kategorie,
            kunde_id: zahl(&alt, "kunde_id"),
            lieferant: None,
            zahlungsart,
            belegnummer: &nummer,
            beschreibung: &beschreibung,
            rechnung_id: id,
            termin_id: termin,
        };
        let z = zahlung_buchen(tx, &neu, jahr_heute, zeitpunkt).await?;
        let (am, wie) = (Some(datum), Some(zahlungsart));
        status_setzen(tx, id, &alt, "bezahlt", am, wie, zeitpunkt).await?;
        if let Some(t) = termin {
            termine::abschliessen_in(tx, t, false, zeitpunkt).await?;
        }
        Ok(BelegErgebnis {
            id,
            nummer: Some(nummer),
            status: "bezahlt".into(),
            kunde_id: zahl(&alt, "kunde_id"),
            buchung_id: Some(z.id),
            buchung_nummer: Some(z.nummer),
            ..BelegErgebnis::default()
        })
    })
    .await
}

/// Bezahlte Rechnung doch wieder offen: die Einnahme wird per Gegenbuchung zurückgenommen (GoBD, nie löschen).
pub async fn wieder_offen(
    conn: &mut SqliteConnection,
    id: i64,
    heute: &str,
    zeitpunkt: &str,
) -> Result<BelegErgebnis, String> {
    let (jahr_heute, _, _) = datum_lesen("Heutiges Datum", heute)?;
    in_transaktion(conn, async |tx| {
        let (alt, nummer) = ausgestellt_lesen(tx, id).await?;
        if text(&alt, "art").as_deref() != Some("rechnung") {
            return Err("Nur Rechnungen können wieder offen sein.".into());
        }
        if text(&alt, "status").as_deref() != Some("bezahlt") {
            return Err(format!("Die Rechnung {nummer} ist nicht bezahlt."));
        }
        let gegen = zahlung_zuruecknehmen(tx, id, heute, jahr_heute, zeitpunkt).await?;
        status_setzen(tx, id, &alt, "offen", None, None, zeitpunkt).await?;
        Ok(BelegErgebnis {
            id,
            nummer: Some(nummer),
            status: "offen".into(),
            kunde_id: zahl(&alt, "kunde_id"),
            gegenbuchung_nummer: gegen,
            ..BelegErgebnis::default()
        })
    })
    .await
}

/// Angebot offen ⇄ abgelehnt („angenommen“ nur über `umwandeln`).
pub async fn angebot_status(
    conn: &mut SqliteConnection,
    id: i64,
    status: &str,
    zeitpunkt: &str,
) -> Result<BelegErgebnis, String> {
    if !matches!(status, "offen" | "abgelehnt") {
        return Err(format!("Unbekannter Status „{status}“ für ein Angebot."));
    }
    in_transaktion(conn, async |tx| {
        let (alt, nummer) = ausgestellt_lesen(tx, id).await?;
        if text(&alt, "art").as_deref() != Some("angebot") {
            return Err(format!("{nummer} ist kein Angebot."));
        }
        match text(&alt, "status").as_deref() {
            Some("angenommen") => {
                return Err(format!("Das Angebot {nummer} ist schon umgewandelt."));
            }
            Some("storniert") => return Err(format!("Das Angebot {nummer} ist storniert.")),
            Some(s) if s == status => {}
            _ => status_setzen(tx, id, &alt, status, None, None, zeitpunkt).await?,
        }
        Ok(BelegErgebnis {
            id,
            nummer: Some(nummer),
            status: status.into(),
            kunde_id: zahl(&alt, "kunde_id"),
            ..BelegErgebnis::default()
        })
    })
    .await
}

/// Angebot ⇒ Rechnung: neuer Rechnungsentwurf mit Kunde, Betreff und Positionen; das Angebot gilt als angenommen.
pub async fn umwandeln(
    conn: &mut SqliteConnection,
    id: i64,
    u: &UmwandelnEingabe,
    zeitpunkt: &str,
) -> Result<BelegErgebnis, String> {
    datum_lesen("Heutiges Datum", &u.heute)?;
    let faellig_am = datum_optional("Fälligkeit", &u.faellig_am)?;
    in_transaktion(conn, async |tx| {
        let (alt, nummer) = ausgestellt_lesen(tx, id).await?;
        if text(&alt, "art").as_deref() != Some("angebot") {
            return Err(format!("{nummer} ist kein Angebot."));
        }
        match text(&alt, "status").as_deref() {
            Some("angenommen") => {
                return Err(format!("Das Angebot {nummer} ist schon umgewandelt."));
            }
            Some("storniert") => return Err(format!("Das Angebot {nummer} ist storniert.")),
            _ => {}
        }
        let mut positionen = positionen_lesen(tx, id).await?;
        for p in &mut positionen {
            p.kategorie_id = None;
        }
        let kunde_id = zahl(&alt, "kunde_id");
        let mut zusatz = Map::new();
        zusatz.insert("aus_angebot".into(), id.into());
        let e = Entwurf {
            art: "rechnung".into(),
            kunde_id,
            kunde_name: kunde_id.map_or_else(|| text(&alt, "kunde_name"), |_| None),
            kunde_adresse: kunde_id.map_or_else(|| text(&alt, "kunde_adresse"), |_| None),
            datum: u.heute.clone(),
            leistung_von: Some(u.heute.clone()),
            leistung_bis: None,
            faellig_am: faellig_am.clone(),
            betreff: text(&alt, "betreff"),
            einleitung: mehrzeilig(&u.einleitung),
            schlusstext: mehrzeilig(&u.schlusstext),
            zahlungsart: Some("bank".into()),
            bezahlt_am: None,
            vorlage_id: None,
            termin_id: None,
            summe_cent: zahl(&alt, "summe_cent").unwrap_or_default(),
            positionen,
            zusatz: Some(Value::Object(zusatz).to_string()),
            buchung_id: None,
        };
        let neu_id = entwurf_schreiben(tx, None, &e, zeitpunkt).await?;
        status_setzen(tx, id, &alt, "angenommen", None, None, zeitpunkt).await?;
        Ok(BelegErgebnis {
            id,
            nummer: Some(nummer),
            status: "angenommen".into(),
            kunde_id,
            entwurf_id: Some(neu_id),
            ..BelegErgebnis::default()
        })
    })
    .await
}

/* ---------- Stornieren ---------- */

/// Storniert einen ausgestellten Beleg (GoBD: nie löschen, nie ändern): Gegenbuchung der Zahlung, Stornobeleg mit
/// eigener Nummer aus dem Kreis des Originals und negativen Positionen, Original „storniert“ (endgültig).
pub async fn stornieren(
    conn: &mut SqliteConnection,
    id: i64,
    heute: &str,
    zeitpunkt: &str,
) -> Result<BelegErgebnis, String> {
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
) -> Result<BelegErgebnis, String> {
    let (alt, nummer) = ausgestellt_lesen(tx, id).await?;
    let art = text(&alt, "art").unwrap_or_default();
    if art == "storno" {
        return Err(format!("{nummer} ist selbst ein Stornobeleg."));
    }
    if art == "angebot" {
        return Err("Angebote werden nicht storniert, sondern als abgelehnt markiert.".into());
    }
    if text(&alt, "status").as_deref() == Some("storniert") {
        return Err(format!("{} {nummer} ist schon storniert.", art_name(&art)));
    }

    let gegen = zahlung_zuruecknehmen(tx, id, heute, jahr_heute, zeitpunkt).await?;

    // Stornobeleg: erst ohne Nummer, dann die Positionen, zuletzt Nummer und Schnappschuss (Trigger aus 0007)
    let mut positionen = positionen_lesen(tx, id).await?;
    for p in &mut positionen {
        p.einzelpreis_cent = -p.einzelpreis_cent;
    }
    let datum_original = text(&alt, "datum").unwrap_or_default();
    let betreff = format!(
        "Storno zu {} {nummer} vom {}",
        art_name(&art),
        datum_de(&datum_original)
    );
    let storno_id = sqlx::query(
        "INSERT INTO rechnungen (art, nummer, status, kunde_id, kunde_name, kunde_adresse, kunde_nummer, datum,
           leistung_von, leistung_bis, betreff, summe_cent, zahlungsart, storno_von_id, erstellt_am, geaendert_am)
         SELECT 'storno', NULL, 'storniert', kunde_id, kunde_name, kunde_adresse, kunde_nummer, ?,
           leistung_von, leistung_bis, ?, -summe_cent, zahlungsart, id, ?, ?
         FROM rechnungen WHERE id = ?",
    )
    .bind(heute)
    .bind(&betreff)
    .bind(zeitpunkt)
    .bind(zeitpunkt)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_fehler)?
    .last_insert_rowid();
    positionen_schreiben(tx, storno_id, &positionen).await?;
    let storno_nummer = nummern::vergeben_fortlaufend(tx, &art, jahr_heute).await?;
    let schnappschuss = storno_schnappschuss(&alt, &storno_nummer, heute, &positionen, &betreff);
    sqlx::query("UPDATE rechnungen SET nummer = ?, snapshot_json = ? WHERE id = ?")
        .bind(&storno_nummer)
        .bind(&schnappschuss)
        .bind(storno_id)
        .execute(&mut *tx)
        .await
        .map_err(db_fehler)?;
    let mut storno_zeile = zeile_json(tx, "rechnungen", storno_id)
        .await?
        .unwrap_or_default();
    storno_zeile.insert("positionen".into(), positionen_wert(&positionen));
    protokollieren(
        tx,
        zeitpunkt,
        "rechnungen",
        storno_id,
        "neu",
        None,
        Some(&storno_zeile),
    )
    .await?;

    sqlx::query("UPDATE rechnungen SET status = 'storniert', geaendert_am = ? WHERE id = ?")
        .bind(zeitpunkt)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_fehler)?;
    let mut vermerk = Map::new();
    vermerk.insert("storniert_durch".into(), storno_id.into());
    vermerk.insert("storno_nummer".into(), storno_nummer.clone().into());
    protokollieren(
        tx,
        zeitpunkt,
        "rechnungen",
        id,
        "storniert",
        None,
        Some(&vermerk),
    )
    .await?;
    Ok(BelegErgebnis {
        id,
        nummer: Some(nummer),
        status: "storniert".into(),
        kunde_id: zahl(&alt, "kunde_id"),
        gegenbuchung_nummer: gegen,
        storno_id: Some(storno_id),
        storno_nummer: Some(storno_nummer),
        ..BelegErgebnis::default()
    })
}

/// Schnappschuss des Stornobelegs aus dem des Originals (None, wenn das Original keinen hat, z. B. Demo-Daten):
/// eigene Nummer und Datum, negative Positionen, Verweis `storno_von` auf das Original.
fn storno_schnappschuss(
    alt: &Map<String, Value>,
    nummer: &str,
    heute: &str,
    positionen: &[Position],
    betreff: &str,
) -> Option<String> {
    let mut snap: Map<String, Value> = serde_json::from_str(&text(alt, "snapshot_json")?).ok()?;
    let Some(Value::Object(dok)) = snap.get_mut("dokument") else {
        return None;
    };
    let original = serde_json::json!({
        "nummer": text(alt, "nummer").unwrap_or_default(),
        "datum": text(alt, "datum").unwrap_or_default(),
    });
    dok.insert("nummer".into(), nummer.into());
    dok.insert("datum".into(), heute.into());
    dok.insert("ausgestellt_am".into(), heute.into());
    dok.insert("faellig_am".into(), Value::Null);
    dok.insert("storniert".into(), false.into());
    dok.insert("storno_von".into(), original);
    dok.insert("betreff".into(), betreff.into());
    dok.insert("einleitung".into(), "".into());
    dok.insert("quittiert".into(), Value::Null);
    dok.insert("positionen".into(), positionen_dokument(positionen));
    Some(Value::Object(snap).to_string())
}

/* ---------- PDF und unterschriebenes Exemplar ---------- */

/// Legt das PDF eines ausgestellten Belegs ab (genau einmal, unverändert, Aufbewahrung ab Belegdatum) und verknüpft es
/// (`pdf_beleg_id`, bei einer aktiven Zahlung auch mit ihr). Gibt die ID in `belege` zurück.
pub async fn pdf_ablegen(
    conn: &mut SqliteConnection,
    ablage: &Path,
    id: i64,
    pdf: &[u8],
    zeitpunkt: &str,
) -> Result<i64, String> {
    if !pdf.starts_with(b"%PDF-") {
        return Err("Das ist kein PDF.".into());
    }
    belege::in_transaktion_mit_ablage(conn, ablage, async |tx, neue| {
        let (alt, nummer) = ausgestellt_lesen(tx, id).await?;
        if zahl(&alt, "pdf_beleg_id").is_some() {
            return Err(format!("Das PDF von {nummer} ist schon abgelegt."));
        }
        let datum = text(&alt, "datum").unwrap_or_default();
        let (jahr, _, _) = datum_lesen("Belegdatum", &datum)?;
        let abgelegt = belege::bytes_ablegen(ablage, pdf, "pdf", jahr)?;
        if abgelegt.neu {
            neue.push(abgelegt.pfad.clone());
        }
        let name = format!("{nummer}.pdf");
        let bis = belege::aufbewahren_bis(&datum)?;
        let zeile = belege::NeueZeile {
            buchung_id: aktive_zahlung(tx, id).await?,
            rechnung_id: Some(id),
            abgelegt: &abgelegt,
            originalname: &name,
            mime: "application/pdf",
            art: "rechnung_pdf",
            aufbewahren_bis: &bis,
        };
        let beleg_id = belege::zeile_einfuegen(tx, &zeile, zeitpunkt).await?;
        verweis_setzen(tx, id, "pdf_beleg_id", beleg_id, zeitpunkt).await?;
        Ok(beleg_id)
    })
    .await
}

/// Hängt das unterschriebene Exemplar (Scan oder Foto) an einen ausgestellten Beleg an – ergänzt ihn, ersetzt ihn nie.
pub async fn scan_anhaengen(
    conn: &mut SqliteConnection,
    ablage: &Path,
    id: i64,
    pfad: &str,
    zeitpunkt: &str,
) -> Result<i64, String> {
    let datei = belege::datei_pruefen(pfad)?;
    if datei.art != "beleg" {
        return Err("Als unterschriebenes Exemplar bitte ein PDF oder ein Bild wählen.".into());
    }
    belege::in_transaktion_mit_ablage(conn, ablage, async |tx, neue| {
        let (alt, nummer) = ausgestellt_lesen(tx, id).await?;
        if zahl(&alt, "scan_beleg_id").is_some() {
            return Err(format!(
                "An {nummer} hängt schon ein unterschriebenes Exemplar."
            ));
        }
        let datum = text(&alt, "datum").unwrap_or_default();
        let (jahr, _, _) = datum_lesen("Belegdatum", &datum)?;
        let abgelegt = belege::ablegen(ablage, &datei, jahr)?;
        if abgelegt.neu {
            neue.push(abgelegt.pfad.clone());
        }
        let bis = belege::aufbewahren_bis(&datum)?;
        let zeile = belege::NeueZeile {
            buchung_id: None,
            rechnung_id: Some(id),
            abgelegt: &abgelegt,
            originalname: &datei.name,
            mime: datei.mime,
            art: "beleg",
            aufbewahren_bis: &bis,
        };
        let beleg_id = belege::zeile_einfuegen(tx, &zeile, zeitpunkt).await?;
        verweis_setzen(tx, id, "scan_beleg_id", beleg_id, zeitpunkt).await?;
        Ok(beleg_id)
    })
    .await
}

/// `pdf_beleg_id` bzw. `scan_beleg_id` einmalig setzen (der Trigger aus 0007 erlaubt nur das Setzen aus NULL).
async fn verweis_setzen(
    tx: &mut SqliteConnection,
    id: i64,
    spalte: &str,
    beleg_id: i64,
    zeitpunkt: &str,
) -> Result<(), String> {
    let sql = match spalte {
        "pdf_beleg_id" => {
            "UPDATE rechnungen SET pdf_beleg_id = ?, geaendert_am = ? WHERE id = ? AND pdf_beleg_id IS NULL"
        }
        _ => {
            "UPDATE rechnungen SET scan_beleg_id = ?, geaendert_am = ? WHERE id = ? AND scan_beleg_id IS NULL"
        }
    };
    sqlx::query(sql)
        .bind(beleg_id)
        .bind(zeitpunkt)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_fehler)?;
    let mut alt = Map::new();
    alt.insert(spalte.into(), Value::Null);
    let mut neu = Map::new();
    neu.insert(spalte.into(), beleg_id.into());
    protokollieren(
        tx,
        zeitpunkt,
        "rechnungen",
        id,
        "geaendert",
        Some(&alt),
        Some(&neu),
    )
    .await
}

/* ---------- Tauri-Commands (dünne Hüllen) ---------- */

/// Frontend: `invoke('beleg_entwurf_speichern', { id, daten })` (id null = neu).
#[tauri::command]
pub async fn beleg_entwurf_speichern(
    instanzen: tauri::State<'_, DbInstances>,
    id: Option<i64>,
    daten: EntwurfEingabe,
) -> Result<BelegErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    entwurf_speichern(&mut c, id, &daten, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('beleg_entwurf_loeschen', { id })`.
#[tauri::command]
pub async fn beleg_entwurf_loeschen(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
) -> Result<BelegErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    entwurf_loeschen(&mut c, id, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('beleg_ausstellen', { id, daten, ausstellen })` (id null = gleich neu ausstellen).
#[tauri::command]
pub async fn beleg_ausstellen(
    instanzen: tauri::State<'_, DbInstances>,
    id: Option<i64>,
    daten: EntwurfEingabe,
    ausstellen: AusstellenEingabe,
) -> Result<BelegErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    self::ausstellen(&mut c, id, &daten, &ausstellen, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('beleg_bezahlt', { id, datum, zahlungsart, heute, termin })` (termin null = ohne Termin).
#[tauri::command]
pub async fn beleg_bezahlt(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    datum: String,
    zahlungsart: String,
    heute: String,
    termin: Option<i64>,
) -> Result<BelegErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    bezahlt(
        &mut c,
        id,
        &datum,
        &zahlungsart,
        &heute,
        termin,
        &datenbank::zeitstempel(),
    )
    .await
}

/// Frontend: `invoke('beleg_offen', { id, heute })`.
#[tauri::command]
pub async fn beleg_offen(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    heute: String,
) -> Result<BelegErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    wieder_offen(&mut c, id, &heute, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('beleg_angebot_status', { id, status })`.
#[tauri::command]
pub async fn beleg_angebot_status(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    status: String,
) -> Result<BelegErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    angebot_status(&mut c, id, &status, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('beleg_umwandeln', { id, daten })`.
#[tauri::command]
pub async fn beleg_umwandeln(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    daten: UmwandelnEingabe,
) -> Result<BelegErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    umwandeln(&mut c, id, &daten, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('beleg_stornieren', { id, heute })`.
#[tauri::command]
pub async fn beleg_stornieren(
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    heute: String,
) -> Result<BelegErgebnis, String> {
    let mut c = verbindung(&instanzen).await?;
    stornieren(&mut c, id, &heute, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('beleg_pdf_ablegen', { id, pdf })` (pdf = Bytes als Zahlenliste).
#[tauri::command]
pub async fn beleg_pdf_ablegen(
    app: tauri::AppHandle,
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    pdf: Vec<u8>,
) -> Result<i64, String> {
    let ablage = belege::ablage_ordner(&app)?;
    let mut c = verbindung(&instanzen).await?;
    pdf_ablegen(&mut c, &ablage, id, &pdf, &datenbank::zeitstempel()).await
}

/// Frontend: `invoke('beleg_scan_anhaengen', { id, pfad })`.
#[tauri::command]
pub async fn beleg_scan_anhaengen(
    app: tauri::AppHandle,
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
    pfad: String,
) -> Result<i64, String> {
    let ablage = belege::ablage_ordner(&app)?;
    let mut c = verbindung(&instanzen).await?;
    scan_anhaengen(&mut c, &ablage, id, &pfad, &datenbank::zeitstempel()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buchungen::{self, BuchungEingabe};
    use crate::datenbank::testhilfe::test_db;
    use std::path::PathBuf;

    const JETZT: &str = "2026-10-15T08:00:00Z";
    const SPAETER: &str = "2026-10-16T09:30:00Z";
    const HEUTE: &str = "2026-10-15";

    fn lauf<F: std::future::Future<Output = ()>>(f: F) {
        tauri::async_runtime::block_on(f);
    }

    fn position(text: &str, menge: f64, preis: i64) -> PositionEingabe {
        PositionEingabe {
            beschreibung: text.into(),
            menge,
            einheit: Some("Std.".into()),
            einzelpreis_cent: preis,
            kategorie_id: None,
        }
    }

    fn quittung() -> EntwurfEingabe {
        EntwurfEingabe {
            art: "quittung".into(),
            kunde_id: None,
            kunde_name: Some(" Anna Schmidt ".into()),
            kunde_adresse: Some("Gartenweg 3\n12390 Seehausen".into()),
            datum: "2026-10-14".into(),
            leistung_von: Some("2026-10-14".into()),
            leistung_bis: None,
            faellig_am: None,
            betreff: Some("Rasen mähen".into()),
            einleitung: None,
            schlusstext: Some("Danke!".into()),
            zahlungsart: Some("bar".into()),
            bezahlt_am: None,
            vorlage_id: None,
            termin_id: None,
            positionen: vec![position("Rasen mähen", 1.0, 6_500)],
            zusatz: Map::new(),
        }
    }

    fn rechnung() -> EntwurfEingabe {
        EntwurfEingabe {
            art: "rechnung".into(),
            zahlungsart: None,
            faellig_am: Some("2026-10-28".into()),
            positionen: vec![
                position("Heckenschnitt & Rasenpflege", 3.0, 4_500),
                position("Dünger", 2.5, 399),
            ],
            ..quittung()
        }
    }

    /// Dokument und Bausteine, wie das Frontend sie schickt (nur das Nötigste).
    fn frontend(art: &str) -> AusstellenEingabe {
        AusstellenEingabe {
            dokument: serde_json::json!({
                "art": art,
                "nummer": null,
                "firma": { "name": "Mustermann Haus- & Gartenservice" },
                "ust_modus": "klein",
                "eigenbeleg": { "grund": "kein", "grund_text": "", "gebucht": null }
            }),
            bausteine: serde_json::json!([{ "typ": "titel" }, { "typ": "positionen" }]),
            kategorie_id: None,
            heute: HEUTE.into(),
        }
    }

    /// `d` als neuen Beleg gleich ausstellen.
    async fn stelle_aus(
        c: &mut SqliteConnection,
        d: &EntwurfEingabe,
    ) -> Result<BelegErgebnis, String> {
        ausstellen(c, None, d, &frontend(&d.art), JETZT).await
    }

    async fn anzahl(c: &mut SqliteConnection, sql: &str) -> i64 {
        sqlx::query_scalar(sql).fetch_one(c).await.unwrap()
    }

    /// Eine Spalte einer Zeile als Text.
    async fn spalte(c: &mut SqliteConnection, tabelle: &str, sp: &str, id: i64) -> Option<String> {
        let sql = format!("SELECT {sp} FROM {tabelle} WHERE id = ?");
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

    async fn schnappschuss(c: &mut SqliteConnection, id: i64) -> Value {
        let t = spalte(c, "rechnungen", "snapshot_json", id).await;
        serde_json::from_str(&t.unwrap()).unwrap()
    }

    const SALDO: &str = "SELECT SUM(CASE WHEN storno_von_id IS NULL THEN betrag_cent ELSE -betrag_cent END) FROM buchungen";

    fn testordner(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "kladdy-test-{}-rechnungen-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn positionsbetrag_rundet_wie_das_frontend() {
        assert_eq!(position_betrag(3.0, 4_500), Ok(13_500));
        assert_eq!(position_betrag(2.5, 399), Ok(998));
        assert_eq!(position_betrag(1.333, 100), Ok(133));
        assert_eq!(position_betrag(1.0, -500), Ok(-500));
        assert_eq!(position_betrag(0.5, -3), Ok(-2));
        assert_eq!(position_betrag(0.0, 4_500), Ok(0));
        assert!(position_betrag(f64::NAN, 1).is_err());
        assert!(position_betrag(1e9, 1).is_err());
    }

    #[test]
    fn anschrift_wie_im_prototyp() {
        let a = Anschrift::lesen(" z. Hd. Frau Kaiser \nSeeufer 5\n\n12390 Seehausen ");
        assert_eq!(
            a,
            Anschrift {
                zusatz: Some("z. Hd. Frau Kaiser".into()),
                strasse: Some("Seeufer 5".into()),
                plz: Some("12390".into()),
                ort: Some("Seehausen".into()),
            }
        );
        assert_eq!(
            a.text().as_deref(),
            Some("z. Hd. Frau Kaiser\nSeeufer 5\n12390 Seehausen")
        );
        let nur_strasse = Anschrift::lesen("Lindenweg 12");
        assert_eq!(nur_strasse.strasse.as_deref(), Some("Lindenweg 12"));
        assert!(nur_strasse.plz.is_none());
        assert_eq!(Anschrift::lesen("1234 Wien").ort.as_deref(), Some("Wien"));
        assert_eq!(Anschrift::lesen("").text(), None);
        assert!(Anschrift::lesen("").ist_leer());
        assert_eq!(euro(123_456), "1.234,56\u{a0}€");
        assert_eq!(euro(-5), "−0,05\u{a0}€");
    }

    #[test]
    fn entwurf_anlegen_aendern_und_verwerfen() {
        lauf(async {
            let mut c = test_db().await;
            let r = entwurf_speichern(&mut c, None, &rechnung(), JETZT)
                .await
                .unwrap();
            assert_eq!((r.nummer.as_deref(), r.status.as_str()), (None, "entwurf"));
            let summe = anzahl(&mut c, "SELECT summe_cent FROM rechnungen").await;
            assert_eq!(summe, 13_500 + 998);
            let positionen = "SELECT count(*) FROM rechnungspositionen";
            assert_eq!(anzahl(&mut c, positionen).await, 2);
            // unverändert speichern: kein Protokoll
            entwurf_speichern(&mut c, Some(r.id), &rechnung(), SPAETER)
                .await
                .unwrap();
            assert_eq!(protokoll(&mut c).await.len(), 1);
            // ändern: nur geänderte Felder, Positionen ersetzt
            let neu = EntwurfEingabe {
                betreff: Some("Herbstschnitt".into()),
                positionen: vec![position("Herbstschnitt", 2.0, 4_000)],
                ..rechnung()
            };
            entwurf_speichern(&mut c, Some(r.id), &neu, SPAETER)
                .await
                .unwrap();
            let p = protokoll(&mut c).await;
            assert_eq!(p[1], ("rechnungen".into(), r.id, "geaendert".into()));
            let diff: String =
                sqlx::query_scalar("SELECT neu_json FROM protokoll ORDER BY id DESC LIMIT 1")
                    .fetch_one(&mut c)
                    .await
                    .unwrap();
            let diff: Value = serde_json::from_str(&diff).unwrap();
            assert_eq!(diff["betreff"], "Herbstschnitt");
            assert_eq!(diff["summe_cent"], 8_000);
            assert_eq!(diff["positionen"][0]["beschreibung"], "Herbstschnitt");
            assert!(diff.get("datum").is_none());
            assert_eq!(anzahl(&mut c, positionen).await, 1);
            // verwerfen
            entwurf_loeschen(&mut c, r.id, SPAETER).await.unwrap();
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM rechnungen").await, 0);
            assert_eq!(anzahl(&mut c, positionen).await, 0);
            assert_eq!(protokoll(&mut c).await[2].2, "geloescht_entwurf");
            // Nummern wurden keine verbraucht
            let kreis = "SELECT naechste FROM nummernkreise WHERE id = 'rechnung'";
            assert_eq!(anzahl(&mut c, kreis).await, 1);
        });
    }

    #[test]
    fn quittung_ausstellen_bucht_einnahme_und_legt_kunden_an() {
        lauf(async {
            let mut c = test_db().await;
            let r = stelle_aus(&mut c, &quittung()).await.unwrap();
            assert_eq!(r.nummer.as_deref(), Some("QU-2026-001"));
            assert_eq!(r.status, "bezahlt");
            assert_eq!(r.kunde_nummer.as_deref(), Some("K-0001"));
            assert!(r.kunde_neu);
            assert_eq!(r.buchung_nummer.as_deref(), Some("2026-0001"));
            // Kunde mit Anschrift
            let k = r.kunde_id.unwrap();
            assert_eq!(
                spalte(&mut c, "kunden", "name", k).await.as_deref(),
                Some("Anna Schmidt")
            );
            assert_eq!(
                spalte(&mut c, "kunden", "strasse", k).await.as_deref(),
                Some("Gartenweg 3")
            );
            // Einnahme mit Verweis auf den Beleg
            let b = r.buchung_id.unwrap();
            let (rid, kid) = (r.id.to_string(), k.to_string());
            for (sp, wert) in [
                ("typ", "einnahme"),
                ("betrag_cent", "6500"),
                ("rechnung_id", rid.as_str()),
                ("kunde_id", kid.as_str()),
                ("zahlungsart", "bar"),
                ("zahlungsdatum", "2026-10-14"),
                ("belegnummer", "QU-2026-001"),
                ("beschreibung", "Rasen mähen"),
            ] {
                let sql = format!("SELECT CAST({sp} AS TEXT) FROM buchungen WHERE id = ?");
                let ist: Option<String> = sqlx::query_scalar(&sql)
                    .bind(b)
                    .fetch_one(&mut c)
                    .await
                    .unwrap();
                assert_eq!(ist.as_deref(), Some(wert), "{sp}");
            }
            // Schnappschuss: Werte aus der Datenbank, Rest vom Frontend
            let s = schnappschuss(&mut c, r.id).await;
            assert_eq!(s["version"], 1);
            let d = &s["dokument"];
            assert_eq!(d["nummer"], "QU-2026-001");
            assert_eq!(d["kunde"]["name"], "Anna Schmidt");
            assert_eq!(d["kunde"]["nummer"], "K-0001");
            assert_eq!(d["kunde"]["plz"], "12390");
            assert_eq!(d["positionen"][0]["einzelpreis_cent"], 6_500);
            assert_eq!(d["zahlungsweg"], "bar");
            assert_eq!(d["schlusstext"], "Danke!");
            assert_eq!(d["ausgestellt_am"], HEUTE);
            assert_eq!(d["firma"]["name"], "Mustermann Haus- & Gartenservice");
            assert_eq!(s["bausteine"][1]["typ"], "positionen");
            let adresse = spalte(&mut c, "rechnungen", "kunde_adresse", r.id).await;
            assert_eq!(adresse.as_deref(), Some("Gartenweg 3\n12390 Seehausen"));

            // GoBD: ausgestellt ⇒ nicht mehr änderbar, nicht löschbar, Positionen fest
            for sql in [
                "UPDATE rechnungen SET betreff = 'x'",
                "UPDATE rechnungen SET summe_cent = 1",
                "UPDATE rechnungen SET nummer = NULL",
                "DELETE FROM rechnungen",
                "UPDATE rechnungspositionen SET einzelpreis_cent = 1",
                "DELETE FROM rechnungspositionen",
            ] {
                assert!(sqlx::query(sql).execute(&mut c).await.is_err(), "{sql}");
            }
            let f = sqlx::query(
                "INSERT INTO rechnungspositionen (rechnung_id, pos, beschreibung, einzelpreis_cent)
                 VALUES (?, 2, 'mehr', 100)",
            )
            .bind(r.id)
            .execute(&mut c)
            .await;
            assert!(f.is_err());
            let f = entwurf_speichern(&mut c, Some(r.id), &quittung(), SPAETER)
                .await
                .unwrap_err();
            assert!(f.contains("schon ausgestellt"), "{f}");
            let a = frontend("quittung");
            let f = ausstellen(&mut c, Some(r.id), &quittung(), &a, SPAETER)
                .await
                .unwrap_err();
            assert!(f.contains("schon ausgestellt"), "{f}");
            assert!(entwurf_loeschen(&mut c, r.id, SPAETER).await.is_err());
        });
    }

    #[test]
    fn rechnung_offen_bezahlt_und_wieder_offen() {
        lauf(async {
            let mut c = test_db().await;
            let hausverwaltung = kunden::KundeEingabe {
                name: "Hausverwaltung Kaiser".into(),
                strasse: Some("Seeufer 5".into()),
                plz: Some("12390".into()),
                ort: Some("Seehausen".into()),
                ..kunden::KundeEingabe::default()
            };
            let k = kunden::anlegen(&mut c, &hausverwaltung, HEUTE, JETZT)
                .await
                .unwrap();
            let d = EntwurfEingabe {
                kunde_id: Some(k.id),
                kunde_name: None,
                kunde_adresse: None,
                ..rechnung()
            };
            let r = stelle_aus(&mut c, &d).await.unwrap();
            assert_eq!(r.nummer.as_deref(), Some("RE-2026-001"));
            assert_eq!(r.status, "offen");
            assert!(r.buchung_id.is_none() && !r.kunde_neu);
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM buchungen").await, 0);
            let s = schnappschuss(&mut c, r.id).await;
            assert_eq!(s["dokument"]["kunde"]["name"], "Hausverwaltung Kaiser");
            assert_eq!(s["dokument"]["quittiert"], Value::Null);
            assert_eq!(s["dokument"]["zahlungsweg"], Value::Null);

            let b = bezahlt(&mut c, r.id, "2026-10-20", "bank", HEUTE, None, SPAETER)
                .await
                .unwrap();
            assert_eq!(b.status, "bezahlt");
            assert_eq!(b.buchung_nummer.as_deref(), Some("2026-0001"));
            let buchung = b.buchung_id.unwrap();
            let datum = spalte(&mut c, "buchungen", "zahlungsdatum", buchung).await;
            assert_eq!(datum.as_deref(), Some("2026-10-20"));
            let f = bezahlt(&mut c, r.id, "2026-10-20", "bank", HEUTE, None, SPAETER)
                .await
                .unwrap_err();
            assert!(f.contains("nicht offen"), "{f}");

            let o = wieder_offen(&mut c, r.id, HEUTE, SPAETER).await.unwrap();
            assert_eq!(o.status, "offen");
            assert_eq!(o.gegenbuchung_nummer.as_deref(), Some("2026-0002"));
            assert_eq!(anzahl(&mut c, SALDO).await, 0);
            // noch einmal bezahlt: neue Einnahme, die alte bleibt storniert
            let b2 = bezahlt(&mut c, r.id, "2026-10-21", "paypal", HEUTE, None, SPAETER)
                .await
                .unwrap();
            assert_eq!(b2.buchung_nummer.as_deref(), Some("2026-0003"));
            let wie = spalte(&mut c, "rechnungen", "zahlungsart", r.id).await;
            assert_eq!(wie.as_deref(), Some("paypal"));
        });
    }

    #[test]
    fn rechnung_schon_bezahlt_ist_quittiert() {
        lauf(async {
            let mut c = test_db().await;
            let d = EntwurfEingabe {
                bezahlt_am: Some("2026-10-14".into()),
                zahlungsart: Some("bank".into()),
                ..rechnung()
            };
            let r = stelle_aus(&mut c, &d).await.unwrap();
            assert_eq!(r.status, "bezahlt");
            assert!(r.buchung_id.is_some());
            let s = schnappschuss(&mut c, r.id).await;
            assert_eq!(
                s["dokument"]["quittiert"],
                serde_json::json!({ "am": "2026-10-14", "zahlungsweg": "bank" })
            );
        });
    }

    #[test]
    fn eigenbeleg_bucht_ausgabe_beim_geschaeft() {
        lauf(async {
            let mut c = test_db().await;
            let d = EntwurfEingabe {
                art: "eigenbeleg".into(),
                kunde_name: Some("Parkhaus am Markt".into()),
                kunde_adresse: None,
                betreff: Some("Parkgebühr beim Kundentermin".into()),
                positionen: vec![PositionEingabe {
                    kategorie_id: Some(3),
                    ..position("Parkgebühr", 1.0, 450)
                }],
                ..quittung()
            };
            let r = stelle_aus(&mut c, &d).await.unwrap();
            assert_eq!(r.nummer.as_deref(), Some("EB-2026-001"));
            assert_eq!(r.status, "bezahlt");
            assert!(r.kunde_id.is_none());
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM kunden").await, 0);
            let b = r.buchung_id.unwrap();
            let typ = spalte(&mut c, "buchungen", "typ", b).await;
            assert_eq!(typ.as_deref(), Some("ausgabe"));
            let geschaeft = spalte(&mut c, "buchungen", "lieferant", b).await;
            assert_eq!(geschaeft.as_deref(), Some("Parkhaus am Markt"));
            let s = schnappschuss(&mut c, r.id).await;
            assert_eq!(s["dokument"]["eigenbeleg"]["grund"], "kein");
            assert_eq!(
                s["dokument"]["eigenbeleg"]["gebucht"],
                serde_json::json!({ "nummer": "2026-0001", "kategorie": "Sprit & Fahrzeug" })
            );
            assert_eq!(s["dokument"]["kunde"]["name"], "Parkhaus am Markt");
            // ohne Empfänger: nein
            let ohne = EntwurfEingabe {
                kunde_name: None,
                ..d.clone()
            };
            let f = stelle_aus(&mut c, &ohne).await.unwrap_err();
            assert!(f.contains("Zahlungsempfänger"), "{f}");
        });
    }

    #[test]
    fn angebot_umwandeln_und_entwurf_verwerfen() {
        lauf(async {
            let mut c = test_db().await;
            let d = EntwurfEingabe {
                art: "angebot".into(),
                zahlungsart: None,
                ..rechnung()
            };
            let a = stelle_aus(&mut c, &d).await.unwrap();
            assert_eq!(a.nummer.as_deref(), Some("AN-2026-001"));
            assert_eq!(a.status, "offen");
            assert!(a.buchung_id.is_none());
            angebot_status(&mut c, a.id, "abgelehnt", SPAETER)
                .await
                .unwrap();
            let u = UmwandelnEingabe {
                heute: "2026-10-16".into(),
                einleitung: Some("gemäß Angebot".into()),
                schlusstext: None,
                faellig_am: Some("2026-10-30".into()),
            };
            let r = umwandeln(&mut c, a.id, &u, SPAETER).await.unwrap();
            assert_eq!(r.status, "angenommen");
            let neu = r.entwurf_id.unwrap();
            let art = spalte(&mut c, "rechnungen", "art", neu).await;
            assert_eq!(art.as_deref(), Some("rechnung"));
            assert_eq!(spalte(&mut c, "rechnungen", "nummer", neu).await, None);
            let betreff = spalte(&mut c, "rechnungen", "betreff", neu).await;
            assert_eq!(betreff.as_deref(), Some("Rasen mähen"));
            let kunde = spalte(&mut c, "rechnungen", "CAST(kunde_id AS TEXT)", neu).await;
            assert_eq!(kunde, a.kunde_id.map(|k| k.to_string()));
            let positionen = "SELECT count(*) FROM rechnungspositionen";
            assert_eq!(anzahl(&mut c, positionen).await, 4);
            assert!(umwandeln(&mut c, a.id, &u, SPAETER).await.is_err());
            let f = angebot_status(&mut c, a.id, "offen", SPAETER)
                .await
                .unwrap_err();
            assert!(f.contains("umgewandelt"), "{f}");
            // Rechnungsentwurf verworfen ⇒ Angebot wieder offen
            entwurf_loeschen(&mut c, neu, SPAETER).await.unwrap();
            let status = spalte(&mut c, "rechnungen", "status", a.id).await;
            assert_eq!(status.as_deref(), Some("offen"));
            let f = stornieren(&mut c, a.id, HEUTE, SPAETER).await.unwrap_err();
            assert!(f.contains("nicht storniert"), "{f}");
        });
    }

    #[test]
    fn stornieren_mit_stornobeleg_und_gegenbuchung() {
        lauf(async {
            let mut c = test_db().await;
            let q = stelle_aus(&mut c, &quittung()).await.unwrap();
            let s = stornieren(&mut c, q.id, "2026-10-16", SPAETER)
                .await
                .unwrap();
            assert_eq!(s.status, "storniert");
            assert_eq!(s.storno_nummer.as_deref(), Some("QU-2026-002"));
            assert_eq!(s.gegenbuchung_nummer.as_deref(), Some("2026-0002"));
            let storno = s.storno_id.unwrap();
            for (sp, wert) in [
                ("art", "storno".to_string()),
                ("status", "storniert".to_string()),
                ("CAST(summe_cent AS TEXT)", "-6500".to_string()),
                ("CAST(storno_von_id AS TEXT)", q.id.to_string()),
                ("datum", "2026-10-16".to_string()),
            ] {
                let ist = spalte(&mut c, "rechnungen", sp, storno).await;
                assert_eq!(ist, Some(wert), "{sp}");
            }
            let preis = anzahl(
                &mut c,
                "SELECT einzelpreis_cent FROM rechnungspositionen ORDER BY id DESC LIMIT 1",
            )
            .await;
            assert_eq!(preis, -6_500);
            let snap = schnappschuss(&mut c, storno).await;
            assert_eq!(snap["dokument"]["nummer"], "QU-2026-002");
            assert_eq!(snap["dokument"]["storno_von"]["nummer"], "QU-2026-001");
            assert_eq!(
                snap["dokument"]["positionen"][0]["einzelpreis_cent"],
                -6_500
            );
            assert_eq!(
                snap["dokument"]["betreff"],
                "Storno zu Quittung QU-2026-001 vom 14.10.2026"
            );
            // Einnahme aufgehoben
            assert_eq!(anzahl(&mut c, SALDO).await, 0);
            // endgültig
            let f = stornieren(&mut c, q.id, HEUTE, SPAETER).await.unwrap_err();
            assert!(f.contains("schon storniert"), "{f}");
            let f = stornieren(&mut c, storno, HEUTE, SPAETER)
                .await
                .unwrap_err();
            assert!(f.contains("selbst ein Stornobeleg"), "{f}");
            let f = sqlx::query("UPDATE rechnungen SET status = 'bezahlt' WHERE id = ?")
                .bind(q.id)
                .execute(&mut c)
                .await;
            assert!(f.is_err());
        });
    }

    #[test]
    fn vorhandene_zahlung_wird_verknuepft() {
        lauf(async {
            let mut c = test_db().await;
            let ohne = Path::new("/kladdy-test-ohne-belegablage");
            let einnahme = BuchungEingabe {
                typ: "einnahme".into(),
                zahlungsdatum: "2026-10-13".into(),
                belegdatum: None,
                betrag_cent: 6_500,
                privatanteil_prozent: 0,
                kategorie_id: 1,
                kunde_id: None,
                neuer_kunde: None,
                lieferant: None,
                zahlungsart: "paypal".into(),
                belegnummer: None,
                beschreibung: "Rasen".into(),
                heute: HEUTE.into(),
                belege: vec![],
                termin_id: None,
            };
            let b = buchungen::anlegen(&mut c, ohne, &einnahme, JETZT)
                .await
                .unwrap();
            let mut zusatz = Map::new();
            zusatz.insert("buchung_id".into(), b.id.into());
            let falsch = EntwurfEingabe {
                zusatz: zusatz.clone(),
                positionen: vec![position("Rasen", 1.0, 6_000)],
                ..quittung()
            };
            let f = stelle_aus(&mut c, &falsch).await.unwrap_err();
            assert!(f.contains("passt nicht zum Betrag"), "{f}");
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM rechnungen").await, 0);
            let d = EntwurfEingabe {
                zusatz,
                ..quittung()
            };
            let r = stelle_aus(&mut c, &d).await.unwrap();
            assert_eq!(r.buchung_id, Some(b.id));
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM buchungen").await, 1);
            let verweis = spalte(&mut c, "buchungen", "CAST(rechnung_id AS TEXT)", b.id).await;
            assert_eq!(verweis, Some(r.id.to_string()));
            let nummer = spalte(&mut c, "buchungen", "belegnummer", b.id).await;
            assert_eq!(nummer.as_deref(), Some("QU-2026-001"));
        });
    }

    #[test]
    fn pruefungen_und_festgeschriebener_zeitraum() {
        lauf(async {
            let mut c = test_db().await;
            let faelle: Vec<(EntwurfEingabe, &str)> = vec![
                (
                    EntwurfEingabe {
                        art: "gutschrift".into(),
                        ..quittung()
                    },
                    "Belegart",
                ),
                (
                    EntwurfEingabe {
                        datum: "2026-02-30".into(),
                        ..quittung()
                    },
                    "kein gültiges Datum",
                ),
                (
                    EntwurfEingabe {
                        leistung_von: Some("2026-10-14".into()),
                        leistung_bis: Some("2026-10-01".into()),
                        ..rechnung()
                    },
                    "Leistungszeitraum",
                ),
                (
                    EntwurfEingabe {
                        bezahlt_am: Some("2026-10-14".into()),
                        ..quittung()
                    },
                    "nur zu einer Rechnung",
                ),
                (
                    EntwurfEingabe {
                        zahlungsart: Some("karte".into()),
                        ..quittung()
                    },
                    "Zahlungsweg",
                ),
                (
                    EntwurfEingabe {
                        kunde_id: Some(1),
                        ..quittung()
                    },
                    "Entweder",
                ),
                (
                    EntwurfEingabe {
                        kunde_id: Some(42),
                        kunde_name: None,
                        ..quittung()
                    },
                    "Kunden gibt es nicht",
                ),
                (
                    EntwurfEingabe {
                        positionen: vec![position("x", -1.0, 100)],
                        ..quittung()
                    },
                    "Menge",
                ),
            ];
            for (d, teil) in faelle {
                let f = entwurf_speichern(&mut c, None, &d, JETZT)
                    .await
                    .unwrap_err();
                assert!(f.contains(teil), "„{f}“ enthält nicht „{teil}“");
            }
            let nicht_ausstellbar: Vec<(EntwurfEingabe, &str)> = vec![
                (
                    EntwurfEingabe {
                        positionen: vec![],
                        ..quittung()
                    },
                    "keine Positionen",
                ),
                (
                    EntwurfEingabe {
                        positionen: vec![position("", 1.0, 100)],
                        ..quittung()
                    },
                    "beschreiben",
                ),
                (
                    EntwurfEingabe {
                        positionen: vec![position("Rabatt", 1.0, -100)],
                        ..quittung()
                    },
                    "größer als 0",
                ),
                (
                    EntwurfEingabe {
                        kunde_name: None,
                        ..rechnung()
                    },
                    "Kunden angeben",
                ),
            ];
            for (d, teil) in nicht_ausstellbar {
                let f = stelle_aus(&mut c, &d).await.unwrap_err();
                assert!(f.contains(teil), "„{f}“ enthält nicht „{teil}“");
            }
            // Quittung im festgeschriebenen Zeitraum: nichts bleibt zurück, keine Nummer verbraucht
            sqlx::query("INSERT INTO festschreibungen (bis_datum, am) VALUES ('2026-10-31', ?)")
                .bind(JETZT)
                .execute(&mut c)
                .await
                .unwrap();
            let f = stelle_aus(&mut c, &quittung()).await.unwrap_err();
            assert!(f.contains("festgeschrieben"), "{f}");
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM rechnungen").await, 0);
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM kunden").await, 0);
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM protokoll").await, 0);
            let kreis = "SELECT naechste FROM nummernkreise WHERE id = 'quittung'";
            assert_eq!(anzahl(&mut c, kreis).await, 1);
        });
    }

    #[test]
    fn pdf_und_unterschriebenes_exemplar_genau_einmal() {
        let ordner = testordner("pdf");
        let ablage = ordner.join("belege");
        lauf(async {
            let mut c = test_db().await;
            let q = stelle_aus(&mut c, &quittung()).await.unwrap();
            let f = pdf_ablegen(&mut c, &ablage, q.id, b"kein pdf", SPAETER)
                .await
                .unwrap_err();
            assert!(f.contains("kein PDF"), "{f}");
            let pdf = b"%PDF-1.7\n% Testbeleg\n";
            let beleg = pdf_ablegen(&mut c, &ablage, q.id, pdf, SPAETER)
                .await
                .unwrap();
            let buchung = spalte(&mut c, "belege", "CAST(buchung_id AS TEXT)", beleg).await;
            assert_eq!(buchung, q.buchung_id.map(|b| b.to_string()));
            for (sp, wert) in [
                ("CAST(rechnung_id AS TEXT)", q.id.to_string()),
                ("art", "rechnung_pdf".to_string()),
                ("originalname", "QU-2026-001.pdf".to_string()),
                ("aufbewahren_bis", "2034-12-31".to_string()),
            ] {
                let ist = spalte(&mut c, "belege", sp, beleg).await;
                assert_eq!(ist, Some(wert), "{sp}");
            }
            let pfad = spalte(&mut c, "belege", "pfad", beleg).await.unwrap();
            assert_eq!(std::fs::read(ablage.join(&pfad)).unwrap(), pdf);
            let verweis = anzahl(&mut c, "SELECT pdf_beleg_id FROM rechnungen").await;
            assert_eq!(verweis, beleg);
            let f = pdf_ablegen(&mut c, &ablage, q.id, pdf, SPAETER)
                .await
                .unwrap_err();
            assert!(f.contains("schon abgelegt"), "{f}");

            let scan = ordner.join("unterschrieben.jpg");
            std::fs::write(&scan, b"jpeg").unwrap();
            let pfad = scan.to_str().unwrap();
            let s = scan_anhaengen(&mut c, &ablage, q.id, pfad, SPAETER)
                .await
                .unwrap();
            assert_ne!(s, beleg);
            let f = scan_anhaengen(&mut c, &ablage, q.id, pfad, SPAETER)
                .await
                .unwrap_err();
            assert!(f.contains("schon ein unterschriebenes"), "{f}");
            // Entwürfe haben noch kein PDF
            let e = entwurf_speichern(&mut c, None, &rechnung(), SPAETER)
                .await
                .unwrap();
            let f = pdf_ablegen(&mut c, &ablage, e.id, pdf, SPAETER)
                .await
                .unwrap_err();
            assert!(f.contains("Entwurf"), "{f}");
        });
        let _ = std::fs::remove_dir_all(&ordner);
    }

    #[test]
    fn eingabe_aus_json() {
        let d: EntwurfEingabe = serde_json::from_value(serde_json::json!({
            "art": "quittung", "kunde_id": null, "kunde_name": "Anna", "datum": "2026-10-14",
            "positionen": [{ "beschreibung": "Rasen", "menge": 1, "einheit": null, "einzelpreis_cent": 6500 }],
            "zusatz": { "buchung_id": 7, "grund": "kein" }
        }))
        .unwrap();
        let e = pruefen(&d).unwrap();
        assert_eq!(e.buchung_id, Some(7));
        assert_eq!(e.summe_cent, 6_500);
        assert!(e.zusatz.unwrap().contains("\"grund\":\"kein\""));
        let falsch = serde_json::from_value::<EntwurfEingabe>(serde_json::json!({
            "art": "quittung", "datum": "2026-10-14", "positionen": [], "summe": 1
        }));
        assert!(falsch.is_err());
    }
}
