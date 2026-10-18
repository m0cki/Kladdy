//! Tectonic finden und prüfen (ANLEITUNG §3.1 „Tectonic finden“, §6.10 Einstellungen › Daten).
//!
//! - Mac-Apps erben den `PATH` der Shell nicht. Reihenfolge: mitgeliefertes Sidecar (sobald gebündelt, §3.2),
//!   `/opt/homebrew/bin/tectonic`, `/usr/local/bin/tectonic`, sonst der Pfad aus den Einstellungen (`tectonic_pfad`).
//! - `tectonic_finden` ist die eine Stelle dafür; `compile_latex` (Phase 3) benutzt sie ebenso.
//! - Prüfen startet `<pfad> --version` direkt (keine Shell, keine Argumente vom Nutzer außer dem Pfad selbst) mit
//!   Zeitlimit; hängt das Programm, wird es beendet.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri_plugin_sql::DbInstances;

use crate::buchungen::verbindung;
use crate::datenbank::db_fehler;

/// Feste Orte von Homebrew (Apple Silicon, dann Intel).
pub const KANDIDATEN: &[&str] = &["/opt/homebrew/bin/tectonic", "/usr/local/bin/tectonic"];

/// Zeitlimit für `tectonic --version`.
const PRUEF_ZEIT: Duration = Duration::from_secs(10);

/// Woher der Pfad stammt (für die Anzeige in den Einstellungen).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Quelle {
    Mitgeliefert,
    Homebrew,
    Einstellung,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Fund {
    pub pfad: String,
    pub quelle: Quelle,
}

/// Prüft, ob `pfad` eine vorhandene, ausführbare Datei ist (Verknüpfungen werden aufgelöst, z. B. Homebrew).
/// Gibt eine deutsche Fehlermeldung zurück.
pub fn pfad_pruefen(pfad: &Path) -> Result<(), String> {
    if !pfad.is_absolute() {
        return Err("Bitte einen vollständigen Pfad angeben (beginnt mit /).".into());
    }
    let meta = std::fs::metadata(pfad).map_err(|_| format!("{} gibt es nicht.", pfad.display()))?;
    if !meta.is_file() {
        return Err(format!("{} ist keine Datei.", pfad.display()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o111 == 0 {
            return Err(format!(
                "{} ist kein ausführbares Programm.",
                pfad.display()
            ));
        }
    }
    Ok(())
}

/// Reine Suche (testbar): erstes brauchbares Programm in der Reihenfolge aus §3.1.
pub fn finden_in(
    mitgeliefert: Option<&Path>,
    kandidaten: &[&Path],
    eingestellt: Option<&Path>,
) -> Option<Fund> {
    let fund = |p: &Path, quelle| {
        pfad_pruefen(p).ok().map(|()| Fund {
            pfad: p.to_string_lossy().into_owned(),
            quelle,
        })
    };
    mitgeliefert
        .and_then(|p| fund(p, Quelle::Mitgeliefert))
        .or_else(|| kandidaten.iter().find_map(|p| fund(p, Quelle::Homebrew)))
        .or_else(|| eingestellt.and_then(|p| fund(p, Quelle::Einstellung)))
}

/// Mitgeliefertes Sidecar. Noch nicht gebündelt (Phase 7, §3.2): dann hier den Pfad neben der App-Datei liefern.
fn mitgeliefert() -> Option<PathBuf> {
    None
}

/// Tectonic für diesen Rechner; `eingestellt` = Wert von `tectonic_pfad` (None = automatisch).
pub fn tectonic_finden(eingestellt: Option<&Path>) -> Option<Fund> {
    let kandidaten: Vec<&Path> = KANDIDATEN.iter().map(Path::new).collect();
    finden_in(mitgeliefert().as_deref(), &kandidaten, eingestellt)
}

/// Startet `<pfad> --version` ohne Shell und liefert die erste Zeile der Ausgabe, z. B. „Tectonic 0.15.0“.
pub fn version(pfad: &Path, zeitlimit: Duration) -> Result<String, String> {
    pfad_pruefen(pfad)?;
    let mut kind = Command::new(pfad)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{} lässt sich nicht starten: {e}", pfad.display()))?;
    // Ausgaben in eigenen Threads lesen, damit ein voller Puffer das Programm nicht blockiert
    let lesen = |quelle: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut q) = quelle {
                let _ = q.read_to_string(&mut text);
            }
            text
        })
    };
    let aus = lesen(
        kind.stdout
            .take()
            .map(|s| Box::new(s) as Box<dyn Read + Send>),
    );
    let fehler = lesen(
        kind.stderr
            .take()
            .map(|s| Box::new(s) as Box<dyn Read + Send>),
    );
    let start = Instant::now();
    let status = loop {
        match kind.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() < zeitlimit => {
                std::thread::sleep(Duration::from_millis(20))
            }
            Ok(None) => {
                let _ = kind.kill();
                let _ = kind.wait();
                return Err(format!(
                    "{} hat nach {} Sekunden nicht geantwortet.",
                    pfad.display(),
                    zeitlimit.as_secs()
                ));
            }
            Err(e) => return Err(format!("{}: {e}", pfad.display())),
        }
    };
    let aus = aus.join().unwrap_or_default();
    let fehler = fehler.join().unwrap_or_default();
    let erste = |t: &str| {
        t.lines()
            .map(str::trim)
            .find(|z| !z.is_empty())
            .map(String::from)
    };
    if !status.success() {
        let grund = erste(&fehler)
            .or_else(|| erste(&aus))
            .unwrap_or_else(|| status.to_string());
        return Err(format!("{} meldet einen Fehler: {grund}", pfad.display()));
    }
    erste(&aus)
        .or_else(|| erste(&fehler))
        .ok_or_else(|| format!("{} hat keine Version ausgegeben.", pfad.display()))
}

/* ---------- Commands ---------- */

/// `tectonic_pfad` aus der aktiven Datenbank (JSON-Text: String oder null).
pub(crate) async fn eingestellter_pfad(instanzen: &DbInstances) -> Result<Option<PathBuf>, String> {
    let mut c = verbindung(instanzen).await?;
    let wert: Option<String> =
        sqlx::query_scalar("SELECT wert FROM einstellungen WHERE schluessel = 'tectonic_pfad'")
            .fetch_optional(&mut *c)
            .await
            .map_err(db_fehler)?;
    Ok(wert
        .and_then(|w| serde_json::from_str::<Option<String>>(&w).ok().flatten())
        .filter(|p| !p.trim().is_empty())
        .map(PathBuf::from))
}

#[derive(Debug, Clone, Serialize)]
pub struct TectonicStand {
    /// Gefundenes Programm (None = nichts gefunden)
    pub fund: Option<Fund>,
    /// Eingestellter Pfad (None = automatisch)
    pub eingestellt: Option<String>,
    /// Fehler des eingestellten Pfads (z. B. Datei weg), sonst None
    pub eingestellt_fehler: Option<String>,
}

/// Frontend: `invoke('tectonic_suchen')`.
#[tauri::command]
pub async fn tectonic_suchen(
    instanzen: tauri::State<'_, DbInstances>,
) -> Result<TectonicStand, String> {
    let eingestellt = eingestellter_pfad(&instanzen).await?;
    Ok(TectonicStand {
        fund: tectonic_finden(eingestellt.as_deref()),
        eingestellt_fehler: eingestellt.as_deref().and_then(|p| pfad_pruefen(p).err()),
        eingestellt: eingestellt.map(|p| p.to_string_lossy().into_owned()),
    })
}

/// Frontend: `invoke('tectonic_pfad_pruefen', { pfad })`, bevor ein gewählter Pfad gespeichert wird.
#[tauri::command]
pub fn tectonic_pfad_pruefen(pfad: String) -> Result<(), String> {
    pfad_pruefen(Path::new(pfad.trim()))
}

#[derive(Debug, Clone, Serialize)]
pub struct TectonicPruefung {
    pub pfad: String,
    pub quelle: Quelle,
    pub version: String,
}

/// Frontend: `invoke('tectonic_pruefen')`: sucht wie `compile_latex` und startet `--version`.
#[tauri::command]
pub async fn tectonic_pruefen(
    instanzen: tauri::State<'_, DbInstances>,
) -> Result<TectonicPruefung, String> {
    let eingestellt = eingestellter_pfad(&instanzen).await?;
    let Some(fund) = tectonic_finden(eingestellt.as_deref()) else {
        return Err(
            "Tectonic wurde nicht gefunden. Im Terminal mit „brew install tectonic“ installieren oder den Pfad wählen."
                .into(),
        );
    };
    let pfad = PathBuf::from(&fund.pfad);
    let version = tauri::async_runtime::spawn_blocking(move || version(&pfad, PRUEF_ZEIT))
        .await
        .map_err(|e| format!("Prüfung abgebrochen: {e}"))??;
    Ok(TectonicPruefung {
        pfad: fund.pfad,
        quelle: fund.quelle,
        version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn testordner(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "kladdy-test-{}-tectonic-{name}",
            std::process::id()
        ));
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

    #[test]
    #[cfg(unix)]
    fn pfad_muss_ausfuehrbare_datei_sein() {
        let o = testordner("pfad");
        let gut = o.join("tectonic");
        programm(&gut, "exit 0");
        let text = o.join("liesmich.txt");
        std::fs::write(&text, "x").unwrap();
        assert_eq!(pfad_pruefen(&gut), Ok(()));
        assert!(
            pfad_pruefen(Path::new("tectonic"))
                .unwrap_err()
                .contains("vollständigen Pfad")
        );
        assert!(
            pfad_pruefen(&o.join("fehlt"))
                .unwrap_err()
                .contains("gibt es nicht")
        );
        assert!(pfad_pruefen(&o).unwrap_err().contains("keine Datei"));
        assert!(
            pfad_pruefen(&text)
                .unwrap_err()
                .contains("kein ausführbares")
        );
        // Verknüpfung (wie bei Homebrew) wird aufgelöst
        let link = o.join("link");
        std::os::unix::fs::symlink(&gut, &link).unwrap();
        assert_eq!(pfad_pruefen(&link), Ok(()));
        let _ = std::fs::remove_dir_all(&o);
    }

    #[test]
    #[cfg(unix)]
    fn reihenfolge_sidecar_homebrew_einstellung() {
        let o = testordner("reihenfolge");
        let [side, brew_arm, brew_intel, eigen] =
            ["side", "arm", "intel", "eigen"].map(|n| o.join(n));
        for p in [&side, &brew_arm, &brew_intel, &eigen] {
            programm(p, "exit 0");
        }
        let fehlt = o.join("fehlt");
        let k = [brew_arm.as_path(), brew_intel.as_path()];
        let pfad = |f: Option<Fund>| f.map(|f| (PathBuf::from(f.pfad), f.quelle));

        assert_eq!(
            pfad(finden_in(Some(&side), &k, Some(&eigen))),
            Some((side.clone(), Quelle::Mitgeliefert))
        );
        assert_eq!(
            pfad(finden_in(None, &k, Some(&eigen))),
            Some((brew_arm.clone(), Quelle::Homebrew))
        );
        assert_eq!(
            pfad(finden_in(
                Some(&fehlt),
                &[&fehlt, &brew_intel],
                Some(&eigen)
            )),
            Some((brew_intel.clone(), Quelle::Homebrew))
        );
        assert_eq!(
            pfad(finden_in(None, &[&fehlt], Some(&eigen))),
            Some((eigen.clone(), Quelle::Einstellung))
        );
        assert_eq!(finden_in(None, &[&fehlt], Some(&fehlt)), None);
        assert_eq!(finden_in(None, &[], None), None);
        // Die echte Suche nimmt die festen Homebrew-Orte in dieser Reihenfolge
        assert_eq!(
            KANDIDATEN,
            ["/opt/homebrew/bin/tectonic", "/usr/local/bin/tectonic"]
        );
        let _ = std::fs::remove_dir_all(&o);
    }

    #[test]
    #[cfg(unix)]
    fn version_mit_zeitlimit() {
        let o = testordner("version");
        let gut = o.join("gut");
        programm(&gut, "echo \"Tectonic 0.15.0\"\necho \"weitere Zeile\"");
        assert_eq!(
            version(&gut, Duration::from_secs(5)),
            Ok("Tectonic 0.15.0".into())
        );
        let kaputt = o.join("kaputt");
        programm(&kaputt, "echo \"dyld: Library not loaded\" >&2\nexit 3");
        let f = version(&kaputt, Duration::from_secs(5)).unwrap_err();
        assert!(f.contains("Library not loaded"), "{f}");
        let haengt = o.join("haengt");
        programm(&haengt, "sleep 5");
        let start = Instant::now();
        let f = version(&haengt, Duration::from_millis(200)).unwrap_err();
        assert!(f.contains("nicht geantwortet"), "{f}");
        assert!(start.elapsed() < Duration::from_secs(4));
        let _ = std::fs::remove_dir_all(&o);
    }
}
