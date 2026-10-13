/* Kategorien (ANLEITUNG §2.8, §5 Tabelle kategorien). Vorerst nur lesen – für die Übersicht in Einstellungen › Steuern. */
import { abfrage } from '../db';

export interface KategorieZeile {
  id: number;
  name: string;
  typ: 'einnahme' | 'ausgabe';
  euer_bereich: string | null;
  abziehbar_prozent: number;
}

export const ladeKategorien = (): Promise<KategorieZeile[]> =>
  abfrage<KategorieZeile>(
    'SELECT id, name, typ, euer_bereich, abziehbar_prozent FROM kategorien WHERE archiviert = 0 ORDER BY typ DESC, sortierung, name',
  );
