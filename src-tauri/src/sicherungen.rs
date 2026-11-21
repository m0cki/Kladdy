//! Sicherungen der Datenbank (ANLEITUNG §3.2, §5, §6.10): Kopien per `VACUUM INTO` im App-Verzeichnis unter
//! `sicherungen/<art>/`, eine Liste für Einstellungen › Daten und das Wiederherstellen beim nächsten Start.
//!
//! - `automatisch/`: bei JEDEM Start der echten Datei (`DB_DATEI`, nie die Demo-Datei), wenn sie existiert und nicht
//!   leer ist. Rotation: die `NEUESTE_BEHALTEN` neuesten, je Kalendertag die neueste der letzten `TAGE_BEHALTEN` Tage
//!   und je Kalendermonat die neueste der letzten `MONATE_BEHALTEN` Monate. Gelöscht wird nur dort und nur, was dem
//!   Namensschema entspricht; alle anderen Ordner bleiben unberührt. Hat die Datenbank deutlich weniger Daten als eine
//!   automatische Kopie der letzten `TAGE_BEHALTEN` Tage (`deutlich_weniger`: weniger als die Hälfte der Zeilen in
//!   buchungen + rechnungen + kunden + belege), wird in diesem Start NICHT rotiert und der `StartBericht` warnt
//!   (Issue #52: leere oder kaputte Datenbank, mehrere Neustarts dürfen die guten Kopien nicht verdrängen).
//!   Ein Fehler blockiert das Öffnen NICHT (anders als die Sicherung vor Migration), er steht im `StartBericht`.
//! - `manuell/` („Jetzt sichern“) und `vor-update/` (src/lib/updates.ts vor dem Installieren): `sicherung_anlegen`,
//!   über den Pool des SQL-Plugins (sieht auch noch nicht zurückgeschriebene Änderungen), sonst direkt aus der Datei.
//! - `vor-migration/` legt datenbank.rs an, `vor-wiederherstellung/` das Wiederherstellen (Stand davor).
//! - Wiederherstellen in zwei Schritten: `sicherung_wiederherstellen_vormerken` prüft die Sicherung und schreibt eine
//!   Markierung neben die Datenbank, das Frontend startet neu. Beim Start (Plugin `db-sicherung`, vor allem anderen)
//!   wird erst der aktuelle Stand nach `vor-wiederherstellung/` gesichert (scheitert das, wird nichts überschrieben),
//!   dann die Kopie über eine temporäre Datei und `rename` an die Stelle der Datenbank gelegt. Danach laufen offene
//!   Migrationen wie gewohnt, mit Sicherung davor.
//! - Dateinamen: `<stamm>-<art>-JJJJMMTT-hhmmss[-n].db` (UTC), vor Migrationen `<stamm>-vor-migration-NNNN-…`. Der
//!   Stamm (`kladdy` bzw. `kladdy-dev`) trennt Release- und Entwicklungsdaten im selben Ordner.

use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use sha2::{Digest, Sha384};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection, SqliteConnection, SqliteExecutor};
use tauri::Manager;
use tauri_plugin_sql::DbInstances;

use crate::datenbank::{self, DB_DATEI, MIGRATIONEN};

/// Unterordner im App-Verzeichnis für alle Sicherungen.
pub const ORDNER: &str = "sicherungen";
/// Rotation in `automatisch/`: so viele neueste bleiben immer …
pub const NEUESTE_BEHALTEN: usize = 10;
/// … je Kalendertag die neueste, für so viele Tage (heute zählt mit) …
pub const TAGE_BEHALTEN: u64 = 30;
/// … und je Kalendermonat die neueste, für so viele Monate (der laufende zählt mit).
pub const MONATE_BEHALTEN: i64 = 12;
/// Tabellen, deren Zeilen die Liste zeigt.
const GEZAEHLT: [&str; 4] = ["buchungen", "rechnungen", "kunden", "belege"];

/// Art einer Sicherung = Unterordner von `sicherungen/`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Art {
    Automatisch,
    Manuell,
    VorUpdate,
    VorMigration,
    VorWiederherstellung,
}

impl Art {
    pub const ALLE: [Art; 5] = [
        Art::Automatisch,
        Art::Manuell,
        Art::VorUpdate,
        Art::VorMigration,
        Art::VorWiederherstellung,
    ];

    pub fn ordner(self) -> &'static str {
        match self {
            Art::Automatisch => "automatisch",
            Art::Manuell => "manuell",
            Art::VorUpdate => "vor-update",
            Art::VorMigration => "vor-migration",
            Art::VorWiederherstellung => "vor-wiederherstellung",
        }
    }

    fn aus_ordner(s: &str) -> Option<Art> {
        Art::ALLE.into_iter().find(|a| a.ordner() == s)
    }
}

/* ---------- Namen ---------- */

/// Stamm des Dateinamens (`kladdy.db` ⇒ `kladdy`).
pub fn stamm(db_datei: &str) -> &str {
    db_datei.strip_suffix(".db").unwrap_or(db_datei)
}

fn stamm_von(db: &Path) -> &str {
    stamm(db.file_name().and_then(|n| n.to_str()).unwrap_or(DB_DATEI))
}

/// Zeitstempel aus einem Dateinamen: `JJJJMMTT-hhmmss` (UTC) plus laufende Nummer bei mehreren in derselben Sekunde.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Stempel {
    pub text: String,
    pub zusatz: u32,
}

impl Stempel {
    /// Monat als fortlaufende Zahl (Jahr · 12 + Monat − 1).
    fn monat(&self) -> i64 {
        let jahr: i64 = self.text[0..4].parse().unwrap_or(0);
        let monat: i64 = self.text[4..6].parse().unwrap_or(1);
        jahr * 12 + monat - 1
    }

    /// Kalendertag `JJJJMMTT` (UTC).
    fn tag(&self) -> &str {
        &self.text[0..8]
    }

    /// `JJJJ-MM-TTThh:mm:ssZ` wie `datenbank::utc_iso`.
    pub fn iso(&self) -> String {
        let t = &self.text;
        format!(
            "{}-{}-{}T{}:{}:{}Z",
            &t[0..4],
            &t[4..6],
            &t[6..8],
            &t[9..11],
            &t[11..13],
            &t[13..15]
        )
    }
}

fn nur_ziffern(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// Liest den Zeitstempel aus `datei`, wenn der Name zum Schema von `stamm` und `art` passt, sonst `None`.
/// Andere Dateien (fremde Namen, die Entwicklungsdaten mit Stamm `kladdy-dev` neben `kladdy`) gelten nicht als Sicherung.
pub fn stempel_aus_name(datei: &str, stamm: &str, art: Art) -> Option<Stempel> {
    let rest = datei
        .strip_prefix(stamm)?
        .strip_prefix('-')?
        .strip_prefix(art.ordner())?
        .strip_prefix('-')?
        .strip_suffix(".db")?;
    let rest = if art == Art::VorMigration {
        let (nummer, r) = rest.split_once('-')?;
        if nummer.len() != 4 || !nur_ziffern(nummer) {
            return None;
        }
        r
    } else {
        rest
    };
    let (text, zusatz) = match rest.len() {
        15 => (rest, 0),
        n if n > 16 && rest.as_bytes()[15] == b'-' => {
            let z = &rest[16..];
            if !nur_ziffern(z) {
                return None;
            }
            (&rest[..15], z.parse().ok()?)
        }
        _ => return None,
    };
    let (tag, zeit) = text.split_once('-')?;
    if tag.len() != 8 || zeit.len() != 6 || !nur_ziffern(tag) || !nur_ziffern(zeit) {
        return None;
    }
    Some(Stempel {
        text: text.to_string(),
        zusatz,
    })
}

/// Freier Dateiname in `ordner`: `<stamm>-<art>-<stempel>.db`, gibt es den schon, mit `-2`, `-3` …
/// (`VACUUM INTO` verweigert ohnehin eine vorhandene Datei; überschrieben wird also nie.)
fn freier_name(ordner: &Path, stamm: &str, art: Art, sekunden: u64) -> PathBuf {
    let basis = format!(
        "{stamm}-{}-{}",
        art.ordner(),
        datenbank::utc_stempel(sekunden)
    );
    let mut pfad = ordner.join(format!("{basis}.db"));
    let mut n = 2;
    while fs::symlink_metadata(&pfad).is_ok() {
        pfad = ordner.join(format!("{basis}-{n}.db"));
        n += 1;
    }
    pfad
}

/* ---------- Kopie anlegen ---------- */

/// `VACUUM INTO` über eine Verbindung oder den Pool: konsistenter Stand, auch mit offenem Journal/WAL.
async fn vacuum_into<'c, E: SqliteExecutor<'c>>(exec: E, ziel: &Path) -> Result<(), String> {
    let text = ziel
        .to_str()
        .ok_or_else(|| format!("Pfad nicht als UTF-8 darstellbar: {}", ziel.display()))?;
    sqlx::query("VACUUM INTO ?")
        .bind(text)
        .execute(exec)
        .await
        .map(|_| ())
        .map_err(|e| format!("Kopie schreiben ({}): {e}", ziel.display()))
}

/// Kopie über `exec` nach `sicherungen/<art>/`. Gibt den Pfad der neuen Datei zurück.
pub async fn sichern_mit<'c, E: SqliteExecutor<'c>>(
    exec: E,
    sicherungen: &Path,
    stamm: &str,
    art: Art,
    sekunden: u64,
) -> Result<PathBuf, String> {
    let ordner = sicherungen.join(art.ordner());
    fs::create_dir_all(&ordner)
        .map_err(|e| format!("Ordner anlegen ({}): {e}", ordner.display()))?;
    let ziel = freier_name(&ordner, stamm, art, sekunden);
    vacuum_into(exec, &ziel).await?;
    Ok(ziel)
}

/// Kopie der Datei `db` (eigene Verbindung). `None`, wenn es die Datei nicht gibt oder sie leer ist.
pub async fn datei_sichern(
    db: &Path,
    sicherungen: &Path,
    art: Art,
    sekunden: u64,
) -> Result<Option<PathBuf>, String> {
    match fs::metadata(db) {
        Ok(m) if m.len() == 0 => return Ok(None),
        Ok(_) => {}
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Datenbank lesen ({}): {e}", db.display())),
    }
    let mut verbindung = SqliteConnectOptions::new()
        .filename(db)
        .create_if_missing(false)
        .connect()
        .await
        .map_err(|e| format!("Datenbank öffnen ({}): {e}", db.display()))?;
    let ergebnis = sichern_mit(&mut verbindung, sicherungen, stamm_von(db), art, sekunden).await;
    let _ = verbindung.close().await;
    ergebnis.map(Some)
}

/* ---------- Rotation ---------- */

/// Erster Kalendertag (`JJJJMMTT`, UTC) der letzten `TAGE_BEHALTEN` Tage bis `jetzt` (heute zählt mit).
fn erster_tag(jetzt: u64) -> String {
    datenbank::utc_stempel(jetzt.saturating_sub((TAGE_BEHALTEN - 1) * 86_400))[..8].to_string()
}

/// Welche automatischen Sicherungen weg dürfen: alle außer den `NEUESTE_BEHALTEN` neuesten, der neuesten je
/// Kalendertag der letzten `TAGE_BEHALTEN` Tage und der neuesten je Kalendermonat der letzten `MONATE_BEHALTEN`
/// Monate (bezogen auf `jetzt`, UTC).
pub fn zu_loeschen(dateien: &[(String, Stempel)], jetzt: u64) -> Vec<String> {
    let mut sortiert: Vec<&(String, Stempel)> = dateien.iter().collect();
    sortiert.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(&a.0)));
    let (jahr, monat, ..) = datenbank::utc_teile(jetzt);
    let aktuell = jahr * 12 + monat - 1;
    let erster = erster_tag(jetzt);
    let mut tage_gesehen = std::collections::HashSet::new();
    let mut monate_gesehen = std::collections::HashSet::new();
    let mut weg = Vec::new();
    for (i, (name, stempel)) in sortiert.into_iter().enumerate() {
        let neueste_am_tag = tage_gesehen.insert(stempel.tag().to_string());
        let tag_im_fenster = stempel.tag() >= erster.as_str();
        let monat = stempel.monat();
        let neueste_im_monat = monate_gesehen.insert(monat);
        let monat_im_fenster = monat > aktuell - MONATE_BEHALTEN;
        if i < NEUESTE_BEHALTEN
            || (neueste_am_tag && tag_im_fenster)
            || (neueste_im_monat && monat_im_fenster)
        {
            continue;
        }
        weg.push(name.clone());
    }
    weg
}

/// Automatische Sicherungen von `stamm` (nur echte Dateien mit passendem Namen). Fehlt der Ordner: leer.
fn automatische_dateien(sicherungen: &Path, stamm: &str) -> Result<Vec<(String, Stempel)>, String> {
    let ordner = sicherungen.join(Art::Automatisch.ordner());
    let eintraege = match fs::read_dir(&ordner) {
        Ok(e) => e,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("Ordner lesen ({}): {e}", ordner.display())),
    };
    let mut dateien = Vec::new();
    for eintrag in eintraege.flatten() {
        let ist_datei = eintrag.file_type().map(|t| t.is_file()).unwrap_or(false);
        let Some(name) = eintrag.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if let (true, Some(s)) = (ist_datei, stempel_aus_name(&name, stamm, Art::Automatisch)) {
            dateien.push((name, s));
        }
    }
    Ok(dateien)
}

/// Räumt `sicherungen/automatisch/` auf (nur echte Dateien mit passendem Namen). Gibt Fehler als Text zurück.
pub fn rotieren(sicherungen: &Path, stamm: &str, jetzt: u64) -> Vec<String> {
    let ordner = sicherungen.join(Art::Automatisch.ordner());
    let dateien = match automatische_dateien(sicherungen, stamm) {
        Ok(d) => d,
        Err(e) => return vec![e],
    };
    zu_loeschen(&dateien, jetzt)
        .into_iter()
        .filter_map(|name| {
            let pfad = ordner.join(&name);
            fs::remove_file(&pfad)
                .err()
                .map(|e| format!("Alte Sicherung löschen ({}): {e}", pfad.display()))
        })
        .collect()
}

/* ---------- Vergleich mit den letzten Tagen ---------- */

/// Zeilen in buchungen, rechnungen, kunden und belege zusammen (fehlende Tabellen zählen 0).
fn summe(zeilen: &[Option<i64>; 4]) -> i64 {
    zeilen.iter().flatten().sum()
}

/// Automatische Kopie, die deutlich mehr Daten hatte als die Datenbank jetzt (Warnung im `StartBericht`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MehrDaten {
    /// UTC aus dem Dateinamen, `JJJJ-MM-TTThh:mm:ssZ`
    pub zeitpunkt: String,
    pub buchungen: i64,
    /// buchungen + rechnungen + kunden + belege
    pub zeilen: i64,
}

/// Reine Vergleichslogik: Hat die Datenbank (`jetzt_zeilen`, Summe wie `summe`) weniger als die Hälfte der Zeilen
/// der zeilenreichsten automatischen Kopie der letzten `TAGE_BEHALTEN` Tage? Dann diese Kopie (bei Gleichstand die
/// neueste), sonst `None`. Kopien ohne Daten zählen nicht (frisch eingerichtete Datenbank).
pub fn deutlich_weniger(
    jetzt_zeilen: i64,
    vorhandene: &[(Stempel, [Option<i64>; 4])],
    jetzt: u64,
) -> Option<MehrDaten> {
    let erster = erster_tag(jetzt);
    let (stempel, zeilen) = vorhandene
        .iter()
        .filter(|(s, _)| s.tag() >= erster.as_str())
        .max_by(|a, b| summe(&a.1).cmp(&summe(&b.1)).then_with(|| a.0.cmp(&b.0)))?;
    let meiste = summe(zeilen);
    (meiste > 0 && jetzt_zeilen.saturating_mul(2) < meiste).then(|| MehrDaten {
        zeitpunkt: stempel.iso(),
        buchungen: zeilen[0].unwrap_or(0),
        zeilen: meiste,
    })
}

/// Zeilenzahlen der automatischen Kopien der letzten `TAGE_BEHALTEN` Tage. Unlesbare Kopien werden übergangen.
async fn letzte_inhalte(
    sicherungen: &Path,
    stamm: &str,
    jetzt: u64,
) -> Vec<(Stempel, [Option<i64>; 4])> {
    let erster = erster_tag(jetzt);
    let ordner = sicherungen.join(Art::Automatisch.ordner());
    let mut inhalte = Vec::new();
    for (name, stempel) in automatische_dateien(sicherungen, stamm).unwrap_or_default() {
        if stempel.tag() < erster.as_str() {
            continue;
        }
        if let Ok(zeilen) = zeilen_zaehlen(&ordner.join(&name)).await {
            inhalte.push((stempel, zeilen));
        }
    }
    inhalte
}

/// Ergebnis der automatischen Sicherung beim Start.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Automatisch {
    /// Meldung, wenn Sichern oder Aufräumen nicht geklappt hat
    pub fehler: Option<String>,
    /// gesetzt, wenn die Datenbank deutlich weniger Daten hat als eine Kopie der letzten Tage (dann ohne Rotation)
    pub weniger: Option<MehrDaten>,
}

/// Automatische Sicherung beim Start samt Rotation. Vorher werden die Kopien der letzten `TAGE_BEHALTEN` Tage gelesen:
/// Hat die Datenbank deutlich weniger Daten (oder fehlt sie), wird nicht rotiert und gewarnt.
pub fn automatisch_beim_start(db: &Path, sicherungen: &Path, jetzt: u64) -> Automatisch {
    let stamm = stamm_von(db);
    let vorhandene = tauri::async_runtime::block_on(letzte_inhalte(sicherungen, stamm, jetzt));
    match tauri::async_runtime::block_on(datei_sichern(db, sicherungen, Art::Automatisch, jetzt)) {
        Ok(Some(kopie)) => {
            eprintln!("Automatische Sicherung: {}", kopie.display());
            let weniger = match tauri::async_runtime::block_on(zeilen_zaehlen(&kopie)) {
                Ok(zeilen) => deutlich_weniger(summe(&zeilen), &vorhandene, jetzt),
                Err(e) => {
                    // Inhalt unbekannt: lieber nichts löschen.
                    eprintln!("Neue Sicherung nicht lesbar, es wird nicht aufgeräumt: {e}");
                    return Automatisch::default();
                }
            };
            if let Some(m) = &weniger {
                eprintln!(
                    "Deutlich weniger Daten als in der Sicherung vom {} ({} Zeilen), es wird nicht aufgeräumt.",
                    m.zeitpunkt, m.zeilen
                );
                return Automatisch {
                    fehler: None,
                    weniger,
                };
            }
            let fehler = rotieren(sicherungen, stamm, jetzt);
            for f in &fehler {
                eprintln!("Rotation der Sicherungen: {f}");
            }
            Automatisch {
                fehler: (!fehler.is_empty()).then(|| {
                    format!(
                        "Alte automatische Sicherungen konnten nicht aufgeräumt werden: {}",
                        fehler.join("; ")
                    )
                }),
                weniger: None,
            }
        }
        // Keine (oder eine leere) Datenbankdatei: gab es in den letzten Tagen Daten, ist das die Warnung wert.
        Ok(None) => Automatisch {
            fehler: None,
            weniger: deutlich_weniger(0, &vorhandene, jetzt),
        },
        Err(e) => {
            eprintln!("Automatische Sicherung fehlgeschlagen: {e}");
            Automatisch {
                fehler: Some(format!(
                    "Die automatische Sicherung beim Start ist fehlgeschlagen: {e}. Kladdy arbeitet normal weiter, \
                     deine Daten sind unverändert. Bitte Speicherplatz und Schreibrechte für {} prüfen.",
                    sicherungen.display()
                )),
                weniger: None,
            }
        }
    }
}

/* ---------- Lesen und Prüfen ---------- */

/// Eine Sicherung, wie Einstellungen › Daten sie zeigt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Sicherung {
    /// Kennung fürs Wiederherstellen: `<art>/<datei>`
    pub name: String,
    pub art: Art,
    pub datei: String,
    pub groesse: u64,
    /// UTC aus dem Dateinamen, `JJJJ-MM-TTThh:mm:ssZ`
    pub zeitpunkt: String,
    /// höchste angewendete Migration
    pub schema: Option<i64>,
    pub buchungen: Option<i64>,
    pub rechnungen: Option<i64>,
    pub kunden: Option<i64>,
    pub belege: Option<i64>,
    /// Grund, warum diese Kopie nicht wiederhergestellt werden kann (unlesbar, fremd, neuer als die App)
    pub fehler: Option<String>,
}

/// Was in einer Sicherung steckt.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Inhalt {
    pub schema: Option<i64>,
    pub zeilen: [Option<i64>; 4],
}

/// Öffnet eine Sicherung nur lesend und unveränderlich (`immutable`: keine Sperren, keine -wal/-shm daneben).
async fn lesend_oeffnen(datei: &Path) -> Result<SqliteConnection, String> {
    SqliteConnectOptions::new()
        .filename(datei)
        .read_only(true)
        .immutable(true)
        .create_if_missing(false)
        .connect()
        .await
        .map_err(|e| format!("Sicherung öffnen ({}): {e}", datei.display()))
}

async fn tabelle_da(c: &mut SqliteConnection, name: &str) -> Result<bool, sqlx::Error> {
    let n: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?")
            .bind(name)
            .fetch_one(&mut *c)
            .await?;
    Ok(n > 0)
}

/// Zeilen je Tabelle aus `GEZAEHLT`; `None`, wenn es die Tabelle (noch) nicht gibt.
async fn zeilen_lesen(c: &mut SqliteConnection) -> Result<[Option<i64>; 4], sqlx::Error> {
    let mut zeilen = [None; 4];
    for (i, tabelle) in GEZAEHLT.iter().enumerate() {
        if tabelle_da(c, tabelle).await? {
            let n: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {tabelle}"))
                .fetch_one(&mut *c)
                .await?;
            zeilen[i] = Some(n);
        }
    }
    Ok(zeilen)
}

/// Nur die Zeilenzahlen einer Kopie (ohne Prüfung der Migrationen).
async fn zeilen_zaehlen(datei: &Path) -> Result<[Option<i64>; 4], String> {
    let mut c = lesend_oeffnen(datei).await?;
    let ergebnis = zeilen_lesen(&mut c)
        .await
        .map_err(|e| format!("Sicherung lesen: {e}"));
    let _ = c.close().await;
    ergebnis
}

/// Liest Schema-Stand und Zeilenzahlen und prüft, ob die Kopie zu dieser App passt: Kladdy-Datenbank (Migrationen
/// mit denselben Prüfsummen wie hier, sonst verweigerte das SQL-Plugin später das Öffnen) und nicht neuer als die App.
/// `gruendlich`: zusätzlich `PRAGMA quick_check` (vor dem Wiederherstellen).
pub async fn inhalt_pruefen(datei: &Path, gruendlich: bool) -> Result<Inhalt, String> {
    let mut c = lesend_oeffnen(datei).await?;
    let ergebnis = inhalt_lesen(&mut c, gruendlich).await;
    let _ = c.close().await;
    ergebnis
}

async fn inhalt_lesen(c: &mut SqliteConnection, gruendlich: bool) -> Result<Inhalt, String> {
    let lesefehler = |e: sqlx::Error| format!("Sicherung lesen: {e}");
    if gruendlich {
        let pruefung: String = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&mut *c)
            .await
            .map_err(lesefehler)?;
        if pruefung != "ok" {
            return Err(format!("Die Sicherung ist beschädigt ({pruefung})."));
        }
    }
    if !tabelle_da(c, "_sqlx_migrations")
        .await
        .map_err(lesefehler)?
    {
        return Err("Das ist keine Kladdy-Datenbank.".into());
    }
    let angewendet: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT version, checksum FROM _sqlx_migrations WHERE success = 1")
            .fetch_all(&mut *c)
            .await
            .map_err(lesefehler)?;
    let inhalt = Inhalt {
        schema: angewendet.iter().map(|(v, _)| *v).max(),
        zeilen: zeilen_lesen(c).await.map_err(lesefehler)?,
    };
    for (version, pruefsumme) in &angewendet {
        let Some(m) = MIGRATIONEN.iter().find(|m| m.version == *version) else {
            return Err(format!(
                "Die Sicherung stammt aus einer neueren Kladdy-Version (Datenbank-Stand {version}). Erst Kladdy aktualisieren."
            ));
        };
        if Sha384::digest(m.sql.as_bytes()).as_slice() != pruefsumme.as_slice() {
            return Err(format!(
                "Die Sicherung passt nicht zu Kladdy (Migration {version} weicht ab)."
            ));
        }
    }
    Ok(inhalt)
}

/// Eintrag für die Liste aus einer vorhandenen Datei (Größe, Inhalt; Fehler beim Lesen landen in `fehler`).
async fn eintrag(pfad: &Path, art: Art, datei: &str, stempel: &Stempel) -> Sicherung {
    let groesse = fs::metadata(pfad).map(|m| m.len()).unwrap_or(0);
    let (inhalt, fehler) = match inhalt_pruefen(pfad, false).await {
        Ok(i) => (i, None),
        Err(e) => (Inhalt::default(), Some(e)),
    };
    let [buchungen, rechnungen, kunden, belege] = inhalt.zeilen;
    Sicherung {
        name: format!("{}/{datei}", art.ordner()),
        art,
        datei: datei.to_string(),
        groesse,
        zeitpunkt: stempel.iso(),
        schema: inhalt.schema,
        buchungen,
        rechnungen,
        kunden,
        belege,
        fehler,
    }
}

/// Alle Sicherungen von `stamm` in allen Unterordnern, neueste zuerst.
pub async fn auflisten(sicherungen: &Path, stamm: &str) -> Vec<Sicherung> {
    let mut liste = Vec::new();
    for art in Art::ALLE {
        let Ok(eintraege) = fs::read_dir(sicherungen.join(art.ordner())) else {
            continue;
        };
        let mut gefunden: Vec<(String, Stempel)> = eintraege
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .filter_map(|e| e.file_name().to_str().map(str::to_string))
            .filter_map(|n| stempel_aus_name(&n, stamm, art).map(|s| (n, s)))
            .collect();
        gefunden.sort();
        for (datei, stempel) in gefunden {
            let pfad = sicherungen.join(art.ordner()).join(&datei);
            liste.push((stempel.clone(), eintrag(&pfad, art, &datei, &stempel).await));
        }
    }
    liste.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.name.cmp(&a.1.name)));
    liste.into_iter().map(|(_, s)| s).collect()
}

/* ---------- Wiederherstellen ---------- */

/// Kennung aus der Liste (`<art>/<datei>`) ⇒ Pfad und Zeitstempel der Sicherung. Nur Dateien direkt in einem
/// bekannten Unterordner von `sicherungen/` mit dem Namensschema von `stamm`; kein `..`, kein absoluter Pfad, keine
/// symbolischen Links (weder Ordner noch Datei), und der aufgelöste Pfad liegt wirklich unter `sicherungen/`.
pub fn pfad_pruefen(
    sicherungen: &Path,
    stamm: &str,
    name: &str,
) -> Result<(PathBuf, Stempel), String> {
    let ungueltig = || format!("Unbekannte Sicherung: {name}");
    let teile: Vec<Component> = Path::new(name).components().collect();
    let [Component::Normal(ordner), Component::Normal(datei)] = teile.as_slice() else {
        return Err(ungueltig());
    };
    let art = ordner
        .to_str()
        .and_then(Art::aus_ordner)
        .ok_or_else(ungueltig)?;
    let datei = datei.to_str().ok_or_else(ungueltig)?;
    let stempel = stempel_aus_name(datei, stamm, art).ok_or_else(ungueltig)?;
    let unterordner = sicherungen.join(art.ordner());
    let pfad = unterordner.join(datei);
    for (p, soll_datei) in [
        (sicherungen, false),
        (unterordner.as_path(), false),
        (pfad.as_path(), true),
    ] {
        let m = fs::symlink_metadata(p).map_err(|e| format!("{}: {e}", p.display()))?;
        let passt = if soll_datei { m.is_file() } else { m.is_dir() };
        if m.file_type().is_symlink() || !passt {
            return Err(format!(
                "{} ist kein gewöhnlicher Eintrag der Sicherungen.",
                p.display()
            ));
        }
    }
    let basis = fs::canonicalize(sicherungen).map_err(|e| e.to_string())?;
    let echt = fs::canonicalize(&pfad).map_err(|e| e.to_string())?;
    if !echt.starts_with(&basis) {
        return Err(ungueltig());
    }
    Ok((pfad, stempel))
}

/// Markierung „beim nächsten Start wiederherstellen“ neben der Datenbank (Inhalt: Kennung der Sicherung).
pub fn marker_pfad(db: &Path) -> PathBuf {
    let name = db.file_name().and_then(|n| n.to_str()).unwrap_or(DB_DATEI);
    db.with_file_name(format!("{name}.wiederherstellen"))
}

/// Prüft die Sicherung (Pfad, Lesbarkeit, passt zur App) und merkt sie für den nächsten Start vor.
pub async fn vormerken(db: &Path, sicherungen: &Path, name: &str) -> Result<(), String> {
    let (pfad, _) = pfad_pruefen(sicherungen, stamm_von(db), name)?;
    inhalt_pruefen(&pfad, true).await?;
    let marker = marker_pfad(db);
    let tmp = marker.with_extension("wiederherstellen-tmp");
    fs::write(&tmp, name.as_bytes())
        .and_then(|_| fs::rename(&tmp, &marker))
        .map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("Wiederherstellung vormerken ({}): {e}", marker.display())
        })
}

fn entfernen_falls_da(pfad: &Path) -> Result<(), String> {
    match fs::remove_file(pfad) {
        Err(e) if e.kind() != ErrorKind::NotFound => {
            Err(format!("Entfernen ({}): {e}", pfad.display()))
        }
        _ => Ok(()),
    }
}

/// Ergebnis eines Wiederherstellens (fürs Frontend).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Wiederhergestellt {
    /// Zeitpunkt der zurückgeholten Sicherung (UTC, `JJJJ-MM-TTThh:mm:ssZ`)
    pub zeitpunkt: String,
    /// Wo der Stand davor liegt (`None`, wenn es keine Datenbank gab)
    pub vorher: Option<String>,
}

/// Legt die Sicherung `name` an die Stelle von `db`. Vorher wird der aktuelle Stand nach `vor-wiederherstellung/`
/// gesichert; scheitert das, bleibt alles, wie es ist. Ersetzt wird über eine temporäre Datei im selben Ordner und
/// `rename` (atomar); vorher kommen -wal/-shm/-journal weg, die sonst auf die neue Datei angewendet würden (die
/// Sicherung davor hat ihren Inhalt schon übernommen).
pub fn wiederherstellen(
    db: &Path,
    sicherungen: &Path,
    name: &str,
    jetzt: u64,
) -> Result<Wiederhergestellt, String> {
    let (quelle, stempel) = pfad_pruefen(sicherungen, stamm_von(db), name)?;
    tauri::async_runtime::block_on(inhalt_pruefen(&quelle, true))?;
    let vorher = tauri::async_runtime::block_on(datei_sichern(
        db,
        sicherungen,
        Art::VorWiederherstellung,
        jetzt,
    ))
    .map_err(|e| {
        format!(
            "Der aktuelle Stand konnte nicht gesichert werden ({e}). Es wurde nichts überschrieben."
        )
    })?;
    let tmp = db.with_file_name(format!(
        "{}.wiederherstellen-neu",
        db.file_name().and_then(|n| n.to_str()).unwrap_or(DB_DATEI)
    ));
    let ersetzen = || -> Result<(), String> {
        entfernen_falls_da(&tmp)?;
        fs::copy(&quelle, &tmp).map_err(|e| format!("Kopie anlegen ({}): {e}", tmp.display()))?;
        fs::File::open(&tmp)
            .and_then(|f| f.sync_all())
            .map_err(|e| format!("Kopie schreiben ({}): {e}", tmp.display()))?;
        for endung in ["-wal", "-shm", "-journal"] {
            let mut neben = db.as_os_str().to_owned();
            neben.push(endung);
            entfernen_falls_da(Path::new(&neben))?;
        }
        fs::rename(&tmp, db).map_err(|e| format!("Datenbank ersetzen ({}): {e}", db.display()))
    };
    if let Err(e) = ersetzen() {
        let _ = fs::remove_file(&tmp);
        return Err(match &vorher {
            Some(p) => format!("{e}. Der Stand davor liegt in {}.", p.display()),
            None => e,
        });
    }
    if let Some(ordner) = db.parent().and_then(|p| fs::File::open(p).ok()) {
        let _ = ordner.sync_all();
    }
    Ok(Wiederhergestellt {
        zeitpunkt: stempel.iso(),
        vorher: vorher.map(|p| p.display().to_string()),
    })
}

/// Beim Start (vor allem anderen): gibt es eine Markierung, wird sie entfernt und die Sicherung wiederhergestellt.
/// Die Markierung kommt zuerst weg, damit ein Absturz mittendrin nicht bei jedem Start erneut zurücksetzt.
/// `None` = nichts vorgemerkt.
pub fn vorgemerkte_wiederherstellung(
    db: &Path,
    sicherungen: &Path,
    jetzt: u64,
) -> Option<Result<Wiederhergestellt, String>> {
    let marker = marker_pfad(db);
    let name = match fs::read_to_string(&marker) {
        Ok(s) => s.trim().to_string(),
        Err(e) if e.kind() == ErrorKind::NotFound => return None,
        Err(e) => return Some(Err(format!("Markierung lesen ({}): {e}", marker.display()))),
    };
    if let Err(e) = fs::remove_file(&marker) {
        return Some(Err(format!(
            "Markierung entfernen ({}): {e}. Es wurde nichts wiederhergestellt.",
            marker.display()
        )));
    }
    let ergebnis = wiederherstellen(db, sicherungen, &name, jetzt);
    match &ergebnis {
        Ok(w) => eprintln!("Sicherung vom {} wiederhergestellt", w.zeitpunkt),
        Err(e) => eprintln!("Wiederherstellen fehlgeschlagen: {e}"),
    }
    Some(ergebnis.map_err(|e| format!("Wiederherstellen hat nicht geklappt: {e}")))
}

/* ---------- Bericht vom Start ---------- */

/// Was beim Start passiert ist (Tauri-State, angelegt von `datenbank::sicherungs_plugin`), einmal abholbar.
#[derive(Debug, Default)]
pub struct StartBericht(pub Mutex<Option<Bericht>>);

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Bericht {
    /// gesetzt nach erfolgreichem Wiederherstellen
    pub wiederhergestellt: Option<Wiederhergestellt>,
    /// Fehler (Wiederherstellen, automatische Sicherung), jeweils als ganzer Satz
    pub fehler: Vec<String>,
    /// Die Datenbank hat deutlich weniger Daten als diese automatische Kopie der letzten Tage (Issue #52)
    pub weniger_daten: Option<MehrDaten>,
}

impl Bericht {
    pub fn aus(
        wiederherstellung: Option<Result<Wiederhergestellt, String>>,
        automatisch: Automatisch,
    ) -> Self {
        let mut b = Bericht::default();
        match wiederherstellung {
            Some(Ok(w)) => b.wiederhergestellt = Some(w),
            Some(Err(e)) => b.fehler.push(e),
            None => {}
        }
        b.fehler.extend(automatisch.fehler);
        // Nach einem gewollten Wiederherstellen eines älteren Stands keine Warnung (die Rotation bleibt trotzdem aus).
        if b.wiederhergestellt.is_none() {
            b.weniger_daten = automatisch.weniger;
        }
        b
    }
}

/* ---------- Tauri-Commands ---------- */

fn app_ordner(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("App-Verzeichnis nicht gefunden: {e}"))
}

/// Im Demo-Modus (nur Entwicklerversion) gibt es keine Sicherungen: geöffnet ist dann nicht die echte Datei.
fn nicht_im_demo() -> Result<(), String> {
    #[cfg(debug_assertions)]
    if crate::demo::aktiv() {
        return Err(
            "Im Demo-Modus wird nicht gesichert oder wiederhergestellt. Erst die Demo-Daten entfernen.".into(),
        );
    }
    Ok(())
}

/// Frontend (src/lib/sicherungen.ts): `invoke('sicherung_anlegen', { anlass })`, `anlass` = 'manuell' | 'vor-update'.
/// Kopie der geöffneten Datenbank über den Pool des SQL-Plugins; ist sie (noch) nicht geöffnet, direkt aus der
/// Datei. `None`, wenn es noch keine Datenbank gibt.
#[tauri::command]
pub async fn sicherung_anlegen(
    app: tauri::AppHandle,
    instanzen: tauri::State<'_, DbInstances>,
    anlass: String,
) -> Result<Option<Sicherung>, String> {
    let art = match anlass.as_str() {
        "manuell" => Art::Manuell,
        "vor-update" => Art::VorUpdate,
        _ => return Err(format!("Unbekannter Anlass für eine Sicherung: {anlass}")),
    };
    nicht_im_demo()?;
    let ordner = app_ordner(&app)?;
    let sicherungen = ordner.join(ORDNER);
    let jetzt = datenbank::jetzt_sekunden();
    let pfad = match datenbank::pool(&instanzen).await {
        Ok(pool) => Some(sichern_mit(&pool, &sicherungen, stamm(DB_DATEI), art, jetzt).await?),
        Err(_) => datei_sichern(&ordner.join(DB_DATEI), &sicherungen, art, jetzt).await?,
    };
    let Some(pfad) = pfad else {
        return Ok(None);
    };
    let datei = pfad
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();
    let stempel = stempel_aus_name(&datei, stamm(DB_DATEI), art)
        .ok_or_else(|| format!("Unerwarteter Dateiname: {datei}"))?;
    Ok(Some(eintrag(&pfad, art, &datei, &stempel).await))
}

/// Frontend: `invoke('sicherungen_auflisten')` – alle Sicherungen der echten Datenbank, neueste zuerst.
#[tauri::command]
pub async fn sicherungen_auflisten(app: tauri::AppHandle) -> Result<Vec<Sicherung>, String> {
    let ordner = app_ordner(&app)?;
    Ok(auflisten(&ordner.join(ORDNER), stamm(DB_DATEI)).await)
}

/// Frontend: `invoke('sicherungen_ordner_zeigen')` – öffnet `sicherungen/` im Finder (legt ihn bei Bedarf an).
#[tauri::command]
pub fn sicherungen_ordner_zeigen(app: tauri::AppHandle) -> Result<(), String> {
    let ordner = app_ordner(&app)?.join(ORDNER);
    fs::create_dir_all(&ordner)
        .map_err(|e| format!("Ordner anlegen ({}): {e}", ordner.display()))?;
    crate::belege::mit_open(false, &ordner, "Der Ordner mit den Sicherungen")
}

/// Frontend: `invoke('sicherung_wiederherstellen_vormerken', { name })`, danach Neustart (`relaunch()`).
#[tauri::command]
pub async fn sicherung_wiederherstellen_vormerken(
    app: tauri::AppHandle,
    name: String,
) -> Result<(), String> {
    nicht_im_demo()?;
    let ordner = app_ordner(&app)?;
    vormerken(&ordner.join(DB_DATEI), &ordner.join(ORDNER), &name).await
}

/// Frontend (AppShell): einmal nach dem Start abholen, was beim Sichern/Wiederherstellen passiert ist.
#[tauri::command]
pub fn sicherungen_start_bericht(bericht: tauri::State<'_, StartBericht>) -> Bericht {
    bericht
        .0
        .lock()
        .map(|mut b| b.take().unwrap_or_default())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::datenbank::testhilfe::{migrieren, testordner, verbinden};

    const T0: u64 = 1_791_929_700; // 2026-10-13 22:15:00 UTC

    fn kunde_anlegen(db: &Path, name: &str) {
        tauri::async_runtime::block_on(async {
            let mut c = verbinden(db).await;
            sqlx::query("INSERT INTO kunden (nummer, name, erstellt_am) VALUES (?, ?, 'jetzt')")
                .bind(format!("K-{name}"))
                .bind(name)
                .execute(&mut c)
                .await
                .unwrap();
            c.close().await.unwrap();
        });
    }

    fn kunden(db: &Path) -> Vec<String> {
        tauri::async_runtime::block_on(async {
            let mut c = verbinden(db).await;
            let n = sqlx::query_scalar("SELECT name FROM kunden ORDER BY id")
                .fetch_all(&mut c)
                .await
                .unwrap();
            c.close().await.unwrap();
            n
        })
    }

    fn stempel(text: &str) -> Stempel {
        Stempel {
            text: text.into(),
            zusatz: 0,
        }
    }

    #[test]
    fn namen_lesen() {
        let s = stempel_aus_name(
            "kladdy-automatisch-20261013-221500.db",
            "kladdy",
            Art::Automatisch,
        )
        .unwrap();
        assert_eq!(s, stempel("20261013-221500"));
        assert_eq!(s.iso(), "2026-10-13T22:15:00Z");
        assert_eq!(
            stempel_aus_name(
                "kladdy-manuell-20261013-221500-3.db",
                "kladdy",
                Art::Manuell
            ),
            Some(Stempel {
                text: "20261013-221500".into(),
                zusatz: 3
            })
        );
        assert_eq!(
            stempel_aus_name(
                "kladdy-vor-migration-0003-20261013-221500.db",
                "kladdy",
                Art::VorMigration
            ),
            Some(stempel("20261013-221500"))
        );
        // Entwicklungsdaten, andere Art, fremde Namen
        for (name, art) in [
            (
                "kladdy-dev-automatisch-20261013-221500.db",
                Art::Automatisch,
            ),
            ("kladdy-manuell-20261013-221500.db", Art::Automatisch),
            ("kladdy-automatisch-20261013-2215.db", Art::Automatisch),
            ("kladdy-automatisch-20261013-221500-x.db", Art::Automatisch),
            (
                "kladdy-automatisch-20261013-221500.db-wal",
                Art::Automatisch,
            ),
            ("kladdy-automatisch-2026101a-221500.db", Art::Automatisch),
            ("kladdy-vor-migration-20261013-221500.db", Art::VorMigration),
            ("notizen.txt", Art::Manuell),
        ] {
            assert_eq!(stempel_aus_name(name, "kladdy", art), None, "{name}");
        }
        assert!(
            stempel_aus_name(
                "kladdy-dev-automatisch-20261013-221500.db",
                "kladdy-dev",
                Art::Automatisch
            )
            .is_some()
        );
    }

    #[test]
    fn rotation_behaelt_neueste_und_je_monat_eine() {
        // jetzt: 13.10.2026. Je Tag eine Sicherung vom 1.9.2025 bis 13.10.2026, dazu mehrere am 13.10.
        let jetzt = T0;
        let mut dateien = Vec::new();
        let tag = 86_400;
        let start = jetzt - 407 * tag;
        let mut t = start;
        while t <= jetzt {
            let s = datenbank::utc_stempel(t);
            dateien.push((format!("kladdy-automatisch-{s}.db"), stempel(&s)));
            t += tag;
        }
        dateien.push((
            "kladdy-automatisch-20261013-221500-2.db".into(),
            Stempel {
                text: "20261013-221500".into(),
                zusatz: 2,
            },
        ));
        let weg = zu_loeschen(&dateien, jetzt);
        let bleibt: Vec<&String> = dateien
            .iter()
            .map(|(n, _)| n)
            .filter(|n| !weg.contains(n))
            .collect();
        // 10 neueste (inkl. der zweiten vom selben Zeitpunkt) …
        let mut neueste: Vec<&(String, Stempel)> = dateien.iter().collect();
        neueste.sort_by(|a, b| b.1.cmp(&a.1));
        for (n, _) in neueste.iter().take(NEUESTE_BEHALTEN) {
            assert!(bleibt.contains(&n), "{n} fehlt");
        }
        assert!(bleibt.contains(&&"kladdy-automatisch-20261013-221500-2.db".to_string()));
        // … und je Monat die neueste: November 2025 bis September 2026 jeweils der Monatsletzte
        for monat in [
            "20251130", "20251231", "20260131", "20260228", "20260331", "20260430", "20260531",
            "20260630", "20260731", "20260831", "20260930",
        ] {
            assert!(
                bleibt.iter().any(|n| n.contains(&format!("-{monat}-"))),
                "Monatssicherung {monat} fehlt"
            );
        }
        // älter als 12 Monate: Oktober 2025 und September 2025 weg
        assert!(
            !bleibt
                .iter()
                .any(|n| n.contains("-202510") || n.contains("-202509"))
        );
        // je Tag die neueste der letzten 30 Tage (14.9.–13.10.), davor nur Monatsletzte
        assert!(bleibt.iter().any(|n| n.contains("-20260914-")));
        assert!(!bleibt.iter().any(|n| n.contains("-20260913-")));
        // 30 Tage (13.10. doppelt) + Monatsletzte November 2025 bis August 2026
        assert_eq!(bleibt.len(), 31 + 10);
        // wenige Sicherungen: nichts weg
        assert!(zu_loeschen(&dateien[..5], jetzt).is_empty());
    }

    #[test]
    fn rotation_behaelt_je_tag_eine_der_letzten_30_tage() {
        // Je Tag eine gute Kopie vom 1.9. bis 12.10., dann 15 Starts am 13.10.: die Starts verdrängen nur ältere
        // Kopien desselben Tages, nicht die Tageskopien davor.
        let tag = 86_400;
        let mut dateien = Vec::new();
        for d in 1..=42u64 {
            let s = datenbank::utc_stempel(T0 - d * tag);
            dateien.push((format!("kladdy-automatisch-{s}.db"), stempel(&s)));
        }
        for i in 0..15u64 {
            let s = datenbank::utc_stempel(T0 + i);
            dateien.push((format!("kladdy-automatisch-{s}.db"), stempel(&s)));
        }
        let weg = zu_loeschen(&dateien, T0 + 20);
        for d in 1..=29u64 {
            let name = format!(
                "kladdy-automatisch-{}.db",
                datenbank::utc_stempel(T0 - d * tag)
            );
            assert!(!weg.contains(&name), "Tageskopie {name} gelöscht");
        }
        // 13.10.: die 10 neuesten Starts bleiben (die neueste des Tages ist darunter)
        assert_eq!(weg.iter().filter(|n| n.contains("-20261013-")).count(), 5);
        // der 13.9. liegt außerhalb der 30 Tage, der 14.9. nicht
        assert!(weg.iter().any(|n| n.contains("-20260913-")));
        assert!(!weg.iter().any(|n| n.contains("-20260914-")));
        // vor dem Fenster bleibt nur die neueste je Monat (September: der 30.9., also ist der 1.9. weg)
        assert!(weg.iter().any(|n| n.contains("-20260901-")));
        assert_eq!(weg.len(), 5 + 13);
    }

    #[test]
    fn deutlich_weniger_vergleicht_mit_den_letzten_30_tagen() {
        let tag = 86_400;
        let kopie = |vor_tagen: u64, z: [Option<i64>; 4]| {
            (stempel(&datenbank::utc_stempel(T0 - vor_tagen * tag)), z)
        };
        // nichts zum Vergleichen, oder nur Kopien ohne Daten: keine Warnung
        assert_eq!(deutlich_weniger(0, &[], T0), None);
        assert_eq!(
            deutlich_weniger(0, &[kopie(1, [Some(0), Some(0), Some(0), None])], T0),
            None
        );
        let liste = [
            kopie(1, [Some(3), Some(1), Some(1), Some(1)]),    // 6
            kopie(5, [Some(10), Some(2), Some(4), Some(4)]),   // 20, zeilenreichste
            kopie(31, [Some(500), Some(0), Some(0), Some(0)]), // zu alt, zählt nicht
        ];
        let w = deutlich_weniger(0, &liste, T0).unwrap();
        assert_eq!(w.zeitpunkt, datenbank::utc_iso(T0 - 5 * tag));
        assert_eq!(w.buchungen, 10);
        assert_eq!(w.zeilen, 20);
        assert!(deutlich_weniger(9, &liste, T0).is_some());
        // genau die Hälfte oder mehr: in Ordnung
        assert_eq!(deutlich_weniger(10, &liste, T0), None);
        assert_eq!(deutlich_weniger(25, &liste, T0), None);
        // 29 Tage zurück zählt noch, 30 nicht mehr
        assert!(deutlich_weniger(0, &[kopie(29, [Some(2), None, None, None])], T0).is_some());
        assert_eq!(
            deutlich_weniger(0, &[kopie(30, [Some(2), None, None, None])], T0),
            None
        );
        // Gleichstand: die neueste
        let gleich = [
            kopie(3, [Some(4), None, None, None]),
            kopie(2, [Some(4), None, None, None]),
        ];
        assert_eq!(
            deutlich_weniger(1, &gleich, T0).unwrap().zeitpunkt,
            datenbank::utc_iso(T0 - 2 * tag)
        );
    }

    #[test]
    fn leere_datenbank_verdraengt_keine_guten_kopien() {
        let ordner = testordner("leer-nach-gut");
        let db = ordner.join("kladdy.db");
        let sicherungen = ordner.join(ORDNER);
        tauri::async_runtime::block_on(migrieren(&db, MIGRATIONEN.len()));
        kunde_anlegen(&db, "Anna");
        kunde_anlegen(&db, "Ben");
        for i in 0..10 {
            assert_eq!(
                automatisch_beim_start(&db, &sicherungen, T0 + i),
                Automatisch::default()
            );
        }
        let gute: Vec<String> = tauri::async_runtime::block_on(auflisten(&sicherungen, "kladdy"))
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(gute.len(), NEUESTE_BEHALTEN);

        // Datenbank plötzlich leer: 12 Neustarts, keine gute Kopie geht verloren, jedes Mal die Warnung
        fs::remove_file(&db).unwrap();
        tauri::async_runtime::block_on(migrieren(&db, MIGRATIONEN.len()));
        for i in 0..12 {
            let a = automatisch_beim_start(&db, &sicherungen, T0 + 100 + i);
            assert_eq!(a.fehler, None);
            let w = a.weniger.expect("Warnung fehlt");
            assert_eq!(w.zeilen, 2);
            assert_eq!(w.buchungen, 0);
        }
        let liste = tauri::async_runtime::block_on(auflisten(&sicherungen, "kladdy"));
        assert_eq!(liste.len(), NEUESTE_BEHALTEN + 12);
        for name in &gute {
            assert!(liste.iter().any(|s| &s.name == name), "{name} verdrängt");
        }

        // Datenbank fehlt ganz: Warnung, keine neue Kopie
        fs::remove_file(&db).unwrap();
        let a = automatisch_beim_start(&db, &sicherungen, T0 + 200);
        assert!(a.weniger.is_some());
        assert_eq!(a.fehler, None);

        // Daten wieder da (z. B. wiederhergestellt): wieder normal aufgeräumt
        tauri::async_runtime::block_on(migrieren(&db, MIGRATIONEN.len()));
        kunde_anlegen(&db, "Anna");
        kunde_anlegen(&db, "Ben");
        assert_eq!(
            automatisch_beim_start(&db, &sicherungen, T0 + 300),
            Automatisch::default()
        );
        let liste = tauri::async_runtime::block_on(auflisten(&sicherungen, "kladdy"));
        assert_eq!(liste.len(), NEUESTE_BEHALTEN);
        let _ = fs::remove_dir_all(&ordner);
    }

    #[test]
    fn rotation_loescht_nur_automatische_mit_passendem_namen() {
        let ordner = testordner("rotation");
        let sicherungen = ordner.join(ORDNER);
        let auto = sicherungen.join("automatisch");
        let migration = sicherungen.join("vor-migration");
        fs::create_dir_all(&auto).unwrap();
        fs::create_dir_all(&migration).unwrap();
        // 15 automatische am selben Tag, eine fremde Datei, eine der Entwicklungsdaten, eine vor Migration
        for i in 0..15u64 {
            let name = format!("kladdy-automatisch-{}.db", datenbank::utc_stempel(T0 + i));
            fs::write(auto.join(name), b"x").unwrap();
        }
        fs::write(auto.join("notiz.txt"), b"x").unwrap();
        fs::write(auto.join("kladdy-dev-automatisch-20200101-000000.db"), b"x").unwrap();
        let alt_migration = migration.join("kladdy-vor-migration-0003-20200101-000000.db");
        fs::write(&alt_migration, b"x").unwrap();

        assert!(rotieren(&sicherungen, "kladdy", T0 + 20).is_empty());
        let mut uebrig: Vec<String> = fs::read_dir(&auto)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        uebrig.sort();
        assert_eq!(uebrig.len(), NEUESTE_BEHALTEN + 2);
        assert!(uebrig.contains(&"notiz.txt".to_string()));
        assert!(uebrig.contains(&"kladdy-dev-automatisch-20200101-000000.db".to_string()));
        assert!(uebrig.contains(&format!(
            "kladdy-automatisch-{}.db",
            datenbank::utc_stempel(T0 + 14)
        )));
        assert!(!uebrig.contains(&format!(
            "kladdy-automatisch-{}.db",
            datenbank::utc_stempel(T0 + 4)
        )));
        assert!(alt_migration.is_file(), "vor-migration bleibt immer");
        let _ = fs::remove_dir_all(&ordner);
    }

    #[test]
    fn automatische_sicherung_beim_start() {
        let ordner = testordner("auto-start");
        let db = ordner.join("kladdy.db");
        let sicherungen = ordner.join(ORDNER);
        // keine Datei, leere Datei: nichts
        assert_eq!(
            automatisch_beim_start(&db, &sicherungen, T0),
            Automatisch::default()
        );
        fs::write(&db, b"").unwrap();
        assert_eq!(
            automatisch_beim_start(&db, &sicherungen, T0),
            Automatisch::default()
        );
        assert!(!sicherungen.exists());
        fs::remove_file(&db).unwrap();

        tauri::async_runtime::block_on(migrieren(&db, MIGRATIONEN.len()));
        kunde_anlegen(&db, "Anna");
        for i in 0..12 {
            assert_eq!(
                automatisch_beim_start(&db, &sicherungen, T0 + i),
                Automatisch::default()
            );
        }
        let liste = tauri::async_runtime::block_on(auflisten(&sicherungen, "kladdy"));
        assert_eq!(liste.len(), NEUESTE_BEHALTEN);
        assert_eq!(liste[0].art, Art::Automatisch);
        assert_eq!(liste[0].zeitpunkt, datenbank::utc_iso(T0 + 11));
        assert_eq!(liste[0].kunden, Some(1));
        assert_eq!(liste[0].buchungen, Some(0));
        assert_eq!(liste[0].schema, Some(MIGRATIONEN.len() as i64));
        assert_eq!(liste[0].fehler, None);
        assert_eq!(
            liste[0].name,
            format!(
                "automatisch/kladdy-automatisch-{}.db",
                datenbank::utc_stempel(T0 + 11)
            )
        );
        // keine Nebendateien neben den Kopien (immutable gelesen)
        let neben = fs::read_dir(sicherungen.join("automatisch"))
            .unwrap()
            .filter(|e| {
                !e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_str()
                    .unwrap()
                    .ends_with(".db")
            })
            .count();
        assert_eq!(neben, 0);

        // Fehler (Ordner nicht anlegbar): Meldung, aber die Datenbank bleibt unberührt
        let gesperrt = ordner.join("gesperrt");
        fs::write(&gesperrt, b"x").unwrap();
        let meldung = automatisch_beim_start(&db, &gesperrt.join(ORDNER), T0)
            .fehler
            .unwrap();
        assert!(
            meldung.contains("automatische Sicherung beim Start ist fehlgeschlagen"),
            "{meldung}"
        );
        assert!(meldung.contains("arbeitet normal weiter"), "{meldung}");
        assert_eq!(kunden(&db), vec!["Anna"]);
        let _ = fs::remove_dir_all(&ordner);
    }

    #[test]
    fn gleiche_sekunde_ueberschreibt_nicht() {
        let ordner = testordner("gleiche-sekunde");
        let db = ordner.join("kladdy.db");
        let sicherungen = ordner.join(ORDNER);
        tauri::async_runtime::block_on(async {
            migrieren(&db, 2).await;
            let a = datei_sichern(&db, &sicherungen, Art::Manuell, T0)
                .await
                .unwrap()
                .unwrap();
            let b = datei_sichern(&db, &sicherungen, Art::Manuell, T0)
                .await
                .unwrap()
                .unwrap();
            assert_ne!(a, b);
            assert!(b.to_str().unwrap().ends_with("-20261013-221500-2.db"));
        });
        let liste = tauri::async_runtime::block_on(auflisten(&sicherungen, "kladdy"));
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].datei, "kladdy-manuell-20261013-221500-2.db");
        let _ = fs::remove_dir_all(&ordner);
    }

    #[test]
    fn pfad_pruefung() {
        let ordner = testordner("pfad");
        let sicherungen = ordner.join(ORDNER);
        let manuell = sicherungen.join("manuell");
        fs::create_dir_all(&manuell).unwrap();
        let gut = "kladdy-manuell-20261013-221500.db";
        fs::write(manuell.join(gut), b"x").unwrap();
        assert_eq!(
            pfad_pruefen(&sicherungen, "kladdy", &format!("manuell/{gut}")).map(|(p, _)| p),
            Ok(manuell.join(gut))
        );
        // außerhalb liegende Datei mit passendem Namen
        fs::write(ordner.join(gut), b"x").unwrap();
        let fremd_ordner = ordner.join("fremd");
        fs::create_dir_all(&fremd_ordner).unwrap();
        fs::write(fremd_ordner.join("kladdy-manuell-20261013-221501.db"), b"x").unwrap();
        // Symlink auf eine Datei und ein Ordner-Symlink
        std::os::unix::fs::symlink(
            fremd_ordner.join("kladdy-manuell-20261013-221501.db"),
            manuell.join("kladdy-manuell-20261013-221502.db"),
        )
        .unwrap();
        std::os::unix::fs::symlink(&fremd_ordner, sicherungen.join("automatisch")).unwrap();
        fs::write(
            fremd_ordner.join("kladdy-automatisch-20261013-221500.db"),
            b"x",
        )
        .unwrap();
        for name in [
            format!("manuell/../../{gut}"),
            format!("../{gut}"),
            format!("/{}", manuell.join(gut).display()),
            format!("manuell/sub/{gut}"),
            gut.to_string(),
            format!("fremd/{gut}"),
            "manuell/kladdy-manuell-20261013-221502.db".into(),
            "automatisch/kladdy-automatisch-20261013-221500.db".into(),
            "manuell/kladdy-dev-manuell-20261013-221500.db".into(),
            "manuell/kladdy-manuell-20261013-221599.db".into(),
            "manuell/notiz.txt".into(),
            String::new(),
        ] {
            assert!(
                pfad_pruefen(&sicherungen, "kladdy", &name).is_err(),
                "„{name}“ hätte abgelehnt werden müssen"
            );
        }
        let _ = fs::remove_dir_all(&ordner);
    }

    /// Kopie mit einem Kunden, dann Daten ändern, vormerken, „neu starten“: Stand der Kopie ist zurück, der Stand
    /// davor liegt in vor-wiederherstellung, die Markierung ist weg.
    #[test]
    fn wiederherstellen_ersetzt_die_datenbank() {
        let ordner = testordner("wiederherstellen");
        let db = ordner.join("kladdy.db");
        let sicherungen = ordner.join(ORDNER);
        tauri::async_runtime::block_on(migrieren(&db, MIGRATIONEN.len()));
        kunde_anlegen(&db, "Anna");
        let kopie =
            tauri::async_runtime::block_on(datei_sichern(&db, &sicherungen, Art::Manuell, T0))
                .unwrap()
                .unwrap();
        kunde_anlegen(&db, "Bernd");
        // Reste eines Journals neben der Datenbank dürfen nicht auf die neue Datei wirken
        let mut wal = db.as_os_str().to_owned();
        wal.push("-wal");
        fs::write(&wal, b"kaputt").unwrap();

        // ohne Markierung passiert nichts
        assert_eq!(
            vorgemerkte_wiederherstellung(&db, &sicherungen, T0 + 60),
            None
        );
        let name = format!("manuell/{}", kopie.file_name().unwrap().to_str().unwrap());
        tauri::async_runtime::block_on(vormerken(&db, &sicherungen, &name)).unwrap();
        assert_eq!(fs::read_to_string(marker_pfad(&db)).unwrap(), name);

        let w = vorgemerkte_wiederherstellung(&db, &sicherungen, T0 + 60)
            .unwrap()
            .unwrap();
        assert_eq!(w.zeitpunkt, "2026-10-13T22:15:00Z");
        let vorher = w.vorher.expect("Stand davor gesichert");
        assert!(
            vorher
                .contains("vor-wiederherstellung/kladdy-vor-wiederherstellung-20261013-221600.db"),
            "{vorher}"
        );
        assert!(!marker_pfad(&db).exists());
        assert!(!Path::new(&wal).exists());
        assert_eq!(kunden(&db), vec!["Anna"]);
        // Stand davor gesichert, die Kopie selbst unverändert
        let liste = tauri::async_runtime::block_on(auflisten(&sicherungen, "kladdy"));
        let davor = liste
            .iter()
            .find(|s| s.art == Art::VorWiederherstellung)
            .expect("Sicherung des Stands davor");
        assert_eq!(davor.kunden, Some(2));
        assert!(kopie.is_file());
        // keine Reste
        assert!(!ordner.join("kladdy.db.wiederherstellen-neu").exists());
        let _ = fs::remove_dir_all(&ordner);
    }

    /// Scheitert die Sicherung des aktuellen Stands, wird nichts überschrieben.
    #[test]
    fn wiederherstellen_ohne_sicherung_ueberschreibt_nichts() {
        let ordner = testordner("wiederherstellen-fehler");
        let db = ordner.join("kladdy.db");
        let sicherungen = ordner.join(ORDNER);
        tauri::async_runtime::block_on(migrieren(&db, MIGRATIONEN.len()));
        kunde_anlegen(&db, "Anna");
        let kopie =
            tauri::async_runtime::block_on(datei_sichern(&db, &sicherungen, Art::Manuell, T0))
                .unwrap()
                .unwrap();
        kunde_anlegen(&db, "Bernd");
        let vorher = fs::read(&db).unwrap();
        // Ordner vor-wiederherstellung blockiert (Datei statt Ordner): Sicherung davor scheitert
        fs::write(sicherungen.join("vor-wiederherstellung"), b"x").unwrap();
        let name = format!("manuell/{}", kopie.file_name().unwrap().to_str().unwrap());
        tauri::async_runtime::block_on(vormerken(&db, &sicherungen, &name)).unwrap();

        let fehler = vorgemerkte_wiederherstellung(&db, &sicherungen, T0 + 60)
            .unwrap()
            .unwrap_err();
        assert!(fehler.contains("nicht gesichert"), "{fehler}");
        assert!(fehler.contains("nichts überschrieben"), "{fehler}");
        assert_eq!(fs::read(&db).unwrap(), vorher);
        assert_eq!(kunden(&db), vec!["Anna", "Bernd"]);
        assert!(
            !marker_pfad(&db).exists(),
            "kein erneuter Versuch bei jedem Start"
        );
        let _ = fs::remove_dir_all(&ordner);
    }

    /// Ältere Sicherung (vor einer Migration) lässt sich zurückholen; neuere, fremde und kaputte werden abgelehnt.
    #[test]
    fn wiederherstellen_prueft_die_sicherung() {
        let ordner = testordner("wiederherstellen-pruefen");
        let db = ordner.join("kladdy.db");
        let sicherungen = ordner.join(ORDNER);
        let manuell = sicherungen.join("manuell");
        fs::create_dir_all(&manuell).unwrap();
        tauri::async_runtime::block_on(async {
            // älterer Stand: gültig, Schema 5
            let alt = manuell.join("kladdy-manuell-20260101-000000.db");
            migrieren(&alt, 5).await;
            // neuerer Stand: unbekannte Migration 99
            let neu = manuell.join("kladdy-manuell-20260102-000000.db");
            migrieren(&neu, MIGRATIONEN.len()).await;
            let mut c = verbinden(&neu).await;
            sqlx::query("INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (99, 'zukunft', 1, x'00', 0)")
                .execute(&mut c)
                .await
                .unwrap();
            c.close().await.unwrap();
            // fremde SQLite-Datei und Datei ohne SQLite
            let fremd = manuell.join("kladdy-manuell-20260103-000000.db");
            let mut c = verbinden(&fremd).await;
            sqlx::query("CREATE TABLE x (a)")
                .execute(&mut c)
                .await
                .unwrap();
            c.close().await.unwrap();
            fs::write(
                manuell.join("kladdy-manuell-20260104-000000.db"),
                b"kein sqlite",
            )
            .unwrap();

            vormerken(
                &db,
                &sicherungen,
                "manuell/kladdy-manuell-20260101-000000.db",
            )
            .await
            .unwrap();
            for (datei, erwartet) in [
                (
                    "kladdy-manuell-20260102-000000.db",
                    "neueren Kladdy-Version",
                ),
                (
                    "kladdy-manuell-20260103-000000.db",
                    "keine Kladdy-Datenbank",
                ),
                ("kladdy-manuell-20260104-000000.db", ""),
            ] {
                let f = vormerken(&db, &sicherungen, &format!("manuell/{datei}"))
                    .await
                    .unwrap_err();
                assert!(f.contains(erwartet), "{datei}: {f}");
            }
            let liste = auflisten(&sicherungen, "kladdy").await;
            assert_eq!(liste.len(), 4);
            assert_eq!(liste[3].schema, Some(5));
            assert_eq!(liste[3].fehler, None);
            assert_eq!(liste[3].rechnungen, Some(0));
            assert!(
                liste[0].fehler.is_some() && liste[1].fehler.is_some() && liste[2].fehler.is_some()
            );
        });
        // Wiederherstellen ohne vorhandene Datenbank (der Ernstfall: Datei weg)
        let w = vorgemerkte_wiederherstellung(&db, &sicherungen, T0)
            .unwrap()
            .unwrap();
        assert_eq!(
            w,
            Wiederhergestellt {
                zeitpunkt: "2026-01-01T00:00:00Z".into(),
                vorher: None
            }
        );
        assert!(db.is_file());
        // danach migriert die App wie gewohnt
        tauri::async_runtime::block_on(migrieren(&db, MIGRATIONEN.len()));
        let _ = fs::remove_dir_all(&ordner);
    }

    #[test]
    fn bericht_vom_start() {
        assert_eq!(
            Bericht::aus(None, Automatisch::default()),
            Bericht::default()
        );
        let w = Wiederhergestellt {
            zeitpunkt: "2026-01-01T00:00:00Z".into(),
            vorher: None,
        };
        let mehr = MehrDaten {
            zeitpunkt: "2026-01-01T00:00:00Z".into(),
            buchungen: 7,
            zeilen: 9,
        };
        let auto = |fehler: Option<&str>| Automatisch {
            fehler: fehler.map(str::to_string),
            weniger: Some(mehr.clone()),
        };
        let b = Bericht::aus(Some(Ok(w.clone())), auto(Some("auto kaputt")));
        assert_eq!(b.wiederhergestellt, Some(w));
        assert_eq!(b.fehler, vec!["auto kaputt"]);
        // nach gewolltem Wiederherstellen keine Warnung „weniger Daten“
        assert_eq!(b.weniger_daten, None);
        let b = Bericht::aus(Some(Err("nein".into())), auto(None));
        assert_eq!(b.fehler, vec!["nein"]);
        assert_eq!(b.weniger_daten, Some(mehr.clone()));
        assert_eq!(Bericht::aus(None, auto(None)).weniger_daten, Some(mehr));
    }
}
