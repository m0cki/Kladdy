//! Datenbank (ANLEITUNG §3, §5): SQLite über tauri-plugin-sql, nummerierte Migrationen, Sicherung vor Migrationen.
//!
//! - Die Datei liegt im App-Verzeichnis (`~/Library/Application Support/de.kladdy.desktop/`), nie in iCloud Drive.
//!   tauri-plugin-sql löst `sqlite:<name>` gegen `app_config_dir()` auf; auf macOS ist das derselbe Ordner wie
//!   `appDataDir()` (beide `~/Library/Application Support/<identifier>`).
//! - Debug-Builds (`npm run tauri dev`) benutzen eine eigene Datei, damit die Entwicklung nie die Daten der
//!   installierten App berührt (gleicher Identifier, gleicher Ordner).
//! - Nur Debug-Builds: Demo-Daten liegen in einer dritten Datei (src/demo.rs). Ist der Demo-Modus an, zeigt
//!   `db_url()` auf sie; die echte Datei bleibt unberührt. Release-Builds kennen nur `DB_DATEI`.
//! - Migrationen laufen beim ersten `Database.load` aus dem Frontend, nur vorwärts, jede in einer Transaktion.
//!   sqlx merkt sich je Version eine Prüfsumme: ausgelieferte Dateien NIE ändern, sondern eine neue anhängen.
//! - Vorher (§3.2 „vorher Backup“): Hat eine vorhandene Datenbank noch offene Migrationen, legt das Plugin
//!   `db-sicherung` beim Start eine Kopie per `VACUUM INTO` an. Schlägt das fehl, startet die App trotzdem, öffnet
//!   die Datei aber nicht (lieber keine Daten als eine Migration ohne Sicherung): `SicherungsStatus` merkt sich die
//!   Meldung, `datenbank_url` gibt die Datei nicht heraus, `sicherung_status` liefert die Meldung fürs Frontend.
//! - Dazu (src/sicherungen.rs): vorgemerkte Wiederherstellung vor allem anderen, automatische Sicherung bei jedem
//!   Start (blockiert nie), Sicherungen von Hand und vor Updates.

#[cfg(any(test, debug_assertions))]
use std::future::Future;
use std::path::{Path, PathBuf};
#[cfg(any(test, debug_assertions))]
use std::pin::Pin;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(any(test, debug_assertions))]
use sqlx::error::BoxDynError;
#[cfg(any(test, debug_assertions))]
use sqlx::migrate::{Migration as SqlxMigration, MigrationSource, MigrationType};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection, SqliteConnection};
use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{Manager, Runtime};
use tauri_plugin_sql::{Migration, MigrationKind};

use crate::sicherungen;

/// Dateiname der Datenbank. Einzige Quelle; das Frontend fragt ihn über `datenbank_url` ab.
pub const DB_DATEI: &str = if cfg!(debug_assertions) {
    "kladdy-dev.db"
} else {
    "kladdy.db"
};

/// Unterordner (im App-Verzeichnis) für die Kopien vor einer Migration (`sicherungen::Art::VorMigration`).
const SICHERUNGS_ORDNER: &str = "sicherungen/vor-migration";

/// Eine Migration aus `src-tauri/migrations/`.
#[derive(Debug)]
pub struct MigrationsDatei {
    pub version: i64,
    pub beschreibung: &'static str,
    pub sql: &'static str,
}

/// Alle Migrationen in aufsteigender Reihenfolge. Neue nur hinten anhängen (Version = Dateinummer).
pub const MIGRATIONEN: &[MigrationsDatei] = &[
    MigrationsDatei {
        version: 1,
        beschreibung: "init",
        sql: include_str!("../migrations/0001_init.sql"),
    },
    MigrationsDatei {
        version: 2,
        beschreibung: "standarddaten",
        sql: include_str!("../migrations/0002_standarddaten.sql"),
    },
    MigrationsDatei {
        version: 3,
        beschreibung: "protokoll_schluessel",
        sql: include_str!("../migrations/0003_protokoll_schluessel.sql"),
    },
    MigrationsDatei {
        version: 4,
        beschreibung: "buchungen",
        sql: include_str!("../migrations/0004_buchungen.sql"),
    },
    MigrationsDatei {
        version: 5,
        beschreibung: "belege",
        sql: include_str!("../migrations/0005_belege.sql"),
    },
    MigrationsDatei {
        version: 6,
        beschreibung: "kunden",
        sql: include_str!("../migrations/0006_kunden.sql"),
    },
    MigrationsDatei {
        version: 7,
        beschreibung: "rechnungen",
        sql: include_str!("../migrations/0007_rechnungen.sql"),
    },
    MigrationsDatei {
        version: 8,
        beschreibung: "kategorien",
        sql: include_str!("../migrations/0008_kategorien.sql"),
    },
    MigrationsDatei {
        version: 9,
        beschreibung: "protokoll_schutz",
        sql: include_str!("../migrations/0009_protokoll_schutz.sql"),
    },
    MigrationsDatei {
        version: 10,
        beschreibung: "vorlagen_basis",
        sql: include_str!("../migrations/0010_vorlagen_basis.sql"),
    },
    MigrationsDatei {
        version: 11,
        beschreibung: "vorlagen_eigene",
        sql: include_str!("../migrations/0011_vorlagen_eigene.sql"),
    },
    MigrationsDatei {
        version: 12,
        beschreibung: "belege_entknuepfen",
        sql: include_str!("../migrations/0012_belege_entknuepfen.sql"),
    },
];

/// Verbindungs-URL zu einer Datei im App-Verzeichnis, wie sie das Plugin und `Database.load` erwarten.
pub fn url_zu(datei: &str) -> String {
    format!("sqlite:{datei}")
}

/// URL der aktiven Datenbank: `DB_DATEI`, im Debug-Build mit eingeschaltetem Demo-Modus die Demo-Datei.
pub fn db_url() -> String {
    #[cfg(debug_assertions)]
    if crate::demo::aktiv() {
        return url_zu(crate::demo::DEMO_DB_DATEI);
    }
    url_zu(DB_DATEI)
}

/// Ergebnis der Sicherung vor Migrationen beim Start (Tauri-State, angelegt von `sicherungs_plugin`).
/// `Some(meldung)`: fehlgeschlagen, die echte Datei bleibt in diesem Programmlauf zu (`url_freigeben`).
#[derive(Debug)]
pub struct SicherungsStatus(pub Option<String>);

/// Für das Frontend (src/lib/db.ts): welche Datenbank geladen wird. Muss exakt der URL entsprechen,
/// unter der die Migrationen registriert sind. Nach fehlgeschlagener Sicherung kommt die Meldung statt der URL.
#[tauri::command]
pub fn datenbank_url(status: tauri::State<'_, SicherungsStatus>) -> Result<String, String> {
    url_freigeben(db_url(), status.0.as_deref())
}

/// Für das Frontend (src/lib/db.ts): Meldung, wenn die Sicherung vor Migrationen beim Start fehlgeschlagen ist.
#[tauri::command]
pub fn sicherung_status(status: tauri::State<'_, SicherungsStatus>) -> Option<String> {
    status.0.clone()
}

/// Darf das Frontend `url` laden? Das SQL-Plugin migriert beim ersten Laden; ist die Sicherung fehlgeschlagen,
/// bleibt die echte Datei (`DB_DATEI`) deshalb zu, bis ein Neustart sie sichern kann. Die Demo-Datei (nur Debug)
/// wird nie gesichert (siehe `sicherungs_plugin`) und bleibt erreichbar.
fn url_freigeben(url: String, sicherungs_fehler: Option<&str>) -> Result<String, String> {
    match sicherungs_fehler {
        Some(meldung) if url == url_zu(DB_DATEI) => Err(meldung.to_string()),
        _ => Ok(url),
    }
}

fn plugin_migrationen() -> Vec<Migration> {
    MIGRATIONEN
        .iter()
        .map(|m| Migration {
            version: m.version,
            description: m.beschreibung,
            sql: m.sql,
            kind: MigrationKind::Up,
        })
        .collect()
}

/// tauri-plugin-sql mit unseren Migrationen. Feste URLs statt `db_url()`: Das Plugin wird gebaut, bevor der
/// Demo-Modus feststeht, und muss beide Dateien kennen (die Demo-Datei nur im Debug-Build).
pub fn sql_plugin<R: Runtime>() -> TauriPlugin<R, Option<tauri_plugin_sql::PluginConfig>> {
    let builder =
        tauri_plugin_sql::Builder::new().add_migrations(&url_zu(DB_DATEI), plugin_migrationen());
    #[cfg(debug_assertions)]
    let builder = builder.add_migrations(&url_zu(crate::demo::DEMO_DB_DATEI), plugin_migrationen());
    builder.build()
}

/// Migrationen so, wie tauri-plugin-sql sie an sqlx übergibt (gleiche Prüfsummen, gleiche Transaktionen).
/// Für Tests und das Anlegen der Demo-Datenbank (src/demo.rs), die nicht über das Plugin migriert wird.
#[cfg(any(test, debug_assertions))]
#[derive(Debug)]
pub struct MigrationsQuelle(pub Vec<&'static MigrationsDatei>);

#[cfg(any(test, debug_assertions))]
impl MigrationSource<'static> for MigrationsQuelle {
    fn resolve(
        self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SqlxMigration>, BoxDynError>> + Send + 'static>>
    {
        Box::pin(async move {
            Ok(self
                .0
                .into_iter()
                .map(|m| {
                    SqlxMigration::new(
                        m.version,
                        m.beschreibung.into(),
                        MigrationType::ReversibleUp,
                        m.sql.into(),
                        false,
                    )
                })
                .collect())
        })
    }
}

/// Sicherung vor Migrationen. Muss VOR `sql_plugin()` registriert werden: Plugins werden in der Reihenfolge
/// ihrer Registrierung eingerichtet, noch bevor ein Fenster existiert und das Frontend die Datenbank öffnen kann.
/// Gesichert wird immer die echte Datei `DB_DATEI`, auch im Demo-Modus: Sie wird dann erst nach dem Entfernen der
/// Demo-Daten (oder beim nächsten Start) geladen und migriert, und bis dahin sichert jeder Start erneut, solange
/// Migrationen offen sind. Die Demo-Datei braucht keine Sicherung (wird frisch angelegt, siehe src/demo.rs).
/// Schlägt die Sicherung fehl, startet die App trotzdem (ein Fehler hier hieße: stiller Abbruch ohne Fenster).
/// `SicherungsStatus` hält dann die Meldung, und die Datei wird weder geöffnet noch migriert.
///
/// Reihenfolge beim Start (alles vor dem SQL-Plugin, also bevor irgendwer die Datei öffnet):
/// 1. vorgemerkte Wiederherstellung (src/sicherungen.rs, sichert vorher den aktuellen Stand),
/// 2. Sicherung vor offenen Migrationen (blockiert bei Fehler das Öffnen, siehe oben),
/// 3. automatische Sicherung samt Rotation (blockiert nie, Fehler gehen in den `StartBericht`).
pub fn sicherungs_plugin<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("db-sicherung")
        .setup(|app, _api| {
            let ordner = app.path().app_config_dir()?;
            let db = ordner.join(DB_DATEI);
            let sicherungen = ordner.join(sicherungen::ORDNER);
            let jetzt = jetzt_sekunden();
            let wiederherstellung =
                sicherungen::vorgemerkte_wiederherstellung(&db, &sicherungen, jetzt);
            let ziel = ordner.join(SICHERUNGS_ORDNER);
            let versionen: Vec<i64> = MIGRATIONEN.iter().map(|m| m.version).collect();
            let fehler = sicherung_beim_start(&db, &ziel, &versionen, jetzt);
            let automatisch = sicherungen::automatisch_beim_start(&db, &sicherungen, jetzt);
            app.manage(SicherungsStatus(fehler));
            app.manage(sicherungen::StartBericht(std::sync::Mutex::new(Some(
                sicherungen::Bericht::aus(wiederherstellung, automatisch),
            ))));
            Ok(())
        })
        .build()
}

/// Sicherung beim Start: `None`, wenn gesichert wurde oder nichts zu sichern war, sonst die Meldung fürs Frontend.
fn sicherung_beim_start(db: &Path, ziel: &Path, bekannt: &[i64], sekunden: u64) -> Option<String> {
    match sichern_vor_migration(db, ziel, bekannt, sekunden) {
        Ok(Some(kopie)) => {
            eprintln!("Sicherung vor Migration: {}", kopie.display());
            None
        }
        Ok(None) => None,
        Err(e) => {
            eprintln!("Sicherung vor Migration fehlgeschlagen: {e}");
            Some(sicherungs_meldung(db, &e))
        }
    }
}

/// Meldung, wenn die Sicherung vor Migrationen fehlschlägt: was passiert ist, was zu tun ist und wo die Datenbank
/// liegt. `fehler` (aus `sichern_vor_migration`) nennt den Schritt, den Pfad und den Fehler des Systems.
fn sicherungs_meldung(db: &Path, fehler: &str) -> String {
    let ordner = db.parent().unwrap_or(db).display();
    let datei = db.display();
    format!(
        "Sicherung vor dem Datenbank-Update fehlgeschlagen: {fehler}. Damit nichts ungesichert \
         umgestellt wird, hat Kladdy die Datenbank nicht geöffnet – deine Daten sind unverändert. \
         Bitte Speicherplatz freigeben und die Schreibrechte für den Ordner {ordner} prüfen, dann \
         Kladdy neu starten. Datenbank: {datei}"
    )
}

/// Die geladene Datenbank des SQL-Plugins (Schlüssel = URL aus `db_url()`, wie im Frontend geladen).
/// Die Rust-Commands teilen sich so den Pool mit dem Frontend, statt eine zweite Verbindung zu öffnen.
pub async fn pool(instanzen: &tauri_plugin_sql::DbInstances) -> Result<sqlx::SqlitePool, String> {
    let karte = instanzen.0.read().await;
    match karte.get(&db_url()) {
        Some(tauri_plugin_sql::DbPool::Sqlite(pool)) => Ok(pool.clone()),
        None => Err("Die Datenbank ist noch nicht geöffnet.".into()),
    }
}

/// Fehler aus sqlx als Text fürs Frontend. Meldungen aus der Datenbank selbst (z. B. RAISE in einem Trigger)
/// werden ohne technischen Vorspann weitergegeben, sie sind schon für Menschen geschrieben.
pub fn db_fehler(e: sqlx::Error) -> String {
    match &e {
        sqlx::Error::Database(d) => d.message().to_string(),
        _ => format!("Datenbankfehler: {e}"),
    }
}

pub(crate) fn jetzt_sekunden() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Versionen, die bekannt, aber noch nicht angewendet sind (aufsteigend).
pub fn offene_migrationen(angewendet: &[i64], bekannt: &[i64]) -> Vec<i64> {
    let mut offen: Vec<i64> = bekannt
        .iter()
        .copied()
        .filter(|v| !angewendet.contains(v))
        .collect();
    offen.sort_unstable();
    offen
}

/// Datum und Uhrzeit (UTC) aus Unix-Sekunden ohne Zusatz-Crate (Tage → Datum nach H. Hinnant, „civil_from_days“).
pub(crate) fn utc_teile(sekunden: u64) -> (i64, i64, i64, u64, u64, u64) {
    let tage = (sekunden / 86_400) as i64;
    let rest = sekunden % 86_400;
    let (h, mi, s) = (rest / 3600, rest % 3600 / 60, rest % 60);
    let z = tage + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let tag = doy - (153 * mp + 2) / 5 + 1;
    let monat = if mp < 10 { mp + 3 } else { mp - 9 };
    let jahr = yoe + era * 400 + i64::from(monat <= 2);
    (jahr, monat, tag, h, mi, s)
}

/// UTC-Zeitstempel `JJJJMMTT-hhmmss` (Dateinamen der Sicherungen).
pub fn utc_stempel(sekunden: u64) -> String {
    let (jahr, monat, tag, h, mi, s) = utc_teile(sekunden);
    format!("{jahr:04}{monat:02}{tag:02}-{h:02}{mi:02}{s:02}")
}

/// UTC-Zeitstempel `JJJJ-MM-TTThh:mm:ssZ`, dasselbe Format wie `zeitstempel()` in src/lib/db.ts
/// (erstellt_am, geaendert_am, protokoll.zeitpunkt).
pub fn utc_iso(sekunden: u64) -> String {
    let (jahr, monat, tag, h, mi, s) = utc_teile(sekunden);
    format!("{jahr:04}-{monat:02}-{tag:02}T{h:02}:{mi:02}:{s:02}Z")
}

/// Jetzt als `utc_iso`.
pub fn zeitstempel() -> String {
    utc_iso(jetzt_sekunden())
}

/// Dateiname der Kopie, z. B. `kladdy-vor-migration-0003-20261013-221500.db` (Zeit in UTC).
pub fn sicherungs_name(db_datei: &str, erste_offene: i64, sekunden: u64) -> String {
    let stamm = db_datei.strip_suffix(".db").unwrap_or(db_datei);
    format!(
        "{stamm}-vor-migration-{erste_offene:04}-{}.db",
        utc_stempel(sekunden)
    )
}

/// Legt eine Kopie von `db` in `ordner` an, wenn die Datei existiert, nicht leer ist und noch Migrationen
/// aus `bekannt` offen sind. Gibt den Pfad der Kopie zurück, sonst `None`.
/// `VACUUM INTO` statt Dateikopie: liefert einen konsistenten Stand, auch wenn noch ein Journal herumliegt.
/// Fehler nennen den Schritt, den Pfad und den Fehler des Systems (für `sicherungs_meldung`).
pub fn sichern_vor_migration(
    db: &Path,
    ordner: &Path,
    bekannt: &[i64],
    sekunden: u64,
) -> Result<Option<PathBuf>, String> {
    let groesse = match std::fs::metadata(db) {
        Ok(m) => m.len(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Datenbank lesen ({}): {e}", db.display())),
    };
    if groesse == 0 {
        return Ok(None);
    }
    tauri::async_runtime::block_on(async {
        let mut verbindung = SqliteConnectOptions::new()
            .filename(db)
            .create_if_missing(false)
            .connect()
            .await
            .map_err(|e| format!("Datenbank öffnen ({}): {e}", db.display()))?;
        let ergebnis = sichern_mit(&mut verbindung, db, ordner, bekannt, sekunden).await;
        let _ = verbindung.close().await;
        ergebnis
    })
}

async fn sichern_mit(
    verbindung: &mut SqliteConnection,
    db: &Path,
    ordner: &Path,
    bekannt: &[i64],
    sekunden: u64,
) -> Result<Option<PathBuf>, String> {
    let hat_tabelle: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_one(&mut *verbindung)
    .await
    .map_err(|e| format!("Migrationen lesen: {e}"))?;
    let angewendet: Vec<i64> = if hat_tabelle > 0 {
        sqlx::query_scalar("SELECT version FROM _sqlx_migrations WHERE success = 1")
            .fetch_all(&mut *verbindung)
            .await
            .map_err(|e| format!("Migrationen lesen: {e}"))?
    } else {
        Vec::new()
    };
    let offen = offene_migrationen(&angewendet, bekannt);
    let Some(&erste) = offen.first() else {
        return Ok(None);
    };
    std::fs::create_dir_all(ordner)
        .map_err(|e| format!("Ordner anlegen ({}): {e}", ordner.display()))?;
    let name = db.file_name().and_then(|n| n.to_str()).unwrap_or(DB_DATEI);
    let ziel = ordner.join(sicherungs_name(name, erste, sekunden));
    let ziel_text = ziel
        .to_str()
        .ok_or_else(|| format!("Pfad nicht als UTF-8 darstellbar: {}", ziel.display()))?;
    sqlx::query("VACUUM INTO ?")
        .bind(ziel_text)
        .execute(&mut *verbindung)
        .await
        .map_err(|e| format!("Kopie schreiben ({}): {e}", ziel.display()))?;
    Ok(Some(ziel))
}

/// Gemeinsame Testhilfen (auch für buchungen.rs und nummern.rs).
#[cfg(test)]
pub(crate) mod testhilfe {
    use super::*;
    use sqlx::migrate::Migrator;
    use std::str::FromStr;

    /// Frische Datenbank im Arbeitsspeicher, mit allen Migrationen (wie beim ersten Start der App).
    pub async fn test_db() -> SqliteConnection {
        let mut c = SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .connect()
            .await
            .unwrap();
        let migrator = Migrator::new(MigrationsQuelle(MIGRATIONEN.iter().collect()))
            .await
            .unwrap();
        migrator.run_direct(&mut c).await.unwrap();
        c
    }

    /// Eigener leerer Ordner je Test (ohne tempfile-Crate).
    pub fn testordner(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("kladdy-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// Verbindung zu einer Datei (legt sie bei Bedarf an).
    pub async fn verbinden(pfad: &Path) -> SqliteConnection {
        SqliteConnectOptions::new()
            .filename(pfad)
            .create_if_missing(true)
            .connect()
            .await
            .unwrap()
    }

    /// Wendet die ersten `bis` Migrationen an.
    pub async fn migrieren(pfad: &Path, bis: usize) {
        let mut c = verbinden(pfad).await;
        let migrator = Migrator::new(MigrationsQuelle(MIGRATIONEN.iter().take(bis).collect()))
            .await
            .unwrap();
        migrator.run_direct(&mut c).await.unwrap();
        c.close().await.unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::testhilfe::{migrieren, testordner, verbinden};
    use super::*;

    fn versionen() -> Vec<i64> {
        MIGRATIONEN.iter().map(|m| m.version).collect()
    }

    #[test]
    fn dev_und_release_haben_verschiedene_dateien() {
        assert!(DB_DATEI.ends_with(".db"));
        if cfg!(debug_assertions) {
            assert_eq!(DB_DATEI, "kladdy-dev.db");
        } else {
            assert_eq!(DB_DATEI, "kladdy.db");
        }
        assert_eq!(url_zu(DB_DATEI), format!("sqlite:{DB_DATEI}"));
    }

    #[test]
    fn migrationen_lueckenlos_aufsteigend() {
        for (i, m) in MIGRATIONEN.iter().enumerate() {
            assert_eq!(
                m.version,
                i as i64 + 1,
                "Migration {} an Stelle {i}",
                m.version
            );
            assert!(!m.sql.trim().is_empty());
        }
    }

    #[test]
    fn offene_migrationen_bestimmen() {
        assert_eq!(offene_migrationen(&[], &[1, 2]), vec![1, 2]);
        assert_eq!(offene_migrationen(&[1], &[1, 2, 3]), vec![2, 3]);
        assert_eq!(offene_migrationen(&[1, 2], &[1, 2]), Vec::<i64>::new());
        // neuere Datenbank (z. B. nach Downgrade): nichts offen, sqlx meldet den Fehler selbst
        assert_eq!(offene_migrationen(&[1, 2, 3], &[1, 2]), Vec::<i64>::new());
        assert_eq!(offene_migrationen(&[2], &[3, 1, 2]), vec![1, 3]);
    }

    #[test]
    fn zeitstempel_utc() {
        assert_eq!(utc_stempel(0), "19700101-000000");
        assert_eq!(utc_stempel(951_825_600), "20000229-120000");
        assert_eq!(utc_stempel(946_684_799), "19991231-235959");
        assert_eq!(utc_stempel(1_791_929_700), "20261013-221500");
    }

    #[test]
    fn name_der_sicherung() {
        assert_eq!(
            sicherungs_name("kladdy.db", 3, 1_791_929_700),
            "kladdy-vor-migration-0003-20261013-221500.db"
        );
        assert_eq!(
            sicherungs_name("kladdy-dev.db", 12, 0),
            "kladdy-dev-vor-migration-0012-19700101-000000.db"
        );
    }

    #[test]
    fn migrationen_laufen_und_legen_standarddaten_an() {
        let ordner = testordner("migrationen");
        let db = ordner.join("test.db");
        tauri::async_runtime::block_on(async {
            migrieren(&db, MIGRATIONEN.len()).await;
            let mut c = verbinden(&db).await;
            // sichtbar: die vier Standardkategorien (die optionalen sind ausgeblendet)
            let kategorien: Vec<(String, String)> = sqlx::query_as(
                "SELECT name, typ FROM kategorien WHERE archiviert = 0 ORDER BY sortierung",
            )
            .fetch_all(&mut c)
            .await
            .unwrap();
            assert_eq!(
                kategorien,
                vec![
                    ("Dienstleistungen".into(), "einnahme".into()),
                    ("Produkte & Material".into(), "ausgabe".into()),
                    ("Sprit & Fahrzeug".into(), "ausgabe".into()),
                    ("Sonstige Kosten".into(), "ausgabe".into()),
                ]
            );
            let ku: String = sqlx::query_scalar(
                "SELECT wert FROM steuer_parameter WHERE jahr = 2026 AND schluessel = 'ku_grenze_laufend_cent'",
            )
            .fetch_one(&mut c)
            .await
            .unwrap();
            assert_eq!(ku, "10000000");
            let kreise: Vec<(String, String)> =
                sqlx::query_as("SELECT id, muster FROM nummernkreise ORDER BY id")
                    .fetch_all(&mut c)
                    .await
                    .unwrap();
            assert_eq!(kreise.len(), 6);
            assert!(kreise.contains(&("kunde".into(), "K-{NNNN}".into())));
            // Atomare Vergabe wie in §5 beschrieben (RETURNING braucht SQLite ≥ 3.35)
            let nr: i64 = sqlx::query_scalar(
                "UPDATE nummernkreise SET naechste = naechste + 1 WHERE id = 'kunde' RETURNING naechste - 1",
            )
            .fetch_one(&mut c)
            .await
            .unwrap();
            assert_eq!(nr, 1);
            // Fremdschlüssel sind an (sqlx-Standard) und das Schema ist in sich stimmig
            let fk: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
                .fetch_one(&mut c)
                .await
                .unwrap();
            assert_eq!(fk, 1);
            let verstoesse = sqlx::query("PRAGMA foreign_key_check")
                .fetch_all(&mut c)
                .await
                .unwrap();
            assert!(verstoesse.is_empty());
            let falsch = sqlx::query(
                "INSERT INTO buchungen (nummer, typ, zahlungsdatum, betrag_cent, kategorie_id, beschreibung, erstellt_am, geaendert_am)
                 VALUES ('2026-0001', 'einnahme', '2026-10-13', 100, 99, 'x', 'jetzt', 'jetzt')",
            )
            .execute(&mut c)
            .await;
            assert!(
                falsch.is_err(),
                "unbekannte Kategorie muss abgelehnt werden"
            );
            // 0003: Protokoll für Stammdaten ohne INTEGER-ID (datensatz_id = 0, Textschlüssel)
            sqlx::query(
                "INSERT INTO protokoll (zeitpunkt, tabelle, datensatz_id, aktion, alt_json, neu_json, schluessel)
                 VALUES ('2026-10-13T20:15:00Z', 'nummernkreise', 0, 'geaendert', '{\"muster\":\"RE-{JJJJ}-{NNN}\"}', '{\"muster\":\"R{JJ}-{NNNN}\"}', 'rechnung')",
            )
            .execute(&mut c)
            .await
            .unwrap();
            let schluessel: Option<String> = sqlx::query_scalar(
                "SELECT schluessel FROM protokoll WHERE tabelle = 'nummernkreise'",
            )
            .fetch_one(&mut c)
            .await
            .unwrap();
            assert_eq!(schluessel.as_deref(), Some("rechnung"));
            c.close().await.unwrap();
        });
        let _ = std::fs::remove_dir_all(&ordner);
    }

    #[test]
    fn trigger_schuetzen_den_festgeschriebenen_zeitraum() {
        tauri::async_runtime::block_on(async {
            let mut c = testhilfe::test_db().await;
            let einfuegen = |nummer: &'static str, datum: &'static str| {
                sqlx::query(
                    "INSERT INTO buchungen (nummer, typ, zahlungsdatum, betrag_cent, kategorie_id, zahlungsart, beschreibung, erstellt_am, geaendert_am)
                     VALUES (?, 'ausgabe', ?, 100, 2, 'bar', 'x', 'jetzt', 'jetzt')",
                )
                .bind(nummer)
                .bind(datum)
            };
            // ohne Festschreibung ist alles erlaubt
            einfuegen("2025-0001", "2025-12-31")
                .execute(&mut c)
                .await
                .unwrap();
            einfuegen("2026-0001", "2026-01-01")
                .execute(&mut c)
                .await
                .unwrap();
            einfuegen("2026-0002", "2026-01-02")
                .execute(&mut c)
                .await
                .unwrap();
            sqlx::query("UPDATE buchungen SET beschreibung = 'y'")
                .execute(&mut c)
                .await
                .unwrap();
            sqlx::query("DELETE FROM buchungen WHERE nummer = '2026-0002'")
                .execute(&mut c)
                .await
                .unwrap();

            sqlx::query(
                "INSERT INTO festschreibungen (bis_datum, am) VALUES ('2025-12-31', 'jetzt')",
            )
            .execute(&mut c)
            .await
            .unwrap();
            let meldung = |e: sqlx::Error| db_fehler(e);
            let f =
                sqlx::query("UPDATE buchungen SET beschreibung = 'z' WHERE nummer = '2025-0001'")
                    .execute(&mut c)
                    .await
                    .map_err(meldung)
                    .unwrap_err();
            assert!(
                f.starts_with("Die Buchung liegt im festgeschriebenen Zeitraum"),
                "{f}"
            );
            // offene Buchung in den festgeschriebenen Zeitraum verschieben
            let f = sqlx::query(
                "UPDATE buchungen SET zahlungsdatum = '2025-12-01' WHERE nummer = '2026-0001'",
            )
            .execute(&mut c)
            .await
            .map_err(meldung)
            .unwrap_err();
            assert!(f.contains("festgeschrieben"), "{f}");
            let f = sqlx::query("DELETE FROM buchungen WHERE nummer = '2025-0001'")
                .execute(&mut c)
                .await
                .map_err(meldung)
                .unwrap_err();
            assert!(f.contains("nicht gelöscht"), "{f}");
            let f = einfuegen("2026-0003", "2025-06-30")
                .execute(&mut c)
                .await
                .map_err(meldung)
                .unwrap_err();
            assert!(f.contains("keine Buchungen mehr angelegt"), "{f}");
            // offener Zeitraum bleibt frei
            sqlx::query("UPDATE buchungen SET beschreibung = 'z' WHERE nummer = '2026-0001'")
                .execute(&mut c)
                .await
                .unwrap();
            einfuegen("2026-0003", "2026-01-01")
                .execute(&mut c)
                .await
                .unwrap();
            // eine Buchung wird höchstens einmal storniert (eindeutiger Index)
            sqlx::query("UPDATE buchungen SET storno_von_id = (SELECT id FROM buchungen WHERE nummer = '2026-0001') WHERE nummer = '2026-0003'")
                .execute(&mut c)
                .await
                .unwrap();
            einfuegen("2026-0004", "2026-01-01")
                .execute(&mut c)
                .await
                .unwrap();
            assert!(
                sqlx::query("UPDATE buchungen SET storno_von_id = (SELECT id FROM buchungen WHERE nummer = '2026-0001') WHERE nummer = '2026-0004'")
                    .execute(&mut c)
                    .await
                    .is_err()
            );
            let alle: i64 = sqlx::query_scalar("SELECT count(*) FROM buchungen")
                .fetch_one(&mut c)
                .await
                .unwrap();
            assert_eq!(alle, 4);
        });
    }

    #[test]
    fn trigger_schuetzen_belege() {
        tauri::async_runtime::block_on(async {
            let mut c = testhilfe::test_db().await;
            sqlx::query(
                "INSERT INTO buchungen (id, nummer, typ, zahlungsdatum, betrag_cent, kategorie_id, zahlungsart, beschreibung, erstellt_am, geaendert_am)
                 VALUES (1, '2026-0001', 'ausgabe', '2026-10-14', 100, 2, 'bar', 'x', 'jetzt', 'jetzt')",
            )
            .execute(&mut c)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO belege (id, buchung_id, pfad, originalname, mime, sha256, groesse, art, aufbewahren_bis, erstellt_am)
                 VALUES (1, 1, '2026/ab.pdf', 'a.pdf', 'application/pdf', 'ab', 3, 'beleg', '2034-12-31', 'jetzt')",
            )
            .execute(&mut c)
            .await
            .unwrap();
            // Indizes aus 0005 und 0007
            let indizes: Vec<String> = sqlx::query_scalar(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'belege' ORDER BY name",
            )
            .fetch_all(&mut c)
            .await
            .unwrap();
            assert_eq!(
                indizes,
                vec!["belege_buchung_id", "belege_rechnung_id", "belege_sha256"]
            );

            let meldung = |e: sqlx::Error| db_fehler(e);
            let f = sqlx::query("DELETE FROM belege WHERE id = 1")
                .execute(&mut c)
                .await
                .map_err(meldung)
                .unwrap_err();
            assert_eq!(f, "Belege werden nie gelöscht (GoBD).");
            let gesperrt = "Belege werden nie geändert (GoBD). Nur die Aufbewahrungsfrist kann verlängert und die Verknüpfung zu einer gelöschten Buchung gelöst werden.";
            for sql in [
                "UPDATE belege SET pfad = '2026/cd.pdf'",
                "UPDATE belege SET sha256 = 'cd'",
                "UPDATE belege SET originalname = NULL",
                "UPDATE belege SET groesse = 4",
                "UPDATE belege SET buchung_id = 2",
                "UPDATE belege SET buchung_id = NULL, groesse = 4",
                "UPDATE belege SET rechnung_id = 1",
                "UPDATE belege SET art = 'erechnung_xml'",
                "UPDATE belege SET mime = 'image/png'",
                "UPDATE belege SET erstellt_am = 'spaeter'",
                "UPDATE belege SET id = 2",
                "UPDATE belege SET aufbewahren_bis = '2034-12-30'",
                "UPDATE belege SET aufbewahren_bis = NULL",
                "UPDATE belege SET aufbewahren_bis = '2040-12-31', groesse = 4",
            ] {
                let f = sqlx::query(sql)
                    .execute(&mut c)
                    .await
                    .map_err(meldung)
                    .unwrap_err();
                assert_eq!(f, gesperrt, "{sql}");
            }
            // verlängern (und gleich lassen) geht
            sqlx::query("UPDATE belege SET aufbewahren_bis = '2034-12-31'")
                .execute(&mut c)
                .await
                .unwrap();
            sqlx::query("UPDATE belege SET aufbewahren_bis = '2035-12-31'")
                .execute(&mut c)
                .await
                .unwrap();
            let (pfad, bis): (String, String) =
                sqlx::query_as("SELECT pfad, aufbewahren_bis FROM belege")
                    .fetch_one(&mut c)
                    .await
                    .unwrap();
            assert_eq!((pfad.as_str(), bis.as_str()), ("2026/ab.pdf", "2035-12-31"));
        });
    }

    /// 0012: Die Verknüpfung zur Buchung darf genau von einem Wert auf NULL gehen (Buchung löschen, Datei bleibt) –
    /// nicht zurück, nicht auf eine andere Buchung und nicht bei einer festgeschriebenen Buchung.
    #[test]
    fn trigger_erlaubt_nur_entknuepfen() {
        tauri::async_runtime::block_on(async {
            let mut c = testhilfe::test_db().await;
            sqlx::query(
                "INSERT INTO buchungen (id, nummer, typ, zahlungsdatum, betrag_cent, kategorie_id, zahlungsart, beschreibung, erstellt_am, geaendert_am) VALUES
                   (1, '2026-0001', 'ausgabe', '2026-10-14', 100, 2, 'bar', 'x', 'jetzt', 'jetzt'),
                   (2, '2026-0002', 'ausgabe', '2026-10-15', 200, 2, 'bar', 'y', 'jetzt', 'jetzt'),
                   (3, '2025-0001', 'ausgabe', '2025-12-01', 300, 2, 'bar', 'z', 'jetzt', 'jetzt')",
            )
            .execute(&mut c)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO belege (id, buchung_id, pfad, originalname, mime, sha256, groesse, art, aufbewahren_bis, erstellt_am) VALUES
                   (1, 1, '2026/ab.pdf', 'a.pdf', 'application/pdf', 'ab', 3, 'beleg', '2034-12-31', 'jetzt'),
                   (2, 3, '2025/cd.pdf', 'c.pdf', 'application/pdf', 'cd', 3, 'beleg', '2033-12-31', 'jetzt')",
            )
            .execute(&mut c)
            .await
            .unwrap();
            sqlx::query("INSERT INTO festschreibungen (bis_datum, am) VALUES ('2025-12-31', 'x')")
                .execute(&mut c)
                .await
                .unwrap();
            let gesperrt = "Belege werden nie geändert (GoBD). Nur die Aufbewahrungsfrist kann verlängert und die Verknüpfung zu einer gelöschten Buchung gelöst werden.";
            let meldung = |e: sqlx::Error| db_fehler(e);
            // Wert ⇒ anderer Wert: nein
            let f = sqlx::query("UPDATE belege SET buchung_id = 2 WHERE id = 1")
                .execute(&mut c)
                .await
                .map_err(meldung)
                .unwrap_err();
            assert_eq!(f, gesperrt);
            // festgeschriebene Buchung: bleibt verknüpft
            let f = sqlx::query("UPDATE belege SET buchung_id = NULL WHERE id = 2")
                .execute(&mut c)
                .await
                .map_err(meldung)
                .unwrap_err();
            assert_eq!(
                f,
                "Die Buchung liegt im festgeschriebenen Zeitraum, ihre Belege bleiben verknüpft (GoBD)."
            );
            // Wert ⇒ NULL: ja
            sqlx::query("UPDATE belege SET buchung_id = NULL WHERE id = 1")
                .execute(&mut c)
                .await
                .unwrap();
            // NULL ⇒ Wert: nein (auch nicht zurück)
            for sql in [
                "UPDATE belege SET buchung_id = 1 WHERE id = 1",
                "UPDATE belege SET buchung_id = 2 WHERE id = 1",
            ] {
                let f = sqlx::query(sql)
                    .execute(&mut c)
                    .await
                    .map_err(meldung)
                    .unwrap_err();
                assert_eq!(f, gesperrt, "{sql}");
            }
            // NULL bleibt NULL, Frist verlängern geht weiter
            sqlx::query(
                "UPDATE belege SET buchung_id = NULL, aufbewahren_bis = '2035-12-31' WHERE id = 1",
            )
            .execute(&mut c)
            .await
            .unwrap();
            let z: (Option<i64>, String, String) = sqlx::query_as(
                "SELECT buchung_id, sha256, aufbewahren_bis FROM belege WHERE id = 1",
            )
            .fetch_one(&mut c)
            .await
            .unwrap();
            assert_eq!(z, (None, "ab".into(), "2035-12-31".into()));
            let geblieben: Option<i64> =
                sqlx::query_scalar("SELECT buchung_id FROM belege WHERE id = 2")
                    .fetch_one(&mut c)
                    .await
                    .unwrap();
            assert_eq!(geblieben, Some(3));
        });
    }

    /// 0009: Protokoll und Festschreibungen sind nur anfügbar. Nur alt_json/neu_json dürfen sich
    /// ändern (Anonymisierung nach Fristablauf), alles andere und jedes Löschen bricht ab.
    #[test]
    fn trigger_schuetzen_protokoll_und_festschreibungen() {
        tauri::async_runtime::block_on(async {
            let mut c = testhilfe::test_db().await;
            sqlx::query("INSERT INTO festschreibungen (bis_datum, am) VALUES ('2025-12-31', 'x')")
                .execute(&mut c)
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO protokoll (id, zeitpunkt, tabelle, datensatz_id, aktion, alt_json, neu_json, schluessel)
                 VALUES (1, 'jetzt', 'kunden', 3, 'neu', NULL, '{\"name\":\"Anna\"}', NULL)",
            )
            .execute(&mut c)
            .await
            .unwrap();
            let meldung = |e: sqlx::Error| db_fehler(e);

            let f = sqlx::query("DELETE FROM festschreibungen")
                .execute(&mut c)
                .await
                .map_err(meldung)
                .unwrap_err();
            assert_eq!(f, "Festschreibungen werden nie aufgehoben (GoBD).");
            let f = sqlx::query("UPDATE festschreibungen SET bis_datum = '2024-12-31'")
                .execute(&mut c)
                .await
                .map_err(meldung)
                .unwrap_err();
            assert_eq!(f, "Festschreibungen werden nie geändert (GoBD).");

            let f = sqlx::query("DELETE FROM protokoll")
                .execute(&mut c)
                .await
                .map_err(meldung)
                .unwrap_err();
            assert_eq!(f, "Das Protokoll wird nie gelöscht (GoBD).");
            let gesperrt = "Protokolleinträge werden nie geändert (GoBD). Nur alt_json/neu_json dürfen anonymisiert werden.";
            for sql in [
                "UPDATE protokoll SET id = 2",
                "UPDATE protokoll SET zeitpunkt = 'spaeter'",
                "UPDATE protokoll SET tabelle = 'buchungen'",
                "UPDATE protokoll SET datensatz_id = 4",
                "UPDATE protokoll SET aktion = 'geaendert'",
                "UPDATE protokoll SET schluessel = 'firma'",
                "UPDATE protokoll SET neu_json = NULL, aktion = 'geaendert'",
            ] {
                let f = sqlx::query(sql)
                    .execute(&mut c)
                    .await
                    .map_err(meldung)
                    .unwrap_err();
                assert_eq!(f, gesperrt, "{sql}");
            }
            // anonymisieren geht
            sqlx::query("UPDATE protokoll SET neu_json = '{\"name\":\"***\"}', alt_json = NULL")
                .execute(&mut c)
                .await
                .unwrap();
            let neu: String = sqlx::query_scalar("SELECT neu_json FROM protokoll WHERE id = 1")
                .fetch_one(&mut c)
                .await
                .unwrap();
            assert_eq!(neu, "{\"name\":\"***\"}");
        });
    }

    #[test]
    fn migration_0006_behaelt_das_protokoll() {
        let ordner = testordner("protokoll-0006");
        let db = ordner.join("kladdy.db");
        tauri::async_runtime::block_on(async {
            // Stand vor 0006 mit zwei Protokolleinträgen (einer mit Textschlüssel aus 0003)
            migrieren(&db, 5).await;
            let mut c = verbinden(&db).await;
            sqlx::query(
                "INSERT INTO protokoll (id, zeitpunkt, tabelle, datensatz_id, aktion, alt_json, neu_json, schluessel) VALUES
                   (7, '2026-10-13T20:15:00Z', 'kunden', 3, 'neu', NULL, '{\"name\":\"Anna\"}', NULL),
                   (9, '2026-10-14T08:00:00Z', 'nummernkreise', 0, 'geaendert', '{\"a\":1}', '{\"a\":2}', 'rechnung')",
            )
            .execute(&mut c)
            .await
            .unwrap();
            assert!(
                sqlx::query("INSERT INTO protokoll (zeitpunkt, tabelle, datensatz_id, aktion) VALUES ('x', 'kunden', 3, 'geloescht')")
                    .execute(&mut c)
                    .await
                    .is_err(),
                "vor 0006 gibt es 'geloescht' noch nicht"
            );
            c.close().await.unwrap();

            migrieren(&db, MIGRATIONEN.len()).await;
            let mut c = verbinden(&db).await;
            type Zeile = (
                i64,
                String,
                String,
                i64,
                String,
                Option<String>,
                Option<String>,
                Option<String>,
            );
            let zeilen: Vec<Zeile> = sqlx::query_as(
                "SELECT id, zeitpunkt, tabelle, datensatz_id, aktion, alt_json, neu_json, schluessel FROM protokoll ORDER BY id",
            )
            .fetch_all(&mut c)
            .await
            .unwrap();
            assert_eq!(
                zeilen,
                vec![
                    (
                        7,
                        "2026-10-13T20:15:00Z".into(),
                        "kunden".into(),
                        3,
                        "neu".into(),
                        None,
                        Some("{\"name\":\"Anna\"}".into()),
                        None
                    ),
                    (
                        9,
                        "2026-10-14T08:00:00Z".into(),
                        "nummernkreise".into(),
                        0,
                        "geaendert".into(),
                        Some("{\"a\":1}".into()),
                        Some("{\"a\":2}".into()),
                        Some("rechnung".into())
                    ),
                ]
            );
            // neue Aktion erlaubt, Unbekanntes weiter abgelehnt; IDs laufen weiter
            let id = sqlx::query("INSERT INTO protokoll (zeitpunkt, tabelle, datensatz_id, aktion, alt_json) VALUES ('x', 'kunden', 3, 'geloescht', '{}')")
                .execute(&mut c)
                .await
                .unwrap()
                .last_insert_rowid();
            assert_eq!(id, 10);
            assert!(
                sqlx::query("INSERT INTO protokoll (zeitpunkt, tabelle, datensatz_id, aktion) VALUES ('x', 'kunden', 3, 'weg')")
                    .execute(&mut c)
                    .await
                    .is_err()
            );
            let indizes: Vec<String> = sqlx::query_scalar(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN
                   ('rechnungen_kunde_id', 'termine_kunde_id', 'fahrten_kunde_id', 'buchungen_rechnung_id') ORDER BY name",
            )
            .fetch_all(&mut c)
            .await
            .unwrap();
            assert_eq!(
                indizes,
                vec![
                    "buchungen_rechnung_id",
                    "fahrten_kunde_id",
                    "rechnungen_kunde_id",
                    "termine_kunde_id"
                ]
            );
            let tabellen: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM sqlite_master WHERE name = 'protokoll_neu'",
            )
            .fetch_one(&mut c)
            .await
            .unwrap();
            assert_eq!(tabellen, 0);
            c.close().await.unwrap();
        });
        let _ = std::fs::remove_dir_all(&ordner);
    }

    /// 0010: vorhandene eigene Vorlagen bleiben und gelten als Kopie des Designs 'klassisch'; neue Zeilen ohne
    /// `basis` ebenso, mit `basis` je Design eine.
    #[test]
    fn migration_vorlagen_basis() {
        let ordner = testordner("vorlagen-basis");
        let db = ordner.join("kladdy.db");
        let davor = MIGRATIONEN
            .iter()
            .position(|m| m.beschreibung == "vorlagen_basis")
            .unwrap();
        tauri::async_runtime::block_on(async {
            migrieren(&db, davor).await;
            let mut c = verbinden(&db).await;
            sqlx::query(
                "INSERT INTO vorlagen (id, name, art, bloecke_json, ist_standard, geaendert_am)
                 VALUES (1, 'Meine Quittung', 'quittung', '[{\"typ\":\"titel\"}]', 1, 'jetzt')",
            )
            .execute(&mut c)
            .await
            .unwrap();
            c.close().await.unwrap();

            migrieren(&db, MIGRATIONEN.len()).await;
            let mut c = verbinden(&db).await;
            let alt: (String, String, String, i64) = sqlx::query_as(
                "SELECT name, basis, bloecke_json, ist_standard FROM vorlagen WHERE id = 1",
            )
            .fetch_one(&mut c)
            .await
            .unwrap();
            assert_eq!(
                alt,
                (
                    "Meine Quittung".into(),
                    "klassisch".into(),
                    "[{\"typ\":\"titel\"}]".into(),
                    1
                )
            );
            sqlx::query(
                "INSERT INTO vorlagen (name, art, bloecke_json, ist_standard, geaendert_am, basis)
                 VALUES ('Meine Quittung (Formular)', 'quittung', '[]', 1, 'jetzt', 'formular')",
            )
            .execute(&mut c)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO vorlagen (name, art, bloecke_json, ist_standard, geaendert_am)
                 VALUES ('Meine Rechnung', 'rechnung', '[]', 1, 'jetzt')",
            )
            .execute(&mut c)
            .await
            .unwrap();
            let basen: Vec<(String, String)> =
                sqlx::query_as("SELECT art, basis FROM vorlagen ORDER BY id")
                    .fetch_all(&mut c)
                    .await
                    .unwrap();
            assert_eq!(
                basen,
                vec![
                    ("quittung".into(), "klassisch".into()),
                    ("quittung".into(), "formular".into()),
                    ("rechnung".into(), "klassisch".into()),
                ]
            );
            c.close().await.unwrap();
        });
        let _ = std::fs::remove_dir_all(&ordner);
    }

    /// 0011: eingeschaltete Kopien des aktiven Designs werden zur aktiven eigenen Vorlage (Einstellung 'eigen:<id>'),
    /// abgeschaltete archiviert; Entwürfe zeigen über `vorlage_id` dieselbe Vorlage wie vorher, ausgestellte bleiben.
    #[test]
    fn migration_vorlagen_eigene() {
        let ordner = testordner("vorlagen-eigene");
        let db = ordner.join("kladdy.db");
        let davor = MIGRATIONEN
            .iter()
            .position(|m| m.beschreibung == "vorlagen_eigene")
            .unwrap();
        tauri::async_runtime::block_on(async {
            migrieren(&db, davor).await;
            let mut c = verbinden(&db).await;
            for sql in [
                // Quittung: aktives Design 'formular' mit Kopie (2), klassische Kopie (1) daneben
                "INSERT INTO vorlagen (id, name, art, bloecke_json, ist_standard, geaendert_am, basis)
                 VALUES (1, 'Meine Quittung', 'quittung', '[]', 1, 'a', 'klassisch')",
                "INSERT INTO vorlagen (id, name, art, bloecke_json, ist_standard, geaendert_am, basis)
                 VALUES (2, 'Meine Quittung (Formular)', 'quittung', '[]', 1, 'a', 'formular')",
                // Rechnung: Kopie abgeschaltet („Zurücksetzen“)
                "INSERT INTO vorlagen (id, name, art, bloecke_json, ist_standard, geaendert_am, basis)
                 VALUES (3, 'Meine Rechnung', 'rechnung', '[]', 0, 'a', 'klassisch')",
                // Angebot: Kopie eingeschaltet, Einstellung ohne Angebot ⇒ 'klassisch'
                "INSERT INTO vorlagen (id, name, art, bloecke_json, ist_standard, geaendert_am, basis)
                 VALUES (4, 'Mein Angebot', 'angebot', '[]', 1, 'a', 'klassisch')",
                "INSERT INTO einstellungen (schluessel, wert) VALUES ('vorlagen_design', '{\"quittung\":\"formular\"}')",
                // Entwürfe: ohne Design (⇒ Kopie 1), mit Design 'formular' (⇒ 2), alte Kopie der Rechnung (⇒ NULL)
                "INSERT INTO rechnungen (id, art, status, vorlage_id, entwurf_json, erstellt_am, geaendert_am)
                 VALUES (10, 'quittung', 'entwurf', NULL, NULL, 'a', 'a')",
                "INSERT INTO rechnungen (id, art, status, vorlage_id, entwurf_json, erstellt_am, geaendert_am)
                 VALUES (11, 'quittung', 'entwurf', NULL, '{\"vorlage_design\":\"formular\"}', 'a', 'a')",
                "INSERT INTO rechnungen (id, art, status, vorlage_id, entwurf_json, erstellt_am, geaendert_am)
                 VALUES (12, 'rechnung', 'entwurf', 3, 'kaputt', 'a', 'a')",
                // ausgestellt: bleibt
                "INSERT INTO rechnungen (id, art, nummer, status, vorlage_id, erstellt_am, geaendert_am)
                 VALUES (13, 'rechnung', 'RE-2026-001', 'offen', 3, 'a', 'a')",
            ] {
                sqlx::query(sql).execute(&mut c).await.unwrap();
            }
            c.close().await.unwrap();

            migrieren(&db, MIGRATIONEN.len()).await;
            let mut c = verbinden(&db).await;
            let archiv: Vec<(i64, i64)> =
                sqlx::query_as("SELECT id, archiviert FROM vorlagen ORDER BY id")
                    .fetch_all(&mut c)
                    .await
                    .unwrap();
            assert_eq!(archiv, vec![(1, 0), (2, 0), (3, 1), (4, 0)]);
            let wert: String = sqlx::query_scalar(
                "SELECT wert FROM einstellungen WHERE schluessel = 'vorlagen_design'",
            )
            .fetch_one(&mut c)
            .await
            .unwrap();
            let wert: serde_json::Value = serde_json::from_str(&wert).unwrap();
            assert_eq!(
                wert,
                serde_json::json!({ "quittung": "eigen:2", "angebot": "eigen:4" })
            );
            let entwuerfe: Vec<(i64, Option<i64>)> =
                sqlx::query_as("SELECT id, vorlage_id FROM rechnungen ORDER BY id")
                    .fetch_all(&mut c)
                    .await
                    .unwrap();
            assert_eq!(
                entwuerfe,
                vec![(10, Some(1)), (11, Some(2)), (12, None), (13, Some(3))]
            );
            assert!(
                sqlx::query("UPDATE vorlagen SET archiviert = 2 WHERE id = 1")
                    .execute(&mut c)
                    .await
                    .is_err()
            );
            c.close().await.unwrap();
        });
        let _ = std::fs::remove_dir_all(&ordner);
    }

    /// 0011 ohne Einstellung: gilt eine klassische Kopie, wird die Einstellung angelegt; ohne Kopien bleibt alles leer.
    #[test]
    fn migration_vorlagen_eigene_ohne_einstellung() {
        let ordner = testordner("vorlagen-eigene-leer");
        let db = ordner.join("kladdy.db");
        let davor = MIGRATIONEN
            .iter()
            .position(|m| m.beschreibung == "vorlagen_eigene")
            .unwrap();
        tauri::async_runtime::block_on(async {
            migrieren(&db, davor).await;
            let mut c = verbinden(&db).await;
            sqlx::query(
                "INSERT INTO vorlagen (id, name, art, bloecke_json, ist_standard, geaendert_am, basis)
                 VALUES (7, 'Meine Rechnung', 'rechnung', '[]', 1, 'a', 'klassisch')",
            )
            .execute(&mut c)
            .await
            .unwrap();
            c.close().await.unwrap();
            migrieren(&db, MIGRATIONEN.len()).await;
            let mut c = verbinden(&db).await;
            let wert: String = sqlx::query_scalar(
                "SELECT wert FROM einstellungen WHERE schluessel = 'vorlagen_design'",
            )
            .fetch_one(&mut c)
            .await
            .unwrap();
            let wert: serde_json::Value = serde_json::from_str(&wert).unwrap();
            assert_eq!(wert, serde_json::json!({ "rechnung": "eigen:7" }));
            c.close().await.unwrap();
        });
        let _ = std::fs::remove_dir_all(&ordner);
    }

    #[test]
    fn migration_kategorien_katalog_und_euer_zuordnung() {
        let ordner = testordner("kategorien");
        let db = ordner.join("kladdy.db");
        // Stelle der Migration in MIGRATIONEN (ihre Nummer steht nur dort und im Dateinamen)
        let davor = MIGRATIONEN
            .iter()
            .position(|m| m.beschreibung == "kategorien")
            .unwrap();
        tauri::async_runtime::block_on(async {
            // Stand davor mit einer Ausgabe in „Sonstige Kosten“
            migrieren(&db, davor).await;
            let mut c = verbinden(&db).await;
            sqlx::query(
                "INSERT INTO buchungen (nummer, typ, zahlungsdatum, betrag_cent, kategorie_id, zahlungsart, beschreibung, erstellt_am, geaendert_am)
                 VALUES ('2026-0001', 'ausgabe', '2026-10-20', 1999, 4, 'bank', 'Handy', 'jetzt', 'jetzt')",
            )
            .execute(&mut c)
            .await
            .unwrap();
            c.close().await.unwrap();

            migrieren(&db, MIGRATIONEN.len()).await;
            let mut c = verbinden(&db).await;
            // Standardkategorien unverändert sichtbar, der Katalog ausgeblendet dahinter
            let kategorien: Vec<(String, i64)> =
                sqlx::query_as("SELECT name, archiviert FROM kategorien ORDER BY sortierung, id")
                    .fetch_all(&mut c)
                    .await
                    .unwrap();
            assert_eq!(
                kategorien,
                vec![
                    ("Dienstleistungen".into(), 0),
                    ("Produkte & Material".into(), 0),
                    ("Sprit & Fahrzeug".into(), 0),
                    ("Sonstige Kosten".into(), 0),
                    ("Abschreibungen (AfA)".into(), 1),
                    ("Bewirtung".into(), 1),
                    ("Geschenke".into(), 1),
                    ("Homeoffice".into(), 1),
                ]
            );
            let bewirtung: (Option<String>, i64) = sqlx::query_as(
                "SELECT euer_bereich, abziehbar_prozent FROM kategorien WHERE name = 'Bewirtung'",
            )
            .fetch_one(&mut c)
            .await
            .unwrap();
            assert_eq!(bewirtung, (Some("Bewirtungsaufwendungen".into()), 70));
            let kategorie: i64 = sqlx::query_scalar("SELECT kategorie_id FROM buchungen")
                .fetch_one(&mut c)
                .await
                .unwrap();
            assert_eq!(kategorie, 4);
            let index: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name = 'buchungen_kategorie_id'",
            )
            .fetch_one(&mut c)
            .await
            .unwrap();
            assert_eq!(index, 1);

            // EÜR-Zuordnung 2026: alle acht Kategorien, Bereich wie die Kategorie, Zeilen leer
            let zuordnung: (i64, i64, i64) = sqlx::query_as(
                "SELECT count(*), count(euer_bereich), count(euer_zeile) FROM euer_zuordnung WHERE jahr = 2026",
            )
            .fetch_one(&mut c)
            .await
            .unwrap();
            assert_eq!(zuordnung, (8, 0, 0));
            // je Jahr und Kategorie eine Zeile, nur bekannte Kategorien, Zeilen 1–999, Jahre 2000–2100
            // (Spalten: jahr, kategorie_id, euer_bereich, euer_zeile)
            for sql in [
                "INSERT INTO euer_zuordnung VALUES (2026, 1, NULL, NULL)",
                "INSERT INTO euer_zuordnung VALUES (2027, 99, NULL, NULL)",
                "INSERT INTO euer_zuordnung VALUES (2027, 1, NULL, 0)",
                "INSERT INTO euer_zuordnung VALUES (2027, 1, NULL, 1000)",
                "INSERT INTO euer_zuordnung VALUES (2027, 1, ' ', NULL)",
                "INSERT INTO euer_zuordnung VALUES (1999, 1, NULL, NULL)",
            ] {
                assert!(sqlx::query(sql).execute(&mut c).await.is_err(), "{sql}");
            }
            sqlx::query("INSERT INTO euer_zuordnung VALUES (2027, 1, 'Sonstige Einnahmen', 12)")
                .execute(&mut c)
                .await
                .unwrap();

            // Je Art bleibt mindestens eine Kategorie sichtbar
            let f = sqlx::query("UPDATE kategorien SET archiviert = 1 WHERE id = 1")
                .execute(&mut c)
                .await
                .map_err(db_fehler)
                .unwrap_err();
            assert!(f.starts_with("Mindestens eine Kategorie je Art"), "{f}");
            sqlx::query("UPDATE kategorien SET archiviert = 1 WHERE id IN (2, 3)")
                .execute(&mut c)
                .await
                .unwrap();
            let f = sqlx::query("UPDATE kategorien SET archiviert = 1 WHERE id = 4")
                .execute(&mut c)
                .await
                .map_err(db_fehler)
                .unwrap_err();
            assert!(f.starts_with("Mindestens eine Kategorie je Art"), "{f}");
            sqlx::query("UPDATE kategorien SET archiviert = 0 WHERE name = 'Bewirtung'")
                .execute(&mut c)
                .await
                .unwrap();
            sqlx::query("UPDATE kategorien SET archiviert = 1 WHERE id = 4")
                .execute(&mut c)
                .await
                .unwrap();
            // Die Art einer benutzten Kategorie steht fest, die einer unbenutzten nicht
            let f = sqlx::query("UPDATE kategorien SET typ = 'einnahme' WHERE id = 4")
                .execute(&mut c)
                .await
                .map_err(db_fehler)
                .unwrap_err();
            assert!(f.starts_with("Die Art einer Kategorie"), "{f}");
            sqlx::query("UPDATE kategorien SET typ = 'einnahme' WHERE name = 'Geschenke'")
                .execute(&mut c)
                .await
                .unwrap();
            c.close().await.unwrap();
        });
        let _ = std::fs::remove_dir_all(&ordner);
    }

    /// SHA-256 des SQL-Texts jeder ausgelieferten Migration. Ausgelieferte Migrationen NIE ändern: sqlx merkt sich
    /// je Version eine Prüfsumme und verweigert sonst das Öffnen der Datenbank (die App wirkt dann leer). Schlägt
    /// dieser Test fehl, wurde eine alte Datei geändert ⇒ Änderung zurücknehmen und als neue Migration anhängen.
    /// Neue Migration ⇒ ihren Hash hier ergänzen (`shasum -a 256 src-tauri/migrations/00NN_*.sql`).
    const PRUEFSUMMEN: &[(i64, &str)] = &[
        (
            1,
            "4fbc9680ba2ad8b2d3142bfa46ceb2e32022e4a7928da2cd31365d1d77cb04a7",
        ),
        (
            2,
            "e7096aa13d994841f9dbffa39f7e3cf72ea9feea242b37e37de0b055e0ba2773",
        ),
        (
            3,
            "a4b1f2b071ea2a15aff0ccdaaf858f775523a219961cfe1b636b0e098abb2ee2",
        ),
        (
            4,
            "bdaacd8ffc95155913c21f31ca945a66cf5e6628c62d3d1522eea5e874613020",
        ),
        (
            5,
            "ac5bfd0710eb332d52eca66dc3b06b5a9083267bd3d0dcb45a792e4a1e71c361",
        ),
        (
            6,
            "decf264a16779259c1b7afd8e1fa8a0f18238b6562ff2bd3868104cd4fafa701",
        ),
        (
            7,
            "1365c6fb6ea477dbfead5c1022aae99dec811754a9b5423fb2d40402d306dff5",
        ),
        (
            8,
            "4d03ddc28c9294f339c37897bb7d4e5411b9ab28220ba558cfcc587dcf3449f0",
        ),
        (
            9,
            "b4d63d2474badb02ea4e1d24d0f01dcde95ef9e1a1ace7bb7c84b527681b786c",
        ),
        (
            10,
            "773ce660841ec963d20538b7339588514617d54be709fde8ea9ff43d290f01ea",
        ),
        (
            11,
            "69ad5dd163de6fc2f3f2eb4d329ad1a0f05f3a2eaeec4821cbe1708f20f03e20",
        ),
        (
            12,
            "1502a36314af754f565e86deaf2f566bdbb031af09639114a2f2b11f22cc02b5",
        ),
    ];

    #[test]
    fn ausgelieferte_migrationen_unveraendert() {
        use sha2::{Digest, Sha256};
        assert_eq!(
            MIGRATIONEN.len(),
            PRUEFSUMMEN.len(),
            "Neue Migration? Ihren SHA-256 in PRUEFSUMMEN ergänzen."
        );
        for (m, (version, soll)) in MIGRATIONEN.iter().zip(PRUEFSUMMEN) {
            assert_eq!(m.version, *version);
            let ist: String = Sha256::digest(m.sql.as_bytes())
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            assert_eq!(
                ist, *soll,
                "Migration {version} wurde nach der Auslieferung geändert. Nie ändern, neue Migration anhängen!"
            );
        }
    }

    /// Spalten je Nutztabelle (ohne sqlx- und SQLite-eigene Tabellen).
    type Spalten = std::collections::BTreeMap<String, Vec<String>>;
    /// Tabelle ⇒ Primärschlüssel ⇒ Spalte ⇒ Wert (als SQL-Literal über `quote()`, so ist NULL von 'NULL' verschieden).
    type Abbild = std::collections::BTreeMap<
        String,
        std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>,
    >;

    async fn spalten_lesen(c: &mut SqliteConnection) -> Spalten {
        let tabellen: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_sqlx_migrations' ORDER BY name",
        )
        .fetch_all(&mut *c)
        .await
        .unwrap();
        let mut spalten = Spalten::new();
        for t in tabellen {
            let namen: Vec<String> =
                sqlx::query_scalar("SELECT name FROM pragma_table_info(?) ORDER BY cid")
                    .bind(&t)
                    .fetch_all(&mut *c)
                    .await
                    .unwrap();
            spalten.insert(t, namen);
        }
        spalten
    }

    /// Liest alle Zeilen der Tabellen in `spalten` (nur diese Spalten), Schlüssel = Primärschlüssel (sonst rowid).
    async fn abbild(c: &mut SqliteConnection, spalten: &Spalten) -> Abbild {
        use sqlx::Row;
        let mut abbild = Abbild::new();
        for (t, namen) in spalten {
            let pk: Vec<String> = sqlx::query_scalar(
                "SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk",
            )
            .bind(t)
            .fetch_all(&mut *c)
            .await
            .unwrap();
            let schluessel = if pk.is_empty() {
                "quote(rowid)".to_string()
            } else {
                pk.iter()
                    .map(|p| format!("quote(\"{p}\")"))
                    .collect::<Vec<_>>()
                    .join(" || '|' || ")
            };
            let werte: Vec<String> = namen.iter().map(|n| format!("quote(\"{n}\")")).collect();
            let sql = format!("SELECT {schluessel}, {} FROM \"{t}\"", werte.join(", "));
            let zeilen = sqlx::query(&sql).fetch_all(&mut *c).await.unwrap();
            let mut tabelle = std::collections::BTreeMap::new();
            for z in zeilen {
                let k: String = z.get(0);
                let felder = namen
                    .iter()
                    .enumerate()
                    .map(|(i, n)| (n.clone(), z.get::<String, _>(i + 1)))
                    .collect();
                tabelle.insert(k, felder);
            }
            abbild.insert(t.clone(), tabelle);
        }
        abbild
    }

    /// Repräsentative Daten auf Schemastand `k` (nur Tabellen und Spalten, die es dann schon gibt), in der
    /// Reihenfolge, in der die App sie schreibt (Positionen vor der Nummer, Belege vor dem PDF-Verweis).
    async fn fuellen(c: &mut SqliteConnection, k: usize) {
        let mut sql: Vec<&str> = vec![
            "INSERT INTO einstellungen (schluessel, wert) VALUES
               ('firma', '{\"name\":\"Gartenservice Müller\",\"iban\":\"DE02120300000000202051\"}'),
               ('beleg_art', '\"quittung\"'),
               ('vorlagen_design', '{\"quittung\":\"klassisch\"}')",
            "INSERT INTO steuer_parameter (jahr, schluessel, wert) VALUES (2027, 'ku_grenze_vorjahr_cent', '2500000')",
            "UPDATE steuer_parameter SET wert = '2600000' WHERE jahr = 2026 AND schluessel = 'ku_grenze_vorjahr_cent'",
            "INSERT INTO kategorien (id, name, typ, euer_bereich, sortierung) VALUES (50, 'Werbung', 'ausgabe', 'Übrige Betriebsausgaben', 9)",
            "UPDATE kategorien SET stichworte = 'rasen,hecke,garten' WHERE id = 1",
            "INSERT INTO kunden (id, nummer, name, strasse, plz, ort, email, notiz, erstellt_am) VALUES
               (1, 'K-0001', 'Anna Schmidt', 'Lindenweg 3', '12345', 'Musterstadt', 'anna@example.org', 'Hund im Garten', '2026-01-05T09:00:00Z'),
               (2, 'K-0002', 'Müller & Söhne 100%', NULL, NULL, NULL, NULL, NULL, '2026-02-01T09:00:00Z')",
            "UPDATE nummernkreise SET jahr = 2026, naechste = 5 WHERE id = 'buchung'",
            "UPDATE nummernkreise SET naechste = 3 WHERE id = 'kunde'",
            "UPDATE nummernkreise SET jahr = 2026, naechste = 2 WHERE id = 'quittung'",
            "INSERT INTO termine (id, kunde_id, datum, von, bis, adresse, leistung, betrag_geschaetzt_cent, status, erstellt_am, geaendert_am)
               VALUES (1, 1, '2026-03-02', '09:00', '11:00', 'Lindenweg 3', 'Hecke schneiden', 8000, 'erledigt', 'a', 'a')",
            "INSERT INTO vorlagen (id, name, art, bloecke_json, ist_standard, geaendert_am) VALUES
               (1, 'Meine Rechnung', 'rechnung', '[{\"typ\":\"kopf\",\"logo\":true}]', 1, '2026-02-01T10:00:00Z'),
               (2, 'Meine Quittung', 'quittung', '[{\"typ\":\"titel\"}]', 0, '2026-02-02T10:00:00Z')",
            "INSERT INTO vorlagen_assets (id, vorlage_id, dateiname, pfad) VALUES (1, 1, 'logo.png', 'assets/logo-1.png')",
            "INSERT INTO rechnungen (id, art, status, kunde_id, datum, summe_cent, termin_id, erstellt_am, geaendert_am)
               VALUES (1, 'quittung', 'entwurf', 1, '2026-03-02', 12345, 1, 'a', 'a')",
            "INSERT INTO rechnungspositionen (id, rechnung_id, pos, beschreibung, menge, einheit, einzelpreis_cent, kategorie_id) VALUES
               (1, 1, 1, 'Hecke schneiden', 1.5, 'Std.', 4500, 1),
               (2, 1, 2, 'Grünschnitt entsorgen', 1, NULL, 5595, 1)",
            "INSERT INTO rechnungen (id, art, status, kunde_id, betreff, summe_cent, erstellt_am, geaendert_am)
               VALUES (2, 'rechnung', 'entwurf', 2, 'Winterdienst', 30000, 'a', 'a')",
            "INSERT INTO rechnungspositionen (id, rechnung_id, pos, beschreibung, menge, einzelpreis_cent) VALUES (3, 2, 1, 'Winterdienst Dezember', 1, 30000)",
            "INSERT INTO anlagen (id, bezeichnung, anschaffung_datum, kosten_cent, nutzungsdauer_jahre) VALUES (1, 'Rasenmäher', '2026-01-10', 100000, 4)",
            "INSERT INTO wiederkehrend (id, vorlage_json, rhythmus, naechstes_datum) VALUES (1, '{\"betrag_cent\":2999}', 'monatlich', '2026-04-01')",
            "INSERT INTO buchungen (id, nummer, typ, zahlungsdatum, belegdatum, betrag_cent, kategorie_id, kunde_id, zahlungsart, belegnummer, beschreibung, rechnung_id, termin_id, erstellt_am, geaendert_am)
               VALUES (1, '2026-0001', 'einnahme', '2026-03-02', '2026-03-02', 12345, 1, 1, 'bar', 'QU-2026-001', 'Hecke schneiden', 1, 1, 'a', 'a')",
            "INSERT INTO buchungen (id, nummer, typ, zahlungsdatum, betrag_cent, kategorie_id, lieferant, zahlungsart, beschreibung, wiederkehrend_id, erstellt_am, geaendert_am) VALUES
               (2, '2026-0002', 'ausgabe', '2026-03-05', 6789, 3, 'Aral Tankstelle', 'bank', 'Diesel', 1, 'a', 'a'),
               (3, '2026-0003', 'ausgabe', '2026-03-05', 6789, 3, 'Aral Tankstelle', 'bank', 'Diesel', NULL, 'a', 'a')",
            "UPDATE buchungen SET storno_von_id = 2 WHERE id = 3",
            "INSERT INTO buchungen (id, nummer, typ, zahlungsdatum, betrag_cent, kategorie_id, art, zahlungsart, beschreibung, anlage_id, erstellt_am, geaendert_am)
               VALUES (4, '2026-0004', 'ausgabe', '2026-12-31', 25000, 4, 'afa', NULL, 'AfA Rasenmäher', 1, 'a', 'a')",
            "INSERT INTO belege (id, buchung_id, pfad, originalname, mime, sha256, groesse, art, aufbewahren_bis, erstellt_am)
               VALUES (1, 2, '2026/aa11.pdf', 'tankbeleg.pdf', 'application/pdf', 'aa11', 2048, 'beleg', '2034-12-31', 'a')",
            "INSERT INTO belege (id, rechnung_id, pfad, mime, sha256, groesse, art, aufbewahren_bis, erstellt_am)
               VALUES (2, 1, '2026/bb22.pdf', 'application/pdf', 'bb22', 4096, 'rechnung_pdf', '2036-12-31', 'a')",
            "INSERT INTO planposten (id, datum, text, betrag_cent) VALUES (1, '2026-04-15', 'Kfz-Versicherung', -45000)",
            "INSERT INTO fahrten (id, datum, start, ziel, zweck, km, kunde_id) VALUES (1, '2026-03-02', 'Büro', 'Lindenweg 3', 'Hecke', 12.5, 1)",
            "INSERT INTO variablen (name, wert, beschreibung) VALUES ('stundensatz', '45', 'Stundensatz in €')",
            "INSERT INTO kennzahlen (id, name, formel, format, angeheftet) VALUES (1, 'Marge', 'gewinn / einnahmen', 'prozent', 1)",
        ];
        if k >= 7 {
            sql.push("UPDATE rechnungen SET zahlungsart = 'bar', entwurf_json = '{\"herkunft\":\"termin\"}' WHERE id = 1");
            sql.push("UPDATE rechnungen SET entwurf_json = '{\"vorlage_design\":\"klassisch\"}' WHERE id = 2");
        }
        sql.push(
            "UPDATE rechnungen SET nummer = 'QU-2026-001', status = 'bezahlt', kunde_name = 'Anna Schmidt',
               kunde_adresse = 'Lindenweg 3, 12345 Musterstadt', kunde_nummer = 'K-0001', bezahlt_am = '2026-03-02',
               pdf_beleg_id = 2, snapshot_json = '{\"nummer\":\"QU-2026-001\"}' WHERE id = 1",
        );
        if k >= 3 {
            sql.push(
                "INSERT INTO protokoll (id, zeitpunkt, tabelle, datensatz_id, aktion, alt_json, neu_json, schluessel) VALUES
                   (1, '2026-03-02T10:00:00Z', 'buchungen', 1, 'neu', NULL, '{\"betrag_cent\":12345}', NULL),
                   (2, '2026-03-06T10:00:00Z', 'buchungen', 2, 'storniert', '{\"betrag_cent\":6789}', NULL, NULL),
                   (3, '2026-01-02T08:00:00Z', 'einstellungen', 0, 'geaendert', '{}', '{\"name\":\"Gartenservice Müller\"}', 'firma')",
            );
        } else {
            sql.push(
                "INSERT INTO protokoll (id, zeitpunkt, tabelle, datensatz_id, aktion, alt_json, neu_json) VALUES
                   (1, '2026-03-02T10:00:00Z', 'buchungen', 1, 'neu', NULL, '{\"betrag_cent\":12345}'),
                   (2, '2026-03-06T10:00:00Z', 'buchungen', 2, 'storniert', '{\"betrag_cent\":6789}', NULL)",
            );
        }
        if k >= 8 {
            sql.push("INSERT INTO euer_zuordnung (jahr, kategorie_id, euer_bereich, euer_zeile) VALUES (2027, 1, NULL, 12)");
            sql.push(
                "UPDATE euer_zuordnung SET euer_zeile = 20 WHERE jahr = 2026 AND kategorie_id = 3",
            );
        }
        if k >= 10 {
            sql.push(
                "INSERT INTO vorlagen (id, name, art, bloecke_json, ist_standard, geaendert_am, basis)
                   VALUES (3, 'Meine Quittung (Formular)', 'quittung', '[]', 1, '2026-02-03T10:00:00Z', 'formular')",
            );
        }
        if k >= 11 {
            // Stand nach 0011, so wie ihn die Migration aus den Daten oben erzeugt hätte (abgeschaltete Kopie
            // archiviert, aktive eigene Rechnungsvorlage, Entwurf mit vorlage_id)
            sql.push("UPDATE vorlagen SET archiviert = 1 WHERE ist_standard = 0");
            sql.push(
                "UPDATE einstellungen SET wert = '{\"quittung\":\"klassisch\",\"rechnung\":\"eigen:1\"}' WHERE schluessel = 'vorlagen_design'",
            );
            sql.push("UPDATE rechnungen SET vorlage_id = 1 WHERE id = 2");
        }
        sql.push("INSERT INTO festschreibungen (bis_datum, am) VALUES ('2025-12-31', '2026-01-10T08:00:00Z')");
        for s in sql {
            sqlx::query(s)
                .execute(&mut *c)
                .await
                .unwrap_or_else(|e| panic!("Stand {k}: {e}\n{s}"));
        }
    }

    /// Upgrade von jedem früheren Schemastand auf den neuesten: keine Zeile geht verloren, kein vorhandener Wert
    /// ändert sich – außer den beabsichtigten Umstellungen aus 0011 (aktive eigene Vorlage in `vorlagen_design`,
    /// `vorlage_id` der Entwürfe), die von Ständen vor 0011 genau so erwartet werden. 0012 ändert nur Trigger.
    #[test]
    fn upgrade_von_jedem_stand_verliert_nichts() {
        let neueste = MIGRATIONEN.len();
        for k in 2..neueste {
            let ordner = testordner(&format!("upgrade-{k}"));
            let db = ordner.join("kladdy.db");
            tauri::async_runtime::block_on(async {
                migrieren(&db, k).await;
                let mut c = verbinden(&db).await;
                fuellen(&mut c, k).await;
                let spalten = spalten_lesen(&mut c).await;
                let vorher = abbild(&mut c, &spalten).await;
                c.close().await.unwrap();

                migrieren(&db, neueste).await;
                let mut c = verbinden(&db).await;
                let nachher = abbild(&mut c, &spalten).await;

                // Keine Zeile fehlt (neue, z. B. Kategorien aus 0008, dürfen dazukommen); Unterschiede sammeln
                let mut unterschiede = Vec::new();
                for (t, zeilen) in &vorher {
                    let neu = &nachher[t];
                    let fehlen: Vec<&String> =
                        zeilen.keys().filter(|s| !neu.contains_key(*s)).collect();
                    assert!(fehlen.is_empty(), "Stand {k}: in {t} fehlen {fehlen:?}");
                    for (schluessel, felder) in zeilen {
                        for (spalte, wert) in felder {
                            let w = &neu[schluessel][spalte];
                            if w != wert {
                                unterschiede
                                    .push(format!("{t}[{schluessel}].{spalte}: {wert} ⇒ {w}"));
                            }
                        }
                    }
                }
                let erwartet: Vec<String> = if k < 11 {
                    vec![
                        "einstellungen['vorlagen_design'].wert: '{\"quittung\":\"klassisch\"}' ⇒ '{\"quittung\":\"klassisch\",\"rechnung\":\"eigen:1\"}'".to_string(),
                        "rechnungen[2].vorlage_id: NULL ⇒ 1".to_string(),
                    ]
                } else {
                    Vec::new()
                };
                assert_eq!(unterschiede, erwartet, "Stand {k}");
                for t in [
                    "buchungen",
                    "kunden",
                    "rechnungen",
                    "rechnungspositionen",
                    "belege",
                    "einstellungen",
                    "vorlagen",
                    "protokoll",
                ] {
                    assert!(!vorher[t].is_empty(), "Stand {k}: {t} ohne Testdaten");
                }

                // Stichproben: Beträge, Nummern, Namen
                let buchungen: Vec<(String, i64, Option<i64>)> = sqlx::query_as(
                    "SELECT nummer, betrag_cent, storno_von_id FROM buchungen ORDER BY id",
                )
                .fetch_all(&mut c)
                .await
                .unwrap();
                assert_eq!(
                    buchungen,
                    vec![
                        ("2026-0001".into(), 12345, None),
                        ("2026-0002".into(), 6789, None),
                        ("2026-0003".into(), 6789, Some(2)),
                        ("2026-0004".into(), 25000, None),
                    ]
                );
                let quittung: (String, String, i64, String) = sqlx::query_as(
                    "SELECT nummer, kunde_name, summe_cent, status FROM rechnungen WHERE id = 1",
                )
                .fetch_one(&mut c)
                .await
                .unwrap();
                assert_eq!(
                    quittung,
                    (
                        "QU-2026-001".into(),
                        "Anna Schmidt".into(),
                        12345,
                        "bezahlt".into()
                    )
                );
                let positionen: f64 = sqlx::query_scalar(
                    "SELECT sum(menge * einzelpreis_cent) FROM rechnungspositionen WHERE rechnung_id = 1",
                )
                .fetch_one(&mut c)
                .await
                .unwrap();
                assert_eq!(positionen, 12345.0);
                let kunden: Vec<String> = sqlx::query_scalar("SELECT name FROM kunden ORDER BY id")
                    .fetch_all(&mut c)
                    .await
                    .unwrap();
                assert_eq!(kunden, vec!["Anna Schmidt", "Müller & Söhne 100%"]);
                let belege: Vec<String> =
                    sqlx::query_scalar("SELECT sha256 FROM belege ORDER BY id")
                        .fetch_all(&mut c)
                        .await
                        .unwrap();
                assert_eq!(belege, vec!["aa11", "bb22"]);
                let vorlagen: Vec<(i64, String, i64)> =
                    sqlx::query_as("SELECT id, name, archiviert FROM vorlagen ORDER BY id")
                        .fetch_all(&mut c)
                        .await
                        .unwrap();
                assert_eq!(vorlagen[0], (1, "Meine Rechnung".into(), 0));
                assert_eq!(
                    vorlagen[1],
                    (2, "Meine Quittung".into(), 1),
                    "abgeschaltete Kopie ⇒ archiviert"
                );
                let kunde_nr: i64 =
                    sqlx::query_scalar("SELECT naechste FROM nummernkreise WHERE id = 'kunde'")
                        .fetch_one(&mut c)
                        .await
                        .unwrap();
                assert_eq!(kunde_nr, 3);
                // Schema stimmig, Datei heil, neuester Stand
                assert!(
                    sqlx::query("PRAGMA foreign_key_check")
                        .fetch_all(&mut c)
                        .await
                        .unwrap()
                        .is_empty(),
                    "Stand {k}: Fremdschlüssel verletzt"
                );
                let heil: String = sqlx::query_scalar("PRAGMA integrity_check")
                    .fetch_one(&mut c)
                    .await
                    .unwrap();
                assert_eq!(heil, "ok");
                let stand: i64 = sqlx::query_scalar("SELECT max(version) FROM _sqlx_migrations")
                    .fetch_one(&mut c)
                    .await
                    .unwrap();
                assert_eq!(stand, neueste as i64);
                // 0012 greift: Datei von der (offenen) Buchung lösen geht, auf eine andere hängen nicht
                sqlx::query("UPDATE belege SET buchung_id = NULL WHERE id = 1")
                    .execute(&mut c)
                    .await
                    .unwrap_or_else(|e| panic!("Stand {k}: {e}"));
                assert!(
                    sqlx::query("UPDATE belege SET buchung_id = 2 WHERE id = 1")
                        .execute(&mut c)
                        .await
                        .is_err(),
                    "Stand {k}"
                );
                // ... und sonst bleibt die Zeile unveränderlich, bei festgeschriebener Buchung auch die Verknüpfung
                sqlx::query(
                    "INSERT INTO belege (id, buchung_id, pfad, mime, sha256, groesse, art, aufbewahren_bis, erstellt_am)
                       VALUES (3, 3, '2026/cc33.pdf', 'application/pdf', 'cc33', 1024, 'beleg', '2034-12-31', 'a')",
                )
                .execute(&mut c)
                .await
                .unwrap_or_else(|e| panic!("Stand {k}: {e}"));
                assert!(
                    sqlx::query("UPDATE belege SET buchung_id = NULL, pfad = 'x' WHERE id = 3")
                        .execute(&mut c)
                        .await
                        .is_err(),
                    "Stand {k}"
                );
                sqlx::query(
                    "INSERT INTO festschreibungen (bis_datum, am) VALUES ('2026-03-31', 'b')",
                )
                .execute(&mut c)
                .await
                .unwrap_or_else(|e| panic!("Stand {k}: {e}"));
                assert!(
                    sqlx::query("UPDATE belege SET buchung_id = NULL WHERE id = 3")
                        .execute(&mut c)
                        .await
                        .is_err(),
                    "Stand {k}: festgeschrieben"
                );
                c.close().await.unwrap();
            });
            let _ = std::fs::remove_dir_all(&ordner);
        }
    }

    #[test]
    fn iso_zeitstempel_wie_im_frontend() {
        assert_eq!(utc_iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(utc_iso(1_791_929_700), "2026-10-13T22:15:00Z");
        assert_eq!(utc_iso(951_825_600), "2000-02-29T12:00:00Z");
        assert_eq!(zeitstempel().len(), 20);
    }

    #[test]
    fn keine_sicherung_ohne_datei_oder_bei_leerer_datei() {
        let ordner = testordner("ohne-datei");
        let db = ordner.join("fehlt.db");
        let ziel = ordner.join("sicherungen");
        assert_eq!(sichern_vor_migration(&db, &ziel, &versionen(), 0), Ok(None));
        std::fs::write(&db, b"").unwrap();
        assert_eq!(sichern_vor_migration(&db, &ziel, &versionen(), 0), Ok(None));
        assert!(!ziel.exists());
        let _ = std::fs::remove_dir_all(&ordner);
    }

    #[test]
    fn keine_sicherung_wenn_alles_migriert() {
        let ordner = testordner("aktuell");
        let db = ordner.join("kladdy.db");
        let ziel = ordner.join("sicherungen");
        tauri::async_runtime::block_on(migrieren(&db, MIGRATIONEN.len()));
        assert_eq!(sichern_vor_migration(&db, &ziel, &versionen(), 0), Ok(None));
        assert!(!ziel.exists());
        let _ = std::fs::remove_dir_all(&ordner);
    }

    #[test]
    fn sicherung_vor_offener_migration() {
        let ordner = testordner("offen");
        let db = ordner.join("kladdy.db");
        let ziel = ordner.join("sicherungen");
        // Stand einer älteren App-Version: nur 0001 angewendet, dazu ein Kunde
        tauri::async_runtime::block_on(async {
            migrieren(&db, 1).await;
            let mut c = verbinden(&db).await;
            sqlx::query("INSERT INTO kunden (nummer, name, erstellt_am) VALUES ('K-0001', 'Anna Schmidt', '2026-10-13')")
                .execute(&mut c)
                .await
                .unwrap();
            c.close().await.unwrap();
        });

        let kopie = sichern_vor_migration(&db, &ziel, &versionen(), 1_791_929_700)
            .unwrap()
            .expect("Sicherung erwartet");
        assert_eq!(
            kopie,
            ziel.join("kladdy-vor-migration-0002-20261013-221500.db")
        );

        tauri::async_runtime::block_on(async {
            let mut c = verbinden(&kopie).await;
            let name: String =
                sqlx::query_scalar("SELECT name FROM kunden WHERE nummer = 'K-0001'")
                    .fetch_one(&mut c)
                    .await
                    .unwrap();
            assert_eq!(name, "Anna Schmidt");
            let stand: i64 = sqlx::query_scalar("SELECT max(version) FROM _sqlx_migrations")
                .fetch_one(&mut c)
                .await
                .unwrap();
            assert_eq!(stand, 1, "Kopie zeigt den Stand vor der Migration");
            c.close().await.unwrap();
        });

        // Danach migriert die App; ein zweiter Start sichert nicht erneut
        tauri::async_runtime::block_on(migrieren(&db, MIGRATIONEN.len()));
        assert_eq!(
            sichern_vor_migration(&db, &ziel, &versionen(), 1_791_929_800),
            Ok(None)
        );
        let _ = std::fs::remove_dir_all(&ordner);
    }

    #[test]
    fn vorhandene_sicherung_wird_nicht_ueberschrieben() {
        let ordner = testordner("vorhanden");
        let db = ordner.join("kladdy.db");
        let ziel = ordner.join("sicherungen");
        tauri::async_runtime::block_on(migrieren(&db, 1));
        let erste = sichern_vor_migration(&db, &ziel, &versionen(), 5).unwrap();
        assert!(erste.is_some());
        // gleicher Zeitstempel ⇒ VACUUM INTO verweigert, statt die Kopie zu ersetzen
        assert!(sichern_vor_migration(&db, &ziel, &versionen(), 5).is_err());
        let _ = std::fs::remove_dir_all(&ordner);
    }

    #[test]
    fn echte_datei_nur_nach_sicherung_freigeben() {
        let echt = url_zu(DB_DATEI);
        assert_eq!(url_freigeben(echt.clone(), None), Ok(echt.clone()));
        assert_eq!(url_freigeben(echt, Some("kaputt")), Err("kaputt".into()));
        // andere Dateien (die Demo-Datei im Debug-Build) werden nicht gesichert und bleiben erreichbar
        let andere = "sqlite:andere.db".to_string();
        assert_eq!(url_freigeben(andere.clone(), Some("kaputt")), Ok(andere));
    }

    /// Statt still abzubrechen startet die App mit Meldung; die echte Datei gibt `datenbank_url` dann nicht heraus,
    /// ohne Laden migriert das SQL-Plugin nicht. Nach einem Neustart mit genug Platz geht es normal weiter.
    #[test]
    fn fehlgeschlagene_sicherung_sperrt_die_datenbank() {
        let ordner = testordner("sicherung-fehlt");
        let db = ordner.join(DB_DATEI);
        // Ziel unter einer Datei statt in einem Ordner: Anlegen scheitert (wie bei fehlenden Schreibrechten)
        let sperre = ordner.join("kein-ordner");
        std::fs::write(&sperre, b"x").unwrap();
        let ziel = sperre.join("sicherungen");
        tauri::async_runtime::block_on(migrieren(&db, 1));

        let meldung = sicherung_beim_start(&db, &ziel, &versionen(), 0).unwrap();
        let teile = [
            format!("fehlgeschlagen: Ordner anlegen ({}): ", ziel.display()),
            "os error".to_string(),
            "Speicherplatz freigeben".to_string(),
            format!("Schreibrechte für den Ordner {} prüfen", ordner.display()),
            "Kladdy neu starten".to_string(),
            format!("Datenbank: {}", db.display()),
        ];
        for teil in &teile {
            assert!(meldung.contains(teil), "„{teil}“ fehlt in: {meldung}");
        }
        assert_eq!(
            url_freigeben(url_zu(DB_DATEI), Some(meldung.as_str())),
            Err(meldung.clone())
        );
        tauri::async_runtime::block_on(async {
            let mut c = verbinden(&db).await;
            let stand: i64 = sqlx::query_scalar("SELECT max(version) FROM _sqlx_migrations")
                .fetch_one(&mut c)
                .await
                .unwrap();
            assert_eq!(stand, 1, "ohne Sicherung keine Migration");
            c.close().await.unwrap();
        });

        // Platz geschaffen, neu gestartet: jetzt wird gesichert, keine Meldung mehr
        std::fs::remove_file(&sperre).unwrap();
        assert_eq!(sicherung_beim_start(&db, &ziel, &versionen(), 0), None);
        assert!(ziel.join(sicherungs_name(DB_DATEI, 2, 0)).is_file());
        let _ = std::fs::remove_dir_all(&ordner);
    }

    /// Demo-Modus (nur Debug): Die echte Datei wird nicht geladen, bleibt also unmigriert. Jeder Start sichert sie
    /// dann erneut, bis sie wieder geladen und migriert ist; eine Migration ohne vorherige Sicherung gibt es so nie.
    #[test]
    fn unmigrierte_datei_wird_bei_jedem_start_gesichert() {
        let ordner = testordner("demo-start");
        let db = ordner.join(DB_DATEI);
        let ziel = ordner.join("sicherungen");
        tauri::async_runtime::block_on(migrieren(&db, 1));
        let erster_start = sichern_vor_migration(&db, &ziel, &versionen(), 10).unwrap();
        let zweiter_start = sichern_vor_migration(&db, &ziel, &versionen(), 20).unwrap();
        assert!(erster_start.is_some() && zweiter_start.is_some());
        assert_ne!(erster_start, zweiter_start);
        let name = zweiter_start.unwrap();
        let name = name.file_name().unwrap().to_str().unwrap();
        assert!(name.starts_with(DB_DATEI.strip_suffix(".db").unwrap()));
        assert!(!name.contains("demo"));
        let _ = std::fs::remove_dir_all(&ordner);
    }
}
