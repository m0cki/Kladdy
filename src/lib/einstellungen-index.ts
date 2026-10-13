/* Bereiche der Einstellungsseite und Verzeichnis aller einzelnen Einstellungen (für die Suche, §6.10).
 * Jede Einstellung trägt im DOM `data-setting="<id>"`; die Suche springt dorthin und hebt sie kurz hervor.
 * Neue Felder hier eintragen – noch nicht gebaute Bereiche zeigen auf den Bereich selbst. */
import {
  Building2,
  Database,
  FileText,
  Hash,
  HardDriveDownload,
  Info,
  Landmark,
  Palette,
  type LucideIcon,
} from 'lucide-react';

export type BereichId =
  | 'darstellung'
  | 'firma'
  | 'belege'
  | 'steuern'
  | 'nummernkreise'
  | 'datensicherung'
  | 'daten'
  | 'updates';

export interface Bereich {
  id: BereichId;
  label: string;
  icon: LucideIcon;
  /** noch nicht gebaut: kommt in dieser Phase */
  phase?: number;
  /** kurzer Hinweis für den Platzhalter */
  inhalt?: string;
}

export const EINSTELLUNGEN_PFAD = '/einstellungen';
/** Liegt der Pfad auf der Einstellungsseite? */
export const isEinstellungen = (path: string) => path === EINSTELLUNGEN_PFAD || path.startsWith(EINSTELLUNGEN_PFAD + '/');
export const bereichPfad = (id: BereichId, feld?: string) =>
  `${EINSTELLUNGEN_PFAD}/${id}${feld ? `?feld=${encodeURIComponent(feld)}` : ''}`;

export const BEREICHE: readonly Bereich[] = [
  { id: 'darstellung', label: 'Darstellung', icon: Palette },
  { id: 'firma', label: 'Firma', icon: Building2, phase: 1, inhalt: 'Name, Anschrift, Steuernummer, Bankverbindung und Firmenlogo.' },
  { id: 'belege', label: 'Belege', icon: FileText, phase: 3, inhalt: 'Beleg bei Einnahmen: Quittung oder Rechnung.' },
  { id: 'steuern', label: 'Steuern', icon: Landmark, phase: 1, inhalt: 'Kleinunternehmer oder Regelbesteuerung, Kennwerte pro Jahr, Kategorien, EÜR-Zuordnung.' },
  { id: 'nummernkreise', label: 'Nummernkreise', icon: Hash, phase: 1, inhalt: 'Muster für Rechnungs- und Quittungsnummern mit Vorschau.' },
  { id: 'datensicherung', label: 'Datensicherung', icon: HardDriveDownload, phase: 5, inhalt: 'Sicherungsziel, „Jetzt sichern“ und „Wiederherstellen …“.' },
  { id: 'daten', label: 'Daten', icon: Database, phase: 1, inhalt: 'Tectonic-Pfad, Demo-Daten laden oder entfernen.' },
  { id: 'updates', label: 'Updates & Über Kladdy', icon: Info },
];

export const isBereichId = (v: string | undefined): v is BereichId => BEREICHE.some((b) => b.id === v);
export const bereich = (id: BereichId): Bereich => BEREICHE.find((b) => b.id === id)!;

export interface EinstellungsEintrag {
  /** entspricht data-setting im DOM */
  id: string;
  label: string;
  bereich: BereichId;
  keywords?: readonly string[];
}

export const EINSTELLUNGEN: readonly EinstellungsEintrag[] = [
  /* Darstellung */
  { id: 'modus', label: 'Hell/Dunkel', bereich: 'darstellung', keywords: ['Modus', 'Hell', 'Dunkel', 'System', 'Dark Mode', 'Light Mode', 'Erscheinungsbild'] },
  { id: 'farbthema', label: 'Farbthema', bereich: 'darstellung', keywords: ['Theme', 'Themes', 'Preset', 'Vorlage', 'Indigo', 'Ozean', 'Smaragd', 'Terminal'] },
  { id: 'akzentfarbe', label: 'Akzentfarbe', bereich: 'darstellung', keywords: ['Akzent', 'Farbe', 'Accent'] },
  { id: 'farbton', label: 'Farbton Hintergrund', bereich: 'darstellung', keywords: ['Tönung', 'Hintergrundfarbe', 'Hue'] },
  { id: 'saettigung', label: 'Sättigung Hintergrund', bereich: 'darstellung', keywords: ['Sättigung', 'Saturation'] },
  { id: 'radius', label: 'Eckenrundung', bereich: 'darstellung', keywords: ['Radius', 'Ecken', 'abgerundet'] },
  { id: 'schriftgroesse', label: 'Schriftgröße', bereich: 'darstellung', keywords: ['Schrift', 'Text', 'Zoom', 'größer', 'kleiner'] },
  { id: 'dichte', label: 'Dichte', bereich: 'darstellung', keywords: ['Kompakt', 'Luftig', 'Abstände'] },
  { id: 'plusminus', label: 'Plus/Minus-Farben', bereich: 'darstellung', keywords: ['Farbenblind', 'Grün/Rot', 'Blau/Orange', 'Türkis/Pink', 'Einnahmen', 'Ausgaben'] },
  { id: 'zahlen', label: 'Monospace-Zahlen', bereich: 'darstellung', keywords: ['Zahlen', 'Monospace', 'Proportional', 'Ziffern', 'Schriftart'] },
  { id: 'animationen', label: 'Bewegung', bereich: 'darstellung', keywords: ['Animationen', 'reduziert', 'Effekte', 'Motion'] },
  { id: 'glas', label: 'Glas-Effekt', bereich: 'darstellung', keywords: ['Glas', 'Transparenz', 'Unschärfe', 'Blur'] },
  { id: 'aurora', label: 'Aurora (Farbverlauf im Hintergrund)', bereich: 'darstellung', keywords: ['Aurora', 'Farbverlauf', 'Hintergrund', 'Verlauf'] },
  { id: 'darstellung-zuruecksetzen', label: 'Darstellung zurücksetzen', bereich: 'darstellung', keywords: ['Standard', 'Reset'] },
  /* Updates & Über Kladdy */
  { id: 'version', label: 'Version', bereich: 'updates', keywords: ['Über Kladdy', 'Versionsnummer', 'About'] },
  { id: 'auto-updates', label: 'Automatisch nach Updates suchen', bereich: 'updates', keywords: ['Update', 'Aktualisierung', 'automatisch'] },
  { id: 'nach-updates-suchen', label: 'Nach Updates suchen …', bereich: 'updates', keywords: ['Update', 'Aktualisieren', 'neue Version'] },
  { id: 'haftung', label: 'Keine Steuerberatung', bereich: 'updates', keywords: ['Haftung', 'Gewähr', 'Hinweis'] },
  { id: 'datenschutz', label: 'Deine Daten bleiben auf diesem Mac', bereich: 'updates', keywords: ['Datenschutz', 'Tracking', 'Cloud', 'Privatsphäre'] },
  /* Noch nicht gebaut – springen in den Bereich */
  { id: 'firma', label: 'Firma', bereich: 'firma', keywords: ['Firmenname', 'Inhaber', 'Anschrift', 'Adresse', 'Kontakt', 'Bankverbindung', 'IBAN', 'PayPal'] },
  { id: 'firmenlogo', label: 'Firmenlogo', bereich: 'firma', keywords: ['Logo', 'Bild'] },
  { id: 'steuernummer', label: 'Steuernummer', bereich: 'firma', keywords: ['USt-IdNr', 'Umsatzsteuer-ID', 'KU-ID'] },
  { id: 'beleg-bei-einnahmen', label: 'Beleg bei Einnahmen', bereich: 'belege', keywords: ['Quittung', 'Rechnung', 'Vorauswahl'] },
  { id: 'steuermodus', label: 'Kleinunternehmer / Regelbesteuerung', bereich: 'steuern', keywords: ['Steuern', 'KU', '§ 19', 'Umsatzsteuer'] },
  { id: 'kategorien', label: 'Kategorien', bereich: 'steuern', keywords: ['EÜR-Zuordnung', 'Kennwerte'] },
  { id: 'nummernkreise', label: 'Nummernkreise', bereich: 'nummernkreise', keywords: ['Rechnungsnummer', 'Quittungsnummer', 'Muster', 'Nummer'] },
  { id: 'datensicherung', label: 'Datensicherung', bereich: 'datensicherung', keywords: ['Backup', 'Sicherung', 'Wiederherstellen', 'USB-Stick', 'iCloud'] },
  { id: 'tectonic', label: 'Tectonic-Pfad', bereich: 'daten', keywords: ['LaTeX', 'PDF'] },
  { id: 'demo-daten', label: 'Demo-Daten', bereich: 'daten', keywords: ['Beispieldaten', 'Daten'] },
];
