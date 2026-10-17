//! Belege ablegen (ANLEITUNG §2.5, §5 Tabelle `belege`, §6.4 „Original-Datei immer unverändert ablegen (Hash)“).
//!
//! - Ablage: `<appDataDir>/belege/` (Debug-Builds: `belege-dev/`, wie DB_DATEI in datenbank.rs; im Demo-Modus
//!   `belege-dev-demo/`, siehe src/demo.rs), darin
//!   `<JJJJ>/<sha256>.<endung>` mit JJJJ = Jahr des Zahlungsdatums. `belege.pfad` ist dieser relative Pfad.
//! - Gleicher Inhalt = gleicher Name: Liegt die Datei schon da, wird nicht erneut kopiert und nie überschrieben.
//!   Sonst: Kopie in eine Zwischendatei im selben Ordner, deren Prüfsumme nachrechnen, schreibschützen (0o444),
//!   dann per harter Verknüpfung an den Zielnamen (scheitert, statt zu überschreiben) und die Zwischendatei entfernen.
//! - Die Zeilen in `belege` entstehen in derselben Transaktion wie die Buchung. Scheitert sie, werden Dateien, die
//!   dieser Vorgang neu angelegt hat, wieder entfernt (nur wenn keine Zeile in `belege` auf sie verweist).
//! - Zeilen in `belege` werden nie gelöscht und nie geändert, nur die Aufbewahrungsfrist kann sich verlängern
//!   (Trigger in Migration 0005).
//!
//! Die Kernfunktionen nehmen den Ablageordner und eine Verbindung, damit die Tests ohne Tauri auskommen.

use std::collections::HashSet;
use std::fmt::Write as _;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Connection, SqliteConnection};
use tauri::Manager;
use tauri_plugin_sql::DbInstances;

use crate::buchungen::{datum_lesen, protokollieren, verbindung, zeile_json};
use crate::datenbank::{self, db_fehler};

/// Unterordner im App-Verzeichnis. Debug-Builds legen getrennt ab, damit die Entwicklung nie die Belege der
/// installierten App berührt (gleicher Identifier, gleicher Ordner).
pub const BELEGE_ORDNER: &str = if cfg!(debug_assertions) {
    "belege-dev"
} else {
    "belege"
};

/// Größte erlaubte Datei: 50 MB.
pub const MAX_GROESSE: u64 = 50 * 1024 * 1024;

/// Aufbewahrungsfrist für Buchungsbelege in Jahren (§2.5, seit 2025), Fristbeginn Ende des Kalenderjahres.
const AUFBEWAHRUNG_JAHRE: i64 = 8;

const ERLAUBT: &str = "Erlaubt: PDF, Bilder (JPG, PNG, HEIC, WebP, TIFF) und E-Rechnungen (XML).";

/// Erlaubte Endungen (klein geschrieben) ⇒ (MIME-Typ, belege.art).
fn dateityp(endung: &str) -> Option<(&'static str, &'static str)> {
    let mime = match endung {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "webp" => "image/webp",
        "tif" | "tiff" => "image/tiff",
        "xml" => return Some(("application/xml", "erechnung_xml")),
        _ => return None,
    };
    Some((mime, "beleg"))
}

/// Unterordner der aktiven Datenbank: im Demo-Modus (nur Debug) ein eigener, sonst `BELEGE_ORDNER`.
pub fn aktiver_ordner() -> &'static str {
    #[cfg(debug_assertions)]
    if crate::demo::aktiv() {
        return crate::demo::DEMO_BELEGE_ORDNER;
    }
    BELEGE_ORDNER
}

/// Ablageordner der App (der aktiven Datenbank).
pub fn ablage_ordner<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join(aktiver_ordner()))
        .map_err(|e| format!("App-Verzeichnis nicht gefunden: {e}"))
}

/// `aufbewahren_bis` = 31.12. des Jahres (Jahr des Zahlungsdatums + 8).
pub fn aufbewahren_bis(zahlungsdatum: &str) -> Result<String, String> {
    let (jahr, _, _) = datum_lesen("Zahlungsdatum", zahlungsdatum)?;
    Ok(format!("{:04}-12-31", jahr + AUFBEWAHRUNG_JAHRE))
}

/* ---------- Dateien prüfen, hashen, ablegen (ohne Datenbank) ---------- */

/// Eine geprüfte Quelldatei.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Datei {
    pub quelle: PathBuf,
    /// Originalname (letzter Pfadteil)
    pub name: String,
    pub groesse: u64,
    /// Endung, klein geschrieben, ohne Punkt
    pub endung: String,
    pub mime: &'static str,
    /// 'beleg' | 'erechnung_xml'
    pub art: &'static str,
}

fn dateiname(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| p.to_string_lossy().into_owned())
}

fn endung_von(p: &Path) -> String {
    p.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn groesse_pruefen(groesse: u64) -> Result<(), String> {
    if groesse == 0 {
        return Err("Die Datei ist leer.".into());
    }
    if groesse > MAX_GROESSE {
        return Err("Die Datei ist größer als 50 MB.".into());
    }
    Ok(())
}

/// Prüft eine Quelldatei (gibt es sie, ist es eine Datei, erlaubter Typ, Größe). Liest den Inhalt nicht.
pub fn datei_pruefen(pfad: &str) -> Result<Datei, String> {
    let quelle = PathBuf::from(pfad);
    if !quelle.is_absolute() {
        return Err(format!("Der Pfad „{pfad}“ ist nicht vollständig."));
    }
    let meta = match fs::metadata(&quelle) {
        Ok(m) => m,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return Err("Die Datei gibt es nicht (mehr).".into());
        }
        Err(e) => return Err(format!("Die Datei ist nicht lesbar: {e}")),
    };
    if meta.is_dir() {
        return Err("Ordner können nicht abgelegt werden, nur einzelne Dateien.".into());
    }
    if !meta.is_file() {
        return Err("Das ist keine gewöhnliche Datei.".into());
    }
    let endung = endung_von(&quelle);
    let Some((mime, art)) = dateityp(&endung) else {
        return Err(if endung.is_empty() {
            format!("Dateien ohne Endung werden nicht unterstützt. {ERLAUBT}")
        } else {
            format!("Dateityp .{endung} wird nicht unterstützt. {ERLAUBT}")
        });
    };
    groesse_pruefen(meta.len())?;
    Ok(Datei {
        name: dateiname(&quelle),
        quelle,
        groesse: meta.len(),
        endung,
        mime,
        art,
    })
}

/// SHA-256 (klein geschriebenes Hex) und Länge, gelesen in Stücken (Dateien bis 50 MB nie ganz im Speicher).
pub fn sha256_lesen(mut r: impl Read) -> io::Result<(String, u64)> {
    let mut hasher = Sha256::new();
    let mut puffer = vec![0u8; 64 * 1024];
    let mut laenge = 0u64;
    loop {
        let n = match r.read(&mut puffer) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        hasher.update(&puffer[..n]);
        laenge += n as u64;
    }
    let mut hex = String::with_capacity(64);
    for b in hasher.finalize() {
        let _ = write!(hex, "{b:02x}");
    }
    Ok((hex, laenge))
}

fn sha256_datei(p: &Path) -> Result<(String, u64), String> {
    File::open(p)
        .and_then(sha256_lesen)
        .map_err(|e| format!("Die Datei ist nicht lesbar: {e}"))
}

/// Ergebnis von `ablegen`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Abgelegt {
    /// relativ zum Ablageordner, z. B. `2026/ab12….pdf`
    pub pfad: String,
    pub sha256: String,
    pub groesse: u64,
    /// true, wenn die Datei in diesem Aufruf neu angelegt wurde
    pub neu: bool,
}

/// Zähler für eindeutige Namen der Zwischendateien.
static ZWISCHEN: AtomicU64 = AtomicU64::new(0);

/// Legt die Quelldatei unverändert in `<ablage>/<jahr>/<sha256>.<endung>` ab (siehe Modulkommentar).
pub fn ablegen(ablage: &Path, datei: &Datei, jahr: i64) -> Result<Abgelegt, String> {
    let (sha256, groesse) = sha256_datei(&datei.quelle)?;
    groesse_pruefen(groesse)?;
    let jahr_ordner = format!("{jahr:04}");
    let pfad = format!("{jahr_ordner}/{sha256}.{}", datei.endung);
    let ziel = ablage.join(&pfad);
    let ergebnis = |neu| Abgelegt {
        pfad: pfad.clone(),
        sha256: sha256.clone(),
        groesse,
        neu,
    };
    // gleicher Name = gleicher Inhalt: nicht noch einmal kopieren, nie überschreiben
    if fs::symlink_metadata(&ziel).is_ok() {
        return Ok(ergebnis(false));
    }
    let ordner = ablage.join(&jahr_ordner);
    fs::create_dir_all(&ordner).map_err(|e| format!("Belegablage {}: {e}", ordner.display()))?;
    let zwischen = ordner.join(format!(
        ".{sha256}.{}-{}.tmp",
        std::process::id(),
        ZWISCHEN.fetch_add(1, Ordering::Relaxed)
    ));
    let gelinkt = kopieren_und_verknuepfen(&datei.quelle, &zwischen, &ziel, &sha256);
    let _ = fs::remove_file(&zwischen);
    match gelinkt {
        Ok(()) => Ok(ergebnis(true)),
        // in der Zwischenzeit von jemand anderem abgelegt: gleicher Inhalt, also gut so
        Err(Fehler::Vorhanden) => Ok(ergebnis(false)),
        Err(Fehler::Text(t)) => Err(t),
    }
}

enum Fehler {
    Vorhanden,
    Text(String),
}

fn kopieren_und_verknuepfen(
    quelle: &Path,
    zwischen: &Path,
    ziel: &Path,
    sha256: &str,
) -> Result<(), Fehler> {
    let kopierfehler =
        |e: io::Error| Fehler::Text(format!("Die Datei konnte nicht abgelegt werden: {e}"));
    {
        let mut ein = File::open(quelle).map_err(kopierfehler)?;
        let mut aus = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(zwischen)
            .map_err(kopierfehler)?;
        io::copy(&mut ein, &mut aus).map_err(kopierfehler)?;
        aus.flush().map_err(kopierfehler)?;
        aus.sync_all().map_err(kopierfehler)?;
    }
    let (kopie, _) = sha256_datei(zwischen).map_err(Fehler::Text)?;
    if kopie != sha256 {
        return Err(Fehler::Text(
            "Die Datei hat sich beim Ablegen verändert. Bitte noch einmal versuchen.".into(),
        ));
    }
    schreibschuetzen(zwischen).map_err(kopierfehler)?;
    match fs::hard_link(zwischen, ziel) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Err(Fehler::Vorhanden),
        Err(e) => Err(kopierfehler(e)),
    }
}

#[cfg(unix)]
fn schreibschuetzen(p: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(p, fs::Permissions::from_mode(0o444))
}

#[cfg(not(unix))]
fn schreibschuetzen(p: &Path) -> io::Result<()> {
    let mut rechte = fs::metadata(p)?.permissions();
    rechte.set_readonly(true);
    fs::set_permissions(p, rechte)
}

/// Absoluter Pfad einer abgelegten Datei. Verweigert alles, was aus dem Ablageordner herausführt
/// (absolute Pfade, `..`, symbolische Links nach draußen).
pub fn sicherer_pfad(ablage: &Path, pfad: &str, name: &str) -> Result<PathBuf, String> {
    let ausserhalb =
        || "Der Beleg liegt außerhalb der Belegablage und wird nicht geöffnet.".to_string();
    let fehlt = || format!("Die Datei des Belegs fehlt: {name}");
    let rel = Path::new(pfad);
    if pfad.is_empty() || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(ausserhalb());
    }
    let basis = fs::canonicalize(ablage).map_err(|_| fehlt())?;
    let voll = fs::canonicalize(ablage.join(rel)).map_err(|_| fehlt())?;
    if !voll.starts_with(&basis) {
        return Err(ausserhalb());
    }
    if !voll.is_file() {
        return Err(fehlt());
    }
    Ok(voll)
}

/* ---------- Mit Datenbank ---------- */

/// Führt `arbeit` in einer Transaktion aus (BEGIN IMMEDIATE wie buchungen::in_transaktion). `arbeit` trägt jede
/// neu abgelegte Datei (relativer Pfad) in die Liste ein; scheitert der Vorgang, werden sie wieder entfernt.
pub(crate) async fn in_transaktion_mit_ablage<T>(
    conn: &mut SqliteConnection,
    ablage: &Path,
    arbeit: impl AsyncFnOnce(&mut SqliteConnection, &mut Vec<String>) -> Result<T, String>,
) -> Result<T, String> {
    let mut neue = Vec::new();
    let mut tx = conn
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(db_fehler)?;
    let ergebnis = match arbeit(&mut tx, &mut neue).await {
        Ok(wert) => tx.commit().await.map(|()| wert).map_err(db_fehler),
        Err(e) => {
            let _ = tx.rollback().await;
            Err(e)
        }
    };
    if ergebnis.is_err() {
        aufraeumen(conn, ablage, &neue).await;
    }
    ergebnis
}

/// Entfernt neu abgelegte Dateien eines gescheiterten Vorgangs, auf die keine Zeile in `belege` verweist
/// (z. B. verweist eine alte Zeile darauf, wenn die Datei vorher gefehlt hat und neu abgelegt wurde).
/// Unter der Schreibsperre, damit kein anderer Vorgang die Datei gerade wiederverwendet. Gelingt das nicht,
/// bleibt die Datei liegen: harmlos, gleicher Inhalt wird beim nächsten Mal wiederverwendet.
async fn aufraeumen(conn: &mut SqliteConnection, ablage: &Path, neue: &[String]) {
    if neue.is_empty() {
        return;
    }
    let Ok(mut tx) = conn.begin_with("BEGIN IMMEDIATE").await else {
        return;
    };
    for pfad in neue {
        let benutzt: Result<i64, _> =
            sqlx::query_scalar("SELECT count(*) FROM belege WHERE pfad = ?")
                .bind(pfad)
                .fetch_one(&mut *tx)
                .await;
        if matches!(benutzt, Ok(0)) {
            let _ = fs::remove_file(ablage.join(pfad));
        }
    }
    let _ = tx.rollback().await;
}

/// Quellpfade ohne Wiederholung (dieselbe Datei zweimal im selben Aufruf wird einmal abgelegt), Reihenfolge bleibt.
fn ohne_wiederholung(pfade: &[String]) -> Vec<&String> {
    let mut gesehen = HashSet::new();
    pfade
        .iter()
        .filter(|p| {
            let schluessel = fs::canonicalize(p).unwrap_or_else(|_| PathBuf::from(p));
            gesehen.insert(schluessel)
        })
        .collect()
}

/// Legt die Dateien ab und schreibt je Datei eine Zeile in `belege` samt Protokoll ('neu', ganze Zeile).
/// Läuft in der Transaktion des Aufrufers. Gibt die IDs der neuen Zeilen zurück.
pub(crate) async fn belege_ablegen(
    tx: &mut SqliteConnection,
    ablage: &Path,
    buchung_id: i64,
    zahlungsdatum: &str,
    pfade: &[String],
    zeitpunkt: &str,
    neue_dateien: &mut Vec<String>,
) -> Result<Vec<i64>, String> {
    if pfade.is_empty() {
        return Ok(Vec::new());
    }
    let (jahr, _, _) = datum_lesen("Zahlungsdatum", zahlungsdatum)?;
    let bis = aufbewahren_bis(zahlungsdatum)?;
    // erst alle prüfen (billig), dann kopieren
    let mut dateien = Vec::new();
    for p in ohne_wiederholung(pfade) {
        let d = datei_pruefen(p).map_err(|e| format!("„{}“: {e}", dateiname(Path::new(p))))?;
        dateien.push(d);
    }
    let mut ids = Vec::new();
    for d in &dateien {
        let a = ablegen(ablage, d, jahr).map_err(|e| format!("„{}“: {e}", d.name))?;
        if a.neu {
            neue_dateien.push(a.pfad.clone());
        }
        let id = sqlx::query(
            "INSERT INTO belege (buchung_id, pfad, originalname, mime, sha256, groesse, art, aufbewahren_bis, erstellt_am)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(buchung_id)
        .bind(&a.pfad)
        .bind(&d.name)
        .bind(d.mime)
        .bind(&a.sha256)
        .bind(a.groesse as i64)
        .bind(d.art)
        .bind(&bis)
        .bind(zeitpunkt)
        .execute(&mut *tx)
        .await
        .map_err(db_fehler)?
        .last_insert_rowid();
        let neu = zeile_json(tx, "belege", id).await?;
        protokollieren(tx, zeitpunkt, "belege", id, "neu", None, neu.as_ref()).await?;
        ids.push(id);
    }
    Ok(ids)
}

/// Nach einer Änderung des Zahlungsdatums: Frist der Belege der Buchung auf max(alt, neu berechnet) setzen und jede
/// tatsächliche Änderung protokollieren. Nie kürzen (§2.5; der Trigger aus 0005 würde es auch verweigern).
pub(crate) async fn aufbewahrung_verlaengern(
    tx: &mut SqliteConnection,
    buchung_id: i64,
    zahlungsdatum: &str,
    zeitpunkt: &str,
) -> Result<(), String> {
    let neu_bis = aufbewahren_bis(zahlungsdatum)?;
    let zeilen: Vec<(i64, String)> =
        sqlx::query_as("SELECT id, aufbewahren_bis FROM belege WHERE buchung_id = ? ORDER BY id")
            .bind(buchung_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(db_fehler)?;
    for (id, alt_bis) in zeilen {
        if neu_bis <= alt_bis {
            continue;
        }
        sqlx::query("UPDATE belege SET aufbewahren_bis = ? WHERE id = ?")
            .bind(&neu_bis)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_fehler)?;
        let mut alt = serde_json::Map::new();
        alt.insert("aufbewahren_bis".into(), alt_bis.into());
        let mut neu = serde_json::Map::new();
        neu.insert("aufbewahren_bis".into(), neu_bis.clone().into());
        protokollieren(
            tx,
            zeitpunkt,
            "belege",
            id,
            "geaendert",
            Some(&alt),
            Some(&neu),
        )
        .await?;
    }
    Ok(())
}

/// Hängt Belege an eine vorhandene Buchung an. Erlaubt auch im festgeschriebenen Zeitraum: Die Buchung selbst
/// wird nicht verändert, es entstehen nur neue Zeilen in `belege`. Nicht an Stornobuchungen.
pub async fn anhaengen(
    conn: &mut SqliteConnection,
    ablage: &Path,
    buchung_id: i64,
    pfade: &[String],
    zeitpunkt: &str,
) -> Result<Vec<i64>, String> {
    in_transaktion_mit_ablage(conn, ablage, async |tx, neue| {
        let zeile: Option<(String, Option<i64>)> =
            sqlx::query_as("SELECT zahlungsdatum, storno_von_id FROM buchungen WHERE id = ?")
                .bind(buchung_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db_fehler)?;
        let Some((zahlungsdatum, storno_von_id)) = zeile else {
            return Err("Die Buchung gibt es nicht.".into());
        };
        if storno_von_id.is_some() {
            return Err("An eine Stornobuchung kann kein Beleg angehängt werden.".into());
        }
        belege_ablegen(
            tx,
            ablage,
            buchung_id,
            &zahlungsdatum,
            pfade,
            zeitpunkt,
            neue,
        )
        .await
    })
    .await
}

/// Buchung, die schon einen Beleg mit derselben Prüfsumme hat.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Doppelt {
    pub buchung_id: i64,
    pub nummer: String,
    pub zahlungsdatum: String,
    /// true, wenn die Buchung storniert ist (es gibt eine Gegenbuchung)
    pub storniert: bool,
}

/// Prüfergebnis je Datei für `beleg_pruefen`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Pruefung {
    pub pfad: String,
    pub name: String,
    pub groesse: u64,
    pub mime: String,
    /// None, wenn die Datei nicht abgelegt werden kann (dann ist `fehler` gesetzt)
    pub sha256: Option<String>,
    pub fehler: Option<String>,
    pub doppelt: Vec<Doppelt>,
}

/// Prüft Dateien vor dem Ablegen (nur lesen, nichts kopieren): Typ, Größe, Prüfsumme und Buchungen, die schon einen
/// Beleg mit gleichem Inhalt haben. Ein Eintrag je Pfad, gleiche Reihenfolge.
pub async fn pruefen(
    conn: &mut SqliteConnection,
    pfade: &[String],
) -> Result<Vec<Pruefung>, String> {
    let mut liste = Vec::with_capacity(pfade.len());
    for p in pfade {
        let pfad = Path::new(p);
        let mut e = Pruefung {
            pfad: p.clone(),
            name: dateiname(pfad),
            groesse: 0,
            mime: dateityp(&endung_von(pfad))
                .map(|(m, _)| m.to_string())
                .unwrap_or_default(),
            sha256: None,
            fehler: None,
            doppelt: Vec::new(),
        };
        let geprueft = datei_pruefen(p).and_then(|_| {
            let (sha, groesse) = sha256_datei(pfad)?;
            groesse_pruefen(groesse)?;
            Ok((sha, groesse))
        });
        match geprueft {
            Ok((sha, groesse)) => {
                e.groesse = groesse;
                e.doppelt = doppelte(conn, &sha).await?;
                e.sha256 = Some(sha);
            }
            Err(f) => {
                e.groesse = fs::metadata(pfad)
                    .ok()
                    .filter(|m| m.is_file())
                    .map_or(0, |m| m.len());
                e.fehler = Some(f);
            }
        }
        liste.push(e);
    }
    Ok(liste)
}

async fn doppelte(conn: &mut SqliteConnection, sha256: &str) -> Result<Vec<Doppelt>, String> {
    let zeilen: Vec<(i64, String, String, i64)> = sqlx::query_as(
        "SELECT b.id, b.nummer, b.zahlungsdatum,
           EXISTS (SELECT 1 FROM buchungen s WHERE s.storno_von_id = b.id)
         FROM buchungen b
         WHERE b.id IN (SELECT buchung_id FROM belege WHERE sha256 = ?)
         ORDER BY b.zahlungsdatum, b.id",
    )
    .bind(sha256)
    .fetch_all(conn)
    .await
    .map_err(db_fehler)?;
    Ok(zeilen
        .into_iter()
        .map(|(buchung_id, nummer, zahlungsdatum, storniert)| Doppelt {
            buchung_id,
            nummer,
            zahlungsdatum,
            storniert: storniert != 0,
        })
        .collect())
}

/// Absoluter Pfad der abgelegten Datei eines Belegs (siehe `sicherer_pfad`).
pub async fn beleg_datei(
    conn: &mut SqliteConnection,
    ablage: &Path,
    id: i64,
) -> Result<PathBuf, String> {
    let zeile: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT pfad, originalname FROM belege WHERE id = ?")
            .bind(id)
            .fetch_optional(conn)
            .await
            .map_err(db_fehler)?;
    let Some((pfad, name)) = zeile else {
        return Err("Den Beleg gibt es nicht.".into());
    };
    let name = name.unwrap_or_else(|| pfad.clone());
    sicherer_pfad(ablage, &pfad, &name)
}

/// macOS: `open` (Standard-App) bzw. `open -R` (im Finder zeigen).
fn mit_open(zeigen: bool, datei: &Path) -> Result<(), String> {
    let mut befehl = std::process::Command::new("/usr/bin/open");
    if zeigen {
        befehl.arg("-R");
    }
    let status = befehl
        .arg(datei)
        .status()
        .map_err(|e| format!("Der Beleg konnte nicht geöffnet werden: {e}"))?;
    if status.success() {
        Ok(())
    } else if zeigen {
        Err("Der Beleg konnte im Finder nicht gezeigt werden.".into())
    } else {
        Err("Der Beleg konnte nicht geöffnet werden.".into())
    }
}

/* ---------- Tauri-Commands (dünne Hüllen) ---------- */

/// Antwort von `beleg_anhaengen`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Angehaengt {
    pub ids: Vec<i64>,
}

/// Frontend: `invoke('beleg_pruefen', { pfade })`.
#[tauri::command]
pub async fn beleg_pruefen(
    instanzen: tauri::State<'_, DbInstances>,
    pfade: Vec<String>,
) -> Result<Vec<Pruefung>, String> {
    let mut c = verbindung(&instanzen).await?;
    pruefen(&mut c, &pfade).await
}

/// Frontend: `invoke('beleg_anhaengen', { buchungId, pfade })`.
#[tauri::command]
pub async fn beleg_anhaengen(
    app: tauri::AppHandle,
    instanzen: tauri::State<'_, DbInstances>,
    buchung_id: i64,
    pfade: Vec<String>,
) -> Result<Angehaengt, String> {
    let ablage = ablage_ordner(&app)?;
    let mut c = verbindung(&instanzen).await?;
    let ids = anhaengen(
        &mut c,
        &ablage,
        buchung_id,
        &pfade,
        &datenbank::zeitstempel(),
    )
    .await?;
    Ok(Angehaengt { ids })
}

/// Frontend: `invoke('beleg_oeffnen', { id })` – öffnet die abgelegte Datei mit der Standard-App.
#[tauri::command]
pub async fn beleg_oeffnen(
    app: tauri::AppHandle,
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
) -> Result<(), String> {
    let ablage = ablage_ordner(&app)?;
    let mut c = verbindung(&instanzen).await?;
    let datei = beleg_datei(&mut c, &ablage, id).await?;
    mit_open(false, &datei)
}

/// Frontend: `invoke('beleg_zeigen', { id })` – zeigt die abgelegte Datei im Finder.
#[tauri::command]
pub async fn beleg_zeigen(
    app: tauri::AppHandle,
    instanzen: tauri::State<'_, DbInstances>,
    id: i64,
) -> Result<(), String> {
    let ablage = ablage_ordner(&app)?;
    let mut c = verbindung(&instanzen).await?;
    let datei = beleg_datei(&mut c, &ablage, id).await?;
    mit_open(true, &datei)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buchungen::{self, BuchungEingabe};
    use crate::datenbank::testhilfe::test_db;
    use serde_json::Value;

    const JETZT: &str = "2026-10-15T08:00:00Z";
    const SPAETER: &str = "2026-10-16T09:30:00Z";

    /// buchung_id, pfad, originalname, mime, sha256, groesse, art, aufbewahren_bis, erstellt_am
    type BelegZeile = (
        i64,
        String,
        String,
        String,
        String,
        i64,
        String,
        String,
        String,
    );

    /// Eigener leerer Ordner je Test (ohne tempfile-Crate).
    fn testordner(name: &str) -> PathBuf {
        let p =
            std::env::temp_dir().join(format!("kladdy-belege-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn schreiben(ordner: &Path, name: &str, inhalt: &[u8]) -> String {
        let p = ordner.join(name);
        fs::write(&p, inhalt).unwrap();
        p.to_string_lossy().into_owned()
    }

    fn sha(inhalt: &[u8]) -> String {
        sha256_lesen(inhalt).unwrap().0
    }

    fn ausgabe(belege: Vec<String>) -> BuchungEingabe {
        BuchungEingabe {
            typ: "ausgabe".into(),
            zahlungsdatum: "2026-10-14".into(),
            belegdatum: None,
            betrag_cent: 4_783,
            privatanteil_prozent: 0,
            kategorie_id: 2,
            kunde_id: None,
            neuer_kunde: None,
            lieferant: Some("Bauhaus".into()),
            zahlungsart: "bank".into(),
            belegnummer: None,
            beschreibung: "Erde".into(),
            heute: "2026-10-15".into(),
            belege,
        }
    }

    async fn anzahl(c: &mut SqliteConnection, sql: &str) -> i64 {
        sqlx::query_scalar(sql).fetch_one(c).await.unwrap()
    }

    /// Dateien unterhalb des Ordners (rekursiv), relativ, sortiert.
    fn dateien(ordner: &Path) -> Vec<String> {
        fn sammeln(basis: &Path, p: &Path, liste: &mut Vec<String>) {
            for e in fs::read_dir(p).unwrap() {
                let e = e.unwrap().path();
                if e.is_dir() {
                    sammeln(basis, &e, liste);
                } else {
                    liste.push(
                        e.strip_prefix(basis)
                            .unwrap()
                            .to_string_lossy()
                            .into_owned(),
                    );
                }
            }
        }
        let mut liste = Vec::new();
        if ordner.exists() {
            sammeln(ordner, ordner, &mut liste);
        }
        liste.sort();
        liste
    }

    fn lauf<F: std::future::Future<Output = ()>>(f: F) {
        tauri::async_runtime::block_on(f);
    }

    #[test]
    fn dev_und_release_haben_verschiedene_ordner() {
        if cfg!(debug_assertions) {
            assert_eq!(BELEGE_ORDNER, "belege-dev");
        } else {
            assert_eq!(BELEGE_ORDNER, "belege");
        }
    }

    #[test]
    fn pruefsumme_und_frist() {
        assert_eq!(
            sha(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        // über mehrere Lesestücke hinweg wie in einem Rutsch
        let gross: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let (hex, laenge) = sha256_lesen(&gross[..]).unwrap();
        let mut h = Sha256::new();
        h.update(&gross);
        let erwartet: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!((hex, laenge), (erwartet, 200_000));

        assert_eq!(aufbewahren_bis("2026-10-14").unwrap(), "2034-12-31");
        assert_eq!(aufbewahren_bis("2025-01-01").unwrap(), "2033-12-31");
        assert!(aufbewahren_bis("2026-02-30").is_err());
    }

    #[test]
    fn dateien_pruefen() {
        let o = testordner("pruefen");
        let erlaubt_text =
            "Erlaubt: PDF, Bilder (JPG, PNG, HEIC, WebP, TIFF) und E-Rechnungen (XML).";
        let docx = schreiben(&o, "brief.docx", b"x");
        assert_eq!(
            datei_pruefen(&docx).unwrap_err(),
            format!("Dateityp .docx wird nicht unterstützt. {erlaubt_text}")
        );
        let ohne = schreiben(&o, "README", b"x");
        assert!(datei_pruefen(&ohne).unwrap_err().contains("ohne Endung"));
        let leer = schreiben(&o, "leer.pdf", b"");
        assert_eq!(datei_pruefen(&leer).unwrap_err(), "Die Datei ist leer.");
        let gross = o.join("gross.pdf");
        File::create(&gross)
            .unwrap()
            .set_len(MAX_GROESSE + 1)
            .unwrap();
        assert_eq!(
            datei_pruefen(gross.to_str().unwrap()).unwrap_err(),
            "Die Datei ist größer als 50 MB."
        );
        let genau = o.join("genau.pdf");
        File::create(&genau).unwrap().set_len(MAX_GROESSE).unwrap();
        assert!(datei_pruefen(genau.to_str().unwrap()).is_ok());
        let ordner = o.join("ordner.pdf");
        fs::create_dir_all(&ordner).unwrap();
        assert!(
            datei_pruefen(ordner.to_str().unwrap())
                .unwrap_err()
                .contains("Ordner")
        );
        assert!(
            datei_pruefen(o.join("fehlt.pdf").to_str().unwrap())
                .unwrap_err()
                .contains("gibt es nicht")
        );
        assert!(
            datei_pruefen("relativ.pdf")
                .unwrap_err()
                .contains("nicht vollständig")
        );

        let scan = schreiben(&o, "Scan.JPEG", b"jpg");
        let d = datei_pruefen(&scan).unwrap();
        assert_eq!(
            (d.name.as_str(), d.endung.as_str(), d.mime, d.art, d.groesse),
            ("Scan.JPEG", "jpeg", "image/jpeg", "beleg", 3)
        );
        let xml = schreiben(&o, "rechnung.xml", b"<x/>");
        let d = datei_pruefen(&xml).unwrap();
        assert_eq!((d.mime, d.art), ("application/xml", "erechnung_xml"));
        for (name, mime) in [
            ("a.pdf", "application/pdf"),
            ("a.png", "image/png"),
            ("a.jpg", "image/jpeg"),
            ("a.heic", "image/heic"),
            ("a.heif", "image/heif"),
            ("a.webp", "image/webp"),
            ("a.tif", "image/tiff"),
            ("a.TIFF", "image/tiff"),
        ] {
            let p = schreiben(&o, name, b"1");
            assert_eq!(datei_pruefen(&p).unwrap().mime, mime, "{name}");
        }
        let _ = fs::remove_dir_all(&o);
    }

    #[test]
    fn ablegen_einmal_schreibgeschuetzt_nie_ueberschreiben() {
        let o = testordner("ablegen");
        let ablage = o.join("ablage");
        let quelle = schreiben(&o, "Rechnung Bauhaus.PDF", b"%PDF-1.7 Inhalt");
        let d = datei_pruefen(&quelle).unwrap();
        let a = ablegen(&ablage, &d, 2026).unwrap();
        let s = sha(b"%PDF-1.7 Inhalt");
        assert_eq!(
            a,
            Abgelegt {
                pfad: format!("2026/{s}.pdf"),
                sha256: s.clone(),
                groesse: 15,
                neu: true
            }
        );
        let ziel = ablage.join(&a.pfad);
        assert_eq!(fs::read(&ziel).unwrap(), b"%PDF-1.7 Inhalt");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&ziel).unwrap().permissions().mode() & 0o777,
                0o444
            );
        }
        // gleicher Inhalt unter anderem Namen: nicht noch einmal
        let zweite = schreiben(&o, "kopie.pdf", b"%PDF-1.7 Inhalt");
        let b = ablegen(&ablage, &datei_pruefen(&zweite).unwrap(), 2026).unwrap();
        assert_eq!((b.pfad.as_str(), b.neu), (a.pfad.as_str(), false));
        // anderes Jahr: eigener Ordner
        let c = ablegen(&ablage, &d, 2027).unwrap();
        assert_eq!(c.pfad, format!("2027/{s}.pdf"));
        assert!(c.neu);

        // vorhandene Datei wird nie überschrieben (auch wenn sie, warum auch immer, anders aussieht)
        let fremd = schreiben(&o, "fremd.png", b"PNG neu");
        let s2 = sha(b"PNG neu");
        fs::create_dir_all(ablage.join("2026")).unwrap();
        fs::write(ablage.join(format!("2026/{s2}.png")), b"alt").unwrap();
        let e = ablegen(&ablage, &datei_pruefen(&fremd).unwrap(), 2026).unwrap();
        assert!(!e.neu);
        assert_eq!(fs::read(ablage.join(&e.pfad)).unwrap(), b"alt");

        // keine Zwischendateien übrig
        assert_eq!(
            dateien(&ablage),
            vec![
                format!("2026/{s2}.png"),
                format!("2026/{s}.pdf"),
                format!("2027/{s}.pdf")
            ]
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>()
        );
        let _ = fs::remove_dir_all(&o);
    }

    #[test]
    fn anlegen_mit_belegen() {
        let o = testordner("anlegen");
        let ablage = o.join("ablage");
        lauf(async {
            let mut c = test_db().await;
            let pdf = schreiben(&o, "bauhaus.pdf", b"PDF");
            let xml = schreiben(&o, "bauhaus.xml", b"<xml/>");
            // dieselbe Datei zweimal ⇒ einmal abgelegt
            let e = buchungen::anlegen(
                &mut c,
                &ablage,
                &ausgabe(vec![pdf.clone(), xml.clone(), pdf.clone()]),
                JETZT,
            )
            .await
            .unwrap();
            assert_eq!(e.belege_neu, 2);
            let zeilen: Vec<BelegZeile> =
                sqlx::query_as(
                    "SELECT buchung_id, pfad, originalname, mime, sha256, groesse, art, aufbewahren_bis, erstellt_am
                     FROM belege ORDER BY id",
                )
                .fetch_all(&mut c)
                .await
                .unwrap();
            assert_eq!(
                zeilen,
                vec![
                    (
                        e.id,
                        format!("2026/{}.pdf", sha(b"PDF")),
                        "bauhaus.pdf".into(),
                        "application/pdf".into(),
                        sha(b"PDF"),
                        3,
                        "beleg".into(),
                        "2034-12-31".into(),
                        JETZT.into()
                    ),
                    (
                        e.id,
                        format!("2026/{}.xml", sha(b"<xml/>")),
                        "bauhaus.xml".into(),
                        "application/xml".into(),
                        sha(b"<xml/>"),
                        6,
                        "erechnung_xml".into(),
                        "2034-12-31".into(),
                        JETZT.into()
                    ),
                ]
            );
            let p: Vec<(String, i64, String, Option<String>, String)> = sqlx::query_as(
                "SELECT tabelle, datensatz_id, aktion, alt_json, neu_json FROM protokoll WHERE tabelle = 'belege' ORDER BY id",
            )
            .fetch_all(&mut c)
            .await
            .unwrap();
            assert_eq!(p.len(), 2);
            assert_eq!((p[0].2.as_str(), p[0].3.is_none()), ("neu", true));
            let neu: Value = serde_json::from_str(&p[0].4).unwrap();
            assert_eq!(neu["buchung_id"], e.id);
            assert_eq!(neu["sha256"], sha(b"PDF"));
            assert_eq!(neu["aufbewahren_bis"], "2034-12-31");
            assert_eq!(neu["rechnung_id"], Value::Null);
            assert_eq!(dateien(&ablage).len(), 2);

            // gleicher Inhalt an einer zweiten Buchung ist erlaubt (Warnung macht das Frontend)
            let e2 = buchungen::anlegen(&mut c, &ablage, &ausgabe(vec![pdf.clone()]), JETZT)
                .await
                .unwrap();
            assert_eq!(e2.belege_neu, 1);
            assert_eq!(dateien(&ablage).len(), 2);

            // ungültige Datei: nichts angelegt, keine Nummer verbraucht
            let docx = schreiben(&o, "brief.docx", b"x");
            let f = buchungen::anlegen(&mut c, &ablage, &ausgabe(vec![pdf, docx]), JETZT)
                .await
                .unwrap_err();
            assert!(
                f.starts_with("„brief.docx“: Dateityp .docx wird nicht unterstützt."),
                "{f}"
            );
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM buchungen").await, 2);
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM belege").await, 3);
            let naechste = anzahl(
                &mut c,
                "SELECT naechste FROM nummernkreise WHERE id = 'buchung'",
            )
            .await;
            assert_eq!(naechste, 3);
        });
        let _ = fs::remove_dir_all(&o);
    }

    #[test]
    fn gescheiterte_transaktion_entfernt_neue_dateien() {
        let o = testordner("rueckrollen");
        let ablage = o.join("ablage");
        lauf(async {
            let mut c = test_db().await;
            let alt = schreiben(&o, "alt.pdf", b"ALT");
            let neu = schreiben(&o, "neu.pdf", b"NEU");
            buchungen::anlegen(&mut c, &ablage, &ausgabe(vec![alt.clone()]), JETZT)
                .await
                .unwrap();
            let alt_pfad = format!("2026/{}.pdf", sha(b"ALT"));
            assert_eq!(dateien(&ablage), vec![alt_pfad.clone()]);

            // Fehler NACH dem Ablegen der Dateien (beim Protokoll der Belegzeile)
            sqlx::query(
                "CREATE TEMP TRIGGER test_fehler BEFORE INSERT ON protokoll WHEN NEW.tabelle = 'belege'
                 BEGIN SELECT RAISE(ABORT, 'Testfehler'); END",
            )
            .execute(&mut c)
            .await
            .unwrap();
            let f = buchungen::anlegen(&mut c, &ablage, &ausgabe(vec![alt.clone(), neu]), JETZT)
                .await
                .unwrap_err();
            assert_eq!(f, "Testfehler");
            // die vorhandene (benutzte) Datei bleibt, die neue ist wieder weg
            assert_eq!(dateien(&ablage), vec![alt_pfad.clone()]);
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM buchungen").await, 1);
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM belege").await, 1);

            // Datei fehlte und wurde neu abgelegt, aber eine alte Zeile verweist darauf: bleibt
            fs::remove_file(ablage.join(&alt_pfad)).unwrap();
            let f = anhaengen(&mut c, &ablage, 1, &[alt], SPAETER)
                .await
                .unwrap_err();
            assert_eq!(f, "Testfehler");
            assert_eq!(dateien(&ablage), vec![alt_pfad]);
        });
        let _ = fs::remove_dir_all(&o);
    }

    #[test]
    fn datumsaenderung_verlaengert_frist_nie_kuerzer() {
        let o = testordner("frist");
        let ablage = o.join("ablage");
        lauf(async {
            let mut c = test_db().await;
            let pdf = schreiben(&o, "a.pdf", b"A");
            let e = buchungen::anlegen(&mut c, &ablage, &ausgabe(vec![pdf]), JETZT)
                .await
                .unwrap();
            let frist = async |c: &mut SqliteConnection| -> String {
                sqlx::query_scalar("SELECT aufbewahren_bis FROM belege")
                    .fetch_one(c)
                    .await
                    .unwrap()
            };
            let protokoll = async |c: &mut SqliteConnection| -> Vec<(String, String)> {
                sqlx::query_as(
                    "SELECT alt_json, neu_json FROM protokoll WHERE tabelle = 'belege' AND aktion = 'geaendert' ORDER BY id",
                )
                .fetch_all(c)
                .await
                .unwrap()
            };
            // ins Folgejahr: länger
            let spaeter = BuchungEingabe {
                zahlungsdatum: "2027-01-05".into(),
                ..ausgabe(vec![])
            };
            let r = buchungen::aendern(&mut c, &ablage, e.id, &spaeter, SPAETER)
                .await
                .unwrap();
            assert_eq!(r.belege_neu, 0);
            assert_eq!(frist(&mut c).await, "2035-12-31");
            let p = protokoll(&mut c).await;
            assert_eq!(
                p,
                vec![(
                    r#"{"aufbewahren_bis":"2034-12-31"}"#.into(),
                    r#"{"aufbewahren_bis":"2035-12-31"}"#.into()
                )]
            );
            // zurück: nie kürzer, kein weiterer Eintrag
            buchungen::aendern(&mut c, &ablage, e.id, &ausgabe(vec![]), SPAETER)
                .await
                .unwrap();
            assert_eq!(frist(&mut c).await, "2035-12-31");
            assert_eq!(protokoll(&mut c).await.len(), 1);
            // neue Belege beim Ändern: Frist aus dem aktuellen Zahlungsdatum
            let b = schreiben(&o, "b.png", b"B");
            let r = buchungen::aendern(&mut c, &ablage, e.id, &ausgabe(vec![b]), SPAETER)
                .await
                .unwrap();
            assert_eq!(r.belege_neu, 1);
            let fristen: Vec<String> =
                sqlx::query_scalar("SELECT aufbewahren_bis FROM belege ORDER BY id")
                    .fetch_all(&mut c)
                    .await
                    .unwrap();
            assert_eq!(fristen, vec!["2035-12-31", "2034-12-31"]);
        });
        let _ = fs::remove_dir_all(&o);
    }

    #[test]
    fn anhaengen_festgeschrieben_ja_storno_nein() {
        let o = testordner("anhaengen");
        let ablage = o.join("ablage");
        lauf(async {
            let mut c = test_db().await;
            let alt = buchungen::anlegen(
                &mut c,
                &ablage,
                &BuchungEingabe {
                    zahlungsdatum: "2025-12-20".into(),
                    ..ausgabe(vec![])
                },
                JETZT,
            )
            .await
            .unwrap();
            let offen = buchungen::anlegen(&mut c, &ablage, &ausgabe(vec![]), JETZT)
                .await
                .unwrap();
            let storno = buchungen::stornieren(&mut c, offen.id, "2026-10-15", JETZT)
                .await
                .unwrap();
            sqlx::query("INSERT INTO festschreibungen (bis_datum, am) VALUES ('2025-12-31', ?)")
                .bind(JETZT)
                .execute(&mut c)
                .await
                .unwrap();
            let pdf = schreiben(&o, "nachgereicht.pdf", b"N");
            let ids = anhaengen(&mut c, &ablage, alt.id, std::slice::from_ref(&pdf), SPAETER)
                .await
                .unwrap();
            assert_eq!(ids.len(), 1);
            let (pfad, bis): (String, String) =
                sqlx::query_as("SELECT pfad, aufbewahren_bis FROM belege WHERE id = ?")
                    .bind(ids[0])
                    .fetch_one(&mut c)
                    .await
                    .unwrap();
            assert_eq!(pfad, format!("2025/{}.pdf", sha(b"N")));
            assert_eq!(bis, "2033-12-31");
            assert_eq!(
                anzahl(
                    &mut c,
                    "SELECT count(*) FROM protokoll WHERE tabelle = 'belege' AND aktion = 'neu'"
                )
                .await,
                1
            );
            // stornierte Originalbuchung: erlaubt; Gegenbuchung: nein
            assert_eq!(
                anhaengen(
                    &mut c,
                    &ablage,
                    offen.id,
                    std::slice::from_ref(&pdf),
                    SPAETER
                )
                .await
                .unwrap()
                .len(),
                1
            );
            assert_eq!(
                anhaengen(
                    &mut c,
                    &ablage,
                    storno.id,
                    std::slice::from_ref(&pdf),
                    SPAETER
                )
                .await
                .unwrap_err(),
                "An eine Stornobuchung kann kein Beleg angehängt werden."
            );
            assert_eq!(
                anhaengen(&mut c, &ablage, 999, &[pdf], SPAETER)
                    .await
                    .unwrap_err(),
                "Die Buchung gibt es nicht."
            );
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM belege").await, 2);
        });
        let _ = fs::remove_dir_all(&o);
    }

    #[test]
    fn pruefen_findet_dubletten() {
        let o = testordner("dubletten");
        let ablage = o.join("ablage");
        lauf(async {
            let mut c = test_db().await;
            let a = schreiben(&o, "a.pdf", b"GLEICH");
            let e1 = buchungen::anlegen(&mut c, &ablage, &ausgabe(vec![a.clone()]), JETZT)
                .await
                .unwrap();
            let e2 = buchungen::anlegen(&mut c, &ablage, &ausgabe(vec![a.clone()]), JETZT)
                .await
                .unwrap();
            buchungen::stornieren(&mut c, e2.id, "2026-10-15", JETZT)
                .await
                .unwrap();
            let kopie = schreiben(&o, "Kopie von a.pdf", b"GLEICH");
            let anders = schreiben(&o, "b.pdf", b"ANDERS");
            let docx = schreiben(&o, "c.docx", b"DOC");
            let fehlt = o.join("weg.pdf").to_string_lossy().into_owned();
            let liste = pruefen(&mut c, &[kopie.clone(), anders, docx, fehlt.clone()])
                .await
                .unwrap();
            assert_eq!(liste.len(), 4);
            assert_eq!(
                liste[0],
                Pruefung {
                    pfad: kopie,
                    name: "Kopie von a.pdf".into(),
                    groesse: 6,
                    mime: "application/pdf".into(),
                    sha256: Some(sha(b"GLEICH")),
                    fehler: None,
                    doppelt: vec![
                        Doppelt {
                            buchung_id: e1.id,
                            nummer: "2026-0001".into(),
                            zahlungsdatum: "2026-10-14".into(),
                            storniert: false
                        },
                        Doppelt {
                            buchung_id: e2.id,
                            nummer: "2026-0002".into(),
                            zahlungsdatum: "2026-10-14".into(),
                            storniert: true
                        },
                    ]
                }
            );
            assert!(liste[1].doppelt.is_empty() && liste[1].fehler.is_none());
            assert_eq!(
                (
                    liste[2].sha256.clone(),
                    liste[2].groesse,
                    liste[2].mime.as_str()
                ),
                (None, 3, "")
            );
            assert!(
                liste[2]
                    .fehler
                    .as_deref()
                    .unwrap()
                    .starts_with("Dateityp .docx")
            );
            assert_eq!(
                (liste[3].pfad.as_str(), liste[3].name.as_str()),
                (fehlt.as_str(), "weg.pdf")
            );
            assert!(liste[3].fehler.is_some());
            // nur gelesen: nichts kopiert, nichts geschrieben
            assert_eq!(dateien(&ablage).len(), 1);
            assert_eq!(anzahl(&mut c, "SELECT count(*) FROM belege").await, 2);

            let json = serde_json::to_value(&liste[0]).unwrap();
            let schluessel: Vec<&String> = json.as_object().unwrap().keys().collect();
            assert_eq!(
                schluessel,
                vec![
                    "doppelt", "fehler", "groesse", "mime", "name", "pfad", "sha256"
                ]
            );
            assert_eq!(
                json["doppelt"][1],
                serde_json::json!({"buchung_id": e2.id, "nummer": "2026-0002", "zahlungsdatum": "2026-10-14", "storniert": true})
            );
        });
        let _ = fs::remove_dir_all(&o);
    }

    #[test]
    fn pfad_ausserhalb_der_ablage_wird_verweigert() {
        let o = testordner("ausserhalb");
        let ablage = o.join("ablage");
        lauf(async {
            let mut c = test_db().await;
            let a = schreiben(&o, "a.pdf", b"A");
            let e = buchungen::anlegen(&mut c, &ablage, &ausgabe(vec![a]), JETZT)
                .await
                .unwrap();
            let id: i64 = sqlx::query_scalar("SELECT id FROM belege WHERE buchung_id = ?")
                .bind(e.id)
                .fetch_one(&mut c)
                .await
                .unwrap();
            let voll = beleg_datei(&mut c, &ablage, id).await.unwrap();
            assert!(voll.is_absolute() && voll.is_file());
            assert_eq!(
                beleg_datei(&mut c, &ablage, 999).await.unwrap_err(),
                "Den Beleg gibt es nicht."
            );
        });
        let geheim = schreiben(&o, "geheim.pdf", b"G");
        let ausserhalb = "Der Beleg liegt außerhalb der Belegablage und wird nicht geöffnet.";
        for pfad in [
            "../geheim.pdf",
            geheim.as_str(),
            "2026/../../geheim.pdf",
            "./x.pdf",
            "",
        ] {
            assert_eq!(
                sicherer_pfad(&ablage, pfad, "x.pdf").unwrap_err(),
                ausserhalb,
                "{pfad}"
            );
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&geheim, ablage.join("2026/link.pdf")).unwrap();
            assert_eq!(
                sicherer_pfad(&ablage, "2026/link.pdf", "x.pdf").unwrap_err(),
                ausserhalb
            );
        }
        assert_eq!(
            sicherer_pfad(&ablage, "2026/fehlt.pdf", "Rechnung.pdf").unwrap_err(),
            "Die Datei des Belegs fehlt: Rechnung.pdf"
        );
        assert_eq!(
            sicherer_pfad(&o.join("gibt-es-nicht"), "2026/a.pdf", "a.pdf").unwrap_err(),
            "Die Datei des Belegs fehlt: a.pdf"
        );
        let _ = fs::remove_dir_all(&o);
    }
}
