//! Nummernkreise (ANLEITUNG §5 Tabelle nummernkreise, §6 „Laufende Nummern“).
//! Port der reinen Logik aus src/lib/numbering.ts (`musterFehler`, `istJahresabhaengig`, `formatNummer`,
//! `naechsteNummer`) plus die atomare Vergabe in einer laufenden Transaktion. Beide Seiten müssen gleich rechnen:
//! Das Frontend zeigt die Vorschau („erhält Nr. …“), vergeben wird nur hier.
//!
//! Platzhalter im Muster: {JJJJ} Jahr vierstellig · {JJ} Jahr zweistellig · {N…} laufende Nummer, mit Nullen auf so viele
//! Stellen aufgefüllt, wie N dastehen (1–8). Größere Nummern werden nicht abgeschnitten (RE-2026-1000).
//! Kreise mit Jahr im Muster beginnen jedes Jahr wieder bei 1; Kreise ohne Jahr (Kunde) laufen weiter, jahr bleibt 0.

use sqlx::SqliteConnection;

use crate::datenbank::db_fehler;

const MAX_LAENGE: usize = 40;

/// Ein Stück des Musters: einzelnes Zeichen außerhalb der Platzhalter oder Platzhalter-Name (ohne Klammern).
enum Teil<'a> {
    Zeichen(char),
    Platzhalter(&'a str),
}

/// Zerlegt wie der reguläre Ausdruck `\{([^{}]*)\}` (global) in numbering.ts: Ein `{` beginnt nur dann einen
/// Platzhalter, wenn bis zum nächsten `}` keine weitere Klammer steht.
fn zerlegen(muster: &str) -> Vec<Teil<'_>> {
    let mut teile = Vec::new();
    let mut i = 0;
    while i < muster.len() {
        let rest = &muster[i..];
        let c = rest.chars().next().unwrap_or_default();
        if c == '{' {
            let innen = &rest[1..];
            if let Some(ende) = innen.find(['{', '}'])
                && innen.as_bytes()[ende] == b'}'
            {
                teile.push(Teil::Platzhalter(&innen[..ende]));
                i += 1 + ende + 1;
                continue;
            }
        }
        teile.push(Teil::Zeichen(c));
        i += c.len_utf8();
    }
    teile
}

fn ist_nummer_platzhalter(name: &str) -> bool {
    (1..=8).contains(&name.len()) && name.bytes().all(|b| b == b'N')
}

/// Prüft ein Muster. Fehlermeldung (deutsch) oder `None`; dieselben Texte wie `musterFehler` in numbering.ts.
pub fn muster_fehler(muster: &str) -> Option<String> {
    if muster.trim().is_empty() {
        return Some("Das Muster darf nicht leer sein.".into());
    }
    if muster.chars().count() > MAX_LAENGE {
        return Some(format!(
            "Das Muster darf höchstens {MAX_LAENGE} Zeichen lang sein."
        ));
    }
    let teile = zerlegen(muster);
    let mut nummern = 0;
    for t in &teile {
        if let Teil::Platzhalter(name) = t {
            if ist_nummer_platzhalter(name) {
                nummern += 1;
            } else if *name != "JJJJ" && *name != "JJ" {
                return Some(format!(
                    "Unbekannter Platzhalter {{{name}}}. Erlaubt: {{JJJJ}}, {{JJ}}, {{NNN}} …"
                ));
            }
        }
    }
    if nummern == 0 {
        return Some("Das Muster braucht eine laufende Nummer, z. B. {NNN}.".into());
    }
    if nummern > 1 {
        return Some("Das Muster darf nur eine laufende Nummer enthalten.".into());
    }
    let zeichen = teile.iter().filter_map(|t| match t {
        Teil::Zeichen(c) => Some(*c),
        Teil::Platzhalter(_) => None,
    });
    let mut erlaubt = true;
    for c in zeichen {
        if c == '{' || c == '}' {
            return Some("Geschweifte Klammern nur für Platzhalter verwenden.".into());
        }
        if !(c.is_alphabetic() || c.is_ascii_digit() || matches!(c, '-' | '_' | '/' | '.')) {
            erlaubt = false;
        }
    }
    if !erlaubt {
        return Some("Erlaubt sind Buchstaben, Ziffern und - _ / . (keine Leerzeichen).".into());
    }
    None
}

/// Enthält das Muster ein Jahr? Dann beginnt der Kreis jedes Jahr neu.
pub fn ist_jahresabhaengig(muster: &str) -> bool {
    zerlegen(muster)
        .iter()
        .any(|t| matches!(t, Teil::Platzhalter("JJJJ" | "JJ")))
}

/// Nummer nach Muster, z. B. `format_nummer("RE-{JJJJ}-{NNN}", 2026, 14)` = `RE-2026-014`.
pub fn format_nummer(muster: &str, jahr: i64, laufend: i64) -> Result<String, String> {
    if let Some(f) = muster_fehler(muster) {
        return Err(format!("Ungültiges Muster „{muster}“: {f}"));
    }
    if laufend < 1 {
        return Err(format!("Laufende Nummer {laufend} ist ungültig"));
    }
    if ist_jahresabhaengig(muster) && !(1000..=9999).contains(&jahr) {
        return Err(format!("Jahr {jahr} ist ungültig"));
    }
    let mut aus = String::new();
    for t in zerlegen(muster) {
        match t {
            Teil::Zeichen(c) => aus.push(c),
            Teil::Platzhalter("JJJJ") => aus.push_str(&jahr.to_string()),
            Teil::Platzhalter("JJ") => aus.push_str(&format!("{:02}", jahr % 100)),
            Teil::Platzhalter(n) => aus.push_str(&format!("{laufend:0>breite$}", breite = n.len())),
        }
    }
    Ok(aus)
}

/// Zeile aus der Tabelle nummernkreise (ohne id).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Kreis {
    pub muster: String,
    /// 0 = noch nie benutzt bzw. jahresunabhängig
    pub jahr: i64,
    pub naechste: i64,
}

/// Ergebnis von `naechste_nummer`: die Nummer und der neue Stand (jahr, naechste) des Kreises.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Vergabe {
    pub nummer: String,
    pub laufend: i64,
    pub jahr: i64,
    pub naechste: i64,
}

/// Nächste Nummer eines Kreises im Jahr `jahr_jetzt`, ohne etwas zu speichern (wie `naechsteNummer` in numbering.ts).
/// - Jahresabhängig und neues Jahr ⇒ beginnt bei 1, jahr wird gesetzt.
/// - Jahresabhängig und älteres Jahr als der Kreis ⇒ Fehler (ein Kreis hat nur einen Stand).
/// - Ohne Jahr im Muster ⇒ jahr bleibt 0, es wird weitergezählt.
pub fn naechste_nummer(kreis: &Kreis, jahr_jetzt: i64) -> Result<Vergabe, String> {
    if kreis.naechste < 1 {
        return Err(format!(
            "Nummernkreis-Stand {} ist ungültig",
            kreis.naechste
        ));
    }
    if !ist_jahresabhaengig(&kreis.muster) {
        let laufend = kreis.naechste;
        return Ok(Vergabe {
            nummer: format_nummer(&kreis.muster, jahr_jetzt, laufend)?,
            laufend,
            jahr: 0,
            naechste: laufend + 1,
        });
    }
    if jahr_jetzt < kreis.jahr {
        return Err(format!(
            "Der Nummernkreis steht schon auf {}; für {jahr_jetzt} kann keine Nummer mehr vergeben werden",
            kreis.jahr
        ));
    }
    let laufend = if jahr_jetzt > kreis.jahr {
        1
    } else {
        kreis.naechste
    };
    Ok(Vergabe {
        nummer: format_nummer(&kreis.muster, jahr_jetzt, laufend)?,
        laufend,
        jahr: jahr_jetzt,
        naechste: laufend + 1,
    })
}

/// Vergibt die nächste Nummer des Kreises `kreis_id` im Jahr `jahr` und speichert den neuen Stand.
/// Muss in einer offenen Transaktion laufen (zusammen mit dem Datensatz, der die Nummer bekommt): Schlägt danach
/// etwas fehl, wird auch der Zähler zurückgerollt, und es entsteht keine Lücke.
/// Das UPDATE prüft den gelesenen Stand mit (jahr und naechste wie gelesen); hat ihn inzwischen jemand anderes
/// verändert, bricht die Vergabe ab, statt eine Nummer doppelt zu vergeben.
pub async fn vergeben(
    conn: &mut SqliteConnection,
    kreis_id: &str,
    jahr: i64,
) -> Result<String, String> {
    vergeben_mit(conn, kreis_id, jahr, false).await
}

/// Wie `vergeben`, aber nie rückwärts: Jahr = max(Jahr des Kreises, `jahr_heute`).
/// Regel für Buchungsnummern: Maßgeblich ist das heutige (lokale) Datum, nicht das Zahlungsdatum. Wird im Januar
/// noch eine Zahlung vom Dezember erfasst, bekommt sie eine Nummer des neuen Jahres; das schlägt nie fehl, und die
/// Nummern laufen nie zurück (auch wenn die Uhr des Rechners einmal falsch ging).
pub async fn vergeben_fortlaufend(
    conn: &mut SqliteConnection,
    kreis_id: &str,
    jahr_heute: i64,
) -> Result<String, String> {
    vergeben_mit(conn, kreis_id, jahr_heute, true).await
}

async fn vergeben_mit(
    conn: &mut SqliteConnection,
    kreis_id: &str,
    jahr: i64,
    nie_rueckwaerts: bool,
) -> Result<String, String> {
    let zeile: Option<(String, i64, i64)> =
        sqlx::query_as("SELECT muster, jahr, naechste FROM nummernkreise WHERE id = ?")
            .bind(kreis_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(db_fehler)?;
    let Some((muster, alt_jahr, alt_naechste)) = zeile else {
        return Err(format!("Den Nummernkreis „{kreis_id}“ gibt es nicht."));
    };
    let kreis = Kreis {
        muster,
        jahr: alt_jahr,
        naechste: alt_naechste,
    };
    let jahr = if nie_rueckwaerts {
        jahr.max(alt_jahr)
    } else {
        jahr
    };
    let v = naechste_nummer(&kreis, jahr)?;
    let geaendert = sqlx::query(
        "UPDATE nummernkreise SET jahr = ?, naechste = ? WHERE id = ? AND jahr = ? AND naechste = ?",
    )
    .bind(v.jahr)
    .bind(v.naechste)
    .bind(kreis_id)
    .bind(alt_jahr)
    .bind(alt_naechste)
    .execute(&mut *conn)
    .await
    .map_err(db_fehler)?
    .rows_affected();
    if geaendert != 1 {
        return Err(format!(
            "Der Nummernkreis „{kreis_id}“ wurde gleichzeitig verändert. Bitte noch einmal versuchen."
        ));
    }
    Ok(v.nummer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::datenbank::testhilfe::test_db;

    fn kreis(muster: &str, jahr: i64, naechste: i64) -> Kreis {
        Kreis {
            muster: muster.into(),
            jahr,
            naechste,
        }
    }

    #[test]
    fn standardmuster_wie_in_der_anleitung() {
        assert_eq!(
            format_nummer("QU-{JJJJ}-{NNN}", 2026, 105).unwrap(),
            "QU-2026-105"
        );
        assert_eq!(
            format_nummer("RE-{JJJJ}-{NNN}", 2026, 14).unwrap(),
            "RE-2026-014"
        );
        assert_eq!(
            format_nummer("{JJJJ}-{NNNN}", 2026, 1).unwrap(),
            "2026-0001"
        );
        assert_eq!(format_nummer("K-{NNNN}", 0, 12).unwrap(), "K-0012");
    }

    #[test]
    fn schneidet_grosse_nummern_nicht_ab() {
        assert_eq!(
            format_nummer("RE-{JJJJ}-{NNN}", 2026, 1000).unwrap(),
            "RE-2026-1000"
        );
        assert_eq!(format_nummer("K-{NNNN}", 0, 123456).unwrap(), "K-123456");
    }

    #[test]
    fn zweistelliges_jahr_und_beliebige_stellen() {
        assert_eq!(
            format_nummer("R{JJ}/{NNNNN}", 2026, 42).unwrap(),
            "R26/00042"
        );
        assert_eq!(format_nummer("{N}", 0, 3).unwrap(), "3");
        assert_eq!(format_nummer("{NNN}-{JJJJ}", 2030, 9).unwrap(), "009-2030");
        assert_eq!(format_nummer("R{JJ}-{NN}", 2005, 1).unwrap(), "R05-01");
        assert_eq!(
            format_nummer("Gü_{JJ}/{NNN}.x", 2026, 7).unwrap(),
            "Gü_26/007.x"
        );
    }

    #[test]
    fn ungueltige_eingaben() {
        assert!(
            format_nummer("RE-{JJJJ}", 2026, 1)
                .unwrap_err()
                .contains("laufende Nummer")
        );
        assert!(format_nummer("RE-{NNN}", 2026, 0).is_err());
        assert!(
            format_nummer("RE-{JJJJ}-{NNN}", 0, 1)
                .unwrap_err()
                .contains("Jahr 0")
        );
        assert!(format_nummer("RE-{JJJJ}-{NNN}", 26, 1).is_err());
    }

    #[test]
    fn musterfehler_wie_im_frontend() {
        let faelle = [
            ("", "leer"),
            ("   ", "leer"),
            ("RE-{JJJJ}", "laufende Nummer"),
            ("RE-{NNN}-{NN}", "nur eine"),
            ("RE-{MM}-{NNN}", "Unbekannter Platzhalter {MM}"),
            ("RE-{nnn}", "Unbekannter"),
            ("RE-{NNNNNNNNN}", "Unbekannter"),
            ("RE {NNN}", "keine Leerzeichen"),
            ("RE-{NNN}}", "Geschweifte"),
            ("RE-{{NNN}", "Geschweifte"),
            ("RE\\{NNN}", "Erlaubt sind"),
            ("RE-$-{NNN}", "Erlaubt sind"),
        ];
        for (muster, teil) in faelle {
            let f = muster_fehler(muster).unwrap_or_default();
            assert!(f.contains(teil), "„{muster}“ ⇒ „{f}“, erwartet „{teil}“");
        }
        let lang = format!("{}{{N}}", "R".repeat(41));
        assert!(muster_fehler(&lang).unwrap().contains("höchstens 40"));
        for m in [
            "{JJJJ}-{NNNN}",
            "RE-{JJJJ}-{NNN}",
            "QU-{JJJJ}-{NNN}",
            "AN-{JJJJ}-{NNN}",
            "EB-{JJJJ}-{NNN}",
            "K-{NNNN}",
        ] {
            assert_eq!(muster_fehler(m), None, "{m}");
        }
    }

    #[test]
    fn erkennt_das_jahr_im_muster() {
        assert!(ist_jahresabhaengig("RE-{JJJJ}-{NNN}"));
        assert!(ist_jahresabhaengig("R{JJ}{NNN}"));
        assert!(!ist_jahresabhaengig("K-{NNNN}"));
    }

    #[test]
    fn naechste_nummer_wie_im_frontend() {
        let quittung = kreis("QU-{JJJJ}-{NNN}", 2026, 105);
        let v = naechste_nummer(&quittung, 2026).unwrap();
        assert_eq!(
            v,
            Vergabe {
                nummer: "QU-2026-105".into(),
                laufend: 105,
                jahr: 2026,
                naechste: 106
            }
        );
        let v = naechste_nummer(&quittung, 2027).unwrap();
        assert_eq!(
            (v.nummer.as_str(), v.jahr, v.naechste),
            ("QU-2027-001", 2027, 2)
        );
        // frischer Kreis aus der Startmigration
        let v = naechste_nummer(&kreis("{JJJJ}-{NNNN}", 0, 1), 2026).unwrap();
        assert_eq!(
            (v.nummer.as_str(), v.jahr, v.naechste),
            ("2026-0001", 2026, 2)
        );
        // abgeschlossenes Jahr
        assert!(
            naechste_nummer(&quittung, 2025)
                .unwrap_err()
                .contains("2025")
        );
        // Kunde ohne Jahr
        let kunde = kreis("K-{NNNN}", 0, 12);
        let v = naechste_nummer(&kunde, 2031).unwrap();
        assert_eq!((v.nummer.as_str(), v.jahr, v.naechste), ("K-0012", 0, 13));
        // kaputter Stand
        assert!(naechste_nummer(&kreis("QU-{JJJJ}-{NNN}", 2026, 0), 2026).is_err());
    }

    #[test]
    fn lueckenlos_hintereinander() {
        let mut k = kreis("RE-{JJJJ}-{NNN}", 0, 1);
        let mut nummern = Vec::new();
        for jahr in [2026, 2026, 2026, 2027, 2027] {
            let v = naechste_nummer(&k, jahr).unwrap();
            nummern.push(v.nummer);
            k.jahr = v.jahr;
            k.naechste = v.naechste;
        }
        assert_eq!(
            nummern,
            [
                "RE-2026-001",
                "RE-2026-002",
                "RE-2026-003",
                "RE-2027-001",
                "RE-2027-002"
            ]
        );
    }

    async fn stand(c: &mut SqliteConnection, id: &str) -> (i64, i64) {
        sqlx::query_as("SELECT jahr, naechste FROM nummernkreise WHERE id = ?")
            .bind(id)
            .fetch_one(c)
            .await
            .unwrap()
    }

    #[test]
    fn vergabe_in_der_datenbank() {
        tauri::async_runtime::block_on(async {
            let mut c = test_db().await;
            assert_eq!(
                vergeben(&mut c, "buchung", 2026).await.unwrap(),
                "2026-0001"
            );
            assert_eq!(
                vergeben(&mut c, "buchung", 2026).await.unwrap(),
                "2026-0002"
            );
            assert_eq!(stand(&mut c, "buchung").await, (2026, 3));
            // Jahreswechsel: beginnt bei 1
            assert_eq!(
                vergeben(&mut c, "buchung", 2027).await.unwrap(),
                "2027-0001"
            );
            // streng: zurück ins alte Jahr geht nicht, der Stand bleibt
            assert!(vergeben(&mut c, "buchung", 2026).await.is_err());
            assert_eq!(stand(&mut c, "buchung").await, (2027, 2));
            // nie rückwärts: altes Jahr ⇒ Nummer im Jahr des Kreises
            assert_eq!(
                vergeben_fortlaufend(&mut c, "buchung", 2026).await.unwrap(),
                "2027-0002"
            );
            assert_eq!(
                vergeben_fortlaufend(&mut c, "buchung", 2028).await.unwrap(),
                "2028-0001"
            );
            // Kunde: jahresunabhängig, jahr bleibt 0
            assert_eq!(vergeben(&mut c, "kunde", 2026).await.unwrap(), "K-0001");
            assert_eq!(vergeben(&mut c, "kunde", 2030).await.unwrap(), "K-0002");
            assert_eq!(stand(&mut c, "kunde").await, (0, 3));
            assert!(vergeben(&mut c, "gibtsnicht", 2026).await.is_err());
        });
    }
}
