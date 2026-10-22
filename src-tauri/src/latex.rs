//! PDF-Satz mit Tectonic (ANLEITUNG §7.1–7.3): `compile_latex` und `pdf_oeffnen`.
//!
//! - Jeder Auftrag bekommt einen frischen Temp-Ordner (nur für den Nutzer lesbar) mit `main.tex`, `daten.tex` und
//!   optionalen Bildern. Dateinamen der Bilder sind streng geprüft (nur `[A-Za-z0-9_-]` und `.png/.jpg/.jpeg/.pdf`),
//!   damit nichts außerhalb des Ordners landet. Der Ordner wird danach immer gelöscht.
//! - Aufruf ohne Shell: `<tectonic> -X compile main.tex --untrusted --keep-logs` im Temp-Ordner, zusätzlich
//!   `TECTONIC_UNTRUSTED_MODE=1`. Zeitlimit 60 s; hängt Tectonic, wird es beendet.
//! - Ein neuer Auftrag bricht den laufenden ab (Live-Vorschau beim Tippen): Ticket-Zähler + Sperre (`Warteschlange`).
//! - Erfolg: PDF-Bytes roh an das Frontend (`ArrayBuffer`); mit `ablage` zusätzlich nach `<App-Cache>/pdf/<name>`,
//!   von wo `pdf_oeffnen` es in der Standard-App zeigt. Fehler: Zeile + Meldung aus Ausgabe und `main.log`.
//! - Tectonic suchen wie in den Einstellungen: `tectonic::tectonic_finden` (eine Stelle für beides).

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_sql::DbInstances;

use crate::tectonic::{eingestellter_pfad, tectonic_finden};

/// Zeitlimit für einen Satzlauf (der allererste Lauf lädt Pakete, §7.3).
pub const ZEITLIMIT: Duration = Duration::from_secs(60);
const MAX_TEX: usize = 2 * 1024 * 1024;
const MAX_ASSET: usize = 10 * 1024 * 1024;
const MAX_ASSETS: usize = 16;
const MAX_FEHLER: usize = 20;
const MAX_LOG: usize = 20_000;
const ENDUNGEN: &[&str] = &["png", "jpg", "jpeg", "pdf"];

/* ---------- Auftrag und Ergebnis ---------- */

#[derive(Debug, Clone, Deserialize)]
pub struct Asset {
    pub name: String,
    pub daten: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Auftrag {
    pub main: String,
    pub daten: String,
    #[serde(default)]
    pub assets: Vec<Asset>,
    /// Dateiname im PDF-Cache (z. B. `Kladdy-Testbeleg-Rechnung.pdf`), None = nur Bytes zurück
    #[serde(default)]
    pub ablage: Option<String>,
}

/// Ein Fehler aus Tectonic-Ausgabe oder `main.log`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LogFehler {
    pub datei: Option<String>,
    pub zeile: Option<u32>,
    pub meldung: String,
    /// Quelltext-Ausschnitt aus dem Log (`l.12 \foo`)
    pub kontext: Option<String>,
}

/// Fehlerobjekt für das Frontend (src/lib/latex/kompilieren.ts `KompilierFehlerDaten`).
#[derive(Debug, Clone, Serialize)]
pub struct KompilierFehler {
    pub meldung: String,
    pub fehler: Vec<LogFehler>,
    /// Durch einen neueren Auftrag ersetzt (kein echter Fehler, Frontend ignoriert ihn)
    pub abgebrochen: bool,
    /// Ende des Protokolls zum Nachlesen
    pub log: String,
}

impl KompilierFehler {
    fn einfach(meldung: impl Into<String>) -> Self {
        Self {
            meldung: meldung.into(),
            fehler: Vec::new(),
            abgebrochen: false,
            log: String::new(),
        }
    }
    fn abgebrochen() -> Self {
        Self {
            meldung: "Abgebrochen: ein neuerer Satzauftrag läuft.".into(),
            fehler: Vec::new(),
            abgebrochen: true,
            log: String::new(),
        }
    }
}

/* ---------- Namen prüfen ---------- */

fn name_zeichen_ok(stamm: &str) -> bool {
    let mut z = stamm.chars();
    z.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && z.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Name eines Bildes im Temp-Ordner: `[A-Za-z0-9][A-Za-z0-9_-]*` + `.png/.jpg/.jpeg/.pdf`, höchstens 64 Zeichen,
/// nicht `main`/`daten` (würde `main.pdf` überschreiben). Kein `/`, kein `..`, keine Steuerzeichen.
pub fn asset_name_pruefen(name: &str) -> Result<(), String> {
    let fehler = || format!("Ungültiger Dateiname „{name}“ für den PDF-Satz.");
    if name.is_empty() || name.len() > 64 {
        return Err(fehler());
    }
    let (stamm, endung) = name.split_once('.').ok_or_else(fehler)?;
    if !name_zeichen_ok(stamm) || !ENDUNGEN.contains(&endung) {
        return Err(fehler());
    }
    if stamm.eq_ignore_ascii_case("main") || stamm.eq_ignore_ascii_case("daten") {
        return Err(fehler());
    }
    Ok(())
}

/// Name im PDF-Cache: wie oben, Endung `.pdf`, höchstens 100 Zeichen.
pub fn ablage_name_pruefen(name: &str) -> Result<(), String> {
    let fehler = || format!("Ungültiger PDF-Name „{name}“.");
    if name.is_empty() || name.len() > 100 {
        return Err(fehler());
    }
    match name.split_once('.') {
        Some((stamm, "pdf")) if name_zeichen_ok(stamm) => Ok(()),
        _ => Err(fehler()),
    }
}

/* ---------- Temp-Ordner ---------- */

/// Temp-Ordner, der beim Verlassen gelöscht wird (auch bei Fehlern und Abbruch).
struct TempOrdner(PathBuf);

impl TempOrdner {
    fn neu(basis: &Path, ticket: u64) -> Result<Self, String> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let pfad = basis.join(format!(
            "kladdy-latex-{}-{ticket}-{nanos}",
            std::process::id()
        ));
        let mut b = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            b.mode(0o700);
        }
        // create statt create_all: ein schon vorhandener Ordner ist ein Fehler, nie wiederverwenden
        b.create(&pfad)
            .map_err(|e| format!("Temp-Ordner für den PDF-Satz: {e}"))?;
        Ok(Self(pfad))
    }
}

impl Drop for TempOrdner {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Prüft den Auftrag und schreibt alle Dateien in `ordner`.
fn vorbereiten(ordner: &Path, auftrag: &Auftrag) -> Result<(), String> {
    if auftrag.main.len() > MAX_TEX || auftrag.daten.len() > MAX_TEX {
        return Err("Der Beleg ist zu groß für den PDF-Satz.".into());
    }
    if auftrag.assets.len() > MAX_ASSETS {
        return Err("Zu viele Bilder für den PDF-Satz.".into());
    }
    let mut namen: Vec<&str> = Vec::new();
    for a in &auftrag.assets {
        asset_name_pruefen(&a.name)?;
        if namen.iter().any(|n| n.eq_ignore_ascii_case(&a.name)) {
            return Err(format!("Datei „{}“ ist doppelt.", a.name));
        }
        if a.daten.len() > MAX_ASSET {
            return Err(format!("Bild „{}“ ist größer als 10 MB.", a.name));
        }
        namen.push(&a.name);
    }
    let schreiben = |name: &str, daten: &[u8]| {
        std::fs::write(ordner.join(name), daten).map_err(|e| format!("{name} schreiben: {e}"))
    };
    schreiben("main.tex", auftrag.main.as_bytes())?;
    schreiben("daten.tex", auftrag.daten.as_bytes())?;
    for a in &auftrag.assets {
        schreiben(&a.name, &a.daten)?;
    }
    Ok(())
}

/* ---------- Log auswerten ---------- */

fn vergleichbar(m: &str) -> String {
    m.trim().trim_end_matches('.').to_lowercase()
}

/// `main.tex:12: Undefined control sequence` (auch mit Pfad davor) ⇒ (Datei, Zeile, Meldung).
fn datei_zeile(text: &str) -> Option<(String, u32, String)> {
    let pos = text.find(".tex:")?;
    let datei_teil = text[..pos + 4].rsplit(char::is_whitespace).next()?;
    let datei = Path::new(datei_teil)
        .file_name()?
        .to_string_lossy()
        .into_owned();
    let rest = &text[pos + 5..];
    let ende = rest.find(':')?;
    let zeile = rest[..ende].trim().parse::<u32>().ok()?;
    Some((datei, zeile, rest[ende + 1..].trim().to_string()))
}

/// Ausgabe von Tectonic und `main.log` ⇒ Fehlerliste (dieselben Fehler aus beiden Quellen werden zusammengeführt).
pub fn log_auswerten(text: &str) -> Vec<LogFehler> {
    let zeilen: Vec<&str> = text.lines().collect();
    let mut out: Vec<LogFehler> = Vec::new();
    let mut aufnehmen = |neu: LogFehler| {
        if neu.meldung.is_empty() {
            return;
        }
        let v = vergleichbar(&neu.meldung);
        if let Some(alt) = out.iter_mut().find(|a| {
            vergleichbar(&a.meldung) == v
                && (a.zeile == neu.zeile || a.zeile.is_none() || neu.zeile.is_none())
        }) {
            alt.datei = alt.datei.take().or(neu.datei);
            alt.zeile = alt.zeile.or(neu.zeile);
            alt.kontext = alt.kontext.take().or(neu.kontext);
            return;
        }
        if out.len() < MAX_FEHLER {
            out.push(neu);
        }
    };
    for (i, roh) in zeilen.iter().enumerate() {
        let z = roh.trim_end();
        if let Some(m) = z.strip_prefix("! ") {
            // TeX-Fehler: „! Meldung“, einige Zeilen später „l.12 <Quelltext>“
            let mut zeile = None;
            let mut kontext = None;
            for folge in zeilen.iter().skip(i + 1).take(12) {
                if folge.starts_with("! ") {
                    break;
                }
                if let Some(r) = folge.strip_prefix("l.") {
                    let ziffern: String = r.chars().take_while(char::is_ascii_digit).collect();
                    if let Ok(n) = ziffern.parse::<u32>() {
                        zeile = Some(n);
                        let k = r[ziffern.len()..].trim();
                        kontext = (!k.is_empty()).then(|| k.to_string());
                        break;
                    }
                }
            }
            aufnehmen(LogFehler {
                datei: None,
                zeile,
                meldung: m.trim().to_string(),
                kontext,
            });
            continue;
        }
        // Warnungen (Overfull \hbox …) kommen bei jedem Lauf und sind kein Grund für den Abbruch
        if z.starts_with("warning:") {
            continue;
        }
        let ohne = z.strip_prefix("error: ").unwrap_or(z);
        if let Some((datei, zeile, meldung)) = datei_zeile(ohne) {
            aufnehmen(LogFehler {
                datei: Some(datei),
                zeile: Some(zeile),
                meldung,
                kontext: None,
            });
            continue;
        }
        if let Some(m) = z.strip_prefix("error: ") {
            let m = m.trim();
            // Sammelmeldungen ohne eigenen Inhalt
            if m.starts_with("halted on potentially-recoverable error")
                || m.starts_with("the TeX engine had an error")
            {
                continue;
            }
            aufnehmen(LogFehler {
                datei: None,
                zeile: None,
                meldung: m.to_string(),
                kontext: None,
            });
        }
    }
    out
}

fn log_ende(text: &str) -> String {
    if text.len() <= MAX_LOG {
        return text.to_string();
    }
    let mut start = text.len() - MAX_LOG;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    format!("…\n{}", &text[start..])
}

/* ---------- Ausführen ---------- */

/// Nur der jüngste Auftrag darf laufen: jeder Auftrag zieht ein Ticket; ein älterer, laufender Auftrag sieht das
/// neuere Ticket und beendet Tectonic. Die Sperre sorgt dafür, dass nie zwei Läufe gleichzeitig arbeiten.
pub struct Warteschlange {
    zaehler: AtomicU64,
    sperre: Mutex<()>,
}

impl Warteschlange {
    pub const fn new() -> Self {
        Self {
            zaehler: AtomicU64::new(0),
            sperre: Mutex::new(()),
        }
    }
    fn ticket(&self) -> u64 {
        self.zaehler.fetch_add(1, Ordering::SeqCst) + 1
    }
    fn aktuell(&self, ticket: u64) -> bool {
        self.zaehler.load(Ordering::SeqCst) == ticket
    }
}

static WARTESCHLANGE: Warteschlange = Warteschlange::new();

fn lesen(quelle: Option<Box<dyn Read + Send>>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut text = Vec::new();
        if let Some(mut q) = quelle {
            let _ = q.read_to_end(&mut text);
        }
        String::from_utf8_lossy(&text).into_owned()
    })
}

/// Ein Satzlauf (testbar ohne Tauri): `programm` = Tectonic, `basis` = Ort für den Temp-Ordner.
pub fn ausfuehren(
    ws: &Warteschlange,
    programm: &Path,
    auftrag: &Auftrag,
    zeitlimit: Duration,
    basis: &Path,
) -> Result<Vec<u8>, KompilierFehler> {
    let ticket = ws.ticket();
    let _sperre = ws.sperre.lock().unwrap_or_else(|e| e.into_inner());
    if !ws.aktuell(ticket) {
        return Err(KompilierFehler::abgebrochen());
    }
    let ordner = TempOrdner::neu(basis, ticket).map_err(KompilierFehler::einfach)?;
    vorbereiten(&ordner.0, auftrag).map_err(KompilierFehler::einfach)?;

    let mut kind = Command::new(programm)
        .args(["-X", "compile", "main.tex", "--untrusted", "--keep-logs"])
        .current_dir(&ordner.0)
        .env("TECTONIC_UNTRUSTED_MODE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            KompilierFehler::einfach(format!(
                "{} lässt sich nicht starten: {e}",
                programm.display()
            ))
        })?;
    let aus = lesen(
        kind.stdout
            .take()
            .map(|s| Box::new(s) as Box<dyn Read + Send>),
    );
    let err = lesen(
        kind.stderr
            .take()
            .map(|s| Box::new(s) as Box<dyn Read + Send>),
    );
    let start = Instant::now();
    let status = loop {
        match kind.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                let abbruch = !ws.aktuell(ticket);
                if abbruch || start.elapsed() >= zeitlimit {
                    let _ = kind.kill();
                    let _ = kind.wait();
                    // Lese-Threads nicht abwarten: hält ein Unterprozess die Ausgabe offen, käme join nie zurück
                    return Err(if abbruch {
                        KompilierFehler::abgebrochen()
                    } else {
                        KompilierFehler::einfach(format!(
                            "Tectonic ist nach {} Sekunden nicht fertig geworden und wurde beendet. Beim ersten \
                             Mal lädt Tectonic die TeX-Pakete aus dem Netz, das kann dauern. Bitte noch einmal \
                             versuchen (bereits Geladenes bleibt erhalten).",
                            zeitlimit.as_secs()
                        ))
                    });
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(e) => return Err(KompilierFehler::einfach(format!("Tectonic: {e}"))),
        }
    };
    let aus = aus.join().unwrap_or_default();
    let err = err.join().unwrap_or_default();
    let pdf = ordner.0.join("main.pdf");
    if status.success()
        && let Ok(bytes) = std::fs::read(&pdf)
        && !bytes.is_empty()
    {
        return Ok(bytes);
    }
    let log_datei = std::fs::read(ordner.0.join("main.log"))
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or_default();
    let alles = format!("{err}\n{aus}\n{log_datei}");
    let fehler = log_auswerten(&alles);
    let meldung = match fehler.len() {
        0 => {
            let erste = err
                .lines()
                .chain(aus.lines())
                .map(str::trim)
                .find(|z| !z.is_empty())
                .map(|z| format!(": {z}"))
                .unwrap_or_default();
            if status.success() {
                format!("Tectonic hat kein PDF erzeugt{erste}")
            } else {
                format!("Tectonic ist mit einem Fehler beendet ({status}){erste}")
            }
        }
        1 => "Der PDF-Satz ist an einem Fehler gescheitert.".to_string(),
        n => format!("Der PDF-Satz ist an {n} Fehlern gescheitert."),
    };
    Err(KompilierFehler {
        meldung,
        fehler,
        abgebrochen: false,
        log: log_ende(&format!("{err}\n{aus}")),
    })
}

/* ---------- Commands ---------- */

fn pdf_ordner(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Cache-Ordner nicht gefunden: {e}"))?
        .join("pdf"))
}

/// PDF atomar in den Cache legen (erst Temp-Datei, dann umbenennen).
fn ablegen(ordner: &Path, name: &str, pdf: &[u8]) -> Result<(), String> {
    ablage_name_pruefen(name)?;
    std::fs::create_dir_all(ordner).map_err(|e| format!("PDF-Ordner anlegen: {e}"))?;
    let tmp = ordner.join(format!(".{name}.tmp"));
    std::fs::write(&tmp, pdf).map_err(|e| format!("PDF speichern: {e}"))?;
    std::fs::rename(&tmp, ordner.join(name)).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("PDF speichern: {e}")
    })
}

/// Frontend: `invoke('compile_latex', { auftrag })` ⇒ PDF als ArrayBuffer, Fehler als `KompilierFehler`.
#[tauri::command]
pub async fn compile_latex(
    app: tauri::AppHandle,
    instanzen: tauri::State<'_, DbInstances>,
    auftrag: Auftrag,
) -> Result<tauri::ipc::Response, KompilierFehler> {
    if let Some(name) = &auftrag.ablage {
        ablage_name_pruefen(name).map_err(KompilierFehler::einfach)?;
    }
    let eingestellt = eingestellter_pfad(&instanzen)
        .await
        .map_err(KompilierFehler::einfach)?;
    let Some(fund) = tectonic_finden(eingestellt.as_deref()) else {
        return Err(KompilierFehler::einfach(
            "Tectonic wurde nicht gefunden. Im Terminal mit „brew install tectonic“ installieren oder in \
             Einstellungen › Daten den Pfad wählen.",
        ));
    };
    let ablage = match &auftrag.ablage {
        Some(name) => Some((
            pdf_ordner(&app).map_err(KompilierFehler::einfach)?,
            name.clone(),
        )),
        None => None,
    };
    let programm = PathBuf::from(fund.pfad);
    let pdf = tauri::async_runtime::spawn_blocking(move || {
        let pdf = ausfuehren(
            &WARTESCHLANGE,
            &programm,
            &auftrag,
            ZEITLIMIT,
            &std::env::temp_dir(),
        )?;
        if let Some((ordner, name)) = ablage {
            ablegen(&ordner, &name, &pdf).map_err(KompilierFehler::einfach)?;
        }
        Ok::<_, KompilierFehler>(pdf)
    })
    .await
    .map_err(|e| KompilierFehler::einfach(format!("PDF-Satz abgebrochen: {e}")))??;
    Ok(tauri::ipc::Response::new(pdf))
}

/// Frontend: `invoke('pdf_oeffnen', { name })`: ein mit `ablage` gespeichertes PDF in der Standard-App öffnen.
#[tauri::command]
pub fn pdf_oeffnen(app: tauri::AppHandle, name: String) -> Result<(), String> {
    ablage_name_pruefen(&name)?;
    let datei = pdf_ordner(&app)?.join(&name);
    if !datei.is_file() {
        return Err("Das PDF gibt es nicht mehr. Bitte neu erzeugen.".into());
    }
    let status = Command::new("/usr/bin/open")
        .arg(&datei)
        .status()
        .map_err(|e| format!("Das PDF konnte nicht geöffnet werden: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Das PDF konnte nicht geöffnet werden.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn testordner(name: &str) -> PathBuf {
        let p =
            std::env::temp_dir().join(format!("kladdy-test-{}-latex-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[cfg(unix)]
    fn programm(pfad: &Path, skript: &str) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::write(pfad, format!("#!/bin/sh\n{skript}\n")).unwrap();
        std::fs::set_permissions(pfad, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn auftrag(assets: Vec<Asset>) -> Auftrag {
        Auftrag {
            main: "\\documentclass{article}\\input{daten.tex}".into(),
            daten: "\\newcommand{\\Firma}{M\\\"uller \\& S\\\"ohne 100\\%}".into(),
            assets,
            ablage: None,
        }
    }

    fn asset(name: &str, n: usize) -> Asset {
        Asset {
            name: name.into(),
            daten: vec![1; n],
        }
    }

    /// Temp-Ordner unter `basis` (vom Satzlauf übrig geblieben?)
    fn reste(basis: &Path) -> usize {
        std::fs::read_dir(basis)
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with("kladdy-latex-")
            })
            .count()
    }

    #[test]
    fn asset_namen() {
        for gut in [
            "logo.png",
            "Logo_2-klein.jpg",
            "a.jpeg",
            "x.pdf",
            "signatur1.png",
        ] {
            assert_eq!(asset_name_pruefen(gut), Ok(()), "{gut}");
        }
        for schlecht in [
            "",
            "../logo.png",
            "a/b.png",
            "/etc/passwd.png",
            ".png",
            "-x.png",
            "_x.png",
            "logo",
            "logo.",
            "logo.PNG",
            "logo.svg",
            "x.tex",
            "main.pdf",
            "daten.png",
            "MAIN.png",
            "a..png",
            "a.png.png",
            "lögo.png",
            "a b.png",
            "a\0.png",
            "logo.png\n",
            &format!("{}.png", "a".repeat(61)),
        ] {
            assert!(asset_name_pruefen(schlecht).is_err(), "{schlecht:?}");
        }
    }

    #[test]
    fn ablage_namen() {
        assert_eq!(ablage_name_pruefen("Kladdy-Testbeleg-Rechnung.pdf"), Ok(()));
        for schlecht in [
            "",
            "../a.pdf",
            "a/b.pdf",
            "a.txt",
            "a b.pdf",
            ".pdf",
            "a.pdf.pdf",
            "a",
        ] {
            assert!(ablage_name_pruefen(schlecht).is_err(), "{schlecht:?}");
        }
    }

    #[test]
    fn vorbereiten_schreibt_und_prueft() {
        let o = testordner("vorbereiten");
        vorbereiten(&o, &auftrag(vec![asset("logo.png", 3)])).unwrap();
        assert!(o.join("main.tex").is_file());
        assert!(
            std::fs::read_to_string(o.join("daten.tex"))
                .unwrap()
                .contains("100\\%")
        );
        assert_eq!(std::fs::read(o.join("logo.png")).unwrap(), vec![1, 1, 1]);

        let o2 = testordner("vorbereiten-fehler");
        let doppelt = vorbereiten(&o2, &auftrag(vec![asset("a.png", 1), asset("A.png", 1)]));
        assert!(doppelt.unwrap_err().contains("doppelt"));
        let gross = vorbereiten(&o2, &auftrag(vec![asset("a.png", MAX_ASSET + 1)]));
        assert!(gross.unwrap_err().contains("10 MB"));
        let boese = vorbereiten(&o2, &auftrag(vec![asset("../../boese.png", 1)]));
        assert!(boese.unwrap_err().contains("Ungültiger Dateiname"));
        // Bei Fehlern wird nichts geschrieben
        assert_eq!(std::fs::read_dir(&o2).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(&o);
        let _ = std::fs::remove_dir_all(&o2);
    }

    #[test]
    fn log_tectonic_und_tex_zusammengefuehrt() {
        let log = "note: Running TeX ...\n\
                   error: main.tex:88: Undefined control sequence\n\
                   error: halted on potentially-recoverable error as specified\n\
                   ! Undefined control sequence.\n\
                   <recently read> \\Positionx \n\
                   \n\
                   l.88 \\Positionx\n\
                   \n\
                   ! LaTeX Error: File `gibtsnicht.sty' not found.\n\
                   \n\
                   Type X to quit or <RETURN> to proceed,\n\
                   l.7 \\usepackage{gibtsnicht}\n";
        assert_eq!(
            log_auswerten(log),
            vec![
                LogFehler {
                    datei: Some("main.tex".into()),
                    zeile: Some(88),
                    meldung: "Undefined control sequence".into(),
                    kontext: Some("\\Positionx".into()),
                },
                LogFehler {
                    datei: None,
                    zeile: Some(7),
                    meldung: "LaTeX Error: File `gibtsnicht.sty' not found.".into(),
                    kontext: Some("\\usepackage{gibtsnicht}".into()),
                },
            ]
        );
    }

    #[test]
    fn log_pfade_und_sonstige_fehler() {
        let log = "error: /tmp/kladdy-latex-1/daten.tex:3: Missing $ inserted\n\
                   error: failed to download bundle\n\
                   warning: main.tex:5: Overfull \\hbox\n\
                   ! Emergency stop.\n\
                   <*> main.tex\n";
        let f = log_auswerten(log);
        assert_eq!(f.len(), 3, "{f:?}");
        assert_eq!(
            (f[0].datei.as_deref(), f[0].zeile),
            (Some("daten.tex"), Some(3))
        );
        assert_eq!(f[0].meldung, "Missing $ inserted");
        assert_eq!((f[1].datei.as_deref(), f[1].zeile), (None, None));
        assert_eq!(f[1].meldung, "failed to download bundle");
        // Warnungen zählen nicht
        assert!(f.iter().all(|x| x.zeile != Some(5)));
        assert_eq!(f[2].meldung, "Emergency stop.");
        assert!(log_auswerten("").is_empty());
        assert!(log_auswerten("note: alles gut\n").is_empty());
    }

    #[test]
    fn log_ende_kuerzt_an_zeichengrenze() {
        let lang = "ä".repeat(MAX_LOG);
        let k = log_ende(&lang);
        assert!(k.starts_with('…'));
        assert!(k.len() <= MAX_LOG + 8);
        assert_eq!(log_ende("kurz"), "kurz");
    }

    #[test]
    #[cfg(unix)]
    fn satzlauf_erfolg_mit_untrusted() {
        let o = testordner("erfolg");
        let t = o.join("tectonic");
        // prüft Argumente, Umgebung und Dateien, „setzt“ dann main.tex als PDF
        programm(
            &t,
            "[ \"$1 $2 $3 $4 $5\" = \"-X compile main.tex --untrusted --keep-logs\" ] || exit 9\n\
             [ \"$#\" = 5 ] || exit 9\n\
             [ \"$TECTONIC_UNTRUSTED_MODE\" = 1 ] || exit 8\n\
             [ -f daten.tex ] && [ -f logo.png ] || exit 7\n\
             echo \"note: Writing main.pdf\"\n\
             cat main.tex daten.tex > main.pdf",
        );
        let ws = Warteschlange::new();
        let pdf = ausfuehren(
            &ws,
            &t,
            &auftrag(vec![asset("logo.png", 2)]),
            Duration::from_secs(5),
            &o,
        )
        .unwrap();
        assert!(String::from_utf8(pdf).unwrap().contains("100\\%"));
        assert_eq!(reste(&o), 0, "Temp-Ordner bleibt nicht liegen");
        let _ = std::fs::remove_dir_all(&o);
    }

    #[test]
    #[cfg(unix)]
    fn satzlauf_fehler_mit_zeilen() {
        let o = testordner("fehler");
        let t = o.join("tectonic");
        programm(
            &t,
            "echo \"error: main.tex:3: Undefined control sequence\" >&2\n\
             printf '! Undefined control sequence.\\nl.3 \\\\foo\\n' > main.log\n\
             exit 1",
        );
        let f = ausfuehren(
            &Warteschlange::new(),
            &t,
            &auftrag(vec![]),
            Duration::from_secs(5),
            &o,
        )
        .unwrap_err();
        assert!(!f.abgebrochen);
        assert_eq!(f.meldung, "Der PDF-Satz ist an einem Fehler gescheitert.");
        assert_eq!(
            f.fehler,
            vec![LogFehler {
                datei: Some("main.tex".into()),
                zeile: Some(3),
                meldung: "Undefined control sequence".into(),
                kontext: Some("\\foo".into()),
            }]
        );
        assert!(f.log.contains("Undefined control sequence"));

        // Exit 0, aber kein PDF
        programm(&t, "echo nichts");
        let f = ausfuehren(
            &Warteschlange::new(),
            &t,
            &auftrag(vec![]),
            Duration::from_secs(5),
            &o,
        )
        .unwrap_err();
        assert!(f.meldung.contains("kein PDF"), "{}", f.meldung);
        // Ungültiges Bild: Tectonic startet gar nicht
        let f = ausfuehren(
            &Warteschlange::new(),
            &t,
            &auftrag(vec![asset("../x.png", 1)]),
            Duration::from_secs(5),
            &o,
        )
        .unwrap_err();
        assert!(f.meldung.contains("Ungültiger Dateiname"));
        assert_eq!(reste(&o), 0);
        let _ = std::fs::remove_dir_all(&o);
    }

    #[test]
    #[cfg(unix)]
    fn satzlauf_zeitlimit() {
        let o = testordner("zeitlimit");
        let t = o.join("tectonic");
        programm(&t, "exec sleep 5");
        let start = Instant::now();
        let f = ausfuehren(
            &Warteschlange::new(),
            &t,
            &auftrag(vec![]),
            Duration::from_millis(200),
            &o,
        )
        .unwrap_err();
        assert!(f.meldung.contains("nicht fertig geworden"), "{}", f.meldung);
        assert!(!f.abgebrochen);
        assert!(start.elapsed() < Duration::from_secs(3));
        assert_eq!(reste(&o), 0);
        let _ = std::fs::remove_dir_all(&o);
    }

    #[test]
    #[cfg(unix)]
    fn neuer_auftrag_bricht_alten_ab() {
        let o = testordner("abbruch");
        let langsam = o.join("langsam");
        programm(&langsam, "exec sleep 5");
        let schnell = o.join("schnell");
        programm(&schnell, "printf '%%PDF' > main.pdf");
        let ws = Arc::new(Warteschlange::new());
        let start = Instant::now();
        let alt = {
            let (ws, langsam, o) = (ws.clone(), langsam.clone(), o.clone());
            std::thread::spawn(move || {
                ausfuehren(&ws, &langsam, &auftrag(vec![]), Duration::from_secs(10), &o)
            })
        };
        // warten, bis der alte Auftrag läuft
        while ws.zaehler.load(Ordering::SeqCst) == 0 {
            std::thread::sleep(Duration::from_millis(5));
        }
        std::thread::sleep(Duration::from_millis(150));
        let neu = ausfuehren(&ws, &schnell, &auftrag(vec![]), Duration::from_secs(5), &o);
        assert_eq!(neu.unwrap(), b"%PDF");
        let alt = alt.join().unwrap().unwrap_err();
        assert!(alt.abgebrochen);
        assert!(start.elapsed() < Duration::from_secs(3));
        assert_eq!(reste(&o), 0);
        let _ = std::fs::remove_dir_all(&o);
    }

    #[test]
    fn ablegen_atomar_und_geprueft() {
        let o = testordner("ablage");
        let ziel = o.join("pdf");
        ablegen(&ziel, "Kladdy-Test.pdf", b"%PDF-1").unwrap();
        assert_eq!(
            std::fs::read(ziel.join("Kladdy-Test.pdf")).unwrap(),
            b"%PDF-1"
        );
        ablegen(&ziel, "Kladdy-Test.pdf", b"%PDF-2").unwrap();
        assert_eq!(
            std::fs::read(ziel.join("Kladdy-Test.pdf")).unwrap(),
            b"%PDF-2"
        );
        assert!(ablegen(&ziel, "../boese.pdf", b"x").is_err());
        assert_eq!(std::fs::read_dir(&ziel).unwrap().count(), 1);
        let _ = std::fs::remove_dir_all(&o);
    }
}
