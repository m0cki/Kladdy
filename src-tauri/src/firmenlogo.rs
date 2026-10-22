//! Firmenlogo (ANLEITUNG §6.10 „Firmenlogo“, §9.7, §7.1 Assets).
//!
//! - Das Frontend verkleinert das gewählte Bild (PNG, JPG, SVG, WebP) per Canvas auf höchstens 720 × 240 px und
//!   schickt es als PNG. Hier wird es geprüft (PNG-Signatur, erster Block `IHDR` mit Breite und Höhe im Rahmen,
//!   `IEND` am Ende, höchstens 2 MB) und abgelegt: `<appDataDir>/assets/logo-<sha256>.png` (Debug-Builds
//!   `assets-dev/`, im Demo-Modus `assets-dev-demo/`, siehe src/demo.rs – wie die Belegablage in belege.rs).
//! - Gleicher Inhalt = gleicher Name: nie überschreiben, schreibgeschützt (Zwischendatei + harte Verknüpfung wie in
//!   belege.rs), nie löschen. Ausgestellte Belege merken sich den Dateinamen im Schnappschuss
//!   (`snapshot_json.dokument.logo`) und behalten so ihr Logo (GoBD). Welches Logo gerade gilt, steht in
//!   `einstellungen['firmenlogo']` (schreibt das Frontend samt Protokoll; leer = App-Symbol).
//! - Gelesen wird nur über den Dateinamen (`logo-<64 Hex-Zeichen>.png`), nie über einen Pfad, und nur, solange der
//!   Inhalt zur Prüfsumme im Namen passt.
//! - Die Quelldatei (Dialog oder Drop auf die Kachel) liest `firmenlogo_quelle_lesen` nur: Bilder bis 10 MB.
//!
//! Die Kernfunktionen nehmen den Ablageordner, damit die Tests ohne Tauri auskommen.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use tauri::Manager;

use crate::belege::{Fehler, kopieren_und_verknuepfen, sha256_lesen};

/// Unterordner im App-Verzeichnis. Debug-Builds legen getrennt ab (wie `belege::BELEGE_ORDNER`).
pub const ASSETS_ORDNER: &str = if cfg!(debug_assertions) {
    "assets-dev"
} else {
    "assets"
};

/// Größtes Logo nach dem Verkleinern (16 mm Logohöhe im Druck brauchen ~190 px).
pub const MAX_BREITE: u32 = 720;
pub const MAX_HOEHE: u32 = 240;
/// Größtes abgelegtes Logo (PNG) in Bytes.
const MAX_PNG: usize = 2 * 1024 * 1024;
/// Größte Quelldatei vor dem Verkleinern.
const MAX_QUELLE: u64 = 10 * 1024 * 1024;

const PNG_SIGNATUR: &[u8] = b"\x89PNG\r\n\x1a\n";
/// Erster Block: Länge 13, Typ IHDR (danach Breite und Höhe als u32, Big Endian).
const PNG_IHDR: &[u8] = b"\0\0\0\x0dIHDR";
/// Letzter Block: IEND ohne Inhalt samt fester Prüfsumme.
const PNG_IEND: &[u8] = b"\0\0\0\0IEND\xae\x42\x60\x82";

/// Endungen der Quelldateien (klein geschrieben).
const QUELLE_ENDUNGEN: &[&str] = &["png", "jpg", "jpeg", "svg", "webp"];
const ERLAUBT: &str = "Bitte ein Bild wählen (PNG, JPG, SVG oder WebP).";

/// Unterordner der aktiven Datenbank: im Demo-Modus (nur Debug) ein eigener, sonst `ASSETS_ORDNER`.
pub fn aktiver_ordner() -> &'static str {
    #[cfg(debug_assertions)]
    if crate::demo::aktiv() {
        return crate::demo::DEMO_ASSETS_ORDNER;
    }
    ASSETS_ORDNER
}

/// Ablageordner der Logos (der aktiven Datenbank).
pub fn assets_ordner<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join(aktiver_ordner()))
        .map_err(|e| format!("App-Verzeichnis nicht gefunden: {e}"))
}

/// Ganzzahl (Big Endian) ab `von`; die Länge hat der Aufrufer geprüft.
fn u32_be(daten: &[u8], von: usize) -> u32 {
    let mut z = 0u32;
    for b in &daten[von..von + 4] {
        z = (z << 8) | u32::from(*b);
    }
    z
}

/// Prüft das PNG aus dem Webview. Ergebnis: (Breite, Höhe) in Pixeln.
pub fn png_pruefen(daten: &[u8]) -> Result<(u32, u32), String> {
    let kaputt = || "Das Logo ist kein gültiges PNG.".to_string();
    if daten.len() > MAX_PNG {
        return Err("Das Logo ist zu groß (höchstens 2 MB).".into());
    }
    // Signatur (8), Blockkopf IHDR (8), Breite und Höhe (8), Rest von IHDR samt Prüfsumme (9) … IEND (12)
    if daten.len() < 45 || !daten.starts_with(PNG_SIGNATUR) || !daten.ends_with(PNG_IEND) {
        return Err(kaputt());
    }
    if !daten[8..].starts_with(PNG_IHDR) {
        return Err(kaputt());
    }
    let (breite, hoehe) = (u32_be(daten, 16), u32_be(daten, 20));
    if breite == 0 || hoehe == 0 {
        return Err(kaputt());
    }
    if breite > MAX_BREITE || hoehe > MAX_HOEHE {
        return Err(format!(
            "Das Logo ist mit {breite} × {hoehe} px größer als {MAX_BREITE} × {MAX_HOEHE} px."
        ));
    }
    Ok((breite, hoehe))
}

/// Dateiname eines Logos aus seiner Prüfsumme.
pub fn logo_name(sha256: &str) -> String {
    format!("logo-{sha256}.png")
}

fn ist_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Nur Namen wie von `logo_name` (`logo-` + 64 kleine Hex-Zeichen + `.png`): kein Pfad, kein anderer Ordner.
/// Ergebnis: die Prüfsumme aus dem Namen.
pub fn name_pruefen(name: &str) -> Result<&str, String> {
    let rest = name.strip_prefix("logo-").unwrap_or_default();
    let hex = rest.strip_suffix(".png").unwrap_or_default();
    if ist_hex(hex) {
        Ok(hex)
    } else {
        Err(format!("„{name}“ ist kein Firmenlogo."))
    }
}

/// Zähler für eindeutige Namen der Zwischendateien.
static ZWISCHEN: AtomicU64 = AtomicU64::new(0);

/// Ergebnis von `firmenlogo_ablegen`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Abgelegt {
    /// Dateiname in der Logo-Ablage (Wert für `einstellungen['firmenlogo']`)
    pub name: String,
    /// true, wenn die Datei in diesem Aufruf neu angelegt wurde
    pub neu: bool,
}

/// Prüft das PNG und legt es unter `<ordner>/logo-<sha256>.png` ab (siehe Modulkommentar). Gibt es die Datei schon,
/// bleibt sie, wie sie ist.
pub fn ablegen(ordner: &Path, daten: &[u8]) -> Result<Abgelegt, String> {
    png_pruefen(daten)?;
    let (sha256, _) =
        sha256_lesen(daten).map_err(|e| format!("Prüfsumme nicht berechenbar: {e}"))?;
    let name = logo_name(&sha256);
    let ziel = ordner.join(&name);
    // gleicher Name = gleicher Inhalt: nicht noch einmal schreiben, nie überschreiben
    if fs::symlink_metadata(&ziel).is_ok() {
        return Ok(Abgelegt { name, neu: false });
    }
    fs::create_dir_all(ordner).map_err(|e| format!("Logo-Ablage {}: {e}", ordner.display()))?;
    let zwischen = ordner.join(format!(
        ".{name}.{}-{}.tmp",
        std::process::id(),
        ZWISCHEN.fetch_add(1, Ordering::Relaxed)
    ));
    let gelinkt = kopieren_und_verknuepfen(daten, &zwischen, &ziel, &sha256);
    let _ = fs::remove_file(&zwischen);
    match gelinkt {
        Ok(()) => Ok(Abgelegt { name, neu: true }),
        // in der Zwischenzeit schon abgelegt: gleicher Inhalt, also gut so
        Err(Fehler::Vorhanden) => Ok(Abgelegt { name, neu: false }),
        Err(Fehler::Text(t)) => Err(t),
    }
}

/// Inhalt eines abgelegten Logos: nur über den Namen, nur gewöhnliche Dateien, Inhalt passt zur Prüfsumme.
pub fn lesen(ordner: &Path, name: &str) -> Result<Vec<u8>, String> {
    let hex = name_pruefen(name)?;
    let pfad = ordner.join(name);
    if !fs::symlink_metadata(&pfad).is_ok_and(|m| m.is_file()) {
        return Err(format!("Die Logo-Datei fehlt: {name}"));
    }
    let daten = fs::read(&pfad).map_err(|e| format!("Die Logo-Datei ist nicht lesbar: {e}"))?;
    let (sha256, _) =
        sha256_lesen(&daten[..]).map_err(|e| format!("Prüfsumme nicht berechenbar: {e}"))?;
    if sha256 != hex {
        return Err(format!("Die Logo-Datei {name} wurde verändert."));
    }
    Ok(daten)
}

fn endung(p: &Path) -> String {
    p.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// Quelldatei des Nutzers (Dialog oder Drop) zum Verkleinern im Webview: nur PNG, JPG, SVG und WebP bis 10 MB,
/// nur lesen.
pub fn quelle_lesen(pfad: &str) -> Result<Vec<u8>, String> {
    let quelle = Path::new(pfad);
    if !quelle.is_absolute() {
        return Err(format!("Der Pfad „{pfad}“ ist nicht vollständig."));
    }
    if !QUELLE_ENDUNGEN.contains(&endung(quelle).as_str()) {
        return Err(ERLAUBT.into());
    }
    let Ok(meta) = fs::metadata(quelle) else {
        return Err("Die Datei gibt es nicht (mehr).".into());
    };
    if !meta.is_file() {
        return Err(ERLAUBT.into());
    }
    if meta.len() == 0 {
        return Err("Die Datei ist leer.".into());
    }
    if meta.len() > MAX_QUELLE {
        return Err("Das Bild ist zu groß (höchstens 10 MB).".into());
    }
    fs::read(quelle).map_err(|e| format!("Die Datei ist nicht lesbar: {e}"))
}

/* ---------- Tauri-Commands (dünne Hüllen) ---------- */

/// Frontend: `invoke('firmenlogo_quelle_lesen', { pfad })` – Bytes des gewählten bzw. gezogenen Bildes
/// (kommen als ArrayBuffer an). Legt nichts ab.
#[tauri::command]
pub async fn firmenlogo_quelle_lesen(pfad: String) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(quelle_lesen(&pfad)?))
}

/// Frontend: `invoke('firmenlogo_ablegen', { png })` – das verkleinerte PNG ablegen. Antwort: Name und ob neu.
#[tauri::command]
pub async fn firmenlogo_ablegen(app: tauri::AppHandle, png: Vec<u8>) -> Result<Abgelegt, String> {
    ablegen(&assets_ordner(&app)?, &png)
}

/// Frontend: `invoke('firmenlogo_lesen', { name })` – Bytes eines abgelegten Logos (ArrayBuffer) für Seitenleiste,
/// Vorschau und PDF.
#[tauri::command]
pub async fn firmenlogo_lesen(
    app: tauri::AppHandle,
    name: String,
) -> Result<tauri::ipc::Response, String> {
    let daten = lesen(&assets_ordner(&app)?, &name)?;
    Ok(tauri::ipc::Response::new(daten))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Eigener leerer Ordner je Test (ohne tempfile-Crate).
    fn testordner(name: &str) -> PathBuf {
        let p =
            std::env::temp_dir().join(format!("kladdy-test-{}-logo-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    /// PNG-Gerüst: Signatur, IHDR mit Breite und Höhe, ein IDAT (Inhalt egal), IEND.
    fn png(breite: u32, hoehe: u32) -> Vec<u8> {
        let mut d = PNG_SIGNATUR.to_vec();
        d.extend_from_slice(PNG_IHDR);
        d.extend_from_slice(&breite.to_be_bytes());
        d.extend_from_slice(&hoehe.to_be_bytes());
        d.extend_from_slice(b"\x08\x06\0\0\0\x01\x02\x03\x04");
        d.extend_from_slice(b"\0\0\0\x04IDAT\x78\x9c\x03\0\x01\x02\x03\x04");
        d.extend_from_slice(PNG_IEND);
        d
    }

    fn sha(inhalt: &[u8]) -> String {
        sha256_lesen(inhalt).unwrap().0
    }

    #[test]
    fn dev_und_release_haben_verschiedene_ordner() {
        if cfg!(debug_assertions) {
            assert_eq!(ASSETS_ORDNER, "assets-dev");
        } else {
            assert_eq!(ASSETS_ORDNER, "assets");
        }
        #[cfg(debug_assertions)]
        {
            assert_ne!(crate::demo::DEMO_ASSETS_ORDNER, ASSETS_ORDNER);
            assert!(crate::demo::DEMO_ASSETS_ORDNER.contains("-dev-"));
        }
    }

    #[test]
    fn png_wird_geprueft() {
        assert_eq!(png_pruefen(&png(720, 240)), Ok((720, 240)));
        assert_eq!(png_pruefen(&png(1, 1)), Ok((1, 1)));
        let zu_breit = png_pruefen(&png(721, 10)).unwrap_err();
        assert!(zu_breit.contains("720 × 240"), "{zu_breit}");
        assert!(png_pruefen(&png(10, 241)).is_err());
        assert!(png_pruefen(&png(0, 10)).is_err());
        assert!(png_pruefen(&png(10, 0)).is_err());
        // falsche Signatur, abgeschnitten, kein IHDR zuerst, zu kurz, leer
        let mut falsch = png(10, 10);
        falsch[1] = b'X';
        assert!(png_pruefen(&falsch).is_err());
        let ganz = png(10, 10);
        assert!(png_pruefen(&ganz[..ganz.len() - 1]).is_err());
        let mut anders = png(10, 10);
        anders[12..16].copy_from_slice(b"tEXt");
        assert!(png_pruefen(&anders).is_err());
        assert!(png_pruefen(b"\x89PNG\r\n\x1a\n").is_err());
        assert!(png_pruefen(b"").is_err());
        // JPEG statt PNG
        assert!(png_pruefen(b"\xff\xd8\xff\xe0\0\x10JFIF").is_err());
        // zu groß: über 2 MB, sonst gültig
        let mut gross = png(10, 10);
        let ende = gross.split_off(33);
        gross.resize(MAX_PNG, 0);
        gross.extend_from_slice(&ende);
        assert!(png_pruefen(&gross).unwrap_err().contains("zu groß"));
    }

    #[test]
    fn nur_eigene_namen() {
        let s = sha(b"abc");
        let name = logo_name(&s);
        assert_eq!(name, format!("logo-{s}.png"));
        assert_eq!(name_pruefen(&name), Ok(s.as_str()));
        for falsch in [
            String::new(),
            "logo.png".to_string(),
            format!("../logo-{s}.png"),
            format!("logo-{s}.png/x"),
            format!("logo-{s}.PNG"),
            format!("logo-{}.png", s.to_uppercase()),
            format!("logo-{}.png", &s[1..]),
            format!("logo-{s}0.png"),
            format!("logo-{s}.png.png"),
            "/etc/passwd".to_string(),
        ] {
            assert!(name_pruefen(&falsch).is_err(), "{falsch}");
        }
    }

    #[test]
    fn ablegen_einmal_und_nie_ueberschreiben() {
        let ordner = testordner("ablegen").join(ASSETS_ORDNER);
        let a = png(120, 40);
        let erst = ablegen(&ordner, &a).unwrap();
        assert_eq!(erst.name, logo_name(&sha(&a)));
        assert!(erst.neu);
        let datei = ordner.join(&erst.name);
        assert_eq!(fs::read(&datei).unwrap(), a);
        assert!(fs::metadata(&datei).unwrap().permissions().readonly());
        // gleicher Inhalt: gleicher Name, nichts Neues
        let nochmal = ablegen(&ordner, &a).unwrap();
        assert_eq!(nochmal.name, erst.name);
        assert!(!nochmal.neu);
        // anderer Inhalt: eigener Name, das erste Logo bleibt
        let b = png(240, 80);
        let zweit = ablegen(&ordner, &b).unwrap();
        assert!(zweit.neu);
        assert_ne!(zweit.name, erst.name);
        assert_eq!(fs::read(&datei).unwrap(), a);
        // keine Zwischendateien übrig
        let mut namen: Vec<String> = fs::read_dir(&ordner)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        namen.sort();
        let mut erwartet = vec![erst.name.clone(), zweit.name.clone()];
        erwartet.sort();
        assert_eq!(namen, erwartet);
        // ungültiges PNG wird nicht abgelegt
        assert!(ablegen(&ordner, &png(800, 10)).is_err());
        assert_eq!(fs::read_dir(&ordner).unwrap().count(), 2);
        assert_eq!(lesen(&ordner, &erst.name).unwrap(), a);
        assert_eq!(lesen(&ordner, &zweit.name).unwrap(), b);
        let _ = fs::remove_dir_all(ordner.parent().unwrap());
    }

    #[test]
    fn lesen_prueft_name_und_inhalt() {
        let ordner = testordner("lesen");
        let a = png(10, 10);
        let name = logo_name(&sha(&a));
        assert!(lesen(&ordner, &name).unwrap_err().contains("fehlt"));
        assert!(lesen(&ordner, "../kladdy.db").is_err());
        // Inhalt passt nicht zum Namen
        fs::write(ordner.join(&name), png(11, 10)).unwrap();
        assert!(lesen(&ordner, &name).unwrap_err().contains("verändert"));
        fs::remove_file(ordner.join(&name)).unwrap();
        // Ordner mit dem Namen eines Logos
        fs::create_dir_all(ordner.join(&name)).unwrap();
        assert!(lesen(&ordner, &name).is_err());
        let _ = fs::remove_dir_all(&ordner);
    }

    #[test]
    fn quelle_nur_bilder_bis_10_mb() {
        let ordner = testordner("quelle");
        let schreiben = |name: &str, inhalt: &[u8]| {
            let p = ordner.join(name);
            fs::write(&p, inhalt).unwrap();
            p.to_string_lossy().into_owned()
        };
        for name in ["a.png", "b.JPG", "c.jpeg", "d.svg", "e.webp"] {
            assert_eq!(quelle_lesen(&schreiben(name, b"bild")).unwrap(), b"bild");
        }
        let pdf = schreiben("f.pdf", b"%PDF");
        assert_eq!(quelle_lesen(&pdf), Err(ERLAUBT.to_string()));
        let ohne = schreiben("ohne", b"x");
        assert_eq!(quelle_lesen(&ohne), Err(ERLAUBT.to_string()));
        let leer = quelle_lesen(&schreiben("leer.png", b"")).unwrap_err();
        assert!(leer.contains("leer"));
        let gross = vec![0u8; (MAX_QUELLE + 1) as usize];
        let zu_gross = quelle_lesen(&schreiben("gross.png", &gross)).unwrap_err();
        assert!(zu_gross.contains("10 MB"));
        assert!(quelle_lesen("relativ/logo.png").is_err());
        let fehlt = ordner.join("fehlt.png");
        assert!(quelle_lesen(&fehlt.to_string_lossy()).is_err());
        fs::create_dir_all(ordner.join("ordner.png")).unwrap();
        assert!(quelle_lesen(&ordner.join("ordner.png").to_string_lossy()).is_err());
        let _ = fs::remove_dir_all(&ordner);
    }
}
