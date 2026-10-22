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
//!   `db-sicherung` beim Start eine Kopie per `VACUUM INTO` an. Schlägt das fehl, startet die App nicht
//!   (lieber kein Start als eine Migration ohne Sicherung).

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

/// Dateiname der Datenbank. Einzige Quelle; das Frontend fragt ihn über `datenbank_url` ab.
pub const DB_DATEI: &str = if cfg!(debug_assertions) {
    "kladdy-dev.db"
} else {
    "kladdy.db"
};

/// Unterordner (im App-Verzeichnis) für die Kopien vor einer Migration.
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

/// Für das Frontend (src/lib/db.ts): welche Datenbank geladen wird. Muss exakt der URL entsprechen,
/// unter der die Migrationen registriert sind.
#[tauri::command]
pub fn datenbank_url() -> String {
    db_url()
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
pub fn sicherungs_plugin<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("db-sicherung")
        .setup(|app, _api| {
            let ordner = app.path().app_config_dir()?;
            let db = ordner.join(DB_DATEI);
            let ziel = ordner.join(SICHERUNGS_ORDNER);
            let versionen: Vec<i64> = MIGRATIONEN.iter().map(|m| m.version).collect();
            match sichern_vor_migration(&db, &ziel, &versionen, jetzt_sekunden()) {
                Ok(Some(kopie)) => eprintln!("Sicherung vor Migration: {}", kopie.display()),
                Ok(None) => {}
                Err(e) => {
                    eprintln!("Sicherung vor Migration fehlgeschlagen: {e}");
                    return Err(e.into());
                }
            }
            Ok(())
        })
        .build()
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

fn jetzt_sekunden() -> u64 {
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
fn utc_teile(sekunden: u64) -> (i64, i64, i64, u64, u64, u64) {
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
pub fn sichern_vor_migration(
    db: &Path,
    ordner: &Path,
    bekannt: &[i64],
    sekunden: u64,
) -> Result<Option<PathBuf>, String> {
    let groesse = match std::fs::metadata(db) {
        Ok(m) => m.len(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{}: {e}", db.display())),
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
            .map_err(|e| format!("Datenbank öffnen: {e}"))?;
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
    std::fs::create_dir_all(ordner).map_err(|e| format!("{}: {e}", ordner.display()))?;
    let name = db.file_name().and_then(|n| n.to_str()).unwrap_or(DB_DATEI);
    let ziel = ordner.join(sicherungs_name(name, erste, sekunden));
    let ziel_text = ziel
        .to_str()
        .ok_or_else(|| format!("Pfad nicht als UTF-8 darstellbar: {}", ziel.display()))?;
    sqlx::query("VACUUM INTO ?")
        .bind(ziel_text)
        .execute(&mut *verbindung)
        .await
        .map_err(|e| format!("Sicherung nach {}: {e}", ziel.display()))?;
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::migrate::Migrator;

    /// Eigener leerer Ordner je Test (ohne tempfile-Crate).
    fn testordner(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("kladdy-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    async fn verbinden(pfad: &Path) -> SqliteConnection {
        SqliteConnectOptions::new()
            .filename(pfad)
            .create_if_missing(true)
            .connect()
            .await
            .unwrap()
    }

    /// Wendet die ersten `bis` Migrationen an.
    async fn migrieren(pfad: &Path, bis: usize) {
        let mut c = verbinden(pfad).await;
        let migrator = Migrator::new(MigrationsQuelle(MIGRATIONEN.iter().take(bis).collect()))
            .await
            .unwrap();
        migrator.run_direct(&mut c).await.unwrap();
        c.close().await.unwrap();
    }

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
            let gesperrt = "Belege werden nie geändert (GoBD). Nur die Aufbewahrungsfrist kann verlängert werden.";
            for sql in [
                "UPDATE belege SET pfad = '2026/cd.pdf'",
                "UPDATE belege SET sha256 = 'cd'",
                "UPDATE belege SET originalname = NULL",
                "UPDATE belege SET groesse = 4",
                "UPDATE belege SET buchung_id = NULL",
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
