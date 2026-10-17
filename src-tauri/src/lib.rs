//! Kladdy – Tauri-Hülle.
//! Hier werden Plugins, die native Menüleiste und Commands registriert.

mod belege;
mod buchungen;
mod datenbank;
mod kunden;
mod nummern;

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

/// Name des Events, über das Menü-Klicks an das Frontend gehen. Nutzlast: die ID des Menüpunkts.
const MENU_EVENT: &str = "menu";

/// IDs der eigenen Menüpunkte. Das Frontend (src/lib/menu.ts) kennt dieselben IDs.
const MENU_IDS: &[&str] = &[
    "ueber",
    "erfassen",
    "quittung",
    "rechnung",
    "importieren",
    "export",
    "updates",
    "hell-dunkel",
    "seitenleiste",
];

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str, accel: Option<&str>| {
        let b = MenuItemBuilder::with_id(id, text);
        match accel {
            Some(a) => b.accelerator(a).build(app),
            None => b.build(app),
        }
    };

    let ueber = item("ueber", "Über Kladdy", None)?;
    let app_menu = SubmenuBuilder::new(app, "Kladdy")
        .item(&ueber)
        .separator()
        .services_with_text("Dienste")
        .separator()
        .hide_with_text("Kladdy ausblenden")
        .hide_others_with_text("Andere ausblenden")
        .show_all_with_text("Alle einblenden")
        .separator()
        .quit_with_text("Kladdy beenden")
        .build()?;

    let erfassen = item("erfassen", "Erfassen …", Some("CmdOrCtrl+N"))?;
    let quittung = item("quittung", "Quittung schreiben …", None)?;
    let rechnung = item("rechnung", "Rechnung schreiben …", None)?;
    let importieren = item("importieren", "Beleg importieren …", Some("CmdOrCtrl+O"))?;
    let export = item("export", "Export …", None)?;
    let updates = item("updates", "Nach Updates suchen …", None)?;
    let ablage = SubmenuBuilder::new(app, "Ablage")
        .item(&erfassen)
        .item(&quittung)
        .item(&rechnung)
        .separator()
        .item(&importieren)
        .separator()
        .item(&export)
        .separator()
        .item(&updates)
        .separator()
        .close_window_with_text("Fenster schließen")
        .build()?;

    // Bearbeiten-Menü unbedingt behalten: ohne diese Einträge gehen ⌘C/⌘V/⌘Z in Eingabefeldern nicht (§3.1).
    let bearbeiten = SubmenuBuilder::new(app, "Bearbeiten")
        .undo_with_text("Widerrufen")
        .redo_with_text("Wiederholen")
        .separator()
        .cut_with_text("Ausschneiden")
        .copy_with_text("Kopieren")
        .paste_with_text("Einsetzen")
        .select_all_with_text("Alles auswählen")
        .build()?;

    let hell_dunkel = item(
        "hell-dunkel",
        "Hell/Dunkel umschalten",
        Some("CmdOrCtrl+Shift+L"),
    )?;
    let seitenleiste = item(
        "seitenleiste",
        "Seitenleiste ein-/ausblenden",
        Some("CmdOrCtrl+Backslash"),
    )?;
    let darstellung = SubmenuBuilder::new(app, "Darstellung")
        .item(&hell_dunkel)
        .item(&seitenleiste)
        .separator()
        .fullscreen_with_text("Vollbildmodus")
        .build()?;

    let fenster = SubmenuBuilder::new(app, "Fenster")
        .minimize_with_text("Im Dock ablegen")
        .maximize_with_text("Zoomen")
        .separator()
        .bring_all_to_front_with_text("Alle nach vorne bringen")
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &ablage, &bearbeiten, &darstellung, &fenster])
        .build()
}

/// Für den Updater (src/lib/updates.ts): Debug-Build (`npm run tauri dev`)? Dort wird nie installiert, weil die App
/// keine `.app` ist und der Updater sonst `src-tauri/target/debug` durch das Release-Bundle ersetzt (§3.2 Punkt 5).
#[tauri::command]
fn ist_entwicklerversion() -> bool {
    cfg!(debug_assertions)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Datenbank (§5): erst sichern, dann darf das SQL-Plugin migrieren – Reihenfolge nicht vertauschen.
        .plugin(datenbank::sicherungs_plugin())
        .plugin(datenbank::sql_plugin())
        .invoke_handler(tauri::generate_handler![
            datenbank::datenbank_url,
            ist_entwicklerversion,
            buchungen::buchung_anlegen,
            buchungen::buchung_aendern,
            buchungen::buchung_stornieren,
            belege::beleg_pruefen,
            belege::beleg_anhaengen,
            belege::beleg_oeffnen,
            belege::beleg_zeigen,
            kunden::kunde_anlegen,
            kunden::kunde_aendern,
            kunden::kunde_notiz,
            kunden::kunde_loeschen,
            kunden::link_oeffnen
        ])
        // Updates aus der App heraus (§3.2): Prüfen/Laden/Installieren und danach Neustart.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Dateiauswahl für Belege (⌘O „Beleg importieren“, Klick auf die Dropzone)
        .plugin(tauri_plugin_dialog::init())
        .menu(build_menu)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if MENU_IDS.contains(&id) {
                // Fehler beim Senden sind nicht kritisch (z. B. Fenster noch nicht geladen).
                let _ = app.emit(MENU_EVENT, id);
            }
        })
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von Kladdy");
}
